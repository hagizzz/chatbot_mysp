// Gợi ý & gửi GALLERY mẫu cho khách: theo MÀU, theo KIỂU (dài tay/2 dây...), hoặc MẪU TƯƠNG TỰ (CLIP).
// Mỗi mẫu kèm tên + giá. 10 mẫu x1 ảnh; nếu <10 mẫu -> 5 mẫu x2 ảnh (hoặc ít hơn nếu quá ít).
const { ensure } = require("./catalog_cache");
const { splitColors, colorMatches, foldVi } = require("./color_utils");
const images = require("./product_images");

// ---- giá hiển thị ----
function priceLabel(p) {
  const sale = String(p.salePrice || "").replace(/[^\d]/g, "");
  const goc = String(p.originalPrice || "").replace(/[^\d]/g, "");
  const v = sale || goc;
  if (!v) return "";
  return Number(v).toLocaleString("vi-VN") + "đ";
}

// ---- tồn kho (cột M) ----
function stockNum(p) {
  const n = parseInt(String(p.stock || "").replace(/[^\d-]/g, ""), 10);
  return isNaN(n) ? 0 : n;
}
// ---- cột E (lưu ý bán) đã bỏ dấu ----
function noteOf(p) { return foldVi(p.note || ""); }

// HẾT HÀNG (cột E = "HẾT HÀNG") -> không bán, KHÔNG dùng ảnh tư vấn.
function isOutOfStock(p) {
  return /het hang|sold ?out/.test(noteOf(p));
}

// CÒN BÁN không? Quy luật theo cột E + tồn M:
//  - E = "HẾT HÀNG"            -> KHÔNG bán.
//  - E = "Không nhận sx 1c"    -> chỉ bán nếu CÒN tồn (M>0) [bán nốt tồn, KHÔNG nói với khách].
//  - E trống / "Không cần cọc" -> bán bình thường bất kể tồn.
//  + Loại đồ NAM (page đồ nữ) và mẫu bị khóa/ngừng thủ công (cột lock).
function sellable(p) {
  const hay = foldVi([p.category, p.name].join(" "));
  if (/\b(nam|men|be trai|boy|unisex nam|do nam|ao nam|quan nam)\b/.test(hay)) return false;
  const lock = foldVi(p.lock || "");
  if (/khoa|ngung ban|an ban|stop|off|xoa/.test(lock)) return false;

  const note = noteOf(p);
  if (/het hang|sold ?out/.test(note)) return false;                    // E = HẾT HÀNG
  if (/khong nhan sx ?1c|ko nhan sx ?1c|khong nhan 1c/.test(note)) {
    return stockNum(p) > 0;                                             // chỉ bán nếu còn tồn
  }
  return true;                                                          // E trống / không cần cọc -> luôn bán
}

function dedupByCode(list) {
  const seen = new Set();
  const out = [];
  for (const p of list) {
    const c = String(p.code || "").toUpperCase();
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(p);
  }
  return out;
}

// ====== KIỂU DÁNG: từ khóa -> cụm tìm trong name+description+category ======
const ATTR_DEFS = [
  ["dài tay", ["dai tay", "tay dai", "long sleeve"]],
  ["cộc tay", ["coc tay", "tay ngan", "ngan tay", "tay loi"]],
  ["2 dây", ["2 day", "hai day", "2day", "day manh", "spaghetti"]],
  ["sát nách", ["sat nach", "ba lo le", "tank"]],
  ["tay phồng", ["tay phong", "tay bong", "puff"]],
  ["cổ V", ["co v", "co tim", "v-neck", "v neck"]],
  ["cổ tròn", ["co tron", "round neck"]],
  ["cổ vuông", ["co vuong", "square neck"]],
  ["suông", ["suong", "dang suong"]],
  ["xòe", ["xoe", "babydoll", "chu a"]],
  ["ôm body", ["om body", "body con", "dang om", "bodycon"]],
  ["maxi", ["maxi", "dam dai", "vay dai", "dang dai"]],
  ["yếm", ["yem"]],
  ["sơ mi", ["so mi", "shirt"]],
  ["công sở", ["cong so", "cong so"]],
  ["dự tiệc", ["du tiec", "di tiec", "da hoi"]],
];

