const __goc = require("path").join(__dirname, "..", "..");
// Tra ảnh sản phẩm theo MÃ từ hash_index.json. Trả về content_id của Pancake (đã up sẵn).
const fs = require("fs");
const path = require("path");
const { colorMatches, foldVi } = require("./color_utils");

const HASH_FILE = path.join(__goc, "hash_index.json");

let _byCode = null;
let _byId = null;

// Bóc MÀU từ tên file theo quy ước: "MÃ-MÀU (số).png" -> "Màu".
//   MRKSQ6017-HỒNG (12).png      -> "Hồng"
//   MRKSQ6017-XANH NHẠT(15).png  -> "Xanh nhạt"
function colorFromName(name, code) {
  let s = String(name || "").trim();
  s = s.replace(/\.[a-z0-9]+$/i, "");                       // bỏ đuôi .png/.jpg
  if (code) {
    const esc = String(code).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp("^\\s*" + esc, "i"), "");       // bỏ MÃ ở đầu (làm TRƯỚC khi bỏ số)
  }
  s = s.replace(/\s*\(\s*\d+\s*\)\s*$/, "");                // bỏ "(12)" cuối
  s = s.replace(/[\s\-_]*ai\s*$/i, "");                     // bỏ đuôi "-AI" (tag batch ảnh) -> lấy ĐÚNG phần MÀU ("MÃ-Kem-AI" -> "Kem")
  s = s.replace(/[\s\-_]+(sau|lung|lưng|back|truoc|trước|front|mặt sau|mặt trước|behind)(?=[\s\-_]|$)/gi, " ");  // bỏ token MẶT TRƯỚC/SAU -> "MÃ-Kem-SAU" -> "Kem"
  s = s.replace(/[\s_]*\d+\s*$/, "");                       // bỏ số cuối còn sót (vd "HỒNG 13")
  s = s.replace(/^[\s\-_]+/, "").replace(/[\s\-_]+$/, "").trim();
  if (!s) return "";
  // CHẶN MÀU RÁC: tên file lỗi (vd "MÃ-KEMMRKVX6310-BE-AI") bóc ra "kemmrkvx6310-be" (CHỨA mã sp).
  // Màu thật KHÔNG bao giờ có 4+ chữ số liền -> coi như KHÔNG đọc được màu (bỏ qua, đừng đem khoe khách).
  if (/\d{4,}/.test(s)) return "";
  s = s.toLowerCase();                                     // "XANH NHẠT" -> "xanh nhạt"
  return s.charAt(0).toUpperCase() + s.slice(1);           // -> "Xanh nhạt"
}

function loadById() {
  if (_byId) return _byId;
  _byId = new Map();
  try {
    const arr = JSON.parse(fs.readFileSync(HASH_FILE, "utf8"));
    for (const item of arr) { if (item && item.id != null) _byId.set(String(item.id), item); }
  } catch (e) { try { console.log("[images] lỗi nạp byId:", e.message); } catch (_) {} }
  return _byId;
}

// Tra MÀU theo id ảnh Drive (vision trả image_id của ảnh khớp nhất).
function getColorByImageId(imageId) {
  if (!imageId) return "";
  const it = loadById().get(String(imageId));
  if (!it) return "";
  return colorFromName(it.name, it.code);
}

// content_id (Pancake) của ĐÚNG tấm ảnh khớp (theo image_id Drive vision trả) -> gửi chắc chắn đúng mẫu+màu.
function contentIdByImageId(imageId) {
  if (!imageId) return null;
  const it = loadById().get(String(imageId));
  return it && it.pancakeId ? it.pancakeId : null;
}
// URL ảnh thật của tấm khớp (fallback khi content_id bị từ chối).
function urlByImageId(imageId) {
  if (!imageId) return null;
  const it = loadById().get(String(imageId));
  return it ? (it.downloadUrl || it.thumbnailUrl || null) : null;
}

function load() {
  if (_byCode) return _byCode;
  _byCode = new Map();
  try {
    const arr = JSON.parse(fs.readFileSync(HASH_FILE, "utf8"));
    for (const item of arr) {
      const code = String(item.code || "").toUpperCase().trim();
      if (!code) continue;
      if (!_byCode.has(code)) _byCode.set(code, []);
      _byCode.get(code).push(item);
    }
    console.log("[images] đã nạp ảnh cho", _byCode.size, "mã sản phẩm");
  } catch (e) {
    console.log("[images] lỗi đọc hash_index.json:", e.message);
  }
  return _byCode;
}

// Trả về danh sách CONTENT_ID (Pancake) của 1 mã - chỉ lấy ảnh đã up sẵn.
function getContentIds(code, limit = 3) {
  const map = load();
  const items = map.get(String(code || "").toUpperCase().trim()) || [];
  return items
    .map(it => it.pancakeId)
    .filter(Boolean)
    .slice(0, limit);
}

