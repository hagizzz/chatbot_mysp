// ============================================================================
// order_extractor.js — SUY RA ĐƠN TỪ HỘI THOẠI (đối chiếu "cod" của Bảo Châu)
// ----------------------------------------------------------------------------
// Nguồn dữ liệu:
//   (1) conversation_memory.json của bot tư vấn — CHỈ ĐỌC: lấy mã/size/sđt/địa chỉ
//       đã chốt sẵn (đáng tin vì bot tư vấn đã lưu trong lúc chat).
//   (2) Lịch sử hội thoại — để XÁC NHẬN Bảo Châu ĐÃ CHỐT (tin "cod"), và để dò MÀU
//       (bộ nhớ tư vấn KHÔNG lưu màu khách chọn).
//
// Quy tắc CỨNG: THIẾU bất kỳ thông tin nào (mã / màu / size / sđt / địa chỉ /
// chưa thấy tin chốt) -> KHÔNG lên đơn dòng đó. (theo yêu cầu)
// ============================================================================
const fs = require("fs");
const { CONSULT_MEMORY_FILE } = require("./order_config");
const { colorMatches } = require("./color_utils");
const { fold } = require("./pos_client");
// Giá hiệu lực: dùng CHUNG quy tắc với bot tư vấn (salePrice -> price -> originalPrice)
// -> tránh lệch tiền khi SP đang SALE, và không ra 0đ với SP chỉ có originalPrice.
const { getPrice } = require("./product_reply_rules");

// ---- ĐỌC bộ nhớ bot tư vấn (CHỈ ĐỌC) ----
// Từ GĐ0: đọc MỘT dòng trong SQLite thay vì parse cả file 830 KB cho mỗi hội thoại.
// SQLite bật WAL nên tiến trình này đọc được trong lúc bot tư vấn đang ghi.
// Node cũ không có node:sqlite -> tự quay về đọc file JSON như trước.
let _store = null;
try { require("node:sqlite"); _store = require("./conversation_store"); } catch (_) {}

function readConsultMemory(conversationId) {
  if (_store) {
    try { return _store.docChiDoc(conversationId); } catch (_) { /* rơi xuống cách cũ */ }
  }
  try {
    const all = JSON.parse(fs.readFileSync(CONSULT_MEMORY_FILE, "utf8"));
    return all[String(conversationId)] || null;
  } catch { return null; }
}

// ---- SĐT: chuẩn hóa + validate số VN ----
function normalizePhone(raw) {
  let s = String(raw || "").replace(/[^\d+]/g, "");
  if (s.startsWith("+84")) s = "0" + s.slice(3);
  else if (s.startsWith("84") && s.length === 11) s = "0" + s.slice(2);
  // di động VN: 03,05,07,08,09 + 8 số = 10 số bắt đầu bằng 0
  if (/^0(3|5|7|8|9)\d{8}$/.test(s)) return s;
  // số cố định 10-11 số bắt đầu 0 cũng tạm chấp nhận
  if (/^0\d{9,10}$/.test(s)) return s;
  return null;
}
function findPhoneInText(text) {
  const m = String(text || "").match(/(?:\+?84|0)\s?\d(?:[\s.\-]?\d){8,9}/g) || [];
  for (const cand of m) { const p = normalizePhone(cand); if (p) return p; }
  return null;
}

