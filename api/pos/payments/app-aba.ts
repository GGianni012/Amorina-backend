import type { VercelRequest, VercelResponse } from '@vercel/node';

import { PosService } from '../../../pos-service/service.js';

import { handleOptions, parseNullableString, parsePositiveNumber, requireMethod, setPosCors } from '../_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    setPosCors(res, 'POST, OPTIONS');
    if (handleOptions(req, res)) return;
    if (!requireMethod(req, res, 'POST')) return;

    try {
        const sessionId = parseNullableString(req.body?.sessionId);
        const email = parseNullableString(req.body?.email);

        if (!sessionId || !email) {
            return res.status(400).json({ success: false, error: 'sessionId y email requeridos' });
        }

        const service = new PosService();
        const details = await service.chargeAbaFromApp(
            sessionId,
            email,
            parsePositiveNumber(req.body?.amountArs) || undefined,
            parsePositiveNumber(req.body?.amountAba) || undefined,
            parseNullableString(req.body?.citizenId)
        );

        return res.status(200).json({ success: true, details });
    } catch (error) {
        console.error('POS app ABA error:', error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Error interno',
        });
    }
}