// Giữ tên cũ getImageUrls để bot_worker khỏi sửa nhiều: giờ nó trả content_ids.
function getImageUrls(code, limit = 3) {
  return getContentIds(code, limit);
}

// Trả về URL ẢNH THẬT (lh3 w1600) để fallback khi gửi bằng content_id bị FB từ chối.
function getImageDownloadUrls(code, limit = 3) {
  const map = load();
  const items = map.get(String(code || "").toUpperCase().trim()) || [];
  return items.map(it => it.downloadUrl || it.thumbnailUrl).filter(Boolean).slice(0, limit);
}

function itemsByCode(code) {
  const map = load();
  return map.get(String(code || "").toUpperCase().trim()) || [];
}

// Các MÀU mà 1 mã đang có (đọc từ tên file ảnh, lọc rác/không hợp lệ ở nơi gọi nếu cần).
function getCodeColors(code) {
  const out = [];
  for (const it of itemsByCode(code)) {
    const c = colorFromName(it.name, it.code);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

// MÀU của ẢNH ĐẠI DIỆN (tấm đầu tiên có màu đọc được) -> dùng khi khách hỏi "ảnh này màu gì".
function representativeColor(code) {
  for (const it of itemsByCode(code)) {
    const c = colorFromName(it.name, it.code);
    if (c) return c;
  }
  return "";
}

// content_id của 1 mã, LỌC THEO MÀU (nếu truyền màu). Không có ảnh đúng màu -> trả rỗng.
function contentIdsByColor(code, color, limit = 3) {
  const items = itemsByCode(code);
  const out = [], seen = new Set();
  // CHIẾN DỊCH: ghim content_id ưu tiên lên đầu.
  for (const p of campaignPins(code, color, limit)) {
    if (p.contentId && !seen.has(p.contentId)) { seen.add(p.contentId); out.push(p.contentId); }
    if (out.length >= limit) return out;
  }
  for (const it of items) {
    if (!it.pancakeId || seen.has(it.pancakeId)) continue;
    if (color) {
      const c = colorFromName(it.name, it.code);
      if (!(c && (colorMatches(c, color) || colorMatches(color, c)))) continue;
    }
    seen.add(it.pancakeId);
    out.push(it.pancakeId);
    if (out.length >= limit) break;
  }
  return out;
}

// Ảnh MẶT SAU? Tên file có token "SAU/LƯNG/BACK" -> ảnh chụp sau lưng; không có -> coi là mặt trước.
function isBackImage(name) {
  const h = foldVi(String(name || ""));
  return /(^|[\s\-_])(sau|lung|back)(?=[\s\-_]|$)/.test(h);
}
// Lấy ảnh theo MẶT (front/back) + lọc MÀU nếu có. side: "back" -> chỉ ảnh có token SAU; "front" -> ảnh KHÔNG có.
function imageItemsBySide(code, side, color, limit = 3, colorFallback = true) {
  const items = itemsByCode(code);
  let pool = items.filter(it => side === "back" ? isBackImage(it.name) : !isBackImage(it.name));
  if (color) {
    const byColor = pool.filter(it => {
      const c = colorFromName(it.name, it.code);
      return c && (colorMatches(c, color) || colorMatches(color, c));
    });
    if (byColor.length) pool = byColor;
    else if (!colorFallback) pool = [];
  }
  const out = [];
  for (const it of pool) {
    const url = it.downloadUrl || it.thumbnailUrl || null;
    if (!it.pancakeId && !url) continue;
    out.push({ contentId: it.pancakeId || null, url });
    if (out.length >= limit) break;
  }
  return out;
}
// Mẫu này CÓ ảnh mặt sau không (lọc màu nếu có) -> để biết gửi được hay nhờ NV.
function hasBackImage(code, color) {
  return itemsByCode(code).some(it => {
    if (!isBackImage(it.name)) return false;
    if (!color) return true;
    const c = colorFromName(it.name, it.code);
    return c && (colorMatches(c, color) || colorMatches(color, c));
  });
}

// Ảnh của 1 mã kèm CẢ content_id LẪN url (để gửi gallery có fallback URL khi FB từ chối content_id).
// color: lọc theo màu. colorFallback: không có ảnh đúng màu -> lấy ảnh bất kỳ của mã.
// ===========================================================================
// CHIẾN DỊCH: GHIM ẢNH ƯU TIÊN theo MÃ + MÀU (ảnh đã có sẵn trong hash_index.json).
//   - Mỗi màu gửi TỐI ĐA 3 ảnh, KHÔNG trùng nhau.
//   - Mã MGKVX6310, màu HỒNG -> luôn ưu tiên 3 file Drive này (theo thứ tự).
//   Ghim theo FILE ID Drive (khớp downloadUrl "lh3.../d/{ID}") -> bền khi pancakeId đổi.
// ===========================================================================
const CAMPAIGN_PIN = {
  "MGKVX6310": {
    "hồng": [
      "1GH1s7Q_Zo1b9Wwp4lBGAiVfbfcNMdVMP",
      "1hDLrDH2G3MYuZXoADtgz_NOn48cm_R3d",
      "1S9rtQ0WQPAFL80cJElPPlyKkgZ56TNNi"
    ]
  }
};
// Tìm item ảnh theo FILE ID Drive (trong downloadUrl/thumbnailUrl dạng lh3.../d/{ID}).
function itemByDriveId(code, fileId) {
  for (const it of itemsByCode(code)) {
    const u = String(it.downloadUrl || it.thumbnailUrl || "");
    if (u.includes("/d/" + fileId)) return it;
  }
  return null;
}
// Danh sách ảnh GHIM (chiến dịch) cho code+color -> [{contentId,url}], đã dedupe, tối đa limit.
function campaignPins(code, color, limit = 3) {
  const cu = String(code || "").toUpperCase().trim();
  const conf = CAMPAIGN_PIN[cu];
  if (!conf || !color) return [];
  let ids = null;
  for (const k of Object.keys(conf)) {
    if (colorMatches(k, color) || colorMatches(color, k)) { ids = conf[k]; break; }
  }
  if (!ids || !ids.length) return [];
  const out = [], seen = new Set();
  for (const fid of ids) {
    const it = itemByDriveId(cu, fid);
    if (!it) continue;
    const id = it.pancakeId || null;
    const url = it.downloadUrl || it.thumbnailUrl || null;
    const key = id || url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ contentId: id, url });
    if (out.length >= limit) break;
  }
  return out;
}

