import type { VercelRequest, VercelResponse } from '@vercel/node';

import { PosService } from '../../../pos-service/service.js';

import { handleOptions, parseNullableString, parsePositiveNumber, requireMethod, setPosCors } from '../_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    setPosCors(res, 'POST, OPTIONS');
    if (handleOptions(req, res)) return;
    if (!requireMethod(req, res, 'POST')) return;

    try {
        const sessionId = parseNullableString(req.body?.sessionId);
        const tagId = parseNullableString(req.body?.tagId);

        if (!sessionId || !tagId) {
            return res.status(400).json({ success: false, error: 'sessionId y tagId requeridos' });
        }

        const service = new PosService();
        const details = await service.chargeAbaByTag(
            sessionId,
            tagId,
            parsePositiveNumber(req.body?.amountArs) || undefined,
            parsePositiveNumber(req.body?.amountAba) || undefined,
            parseNullableString(req.body?.createdByAuthId)
        );

        return res.status(200).json({ success: true, details });
    } catch (error) {
        console.error('POS ABA NFC error:', error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Error interno',
        });
    }
}