// ---- ĐỊA CHỈ: nhận diện chuỗi GIỐNG địa chỉ thật (không phải câu hỏi) ----
const ADDR_TOKENS = /(đường|phố|ngõ|ngách|hẻm|số nhà|\bsố\b|phường|\bp\.|quận|\bq\.|huyện|\bxã\b|thị trấn|thị xã|tỉnh|thành phố|\btp\b|thôn|xóm|khu|kđt|chung cư|tòa)/i;
function looksLikeAddress(text) {
  const t = String(text || "").trim();
  if (t.length < 12) return false;
  if (/\?|địa chỉ nào|chỗ nào|ở đâu/i.test(t)) return false;           // là câu hỏi -> loại
  const hasToken = ADDR_TOKENS.test(t);
  const hasComma = (t.match(/,/g) || []).length >= 1;
  const hasDigit = /\d/.test(t);
  // địa chỉ thật: có từ khóa địa chỉ, hoặc (có số nhà + dấu phẩy ngăn cấp).
  return hasToken || (hasDigit && hasComma && t.length >= 16);
}
function findAddressInMessages(customerMsgs) {
  // duyệt từ MỚI -> CŨ, lấy tin khách giống địa chỉ nhất.
  for (let i = customerMsgs.length - 1; i >= 0; i--) {
    const t = customerMsgs[i];
    if (looksLikeAddress(t)) return t.trim();
  }
  return null;
}

// ---- SIZE: lấy token size từ text ----
function findSizeInText(text) {
  const m = fold(text).match(/(?<![A-Z0-9])(XS|S|M|L|XL|XXL|XXXL|FREESIZE|FREE)(?![A-Z0-9])/);
  if (!m) return null;
  return m[1] === "FREE" ? "FREESIZE" : m[1];
}

// ---- MÀU: dò màu khách chọn trong các màu SP có ----
// availColors: chuỗi "XAM,DEN,HONG" (hoặc mảng). Trả màu (đúng dạng trong avail) hoặc null.
function detectColor(customerMsgs, availColors) {
  const list = (Array.isArray(availColors) ? availColors : String(availColors || "").split(/[,/|]/))
    .map(c => c.trim()).filter(Boolean);
  if (!list.length) return { color: null, single: false, reason: "SP không khai báo màu" };
  if (list.length === 1) return { color: list[0], single: true };

  // map màu folded -> nguyên bản, + vài bí danh tiếng Việt thường gặp
  const ALIAS = {
    "DEN": ["DEN", "BLACK"], "TRANG": ["TRANG", "WHITE"], "DO": ["DO", "RED"],
    "XANH": ["XANH", "BLUE", "GREEN"], "HONG": ["HONG", "PINK"], "VANG": ["VANG", "YELLOW"],
    "TIM": ["TIM", "PURPLE"], "NAU": ["NAU", "BROWN"], "XAM": ["XAM", "GHI", "GRAY", "GREY"],
    "BE": ["BE", "BEIGE", "KEM", "CREAM"], "CAM": ["CAM", "ORANGE"]
  };
  // duyệt tin MỚI -> CŨ, tìm màu khách nhắc tới
  for (let i = customerMsgs.length - 1; i >= 0; i--) {
    const t = fold(customerMsgs[i]);
    for (const col of list) {
      const key = fold(col);
      const variants = ALIAS[key] || [key];
      if (variants.some(v => new RegExp(`(^|[^A-Z])${v}([^A-Z]|$)`).test(t))) {
        return { color: col, single: false };
      }
    }
  }
  return { color: null, single: false, reason: "khách chưa nói rõ màu (SP nhiều màu)" };
}

// ---- Có tin CHỐT của Bảo Châu chưa? (bằng chứng "cod") ----
function findConfirmation(messages) {
  // tin của SHOP, gần cuối, mang ý lên đơn / cảm ơn đã đặt.
  const PAT = /(em lên đơn|lên đơn .*(cho mình|gửi)|đã đặt hàng|cảm ơn .*(đặt|mua)|chốt đơn|xác nhận đơn)/i;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.sender === "shop" && m.type === "text" && PAT.test(m.text || "")) return m;
  }
  return null;
}

