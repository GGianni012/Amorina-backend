/**
 * Amorina Club - MercadoPago Webhook Handler
 * Process payment notifications from MercadoPago
 */

import { MercadoPagoConfig, Payment } from 'mercadopago';
import type { AmorinConfig, PaymentStatus } from '../core';

export interface WebhookPayload {
    id: number;
    live_mode: boolean;
    type: string;
    date_created: string;
    user_id: number;
    api_version: string;
    action: string;
    data: {
        id: string;
    };
}

export interface PaymentInfo {
    id: string;
    status: PaymentStatus;
    externalReference: string;     // Our reservation ID
    metadata: {
        reservation_id: string;
        showtime_id: string;
        movie_title: string;
        show_datetime: string;
        user_email: string;
        user_name: string;
        subscription_type: string;
        original_price: number;
        final_price: number;
    };
    transactionAmount: number;
    dateApproved: string | null;
}

export class WebhookHandler {
    private client: MercadoPagoConfig;

    constructor(config: AmorinConfig) {
        this.client = new MercadoPagoConfig({
            accessToken: config.mercadopago.accessToken,
        });
    }

    /**
     * Process incoming webhook notification
     */
    async processWebhook(payload: WebhookPayload): Promise<PaymentInfo | null> {
        // Only process payment notifications
        if (payload.type !== 'payment') {
            console.log(`Ignoring webhook type: ${payload.type}`);
            return null;
        }

        // Get payment details
        const payment = new Payment(this.client);
        const paymentData = await payment.get({ id: payload.data.id });

        if (!paymentData) {
            throw new Error(`Payment not found: ${payload.data.id}`);
        }

        // Map MercadoPago status to our status
        const statusMap: Record<string, PaymentStatus> = {
            approved: 'APPROVED',
            pending: 'PENDING',
            authorized: 'PENDING',
            in_process: 'PENDING',
            in_mediation: 'PENDING',
            rejected: 'REJECTED',
            cancelled: 'CANCELLED',
            refunded: 'REFUNDED',
            charged_back: 'REFUNDED',
        };

        const status = statusMap[paymentData.status || ''] || 'PENDING';

        return {
            id: String(paymentData.id),
            status,
            externalReference: paymentData.external_reference || '',
            metadata: paymentData.metadata as PaymentInfo['metadata'],
            transactionAmount: paymentData.transaction_amount || 0,
            dateApproved: paymentData.date_approved || null,
        };
    }

    /**
     * Verify webhook signature (optional but recommended)
     */
    verifySignature(
        xSignature: string,
        xRequestId: string,
        dataId: string,
        secret: string
    ): boolean {
        // MercadoPago signature verification
        // Format: ts=<timestamp>,v1=<hash>
        const parts = xSignature.split(',');
        const tsMatch = parts.find((p) => p.startsWith('ts='));
        const v1Match = parts.find((p) => p.startsWith('v1='));

        if (!tsMatch || !v1Match) {
            return false;
        }

        const ts = tsMatch.split('=')[1];
        const v1 = v1Match.split('=')[1];

        // Create the manifest string
        const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

        // Calculate HMAC-SHA256
        const crypto = require('crypto');
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(manifest);
        const calculatedSignature = hmac.digest('hex');

        return calculatedSignature === v1;
    }
}
