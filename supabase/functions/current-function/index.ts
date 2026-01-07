// Supabase Edge Function: Get Current Function Reservations
// GET /functions/v1/current-function

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const DIAS = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];

// Get Google access token
async function getGoogleAccessToken(clientEmail: string, privateKey: string): Promise<string> {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
        iss: clientEmail,
        scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
    };

    const encoder = new TextEncoder();
    const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const claimB64 = btoa(JSON.stringify(claim)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const unsignedToken = `${headerB64}.${claimB64}`;

    const key = await crypto.subtle.importKey(
        'pkcs8',
        pemToArrayBuffer(privateKey),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        key,
        encoder.encode(unsignedToken)
    );

    const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    const jwt = `${unsignedToken}.${signatureB64}`;

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });

    const tokenData = await tokenResponse.json();
    return tokenData.access_token;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
    const b64 = pem
        .replace('-----BEGIN PRIVATE KEY-----', '')
        .replace('-----END PRIVATE KEY-----', '')
        .replace(/\s/g, '');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

// Get sheet name for today
function getTodaySheetName(): string {
    const now = new Date();
    const dayName = DIAS[now.getDay()];
    const day = now.getDate();
    const month = now.getMonth() + 1;
    return `${dayName} ${day}/${month}`;
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const spreadsheetId = Deno.env.get('GOOGLE_SHEETS_ID');
        const clientEmail = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
        const privateKey = Deno.env.get('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

        if (!spreadsheetId || !clientEmail || !privateKey) {
            return new Response(
                JSON.stringify({ error: 'Credenciales no configuradas' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Check for date query parameter (for testing)
        const url = new URL(req.url);
        const dateParam = url.searchParams.get('date');
        let targetDate: Date;

        if (dateParam) {
            targetDate = new Date(dateParam + 'T12:00:00');
        } else {
            targetDate = new Date();
        }

        const token = await getGoogleAccessToken(clientEmail, privateKey);

        // Get sheet name from target date
        const dayName = DIAS[targetDate.getDay()];
        const day = targetDate.getDate();
        const month = targetDate.getMonth() + 1;
        const sheetName = `${dayName} ${day}/${month}`;

        // Try to read today's sheet
        const response = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(sheetName)}'!A:H`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        if (!response.ok) {
            // Sheet doesn't exist for today
            return new Response(
                JSON.stringify({
                    sheetName,
                    functions: [],
                    message: 'No hay funciones programadas para hoy'
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const data = await response.json();
        const rows = data.values || [];

        // Parse the sheet to find movie blocks and their reservations
        const functions: any[] = [];
        let currentFunction: any = null;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row || !row[0]) continue;

            // Check if this is a movie title row (starts with "AMORINA -")
            if (row[0].startsWith('AMORINA -')) {
                if (currentFunction) {
                    functions.push(currentFunction);
                }
                currentFunction = {
                    title: row[0],
                    reservations: [],
                    totalEntradas: 0,
                    usadas: 0
                };
            }
            // Check if this is a data row (has a name in column B and is not header)
            else if (currentFunction && row[1] && row[0] !== 'FECHA' && !row[0].startsWith('TOTAL')) {
                const reservation = {
                    fecha: row[0] || '',
                    nombre: row[1] || '',
                    cantidad: parseInt(row[2]) || 0,
                    codigoQR: row[4] || '',
                    estadoPago: row[5] || '',
                    estadoUso: row[6] || '',
                    fechaUso: row[7] || ''
                };

                if (reservation.nombre) {
                    currentFunction.reservations.push(reservation);
                    currentFunction.totalEntradas += reservation.cantidad;
                    if (reservation.estadoUso === 'USADO') {
                        currentFunction.usadas += reservation.cantidad;
                    }
                }
            }
        }

        if (currentFunction) {
            functions.push(currentFunction);
        }

        // Find current/next function based on time
        const now = new Date();
        const currentHour = now.getHours();

        // Simple logic: show the function that's happening now or next
        // Assuming functions are in order and titles contain time like "(15:00)"
        let currentFunctionIndex = 0;
        for (let i = 0; i < functions.length; i++) {
            const title = functions[i].title;
            const timeMatch = title.match(/\((\d{1,2}):(\d{2})\)/);
            if (timeMatch) {
                const funcHour = parseInt(timeMatch[1]);
                if (funcHour <= currentHour + 1) {
                    currentFunctionIndex = i;
                }
            }
        }

        return new Response(
            JSON.stringify({
                sheetName,
                currentTime: now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
                functions,
                currentFunctionIndex,
                currentFunction: functions[currentFunctionIndex] || null
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Error:', error);
        return new Response(
            JSON.stringify({ error: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
