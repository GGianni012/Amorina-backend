const API_BASE = '/api/pos';
const STAFF_SESSION_KEY = 'aquilea.staffSession';
const POLL_INTERVAL_MS = 10000;

const ROLE_LABELS = {
    staff: 'Empleado',
    cashier: 'Caja',
    operator: 'Operario',
    admin: 'Admin',
};

// Basico y local a proposito: facil de cambiar mientras despues llevamos auth a backend.
const STAFF_USERS = [
    {
        username: 'mesero',
        password: 'mesa57',
        name: 'Mozo Sala',
        role: 'staff',
        permissions: ['view', 'open_session', 'manage_orders', 'charge_payments', 'confirm_transfer', 'close_session'],
    },
    {
        username: 'caja',
        password: 'caja57',
        name: 'Caja',
        role: 'cashier',
        permissions: ['view', 'open_session', 'manage_orders', 'charge_payments', 'confirm_transfer', 'close_session'],
    },
    {
        username: 'operaciones',
        password: 'operacion57',
        name: 'Operaciones',
        role: 'operator',
        permissions: ['view', 'open_session', 'manage_orders', 'charge_payments', 'confirm_transfer', 'close_session'],
    },
    {
        username: 'admin',
        password: 'aquilea57',
        name: 'Admin',
        role: 'admin',
        permissions: ['*'],
    },
];

const state = {
    floors: [],
    menu: [],
    tables: [],
    tableDirectory: [],
    dashboardSummary: null,
    activeFloorCode: null,
    selectedTableId: null,
    selectedDetails: null,
    search: '',
    draftsByTableId: {},
    currentStaff: null,
    pollHandle: null,
    paymentDrawerOpen: false,
    modalOpen: false,
};

const els = {
    loginGate: document.getElementById('loginGate'),
    loginForm: document.getElementById('loginForm'),
    loginError: document.getElementById('loginError'),
    loginUserHints: document.getElementById('loginUserHints'),
    staffUserInput: document.getElementById('staffUserInput'),
    staffPasswordInput: document.getElementById('staffPasswordInput'),
    staffAppShell: document.getElementById('staffAppShell'),
    staffIdentity: document.getElementById('staffIdentity'),
    staffDisplayName: document.getElementById('staffDisplayName'),
    staffDisplayRole: document.getElementById('staffDisplayRole'),
    logoutBtn: document.getElementById('logoutBtn'),
    panelStats: document.getElementById('panelStats'),
    floorTabs: document.getElementById('floorTabs'),
    financeStrip: document.getElementById('financeStrip'),
    tablesGrid: document.getElementById('tablesGrid'),
    tableSearchResults: document.getElementById('tableSearchResults'),
    detailContent: document.getElementById('detailContent'),
    detailFloor: document.getElementById('detailFloor'),
    detailTableLabel: document.getElementById('detailTableLabel'),
    detailClaimToken: document.getElementById('detailClaimToken'),
    detailStatus: document.getElementById('detailStatus'),
    detailAttentionBadge: document.getElementById('detailAttentionBadge'),
    detailAttentionMeta: document.getElementById('detailAttentionMeta'),
    detailOrderSource: document.getElementById('detailOrderSource'),
    summaryTotal: document.getElementById('summaryTotal'),
    summaryPaid: document.getElementById('summaryPaid'),
    summaryDue: document.getElementById('summaryDue'),
    summaryGuests: document.getElementById('summaryGuests'),
    sessionActions: document.getElementById('sessionActions'),
    ordersList: document.getElementById('ordersList'),
    paymentsList: document.getElementById('paymentsList'),
    menuCatalog: document.getElementById('menuCatalog'),
    draftSummary: document.getElementById('draftSummary'),
    clearDraftBtn: document.getElementById('clearDraftBtn'),
    sendDraftBtn: document.getElementById('sendDraftBtn'),
    manualItemForm: document.getElementById('manualItemForm'),
    tableSearch: document.getElementById('tableSearch'),
    refreshBtn: document.getElementById('refreshBtn'),
    toggleCheckoutBtn: document.getElementById('toggleCheckoutBtn'),
    checkoutHint: document.getElementById('checkoutHint'),
    paymentDrawer: document.getElementById('paymentDrawer'),
    chargeNfcBtn: document.getElementById('chargeNfcBtn'),
    createTransferBtn: document.getElementById('createTransferBtn'),
    createMercadoPagoBtn: document.getElementById('createMercadoPagoBtn'),
    nfcTagInput: document.getElementById('nfcTagInput'),
    transferBox: document.getElementById('transferBox'),
    mercadoPagoBox: document.getElementById('mercadoPagoBox'),
    tableModal: document.getElementById('tableModal'),
    tableModalSheet: document.querySelector('.table-modal-sheet'),
    closeTableModalBtn: document.getElementById('closeTableModalBtn'),
    toast: document.getElementById('toast'),
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
    bindAuthEvents();
    bindAppEvents();
    renderStaffUserOptions();
    hydrateStaffSession();
    renderAuthState();

    if (state.currentStaff) {
        await loadBootstrap();
        startPolling();
    }
}

function bindAuthEvents() {
    els.loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        await loginStaff();
    });

    els.logoutBtn.addEventListener('click', () => {
        logoutStaff();
    });
}

