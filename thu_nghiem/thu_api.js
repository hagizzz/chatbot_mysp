// thu_api.js — TRUY ĐÚNG: thử nhiều kiểu gọi API, mỗi kiểu báo CÓ bắt được Phương Phạm (6394...) không.
// CHỈ ĐỌC. Chạy: node thu_api.js
require("dotenv").config();
const PAGE_ID = process.env.PANCAKE_PAGE_ID;
const TOKEN = process.env.PANCAKE_PAGE_ACCESS_TOKEN;
const TARGET = "1468690110033030_6394346307338466"; // Phương Phạm (đang nhắn mà không nổi lên list)
const now = Math.floor(Date.now()/1000);
const since = now - 25*24*3600, until = now + 24*3600;
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const V1 = `https://pages.fm/api/public_api/v1/pages/${PAGE_ID}/conversations`;
const V2 = `https://pages.fm/api/public_api/v2/pages/${PAGE_ID}/conversations`;
const A = `page_access_token=${TOKEN}`;
const W = `since=${since}&until=${until}`;

const tests = [
  ["v1 thường (mốc so sánh)",        `${V1}?${A}&${W}&page_number=1&page_size=200`],
  ["v2 thường",                      `${V2}?${A}&${W}&page_size=60`],
  ["v2 KHÔNG since/until",           `${V2}?${A}&page_size=60`],
  ["v2 unread=true",                 `${V2}?${A}&${W}&page_size=60&unread=true`],
  ["v2 is_unread=true",              `${V2}?${A}&${W}&page_size=60&is_unread=true`],
  ["v2 filter=unread",               `${V2}?${A}&${W}&page_size=60&filter=unread`],
  ["v2 statuses[]=unread",           `${V2}?${A}&${W}&page_size=60&statuses[]=unread`],
  ["v2 sort=last_message",           `${V2}?${A}&${W}&page_size=60&sort=last_message`],
  ["v2 order_by=last_message_at",    `${V2}?${A}&${W}&page_size=60&order_by=last_message_at`],
  ["v2 unread KHÔNG since/until",    `${V2}?${A}&page_size=60&unread=true`],
  ["v1 unread=true",                 `${V1}?${A}&${W}&page_number=1&page_size=200&unread=true`],
];

(async () => {
  for (const [name, url] of tests) {
    try {
      const d = await (await fetch(url)).json();
      const c = d.conversations || [];
      const has = c.some(x => String(x.id) === TARGET);
      const newest = c[0] ? `${(c[0].from&&c[0].from.name)||"?"}@${c[0].updated_at}` : "-";
      console.log(`${name.padEnd(30)} | ok=${d.success} | về=${String(c.length).padStart(3)} | Phương Phạm? ${has ? "✅ CÓ!!!" : "không "} | mới nhất: ${newest}`);
    } catch(e){ console.log(`${name.padEnd(30)} | LỖI ${e.message}`); }
    await sleep(400);
  }
  console.log("\n>>> Dòng nào hiện '✅ CÓ!!!' = đúng cách gọi để bắt Phương Phạm. Báo mình dòng đó là mình ráp vào reader.");
  console.log(">>> Nếu KHÔNG dòng nào CÓ -> API public không trả nick này, mình chuyển sang cách 'nhớ ID & đọc lại' (không cần list).");
  process.exit(0);
})();
