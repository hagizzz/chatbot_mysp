#!/usr/bin/env node
const __goc = require("path").join(__dirname, "..", "..");
// ============================================================================
// bo_nhan_chuan.js — DỰNG BỘ NHÃN CHUẨN (mốc để đo bot gắn nhãn đúng hay sai)
// ----------------------------------------------------------------------------
// do_do_nhan.js đo được bot gắn nhãn ĐÚNG hay SAI, nhưng phải có cái để so.
// Trước đây nó mượn tạm nhãn của BẢN ĐANG CHẠY làm chuẩn — mà chính bản đang
// chạy mới là thứ cần kiểm, nên con số đo ra chỉ là "lệch so với bản cũ".
//
// Tệp này dựng bộ chuẩn thật, 3 việc:
//
//   node bo_nhan_chuan.js rut        # gom câu khách thật trên máy + che riêng tư
//   node bo_nhan_chuan.js xuat-csv   # ra tệp .csv cho shop mở Excel sửa nhãn
//   node bo_nhan_chuan.js nap-csv    # nạp tệp shop đã sửa -> nhan_chuan.json
//
// Rồi: node do_do_nhan.js  -> tự thấy nhan_chuan.json và đo theo nhãn shop chốt.
//
// RIÊNG TƯ: mọi câu đi qua test/che_du_lieu.js — số điện thoại/số dài trong tin
// bị thay bằng số giả, conversationId băm lại. Tệp ra chép đi đâu cũng được.
// ============================================================================
const fs = require("fs");
const path = require("path");

const { che } = require("../../test/che_du_lieu");
const { KINDS } = require("../ai/ai_intent");

const RA = path.join(__goc, "test", "ca_vang");
const POOL = path.join(RA, "cau_can_dan_nhan.json");
const CSV = path.join(RA, "nhan_chuan.csv");
const JSON_CHUAN = path.join(RA, "nhan_chuan.json");

// ---------------------------------------------------------------------------
// Phần TÍNH TOÁN — hàm thuần, test offline được (test/bo_nhan_chuan.test.js).
// ---------------------------------------------------------------------------