// ---- ĐỌC CÁC TRƯỜNG TRONG TIN COD (tin chốt có cấu trúc của Bảo Châu) ----
// Mẫu cod:
//   Dạ em chốt đơn cho mình nha ạ 💕
//   • Sản phẩm: Samira - size S
//   • Thanh toán khi nhận (COD): 355.000đ
//   • SĐT: 0989045666
//   • Giao về: số 1 đường HUỲNH THÚC KHÁNG BẮC GIANG
// Trả { productName, size, phone, address, cod } (trường nào không có -> null).
// Cắt câu chúc / cảm ơn / lời kết ở ĐUÔI (bot hay thêm "Chúc chị... ạ", "Cảm ơn...",
// "Shop rất mong được nhìn thấy... hy vọng...") -> khỏi dính vào địa chỉ.
function stripTrailingPleasantry(s) {
  return String(s || "")
    .replace(/[\s,;.]*\b(Ch[úu]c|C[ảa]m\s*[ơo]n|Shop\s*(?:xin|r[ấâ]t\s*mong|mong|hy\s*v[ọo]ng)|r[ấâ]t\s*mong\s*đư[ợo]c|hy\s*v[ọo]ng|mong\s*đư[ợo]c\s*nh[ìi]n)\b[^\n]*$/i, "")
    .replace(/[\s,;.]+$/, "")
    .trim();
}

// Đưa MỖI nhãn trường về ĐẦU DÒNG — kể cả khi Pancake nuốt mất xuống dòng (gộp các bullet "-" thành 1 dòng).
// -> các hàm grab "[^\n•]" cắt ĐÚNG từng trường, KHÔNG để địa chỉ/SĐT lẫn vào "Sản phẩm".
const _FIELD = "(?:S[ảa]n\\s*ph[ẩa]m|COD|Thanh\\s*to[áa]n(?:\\s*khi\\s*nh[ậa]n)?|S[ĐĐ]T|SDT|S[ốo]\\s*đi[ệe]n\\s*tho[ạa]i|Đ[ịi]a\\s*ch[ỉi]|D[ia]a\\s*chi|Giao\\s*v[ềe])";
function normalizeCodText(text) {
  let t = String(text || "").replace(/\r/g, "");
  // bullet "•" / "-" / "–" / "·" ngay TRƯỚC một nhãn trường -> xuống dòng (hyphen trong tên SP không bị đụng vì phải đứng trước nhãn:)
  t = t.replace(new RegExp(`\\s*[•\\-–·]\\s*(?=${_FIELD}\\s*:)`, "gi"), "\n");
  // nhãn trường nằm GIỮA dòng (không có bullet) -> chèn xuống dòng trước nó
  t = t.replace(new RegExp(`(?<!\\n)\\s+(?=${_FIELD}\\s*:)`, "gi"), "\n");
  return t;
}

function parseCod(text) {
  const t = normalizeCodText(text);
  const grab = (re) => { const m = t.match(re); return m ? m[1].trim() : null; };

  // Sản phẩm: <tên> - size <SIZE>   (chữ "size" có thể lặp: "size size S")
  const spLine = grab(/S[ảa]n ph[ẩa]m\s*:?\s*([^\n•]+)/i);
  let productName = null, size = null;
  // ĐA MẪU trong 1 dòng ("A - size M và B - size L") -> KHÔNG bóc 1 mẫu (sẽ lấy nhầm size); để người thật xử.
  const multiProduct = !!spLine && (/\bvà\b/i.test(spLine) || (spLine.match(/size\s+[A-Za-zÀ-ỹ]/gi) || []).length >= 2);
  if (spLine) {
    const mSize = spLine.match(/size\s+([A-Za-zÀ-ỹ]+)\s*$/i) || spLine.match(/size\s+([A-Za-z]+)/i);
    size = mSize ? findSizeInText(mSize[1]) || mSize[1].toUpperCase() : findSizeInText(spLine);
    // tên = phần trước " - size" / trước "size"
    productName = spLine.replace(/\s*[-–]?\s*size.*$/i, "").trim() || null;
  }

  // SĐT
  const phoneRaw = grab(/(?:S[ĐĐ]T|SDT|Số ?điện ?thoại)\s*:?\s*([\d.\s+]+)/i);
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;

  // Giao về: / Địa chỉ: <địa chỉ> (đến hết dòng / hết bullet) — bot tư vấn ghi nhãn "Địa chỉ:".
  let address = grab(/(?:Giao\s*v[ềe]|Đ[ịi]a\s*ch[ỉi]|D[ia]a\s*chi)\s*:?\s*([^\n•]+)/i);
  if (address) address = stripTrailingPleasantry(address);

  // COD số tiền
  const codRaw = grab(/COD\)?\s*:?\s*([\d.,]+)/i);
  const cod = codRaw ? Number(codRaw.replace(/[^\d]/g, "")) || null : null;

  return { productName, size, phone, address: address ? address.trim() : null, cod, multiProduct };
}

