/**
 * ============================================================
 *  EVENT LINE OA — Backend (Google Apps Script)
 *  ระบบลงทะเบียนงาน + ร้านค้า + วงล้อจับรางวัล
 * ============================================================
 *  วิธีใช้ (ดู SETUP.md ประกอบ):
 *   1. วางโค้ดนี้ในโปรเจกต์ Apps Script ที่ผูกกับ/เปิดชีตได้
 *   2. ตั้งค่า Script Properties:
 *        LINE_TOKEN  = Channel Access Token ของ LINE OA
 *        ADMIN_KEY   = รหัสลับสำหรับหน้า staff/admin (ตั้งเองอะไรก็ได้)
 *   3. Deploy > New deployment > Web app
 *        Execute as: Me   |   Who has access: Anyone
 *   4. เอา URL /exec ไปใส่ใน config.js (API_URL)
 * ============================================================
 */

// ---- ค่าคงที่ ----
const SHEET_ID       = '1QCQM1Y65YG9Mgt1g9VlCSdYlOQ5ZAFLVTyunJgn62no';
const SLIP_FOLDER_ID = '1uuF70gDDiPQ8qnpYasKwjCojR7nuGW6R'; // โฟลเดอร์เก็บสลิป
const LINE_PUSH_URL  = 'https://api.line.me/v2/bot/message/push';

// ---- ตัวช่วยพื้นฐาน ----
function props_()  { return PropertiesService.getScriptProperties(); }
function token_()  { return props_().getProperty('LINE_TOKEN'); }
function ss_()     { return SpreadsheetApp.openById(SHEET_ID); }
function sheet_(n) { return ss_().getSheetByName(n); }

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  ROUTER
// ============================================================
function doGet(e)  { return handle_(e, 'GET'); }
function doPost(e) { return handle_(e, 'POST'); }

// FIXED: แก้ POST parsing สำหรับ URLSearchParams
function handle_(e, method) {
  var p = {};
  try {
    if (method === 'POST' && e.postData && e.postData.contents) {
      // Parse URLSearchParams format: key=value&key2=value2
      var contents = String(e.postData.contents);
      var pairs = contents.split('&');
      pairs.forEach(function (pair) {
        var eqIdx = pair.indexOf('=');
        if (eqIdx < 0) return;
        var key = decodeURIComponent(pair.substring(0, eqIdx));
        var value = decodeURIComponent(pair.substring(eqIdx + 1));
        
        // พยายาม parse เป็น JSON ก่อน ถ้าใช้งาน ก็ใช้ string
        try {
          p[key] = JSON.parse(value);
        } catch (err) {
          p[key] = value;
        }
      });
    } else {
      p = (e && e.parameter) ? e.parameter : {};
    }
  } catch (err) {
    p = (e && e.parameter) ? e.parameter : {};
  }
  
  var action = p.action;
  if (typeof action !== 'string') action = '';
  action = String(action).replace(/^"/, '').replace(/"$/, ''); // Remove quotes
  
  var result;
  try {
    result = route_(action, p);
  } catch (err) {
    result = { ok: false, error: String((err && err.message) || err) };
  }
  return json_(result);
}

