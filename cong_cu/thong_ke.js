#!/usr/bin/env node
const __goc = require("path").join(__dirname, "..");
// ============================================================================
// thong_ke.js — ĐỌC data/turnlog/*.jsonl RỒI IN SỐ LIỆU
// ----------------------------------------------------------------------------
// Trả lời sẵn mục 9.4 (giá trị bot) và 9.5 (chi phí AI) ở mức dòng lệnh.
// GĐ6 sẽ dựng màn hình trên đúng nguồn số này, không phải đo lại từ đầu.
//
//   node thong_ke.js                 # hôm nay
//   node thong_ke.js 7               # 7 ngày gần nhất
//   node thong_ke.js 30 --ly-do      # kèm bảng lý do nhường người thật
// ============================================================================
require("../env_boot");
const fs = require("fs");
const path = require("path");

const DIR = process.env.TURNLOG_DIR || path.join(__goc, "data", "turnlog");
const soNgay = Number(process.argv.find(a => /^\d+$/.test(a)) || 1);
const hienLyDo = process.argv.includes("--ly-do");

function cacNgay(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.now() - i * 86400000);
    out.push(d.toISOString().slice(0, 10));
  }
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
  console.log("Bot phải chạy ít nhất một lượt thì mới có số.");
  process.exit(0);
}

const theoShop = new Map();
for (const t of luot) {
  const k = t.shopId || "?";
  if (!theoShop.has(k)) theoShop.set(k, {
    luot: 0, traLoi: 0, hoiThoai: new Set(), nhuong: 0, loi: 0,
    tokenVao: 0, tokenDem: 0, tokenRa: 0, tien: 0, goiAI: 0, msTong: 0, lyDo: new Map()
  });
  const s = theoShop.get(k);
  s.luot++;
  if (t.daTraLoi) s.traLoi++;
  if (t.conversationId) s.hoiThoai.add(t.conversationId);
  if (t.nhuongNguoiThat) {
    s.nhuong++;
    s.lyDo.set(t.nhuongNguoiThat, (s.lyDo.get(t.nhuongNguoiThat) || 0) + 1);
  }
  if (t.loi) s.loi++;
  s.tokenVao += t.tokenVao || 0;
  s.tokenDem += t.tokenDem || 0;
  s.tokenRa += t.tokenRa || 0;
  s.tien += t.tienUSD || 0;
  s.goiAI += (t.ai || []).length;
  s.msTong += t.ms || 0;
}

const usd = n => "$" + n.toFixed(4);
const pt = (a, b) => b ? Math.round((a / b) * 100) + "%" : "0%";

console.log(`\n=== ${soNgay} ngày gần nhất · ${luot.length} lượt ===\n`);
for (const [shop, s] of theoShop) {
  console.log(`SHOP ${shop}`);
  console.log(`  Hội thoại bot đụng vào        : ${s.hoiThoai.size}`);
  console.log(`  Lượt bot TRẢ LỜI thay nhân viên: ${s.traLoi}  (${pt(s.traLoi, s.luot)} số lượt)`);
  console.log(`  Lượt nhường NGƯỜI THẬT         : ${s.nhuong}  (${pt(s.nhuong, s.luot)})`);
  console.log(`  Lượt lỗi                       : ${s.loi}`);
  console.log(`  Thời gian xử lý trung bình     : ${Math.round(s.msTong / s.luot)} ms/lượt`);
  console.log(`  Gọi AI                         : ${s.goiAI} lần | ${s.tokenVao.toLocaleString()} token vào + ${s.tokenRa.toLocaleString()} token ra`);
  // Token vào chiếm ~97% chi phí, và phần lớn là hai khối prompt lặp lại y hệt
  // mọi lượt. Tỉ lệ đệm THẤP = đang trả giá đầy đủ cho phần đáng ra được giảm.
  console.log(`  Trong đó ĐƯỢC ĐỆM              : ${s.tokenDem.toLocaleString()} token (${pt(s.tokenDem, s.tokenVao)} token vào)` +
              (s.tokenVao && s.tokenDem === 0
                ? "\n  " + " ".repeat(31) + "  ⚠ 0% — hoặc lượt cũ ghi TRƯỚC 27/08/2026 (chưa có ô đo),"
                  + "\n  " + " ".repeat(31) + "    hoặc prompt đã mất tính ổn định đầu chuỗi. Soi: node do_dem.js"
                : ""));
  console.log(`  Chi phí AI                     : ${usd(s.tien)}` +
              (s.hoiThoai.size ? ` (${usd(s.tien / s.hoiThoai.size)}/hội thoại)` : ""));
  const ngayCong = soNgay;
  console.log(`  Ước một tháng theo nhịp này    : ${usd(s.tien / ngayCong * 30)}`);
  if (hienLyDo && s.lyDo.size) {
    console.log(`\n  Vì sao nhường người thật:`);
    [...s.lyDo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
      .forEach(([l, n]) => console.log(`    ${String(n).padStart(4)}×  ${l.slice(0, 110)}`));
  }
  console.log("");
}
