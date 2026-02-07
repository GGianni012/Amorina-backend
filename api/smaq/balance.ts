/**
 * SMAQ API - Balance Endpoint
 * GET /api/smaq/balance?email=user@example.com
 * 
 * Combines:
 * - SMAQ balance from Google Sheets (SMAQ_TRANSACTIONS)
 * - DRACMAS balance from Supabase (citizens.dracma_balance)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SmaqBank } from '../../smaq-service';
import { loadConfig } from '../../core';
import { createClient } from '@supabase/supabase-js';

// Supabase config - same project as Aquilea
const SUPABASE_URL = 'https://iazjntvrxfyxlinkuiwx.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhempudHZyeGZ5eGxpbmt1aXd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI2ODg0MjIsImV4cCI6MjA1ODI2NDQyMn0.WxD1RkHenXXnEHMQaME8cjqMfbRaXnVcR9HMYRBqXZg';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { email } = req.query;

        if (!email || typeof email !== 'string') {
            return res.status(400).json({ error: 'Email requerido' });
        }

        // 1. Get SMAQ balance from Google Sheets
        const config = loadConfig();
        const smaqBank = new SmaqBank(config);
        const smaqBalance = await smaqBank.getBalance(email);

        // 2. Get DRACMAS balance from Supabase
        let dracmaBalance = 0;
        try {
            const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            const { data: citizen, error } = await supabase
                .from('citizens')
                .select('dracma_balance')
                .eq('email', email.toLowerCase())
                .single();

            if (!error && citizen) {
                dracmaBalance = parseFloat(citizen.dracma_balance) || 0;
            }
        } catch (supabaseError) {
            console.warn('Could not fetch DRACMAS from Supabase:', supabaseError);
            // Continue with just SMAQ balance
        }

        // 3. Combine balances (SMAQ + DRACMAS = Total tokens)
        const totalBalance = smaqBalance + dracmaBalance;

        return res.status(200).json({
            success: true,
            email,
            balance: totalBalance,
            balanceDisplay: `${totalBalance} SMAQ`,
            breakdown: {
                smaq: smaqBalance,
                dracmas: dracmaBalance
            }
        });

    } catch (error) {
        console.error('SMAQ balance error:', error);
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Error interno'
        });
    }
}
