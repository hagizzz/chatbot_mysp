require("dotenv").config();

// ===== DẤU HIỆU NẠP READER (để biết CHẮC file mới đã được chép đè) =====
console.log("[reader BUILD] v17 | ad: LUÔN đọc bài THẬT qua Pancake khi có post_id (fix OCELIA/Genielle->mẫu sai) | 2026-06-25");

const PAGE_ID = process.env.PANCAKE_PAGE_ID;
const PAGE_TOKEN = process.env.PANCAKE_PAGE_ACCESS_TOKEN;
const reg = require("./page_registry");

// ===== CÔNG TẮC LOG CHẨN ĐOÁN =====
// Mặc định TẮT toàn bộ log "[reader] ..." (FULLMSG / ACT / v2-adscan / AD detect / no-ad ...)
// cho cmd sạch, khỏi trôi mất dòng quan trọng.
// Cần soi lại thì chạy:  set READER_DEBUG=1   (Windows cmd)  rồi mới  node bot_worker_api_v3.js
const RDBG = process.env.READER_DEBUG === "1";

// Marker "khách trả lời 1 bài viết/quảng cáo". FB hiện theo NGÔN NGỮ trang:
// page tiếng Việt -> "đã trả lời ... bài viết/quảng cáo"; page tiếng Anh -> "replied to a post/ad".
// PHẢI bắt CẢ HAI, nếu không sẽ bỏ sót tin đến từ ad (gốc lỗi báo nhầm mẫu).
const _RE_ADREPLY = /trả lời\s*(về\s*)?(một\s*)?(bài viết|quảng cáo)|replied to (a |an |your |the )?(post|ad\b|advert|story)/i;

// LƯU Ý (đã kiểm chứng bằng log thực tế):
//  - Tham số &seen=false bị Pancake PHỚT LỜ: API vẫn trả về cả hội thoại đã đọc.
//    -> Việc lọc CHƯA ĐỌC làm ở phía bot (filter c.seen === false), KHÔNG dựa vào URL.
//  - Pancake BẮT BUỘC mỗi lần gọi: khoảng since->until phải < 1 THÁNG
//    (nếu rộng hơn -> {"message":"date range must be less than 1 month!","success":false}).
//  - Để vẫn bắt được khách CŨ (hội thoại tạo lâu, vừa nhắn lại) mà không phạm luật:
//    QUÉT NHIỀU CỬA SỔ NGẮN (mỗi cửa CONV_CHUNK_DAYS ngày < 1 tháng) lùi dần CONV_LOOKBACK_DAYS,
//    rồi GỘP + KHỬ TRÙNG theo id.
const CONV_CHUNK_DAYS = 25;      // mỗi cửa sổ < 1 tháng (an toàn dưới 30 ngày)
const CONV_LOOKBACK_DAYS = 45;   // tổng quét lùi 45 ngày (giảm từ 90 cho nhẹ tải, đỡ 429)
const CONV_PAGE_SIZE = 200;      // API thực tế trả ~200/trang (bỏ qua page_size nhỏ); để 200 cho việc nhận biết "trang cuối"
const CONV_MAX_PAGES = 8;        // trần an toàn mỗi cửa sổ (giảm 20->8 cho nhẹ tải)
const DAY = 24 * 60 * 60;

// ===== BỘ ĐẾM REQUEST PANCAKE (chẩn đoán 429): in mỗi 10s tổng số request + nguồn =====
let _reqN = 0, _reqBy = {};
function _req(tag) { _reqN++; _reqBy[tag] = (_reqBy[tag] || 0) + 1; }
try {
  const _t = setInterval(() => {
    if (_reqN > 0) { try { console.log(`[REQ] ${_reqN} request Pancake / 10s | nguồn: ${JSON.stringify(_reqBy)}`); } catch (_) {} _reqN = 0; _reqBy = {}; }
  }, 10000);
  if (_t && _t.unref) _t.unref();
} catch (_) {}

function _updSec(s) {
  if (!s) return 0;
  let x = String(s).trim();
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(x) && /^\d{4}-\d\d-\d\d[ T]/.test(x)) x = x.replace(" ", "T") + "Z";
  const t = Date.parse(x);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

const V2_PAGE_SIZE = 60;   // v2 trả tối đa 60/trang
let _v2KeysLogged = false;

// v2: sắp theo GIỜ TIN NHẮN THẬT (không bị đông cứng updated_at như v1), lật trang bằng last_conversation_id.
async function fetchConversationsPage(pageId, token, lastConvId) {
  let url =
    `https://pages.fm/api/public_api/v2/pages/${pageId}/conversations` +
    `?page_access_token=${token}` +
    `&page_size=${V2_PAGE_SIZE}`;
  if (lastConvId) url += `&last_conversation_id=${encodeURIComponent(lastConvId)}`;
  _req("list-hoithoai");
  const res = await fetch(url);
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { success: false, _parseError: true }; }
  if (!res.ok || data.success !== true) {
    console.log(
      `getConversations: API từ chối | HTTP ${res.status} ${res.statusText} | body:`,
      raw.slice(0, 300)
    );
  }
  if (res.status === 429) data._rl = true;
  // In CẤU TRÚC 1 hội thoại v2 ĐÚNG 1 LẦN -> xác nhận field khớp với bộ lọc của bot.
  if (!_v2KeysLogged && data && data.success === true && (data.conversations || []).length) {
    _v2KeysLogged = true;
    const c0 = data.conversations[0];
    try {
      console.log("[V2 KEYS] field 1 hội thoại:", Object.keys(c0).join(", "));
      console.log("[V2 KEYS] mẫu -> id=" + c0.id + " | seen=" + c0.seen + " | type=" + c0.type +
        " | last_sent_by=" + JSON.stringify(c0.last_sent_by) + " | updated_at=" + c0.updated_at +
        " | from=" + JSON.stringify(c0.from && c0.from.name));
    } catch (_) {}
  }
  return data;
}

const _sleep = ms => new Promise(r => setTimeout(r, ms));

// Lật trang v2 bằng con trỏ last_conversation_id (id hội thoại cuối trang trước) cho tới khi:
// hết dữ liệu, chạm trần trang, hoặc đã phủ đủ mốc thời gian stopBeforeSec.
async function fetchWindow(pageId, token, maxPages, stopBeforeSec) {
  const _cap = Math.max(1, maxPages || 1);
  let out = [];
  let total = 0;
  let lastId = null;
  const ids = new Set();
  for (let page = 1; page <= _cap; page++) {
    let data = null;
    const tries = page === 1 ? 2 : 1;
    for (let attempt = 1; attempt <= tries; attempt++) {
      try {
        data = await fetchConversationsPage(pageId, token, lastId);
      } catch (e) {
        console.log(`getConversations: lỗi mạng (lần ${attempt}):`, e.message);
        data = { success: false };
      }
      if (data && data.success === true) break;
      if (attempt < tries) await _sleep(1500);
    }
    if (!data || data.success !== true) {
      if (page === 1) return { ok: false, conversations: out, total };
      break;
    }
    if (page === 1) total = data.total;
    const convs = data.conversations || [];
    if (!convs.length) break;
    let added = 0, oldestSec = 0, hasUnread = false;
    for (const c of convs) {
      if (c && c.id && !ids.has(c.id)) { ids.add(c.id); out.push(c); added++; }
      const t = _updSec(c && c.updated_at);
      if (t && (!oldestSec || t < oldestSec)) oldestSec = t;
      // CÒN conv CHƯA ĐỌC (khách đang chờ) trong trang -> phải đi tiếp, đừng cắt theo thời gian.
      // (Tin chưa đọc nhắn TRƯỚC khi bot bật có thể cũ hơn cửa sổ -> không được bỏ sót.)
      if (c && c.seen === false) hasUnread = true;
    }
    if (added === 0) break;                                 // không thêm mới -> dừng
    lastId = convs[convs.length - 1].id;                    // con trỏ trang kế
    if (convs.length < V2_PAGE_SIZE) break;                 // trang cuối
    // CHỈ dừng theo thời gian khi trang này KHÔNG còn tin chưa đọc nào (đã phủ hết khách đang chờ gần đây).
    // Còn tin chưa đọc -> tiếp tục lật để vớt tin chưa đọc cũ hơn (chặn trần trang _cap vẫn bảo vệ khỏi lật vô hạn).
    if (!hasUnread && stopBeforeSec && oldestSec && oldestSec < stopBeforeSec) break;  // phủ đủ thời gian
    if (page < _cap) await _sleep(300);
  }
  return { ok: true, conversations: out, total };
}

