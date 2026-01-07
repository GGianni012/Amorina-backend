/**
 * Amorina Club - QR Code Generator
 * Generate QR codes for movie tickets
 */

import QRCode from 'qrcode';
import type { Reservation } from '../core';

export interface QRPayload {
    reservationId: string;
    ticketCode: string;
    movieTitle: string;
    showDateTime: string;
    userName: string;
    userEmail: string;
}

export interface QRGenerationResult {
    ticketCode: string;
    qrDataUrl: string;     // Base64 data URL for displaying in browser
    qrSvg: string;         // SVG string
    qrPayload: string;     // Encoded payload
}

// Secret key for basic encoding (in production, use proper encryption)
const ENCODE_KEY = 'amorina-club-2026';

export class QRGenerator {
    /**
     * Generate a QR code for a reservation
     */
    async generateTicketQR(reservation: Reservation): Promise<QRGenerationResult> {
        const payload: QRPayload = {
            reservationId: reservation.id,
            ticketCode: reservation.ticketCode,
            movieTitle: reservation.movieTitle,
            showDateTime: reservation.showDateTime,
            userName: reservation.userName,
            userEmail: reservation.userEmail,
        };

        // Encode the payload
        const qrPayload = this.encodePayload(payload);

        // Generate QR as data URL (for embedding in websites)
        const qrDataUrl = await QRCode.toDataURL(qrPayload, {
            errorCorrectionLevel: 'H',
            type: 'image/png',
            width: 300,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#ffffff',
            },
        });

        // Generate QR as SVG (for printing)
        const qrSvg = await QRCode.toString(qrPayload, {
            type: 'svg',
            errorCorrectionLevel: 'H',
            width: 300,
            margin: 2,
        });

        return {
            ticketCode: reservation.ticketCode,
            qrDataUrl,
            qrSvg,
            qrPayload,
        };
    }

    /**
     * Encode payload for QR code
     * Uses base64 with a simple signature for basic validation
     */
    encodePayload(payload: QRPayload): string {
        const json = JSON.stringify(payload);
        const base64 = Buffer.from(json).toString('base64');

        // Add a simple checksum
        const checksum = this.simpleChecksum(json);

        return `AMO:${base64}:${checksum}`;
    }

    /**
     * Decode QR payload
     */
    decodePayload(encoded: string): QRPayload | null {
        try {
            // Check format
            if (!encoded.startsWith('AMO:')) {
                return null;
            }

            const parts = encoded.split(':');
            if (parts.length !== 3) {
                return null;
            }

            const base64 = parts[1];
            const checksum = parts[2];

            // Decode base64
            const json = Buffer.from(base64, 'base64').toString('utf-8');

            // Verify checksum
            if (this.simpleChecksum(json) !== checksum) {
                return null;
            }

            return JSON.parse(json) as QRPayload;
        } catch {
            return null;
        }
    }

    /**
     * Simple checksum for basic validation
     */
    private simpleChecksum(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36).substring(0, 6);
    }
}
