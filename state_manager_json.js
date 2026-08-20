// ============================================================================
// state_manager_json.js — CÁCH CŨ: bộ nhớ hội thoại trong MỘT file JSON
// ----------------------------------------------------------------------------
// GIỮ LẠI làm đường lui: máy Node < 22.5 (không có node:sqlite), hoặc khi cần
// đối chứng hành vi bằng MEMORY_BACKEND=json.
// Nhược điểm đã biết: đọc + ghi TOÀN BỘ file cho mỗi lần chạm một hội thoại,
// và không an toàn khi hai tiến trình cùng ghi.
// ============================================================================
const fs = require("fs");
const { MEMORY_FILE } = require("./config");

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(data) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2), "utf8");
}

function getConversationState(conversationId) {
  const all = loadState();
  const id = String(conversationId);

  if (!all[id]) {
    all[id] = {
      currentProduct: null,
      customerSize: null,
      phone: null,
      address: null,
      lastIntent: null,
      stage: "consulting",
      lastBotReply: ""
    };
    saveState(all);
  }

  return all[id];
}

function updateConversationState(conversationId, patch) {
  const all = loadState();
  const id = String(conversationId);
  all[id] = { ...(all[id] || {}), ...patch };
  saveState(all);
  return all[id];
}

module.exports = { getConversationState, updateConversationState };
