// thu_loc.js — THỬ xem Pancake có tham số lọc "chưa đọc" nào hoạt động không. CHỈ ĐỌC.
// Chạy:  node thu_loc.js
require("dotenv").config();
const PAGE_ID = process.env.PANCAKE_PAGE_ID;
const TOKEN = process.env.PANCAKE_PAGE_ACCESS_TOKEN;
const now = Math.floor(Date.now()/1000);
const since = now - 25*24*3600, until = now + 24*3600;
const BASE = `https://pages.fm/api/public_api/v1/pages/${PAGE_ID}/conversations?page_access_token=${TOKEN}&since=${since}&until=${until}&page_size=200`;

// Các tên tham số lọc chưa-đọc ỨNG VIÊN (mình không chắc tên nào đúng -> thử hết):
const TESTS = [
  ["(không lọc - mốc so sánh)", ""],
  ["unread=true",              "&unread=true"],
  ["is_unread=true",           "&is_unread=true"],
  ["seen=false",               "&seen=false"],
  ["filter=unread",            "&filter=unread"],
  ["unread_first=true",        "&unread_first=true"],
  ["status=unread",            "&status=unread"],
  ["type=INBOX&unread=true",   "&type=INBOX&unread=true"],
  ["only_unread=true",         "&only_unread=true"],
];

(async () => {
  for (const [name, extra] of TESTS) {
    try {
      const res = await fetch(BASE + extra);
      const data = await res.json();
      const convs = data.conversations || [];
      const unread = convs.filter(c => c.seen === false).length;
      const ok = data.success === true;
      console.log(`${name.padEnd(30)} | HTTP ${res.status} | success=${ok} | trả về=${convs.length} | trong đó CHƯA ĐỌC=${unread} | total=${data.total}`);
    } catch (e) {
      console.log(`${name.padEnd(30)} | LỖI: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 400));
  }
  console.log("\n>>> Tìm dòng có 'trả về' NHỎ và 'trả về' == 'CHƯA ĐỌC' -> đó là tham số lọc đúng.");
  process.exit(0);
})();
