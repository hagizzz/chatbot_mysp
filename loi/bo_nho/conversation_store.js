const __goc = require("path").join(__dirname, "..", "..");
// ============================================================================
// conversation_store.js — BỘ NHỚ HỘI THOẠI (SQLite)
// ----------------------------------------------------------------------------
// Thay cho cách cũ: state_manager.js đọc TOÀN BỘ conversation_memory.json (850 KB,
// 1.495 hội thoại) rồi ghi lại TOÀN BỘ — mỗi lần chạm vào MỘT hội thoại. Trong một
// lượt xử lý có ~300 lần chạm => ~250 MB đọc + 250 MB ghi cho một câu trả lời.
// Càng nhiều khách càng chậm, và hai tiến trình cùng ghi thì mất dữ liệu.
//
// Nay: mỗi hội thoại là MỘT dòng. Đọc/ghi một dòng, không đụng phần còn lại.
// Dùng node:sqlite có sẵn trong Node 22.5+ -> KHÔNG phải biên dịch gói native,
// máy shop chỉ cần cài Node là chạy.
//
// Bảng đã có sẵn cột shop_id để GĐ2 (nhiều shop) không phải chuyển dữ liệu lần nữa.
// Mọi truy vấn đều lọc theo shop_id — kể cả khi mới có một shop.
//
// GIỮ NGUYÊN giao diện cũ: getConversationState / updateConversationState.
// getConversationState trả về BẢN SAO (giống hệt hành vi cũ: mỗi lần đọc là một
// object mới) nên 300 điểm gọi trong bot_worker_api_v3.js không phải sửa dòng nào.
// ============================================================================
const fs = require("fs");
const path = require("path");

const SHOP_ID = process.env.SHOP_ID || "mysp";
const DB_FILE = process.env.MEMORY_DB || path.join(__goc, "conversation_memory.db");
const JSON_CU = path.join(__goc, "conversation_memory.json");

const MAC_DINH = {
  currentProduct: null,
  customerSize: null,
  phone: null,
  address: null,
  lastIntent: null,
  stage: "consulting",
  lastBotReply: ""
};

let db = null;
let _sql = {};
const _cache = new Map();          // conversationId -> object gốc (không phát ra ngoài)
const CACHE_TOI_DA = 3000;

function moDB() {
  if (db) return db;
  const { DatabaseSync } = require("node:sqlite");
  db = new DatabaseSync(DB_FILE);
  // WAL: đọc không chặn ghi -> bot tư vấn và order_worker chạy song song an toàn.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS hoi_thoai (
      shop_id         TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      page_id         TEXT,
      du_lieu         TEXT NOT NULL,
      tao_luc         TEXT NOT NULL,
      sua_luc         TEXT NOT NULL,
      PRIMARY KEY (shop_id, conversation_id)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_ht_sua_luc ON hoi_thoai (shop_id, sua_luc)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ht_page    ON hoi_thoai (shop_id, page_id)");
  _sql = {
    doc:   db.prepare("SELECT du_lieu FROM hoi_thoai WHERE shop_id = ? AND conversation_id = ?"),
    ghi:   db.prepare(`INSERT INTO hoi_thoai (shop_id, conversation_id, page_id, du_lieu, tao_luc, sua_luc)
                       VALUES (?, ?, ?, ?, ?, ?)
                       ON CONFLICT(shop_id, conversation_id) DO UPDATE SET
                         page_id = excluded.page_id,
                         du_lieu = excluded.du_lieu,
                         sua_luc = excluded.sua_luc`),
    dem:   db.prepare("SELECT COUNT(*) AS n FROM hoi_thoai WHERE shop_id = ?"),
    tatCa: db.prepare("SELECT conversation_id, du_lieu FROM hoi_thoai WHERE shop_id = ?"),
    xoaCu: db.prepare("DELETE FROM hoi_thoai WHERE shop_id = ? AND sua_luc < ?")
  };
  _tuDongChuyenLanDau();
  return db;
}

