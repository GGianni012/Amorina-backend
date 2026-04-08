import type { VercelRequest, VercelResponse } from '@vercel/node';

import { PosService } from '../../../pos-service/service.js';

import { handleOptions, parseNullableString, requireMethod, setPosCors } from '../_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    setPosCors(res, 'POST, OPTIONS');
    if (handleOptions(req, res)) return;
    if (!requireMethod(req, res, 'POST')) return;

    try {
        const itemId = parseNullableString(req.body?.itemId);
        if (!itemId) {
            return res.status(400).json({ success: false, error: 'itemId requerido' });
        }

        const service = new PosService();
        const details = await service.updateOrderItem({
            itemId,
            quantity: req.body?.quantity === undefined ? undefined : Number(req.body.quantity),
            note: req.body?.note === undefined ? undefined : parseNullableString(req.body.note),
            status: req.body?.status === 'voided' ? 'voided' : req.body?.status === 'active' ? 'active' : undefined,
        });

        return res.status(200).json({ success: true, details });
    } catch (error) {
        console.error('POS update item error:', error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Error interno',
        });
    }
}
