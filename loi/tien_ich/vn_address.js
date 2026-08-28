const __goc = require("path").join(__dirname, "..", "..");
// vn_address.js — suy luận TỈNH/THÀNH từ tên quận/huyện/khu vực (map sáp nhập 1/7/2025: 34 tỉnh/thành).
// Bot CHỈ đoán cấp Tỉnh/TP rồi PHẢI hỏi khách xác nhận. Token TRÙNG nhiều tỉnh (ambiguous) -> KHÔNG đoán, hỏi thẳng.
const fs = require("fs");
const path = require("path");

function fold(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/\s+/g, " ").trim();
}

let PROV_DISP = {};   // foldedProvince -> "Hà Nội"
let AREA_PROV = {};   // foldedArea -> foldedProvince  (đã bỏ ambiguous)
let AMBIGUOUS = new Set();   // foldedArea trùng nhiều tỉnh
let PROVINCES = [];   // [foldedProvince]
let AREA_RE = null;   // regex MỌI tên khu vực (quận/huyện/phường đặc trưng) -> nhận diện "có cấp khu vực" dù khách KHÔNG ghi chữ "phường/quận"
let WARD_PROV = {};   // foldedWard -> [TÊN TỈNH hiển thị] (1 tỉnh = suy được; nhiều tỉnh = ambiguous)
let WARD_RE = null;   // regex MỌI tên phường/xã đặc trưng (>=4 ký tự, không phải số) -> nhận diện cấp phường/xã

