/**
 * Amorina Club - Reservation Manager
 * Handle ticket reservations with capacity limits
 */

import { v4 as uuidv4 } from 'uuid';
import type {
    Reservation,
    Showtime,
    SubscriptionType,
    AmorinConfig,
    PaymentStatus,
    TicketStatus,
} from '../core';
import { MAX_CAPACITY, calculatePrice, generateShowtimeId, formatShowtime } from '../core';
import { ReservationSyncService } from '../google-sheets-service';

export interface CreateReservationInput {
    showtime: Showtime;
    userEmail: string;
    userName: string;
    subscriptionType: SubscriptionType;
}

export interface ReservationResult {
    reservation: Reservation;
    spotsRemaining: number;
}

export class ReservationManager {
    private syncService: ReservationSyncService;
    private config: AmorinConfig;

    constructor(config: AmorinConfig) {
        this.config = config;
        this.syncService = new ReservationSyncService(config);
    }

    /**
     * Initialize the service (create sheets if needed)
     */
    async initialize(): Promise<void> {
        await this.syncService.initialize();
    }

    /**
     * Check availability for a showtime
     */
    async checkAvailability(showtime: Showtime): Promise<{
        available: boolean;
        spotsRemaining: number;
        totalCapacity: number;
    }> {
        const formatted = formatShowtime(showtime.showtime);
        const count = await this.syncService.countApprovedReservations(
            showtime.title,
            formatted.date
        );

        const spotsRemaining = MAX_CAPACITY - count;

        return {
            available: spotsRemaining > 0,
            spotsRemaining,
            totalCapacity: MAX_CAPACITY,
        };
    }

    /**
     * Create a new pending reservation
     */
    async createReservation(input: CreateReservationInput): Promise<ReservationResult> {
        // Check availability first
        const availability = await this.checkAvailability(input.showtime);

        if (!availability.available) {
            throw new Error('Lo sentimos, no hay más lugares disponibles para esta función');
        }

        // Calculate price
        const originalPrice = parseInt(input.showtime.price, 10) || this.config.pricing.basePrice;
        const pricePaid = calculatePrice(originalPrice, input.subscriptionType);

        // Generate ticket code for QR
        const ticketCode = this.generateTicketCode();

        // Create reservation object
        const reservation: Reservation = {
            id: uuidv4(),
            showtimeId: generateShowtimeId(input.showtime.title, input.showtime.showtime),
            movieTitle: input.showtime.title,
            showDateTime: input.showtime.showtime,
            userId: input.userEmail,
            userName: input.userName,
            userEmail: input.userEmail,
            paymentStatus: 'PENDING',
            paymentId: null,
            ticketCode,
            ticketStatus: 'VALID',
            pricePaid,
            originalPrice,
            subscriptionType: input.subscriptionType,
            createdAt: new Date().toISOString(),
            usedAt: null,
        };

        // If VIP subscription (free), auto-approve
        if (input.subscriptionType === 'VIP' && pricePaid === 0) {
            reservation.paymentStatus = 'APPROVED';
        }

        // Save to Google Sheets
        await this.syncService.addReservation(reservation);

        return {
            reservation,
            spotsRemaining: availability.spotsRemaining - 1,
        };
    }

    /**
     * Confirm payment for a reservation
     */
    async confirmPayment(reservationId: string, paymentId: string): Promise<Reservation | null> {
        await this.syncService.updatePaymentStatus(reservationId, 'APPROVED', paymentId);
        return this.syncService.getReservation(reservationId);
    }

    /**
     * Reject payment for a reservation
     */
    async rejectPayment(reservationId: string, paymentId: string): Promise<void> {
        await this.syncService.updatePaymentStatus(reservationId, 'REJECTED', paymentId);
    }

    /**
     * Cancel a reservation
     */
    async cancelReservation(reservationId: string): Promise<void> {
        await this.syncService.updatePaymentStatus(reservationId, 'CANCELLED', '');
    }

    /**
     * Get reservation by ID
     */
    async getReservation(reservationId: string): Promise<Reservation | null> {
        return this.syncService.getReservation(reservationId);
    }

    /**
     * Get reservation by ticket code (for QR scanning)
     */
    async getReservationByTicketCode(ticketCode: string): Promise<Reservation | null> {
        return this.syncService.getReservationByTicketCode(ticketCode);
    }

    /**
     * Mark a ticket as used
     */
    async useTicket(reservationId: string): Promise<void> {
        await this.syncService.markTicketAsUsed(reservationId);
    }

    /**
     * Generate a unique ticket code for QR
     */
    private generateTicketCode(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = 'AMO-';
        for (let i = 0; i < 8; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    /**
     * Get sync service for raw access
     */
    getSyncService(): ReservationSyncService {
        return this.syncService;
    }
}
