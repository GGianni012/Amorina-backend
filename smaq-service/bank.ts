/**
 * SMAQ Bank Service
 * Central service for managing SMAQ token balances and transactions
 * 
 * Source of truth: Supabase (citizens.dracma_balance + dracma_transactions)
 * Google Sheets: async fire-and-forget log for admin visibility
 * 
 * Exchange Rate: 1 SMAQ = $1000 ARS
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SheetsClient } from '../google-sheets-service/sheets-client';
import type { AmorinConfig } from '../core';

// Constants
export const SMAQ_EXCHANGE_RATE = 1000; // 1 SMAQ = 1000 ARS
const SMAQ_LOG_SHEET = 'SMAQ_LOG';
const SMAQ_LOG_HEADERS = [
    'Timestamp',
    'Email',
    'Type',        // 'credit' | 'charge'
    'Amount',      // Always positive
    'Source',      // 'compra' | 'suscripcion' | 'cashback' | 'regalo'
    'App',         // 'aquilea' | 'cine' | 'subs' | 'web'
    'Description',
    'Balance After'
];

export type TransactionType = 'credit' | 'charge';
export type TransactionSource = 'compra' | 'suscripcion' | 'cashback' | 'regalo' | 'consumo' | 'pelicula' | 'subtitulado';
export type AppSource = 'aquilea' | 'cine' | 'subs' | 'web' | 'system';

export interface SmaqTransaction {
    timestamp: string;
    email: string;
    type: TransactionType;
    amount: number;
    source: TransactionSource;
    app: AppSource;
    description: string;
    walletObjectId?: string;
}

export interface ChargeResult {
    success: boolean;
    newBalance: number;
    transactionId?: string;
    error?: string;
}

export interface CreditResult {
    success: boolean;
    newBalance: number;
    transactionId?: string;
}

export class SmaqBank {
    private supabase: SupabaseClient;
    private sheetsClient: SheetsClient | null;
    private sheetsInitialized = false;

    constructor(config: AmorinConfig) {
        // Supabase: source of truth
        this.supabase = createClient(config.supabase.url, config.supabase.serviceKey);

        // Sheets: optional async log (fire-and-forget)
        try {
            this.sheetsClient = new SheetsClient(config);
        } catch {
            this.sheetsClient = null;
            console.warn('Sheets client not configured — logging disabled');
        }
    }

    /**
     * Get current balance for a user from Supabase
     */
    async getBalance(email: string): Promise<number> {
        const { data, error } = await this.supabase
            .from('citizens')
            .select('dracma_balance')
            .eq('email', email.toLowerCase())
            .single();

        if (error || !data) {
            // User may not exist in citizens yet
            console.warn(`No citizen found for ${email}:`, error?.message);
            return 0;
        }

        return parseFloat(data.dracma_balance) || 0;
    }

    /**
     * Get citizen ID by email (needed for record_dracma_transaction)
     */
    private async getCitizenId(email: string): Promise<string | null> {
        const { data, error } = await this.supabase
            .from('citizens')
            .select('id')
            .eq('email', email.toLowerCase())
            .single();

        if (error || !data) return null;
        return data.id;
    }

    /**
     * Charge SMAQ from user account using Supabase atomic transaction
     */
    async charge(
        email: string,
        amount: number,
        app: AppSource,
        description: string,
        walletObjectId?: string
    ): Promise<ChargeResult> {
        const citizenId = await this.getCitizenId(email);
        if (!citizenId) {
            return {
                success: false,
                newBalance: 0,
                error: `Usuario no encontrado: ${email}`
            };
        }

        // Use the atomic function with FOR UPDATE lock
        const { data, error } = await this.supabase.rpc('record_dracma_transaction', {
            p_citizen_id: citizenId,
            p_type: 'consumo',
            p_amount: -amount, // negative for charges
            p_description: `[${app}] ${description}`
        });

        if (error) {
            // Check if it's an insufficient balance error
            if (error.message.includes('Insufficient')) {
                const currentBalance = await this.getBalance(email);
                return {
                    success: false,
                    newBalance: currentBalance,
                    error: `Saldo insuficiente. Tenés ${currentBalance} SMAQ, necesitás ${amount}.`
                };
            }
            return {
                success: false,
                newBalance: 0,
                error: error.message
            };
        }

        const newBalance = data?.[0]?.new_balance ?? (await this.getBalance(email));
        const transactionId = data?.[0]?.transaction_id;

        // Async log to Sheets (fire-and-forget)
        this.logToSheets({
            timestamp: new Date().toISOString(),
            email: email.toLowerCase(),
            type: 'charge',
            amount,
            source: 'consumo',
            app,
            description,
        }, newBalance).catch(() => { });

        return {
            success: true,
            newBalance,
            transactionId
        };
    }

    /**
     * Credit SMAQ to user account using Supabase atomic transaction
     */
    async credit(
        email: string,
        amount: number,
        source: TransactionSource,
        app: AppSource = 'system',
        description: string = '',
        walletObjectId?: string
    ): Promise<CreditResult> {
        const citizenId = await this.getCitizenId(email);
        if (!citizenId) {
            return {
                success: false,
                newBalance: 0,
                transactionId: undefined
            };
        }

        const descText = description || `Acreditación de ${amount} SMAQ`;

        const { data, error } = await this.supabase.rpc('record_dracma_transaction', {
            p_citizen_id: citizenId,
            p_type: 'acreditacion',
            p_amount: amount, // positive for credits
            p_description: `[${app}] ${descText}`
        });

        if (error) {
            console.error('Credit error:', error);
            return { success: false, newBalance: 0 };
        }

        const newBalance = data?.[0]?.new_balance ?? (await this.getBalance(email));
        const transactionId = data?.[0]?.transaction_id;

        // Async log to Sheets (fire-and-forget)
        this.logToSheets({
            timestamp: new Date().toISOString(),
            email: email.toLowerCase(),
            type: 'credit',
            amount,
            source,
            app,
            description: descText,
        }, newBalance).catch(() => { });

        return {
            success: true,
            newBalance,
            transactionId
        };
    }

    /**
     * Get transaction history for a user from Supabase
     */
    async getHistory(email: string, limit: number = 50): Promise<SmaqTransaction[]> {
        const citizenId = await this.getCitizenId(email);
        if (!citizenId) return [];

        const { data, error } = await this.supabase
            .from('dracma_transactions')
            .select('*')
            .eq('citizen_id', citizenId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error || !data) return [];

        return data.map(row => ({
            timestamp: row.created_at,
            email,
            type: row.amount >= 0 ? 'credit' as TransactionType : 'charge' as TransactionType,
            amount: Math.abs(parseFloat(row.amount)),
            source: (row.type || 'consumo') as TransactionSource,
            app: 'system' as AppSource,
            description: row.description || '',
        }));
    }

    /**
     * Get or create wallet object ID for a user
     */
    async getWalletObjectId(email: string): Promise<string | null> {
        // This feature is not tied to balance — can remain as-is or be added to citizens table later
        return null;
    }

    /**
     * Link a wallet object ID to a user
     */
    async linkWallet(email: string, walletObjectId: string): Promise<void> {
        // Future: store in citizens table
        await this.credit(email, 0, 'regalo', 'system', 'Wallet vinculada');
    }

    /**
     * Convert ARS to SMAQ
     */
    static arsToSmaq(ars: number): number {
        return Math.floor(ars / SMAQ_EXCHANGE_RATE);
    }

    /**
     * Convert SMAQ to ARS
     */
    static smaqToArs(smaq: number): number {
        return smaq * SMAQ_EXCHANGE_RATE;
    }

    /**
     * Fire-and-forget log to Google Sheets for admin visibility.
     * If this fails, the Supabase transaction is already committed.
     */
    private async logToSheets(transaction: Omit<SmaqTransaction, 'walletObjectId'>, balanceAfter: number): Promise<void> {
        if (!this.sheetsClient) return;

        try {
            if (!this.sheetsInitialized) {
                const exists = await this.sheetsClient.sheetExists(SMAQ_LOG_SHEET);
                if (!exists) {
                    await this.sheetsClient.createSheet(SMAQ_LOG_SHEET, SMAQ_LOG_HEADERS);
                }
                this.sheetsInitialized = true;
            }

            await this.sheetsClient.appendRow(SMAQ_LOG_SHEET, [
                transaction.timestamp,
                transaction.email,
                transaction.type,
                transaction.amount,
                transaction.source,
                transaction.app,
                transaction.description,
                balanceAfter
            ]);
        } catch (err) {
            console.warn('Sheets log failed (non-blocking):', err);
        }
    }
}

export default SmaqBank;
