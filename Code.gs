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
const SLIP_FOLDER_ID        = '15UDvwjf-3J4bBZeRihtodgNgL2sPGxMF'; // โฟลเดอร์เก็บสลิปชำระเงิน
const PRODUCT_IMG_FOLDER_ID = '1ovjadtqJPx9nkw4sCEQ9gRhmYsnu3Znv'; // โฟลเดอร์เก็บรูปสินค้า
const BANNER_FOLDER_ID      = '15Wl9uB-a9g7-vb5rtutGSi9b3fXlSr_c'; // โฟลเดอร์เก็บ Banner ร้านค้า
const LINE_PUSH_URL  = 'https://api.line.me/v2/bot/message/push';

// ---- ตัวช่วยพื้นฐาน ----
function props_()  { return PropertiesService.getScriptProperties(); }
function token_()  { return props_().getProperty('LINE_TOKEN'); }
function ss_()     { return SpreadsheetApp.openById(SHEET_ID); }

// รันครั้งเดียวจาก Script Editor เพื่อ authorize DriveApp + Sheets
function authorizeAll() {
  SpreadsheetApp.openById(SHEET_ID);
  DriveApp.getRootFolder();
  Logger.log('✅ Authorization granted for Drive + Sheets');
}
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
    case 'getProducts':     return { ok: true, products: getRows_('products').map(normalizeProduct_) };
    case 'getRewards':      return { ok: true, rewards: getRows_('rewards') };
    case 'getRegistration': return getRegistration_(p);

    // ---------- public writes ----------
    case 'register':     return register_(p);
    case 'createOrder':  return createOrder_(p);
    case 'uploadSlip':   return uploadSlip_(p);
    case 'ocrSlip':      return ocrSlip_(p);
    case 'uploadProductImg': return uploadProductImg_(p);
    case 'uploadBanner': return uploadBanner_(p);
    case 'getLocationData': return getLocationData_();
    case 'applyDiscount': return applyDiscount_(p);
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
    case 'verifyOrder':        requireKey_(p); return verifyOrder_(p);
    case 'updateOrderAddress': requireKey_(p); return updateOrderAddress_(p);
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
  if (!sh) return [];
  var last = sh.getLastColumn();
  if (last === 0) return [];
  return sh.getRange(1, 1, 1, last).getValues()[0].map(String);
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
  if (!sh) throw new Error('Sheet not found: ' + name);
  var headers = getHeaders_(name);
  var row = headers.map(function (h) { return obj.hasOwnProperty(h) ? obj[h] : ''; });
  sh.appendRow(row);
}

function findRow_(name, col, val) {
  var sh = sheet_(name);
  if (!sh) return null;
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
    district: p.district || '',
    subdistrict: p.subdistrict || '',
    postal_code: p.postal_code || '',
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
  var reg = rowObj_('registrations', rowNum);
  // ส่ง LINE แจ้งผู้เข้างานว่าเช็คอินสำเร็จ (เฉพาะครั้งแรก)
  if (!already && reg.line_user_id) {
    var name = String(reg.nickname || reg.first_name || '');
    var timeStr = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'HH:mm น.');
    var ciMsg = '✅ เช็คอินสำเร็จ!' +
      (name ? '\nสวัสดี ' + name + '!' : '') +
      '\n🕐 เวลาเข้างาน: ' + timeStr +
      '\n\nขอให้สนุกกับงาน 🎉';
    sendLineText_(reg.line_user_id, ciMsg);
  }
  return { ok: true, already_checked_in: already, registration: reg };
}

