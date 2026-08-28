#!/usr/bin/env node
const __goc = require("path").join(__dirname, "..", "..");
// ============================================================================
// do_do_nhan_dien_anh.js — ĐO ĐỘ NHẬN DIỆN ẢNH VÀ ĐẶT NGƯỠNG (GĐ1)
// ----------------------------------------------------------------------------
// Kế hoạch ghi rõ: nhận diện ảnh "chưa từng được đo" — đó là một rủi ro mức Trung
// bình đang mở. Không đo thì không biết đặt ngưỡng ở đâu, mà ngưỡng sai theo hướng
// dễ dãi thì bot khẳng định nhầm mẫu; sai theo hướng chặt thì mọi ảnh đều đẩy
// người thật, tính năng thành vô dụng.
//
// Ba loại kết quả, KHÔNG phải hai:
//     ĐÚNG        — nhận ra và nhận đúng mẫu
//     KHÔNG QUYẾT  — không đủ chắc, giao người thật   (chấp nhận được)
//     SAI          — khẳng định NHẦM mẫu               (tệ nhất: khách được báo giá sai mẫu)
//
// Nguyên tắc đặt ngưỡng: SAI phải bằng 0, rồi mới tối đa hoá ĐÚNG.
// Một ca SAI đắt hơn nhiều ca KHÔNG QUYẾT.
//
//   python tao_anh_thu.py 40          # dựng bộ ảnh thử (cần mạng + Pillow)
//   node do_do_nhan_dien_anh.js       # đo + đề xuất ngưỡng
//   node do_do_nhan_dien_anh.js --luu ket_qua.json
// ============================================================================
const fs = require("fs");
const path = require("path");

const THU_MUC = process.env.ANH_THU_DIR || path.join(__goc, "test", "anh_thu");

// ---------------------------------------------------------------------------
// Phần TÍNH TOÁN — hàm thuần, có test riêng, chạy offline không cần model.
// ---------------------------------------------------------------------------

/** Phân loại một kết quả đo theo một cặp ngưỡng. */
function phanLoai(d, minScore, minGap) {
  const chac = d.score >= minScore && d.gap >= minGap;
  if (!chac) return "khong_quyet";
  return String(d.maDoan || "").toUpperCase() === String(d.maDung || "").toUpperCase()
    ? "dung" : "sai";
}

/** Đếm theo một cặp ngưỡng. */
function dem(dsKetQua, minScore, minGap) {
  const d = { dung: 0, sai: 0, khong_quyet: 0 };
  for (const x of dsKetQua) d[phanLoai(x, minScore, minGap)]++;
  return d;
}

/**
 * Quét dải ngưỡng, chọn cặp tốt nhất theo nguyên tắc: SAI = 0 trước, ĐÚNG nhiều sau.
 * Không có cặp nào cho SAI = 0 thì trả cặp ít SAI nhất và nói rõ.
 */
function timNguong(dsKetQua, { soSaiToiDa = 0 } = {}) {
  const ungVien = [];
  for (let s = 0.60; s <= 0.96; s += 0.01) {
    for (let g = 0.00; g <= 0.15; g += 0.01) {
      const minScore = +s.toFixed(2), minGap = +g.toFixed(2);
      const c = dem(dsKetQua, minScore, minGap);
      ungVien.push({ minScore, minGap, ...c });
    }
  }
  const sach = ungVien.filter(x => x.sai <= soSaiToiDa);
  const nguon = sach.length ? sach : ungVien;
  nguon.sort((a, b) =>
    (a.sai - b.sai) ||                    // ít khẳng định nhầm nhất
    (b.dung - a.dung) ||                  // rồi nhận ra được nhiều nhất
    (a.minScore - b.minScore)             // rồi ngưỡng dễ thở hơn (đỡ trượt oan ảnh lạ)
  );
  return { tot_nhat: nguon[0], datDuocSaiBang0: sach.length > 0 };
}

function theoBienThe(dsKetQua, minScore, minGap) {
  const ra = {};
  for (const x of dsKetQua) {
    const b = x.bienThe || "?";
    ra[b] = ra[b] || { dung: 0, sai: 0, khong_quyet: 0 };
    ra[b][phanLoai(x, minScore, minGap)]++;
  }
  return ra;
}

module.exports = { phanLoai, dem, timNguong, theoBienThe };

