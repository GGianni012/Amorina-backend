import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { MercadoPagoConfig, Preference } from 'mercadopago';

import { loadConfig, type AmorinConfig, type PaymentStatus } from '../core/index.js';
import { SmaqBank, SMAQ_EXCHANGE_RATE } from '../smaq-service/bank.js';

import type {
    ClaimTableInput,
    MercadoPagoCheckoutResult,
    PosDashboardSummary,
    OpenSessionInput,
    PosMenuAudience,
    PosFloor,
    PosMenuCategory,
    PosMenuItem,
    PosOrder,
    PosOrderItem,
    PosPaymentIntent,
    PosSession,
    PosSessionDetails,
    PosSessionGuest,
    PosTableSummary,
    TransferPaymentResult,
    UpdateOrderItemInput,
    UpsertOrderItemsInput,
} from './types.js';

interface SessionLocator {
    sessionId?: string | null;
    tableId?: string | null;
}

interface ChargeAbaInput {
    sessionId: string;
    email: string;
    method: 'aba_nfc' | 'aba_wallet' | 'app_aba';
    amountArs?: number;
    amountAba?: number;
    citizenId?: string | null;
    createdByAuthId?: string | null;
    confirmedByAuthId?: string | null;
    walletObjectId?: string | null;
    nfcTagId?: string | null;
    metadata?: Record<string, unknown>;
}

const MAX_TABLES_PER_FLOOR = 10;

export class PosConflictError extends Error {
    readonly statusCode = 409;

    constructor(message: string) {
        super(message);
        this.name = 'PosConflictError';
    }
}

export class PosService {
    private readonly config: AmorinConfig;
    private readonly supabase: SupabaseClient;
    private readonly smaqBank: SmaqBank;

    constructor(config: AmorinConfig = loadConfig()) {
        this.config = config;
        this.supabase = createClient(config.supabase.url, config.supabase.serviceKey);
        this.smaqBank = new SmaqBank(config);
    }

    async getFloors(): Promise<PosFloor[]> {
        const { data, error } = await this.supabase
            .from('pos_floors')
            .select('*')
            .eq('is_active', true)
            .order('sort_order', { ascending: true });

        if (error) throw new Error(error.message);
        return (data || []).map(mapFloor);
    }

    async getMenu(audience: PosMenuAudience = 'all'): Promise<PosMenuCategory[]> {
        const visibilityColumn = audience === 'staff'
            ? 'visible_in_staff'
            : audience === 'client'
                ? 'visible_in_client'
                : null;

        let categoriesQuery = this.supabase
            .from('pos_menu_categories')
            .select('*')
            .eq('is_active', true)
            .order('sort_order', { ascending: true });

        let itemsQuery = this.supabase
            .from('pos_menu_items')
            .select('*')
            .eq('is_available', true)
            .order('sort_order', { ascending: true });

        if (visibilityColumn) {
            itemsQuery = itemsQuery.eq(visibilityColumn, true);
        }

        const [{ data: categories, error: categoriesError }, { data: items, error: itemsError }] = await Promise.all([
            categoriesQuery,
            itemsQuery,
        ]);

        if (categoriesError) throw new Error(categoriesError.message);
        if (itemsError) throw new Error(itemsError.message);

        const itemMap = new Map<string, PosMenuItem[]>();
        for (const row of items || []) {
            const item = mapMenuItem(row, audience === 'staff');
            const key = item.categoryId || '__uncategorized__';
            const bucket = itemMap.get(key) || [];
            bucket.push(item);
            itemMap.set(key, bucket);
        }

        return (categories || []).map((row) => {
            const category = mapMenuCategory(row);
            category.items = itemMap.get(category.id) || [];
            return category;
        });
    }

    async getTables(floorCode?: string | null): Promise<PosTableSummary[]> {
        const floors = await this.getFloors();
        const floorById = new Map(floors.map((floor) => [floor.id, floor]));
        const floorId = floorCode ? floors.find((floor) => floor.code === floorCode)?.id : null;

        let query = this.supabase
            .from('pos_table_live_status')
            .select('*')
            .eq('is_active', true)
            .lte('table_number', MAX_TABLES_PER_FLOOR)
            .order('table_number', { ascending: true });

        if (floorId) {
            query = query.eq('floor_id', floorId);
        }

        const { data, error } = await query;
        if (error) throw new Error(error.message);

        const tables = (data || []).map((row) => {
            const table = mapTableSummary(row);
            const floor = floorById.get(table.floorId);
            if (floor) {
                table.floorCode = floor.code;
                table.floorName = floor.name;
            }
            return table;
        });

        return this.enrichTablesWithAttention(tables);
    }

    async getBootstrap(floorCode?: string | null, menuAudience: PosMenuAudience = 'staff') {
        const [floors, menu, tables] = await Promise.all([
            this.getFloors(),
            this.getMenu(menuAudience),
            this.getTables(floorCode || null),
        ]);

        return {
            floors,
            activeFloorCode: floorCode || floors[0]?.code || null,
            menu,
            tables,
        };
    }

    async getDashboardSummary(floorCode?: string | null): Promise<PosDashboardSummary> {
        const floorId = floorCode ? await this.getFloorIdByCode(floorCode) : null;
        const activeTableIds = await this.getActiveTableIds(floorId);
        const liveTables = await this.getTables(floorCode || null);
        const liveOpenArs = roundMoney(
            liveTables.reduce((sum, table) => sum + (table.sessionId ? table.subtotalArs : 0), 0)
        );

        const { startIso, endIso } = getBuenosAiresDayRange();

        let closedSessionsQuery = this.supabase
            .from('pos_table_sessions')
            .select('id')
            .eq('status', 'closed')
            .gte('closed_at', startIso)
            .lte('closed_at', endIso);

        if (!activeTableIds.length) {
            return {
                tableCount: liveTables.length,
                occupiedTableCount: liveTables.filter((table) => table.sessionId).length,
                requestedTableCount: liveTables.filter((table) => table.sessionStatus === 'checkout_requested').length,
                pendingTransferTableCount: liveTables.filter((table) => table.hasPendingTransfer).length,
                liveOpenArs,
                closedArs: 0,
                grandTotalArs: liveOpenArs,
                closedSessionCount: 0,
                updatedAt: new Date().toISOString(),
            };
        }

        closedSessionsQuery = closedSessionsQuery.in('table_id', activeTableIds);

        const { data: closedSessions, error: closedSessionsError } = await closedSessionsQuery;
        if (closedSessionsError) throw new Error(closedSessionsError.message);

        const closedSessionIds = (closedSessions || []).map((row) => row.id);
        let closedArs = 0;

        if (closedSessionIds.length) {
            const { data: closedPayments, error: closedPaymentsError } = await this.supabase
                .from('pos_payment_intents')
                .select('amount_ars, tip_ars')
                .eq('status', 'confirmed')
                .in('session_id', closedSessionIds);

            if (closedPaymentsError) throw new Error(closedPaymentsError.message);

            closedArs = roundMoney(
                (closedPayments || []).reduce((sum, payment) => (
                    sum + Number(payment.amount_ars || 0) + Number(payment.tip_ars || 0)
                ), 0)
            );
        }

        return {
            tableCount: liveTables.length,
            occupiedTableCount: liveTables.filter((table) => table.sessionId).length,
            requestedTableCount: liveTables.filter((table) => table.sessionStatus === 'checkout_requested').length,
            pendingTransferTableCount: liveTables.filter((table) => table.hasPendingTransfer).length,
            liveOpenArs,
            closedArs,
            grandTotalArs: roundMoney(liveOpenArs + closedArs),
            closedSessionCount: closedSessionIds.length,
            updatedAt: new Date().toISOString(),
        };
    }