// ============================================================
//  PRODUCTS / ORDERS
// ============================================================
// normalize product row จาก sheet → JS object
function normalizeProduct_(p) {
  // img_url N (มีเว้นวรรค) → img_urlN
  for (var i = 1; i <= 5; i++) {
    var spaced = 'img_url ' + i;
    var compact = 'img_url' + i;
    if (!p[compact] && p[spaced]) p[compact] = String(p[spaced]);
  }
  if (!p.img_url1 && p.img_url) p.img_url1 = String(p.img_url);

  // parse variants JSON string → array
  if (typeof p.variants === 'string') {
    try { p.variants = JSON.parse(p.variants); } catch (e) { p.variants = []; }
  }
  if (!Array.isArray(p.variants)) p.variants = [];

  // parse Image options column → imageOptions object { "color::size": fileId }
  var rawImgOpt = p['Image options'] || '';
  if (typeof rawImgOpt === 'string' && rawImgOpt) {
    try { p.imageOptions = JSON.parse(rawImgOpt); } catch (e) { p.imageOptions = {}; }
  } else {
    p.imageOptions = {};
  }

  // คำนวณ summary สำหรับ frontend
  if (p.variants.length > 0) {
    var prices = p.variants.map(function(v){ return Number(v.sellPrice) || 0; }).filter(Boolean);
    p.minPrice   = prices.length ? Math.min.apply(null, prices) : 0;
    p.maxPrice   = prices.length ? Math.max.apply(null, prices) : 0;
    p.totalStock = p.variants.reduce(function(s,v){ return s + (Number(v.stock)||0); }, 0);
  } else {
    // backward-compat: สินค้าเก่า (ก่อน variants)
    p.minPrice = p.maxPrice = Number(p.price) || 0;
    p.totalStock = Number(p.stock) || 0;
  }
  return p;
}

function saveProduct_(p) {
  var prod = p.product || p;

  // auto-gen SKU ให้ variant ที่ยังไม่มี
  var variants = Array.isArray(prod.variants) ? prod.variants : [];
  var safeId = String(prod.id || '').replace(/\s/g,'') || ('P' + Date.now().toString(36).toUpperCase());
  variants.forEach(function(v, i) {
    if (!v.sku) {
      v.sku = (safeId + '-' + (v.color||'').replace(/\s/g,'') + '-' + (v.size||'').replace(/\s/g,'') + '-' + i)
              .toUpperCase().replace(/-+$/,'');
    }
  });
  var variantsVal = JSON.stringify(variants);

  var rowNum = prod.id ? findRow_('products', 'id', prod.id) : null;
  if (!rowNum) {
    // new product — auto-generate ID
    var rows = getRows_('products');
    if (!prod.id) {
      var maxNum = rows.reduce(function(mx,r){
        var n = parseInt(String(r.id||'').replace(/\D/g,''),10)||0; return Math.max(mx,n);
      }, 0);
      prod.id = 'P' + String(maxNum + 1).padStart(3,'0');
    }
    appendByHeaders_('products', {
      id: prod.id,
      name: prod.name || '',
      category: prod.category || '',
      description: prod.description || '',
      'img_url 1': prod.img_url1 || prod.img_url || '',
      'img_url 2': prod.img_url2 || '',
      'img_url 3': prod.img_url3 || '',
      'img_url 4': prod.img_url4 || '',
      'img_url 5': prod.img_url5 || '',
      variants: variantsVal,
      'Image options': JSON.stringify(prod.imageOptions || {}),
      shipping_cost: prod.shipping_cost || 0
    });
  } else {
    var sh = sheet_('products'); var h = getHeaders_('products');
    var fieldMap = [
      { col: 'name',        key: 'name' },
      { col: 'category',    key: 'category' },
      { col: 'description', key: 'description' },
      { col: 'img_url 1',   key: 'img_url1' },
      { col: 'img_url 2',   key: 'img_url2' },
      { col: 'img_url 3',   key: 'img_url3' },
      { col: 'img_url 4',   key: 'img_url4' },
      { col: 'img_url 5',   key: 'img_url5' },
      { col: 'shipping_cost', key: 'shipping_cost' }
    ];
    fieldMap.forEach(function(f) {
      var idx = h.indexOf(f.col);
      if (idx >= 0 && prod[f.key] !== undefined) sh.getRange(rowNum, idx+1).setValue(prod[f.key]);
    });
    var vIdx = h.indexOf('variants');
    if (vIdx >= 0) sh.getRange(rowNum, vIdx+1).setValue(variantsVal);
    var imgOptIdx = h.indexOf('Image options');
    if (imgOptIdx >= 0) sh.getRange(rowNum, imgOptIdx+1).setValue(JSON.stringify(prod.imageOptions || {}));
  }
  return { ok: true, id: prod.id };
}

