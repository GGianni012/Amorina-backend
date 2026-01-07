// Supabase Edge Function: Get Schedule from Google Sheets
// GET /functions/v1/get-schedule

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// Column mapping: Spanish Sheet Headers -> English JSON keys
const COLUMN_MAP: { [key: string]: string } = {
    'DÍA': 'dia',           // Combined with HORA to make showtime
    'HORA': 'hora',         // Combined with DÍA to make showtime
    'PELÍCULA': 'title',
    'DIRECTOR': 'director',
    'SALA': 'theater',
    'WEB': 'website',
    'DIRECCIÓN': 'address',
    'PRECIO': 'price',
    'FILTROS': 'filtros',
    'GENERO': 'genre',
    'POSTER': 'poster',
    'IMDBID': 'imdbid',
    'NACIONALIDAD': 'nationality',
    'TRAILER': 'trailer',
    'AÑO': 'year',
    'DURACIÓN': 'runtime_mins',
    'OVERVIEW': 'overview',
};

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

// Parse date from "DD/MM/YYYY" or similar formats
function parseShowtime(diaStr: string, horaStr: string): string {
    try {
        // Expecting formats like "21/02/2026" for diaStr and "15:00" for horaStr
        const parts = diaStr.split('/');
        if (parts.length >= 3) {
            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            const year = parts[2].length === 2 ? '20' + parts[2] : parts[2];
            const time = horaStr || '00:00';
            // Use Argentina timezone (UTC-3) since schedule times are in local Argentina time
            return `${year}-${month}-${day}T${time}:00-03:00`;
        }
        // Fallback: try parsing as-is
        return new Date(`${diaStr} ${horaStr}`).toISOString();
    } catch {
        return '';
    }
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const spreadsheetId = Deno.env.get('GOOGLE_SCHEDULE_SHEET_ID') || '1PGTSYE6TxvllYd3JnKF1nXFL7WFZHjyAp-oxsv3R9tg';
        const clientEmail = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
        const privateKey = Deno.env.get('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

        if (!clientEmail || !privateKey) {
            return new Response(
                JSON.stringify({ error: 'Credenciales de Google no configuradas' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const token = await getGoogleAccessToken(clientEmail, privateKey);

        // Get spreadsheet metadata to find the first sheet
        const metaResponse = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        const metaData = await metaResponse.json();
        if (!metaResponse.ok) {
            return new Response(JSON.stringify({ error: 'Fallo al leer metadata', detail: metaData }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const sheets = metaData.sheets || [];
        const targetSheet = sheets[0]; // Use first sheet

        if (!targetSheet) {
            return new Response(JSON.stringify({ error: 'No sheets found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const sheetName = targetSheet.properties.title;

        // Read data
        const response = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(sheetName)}'!A1:Z500`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        const data = await response.json();
        const rows = data.values || [];

        if (rows.length < 2) {
            return new Response(JSON.stringify([]), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const headers = rows[0];

        // Map header indices
        const headerIndices: { [key: string]: number } = {};
        headers.forEach((h: string, idx: number) => {
            const normalized = h.toUpperCase().trim();
            if (COLUMN_MAP[normalized]) {
                headerIndices[COLUMN_MAP[normalized]] = idx;
            }
        });

        const movies = rows.slice(1).map((row: any) => {
            const getValue = (key: string) => row[headerIndices[key]] || '';

            // Combine DÍA + HORA into showtime
            const showtime = parseShowtime(getValue('dia'), getValue('hora'));

            return {
                title: getValue('title'),
                theater: getValue('theater') || 'Amorina (caba)',
                price: getValue('price') || '5000',
                website: getValue('website') || 'https://www.instagram.com/amorinacinebar/',
                address: getValue('address') || 'https://www.google.com/maps/search/Gorriti+5745',
                genre: getValue('genre') || getValue('filtros') || 'Amorina Elige',
                director: getValue('director'),
                poster: getValue('poster'),
                imdbid: getValue('imdbid'),
                nationality: getValue('nationality'),
                trailer: getValue('trailer'),
                year: getValue('year'),
                runtime_mins: parseInt(getValue('runtime_mins')) || 0,
                overview: getValue('overview'),
                showtime: showtime,
            };
        }).filter((m: any) => m.title && m.showtime);

        return new Response(
            JSON.stringify(movies),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Error in get-schedule:', error);
        return new Response(
            JSON.stringify({ error: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