function route_(action, p) {
  switch (action) {
    // ---------- public reads ----------
    case 'ping':            return { ok: true, time: new Date().toISOString() };
    case 'getSettings':     return { ok: true, settings: getPublicSettings_() };
    case 'getProducts':     return { ok: true, products: getRows_('products') };
    case 'getRewards':      return { ok: true, rewards: getRows_('rewards') };
    case 'getRegistration': return getRegistration_(p);

    // ---------- public writes ----------
    case 'register':     return register_(p);
    case 'createOrder':  return createOrder_(p);
    case 'uploadSlip':   return uploadSlip_(p);
    case 'staffLogin':   return staffLogin_(p);
    case 'verifyPin':    return verifyPin_(p);

    // ---------- staff/admin (ต้องมี key) ----------
    case 'searchByPhone':    requireKey_(p); return searchByPhone_(p);
    case 'checkin':          requireKey_(p); return checkin_(p);
    case 'getRegistrations': requireKey_(p); return { ok: true, registrations: getRows_('registrations') };
    case 'getWinners':       requireKey_(p); return { ok: true, winners: getRows_('winners') };
    case 'getOrders':        requireKey_(p); return { ok: true, orders: getRows_('orders') };
    case 'getStaff':         requireKey_(p); return getStaffList_();
    case 'getEligible':      requireKey_(p); return eligible_(p);

    // ---------- wheel ----------
    case 'getWheelState':  return { ok: true, state: getWheelState_() }; // จอ poll ได้ ไม่ต้อง key
    case 'getWheelPool':   var _ws = getWheelState_(); return { ok: true, pool: _ws.pool || [], prepToken: _ws.prepToken || 0 };
    case 'prepare':        requireKey_(p); return prepare_(p);
    case 'spinPhysics':    requireKey_(p); return spinPhysics_(p);
    case 'requestSpin':    requireKey_(p); return requestSpin_(p);
    case 'resetWheel':     requireKey_(p); return resetWheel_(p);

    // ---------- admin manage ----------
    case 'getAdminSettings': requireKey_(p); return { ok: true, settings: getSettingsMap_() };
    case 'verifyOrder':    requireKey_(p); return verifyOrder_(p);
    case 'updateSettings': requireKey_(p); return updateSettings_(p);
    case 'saveProduct':    requireKey_(p); return saveProduct_(p);
    case 'deleteProduct':  requireKey_(p); return deleteRowById_('products', 'id', p.id);
    case 'saveStaff':      requireKey_(p); return saveStaff_(p);
    case 'deleteStaff':    requireKey_(p); return deleteRowById_('staff', 'username', p.username);
    case 'saveReward':     requireKey_(p); return saveReward_(p);
    case 'deleteReward':   requireKey_(p); return deleteRowById_('rewards', 'order', p.order);

    default: return { ok: false, error: 'unknown action: ' + action };
  }
}

// ============================================================
//  SHEET HELPERS
// ============================================================
function getHeaders_(name) {
  var sh = sheet_(name);
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

function getRows_(name) {
  var sh = sheet_(name);
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(String);
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row.join('') === '') continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = row[c];
    obj._row = i + 1;
    out.push(obj);
  }
  return out;
}

function appendByHeaders_(name, obj) {
  var sh = sheet_(name);
  var headers = getHeaders_(name);
  var row = headers.map(function (h) { return obj.hasOwnProperty(h) ? obj[h] : ''; });
  sh.appendRow(row);
}

function findRow_(name, col, val) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  var headers = values[0].map(String);
  var idx = headers.indexOf(col);
  if (idx < 0) return null;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][idx]) === String(val)) return i + 1;
  }
  return null;
}

function rowObj_(name, rowNum) {
  var sh = sheet_(name);
  var headers = getHeaders_(name);
  var row = sh.getRange(rowNum, 1, 1, headers.length).getValues()[0];
  var o = {};
  for (var i = 0; i < headers.length; i++) o[headers[i]] = row[i];
  o._row = rowNum;
  return o;
}

function deleteRowById_(name, col, id) {
  var rowNum = findRow_(name, col, id);
  if (!rowNum) return { ok: false, error: 'not found' };
  sheet_(name).deleteRow(rowNum);
  return { ok: true };
}

// ============================================================
//  SETTINGS  (แท็บ settings เป็น key,value ไม่มี header)
// ============================================================
function getSettingsMap_() {
  var sh = sheet_('settings');
  var values = sh.getDataRange().getValues();
  var map = {};
  values.forEach(function (r) { if (r[0] !== '') map[String(r[0])] = r[1]; });
  return map;
}

function getPublicSettings_() {
  var m = getSettingsMap_();
  var hide = ['pin_lottery', 'pin_remote']; // ห้ามส่ง pin ออกหน้าเว็บ
  var out = {};
  Object.keys(m).forEach(function (k) { if (hide.indexOf(k) < 0) out[k] = m[k]; });
  return out;
}

function updateSettings_(p) {
  var sh = sheet_('settings');
  var values = sh.getDataRange().getValues();
  var rowOf = {};
  values.forEach(function (r, i) { if (r[0] !== '') rowOf[String(r[0])] = i + 1; });
  var upd = p.settings || p;
  Object.keys(upd).forEach(function (k) {
    if (rowOf[k]) sh.getRange(rowOf[k], 2).setValue(upd[k]);
    else sh.appendRow([k, upd[k]]);
  });
  return { ok: true };
}

