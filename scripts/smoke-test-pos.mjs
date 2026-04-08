import { execFileSync } from 'node:child_process';

const args = new Map(
    process.argv.slice(2).map((arg) => {
        const [key, value = ''] = arg.split('=');
        return [key.replace(/^--/, ''), value];
    })
);

const base = (args.get('base') || 'http://localhost:4010/api/pos').replace(/\/+$/, '');
const preferredClaimToken = (args.get('claim-token') || 'AQ-P2-30').toUpperCase();

let activeSessionId = null;
let activeTableId = null;
let activeClaimToken = null;

function curlJson(path, { method = 'GET', body } = {}) {
    const args = ['-sS', '-X', method, '-H', 'Content-Type: application/json', '-w', '\n%{http_code}', `${base}${path}`];
    if (body !== undefined) {
        args.push('-d', JSON.stringify(body));
    }

    const raw = execFileSync('curl', args, { encoding: 'utf8' });
    const lines = raw.trimEnd().split('\n');
    const status = Number(lines.pop() || 0);
    const text = lines.join('\n');
    const json = text ? JSON.parse(text) : null;

    return { status, ok: status >= 200 && status < 300, json, text };
}

function ensure(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function findMenuItem(categories, code) {
    return categories.flatMap((category) => category.items || []).find((item) => item.code === code) || null;
}

function getActiveItemIds(details) {
    return details.orders
        .flatMap((order) => order.items || [])
        .filter((item) => item.status === 'active')
        .map((item) => item.id);
}

function cleanupSession() {
    if (!activeSessionId) return;

    try {
        const detailsRes = curlJson(`/sessions/details?sessionId=${encodeURIComponent(activeSessionId)}`);
        const details = detailsRes.json?.details;
        if (!details?.session) {
            activeSessionId = null;
            return;
        }

        const itemIds = getActiveItemIds(details);
        for (const itemId of itemIds) {
            curlJson('/orders/update-item', {
                method: 'POST',
                body: { itemId, status: 'voided' },
            });
        }

        curlJson('/sessions/close', {
            method: 'POST',
            body: { sessionId: activeSessionId },
        });

        activeSessionId = null;
    } catch (error) {
        console.error('Cleanup warning:', error instanceof Error ? error.message : error);
    }
}

try {
    const tablesRes = curlJson('/tables?floorCode=p2');
    ensure(tablesRes.ok && tablesRes.json?.success, 'No se pudo leer el listado de mesas');

    const freeTable = tablesRes.json.tables.find((table) => table.claimToken === preferredClaimToken && table.sessionId === null)
        || tablesRes.json.tables.find((table) => table.sessionId === null);
    ensure(freeTable, 'No encontre ninguna mesa libre para el smoke test');

    activeTableId = freeTable.tableId;
    activeClaimToken = freeTable.claimToken;

    const menuRes = curlJson('/menu?audience=client');
    ensure(menuRes.ok && menuRes.json?.success, 'No se pudo leer el menu cliente');

    const mediterraneo = findMenuItem(menuRes.json.categories, 'mediterraneo');
    const limonada = findMenuItem(menuRes.json.categories, 'limonada');
    ensure(mediterraneo && limonada, 'Faltan items semilla requeridos para el smoke test');

    const openRes = curlJson('/sessions/open', {
        method: 'POST',
        body: { tableId: activeTableId, guestCount: 2 },
    });
    ensure(openRes.ok && openRes.json?.success, 'No se pudo abrir la mesa');
    activeSessionId = openRes.json.details.session.id;

    const staffAddRes = curlJson('/orders/upsert-items', {
        method: 'POST',
        body: {
            sessionId: activeSessionId,
            source: 'staff',
            items: [{ menuItemId: mediterraneo.id, quantity: 1 }],
        },
    });
    ensure(staffAddRes.ok && staffAddRes.json?.success, 'Fallo agregar item staff');

    const claimRes = curlJson('/sessions/claim', {
        method: 'POST',
        body: {
            claimToken: activeClaimToken,
            createSessionIfMissing: true,
        },
    });
    ensure(claimRes.ok && claimRes.json?.success, 'Fallo claim de mesa');

    const clientAddRes = curlJson('/orders/upsert-items', {
        method: 'POST',
        body: {
            sessionId: activeSessionId,
            source: 'client',
            items: [{ menuItemId: limonada.id, quantity: 2 }],
        },
    });
    ensure(clientAddRes.ok && clientAddRes.json?.success, 'Fallo agregar item cliente');

    const detailsRes = curlJson(`/sessions/details?sessionId=${encodeURIComponent(activeSessionId)}`);
    ensure(detailsRes.ok && detailsRes.json?.success, 'Fallo leer detalle de sesion');

    const checkRes = curlJson('/sessions/request-check', {
        method: 'POST',
        body: { sessionId: activeSessionId },
    });
    ensure(checkRes.ok && checkRes.json?.success, 'Fallo pedir cuenta');

    const transferRes = curlJson('/payments/app-transfer', {
        method: 'POST',
        body: { sessionId: activeSessionId },
    });
    ensure(transferRes.status === 500, 'Se esperaba falla de transferencia por falta de alias');

    const itemIds = getActiveItemIds(detailsRes.json.details);
    for (const itemId of itemIds) {
        const voidRes = curlJson('/orders/update-item', {
            method: 'POST',
            body: { itemId, status: 'voided' },
        });
        ensure(voidRes.ok && voidRes.json?.success, `Fallo anular item ${itemId}`);
    }

    const closeRes = curlJson('/sessions/close', {
        method: 'POST',
        body: { sessionId: activeSessionId },
    });
    ensure(closeRes.ok && closeRes.json?.success, 'Fallo cerrar mesa');

    const finalTableRes = curlJson(`/sessions/details?tableId=${encodeURIComponent(activeTableId)}`);
    ensure(finalTableRes.ok && finalTableRes.json?.success, 'Fallo verificar estado final de mesa');

    const summary = {
        base,
        claimToken: activeClaimToken,
        openedSessionId: activeSessionId,
        claimSameSession: claimRes.json.details.session.id === activeSessionId,
        subtotalArs: detailsRes.json.details.table.subtotalArs,
        itemCount: detailsRes.json.details.table.itemCount,
        requestCheckStatus: checkRes.json.details.session.status,
        requestCheckUiState: checkRes.json.details.table.uiState,
        transferStatusCode: transferRes.status,
        transferError: transferRes.json?.error || transferRes.text,
        finalSession: finalTableRes.json.details.session,
        finalUiState: finalTableRes.json.details.table.uiState,
        finalBalanceDue: finalTableRes.json.details.table.balanceDueArs,
    };

    activeSessionId = null;
    console.log(JSON.stringify(summary, null, 2));
} catch (error) {
    cleanupSession();
    console.error('Smoke test POS failed');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
