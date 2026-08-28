#!/usr/bin/env node
const __goc = require("path").join(__dirname, "..", "..");
// ============================================================================
// do_do_nhan.js — ĐO ĐỘ CHÍNH XÁC GẮN NHÃN Ý ĐỊNH + ĐẶT NGƯỠNG do_tin_cay
// ----------------------------------------------------------------------------
// Bộ test/do_tin_cay.test.js chỉ khoá được CẤU TRÚC (điểm có bị kẹp đúng không,
// mạng an toàn có đủ gác không) — nó chạy offline, không biết model gắn nhãn
// đúng hay sai. Muốn biết điều đó phải GỌI API THẬT. Đó là việc của tệp này.
//
// Ba loại kết quả, KHÔNG phải hai (giống do_do_nhan_dien_anh.js):
//     ĐÚNG        — nhãn khớp, điểm >= ngưỡng                (bot tự trả, trả đúng)
//     KHÔNG QUYẾT — điểm < ngưỡng -> giao NGƯỜI THẬT          (chấp nhận được)
//     SAI         — điểm >= ngưỡng nhưng nhãn KHÁC nhãn đúng  (tệ nhất: bot tự
//                   tin đi sai nhánh, khách nhận câu lạc đề)
//
// Nguyên tắc đặt ngưỡng: kéo SAI xuống trước, rồi mới tối đa hoá ĐÚNG. Một ca SAI
// đắt hơn nhiều ca KHÔNG QUYẾT — người thật xử một hội thoại thì mất công, còn bot
// trả sai thì mất khách.
//
//   node do_do_nhan.js --tao-mau        # dựng tệp nhãn chuẩn để shop dán tay
//   node do_do_nhan.js                  # đo (mặc định 4 lượt song song)
//   node do_do_nhan.js --so 20 --tat-ca # đo 20 ca đầu, in cả ca đúng
//   node do_do_nhan.js --luu ket_qua.json
//
// TỐN TIỀN THẬT: mỗi ca = 1 lượt gpt-4.1-mini (~7k token vào). Script in chi phí
// thật lấy từ turn_log ở cuối.
// ============================================================================
const fs = require("fs");
const path = require("path");

const CA_VANG = path.join(__goc, "test", "ca_vang", "nhan_y_dinh.json");
const NHAN_CHUAN = path.join(__goc, "test", "ca_vang", "nhan_chuan.json");

// ---------------------------------------------------------------------------
// Phần TÍNH TOÁN — hàm thuần, có test riêng (test/do_do_nhan.test.js), chạy
// offline không cần API. Đo xong rồi thì việc QUYẾT ĐỊNH ngưỡng nằm hết ở đây.
// ---------------------------------------------------------------------------

/**
 * Phân loại một kết quả đo theo một ngưỡng.
 * diem = null nghĩa là AI KHÔNG chấm điểm -> worker KHÔNG chặn (xem mạng an toàn
 * trong bot_worker_api_v3.js) -> phải tính là bot ĐÃ QUYẾT, không được coi là
 * "không quyết" cho đẹp số.
 */
function phanLoai(d, nguong) {
  const chac = typeof d.diem !== "number" || d.diem >= nguong;
  if (!chac) return "khong_quyet";
  return String(d.nhanDoan || "").toUpperCase() === String(d.nhanDung || "").toUpperCase()
    ? "dung" : "sai";
}

/** Đếm theo một ngưỡng. Ca chưa dán nhãn đúng thì không đếm được -> bỏ ra ngoài. */
function dem(ds, nguong) {
  const c = { dung: 0, sai: 0, khong_quyet: 0 };
  for (const x of ds) { if (!x.nhanDung) continue; c[phanLoai(x, nguong)]++; }
  return c;
}

