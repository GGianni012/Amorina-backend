import type { VercelRequest, VercelResponse } from '@vercel/node';

import { PosService } from '../../../pos-service/service.js';

import { handleOptions, requireMethod, setPosCors } from '../_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    setPosCors(res, 'GET, OPTIONS');
    if (handleOptions(req, res)) return;
    if (!requireMethod(req, res, 'GET')) return;

    try {
        const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : null;
        const tableId = typeof req.query.tableId === 'string' ? req.query.tableId : null;
        if (!sessionId && !tableId) {
            return res.status(400).json({ success: false, error: 'sessionId o tableId requerido' });
        }

        const service = new PosService();
        const details = await service.getSessionDetails({ sessionId, tableId });
        return res.status(200).json({ success: true, details });
    } catch (error) {
        console.error('POS session details error:', error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Error interno',
        });
    }
}
