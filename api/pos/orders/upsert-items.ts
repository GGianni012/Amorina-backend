import type { VercelRequest, VercelResponse } from '@vercel/node';

import { PosService } from '../../../pos-service/service.js';
import type { OrderItemInput } from '../../../pos-service/types.js';

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

        const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
        if (rawItems.length === 0) {
            return res.status(400).json({ success: false, error: 'items requerido' });
        }

        const items: OrderItemInput[] = rawItems.map((item: any) => ({
            menuItemId: parseNullableString(item?.menuItemId),
            itemCode: parseNullableString(item?.itemCode),
            itemName: parseNullableString(item?.itemName),
            categoryCode: parseNullableString(item?.categoryCode),
            quantity: Number(item?.quantity || 0),
            unitPriceArs: item?.unitPriceArs === undefined ? null : Number(item.unitPriceArs),
            note: parseNullableString(item?.note),
        }));

        const service = new PosService();
        const details = await service.upsertOrderItems({
            sessionId,
            orderId: parseNullableString(req.body?.orderId),
            source: req.body?.source === 'client' ? 'client' : 'staff',
            createdByAuthId: parseNullableString(req.body?.createdByAuthId),
            createdByCitizenId: parseNullableString(req.body?.createdByCitizenId),
            note: parseNullableString(req.body?.note),
            items,
        });

        return res.status(200).json({ success: true, details });
    } catch (error) {
        console.error('POS upsert items error:', error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Error interno',
        });
    }
}