function createOrder_(p) {
  var order_id = 'O' + Date.now().toString(36).toUpperCase();
  var itemsStr = (typeof p.items === 'string') ? p.items : JSON.stringify(p.items || []);
  var discountPercent = Number(p.discount_percent || 0);
  var discountCode = String(p.discount_code || '');
  appendByHeaders_('orders', {
    order_id: order_id,
    line_user_id: p.line_user_id || '',
    customer_name: p.customer_name || '',
    phone: p.phone || '',
    address: p.address || '',
    items: itemsStr,
    total_amount: p.total_amount || 0,
    discount_code: discountCode,
    discount_percent: discountPercent || '',
    slip_url: p.slip_url || '',
    status: 'pending',
    created_at: new Date(),
    verified_at: '',
    verified_by: ''
  });

  // ส่งสรุปคำสั่งซื้อไปใน LINE chat
  var lineOk = true;
  if (p.line_user_id) {
    var items = [];
    try { items = JSON.parse(itemsStr); } catch(e) {}
    var subtotal = items.reduce(function(s, i) { return s + Number(i.price) * Number(i.qty); }, 0);
    var total = Number(p.total_amount) || 0;
    var itemsText = items.map(function(i) {
      var v = [i.color, i.size].filter(Boolean).join('/');
      return '• ' + i.name + (v ? ' (' + v + ')' : '') + ' ×' + i.qty + ' = ฿' + (Number(i.price) * Number(i.qty)).toLocaleString('th-TH');
    }).join('\n');
    var discountLine = '';
    if (discountPercent > 0 && subtotal !== total) {
      discountLine = '\n🏷️ ส่วนลด ' + discountPercent + '%: -฿' + (subtotal - total).toLocaleString('th-TH');
    }
    var addressLine = p.address ? '\n📍 ที่อยู่: ' + p.address : '';
    var msg = '🛍️ ได้รับคำสั่งซื้อแล้ว!\n\n' +
              '📋 เลขที่: ' + order_id + '\n' +
              '👤 ชื่อ: ' + (p.customer_name || '') + '\n' +
              '📞 โทร: ' + (p.phone || '') +
              addressLine + '\n\n' +
              itemsText +
              discountLine + '\n\n' +
              '💰 รวม: ฿' + total.toLocaleString('th-TH') + '\n\n' +
              '⏳ โปรดรอการยืนยันจากแอดมินตอบกลับ';
    var lineResult = sendLineText_(p.line_user_id, msg);
    lineOk = lineResult.ok;
  }

  // ถ้าส่ง LINE ไม่สำเร็จ ตั้ง status เป็น 'ยืนยันไม่สำเร็จ'
  if (!lineOk) {
    var failRow = findRow_('orders', 'order_id', order_id);
    if (failRow) {
      var failSh = sheet_('orders'); var failH = getHeaders_('orders');
      var sIdx = failH.indexOf('status');
      if (sIdx >= 0) failSh.getRange(failRow, sIdx + 1).setValue('ยืนยันไม่สำเร็จ');
    }
    return { ok: true, order_id: order_id, line_error: true };
  }

  return { ok: true, order_id: order_id };
}

function updateOrderAddress_(p) {
  var rowNum = findRow_('orders', 'order_id', p.order_id);
  if (!rowNum) return { ok: false, error: 'order not found' };
  var sh = sheet_('orders'); var h = getHeaders_('orders');
  var col = h.indexOf('address');
  if (col < 0) return { ok: false, error: 'no address column in orders sheet' };
  sh.getRange(rowNum, col + 1).setValue(p.address || '');
  return { ok: true };
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
    var items = [];
    try { items = JSON.parse(o.items || '[]'); } catch(e) {}
    var itemsText = items.map(function(i) {
      var v = [i.color, i.size].filter(Boolean).join('/');
      return '• ' + i.name + (v ? ' (' + v + ')' : '') + ' ×' + i.qty;
    }).join('\n');
    var msg;
    if (status === 'rejected') {
      msg = '❌ คำสั่งซื้อไม่ผ่านการตรวจสอบ\n' +
            '📋 เลขที่: ' + o.order_id + '\n\n' +
            itemsText +
            '\n\nกรุณาติดต่อเจ้าหน้าที่เพื่อดำเนินการต่อ';
    } else {
      msg = '✅ ยืนยันคำสั่งซื้อแล้ว!\n' +
            '📋 เลขที่: ' + o.order_id + '\n\n' +
            itemsText +
            '\n\n📦 กำลังจัดเตรียมสินค้า\nขอบคุณที่ไว้วางใจ!';
    }
    sendLineText_(o.line_user_id, msg);
  }
  return { ok: true };
}

