// ==== CONFIGURAZIONE ====
// Incolla qui l'URL del tuo Web App di Google Apps Script (termina con /exec).
// Lo ottieni da: Apps Script → Distribuisci → Nuova implementazione → Applicazione web.
const APPS_SCRIPT_URL = 'INCOLLA_QUI_URL_APPS_SCRIPT/exec';

// Helper: chiama sempre la stessa Web App passando un'azione + dati nel corpo.
// NOTA: usiamo 'text/plain' come Content-Type (non 'application/json') perché
// Google Apps Script non gestisce le richieste OPTIONS di preflight CORS: con
// 'text/plain' il browser tratta la richiesta come "semplice" e non fa preflight.
async function callApi(action, data) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action }, data)),
  });
  return res.json();
}

// ==== PWA: registrazione service worker (necessaria per l'installazione come app / PWABuilder) ====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.warn('Registrazione service worker fallita:', err);
    });
  });
}

// ==== ELEMENTI ====
const stepRegister = document.getElementById('step-register');
const stepVerify = document.getElementById('step-verify');
const stepPhone = document.getElementById('step-phone');
const stepPhoneVerify = document.getElementById('step-phone-verify');
const stepBooking = document.getElementById('step-booking');
const allSteps = [stepRegister, stepVerify, stepPhone, stepPhoneVerify, stepBooking];
const dots = [document.getElementById('dot-1'), document.getElementById('dot-2'), document.getElementById('dot-3')];

let pendingName = '';
let pendingEmail = '';
let pendingPhone = '';
let phoneVerificationEnabled = false; // aggiornato da checkConfig() all'avvio
let bookingBlocked = false; // true se la data scelta è chiusa o senza posti disponibili
let availabilityCheckToken = 0;

// Chiede al backend se la verifica telefono via WhatsApp è attiva in questo momento.
// Spenta di default: se il gestore non l'ha ancora configurata, questo step
// viene semplicemente saltato, senza alcun impatto sull'esperienza cliente.
async function checkConfig() {
  try {
    const data = await callApi('getConfig', {});
    phoneVerificationEnabled = !!data.phoneVerificationEnabled;
    applyHomepageCustomization(data);
  } catch (err) {
    phoneVerificationEnabled = false;
  }
}

// Applica logo, nome attività, sottotitolo e messaggio di benvenuto impostati
// dall'admin. Se un campo non è stato personalizzato, resta il testo di
// default già presente nell'HTML.
const VALID_THEMES = ['gold', 'sage', 'navy'];

function applyHomepageCustomization(data) {
  VALID_THEMES.forEach((t) => document.body.classList.remove('theme-' + t));
  if (data.theme && data.theme !== 'gold' && VALID_THEMES.includes(data.theme)) {
    document.body.classList.add('theme-' + data.theme);
  }
  if (data.logoDataUrl) {
    const logo = document.getElementById('site-logo');
    logo.src = data.logoDataUrl;
    logo.classList.remove('hidden');
  }
  if (data.businessName) {
    document.getElementById('site-title').textContent = `★ ${data.businessName} ★`;
    document.title = data.businessName;
  }
  if (data.tagline) {
    document.getElementById('site-tagline').textContent = data.tagline;
  }
  if (data.welcomeMessage) {
    const banner = document.getElementById('welcome-banner');
    banner.textContent = data.welcomeMessage;
    banner.classList.remove('hidden');
  }
}

// ==== UTILITY ====
function showStep(step) {
  allSteps.forEach((el) => el.classList.add('hidden'));
  step.classList.remove('hidden');
}

function setActiveDot(index) {
  dots.forEach((d, i) => d.classList.toggle('active', i <= index));
}

function showMsg(elId, text, type) {
  const el = document.getElementById(elId);
  el.textContent = text;
  el.className = `msg show ${type}`;
}

function setLoading(button, loading, originalText) {
  button.disabled = loading;
  button.textContent = loading ? 'Attendere...' : originalText;
}

