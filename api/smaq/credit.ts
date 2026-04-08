/**
 * ABA API - Credit Endpoint
 * POST /api/smaq/credit
 * 
 * Body: { email, amount, source, description }
 * 
 * Used by: MP Webhook, Admin, Subscription renewal
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SmaqBank, type TransactionSource } from '../../smaq-service';
import { loadConfig } from '../../core';
import {
    handleOptions,
    normalizeEmail,
    parsePositiveAmount,
    setCors,
    syncWalletBalanceIfPresent
} from './_endpoint-utils';

interface CreditRequest {
    email: string;
    amount: number | string;
    source: TransactionSource;
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
        const { email, amount, source, description, walletObjectId } = req.body as CreditRequest;
        const normalizedEmail = normalizeEmail(email);
        const parsedAmount = parsePositiveAmount(amount);

        // Validation
        if (!normalizedEmail) {
            return res.status(400).json({ error: 'Email requerido' });
        }
        if (!parsedAmount) {
            return res.status(400).json({ error: 'Monto inválido' });
        }
        if (!source) {
            return res.status(400).json({ error: 'Fuente requerida' });
        }

        const config = loadConfig();
        const smaqBank = new SmaqBank(config);

        // Credit the account
        const result = await smaqBank.credit(
            normalizedEmail,
            parsedAmount,
            source,
            'system',
            description || `Acreditación de ${parsedAmount} ABA`,
            walletObjectId
        );

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error || 'No se pudo acreditar ABA',
                balance: result.newBalance
            });
        }

        await syncWalletBalanceIfPresent(walletObjectId, result.newBalance);

        return res.status(200).json({
            success: true,
            newBalance: result.newBalance,
            transactionId: result.transactionId,
            message: `Acreditación exitosa. Nuevo saldo: ${result.newBalance} ABA`
        });

    } catch (error) {
        console.error('ABA credit error:', error);
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Error interno'
        });
    }
}
