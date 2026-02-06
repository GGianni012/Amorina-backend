/**
 * SMAQ Purchase Intent Service
 * Stores pending purchase intents that will be executed after SMAQ top-up
 */

import { SheetsClient } from '../google-sheets-service/sheets-client';
import type { AmorinConfig } from '../core';

export type ProductType = 'cine' | 'subscription' | 'bar' | 'event' | 'credits';
export type IntentStatus = 'pending' | 'paid' | 'completed' | 'expired' | 'cancelled';

export interface PurchaseIntent {
    id: string;
    userId?: string;                   // Supabase User ID (optional)
    userEmail: string;
    userName?: string;
    productType: ProductType;
    productData: Record<string, any>;  // Product-specific data (showtimeId, plan, etc)
    smaqRequired: number;              // SMAQS needed for the purchase
    smaqTopup: number;                 // SMAQS being purchased (may include extra)
    arsAmount: number;                 // Amount in ARS for MP checkout
    walletObjectId?: string;           // Google Wallet pass ID if available
    mpPreferenceId?: string;           // MercadoPago preference ID
    createdAt: string;
    expiresAt: string;
    status: IntentStatus;
}

const INTENTS_SHEET_NAME = 'SMAQ_INTENTS';
const INTENTS_HEADERS = [
    'ID',
    'Email',
    'Nombre',
    'Tipo Producto',
    'Datos Producto',
    'SMAQ Requeridos',
    'SMAQ Topup',
    'Monto ARS',
    'Wallet Object ID',
    'MP Preference ID',
    'Creado',
    'Expira',
    'Estado',
    'User ID' // New column
];

// Column indices (0-based)
const COL = {
    ID: 0,
    EMAIL: 1,
    NAME: 2,
    PRODUCT_TYPE: 3,
    PRODUCT_DATA: 4,
    SMAQ_REQUIRED: 5,
    SMAQ_TOPUP: 6,
    ARS_AMOUNT: 7,
    WALLET_ID: 8,
    MP_PREF_ID: 9,
    CREATED: 10,
    EXPIRES: 11,
    STATUS: 12,
    USER_ID: 13
};

export class PurchaseIntentService {
    private sheets: SheetsClient;
    private initialized = false;

    constructor(private config: AmorinConfig) {
        this.sheets = new SheetsClient(config);
    }

    /**
     * Ensure the intents sheet exists with proper headers
     */
    private async ensureSheet(): Promise<void> {
        if (this.initialized) return;

        const exists = await this.sheets.sheetExists(INTENTS_SHEET_NAME);
        if (!exists) {
            await this.sheets.createSheet(INTENTS_SHEET_NAME, INTENTS_HEADERS);
        }
        this.initialized = true;
    }

    /**
     * Generate unique intent ID
     */
    private generateIntentId(): string {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 6);
        return `SMAQ-${timestamp}-${random}`.toUpperCase();
    }

    /**
     * Create a new purchase intent
     */
    async createIntent(params: {
        userEmail: string;
        userId?: string;
        userName?: string;
        productType: ProductType;
        productData: Record<string, any>;
        smaqRequired: number;
        smaqTopup: number;
        walletObjectId?: string;
    }): Promise<PurchaseIntent> {
        await this.ensureSheet();

        const SMAQ_RATE = 1000; // 1 SMAQ = $1000 ARS
        const arsAmount = params.smaqTopup * SMAQ_RATE;

        const intent: PurchaseIntent = {
            id: this.generateIntentId(),
            userEmail: params.userEmail,
            userId: params.userId,
            userName: params.userName,
            productType: params.productType,
            productData: params.productData,
            smaqRequired: params.smaqRequired,
            smaqTopup: params.smaqTopup,
            arsAmount,
            walletObjectId: params.walletObjectId,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
            status: 'pending'
        };

        // Store in sheet
        await this.sheets.appendRow(INTENTS_SHEET_NAME, [
            intent.id,
            intent.userEmail,
            intent.userName || '',
            intent.productType,
            JSON.stringify(intent.productData),
            intent.smaqRequired,
            intent.smaqTopup,
            intent.arsAmount,
            intent.walletObjectId || '',
            '', // MP Preference ID (set later)
            intent.createdAt,
            intent.expiresAt,
            intent.status,
            intent.userId || ''
        ]);

        console.log(`✅ Created purchase intent: ${intent.id}`);
        return intent;
    }

    /**
     * Update intent with MercadoPago preference ID
     */
    async setMpPreferenceId(intentId: string, preferenceId: string): Promise<void> {
        await this.ensureSheet();

        const rowNum = await this.sheets.findRowByValue(INTENTS_SHEET_NAME, COL.ID, intentId);
        if (rowNum) {
            // Column J (index 9) is MP Preference ID, J = column 10 in 1-indexed = 'J'
            await this.sheets.updateCell(INTENTS_SHEET_NAME, `J${rowNum}`, preferenceId);
        }
    }

    /**
     * Get intent by ID
     */
    async getIntent(intentId: string): Promise<PurchaseIntent | null> {
        await this.ensureSheet();

        const data = await this.sheets.readSheet(INTENTS_SHEET_NAME);

        // Skip header row
        for (let i = 1; i < data.length; i++) {
            if (data[i][COL.ID] === intentId) {
                return this.rowToIntent(data[i]);
            }
        }

        return null;
    }

    /**
     * Get intent by MP external reference (intent ID is used as external_reference)
     */
    async getIntentByExternalRef(externalRef: string): Promise<PurchaseIntent | null> {
        return this.getIntent(externalRef);
    }

    /**
     * Update intent status
     */
    async updateStatus(intentId: string, status: IntentStatus): Promise<void> {
        await this.ensureSheet();

        const rowNum = await this.sheets.findRowByValue(INTENTS_SHEET_NAME, COL.ID, intentId);
        if (rowNum) {
            // Column M (index 12) is Status
            await this.sheets.updateCell(INTENTS_SHEET_NAME, `M${rowNum}`, status);
            console.log(`📝 Intent ${intentId} status: ${status}`);
        }
    }

    /**
     * Mark intent as paid (top-up received, ready to execute)
     */
    async markPaid(intentId: string): Promise<PurchaseIntent | null> {
        await this.updateStatus(intentId, 'paid');
        return this.getIntent(intentId);
    }

    /**
     * Mark intent as completed (purchase executed)
     */
    async markCompleted(intentId: string): Promise<void> {
        await this.updateStatus(intentId, 'completed');
    }

    /**
     * Convert sheet row to PurchaseIntent object
     */
    private rowToIntent(row: string[]): PurchaseIntent {
        return {
            id: row[COL.ID] || '',
            userEmail: row[COL.EMAIL] || '',
            userName: row[COL.NAME] || undefined,
            productType: (row[COL.PRODUCT_TYPE] as ProductType) || 'cine',
            productData: JSON.parse(row[COL.PRODUCT_DATA] || '{}'),
            smaqRequired: parseFloat(row[COL.SMAQ_REQUIRED]) || 0,
            smaqTopup: parseFloat(row[COL.SMAQ_TOPUP]) || 0,
            arsAmount: parseFloat(row[COL.ARS_AMOUNT]) || 0,
            walletObjectId: row[COL.WALLET_ID] || undefined,
            mpPreferenceId: row[COL.MP_PREF_ID] || undefined,
            createdAt: row[COL.CREATED] || '',
            expiresAt: row[COL.EXPIRES] || '',
            status: (row[COL.STATUS] as IntentStatus) || 'pending',
            userId: row[COL.USER_ID] || undefined
        };
    }
}

export default PurchaseIntentService;