// ============================================================
//  AUTH
// ============================================================
function requireKey_(p) {
  var need = props_().getProperty('ADMIN_KEY');
  if (!need) return true; // ยังไม่ตั้ง = โหมด dev (อนุญาต)
  if (String(p.admin_key) === String(need)) return true;
  throw new Error('unauthorized');
}

function staffLogin_(p) {
  var rows = getRows_('staff');
  var u = rows.filter(function (x) {
    return String(x.username) === String(p.username) &&
           String(x.password) === String(p.password);
  })[0];
  if (!u) return { ok: false, error: 'invalid credentials' };
  return { ok: true, username: u.username, display_name: u.display_name, role: u.role };
}

function verifyPin_(p) {
  var m = getSettingsMap_();
  var key = (p.type === 'remote') ? 'pin_remote' : 'pin_lottery';
  return { ok: String(m[key]) === String(p.pin) };
}

function getStaffList_() {
  var rows = getRows_('staff').map(function (r) {
    return { username: r.username, display_name: r.display_name, role: r.role, created_at: r.created_at };
  });
  return { ok: true, staff: rows };
}

function saveStaff_(p) {
  var s = p.staff || p;
  var rowNum = s.username ? findRow_('staff', 'username', s.username) : null;
  if (!rowNum) {
    appendByHeaders_('staff', {
      username: s.username, password: s.password || '',
      display_name: s.display_name || '', role: s.role || 'staff',
      created_at: new Date()
    });
  } else {
    var sh = sheet_('staff'); var h = getHeaders_('staff');
    ['password', 'display_name', 'role'].forEach(function (f) {
      if (s[f] !== undefined && s[f] !== '') sh.getRange(rowNum, h.indexOf(f) + 1).setValue(s[f]);
    });
  }
  return { ok: true };
}

// ============================================================
//  REGISTRATION
// ============================================================
function getRegistration_(p) {
  var r = findRow_('registrations', 'line_user_id', p.line_user_id);
  if (!r) return { ok: true, found: false };
  return { ok: true, found: true, registration: rowObj_('registrations', r) };
}

function register_(p) {
  // กันลงทะเบียนซ้ำด้วย line_user_id
  if (p.line_user_id) {
    var existing = findRow_('registrations', 'line_user_id', p.line_user_id);
    if (existing) {
      return { ok: true, duplicate: true, registration: rowObj_('registrations', existing) };
    }
  }
  var reg_id = 'R' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100);
  appendByHeaders_('registrations', {
    reg_id: reg_id,
    line_user_id: p.line_user_id || '',
    first_name: p.first_name || '',
    last_name: p.last_name || '',
    nickname: p.nickname || '',
    gender: p.gender || '',
    age: p.age || '',
    phone: p.phone || '',
    generation: p.generation || '',
    province: p.province || '',
    occupation: p.occupation || '',
    organization: p.organization || '',
    email: p.email || '',
    address: p.address || '',
    registered_at: new Date(),
    checked_in: 'FALSE',
    checkin_at: '',
    checkin_by: ''
  });
  var reg = rowObj_('registrations', findRow_('registrations', 'reg_id', reg_id));
  // ทักทาย + ส่งบัตร (Flex card) เข้าแชต LINE
  if (p.line_user_id) {
    var m = getSettingsMap_();
    var msgs = [];
    var greet = String(m.line_greeting || '').replace('{name}', p.nickname || p.first_name || '');
    if (greet) msgs.push({ type: 'text', text: greet });
    msgs.push(buildRegFlex_(reg));
    pushLine_(p.line_user_id, msgs);
  }
  return { ok: true, reg_id: reg_id, registration: reg };
}

function searchByPhone_(p) {
  var phone = String(p.phone || '').replace(/\D/g, '');
  var rows = getRows_('registrations').filter(function (x) {
    return String(x.phone).replace(/\D/g, '') === phone && phone !== '';
  });
  return { ok: true, results: rows };
}

