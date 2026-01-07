/**
 * Amorina Club - QR Code Validator
 * Validate and process scanned QR codes
 */

import { QRGenerator, type QRPayload } from './qr-generator';
import { ReservationSyncService } from '../google-sheets-service';
import type { Reservation, AmorinConfig } from '../core';

export type ValidationStatus =
    | 'VALID'           // Ticket is valid and can be used
    | 'ALREADY_USED'    // Ticket was already scanned
    | 'INVALID_CODE'    // QR code is malformed
    | 'NOT_FOUND'       // Reservation not found
    | 'PAYMENT_PENDING' // Payment not confirmed
    | 'CANCELLED'       // Reservation was cancelled
    | 'EXPIRED';        // Show has already passed

export interface ValidationResult {
    status: ValidationStatus;
    message: string;
    reservation?: Reservation;
    payload?: QRPayload;
}

export class QRValidator {
    private generator: QRGenerator;
    private syncService: ReservationSyncService;

    constructor(config: AmorinConfig) {
        this.generator = new QRGenerator();
        this.syncService = new ReservationSyncService(config);
    }

    /**
     * Validate a scanned QR code
     */
    async validate(qrContent: string): Promise<ValidationResult> {
        // Decode the QR payload
        const payload = this.generator.decodePayload(qrContent);

        if (!payload) {
            return {
                status: 'INVALID_CODE',
                message: 'El código QR no es válido',
            };
        }

        // Get the reservation from sheets
        const reservation = await this.syncService.getReservationByTicketCode(payload.ticketCode);

        if (!reservation) {
            return {
                status: 'NOT_FOUND',
                message: 'Reserva no encontrada',
                payload,
            };
        }

        // Check payment status
        if (reservation.paymentStatus === 'PENDING') {
            return {
                status: 'PAYMENT_PENDING',
                message: 'El pago aún no fue confirmado',
                reservation,
                payload,
            };
        }

        if (reservation.paymentStatus === 'CANCELLED') {
            return {
                status: 'CANCELLED',
                message: 'Esta reserva fue cancelada',
                reservation,
                payload,
            };
        }

        if (reservation.paymentStatus === 'REJECTED') {
            return {
                status: 'CANCELLED',
                message: 'El pago fue rechazado',
                reservation,
                payload,
            };
        }

        // Check if already used
        if (reservation.ticketStatus === 'USED') {
            return {
                status: 'ALREADY_USED',
                message: `Esta entrada ya fue usada el ${reservation.usedAt}`,
                reservation,
                payload,
            };
        }

        // Check if show has passed (optional - allow 3 hours after showtime)
        const showDate = new Date(reservation.showDateTime);
        const now = new Date();
        const hoursAfterShow = (now.getTime() - showDate.getTime()) / (1000 * 60 * 60);

        if (hoursAfterShow > 3) {
            return {
                status: 'EXPIRED',
                message: 'Esta función ya terminó',
                reservation,
                payload,
            };
        }

        // All checks passed!
        return {
            status: 'VALID',
            message: '¡Entrada válida!',
            reservation,
            payload,
        };
    }

    /**
     * Validate and mark ticket as used
     */
    async validateAndUse(qrContent: string): Promise<ValidationResult> {
        const result = await this.validate(qrContent);

        if (result.status === 'VALID' && result.reservation) {
            // Mark as used in Google Sheets
            await this.syncService.markTicketAsUsed(result.reservation.id);

            result.message = '¡Entrada validada y registrada!';
        }

        return result;
    }
}