    async openSession(input: OpenSessionInput): Promise<PosSessionDetails> {
        const existing = await this.getActiveSessionForTable(input.tableId);
        if (existing?.sessionId) {
            return this.getSessionDetails({ sessionId: existing.sessionId });
        }

        const payload = {
            table_id: input.tableId,
            status: 'open',
            guest_count: Math.max(0, input.guestCount || 0),
            note: normalizeNullableText(input.note),
            opened_by_auth_id: input.openedByAuthId || null,
            assigned_waiter_auth_id: input.assignedWaiterAuthId || input.openedByAuthId || null,
        };

        const { data, error } = await this.supabase
            .from('pos_table_sessions')
            .insert(payload)
            .select('id')
            .single();

        if (error || !data) throw new Error(error?.message || 'No se pudo abrir la mesa');
        return this.getSessionDetails({ sessionId: data.id });
    }

    async claimTable(input: ClaimTableInput): Promise<PosSessionDetails> {
        const claimToken = input.claimToken.trim().toUpperCase();
        const guestToken = normalizeNullableText(input.guestToken);
        const displayName = normalizeNullableText(input.displayName);
        const { data: table, error: tableError } = await this.supabase
            .from('pos_tables')
            .select('id')
            .eq('claim_token', claimToken)
            .eq('is_active', true)
            .single();

        if (tableError || !table) throw new Error('Mesa no encontrada');

        let active = await this.getActiveSessionForTable(table.id);
        if (!active?.sessionId) {
            if (!input.createSessionIfMissing) {
                throw new Error('La mesa no tiene una sesion activa');
            }
            const opened = await this.openSession({ tableId: table.id, guestCount: 1 });
            active = { sessionId: opened.session?.id || null };
        }

        const sessionId = active?.sessionId;
        if (!sessionId) throw new Error('No se pudo abrir o encontrar la sesion');

        if (input.authUserId || input.citizenId || guestToken || displayName) {
            const { data: existingGuests, error: guestsError } = await this.supabase
                .from('pos_session_guests')
                .select('*')
                .eq('session_id', sessionId)
                .is('left_at', null)
                .order('joined_at', { ascending: true });

            if (guestsError) throw new Error(guestsError.message);

            const alreadyJoined = (existingGuests || []).find((guest) => this.guestMatchesClaimIdentity(guest, {
                authUserId: input.authUserId,
                citizenId: input.citizenId,
                guestToken,
                displayName,
            }));

            const lockedByAnotherGuest = (existingGuests || []).some((guest) => !this.guestMatchesClaimIdentity(guest, {
                authUserId: input.authUserId,
                citizenId: input.citizenId,
                guestToken,
                displayName,
            }));

            if (lockedByAnotherGuest && !alreadyJoined) {
                throw new PosConflictError('Esta mesa ya esta ocupada por otro usuario');
            }

            if (alreadyJoined) {
                const guestUpdatePayload: Record<string, unknown> = {};
                if (input.authUserId && !alreadyJoined.auth_user_id) {
                    guestUpdatePayload.auth_user_id = input.authUserId;
                }
                if (input.citizenId && !alreadyJoined.citizen_id) {
                    guestUpdatePayload.citizen_id = input.citizenId;
                }
                if (guestToken && !alreadyJoined.guest_token) {
                    guestUpdatePayload.guest_token = guestToken;
                }
                if (displayName && !alreadyJoined.display_name) {
                    guestUpdatePayload.display_name = displayName;
                }

                if (Object.keys(guestUpdatePayload).length) {
                    const { error: updateGuestError } = await this.supabase
                        .from('pos_session_guests')
                        .update(guestUpdatePayload)
                        .eq('id', alreadyJoined.id);

                    if (updateGuestError) throw new Error(updateGuestError.message);
                }
            } else {
                const { error: insertGuestError } = await this.supabase.from('pos_session_guests').insert({
                    session_id: sessionId,
                    auth_user_id: input.authUserId || null,
                    citizen_id: input.citizenId || null,
                    guest_token: guestToken,
                    display_name: displayName,
                    joined_via: input.joinMethod || 'qr',
                });

                if (insertGuestError?.code === '23505') {
                    throw new PosConflictError('Esta mesa ya esta ocupada por otro usuario');
                }
                if (insertGuestError) throw new Error(insertGuestError.message);
            }

            await this.refreshGuestCount(sessionId);
        }

        return this.getSessionDetails({ sessionId });
    }