// ---- LẤY TẤT CẢ TIN COD CÓ CẤU TRÚC (mỗi mẫu 1 tin chốt -> mỗi tin = 1 đơn) ----
// Tin cod "thật" = tin SHOP có dòng "Sản phẩm:" + ít nhất 1 trong (COD / SĐT / Giao về).
// -> loại được câu chốt 1 dòng kiểu "em lên đơn mẫu X" và câu "hết hàng".
function findAllCods(messages) {
  const out = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.sender !== "shop" || m.type !== "text") continue;
    const t = m.text || "";
    const hasSP = /S[ảa]n\s*ph[ẩa]m\s*:/i.test(t);
    const hasField = /(COD|S[ĐĐ]T|SDT|Giao\s*v[ềe])/i.test(t);
    if (hasSP && hasField) out.push({ idx: i, text: t, cod: parseCod(t) });
  }
  return out;
}

// ============================================================================
// HELPER: tách dòng "Sản phẩm:" thành TỪNG MÓN, kiểm địa chỉ đủ, dựng 1 món.
// ============================================================================

// "A - hồng - size M và B - đen - size L x2" -> [{name,color,size,qty,raw}]
function parseProductSegments(spLine) {
  if (!spLine) return [];
  const segs = String(spLine).split(/\s+và\s+|,\s+/i).map(s => s.trim()).filter(Boolean);
  return segs.map(seg => {
    let size = null;
    const mSize = seg.match(/size\s+([A-Za-zÀ-ỹ]+)/i);
    if (mSize) size = findSizeInText(mSize[1]) || mSize[1].toUpperCase();
    else if (/\bfree\s*size\b|\bfreesize\b/i.test(seg)) size = "FREESIZE";
    const mQty = seg.match(/x\s*(\d+)\s*$/i);
    const qty = mQty ? Math.max(1, Number(mQty[1])) : 1;
    const rest = seg
      .replace(/\s*[-–]?\s*size\s+[A-Za-zÀ-ỹ]+/i, "")
      .replace(/\s*[-–]?\s*free\s*size\b/i, "")
      .replace(/\s*x\s*\d+\s*$/i, "")
      .trim();
    const parts = rest.split(/\s*[-–]\s*/).map(s => s.trim()).filter(Boolean);
    const name = parts[0] || rest;
    const color = parts.length >= 2 ? parts.slice(1).join(" ").replace(/^màu\s+/i, "").trim() : "";
    return { name, color, size, qty, raw: seg };
  });
}

