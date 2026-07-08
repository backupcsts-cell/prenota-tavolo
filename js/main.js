// ==== CONFIGURAZIONE ====
// Incolla qui l'URL del tuo Web App di Google Apps Script (termina con /exec).
// Lo ottieni da: Apps Script → Distribuisci → Nuova implementazione → Applicazione web.
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyIMZKjkSwlKF-mKBF1RLE2oYDjliq_kG6wTMGt-loRU_ARnLX09tI7G5nKqX7QJTPE/exec';

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

// Chiede al backend se la verifica telefono via WhatsApp è attiva in questo momento.
// Spenta di default: se il gestore non l'ha ancora configurata, questo step
// viene semplicemente saltato, senza alcun impatto sull'esperienza cliente.
async function checkConfig() {
  try {
    const data = await callApi('getConfig', {});
    phoneVerificationEnabled = !!data.phoneVerificationEnabled;
  } catch (err) {
    phoneVerificationEnabled = false;
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
document.getElementById('btn-book').addEventListener('click', async () => {
  const people = document.getElementById('book-people').value;
  const dateVal = document.getElementById('book-date').value; // formato YYYY-MM-DD
  const time = document.getElementById('book-time').value;
  const btn = document.getElementById('btn-book');
  const session = getSession();

  if (!people || !dateVal || !time) {
    return showMsg('booking-msg', 'Compila tutti i campi', 'error');
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