// OCR สลิป PromptPay โดยใช้ Typhoon Vision API
// ตั้ง Script Property: TYPHOON_API_KEY = <your key from opentyphoon.ai>
function ocrSlip_(p) {
  var apiKey = props_().getProperty('TYPHOON_API_KEY');
  if (!apiKey) return { ok: true, success: false, error: 'TYPHOON_API_KEY not set — กรุณากรอกยอดด้วยตัวเอง' };
  var imageBase64 = p.imageBase64 || '';
  if (!imageBase64) return { ok: true, success: false, error: 'missing imageBase64' };

  try {
    var payload = {
      model: 'typhoon-v2-vision-instruct',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + imageBase64 } },
          { type: 'text', text: 'นี่คือสลิปโอนเงิน PromptPay กรุณาระบุยอดเงินที่โอนเป็นตัวเลขเท่านั้น ไม่มีคำอธิบาย ไม่มีสกุลเงิน เช่น 1500.00' }
        ]
      }],
      max_tokens: 30,
      temperature: 0
    };
    var res = UrlFetchApp.fetch('https://api.opentyphoon.ai/v1/chat/completions', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var result = JSON.parse(res.getContentText());
    if (result.choices && result.choices[0]) {
      var text = result.choices[0].message.content.trim();
      var amount = parseFloat(text.replace(/[^0-9.]/g, ''));
      if (!isNaN(amount) && amount > 0) return { ok: true, success: true, amount: amount };
    }
    return { ok: true, success: false, error: 'อ่านยอดไม่ได้' };
  } catch(e) {
    return { ok: true, success: false, error: e.message };
  }
}

// อัปโหลดสลิปชำระเงิน → SLIP_FOLDER_ID
function uploadSlip_(p) {
  return uploadToFolder_(p, SLIP_FOLDER_ID);
}

// อัปโหลดรูปสินค้า → PRODUCT_IMG_FOLDER_ID
function uploadProductImg_(p) {
  return uploadToFolder_(p, PRODUCT_IMG_FOLDER_ID);
}

// อัปโหลด Banner ร้านค้า → BANNER_FOLDER_ID
function uploadBanner_(p) {
  return uploadToFolder_(p, BANNER_FOLDER_ID);
}

function uploadToFolder_(p, folderId) {
  var m = String(p.dataUrl || '').match(/^data:(.+);base64,(.*)$/);
  if (!m) return { ok: false, error: 'bad dataUrl' };
  var folder = DriveApp.getFolderById(folderId);
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], p.filename || ('file_' + Date.now()));
  var file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return { ok: true, id: file.getId(), url: 'https://drive.google.com/uc?export=view&id=' + file.getId() };
}