function bindAppEvents() {
    els.refreshBtn.addEventListener('click', async () => {
        if (!guardPermission('view', 'Necesitas iniciar sesion para refrescar la sala')) return;
        await refreshEverything();
    });

    els.tableSearch.addEventListener('input', (event) => {
        state.search = event.target.value.trim().toLowerCase();
        renderSearchResults();
    });

    els.clearDraftBtn.addEventListener('click', () => {
        if (!guardPermission('manage_orders', 'Tu rol no puede editar comandas')) return;

        const tableId = state.selectedTableId;
        if (!tableId) {
            showToast('Elegi una mesa primero');
            return;
        }

        clearDraftForTable(tableId);
        showToast('Borrador limpiado');
    });

    els.sendDraftBtn.addEventListener('click', async () => {
        if (!guardPermission('manage_orders', 'Tu rol no puede enviar comandas')) return;

        const table = getSelectedTable();
        if (!table) {
            showToast('Elegi una mesa primero');
            return;
        }

        const draftItems = getDraftEntries(table.tableId);
        if (!draftItems.length) {
            showToast('No hay items en el borrador');
            return;
        }

        const details = await ensureSessionForTable(table);
        await upsertItems(details.session.id, draftItems.map((item) => ({
            menuItemId: item.menuItemId,
            quantity: item.quantity,
        })), 'Comanda enviada');
        clearDraftForTable(table.tableId, false);
        renderDraftState(state.selectedDetails || details);
    });

    els.manualItemForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!guardPermission('manage_orders', 'Tu rol no puede cargar items')) return;

        const table = getSelectedTable();
        if (!table) {
            showToast('Elegi una mesa primero');
            return;
        }

        const details = await ensureSessionForTable(table);
        const form = new FormData(els.manualItemForm);
        await upsertItems(details.session.id, [
            {
                itemName: form.get('itemName'),
                unitPriceArs: Number(form.get('unitPriceArs')),
                quantity: Number(form.get('quantity')),
                note: form.get('note'),
            },
        ], 'Item agregado');
        els.manualItemForm.reset();
    });

    els.toggleCheckoutBtn.addEventListener('click', () => {
        const details = state.selectedDetails;
        if (!details?.session) {
            showToast('Abri la mesa antes de cobrar');
            return;
        }
        if (details.table.balanceDueArs <= 0) {
            showToast('La mesa ya esta saldada');
            return;
        }
        state.paymentDrawerOpen = !state.paymentDrawerOpen;
        renderCheckoutPanel(details);
        if (state.paymentDrawerOpen) {
            focusPaymentDrawerOnMobile();
        }
    });

    els.chargeNfcBtn.addEventListener('click', async () => {
        if (!guardPermission('charge_payments', 'Tu rol no puede cobrar con NFC')) return;

        const details = state.selectedDetails;
        const tagId = els.nfcTagInput.value.trim();
        if (!details?.session || !tagId) {
            showToast('Falta sesion o tag NFC');
            return;
        }

        await runAction('Cobro NFC', async () => {
            const due = details.table.balanceDueArs;
            const result = await fetchJSON(`${API_BASE}/payments/aba-nfc`, {
                method: 'POST',
                body: JSON.stringify({
                    sessionId: details.session.id,
                    tagId,
                    amountArs: due,
                }),
            });
            state.selectedDetails = result.details;
            els.nfcTagInput.value = '';
            await refreshEverything();
            showToast('Cobro NFC confirmado');
        });
    });

    els.createTransferBtn.addEventListener('click', async () => {
        if (!guardPermission('charge_payments', 'Tu rol no puede generar cobros por transferencia')) return;

        const details = state.selectedDetails;
        if (!details?.session) {
            showToast('No hay sesion activa');
            return;
        }

        await runAction('Alias de transferencia', async () => {
            const result = await fetchJSON(`${API_BASE}/payments/transfer`, {
                method: 'POST',
                body: JSON.stringify({
                    sessionId: details.session.id,
                    amountArs: details.table.balanceDueArs,
                }),
            });
            state.paymentDrawerOpen = true;
            await refreshEverything();
            renderTransferBox(result.payment);
            showToast('Alias reservado');
        });
    });

    els.createMercadoPagoBtn.addEventListener('click', async () => {
        if (!guardPermission('charge_payments', 'Tu rol no puede generar checkout MercadoPago')) return;

        const details = state.selectedDetails;
        if (!details?.session) {
            showToast('No hay sesion activa');
            return;
        }

        await runAction('Checkout MercadoPago', async () => {
            const result = await fetchJSON(`${API_BASE}/payments/mercadopago-checkout`, {
                method: 'POST',
                body: JSON.stringify({
                    sessionId: details.session.id,
                }),
            });
            state.paymentDrawerOpen = true;
            await refreshEverything();
            renderMercadoPagoBox(result.payment);
            showToast('Checkout MercadoPago listo');
        });
    });

    els.closeTableModalBtn.addEventListener('click', () => {
        closeTableModal();
    });

    els.tableModal.addEventListener('click', (event) => {
        if (event.target instanceof HTMLElement && event.target.matches('[data-close-modal]')) {
            closeTableModal();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && state.modalOpen) {
            closeTableModal();
        }
    });
}

function renderStaffUserOptions() {
    els.staffUserInput.innerHTML = STAFF_USERS.map((user) => `
        <option value="${escapeHtml(user.username)}">${escapeHtml(user.name)} - ${escapeHtml(roleLabel(user.role))}</option>
    `).join('');

    els.loginUserHints.innerHTML = STAFF_USERS.map((user) => `
        <div class="staff-chip">
            <strong>${escapeHtml(user.name)}</strong>
            <span>${escapeHtml(roleLabel(user.role))}</span>
        </div>
    `).join('');
}

function hydrateStaffSession() {
    const raw = window.localStorage.getItem(STAFF_SESSION_KEY);
    if (!raw) return;

    try {
        const parsed = JSON.parse(raw);
        const knownUser = STAFF_USERS.find((user) => user.username === parsed.username);
        if (!knownUser) {
            window.localStorage.removeItem(STAFF_SESSION_KEY);
            return;
        }

        state.currentStaff = sanitizeStaffUser(knownUser);
        els.staffUserInput.value = state.currentStaff.username;
    } catch (error) {
        console.warn('Sesion staff invalida', error);
        window.localStorage.removeItem(STAFF_SESSION_KEY);
    }
}

async function loginStaff() {
    const username = (els.staffUserInput.value || '').trim().toLowerCase();
    const password = els.staffPasswordInput.value;
    const user = STAFF_USERS.find((entry) => entry.username === username);

    if (!user || user.password !== password) {
        renderLoginError('Usuario o contrasena incorrectos');
        return;
    }

    state.currentStaff = sanitizeStaffUser(user);
    window.localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(state.currentStaff));
    els.staffPasswordInput.value = '';
    renderLoginError('');
    renderAuthState();
    await loadBootstrap();
    startPolling();
    showToast(`Turno abierto como ${state.currentStaff.name}`);
}

function logoutStaff() {
    window.localStorage.removeItem(STAFF_SESSION_KEY);
    state.currentStaff = null;
    state.floors = [];
    state.menu = [];
    state.tables = [];
    state.search = '';
    state.tableDirectory = [];
    state.dashboardSummary = null;
    state.selectedTableId = null;
    state.selectedDetails = null;
    state.draftsByTableId = {};
    state.paymentDrawerOpen = false;
    state.modalOpen = false;
    stopPolling();
    els.tableSearch.value = '';
    els.staffPasswordInput.value = '';
    renderLoginError('');
    renderAuthState();
    renderShell();
    showToast('Sesion cerrada');
}

