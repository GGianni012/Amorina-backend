/**
 * SMAQ Bank Service
 * Central service for managing SMAQ token balances and transactions
 * 
 * Exchange Rate: 1 SMAQ = $1000 ARS
 */

import { SheetsClient } from '../google-sheets-service/sheets-client';
import type { AmorinConfig } from '../core';

// Constants
export const SMAQ_EXCHANGE_RATE = 1000; // 1 SMAQ = 1000 ARS
const SMAQ_SHEET_NAME = 'SMAQ_TRANSACTIONS';
const SMAQ_HEADERS = [
    'Timestamp',
    'Email',
    'Type',        // 'credit' | 'charge'
    'Amount',      // Always positive
    'Source',      // 'compra' | 'suscripcion' | 'cashback' | 'regalo'
    'App',         // 'aquilea' | 'cine' | 'subs' | 'web'
    'Description',
    'WalletObjectId' // For Google Wallet sync
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
    private sheetsClient: SheetsClient;
    private initialized = false;

    constructor(config: AmorinConfig) {
        this.sheetsClient = new SheetsClient(config);
    }

    /**
     * Initialize the SMAQ sheet if it doesn't exist
     */
    private async ensureInitialized(): Promise<void> {
        if (this.initialized) return;

        const exists = await this.sheetsClient.sheetExists(SMAQ_SHEET_NAME);
        if (!exists) {
            await this.sheetsClient.createSheet(SMAQ_SHEET_NAME, SMAQ_HEADERS);
            console.log(`Created ${SMAQ_SHEET_NAME} sheet`);
        }
        this.initialized = true;
    }

    /**
     * Get current balance for a user
     */
    async getBalance(email: string): Promise<number> {
        await this.ensureInitialized();

        const data = await this.sheetsClient.readSheet(SMAQ_SHEET_NAME);

        // Skip header, sum all transactions for this user
        let balance = 0;
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (row[1]?.toLowerCase() === email.toLowerCase()) {
                const type = row[2] as TransactionType;
                const amount = parseFloat(row[3]) || 0;

                if (type === 'credit') {
                    balance += amount;
                } else if (type === 'charge') {
                    balance -= amount;
                }
            }
        }

        return Math.max(0, balance);
    }

    /**
     * Charge SMAQ from user account
     */
    async charge(
        email: string,
        amount: number,
        app: AppSource,
        description: string,
        walletObjectId?: string
    ): Promise<ChargeResult> {
        await this.ensureInitialized();

        // Check balance first
        const currentBalance = await this.getBalance(email);
        if (currentBalance < amount) {
            return {
                success: false,
                newBalance: currentBalance,
                error: `Saldo insuficiente. Tenés ${currentBalance} SMAQ, necesitás ${amount}.`
            };
        }

        // Record transaction
        const transaction: SmaqTransaction = {
            timestamp: new Date().toISOString(),
            email: email.toLowerCase(),
            type: 'charge',
            amount,
            source: 'consumo',
            app,
            description,
            walletObjectId
        };

        await this.recordTransaction(transaction);

        const newBalance = currentBalance - amount;

        return {
            success: true,
            newBalance,
            transactionId: `${Date.now()}`
        };
    }

    /**
     * Credit SMAQ to user account
     */
    async credit(
        email: string,
        amount: number,
        source: TransactionSource,
        app: AppSource = 'system',
        description: string = '',
        walletObjectId?: string
    ): Promise<CreditResult> {
        await this.ensureInitialized();

        const transaction: SmaqTransaction = {
            timestamp: new Date().toISOString(),
            email: email.toLowerCase(),
            type: 'credit',
            amount,
            source,
            app,
            description: description || `Acreditación de ${amount} SMAQ`,
            walletObjectId
        };

        await this.recordTransaction(transaction);

        const newBalance = await this.getBalance(email);

        return {
            success: true,
            newBalance,
            transactionId: `${Date.now()}`
        };
    }

    /**
     * Get transaction history for a user
     */
    async getHistory(email: string, limit: number = 50): Promise<SmaqTransaction[]> {
        await this.ensureInitialized();

        const data = await this.sheetsClient.readSheet(SMAQ_SHEET_NAME);
        const transactions: SmaqTransaction[] = [];

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (row[1]?.toLowerCase() === email.toLowerCase()) {
                transactions.push({
                    timestamp: row[0],
                    email: row[1],
                    type: row[2] as TransactionType,
                    amount: parseFloat(row[3]) || 0,
                    source: row[4] as TransactionSource,
                    app: row[5] as AppSource,
                    description: row[6],
                    walletObjectId: row[7]
                });
            }
        }

        // Most recent first
        return transactions.reverse().slice(0, limit);
    }

    /**
     * Get or create wallet object ID for a user
     */
    async getWalletObjectId(email: string): Promise<string | null> {
        await this.ensureInitialized();

        const data = await this.sheetsClient.readSheet(SMAQ_SHEET_NAME);

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (row[1]?.toLowerCase() === email.toLowerCase() && row[7]) {
                return row[7]; // Return first found walletObjectId
            }
        }

        return null;
    }

    /**
     * Link a wallet object ID to a user
     */
    async linkWallet(email: string, walletObjectId: string): Promise<void> {
        // Credit 0 SMAQ just to record the wallet link
        await this.credit(email, 0, 'regalo', 'system', 'Wallet vinculada', walletObjectId);
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
     * Record a transaction to the sheet
     */
    private async recordTransaction(transaction: SmaqTransaction): Promise<void> {
        await this.sheetsClient.appendRow(SMAQ_SHEET_NAME, [
            transaction.timestamp,
            transaction.email,
            transaction.type,
            transaction.amount,
            transaction.source,
            transaction.app,
            transaction.description,
            transaction.walletObjectId || ''
        ]);
    }
}

export default SmaqBank;
