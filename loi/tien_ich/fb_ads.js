const __goc = require("path").join(__dirname, "..", "..");
// ===== ĐỌC NỘI DUNG QUẢNG CÁO QUA FACEBOOK GRAPH API (nhiều ngả + token THEO PAGE) =====
// Mục tiêu: BÀI AD NÀO CŨNG RA ẢNH + CAPTION, cho MỌI PAGE, không cần map tay.
//
// TOKEN (loại FACEBOOK, dạng EAA...  KHÔNG phải token Pancake eyJ... trong pages.json):
//   Ưu tiên lấy theo thứ tự:
//     1) Biến môi trường  FB_ADS_TOKEN_<pageId>   (vd FB_ADS_TOKEN_615738195133683=EAA...)
//     2) File  fb_ads_tokens.json  = { "<pageId>": "EAA...", ... }
//     3) FB_ADS_TOKEN               (token CHUNG - dùng khi mọi page chung 1 Business Manager)
//   -> Có token riêng cho page nào thì dùng riêng; không có thì lùi về token chung.
//   Nếu 1 System User token của BM bao hết page/tài khoản QC -> chỉ cần đặt FB_ADS_TOKEN là đủ.
//
// CÁCH ĐỌC (thử lần lượt, 1 ngả ra ảnh/caption là đủ):
//   1) AD OBJECT   /{adId}?fields=...creative{...}
//   2) POST/STORY  /{storyId}?fields=full_picture,message,attachments{...}   (bắt cả DARK POST)
//   3) POST id truyền vào (opts.postId)  khi ad object thiếu quyền
//   4) EDGE /{adId}/adcreatives
//
// Interface: fetchAdCreative(adId[, opts]) -> { adName, caption:[...], images:[...] } | { error } | null
//   opts: { postId, pageId }   (nên truyền cả hai từ bot_worker)
const https = require("https");
const fs = require("fs");
const path = require("path");
try { require("dotenv").config(); } catch (_) {}

const VER = "v21.0";
const _cache = new Map();              // key -> { at, data }
const TTL = 6 * 60 * 60 * 1000;        // 6h

// ---- Token theo page ----
let _fileTokens = {};
try {
  const p = path.join(__goc, "fb_ads_tokens.json");
  if (fs.existsSync(p)) _fileTokens = JSON.parse(fs.readFileSync(p, "utf8")) || {};
} catch (_) { _fileTokens = {}; }

function tokenForPage(pageId) {
  const pid = String(pageId || "");
  if (pid && process.env["FB_ADS_TOKEN_" + pid]) return process.env["FB_ADS_TOKEN_" + pid];
  if (pid && _fileTokens[pid]) return _fileTokens[pid];
  return process.env.FB_ADS_TOKEN || "";
}
// Có BẤT KỲ token nào cấu hình không (để bot_worker biết có nên gọi API).
function hasToken() {
  if (process.env.FB_ADS_TOKEN) return true;
  if (_fileTokens && Object.keys(_fileTokens).length) return true;
  for (const k of Object.keys(process.env)) if (k.startsWith("FB_ADS_TOKEN_")) return true;
  return false;
}

// Chuẩn hoá chữ bold/italic Unicode (𝐆𝐈𝐀𝐍𝐍𝐀𝐋 -> GIANNAL) + gom khoảng trắng.
function norm(s) { return String(s == null ? "" : s).normalize("NFKC").replace(/\s+/g, " ").trim(); }

