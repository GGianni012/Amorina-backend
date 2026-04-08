/**
 * ABA API - Charge Endpoint
 * POST /api/smaq/charge
 * 
 * Body: { email, amount, app, description }
 * 
 * Used by: Staff POS, Cine checkout, Subs payment
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SmaqBank, type AppSource } from '../../smaq-service';
import { loadConfig } from '../../core';
import {
    handleOptions,
    normalizeEmail,
    parsePositiveAmount,
    resolveEmailFromWalletObjectId,
    setCors,
    syncWalletBalanceIfPresent
} from './_endpoint-utils';

interface ChargeRequest {
    email?: string;
    amount: number | string;
    app: AppSource;
    description?: string;
    walletObjectId?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    setCors(res, 'POST, OPTIONS');

    if (handleOptions(req, res)) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { email, amount, app, description, walletObjectId } = req.body as ChargeRequest;
        const parsedAmount = parsePositiveAmount(amount);

        // Validation - need either email OR walletObjectId.
        if (!email && !walletObjectId) {
            return res.status(400).json({ error: 'Email o walletObjectId requerido' });
        }
        if (!parsedAmount) {
            return res.status(400).json({ error: 'Monto inválido' });
        }
        if (!app) {
            return res.status(400).json({ error: 'App de origen requerida' });
        }

        const config = loadConfig();
        const smaqBank = new SmaqBank(config);

        let userEmail = normalizeEmail(email);
        if (!userEmail && walletObjectId) {
            userEmail = await resolveEmailFromWalletObjectId(walletObjectId);
        }

        if (!userEmail) {
            return res.status(400).json({
                error: 'No se pudo identificar al usuario. Probá con búsqueda manual.'
            });
        }

        // Attempt charge
        const result = await smaqBank.charge(
            userEmail,
            parsedAmount,
            app,
            description || `Consumo de ${parsedAmount} ABA`,
            walletObjectId
        );

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error,
                balance: result.newBalance
            });
        }

        await syncWalletBalanceIfPresent(walletObjectId, result.newBalance);

        return res.status(200).json({
            success: true,
            newBalance: result.newBalance,
            transactionId: result.transactionId,
            message: `Cobro exitoso. Nuevo saldo: ${result.newBalance} ABA`
        });

    } catch (error) {
        console.error('ABA charge error:', error);
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Error interno'
        });
    }
}
