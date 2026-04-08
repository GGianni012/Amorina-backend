import { createRequire } from "module";
const require = createRequire(import.meta.url);
const fs = require('fs');
const crypto = require('crypto');

const spreadsheetId = '1PGTSYE6TxvllYd3JnKF1nXFL7WFZHjyAp-oxsv3R9tg';
const clientEmail = "cartelera-amorina@gen-lang-client-0496941434.iam.gserviceaccount.com";
const privateKey = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDNFXa5k5V3KSDo\nOMXGcddCBSkWowgxBXTcxFmAVW5qnY22O5BwvHT0QL3eHu4bm1vw+FTzHUIl0zmR\nfveY5/uybcpwhtaCEnsZhwP0mDEUGULypsNXGhMknPFS5xmInmYRWixj14l6+xnD\niWGXbm/YnGL/UH8pj3urQ2+CiRL1coTGbvTopUwHxcxc5D4+57ow4gfNS7XnCRLg\n5zCYXZk1Tq+GAgj42NDzc4djv/XWWt2tWWGdRdIZ2LllzonS0sLgazPdkugmI3qO\nMJ1ldR1zUS873khdUrzHHiIHzkJPWz2US957E4LnFNUz7PRaJ49xYjMquDKeHe3d\njIa+K0aJAgMBAAECggEAARLgUeEqDotIdPLMJUl2DC5Q/GF64t/RkHDWO5/m4bfE\ntMwryc1QyvEWVWYBzuLxuKmiLzorXR2VnvOEWhh31sOwpEVudNSiMJxmesa7tgxa\nT4EsQ2XbbQ0Fze5wEakrpWJcmmK34W0UYdPTrxpoy0BpW8cY/VeXGQrTuAId92tB\nTJCmnHku4U5bQee1CHWNUuHzw0Ngjxx3VvIWWnd/ZVaHCrQbSbY2debrNwPZ3lqS\n4+ADk2tekJoazV9ixssFcgPIBdQqBNAO2Ikx4HjdfXdERzFrQiY/ZUYgZyDijVvZ\n+ra+vEAHBUX8OLGcKWGo+o4nwknCkmX1aNpPzwAkcQKBgQDqiMDBD7N6xPGDF/qV\nrFYC+CJTcVzwoMMeWtq2YDQYoZsFXfofA/QQqA2r9IAM20vYj1LF++rZR7bqvepz\nmAEYdcRntFNO8buLQYvJgLNzLN262kfCzB/xOAx8fK+hxjKZHO5/VksF9dYPPYQd\n9AUTSo4YxDNuGrbKBljopk2c+QKBgQDf2qzbz2YhGZ49sj2LuWU0tKwyqNyH6vPU\nUkAbbSbmcl8qxtYGoT0IlDsmX0C+NTP0pfpVjFHAO6twG0zkwvGRxNoQENx7qI0e\n4qtryJkIIMTIQJz+MfmXyIA3BqlbbzYBlbGHzxE3PSemBvL4ieSqD8lUiz/EHYop\nq5O98RsqEQKBgArPpPsBS0e0fmGJoG531DsszwBDsIITFwt2KrDPfHdKM8gqjdYS\nK5T8+ixcB+8PyM5BxRIFS80aRi9J893COwKyowwYvuJbuEZyDgyK1zrO7aWoXDh5\niltnNwQiB0KQzVJLiB7sjmbG70gikM2Eqxs5i5VOrgQ8TQLBCiYnTFqZAoGBAI0+\nBclfkDocVurotsqdfM0HnosMXrFnvtdd2lMzyNKooYF1Gf/u5nquRLAOc+RP32ti\n+pPVyJM5Uw+WOisxEYj/IvP2H5fqnrg5Hx4P4Pbu7hrIIgaFc82gVb3idyNZBUN0\ntyJQtbUb4hNw2QeWwe/HrCmq/t34IX/vYXX8Vj5xAoGBAL4hbvGwpYHhZg0sbWnN\nk90Mis4QS5SEuAubRDvpDlsrYLcPuLQrqIpEyLqHPM2F9czUlFDw13EoOmr44VMr\nDVajtHUMiXSUWUDYCbVodp0p/kAJolHhWoT6qDV1gLZHoJa447PnXWbY8Lx2mTZt\nMi/jkzaYYRuzow4ydzUIPf/5\n-----END PRIVATE KEY-----\n";

function pemToArrayBuffer(pem) {
    const b64 = pem.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

// Quick JWT function for Node since subtle crypto is available in Node 19+
async function getGoogleAccessToken(email, pk) {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
        iss: email,
        scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
    };

    // Using Node's crypto
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(Buffer.from(JSON.stringify(header)).toString('base64url') + '.' + Buffer.from(JSON.stringify(claim)).toString('base64url'));
    const signature = signer.sign(pk, 'base64url');

    const jwt = Buffer.from(JSON.stringify(header)).toString('base64url') + '.' + Buffer.from(JSON.stringify(claim)).toString('base64url') + '.' + signature;

    const fetch = (await import('node-fetch')).default || globalThis.fetch;
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    const data = await res.json();
    return data.access_token;
}

async function run() {
    const token = await getGoogleAccessToken(clientEmail, privateKey);
    console.log("Got token");

    const fetch = (await import('node-fetch')).default || globalThis.fetch;
    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`, { headers: { 'Authorization': `Bearer ${token}` } });
    const metaData = await metaRes.json();
    console.log("Sheets:", JSON.stringify(metaData.sheets.map(s => s.properties)));

    const targetSheetGid = '1797714654';
    const targetSheet = metaData.sheets.find(s => String(s.properties.sheetId) === String(targetSheetGid)) || metaData.sheets[0];
    const sheetName = targetSheet.properties.title;

    console.log("Fetching sheet:", sheetName);

    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(sheetName)}'!A1:Z5`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    console.log("Data (first 5 rows):", JSON.stringify(data.values, null, 2));
}

run().catch(console.error);