/**
 * Quét dải ngưỡng 0.30 -> 0.95.
 *
 * Có ngưỡng đạt SAI <= soSaiToiDa -> chọn trong nhóm đó, ưu tiên ĐÚNG nhiều nhất.
 *
 * KHÔNG có ngưỡng nào đạt -> KHÔNG được xếp theo "ít SAI nhất". Đo thật
 * 26/08/2026 cho thấy luật đó chọn ra ngưỡng 0.95: SAI còn 1 nhưng ĐÚNG rơi từ
 * 33 xuống 11 và 30/42 lượt bị đẩy người thật — đúng nghĩa tắt bot cho đỡ sai.
 * Lúc này phải CÂN ĐO: một ca SAI đắt bằng `giaSai` ca KHÔNG QUYẾT (mặc định 5),
 * chọn ngưỡng có tổng thiệt hại nhỏ nhất.
 */
function quetNguong(ds, { soSaiToiDa = 0, giaSai = 5 } = {}) {
  const ungVien = [];
  for (let n = 0.30; n <= 0.951; n += 0.05) {
    const nguong = +n.toFixed(2);
    ungVien.push({ nguong, ...dem(ds, nguong) });
  }
  const sach = ungVien.filter(x => x.sai <= soSaiToiDa);
  let xep;
  if (sach.length) {
    xep = [...sach].sort((a, b) =>
      (b.dung - a.dung) || (a.sai - b.sai) || (a.nguong - b.nguong));
  } else {
    const thiet = x => x.sai * giaSai + x.khong_quyet;
    xep = [...ungVien].sort((a, b) =>
      (thiet(a) - thiet(b)) || (b.dung - a.dung) || (a.nguong - b.nguong));
  }
  return { bang: ungVien, tot_nhat: xep[0], datDuocSaiToiDa: sach.length > 0, giaSai };
}

/** Nhãn nào hay sai nhất -> biết phải sửa dòng luật nào trong prompt. */
function theoNhan(ds, nguong) {
  const ra = {};
  for (const x of ds) {
    if (!x.nhanDung) continue;
    const k = x.nhanDung;
    ra[k] = ra[k] || { dung: 0, sai: 0, khong_quyet: 0 };
    ra[k][phanLoai(x, nguong)]++;
  }
  return ra;
}

// ---------------------------------------------------------------------------
// Phần ĐO THẬT — cần OPENAI_API_KEY.
// ---------------------------------------------------------------------------

/** Đọc bộ ca. Ưu tiên nhãn chuẩn shop dán tay; không có thì mượn nhãn bản đang chạy. */
function docBoCa(tep) {
  if (tep) return { ds: JSON.parse(fs.readFileSync(tep, "utf8")), nguon: tep, chuan: true };
  if (fs.existsSync(NHAN_CHUAN)) return { ds: JSON.parse(fs.readFileSync(NHAN_CHUAN, "utf8")), nguon: NHAN_CHUAN, chuan: true };
  const ca = JSON.parse(fs.readFileSync(CA_VANG, "utf8"));
  const ds = ca.filter(c => c.tinKhach && c.mong && c.mong.nhanAI)
    .map(c => ({ tin: c.tinKhach, nhanDung: c.mong.nhanAI }));
  return { ds, nguon: CA_VANG, chuan: false };
}

/** Dựng tệp nhãn chuẩn để shop sửa tay: nhãn điền sẵn là nhãn BẢN ĐANG CHẠY, sửa lại cho đúng. */
function taoMau() {
  if (fs.existsSync(NHAN_CHUAN)) { console.log("Đã có " + NHAN_CHUAN + " — không ghi đè."); return; }
  const ca = JSON.parse(fs.readFileSync(CA_VANG, "utf8"));
  const mau = ca.filter(c => c.tinKhach).map(c => ({
    tin: c.tinKhach,
    nhanDung: (c.mong && c.mong.nhanAI) || "",   // <-- SỬA TAY cho đúng ý khách
    mauDangNoi: "", tinShopTruoc: "", boiCanh: "", hoiThoaiGanDay: ""
  }));
  fs.writeFileSync(NHAN_CHUAN, JSON.stringify(mau, null, 2));
  console.log("Đã dựng " + NHAN_CHUAN + " (" + mau.length + " ca).");
  console.log("Mở ra sửa 'nhanDung' cho đúng Ý KHÁCH (đang điền sẵn nhãn bản đang chạy — chính nó là thứ cần kiểm).");
  console.log("Điền thêm tinShopTruoc/boiCanh nếu ca đó cần ngữ cảnh mới hiểu được.");
}

