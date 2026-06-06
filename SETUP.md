# EVENT LINE OA — คู่มือติดตั้ง (เฟส 1: วางฐาน)

ระบบลงทะเบียนเข้างาน + ร้านค้า + วงล้อจับรางวัล บน LINE OA
(LIFF + GitHub Pages ฝั่งหน้าเว็บ / Google Sheets + Apps Script ฝั่งหลังบ้าน)

## โครงสร้าง repo ที่แนะนำ

```
Event/
├─ index.html            (ภายหลัง = หน้าเลือกเมนู หรือ redirect)
├─ registrations.html    (เฟส 2)
├─ shop.html             (เฟส 5)
├─ staff/
│   ├─ index.html        (เฟส 3)
│   └─ scan.html
├─ admin/
│   ├─ rewards.html      (จอวงล้อ — เฟส 4)
│   ├─ remote.html       (รีโมท — เฟส 4)
│   ├─ settings.html     (เฟส 6)
│   ├─ products.html
│   ├─ staff.html
│   └─ rewards-manage.html
├─ assets/
│   ├─ theme.css   ←
│   ├─ config.js   ←
│   └─ api.js      ←
├─ test.html       ←  (หน้าตรวจสอบฐาน — เฟสนี้)
└─ Code.gs         ←  (อยู่ในโปรเจกต์ Apps Script ไม่ใช่ repo ก็ได้)
```
> ไฟล์ที่ส่งมาเฟสนี้: `Code.gs`, `config.js`, `api.js`, `theme.css`, `test.html`
> (ใน test.html อ้าง path แบบเดียวกัน ถ้าย้าย css/js ไป `assets/` ให้แก้ `<link>`/`<script src>` ตาม)

---

## ขั้นตอนติดตั้ง

### 1) Backend (Apps Script)
1. เปิด Google Sheet → Extensions → Apps Script
2. วางเนื้อหา `Code.gs` ทับโค้ดเดิม
3. ตั้งค่า **Project Settings → Script properties** เพิ่ม 2 ตัว:
   - `LINE_TOKEN` = Channel Access Token ของ LINE OA
   - `ADMIN_KEY`  = รหัสลับอะไรก็ได้ (เช่นสตริงสุ่มยาว ๆ) สำหรับหน้า staff/admin
4. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. คัดลอก URL ที่ลงท้าย `/exec`

> ถ้า URL ใหม่ไม่ตรงกับที่ให้มา ให้เอา URL ใหม่ไปใส่ใน `config.js → API_URL`

### 2) Frontend (GitHub Pages)
1. push `config.js`, `api.js`, `theme.css`, `test.html` ขึ้น repo `Event`
2. แก้ `config.js`:
   - `API_URL` = URL /exec จากข้อ 1
   - `ADMIN_KEY` = ค่าเดียวกับ Script Property (เว้นว่างไว้ก่อนได้ ระหว่างเทสต์)
3. เปิด GitHub Pages: Settings → Pages → Branch `main` /(root)
4. ได้ URL เช่น `https://hongthayban-dev.github.io/Event/`

### 3) LIFF
1. LINE Developers → LIFF (ID `2010308553-ubIy665f`)
2. ตั้ง **Endpoint URL** = `https://hongthayban-dev.github.io/Event/test.html` (ระหว่างเทสต์)
   - ภายหลังเปลี่ยนเป็นหน้า registrations หรือทำหลาย LIFF แยกตามเมนู
3. Scope ต้องมี `profile` (เพื่อดึง userId/ชื่อ)

### 4) ทดสอบ
เปิด LIFF (จากในแอป LINE) ที่ชี้มา `test.html` ควรเห็น ✅ ครบ:
LIFF init / โปรไฟล์ / เชื่อม backend / settings+ธีม / สินค้า / รางวัล

---

## ⚠️ หมายเหตุความปลอดภัย (อ่านก่อน)
1. **LINE Token เดิมที่เคยแปะมาในแชต ควร reissue ใหม่** แล้วใส่ค่าใหม่ใน Script Property `LINE_TOKEN` — Token ห้ามอยู่ในโค้ดฝั่งหน้าเว็บเด็ดขาด
2. Web app เปิดเป็น "Anyone" → ใครมี /exec URL ยิง action ได้ จึงกัน action ที่อ่าน/แก้ข้อมูลสำคัญด้วย `ADMIN_KEY`
   - แต่ `ADMIN_KEY` ฝังในหน้าเว็บก็ยังมองเห็นได้จาก client → เป็นการกัน "คนทั่วไป" เท่านั้น ไม่ใช่ระบบ auth เต็มรูปแบบ
   - ถ้าต้องการแน่นหนากว่านี้ (session token หลัง login) ทำเพิ่มได้ในเฟสหลัง บอกได้เลย
3. รหัสผ่าน staff ตอนนี้เก็บเป็น plaintext ตามที่มีในชีต (`admin/admin123`) — เพียงพอสำหรับงานอีเวนต์ระยะสั้น ถ้าจะ hash บอกได้ จะปรับให้

---

## actions ที่ backend รองรับแล้ว (เฟสถัดไปเรียกใช้ได้เลย)
- public: `ping`, `getSettings`, `getProducts`, `getRewards`, `getRegistration`, `register`, `createOrder`, `uploadSlip`, `staffLogin`, `verifyPin`, `getWheelState`
- ต้องมี key: `searchByPhone`, `checkin`, `getRegistrations`, `getWinners`, `getOrders`, `getStaff`, `getEligible`, `requestSpin`, `resetWheel`, `verifyOrder`, `updateSettings`, `saveProduct`/`deleteProduct`, `saveStaff`/`deleteStaff`, `saveReward`/`deleteReward`
