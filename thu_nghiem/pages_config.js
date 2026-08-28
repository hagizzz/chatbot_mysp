require("dotenv").config();

// ============================================================================
// DANH SÁCH PAGE BOT PHỤC VỤ — cùng shop, CHUNG sản phẩm (chung sheet/ảnh/kịch bản).
// Mỗi page Facebook có 1 page_access_token RIÊNG. Khai báo qua biến môi trường:
//   PANCAKE_PAGE_ID            / PANCAKE_PAGE_ACCESS_TOKEN            (page 1)
//   PANCAKE_PAGE_ID_2          / PANCAKE_PAGE_ACCESS_TOKEN_2          (page 2)
//   PANCAKE_PAGE_ID_3..._9     / PANCAKE_PAGE_ACCESS_TOKEN_3..._9     (nếu cần thêm)
// Bot tự suy PAGE từ conversationId (luôn dạng "{pageId}_{psid}") nên mọi thao tác
// gửi/tag/đọc tin dùng đúng token của page tương ứng.
// ============================================================================
function loadPages() {
  const out = [];
  const seen = new Set();
  const add = (id, tok) => {
    id = String(id || "").trim();
    tok = String(tok || "").trim();
    if (id && tok && !seen.has(id)) { seen.add(id); out.push({ pageId: id, token: tok }); }
  };
  add(process.env.PANCAKE_PAGE_ID, process.env.PANCAKE_PAGE_ACCESS_TOKEN);
  for (let i = 2; i <= 9; i++) {
    add(process.env["PANCAKE_PAGE_ID_" + i], process.env["PANCAKE_PAGE_ACCESS_TOKEN_" + i]);
  }
  return out;
}

const PAGES = loadPages();
const _tokenById = new Map(PAGES.map(p => [p.pageId, p.token]));

// convId -> pageId THẬT (page mà hội thoại được lấy về). CẦN cho COMMENT vì id comment = {post_id}_{user_id},
// phần đầu KHÔNG phải page_id -> không suy từ id được. INBOX thì id = {page_id}_{psid} (suy được, dùng làm fallback).
const _convPage = new Map();
function rememberConvPage(conversationId, pageId) {
  if (conversationId && pageId) _convPage.set(String(conversationId), String(pageId));
}

function pageIdOfConv(conversationId) {
  const mapped = _convPage.get(String(conversationId));
  if (mapped) return mapped;                                   // page thật (kể cả comment)
  return String(conversationId || "").split("_")[0];           // fallback INBOX: {page_id}_{psid}
}
function tokenForPage(pageId) {
  return _tokenById.get(String(pageId)) || (PAGES[0] && PAGES[0].token) || "";
}
function tokenForConv(conversationId) {
  return tokenForPage(pageIdOfConv(conversationId));
}

try {
  console.log(`[pages] Đang phục vụ ${PAGES.length} page: ${PAGES.map(p => p.pageId).join(", ") || "(CHƯA cấu hình PANCAKE_PAGE_ID!)"}`);
} catch (_) {}

module.exports = { PAGES, loadPages, pageIdOfConv, tokenForPage, tokenForConv, rememberConvPage };