function checkin_(p) {
  var rowNum = null;
  if (p.reg_id) rowNum = findRow_('registrations', 'reg_id', p.reg_id);
  if (!rowNum && p.line_user_id) rowNum = findRow_('registrations', 'line_user_id', p.line_user_id);
  if (!rowNum) return { ok: false, error: 'not found' };

  var sh = sheet_('registrations'); var h = getHeaders_('registrations');
  var ci = h.indexOf('checked_in') + 1;
  var already = String(sh.getRange(rowNum, ci).getValue()).toUpperCase() === 'TRUE';
  sh.getRange(rowNum, ci).setValue('TRUE');
  sh.getRange(rowNum, h.indexOf('checkin_at') + 1).setValue(new Date());
  sh.getRange(rowNum, h.indexOf('checkin_by') + 1).setValue(p.checkin_by || '');
  return { ok: true, already_checked_in: already, registration: rowObj_('registrations', rowNum) };
}

// ============================================================
//  PRODUCTS / ORDERS
// ============================================================
function saveProduct_(p) {
  var prod = p.product || p;
  var rowNum = prod.id ? findRow_('products', 'id', prod.id) : null;
  if (!rowNum) {
    var rows = getRows_('products');
    var maxId = rows.reduce(function (mx, r) { return Math.max(mx, Number(r.id) || 0); }, 0);
    prod.id = prod.id || (maxId + 1);
    appendByHeaders_('products', {
      id: prod.id, name: prod.name || '', price: prod.price || 0,
      img_url: prod.img_url || '', stock: prod.stock || 0, description: prod.description || ''
    });
  } else {
    var sh = sheet_('products'); var h = getHeaders_('products');
    ['name', 'price', 'img_url', 'stock', 'description'].forEach(function (f) {
      if (prod[f] !== undefined) sh.getRange(rowNum, h.indexOf(f) + 1).setValue(prod[f]);
    });
  }
  return { ok: true, id: prod.id };
}

function createOrder_(p) {
  var order_id = 'O' + Date.now().toString(36).toUpperCase();
  appendByHeaders_('orders', {
    order_id: order_id,
    line_user_id: p.line_user_id || '',
    customer_name: p.customer_name || '',
    phone: p.phone || '',
    items: (typeof p.items === 'string') ? p.items : JSON.stringify(p.items || []),
    total_amount: p.total_amount || 0,
    promptpay_ref: p.promptpay_ref || '',
    slip_url: p.slip_url || '',
    status: 'pending',
    created_at: new Date(),
    verified_at: '',
    verified_by: ''
  });
  return { ok: true, order_id: order_id };
}

function verifyOrder_(p) {
  var rowNum = findRow_('orders', 'order_id', p.order_id);
  if (!rowNum) return { ok: false, error: 'order not found' };
  var sh = sheet_('orders'); var h = getHeaders_('orders');
  var status = p.status || 'verified';
  sh.getRange(rowNum, h.indexOf('status') + 1).setValue(status);
  sh.getRange(rowNum, h.indexOf('verified_at') + 1).setValue(new Date());
  sh.getRange(rowNum, h.indexOf('verified_by') + 1).setValue(p.verified_by || '');
  var o = rowObj_('orders', rowNum);
  if (o.line_user_id) {
    var msg = (status === 'rejected')
      ? '❌ คำสั่งซื้อ ' + o.order_id + ' ไม่ผ่านการตรวจสอบ กรุณาติดต่อเจ้าหน้าที่'
      : '✅ ยืนยันคำสั่งซื้อ ' + o.order_id + ' เรียบร้อยแล้ว ขอบคุณครับ';
    sendLineText_(o.line_user_id, msg);
  }
  return { ok: true };
}

// บันทึกสลิปลง Drive แล้วคืน URL
function uploadSlip_(p) {
  var m = String(p.dataUrl || '').match(/^data:(.+);base64,(.*)$/);
  if (!m) return { ok: false, error: 'bad dataUrl' };
  var folder = DriveApp.getFolderById(SLIP_FOLDER_ID);
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], p.filename || ('slip_' + Date.now()));
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, id: file.getId(), url: 'https://drive.google.com/uc?export=view&id=' + file.getId() };
}

