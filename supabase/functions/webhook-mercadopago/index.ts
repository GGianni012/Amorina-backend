// Supabase Edge Function: MercadoPago Webhook with Google Sheets Sync
// POST /functions/v1/webhook-mercadopago

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Day names in Spanish
const DIAS = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];

// Colors for the sheet
const COLORS = {
    APPROVED: { red: 0.776, green: 0.937, blue: 0.808 },  // #C6EFCE green
    PENDING: { red: 0.851, green: 0.851, blue: 0.851 },   // #D9D9D9 gray
    REFUNDED: { red: 1, green: 0.780, blue: 0.808 },      // #FFC7CE red
    HEADER: { red: 0.2, green: 0.2, blue: 0.2 },          // Dark gray
    TITLE: { red: 0.9, green: 0.5, blue: 0.6 },           // Pink (Amorina brand)
};

// Generate compact QR payload
function generateQRPayload(data: any): string {
    const shortDate = data.show_datetime.substring(0, 13);
    return `AMO|${data.ticket_code}|${data.movie_title}|${shortDate}|${data.user_name}|${data.user_email}`;
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

function toNumber(value: unknown, fallback = 0): number {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function buildFallbackTicketCode(orderId: string, index: number): string {
    const clean = String(orderId || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
    const suffix = clean.slice(-6).padStart(6, '0');
    const seq = String(index + 1).padStart(2, '0');
    return `AMO-${suffix}${seq}`;
}

function getMovieSheetEntries(metadata: any) {
    if (!metadata || typeof metadata !== 'object') {
        return [];
    }

    const orderId = String(metadata.order_id || metadata.reservation_id || metadata.ticket_code || 'AMO');
    const userName = String(metadata.user_name || '');
    const userEmail = String(metadata.user_email || '');

    if (metadata.movie_title && metadata.show_datetime) {
        return [{
            movie_title: String(metadata.movie_title),
            show_datetime: String(metadata.show_datetime),
            quantity: Math.max(1, Math.floor(toNumber(metadata.quantity, 1))),
            user_name: userName,
            user_email: userEmail,
            ticket_code: String(metadata.ticket_code || buildFallbackTicketCode(orderId, 0)),
            line_total: Math.max(0, toNumber(metadata.line_total, 0)),
        }];
    }

    const items = Array.isArray(metadata.items) ? metadata.items : [];
    return items
        .filter((item: any) => item && item.type === 'movie' && item.title && item.showtime)
        .map((item: any, index: number) => {
            const quantity = Math.max(1, Math.floor(toNumber(item.quantity, 1)));
            return {
                movie_title: String(item.title),
                show_datetime: String(item.showtime),
                quantity,
                user_name: userName,
                user_email: userEmail,
                ticket_code: buildFallbackTicketCode(orderId, index),
                line_total: Math.max(0, toNumber(item.unit_price, 0) * quantity),
            };
        });
}

async function writeMovieEntryToSheet(token: string, spreadsheetId: string, entry: any, paymentData: any) {
    const sheetName = getSheetName(entry.show_datetime);
    const qrPayload = generateQRPayload(entry);

    const readResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(sheetName)}'!A:H`,
        { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!readResponse.ok) {
        console.error('Failed to read sheet:', await readResponse.text());
        return;
    }

    const readData = await readResponse.json();
    const rows = readData.values || [];
    const searchTitle = entry.movie_title.toUpperCase();
    let targetRow = -1;

    for (let i = 0; i < rows.length; i++) {
        if (rows[i] && rows[i][0] && rows[i][0].includes(searchTitle)) {
            for (let j = i + 2; j < rows.length; j++) {
                if (!rows[j][1]) {
                    targetRow = j + 1;
                    break;
                }
                if (rows[j][0].startsWith('TOTAL')) break;
            }
            break;
        }
    }

    if (targetRow === -1) {
        console.error('Movie block not found for:', searchTitle);
        return;
    }

    const showDate = new Date(entry.show_datetime);
    const dateStr = `${showDate.getDate()}/${showDate.getMonth() + 1}`;
    const paidAmount = entry.line_total > 0
        ? entry.line_total
        : paymentData.transaction_amount;

    const values = [[
        dateStr,
        entry.user_name,
        entry.quantity,
        paidAmount,
        qrPayload,
        'APROBADO',
        'VÁLIDO',
        ''
    ]];

    await fetch(
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

    console.log(`Reservation synced to sheet: ${sheetName}, row ${targetRow}`);
}

async function writeToSheet(metadata: any, paymentData: any) {
    const spreadsheetId = Deno.env.get('GOOGLE_RESERVATIONS_SHEET_ID')
        || Deno.env.get('GOOGLE_SHEETS_ID')
        || '16uYInoI-Ap44zjj3tMwX9i8Yh1SYR0zGSshovibOVqs';
    const clientEmail = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
    const privateKey = Deno.env.get('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

    if (!spreadsheetId || !clientEmail || !privateKey) {
        console.error('Credentials not configured');
        return;
    }

    try {
        const token = await getGoogleAccessToken(clientEmail, privateKey);
        const entries = getMovieSheetEntries(metadata);

        if (entries.length === 0) {
            console.log('No movie entries to sync for this payment');
            return;
        }

        for (const entry of entries) {
            await writeMovieEntryToSheet(token, spreadsheetId, entry, paymentData);
        }

    } catch (error) {
        console.error('Error syncing to sheets:', error);
    }
}

async function applySmaqDiscountIfNeeded(metadata: any, paymentData: any) {
    const appliedSmaq = Math.max(0, Math.floor(toNumber(metadata?.smaq_applied, 0)));
    if (appliedSmaq <= 0) {
        return;
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
        console.error('Supabase admin credentials not configured for ABA deductions');
        return;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    let citizenId = String(metadata?.smaq_citizen_id || '');
    if (!citizenId && metadata?.user_email) {
        const { data: citizen, error: citizenError } = await supabase
            .from('citizens')
            .select('id')
            .eq('email', String(metadata.user_email).toLowerCase())
            .maybeSingle();

        if (citizenError) {
            console.error('Error looking up citizen for ABA discount:', citizenError);
            return;
        }

        citizenId = citizen?.id || '';
    }

    if (!citizenId) {
        console.error('Missing citizen id for ABA discount application');
        return;
    }

    const orderRef = String(metadata?.order_id || metadata?.reservation_id || paymentData?.id || 'UNKNOWN');
    const description = `[amorina] Descuento ABA aplicado a orden ${orderRef}`;

    const { data: existingTx, error: existingTxError } = await supabase
        .from('dracma_transactions')
        .select('id')
        .eq('citizen_id', citizenId)
        .eq('type', 'consumo')
        .eq('description', description)
        .maybeSingle();

    if (existingTxError) {
        console.error('Error checking existing ABA discount transaction:', existingTxError);
        return;
    }

    if (existingTx?.id) {
        console.log(`ABA discount already applied for order ${orderRef}`);
        return;
    }

    const { error: discountError } = await supabase.rpc('record_dracma_transaction', {
        p_citizen_id: citizenId,
        p_type: 'consumo',
        p_amount: -appliedSmaq,
        p_description: description,
    });

    if (discountError) {
        console.error('Error applying ABA discount after MercadoPago approval:', discountError);
        return;
    }

    console.log(`Applied ${appliedSmaq} ABA discount for order ${orderRef}`);
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const payload = await req.json();

        // MercadoPago sends 'payment' type for point-of-sale or online payments
        if (payload.type !== 'payment') {
            return new Response(JSON.stringify({ received: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const mpAccessToken = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');
        const paymentResponse = await fetch(
            `https://api.mercadopago.com/v1/payments/${payload.data.id}`,
            { headers: { 'Authorization': `Bearer ${mpAccessToken}` } }
        );

        const paymentData = await paymentResponse.json();

        if (paymentData.status === 'approved') {
            const metadata = paymentData.metadata;
            if (metadata) {
                await applySmaqDiscountIfNeeded(metadata, paymentData);
                // Sync to Google Sheets
                await writeToSheet(metadata, paymentData);
            }
        }

        return new Response(
            JSON.stringify({ success: true, status: paymentData.status }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Webhook error:', error);
        return new Response(
            JSON.stringify({ error: 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
