const __goc = require("path").join(__dirname, "..", "..");
const { google } = require("googleapis");
const path = require("path");

const SA_KEY = path.join(__goc, "google-service-account.json");

// Sheet danh mục sản phẩm. Shop khác BẮT BUỘC khai CATALOG_SHEET_ID trong .env —
// giá trị dưới chỉ là bản dự phòng của MYS.P, để bản cũ không khai gì vẫn chạy.
// Dùng dự phòng thì kêu một lần lúc khởi động: shop mới quên khai sẽ đọc nhầm
// danh mục 589 mẫu của shop khác mà không có dấu hiệu gì báo sai.
const SHEET_ID_MAC_DINH = "1Qdhp9YS0mePn7G3focqAhqV3Mb1eymFqbX0EC1bFCVs";
const SHEET_ID = String(process.env.CATALOG_SHEET_ID || "").trim() || SHEET_ID_MAC_DINH;
if (SHEET_ID === SHEET_ID_MAC_DINH && !process.env.CATALOG_SHEET_ID) {
  try { console.log("[catalog] ⚠ chưa khai CATALOG_SHEET_ID -> dùng Sheet mặc định của MYS.P."); } catch (_) {}
}
const TABS = String(process.env.CATALOG_SHEET_TABS || "Mẫu 2026,Mẫu 2025")
  .split(",").map(s => s.trim()).filter(Boolean);
const REFRESH_MS = 5 * 60 * 1000;

let _cache = { at: 0, byCode: new Map(), list: [] };

