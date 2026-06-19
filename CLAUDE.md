# CLAUDE.md — Event LINE OA System

## โปรเจคนี้คืออะไร

ระบบจัดการงานอีเวนต์ผ่าน LINE OA ประกอบด้วย:
- ลงทะเบียนเข้างาน (LIFF)
- ร้านค้า / ชำระเงิน PromptPay
- สแกน QR เช็คอิน (staff)
- วงล้อจับรางวัล (admin remote + display)
- จัดการสินค้า / คำสั่งซื้อ / settings (admin)

## Architecture

```
Frontend (static HTML/JS)  ←→  Google Apps Script (Code.gs)  ←→  Google Sheet + Drive
LINE LIFF                       Web App /exec endpoint              ข้อมูลทั้งหมด
```

**ไม่มี Node.js / build step** — ทุกไฟล์เป็น plain HTML+JS โหลดจาก GitHub Pages หรือ CDN โดยตรง

## ไฟล์หลัก

| ไฟล์ | หน้าที่ |
|------|---------|
| `api.js` | shared JS — CONFIG, API object, LIFF, storage, theme, utils |
| `config.js` | override CONFIG (LIFF_ID, API_URL) — โหลดก่อน api.js |
| `Code.gs` | Google Apps Script backend — router + ฟังก์ชันทั้งหมด |
| `theme.css` | global CSS variables + utility classes |
| `registrations.html` | หน้าลงทะเบียน (LIFF required) |
| `shop.html` | ร้านค้า + ชำระเงิน |
| `staff/index.html` | staff login + เมนู |
| `staff/scan.html` | สแกน QR + เช็คอิน |
| `admin/remote.html` | รีโมทจับรางวัล |
| `admin/rewards.html` | จอวงล้อ (display screen) |
| `admin/orders.html` | จัดการคำสั่งซื้อ |
| `admin/products.html` | จัดการสินค้า |
| `admin/settings.html` | ตั้งค่าระบบ |

## API Object (api.js)

`api.js` export ทุกอย่างผ่าน global `API` object:

```js
// Core HTTP
API.get(action, params)
API.post(action, data)
API.getAuth(action, params, token)   // redirect ไป postAuth (token ไม่ติด URL)
API.postAuth(action, data, token)    // ถ้าไม่ส่ง token จะใช้ localStorage 'access-code'

// Shared functions (ทุกหน้าเรียกผ่าน API.xxx ได้)
API.liffInit(silentFail)
API.getProfile()
API.bootTheme()          // โหลด settings + apply theme + เติม data-event-name
API.qs(selector)         // document.querySelector
API.qsa(selector)        // document.querySelectorAll
API.toast(msg, type)     // type: 'success' | 'error' | 'warning' | 'info'
API.setKey(key, value)   // localStorage
API.getKey(key)
API.clearKey(key)
API.setSession(data)     // sessionStorage 'staff-session'
API.getSession()
API.clearSession()
API.fmtBaht(amount)
API.driveImg(fileId, size)
API.driveImgWithFallback(el, fileId, size)  // เซต el.src + ลอง URL อื่นอัตโนมัติถ้า thumbnail format โดน rate-limit/บล็อก (thumbnail → lh3.googleusercontent.com → uc?export=view)
API.fieldOn(settings, key)
```

> **รูป Google Drive โหลดไม่ขึ้น:** ใช้ `API.driveImgWithFallback(el, fileId)` แทน `API.driveImg()` ตรงๆ ทุกครั้งที่เซต `<img>.src` — endpoint `/thumbnail` ของ Drive ไม่รองรับการฮอตลิงก์อย่างเป็นทางการ บางครั้งโหลดไม่ขึ้นในเบราว์เซอร์จริงทั้งที่ลิงก์เข้าถึงได้ปกติ (ทดสอบด้วย curl ผ่าน)

## Response Pattern

ทุก API response คืน `{ ok: true, ... }` หรือ `{ ok: false, error: '...' }` — `fetchJSON_()` ใน api.js throw Error อัตโนมัติถ้า `ok: false`