function sanitizeStaffUser(user) {
    return {
        username: user.username,
        name: user.name,
        role: user.role,
        permissions: [...user.permissions],
    };
}

function renderAuthState() {
    const isAuthenticated = Boolean(state.currentStaff);

    els.loginGate.classList.toggle('hidden', isAuthenticated);
    els.staffAppShell.classList.toggle('hidden', !isAuthenticated);
    els.staffIdentity.classList.toggle('hidden', !isAuthenticated);

    if (!isAuthenticated) {
        els.staffDisplayName.textContent = '';
        els.staffDisplayRole.textContent = '';
        closeTableModal();
        return;
    }

    els.staffDisplayName.textContent = state.currentStaff.name;
    els.staffDisplayRole.textContent = roleLabel(state.currentStaff.role);
}

function renderLoginError(message) {
    els.loginError.textContent = message;
    els.loginError.classList.toggle('hidden', !message);
}

function roleLabel(role) {
    return ROLE_LABELS[role] || role;
}

function hasPermission(permission) {
    if (!state.currentStaff) return false;
    return state.currentStaff.permissions.includes('*') || state.currentStaff.permissions.includes(permission);
}

function guardPermission(permission, deniedMessage) {
    if (hasPermission(permission)) {
        return true;
    }

    showToast(deniedMessage || 'No tenes permisos para esta accion');
    return false;
}

function disabledAttr(permission) {
    return hasPermission(permission) ? '' : 'disabled';
}

async function loadBootstrap() {
    const data = await fetchJSON(`${API_BASE}/bootstrap`);
    state.floors = data.floors || [];
    state.menu = data.menu || [];
    state.activeFloorCode = data.activeFloorCode || state.floors[0]?.code || null;
    state.tables = filterTablesByFloor(data.tables || [], state.activeFloorCode);

    await Promise.all([
        loadTableDirectory(),
        loadDashboardSummary(),
    ]);

    renderShell();
}

async function refreshEverything() {
    await Promise.all([
        loadTables(state.activeFloorCode),
        loadTableDirectory(),
        loadDashboardSummary(),
    ]);

    if (state.selectedTableId) {
        try {
            const data = await fetchJSON(`${API_BASE}/sessions/details?tableId=${encodeURIComponent(state.selectedTableId)}`);
            state.selectedDetails = data.details;
        } catch (error) {
            console.error('No se pudo refrescar la mesa seleccionada', error);
            state.selectedDetails = null;
        }
    }

    renderShell();
}

async function loadTables(floorCode = state.activeFloorCode) {
    state.activeFloorCode = floorCode;
    const data = await fetchJSON(`${API_BASE}/tables?floorCode=${encodeURIComponent(floorCode)}`);
    state.tables = filterTablesByFloor(data.tables || [], floorCode);
    renderShell();
}

async function loadTableDirectory() {
    const data = await fetchJSON(`${API_BASE}/tables`);
    state.tableDirectory = data.tables || [];
    renderSearchResults();
}

async function loadDashboardSummary() {
    const data = await fetchJSON(`${API_BASE}/dashboard-summary`);
    state.dashboardSummary = data.summary || null;
    renderFinanceStats();
}

function renderShell() {
    renderPanelStats();
    renderFinanceStats();
    renderFloorTabs();
    renderTables();
    renderSearchResults();
    renderModal();
}

function renderPanelStats() {
    if (!els.panelStats) return;

    const floorCount = state.floors.length || 3;
    const tableCount = state.tableDirectory.length || state.tables.length;
    const tablesPerFloor = Math.max(
        ...state.floors.map((floor) => state.tableDirectory.filter((table) => table.floorCode === floor.code).length),
        state.tables.length,
        10
    );
    els.panelStats.textContent = `${floorCount} pisos - ${tablesPerFloor} mesas por piso - ${tableCount} mesas activas`;
}

function filterTablesByFloor(tables, floorCode) {
    if (!floorCode) return tables;
    return tables.filter((table) => table.floorCode === floorCode);
}

function renderFloorTabs() {
    els.floorTabs.innerHTML = state.floors.map((floor) => `
        <button class="floor-tab ${floor.code === state.activeFloorCode ? 'active' : ''}" data-floor="${floor.code}">
            ${escapeHtml(floor.name)}
        </button>
    `).join('');

    els.floorTabs.querySelectorAll('[data-floor]').forEach((button) => {
        button.addEventListener('click', async () => {
            const floorCode = button.getAttribute('data-floor');
            await loadTables(floorCode);
        });
    });
}

function renderFinanceStats() {
    if (!els.financeStrip) return;

    if (!state.dashboardSummary) {
        els.financeStrip.innerHTML = `
            <div class="finance-card">
                <span>Salon vivo</span>
                <strong>$0</strong>
            </div>
            <div class="finance-card">
                <span>Cerradas hoy</span>
                <strong>$0</strong>
            </div>
            <div class="finance-card">
                <span>Total operativo</span>
                <strong>$0</strong>
            </div>
        `;
        return;
    }

    const summary = state.dashboardSummary;
    const cards = [
        ['Salon vivo', summary.liveOpenArs, `${summary.occupiedTableCount} mesas ocupadas`],
        ['Cerradas hoy', summary.closedArs, `${summary.closedSessionCount} cerradas`],
        ['Total operativo', summary.grandTotalArs, 'abiertas + cerradas'],
    ];

    els.financeStrip.innerHTML = cards.map(([label, value, meta]) => `
        <div class="finance-card">
            <span>${escapeHtml(label)}</span>
            <strong>${formatMoney(value)}</strong>
            <div class="finance-meta">${escapeHtml(meta)}</div>
        </div>
    `).join('');
}