function norm(s) {
  return String(s || "")
    .normalize("NFKC")                       // gấp chữ CÁCH ĐIỆU Unicode (in đậm/nghiêng toán học: 𝐂𝐀𝐌𝐄𝐋𝐋𝐈𝐀 -> CAMELLIA, 𝟬 -> 0) về ASCII; no-op với chữ thường
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Giá hợp lệ = có số, không phải lỗi #REF!/#N/A..., không rỗng
function validPrice(v) {
  const t = String(v || "").trim();
  if (!t) return null;
  if (t.startsWith("#")) return null;            // #REF!, #N/A, #VALUE!...
  const num = parseInt(t.replace(/[^\d]/g, ""), 10);
  if (!num || num <= 0) return null;
  return num;
}

function fmtVND(num) {
  return num.toLocaleString("vi-VN").replace(/,/g, ".") + "đ";
}

function rowToProduct(sheetName, r) {
  const goc = validPrice(r[7]);   // cột H - giá gốc
  const km  = validPrice(r[10]);  // cột K - giá khuyến mãi

  // Giá dùng để chốt: ưu tiên KM nếu hợp lệ, không thì giá gốc
  const priceNum = km || goc || null;
  const price = priceNum ? String(priceNum) : "";

  // Câu báo giá theo §15: có KM (khác giá gốc) -> "giá gốc X, ưu đãi còn Y"
  let priceText = "";
  if (goc && km && km < goc) {
    priceText = `giá gốc ${fmtVND(goc)}, hiện đang ưu đãi còn ${fmtVND(km)}`;
  } else if (priceNum) {
    priceText = `giá ${fmtVND(priceNum)}`;
  }

  return {
    sheetName,
    code: String(r[1] || "").trim(),
    category: r[3] || "",
    note: r[4] || "",          // cột E: "HẾT HÀNG" / "Không nhận sx 1c" / "Không cần cọc" / trống
    name: String(r[6] || "").trim(),
    originalPrice: r[7] || "",
    salePrice: r[10] || "",
    season: r[11] || "",                  // cột L: mùa/BST (vd "Xuân hè 2026") — dùng lọc mẫu tương tự khi hết hàng
    stock: r[12] || "",
    color: r[13] || "",
    size: r[14] || "",
    material: r[15] || "",
    description: r[16] || "",
    lock: r[17] || "",
    padInfo: r[17] || "",                 // cột R: ghi chú đệm ngực — chung cột với lock, khác từ khoá nên không đụng
    stretch: r[18] || "",
    isNew: norm(r[19]) === "moi",         // cột T: = "mới" -> thuộc BST mới nhất
    beach: norm(r[20]).includes("bien"),  // cột U: = "Biển" -> mẫu hợp đi biển
    artist: String(r[21] || "").trim(),   // cột V: NGHỆ SĨ từng diện mẫu (vd "Diễn viên Đinh Ngọc Diệp, Siêu mẫu Lan Khuê")
    price,
    priceText
  };
}

async function refresh() {
  const client = await new google.auth.GoogleAuth({
    keyFile: SA_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  }).getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  const byCode = new Map();
  const list = [];

  for (const tab of TABS) {
    let rows = [];
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${tab}!A:Z`
      });
      rows = res.data.values || [];
    } catch (e) {
      console.log("[catalog] lỗi đọc tab", tab, ":", e.message);
      continue;
    }
    for (let i = 1; i < rows.length; i++) {
      const p = rowToProduct(tab, rows[i] || []);
      if (!p.code) continue;
      const key = p.code.toUpperCase();
      if (!byCode.has(key)) byCode.set(key, p);
      list.push(p);
    }
  }

  _cache = { at: Date.now(), byCode, list };
  console.log("[catalog] đã nạp", list.length, "sản phẩm");
  return _cache;
}

async function ensure() {
  if (_cache.list.length && Date.now() - _cache.at < REFRESH_MS) return _cache;
  try {
    return await refresh();
  } catch (e) {
    console.log("[catalog] refresh lỗi:", e.message);
    return _cache;
  }
}

async function getByCode(code) {
  const c = await ensure();
  return c.byCode.get(String(code || "").trim().toUpperCase()) || null;
}

async function findInText(text) {
  const c = await ensure();
  const t = " " + norm(text).replace(/[|/\\\-_.,:;!?()[\]{}]+/g, " ").replace(/\s+/g, " ").trim() + " ";
  const found = [];
  const seenCode = new Set();
  const seenName = new Set();

  // 1) Mã
  const codes = String(text || "").normalize("NFKC").toUpperCase().match(/\b[A-Z]{2,}[A-Z0-9]*\d{3,}\b/g) || [];
  for (const cm of codes) {
    const p = c.byCode.get(cm);
    if (p && !seenCode.has(p.code)) {
      seenCode.add(p.code);
      seenName.add(norm(p.name));
      found.push(p);
    }
  }

  // 2) Tên: khớp nguyên từ, tên >= 4 ký tự, MỖI TÊN CHỈ LẤY 1 MẪU (ưu tiên tab đầu = 2026)
  for (const p of c.list) {
    const nm = norm(p.name);
    if (nm.length < 4) continue;
    if (seenName.has(nm)) continue;
    if (t.includes(" " + nm + " ")) {
      seenName.add(nm);
      if (!seenCode.has(p.code)) {
        seenCode.add(p.code);
        found.push(p);
      }
    }
  }

  return found;
}

// ===================== KHỚP TÊN MẪU GẦN ĐÚNG (fuzzy) =====================
// Lý do: khách hay GÕ SAI / THIẾU CHỮ tên mẫu ("Alisse" thay vì "Galisse",
//   "Meridien" thay vì "Meridian"). findInText khớp NGUYÊN VĂN nên trượt ->
//   bot tưởng "không có mẫu" rồi dội 10 mẫu mới (lỗi Mai Thanh Lê). Hàm dưới
//   khớp gần đúng (Levenshtein) để CỨU mấy ca gõ sai 1-2 ký tự.

// Khoảng cách sửa (Levenshtein) giữa 2 chuỗi.
function _lev(a, b) {
  a = String(a); b = String(b);
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = new Array(n + 1);
  for (let j = 0; j <= n; j++) d[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[n];
}

// Từ tiếng Việt / từ ngoại lai THƯỜNG GẶP nhưng KHÔNG phải tên mẫu -> loại để tránh báo nhầm.
const _MODEL_STOP = new Set([
  "thiet", "ke", "thiet ke", "mau", "vay", "dam", "ao", "set", "bo", "quan", "chan",
  "gia", "bao", "nhieu", "cho", "chi", "chu", "anh", "chau", "minh", "cua", "nay", "kia",
  "con", "cai", "size", "mang", "kieu", "thuong", "tuvan", "tu", "van", "xem", "gui",
  "duoc", "khong", "shop", "ben", "online", "messenger", "facebook", "shopee", "tiktok",
  "zalo", "instagram", "website", "freesize", "free", "inbox", "comment", "hang", "order",
  "ship", "cod", "design", "collection", "video", "live", "voucher", "sale",
  // [FIX Đào Thị Na 2026-07-07] "Giá bán của CHIẾC váy này..." -> "chiec" bị coi là TÊN MẪU
  // (thiếu trong stoplist) -> fuzzy trượt -> hỏi "nhắn tên mẫu" vô nghĩa. Bổ sung các từ
  // thường >=5 ký tự hay gặp trong câu hỏi (tên mẫu thật luôn là từ ngoại lai, không trùng):
  "chiec", "nhung", "khach", "truoc", "trong", "ngoai", "chieu", "chuyen", "phien", "nguoi"
]);

// Bóc các TOKEN có thể là TÊN MẪU trong câu khách (từ ngoại lai, >=5 chữ cái, không nằm trong stop).
function extractModelTokens(text, minLen) {
  const ml = minLen || 5;
  const t = norm(text);
  return t.split(/[^a-z0-9]+/)
    .filter(w => w.length >= ml && /^[a-z]+$/.test(w) && !_MODEL_STOP.has(w));
}

// Câu khách CÓ nêu 1 TÊN MẪU cụ thể (token ngoại lai) không? (sync, không cần catalog)
// CHỈ tính khi có CẢ ngữ cảnh hỏi mẫu/giá để tránh bắt nhầm từ ngoại lai vu vơ.
function hasModelNameToken(text) {
  const toks = extractModelTokens(text, 5);
  if (!toks.length) return false;
  const t = norm(text);
  const cue = /(thiet ke|mau|vay|dam|\bao\b|\bset\b|\bbo\b|xem|tu van|bao gia|\bgia\b|design|con khong|con ko)/.test(t);
  // token chiếm gần hết câu ngắn (vd chỉ gõ "Lerina") -> coi là nêu tên mẫu kể cả không có cue.
  const dominant = toks.some(tok => tok.length >= 5) && t.replace(/[^a-z0-9]+/g, "").length <= (toks.join("").length + 6);
  return cue || dominant;
}

// Khớp GẦN ĐÚNG token tên mẫu với danh sách sản phẩm. Trả {product, dist, token} | null.
// AN TOÀN: chỉ nhận khi tại khoảng cách NHỎ NHẤT chỉ có DUY NHẤT 1 mã (không mơ hồ).
function _fuzzyMatch(list, text) {
  const toks = extractModelTokens(text, 5);
  if (!toks.length) return null;
  let best = null;
  for (const tok of toks) {
    const maxDist = tok.length <= 6 ? 1 : 2;   // càng ngắn càng chặt
    const hits = [];
    for (const p of list) {
      const words = norm(p.name).split(/\s+/).filter(w => w.length >= 4 && /^[a-z]+$/.test(w));
      let dmin = 99;
      for (const w of words) { const d = _lev(tok, w); if (d < dmin) dmin = d; }
      if (dmin >= 1 && dmin <= maxDist) hits.push({ p, d: dmin });
    }
    if (!hits.length) continue;
    hits.sort((x, y) => x.d - y.d);
    const bd = hits[0].d;
    const codesAtBest = new Set(hits.filter(h => h.d === bd).map(h => String(h.p.code).toUpperCase()));
    if (codesAtBest.size !== 1) continue;   // mơ hồ -> bỏ (sẽ hỏi lại tên)
    const cand = { product: hits[0].p, dist: bd, token: tok };
    if (!best || cand.dist < best.dist) best = cand;
  }
  return best;
}

async function fuzzyFindModel(text) {
  const c = await ensure();
  return _fuzzyMatch(c.list || [], text);
}

module.exports = {
  getByCode, findInText, ensure,
  fuzzyFindModel, hasModelNameToken, extractModelTokens,
  _lev, _fuzzyMatch, norm   // export phụ để test
};
