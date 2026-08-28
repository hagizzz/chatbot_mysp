// ============================================================================
//  CHẨN ĐOÁN ẢNH THEO MÀU  —  chạy NGAY trong thư mục bot (C:\AI_HTK_BOT_V5)
//  Cách dùng:   node check_mau.js              (mặc định mã MGKSQ6309)
//               node check_mau.js MÃ "màu"     (vd: node check_mau.js MGKSQ6309 "nâu vàng")
//  Script này đọc CÙNG file hash_index.json mà bot đang dùng -> thấy đúng cái bot thấy.
// ============================================================================
const path = require("path");

const code = (process.argv[2] || "MGKSQ6309").toUpperCase();
const queryColor = process.argv[3] || "nâu vàng";

function _foldKey(s) {
  return String(s || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "");
}

let pi;
try { pi = require("../loi/san_pham/product_images"); }
catch (e) { console.log("❌ Không nạp được ./product_images.js — chạy script này TRONG thư mục bot nhé.\n", e.message); process.exit(1); }
const { itemsByCode, colorFromName } = pi;

console.log("==================================================================");
console.log("  Thư mục đang chạy :", process.cwd());
console.log("  Mã kiểm tra       :", code);
console.log("  Màu khách hỏi     :", JSON.stringify(queryColor), "-> khóa:", _foldKey(queryColor));
console.log("==================================================================\n");

const items = itemsByCode(code);
console.log("Số ảnh trong hash_index cho mã này:", items.length);
if (!items.length) {
  console.log("\n❌ KHÔNG có ảnh nào cho mã này trong hash_index.json bot đang dùng.");
  console.log("   -> hash_index.json đang chạy là bản CŨ hoặc nằm SAI thư mục (phải cạnh product_images.js).");
  process.exit(0);
}

const byColor = {};
for (const it of items) {
  const c = colorFromName(it.name, it.code) || "(rỗng)";
  const k = _foldKey(c);
  byColor[c] = byColor[c] || { key: k, n: 0, id: 0, url: 0, sample: it.name };
  byColor[c].n++;
  if (it.pancakeId) byColor[c].id++;
  if (it.downloadUrl || it.thumbnailUrl) byColor[c].url++;
}
console.log("\nCÁC MÀU bot đọc ra từ tên file:");
for (const [c, v] of Object.entries(byColor)) {
  console.log(`   "${c}"  (khóa=${v.key})  | ${v.n} ảnh | pancakeId: ${v.id} | url: ${v.url} | vd tên: ${JSON.stringify(v.sample)}`);
}

// Thử khớp đúng như bot
const want = _foldKey(queryColor);
let matched = 0;
for (const it of items) {
  let fk = _foldKey(colorFromName(it.name, it.code));
  if (fk === want || fk.replace(/\d+$/, "") === want) {
    if (it.pancakeId || it.downloadUrl || it.thumbnailUrl) matched++;
  }
}
console.log(`\n>> Ảnh GỬI ĐƯỢC khớp màu "${queryColor}" (khóa ${want}):  ${matched} ảnh`);
if (matched > 0) {
  console.log("   ✅ Dữ liệu ĐÚNG. Nếu bot vẫn báo 'nhờ NV' thì do BOT CHƯA RESTART (đang dùng cache cũ).");
  console.log("      -> Tắt hẳn bot rồi mở lại để nạp hash_index.json mới.");
} else {
  console.log("   ❌ Không có ảnh khớp màu này trong file bot đang dùng.");
  console.log("      -> hash_index.json đang chạy CHƯA có ảnh màu đó (chưa đồng bộ tên từ Drive), hoặc sai thư mục.");
}

// Kiểm tra code đã đúng bản mới chưa
try {
  const fs = require("fs");
  const bw = fs.readFileSync(path.join(process.cwd(), "bot_worker_api_v3.js"), "utf8");
  const hasNew = bw.includes("imageItemsByExactColor") && bw.includes("resolveColorForImages");
  console.log("\nbot_worker_api_v3.js đang ở thư mục này:", hasNew ? "✅ ĐÃ có bộ khớp màu mới" : "❌ CHƯA phải bản mới (thiếu hàm khớp màu) -> copy lại bản FIX18 mới nhất");
} catch (_) {
  console.log("\n(Không đọc được bot_worker_api_v3.js ở thư mục này để kiểm tra phiên bản.)");
}
console.log("\n==================================================================");
