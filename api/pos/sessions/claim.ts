import type { VercelRequest, VercelResponse } from '@vercel/node';

import { PosService } from '../../../pos-service/service.js';

import { handleOptions, parseNullableString, requireMethod, setPosCors } from '../_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    setPosCors(res, 'POST, OPTIONS');
    if (handleOptions(req, res)) return;
    if (!requireMethod(req, res, 'POST')) return;

    try {
        const claimToken = parseNullableString(req.body?.claimToken);
        if (!claimToken) {
            return res.status(400).json({ success: false, error: 'claimToken requerido' });
        }

        const service = new PosService();
        const details = await service.claimTable({
            claimToken,
            authUserId: parseNullableString(req.body?.authUserId),
            citizenId: parseNullableString(req.body?.citizenId),
            guestToken: parseNullableString(req.body?.guestToken),
            displayName: parseNullableString(req.body?.displayName),
            joinMethod: (req.body?.joinMethod as 'qr' | 'nfc' | 'staff' | undefined) || 'qr',
            createSessionIfMissing: req.body?.createSessionIfMissing !== false,
        });

        return res.status(200).json({ success: true, details });
    } catch (error) {
        console.error('POS claim session error:', error);
        const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === 'number'
            ? Number((error as { statusCode?: unknown }).statusCode)
            : 500;
        return res.status(statusCode).json({
            success: false,
            error: error instanceof Error ? error.message : 'Error interno',
        });
    }
}