function renderTables() {
    if (!state.tables.length) {
        els.tablesGrid.innerHTML = '<div class="table-card disabled"><h3>Sin mesas</h3><div class="table-meta">No hay mesas activas cargadas para este piso.</div></div>';
        return;
    }

    els.tablesGrid.innerHTML = state.tables.map((table) => {
        const draftCount = getDraftItemCount(table.tableId);
        const chip = renderTableAttentionChip(table);
        return `
            <button
                class="table-card ${tableToneClass(table)} ${table.tableId === state.selectedTableId ? 'active' : ''} ${table.isActive ? '' : 'disabled'}"
                data-table="${table.tableId}"
            >
                <div class="table-card-top">
                    <div>
                        <h3>${escapeHtml(displayTableLabel(table))}</h3>
                        <div class="table-meta">${escapeHtml(labelForTableState(table))}</div>
                        <div class="table-meta">${escapeHtml(tableContextMeta(table))}</div>
                    </div>
                    ${chip}
                </div>
                <div class="table-card-bottom">
                    <div class="table-total">${formatMoney(table.subtotalArs || 0)}</div>
                    <div class="table-balance">Saldo ${formatMoney(table.balanceDueArs || 0)}</div>
                    <div class="table-meta">${table.itemCount} items - ${table.guestCount} invitados</div>
                    ${draftCount ? `<div class="draft-chip">${draftCount} en borrador</div>` : ''}
                </div>
            </button>
        `;
    }).join('');

    els.tablesGrid.querySelectorAll('[data-table]').forEach((button) => {
        button.addEventListener('click', async () => {
            const tableId = button.getAttribute('data-table');
            await selectTable(tableId);
        });
    });
}

function renderSearchResults() {
    if (!els.tableSearchResults) return;

    if (!state.search) {
        els.tableSearchResults.innerHTML = '<div class="search-empty">Escribi una mesa, un piso o un token para saltar directo.</div>';
        return;
    }

    const results = state.tableDirectory
        .filter(matchesSearch)
        .slice(0, 10);

    if (!results.length) {
        els.tableSearchResults.innerHTML = '<div class="search-empty">No encontre ninguna mesa con ese criterio.</div>';
        return;
    }

    els.tableSearchResults.innerHTML = results.map((table) => `
        <button class="search-result-card" data-jump-table="${table.tableId}" data-jump-floor="${table.floorCode || ''}">
            <div>
                <strong>${escapeHtml(displayTableLabel(table))}</strong>
                <div class="payment-meta">${escapeHtml(table.floorName || table.floorCode || 'Sala')}</div>
                <div class="payment-meta">${escapeHtml(table.claimToken)}</div>
            </div>
            <div class="search-result-meta">
                <span>${escapeHtml(labelForTableState(table))}</span>
                <strong>${formatMoney(table.balanceDueArs || 0)}</strong>
            </div>
        </button>
    `).join('');

    els.tableSearchResults.querySelectorAll('[data-jump-table]').forEach((button) => {
        button.addEventListener('click', async () => {
            const tableId = button.getAttribute('data-jump-table');
            const floorCode = button.getAttribute('data-jump-floor');
            await jumpToTable(tableId, floorCode);
        });
    });
}