    async getSessionDetails(locator: SessionLocator): Promise<PosSessionDetails> {
        const tableRow = await this.getTableSummaryByLocator(locator);
        if (!tableRow) throw new Error('Mesa o sesion no encontrada');

        if (!tableRow.sessionId) {
            return {
                table: tableRow,
                session: null,
                guests: [],
                orders: [],
                payments: [],
            };
        }

        const sessionId = tableRow.sessionId;
        const [{ data: sessionRow, error: sessionError }, { data: guestRows, error: guestError }, { data: orderRows, error: orderError }, { data: paymentRows, error: paymentError }] = await Promise.all([
            this.supabase.from('pos_table_sessions').select('*').eq('id', sessionId).single(),
            this.supabase
                .from('pos_session_guests')
                .select('*')
                .eq('session_id', sessionId)
                .is('left_at', null)
                .order('joined_at', { ascending: true }),
            this.supabase
                .from('pos_orders')
                .select('*')
                .eq('session_id', sessionId)
                .order('created_at', { ascending: true }),
            this.supabase
                .from('pos_payment_intents')
                .select('*')
                .eq('session_id', sessionId)
                .order('requested_at', { ascending: false }),
        ]);

        if (sessionError || !sessionRow) throw new Error(sessionError?.message || 'Sesion no encontrada');
        if (guestError) throw new Error(guestError.message);
        if (orderError) throw new Error(orderError.message);
        if (paymentError) throw new Error(paymentError.message);

        const orderIds = (orderRows || []).map((order) => order.id);
        let itemRows: any[] = [];
        if (orderIds.length > 0) {
            const { data, error } = await this.supabase
                .from('pos_order_items')
                .select('*')
                .in('order_id', orderIds)
                .order('created_at', { ascending: true });
            if (error) throw new Error(error.message);
            itemRows = data || [];
        }

        const itemsByOrder = new Map<string, PosOrderItem[]>();
        for (const row of itemRows) {
            const item = mapOrderItem(row);
            const bucket = itemsByOrder.get(item.orderId) || [];
            bucket.push(item);
            itemsByOrder.set(item.orderId, bucket);
        }

        return {
            table: tableRow,
            session: mapSession(sessionRow),
            guests: (guestRows || []).map(mapSessionGuest),
            orders: (orderRows || []).map((row) => {
                const order = mapOrder(row);
                order.items = itemsByOrder.get(order.id) || [];
                return order;
            }),
            payments: (paymentRows || []).map(mapPaymentIntent),
        };
    }

    async upsertOrderItems(input: UpsertOrderItemsInput): Promise<PosSessionDetails> {
        const session = await this.getSessionRecord(input.sessionId);
        if (!session) throw new Error('Sesion no encontrada');
        if (['paid', 'closed', 'cancelled'].includes(session.status)) {
            throw new Error('La sesion no acepta nuevos items');
        }
        if (!input.items.length) throw new Error('No hay items para agregar');

        let orderId = input.orderId || null;
        if (!orderId) {
            const { data: orderRow, error: orderError } = await this.supabase
                .from('pos_orders')
                .insert({
                    session_id: input.sessionId,
                    source: input.source,
                    status: 'sent',
                    created_by_auth_id: input.createdByAuthId || null,
                    created_by_citizen_id: input.createdByCitizenId || null,
                    note: normalizeNullableText(input.note),
                    sent_at: new Date().toISOString(),
                })
                .select('id')
                .single();

            if (orderError || !orderRow) throw new Error(orderError?.message || 'No se pudo crear el pedido');
            orderId = orderRow.id;
        }

        const resolvedItems = await Promise.all(input.items.map((item) => this.resolveOrderItemInput(item)));
        const payload = resolvedItems.map((item) => ({
            order_id: orderId,
            menu_item_id: item.menuItemId,
            item_code: item.itemCode,
            item_name: item.itemName,
            category_code: item.categoryCode,
            quantity: item.quantity,
            unit_price_ars: item.unitPriceArs,
            note: normalizeNullableText(item.note),
            status: 'active',
        }));

        const { error: itemError } = await this.supabase.from('pos_order_items').insert(payload);
        if (itemError) throw new Error(itemError.message);

        return this.getSessionDetails({ sessionId: input.sessionId });
    }

    async updateOrderItem(input: UpdateOrderItemInput): Promise<PosSessionDetails> {
        const { data: itemRow, error: itemError } = await this.supabase
            .from('pos_order_items')
            .select('id, order_id')
            .eq('id', input.itemId)
            .single();

        if (itemError || !itemRow) throw new Error(itemError?.message || 'Item no encontrado');

        const updatePayload: Record<string, unknown> = {};
        if (typeof input.quantity === 'number') {
            if (input.quantity <= 0) {
                updatePayload.status = 'voided';
            } else {
                updatePayload.quantity = input.quantity;
            }
        }
        if (typeof input.status === 'string') {
            updatePayload.status = input.status;
        }
        if (input.note !== undefined) {
            updatePayload.note = normalizeNullableText(input.note);
        }

        const { error: updateError } = await this.supabase
            .from('pos_order_items')
            .update(updatePayload)
            .eq('id', input.itemId);

        if (updateError) throw new Error(updateError.message);

        const { data: orderRow, error: orderError } = await this.supabase
            .from('pos_orders')
            .select('session_id')
            .eq('id', itemRow.order_id)
            .single();

        if (orderError || !orderRow) throw new Error(orderError?.message || 'Pedido no encontrado');
        return this.getSessionDetails({ sessionId: orderRow.session_id });
    }

    async requestCheck(sessionId: string): Promise<PosSessionDetails> {
        const session = await this.getSessionRecord(sessionId);
        if (!session) throw new Error('Sesion no encontrada');
        if (['paid', 'closed', 'cancelled'].includes(session.status)) {
            throw new Error('La sesion ya no puede pedir la cuenta');
        }

        const { error } = await this.supabase
            .from('pos_table_sessions')
            .update({
                status: 'checkout_requested',
                checkout_requested_at: new Date().toISOString(),
            })
            .eq('id', sessionId);

        if (error) throw new Error(error.message);
        return this.getSessionDetails({ sessionId });
    }

    async markAttended(sessionId: string): Promise<PosSessionDetails> {
        const details = await this.getSessionDetails({ sessionId });
        if (!details.session) throw new Error('Sesion no encontrada');

        const pendingOrders = details.orders
            .filter((order) => order.status === 'sent' && order.items.some((item) => item.status === 'active'))
            .map((order) => order.id);

        if (!pendingOrders.length) {
            return details;
        }

        const servedAt = new Date().toISOString();
        const { error } = await this.supabase
            .from('pos_orders')
            .update({
                status: 'served',
                served_at: servedAt,
            })
            .in('id', pendingOrders);

        if (error) throw new Error(error.message);
        return this.getSessionDetails({ sessionId });
    }