async function doThat(ds, { songSong = 4 } = {}) {
  const { classifyIntent } = require("../ai/ai_intent");
  const ra = new Array(ds.length);
  let i = 0, xong = 0;
  async function tho() {
    while (i < ds.length) {
      const k = i++;
      const c = ds[k];
      let r = await classifyIntent({
        text: c.tin,
        lockedProductName: c.mauDangNoi || "",
        lastShopLine: c.tinShopTruoc || "",
        orderContext: c.boiCanh || "",
        recentTurns: c.hoiThoaiGanDay || "",
        timeoutMs: 15000
      });
      if (!r || !r.ok) r = await classifyIntent({ text: c.tin, timeoutMs: 20000 });   // thử lại 1 lần
      ra[k] = {
        tin: c.tin, nhanDung: c.nhanDung || "",
        nhanDoan: (r && r.ok) ? r.kind : "(LỖI)",
        diem: (r && r.ok) ? r.do_tin_cay : null,
        loi: (r && r.ok) ? "" : ((r && r.reason) || "khong-ro")
      };
      xong++;
      if (xong % 10 === 0) process.stdout.write("  ...đã đo " + xong + "/" + ds.length + "\n");
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, songSong) }, tho));
  return ra;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function co(c) { return process.argv.includes(c); }
function tham(c, md) { const i = process.argv.indexOf(c); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : md; }

