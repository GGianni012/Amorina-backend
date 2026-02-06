/**
 * SMAQ Service - Module Index
 * Re-exports all SMAQ-related functionality
 */

export { SmaqBank, SMAQ_EXCHANGE_RATE } from './bank';
export type {
    SmaqTransaction,
    TransactionType,
    TransactionSource,
    AppSource,
    ChargeResult,
    CreditResult
} from './bank';

export { WalletSyncService } from './wallet-sync';
export type { WalletConfig } from './wallet-sync';

export { PurchaseIntentService } from './purchase-intent';
export type {
    PurchaseIntent,
    ProductType,
    IntentStatus
} from './purchase-intent';

export { TopupCheckoutService } from './topup-checkout';
export type { TopupCheckoutResult } from './topup-checkout';
