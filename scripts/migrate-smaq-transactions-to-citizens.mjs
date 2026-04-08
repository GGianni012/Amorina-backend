#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';

const DEFAULT_SHEET_NAME = 'SMAQ_TRANSACTIONS';
const MIGRATION_TAG = '[migration:smaq_transactions]';

function parseArgs(argv) {
    const args = {
        apply: false,
        sheet: DEFAULT_SHEET_NAME,
        reconcileMode: 'max',
        markZero: true,
        email: null,
        limit: null
    };

    for (const raw of argv) {
        if (raw === '--apply') args.apply = true;
        else if (raw === '--dry-run') args.apply = false;
        else if (raw === '--no-mark-zero') args.markZero = false;
        else if (raw.startsWith('--sheet=')) args.sheet = raw.split('=')[1] || DEFAULT_SHEET_NAME;
        else if (raw.startsWith('--mode=')) args.reconcileMode = raw.split('=')[1] || 'max';
        else if (raw.startsWith('--email=')) args.email = normalizeEmail(raw.split('=')[1] || '');
        else if (raw.startsWith('--limit=')) {
            const parsed = Number(raw.split('=')[1]);
            args.limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
        }
    }

    if (!['max', 'sheet'].includes(args.reconcileMode)) {
        throw new Error('Invalid --mode value. Use --mode=max or --mode=sheet');
    }

    return args;
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s_-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    const normalized = String(value || '')
        .trim()
        .replace(/\s/g, '')
        .replace(/[^0-9,.\-]/g, '')
        .replace(/\.(?=\d{3}(?:\D|$))/g, '')
        .replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
}

function round2(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatAmount(value) {
    return round2(value).toFixed(2);
}

function detectColumns(rows) {
    let headerIndex = -1;
    let normalizedHeader = [];

    for (let i = 0; i < Math.min(rows.length, 5); i += 1) {
        const candidate = (rows[i] || []).map((c) => normalizeText(c));
        const looksLikeHeader =
            candidate.includes('email') &&
            (candidate.includes('type') || candidate.includes('tipo')) &&
            (candidate.includes('amount') || candidate.includes('monto'));
        if (looksLikeHeader) {
            headerIndex = i;
            normalizedHeader = candidate;
            break;
        }
    }

    const indexOfAny = (candidates, fallback) => {
        for (const candidate of candidates) {
            const idx = normalizedHeader.indexOf(candidate);
            if (idx >= 0) return idx;
        }
        return fallback;
    };

    return {
        hasHeader: headerIndex >= 0,
        firstDataRow: headerIndex >= 0 ? headerIndex + 1 : 0,
        emailCol: indexOfAny(['email', 'mail'], 1),
        typeCol: indexOfAny(['type', 'tipo'], 2),
        amountCol: indexOfAny(['amount', 'monto'], 3)
    };
}

function parseLegacyBalanceRows(rows) {
    const { firstDataRow, emailCol, typeCol, amountCol } = detectColumns(rows);
    const balances = new Map();
    const stats = {
        totalRows: Math.max(0, rows.length - firstDataRow),
        parsedRows: 0,
        skippedRows: 0,
        credits: 0,
        charges: 0
    };

    for (let i = firstDataRow; i < rows.length; i += 1) {
        const row = rows[i] || [];
        const email = normalizeEmail(row[emailCol]);
        const rawType = normalizeText(row[typeCol]);
        const amount = toNumber(row[amountCol]);

        if (!email || !rawType || !Number.isFinite(amount)) {
            stats.skippedRows += 1;
            continue;
        }

        let delta = 0;
        const isCreditType =
            rawType.includes('credit') ||
            rawType.includes('acredit') ||
            rawType.includes('cashback') ||
            rawType.includes('regalo') ||
            rawType.includes('ajuste');
        const isChargeType =
            rawType.includes('charge') ||
            rawType.includes('consumo') ||
            rawType.includes('evaporacion') ||
            rawType.includes('debit') ||
            rawType.includes('debito');

        if (isCreditType) {
            delta = Math.abs(amount);
            stats.credits += 1;
        } else if (isChargeType) {
            delta = -Math.abs(amount);
            stats.charges += 1;
        } else {
            stats.skippedRows += 1;
            continue;
        }

        const current = balances.get(email) || 0;
        balances.set(email, round2(current + delta));
        stats.parsedRows += 1;
    }

    return { balances, stats };
}

async function readSheetRows({ spreadsheetId, clientEmail, privateKey, sheet }) {
    const auth = new google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });

    const sheets = google.sheets({ version: 'v4', auth });

    let response;
    try {
        response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheet}'`
        });
    } catch (error) {
        if (String(error?.message || '').includes('Unable to parse range')) {
            throw new Error(`Sheet '${sheet}' does not exist in spreadsheet ${spreadsheetId}`);
        }
        throw error;
    }

    return response.data.values || [];
}

