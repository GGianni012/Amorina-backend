import type { VercelRequest, VercelResponse } from '@vercel/node';

import { PosService } from '../../pos-service/service.js';

import { handleOptions, requireMethod, setPosCors } from './_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    setPosCors(res, 'GET, OPTIONS');
    if (handleOptions(req, res)) return;
    if (!requireMethod(req, res, 'GET')) return;

    try {
        const service = new PosService();
        const floorCode = typeof req.query.floorCode === 'string' ? req.query.floorCode : null;
        const audience = req.query.audience === 'client' ? 'client' : 'staff';
        const bootstrap = await service.getBootstrap(floorCode, audience);
        return res.status(200).json({ success: true, ...bootstrap });
    } catch (error) {
        console.error('POS bootstrap error:', error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Error interno',
        });
    }
}
