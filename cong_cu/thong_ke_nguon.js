#!/usr/bin/env node
const __goc = require("path").join(__dirname, "..");
// ============================================================================
// thong_ke_nguon.js — CÂU BOT NÓI RA ĐẾN TỪ ĐÂU?
// ----------------------------------------------------------------------------
// Đọc data/turnlog/*.jsonl (turn_log đã gắn nguồn cho từng tin gửi đi) rồi trả
// lời đúng hai câu hỏi đang chặn việc dọn kịch bản và chặn cả GĐ3:
//
//   1) Bao nhiêu % câu bot nói với khách là do KỊCH BẢN dạy, bao nhiêu % là do
//      CODE viết cứng? -> tức là trang quản trị sửa kịch bản sẽ với tới bao nhiêu.
//   2) Trong phần viết cứng, DÒNG NÀO đẻ ra nhiều câu nhất? -> đó là thứ tự
//      phải rút nhánh cứng về Sheet, làm từ trên xuống, không làm theo cảm tính.
//
//   node thong_ke_nguon.js              # hôm nay
//   node thong_ke_nguon.js 7            # 7 ngày gần nhất
//   node thong_ke_nguon.js 7 --top 40   # xem sâu hơn bảng xếp hạng nhánh cứng
// ============================================================================
require("../env_boot");
const fs = require("fs");
const path = require("path");

const DIR = process.env.TURNLOG_DIR || path.join(__goc, "data", "turnlog");
const soNgay = Number(process.argv.find(a => /^\d+$/.test(a)) || 1);
const _iTop = process.argv.indexOf("--top");
const TOP = _iTop >= 0 ? Number(process.argv[_iTop + 1] || 20) : 20;

// Giải thích từng nguồn bằng tiếng người, kèm "ai sửa được" — đây mới là thông
// tin cần cho quyết định, chứ không phải cái tên khoá.
const GIAI_THICH = {
  kich_ban:    ["kho kịch bản (kich_ban/*.json)", "người kinh doanh sửa được"],
  nhanh_cung:  ["câu VIẾT CỨNG trong mã nguồn — CHƯA RÚT", "chỉ lập trình viên sửa được"],
  ai_tu_do:    ["AI soạn theo KỊCH BẢN (Doc + tab AI AGENT)", "người kinh doanh sửa được"],
  ai_quyet:    ["tầng AI-QUYẾT tự soạn", "chỉnh qua prompt trong ai_quyet.js"],
  luat_sheet:  ["câu mẫu lấy thẳng từ tab AI AGENT", "người kinh doanh sửa được"],
  khong_ro:    ["chưa truy được nguồn", "cần soi thêm"]
};
const SUA_DUOC_BOI_KINH_DOANH = new Set(["ai_tu_do", "luat_sheet", "kich_ban"]);

function cacNgay(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  return out.reverse();
}

const luot = [];
for (const ngay of cacNgay(soNgay)) {
  const f = path.join(DIR, ngay + ".jsonl");
  if (!fs.existsSync(f)) continue;
  for (const dong of fs.readFileSync(f, "utf8").split("\n")) {
    if (!dong.trim()) continue;
    try { luot.push(JSON.parse(dong)); } catch (_) {}
  }
}

if (!luot.length) {
  console.log(`Chưa có dữ liệu trong ${soNgay} ngày gần nhất (${DIR}).`);
  console.log("Chạy bot (hoặc npm run dien-kich-ban) cho ra vài lượt rồi đo lại.");
  process.exit(0);
}

const theoNguon = new Map();
const theoViTri = new Map();
let tongTin = 0, tinCoChu = 0, tinCu = 0;

