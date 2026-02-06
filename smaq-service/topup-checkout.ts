/**
 * SMAQ Top-Up Checkout Service
 * Creates MercadoPago preferences for purchasing SMAQS
 */

import { MercadoPagoConfig, Preference } from 'mercadopago';
import type { AmorinConfig } from '../core';
import { SMAQ_EXCHANGE_RATE } from './bank';

export interface TopupCheckoutResult {
    preferenceId: string;
    initPoint: string;
    sandboxInitPoint: string;
    intentId: string;
    smaqAmount: number;
    arsAmount: number;
}

export class TopupCheckoutService {
    private client: MercadoPagoConfig;
    private config: AmorinConfig;

    constructor(config: AmorinConfig) {
        this.config = config;
        this.client = new MercadoPagoConfig({
            accessToken: config.mercadopago.accessToken,
        });
    }

    /**
     * Create a MercadoPago preference for SMAQ top-up
     */
    async createTopupPreference(params: {
        intentId: string;
        userEmail: string;
        userName?: string;
        smaqAmount: number;
        productDescription?: string;
    }): Promise<TopupCheckoutResult> {
        const preference = new Preference(this.client);

        const arsAmount = params.smaqAmount * SMAQ_EXCHANGE_RATE;

        const preferenceData = await preference.create({
            body: {
                items: [
                    {
                        id: `SMAQ-${params.intentId}`,
                        title: `${params.smaqAmount} SMAQ`,
                        description: params.productDescription ||
                            `Compra de ${params.smaqAmount} SMAQ para usar en Amorina`,
                        category_id: 'virtual_goods',
                        quantity: 1,
                        currency_id: 'ARS',
                        unit_price: arsAmount,
                    },
                ],
                payer: {
                    email: params.userEmail,
                    name: params.userName || params.userEmail.split('@')[0],
                },
                back_urls: {
                    success: `${this.config.urls.baseUrl}/smaq/success?intent=${params.intentId}`,
                    failure: `${this.config.urls.baseUrl}/smaq/failure?intent=${params.intentId}`,
                    pending: `${this.config.urls.baseUrl}/smaq/pending?intent=${params.intentId}`,
                },
                auto_return: 'approved',
                notification_url: this.config.urls.webhookUrl,
                // Use intent ID as external reference to link payment to purchase intent
                external_reference: params.intentId,
                metadata: {
                    type: 'smaq_topup',
                    intent_id: params.intentId,
                    smaq_amount: params.smaqAmount,
                    user_email: params.userEmail,
                },
                expires: true,
                expiration_date_from: new Date().toISOString(),
                expiration_date_to: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
            },
        });

        return {
            preferenceId: preferenceData.id!,
            initPoint: preferenceData.init_point!,
            sandboxInitPoint: preferenceData.sandbox_init_point!,
            intentId: params.intentId,
            smaqAmount: params.smaqAmount,
            arsAmount,
        };
    }

    /**
     * Check if sandbox mode is enabled
     */
    isSandbox(): boolean {
        return this.config.mercadopago.sandboxMode;
    }
}

export default TopupCheckoutService;
