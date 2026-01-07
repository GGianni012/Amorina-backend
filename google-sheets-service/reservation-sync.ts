/**
 * Amorina Club - Reservation Sync Service
 * Sync reservations to Google Sheets
 */

import { SheetsClient } from './sheets-client';
import type { Reservation, Showtime, AmorinConfig } from '../core';
import { formatShowtime, generateShowtimeId } from '../core';

// Headers for the reservation sheet
const RESERVATION_HEADERS = [
    'ID',
    'Película',
    'Fecha',
    'Hora',
    'Nombre',
    'Email',
    'Estado Pago',
    'ID Pago',
    'Código QR',
    'Estado QR',
    'Precio Pagado',
    'Precio Original',
    'Suscripción',
    'Fecha Reserva',
    'Fecha Uso',
];

export class ReservationSyncService {
    private client: SheetsClient;
    private mainSheetName = 'Reservas';

    constructor(config: AmorinConfig) {
        this.client = new SheetsClient(config);
    }

    /**
     * Initialize the reservations sheet if it doesn't exist
     */
    async initialize(): Promise<void> {
        const exists = await this.client.sheetExists(this.mainSheetName);
        if (!exists) {
            await this.client.createSheet(this.mainSheetName, RESERVATION_HEADERS);
        }
    }

    /**
     * Create sheet for a specific showtime (for per-function tracking)
     */
    async createShowtimeSheet(showtime: Showtime): Promise<string> {
        const formatted = formatShowtime(showtime.showtime);
        const sheetName = `${showtime.title} - ${formatted.date}`.substring(0, 50);

        const exists = await this.client.sheetExists(sheetName);
        if (!exists) {
            await this.client.createSheet(sheetName, RESERVATION_HEADERS);
        }

        return sheetName;
    }

    /**
     * Add a new reservation to the sheet
     */
    async addReservation(reservation: Reservation): Promise<void> {
        const formatted = formatShowtime(reservation.showDateTime);

        const row = [
            reservation.id,
            reservation.movieTitle,
            formatted.date,
            formatted.time,
            reservation.userName,
            reservation.userEmail,
            reservation.paymentStatus,
            reservation.paymentId || '',
            reservation.ticketCode,
            reservation.ticketStatus,
            reservation.pricePaid,
            reservation.originalPrice,
            reservation.subscriptionType || 'FREE',
            reservation.createdAt,
            reservation.usedAt || '',
        ];

        await this.client.appendRow(this.mainSheetName, row);
    }

    /**
     * Update reservation payment status
     */
    async updatePaymentStatus(
        reservationId: string,
        paymentStatus: string,
        paymentId: string
    ): Promise<void> {
        const rowNumber = await this.client.findRowByValue(this.mainSheetName, 0, reservationId);

        if (rowNumber) {
            // Update columns G (7) and H (8) - Estado Pago and ID Pago
            await this.client.updateCell(this.mainSheetName, `G${rowNumber}`, paymentStatus);
            await this.client.updateCell(this.mainSheetName, `H${rowNumber}`, paymentId);
        }
    }

    /**
     * Mark ticket as used
     */
    async markTicketAsUsed(reservationId: string): Promise<void> {
        const rowNumber = await this.client.findRowByValue(this.mainSheetName, 0, reservationId);

        if (rowNumber) {
            const now = new Date().toISOString();
            // Update column J (10) - Estado QR, and O (15) - Fecha Uso
            await this.client.updateCell(this.mainSheetName, `J${rowNumber}`, 'USED');
            await this.client.updateCell(this.mainSheetName, `O${rowNumber}`, now);
        }
    }

    /**
     * Get reservation by ID
     */
    async getReservation(reservationId: string): Promise<Reservation | null> {
        const rowNumber = await this.client.findRowByValue(this.mainSheetName, 0, reservationId);

        if (!rowNumber) return null;

        const data = await this.client.readRange(`'${this.mainSheetName}'!A${rowNumber}:O${rowNumber}`);
        if (!data || data.length === 0) return null;

        const row = data[0];
        return this.rowToReservation(row);
    }

    /**
     * Get reservation by ticket code
     */
    async getReservationByTicketCode(ticketCode: string): Promise<Reservation | null> {
        const rowNumber = await this.client.findRowByValue(this.mainSheetName, 8, ticketCode);

        if (!rowNumber) return null;

        const data = await this.client.readRange(`'${this.mainSheetName}'!A${rowNumber}:O${rowNumber}`);
        if (!data || data.length === 0) return null;

        const row = data[0];
        return this.rowToReservation(row);
    }

    /**
     * Get all reservations for a showtime
     */
    async getReservationsForShowtime(showtimeId: string): Promise<Reservation[]> {
        const data = await this.client.readSheet(this.mainSheetName);
        const reservations: Reservation[] = [];

        // Skip header row
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            // Generate showtime ID from movie title and datetime to match
            if (row[1] && row[2]) {
                // Check if this matches the showtime
                const reservation = this.rowToReservation(row);
                if (reservation) {
                    // We need to check by matching movie + date/time
                    reservations.push(reservation);
                }
            }
        }

        return reservations;
    }

    /**
     * Count approved reservations for a showtime
     */
    async countApprovedReservations(movieTitle: string, showDate: string): Promise<number> {
        const data = await this.client.readSheet(this.mainSheetName);
        let count = 0;

        // Skip header row
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (
                row[1] === movieTitle && // Movie title matches
                row[2] === showDate && // Date matches
                row[6] === 'APPROVED' // Payment approved
            ) {
                count++;
            }
        }

        return count;
    }

    /**
     * Convert a sheet row to a Reservation object
     */
    private rowToReservation(row: string[]): Reservation | null {
        if (!row || row.length < 14) return null;

        return {
            id: row[0],
            showtimeId: '', // Would need to be reconstructed
            movieTitle: row[1],
            showDateTime: row[2], // This is formatted, not ISO
            userId: row[5],
            userName: row[4],
            userEmail: row[5],
            paymentStatus: row[6] as Reservation['paymentStatus'],
            paymentId: row[7] || null,
            ticketCode: row[8],
            ticketStatus: row[9] as Reservation['ticketStatus'],
            pricePaid: parseFloat(row[10]) || 0,
            originalPrice: parseFloat(row[11]) || 0,
            subscriptionType: (row[12] as Reservation['subscriptionType']) || null,
            createdAt: row[13],
            usedAt: row[14] || null,
        };
    }

    /**
     * Get raw client for advanced operations
     */
    getClient(): SheetsClient {
        return this.client;
    }
}
