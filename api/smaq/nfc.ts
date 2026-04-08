/**
 * ABA API - NFC Endpoint (self-contained)
 * 
 * GET  /api/smaq/nfc?tag=AQ-00001  → Lookup citizen by NFC tag
 * POST /api/smaq/nfc               → Actions based on "action" field:
 *      { action: "link",   tagId: "AQ-00001", email: "socio@example.com" }
 *      { action: "charge", email: "socio@example.com", amount: 50 }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://iazjntvrxfyxlinkuiwx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function getSupabase() {
    return createClient(SUPABASE_URL, SUPABASE_KEY);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const supabase = getSupabase();

    // ─── GET: Lookup citizen by NFC tag ───
    if (req.method === 'GET') {
        try {
            const tag = req.query.tag;
            if (!tag || typeof tag !== 'string') {
                return res.status(400).json({ success: false, error: 'Parámetro "tag" requerido' });
            }

            const tagUpper = tag.toUpperCase();
            const { data, error } = await supabase
                .from('citizens')
                .select('id, email, name, dracma_balance, nfc_tag_id')
                .eq('nfc_tag_id', tagUpper)
                .single();

            if (error || !data) {
                return res.status(404).json({
                    success: false, linked: false,
                    error: 'Tag NFC no vinculado a ningún socio',
                    tag: tagUpper
                });
            }

            return res.status(200).json({
                success: true, linked: true,
                tag: data.nfc_tag_id,
                citizen: {
                    name: data.name || data.email,
                    email: data.email,
                    balance: data.dracma_balance || 0,
                    balanceDisplay: `${data.dracma_balance || 0} ABA`,
                }
            });
        } catch (error) {
            console.error('NFC lookup error:', error);
            return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Error interno' });
        }
    }

    // ─── POST: Link or Charge ───
    if (req.method === 'POST') {
        const { action } = req.body || {};

        // ── LINK: Vincular tag a socio ──
        if (action === 'link') {
            try {
                const { tagId, email } = req.body;
                if (!tagId) return res.status(400).json({ success: false, error: 'tagId requerido' });
                if (!email) return res.status(400).json({ success: false, error: 'Email requerido' });

                const normalizedEmail = email.trim().toLowerCase();
                const tagUpper = tagId.toUpperCase();

                // Check if tag already linked to someone else
                const { data: existing } = await supabase
                    .from('citizens')
                    .select('id, email')
                    .eq('nfc_tag_id', tagUpper)
                    .single();

                if (existing && existing.email !== normalizedEmail) {
                    return res.status(400).json({ success: false, error: `Tag ya vinculado a ${existing.email}` });
                }

                // Find citizen
                const { data: citizen, error: findErr } = await supabase
                    .from('citizens')
                    .select('id, email, name, dracma_balance')
                    .eq('email', normalizedEmail)
                    .single();

                if (findErr || !citizen) {
                    return res.status(404).json({ success: false, error: `No se encontró socio con email ${normalizedEmail}` });
                }

                // Link tag
                const { error: updateErr } = await supabase
                    .from('citizens')
                    .update({ nfc_tag_id: tagUpper })
                    .eq('id', citizen.id);

                if (updateErr) {
                    return res.status(500).json({ success: false, error: updateErr.message });
                }

                return res.status(200).json({
                    success: true,
                    message: `Tag ${tagUpper} vinculado a ${normalizedEmail}`,
                    citizen: {
                        name: citizen.name || citizen.email,
                        email: citizen.email,
                        balance: citizen.dracma_balance || 0,
                        balanceDisplay: `${citizen.dracma_balance || 0} ABA`,
                    }
                });
            } catch (error) {
                console.error('NFC link error:', error);
                return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Error interno' });
            }
        }

        // ── CHARGE: Cobrar ABA a socio ──
        if (action === 'charge') {
            try {
                const { email, amount } = req.body;
                if (!email) return res.status(400).json({ success: false, error: 'Email requerido' });

                const chargeAmount = parseFloat(amount);
                if (!chargeAmount || chargeAmount <= 0) {
                    return res.status(400).json({ success: false, error: 'Monto inválido' });
                }

                const normalizedEmail = email.trim().toLowerCase();

                // Get current balance
                const { data: citizen, error: findErr } = await supabase
                    .from('citizens')
                    .select('id, email, name, dracma_balance')
                    .eq('email', normalizedEmail)
                    .single();

                if (findErr || !citizen) {
                    return res.status(404).json({ success: false, error: `Socio no encontrado` });
                }

                const currentBalance = citizen.dracma_balance || 0;
                if (currentBalance < chargeAmount) {
                    return res.status(400).json({
                        success: false,
                        error: `Saldo insuficiente. Tiene ${currentBalance} ABA, necesita ${chargeAmount}`,
                        balance: currentBalance
                    });
                }

                // Use RPC for atomic transaction
                const { data: rpcResult, error: rpcErr } = await supabase
                    .rpc('record_dracma_transaction', {
                        p_citizen_id: citizen.id,
                        p_amount: -chargeAmount,
                        p_type: 'consumo',
                        p_description: `NFC POS charge`
                    });

                if (rpcErr) {
                    console.error('RPC error:', rpcErr);
                    return res.status(500).json({ success: false, error: `Error al cobrar: ${rpcErr.message}` });
                }

                const newBalance = currentBalance - chargeAmount;

                return res.status(200).json({
                    success: true,
                    message: `Cobrado ${chargeAmount} ABA a ${citizen.name || normalizedEmail}`,
                    charged: chargeAmount,
                    previousBalance: currentBalance,
                    newBalance: newBalance,
                    balanceDisplay: `${newBalance} ABA`,
                });
            } catch (error) {
                console.error('NFC charge error:', error);
                return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Error interno' });
            }
        }

        return res.status(400).json({ success: false, error: 'action requerida: "link" o "charge"' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
