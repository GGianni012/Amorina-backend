import type { VercelRequest, VercelResponse } from '@vercel/node';

import { PosService } from '../../../pos-service/service.js';

import { resolveEmailFromWalletObjectId, syncWalletBalanceIfPresent } from '../../smaq/_endpoint-utils';

import { handleOptions, parseNullableString, parsePositiveNumber, requireMethod, setPosCors } from '../_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    setPosCors(res, 'POST, OPTIONS');
    if (handleOptions(req, res)) return;
    if (!requireMethod(req, res, 'POST')) return;

    try {
        const sessionId = parseNullableString(req.body?.sessionId);
        const walletObjectId = parseNullableString(req.body?.walletObjectId);

        if (!sessionId || !walletObjectId) {
            return res.status(400).json({ success: false, error: 'sessionId y walletObjectId requeridos' });
        }

        const email = await resolveEmailFromWalletObjectId(walletObjectId);
        if (!email) {
            return res.status(400).json({ success: false, error: 'No se pudo resolver el walletObjectId' });
        }

        const service = new PosService();
        const details = await service.chargeAbaByWallet(
            sessionId,
            email,
            walletObjectId,
            parsePositiveNumber(req.body?.amountArs) || undefined,
            parsePositiveNumber(req.body?.amountAba) || undefined,
            parseNullableString(req.body?.createdByAuthId)
        );

        const payment = details.payments[0];
        const newBalance = (payment?.metadata?.newBalance as number | undefined) || null;
        if (typeof newBalance === 'number') {
            await syncWalletBalanceIfPresent(walletObjectId, newBalance);
        }

        return res.status(200).json({ success: true, details });
    } catch (error) {
        console.error('POS ABA wallet error:', error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Error interno',
        });
    }
}
