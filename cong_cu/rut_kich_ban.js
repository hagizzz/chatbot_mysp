#!/usr/bin/env node
const __goc = require("path").join(__dirname, "..");
// ============================================================================
// rut_kich_ban.js — CÔNG CỤ RÚT CÂU VIẾT CỨNG VỀ KHO KỊCH BẢN
// ----------------------------------------------------------------------------
// 870 câu mà rút tay thì vừa lâu vừa chắc chắn sai. Công cụ này làm ba việc:
//   1. Tìm câu nhắn khách còn viết cứng trong một khoảng dòng.
//   2. Đặt khoá, ghi vào kich_ban/mac_dinh.json (kèm mô tả để người kinh doanh
//      biết câu đó dùng lúc nào).
//   3. Thay chỗ viết cứng bằng KB.cau("khoá", {biến}).
//
// CHỐT AN TOÀN — đây mới là phần quan trọng nhất:
// Sau khi thay, công cụ dựng lại câu từ kho rồi so với chuỗi gốc theo TỪNG KÝ
// TỰ. Lệch một dấu cách là dừng, không ghi gì. Không có chốt này thì không ai
// dám rút 870 câu.
//
//   node rut_kich_ban.js --thu --tu 700 --den 1000      # xem trước, KHÔNG ghi
//   node rut_kich_ban.js --tu 700 --den 1000            # rút thật
//   node rut_kich_ban.js --ham buildShipOriginReply     # rút đúng 1 hàm
//   node rut_kich_ban.js --kiem                         # soi lại toàn kho
//
// Luôn chạy `npm test` sau mỗi lô.
// ============================================================================
const fs = require("fs");
const path = require("path");
const nc = require("../loi/cau_noi/nguon_cau");

const GOC = __goc;
const TEP_NGUON = process.env.RUT_TEP || "bot_worker_api_v3.js";
const TEP_KHO = path.join(GOC, "kich_ban", "mac_dinh.json");

const argv = process.argv.slice(2);
const co = c => argv.includes(c);
const lay = (c, md) => { const i = argv.indexOf(c); return i >= 0 ? argv[i + 1] : md; };

const THU = co("--thu");
const TU = Number(lay("--tu", 0));
const DEN = Number(lay("--den", Infinity));
const HAM = lay("--ham", null);
const CHI_KIEM = co("--kiem");
const XEP_HANG = co("--xep-hang");

// --- Tìm hàm bao quanh một vị trí ------------------------------------------
// Bản đồ "vị trí trong tệp -> đang nằm trong hàm nào".
//
// Trước đây chỉ bắt `function X(`. Trong bot_worker, khai báo kiểu ấy cuối cùng
// là `_aiQuyetHanhDong` — nên MỌI chuỗi từ đó tới hết tệp (4.600 dòng, cả vùng
// dispatch) đều bị gán về một cái tên, và bảng xếp hạng "nhánh nào đẻ nhiều câu
// nhất" chỉ ra một dòng vô nghĩa 339 câu. Bảng đó là thứ dùng để quyết định thứ
// tự rút, sai bảng thì rút sai chỗ. Nay bắt thêm bốn dạng khai báo còn lại.
// Nhưng thêm mẫu khai báo thôi thì chưa đủ, vì bản đồ cũ KHÔNG BIẾT HÀM KẾT
// THÚC Ở ĐÂU — nó chỉ lấy "khai báo gần nhất phía trên". Một hàm con khai báo
// giữa chừng là ôm trọn phần đuôi của hàm mẹ. Nên phải đo cả VÙNG của hàm bằng
// cách đếm ngoặc, rồi chọn hàm TRONG CÙNG bao quanh vị trí đó.
//
// Đếm ngoặc thì phải né chuỗi / chú thích / regex, kẻo một dấu "{" trong câu
// tiếng Việt làm lệch toàn bộ. Che chúng đi trước, giữ nguyên độ dài để mọi vị
// trí vẫn khớp với tệp gốc.
function cheSrc(src) {
  const ra = src.split("");
  const n = src.length;
  const TRUOC_REGEX = "=(,:[!&|?{};+*%~^\n";
  let i = 0;
  const xoa = (tu, den) => { for (let k = tu; k < den && k < n; k++) if (ra[k] !== "\n") ra[k] = " "; };

  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { const t = i; while (i < n && src[i] !== "\n") i++; xoa(t, i); continue; }
    if (c === "/" && src[i + 1] === "*") {
      const t = i; i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2; xoa(t, i); continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const moc = c, t = i; i++;
      while (i < n) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === moc) { i++; break; }
        if (src[i] === "\n" && moc !== "`") break;
        i++;
      }
      xoa(t, i); continue;
    }
    if (c === "/") {                                  // regex hay phép chia?
      let k = i - 1;
      while (k >= 0 && (src[k] === " " || src[k] === "\t")) k--;
      const truoc = k < 0 ? "\n" : src[k];
      if (TRUOC_REGEX.includes(truoc)) {
        const t = i; i++;
        let trongNgoac = false;
        while (i < n) {
          const d = src[i];
          if (d === "\\") { i += 2; continue; }
          if (d === "\n") break;
          if (d === "[") trongNgoac = true;
          else if (d === "]") trongNgoac = false;
          else if (d === "/" && !trongNgoac) { i++; break; }
          i++;
        }
        xoa(t, i); continue;
      }
    }
    i++;
  }
  return ra.join("");
}

