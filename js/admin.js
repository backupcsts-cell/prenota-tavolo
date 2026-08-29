// ==== CONFIGURAZIONE ====
// Stesso URL Apps Script usato in js/main.js (termina con /exec).
const APPS_SCRIPT_URL = 'INCOLLA_QUI_URL_APPS_SCRIPT/exec';

// Ogni quanti millisecondi ricontrollare le nuove prenotazioni.
// Google Apps Script non supporta connessioni realtime (niente Socket.io),
// quindi qui usiamo un "polling" automatico: la tabella si aggiorna da sola
// a intervalli regolari, senza bisogno di ricaricare la pagina.
const POLL_INTERVAL_MS = 12000;

const WEEKDAY_NAMES = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

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
function clearMsg(elId) {
  const el = document.getElementById(elId);
  el.textContent = '';
  el.className = 'msg';
}

function handleAuthError(err) {
  if (err.message && (err.message.includes('valido') || err.message.includes('scaduto'))) {
    clearAdminToken();
    stopPolling();
    location.reload();
    return true;
  }
  return false;
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

// Chiude tutti i pannelli modali aperti (impostazioni, prenotazione, home page).
// Va richiamata prima di aprirne uno nuovo, per evitare che restino sovrapposti.
function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach((el) => el.classList.add('hidden'));
}

let pollTimer = null;
let knownIds = new Set();
let lastBookings = [];

function enterDashboard() {
  loginWrap.classList.add('hidden');
  dashboardWrap.classList.remove('hidden');
  loadSettings();
  loadHomepage();
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
    lastBookings = bookings;

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
    handleAuthError(err);
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
  const stato = b.Stato || 'Confermata';
  const badgeClass = stato === 'Annullata' ? 'badge cancelled' : 'badge';

  tr.innerHTML = `
    <td data-label="Cliente">${escapeHtml(b.Nome)}</td>
    <td data-label="Email">${escapeHtml(b.Email)}</td>
    <td data-label="Persone">${escapeHtml(String(b.NumeroPersone))}</td>
    <td data-label="Data">${dataStr}</td>
    <td data-label="Ora">${escapeHtml(b.Ora)}</td>
    <td data-label="Stato"><span class="${badgeClass}">${escapeHtml(stato)}</span></td>
    <td data-label="Creata il">${createdStr}</td>
    <td data-label="Azioni">
      <div class="row-actions">
        <button class="btn-icon edit" data-action="edit" data-id="${escapeHtml(b.ID)}">Modifica</button>
        <button class="btn-icon delete" data-action="delete" data-id="${escapeHtml(b.ID)}">Elimina</button>
      </div>
    </td>
  `;

  tbody.appendChild(tr);
}

tbody.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const booking = lastBookings.find((b) => String(b.ID) === String(id));
  if (!booking) return;

  if (btn.dataset.action === 'edit') {
    closeAllModals();
    openBookingModal(booking);
  } else if (btn.dataset.action === 'delete') {
    deleteBooking(booking);
  }
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

// Zero-padding a 2 cifre: necessario perché Giorno/Mese arrivano dal foglio
// già paddati come stringa (es. "05", dal formato input date "YYYY-MM-DD"),
// mentre i metodi nativi di Date (getDate/getMonth) restituiscono numeri NON
// paddati (es. 5). Senza normalizzare entrambi allo stesso modo, il confronto
// stringa-con-stringa fallisce sempre per i giorni/mesi da 1 a 9.
function pad2Stat_(n) {
  return String(n).padStart(2, '0');
}

