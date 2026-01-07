// Supabase Edge Function: Mark Ticket as Used
// POST /functions/v1/tickets-use

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

// Day names in Spanish
const DIAS = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];

// Update ticket status in Google Sheets - searches across all date sheets
async function markTicketAsUsed(ticketCode: string, searchMode: boolean = false): Promise<{ success: boolean, message: string, status?: string, movieInfo?: string, detail?: { sheet: string, row: number } }> {
    const spreadsheetId = Deno.env.get('GOOGLE_RESERVATIONS_SHEET_ID') || '16uYInoI-Ap44zjj3tMwX9i8Yh1SYR0zGSshovibOVqs';
    const clientEmail = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
    const privateKey = Deno.env.get('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

    if (!clientEmail || !privateKey) {
        console.error('Missing Google Sheets credentials');
        return { success: false, message: 'Credenciales no configuradas' };
    }

    try {
        const token = await getGoogleAccessToken(clientEmail, privateKey);

        // Get list of sheets
        const metaResponse = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        if (!metaResponse.ok) {
            return { success: false, message: 'Error leyendo metadata' };
        }

        const metadata = await metaResponse.json();
        const sheetNames = metadata.sheets
            ?.map((s: any) => s.properties.title)
            .filter((name: string) => DIAS.some(d => name.startsWith(d))) || [];

        // Search in each date sheet for the ticket code
        for (const sheetName of sheetNames) {
            const searchResponse = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(sheetName)}'!A:H`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );

            if (!searchResponse.ok) continue;

            const data = await searchResponse.json();
            const rows = data.values || [];

            // Find the row with matching ticket code in column E (CÓDIGO QR, index 4)
            // The code might be embedded in the QR payload: AMO|CODE|...
            for (let i = 0; i < rows.length; i++) {
                const qrCell = rows[i][4] || ''; // Column E

                // Check if this cell contains the ticket code
                let foundCode = false;
                if (qrCell === ticketCode) {
                    foundCode = true;
                } else if (qrCell.includes('|')) {
                    // Parse QR payload: AMO|CODE|movie|date|name|email
                    const parts = qrCell.split('|');
                    if (parts.length >= 2 && parts[1] === ticketCode) {
                        foundCode = true;
                    }
                }

                if (foundCode) {
                    const rowNum = i + 1; // Sheets is 1-indexed
                    const currentStatus = rows[i][6] || ''; // Column G = ESTADO USO

                    if (currentStatus === 'USADO' || currentStatus === 'USED') {
                        return { success: false, message: 'Esta entrada ya fue usada', status: 'ALREADY_USED' };
                    }

                    // Find the movie header by searching upwards from the current row
                    let movieHeader = '';
                    console.log(`Searching for header upwards from row ${i}...`);
                    for (let j = i - 1; j >= 0; j--) {
                        // Check Column A (index 0), B (index 1), or any column if it's a merged row
                        const rowData = rows[j];
                        const rowText = rowData.join(' ').toUpperCase();
                        if (rowText.includes('AMORINA -')) {
                            movieHeader = rowData.find((c: string) => c.toUpperCase().includes('AMORINA -')) || '';
                            movieHeader = movieHeader.replace(/AMORINA\s*-\s*/i, '').trim();
                            console.log(`Found header in row ${j}: ${movieHeader}`);
                            break;
                        }
                    }

                    // Fetch extra details for display
                    let details = {
                        movieTitle: movieHeader || 'Película',
                        userName: rows[i][1] || 'Usuario' // Column B
                    };

                    try {
                        const supabaseUrl = Deno.env.get('SUPABASE_URL');
                        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
                        if (supabaseUrl && supabaseKey) {
                            console.log(`Querying Supabase for ticket: ${ticketCode}`);
                            const sbRes = await fetch(`${supabaseUrl}/rest/v1/purchases?ticket_code=eq.${ticketCode}&select=movie_title,showtime,user_name`, {
                                headers: { 'Authorization': `Bearer ${supabaseKey}`, 'apikey': supabaseKey }
                            });
                            if (sbRes.ok) {
                                const sbData = await sbRes.json();
                                if (sbData.length > 0) {
                                    const p = sbData[0];
                                    details.userName = p.user_name || details.userName;
                                    if (p.showtime) {
                                        const date = new Date(p.showtime);
                                        const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Argentina/Buenos_Aires' });
                                        details.movieTitle = `${p.movie_title} (${timeStr})`;
                                        console.log(`Found info in Supabase: ${details.movieTitle}`);
                                    } else {
                                        details.movieTitle = p.movie_title;
                                    }
                                } else {
                                    console.log('No matching record found in Supabase.');
                                }
                            } else {
                                console.error('Supabase query failed:', await sbRes.text());
                            }
                        }
                    } catch (e) {
                        console.error('Error fetching Supabase details:', e);
                    }

                    // Final fallback check
                    if (!details.movieTitle || details.movieTitle === 'Película') {
                        details.movieTitle = 'Película / Horario no encontrado';
                        console.log('Using final fallback for movie title.');
                    }

                    // If searchMode, just return that it's valid without marking
                    if (searchMode) {
                        return {
                            success: true,
                            message: `Entrada válida: ${details.userName}`,
                            status: 'VALID',
                            movieInfo: details.movieTitle
                        };
                    }

                    console.log(`Ticket ${ticketCode} found in ${sheetName}, row ${rowNum}. Updating status...`);

                    // Update status to USADO (column G) and FECHA DE USO (column H)
                    const updateResponse = await fetch(
                        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(sheetName)}'!G${rowNum}:H${rowNum}?valueInputOption=USER_ENTERED`,
                        {
                            method: 'PUT',
                            headers: {
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                values: [['USADO', new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })]]
                            }),
                        }
                    );

                    if (!updateResponse.ok) {
                        const errorMsg = await updateResponse.text();
                        console.error('Failed to update Google Sheet:', errorMsg);
                        return { success: false, message: 'Error actualizando la hoja de Excel' };
                    }

                    console.log(`Ticket ${ticketCode} marked as USADO in ${sheetName}, row ${rowNum}`);

                    // --- Sync with Supabase ---
                    try {
                        const supabaseUrl = Deno.env.get('SUPABASE_URL');
                        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

                        if (supabaseUrl && supabaseKey) {
                            console.log(`Syncing ticket ${ticketCode} usage to Supabase...`);
                            const supabaseResponse = await fetch(`${supabaseUrl}/rest/v1/purchases?ticket_code=eq.${ticketCode}`, {
                                method: 'PATCH',
                                headers: {
                                    'Authorization': `Bearer ${supabaseKey}`,
                                    'apikey': supabaseKey,
                                    'Content-Type': 'application/json',
                                    'Prefer': 'return=minimal'
                                },
                                body: JSON.stringify({
                                    status: 'used',
                                    used_at: new Date().toISOString()
                                })
                            });

                            if (supabaseResponse.ok) {
                                console.log(`Successfully synced ticket ${ticketCode} to Supabase.`);
                            } else {
                                const errorData = await supabaseResponse.text();
                                console.error(`Failed to sync ticket ${ticketCode} to Supabase:`, errorData);
                            }
                        }
                    } catch (supabaseError) {
                        console.error('Error syncing with Supabase:', supabaseError);
                        // We don't return error here because GSheets was successful
                    }
                    // --------------------------

                    return {
                        success: true,
                        message: `¡Entrada validada en ${sheetName}!`,
                        status: 'VALID',
                        detail: { sheet: sheetName, row: rowNum }
                    };
                }
            }
        }

        console.error('Ticket not found:', ticketCode);
        return { success: false, message: `Ticket ${ticketCode} no encontrado`, status: 'NOT_FOUND' };
    } catch (error) {
        console.error('Error updating ticket:', error);
        return { success: false, message: 'Error interno' };
    }
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const body = await req.json();
        // Accept either ticketCode directly (e.g., AMO-XV73JBVA) or full payload
        let ticketCode = body.ticketCode;

        if (!ticketCode) {
            return new Response(
                JSON.stringify({ status: 'ERROR', message: 'ticketCode requerido' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // If it's a full QR payload, extract just the ticket code
        if (ticketCode.startsWith('AMO|')) {
            const parts = ticketCode.split('|');
            ticketCode = parts[1]; // Extract ticket code from payload
        } else if (ticketCode.startsWith('AMO:')) {
            // Legacy base64 format
            try {
                const parts = ticketCode.split(':');
                const json = atob(parts[1]);
                const data = JSON.parse(json);
                ticketCode = data.ticketCode;
            } catch {
                // Keep as-is if can't decode
            }
        }

        // Mark ticket as used in Google Sheets (or just search if searchMode)
        const searchMode = body.searchMode === true;
        const result = await markTicketAsUsed(ticketCode, searchMode);

        const responseData = {
            status: result.status || (result.success ? 'VALID' : 'ERROR'),
            success: result.success,
            message: result.message,
            movieInfo: result.movieInfo,
            detail: result.detail
        };

        console.log('Sending response:', JSON.stringify(responseData));

        return new Response(
            JSON.stringify(responseData),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Use ticket error:', error);
        return new Response(
            JSON.stringify({ status: 'ERROR', message: 'Error interno del servidor' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
