// ==== CONFIGURAZIONE ====
// Stesso URL Apps Script usato in js/main.js (termina con /exec).
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwds58S_ptrk9V6RxY_isb1j29qQZHKvt9H9S-tOctgNe5FgOhPpbbV31MH9FlCb7Xw/exec';

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
let tableSearchTerm = ''; // filtro live sulla tabella, applicato lato client senza richieste aggiuntive

// ==== INDICATORE CONNESSIONE INSTABILE ====
// Se il polling automatico fallisce per un errore transitorio di rete (NON di
// autenticazione, già gestito a parte da handleAuthError), lo segnaliamo solo
// dopo un paio di tentativi falliti consecutivi (per non far lampeggiare
// l'avviso per un singolo intoppo isolato), e lo nascondiamo di nuovo al
// primo caricamento andato a buon fine.
const POLL_FAILURE_THRESHOLD = 2;
let pollFailureCount = 0;

function setPollStatus_(show, text) {
  const el = document.getElementById('poll-status');
  if (!el) return;
  el.style.display = show ? '' : 'none';
  if (text) el.textContent = text;
}

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
    pollFailureCount = 0;
    setPollStatus_(false);
  } catch (err) {
    console.error('Errore caricamento prenotazioni:', err.message);
    if (handleAuthError(err)) return; // token scaduto: già gestito con reload, nessun avviso da mostrare

    pollFailureCount++;
    if (pollFailureCount >= POLL_FAILURE_THRESHOLD) {
      setPollStatus_(true, '⚠ Connessione instabile: impossibile aggiornare le prenotazioni. Ritento automaticamente…');
    }
  }
}

function renderTable(bookings, newIds) {
  const visible = bookings.filter((b) => matchesTableSearch_(b, tableSearchTerm));
  tbody.innerHTML = '';
  visible.forEach((b) => appendRow(b, newIds && newIds.includes(b.ID)));
}

// Confronta nome, email e data (formato gg/mm/aaaa o parti di essa) col
// termine cercato: tutto lato client, sui dati già in memoria, senza nessuna
// chiamata aggiuntiva al backend.
function matchesTableSearch_(b, term) {
  if (!term) return true;
  const needle = term.toLowerCase();
  const dataStr = `${b.Giorno}/${b.Mese}/${b.Anno}`;
  return (
    String(b.Nome || '').toLowerCase().includes(needle) ||
    String(b.Email || '').toLowerCase().includes(needle) ||
    dataStr.includes(needle)
  );
}

document.getElementById('table-search').addEventListener('input', (e) => {
  tableSearchTerm = e.target.value.trim();
  renderTable(lastBookings); // riusa gli ultimi dati già caricati, filtro istantaneo
});

