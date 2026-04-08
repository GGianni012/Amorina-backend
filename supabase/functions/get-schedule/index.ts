// Supabase Edge Function: Get Schedule from Google Sheets
// GET /functions/v1/get-schedule

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const DIAS = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
const ROWS_PER_BLOCK = 60;
const RESERVATIONS_SPREADSHEET_ID = '16uYInoI-Ap44zjj3tMwX9i8Yh1SYR0zGSshovibOVqs';

const COLORS = {
    TITLE: { red: 0.85, green: 0.45, blue: 0.55 },
    HEADER: { red: 0.2, green: 0.2, blue: 0.2 },
    TOTAL_BLOCK: { red: 0.95, green: 0.95, blue: 0.95 },
    GRAND_TOTAL: { red: 0.85, green: 0.45, blue: 0.55 },
    WHITE: { red: 1, green: 1, blue: 1 },
};

interface ScheduleMovie {
    title: string;
    theater: string;
    price: string;
    website: string;
    address: string;
    genre: string;
    director: string;
    poster: string;
    fotograma: string;
    imdbid: string;
    nationality: string;
    trailer: string;
    year: string;
    runtime_mins: number;
    overview: string;
    showtime: string;
}

// Column mapping: normalized Spanish Sheet Headers -> English JSON keys
// We normalize headers by removing accents (e.g. DÍA -> DIA)
const COLUMN_MAP: { [key: string]: string } = {
    'DIA': 'dia',           // Combined with HORA to make showtime
    'NUEVO DIA': 'dia',     // Fallback for modified sheet
    'FECHA': 'dia',         // Additional fallback
    'HORA': 'hora',         // Combined with DÍA to make showtime
    'PELICULA': 'title',
    'DIRECTOR': 'director',
    'SALA': 'theater',
    'WEB': 'website',
    'DIRECCION': 'address',
    'FOTOGRAMA': 'fotograma',
    'PRECIO': 'price',
    'FILTROS': 'filtros',
    'GENERO': 'genre',
    'POSTER': 'poster',
    'IMDBID': 'imdbid',
    'NACIONALIDAD': 'nationality',
    'TRAILER': 'trailer',
    'AÑO': 'year',          // keeping AÑO fallback, though we'll normalize Ñ to N later if user drops it but NFD keeps Ñ if we aren't careful? Actually NFD decomposes Ñ but let's be safe.
    'ANO': 'year',          // fallback for no tilde
    'DURACION': 'runtime_mins',
    'OVERVIEW': 'overview',
};

// Normalize a string by removing accents and converting to uppercase
function normalizeHeader(str: string): string {
    return str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Removes diacritics
        .toUpperCase()
        .trim();
}

// Request write access as well because this endpoint now keeps the
// reservations workbook in sync with newly published dates.
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

function getSheetName(dateString: string): string {
    const date = new Date(dateString);
    const dayName = DIAS[date.getDay()];
    const day = date.getDate();
    const month = date.getMonth() + 1;
    return `${dayName} ${day}/${month}`;
}

function getReservationsSpreadsheetId(): string {
    return (
        Deno.env.get('GOOGLE_RESERVATIONS_SHEET_ID')
        || Deno.env.get('GOOGLE_SHEETS_ID')
        || RESERVATIONS_SPREADSHEET_ID
    );
}

async function getExistingSheets(token: string, spreadsheetId: string): Promise<Record<string, number>> {
    const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
        { headers: { 'Authorization': `Bearer ${token}` } }
    );

    const data = await response.json();
    if (!response.ok) {
        throw new Error(`No pude leer las hojas existentes: ${JSON.stringify(data)}`);
    }

    const sheets: Record<string, number> = {};
    for (const sheet of data.sheets || []) {
        sheets[sheet.properties.title] = sheet.properties.sheetId;
    }
    return sheets;
}

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
    if (!response.ok || result.error) {
        console.error('Error creating sheet:', result.error || result);
        return -1;
    }

    return result.replies[0].addSheet.properties.sheetId;
}

