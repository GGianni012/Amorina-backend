/**
 * Amorina Club - Configuration
 * Environment configuration and constants
 */

export interface AmorinConfig {
    // Supabase
    supabase: {
        url: string;
        serviceKey: string; // service_role key for backend operations
    };

    // MercadoPago
    mercadopago: {
        accessToken: string;
        publicKey: string;
        webhookSecret?: string;
        sandboxMode: boolean;
    };

    // Google Sheets
    googleSheets: {
        spreadsheetId: string;
        credentials: {
            client_email: string;
            private_key: string;
        };
    };

    // Scanner App
    scanner: {
        username: string;
        password: string;
    };

    // URLs
    urls: {
        baseUrl: string;           // https://amorina.club
        successUrl: string;        // After successful payment
        failureUrl: string;        // After failed payment
        pendingUrl: string;        // After pending payment
        webhookUrl: string;        // MercadoPago webhook endpoint
    };

    // Pricing
    pricing: {
        basePrice: number;
        currency: string;
    };
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): AmorinConfig {
    const requiredEnvVars = [
        'MERCADOPAGO_ACCESS_TOKEN',
        'MERCADOPAGO_PUBLIC_KEY',
        'GOOGLE_SHEETS_ID',
        'GOOGLE_SERVICE_ACCOUNT_EMAIL',
        'GOOGLE_PRIVATE_KEY',
        'SCANNER_USERNAME',
        'SCANNER_PASSWORD',
        'BASE_URL',
    ];

    const missing = requiredEnvVars.filter((v) => !process.env[v]);
    if (missing.length > 0) {
        console.warn(`Missing environment variables: ${missing.join(', ')}`);
    }

    return {
        supabase: {
            url: process.env.SUPABASE_URL || 'https://iazjntvrxfyxlinkuiwx.supabase.co',
            serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        },
        mercadopago: {
            accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || '',
            publicKey: process.env.MERCADOPAGO_PUBLIC_KEY || '',
            webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET,
            sandboxMode: process.env.MERCADOPAGO_SANDBOX === 'true',
        },
        googleSheets: {
            spreadsheetId: process.env.GOOGLE_SHEETS_ID || '',
            credentials: {
                client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
                private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
            },
        },
        scanner: {
            username: process.env.SCANNER_USERNAME || 'amorina',
            password: process.env.SCANNER_PASSWORD || '',
        },
        urls: {
            baseUrl: process.env.BASE_URL || 'https://amorina.club',
            successUrl: process.env.SUCCESS_URL || `${process.env.BASE_URL}/reserva/exito`,
            failureUrl: process.env.FAILURE_URL || `${process.env.BASE_URL}/reserva/error`,
            pendingUrl: process.env.PENDING_URL || `${process.env.BASE_URL}/reserva/pendiente`,
            webhookUrl: process.env.WEBHOOK_URL || `${process.env.BASE_URL}/api/webhook/mercadopago`,
        },
        pricing: {
            basePrice: parseInt(process.env.BASE_PRICE || '6000', 10),
            currency: 'ARS',
        },
    };
}

/**
 * Validate configuration
 */
export function validateConfig(config: AmorinConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.mercadopago.accessToken) {
        errors.push('MercadoPago access token is required');
    }

    if (!config.googleSheets.spreadsheetId) {
        errors.push('Google Sheets ID is required');
    }

    if (!config.googleSheets.credentials.client_email) {
        errors.push('Google service account email is required');
    }

    if (!config.googleSheets.credentials.private_key) {
        errors.push('Google private key is required');
    }

    if (!config.scanner.password) {
        errors.push('Scanner password is required');
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}