/** Khoá so trùng: bỏ dấu cách thừa + không phân biệt hoa thường. */
function khoaTrung(tin) {
  return String(tin || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Bóc các lượt khách từ log pm2. Log ghi theo khối:
 *     ------------------------------
 *     Khách: <tên> | Conv: <id>
 *     Tin: text: <câu khách>            (có thể kèm " | image: [Photo]")
 *     ... [AI-READ] nhãn=<nhãn bản đang chạy> ...
 *     ... MẪU: <Tên>(<Mã>)=<giá> ...
 * Lấy được cả ẢNH và MẪU ĐÃ BÁO GIÁ -> đó là ngữ cảnh, thiếu nó thì nhiều câu
 * chấm đúng/sai kiểu gì cũng cãi được ("mấy ngày nhận đồ" = hỏi ship hay hỏi đơn?).
 */
function bocTuLog(noiDung) {
  const ra = [];
  const dong = String(noiDung || "").split("\n");
  for (let i = 0; i < dong.length; i++) {
    const m = dong[i].match(/Tin: text: (.+)$/);
    if (!m) continue;
    let tin = m[1].trim();
    const coAnh = / \| image:/.test(tin);
    tin = tin.replace(/ \| (image|text):.*$/, "").trim();
    if (!tin) continue;
    let nhanCu = "", mau = "";
    for (let j = i + 1; j < Math.min(i + 25, dong.length); j++) {
      if (/Tin: text: /.test(dong[j])) break;                       // sang lượt khác
      const a = dong[j].match(/\[AI-READ\] nhãn=([A-Z_]+)/);
      if (a && !nhanCu) nhanCu = a[1];
      const b = dong[j].match(/MẪU: ([^\n|]+)/);
      if (b && !mau) mau = b[1].trim();
    }
    ra.push({ tin, coAnh, nhanCu, mauDangNoi: mau });
  }
  return ra;
}

/** Gộp nhiều nguồn, bỏ trùng, câu quá ngắn/vô nghĩa thì loại. */
function gopBoCa(cacNguon) {
  const pool = new Map();
  for (const { ds, nguon } of cacNguon) {
    for (const c of ds) {
      const k = khoaTrung(c.tin);
      if (!k || k.length < 2) continue;
      const cu = pool.get(k);
      if (!cu) { pool.set(k, { ...c, tin: che(c.tin), nguon }); continue; }
      // giữ bản có nhiều ngữ cảnh hơn
      if (!cu.mauDangNoi && c.mauDangNoi) cu.mauDangNoi = c.mauDangNoi;
      if (!cu.nhanCu && c.nhanCu) cu.nhanCu = c.nhanCu;
      if (!cu.coAnh && c.coAnh) cu.coAnh = true;
      if (!cu.tinShopTruoc && c.tinShopTruoc) cu.tinShopTruoc = c.tinShopTruoc;
      if (!cu.daChotDon && c.daChotDon) cu.daChotDon = true;
    }
  }
  return [...pool.values()];
}

// --- CSV: tự viết, không thêm thư viện cho một việc nhỏ ---------------------
function oCsv(v) {
  const s = String(v == null ? "" : v);
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function raCsv(ds) {
  const cot = ["stt", "cau_khach", "co_anh", "mau_dang_noi", "tin_shop_truoc", "da_chot_don",
    "nhan_bot_dang_gan", "nhan_dung", "can_duyet", "ghi_chu"];
  const dong = [cot.join(",")];
  ds.forEach((c, i) => dong.push([
    i + 1, oCsv(c.tin), c.coAnh ? "có" : "", oCsv(c.mauDangNoi || ""),
    oCsv(c.tinShopTruoc || ""), c.daChotDon ? "rồi" : "",
    c.nhanCu || "", c.nhanDeXuat || c.nhanCu || "", c.canDuyet ? "XEM KỸ" : "", oCsv(c.ghiChu || "")
  ].join(",")));
  return dong.join("\r\n");
}

/** Đọc CSV shop đã sửa. Excel hay đổi dấu phân cách sang ';' -> nhận cả hai. */
function docCsv(vanBan) {
  const s = String(vanBan || "").replace(/^﻿/, "");
  const dau = (s.split("\n")[0].match(/;/g) || []).length > (s.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
  const o = [];
  let cur = "", trongNhay = false, dong = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (trongNhay) {
      if (ch === '"' && s[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') trongNhay = false;
      else cur += ch;
      continue;
    }
    if (ch === '"') { trongNhay = true; continue; }
    if (ch === dau) { dong.push(cur); cur = ""; continue; }
    if (ch === "\n") { dong.push(cur); o.push(dong); dong = []; cur = ""; continue; }
    if (ch === "\r") continue;
    cur += ch;
  }
  if (cur !== "" || dong.length) { dong.push(cur); o.push(dong); }
  if (!o.length) return [];
  const cot = o[0].map(x => x.trim());
  return o.slice(1).filter(r => r.some(x => String(x).trim()))
    .map(r => Object.fromEntries(cot.map((k, i) => [k, (r[i] || "").trim()])));
}

/** Đổi hàng CSV -> ca đo. Nhãn lạ (gõ sai/không có trong bộ 68) phải KÊU, không nuốt. */
function tuCsv(hang) {
  const hopLe = new Set(KINDS);
  const ca = [], loi = [];
  hang.forEach((h, i) => {
    const tin = h.cau_khach || h.tin || "";
    const nhan = String(h.nhan_dung || "").toUpperCase().trim();
    if (!tin) return;
    if (!nhan) { loi.push(`dòng ${i + 2}: chưa dán nhãn — "${tin.slice(0, 40)}"`); return; }
    if (!hopLe.has(nhan)) { loi.push(`dòng ${i + 2}: nhãn "${nhan}" không có trong bộ 68 nhãn — "${tin.slice(0, 40)}"`); return; }
    ca.push({
      tin, nhanDung: nhan,
      mauDangNoi: h.mau_dang_noi || "",
      tinShopTruoc: h.tin_shop_truoc || "",
      boiCanh: h.boi_canh || [h.co_anh ? "Khách gửi kèm ảnh mẫu." : "", h.da_chot_don ? "Đã chốt đơn." : ""].filter(Boolean).join(" "),
      hoiThoaiGanDay: ""
    });
  });
  return { ca, loi };
}

// ---------------------------------------------------------------------------
// Phần CHẠY THẬT
// ---------------------------------------------------------------------------
function docNguon() {
  const nguon = [];

  // 1. Bộ ca vàng (đã che sẵn) — có nhãn bản đang chạy để đối chiếu.
  const fCaVang = path.join(RA, "nhan_y_dinh.json");
  if (fs.existsSync(fCaVang)) {
    nguon.push({
      nguon: "ca_vang",
      ds: JSON.parse(fs.readFileSync(fCaVang, "utf8"))
        .filter(c => c.tinKhach)
        .map(c => ({
          tin: c.tinKhach,
          coAnh: !!(c.boiCanh && c.boiCanh.daGuiAnh),
          nhanCu: (c.mong && c.mong.nhanAI) || "",
          mauDangNoi: (c.mong && c.mong.maSanPham) || ""
        }))
    });
  }

  // 2. Bộ nhớ hội thoại (SQLite + bản JSON cũ) — có cả câu shop nhắn ngay trước.
  const dsBoNho = [];
  try {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(path.join(__goc, "conversation_memory.db"), { readOnly: true });
    for (const r of db.prepare("select du_lieu from hoi_thoai").all()) {
      let d; try { d = JSON.parse(r.du_lieu); } catch (_) { continue; }
      if (!d || !d._lastCustText) continue;
      dsBoNho.push({
        tin: d._lastCustText,
        coAnh: !!d._imgShownBefore,
        nhanCu: d._aiIntent || "",
        mauDangNoi: (d.currentProduct && (d.currentProduct.name || d.currentProduct.code)) || "",
        tinShopTruoc: d.lastBotReply || "",
        daChotDon: !!d.orderClosed
      });
    }
  } catch (e) { console.log("  (bỏ qua bộ nhớ SQLite:", e.message + ")"); }
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__goc, "conversation_memory.json"), "utf8"));
    for (const k of Object.keys(j)) {
      const d = j[k];
      if (d && d._lastCustText) dsBoNho.push({
        tin: d._lastCustText, coAnh: false, nhanCu: d._aiIntent || "",
        mauDangNoi: (d.currentProduct && (d.currentProduct.name || d.currentProduct.code)) || "",
        tinShopTruoc: d.lastBotReply || "", daChotDon: !!d.orderClosed
      });
    }
  } catch (_) {}
  if (dsBoNho.length) nguon.push({ nguon: "bo_nho", ds: dsBoNho });

  // 3. Log pm2 đang có trên máy.
  const dsLog = [];
  const tep = [];
  for (const f of fs.readdirSync(__goc)) if (/^(log|dump|ln|tl|pp|gd|mona|ngockoy|vid|raw|why|order|fresh|httt|lichsu_log|soi_nhan_log)\w*\.txt$/i.test(f)) tep.push(path.join(__goc, f));
  const thuMucLog = path.join(__goc, "botlog");
  if (fs.existsSync(thuMucLog)) for (const f of fs.readdirSync(thuMucLog)) {
    const p = path.join(thuMucLog, f);
    try { if (fs.statSync(p).isFile()) tep.push(p); } catch (_) {}
  }
  for (const p of tep) {
    try { dsLog.push(...bocTuLog(fs.readFileSync(p, "utf8"))); } catch (_) {}
  }
  if (dsLog.length) nguon.push({ nguon: "log", ds: dsLog });

  // 4. Nhật ký lượt (turn_log) — ít dòng nhưng đầy đủ nhất.
  const dsTurn = [];
  const dTurn = path.join(__goc, "data", "turnlog");
  if (fs.existsSync(dTurn)) for (const f of fs.readdirSync(dTurn)) {
    for (const l of fs.readFileSync(path.join(dTurn, f), "utf8").split("\n")) {
      let d; try { d = JSON.parse(l); } catch (_) { continue; }
      if (d && d.khachText) dsTurn.push({
        tin: d.khachText, coAnh: !!d.coAnh, nhanCu: d.intent || "",
        mauDangNoi: (d.sanPham && (d.sanPham.ten || d.sanPham.ma)) || ""
      });
    }
  }
  if (dsTurn.length) nguon.push({ nguon: "turnlog", ds: dsTurn });

  return nguon;
}

function rut() {
  const nguon = docNguon();
  const ds = gopBoCa(nguon);
  fs.mkdirSync(RA, { recursive: true });
  fs.writeFileSync(POOL, JSON.stringify(ds, null, 2));
  const dem = {};
  for (const c of ds) dem[c.nguon] = (dem[c.nguon] || 0) + 1;
  console.log("Nguồn đọc được:", nguon.map(n => `${n.nguon}=${n.ds.length}`).join(", "));
  console.log(`Sau khi bỏ trùng: ${ds.length} câu duy nhất`, JSON.stringify(dem));
  console.log("Đã ghi:", POOL);
  console.log("Bước sau: node bo_nhan_chuan.js xuat-csv");
}

function xuatCsv() {
  if (!fs.existsSync(POOL)) { console.log("Chưa có " + POOL + " — chạy: node bo_nhan_chuan.js rut"); return; }
  const ds = JSON.parse(fs.readFileSync(POOL, "utf8"));
  fs.writeFileSync(CSV, "﻿" + raCsv(ds), "utf8");   // BOM để Excel không vỡ dấu tiếng Việt
  const fNhan = path.join(RA, "danh_sach_nhan.txt");
  fs.writeFileSync(fNhan, KINDS.join("\n"), "utf8");
  console.log(`Đã ghi ${CSV} (${ds.length} câu) + ${fNhan} (68 nhãn để tra).`);
  console.log("Mở bằng Excel, sửa cột 'nhan_dung', ưu tiên các dòng có 'XEM KỸ'. Lưu lại vẫn định dạng CSV.");
  console.log("Xong thì: node bo_nhan_chuan.js nap-csv");
}

function napCsv(tep) {
  const f = tep || CSV;
  if (!fs.existsSync(f)) { console.log("Không thấy " + f); return; }
  const { ca, loi } = tuCsv(docCsv(fs.readFileSync(f, "utf8")));
  if (loi.length) {
    console.log(`! ${loi.length} dòng chưa dùng được:`);
    loi.slice(0, 20).forEach(x => console.log("   " + x));
    if (loi.length > 20) console.log(`   ... còn ${loi.length - 20} dòng nữa`);
  }
  if (!ca.length) { console.log("Không nạp được ca nào — dừng, KHÔNG ghi đè nhan_chuan.json."); return; }
  fs.writeFileSync(JSON_CHUAN, JSON.stringify(ca, null, 2));
  console.log(`Đã ghi ${JSON_CHUAN}: ${ca.length} ca có nhãn chuẩn.`);
  console.log("Đo ngay: node do_do_nhan.js");
}

module.exports = { khoaTrung, bocTuLog, gopBoCa, raCsv, docCsv, tuCsv };

if (require.main === module) {
  const lenh = process.argv[2];
  if (lenh === "rut") rut();
  else if (lenh === "xuat-csv") xuatCsv();
  else if (lenh === "nap-csv") napCsv(process.argv[3]);
  else {
    console.log("Cách dùng:");
    console.log("  node bo_nhan_chuan.js rut         # gom câu khách thật trên máy (đã che riêng tư)");
    console.log("  node bo_nhan_chuan.js xuat-csv    # ra tệp CSV cho shop mở Excel dán nhãn");
    console.log("  node bo_nhan_chuan.js nap-csv     # nạp CSV shop đã sửa -> nhan_chuan.json");
  }
}
