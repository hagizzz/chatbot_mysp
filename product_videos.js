// Tra VIDEO sản phẩm theo MÃ từ video_index.json. Trả về content_id Pancake (đã up sẵn).
// Tách RIÊNG khỏi ảnh (product_images.js / hash_index.json) -> không ảnh hưởng nhận diện ảnh.
// File video_index.json do upload_videos.py tạo: { "MRVX559": [ {contentId, name, fileId}, ... ], ... }
const fs = require("fs");
const path = require("path");

const VIDEO_FILE = path.join(__dirname, "video_index.json");

let _idx = null;
let _mtime = 0;

// Đọc (hot-reload khi file đổi). Lỗi/không có file -> coi như rỗng, KHÔNG ném.
function _load() {
  try {
    const st = fs.statSync(VIDEO_FILE);
    if (_idx && st.mtimeMs === _mtime) return _idx;
    _idx = JSON.parse(fs.readFileSync(VIDEO_FILE, "utf8")) || {};
    _mtime = st.mtimeMs;
  } catch (_) {
    _idx = _idx || {};   // chưa có file -> rỗng
  }
  return _idx;
}

// Có video cho mã này không.
function hasVideo(code) {
  if (!code) return false;
  const idx = _load();
  const arr = idx[String(code).toUpperCase().trim()];
  return Array.isArray(arr) && arr.some(v => v && v.contentId);
}

// content_id 1 video của mã (mặc định lấy cái ĐẦU; có thể ngẫu nhiên nếu muốn đa dạng).
function videoContentIdByCode(code, random = false) {
  if (!code) return null;
  const idx = _load();
  const arr = (idx[String(code).toUpperCase().trim()] || []).filter(v => v && v.contentId);
  if (!arr.length) return null;
  const pick = random ? arr[Math.floor(Math.random() * arr.length)] : arr[0];
  return pick.contentId;
}

// Tất cả content_id video của mã (nếu muốn gửi nhiều).
function videoContentIdsByCode(code) {
  if (!code) return [];
  const idx = _load();
  return (idx[String(code).toUpperCase().trim()] || []).filter(v => v && v.contentId).map(v => v.contentId);
}

module.exports = { hasVideo, videoContentIdByCode, videoContentIdsByCode };
