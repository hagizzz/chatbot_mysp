// ============================================================================
// conversation_tags.js — ĐỌC THẺ trên hội thoại + GẮN/GỠ THẺ (public_api pages.fm)
// ----------------------------------------------------------------------------
// Dùng để: (1) lọc hội thoại có thẻ "AI chốt"; (2) sau khi lên đơn xong,
// GỠ "AI chốt" và GẮN "AI- Đã xác nhận".
// (pancake_sender.js của bot tư vấn chỉ có addTag, KHÔNG có removeTag -> bổ sung ở đây.)
// ============================================================================
const { PAGE_ID, PAGE_TOKEN } = require("./order_config");
const pageReg = require("./page_registry");

function tagEndpoint(conversationId) {
  // ĐA PAGE: page + token LẤY THEO conversation_id ("{pageId}_{psid}"); fallback ENV (Mys.P).
  const pid = pageReg.pageIdFromConv(conversationId) || PAGE_ID;
  const tok = pageReg.tokenForConv(conversationId) || PAGE_TOKEN;
  return (
    `https://pages.fm/api/public_api/v1/pages/${pid}/conversations/${conversationId}/tags` +
    `?page_access_token=${tok}`
  );
}

// Trích danh sách ID THẺ từ 1 object hội thoại (Pancake trả nhiều kiểu khác nhau).
// Trả về mảng số id thẻ.
function extractTagIds(conv) {
  if (!conv) return [];
  const out = new Set();
  const pushId = v => {
    if (v == null) return;
    if (typeof v === "object") {
      if (v.id != null) out.add(Number(v.id));
      else if (v.tag_id != null) out.add(Number(v.tag_id));
    } else {
      const n = Number(v);
      if (!Number.isNaN(n)) out.add(n);
    }
  };
  // Các trường thường gặp: tags, tag_ids, conversation_tags, tag_histories
  for (const field of ["tags", "tag_ids", "conversation_tags"]) {
    const arr = conv[field];
    if (Array.isArray(arr)) arr.forEach(pushId);
  }
  // tag_histories: [{tag_id, ...}] — chỉ tính thẻ ĐANG gắn (không bị gỡ) nếu có cờ.
  if (Array.isArray(conv.tag_histories)) {
    for (const h of conv.tag_histories) {
      if (h && h.tag_id != null && h.removed !== true && h.is_removed !== true) out.add(Number(h.tag_id));
    }
  }
  return [...out];
}

function hasTag(conv, tagId) {
  if (tagId == null) return false;
  return extractTagIds(conv).includes(Number(tagId));
}

// Gọi endpoint thẻ với 1 body, có thử lại nhẹ.
async function _postTag(conversationId, body) {
  let last = null;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(tagEndpoint(conversationId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      last = data;
      if (res.ok && data && data.success !== false) return data;
    } catch (e) { last = { error: e.message }; }
    await new Promise(r => setTimeout(r, 1000));
  }
  return last || { success: false };
}

// GẮN thẻ (thử vài kiểu tham số cho chắc).
async function addTag(conversationId, tagId) {
  if (!conversationId || tagId == null) return { success: false, reason: "MISSING" };
  for (const body of [{ action: "add", tag_id: tagId }, { action: "add", tag_id: String(tagId) }, { tag_id: tagId }]) {
    const r = await _postTag(conversationId, body);
    if (r && r.success !== false) return r;
  }
  return { success: false };
}

// GỠ thẻ.
async function removeTag(conversationId, tagId) {
  if (!conversationId || tagId == null) return { success: false, reason: "MISSING" };
  for (const body of [{ action: "remove", tag_id: tagId }, { action: "remove", tag_id: String(tagId) }, { action: "delete", tag_id: tagId }]) {
    const r = await _postTag(conversationId, body);
    if (r && r.success !== false) return r;
  }
  return { success: false };
}

module.exports = { extractTagIds, hasTag, addTag, removeTag };