async function main() {
  if (co("--tao-mau")) return taoMau();

  const turnLog = require("../tien_ich/turn_log");
  const { ds: boCa, nguon, chuan } = docBoCa(tham("--file", ""));
  const soCa = Number(tham("--so", 0)) || boCa.length;
  const ds0 = boCa.slice(0, soCa);
  const nguongMD = Number(tham("--nguong", process.env.NGUONG_TIN_CAY || 0.6));

  console.log("=".repeat(74));
  console.log("ĐO ĐỘ CHÍNH XÁC GẮN NHÃN — GỌI API THẬT");
  console.log("bộ ca          :", nguon, "(" + ds0.length + " ca)");
  console.log("ngưỡng đang xét:", nguongMD, "(NGUONG_TIN_CAY)");
  if (!chuan) {
    console.log("! CHƯA CÓ NHÃN CHUẨN: đang mượn nhãn của BẢN ĐANG CHẠY làm 'nhãn đúng'.");
    console.log("  -> con số dưới đây là ĐỘ LỆCH so với bản đang chạy, KHÔNG phải độ chính xác.");
    console.log("  -> muốn đo thật: node do_do_nhan.js --tao-mau  rồi dán nhãn tay.");
  }
  console.log("=".repeat(74));

  let kq, chiPhi = null;
  await turnLog.run({ conversationId: "do_do_nhan" }, async () => {
    kq = await doThat(ds0, { songSong: Number(tham("--song-song", 4)) });
    const t = turnLog.hienTai();
    if (t) chiPhi = { vao: t.tokenVao, ra: t.tokenRa, tien: t.tienUSD };
  });

  const loi = kq.filter(x => x.loi);
  if (loi.length) console.log("\n! " + loi.length + "/" + kq.length + " ca GỌI LỖI (" + [...new Set(loi.map(x => x.loi))].join(", ") + ") — không tính vào số liệu.");
  const ds = kq.filter(x => !x.loi);

  // --- Ca cần nhìn tận mắt ---
  const xau = ds.filter(x => x.nhanDung && phanLoai(x, nguongMD) !== "dung");
  console.log("\n[CA KHÔNG ĐÚNG Ở NGƯỠNG " + nguongMD + "] (" + xau.length + " ca)");
  for (const x of xau.sort((a, b) => (a.diem == null ? 1 : a.diem) - (b.diem == null ? 1 : b.diem))) {
    const loai = phanLoai(x, nguongMD) === "sai" ? "SAI        " : "KHÔNG QUYẾT";
    console.log("  " + loai + " | " + String(x.diem).padEnd(5) + " | " + String(x.nhanDoan).padEnd(20) + " (đúng: " + x.nhanDung + ")");
    console.log("              \"" + String(x.tin).replace(/\s+/g, " ").slice(0, 62) + "\"");
  }
  if (co("--tat-ca")) {
    console.log("\n[MỌI CA]");
    for (const x of ds) console.log("  " + String(x.diem).padEnd(5) + " | " + String(x.nhanDoan).padEnd(20) + " | \"" + String(x.tin).replace(/\s+/g, " ").slice(0, 50) + "\"");
  }

  // --- Phân bố điểm ---
  const bin = {};
  for (const x of ds) { const b = x.diem == null ? "không chấm" : String(x.diem); bin[b] = (bin[b] || 0) + 1; }
  console.log("\n[PHÂN BỐ ĐIỂM]");
  Object.keys(bin).sort((a, b) => parseFloat(a) - parseFloat(b))
    .forEach(k => console.log("  " + String(k).padEnd(11) + " " + "#".repeat(bin[k]) + " " + bin[k]));

  // --- Quét ngưỡng ---
  console.log("\n[QUÉT NGƯỠNG]  (SAI = bot tự tin trả sai nhánh — phải kéo về 0 trước)");
  console.log("  ngưỡng | ĐÚNG | SAI | KHÔNG QUYẾT (giao người thật)");
  const { bang, tot_nhat, datDuocSaiToiDa, giaSai: tot_nhat_gia } = quetNguong(ds, { giaSai: Number(tham("--gia-sai", 5)) });
  for (const r of bang) {
    const dau = r.nguong === tot_nhat.nguong ? " <== đề xuất"
      : (Math.abs(r.nguong - nguongMD) < 1e-9 ? " <== đang đặt" : "");
    console.log("  " + String(r.nguong).padEnd(6) + " | " + String(r.dung).padEnd(4) + " | " + String(r.sai).padEnd(3) + " | " + r.khong_quyet + dau);
  }
  if (datDuocSaiToiDa) {
    console.log("\n  -> ĐỀ XUẤT NGUONG_TIN_CAY=" + tot_nhat.nguong + " (SAI=0, ĐÚNG=" + tot_nhat.dung + ", giao người thật " + tot_nhat.khong_quyet + "/" + ds.length + ")");
  } else {
    console.log("\n  -> KHÔNG ngưỡng nào cho SAI=0: điểm cao vẫn có nhãn sai -> NGƯỠNG KHÔNG CỨU ĐƯỢC, phải sửa PROMPT.");
    console.log("     Cân đo tạm (1 ca SAI = " + tot_nhat_gia + " ca không quyết): NGUONG_TIN_CAY=" + tot_nhat.nguong
      + " (ĐÚNG=" + tot_nhat.dung + ", SAI=" + tot_nhat.sai + ", giao người thật " + tot_nhat.khong_quyet + "/" + ds.length + ")");
  }

  // --- Nhãn nào yếu ---
  const bangNhan = theoNhan(ds, nguongMD);
  const yeu = Object.entries(bangNhan).filter(([, v]) => v.sai || v.khong_quyet);
  if (yeu.length) {
    console.log("\n[NHÃN YẾU Ở NGƯỠNG " + nguongMD + "] (sửa dòng luật tương ứng trong SYS của ai_intent.js)");
    yeu.sort((a, b) => (b[1].sai - a[1].sai) || (b[1].khong_quyet - a[1].khong_quyet))
       .forEach(([k, v]) => console.log("  " + k.padEnd(22) + " đúng " + v.dung + "  sai " + v.sai + "  không quyết " + v.khong_quyet));
  }

  if (chiPhi) console.log("\n[CHI PHÍ] " + ds0.length + " lượt | token vào " + chiPhi.vao + " ra " + chiPhi.ra + " | " + chiPhi.tien + " USD");

  const luu = tham("--luu", "");
  if (luu) {
    fs.writeFileSync(luu, JSON.stringify({ nguon, chuan, nguongMD, ketQua: kq, quet: bang, theoNhan: bangNhan, chiPhi }, null, 2));
    console.log("Đã lưu: " + luu);
  }
}

module.exports = { phanLoai, dem, quetNguong, theoNhan };

if (require.main === module) main().catch(e => { console.error("LỖI:", e && e.message); process.exit(1); });
