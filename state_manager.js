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

module.exports = {
  getConversationState,
  updateConversationState
};