// Máy đang chạy thật quên chạy script chuyển -> tự chuyển ngay lần mở đầu tiên,
// để không bao giờ có cảnh bot khởi động với bộ nhớ RỖNG mà file JSON cũ vẫn nằm đó.
function _tuDongChuyenLanDau() {
  try {
    if (_sql.dem.get(SHOP_ID).n > 0) return;          // đã có dữ liệu -> thôi
    if (!fs.existsSync(JSON_CU)) return;              // máy mới -> không có gì để chuyển
    const cu = JSON.parse(fs.readFileSync(JSON_CU, "utf8"));
    const ids = Object.keys(cu);
    if (!ids.length) return;
    const now = new Date().toISOString();
    for (const id of ids) {
      const v = cu[id];
      if (!v || typeof v !== "object") continue;
      _sql.ghi.run(SHOP_ID, id, v._pageId || _pageIdTu(id), JSON.stringify(v), now, now);
    }
    console.log(`[bộ nhớ] Lần đầu dùng SQLite -> đã chuyển ${ids.length} hội thoại từ conversation_memory.json (file cũ giữ nguyên làm bản sao lưu).`);
  } catch (e) {
    console.log("[bộ nhớ] Không tự chuyển được từ JSON cũ:", e.message);
  }
}

function _pageIdTu(conversationId) {
  return String(conversationId || "").split("_")[0] || null;
}

function _docGoc(id) {
  if (_cache.has(id)) return _cache.get(id);
  moDB();
  const row = _sql.doc.get(SHOP_ID, id);
  let obj;
  if (row) {
    try { obj = JSON.parse(row.du_lieu); } catch { obj = { ...MAC_DINH }; }
  } else {
    obj = { ...MAC_DINH };
    _luu(id, obj);
  }
  if (_cache.size >= CACHE_TOI_DA) _cache.delete(_cache.keys().next().value);
  _cache.set(id, obj);
  return obj;
}

function _luu(id, obj) {
  moDB();
  const now = new Date().toISOString();
  _sql.ghi.run(SHOP_ID, id, obj._pageId || _pageIdTu(id), JSON.stringify(obj), now, now);
}

// ---- Giao diện cũ, giữ nguyên chữ ký ---------------------------------------
function getConversationState(conversationId) {
  const id = String(conversationId);
  const goc = _docGoc(id);
  // Bản sao: giống hệt hành vi cũ (mỗi lần đọc là object mới, sửa nó không ảnh
  // hưởng lần đọc khác cho tới khi gọi updateConversationState).
  return structuredClone(goc);
}

function updateConversationState(conversationId, patch) {
  const id = String(conversationId);
  const goc = _docGoc(id);
  Object.assign(goc, patch || {});
  _luu(id, goc);
  return structuredClone(goc);
}

// ---- Thêm cho các tiến trình khác (order_worker) ----------------------------
// Chỉ đọc, KHÔNG tạo dòng mới nếu chưa có — thay cho việc parse 850 KB JSON.
function docChiDoc(conversationId) {
  moDB();
  const row = _sql.doc.get(SHOP_ID, String(conversationId));
  if (!row) return null;
  try { return JSON.parse(row.du_lieu); } catch { return null; }
}

function demHoiThoai() {
  moDB();
  return _sql.dem.get(SHOP_ID).n;
}

// Xuất ra đúng hình dạng conversation_memory.json cũ (để đối chiếu / sao lưu).
function xuatJSON() {
  moDB();
  const out = {};
  for (const r of _sql.tatCa.all(SHOP_ID)) {
    try { out[r.conversation_id] = JSON.parse(r.du_lieu); } catch (_) {}
  }
  return out;
}

// Dọn hội thoại không đụng tới quá N ngày (giữ CSDL gọn khi nhiều shop).
function donCu(soNgay = 180) {
  moDB();
  const moc = new Date(Date.now() - soNgay * 86400000).toISOString();
  const r = _sql.xoaCu.run(SHOP_ID, moc);
  _cache.clear();
  return r.changes;
}

function dong() {
  if (db) { try { db.close(); } catch (_) {} db = null; _cache.clear(); }
}

module.exports = {
  getConversationState,
  updateConversationState,
  docChiDoc,
  demHoiThoai,
  xuatJSON,
  donCu,
  dong,
  DB_FILE,
  JSON_CU,
  SHOP_ID
};