    async createTransferPayment(
        sessionId: string,
        amountArs?: number,
        createdByAuthId?: string | null,
        method: 'transfer_alias' | 'app_transfer' = 'transfer_alias'
    ): Promise<TransferPaymentResult> {
        await this.expireStaleTransferPayments();

        const details = await this.getSessionDetails({ sessionId });
        if (!details.session) throw new Error('La sesion no esta activa');

        const due = details.table.balanceDueArs;
        const finalAmountArs = roundMoney(Math.min(amountArs || due, due));
        if (finalAmountArs <= 0) throw new Error('La mesa no tiene saldo pendiente');

        const transferAccount = await this.pickAvailableTransferAccount();
        if (!transferAccount) {
            throw new Error('No hay alias de transferencia disponibles');
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
        const reference = buildTransferReference(details.table.label, now);

        const { data, error } = await this.supabase
            .from('pos_payment_intents')
            .insert({
                session_id: sessionId,
                method,
                status: 'pending',
                amount_ars: finalAmountArs,
                created_by_auth_id: createdByAuthId || null,
                transfer_account_id: transferAccount.id,
                transfer_alias: transferAccount.alias,
                transfer_reference: reference,
                expires_at: expiresAt.toISOString(),
                metadata: {
                    ownerName: transferAccount.ownerName,
                    bankName: transferAccount.bankName,
                    cbuPartial: transferAccount.cbuPartial,
                },
            })
            .select('*')
            .single();

        if (error || !data) throw new Error(error?.message || 'No se pudo crear el cobro por transferencia');
        await this.addPaymentEvent(data.id, 'created', createdByAuthId || null, null, { method });

        return {
            paymentIntentId: data.id,
            alias: transferAccount.alias,
            ownerName: transferAccount.ownerName,
            bankName: transferAccount.bankName,
            cbuPartial: transferAccount.cbuPartial,
            reference,
            amountArs: finalAmountArs,
            expiresAt: expiresAt.toISOString(),
        };
    }

    async confirmTransfer(paymentIntentId: string, confirmedByAuthId?: string | null, proofUrl?: string | null) {
        const payment = await this.getPaymentIntent(paymentIntentId);
        if (!payment) throw new Error('Cobro no encontrado');
        if (!['pending', 'processing'].includes(payment.status)) {
            throw new Error(`El cobro ya esta ${payment.status}`);
        }

        const metadata = { ...(payment.metadata || {}), proofUrl: proofUrl || null };
        const { error } = await this.supabase
            .from('pos_payment_intents')
            .update({
                status: 'confirmed',
                proof_url: proofUrl || null,
                metadata,
                confirmed_by_auth_id: confirmedByAuthId || null,
                confirmed_at: new Date().toISOString(),
            })
            .eq('id', paymentIntentId);

        if (error) throw new Error(error.message);

        await this.addPaymentEvent(paymentIntentId, 'confirmed', confirmedByAuthId || null, null, { proofUrl: proofUrl || null });
        await this.refreshSessionStatus(payment.sessionId);
        return this.getSessionDetails({ sessionId: payment.sessionId });
    }

    async chargeAbaByTag(sessionId: string, tagId: string, amountArs?: number, amountAba?: number, createdByAuthId?: string | null) {
        const lookup = await this.smaqBank.lookupByNfcTag(tagId);
        if (!lookup) throw new Error('Tag NFC no vinculado a ningun ciudadano');

        return this.chargeAba({
            sessionId,
            email: lookup.email,
            citizenId: lookup.citizenId,
            method: 'aba_nfc',
            amountArs,
            amountAba,
            createdByAuthId,
            confirmedByAuthId: createdByAuthId,
            nfcTagId: lookup.tagId,
            metadata: {
                citizenName: lookup.name,
                source: 'nfc_tag',
            },
        });
    }

    async chargeAbaByWallet(sessionId: string, email: string, walletObjectId: string, amountArs?: number, amountAba?: number, createdByAuthId?: string | null) {
        const citizen = await this.findCitizenByEmail(email);
        return this.chargeAba({
            sessionId,
            email,
            citizenId: citizen?.id || null,
            method: 'aba_wallet',
            amountArs,
            amountAba,
            createdByAuthId,
            confirmedByAuthId: createdByAuthId,
            walletObjectId,
            metadata: {
                source: 'wallet',
            },
        });
    }

    async chargeAbaFromApp(sessionId: string, email: string, amountArs?: number, amountAba?: number, citizenId?: string | null) {
        return this.chargeAba({
            sessionId,
            email,
            citizenId: citizenId || null,
            method: 'app_aba',
            amountArs,
            amountAba,
            metadata: {
                source: 'client_app',
            },
        });
    }

    async createAppTransferPayment(sessionId: string, amountArs?: number, createdByAuthId?: string | null): Promise<TransferPaymentResult> {
        return this.createTransferPayment(sessionId, amountArs, createdByAuthId, 'app_transfer');
    }

    async createMercadoPagoCheckoutPayment(sessionId: string, createdByAuthId?: string | null): Promise<MercadoPagoCheckoutResult> {
        const details = await this.getSessionDetails({ sessionId });
        if (!details.session) throw new Error('La sesion no esta activa');

        const baseAmountArs = roundMoney(details.table.balanceDueArs);
        if (baseAmountArs <= 0) throw new Error('La mesa no tiene saldo pendiente');

        const surchargeArs = roundMoney(baseAmountArs * 0.1);
        const totalAmountArs = roundMoney(baseAmountArs + surchargeArs);
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);

        await this.cancelPendingMercadoPagoPayments(sessionId);

        const baseMetadata = {
            purpose: 'pos_payment',
            baseAmountArs,
            surchargeArs,
            totalAmountArs,
            surchargeRate: 0.1,
            tableId: details.table.tableId,
            tableLabel: details.table.label,
        };

        const { data: pendingIntent, error: intentError } = await this.supabase
            .from('pos_payment_intents')
            .insert({
                session_id: sessionId,
                method: 'mercadopago_webhook',
                status: 'pending',
                amount_ars: baseAmountArs,
                tip_ars: surchargeArs,
                created_by_auth_id: createdByAuthId || null,
                expires_at: expiresAt.toISOString(),
                metadata: baseMetadata,
            })
            .select('*')
            .single();

        if (intentError || !pendingIntent) {
            throw new Error(intentError?.message || 'No se pudo iniciar el cobro con MercadoPago');
        }

        const preference = new Preference(new MercadoPagoConfig({
            accessToken: this.config.mercadopago.accessToken,
        }));

        const externalReference = buildPosMercadoPagoReference(pendingIntent.id as string);

        try {
            const preferenceData = await preference.create({
                body: {
                    items: [
                        {
                            id: pendingIntent.id as string,
                            title: `Mesa ${details.table.label}`,
                            description: `Cobro Aquilea 57 + 10% recargo MercadoPago`,
                            category_id: 'food',
                            quantity: 1,
                            currency_id: 'ARS',
                            unit_price: totalAmountArs,
                        },
                    ],
                    back_urls: {
                        success: this.config.urls.successUrl,
                        failure: this.config.urls.failureUrl,
                        pending: this.config.urls.pendingUrl,
                    },
                    auto_return: 'approved',
                    notification_url: this.config.urls.webhookUrl,
                    external_reference: externalReference,
                    metadata: {
                        ...baseMetadata,
                        payment_intent_id: pendingIntent.id,
                        session_id: sessionId,
                    },
                    expires: true,
                    expiration_date_from: now.toISOString(),
                    expiration_date_to: expiresAt.toISOString(),
                },
            });

            const paymentMetadata = {
                ...baseMetadata,
                preferenceId: preferenceData.id || null,
                initPoint: preferenceData.init_point || null,
                sandboxInitPoint: preferenceData.sandbox_init_point || null,
                externalReference,
            };

            const { error: updateError } = await this.supabase
                .from('pos_payment_intents')
                .update({
                    metadata: paymentMetadata,
                })
                .eq('id', pendingIntent.id);

            if (updateError) throw new Error(updateError.message);

            await this.addPaymentEvent(pendingIntent.id as string, 'checkout_created', createdByAuthId || null, null, paymentMetadata);

            return {
                paymentIntentId: pendingIntent.id as string,
                baseAmountArs,
                surchargeArs,
                totalAmountArs,
                preferenceId: preferenceData.id || '',
                initPoint: preferenceData.init_point || '',
                sandboxInitPoint: preferenceData.sandbox_init_point || '',
                externalReference,
            };
        } catch (error) {
            await this.supabase
                .from('pos_payment_intents')
                .update({
                    status: 'failed',
                    metadata: {
                        ...baseMetadata,
                        error: error instanceof Error ? error.message : 'mercadopago_checkout_error',
                    },
                })
                .eq('id', pendingIntent.id);
            throw error;
        }
    }

