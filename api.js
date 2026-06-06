// ============================================================
//  api.js — ตัวเรียก backend, LIFF, และระบบธีม
//  ต้องโหลดหลัง config.js และหลัง LIFF SDK
// ============================================================
(function () {
  var CFG = window.CONFIG || {};
  var _settings = null;       // cache ของ settings
  var _profile = null;        // cache ของโปรไฟล์ LIFF

  // ---------- เรียก API ----------
  // GET: ใช้ query string
  async function apiGet(action, params) {
    params = params || {};
    var url = CFG.API_URL + '?action=' + encodeURIComponent(action);
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null) return;
      if (typeof v === 'object') v = JSON.stringify(v);
      url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(v);
    });
    var res = await fetch(url, { method: 'GET' });
    return res.json();
  }

  // POST: ส่ง JSON เป็น text/plain เพื่อเลี่ยง CORS preflight ของ Apps Script
  async function apiPost(action, payload) {
    payload = payload || {};
    payload.action = action;
    var res = await fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    return res.json();
  }

  // POST สำหรับ staff/admin — แนบ key อัตโนมัติ
  // key สำหรับ staff/admin: ใช้จาก config ก่อน ถ้าไม่มีดึงจาก localStorage (พิมพ์ครั้งเดียวบนเครื่อง)
  function getKey() {
    if (CFG.ADMIN_KEY) return CFG.ADMIN_KEY;
    try { return localStorage.getItem('event_admin_key') || ''; } catch (e) { return ''; }
  }
  function setKey(k) { try { localStorage.setItem('event_admin_key', k || ''); } catch (e) {} }
  function clearKey() { try { localStorage.removeItem('event_admin_key'); } catch (e) {} }

  // session ของ staff/admin (เก็บ username/display_name/role)
  function setSession(o) { try { localStorage.setItem('staff_session', JSON.stringify(o || {})); } catch (e) {} }
  function getSession() { try { var s = localStorage.getItem('staff_session'); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function clearSession() { try { localStorage.removeItem('staff_session'); } catch (e) {} }

  async function apiPostAuth(action, payload) {
    payload = payload || {};
    payload.key = getKey();
    return apiPost(action, payload);
  }
  async function apiGetAuth(action, params) {
    params = params || {};
    params.key = getKey();
    return apiGet(action, params);
  }

  // ---------- LIFF ----------
  // requireLogin=true จะบังคับ login ถ้ายังไม่ได้ login
  async function liffInit(requireLogin) {
    if (typeof liff === 'undefined') throw new Error('LIFF SDK ยังไม่ถูกโหลด');
    await liff.init({ liffId: CFG.LIFF_ID });
    if (requireLogin !== false && !liff.isLoggedIn()) {
      liff.login();
      return new Promise(function () {}); // ค้างไว้ระหว่าง redirect
    }
    return liff;
  }

  async function getProfile() {
    if (_profile) return _profile;
    if (typeof liff !== 'undefined' && liff.isLoggedIn()) {
      _profile = await liff.getProfile(); // {userId, displayName, pictureUrl, statusMessage}
    }
    return _profile;
  }

  // ---------- SETTINGS + THEME ----------
  async function loadSettings(force) {
    if (_settings && !force) return _settings;
    var r = await apiGet('getSettings');
    _settings = (r && r.settings) ? r.settings : {};
    return _settings;
  }

  // เอา settings มาทาสีลง CSS variables + ใส่ชื่องาน/โลโก้
  function applyTheme(s) {
    s = s || _settings || {};
    var root = document.documentElement;
    if (s.color_primary) root.style.setProperty('--primary', s.color_primary);
    if (s.color_accent)  root.style.setProperty('--accent', s.color_accent);
    if (s.wheel_color_a) root.style.setProperty('--wheel-a', s.wheel_color_a);
    if (s.wheel_color_b) root.style.setProperty('--wheel-b', s.wheel_color_b);
    if (s.wheel_text_a)  root.style.setProperty('--wheel-text-a', s.wheel_text_a);
    if (s.wheel_text_b)  root.style.setProperty('--wheel-text-b', s.wheel_text_b);

    if (s.event_name) document.title = s.event_name;
    document.querySelectorAll('[data-event-name]').forEach(function (el) {
      el.textContent = s.event_name || '';
    });
    document.querySelectorAll('[data-event-date]').forEach(function (el) {
      el.textContent = s.event_date || '';
    });
    document.querySelectorAll('[data-event-location]').forEach(function (el) {
      el.textContent = s.event_location || '';
    });
    document.querySelectorAll('[data-logo]').forEach(function (el) {
      if (s.logo_url) el.src = driveImg(s.logo_url);
    });
  }

  // โหลด settings แล้วทาธีมในขั้นตอนเดียว
  async function bootTheme() {
    var s = await loadSettings();
    applyTheme(s);
    return s;
  }

  // ---------- UTILS ----------
  // แปลงลิงก์ Google Drive ให้เป็น URL รูปที่แสดงได้
  function driveImg(url) {
    if (!url) return '';
    var m = String(url).match(/\/d\/([^/]+)/) || String(url).match(/[?&]id=([^&]+)/);
    if (m) return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1000';
    return url;
  }

  function fmtBaht(n) {
    return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0 }) + ' ฿';
  }

  function fieldOn(s, name) {
    var v = (s || _settings || {})['field_' + name];
    return String(v).toUpperCase() === 'TRUE';
  }

  function qs(sel, el) { return (el || document).querySelector(sel); }
  function qsa(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }

  function toast(msg, ms) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 300);
    }, ms || 2200);
  }

  // ---------- export ----------
  window.API = {
    get: apiGet, post: apiPost,
    getAuth: apiGetAuth, postAuth: apiPostAuth,
    getKey: getKey, setKey: setKey, clearKey: clearKey,
    setSession: setSession, getSession: getSession, clearSession: clearSession,
    liffInit: liffInit, getProfile: getProfile,
    loadSettings: loadSettings, applyTheme: applyTheme, bootTheme: bootTheme,
    driveImg: driveImg, fmtBaht: fmtBaht, fieldOn: fieldOn,
    qs: qs, qsa: qsa, toast: toast,
    settings: function () { return _settings; }
  };
})();