// ==== SESSIONE (token salvato dopo verifica) ====
function saveSession(token, name, email) {
  localStorage.setItem('userToken', token);
  localStorage.setItem('userName', name);
  localStorage.setItem('userEmail', email);
}
function getSession() {
  return {
    token: localStorage.getItem('userToken'),
    name: localStorage.getItem('userName'),
    email: localStorage.getItem('userEmail'),
  };
}
function clearSession() {
  localStorage.removeItem('userToken');
  localStorage.removeItem('userName');
  localStorage.removeItem('userEmail');
}

// Se l'utente ha già un token valido, salta direttamente allo step prenotazione
(async function init() {
  await checkConfig();
  const session = getSession();
  if (session.token) {
    document.getElementById('badge-name').textContent = session.name;
    setActiveDot(2);
    showStep(stepBooking);
  }
})();

// ==== STEP 1: invia codice ====
document.getElementById('btn-send-code').addEventListener('click', async () => {
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const btn = document.getElementById('btn-send-code');

  if (!name || !email) {
    return showMsg('register-msg', 'Compila tutti i campi', 'error');
  }

  setLoading(btn, true, 'Invia codice via Email');
  try {
    const data = await callApi('sendCode', { name, email });
    if (data.error) throw new Error(data.error);

    pendingName = name;
    pendingEmail = email;
    setActiveDot(1);
    showStep(stepVerify);
  } catch (err) {
    showMsg('register-msg', err.message, 'error');
  } finally {
    setLoading(btn, false, 'Invia codice via Email');
  }
});

// ==== STEP 2: verifica codice ====
document.getElementById('btn-verify-code').addEventListener('click', async () => {
  const code = document.getElementById('verify-code').value.trim();
  const btn = document.getElementById('btn-verify-code');

  if (!code) return showMsg('verify-msg', 'Inserisci il codice ricevuto', 'error');

  setLoading(btn, true, 'Verifica codice');
  try {
    const data = await callApi('verifyCode', { name: pendingName, email: pendingEmail, code });
    if (data.error) throw new Error(data.error);

    saveSession(data.token, data.name, data.email);
    document.getElementById('badge-name').textContent = data.name;

    if (phoneVerificationEnabled) {
      setActiveDot(2);
      showStep(stepPhone);
    } else {
      setActiveDot(2);
      showStep(stepBooking);
    }
  } catch (err) {
    showMsg('verify-msg', err.message, 'error');
  } finally {
    setLoading(btn, false, 'Verifica codice');
  }
});

document.getElementById('btn-back-register').addEventListener('click', () => {
  setActiveDot(0);
  showStep(stepRegister);
});

// ==== STEP FACOLTATIVO: invia codice WhatsApp (solo se attivato dal gestore) ====
document.getElementById('btn-send-phone-code').addEventListener('click', async () => {
  const phone = document.getElementById('reg-phone').value.trim();
  const btn = document.getElementById('btn-send-phone-code');
  const session = getSession();

  if (!phone) return showMsg('phone-msg', 'Inserisci un numero di telefono', 'error');

  setLoading(btn, true, 'Invia codice via WhatsApp');
  try {
    const data = await callApi('sendPhoneCode', { token: session.token, phone });
    if (data.error) throw new Error(data.error);

    pendingPhone = phone;
    showStep(stepPhoneVerify);
  } catch (err) {
    showMsg('phone-msg', err.message, 'error');
  } finally {
    setLoading(btn, false, 'Invia codice via WhatsApp');
  }
});

document.getElementById('btn-skip-phone').addEventListener('click', () => {
  showStep(stepBooking);
});

// ==== STEP FACOLTATIVO: verifica codice WhatsApp ====
document.getElementById('btn-verify-phone-code').addEventListener('click', async () => {
  const code = document.getElementById('phone-verify-code').value.trim();
  const btn = document.getElementById('btn-verify-phone-code');
  const session = getSession();

  if (!code) return showMsg('phone-verify-msg', 'Inserisci il codice ricevuto', 'error');

  setLoading(btn, true, 'Verifica codice');
  try {
    const data = await callApi('verifyPhoneCode', { token: session.token, phone: pendingPhone, code });
    if (data.error) throw new Error(data.error);

    showStep(stepBooking);
  } catch (err) {
    showMsg('phone-verify-msg', err.message, 'error');
  } finally {
    setLoading(btn, false, 'Verifica codice');
  }
});