    async reconcileMercadoPagoWebhook(paymentInfo: {
        id: string;
        status: PaymentStatus;
        externalReference: string;
        transactionAmount: number;
        dateApproved: string | null;
    }): Promise<PosSessionDetails | null> {
        const paymentIntentId = parsePosMercadoPagoReference(paymentInfo.externalReference);
        if (!paymentIntentId) return null;

        const paymentIntent = await this.getPaymentIntent(paymentIntentId);
        if (!paymentIntent || paymentIntent.method !== 'mercadopago_webhook') return null;

        const metadata = {
            ...(paymentIntent.metadata || {}),
            mercadoPagoPaymentId: paymentInfo.id,
            mercadoPagoStatus: paymentInfo.status,
            mercadoPagoTransactionAmount: roundMoney(paymentInfo.transactionAmount),
            mercadoPagoApprovedAt: paymentInfo.dateApproved,
        };

        if (paymentInfo.status === 'APPROVED') {
            if (paymentIntent.status !== 'confirmed') {
                const { error } = await this.supabase
                    .from('pos_payment_intents')
                    .update({
                        status: 'confirmed',
                        confirmed_at: paymentInfo.dateApproved || new Date().toISOString(),
                        metadata,
                    })
                    .eq('id', paymentIntent.id);

                if (error) throw new Error(error.message);
                await this.addPaymentEvent(paymentIntent.id, 'confirmed', null, paymentIntent.citizenId, metadata);
                await this.refreshSessionStatus(paymentIntent.sessionId);
            }

            return this.getSessionDetails({ sessionId: paymentIntent.sessionId });
        }

        if (['REJECTED', 'CANCELLED', 'REFUNDED'].includes(paymentInfo.status)) {
            const nextStatus = paymentInfo.status === 'CANCELLED' ? 'cancelled' : 'failed';
            const { error } = await this.supabase
                .from('pos_payment_intents')
                .update({
                    status: nextStatus,
                    metadata,
                })
                .eq('id', paymentIntent.id);

            if (error) throw new Error(error.message);
            await this.addPaymentEvent(paymentIntent.id, nextStatus, null, paymentIntent.citizenId, metadata);
            return this.getSessionDetails({ sessionId: paymentIntent.sessionId });
        }

        const { error } = await this.supabase
            .from('pos_payment_intents')
            .update({ metadata })
            .eq('id', paymentIntent.id);
        if (error) throw new Error(error.message);

        await this.addPaymentEvent(paymentIntent.id, 'pending_update', null, paymentIntent.citizenId, metadata);
        return this.getSessionDetails({ sessionId: paymentIntent.sessionId });
    }

    async closeSession(sessionId: string, closedByAuthId?: string | null): Promise<PosSessionDetails> {
        const details = await this.getSessionDetails({ sessionId });
        if (!details.session) throw new Error('Sesion no encontrada');
        if (details.table.balanceDueArs > 0) {
            throw new Error('No se puede cerrar una mesa con saldo pendiente');
        }

        const { error } = await this.supabase
            .from('pos_table_sessions')
            .update({
                status: 'closed',
                closed_by_auth_id: closedByAuthId || null,
                closed_at: new Date().toISOString(),
            })
            .eq('id', sessionId);

        if (error) throw new Error(error.message);
        return this.getSessionDetails({ tableId: details.table.tableId });
    }

    private async chargeAba(input: ChargeAbaInput) {
        const details = await this.getSessionDetails({ sessionId: input.sessionId });
        if (!details.session) throw new Error('La sesion no esta activa');

        const dueArs = details.table.balanceDueArs;
        const finalAmountArs = roundMoney(Math.min(input.amountArs || dueArs, dueArs));
        const finalAmountAba = input.amountAba !== undefined
            ? roundMoney(input.amountAba)
            : roundMoney(finalAmountArs / SMAQ_EXCHANGE_RATE);

        if (finalAmountArs <= 0 || finalAmountAba <= 0) {
            throw new Error('Monto invalido para cobrar con ABA');
        }

        const citizen = input.citizenId ? { id: input.citizenId } : await this.findCitizenByEmail(input.email);
        const metadata = { ...(input.metadata || {}) };

        const { data: pendingIntent, error: intentError } = await this.supabase
            .from('pos_payment_intents')
            .insert({
                session_id: input.sessionId,
                method: input.method,
                status: 'processing',
                amount_ars: finalAmountArs,
                amount_aba: finalAmountAba,
                citizen_id: citizen?.id || null,
                created_by_auth_id: input.createdByAuthId || null,
                wallet_object_id: input.walletObjectId || null,
                nfc_tag_id: input.nfcTagId || null,
                metadata,
            })
            .select('*')
            .single();

        if (intentError || !pendingIntent) throw new Error(intentError?.message || 'No se pudo iniciar el cobro ABA');
        await this.addPaymentEvent(pendingIntent.id, 'processing', input.createdByAuthId || null, citizen?.id || null, metadata);

        const chargeResult = await this.smaqBank.charge(
            input.email,
            finalAmountAba,
            'aquilea',
            `POS ${details.table.label} (${finalAmountArs} ARS)`,
            input.walletObjectId || undefined
        );

        if (!chargeResult.success) {
            await this.supabase
                .from('pos_payment_intents')
                .update({
                    status: 'failed',
                    metadata: { ...metadata, error: chargeResult.error || 'unknown_error' },
                })
                .eq('id', pendingIntent.id);
            await this.addPaymentEvent(pendingIntent.id, 'failed', input.createdByAuthId || null, citizen?.id || null, {
                error: chargeResult.error || null,
            });
            throw new Error(chargeResult.error || 'No se pudo cobrar ABA');
        }

        const confirmedMetadata = {
            ...metadata,
            abaTransactionId: chargeResult.transactionId || null,
            newBalance: chargeResult.newBalance,
        };

        const { error: confirmError } = await this.supabase
            .from('pos_payment_intents')
            .update({
                status: 'confirmed',
                confirmed_by_auth_id: input.confirmedByAuthId || null,
                confirmed_at: new Date().toISOString(),
                citizen_id: citizen?.id || null,
                metadata: confirmedMetadata,
            })
            .eq('id', pendingIntent.id);

        if (confirmError) throw new Error(confirmError.message);

        await this.addPaymentEvent(pendingIntent.id, 'confirmed', input.confirmedByAuthId || null, citizen?.id || null, confirmedMetadata);
        await this.refreshSessionStatus(input.sessionId);
        return this.getSessionDetails({ sessionId: input.sessionId });
    }

