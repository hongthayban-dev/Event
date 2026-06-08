// ========== CONFIGURATION ==========
const CONFIG = {
  LIFF_ID: '2010308553-ubIy665f',
  API_URL: 'https://script.google.com/macros/s/AKfycbzllK0_OtqWXJYc28VbLfcw8ygVwfX6xrA36sRq4bE522rhiM3pWbYlnUaftlZ1attl/exec',
  DRIVE_FOLDER_ID: '1uuF70gDDiPQ8qnpYasKwjCojR7nuGW6R'
  // TYPHOON_API_KEY ถูกย้ายออกจาก client-side แล้ว
  // หากต้องการ OCR ให้เพิ่ม endpoint ในฝั่ง Apps Script แทน
};

// ========== LIFF ==========
async function liffInit(silentFail) {
  if (!window.liff) {
    if (silentFail) return;
    throw new Error('LIFF SDK not loaded');
  }
  await liff.init({ liffId: CONFIG.LIFF_ID });
  if (!liff.isLoggedIn()) {
    if (silentFail) return;
    throw new Error('LIFF: Not logged in');
  }
}

async function getProfile() {
  if (!window.liff || !liff.isLoggedIn()) throw new Error('LIFF: Not logged in');
  return liff.getProfile();
}

// ========== API HELPERS (private) ==========
async function fetchJSON_(url, options) {
  const resp = await fetch(url, options);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const json = await resp.json();
  if (!json.ok) throw new Error(json.error || 'API error');
  return json;
}

function buildPayload_(action, obj) {
  const p = new URLSearchParams();
  p.append('action', action);
  Object.keys(obj).forEach(k => {
    p.append(k, typeof obj[k] === 'string' ? obj[k] : JSON.stringify(obj[k]));
  });
  return p;
}

// ========== API CALLS ==========
const API = {
  async get(action, params = {}) {
    action = action.replace(/^\//, '');
    const url = new URL(CONFIG.API_URL);
    url.searchParams.append('action', action);
    Object.keys(params).forEach(k => {
      url.searchParams.append(k, typeof params[k] === 'string' ? params[k] : JSON.stringify(params[k]));
    });
    return fetchJSON_(url, { method: 'GET' });
  },

  async post(action, data = {}) {
    action = action.replace(/^\//, '');
    return fetchJSON_(CONFIG.API_URL, {
      method: 'POST',
      body: buildPayload_(action, data),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
  },

  // ส่งผ่าน POST แทน GET เพื่อไม่ให้ token ติด URL / browser history
  async getAuth(action, params = {}, token) {
    return API.postAuth(action, params, token);
  },

  async postAuth(action, data = {}, token) {
    action = action.replace(/^\//, '');
    const adminKey = token || getKey('access-code') || getKey('admin-key') || '';
    const payload = buildPayload_(action, data);
    payload.append('admin_key', adminKey);
    return fetchJSON_(CONFIG.API_URL, {
      method: 'POST',
      body: payload,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
  },

  // ========== Expose standalone functions (backward compat) ==========
  liffInit,
  getProfile,
  bootTheme,
  applyTheme,
  setKey,
  getKey,
  clearKey,
  setSession,
  getSession,
  clearSession,
  fmtBaht,
  fmtDate,
  qs,
  qsa,
  toast,
  fieldOn,
  driveImg,
  ocrReceiptAmount,
  loadQRLibrary,
  generateQRCode,
  isMobile,
  debounce
};

// ========== OCR ==========
// เรียก ocrSlip action ฝั่ง Apps Script (ซึ่งเรียก Typhoon Vision API)
// ตั้ง Script Property TYPHOON_API_KEY เพื่อเปิดใช้งาน
async function ocrReceiptAmount(imageBase64) {
  try {
    const res = await API.post('ocrSlip', { imageBase64 });
    return { success: !!(res.success && res.amount > 0), amount: res.amount || 0 };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ========== DRIVE IMAGE ==========
function driveImg(fileId, size = 500) {
  return `https://lh3.googleusercontent.com/d/${fileId}=w${size}`;
}

// ========== THEME ==========
async function bootTheme() {
  try {
    const res = await API.get('getSettings');
    const settings = res.settings || {};
    applyTheme(settings);
    document.querySelectorAll('[data-event-name]').forEach(el => {
      if (settings.event_name) el.textContent = settings.event_name;
    });
    document.querySelectorAll('[data-event-date]').forEach(el => {
      if (settings.event_date) el.textContent = settings.event_date;
    });
    document.querySelectorAll('[data-event-location]').forEach(el => {
      if (settings.event_location) el.textContent = settings.event_location;
    });
    document.querySelectorAll('[data-logo]').forEach(el => {
      if (settings.logo_url) el.src = driveImg(settings.logo_url);
    });
    return settings;
  } catch (err) {
    console.error('Boot theme error:', err);
    return {};
  }
}

function applyTheme(settings) {
  const root = document.documentElement;
  root.style.setProperty('--color-primary', settings.color_primary || '#0d2b5e');
  root.style.setProperty('--color-accent', settings.color_accent || '#f0c040');
  root.style.setProperty('--wheel-color-a', settings.wheel_color_a || '#ff6b6b');
  root.style.setProperty('--wheel-color-b', settings.wheel_color_b || '#4ecdc4');
  root.style.setProperty('--wheel-text-a', settings.wheel_text_a || '#ffffff');
  root.style.setProperty('--wheel-text-b', settings.wheel_text_b || '#ffffff');
  if (settings.bg_color) {
    root.style.setProperty('--bg', settings.bg_color);
    document.body.style.background = settings.bg_color;
  }
}

// ========== STORAGE ==========
function setKey(key, value) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch (err) {
    console.warn('localStorage full:', err);
  }
}

function getKey(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch (err) {
    return '';
  }
}

function clearKey(key) {
  try {
    if (key) localStorage.removeItem(key);
    else localStorage.clear();
  } catch (err) {
    console.warn('Clear key error:', err);
  }
}

// ========== SESSION ==========
function setSession(data) {
  try {
    sessionStorage.setItem('staff-session', typeof data === 'string' ? data : JSON.stringify(data));
  } catch (err) {
    console.error('Session storage error:', err);
  }
}

function getSession() {
  try {
    const s = sessionStorage.getItem('staff-session');
    return s ? JSON.parse(s) : null;
  } catch (err) {
    return null;
  }
}

function clearSession() {
  try {
    sessionStorage.clear();
    localStorage.removeItem('admin-token');
    localStorage.removeItem('admin-key');
    localStorage.removeItem('access-code');
  } catch (err) {
    console.error('Clear session error:', err);
  }
}

// ========== FORMATTING ==========
function fmtBaht(amount) {
  const num = parseFloat(amount) || 0;
  return '฿' + num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(date) {
  return new Date(date).toLocaleString('th-TH');
}

// ========== DOM HELPERS ==========
function qs(selector) {
  return document.querySelector(selector);
}

function qsa(selector) {
  return document.querySelectorAll(selector);
}

function toast(message, type = 'info') {
  const old = document.getElementById('toast');
  if (old) old.remove();
  const el = document.createElement('div');
  el.id = 'toast';
  el.className = 'toast ' + type;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ========== FIELD TOGGLE ==========
function fieldOn(settings, key) {
  if (!settings) return false;
  return settings['field_' + key] !== false;
}

// ========== QR CODE ==========
async function loadQRLibrary() {
  if (!window.QRCode) {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
}

function generateQRCode(text, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  new QRCode(container, {
    text,
    width: 200,
    height: 200,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.H
  });
}

// ========== UTILITY ==========
function isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}