function appendRow(b, isNew) {
  const tr = document.createElement('tr');
  if (isNew) tr.classList.add('new-row');

  const dataStr = `${b.Giorno}/${b.Mese}/${b.Anno}`;
  const createdStr = b.DataCreazione ? new Date(b.DataCreazione).toLocaleString('it-IT') : '';
  const stato = b.Stato || 'Confermata';
  const badgeClass = stato === 'Annullata' ? 'badge cancelled' : 'badge';
  const depositStr = formatDepositCell_(b);

  tr.innerHTML = `
    <td data-label="Cliente">${escapeHtml(b.Nome)}</td>
    <td data-label="Email">${escapeHtml(b.Email)}</td>
    <td data-label="Persone">${escapeHtml(String(b.NumeroPersone))}</td>
    <td data-label="Data">${dataStr}</td>
    <td data-label="Ora">${escapeHtml(b.Ora)}</td>
    <td data-label="Stato"><span class="${badgeClass}">${escapeHtml(stato)}</span></td>
    <td data-label="Acconto">${depositStr}</td>
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

// Mostra in tabella il metodo di pagamento dell'acconto (se presente) con
// il relativo importo, oppure un trattino se la prenotazione non ne prevede.
function formatDepositCell_(b) {
  const method = b.MetodoPagamento;
  const amount = Number(b.ImportoAcconto) || 0;
  if (!method || amount <= 0) return '—';
  const label = method === 'bonifico' ? 'Bonifico' : method === 'contanti' ? 'Contanti' : escapeHtml(method);
  return `${label} · €${amount.toFixed(2)}`;
}

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
    // Costruita con il costruttore numerico (anno, mese-1, giorno): sempre
    // in orario LOCALE, coerente con "now"/"in7days" (anch'essi locali). In
    // precedenza si usava new Date(`${anno}-${mese}-${giorno}`): questo
    // formato stringa "YYYY-MM-DD" viene interpretato da JavaScript come
    // mezzanotte UTC, non locale — con il fuso orario italiano (UTC+1/+2)
    // questo introduceva uno sfasamento di 1-2 ore che poteva far
    // conteggiare in modo impreciso proprio le prenotazioni sul giorno di
    // confine (il 7°) del contatore "Prossime 7 giorni".
    const bookingDate = new Date(Number(b.Anno), Number(mese) - 1, Number(giorno));
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
  maxPeoplePerBooking: 30,
  whatsappEnabled: false, whatsappConfigured: false, whatsappPhoneNumberId: '', whatsappTemplateName: 'otp_verifica',
  whatsappTemplateLang: 'it', whatsappAccessTokenSet: false,
  depositEnabled: false, depositAmountPerPerson: 0, depositMethods: ['contanti', 'bonifico'],
  iban: '', bankHolder: '', bankName: '', depositInstructions: '',
  emailSenderName: '', emailReplyTo: '', emailIncludeDepositInfo: true,
  emailTemplate: '', emailTemplateDefault: '', reminderEnabled: false,
};

const settingsOverlay = document.getElementById('settings-modal-overlay');
const closingDatesList = document.getElementById('closing-dates-list');

async function loadSettings() {
  try {
    const data = await callApi('adminGetSettings', { token: getAdminToken() });
    if (data.error) throw new Error(data.error);
    currentSettings = data.settings;
    renderSettingsSummary();
    // Solo ORA i valori sono davvero arrivati dal server: prima di questo
    // punto, aprire la modale "Impostazioni" avrebbe mostrato i valori di
    // default locali (capienza 0, acconto disattivo, ecc.) invece di quelli
    // reali, per la breve finestra tra l'ingresso in dashboard e la fine di
    // questa chiamata.
    document.getElementById('btn-open-settings').disabled = false;
  } catch (err) {
    console.error('Errore caricamento impostazioni:', err.message);
    if (!handleAuthError(err)) {
      // Errore non di autenticazione (es. rete instabile): meglio comunque
      // sbloccare il pulsante piuttosto che lasciare l'admin bloccato senza
      // alcun modo di aprire le impostazioni fino al prossimo refresh.
      document.getElementById('btn-open-settings').disabled = false;
    }
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
  document.getElementById('summary-deposit').textContent = currentSettings.depositEnabled
    ? `€${Number(currentSettings.depositAmountPerPerson || 0).toFixed(2)}/persona (${(currentSettings.depositMethods || []).join(' + ') || 'nessun metodo'})`
    : 'Non richiesto';
  // A colpo d'occhio, senza dover aprire le impostazioni: dice se l'email di
  // conferma include davvero i dettagli acconto/IBAN o è una semplice
  // conferma (utile perché questo flag non è ovvio dal solo importo/metodo).
  document.getElementById('summary-email-deposit-info').textContent =
    currentSettings.emailIncludeDepositInfo !== false ? 'Inclusi' : 'Esclusi (email semplice)';
}

function renderDepositHint() {
  const enabled = document.getElementById('set-deposit-enabled').checked;
  const fields = document.getElementById('deposit-fields');
  fields.style.opacity = enabled ? '1' : '0.55';
  // Oltre a sfumarli visivamente, disabilita davvero i controlli quando
  // l'acconto è spento: prima restavano cliccabili (solo sfumati), quindi
  // l'admin poteva deselezionare per sbaglio i metodi di pagamento salvati
  // in precedenza e, salvando, sovrascriverli inavvertitamente.
  fields.querySelectorAll('input, textarea').forEach((el) => { el.disabled = !enabled; });
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
  document.getElementById('set-max-people').value = currentSettings.maxPeoplePerBooking || 30;
  document.getElementById('set-weekday').value = String(currentSettings.closingWeekday);
  document.getElementById('set-whatsapp-enabled').checked = !!currentSettings.whatsappEnabled;
  document.getElementById('set-whatsapp-phone-id').value = currentSettings.whatsappPhoneNumberId || '';
  document.getElementById('set-whatsapp-token').value = ''; // il token non viene mai rimandato dal server, per sicurezza
  document.getElementById('set-whatsapp-template-name').value = currentSettings.whatsappTemplateName || 'otp_verifica';
  document.getElementById('set-whatsapp-template-lang').value = currentSettings.whatsappTemplateLang || 'it';

  const depositMethods = currentSettings.depositMethods || ['contanti', 'bonifico'];
  document.getElementById('set-deposit-enabled').checked = !!currentSettings.depositEnabled;
  document.getElementById('set-deposit-amount').value = currentSettings.depositAmountPerPerson || 0;
  document.getElementById('set-deposit-method-contanti').checked = depositMethods.includes('contanti');
  document.getElementById('set-deposit-method-bonifico').checked = depositMethods.includes('bonifico');
  document.getElementById('set-deposit-iban').value = currentSettings.iban || '';
  document.getElementById('set-deposit-holder').value = currentSettings.bankHolder || '';
  document.getElementById('set-deposit-bank-name').value = currentSettings.bankName || '';
  document.getElementById('set-deposit-instructions').value = currentSettings.depositInstructions || '';
  renderDepositHint();

  // Se l'admin non ha mai salvato questa impostazione, il backend restituisce
  // "true" di default (comportamento storico: acconto/IBAN sempre inclusi).
  document.getElementById('set-email-sender-name').value = currentSettings.emailSenderName || '';
  document.getElementById('set-email-reply-to').value = currentSettings.emailReplyTo || '';
  document.getElementById('set-email-include-deposit-info').checked = currentSettings.emailIncludeDepositInfo !== false;
  document.getElementById('set-email-template').value = currentSettings.emailTemplate || '';
  document.getElementById('set-email-test-address').value = '';
  clearMsg('test-email-msg');
  document.getElementById('set-reminder-enabled').checked = !!currentSettings.reminderEnabled;

  renderClosingDatesChips();
  renderWhatsappHint();
  clearMsg('settings-msg');
  settingsOverlay.classList.remove('hidden');
});
document.getElementById('set-whatsapp-enabled').addEventListener('change', (e) => {
  currentSettings.whatsappEnabled = e.target.checked;
  renderWhatsappHint();
});
document.getElementById('set-deposit-enabled').addEventListener('change', renderDepositHint);
document.getElementById('btn-reset-email-template').addEventListener('click', () => {
  document.getElementById('set-email-template').value = currentSettings.emailTemplateDefault || '';
});
document.getElementById('btn-send-test-email').addEventListener('click', async () => {
  const btn = document.getElementById('btn-send-test-email');
  const testEmail = document.getElementById('set-email-test-address').value.trim();
  clearMsg('test-email-msg');
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Invio…';
  try {
    // Manda i valori ATTUALMENTE nel form (anche se non ancora salvati), così
    // l'admin può provare testo/mittente/flag acconto prima di salvarli.
    const data = await callApi('adminSendTestEmail', {
      token: getAdminToken(),
      testEmail,
      emailSenderName: document.getElementById('set-email-sender-name').value.trim(),
      emailReplyTo: document.getElementById('set-email-reply-to').value.trim(),
      emailIncludeDepositInfo: document.getElementById('set-email-include-deposit-info').checked,
      emailTemplate: document.getElementById('set-email-template').value.trim(),
    });
    if (data.error) throw new Error(data.error);
    showMsg('test-email-msg', `Email di prova inviata a ${data.sentTo} ✅`, 'success');
  } catch (err) {
    showMsg('test-email-msg', err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
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
  const maxPeoplePerBooking = Number(document.getElementById('set-max-people').value || 30);
  const closingWeekday = Number(document.getElementById('set-weekday').value);
  const btn = document.getElementById('btn-save-settings');

  if (isNaN(maxPeoplePerBooking) || maxPeoplePerBooking < 1) {
    return showMsg('settings-msg', 'Il numero massimo di persone per prenotazione deve essere almeno 1', 'error');
  }

  const whatsappEnabled = document.getElementById('set-whatsapp-enabled').checked;
  const whatsappPhoneNumberId = document.getElementById('set-whatsapp-phone-id').value.trim();
  const whatsappAccessToken = document.getElementById('set-whatsapp-token').value.trim(); // vuoto = non toccare il token salvato
  const whatsappTemplateName = document.getElementById('set-whatsapp-template-name').value.trim();
  const whatsappTemplateLang = document.getElementById('set-whatsapp-template-lang').value.trim();

  const depositEnabled = document.getElementById('set-deposit-enabled').checked;
  const depositAmountPerPerson = Number(document.getElementById('set-deposit-amount').value || 0);
  const depositMethods = [];
  if (document.getElementById('set-deposit-method-contanti').checked) depositMethods.push('contanti');
  if (document.getElementById('set-deposit-method-bonifico').checked) depositMethods.push('bonifico');
  const iban = document.getElementById('set-deposit-iban').value.trim();
  const bankHolder = document.getElementById('set-deposit-holder').value.trim();
  const bankName = document.getElementById('set-deposit-bank-name').value.trim();
  const depositInstructions = document.getElementById('set-deposit-instructions').value.trim();

  // Un acconto "attivo" con importo 0 (o non numerico) sarebbe fuorviante:
  // il box acconto non comparirebbe comunque mai al cliente (vedi
  // isDepositActive_ lato server), pur risultando "attivo" qui in
  // impostazioni. Stesso controllo replicato lato server in
  // validateDepositSettings_, questo è solo un feedback immediato.
  if (depositEnabled && (isNaN(depositAmountPerPerson) || depositAmountPerPerson <= 0)) {
    return showMsg('settings-msg', 'Inserisci un importo acconto per persona maggiore di zero', 'error');
  }
  if (depositEnabled && depositMethods.length === 0) {
    return showMsg('settings-msg', 'Seleziona almeno un metodo di pagamento per l\'acconto (contanti e/o bonifico)', 'error');
  }
  if (depositEnabled && depositMethods.includes('bonifico') && !iban) {
    return showMsg('settings-msg', 'Inserisci l\'IBAN per accettare l\'acconto tramite bonifico', 'error');
  }

  const emailSenderName = document.getElementById('set-email-sender-name').value.trim();
  const emailReplyTo = document.getElementById('set-email-reply-to').value.trim();
  const emailIncludeDepositInfo = document.getElementById('set-email-include-deposit-info').checked;
  const emailTemplate = document.getElementById('set-email-template').value.trim();
  const reminderEnabled = document.getElementById('set-reminder-enabled').checked;

  btn.disabled = true;
  try {
    const data = await callApi('adminUpdateSettings', {
      token: getAdminToken(),
      capacityLunch,
      capacityDinner,
      shiftCutoff,
      maxPeoplePerBooking,
      closingWeekday,
      closingDates: currentSettings.closingDates,
      whatsappEnabled,
      whatsappPhoneNumberId,
      whatsappAccessToken,
      whatsappTemplateName,
      whatsappTemplateLang,
      depositEnabled,
      depositAmountPerPerson,
      depositMethods,
      iban,
      bankHolder,
      bankName,
      depositInstructions,
      emailSenderName,
      emailReplyTo,
      emailIncludeDepositInfo,
      emailTemplate,
      reminderEnabled,
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
  document.getElementById('bk-payment-method').value = isEdit ? (booking.MetodoPagamento || '') : '';
  document.getElementById('bk-deposit-amount').value = isEdit && booking.ImportoAcconto ? booking.ImportoAcconto : '';

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
    // Il token admin è ora necessario: il backend onora "excludeId" solo se
    // accompagnato da un token admin valido (protezione contro l'uso di
    // questo parametro da chiamate pubbliche non autenticate).
    const data = await callApi('checkAvailability', { token: getAdminToken(), day, month, year, time: timeVal, excludeId: editingId });
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
  const paymentMethod = document.getElementById('bk-payment-method').value;
  const depositAmount = document.getElementById('bk-deposit-amount').value;
  const btn = document.getElementById('btn-save-booking');

  if (!name || !people || !dateVal || !time) {
    return showMsg('booking-modal-msg', 'Compila tutti i campi obbligatori', 'error');
  }

  const [year, month, day] = dateVal.split('-');
  const action = id ? 'adminUpdateBooking' : 'adminCreateBooking';
  const payload = { token: getAdminToken(), id, name, email, people, day, month, year, time, status, paymentMethod, depositAmount };

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
// 200 KB è la dimensione del file ORIGINALE scelto dall'admin. Una volta
// convertito in stringa base64 (vedi FileReader più sotto) diventa circa il
// 33% più pesante (~266 KB), ben sotto il limite di 450000 caratteri
// controllato lato server in actionAdminUploadLogo_: il margine è voluto.
const MAX_LOGO_FILE_BYTES = 200 * 1024;

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

// ============================================================================
// REPORT PER PERIODO: stampa (PDF via finestra di stampa del browser) ed
// esportazione CSV delle prenotazioni comprese tra due date "dal"/"al".
// Lavora sui dati già caricati in "lastBookings" (aggiornati dal polling),
// senza bisogno di nessuna chiamata aggiuntiva al backend.
// ============================================================================
const reportOverlay = document.getElementById('report-modal-overlay');

// Chiave "YYYY-MM-DD" a partire dai campi Giorno/Mese/Anno del foglio (che
// possono arrivare come numeri non paddati, es. "5" invece di "05"): stesso
// approccio già usato in updateStats/pad2Stat_, per poter confrontare le
// date con un semplice confronto tra stringhe (funziona perché il formato è
// sempre a lunghezza fissa, zero-paddato).
function bookingDateKey_(b) {
  return `${b.Anno}-${pad2Stat_(b.Mese)}-${pad2Stat_(b.Giorno)}`;
}

function filteredReportBookings_() {
  const from = document.getElementById('report-date-from').value; // "" = nessun limite inferiore
  const to = document.getElementById('report-date-to').value;     // "" = nessun limite superiore
  const includeCancelled = document.getElementById('report-include-cancelled').checked;

  return lastBookings
    .filter((b) => includeCancelled || (b.Stato || 'Confermata') !== 'Annullata')
    .filter((b) => {
      const key = bookingDateKey_(b);
      if (from && key < from) return false;
      if (to && key > to) return false;
      return true;
    })
    .sort((a, b) => {
      const ka = bookingDateKey_(a) + ' ' + a.Ora;
      const kb = bookingDateKey_(b) + ' ' + b.Ora;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
}

function updateReportCountHint_() {
  const hint = document.getElementById('report-count-hint');
  const from = document.getElementById('report-date-from').value;
  const to = document.getElementById('report-date-to').value;
  if (!from && !to) {
    hint.textContent = 'Nessun intervallo scelto: verranno incluse TUTTE le prenotazioni.';
    hint.style.color = '';
    return;
  }
  const n = filteredReportBookings_().length;
  hint.textContent = n === 0
    ? 'Nessuna prenotazione trovata in questo intervallo.'
    : `${n} prenotazion${n === 1 ? 'e trovata' : 'i trovate'} nel periodo selezionato.`;
  hint.style.color = n === 0 ? 'var(--error)' : '';
}

document.getElementById('btn-open-report').addEventListener('click', () => {
  closeAllModals();
  document.getElementById('report-date-from').value = '';
  document.getElementById('report-date-to').value = '';
  document.getElementById('report-include-cancelled').checked = false;
  clearMsg('report-msg');
  updateReportCountHint_();
  reportOverlay.classList.remove('hidden');
});
document.getElementById('btn-close-report').addEventListener('click', () => reportOverlay.classList.add('hidden'));
reportOverlay.addEventListener('click', (e) => {
  if (e.target === reportOverlay) reportOverlay.classList.add('hidden');
});
['report-date-from', 'report-date-to', 'report-include-cancelled'].forEach((id) => {
  document.getElementById(id).addEventListener('change', updateReportCountHint_);
});

function reportPeriodLabel_() {
  const from = document.getElementById('report-date-from').value;
  const to = document.getElementById('report-date-to').value;
  if (!from && !to) return 'Tutte le prenotazioni';
  if (from && to) return `Dal ${formatDateIt(from)} al ${formatDateIt(to)}`;
  if (from) return `Dal ${formatDateIt(from)}`;
  return `Fino al ${formatDateIt(to)}`;
}

// ---- STAMPA / PDF ----
// Apre subito (in modo SINCRONO, dentro il gestore del click) una finestra
// con una tabella formattata per la stampa, poi richiama window.print(): è
// lo stesso meccanismo con cui QUALSIASI browser genera un PDF ("Salva come
// PDF" tra le stampanti disponibili nella finestra di stampa), senza bisogno
// di generare il PDF lato server (Apps Script non offre un vero motore PDF
// gratuito per layout tabellari come questo). La finestra va aperta PRIMA di
// qualunque await, altrimenti i blocca-popup del browser la bloccherebbero.
document.getElementById('btn-report-print').addEventListener('click', () => {
  const rows = filteredReportBookings_();
  if (!rows.length) {
    return showMsg('report-msg', 'Nessuna prenotazione da stampare in questo intervallo', 'error');
  }

  const win = window.open('', '_blank');
  if (!win) {
    return showMsg('report-msg', 'Il browser ha bloccato la finestra di stampa: consenti i popup per questo sito e riprova', 'error');
  }

  const businessName = (currentHomepage && currentHomepage.businessName) || 'Prenotazioni';
  const generatedAt = new Date().toLocaleString('it-IT');
  const totalPeople = rows.reduce((sum, b) => sum + (Number(b.NumeroPersone) || 0), 0);

  const tableRows = rows.map((b) => {
    const stato = b.Stato || 'Confermata';
    return `
      <tr>
        <td>${escapeHtml(b.Nome)}</td>
        <td>${escapeHtml(b.Email)}</td>
        <td>${escapeHtml(String(b.NumeroPersone))}</td>
        <td>${pad2Stat_(b.Giorno)}/${pad2Stat_(b.Mese)}/${b.Anno}</td>
        <td>${escapeHtml(b.Ora)}</td>
        <td>${escapeHtml(stato)}</td>
        <td>${formatDepositCell_(b)}</td>
      </tr>`;
  }).join('');

  win.document.write(`<!DOCTYPE html>
<html lang="it"><head><meta charset="UTF-8">
<title>Prenotazioni — ${escapeHtml(businessName)}</title>
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .period { font-size: 13px; color: #555; margin-bottom: 2px; }
  .meta { font-size: 11px; color: #888; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
  th { background: #f0f0f0; }
  tfoot td { font-weight: 700; border-top: 2px solid #333; }
  @media print { body { margin: 8mm; } }
</style>
</head><body>
  <h1>${escapeHtml(businessName)} — Elenco prenotazioni</h1>
  <div class="period">${escapeHtml(reportPeriodLabel_())}</div>
  <div class="meta">Generato il ${escapeHtml(generatedAt)} — ${rows.length} prenotazioni, ${totalPeople} persone totali</div>
  <table>
    <thead><tr><th>Cliente</th><th>Email</th><th>Persone</th><th>Data</th><th>Ora</th><th>Stato</th><th>Acconto</th></tr></thead>
    <tbody>${tableRows}</tbody>
    <tfoot><tr><td colspan="2">Totale</td><td>${totalPeople}</td><td colspan="4"></td></tr></tfoot>
  </table>
</body></html>`);
  win.document.close();
  win.focus();
  // Piccolo ritardo per dare al browser il tempo di finire il rendering
  // prima di aprire la finestra di stampa.
  setTimeout(() => win.print(), 250);
});

// ---- ESPORTAZIONE CSV ----
function csvEscape_(value) {
  const str = value === null || value === undefined ? '' : String(value);
  // Se contiene virgola, virgolette o ritorno a capo va racchiuso tra
  // virgolette, raddoppiando eventuali virgolette interne (regola standard CSV).
  if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

document.getElementById('btn-report-csv').addEventListener('click', () => {
  const rows = filteredReportBookings_();
  if (!rows.length) {
    return showMsg('report-msg', 'Nessuna prenotazione da esportare in questo intervallo', 'error');
  }

  const header = ['Cliente', 'Email', 'Persone', 'Data', 'Ora', 'Stato', 'Metodo pagamento', 'Importo acconto', 'Creata il'];
  const lines = [header.map(csvEscape_).join(',')];
  rows.forEach((b) => {
    const dataStr = `${pad2Stat_(b.Giorno)}/${pad2Stat_(b.Mese)}/${b.Anno}`;
    const createdStr = b.DataCreazione ? new Date(b.DataCreazione).toLocaleString('it-IT') : '';
    lines.push([
      b.Nome, b.Email, b.NumeroPersone, dataStr, b.Ora, b.Stato || 'Confermata',
      b.MetodoPagamento || '', Number(b.ImportoAcconto) || 0, createdStr,
    ].map(csvEscape_).join(','));
  });

  // BOM UTF-8 in testa: senza, Excel su Windows interpreta male gli accenti
  // (è la causa più comune di "caratteri strani" nei CSV aperti in Excel).
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const from = document.getElementById('report-date-from').value || 'inizio';
  const to = document.getElementById('report-date-to').value || 'oggi';
  const a = document.createElement('a');
  a.href = url;
  a.download = `prenotazioni_${from}_${to}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showMsg('report-msg', `CSV esportato: ${rows.length} prenotazioni ✅`, 'success');
});