// Bộ ảnh MẶC ĐỊNH chiến dịch khi gửi mã (KHÔNG nêu màu cụ thể): MGKVX6310 -> 2 hồng (ghim) + 1 kem.
const CAMPAIGN_DEFAULT = {
  "MGKVX6310": { pink: 2, fill: "kem" }
};
function campaignDefaultItems(code, limit = 3) {
  const cu = String(code || "").toUpperCase().trim();
  const conf = CAMPAIGN_DEFAULT[cu];
  if (!conf) return null;
  const out = [], seen = new Set();
  for (const p of campaignPins(cu, "hồng", conf.pink || 2)) {
    const key = p.contentId || p.url;
    if (key && !seen.has(key)) { seen.add(key); out.push(p); }
    if (out.length >= limit) return out;
  }
  // còn slot -> đắp màu fill (kem), không trùng
  for (const it of itemsByCode(cu)) {
    if (out.length >= limit) break;
    const c = colorFromName(it.name, it.code);
    if (!(c && (colorMatches(c, conf.fill) || colorMatches(conf.fill, c)))) continue;
    const url = it.downloadUrl || it.thumbnailUrl || null;
    const key = it.pancakeId || url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ contentId: it.pancakeId || null, url });
  }
  return out;
}

function imageItemsByColor(code, color, limit = 2, colorFallback = false) {
  const items = itemsByCode(code);
  const out = [], seen = new Set();
  // CHIẾN DỊCH: gửi mã KHÔNG nêu màu -> bộ mặc định (vd MGKVX6310: 2 hồng + 1 kem).
  if (!color) {
    const def = campaignDefaultItems(code, limit);
    if (def && def.length) return def.slice(0, limit);
  }
  // CHIẾN DỊCH: ghim ảnh ưu tiên (vd MGKVX6310 hồng) lên ĐẦU.
  for (const p of campaignPins(code, color, limit)) {
    const key = p.contentId || p.url;
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(p);
    if (out.length >= limit) return out;
  }
  let pool = items;
  if (color) {
    pool = items.filter(it => {
      const c = colorFromName(it.name, it.code);
      return c && (colorMatches(c, color) || colorMatches(color, c));
    });
    if (!pool.length && colorFallback) pool = items;
  }
  for (const it of pool) {
    const url = it.downloadUrl || it.thumbnailUrl || null;
    if (!it.pancakeId && !url) continue;
    const key = it.pancakeId || url;
    if (seen.has(key)) continue;   // KHÔNG trùng ảnh đã ghim
    seen.add(key);
    out.push({ contentId: it.pancakeId || null, url });
    if (out.length >= limit) break;
  }
  return out;
}

// 1 ảnh ĐẠI DIỆN cho mã (ưu tiên đúng màu; không có thì lấy ảnh đầu có content_id).
function representativeContentId(code, color) {
  if (color) {
    const byColor = contentIdsByColor(code, color, 1);
    if (byColor.length) return byColor[0];
  }
  const any = getContentIds(code, 1);
  return any[0] || null;
}

module.exports = {
  getImageUrls, getContentIds, getImageDownloadUrls, getColorByImageId, colorFromName,
  itemsByCode, getCodeColors, contentIdsByColor, imageItemsByColor, representativeContentId, representativeColor,
  contentIdByImageId, urlByImageId, isBackImage, imageItemsBySide, hasBackImage
};