// v2 sắp theo giờ tin nhắn THẬT -> khách mới (kể cả nick "đông cứng updated_at") luôn nổi lên đầu.
//  - Vòng THƯỜNG: 3 trang (≈180 mới nhất) -> bắt mọi khách vừa nhắn.
//  - Vòng SÂU (mỗi DEEP_EVERY vòng): lật phủ DEEP_HOURS giờ để vớt khách chờ lâu.
const DEEP_EVERY = 15;           // quét sâu THƯA hơn (mỗi ~60s) -> đỡ bắn 25 request/12s làm Pancake bóp
const DEEP_HOURS = 24;
const DEEP_MAX_PAGES = 15;       // trần khi quét sâu (lật tiếp tới khi HẾT tin chưa đọc; dừng sớm nếu không còn unread)
const NORMAL_PAGES = 3;
let _convCycle = 0;

async function getConversations(_ignored = 1) {
  const now = Math.floor(Date.now() / 1000);
  const seen = new Set();
  const all = [];

  _convCycle++;
  // Quét SÂU NGAY vòng ĐẦU (bot vừa bật -> vớt hết tin chưa đọc tồn đọng nhắn TRƯỚC khi bot chạy),
  // sau đó quét sâu định kỳ mỗi DEEP_EVERY vòng.
  const doDeep = (_convCycle === 1) || (_convCycle % DEEP_EVERY === 0);
  const maxPages = doDeep ? DEEP_MAX_PAGES : NORMAL_PAGES;
  const stopBefore = doDeep ? (now - DEEP_HOURS * 3600) : (now - 6 * 3600);

  // ĐA-PAGE: quét LẦN LƯỢT từng page (rate limit 5 req/giây TÍNH RIÊNG mỗi page).
  let pages = reg.listPages();
  if (!pages.length && PAGE_ID && PAGE_TOKEN) pages = [{ id: PAGE_ID, token: PAGE_TOKEN, name: "" }];
  let anyOk = false;
  let _apiTotal = 0;
  for (const pg of pages) {
    const r = await fetchWindow(pg.id, pg.token, maxPages, stopBefore);
    if (r.ok) {
      anyOk = true;
      _apiTotal += (r.total || 0);
      for (const c of (r.conversations || [])) {
        if (c && c.id && !seen.has(c.id)) { seen.add(c.id); all.push(c); }
      }
    } else {
      console.log(`[FETCH] page ${pg.id}${pg.name ? "(" + pg.name + ")" : ""}: API từ chối / lỗi.`);
    }
  }
  if (!anyOk) return { success: false, total: undefined, conversations: [] };

  // Trộn theo GIỜ TIN MỚI NHẤT để khách mới của MỌI page đều nổi lên đầu.
  all.sort((a, b) => (_updSec(b && b.updated_at) || 0) - (_updSec(a && a.updated_at) || 0));

  console.log(`API success: ${anyOk} | ${pages.length} page | đã gộp: ${all.length} hội thoại${doDeep ? " (quét sâu)" : ""}`);
  return { success: anyOk, total: all.length, conversations: all };
}

async function getMessages(conversationId, pageIdHint) {
  // Comment conv có id "POSTID_xxx" -> pageIdFromConv ra POST id (KHÔNG phải page) -> gọi sai page -> rỗng.
  // Ưu tiên page_id THẬT (từ list/convMeta). Nếu pid suy ra KHÔNG phải page đã đăng ký -> dùng page đã biết.
  let pid = String(pageIdHint || "").trim() || reg.pageIdFromConv(conversationId) || PAGE_ID;
  if (!reg.isKnownPage(pid) && !(PAGE_ID && pid === PAGE_ID)) {
    const pages = reg.listPages();
    if (pages.length === 1) pid = pages[0].id;        // 1 page -> chắc chắn là nó (sửa đọc comment)
    else if (PAGE_ID) pid = PAGE_ID;
  }
  const tok = reg.getToken(pid) || PAGE_TOKEN;
  const url =
    `https://pages.fm/api/public_api/v1/pages/${pid}/conversations/${conversationId}/messages` +
    `?page_access_token=${tok}`;

  _req("doc-tin-nhan");
  const res = await fetch(url);
  return await res.json();
}

// Lấy ảnh từ object post (nhiều dạng cấu trúc Pancake/FB).
// VỚT SÂU ảnh + chữ từ 1 attachment thẻ ad (ad_click/template/fallback...) bất kể cấu trúc:
// ảnh nằm ở media.image.src / image_data.url / payload.url / subattachments...; chữ ở title/subtitle/name/caption.
function _deepAdCreative(att, depth = 0) {
  const images = [], texts = [];
  if (!att || typeof att !== "object" || depth > 4) return { images, texts };
  const isImg = u => /^https?:\/\//i.test(String(u || "")) && /scontent|fbcdn|cdninstagram|\.(jpe?g|png|webp|gif)(\?|$)/i.test(String(u));
  const pushImg = u => { u = String(u || ""); if (u && /^https?:\/\//i.test(u) && !images.includes(u)) images.push(u); };
  const maybeImg = u => { if (isImg(u)) pushImg(u); };
  const pushTxt = t => { t = String(t || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); if (t.length >= 4 && !texts.includes(t)) texts.push(t); };
  if (att.media && att.media.image) pushImg(att.media.image.src || att.media.image.url);
  if (att.image_data) pushImg(att.image_data.url || att.image_data.preview_url);
  if (att.image) pushImg(att.image.src || att.image.url);
  maybeImg(att.url); maybeImg(att.preview_url); maybeImg(att.photo_url);
  pushTxt(att.title); pushTxt(att.subtitle); pushTxt(att.name); pushTxt(att.caption); pushTxt(att.description);
  if (att.payload && typeof att.payload === "object") {
    maybeImg(att.payload.url); if (att.payload.image) pushImg(att.payload.image.src || att.payload.image.url);
    pushTxt(att.payload.title); pushTxt(att.payload.subtitle); pushTxt(att.payload.text);
    const els = att.payload.elements && (att.payload.elements.data || att.payload.elements);
    if (Array.isArray(els)) for (const e of els) { const r = _deepAdCreative(e, depth + 1); images.push(...r.images); texts.push(...r.texts); }
  }
  const subs = att.subattachments && (att.subattachments.data || att.subattachments);
  if (Array.isArray(subs)) for (const s of subs) { const r = _deepAdCreative(s, depth + 1); images.push(...r.images); texts.push(...r.texts); }
  return { images: [...new Set(images)], texts: [...new Set(texts)] };
}

function extractPostImages(post) {
  const out = [];
  try {
    const atts = (post.attachments && (post.attachments.data || post.attachments)) || [];
    for (const a of (Array.isArray(atts) ? atts : [])) {
      if (a.url && (a.type === "photo" || !a.type)) out.push(a.url);
      const subs = a.subattachments && (a.subattachments.data || a.subattachments);
      for (const s of (Array.isArray(subs) ? subs : [])) {
        const u = s.url || (s.media && s.media.image && s.media.image.src);
        if (u) out.push(u);
      }
      const mu = a.media && a.media.image && a.media.image.src;
      if (mu) out.push(mu);
    }
  } catch (_) {}
  if (post.full_picture) out.push(post.full_picture);
  if (post.picture) out.push(post.picture);
  if (Array.isArray(post.image_urls)) out.push(...post.image_urls);
  if (Array.isArray(post.photos)) out.push(...post.photos.map(p => p.url || p).filter(Boolean));
  return [...new Set(out.filter(Boolean))];
}

// fetch có TIMEOUT cứng (chống treo cả bot khi endpoint không phản hồi).
async function _fetchTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const text = await r.text();
    return { status: r.status, text };
  } finally { clearTimeout(t); }
}

// FETCH nội dung BÀI VIẾT khách vừa trả lời (theo story_fbid). CÓ TIMEOUT + CACHE -> không treo, không lặp chậm.
const _postCache = new Map();   // storyFbid -> { at, result }
// Cache DANH SÁCH posts của page (Pancake chỉ có "Get posts" = list, KHÔNG có get-1-post theo id).
// Lấy list 1 lần rồi tra cứu nhiều post từ cache -> ít request.
const _postsListCache = new Map();   // pageId -> { at, byId:{postId->{caption,images}} }
let _adFetchRL = false;   // cờ: lần đọc bài ad GẦN NHẤT bị rate-limit 429 (lỗi TẠM THỜI, nên thử lại thay vì nhường người)

