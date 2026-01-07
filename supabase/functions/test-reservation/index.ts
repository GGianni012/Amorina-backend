// Supabase Edge Function: Test Reservation with Styled Google Sheets
// POST /functions/v1/test-reservation

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ReservationRequest {
    movieTitle: string;
    showDateTime: string;
    userName: string;
    userEmail: string;
    quantity?: number;
    amount?: number;
}

// Day names in Spanish
const DIAS = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];

// Colors
const COLORS = {
    APPROVED: { red: 0.776, green: 0.937, blue: 0.808 },  // #C6EFCE green
    PENDING: { red: 0.851, green: 0.851, blue: 0.851 },   // #D9D9D9 gray
    REFUNDED: { red: 1, green: 0.780, blue: 0.808 },      // #FFC7CE red
    HEADER: { red: 0.2, green: 0.2, blue: 0.2 },          // Dark gray
    TITLE: { red: 0.9, green: 0.5, blue: 0.6 },           // Pink (Amorina brand)
};

// Generate compact QR payload
function generateQRPayload(data: {
    ticketCode: string;
    movieTitle: string;
    showDateTime: string;
    userName: string;
    userEmail: string;
}): string {
    const shortDate = data.showDateTime.substring(0, 13);
    return `AMO|${data.ticketCode}|${data.movieTitle}|${shortDate}|${data.userName}|${data.userEmail}`;
}

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

// Get spreadsheet info (list of sheets)
async function getSpreadsheetInfo(token: string, spreadsheetId: string) {
    const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
    );
    return await response.json();
}

// Create a new sheet (tab)
async function createSheet(token: string, spreadsheetId: string, sheetName: string): Promise<number> {
    const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                requests: [{
                    addSheet: {
                        properties: { title: sheetName }
                    }
                }]
            }),
        }
    );
    const result = await response.json();
    return result.replies[0].addSheet.properties.sheetId;
}

// Write reservation to the styled sheet
async function writeToStyledSheet(
    token: string,
    spreadsheetId: string,
    sheetName: string,
    movieTitle: string,
    reservation: {
        date: string;
        name: string;
        quantity: number;
        amount: number;
        ticketCode: string;
        paymentStatus: string;
        usageStatus: string;
        usedAt: string;
    }
) {
    // First, get or create the sheet
    const info = await getSpreadsheetInfo(token, spreadsheetId);
    let sheet = info.sheets?.find((s: any) => s.properties.title === sheetName);
    let sheetId: number;

    if (!sheet) {
        // Create new sheet
        sheetId = await createSheet(token, spreadsheetId, sheetName);
    } else {
        sheetId = sheet.properties.sheetId;
    }

    // Read current content
    const readResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(sheetName)}'!A:H`,
        { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const readData = await readResponse.json();
    const rows = readData.values || [];

    // Find the movie block or determine where to insert
    const blockTitle = `AMORINA - ${movieTitle.toUpperCase()}`;
    let blockStartRow = -1;
    let insertRow = rows.length + 1;

    for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] === blockTitle) {
            blockStartRow = i;
            // Find end of this block (next empty row or next block title)
            for (let j = i + 2; j < rows.length; j++) {
                if (!rows[j] || !rows[j][0] || rows[j][0].startsWith('AMORINA -') || rows[j][0].startsWith('TOTAL')) {
                    insertRow = j + 1; // Insert before totals or next block
                    break;
                }
                insertRow = j + 2;
            }
            break;
        }
    }

    // Prepare the data
    const values: any[][] = [];
    const requests: any[] = [];

    if (blockStartRow === -1) {
        // Create new block
        if (rows.length > 0) {
            // Add spacing
            values.push(['']);
            values.push(['']);
        }

        // Block title
        values.push([blockTitle, '', '', '', '', '', '', '']);

        // Headers
        values.push(['FECHA', 'NOMBRE', 'CANT', 'EFVO', 'CÓDIGO QR', 'ESTADO PAGO', 'ESTADO USO', 'FECHA USO']);

        // First reservation
        values.push([
            reservation.date,
            reservation.name,
            reservation.quantity,
            reservation.amount,
            reservation.ticketCode,
            reservation.paymentStatus,
            reservation.usageStatus,
            reservation.usedAt
        ]);

        // Totals row (placeholder)
        values.push([`TOTAL ENTRADAS: ${reservation.quantity}`, '', '', `INGRESOS: $${reservation.amount}`, '', '', '', '']);

        // Append to sheet
        await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(sheetName)}'!A${rows.length + 1}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ values }),
            }
        );

        // Apply formatting
        const startRow = rows.length + (rows.length > 0 ? 2 : 0);

        // Format title row
        requests.push({
            repeatCell: {
                range: { sheetId, startRowIndex: startRow, endRowIndex: startRow + 1, startColumnIndex: 0, endColumnIndex: 8 },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: COLORS.TITLE,
                        textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 12 }
                    }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)'
            }
        });

        // Format header row
        requests.push({
            repeatCell: {
                range: { sheetId, startRowIndex: startRow + 1, endRowIndex: startRow + 2, startColumnIndex: 0, endColumnIndex: 8 },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: COLORS.HEADER,
                        textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
                    }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)'
            }
        });

        // Format data row with payment status color
        const dataRowColor = reservation.paymentStatus === 'APROBADO' ? COLORS.APPROVED :
            reservation.paymentStatus === 'REEMBOLSO' ? COLORS.REFUNDED : COLORS.PENDING;
        requests.push({
            repeatCell: {
                range: { sheetId, startRowIndex: startRow + 2, endRowIndex: startRow + 3, startColumnIndex: 0, endColumnIndex: 8 },
                cell: {
                    userEnteredFormat: { backgroundColor: dataRowColor }
                },
                fields: 'userEnteredFormat(backgroundColor)'
            }
        });

    } else {
        // Add to existing block - insert row before totals
        // Find the totals row
        let totalsRow = -1;
        for (let i = blockStartRow + 2; i < rows.length; i++) {
            if (rows[i] && rows[i][0] && rows[i][0].startsWith('TOTAL')) {
                totalsRow = i;
                break;
            }
        }

        if (totalsRow === -1) {
            totalsRow = rows.length;
        }

        // Insert new row
        const newRow = [
            reservation.date,
            reservation.name,
            reservation.quantity,
            reservation.amount,
            reservation.ticketCode,
            reservation.paymentStatus,
            reservation.usageStatus,
            reservation.usedAt
        ];

        // Use insertDimension to add a row, then update values
        requests.push({
            insertDimension: {
                range: { sheetId, dimension: 'ROWS', startIndex: totalsRow, endIndex: totalsRow + 1 },
                inheritFromBefore: true
            }
        });

        // We'll update values after batch update
    }

    // Apply batch update for formatting
    if (requests.length > 0) {
        await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ requests }),
            }
        );
    }

    return true;
}

