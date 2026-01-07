// Supabase Edge Function: Sync Reservation to Google Sheets
// POST /functions/v1/sync-reservation

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Day names in Spanish
const DIAS = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];

// Get sheet name from date (e.g., "SÁBADO 5/1")
function getSheetName(dateString: string): string {
    const date = new Date(dateString);
    const dayName = DIAS[date.getDay()];
    const day = date.getDate();
    const month = date.getMonth() + 1;
    return `${dayName} ${day}/${month}`;
}

// Get Google access token
async function getGoogleAccessToken(clientEmail: string, privateKey: string): Promise<string> {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
        iss: clientEmail,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
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

async function writeToSheet(metadata: any) {
    // Use the reservations sheet ID (different from schedule sheet)
    const spreadsheetId = Deno.env.get('GOOGLE_RESERVATIONS_SHEET_ID') || '16uYInoI-Ap44zjj3tMwX9i8Yh1SYR0zGSshovibOVqs';
    const clientEmail = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
    const privateKey = Deno.env.get('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

    if (!clientEmail || !privateKey) {
        console.error('Google credentials not configured');
        return { success: false, error: 'Credentials not configured' };
    }

    try {
        const token = await getGoogleAccessToken(clientEmail, privateKey);
        const sheetName = getSheetName(metadata.show_datetime);

        // Read current content to find movie block
        const readResponse = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(sheetName)}'!A:H`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        if (!readResponse.ok) {
            const errorText = await readResponse.text();
            console.error('Failed to read sheet:', errorText);
            return { success: false, error: 'Failed to read sheet', detail: errorText };
        }

        const readData = await readResponse.json();
        const rows = readData.values || [];

        // Find movie block (e.g. "AMORINA - MOVIE TITLE (TIME)")
        const searchTitle = metadata.movie_title.toUpperCase();
        let targetRow = -1;

        for (let i = 0; i < rows.length; i++) {
            if (rows[i] && rows[i][0] && rows[i][0].toUpperCase().includes(searchTitle)) {
                // Found the block. Look for the first empty row after headers
                for (let j = i + 2; j < rows.length; j++) {
                    if (!rows[j] || !rows[j][1]) { // If NOMBRE is empty
                        targetRow = j + 1; // 1-indexed
                        break;
                    }
                    if (rows[j][0] && rows[j][0].startsWith('TOTAL')) break; // Stop at totals
                }
                break;
            }
        }

        if (targetRow === -1) {
            console.error('Movie block not found for:', searchTitle);
            return { success: false, error: 'Movie block not found', movie: searchTitle };
        }

        const showDate = new Date(metadata.show_datetime);
        const dateStr = `${showDate.getDate()}/${showDate.getMonth() + 1}`;

        // Prepare data row
        const values = [[
            dateStr,
            metadata.user_name,
            metadata.quantity,
            metadata.total_amount,
            metadata.qr_payload,
            'APROBADO',
            'VÁLIDO',
            ''
        ]];

        // Update row
        const writeResponse = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(sheetName)}'!A${targetRow}?valueInputOption=USER_ENTERED`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ values }),
            }
        );

        if (!writeResponse.ok) {
            const errorText = await writeResponse.text();
            console.error('Failed to write to sheet:', errorText);
            return { success: false, error: 'Failed to write', detail: errorText };
        }

        console.log(`Reservation synced to sheet: ${sheetName}, row ${targetRow}`);
        return { success: true, sheetName, row: targetRow };

    } catch (error) {
        console.error('Error syncing to sheets:', error);
        return { success: false, error: String(error) };
    }
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const metadata = await req.json();

        if (!metadata.movie_title || !metadata.show_datetime) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const result = await writeToSheet(metadata);

        return new Response(
            JSON.stringify(result),
            {
                status: result.success ? 200 : 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
        );

    } catch (error) {
        console.error('Sync error:', error);
        return new Response(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
