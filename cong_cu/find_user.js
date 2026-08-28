// find_user.js — Tìm user POS theo Facebook id + lộ schema user.
// Chạy:  node find_user.js 1789212091309467
require("dotenv").config();
const { POS_BASE, POS_API_KEY, POS_SHOP_ID } = require("../loi/don/order_config");
const needle = process.argv[2] || "1789212091309467";

(async () => {
  const res = await fetch(`${POS_BASE}/shops/${POS_SHOP_ID}/users?api_key=${POS_API_KEY}`);
  const d = await res.json();
  const arr = d.data?.users || d.users || (Array.isArray(d.data) ? d.data : []);
  console.log("Tổng user:", arr.length);
  if (arr[0]) { console.log("\n=== SCHEMA user[0] (mọi field) ==="); console.log(JSON.stringify(arr[0], null, 1).slice(0, 1200)); }
  const hit = arr.find(u => JSON.stringify(u).includes(needle));
  console.log(`\n=== USER khớp FB ${needle} ===`);
  if (hit) console.log(JSON.stringify(hit, null, 1).slice(0, 1500));
  else {
    console.log("KHÔNG thấy FB id này trong /users. Thử field tên...");
    // in vài user có tên để bạn tự dò
    for (const u of arr.slice(0, 8)) console.log(JSON.stringify(u).slice(0, 200));
  }
})();