// Main write function
async function writeReservation(
    reservation: {
        movieTitle: string;
        showDateTime: string;
        userName: string;
        userEmail: string;
        ticketCode: string;
        quantity: number;
        amount: number;
    }
) {
    const spreadsheetId = Deno.env.get('GOOGLE_SHEETS_ID');
    const clientEmail = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
    const privateKey = Deno.env.get('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

    if (!spreadsheetId || !clientEmail || !privateKey) {
        console.error('Missing Google Sheets credentials');
        return false;
    }

    try {
        const token = await getGoogleAccessToken(clientEmail, privateKey);
        const sheetName = getSheetName(reservation.showDateTime);

        const showDate = new Date(reservation.showDateTime);
        const dateStr = `${showDate.getDate()}/${showDate.getMonth() + 1}`;

        await writeToStyledSheet(
            token,
            spreadsheetId,
            sheetName,
            reservation.movieTitle,
            {
                date: dateStr,
                name: reservation.userName,
                quantity: reservation.quantity,
                amount: reservation.amount,
                ticketCode: reservation.ticketCode,
                paymentStatus: 'APROBADO',
                usageStatus: 'VÁLIDO',
                usedAt: '',
            }
        );

        return true;
    } catch (error) {
        console.error('Error writing to sheets:', error);
        return false;
    }
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const body = await req.json() as ReservationRequest;
        const { movieTitle, showDateTime, userName, userEmail, quantity = 1, amount = 6000 } = body;

        if (!movieTitle || !showDateTime || !userName || !userEmail) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Generate ticket code
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let ticketCode = 'AMO-';
        for (let i = 0; i < 8; i++) {
            ticketCode += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        // Generate QR payload
        const qrPayload = generateQRPayload({
            ticketCode,
            movieTitle,
            showDateTime,
            userName,
            userEmail,
        });

        // Write to styled Google Sheets
        const sheetsSuccess = await writeReservation({
            movieTitle,
            showDateTime,
            userName,
            userEmail,
            ticketCode,
            quantity,
            amount,
        });

        return new Response(
            JSON.stringify({
                success: true,
                ticketCode,
                qrPayload,
                sheetsWritten: sheetsSuccess,
                message: sheetsSuccess
                    ? '¡Reserva creada y guardada!'
                    : 'Reserva creada pero hubo error escribiendo en Sheets',
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Test reservation error:', error);
        return new Response(
            JSON.stringify({ error: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
