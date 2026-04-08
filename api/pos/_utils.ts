import type { VercelRequest, VercelResponse } from '@vercel/node';

export function setPosCors(res: VercelResponse, methods: string): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export function handleOptions(req: VercelRequest, res: VercelResponse): boolean {
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return true;
    }
    return false;
}

export function parseNumber(input: unknown): number | null {
    const parsed = typeof input === 'number' ? input : Number(input);
    return Number.isFinite(parsed) ? parsed : null;
}

export function parsePositiveNumber(input: unknown): number | null {
    const parsed = parseNumber(input);
    if (parsed === null || parsed <= 0) return null;
    return parsed;
}

export function parseNullableString(input: unknown): string | null {
    if (typeof input !== 'string') return null;
    const normalized = input.trim();
    return normalized.length > 0 ? normalized : null;
}

export function requireMethod(req: VercelRequest, res: VercelResponse, method: string): boolean {
    if (req.method !== method) {
        res.status(405).json({ error: 'Method not allowed' });
        return false;
    }
    return true;
}
