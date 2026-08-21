// ============================================================================
// hang_doi_don.js — HÀNG ĐỢI LÊN ĐƠN GIỮA HAI TIẾN TRÌNH
// ----------------------------------------------------------------------------
// Vì sao có file này: trước đây bot_worker báo "hội thoại này chốt rồi" cho
// order_worker BẰNG CÁCH GẮN THẺ 182 LÊN PANCAKE. Thẻ Pancake khi đó không chỉ
// là nhãn cho nhân viên xem — nó là DÂY ĐIỆN giữa hai tiến trình. Hậu quả:
//
//   • Pancake trục trặc đúng lúc gắn thẻ  -> đơn im lặng biến mất.
//   • Nhân viên gỡ nhầm thẻ 182            -> mất đơn.
//   • Nhân viên gắn tay thẻ 182            -> bot lên đơn thật.
//   • Phải chờ tới 15 giây cho vòng quét sau.
//
// Giờ tín hiệu đi qua một bảng SQLite (chung file với bộ nhớ hội thoại, đã bật
// WAL nên hai tiến trình đọc/ghi song song an toàn). Thẻ 182 VẪN ĐƯỢC GẮN —
// nhưng chỉ để nhân viên nhìn, không còn là dây điện.
//
// Bảng có sẵn shop_id để GĐ2 (nhiều shop) không phải sửa lại.
// ============================================================================
const path = require("path");

const SHOP_ID = process.env.SHOP_ID || "mysp";
const DB_FILE = process.env.MEMORY_DB || path.join(__dirname, "conversation_memory.db");

let db = null;
let _sql = {};

function moDB() {
  if (db) return db;
  const { DatabaseSync } = require("node:sqlite");
  db = new DatabaseSync(DB_FILE);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS hang_doi_don (
      shop_id         TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      page_id         TEXT,
      trang_thai      TEXT NOT NULL DEFAULT 'cho',   -- cho | xong
      ly_do           TEXT,                          -- vì sao chuyển sang xong
      so_lan_thu      INTEGER NOT NULL DEFAULT 0,
      tao_luc         TEXT NOT NULL,
      sua_luc         TEXT NOT NULL,
      PRIMARY KEY (shop_id, conversation_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_hang_doi_cho ON hang_doi_don (shop_id, trang_thai, tao_luc)`);

  _sql = {
    them: db.prepare(`
      INSERT INTO hang_doi_don (shop_id, conversation_id, page_id, trang_thai, ly_do, so_lan_thu, tao_luc, sua_luc)
      VALUES (?, ?, ?, 'cho', NULL, 0, ?, ?)
      ON CONFLICT (shop_id, conversation_id) DO UPDATE SET
        trang_thai = 'cho',
        ly_do      = NULL,
        page_id    = COALESCE(excluded.page_id, hang_doi_don.page_id),
        sua_luc    = excluded.sua_luc
    `),
    layCho: db.prepare(`
      SELECT conversation_id, page_id, so_lan_thu, tao_luc
      FROM hang_doi_don WHERE shop_id = ? AND trang_thai = 'cho'
      ORDER BY tao_luc ASC LIMIT ?
    `),
    xong: db.prepare(`
      UPDATE hang_doi_don SET trang_thai = 'xong', ly_do = ?, sua_luc = ?
      WHERE shop_id = ? AND conversation_id = ?
    `),
    demThu: db.prepare(`
      UPDATE hang_doi_don SET so_lan_thu = so_lan_thu + 1, sua_luc = ?
      WHERE shop_id = ? AND conversation_id = ? AND trang_thai = 'cho'
    `),
    demCho: db.prepare(`SELECT COUNT(*) AS n FROM hang_doi_don WHERE shop_id = ? AND trang_thai = 'cho'`),
    xem: db.prepare(`SELECT * FROM hang_doi_don WHERE shop_id = ? AND conversation_id = ?`),
    // <= chứ không phải <: donCu(0) nghĩa là "dọn mọi dòng đã xong", kể cả dòng
    // vừa xong trong cùng một mili-giây. Dùng < thì kết quả phụ thuộc đồng hồ.
    donCu: db.prepare(`DELETE FROM hang_doi_don WHERE shop_id = ? AND trang_thai = 'xong' AND sua_luc <= ?`),
  };
  return db;
}

const _bayGio = () => new Date().toISOString();

/**
 * Bot chốt xong một hội thoại -> xếp vào hàng đợi cho order_worker.
 * Gọi lại nhiều lần là an toàn: hội thoại đã 'xong' mà khách chốt tiếp thì
 * quay lại 'cho' (khách mua lần hai vẫn phải lên đơn).
 */
function them(conversationId, opts = {}) {
  if (!conversationId) return false;
  moDB();
  const t = _bayGio();
  _sql.them.run(SHOP_ID, String(conversationId), opts.pageId ? String(opts.pageId) : null, t, t);
  return true;
}

/** Danh sách hội thoại đang chờ lên đơn, cũ trước (không bỏ đói ai). */
function layCho(gioiHan = 200) {
  moDB();
  return _sql.layCho.all(SHOP_ID, Number(gioiHan) || 200);
}

/** Xử lý xong (đã lên đơn / bị chặn vì thiếu thông tin) -> rút khỏi hàng đợi. */
function xong(conversationId, lyDo = "") {
  if (!conversationId) return false;
  moDB();
  _sql.xong.run(String(lyDo).slice(0, 200), _bayGio(), SHOP_ID, String(conversationId));
  return true;
}

/** Đếm thêm một lần thử. Trả về số lần đã thử để bên gọi biết khi nào nên kêu. */
function danhDauDaThu(conversationId) {
  if (!conversationId) return 0;
  moDB();
  _sql.demThu.run(_bayGio(), SHOP_ID, String(conversationId));
  const r = _sql.xem.get(SHOP_ID, String(conversationId));
  return (r && r.so_lan_thu) || 0;
}

function demCho() {
  moDB();
  const r = _sql.demCho.get(SHOP_ID);
  return (r && r.n) || 0;
}

function xem(conversationId) {
  moDB();
  return _sql.xem.get(SHOP_ID, String(conversationId)) || null;
}

/** Dọn các dòng đã 'xong' quá cũ để bảng không phình mãi. */
function donCu(soNgay = 30) {
  moDB();
  const moc = new Date(Date.now() - soNgay * 86400000).toISOString();
  _sql.donCu.run(SHOP_ID, moc);
}

function dong() {
  if (db) { try { db.close(); } catch (_) {} }
  db = null; _sql = {};
}

module.exports = { them, layCho, xong, danhDauDaThu, demCho, xem, donCu, dong, SHOP_ID, DB_FILE };
