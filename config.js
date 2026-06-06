// ============================================================
//  config.js — ค่าตั้งต้นของฝั่งหน้าเว็บ
// ============================================================
window.CONFIG = {
  // LIFF ID จาก LINE Developers Console
  LIFF_ID: '2010308553-ubIy665f',

  // URL ของ Apps Script Web App (ลงท้าย /exec)
  // ** ถ้า redeploy ได้ URL ใหม่ ให้แก้ตรงนี้ **
  API_URL: 'https://script.google.com/macros/s/AKfycbzllK0_OtqWXJYc28VbLfcw8ygVwfX6xrA36sRq4bE522rhiM3pWbYlnUaftlZ1attl/exec',

  // รหัสลับสำหรับหน้า staff/admin — ต้องตรงกับ Script Property ADMIN_KEY
  // หน้า user (registrations/shop) ไม่ต้องใช้ ปล่อยว่างได้
  // หมายเหตุ: ค่านี้มองเห็นได้ในฝั่ง client จึงเป็นการกันแบบเบื้องต้น (ดู SETUP.md)
  ADMIN_KEY: ''
};