// ดึงข้อมูลจังหวัด/อำเภอ/ตำบล จาก sheet tab ที่มี gid=177526447
function getLocationData_() {
  var sheets = ss_().getSheets();
  var locSheet = null;
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === 177526447) { locSheet = sheets[i]; break; }
  }
  if (!locSheet) return { ok: false, error: 'location sheet not found (gid=177526447)' };

  var values = locSheet.getDataRange().getValues();
  if (values.length < 2) return { ok: true, data: [] };

  var rawHeaders = values[0].map(function(h) { return String(h).trim(); });
  var colMap = {};
  var aliases = {
    province:    ['province','จังหวัด','Province','PROVINCE'],
    district:    ['district','อำเภอ','อำเภอ/เขต','District','DISTRICT'],
    subdistrict: ['subdistrict','ตำบล','ตำบล/แขวง','Subdistrict','SUBDISTRICT'],
    postal_code: ['postal_code','รหัสไปรษณีย์','zipcode','zip','Postal Code','postal code','ZIP']
  };
  rawHeaders.forEach(function(h, i) {
    Object.keys(aliases).forEach(function(key) {
      if (aliases[key].indexOf(h) >= 0) colMap[key] = i;
    });
  });

  // ถ้าหาไม่พบด้วย aliases ให้ลองใช้ตำแหน่ง col 0-3
  if (Object.keys(colMap).length < 4) {
    if (!colMap.province)    colMap.province    = 0;
    if (!colMap.district)    colMap.district    = 1;
    if (!colMap.subdistrict) colMap.subdistrict = 2;
    if (!colMap.postal_code) colMap.postal_code = 3;
  }

  var data = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (row.join('') === '') continue;
    data.push({
      province:    String(row[colMap.province]    || '').trim(),
      district:    String(row[colMap.district]    || '').trim(),
      subdistrict: String(row[colMap.subdistrict] || '').trim(),
      postal_code: String(row[colMap.postal_code] || '').trim()
    });
  }
  return { ok: true, data: data };
}

// ตรวจสอบรหัสส่วนลด
function applyDiscount_(p) {
  var m = getSettingsMap_();
  var code = String(m.discount_code || '').trim();
  if (!code) return { ok: true, valid: false };
  if (String(p.code || '').trim() === code) {
    return { ok: true, valid: true, discount_percent: Number(m.discount_percent || 0) };
  }
  return { ok: true, valid: false };
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
    eligible_count: pool.length,
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
    eligible_count: pool.length,
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
    eligible_count: pool.length,
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

  var liffUrl = String(m.liff_url || '');
  var footerContents = [
    { type: 'text', text: 'แสดงบัตรนี้ที่จุดลงทะเบียน', size: 'xs', color: '#5b6b86', align: 'center', wrap: true }
  ];
  if (liffUrl) {
    footerContents.push({
      type: 'button',
      action: { type: 'uri', label: '📱 เปิดบัตรในแอป', uri: liffUrl },
      style: 'primary', color: primary, margin: 'md', height: 'sm'
    });
  }

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
        contents: footerContents
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

// ---- เพิ่มคอลัมน์ที่ขาดใน orders sheet (รันครั้งเดียวจาก Script Editor) ----
function setupOrdersColumns_() {
  var sh = sheet_('orders');
  if (!sh) { Logger.log('❌ orders sheet not found'); return; }
  var needed = ['line_user_id', 'address', 'discount_code', 'discount_percent'];
  var added = [];
  needed.forEach(function(col) {
    var headers = getHeaders_('orders'); // refresh each time
    if (headers.indexOf(col) < 0) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue(col);
      added.push(col);
      Logger.log('✅ เพิ่มคอลัมน์: ' + col);
    } else {
      Logger.log('— มีอยู่แล้ว: ' + col);
    }
  });
  Logger.log('setupOrdersColumns เสร็จสิ้น — เพิ่ม: [' + added.join(', ') + ']');
}

// ---- ตรวจสอบ Script Properties (ADMIN_KEY / LINE_TOKEN) ----
function testConfig() {
  var key = props_().getProperty('ADMIN_KEY');
  Logger.log(key
    ? '✅ ADMIN_KEY ตั้งไว้แล้ว (ยาว ' + key.length + ' ตัว)'
    : '⚠️  ADMIN_KEY ยังไม่ได้ตั้ง → dev mode (ทุก request ผ่าน)');

  var tk = token_();
  Logger.log(tk
    ? '✅ LINE_TOKEN ตั้งไว้แล้ว (ยาว ' + tk.length + ' ตัว)'
    : '⚠️  LINE_TOKEN ยังไม่ได้ตั้ง → ส่ง LINE ไม่ได้');

  Logger.log('SHEET_ID: ' + SHEET_ID);
  Logger.log('SLIP_FOLDER_ID: ' + SLIP_FOLDER_ID);
}

