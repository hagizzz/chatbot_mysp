const __goc = require("path").join(__dirname, "..", "..");
// ============================================================================
// nguon_cau.js — TRUY NGUỒN: câu bot vừa nhắn khách ĐẾN TỪ ĐÂU?
// ----------------------------------------------------------------------------
// Vì sao có file này: kịch bản đang nằm rải ở nhiều nơi (Google Doc, tab
// "AI AGENT", câu viết cứng trong bot_worker_api_v3.js, prompt trong
// reasoning_engine.js...). Không ai biết THỰC TẾ bao nhiêu phần trăm câu bot nói
// ra là do kịch bản dạy, bao nhiêu là do code viết cứng. Không đo thì mọi tranh
// luận về "dọn kịch bản" đều là đoán, và trang quản trị (GĐ3) có thể làm xong
// mới phát hiện nó không chạm được vào phần lớn hành vi thật.
//
// Cách đo — KHÔNG phải đi sửa 442 chỗ viết cứng:
//   1) Ai biết chắc mình soạn câu thì TỰ KHAI (turnLog.nguonCau(...)):
//      reasoning_engine -> "ai_tu_do", ai_quyet -> "ai_quyet", luật Sheet ->
//      "luat_sheet". Lời khai CHỈ được tính khi câu gửi đi thật sự là câu đó —
//      code hay đè lại câu của AI, lời khai cũ phải bị loại kẻo đếm nhầm công.
//   2) Không ai khai thì DÒ VÂN CHỮ: quét sẵn mọi chuỗi ký tự trong mã nguồn,
//      lấy đoạn tĩnh dài nhất của từng chuỗi làm "vân tay", rồi soi câu vừa gửi
//      xem trùng vân của dòng nào -> ra đúng "tệp:dòng" đẻ ra câu đó.
//
// Toàn hàm thuần + đọc tệp lúc nạp, không gọi mạng -> test được offline.
// ============================================================================
const fs = require("fs");
const path = require("path");

// Tệp nào chứa câu viết cứng thì khai ở đây.
// [DỌN 27/08/2026] Đường dẫn tính từ THƯ MỤC GỐC của dự án, không phải từ tệp này.
// reasoning_engine đã chuyển vào loi/; quên sửa ở đây thì bộ đo không kêu một tiếng
// nào — nó chỉ lặng lẽ bỏ qua tệp không đọc được, và mọi câu do reasoning_engine
// đẻ ra bỗng thành "khong_ro". Số đo sai mà trông vẫn như thật.
const TEP_QUET = [
  "bot_worker_api_v3.js",
  "loi/ai/reasoning_engine.js",
  "order_worker.js"
];

const DAI_TOI_THIEU = 12;      // vân ngắn hơn thì dễ đụng hàng -> bỏ
const MOC_BIEN = "";     // chỗ ${...} trong chuỗi mẫu, dùng để cắt đoạn tĩnh