document.getElementById('btn-skip-phone-verify').addEventListener('click', () => {
  showStep(stepBooking);
});

// ==== STEP 3: prenotazione ====

// Ad ogni cambio data, controlliamo subito col backend se il locale è chiuso
// quel giorno o se i posti sono esauriti, per non far scoprire il problema
// al cliente solo dopo aver compilato tutto il resto del modulo.
document.getElementById('book-date').addEventListener('change', checkBookingAvailability);

async function checkBookingAvailability() {
  const dateVal = document.getElementById('book-date').value;
  const box = document.getElementById('book-availability');
  bookingBlocked = false;

  if (!dateVal) {
    box.className = 'availability-box';
    return;
  }

  const [year, month, day] = dateVal.split('-');
  const myToken = ++availabilityCheckToken;

  box.className = 'availability-box show';
  box.textContent = 'Controllo disponibilità…';

  try {
    const data = await callApi('checkAvailability', { day, month, year });
    if (myToken !== availabilityCheckToken) return; // risposta obsoleta, ignora
    if (data.error) throw new Error(data.error);

    const a = data.availability;
    if (a.closed) {
      bookingBlocked = true;
      box.className = 'availability-box show blocked';
      box.textContent = `⛔ Siamo spiacenti, il locale è chiuso in questa data${a.closedReason ? ' (' + a.closedReason + ')' : ''}. Scegli un altro giorno.`;
    } else if (a.remaining === 0) {
      bookingBlocked = true;
      box.className = 'availability-box show blocked';
      box.textContent = '⛔ Posti esauriti per questa data. Scegli un altro giorno o un altro orario.';
    } else if (a.remaining !== null) {
      box.className = 'availability-box show ok';
      box.textContent = `✅ Disponibile — posti residui: ${a.remaining}`;
    } else {
      box.className = 'availability-box show ok';
      box.textContent = '✅ Data disponibile';
    }
  } catch (err) {
    // Se il controllo fallisce non blocchiamo il cliente: sarà comunque il
    // backend a rifiutare la prenotazione al momento dell'invio, se necessario.
    box.className = 'availability-box';
  }
}

document.getElementById('btn-book').addEventListener('click', async () => {
  const people = document.getElementById('book-people').value;
  const dateVal = document.getElementById('book-date').value; // formato YYYY-MM-DD
  const time = document.getElementById('book-time').value;
  const btn = document.getElementById('btn-book');
  const session = getSession();

  if (!people || !dateVal || !time) {
    return showMsg('booking-msg', 'Compila tutti i campi', 'error');
  }
  if (bookingBlocked) {
    return showMsg('booking-msg', 'Non è possibile prenotare in questa data: chiusura o posti esauriti', 'error');
  }

  const [year, month, day] = dateVal.split('-');

  setLoading(btn, true, 'Conferma prenotazione');
  try {
    const data = await callApi('book', { token: session.token, people, day, month, year, time });
    if (data.error) throw new Error(data.error);

    showMsg('booking-msg', `Tavolo prenotato per ${people} persone il ${day}/${month}/${year} alle ${time} ✅`, 'success');
    document.getElementById('book-people').value = '';
    document.getElementById('book-date').value = '';
    document.getElementById('book-time').value = '';
    document.getElementById('book-availability').className = 'availability-box';
    bookingBlocked = false;
  } catch (err) {
    showMsg('booking-msg', err.message, 'error');
  } finally {
    setLoading(btn, false, 'Conferma prenotazione');
  }
});

document.getElementById('btn-logout').addEventListener('click', () => {
  clearSession();
  setActiveDot(0);
  showStep(stepRegister);
});