// ---- ตรวจสอบว่า Sheet tabs ครบและ header ถูกต้อง ----
function testSheets() {
  var required = ['registrations','orders','products','rewards','winners','staff','settings'];
  required.forEach(function (name) {
    var sh = sheet_(name);
    if (!sh) {
      Logger.log('❌ ไม่พบ sheet: "' + name + '" — ตรวจสอบชื่อ tab ใน Google Sheet');
    } else {
      var h = getHeaders_(name);
      Logger.log('✅ ' + name + ' (' + h.length + ' cols): ' + h.join(' | '));
    }
  });
}

// ---- ตรวจสอบ DriveApp + ทั้ง 2 folders ----
function testDriveUpload() {
  var tests = [
    { label: 'SLIP_FOLDER_ID (สลิปชำระเงิน)', id: SLIP_FOLDER_ID },
    { label: 'PRODUCT_IMG_FOLDER_ID (รูปสินค้า)', id: PRODUCT_IMG_FOLDER_ID }
  ];
  tests.forEach(function (t) {
    try {
      var folder = DriveApp.getFolderById(t.id);
      var blob = Utilities.newBlob('test', 'text/plain', 'test_' + Date.now() + '.txt');
      var file = folder.createFile(blob);
      file.setTrashed(true);
      Logger.log('✅ ' + t.label + ' → "' + folder.getName() + '" — OK');
    } catch (e) {
      Logger.log('❌ ' + t.label + ' → ' + e.message);
    }
  });
}

// ---- ตรวจสอบ getProducts + options ----
function testGetProducts() {
  var products = getRows_('products').map(normalizeProduct_);
  Logger.log('จำนวนสินค้า: ' + products.length);
  products.forEach(function (p) {
    Logger.log('  [' + p.id + '] ' + p.name + ' ราคา:' + p.price + ' ตัวเลือก:' + (p.options || '-'));
  });
}

// ---- ทดสอบ saveProduct (เพิ่ม → ตรวจสอบ → ลบ) ----
function testSaveProduct() {
  var testId = 'TEST_' + Date.now();
  var r = saveProduct_({
    id: testId,
    name: 'สินค้าทดสอบ (จะถูกลบ)',
    category: 'เสื้อ',
    description: 'auto test',
    img_url1: '', img_url2: '', img_url3: '', img_url4: '', img_url5: '',
    variants: [
      { color: 'ดำ', size: 'S', costPrice: 250, sellPrice: 300, stock: 5 },
      { color: 'ดำ', size: 'M', costPrice: 250, sellPrice: 300, stock: 8 }
    ]
  });
  Logger.log('saveProduct result: ' + JSON.stringify(r));

  var row = findRow_('products', 'id', testId);
  Logger.log(row ? '✅ บันทึกสำเร็จ — อยู่ที่แถว ' + row : '❌ ไม่พบแถวหลังบันทึก');

  if (row) {
    sheet_('products').deleteRow(row);
    Logger.log('✅ ลบ test record เรียบร้อย');
  }
}

// ---- ตรวจสอบ getOrders / getRegistrations ----
function testGetOrders() {
  var orders = getRows_('orders');
  Logger.log('จำนวน orders: ' + orders.length);
  if (orders.length > 0) Logger.log('order ล่าสุด: ' + JSON.stringify(orders[orders.length - 1]));
}

function testGetRegistrations() {
  var regs = getRows_('registrations');
  Logger.log('จำนวน registrations: ' + regs.length);
  if (regs.length > 0) Logger.log('registration ล่าสุด: ' + JSON.stringify(regs[regs.length - 1]));
}

// ---- รันทุก test พร้อมกัน ----
function testAll() {
  Logger.log('========== testConfig ==========');
  testConfig();
  Logger.log('========== testSheets ==========');
  testSheets();
  Logger.log('========== testDriveUpload ==========');
  testDriveUpload();
  Logger.log('========== testGetProducts ==========');
  testGetProducts();
  Logger.log('========== testSaveProduct ==========');
  testSaveProduct();
  Logger.log('========== testGetOrders ==========');
  testGetOrders();
  Logger.log('========== testGetRegistrations ==========');
  testGetRegistrations();
  Logger.log('========== DONE ==========');
}
