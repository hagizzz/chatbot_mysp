// soi_tin.js — soi hội thoại đang KẸT (theo ID và/hoặc theo TÊN). CHỈ ĐỌC, không gửi gì.
// Chạy:  node soi_tin.js
require("dotenv").config();
const { getConversations, getMessages, normalizeMessages } = require("./pancake_reader");
const PAGE_ID = String(process.env.PANCAKE_PAGE_ID || "");

// >>> Sửa ở đây: id chính xác (ưu tiên) và/hoặc tên để dò <<<
const IDS = [
  "1468690110033030_6394346307338466",
  "1563240545357438_2104030210546988",
];
const NAMES = ["Phuong Pham", "Thắm Trần"];

function snip(s, n = 70) { return String(s || "").replace(/\s+/g, " ").trim().slice(0, n); }
function parseT(s){ if(!s) return 0; let x=String(s).trim(); if(!/[zZ]|[+-]\d\d:?\d\d$/.test(x)&&/^\d{4}-\d\d-\d\d[ T]/.test(x)) x=x.replace(" ","T")+"Z"; const t=new Date(x).getTime(); return t||0; }

async function dump(c, id) {
  console.log(`\n  --- ${(c && c.from && c.from.name) || "(không có metadata trong 200)"} | id=${id} ---`);
  if (c) {
    const lsb = c.last_sent_by ? (c.last_sent_by.admin_name || "(rỗng=khách nhắn cuối)") : "(không có)";
    const within24 = Date.now() - parseT(c.updated_at) <= 24*60*60*1000;
    const passFilter = (c.seen === false) || !(c.last_sent_by && c.last_sent_by.admin_name);
    console.log(`  type=${c.type} | seen=${c.seen} | last_sent_by=${lsb} | updated=${c.updated_at} | trong24h=${within24}`);
    console.log(`  Vào 'Cần xử lý'? ${passFilter && within24 ? "CÓ" : "KHÔNG -> " + (!within24 ? "quá 24h" : "seen=true & shop/bot nhắn cuối")}`);
  } else {
    console.log("  (id này KHÔNG nằm trong 200 hội thoại lấy về -> không rõ metadata, vẫn đọc tin trực tiếp)");
  }
  let raw; try { raw = await getMessages(id); } catch (e) { console.log("  LỖI đọc tin:", e.message); return; }
  const apiMsgs = (raw && raw.messages) || [];
  console.log(`  API trả ${apiMsgs.length} tin THÔ (8 tin cuối):`);
  for (const m of apiMsgs.slice(-8)) {
    const who = String(m?.from?.id || "") === PAGE_ID ? "SHOP " : "KHÁCH";
    const ch = String(m?.type || "").toUpperCase();
    const atts = (m.attachments || []).map(a => a.type).join(",") || "-";
    console.log(`     [${who}] kênh=${ch} | original="${snip(m.original_message)}" | message="${snip(m.message)}" | att=${atts}`);
  }
  const norm = normalizeMessages(apiMsgs);
  const custIn = norm.filter(x => x.sender === "customer" && x.channel !== "COMMENT");
  const custCm = norm.filter(x => x.sender === "customer" && x.channel === "COMMENT");
  console.log(`  --> BOT đọc được: KHÁCH-inbox=${custIn.length} | KHÁCH-comment=${custCm.length}`);
  if (custIn.length) for (const x of custIn.slice(-4)) console.log(`       KHÁCH-inbox: ${x.type}: "${snip(x.text)}"`);
  let verdict;
  if (custIn.length) verdict = "❗ CÓ tin INBOX của khách -> BOT PHẢI TRẢ. Nếu vẫn kẹt = BUG (lọc/cache).";
  else if (custCm.length) verdict = "khách CHỈ comment -> bot trả qua bình luận (không phải bỏ sót).";
  else {
    const rawCust = apiMsgs.filter(m => String(m?.from?.id || "") !== PAGE_ID);
    verdict = rawCust.length ? "❗ Khách CÓ tin thô nhưng BỘ ĐỌC VỨT HẾT = BUG đọc tin (ảnh/định dạng lạ)." : "chỉ có tin shop, không có tin khách.";
  }
  console.log(`  ===> ${verdict}`);
}

(async () => {
  const cv = await getConversations(1);
  const all = (cv && cv.conversations) || [];
  console.log(`Đã lấy ${all.length} hội thoại để dò.`);

  console.log("\n========== SOI THEO ID ==========");
  for (const id of IDS) {
    const c = all.find(x => String(x.id) === String(id));
    await dump(c, id);
  }

  console.log("\n\n========== SOI THEO TÊN ==========");
  for (const name of NAMES) {
    const w = name.toLowerCase();
    const hits = all.filter(c => String((c.from && c.from.name) || "").toLowerCase().includes(w));
    console.log(`\nTÊN: "${name}" -> ${hits.length} hội thoại trong 200`);
    if (!hits.length) { console.log("  ❗ KHÔNG có trong 200 -> không được fetch."); continue; }
    for (const c of hits) await dump(c, c.id);
  }
  console.log("\nXONG.");
  process.exit(0);
})();