async function _loadPagePosts(PG, PGTOK) {
  const cached = _postsListCache.get(PG);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.byId;   // cache list 30' (tăng từ 10' -> ít request)
  // ĐANG COOLDOWN vì 429 -> KHÔNG quét-list nặng nữa (tránh hammer). Dùng cache cũ nếu có, else rỗng.
  if (Date.now() < _postsRLUntil) {
    _adFetchRL = true;   // báo lỗi TẠM THỜI -> worker/reader thử lại, KHÔNG đẩy người
    try { console.log(`[reader] POSTS đang COOLDOWN 429 (còn ${Math.ceil((_postsRLUntil - Date.now()) / 1000)}s) -> KHÔNG quét list, dùng cache cũ.`); } catch (_) {}
    return cached ? cached.byId : {};
  }
  const byId = {};
  const now = Math.floor(Date.now() / 1000);
  const DAY = 24 * 3600;
  const WIN = 28 * DAY;                 // cửa sổ < 1 THÁNG (Pancake bắt buộc since->until < 1 tháng)
  const OLDEST = now - 120 * DAY;      // quét 120 ngày (ad cũ vẫn chạy) — KHÔNG giảm kẻo bài ad >60 ngày không đọc được
  // Duyệt theo TỪNG cửa sổ 28 ngày (mới -> cũ); mỗi lần PHẢI có since + until + end_time.
  for (let winUntil = now; winUntil > OLDEST; winUntil -= WIN) {
    const winSince = Math.max(OLDEST, winUntil - WIN);
    let stop = false;
    for (let pageNo = 1; pageNo <= 4; pageNo++) {
      const u = `https://pages.fm/api/public_api/v1/pages/${PG}/posts`
        + `?page_access_token=${PGTOK}&page_number=${pageNo}&page_size=30`
        + `&since=${winSince}&until=${winUntil}&start_time=${winSince}&end_time=${winUntil}`;
      let arr = [];
      try {
        _req("lay-baiviet-ads");
        const { status, text } = await _fetchTimeout(u, 3000);
        const isHtml = /^\s*<!doctype|^\s*<html/i.test(text || "");
        if (isHtml) { try { console.log(`[reader] POSTS list (win) trang ${pageNo}: HTML (sai endpoint/token)`); } catch (_) {} stop = true; break; }
        let j; try { j = JSON.parse(text); } catch { break; }
        arr = j.posts || j.data || [];
        try { console.log(`[reader] POSTS win ${winSince}->${winUntil} trang ${pageNo}: ${status} | success=${j.success} | ${arr.length} post`); } catch (_) {}
        if (j.success !== true) {
          try { console.log(`[reader] POSTS lỗi chi tiết -> ${String(text).slice(0, 300)}`); } catch (_) {}
          if (status === 429 || /\b429\b|too many requests/i.test(String(text || ""))) {
            _adFetchRL = true; _postsRLUntil = Date.now() + 20 * 1000;   // 429 -> COOLDOWN 20s: ngưng quét-list nặng cho rate-limit hồi (fetch trực tiếp vẫn chạy)
          }
          stop = true; break;          // lỗi cấu hình/token -> dừng hẳn (đừng spam mọi cửa sổ)
        }
      } catch (e) { try { console.log("[reader] POSTS list lỗi:", e.name === "AbortError" ? "TIMEOUT" : e.message); } catch (_) {} break; }
      if (!arr.length) break;
      for (const p of arr) {
        const pid = String(p.id || "");               // dạng "PAGEID_POSTID"
        const suffix = pid.includes("_") ? pid.split("_").pop() : pid;
        const rec = { caption: String(p.message || p.caption || p.content || ""), images: extractPostImages(p) };
        byId[pid] = rec;
        if (suffix) byId[suffix] = rec;               // tra theo cả đuôi (post_id thật từ ad)
      }
      if (arr.length < 30) break;                     // hết post trong cửa sổ này
    }
    if (stop) break;
  }
  if (!_adFetchRL) _postsListCache.set(PG, { at: Date.now(), byId });   // 429 -> KHÔNG cache (để vòng sau đọc lại)
  return byId;
}

// LẤY THẲNG 1 bài theo post_id (né quét list 120 ngày + 429). Fail/không hỗ trợ -> null (fallback list cũ).
async function _fetchPostDirect(PG, PGTOK, sfb) {
  const ids = [`${PG}_${sfb}`, String(sfb)];
  for (const pid of ids) {
    const u = `https://pages.fm/api/public_api/v1/pages/${PG}/posts/${encodeURIComponent(pid)}`
      + `?page_access_token=${PGTOK}`;
    try {
      _req("lay-baiviet-ads");
      const { status, text } = await _fetchTimeout(u, 3000);
      if (/^\s*<!doctype|^\s*<html/i.test(text || "")) continue;   // sai endpoint -> bỏ
      let j; try { j = JSON.parse(text); } catch { continue; }
      const p = j.post || j.data || ((j.id || j.message || j.caption) ? j : null);
      if (!p) continue;
      const cap = String(p.message || p.caption || p.content || "");
      const imgs = extractPostImages(p);
      if (cap.trim().length >= 4 || imgs.length) {
        try { console.log(`[reader] POST lấy TRỰC TIẾP OK -> id=${pid} | status=${status} | caption="${cap.slice(0,45)}" imgs=${imgs.length}`); } catch (_) {}
        return { caption: cap, images: imgs };
      }
    } catch (_) {}
  }
  return null;
}

async function fetchPancakePost(storyFbid, pageId) {
  if (!storyFbid) return null;
  const PG = String(pageId || PAGE_ID || "");
  const PGTOK = reg.getToken(PG) || PAGE_TOKEN;
  const sfb = String(storyFbid);
  const cached = _postCache.get(sfb);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.result;
  let result = null;
  // (3) THỬ ĐỌC LẠI tối đa 4 lần, có NGHỈ tăng dần — CHỈ khi lỗi là 429 (rate-limit). Lỗi khác (post cũ/rỗng) -> dừng ngay.
  for (let attempt = 1; attempt <= 4; attempt++) {
    _adFetchRL = false;   // reset cờ 429 cho lần thử này
    try {
      // 1) THỬ lấy thẳng theo id (nhanh, né 120 ngày + 429).
      result = await _fetchPostDirect(PG, PGTOK, sfb);
      // 2) Không được -> fallback quét list như cũ.
      if (!result) {
        const byId = await _loadPagePosts(PG, PGTOK);
        result = byId[sfb] || byId[`${PG}_${sfb}`] || null;
      }
    } catch (_) {}
    if (result) break;
    if (!_adFetchRL) break;   // KHÔNG phải 429 -> đọc lại vô ích -> dừng
    if (attempt < 4) {
      const _wait = 1200 * attempt;   // nghỉ 1.2s -> 2.4s -> 3.6s cho rate-limit hồi rồi đọc lại
      try { console.log(`[reader] đọc bài ad bị 429 -> nghỉ ${_wait}ms rồi ĐỌC LẠI (lần ${attempt + 1}/4). pid=${sfb}`); } catch (_) {}
      await new Promise(r => setTimeout(r, _wait));
    }
  }
  try {
    if (result) { console.log(`[reader] POST khớp trong list -> id=${sfb} | caption="${result.caption.slice(0, 45)}" imgs=${result.images.length}`); }
    else { console.log(`[reader] POST KHÔNG đọc được -> id=${sfb} (${_adFetchRL ? "429 kéo dài sau 4 lần thử" : "bài cũ/ngoài 120 ngày hoặc list rỗng"})`); }
  } catch (_) {}
  if (result) _postCache.set(sfb, { at: Date.now(), result });
  return result;
}

