/**
 * NFC POS — Aquilea 57
 * Staff-facing app for NFC tag payment processing
 * 
 * Flow:
 * 1. NFC tag opens URL: /nfc-pos/?tag=AQ-00001
 * 2. App looks up citizen via API
 * 3. Staff enters amount and charges against ABA balance
 */

// API base — same vercel deployment
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000/api/smaq'
    : '/api/smaq';

let currentCitizen = null;
let currentTagId = null;

// --- INIT ---

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const tag = params.get('tag');

    if (tag) {
        currentTagId = tag.toUpperCase();
        lookupTag(currentTagId);
    } else {
        showScreen('no-tag');
    }

    // Enter key handling
    document.getElementById('link-email').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') linkTag();
    });
    document.getElementById('charge-amount').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') processCharge();
    });
    document.getElementById('manual-tag').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') manualLookup();
    });
});

// --- SCREEN MANAGEMENT ---

function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(`screen-${name}`);
    if (screen) {
        screen.classList.add('active');
        // Re-trigger animation
        screen.style.animation = 'none';
        screen.offsetHeight; // force reflow
        screen.style.animation = '';
    }
}

// --- NFC TAG LOOKUP ---

async function lookupTag(tagId) {
    showScreen('loading');

    try {
        const res = await fetch(`${API_BASE}/nfc?tag=${encodeURIComponent(tagId)}`);
        const data = await res.json();

        if (data.success && data.linked) {
            currentCitizen = data.citizen;
            currentTagId = data.tag;
            renderCitizen(data.citizen);
            showScreen('citizen');
        } else {
            currentTagId = tagId.toUpperCase();
            document.getElementById('unlinked-tag-id').textContent = `Tag: ${currentTagId}`;
            showScreen('unlinked');
        }
    } catch (err) {
        showError(`Error de conexión: ${err.message}`);
    }
}

// --- RENDER CITIZEN ---

function renderCitizen(citizen) {
    // Avatar with initials
    const initials = (citizen.name || '?')
        .split(' ')
        .map(w => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();

    document.getElementById('citizen-avatar').textContent = initials;
    document.getElementById('citizen-name').textContent = citizen.name;
    document.getElementById('citizen-email').textContent = citizen.email;
    document.getElementById('citizen-balance').textContent = citizen.balance;

    // Reset charge form
    document.getElementById('charge-amount').value = '';
    document.getElementById('charge-error').classList.add('hidden');
}

// --- LINK TAG ---

async function linkTag() {
    const email = document.getElementById('link-email').value.trim();
    const errorEl = document.getElementById('link-error');
    const btn = document.getElementById('btn-link');

    if (!email) {
        errorEl.textContent = 'Ingresá el email del socio';
        errorEl.classList.remove('hidden');
        return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ Vinculando...';
    errorEl.classList.add('hidden');

    try {
        const res = await fetch(`${API_BASE}/nfc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'link', tagId: currentTagId, email })
        });

        const data = await res.json();

        if (data.success) {
            // Successfully linked — show citizen
            if (data.citizen) {
                currentCitizen = data.citizen;
                renderCitizen(data.citizen);
                showScreen('citizen');
            } else {
                // Linked but no citizen data returned, re-lookup
                await lookupTag(currentTagId);
            }
        } else {
            errorEl.textContent = data.error || 'Error al vincular';
            errorEl.classList.remove('hidden');
        }
    } catch (err) {
        errorEl.textContent = `Error de conexión: ${err.message}`;
        errorEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = '🔗 Vincular tag';
    }
}

// --- CHARGE ---

async function processCharge() {
    const amountInput = document.getElementById('charge-amount');
    const amount = parseInt(amountInput.value);
    const errorEl = document.getElementById('charge-error');
    const btn = document.getElementById('btn-charge');

    if (!amount || amount <= 0) {
        errorEl.textContent = 'Ingresá un monto válido';
        errorEl.classList.remove('hidden');
        return;
    }

    if (!currentCitizen) {
        errorEl.textContent = 'No hay socio cargado';
        errorEl.classList.remove('hidden');
        return;
    }

    if (amount > currentCitizen.balance) {
        errorEl.textContent = `Saldo insuficiente. El socio tiene ${currentCitizen.balance} ABA.`;
        errorEl.classList.remove('hidden');
        return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ Procesando...';
    errorEl.classList.add('hidden');

    try {
        const res = await fetch(`${API_BASE}/nfc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'charge',
                email: currentCitizen.email,
                amount: amount
            })
        });

        const data = await res.json();

        if (data.success) {
            // Show success
            document.getElementById('success-name').textContent = currentCitizen.name;
            document.getElementById('success-amount').textContent = `-${amount} ABA`;
            document.getElementById('success-balance').textContent = `${data.newBalance} ABA`;
            showScreen('success');

            // Update cached citizen balance
            currentCitizen.balance = data.newBalance;
        } else {
            errorEl.textContent = data.error || 'Error al procesar cobro';
            errorEl.classList.remove('hidden');
        }
    } catch (err) {
        errorEl.textContent = `Error de conexión: ${err.message}`;
        errorEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = '💳 Cobrar';
    }
}

// --- QUICK AMOUNTS ---

function setAmount(value) {
    document.getElementById('charge-amount').value = value;
    document.getElementById('charge-amount').focus();
}

// --- MANUAL LOOKUP ---

function manualLookup() {
    const input = document.getElementById('manual-tag');
    const tag = input.value.trim().toUpperCase();

    if (!tag) return;

    currentTagId = tag;
    // Update URL without reload
    window.history.replaceState({}, '', `?tag=${encodeURIComponent(tag)}`);
    lookupTag(tag);
}

// --- RESET ---

function resetToScan() {
    currentCitizen = null;
    currentTagId = null;
    window.history.replaceState({}, '', window.location.pathname);
    showScreen('no-tag');
    document.getElementById('manual-tag').value = '';
    document.getElementById('link-email').value = '';
}
