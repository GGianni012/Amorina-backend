/**
 * SMAQ Wallet Sync Service
 * Synchronizes SMAQ balances with Google Wallet passes
 */

import { google } from 'googleapis';
import type { AmorinConfig } from '../core';

export interface WalletConfig {
    issuerId: string;
    serviceAccountEmail: string;
    serviceAccountKey: string; // Private key
}

export class WalletSyncService {
    private walletobjects: any;
    private issuerId: string;
    private initialized = false;

    constructor(private config: WalletConfig) {
        this.issuerId = config.issuerId;
    }

    /**
     * Initialize the Google Wallet API client
     */
    private async ensureInitialized(): Promise<void> {
        if (this.initialized) return;

        const auth = new google.auth.JWT({
            email: this.config.serviceAccountEmail,
            key: this.config.serviceAccountKey,
            scopes: ['https://www.googleapis.com/auth/wallet_object.issuer']
        });

        this.walletobjects = google.walletobjects({
            version: 'v1',
            auth
        });

        this.initialized = true;
    }

    /**
     * Update the balance displayed on a Google Wallet pass
     */
    async updateBalance(objectId: string, newBalance: number): Promise<boolean> {
        await this.ensureInitialized();

        try {
            // Get current object to preserve other fields
            const current = await this.walletobjects.genericobject.get({
                resourceId: objectId
            });

            // Find and update the balance text module
            const textModules = current.data.textModulesData || [];
            const updatedModules = textModules.map((module: any) => {
                if (module.id === 'balance') {
                    return { ...module, body: `${newBalance} SMAQ` };
                }
                return module;
            });

            // Patch the object
            await this.walletobjects.genericobject.patch({
                resourceId: objectId,
                requestBody: {
                    textModulesData: updatedModules
                }
            });

            console.log(`✅ Wallet updated: ${objectId} -> ${newBalance} SMAQ`);
            return true;

        } catch (error) {
            console.error(`❌ Wallet update failed for ${objectId}:`, error);
            return false;
        }
    }

    /**
     * Create a new wallet pass for a user
     */
    async createPass(user: {
        email: string;
        name: string;
        balance: number;
        tier?: string;
    }): Promise<{ objectId: string; saveUrl: string } | null> {
        await this.ensureInitialized();

        const objectId = `${this.issuerId}.SMAQ_${Date.now()}`;

        try {
            const passObject = {
                id: objectId,
                classId: `${this.issuerId}.Smaqs_Member`,
                state: 'ACTIVE',
                heroImage: {
                    sourceUri: {
                        uri: 'https://farm4.staticflickr.com/3723/11177041115_6e6a3b6f49_o.jpg'
                    },
                    contentDescription: {
                        defaultValue: { language: 'es', value: 'Amorina' }
                    }
                },
                cardTitle: {
                    defaultValue: { language: 'es', value: 'AMORINA' }
                },
                header: {
                    defaultValue: { language: 'es', value: user.name }
                },
                subheader: {
                    defaultValue: { language: 'es', value: user.tier || 'Miembro' }
                },
                logo: {
                    sourceUri: {
                        uri: 'https://farm4.staticflickr.com/3723/11177041115_6e6a3b6f49_o.jpg'
                    },
                    contentDescription: {
                        defaultValue: { language: 'es', value: 'Logo' }
                    }
                },
                hexBackgroundColor: '#1a1a2e',
                textModulesData: [
                    { header: 'SALDO', body: `${user.balance} SMAQ`, id: 'balance' },
                    { header: 'EMAIL', body: user.email, id: 'email' }
                ],
                barcode: {
                    type: 'QR_CODE',
                    value: objectId
                }
            };

            await this.walletobjects.genericobject.insert({
                requestBody: passObject
            });

            // Generate save URL using JWT
            const saveUrl = `https://pay.google.com/gp/v/save/${objectId}`;

            console.log(`✅ Created wallet pass: ${objectId}`);

            return { objectId, saveUrl };

        } catch (error) {
            console.error('❌ Failed to create wallet pass:', error);
            return null;
        }
    }

    /**
     * Get pass details
     */
    async getPass(objectId: string): Promise<any | null> {
        await this.ensureInitialized();

        try {
            const result = await this.walletobjects.genericobject.get({
                resourceId: objectId
            });
            return result.data;
        } catch (error) {
            console.error(`❌ Failed to get pass ${objectId}:`, error);
            return null;
        }
    }
}

export default WalletSyncService;