try {
  const raw = JSON.parse(fs.readFileSync(path.join(__goc, "vn_admin_2025.json"), "utf8"));
  const ambSet = new Set((raw.ambiguous_tokens || []).map(fold));
  AMBIGUOUS = ambSet;
  const allAreas = new Set();   // GỒM CẢ ambiguous: để nhận diện "có tên khu vực" (vd "hoàng mai"), không để map tỉnh
  const addProvince = (disp, conf) => {
    const pf = fold(disp);
    PROV_DISP[pf] = disp;
    PROVINCES.push(pf);
    for (const area of (conf.areas || [])) {
      const af = fold(area);
      if (af.length >= 3) allAreas.add(af);    // mọi khu vực (kể cả trùng tỉnh) -> dùng cho hasAreaToken
      if (ambSet.has(af)) continue;            // token trùng -> KHÔNG map tỉnh (sẽ hỏi khách)
      if (!AREA_PROV[af]) AREA_PROV[af] = pf;
    }
  };
  for (const [disp, conf] of Object.entries(raw.thanh_pho_truc_thuoc_tw || {})) addProvince(disp, conf);
  for (const [disp, conf] of Object.entries(raw.tinh || {})) addProvince(disp, conf);
  // viết tắt tỉnh/thành phổ biến
  PROV_DISP["ha noi"] = "Hà Nội"; PROV_DISP["tp.hcm"] = "TP.HCM";
  // regex nhận diện CÓ tên khu vực (dài trước ngắn sau để khớp đúng tên đầy đủ)
  if (allAreas.size) {
    const alt = [...allAreas].sort((a, b) => b.length - a.length)
      .map(a => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")).join("|");
    AREA_RE = new RegExp("(^|\\s)(" + alt + ")(\\s|$|,)");
  }
} catch (e) {
  try { console.log("[vn_address] KHÔNG nạp được map 2025:", e.message); } catch (_) {}
}

// ===== MAP PHƯỜNG/XÃ 2025 (3300+ phường/xã -> tỉnh) — để khi khách gửi phường/xã là có TỈNH tương ứng =====
try {
  const wraw = JSON.parse(fs.readFileSync(path.join(__goc, "vn_wards_2025.json"), "utf8"));
  WARD_PROV = wraw.wards || {};
  // Tên phường/xã ĐẶC TRƯNG cho regex nhận diện: bỏ tên thuần số ("phường 1"), bỏ tên <4 ký tự (tránh khớp nhầm).
  const names = Object.keys(WARD_PROV).filter(w => w.length >= 4 && !/^\d+$/.test(w) && !/^[a-z]?\d+$/.test(w));
  if (names.length) {
    const alt = names.sort((a, b) => b.length - a.length)
      .map(a => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")).join("|");
    WARD_RE = new RegExp("(^|\\s)(" + alt + ")(\\s|$|,)");
  }
} catch (e) {
  try { console.log("[vn_address] KHÔNG nạp được map phường/xã 2025:", e.message); } catch (_) {}
}

// Text CÓ tên khu vực (quận/huyện/phường) trong map không? (vd "lĩnh nam hoàng mai hà nội" -> true vì có "hoàng mai")
// Dùng để biết địa chỉ ĐÃ có cấp phường/xã dù khách KHÔNG gõ chữ "phường/quận".
function hasAreaToken(foldedText) {
  const f = " " + String(foldedText || "") + " ";
  if (AREA_RE && AREA_RE.test(f)) return true;
  if (WARD_RE && WARD_RE.test(f)) return true;   // có tên phường/xã cụ thể (vd "lĩnh nam", "vĩnh tuy")
  return false;
}

// Tỉnh CŨ (sáp nhập 1/7/2025; Hà Tây 2008) -> foldedProvince MỚI. Khách ghi tên CŨ vẫn nhận đủ tỉnh, KHÔNG hỏi lại.
// (Đơn vị GIỮ NGUYÊN tên sau sáp nhập KHÔNG cần ở đây — đã có trong PROVINCES.)
const OLD_PROV = {
  "ha tay": "ha noi",
  "ha giang": "tuyen quang",
  "yen bai": "lao cai",
  "bac kan": "thai nguyen",
  "vinh phuc": "phu tho", "hoa binh": "phu tho",
  "bac giang": "bac ninh",
  "thai binh": "hung yen",
  "ha nam": "ninh binh", "nam dinh": "ninh binh",
  "hai duong": "hai phong",
  "quang binh": "quang tri",
  "quang nam": "da nang",
  "kon tum": "quang ngai",
  "binh dinh": "gia lai",
  "phu yen": "dak lak",
  "ninh thuan": "khanh hoa",
  "binh thuan": "lam dong", "dak nong": "lam dong",
  "binh phuoc": "dong nai",
  "ba ria vung tau": "tp.hcm", "ba ria - vung tau": "tp.hcm", "vung tau": "tp.hcm", "binh duong": "tp.hcm",
  "long an": "tay ninh",
  "ben tre": "vinh long", "tra vinh": "vinh long",
  "tien giang": "dong thap",
  "kien giang": "an giang",
  "hau giang": "can tho", "soc trang": "can tho",
  "bac lieu": "ca mau",
};

// Tỉnh/TP ghi RÕ trong text -> trả foldedProvince (hoặc null). Có cả viết tắt HN/HCM/SG/ĐN + tên TỈNH CŨ.
function explicitProvince(foldedText) {
  const f = " " + String(foldedText || "") + " ";
  if (/\bhn\b/.test(f)) return "ha noi";
  if (/\bhcm\b|\btphcm\b|\bsg\b|sai gon|tp hcm|tp\.hcm|ho chi minh/.test(f)) return "tp.hcm";
  if (/\bdn\b|da nang/.test(f)) return "da nang";
  // Viết tắt tỉnh/thành PHỔ BIẾN khác (khách hay ghi) -> nhận là tỉnh RÕ luôn, KHÔNG hỏi xác nhận.
  //  Chỉ thêm mã ÍT nhập nhằng. Mã trùng 2 tỉnh (vd QN=Quảng Ninh/Quảng Nam, TN=Thái Nguyên/Tây Ninh,
  //  LC=Lào Cai/Lai Châu) -> KHÔNG thêm, để luồng hỏi xử. Map theo tỉnh MỚI sau sáp nhập 1/7/2025.
  if (/\bhp\b/.test(f)) return "hai phong";    // Hải Phòng
  if (/\bhd\b/.test(f)) return "hai phong";    // Hải Dương -> Hải Phòng
  if (/\bbn\b/.test(f)) return "bac ninh";     // Bắc Ninh
  if (/\bbg\b/.test(f)) return "bac ninh";     // Bắc Giang -> Bắc Ninh
  if (/\bnd\b/.test(f)) return "ninh binh";    // Nam Định -> Ninh Bình
  if (/\bnb\b/.test(f)) return "ninh binh";    // Ninh Bình
  if (/\btb\b/.test(f)) return "hung yen";     // Thái Bình -> Hưng Yên
  if (/\bhy\b/.test(f)) return "hung yen";     // Hưng Yên
  if (/\bvp\b/.test(f)) return "phu tho";      // Vĩnh Phúc -> Phú Thọ
  if (/\btq\b/.test(f)) return "tuyen quang";  // Tuyên Quang
  if (/\bct\b/.test(f)) return "can tho";      // Cần Thơ
  for (const pf of PROVINCES) {
    const re = new RegExp("(^|\\s)" + pf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+") + "(\\s|$|,)");
    if (re.test(f)) return pf;
  }
  // Tên tỉnh CŨ ghi rõ -> nhận là đủ tỉnh (ánh xạ sang tỉnh mới để hiển thị cho chuẩn, KHÔNG hỏi xác nhận).
  for (const old of Object.keys(OLD_PROV)) {
    const re = new RegExp("(^|\\s)" + old.replace(/\s+/g, "\\s+") + "(\\s|$|,)");
    if (re.test(f)) return OLD_PROV[old];
  }
  return null;
}

// Gộp trùng tên tỉnh trong danh sách ứng viên (vd "TP.HCM" và "Hồ Chí Minh" là MỘT) để câu hỏi khỏi lặp.
function _dedupProvs(list) {
  const seen = new Map();
  const key = (s) => {
    const g = fold(s).replace(/^tp[\s.]*/, "").replace(/^thanh pho\s*/, "").trim();
    if (/ho chi minh|hcm|sai gon/.test(g)) return "hcm";
    if (/ha noi/.test(g)) return "ha noi";
    return g;
  };
  for (const p of (list || [])) {
    const k = key(p);
    if (!seen.has(k)) seen.set(k, k === "hcm" ? "TP.HCM" : (k === "ha noi" ? "Hà Nội" : p));
  }
  return [...seen.values()];
}
// Suy tỉnh từ tên KHU VỰC (phường/xã/quận/huyện). Trả:
//   { province: "<display>" }            -> MỌI tín hiệu đồng thuận 1 tỉnh
//   { ambiguous, candidates:[...] }      -> tín hiệu MÂU THUẪN / token trùng nhiều tỉnh -> HỎI khách
//   null                                 -> không nhận ra
// AN TOÀN: quét HẾT token (không chỉ token đầu). Token nằm NGAY SAU số nhà ("7/8 Hưng Hóa") -> coi là
// TÊN ĐƯỜNG (tin cậy THẤP), không để nó ghi đè tín hiệu quận/phường thật. Có ≥2 tỉnh khác nhau -> HỎI.
function inferProvince(foldedText) {
  const f = " " + String(foldedText || "") + " ";
  const highProvs = new Set();   // tỉnh CHẮC: phường/xã đơn-tỉnh KHÔNG phải tên đường + quận/huyện đơn-tỉnh
  const lowProvs = new Set();    // tỉnh YẾU: token nằm ngay sau số nhà (nhiều khả năng là TÊN ĐƯỜNG)
  const ambCands = new Set();    // ứng viên từ token trùng nhiều tỉnh
  let ambToken = "";
  // token đứng ngay sau SỐ NHÀ (vd "7/8 hung hoa", "so 12 hung hoa") -> tên đường, hạ tin cậy.
  const isStreetLike = (idx) => {
    const pre = f.slice(Math.max(0, idx - 12), idx);
    return /\d\s*[\/\-]?\s*$/.test(pre) || /\b(so|so nha|duong|kdt|kp|khu)\s*$/.test(pre);
  };
  // (1) Quét TẤT CẢ tên phường/xã.
  if (WARD_RE) {
    const g = new RegExp(WARD_RE.source, "g");
    let m;
    while ((m = g.exec(f)) !== null) {
      const tokIdx = m.index + (m[1] ? m[1].length : 0);
      const ps = WARD_PROV[fold(m[2])];
      if (ps && ps.length === 1) { (isStreetLike(tokIdx) ? lowProvs : highProvs).add(ps[0]); }
      else if (ps && ps.length > 1) { if (!ambToken) ambToken = m[2].trim(); ps.forEach(p => ambCands.add(p)); }
      if (m.index === g.lastIndex) g.lastIndex++;   // tránh kẹt vòng với match rỗng
    }
  }
  // (2) quận/huyện trùng nhiều tỉnh -> ambiguous
  for (const af of AMBIGUOUS) {
    const re = new RegExp("(^|\\s)" + fold(af).replace(/\s+/g, "\\s+") + "(\\s|$|,)");
    if (re.test(f)) { if (!ambToken) ambToken = af; }
  }
  // (3) quận/huyện suy được 1 tỉnh
  for (const af of Object.keys(AREA_PROV)) {
    const re = new RegExp("(^|\\s)" + af.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+") + "(\\s|$|,)");
    if (re.test(f)) highProvs.add(PROV_DISP[AREA_PROV[af]] || AREA_PROV[af]);
  }

  const strong = highProvs.size ? highProvs : lowProvs;   // ưu tiên tín hiệu CHẮC; không có thì mới dùng token yếu
  const strongList = [...strong];
  const ambList = [...ambCands];
  // Token mơ hồ CÓ bao trùm tỉnh chắc? (vd "tan binh" gồm HCM và mẫu chắc cũng HCM -> KHÔNG mâu thuẫn)
  const ambSubsetOfStrong = ambList.length > 0 && ambList.every(c => strong.has(c));

  // Đồng thuận 1 tỉnh + không mơ hồ lệch -> CHỐT.
  if (strongList.length === 1 && (ambList.length === 0 || ambSubsetOfStrong)) return { province: strongList[0] };
  // Có MÂU THUẪN (≥2 tỉnh chắc, hoặc token mơ hồ trỏ tỉnh KHÁC) -> HỎI. KHÔNG tự chốt (tránh gửi sai tỉnh).
  if (strongList.length >= 1 || ambList.length > 0) {
    const cands = highProvs.size
      ? [...new Set([...highProvs, ...ambCands])]
      : (ambList.length ? ambList : strongList);
    return { ambiguous: ambToken || (cands[0] || "khu vực"), candidates: _dedupProvs(cands) };
  }
  return null;
}

function provinceDisplay(foldedProvince) { return PROV_DISP[foldedProvince] || foldedProvince; }
function hasMap() { return PROVINCES.length > 0; }

module.exports = { fold, explicitProvince, inferProvince, provinceDisplay, hasMap, hasAreaToken, PROV_DISP };