// ============================================================
//  REWARDS / WHEEL  (วงล้อ 2 เครื่องผ่าน polling)
// ============================================================
function saveReward_(p) {
  var r = p.reward || p;
  var rowNum = r.order ? findRow_('rewards', 'order', r.order) : null;
  if (!rowNum) {
    var rows = getRows_('rewards');
    var maxO = rows.reduce(function (mx, x) { return Math.max(mx, Number(x.order) || 0); }, 0);
    r.order = r.order || (maxO + 1);
    appendByHeaders_('rewards', {
      order: r.order, name: r.name || '', value: r.value || '',
      img_url: r.img_url || '', quantity: r.quantity || 0
    });
  } else {
    var sh = sheet_('rewards'); var h = getHeaders_('rewards');
    ['name', 'value', 'img_url', 'quantity'].forEach(function (f) {
      if (r[f] !== undefined) sh.getRange(rowNum, h.indexOf(f) + 1).setValue(r[f]);
    });
  }
  return { ok: true, order: r.order };
}

// รายชื่อผู้มีสิทธิ์ลุ้น (เช็คอินแล้ว + ยังไม่เคยถูก + ตรงฟิลเตอร์)
function getEligible_(f) {
  f = f || {};
  var rows = getRows_('registrations').filter(function (r) {
    return String(r.checked_in).toUpperCase() === 'TRUE';
  });
  // ปกติคัดคนที่เคยได้รางวัลออก เว้นแต่สั่ง include_past_winners
  if (!f.include_past_winners) {
    var won = getRows_('winners').map(function (w) { return String(w.line_user_id); });
    rows = rows.filter(function (r) {
      return !r.line_user_id || won.indexOf(String(r.line_user_id)) < 0;
    });
  }
  if (f.gender)     rows = rows.filter(function (r) { return String(r.gender) === String(f.gender); });
  if (f.generation) rows = rows.filter(function (r) { return String(r.generation) === String(f.generation); });
  if (f.age_min)    rows = rows.filter(function (r) { return Number(r.age) >= Number(f.age_min); });
  if (f.age_max)    rows = rows.filter(function (r) { return Number(r.age) <= Number(f.age_max); });
  return rows;
}

function eligible_(p) {
  var filters = typeof p.filters === 'string' ? JSON.parse(p.filters) : (p.filters || {});
  var list = getEligible_(filters);
  return {
    ok: true,
    count: list.length,
    eligible: list.map(function (r) {
      return {
        reg_id: r.reg_id, line_user_id: r.line_user_id,
        first_name: r.first_name, last_name: r.last_name,
        nickname: r.nickname, gender: r.gender, age: r.age, generation: r.generation
      };
    })
  };
}

