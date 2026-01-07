// Supabase Edge Function: Import Schedule and Create Sheet Structure
// POST /functions/v1/import-schedule

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Day names in Spanish
const DIAS = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];

// Colors
const COLORS = {
    TITLE: { red: 0.85, green: 0.45, blue: 0.55 },       // Pink (Amorina brand)
    HEADER: { red: 0.2, green: 0.2, blue: 0.2 },          // Dark gray
    TOTAL_BLOCK: { red: 0.95, green: 0.95, blue: 0.95 },  // Light gray for totals
    GRAND_TOTAL: { red: 0.85, green: 0.45, blue: 0.55 },  // Pink for grand total
    WHITE: { red: 1, green: 1, blue: 1 },
};

const ROWS_PER_BLOCK = 60; // 60 filas por bloque para llenar a mano

interface MovieShow {
    title: string;
    showtime: string;
    price: string;
    director: string;
}

// Get sheet name from date (e.g., "SÁBADO 21/2")
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
    if (result.error) {
        console.error('Error creating sheet:', result.error);
        return -1;
    }
    return result.replies[0].addSheet.properties.sheetId;
}

// Get existing sheets
async function getExistingSheets(token: string, spreadsheetId: string): Promise<{ [key: string]: number }> {
    const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const data = await response.json();
    const sheets: { [key: string]: number } = {};
    for (const sheet of data.sheets || []) {
        sheets[sheet.properties.title] = sheet.properties.sheetId;
    }
    return sheets;
}

// Create the full structure for a day
async function createDayStructure(
    token: string,
    spreadsheetId: string,
    sheetName: string,
    sheetId: number,
    movies: MovieShow[]
) {
    // Build all rows for this day
    const rows: (string | number)[][] = [];
    const formatRequests: any[] = [];
    let currentRow = 0;

    // Track where each block's data range starts/ends for formulas
    const blockRanges: { cantCol: string, efvoCol: string, dataStartRow: number, dataEndRow: number }[] = [];

    for (let i = 0; i < movies.length; i++) {
        const movie = movies[i];
        const showDate = new Date(movie.showtime);
        const timeStr = showDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

        // Add spacing between blocks (except first)
        if (i > 0) {
            rows.push(['']);
            rows.push(['']);
            rows.push(['']);
            currentRow += 3;
        }

        // Block title: AMORINA - PELÍCULA (HORA)
        rows.push([`AMORINA - ${movie.title.toUpperCase()} (${timeStr})`, '', '', '', '', '', '', '']);

        // Format title row
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

        // Merge title cells
        formatRequests.push({
            mergeCells: {
                range: { sheetId, startRowIndex: currentRow, endRowIndex: currentRow + 1, startColumnIndex: 0, endColumnIndex: 8 },
                mergeType: 'MERGE_ALL'
            }
        });
        currentRow++;

        // Headers
        rows.push(['FECHA', 'NOMBRE', 'CANT', 'EFVO', 'CÓDIGO QR', 'ESTADO PAGO', 'ESTADO USO', 'FECHA USO']);

        // Format header row
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

        // Data rows start here
        const dataStartRow = currentRow + 1; // +1 because Sheets is 1-indexed

        // Empty data rows (60 rows for manual entry)
        for (let j = 0; j < ROWS_PER_BLOCK; j++) {
            rows.push(['', '', '', '', '', '', '', '']);
            currentRow++;
        }

        const dataEndRow = currentRow; // Last data row (1-indexed)

        // Store range info for grand total formulas
        blockRanges.push({
            cantCol: 'C',
            efvoCol: 'D',
            dataStartRow,
            dataEndRow,
        });

        // Totals row with formulas
        // =SUM(C3:C62) for CANT column, =SUM(D3:D62) for EFVO column
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

        // Format totals row
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

    // Add grand total section at the end
    rows.push(['']);
    rows.push(['']);
    rows.push(['']);
    currentRow += 3;

    // Grand total title
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

    // Build grand total formulas that sum all blocks
    const cantFormulaParts = blockRanges.map(r => `SUM(C${r.dataStartRow}:C${r.dataEndRow})`);
    const efvoFormulaParts = blockRanges.map(r => `SUM(D${r.dataStartRow}:D${r.dataEndRow})`);

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

    // Write all values (use USER_ENTERED to parse formulas)
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

    // Apply formatting
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

    // Set column widths
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

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const movies = await req.json() as MovieShow[];

        if (!Array.isArray(movies) || movies.length === 0) {
            return new Response(
                JSON.stringify({ error: 'Se requiere un array de películas' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const spreadsheetId = Deno.env.get('GOOGLE_SHEETS_ID');
        const clientEmail = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
        const privateKey = Deno.env.get('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

        if (!spreadsheetId || !clientEmail || !privateKey) {
            return new Response(
                JSON.stringify({ error: 'Credenciales de Google Sheets no configuradas' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const token = await getGoogleAccessToken(clientEmail, privateKey);

        // Group movies by day
        const moviesByDay: { [key: string]: MovieShow[] } = {};
        for (const movie of movies) {
            const sheetName = getSheetName(movie.showtime);
            if (!moviesByDay[sheetName]) {
                moviesByDay[sheetName] = [];
            }
            moviesByDay[sheetName].push(movie);
        }

        // Sort movies within each day by showtime
        for (const day of Object.keys(moviesByDay)) {
            moviesByDay[day].sort((a, b) =>
                new Date(a.showtime).getTime() - new Date(b.showtime).getTime()
            );
        }

        // Get existing sheets
        const existingSheets = await getExistingSheets(token, spreadsheetId);

        // Create sheets for each day
        const createdSheets: string[] = [];
        const skippedSheets: string[] = [];

        for (const [sheetName, dayMovies] of Object.entries(moviesByDay)) {
            if (existingSheets[sheetName]) {
                skippedSheets.push(sheetName);
                continue;
            }

            // Create new sheet
            const sheetId = await createSheet(token, spreadsheetId, sheetName);
            if (sheetId === -1) {
                continue;
            }

            // Create structure
            await createDayStructure(token, spreadsheetId, sheetName, sheetId, dayMovies);
            createdSheets.push(sheetName);

            // Small delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        return new Response(
            JSON.stringify({
                success: true,
                message: `Estructura creada para ${createdSheets.length} días`,
                created: createdSheets,
                skipped: skippedSheets,
                totalMovies: movies.length,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Import schedule error:', error);
        return new Response(
            JSON.stringify({ error: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
