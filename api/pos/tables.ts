import type { VercelRequest, VercelResponse } from '@vercel/node';

import { PosService } from '../../pos-service/service.js';

import { handleOptions, requireMethod, setPosCors } from './_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    setPosCors(res, 'GET, OPTIONS');
    if (handleOptions(req, res)) return;
    if (!requireMethod(req, res, 'GET')) return;

    try {
        const floorCode = typeof req.query.floorCode === 'string' ? req.query.floorCode : null;
        const service = new PosService();
        const tables = await service.getTables(floorCode);
        return res.status(200).json({ success: true, tables });
    } catch (error) {
        console.error('POS tables error:', error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Error interno',
        });
    }
}