function _get(url) {
  return new Promise((resolve) => {
    https.get(url, (r) => {
      let b = "";
      r.on("data", d => b += d);
      r.on("end", () => { try { resolve(JSON.parse(b)); } catch (_) { resolve(null); } });
    }).on("error", () => resolve(null));
  });
}
function _node(id, fields, token) {
  const url = `https://graph.facebook.com/${VER}/${encodeURIComponent(String(id))}`
    + `?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
  return _get(url);
}

const F_AD =
  "name,creative{name,title,body,image_url,thumbnail_url,"
  + "effective_object_story_id,object_story_id,"
  + "object_story_spec{link_data{message,name,caption,picture,child_attachments{picture,name,description}},photo_data{url},video_data{message,title}},"
  + "asset_feed_spec{bodies{text},titles{text},images{url}}}";
const F_CREATIVE =
  "name,title,body,image_url,thumbnail_url,effective_object_story_id,object_story_id,"
  + "object_story_spec{link_data{message,name,caption,picture,child_attachments{picture,name,description}},photo_data{url},video_data{message,title}},"
  + "asset_feed_spec{bodies{text},titles{text},images{url}}";
const F_POST =
  "message,full_picture,name,description,caption,"
  + "attachments{title,description,media{image{src}},subattachments{media{image{src}},description,title}}";

function _collectFromCreative(cr, imgSet, capArr) {
  if (!cr) return null;
  const oss = cr.object_story_spec || {};
  const ld = oss.link_data || {};
  const pd = oss.photo_data || {};
  const vd = oss.video_data || {};
  const afs = cr.asset_feed_spec || {};
  const pushImg = (u) => { if (u && /^https?:\/\//i.test(u)) imgSet.add(u); };
  pushImg(cr.image_url); pushImg(ld.picture); pushImg(pd.url);
  for (const ch of (ld.child_attachments || [])) pushImg(ch.picture);
  for (const im of (afs.images || [])) pushImg(im.url);
  if (cr.thumbnail_url) imgSet.add("__THUMB__" + cr.thumbnail_url);
  const pushCap = (t) => { t = norm(t); if (t && t.length >= 3 && !capArr.includes(t)) capArr.push(t); };
  pushCap(cr.body); pushCap(ld.message); pushCap(vd.message);
  pushCap(cr.title); pushCap(ld.name); pushCap(ld.caption);
  for (const ch of (ld.child_attachments || [])) { pushCap(ch.name); pushCap(ch.description); }
  for (const b of (afs.bodies || [])) pushCap(b.text);
  for (const t of (afs.titles || [])) pushCap(t.text);
  return cr.effective_object_story_id || cr.object_story_id || null;
}
function _collectFromPost(p, imgSet, capArr) {
  if (!p) return;
  const pushImg = (u) => { if (u && /^https?:\/\//i.test(u)) imgSet.add(u); };
  const pushCap = (t) => { t = norm(t); if (t && t.length >= 3 && !capArr.includes(t)) capArr.push(t); };
  pushImg(p.full_picture);
  pushCap(p.message); pushCap(p.name); pushCap(p.description); pushCap(p.caption);
  const atts = (p.attachments && p.attachments.data) || [];
  for (const a of atts) {
    pushCap(a.title); pushCap(a.description);
    if (a.media && a.media.image) pushImg(a.media.image.src);
    const subs = (a.subattachments && a.subattachments.data) || [];
    for (const s of subs) {
      pushCap(s.title); pushCap(s.description);
      if (s.media && s.media.image) pushImg(s.media.image.src);
    }
  }
}
function _finalizeImages(imgSet) {
  const real = [], thumb = [];
  for (const u of imgSet) { if (u.startsWith("__THUMB__")) thumb.push(u.slice(9)); else real.push(u); }
  return [...real, ...thumb.filter(t => !real.includes(t))];
}

async function fetchAdCreative(adId, opts = {}) {
  const pageId = opts && opts.pageId ? String(opts.pageId) : "";
  const token = tokenForPage(pageId);
  if (!token) return null;                       // page này chưa có token FB -> bỏ qua (không lỗi)
  const postHint = opts && opts.postId ? String(opts.postId) : "";
  if (!adId && !postHint) return null;

  const key = "p:" + pageId + "|ad:" + String(adId || "") + "|post:" + postHint;
  const c = _cache.get(key);
  if (c && Date.now() - c.at < TTL) return c.data;

  const imgSet = new Set();
  const capArr = [];
  let adName = "";
  let storyId = null;
  let lastErr = "";
  // [FIX 2026-07-07] Ad id THẬT của FB Marketing luôn dạng 120xxxxxxxxxxxxxxx. Post/story id (vd
  //   1577599117254914) mà nhét vào endpoint AD OBJECT sẽ dính lỗi "(#12) singular statuses API is
  //   deprecated" -> mất luôn adName (mã mẫu trong tên ad). Phân loại đúng: id không phải 120... thì
  //   coi là POST và đọc thẳng bài (thử cả dạng pageId_postId vì Graph hay đòi id ghép cho page post).
  const _isRealAdId = (x) => /^120\d{12,}$/.test(String(x || ""));
  const isAdLike = adId && _isRealAdId(adId);
  const _postFallback = (adId && !_isRealAdId(adId) && /^\d{6,}$/.test(String(adId))) ? String(adId) : "";

  // 1) AD OBJECT (chỉ với ad id THẬT)
  if (isAdLike) {
    const j = await _node(adId, F_AD, token);
    if (j && j.error) lastErr = j.error.message || "ad read fail";
    else if (j) {
      adName = norm(j.name || (j.creative && j.creative.name) || "");
      storyId = _collectFromCreative(j.creative, imgSet, capArr) || storyId;
    }
  }
  // 2/3) POST/STORY trực tiếp (bắt DARK POST / khi ad object thiếu quyền / id truyền vào là post)
  const postToRead = storyId || postHint || _postFallback;
  if (postToRead) {
    let p = await _node(postToRead, F_POST, token);
    if ((!p || p.error) && pageId && !String(postToRead).includes("_")) {
      // Graph hay đòi id GHÉP pageId_postId cho bài của page -> thử lại dạng ghép.
      p = await _node(pageId + "_" + postToRead, F_POST, token);
    }
    if (p && p.error) { if (!lastErr) lastErr = p.error.message || "post read fail"; }
    else if (p) { _collectFromPost(p, imgSet, capArr); if (!storyId) storyId = p.id || String(postToRead); }
  }
  // 4) EDGE /adcreatives
  if (isAdLike && _finalizeImages(imgSet).length === 0) {
    const e = await _node(`${adId}/adcreatives`, F_CREATIVE, token);
    const rows = (e && e.data) || [];
    for (const cr of rows) {
      if (!adName) adName = norm(cr.name || "");
      const sid = _collectFromCreative(cr, imgSet, capArr);
      if (sid && sid !== postToRead) {
        const p2 = await _node(sid, F_POST, token);
        if (p2 && !p2.error) _collectFromPost(p2, imgSet, capArr);
      }
    }
    if (e && e.error && !lastErr) lastErr = e.error.message || "adcreatives fail";
  }

  const images = _finalizeImages(imgSet);
  // adName (chứa MÃ MẪU theo quy ước đặt tên ad) và storyId (bài creative THẬT) tự nó đã quý ->
  // có 1 trong 4 thứ là coi như thành công, đừng vứt vì thiếu ảnh.
  const data = (images.length || capArr.length || adName || storyId)
    ? { adName, caption: capArr, images, storyId: storyId || null }
    : { error: lastErr || "no creative" };
  _cache.set(key, { at: Date.now(), data });
  return data;
}

// ===== [SỔ BÀI ADS 2026-07-07] Quét TOÀN BỘ ads của (các) TÀI KHOẢN QUẢNG CÁO =====
// Tên ad theo quy ước "MÃMẪU-postid-..." -> mỗi ad trả đủ: ad id thật + tên (chứa mã) + bài creative
// thật (effective_object_story_id). Worker bóc mã ghi map TRƯỚC KHI khách bấm -> lượt webhook chỉ có
// story_fbid cũng tra trúng ngay, khỏi chờ metadata Pancake, khỏi vision. Chỉ cần quyền ads_read.
// Tài khoản đọc từ: env FB_ADS_ACCOUNT_IDS="act_111,act_222" HOẶC file fb_ads_accounts.json ["act_111",...]
function adsAccountIds() {
  const out = [];
  const envS = String(process.env.FB_ADS_ACCOUNT_IDS || "").trim();
  if (envS) for (const x of envS.split(/[,;\s]+/)) if (x) out.push(x);
  try {
    const p = path.join(__goc, "fb_ads_accounts.json");
    if (fs.existsSync(p)) {
      const arr = JSON.parse(fs.readFileSync(p, "utf8"));
      if (Array.isArray(arr)) for (const x of arr) if (x && !String(x).startsWith("_")) out.push(String(x));
    }
  } catch (_) {}
  return [...new Set(out.map(x => String(x).trim()).filter(Boolean))];
}
async function syncAdsMap() {
  const accounts = adsAccountIds();
  if (!accounts.length) return { ok: false, reason: "chưa cấu hình FB_ADS_ACCOUNT_IDS / fb_ads_accounts.json", ads: [] };
  const token = process.env.FB_ADS_TOKEN || Object.values(_fileTokens)[0] || "";
  if (!token) return { ok: false, reason: "chưa có token", ads: [] };
  const ads = [];
  for (const acc of accounts) {
    const accId = String(acc).startsWith("act_") ? String(acc) : "act_" + String(acc);
    let url = `https://graph.facebook.com/${VER}/${accId}/ads?fields=id,name,effective_status,creative{effective_object_story_id,object_story_id}&limit=200&access_token=${encodeURIComponent(token)}`;
    let guard = 0, got = 0;
    while (url && guard < 10) {   // tối đa 10 trang (2000 ads)/tài khoản — chống lặp vô hạn
      guard++;
      const j = await _get(url);
      if (!j || j.error) { console.log(`[ADS SYNC] ${accId} LỖI: ${(j && j.error && j.error.message) || "fetch fail"}`); break; }
      for (const ad of (j.data || [])) {
        const cr = ad.creative || {};
        ads.push({
          adId: String(ad.id || ""),
          name: norm(ad.name || ""),
          storyId: String(cr.effective_object_story_id || cr.object_story_id || "") || null,
          status: String(ad.effective_status || "")
        });
        got++;
      }
      url = (j.paging && j.paging.next) || null;
    }
    console.log(`[ADS SYNC] ${accId}: đọc được ${got} ads.`);
  }
  return { ok: true, ads };
}

module.exports = { fetchAdCreative, norm, hasToken, tokenForPage, syncAdsMap, adsAccountIds };
