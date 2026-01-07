/**
 * Vercel Serverless Function: Mark Ticket as Used
 * POST /api/tickets/use
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { QRValidator } from '../../qr-service';
import { loadConfig } from '../../core';

interface UseRequest {
    ticketCode: string;  // The raw QR code content
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
        const validator = new QRValidator(config);

        const { ticketCode } = req.body as UseRequest;

        if (!ticketCode) {
            return res.status(400).json({ error: 'Missing ticketCode' });
        }

        // Validate and mark as used
        const result = await validator.validateAndUse(ticketCode);

        return res.status(200).json({
            status: result.status,
            message: result.message,
        });
    } catch (error) {
        console.error('Use ticket error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