async function getOrCreateCitizen(supabase, email, createIfMissing) {
    const lookup = await supabase
        .from('citizens')
        .select('id, email, dracma_balance')
        .eq('email', email)
        .maybeSingle();

    if (lookup.error) throw lookup.error;
    if (lookup.data) {
        return { citizen: lookup.data, created: false };
    }

    if (!createIfMissing) {
        return { citizen: null, created: false };
    }

    const fallbackName = email.split('@')[0] || null;
    const created = await supabase
        .from('citizens')
        .insert({ email, name: fallbackName })
        .select('id, email, dracma_balance')
        .single();

    if (created.error) throw created.error;
    return { citizen: created.data, created: true };
}

async function hasMigrationMarker(supabase, citizenId) {
    const marker = await supabase
        .from('dracma_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('citizen_id', citizenId)
        .ilike('description', `${MIGRATION_TAG}%`);

    if (marker.error) throw marker.error;
    return (marker.count || 0) > 0;
}

async function applyBalanceAdjustment({
    supabase,
    citizenId,
    delta,
    sourceBalance,
    reconcileMode
}) {
    const description = `${MIGRATION_TAG} source_balance=${formatAmount(sourceBalance)} mode=${reconcileMode}`;

    const { error } = await supabase.rpc('record_dracma_transaction', {
        p_citizen_id: citizenId,
        p_type: 'ajuste',
        p_amount: round2(delta),
        p_description: description
    });

    if (error) throw error;
}

function printUsage() {
    console.log('Usage: node scripts/migrate-smaq-transactions-to-citizens.mjs [options]');
    console.log('');
    console.log('Options:');
    console.log('  --apply              Persist changes in Supabase (default: dry-run)');
    console.log('  --dry-run            Print planned changes without writing');
    console.log('  --sheet=NAME         Source sheet name (default: SMAQ_TRANSACTIONS)');
    console.log('  --mode=max|sheet     Reconciliation mode (default: max)');
    console.log('  --email=user@x.com   Process one user only');
    console.log('  --limit=N            Process at most N users');
    console.log('  --no-mark-zero       Skip marker when delta is 0');
    console.log('');
}

async function main() {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
        printUsage();
        return;
    }

    const args = parseArgs(process.argv.slice(2));
    const requiredEnvVars = [
        'SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
        'GOOGLE_SHEETS_ID',
        'GOOGLE_SERVICE_ACCOUNT_EMAIL'
    ];

    const missing = requiredEnvVars.filter((name) => !process.env[name]);
    if (!process.env.GOOGLE_PRIVATE_KEY && !process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        missing.push('GOOGLE_PRIVATE_KEY (or GOOGLE_SERVICE_ACCOUNT_KEY)');
    }

    if (missing.length > 0) {
        throw new Error(`Missing env vars: ${missing.join(', ')}`);
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n');

    console.log(`[ABA MIGRATION] Mode=${args.apply ? 'APPLY' : 'DRY-RUN'} | Reconcile=${args.reconcileMode} | Sheet=${args.sheet}`);

    const rows = await readSheetRows({
        spreadsheetId: process.env.GOOGLE_SHEETS_ID,
        clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        privateKey,
        sheet: args.sheet
    });

    if (rows.length === 0) {
        console.log('[ABA MIGRATION] Source sheet is empty. Nothing to migrate.');
        return;
    }

    const { balances, stats } = parseLegacyBalanceRows(rows);
    let entries = Array.from(balances.entries()).map(([email, balance]) => ({ email, sheetBalance: round2(balance) }));

    if (args.email) {
        entries = entries.filter((entry) => entry.email === args.email);
    }

    entries.sort((a, b) => a.email.localeCompare(b.email));

    if (args.limit) {
        entries = entries.slice(0, args.limit);
    }

    console.log(`[ABA MIGRATION] Parsed rows=${stats.parsedRows}/${stats.totalRows}, skipped=${stats.skippedRows}, users=${entries.length}`);

    const summary = {
        createdCitizens: 0,
        plannedCitizenCreates: 0,
        alreadyMigrated: 0,
        updatedBalances: 0,
        markedZeroDelta: 0,
        dryRunPlanned: 0,
        errors: 0
    };

    for (const entry of entries) {
        const { email, sheetBalance } = entry;
        try {
            const { citizen, created } = await getOrCreateCitizen(supabase, email, args.apply);
            if (created) summary.createdCitizens += 1;

            if (!citizen) {
                summary.plannedCitizenCreates += 1;
                const nonNegativeSheet = Math.max(0, round2(sheetBalance));
                summary.dryRunPlanned += 1;
                console.log(
                    `- PLAN ${email} | current=0.00 | sheet=${formatAmount(nonNegativeSheet)} | target=${formatAmount(nonNegativeSheet)} | delta=${formatAmount(nonNegativeSheet)} | create_citizen=true`
                );
                continue;
            }

            const alreadyMigrated = await hasMigrationMarker(supabase, citizen.id);
            if (alreadyMigrated) {
                summary.alreadyMigrated += 1;
                console.log(`- SKIP ${email} (already migrated)`);
                continue;
            }

            const currentBalance = round2(toNumber(citizen.dracma_balance) || 0);
            const nonNegativeSheet = Math.max(0, round2(sheetBalance));
            const targetBalance = args.reconcileMode === 'max'
                ? Math.max(currentBalance, nonNegativeSheet)
                : nonNegativeSheet;
            const delta = round2(targetBalance - currentBalance);

            if (!args.apply) {
                summary.dryRunPlanned += 1;
                console.log(
                    `- PLAN ${email} | current=${formatAmount(currentBalance)} | sheet=${formatAmount(nonNegativeSheet)} | target=${formatAmount(targetBalance)} | delta=${formatAmount(delta)}`
                );
                continue;
            }

            if (delta !== 0) {
                await applyBalanceAdjustment({
                    supabase,
                    citizenId: citizen.id,
                    delta,
                    sourceBalance: nonNegativeSheet,
                    reconcileMode: args.reconcileMode
                });
                summary.updatedBalances += 1;
                console.log(`- APPLY ${email} | delta=${formatAmount(delta)} | new_target=${formatAmount(targetBalance)}`);
            } else if (args.markZero) {
                await applyBalanceAdjustment({
                    supabase,
                    citizenId: citizen.id,
                    delta: 0,
                    sourceBalance: nonNegativeSheet,
                    reconcileMode: args.reconcileMode
                });
                summary.markedZeroDelta += 1;
                console.log(`- MARK ${email} | delta=0.00 (migration marker inserted)`);
            } else {
                console.log(`- SKIP ${email} | delta=0.00 (no marker due to --no-mark-zero)`);
            }
        } catch (error) {
            summary.errors += 1;
            console.error(`- ERROR ${email}:`, error?.message || error);
        }
    }

    console.log('');
    console.log('[ABA MIGRATION] Summary');
    console.log(`  createdCitizens: ${summary.createdCitizens}`);
    console.log(`  plannedCitizenCreates: ${summary.plannedCitizenCreates}`);
    console.log(`  alreadyMigrated: ${summary.alreadyMigrated}`);
    console.log(`  updatedBalances: ${summary.updatedBalances}`);
    console.log(`  markedZeroDelta: ${summary.markedZeroDelta}`);
    console.log(`  dryRunPlanned: ${summary.dryRunPlanned}`);
    console.log(`  errors: ${summary.errors}`);
}

main().catch((error) => {
    console.error('[ABA MIGRATION] Fatal:', error?.message || error);
    process.exitCode = 1;
});
