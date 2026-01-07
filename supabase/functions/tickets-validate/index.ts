// Supabase Edge Function: Validate Ticket
// POST /functions/v1/tickets-validate

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface QRPayload {
    ticketCode: string;
    movieTitle: string;
    showDateTime: string;
    userName: string;
    userEmail: string;
}

// Decode compact QR payload (pipe-delimited)
function decodePayload(encoded: string): QRPayload | null {
    try {
        // New format: AMO|code|movie|datetime|name|email
        if (encoded.startsWith('AMO|')) {
            const parts = encoded.split('|');
            if (parts.length >= 6) {
                return {
                    ticketCode: parts[1],
                    movieTitle: parts[2],
                    showDateTime: parts[3],
                    userName: parts[4],
                    userEmail: parts[5],
                };
            }
        }

        // Legacy format: AMO:base64:checksum
        if (encoded.startsWith('AMO:')) {
            const parts = encoded.split(':');
            if (parts.length === 3) {
                const json = atob(parts[1]);
                return JSON.parse(json) as QRPayload;
            }
        }

        return null;
    } catch {
        return null;
    }
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const body = await req.json();
        const ticketCode = body.ticketCode;

        if (!ticketCode) {
            return new Response(
                JSON.stringify({ error: 'Missing ticketCode' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const payload = decodePayload(ticketCode);

        if (!payload) {
            return new Response(
                JSON.stringify({ status: 'INVALID_CODE', message: 'Código QR no válido' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify({
                status: 'VALID',
                message: '¡Entrada válida!',
                ticketInfo: payload
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Validate error:', error);
        return new Response(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
