/**
 * Vercel Serverless Function: MercadoPago Webhook Handler
 * POST /api/webhook/mercadopago
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { WebhookHandler, type WebhookPayload } from '../../mercadopago-service';
import { ReservationSyncService } from '../../google-sheets-service';
import { QRGenerator } from '../../qr-service';
import { loadConfig } from '../../core';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const config = loadConfig();
        const webhookHandler = new WebhookHandler(config);
        const reservationSync = new ReservationSyncService(config);
        const qrGenerator = new QRGenerator();

        // Parse webhook payload
        const payload = req.body as WebhookPayload;

        // Process the webhook
        const paymentInfo = await webhookHandler.processWebhook(payload);

        if (!paymentInfo) {
            // Not a payment notification, acknowledge anyway
            return res.status(200).json({ received: true, processed: false });
        }

        // Update reservation status in Google Sheets
        await reservationSync.updatePaymentStatus(
            paymentInfo.externalReference,
            paymentInfo.status,
            paymentInfo.id
        );

        console.log(`Payment ${paymentInfo.id} processed: ${paymentInfo.status}`);

        return res.status(200).json({
            received: true,
            processed: true,
            paymentId: paymentInfo.id,
            status: paymentInfo.status,
        });
    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