// ĐỊA CHỈ ĐỦ ĐỂ GIAO: cần (ĐƯỜNG/PHƯỜNG/XÃ/SỐ NHÀ...) + (QUẬN/HUYỆN HOẶC TP/TỈNH HOẶC >=3 mốc hành chính).
// Tỉnh/thành để order_worker xác minh thêm bằng matchProvince — KHÔNG bắt buộc đủ "quận/huyện" (vùng tỉnh hay ghi thẳng "tp X").
function addressComplete(addr) {
  const t = stripTrailingPleasantry(String(addr || "")).trim();
  if (!t || t.length < 12) return false;
  const f = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();
  if (/\?|dia chi nao|cho nao|o dau|chua co dia chi/.test(f)) return false;
  const hasWardStreet = /\b(phuong|xa|duong|pho|ngo|ngach|hem|kiet|thon|xom|ap|to\s*\d|khu|kdt|kp|so nha|toa|chung cu|cc|block|lo)\b/.test(f) || /\d{1,4}\s*[\/-]?\s*\d{0,3}/.test(t);
  const hasDistrict = /\b(quan|huyen|thi xa|thi tran)\b/.test(f) || /\bq\.?\s*\d/.test(f);
  // Danh sách TỈNH/THÀNH đầy đủ (cũ + mới sau sáp nhập 2025) — khách ghi tên nào cũng nhận.
  const PROVINCES = /\b(an giang|kien giang|bac lieu|ca mau|soc trang|hau giang|can tho|vinh long|tra vinh|dong thap|tien giang|ben tre|long an|tay ninh|binh duong|binh phuoc|dong nai|ba ria|vung tau|ho chi minh|sai gon|hcm|tphcm|lam dong|dak nong|dak lak|gia lai|kon tum|phu yen|khanh hoa|ninh thuan|binh thuan|binh dinh|quang ngai|quang nam|da nang|thua thien|hue|quang tri|quang binh|ha tinh|nghe an|thanh hoa|ninh binh|nam dinh|ha nam|thai binh|hung yen|hai duong|hai phong|quang ninh|bac giang|bac ninh|vinh phuc|phu tho|thai nguyen|bac kan|cao bang|lang son|tuyen quang|ha giang|yen bai|lao cai|lai chau|dien bien|son la|hoa binh|ha noi|nha trang|da lat|bien hoa)\b/;
  const hasCity = /\b(tp|tphcm|thanh pho|tinh)\b/.test(f) || PROVINCES.test(f);
  const adminCues = (f.match(/\b(phuong|xa|duong|to|quan|huyen|thi xa|thi tran|tp|thanh pho|tinh|thon|xom|ap|khu)\b/g) || []).length;
  return hasWardStreet && (hasDistrict || hasCity || adminCues >= 3);
}

// 1 MÓN: { ok, item:{code,color,size,productName,price,quantity}, reason }
function resolveItem(seg, ctx) {
  const { findByName, mem, customerMsgs } = ctx;
  const p = findByName(seg.name);
  if (!p) return { ok: false, reason: `không tra được MÃ cho "${seg.name}"` };
  const codeU = String(p.code).toUpperCase();
  const avail = String(p.color || "").split(/[,/|]/).map(s => s.trim()).filter(Boolean);

  // MÀU: dòng chốt > orderColorByCode (khách chốt) > colorByCode (ảnh) > orderColor > tin khách.
  let color = null;
  if (avail.length <= 1) color = avail[0] || (seg.color || null);
  else {
    if (seg.color) { const hit = avail.find(c => colorMatches(c, seg.color) || fold(c) === fold(seg.color) || fold(seg.color).includes(fold(c))); if (hit) color = hit; }
    if (!color) {
      const mc = (mem.orderColorByCode && mem.orderColorByCode[codeU]) || (mem.colorByCode && mem.colorByCode[codeU]) || mem.orderColor || "";
      if (mc) { const hit = avail.find(c => colorMatches(c, mc)); if (hit) color = hit; }
    }
    if (!color) { const dc = detectColor(customerMsgs, avail); if (dc.color) color = dc.color; }
  }

  // SIZE: dòng chốt > size riêng theo dòng (mã|màu) > size chung khách. SP freesize -> ép FREESIZE.
  const sizeList = String(p.size || "").split(/[,/|]/).map(s => fold(s)).filter(Boolean);
  const isFree = s => /^(FS|FREE|FREESIZE)$/.test(s);
  let size = seg.size ? String(seg.size).toUpperCase() : null;
  if (!size) {
    const perLine = mem.sizeByLine ? (mem.sizeByLine[codeU + "|" + fold(color || "")] || mem.sizeByLine[codeU + "|"]) : null;
    if (perLine && fold(perLine) !== "FREESIZE") size = String(perLine).toUpperCase();
    else if (mem.customerSize && fold(mem.customerSize) !== "FREESIZE") size = String(mem.customerSize).toUpperCase();
  }
  if (sizeList.length === 1 && isFree(sizeList[0])) size = "FREESIZE";

  const reasons = [];
  if (avail.length >= 2 && !color) reasons.push("thiếu màu");
  if (!size) reasons.push("thiếu size");
  else if (sizeList.length && !isFree(fold(size)) && !sizeList.includes(fold(size))) reasons.push(`size ${size} không có (SP có ${p.size})`);
  if (reasons.length) return { ok: false, reason: reasons.join("; ") };

  return { ok: true, item: {
    code: p.code, color: color || "", size,
    productName: p.name || "",
    price: Number(String(getPrice(p) || "").replace(/[^\d]/g, "")) || 0,
    quantity: Math.max(1, seg.qty || 1)
  } };
}

