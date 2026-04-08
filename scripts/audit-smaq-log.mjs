#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';

const DEFAULT_LOG_SHEET = 'SMAQ_LOG';

function parseArgs(argv) {
    const args = {
        sheet: DEFAULT_LOG_SHEET,
        txLimit: 200,
        logLimit: 500,
        days: 14
    };

    for (const raw of argv) {
        if (raw.startsWith('--sheet=')) args.sheet = raw.split('=')[1] || DEFAULT_LOG_SHEET;
        else if (raw.startsWith('--tx-limit=')) {
            const parsed = Number(raw.split('=')[1]);
            if (Number.isFinite(parsed) && parsed > 0) args.txLimit = Math.floor(parsed);
        } else if (raw.startsWith('--log-limit=')) {
            const parsed = Number(raw.split('=')[1]);
            if (Number.isFinite(parsed) && parsed > 0) args.logLimit = Math.floor(parsed);
        } else if (raw.startsWith('--days=')) {
            const parsed = Number(raw.split('=')[1]);
            if (Number.isFinite(parsed) && parsed > 0) args.days = Math.floor(parsed);
        }
    }

    return args;
}

function printUsage() {
    console.log('Usage: node scripts/audit-smaq-log.mjs [options]');
    console.log('');
    console.log('Options:');
    console.log('  --sheet=SMAQ_LOG    Log sheet name (default: SMAQ_LOG)');
    console.log('  --days=14           Time window for Supabase transactions');
    console.log('  --tx-limit=200      Max Supabase rows to compare');
    console.log('  --log-limit=500     Max log rows from Sheets to compare');
    console.log('');
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeDescription(value) {
    return String(value || '').trim().replace(/^\[[^\]]+\]\s*/, '');
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

function normalizeType(value) {
    const lower = normalizeText(value);
    if (lower.includes('charge') || lower.includes('consumo') || lower.includes('debito') || lower.includes('debit')) return 'charge';
    if (
        lower.includes('credit') ||
        lower.includes('acredit') ||
        lower.includes('cashback') ||
        lower.includes('regalo') ||
        lower.includes('ajuste')
    ) return 'credit';
    return lower;
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

function toAuditKey({ email, type, amount, description }) {
    return `${normalizeEmail(email)}|${normalizeType(type)}|${round2(Math.abs(amount)).toFixed(2)}|${normalizeDescription(description)}`;
}

async function readLogRows({ spreadsheetId, clientEmail, privateKey, sheet }) {
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

function parseLogEntries(rows, logLimit) {
    if (rows.length === 0) return [];

    let headerIndex = -1;
    let header = [];
    for (let i = 0; i < Math.min(rows.length, 5); i += 1) {
        const candidate = (rows[i] || []).map((c) => normalizeText(c));
        const looksLikeHeader =
            candidate.includes('email') &&
            (candidate.includes('type') || candidate.includes('tipo')) &&
            (candidate.includes('amount') || candidate.includes('monto'));
        if (looksLikeHeader) {
            headerIndex = i;
            header = candidate;
            break;
        }
    }
    const hasHeader = headerIndex >= 0;
    const start = hasHeader ? headerIndex + 1 : 0;

    const find = (name, fallback) => {
        const idx = header.indexOf(name);
        return idx >= 0 ? idx : fallback;
    };

    const emailCol = find('email', 1);
    const typeCol = header.includes('type') ? find('type', 2) : find('tipo', 2);
    const amountCol = header.includes('amount') ? find('amount', 3) : find('monto', 3);
    const descCol = header.includes('description') ? find('description', 6) : find('descripcion', 5);

    const payloadRows = rows.slice(start).slice(-logLimit);
    const entries = [];

    for (const row of payloadRows) {
        const email = normalizeEmail(row[emailCol]);
        const type = normalizeType(row[typeCol]);
        const amount = toNumber(row[amountCol]);
        const description = String(row[descCol] || '');

        if (!email || !Number.isFinite(amount) || !['charge', 'credit'].includes(type)) {
            continue;
        }

        entries.push({
            email,
            type,
            amount: round2(Math.abs(amount)),
            description
        });
    }

    return entries;
}

async function loadTransactionsForAudit(supabase, txLimit, days) {
    const fromDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();

    const txQuery = await supabase
        .from('dracma_transactions')
        .select('id, citizen_id, amount, description, created_at, type')
        .gte('created_at', fromDate)
        .order('created_at', { ascending: false })
        .limit(txLimit);

    if (txQuery.error) throw txQuery.error;
    const txRows = txQuery.data || [];

    const citizenIds = Array.from(new Set(txRows.map((tx) => tx.citizen_id).filter(Boolean)));
    const emailByCitizenId = new Map();

    if (citizenIds.length > 0) {
        const citizenQuery = await supabase
            .from('citizens')
            .select('id, email')
            .in('id', citizenIds);

        if (citizenQuery.error) throw citizenQuery.error;
        for (const row of citizenQuery.data || []) {
            emailByCitizenId.set(row.id, normalizeEmail(row.email));
        }
    }

    const txEntries = [];

    for (const tx of txRows) {
        const email = emailByCitizenId.get(tx.citizen_id || '');
        const amount = toNumber(tx.amount);
        const txType = String(tx.type || '').toLowerCase();
        if (!['consumo', 'acreditacion'].includes(txType)) continue;
        if (!email || !Number.isFinite(amount) || amount === 0) continue;

        const type = amount < 0 ? 'charge' : 'credit';
        const description = String(tx.description || '');

        // Skip explicit migration markers because they are not user-facing activity logs.
        if (description.startsWith('[migration:smaq_transactions]')) continue;

        txEntries.push({
            id: tx.id,
            createdAt: tx.created_at,
            email,
            type,
            amount: round2(Math.abs(amount)),
            description
        });
    }

    return txEntries;
}

function incrementCounter(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
}

function decrementCounterIfPresent(map, key) {
    const current = map.get(key) || 0;
    if (current <= 0) return false;
    if (current === 1) map.delete(key);
    else map.set(key, current - 1);
    return true;
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

    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    console.log(`[ABA LOG AUDIT] Sheet=${args.sheet} | txLimit=${args.txLimit} | logLimit=${args.logLimit} | days=${args.days}`);

    const [logRows, txEntries] = await Promise.all([
        readLogRows({
            spreadsheetId: process.env.GOOGLE_SHEETS_ID,
            clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            privateKey,
            sheet: args.sheet
        }),
        loadTransactionsForAudit(supabase, args.txLimit, args.days)
    ]);

    const logEntries = parseLogEntries(logRows, args.logLimit);
    const logCounter = new Map();

    for (const entry of logEntries) {
        incrementCounter(logCounter, toAuditKey(entry));
    }

    const missingLogs = [];
    let matched = 0;

    for (const tx of txEntries) {
        const key = toAuditKey(tx);
        if (decrementCounterIfPresent(logCounter, key)) {
            matched += 1;
        } else {
            missingLogs.push(tx);
        }
    }

    const coverage = txEntries.length === 0 ? 100 : round2((matched / txEntries.length) * 100);

    console.log(`[ABA LOG AUDIT] transactions_checked=${txEntries.length}`);
    console.log(`[ABA LOG AUDIT] log_rows_checked=${logEntries.length}`);
    console.log(`[ABA LOG AUDIT] matched=${matched}`);
    console.log(`[ABA LOG AUDIT] missing_logs=${missingLogs.length}`);
    console.log(`[ABA LOG AUDIT] coverage=${coverage}%`);

    if (missingLogs.length > 0) {
        console.log('');
        console.log('[ABA LOG AUDIT] Missing sample (up to 20):');
        missingLogs.slice(0, 20).forEach((tx) => {
            console.log(
                `  - ${tx.createdAt} | ${tx.email} | ${tx.type} | ${tx.amount.toFixed(2)} | ${normalizeDescription(tx.description)}`
            );
        });
    }
}

main().catch((error) => {
    console.error('[ABA LOG AUDIT] Fatal:', error?.message || error);
    process.exitCode = 1;
});