function shuffle_(a) {
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function getWheelState_() {
  var s = props_().getProperty('WHEEL_STATE');
  return s ? JSON.parse(s) : { status: 'idle', round: 0 };
}
function setWheelState_(obj) {
  props_().setProperty('WHEEL_STATE', JSON.stringify(obj));
  return obj;
}

// เตรียมวงล้อ: โหลดรายชื่อขึ้นจอ แต่ยังไม่ตัดสินผู้ชนะ
function prepare_(p) {
  var count = parseInt(p.count || 1, 10);
  var filters = typeof p.filters === 'string' ? JSON.parse(p.filters) : (p.filters || {});
  var pool = getEligible_(filters);
  if (pool.length === 0) return { ok: false, error: 'no eligible participants' };

  var MAXSEG = 16;
  var display = shuffle_(pool.slice()).slice(0, MAXSEG).map(function (r) {
    return { id: r.reg_id, name: r.nickname || r.first_name || '—' };
  });
  shuffle_(display);

  var prepToken = Date.now();
  var state = {
    status: 'ready',
    round: (getWheelState_().round || 0),
    ts: prepToken,
    prepToken: prepToken,
    count: count,
    filters: filters,
    reward_name: p.reward_name || '',
    reward_value: p.reward_value || '',
    mode: p.mode || 'single',
    slots: display.length,
    pool: display
  };
  setWheelState_(state);
  return { ok: true, people: pool.length, prepToken: prepToken };
}

// รับ power จาก remote -> สุ่มผู้ชนะจากรายชื่อที่เตรียมไว้ -> ตั้ง state 'spinning' พร้อม landingIndex
function spinPhysics_(p) {
  var state = getWheelState_();
  if (state.status !== 'ready') return { ok: false, error: 'wheel not prepared' };

  var power = parseFloat(p.power || 60);
  var filters = state.filters || {};
  var count = state.count || 1;

  var pool = getEligible_(filters);
  if (pool.length === 0) return { ok: false, error: 'no eligible participants' };

  var winners = [];
  var work = pool.slice();
  for (var i = 0; i < count && work.length > 0; i++) {
    var idx = Math.floor(Math.random() * work.length);
    winners.push(work.splice(idx, 1)[0]);
  }

  var round = (state.round || 0) + 1;
  recordWinners_(round, winners, state.reward_name, state.reward_value);

  var displayPool = state.pool || [];
  var winnerIdx = displayPool.findIndex(function (d) { return d.id === winners[0].reg_id; });
  var landingIndex = winnerIdx >= 0 ? winnerIdx : Math.floor(Math.random() * (displayPool.length || 12));

  var newState = {
    status: 'spinning',
    round: round,
    ts: Date.now(),
    prepToken: state.prepToken,
    count: count,
    filters: filters,
    reward_name: state.reward_name,
    reward_value: state.reward_value,
    mode: state.mode || 'single',
    power: power,
    landingIndex: landingIndex,
    slots: displayPool.length,
    pool: displayPool,
    winners: winners.map(function (w) {
      return {
        reg_id: w.reg_id, line_user_id: w.line_user_id,
        first_name: w.first_name, last_name: w.last_name, nickname: w.nickname
      };
    })
  };
  setWheelState_(newState);
  notifyWinners_(winners, state.reward_name || state.reward_value || 'ของรางวัล');
  return { ok: true, state: newState };
}

// รีโมทสั่งหมุน: server สุ่มผู้ชนะ -> บันทึก -> ตั้ง state ให้จอ poll -> ยิง LINE
function requestSpin_(p) {
  var count = parseInt(p.count || 1, 10);
  var filters = typeof p.filters === 'string' ? JSON.parse(p.filters) : (p.filters || {});
  var pool = getEligible_(filters);
  if (pool.length === 0) return { ok: false, error: 'no eligible participants' };

  var winners = [];
  var work = pool.slice();
  for (var i = 0; i < count && work.length > 0; i++) {
    var idx = Math.floor(Math.random() * work.length);
    winners.push(work.splice(idx, 1)[0]);
  }

  var round = (getWheelState_().round || 0) + 1;
  recordWinners_(round, winners, p.reward_name, p.reward_value);

  // ชุดชื่อสำหรับแสดงบนวงล้อ: ผู้ชนะ + สุ่มคนอื่นมาเติม รวมไม่เกิน 16 ช่อง
  var MAXSEG = 16;
  var display = winners.map(function (w) { return { id: w.reg_id, name: w.nickname || w.first_name || '—' }; });
  var fillers = shuffle_(work.slice());
  for (var j = 0; j < fillers.length && display.length < MAXSEG; j++) {
    display.push({ id: fillers[j].reg_id, name: fillers[j].nickname || fillers[j].first_name || '—' });
  }
  shuffle_(display);

  var state = {
    status: 'spinning',
    round: round,
    ts: Date.now(),
    count: count,
    filters: filters,
    reward_name: p.reward_name || '',
    reward_value: p.reward_value || '',
    pool: display,
    winners: winners.map(function (w) {
      return {
        reg_id: w.reg_id, line_user_id: w.line_user_id,
        first_name: w.first_name, last_name: w.last_name, nickname: w.nickname
      };
    })
  };
  setWheelState_(state);
  notifyWinners_(winners, p.reward_name || p.reward_value || 'ของรางวัล');
  return { ok: true, state: state };
}

function recordWinners_(round, winners, reward_name, reward_value) {
  winners.forEach(function (w) {
    appendByHeaders_('winners', {
      round: round,
      line_user_id: w.line_user_id || '',
      first_name: w.first_name || '',
      last_name: w.last_name || '',
      nickname: w.nickname || '',
      reward_name: reward_name || '',
      reward_value: reward_value || '',
      won_at: new Date(),
      notified: 'TRUE'
    });
  });
}

function notifyWinners_(winners, rewardLabel) {
  var m = getSettingsMap_();
  var tmpl = String(m.line_winner_msg || '🏆 ยินดีด้วย {name} ได้รับ {reward}');
  winners.forEach(function (w) {
    if (!w.line_user_id) return;
    var name = w.nickname || w.first_name || '';
    var msg = tmpl.replace('{name}', name).replace('{reward}', rewardLabel);
    sendLineText_(w.line_user_id, msg);
  });
}

function resetWheel_(p) {
  return { ok: true, state: setWheelState_({ status: 'idle', round: getWheelState_().round || 0 }) };
}

// ============================================================
//  LINE MESSAGING
// ============================================================
function pushLine_(userId, messages) {
  if (!userId || !messages || !messages.length) return { ok: false, error: 'missing userId/messages' };
  var tk = token_();
  if (!tk) return { ok: false, error: 'LINE_TOKEN not set' };
  var res = UrlFetchApp.fetch(LINE_PUSH_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + tk },
    payload: JSON.stringify({ to: userId, messages: messages.slice(0, 5) }),
    muteHttpExceptions: true
  });
  return { ok: res.getResponseCode() === 200, code: res.getResponseCode(), body: res.getContentText() };
}