const CHAN_TU_KHOA = new Set([
  "if", "for", "while", "switch", "catch", "return", "function", "do", "else",
  "try", "finally", "with", "typeof", "await", "new", "delete", "case"
]);
function banDoHam(srcThat) {
  const src = cheSrc(srcThat);
  const ds = [];
  const them = (ten, tai) => { if (ten && !CHAN_TU_KHOA.has(ten)) ds.push({ ten, tai }); };

  const dsRe = [
    // function X( … )                     — khai báo thường
    /(?:^|\n)[ \t]*(?:async[ \t]+)?function[ \t]+([A-Za-z0-9_$]+)[ \t]*\(/g,
    // const X = ( … ) => | function | x => — gán vào biến
    /(?:^|\n)[ \t]*(?:const|let|var)[ \t]+([A-Za-z0-9_$]+)[ \t]*=[ \t]*(?:async[ \t]*)?(?:function\b|\([^()\n]*\)[ \t]*=>|[A-Za-z0-9_$]+[ \t]*=>)/g,
    // X: ( … ) => | function                — thuộc tính của đối tượng
    /(?:^|\n)[ \t]*([A-Za-z0-9_$]+)[ \t]*:[ \t]*(?:async[ \t]*)?(?:function\b|\([^()\n]*\)[ \t]*=>)/g,
    // X( … ) {                             — phương thức viết tắt / trong class
    /(?:^|\n)[ \t]+(?:async[ \t]+)?([A-Za-z0-9_$]+)[ \t]*\([^()\n]*\)[ \t]*\{/g
  ];
  for (const re of dsRe) {
    let m;
    while ((m = re.exec(src))) them(m[1], m.index);
  }

  // Đo vùng: từ dấu "{" mở thân hàm tới dấu "}" đóng khớp với nó.
  const ra = [];
  for (const h of ds) {
    let i = src.indexOf("{", h.tai);
    if (i < 0) continue;
    let sau = 0, den = -1;
    for (let k = i; k < src.length; k++) {
      if (src[k] === "{") sau++;
      else if (src[k] === "}") { sau--; if (sau === 0) { den = k; break; } }
    }
    if (den < 0) continue;                     // ngoặc lệch -> bỏ, thà thiếu còn hơn sai
    ra.push({ ten: h.ten, tai: h.tai, den });
  }
  ra.sort((a, b) => a.tai - b.tai);
  return ra;
}
// Hàm dispatch của bot dài 6.800 dòng — biết câu nằm trong nó thì vẫn chưa biết
// rút cái gì. Nhưng trong đó có 239 BIỂN BÁO NHÁNH do chính người viết đặt
// ("// ===== HẬU MÃI: … =====", "// [FIX Khoai Khoai] …"). Đó mới là tên nhánh
// thật. Lấy chúng làm tên nhóm cho bảng xếp hạng.
function banDoBien(src) {
  const ds = [];
  const re = /(?:^|\n)[ \t]*\/\/[ \t]*(?:=+[ \t]*)?(\[[^\]\n]{2,40}\]|[^\n=]{4,60})/g;
  let m;
  while ((m = re.exec(src))) {
    const ten = String(m[1])
      .replace(/[=\[\]]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 44);
    if (ten.length >= 4) ds.push({ ten, tai: m.index });
  }
  return ds;
}

// Tên nhóm để xếp hạng: hàm trong cùng, và nếu hàm đó to quá thì kèm biển báo
// nhánh gần nhất phía trên — vì "rút processOneConversation" không phải một
// việc làm được, còn "rút nhánh HẬU MÃI" thì có.
const HAM_TO = 200 * 60;      // ~200 dòng, đo bằng ký tự cho khỏi phải đếm dòng
function nhomCua(dsHam, dsBien, viTri) {
  let ten = "chung", hep = Infinity, tu = -1;
  for (const h of dsHam) {
    if (h.tai > viTri) break;
    if (viTri <= h.den && (h.den - h.tai) < hep) { ten = h.ten; hep = h.den - h.tai; tu = h.tai; }
  }
  if (hep < HAM_TO) return ten;
  let bien = null;
  for (const b of dsBien) {
    if (b.tai > viTri) break;
    if (b.tai >= tu) bien = b.ten;
  }
  return bien ? `${ten} ▸ ${bien}` : ten;
}

// Hàm TRONG CÙNG bao quanh vị trí này. Trong cùng = vùng hẹp nhất, vì hàm con
// nằm gọn trong hàm mẹ; lấy hàm mẹ thì mọi câu của mọi hàm con dồn hết về một
// tên và bảng xếp hạng lại thành vô nghĩa.
function hamBaoQuanh(dsHam, viTri) {
  let ten = "chung", hep = Infinity;
  for (const h of dsHam) {
    if (h.tai > viTri) break;
    if (viTri <= h.den && (h.den - h.tai) < hep) { ten = h.ten; hep = h.den - h.tai; }
  }
  return ten;
}

// --- Đặt khoá --------------------------------------------------------------
function bo_dau(s) {
  return String(s).toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
function tenHamSangKhoa(ten) {
  // buildShipOriginReply -> build_ship_origin_reply -> bỏ mấy tiền tố vô nghĩa
  return bo_dau(ten.replace(/([a-z0-9])([A-Z])/g, "$1_$2"))
    .replace(/^(build|get|make|send|maybe)_/, "")
    .replace(/_(reply|text|msg|message)$/, "");
}
function datKhoa(tenHam, noiDung, daDung) {
  const nhom = tenHamSangKhoa(tenHam) || "chung";
  const chu = bo_dau(String(noiDung).split(nc.MOC_BIEN).join(" ")).split("_").filter(Boolean);
  // bỏ mấy từ mở đầu không phân biệt được câu nào với câu nào
  while (chu.length && ["da", "chi", "a", "vang", "em"].includes(chu[0])) chu.shift();
  let khoa = (nhom + "__" + chu.slice(0, 5).join("_")).slice(0, 72).replace(/_+$/, "");
  if (!daDung.has(khoa)) return khoa;
  for (let i = 2; i < 99; i++) if (!daDung.has(khoa + "_" + i)) return khoa + "_" + i;
  return khoa + "_" + Date.now();
}

// --- Danh sách KHÔNG RÚT (người duyệt tự thêm) -----------------------------
// kich_ban/khong_rut.txt: mỗi dòng là một chuỗi JSON đúng nội dung cần bỏ.
// So theo NỘI DUNG chứ không theo số dòng, để danh sách không mục nát mỗi lần
// mã nguồn xê dịch. Dùng cho thứ máy không tự nhận ra là dữ liệu — địa chỉ viết
// thẳng trong hàm, tên riêng, mã vận đơn…
function docKhongRut() {
  const bo = new Set();
  try {
    const t = fs.readFileSync(path.join(GOC, "kich_ban", "khong_rut.txt"), "utf8");
    for (const d of t.split("\n")) {
      const s = d.trim();
      if (!s || s.startsWith("#")) continue;
      try { bo.add(JSON.parse(s)); } catch (_) { bo.add(s); }
    }
  } catch (_) {}
  return bo;
}

// --- Vùng DỮ LIỆU: const VIẾT_HOA = { … } / [ … ] ---------------------------
// Số tài khoản, tên chủ tài khoản, địa chỉ showroom, bảng size… là DỮ LIỆU của
// shop, không phải LỜI. Chúng cũng cần tách theo shop, nhưng đó là việc khác
// (cấu hình shop), không phải kho kịch bản. Rút nhầm vào đây là lẫn lộn kiểu mới.
function vungDuLieu(src) {
  const vung = [];
  const re = /(?:^|\n)\s*(?:const|let|var)\s+([A-Z][A-Z0-9_]{2,})\s*=\s*([{[])/g;
  let m;
  while ((m = re.exec(src))) {
    const mo = m[2], dong = mo === "{" ? "}" : "]";
    let i = src.indexOf(mo, m.index), sau = 0;
    const batDau = i;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === mo) sau++;
      else if (c === dong) { sau--; if (!sau) break; }
      else if (c === '"' || c === "'" || c === "`") {          // nhảy qua chuỗi
        const moc = c; i++;
        while (i < src.length && src[i] !== moc) { if (src[i] === "\\") i++; i++; }
      }
    }
    vung.push({ ten: m[1], tu: batDau, den: i });
  }
  return vung;
}
function trongVungDuLieu(vung, viTri) {
  for (const v of vung) if (viTri > v.tu && viTri < v.den) return v.ten;
  return null;
}

// --- Chuỗi này có nên rút không? -------------------------------------------
function nenRut(c, src, vungDL, khongRut) {
  if (khongRut.has(c.noiDung)) return "trong danh sách không rút";
  const van = nc.vanDaiNhat(c.noiDung);
  if (van.length < 12) return "vân quá ngắn";
  if (!nc.khachCoTheThay(c.noiDung, van)) return "log/prompt nội bộ";
  if (/\\/.test(src.slice(c.batDau, c.ketThuc))) return "có ký tự thoát lạ";
  if (!/[a-zÀ-ỹ]{3}/i.test(c.noiDung)) return "không phải câu tiếng Việt";
  // Không có khoảng trắng -> là KHOÁ / mã / hằng, không phải câu nói.
  if (!/\s/.test(c.noiDung.trim())) return "không có khoảng trắng (khoá/mã)";

  // Đứng sau console.log( trên cùng dòng -> là log, không phải câu nhắn khách.
  const dauDong = src.lastIndexOf("\n", c.batDau) + 1;
  const truoc = src.slice(dauDong, c.batDau);
  if (/console\.log\s*\(|console\.error\s*\(/.test(truoc)) return "nằm trong console.log";

  // Là VẾ SO SÁNH hoặc KHOÁ đối tượng -> không phải câu gửi đi.
  const sau = src.slice(c.ketThuc, c.ketThuc + 3);
  if (/^\s*:/.test(sau) && !/[?]\s*$/.test(truoc)) return "đang làm khoá đối tượng";
  if (/(===|!==|==|!=)\s*$/.test(truoc)) return "đang làm vế so sánh";
  if (/\.(includes|startsWith|endsWith|indexOf|split|replace|match|test)\s*\(\s*$/.test(truoc)) return "đang làm tham số so khớp";
  if (/\brequire\s*\(\s*$/.test(truoc)) return "đường dẫn module";
  // Đang làm KHOÁ tra kho -> đã rút rồi, đừng rút khoá của chính nó.
  if (/(cauTheoLuatNgay|cauTheoLuat|KB\.cau|KB\.cacCau|KB\.prompt)\s*\(\s*$/.test(truoc)) return "là khoá kịch bản";
  // Nằm trong bảng dữ liệu của shop (số tài khoản, địa chỉ, bảng size…) -> không phải LỜI.
  const vd = trongVungDuLieu(vungDL, c.batDau);
  if (vd) return "nằm trong dữ liệu " + vd;
  if (!giongLoiNoiVoiKhach(c.noiDung)) return "không giống lời nói với khách";
  return null;
}

// Bộ lọc trên đây toàn là luật LOẠI TRỪ, và chúng được chỉnh vừa khít
// bot_worker. Đem nguyên sang tệp khác thì công cụ vơ cả lý do log ("không nhận
// diện tỉnh/thành" trong order_worker) lẫn câu SQL ("PRAGMA journal_mode =
// WAL") — rồi bảo là câu nói với khách. Thiếu một luật KHẲNG ĐỊNH.
//
// Dấu hiệu chắc tay nhất, và đúng cho mọi tệp của shop này: lời nói với khách
// bao giờ cũng mang tiếng xưng hô. Câu nào không có "dạ/ạ/chị/em/mình/nha/nhé"
// thì gần như chắc chắn là nhãn, log hoặc mã — cứ để lại, rút tay sau còn hơn
// rút nhầm rồi đẩy một dòng log vào kho kịch bản của shop.
const XUNG_HO = /(^|[\s(,"'“”\-])(dạ|ạ|chị|em|mình|nha|nhé|shop)([\s.,!?;:)"'“”\-]|$)/i;
function giongLoiNoiVoiKhach(s) {
  return XUNG_HO.test(String(s || ""));
}

// --- Đặt tên biến từ biểu thức ---------------------------------------------
function tenBien(bt, i, daCo) {
  let t = null;
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(bt.trim())) t = bt.trim();
  else {
    const m = bt.match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*\)?\s*$/);
    if (m) t = m[1];
  }
  t = (t && /^[A-Za-z_$]/.test(t)) ? t.replace(/^_+/, "") : "";
  if (!t || daCo.has(t)) t = "b" + (i + 1);
  daCo.add(t);
  return t;
}

// --- Bảng xếp hạng: rút nhánh nào trước? ------------------------------------
// Không có bảng này thì thứ tự rút là cảm tính, mà rút sai thứ tự nghĩa là bỏ
// công vào những nhánh khách gần như không chạm tới.
//
// Đọc cho đúng: đây là đếm câu TRONG MÃ, không phải câu bot đã nói với khách.
// Câu đã nói thì `npm run thong-ke-nguon` mới trả lời được, mà nó cần bot chạy
// thật vài ngày. Bảng này chỉ nói "chỗ nào nhiều chữ" — dùng khi chưa có số thật.
function inXepHang(rut) {
  const dem = new Map();
  for (const r of rut) dem.set(r.nhom, (dem.get(r.nhom) || 0) + 1);
  const ds = [...dem.entries()].sort((a, b) => b[1] - a[1]);
  const tong = rut.length || 1;

  console.log(`XẾP HẠNG NHÁNH — ${rut.length} câu rút được, gom thành ${ds.length} nhóm`);
  console.log("(đếm câu trong MÃ. Câu bot THẬT SỰ nói: npm run thong-ke-nguon)\n");

  let cong = 0;
  ds.forEach(([ten, n], i) => {
    cong += n;
    if (i < 25) console.log(`  ${String(n).padStart(4)}  ${String(((cong / tong) * 100).toFixed(0)).padStart(3)}%  ${ten}`);
  });
  if (ds.length > 25) console.log(`  … còn ${ds.length - 25} nhóm nhỏ`);

  let c2 = 0, canN = 0;
  for (const [, n] of ds) { c2 += n; canN++; if (c2 >= tong * 0.8) break; }
  console.log(`\nChỉ cần rút ${canN}/${ds.length} nhóm là phủ 80% số câu.`);
}

// --- Chốt an toàn: dựng lại từ kho phải KHỚP TỪNG KÝ TỰ --------------------
function khopTungKyTu(mau, noiDungGoc, bien) {
  // Thay {ten} bằng ký tự mốc rồi so các đoạn tĩnh với chuỗi gốc.
  let lai = mau;
  for (const b of bien) lai = lai.split("{" + b + "}").join(nc.MOC_BIEN);
  lai = lai.split("{{").join("{").split("}}").join("}");
  return lai === noiDungGoc;
}

// ===========================================================================
function main() {
  const duongDan = path.join(GOC, TEP_NGUON);
  const src = fs.readFileSync(duongDan, "utf8");
  const kho = JSON.parse(fs.readFileSync(TEP_KHO, "utf8"));
  kho.cau = kho.cau || {};

  if (CHI_KIEM) {
    const kq = require("../loi/cau_noi/kho_kich_ban").kiemTra();
    console.log(`Kho: ${Object.keys(kho.cau).length} câu.`);
    for (const l of kq.loi) console.log("  LỖI     " + l);
    for (const l of kq.canh_bao) console.log("  cảnh báo " + l);
    if (!kq.loi.length) console.log("  Không có lỗi.");
    process.exit(kq.loi.length ? 1 : 0);
  }

  const dsHam = banDoHam(src);
  const dsBien = banDoBien(src);
  const vungDL = vungDuLieu(src);
  const khongRut = docKhongRut();
  const chuoi = nc.tachChuoi(src);
  const daDung = new Set(Object.keys(kho.cau));

  const rut = [];       // {c, khoa, mau, bien, tenHam}
  const boQua = new Map();

  for (const c of chuoi) {
    if (c.dong < TU || c.dong > DEN) continue;
    const tenHam = hamBaoQuanh(dsHam, c.batDau);
    if (HAM && tenHam !== HAM) continue;

    const viSao = nenRut(c, src, vungDL, khongRut);
    if (viSao) { boQua.set(viSao, (boQua.get(viSao) || 0) + 1); continue; }

    // dựng mẫu + danh sách biến
    const daCo = new Set();
    const bien = c.bieuThuc.map((bt, i) => tenBien(bt, i, daCo));
    let mau = "", k = 0;
    for (const doan of c.noiDung.split(nc.MOC_BIEN)) {
      mau += doan.split("{").join("{{").split("}").join("}}");
      if (k < bien.length) mau += "{" + bien[k] + "}";
      k++;
    }

    if (!khopTungKyTu(mau, c.noiDung, bien)) {
      boQua.set("KHÔNG khớp từng ký tự (bỏ cho chắc)", (boQua.get("KHÔNG khớp từng ký tự (bỏ cho chắc)") || 0) + 1);
      continue;
    }

    const khoa = datKhoa(tenHam, c.noiDung, daDung);
    daDung.add(khoa);
    rut.push({ c, khoa, mau, bien, tenHam, nhom: nhomCua(dsHam, dsBien, c.batDau) });
  }

  if (XEP_HANG) { inXepHang(rut); return; }

  console.log(`Tệp ${TEP_NGUON}, dòng ${TU}–${DEN === Infinity ? "hết" : DEN}` + (HAM ? `, hàm ${HAM}` : ""));
  console.log(`  rút được : ${rut.length} câu`);
  for (const [ly, n] of [...boQua.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  bỏ qua   : ${String(n).padStart(4)}  ${ly}`);
  }

  if (THU) {
    console.log("\n--- XEM TRƯỚC (không ghi gì) ---");
    for (const r of rut.slice(0, 25)) {
      console.log(`  ${String(r.c.dong).padStart(6)}  ${r.khoa}`);
      console.log(`          ${JSON.stringify(r.mau.slice(0, 96))}`);
    }
    if (rut.length > 25) console.log(`  ... còn ${rut.length - 25} câu`);
    return;
  }
  if (!rut.length) { console.log("Không có gì để rút."); return; }

  // Thay từ CUỐI về ĐẦU để vị trí ký tự phía trước không bị xê dịch.
  let moi = src;
  for (const r of [...rut].sort((a, b) => b.c.batDau - a.c.batDau)) {
    const thamSo = r.bien.length
      ? `, { ${r.bien.map((b, i) => (b === r.c.bieuThuc[i].trim() ? b : `${b}: ${r.c.bieuThuc[i].trim()}`)).join(", ")} }`
      : "";
    moi = moi.slice(0, r.c.batDau) + `KB.cau("${r.khoa}"${thamSo})` + moi.slice(r.c.ketThuc);
    kho.cau[r.khoa] = {
      cau: r.mau,
      bien: r.bien,
      mo_ta: `${r.tenHam} (${TEP_NGUON}:${r.c.dong})`
    };
  }

  fs.writeFileSync(TEP_KHO, JSON.stringify(kho, null, 2) + "\n", "utf8");
  fs.writeFileSync(duongDan, moi, "utf8");
  console.log(`\nĐã ghi: kich_ban/mac_dinh.json (${Object.keys(kho.cau).length} câu) và ${TEP_NGUON}.`);
  console.log("Chạy ngay: node --check " + TEP_NGUON + " && npm test");
}

main();
