import type { VercelRequest, VercelResponse } from '@vercel/node';

import { PosService } from '../../../pos-service/service.js';

import { handleOptions, parseNullableString, requireMethod, setPosCors } from '../_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    setPosCors(res, 'POST, OPTIONS');
    if (handleOptions(req, res)) return;
    if (!requireMethod(req, res, 'POST')) return;

    try {
        const sessionId = parseNullableString(req.body?.sessionId);
        if (!sessionId) {
            return res.status(400).json({ success: false, error: 'sessionId requerido' });
        }

        const service = new PosService();
        const details = await service.closeSession(sessionId, parseNullableString(req.body?.closedByAuthId));
        return res.status(200).json({ success: true, details });
    } catch (error) {
        console.error('POS close session error:', error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Error interno',
        });
    }
}
