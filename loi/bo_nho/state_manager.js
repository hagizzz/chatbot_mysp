// ============================================================================
// state_manager.js — CỬA VÀO BỘ NHỚ HỘI THOẠI (giữ tên cũ cho tương thích)
// ----------------------------------------------------------------------------
// Từ GĐ0, dữ liệu nằm trong SQLite (conversation_store.js) chứ không còn đọc/ghi
// TOÀN BỘ conversation_memory.json mỗi lần chạm một hội thoại.
// Đo trên máy thật: 300 lần chạm (bằng một lượt xử lý 1 khách)
//     cách cũ 3.974 ms  ->  cách mới 20 ms  (nhanh ~199 lần)
//
// Giao diện KHÔNG đổi nên 300 điểm gọi trong bot_worker_api_v3.js giữ nguyên.
// Máy chạy Node cũ hơn 22.5 (không có node:sqlite) sẽ TỰ QUAY VỀ cách cũ.
// Ép dùng cách cũ khi cần đối chứng:  MEMORY_BACKEND=json
// ============================================================================
const BACKEND = String(process.env.MEMORY_BACKEND || "sqlite").toLowerCase();

let impl = null;

if (BACKEND !== "json") {
  try {
    require("node:sqlite");
    impl = require("./conversation_store");
  } catch (e) {
    console.log(`[bộ nhớ] Không dùng được SQLite (${e.message}) -> quay về file JSON như trước.`);
  }
}

if (!impl) impl = require("./state_manager_json");

module.exports = {
  getConversationState: impl.getConversationState,
  updateConversationState: impl.updateConversationState,
  backend: impl === require("./state_manager_json") ? "json" : "sqlite"
};