async function createDayStructure(
    token: string,
    spreadsheetId: string,
    sheetName: string,
    sheetId: number,
    movies: ScheduleMovie[]
) {
    const rows: (string | number)[][] = [];
    const formatRequests: any[] = [];
    let currentRow = 0;
    const blockRanges: { dataStartRow: number; dataEndRow: number }[] = [];

    for (let i = 0; i < movies.length; i++) {
        const movie = movies[i];
        const showDate = new Date(movie.showtime);
        const timeStr = showDate.toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Argentina/Buenos_Aires',
        });

        if (i > 0) {
            rows.push(['']);
            rows.push(['']);
            rows.push(['']);
            currentRow += 3;
        }

        rows.push([`AMORINA - ${movie.title.toUpperCase()} (${timeStr})`, '', '', '', '', '', '', '']);
        formatRequests.push({
            repeatCell: {
                range: { sheetId, startRowIndex: currentRow, endRowIndex: currentRow + 1, startColumnIndex: 0, endColumnIndex: 8 },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: COLORS.TITLE,
                        textFormat: { bold: true, foregroundColor: COLORS.WHITE, fontSize: 11 }
                    }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)'
            }
        });
        formatRequests.push({
            mergeCells: {
                range: { sheetId, startRowIndex: currentRow, endRowIndex: currentRow + 1, startColumnIndex: 0, endColumnIndex: 8 },
                mergeType: 'MERGE_ALL'
            }
        });
        currentRow++;

        rows.push(['FECHA', 'NOMBRE', 'CANT', 'EFVO', 'CÓDIGO QR', 'ESTADO PAGO', 'ESTADO USO', 'FECHA USO']);
        formatRequests.push({
            repeatCell: {
                range: { sheetId, startRowIndex: currentRow, endRowIndex: currentRow + 1, startColumnIndex: 0, endColumnIndex: 8 },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: COLORS.HEADER,
                        textFormat: { bold: true, foregroundColor: COLORS.WHITE, fontSize: 10 }
                    }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)'
            }
        });
        currentRow++;

        const dataStartRow = currentRow + 1;

        for (let j = 0; j < ROWS_PER_BLOCK; j++) {
            rows.push(['', '', '', '', '', '', '', '']);
            currentRow++;
        }

        const dataEndRow = currentRow;
        blockRanges.push({ dataStartRow, dataEndRow });

        rows.push([
            'TOTAL ENTRADAS:',
            `=SUM(C${dataStartRow}:C${dataEndRow})`,
            '',
            'INGRESOS:',
            `=SUM(D${dataStartRow}:D${dataEndRow})`,
            '',
            '',
            ''
        ]);
        formatRequests.push({
            repeatCell: {
                range: { sheetId, startRowIndex: currentRow, endRowIndex: currentRow + 1, startColumnIndex: 0, endColumnIndex: 8 },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: COLORS.TOTAL_BLOCK,
                        textFormat: { bold: true, fontSize: 10 },
                        borders: {
                            top: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } },
                            bottom: { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } }
                        }
                    }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,borders)'
            }
        });
        currentRow++;
    }

    rows.push(['']);
    rows.push(['']);
    rows.push(['']);
    currentRow += 3;

    rows.push(['TOTALES DEL DÍA', '', '', '', '', '', '', '']);
    formatRequests.push({
        repeatCell: {
            range: { sheetId, startRowIndex: currentRow, endRowIndex: currentRow + 1, startColumnIndex: 0, endColumnIndex: 8 },
            cell: {
                userEnteredFormat: {
                    backgroundColor: COLORS.GRAND_TOTAL,
                    textFormat: { bold: true, foregroundColor: COLORS.WHITE, fontSize: 12 }
                }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
        }
    });
    formatRequests.push({
        mergeCells: {
            range: { sheetId, startRowIndex: currentRow, endRowIndex: currentRow + 1, startColumnIndex: 0, endColumnIndex: 8 },
            mergeType: 'MERGE_ALL'
        }
    });
    currentRow++;

    const cantFormulaParts = blockRanges.map((range) => `SUM(C${range.dataStartRow}:C${range.dataEndRow})`);
    const efvoFormulaParts = blockRanges.map((range) => `SUM(D${range.dataStartRow}:D${range.dataEndRow})`);

    rows.push([
        'TOTAL ENTRADAS:',
        `=${cantFormulaParts.join('+')}`,
        '',
        'TOTAL INGRESOS:',
        `=${efvoFormulaParts.join('+')}`,
        '',
        '',
        ''
    ]);

    formatRequests.push({
        repeatCell: {
            range: { sheetId, startRowIndex: currentRow, endRowIndex: currentRow + 1, startColumnIndex: 0, endColumnIndex: 8 },
            cell: {
                userEnteredFormat: {
                    backgroundColor: COLORS.TOTAL_BLOCK,
                    textFormat: { bold: true, fontSize: 11 },
                    borders: {
                        top: { style: 'SOLID_MEDIUM', color: { red: 0, green: 0, blue: 0 } },
                        bottom: { style: 'SOLID_MEDIUM', color: { red: 0, green: 0, blue: 0 } }
                    }
                }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,borders)'
        }
    });

    await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(sheetName)}'!A1:H${rows.length}?valueInputOption=USER_ENTERED`,
        {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values: rows }),
        }
    );

    if (formatRequests.length > 0) {
        await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ requests: formatRequests }),
            }
        );
    }

    await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                requests: [
                    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 100 }, fields: 'pixelSize' } },
                    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 200 }, fields: 'pixelSize' } },
                    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 60 }, fields: 'pixelSize' } },
                    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 }, properties: { pixelSize: 100 }, fields: 'pixelSize' } },
                    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 130 }, fields: 'pixelSize' } },
                    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } },
                    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, properties: { pixelSize: 110 }, fields: 'pixelSize' } },
                    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 7, endIndex: 8 }, properties: { pixelSize: 130 }, fields: 'pixelSize' } },
                ]
            }),
        }
    );
}