    private async refreshSessionStatus(sessionId: string): Promise<void> {
        const details = await this.getSessionDetails({ sessionId });
        if (!details.session) return;

        let nextStatus: PosSession['status'];
        if (details.table.balanceDueArs <= 0) {
            nextStatus = 'paid';
        } else if (details.table.paidArs > 0) {
            nextStatus = 'partially_paid';
        } else if (details.session.status === 'checkout_requested') {
            nextStatus = 'checkout_requested';
        } else {
            nextStatus = 'open';
        }

        if (details.session.status === nextStatus) return;

        const { error } = await this.supabase
            .from('pos_table_sessions')
            .update({ status: nextStatus })
            .eq('id', sessionId);

        if (error) throw new Error(error.message);
    }

    private async refreshGuestCount(sessionId: string): Promise<void> {
        const { count, error } = await this.supabase
            .from('pos_session_guests')
            .select('*', { count: 'exact', head: true })
            .eq('session_id', sessionId)
            .is('left_at', null);

        if (error) throw new Error(error.message);
        await this.supabase
            .from('pos_table_sessions')
            .update({ guest_count: count || 0 })
            .eq('id', sessionId);
    }

    private guestMatchesClaimIdentity(
        guest: any,
        identity: {
            authUserId?: string | null;
            citizenId?: string | null;
            guestToken?: string | null;
            displayName?: string | null;
        }
    ): boolean {
        if (identity.authUserId && guest.auth_user_id === identity.authUserId) {
            return true;
        }
        if (identity.citizenId && guest.citizen_id === identity.citizenId) {
            return true;
        }
        if (identity.guestToken && guest.guest_token === identity.guestToken) {
            return true;
        }
        if (
            identity.displayName &&
            guest.display_name &&
            guest.display_name === identity.displayName &&
            !guest.auth_user_id &&
            !guest.citizen_id &&
            !guest.guest_token
        ) {
            return true;
        }

        return false;
    }

    private async getActiveSessionForTable(tableId: string): Promise<{ sessionId: string | null } | null> {
        const { data, error } = await this.supabase
            .from('pos_table_live_status')
            .select('session_id')
            .eq('table_id', tableId)
            .maybeSingle();

        if (error) throw new Error(error.message);
        return data ? { sessionId: data.session_id || null } : null;
    }

    private async getFloorIdByCode(floorCode: string): Promise<string | null> {
        const floors = await this.getFloors();
        return floors.find((floor) => floor.code === floorCode)?.id || null;
    }

    private async getActiveTableIds(floorId?: string | null): Promise<string[]> {
        let query = this.supabase
            .from('pos_tables')
            .select('id')
            .eq('is_active', true)
            .lte('table_number', MAX_TABLES_PER_FLOOR);

        if (floorId) {
            query = query.eq('floor_id', floorId);
        }

        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return (data || []).map((row) => row.id as string);
    }

    private async enrichTablesWithAttention(tables: PosTableSummary[]): Promise<PosTableSummary[]> {
        if (!tables.length) return tables;

        const sessionIds = Array.from(new Set(
            tables
                .map((table) => table.sessionId)
                .filter((sessionId): sessionId is string => Boolean(sessionId))
        ));

        if (!sessionIds.length) {
            return tables.map((table) => ({
                ...table,
                attentionState: 'none',
                attentionSource: null,
                attentionStartedAt: null,
                attentionElapsedMinutes: 0,
            }));
        }

        const { data: orderRows, error: orderError } = await this.supabase
            .from('pos_orders')
            .select('id, session_id, source, status, sent_at, created_at')
            .in('session_id', sessionIds)
            .eq('status', 'sent')
            .order('created_at', { ascending: true });

        if (orderError) throw new Error(orderError.message);

        const orderIds = (orderRows || []).map((row) => row.id as string);
        const activeOrderIds = new Set<string>();

        if (orderIds.length) {
            const { data: itemRows, error: itemError } = await this.supabase
                .from('pos_order_items')
                .select('order_id')
                .in('order_id', orderIds)
                .eq('status', 'active');

            if (itemError) throw new Error(itemError.message);

            for (const row of itemRows || []) {
                if (row.order_id) {
                    activeOrderIds.add(row.order_id as string);
                }
            }
        }

        const attentionBySession = new Map<string, {
            sources: Set<'client' | 'staff'>;
            startedAt: string;
            elapsedMinutes: number;
        }>();

        const nowMs = Date.now();
        for (const row of orderRows || []) {
            const orderId = row.id as string;
            const sessionId = row.session_id as string;
            if (!activeOrderIds.has(orderId) || !sessionId) continue;

            const startedAt = String(row.sent_at || row.created_at || new Date().toISOString());
            const startedMs = new Date(startedAt).getTime();
            const elapsedMinutes = Number.isFinite(startedMs)
                ? Math.max(0, Math.floor((nowMs - startedMs) / 60000))
                : 0;

            const current = attentionBySession.get(sessionId);
            if (!current) {
                attentionBySession.set(sessionId, {
                    sources: new Set([row.source as 'client' | 'staff']),
                    startedAt,
                    elapsedMinutes,
                });
                continue;
            }

            current.sources.add(row.source as 'client' | 'staff');
            if (new Date(startedAt).getTime() < new Date(current.startedAt).getTime()) {
                current.startedAt = startedAt;
                current.elapsedMinutes = elapsedMinutes;
            }
        }

        return tables.map((table) => {
            if (!table.sessionId) {
                return {
                    ...table,
                    attentionState: 'none',
                    attentionSource: null,
                    attentionStartedAt: null,
                    attentionElapsedMinutes: 0,
                };
            }

            const attention = attentionBySession.get(table.sessionId);
            if (!attention) {
                return {
                    ...table,
                    attentionState: 'none',
                    attentionSource: null,
                    attentionStartedAt: null,
                    attentionElapsedMinutes: 0,
                };
            }

            const sourceValues = Array.from(attention.sources);
            const attentionSource = sourceValues.length > 1 ? 'mixed' : sourceValues[0];

            return {
                ...table,
                attentionState: attention.elapsedMinutes >= 15 ? 'critical' : 'warning',
                attentionSource,
                attentionStartedAt: attention.startedAt,
                attentionElapsedMinutes: attention.elapsedMinutes,
            };
        });
    }

