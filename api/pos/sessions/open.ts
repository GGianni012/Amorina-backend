import type { VercelRequest, VercelResponse } from '@vercel/node';

import { PosService } from '../../../pos-service/service.js';

import { handleOptions, parseNullableString, parseNumber, requireMethod, setPosCors } from '../_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    setPosCors(res, 'POST, OPTIONS');
    if (handleOptions(req, res)) return;
    if (!requireMethod(req, res, 'POST')) return;

    try {
        const tableId = parseNullableString(req.body?.tableId);
        if (!tableId) {
            return res.status(400).json({ success: false, error: 'tableId requerido' });
        }

        const service = new PosService();
        const details = await service.openSession({
            tableId,
            guestCount: Math.max(0, parseNumber(req.body?.guestCount) || 0),
            note: parseNullableString(req.body?.note) || undefined,
            openedByAuthId: parseNullableString(req.body?.openedByAuthId) || undefined,
            assignedWaiterAuthId: parseNullableString(req.body?.assignedWaiterAuthId) || undefined,
        });

        return res.status(200).json({ success: true, details });
    } catch (error) {
        console.error('POS open session error:', error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Error interno',
        });
    }
}
