/**
 * SMAQ API - Balance Endpoint
 * GET /api/smaq/balance?email=user@example.com
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SmaqBank } from '../../smaq-service';
import { loadConfig } from '../../core';

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

        const config = loadConfig();
        const smaqBank = new SmaqBank(config);

        const balance = await smaqBank.getBalance(email);

        return res.status(200).json({
            success: true,
            email,
            balance,
            balanceDisplay: `${balance} SMAQ`
        });

    } catch (error) {
        console.error('SMAQ balance error:', error);
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Error interno'
        });
    }
}