// Bắt các kiểu dáng khách nói trong câu -> [{canon, terms}]
// Khớp CỤM TỪ có BIÊN (không để "co v" lọt vào "co vay"/"có váy", "om" lọt "thom"...).
function hasTerm(haystack, term) {
  const re = new RegExp("(?:^|[^a-z0-9])" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+") + "(?:[^a-z0-9]|$)", "i");
  return re.test(haystack);
}
function extractAttributes(text) {
  const t = foldVi(text);
  const out = [];
  for (const [canon, terms] of ATTR_DEFS) {
    if (terms.some(x => hasTerm(t, x))) out.push({ canon, terms });
  }
  return out;
}

// ====== LỌC THEO MÀU (kèm LOẠI nếu có: váy/set/áo... -> gửi đúng loại khách đang xem) ======
function catGroup(p) {
  const h = foldVi([p.category, p.name].join(" "));
  if (/\bset\b|set /.test(h)) return "set";
  if (/\bdam\b|\bvay\b|dam |vay /.test(h)) return "vay";
  if (/\bao\b|ao /.test(h)) return "ao";
  if (/\bquan\b|chan vay|chan-vay/.test(h)) return "quan";
  return "";
}
async function findByColor(colorCanon, catalog, sameCatAs) {
  const c = catalog || (await ensure());
  const wantCat = sameCatAs ? catGroup(sameCatAs) : "";
  const out = [];
  for (const p of c.list) {
    if (!sellable(p)) continue;
    const code = String(p.code || "").toUpperCase();
    if (!code) continue;
    if (wantCat && catGroup(p) && catGroup(p) !== wantCat) continue;   // chỉ cùng loại (váy->váy, set->set)
    let ok = splitColors(p.color).some(cc => colorMatches(cc, colorCanon) || colorMatches(colorCanon, cc));
    if (!ok) {
      const imgColors = images.getCodeColors(code);
      ok = imgColors.some(cc => colorMatches(cc, colorCanon) || colorMatches(colorCanon, cc));
    }
    if (ok) out.push(p);
  }
  return dedupByCode(out);
}

// ====== LỌC THEO KIỂU (và kết hợp màu nếu có) ======
async function findByAttribute(text, catalog) {
  const attrs = extractAttributes(text);
  const out = [];
  if (!attrs.length) return { attrs, products: out };
  const c = catalog || (await ensure());
  for (const p of c.list) {
    if (!sellable(p)) continue;
    const hay = foldVi([p.name, p.description, p.category].join(" "));
    if (attrs.every(a => a.terms.some(x => hasTerm(hay, x)))) out.push(p);
  }
  return { attrs, products: dedupByCode(out) };
}

// ====== LỌC ĐỒ ĐI BIỂN (cột U = "Biển"), lọc theo CHỦNG LOẠI nếu khách nói rõ ======
// catWanted: "vay" | "set" | "ao" | "quan" | "" (rỗng = mọi chủng loại).
async function findBeach(catWanted, catalog) {
  const c = catalog || (await ensure());
  const out = [];
  for (const p of c.list) {
    if (!sellable(p)) continue;
    if (!p.beach) continue;
    if (catWanted && catGroup(p) && catGroup(p) !== catWanted) continue;
    out.push(p);
  }
  return dedupByCode(out);
}

// ====== DỰNG GALLERY GỬI (content_ids + caption tên+giá) ======
// products: mảng SP đã lọc (ưu tiên). color: lọc ảnh đúng màu. exclude: mã đã gửi/đang xem.
// withPrices: kèm tên+giá hay chỉ gửi ảnh (mặc định true). colorFallback: nếu không có ảnh đúng-tên-màu
//   thì vẫn lấy ảnh đại diện của mẫu (đã khớp màu theo sheet) -> dùng cho duyệt màu khi tên ảnh chưa gắn màu.
function buildGallery(products, opts = {}) {
  const { color = null, exclude = [], maxModels = 10, withPrices = true, colorFallback = false } = opts;
  const ex = new Set((exclude || []).map(x => String(x || "").toUpperCase()));
  const picked = [];
  for (const p of products) {
    const code = String(p.code || "").toUpperCase();
    if (!code || ex.has(code)) continue;
    const items = images.imageItemsByColor(code, color, 2, colorFallback);   // [{contentId,url}]
    if (items.length) picked.push({ p, items });
    if (picked.length >= maxModels) break;
  }
  if (!picked.length) return null;

  let models, perModel;
  if (picked.length >= 10) { models = picked.slice(0, 10); perModel = 1; }
  else if (picked.length >= 5) { models = picked.slice(0, 5); perModel = 2; }
  else { models = picked; perModel = 2; }

  const contentIds = [];
  const imageUrls = [];
  const items = [];   // CẶP ĐÚNG {contentId,url} cho TỪNG ảnh -> gửi lại lẻ đúng ảnh lỗi (kèm URL fallback của chính nó).
  for (const m of models) for (const it of m.items.slice(0, perModel)) {
    if (!it.contentId && !it.url) continue;
    items.push({ contentId: it.contentId || null, url: it.url || null });
    if (it.contentId) contentIds.push(it.contentId);
    if (it.url) imageUrls.push(it.url);
  }

  const caption = withPrices
    ? models.map((m, i) => {
        const pr = priceLabel(m.p);
        return `${i + 1}. ${m.p.name}${pr ? " - " + pr : ""}`;
      }).join("\n")
    : "";

  return {
    contentIds,
    imageUrls,
    items,
    caption,
    codes: models.map(m => String(m.p.code || "").toUpperCase()),
    count: models.length,
    perModel
  };
}

module.exports = { findByColor, findByAttribute, findBeach, catGroup, extractAttributes, buildGallery, priceLabel, sellable, isOutOfStock, stockNum, dedupByCode };
