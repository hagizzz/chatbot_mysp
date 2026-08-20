// ============================================================================
// order_store.js — DỮ LIỆU LÊN ĐƠN TÁCH BIỆT (orders_state.json)
// ----------------------------------------------------------------------------
// Đây là "nguồn sự thật" RIÊNG cho phần lên đơn, KHÔNG dùng chung
// conversation_memory.json của bot tư vấn -> không chồng chéo.
//
// Mục tiêu: biết DÒNG HÀNG nào (mã + màu + size) trong 1 hội thoại ĐÃ lên đơn,
// dòng nào CHƯA -> chống lên đơn TRÙNG khi quét lại nhiều lần.
//
// Cấu trúc orders_state.json:
// {
//   "<conversationId>": {
//     "lines": {
//        "MRKSQ6301|DEN|S": {                       // khóa dòng = MÃ|MÀU|SIZE (đã chuẩn hóa)
//            "status": "created" | "failed" | "skipped_incomplete",
//            "posOrderId": 12345,                     // id đơn POS (khi created)
//            "posDisplayId": 636,                     // số đơn hiển thị
//            "code": "MRKSQ6301", "color": "DEN", "size": "S",
//            "createdAt": 1718000000000,
//            "lastError": null
//        }
//     },
//     "lastSeenAt": 1718000000000,
//     "confirmedTagSwapped": true                    // đã đổi thẻ AI chốt -> Đã xác nhận chưa
//   }
// }
// ============================================================================
const fs = require("fs");
const { ORDERS_STATE_FILE } = require("./order_config");

function _load() {
  try { return JSON.parse(fs.readFileSync(ORDERS_STATE_FILE, "utf8")); }
  catch { return {}; }
}
function _save(data) {
  // Ghi an toàn: ghi file tạm rồi rename (tránh hỏng file nếu tắt giữa chừng).
  const tmp = ORDERS_STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, ORDERS_STATE_FILE);
}

// Chuẩn hóa khóa dòng: MÃ|MÀU|SIZE, viết HOA, bỏ dấu cách thừa.
function lineKey(code, color, size) {
  const c = String(code || "").trim().toUpperCase();
  const m = String(color || "").trim().toUpperCase();
  const s = String(size || "").trim().toUpperCase();
  return `${c}|${m}|${s}`;
}

function getConv(conversationId) {
  const all = _load();
  return all[String(conversationId)] || { lines: {}, lastSeenAt: 0, confirmedTagSwapped: false };
}

// Đã lên đơn THÀNH CÔNG dòng này chưa? (chỉ "created" mới tính là đã lên).
function isLineCreated(conversationId, code, color, size) {
  const conv = getConv(conversationId);
  const l = conv.lines[lineKey(code, color, size)];
  return !!(l && l.status === "created");
}

// Ghi nhận 1 dòng (created/failed/skipped_incomplete...).
function recordLine(conversationId, line) {
  const all = _load();
  const id = String(conversationId);
  if (!all[id]) all[id] = { lines: {}, lastSeenAt: 0, confirmedTagSwapped: false };
  const key = lineKey(line.code, line.color, line.size);
  all[id].lines[key] = {
    ...(all[id].lines[key] || {}),
    ...line,
    updatedAt: Date.now()
  };
  all[id].lastSeenAt = Date.now();
  _save(all);
  return all[id].lines[key];
}

function markTagSwapped(conversationId, value = true) {
  const all = _load();
  const id = String(conversationId);
  if (!all[id]) all[id] = { lines: {}, lastSeenAt: 0, confirmedTagSwapped: false };
  all[id].confirmedTagSwapped = value;
  _save(all);
}

function isTagSwapped(conversationId) {
  return !!getConv(conversationId).confirmedTagSwapped;
}

// ===== CHỐNG TRÙNG THEO ĐƠN (mỗi tin chốt = 1 đơn, khóa = chữ ký sig) =====
function isOrderCreated(conversationId, sig) {
  const conv = getConv(conversationId);
  return !!(conv.orders && conv.orders[sig] && conv.orders[sig].status === "created");
}
function recordOrder(conversationId, sig, info) {
  const all = _load();
  const id = String(conversationId);
  if (!all[id]) all[id] = { lines: {}, orders: {}, lastSeenAt: 0, confirmedTagSwapped: false };
  if (!all[id].orders) all[id].orders = {};
  all[id].orders[sig] = { ...(all[id].orders[sig] || {}), ...info, sig, updatedAt: Date.now() };
  all[id].lastSeenAt = Date.now();
  _save(all);
  return all[id].orders[sig];
}
// Các sig ĐÃ tạo đơn THÀNH CÔNG cho hội thoại (để phát hiện đơn "lớn lên" sau khi đã lên).
function createdSigs(conversationId) {
  const conv = getConv(conversationId);
  if (!conv.orders) return [];
  return Object.keys(conv.orders).filter(s => conv.orders[s] && conv.orders[s].status === "created");
}

// ===== ĐƠN GẤP (thẻ 206) ===== lưu trạng thái đã báo / đã ghi thời gian xử lý
function getUrgent(conversationId, orderId) {
  const conv = getConv(conversationId);
  return (conv.urgent && conv.urgent[String(orderId)]) || null;
}
function setUrgent(conversationId, orderId, info) {
  const all = _load();
  const id = String(conversationId);
  if (!all[id]) all[id] = { lines: {}, orders: {}, urgent: {}, lastSeenAt: 0, confirmedTagSwapped: false };
  if (!all[id].urgent) all[id].urgent = {};
  const k = String(orderId);
  all[id].urgent[k] = { ...(all[id].urgent[k] || {}), ...info, updatedAt: Date.now() };
  all[id].lastSeenAt = Date.now();
  _save(all);
  return all[id].urgent[k];
}
// Tất cả đơn gấp ĐÃ BÁO nhưng CHƯA có Kết quả -> theo dõi tiếp dù thẻ 206 đã gỡ.
function listUrgentWatch() {
  const all = _load();
  const out = [];
  for (const convId of Object.keys(all)) {
    const u = all[convId] && all[convId].urgent;
    if (!u) continue;
    for (const orderId of Object.keys(u)) {
      const st = u[orderId] || {};
      if (st.reported && !st.done) out.push({ convId, orderId, urgent: st });
    }
  }
  return out;
}

module.exports = {
  lineKey,
  getConv,
  isLineCreated,
  recordLine,
  markTagSwapped,
  isTagSwapped,
  isOrderCreated,
  recordOrder,
  createdSigs,
  getUrgent,
  setUrgent,
  listUrgentWatch
};
