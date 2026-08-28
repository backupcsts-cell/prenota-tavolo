// ==== CONFIGURAZIONE ====
// Stesso URL Apps Script usato in js/main.js (termina con /exec).
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzxSUuWYciNxl1SZImevHVjGOqeWHnj3DPjG6Z5Nori0Exxqx9i0VC_m9OOzYELYEew/exec';

// Ogni quanti millisecondi ricontrollare le nuove prenotazioni.
// Google Apps Script non supporta connessioni realtime (niente Socket.io),
// quindi qui usiamo un "polling" automatico: la tabella si aggiorna da sola
// a intervalli regolari, senza bisogno di ricaricare la pagina.
const POLL_INTERVAL_MS = 12000;

async function callApi(action, data) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action }, data)),
  });
  return res.json();
}

const loginWrap = document.getElementById('login-wrap');
const dashboardWrap = document.getElementById('dashboard-wrap');
const tbody = document.getElementById('bookings-table-body');

function getAdminToken() {
  return localStorage.getItem('adminToken');
}
function saveAdminToken(token) {
  localStorage.setItem('adminToken', token);
}
function clearAdminToken() {
  localStorage.removeItem('adminToken');
}

function showMsg(elId, text, type) {
  const el = document.getElementById(elId);
  el.textContent = text;
  el.className = `msg show ${type}`;
}

// ==== LOGIN ====
document.getElementById('btn-login').addEventListener('click', async () => {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  try {
    const data = await callApi('adminLogin', { username, password });
    if (data.error) throw new Error(data.error);

    saveAdminToken(data.token);
    enterDashboard();
  } catch (err) {
    showMsg('login-msg', err.message, 'error');
  }
});

document.getElementById('btn-logout-admin').addEventListener('click', () => {
  clearAdminToken();
  stopPolling();
  location.reload();
});

// ==== DASHBOARD ====
let pollTimer = null;
let knownIds = new Set();

function enterDashboard() {
  loginWrap.classList.add('hidden');
  dashboardWrap.classList.remove('hidden');
  loadBookings(true);
  startPolling();
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => loadBookings(false), POLL_INTERVAL_MS);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function loadBookings(isFirstLoad) {
  try {
    const data = await callApi('adminBookings', { token: getAdminToken() });
    if (data.error) throw new Error(data.error);

    const bookings = data.bookings || [];

    if (isFirstLoad) {
      knownIds = new Set(bookings.map((b) => b.ID));
      renderTable(bookings);
    } else {
      // Evidenzia solo le prenotazioni nuove arrivate dall'ultimo controllo
      const fresh = bookings.filter((b) => !knownIds.has(b.ID));
      fresh.forEach((b) => knownIds.add(b.ID));
      renderTable(bookings, fresh.map((b) => b.ID));
    }

    updateStats(bookings);
  } catch (err) {
    console.error('Errore caricamento prenotazioni:', err.message);
    if (err.message && (err.message.includes('valido') || err.message.includes('scaduto'))) {
      clearAdminToken();
      stopPolling();
      location.reload();
    }
  }
}

function renderTable(bookings, newIds) {
  tbody.innerHTML = '';
  bookings.forEach((b) => appendRow(b, newIds && newIds.includes(b.ID)));
}

function appendRow(b, isNew) {
  const tr = document.createElement('tr');
  if (isNew) tr.classList.add('new-row');

  const dataStr = `${b.Giorno}/${b.Mese}/${b.Anno}`;
  const createdStr = b.DataCreazione ? new Date(b.DataCreazione).toLocaleString('it-IT') : '';

  tr.innerHTML = `
    <td data-label="Cliente">${escapeHtml(b.Nome)}</td>
    <td data-label="Email">${escapeHtml(b.Email)}</td>
    <td data-label="Persone">${escapeHtml(String(b.NumeroPersone))}</td>
    <td data-label="Data">${dataStr}</td>
    <td data-label="Ora">${escapeHtml(b.Ora)}</td>
    <td data-label="Stato"><span class="badge">${escapeHtml(b.Stato || 'Confermata')}</span></td>
    <td data-label="Creata il">${createdStr}</td>
  `;

  tbody.appendChild(tr);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function updateStats(bookings) {
  const today = new Date();
  const todayStr = `${today.getDate()}-${today.getMonth() + 1}-${today.getFullYear()}`;

  let todayCount = 0;
  let todayPeople = 0;
  let upcoming = 0;

  const now = new Date();
  const in7days = new Date();
  in7days.setDate(now.getDate() + 7);

  bookings.forEach((b) => {
    const bStr = `${b.Giorno}-${b.Mese}-${b.Anno}`;
    if (bStr === todayStr) {
      todayCount++;
      todayPeople += Number(b.NumeroPersone) || 0;
    }
    const bookingDate = new Date(`${b.Anno}-${b.Mese}-${b.Giorno}`);
    if (bookingDate >= now && bookingDate <= in7days) {
      upcoming++;
    }
  });

  document.getElementById('stat-total').textContent = bookings.length;
  document.getElementById('stat-today').textContent = todayCount;
  document.getElementById('stat-people').textContent = todayPeople;
  document.getElementById('stat-upcoming').textContent = upcoming;
}

// Se il token admin è già presente, entra direttamente
(function initAdmin() {
  if (getAdminToken()) {
    enterDashboard();
  }
})();