// ---------------------------------------------------------------------------
// Phần CHẠY THẬT — cần model CLIP + chỉ mục trên máy.
// ---------------------------------------------------------------------------
if (require.main === module) (async () => {
  require("../../env_boot");
  if (!fs.existsSync(THU_MUC)) {
    console.log(`Chưa có bộ ảnh thử ở ${THU_MUC}.`);
    console.log(`Dựng bằng:  python tao_anh_thu.py 40`);
    process.exit(1);
  }
  const anh = fs.readdirSync(THU_MUC).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
  if (!anh.length) {
    console.log(`Thư mục ${THU_MUC} chưa có ảnh nào. Chạy: python tao_anh_thu.py 40`);
    process.exit(1);
  }

  // Đo trên số THÔ: hạ ngưỡng của worker xuống sàn để nó luôn trả score/gap/top,
  // rồi tự phân loại ở đây theo từng cặp ngưỡng. Nhờ vậy quét được cả dải trong MỘT lượt chạy.
  process.env.CLIP_MIN_SCORE = "0";
  process.env.CLIP_MIN_GAP = "0";
  const { resolveImage } = require("./vision_resolver");

  console.log(`Đo ${anh.length} ảnh thử... (lần đầu phải chờ worker nạp model)\n`);
  const ketQua = [];
  for (let i = 0; i < anh.length; i++) {
    const f = anh[i];
    const [maDung, bienThe] = f.replace(/\.[^.]+$/, "").split("__");
    let r;
    try { r = await resolveImage(path.join(THU_MUC, f)); }
    catch (e) { r = { ok: false, reason: "LOI:" + e.message }; }
    ketQua.push({
      file: f,
      maDung: String(maDung || "").toUpperCase(),
      bienThe: bienThe || "?",
      maDoan: String((r && (r.code || (r.vision && r.vision.code))) || "").toUpperCase(),
      score: Number((r && r.score) || 0),
      gap: Number((r && r.gap) || 0),
      top: (r && r.top) || []
    });
    if ((i + 1) % 20 === 0) console.log(`  ...${i + 1}/${anh.length}`);
  }

  const sHienTai = Number(process.env.CLIP_MIN_SCORE_THAT || 0.80);
  const gHienTai = Number(process.env.CLIP_MIN_GAP_THAT || 0.04);
  const hienTai = dem(ketQua, sHienTai, gHienTai);
  const { tot_nhat, datDuocSaiBang0 } = timNguong(ketQua);

  const pt = (n) => ((n / ketQua.length) * 100).toFixed(1) + "%";
  console.log(`\n=== NGƯỠNG ĐANG DÙNG (score ≥ ${sHienTai}, gap ≥ ${gHienTai}) ===`);
  console.log(`  ĐÚNG        ${String(hienTai.dung).padStart(4)}  ${pt(hienTai.dung)}`);
  console.log(`  KHÔNG QUYẾT ${String(hienTai.khong_quyet).padStart(4)}  ${pt(hienTai.khong_quyet)}   (giao người thật — chấp nhận được)`);
  console.log(`  SAI         ${String(hienTai.sai).padStart(4)}  ${pt(hienTai.sai)}   (khẳng định NHẦM mẫu — phải bằng 0)`);

  console.log(`\n=== NGƯỠNG ĐỀ XUẤT (score ≥ ${tot_nhat.minScore}, gap ≥ ${tot_nhat.minGap}) ===`);
  console.log(`  ĐÚNG        ${String(tot_nhat.dung).padStart(4)}  ${pt(tot_nhat.dung)}`);
  console.log(`  KHÔNG QUYẾT ${String(tot_nhat.khong_quyet).padStart(4)}  ${pt(tot_nhat.khong_quyet)}`);
  console.log(`  SAI         ${String(tot_nhat.sai).padStart(4)}  ${pt(tot_nhat.sai)}`);
  if (!datDuocSaiBang0) {
    console.log(`\n  ⚠ KHÔNG có cặp ngưỡng nào cho SAI = 0. Nghĩa là có ảnh mà mẫu khác BỊ chấm`);
    console.log(`    cao hơn mẫu đúng — không phải chuyện ngưỡng. Xem lại chỉ mục: hai mẫu quá`);
    console.log(`    giống nhau, hoặc ảnh danh mục của mẫu đó thiếu/sai.`);
  }
  console.log(`\n  Áp dụng:  CLIP_MIN_SCORE=${tot_nhat.minScore}  CLIP_MIN_GAP=${tot_nhat.minGap}  (trong .env)`);

  console.log(`\n=== THEO KIỂU ẢNH (ở ngưỡng đề xuất) ===`);
  const bang = theoBienThe(ketQua, tot_nhat.minScore, tot_nhat.minGap);
  for (const [b, c] of Object.entries(bang)) {
    const t = c.dung + c.sai + c.khong_quyet;
    console.log(`  ${b.padEnd(16)} đúng ${String(c.dung).padStart(3)}/${t}  · không quyết ${c.khong_quyet}  · SAI ${c.sai}`);
  }

  const sai = ketQua.filter(x => phanLoai(x, tot_nhat.minScore, tot_nhat.minGap) === "sai");
  if (sai.length) {
    console.log(`\n=== ${sai.length} CA KHẲNG ĐỊNH NHẦM (soi kỹ những ca này) ===`);
    sai.slice(0, 12).forEach(x =>
      console.log(`  ${x.file}\n    đúng=${x.maDung}  đoán=${x.maDoan}  score=${x.score}  gap=${x.gap}`));
  }

  const luuI = process.argv.indexOf("--luu");
  if (luuI > 0 && process.argv[luuI + 1]) {
    fs.writeFileSync(process.argv[luuI + 1], JSON.stringify({ ketQua, hienTai, deXuat: tot_nhat }, null, 2), "utf8");
    console.log(`\nĐã lưu số liệu thô -> ${process.argv[luuI + 1]} (để so với lần đo sau)`);
  }
  process.exit(0);
})();
