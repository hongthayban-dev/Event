# 📦 GitHub Update Instructions

## ไฟล์ที่ต้อง Update ใน Repo

### 1. ไฟล์ต้นฉบับ (Replace เลย)

```bash
# Copy ไฟล์เหล่านี้ลงใน repo folder หลัก
api.js              # ← แก้ไข: LIFF init, session, OCR
theme.css           # ← แก้ไข: เพิ่ม CSS variables
config.js           # ← ไม่แก้ (แต่รวมมาให้เผื่อ)
Code.gs             # ← แก้ไข: POST parsing, filters
```

### 2. วิธี Update (ทีละขั้นตอน)

#### **ขั้นตอนที่ 1: Clone repo ถ้ายังไม่มี**
```bash
git clone https://github.com/hongthayban-dev/Event.git
cd Event
```

#### **ขั้นตอนที่ 2: Replace ไฟล์**
```bash
# Copy 3 ไฟล์หลัก
cp api.js /path/to/Event/
cp theme.css /path/to/Event/
cp config.js /path/to/Event/

# สำหรับ Code.gs ให้ copy content ไปยัง Apps Script editor เอง
# (ไม่ได้ push ลง GitHub)
```

#### **ขั้นตอนที่ 3: Commit & Push**
```bash
cd Event
git add api.js theme.css config.js
git commit -m "fix: LIFF init, POST parsing, CSS variables, OCR fallback

- Fix liffInit() promise chain for proper async handling
- Fix POST URLSearchParams parsing in backend
- Add missing CSS variables (--navy-grad, --gold-grad, etc)
- Improve OCR error handling with graceful fallback
- Add getSession/setSession/clearSession functions
- Fix fieldOn() parameter handling"

git push origin main
```

#### **ขั้นตอนที่ 4: Deploy Code.gs ใหม่**
```
1. เปิด Google Sheet ที่มี Apps Script
2. Extensions → Apps Script
3. แทนที่ Code.gs ด้วย content จาก Code-FIXED.gs
4. Deploy > New deployment > Web app
   - Execute as: Me
   - Who has access: Anyone
5. คัดลอก URL /exec ใหม่
6. แปะใน config.js (บรรทัด API_URL)
7. Commit & push config.js ใหม่:
   git add config.js
   git commit -m "update: new Apps Script deployment URL"
   git push origin main
```

---

## ✅ Verification Checklist

หลังจาก push ให้ตรวจสอบเหล่านี้:

- [ ] api.js มี `liffInit()` ที่ return promise ✓
- [ ] theme.css มี `--navy-grad`, `--gold-grad` variables ✓
- [ ] Code.gs parse URLSearchParams ของ POST ได้ ✓
- [ ] config.js มี API_URL ใหม่ (ถ้า redeploy) ✓
- [ ] test.html เปิดได้ และ ping backend สำเร็จ ✓

---

## 🔍 Files Structure

ใน folder `github-ready` มี:

```
github-ready/
├── api.js              ✅ Ready to push
├── theme.css           ✅ Ready to push
├── config.js           ✅ Ready to push
├── Code.gs             ✅ Copy content to Apps Script
└── UPDATE_INSTRUCTIONS.md (ไฟล์นี้)
```

---

## 📋 ไฟล์เอกสารเพิ่มเติม (ไม่ push GitHub)

เก็บไว้ในเครื่องเพื่อ reference:
- `BUG_REPORT.md` - รายละเอียดปัญหา 13 ข้อ
- `DEPLOYMENT_GUIDE.md` - คู่มือ deployment
- `SUMMARY.md` - สรุปรวม

---

## ⚠️ สำคัญ!

1. **Code.gs** ไม่ push GitHub เพราะมันอยู่ใน Apps Script ไม่ใช่ repo
2. หลังจาก push api.js, theme.css, config.js บน GitHub ให้ update Code.gs ใน Apps Script เลย (deploy ใหม่)
3. ทดสอบ test.html หลังจาก deploy เพื่อตรวจสอบทั้งหมดเชื่อมต่อได้

---

## 🆘 Troubleshooting

### "ไฟล์ยังใช้ URL เก่า"
→ ตรวจสอบ `config.js` บรรทัด `API_URL` ว่าเป็น URL ใหม่ของ Apps Script

### "test.html บอก unauthorized"
→ ตรวจสอบ `config.js` บรรทัด `ADMIN_KEY` ว่าตรงกับ Script Property

### "LIFF ไม่เชื่อมต่อ"
→ ตรวจสอบ LIFF ID ใน `config.js` = `2010308553-ubIy665f` หรือไม่

---

**สร้างเมื่อ:** 08 มิถุนายน 2566  
**สำหรับการ Deploy:** ✅ Ready