function sendLineText_(userId, text) {
  if (!text) return { ok: false, error: 'missing text' };
  return pushLine_(userId, [{ type: 'text', text: String(text) }]);
}

// สร้างบัตรลงทะเบียนแบบ Flex (QR + ชื่อ/ชื่อเล่น/รุ่น)
function buildRegFlex_(reg) {
  var m = getSettingsMap_();
  var primary = String(m.color_primary || '#0d2b5e');
  var accent  = String(m.color_accent  || '#f0c040');
  var eventName = String(m.event_name || 'ลงทะเบียนเข้างาน');
  var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=12&data=' +
              encodeURIComponent(reg.reg_id);
  var fullName = ((reg.first_name || '') + ' ' + (reg.last_name || '')).trim();

  var body = [
    { type: 'text', text: fullName || '-', weight: 'bold', size: 'xl', align: 'center', color: '#14213d', wrap: true }
  ];
  if (reg.nickname)   body.push({ type: 'text', text: '(' + reg.nickname + ')', size: 'sm', align: 'center', color: '#5b6b86' });
  if (reg.generation) body.push({ type: 'text', text: 'รุ่น ' + reg.generation, size: 'md', align: 'center', color: primary, weight: 'bold', margin: 'sm' });
  body.push({ type: 'separator', margin: 'lg', color: '#e3e8f2' });
  body.push({ type: 'text', text: 'รหัส: ' + reg.reg_id, size: 'xxs', align: 'center', color: '#9aa6bd', margin: 'md' });

  return {
    type: 'flex',
    altText: 'บัตรลงทะเบียน ' + eventName,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: primary, paddingAll: '16px', spacing: 'xs',
        contents: [
          { type: 'text', text: eventName, color: '#ffffff', weight: 'bold', size: 'lg', align: 'center', wrap: true },
          { type: 'text', text: 'บัตรลงทะเบียนเข้างาน', color: accent, size: 'xs', align: 'center' }
        ]
      },
      hero: { type: 'image', url: qrUrl, size: 'full', aspectRatio: '1:1', aspectMode: 'fit', backgroundColor: '#ffffff' },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: {
        type: 'box', layout: 'vertical', backgroundColor: '#f4f6fb', paddingAll: '12px',
        contents: [{ type: 'text', text: 'แสดงบัตรนี้ที่จุดลงทะเบียน', size: 'xs', color: '#5b6b86', align: 'center', wrap: true }]
      },
      styles: { footer: { separator: true } }
    }
  };
}

// ============================================================
//  ฟังก์ชันทดสอบ (รันจาก editor — ดูผลที่เมนู Executions / Logs)
// ============================================================
function testPing() { Logger.log(getPublicSettings_()); }

function testLineToMe() {
  var uid = 'Uebbfa9ffd9a018650b95b39b175da80c'; // userId ของ "ยุ่น" จากหน้า test

  Logger.log('1) LINE_TOKEN ตั้งไว้ไหม: ' + (token_() ? 'ใช่ (ยาว ' + token_().length + ' ตัว)' : '❌ ยังไม่ได้ตั้ง'));

  var t = sendLineText_(uid, 'ทดสอบข้อความธรรมดา ✅');
  Logger.log('2) ผลส่งข้อความธรรมดา: ' + JSON.stringify(t));

  var reg = { reg_id: 'TEST123', first_name: 'จักรกริช', last_name: 'เลิศวิทยารัตน์', nickname: 'ยุ่น', generation: '44' };
  var f = pushLine_(uid, [ buildRegFlex_(reg) ]);
  Logger.log('3) ผลส่ง Flex card: ' + JSON.stringify(f));
}
