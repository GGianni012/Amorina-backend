/**
 * Amorina Club - MercadoPago Checkout Service
 * Create payment preferences for movie tickets
 */

import { MercadoPagoConfig, Preference } from 'mercadopago';
import type { AmorinConfig, SubscriptionType } from '../core';
import { calculatePrice, DEFAULT_PRICING } from '../core';

export interface CheckoutItem {
    showtimeId: string;
    movieTitle: string;
    showDateTime: string;
    poster: string;
    userEmail: string;
    userName: string;
    subscriptionType: SubscriptionType;
}

export interface CheckoutResult {
    preferenceId: string;
    initPoint: string;        // URL to redirect user to pay
    sandboxInitPoint: string; // Sandbox URL for testing
    reservationId: string;
    finalPrice: number;
}

export class CheckoutService {
    private client: MercadoPagoConfig;
    private config: AmorinConfig;

    constructor(config: AmorinConfig) {
        this.config = config;
        this.client = new MercadoPagoConfig({
            accessToken: config.mercadopago.accessToken,
        });
    }

    /**
     * Create a payment preference for a movie ticket
     */
    async createTicketPreference(item: CheckoutItem): Promise<CheckoutResult> {
        const preference = new Preference(this.client);

        // Calculate price based on subscription
        const originalPrice = this.config.pricing.basePrice;
        const finalPrice = calculatePrice(
            originalPrice,
            item.subscriptionType,
            DEFAULT_PRICING
        );

        // Generate a unique reservation ID
        const reservationId = this.generateReservationId();

        const preferenceData = await preference.create({
            body: {
                items: [
                    {
                        id: item.showtimeId,
                        title: `Entrada: ${item.movieTitle}`,
                        description: `Función: ${new Date(item.showDateTime).toLocaleString('es-AR')}`,
                        picture_url: item.poster,
                        category_id: 'entertainment',
                        quantity: 1,
                        currency_id: 'ARS',
                        unit_price: finalPrice,
                    },
                ],
                payer: {
                    email: item.userEmail,
                    name: item.userName,
                },
                back_urls: {
                    success: this.config.urls.successUrl,
                    failure: this.config.urls.failureUrl,
                    pending: this.config.urls.pendingUrl,
                },
                auto_return: 'approved',
                notification_url: this.config.urls.webhookUrl,
                external_reference: reservationId,
                metadata: {
                    reservation_id: reservationId,
                    showtime_id: item.showtimeId,
                    movie_title: item.movieTitle,
                    show_datetime: item.showDateTime,
                    user_email: item.userEmail,
                    user_name: item.userName,
                    subscription_type: item.subscriptionType,
                    original_price: originalPrice,
                    final_price: finalPrice,
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
            reservationId,
            finalPrice,
        };
    }

    /**
     * Generate a unique reservation ID
     */
    private generateReservationId(): string {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        return `AMO-${timestamp}-${random}`.toUpperCase();
    }

    /**
     * Get whether sandbox mode is enabled
     */
    isSandbox(): boolean {
        return this.config.mercadopago.sandboxMode;
    }
}
