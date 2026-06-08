// ========== CONFIGURATION ==========
const CONFIG = {
  LIFF_ID: '2010308553-ubIy665f',
  API_URL: 'https://script.google.com/macros/s/AKfycbzllK0_OtqWXJYc28VbLfcw8ygVwfX6xrA36sRq4bE522rhiM3pWbYlnUaftlZ1attl/exec',
  TYPHOON_API_KEY: 'sk-Kz0eO9PdNDU8398ZoZr100x4d7LIUCfeqnUnDh0EhTCbqY6E',
  DRIVE_FOLDER_ID: '1uuF70gDDiPQ8qnpYasKwjCojR7nuGW6R'
};

// ========== LIFF (FIXED) ==========
async function liffInit(silentFail) {
  return new Promise((resolve, reject) => {
    if (!window.liff) {
      reject(new Error('LIFF SDK not loaded'));
      return;
    }
    
    liff.init({
      liffId: CONFIG.LIFF_ID
    }).then(() => {
      if (!liff.isLoggedIn()) {
        reject(new Error('LIFF: Not logged in'));
      } else {
        resolve();
      }
    }).catch(err => {
      reject(new Error('LIFF: ' + err.message));
    });
  });
}

async function getProfile() {
  return new Promise((resolve, reject) => {
    if (!liff || !liff.isLoggedIn()) {
      reject(new Error('LIFF: Not logged in'));
      return;
    }
    
    liff.getProfile()
      .then(profile => resolve(profile))
      .catch(err => reject(err));
  });
}

// ========== API CALLS ==========
const API = {
  async get(action, params = {}) {
    action = action.replace(/^\//, ''); // Remove leading /
    const url = new URL(CONFIG.API_URL);
    url.searchParams.append('action', action);
    Object.keys(params).forEach(key => {
      url.searchParams.append(key, typeof params[key] === 'string' ? params[key] : JSON.stringify(params[key]));
    });
    
    const resp = await fetch(url, { method: 'GET' });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error);
    return json;
  },
  
  async post(action, data = {}) {
    action = action.replace(/^\//, ''); // Remove leading /
    const payload = new URLSearchParams();
    payload.append('action', action);
    Object.keys(data).forEach(key => {
      payload.append(key, typeof data[key] === 'string' ? data[key] : JSON.stringify(data[key]));
    });
    
    const resp = await fetch(CONFIG.API_URL, {
      method: 'POST',
      body: payload,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error);
    return json;
  },
  
  async getAuth(action, params = {}, token) {
    action = action.replace(/^\//, ''); // Remove leading /
    const url = new URL(CONFIG.API_URL);
    url.searchParams.append('action', action);
    url.searchParams.append('admin_key', token);
    Object.keys(params).forEach(key => {
      url.searchParams.append(key, typeof params[key] === 'string' ? params[key] : JSON.stringify(params[key]));
    });
    
    const resp = await fetch(url, { method: 'GET' });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error);
    return json;
  },
  
  async postAuth(action, data = {}, token) {
    action = action.replace(/^\//, ''); // Remove leading /
    const payload = new URLSearchParams();
    payload.append('action', action);
    payload.append('admin_key', token);
    Object.keys(data).forEach(key => {
      payload.append(key, typeof data[key] === 'string' ? data[key] : JSON.stringify(data[key]));
    });
    
    const resp = await fetch(CONFIG.API_URL, {
      method: 'POST',
      body: payload,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error);
    return json;
  }
};

// ========== OCR (IMPROVED) ==========
async function ocrReceiptAmount(imageBase64) {
  try {
    // Method 1: Typhoon OCR API (Optional fallback)
    if (CONFIG.TYPHOON_API_KEY) {
      try {
        const response = await fetch('https://api.typhoon.ai/v1/ocr', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${CONFIG.TYPHOON_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            image: imageBase64,
            language: 'th'
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.text) {
            const amounts = data.text.match(/\d+(?:\.\d{2})?/g) || [];
            if (amounts.length > 0) {
              const amount = Math.max(...amounts.map(parseFloat));
              return { success: true, amount: amount, text: data.text };
            }
          }
        }
      } catch (typhoonErr) {
        console.warn('Typhoon OCR not available:', typhoonErr.message);
      }
    }
    
    // Fallback: ให้ user กรอกเอง
    return {
      success: false,
      error: 'OCR not available',
      hint: 'กรุณากรอกยอดเงินด้วยตัวเอง'
    };
  } catch (err) {
    console.error('OCR error:', err);
    return {
      success: false,
      error: err.message,
      hint: 'กรุณากรอกยอดเงินด้วยตัวเอง'
    };
  }
}

// ========== PROMPTPAY QR ==========
function generatePromptPayQR(phoneOrId, amount) {
  // PromptPay QR format
  // Can use: https://promptpay.io/api/generateQR endpoint
  // Or pre-generate and upload to Drive
  
  // For now, return service URL
  return `https://api.promptpay.io/qr/generate?phoneNumber=${encodeURIComponent(phoneOrId)}&amount=${amount}`;
}

// ========== DRIVE IMAGE ==========
function driveImg(fileId, size = 500) {
  return `https://lh3.googleusercontent.com/d/${fileId}=w${size}`;
}

// ========== THEME ==========
async function bootTheme() {
  try {
    const res = await API.get('/getSettings');
    const settings = res.settings || {};
    applyTheme(settings);
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
}

// ========== STORAGE (FIXED) ==========
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
    if (key) {
      localStorage.removeItem(key);
    } else {
      localStorage.clear();
    }
  } catch (err) {
    console.warn('Clear key error:', err);
  }
}

// ========== SESSION (FIXED) ==========
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
  // Remove old toasts
  const old = document.getElementById('toast');
  if (old) old.remove();
  
  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.style.cssText = `
    position: fixed; top: 10px; right: 10px; z-index: 9999;
    background: ${type === 'success' ? '#4caf50' : type === 'error' ? '#d32f2f' : '#2196f3'};
    color: white; padding: 16px 20px; border-radius: 6px;
    font-weight: 600; max-width: 300px; word-break: break-word;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    animation: slideIn 0.3s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.remove(), 3000);
}

// ========== FIELD TOGGLE HELPERS (FIXED) ==========
function fieldOn(settings, key) {
  if (!settings) return false;
  return settings['field_' + key] !== false;
}

// ========== QR CODE GENERATION (optional) ==========
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
    text: text,
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
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