// ============================================================================
// HÀM CHÍNH: build danh sách ĐƠN. MỖI tin chốt = 1 ĐƠN (có thể NHIỀU MÓN).
//   - Lẻ tẻ nhiều lần/ngày: mỗi tin chốt 1 đơn -> chống trùng theo chữ ký (thời điểm + món).
//   - 1 mã nhiều size / nhiều màu: mỗi (mã,màu,size) là 1 MÓN trong đơn.
//   - LÊN BẰNG MÃ; cần đủ mã + màu + size + SĐT(10 số) + địa chỉ đủ + COD.
// trả: { confirmed, fullName, customerFbId, orders:[{sig,phone,address,cod,items[]}], blocked:[], missingGlobal:[] }
// ============================================================================
function buildOrderPlan(conversationId, conv) {
  const messages = conv.messages || [];
  const customerMsgs = messages.filter(m => m.sender === "customer" && m.type === "text").map(m => m.text);
  const mem = readConsultMemory(conversationId) || {};

  const out = { confirmed: false, fullName: conv.customerName || "", customerFbId: conv.customerPsid || null, orders: [], blocked: [], missingGlobal: [] };

  // Danh mục SP (TÊN -> MÃ + màu/size). LÊN ĐƠN BẰNG MÃ; tên chỉ để tra. Khớp DÀI nhất (tránh nhầm tên con).
  const candidates = [];
  const seenC = new Set();
  const pushProd = p => { if (p && p.code) { const k = String(p.code).toUpperCase(); if (!seenC.has(k)) { seenC.add(k); candidates.push(p); } } };
  (mem.quotedProducts || []).forEach(pushProd);
  pushProd(mem.currentProduct);
  const STRIP_PREFIX = /^(set|b[ộo]|đ[ầa]m|v[áa]y|ch[âa]n\s*v[áa]y|[áa]o|qu[ầa]n|jumpsuit)\s+/i;
  const findByName = (name) => {
    const tryFind = (nm) => {
      if (!nm) return null;
      const nf = fold(nm);
      let best = null, bestLen = -1;
      for (const p of candidates) {
        if (!p.name) continue;
        const pf = fold(p.name);
        if (pf && (nf.includes(pf) || pf.includes(nf)) && pf.length > bestLen) { best = p; bestLen = pf.length; }
      }
      return best;
    };
    let hit = tryFind(name);
    // "Set Clarine" / "Váy Gwenelle" -> danh mục lưu tên trần "Clarine"/"Gwenelle" -> thử lại sau khi bỏ tiền tố loại.
    if (!hit && STRIP_PREFIX.test(String(name || ""))) hit = tryFind(String(name).replace(STRIP_PREFIX, "").trim());
    return hit;
  };
  const ctx = { findByName, mem, customerMsgs };

  const cods = findAllCods(messages);
  const looseConf = findConfirmation(messages);
  out.confirmed = cods.length > 0 || !!looseConf;
  if (!out.confirmed) { out.missingGlobal.push("chưa thấy tin chốt (cod)"); return out; }

  const memPhone = normalizePhone(mem.phone);
  const memAddr = (mem.address && looksLikeAddress(mem.address)) ? String(mem.address).trim() : null;

  // CHỈ xử lý tin chốt MỚI NHẤT = ĐƠN TỔNG hiện tại. Bot tư vấn re-confirm CẢ ĐƠN mỗi khi khách thêm mẫu,
  // nên tin chốt mới nhất đã gồm ĐỦ mọi mẫu -> tránh lên trùng mẫu cũ. (1 hội thoại = 1 đơn = 1 lần ship.)
  const codEntries = cods.length
    ? [{ text: cods[cods.length - 1].text, cod: cods[cods.length - 1].cod, msg: messages[cods[cods.length - 1].idx] }]
    : [{ text: looseConf.text, cod: {}, msg: looseConf }];

  for (const ce of codEntries) {
    const codInfo = ce.cod || {};
    const reasons = [];
    const order = { sig: null, fullName: out.fullName, customerFbId: out.customerFbId, phone: null, address: null, cod: null, items: [] };

    // SĐT (đủ 10 số)
    order.phone = codInfo.phone || memPhone || findPhoneInText(ce.text || "");
    if (!order.phone || !/^0\d{9}$/.test(order.phone)) reasons.push("thiếu/sai SĐT (phải đủ 10 số)");

    // ĐỊA CHỈ (đủ để giao)
    let addr = (codInfo.address && looksLikeAddress(codInfo.address)) ? codInfo.address : null;
    if (!addr) addr = memAddr;
    order.address = addr ? String(addr).trim() : null;
    if (!order.address) reasons.push("thiếu địa chỉ");
    else if (!addressComplete(order.address)) reasons.push(`địa chỉ chưa đủ để giao ("${order.address}")`);

    // MÓN HÀNG (parse dòng "Sản phẩm:"; rỗng -> bộ nhớ). Dùng tin chốt ĐÃ CHUẨN HÓA để không vớ nhầm địa chỉ.
    let segs = [];
    const spm = normalizeCodText(ce.text || "").match(/S[ảa]n ph[ẩa]m\s*:?\s*([^\n•]+)/i);
    if (spm) segs = parseProductSegments(spm[1]);
    if (!segs.length) {
      const p = mem.currentProduct || (mem.quotedProducts || [])[0];
      if (p) segs = [{ name: p.name, color: "", size: null, qty: 1 }];
    }
    for (const sg of segs) {
      const r = resolveItem(sg, ctx);
      if (r.ok) order.items.push(r.item);
      else reasons.push(`món "${sg.name || sg.raw}": ${r.reason}`);
    }
    if (!order.items.length) reasons.push("không xác định được sản phẩm");

    // COD (lấy theo bot; không có -> tính từ món + ship §14)
    order.cod = (codInfo.cod && codInfo.cod > 0) ? codInfo.cod : null;
    if (!order.cod && order.items.length) {
      const tot = order.items.reduce((s, it) => s + it.price * it.quantity, 0);
      if (tot > 0) order.cod = tot >= 500000 ? tot : tot + 30000;
    }
    if (!order.cod || order.cod <= 0) reasons.push("thiếu số tiền COD");

    // CHỮ KÝ chống trùng = CHỈ theo MÓN (mã:màu:size:sl), KHÔNG theo thời gian.
    // -> cùng 1 đơn dù khách/bot xác nhận lại nhiều lần (kể cả hôm sau) vẫn là 1 chữ ký -> KHÔNG lên lặp.
    //    Thêm/bớt mẫu -> chữ ký KHÁC -> worker phát hiện "đơn thay đổi" để NV cập nhật (không tạo trùng).
    order.sig = order.items.map(it => `${it.code}:${it.color}:${it.size}:${it.quantity}`).sort().join(",") || `NOITEM|${order.phone || ""}`;

    if (reasons.length) out.blocked.push({ sig: order.sig, reasons, items: order.items.map(it => `${it.code}/${it.color}/${it.size}`) });
    else out.orders.push(order);
  }

  if (!out.orders.length && !out.blocked.length) out.missingGlobal.push("không dựng được đơn nào đủ điều kiện");
  return out;
}

module.exports = {
  buildOrderPlan,
  parseProductSegments, addressComplete, resolveItem,
  normalizePhone, looksLikeAddress, detectColor, findConfirmation, parseCod, readConsultMemory
};
