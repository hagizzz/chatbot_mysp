// Kiểm tra token PHOM trong pages.json còn sống không.
// Chạy (CMD, trong C:\AI_HTK_BOT_V5):  node kiem_tra_phom.js
const fs = require("fs");
const https = require("https");

const PHOM_ID = "615738195133683";
const MYSP_ID = "1468690110033030";

if (!fs.existsSync("./pages.json")) {
  console.log("!!! KHÔNG thấy pages.json ở thư mục này. cd vào đúng C:\\AI_HTK_BOT_V5 rồi chạy lại.");
  process.exit(1);
}

let raw;
try { raw = JSON.parse(fs.readFileSync("./pages.json", "utf8")); }
catch (e) { console.log("!!! pages.json LỖI JSON (thiếu dấu phẩy/ngoặc?):", e.message); process.exit(1); }

// đọc theo đúng cách page_registry.js: nhận cả [ {id,token} ] lẫn { "<id>": {token} }
const entries = Array.isArray(raw)
  ? raw.map(x => [String(x.id || x.pageId || ""), x])
  : Object.entries(raw).map(([id, v]) => [String(id), v]);

const map = new Map();
for (const [id, v] of entries) {
  const tok = v && (v.token || v.page_access_token);
  if (id && tok) map.set(id, tok);
}

console.log("====== PAGE trong pages.json ======");
for (const [id, tok] of map) {
  const ten = id === PHOM_ID ? "PHOM" : id === MYSP_ID ? "Mys.P" : "?";
  const banh = /\s/.test(tok) ? "  <-- !!! CÓ KHOẢNG TRẮNG/XUỐNG DÒNG (HỎNG)" : "";
  console.log(`  ${ten} (${id}) | token dài ${tok.length} | ${tok.slice(0,12)}...${tok.slice(-6)}${banh}`);
}
console.log("");

function thu(id, ten) {
  const tok = map.get(id);
  if (!tok) { console.log(`>> ${ten}: KHÔNG có token trong pages.json`); return; }
  const url = `https://pages.fm/api/public_api/v2/pages/${id}/conversations?page_access_token=${tok}`;
  https.get(url, (r) => {
    let d = ""; r.on("data", c => d += c);
    r.on("end", () => {
      try {
        const j = JSON.parse(d);
        if (j && j.success === false) {
          console.log(`>> ${ten}: TOKEN HỎNG -> ${j.message} (error_code ${j.error_code})`);
          console.log(`   -> Vào Pancake lấy token MỚI của page ${ten}, dán lại vào pages.json rồi: pm2 restart bot`);
        } else {
          const n = (j.conversations || j.data || []).length;
          console.log(`>> ${ten}: TOKEN OK! lấy được ${n} hội thoại. Token sống.`);
        }
      } catch (e) { console.log(`>> ${ten}: phản hồi lạ:`, d.slice(0,150)); }
    });
  }).on("error", e => console.log(`>> ${ten}: lỗi mạng`, e.message));
}

console.log("Đang gọi thử Pancake...\n");
thu(MYSP_ID, "Mys.P");
thu(PHOM_ID, "PHOM");
