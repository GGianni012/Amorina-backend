import type { VercelRequest, VercelResponse } from '@vercel/node';

import { PosService } from '../pos-service/service.js';
import type { OrderItemInput } from '../pos-service/types.js';
import {
    handleOptions,
    parseNullableString,
    parseNumber,
    parsePositiveNumber,
    requireMethod,
    setPosCors,
} from './pos/_utils.js';

function getRoute(req: VercelRequest): string {
    const raw = req.query.route;
    if (Array.isArray(raw)) {
        return raw.filter(Boolean).join('/');
    }
    if (typeof raw === 'string') {
        return raw.replace(/^\/+|\/+$/g, '');
    }
    return '';
}

function getQueryString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function badRequest(res: VercelResponse, error: string) {
    return res.status(400).json({ success: false, error });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    setPosCors(res, 'GET, POST, OPTIONS');
    if (handleOptions(req, res)) return;

    const route = getRoute(req);
    const service = new PosService();

    try {
        switch (route) {
            case '':
            case 'bootstrap': {
                if (!requireMethod(req, res, 'GET')) return;
                const floorCode = getQueryString(req.query.floorCode);
                const audience = req.query.audience === 'client' ? 'client' : 'staff';
                const bootstrap = await service.getBootstrap(floorCode, audience);
                return res.status(200).json({ success: true, ...bootstrap });
            }

            case 'floors': {
                if (!requireMethod(req, res, 'GET')) return;
                const floors = await service.getFloors();
                return res.status(200).json({ success: true, floors });
            }

            case 'menu': {
                if (!requireMethod(req, res, 'GET')) return;
                const audience = req.query.audience === 'client' ? 'client' : req.query.audience === 'all' ? 'all' : 'staff';
                const categories = await service.getMenu(audience);
                return res.status(200).json({ success: true, categories });
            }

            case 'tables': {
                if (!requireMethod(req, res, 'GET')) return;
                const floorCode = getQueryString(req.query.floorCode);
                const tables = await service.getTables(floorCode);
                return res.status(200).json({ success: true, tables });
            }

            case 'dashboard-summary': {
                if (!requireMethod(req, res, 'GET')) return;
                const floorCode = getQueryString(req.query.floorCode);
                const summary = await service.getDashboardSummary(floorCode);
                return res.status(200).json({ success: true, summary });
            }

            case 'sessions/open': {
                if (!requireMethod(req, res, 'POST')) return;
                const tableId = parseNullableString(req.body?.tableId);
                if (!tableId) return badRequest(res, 'tableId requerido');

                const details = await service.openSession({
                    tableId,
                    guestCount: Math.max(0, parseNumber(req.body?.guestCount) || 0),
                    note: parseNullableString(req.body?.note) || undefined,
                    openedByAuthId: parseNullableString(req.body?.openedByAuthId) || undefined,
                    assignedWaiterAuthId: parseNullableString(req.body?.assignedWaiterAuthId) || undefined,
                });

                return res.status(200).json({ success: true, details });
            }

            case 'sessions/details': {
                if (!requireMethod(req, res, 'GET')) return;
                const sessionId = getQueryString(req.query.sessionId);
                const tableId = getQueryString(req.query.tableId);
                if (!sessionId && !tableId) return badRequest(res, 'sessionId o tableId requerido');

                const details = await service.getSessionDetails({ sessionId, tableId });
                return res.status(200).json({ success: true, details });
            }

            case 'sessions/claim': {
                if (!requireMethod(req, res, 'POST')) return;
                const claimToken = parseNullableString(req.body?.claimToken);
                if (!claimToken) return badRequest(res, 'claimToken requerido');

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
            }

            case 'sessions/request-check': {
                if (!requireMethod(req, res, 'POST')) return;
                const sessionId = parseNullableString(req.body?.sessionId);
                if (!sessionId) return badRequest(res, 'sessionId requerido');

                const details = await service.requestCheck(sessionId);
                return res.status(200).json({ success: true, details });
            }

            case 'sessions/mark-attended': {
                if (!requireMethod(req, res, 'POST')) return;
                const sessionId = parseNullableString(req.body?.sessionId);
                if (!sessionId) return badRequest(res, 'sessionId requerido');

                const details = await service.markAttended(sessionId);
                return res.status(200).json({ success: true, details });
            }

            case 'sessions/close': {
                if (!requireMethod(req, res, 'POST')) return;
                const sessionId = parseNullableString(req.body?.sessionId);
                if (!sessionId) return badRequest(res, 'sessionId requerido');

                const details = await service.closeSession(sessionId, parseNullableString(req.body?.closedByAuthId));
                return res.status(200).json({ success: true, details });
            }

            case 'orders/upsert-items': {
                if (!requireMethod(req, res, 'POST')) return;
                const sessionId = parseNullableString(req.body?.sessionId);
                if (!sessionId) return badRequest(res, 'sessionId requerido');

                const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
                if (rawItems.length === 0) return badRequest(res, 'items requerido');

                const items: OrderItemInput[] = rawItems.map((item: any) => ({
                    menuItemId: parseNullableString(item?.menuItemId),
                    itemCode: parseNullableString(item?.itemCode),
                    itemName: parseNullableString(item?.itemName),
                    categoryCode: parseNullableString(item?.categoryCode),
                    quantity: Number(item?.quantity || 0),
                    unitPriceArs: item?.unitPriceArs === undefined ? null : Number(item.unitPriceArs),
                    note: parseNullableString(item?.note),
                }));

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
            }

            case 'orders/update-item': {
                if (!requireMethod(req, res, 'POST')) return;
                const itemId = parseNullableString(req.body?.itemId);
                if (!itemId) return badRequest(res, 'itemId requerido');

                const details = await service.updateOrderItem({
                    itemId,
                    quantity: req.body?.quantity === undefined ? undefined : Number(req.body.quantity),
                    note: req.body?.note === undefined ? undefined : parseNullableString(req.body.note),
                    status: req.body?.status === 'voided' ? 'voided' : req.body?.status === 'active' ? 'active' : undefined,
                });

                return res.status(200).json({ success: true, details });
            }

            case 'payments/transfer': {
                if (!requireMethod(req, res, 'POST')) return;
                const sessionId = parseNullableString(req.body?.sessionId);
                if (!sessionId) return badRequest(res, 'sessionId requerido');

                const payment = await service.createTransferPayment(
                    sessionId,
                    parsePositiveNumber(req.body?.amountArs) || undefined,
                    parseNullableString(req.body?.createdByAuthId)
                );

                return res.status(200).json({ success: true, payment });
            }

            case 'payments/app-transfer': {
                if (!requireMethod(req, res, 'POST')) return;
                const sessionId = parseNullableString(req.body?.sessionId);
                if (!sessionId) return badRequest(res, 'sessionId requerido');

                const payment = await service.createAppTransferPayment(
                    sessionId,
                    parsePositiveNumber(req.body?.amountArs) || undefined,
                    parseNullableString(req.body?.createdByAuthId)
                );

                return res.status(200).json({ success: true, payment });
            }

            case 'payments/mercadopago-checkout': {
                if (!requireMethod(req, res, 'POST')) return;
                const sessionId = parseNullableString(req.body?.sessionId);
                if (!sessionId) return badRequest(res, 'sessionId requerido');

                try {
                    const payment = await service.createMercadoPagoCheckoutPayment(
                        sessionId,
                        parseNullableString(req.body?.createdByAuthId)
                    );
                    return res.status(200).json({ success: true, payment });
                } catch (mpError) {
                    const message = mpError instanceof Error ? mpError.message : 'Error de MercadoPago';
                    console.error('MercadoPago checkout error:', mpError);
                    return res.status(502).json({ success: false, error: `MercadoPago: ${message}` });
                }
            }

            case 'payments/confirm-transfer': {
                if (!requireMethod(req, res, 'POST')) return;
                const paymentIntentId = parseNullableString(req.body?.paymentIntentId);
                if (!paymentIntentId) return badRequest(res, 'paymentIntentId requerido');

                const details = await service.confirmTransfer(
                    paymentIntentId,
                    parseNullableString(req.body?.confirmedByAuthId),
                    parseNullableString(req.body?.proofUrl)
                );

                return res.status(200).json({ success: true, details });
            }

            case 'payments/aba-nfc': {
                if (!requireMethod(req, res, 'POST')) return;
                const sessionId = parseNullableString(req.body?.sessionId);
                const tagId = parseNullableString(req.body?.tagId);
                if (!sessionId || !tagId) return badRequest(res, 'sessionId y tagId requeridos');

                const details = await service.chargeAbaByTag(
                    sessionId,
                    tagId,
                    parsePositiveNumber(req.body?.amountArs) || undefined,
                    parsePositiveNumber(req.body?.amountAba) || undefined,
                    parseNullableString(req.body?.createdByAuthId)
                );

                return res.status(200).json({ success: true, details });
            }

            case 'payments/aba-wallet': {
                if (!requireMethod(req, res, 'POST')) return;
                const sessionId = parseNullableString(req.body?.sessionId);
                const email = parseNullableString(req.body?.email);
                const walletObjectId = parseNullableString(req.body?.walletObjectId);
                if (!sessionId || !email || !walletObjectId) {
                    return badRequest(res, 'sessionId, email y walletObjectId requeridos');
                }

                const details = await service.chargeAbaByWallet(
                    sessionId,
                    email,
                    walletObjectId,
                    parsePositiveNumber(req.body?.amountArs) || undefined,
                    parsePositiveNumber(req.body?.amountAba) || undefined,
                    parseNullableString(req.body?.createdByAuthId)
                );

                return res.status(200).json({ success: true, details });
            }

            case 'payments/app-aba': {
                if (!requireMethod(req, res, 'POST')) return;
                const sessionId = parseNullableString(req.body?.sessionId);
                const email = parseNullableString(req.body?.email);
                if (!sessionId || !email) return badRequest(res, 'sessionId y email requeridos');

                const details = await service.chargeAbaFromApp(
                    sessionId,
                    email,
                    parsePositiveNumber(req.body?.amountArs) || undefined,
                    parsePositiveNumber(req.body?.amountAba) || undefined,
                    parseNullableString(req.body?.citizenId)
                );

                return res.status(200).json({ success: true, details });
            }

            default:
                return res.status(404).json({ success: false, error: 'Ruta POS no encontrada' });
        }
    } catch (error) {
        console.error(`POS route error (${route || 'bootstrap'}):`, error);
        const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === 'number'
            ? Number((error as { statusCode?: unknown }).statusCode)
            : 500;
        return res.status(statusCode).json({
            success: false,
            error: error instanceof Error ? error.message : 'Error interno',
        });
    }
}