function normalizeMessages(apiMessages, pageId) {
  const PID = String(pageId || PAGE_ID || "");
  const result = [];

  for (const msg of apiMessages || []) {
    const sender =
      String(msg?.from?.id || "") === PID ? "shop" : "customer";
    const channel = String(msg?.type || "").toUpperCase();   // COMMENT | INBOX
    const adminName = msg?.from?.admin_name || null;          // "Botcake" | "Public API" | tên NV...
    const fromId = String(msg?.from?.id || "");
    const adminId = String(msg?.from?.admin_id || "");

    // NỘI DUNG TIN: ưu tiên original_message; nếu RỖNG -> lấy `message`.
    // (Nhiều tin INBOX của khách — nhất là khách đến từ ADS — chỉ có chữ ở `message`,
    //  original_message rỗng -> trước đây bị VỨT -> batch rỗng -> bot bỏ qua oan.)
    let _src = String(msg?.original_message || "").trim();
    let _usedFallback = false;
    if (!_src) { _src = String(msg?.message || "").trim(); _usedFallback = !!_src; }
    if (!_src) {
      // COMMENT (hoặc tin lạ) đôi khi để nội dung ở field khác -> vớt an toàn (chỉ khi 2 field chính rỗng).
      _src = String(msg?.content || msg?.text || msg?.data?.message || msg?.comment?.message || msg?.message_text || "").trim();
      _usedFallback = _usedFallback || !!_src;
    }
    let text = _src.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    // LOẠI tin HỆ THỐNG của shop (banner "phản hồi bình luận" / "đã trả lời quảng cáo") -> không phải nội dung thật.
    if (/Bạn đang phản hồi bình luận|đã trả lời một quảng cáo/i.test(text)) text = "";
    // XÁC NHẬN: khi bật DUMP_EMPTY=1, in mỗi lần vớt được tin nhờ fallback (để biết bug field có thật).
    if (_usedFallback && text && process.env.DUMP_EMPTY === "1") {
      try {
        const who = sender === "shop" ? "SHOP " : "KHÁCH";
        console.log(`[reader][VỚT fallback message] ${who} | "${text.slice(0, 55)}" | (original_message rỗng) | id=${msg.id}`);
      } catch (_) {}
    }

    if (text) {
      result.push({
        type: "text",
        sender,
        channel,
        adminName,
        fromId,
        adminId,
        text,
        imageUrl: null,
        insertedAt: msg.inserted_at,
        messageId: msg.id
      });
    }

    const _ownPhoto = (msg.attachments || []).some(a => a && a.type === "photo");
    for (const att of msg.attachments || []) {
      if (att.type === "photo") {
        result.push({
          type: "image",
          sender,
          channel,
          adminName,
          text: "[Photo]",
          imageUrl: att.url,
          insertedAt: msg.inserted_at,
          messageId: msg.id
        });
        continue;
      }
      // TIN TRẢ LỜI: khách "reply" vào 1 ảnh đã gửi trước đó -> ảnh nằm LỒNG trong att.attachments[]
      // với att.type="replied_message". Bóc ra để vision nhận đúng MẪU trong ảnh được reply.
      if ((att.type === "replied_message" || Array.isArray(att.attachments)) && Array.isArray(att.attachments)) {
        let _n = 0;
        for (const sub of att.attachments) {
          if (sub && sub.type === "photo" && sub.url) {
            result.push({
              type: "image",
              sender,
              channel,
              adminName,
              text: "[Photo reply]",
              imageUrl: sub.url,
              fromReply: true,
              insertedAt: msg.inserted_at,
              messageId: msg.id
            });
            _n++;
          }
        }
        if (_n) { try { console.log(`[reader] tin TRẢ LỜI: bóc ${_n} ảnh từ replied_message -> đưa vào nhận diện. id=${msg.id}`); } catch (_) {} }
        continue;
      }
      // LIKE ngón cái / sticker thumbs-up của Messenger -> coi như khách "👍" (đồng ý).
      const sid = String(att.sticker_id || att.id || att.payload?.sticker_id || "");
      const aurl = String(att.url || att.payload?.url || "");
      const THUMBS = ["369239263222822", "369239343222814", "369239383222810"];
      const isThumb = THUMBS.includes(sid) || /thumbup|thumb_up|\blike\b/i.test(aurl)
        || att.type === "like" || att.type === "thumbs_up";
      if (isThumb && !text) {
        result.push({
          type: "text",
          sender,
          channel,
          adminName,
          fromId,
          adminId,
          text: "👍",
          imageUrl: null,
          insertedAt: msg.inserted_at,
          messageId: msg.id
        });
      } else if (!text) {
        // sticker/attachment lạ không nhận ra -> log để biết cấu trúc thật (debug like/sticker).
        try { RDBG && console.log("[reader] attachment lạ (không text):", JSON.stringify({ type: att.type, sticker_id: att.sticker_id, id: att.id, url: (att.url || "").slice(0, 80) })); } catch (_) {}
      }
    }

    // ===== ẢNH TỪ TIN ĐƯỢC-TRẢ-LỜI (khách "trả lời trực tiếp" vào 1 ảnh đã gửi trước đó) =====
    // Pancake/FB có thể để ảnh QUOTE ở field reply_to/parent/quoted... (KHÔNG nằm trong attachments của tin mới)
    // -> nếu tin NÀY không có ảnh riêng, vớt ảnh từ các field quote phổ biến để vision nhận đúng mẫu.
    if (!_ownPhoto) {
      const _qSrc = msg.reply_to || msg.replied_to || msg.parent || msg.quoted_message || msg.quote || msg.in_reply_to || msg.referral || null;
      if (_qSrc && typeof _qSrc === "object") {
        const _qImgs = [];
        const _pushQ = u => { u = String(u || ""); if (/^https?:\/\//i.test(u) && !_qImgs.includes(u)) _qImgs.push(u); };
        const _qatts = (_qSrc.attachments && (_qSrc.attachments.data || _qSrc.attachments)) || [];
        for (const a of (Array.isArray(_qatts) ? _qatts : [])) {
          if (a && (a.type === "photo" || !a.type)) _pushQ(a.url || (a.payload && a.payload.url) || (a.image && (a.image.src || a.image.url)));
        }
        _pushQ(_qSrc.url);
        if (_qSrc.image) _pushQ(_qSrc.image.src || _qSrc.image.url);
        if (_qSrc.photo) _pushQ(_qSrc.photo.url || _qSrc.photo);
        for (const u of _qImgs) {
          result.push({ type: "image", sender, channel, adminName, text: "[Photo trả lời]", imageUrl: u, insertedAt: msg.inserted_at, messageId: msg.id });
        }
        if (_qImgs.length) { try { console.log(`[reader] vớt ${_qImgs.length} ẢNH từ tin được-TRẢ-LỜI (quote) -> đưa vào nhận diện. id=${msg.id}`); } catch (_) {} }
      }
      // DUMP: bật DUMP_REPLY=1 -> in TOÀN BỘ tin khách (mọi field + attachments) để biết Pancake để ảnh-được-reply ở đâu.
      if (process.env.DUMP_REPLY === "1" && sender === "customer") {
        try {
          console.log(`[reader][DUMP_FULL] id=${msg.id} | keys: ${Object.keys(msg || {}).join(",")}`);
          console.log(`[reader][DUMP_FULL] attachments=${JSON.stringify(msg.attachments || null)}`);
          console.log(`[reader][DUMP_FULL] FULL=${JSON.stringify(msg).slice(0, 1800)}`);
        } catch (_) {}
      }
    }
  }

  result.sort((a, b) => new Date(a.insertedAt) - new Date(b.insertedAt));
  return result;
}

async function readConversation(conversationId, convMeta = null) {
  // page_id THẬT từ list (comment conv id = "POSTID_xxx" -> KHÔNG suy được page từ id hội thoại).
  const _pageHint = convMeta && (convMeta.page_id || convMeta.pageId) ? String(convMeta.page_id || convMeta.pageId) : "";
  // PID = PAGE THẬT của hội thoại (để phân biệt shop/khách). Comment conv suy nhầm ra post id -> chỉnh lại.
  let PID = _pageHint || reg.pageIdFromConv(conversationId) || PAGE_ID;
  if (!reg.isKnownPage(PID) && !(PAGE_ID && PID === PAGE_ID)) {
    const _pgs = reg.listPages();
    if (_pgs.length === 1) PID = _pgs[0].id;
    else if (PAGE_ID) PID = PAGE_ID;
  }
  const data = await getMessages(conversationId, PID);

  // [DUMP_RAW] Soi THÔ 6 tin cuối (message vs original_message vs from) để biết vì sao
  // reader không thấy tin khách. Bật: set DUMP_RAW=1  (lọc 1 hội thoại: set DUMP_CONV=<id>)
  if (process.env.DUMP_RAW === "1" &&
      (!process.env.DUMP_CONV || process.env.DUMP_CONV === String(conversationId))) {
    try {
      const arr = Array.isArray(data.messages) ? data.messages : [];
      console.log(`===== [DUMP_RAW] conv ${conversationId} | tổng tin thô: ${arr.length} =====`);
      for (const m of arr.slice(-6)) {
        const who = String(m?.from?.id || "") === String(PID) ? "SHOP" : "KHÁCH";
        const orig = String(m?.original_message || "").replace(/<[^>]+>/g, "").trim();
        const msgF = String(m?.message || "").replace(/<[^>]+>/g, "").trim();
        // ATTACHMENTS: ảnh khách up / ad_click creative / sticker -> để biết "hồng" là ảnh khách hay ảnh ad.
        const atts = Array.isArray(m?.attachments) ? m.attachments : [];
        const attDesc = atts.map(a => {
          const u = String(a?.url || a?.payload?.url || "").slice(0, 60);
          return `${a?.type || "?"}${u ? "(" + u + ")" : ""}`;
        }).join(" , ");
        console.log(
          `  [${who}] type=${m?.type} | admin=${m?.from?.admin_name || "-"}` +
          ` | original_message="${orig.slice(0, 45)}"` +
          ` | message="${msgF.slice(0, 45)}"` +
          ` | atts[${atts.length}]: ${attDesc || "-"}` +
          ` | at=${m?.inserted_at}`
        );
      }
      console.log("==========================================================");
    } catch (_) {}
  }

  // DẤU HIỆU PHIÊN BẢN (để xác nhận reader MỚI đã nạp) + dump key cấp hội thoại 1 lần.
  try { RDBG && console.log("[reader] v2-adscan | conv:", conversationId, "| data.keys:", Object.keys(data || {}).join(",")); } catch (_) {}

  // [DUMP_COMMENT] Soi TOÀN BỘ cấu trúc THÔ cho hội thoại COMMENT (vì sao KHÁCH-comment=0).
  // Bật: set DUMP_COMMENT=1  -> chạy bot, đợi 1 comment kẹt -> dán log này để chỉnh đúng field/endpoint.
  if (process.env.DUMP_COMMENT === "1") {
    try {
      const arr = Array.isArray(data.messages) ? data.messages : [];
      const isCmt = String(convMeta?.type || "").toUpperCase() === "COMMENT"
        || arr.some(m => String(m?.type || "").toUpperCase() === "COMMENT");
      if (isCmt) {
        console.log(`===== [DUMP_COMMENT] conv ${conversationId} | metaType=${convMeta?.type || "?"} | data.keys=${Object.keys(data || {}).join(",")} | msgs=${arr.length} =====`);
        const last = arr[arr.length - 1];
        console.log("  LAST MSG keys:", last ? Object.keys(last).join(",") : "(KHÔNG có tin nào)");
        console.log("  LAST MSG json:", JSON.stringify(last || {}).slice(0, 1400));
        for (const k of ["comments", "activities", "post", "comment", "data"]) {
          if (data[k] != null) console.log(`  data.${k}:`, JSON.stringify(data[k]).slice(0, 900));
        }
        console.log("==========================================================");
      }
    } catch (_) {}
  }

  const post = data.post || null;
  const postImages =
    post && post.attachments && Array.isArray(post.attachments.data)
      ? post.attachments.data.filter(a => a.type === "photo" && a.url).map(a => a.url)
      : [];

  // ID LUỒNG TIN NHẮN RIÊNG (Messenger) lấy từ comment của KHÁCH.
  // Gửi vào id "m_..." này -> Pancake ghi vào hội thoại INBOX -> hiện ở GIAO DIỆN TIN NHẮN
  // (gửi vào id hội thoại COMMENT thì hiện ở giao diện bình luận).
  // KHÔNG lọc theo can_reply_privately: dù đã dùng hết lượt trả lời riêng, luồng m_ vẫn tồn tại.
  let privateReplyId = null;
  let prAt = 0;
  for (const m of (data.messages || [])) {
    const isCustomer = String(m?.from?.id || "") !== String(PID);
    const prc = m?.private_reply_conversation?.id || null;
    if (isCustomer && prc && String(prc).startsWith("m_")) {   // chỉ nhận luồng Messenger thật
      const t = new Date(m.inserted_at || 0).getTime();
      if (t >= prAt) { prAt = t; privateReplyId = prc; }
    }
  }

  // ID hội thoại INBOX thật của khách = PID + "_" + psid.
  // Gửi DM vào đây -> Pancake xếp vào hội thoại INBOX -> hiện ở GIAO DIỆN TIN NHẮN.
  const psid =
    data?.conv_from?.id || data?.customers?.[0]?.fb_id || data?.conv_customers?.[0]?.fb_id || null;
  const inboxConversationId = psid ? `${PID}_${psid}` : null;

  // Còn lượt TRẢ LỜI RIÊNG (private reply) cho bình luận mới nhất của khách không?
  // FB chỉ cho private-reply 1 lần/bình luận -> nếu ai trả lời trước thì hết -> không ra banner.
  let canReplyPrivately = null;
  let crpAt = 0;
  for (const m of (data.messages || [])) {
    const isCustomer = String(m?.from?.id || "") !== String(PID);
    const isComment = String(m?.type || "").toUpperCase() === "COMMENT";
    if (isCustomer && isComment && typeof m?.can_reply_privately !== "undefined") {
      const t = new Date(m.inserted_at || 0).getTime();
      if (t >= crpAt) { crpAt = t; canReplyPrivately = m.can_reply_privately === true; }
    }
  }

  // ===== PHÁT HIỆN TIN ĐẾN TỪ QUẢNG CÁO (Click-to-Messenger) =====
  // FB nhúng "referral" vào tin của khách: { source:"ADS", ad_id, ref, ads_context_data:{ad_title, photo_url} }.
  // Pancake đặt field KHÔNG cố định -> DÒ ĐỆ QUY mọi nhánh + log thô để khoá field thật.
  let fromAd = false, adId = null, adTitle = "", adPhotoUrl = null;
  // ===== AD TỪ FIELD HỘI THOẠI (list v2): ads / ad_ids — Ad ID THẬT + post_id của bài ad =====
  // (API tin-nhắn KHÔNG trả creative; chỉ object hội thoại mới có.) Đây là nguồn ĐÚNG NHẤT.
  let _metaAdId = null, _metaPostId = null;
  try {
    const _ads = convMeta && Array.isArray(convMeta.ads) ? convMeta.ads : null;
    const _adIds = convMeta && Array.isArray(convMeta.ad_ids) ? convMeta.ad_ids : null;
    // ads có thể là NHIỀU ad -> CHỌN AD MỚI NHẤT (inserted_at lớn nhất) = ad khách vừa bấm.
    // KHÔNG dùng _ads[0]: Pancake trả mảng KHÔNG sắp xếp, [0] thường là ad CŨ -> đọc nhầm caption.
    let _adPick = null;
    if (_ads && _ads.length) {
      _adPick = _ads
        .map(a => ({ a, t: a && a.inserted_at ? new Date(a.inserted_at).getTime() : 0 }))
        .sort((x, y) => y.t - x.t)[0].a;
    }
    if (_adPick) {
      _metaAdId = _adPick.ad_id || (_adIds && _adIds[0]) || null;
      const pid = _adPick.post_id ? String(_adPick.post_id) : null;     // "PAGEID_<suffix>" -> lấy đuôi để đọc bài
      if (pid) _metaPostId = pid.includes("_") ? pid.split("_").pop() : pid;
    } else if (_adIds && _adIds[0]) {
      _metaAdId = _adIds[0];
    }
  } catch (_) {}
  if (_metaAdId) fromAd = true;
  const _adSignal = (obj, depth) => {
    if (!obj || typeof obj !== "object" || depth > 5) return null;
    const ctx = obj.ads_context_data || obj.ad_context_data || null;
    const id = obj.ad_id || obj.adId || (ctx && (ctx.ad_id || ctx.adId)) || null;
    const src = String(obj.source || obj.ref_type || "").toUpperCase();
    if (ctx || id || src === "ADS" || src === "AD") {
      return {
        adId: id,
        adTitle: (ctx && (ctx.ad_title || ctx.post_title || ctx.title)) || obj.ref || obj.ad_title || "",
        adPhotoUrl: (ctx && (ctx.photo_url || ctx.image_url)) || obj.photo_url || null
      };
    }
    for (const k of Object.keys(obj)) {
      if (/referral|referrer|ads?_context|ad_id|\bads\b|\bad\b|message|data|context/i.test(k)) {
        const r = _adSignal(obj[k], depth + 1);
        if (r) return r;
      }
    }
    return null;
  };
  let lastCustMsg = null;
  for (const m of (data.messages || [])) {
    const isCustomer = String(m?.from?.id || "") !== String(PID);
    if (!isCustomer) continue;
    lastCustMsg = m;
    const sig = _adSignal(m, 0);
    if (sig) {
      fromAd = true;
      adId = sig.adId || adId;
      adTitle = sig.adTitle || adTitle;
      adPhotoUrl = sig.adPhotoUrl || adPhotoUrl;
      try { RDBG && console.log("[reader] AD detect:", JSON.stringify({ adId, adTitle: String(adTitle).slice(0, 60), hasPhoto: !!adPhotoUrl }).slice(0, 240)); } catch (_) {}
      // KHÔNG break: lấy referral MỚI NHẤT (tin sau ghi đè tin trước).
    }
  }
  // Fallback field cấp hội thoại.
  if (!fromAd && (data.ad_id || data.from_ad || data.is_ad || (data.tags && data.tags.from_ad) || _adSignal(data.post || null, 0))) {
    fromAd = true;
    adId = adId || data.ad_id || null;
    const ps = _adSignal(data.post || null, 0);
    if (ps) { adTitle = adTitle || ps.adTitle; adPhotoUrl = adPhotoUrl || ps.adPhotoUrl; }
  }
  // Pancake KHÔNG đưa referral ads kiểu FB; nó GẮN BÀI VIẾT (ads/post) vào hội thoại
  // -> "khách trả lời 1 bài viết" = tin từ ads. Lấy mẫu từ caption + ảnh của bài đó.
  // (Hội thoại COMMENT cũng có post, nhưng worker chặn ad-opener bằng !isCommentOrigin nên an toàn.)
  if (!fromAd && post) {
    fromAd = true;
    adId = adId || (post.id ? String(post.id) : (data.post_id || null));
    adTitle = adTitle || String(post.message || "");
    adPhotoUrl = adPhotoUrl || (postImages && postImages[0]) || null;
    try { RDBG && console.log("[reader] AD via POST:", JSON.stringify({ postId: adId, hasCaption: !!adTitle, imgs: (postImages || []).length }).slice(0, 200)); } catch (_) {}
  }

  // ===== ADS QUA data.ad_clicks (Pancake để ĐÂY) =====
  const _adClicks = Array.isArray(data.ad_clicks) ? data.ad_clicks : [];
  const _sugPosts = Array.isArray(data.suggested_posts) ? data.suggested_posts : [];
  const _sugProds = Array.isArray(data.suggested_products) ? data.suggested_products : [];
  // DUMP cấu trúc để khoá field (sẽ gỡ sau khi chốt).
  try {
    if (_adClicks.length) RDBG && console.log("[reader] ad_clicks[last]:", JSON.stringify(_adClicks[_adClicks.length - 1]).slice(0, 500));
    if (_sugPosts.length) RDBG && console.log("[reader] suggested_posts[0]:", JSON.stringify(_sugPosts[0]).slice(0, 500));
    if (_sugProds.length) RDBG && console.log("[reader] suggested_products[0]:", JSON.stringify(_sugProds[0]).slice(0, 500));
  } catch (_) {}
  // LẤY NỘI DUNG AD từ ad_clicks/suggested_* — CHẠY KỂ CẢ KHI fromAd đã bật sớm (chỉ có ad_id, thiếu caption/ảnh).
  if (_adClicks.length) {
    fromAd = true;
    const last = _adClicks[_adClicks.length - 1];
    const sig = _adSignal(last, 0) || {};
    adId = adId || sig.adId || last.ad_id || last.adId || last.id || null;
    const pid = last.post_id || last.postId || (last.post && last.post.id) || null;
    // Tìm bài viết tương ứng: ad_click.post -> suggested_posts khớp id -> suggested_posts[0].
    const adPost = (last.post && typeof last.post === "object" ? last.post : null)
      || _sugPosts.find(p => pid && String(p.id) === String(pid))
      || _sugPosts[0] || null;
    if (adPost) {
      adTitle = adTitle || String(adPost.message || adPost.caption || adPost.title || "");
      const imgs = (adPost.attachments && Array.isArray(adPost.attachments.data))
        ? adPost.attachments.data.filter(a => a.type === "photo" && a.url).map(a => a.url)
        : (Array.isArray(adPost.images) ? adPost.images : []);
      adPhotoUrl = adPhotoUrl || imgs[0] || adPost.photo_url || null;
      if (imgs.length && !(postImages && postImages.length)) postImages.push(...imgs);
    }
    // Nếu Pancake gợi ý sẵn sản phẩm -> dùng tên/ảnh làm gợi ý nhận diện.
    if (_sugProds[0]) {
      const sp = _sugProds[0];
      adTitle = adTitle || String(sp.name || sp.title || "");
      adPhotoUrl = adPhotoUrl || sp.image_url || sp.photo_url || (Array.isArray(sp.images) && sp.images[0]) || null;
    }
    try { RDBG && console.log("[reader] AD via ad_clicks:", JSON.stringify({ adId, postId: pid, hasTitle: !!adTitle, hasPhoto: !!adPhotoUrl }).slice(0, 220)); } catch (_) {}
  }
  // ===== ADS/BÀI VIẾT: gom ỨNG VIÊN caption + post id; worker sẽ chọn cái RA ĐƯỢC sản phẩm =====
  // Marker = tin "Khách đã trả lời (về một) bài viết/quảng cáo" -> hội thoại đến từ ads/post.
  let _markerTime = 0, _replyFbid = null, _hasAdMarker = false, _adRepliedPfbid = null;
  for (const m of (data.messages || [])) {
    const txt = String(m.message || m.original_message || "");
    if (_RE_ADREPLY.test(txt)) {
      _hasAdMarker = true;
      const t = new Date(m.inserted_at || 0).getTime();
      if (t >= _markerTime) _markerTime = t;
      const tags = Array.isArray(m.message_tags) ? m.message_tags : [];
      const linkTag = tags.find(x => x && x.type === "link" && /story_fbid=|story\.php|\/posts\/|\/permalink\//i.test(String(x.link || "")));
      // Lấy id bài để (nếu là id SỐ) đi đọc nội dung bài. Quét cả link thẻ lẫn chữ trong tin
      // (marker tiếng Anh nhúng URL ngay trong nội dung: "...View post (https://.../posts/<id>)").
      const _hay = String((linkTag && linkTag.link) || "") + " " + txt;
      const mfb = /story_fbid=(\d{6,})|\/posts\/(\d{6,})|\/permalink\/(\d{6,})/i.exec(_hay);
      if (mfb && !_replyFbid) _replyFbid = mfb[1] || mfb[2] || mfb[3];
      // pfbid (FB ẩn id số) -> KHÔNG gọi lại được qua API posts -> chỉ lưu cho ghi chú người thật.
      const mpf = /\/posts\/(pfbid[\w-]+)/i.exec(_hay); if (mpf && !_adRepliedPfbid) _adRepliedPfbid = mpf[1];
    }
  }
  // Ad ID thật + POST ID SỐ từ ad_clicks / attachment type "ad_click" (vd .../999095162485726).
  let _adClickId = null, _adPostId = null;
  if (_metaPostId) _adPostId = _metaPostId;   // post_id từ ads (chuẩn nhất) -> dẫn khối đọc bài bên dưới
  try {
    const ac = Array.isArray(data.ad_clicks) ? data.ad_clicks : ((data.ad_clicks && data.ad_clicks.data) || []);
    for (const c of ac) { const id = c && (c.ad_id || c.adId || c.id || (c.ad && c.ad.id)); if (id) { _adClickId = String(id); break; } }
  } catch (_) {}
  for (const m of (data.messages || [])) {
    for (const a of (m.attachments || [])) {
      if (a && a.type === "ad_click" && a.url) { const mm = /(\d{6,})/.exec(String(a.url)); if (mm) _adPostId = mm[1]; }
    }
  }

  let _capCands = [];

  // ===== COMMENT trên BÀI VIẾT / REEL / VIDEO -> lấy TÊN MẪU từ caption =====
  // Marker "Bạn đang phản hồi bình luận ... (link reel/posts/video)" nhúng post_id;
  // KHỚP CHÍNH XÁC post_id đó với data.activities -> lấy caption (vd "CELYNE DRESS").
  // Khớp theo id nên KHÔNG đoán mò "bài mới nhất" -> an toàn, không báo sai mẫu.
  let _commentPostId = null;
  for (const m of (data.messages || [])) {
    const txt = String(m.message || m.original_message || "");
    if (!/phản hồi bình luận|回覆.*(貼文|留言)|trả lời.*(bài viết|quảng cáo)|replied to (a |an |your |the )?(post|comment|ad\b)/i.test(txt)) continue;
    for (const x of (Array.isArray(m.message_tags) ? m.message_tags : [])) {
      const link = String((x && x.link) || "");
      const mm = /\/(?:reel|posts|videos|photo)\/(\d{6,})|[?&](?:fbid|story_fbid)=(\d{6,})|[?&]comment_id=\d+/i.exec(link);
      if (mm && (mm[1] || mm[2])) { _commentPostId = mm[1] || mm[2]; break; }
    }
    if (_commentPostId) break;
  }
  if (_commentPostId && !adTitle) {
    const acts = Array.isArray(data.activities) ? data.activities : [];
    const hit = acts.find(a => {
      if (!a) return false;
      const ids = [];
      if (a.post_id) ids.push(String(a.post_id));
      if (a.target && a.target.id) ids.push(String(a.target.id));
      if (Array.isArray(a.ids)) for (const i of a.ids) ids.push(String(i));
      if (a.target && a.target.url) { const u = /\/(?:reel|posts|videos|photo)\/(\d{6,})/i.exec(String(a.target.url)); if (u) ids.push(u[1]); }
      return ids.includes(String(_commentPostId));
    });
    const cap = hit ? String(hit.message || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
    if (cap.length >= 8) {
      fromAd = true;
      adId = adId || _commentPostId;
      adTitle = adTitle || cap;
      _capCands.push({ t: Date.now() + 1, text: cap });   // ưu tiên cao (mới nhất)
      const imgs = (hit.attachments && Array.isArray(hit.attachments.data))
        ? hit.attachments.data.filter(x => x && x.url).map(x => x.url) : [];
      if (imgs.length) { adPhotoUrl = adPhotoUrl || imgs[0]; for (const u of imgs) if (!postImages.includes(u)) postImages.push(u); }
      try { RDBG && console.log("[reader] COMMENT bài/reel -> đọc caption:", JSON.stringify({ postId: _commentPostId, cap: cap.slice(0, 55) }).slice(0, 220)); } catch (_) {}
    } else {
      try { RDBG && console.log("[reader] COMMENT bài/reel: có post_id nhưng KHÔNG khớp activity caption | postId=" + _commentPostId); } catch (_) {}
    }
  }

  // ỨNG VIÊN caption: tin do PAGE đăng (KHÔNG admin_name "Public API"), KHÔNG phải marker, KHÔNG phải tin chào tự động.
  if (_hasAdMarker || fromAd) {
    fromAd = true;
    try {
      const native = (data.messages || []).filter(m => {
        const f = m.from || {};
        return String(f.id || "") === String(PID) && String(f.admin_name || "") !== "Public API";
      });
      for (const m of native) {
        const txt = String(m.original_message || m.message || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const isMarker = _RE_ADREPLY.test(txt);
        const isGreet = /cảm ơn (bạn|anh|chị|quý khách).*(gửi tin nhắn|inbox)|sẽ cố gắng phản hồi|phản hồi (nhanh nhất|sớm nhất)|chào (bạn|anh|chị|mừng)/i.test(txt);
        // [FIX Mai Nguyen 2026-07-11] Tin TƯ VẤN/BÁO GIÁ cũ của shop ("Dạ PHOM xin gửi chị báo giá của thiết kế
        // Coraliea...") lẫn vào ứng viên caption -> bài mới không đọc được là vớ tên MẪU CŨ ra tư vấn. Chữ shop
        // tư vấn KHÔNG bao giờ là caption bài.
        const isShopReply = /^d[ạa]([\s,.:!]|$)|xin gửi (chị|bạn|anh).*(báo giá|bảng giá)|cho em xin|em tư vấn|lên đơn cho mình/i.test(txt);
        if (!isMarker && !isGreet && !isShopReply && txt.length >= 20) _capCands.push({ t: new Date(m.inserted_at || 0).getTime(), text: txt });
        // [FIX Zân July 2026-07-11] TUYỆT ĐỐI không vét ẢNH từ tin lịch sử của page làm "ảnh bài ad":
        // album mẫu CŨ bot từng gửi (Flow Dress...) chui vào postImages -> vision "ảnh bài ad" quét trúng
        // ảnh cũ -> bám mẫu cũ thay vì mẫu của AD MỚI khách vừa bấm. Ảnh bài ad chỉ được lấy từ nguồn
        // XÁC THỰC: bài đọc được (post.attachments), thẻ ad (_near), creative API, bài comment.
      }
      _capCands.sort((a, b) => b.t - a.t);   // mới nhất trước
    } catch (e) { try { RDBG && console.log("[reader] adcap err:", e.message); } catch (_) {} }

    // ===== VỚT THẲNG CREATIVE (ảnh + caption) TỪ THẺ AD trong tin khách =====
    // Pancake nhiều khi CHỈ đưa ad_id (có thể SAI) + KHÔNG kèm post; nhưng thẻ ad (attachment ad_click/template)
    // có sẵn ẢNH + CAPTION ngay trong hội thoại. Ưu tiên ẢNH (cho vision), CAPTION làm dự phòng tên mẫu.
    try {
      const _near = [], _far = [], _adTexts = [];
      for (const m of (data.messages || [])) {
        const isAdMsg = (m.attachments || []).some(a => a && a.type === "ad_click")
          || _RE_ADREPLY.test(String(m.message || m.original_message || ""));
        for (const a of (m.attachments || [])) {
          const r = _deepAdCreative(a);
          (isAdMsg ? _near : _far).push(...r.images);
          if (isAdMsg) _adTexts.push(...r.texts);
        }
      }
      // CHỈ lấy ảnh THUỘC THẺ AD (_near). KHÔNG lấy _far (ảnh rải rác trong hội thoại:
      // album shop gửi mẫu CŨ trước đó) -> trước đây vision đọc nhầm mẫu cũ -> BÁO SAI.
      for (const u of _near) if (!postImages.includes(u)) postImages.push(u);
      if (postImages.length && !adPhotoUrl) adPhotoUrl = postImages[0];
      // caption từ thẻ ad -> ứng viên tên mẫu (ưu tiên cao)
      for (const t of _adTexts) if (t.length >= 4) _capCands.push({ t: Date.now() + 2, text: t });
      _capCands.sort((a, b) => b.t - a.t);
      if (_near.length || _adTexts.length) {
        try { console.log(`[AD IMG] thẻ ad: ${_near.length} ảnh + ${_adTexts.length} caption (tổng ảnh=${postImages.length}) | cap0="${(_adTexts[0] || "").slice(0, 40)}" | img0=${(postImages[0] || "-").slice(0, 55)}`); } catch (_) {}
      }
    } catch (e) { try { RDBG && console.log("[reader] ad creative err:", e.message); } catch (_) {} }
    // adId ổn định: story_fbid > Ad ID thật > post id số > marker time.
    if (!adId) adId = _replyFbid || _adClickId || _adPostId || ("ad_" + _markerTime);
    if (_metaAdId) adId = String(_metaAdId);   // Ad ID THẬT từ ads/ad_ids ĐÈ mọi id đoán -> map + dedup chuẩn

    // CÓ post id (từ ad_click HOẶC từ marker "replied to a post" có id SỐ) NHƯNG creative
    // KHÔNG nằm trong hội thoại -> ĐI LẤY nội dung bài viết đó về để biết mẫu (vd FELINE).
    // CÓ post id từ ads -> ƯU TIÊN đọc NỘI DUNG BÀI THẬT qua API Pancake (caption + ảnh chuẩn của bài ad).
    // Trước đây chỉ đọc khi _capCands & postImages đều rỗng -> nhưng caption "vớ" trong hội thoại
    // (vd tin shop tự động "Dạ Mys.P xin gửi...") làm reader tưởng đã có caption -> KHÔNG đọc bài thật
    // -> findInText khớp bừa mẫu vô can (lỗi Genielle->Nayeli). Nay: CÓ _metaPostId (post_id THẬT từ ads)
    // thì LUÔN đọc bài để lấy caption chuẩn, đẩy lên ĐẦU ứng viên.
    // ƯU TIÊN bài khách ĐANG trả lời/comment trong LƯỢT NÀY (vd GIANNAL vừa bấm hôm nay) hơn post trong
    // mảng ads. Lý do: mảng ads CHỈ có {ad_id, inserted_at, post_id} và inserted_at KHÔNG đáng tin
    // (ad MONA tháng 03 lại mang mốc mới hơn) -> "chọn ad mới nhất theo inserted_at" vớ nhầm ad CŨ.
    // Post của chính lượt này (comment/reply) mới là ad khách đang xem.
    const _turnPid = (_commentPostId && /^\d{6,}$/.test(String(_commentPostId))) ? String(_commentPostId)
                   : (_replyFbid && /^\d{6,}$/.test(String(_replyFbid))) ? String(_replyFbid) : null;
    const _fetchPid = _turnPid || _metaPostId || _adPostId || null;   // pfbid KHÔNG dùng (không gọi lại được)
    const _mustFetchPost = (!!_turnPid || !!_metaPostId) && /^\d{6,}$/.test(String(_fetchPid || ""));   // có post THẬT -> luôn đọc
    if (_turnPid && _metaPostId && _turnPid !== String(_metaPostId)) {
      try { console.log(`[reader] ƯU TIÊN bài LƯỢT NÀY pid=${_turnPid} (khách vừa trả lời/comment) > ads inserted_at pid=${_metaPostId}`); } catch (_) {}
    }
    if (_fetchPid && /^\d{6,}$/.test(String(_fetchPid)) && (_mustFetchPost || (_capCands.length === 0 && postImages.length === 0))) {
      try { console.log(`[reader] >>> THỬ đọc bài THẬT (Pancake): pid=${_fetchPid} | must=${!!_mustFetchPost} | capCands=${_capCands.length} imgs=${postImages.length}`); } catch (_) {}
      try {
        const fp = await fetchPancakePost(_fetchPid, PID);
        if (fp) {
          // caption bài THẬT -> ưu tiên CAO NHẤT (đè caption vớ trong hội thoại).
          if (fp.caption && String(fp.caption).trim().length >= 4) _capCands.push({ t: Date.now() + 100, text: String(fp.caption) });
          for (const u of (fp.images || [])) if (!postImages.includes(u)) postImages.push(u);
          if (!adPhotoUrl && fp.images && fp.images[0]) adPhotoUrl = fp.images[0];
          _capCands.sort((a, b) => b.t - a.t);
          try { console.log(`[reader] AD đọc BÀI THẬT (Pancake): pid=${_fetchPid} | cap="${(fp.caption || "").slice(0, 45)}" | imgs=${(fp.images || []).length}`); } catch (_) {}
        } else {
          if (_adFetchRL) { data._adFetchTransientFail = true; try { console.log(`[reader] AD post fetch bị 429 RATE-LIMIT (lỗi TẠM THỜI) -> pid=${_fetchPid} (sẽ thử lại, KHÔNG nhường người)`); } catch (_) {} }
          try { console.log(`[reader] AD post fetch RỖNG (Pancake trả null) -> pid=${_fetchPid}`); } catch (_) {}
        }
      } catch (e) { try { console.log("[reader] AD post fetch NÉM LỖI:", e && e.message); } catch (_) {} }
    }

    // ===== DUMP CHẨN ĐOÁN: tìm nơi Pancake giấu CREATIVE ads (ảnh+caption) =====
    try {
      const adMsg = (data.messages || []).find(m => (m.attachments || []).some(a => a && a.type === "ad_click"));
      if (adMsg) RDBG && console.log("[reader] AD MSG FULL:", JSON.stringify(adMsg).slice(0, 700));
      if (data.post) RDBG && console.log("[reader] data.post:", JSON.stringify(data.post).slice(0, 700));
      const sp = Array.isArray(data.suggested_posts) ? data.suggested_posts : [];
      const spr = Array.isArray(data.suggested_products) ? data.suggested_products : [];
      if (sp.length) RDBG && console.log("[reader] suggested_posts[0] FULL:", JSON.stringify(sp[0]).slice(0, 700));
      if (spr.length) RDBG && console.log("[reader] suggested_products[0] FULL:", JSON.stringify(spr[0]).slice(0, 700));
    } catch (_) {}
    try { RDBG && console.log("[reader] AD final:", JSON.stringify({ adId: String(adId).slice(0, 40), marker: _hasAdMarker, adClickId: _adClickId, adPostId: _adPostId, replyFbid: (_replyFbid || "").slice(0, 20), capCands: _capCands.length, cap0: (_capCands[0] && _capCands[0].text || "").slice(0, 45), imgs: postImages.length }).slice(0, 340)); } catch (_) {}
  }

  // ===== ADS / BÀI VIẾT qua data.activities =====
  // CẢNH BÁO: activities là MỌI bài khách từng tương tác -> "mới nhất" KHÔNG chắc là bài khách vừa bấm.
  // -> KHÔNG đoán mò. Chỉ bật khi ADS_FROM_ACTIVITIES=1 (tạm thời), mặc định TẮT để không báo sai mẫu.
  if (!fromAd && process.env.ADS_FROM_ACTIVITIES === "1") {
    const acts = (Array.isArray(data.activities) ? data.activities : [])
      .filter(a => a && String(a.source || "").toUpperCase() === "POST" && a.post_id);
    if (acts.length) {
      acts.sort((a, b) => new Date(a.inserted_at || 0) - new Date(b.inserted_at || 0));
      const last = acts[acts.length - 1];
      const imgs = (last.attachments && Array.isArray(last.attachments.data))
        ? last.attachments.data.filter(x => x.type === "photo" && x.url).map(x => x.url) : [];
      fromAd = true;
      adId = adId || String(last.post_id);
      adTitle = adTitle || String(last.message || "");
      adPhotoUrl = adPhotoUrl || imgs[0] || null;
      if (imgs.length) postImages.push(...imgs);
      try { RDBG && console.log("[reader] AD via activities (ĐOÁN, có thể sai):", JSON.stringify({ adId, imgs: imgs.length }).slice(0, 200)); } catch (_) {}
    }
  }
  // DEBUG khoá-bài: dump FULL 6 tin gần nhất (tìm link "(Xem bài viết)"/post_id/story trên tin nào).
  try {
    const msgs6 = (data.messages || []).slice(-6);
    for (const m of msgs6) {
      const who = String(m?.from?.id || "") === String(PID) ? "SHOP" : "KHÁCH";
      RDBG && console.log(`[reader] FULLMSG ${who}:`, JSON.stringify(m).slice(0, 1100));
    }
  } catch (_) {}
  // CHẨN ĐOÁN: chưa bắt được ad -> DUMP activities + độ dài các field ads để khoá nguồn "trả lời bài viết".
  if (!fromAd) {
    try {
      RDBG && console.log("[reader] no-ad | lengths:",
        "ad_clicks=" + (Array.isArray(data.ad_clicks) ? data.ad_clicks.length : typeof data.ad_clicks),
        "sug_posts=" + (Array.isArray(data.suggested_posts) ? data.suggested_posts.length : typeof data.suggested_posts),
        "sug_prods=" + (Array.isArray(data.suggested_products) ? data.suggested_products.length : typeof data.suggested_products),
        "post=" + (data.post ? "obj" : data.post));
      const acts = Array.isArray(data.activities) ? data.activities : [];
      RDBG && console.log("[reader] activities len=" + acts.length);
      for (const a of acts.slice(-4)) {
        try { RDBG && console.log("[reader] ACT:", JSON.stringify(a).slice(0, 600)); } catch (_) {}
      }
    } catch (_) {}
  }

  // CHẨN ĐOÁN luôn-bật (chỉ tin ad): cho thấy ad có những NGUỒN dữ liệu nào để lấy caption/ảnh.
  if (fromAd) try {
    const _ac = Array.isArray(data.ad_clicks) ? data.ad_clicks.length : 0;
    const _sp = Array.isArray(data.suggested_posts) ? data.suggested_posts.length : 0;
    const _spr = Array.isArray(data.suggested_products) ? data.suggested_products.length : 0;
    console.log(`[AD SRC] adId=${adId} | ad_clicks=${_ac} sug_posts=${_sp} sug_prods=${_spr} | adPostId=${_adPostId || "-"} repliedId=${_replyFbid || (_adRepliedPfbid ? "pfbid" : "-")} capCands=${_capCands.length} titleLen=${(adTitle || "").length} imgs=${postImages.length} photo=${adPhotoUrl ? "có" : "-"}`);
  } catch (_) {}

  return {
    conversationId,
    customerName:
      data?.conv_from?.name || data?.customers?.[0]?.name || "UNKNOWN",
    postId: post ? post.id : (data.post_id || null),
    postCaption: post ? String(post.message || "") : "",
    postImages,
    privateReplyId,
    canReplyPrivately,
    canInbox: data.can_inbox === true,
    customerPsid: psid,
    inboxConversationId,
    fromAd,
    adId,
    adTitle,
    adPhotoUrl,
    adCaptionCandidates: _capCands.map(c => c.text),
    adPostId: _adPostId,
    adRepliedPostId: _replyFbid || null,   // id SỐ bài khách vừa trả lời (nếu FB cho) -> đọc lại được
    adRepliedPfbid: _adRepliedPfbid || null, // link pfbid (không gọi lại API được) -> ghi chú người thật
    messages: normalizeMessages(data.messages || [], PID)
  };
}

// ===== ĐỌC THẺ TƯƠI của 1 hội thoại (cho PRE-SEND RE-CHECK chống race gắn-thẻ-trễ) =====
// Cổng chặn theo thẻ ở bot chạy trên ẢNH CHỤP list đầu vòng poll; nếu người thật gắn
// "AI-CHỜ XL" SAU khi conv đã được bốc lên xử -> câu đã lọt cổng vẫn gửi. Hàm này đọc LẠI
// thẻ ngay trước lúc gửi. Trả về: MẢNG id thẻ (số) nếu đọc được; null nếu KHÔNG đọc được
// (caller sẽ KHÔNG chặn -> giữ nguyên hành vi cũ, không gây hồi quy).
function _tagIdsFromObj(obj) {
  if (!obj || typeof obj !== "object") return [];
  const out = new Set();
  const push = v => {
    if (v == null) return;
    if (typeof v === "object") { const id = v.id != null ? v.id : v.tag_id; if (id != null) out.add(Number(id)); }
    else { const n = Number(v); if (!Number.isNaN(n)) out.add(n); }
  };
  for (const f of ["tags", "tag_ids", "conversation_tags"]) if (Array.isArray(obj[f])) obj[f].forEach(push);
  if (Array.isArray(obj.tag_histories)) {
    for (const h of obj.tag_histories) {
      if (h && h.tag_id != null && h.removed !== true && h.is_removed !== true) out.add(Number(h.tag_id));
    }
  }
  return [...out].filter(n => !Number.isNaN(n));
}

async function fetchConversationTags(conversationId, pageIdHint) {
  try {
    const pid = pageIdHint || reg.pageIdFromConv(conversationId) || PAGE_ID;
    const token = reg.tokenForConv(conversationId) || PAGE_TOKEN;
    if (!pid || !token || !conversationId) return null;
    const base = `https://pages.fm/api/public_api/v1/pages/${pid}/conversations/${conversationId}`;
    // Thử endpoint /tags trước (nhẹ), rồi tới object hội thoại. Payload Pancake nhiều kiểu -> bóc rộng.
    for (const url of [`${base}/tags?page_access_token=${token}`, `${base}?page_access_token=${token}`]) {
      _req("tag-recheck");
      let data = null;
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        data = await r.json().catch(() => null);
      } catch (_) { continue; }
      if (!data) continue;
      const cand = data.conversation || data.data || data;
      let ids = _tagIdsFromObj(cand);
      if (!ids.length && Array.isArray(data.tags)) ids = _tagIdsFromObj({ tags: data.tags });
      if (ids.length) return ids;
      // Payload hợp lệ nhưng KHÔNG có thẻ -> coi là "đã đọc, sạch thẻ" (mảng rỗng).
      if (cand && (cand.id != null || cand.conversation_id != null)) return [];
    }
    return null;
  } catch (_) { return null; }
}

module.exports = {
  getConversations,
  getMessages,
  readConversation,
  normalizeMessages,
  fetchConversationTags
};
