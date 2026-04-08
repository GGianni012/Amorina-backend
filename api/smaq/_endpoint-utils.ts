import type { VercelRequest, VercelResponse } from '@vercel/node';
import { WalletSyncService } from '../../smaq-service';

interface WalletRuntimeConfig {
    issuerId: string;
    serviceAccountEmail: string;
    serviceAccountKey: string;
}

/**
 * Apply basic JSON CORS headers for ABA endpoints.
 */
export function setCors(res: VercelResponse, methods: string): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * Handle OPTIONS preflight requests.
 */
export function handleOptions(req: VercelRequest, res: VercelResponse): boolean {
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return true;
    }
    return false;
}

/**
 * Normalize and validate email input.
 */
export function normalizeEmail(input: unknown): string | null {
    if (typeof input !== 'string') return null;
    const normalized = input.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
}

/**
 * Parse positive numeric amounts from request payloads.
 */
export function parsePositiveAmount(input: unknown): number | null {
    const parsed = typeof input === 'number' ? input : Number(input);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function getWalletRuntimeConfig(): WalletRuntimeConfig | null {
    const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID || '';
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
    const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_PRIVATE_KEY || '';
    const serviceAccountKey = rawKey.replace(/\\n/g, '\n');

    if (!issuerId || !serviceAccountEmail || !serviceAccountKey) {
        return null;
    }

    return {
        issuerId,
        serviceAccountEmail,
        serviceAccountKey
    };
}

function buildWalletSyncService(): WalletSyncService | null {
    const config = getWalletRuntimeConfig();
    if (!config) return null;

    return new WalletSyncService({
        issuerId: config.issuerId,
        serviceAccountEmail: config.serviceAccountEmail,
        serviceAccountKey: config.serviceAccountKey
    });
}

/**
 * Resolve email from Google Wallet pass data when only objectId is available.
 */
export async function resolveEmailFromWalletObjectId(walletObjectId: string): Promise<string | null> {
    if (!walletObjectId) return null;

    const walletSync = buildWalletSyncService();
    if (!walletSync) return null;

    try {
        const passData = await walletSync.getPass(walletObjectId);
        const module = passData?.textModulesData?.find((m: { id?: string; body?: string }) => m.id === 'email');
        return normalizeEmail(module?.body);
    } catch (error) {
        console.error('Wallet lookup failed:', error);
        return null;
    }
}

/**
 * Non-blocking wallet balance sync.
 */
export async function syncWalletBalanceIfPresent(
    walletObjectId: string | undefined,
    newBalance: number
): Promise<void> {
    if (!walletObjectId) return;

    const walletSync = buildWalletSyncService();
    if (!walletSync) return;

    try {
        await walletSync.updateBalance(walletObjectId, newBalance);
    } catch (error) {
        console.error('Wallet sync failed (non-blocking):', error);
    }
}
