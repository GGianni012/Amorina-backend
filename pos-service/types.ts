export type PosUiTableState =
    | 'disabled'
    | 'libre'
    | 'abierta'
    | 'pidiendo_cuenta'
    | 'transferencia_pendiente'
    | 'pagada';

export type PosAttentionState = 'none' | 'warning' | 'critical';

export type PosAttentionSource = 'client' | 'staff' | 'mixed';

export type PosSessionStatus =
    | 'open'
    | 'checkout_requested'
    | 'partially_paid'
    | 'paid'
    | 'closed'
    | 'cancelled';

export type PosOrderSource = 'staff' | 'client';

export type PosMenuAudience = 'staff' | 'client' | 'all';

export type PosPaymentMethod =
    | 'aba_nfc'
    | 'aba_wallet'
    | 'mercadopago_webhook'
    | 'transfer_alias'
    | 'app_aba'
    | 'app_transfer';

export interface PosFloor {
    id: string;
    code: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
}

export interface PosTableSummary {
    tableId: string;
    floorId: string;
    floorCode?: string;
    floorName?: string;
    label: string;
    tableNumber: number;
    claimToken: string;
    seats: number;
    isActive: boolean;
    sessionId: string | null;
    sessionStatus: PosSessionStatus | null;
    assignedWaiterAuthId: string | null;
    openedAt: string | null;
    checkoutRequestedAt: string | null;
    guestCount: number;
    itemCount: number;
    subtotalArs: number;
    paidArs: number;
    balanceDueArs: number;
    hasPendingTransfer: boolean;
    hasPendingAba: boolean;
    attentionState: PosAttentionState;
    attentionSource: PosAttentionSource | null;
    attentionStartedAt: string | null;
    attentionElapsedMinutes: number;
    uiState: PosUiTableState;
}

export interface PosDashboardSummary {
    tableCount: number;
    occupiedTableCount: number;
    requestedTableCount: number;
    pendingTransferTableCount: number;
    liveOpenArs: number;
    closedArs: number;
    grandTotalArs: number;
    closedSessionCount: number;
    updatedAt: string;
}

export interface PosMenuItem {
    id: string;
    categoryId: string | null;
    categoryCode: string | null;
    code: string | null;
    name: string;
    description: string | null;
    unitPriceArs: number;
    imageUrl: string | null;
    isAvailable: boolean;
    visibleInStaff: boolean;
    visibleInClient: boolean;
    sortOrder: number;
}

export interface PosMenuCategory {
    id: string;
    code: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
    items: PosMenuItem[];
}

export interface PosSession {
    id: string;
    tableId: string;
    status: PosSessionStatus;
    openedByAuthId: string | null;
    assignedWaiterAuthId: string | null;
    closedByAuthId: string | null;
    guestCount: number;
    note: string | null;
    customerNote: string | null;
    openedAt: string;
    checkoutRequestedAt: string | null;
    closedAt: string | null;
}

export interface PosSessionGuest {
    id: string;
    sessionId: string;
    authUserId: string | null;
    citizenId: string | null;
    displayName: string | null;
    joinedVia: 'qr' | 'nfc' | 'staff';
    isPayer: boolean;
    joinedAt: string;
}

export interface PosOrderItem {
    id: string;
    orderId: string;
    menuItemId: string | null;
    itemCode: string | null;
    itemName: string;
    categoryCode: string | null;
    quantity: number;
    unitPriceArs: number;
    lineTotalArs: number;
    note: string | null;
    status: 'active' | 'voided';
    createdAt: string;
}

export interface PosOrder {
    id: string;
    sessionId: string;
    source: PosOrderSource;
    status: 'draft' | 'sent' | 'served' | 'cancelled';
    createdByAuthId: string | null;
    createdByCitizenId: string | null;
    note: string | null;
    sentAt: string | null;
    servedAt: string | null;
    cancelledAt: string | null;
    createdAt: string;
    items: PosOrderItem[];
}

export interface PosPaymentIntent {
    id: string;
    sessionId: string;
    orderId: string | null;
    method: PosPaymentMethod;
    status: 'pending' | 'processing' | 'confirmed' | 'failed' | 'cancelled' | 'expired';
    amountArs: number;
    amountAba: number | null;
    tipArs: number;
    citizenId: string | null;
    createdByAuthId: string | null;
    confirmedByAuthId: string | null;
    transferAccountId: string | null;
    transferAlias: string | null;
    transferReference: string | null;
    walletObjectId: string | null;
    nfcTagId: string | null;
    proofUrl: string | null;
    metadata: Record<string, unknown>;
    requestedAt: string;
    expiresAt: string | null;
    confirmedAt: string | null;
    cancelledAt: string | null;
}

export interface PosSessionDetails {
    table: PosTableSummary;
    session: PosSession | null;
    guests: PosSessionGuest[];
    orders: PosOrder[];
    payments: PosPaymentIntent[];
}

export interface OpenSessionInput {
    tableId: string;
    guestCount?: number;
    note?: string;
    openedByAuthId?: string | null;
    assignedWaiterAuthId?: string | null;
}

export interface ClaimTableInput {
    claimToken: string;
    authUserId?: string | null;
    citizenId?: string | null;
    guestToken?: string | null;
    displayName?: string | null;
    joinMethod?: 'qr' | 'nfc' | 'staff';
    createSessionIfMissing?: boolean;
}

export interface OrderItemInput {
    menuItemId?: string | null;
    itemCode?: string | null;
    itemName?: string | null;
    categoryCode?: string | null;
    quantity: number;
    unitPriceArs?: number | null;
    note?: string | null;
}

export interface UpsertOrderItemsInput {
    sessionId: string;
    orderId?: string | null;
    source: PosOrderSource;
    createdByAuthId?: string | null;
    createdByCitizenId?: string | null;
    note?: string | null;
    items: OrderItemInput[];
}

export interface UpdateOrderItemInput {
    itemId: string;
    quantity?: number;
    note?: string | null;
    status?: 'active' | 'voided';
}

export interface TransferPaymentResult {
    paymentIntentId: string;
    alias: string;
    ownerName: string;
    bankName: string | null;
    cbuPartial: string | null;
    reference: string;
    amountArs: number;
    expiresAt: string;
}

export interface MercadoPagoCheckoutResult {
    paymentIntentId: string;
    baseAmountArs: number;
    surchargeArs: number;
    totalAmountArs: number;
    preferenceId: string;
    initPoint: string;
    sandboxInitPoint: string;
    externalReference: string;
}
