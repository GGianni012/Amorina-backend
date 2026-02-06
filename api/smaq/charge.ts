/**
 * SMAQ API - Charge Endpoint
 * POST /api/smaq/charge
 * 
 * Body: { email, amount, app, description }
 * 
 * Used by: Staff POS, Cine checkout, Subs payment
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SmaqBank, WalletSyncService, type AppSource } from '../../smaq-service';
import { loadConfig } from '../../core';

interface ChargeRequest {
    email: string;
    amount: number;
    app: AppSource;
    description: string;
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
        const { email, amount, app, description, walletObjectId } = req.body as ChargeRequest;

        // Validation - need either email OR walletObjectId
        if (!email && !walletObjectId) {
            return res.status(400).json({ error: 'Email o walletObjectId requerido' });
        }
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Monto inválido' });
        }
        if (!app) {
            return res.status(400).json({ error: 'App de origen requerida' });
        }

        const config = loadConfig();
        const smaqBank = new SmaqBank(config);

        // If we have walletObjectId but no email, try to resolve email from wallet
        let userEmail = email;
        if (!userEmail && walletObjectId) {
            // For now, extract from objectId or lookup in database
            // The walletObjectId format is: 3388000000023078410.SMAQ_1234567890
            // We'll need to store email<->walletObjectId mapping
            // For now, use a fallback lookup via the wallet service
            try {
                const walletSync = new WalletSyncService({
                    issuerId: process.env.GOOGLE_WALLET_ISSUER_ID || '',
                    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
                    serviceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY || ''
                });
                const passData = await walletSync.getPass(walletObjectId);
                if (passData?.textModulesData) {
                    const emailModule = passData.textModulesData.find((m: any) => m.id === 'email');
                    if (emailModule) {
                        userEmail = emailModule.body;
                    }
                }
            } catch (walletLookupError) {
                console.error('Wallet lookup failed:', walletLookupError);
            }
        }

        if (!userEmail) {
            return res.status(400).json({
                error: 'No se pudo identificar al usuario. Probá con búsqueda manual.'
            });
        }

        // Attempt charge
        const result = await smaqBank.charge(
            userEmail,
            amount,
            app,
            description || `Consumo de ${amount} SMAQ`,
            walletObjectId
        );

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error,
                balance: result.newBalance
            });
        }

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
            message: `Cobro exitoso. Nuevo saldo: ${result.newBalance} SMAQ`
        });

    } catch (error) {
        console.error('SMAQ charge error:', error);
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Error interno'
        });
    }
}