function matchesSearch(table) {
    const haystack = [
        displayTableLabel(table),
        String(table.tableNumber || ''),
        table.claimToken,
        table.floorName,
        table.floorCode,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    return haystack.includes(state.search);
}

async function selectTable(tableId) {
    state.selectedTableId = tableId;
    const table = getSelectedTable();
    if (!table) {
        state.selectedDetails = null;
        state.modalOpen = false;
        renderShell();
        return;
    }

    const data = await fetchJSON(`${API_BASE}/sessions/details?tableId=${encodeURIComponent(tableId)}`);
    state.selectedDetails = data.details;
    openTableModal();
    renderShell();
}

function getSelectedTable() {
    return state.tables.find((table) => table.tableId === state.selectedTableId)
        || state.tableDirectory.find((table) => table.tableId === state.selectedTableId)
        || null;
}

async function jumpToTable(tableId, floorCode) {
    if (!tableId) return;

    if (floorCode && floorCode !== state.activeFloorCode) {
        await loadTables(floorCode);
    }

    state.search = '';
    els.tableSearch.value = '';
    renderSearchResults();
    await selectTable(tableId);
}

function openTableModal() {
    state.modalOpen = true;
    document.body.classList.add('modal-open');
    window.requestAnimationFrame(() => {
        if (els.tableModalSheet) {
            els.tableModalSheet.scrollTop = 0;
        }
    });
}

function closeTableModal() {
    state.modalOpen = false;
    state.paymentDrawerOpen = false;
    document.body.classList.remove('modal-open');
    renderModal();
}

function renderModal() {
    const details = state.selectedDetails;
    const shouldShow = Boolean(details && state.modalOpen);

    els.tableModal.classList.toggle('hidden', !shouldShow);
    els.tableModal.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    document.body.classList.toggle('modal-open', shouldShow);

    if (!shouldShow) {
        return;
    }

    els.detailFloor.textContent = details.table.floorName || details.table.floorCode || 'Piso';
    els.detailTableLabel.textContent = displayTableLabel(details.table);
    els.detailClaimToken.textContent = `Token mesa: ${details.table.claimToken}`;
    els.detailStatus.textContent = labelForTableState(details.table);
    els.summaryTotal.textContent = formatMoney(details.table.subtotalArs);
    els.summaryPaid.textContent = formatMoney(details.table.paidArs);
    els.summaryDue.textContent = formatMoney(details.table.balanceDueArs);
    els.summaryGuests.textContent = String(details.table.guestCount);

    renderAttentionHeader(details);
    renderSessionActions(details);
    renderCheckoutPanel(details);
    renderDraftState(details);
    renderOrders(details);
    renderPayments(details);
}

function renderAttentionHeader(details) {
    const table = details.table;
    const badgeClasses = ['attention-badge'];
    let badgeText = '';

    if (table.hasPendingTransfer) {
        badgeClasses.push('critical');
        badgeText = 'Transferencia pendiente';
    } else if (table.attentionState === 'critical') {
        badgeClasses.push('critical');
        badgeText = `${attentionSourceLabel(table.attentionSource)} - ${formatElapsedMinutes(table.attentionElapsedMinutes)}`;
    } else if (table.attentionState === 'warning') {
        badgeClasses.push(table.attentionElapsedMinutes >= 5 ? 'hot' : 'warm');
        badgeText = `${attentionSourceLabel(table.attentionSource)} - ${formatElapsedMinutes(table.attentionElapsedMinutes)}`;
    }

    if (!badgeText) {
        els.detailAttentionBadge.className = 'attention-badge hidden';
        els.detailAttentionBadge.textContent = '';
    } else {
        els.detailAttentionBadge.className = badgeClasses.join(' ');
        els.detailAttentionBadge.textContent = badgeText;
    }

    if (!table.sessionId) {
        setMetaCard(els.detailAttentionMeta, 'Reloj de atencion', 'Mesa libre, sin pedidos ni urgencias activas.');
    } else if (table.attentionState === 'none') {
        setMetaCard(els.detailAttentionMeta, 'Reloj de atencion', 'Mesa ocupada sin pedidos pendientes de atencion.');
    } else {
        setMetaCard(
            els.detailAttentionMeta,
            'Reloj de atencion',
            `Pendiente hace ${formatElapsedMinutes(table.attentionElapsedMinutes)} - origen ${attentionSourceLabel(table.attentionSource)}.`
        );
    }

    const latestOrder = getLatestActiveOrder(details.orders);
    if (!latestOrder) {
        setMetaCard(els.detailOrderSource, 'Ultimo bloque', 'Todavia no hay pedidos activos en esta mesa.');
        return;
    }

    setMetaCard(
        els.detailOrderSource,
        'Ultimo bloque',
        `${sourceLabel(latestOrder.source)} - ${formatOrderTime(latestOrder.createdAt)} - ${orderStatusLabel(latestOrder.status)}.`
    );
}

function renderSessionActions(details) {
    if (!details.session) {
        els.sessionActions.innerHTML = `
            <button class="primary-btn" id="openSessionBtn" ${disabledAttr('open_session')}>Abrir mesa</button>
            <button class="ghost-btn" id="refreshSessionBtn" type="button">Refrescar</button>
            <button class="ghost-btn" type="button" disabled>Marcar atendida</button>
            <button class="ghost-btn" type="button" disabled>Cerrar mesa</button>
        `;

        const openSessionBtn = document.getElementById('openSessionBtn');
        const refreshSessionBtn = document.getElementById('refreshSessionBtn');

        if (openSessionBtn && hasPermission('open_session')) {
            openSessionBtn.addEventListener('click', async () => {
                await runAction('Abrir mesa', async () => {
                    const result = await fetchJSON(`${API_BASE}/sessions/open`, {
                        method: 'POST',
                        body: JSON.stringify({ tableId: details.table.tableId }),
                    });
                    state.selectedDetails = result.details;
                    await refreshEverything();
                    showToast('Mesa abierta');
                });
            });
        }

        refreshSessionBtn?.addEventListener('click', async () => {
            await refreshEverything();
        });
        return;
    }

    const hasAttention = hasPendingAttention(details);
    const canClose = Number(details.table.balanceDueArs || 0) <= 0;
    const due = Number(details.table.balanceDueArs || 0);

    const actions = [
        `<button class="ghost-btn" id="refreshSessionBtn" type="button">Refrescar</button>`,
        `<button class="ghost-btn" id="markAttendedBtn" type="button" ${hasAttention ? disabledAttr('manage_orders') : 'disabled'}>Marcar atendida</button>`,
        `<button class="primary-btn" id="closeSessionBtn" type="button" ${(canClose && hasPermission('close_session')) ? '' : 'disabled'}>Cerrar mesa</button>`,
    ];

    if (due > 0) {
        actions.unshift(`<button class="danger-btn" id="openCheckoutBtn" type="button" ${disabledAttr('charge_payments')}>Cobrar pedido de ${escapeHtml(displayTableLabel(details.table))}</button>`);
    }

    els.sessionActions.innerHTML = actions.join('');

    document.getElementById('refreshSessionBtn')?.addEventListener('click', async () => {
        await refreshEverything();
    });

    document.getElementById('openCheckoutBtn')?.addEventListener('click', () => {
        state.paymentDrawerOpen = true;
        renderCheckoutPanel(details);
        focusPaymentDrawerOnMobile();
    });

    const markAttendedBtn = document.getElementById('markAttendedBtn');
    if (markAttendedBtn && hasAttention && hasPermission('manage_orders')) {
        markAttendedBtn.addEventListener('click', async () => {
            await runAction('Marcar atendida', async () => {
                const result = await fetchJSON(`${API_BASE}/sessions/mark-attended`, {
                    method: 'POST',
                    body: JSON.stringify({ sessionId: details.session.id }),
                });
                state.selectedDetails = result.details;
                await refreshEverything();
                showToast('Pedido marcado como atendido');
            });
        });
    }

    const closeSessionBtn = document.getElementById('closeSessionBtn');
    if (closeSessionBtn && canClose && hasPermission('close_session')) {
        closeSessionBtn.addEventListener('click', async () => {
            await runAction('Cerrar mesa', async () => {
                const result = await fetchJSON(`${API_BASE}/sessions/close`, {
                    method: 'POST',
                    body: JSON.stringify({ sessionId: details.session.id }),
                });
                state.selectedDetails = result.details;
                await refreshEverything();
                showToast('Mesa cerrada');
            });
        });
    }
}

function renderCheckoutPanel(details) {
    const canCharge = Boolean(details?.session && Number(details.table.balanceDueArs || 0) > 0);

    els.toggleCheckoutBtn.disabled = !canCharge || !hasPermission('charge_payments');
    els.chargeNfcBtn.disabled = !canCharge || !hasPermission('charge_payments');
    els.createTransferBtn.disabled = !canCharge || !hasPermission('charge_payments');
    els.createMercadoPagoBtn.disabled = !canCharge || !hasPermission('charge_payments');

    if (!details?.session) {
        state.paymentDrawerOpen = false;
        els.checkoutHint.textContent = 'Abri la mesa y recien ahi aparecen las opciones de cobro.';
        els.toggleCheckoutBtn.textContent = 'Cobrar pedido';
        els.paymentDrawer.classList.add('hidden');
        renderTransferBox(null);
        renderMercadoPagoBox(null);
        return;
    }

    if (!canCharge) {
        state.paymentDrawerOpen = false;
        els.checkoutHint.textContent = 'La mesa ya esta saldada. Si queres, ya podes cerrarla.';
        els.toggleCheckoutBtn.textContent = `Mesa ${displayTableLabel(details.table)} saldada`;
        els.paymentDrawer.classList.add('hidden');
        renderTransferBox(null);
        renderMercadoPagoBox(null);
        return;
    }

    const tableLabel = displayTableLabel(details.table);
    els.checkoutHint.textContent = `Cobra ${formatMoney(details.table.balanceDueArs)} de ${tableLabel} con ABA NFC, transferencia o MercadoPago (+10%).`;
    els.toggleCheckoutBtn.textContent = `Cobrar pedido de ${tableLabel}`;
    els.paymentDrawer.classList.toggle('hidden', !state.paymentDrawerOpen);
}

function renderOrders(details) {
    const orders = details.orders || [];
    if (!orders.length) {
        els.ordersList.innerHTML = '<div class="order-card">Todavia no hay pedidos registrados en esta mesa.</div>';
        return;
    }

    els.ordersList.innerHTML = orders.map((order) => `
        <div class="order-card">
            <div class="order-item-row">
                <div>
                    <strong>${escapeHtml(sourceLabel(order.source))}</strong>
                    <div class="payment-meta">${formatOrderTime(order.createdAt)}</div>
                </div>
                <span class="order-status-tag status-${escapeHtml(order.status)}">${escapeHtml(orderStatusLabel(order.status))}</span>
            </div>
            <div class="order-items-stack">
                ${order.items.length ? order.items.map((item) => `
                    <div class="order-item-row">
                        <div>
                            <div><strong>${item.quantity}x ${escapeHtml(item.itemName)}</strong></div>
                            <div class="payment-meta">${item.note ? escapeHtml(item.note) : 'Sin nota'}</div>
                        </div>
                        <div class="inline-actions">
                            <span class="payment-meta">${formatMoney(item.lineTotalArs)}</span>
                            ${item.status === 'active'
                                ? `<button data-void-item="${item.id}" ${disabledAttr('manage_orders')}>Anular</button>`
                                : '<span class="payment-meta">Anulado</span>'}
                        </div>
                    </div>
                `).join('') : '<div class="payment-meta">Todos los items de este bloque fueron anulados.</div>'}
            </div>
        </div>
    `).join('');

    if (!hasPermission('manage_orders')) return;

    els.ordersList.querySelectorAll('[data-void-item]').forEach((button) => {
        button.addEventListener('click', async () => {
            const itemId = button.getAttribute('data-void-item');
            await runAction('Anular item', async () => {
                const result = await fetchJSON(`${API_BASE}/orders/update-item`, {
                    method: 'POST',
                    body: JSON.stringify({ itemId, status: 'voided' }),
                });
                state.selectedDetails = result.details;
                await refreshEverything();
                showToast('Item anulado');
            });
        });
    });
}

function renderDraftState(details) {
    renderDraftSummary(details);
    renderMenuCatalog(details);
}

function renderDraftSummary(details) {
    const tableId = details?.table?.tableId || state.selectedTableId;
    const draftItems = getDraftEntries(tableId);
    const quantity = draftItems.reduce((total, item) => total + item.quantity, 0);
    const total = draftItems.reduce((sum, item) => sum + (item.quantity * item.unitPriceArs), 0);
    const tableLabel = details?.table?.label || 'Mesa';
    const sessionStatus = details?.session ? 'sesion activa' : 'sin sesion aun';

    els.draftSummary.innerHTML = `
        <div class="draft-summary-head">
            <div>
                <strong>${escapeHtml(tableLabel)}</strong>
                <div class="payment-meta">Borrador ligado a ${escapeHtml(sessionStatus)}</div>
            </div>
            <div class="draft-summary-total">${formatMoney(total)}</div>
        </div>
        <div class="draft-pills">
            <span class="draft-pill">${quantity} items</span>
            <span class="draft-pill">${draftItems.length} productos</span>
            <span class="draft-pill">${escapeHtml(details?.table?.claimToken || 'sin token')}</span>
        </div>
        <div class="draft-list">
            ${draftItems.length
                ? draftItems.map((item) => `<span class="draft-line">${item.quantity}x ${escapeHtml(item.itemName)}</span>`).join('')
                : '<span class="draft-line muted">Todavia no cargaste nada en esta mesa.</span>'}
        </div>
    `;

    els.clearDraftBtn.disabled = !hasPermission('manage_orders') || draftItems.length === 0;
    els.sendDraftBtn.disabled = !hasPermission('manage_orders') || draftItems.length === 0;
}

function renderMenuCatalog(details) {
    const tableId = details?.table?.tableId || state.selectedTableId;
    if (!tableId) {
        els.menuCatalog.innerHTML = '<div class="catalog-card"><div>Elegi una mesa para empezar a cargar la comanda.</div></div>';
        return;
    }

    if (!state.menu.length || state.menu.every((category) => !category.items.length)) {
        els.menuCatalog.innerHTML = '<div class="catalog-card"><div>No hay catalogo cargado todavia. Podes usar el formulario manual.</div></div>';
        return;
    }

    const draft = getDraftForTable(tableId);

    els.menuCatalog.innerHTML = state.menu.map((category) => `
        <div class="menu-category">
            <h4>${escapeHtml(category.name)}</h4>
            <div class="quick-product-grid">
                ${(category.items || []).map((item) => {
                    const quantity = draft[item.id]?.quantity || 0;
                    return `
                        <div class="catalog-card quick-product-card ${quantity > 0 ? 'selected' : ''}">
                            <div class="quick-product-copy">
                                <h5>${escapeHtml(item.name)}</h5>
                                <div class="payment-meta">${formatMoney(item.unitPriceArs)}</div>
                            </div>
                            <div class="quick-qty-controls">
                                <button data-draft-item="${item.id}" data-delta="-1" ${disabledAttr('manage_orders')}>-</button>
                                <span class="quick-qty">${quantity}</span>
                                <button data-draft-item="${item.id}" data-delta="1" ${disabledAttr('manage_orders')}>+</button>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `).join('');

    if (!hasPermission('manage_orders')) return;

    els.menuCatalog.querySelectorAll('[data-draft-item]').forEach((button) => {
        button.addEventListener('click', () => {
            const menuItemId = button.getAttribute('data-draft-item');
            const delta = Number(button.getAttribute('data-delta') || 0);
            const menuItem = findMenuItem(menuItemId);
            if (!menuItem || !delta) return;

            changeDraftQuantity(tableId, menuItem, delta);
            renderDraftState(state.selectedDetails);
            renderTables();
        });
    });
}

function getDraftForTable(tableId) {
    if (!tableId) return {};
    if (!state.draftsByTableId[tableId]) {
        state.draftsByTableId[tableId] = {};
    }
    return state.draftsByTableId[tableId];
}

function getDraftEntries(tableId) {
    return Object.values(getDraftForTable(tableId)).filter((item) => item.quantity > 0);
}

function getDraftItemCount(tableId) {
    return getDraftEntries(tableId).reduce((total, item) => total + item.quantity, 0);
}

function clearDraftForTable(tableId, rerender = true) {
    if (!tableId) return;
    delete state.draftsByTableId[tableId];

    if (rerender) {
        renderDraftState(state.selectedDetails);
        renderTables();
    }
}

function changeDraftQuantity(tableId, menuItem, delta) {
    const draft = getDraftForTable(tableId);
    const current = draft[menuItem.id] || {
        menuItemId: menuItem.id,
        itemName: menuItem.name,
        unitPriceArs: Number(menuItem.unitPriceArs || 0),
        quantity: 0,
    };

    current.quantity = Math.max(0, current.quantity + delta);

    if (current.quantity === 0) {
        delete draft[menuItem.id];
    } else {
        draft[menuItem.id] = current;
    }
}

function findMenuItem(menuItemId) {
    for (const category of state.menu) {
        const match = (category.items || []).find((item) => item.id === menuItemId);
        if (match) return match;
    }
    return null;
}

async function upsertItems(sessionId, items, successMessage = 'Item agregado') {
    if (!guardPermission('manage_orders', 'Tu rol no puede cargar items')) return;

    await runAction('Agregar item', async () => {
        const result = await fetchJSON(`${API_BASE}/orders/upsert-items`, {
            method: 'POST',
            body: JSON.stringify({
                sessionId,
                source: 'staff',
                items,
            }),
        });
        state.selectedDetails = result.details;
        await refreshEverything();
        showToast(successMessage);
    });
}

function renderPayments(details) {
    if (!details.payments.length) {
        els.paymentsList.innerHTML = '<div class="payment-entry">Todavia no hay pagos registrados.</div>';
        renderTransferBox(null);
        renderMercadoPagoBox(null);
        return;
    }

    els.paymentsList.innerHTML = details.payments.map((payment) => `
        <div class="payment-entry">
            <div class="payment-entry-head">
                <strong>${escapeHtml(labelForPaymentMethod(payment.method))}</strong>
                <span class="payment-meta">${escapeHtml(payment.status)}</span>
            </div>
            <div class="payment-meta">
                ${formatMoney(payment.amountArs)}
                ${payment.tipArs ? ` + ${formatMoney(payment.tipArs)} recargo` : ''}
                ${payment.amountAba ? ` - ${payment.amountAba} ABA` : ''}
            </div>
            ${payment.transferAlias ? `<div class="payment-meta">Alias: ${escapeHtml(payment.transferAlias)}</div>` : ''}
            ${payment.transferReference ? `<div class="payment-meta">Ref: ${escapeHtml(payment.transferReference)}</div>` : ''}
            ${payment.method === 'mercadopago_webhook' && payment.metadata?.initPoint ? `
                <div class="payment-meta">Checkout MP listo</div>
                <div class="inline-actions">
                    <a class="inline-link" href="${escapeHtml(payment.metadata.initPoint)}" target="_blank" rel="noreferrer">Abrir checkout</a>
                </div>
            ` : ''}
            ${payment.status === 'pending' && payment.method === 'transfer_alias' ? `
                <div class="inline-actions">
                    <button data-confirm-transfer="${payment.id}" ${disabledAttr('confirm_transfer')}>Confirmar transferencia</button>
                </div>
            ` : ''}
        </div>
    `).join('');

    const pendingTransfer = details.payments.find((payment) => payment.status === 'pending' && payment.method === 'transfer_alias');
    const pendingMercadoPago = details.payments.find((payment) => payment.status === 'pending' && payment.method === 'mercadopago_webhook');
    renderTransferBox(pendingTransfer);
    renderMercadoPagoBox(pendingMercadoPago);

    if (!hasPermission('confirm_transfer')) return;

    els.paymentsList.querySelectorAll('[data-confirm-transfer]').forEach((button) => {
        button.addEventListener('click', async () => {
            const paymentIntentId = button.getAttribute('data-confirm-transfer');
            await runAction('Confirmar transferencia', async () => {
                const result = await fetchJSON(`${API_BASE}/payments/confirm-transfer`, {
                    method: 'POST',
                    body: JSON.stringify({ paymentIntentId }),
                });
                state.selectedDetails = result.details;
                await refreshEverything();
                showToast('Transferencia confirmada');
            });
        });
    });
}

function renderMercadoPagoBox(payment) {
    if (!payment) {
        els.mercadoPagoBox.classList.add('hidden');
        els.mercadoPagoBox.innerHTML = '';
        return;
    }

    const initPoint = payment.initPoint || payment.metadata?.initPoint || null;
    const baseAmountArs = payment.baseAmountArs || payment.metadata?.baseAmountArs || payment.amountArs || 0;
    const surchargeArs = payment.surchargeArs || payment.metadata?.surchargeArs || payment.tipArs || 0;
    const totalAmountArs = payment.totalAmountArs || payment.metadata?.totalAmountArs || (Number(baseAmountArs) + Number(surchargeArs));
    const externalReference = payment.externalReference || payment.metadata?.externalReference || null;

    els.mercadoPagoBox.classList.remove('hidden');
    els.mercadoPagoBox.innerHTML = `
        <strong>Checkout MercadoPago listo</strong>
        <div>Base: ${formatMoney(baseAmountArs)}</div>
        <div>Recargo MP: ${formatMoney(surchargeArs)}</div>
        <div>Total cliente: ${formatMoney(totalAmountArs)}</div>
        <div>Referencia: ${escapeHtml(externalReference || '-')}</div>
        ${initPoint ? `<a class="checkout-link" href="${escapeHtml(initPoint)}" target="_blank" rel="noreferrer">Abrir checkout MercadoPago</a>` : ''}
    `;
}

function renderTransferBox(payment) {
    if (!payment) {
        els.transferBox.classList.add('hidden');
        els.transferBox.innerHTML = '';
        return;
    }

    const expires = payment.expiresAt || payment.expires_at || null;
    const alias = payment.alias || payment.transferAlias || null;
    const ownerName = payment.ownerName || payment.metadata?.ownerName || null;
    const bankName = payment.bankName || payment.metadata?.bankName || null;
    const cbuPartial = payment.cbuPartial || payment.metadata?.cbuPartial || null;
    const reference = payment.reference || payment.transferReference || null;

    els.transferBox.classList.remove('hidden');
    els.transferBox.innerHTML = `
        <strong>${alias || 'Alias asignado'}</strong>
        <div>Titular: ${escapeHtml(ownerName || 'Sin titular')}</div>
        <div>Banco: ${escapeHtml(bankName || 'Sin banco')}</div>
        <div>CBU parcial: ${escapeHtml(cbuPartial || '-')}</div>
        <div>Referencia: ${escapeHtml(reference || '-')}</div>
        <div>Vence: ${expires ? new Date(expires).toLocaleString('es-AR') : '-'}</div>
    `;
}

async function ensureSessionForTable(table) {
    if (
        state.selectedDetails?.table?.tableId === table.tableId
        && state.selectedDetails?.session?.id
    ) {
        return state.selectedDetails;
    }

    if (!guardPermission('open_session', 'Tu rol no puede abrir mesas')) {
        throw new Error('Sin permisos para abrir mesas');
    }

    const result = await fetchJSON(`${API_BASE}/sessions/open`, {
        method: 'POST',
        body: JSON.stringify({ tableId: table.tableId }),
    });
    state.selectedDetails = result.details;
    await refreshEverything();
    return result.details;
}

async function runAction(label, fn) {
    try {
        await fn();
        renderShell();
    } catch (error) {
        console.error(`${label} error:`, error);
        showToast(error.message || `${label} fallo`);
    }
}

function startPolling() {
    stopPolling();
    state.pollHandle = window.setInterval(() => {
        if (!state.currentStaff) return;
        refreshEverything().catch((error) => console.error('Polling error:', error));
    }, POLL_INTERVAL_MS);
}

function stopPolling() {
    if (!state.pollHandle) return;
    window.clearInterval(state.pollHandle);
    state.pollHandle = null;
}

async function fetchJSON(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
        ...options,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
        throw new Error(data.error || `Request fallo: ${response.status}`);
    }
    return data;
}

function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove('hidden');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
        els.toast.classList.add('hidden');
    }, 2400);
}

function formatMoney(value) {
    const amount = Number(value || 0);
    return `$${Math.round(amount).toLocaleString('es-AR')}`;
}

function formatElapsedMinutes(value) {
    const minutes = Math.max(0, Number(value || 0));
    if (minutes < 1) return '0 min';
    return `${minutes} min`;
}

function formatOrderTime(value) {
    if (!value) return 'sin hora';
    return new Date(value).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function labelForPaymentMethod(method) {
    switch (method) {
        case 'aba_nfc':
            return 'ABA NFC';
        case 'aba_wallet':
            return 'ABA Wallet';
        case 'transfer_alias':
            return 'Transferencia';
        case 'app_aba':
            return 'ABA app';
        case 'app_transfer':
            return 'Transferencia app';
        case 'mercadopago_webhook':
            return 'MercadoPago';
        default:
            return method;
    }
}

function labelForTableState(table) {
    if (!table?.sessionId) return 'libre';
    if (table.hasPendingTransfer) return 'transferencia pendiente';
    if (table.sessionStatus === 'checkout_requested') return 'mozo solicitado';
    if (table.sessionStatus === 'paid' || table.uiState === 'pagada') return 'pagada';
    return 'ocupada';
}

function displayTableLabel(table) {
    const number = Number(table?.tableNumber || 0);
    if (number > 0) {
        return String(Math.trunc(number)).padStart(2, '0');
    }

    const label = String(table?.label || '').trim();
    return label || '00';
}

function orderStatusLabel(status) {
    switch (status) {
        case 'sent':
            return 'pendiente';
        case 'served':
            return 'atendido';
        case 'cancelled':
            return 'cancelado';
        default:
            return status;
    }
}

function sourceLabel(source) {
    return source === 'client' ? 'Pedido cliente' : 'Comanda mozo';
}

function attentionSourceLabel(source) {
    switch (source) {
        case 'client':
            return 'cliente';
        case 'staff':
            return 'mozo';
        case 'mixed':
            return 'mixto';
        default:
            return 'sin urgencia';
    }
}

function hasPendingAttention(details) {
    return (details.orders || []).some((order) => order.status === 'sent' && order.items.some((item) => item.status === 'active'));
}

function getLatestActiveOrder(orders) {
    return [...(orders || [])]
        .filter((order) => order.items.some((item) => item.status === 'active'))
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0] || null;
}

function tableToneClass(table) {
    if (!table?.sessionId) return 'tone-neutral';
    if (table.hasPendingTransfer) return 'tone-transfer';
    if (table.sessionStatus === 'paid' || table.uiState === 'pagada') return 'tone-paid';
    if (table.attentionState === 'critical') return 'tone-critical';
    if (table.attentionState === 'warning' && table.attentionElapsedMinutes >= 5) return 'tone-hot';
    if (table.attentionState === 'warning') return 'tone-warning';
    return 'tone-occupied';
}

function tableContextMeta(table) {
    if (!table?.sessionId) return 'lista para abrir';
    if (table.hasPendingTransfer) return 'alias pendiente de confirmar';
    if (table.attentionState === 'critical' || table.attentionState === 'warning') {
        return `${attentionSourceLabel(table.attentionSource)} - ${formatElapsedMinutes(table.attentionElapsedMinutes)}`;
    }
    if (table.sessionStatus === 'checkout_requested') return 'cliente llamo al mozo';
    if (table.sessionStatus === 'paid' || table.uiState === 'pagada') return 'cuenta saldada';
    return 'ocupada sin urgencia';
}

function renderTableAttentionChip(table) {
    if (!table?.sessionId) return '<span class="table-chip neutral">Libre</span>';
    if (table.hasPendingTransfer) return '<span class="table-chip critical">Alias</span>';
    if (table.sessionStatus === 'paid' || table.uiState === 'pagada') return '<span class="table-chip paid">Pagada</span>';
    if (table.attentionState === 'critical') return `<span class="table-chip critical">${escapeHtml(formatElapsedMinutes(table.attentionElapsedMinutes))}</span>`;
    if (table.attentionState === 'warning' && table.attentionElapsedMinutes >= 5) return `<span class="table-chip hot">${escapeHtml(formatElapsedMinutes(table.attentionElapsedMinutes))}</span>`;
    if (table.attentionState === 'warning') return `<span class="table-chip warm">${escapeHtml(formatElapsedMinutes(table.attentionElapsedMinutes))}</span>`;
    return '<span class="table-chip occupied">En sala</span>';
}

function setMetaCard(element, title, body) {
    element.innerHTML = `
        <span>${escapeHtml(title)}</span>
        <strong>${escapeHtml(body)}</strong>
    `;
}

function focusPaymentDrawerOnMobile() {
    if (typeof window === 'undefined' || window.innerWidth > 740 || els.paymentDrawer.classList.contains('hidden')) return;

    window.requestAnimationFrame(() => {
        els.paymentDrawer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

function escapeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