// --- Chuẩn hoá để so: bỏ dấu, bỏ emoji/dấu câu, gộp khoảng trắng --------------
// Câu đi qua throttleHearts/maybeDropDa/tidyParticles nên chữ có thể bị thêm bớt
// emoji, rụng "Dạ" đầu câu, đổi dấu câu. So bằng chữ trần thì mới bền.
function chuanHoa(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// --- Tách chuỗi ký tự ra khỏi mã nguồn ---------------------------------------
// Viết tay thay vì regex vì chuỗi trong dự án này hay có dấu nháy lồng nhau và
// nằm cạnh biểu thức chính quy (/.../) — regex thô sẽ cắt nhầm rồi lệch cả tệp.
function tachChuoi(src) {
  const ra = [];
  let dong = 1;
  let i = 0;
  const n = src.length;
  // "/" đứng sau mấy ký tự này là đang MỞ regex chứ không phải phép chia ->
  // phải nuốt trọn regex, kẻo dấu nháy bên trong nó làm lệch bộ tách và từ đó
  // trở đi cả tệp bị đọc sai (đã dính thật: `return /.../.test(t)` bị coi là
  // phép chia -> nuốt luôn hàng trăm dòng code vào một "chuỗi" ma).
  const TRUOC_REGEX = "=(,:[!&|?{};+*%~^\n";
  const TU_KHOA_TRUOC_REGEX = new Set([
    "return", "typeof", "case", "in", "of", "do", "else", "yield", "await",
    "new", "delete", "void", "instanceof", "throw"
  ]);

  // Nhìn ngược lại phía trước dấu "/" để đoán nó mở regex hay là phép chia.
  function moRegex() {
    let k = i - 1;
    while (k >= 0 && (src[k] === " " || src[k] === "\t")) k--;
    if (k < 0) return true;
    const c = src[k];
    if (TRUOC_REGEX.includes(c)) return true;
    if (!/[A-Za-z_$]/.test(c)) return false;
    let cuoi = k;                                   // lùi hết một từ để soi từ khoá
    while (k >= 0 && /[A-Za-z0-9_$]/.test(src[k])) k--;
    return TU_KHOA_TRUOC_REGEX.has(src.slice(k + 1, cuoi + 1));
  }

  while (i < n) {
    const c = src[i];

    if (c === "\n") { dong++; i++; continue; }

    if (c === "/" && src[i + 1] === "/") {                 // chú thích 1 dòng
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {                 // chú thích nhiều dòng
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") dong++; i++; }
      i += 2;
      continue;
    }

    if (c === "/" && moRegex()) {                          // biểu thức chính quy
      i++;
      let trongNgoac = false;
      while (i < n) {
        const d = src[i];
        if (d === "\\") { i += 2; continue; }
        if (d === "\n") break;                             // regex không xuống dòng -> thoát cho an toàn
        if (d === "[") trongNgoac = true;
        else if (d === "]") trongNgoac = false;
        else if (d === "/" && !trongNgoac) { i++; break; }
        i++;
      }
      continue;
    }

    if (c === '"' || c === "'" || c === "`") {             // chuỗi ký tự
      const moc = c;
      const dongBatDau = dong;
      const batDau = i;                                    // vị trí dấu mở, để công cụ rút thay đúng chỗ
      const bieuThuc = [];                                 // các biểu thức ${...} theo thứ tự xuất hiện
      let coThoat = false;                                 // chuỗi có ký tự thoát -> rút tự động phải né
      let noiDung = "";
      i++;
      while (i < n) {
        const d = src[i];
        if (d === "\\") {
          const e = src[i + 1];
          coThoat = true;
          if (e === "n") noiDung += "\n";
          else if (e === "t") noiDung += " ";
          else if (e === "\n") dong++;
          else noiDung += e;
          i += 2;
          continue;
        }
        if (d === moc) { i++; break; }
        if (d === "\n") { dong++; if (moc !== "`") break; }
        if (moc === "`" && d === "$" && src[i + 1] === "{") {
          let sau = 1;                                     // nuốt phần ${...}, đánh dấu chỗ đó là biến
          const dauBT = i + 2;
          i += 2;
          while (i < n && sau > 0) {
            if (src[i] === "{") sau++;
            else if (src[i] === "}") sau--;
            else if (src[i] === "\n") dong++;
            i++;
          }
          bieuThuc.push(src.slice(dauBT, i - 1));
          noiDung += MOC_BIEN;
          continue;
        }
        noiDung += d;
        i++;
      }
      ra.push({ noiDung, dong: dongBatDau, moc, batDau, ketThuc: i, bieuThuc, coThoat });
      continue;
    }

    i++;
  }
  return ra;
}

// Đoạn TĨNH dài nhất của một chuỗi (phần không phải biến ${...}) sau chuẩn hoá.
function vanDaiNhat(noiDung) {
  let tot = "";
  for (const doan of String(noiDung).split(MOC_BIEN)) {
    const c = chuanHoa(doan);
    if (c.length > tot.length) tot = c;
  }
  return tot;
}

// --- Chỉ mục vân tay ---------------------------------------------------------
let _chiMuc = null;

// Chuỗi này có KHẢ NĂNG là câu nhắn cho khách, hay chỉ là log/prompt nội bộ?
// Truy nguồn thì không cần phân biệt (log không bao giờ trùng câu gửi đi), nhưng
// soi_kich_ban.js thì cần — kẻo báo prompt "cấm dùng từ X" là vi phạm chính nó.
function khachCoTheThay(noiDung, van) {
  if (van.length > 1000) return false;                 // khối prompt, không phải câu nhắn
  const t = String(noiDung).trim();
  if (t.startsWith("[")) return false;                 // "[AI-QUYẾT] ...", "[gửi tin] ..."
  if (t.includes("->") || t.includes("=>")) return false;   // dòng log giải thích
  return true;
}

function soDong(viTri) {
  const n = Number(String(viTri || "").split(":").pop());
  return Number.isFinite(n) ? n : Infinity;
}

function napChiMuc(thuMuc) {
  const goc = thuMuc || __goc;
  const ra = [];
  for (const ten of TEP_QUET) {
    let src;
    try { src = fs.readFileSync(path.join(goc, ten), "utf8"); }
    catch (_) { continue; }
    for (const { noiDung, dong } of tachChuoi(src)) {
      // Chỉ giữ chuỗi có chữ -> loại tên khoá, URL, mã màu, SQL...
      if (!/[a-zÀ-ỹ]{3}/i.test(noiDung)) continue;
      const van = vanDaiNhat(noiDung);
      if (van.length < DAI_TOI_THIEU) continue;
      ra.push({ van, viTri: `${ten}:${dong}`, khachThay: khachCoTheThay(noiDung, van) });
    }
  }
  // Vân DÀI xếp trước -> lúc soi lấy được cái CỤ THỂ nhất, không vớ câu chung chung.
  ra.sort((a, b) => b.van.length - a.van.length);
  // Cùng một câu nằm ở nhiều dòng -> gom về MỘT vân, lấy dòng NHỎ NHẤT làm đại
  // diện (để kết quả đo không đổi mỗi lần chạy) và ghi số chỗ trùng.
  const thay = new Map();
  const gon = [];
  for (const m of ra) {
    const cu = thay.get(m.van);
    if (cu) {
      cu.soChoTrung = (cu.soChoTrung || 1) + 1;
      if (soDong(m.viTri) < soDong(cu.viTri)) cu.viTri = m.viTri;
      continue;
    }
    thay.set(m.van, m);
    gon.push(m);
  }
  return gon;
}

function chiMuc(thuMuc) {
  if (!_chiMuc || thuMuc) _chiMuc = napChiMuc(thuMuc);
  return _chiMuc;
}

// --- Soi một câu đã gửi ------------------------------------------------------
// Trả { nguon: "nhanh_cung", viTri: "tệp:dòng" } hoặc null nếu không trùng vân nào.
function doVan(text) {
  const c = chuanHoa(text);
  if (c.length < DAI_TOI_THIEU) return null;
  for (const m of chiMuc()) {
    if (m.van.length > c.length) continue;
    if (c.includes(m.van)) return { nguon: "nhanh_cung", viTri: m.viTri };
  }
  return null;
}

// Lời khai của người soạn câu có đúng với câu THẬT SỰ gửi đi không?
function khaiKhop(khai, text) {
  if (!khai || !khai.norm) return false;
  const b = chuanHoa(text);
  const a = khai.norm;
  if (!b) return false;
  if (a === b) return true;
  const dai = Math.max(a.length, b.length);
  const ngan = Math.min(a.length, b.length);
  // Câu bị cắt bớt CTA (sendInboxMessage có cắt đuôi xin sđt) hoặc bị chèn thêm
  // đuôi vẫn tính là cùng một câu, miễn phần chung đủ lớn — nhưng đừng để "vâng ạ"
  // khớp bừa với mọi câu: phải hoặc dài tuyệt đối, hoặc chiếm phần lớn câu kia.
  if (a.includes(b) || b.includes(a)) {
    if (ngan >= 25) return true;
    if (ngan >= DAI_TOI_THIEU && ngan / dai >= 0.6) return true;
  }
  return false;
}

// Cửa vào chính: turn_log gọi lúc bot gửi tin.
function truyNguon(text, cacKhai) {
  for (const khai of (cacKhai || [])) {
    if (khaiKhop(khai, text)) return { nguon: khai.nguon, viTri: khai.viTri || null };
  }
  return doVan(text) || { nguon: "khong_ro", viTri: null };
}

module.exports = { truyNguon, doVan, chuanHoa, tachChuoi, vanDaiNhat, chiMuc, khaiKhop, khachCoTheThay, DAI_TOI_THIEU, MOC_BIEN };