function updateStats(bookings) {
  const active = bookings.filter((b) => (b.Stato || 'Confermata') !== 'Annullata');

  const today = new Date();
  const todayStr = `${pad2Stat_(today.getDate())}-${pad2Stat_(today.getMonth() + 1)}-${today.getFullYear()}`;

  let todayCount = 0;
  let todayPeople = 0;
  let upcoming = 0;

  // "now" azzerato a mezzanotte: così una prenotazione di oggi (anche se
  // l'orario prenotato è già passato rispetto all'ora corrente) resta
  // conteggiata correttamente sia in "oggi" sia come "prossimi 7 giorni".
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const in7days = new Date(now);
  in7days.setDate(now.getDate() + 7);

  active.forEach((b) => {
    const giorno = pad2Stat_(b.Giorno);
    const mese = pad2Stat_(b.Mese);
    const bStr = `${giorno}-${mese}-${b.Anno}`;
    if (bStr === todayStr) {
      todayCount++;
      todayPeople += Number(b.NumeroPersone) || 0;
    }
    const bookingDate = new Date(`${b.Anno}-${mese}-${giorno}`);
    if (bookingDate >= now && bookingDate <= in7days) {
      upcoming++;
    }
  });

  document.getElementById('stat-total').textContent = active.length;
  document.getElementById('stat-today').textContent = todayCount;
  document.getElementById('stat-people').textContent = todayPeople;
  document.getElementById('stat-upcoming').textContent = upcoming;
}

// ============================================================================
// IMPOSTAZIONI: capienza posti e giorni di chiusura
// ============================================================================
let currentSettings = {
  capacityLunch: 0, capacityDinner: 0, shiftCutoff: '16:00', closingWeekday: -1, closingDates: [],
  whatsappEnabled: false, whatsappConfigured: false, whatsappPhoneNumberId: '', whatsappTemplateName: 'otp_verifica',
  whatsappTemplateLang: 'it', whatsappAccessTokenSet: false,
};

const settingsOverlay = document.getElementById('settings-modal-overlay');
const closingDatesList = document.getElementById('closing-dates-list');

async function loadSettings() {
  try {
    const data = await callApi('adminGetSettings', { token: getAdminToken() });
    if (data.error) throw new Error(data.error);
    currentSettings = data.settings;
    renderSettingsSummary();
  } catch (err) {
    console.error('Errore caricamento impostazioni:', err.message);
    handleAuthError(err);
  }
}

function renderSettingsSummary() {
  document.getElementById('summary-capacity-lunch').textContent =
    currentSettings.capacityLunch > 0 ? `${currentSettings.capacityLunch} posti` : 'Nessun limite';
  document.getElementById('summary-capacity-dinner').textContent =
    currentSettings.capacityDinner > 0 ? `${currentSettings.capacityDinner} posti` : 'Nessun limite';
  document.getElementById('summary-weekday').textContent =
    currentSettings.closingWeekday >= 0 ? WEEKDAY_NAMES[currentSettings.closingWeekday] : 'Nessuna';
  document.getElementById('summary-dates').textContent =
    currentSettings.closingDates.length > 0
      ? currentSettings.closingDates.map(formatDateIt).join(', ')
      : 'Nessuna';
}

function renderWhatsappHint() {
  const hint = document.getElementById('whatsapp-config-hint');
  if (currentSettings.whatsappEnabled && !currentSettings.whatsappConfigured) {
    hint.textContent = '⚠ Attenzione: mancano ancora Phone Number ID e/o Token di accesso qui sotto, altrimenti l\'invio dei codici fallirà.';
    hint.style.color = 'var(--error)';
  } else if (!currentSettings.whatsappConfigured) {
    hint.textContent = 'Compila i campi qui sotto con le credenziali Meta/WhatsApp (richiesto solo se attivi questa opzione). Guida: WHATSAPP-SETUP.md.';
    hint.style.color = '';
  } else {
    hint.textContent = '';
  }

  const tokenStatus = document.getElementById('whatsapp-token-status');
  tokenStatus.textContent = currentSettings.whatsappAccessTokenSet
    ? '🔒 Token già salvato — lascia il campo vuoto per non modificarlo, oppure incollane uno nuovo per sostituirlo.'
    : 'Nessun token salvato finora.';
}