    private async getTableSummaryByLocator(locator: SessionLocator): Promise<PosTableSummary | null> {
        let row: any = null;

        if (locator.sessionId) {
            const { data, error } = await this.supabase
                .from('pos_table_live_status')
                .select('*')
                .eq('session_id', locator.sessionId)
                .maybeSingle();
            if (error) throw new Error(error.message);
            row = data;
        } else if (locator.tableId) {
            const { data, error } = await this.supabase
                .from('pos_table_live_status')
                .select('*')
                .eq('table_id', locator.tableId)
                .maybeSingle();
            if (error) throw new Error(error.message);
            row = data;
        }

        if (!row) return null;

        const floors = await this.getFloors();
        const floor = floors.find((candidate) => candidate.id === row.floor_id);
        const table = mapTableSummary(row);
        if (floor) {
            table.floorCode = floor.code;
            table.floorName = floor.name;
        }
        const [enriched] = await this.enrichTablesWithAttention([table]);
        return enriched || table;
    }

    private async getSessionRecord(sessionId: string): Promise<any | null> {
        const { data, error } = await this.supabase
            .from('pos_table_sessions')
            .select('*')
            .eq('id', sessionId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data || null;
    }

    private async getPaymentIntent(paymentIntentId: string): Promise<PosPaymentIntent | null> {
        const { data, error } = await this.supabase
            .from('pos_payment_intents')
            .select('*')
            .eq('id', paymentIntentId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data ? mapPaymentIntent(data) : null;
    }

    private async resolveOrderItemInput(item: UpsertOrderItemsInput['items'][number]) {
        if (item.menuItemId || item.itemCode) {
            let query = this.supabase.from('pos_menu_items').select('*, pos_menu_categories(code)').eq('is_available', true);
            if (item.menuItemId) {
                query = query.eq('id', item.menuItemId);
            } else if (item.itemCode) {
                query = query.eq('code', item.itemCode);
            }

            const { data, error } = await query.maybeSingle();
            if (error) throw new Error(error.message);
            if (data) {
                return {
                    menuItemId: data.id as string,
                    itemCode: (data.code as string | null) || item.itemCode || null,
                    itemName: data.name as string,
                    categoryCode: (data.pos_menu_categories as any)?.code || item.categoryCode || null,
                    quantity: item.quantity,
                    unitPriceArs: item.unitPriceArs !== undefined && item.unitPriceArs !== null
                        ? roundMoney(item.unitPriceArs)
                        : roundMoney(data.unit_price_ars),
                    note: item.note || null,
                };
            }
        }

        if (!item.itemName || item.unitPriceArs === undefined || item.unitPriceArs === null) {
            throw new Error('Cada item necesita menuItem o bien nombre y precio');
        }

        return {
            menuItemId: item.menuItemId || null,
            itemCode: item.itemCode || null,
            itemName: item.itemName,
            categoryCode: item.categoryCode || null,
            quantity: item.quantity,
            unitPriceArs: roundMoney(item.unitPriceArs),
            note: item.note || null,
        };
    }

    private async pickAvailableTransferAccount(): Promise<{
        id: string;
        alias: string;
        ownerName: string;
        bankName: string | null;
        cbuPartial: string | null;
    } | null> {
        const nowIso = new Date().toISOString();
        const [{ data: accounts, error: accountsError }, { data: occupiedRows, error: occupiedError }] = await Promise.all([
            this.supabase
                .from('pos_transfer_accounts')
                .select('*')
                .eq('is_active', true)
                .order('created_at', { ascending: true }),
            this.supabase
                .from('pos_payment_intents')
                .select('transfer_account_id')
                .in('method', ['transfer_alias', 'app_transfer'])
                .eq('status', 'pending')
                .gt('expires_at', nowIso),
        ]);

        if (accountsError) throw new Error(accountsError.message);
        if (occupiedError) throw new Error(occupiedError.message);

        const occupied = new Set((occupiedRows || []).map((row) => row.transfer_account_id).filter(Boolean));
        const free = (accounts || []).find((account) => !occupied.has(account.id));
        if (!free) return null;

        return {
            id: free.id as string,
            alias: free.alias as string,
            ownerName: free.owner_name as string,
            bankName: (free.bank_name as string | null) || null,
            cbuPartial: (free.cbu_partial as string | null) || null,
        };
    }

    private async expireStaleTransferPayments(): Promise<void> {
        const nowIso = new Date().toISOString();
        await this.supabase
            .from('pos_payment_intents')
            .update({ status: 'expired' })
            .in('method', ['transfer_alias', 'app_transfer'])
            .eq('status', 'pending')
            .lt('expires_at', nowIso);
    }

    private async cancelPendingMercadoPagoPayments(sessionId: string): Promise<void> {
        const { error } = await this.supabase
            .from('pos_payment_intents')
            .update({ status: 'cancelled' })
            .eq('session_id', sessionId)
            .eq('method', 'mercadopago_webhook')
            .eq('status', 'pending');

        if (error) throw new Error(error.message);
    }

    private async addPaymentEvent(
        paymentIntentId: string,
        eventType: string,
        actorAuthId: string | null,
        actorCitizenId: string | null,
        payload: Record<string, unknown>
    ): Promise<void> {
        const { error } = await this.supabase.from('pos_payment_events').insert({
            payment_intent_id: paymentIntentId,
            event_type: eventType,
            actor_auth_id: actorAuthId,
            actor_citizen_id: actorCitizenId,
            payload,
        });
        if (error) throw new Error(error.message);
    }

    private async findCitizenByEmail(email: string): Promise<{ id: string; email: string } | null> {
        const { data, error } = await this.supabase
            .from('citizens')
            .select('id, email')
            .eq('email', email.toLowerCase())
            .maybeSingle();
        if (error) throw new Error(error.message);
        return data || null;
    }
}

function mapFloor(row: any): PosFloor {
    return {
        id: row.id,
        code: row.code,
        name: row.name,
        sortOrder: Number(row.sort_order),
        isActive: Boolean(row.is_active),
    };
}

function mapTableSummary(row: any): PosTableSummary {
    return {
        tableId: row.table_id,
        floorId: row.floor_id,
        label: formatTableLabel(row.table_number, row.label),
        tableNumber: Number(row.table_number),
        claimToken: row.claim_token,
        seats: Number(row.seats),
        isActive: Boolean(row.is_active),
        sessionId: row.session_id || null,
        sessionStatus: row.session_status || null,
        assignedWaiterAuthId: row.assigned_waiter_auth_id || null,
        openedAt: row.opened_at || null,
        checkoutRequestedAt: row.checkout_requested_at || null,
        guestCount: toNumber(row.guest_count),
        itemCount: toNumber(row.item_count),
        subtotalArs: roundMoney(row.subtotal_ars),
        paidArs: roundMoney(row.paid_ars),
        balanceDueArs: roundMoney(row.balance_due_ars),
        hasPendingTransfer: Boolean(row.has_pending_transfer),
        hasPendingAba: Boolean(row.has_pending_aba),
        attentionState: row.attention_state || 'none',
        attentionSource: row.attention_source || null,
        attentionStartedAt: row.attention_started_at || null,
        attentionElapsedMinutes: toNumber(row.attention_elapsed_minutes),
        uiState: row.ui_state,
    };
}

function mapMenuCategory(row: any): PosMenuCategory {
    return {
        id: row.id,
        code: row.code,
        name: row.name,
        sortOrder: toNumber(row.sort_order),
        isActive: Boolean(row.is_active),
        items: [],
    };
}

function mapMenuItem(row: any, hideDescription = false): PosMenuItem {
    return {
        id: row.id,
        categoryId: row.category_id || null,
        categoryCode: row.category_code || null,
        code: row.code || null,
        name: row.name,
        description: hideDescription ? null : row.description || null,
        unitPriceArs: roundMoney(row.unit_price_ars),
        imageUrl: row.image_url || null,
        isAvailable: Boolean(row.is_available),
        visibleInStaff: Boolean(row.visible_in_staff),
        visibleInClient: Boolean(row.visible_in_client),
        sortOrder: toNumber(row.sort_order),
    };
}

function mapSession(row: any): PosSession {
    return {
        id: row.id,
        tableId: row.table_id,
        status: row.status,
        openedByAuthId: row.opened_by_auth_id || null,
        assignedWaiterAuthId: row.assigned_waiter_auth_id || null,
        closedByAuthId: row.closed_by_auth_id || null,
        guestCount: toNumber(row.guest_count),
        note: row.note || null,
        customerNote: row.customer_note || null,
        openedAt: row.opened_at,
        checkoutRequestedAt: row.checkout_requested_at || null,
        closedAt: row.closed_at || null,
    };
}

function mapSessionGuest(row: any): PosSessionGuest {
    return {
        id: row.id,
        sessionId: row.session_id,
        authUserId: row.auth_user_id || null,
        citizenId: row.citizen_id || null,
        displayName: row.display_name || null,
        joinedVia: row.joined_via,
        isPayer: Boolean(row.is_payer),
        joinedAt: row.joined_at,
    };
}

function mapOrder(row: any): PosOrder {
    return {
        id: row.id,
        sessionId: row.session_id,
        source: row.source,
        status: row.status,
        createdByAuthId: row.created_by_auth_id || null,
        createdByCitizenId: row.created_by_citizen_id || null,
        note: row.note || null,
        sentAt: row.sent_at || null,
        servedAt: row.served_at || null,
        cancelledAt: row.cancelled_at || null,
        createdAt: row.created_at,
        items: [],
    };
}

function mapOrderItem(row: any): PosOrderItem {
    return {
        id: row.id,
        orderId: row.order_id,
        menuItemId: row.menu_item_id || null,
        itemCode: row.item_code || null,
        itemName: row.item_name,
        categoryCode: row.category_code || null,
        quantity: toNumber(row.quantity),
        unitPriceArs: roundMoney(row.unit_price_ars),
        lineTotalArs: roundMoney(row.line_total_ars),
        note: row.note || null,
        status: row.status,
        createdAt: row.created_at,
    };
}

function mapPaymentIntent(row: any): PosPaymentIntent {
    return {
        id: row.id,
        sessionId: row.session_id,
        orderId: row.order_id || null,
        method: row.method,
        status: row.status,
        amountArs: roundMoney(row.amount_ars),
        amountAba: row.amount_aba === null || row.amount_aba === undefined ? null : roundMoney(row.amount_aba),
        tipArs: roundMoney(row.tip_ars),
        citizenId: row.citizen_id || null,
        createdByAuthId: row.created_by_auth_id || null,
        confirmedByAuthId: row.confirmed_by_auth_id || null,
        transferAccountId: row.transfer_account_id || null,
        transferAlias: row.transfer_alias || null,
        transferReference: row.transfer_reference || null,
        walletObjectId: row.wallet_object_id || null,
        nfcTagId: row.nfc_tag_id || null,
        proofUrl: row.proof_url || null,
        metadata: (row.metadata as Record<string, unknown>) || {},
        requestedAt: row.requested_at,
        expiresAt: row.expires_at || null,
        confirmedAt: row.confirmed_at || null,
        cancelledAt: row.cancelled_at || null,
    };
}

function buildPosMercadoPagoReference(paymentIntentId: string): string {
    return `POS-${paymentIntentId}`;
}

function parsePosMercadoPagoReference(externalReference: string | null | undefined): string | null {
    if (!externalReference || !externalReference.startsWith('POS-')) return null;
    return externalReference.slice(4) || null;
}

function normalizeNullableText(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function toNumber(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return Number.parseFloat(value) || 0;
    return 0;
}

function roundMoney(value: unknown): number {
    return Math.round(toNumber(value) * 100) / 100;
}

function formatTableLabel(tableNumber: unknown, fallbackLabel?: string | null): string {
    const normalizedNumber = Math.max(0, Math.trunc(toNumber(tableNumber)));
    if (normalizedNumber > 0) {
        return String(normalizedNumber).padStart(2, '0');
    }

    const normalizedLabel = normalizeNullableText(fallbackLabel || undefined);
    return normalizedLabel || '00';
}

function getBuenosAiresDayRange() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const [year, month, day] = formatter.format(new Date()).split('-');

    return {
        startIso: new Date(`${year}-${month}-${day}T00:00:00-03:00`).toISOString(),
        endIso: new Date(`${year}-${month}-${day}T23:59:59.999-03:00`).toISOString(),
    };
}

function buildTransferReference(tableLabel: string, date: Date): string {
    const compactDate = date.toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
    const label = tableLabel.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-6) || 'MESA';
    return `${label}-${compactDate}`;
}