**การ unwrap data:**
```js
// ถูก
const res = await API.get('getProducts');
const products = res.products || [];

// ผิด — res คือ {ok, products:[]} ไม่ใช่ array
const products = await API.get('getProducts');
```

## Auth / Token

- **Admin token** เก็บใน localStorage key `'admin-token'` หรือ `'access-code'`
- **Staff access code** เก็บใน `'access-code'`
- `API.postAuth` ถ้าไม่ส่ง token จะ fallback ไป `getKey('access-code')` อัตโนมัติ
- **ADMIN_KEY** ตั้งใน Script Properties ของ Apps Script (ไม่ได้อยู่ใน code)

## Code.gs — Actions สำคัญ

### Public (ไม่ต้องมี key)
- `getSettings` — public settings (ซ่อน PIN)
- `getProducts`, `getRewards`, `getRegistration`
- `register`, `createOrder`, `uploadSlip`, `uploadBanner`, `uploadLogo`, `uploadProductImg`, `staffLogin`, `verifyPin`
- `getWheelState`, `getWheelPool`

### Staff/Admin (ต้องมี admin_key)
- `getAdminSettings` — settings ทั้งหมดรวม PIN
- `getRegistrations`, `getOrders`, `getWinners`
- `checkin`, `searchByPhone`
- `verifyOrder` — รับ `status: 'verified'` หรือ `'rejected'`
- `prepare` — โหลดรายชื่อขึ้นจอวงล้อ (ยังไม่เลือกผู้ชนะ)
- `spinPhysics` — สุ่มผู้ชนะ, คืน `landingIndex` + `power`
- `requestSpin` — one-shot spin (legacy)
- `resetWheel`, `updateSettings`, `saveProduct`, `saveReward`, `saveStaff`

## Wheel Flow (2 ขั้นตอน)

1. **admin/remote.html** กด "เตรียมวงล้อ" → `prepare` → state = `'ready'` + pool
2. กดค้างปุ่มแดง → `spinPhysics { power }` → state = `'spinning'` + `landingIndex`
3. **admin/rewards.html** poll `getWheelState` ทุก 1.5 วิ → รับ state → หมุนวงล้อไปที่ `landingIndex`

## Google Sheet Structure

Sheet tabs: `registrations`, `orders`, `products`, `rewards`, `winners`, `staff`, `settings`

`settings` tab: รูปแบบ key/value (col A = key, col B = value) — ไม่มี header

## Script Properties ที่ต้องตั้ง

```
LINE_TOKEN  = Channel Access Token ของ LINE OA
ADMIN_KEY   = รหัสลับ (ตั้งเองได้) — ถ้าไม่ตั้ง = dev mode (ทุก request ผ่าน!)
```

## Deploy Code.gs

1. Apps Script → Deploy → New deployment → Web app
2. Execute as: **Me** | Who has access: **Anyone**
3. Copy URL `/exec` → แก้ `API_URL` ใน `api.js` (และ `config.js`)

## สิ่งที่ไม่ควรทำ

- **ห้ามใส่ API key ใดๆ ใน client-side JS** — ให้ทำฝั่ง Apps Script แทน
- **ห้าม hardcode ADMIN_KEY ใน code** — ใช้ Script Properties เสมอ
- **ห้ามส่ง token ผ่าน GET URL** — ใช้ `postAuth` เสมอ
- **อย่าลืม unwrap response** — `res.products`, `res.settings`, `res.orders` ฯลฯ
- **อย่าเรียกฟังก์ชันใน api.js โดยไม่มี `API.` prefix** ยกเว้นหน้าที่ไม่ได้ใช้ namespace (เช่น shop.html บางส่วน)

## CSS Variables หลัก (theme.css)

```css
--color-primary: #0d2b5e  /* น้ำเงินเข้ม */
--color-accent:  #f0c040  /* ทอง */
--navy-grad: linear-gradient(135deg, #0d2b5e, #1a3d7a)
--gold-grad: linear-gradient(135deg, #f0c040, #e8b535)
--navy:      #0d2b5e   /* alias */
--gold:      #f0c040   /* alias */
```
