/**
 * Amorina Club - Subscription Sync Service
 * Sync subscriptions to Google Sheets
 */

import { SheetsClient } from './sheets-client';
import type { Subscription, SubscriptionType, AmorinConfig } from '../core';

// Headers for the subscriptions sheet
const SUBSCRIPTION_HEADERS = [
    'ID',
    'Email',
    'Nombre',
    'Tipo',
    'Estado',
    'Fecha Inicio',
    'Fecha Fin',
    'Auto-Renovar',
    'ID MercadoPago',
    'Fecha Creación',
];

export class SubscriptionSyncService {
    private client: SheetsClient;
    private sheetName = 'Suscripciones';

    constructor(config: AmorinConfig) {
        this.client = new SheetsClient(config);
    }

    /**
     * Initialize the subscriptions sheet if it doesn't exist
     */
    async initialize(): Promise<void> {
        const exists = await this.client.sheetExists(this.sheetName);
        if (!exists) {
            await this.client.createSheet(this.sheetName, SUBSCRIPTION_HEADERS);
        }
    }

    /**
     * Add a new subscription
     */
    async addSubscription(subscription: Subscription): Promise<void> {
        const row = [
            subscription.id,
            subscription.userEmail,
            subscription.userName,
            subscription.type,
            subscription.status,
            subscription.startDate,
            subscription.endDate,
            subscription.autoRenew ? 'SI' : 'NO',
            subscription.mercadopagoSubscriptionId || '',
            subscription.createdAt,
        ];

        await this.client.appendRow(this.sheetName, row);
    }

    /**
     * Get user's active subscription
     */
    async getActiveSubscription(userEmail: string): Promise<Subscription | null> {
        const data = await this.client.readSheet(this.sheetName);

        // Find the most recent active subscription for this user
        for (let i = data.length - 1; i >= 1; i--) {
            const row = data[i];
            if (row[1] === userEmail && row[4] === 'ACTIVE') {
                return this.rowToSubscription(row);
            }
        }

        return null;
    }

    /**
     * Get user's subscription type (returns FREE if no active subscription)
     */
    async getUserSubscriptionType(userEmail: string): Promise<SubscriptionType> {
        const subscription = await this.getActiveSubscription(userEmail);
        return subscription?.type || 'FREE';
    }

    /**
     * Update subscription status
     */
    async updateSubscriptionStatus(
        subscriptionId: string,
        status: Subscription['status']
    ): Promise<void> {
        const rowNumber = await this.client.findRowByValue(this.sheetName, 0, subscriptionId);

        if (rowNumber) {
            await this.client.updateCell(this.sheetName, `E${rowNumber}`, status);
        }
    }

    /**
     * Cancel a subscription
     */
    async cancelSubscription(subscriptionId: string): Promise<void> {
        await this.updateSubscriptionStatus(subscriptionId, 'CANCELLED');
    }

    /**
     * Check and update expired subscriptions
     */
    async processExpiredSubscriptions(): Promise<number> {
        const data = await this.client.readSheet(this.sheetName);
        const today = new Date().toISOString().split('T')[0];
        let expiredCount = 0;

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (row[4] === 'ACTIVE' && row[6] < today) {
                // Subscription has expired
                await this.client.updateCell(this.sheetName, `E${i + 1}`, 'EXPIRED');
                expiredCount++;
            }
        }

        return expiredCount;
    }

    /**
     * Get all active subscriptions
     */
    async getAllActiveSubscriptions(): Promise<Subscription[]> {
        const data = await this.client.readSheet(this.sheetName);
        const subscriptions: Subscription[] = [];

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (row[4] === 'ACTIVE') {
                const sub = this.rowToSubscription(row);
                if (sub) subscriptions.push(sub);
            }
        }

        return subscriptions;
    }

    /**
     * Convert a sheet row to a Subscription object
     */
    private rowToSubscription(row: string[]): Subscription | null {
        if (!row || row.length < 10) return null;

        return {
            id: row[0],
            userEmail: row[1],
            userName: row[2],
            type: row[3] as SubscriptionType,
            status: row[4] as Subscription['status'],
            startDate: row[5],
            endDate: row[6],
            autoRenew: row[7] === 'SI',
            mercadopagoSubscriptionId: row[8] || null,
            createdAt: row[9],
        };
    }
}
