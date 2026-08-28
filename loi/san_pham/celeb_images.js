const __goc = require("path").join(__dirname, "..", "..");
// Ảnh NGHỆ SĨ diện mẫu — tách RIÊNG khỏi ảnh sản phẩm (KHÔNG trộn vào hash_index.json / vision)
// để ảnh nghệ sĩ không lọt vào gallery thường hay làm nhiễu nhận diện ảnh khách.
//
// Nguồn: celeb_index.json — mảng item giống hash_index.json:
//   { id, name, code, pancakeId, downloadUrl, thumbnailUrl }
// Tạo/cập nhật bằng script build_celeb_index.py (quét thư mục Drive "Nghệ sĩ" + up Pancake).
const fs = require("fs");
const path = require("path");

const CELEB_FILE = path.join(__goc, "celeb_index.json");
let _byCode = null;
let _mtime = 0;

function load() {
  try {
    const st = fs.statSync(CELEB_FILE);
    if (_byCode && st.mtimeMs === _mtime) return _byCode;   // cache, nạp lại khi file đổi
    const arr = JSON.parse(fs.readFileSync(CELEB_FILE, "utf8"));
    const m = new Map();
    for (const it of (Array.isArray(arr) ? arr : [])) {
      if (!it || !it.code) continue;
      const c = String(it.code).toUpperCase().trim();
      if (!m.has(c)) m.set(c, []);
      m.get(c).push(it);
    }
    _byCode = m; _mtime = st.mtimeMs;
    return _byCode;
  } catch (e) {
    if (!_byCode) { try { console.log("[celeb] chưa có celeb_index.json (chạy build_celeb_index.py):", e.message); } catch (_) {} }
    return _byCode || new Map();
  }
}

function itemsByCode(code) {
  return load().get(String(code || "").toUpperCase().trim()) || [];
}

// Có ảnh nghệ sĩ (đã up Pancake HOẶC còn link Drive) cho mã này không?
function hasCeleb(code) {
  return itemsByCode(code).some(it => it && (it.pancakeId || it.downloadUrl || it.thumbnailUrl));
}

// content_id Pancake của ảnh nghệ sĩ (gửi chắc chắn hiển thị). Tối đa max ảnh.
function celebContentIds(code, max = 8) {
  return itemsByCode(code).map(it => it.pancakeId).filter(Boolean).slice(0, max);
}

// URL ảnh thật (fallback khi chưa up Pancake / content_id bị từ chối).
function celebUrls(code, max = 8) {
  return itemsByCode(code).map(it => it.downloadUrl || it.thumbnailUrl).filter(Boolean).slice(0, max);
}

module.exports = { hasCeleb, celebContentIds, celebUrls, itemsByCode };
