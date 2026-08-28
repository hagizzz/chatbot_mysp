// ĐA-PAGE: 1 tiến trình lo nhiều page. Suy pageId từ convId ("pageId_userId") -> tra TOKEN của page đó.
// Nguồn token (ưu tiên trên xuống):
//   1) pages.json  (thủ công)   -> [{id, token, name}]  hoặc  { "<pageId>": {token, name} }
//   2) PANCAKE_USER_ACCESS_TOKEN (.env) -> tự GỌI /api/v1/pages liệt kê hết page + token của account
//   3) PANCAKE_PAGE_ID + PANCAKE_PAGE_ACCESS_TOKEN (.env) -> 1 page (tương thích bản cũ)
require("dotenv").config();
const fs = require("fs");

const ENV_PAGE_ID = process.env.PANCAKE_PAGE_ID ? String(process.env.PANCAKE_PAGE_ID) : "";
const ENV_PAGE_TOKEN = process.env.PANCAKE_PAGE_ACCESS_TOKEN || "";
const USER_TOKEN = process.env.PANCAKE_USER_ACCESS_TOKEN || "";

const _tokens = new Map();   // pageId -> page_access_token
const _names = new Map();    // pageId -> tên page

function pageIdFromConv(convId) {
  const s = String(convId || "");
  const i = s.indexOf("_");
  return i > 0 ? s.slice(0, i) : "";
}
function getToken(pageId) {
  pageId = String(pageId || "");
  if (_tokens.has(pageId)) return _tokens.get(pageId);
  if (ENV_PAGE_ID && pageId === ENV_PAGE_ID && ENV_PAGE_TOKEN) return ENV_PAGE_TOKEN;
  return ENV_PAGE_TOKEN || "";   // cùng lắm: token env (bản 1-page)
}
function tokenForConv(convId) { return getToken(pageIdFromConv(convId)); }
// CÓ THẬT là 1 page đã biết không? (KHÁC getToken: getToken luôn fallback ENV_PAGE_TOKEN nên không dùng để
// kiểm tra "pid có phải page thật". Comment conv id = "POSTID_xxx" -> pid suy ra là POST id, KHÔNG known.)
function isKnownPage(pageId) {
  pageId = String(pageId || "");
  if (!pageId) return false;
  return _tokens.has(pageId) || (ENV_PAGE_ID && pageId === ENV_PAGE_ID);
}
function listPages() { return [..._tokens.entries()].map(([id, token]) => ({ id, token, name: _names.get(id) || "" })); }
function pageName(pageId) { return _names.get(String(pageId || "")) || ""; }

async function _json(url, opt) {
  try { const r = await fetch(url, opt); return await r.json().catch(() => null); }
  catch (_) { return null; }
}
function _extractPages(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.pages)) return data.pages;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.categorized)) {   // Pancake hay bọc trong "categorized"
    const out = [];
    for (const c of data.categorized) if (Array.isArray(c.pages)) out.push(...c.pages);
    return out;
  }
  return [];
}

async function init() {
  // 1) pages.json (thủ công) — ưu tiên cao nhất
  try {
    if (fs.existsSync("./pages.json")) {
      const raw = JSON.parse(fs.readFileSync("./pages.json", "utf8"));
      const entries = Array.isArray(raw)
        ? raw.map(x => [String(x.id || x.pageId || ""), x])
        : Object.entries(raw).map(([id, v]) => [String(id), v]);
      for (const [id, v] of entries) {
        const tok = v && (v.token || v.page_access_token);
        if (id && tok) { _tokens.set(id, tok); if (v.name) _names.set(id, v.name); }
      }
    }
  } catch (e) { console.log("[pages] đọc pages.json lỗi:", e.message); }

  // 2) Account token -> liệt kê hết page + token
  if (USER_TOKEN) {
    const data = await _json(`https://pages.fm/api/v1/pages?access_token=${encodeURIComponent(USER_TOKEN)}`);
    const pages = _extractPages(data);
    if (!pages.length) {
      console.log("[pages] account token KHÔNG ra page nào. Keys phản hồi:", data ? Object.keys(data).join(",") : "(null)", "-> gửi log này để chỉnh cách đọc.");
    }
    for (const p of pages) {
      const id = String(p.id || p.page_id || "");
      if (!id) continue;
      if (p.name && !_names.has(id)) _names.set(id, p.name);
      if (_tokens.has(id)) continue;   // pages.json đã có -> không ghi đè
      let tok = p.page_access_token || (p.settings && p.settings.page_access_token) || "";
      if (!tok) {   // chưa có token sẵn -> sinh (LƯU Ý: làm mới token cũ của page đó)
        const g = await _json(`https://pages.fm/api/v1/pages/${id}/generate_page_access_token?access_token=${encodeURIComponent(USER_TOKEN)}`, { method: "POST" });
        tok = (g && (g.page_access_token || (g.data && g.data.page_access_token))) || "";
      }
      if (tok) _tokens.set(id, tok);
    }
  }

  // 3) Fallback 1-page từ .env (tương thích bản cũ)
  if (ENV_PAGE_ID && ENV_PAGE_TOKEN && !_tokens.has(ENV_PAGE_ID)) _tokens.set(ENV_PAGE_ID, ENV_PAGE_TOKEN);

  const ids = [..._tokens.keys()];
  console.log(`[pages] Đa-page sẵn sàng: ${ids.length} page${ids.length ? " -> " + ids.map(i => `${i}${_names.get(i) ? "(" + _names.get(i) + ")" : ""}`).join(", ") : ""}`);
  if (!ids.length) console.log("[pages] CẢNH BÁO: chưa có page nào! Kiểm tra PANCAKE_USER_ACCESS_TOKEN / pages.json / PANCAKE_PAGE_ID.");
  return listPages();
}

module.exports = { init, getToken, tokenForConv, pageIdFromConv, listPages, pageName, isKnownPage };