for (const t of luot) {
  for (const g of (t.guiDi || [])) {
    tongTin++;
    if (!g.noiDung || !String(g.noiDung).trim()) continue;
    tinCoChu++;
    if (!g.nguon) { tinCu++; continue; }        // lượt ghi TRƯỚC khi có bộ đo
    theoNguon.set(g.nguon, (theoNguon.get(g.nguon) || 0) + 1);
    if ((g.nguon === "nhanh_cung" || g.nguon === "kich_ban") && g.viTri) {
      const o = theoViTri.get(g.viTri) || { so: 0, viDu: "" };
      o.so++;
      if (!o.viDu) o.viDu = String(g.noiDung).replace(/\s+/g, " ").slice(0, 72);
      theoViTri.set(g.viTri, o);
    }
  }
}

const daDo = tinCoChu - tinCu;
const pc = (n, mau) => mau ? (n * 100 / mau).toFixed(1).padStart(5) + "%" : "    -";

console.log("=".repeat(78));
console.log(`NGUỒN CÂU TRẢ LỜI — ${soNgay} ngày gần nhất`);
console.log(`${luot.length} lượt xử lý, ${tongTin} tin gửi đi, ${tinCoChu} tin có chữ` +
            (tinCu ? `, ${tinCu} tin ghi trước khi có bộ đo (bỏ qua)` : ""));
console.log("=".repeat(78));

if (!daDo) {
  console.log("\nChưa lượt nào được gắn nguồn. Bot phải chạy lại SAU khi cài bộ đo.");
  process.exit(0);
}

console.log("");
const xep = [...theoNguon.entries()].sort((a, b) => b[1] - a[1]);
for (const [nguon, so] of xep) {
  const [mo_ta, ai_sua] = GIAI_THICH[nguon] || [nguon, "?"];
  console.log(`  ${pc(so, daDo)}  ${String(so).padStart(5)} tin  ${mo_ta}`);
  console.log(`          ${" ".repeat(11)}${ai_sua}`);
}

const soKinhDoanh = xep.filter(([n]) => SUA_DUOC_BOI_KINH_DOANH.has(n)).reduce((a, b) => a + b[1], 0);
console.log("");
console.log("-".repeat(78));
console.log(`  KỊCH BẢN với tới:  ${pc(soKinhDoanh, daDo)}  (${soKinhDoanh}/${daDo} tin)`);
console.log(`  NGOÀI tầm với:     ${pc(daDo - soKinhDoanh, daDo)}  (${daDo - soKinhDoanh}/${daDo} tin)`);
console.log("-".repeat(78));
console.log("  Con số thứ hai chính là phần trang quản trị (GĐ3) KHÔNG chạm được");
console.log("  nếu không rút nhánh cứng về Sheet trước.");

const xepViTri = [...theoViTri.entries()].sort((a, b) => b[1].so - a[1].so);
if (xepViTri.length) {
  console.log("");
  console.log("=".repeat(78));
  console.log(`NHÁNH CỨNG ĐẺ RA NHIỀU CÂU NHẤT — rút về Sheet theo đúng thứ tự này`);
  console.log("=".repeat(78));
  let luy = 0;
  const tongCung = xepViTri.reduce((a, b) => a + b[1].so, 0);
  xepViTri.slice(0, TOP).forEach(([viTri, o], i) => {
    luy += o.so;
    console.log(`${String(i + 1).padStart(3)}. ${viTri.padEnd(30)} ${String(o.so).padStart(5)} tin  ${pc(o.so, tongCung)}  (dồn ${pc(luy, tongCung)})`);
    console.log(`     "${o.viDu}"`);
  });
  if (xepViTri.length > TOP) {
    console.log(`     ... còn ${xepViTri.length - TOP} nhánh nữa (--top ${xepViTri.length} để xem hết)`);
  }
  // Bao nhiêu nhánh gánh 80% lưu lượng? -> biết ngay việc rút là to hay nhỏ.
  let cong = 0, canBaoNhieu = 0;
  for (const [, o] of xepViTri) { cong += o.so; canBaoNhieu++; if (cong >= tongCung * 0.8) break; }
  console.log("");
  console.log(`  => Chỉ cần rút ${canBaoNhieu}/${xepViTri.length} nhánh là phủ 80% câu viết cứng.`);
}
console.log("");