async function syncMissingReservationSheets(token: string, movies: ScheduleMovie[]) {
    if (movies.length === 0) {
        return;
    }

    const spreadsheetId = getReservationsSpreadsheetId();
    const existingSheets = await getExistingSheets(token, spreadsheetId);
    const moviesByDay: Record<string, ScheduleMovie[]> = {};

    for (const movie of movies) {
        const sheetName = getSheetName(movie.showtime);
        if (!moviesByDay[sheetName]) {
            moviesByDay[sheetName] = [];
        }
        moviesByDay[sheetName].push(movie);
    }

    for (const dayMovies of Object.values(moviesByDay)) {
        dayMovies.sort((a, b) => new Date(a.showtime).getTime() - new Date(b.showtime).getTime());
    }

    const createdSheets: string[] = [];
    for (const [sheetName, dayMovies] of Object.entries(moviesByDay)) {
        if (existingSheets[sheetName]) {
            continue;
        }

        const sheetId = await createSheet(token, spreadsheetId, sheetName);
        if (sheetId === -1) {
            continue;
        }

        await createDayStructure(token, spreadsheetId, sheetName, sheetId, dayMovies);
        existingSheets[sheetName] = sheetId;
        createdSheets.push(sheetName);
        await new Promise((resolve) => setTimeout(resolve, 200));
    }

    if (createdSheets.length > 0) {
        console.log('Reservation sheets created:', createdSheets.join(', '));
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
        const targetSheetGid = Deno.env.get('GOOGLE_SCHEDULE_SHEET_GID') || '1797714654';
        const targetSheetByGid = sheets.find(
            (s: any) => String(s?.properties?.sheetId ?? '') === String(targetSheetGid)
        );
        const targetSheet = targetSheetByGid || sheets[0];

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
            const normalized = normalizeHeader(h);
            if (COLUMN_MAP[normalized]) {
                headerIndices[COLUMN_MAP[normalized]] = idx;
            }
        });

        const movies: ScheduleMovie[] = rows.slice(1).map((row: any) => {
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
                fotograma: getValue('fotograma'),
                imdbid: getValue('imdbid'),
                nationality: getValue('nationality'),
                trailer: getValue('trailer'),
                year: getValue('year'),
                runtime_mins: parseInt(getValue('runtime_mins')) || 0,
                overview: getValue('overview'),
                showtime: showtime,
            };
        }).filter((m: ScheduleMovie) => m.title && m.showtime);

        try {
            await syncMissingReservationSheets(token, movies);
        } catch (syncError) {
            console.error('Reservation sheet sync skipped:', syncError);
        }

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