function formatDateIt(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function renderClosingDatesChips() {
  closingDatesList.innerHTML = '';
  currentSettings.closingDates.forEach((d) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = `<span>${formatDateIt(d)}</span><button data-date="${d}" title="Rimuovi">✕</button>`;
    closingDatesList.appendChild(chip);
  });
}

closingDatesList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-date]');
  if (!btn) return;
  currentSettings.closingDates = currentSettings.closingDates.filter((d) => d !== btn.dataset.date);
  renderClosingDatesChips();
});

document.getElementById('btn-add-closing-date').addEventListener('click', () => {
  const input = document.getElementById('set-new-closing-date');
  const val = input.value;
  if (!val) return;
  if (!currentSettings.closingDates.includes(val)) {
    currentSettings.closingDates.push(val);
    currentSettings.closingDates.sort();
    renderClosingDatesChips();
  }
  input.value = '';
});

document.getElementById('btn-open-settings').addEventListener('click', () => {
  closeAllModals();
  document.getElementById('set-capacity-lunch').value = currentSettings.capacityLunch || 0;
  document.getElementById('set-capacity-dinner').value = currentSettings.capacityDinner || 0;
  document.getElementById('set-shift-cutoff').value = currentSettings.shiftCutoff || '16:00';
  document.getElementById('set-weekday').value = String(currentSettings.closingWeekday);
  document.getElementById('set-whatsapp-enabled').checked = !!currentSettings.whatsappEnabled;
  document.getElementById('set-whatsapp-phone-id').value = currentSettings.whatsappPhoneNumberId || '';
  document.getElementById('set-whatsapp-token').value = ''; // il token non viene mai rimandato dal server, per sicurezza
  document.getElementById('set-whatsapp-template-name').value = currentSettings.whatsappTemplateName || 'otp_verifica';
  document.getElementById('set-whatsapp-template-lang').value = currentSettings.whatsappTemplateLang || 'it';
  renderClosingDatesChips();
  renderWhatsappHint();
  clearMsg('settings-msg');
  settingsOverlay.classList.remove('hidden');
});
document.getElementById('set-whatsapp-enabled').addEventListener('change', (e) => {
  currentSettings.whatsappEnabled = e.target.checked;
  renderWhatsappHint();
});
document.getElementById('btn-close-settings').addEventListener('click', () => {
  settingsOverlay.classList.add('hidden');
});
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) settingsOverlay.classList.add('hidden');
});

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  const capacityLunch = Number(document.getElementById('set-capacity-lunch').value || 0);
  const capacityDinner = Number(document.getElementById('set-capacity-dinner').value || 0);
  const shiftCutoff = document.getElementById('set-shift-cutoff').value || '16:00';
  const closingWeekday = Number(document.getElementById('set-weekday').value);
  const btn = document.getElementById('btn-save-settings');

  const whatsappEnabled = document.getElementById('set-whatsapp-enabled').checked;
  const whatsappPhoneNumberId = document.getElementById('set-whatsapp-phone-id').value.trim();
  const whatsappAccessToken = document.getElementById('set-whatsapp-token').value.trim(); // vuoto = non toccare il token salvato
  const whatsappTemplateName = document.getElementById('set-whatsapp-template-name').value.trim();
  const whatsappTemplateLang = document.getElementById('set-whatsapp-template-lang').value.trim();

  btn.disabled = true;
  try {
    const data = await callApi('adminUpdateSettings', {
      token: getAdminToken(),
      capacityLunch,
      capacityDinner,
      shiftCutoff,
      closingWeekday,
      closingDates: currentSettings.closingDates,
      whatsappEnabled,
      whatsappPhoneNumberId,
      whatsappAccessToken,
      whatsappTemplateName,
      whatsappTemplateLang,
    });
    if (data.error) throw new Error(data.error);

    currentSettings = data.settings;
    document.getElementById('set-whatsapp-token').value = ''; // ripulisce il campo dopo il salvataggio
    renderSettingsSummary();
    renderWhatsappHint();
    showMsg('settings-msg', 'Impostazioni salvate ✅', 'success');
  } catch (err) {
    showMsg('settings-msg', err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ============================================================================
// NUOVA / MODIFICA PRENOTAZIONE
// ============================================================================
const bookingOverlay = document.getElementById('booking-modal-overlay');
let availabilityCheckToken = 0;

function openBookingModal(booking) {
  clearMsg('booking-modal-msg');
  const isEdit = !!booking;
  document.getElementById('booking-modal-title').textContent = isEdit ? 'Modifica prenotazione' : 'Nuova prenotazione';
  document.getElementById('bk-id').value = isEdit ? booking.ID : '';
  document.getElementById('bk-name').value = isEdit ? booking.Nome : '';
  document.getElementById('bk-email').value = isEdit ? booking.Email : '';
  document.getElementById('bk-people').value = isEdit ? booking.NumeroPersone : '';
  document.getElementById('bk-time').value = isEdit ? booking.Ora : '';
  document.getElementById('bk-status').value = isEdit ? (booking.Stato || 'Confermata') : 'Confermata';

  if (isEdit) {
    const y = booking.Anno, m = String(booking.Mese).padStart(2, '0'), d = String(booking.Giorno).padStart(2, '0');
    document.getElementById('bk-date').value = `${y}-${m}-${d}`;
  } else {
    document.getElementById('bk-date').value = '';
  }

  document.getElementById('bk-availability').className = 'availability-box';
  bookingOverlay.classList.remove('hidden');
  checkModalAvailability();
}

document.getElementById('btn-new-booking').addEventListener('click', () => {
  closeAllModals();
  openBookingModal(null);
});
document.getElementById('btn-close-booking-modal').addEventListener('click', () => bookingOverlay.classList.add('hidden'));
document.getElementById('btn-cancel-booking-modal').addEventListener('click', () => bookingOverlay.classList.add('hidden'));
bookingOverlay.addEventListener('click', (e) => {
  if (e.target === bookingOverlay) bookingOverlay.classList.add('hidden');
});

document.getElementById('bk-date').addEventListener('change', checkModalAvailability);
document.getElementById('bk-time').addEventListener('change', checkModalAvailability);

async function checkModalAvailability() {
  const dateVal = document.getElementById('bk-date').value;
  const timeVal = document.getElementById('bk-time').value;
  const box = document.getElementById('bk-availability');
  if (!dateVal || !timeVal) {
    box.className = 'availability-box';
    return;
  }

  const [year, month, day] = dateVal.split('-');
  const editingId = document.getElementById('bk-id').value || undefined; // esclude sé stessa se in modifica
  const myToken = ++availabilityCheckToken;

  box.className = 'availability-box show';
  box.textContent = 'Controllo disponibilità…';

  try {
    const data = await callApi('checkAvailability', { day, month, year, time: timeVal, excludeId: editingId });
    if (myToken !== availabilityCheckToken) return; // risposta obsoleta, ignora
    if (data.error) throw new Error(data.error);

    const a = data.availability;
    if (a.closed) {
      box.className = 'availability-box show blocked';
      box.textContent = `⛔ Chiuso in questa data${a.closedReason ? ' — ' + a.closedReason : ''}`;
    } else if (a.remaining === null) {
      box.className = 'availability-box show ok';
      box.textContent = `✅ Turno ${a.shift} — nessun limite di posti impostato (già prenotati: ${a.booked})`;
    } else if (a.remaining === 0) {
      box.className = 'availability-box show blocked';
      box.textContent = `⛔ Turno ${a.shift}: posti esauriti (${a.booked}/${a.capacity} occupati)`;
    } else {
      box.className = 'availability-box show ok';
      box.textContent = `✅ Turno ${a.shift} — posti residui: ${a.remaining} su ${a.capacity} (prenotati: ${a.booked})`;
    }
  } catch (err) {
    box.className = 'availability-box show warn';
    box.textContent = 'Impossibile verificare la disponibilità: ' + err.message;
  }
}

document.getElementById('btn-save-booking').addEventListener('click', async () => {
  const id = document.getElementById('bk-id').value;
  const name = document.getElementById('bk-name').value.trim();
  const email = document.getElementById('bk-email').value.trim();
  const people = document.getElementById('bk-people').value;
  const dateVal = document.getElementById('bk-date').value;
  const time = document.getElementById('bk-time').value;
  const status = document.getElementById('bk-status').value;
  const btn = document.getElementById('btn-save-booking');

  if (!name || !people || !dateVal || !time) {
    return showMsg('booking-modal-msg', 'Compila tutti i campi obbligatori', 'error');
  }

  const [year, month, day] = dateVal.split('-');
  const action = id ? 'adminUpdateBooking' : 'adminCreateBooking';
  const payload = { token: getAdminToken(), id, name, email, people, day, month, year, time, status };

  btn.disabled = true;
  try {
    const data = await callApi(action, payload);
    if (data.error) throw new Error(data.error);

    bookingOverlay.classList.add('hidden');
    loadBookings(false);
  } catch (err) {
    showMsg('booking-modal-msg', err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

async function deleteBooking(booking) {
  const label = `${booking.Nome} — ${booking.Giorno}/${booking.Mese}/${booking.Anno} alle ${booking.Ora}`;
  if (!confirm(`Eliminare definitivamente la prenotazione di ${label}?`)) return;

  try {
    const data = await callApi('adminDeleteBooking', { token: getAdminToken(), id: booking.ID });
    if (data.error) throw new Error(data.error);
    loadBookings(false);
  } catch (err) {
    alert('Errore durante l\'eliminazione: ' + err.message);
  }
}

// ============================================================================
// PERSONALIZZAZIONE HOME PAGE (logo, nome attività, tagline, benvenuto)
// ============================================================================
const homepageOverlay = document.getElementById('homepage-modal-overlay');
const MAX_LOGO_FILE_BYTES = 200 * 1024; // 200 KB grezzi, margine sotto il limite lato server

let currentHomepage = { businessName: '', tagline: '', welcomeMessage: '', logoDataUrl: '', theme: 'gold' };
let pendingLogoDataUrl = null; // nuovo logo selezionato ma non ancora salvato
let pendingLogoRemoved = false; // true se l'utente ha chiesto di rimuovere il logo
let pendingTheme = 'gold'; // tema colori selezionato nel modale (non ancora salvato)

const VALID_THEMES = ['gold', 'sage', 'navy'];

// Applica subito il tema scelto a tutta la pagina admin (anteprima live),
// aggiungendo/rimuovendo la classe "theme-XXX" sul <body>.
function applyTheme(theme) {
  VALID_THEMES.forEach((t) => document.body.classList.remove('theme-' + t));
  if (theme && theme !== 'gold') document.body.classList.add('theme-' + theme);
}

function setThemePicker(theme) {
  pendingTheme = VALID_THEMES.includes(theme) ? theme : 'gold';
  document.querySelectorAll('#theme-picker .theme-swatch').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === pendingTheme);
  });
}

document.getElementById('theme-picker').addEventListener('click', (e) => {
  const btn = e.target.closest('.theme-swatch');
  if (!btn) return;
  setThemePicker(btn.dataset.theme);
  applyTheme(pendingTheme); // anteprima immediata, prima ancora di salvare
});

async function loadHomepage() {
  try {
    const data = await callApi('adminGetHomepage', { token: getAdminToken() });
    if (data.error) throw new Error(data.error);
    currentHomepage = data.homepage;
    renderAdminLogo();
    applyTheme(currentHomepage.theme || 'gold');
  } catch (err) {
    console.error('Errore caricamento home page:', err.message);
    handleAuthError(err);
  }
}

function renderAdminLogo() {
  const logo = document.getElementById('admin-logo');
  if (currentHomepage.logoDataUrl) {
    logo.src = currentHomepage.logoDataUrl;
    logo.classList.remove('hidden');
  } else {
    logo.classList.add('hidden');
  }
}

function setLogoPreview(src) {
  const preview = document.getElementById('hp-logo-preview');
  if (src) {
    preview.src = src;
    preview.classList.remove('empty');
    preview.alt = 'Anteprima logo';
  } else {
    preview.removeAttribute('src');
    preview.classList.add('empty');
    preview.alt = 'Nessun logo';
  }
}

document.getElementById('btn-open-homepage').addEventListener('click', () => {
  closeAllModals();
  document.getElementById('hp-business-name').value = currentHomepage.businessName || '';
  document.getElementById('hp-tagline').value = currentHomepage.tagline || '';
  document.getElementById('hp-welcome').value = currentHomepage.welcomeMessage || '';
  document.getElementById('hp-logo-file').value = '';
  pendingLogoDataUrl = null;
  pendingLogoRemoved = false;
  setLogoPreview(currentHomepage.logoDataUrl || '');
  setThemePicker(currentHomepage.theme || 'gold');
  clearMsg('homepage-msg');
  homepageOverlay.classList.remove('hidden');
});
function closeHomepageModalWithoutSaving() {
  homepageOverlay.classList.add('hidden');
  applyTheme(currentHomepage.theme || 'gold'); // annulla l'anteprima non salvata
}
document.getElementById('btn-close-homepage').addEventListener('click', closeHomepageModalWithoutSaving);
homepageOverlay.addEventListener('click', (e) => {
  if (e.target === homepageOverlay) closeHomepageModalWithoutSaving();
});

document.getElementById('hp-logo-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (file.size > MAX_LOGO_FILE_BYTES) {
    showMsg('homepage-msg', `Immagine troppo pesante (${Math.round(file.size / 1024)} KB). Usa un file sotto ${Math.round(MAX_LOGO_FILE_BYTES / 1024)} KB.`, 'error');
    e.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    pendingLogoDataUrl = reader.result;
    pendingLogoRemoved = false;
    setLogoPreview(pendingLogoDataUrl);
    clearMsg('homepage-msg');
  };
  reader.onerror = () => showMsg('homepage-msg', 'Impossibile leggere il file selezionato', 'error');
  reader.readAsDataURL(file);
});

document.getElementById('btn-remove-logo').addEventListener('click', () => {
  if (!currentHomepage.logoDataUrl && !pendingLogoDataUrl) return;
  pendingLogoRemoved = true;
  pendingLogoDataUrl = null;
  document.getElementById('hp-logo-file').value = '';
  setLogoPreview('');
});

document.getElementById('btn-save-homepage').addEventListener('click', async () => {
  const businessName = document.getElementById('hp-business-name').value.trim();
  const tagline = document.getElementById('hp-tagline').value.trim();
  const welcomeMessage = document.getElementById('hp-welcome').value.trim();
  const btn = document.getElementById('btn-save-homepage');

  btn.disabled = true;
  try {
    if (pendingLogoRemoved) {
      const res = await callApi('adminRemoveLogo', { token: getAdminToken() });
      if (res.error) throw new Error(res.error);
    } else if (pendingLogoDataUrl) {
      const res = await callApi('adminUploadLogo', { token: getAdminToken(), dataUrl: pendingLogoDataUrl });
      if (res.error) throw new Error(res.error);
    }

    const res2 = await callApi('adminUpdateHomepage', { token: getAdminToken(), businessName, tagline, welcomeMessage, theme: pendingTheme });
    if (res2.error) throw new Error(res2.error);

    pendingLogoDataUrl = null;
    pendingLogoRemoved = false;
    await loadHomepage();
    showMsg('homepage-msg', 'Home page aggiornata ✅', 'success');
  } catch (err) {
    showMsg('homepage-msg', err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// Se il token admin è già presente, entra direttamente
(function initAdmin() {
  if (getAdminToken()) {
    enterDashboard();
  }
})();
