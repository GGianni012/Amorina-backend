/**
 * Vercel Serverless Function: Create Checkout
 * POST /api/checkout
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { CheckoutService, type CheckoutItem } from '../mercadopago-service';
import { ReservationManager } from '../reservations-service';
import { SubscriptionSyncService } from '../google-sheets-service';
import { loadConfig, type Showtime } from '../core';

interface CheckoutRequest {
    showtime: Showtime;
    userEmail: string;
    userName: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const config = loadConfig();
        const checkoutService = new CheckoutService(config);
        const reservationManager = new ReservationManager(config);
        const subscriptionSync = new SubscriptionSyncService(config);

        const { showtime, userEmail, userName } = req.body as CheckoutRequest;

        // Validate input
        if (!showtime || !userEmail || !userName) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Check availability
        const availability = await reservationManager.checkAvailability(showtime);
        if (!availability.available) {
            return res.status(400).json({
                error: 'No hay lugares disponibles para esta función',
                spotsRemaining: 0
            });
        }

        // Get user's subscription type
        const subscriptionType = await subscriptionSync.getUserSubscriptionType(userEmail);

        // Create the reservation
        const { reservation, spotsRemaining } = await reservationManager.createReservation({
            showtime,
            userEmail,
            userName,
            subscriptionType,
        });

        // If VIP (free), don't need MercadoPago
        if (subscriptionType === 'VIP' && reservation.pricePaid === 0) {
            return res.status(200).json({
                success: true,
                free: true,
                reservationId: reservation.id,
                ticketCode: reservation.ticketCode,
                spotsRemaining,
            });
        }

        // Create MercadoPago checkout
        const checkoutItem: CheckoutItem = {
            showtimeId: reservation.showtimeId,
            movieTitle: showtime.title,
            showDateTime: showtime.showtime,
            poster: showtime.poster,
            userEmail,
            userName,
            subscriptionType,
        };

        const checkout = await checkoutService.createTicketPreference(checkoutItem);

        return res.status(200).json({
            success: true,
            free: false,
            reservationId: reservation.id,
            preferenceId: checkout.preferenceId,
            initPoint: config.mercadopago.sandboxMode
                ? checkout.sandboxInitPoint
                : checkout.initPoint,
            finalPrice: checkout.finalPrice,
            spotsRemaining,
        });
    } catch (error) {
        console.error('Checkout error:', error);
        return res.status(500).json({
            error: error instanceof Error ? error.message : 'Internal server error'
        });
    }
}
