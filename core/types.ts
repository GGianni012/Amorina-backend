/**
 * Amorina Club - Core Types
 * Shared TypeScript types for all modules
 */

// =============================================================================
// SHOWTIME (from cartelera JSON)
// =============================================================================

export interface Showtime {
    id: string; // Generated from title + showtime for uniqueness
    title: string;
    theater: string;
    price: number;
    website: string;
    address: string;
    genre: string;
    director: string;
    poster: string;
    imdbid: string;
    nationality: string;
    trailer: string;
    year: string;
    runtime_mins: number | string;
    overview: string;
    showtime: string; // ISO 8601 datetime
}

// =============================================================================
// RESERVATIONS
// =============================================================================

export type PaymentStatus =
    | 'PENDING'      // Esperando pago
    | 'APPROVED'     // Pago confirmado
    | 'REJECTED'     // Pago rechazado
    | 'REFUNDED'     // Reembolsado
    | 'CANCELLED';   // Cancelado

export type TicketStatus =
    | 'VALID'        // QR válido, no usado
    | 'USED'         // QR ya escaneado
    | 'EXPIRED'      // Función ya pasó
    | 'CANCELLED';   // Cancelado

export interface Reservation {
    id: string;                    // UUID
    showtimeId: string;            // Reference to Showtime.id
    movieTitle: string;            // Denormalized for easy display
    showDateTime: string;          // ISO datetime
    userId: string;                // User email
    userName: string;
    userEmail: string;
    paymentStatus: PaymentStatus;
    paymentId: string | null;      // MercadoPago payment ID
    ticketCode: string;            // QR code content
    ticketStatus: TicketStatus;
    pricePaid: number;             // Actual price paid (with discounts)
    originalPrice: number;         // Original price before discounts
    subscriptionType: SubscriptionType | null;
    createdAt: string;             // ISO datetime
    usedAt: string | null;         // When QR was scanned
}

// =============================================================================
// SUBSCRIPTIONS
// =============================================================================

export type SubscriptionType =
    | 'FREE'         // Sin suscripción, paga precio completo
    | 'SUPPORTER'    // 20% descuento
    | 'VIP';         // Gratis

export type SubscriptionStatus =
    | 'ACTIVE'
    | 'EXPIRED'
    | 'CANCELLED'
    | 'PENDING';

export interface Subscription {
    id: string;
    userEmail: string;
    userName: string;
    type: SubscriptionType;
    status: SubscriptionStatus;
    startDate: string;             // ISO date
    endDate: string;               // ISO date
    autoRenew: boolean;
    mercadopagoSubscriptionId: string | null;
    createdAt: string;
}

// =============================================================================
// USERS (derived from Google Auth)
// =============================================================================

export interface User {
    email: string;
    name: string;
    picture?: string;
    subscription: SubscriptionType;
    totalReservations: number;
}

// =============================================================================
// PRICING CONFIGURATION
// =============================================================================

export interface PricingConfig {
    basePrice: number;
    subscriptions: {
        [K in SubscriptionType]: {
            discountPercent: number;
            monthlyPrice: number;
        };
    };
}

export const DEFAULT_PRICING: PricingConfig = {
    basePrice: 6000,
    subscriptions: {
        FREE: {
            discountPercent: 0,
            monthlyPrice: 0,
        },
        SUPPORTER: {
            discountPercent: 20,
            monthlyPrice: 3000,
        },
        VIP: {
            discountPercent: 100,
            monthlyPrice: 6000,
        },
    },
};

// =============================================================================
// GOOGLE SHEETS CONFIGURATION
// =============================================================================

export interface SheetsConfig {
    spreadsheetId: string;
    ranges: {
        reservations: string;        // Sheet name for reservations
        subscriptions: string;       // Sheet name for subscriptions
    };
}

// =============================================================================
// CAPACITY
// =============================================================================

export const MAX_CAPACITY = 60;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Generate a unique showtime ID from title and datetime
 */
export function generateShowtimeId(title: string, showtime: string): string {
    const date = new Date(showtime);
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = date.toISOString().split('T')[1].substring(0, 5).replace(':', '');
    const titleSlug = title.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 30);
    return `${dateStr}-${timeStr}-${titleSlug}`;
}

/**
 * Calculate final price based on subscription
 */
export function calculatePrice(
    basePrice: number,
    subscriptionType: SubscriptionType,
    config: PricingConfig = DEFAULT_PRICING
): number {
    const discount = config.subscriptions[subscriptionType].discountPercent;
    return Math.round(basePrice * (1 - discount / 100));
}

/**
 * Format showtime for display
 */
export function formatShowtime(isoDatetime: string): {
    date: string;
    time: string;
    fullDisplay: string;
} {
    const date = new Date(isoDatetime);
    const dateStr = date.toLocaleDateString('es-AR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
    });
    const timeStr = date.toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
    });
    return {
        date: dateStr,
        time: timeStr,
        fullDisplay: `${dateStr} - ${timeStr}`,
    };
}
