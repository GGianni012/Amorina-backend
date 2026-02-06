/**
 * SMAQ API - Credit Endpoint
 * POST /api/smaq/credit
 * 
 * Body: { email, amount, source, description }
 * 
 * Used by: MP Webhook, Admin, Subscription renewal
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SmaqBank, WalletSyncService, type TransactionSource } from '../../smaq-service';
import { loadConfig } from '../../core';

interface CreditRequest {
    email: string;
    amount: number;
    source: TransactionSource;
    description?: string;
    walletObjectId?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { email, amount, source, description, walletObjectId } = req.body as CreditRequest;

        // Validation
        if (!email) {
            return res.status(400).json({ error: 'Email requerido' });
        }
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Monto inválido' });
        }
        if (!source) {
            return res.status(400).json({ error: 'Fuente requerida' });
        }

        const config = loadConfig();
        const smaqBank = new SmaqBank(config);

        // Credit the account
        const result = await smaqBank.credit(
            email,
            amount,
            source,
            'system',
            description || `Acreditación de ${amount} SMAQ`,
            walletObjectId
        );

        // Sync to Google Wallet if objectId provided
        if (walletObjectId && process.env.GOOGLE_WALLET_ISSUER_ID) {
            try {
                const walletSync = new WalletSyncService({
                    issuerId: process.env.GOOGLE_WALLET_ISSUER_ID,
                    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
                    serviceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY || ''
                });
                await walletSync.updateBalance(walletObjectId, result.newBalance);
            } catch (walletError) {
                console.error('Wallet sync failed (non-blocking):', walletError);
            }
        }

        return res.status(200).json({
            success: true,
            newBalance: result.newBalance,
            transactionId: result.transactionId,
            message: `Acreditación exitosa. Nuevo saldo: ${result.newBalance} SMAQ`
        });

    } catch (error) {
        console.error('SMAQ credit error:', error);
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Error interno'
        });
    }
}
