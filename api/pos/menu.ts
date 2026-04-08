import type { VercelRequest, VercelResponse } from '@vercel/node';

import { PosService } from '../../pos-service/service.js';

import { handleOptions, requireMethod, setPosCors } from './_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    setPosCors(res, 'GET, OPTIONS');
    if (handleOptions(req, res)) return;
    if (!requireMethod(req, res, 'GET')) return;

    try {
        const service = new PosService();
        const audience = req.query.audience === 'client' ? 'client' : req.query.audience === 'all' ? 'all' : 'staff';
        const categories = await service.getMenu(audience);
        return res.status(200).json({ success: true, categories });
    } catch (error) {
        console.error('POS menu error:', error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Error interno',
        });
    }
}
