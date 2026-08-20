require("./env_boot");   // nạp .env theo BOT_ENV (thật/thử) — phải ở dòng đầu
const turnLog = require("./turn_log");   // log có cấu trúc mỗi lượt (nền cho mục 9.4 + 9.5)

console.log("[BUILD] patched-2026-07-01: inspect-đuôi-linh-hoạt + regex ktra/đk + nhãn INSPECT_REQUEST/TRYON_REQUEST + price PRICE_OBJECTION 2 câu");

const { getConversations, readConversation, getMessages, normalizeMessages, fetchConversationTags } = require("./pancake_reader");
const { extractTagIds: _extractTagIds } = require("./conversation_tags");   // đọc thẻ ROBUST (tags/tag_ids/conversation_tags/tag_histories)
const fbAds = require("./fb_ads");   // đọc creative ad qua Marketing API (vision/caption/mã từ tên)
const _watchReadAt = new Map();   // throttle đọc tin cho [THEO DÕI] (60s/id)

// ===== [WEBHOOK] kéo conv_id tin mới từ server nhận webhook (Pancake đẩy real-time) =====
// Đặt 2 biến trong .env:  WEBHOOK_PULL_URL=https://hook.nysaki.vn/pull   WEBHOOK_PULL_TOKEN=...
const _WEBHOOK_PULL_URL   = process.env.WEBHOOK_PULL_URL   || "";
const _WEBHOOK_PULL_TOKEN = process.env.WEBHOOK_PULL_TOKEN || "";
async function pullWebhookIds() {
  if (!_WEBHOOK_PULL_URL) return [];
  try {
    const sep = _WEBHOOK_PULL_URL.includes("?") ? "&" : "?";
    const url = `${_WEBHOOK_PULL_URL}${sep}token=${encodeURIComponent(_WEBHOOK_PULL_TOKEN)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.ids) ? j.ids.map(String).filter(Boolean) : [];
  } catch (e) { return []; }
}
const { getAgentRuleMap } = require("./knowledge_loader");
const { sendInboxMessage: _sendInboxMessage, replyComment: _replyComment, sendPrivateReply: _sendPrivateReply, sendInboxImages: _sendInboxImages, sendInboxContentIds: _sendInboxContentIds, sendInboxImageUrl: _sendInboxImageUrl, sendInboxImageUrls: _sendInboxImageUrls, sendInboxMessageWithImages: _sendInboxMessageWithImages, tagChoXuLyVaUnread, tagXuLyAnh, tagXuLyAnhVaUnread, untagXuLyAnh, tagDonUuTienVaUnread, tagGuiDonGap, tagAiChot, addConversationNote, delay } = require("./pancake_sender");

// Lưu id mọi tin bot gửi -> để phân biệt tin của BOT với tin NGƯỜI THẬT (cùng danh nghĩa Page).
const botSentIds = new Set();
function rememberSentId(res) {
  try {
    if (res && res.id) {
      botSentIds.add(String(res.id));
      if (botSentIds.size > 1500) {
        const keep = [...botSentIds].slice(-800);
        botSentIds.clear();
        keep.forEach(x => botSentIds.add(x));
      }
    }
  } catch (_) {}
}
// Bớt "Dạ" đầu câu cho đỡ robot: đang nói chuyện liên tục nên cách câu mới mở "Dạ",
// còn lại vào thẳng nội dung (vẫn lịch sự). Áp tự động cho mọi tin gửi đi.
const _daCounter = new Map();
function maybeDropDa(target, text) {
  const s = String(text || "");
  if (!/^Dạ\s/i.test(s)) return s;
  const n = (_daCounter.get(target) || 0) + 1;
  _daCounter.set(target, n);
  if (n % 2 === 0) {                       // ~ một nửa số câu bỏ "Dạ"
    const rest = s.replace(/^Dạ\s+/i, "");
    return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : s;
  }
  return s;
}
// KHÔNG BAO GIỜ để lộ thông tin tồn kho nội bộ ra cho khách: "(bán nốt tồn)", "nốt tồn", "xả tồn"...
// CẮT MỌI GHI CHÚ TRONG NGOẶC ĐƠN (...) khỏi tin gửi khách: ngoặc đơn trong dữ liệu mẫu/câu mẫu
// đều là GHI CHÚ NỘI BỘ (vd "(mặc nguyên bộ, không phải set rời)", "(gồm các món mặc cùng nhau)").
// KHÔNG bao giờ đọc cho khách.
function stripParenNotes(text) {
  if (!text) return text;
  return String(text)
    .replace(/\s*\([^)]*\)/g, "")        // bỏ mọi cụm (...)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/\s+ạ\b/g, " ạ")
    .trim();
}
// Lọc TỰ ĐỘNG cho MỌI tin gửi đi (bất kể nguồn: AI, mô tả màu, câu mẫu...).
function stripStockClearance(text) {
  if (!text) return text;
  return String(text)
    .replace(/\s*\(([^)]*?(bán nốt|nốt tồn|hàng tồn|xả tồn|tồn kho|bán tồn|thanh lý|clear|sale tồn|hết hàng dần)[^)]*?)\)/gi, "")
    .replace(/[,;–-]?\s*(bán nốt tồn|bán nốt|nốt tồn|hàng tồn|xả tồn|tồn kho|bán tồn|thanh lý hàng tồn|sale tồn)/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/,\s*,/g, ",").replace(/,\s*\./g, ".").replace(/\(\s*\)/g, "")
    .trim();
}
// GỌN CHỮ ĐỆM: tránh chồng "nha/nhe/nhé" + "ạ" (vd "chị nha ạ" -> "chị ạ"); bỏ lặp "ạ ạ", "nha nha".
function tidyParticles(text) {
  if (!text) return text;
  let s = String(text);
  // "... nha/nhe/nhé ạ"  ->  "... ạ"   (giữ "ạ", bỏ "nha/nhe/nhé" đứng ngay trước)
  s = s.replace(/(^|[\s,])(nha|nhe|nhé)\s+ạ(?=$|[\s.!?,💕])/gi, "$1ạ");
  // "... ạ nha/nhé"  ->  "... ạ"
  s = s.replace(/(^|[\s,])ạ\s+(nha|nhe|nhé)(?=$|[\s.!?,💕])/gi, "$1ạ");
  // lặp "ạ ạ" / "nha nha"
  s = s.replace(/(^|[\s,])ạ(\s+ạ)+(?=$|[\s.!?,💕])/gi, "$1ạ");
  s = s.replace(/(^|[\s,])(nha)(\s+nha)+(?=$|[\s.!?,💕])/gi, "$1nha");
  return s.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
}
// Bỏ TỪ SIZE LẶP trong cùng 1 câu (vd "Féline freesize màu vàng freesize" -> giữ 1 "freesize").
function stripRepeatedSizeWords(text) {
  if (!text) return text;
  return String(text).split(/([.!?\n]+)/).map(seg => {
    if (/^[.!?\n]+$/.test(seg)) return seg;
    const seen = new Set();
    seg = seg.replace(/\b(free\s*size|size\s+[smlx]+)\b/gi, m => {
      const key = m.toLowerCase().replace(/\s+/g, "");
      if (seen.has(key)) return "\u0000";
      seen.add(key); return m;
    });
    return seg.replace(/\s*\u0000\s*/g, " ");
  }).join("")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+,/g, ",").replace(/,\s*,/g, ",").replace(/,\s*([.!?])/g, "$1")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
}
let _turnCtx = null;   // ngữ cảnh lượt hiện tại để tự hẹn follow-up: { convId, mem, productInfo }
// ===== ICON LINH HOẠT: xoay vòng nhiều icon ấm (không phải lúc nào cũng), và để THƯA cho đỡ nhàm =====
// Chỉ thêm icon nếu câu GỐC vốn có icon (giữ đúng ý câu nào cần / không cần). Đếm theo từng hội thoại.
const _heartCtr = new Map();
const _WARM_EMOJIS = ["", "", "", "", "", "", ""];
function throttleHearts(target, text) {
  const n = (_heartCtr.get(target) || 0) + 1;
  _heartCtr.set(target, n);
  if (!text) return text;
  const hadEmoji = /[💕🥰😘💖❤️😍🌸✨]/.test(text);
  // Bỏ MỌI icon ấm trong câu (kể cả//...) rồi cân nhắc thêm lại 1 cái XOAY VÒNG ở cuối.
  const stripped = String(text)
    .replace(/\s*[]+/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
  if (!hadEmoji) return stripped;          // câu gốc không có icon -> KHÔNG tự thêm
  if (n % 3 === 0) return stripped;        // ~1/3 tin để trống cho đỡ dày icon
  const pick = _WARM_EMOJIS[n % _WARM_EMOJIS.length];   // xoay vòng -> mỗi lần một icon khác
  return `${stripped} ${pick}`;
}
// Nhận diện câu "báo chờ / em kiểm tra rồi báo" = nhường người thật. THEO YÊU CẦU SHOP: KHÔNG gửi câu này cho khách
// (chỉ gắn thẻ AI-CHỜ XL ở nơi khác là đủ), tránh lặp "chờ đợi" gây nhàm. Câu xin lỗi/khẳng định khác KHÔNG dính.
function isWaitHandoffMsg(text) {
  const t = String(text || "").toLowerCase();
  // "kiểm tra SIZE / FORM / fit" = câu TƯ VẤN hợp lệ (xin cao/nặng để tư vấn) -> KHÔNG coi là báo-chờ.
  if (/(kiểm tra|kiem tra)\s*(lại\s*)?(size|form|fit|vừa)/.test(t)) return false;
  if (/(chờ|đợi)\s*(em|chị|chi|anh|mình|minh|1 lát|một lát|1 lat|mot lat)?.{0,30}(kiểm tra|kiem tra)/.test(t)) return true;
  if (/(kiểm tra|kiem tra).{0,45}(rồi|roi)\s*(em\s*)?(báo|bao)\b/.test(t)) return true;
  if (/(để em|de em)\s*(kiểm tra|kiem tra)\s*(lại\s*)?(đơn|hàng|thông tin|thong tin|giúp|dùm|giùm)/.test(t)) return true;
  return false;
}

// Câu trả lời có đang XIN SĐT/ĐỊA CHỈ không (để chặn khi chưa có size).
function _asksContactInReply(s) {
  const t = String(s || "").toLowerCase();
  if (!/(số điện thoại|sđt|địa chỉ)/.test(t)) return false;
  return /(cho em xin|vui lòng cho em xin|gửi em|cho em|xin)\s*[^.?!]{0,30}(số điện thoại|sđt|địa chỉ)|(số điện thoại|sđt)\s*(và|,)?\s*(địa chỉ| nhận hàng)/.test(t);
}
const _dupSentBook = new Map();   // [CHỐT CHẶN TIN TRÙNG] convId -> [{norm, at}...] 5 câu gần nhất (chuẩn hoá)
const _ctaSentBook = new Map();   // [GIÃN CTA] convId -> thời điểm gửi câu xin contact gần nhất
// [FIX Trang Nguyen 2026-07-11] Sổ trùng nằm RAM -> RESTART (deploy) là mất sạch -> tin cũ bị xử lại sau
// restart thì câu giống hệt vẫn bắn lần 2. -> Ghi sổ xuống ĐĨA (bot_dup_sent.json), nạp lại khi khởi động.
const _DUP_BOOK_PATH = require("path").join(__dirname, "bot_dup_sent.json");
try {
  const _raw = JSON.parse(require("fs").readFileSync(_DUP_BOOK_PATH, "utf8"));
  const _cut = Date.now() - 30 * 60 * 1000;   // chỉ nạp bản ghi 30 phút gần nhất
  for (const k of Object.keys(_raw || {})) {
    const v = _raw[k];
    const list = (Array.isArray(v) ? v : [v]).filter(e => e && e.at > _cut);   // tương thích file cũ 1 ngăn
    if (list.length) _dupSentBook.set(k, list);
  }
  if (_dupSentBook.size) console.log(`[gửi tin] nạp lại sổ chống-trùng: ${_dupSentBook.size} hội thoại (qua restart không mất).`);
} catch (_) {}
let _dupSaveT = 0;
function _dupBookSave() {
  try {
    if (Date.now() - _dupSaveT < 3000) return;   // ghi thưa, tránh spam đĩa
    _dupSaveT = Date.now();
    const o = {}; const _cut = Date.now() - 30 * 60 * 1000;
    for (const [k, v] of _dupSentBook) {
      const list = (Array.isArray(v) ? v : [v]).filter(e => e && e.at > _cut);
      if (list.length) o[k] = list;
    }
    require("fs").writeFileSync(_DUP_BOOK_PATH, JSON.stringify(o));
  } catch (_) {}
}
async function sendInboxMessage(target, text) {
  // BỎ câu báo-chờ (AI không trả lời được) -> chỉ gắn thẻ, không nhắn khách. Thẻ AI-CHỜ XL gắn ở handler riêng nên không ảnh hưởng.
  if (isWaitHandoffMsg(text)) {
    try { console.log("  [gửi tin] BỎ câu báo-chờ (nhường người thật) -> KHÔNG nhắn khách:", String(text).slice(0, 55)); } catch (_) {}
    return { success: true, skipped: "WAIT_HANDOFF" };
  }
  // ===== [SALE GỌN - trình bày 3 dòng] Chèn xuống dòng sau câu chương trình để tách đuôi hỏi size:
  //   Dòng 1: "Dạ {tên} có giá X, đang giảm còn Y chị nha 🥰"
  //   Dòng 2: "{câu chương trình} ạ."
  //   Dòng 3: "{đuôi hỏi size/CTA}"
  try {
    const _sgF = saleProgram(_curPageId);
    if (_sgF && _sgF.che_do_sale_gon && _sgF.cau_kem_bao_gia && String(text || "").includes(_sgF.cau_kem_bao_gia)) {
      text = String(text).split(_sgF.cau_kem_bao_gia + " ạ. ").join(_sgF.cau_kem_bao_gia + " ạ.\n");
    }
  } catch (_) {}
  // ===== [CHỐT CHẶN TIN TRÙNG 2026-07-07, nâng 5 NGĂN 2026-07-11 - ca Móm Yêu] =====
  // Trước chỉ nhớ 1 câu gần nhất/hội thoại -> câu lặp CÁCH QUÃNG (có câu khác chen giữa) lọt lưới
  // ("size M vừa xinh" bắn 2 lần). Giờ nhớ 5 câu gần nhất trong 10 phút: trùng bất kỳ ngăn nào -> BỎ.
  try {
    const _dupKey = String(target);
    const _dupNorm = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/^da\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
    let _dupList = _dupSentBook.get(_dupKey);
    if (_dupList && !Array.isArray(_dupList)) _dupList = [_dupList];   // tương thích sổ cũ 1 ngăn (file đĩa cũ)
    _dupList = (_dupList || []).filter(e => e && (Date.now() - e.at) < 10 * 60 * 1000);
    const _dupHit = _dupNorm.length >= 10 && _dupList.find(e => e.norm === _dupNorm && (Date.now() - e.at) < 8 * 60 * 1000);
    if (_dupHit) {
      console.log(`  [gửi tin] ⛔ TRÙNG câu đã gửi ${Math.round((Date.now() - _dupHit.at) / 1000)}s trước (sổ 5 ngăn) -> BỎ, không nhắn lặp: "${String(text).slice(0, 50)}"`);
      return { success: true, skipped: "DUPLICATE" };
    }
    _dupList.push({ norm: _dupNorm, at: Date.now() });
    while (_dupList.length > 5) _dupList.shift();
    _dupSentBook.set(_dupKey, _dupList);
    if (_dupSentBook.size > 3000) { const k1 = _dupSentBook.keys().next().value; _dupSentBook.delete(k1); }
    _dupBookSave();
  } catch (_) {}
  // ===== [GIÃN CTA XIN CONTACT 2026-07-11 - ca Móm Yêu] Khách hỏi 3 mẫu liên tiếp -> 3 câu "cho em xin
  // sđt/địa chỉ" biến thể khác nhau (sổ trùng không bắt được vì KHÁC CHỮ). Luật: mỗi hội thoại tối đa
  // 1 câu CTA xin contact / 10 phút — câu sau chỉ bị CẮT PHẦN CTA (giá/tư vấn vẫn gửi); cả tin chỉ là
  // CTA -> bỏ hẳn.
  try {
    const _ctaReT = /(cho|gửi|gui)\s*em\s*xin\s*(số điện thoại|so dien thoai|sđt|sdt)|chị\s*ưng[^.?!\n]{0,40}(lên đơn|len don)/i;
    if (_ctaReT.test(String(text || ""))) {
      const _ck = String(target);
      const _cLast = _ctaSentBook.get(_ck) || 0;
      if (Date.now() - _cLast < 10 * 60 * 1000) {
        const _ctaReG = /[^.?!\n]*((cho|gửi|gui)\s*em\s*xin\s*(số điện thoại|so dien thoai|sđt|sdt)|chị\s*ưng[^.?!\n]{0,40}(lên đơn|len don))[^.?!\n]*[.?!]?/gi;
        const _stripped = String(text).replace(_ctaReG, "").replace(/\s{2,}/g, " ").trim();
        if (!_stripped || _stripped.length < 8) {
          console.log(`  [gửi tin] ⏳ CTA xin contact đã gửi ${Math.round((Date.now() - _cLast) / 1000)}s trước -> BỎ (cả tin chỉ là CTA).`);
          return { success: true, skipped: "CTA_COOLDOWN" };
        }
        console.log(`  [gửi tin] ⏳ CẮT phần CTA xin contact (đã xin ${Math.round((Date.now() - _cLast) / 1000)}s trước), giữ phần tư vấn.`);
        text = _stripped;
      } else {
        _ctaSentBook.set(_ck, Date.now());
        if (_ctaSentBook.size > 3000) { const k1 = _ctaSentBook.keys().next().value; _ctaSentBook.delete(k1); }
      }
    }
  } catch (_) {}
  // ===== PRE-SEND RE-CHECK THẺ GIỮ (chống RACE gắn-thẻ-trễ) =====
  // Cổng đầu lượt chỉ soi ẢNH CHỤP list; nếu người thật gắn "AI-CHỜ XL" (183) / thẻ giữ khác SAU khi
  // conv đã được bốc lên xử -> câu này vẫn lọt tới đây. Đọc LẠI thẻ TƯƠI ngay trước lúc gửi:
  //   - Đọc được + CÓ thẻ giữ -> KHÔNG gửi, nhường người thật (đánh dấu aiStandsOut để chặn cả follow-up).
  //   - Đọc lỗi/không chắc (null) -> KHÔNG chặn (giữ hành vi cũ, không hồi quy).
  try {
    const _pid = pageRegistry.pageIdFromConv(target) || String(target).split("_")[0];
    try { await ensureHoldTagIdsForPage(_pid, pageRegistry.tokenForConv(target)); } catch (_) {}
    const _pset = pageHoldIdSet(_pid);
    const freshIds = await fetchConversationTags(target);
    if (Array.isArray(freshIds) && freshIds.some(id => HOLD_TAG_IDS.includes(Number(id)) || (_pset && _pset.has(Number(id))))) {
      try {
        console.log("  [gửi tin] CHẶN: hội thoại VỪA có thẻ giữ (CHỜ XL/ĐƠN ƯU TIÊN/Hàng đổi/Đang hoàn) -> nhường người thật, KHÔNG gửi:", String(text).slice(0, 50));
      } catch (_) {}
      try {
        if (_turnCtx && _turnCtx.convId === target && _turnCtx.mem) {
          _turnCtx.mem.aiStandsOut = true;
          updateConversationState(target, _turnCtx.mem);
        }
      } catch (_) {}
      try { cancelFollowup(target); } catch (_) {}
      return { success: true, skipped: "HOLD_TAG_PRESEND" };
    }
  } catch (_) {}
  // QUY TẮC THỨ TỰ: mẫu CẦN size mà CHƯA có size của khách -> TUYỆT ĐỐI KHÔNG xin SĐT/địa chỉ. Hỏi size TRƯỚC.
  if (_turnCtx && _turnCtx.convId === target && _asksContactInReply(text)) {
    const _m = _turnCtx.mem, _p = _turnCtx.productInfo;
    if (_m && !_m.customerSize && orderNeedsSize(_m, _p)) {
      text = "Dạ chị thường mặc size nào để em tư vấn cho mình nha ạ";
      try { console.log("  [thứ tự] CHƯA có size -> KHÔNG xin SĐT/địa chỉ, hỏi size trước."); } catch (_) {}
    }
  }
  const cleaned = throttleHearts(target, maybeDropDa(target, tidyParticles(stripRepeatedSizeWords(stripStockClearance(stripParenNotes(text))))));
  let r;
  try { r = await _sendInboxMessage(target, cleaned); }
  catch (e) { try { console.log("  [gửi tin] Pancake trả lỗi (bỏ qua, không sập lượt):", e.message); } catch (_) {} r = { success: false, reason: "SEND_ERROR" }; }
  // [FIX Hải Kiên] Gửi FAIL (Pancake lỗi tạm / đụng album vừa gửi) mà trước đây bị nuốt âm thầm -> THỬ LẠI 1 LẦN.
  //   (Lỗi cũ: opener báo giá gửi fail nhưng log vẫn ghi "đã báo giá" -> khách không nhận được giá.)
  if (r && r.success === false && !r.skipped) {
    try { console.log("  [gửi tin] lần 1 FAIL (" + (r.reason || "?") + ") -> thử lại 1 lần sau 1.2s:", String(cleaned).slice(0, 50)); } catch (_) {}
    try { await delay(1200); } catch (_) {}
    try { r = await _sendInboxMessage(target, cleaned); }
    catch (e) { r = { success: false, reason: "SEND_ERROR_RETRY" }; }
    try { console.log("  [gửi tin] retry -> " + (r && r.success ? "OK" : "VẪN FAIL (" + ((r && r.reason) || "?") + ")")); } catch (_) {}
  }
  rememberSentId(r);
  // TỰ HẸN FOLLOW-UP: câu vừa gửi nếu là TRẢ LỜI SUÔNG (không hành động, không phải chờ-xử-lý) -> 60s nhắc.
  if (!_sendingFollowup && _turnCtx && _turnCtx.convId === target) {
    try { scheduleFollowup(target, _turnCtx.mem, _turnCtx.productInfo, cleaned); } catch (_) {}
  }
  return r;
}
async function sendInboxImages(target, urls, n) {
  let r;
  try { r = await _sendInboxImages(target, urls, n); }
  catch (e) { try { console.log("  [gửi ảnh cid] Pancake trả lỗi (bỏ qua):", e.message); } catch (_) {} return { success: false, reason: "SEND_ERROR" }; }
  if (Array.isArray(r)) r.forEach(rememberSentId); else rememberSentId(r);
  return r;
}
async function sendInboxImageUrl(target, imageUrl) {
  let r;
  try { r = await _sendInboxImageUrl(target, imageUrl); }
  catch (e) { try { console.log("  [gửi ảnh url] Pancake trả lỗi (bỏ qua):", e.message); } catch (_) {} return { success: false, reason: "SEND_ERROR" }; }
  rememberSentId(r);
  return r;
}
async function sendInboxImageUrls(target, imageUrls) {
  const r = await _sendInboxImageUrls(target, imageUrls);
  rememberSentId(r);
  return r;
}
// ===== HÀM GỬI ẢNH CHUẨN DÙNG CHUNG — gửi tối đa 3 ảnh, ĐÁNG TIN =====
// Thứ tự ĐÚNG theo API Pancake: (1) ALBUM bằng content_ids (ảnh up sẵn) = cách gửi cụm DUY NHẤT Pancake nhận
// -> (2) dự phòng: gửi LẺ từng URL (content_url đơn). Pancake KHÔNG nhận content_urls (mảng) -> bỏ.
// Chuẩn hoá link Google Drive (lh3.googleusercontent.com/d/{id}=) -> thêm kích thước để Pancake TẢI ĐƯỢC ảnh thật.
// Link kết thúc bằng "=" trống (thiếu size) là nguyên nhân Pancake tải fail -> 0/3.
function normDriveUrl(u) {
  u = String(u || "").trim();
  if (!u) return u;
  if (/lh3\.googleusercontent\.com\/d\//i.test(u) && !/=[swh]\d/.test(u)) {
    return u.replace(/=+$/, "") + "=s1600";   // ...=  ->  ...=s1600 (ảnh gốc, cạnh dài 1600)
  }
  return u;
}
// Lỗi TẠM của Pancake/FB (thread chưa mở cho media ở hội thoại MỚI, nghẽn nhịp, internal...) -> ĐÁNG thử lại.
function _isTransientSend(r0) {
  if (!r0) return false;
  if (Number(r0.e_code) === 1200 || Number(r0.e_code) === 2) return true;
  // Pancake trả lỗi ở message_code (vd "invalid_upload_fb_attachments_result") -> PHẢI đọc cả message_code.
  const msg = String((r0.message || r0.error || r0.message_code || r0.reason) || "").toLowerCase();
  return /something went wrong|try again later|temporar|timeout|rate|internal|please try|isn'?t reachable|invalid_upload_fb_attachments|fb_attachments_result|upload.*attachment|attachments_result/i.test(msg);
}
// #551 "người này hiện KHÔNG CÓ MẶT" -> retry liền vô ích; báo lên để HẸN gửi lại sau.
function _isNotAvailableSend(r0) {
  if (!r0) return false;
  if (Number(r0.e_code) === 551) return true;
  const msg = String((r0.message || r0.error) || "").toLowerCase();
  return /không có mặt|沒空|没空|isn'?t available|not available|currently unavailable|hiện không/i.test(msg);
}
// (#10) e_subcode 2018278 "tin gửi NGOÀI KHOẢNG THỜI GIAN cho phép" (ngoài cửa sổ 24h Messenger):
//  gửi MEDIA bị FB chặn theo chính sách -> retry/gửi-lẻ đều VÔ ÍCH, gửi lại nhiều lần chỉ spam.
//  -> DỪNG NGAY (không thử lại, không gửi từng tấm), đợi KHÁCH nhắn inbox mở cửa sổ rồi gửi.
// ===== [CẦU DAO ẢNH 2026-07-07] FB dở chứng ("Something went wrong...") thì MỌI tấm đều chết,
//   retry 5 lần/album × nhiều nhóm ảnh = bão retry, treo hàng đợi cả phút cho 1 khách (ca Xinh Pham).
//   -> Đếm NHÓM ảnh chết trắng liên tiếp theo PAGE: >=3 nhóm trong 5 phút -> NGẮT gửi ảnh page đó 10 phút
//   (text vẫn gửi bình thường; lớp trên tự gắn AI-XL ảnh cho người thật bổ sung). Gửi được lại -> tự reset.
const _imgBreaker = new Map();      // pageId -> untilTs (đang ngắt tới lúc nào)
const _imgFailStreak = new Map();   // pageId -> { count, at }
function _imgBreakerActive(pageId) {
  const t = _imgBreaker.get(String(pageId)) || 0;
  return t > Date.now();
}
function _imgNoteResult(pageId, allDead) {
  const pid = String(pageId);
  if (!allDead) { _imgFailStreak.delete(pid); return; }
  const s = _imgFailStreak.get(pid) || { count: 0, at: Date.now() };
  if (Date.now() - s.at > 5 * 60 * 1000) { s.count = 0; s.at = Date.now(); }   // chuỗi cũ quá 5 phút -> đếm lại
  s.count++; s.at = Date.now();
  _imgFailStreak.set(pid, s);
  if (s.count >= 3) {
    _imgBreaker.set(pid, Date.now() + 10 * 60 * 1000);
    _imgFailStreak.delete(pid);
    try { console.log(`  [ảnh] ⚡ CẦU DAO: ${s.count} nhóm ảnh chết trắng liên tiếp (FB đang chặn upload?) -> NGỪNG gửi ảnh page ${pid} trong 10 phút (text vẫn gửi, ảnh gắn AI-XL cho người thật).`); } catch (_) {}
  }
}
function _isOutsideWindowSend(r0) {
  if (!r0) return false;
  if (Number(r0.e_subcode) === 2018278) return true;
  const msg = String((r0.message || r0.error || r0.message_code || r0.reason) || "").toLowerCase();
  return /ngoài khoảng thời gian|ngoai khoang thoi gian|outside the allowed|allowed window|messaging window|不在允許期間|不在允许期间|policy-overview|messenger-platform\/policy/i.test(msg);
}
async function sendImages3(target, items, leadText) {
  const list = (items || []).filter(i => i && (i.contentId || i.url)).slice(0, 3);
  if (!list.length) {
    // KHÔNG có ảnh -> nếu có chữ kèm thì vẫn gửi chữ (để opener không bị mất).
    if (leadText && String(leadText).trim()) { try { await _sendInboxMessage(target, leadText); } catch (_) {} return { ok: false, n: 0, textSent: true }; }
    return { ok: false, n: 0 };
  }
  const cids = list.map(i => i.contentId).filter(Boolean);
  const urls0 = list.map(i => i.url).filter(Boolean);
  let n = 0;
  let textSent = false;

  // [CẦU DAO ẢNH] Page đang bị ngắt (FB chặn upload hàng loạt) -> KHÔNG đấm tiếp, gửi chữ (nếu có) rồi
  // trả notAvailable để lớp trên gắn AI-XL ảnh / hẹn gửi lại — hết cảnh retry storm treo hàng đợi.
  {
    const _pgId = String(target || "").split("_")[0];
    if (_imgBreakerActive(_pgId)) {
      if (leadText && String(leadText).trim()) { try { await _sendInboxMessage(target, leadText); textSent = true; } catch (_) {} }
      try { console.log(`  [ảnh] ⚡ cầu dao page ${_pgId} đang NGẮT -> bỏ qua gửi ${list.length} tấm (text ${textSent ? "đã gửi" : "không có"}).`); } catch (_) {}
      return { ok: false, n: 0, notAvailable: true, breaker: true, textSent };
    }
  }

  // CHỐNG ẢNH ĐÈ TIN KHÁCH: chụp mốc tin khách lúc bắt đầu gửi. Nếu trong lúc gửi LẺ (mất vài giây) mà
  // khách CHEN tin mới (vòng poll khác cập nhật mốc) -> NGỪNG gửi ảnh còn lại, nhường vòng sau trả lời.
  const _abortSnap = (typeof target === "string" && lastCustomerMsgAt.get(target)) || 0;
  const _custSpoke = () => _abortSnap > 0 && (lastCustomerMsgAt.get(target) || 0) > _abortSnap;
  // Lỗi TẠM của Pancake/FB (chưa mở thread, nghẽn nhịp...) -> đáng để thử lại, KHÁC lỗi content_id hỏng.
  const isTransient = _isTransientSend;
  // RIÊNG #551 "người này hiện KHÔNG CÓ MẶT": retry 2-4s vô ích (vẫn vắng) -> KHÔNG thử lại liền.
  // -> trả notAvailable cho lớp trên HẸN gửi lại (10p/30p/1h).
  const isNotAvailable = _isNotAvailableSend;
  const isOutsideWindow = _isOutsideWindowSend;   // (#10) ngoài cửa sổ 24h -> dừng hẳn, đừng spam

  // (1) ALBUM content_id 1 PHÁT (nhanh, ra cả cụm). Nếu Pancake nhận -> xong.
  //     CÓ leadText -> GỬI CHỮ + ALBUM TRONG 1 LẦN (chống #551 ở lead comment/ads: chỉ 1 slot trả lời).
  //     Gặp lỗi TẠM -> nghỉ rồi thử lại CẢ album. THEO YÊU CẦU SHOP: thử ALBUM TỐI THIỂU 5 LẦN
  //     rồi mới được rớt xuống gửi LẺ (FB hay cần vài giây mở thread cho media; ưu tiên ra cả cụm).
  if (cids.length) {
    for (let a = 1; a <= 5; a++) {
      let r0 = null;
      try {
        const r = leadText
          ? await _sendInboxMessageWithImages(target, leadText, cids, urls0)
          : await sendInboxImages(target, cids, 3);
        r0 = Array.isArray(r) ? r[0] : r;
        if (r0 && r0.success !== false) {
          if (leadText) textSent = true;
          try { console.log(`  [ảnh] ${leadText ? "CHỮ+ALBUM" : "ALBUM"} ${cids.length} tấm bằng content_id${a > 1 ? ` (lần ${a})` : ""}.`); } catch (_) {}
          return { ok: true, n: cids.length, textSent };
        }
      } catch (e) { try { console.log("  [ảnh] album NÉM LỖI:", e.message); } catch (_) {} }
      // #551 KHÔNG CÓ MẶT -> không thử lại liền (vô ích). Gửi nốt CHỮ (nếu có) 1 lần rồi BÁO LÊN để HẸN gửi ảnh sau.
      if (isNotAvailable(r0)) {
        if (leadText && !textSent) { try { await _sendInboxMessage(target, leadText); textSent = true; } catch (_) {} }
        try { console.log(`  [ảnh] khách KHÔNG CÓ MẶT (#551) -> KHÔNG thử lại liền, HẸN gửi ảnh sau 10p/30p/1h.`); } catch (_) {}
        return { ok: false, n: 0, notAvailable: true, textSent };
      }
      // (#10) NGOÀI CỬA SỔ 24h -> FB chặn media, gửi lại bao nhiêu cũng fail. DỪNG HẲN (không retry, không gửi từng tấm).
      //  Gửi CHỮ 1 lần để khách thấy phản hồi; báo outsideWindow để lớp trên gắn thẻ "nợ ảnh" + đợi khách nhắn.
      if (isOutsideWindow(r0)) {
        if (leadText && !textSent) { try { await _sendInboxMessage(target, leadText); textSent = true; } catch (_) {} }
        try { console.log(`  [ảnh] NGOÀI CỬA SỔ 24h (#10/2018278) -> DỪNG gửi ảnh (không spam), nợ ảnh chờ khách nhắn inbox.`); } catch (_) {}
        return { ok: false, n: 0, outsideWindow: true, notAvailable: true, textSent };
      }
      // Lỗi up ảnh lên FB (invalid_upload_fb_attachments_result) = TẠM -> nghỉ NGẮN rồi thử lại CẢ album (thử đủ 5 lần).
      // "5 lần không được thì THÔI" ở cấp toàn cục do CẦU DAO lo: 3 nhóm chết trắng liên tiếp -> ngắt page 10 phút.
      if (isTransient(r0) && a < 5) {
        const _w = 2000;   // giãn cách 2s mỗi lần thử lại album (đủ cho FB nuốt lại cụm ảnh)
        try { console.log(`  [ảnh] album lỗi TẠM (${String((r0 && (r0.message_code || r0.message)) || "").slice(0, 45)}) -> nghỉ ${_w}ms thử lại album (lần ${a + 1}/5).`); } catch (_) {}
        try { await delay(_w); } catch (_) {}
        continue;
      }
      try { console.log("  [ảnh] album content_id lỗi:", JSON.stringify(r0).slice(0, 200), "-> gửi TỪNG tấm (cứu ảnh tốt)."); } catch (_) {}
      break;
    }
  }

  // CHƯA gửi được chữ (album combine fail) -> gửi CHỮ riêng 1 lần TRƯỚC khi gửi ảnh lẻ (để opener không mất).
  if (leadText && !textSent) { try { await _sendInboxMessage(target, leadText); textSent = true; } catch (_) {} }

  // (2) GỬI TỪNG TẤM. 1 content_id hỏng chỉ làm hỏng ALBUM, các id còn lại VẪN TỐT.
  //     Mỗi tấm: thử content_id riêng (Pancake tự host = đáng tin) -> hỏng mới dùng link Drive (đã chuẩn hoá).
  for (const it of list) {
    // Khách CHEN tin mới giữa chừng -> DỪNG gửi nốt ảnh (đỡ đè câu hỏi); ảnh đã gửi vẫn tính là đủ.
    if (n > 0 && _custSpoke()) {
      try { forceRecheckConvs.add(String(target)); } catch (_) {}   // khách chen tin -> ép xử lại lượt sau
      try { console.log(`  [ảnh] khách vừa nhắn tin MỚI -> NGỪNG gửi nốt (đã gửi ${n}/${list.length}, nhường vòng sau trả lời).`); } catch (_) {}
      break;
    }
    let sent = false;
    let _outWin = false;
    if (it.contentId) {
      for (let a = 1; a <= 2 && !sent; a++) {
        try { const r = await sendInboxImages(target, [it.contentId], 1); const r0 = Array.isArray(r) ? r[0] : r; if (r0 && r0.success !== false) { sent = true; n++; } else if (isOutsideWindow(r0)) { _outWin = true; break; } }
        catch (_) {}
        if (!sent && !_outWin && a < 2) { try { await delay(350); } catch (_) {} }
      }
    }
    if (!sent && !_outWin && it.url) {
      const u = normDriveUrl(it.url);
      for (let a = 1; a <= 3 && !sent; a++) {
        try { const r = await sendInboxImageUrl(target, u); if (r && r.success !== false) { sent = true; n++; } else if (isOutsideWindow(r)) { _outWin = true; break; } }
        catch (_) {}
        if (!sent && !_outWin && a < 3) { try { await delay(400 * a); } catch (_) {} }
      }
    }
    if (_outWin) {
      try { console.log(`  [ảnh] NGOÀI CỬA SỔ 24h (#10) khi gửi lẻ -> DỪNG gửi nốt (đã gửi ${n}/${list.length}), nợ ảnh chờ khách nhắn.`); } catch (_) {}
      return { ok: n > 0, n, outsideWindow: true, notAvailable: n === 0, textSent };
    }
    if (!sent) { try { console.log("  [ảnh] 1 tấm CHẾT (content_id + URL đều fail) | cid:", String(it.contentId || "-").slice(0, 26), "| url:", String(it.url || "-").slice(0, 60)); } catch (_) {} }
    try { await delay(250); } catch (_) {}
  }
  try { console.log(`  [ảnh] gửi từng tấm xong: ${n}/${list.length} tấm.`); } catch (_) {}
  // [CẦU DAO ẢNH] ghi nhận: cả nhóm chết trắng -> cộng chuỗi; gửi được ít nhất 1 tấm -> reset chuỗi.
  try { _imgNoteResult(String(target || "").split("_")[0], n === 0 && list.length > 0); } catch (_) {}
  return { ok: n > 0, n };
}
async function sendPrivateReply(target, text, commentId, postId) {
  const r = await _sendPrivateReply(target, text, commentId, postId);
  rememberSentId(r);
  return r;
}
async function replyComment(target, text, commentId) {
  const r = await _replyComment(target, text, commentId);
  rememberSentId(r);
  return r;
}
const { reasoning, HUMAN_CHECK_REPLY } = require("./reasoning_engine");
const { vetAdvisoryReply } = require("./reply_guard");
// ===== [CHỐT NHÃN 2026-07-11] "AI đã chấm nhãn thuộc nhóm có handler riêng thì regex KHÁC NHÓM không được
// nổ súng" — trị tận gốc lớp lỗi regex-chuỗi-con cướp lượt của nhãn đúng ("cửa HÀNG Ở ĐÂU" dính regex kho
// dù AI đã chấm STORE_ADDRESS). Nhánh regex-trần trước khi bắn phải qua chốt này:
//   - AI mù (nhãn rỗng/OTHER) -> regex tự do như xưa.
//   - Nhãn AI nằm trong allowKinds của nhánh -> cùng nhóm, cho chạy.
//   - Nhãn AI thuộc NHÓM LUỒNG/HÀNH ĐỘNG (địa chỉ/sđt/chốt/hậu mãi/xã giao/cửa hàng/số đo...) -> regex Q&A
//     NHƯỜNG cho handler của nhãn (chế độ "chan"), hoặc chỉ ghi log đối chiếu (chế độ "log").
// Công tắc: regex_theo_nhan trong ai_quyet_config.json ("chan" | "log" | "off"), sửa không cần restart.
const _NHAN_LUONG = new Set(["ADDRESS", "PHONE", "SEND_ADDRESS_LATER", "ORDER_CLOSE", "ADD_TO_ORDER", "CANCEL_ORDER",
  "POST_ORDER_CONFIRMED", "POST_ORDER_CHITCHAT", "POST_ORDER_REQUEST", "THANKS", "GREETING", "DEFER_DECISION",
  "CONSULT_FAMILY", "WAITING_REPLY", "EXCHANGE_REQUEST", "REFUND_REQUEST", "EDIT_ORDER", "DEFECT_REPORT",
  "CK_PROOF", "PAYMENT_CONFIRM", "ORDER_STATUS", "REFUSE_DELIVERY", "DELIVERY_PREFERENCE", "STORE_ADDRESS",
  "STORE_VISIT", "WEIGHT_HEIGHT", "SIZE", "TIKTOK_ORDER", "URGENT", "COMPLAINT", "WHOLESALE", "TOTAL_PAYMENT"]);
function _nhanCamRegex(mem, tenNhanh, allowKinds) {
  try {
    const k = String((mem && mem._aiIntent) || "");
    if (!mem || !mem._aiOk || !k || k === "OTHER") return false;
    if ((allowKinds || []).includes(k)) return false;
    if (!_NHAN_LUONG.has(k)) return false;   // nhãn Q&A khác -> regex Q&A vẫn tự do (nhầm giữa Q&A ít nguy hiểm)
    const mode = String(aiQuyetCfg().regex_theo_nhan || "chan");
    if (mode === "off") return false;
    console.log(`[REGEX cãi nhãn] nhánh ${tenNhanh} (regex) muốn bắn nhưng nhãn AI=${k} (nhóm luồng) -> ${mode === "chan" ? "NHƯỜNG handler của nhãn" : "cho chạy (chế độ log)"}.`);
    return mode === "chan";
  } catch (_) { return false; }
}
const _va = require("./vn_address");   // map tỉnh/thành 2025 -> suy tỉnh từ quận/huyện + token ambiguous
let _curPageId = "";   // [SALE GỌN] page của lượt đang xử (cho các hàm thuần tra chương trình KM)
// ===== [AI-QUYẾT 2026-07-07] tầng AI quyết định (referent + địa chỉ/chốt đơn) =====
const aiQuyet = require("./ai_quyet");
function aiQuyetCfg() {
  // đọc lại mỗi lượt -> sửa công tắc KHÔNG cần restart. Thiếu file/hỏng -> tắt hết (an toàn).
  try {
    const c = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "ai_quyet_config.json"), "utf8"));
    return {
      log_so_sanh: c.log_so_sanh === true,
      bat_referent: c.bat_referent === true,
      bat_diachi_chotdon: c.bat_diachi_chotdon === true,
      nguong: (typeof c.nguong_tin_cay === "number" && c.nguong_tin_cay > 0 && c.nguong_tin_cay <= 1) ? c.nguong_tin_cay : 0.7
    };
  } catch (_) { return { log_so_sanh: false, bat_referent: false, bat_diachi_chotdon: false, nguong: 0.7 }; }
}
// Chuỗi có tín hiệu ĐỊA CHỈ THẬT không (địa danh vn_address / tầng hành chính / số nhà) — rào chống AI bịa.
function _aqLooksAddr(s) {
  const t = String(s || "").trim();
  if (t.length < 8) return false;
  const f = _va.fold(t);
  return !!(_va.explicitProvince(f)
    || (typeof _va.hasAreaToken === "function" && _va.hasAreaToken(f))
    || /((số|so)\s*(nhà|nha)?\s*\d)|((thôn|thon|xóm|xom|ấp|ap|đội|doi|khu|tổ|to|lô|lo|kiệt|kiet)\s)|((xã|xa|phường|phuong|thị\s*trấn|thi\s*tran|quận|quan|huyện|huyen)\s)|((đường|duong|phố|pho|ngõ|ngo|ngách|ngach|hẻm|hem)\s)/i.test(" " + t + " "));
}
const { classifyIntent } = require("./ai_intent");
const { getOrdersByPhone, posConfigured } = require("./pos_client");
const { resolveImage, similarByCode } = require("./vision_resolver");
const recommend = require("./recommend");
const { ensure: ensureCatalog } = require("./catalog_cache");
const { detectIntent } = require("./intent_detector");
const { routeBatch, fold: routerFold } = require("./intent_router");
const { findInText, getByCode: catalogGetByCode, fuzzyFindModel, hasModelNameToken } = require("./catalog_cache");
const { extractColor, colorMatches, foldVi, splitColors } = require("./color_utils");
const { getImageUrls, getImageDownloadUrls, contentIdsByColor, imageItemsByColor, getCodeColors, representativeColor, contentIdByImageId, urlByImageId, imageItemsBySide, hasBackImage, itemsByCode, colorFromName } = require("./product_images");
const productVideos = require("./product_videos");   // tra content_id VIDEO theo mã (video_index.json)
const celeb = require("./celeb_images");
const { getConversationState, updateConversationState } = require("./state_manager");
const { loadProcessed, addProcessed, saveProcessed } = require("./processed_store");

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ===== TƯ VẤN CHẤT LIỆU (material_advice.json từ p.xlsx) ====================
// Khách hỏi "chất gì" -> trả CÂU TƯ VẤN (cột D) ứng với chất liệu của MÃ (catalog r[15]).
// Câu nào còn cụm "chất này" -> thay bằng "chất <tên chất của mã>". Khớp MỀM theo token + họ chất.
let _MAT_DB = null;
try { _MAT_DB = require("./material_advice.json"); }
catch (e) { console.warn(`[${process.env.BOT_NAME || "BOT"}] ⚠ thiếu material_advice.json -> dùng câu tư vấn chất liệu mặc định.`); }
function _matFold(s) {
  s = String(s || "").toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
  return s.replace(/[^a-z0-9\s/]/g, " ").replace(/\s+/g, " ").trim();
}
function _matCleanName(s) {            // tên chất của mã, bỏ ngoặc + lấy đoạn đầu (để chèn vào "chất ...")
  let raw = String(s || "").replace(/\([^)]*\)/g, "").trim();
  return raw.split("/")[0].trim();
}
function _matFindRow(matStr) {
  if (!_MAT_DB || !_MAT_DB.rows) return null;
  const f = _matFold(matStr);
  if (!f) return null;
  // tên chất 1 TỪ -> tra bảng đại diện trước (đúng họ, tránh đụng nhầm: "Dạ" vải ≠ "Da" thuộc)
  if (!f.includes(" ") && _MAT_DB.single && _MAT_DB.single[f] != null) return _MAT_DB.rows[_MAT_DB.single[f]];
  const ftok = new Set(f.split(" "));
  if (f.length > 2) {
    let best = null, bestScore = 0, bestFamHit = false, bestNameLen = 1e9;
    for (const row of _MAT_DB.rows) {
      for (const k of row.keys) {
        if (k.length < 3) continue;
        let sc = 0;
        if (k.includes(" ")) { if (f.includes(k)) sc = k.length; }   // khoá nhiều từ: khớp cả cụm
        else if (ftok.has(k)) sc = k.length;                          // khoá 1 từ: trùng NGUYÊN token
        else if (f.length >= 4 && k.includes(f)) sc = f.length;       // tên mã là token con của khoá
        if (sc === 0) continue;
        const famHit = !!(row.fam && ftok.has(row.fam));
        const nameLen = row.name.length;
        if (sc > bestScore || (sc === bestScore && famHit && !bestFamHit) ||
            (sc === bestScore && famHit === bestFamHit && nameLen < bestNameLen)) {
          best = row; bestScore = sc; bestFamHit = famHit; bestNameLen = nameLen;
        }
      }
    }
    if (best) return best;
  }
  for (const t of f.split(" ")) if (_MAT_DB.famDefault && _MAT_DB.famDefault[t] != null) return _MAT_DB.rows[_MAT_DB.famDefault[t]];
  return null;
}
// Trả CÂU TƯ VẤN chất liệu theo chuỗi chất của mã. null nếu không khớp (để dùng câu mặc định).
function materialAdviceSentence(matStr) {
  const row = _matFindRow(matStr);
  if (!row) return null;
  let adv = row.adv;
  if (/chất này/i.test(adv)) {
    const name = _matCleanName(matStr) || row.display || "này";
    adv = adv.replace(/chất này/gi, "chất " + name);
  }
  return adv;
}

const PAGE_ID = process.env.PANCAKE_PAGE_ID;
const pageRegistry = require("./page_registry");

// Bật/tắt việc bot ĐĂNG TRẢ LỜI COMMENT CÔNG KHAI.
// false = bot chỉ nhắn riêng (DM) mẫu/giá/size/ảnh, KHÔNG đụng comment công khai.
// (Đổi thành true nếu muốn bot tự chào dưới comment.)
const POST_PUBLIC_COMMENT = true;

// Bỏ mọi link ảnh / markdown ảnh mà AI lỡ chèn vào câu chữ (ảnh do code gửi riêng)
function stripImageLinks(text) {
  if (!text) return text;
  let t = String(text)
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, "")            // ![Photo](url) hoặc [text](url) đầy đủ
    .replace(/!\[[^\]]*\]?/g, "")                       // ![...  hoặc ![Photo  thiếu đuôi
    .replace(/https?:\/\/\S+/gi, "")                    // mọi link http(s) trần
    .replace(/\bcontent\.pancake\.vn\/\S+/gi, "")      // link pancake trần
    .replace(/\[\s*(?:ảnh|anh|hình|hinh|photo|image|img)[^\]\n]*\]?/gi, "") // [Ảnh 1 của X], [Hình...], [Photo]...
    .replace(/^[ \t]*[\[\]()]+[ \t]*$/gm, "")           // dòng chỉ còn [ ] ( ) mồ côi
    .replace(/[ \t]+\n/g, "\n")                          // xóa khoảng trắng cuối dòng
    .replace(/\n{3,}/g, "\n\n")                          // gộp dòng trống thừa
    .trim();
  return t;
}

// Nhận biết câu "chờ kiểm tra" để gắn thẻ AI - CHỜ XL
function isCheckLaterReply(text) {
  return /đợi em kiểm tra|chờ em (một|1) chút|kiểm tra lại (thông tin|trên hệ thống)|em kiểm tra lại rồi (báo|em báo)/i.test(String(text || ""));
}

// ===== TÊN BOT AI (để dễ phân biệt với người thật trong log) =====
const BOT_NAME = "Bảo Trâm";

// ===== KỊCH BẢN CHUYỂN KHOẢN (CK) =====
const BANK_INFO = {
  bank: "Techcombank",
  stk: "19034747389015",
  chu_tk: "NGUYEN VAN HUNG",
};
// Lời cung cấp thông tin CK khi KHÁCH MUỐN chuyển khoản (chưa biết STK).
function buildBankInfoReply() {
  return (
    `Dạ chị chuyển khoản theo thông tin sau ạ:\n` +
    `${BANK_INFO.bank} STK: ${BANK_INFO.stk}\n` +
    `Chủ tk: ${BANK_INFO.chu_tk}\n` +
    `Nội dung: Tên FB - SĐT chị nhé.\n` +
    `Chị chuyển xong gửi hình em kiểm tra và lên đơn cho mình ạ`
  );
}

// Khách HỎI LÝ DO / ĐIỀU KIỆN / TỪ CHỐI "chuyển khoản trước" (hoặc muốn COD nhận hàng rồi mới trả) ->
// KHÔNG tự đặt điều kiện, KHÔNG đẩy STK -> NGƯỜI THẬT (chuyện tiền bạc/chính sách thanh toán, bot không tự quyết).
function questionsOrRefusesPrepay(text) {
  const t = String(text || "").toLowerCase();
  const prepay = /(chuyển khoản trước|ck trước|chuyển trước|cọc trước|đặt cọc|thanh toán trước|trả trước|chuyển tiền trước|phải (chuyển khoản|ck|cọc))/;
  // Hỏi VÌ SAO / điều kiện / xin giảm khi prepay
  if (prepay.test(t) && /(vì sao|tại sao|sao (lại |phải )|sao phải|why|có (được|đc)|được (không|ko|hông)|đc (không|ko)|giảm|ưu đãi|bắt buộc|có cần|cần (không|ko))/.test(t)) return true;
  // TỪ CHỐI prepay
  if (/(không|ko|k|hông|chẳng)\s*\w*\s*(muốn |thích |chịu |đồng ý )?(chuyển khoản trước|ck trước|cọc|đặt cọc|trả trước|thanh toán trước)/.test(t)) return true;
  // Muốn COD: nhận hàng / kiểm tra rồi mới trả
  if (/(nhận (hàng|đc|được)|kiểm tra (hàng)?).{0,18}(rồi|mới|xong).{0,18}(thanh toán|thánh toán|trả|ck|chuyển|tiền|tt)\b/.test(t)) return true;
  if (/\b(ship\s*)?cod\b|nhận hàng (rồi )?(mới )?trả tiền|trả (tiền )?khi nhận|thu (tiền )?hộ/.test(t)) return true;
  return false;
}

// KHÁCH MUỐN chuyển khoản / xin thông tin tài khoản (HỎI cách trả tiền) -> cung cấp STK.
function wantsBankInfo(text) {
  const t = String(text || "").toLowerCase();
  if (asksPaymentReceived(t)) return false;   // khách ĐÃ chuyển/đã trả rồi -> KHÔNG đòi chuyển lại
  return /(số tài khoản|stk|tk ngân hàng|tài khoản ngân hàng|cho.*(xin|gửi).*(stk|tài khoản|số tk)|chuyển khoản( thế nào| ra sao| kiểu gì| như nào)?|chuyển khoarn|chuyển khoaran|ck trước|chuyển trước|chuyển khoản trước|muốn (chuyển khoản|ck|cọc)|chị (muốn |sẽ )?(chuyển khoản|ck)\b|gửi (chị )?(mã|stk|tk|số tk|số tài khoản|info|thông tin (ck|chuyển khoản))|(?<![a-zà-ỹ])ck(?![a-zà-ỹ])( thế nào| ra sao| kiểu gì| như nào)?|thanh toán( trước| online| qua)? |chuyển tiền|cọc.*(thế nào|kiểu gì|ở đâu)|đặt cọc|info chuyển khoản|thông tin chuyển khoản)/i.test(t);
}

// ===== ĐỊA CHỈ SHOP / SHOWROOM (§16) =====
const SHOWROOMS = [
  "📍 105 Bà Triệu, Hai Bà Trưng, Hà Nội",
  "📍 131-133 Nguyễn Trãi, P. Bến Thành, Q1, TP.HCM",
];
// Trả lời theo ĐỊA DANH khách hỏi/chọn. HN/HCM -> chi tiết cơ sở; Bắc Giang -> văn phòng;
// Vinh/Nghệ An/Phú Thọ -> đã đóng. KHÔNG nhận ra địa danh nào -> null (để luồng khác xử).
function showroomReplyFor(text) {
  const t = foldVi(String(text || ""));
  // Bắc Giang: vẫn có VĂN PHÒNG (không trưng bày đủ mẫu như showroom).
  if (/bac giang/.test(t)) {
    return "Dạ bên em có cơ sở ở Bắc Giang ạ. Chỗ này là văn phòng nên không trưng bày đầy đủ mẫu như showroom ở Hà Nội và Nguyễn Trãi, nhưng chị cứ tiện ghé qua nha — em vẫn đưa từng mẫu để mình thử thoải mái ạ\n📍 01 Huỳnh Thúc Kháng, KĐT phía Nam, Phường Bắc Giang, Bắc Ninh";
  }
  // Vinh / Nghệ An / Phú Thọ: TỪNG có nhưng đã ĐÓNG.
  const _closed = [];
  if (/\bvinh\b/.test(t)) _closed.push("Vinh");
  if (/nghe an/.test(t)) _closed.push("Nghệ An");
  if (/phu tho/.test(t)) _closed.push("Phú Thọ");
  if (_closed.length) {
    return "Dạ hiện tại bên em có showroom tại:\n" + SHOWROOMS.join("\n") +
      "\nCòn cơ sở " + _closed.join("/") + " bên em không còn hoạt động nữa ạ.";
  }
  // HN
  if (/ba trieu|hai ba trung|\bha noi\b|\bhn\b|thu do/.test(t)) {
    return "Dạ cơ sở Hà Nội của bên em ở:\n" + SHOWROOMS[0] +
      "\nChị tiện qua em nhắn nhân viên chuẩn bị sẵn mẫu cho mình thử nha ❤️";
  }
  // HCM
  if (/nguyen trai|ben thanh|\bq1\b|quan 1|sai gon|\bhcm\b|ho chi minh|tphcm|tp ?hcm|mien nam/.test(t)) {
    return "Dạ cơ sở TP.HCM của bên em ở:\n" + SHOWROOMS[1] +
      "\nChị tiện qua em nhắn nhân viên chuẩn bị sẵn mẫu cho mình thử nha ❤️";
  }
  return null;
}
// Khách bày tỏ Ý ĐỊNH GHÉ showroom ("sẽ ghé", "qua xem", "ghé thử", "qua lấy"...).
function wantsVisitShowroom(text) {
  const t = foldVi(String(text || ""));
  return /\bghe\b/.test(t)
    || /qua (xem|coi|thu|lay|shop|showroom|cua hang|do)/.test(t)
    || /(den|ra|toi) (shop|showroom|cua hang)/.test(t)
    || /se (qua|den|ra)\b/.test(t)
    || /(tien|tien the|ranh) (thi )?(qua|ghe|den)/.test(t);
}
// Khách hẹn THỜI ĐIỂM ghé cụ thể ("mai", "chiều nay", "thứ 7", "8h", "cuối tuần"...).
function mentionsVisitTime(text) {
  const t = foldVi(String(text || ""));
  return /\b(mai|ngay mai|hom nay|chieu nay|toi nay|sang nay|chieu mai|sang mai|toi mai|cuoi tuan|chu nhat|\bcn\b|gio|bay gio|luc nay|chieu|toi nay|sang)\b/.test(t)
    || /\bthu\s*(hai|ba|tu|nam|sau|bay|[2-7])\b/.test(t)
    || /\b\d{1,2}\s*(h|gio)\b/.test(t)
    || /\b(ngay|hom)\s*\d{1,2}\b/.test(t);
}
// Câu B1: khách báo SẼ GHÉ -> xác nhận cơ sở + xin size GIỮ HÀNG + hỏi hôm nào ghé. (biến thể theo đã biết size chưa)
function showroomVisitReply(text, mem) {
  const t = foldVi(String(text || ""));
  let name = "Bà Triệu", addr = "105 Bà Triệu, Hai Bà Trưng";
  if (/nguyen trai|ben thanh|\bq1\b|quan 1|sai gon|\bhcm\b|ho chi minh|tphcm|tp ?hcm|mien nam/.test(t)) {
    name = "Nguyễn Trãi"; addr = "131-133 Nguyễn Trãi, P. Bến Thành, Q1, TP.HCM";
  }
  const sizeKnown = mem && mem.customerSize && mem.customerSize !== "FREESIZE";
  if (sizeKnown) {
    return `Dạ vâng, showroom ${name} ở ${addr} chị nha ❤️. Size ${sizeLabel(mem.customerSize)} của mình thì em giữ sẵn tại showroom luôn nha, vì mẫu ở đó cũng nhanh hết hàng lắm ạ. Chị tính ghé khoảng hôm nào để em sắp xếp nhân viên giữ hàng cho mình nha?`;
  }
  return `Dạ vâng, showroom ${name} của bên em ở ${addr} chị nha. Chị cho em xin size mình hay mặc, em giữ sẵn tại showroom vì các mẫu ở đó cũng nhanh hết hàng lắm ạ. Chị tính ghé khoảng hôm nào để em sắp xếp nhân viên giữ hàng cho mình nha?`;
}
function asksShipOrigin(text) {
  const t = String(text || "").toLowerCase();
  return /(hàng|đồ|order|đơn|ship)\s*([^?]{0,12})?(gửi|gui|ship|giao|đi|về)\s*(từ|tu)\s*(đâu|kho|tỉnh|chỗ)|gửi\s*(hàng\s*)?(từ\s*)?(đâu|kho nào|tỉnh nào)|kho\s*(ở|o)?\s*đâu|từ\s*kho\s*nào|ship\s*từ\s*đâu|hàng\s*(ở|từ)\s*đâu/i.test(t);
}
function buildShipOriginReply() {
  // [SỬA 2026-07-07] Khách hỏi HÀNG GỬI TỪ ĐÂU (ngữ cảnh ship online) -> trả lời đúng trọng tâm,
  // BỎ vế "Chị ghé cơ sở nào tiện..." (lạc quẻ - khách không hỏi chuyện ghé showroom).
  return "Dạ hàng bên em được gửi từ kho Bắc Giang ạ. Đơn của mình được giao tận nơi, chị được kiểm hàng trước khi thanh toán nha";
}
// Khách hỏi ĐỊA CHỈ CỦA SHOP / có cửa hàng ở đâu / có ở tỉnh X không (KHÔNG phải địa chỉ giao hàng của khách).
function asksShopAddress(text) {
  const t = String(text || "").toLowerCase();
  return /(địa chỉ.*(shop|cửa hàng|bên em|showroom|store|cơ sở)|(shop|cửa hàng|showroom|store|cơ sở).*(ở đâu|chỗ nào|địa chỉ|nào)|bên em (ở đâu|có (ở|địa chỉ|cửa hàng|showroom|store|chi nhánh|cơ sở))|có (cửa hàng|shop|showroom|chi nhánh|cơ sở).*(ở|tại|nào)|chi nhánh|có ở (hà nội|hn|hcm|sài gòn|tphcm|bắc giang|bg)|đến (shop|cửa hàng|store|cơ sở).*(xem|thử)?|xem (trực tiếp|tại shop|tại cửa hàng)|(shop|bên em|cửa hàng|showroom|store|cơ sở)\s+(ở|tại|o)\s+(sg|sài gòn|sai gon|hn|hà nội|ha noi|hcm|tphcm|tp ?hcm|đà nẵng|da nang|đn|hp|hải phòng|đâu|dau|nào|tỉnh|miền|chỗ))/i.test(t);
}
function buildShopAddressReply() {
  return "Bên em có 2 showroom chị nha:\n" + SHOWROOMS.join("\n") +
    "\nChị tiện qua cơ sở nào em nhắn nhân viên chuẩn bị sẵn mẫu cho mình thử nha ❤️. Còn nếu chị bận chưa qua được thì cứ chốt online, bên em ship tận nơi, cho kiểm hàng trước khi thanh toán luôn ạ.";
}

// Khách hỏi GIẢM GIÁ / sale / bớt / mua nhiều có giảm không.
function asksDiscount(text) {
  const t = String(text || "").toLowerCase();
  return /(giảm giá|giảm được|giảm chút|giảm cho|bớt (chút|được|giá|cho|tí|xíu)|bớt đi|có sale|đang sale|sale (không|ko|hông)|khuyến mãi|khuyến mại|\bkm\b|ưu đãi (gì|không|ko)|fix giá|fix được|mua (nhiều|2|hai|3|ba).*giảm|giảm.*(mua nhiều|2 bộ|2 cái)|discount|voucher|mã giảm|có giảm|(đang|được|còn) (được )?giảm|đang giảm|giảm (à|ạ|ah|hả|hơm|nhiêu|còn)|được giảm|có đang (giảm|sale|ưu đãi)|(còn|đang) ưu đãi|chương trình (gì|nào|sale|khuyến mãi|khuyến mại|ưu đãi|giảm)|khi nào (có|mới|lại)?\s*(sale|giảm|khuyến mãi|khuyến mại|chương trình|ưu đãi|ct\b)|(sale|giảm giá|khuyến mãi|chương trình|ưu đãi)\s*(gì\s*)?(thì\s*|nhớ\s*)?(nhắn|báo|ib|inbox|call)\s*(lại\s*)?(mình|e\b|em|c\b|chị|t\b)|(nhắn|báo|ib|inbox)\s*(mình|em|chị|lại).{0,15}(có|khi).{0,10}(sale|giảm|khuyến mãi|chương trình|ưu đãi))/i.test(t);
}
function buildDiscountReply(productInfo, mem) {
  const nameTxt = productLabelSp(productInfo);
  const hasSale = isOnSale(productInfo);
  // Khách xin GIẢM THÊM (mua nhiều, bớt nữa) -> lịch sự từ chối, đổi sang ưu đãi khác (freeship/gói kỹ), XOAY câu.
  if (mem._asksMoreDiscount) {
    const more = [
      "Dạ mua nhiều thì bên em vẫn freeship cho mình ạ, còn giá đang là mức ưu đãi tốt nhất rồi nên em không giảm thêm được nữa, mong chị thông cảm",
      "Dạ giá này đã là ưu đãi sâu rồi chị ạ, em không giảm thêm được; bù lại chị mua 2 mẫu em ưu tiên gói kỹ và freeship cho mình nha",
      "Dạ em xin phép giữ giá ưu đãi này giúp chị ạ, mức này là tốt rồi. Mua nhiều em hỗ trợ freeship cho mình nhe",
    ];
    mem.discIdx = ((mem.discIdx || 0) + 1) % more.length;
    return more[mem.discIdx];
  }
  if (hasSale) {
    // ĐUÔI ĐỘNG theo thông tin đã có: CHƯA size -> hỏi size (KHÔNG mời "chốt/lên đơn" khi chưa đủ size);
    //  đủ size nhưng thiếu sđt/địa chỉ -> xin contact; đủ hết -> mời lên đơn.
    const _needSize = !effectiveSize(mem, productInfo) && orderNeedsSize(mem, productInfo);
    const _tail = _needSize ? "Chị mặc size bao nhiêu để em check hàng cho mình ạ?" : orderCtaOrAskContact(mem);
    // Giá rõ: "giá gốc X giảm còn Y" (đúng dữ liệu sheet) — không nói cứng %/CTA chốt khi chưa đủ size.
    const _g = parseMoney(productInfo.price), _s = parseMoney(productInfo.salePrice);
    const _fmt = n => Number(n).toLocaleString("vi-VN");
    const _saleTxt = (_g && _s && _s < _g) ? `giá gốc ${_fmt(_g)}đ giảm còn ${_fmt(_s)}đ` : (productInfo.priceText || "");
    const _sp = _saleTxt ? `, ${_saleTxt}` : "";
    const yes = [
      `Dạ ${nameTxt}hiện đang được ưu đãi${_sp} ạ, đang giảm rất sâu chị nha 🥰 ${_tail}`,
      `Dạ ${nameTxt}đang ưu đãi sâu đó chị${_sp} ạ, giá này hời lắm rồi ạ. ${_tail}`,
      `Dạ ${nameTxt}đang giảm khá sâu${_sp} chị nha, mức này tốt lắm rồi ạ. ${_tail}`,
    ];
    mem.discIdx = ((mem.discIdx || 0) + 1) % yes.length;
    return yes[mem.discIdx];
  }
  const _nmSale = nameTxt || "mẫu này ";
  const _needSizeNo = !effectiveSize(mem, productInfo) && orderNeedsSize(mem, productInfo);
  const _tailNo = _needSizeNo ? "Chị mặc size bao nhiêu để em check hàng cho mình ạ?" : orderCtaOrAskContact(mem);
  // ===== [CHƯƠNG TRÌNH KM 2026-07-11] Đang có chương trình (khuyen_mai.json, còn hạn) mà mẫu đang xem
  // KHÔNG nằm diện giảm (cột KM=0) -> KHÔNG được nói "shop hiếm khi giảm giá" (đang chạy sale mà nói thế
  // là tự đá đổ chương trình). Trả lời TRUNG THỰC: có chương trình X, riêng mẫu này giá niêm yết.
  const _prog = saleProgram(mem && mem._pageId);
  if (_prog && _prog.ap_dung_toan_bo && productInfo && productInfo.code) {
    // [KM TOÀN BỘ] mẫu cột KM trống nhưng chương trình áp dụng TẤT CẢ -> cảnh báo đội data điền sheet gấp
    // (GIÁ/COD vẫn đọc sheet — chưa điền là bot đang báo NGUYÊN GIÁ sai với chương trình!).
    console.log(`[KM THIẾU SHEET] mẫu ${productInfo.code} cột KM trống dù chương trình giảm TOÀN BỘ -> điền giá KM vào sheet gấp!`);
  }
  if (_prog && _prog.cau_gioi_thieu) {
    // Khách hỏi "có áp dụng ONLINE không?" -> câu riêng (chương trình chỉ tại showroom).
    if (_prog.cau_online && /(áp dụng|ap dung|có được|co duoc|đc|được)?\s*(cho|với|voi)?\s*(mua\s*)?(online|onl|đơn (hàng )?(online|onl)|đặt (hàng|online)|ship|trên (web|mạng|page|đây))/i.test(String(mem._lastCustText || "")) && /(online|onl|ship|đặt|dat|web|mạng|mang|trên đây|tren day)/i.test(String(mem._lastCustText || ""))) {
      return _prog.cau_online;
    }
    // Khách hỏi có sale/chương trình gì (mẫu nguyên giá) -> giới thiệu chương trình showroom NGUYÊN VĂN.
    return _prog.cau_gioi_thieu;
  }
  const no = [
    `Dạ bên em hiếm khi giảm giá lắm chị ạ, nên chờ sale thì gần như không có, mà ${_nmSale}là hàng thiết kế số lượng ít, để lâu dễ hết size mình thích. ${_tailNo}`,
    `Dạ shop ít khi sale lắm chị ạ, chờ giảm thì gần như không có ạ, mà ${_nmSale}là hàng thiết kế số lượng có hạn, để lâu dễ hết size mình ưng lắm. ${_tailNo}`,
    `Dạ giá đang là niêm yết rồi chị nha, bên em hiếm khi giảm giá, mà ${_nmSale}thiết kế làm số lượng ít nên nhanh hết size mình thích ạ. ${_tailNo}`,
  ];
  mem.discIdx = ((mem.discIdx || 0) + 1) % no.length;
  return no[mem.discIdx];
}
// ===== [CHỈ BÁO GIÁ 2026-07-21] Cờ TOP-LEVEL trong khuyen_mai.json, độc lập chương trình sale (không
// tự tắt theo het_han). true: bot chỉ báo giá + gửi ảnh (kể cả luồng bình luận), mọi thứ khác im + người.
function cheDoChiBaoGia() {
  try {
    const raw = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "khuyen_mai.json"), "utf8"));
    return raw.che_do_chi_bao_gia === true;
  } catch (_) { return false; }
}
// ===== [CHƯƠNG TRÌNH KM] Đọc khuyen_mai.json theo page (key pageId hoặc "default"), còn hạn mới trả về.
// Sửa file KHÔNG cần restart. Trả {ten, mo_ta, hanTxt} hoặc null.
function saleProgram(pageId) {
  try {
    const raw = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "khuyen_mai.json"), "utf8"));
    const p = raw[String(pageId || "")] || raw["default"];
    if (!p || !p.ten) return null;
    if (p.het_han && Date.now() > new Date(p.het_han).getTime()) return null;   // hết hạn -> tự tắt
    let hanTxt = "";
    try { const d = new Date(p.het_han); hanTxt = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; } catch (_) {}
    return { ten: p.ten, mo_ta: p.mo_ta || "ưu đãi lớn", hanTxt: hanTxt || "khi kết thúc chương trình",
      cau_gioi_thieu: p.cau_gioi_thieu || "", cau_online: p.cau_online || "", ap_dung_toan_bo: p.ap_dung_toan_bo === true,
      che_do_sale_gon: p.che_do_sale_gon === true, cau_kem_bao_gia: p.cau_kem_bao_gia || "", cau_tai_cua_hang: p.cau_tai_cua_hang || "" };
  } catch (_) { return null; }
}
function asksMoreDiscount(text) {
  const t = String(text || "").toLowerCase();
  return /(giảm thêm|bớt thêm|giảm nữa|bớt nữa|thêm tí|thêm chút|thêm xíu|mua (nhiều|\d+|hai|ba|2|3) (mẫu|bộ|cái|món).*(giảm|bớt)|(giảm|bớt).*(mua nhiều|\d+ (mẫu|bộ|cái))|sale thêm|fix thêm|giảm cho c đi|bớt cho)/i.test(t);
}

// Khách hỏi TỔNG TIỀN phải thanh toán: "của chị hết mấy", "tổng bao nhiêu", "hết bao nhiêu"...
function asksTotalPayment(text) {
  const t = String(text || "").toLowerCase();
  return /(hết (mấy|bao nhiêu|nhiêu)|tổng (hết|bao nhiêu|bao tiền|tiền|cộng|là bao|lại|bill)|tất cả (hết|bao nhiêu|là)|thanh toán (bao nhiêu|hết|mấy|tổng)|của (chị|c|em|mình) hết|all (bao nhiêu|nhiêu)|cộng (lại|hết) (bao nhiêu|là)|tổng bill|tính bill|chốt bill|bill (lại|nhiêu|bao nhiêu))/i.test(t);
}
function _fmtMoney(n) { return Number(n).toLocaleString("vi-VN").replace(/,/g, "."); }
function _priceNum(p) {
  const raw = String((p && (p.salePrice || p.price)) || "").replace(/[^\d]/g, "");
  return raw ? parseInt(raw, 10) : 0;
}
// Tính tổng đơn = tiền hàng (các mẫu đã báo) + ship (<500k +30k, >=500k freeship). known=false nếu thiếu giá.
// orderLines CHỈ áp dụng cho đúng mẫu đã chốt-dòng (tránh đơn cũ làm sai tổng đơn mẫu khác).
function _orderLinesActive(mem, productInfo) {
  if (!mem || !mem.orderLines || !mem.orderLines.length) return false;
  const codes = new Set((mem.quotedProducts || []).map(p => _up(p.code)));
  if (productInfo) codes.add(_up(productInfo.code));
  return !mem.orderLinesCode || codes.has(_up(mem.orderLinesCode));
}
function computeOrderTotal(mem, productInfo) {
  // ĐƠN THEO DÒNG (nhiều màu/size/số lượng) -> tính theo từng dòng, mỗi dòng có thể trùng mã.
  if (_orderLinesActive(mem, productInfo)) {
    const byCode = {};
    for (const p of (mem.quotedProducts || [])) byCode[_up(p.code)] = p;
    if (productInfo) byCode[_up(productInfo.code)] = productInfo;
    let sum = 0, known = true; const parts = [];
    for (const ln of mem.orderLines) {
      const p = byCode[_up(ln.code)] || productInfo || (mem.quotedProducts || [])[0];
      const v = _priceNum(p); const qty = Math.max(1, ln.qty || 1);
      if (!v) { known = false; }
      else {
        sum += v * qty;
        const extras = [ln.color, ln.size && sizeLabel(ln.size), qty > 1 ? "x" + qty : ""].filter(Boolean).join(" ");
        parts.push({ label: (productLabel(p) || "") + (extras ? " (" + extras + ")" : ""), price: v * qty });
      }
    }
    const ship = sum > 0 && sum < 500000 ? 30000 : 0;
    return { sum, ship, total: sum + ship, known, n: mem.orderLines.length, parts };
  }
  let items = (mem.quotedProducts && mem.quotedProducts.length) ? mem.quotedProducts
            : (productInfo ? [productInfo] : []);
  let sum = 0, known = items.length > 0;
  const parts = [];
  for (const p of items) {
    const v = _priceNum(p);
    if (!v) { known = false; } else { sum += v; parts.push({ label: productLabel(p), price: v }); }
  }
  const ship = sum > 0 && sum < 500000 ? 30000 : 0;
  return { sum, ship, total: sum + ship, known, n: items.length, parts };
}

// ===== PARSER ĐƠN NHIỀU DÒNG: "lấy s kem, m nâu" / "đen s, m xám" / "2 chiếc m" / "mỗi màu 1 chiếc" =====
// Trả [] nếu KHÔNG phải đơn nhiều dòng rõ ràng (để luồng size/màu CŨ xử lý, không phá).
function parseOrderLines(text, opts) {
  opts = opts || {};
  const colors = (opts.colors || []).map(c => ({ disp: c, f: normalizeViet(c) })).filter(c => c.f);
  const sizes = (opts.sizes && opts.sizes.length) ? opts.sizes : ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "FREESIZE"];
  const sizeFold = sizes.map(s => normalizeViet(s));
  const t = normalizeViet(text);
  if (/moi size/.test(t)) return sizes.map(s => ({ size: s.toUpperCase(), color: opts.askedColor || "", qty: 1 }));
  if (/moi mau/.test(t))  return colors.map(c => ({ size: opts.askedSize || "", color: c.disp, qty: 1 }));
  const chunks = t.split(/[,;\/]|\bva\b|\+|\bvoi\b/).map(s => s.trim()).filter(Boolean);
  const lines = [];
  for (const ch of chunks) {
    let qty = 1;
    const qm = ch.match(/(\d+)\s*(chiec|cai|bo|sp|san pham)\b/) || ch.match(/\bx\s*(\d+)\b/) || ch.match(/^(\d+)\b/);
    if (qm) qty = Math.max(1, parseInt(qm[1]));
    let size = null;
    for (const s of sizeFold) { if (s && new RegExp("(^|\\s)" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\s|$)").test(ch)) { size = s.toUpperCase(); break; } }
    let color = null;
    for (const c of colors) { if (ch.includes(c.f)) { color = c.disp; break; } }
    if (size || color || qty >= 2) lines.push({ size: size || "", color: color || "", qty });
  }
  if (lines.length >= 2) return lines;
  if (lines.length === 1 && lines[0].qty >= 2) return lines;
  return [];
}

// ===== VỚT ĐƠN: ghi nhớ các mẫu quote trong CÙNG PHIÊN (aging 3h) để hỏi khách lấy luôn mẫu còn lại =====
const _SESSION_MS = 3 * 3600 * 1000;
function rememberSessionProducts(mem, products) {
  mem.sessionProducts = (mem.sessionProducts || []).filter(p => Date.now() - (p.at || 0) < _SESSION_MS);
  for (const p of (products || [])) {
    if (!p || !p.code) continue;
    const ex = mem.sessionProducts.find(x => x.code === p.code);
    if (ex) { ex.at = Date.now(); ex.name = p.name || ex.name; ex.category = p.category || ex.category; }
    else mem.sessionProducts.push({ code: p.code, name: p.name || "", category: p.category || "", at: Date.now() });
  }
}
function otherSessionModels(mem, focusCode) {
  const now = Date.now();
  return (mem.sessionProducts || []).filter(p => p.code !== focusCode && p.name && now - (p.at || 0) < _SESSION_MS);
}
// CHỈ vớt đơn các mẫu CÒN BÁN (loại mẫu HẾT HÀNG / khoá / không bán). Tra tồn theo catalog.
async function sellableSessionModels(mem, focusCode) {
  const list = otherSessionModels(mem, focusCode);
  const out = [];
  for (const s of list) {
    try {
      const full = await catalogGetByCode(s.code);
      if (full && recommend.sellable(full) && !recommend.isOutOfStock(full)) out.push(s);
      // không tra được mẫu / hết hàng / khoá -> KHÔNG vớt (tránh mời mẫu đã hết).
    } catch (_) { /* lỗi tra -> bỏ qua mẫu này cho an toàn */ }
  }
  return out;
}
// Khách muốn lấy HẾT/CẢ các mẫu?
function wantsAllModels(text) {
  return /(cả (2|hai|ba|3|mấy)|lấy hết|lấy cả|tất cả|hết luôn|cả hai|cả ba|both|lấy tất|(2|hai|3|ba) (mẫu|cái|bộ|món)|nhiều mẫu)/i.test(String(text || ""));
}
// Khách TỪ CHỐI vớt đơn / chỉ lấy ĐÚNG 1 mẫu ("lấy 1 thui", "chỉ lấy Myda", "ko lấy mẫu kia").
function wantsOnlyOneModel(text) {
  const t = String(text || "").toLowerCase();
  if (wantsAllModels(t)) return false;
  return /(chỉ|chỉ mỗi|mỗi)\s*(lấy\s*)?(1|một|mình)?\s*(mẫu|cái|bộ|con|này)?\s*(thui|thôi)?|lấy\s*(1|một|mỗi)\s*(mẫu|cái|bộ|con|thui|thôi)|(1|một)\s*(mẫu|cái|bộ|con)\s*(thui|thôi|là đủ|đủ rồi)|lấy\s*mỗi|lấy\s*mình\s*(mẫu|cái|con|này)?|(ko|không|khỏi)\s*lấy\s*(thêm|mẫu (kia|khác)|cái kia|nữa)|lấy\s*\S+\s*(thui|thôi)\b/i.test(t);
}
// Khách CHỐT đúng các mẫu HỌ GỬI/đang xem ("lên đơn 2 mẫu chị gửi", "chốt 2 mẫu này") -> CHỈ lấy mẫu khách gửi, TỪ CHỐI vớt thêm.
function confirmsSentModels(text) {
  const t = String(text || "").toLowerCase();
  if (!/(lên\s*đơn|len\s*don|chốt|chot|lấy|order)/i.test(t)) return false;
  if (/(^|\s)(cả|tất cả|hết)\s*(\d+\s*)?(mẫu|cái|bộ|sản phẩm)/i.test(t)) return false;  // "lấy cả/hết N mẫu" = lấy HẾT (đồng ý vớt), không phải chốt-mẫu-gửi
  // (a) có SỐ LƯỢNG mẫu + "này/đó/gửi": "lên đơn 2 mẫu này", "chốt 2 mẫu chị gửi"
  if (/(\d+)\s*(mẫu|cái|bộ|sản phẩm)\s*(này|đó|kia|chị\s*gửi|khách\s*gửi|em\s*gửi|mình\s*gửi|đã\s*gửi|gửi)?\b/i.test(t)) return true;
  // (b) "mẫu (chị/khách/em) gửi" (không cần số)
  if (/(mẫu|cái|bộ|sản phẩm)\s*(chị|khách|em|mình)?\s*(đã\s*)?gửi\b/i.test(t)) return true;
  return false;
}

// Khách KHẲNG ĐỊNH đã gửi thông tin (sđt/địa chỉ) rồi: "trên mình gửi địa chỉ rồi đó", "sđt ở trên", "gửi rồi mà".
function claimsAlreadyGaveInfo(text) {
  const t = String(text || "").toLowerCase();
  if (/(địa chỉ|đc|sđt|sdt|số điện thoại|số đt|thông tin|info)\s*(của (mình|t|e|em) )?(ở |bên |phía )?(trên|trên kia|bên trên|phía trên|nãy|lúc nãy)|(trên|bên trên|phía trên|nãy|lúc nãy)\s*(mình |t |e |em )?(có )?(gửi|nhắn|cho|ghi|để|đưa)\s*(địa chỉ|đc|sđt|sdt|số điện thoại|thông tin)|(gửi|nhắn|cho|đưa|ghi|để)\s*(địa chỉ|đc|sđt|sdt|số điện thoại|thông tin)\s*(của (mình|t|e|em) )?(rồi|r)\b|(địa chỉ|sđt|sdt|số điện thoại|thông tin)\s*(gửi|nhắn|cho|đưa|ghi)?\s*(rồi|r)\s*(đó|mà|nha|nhé|nhá|kìa)?/i.test(t)) return true;
  // Mở rộng (trong ngữ cảnh đang xin info): nhắc VỊ TRÍ "ở trên/nãy ... rồi", hoặc ĐỘNG TỪ GỬI "(gửi/cho/đưa/cung cấp) ... rồi".
  if (/(ở |bên |phía )?(trên|trên kia|bên trên|phía trên|nãy|lúc nãy)[^.?!]{0,15}(rồi|\br\b)/i.test(t)) return true;
  if (/(gửi|nhắn|cho|đưa|ghi|để|cung cấp)[^.?!]{0,12}(rồi|\br\b)\s*(mà|đó|nha|nhé|nhá|kìa|rồi)?\s*$/i.test(t)) return true;
  return false;
}
// Khách muốn ship về ĐỊA CHỈ CŨ / như mọi khi (khách quen).
function wantsShipOldAddress(text) {
  const t = String(text || "").toLowerCase();
  // "ship về đấy/đó/này" = ship về địa chỉ ĐÃ NÓI trước đó (đại từ chỉ chỗ), KHÔNG kèm địa chỉ mới.
  if (/(ship|gửi|giao)\s*(về|tới|đến)\s+(đấy|đó|này)(?![\p{L}])/iu.test(t)) return true;
  return /(ship|gửi|giao|lên đơn)\s*(về |tới |đến )?(địa chỉ|đc|add)?\s*(cũ|trước|lần trước|mọi khi|hôm trước)|địa chỉ cũ|như (lần trước|cũ|mọi khi|mọi lần)|gửi về (chỗ|nơi|địa chỉ) (cũ|trước)/i.test(t);
}
// Khách HỎI shop đã có thông tin của mình chưa (câu nghi vấn): "có địa chỉ của chị rồi à?", "có sđt chưa?".
function asksIfHasInfo(text) {
  const t = String(text || "").toLowerCase();
  if (!/(à|chưa|hả|hử|chứ|rồi à|\?)/i.test(t)) return false;   // phải là câu hỏi
  return /(có|còn|lưu|nhớ|lấy|được)\s*(địa chỉ|đc|sđt|sdt|số điện thoại|số đt|thông tin|info)\s*(của (chị|mình|c|e|em) )?(rồi|sẵn|chưa)?/i.test(t);
}
const _COLOR_MAP = {
  trang: "trắng", den: "đen", do: "đỏ", vang: "vàng", hong: "hồng", nau: "nâu", tim: "tím",
  cam: "cam", ghi: "ghi", be: "be", xam: "xám", kem: "kem", xanh: "xanh", reu: "rêu",
  "xanh la": "xanh lá", "xanh duong": "xanh dương", "xanh reu": "xanh rêu", "xanh ngoc": "xanh ngọc",
  "trang nhat": "trắng nhạt", "hong nhat": "hồng nhạt", "tim than": "tím than", "xanh than": "xanh than",
  hongtim: "hồng tím", "hong tim": "hồng tím", xanhduong: "xanh dương", xanhla: "xanh lá", trangkem: "trắng kem"
};
function _normColor(tok) {
  const k = _unaccent(tok).trim().replace(/\s+/g, " ");
  if (_COLOR_MAP[k]) return _COLOR_MAP[k];
  return tok.trim().toLowerCase();
}
// Tách danh sách màu sạch từ trường color (bỏ ghi chú nội bộ: lưu ý / không nhận sx 1c / bán nốt tồn...).
function cleanColors(colorStr) {
  if (!colorStr) return [];
  return String(colorStr)
    .split(/[,\n;\/]+/)
    .map(s => s.trim())
    .filter(s => s && !/(luu y|khong nhan|sx ?1c|nhan sx|ban not|not ton|hang ton|chu y|note|xa ton)/i.test(_unaccent(s)))
    .map(_normColor)
    .filter(Boolean);
}
// ===== CHUẨN HOÁ tin khách TRƯỚC khi dò ý: viết tắt -> chữ đầy đủ + gộp ký tự lặp =====
// An toàn: KHÔNG bỏ dấu (tránh "hồng"->"hong", "đợi"->"doi"), KHÔNG đụng SỐ (sđt/giá/cân nặng).
// Chỉ nắn các viết tắt PHỔ BIẾN, ÍT NHẦM. Nhờ vậy mọi detector tự bắt được "ko/k/đc/sz/bn..."
// mà không phải liệt kê biến thể trong từng regex.
const _ABBREV_MAP = [
  [/(?<![\p{L}\p{N}])(ko+|kob|khong|khôg|khg|hok|hôk)(?![\p{L}\p{N}])/giu, "không"],
  [/(?<![\p{L}\p{N}])(?<!\d\s)k(?![\p{L}\p{N}])/giu, "không"],   // "k" đứng riêng = không (KHÔNG nắn "300 k" = 300 nghìn)
  [/(?<![\p{L}\p{N}])(đc|dc|duoc|đuoc|dươc)(?![\p{L}\p{N}])/giu, "được"],
  [/(?<![\p{L}\p{N}])(sz)(?![\p{L}\p{N}])/giu, "size"],
  [/(?<![\p{L}\p{N}])(bn|bnhiu)(?![\p{L}\p{N}])/giu, "bao nhiêu"],
  [/(?<![\p{L}\p{N}])(ntn)(?![\p{L}\p{N}])/giu, "như thế nào"],
  [/(?<![\p{L}\p{N}])(vs)(?![\p{L}\p{N}])/giu, "với"],
  [/(?<![\p{L}\p{N}])(sp)(?![\p{L}\p{N}])/giu, "sản phẩm"],
  [/(?<![\p{L}\p{N}])(mn)(?![\p{L}\p{N}])/giu, "mọi người"],
  [/(?<![\p{L}\p{N}])(sđt|sdt)(?![\p{L}\p{N}])/giu, "số điện thoại"],
  [/(?<![\p{L}\p{N}])(wa|qá)(?![\p{L}\p{N}])/giu, "quá"],
];
function normalizeViet(text) {
  // NFKC trước: gom chữ/số cách điệu (Unicode toán học) về ASCII thường (𝟬->0, 𝘾->C...).
  let t = String(text || "").normalize("NFKC").toLowerCase();
  // gộp ký tự CHỮ lặp 3+ lần -> 1 (đẹppp->đẹp, okkk->ok). KHÔNG đụng số (\p{L} loại chữ số).
  t = t.replace(/([\p{L}])\1{2,}/giu, "$1");
  for (const [re, full] of _ABBREV_MAP) t = t.replace(re, full);
  return t.replace(/\s+/g, " ").trim();
}
// ===== KHỚP MÀU THEO MÀU THẬT CỦA MẪU — bền với có/không dấu, có/không khoảng trắng, viết liền =====
// "Nâu vàng" / "nâu vàng" / "NAUVANG" / "nauvang" -> cùng KHOÁ "nauvang".
function _foldKey(s) {
  return String(s || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "");
}
// các MÀU ĐƠN (đã fold) để tách màu ghép ("nauvang" -> nau+vang, "camhong" -> cam+hong).
const _BASE_COLORS = ["xanh", "hong", "cam", "nau", "vang", "do", "den", "trang", "tim", "xam", "ghi", "be", "kem", "reu", "bac", "dat", "navy", "mint", "nude"];
function _baseTokensOf(foldKey) {
  const out = [];
  for (const b of _BASE_COLORS) if (foldKey.includes(b) && !out.includes(b)) out.push(b);
  return out;
}
// các "khoá màu" rút ra từ câu khách: mỗi TỪ + GHÉP 2 từ liền nhau (bắt "nâu vàng" -> "nauvang").
function _colorQueryKeys(text) {
  const words = String(text || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9\s]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const keys = new Set();
  for (let i = 0; i < words.length; i++) {
    keys.add(words[i]);
    if (i + 1 < words.length) keys.add(words[i] + words[i + 1]);
  }
  return { keys, words };
}
// Phân giải MÀU khách muốn dựa trên DANH SÁCH MÀU THẬT của mẫu.
//   modelColors: [{key, display}]   ->  {status:"one",color} | {status:"ask",colors} | {status:"none"}
function resolveColorForImages(text, modelColors) {
  const { keys, words } = _colorQueryKeys(text);
  const qBase = [];
  for (const w of words) for (const x of _baseTokensOf(w)) if (!qBase.includes(x)) qBase.push(x);

  const cands = [];
  for (const mc of modelColors) {
    const whole = keys.has(mc.key);
    const mcBase = _baseTokensOf(mc.key);
    const shared = mcBase.filter(b => qBase.includes(b));
    const pure = mcBase.length === 1 && mc.key === mcBase[0];
    if (whole || shared.length) cands.push({ key: mc.key, display: mc.display, whole, pure, shared: shared.length, len: mc.key.length });
  }

  const qHasColor = qBase.length > 0 || cands.some(c => c.whole);
  if (!qHasColor) {
    if (modelColors.length === 1) return { status: "one", color: modelColors[0] };
    return { status: "ask", colors: modelColors };       // không nêu màu + mẫu nhiều màu -> HỎI
  }
  if (!cands.length) return { status: "none" };           // khách nêu màu nhưng mẫu KHÔNG có

  const wholes = cands.filter(c => c.whole).sort((a, b) => b.len - a.len);
  if (wholes.length) {
    if (wholes.length === 1 || wholes[0].len > wholes[1].len) return { status: "one", color: wholes[0] };
    return { status: "ask", colors: wholes };             // nhiều khớp NGUYÊN cùng độ dài -> HỎI
  }
  if (cands.length === 1) return { status: "one", color: cands[0] };
  const pures = cands.filter(c => c.pure);
  if (pures.length === 1) return { status: "one", color: pures[0] };   // ưu tiên màu ĐƠN trùng token
  return { status: "ask", colors: cands };                // mơ hồ giữa nhiều màu -> HỎI
}
// Lấy ảnh ĐÚNG MÀU theo KHOÁ fold (khớp tên file, không phụ thuộc dấu/khoảng trắng).
function imageItemsByExactColor(code, foldKey, limit) {
  const out = [];
  for (const it of itemsByCode(code)) {
    let fk = _foldKey(colorFromName(it.name, it.code));
    // chịu lỗi: bỏ số đuôi thừa do đặt tên ("nauvang1" -> "nauvang")
    const fkTrim = fk.replace(/\d+$/, "");
    if (fk !== foldKey && fkTrim !== foldKey) continue;
    const url = it.downloadUrl || it.thumbnailUrl || null;
    if (!it.pancakeId && !url) continue;
    out.push({ contentId: it.pancakeId || null, url });
    if (out.length >= limit) break;
  }
  return out;
}
// Khách hỏi "có màu khác không / còn màu nào / có mấy màu"
function asksOtherColors(text) {
  const t = String(text || "").toLowerCase();
  if (asksWhichColorOrdering(t)) return false;   // "lên đơn màu gì" -> hỏi màu SẼ LÊN, không phải xin liệt kê
  return /(màu khác|còn màu (nào|gì|khác)?|màu nào (khác|nữa|không|ko)|màu gì|có màu gì|màu gì (khác|vậy|thế|nhỉ|ạ|không|ko)?|có (mấy|bao nhiêu|những) màu|những màu nào|mấy màu)/i.test(t);
}
// Khách hỏi "CÓ HÀNG SẴN KHÔNG / CÒN HÀNG KHÔNG" -> xác nhận có sẵn + CÂU HÀNH ĐỘNG (hỏi size / mời chốt).
function asksInStock(text) {
  const t = String(text || "").toLowerCase();
  if (/hết (hàng|sạch|size)/.test(t)) return false;
  return /(có|còn)\s*(hàng\s*)?(sẵn|sẵn hàng|hàng)\s*(ko|không|hông|k|chưa|nha|ạ|e|em|hông)?\b/.test(t)
    || /còn\s*hàng/.test(t) || /sẵn\s*hàng/.test(t)
    || /\bsẵn\s*(ko|không|hông|k|chưa|nha|ạ|e|em|nhỉ|hk)\b/.test(t)   // "này sẵn ko", "set này sẵn ko e"
    || /(này|đó|kia)\s*(còn|sẵn)\b/.test(t)
    || /(còn|có)\s*(cái|mẫu|con|bộ|váy|đầm|set|áo)\s*(này|đó)?\s*(ko|không|chưa)/.test(t);
}
// Khách muốn xem ẢNH CẢ NHIỀU MÀU ("gửi cả 2 màu", "gửi ảnh 2 màu", "gửi hết màu", "cho xem các màu").
function wantsAllColorsImages(text) {
  const t = String(text || "").toLowerCase();
  const wantView = /(gửi|gui|xem|coi|cho)/.test(t);
  const allColors = /(cả|hết|tất cả|các|mọi)\s*(2|hai|3|ba|mấy)?\s*màu|(2|hai|3|ba)\s*màu|tất cả các màu|từng màu/.test(t);
  return (wantView && allColors) || /(cả|tất cả|hết)\s*(2|hai|3|ba)?\s*màu/.test(t);
}
// "gửi cả 3 / gửi hết / cho xem cả 2" — muốn xem TẤT CẢ màu nhưng KHÔNG nói chữ "màu" (hiểu theo ngữ cảnh các màu vừa liệt kê).
// Loại trừ "cả 3 mẫu/cái/bộ" (đó là chọn MẪU, không phải màu) và bắt buộc có động từ xem ảnh để khỏi nhầm "lấy cả 3".
function wantsAllColorsLoose(text) {
  const t = String(text || "").toLowerCase();
  if (/(mẫu|cái|bộ|sản phẩm|\bsp\b)\b/.test(t)) return false;   // "cả 3 mẫu/cái" -> chọn MẪU, không phải màu
  if (!/(gửi|gui|xem|coi|cho)/.test(t)) return false;            // phải có ý XEM ẢNH
  if (/(^|\s)(cả|tất cả|hết)(\s|\d|$)/.test(t)) return true;
  // "gửi màu giúp mình", "gửi cho mình xem màu", "gửi các/từng màu" — KHÔNG nêu màu cụ thể, KHÔNG hỏi "màu này/đó/nào/gì" -> hiểu là GỬI HẾT MÀU
  if (/(gửi|gui|cho xem|cho coi|cho mình xem|cho mình coi)\b[^?]*\bmàu\b/.test(t)
      && !extractColor(t)
      && !/màu\s*(này|đó|kia|nào|gì)/.test(t)) {
    return true;
  }
  return false;
}
// Khách hỏi "EM LÊN ĐƠN MÀU GÌ" -> muốn biết màu BOT SẼ lên đơn (KHÔNG phải xin liệt kê các màu).
function asksWhichColorOrdering(text) {
  const t = String(text || "").toLowerCase();
  return /(lên đơn|lên|lấy|chốt|đặt|order)\s*(cho\s*(c|chị|em|mình)\s*)?màu\s*(gì|nào|j)/.test(t)
    || /(em|mình|c|chị)\s*(lên đơn|lên|lấy|chốt|đặt)\s*màu\s*(gì|nào|j)/.test(t)
    || /màu\s*(gì|nào|j)\s*(vậy|thế|đó|đấy)?\s*(mà\s*)?(em|mình|c|chị)\s*(lên|lấy|chốt|đặt|order)/.test(t);
}
// Khách hỏi "ẢNH/MẪU NÀY là màu GÌ" (ảnh vừa gửi) -> trả ĐÚNG 1 màu của ảnh, KHÔNG liệt kê hết.
// Phân biệt với "có mấy màu / có những màu nào" (liệt kê).
function asksWhatColorIsImage(text) {
  const t = foldVi(text);
  if (/(co|con) (may|nhung|bao nhieu)? ?mau|may mau|nhung mau nao|bao nhieu mau|mau khac|mau nao khac|con mau/.test(t)) return false; // hỏi LIỆT KÊ -> không phải
  return /(mau (nay|anh|hinh|do|ben tren)|anh (nay|do|em gui|ban gui|tren|vua gui)|hinh (nay|em gui)).{0,22}(la )?(mau )?gi\b/.test(t)
      || /(day|cai nay|tren) la mau gi/.test(t)
      || /^\s*mau gi\b/.test(t);
}
// Khách KHÔNG ƯNG MÀU đang xem (chê màu / muốn màu khác) -> kích hoạt PHƯƠNG ÁN 2 (pitch màu còn lại).
function dislikesColor(text) {
  const t = String(text || "").toLowerCase();
  return /(không|ko|hông|chẳng|hong) ?(thích|ưng|hợp|thik|khoái).{0,14}màu|màu (này|đó|kia|đen|trắng|hồng|đỏ|vàng)? ?(không|ko|chẳng|hông)[^?]{0,12}(thích|ưng|hợp|đẹp|được|nổi)|màu (này|đó|kia) (xấu|chán|tối|sến|kì|kỳ|nhạt quá|chìm)|(đổi|qua|sang|lấy) màu khác|màu khác (đi|cơ|hơn|coi|xem)|(không|ko) hợp màu|màu (không|ko) hợp|chê màu/i.test(t);
}
// Khách PHẢN ÁNH báo giá CHƯA ĐỦ MẪU (gửi nhiều mẫu mà bot mới báo 1 phần) -> phải để NGƯỜI THẬT bổ sung, KHÔNG đoán.
function complainsMissingModel(text) {
  const t = String(text || "").toLowerCase();
  return /(chưa\s*(báo\s*)?(giá\s*)?đủ\s*(các\s*)?mẫu|thiếu\s*\d*\s*mẫu|còn\s*mẫu[^?]{0,24}(đã\s*đủ\s*đâu|chưa\s*(báo|đủ)|còn\s*lại|nữa\s*mà)|đủ\s*mẫu\s*(đâu|chưa|chứ)|báo\s*giá[^?]{0,20}(chưa\s*đủ|thiếu)|chưa\s*báo\s*(hết|đủ)\s*(giá\s*)?mẫu|báo\s*(thiếu|sót)\s*mẫu|sót\s*mẫu)/i.test(t);
}
// Khách hỏi ĐỒ ĐI BIỂN ("váy đi biển", "mẫu mặc đi biển", "đồ tắm biển") -> gửi mẫu cột U="Biển". Loại "xanh biển" (màu).
function asksBeachWear(text) {
  const t = String(text || "").toLowerCase();
  // "xanh biển" là MÀU -> chỉ tính đi biển nếu có ngữ cảnh đi/mặc/tắm biển rõ ràng.
  if (/xanh\s*biển/.test(t) && !/(đi|ra|mặc|tắm|du lịch|nghỉ mát)\s*biển|biển\s*(xem|mặc|chơi|sao)/.test(t)) return false;
  return /(đi|ra)\s*biển|mặc\s*(đi\s*)?biển|tắm\s*biển|du\s*lịch\s*biển|(đồ|váy|đầm|set|áo|quần|bộ)\s*(đi\s*)?biển|biển\s*(xem sao|mặc|chơi)|đi\s*nghỉ\s*mát|nghỉ\s*mát\s*biển/i.test(t);
}
// Chủng loại khách muốn cho đồ đi biển (rỗng = mọi loại -> nhặt ngẫu nhiên).
function _beachCatWanted(text) {
  const t = String(text || "").toLowerCase();
  if (/\bset\b|set /.test(t)) return "set";
  if (/\bváy\b|\bđầm\b|váy |đầm /.test(t)) return "vay";
  if (/\báo\b|áo /.test(t)) return "ao";
  if (/\bquần\b|quần |chân váy/.test(t)) return "quan";
  return "";
}
// Khách muốn xem ẢNH MẶT SAU / sau lưng của mẫu ("cho xem đằng sau", "ảnh phía sau", "mặt lưng").
function wantsBackView(text) {
  const t = String(text || "").toLowerCase();
  return /(mặt sau|phía sau|đằng sau|sau lưng|đăng sau|mặt lưng|lưng váy|lưng áo|đằng lưng|behind|back|ảnh sau|hình sau|xem sau|chụp sau|góc sau|từ sau|phần lưng|sau ạ|phía lưng)/i.test(t);
}
function asksSimilarModels(text) {
  const t = String(text || "").toLowerCase();
  if (asksNewCollection(t)) return false;   // "mẫu mới/BST mới" -> KHÔNG phải "tương tự", để handler mẫu-mới (cột T) lo
  // cho phép 1 từ loại đồ chen giữa: "mẫu VÁY tương tự", "mẫu ĐẦM giống", "vài mẫu váy tương tự"...
  return /(mẫu\s+(nào\s+)?(váy|đầm|set|áo|quần|sản phẩm|này\s+)?(tương tự|tương tợ|giống|na ná|tương đương)|(váy|đầm|set|áo|quần)\s+(nào\s+)?(tương tự|tương tợ|giống|na ná)|mẫu khác|mẫu nào khác|thêm (vài |mấy )?mẫu|xem thêm mẫu|còn mẫu nào|kiểu khác|dáng khác|gợi ý mẫu|tư vấn thêm mẫu)/i.test(t);
}
// Khách xin xem MẪU MỚI / BST MỚI / hàng mới (cột T = "mới"), KHÔNG phải "mẫu tương tự mẫu đang xem".
function asksNewCollection(text) {
  const t = String(text || "").toLowerCase();
  return /(mẫu|hàng|đồ|bộ|váy|đầm|set|áo)\s*(mới|moi)\b|mẫu mới|hàng mới|bst mới|bộ sưu tập mới|có gì mới|gì mới (không|ko|hông|ạ|nhỉ)|mẫu nào mới|mới nhất|mẫu mới nhất|new\b/i.test(t);
}
// Khách NHỜ TƯ VẤN CHỌN 1 trong các mẫu ĐÃ xem ("mẫu nào đẹp", "nên lấy mẫu nào") -> KHÔNG gửi mẫu mới,
// mà CHỌN 1 mẫu đã xem + khen + chốt nhẹ. Phân biệt với "mẫu khác/tương tự" (xin mẫu mới).
function asksAdviceAmongShown(text) {
  const t = String(text || "").toLowerCase();
  if (/(mẫu|cái|con|bộ) (nào )?(khác|tương tự|mới|giống)/i.test(t)) return false;   // xin mẫu MỚI -> không phải
  if (asksWhichColorNicer(t)) return false;   // hỏi MÀU nào đẹp -> KHÔNG phải hỏi MẪU
  return /(mẫu|cái|con|bộ|váy|đầm|set|áo) nào (đẹp|xinh|hợp|ổn|được|ưng|nên|hơn)|(đẹp|xinh|hợp) (hơn|nhất)( ạ| e| nhỉ|\?|$)|nên (lấy|chọn|mua) (mẫu |cái |con |bộ )?nào|(e|em|c|chị) thấy (mẫu |cái |con |bộ )?nào (đẹp|xinh|hợp|hơn|nên|ổn)|tư vấn (giúp |cho )?(em |chị )?(xem )?(mẫu |cái )?nào (đẹp|hợp|nên)/i.test(t);
}
// Khách hỏi MÀU NÀO đẹp/hợp hơn (đang phân vân MÀU của mẫu đang xem) -> tư vấn MÀU, KHÔNG recommend mẫu.
function asksWhichColorNicer(text) {
  const t = String(text || "").toLowerCase();
  if (/(mẫu|cái|con|bộ|váy|đầm|set|áo|dáng|kiểu)\s*nào/.test(t)) return false;   // hỏi MẪU -> không phải
  if (asksSkinToneFit(t)) return false;   // hỏi MÀU hợp DA -> để handler tông da lo
  if (/màu\s*nào\b[\s\S]{0,24}(đẹp|xinh|hợp|hơn|ổn|nên|ưng|nổi|tôn|sang)/.test(t)) return true;  // "màu nào (mặc ngoài) đẹp hơn"
  return /màu\s*nào\s*(đẹp|xinh|hợp|nên|ổn|hơn|được|ưng|lấy)|màu\s*(nào|gì)\s*(thì\s*)?(đẹp|hợp|hơn|ổn)|(nên|chọn|lấy)\s*màu\s*nào/.test(t);
}
// Khách hỏi MÀU có HỢP VỚI LÀN DA của mình không ("da em ngăm mặc kem ổn ko", "da đen hợp màu gì").
// QUAN TRỌNG: "đen/ngăm" ở đây là TÔNG DA của khách, KHÔNG phải MÀU để gửi ảnh.
function asksSkinToneFit(text) {
  const t = String(text || "").toLowerCase();
  if (!/\b(da|làn da|nước da)\b/.test(t)) return false;            // phải nhắc tới DA
  if (!/(đen|ngăm|nâu|sạm|tối|trắng|sáng|bánh mật)/.test(t)) return false;   // tông da
  return /(màu|mặc|hợp|ổn|đẹp|tông|hơn|nào|được)/.test(t);
}
// Tông da NGĂM/ĐEN? (để chọn câu tư vấn)
function _isDarkSkin(text) {
  return /(đen|ngăm|nâu|sạm|tối|bánh mật)/.test(String(text || "").toLowerCase());
}
// Đặc tính từng màu (để tư vấn có chiều sâu, theo foldKey)
const COLOR_TRAIT = {
  tim: "nổi bật", kem: "nhẹ nhàng thanh lịch", den: "sang trọng cá tính", trang: "tinh khôi trẻ trung",
  hong: "ngọt ngào nữ tính", xanh: "trẻ trung mát mắt", nau: "ấm áp trầm tính", vang: "tươi sáng nổi bật",
  be: "nhã nhặn dễ phối", cam: "năng động", do: "rực rỡ nổi bật", xam: "tối giản hiện đại", ghi: "tối giản hiện đại",
  xanhden: "trầm sang", xanhthan: "trầm sang", nauvang: "ấm và nổi bật",
};
// Màu TRUNG TÍNH/DỄ ỨNG DỤNG -> ưu tiên gợi ý là "bán chạy" khi khách phân vân.
const _NEUTRAL_KEYS = ["kem", "be", "trang", "den", "nau", "xam", "ghi"];
function _traitOf(key) { return COLOR_TRAIT[key] || "rất xinh và tôn dáng"; }
// Màu gợi ý (ưu tiên màu trung tính) trong các màu của mẫu.
function recommendedColorOf(colsDisplay) {
  const cols = colsDisplay.map(c => ({ disp: String(c).toLowerCase(), key: _foldKey(c) }));
  const rec = cols.find(c => _NEUTRAL_KEYS.includes(c.key)) || cols[0];
  return rec ? rec.disp : "";
}
// Danh sách màu để NÓI VỚI KHÁCH: ưu tiên cột N (sheet, tách bằng dấu phẩy); trống mới lấy từ tên ảnh.
function colorListForModel(product, code) {
  const sheet = cleanColors(product && product.color);
  if (sheet.length) return sheet;                       // cột N là nguồn chuẩn ("Hồng cam" = 1 màu)
  const byKey = new Map();
  for (const c of (getCodeColors(code) || [])) { const k = _foldKey(c); if (k && !byKey.has(k)) byKey.set(k, c); }
  return [...byKey.values()];
}
// Màu NGHIÊNG theo TÔNG DA: da ngăm -> tông sáng/trung tính; da sáng -> tông trầm/ấm ("trông tây").
function colorForSkin(colsDisplay, dark) {
  const cols = colsDisplay.map(c => ({ disp: String(c).toLowerCase(), key: _foldKey(c) }));
  if (!cols.length) return "";
  const LIGHT = ["kem", "be", "trang", "pastel", "nau"];
  const RICH = ["nau", "do", "den", "tim", "reu", "navy", "xanhden", "xanhthan", "dat"];
  const pref = dark ? LIGHT : RICH;
  for (const p of pref) { const f = cols.find(c => c.key === p || c.key.includes(p)); if (f) return f.disp; }
  return cols[0].disp;
}
// Dựng câu tư vấn MÀU có ĐỊNH HƯỚNG, NGẮN GỌN: đặc tính từng màu + gợi ý lấy màu bán chạy.
function colorAdviceReply(colsDisplay) {
  const cols = colsDisplay.map(c => ({ disp: String(c).toLowerCase(), key: _foldKey(c) }));
  if (cols.length >= 2) {
    const rec = cols.find(c => _NEUTRAL_KEYS.includes(c.key)) || cols[0];
    // Nhận xét ĐỦ TẤT CẢ màu (mỗi màu 1 nét), rồi NGHIÊNG HẲN về 1 màu nên lấy.
    const traits = cols.map(c => `${c.disp} ${_traitOf(c.key)}`).join(", ");
    return `Dạ ${traits} ạ — màu nào cũng có nét riêng. Em thấy màu ${rec.disp} dễ phối đồ và được nhiều khách chọn hơn, chị lấy ${rec.disp} nha`;
  }
  if (cols.length === 1) return `Dạ mẫu này có màu ${cols[0].disp} ạ, lên dáng xinh lắm. Chị ưng em lên đơn cho mình nha`;
  return `Dạ màu nào của mẫu này cũng xinh ạ, chị thích tông nào em tư vấn kỹ màu đó cho mình nha`;
}

// ===== ĐỊA CHỈ KHÁCH (chống bịa) =====
function _unaccent(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();
}
const VN_PROVINCES = ["ha noi","ho chi minh","sai gon","hcm","tphcm","da nang","hai phong","can tho",
  "bac giang","bac ninh","hai duong","hung yen","quang ninh","thai nguyen","nam dinh","thai binh",
  "ninh binh","thanh hoa","nghe an","ha tinh","hue","quang nam","binh dinh","khanh hoa","nha trang",
  "da lat","lam dong","dak lak","gia lai","binh duong","dong nai","vung tau","ba ria","long an",
  "tien giang","ben tre","vinh long","an giang","kien giang","ca mau","bac lieu","soc trang","tay ninh",
  "binh phuoc","binh thuan","ninh thuan","phu yen","quang ngai","quang tri","quang binh","ha nam",
  "vinh phuc","phu tho","bac kan","cao bang","lang son","tuyen quang","yen bai","lao cai","dien bien",
  "lai chau","son la","hoa binh","ha giang"];
// Trả về tên tỉnh (không dấu) nếu tin nhắn có nhắc 1 tỉnh/thành; null nếu không.
function mentionedShipProvince(text) {
  const u = " " + _unaccent(text) + " ";
  const abbr = { "bg": "bac giang", "sg": "ho chi minh", "hn": "ha noi", "hcm": "ho chi minh", "tphcm": "ho chi minh", "tp hcm": "ho chi minh", "hp": "hai phong", "dn": "da nang" };
  const list = VN_PROVINCES.concat(Object.keys(abbr));
  for (const p of list) if (u.includes(" " + p + " ") || u.includes(" " + p + ",") || u.includes(" " + p + ".")) {
    return abbr[p] || p;
  }
  return null;
}
// Tỉnh giao hàng (CHỈ tính khi có ngữ cảnh gửi/giao/nhận, tránh nhầm câu hỏi địa chỉ SHOP).
function shipContextProvince(text) {
  const t = String(text || "").toLowerCase();
  if (/bên em|shop|cửa hàng|showroom|cơ sở|chi nhánh/i.test(t)) return null; // hỏi địa chỉ shop -> bỏ qua
  // HỎI THỜI GIAN giao ("ship về X mấy ngày", "giao tới X bao lâu") -> KHÔNG phải khai địa chỉ giao -> bỏ qua.
  if (/(mấy ngày|bao lâu|bao nhiêu ngày|mấy hôm|khi nào (nhận|có|giao|tới|về)|ngày nào (nhận|có)|lâu (không|ko)|nhanh (không|ko|hơn))/i.test(t)) return null;
  if (!/(gửi|giao|ship|chuyển|nhận|về|đến|tới|address|địa chỉ)/i.test(t)) return null;
  return mentionedShipProvince(text);
}
// Địa chỉ đã KHỚP tỉnh giao chưa? Nhận cả viết tắt (vd "458 Minh khai HN" khớp "ha noi").
function addressMatchesShipProvince(address, shipProvince) {
  if (!shipProvince) return true;
  const ap = mentionedShipProvince(address);   // bắt cả HN/SG/HCM...
  if (ap && ap === shipProvince) return true;
  return _unaccent(address || "").includes(shipProvince);
}
// ===== ĐỊA CHỈ 3 TẦNG: (1) chi tiết số nhà/thôn/ngõ  (2) phường/xã/thị trấn (hoặc quận/huyện)  (3) tỉnh/thành =====
// Map tỉnh/thành + suy luận quận/huyện -> tỉnh dùng vn_address (cập nhật sáp nhập 1/7/2025, có token ambiguous).
function _foldAddr(s) { return _va.fold(s); }
// Phân loại 3 tầng -> { hasDetail, hasWard, province (rõ, display), inferred (suy luận, display), ambiguous (token), missing[] }.
// Địa chỉ CÓ tên ĐƯỜNG/KHU cụ thể (số nhà + tên địa danh) không? Dùng cho địa chỉ thực tế mà tên
// phường/đường KHÔNG nằm trong map 2025 (vd "36 Hoàng Cầu") -> vẫn coi là có cấp khu vực, giao được.
function _hasStreetName(addr) {
  const raw = String(addr || "");
  const folded = _va.fold(raw);
  // chỉ xét khi TRÔNG như 1 dòng địa chỉ (có số nhà hoặc từ khoá đường/ngõ) -> tránh khớp câu vu vơ.
  const looksAddr = /\d/.test(raw) || /\b(ngo|ngach|hem|kiet|duong|so nha|thon|xom|to |doi |ban |khu)\b/.test(folded);
  if (!looksAddr) return false;
  let f = " " + folded + " ";
  const pk = _va.explicitProvince(folded);
  if (pk) { const d = _va.fold(_va.provinceDisplay(pk)); f = f.split(" " + d + " ").join(" "); }
  f = f.replace(/\b(so nha|so|nha|ngo|ngach|hem|kiet|duong|to|doi|ban|khu pho|khu|kp|tp|cho|gui|ve|chi|minh|nhe)\b/g, " ");
  f = f.replace(/[^a-z\s]/g, " ");           // bỏ số + ký tự lạ, chỉ giữ chữ
  return f.split(/\s+/).filter(t => t.length >= 2).length >= 1;   // còn ≥1 từ -> là tên đường/khu
}
function addressTiers(addr) {
  const a = String(addr || "").trim();
  const f = _foldAddr(a).replace(/[.,;]+/g, " ").replace(/\s+/g, " ").trim();   // BỎ dấu câu để dò tỉnh/phường (vd "ninh binh." -> "ninh binh", trước đây dấu chấm làm mất tỉnh)
  const hasDetail = /\d/.test(a) || /\b(thon|xom|ngo|ngach|hem|kiet|so nha|to |doi |ban |khu pho|khu )\b/.test(f);
  const provKey = _va.explicitProvince(f);
  const province = provKey ? _va.provinceDisplay(provKey) : null;
  const inf = province ? null : _va.inferProvince(f);
  const inferred = inf && inf.province ? inf.province : null;
  const ambiguous = inf && inf.ambiguous ? inf.ambiguous : null;
  const candidates = inf && inf.candidates ? inf.candidates : null;   // các TỈNH trùng tên khu vực (để hỏi gợi ý)
  // Có SEGMENT tên riêng Ở GIỮA (số nhà/đường ... TÊN ... tỉnh) -> coi như CÓ phường/xã: khách hay ghi TÊN phường
  //   mà KHÔNG kèm chữ "phường" (vd "... Ninh Khánh. Ninh Bình" -> Ninh Khánh là phường). Cần đã có tỉnh + số nhà.
  const _segs = a.split(/[.,]/).map(s => s.trim()).filter(Boolean);
  const _wardImplied = (!!province || !!inferred) && hasDetail && _segs.length >= 3;
  const hasWard = /\b(phuong|xa|thi tran|\btt\b)\b/.test(f) || /\b(quan|huyen|thi xa|\btx\b)\b/.test(f) || /\bp\.? ?\d/.test(f) || !!inferred || !!ambiguous || _va.hasAreaToken(f) || _wardImplied;
  const hasStreet = _hasStreetName(a);   // có tên ĐƯỜNG/khu (số nhà + địa danh) — KHÔNG thay cho phường/xã, chỉ để biết là 1 địa chỉ mới
  const missing = [];
  if (!hasDetail) missing.push("số nhà (hoặc thôn/xóm/ngõ)");
  if (!hasWard) missing.push("phường/xã");
  if (!province && !inferred && !ambiguous) missing.push("tỉnh/thành phố");
  return { hasDetail, hasWard, hasStreet, province, inferred, ambiguous, candidates, missing };
}
// Địa chỉ ĐỦ GIAO chưa? Cần ĐỦ 3 TẦNG + tỉnh XÁC ĐỊNH ĐƯỢC.
//  - tỉnh RÕ (ghi thẳng/viết tắt) HOẶC suy ra 1 tỉnh DUY NHẤT từ phường/quận (inferred) -> ĐỦ, KHÔNG hỏi.
//  - chỉ MƠ HỒ (ambiguous: khu vực trùng nhiều tỉnh) mới CHƯA đủ -> phải hỏi khách ở tỉnh nào.
function isDeliverableAddress(addr) {
  const a = String(addr || "").trim();
  if (!a || isGarbageAddress(a)) return false;
  const t = addressTiers(a);
  return t.hasDetail && t.hasWard && (!!t.province || !!t.inferred) && a.replace(/[^\p{L}\p{N}]/gu, "").length >= 10;
}
// [AI QUYẾT ĐỊNH] Địa chỉ đã ĐỦ GIAO chưa. Nguyên tắc AN TOÀN: AI chỉ được phép NỚI ("đủ rồi, thôi hỏi")
//   để chặn cảnh regex xin đi xin lại; AI KHÔNG được ép "thiếu" (tránh chặn nhầm đơn). AI im/timeout -> regex đỡ y cũ.
//   Nếu AI thấy tỉnh/thành thuộc diện SÁP NHẬP (province_confirm) -> CHƯA ready, phải hỏi xác nhận (phương án B).
function addrReady(mem) {
  // [FIX Mỹ Linh] cờ AI chấm lại mỗi lượt -> chỉ chặn khi CHƯA hỏi xác nhận + địa chỉ CHƯA có tỉnh rõ
  //   (explicitProvince nhận cả tên tỉnh CŨ và tự map sang tỉnh mới) — hết cảnh addrReady=false vĩnh viễn.
  if (mem && mem._aiProvinceConfirm && !mem._provConfirmDone
      && !(mem.address && _va.explicitProvince(_va.fold(mem.address)))) return false;  // cần xác nhận tỉnh mới -> chưa xong (phương án B)
  if (mem && mem._aiAddrComplete === true) return true;                             // AI phán ĐỦ -> tin
  if (mem && mem._aiAddrComplete === false && mem._aiIsAddress) return false;       // AI phán THIẾU (chỉ khi tin ĐÚNG là địa chỉ) -> hỏi thêm
  return isDeliverableAddress(mem && mem.address);                                  // AI không phán / tin không phải địa chỉ -> regex đỡ (như cũ)
}
// Rác RÕ RÀNG (ký tự lạ / data catalog: mã/giá/màu/PU/số giá) -> nên XOÁ khỏi mem.
function isGarbageAddress(addr) {
  const a = String(addr || "").trim();
  return /[<>=⁄^~`|\\]/.test(a) || /(\bm[ãa]\b\s*[:#]|gi[áa]\s*[:]|\bgiá\b|\d\s*m[àa]u|\bpu\b|size\s*[:]|sản phẩm|\d{1,3}[.,]\d{3})/i.test(a);
}
// GỘP địa chỉ khi khách cho RỜI RẠC (vd tin trước "nhà 7 ngõ 595/31 ... Hà Nội", tin sau "phường hoàng mai").
// KHÔNG ghi đè mất phần cũ. Tin mới đã đủ giao -> dùng tin mới; cũ chứa mới (hoặc ngược) -> bỏ trùng; còn lại -> nối.
function mergeAddr(oldA, newA) {
  const o = String(oldA || "").trim(), n = String(newA || "").trim();
  if (!o) return n;
  if (!n) return o;
  const fo = _va.fold(o), fn = _va.fold(n);
  if (fo.includes(fn)) return o;                 // tin mới đã nằm trong địa chỉ cũ -> giữ cũ
  if (fn.includes(fo)) {
    // tin mới bao trùm cũ -> dùng mới, NHƯNG nếu cũ có số nhà mà mới KHÔNG -> nối để khỏi mất số nhà.
    if (/\d/.test(o) && !/\d/.test(n)) return (o.replace(/[.,\s]+$/, "") + ", " + n).replace(/\s+/g, " ").trim();
    return n;
  }
  return (o.replace(/[.,\s]+$/, "") + ", " + n).replace(/\s+/g, " ").trim();   // nối thêm phần mới
}
// Quyết định GỘP hay THAY khi có tin địa chỉ mới:
//  - tin mới TỰ ĐỦ giao -> dùng tin mới;
//  - đang THU THẬP (địa chỉ cũ CHƯA đủ) -> GỘP thêm (vá lỗi hỏi vòng vòng);
//  - địa chỉ cũ ĐÃ đủ -> giữ hành vi cũ (thay = coi như đổi địa chỉ).
function _mergeIfPartial(oldA, newA) {
  if (!newA) return oldA;
  if (!oldA) return newA;
  if (isDeliverableAddress(newA)) return newA;            // tin mới tự đủ giao -> dùng mới
  const tn = addressTiers(newA);
  const to = addressTiers(oldA);
  // [FIX Linh Ngân] Khách cho địa chỉ RỜI RẠC nhiều tin (vd "458 Minh Khai" -> "Hà Nội" -> "Hai Bà Trưng"
  //   -> "Phường Hai bà trưng đó"). Nếu cũ CÒN THIẾU phần CHI TIẾT (số nhà) mà tin mới KHÔNG có số nhà,
  //   thì tin mới chỉ là MẢNH bổ sung -> luôn GỘP, KHÔNG được thay mất phần số nhà/đường đã có.
  if (to.hasDetail && !tn.hasDetail) return mergeAddr(oldA, newA);
  // Tin mới là 1 ĐỊA CHỈ MỚI tự thân (CÓ số nhà + CÓ phường/khu HOẶC tên đường) -> coi là ĐỔI địa chỉ,
  // THAY hẳn cái cũ (rồi hỏi nốt phần thiếu). Tránh giữ nhầm địa chỉ cũ khi khách đổi đường khác.
  if (tn.hasDetail && (tn.hasWard || tn.hasStreet)) return newA;
  // Tin mới chỉ là MẢNH bổ sung (chỉ có phường, hoặc chỉ có tỉnh...):
  if (!isDeliverableAddress(oldA)) return mergeAddr(oldA, newA);   // cũ chưa đủ -> gộp thêm mảnh
  return tn.province ? newA : oldA;                       // cũ đã đủ: mảnh có tỉnh riêng -> thay; không -> giữ cũ
}
// Câu HỎI phù hợp khi địa chỉ CHƯA đủ giao. Trả null nếu đã đủ.
//  - Thiếu tầng -> xin đúng phần thiếu.
//  - SUY LUẬN được tỉnh (chắc) nhưng khách chưa ghi -> HỎI XÁC NHẬN tỉnh (set mem._addrConfirmProv).
//  - Khu vực TRÙNG nhiều tỉnh (ambiguous) -> KHÔNG đoán, HỎI THẲNG khách ở tỉnh/thành nào.
function addressGapReply(addr, mem) {
  // [PHƯƠNG ÁN B] AI thấy tỉnh/thành thuộc diện SÁP NHẬP -> hỏi xác nhận tỉnh/thành MỚI cho chuẩn.
  // [FIX Mỹ Linh 2026-07-07] Cờ _aiProvinceConfirm được AI CHẤM LẠI MỖI LƯỢT từ ngữ cảnh (địa chỉ vẫn chứa
  //   tên tỉnh cũ "Hà Nam") -> lượt nào cũng hỏi lại "TỈNH/THÀNH nào ạ?" kể cả khi khách ĐÃ trả lời "Ninh Bình"
  //   và code đã ghép tỉnh vào địa chỉ -> LẶP VÔ HẠN. Sửa: (a) địa chỉ đã có tỉnh RÕ (kể cả tên CŨ —
  //   explicitProvince tự map sang tỉnh mới, đúng thiết kế vn_address "tên cũ = đủ, KHÔNG hỏi") -> KHÔNG hỏi;
  //   (b) chỉ hỏi TỐI ĐA 1 lần/hội thoại (cờ bền _provConfirmDone) — câu trả lời do nhánh _addrAwaitProvince tiêu thụ.
  if (mem && mem._aiProvinceConfirm && !mem._provConfirmDone
      && !(addr && _va.explicitProvince(_va.fold(addr)))) {
    mem._provConfirmDone = true;
    mem._addrAwaitProvince = true;
    return "Dạ khu vực của mình có thay đổi tên tỉnh/thành theo cập nhật hành chính mới, chị xác nhận giúp em địa chỉ đang ở TỈNH/THÀNH PHỐ nào ạ? 🥰";
  }
  if (mem && mem._aiAddrComplete === true) return null;   // AI phán đủ -> không hỏi lại
  if (isDeliverableAddress(addr)) return null;
  if (isGarbageAddress(addr)) { if (mem) mem.address = null; }
  const t = addressTiers(addr);
  // Suy ra 1 tỉnh DUY NHẤT từ phường/quận -> ĐÃ tính là deliverable ở trên (return null), KHÔNG hỏi xác nhận nữa.
  //  Chỉ còn hỏi khi MƠ HỒ: khu vực trùng nhiều tỉnh (ambiguous) -> hỏi thẳng khách ở tỉnh/thành nào.
  if (t.hasDetail && t.hasWard && !t.province && t.ambiguous) {
    if (mem) { mem._addrConfirmProv = null; mem._addrAwaitProvince = true; mem._addrProvCandidates = t.candidates || null; }
    const cand = (t.candidates || []);
    const opt = cand.length >= 2 ? ` (em thấy có ở ${cand.slice(0, 3).join(", ")})` : "";
    return `Dạ khu vực này có ở vài tỉnh/thành nên em xin xác nhận: địa chỉ của chị ở TỈNH/THÀNH PHỐ nào ạ?${opt} 🥰`;
  }
  const miss = t.missing.length ? t.missing : ["địa chỉ cụ thể (số nhà, phường/xã, tỉnh/thành)"];
  return `Dạ chị cho em xin thêm ${miss.join(", ")} để em ghi địa chỉ giao cho chuẩn nha ạ`;
}
function cleanAddress(addr) {
  let a = String(addr || "").trim();
  // (0) Có cụm "địa chỉ / đ.c / đc" -> địa chỉ THẬT nằm SAU cụm cuối cùng
  //     (vd "lên đơn cho chị 2 mẫu này về địa chỉ 105 Bà Triệu" -> "105 Bà Triệu").
  const am = [...a.matchAll(/(địa\s*chỉ|dia\s*chi|đ\s*\.?\s*c|d\s*\/?\s*c|đ\/c)\s*[:\-]?\s*/gi)];
  if (am.length) {
    const last = am[am.length - 1];
    const after = a.slice(last.index + last[0].length).trim();
    if (after) a = after;
  }
  let prev;
  do {
    prev = a;
    a = a.replace(/^(dạ|vâng|à|ờ|ừ)\s+/i, "");
    a = a.replace(/^(e|em|c|chị|chi|t|tôi|toi|mình|minh|con|bạn|ban)\s+/i, "");
    // câu chốt kèm địa chỉ: "lên đơn cho chị (2 mẫu này) về/giao ..." -> bỏ tới sau "về/giao/ship/gửi/đến"
    a = a.replace(/^(lên\s*đơn|len\s*don|lấy|order|chốt|chot)\b[^0-9]*?(về|ve|giao|ship|gửi|gui|đến|den|tới|toi)\s+/i, "");
    a = a.replace(/^(ship|gửi|gui|giao|chuyển|chuyen)\s*(về|ve|den|đến|toi|tới|cho)?\s*/i, "");
    a = a.replace(/^(địa chỉ|dia chi|address|nhà|nha|ở|về|ve)\s*[:]?\s*/i, "");
    a = a.replace(/^\d+\s*mẫu\s*(này|đó|kia)?\s*/i, "");   // sót "2 mẫu này"
  } while (a !== prev && a.length);
  a = a.replace(/\s*cho\s+(c|e|chị|chi|em|mình|minh|t|tôi|toi)\s*$/i, "");
  a = a.replace(/\s*(nha|nhé|nhe|nhá|ạ|à|với|voi|nhá)\s*$/i, "").trim();
  // (Z0) CẮT RÁC DẪN NHẬP trước ĐỊA CHỈ THẬT. Lý do: nhiều tin cùng 1 lượt bị GỘP nên câu chat
  //   ("Thứ 3 m cần mặc", "Ship m lun váy này nhé", "Dv ktra hàg k ạ") dính vào TRƯỚC địa chỉ.
  //   (Z) cũ neo theo SỐ ĐẦU TIÊN nên giữ lại "3 m cần mặc" (lỗi Chuột Xinh: địa chỉ = "3 m cần mặc Toà Prime...").
  //   -> Tìm MỐC địa chỉ đầu tiên (toà/số nhà/số N/ngõ/ngách/hẻm/đường/phố/thôn/xóm/ấp/khu/tổ N/chung cư/kđt/lô N/kiệt)
  //      rồi cắt mọi thứ ĐỨNG TRƯỚC mốc. Mốc đầu tiên => phần đầu chắc chắn KHÔNG phải tầng địa chỉ -> bỏ an toàn.
  {
    const _anchor = a.search(/(to[àa]\s|tòa\s|số\s*nhà|\bsố\s*\d|\bngõ\b|\bngách\b|\bhẻm\b|\bđường\b|\bphố\b|\bthôn\b|\bxóm\b|\bấp\b|\bkhu\s|\btổ\s*\d|chung\s*cư|\bkđt\b|\blô\s*\d|\bkiệt\b)/i);
    if (_anchor > 0) {
      const _head = a.slice(0, _anchor).trim();
      // KHÔNG cắt nếu HEAD đã chứa nội dung địa chỉ THẬT: mã căn/toà (HH18, CT1, R6, S1...), số nhà trần,
      //   token số/ngõ/lô/tổ. Tránh làm mất "HH18 đường hoa hồng" (chung cư/kđt hay để MÃ TOÀ thay số nhà).
      const _headHasAddr = /\b[a-z]{1,4}\d{1,4}[a-z]?\b/i.test(_head)
        || /\bsố\s*\d|\bngõ|\bngách|\bhẻm|\bkiệt|\bsn\b|\blô\b|\btổ\b/i.test(_head)
        || (/\d/.test(_head) && _head.split(/\s+/).filter(Boolean).length <= 3);
      if (!_headHasAddr) a = a.slice(_anchor).trim();
    }
  }
  // (Z0b) Gột cụm CHAT/THỜI GIAN lẫn trong địa chỉ (an toàn: địa chỉ thật không chứa các cụm này).
  //   Bắt được ca KHÔNG có từ-khoá mốc (vd "Thứ 3 m cần mặc 21A Lê Thị Kinh" -> "21A Lê Thị Kinh").
  //   LƯU Ý: chỉ gột ĐÚNG cụm chat, KHÔNG dùng [^,]* (sẽ nuốt luôn địa chỉ khi câu không có dấu phẩy).
  a = a
    .replace(/\b(thứ|thu)\s*\d{1,2}\b/gi, " ")
    .replace(/\b(m|mình|minh|e|em|c|chị|chi)?\s*cần\s*(mặc|lấy|lay|nhận|nhan|gấp|gap|có|co)\b/gi, " ")
    .replace(/\b(đám|dam)\s*(cưới|cuoi|hỏi|hoi|tiệc|tiec)\b/gi, " ")
    .replace(/\b(dịch\s*vụ|dv)?\s*(kiểm\s*tra|ktra|kt)\s*h[àa]ng?\b\s*(k|ko|không|khong)?\s*(ạ|a)?/gi, " ")
    .replace(/\bship\s*(m|mình|minh|e|em)?\s*(lun|luôn|luon)?\s*(váy|vay|đầm|dam|này|nay)?\s*(nhé|nha|nhe)?\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;]+/, "")
    .trim();
  // (Z) RÁC ĐẦU trước số nhà: vd "này cho c nhe 36 Hoàng Mai" / "ok e gửi 12 Bà Triệu".
  //     Địa chỉ thật bắt đầu bằng SỐ NHÀ. Nếu trước số đầu tiên là cụm chữ NGẮN (<=5 từ) KHÔNG phải
  //     tên đường/phường (không có "ngõ/ngách/đường/phố/kiệt/hẻm/tổ/thôn/ấp/khu/lô/số"), coi là rác -> cắt.
  {
    const m = a.match(/^(.*?)(\d.*)$/s);   // tách phần-trước-số (g1) và phần-từ-số (g2)
    if (m && m[1]) {
      const head = m[1].trim();
      const headWords = head ? head.split(/\s+/).filter(Boolean) : [];
      const headKeep = /(ngõ|ngo|ngách|ngach|đường|duong|phố|pho|kiệt|kiet|hẻm|hem|tổ|to|thôn|thon|ấp|ap|khu|khối|khoi|lô|lo|số|so|đội|doi|xóm|xom|block)/i.test(head);
      // GLUED: chữ dính liền ngay TRƯỚC số (vd "HH"+"18" = mã toà HH18) -> KHÔNG cắt, kẻo biến HH18 thành 18.
      const _glued = /[a-zà-ỹ]$/i.test(m[1]);
      if (headWords.length && headWords.length <= 5 && !headKeep && !_glued) {
        a = m[2].trim();   // bỏ phần chữ rác, giữ từ số nhà trở đi
      }
    }
  }
  return a || String(addr || "").trim();
}
// [CÂU CHỐT/LÊN ĐƠN] Địa chỉ ghi CHUẨN RÕ: bung viết tắt tỉnh -> TÊN ĐẦY ĐỦ, đảm bảo có tên tỉnh ở cuối.
//  (vd "...hồng bàng hp" -> "...hồng bàng, Hải Phòng"; "...hồng bàng" -> "...hồng bàng, Hải Phòng").
//  Dùng cho buildOrderConfirmation + lời mời gửi về địa chỉ, vì đoạn này còn dùng để TẠO ĐƠN.
function addrForOrder(addr) {
  let a = cleanAddress(addr);
  if (!a) return a;
  try {
    const f = _va.fold(a);
    let provDisp = null;
    const pk = _va.explicitProvince(f);
    if (pk) provDisp = _va.provinceDisplay(pk);
    else { const inf = _va.inferProvince(f); if (inf && inf.province) provDisp = inf.province; }
    if (provDisp) {
      const provFold = _va.fold(provDisp);
      // Đã có TÊN TỈNH ĐẦY ĐỦ trong địa chỉ -> giữ nguyên (không nối lặp).
      if ((" " + f + " ").includes(" " + provFold + " ")) return a;
      // Bỏ token VIẾT TẮT tỉnh ở cuối (nếu có) rồi nối TÊN TỈNH ĐẦY ĐỦ.
      a = a.replace(/[\s,]+(hp|hd|bn|bg|nd|nb|tb|hy|vp|tq|ct|hn|hcm|tphcm|sg|dn)\s*$/i, "").replace(/[\s,]+$/, "").trim();
      if (a) a = a + ", " + provDisp;
    }
  } catch (_) {}
  return a || cleanAddress(addr);
}
// [SỬA ĐỊA CHỈ] Cụm "gửi về ..." trong câu mời chốt: nếu CÓ địa chỉ giao được -> LIỆT KÊ địa chỉ thật
// ("gửi về địa chỉ <địa chỉ đã lọc sạch>"); nếu không có/không đủ -> trả "" (không nói "địa chỉ cũ" trống).
function noiNhanAddr(mem) {
  try {
    if (mem && addrReady(mem)) {
      const a = addrForOrder(mem.address);
      if (a) return ` gửi về địa chỉ ${a}`;
    }
  } catch (_) {}
  return "";
}
// Khách HỎI "địa chỉ cũ là gì / địa chỉ nào" -> trả địa chỉ ĐANG LƯU; KHÔNG có thì xin lại (KHÔNG bịa).
function asksWhatOldAddress(text) {
  const t = String(text || "").toLowerCase();
  return /(địa chỉ cũ (là|ở|nào|gì|đâu)|địa chỉ (nào|gì) (ạ|e|em|v|vậy|thế)?|địa chỉ.*(là gì|là đâu|nào ạ|nào e)|chỗ cũ (ở|là|nào)|địa chỉ (em |đã )?lưu)/i.test(t);
}
// Khách BÁO SẼ GỬI ĐỊA CHỈ MỚI / KHÔNG còn ở địa chỉ cũ -> chỉ cần XÁC NHẬN chờ, KHÔNG chốt về địa chỉ cũ.
function saysWillSendNewAddress(text) {
  const t = String(text || "").toLowerCase();
  if (/\d/.test(t)) return false;   // có số -> có thể đang ĐƯA địa chỉ/sđt thật (để luồng lưu địa chỉ lo), không phải hứa gửi sau
  return /((đợi|chờ|sẽ|tí|lát|chút|rồi)\s*(mình|m|e|em|t|tôi)?\s*)?(gửi|nhắn|cho|báo|ghi)\s*(lại\s*)?(địa chỉ|đc|dc)\s*mới|(địa chỉ|đc|dc)\s*mới\b|(không|ko|hông|chẳng|chả)\s*(còn\s*)?(ở|tại)?\s*(địa chỉ|đc|dc|chỗ)?\s*cũ|đổi\s*(sang\s*)?(địa chỉ|đc|dc)|chuyển\s*(nhà|chỗ|nơi ở)/i.test(t);
}

// Khách ĐỒNG Ý ngắn gọn ("ok", "ừ", "vâng", "lên đơn đi", "c bảo ok rồi"...).
function isAffirmation(text) {
  const t = String(text || "").trim().toLowerCase();
  if (/👍|👌|🆗|❤️|like$/i.test(t)) return true;   // khách bấm like ngón cái / ok tay = đồng ý
  if (/^(ok|oke|oki|okie|oki e|ok e|okla|okê|okey|ừ|ừa|uh|uhm|ừm|um|uk|úk|uk e|ukê|uke|vâng|dạ|dạ vâng|đồng ý|được|đc|uki|ukm|yes|chốt|lấy|lên đơn)([\s.!,😄💕]|$)/i.test(t)) return true;
  return /(ok rồi|ok mà|bảo ok|đồng ý rồi|ừ rồi|chốt luôn|chốt đi|chốt đơn đi|lên đơn luôn|lên đơn đi|lấy luôn|lấy đi|ok lên đơn|ok chốt|ok lấy|ok nha|ok nhé|ok luôn)/i.test(t);
}

// Câu hỏi? (để không chốt nhầm khi khách đang hỏi)
function looksLikeQuestion(text) {
  const t = String(text || "").toLowerCase().trim();
  // Đuôi nghi vấn tiếng Việt (kể cả viết không dấu): "...à/ah", "...á", "...hả/ha", "...nhỉ/nhể", "...hở", "...chứ".
  // Bắt particle là TỪ RIÊNG (tránh "nha"/"nhé" bị tính nhầm là câu hỏi).
  if (/(?:^|\s)(à|ah|á|hả|ha|hử|nhỉ|nhể|hở|chứ|hể)\s*(e|ạ|nhỉ)?\s*[?]?\s*$/i.test(t)) return true;
  if (/(đúng|phải|thật)\s*(không|ko|hong|hông|chưa)\b/i.test(t)) return true;
  // "... là gì" / "... gì" cuối câu (vd "chất vải là gì", "mẫu này vải gì", "tên gì ạ")
  if (/(là|l[àa])\s*(gì|j|chi)\b/i.test(t)) return true;
  if (/(^|\s)(gì|j)\s*(ạ|vậy|thế|v|nhỉ|nhể|e|em|đó|do)?\s*[?]?\s*$/i.test(t)) return true;
  // hỏi chất liệu/vải dù không có "không/gì" (vd "chất vải", "vải gì", "chất liệu thế nào")
  if (/(chất\s*vải|vải\s*(gì|j|gi|như|the|thế|ra sao|nào|loại)|chất\s*liệu|co\s*giãn|co\s*gian)/i.test(t)) return true;
  return /\?|(có|co|còn|đang|được)\s.{0,20}(không|ko|hong|hông|chưa|à|ah|hả|rồi à|rồi chưa)|bao nhiêu|mấy (màu|size|kg|cân|cái|mẫu)|thế nào|như nào|ra sao|màu gì|màu nào|size gì|size nào|chất liệu|gì (không|ko|ạ|vậy|thế|nhỉ)|được không|được ko|sao ạ|đâu ạ|ở đâu|khi nào|bao lâu|mặc vừa/i.test(t);
}

// Nối danh sách kiểu tiếng Việt: [a,b,c] -> "a, b và c"
function joinVi(arr) {
  const a = (arr || []).filter(Boolean);
  if (a.length <= 1) return a[0] || "";
  return a.slice(0, -1).join(", ") + " và " + a[a.length - 1];
}
// Câu MỜI CHỐT / XIN THÔNG TIN khi khách vừa CHỌN mẫu.
// NGUYÊN TẮC CỨNG: PHẢI đủ (size + sđt + địa chỉ) mới được "lên đơn".
//  - Thiếu SIZE  -> HỎI size TRƯỚC (tuyệt đối không nói "em lên đơn ... địa chỉ cũ" khi chưa có size).
//  - Đủ size, thiếu sđt/địa chỉ -> mời + xin nốt phần còn thiếu.
//  - Đủ hết -> mời chốt gọn.
function buildOrderInvite(mem, productInfo) {
  const nameSize = quotedListWithSizes(mem, productInfo)
    || (productInfo && productInfo.name ? productLabel(productInfo) : "mẫu này");

  // (1) THIẾU SIZE -> hỏi size, KHÔNG chốt, KHÔNG nhắc địa chỉ cũ.
  if (orderNeedsSize(mem, productInfo) && !mem.customerSize) {
    return "Dạ chị thường mặc size nào để em tư vấn cho mình nha ạ";
  }

  // (2) Đã đủ size nhưng còn thiếu liên hệ -> mời + xin nốt.
  const _addrOk = addrReady(mem);
  // Địa chỉ CÓ một phần nhưng CHƯA đủ giao (vd thiếu tỉnh) -> hỏi ĐÚNG phần thiếu, KHÔNG coi là đủ.
  if (!_addrOk && mem.address && !isGarbageAddress(mem.address)) {
    const gap = addressGapReply(mem.address, mem);
    if (gap) return mem.phone ? gap : (gap + " Chị cho em xin thêm số điện thoại nữa nha ạ");
  }
  const missing = [];
  if (!mem.phone) missing.push("số điện thoại");
  if (!_addrOk) missing.push("địa chỉ nhận hàng (số nhà, phường/xã, tỉnh/thành)");
  if (missing.length) {
    return `Dạ em lên đơn ${nameSize} cho chị nha. Chị cho em xin ${joinVi(missing)} để em lên đơn cho mình nha ạ`;
  }

  // (3) Đủ hết -> mời chốt gọn.
  const noiNhan = noiNhanAddr(mem);
  return `Dạ em lên đơn ${nameSize}${noiNhan} cho mình nha ạ`;
}

// Dựng CÂU CHỐT ĐƠN ĐẦY ĐỦ (§11): cảm ơn + Sản phẩm (kèm size từng mẫu) + COD + SĐT + địa chỉ + chúc.
// Gửi tin "Đơn hàng đang được tạo trên hệ thống" + 1 ẢNH/MẪU đúng màu khách chốt (>=2 mẫu -> mỗi mẫu 1 ảnh).
async function sendOrderCreatingWithImages(conversationId, mem, productInfo) {
  const LEAD = "Dạ vâng ạ, Đơn hàng của mình đang được tạo trên hệ thống";
  const prods = (mem.quotedProducts && mem.quotedProducts.length)
    ? mem.quotedProducts
    : (productInfo ? [productInfo] : []);
  const items = [];
  const seen = new Set();
  for (const p of prods) {
    const code = p && p.code;
    if (!code || seen.has(code)) continue;
    seen.add(code);
    let one = [];
    const col = mem.orderColorByCode && mem.orderColorByCode[code];
    if (col) { try { one = imageItemsByExactColor(code, _foldKey(col), 1); } catch (_) {} }
    if (!one.length) {                       // không có màu chốt / không khớp -> ảnh đầu của mã
      try {
        const all = itemsByCode(code) || [];
        if (all.length) {
          const it = all[0];
          const url = it.downloadUrl || it.thumbnailUrl || null;
          if (it.pancakeId || url) one = [{ contentId: it.pancakeId || null, url }];
        }
      } catch (_) {}
    }
    if (one.length) items.push(one[0]);
  }
  try {
    if (items.length) await sendImages3(conversationId, items, LEAD);
    else await sendInboxMessage(conversationId, LEAD);
  } catch (_) { try { await sendInboxMessage(conversationId, LEAD); } catch (__) {} }
}
// Chốt đơn CHUẨN: gửi tin "đang tạo" + ảnh -> rồi gửi câu cảm ơn. Trả text câu cảm ơn (để set lastBotReply).
async function sendOrderClose(conversationId, mem, productInfo) {
  await sendOrderCreatingWithImages(conversationId, mem, productInfo);
  const reply = buildOrderConfirmation(mem, productInfo);
  await sendInboxMessage(conversationId, reply);
  return reply;
}
// Lời chúc cuối câu chốt theo THỜI ĐIỂM (giờ VN, UTC+7). Thang ưu tiên:
//   1) sau 20h (mọi ngày) -> ngủ ngon
//   2) T7 (5-20h) / sáng CN (5-15h) -> cuối tuần vui vẻ
//   3) sáng 5-15h ngày thường -> một ngày vui vẻ
//   4) còn lại (15-20h thường, CN chiều, 0-5h khuya) -> câu chung
// Luân phiên: nếu lượt chốt TRƯỚC đã dùng đúng câu thời điểm đó -> lượt này chèn câu chung cho đỡ lặp.
const ORDER_GREETING_GENERAL = "Shop rất mong được nhìn thấy nhiều hình ảnh xinh đẹp của chị khi sử dụng những sản phẩm bên em ạ, hy vọng chị sẽ chia sẻ những khoảnh khắc tuyệt vời đó.";
function orderGreeting(mem) {
  const vn = new Date(Date.now() + 7 * 3600 * 1000);
  const h = vn.getUTCHours();       // giờ VN 0..23
  const dow = vn.getUTCDay();       // 0=CN ... 6=T7 (giờ VN)
  let timed = null;
  if (h >= 20) timed = "Chúc chị ngủ ngon ạ";
  else if (h >= 5 && (dow === 6 || (dow === 0 && h < 15))) timed = "Chúc chị cuối tuần vui vẻ ạ";
  else if (h >= 5 && h < 15) timed = "Chúc chị một ngày vui vẻ ạ";
  if (!timed) return ORDER_GREETING_GENERAL;
  if (mem && mem._lastOrderGreeting === timed) { if (mem) mem._lastOrderGreeting = ORDER_GREETING_GENERAL; return ORDER_GREETING_GENERAL; }
  if (mem) mem._lastOrderGreeting = timed;
  return timed;
}
function buildOrderConfirmation(mem, productInfo) {
  const tenMauSize = quotedListWithColorSizes(mem, productInfo)
    || (productInfo && productInfo.name ? productLabel(productInfo) : "");
  const _tot = computeOrderTotal(mem, productInfo);
  let codStr = "";
  if (_tot.known && _tot.total > 0) {
    codStr = `${_fmtMoney(_tot.total)}đ`;
    // 2+ món -> ghi rõ giá từng món để khách biết tiền do những món nào.
    if (_tot.parts.length >= 2) {
      const bd = _tot.parts.map(x => `${_fmtMoney(x.price)}đ`).join(" + ");
      const shipTxt = _tot.ship > 0 ? ` + ship ${_fmtMoney(_tot.ship)}đ` : "";
      codStr += ` (${bd}${shipTxt})`;
    } else if (_tot.ship > 0) {
      codStr += ` (hàng ${_fmtMoney(_tot.sum)}đ + ship ${_fmtMoney(_tot.ship)}đ)`;
    }
  }
  const lines = ["Cảm ơn chị đã đặt hàng"];
  if (tenMauSize) lines.push(`- Sản phẩm: ${tenMauSize}`);
  if (codStr) lines.push(`- COD: ${codStr}`);
  if (mem.phone) lines.push(`- SĐT: ${mem.phone}`);
  if (mem.address) lines.push(`- Địa chỉ: ${addrForOrder(mem.address)}`);
  lines.push(orderGreeting(mem));
  // GHI NHỚ ĐƠN ĐÃ CHỐT theo TỪNG MẪU (mã -> {tên, màu, size}) để lần sau khách mua lại thì HỎI xác nhận,
  // tránh lên đơn lặp khi khách quên mình đã đặt.
  try {
    mem.orderedByCode = mem.orderedByCode || {};
    const _prods = (mem.quotedProducts && mem.quotedProducts.length) ? mem.quotedProducts : (productInfo ? [productInfo] : []);
    for (const p of _prods) {
      const k = String((p && p.code) || "").toUpperCase();
      if (!k) continue;
      mem.orderedByCode[k] = {
        name: productLabel(p) || (p && p.name) || "",
        color: chosenColorForCode(mem, p) || "",
        size: effectiveSize(mem, p) || mem.customerSize || "",
        at: Date.now(),
      };
    }
  } catch (_) {}
  return lines.join("\n");
}

// ============================================================================
// CHỐT ĐƠN THEO TRẠNG THÁI — dùng chung cho nhãn AI = ORDER_CLOSE / khách chọn màu để chốt.
// CODE quyết (KHÔNG để AI soạn lời; AI chỉ điều hướng vào đây). Trả:
//   { status:"done",    reply }   -> đủ {mẫu+size+màu+sđt+địa chỉ} -> câu chốt §1 (buildOrderConfirmation)
//   { status:"color",   reply }   -> mẫu nhiều màu chưa chốt màu -> câu hỏi màu (đã set pendingColorConfirm)
//   { status:"ask",     reply }   -> thiếu 1 field -> câu xin đúng cái thiếu (sđt/size/địa chỉ)
//   { status:"handoff", reason }  -> không có/không tra được mẫu -> để luồng dưới / người thật
// latestText: tin khách lượt này (để biết khách có đang hỏi MÀU KHÁC không).
// ============================================================================
function tryCloseFromState(mem, productInfo, latestText) {
  if (!productInfo) return { status: "handoff", reason: "không xác định được mẫu" };
  const code = _codeUp(productInfo);

  // --- SIZE ---
  const availSz = parseAvailableSizes(productInfo.size);
  const needSize = availSz.size > 0 && !availSz.has("FREESIZE");
  let effSize = effectiveSize(mem, productInfo);
  // [FIX Hien Nguyen] biết CÂN NẶNG mà chưa lưu size -> suy size từ cân nặng (đã tư vấn rồi), đừng xin lại.
  if (needSize && !effSize && mem.weightKg) {
    const _rw = resolveSizeByWeight(mem.weightKg, productInfo.size);
    if (_rw && _rw !== "OVER" && _rw !== "FREESIZE") {
      mem.customerSize = _rw; mem.sizeFromCustomer = false;
      effSize = effectiveSize(mem, productInfo);
    }
  }
  const haveSize = !needSize || !!effSize;

  // --- MÀU: mẫu nhiều màu nhưng hội thoại bám 1 MÀU (ad/ảnh đã gửi) + khách KHÔNG hỏi màu khác
  //     -> coi như khách chốt màu đó, KHÔNG hỏi (sao y luật khối chốt-contact). Khách hỏi màu khác -> vẫn hỏi.
  const colors = (typeof modelColorList === "function") ? (modelColorList(productInfo) || []) : [];
  if (colors.length >= 2 && !(mem.orderColorByCode && mem.orderColorByCode[code])) {
    if (asksOtherColors(latestText)) mem.multiColorInterest = code;
    const focus = mem.askedImageColor || mem.lastSentImageColor
               || (mem.sourceColorByCode || {})[code] || (mem.colorByCode || {})[code] || null;
    const focusCanon = focus ? (colors.find(c => colorMatches(c, focus) || colorMatches(focus, c)) || null) : null;
    if (focusCanon && mem.multiColorInterest !== code) {
      mem.orderColorByCode = mem.orderColorByCode || {};
      mem.orderColorByCode[code] = String(focusCanon).toLowerCase();
    }
  }
  const needColor = colors.length >= 2 && !chosenColorForCode(mem, productInfo);

  // --- ĐỊA CHỈ (xoá rác trước khi xét) ---
  if (mem.address && isGarbageAddress(mem.address)) mem.address = null;
  const addrOk = addrReady(mem);

  // --- ĐỦ -> CHỐT ---
  if (mem.phone && haveSize && !needColor && addrOk) {
    return { status: "done", reply: buildOrderConfirmation(mem, productInfo) };
  }

  // --- THIẾU -> xin ĐÚNG field (thứ tự sao y khối chốt-contact: sđt -> màu -> size -> địa chỉ) ---
  if (!mem.phone) {
    return { status: "ask", reply: "Dạ em nhận được thông tin của chị rồi ạ, chị cho em xin thêm số điện thoại để em lên đơn cho mình nha ạ" };
  }
  if (needColor) {
    const ask = colorConfirmAsk(mem, productInfo);   // set mem.pendingColorConfirm
    return { status: "color", reply: ask };
  }
  if (!haveSize) {
    return { status: "ask", reply: "Dạ em nhận được thông tin của chị rồi ạ, chị cho em xin size (hoặc chiều cao cân nặng) để em lên đơn cho mình nha ạ" };
  }
  if (!addrOk) {
    const r = (typeof addressGapReply === "function" && addressGapReply(mem.address, mem))
           || "Dạ chị cho em xin địa chỉ nhận hàng (số nhà, phường/xã, tỉnh/thành) để em lên đơn cho mình nha ạ";
    return { status: "ask", reply: r };
  }
  return { status: "handoff", reason: "không rõ thiếu gì" };
}

// KHÁCH BÁO ĐÃ CHUYỂN + nhờ XÁC THỰC đã nhận tiền chưa -> KHÔNG tự xác nhận, gắn thẻ AI-CHỜ XL.
function asksPaymentReceived(text) {
  const t = String(text || "").toLowerCase();
  // Khách BÁO ĐÃ thanh toán (chịu lỗi chính tả "khoarn/khoaran"): "chuyển khoản rồi", "ck rồi", "đã chuyển", "cọc rồi".
  if (/(\bck\b|\btt\b|chuyển\s*kho\S*|chuyển tiền|cọc|thanh toán)\s*(rồi|xong|r)\b/i.test(t)) return true;
  if (/đã\s*(ck|chuyển|thanh toán|cọc|gửi tiền|chuyển\s*kho\S*)/i.test(t)) return true;
  // Khách nhờ XÁC THỰC đã nhận tiền chưa.
  if (/(nhận được tiền chưa|nhận tiền chưa|đã nhận (tiền )?chưa|có nhận được (tiền )?chưa|kiểm tra.*(giao dịch|chuyển khoản|tiền)|check.*(giao dịch|ck|tiền|giúp|dùm|giùm)|coi.*(giúp|giùm).*(tiền|ck|giao dịch)|soát.*tiền)/i.test(t)) return true;
  return false;
}

const SIZE_RE = "XS|S|M|L|XL|XXL|XXXL|FREESIZE";

// ===== BẢNG SIZE (SỐ ĐO) — gửi khi khách XIN XEM thông số =====
// Chuyển MỌI dạng link Google Drive về URL ẢNH THÔ lh3 (=w1600) mà Pancake/FB fetch được.
// Hỗ trợ: drive.../file/d/<ID>/view, open?id=<ID>, uc?id=<ID>, thumbnail?id=<ID>, lh3.../d/<ID>=...
// Host khác (imgbb, postimages...) -> giữ nguyên.
function toRawImageUrl(url) {
  const u = String(url || "").trim();
  if (!u) return "";
  let m = u.match(/lh3\.googleusercontent\.com\/d\/([A-Za-z0-9_-]+)/);
  if (m) return `https://lh3.googleusercontent.com/d/${m[1]}=w1600`;
  m = u.match(/\/d\/([A-Za-z0-9_-]{20,})/) || u.match(/[?&]id=([A-Za-z0-9_-]{20,})/);
  if (m) return `https://lh3.googleusercontent.com/d/${m[1]}=w1600`;
  return u;
}

// Dán URL ảnh bảng size đã host (ảnh trên Page/Drive public...) vào biến môi trường SIZE_GUIDE_URL
// hoặc trực tiếp vào chuỗi dưới. Để TRỐNG -> bot gửi số đo bằng CHỮ (fallback) vẫn dùng được ngay.
const SIZE_GUIDE_URL = toRawImageUrl(process.env.SIZE_GUIDE_URL || "");
// TỰ TÌM ảnh BẢNG SIZE trong hash_index.json theo TÊN ("Thông số" / "Bảng size") -> khỏi cần cấu hình URL.
// Lấy cả pancakeId (content_id) + link để gửi qua sendImages3 cho đáng tin.
function loadSizeGuideFromHashIndex() {
  try {
    const fs = require("fs");
    const path = require("path");
    const p = path.join(__dirname, "hash_index.json");
    if (!fs.existsSync(p)) return null;
    const arr = JSON.parse(fs.readFileSync(p, "utf8"));
    const list = Array.isArray(arr) ? arr : [];
    const nameOf = it => String((it && (it.name || it.filename)) || "").toLowerCase();
    const hit = list.find(it => /thông số|thong so|thongso/.test(nameOf(it)))
             || list.find(it => /bảng size|bang size|size guide/.test(nameOf(it)));
    if (!hit) return null;
    const url = hit.downloadUrl || hit.thumbnailUrl || (hit.id ? `https://lh3.googleusercontent.com/d/${hit.id}=w1600` : null);
    if (!url && !hit.pancakeId) return null;
    console.log(`[bảng size] tự lấy ảnh từ hash_index: "${hit.name || hit.filename}" (content_id ${hit.pancakeId ? "có" : "không"}).`);
    return { url: url || null, contentId: hit.pancakeId || null };
  } catch (e) { try { console.log("[bảng size] không đọc được hash_index:", e.message); } catch (_) {} return null; }
}
const SIZE_GUIDE_IMG = SIZE_GUIDE_URL ? { url: SIZE_GUIDE_URL, contentId: null } : loadSizeGuideFromHashIndex();
// ===== ẢNH MÃ QR CHUYỂN KHOẢN — gửi KÈM sau khi báo STK =====
// Dán URL ảnh QR (link trực tiếp) vào biến môi trường QR_URL. Để TRỐNG -> chỉ gửi STK bằng chữ.
const QR_URL = toRawImageUrl(process.env.QR_URL || "");
const SIZE_GUIDE_TEXT =
  "Dạ bảng size bên em (số đo cm) để chị tham khảo nha ạ:\n" +
  "• Size S: ngực 82-84, eo 64-66, mông 88-90 (khoảng 40-48kg)\n" +
  "• Size M: ngực 86-88, eo 68-70, mông 92-94 (khoảng 49-55kg)\n" +
  "• Size L: ngực 90-92, eo 72-74, mông 96-98 (khoảng 56-60kg)\n" +
  "Chị thường mặc size bao nhiêu để em tư vấn cho mình nha";
// Khách XIN XEM bảng số đo / thông số (KHÔNG phải khai size/số đo của chính mình).
function asksSizeChart(text) {
  const t = String(text || "").toLowerCase();
  // Khách ĐANG KHAI số đo/size của mình ("mình mặc L số đo 85-67-89") -> KHÔNG phải xin bảng size.
  if (/\d{2,3}\s*[-/.\s]\s*\d{2,3}\s*[-/.\s]\s*\d{2,3}/.test(t)) return false;   // số đo 3 vòng 85-67-89
  if (/(mình|em|chị|tôi|t |con|cháu)\s*(mặc|cao|nặng)\b/.test(t)) return false;  // "mình mặc/cao/nặng..."
  if (extractStatedSize(text)) return false;                                      // đã nói rõ size mình
  return /(bảng size|bang size|bảng sz|bang sz|bảng số đo|bang so do|số đo|so do|thông số|thong so|size guide|chart size|bảng quy đổi|thông tin size|bảng size không|có bảng size|xin bảng|cho .*xem .*size|cho .*bảng (size|sz|số đo)|gửi .*bảng (size|sz|số đo))/i.test(t);
}

// Khách XIN BẢNG SIZE trong tin (kể cả khi tin còn ý khác như báo giá ad) -> GỬI ẢNH bảng size + câu hành động.
// Trả true nếu đã gửi. Dùng để KHÔNG bỏ sót ý "cho bảng size" khi handler khác (ad/giá) chạy trước.
async function maybeSendSizeChart(conversationId, custText, product, mem) {
  if (!asksSizeChart(custText)) return false;
  if (SIZE_GUIDE_IMG && (SIZE_GUIDE_IMG.url || SIZE_GUIDE_IMG.contentId)) {
    await sendInboxMessage(conversationId, "Dạ em gửi chị bảng size để mình tham khảo nha ạ");
    const sres = await sendImages3(conversationId, [{ url: SIZE_GUIDE_IMG.url, contentId: SIZE_GUIDE_IMG.contentId }]);
    const sentImg = !!(sres && sres.ok);
    console.log(`[${BOT_NAME}] Gửi kèm ẢNH bảng size (khách xin) -> sentImg=${sentImg}.`);
    if (sentImg) {
      const a = parseAvailableSizes(product && product.size);
      const isFree = a.size === 1 && a.has("FREESIZE");
      let action;
      if (isFree) action = freesizeLine(mem, product);
      else if (mem.noFitForCode === (product && product.code)) action = "Dạ với số đo của mình thì mẫu này chưa có size phù hợp, chị tham khảo thêm bảng size và mẫu khác giúp em nha ạ";
      else if (mem.customerSize && (a.size === 0 || a.has(mem.customerSize))) action = `Dạ ${orderActionLine(mem, mem.customerSize)}`;
      else action = "Dạ chị thường mặc size nào để em tư vấn cho mình nha ạ";
      await sendInboxMessage(conversationId, action);
    } else {
      try { await tagXuLyAnhVaUnread(conversationId); } catch (_) {}
      mem.botHandoffAt = Date.now();
    }
  } else {
    await sendInboxMessage(conversationId, SIZE_GUIDE_TEXT);
  }
  mem.lastBotReply = "[bảng size]";
  return true;
}

// ===== HỎI CÂN NẶNG CHO 1 SIZE (size -> kg), trả lời theo BẢNG SIZE kịch bản =====
const SIZE_WEIGHT = { S: "40-48kg", M: "49-55kg", L: "56-60kg", FREESIZE: "42-57kg" };

// ===== BẢNG SỐ ĐO 3 VÒNG (MYS.P SIZE GUIDE) - tư vấn size theo số đo khách cung cấp =====
const SIZE_CHART_3V = {
  S: { nguc: [82, 84], eo: [64, 66], mong: [88, 90] },
  M: { nguc: [86, 88], eo: [68, 70], mong: [92, 94] },
  L: { nguc: [90, 92], eo: [72, 74], mong: [96, 98] },
};
// 1 số đo -> size NHỎ NHẤT đủ chứa (mép trên >= số đo) trong danh sách size cho trước; vượt hết -> null.
function _sizeFitOne(v, dim, sizes) {
  for (const sz of sizes) {
    const r = (SIZE_CHART_3V[sz] || {})[dim];
    if (r && v <= r[1]) return sz;   // số đo nằm trong/dưới mép trên của size này -> vừa
  }
  return null;   // vượt cả size lớn nhất -> không có size vừa
}
// 3 vòng (ngực, eo, mông) -> { size, over }. CHỈ xét size shop ĐANG CÓ (availList).
// Quy tắc: mỗi vòng lấy size nhỏ nhất đủ chứa; size cuối = LỚN NHẤT trong 3 (vòng to nhất quyết định, tránh chật).
function resolveSizeBy3V(nguc, eo, mong, availList) {
  const ord = ["S", "M", "L", "XL", "XXL", "XXXL"];
  let sizes = (availList && availList.length ? availList : ["S", "M", "L"])
    .filter(s => SIZE_CHART_3V[s])                 // chỉ size có dữ liệu bảng (S/M/L)
    .sort((a, b) => ord.indexOf(a) - ord.indexOf(b));
  if (!sizes.length) sizes = ["S", "M", "L"];
  const votes = [_sizeFitOne(nguc, "nguc", sizes), _sizeFitOne(eo, "eo", sizes), _sizeFitOne(mong, "mong", sizes)];
  if (votes.some(v => v === null)) return { size: null, over: true };   // có vòng vượt size lớn nhất shop có
  let best = sizes[0];
  for (const s of votes) if (ord.indexOf(s) > ord.indexOf(best)) best = s;
  return { size: best, over: false };
}
// Đọc 3 số đo trong tin ("số đo 3v 85-67-89", "85 67 89", "85/67/89") -> [ngực, eo, mông] hoặc null.
function parse3V(text) {
  // (?<!\d) / (?!\d): số đầu & cuối KHÔNG dính chữ số khác -> tránh "1[60] 88-70" nuốt số cuối chiều cao.
  const re = /(?<!\d)(\d{2,3})\s*[-–—/.]\s*(\d{2,3})\s*[-–—/.]\s*(\d{2,3})(?!\d)/g;
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    const a = +m[1], b = +m[2], c = +m[3];
    if ([a, b, c].every(n => n >= 55 && n <= 135)) return [a, b, c];   // cụm 3 số ĐỀU trong khoảng số đo -> nhận
    re.lastIndex = m.index + 1;
  }
  return null;
}
// Đọc số đo CÓ NHÃN từng vòng: "v1 85 eo 68", "vòng 1 85 vòng 2 68", "ngực 85 eo 68 mông 90".
// Trả {nguc, eo, mong} (vòng nào THIẾU = null). KHÔNG có nhãn nào -> null. Giá trị ngoài 50-135 -> bỏ.
// Khác parse3V (cần ĐỦ 3 số liền): cái này bắt số đo lẻ có nhãn (bust/waist/hip).
function parseBodyMeasures(text) {
  const t = String(text || "").toLowerCase();
  const _val = (re) => { const m = t.match(re); if (!m) return null; const n = +m[1]; return (n >= 50 && n <= 135) ? n : null; };
  const nguc = _val(/(?:ngực|nguc|vòng\s*1|vong\s*1|\bv1\b|\bn1\b)\s*[:=]?\s*(\d{2,3})/);
  const eo   = _val(/(?:\beo\b|vòng\s*2|vong\s*2|\bv2\b)\s*[:=]?\s*(\d{2,3})/);
  const mong = _val(/(?:mông|mong|vòng\s*3|vong\s*3|\bv3\b)\s*[:=]?\s*(\d{2,3})/);
  if (nguc == null && eo == null && mong == null) return null;
  return { nguc, eo, mong };
}
// Tư vấn size từ số đo TỪNG PHẦN (có vòng nào xét vòng đó), vote size LỚN NHẤT. Trả {size, over}.
function resolveSizeByMeasures(measures, availList) {
  const ord = ["S", "M", "L", "XL", "XXL", "XXXL"];
  let sizes = (availList && availList.length ? availList : ["S", "M", "L"])
    .filter(s => SIZE_CHART_3V[s]).sort((a, b) => ord.indexOf(a) - ord.indexOf(b));
  if (!sizes.length) sizes = ["S", "M", "L"];
  const votes = [];
  if (measures.nguc != null) votes.push(_sizeFitOne(measures.nguc, "nguc", sizes));
  if (measures.eo   != null) votes.push(_sizeFitOne(measures.eo, "eo", sizes));
  if (measures.mong != null) votes.push(_sizeFitOne(measures.mong, "mong", sizes));
  if (!votes.length) return { size: null, over: false };
  if (votes.some(v => v === null)) return { size: null, over: true };   // có vòng vượt size lớn nhất shop có
  let best = sizes[0];
  for (const s of votes) if (ord.indexOf(s) > ord.indexOf(best)) best = s;
  return { size: best, over: false };
}
// Khách hỏi VÌ SAO lại vừa size đó (trong khi thường mặc size khác) -> giải thích bằng số đo từng vòng.
function asksWhySize(text) {
  const t = String(text || "").toLowerCase();
  return /(sao|tại sao|vì sao|why|ủa).{0,24}(size|vừa|mặc|lại|m\b|l\b|s\b)|sao (lại )?(là |mặc |size )?(s|m|l)\b|(mình|em|chị|tôi|t) (thường |hay |toàn )?mặc (size )?(s|m|l)\b.{0,8}(mà|cơ|sao|cơ mà)|mặc (s|m|l) mà|thường mặc (s|m|l)\b|sao (không|ko) (phải )?(size )?(s|m|l)\b/i.test(t);
}
// Khách hỏi "với số đo của mình thì mặc size gì/nào vừa" -> tư vấn size theo bảng (KHÔNG gửi bảng).
function asksSizeForMeasure(text) {
  const t = String(text || "").toLowerCase();
  return /(số đo|so do|3 ?vòng|3v|vòng).{0,24}(mặc |lên )?size (gì|nào|mấy|bao nhiêu)|size (gì|nào|mấy) (thì )?(của shop |bên shop )?vừa|số đo.{0,20}vừa|mặc size (gì|nào) (vừa|hợp|đẹp)|size nào (cho |thì )?vừa/i.test(t);
}
// Khách HỎI số đo của 1 size theo BẢNG ("L eo bao nhiêu", "size M ngực mấy", "eo size L là bao nhiêu",
// "vòng eo của L", "mông size M"). Trả {dim, size|null}. KHÁC việc khách TỰ KHAI số đo ("eo 80").
function asksMeasureOfSize(text) {
  const t = " " + String(text || "").toLowerCase().trim() + " ";
  if (parseBodyMeasures(t)) return null;          // có số đo kèm nhãn ("eo 80") -> khách TỰ KHAI, không phải HỎI
  if (parse3V(t)) return null;
  if (!/(bao nhiêu|bn|mấy|nhiu|là gì|thế nào|tnao|\btn\b|\?)/.test(t)) return null;   // phải là câu HỎI giá trị
  let dim = null;
  if (/(ngực|nguc|vòng\s*1|vong\s*1|\bv1\b)/.test(t)) dim = "nguc";
  else if (/(\beo\b|vòng\s*2|vong\s*2|\bv2\b)/.test(t)) dim = "eo";
  else if (/(mông|mong|vòng\s*3|vong\s*3|\bv3\b)/.test(t)) dim = "mong";
  if (!dim) return null;
  let size = null;
  const ms = t.match(/(?:^|[\s,(])(?:size\s*)?(xxl|xl|s|m|l)(?=$|[\s,)?.])/i);
  if (ms) size = ms[1].toUpperCase();
  return { dim, size };
}
// Khách THAN/TIẾC về việc KHÔNG CÓ size ("chán nhỉ ko có size", "tiếc thế không có size"...).
// KHÔNG bắt câu HỎI availability ("có size không?"). Dùng kèm gate mem.multiAdvice (1 người vừa, 1 người không).
function lamentsNoSize(text) {
  const t = String(text || "").toLowerCase().trim();
  if (/\?\s*$/.test(t)) return false;                                  // có dấu hỏi -> đang HỎI, không phải than
  const noSize = /(không|ko|kg|chẳng|hong|hết|chưa)\s*(có\s*)?size|không có (size|sz)/.test(t);
  const lament = /(chán|chan|tiếc|tiec|buồn|buon|hụt|hẫng|thôi|tiếc nhỉ|chán nhỉ|vậy|thế|nhỉ|hả|ư|à)/.test(t);
  return noSize && lament;
}
// "size S bao nhiêu cân/kg", "size M cho bao nhiêu kg", "bao nhiêu kg mặc size L", "size S mặc vừa người nào"
function asksWeightForSize(text) {
  const t = String(text || "").toLowerCase();
  // Hỏi quan hệ CÂN NẶNG <-> size của mẫu: "bao nhiêu kg thì vừa", "mẫu này cho người bao nhiêu kg",
  // "nặng bao nhiêu mặc vừa", "size M mặc bao nhiêu kg"... (KHÔNG cần kèm chữ size).
  // Lưu ý: handler đã chặn khi khách TỰ KHAI cân (parseWeightKg) nên không lo nhầm "em 50kg".
  return /(bao nhiêu|bn|mấy)\s*(cân|kg|ký|kí)(?![a-zà-ỹ])|(cân|kg|ký|kí)\s*(bao nhiêu|nào|gì|thì)|nặng bao nhiêu|(cho\s*)?(người|ng)\s*(bao nhiêu|mấy|bao)\s*(cân|kg|ký|kí)|(size\s*(\bs\b|\bm\b|\bl\b|\bxl\b|freesize)|dành cho)[^?]{0,24}(bao nhiêu\s*(cân|kg|ký|kí)|bao\s*(cân|can|ký|ki|kí|kg)(?![a-zà-ỹ])|mặc\s*(vừa|được)?\s*(bao|người))|bao\s*(cân|can|ký|ki|kí)(?![a-zà-ỹ])/i.test(t);
}
function extractAskedSize(text) {
  const t = String(text || "").toLowerCase();
  if (/freesize|free\s*size/i.test(t)) return "FREESIZE";
  const m = t.match(/size\s*(s|m|l|xl)(?![\p{L}])/iu) || t.match(/(?<![\p{L}])(s|m|l|xl)(?![\p{L}])/iu);
  return m ? m[1].toUpperCase() : null;
}
// Khách hỏi "mẫu này size gì / có size nào" (KHÔNG phải hỏi bảng size, KHÔNG phải hỏi bao nhiêu kg).
// Khách hỏi NÊN/MẶC size nào (cần TƯ VẤN size), KHÁC với "có size gì" (liệt kê).
function asksWhichSizeAdvice(text) {
  const t = String(text || "").toLowerCase();
  return /(mặc|lấy|nên|chọn|được|hợp)\s*size (nào|gì)|size nào (vừa|hợp|đẹp|ổn|được|chuẩn|cho)|thì (mặc |lấy )?size nào|vậy (thì )?(mặc |lấy )?size nào|size nào (thì |mới )?(vừa|hợp|được)/i.test(t);
}
function asksWhatSize(text) {
  const t = String(text || "").toLowerCase();
  if (/bảng size|size chart|số đo/i.test(t)) return false;
  // "mặc/nên/lấy/chọn size bao nhiêu/nào" = TƯ VẤN size (handler khác lo), KHÔNG phải hỏi liệt kê.
  if (/(mặc|nên|lấy|chọn|hợp|đi)\s*(là\s*)?size\s*(bao nhiêu|mấy|nào|gì)/i.test(t)) return false;
  // "có/còn (là) size bao nhiêu/mấy/gì/nào" = HỎI MẪU CÓ NHỮNG SIZE NÀO -> liệt kê (vd "size bên em có là size bao nhiêu").
  if (/(có|còn)\s*(những\s*)?(là\s*)?size\s*(bao nhiêu|mấy|gì|nào)/i.test(t)) return true;
  return /(size gì|size j\b|size nào|có (những )?size (gì|nào)|còn size (gì|nào)|mẫu này (có )?size|size mẫu này|size ra sao|size (thế nào|ntn))/i.test(t);
}
// Khách hỏi YES/NO "CÓ SIZE KHÔNG" (còn hàng/đủ size không) -> trả "có đủ size" + hỏi size khách (nếu chưa biết).
// KHÁC asksWhatSize ("có size gì/nào" = liệt kê). Loại trừ "có size nào/gì" (đã có handler liệt kê).
function asksHasSize(text) {
  const t = String(text || "").toLowerCase();
  if (/size (gì|nào|j\b)/i.test(t)) return false;               // "có size gì/nào" -> liệt kê (handler khác)
  if (/bảng size|size chart|số đo/i.test(t)) return false;
  return /có\s*size\s*(không|ko|k|hông|hong|kg|hôm|h|ạ|vậy|nữa|sẵn)?\s*[?ạ]?$|còn\s*size\s*(không|ko|k|hông|hong)|size\s*(còn|sẵn)\s*(không|ko|k)/i.test(t);
}
// Khách hỏi "mẫu này có phải freesize không / cũng freesize à / freesize hả" (yes-no về freesize).
function asksIsFreesize(text) {
  const t = String(text || "").toLowerCase();
  return /(freesize|free\s*size)\s*(không|ko|hông|à|ạ|hả|ư|vậy|thế|nhỉ|phải không|ko ạ)|(có phải|phải)\s*(là\s*)?(freesize|free\s*size)|cũng\s*(là\s*)?(freesize|free\s*size)/i.test(t);
}
// Khách thắc mắc TẠI SAO mẫu thì S/M/L, mẫu thì freesize.
function asksWhySizeDiffer(text) {
  const t = String(text || "").toLowerCase();
  if (!/(sao|tại sao|vì sao|why|lại)/.test(t)) return false;
  return /(mẫu).*(freesize|free\s*size).*(mẫu|size)|(freesize|free\s*size).*(mẫu).*(size|s,? ?m|s\/m)|mẫu thì.*(size|s\b).*mẫu thì.*(free)|sao.*(có mẫu|mẫu thì).*(free|size)/i.test(t);
}

// ===== THẺ "GIỮ" = người thật đang xử lý (AI tạm tránh) =====
// Khi 1 trong các thẻ này CÒN trên hội thoại -> coi như người thật đang giữ.
// NV GỠ hết thẻ -> nhường lại cho AI Bảo Trâm xử lý ngay (bỏ 5 phút chờ).
// Các thẻ này = người thật phải vào xử lý -> AI ĐỨNG NGOÀI:
//   AI-CHỜ XL (183), AI-ĐƠN ƯU TIÊN (185), Hàng đổi (166), Đang hoàn (177).
//   - Hàng đổi (166): khách muốn ĐỔI hàng sau khi đã nhận đơn (hậu-đơn, người thật xử).
//   - Đang hoàn (177): khách muốn HOÀN/HỦY đơn (hậu-đơn, người thật xử).
// THẺ AI-XL ảnh (184) KHÔNG chặn: nó chỉ báo "thiếu 1 ảnh để người thật bổ sung",
// còn lại AI VẪN nói chuyện bình thường với khách.
const HOLD_TAG_IDS = [183, 185, 166, 177];
const HOLD_TAG_NAME_RE = /chờ\s*xl|đơn\s*ưu\s*tiên|hàng\s*đổi|đang\s*hoàn/i;
// ĐA TRANG: id thẻ trong Pancake KHÁC nhau theo TỪNG page. HOLD_TAG_IDS ở trên chỉ là id của MỘT page,
// nên trang khác (vd MYSP) có "Hàng đổi"/"CHỜ XL"... mang id KHÁC -> khớp-theo-id trượt; mà payload list
// nhiều khi KHÔNG kèm tên tag -> khớp-theo-tên cũng trượt -> BOT LỌT VÀO dù đã có thẻ giữ.
// Khắc phục: nạp danh sách thẻ CỦA TỪNG PAGE (GET /pages/{pid}/tags), lọc theo TÊN thẻ giữ -> ra id ĐÚNG
// page, cache lại; convHasHoldTag khớp thêm bộ id theo page này.
const _holdIdsByPage = new Map();          // pageId -> { ids:Set<number>, ts:number }
const _HOLD_PAGE_TTL = 10 * 60 * 1000;
async function ensureHoldTagIdsForPage(pageId, token) {
  try {
    const pid = String(pageId || "");
    if (!pid || !token) return;
    const cached = _holdIdsByPage.get(pid);
    if (cached && (Date.now() - cached.ts) < _HOLD_PAGE_TTL) return;
    const url = `https://pages.fm/api/public_api/v1/pages/${pid}/tags?page_access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) { if (!cached) _holdIdsByPage.set(pid, { ids: new Set(), ts: Date.now() }); return; }
    const data = await res.json().catch(() => null);
    const list = (data && (data.tags || data.data)) || (Array.isArray(data) ? data : []);
    if (!Array.isArray(list)) { if (!cached) _holdIdsByPage.set(pid, { ids: new Set(), ts: Date.now() }); return; }
    const ids = new Set();
    for (const t of list) {
      const id = Number(t && (t.id != null ? t.id : t.tag_id));
      const name = String((t && (t.text || t.name || t.title)) || "");
      if (!Number.isNaN(id) && HOLD_TAG_NAME_RE.test(name)) ids.add(id);
    }
    _holdIdsByPage.set(pid, { ids, ts: Date.now() });
    if (ids.size) console.log(`[${BOT_NAME}] Thẻ giữ theo page ${pid}: [${[...ids].join(", ")}]`);
  } catch (_) {}
}
function pageHoldIdSet(pageId) {
  const c = _holdIdsByPage.get(String(pageId || ""));
  return c ? c.ids : null;
}
function convHasHoldTag(conversation, pageId) {
  const pageSet = pageHoldIdSet(pageId);
  const isHoldId = (id) => { const n = Number(id); return HOLD_TAG_IDS.includes(n) || (pageSet && pageSet.has(n)); };
  // (1) ROBUST: đọc id thẻ từ MỌI field (tags/tag_ids/conversation_tags/tag_histories) -> khớp id thẻ giữ
  //     (id cứng toàn cục + id ĐÚNG page).
  try {
    const ids = _extractTagIds(conversation);
    for (const id of ids) if (isHoldId(id)) return true;
  } catch (_) {}
  // (2) Giữ thêm nhánh khớp THEO TÊN trên conversation.tags (phòng khi chỉ có tên, không có id).
  const tags = (conversation && conversation.tags) || [];
  for (const t of tags) {
    if (t == null) continue;
    if (typeof t === "number" || typeof t === "string") {
      if (isHoldId(t) || HOLD_TAG_NAME_RE.test(String(t))) return true;
      continue;
    }
    const id = Number(t.id != null ? t.id : t.tag_id);
    const name = String(t.text || t.name || t.title || "");
    if (isHoldId(id) || HOLD_TAG_NAME_RE.test(name)) return true;
  }
  return false;
}
// Phân biệt loại thẻ giữ:
//  - "CHO_XL" (183 / "chờ xl"): người thật xử lý hẳn -> AI ĐỨNG NGOÀI hoàn toàn.
//  - "DON_UU_TIEN" (185 / "đơn ưu tiên"): người thật chỉ LÊN ĐƠN trên POS -> AI VẪN trả lời được
//    mấy câu đơn giản kịch bản có sẵn (giao mấy ngày, chính sách, STK...) trong lúc chờ.
function holdTagKind(conversation) {
  const tags = (conversation && conversation.tags) || [];
  let choXl = false, donUuTien = false;
  // ROBUST: gộp thêm id thẻ đọc từ MỌI field, để không misroute khi thẻ nằm ngoài conversation.tags.
  let robustIds = [];
  try { robustIds = _extractTagIds(conversation).map(Number); } catch (_) {}
  if (robustIds.includes(183)) choXl = true;
  if (robustIds.includes(185)) donUuTien = true;
  for (const t of tags) {
    if (t == null) continue;
    const id = (typeof t === "number" || typeof t === "string") ? Number(t) : Number(t.id != null ? t.id : t.tag_id);
    const name = (typeof t === "number" || typeof t === "string") ? String(t) : String(t.text || t.name || t.title || "");
    if (id === 183 || /chờ\s*xl/i.test(name)) choXl = true;
    if (id === 185 || /đơn\s*ưu\s*tiên/i.test(name)) donUuTien = true;
  }
  if (choXl) return "CHO_XL";
  if (donUuTien) return "DON_UU_TIEN";
  return null;
}
// Hội thoại có thẻ AI-XL ảnh (184) không? (để TỰ GỠ khi bot đã gửi được ảnh — chống race gắn-thẻ-lệch-nhịp.)
function convHasImageTag(conversation) {
  const tags = (conversation && conversation.tags) || [];
  for (const t of tags) {
    if (t == null) continue;
    if (typeof t === "number" || typeof t === "string") {
      if (Number(t) === 184 || /xl\s*ảnh|xl\s*anh/i.test(String(t))) return true;
      continue;
    }
    const id = Number(t.id != null ? t.id : t.tag_id);
    const name = String(t.text || t.name || t.title || "");
    if (id === 184 || /xl\s*ảnh|xl\s*anh/i.test(name)) return true;
  }
  return false;
}
// Lấy NỘI DUNG tin INBOX mới nhất của khách (để xét khi đang giữ thẻ ĐƠN ƯU TIÊN).
function lastCustomerText(messages) {
  const cust = (messages || [])
    .filter(m => m && m.sender === "customer" && m.channel !== "COMMENT")
    .sort((a, b) => new Date(a.insertedAt) - new Date(b.insertedAt));
  if (!cust.length) return "";
  const last = cust[cust.length - 1];
  return String(last.text || last.message || "");
}
// CÂU HỎI CHUNG trong kịch bản mà bot TRẢ LỜI ĐƯỢC ngay cả khi đơn đã ưu tiên
// (giao mấy ngày KHÔNG gấp, chính sách đổi/hoàn, bảng size, cân nặng theo size, STK).
// KHÔNG gồm: gấp/hẹn ngày, hủy, hoàn/trả, đổi đơn... (mấy cái này để người thật).
function isSimpleScriptQuestion(text) {
  const t = String(text || "");
  if (!t.trim()) return false;
  if (isUrgentSpecificDate(t)) return false;
  if (isCancelOrder(t) || isReturnRefund(t)) return false;
  if (isDeliveryTimeQuestion(t)) return true;
  if (isPolicyQuestion(t)) return true;
  if (asksSizeChart(t)) return true;
  if (asksWeightForSize(t) && !parseWeightKg(t)) return true;
  if (wantsBankInfo(t)) return true;
  return false;
}

// Khách TỰ NÓI size của mình (vd "c mặc S", "size M", "lấy L", hoặc cả tin chỉ là "M") -> trả size (hoặc null)
function extractStatedSize(text) {
  const t = String(text || "");
  // CHỐT: câu HỎI "size X dành cho ai / hợp bao nhiêu cân/kg / mặc được bao nhiêu cân" KHÔNG phải khách
  //   CHỌN size (nhãn AI = SIZE_ADVICE). Trước đây "Size S là dành cho ng bao cân" -> trích "S" -> bot
  //   tưởng chốt size S -> xin sđt/địa chỉ lên đơn. Nay: nhận diện là CÂU HỎI -> trả null (để handler size trả lời).
  if (/(?:size|sz|cỡ)\s*(xs|s|m|l|xl|xxl|xxxl)\b/i.test(t)
      && /(dành cho|danh cho|cho\s*(ng\b|người|nguoi|ai\b)|bao nhiêu\s*(cân|can|kg|ký|ki|kí)|bao\s*(cân|can|ký|ki|kí)|mặc\s*(được|duoc|vừa|vua)|hợp\s*(với|voi|ng|người)?|phù hợp|nặng bao|cao bao)/i.test(t)) {
    return null;
  }
  // (?![\p{L}\p{N}]) = ranh giới UNICODE: size KHÔNG được dính chữ/số khác.
  // -> tránh bắt nhầm S/M/L là chữ cái đầu của từ tiếng Việt có dấu (Mình, Mẫu, Màu, Mặc, là màu...),
  //    vốn làm \b kiểu ASCII của JS hiểu sai => "khách nào cũng ra size M".
  // (1) Có NGỮ CẢNH size đứng ngay trước: mặc / lấy / size / cỡ ...
  const ctx = t.match(
    new RegExp(`(?:mặc|mac|lấy|lay|size|sz|cỡ|co\\s?so)\\s*(?:size\\s*)?(XS|S|M|L|XL|XXL|XXXL|free\\s?size|fs)(?![\\p{L}\\p{N}])`, "iu")
  );
  // (2) HOẶC cả tin nhắn CHỈ là 1 size (trả lời "chị mặc size nào?" bằng "M", "size M ạ", "L nha").
  const only = t.trim().match(
    new RegExp(`^(?:size\\s*)?(XS|S|M|L|XL|XXL|XXXL|free\\s?size|fs)(?:\\s+(?:ạ|a|à|nha|nhe|nhé|nhá|nhỉ|em|e|ơi|oi|với|voi|đó|do|đấy|day|í|ý|thui|thôi))*\\s*\\.?$`, "iu")
  );
  const m = ctx || only;
  if (!m) return null;
  let s = m[1].toUpperCase().replace(/\s+/g, "");
  if (s === "FREESIZE" || s === "FS") s = "FREESIZE";
  return s;
}

function priceIsValid(v) {
  const t = String(v == null ? "" : v).trim();
  if (!t) return false;
  if (/#REF!|#N\/A|#VALUE!|#ERROR|null|NaN/i.test(t)) return false;
  return /\d/.test(t);
}

function formatPrice(v) {
  const digits = String(v || "").replace(/[^\d]/g, "");
  if (!digits) return String(v || "");
  return Number(digits).toLocaleString("vi-VN") + "đ";
}

// Khách có đang YÊU CẦU xem ảnh không?
function wantsImages(text) {
  return /xem ảnh|xem ánh|gửi ảnh|gửi ánh|cho.*xem|gửi.*xem|xem mẫu|ảnh thật|ánh thật|ảnh thực tế|ánh thực tế|xem màu|hình ảnh|cho.*hình|gửi.*hình|xem thêm|xem đi|xem cái|cho.*ảnh|cho.*ánh/i.test(String(text || ""));
}

// Khách đang HỎI tư vấn size? (có kg/chiều cao, hoặc "size gì/nào")
function isAskingSizeAdvice(text) {
  const t = String(text || "");
  if (/\bsize\s*(gì|nao|nào|bao nhiêu)\b/i.test(t)) return true;
  if (/\d{2,3}\s*kg|\bnặng\b|\bcân nặng\b|\bcao\b|\d\s*m\s*\d{1,2}|1m\d{2}/i.test(t)) return true;
  return false;
}

// Bỏ câu tự chốt "em lấy size X" khi đang tư vấn / mâu thuẫn
function stripAutoSizePick(reply) {
  if (!reply) return reply;
  return reply
    .replace(new RegExp(`(,?\\s*)?em lấy size\\s+(${SIZE_RE})( cho chị| cho mình)?( nhe| nha)?( ạ)?\\.?`, "gi"), "")
    .replace(/,\s*(Chị|Dạ)/g, ". $1")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}

// Ép đúng size đã lưu (chống AI lật M->L)
function enforceSize(reply, size, product) {
  if (!reply) return reply;
  // token size, dài trước ngắn sau; CHẶN 2 đầu bằng \p{L} (chữ Unicode) để KHÔNG phá chữ tiếng Việt
  const tok = `(?:XXXL|XXL|XL|XS|FREE\\s?SIZE|FREESIZE|FS|S|M|L)`;
  const after = `(?![\\p{L}])`;
  const reSizeWord = new RegExp(`(?<![\\p{L}])(?:size|cỡ)\\s*${tok}${after}`, "giu");
  const reTakeWear = new RegExp(`(?<![\\p{L}])(lấy|mặc)\\s+${tok}${after}`, "giu");
  const avail = parseAvailableSizes(product && product.size);

  // MẪU CHỈ FREESIZE -> mọi "size X" / "lấy/mặc X" -> freesize (không để lọt M/L bịa)
  if (avail.size === 1 && avail.has("FREESIZE")) {
    return reply.replace(reSizeWord, "freesize")
                .replace(reTakeWear, (_m, v) => `${v} freesize`)
                .replace(/\s{2,}/g, " ");
  }

  // chỉ ép về size đã lưu khi mẫu THỰC SỰ CÓ size đó (hoặc chưa rõ bảng size)
  const useSize = (size && (avail.size === 0 || avail.has(size))) ? size : null;
  if (useSize) {
    const lbl = sizeLabel(useSize);
    reply = reply.replace(reSizeWord, lbl);
    reply = reply.replace(reTakeWear, (_m, v) => `${v} ${lbl}`);
    return reply.replace(/\bsize\s+freesize\b/giu, "freesize").replace(/\s{2,}/g, " ");
  }

  // chưa biết size khách / size khách không có trong bảng -> KHỬ size cụ thể AI tự bịa
  reply = reply.replace(reSizeWord, "size phù hợp");
  return reply.replace(/\s{2,}/g, " ");
}

// ===== TÍNH SIZE BẰNG CODE (theo bảng cân nặng, GIAO với size mẫu THỰC CÓ) =====
// Bảng chuẩn: S 40-48 | M 49-55 | L 56-60 | Freesize 42-57 (chỉ khi mẫu CÓ freesize)
// Bảng cân nặng -> size (MYS.P):
//   S: 40–48 | M: 49–57 | L: 56–61 | Freesize: 42–57
// VÙNG CHỒNG (56–57kg thuộc cả M lẫn L) -> ƯU TIÊN size LỚN (L); L hết mới về M.
// >61kg = quá tầm shop (không có size).
function weightToBaseSize(kg) {
  if (kg <= 48) return "S";
  if (kg <= 55) return "M";   // 49–55 -> M
  if (kg <= 61) return "L";   // 56–61 -> L (56–57 ưu tiên L)
  return "L";                 // >61: để resolveSizeByWeight xử "OVER"
}
// Trả DANH SÁCH size hợp cân, sắp theo ƯU TIÊN (lớn->nhỏ) để chọn size lớn nhất CÒN hàng.
// vd 56kg -> ["L","M"] (ưu tiên L, L hết thì M); 53kg -> ["M"]; 46kg -> ["S"].
function weightAllowedSizes(kg) {
  const out = [];
  if (kg >= 56 && kg <= 61) out.push("L");
  if (kg >= 49 && kg <= 57) out.push("M");
  if (kg >= 40 && kg <= 48) out.push("S");
  return out;   // [] nếu <40 hoặc >61 (quá tầm)
}
function parseAvailableSizes(str) {
  const up = String(str || "").toUpperCase();
  const set = new Set();
  if (/FREE\s*SIZE|FREESIZE|\bFS\b|\bFZ\b/.test(up)) set.add("FREESIZE");
  for (const m of up.match(/\b(XS|S|M|L|XL|XXL|XXXL)\b/g) || []) set.add(m);
  return set;
}
function parseWeightKg(text) {
  const t = String(text || "").toLowerCase();
  // 1) số kèm ĐƠN VỊ: "48kg", "48 cân", "48 ký", "48kí". Nhận cả gõ sai "kh" (=kg, phím h cạnh g).
  //    KHÔNG nhận "k" trơn (52k = 52 nghìn = giá, không phải cân).
  let m = t.match(/(\d{2,3})\s*(kg|kgs|kh|kí|ký|ki|ky|cân|can)(?![\wà-ỹÀ-Ỹ])/);
  if (m) return parseInt(m[1], 10);
  // 2) "nặng 48" / "cân nặng 48" / "nặng tầm 48" (số đứng SAU chữ "nặng", KHÔNG cần đơn vị)
  //    Chấp nhận gõ sai dấu: "nạng"/"nang".
  m = t.match(/(?:cân\s*)?n[ặạăa]ng\s*(?:tầm|khoảng|cỡ|chừng|độ|tròm trèm)?\s*(\d{2,3})\b/);
  if (m) return parseInt(m[1], 10);
  return null;
}
function sizeLabel(s) { return s === "FREESIZE" ? "freesize" : `size ${s}`; }
// Size GỌN cho câu chốt: "S"/"M"/"L"... hoặc "freesize" (KHÔNG có chữ "size" cho ngắn).
function _sizeShort(s) { if (!s) return ""; const u = String(s).toUpperCase(); return u === "FREESIZE" ? "freesize" : u; }
// [NGUYÊN TẮC] Đuôi câu sau khi ĐÃ xác nhận mẫu/size vừa cho khách:
//  - ĐỦ sđt + địa chỉ  -> được phép mời "Chị ưng em lên đơn cho mình nha".
//  - THIẾU sđt/địa chỉ -> KHÔNG mời lên đơn, mà XIN sđt + địa chỉ trước.
function orderCtaOrAskContact(mem) {
  return (mem && mem.phone && mem.address)
    ? "Chị ưng em lên đơn cho mình nha"
    : "Chị cho em xin số điện thoại và địa chỉ để em lên đơn cho mình nha?";
}
const _up = s => String(s == null ? "" : s).toUpperCase();
const _notFree = s => s && _up(s) !== "FREESIZE";
// Size đã chốt RIÊNG cho 1 DÒNG (mã + màu) — dùng cho đơn nhiều mẫu/màu, mỗi cái 1 size.
// Key: "<CODE>|<màu folded>". Có bản theo mã trống "<CODE>|" làm fallback.
function sizeForLine(mem, p) {
  const code = _up((p && p.code) || "");
  if (!code || !mem || !mem.sizeByLine) return null;
  const color = (typeof chosenColorForCode === "function") ? (chosenColorForCode(mem, p) || "") : "";
  const k1 = code + "|" + foldVi(color);
  if (color && _notFree(mem.sizeByLine[k1])) return _up(mem.sizeByLine[k1]);
  const k0 = code + "|";
  if (_notFree(mem.sizeByLine[k0])) return _up(mem.sizeByLine[k0]);
  return null;
}
// S/M (và XS) -> yên tâm vừa freesize. L trở lên -> PHẢI kiểm tra cao/nặng (freesize chỉ tới ~57kg).
const FREE_SAFE_SIZES = new Set(["XS", "S", "M"]);
function freesizeNeedsWeightCheck(mem) {
  const cs = mem && mem.customerSize;
  if (!cs || cs === "FREESIZE") return false;      // chưa biết size -> nhánh khác hỏi cao/nặng
  return !FREE_SAFE_SIZES.has(_up(cs));             // L/XL... -> cần kiểm tra cân nặng
}
// CÂU TƯ VẤN cho mẫu CHỈ FREESIZE: TUYỆT ĐỐI không đọc size S/M/L của khách ra (điều 1 + điều 2).
// - chưa biết gì / khách L+ chưa có cân nặng -> hỏi cao+nặng để KIỂM TRA vừa freesize không.
// - S/M hoặc đã có cân nặng/số đo -> chỉ nói freesize vừa đẹp.
function freesizeLine(mem, product) {
  const label = productLabel(product);
  const noBody = !mem.weightKg && !mem.measure3V;
  if ((!mem.customerSize && noBody) || (freesizeNeedsWeightCheck(mem) && noBody)) {
    return `Dạ ${label} là freesize chị ạ, chị cho em xin chiều cao và cân nặng để em tư vấn cho mình nha ạ?`;
  }
  return `Dạ ${label} là freesize chị ạ, chị mặc mẫu này vừa đẹp đó ạ. ${orderCtaOrAskContact(mem)}`;
}
// SIZE ĐƠN THỰC TẾ theo MẪU: mẫu chỉ freesize -> LUÔN "FREESIZE"; mẫu S/M/L -> size CHỐT RIÊNG cho dòng này trước, rồi size chung của khách.
function effectiveSize(mem, product) {
  const avail = parseAvailableSizes(product && product.size);
  if (avail.size === 1 && avail.has("FREESIZE")) return "FREESIZE";
  const cs = sizeForLine(mem, product) || (mem && mem.customerSize);   // ưu tiên size CHỐT RIÊNG (đơn nhiều màu/size)
  if (!cs || cs === "FREESIZE") return null;            // FREESIZE không phải size người -> coi như chưa biết
  if (avail.size && !avail.has(cs)) return null;        // size khách không nằm trong bảng mẫu -> đừng auto-chốt sai
  return cs;
}
function effectiveSizeLabel(mem, product) {
  const s = effectiveSize(mem, product);
  return s ? sizeLabel(s) : "";
}
// ===== THEO DÕI THỜI ĐIỂM BÁO GIÁ (để 24h mỗi mẫu chỉ báo giá 1 lần, trừ khi khách hỏi giá) =====
function markPriced(mem, code) {
  const k = String(code || "").toUpperCase();
  if (!k) return;
  mem.pricedCodes = mem.pricedCodes || [];
  if (!mem.pricedCodes.includes(k)) mem.pricedCodes.push(k);
  mem.pricedAt = mem.pricedAt || {};
  mem.pricedAt[k] = Date.now();
}
function quotedRecently(mem, code, hours = 24) {
  const k = String(code || "").toUpperCase();
  if (!k || !mem || !mem.pricedAt) return false;
  const t = mem.pricedAt[k];
  return !!t && (Date.now() - t) < hours * 3600 * 1000;
}
// ===== HƯỚNG A: bot "NHÌN THẤY" giá ĐÃ báo trong LUỒNG (kể cả do NGƯỜI THẬT gõ tay) =====
// quotedRecently chỉ nhớ giá DO BOT tự báo (markPriced/mem.pricedAt). Khi NV gõ giá tay (hoặc mem bị reset),
// bot MÙ -> tưởng mẫu mới chưa báo giá -> báo lại + gửi lại ảnh dù khách chỉ xin ảnh. Hàm này quét tin phía
// SHOP trong luồng: tin nào có ĐỦ (SỐ TIỀN của mẫu) + (TÊN hoặc MÃ mẫu) -> coi như mẫu ĐÃ được báo giá rồi.
// Bắt buộc khớp CẢ tiền LẪN tên/mã để 2 mẫu khác nhau cùng giá KHÔNG bị nhận nhầm.
function _digitsOnly(s) { return String(s == null ? "" : s).replace(/\D+/g, ""); }
function pricedInThread(messages, productInfo, hours = 24) {
  if (!productInfo || !Array.isArray(messages) || !messages.length) return false;
  // Số tiền cần dò (raw digits): giá gốc + giá sale; bỏ rỗng/0/ngắn (<4 chữ số = không phải tiền).
  const priceDigits = [];
  for (const v of [productInfo.price, productInfo.salePrice]) {
    const d = _digitsOnly(v);
    if (d && d !== "0" && d.length >= 4 && !priceDigits.includes(d)) priceDigits.push(d);
  }
  if (!priceDigits.length) return false;
  // Tên/mã mẫu (fold) để chống trùng giá giữa 2 mẫu khác nhau.
  const codeFold = foldVi(productInfo.code || "").replace(/\s+/g, "");
  const nameFold = foldVi(productInfo.name || "");
  if (!codeFold && nameFold.length < 3) return false;   // không có tên/mã đủ nhận -> không dám kết luận
  const now = Date.now();
  for (const m of messages) {
    if (!m || m.sender !== "shop" || m.type !== "text" || !m.text) continue;   // CHỈ tin phía shop (bot/NV)
    const t = m.insertedAt ? Date.parse(m.insertedAt) : NaN;
    if (!Number.isNaN(t) && (now - t) > hours * 3600 * 1000) continue;          // ngoài 24h thì bỏ (đọc được giờ mới lọc)
    const digitsText = _digitsOnly(m.text);
    if (!priceDigits.some(d => digitsText.includes(d))) continue;              // tin này KHÔNG chứa số tiền của mẫu
    const foldedText = foldVi(m.text);
    const hasModel = (codeFold && foldedText.replace(/\s+/g, "").includes(codeFold))
      || (nameFold.length >= 3 && foldedText.includes(nameFold));
    if (hasModel) return true;
  }
  return false;
}

// ĐÃ có ĐƠN cho mẫu này trong HỘI THOẠI chưa? Quét tin phía shop (bot/NV) tìm câu XÁC NHẬN ĐƠN +
//   tên/mã mẫu khớp. Đọc TỪ MESSAGES (không phụ thuộc RAM) -> BỀN qua pm2 restart + bắt được đơn
//   NHÂN VIÊN chốt tay. Khớp mẫu để KHÔNG chặn nhầm khi khách đặt THÊM mẫu KHÁC.
function orderedInThread(messages, productInfo, hours = 72) {
  if (!Array.isArray(messages) || !messages.length) return false;
  const codeFold = foldVi((productInfo && productInfo.code) || "").replace(/\s+/g, "");
  const nameFold = foldVi((productInfo && productInfo.name) || "");
  const now = Date.now();
  for (const m of messages) {
    if (!m || m.sender !== "shop" || m.type !== "text" || !m.text) continue;   // CHỈ tin phía shop (bot/NV)
    const t = m.insertedAt ? Date.parse(m.insertedAt) : NaN;
    if (!Number.isNaN(t) && (now - t) > hours * 3600 * 1000) continue;
    const f = foldVi(m.text);
    // Dấu hiệu 1 câu XÁC NHẬN ĐƠN (đặc trưng, ít nhầm):
    const isOrderConfirm =
      (f.includes("cam on") && f.includes("dat hang"))            // "Cảm ơn chị đã đặt hàng"
      || f.includes("dang duoc tao tren he thong")               // "đơn đang được tạo trên hệ thống"
      || (f.includes("cod") && (f.includes("sdt") || f.includes("so dien thoai")) && f.includes("dia chi")); // block COD/SĐT/Địa chỉ
    if (!isOrderConfirm) continue;
    // Có mã/tên để khớp -> bắt buộc mẫu trùng (tránh chặn nhầm khi đặt THÊM mẫu khác).
    if (codeFold || nameFold.length >= 3) {
      const ff = f.replace(/\s+/g, "");
      const hasModel = (codeFold && ff.includes(codeFold)) || (nameFold.length >= 3 && f.includes(nameFold));
      if (!hasModel) continue;
    }
    return true;
  }
  return false;
}
// Bắt cặp size "LĂN TĂN" KHÔNG cần prefix mặc/lấy: "lúc M lúc L", "khi M khi L", "M hoặc/với/hay L", "M-L".
// (Khách trả lời "chị mặc size bao nhiêu" bằng "lúc M lúc L" = CHƯA CHẮC size -> phải xin cao/nặng.)
function detectsWaveringSizes(text) {
  const t = String(text || "");
  const out = [];
  let m;
  const reLuc = /(?:lúc|luc|khi|hôm|bữa|có hôm|có khi|đôi khi)\s*(?:thì\s*)?(?:mặc|mac|lấy|lay|mang|dùng|dung|đi|size|sz|cỡ|co)?\s*(?<![\p{L}\p{N}])(XS|S|M|L|XL|XXL|XXXL)(?![\p{L}\p{N}])/giu;
  while ((m = reLuc.exec(t)) !== null) out.push(_up(m[1]));
  const rePair = /(?<![\p{L}\p{N}])(XS|S|M|L|XL|XXL|XXXL)\s*(?:hoặc|hoac|với|voi|hay|or|\/|–|—|-)\s*(XS|S|M|L|XL|XXL|XXXL)(?![\p{L}\p{N}])/giu;
  while ((m = rePair.exec(t)) !== null) { out.push(_up(m[1])); out.push(_up(m[2])); }
  return [...new Set(out)];
}
// Bắt MỌI size khách TỰ KHAI trong 1 tin (để phát hiện lăn tăn "lúc S lúc M" trong cùng lượt).
function extractAllStatedSizes(text) {
  const t = String(text || "");
  const out = [];
  const re = /(?:mặc|mac|lấy|lay|size|sz|cỡ)\s*(?:size\s*)?(XS|S|M|L|XL|XXL|XXXL|free\s?size|fs)(?![\p{L}\p{N}])/giu;
  let m;
  while ((m = re.exec(t)) !== null) {
    let s = _up(m[1]).replace(/\s+/g, "");
    if (s === "FS") s = "FREESIZE";
    out.push(s);
  }
  return out;
}
// Bắt cặp (MÀU -> CÂN NẶNG) trong 1 tin: "màu vàng 61kg, màu hồng tím 55kg" -> [{color,kg}]
function parseColorWeightPairs(text, product) {
  const t = String(text || "");
  const cols = String((product && product.color) || "").split(/[,/|]/).map(s => s.trim()).filter(Boolean);
  if (cols.length < 2) return [];
  const pairs = [];
  const re = /m[àa]u\s+([\s\S]+?)(?=(?:\s+m[àa]u\s)|$)/giu;   // mỗi cụm bắt đầu bằng "màu ..."
  let m;
  while ((m = re.exec(t)) !== null) {
    const seg = m[1];
    let color = null;
    for (const c of cols) { if (colorMatches(c, seg) || foldVi(seg).includes(foldVi(c))) { color = c; break; } }
    const wk = (seg.match(/(\d{2,3})\s*(?:kg|kgs|kí|ký|cân|can)/i) || [])[1];
    const kg = wk ? parseInt(wk, 10) : null;
    if (color && kg) pairs.push({ color, kg });
  }
  const seen = new Set();
  return pairs.filter(p => (seen.has(p.color) ? false : seen.add(p.color)));   // unique theo màu
}
// Bắt MỌI cân nặng (có đơn vị) trong 1 tin: "50kg với 60kg", "m7 61kg ... m6 55kg" -> [50,60] / [61,55].
function parseAllWeights(text) {
  const t = String(text || "").toLowerCase();
  const out = [];
  const re = /(\d{2,3})\s*(?:kg|kgs|kí|ký|cân|can)\b/gi;
  let m;
  while ((m = re.exec(t)) !== null) { const k = parseInt(m[1], 10); if (k >= 30 && k <= 150) out.push(k); }
  return out;
}
// Đơn này CÓ cần hỏi size không? Nếu MỌI mẫu trong đơn đều là freesize -> KHÔNG cần size.
function orderNeedsSize(mem, productInfo) {
  const items = (mem && mem.quotedProducts && mem.quotedProducts.length) ? mem.quotedProducts
              : (productInfo ? [productInfo] : []);
  if (!items.length) return true;
  return items.some(p => {
    const avail = parseAvailableSizes(p && p.size);
    return !(avail.size === 1 && avail.has("FREESIZE"));   // còn mẫu KHÔNG-phải-freesize -> vẫn cần size
  });
}
// "Váy Féline freesize", "Set Miretta size S" — size theo TỪNG mẫu (freesize-only -> freesize; S/M/L -> size khách).
function productWithSizeLabel(mem, p) {
  const label = productLabel(p);
  const s = effectiveSizeLabel(mem, p);   // "freesize" / "size S" / ""
  return s ? `${label} ${s}` : label;
}
// Danh sách mẫu KÈM size từng mẫu: "Váy Féline freesize và Set Miretta size S".
function quotedListWithSizes(mem, productInfo) {
  const items = (mem && mem.quotedProducts && mem.quotedProducts.length) ? mem.quotedProducts
              : (productInfo ? [productInfo] : []);
  return joinVi(items.map(p => productWithSizeLabel(mem, p)).filter(Boolean));
}
// MÀU KHÁCH ĐÃ CHỐT cho 1 mã (để ghi vào câu xác nhận đơn, phục vụ lên đơn POS sau này).
// Ưu tiên: màu chốt theo mã -> màu chốt phiên (khi 1 mẫu) -> màu đọc từ ảnh khách gửi ->
//          màu khách xin xem (khi 1 mẫu) -> nếu mẫu CHỈ có đúng 1 màu thì lấy luôn. Không rõ -> "".
function _singleColorOfProduct(p) {
  const cols = splitColors(p && p.color);
  return cols.length === 1 ? cols[0] : "";
}
function chosenColorForCode(mem, p) {
  const code = String((p && p.code) || "").toUpperCase();
  // CHỈ coi là "đã chốt màu" khi: (1) khách đã chọn/đã gửi ảnh đúng màu (orderColorByCode), hoặc
  // (2) mẫu CHỈ có đúng 1 màu (không có gì để chọn). TUYỆT ĐỐI KHÔNG đoán theo màu khách "xem"
  // hay theo màu cũ của mẫu khác (tránh điền sai màu vào đơn).
  const explicit = mem && mem.orderColorByCode && mem.orderColorByCode[code];
  if (explicit) {
    // XÁC MINH THEO SHEET: màu chốt PHẢI nằm trong danh sách màu THẬT của mẫu. Nếu mẫu CÓ liệt kê màu mà
    // màu chốt KHÔNG khớp màu nào -> nhận định màu SAI (đọc nhầm) -> BỎ, để trống -> bot hỏi lại màu,
    // TUYỆT ĐỐI không ghi màu sai vào đơn. (vd Giannal chỉ có hồng mà chốt "vàng" -> loại.)
    const _cols = modelColorList(p);
    const _okColor = !_cols.length || _cols.some(c =>
      colorMatches(c, explicit) || colorMatches(explicit, c) || foldVi(c) === foldVi(explicit));
    if (_okColor) return String(explicit).trim().toLowerCase();
    try { console.log(`[${BOT_NAME}] Màu chốt "${explicit}" KHÔNG có trong sheet mẫu ${code} (có: ${_cols.join(", ")}) -> BỎ, để trống/hỏi lại màu.`); } catch (_) {}
    // rơi xuống: nếu mẫu chỉ 1 màu thì lấy màu đó; còn lại -> "" (cần hỏi xác nhận).
  }
  const one = _singleColorOfProduct(p);
  if (one) return String(one).trim().toLowerCase();
  return "";   // nhiều màu, chưa chốt -> để trống, phải HỎI xác nhận trước khi chốt
}
// Danh sách MÀU thật của mẫu (đã lọc ghi chú nội bộ).
function modelColorList(p) {
  return cleanColors(p && p.color);
}
// Mẫu NHIỀU màu mà khách CHƯA chốt màu -> cần hỏi xác nhận trước khi lên đơn.
function needsColorConfirm(mem, productInfo) {
  const items = (mem && mem.quotedProducts && mem.quotedProducts.length) ? mem.quotedProducts
              : (productInfo ? [productInfo] : []);
  return items.some(p => {
    const code = String((p && p.code) || "").toUpperCase();
    const colors = modelColorList(p);
    const confirmed = mem && mem.orderColorByCode && mem.orderColorByCode[code];
    return colors.length >= 2 && !confirmed;
  });
}
// Câu HỎI XÁC NHẬN MÀU. Gợi ý đúng màu khách vừa xem; không có thì liệt kê màu để khách chọn.
// (Đồng thời set mem.pendingColorConfirm để lượt sau hiểu câu "ừ/ok/màu X" là chốt màu.)
function colorConfirmAsk(mem, productInfo) {
  const p = productInfo || (mem.quotedProducts || [])[0];
  const code = String((p && p.code) || "").toUpperCase();
  const colors = modelColorList(p);
  const looked = mem.lastSentImageColor || mem.askedImageColor || "";
  if (looked && colors.some(c => colorMatches(c, looked) || colorMatches(looked, c))) {
    mem.pendingColorConfirm = { code, color: looked };
    return `Dạ chị lấy màu ${String(looked).toLowerCase()} cho mình nha ạ?`;
  }
  mem.pendingColorConfirm = { code, color: null };
  return `Dạ mẫu này có màu ${joinVi(colors.map(c => String(c).toLowerCase()))} ạ, chị lấy màu nào để em lên đơn cho mình nha`;
}
// "Váy Geneva - kem - size S" — KÈM màu chốt (nếu biết) + size từng mẫu. Dùng cho CÂU XÁC NHẬN ĐƠN.
function productWithColorSizeLabel(mem, p) {
  const label = productLabel(p);
  const color = chosenColorForCode(mem, p);     // "" nếu chưa rõ màu
  const s = effectiveSizeLabel(mem, p);         // "size S" / "freesize" / ""
  let out = label;
  if (color) { out += ` - ${color}`; if (s) out += ` - ${s}`; }
  else if (s) out += ` ${s}`;
  return out;
}
function quotedListWithColorSizes(mem, productInfo) {
  // ĐƠN THEO DÒNG -> liệt kê từng dòng "Tên - màu - size [xN]" (cùng mẫu vẫn ra nhiều dòng).
  if (_orderLinesActive(mem, productInfo)) {
    const byCode = {};
    for (const p of (mem.quotedProducts || [])) byCode[_up(p.code)] = p;
    if (productInfo) byCode[_up(productInfo.code)] = productInfo;
    const rows = mem.orderLines.map(ln => {
      const p = byCode[_up(ln.code)] || productInfo || (mem.quotedProducts || [])[0];
      const nm = productLabel(p) || (p && p.name) || "";
      const nameColor = [nm, String(ln.color || "").toLowerCase()].filter(Boolean).join(" - ");
      const size = _sizeShort(ln.size);
      const qtyS = (ln.qty && ln.qty > 1) ? ` x${ln.qty}` : "";
      return { nameColor, size, qtyS };
    }).filter(r => r.nameColor);
    // CÙNG size (mọi dòng cùng 1 size, không có dòng số lượng >1) -> ghi size 1 LẦN ở cuối, không lặp.
    const szs = rows.map(r => r.size);
    if (rows.length >= 2 && szs.every(s => s && s === szs[0]) && rows.every(r => !r.qtyS)) {
      return joinVi(rows.map(r => r.nameColor)) + ` - ${szs[0]}`;
    }
    return joinVi(rows.map(r => [r.nameColor, r.size].filter(Boolean).join(" - ") + r.qtyS));
  }
  const items = (mem && mem.quotedProducts && mem.quotedProducts.length) ? mem.quotedProducts
              : (productInfo ? [productInfo] : []);
  // Tách "tên - màu" và size riêng để gộp size khi tất cả mã cùng size.
  const segs = items.map(p => {
    const label = productLabel(p);
    const color = chosenColorForCode(mem, p);
    const size = _sizeShort(effectiveSize(mem, p));   // "S" / "freesize" / ""
    const nameColor = color ? `${label} - ${color}` : label;
    const full = size ? (color ? `${nameColor} - ${size}` : `${nameColor} ${size}`) : nameColor;
    return { nameColor, size, full };
  }).filter(x => x.nameColor);
  if (!segs.length) return "";
  const sizes = segs.map(x => x.size);
  // CÙNG size -> ghi size 1 LẦN ở cuối (không mã nào cũng lặp size).
  if (segs.length >= 2 && sizes.every(s => s && s === sizes[0])) {
    return joinVi(segs.map(x => x.nameColor)) + ` - ${sizes[0]}`;
  }
  return joinVi(segs.map(x => x.full));
}
// Gọi tên sản phẩm theo CHỦNG LOẠI (từ đầu) + tên: "Set quần Polina" -> "Set Polina", "Váy xòe Pora" -> "Váy Pora".
// Không có chủng loại -> "mẫu <tên>". Không có tên -> "mẫu này".
function productLabel(product) {
  if (!product || !product.name) return "mẫu này";
  const head = String(product.category || "").trim().split(/\s+/)[0] || "";
  return head ? `${head} ${product.name}` : `mẫu ${product.name}`;
}
function productLabelSp(product) { return productLabel(product) + " "; }   // bản có dấu cách đuôi cho các chỗ ghép câu

// Điền chỗ trống trong CÂU MẪU lấy từ sheet (tab AI AGENT, cột D).
// Hỗ trợ cả [token] và {token}, không phân biệt hoa thường. Token rỗng -> xoá gọn.
function fillTemplate(tpl, vars) {
  if (!tpl) return "";
  let out = String(tpl);
  const map = {
    "số lượng": vars.sl, "so luong": vars.sl, "sl": vars.sl, "số mẫu": vars.sl, "so mau": vars.sl,
    "địa chỉ cũ": vars.dia_chi, "dia chi cu": vars.dia_chi, "địa chỉ": vars.dia_chi, "dia chi": vars.dia_chi,
    "số điện thoại": vars.sdt, "so dien thoai": vars.sdt, "sđt": vars.sdt, "sdt": vars.sdt,
    "size": vars.size, "tên mẫu": vars.ten_mau, "ten mau": vars.ten_mau,
    "giá": vars.gia, "gia": vars.gia, "số lượng mẫu": vars.sl
  };
  for (const [k, v] of Object.entries(map)) {
    const val = (v == null ? "" : String(v));
    const re = new RegExp("[\\[{]\\s*" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[\\]}]", "giu");
    out = out.replace(re, val);
  }
  return out.replace(/\s{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
}

// Làm đẹp câu liệt kê nhiều cơ sở: "CS 1: ... CS 2: ..." -> xuống dòng +mỗi cơ sở.
function prettifyAddressList(reply) {
  if (!reply) return reply;
  const markerRe = /(CS\s*\d+\s*:|cơ\s*sở\s*\d+\s*:)/gi;
  const markers = reply.match(markerRe);
  if (!markers || markers.length < 2) return reply;   // chỉ xử lý khi có >= 2 cơ sở
  let out = reply.replace(markerRe, m => `\n${m.trim()}`);
  out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

// CODE bắt CỨNG: khách cáu giận / từ tiêu cực / đòi gặp người thật -> ép TAG_HUMAN, không đợi AI.
function isAngryOrSensitive(text) {
  const t = String(text || "").toLowerCase();
  // từ cáu giận / tiêu cực (theo tab AI AGENT)
  if (/lừa đảo|lua dao|mất dạy|mat day|bố láo|bo lao|vớ vẩn|vo van|không uy tín|khong uy tin|\bkiện\b|\bkien\b|bỏ lơ|bo lo|\bchó\b|\bcho má\b|\bngu\b|đm|đcm|vkl|wtf|cẩu thả/i.test(t)) return true;
  // đòi gặp người thật / nhân viên thật
  if (/gặp người thật|gap nguoi that|nhân viên thật|nhan vien that|gặp nhân viên|cho gặp người|người thật đâu|admin đâu/i.test(t)) return true;
  return false;
}
// Dấu hiệu PHẢI nhường người thật thật sự (kể cả khi đã biết mẫu): CK/thanh toán, hủy/đổi/trả,
// hỏi đơn cũ, đổi địa chỉ sau khi lên đơn, đòi ngày cụ thể/gấp.
function isSensitiveHandoff(text) {
  const t = String(text || "").toLowerCase();
  if (/chuyển khoản|chuyen khoan|(?<![a-zà-ỹ])ck(?![a-zà-ỹ])|đã chuyển|da chuyen|\bbill\b|hóa đơn|chuyển tiền|cọc|đặt cọc/i.test(t)) return true;
  if (/hủy đơn|huy don|hủy đặt|đổi hàng|trả hàng|tra hang|hoàn tiền|hoan tien|bom hàng/i.test(t)) return true;
  if (/đơn.*(gửi chưa|đến đâu|tới đâu|ở đâu|chưa gửi)|mã vận đơn|tracking|đơn của (em|chị|mình)/i.test(t)) return true;
  if (/đổi địa chỉ|doi dia chi|đổi số điện thoại|sửa đơn|đổi sđt/i.test(t)) return true;
  if (isUrgentSpecificDate(t)) return true;
  return false;
}
// KHÁCH BÁO BOT TRẢ LỜI SAI / LẠC ĐỀ ("shop nhắn nhầm", "trả lời sai rồi", "không liên quan",
// "hỏi 1 đằng trả lời 1 nẻo", "có đọc tin không")... -> DỪNG phun câu mẫu, NHƯỜNG NGƯỜI THẬT.
function saysBotMistake(text) {
  const t = String(text || "").toLowerCase();
  if (/(nhắn|nhan|trả lời|tra loi|gửi|gui|rep|reply)\s*(lại\s*)?(nhầm|nham|lộn|lon|sai|bậy|bay|linh tinh|lung tung|tào lao|tao lao)/.test(t)) return true;
  if (/(nhầm|nham|lộn|lon)\s*(rồi|roi|tin|ùi|ui|à|a)\b/.test(t)) return true;
  if (/(sai|trật|trat)\s*(rồi|roi|câu hỏi|cau hoi|đề|de|chủ đề|chu de|ý|y)\b/.test(t)) return true;
  if (/(lạc đề|lac de|không liên quan|khong lien quan|chả liên quan|cha lien quan|chẳng liên quan|đâu có hỏi|dau co hoi|có hỏi đâu|co hoi dau|đâu có nói|dau co noi)/.test(t)) return true;
  if (/(hỏi (một|1) (đằng|nơi).*(trả lời|đáp).*(một|1) (nẻo|nơi))|(có (đọc|hiểu).*(tin|gì).*(không|ko|hông))|(đang (nói|trả lời) (cái )?gì (vậy|thế|z|v))/.test(t)) return true;
  return false;
}
// KHÁCH SO SÁNH SHOP KHÁC / HỎI HÀNG THẬT-GIẢ / CHÍNH HÃNG / "bên nào mới chuẩn"
// -> nhạy cảm (không tự khẳng định quan hệ/độ thật giả) -> NHƯỜNG NGƯỜI THẬT.
function asksShopComparison(text) {
  const t = String(text || "").toLowerCase();
  if (/(bên|trang|shop|page|chỗ|cho|nơi|noi|cửa hàng|cua hang)\s*(nào|nao|khác|khac|kia|đó|do)\b[^?]{0,40}(chuẩn|chuan|thật|that|gốc|goc|chính hãng|chinh hang|uy tín|uy tin|real|auth|đúng|dung|xịn|xin)/.test(t)) return true;
  if (/(cũng|cung)\s*(đăng|dang|bán|ban|có|co)\b[^?]{0,30}(giống|giong|y hệt|y het|hệt|het|y chang|giống hệt|giong het|như nhau|nhu nhau)/.test(t)) return true;
  if (/(hàng|hang|đồ|do|sản phẩm|san pham)\s*(giả|fake|nhái|nhai|kém|kem|lởm|lom)(?![a-zà-ỹ])/.test(t)) return true;
  if (/(hàng|hang|đồ|do|sản phẩm|san pham)\s*(thật|that|real|auth|chính hãng|chinh hang)\s*(không|khong|ko|hông|hong|à|a|hay|chứ|chu|đấy|day|đó|do|hả|ha|đúng|dung)\b/.test(t)) return true;
  if (/(có phải|co phai|đúng|dung|phải|phai)\s*(là\s*)?(hàng\s*)?(thật|that|chính hãng|chinh hang|real|gốc|goc|auth)\b/.test(t)) return true;
  if (/(chính hãng|chinh hang|hàng thật|hang that|hàng real|hang real)\s*(không|khong|ko|hông|hong|à|a|chứ|chu|đúng ko|dung ko)\b/.test(t)) return true;
  if (/(bên nào|ben nao|trang nào|trang nao|shop nào|shop nao)\s*(mới|moi)?\s*(chuẩn|chuan|thật|that|gốc|goc|uy tín|uy tin)/.test(t)) return true;
  return false;
}
// Khách SỐT RUỘT / CHÊ chậm / mỉa "bán hàng kiểu gì" -> đẩy người thật (đừng để bot/AI trả filler).
//  KHÔNG nhầm câu hỏi thật ("giao bao lâu", "mẫu này còn bán không", "ship lâu không").
function saysImpatientOrSlow(text) {
  const t = String(text || "").toLowerCase();
  return /(chậm)\s*(thế|the|vậy|vay|quá|qua|chạp|v\b)|sao\s*(chậm|lâu)\s*(thế|vậy|quá|the|vay)|làm\s*việc\s*(chậm|kiểu|gì)|làm\s*ăn\s*(chậm|kiểu|gì|chán)|bán\s*hàng\s*(kiểu|gì|thế nào|sao|mà)|(mãi|hoài)\s*(không|ko|chưa|chua)\s*(trả lời|tra loi|trả|rep|reply|tl|nhắn|nhan|gửi|gui|bán|ban)|(đợi|chờ)\s*(mãi|hoài)|có\s*ai\s*(bán|trả lời|tl|đó|ko|không)\s*(không|ko|đó|đấy|vậy|hông|ạ)?\b/i.test(t);
}
// "e ơi", "có đó không", "còn hàng không", "có ai không", "hello shop"... Chỉ tính khi tin NGẮN.
function isGreetingPing(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t || t.length > 40) return false;
  if (/^(alo+|a lô|hello|hi|hallo|shop|sốp|sop)\b/.test(t)) return true;
  if (/(shop|sốp|sop|ad|add|adm|admin|em|e|chị|c|ơi)\s*(ơi|oi)\b/.test(t)) return true;
  if (/(có đó|co do|có ở đó|có ai|co ai|còn đó|con do)\s*(không|khong|ko|k|hông)?/.test(t)) return true;
  if (/(còn hàng|con hang|còn ko|còn không|con khong|còn k)\b/.test(t)) return true;
  if (/^(shop ơi|sốp ơi|ad ơi|e ơi|em ơi|chị ơi|c ơi)$/.test(t)) return true;
  return false;
}
// MỞ MÀN TRỐNG kiểu "xin nhắn tin / quan tâm" mà CHƯA nêu mẫu: "lb"/"ib"/"inbox", "cmt", "xem", "tư vấn",
// "quan tâm", "giá", "mẫu mới"... -> nên GỬI GALLERY mẫu mới cho khách chọn (giống mời khách xem mẫu).
function isOpenerPing(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t || t.length > 20) return false;
  // Loại câu HẬU MÃI / TRA ĐƠN (không phải mở màn quan tâm mẫu).
  if (/(đơn|ship|giao|trả|đổi|hoàn|cọc|tới đâu|đến đâu|bao giờ|khi nào|sao rồi|chưa về|đã gửi)/.test(t)) return false;
  if (/^(l\.?\s?b|ib|i\.?\s?b|inbox|in ?box|info|ifo|cmt|comment|bình luận|binh luan)\b/.test(t)) return true;
  // [FIX Tuyet Nam 2026-08-09] Nút "Bắt đầu" (Get Started) đi KÈM câu hỏi giá trống ("Bắt đầu | Giá bn ạ")
  // -> vẫn là MỞ MÀN TRỐNG (không mẫu, không ad) -> gửi gallery mẫu mới cho khách chọn.
  if (/^(bắt đầu|bat dau|get started|getting started)\b/.test(t) && /(giá|gia|mẫu|mau|xem|tư vấn|tu van|quan tâm|quan tam)/.test(t)) return true;
  if (/^(xem|ngắm|ngam|tư vấn|tu van|quan tâm|quan tam)\b/.test(t)) return true;
  if (/^(giá|gia|bảng giá|bang gia|báo giá|bao gia)(?![a-zà-ỹ])/.test(t)) return true;
  if (/^(mẫu|mau|có mẫu|co mau|hàng mới|hang moi|mẫu mới|mau moi|còn mẫu|con mau)\b/.test(t)) return true;
  return false;
}
// TIN CHỈ LÀ NÚT "BẮT ĐẦU" (Get Started) - không kèm ý gì khác. Đây là nút mở màn Messenger, KHÔNG phải khách
// hỏi mẫu. -> KHÔNG được derive mẫu từ caption ad cũ rồi báo giá (lỗi Huệ Nhi). Thay vào đó gửi gallery mẫu mới.
function isGetStartedOnly(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return false;
  return /^(bắt đầu|bat dau|get started|started|\/?start|menu)\s*[.!]*$/i.test(t);
}

// -> coi như khách vừa ghé: GỬI GALLERY mẫu mới cho khách tham khảo (đã có kịch bản). KHÔNG đẩy người.
function _isBlankPing(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (t.length > 6) return false;                                  // dài hơn vài ký tự -> có thể có ý, không coi là trống
  const stripped = t.replace(/[\s.,!?…·•\-_*~"'`(){}\[\]:;@#]/g, "");
  return stripped.length === 0;
}

// KHÔNG tính hủy/hoàn/đổi (đã có isPriorityOrder/isSensitiveHandoff lo). Dùng để tra POS trước khi nhường người thật.
// Câu khách (khi BẤM AD) là THAN PHIỀN / ĐƠN CŨ / không phải tín hiệu mua -> ADS opener KHÔNG được tự báo giá.
// (Phương Lưu: bấm ad mà nhắn "đầu lâu thế chưa có đơn" = than đơn lâu -> bot lại báo giá Giannal.)
function adCustTextBlocksQuote(text) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return false;   // chỉ bấm ad, không chữ -> CHO báo giá mẫu của ad
  if (/hủy|huỷ|hoàn|trả lại|trả hàng|lâu (thế|quá|vậy|rồi|nay)|chưa (có|thấy|nhận|về|giao).{0,10}(hàng|đơn)|sao (giờ|nay|mãi|vẫn|chưa|lâu)|đợi mãi|nãy giờ|mấy ngày (rồi|nay)|chưa nhận|chưa giao|(ko|không) thấy (hàng|đơn)|đơn (đâu|của (mình|c|chị|em))|đã đặt|đặt rồi|bao giờ.{0,10}(có|nhận|giao|hàng)|khi nào.{0,10}(có|nhận|giao|hàng)/i.test(t)) return true;
  return false;
}
// Khách (đến từ AD) thắc mắc "chưa thấy gửi set/váy/ảnh", "sao chưa gửi", "gửi mẫu chưa" = đòi/CHƯA NHẬN sản phẩm
// shop hứa gửi. KHÁC adCustTextBlocksQuote (đòi GIAO HÀNG đã mua) -> ca này VẪN báo giá rồi MỚI gắn người thật.
function asksWhyNotSentYet(text) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return false;
  return /chưa\s*(thấy|thay)?\s*gửi|sao\s*chưa\s*gửi|(gửi|gui)\s*(set|váy|vay|đầm|ảnh|anh|hình|hinh|mẫu|sản phẩm)?\s*chưa\b|chưa\s*(thấy|thay)\s*(set|váy|vay|đầm|ảnh|anh|hình|hinh|sản phẩm|mẫu)/i.test(t);
}
// Khách nhắc tới NHIỀU mẫu trong 1 tin ("mấy cái này", "mấy mẫu này", "các mẫu", "những bộ", "2 mẫu này"...).
// Dùng để: khi khách hỏi nhiều mẫu mà bot chỉ gom được 1 (vd cổng ad chỉ có mẫu ad) -> giao NGƯỜI THẬT báo đủ.
function referencesMultipleModels(text) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return false;
  if (/mấy\s*(cái|mẫu|bộ|kiểu|chiếc|con|váy|đầm|set)\s*(này|đó|kia|trên|ấy)/i.test(t)) return true;   // "mấy cái này"
  if (/(các|những)\s*(mẫu|bộ|cái|kiểu|váy|đầm|set)(?=\s|$|[.,!?;])/i.test(t)) return true;             // "các mẫu" / "những bộ"
  if (/nhiều\s*(mẫu|bộ|cái|kiểu)(?=\s|$|[.,!?;])/i.test(t)) return true;                                // "nhiều mẫu"
  if (/(cả\s*)?([2-9]|\d{2,}|hai|ba|bốn|năm)\s*(mẫu|bộ|cái|kiểu|váy|đầm|set)\s*(này|đó|kia)?(?=\s|$|[.,!?;])/i.test(t)) return true; // "2 mẫu này"
  return false;
}
function asksOrderStatus(text) {
  const t = String(text || "").toLowerCase();
  if (asksInspectBeforePay(t) || asksTryOn(t)) return false;   // "kiểm tra HÀNG / mặc thử" = về SP, KHÔNG phải tra đơn
  // Loại ca rõ ràng KHÔNG phải hỏi tình trạng: hủy/hoàn/đổi/đổi địa chỉ.
  if (/hủy đơn|hoàn tiền|trả hàng|đổi hàng|đổi địa chỉ|đổi sđt|đổi số/i.test(t)) return false;
  // Ship / xe / shipper / ai gọi lấy hàng + nghi vấn (khách đã mua, hỏi giao tới đâu/chưa).
  if (/(xe|shipper|đơn vị|bên ship|ai)\s*(ship|giao|vận chuyển|gọi)[^?]{0,18}(chưa|đâu|chậm|lâu|hàng|tới|đến)/i.test(t)) return true;
  if (/(đã )?ship\s*(cho\s*(chị|mình|c|e|em)\s*)?(chưa|đi chưa|hàng chưa|tới chưa|đến chưa)/i.test(t)) return true;
  if (/(ai|người nào|chưa thấy ai|sao chưa (thấy )?ai)\s*(gọi|liên hệ|lh|tới)[^?]{0,18}(lấy|giao|nhận)\s*hàng/i.test(t)) return true;
  if (/(sao |mà )?(mãi|vẫn|nãy giờ) (chưa|ko|không) (thấy|nhận|có)[^?]{0,18}(hàng|gọi|ship|giao|ai)/i.test(t)) return true;
  // "hàng/đơn/kiện/gói ... đến đâu / gửi chưa / giao chưa / sao rồi / đâu rồi" (cho phép chen 'của c', 'em đặt'...)
  if (/(hàng|đơn|kiện|gói)\b[^?]{0,22}(đến đâu|tới đâu|đi đâu|đi tới đâu|về tới đâu|về chưa|về tới chưa|tới chưa|đến chưa|nhận chưa|gửi chưa|gửi đi chưa|giao chưa|giao tới chưa|ship chưa|đi chưa|sao rồi|thế nào rồi|đâu rồi|tới đâu rồi|ra sao)/i.test(t)) return true;
  // "(shop) GỬI/GIAO/SHIP đồ/hàng (cho mình) CHƯA" — động từ ĐỨNG TRƯỚC danh từ (ca thật: "shop gửi đồ cho mih chưa").
  if (/(gửi|gui|giao|ship)\s+(đồ|do|hàng|hang|đơn|don|kiện|kien|gói|goi|cho\s*(mình|mih|minh|chị|chi|em|e\b|t\b|tôi|toi|c\b))[^?]{0,18}(chưa|chua)\b/i.test(t)) return true;
  // (BỎ pattern "khi nào/bao lâu ... nhận/giao" -> đó là hỏi THỜI LƯỢNG giao chung -> handler trả "5-7 ngày" lo,
  //  KHÔNG tra đơn/đẩy NV. Chỉ giữ các câu TRA TÌNH TRẠNG đơn thật ở trên/dưới.)
  if (/(kiểm tra|tra cứu|check|tra|coi|xem)\s*(giúp |dùm |giùm |xem )?(đơn|hàng|vận đơn|đã ship|ship)/i.test(t)) return true;
  if (/(tình trạng|trạng thái)\s*(của\s*)?(đơn|hàng|giao)/i.test(t)) return true;
  // Đơn ĐÃ đặt rồi -> hỏi sao chưa nhận/giao / khi nào nhận / mấy ngày rồi (KHÁC câu hỏi thời gian giao TRƯỚC khi mua).
  // Gate "đã đặt thật" (đã đặt / đặt rồi / đơn này của mình...) để câu "đặt hàng mấy ngày nhận" (chưa mua) vẫn về handler 5-7 ngày.
  {
    const ordered = /(đã\s*(đặt|order|mua)|(đặt|order|mua)\b[^.?!]{0,15}(rồi|r\b|xong)|đặt\s*bên\s*(mình|shop|em)|đơn\s*(này|của)\s*(mình|em|c\b|chị|tôi|tao|t\b)|đơn\s*(đã|này)\b)/i.test(t);
    const statusAsk = /(chưa\s*(giao|nhận|ship|thấy|gửi|đến|tới|về|có hàng)|(về|nhận|giao|tới|đến|ship|gửi)\s*chưa|có\s*hàng\s*chưa|(nào|khi nào|bao giờ|chừng nào)\s*(thì\s*)?(mới\s*)?(được\s*)?(nhận|giao|có hàng|đến|tới|về)|(mấy|\d+)\s*ngày\s*(rồi|chưa|nay)|sao\s*(lâu|mãi|vẫn)|(vẫn|mãi)\s*chưa|về\s*(tới|đến)?\s*chưa)/i.test(t);
    if (ordered && statusAsk) return true;
  }
  return false;
}
// Số ngày tối thiểu kể từ lúc TẠO đơn thì mới được dùng câu "thuyết phục chờ" (khách vừa đặt thì KHÔNG).
const ORDER_WAIT_PERSUADE_DAYS = Number(process.env.ORDER_WAIT_PERSUADE_DAYS || 2);
// Tuổi đơn (ms) tính từ inserted_at. Không parse được -> 0 (coi như mới, tránh bịa "đã chờ lâu").
function orderAgeMs(o) {
  const t = Date.parse((o && (o.inserted_at || o.created_at)) || "");
  return Number.isFinite(t) ? Math.max(0, Date.now() - t) : 0;
}
// Khách nhắc/đính chính về CHÂN VÁY hoặc SET (vd bot nhận diện áo nhưng khách nói "có cả chân váy", "hỏi set").
function asksSkirtOrSet(text) {
  const t = String(text || "");
  // Hỏi RÕ thành phần: chân váy / có cả váy
  if (/chân váy|chan vay|có cả (chân )?váy|thấy có (cả )?(chân )?váy/i.test(t)) return true;
  // "rời hay liền" / "liền hay rời" / "set hay rời" / "rời hay set"...
  if (/(rời|roi|liền|lien|set|nguyên bộ|nguyen bo)[^.?!]{0,12}(hay|hoặc|hoac|or)[^.?!]{0,12}(rời|roi|liền|lien|set|nguyên bộ|nguyen bo)/i.test(t)) return true;
  // "set/váy/bộ/mẫu này (là) liền/rời (ak/à/ạ...)" — câu KHẲNG ĐỊNH-HỎI, KHÔNG có "hay" (vd "Sét này là liền ak shop")
  if (/(set|sét|váy|vay|đầm|dam|bộ|bo|mẫu|mau|cái|cai|nó\b|no\b|này|nay)[^.?!]{0,14}(là |la |có )?(liền|lien|rời|roi)\b/i.test(t)) return true;
  // chữ "liền/rời" + dấu hỏi/từ hỏi ngay sau (vd "liền ak", "rời ko", "liền hả")
  if (/(liền|lien|rời|roi)\s*(ak\b|à|ạ|hả|\bha\b|không|khong|\bko\b|hông|nhỉ|nhi|vậy|\?)/i.test(t)) return true;
  // "có phải set/rời/liền (không)"
  if (/(có phải|co phai)[^.?!]{0,8}(set|rời|roi|liền|lien|nguyên bộ)/i.test(t)) return true;
  // "set gồm gì / gồm mấy món / có những gì"
  if (/(set|bộ đồ|bộ này|bộ đó)[^.?!]{0,10}(gồm|gom|mấy món|may mon|bao nhiêu món|có những gì|co nhung gi)/i.test(t)) return true;
  // bán/mặc rời, đồ rời, váy rời, mặc nguyên bộ
  if (/bán rời|ban roi|mặc rời|mac roi|đồ rời|do roi|váy rời|vay roi|mặc nguyên bộ|mac nguyen bo/i.test(t)) return true;
  if (asksBuySeparate(t)) return true;   // "bán quần riêng không", "mua lẻ", "tách món"...
  if (asksBottomPart(t)) return true;    // "phần dưới là quần em nhỉ", "bên dưới là gì"...
  return false;
}
// Khách hỏi MUA/BÁN LẺ TỪNG MÓN của set (vd "bán quần riêng không", "mua lẻ áo", "tách món được ko",
// "quần riêng hay set ạ"). -> đã là set thì bán nguyên set, không bán rời.
function asksBuySeparate(text) {
  const t = String(text || "").toLowerCase();
  if (/(quần|quan|áo|ao|chân váy|chan vay|món|mon)\s*(bán|ban|mua|lấy|lay)?\s*riêng|riêng\s*(quần|quan|áo|ao|từng|tung)/i.test(t)) return true;
  if (/(bán|ban|mua|lấy|lay|order|đặt|dat)\s*(lẻ|le)\b|bán lẻ|ban le|lấy lẻ|lay le|mua lẻ|mua le/i.test(t)) return true;
  if (/tách\s*(món|ra|riêng)|tach\s*(mon|ra|rieng)|tách lẻ|tach le/i.test(t)) return true;
  return false;
}
// Khách hỏi PHẦN DƯỚI của mẫu là gì (vd "phần dưới là quần em nhỉ", "bên dưới là gì", "dưới là quần hay váy",
// "phía dưới có phải quần"). -> trả thành phần set theo cột D; không rõ -> trả cấu trúc set (áo + phần dưới).
function asksBottomPart(text) {
  const t = String(text || "").toLowerCase();
  if (!/(phần|phan|bên|ben|phía|phia)\s*dưới|\bdưới\b|ben duoi|phia duoi|phan duoi/.test(t)) return false;
  return /(quần|quan|chân váy|chan vay|váy|vay|đầm|dam|là gì|la gi|\bgì\b|\bgi\b|chân|chan)/.test(t);
}
// Cân nặng TỐI ĐA cho từng size (kg). Quá ngưỡng size lớn nhất mẫu có -> KHÔNG ép, điều hướng mẫu khác.
const SIZE_MAX_KG = { XS: 44, S: 48, M: 57, L: 61, XL: 70, XXL: 80, XXXL: 90, FREESIZE: 57 };
function maxKgForAvail(avail) {
  let max = 0;
  for (const s of avail) { const m = SIZE_MAX_KG[s]; if (m && m > max) max = m; }
  return max;
}
// Chốt 1 size từ cân nặng, chỉ trong các size mẫu THỰC CÓ. null nếu không rõ size mẫu.
// Trả "OVER" nếu khách NẶNG HƠN size lớn nhất mẫu có -> điều hướng mẫu khác (không ép size).
function resolveSizeByWeight(kg, availStr) {
  const avail = parseAvailableSizes(availStr);
  if (avail.size === 0) return null;                 // không rõ size mẫu -> để AI/người xử lý
  const maxKg = maxKgForAvail(avail);
  if (maxKg && kg > maxKg) return "OVER";            // vượt cân size lớn nhất -> không ép
  // Dải size hợp cân, ưu tiên LỚN->nhỏ. Chọn size lớn nhất mà MẪU CÓ (vd 56kg: thử L trước, L hết -> M).
  const allowed = weightAllowedSizes(kg);
  for (const s of allowed) { if (avail.has(s)) return s; }
  // Không có size hợp cân nào trong mẫu -> freesize nếu hợp tầm, còn lại = không vừa (OVER).
  if (avail.has("FREESIZE") && kg >= 42 && kg <= 57) return "FREESIZE";
  return "OVER";   // mẫu không có size hợp cân khách -> KHÔNG ép size sai (vd 55kg mẫu chỉ có L)
}

// ===== CÂN NẶNG LÀ CHÍNH (chống loạn size S/M khi cân nặng & số đo đá nhau) =====
// Khi ĐÃ biết cân nặng và cân nặng cho ra size cụ thể -> dùng size CÂN NẶNG, số đo KHÔNG được
// kéo sang size khác (vd 46kg->S nhưng mông 92 sát mép -> số đo vote M: bỏ qua, giữ S).
// Trả { size, fromWeight }: fromWeight=true nghĩa là size đã đổi theo cân nặng (khác size số đo).
function sizeWeightFirst(measureSize, mem, productInfo) {
  try {
    if (mem && mem.weightKg) {
      const w = resolveSizeByWeight(mem.weightKg, productInfo && productInfo.size);
      if (w && w !== "OVER" && w !== "FREESIZE") return { size: w, fromWeight: w !== measureSize };
    }
  } catch (_) {}
  return { size: measureSize, fromWeight: false };
}

// Cân nặng tối đa shop phục vụ được = size lớn nhất shop có (L). Shop KHÔNG có XL/2XL.
const SHOP_MAX_KG = SIZE_MAX_KG.L;   // 60kg
// Câu báo "không vừa": nếu khách VƯỢT cả size lớn nhất của shop (XL trở lên) -> KHÔNG mẫu nào vừa,
// KHÔNG điều hướng mẫu khác. Nếu chỉ quá size của RIÊNG mẫu này (vẫn trong tầm shop) -> mời chọn mẫu khác.
function noFitReply(weightKg) {
  if (weightKg && weightKg > SHOP_MAX_KG) {
    return "Dạ tiếc quá, hiện bên em chưa có size phù hợp với mình rồi ạ.";
  }
  return "Dạ tiếc quá, mẫu này hiện tại không có size vừa với chị rồi ạ, chị lựa mẫu khác giúp em nha.";
}

// Mẫu hiện tại KHÔNG có size vừa (cân TRONG tầm shop) -> gửi MẪU MỚI KHÁC CÓ size của khách.
// Lọc: bán được (sellable) + CHỈ sheet "Mẫu 2026" + có size vừa cân khách + khác mã hiện tại.
// ƯU TIÊN mã có cột T = "mới" (isNew); CHƯA ĐỦ 8 -> bù mã KHÔNG "mới" (vẫn 2026, miễn có size khách).
// 8 mẫu, mỗi mẫu 2 ảnh (album, lỗi -> gửi lẻ). Trả về SỐ MẪU đã gửi (0 = không có mẫu phù hợp).
async function sendNoFitAlternatives(conversationId, mem, weightKg, currentCode) {
  const _cat = await ensureCatalog();
  const _cc = String(currentCode || "").toUpperCase();
  const _base = (_cat.list || []).filter(p => {
    if (!p || !recommend.sellable(p)) return false;
    if (String(p.code || "").toUpperCase() === _cc) return false;
    if (p.sheetName !== "Mẫu 2026") return false;        // CHỈ lấy mẫu sheet 2026
    const r = resolveSizeByWeight(weightKg, p.size);
    return r && r !== "OVER";                             // CÓ size vừa cân khách
  });
  if (!_base.length) return 0;
  const _shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const _new = _shuffle(_base.filter(p => p.isNew));      // ưu tiên cột T = "mới"
  const _old = _shuffle(_base.filter(p => !p.isNew));     // bù khi chưa đủ 8
  const pick = [..._new, ..._old].slice(0, 8);
  // GỘP 1 ẢNH/MẪU thành 1 ALBUM, gửi 1 LẦN cho nhanh (thay vì gửi album theo TỪNG mã -> chậm).
  const items = []; const codesSent = [];
  for (const p of pick) {
    const C = String(p.code || "").toUpperCase();
    let im = [];
    try { im = (imageItemsByColor(C, null, 1, true) || []).slice(0, 1); } catch (_) {}
    if (!im.length) continue;
    items.push({ contentId: im[0].contentId || null, url: im[0].url || null });
    codesSent.push(C);
    if (codesSent.length >= 8) break;
  }
  if (!items.length) return 0;
  const gallery = { items, contentIds: items.map(i => i.contentId).filter(Boolean), imageUrls: items.map(i => i.url).filter(Boolean), caption: "", codes: codesSent };
  // sendGallery: gửi lời mời (intro) -> rồi 1 ALBUM content_ids 1 phát (fail thì tự gửi lẻ; khách chen tin thì tự dừng).
  await sendGallery(conversationId, gallery, mem, "Dạ tiếc quá, mẫu này hiện tại không có size vừa với chị rồi ạ, em gửi chị tham khảo 1 số mẫu khác có size của mình nha, chị lựa ưng mẫu nào gửi ảnh em tư vấn cho mình nhe.");
  console.log(`[${BOT_NAME}] No-fit alt (2026): ưu tiên ${_new.length} mã MỚI + bù ${_old.length} mã thường -> 1 ALBUM ${codesSent.length} mẫu (${codesSent.join(",")}).`);
  return codesSent.length;
}

// Khách MUA HỘ / mua tặng người khác (size nói ra là của người nhận, KHÔNG phải của khách).
// KHÔNG bắt "mua cho" trống (dễ là "mua cho mình/em" = chính khách).
function isGiftContext(text) {
  return /tặng|mua\s*(hộ|ho|giùm|dùm|giúp|giup)|em gái|chị gái|em trai|anh trai|cho con|cho cháu|cho mẹ|cho bố|cho ba\b|cho bà|cho ông|cho dì|cho cô|cho chú|cho chồng|cho vợ|cho bé|cho bạn|người yêu|bạn em|bạn mình|ng[ưu]ời nhà/i.test(String(text || ""));
}

function updateMemoryFromText(mem, text = "") {
  const t = String(text || "");
  // CHỈ ghi nhận size khi khách NÓI RÕ (có ngữ cảnh size, hoặc cả tin là 1 size).
  // KHÔNG dùng \b kiểu cũ -> nó bắt nhầm chữ đầu từ tiếng Việt (Mình/Mẫu/Màu...) thành size.
  const statedSize = extractStatedSize(t);
  // Khách cung cấp SỐ ĐO 3 VÒNG -> nhớ để tư vấn size theo bảng (kể cả khi hỏi ở lượt sau).
  const m3v = parse3V(t);
  if (m3v) {
    mem.measure3V = m3v;                              // dùng để tư vấn size (kể cả khi mua hộ)
    if (isGiftContext(t)) { mem.isGift = true; }       // MUA HỘ -> số đo của người được mua, KHÔNG phải lịch sử khách
    else { mem.sizeFromCustomer = true; }
  }
  // ĐIỀU 8: khách khai 2+ SIZE KHÁC NHAU TRONG CÙNG 1 TIN ("lúc c mặc S lúc c mặc M") = LĂN TĂN
  // -> KHÔNG chốt theo size nào, để nhánh tư vấn quyết theo BẢNG SIZE CHUẨN.
  // (1 size duy nhất khác size cũ = khách ĐỔI Ý -> vẫn theo khách, KHÔNG coi là lăn tăn.)
  const _statedAll = [...new Set([...extractAllStatedSizes(t), ...detectsWaveringSizes(t)].filter(s => s !== "FREESIZE"))];
  if (!isGiftContext(t) && _statedAll.length >= 2) {
    mem.sizeWavering = true;
    mem.waverSizes = _statedAll;
    // KHÔNG ghi đè customerSize bằng 1 trong các size đang phân vân.
  } else if (statedSize) {
    mem.sizeWavering = false;   // tin này nói rõ 1 size -> hết lăn tăn
    if (isGiftContext(t)) {
      // Khách MUA HỘ người khác -> size này là của NGƯỜI ĐƯỢC MUA HỘ, KHÔNG phải size của khách.
      mem.giftSize = statedSize;
      mem.isGift = true;
    } else if (statedSize !== "FREESIZE") {
      // FREESIZE là thuộc tính MẪU, KHÔNG phải size người -> không lưu làm size khách
      mem.customerSize = statedSize;
      mem.sizeFromCustomer = true;   // size do CHÍNH KHÁCH gõ ra -> mới được coi là "lịch sử khách"
    }
  }
  // Bắt cụm SỐ ĐIỆN THOẠI (bắt đầu 0 hoặc +84/84). Cho 6-11 số sau prefix để PHÁT HIỆN cả số SAI độ dài (thiếu/dư).
  // [FIX Nguyen Ngoan] Khách gửi "160 88-70-89" = cao 160 + số đo 3 vòng 88-70-89. Regex sđt tóm nhầm "0 88-70-89"
  //   (số 0 cuối của 160 + 88-70-89) -> 7 số -> báo "sđt 7 số". -> GỠ cụm số đo 3 vòng (a-b-c) khỏi text TRƯỚC khi bắt sđt.
  let _tForPhone = t;
  const _v3 = parse3V(t);
  if (_v3) {
    // gỡ ĐÚNG cụm "a?b?c" (vd 88-70-89) khỏi text để regex sđt không tóm nhầm.
    const _v3re = new RegExp(`${_v3[0]}\\s*[-–—/.\\s]\\s*${_v3[1]}\\s*[-–—/.\\s]\\s*${_v3[2]}`);
    _tForPhone = t.replace(_v3re, " ");
  }
  // [AI ƯU TIÊN] AI bóc sđt (hiểu câu ghép "0877846686 22 Võ Nguyên" -> 0877846686). Nếu AI cho 10 số hợp lệ -> DÙNG luôn.
  //   [FIX] regex cũ cho \s (kể cả XUỐNG DÒNG) chen giữa các số -> nuốt SỐ NHÀ dòng dưới vào sđt ("0877846686\n22" -> 12 số).
  //   Sửa: (1) KHÔNG cho xuống dòng/tab chen (chỉ space/./-), (2) nếu vẫn dính đuôi -> cắt lấy 10 số ĐẦU nếu là DĐ hợp lệ (0[3/5/7/8/9]...).
  let restAfterPhone = t;
  let phoneFound = false;   // [FIX scope] lượt này có bắt được SĐT không (cả nhánh AI lẫn regex) -> dùng ở đoạn ghép địa chỉ bên dưới
  if (mem._aiPhone && /^0\d{9}$/.test(mem._aiPhone)) {
    mem.phone = mem._aiPhone; mem.phoneInvalid = null; mem._reaskedPhone = false;   // tin AI bóc (đã kiểm 10 số)
    restAfterPhone = t.replace(new RegExp(mem._aiPhone.split("").join("[\\s.\\-]?")), " ").trim();
    phoneFound = true;
  } else {
    const phoneMatch = _tForPhone.match(/(?:\+?84|0)(?:[ .\-]?\d){6,11}(?![\d])/);
    if (phoneMatch) {
      phoneFound = true;
      restAfterPhone = t.replace(phoneMatch[0], " ").trim();
      let d = phoneMatch[0].replace(/[^\d]/g, "");
      if (d.startsWith("840") && d.length === 12) d = d.slice(2);            // 840xxxxxxxxx -> 0xxxxxxxxx
      else if (d.startsWith("84") && d.length === 11) d = "0" + d.slice(2);  // 84xxxxxxxxx  -> 0xxxxxxxxx
      if (d.length > 10 && /^0(3|5|7|8|9)\d{8}/.test(d)) d = d.slice(0, 10);  // dính số nhà phía sau -> lấy 10 số ĐẦU (DĐ hợp lệ)
      if (d.length === 10 && d.startsWith("0")) {
        mem.phone = d; mem.phoneInvalid = null; mem._reaskedPhone = false;  // SĐT CHUẨN đúng 10 số
      } else {
        mem.phoneInvalid = d.length;                                        // SAI độ dài (9/11...) -> KHÔNG lưu, đánh dấu để HỎI LẠI
      }
    } else {
      mem.phoneInvalid = null;   // lượt này không có SĐT -> xoá cờ cũ (tránh hỏi lại nhầm)
    }
  }
  // Lưu tỉnh giao hàng khách nhắc (để biết khi đơn này giao TỈNH KHÁC địa chỉ cũ).
  const sp = shipContextProvince(t);
  if (sp) mem.shipProvince = sp;
  // Ghi nhận địa chỉ khách: KHÔNG phải câu hỏi, KHÔNG phải hỏi địa chỉ shop.
  const isAddrQuestion = asksWhatOldAddress(t) || /địa chỉ.*(nào|gì|đâu|là gì|ở đâu)/i.test(t) || /\?\s*$/.test(t.trim());
  const shopWords = /bên em|shop|cửa hàng|showroom|cơ sở/i.test(t);
  const hasStreetKw = /(số nhà|ngõ|ngách|hẻm|đường|phố |phường|xã |quận|huyện|thôn|ấp |tổ \d|khu |chung cư|tòa |kcn|thị trấn|thị xã|kiệt)/i.test(t);
  const hasHouseNum = /\d{1,4}/.test(restAfterPhone);
  // Tỉnh/thành VIẾT TẮT hay gặp ở cuối địa chỉ ("458 Minh Khai Hn", "12 Lê Lợi HCM")
  const cityAbbr = /(^|\s)(hn|h\.n|hcm|tp\.?\s*hcm|tphcm|sg|sài gòn|sai gon|hp|đn|đà nẵng|da nang)(\s|$|\.|,)/i.test(t);
  const prov = mentionedShipProvince(t);
  mem._addrJustGiven = false;   // mặc định: tin này KHÔNG phải đang cho địa chỉ
  if (!isAddrQuestion && !shopWords) {
    const restLooksAddr = /\d/.test(restAfterPhone) || !!mentionedShipProvince(restAfterPhone) || hasStreetKw;
    // ĐỊA CHỈ "LỎNG": bắt đầu BẰNG số nhà (21A, 105, 12B) + có >=3 từ + KHÔNG phải câu số lượng/cân nặng/giá.
    // -> bắt được "21A Lê Thị Kinh Nhà Bè" (không có chữ "đường/phố"); tránh "2 mẫu này", "3 cái màu hồng", "45kg cao 1m6".
    const _ra = restAfterPhone.trim();
    const _startsHouseNum = /^\d{1,4}[a-zA-Z]?\s+\p{L}/u.test(_ra) || /^\d{1,4}\s*[a-zA-Z]?\s*[,./-]/.test(_ra);
    const _wc = _ra.split(/\s+/).filter(Boolean).length;
    const _badAddr = /(mẫu|mau|cái|cai|bộ|chiếc|chiec|màu|size|sz|kg|kí|ký|\bk\b|đồng|nghìn|ngàn|ngày|tuổi|tuoi|\bcm\b|\d\s*m\d|mét|met|cao|nặng|nang)/i.test(_ra);
    const _looksLooseAddr = _startsHouseNum && _wc >= 3 && !_badAddr;
    if (phoneFound && restAfterPhone.replace(/[^\p{L}]/gu, "").length >= 3 && restLooksAddr) {
      // Khách gửi SĐT KÈM địa chỉ -> phần còn lại (bỏ số đt) chính là địa chỉ.
      mem.address = _mergeIfPartial(mem.address, cleanAddress(restAfterPhone)); mem._addrJustGiven = true; mem._reaskedAddr = false;
    } else if ((hasStreetKw || (prov && hasHouseNum) || (cityAbbr && hasHouseNum) || _looksLooseAddr) && t.length >= 6) {
      // Địa chỉ gửi riêng (không kèm SĐT) nhưng có dấu hiệu rõ (số nhà + tỉnh/viết tắt, từ khoá đường/phường, hoặc dạng "lỏng" số nhà + tên đường).
      mem.address = _mergeIfPartial(mem.address, cleanAddress(t.trim())); mem._addrJustGiven = true; mem._reaskedAddr = false;
    }
  }
}
function updateMemoryFromBatch(mem, batch) {
  const text = batch.filter(x => x.type === "text").map(x => x.text || "").join(" ");
  updateMemoryFromText(mem, text);
  // Bóc NGƯỜI ĐƯỢC TẶNG (mua cho ai) -> dùng đúng quan hệ khi xin cao/nặng (KHÔNG nói "của người mặc").
  const _gr = giftRecipient(text);
  if (_gr) mem._giftFor = _gr;
}
// Khách mua TẶNG ai -> trả về quan hệ (em gái/chị gái/bạn/mẹ/con/cháu/vợ/người yêu...), null nếu mua cho mình.
function giftRecipient(text) {
  const t = String(text || "").toLowerCase();
  const m = t.match(/(?:tặng|tang|biếu|bieu|mua cho|mua tang|mua tặng|cho)\s+(em gái|e gái|e gai|em gai|chị gái|chi gai|chị|chi|bạn gái|ban gai|bạn|ban|mẹ|me\b|má|ma\b|con gái|con gai|con|cháu|chau|vợ|vo\b|người yêu|nguoi yeu|bà|dì|di\b|cô|co\b|chồng|chong|em\b)/);
  if (!m) return null;
  let r = m[1].trim();
  if (/^(mình|minh|tôi|toi|t|c|chị|chi|em)$/.test(r)) return null;   // "cho chị/mình/em" = mua cho bản thân -> không phải tặng
  const map = { "e gái": "em gái", "e gai": "em gái", "em gai": "em gái", "chi gai": "chị gái", "ban gai": "bạn gái", "ban": "bạn", "me": "mẹ", "ma": "má", "con gai": "con gái", "chau": "cháu", "vo": "vợ", "nguoi yeu": "người yêu", "di": "dì", "co": "cô", "chong": "chồng" };
  return map[r] || r;
}

const processedMessageIds = loadProcessed();
const processingMessageIds = new Set();
let isRunning = false;

// Mốc thời gian tin KHÁCH mới nhất theo hội thoại (cập nhật mỗi vòng poll). Dùng để: đang GỬI ẢNH lẻ
// (mất vài giây) mà khách CHEN tin mới -> NGỪNG gửi ảnh còn lại, nhường vòng sau trả lời (chống ảnh đè câu hỏi).
const lastCustomerMsgAt = new Map();
function noteCustomerMsgAt(convId, ts) {
  if (!convId || !ts) return;
  const prev = lastCustomerMsgAt.get(convId) || 0;
  if (ts > prev) lastCustomerMsgAt.set(convId, ts);
}

// SHOP/Botcake đã trả lời THẬT (text có nội dung / ảnh) SAU tin khách cuối? -> đã xử rồi, đừng báo lại.
// Dùng chung cho cả luồng ADS và luồng thường (chống bot báo lại tin Botcake đã trả).
// Câu CHÀO TỰ ĐỘNG (Botcake/hệ thống) — KHÔNG phải shop/người thật trả lời nội dung.
// vd "Mys.P chào Chị ...👋 Shop đã nhận được tin nhắn và sẽ phản hồi ... cứ nhắn giúp shop nha".
function isAutoGreeting(text) {
  const t = String(text || "");
  return /shop đã nhận được tin nhắn|cứ nhắn (giúp |cho )?shop|sẽ phản hồi (chị|anh|bạn|mình|quý khách)[^\n]{0,15}(sớm|ngay)/i.test(t);
}
function shopRepliedAfterLastCustomer(messages) {
  const cust = (messages || []).filter(m => m && m.sender === "customer" && m.channel !== "COMMENT");
  if (!cust.length) return false;
  const lastCustAt = Math.max(...cust.map(m => new Date(m.insertedAt).getTime() || 0));
  return (messages || []).some(m => {
    if (!m || m.sender !== "shop") return false;
    if ((new Date(m.insertedAt).getTime() || 0) <= lastCustAt + 1000) return false;   // phải SAU tin khách
    if (m.type === "image") return true;                                              // shop gửi ảnh = đã trả lời
    if (m.type === "text" && m.text && m.text.trim()
        && !/đã trả lời một quảng cáo/i.test(m.text)
        && !isAutoGreeting(m.text)) return true;                                       // text THẬT (bỏ dòng hệ thống + câu chào tự động)
    return false;
  });
}
// Shop/bot ĐÃ báo giá (mẫu nào đó) trong LỊCH SỬ hội thoại chưa? Đọc TỪ messages (sender="shop") nên SỐNG QUA
// RESTART (mem mất vẫn biết). Câu báo giá có chữ "giá" + con số tiền (vd "Dạ Váy Giannal giá 890.000đ ạ").
// Dùng để cổng ADS biết "đã báo rồi" -> KHÔNG báo lại khi khách hỏi tiếp (size/số đo/chất...).
function botQuotedPriceInHistory(messages) {
  return (Array.isArray(messages) ? messages : []).some(m => {
    if (!m || m.sender !== "shop" || m.type !== "text" || !m.text) return false;
    const t = String(m.text).toLowerCase();
    if (isAutoGreeting(t)) return false;
    const hasMoney = /\d{1,3}[.,]\d{3}/.test(t);                   // 890.000 / 1.450.000 / 2.640.000
    const saysGia  = /gi[áa]/.test(t) || /\d[.,]\d{3}\s*đ/.test(t); // "giá ..." hoặc "...000đ"
    return hasMoney && saysGia;
  });
}
function botSentImagesInHistory(messages) {
  // SHOP/bot đã gửi ÍT NHẤT 1 ẢNH trong hội thoại? (đọc từ lịch sử -> sống sót qua RESTART)
  return (Array.isArray(messages) ? messages : []).some(m => m && m.sender === "shop" && m.type === "image");
}
// SHOP đã XÁC NHẬN / NHẮC tới ĐƠN ĐÃ ĐẶT của khách trong lịch sử (đơn đang xử/đang giao) -> đây là thread HẬU MÃI,
// TUYỆT ĐỐI KHÔNG báo giá mẫu mới đè lên (kể cả khách bấm "Bắt đầu"/gửi ảnh khác). Sống sót qua restart (đọc lịch sử).
// (lỗi Huệ Nhi: đã đặt váy hồng sz S + hỏi "đã ship chưa", bot lại báo giá Celyne mẫu mới.)
function shopConfirmedOrderInHistory(messages) {
  return (Array.isArray(messages) ? messages : []).some(m => {
    if (!m || m.sender !== "shop" || m.type !== "text" || !m.text) return false;
    const t = String(m.text).toLowerCase();
    return /đơn (chị|c|em|của (chị|c|mình)) (đặt|đã đặt)|đơn (đặt|đã đặt) (hôm|ngày)|chị đặt (hôm|ngày)|đơn (ngày|hôm) (kia|qua|nay|trước)|bên em sẽ gửi (đi )?(rồi|nha|ạ)|sẽ gửi đi (rồi|nha|ạ)|đang (hoàn thiện|bổ xung|bổ sung|đóng (gói|hàng))|chờ (nhận|ngày) (hàng|nhận|nha)|sẽ nhận được|đơn của (chị|mình) (đang|đã)|cảm ơn (chị|c|mình) đã đặt/i.test(t);
  });
}
function getLastCustomerMessages(messages) {
  const inbox = (Array.isArray(messages) ? messages : [])
    .filter(m => m && m.channel !== "COMMENT")   // CHỈ INBOX, bỏ comment
    .sort((a, b) => parseTime(a.insertedAt) - parseTime(b.insertedAt));
  // LƯỢT KHÁCH HIỆN TẠI = MỌI tin khách kể từ tin SHOP/bot GẦN NHẤT (KHÔNG cắt theo thời gian).
  // -> khách gửi album ảnh rồi vài chục giây/phút sau mới gõ chữ ("Mấy cái này"/"Nặng...") vẫn nằm
  //    CÙNG 1 lượt -> không rơi ảnh. Ảnh ĐÃ được bot trả lời rồi -> nằm TRƯỚC tin bot -> tự loại, không báo trùng.
  let lastShopIdx = -1;
  for (let i = inbox.length - 1; i >= 0; i--) {
    if (inbox[i].sender === "shop") { lastShopIdx = i; break; }
  }
  const turn = inbox.slice(lastShopIdx + 1).filter(m => m.sender === "customer");
  if (turn.length) return turn;
  // Fallback: shop/bot nhắn cuối (chưa có tin khách mới sau đó) -> cụm khách cuối trong 15s (giữ hành vi cũ).
  const cust = inbox.filter(m => m.sender === "customer");
  if (!cust.length) return [];
  const lastTime = parseTime(cust[cust.length - 1].insertedAt);
  return cust.filter(m => Math.abs(parseTime(m.insertedAt) - lastTime) <= 15000);
}
// Inbox đã mở chưa (có tin INBOX nào chưa) - để biết có gửi DM được không
function hasInboxMessage(messages) {
  return (messages || []).some(m => m.channel === "INBOX");
}
// Một tin INBOX phía shop có phải NGƯỜI THẬT không?
// = phía shop + kênh INBOX + KHÔNG do bot gửi (id không nằm trong botSentIds)
//   + adminName KHÔNG phải "Public API"(bot) / "Botcake".  (adminName rỗng vẫn tính người thật.)
function isHumanInboxMsg(m) {
  if (!m || m.sender !== "shop" || m.channel !== "INBOX") return false;
  if (m.messageId && botSentIds.has(String(m.messageId))) return false;  // chính bot gửi
  const a = (m.adminName || "").trim();
  if (!a) return false;                            // admin RỖNG = tin tự động/hệ thống (vd "Xin chào, cảm ơn..."), KHÔNG phải người thật
  if (a === "Public API" || a === "Botcake") return false;              // bot / Botcake
  return true;                                     // CÓ TÊN nhân viên = người thật
}
function humanTookOverInbox(messages) {
  return (messages || []).some(isHumanInboxMsg);
}
// Người thật đã trả lời ở kênh COMMENT chưa? (sinh đôi của humanTookOverInbox cho kênh COMMENT)
// = phía shop + kênh COMMENT + KHÔNG do bot gửi (id không trong botSentIds) + adminName CÓ tên NV thật
//   (không rỗng, không "Public API"/"Botcake"). Dùng để: comment đã có người thật xử -> bot IM, không chen.
function humanTookOverComment(messages) {
  return (messages || []).some(m => {
    if (!m || m.sender !== "shop" || m.channel !== "COMMENT") return false;
    if (m.messageId && botSentIds.has(String(m.messageId))) return false;   // chính bot gửi
    const a = (m.adminName || "").trim();
    if (!a) return false;                                                   // rỗng = hệ thống/không rõ -> KHÔNG coi là người thật
    if (a === "Public API" || a === "Botcake") return false;               // bot / Botcake
    return true;                                                            // CÓ tên NV = người thật đã trả lời comment
  });
}

// Mốc thời gian tin NGƯỜI THẬT cuối cùng (0 nếu không có).
const HUMAN_PAUSE_MS = 5 * 60 * 1000;  // chờ tối thiểu 5 phút sau tin cuối của người thật
const BOT_HANDOFF_QUIET_MS = 5 * 60 * 1000; // sau khi BOT bàn giao người thật -> im 5 phút (trừ khi NV vào)
const DEBOUNCE_MS = 2500;              // đợi khách ngừng gõ ~2.5s mới trả lời (vẫn gộp tin, nhưng rep nhanh hơn nhiều)

// Đọc thời gian AN TOÀN: Pancake dùng UTC. Nếu chuỗi THIẾU múi giờ (không Z, không +hh:mm)
// thì coi là UTC (thêm "Z") để khỏi bị hiểu nhầm thành giờ máy -> lệch nhiều tiếng.
function parseTime(s) {
  if (s == null) return 0;
  if (typeof s === "number") return s < 1e12 ? s * 1000 : s;  // giây -> ms
  let str = String(s).trim();
  const hasTz = /[zZ]$/.test(str) || /[+-]\d{2}:?\d{2}$/.test(str);
  if (!hasTz && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(str)) {
    str = str.replace(" ", "T") + "Z";
  }
  const t = new Date(str).getTime();
  return Number.isFinite(t) ? t : 0;
}
function humanLastInboxAt(messages) {
  let last = 0;
  for (const m of messages || []) {
    if (isHumanInboxMsg(m)) {
      const t = parseTime(m.insertedAt);
      if (t > last) last = t;
    }
  }
  return last;
}
function hasProcessed(messages) {
  return messages.some(m => processedMessageIds.has(m.messageId) || processingMessageIds.has(m.messageId));
}
function markProcessing(messages) { for (const m of messages) processingMessageIds.add(m.messageId); }
function markProcessed(messages) {
  for (const m of messages) { addProcessed(processedMessageIds, m.messageId); processingMessageIds.delete(m.messageId); }
}
function clearProcessing(messages) { for (const m of messages) processingMessageIds.delete(m.messageId); }

// Hạn chế log lặp (vd "bot IM" mỗi 5s): chỉ cho in lại sau 60s cho mỗi key.
const _logThrottleAt = new Map();
function logThrottle(key, everyMs = 60000) {
  const now = Date.now();
  const last = _logThrottleAt.get(key) || 0;
  if (now - last < everyMs) return false;
  _logThrottleAt.set(key, now);
  return true;
}

function buildConversationForAi(messages) {
  return messages.slice(-20).map(m => ({
    sender: m.sender, type: m.type, text: m.text,
    imageUrl: m.type === "image" ? m.imageUrl : null
  }));
}

function isTransientFail(r) {
  const reason = String(r?.vision?.reason || r?.reason || "");
  if (/NOT_FOUND_IN_SHEET|LOW_CONFIDENCE|NO_MATCH/i.test(reason)) return false;
  // KHÔNG thử lại khi TIMEOUT (chậm thì đừng làm chậm gấp đôi). Chỉ thử lại khi worker chưa sẵn sàng / tải lỗi.
  return /DOWNLOAD|WORKER_DOWN|WORKER_NOT_READY|NETWORK|WRITE|EMPTY/i.test(reason);
}
async function resolveImageRetry(url, tries = 2) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    const r = await resolveImage(url);
    if (r?.ok) return r;
    last = r;
    if (!isTransientFail(r)) return r;   // điểm thấp/không thấy mã -> thôi, không thử lại
    await sleep(300);
  }
  return last;
}
// ===== OCR: đọc CHỮ trong ảnh (fallback khi CLIP trượt) — đọc tên SP in trên ảnh chụp màn hình post =====
// CẦN cài 1 lần để bật:  npm install tesseract.js   (chưa cài thì bot tự bỏ qua, không lỗi).
let _ocrLib;   // undefined=chưa thử, null=không có, object=đã nạp
function _getOcrLib() {
  if (_ocrLib !== undefined) return _ocrLib;
  try {
    _ocrLib = require("tesseract.js");
    console.log("[OCR] đã bật tesseract.js (đọc tên SP trong ảnh chụp màn hình).");
  } catch (_) {
    _ocrLib = null;
    console.log("[OCR] CHƯA cài tesseract.js -> bỏ qua OCR. Bật bằng: npm install tesseract.js");
  }
  return _ocrLib;
}
async function ocrImageText(url) {
  const lib = _getOcrLib();
  if (!lib || !url) return "";
  try {
    const p = lib.recognize(url, "vie+eng");
    const timeout = new Promise(res => setTimeout(() => res(null), 20000));   // chặn treo lượt
    const r = await Promise.race([p, timeout]);
    return r ? String((r.data && r.data.text) || "").trim() : "";
  } catch (e) {
    console.log("[OCR] lỗi đọc ảnh:", (e && e.message) || e);
    return "";
  }
}

async function getProductsFromImages(batch) {
  const imgs = batch.filter(x => x.type === "image" && x.imageUrl);
  const products = [];
  const colorByCode = {};
  const matchedImgByCode = {};
  for (const img of imgs) {
    const r = await resolveImageRetry(img.imageUrl, 3);
    // LOG ĐIỂM TIN CẬY: để soi ảnh CÓ trong hệ thống (điểm cao) vs ảnh CHƯA có (điểm thấp/gap nhỏ) -> chỉnh ngưỡng.
    const _top = (r && r.top || []).slice(0, 3).map(t => `${t.code}:${t.score}`).join(" ");
    console.log("VISION:", JSON.stringify(r?.ok
      ? { ok: true, code: r.code, color: r.color || "", score: r.score, gap: r.gap }
      : { ok: false, reason: r?.reason || r?.vision?.reason, score: r?.score, gap: r?.gap }) + (_top ? ` | top: ${_top}` : ""));
    if (r?.ok && r?.product) {
      products.push(r.product);
      const C = String(r.product.code || "").toUpperCase();
      if (r.color) colorByCode[C] = r.color;   // MÀU đọc từ tên file ảnh khớp
      if (r.imageId) matchedImgByCode[C] = r.imageId;   // tấm ảnh KHỚP nhất -> gửi lại chắc đúng mẫu+màu
    }
  }
  Object.defineProperty(products, "_colorByCode", { value: colorByCode, enumerable: false });
  Object.defineProperty(products, "_matchedImgByCode", { value: matchedImgByCode, enumerable: false });
  return products;
}

function dedupByCode(arr) {
  const seen = new Set();
  const out = [];
  for (const p of arr) {
    const k = String(p.code || "").toUpperCase();
    if (k && !seen.has(k)) { seen.add(k); out.push(p); }
  }
  return out;
}

// ===== KHÓA MẪU (FOCUS LOCK) — chống tư vấn nhảy mã loạn xạ =====
// Triết lý: TIN TƯỞNG vision 100% (ảnh ra mã nào -> theo mã đó). Chỉ vá 2 lỗ LOGIC:
//   (1) findInText khớp nhầm 1 từ thường trong câu khách -> không cho nhảy mã vô cớ.
//   (2) Mỗi lượt ghi đè/trộn quotedProducts -> giữ list bám đúng 1 mẫu đang tư vấn.
function _codeUp(p) { return String((p && p.code) || "").toUpperCase(); }

// Khách có ĐANG CHỦ ĐỘNG nhắc tới 1 mẫu bằng chữ không (để loại findInText khớp nhầm từ thường).
function _textRefersModel(text) {
  const t = String(text || "");
  if (/\b[A-Z]{2,}[A-Z0-9]*\d{3,}\b/.test(t.toUpperCase())) return true;            // có MÃ rõ ràng
  if (/(mẫu|mã|con|cái|bộ|set|váy|áo|đầm|chân váy|quần|jum|jump)\b/i.test(t)) return true; // có từ chỉ mẫu
  return false;
}

// Tên mẫu (textTop) có thực sự XUẤT HIỆN trong câu khách không (vd "Mona chất gì" -> gọi đích danh Mona).
function _textNamesProduct(text, product) {
  if (!product || !product.name) return false;
  const t = String(text || "").toLowerCase();
  const generic = new Set(["váy", "áo", "set", "đầm", "quần", "chân", "jum", "jump", "dress", "bộ", "sét"]);
  const toks = (String(product.name).toLowerCase().match(/[\p{L}]{4,}/gu) || []).filter(tok => !generic.has(tok));
  return toks.some(tok => t.includes(tok));
}

// Loại sản phẩm: VAY (váy/đầm/chân váy) | AO (áo) | SET | "" (không rõ). Dựa cột category, fallback tên.
function _kindOf(product) {
  const s = (String(product && product.category || "") + " " + String(product && product.name || "")).toLowerCase();
  if (/(chân váy|chan vay)/.test(s)) return "CHANVAY";
  if (/(váy|vay|đầm|dam|dress)/.test(s)) return "VAY";
  if (/(^|\s)(áo|ao)(\s|$)|blouse|shirt/.test(s)) return "AO";
  if (/(set|sét|bộ|bo)/.test(s)) return "SET";
  return "";
}
// Loại mà khách nhắc trong câu ("váy còn màu" -> VAY, "áo còn size" -> AO). "" nếu không nhắc loại nào.
function _kindInText(text) {
  const t = String(text || "").toLowerCase();
  if (/(chân váy|chan vay)/.test(t)) return "CHANVAY";
  if (/(váy|vay|đầm|dam)/.test(t)) return "VAY";
  if (/(^|\s)(áo|ao)(\s|$|\b)/.test(t)) return "AO";
  if (/(set|sét|bộ\b|bo\b)/.test(t)) return "SET";
  return "";
}
// Khách hỏi "váy/áo còn màu/size nào" khi ĐÃ báo giá NHIỀU mẫu khác loại -> chọn mẫu ĐÚNG LOẠI khách nhắc.
// Trả mẫu khớp loại | null. (Lỗi Huyen Bui: báo giá 1 áo + 1 váy, khách hỏi "váy còn màu" -> phải ra VÁY.)
function pickQuotedByKind(mem, text) {
  const kind = _kindInText(text);
  if (!kind) return null;
  const list = (mem && mem.quotedProducts) || [];
  if (list.length < 2) return null;                       // chỉ cần phân biệt khi có >=2 mẫu
  const match = list.filter(p => _kindOf(p) === kind);
  return match.length === 1 ? match[0] : null;            // đúng 1 mẫu cùng loại -> chắc chắn; nhiều/không -> để logic cũ
}

// Quyết định MẪU FOCUS cho lượt này. Trả về { product, switched, reason }.
//  - switched=true : đổi mẫu thật -> ghi đè mẫu khóa.
//  - switched=false: GIỮ mẫu đang khóa (chống trôi).
function decideFocus(mem, { fromImages, fromText, latestText }) {
  const lock = mem.currentProduct || null;
  const lockCode = _codeUp(lock);

  const imgTop = (fromImages && fromImages[0]) || null;   // vision: TIN TƯỞNG, không can thiệp
  const textTop = (fromText && fromText[0]) || null;

  // ƯU TIÊN: khách nhắc LOẠI (váy/áo) + đã báo giá nhiều mẫu khác loại -> bám đúng mẫu CÙNG LOẠI.
  // Chỉ khi KHÔNG gửi ảnh lượt này (hỏi bằng chữ). Khách KHÔNG gọi đích danh tên mẫu khác.
  if (!imgTop) {
    const byKind = pickQuotedByKind(mem, latestText);
    if (byKind && !(textTop && _textNamesProduct(latestText, textTop) && _codeUp(textTop) !== _codeUp(byKind))) {
      return { product: byKind, switched: _codeUp(byKind) !== lockCode, reason: "quoted_by_kind" };
    }
  }

  // 1) ẢNH có mã -> theo vision (đổi nếu khác mẫu đang khóa).
  if (imgTop) {
    // NHƯNG nếu khách đang TRẢ LỜI cân nặng/size/số đo cho mẫu ĐANG KHÓA, thì ảnh (hay bám lại từ bài/ảnh cũ,
    // dễ nhận NHẦM sang mẫu khác) KHÔNG được phép đổi mẫu -> GIỮ khóa, tránh "tự lòi ra mẫu lạ".
    const _bodyInfoTurn = !!(parseWeightKg(latestText) || parse3V(latestText) || extractStatedSize(latestText));
    // NGOẠI LỆ: khách đang GỬI ẢNH mẫu + có Ý CHỐT/LẤY mẫu đó ("lấy c size L", "mua bộ này", "chốt con này",
    //  "lên đơn", "order")  -> đây là CHỐT MẪU TRONG ẢNH khách vừa gửi, KHÔNG phải bổ sung số đo cho mẫu cũ.
    //  -> PHẢI đổi sang mẫu ảnh (tránh trả size/giá của mẫu khoá cũ -> SAI mẫu). Bare số đo ("59kg","size L") vẫn giữ khoá.
    const _picksThisFromImage =
      /(mẫu|mau|con|cái|cai|bộ|bo|sét|set|váy|vay|đầm|dam|áo|ao|quần|quan)\s*(này|nay)\b/i.test(String(latestText || ""))
      || /(^|[\s,.])(lấy|lay|mua|chốt|chot|order|đặt|dat)([\s,.]|$)|lên\s*đơn|len\s*don/i.test(String(latestText || ""));
    if (lockCode && _bodyInfoTurn && _codeUp(imgTop) !== lockCode && !_picksThisFromImage) {
      return { product: lock, switched: false, reason: "keep_lock_bodyinfo" };
    }
    // Khách GÕ ĐÍCH DANH tên 1 mẫu KHÁC với mẫu vision đọc từ ảnh -> TIN tên khách gõ (ảnh ads/ghép hay đọc SAI;
    // lỗi: ad CORINE, khách gõ "Corine" mà vision đọc ảnh ra Talia -> báo nhầm).
    if (textTop && _codeUp(textTop) !== _codeUp(imgTop) && _textNamesProduct(latestText, textTop)) {
      return { product: textTop, switched: _codeUp(textTop) !== lockCode, reason: "text_named_over_vision" };
    }
    if (!lockCode || _codeUp(imgTop) !== lockCode)
      return { product: imgTop, switched: true, reason: "image" };
    return { product: lock, switched: false, reason: "image_confirm" };
  }

  // 2) CHỮ khớp ra mã: đổi khi khách THỰC SỰ nhắc mẫu (có mã / từ chỉ mẫu / GỌI ĐÍCH DANH TÊN MẪU),
  //    tránh findInText bắt nhầm 1 từ thường rồi nhảy sang mẫu khác.
  if (textTop) {
    if (!lockCode) return { product: textTop, switched: true, reason: "text_first" };
    if (_codeUp(textTop) === lockCode) return { product: lock, switched: false, reason: "text_confirm" };
    // CHỈ đổi khi khách GỌI ĐÍCH DANH tên mẫu khác (vd "Plora chất gì").
    // "váy còn màu nào / áo còn size nào" = từ LOẠI chung -> đang khoá 1 mẫu thì hỏi CHÍNH mẫu đó,
    // KHÔNG switch sang mẫu đọc-từ-caption (lỗi Huyen Bui: khoá Giannal-váy, hỏi "váy còn màu" -> nhảy Plora-áo).
    if (_textNamesProduct(latestText, textTop))
      return { product: textTop, switched: true, reason: "text_named" };
    // Có MÃ rõ ràng (vd "MR0AH6115") cũng cho đổi.
    if (/\b[A-Z]{2,}[A-Z0-9]*\d{3,}\b/.test(String(latestText || "").toUpperCase()))
      return { product: textTop, switched: true, reason: "text_code" };
    return { product: lock, switched: false, reason: "text_falsematch_keep" };   // khớp nhầm / từ loại chung -> GIỮ mẫu
  }

  // 3) Không detect gì -> giữ mẫu khóa.
  return { product: lock, switched: false, reason: "no_detect" };
}


// "ship" trong NGỮ CẢNH ĐẶT HÀNG (ship cho c / ship 2 mẫu / ship cả / ship mẫu này...)
// PHÂN BIỆT với câu HỎI ship (ship bao nhiêu / ship mất mấy ngày / ship free) -> KHÔNG tính đặt.
function isShipOrder(text) {
  const t = String(text || "");
  if (/ship\s*(bao nhiêu|bn|mất|free|miễn phí|ph[íi]|tiền|giá|mấy (ngày|tiền)|lâu|thế nào|sao)/i.test(t)) return false;
  return /\bship\s*(cho|c\b|cả|hết|luôn|về|đơn|này|đó|nhé|nha|\d|hai|ba|mẫu|đi|em)\b/i.test(t);
}

// Khách có TÍN HIỆU MUA thật không (mới được phép xin SĐT/địa chỉ)
function customerWantsToOrder(text, intent) {
  const t = String(text || "").toLowerCase();
  // Câu HỎI chính sách đổi/trả -> KHÔNG phải muốn chốt (vd "ko ưng đc đổi ko").
  if (asksExchangePolicy(t) || asksReturnPolicy(t)) return false;
  if (["ORDER_INTENT", "PROVIDE_PHONE", "PROVIDE_ADDRESS", "PROVIDE_SIZE"].includes(intent)) return true;
  // "ưng" bị PHỦ ĐỊNH ("ko ưng", "chưa ưng", "chẳng ưng") -> bỏ "ưng" ra, chỉ tính nếu còn từ chốt KHÁC.
  const ungNegated = /(không|ko|hong|hông|k|chưa|chẳng|chả)\s*(thấy\s*)?ưng/i.test(t);
  const orderWords = ungNegated
    ? /(?<![\p{L}\p{N}])(lấy|chốt|mua|đặt|order|lên đơn|ship cho|gửi cho|lấy mẫu|lấy cái|lấy con)(?![\p{L}\p{N}])/iu
    : /(?<![\p{L}\p{N}])(lấy|chốt|mua|đặt|order|lên đơn|ship cho|gửi cho|ưng|lấy mẫu|lấy cái|lấy con)(?![\p{L}\p{N}])/iu;
  // Dùng ranh giới Unicode (?<![\p{L}\p{N}]) ... — KHÔNG dùng \b ASCII (không nhận ranh giới quanh chữ có dấu).
  if (orderWords.test(String(text || ""))) return true;
  return isShipOrder(text);
}

// Tin này khách có ĐƯA SĐT hoặc địa chỉ không
function customerGaveContact(text) {
  const t = String(text || "");
  const phone = /(?:\+?84|0)(?:\d[\s.-]?){8,10}\d/.test(t);
  const addr = /địa chỉ|ngõ|ngách|phường|xã|quận|huyện|tỉnh|thành phố|tp\.|số nhà|chung cư|hà nội|hồ chí minh|hcm/i.test(t) && t.length >= 6;
  return phone || addr;
}

// Một câu có phải là câu XIN SĐT/ĐỊA CHỈ không
const _CONTACT_NOUN = /(số điện thoại|sđt|sdt|địa chỉ|dia chi)/i;
const _CONTACT_ASK  = /(xin|cho em|gửi (em|lại)|để em (lên đơn|chốt|ship|gửi)|nhận hàng)/i;
function _isContactAskSentence(s) {
  return _CONTACT_NOUN.test(s) && _CONTACT_ASK.test(s);
}

// Cắt mệnh đề "xin SĐT/địa chỉ" khỏi câu trả lời (chống xin lặp / xin sớm)
function stripContactRequest(reply) {
  if (!reply) return reply;
  const parts = String(reply).split(/(?<=[.!?])\s+|\n+/);
  const kept = parts.filter(s => !_isContactAskSentence(s));
  return kept.join(" ").replace(/[ \t]{2,}/g, " ").replace(/\s+([.!?])/g, "$1").trim();
}

// Reply (sau xử lý) còn xin liên hệ không -> để nhớ trạng thái "đã xin"
function replyAsksContact(reply) {
  return String(reply || "").split(/(?<=[.!?])\s+|\n+/).some(_isContactAskSentence);
}

// §5 + §8: CẤM câu hỏi chủ động kiểu "chị cần em hỗ trợ/tư vấn gì thêm không?"
function stripProactiveFollowup(reply) {
  if (!reply) return reply;
  const BAD = /(chị|c)?\s*(cần|can)\s*em\s*(hỗ trợ|ho tro|tư vấn|tu van|giúp|giup)\s*(gì|gi)?\s*(thêm|them|nữa|nua)?\s*(không|khong|ko)?\s*(ạ|a|nha|nhé|nhe)?\s*[.!?]?/gi;
  return String(reply)
    .split(/(?<=[.!?])\s+|\n+/)
    .filter(s => !BAD.test(s))
    .join(" ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.!?])/g, "$1")
    .trim();
}

// ===== PHÍ SHIP (theo §14, luật nội bộ - chỉ báo kết quả cho khách) =====
function parseMoney(v) {
  const d = String(v == null ? "" : v).replace(/[^\d]/g, "");
  return d ? parseInt(d, 10) : 0;
}
// Giá hiệu lực của 1 mẫu + mẫu này có đang KM không
function productEffective(p) {
  const km = parseMoney(p.salePrice);
  const goc = parseMoney(p.originalPrice || p.price);
  if (km && goc && km < goc) return { eff: km, km: true };
  return { eff: km || goc || parseMoney(p.price), km: false };
}
// §14: tổng >= 500k -> MIỄN SHIP (kể cả mẫu có ưu đãi); dưới 500k -> +30k.
function computeShip(products) {
  let total = 0;
  for (const p of products || []) {
    const { eff } = productEffective(p);
    total += eff;
  }
  if (total >= 500000) return { free: true, fee: 0 };
  return { free: false, fee: 30000 };
}
function shipReplyText(products) {
  const s = computeShip(products);
  return s.free
    ? "Dạ mẫu này em miễn phí ship cho mình ạ."
    : "Dạ mẫu này phí ship 30.000đ thôi ạ, shop gửi từ kho Bắc Giang nha.";
}

// Khách hỏi PHÍ ship (miễn/bao nhiêu) - KHÁC với hỏi thời gian giao
function isShipFeeQuestion(text) {
  const t = String(text || "");
  if (isDeliveryTimeQuestion(t)) return false;
  return /(phí ship|phi ship|tiền ship|tien ship|free ?ship|freeship|miễn ship|mien ship|miễn phí ship|ship.*(bao nhiêu|nhiêu|hết|ko|không|free|miễn)|có ship|tính ship)/i.test(t);
}
// Khách hỏi ĐƠN VỊ VẬN CHUYỂN / hãng ship nào -> J&T (CHỈ trả lời khi HỎI, không tự đưa ra).
function asksShippingCarrier(text) {
  const t = String(text || "").toLowerCase();
  if (/(đơn vị|hãng|bên)\s*(vận chuyển|ship|giao hàng)/.test(t)) return true;
  if (/(ship|vận chuyển|giao|gửi)\s*(qua |bằng |hãng |đơn vị |bên )?(hãng nào|đơn vị nào|bên nào|hãng gì|nào ạ|nào vậy|gì ạ|gì vậy|qua ai)\b/.test(t)) return true;
  if (/(ship|vận chuyển|giao|gửi)\s*(hãng|bên|đơn vị)\s*(nào|gì)/.test(t)) return true;
  // "bên e GIAO HÀNG bên ĐƠN VỊ NÀO", "giao hàng đơn vị nào" -> cho phép vài chữ ("hàng bên") chen giữa động từ và cụm hỏi hãng.
  if (/(ship|vận chuyển|giao|gửi)\b[^?]{0,18}(hãng nào|đơn vị nào|bên nào|hãng gì|đơn vị gì|bên gì|qua ai|của (hãng|bên|đơn vị) nào)\b/.test(t)) return true;
  if (/(j ?& ?t|jt express|\bghn\b|\bghtk\b|viettel post|vnpost|ninja van|best express|spx|shopee express)/.test(t)) return true;
  return false;
}
// Khách ĐÒI hãng vận chuyển KHÁC J&T, hoặc TỪ CHỐI J&T, hoặc đòi tự chọn hãng -> KHÔNG tự quyết -> NGƯỜI THẬT.
// (Khác với asksShippingCarrier: đây là khách RA YÊU CẦU/đòi đổi, không phải chỉ HỎI hãng nào.)
function demandsOtherCarrier(text) {
  const t = String(text || "").toLowerCase();
  const other = /(vnpost|viettel ?post|\bghn\b|\bghtk\b|ninja ?van|best express|shopee express|\bspx\b|bưu điện|\bgrab\b|ahamove|hãng khác|đơn vị khác|bên (vận chuyển )?khác)/;
  // 1) TỪ CHỐI J&T (phủ định + nhắc J&T gần nhau)
  if (/\b(không|ko|hông|chẳng|chả)\b[^.!?]{0,18}(j ?& ?t|jt)\b/.test(t)) return true;
  if (/(j ?& ?t|jt)\b[^.!?]{0,12}\b(không|ko|hông|chẳng|đâu)\b/.test(t)) return true;
  // 2) ĐÒI/MUỐN gửi hãng KHÁC (không phải J&T)
  if (/(muốn|cho|gửi|gởi|ship|đổi|chuyển|dùng|xài|qua|bằng|sang|chọn)\b/.test(t) && other.test(t)) return true;
  // 3) Tự chọn hãng
  if (/(tự|cho|được)\s*\w*\s*(chọn|chỉ định)\s*\w*\s*(hãng|đơn vị|bên)\s*\w*\s*(ship|vận chuyển|giao)?/.test(t)) return true;
  return false;
}
// Khách hỏi THỜI GIAN giao hàng CHUNG CHUNG -> trả "5-7 ngày"
function isDeliveryTimeQuestion(text) {
  return /(bao lâu|bao lau|mấy ngày|may ngay|mấy hôm|mấy bữa|(khi nào|bao giờ|chừng nào|lúc nào).*(nhận|giao|có hàng|tới|đến|hàng)|nhận.*(hàng).*(khi|bao)|ship mất bao|giao trong|nhận được hàng khi|lâu nhận|ship.*mấy ngày|ship.*bao lâu|thời gian.*(giao|nhận|ship))/i.test(String(text || ""));
}
// Khách CẦN GẤP / ngày-giờ cụ thể / dịp có deadline -> ĐƠN ƯU TIÊN, nhường người thật
function isUrgentSpecificDate(text) {
  const t = String(text || "").toLowerCase();
  // 1) Từ "gấp" mạnh / cần luôn / hỏa tốc / grab giao trong ngày -> chắc chắn gấp
  if (/cần gấp|can gap|cần luôn|can luon|cần ngay|can ngay|lấy ngay|lay ngay|lấy luôn|lay luon|gấp lắm|đang gấp|dang gap|\bgấp\b|\bgap\b|cho kịp|kịp không|kịp ko|gấp gáp|sớm nhất|hỏa tốc|hoa toc|\bgrab\b|giao nhanh|ship nhanh|giao trong ngày|giao liền|giao gấp|ship gấp|nhanh nhất/i.test(t)) return true;
  // 2) Mốc ngày/giờ cụ thể + ngữ cảnh cần nhận hàng
  const hasDate = /(ngày mai|ngay mai|hôm nay|hom nay|tối nay|toi nay|sáng mai|sang mai|chiều mai|trưa mai|\bmai\b|thứ\s*[2-7]|thu\s*[2-7]|\bt[2-7]\b|chủ nhật|chu nhat|\bcn\b|trước ngày|truoc ngay|trước \d|đúng ngày|trong hôm nay|trong ngày|trong ngay|nội trong\s*(\d|ngày|ngay|hôm|hom|tuần|tuan|sáng|sang|trưa|trua|chiều|chieu|tối|toi)|noi trong\s*(\d|ngay|hom|tuan|sang|trua|chieu|toi)|ngày \d{1,2}\b|\d{1,2}\s*h\b|\d{1,2}\s*giờ)/i.test(t);
  const hasNeed = /(cần|can|lấy|lay|nhận|nhan|mặc|mac|đi|dùng|dung|kịp|kip|giao|ship|hàng|hang|tiệc|tiec|việc|viec|đám|dam)/i.test(t);
  if (hasDate && hasNeed) return true;
  // 3) Dịp có deadline (tiệc, cưới, sự kiện...)
  if (/(có tiệc|co tiec|đám cưới|dam cuoi|đám hỏi|dự tiệc|du tiec|đi tiệc|sự kiện|su kien|có việc gấp|đi đám|di dam)/i.test(t)) return true;
  return false;
}
function deliveryTimeReply(mem) {
  // Đơn ĐÃ CHỐT -> chỉ trả thời gian + bảo chờ nhận, KHÔNG mời lên đơn lại.
  if (mem && mem.orderClosed) {
    return "Dạ thời gian giao hàng dự kiến từ 5-7 ngày ạ. Bên em sẽ chuẩn bị đơn hàng cẩn thận trước khi gửi đến mình nha";
  }
  return "Dạ hàng bên em giao khoảng 5-7 ngày ạ. Chị ưng thì em lên đơn mẫu này gửi về cho mình luôn nha ạ";
}
// Chỉ đưa LÝ DO khi khách lăn tăn/chê lâu
const DELIVERY_SLOW_REPLY =
  "Dạ bên em là hàng thiết kế nên may kỹ hơn chút, đợt này đơn cũng hơi nhiều nên mong chị thông cảm chờ giúp em xíu nha ạ. Em nhắn kho ưu tiên gửi sớm nhất cho mình ạ";
function isDeliveryConcern(text) {
  return /(lâu thế|lâu vậy|sao lâu|lâu quá|gì mà lâu|lâu nhỉ|chờ lâu|đợi lâu|lâu thế em|lâu v|hơi lâu|lâu nhể)/i.test(String(text || ""));
}

// Khách LĂN TĂN / lo CHẤT LƯỢNG / sợ không đẹp / phân vân mua -> thuyết phục (hàng thiết kế),
// nhắc nhẹ chính sách đã mua không hoàn-hủy. KHÔNG chốt vồ vập.
function isQualityHesitation(text) {
  const t = String(text || "").toLowerCase();
  // lo CHẤT LƯỢNG / phân vân mua (KHÔNG gồm câu HỎI chất vải/chất liệu -> asksMaterial lo; KHÔNG gồm "như hình")
  const quality = /(sợ (chất lượng|vải|hàng)|chất lượng (có )?(kém|tốt không|ổn không|đảm bảo không|ok không)|vải (có )?(đẹp|tốt|ổn) (không|ko|chứ)|sợ (không|ko) đẹp|sợ xấu|có ok không|có chuẩn không|hàng có (đẹp|ok|chuẩn|tốt)|lo (không|ko) đẹp|sợ hàng (lỗi|xấu|kém))/i.test(t);
  // phân vân / chưa quyết mua
  const hesitate = /(suy nghĩ|cân nhắc|phân vân|lăn tăn|đắn đo|để (mai|hôm sau|sau)|chưa quyết|từ từ.*mua|để xem đã|nghĩ đã|sợ phí)/i.test(t);
  return quality || hesitate;
}
// Khách LO mặc có HỢP/ĐẸP với mình không (về DÁNG/PHONG CÁCH) — KHÔNG phải lo size "vừa".
function worriesAboutLook(text) {
  const t = String(text || "").toLowerCase();
  if (/\bvừa\b|\bsize\b|cân nặng|\bkg\b|số đo/.test(t)) return false;   // lo VỪA = size -> để size lo
  const worry = /(sợ|lo|ngại|ko biết|không biết|chả biết|chẳng biết|liệu|chắc gì)/.test(t);
  const look = /(hợp|đẹp|kén dáng|hợp dáng|tôn dáng|mặc lên|nhìn có|béo|mập|gầy|ốm|bụng|người (to|béo|mập|đầy)|đầy đặn|lộ (bụng|mỡ|eo))/.test(t);
  // "bụng c to / bụng to / bụng mỡ" — câu nêu vóc dáng (không cần chữ "sợ") cũng coi là lo dáng.
  if (/\bbụng\b.{0,6}(to|bự|mỡ|lớn)|(người|dáng)\s*(to|béo|mập|đầy)/.test(t)) return true;
  return worry && look;
}
// Khách HỎI nếu nhận hàng không vừa/không hợp thì trả/đổi được không (CHỈ HỎI cho yên tâm, chưa đòi trả).
function asksReturnIfNotFit(text) {
  const t = String(text || "").toLowerCase();
  if (/(nhận|nhan).{0,12}(ko|không|chưa|chẳng|kg).{0,5}(vừa|hợp|ưng).{0,16}(trả|đổi|tra|doi)/.test(t)) return true;
  if (/(trả|tra)\s*(lại|lai)\s*(được|duoc|dc)?\s*(ko|không|hông|hong|k)?\b/.test(t)) return true;   // "trả lại được ko"
  if (/(ko|không)\s*(nhận|nhan)\s*hàng.{0,16}(ship|phí ship|trả ship)/.test(t)) return true;
  if (/(nếu|neu).{0,16}(ko|không)\s*(vừa|hợp|ưng).{0,16}(thì|thi|sao|trả|đổi|được|tính|hoàn)/.test(t)) return true;
  // "(nhận hàng) ko ưng/vừa/thích thì sao/làm sao" — lo lắng nếu không ưng (KHÔNG cần chữ trả/đổi).
  if (/(ko|không|k|chưa|lỡ|nhỡ)\s*(thấy\s*)?(ưng|vừa|thích|hợp|hài lòng|vừa ý)\b.{0,12}(thì|thi)?\s*(sao|lam sao|làm sao|thế nào|the nao|ntn|tn)\b/.test(t)) return true;
  return false;
}
// Lời NHẮN NHỦ thân thiện sau khi đặt (nhớ gửi hàng đẹp, gói kỹ, ship nhanh...).
function isFriendlyRemark(text) {
  const t = String(text || "").toLowerCase();
  return /(nhớ|nhơ).{0,18}(gửi|gui|gói|đóng|ship|giao|chọn).{0,14}(đẹp|cẩn thận|kỹ|nhanh|sớm|chuẩn|xinh|đúng)/.test(t)
    || /(gửi|gui|ship|giao|gói|đóng gói|chọn) (hàng )?(đẹp|chuẩn|xinh|nhanh|sớm|kỹ|cẩn thận)/.test(t)
    || /hàng (đẹp|chuẩn|xinh) (cho|nha|nhé|nhá|đấy|nghe)/.test(t);
}
// Câu ACK thuần (ok/vâng/cảm ơn...) — KHÔNG kèm nội dung khác. Dùng cho ngữ cảnh SAU CHỐT.
function isBareAck(text) {
  const t = String(text || "").trim().toLowerCase();
  if (/^(c|chị|chi|mình|minh|e|em|t|tui|tớ)?\s*(đã |biết )?biết (rồi|r|gòi)( ạ| nha| nhé| nhe| e| em)?[\s.!,😄💕👍❤️🥰]*$/.test(t)) return true;  // "c biết rồi"
  return /^(ok|oke|oki|okie|okê|okey|okla|vâng|dạ|dạ vâng|vâng ạ|uh|uhm| uhm|um|umm|ừ|ừa|ừm|uk|ukm|uki|ukmm|hmm|hm|rồi|cảm ơn|cám ơn|cảm ơn e(m)?|cám ơn e(m)?|thank(s)?|tks|tốt|được rồi|ổn rồi|ok ạ|ok e)([\s.!,😄💕👍❤️🥰ạeê]*)$/i.test(t);
}
// Câu KHEN VUI / TÁM sau chốt ("chốt nhanh thế", "nhiệt tình ghê", "nhanh vậy") -> KHÔNG phải đòi mua thêm.
function isPostOrderChitChat(text) {
  const t = String(text || "").toLowerCase();
  return /chốt\s*(nhanh|lẹ|liền|gọn)/.test(t)
    || /(nhanh|lẹ|giỏi|nhiệt tình|dễ thương|xinh|đỉnh|pro|chuyên nghiệp|tốt|hay|tuyệt|ngon|chuẩn|nhiệt|đáng yêu|kỹ)\s*(thế|vậy|ghê|quá|gớm|nhỉ|ha|v|đấy|ý|z)/.test(t);
}
// Khách CHƯA quyết, muốn THAM KHẢO THÊM / xem thêm đã ("mình tham khảo thêm nhé", "để mình xem thêm đã",
// "mình suy nghĩ thêm", "từ từ", "để mình cân nhắc"). -> KHÔNG gặng chốt/hỏi màu, lùi nhẹ + thuyết phục mềm.
function wantsToBrowseMore(text) {
  const t = String(text || "").toLowerCase();
  // "tham khảo thêm/đã/nhé..." do KHÁCH nói
  if (/tham\s*kh(ả|a)o\s*(th[êe]m|đã|da|nh[ée]|nha|chút|ch[uú]t|t[íi]|lại|cái đã|xíu|sau)/i.test(t)) return true;
  if (/(để|de|cho)\s*(mình|minh|chị|chi|em|t)\s*tham\s*kh(ả|a)o/i.test(t)) return true;
  // suy nghĩ / cân nhắc (luôn là phân vân hoãn quyết)
  if (/(suy nghĩ|suy nghi|cân nhắc|can nhac|đắn đo|dan do)/i.test(t)) return true;
  // xem/coi/nghĩ/tính + thêm/đã/lại  (KHÔNG bắt "xem ảnh" = xin xem ảnh)
  if (/(xem|coi|ngó|ngo|nghĩ|nghi|tính|tinh|ngẫm|tìm hiểu|tim hieu)\s*(th[êe]m|đã|da|lại|lai)/i.test(t)) return true;
  // hoãn quyết định
  if (/(từ từ|tu tu|để (mai|hôm sau|sau|bữa)|khi nào cần|chưa quyết|chua quyet|để (mình|minh|em|chị|chi)\s*(tính|tinh|quyết|quyet|hỏi|hoi))/i.test(t)) return true;
  // [FIX Bích Phượng 2026-07-11] dạng "TÔI SẼ liên hệ khi mua" — từ chối khéo phổ biến nhất:
  // "e mua e liên hệ lại", "mua mình nhắn shop sau", "khi nào lấy em ib", "cần thì em báo shop"
  if (/(khi nào|lúc nào|bao giờ)?\s*(e|em|mình|minh|chị|chi|t|tôi|toi)?\s*(mua|cần|can|lấy|lay|chốt|chot)\s*(thì|thi)?\s*(e|em|mình|minh|chị|chi|t|tôi|toi)\s*(liên hệ|lien he|nhắn|nhan|ib|inbox|báo|bao|gọi|goi)\s*(lại|lai|sau|shop|em|nhé|nha)?/i.test(t)) return true;
  return false;
}
// Khách xin TƯ VẤN chung về MẪU ĐANG XEM ("tư vấn chị", "tư vấn giúp em", "tư vấn mẫu này")
// -> (lại) BÁO GIÁ + 3 ẢNH + 1 câu tư vấn. KHÔNG phải "tư vấn mẫu nào đẹp / mẫu khác" (handler khác lo).
function wantsConsult(text) {
  const t = String(text || "").toLowerCase();
  if (!/tư vấn|tu van/.test(t)) return false;
  if (/mẫu nào|cái nào|con nào|bộ nào|nên (lấy|chọn|mua)|mẫu (tương tự|khác|nào khác|mới)|thêm mẫu|mẫu giống/.test(t)) return false;
  return true;
}
// TUYỆT ĐỐI KHÔNG nhắc hoàn/hủy (khách đâu có đòi trả hàng).
function asksLooksLikePhotos(text) {
  const t = String(text || "").toLowerCase();
  if (asksWhichColorNicer(t)) return false;   // "màu nào mặc ngoài đẹp hơn" -> hỏi MÀU, để handler màu lo (không phải hỏi giống-hình)
  // "lấy/lựa/chọn màu giống ảnh / như hình" = khách CHỐT MÀU (màu trong ảnh) -> KHÔNG phải hỏi "đẹp như hình".
  // (lỗi Lưu Phương Thảo: "mình lấy màu giống ảnh" -> bị bắt nhầm là hỏi giống-hình -> trấn an thay vì CHỐT ĐƠN.)
  if (/(lấy|lựa|chọn|order|đặt|mua)\s*(màu|mau)?\s*(giống|như|theo)\s*(ảnh|hình|hinh)/i.test(t)) return false;
  return /(như hình|giống hình|y hình|khác hình|như ảnh|giống ảnh|đúng (như )?hình|ngoài đời|thực tế (có|nhìn|trông|mặc|đẹp)|ở ngoài (có|nhìn|trông|đẹp|mặc|giống)|bên ngoài (có|nhìn|đẹp|trông|giống)|ngoài (có )?(đẹp|giống|như|xinh))/i.test(t);
}
// Khách NGHI hàng KHÔNG đẹp như TƯ VẤN/quảng cáo/lời nói (thường kèm dọa "không lấy") -> trấn an em tư vấn thật.
function doubtsAdvisedQuality(text) {
  const t = String(text || "").toLowerCase();
  return /(không|ko|kg|chẳng|chả)\s*(đẹp|xinh|ổn|ưng|như ý)?\s*(như|giống)\s*(tư vấn|tu van|em nói|e nói|chị nói|c nói|quảng cáo|qc|lời|miêu tả|mô tả)/.test(t)
    || /(tư vấn|quảng cáo|nói)\s*(quá|ảo|điêu|chém|xạo|lố|một đằng)/.test(t);
}
const _LOOKS_REASSURE = [
  "Dạ chị yên tâm nha, hàng thiết kế nên ngoài đời nhìn cũng đẹp lắm ạ",
  "Dạ ngoài đời mẫu này lên dáng đẹp lắm, chị yên tâm nha",
];
function buildLooksReassure(mem) {
  mem.looksIdx = ((mem.looksIdx || 0) + 1) % _LOOKS_REASSURE.length;
  return _LOOKS_REASSURE[mem.looksIdx];
}
function buildReassureReply(mem) {
  // CHỈ trấn an chất lượng (hàng thiết kế). TUYỆT ĐỐI KHÔNG nhắc hoàn/hủy ở đây
  // (chỉ nói chính sách hoàn/hủy khi khách HỎI -> asksReturnPolicy).
  const arr = [
    "Dạ hàng thiết kế nên chị yên tâm chất lượng nha ạ",
    "Dạ đồ thiết kế nên form và chất đều rất đẹp, chị yên tâm nha ạ",
    "Dạ mẫu này hàng thiết kế, chất lượng kỹ lắm chị yên tâm ạ",
  ];
  mem.reassureIdx = ((mem.reassureIdx || 0) + 1) % arr.length;
  return arr[mem.reassureIdx];
}
// ===== THUYẾT PHỤC BẰNG ẢNH NGHỆ SĨ (cột V "Nghệ sĩ" của Sheet) =====
// Gửi 1 câu thuyết phục + ảnh nghệ sĩ diện mẫu (tối đa 8 ảnh). Dùng cho: khách LĂN TĂN/từ chối,
// lo HỢP DÁNG/phom. CHỐNG TRÙNG: mỗi khách chỉ nhận 1 LẦN cho 1 MÃ (dù gọi từ nhiều chỗ).
// Chỉ gửi khi: mã CÓ dữ liệu cột V + CÓ ảnh nghệ sĩ + chưa chốt + chưa nhường người thật.
// Trả về true nếu ĐÃ gửi (caller dừng, không gửi câu trấn an thường nữa).
async function maybeSendCelebPitch(conversationId, productInfo, mem) {
  try {
    if (!productInfo || !mem) return false;
    const code = String(productInfo.code || "").toUpperCase().trim();
    if (!code) return false;
    if (!String(productInfo.artist || "").trim()) return false;        // cột V trống -> KHÔNG gửi
    if (mem.orderClosed || mem.botHandoffAt) return false;              // đã chốt / đã nhường người -> thôi
    mem.celebPitchByCode = mem.celebPitchByCode || {};
    if (mem.celebPitchByCode[code]) return false;                       // ĐÃ gửi mã này 1 lần -> KHÔNG lặp
    if (!celeb.hasCeleb(code)) return false;                            // chưa có ảnh nghệ sĩ cho mã
    const cids = celeb.celebContentIds(code, 8);
    const urls = celeb.celebUrls(code, 8);
    if (!cids.length && !urls.length) return false;
    const label = productLabel(productInfo);
    const msg1 = `Dạ ${label} từng được nhiều người có gu thời trang khắt khe lựa chọn, trong đó có cả những gương mặt quen thuộc trong giới nghệ sĩ nên chị hoàn toàn có thể yên tâm ạ.`;
    const msg2 = `Nếu chị thích phong cách thanh lịch, tinh tế giống các nghệ sĩ hay theo đuổi thì mẫu này rất hợp đấy ạ, em gửi chị một số hình ảnh nghệ sĩ bên em diện ạ.`;
    await _sendInboxMessage(conversationId, msg1);          // CÂU 1: chỉ chữ, gửi riêng
    await delay(800);                                       // tách 2 tin cho ra đúng thứ tự
    await _sendInboxMessageWithImages(conversationId, msg2, cids, urls);   // CÂU 2: chữ + ảnh nghệ sĩ
    const msg = msg2;
    mem.celebPitchByCode[code] = Date.now();                           // ĐÁNH DẤU đã gửi mã này (1 lần/mã)
    mem.lastBotReply = msg;
    try { console.log(`[${BOT_NAME}] CELEB PITCH mã ${code} (nghệ sĩ: ${String(productInfo.artist).slice(0, 40)}) -> ${cids.length || urls.length} ảnh. Gửi 1 lần/mã.`); } catch (_) {}
    return true;
  } catch (e) {
    try { console.log(`[${BOT_NAME}] CELEB PITCH lỗi:`, e.message); } catch (_) {}
    return false;
  }
}
// Khách HỎI CHẤT LIỆU/VẢI ("chất vải gì", "chất liệu gì", "vải loại nào", "có phải cotton ko") -> trả từ SHEET, KHÔNG bịa.
function asksMaterial(text) {
  const t = String(text || "").toLowerCase();
  if (/(chất liệu (gì|nào|là|thế|ra sao|thế nào|ok|ổn)|chất vải (gì|nào|là|thế|ra sao|thế nào)|vải (gì|nào|loại gì|loại nào|j ạ)|làm (bằng|từ) (gì|chất|vải)|chất\s*(gì|j|chi)(?![a-zà-ỹ])|là (vải|chất) gì|chất (này|đó|kia) (thế nào|ra sao|sao|ok|ổn|gì))/i.test(t)) return true;
  // Hỏi đích danh 1 loại vải: "có phải (là) cotton không", "vải tơ à", "chất lụa hả", "này đũi ko"
  const FAB = "(tơ|lụa|đũi|đ[uũ]i|cotton|kate|voan|ren|thô|lanh|linen|nhung|dạ|kaki|jean|denim|chiffon|satin|gấm|tằm|umi|tuyết mưa|đông xuân|phi lụa|phi bóng|nỉ|len|tuytsi|tuyết si)";
  if (new RegExp(`(có phải|phải|là|chất|vải|này|đây)\\s*(là\\s*)?${FAB}\\b`, "i").test(t) &&
      /(không|ko|hong|hông|à|ạ|hả|phải|đúng|vậy|thế|nhỉ|hay)\b/i.test(t)) return true;
  return false;
}
// Khách hỏi CẢM GIÁC/TÍNH CHẤT VẢI (mềm/cứng/dày/mỏng/nóng/mát/bí/nhăn...). Sheet thường KHÔNG ghi rõ
// -> KHÔNG tự đoán, KHÔNG báo giá: CHỜ XL người thật. (Ca "Này tơ mềm hay tơ cứng ạ".)
function asksFabricFeel(text) {
  const t = String(text || "").toLowerCase();
  const FEEL = "(mềm|cứng|dày|mỏng|nóng|mát|bí|thoáng|mịn|trơn|nhám|xù|nhăn|rít)";
  // 1) SO SÁNH "X mềm hay (X) cứng" / "dày hay mỏng" -> chắc chắn là HỎI
  if (new RegExp(`\\b${FEEL}\\b.{0,12}\\b(hay|hoặc|or)\\b.{0,12}\\b${FEEL}\\b`, "i").test(t)) return true;
  // 2) Các thể còn lại CHỈ tính khi có DẤU HỎI/TỪ HỎI (tránh bắt nhầm lời khen "vải mềm đẹp quá").
  const Q = /\?|(không|ko|hong|hông|à|hả|hăm|nhỉ|thế nào|ra sao|sao ạ|đúng ko|đúng không|phải ko|phải không)\b/i.test(t);
  if (!Q) return false;
  if (new RegExp(`(vải|chất|tơ|lụa|đồ|nó|mẫu này|cái này|này|đây)\\s*(có\\s*)?${FEEL}\\b`, "i").test(t)) return true;
  if (new RegExp(`(mặc|lên|sờ)\\s*(có\\s*)?${FEEL}\\b`, "i").test(t)) return true;
  if (new RegExp(`\\b${FEEL}\\s*(không|ko|hong|hông|à|hả|hăm)\\b`, "i").test(t)) return true;
  return false;
}
function materialReplyFromSheet(product) {
  const m = product && String(product.material || "").trim();
  if (!m || m.length < 2) return null;   // không có dữ liệu -> để CHỜ XL, KHÔNG bịa
  // 1) Ưu tiên CÂU TƯ VẤN theo chất liệu (p.xlsx cột D), "chất này" -> "chất <tên chất của mã>".
  //    Câu cột D đã hoàn chỉnh (bắt đầu "Dạ...") -> gửi thẳng, không nhét tên mã cho khỏi lủng củng.
  const adv = materialAdviceSentence(m);
  if (adv) return adv;
  // 2) Fallback: câu mặc định cũ (chất mát / chất thường).
  const cool = /(đũi|lụa|cotton|voan|thô|linen|lanh|kate|tằm|chiffon|phi lụa|đ[uũ]i)/i.test(m);
  if (cool) return `Dạ ${productLabel(product)} là chất ${m} ạ, mặc lên thoáng mát dễ chịu lắm chị nha — hợp thời tiết nóng, đứng lâu hay ngồi cả ngày vẫn thoải mái`;
  return `Dạ ${productLabel(product)} là chất ${m} ạ`;
}
// [QUY TẮC THUỘC TÍNH] Trả lời ĐỘ CO GIÃN đọc ĐÚNG cột S (product.stretch), KHÔNG suy từ cột chất liệu.
// Cột S ghi "KHÔNG co giãn" / "CÓ CO GIÃN". Trống -> null (để CHỜ XL, không bịa).
function stretchReplyFromSheet(product, mem) {
  const raw = product && String(product.stretch || "").trim();
  if (!raw || raw.length < 2) return null;
  // BỎ DẤU THẬT SỰ (normalizeViet KHÔNG bỏ dấu -> "không" giữ nguyên ô -> /khong/ trượt -> "co giãn" lại
  //  khớp /co/ -> trả NGƯỢC "có co giãn"). Dùng NFD tách dấu rồi xoá -> "không co giãn" -> "khong co gian".
  const f = String(raw).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
  const lbl = productLabel(product);
  const m = mem || {};
  if (/khong/.test(f)) return _rotLine(m, "_noStretchIdx", [   // CÓ "khong" -> không co giãn
    `Dạ ${lbl} chất đứng, không co giãn ạ — mấy loại vải đẹp như này thường vậy đó chị. Bù lại mặc lên phom dáng và sang hơn hẳn đồ thun co giãn`,
    `Dạ ${lbl} không co giãn chị nha, nhưng đó là chủ đích để vải đứng form, lên dáng đẹp và bền lâu không bị dão ạ`,
  ]);
  if (/co\s*gian|^co\b|\bco\b/.test(f)) return _rotLine(m, "_stretchIdx", [
    `Dạ ${lbl} chất co giãn nên rất dễ mặc và ít kén dáng ạ — co giãn theo người nên mình hơi nhỉnh cân một chút vẫn mặc đẹp, thoải mái cả ngày chị ạ.`,
    `Dạ ${lbl} co giãn tốt nên cử động thoải mái lắm ạ — ngồi, đi lại, vận động cả ngày vẫn dễ chịu, không bị bó hay khó chịu chỗ nào chị ạ.`,
  ]);
  return null;
}
// ===== NGƯỜI MẪU & LO VÁY NGẮN =====
const MODEL_HEIGHT = "1m62";
const MODEL_WEIGHT = "47kg";
const MODEL_SIZE = "S";   // size người mẫu đang mặc trong ảnh (trả khi khách hỏi "mẫu mặc size gì")
// Khách LO/CHÊ VÁY NGẮN ("sợ váy ngắn", "váy bị ngắn quá", "nhìn ngắn nhỉ") -> trấn an theo thiết kế.
function worriesShort(text) {
  const t = String(text || "").toLowerCase();
  return /(sợ|lo|ngại|hơi|bị|nhìn|thấy|trông|váy (này )?|đầm (này )?|cái này |mẫu này ).{0,10}ngắn|ngắn (quá|nhỉ|ạ|thế|vậy|á|nha|nhề|ko|không|wá)|váy ngắn|đầm ngắn|short quá|sợ ngắn|ngắn lắm/i.test(t);
}
// Khách CHÊ/LO CẠP CHUN (cạp chun không sang / không thích cạp chun) -> trấn an theo thiết kế.
function worriesElasticWaist(text) {
  const t = String(text || "").toLowerCase();
  if (!/(cạp chun|cap chun|cạp thun|cap thun|chun|thun lưng|cạp)/.test(t)) return false;
  return /(không|ko|hông|chẳng|chả)\s*(thích|ưng|sang|đẹp|gọn|ổn)|trông (ko|không) sang|nhìn (ko|không) sang|kén|xấu|sồ sề|luộm thuộm|sợ|ngại|lo/i.test(t);
}
// Khách muốn ẢNH CHỤP THỰC TẾ TẠI SHOP (không phải ảnh mẫu) -> bên em không tự chụp được qua bot -> NGƯỜI THẬT.
// Khách xin ẢNH loại CỤ THỂ bot không có sẵn (mannequin / riêng sản phẩm / cận chất) -> NHỜ NV (không đoán, không gửi ảnh front bừa).
function asksSpecificPhoto(text) {
  const t = String(text || "").toLowerCase();
  const photoCtx = /(ảnh|hình|chụp|clip|video|xem|coi|gửi|gui|nhìn)/.test(t);
  const mannequin = /(ma ?nơ ?canh|manocanh|mannequin|người mẫu mặc|mẫu mặc|có người mặc|trên người mẫu)/.test(t);
  const productOnly = /(không (có )?người mặc|ko (có )?người mặc|riêng (sản phẩm|đồ|áo|váy|cái)|chỉ (mỗi )?(sản phẩm|đồ|cái áo|cái váy)|sản phẩm không (có )?người|trải phẳng|ảnh phẳng|chụp phẳng)/.test(t);
  const closeFabric = /(cận chất|cận vải|cận cảnh|chi tiết (chất|vải|đường may|chất liệu)|zoom (chất|vải|gần|cận)|chất liệu gần|gần (chất|vải)|ảnh chất gần)/.test(t);
  return (mannequin || productOnly || closeFabric) && photoCtx;
}
function asksShopLivePhoto(text) {
  const t = String(text || "").toLowerCase();
  return /(chụp|chup)\s*(cho |giúp |giùm |dùm )?.{0,12}(tại shop|ở shop|tại cửa hàng|ở cửa hàng|thực tế|ngoài shop|trực tiếp)|(ảnh|hình)\s*(thực tế |thật )?(tại shop|ở shop|tại cửa hàng|chụp tại shop|ngoài shop)|quay (video |clip )?(sản phẩm|đồ|hàng)/i.test(t);
}
// Khách NGHI NGỜ ảnh có thật không ("ảnh thật cơ mà", "không có ảnh chụp thật à", "ảnh thực tế không") -> gửi ảnh + khẳng định ảnh thật của thương hiệu.
function doubtsPhotosReal(text) {
  const t = String(text || "").toLowerCase();
  return /(ảnh|hình|hinh|anh)\s*(chụp )?(thật|that|thực|thuc|real)\s*(cơ|co|à|a|ạ|không|ko|hông|đấy|vậy|chứ|mà)?|(không|ko|hông)\s*(có )?(ảnh|hình|anh|hinh)\s*(chụp )?(thật|thực)|(ảnh|hình)[^?]{0,15}(trên mạng|lấy mạng|trên google|mạng à|ảo|fake|lấy trên mạng)/i.test(t);
}
// Khách hỏi NGƯỜI MẪU CAO/NẶNG bao nhiêu -> trả chiều cao; cân nặng CHỈ nói khi khách hỏi tới.
function asksModelSize(text) {
  const t = String(text || "").toLowerCase();
  // (1) KHÁCH tự cho số đo của MÌNH rồi hỏi "có vừa không" -> đây là TƯ VẤN SIZE, KHÔNG phải hỏi số đo người mẫu.
  //     (vd "cao 1m5 nặng 60kg có vừa ko") -> để rớt xuống nhánh tư vấn size.
  const selfMeasure = /(cao|chiều cao)[^?]{0,20}(nặng|cân)/.test(t)
                   && /(vừa|mặc được|mặc dc|fit)/.test(t);
  const mentionsModel = /(người mẫu|(?<!\S)ng mẫu|model|bạn mẫu|người mặc|chị mẫu|mẫu (shop|bên em|ảnh))/.test(t);
  if (selfMeasure && !mentionsModel) return false;
  // (2) "ng mẫu" / "e mẫu" PHẢI đứng ĐẦU TỪ (?<!\S) — nếu không sẽ nuốt đuôi "khô-NG MẪU" / "h-E MẪU"
  //     (sau normalizeViet "ko"->"không", "...vừa khôNG MẪU này..." từng bị hiểu nhầm là hỏi người mẫu).
  // (3) "mẫu (shop/bên em) đang mặc là sz gì / mặc size mấy" -> hỏi SIZE người mẫu mặc (không phải cao/nặng).
  const _modelKw = "(người mẫu|(?<!\\S)ng mẫu|ngươi mau|mẫu (shop|bên em|ảnh)|model|bạn mẫu|người mặc|chị mẫu|(?<!\\S)e mẫu)";
  const asksModelWornSize = new RegExp(`${_modelKw}[^?]{0,20}(m\\u1eb7c|mac|đang m\\u1eb7c|dang mac)[^?]{0,10}(size|sz|s\\u1ed1)|${_modelKw}[^?]{0,15}(size|sz)\\s*(gì|gi|nào|nao|mấy|may|bao nhiêu|bn)`, "i").test(t)
    || /(shop|bên em|bạn|chị|em)\s*(đang )?(mặc|mac)[^?]{0,8}(là )?(size|sz)\s*(gì|gi|nào|nao|mấy|may)/i.test(t)
    || /(^|\s)(mẫu|model)\s*(shop |bên em |này |đang )?(đang )?(mặc|mac)[^?]{0,8}(là )?(size|sz)\s*(gì|gi|nào|nao|mấy|may|bao nhiêu|bn)/i.test(t);
  if (asksModelWornSize) return true;
  return /(người mẫu|(?<!\S)ng mẫu|ngươi mau|mẫu (shop|bên em|ảnh)|model|bạn mẫu|người mặc|chị mẫu|(?<!\S)e mẫu)[^?]{0,20}(cao|nặng|chiều cao|bao nhiêu|mét|m\d)|(cao|chiều cao)[^?]{0,12}(người mẫu|mẫu|model|người mặc)|người mẫu.*cao|mẫu.*cao bao nhiêu|mẫu\b[^?]{0,8}cao\b\s*(bao nhiêu|bn|nhiêu|nhiu|mét|m\s?\d)/i.test(t);
}
// Khách HỎI ĐÂY LÀ LOẠI GÌ ("áo hay váy hay set", "là gì vậy", "loại nào") -> trả CHỦNG LOẠI từ sheet.
function asksCategory(text) {
  const t = String(text || "").toLowerCase();
  return /((áo|váy|đầm|set|quần|chân váy|jumpsuit) hay (áo|váy|đầm|set|quần|chân váy|jumpsuit)|là (cái )?(áo|váy|đầm|set|quần|chân váy|jumpsuit)( hay | không| ko|\?| ạ|$)|mẫu này là (gì|loại gì|loại nào|cái gì)|đây là (áo|váy|đầm|set|quần|gì)|là loại (gì|nào))/i.test(t);
}
// ===== CHỦNG LOẠI CHI TIẾT (để gửi mẫu tương tự ĐÚNG loại khi hết hàng) =====
// Đọc cột D (category) + tên. Phân: set-quần / set-váy / set / váy / quần / áo / "" (không rõ).
function _catKeyOf(p) {
  const h = foldVi([p && p.category, p && p.name].join(" "));
  const isSet  = /\bset\b|set |chan vay\b.*set|set.*chan vay/.test(h) || /\bset\b/.test(h);
  const hasVay = /\bvay\b|\bdam\b|chan vay|chan-vay|vay |dam |\bmaxi\b/.test(h);
  const hasQuan = /\bquan\b|quan |\bshort\b|\bjogger\b|\bculotte?\b/.test(h) && !/chan vay/.test(h);
  const hasAo  = /\bao\b|ao |\bso mi\b|\bvest\b/.test(h);
  if (isSet) {
    if (hasQuan && !hasVay) return "set-quan";   // set áo + quần
    if (hasVay) return "set-vay";                // set áo + chân váy / set váy
    return "set";                                 // set chưa rõ
  }
  if (hasVay) return "vay";
  if (hasQuan) return "quan";
  if (hasAo) return "ao";
  return "";
}
// "Khoảng cách" chủng loại: 0 = đúng loại; 1 = cùng họ SET (set-quan<->set-vay<->set); 2 = loại khác.
function _catDistance(a, b) {
  if (!a || !b) return 2;
  if (a === b) return 0;
  if (a.startsWith("set") && b.startsWith("set")) return 1;
  return 2;
}
// Mẫu CÓ size của khách không? (đảm bảo gửi mẫu tương tự khách mặc được)
//  - chưa biết size khách -> KHÔNG lọc (true).
//  - mẫu freesize -> coi như có (gửi tham khảo).
//  - không rõ size mẫu -> loại (false) cho chắc.
function _fitsCustomerSize(p, mem) {
  const cs = mem && mem.customerSize;
  if (!cs || _up(cs) === "FREESIZE") return true;
  const avail = parseAvailableSizes(p && p.size);
  if (avail.size === 0) return false;
  if (avail.has("FREESIZE")) return true;
  return avail.has(_up(cs));
}
// Dựng gallery MẪU TƯƠNG TỰ khi mẫu HẾT HÀNG:
//  - ĐÚNG chủng loại trước (set quần->set quần, set váy->set váy, váy->váy...),
//  - đảm bảo CÓ size khách, ưu tiên sheet 2026 + mẫu CLIP giống nhất + cột T "mới",
//  - đủ 10 mẫu; thiếu mới mở sang chủng loại khác.
async function buildOOSSimilarGallery(deadCode, mem, opts = {}) {
  const want = String(deadCode || "").toUpperCase();
  const cat = await ensureCatalog();
  const dead = cat.byCode.get(want);
  const wantKey = dead ? _catKeyOf(dead) : "";
  // hạng CLIP (mẫu nhìn giống nhất xếp trước)
  let clipRank = new Map();
  try {
    const sims = await similarByCode(want, 60);
    sims.forEach((s, i) => clipRank.set(String(s.code || "").toUpperCase(), i));
  } catch (e) { console.log("[OOS] similarByCode lỗi:", e.message); }
  const exclude = new Set([want, ...((mem && mem.sentGalleryCodes) || []).map(c => String(c).toUpperCase()), ...((opts.exclude) || []).map(c => String(c).toUpperCase())]);
  const cand = [];
  for (const p of (cat.list || [])) {
    const C = String(p.code || "").toUpperCase();
    if (!C || exclude.has(C)) continue;
    if (!recommend.sellable(p) || recommend.isOutOfStock(p)) continue;   // còn bán + còn hàng
    if (!_fitsCustomerSize(p, mem)) continue;                            // CÓ size khách
    const catDist = wantKey ? _catDistance(wantKey, _catKeyOf(p)) : 0;   // 0 đúng loại / 1 cùng họ set / 2 khác
    const sheet2026 = p.sheetName === "Mẫu 2026" ? 0 : 1;                // ưu tiên sheet 2026
    const clip = clipRank.has(C) ? clipRank.get(C) : 9999;              // CLIP giống -> trước
    const fresh = p.isNew ? 0 : 1;                                       // cột T "mới" -> trước
    cand.push({ p, catDist, sheet2026, clip, fresh, rnd: Math.random() });
  }
  // Sắp: đúng loại -> sheet 2026 -> CLIP giống -> mẫu mới -> ngẫu nhiên
  cand.sort((a, b) =>
    a.catDist - b.catDist || a.sheet2026 - b.sheet2026 || a.clip - b.clip || a.fresh - b.fresh || a.rnd - b.rnd
  );
  const ordered = cand.map(c => c.p);
  const gallery = recommend.buildGallery(ordered, { exclude: [...exclude], maxModels: 10, withPrices: false });
  return gallery;
}

function categoryReplyFromSheet(product) {
  const c = product && String(product.category || "").trim();
  if (!c || c.length < 2) return null;   // không có dữ liệu -> để AI/CHỜ XL, KHÔNG bịa
  return `Dạ ${productLabel(product)} là ${c.toLowerCase()} chị nha ạ`;
}
// Khách HỎI CHÍNH SÁCH hoàn/hủy/đổi/trả -> mới nói "không hoàn-hủy". Tư vấn thường KHÔNG BAO GIỜ nói.
// Khách hỏi CÓ ĐƯỢC XEM HÀNG / ĐỒNG KIỂM trước khi thanh toán (KHÔNG hỏi mặc thử).
function asksInspectBeforePay(text) {
  const t = String(text || "").toLowerCase();
  return /((kiểm tra|kiem tra|xem|check|đồng kiểm|đong kiem|ktra|coi|kiểm|kiếm)\s*(kỹ |kĩ )?(hàng|sản phẩm|sp|đồ|được)?\s*(trước|truoc)?\s*(khi )?(thanh toán|tt|trả tiền|nhận|nhan|lấy|giao))|đồng kiểm|(được|dc|đc|đk|cho|có)\s*(kiểm tra|kiem tra|ktra|xem|coi|check|kiểm|kiếm)\s*(hàng|hang|sp|sản phẩm|đồ|do|trước)|kiểm hàng|kiếm hàng|ktra\s*(kỹ |kĩ )?(hàng|hang|sp|sản phẩm|đồ|do)|(xem|coi)\s*thử\s*(hàng|đồ|do|sp|sản phẩm)/i.test(t);
}
// Khách hỏi CÓ ĐƯỢC MẶC/THỬ HÀNG không (mặc thử/ướm thử/thử đồ/thử size/thử hàng...).
// LOẠI "xem thử/coi thử" (= ngó qua, không phải mặc thử) -> để rơi về nhánh xem hàng/đồng kiểm.
function asksTryOn(text) {
  const t = String(text || "").toLowerCase();
  const seeOnly = /(xem|coi|ngó|ngo|nhìn|nhin)\s*thử/i.test(t)
    && !/(mặc|ướm|mac|uom)\s*thử|thử\s*(đồ|do|size|mặc|mac|áo|ao|váy|vay|đầm|dam|quần|quan|set)/i.test(t);
  if (seeOnly) return false;
  return /(mặc|ướm|mac|uom)\s*thử|(mặc|mac)\s*(lên|len|vào|vao)|ướm\b|thử\s*(đồ|do|size|áo|ao|váy|vay|đầm|dam|quần|quan|set|lên|len)|thử\s*(mặc|mac)|thử\s*hàng|thử\s*hang|thử\s*(sản phẩm|sp|món)|mặc\s*thử|mặc\s*lên/i.test(t);
}
// Khách hỏi VÌ SAO không được MẶC THỬ khi nhận hàng.
function asksWhyNoTryOn(text) {
  const t = String(text || "").toLowerCase();
  return /(sao|tại sao|vì sao|why|ủa).{0,22}(không|ko|hông|chẳng).{0,10}(được )?(mặc )?thử|(không|ko|hông).{0,4}(cho|được).{0,8}(mặc )?thử.{0,12}(à|ạ|hả|sao|vậy|thế)|tại sao.{0,12}thử/i.test(t);
}
function asksReturnPolicy(text) {
  const t = String(text || "").toLowerCase();
  return /(được (đổi|trả|hoàn|hủy)|có (đổi|trả|hoàn|hủy)|đổi trả|hoàn trả|hoàn tiền|trả hàng|trả lại|hủy đơn|chính sách (đổi|hoàn|trả|hủy)|(không|ko|k) vừa.*(đổi|trả|hoàn|trả lại)|nếu (không|ko|k) (vừa|thích|ưng).*(đổi|trả|hoàn))/i.test(t);
}
// ===== ĐỔI HÀNG =====
// Khách HỎI CHÍNH SÁCH đổi (whether) - có thể CHƯA mua: "có được đổi không", "đổi hàng được ko", "có hỗ trợ đổi".
// Khách hỏi "(nếu) KHÔNG ƯNG/THÍCH/VỪA thì ĐỔI được không" -> hỏi CHÍNH SÁCH đổi (chưa mua).
// Bắt sớm để KHÔNG bị nhầm chữ "ưng" thành ý chốt đơn.
// Khách HỎI NGƯỢC căn cứ: "sao em biết chị vừa size?", "em có hỏi cao nặng đâu", "cao nặng bao nhiêu mà bảo vừa".
function asksHowKnowSize(text) {
  const t = String(text || "").toLowerCase();
  if (/(sao|tại sao|vì sao|làm sao|seo)\s*(em |e |bên em )?(biết|bit|rõ)\b[^?]{0,22}(vừa|mặc vừa|hợp|size|đúng size)/.test(t)) return true;
  if (/(có |đã )?hỏi[^?]{0,18}(cao|nặng|cân nặng|chiều cao|số đo)[^?]{0,12}(đâu|chưa|à|bao giờ)/.test(t)) return true;
  if (/(chiều cao|cân nặng|cao nặng|cao bao nhiêu|nặng bao nhiêu|số đo)[^?]{0,28}(mà|sao|đâu)[^?]{0,16}(vừa|bảo vừa|biết|size|tư vấn)/.test(t)) return true;
  if (/(ý (chị|c) là|nghĩa là)[^?]{0,18}(sao|gì)[^?]{0,22}(biết|vừa|size)/.test(t)) return true;
  return false;
}
function asksExchangeIfNotLike(text) {
  const t = String(text || "").toLowerCase();
  return /(không|ko|k|nếu|neu|nếu mà|chưa|lỡ|nhỡ)\s*(thấy\s*)?(ưng|thích|vừa|hợp|đẹp|hài lòng|vừa ý|vẹ ý)/.test(t)
    && /(đổi|trả|hoàn|ship.*về|gửi.*(về|lại))/.test(t);
}
function asksExchangePolicy(text) {
  const t = String(text || "").toLowerCase();
  if (!/đổi/.test(t)) return false;
  if (/trả hàng|hoàn tiền|hoàn hàng|trả lại/.test(t)) return false;
  // CHỈ tính là HỎI CHÍNH SÁCH khi có dạng nghi vấn rõ: "(có/được/hỗ trợ) đổi", "đổi (được) không/ko".
  if (/(có|được|cho|hỗ trợ)\s*(được\s*)?đổi\b/i.test(t)) return true;
  if (/đổi\s*(hàng|size|mẫu|trả)?\s*(được\s*)?(không|ko|hông)\b/i.test(t)) return true;
  if (/chính sách đổi|quy định đổi|đổi\s*(hàng\s*)?(trong\s*)?(bao lâu|mấy ngày)|đổi.*(mất phí|free|miễn phí)/i.test(t)) return true;
  return false;
}
// Khách ĐÃ NHẬN HÀNG muốn ĐỔI (câu KHẲNG ĐỊNH có dấu hiệu đã nhận / lỗi form thực tế) -> mới gửi hướng dẫn gửi hàng.
// Khách (sau khi nhận hàng) muốn ĐỔI nhưng yêu cầu SHOP QUA TẬN NƠI LẤY hàng, không muốn đi ship -> NGƯỜI THẬT.
function wantsShopComePickup(text) {
  const t = String(text || "").toLowerCase();
  if (/(qua|đến|tới|sang|ghé)\s*(nhà |chỗ |nơi |tận nơi |tận nhà )?(lấy|nhận|thu)\s*(hàng|đồ|lại|trực tiếp)?/.test(t)
      && /(shop|bên em|cửa hàng|nhân viên|ship[pe]*r|người|ai đó)/.test(t)) return true;
  if (/(không|ko|k|chẳng|chả)\s*(muốn|thích)\s*(đi\s*|phải\s*|ra\s*)?(ship|gửi|bưu điện|ra bưu)/.test(t)) return true;
  if (/(lấy|nhận|thu|đổi)\s*(hàng\s*)?(tận nơi|tại nhà|trực tiếp tại nhà)/.test(t)) return true;
  if (/(qua|đến|tới)\s*(tận nơi|tận nhà)\s*(lấy|đổi|nhận|thu)/.test(t)) return true;
  return false;
}
function wantsToExchange(text) {
  const t = String(text || "").toLowerCase();
  if (/trả hàng|hoàn tiền|hoàn hàng|trả lại tiền/.test(t)) return false;
  if (asksExchangePolicy(t)) return false;   // câu HỎI chính sách -> KHÔNG phải đã-nhận-muốn-đổi
  // Câu nêu RÕ muốn đổi / hỏi CÁCH gửi đổi (kể cả không kèm "đã nhận"):
  if (/(gửi|ship)\s*(hàng\s*)?(về\s*)?(đi\s*)?(lại\s*)?đổi/.test(t)) return true;                 // "gửi về đổi", "ship hàng đổi"
  if (/(muốn|cần|đòi)\s*đổi\s*(hàng|lại)\b/.test(t)) return true;                                  // "muốn đổi hàng"
  if (/đổi\s*hàng/.test(t)) return true;                                                          // "đổi hàng" (câu hỏi chính sách đã lọc ở trên)
  if (/đổi\s*(hàng|size|mẫu|cái này|nó)?\s*(như nào|thế nào|kiểu gì|ra sao|làm sao|ở đâu|kiểu j|ntn|sao ạ|sao e)/.test(t)) return true;  // "đổi như nào"
  if (!/đổi/.test(t)) return false;
  const received = /(đã nhận|nhận hàng rồi|nhận được hàng|mua rồi|đã mua|mặc rồi|nhận rồi|hàng về rồi)/i.test(t);
  const fitIssueStated = /(rộng|chật|không vừa|ko vừa|không hợp|ko hợp|nhỏ quá|to quá|ngắn quá|dài quá|sai size|lệch size|may lỗi|bị lỗi|hàng lỗi|hỏng|rách|sai mẫu)/i.test(t);
  return received || fitIssueStated;
}
// Khách hỏi hàng ĐỔI/TRẢ đã GỬI VỀ shop NHẬN ĐƯỢC/về tới chưa -> cần NGƯỜI THẬT kiểm kho
// (KHÁC với bắt đầu đổi mới -> không hỏi lý do, không gửi hướng dẫn, KHÔNG báo giá).
function asksExchangeReceived(text) {
  const t = String(text || "").toLowerCase();
  if (!/(đổi|trả|hoàn|gửi\s*(về|lại))/.test(t)) return false;
  return /(nhận|về|tới|đến)[^?]{0,15}chưa/i.test(t);
}
// Hướng dẫn GỬI HÀNG ĐỔI -> TÁCH 2 TIN cho tự nhiên (tin 1: địa chỉ + dặn dò; tin 2: lời trấn an).
function buildExchangeGuide() {
  const part1 = [
    "Chị vui lòng gửi hàng về địa chỉ shop theo hướng dẫn sau ạ:",
    "- Người nhận: Công ty TNHH Mys.P - SĐT: 0566826777",
    "- Địa chỉ: Số 01 - Đường Huỳnh Thúc Kháng - Phường Dĩnh Kế - TP Bắc Giang - Tỉnh Bắc Ninh",
    "Shop hỗ trợ đổi hàng trong 15 ngày, chị nhớ ghi đầy đủ tên và SĐT đã dùng để đặt hàng nha.",
    "Sau khi gửi chị cho shop xin lại hình ảnh bill gửi hàng để tiện theo dõi ạ."
  ].join("\n");
  const part2 = "Chị gửi lại sản phẩm nhe, nhận hàng xong bên chăm sóc khách hàng sẽ liên hệ để gửi mẫu đổi cho mình ạ";
  return [part1, part2];
}
function buildReturnPolicyReply() {
  return "Dạ sản phẩm đã mua shop không hỗ trợ hoàn/hủy, nhưng nếu nhận hàng không vừa shop hỗ trợ đổi size hoặc đổi mẫu cho mình nha ạ";
}
// ===== ĐỌC LÝ DO khách muốn đổi -> để ĐỒNG CẢM đúng trước khi đưa hướng dẫn (tránh cụt) =====
function exchangeReason(text) {
  const t = String(text || "").toLowerCase();
  if (/(rộng|to quá|hơi to|bị to|lùng thùng)/.test(t)) return "loose";          // mặc rộng -> đổi size nhỏ hơn
  if (/(chật|nhỏ quá|hơi nhỏ|bị nhỏ|ôm quá|bó quá)/.test(t)) return "tight";     // mặc chật -> đổi size lớn hơn
  if (/(nóng|dày|thô|bí|cứng (vải|quá)|vải cứng)/.test(t)) return "hot";          // chê chất nóng/dày
  if (/(mỏng|lộ|xuyên thấu|hơi mỏng|thấy bên trong)/.test(t)) return "thin";      // sợ chất mỏng/lộ
  if (/(sai màu|khác màu|màu (nhạt|đậm|xấu|không giống|ko giống|khác))/.test(t)) return "color";
  if (/(không vừa|ko vừa|sai size|lệch size|không hợp size)/.test(t)) return "sizemisc";
  return null;   // chưa rõ lý do
}

// Khách lo áo MỎNG / HỞ / XUYÊN THẤU -> tư vấn PHỐI ĐỒ (lớp lót/áo bra tông nude bên trong),
// giọng fashion, chuyên nghiệp; trấn an vẫn kín đáo & tôn dáng.
function isSheerConcern(text) {
  const t = String(text || "").toLowerCase();
  return /(hở|lộ|xuyên thấu|xuyen thau|trong suốt|thấu da|nhìn xuyên|kín đáo|có kín|mà kín|thấy (nội y|bên trong|hết)|lộ nội y)/i.test(t)
      || (/mỏng/i.test(t) && /(hở|kín|lộ|thấu|sợ|lo|nội y|mặc được không|ổn không)/i.test(t));
}
// [2026-07-20 theo lệnh] BỎ 3 câu bra generic — ca lo mỏng/hở giờ trả bằng material_advice
// theo ĐÚNG CHẤT LIỆU của mẫu (sát sự thật sản phẩm, mẫu có lót tự nhắc có lót);
// mẫu không có dữ liệu chất -> KHÔNG nói bừa, im + nhường người thật.

// Khách PHẢN ĐỐI "nóng / bí / thích chất mát" -> THUYẾT PHỤC linh hoạt, KHÔNG lặp lại mô tả.
function isHeatComfortObjection(text) {
  const t = String(text || "").toLowerCase();
  return /(nóng (lắm|quá|không|ko|nực|à|thế|vậy)?|sợ nóng|mặc nóng|chất nóng|thích (chất )?mát|chất mát|vải nóng|bí (quá|lắm)?|không thoáng|ko thoáng|hầm (quá|lắm)?|oi bức|bí bách|nực)/i.test(t);
}
const _HEAT_PERSUADE = [
  "Dạ không nóng đâu chị ơi, {m} chất vừa phải, không dày, mặc thoáng và dễ chịu lắm ạ",
  "Dạ chị cứ yên tâm, {m} mặc thoáng mát không bí đâu ạ. Mà bên em cho kiểm hàng trước khi thanh toán nữa — chị nhận hàng có thể trực tiếp cảm nhận ạ.",
];
function buildHeatPersuade(mem, product) {
  const lbl = product ? productLabel(product) : "mẫu này";
  mem.heatIdx = ((mem.heatIdx || 0) + 1) % _HEAT_PERSUADE.length;
  return _HEAT_PERSUADE[mem.heatIdx].replace("{m}", lbl);
}

// Khách hỏi SỐ ĐO / CHIỀU DÀI cụ thể (quần/áo/váy/tay dài bao nhiêu, đến đâu, mấy cm...).
// TUYỆT ĐỐI KHÔNG bịa: chỉ trả lời khi MÔ TẢ sản phẩm có số đo; không có -> "để em kiểm tra lại".
function asksSpecificMeasurement(text) {
  const t = String(text || "").toLowerCase();
  if (asksOrderStatus(t)) return false;   // "hàng/đơn đến đâu rồi" = hỏi GIAO HÀNG, KHÔNG phải số đo
  // "đến đâu/tới đâu" CHỈ tính là hỏi số đo khi có ngữ cảnh quần áo/độ dài (váy/áo/quần... đến đâu, dài đến đâu).
  return /(dài (đến đâu|tới đâu|bao nhiêu|cỡ nào|hay ngắn|qua gối|trên gối|ngang đâu|đến đoạn nào|chừng nào|đến gối|đến đùi)|(váy|áo|quần|đầm|chân váy|tay áo|set|sooc|short)\s*(này |đó |kia )?(dài )?(đến đâu|tới đâu)|bao nhiêu cm|mấy cm|số đo|dài áo|dài quần|dài váy|dài tay|chiều dài|độ dài|dài chân váy|ngang vai|rộng vai|dài bao nhiêu|dài ngắn)/i.test(t);
}
// Khách XIN MAY/SỬA/CHỈNH theo yêu cầu riêng (may dài/ngắn thêm, sửa theo số đo, may đo riêng...).
// -> bên em KHÔNG nhận điều chỉnh theo yêu cầu; giữ nguyên thiết kế gốc.
// KHÁC asksSpecificMeasurement ("dài bao nhiêu" = hỏi số đo) -> đây là YÊU CẦU thay đổi sản phẩm.
function asksCustomTailor(text) {
  const t = String(text || "").toLowerCase();
  const verb = /(may|sửa|chỉnh sửa|chỉnh lại|cắt|nối|nới|kéo dài|lên lai|lên gấu|bóp|độn|đặt may|may đo)/;
  const sizeChange = /(dài|ngắn|rộng|chật|lai|gấu|eo|cạp|theo (số đo|người|dáng|ý|yêu cầu|mình|riêng))/;
  if (verb.test(t) && sizeChange.test(t)) return true;
  // "muốn/cho/làm (nó) dài/ngắn hơn/thêm/ra/lại"
  if (/(muốn|cho|làm|được)[^.?!]{0,14}(dài|ngắn)[^.?!]{0,8}(hơn|thêm|ra|lại)/.test(t)) return true;
  return false;
}
// Khách LO mẫu NGẮN (vd "có ngắn ko", "bên ngoài ngắn quá ko", "sợ ngắn", "lớp ngoài ngắn ko").
// KHÁC asksSpecificMeasurement (hỏi số đo cụ thể) -> đây là LO LẮNG về độ dài, trấn an theo thiết kế.
function worriesGarmentShort(text) {
  const t = String(text || "").toLowerCase();
  if (!/ngắn|ngan/.test(t)) return false;
  return /(có|co|bị|bi|thấy|thay|nhìn|nhin|trông|trong|hơi|hoi|khá|kha|sợ|so)\s*(hơi\s*|khá\s*)?ngắn|ngắn\s*(không|ko|k|quá|qua|hông|hong|vậy|va|ạ|a|z|lắm|lam|nhỉ|nhi|nhể|the|thế|ghê|qa|ngủn|cũn)|sợ ngắn|so ngan|ngắn ngủn|ngắn cũn|hơi ngắn|ngắn quá/i.test(t);
}
// Khách HỎI CÓ 1 SIZE CỤ THỂ không ("có size XL không", "co xl ko", "còn size L ko") -> trả ĐÚNG bảng size mẫu.
// Trả về size hỏi (in HOA) hoặc null. Tránh bắt 'm' trong "màu", 'l' trong "lấy" (yêu cầu ranh giới + có "có/còn").
function asksWhichSpecificSize(text) {
  const t = String(text || "").toLowerCase().replace(/[?]/g, " ");
  if (!/(^|\s)(có|co|còn|con|cần|can)(\s|$)/.test(t)) return null;
  if (/size\s*(nào|gì|j)(\s|$)/.test(t)) return null;   // "có size nào" = hỏi LIỆT KÊ, không phải 1 size cụ thể
  const m = t.match(/\b(?:size|sz)\s*(xs|xl|xxl|xxxl|freesize|s|m|l)\b/i)     // "size l", "size xl"
         || t.match(/(?:^|\s)(xl|xxl|xxxl|freesize)(?=\s|$)/i)                // xl/xxl... đứng riêng (an toàn)
         || t.match(/(?:^|\s)(s|m|l)\s*(?:ko|không|khong|k|hông|hong)\b/i);   // "m ko", "l ko" (s/m/l đơn chỉ khi theo sau là "ko/không")
  if (!m) return null;
  let sz = m[1].toUpperCase().replace(/\s+/g, "");
  if (/FREE/.test(sz)) sz = "FREESIZE";
  return sz;
}
// Khách ĐỒNG Ý / ƯNG ("ok", "oki e", "đồng ý", "chốt nha", "lấy nhé", "ừ", "vâng"...).
// CHỈ tính khi câu NGẮN + KHÔNG kèm câu hỏi (loại "ok nhưng có ngắn ko") + KHÔNG kèm size/sđt (để handler khác lo).
function saysAgree(text) {
  const t = String(text || "").toLowerCase().trim();
  if (!t || t.length > 28) return false;
  // có dấu hỏi / từ nghi vấn / hỏi thuộc tính -> KHÔNG phải đồng ý thuần
  if (/[?]|không\b|ko\b|\bk\b|gì|sao|nào|bao nhiêu|mấy|ngắn|dài|lót|chất|vải|màu|size\s*(nào|gì)|đổi|ship|phí/.test(t)) return false;
  // có số (sđt/size số) -> để handler size/sđt lo
  if (/\d/.test(t)) return false;
  return /^(dạ\s*|da\s*|ờ\s*|o\s*)?(ok|oki|okie|oke|okê|okay|okê|uki|uk|ưng|đồng ý|dong y|chốt|chot|lấy|lay|lên đơn|len don|chốt luôn|chot luon|chốt nha|ừ|ừm|um|vâng|được rồi|duoc roi|đc rồi|dc roi|got it|yes)(\b|[\s,.!ạanhéơiịu]|$)/i.test(t);
}
function measurementFromDesc(product, askText) {
  if (!product || !product.description) return null;
  const desc = String(product.description);
  const t = String(askText || "").toLowerCase();
  let part = null, label = "";
  if (/quần|short|sooc|sọc|đùi/i.test(t)) { part = "quần"; label = "quần"; }
  else if (/váy|đầm|chân váy/i.test(t)) { part = "(váy|chân váy|đầm)"; label = "váy"; }
  else if (/tay/i.test(t)) { part = "tay"; label = "tay áo"; }
  else if (/áo/i.test(t)) { part = "áo"; label = "áo"; }
  // tìm "dài <part> ... <số> cm" trong mô tả
  if (part) {
    const m = desc.match(new RegExp("dài\\s*" + part + "[^\\d]{0,14}(\\d{2,3})\\s*cm", "i"));
    if (m) return `dài ${label} khoảng ${m[m.length - 1]}cm`;
  }
  // hỏi chung chung -> lấy số đo dài đầu tiên nếu mô tả có
  const m0 = desc.match(/dài\s*(áo|quần|váy)[^\d]{0,14}(\d{2,3})\s*cm/i);
  if (m0) return `dài ${m0[1]} khoảng ${m0[2]}cm`;
  return null;
}

// Khách đòi HỦY đơn (đơn đã đặt) -> ĐƠN ƯU TIÊN
function isCancelOrder(text) {
  const t = String(text || "").toLowerCase().replace(/uỷ/g, "ủy");   // gõ kiểu CŨ "huỷ/thuỷ" (dấu trên y) -> "hủy" (dấu trên u)
  return /hủy đơn|huy don|hủy hàng|huy hang|hủy đặt|huy dat|hủy mua|hủy giúp|hủy cho|hủy dùm|hủy hộ|hủy nhé|hủy nha|thì hủy|hủy đi|\bhủy\b|không lấy nữa|ko lấy nữa|hông lấy nữa|không mua nữa|ko mua nữa|bom hàng|bom đơn/i.test(t)
    // "ko lấy hàng đâu", "k lấy nữa đâu", "thôi ko lấy" (không có chữ "nữa")
    || /(không|ko|k|hông|kg|hok)\s*(lấy|mua|đặt|nhận)\s*(hàng|đồ|nữa|đâu|nha)/i.test(t)
    // than CHẬM / mất kiên nhẫn -> dấu hiệu bỏ đơn, nhường người thật xử lý
    || /(quá chậm|chậm quá|lâu quá|quá lâu|đợi (lâu|mãi|hoài)|chờ (lâu|mãi|hoài)|sao lâu|lâu (vậy|thế|the))/i.test(t)
    // nghĩ shop nghỉ bán / bùng / lừa -> bức xúc, phải để người thật xoa dịu
    || /(nghĩ|tưởng).*(không|ko|k|hông).*(bán|ship|giao)|(shop|bên).*(nghỉ bán|ngừng bán|bỏ|bùng|lừa|scam)/i.test(t);
}
// Khách ĐỔI Ý / muốn DỪNG mua (gần chốt hoặc vừa chốt) -> GIỮ ĐƠN nhẹ 1 lần (KHÔNG gồm hoàn/trả hàng).
function wantsToCancelSoft(text) {
  const t = String(text || "").toLowerCase().replace(/uỷ/g, "ủy");
  return /(thôi (chị |c )?(không|ko|k|hông) lấy|không lấy nữa|ko lấy nữa|hông lấy nữa|không mua nữa|ko mua nữa|thôi không lấy|thôi ko lấy|đổi ý|thôi khỏi|không đặt nữa|ko đặt nữa|thôi để sau|chưa lấy nữa|thôi vậy|hủy đơn|hủy giúp)/i.test(t);
}
// Lý do khi khách đổi ý: vì GIÁ.
function cancelReasonPrice(text) {
  return /(giá|đắt|mắc|nhiều tiền|hơi cao|cao quá|đắt quá|mắc quá|tốn|tiền)/i.test(String(text || "").toLowerCase());
}
// Lý do khi khách đổi ý: lo FORM / dáng / mặc không hợp.
function cancelReasonForm(text) {
  return /(form|phom|dáng|hợp|đẹp|béo|mập|gầy|ốm|người|mặc lên|mặc vào|sợ.*(xấu|không hợp|ko hợp|chật|rộng))/i.test(String(text || "").toLowerCase());
}
// Khách đòi HOÀN / TRẢ hàng (đơn đã đặt) -> ĐƠN ƯU TIÊN
function isReturnRefund(text) {
  const t = String(text || "").toLowerCase();
  return /hoàn hàng|hoan hang|hoàn đơn|hoan don|hoàn về|hoan ve|hoàn lại|hoan lai|gửi hoàn|gui hoan|đã hoàn|da hoan|hoàn rồi|hoan roi|trả hàng|tra hang|trả về|tra ve|gửi trả|gui tra|trả lại hàng|tra lai hang|hoàn tiền|hoan tien|hoàn lại tiền|đổi trả|doi tra|return|refund/i.test(t);
}
// Khách BÁO ĐÃ/ĐANG hoàn-trả (HÀNH ĐỘNG rồi, không phải hỏi "có được hoàn không") -> LUÔN ưu tiên người thật,
// kể cả khi câu có "không thích/không ưng" (đó là LÝ DO, không phải hỏi chính sách).
function statedReturnAction(text) {
  const t = String(text || "").toLowerCase();
  return /(hoàn|gửi hoàn|gửi trả|trả)\s*(đơn|hàng|về|lại)\s*(rồi|r\b|hàng|về)?|gửi\s*hoàn|đã\s*hoàn|hoàn\s*(đơn|hàng|về|lại)|trả\s*(hàng|lại|về)\s*(rồi|r\b)|gửi\s*trả\s*(về|lại|hàng)/i.test(t)
    && !/(có|được|cho|nếu|liệu)\s.{0,16}(hoàn|trả|đổi)\b.{0,12}(không|ko|k\b|được|đc|sao)/.test(t);  // loại câu HỎI chính sách
}
// Khách XÁC NHẬN sẽ NHẬN HÀNG + THANH TOÁN (đồng ý COD) -> đơn đã có, CHỈ cảm ơn, TUYỆT ĐỐI không báo giá.
function confirmsCodReceipt(text) {
  const t = String(text || "").toLowerCase();
  if (/(khi nào|khi nao|bao giờ|bao gio|mấy ngày|may ngay|chưa|chua|\bđâu\b|\bdau\b|sao chưa|\?)/.test(t)) return false;  // câu HỎI -> không phải xác nhận
  return /(nhận|nhan)\s*(hàng|hang)\s*(thì\s*)?(thanh toán|thanh toan|trả|tra|tiền|tien|cod|rồi mới|nha|nhé|nhe|ạ\b|nhá|luôn)/i.test(t)
    || /(sẽ|se|ok|oke|vâng|dạ|đồng ý|dong y|chốt|nhất trí)\s*(nhận|nhan)\s*(hàng|hang)/i.test(t)
    || /(thanh toán|thanh toan|trả tiền|tra tien)\s*(khi|lúc|luc)\s*(nhận|nhan|giao)/i.test(t);
}
// Câu HỎI CHÍNH SÁCH (có được hoàn/đổi không, nếu không ưng...) -> trả lời theo kịch bản, KHÔNG phải 185
// Khách nói chuyện ĐỔI SIZE/ĐỔI HÀNG kèm LOGISTICS hậu mua (thu hàng về / nhận lại / gửi lại / ship sz mới /
// "có con nhỏ không đi gửi được" / "không có thời gian") -> hậu mãi thật -> NGƯỜI THẬT. Bền viết tắt: sz/r/dc/k/laii.
// CẦN CẢ 2: hành động đổi + tín hiệu logistics (để KHÔNG bắt nhầm câu HỎI chính sách "đổi size được không").
function talksPostSaleExchange(text) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return false;
  const _exch = /(đổi|doi)\s*(sz|size|hàng|hang|mẫu|mau|lại|lai)\b/.test(t);
  if (!_exch) return false;
  const _logi = /(thu|nhận|nhan|lấy|lay)\s*(hàng|hang|lại|lai|laii)\s*(về|ve|lại|lai)?/.test(t)
    || /gửi\s*(lại|laii|lai)\b/.test(t)
    || /ship\s*(sz|size)\s*mới/.test(t)
    || /(con nhỏ|con nho|không có thời gian|k có thời gian|ko có thời gian|k đi gửi|ko đi gửi|không đi gửi|k đi ship|ko đi ship)/.test(t);
  return _logi;
}
// Khách nói ĐÃ chốt/lên đơn TỪ TRƯỚC ("hôm trước ok lên đơn rồi mà", "chốt đơn rồi mà sao...") = THẮC MẮC tình
// trạng ĐƠN ĐÃ CÓ -> KHÔNG báo giá/đòi info lại, NHƯỜNG NGƯỜI THẬT. KHÔNG bắt nhầm ý ĐỊNH lên đơn mới ("em muốn lên đơn").
function saysOrderAlreadyPlaced(text) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return false;
  const _past = /(hôm|bữa|bua|h[ôo]m)\s*(tr(ư|u)?(ớc|oc)?|qua|kia|nọ|no)/.test(t);   // hôm trước/bữa trước/hôm qua/kia/nọ
  const _ord  = /(lên đơn|len don|chốt đơn|chot don|chốt|chot|đặt hàng|dat hang)/.test(t);
  const _ok   = /(^|\s)(ok|oke|okê|okie|đồng ý|dong y|nhất trí|nhat tri)(\s|$)/.test(t);
  const _doneMa = /(rồi|roi|xong)\s*(mà|ma|đó|do|đấy|day)/.test(t);
  if (_past && (_ord || _ok)) return true;     // "hôm trước ... ok / lên đơn"
  if (_ord && _doneMa) return true;            // "lên đơn / chốt ... rồi mà"
  return false;
}
function isPolicyQuestion(text) {
  const t = String(text || "").toLowerCase();
  return /(có được|co duoc|được .*(không|ko|hong)|duoc .*(khong|ko)|đổi được|có cho|co cho|có nhận|chính sách|chinh sach|quy định|quy dinh|có hỗ trợ|co ho tro|không ưng|ko ưng|hông ưng|không thích|ko thích|nếu .*(ưng|thích|lỗi))/i.test(t);
}
// ===== HẬU MÃI: khách ĐÃ NHẬN HÀNG rồi KÊU KHÔNG VỪA (rộng/chật/lệch/gửi sai) =====
// Đây KHÔNG có từ khoá hoàn/đổi/trả nên các detector cũ bỏ sót -> bot tưởng khách hỏi size để MUA
// -> báo giá + xin SĐT + chốt (ca "gửi rộng cả gang tay / cả người rộng / M50 co 45kg").
// Bắt khi trong các tin GẦN của KHÁCH/NGƯỜI THẬT (BỎ tin bot) có CẢ:
//   (A) tín hiệu ĐÃ NHẬN HÀNG, và
//   (B) than KHÔNG VỪA / GỬI SAI.
// -> hậu mãi thật, NHƯỜNG NGƯỜI THẬT. (Yêu cầu CẢ 2 để KHÔNG bắt nhầm câu hỏi size PRE-SALE
//    kiểu "áo này mặc có rộng không".)
const _RE_RECEIVED = /(nhận được|nhan duoc|đã nhận|da nhan|nhận hàng|nhan hang|nhận đc|nhan dc|hàng về|hang ve|hàng đến|hang den|hàng tới|hang toi|mới nhận|moi nhan|vừa nhận|vua nhan|ship về rồi|ship ve roi|đã ship về|da ship ve)/i;
const _RE_FITBAD = /(rộng|rong\b|chật|chat\b|không vừa|khong vua|ko vừa|k vừa|kg vừa|không mặc vừa|mặc không vừa|lệch|lech\b|nhỏ quá|nho qua|to quá|to qua|bé quá|be qua|ngắn quá|ngan qua|dài quá|dai qua|rộng quá|rong qua|thùng thình|thung thinh|sai size|sai sz|gửi rộng|gui rong|gửi sai|gui sai|gửi nhầm|gui nham|gửi lộn|gui lon|không giống|khong giong)/i;
function postSaleFitComplaint(messages) {
  const recent = (Array.isArray(messages) ? messages : []).slice(-8);
  let gotReceived = false, gotFitBad = false;
  for (const m of recent) {
    if (!m) continue;
    // CHỈ xét tin KHÁCH + NGƯỜI THẬT (bỏ tin bot: bot có thể tự nói "freesize... rộng phần nào" -> tránh tự kích).
    if (m.messageId && botSentIds.has(String(m.messageId))) continue;
    const t = String(m.text || "");
    if (!t) continue;
    if (_RE_RECEIVED.test(t)) gotReceived = true;
    if (_RE_FITBAD.test(t)) gotFitBad = true;
  }
  return gotReceived && gotFitBad;
}
// ===== NGỮ CẢNH HẬU MÃI: đơn ĐÃ mua đang GIAO LẠI / HOÀN (người thật đang xử) =====
// Quét ~10 tin gần nhất CỦA KHÁCH + NGƯỜI THẬT (LOẠI tin BOT), bắt cụm RÕ -> nhường người thật, KHÔNG bán.
//   DELIV: giao lại / ship báo-gọi / không nghe máy / nhận đơn giúp / hàng giao từ [ngày] / hẹn giao.
//   RFEE : "phí ship hoàn" (KHÔNG bắt "phí ship" chung = pre-sale, đã có quy định riêng).
//   + đã/đang hoàn-trả (statedReturnAction) hoặc ĐÒI hoàn/trả (isReturnRefund) KHÔNG phải hỏi chính sách.
function postSaleContext(messages) {
  const recent = (Array.isArray(messages) ? messages : []).slice(-5);
  const DELIV = /(giao lại|giao lan|giao lần\s*\d|lần\s*\d\s*giao|ship[^.]{0,20}(báo|gọi|goi)|(không|khong|ko|k)\s*nghe máy|nhận đơn giúp|nhan don giup|hàng giao từ|hang giao tu|hẹn giao|hen giao|shipper[^.]{0,15}(giao|gọi|goi))/i;
  const RFEE  = /(phí ship hoàn|phi ship hoan|phí[^.]{0,12}hoàn hàng|phi[^.]{0,12}hoan hang|hỗ trợ[^.]{0,20}phí[^.]{0,12}hoàn|ho tro[^.]{0,20}phi[^.]{0,12}hoan)/i;
  // Part B - THREAD ĐANG CHỜ GIAO (đơn đã đặt, đang hối giao). Câu CHỜ-GIAO của shop/bot (KỂ CẢ tin bot, vì
  // chính bot auto-trả "chờ thêm" ở lượt trước) -> từ lượt sau coi là hậu mãi, KHÔNG quay ra báo giá mẫu mới.
  // (Lượt ĐẦU khách hỏi "đã giao chưa" chưa có câu này -> vẫn để handler order-status auto trả như cũ.)
  const WAIT  = /(chờ thêm|cho them|gấp rút hoàn thiện|gap rut hoan thien|quá tải|qua tai|cố gắng nhanh nhất|co gang nhanh nhat|đang chuẩn bị để gửi|dang chuan bi de gui|ưu tiên gửi|uu tien gui|cố gắng giao|co gang giao)/i;
  for (const m of recent) {
    if (!m) continue;
    const t = String(m.text || "");
    if (!t) continue;
    if (WAIT.test(t)) return true;                            // câu chờ-giao (của shop/bot) -> thread đang chờ giao
    if (m.messageId && botSentIds.has(String(m.messageId))) continue;   // còn lại: chỉ xét tin KHÁCH+NGƯỜI THẬT
    if (DELIV.test(t) || RFEE.test(t)) return true;            // giao lại / phí ship hoàn -> hậu mãi
    if (statedReturnAction(t)) return true;                    // đã/đang hoàn-trả
    if (isReturnRefund(t) && !isPolicyQuestion(t)) return true; // đòi hoàn/trả (KHÔNG phải hỏi chính sách)
    if (talksPostSaleExchange(t) && !isPolicyQuestion(t)) return true; // đổi size + logistics hậu mua (thu/nhận/gửi lại, con nhỏ) -> hậu mãi
  }
  // ĐÃ NHẬN HÀNG + kêu KHÔNG VỪA (rộng/chật/lệch/gửi sai) -> hậu mãi, dù không có từ hoàn/đổi/trả.
  if (postSaleFitComplaint(messages)) return true;
  return false;
}
// Gộp các ca cần gắn thẻ AI-ĐƠN ƯU TIÊN (185)
function isPriorityOrder(text) {
  if (isUrgentSpecificDate(text)) return true;
  if (statedReturnAction(text)) return true;   // ĐÃ/ĐANG hoàn-trả (đã nhận hàng) -> LUÔN người thật, kể cả có "không thích"
  // Hủy/hoàn: chỉ tính ƯU TIÊN khi khách ĐÒI (đơn đã đặt), KHÔNG phải hỏi chính sách chung
  if ((isCancelOrder(text) || isReturnRefund(text)) && !isPolicyQuestion(text)) return true;
  return false;
}
function priorityReason(text) {
  if (isCancelOrder(text)) return "hủy đơn";
  if (isReturnRefund(text) || statedReturnAction(text)) return "hoàn/trả hàng (đã nhận)";
  return "cần gấp / ngày-giờ nhận cụ thể";
}

// ===== Chống BÁO GIÁ LẶP =====
// Khách có ĐANG HỎI GIÁ không (mới được báo lại giá)
function isPriceAsk(text, intent) {
  // KHÔNG còn tin mù nhãn "ASK_PRICE" của intent_detector cũ (nó hay phán bậy: "co gian"->ASK_PRICE).
  // Chỉ dựa vào CHỮ trong câu -> tránh kéo câu hỏi thuộc tính vào báo giá/đẩy đơn.
  const t = String(text || "").toLowerCase();
  // "bao nhiêu kg/cân/size/cao/tuổi" = hỏi CÂN NẶNG/SIZE/chiều cao, KHÔNG phải hỏi GIÁ -> loại trừ.
  if (asksWeightForSize(t)) return false;
  if (asksSpecificMeasurement(t)) return false;   // "dài quần bao nhiêu" = hỏi SỐ ĐO, không phải giá
  if (/bao nhiêu\s*(cân|kg|ký|kí|size|tuổi|cao|mét|cm)|mấy\s*(cân|kg|ký|kí|tuổi)|nặng bao nhiêu/i.test(t)) return false;
  // KHÔNG dùng \b quanh "giá" (dấu "á" không phải ký tự word ASCII -> \b sai).
  if (/giá|bao nhiêu|nhiêu tiền|mấy tiền|bao tiền|giá sao|giá nhiêu|giá mấy|mấy đồng|nhiêu ạ|nhiu|\bbn\b|bn tiền|mắc không|mắc ko|này nhiêu|nhiêu e|nhiêu v|nhiêu z|nhiêu shop/i.test(t)) return true;
  // hỏi giảm giá / khuyến mãi / sale -> cũng là hỏi giá (báo giá gốc + ưu đãi)
  if (/giảm giá|giảm được|bớt|khuyến mãi|khuyến mại|\bkm\b|\bsale\b|ưu đãi|deal|fix giá|có giảm/i.test(t)) return true;
  return false;
}
// Khách SO SÁNH GIÁ: thấy chỗ khác / bên ngoài bán RẺ HƠN -> nêu khác biệt đồ thiết kế vs đại trà (KHÔNG báo lại giá).
function priceComparison(text) {
  const t = String(text || "").toLowerCase();
  // Hỏi THUỘC TÍNH (ngắn/dài/lớp/lót/form/dáng...) -> KHÔNG phải so giá, dù có chữ "bên ngoài" (= lớp ngoài).
  if (/(ngắn|dài|lớp|lót|form|phom|rộng|chật|ôm|dáng|chất|vải|co giãn)/.test(t)) return false;
  if (/(chỗ khác|shop khác|nơi khác|bên ngoài|ngoài kia|ngoài chợ|trên mạng|chỗ kia|hàng chợ|người ta|ngoài shop)[^?]{0,30}(rẻ|re|\d{2,3}\s*k\b|\d{3}\.?\d{3}|giá|bán|thôi|thui|chỉ)/.test(t)) return true;
  if (/(thấy|xem|có chỗ)[^?]{0,24}(rẻ hơn|re hon|bán (có |chỉ )?\d{2,3}\s*k|có \d{2,3}\s*k)/.test(t)) return true;
  return false;
}
// Khách PHẢN ĐỐI GIÁ chung (chê đắt/cao/mắc QUÁ) -> thuyết phục GIÁ TRỊ + freeship, KHÔNG báo lại giá.
function priceObjection(text) {
  const t = String(text || "").toLowerCase();
  if (priceComparison(t)) return false;   // so sánh giá chỗ khác -> để handler riêng (câu khác biệt thiết kế)
  // chê đắt/cao/mắc/chát + quá/thế/vậy/ghê...
  if (/(giá\s*)?(hơi |khá |h[ơo]i )?(cao|đắt|mắc|chát|đắc)\s*(quá|wá|qá|thế|vậy|nhỉ|ghê|gớm|á|ạ|ơi|iu|em|mà|nha|nhé|luôn|rồi|đó|đấy|ư)/.test(t)) return true;
  // "giá cao" đứng gần "giá" (kể cả không có đuôi) -> chê giá; trừ "cao hơn/bằng/cấp" (so sánh / cao cấp)
  if (/giá\s*(hơi\s*|khá\s*)?cao\b(?!\s*(hơn|bằng|cấp|ráo))/.test(t)) return true;
  if (/(đắt|mắc|cao|chát)\s*(vậy|thế|quá|ghê|gớm|đấy|v)\b/.test(t)) return true;
  return false;
}

// ===== [BỔ SUNG] TÌNH HUỐNG THƯỜNG GẶP — câu chuẩn (đuôi chốt động dùng _closeTail) =====
// (3) Khách hỏi BẦU / SAU SINH / cho con bú mặc được không -> KHÔNG tự khẳng định, HỎI mấy tháng + nhường người.
function asksPregnancyFit(text) {
  const t = String(text || "").toLowerCase();
  return /(bầu|mang thai|mang bầu|có thai|co thai|sau sinh|mới sinh|cho con bú|cho con bu|cho bú|bỉm sữa|bim sua|đang bầu)/i.test(t);
}
// (5) Khách hỏi BAO GIỜ CÓ HÀNG/MÀU/SIZE LẠI (restock).
function asksRestock(text) {
  const t = String(text || "").toLowerCase();
  return /((bao giờ|khi nào|lúc nào|chừng nào|hôm nào|ngày nào)\s*(có|về|nhập|còn)\s*(hàng|lại|màu|size)|(về|nhập)\s*(hàng |màu |size )?lại\s*(không|ko|chưa)|restock|nhập lại|về hàng lại|có (hàng |màu |size )?lại\s*(không|ko|chưa))/i.test(t);
}
// (8) Khách lo UY TÍN / sợ BOM / sợ lừa / hàng giả hình -> trấn an COD (kiểm tra trước khi trả tiền).
function fearsTrustOrScam(text) {
  const t = String(text || "").toLowerCase();
  return /(uy tín|uy tin|lừa đảo|lua dao|sợ lừa|bom hàng|bom hang|sợ bom|\blừa\b|scam|giả hình|gia hinh|khác hình|khac hinh|sợ không giống|có đảm bảo|đảm bảo (không|ko)|tin tưởng (được )?(không|ko)|sợ mất tiền|có (ship )?cod (không|ko)|được kiểm (tra )?(hàng )?(không|ko)|kiểm hàng (không|ko)|có thật không shop)/i.test(t);
}
// (4) Khách hỏi HÀNG CÓ SẴN HAY phải ĐẶT TRƯỚC / order (KHÁC "còn hàng" và "bao lâu nhận").
function asksInStockOrPreorder(text) {
  const t = String(text || "").toLowerCase();
  return /((có sẵn|sẵn hàng|hàng sẵn).*(hay|đặt|order|hay phải))|((hay phải |có phải )(đặt|order))|(\b(đặt|order|pre.?order)\s*(trước|hàng)\b)|hàng order|đặt mới (có|làm)|làm xong mới (gửi|giao)/i.test(t);
}
// Câu chuẩn (xoay vòng cho đỡ lặp). Freeship áp dụng đơn trên 500k.
const _PRICE_VALUE_LINES = [
  "Với chất liệu cao cấp và phom dáng chuẩn, tính ra thì mức giá không hề cao đâu chị ạ. Chị nhận hàng, xem hàng và tự tay kiểm tra chất rồi mới thanh toán nên chị hoàn toàn yên tâm nha chị.",
  "Dạ mức giá này bên em đã là tốt nhất cho chất vải và form may kỹ rồi ạ. Bên em miễn phí ship và chị kiểm tra hàng trước khi thanh toán nên chị cứ yên tâm lấy nha.",
];
const _PRICE_COMPARE_LINES = [
  "Dạ mỗi thương hiệu một định vị ạ. Bên em tập trung vào chất vải và form thiết kế nên không chạy theo giá rẻ. Cái chị trả thêm là cho độ hoàn thiện và sự an tâm khi mua từ một shop có thương hiệu, chính sách rõ ràng, sản phẩm mặc lên tôn dáng và sang ạ.",
  "Dạ bên em là dòng thiết kế nên không làm hàng đại trà giá rẻ ạ. Chị chọn brand bên em là chọn một món có form, có chất, mặc lên tôn dáng và sang — em nghĩ chị xứng đáng với điều đó.",
  "Dạ em hiểu chị phân vân ạ, mua online ai cũng sợ không đúng ý. Nên bên em có chính sách cho khách kiểm tra hàng tận tay rồi mới thanh toán, đảm bảo hàng đúng với những gì em tư vấn ạ.",
];
const _TRUST_LINES = [
  "Dạ shop em cho kiểm tra hàng trước khi thanh toán (COD) nên chị yên tâm hoàn toàn nha.",
  "Dạ chị nhận hàng, mở ra xem tận tay rồi mới trả tiền nha. Bên em để chị kiểm trước vì tụi em tự tin vào sản phẩm của mình ạ.",
];
function _rotLine(mem, key, arr) {
  mem[key] = ((mem[key] || 0) + 1) % arr.length;
  return arr[mem[key]];
}
// Khách HỎI có bán trên SÀN SHOPEE không (shopee/shoppe/sopi...). Shop CHỈ bán Facebook + TikTok.
//  KHÔNG bắt "shopp"/"shope" lẻ vì đó là cách khách gõ "shop" (gọi cửa hàng) — "xin giá shopp" = "xin giá shop ơi".
function asksSellOnShopee(text) {
  const t = String(text || "").toLowerCase();
  return /shopee|shoppee|shoppe|(?<![\p{L}])shopi(?![\p{L}])|(?<![\p{L}])sopi(?![\p{L}])|(?<![\p{L}])sopee(?![\p{L}])|(?<![\p{L}])sòpi(?![\p{L}])|sốp ?pi|sòp ?pi|sop pi/iu.test(t);
}
// Khách HỎI 2 page/tên shop PHOM và Mys.P có CÙNG 1 shop/hệ thống không.
//  (vd "Bên b với misp là 1 hay sao nhỉ", "Phom với Mỹ P là 1 shop đúng ko").
//  CHỦ YẾU dựa nhãn AI SAME_SHOP_QA; đây chỉ là fallback khi AI chết.
function asksSameShop(text) {
  const s = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
  const otherName = /misp|mys ?\.? ?p|miss ?\.? ?p|\bphom\b/.test(s);
  const identity  = /(la|co phai|cung|chung)\s*(la\s*)?1\b|1 (shop|he thong|ben|nha|page|cho)|cung (1 )?(shop|he thong|nha)|chung (1 )?(shop|he thong)|1 hay (la )?(sao|2)|\bla 1\b|1 (ko|khong)\b/.test(s);
  return otherName && identity;
}
// Khách HỎI có bán trên TIKTOK không. CÓ nhưng chỉ vài mẫu -> chỉ nói khi được hỏi.
function asksSellOnTiktok(text) {
  const t = String(text || "").toLowerCase();
  return /tiktok|tik tok|tik-tok|tóp tóp|tóptóp|tóp tóp|\btóp\b|\btíktok\b/iu.test(t);
}
// Khách HỎI có đệm/mút/lót ngực không?
function asksBreastPad(text) {
  const t = String(text || "").toLowerCase();
  return /(đệm ngực|mút ngực|lót ngực|miếng đệm|đệm áo|mút áo|có đệm|có mút|đệm (ko|không|k)\b|mút (ko|không|k)\b|có lót ngực|độn ngực)/.test(t);
}
// Khách HỎI váy/set có QUẦN/LỚP LÓT BÊN TRONG không (quần bảo hộ dưới chân váy, lót chống lộ).
// KHÁC asksBreastPad (đệm/lót NGỰC). Dò trên bản BỎ DẤU để bắt cả viết thiếu dấu ("quân", "lot"...).
function asksInnerLining(text) {
  const t = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
  if (/nguc/.test(t)) return false;   // hỏi đệm/lót NGỰC -> để asksBreastPad lo
  // [THÊM] "có quần luôn không/hả/hay", "phải mặc thêm", "có kèm quần" (Thuthanh Pham: "Có quần luôn hả hay
  //   mình phải mặc thêm") — hỏi váy CÓ SẴN QUẦN không, KHÔNG nhất thiết có chữ "trong".
  if (/(co|con)\s*(san |kem |luon )?quan\b.*\b(luon|khong|ko|\bk\b|ha|hay|chua|the|\?)/.test(t)) return true;
  if (/(phai|can)\s*mac\s*them|mac\s*them\s*(quan|gi|do|ko|khong|nua|\?|$)|co\s*kem\s*(quan|gi)|kem\s*quan|co\s*san\s*quan/.test(t)) return true;
  return /(co|con)\s*(quan|quan lot|quan trong|quan bao ho|quan dui|lop lot|lot|vay lot)\s*(o )?(ben |phia )?trong|(ben trong|phia trong|o trong)\s*(co )?(quan|lot|lop lot|gi)|(quan|vay|set)\s*co\s*(quan|lot|lop lot)|mac\s*(ben |phia )?trong\s*co\s*(gi|quan)|co\s*lot\s*(vay|chong lo|ben trong)/.test(t);
}
// Khách HỎI về độ co giãn?
function asksStretch(text) {
  return /(co giãn|co dãn|co dan|giãn không|dãn không|có giãn|độ co|thun không|chun không|mặc có giãn|co không)/i.test(String(text || ""));
}
// Cắt cụm "không co giãn" khỏi câu (đừng tự nói điểm trừ khi khách không hỏi)
function stripNoStretch(reply) {
  if (!reply) return reply;
  return String(reply)
    .replace(/[,;]?\s*(không|ko|hông|hong)\s*co\s*(giãn|dãn|dan)/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*\./g, ".")
    .trim();
}
// Cắt câu khẳng định HẾT HÀNG do AI tự bịa (bot không quản tồn kho thực).
function _isOutOfStockSentence(s) {
  return /(hết hàng|hết size|hết sạch|đã hết|cháy hàng|không còn hàng|ko còn hàng|hết mất|out of stock|sold out|không còn size|ko còn size)/i.test(s);
}
function stripOutOfStock(reply) {
  if (!reply) return reply;
  const kept = String(reply).split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim() && !_isOutOfStockSentence(s));
  return kept.join(" ").replace(/[ \t]{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
}
// Cắt câu filler vô nghĩa lúc đang tư vấn: "Chị xem giúp em mẫu này nhe ạ", "Mời chị xem", "Chị xem qua nhe"...
function stripFillerClose(reply) {
  if (!reply) return reply;
  return String(reply)
    .replace(/\s*Chị xem giúp em( mẫu này| sản phẩm này| mẫu áo này| chiếc này)?( nhe| nha| nhé)?( ạ)?\s*[.!]*\s*$/giu, "")
    .replace(/\s*Chị xem giúp em( mẫu này| sản phẩm này| mẫu áo này| chiếc này)?( nhe| nha| nhé)?( ạ)?\s*[.!]+/gi, " ")
    .replace(/\s*Mời chị xem( mẫu này| qua)?( nhe| nha| nhé)?( ạ)?\s*[.!]*\s*$/giu, "")
    .replace(/\s*Chị xem qua( mẫu này)?( nhe| nha| nhé)?( ạ)?\s*[.!]*\s*$/giu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
}
// 1 câu có phải câu BÁO GIÁ không (có số tiền dạng 1.200.000 / 600.000, hoặc "giá gốc/ưu đãi")
function _isPriceSentence(s) {
  if (/ship/i.test(s)) return false;            // câu ship để hàm ship lo, đừng nhầm
  if (/giá gốc|ưu đãi còn|giá ưu đãi/i.test(s)) return true;
  if (/\d{1,3}([.,]\d{3})+\s*đ?/.test(s)) return true;  // 600.000 / 1.200.000đ
  return false;
}
// Bỏ các câu báo giá khỏi reply (khi mẫu đã báo giá rồi & khách không hỏi giá)
function stripPriceSentences(reply) {
  if (!reply) return reply;
  return String(reply)
    .split(/(?<=[.!?])\s+|\n+/)
    .filter(s => !_isPriceSentence(s))
    .join(" ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.!?])/g, "$1")
    .trim();
}

function closingLine(mem, allowContactAsk) {
  if (allowContactAsk && !mem.customerSize) return "Dạ chị ưng mẫu nào cho em xin size để em kiểm tra cho mình nha.";
  if (allowContactAsk && (!mem.phone || !mem.address)) return "Chị ưng sản phẩm gửi em xin số điện thoại và địa chỉ em lên đơn cho mình nha?";
  return "Dạ chị ưng mẫu nào nhắn em để em tư vấn thêm cho mình nha.";
}

// Trong lúc gửi loạt ảnh, KHÁCH có nhắn tin MỚI không? -> nếu có thì NGỪNG bắn ảnh tiếp (tránh ĐÈ/TRÔI tin khách),
// nhường lượt poll sau trả lời tin mới với ngữ cảnh tươi. Đọc 1 lần (rẻ), so mốc tin khách cuối lúc bắt đầu lượt.
async function customerSpokeSince(conversationId, sinceMs) {
  if (!sinceMs) return false;
  try {
    const raw = await getMessages(conversationId);
    const norm = normalizeMessages((raw && raw.messages) || []);
    return norm.some(m =>
      m.sender === "customer" && m.channel !== "COMMENT" &&
      new Date(m.insertedAt).getTime() > sinceMs + 1500);   // +1.5s biên an toàn tránh đếm lại chính tin đang xử
  } catch (_) { return false; }
}

// Gửi GALLERY (caption tên+giá + ảnh) cho khách. Nhớ mã đã gửi để lần sau không lặp.
async function sendGallery(conversationId, gallery, mem, intro) {
  // Mốc tin khách cuối lúc BẮT ĐẦU lượt -> để biết khách có chen tin MỚI trong lúc đang gửi ảnh.
  const _sinceMs = (_turnCtx && _turnCtx.convId === conversationId && _turnCtx.lastCustAt) ? _turnCtx.lastCustAt : 0;

  if (intro) { await sendInboxMessage(conversationId, intro); await delay(400); }
  if (gallery.caption) { await sendInboxMessage(conversationId, gallery.caption); await delay(500); }

  // Dựng danh sách ảnh dạng CẶP {contentId,url}. buildGallery mới trả gallery.items; nếu thiếu thì ghép lại
  // từ contentIds/imageUrls (chỉ để tương thích — KHÔNG còn ghép lệch index vì items đã căn đúng).
  // TRẦN 20 ẢNH/ALBUM (đừng gửi nhiều quá) — áp cho MỌI gallery vì đều đi qua hàm này.
  const _MAX_GALLERY = 20;
  let list = Array.isArray(gallery.items) && gallery.items.length
    ? gallery.items.slice(0, _MAX_GALLERY)
    : (gallery.contentIds || []).slice(0, _MAX_GALLERY).map((cid, i) => ({ contentId: cid || null, url: (gallery.imageUrls || [])[i] || null }));
  list = list.filter(it => it && (it.contentId || it.url));

  const ids = list.map(it => it.contentId).filter(Boolean);
  let albumOk = false;
  let sentN = 0;

  // (1) GỬI ALBUM 1 PHÁT bằng content_ids. Hội thoại MỚI ("Bắt đầu") FB hay CHƯA mở thread cho media
  //     -> trả lỗi TẠM / #551 (ảnh thành Ô XANH TRỐNG). THỬ LẠI vài lần để album vào ĐỦ, KHÔNG để ô trống.
  if (ids.length) {
    for (let a = 1; a <= 3; a++) {
      let r0 = null;
      try {
        const r = await _sendInboxContentIds(conversationId, ids);
        r0 = Array.isArray(r) ? r[0] : r;
        // [FIX Thanh Nga] Ảnh gallery cũng PHẢI vào botSentIds -> guard chống-lặp (5647) loại đúng ảnh bot,
        //   KHÔNG tưởng "shop đã trả lời" rồi nuốt tin khách chen giữa (vd "C xin giá").
        if (Array.isArray(r)) r.forEach(rememberSentId); else rememberSentId(r);
        if (r0 && r0.success !== false) { albumOk = true; sentN = ids.length; break; }
      } catch (e) { try { console.log("[gallery] album NÉM LỖI:", e.message); } catch (_) {} }
      if (_isNotAvailableSend(r0)) {   // khách vắng -> retry liền vô ích; để rơi xuống lẻ/HẸN sau
        console.log("[gallery] album: khách KHÔNG CÓ MẶT (#551) -> chuyển gửi LẺ (cứu ảnh tốt).");
        break;
      }
      if (_isTransientSend(r0) && a < 3) {
        console.log(`[gallery] album lỗi TẠM (thread chưa mở cho media?) -> nghỉ ${2 * a}s thử lại (lần ${a}).`);
        try { await delay(2000 * a); } catch (_) {}
        continue;
      }
      console.log(`[gallery] album content_id bị từ chối (${(r0 && (r0.message_code || r0.message || r0.reason)) || "?"}) -> gửi LẺ từng ảnh lỗi.`);
      break;
    }
  }

  // (2) ALBUM KHÔNG VÀO -> gửi LẺ TỪNG ẢNH (content_id -> URL của CHÍNH ảnh đó). Chỉ chạy khi album fail
  //     -> "ảnh nào gửi được thì thôi, ảnh lỗi gửi riêng". Giữa chừng KHÁCH nhắn mới -> NGỪNG, nhường lượt sau.
  if (!albumOk && list.length) {
    let aborted = false;
    for (let i = 0; i < list.length; i++) {
      // Trước mỗi ảnh (trừ ảnh đầu), soi khách có chen tin mới không -> có thì DỪNG, đừng bắn đè tin khách.
      if (i > 0 && await customerSpokeSince(conversationId, _sinceMs)) {
        aborted = true;
        forceRecheckConvs.add(String(conversationId));   // khách chen tin -> ép xử lại lượt sau (đọc lại tin/ảnh khách)
        console.log(`[gallery] KHÁCH nhắn tin MỚI giữa lúc gửi ảnh -> NGỪNG ở ảnh ${i}/${list.length}, nhường lượt sau trả lời tin mới (không đè/trôi tin khách).`);
        break;
      }
      const it = list[i];
      let sent = false;
      if (it.contentId) {
        for (let a = 1; a <= 2 && !sent; a++) {
          try { const r = await _sendInboxContentIds(conversationId, [it.contentId]); const r0 = Array.isArray(r) ? r[0] : r; if (Array.isArray(r)) r.forEach(rememberSentId); else rememberSentId(r); if (r0 && r0.success !== false) { sent = true; sentN++; } }
          catch (_) {}
          if (!sent && a < 2) { try { await delay(300); } catch (_) {} }
        }
      }
      if (!sent && it.url) {
        const u = normDriveUrl(it.url);
        for (let a = 1; a <= 3 && !sent; a++) {
          try { const r = await sendInboxImageUrl(conversationId, u); if (r && r.success !== false) { sent = true; sentN++; } }
          catch (_) {}
          if (!sent && a < 3) { try { await delay(400 * a); } catch (_) {} }
        }
      }
      if (!sent) console.log(`[gallery] 1 ảnh CHẾT (content_id + URL đều fail) | cid:${String(it.contentId || "-").slice(0, 20)} | url:${String(it.url || "-").slice(0, 50)}`);
      try { await delay(220); } catch (_) {}
    }
    if (aborted) console.log("[gallery] (đã ngừng sớm do khách nhắn mới — phần còn lại sẽ KHÔNG bắn tiếp lượt này.)");
  }

  const ok = albumOk || sentN > 0;
  if (!ok) console.log("[gallery] GỬI ẢNH THẤT BẠI (cả content_id lẫn URL).");
  if (ok) { pendingImageResends.delete(String(conversationId)); try { await untagXuLyAnh(conversationId); } catch (_) {} }   // gửi được gallery -> gỡ thẻ AI-XL ảnh

  mem.sentGalleryCodes = [...new Set([...(mem.sentGalleryCodes || []), ...(gallery.codes || [])])];
  for (const c of (gallery.codes || [])) if (!mem.sentImageCodes.includes(c)) mem.sentImageCodes.push(c);
  mem.lastBotReply = gallery.caption || intro || "";
  mem.orderClosed = false;
  console.log(`[${BOT_NAME}] Gửi GALLERY ${gallery.count} mẫu (${gallery.perModel} ảnh/mẫu) | ${ids.length} content_id | ${albumOk ? "ALBUM 1 phát" : `LẺ ${sentN}/${list.length}`} | mã: ${(gallery.codes || []).join(",")}`);
  return ok;
}

// Xử lý KHÁCH DUYỆT MẪU: (a) mẫu tương tự CLIP, (b) theo màu, (c) theo kiểu dáng. Trả true nếu đã xử lý.
async function tryBrowseGallery(conversationId, latestText, mem, productInfo) {
  const _dislikes = dislikesColor(latestText);
  const askColor = _dislikes ? null : extractColor(latestText);   // màu đang bị CHÊ -> KHÔNG dùng để tìm theo màu (tránh gửi lại màu khách không thích)
  const attrs = recommend.extractAttributes(latestText);
  const wantsSimilar = asksSimilarModels(latestText) && !asksOtherColors(latestText);
  const exclude = [...(mem.sentGalleryCodes || []), ...(productInfo ? [String(productInfo.code || "").toUpperCase()] : [])];

  // (n) KHÁCH XIN MẪU MỚI / BST MỚI -> CHỈ lấy mẫu CÓ cột T = "mới" (isNew), KHÔNG lấy bừa mẫu tương tự.
  //     Ưu tiên MGKVX6310 (chiến dịch) ĐẦU danh sách nếu còn hàng.
  if (asksNewCollection(latestText) || mem._aiIntent === "BROWSE_CATALOG") {   // [FIX CRASH] _ai() là closure trong processOneConversation, KHÔNG có ở hàm này -> dùng mem._aiIntent
    try {
      const _cat = await ensureCatalog();
      let _news = (_cat.list || []).filter(p => p && p.isNew && !recommend.isOutOfStock(p));
      for (let i = _news.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [_news[i], _news[j]] = [_news[j], _news[i]]; }
      const _campCode = "MGKVX6310";
      const _camp = (_cat.list || []).find(p => String(p.code || "").toUpperCase().trim() === _campCode && !recommend.isOutOfStock(p));
      const _ordered = _camp
        ? [_camp, ..._news.filter(p => String(p.code || "").toUpperCase().trim() !== _campCode)]
        : _news;
      const gallery = recommend.buildGallery(_ordered, { exclude, maxModels: 10, withPrices: false });
      if (gallery) {
        await sendGallery(conversationId, gallery, mem, "Dạ em gửi chị mấy mẫu mới bên em, chị xem ưng mẫu nào em tư vấn thêm cho mình nha");
        console.log(`[${BOT_NAME}] Khách xin MẪU MỚI -> gửi gallery ${gallery.count} mẫu cột T=mới (MGKVX6310 đầu nếu có).`);
        return true;
      }
      console.log(`[${BOT_NAME}] Khách xin MẪU MỚI nhưng KHÔNG có mẫu cột T=mới nào có ảnh -> để luồng khác lo.`);
    } catch (e) { console.log("[gallery mẫu mới] lỗi:", e.message); }
  }

  // (a) MẪU TƯƠNG TỰ theo mẫu đang xem (CLIP) — khi KHÔNG nêu màu/kiểu cụ thể
  if (wantsSimilar && productInfo && productInfo.code && !askColor && !attrs.length) {
    try {
      const sims = await similarByCode(productInfo.code, 30);
      const cat = await ensureCatalog();
      const prods = sims.map(s => cat.byCode.get(String(s.code).toUpperCase())).filter(Boolean);
      const gallery = recommend.buildGallery(prods, { exclude, maxModels: 10, withPrices: false });
      if (gallery) {
        await sendGallery(conversationId, gallery, mem, "Dạ em gửi chị vài mẫu tương tự để mình tham khảo nha");
        return true;
      }
    } catch (e) { console.log("[gallery] similar lỗi:", e.message); }
    return false; // không có -> để luồng cũ (nhờ NV)
  }

  // (b) THEO MÀU (kèm kiểu nếu có): "có váy màu đỏ?", "thích hồng có mẫu nào", "váy đỏ dài tay"
  if (askColor) {
    try {
      let prods = await recommend.findByColor(askColor, null, productInfo || null);
      if (attrs.length) {
        const a = await recommend.findByAttribute(latestText);
        const ok = new Set(a.products.map(p => String(p.code).toUpperCase()));
        prods = prods.filter(p => ok.has(String(p.code).toUpperCase()));
      }
      const gallery = recommend.buildGallery(prods, { color: askColor, exclude, maxModels: 10, withPrices: false, colorFallback: true });
      if (gallery) {
        const kieu = attrs.length ? (" " + attrs.map(x => x.canon).join(", ")) : "";
        // DUYỆT MÀU: gửi ẢNH trước, KHÔNG báo giá (chỉ báo giá khi khách đi sâu vào 1 mẫu)
        await sendGallery(conversationId, gallery, mem, `Dạ bên em có mấy mẫu${kieu} màu ${askColor.toLowerCase()} này, chị xem ưng mẫu nào em báo giá chi tiết nha`);
        return true;
      }
    } catch (e) { console.log("[gallery] color lỗi:", e.message); }
    return false;
  }

  // (c) THEO KIỂU (không màu): "váy dài tay", "đầm 2 dây"
  if (attrs.length) {
    try {
      const a = await recommend.findByAttribute(latestText);
      const gallery = recommend.buildGallery(a.products, { exclude, maxModels: 10, withPrices: false });
      if (gallery) {
        await sendGallery(conversationId, gallery, mem, `Dạ em gửi chị mấy mẫu ${attrs.map(x => x.canon).join(", ")} nha`);
        return true;
      }
    } catch (e) { console.log("[gallery] attr lỗi:", e.message); }
    return false;
  }
  return false;
}

// FIX #3: khi CHƯA biết màu cho mẫu (khách KHÔNG gửi ảnh nhận màu, KHÔNG xin màu, chưa có màu nguồn)
// -> đọc MÀU trong CAPTION ads (vd "Sắc hồng phấn") bằng extractColor (THUẦN REGEX, KHÔNG gọi AI/vision).
// Chỉ ghi nếu mẫu CÓ ẢNH đúng màu đó -> maybeSendImages gửi ĐÚNG màu thay vì ĐỦ MÀU.
// LUÔN nhường màu của KHÁCH (ảnh khách gửi / khách xin) — chỉ "động tới ad gốc" khi khách không cho tín hiệu màu nào.
function ensureSourceColorFromCaption(mem, code, captionText) {
  // ĐÃ TẮT (yêu cầu shop): CAPTION ad CHỈ để nhận diện MẪU, KHÔNG dùng nhận diện MÀU.
  // Không đọc màu từ chữ caption nữa. Màu nguồn chỉ đến từ ẢNH ad (vision) / ảnh khách / khách xin màu.
  // Không nhận ra màu -> maybeSendImages gửi ĐỦ màu (đúng quy tắc). (Lỗi cũ: caption "trang phục/trang nhã" -> tưởng AD 1 màu Trắng -> gửi thiếu màu.)
  return;
}

// Gửi ảnh 1 mã - chỉ gửi nếu CHƯA gửi bao giờ, hoặc khách yêu cầu xem.
// leadText (tùy chọn): GỬI KÈM CHỮ trong CÙNG message với album (chống #551 ở lead comment/ads).
// ===== MÃ CHIẾN DỊCH: đang chạy QC 1 màu cố định -> MẶC ĐỊNH gửi đúng màu này khi khách KHÔNG xin màu khác. =====
// (KHÔNG áp chung mọi mã; CHỈ các mã liệt kê dưới đây.) Thêm mã chiến dịch mới: "<MÃ>": "<màu>".
const CAMPAIGN_DEFAULT_COLOR = { "MRAD5171": "xanh nhạt" };
async function maybeSendImages(conversationId, code, mem, force, leadText) {
  const _imgT0 = Date.now();   // mốc thời gian: gửi ảnh chậm (>4s, vd gửi TỪNG tấm) -> khách dễ chen tin -> ép xử lại lượt sau
  // CHỐNG LOẠN ẢNH: đã gửi ảnh trong hội thoại rồi (kể cả trước RESTART) + KHÔNG phải báo giá/khách-xin-ảnh/khách-vừa-gửi-ảnh
  //  -> KHÔNG tự gửi lại. (Khách hỏi size/form/màu/chất... -> chỉ trả CHỮ, không dump ảnh.) Chặn TRƯỚC mọi force.
  if (mem && mem._imgShownBefore && !mem._imgAllowSend) {
    console.log(`IMG ${code}: ĐÃ gửi ảnh trong hội thoại -> KHÔNG gửi lại (không phải báo giá/khách xin ảnh).`);
    if (leadText) { try { await _sendInboxMessage(conversationId, leadText); } catch (_) {} }
    return;
  }
  if (!force && mem.sentImageCodes.includes(code)) {
    console.log(`IMG ${code}: đã gửi trước đó -> bỏ qua`);
    if (leadText) { try { await _sendInboxMessage(conversationId, leadText); } catch (_) {} }
    return;
  }
  // [FIX Đặng Vân] CHỐNG ẢNH LẶP TRONG 1 LƯỢT: cùng mã đã gửi ảnh ở lượt NÀY rồi -> KHÔNG gửi lại (kể cả force).
  //   (Lỗi cũ: path chào/ad gửi ảnh, path báo-giá force=true gửi lại y chang -> khách thấy ảnh 2 lần.)
  //   Marker theo lượt (_turnCtx._imgSentCodes, reset mỗi lượt) -> lượt SAU vẫn gửi lại bình thường.
  if (_turnCtx && _turnCtx.convId === conversationId && _turnCtx._imgSentCodes
      && _turnCtx._imgSentCodes.has(String(code || "").toUpperCase())) {
    console.log(`IMG ${String(code || "").toUpperCase()}: đã gửi ảnh ở LƯỢT NÀY -> KHÔNG gửi lại (chống lặp trong lượt).`);
    if (leadText) { try { await _sendInboxMessage(conversationId, leadText); } catch (_) {} }
    return;
  }
  // CHẶN gửi ảnh mẫu HẾT HÀNG (cột E = HẾT HÀNG) - không dùng ảnh mẫu hết để tư vấn.
  try {
    const cat = await ensureCatalog();
    const p = cat.byCode.get(String(code || "").toUpperCase());
    if (p && recommend.isOutOfStock(p)) { console.log(`IMG ${code}: HẾT HÀNG -> không gửi ảnh.`); if (leadText) { try { await _sendInboxMessage(conversationId, leadText); } catch (_) {} } return false; }
  } catch (_) {}

  const C = String(code || "").toUpperCase();
  let items3 = [];
  let color = null, matchedId = null;   // dùng cả NGOÀI block dưới (log/gắn màu, scheduleImageResend) -> phải ở phạm vi hàm
  let _allColorItems = null;            // KHÔNG có tín hiệu màu + mẫu nhiều màu -> gửi ĐỦ MÀU (2 ảnh/màu)
  // LUÔN gửi ảnh CATALOG full-res (content_id Pancake / Drive =w1600). KHÔNG dùng URL ảnh ngoài
  // (creative FB...) vì các URL đó hay là thumbnail bé -> khách nhận ảnh nhỏ xíu.
  {
    const visionColor = (mem.colorByCode || {})[C] || null;        // màu khách GỬI ẢNH (đọc tên file ảnh khớp)
    const reqColor = mem.askedImageColor || null;                  // màu khách XIN bằng chữ lượt này
    const sourceColor = (mem.sourceColorByCode || {})[C] || null;  // màu Ở BÀI ADS/COMMENT khách đến từ đó
    // Ưu tiên TÍN HIỆU CỦA KHÁCH (ảnh khách gửi / khách xin màu) trước; KHÁCH KHÔNG nói gì -> theo MÀU BÀI ĐĂNG.
    color = visionColor || reqColor || sourceColor;
    // [MÃ CHIẾN DỊCH] Mã đang chạy QC 1 màu cố định -> MẶC ĐỊNH gửi đúng màu đó khi khách KHÔNG có
    //  tín hiệu màu (không gửi ảnh màu khác + không xin màu khác bằng chữ). Khách xin màu khác -> tôn trọng.
    //  RIÊNG mã chiến dịch (bảng CAMPAIGN_DEFAULT_COLOR), KHÔNG áp chung mọi mã.
    let _campaignForced = false;
    if (CAMPAIGN_DEFAULT_COLOR[C] && !visionColor && !reqColor) {
      color = CAMPAIGN_DEFAULT_COLOR[C];
      _campaignForced = true;   // ép màu chiến dịch -> KHÔNG ghim ảnh khách chụp (giữ THUẦN màu chiến dịch)
      console.log(`IMG ${C}: MÃ CHIẾN DỊCH -> mặc định màu "${color}" (khách chưa xin màu khác).`);
    }
    // STRICT (cấm gửi sai màu) CHỈ khi khách XIN màu bằng chữ. Màu bài đăng -> KHÔNG strict (thiếu thì fallback).
    let strict = !!reqColor && !visionColor;
    if (strict) {
      let _hasReqColor = false;
      try { _hasReqColor = (imageItemsByColor(C, reqColor, 1, false) || []).length > 0; } catch (_) {}
      if (!_hasReqColor) {
        console.log(`IMG ${C}: khách xin màu "${reqColor}" nhưng mẫu KHÔNG có ảnh màu đó -> gửi ảnh mặc định (đủ 3).`);
        strict = false;
      }
    }
    matchedId = (mem.matchedImgByCode || {})[C] || null;     // tấm ảnh khớp nhất -> chắc chắn đúng mẫu+màu
    // Ảnh đúng màu trước; nếu khách XIN MÀU cụ thể -> KHÔNG fallback sang màu khác (thà không gửi).
    let items = imageItemsByColor(C, color, 3, /*colorFallback*/ !strict);   // [{contentId,url}]
    if (!strict && items.length < 3) {
      const more = imageItemsByColor(C, null, 3, false);
      const seen = new Set(items.map(i => i.contentId || i.url));
      for (const m of more) {
        const key = m.contentId || m.url;
        if (key && !seen.has(key)) { items.push(m); seen.add(key); if (items.length >= 3) break; }
      }
    }
    let contentIds = items.map(it => it.contentId).filter(Boolean);
    let fileUrls = items.map(it => it.url).filter(Boolean);
    if (!strict && !_campaignForced) {   // [MÃ CHIẾN DỊCH] đã ép màu -> KHÔNG ghim ảnh khách chụp (giữ thuần màu chiến dịch)
      const mC = matchedId ? contentIdByImageId(matchedId) : null;
      const mU = matchedId ? urlByImageId(matchedId) : null;
      if (mC) contentIds = [mC, ...contentIds.filter(x => x !== mC)].slice(0, 3);
      if (mU) fileUrls = [mU, ...fileUrls.filter(x => x !== mU)].slice(0, 3);
    }
    if (strict && !contentIds.length && !fileUrls.length) {
      console.log(`IMG ${C}: khách xin màu "${reqColor}" nhưng KHÔNG có ảnh gắn màu đó -> KHÔNG gửi (tránh sai màu).`);
      if (leadText) { try { await _sendInboxMessage(conversationId, leadText); } catch (_) {} }
      return false;
    }
    if (!contentIds.length && !fileUrls.length) { console.log("IMG: không có ảnh cho mã", C); if (leadText) { try { await _sendInboxMessage(conversationId, leadText); } catch (_) {} } return; }
    for (let i = 0; i < 3; i++) {
      const u = fileUrls[i] || null, c = contentIds[i] || null;
      if (u || c) items3.push({ url: u, contentId: c });
    }
    // CHỈ gửi ĐỦ MÀU khi khách XIN RÕ (vd "cho xem hết màu"). KHÔNG tự bung đủ màu khi thiếu tín hiệu màu:
    // bài ad/comment LUÔN có ảnh bìa 1 màu -> gửi đúng màu bìa (ảnh đầu mẫu) là khớp bài. Tự bung đủ màu gây loạn.
    // (lỗi Hảo Hảo: bấm ad Giannal 1 màu hồng, KHÔNG xin màu -> bot dội 6 màu/10 ảnh. Sai nguyên tắc.)
    if (mem._wantAllColors && !color && !strict && !(mem.orderColorByCode && mem.orderColorByCode[C])) {
      const _cols = getCodeColors(C) || [];
      if (_cols.length >= 2) {
        const _all = [], _seen = new Set();
        for (const cc of _cols) {
          const its = (imageItemsByColor(C, cc, 2, false) || []).slice(0, 2);
          for (const it of its) {
            const key = it.contentId || it.url;
            if (key && !_seen.has(key)) { _seen.add(key); _all.push(it); }
          }
        }
        if (_all.length > items3.length) _allColorItems = _all;
      }
    }
  }
  // CÓ leadText -> chữ đi CÙNG album trong 1 message (chống #551).
  let sres;
  if (_allColorItems && _allColorItems.length) {
    // Gửi ĐỦ MÀU theo từng cụm 3 ảnh (leadText đi với cụm đầu).
    let _n = 0, _anyOk = false, _txt = false, _na = false;
    for (let i = 0; i < _allColorItems.length; i += 3) {
      const chunk = _allColorItems.slice(i, i + 3);
      const lt = (i === 0) ? leadText : null;
      const r = await sendImages3(conversationId, chunk, lt);
      _n += (r.n || 0);
      if (r.ok || (r.n || 0) > 0) _anyOk = true;
      if (lt && (r.textSent || r.ok)) _txt = true;
      if (r.notAvailable) { _na = true; break; }   // khách không có mặt -> dừng, để lớp dưới hẹn gửi lại
    }
    sres = { ok: _anyOk, n: _n, textSent: _txt, notAvailable: _na && !_anyOk };
    try { mem._sentAllColorsFor = C; } catch (_) {}   // đã cho khách xem ĐỦ MÀU -> lúc chốt PHẢI hỏi "lấy màu nào"
    console.log(`IMG ${C}: gửi ĐỦ MÀU ${getCodeColors(C).length} màu (2 ảnh/màu) -> ${_n} tấm.`);
  } else {
    sres = await sendImages3(conversationId, items3, leadText);
  }
  // ===== BÙ ẢNH: gửi THIẾU (vd ảnh GHIM chiến dịch chết cả content_id lẫn URL) -> lấy ảnh CÙNG MÀU
  // khác bù cho ĐỦ, KHÔNG bỏ trống. Chỉ áp dụng luồng 1-màu (items3); luồng ĐỦ MÀU đã gửi nhiều ảnh.
  if (!_allColorItems && !(sres && sres.notAvailable)) {
    const _want = Math.min(3, (items3 && items3.length) || 0);
    let _have = (sres && sres.n) ? sres.n : 0;
    if (_have < _want && _want > 0) {
      const _used = new Set((items3 || []).map(i => i.contentId || i.url).filter(Boolean));
      const _spare = [];
      try {
        // ƯU TIÊN bù ĐÚNG MÀU đang gửi (vd hồng). Lấy rộng ra rồi loại các tấm ĐÃ thử (ghim chết).
        for (const it of (imageItemsByColor(C, color, 10, /*colorFallback*/ false) || [])) {
          const key = it && (it.contentId || it.url);
          if (key && !_used.has(key) && !_spare.some(s => (s.contentId || s.url) === key)) _spare.push(it);
        }
      } catch (_) {}
      const _snap = (typeof conversationId === "string" && lastCustomerMsgAt.get(conversationId)) || 0;
      const _spoke = () => _snap > 0 && (lastCustomerMsgAt.get(conversationId) || 0) > _snap;
      for (const sp of _spare) {
        if (_have >= _want) break;
        if (_spoke()) { try { forceRecheckConvs.add(String(conversationId)); } catch (_) {} break; }   // khách chen tin -> dừng bù
        const r = await sendImages3(conversationId, [sp], null);
        const _n = (r && r.n) ? r.n : 0;
        if (_n > 0) {
          _have += _n; _used.add(sp.contentId || sp.url);
          try { console.log(`  [ảnh BÙ] 1 tấm lỗi -> thay bằng ảnh ${color || "cùng mẫu"} khác (đủ ${_have}/${_want}).`); } catch (_) {}
        }
        try { await delay(250); } catch (_) {}
      }
      if (sres) { sres.n = _have; if (_have > 0) sres.ok = true; }
    }
  }
  // GỬI ĐƯỢC ÍT NHẤT 1 TẤM = coi như thành công (khách đã có ảnh) -> gỡ thẻ + trả true,
  // tránh ADS/§13 gắn lại AI-XL ảnh dù khách đã nhận được ảnh.
  const ok = sres.ok || (sres.n || 0) > 0;
  const r0 = null;
  // [SỬA 2026-08-09 theo lệnh] #551 KHÁCH KHÔNG CÓ MẶT (khách chỉ-comment, thread chưa mở - đấm mấy lần
  // cũng vô ích): GỬI ĐÚNG 1 LẦN, fail -> gắn thẻ AI-XL ảnh rồi BUÔNG, đi xử việc khác. KHÔNG hẹn
  // 10p/30p/1h nữa. Lưới cũ vẫn giữ: khách nhắn inbox (cửa sổ mở) -> luồng inbox tự gửi ảnh + TỰ GỠ thẻ.
  if (!ok && sres.notAvailable) {
    pendingImageResends.delete(String(conversationId));
    try { await tagXuLyAnhVaUnread(conversationId); } catch (_) {}
    console.log(`IMG ${C}: khách KHÔNG CÓ MẶT (#551) -> gắn thẻ AI-XL ảnh, KHÔNG hẹn lại (khách nhắn inbox sẽ tự gửi + gỡ thẻ).`);
    return false;
  }
  console.log(`IMG ${C}: gửi ${sres.n || 0} ảnh (màu: ${color || "-"}) -> ${ok ? "OK" : "VẪN LỖI"}.`);
  if (ok) {
    pendingImageResends.delete(String(conversationId));
    try { await untagXuLyAnh(conversationId); } catch (_) {}   // GỬI ĐƯỢC ẢNH -> luôn TỰ GỠ thẻ AI-XL ảnh (184)
    if (!mem.sentImageCodes.includes(code)) mem.sentImageCodes.push(code);
    if (_turnCtx && _turnCtx.convId === conversationId && _turnCtx._imgSentCodes) _turnCtx._imgSentCodes.add(C);   // [Đặng Vân] đánh dấu đã gửi mã này trong lượt
    mem.lastShownCode = C; mem.lastShownAt = Date.now();   // NHỚ mẫu của bộ ẢNH GẦN NHẤT đã hiện -> follow-up "có màu khác/size" bám đúng mẫu này
    if (_allColorItems) {
      // Đã gửi ĐỦ MÀU -> KHÔNG chốt 1 màu mặc định; đánh dấu để lúc chốt HỎI "lấy màu nào".
      mem.multiColorInterest = C;
    } else {
      try { const rc = color || representativeColor(C); if (rc) { mem.lastSentImageColor = rc; mem.lastSentColorByCode = Object.assign({}, mem.lastSentColorByCode || {}, { [C]: rc }); mem._sentImgColors = Array.from(new Set([...(mem._sentImgColors || []), rc])); } } catch (_) {}
    }
    console.log(`IMG ${C}: gửi ảnh -> OK (màu: ${_allColorItems ? "ĐỦ MÀU" : (color || "-")}, khớp: ${matchedId ? "có" : "-"}). ĐÍCH: ${conversationId}`);
    // Gửi ảnh CHẬM (>4s, vd content_id lỗi -> gửi TỪNG tấm): khách có thể đã chen tin TEXT trong lúc gửi mà
    // bot không poll kịp -> ép xử lại 1 lượt. Vòng sau batchNew (lọc theo messageId) sẽ trả nốt tin chưa xử;
    // không có tin mới -> vô hại (1 lần đọc thừa, cờ tự xoá ở đầu processOneConversation).
    try { if (Date.now() - _imgT0 > 4000) forceRecheckConvs.add(String(conversationId)); } catch (_) {}
  } else {
    console.log(`IMG ${C}: GỬI ẢNH LỖI (cả content_id lẫn URL) -> ĐÍCH: ${conversationId} | PHẢN HỒI:`, JSON.stringify(r0));
  }
  return ok;
}

async function sendBlocks(conversationId, products, mem, force, priceAsk) {
  mem.pricedCodes = mem.pricedCodes || [];
  const _blkSnap = lastCustomerMsgAt.get(conversationId) || 0;
  for (const [bi, p] of products.entries()) {
    // Khách CHEN tin mới giữa lúc đang báo giá nhiều mẫu -> DỪNG các mẫu còn lại, nhường vòng sau xử tin mới.
    if (bi > 0 && _blkSnap > 0 && (lastCustomerMsgAt.get(conversationId) || 0) > _blkSnap) {
      forceRecheckConvs.add(String(conversationId));   // khách chen tin -> ép xử lại lượt sau
      console.log(`[block] khách vừa nhắn tin MỚI -> NGỪNG báo nốt ${products.length - bi} mẫu còn lại, nhường vòng sau.`);
      break;
    }
    const label = productLabel(p);
    const k = String(p.code || "").toUpperCase();
    // MẪU HẾT HÀNG (cột E = HẾT HÀNG) -> KHÔNG báo giá, KHÔNG gửi ảnh; báo hết 1 lần.
    if (recommend.isOutOfStock(p)) {
      if (mem.outOfStockNotifiedFor !== k) {
        await sendInboxMessage(conversationId, `Dạ ${label} hiện bên em hết hàng rồi ạ`);
        mem.outOfStockNotifiedFor = k;
      }
      console.log(`[block] ${k} HẾT HÀNG -> bỏ báo giá/gửi ảnh.`);
      continue;
    }
    // MỞ chỉ 1 LẦN/mẫu: mẫu ĐÃ báo giá trong 24h -> KHÔNG báo giá lại (trừ khi khách HỎI LẠI GIÁ).
    //   Vẫn đảm bảo có ảnh để khách xem, nhưng KHÔNG lặp câu giá.
    if (quotedRecently(mem, k) && !priceAsk) {
      console.log(`[block] ${k} đã báo giá 24h -> KHÔNG báo giá lại (chỉ gửi ảnh nếu cần).`);
      await maybeSendImages(conversationId, p.code, mem, !!force);
      continue;
    }
    // KỊCH BẢN §13 (ĐẢO THỨ TỰ): mỗi mẫu -> gửi ẢNH TRƯỚC rồi mới BÁO GIÁ (LẦN ĐẦU của mẫu đó).
    // force = true -> gửi ảnh kể cả mã này đã gửi ảnh trước đó.
    await maybeSendImages(conversationId, p.code, mem, true);
    if (p.priceText) {
      await sendInboxMessage(conversationId, `Dạ ${label} ${p.priceText} ạ.`);
    } else if (priceIsValid(p.price)) {
      await sendInboxMessage(conversationId, `Dạ ${label} giá ${formatPrice(p.price)} ạ.`);
    } else {
      await sendInboxMessage(conversationId, `Dạ ${label} em gửi chị xem ạ, giá em báo lại chị ngay nha.`);
      console.log("GIÁ LỖI cho mã", p.code, "=", p.price);
    }
    markPriced(mem, k);
    // GIÃN NHỊP giữa các mẫu: gửi nhiều mẫu dồn dập -> Pancake rate-limit -> ALBUM rớt.
    // Nghỉ 1 nhịp trước mẫu kế (không nghỉ sau mẫu cuối).
    if (bi < products.length - 1) { try { await delay(1000); } catch (_) {} }
  }
}

// Tìm sản phẩm từ BÀI POST của comment: ưu tiên tên trong caption, không ra thì vision ảnh bài.
// MÀU của ẢNH NGUỒN (bài ads / bài comment) cho 1 MÃ — vision đọc tên file ảnh khớp.
// CHỈ nhận màu khi vision khớp ĐÚNG mã đang xét (tránh ảnh ghép nhiều mẫu lấy nhầm màu mẫu khác).
// Đọc MÀU từ caption/tên ad NHƯNG chỉ nhận khi màu đó là MÀU THẬT của mẫu vừa ra (lọc qua getCodeColors).
// -> Khôi phục ca hợp lệ ("Set Miretta ... Kem") mà KHÔNG dính false-positive kiểu "NÀNG ĐANG TÌM" -> "Tím"
//    (vì "Tím" không nằm trong danh sách màu của mẫu -> bị loại). Trả về TÊN MÀU CHUẨN của mẫu, hoặc "".
function colorFromAdTextForModel(text, code) {
  try {
    const c = extractColor(String(text || ""));
    if (!c) return "";
    const cols = getCodeColors(code) || [];
    for (const mc of cols) {
      if (colorMatches(c, mc) || colorMatches(mc, c)) return mc;
    }
  } catch (_) {}
  return "";
}
async function sourceColorForCode(images, code) {
  const C = String(code || "").toUpperCase();
  if (!C) return "";
  for (const url of (images || []).slice(0, 3)) {
    try {
      const r = await resolveImageRetry(url, 1);
      if (r?.ok && r.color && String(r.code || "").toUpperCase() === C) return r.color;
    } catch (_) {}
  }
  return "";
}
// Như sourceColorForCode nhưng trả CẢ imageId của tấm catalog KHỚP ảnh bìa ad -> để NEO gallery
// vào đúng tấm đó (dẫn ảnh bằng ĐÚNG màu bìa) kể cả khi KHÔNG đọc được TÊN màu (ca kem/trắng-kem).
async function sourceColorAndImgForCode(images, code) {
  const C = String(code || "").toUpperCase();
  if (!C) return { color: "", imageId: null };
  for (const url of (images || []).slice(0, 3)) {
    try {
      const r = await resolveImageRetry(url, 1);
      if (r?.ok && String(r.code || "").toUpperCase() === C) return { color: r.color || "", imageId: r.imageId || null };
    } catch (_) {}
  }
  return { color: "", imageId: null };
}

// Trả { product, color, imageId } | null. color = MÀU ở ẢNH BÀI ĐĂNG (để gửi lại ảnh CÙNG màu bài).
async function resolveProductFromPost(caption, images) {
  let product = null;
  try {
    const byText = caption ? await findInText(caption) : [];
    if (byText && byText.length) product = byText[0];
  } catch (_) {}
  let color = "", imageId = null;
  if (product) {
    // Đã ra mẫu qua CHỮ -> chỉ soi NHẸ ảnh bài để lấy đúng MÀU bài (1 lần/ảnh, tối đa 2 ảnh).
    const C = String(product.code || "").toUpperCase();
    for (const url of (images || []).slice(0, 2)) {
      try {
        const r = await resolveImageRetry(url, 1);
        if (r?.ok && r.color && String(r.code || "").toUpperCase() === C) { color = r.color; imageId = r.imageId || null; break; }
      } catch (_) {}
    }
  } else {
    // Chưa ra mẫu qua chữ -> vision đọc ảnh để ra mẫu + màu.
    for (const url of (images || []).slice(0, 3)) {
      try {
        const r = await resolveImageRetry(url, 2);
        if (!(r?.ok && r?.product)) continue;
        product = r.product;
        if (r.color && String(r.code || "").toUpperCase() === String(product.code || "").toUpperCase()) { color = r.color; imageId = r.imageId || null; }
        break;
      } catch (_) {}
    }
  }
  if (!product) return null;
  return { product, color, imageId };
}

// Mẫu CÓ KHUYẾN MÃI THẬT? -> CHỈ khi Giá Khuyến Mãi > 0 (cột KM = 0 / rỗng = KHÔNG có khuyến mãi).
// Có thêm chặn KM >= gốc (không phải giảm thật) cho chắc.
function isOnSale(p) {
  if (!p) return false;
  const goc = parseInt(String(p.originalPrice || "").replace(/[^\d]/g, ""), 10);
  const km  = parseInt(String(p.salePrice || "").replace(/[^\d]/g, ""), 10);
  if (!km || km <= 0) return false;       // KM = 0 / rỗng -> KHÔNG có khuyến mãi
  if (goc && km >= goc) return false;     // KM >= giá gốc -> không phải giảm thật
  return true;
}
// Khách muốn XEM/DUYỆT các MẪU đang giảm giá (cột K>0). KHÁC asksDiscount ("xin giảm cho mẫu đang xem").
function asksShowSaleItems(text) {
  const t = String(text || "").toLowerCase();
  if (!/(giảm giá|đang giảm|giảm sâu|\bsale\b|khuyến mãi|khuyến mại|ưu đãi|đang hạ giá|hạ giá)/.test(t)) return false;
  if (/(mẫu này|cái này|bộ này|cái đó|cái kia)\s*(có |đang |được )?(giảm|sale|bớt|ưu đãi)/.test(t)) return false;   // xin giảm mẫu đang xem
  if (/(bớt|fix|giảm thêm|giảm nữa|giảm cho (c|chị|e|em|mình)|mặc cả)/.test(t) && !/(mẫu|đồ|hàng|sản phẩm)\s*(nào|gì|đang|được|sale|giảm)/.test(t)) return false;
  return /(xem|coi|gửi|cho (mình|em|c|chị|t)\s*(xem|coi)|liệt kê|biết|tham khảo|những|các)\s*[^.?!]{0,18}(mẫu|đồ|hàng|sản phẩm|sale|giảm|khuyến mãi|ưu đãi)/.test(t)
      || /(mẫu|đồ|hàng|sản phẩm|váy|đầm|bộ|cái)\s*(nào |gì |đang |được |có )*(đang )?(giảm giá|giảm|sale|khuyến mãi|ưu đãi)/.test(t)
      || /(có )?(mẫu|đồ|hàng|sản phẩm) (nào )?(đang |được )?(giảm|sale|khuyến mãi|ưu đãi)/.test(t)
      || /(đang )?(giảm giá|sale|khuyến mãi|ưu đãi)\s*(mẫu|đồ|hàng|những|cái nào|gì|nào)/.test(t);
}
// Câu mở màn gửi RIÊNG cho khách vừa bình luận (mẫu + giá + size), theo §5/§9.
function priceLine(p) {
  if (!p) return "";
  const sale = String(p.salePrice || "").trim();
  const hasSale = priceIsValid(sale) && sale !== "0" && sale.toLowerCase() !== "null";
  // [FIX 2026-07] GIÁ GỐC phải lấy từ originalPrice (cột H): trường p.price trong catalog là GIÁ ĐỂ CHỐT
  // (= KM khi có KM, cho COD đúng) -> lấy p.price làm gốc là ra "có giá 445k, đang giảm còn 445k"!
  const gocRaw = String(p.originalPrice || p.price || "").trim();
  const gocOk = priceIsValid(gocRaw);
  // [SALE GỌN phom GIÁ GỐC 2026-07] Riêng đợt KM này: câu giá CHỈ nêu GIÁ GỐC + câu chương trình,
  // KHÔNG công bố số-sau-giảm (giảm 50% với đơn THANH TOÁN TRƯỚC — giá cuối do người thật chốt theo
  // hình thức thanh toán). Áp cho MỌI mẫu (kể cả cột K trống), xét TRƯỚC priceText.
  try {
    const _sgG = saleProgram(_curPageId);
    if (_sgG && _sgG.che_do_sale_gon && _sgG.cau_kem_bao_gia && gocOk) {
      return `có giá ${formatPrice(gocRaw)} ạ.\n${_sgG.cau_kem_bao_gia}`;
    }
  } catch (_) {}
  // [SALE GỌN] xét chế độ sale TRƯỚC priceText: mẫu có câu-giá-thô trong sheet cũng phải theo phom chương trình
  if (p.priceText && !(hasSale && gocOk)) return p.priceText;
  // [GUARD GIÁ 2026-07] giá gốc <= giá KM (dữ liệu sheet nhầm) -> câu "đang giảm còn" vô nghĩa: 1 giá + cảnh báo.
  const _numOf = (v) => Number(String(v || "").replace(/[^0-9]/g, "")) || 0;
  if (hasSale && gocOk && _numOf(sale) >= _numOf(gocRaw)) {
    console.log(`[KM GIÁ GỐC SAI] mẫu ${p.code || p.name || "?"}: giá gốc ${gocRaw} <= giá KM ${sale} -> kiểm tra sheet (cột H phải là giá cũ, cột K giá giảm). Tạm báo 1 giá.`);
    try {
      const _sg1 = saleProgram(_curPageId);
      if (_sg1 && _sg1.che_do_sale_gon && _sg1.cau_kem_bao_gia) return `có giá ${formatPrice(sale)} chị nha 🥰\n${_sg1.cau_kem_bao_gia}`;
    } catch (_) {}
    return `giá ${formatPrice(sale)}`;
  }
  if (hasSale && gocOk) {
    // [SALE GỌN 2026-07] câu báo giá theo chương trình (khuyen_mai.json, tự tắt khi hết hạn/gạt cờ):
    // "Dạ mẫu {tên} có giá {gốc}, đang giảm còn {sale} chị nha 🥰 {câu chương trình} ạ. {Đuôi}"
    try {
      const _sg = saleProgram(_curPageId);
      if (_sg && _sg.che_do_sale_gon && _sg.cau_kem_bao_gia) {
        return `có giá ${formatPrice(gocRaw)}, đang giảm còn ${formatPrice(sale)} chị nha 🥰\n${_sg.cau_kem_bao_gia}`;
      }
    } catch (_) {}
    if (p.priceText) return p.priceText;   // ngoài chế độ sale: giữ nguyên hành vi gốc (câu thô sheet ưu tiên)
    return `giá gốc ${formatPrice(gocRaw)}, hiện đang ưu đãi còn ${formatPrice(sale)}`;
  }
  if (gocOk) return `giá ${formatPrice(gocRaw)}`;
  if (hasSale) return `giá ${formatPrice(sale)}`;
  return "";
}
// Các CÂU HÀNH ĐỘNG khi đã biết size -> dạng CÂU HỎI mời nhẹ (không khẳng định "em lên đơn" kẻo chốt vội).
const _ORDER_ACTIONS = [
  s => `Em lên đơn ${s} cho mình nha chị?`,
  s => `Em lên đơn ${s} cho chị luôn nha?`,
  s => `Mẫu này ${s} mặc lên rất tôn dáng ạ, em lên đơn cho mình nha chị?`,
  s => `Em lên đơn ${s} gửi về cho mình nha chị?`,
  s => `${s.charAt(0).toUpperCase() + s.slice(1)} của chị mặc form này đẹp lắm ạ, em lên đơn cho mình nha chị?`
];
function orderActionLine(mem, sizeRaw) {
  const s = sizeLabel(sizeRaw);
  mem.actionIdx = ((mem.actionIdx || 0) + 1) % _ORDER_ACTIONS.length;
  return _ORDER_ACTIONS[mem.actionIdx](s);
}

// Lời KHEN sản phẩm — đổi luân phiên cho đỡ lặp "tôn dáng" liên tục (Bảo Trâm nói tự nhiên hơn).
const _PRAISES = [
  "mặc lên rất tôn dáng",
  "mặc lên đẹp lắm",
  "lên phom rất đẹp",
  "mặc lên sang lắm",
  "khoe dáng rất khéo",
  "mặc lên nhẹ nhàng nữ tính",
  "lên dáng cực cuốn"
];
function praise(mem) {
  mem.praiseIdx = ((mem.praiseIdx || 0) + 1) % _PRAISES.length;
  return _PRAISES[mem.praiseIdx];
}

// Câu dẫn về size. KHÔNG liệt kê các size đang có ra cho khách (theo §7 — chỉ tập trung size khách quan tâm).
function sizeTailForProduct(mem, product) {
  const avail = parseAvailableSizes(product && product.size);
  // ĐÃ CÓ size + mẫu CÓ đúng size đó -> theo NGUYÊN TẮC 3 BẬC (luật shop):
  //  - Đủ size NHƯNG thiếu sđt/địa chỉ -> "Chị cho em xin số điện thoại và địa chỉ để em lên đơn cho mình ạ"
  //    (KHÔNG nói "em lên đơn cho mình nha" suông khi chưa có sđt+địa chỉ - Thanh Duy: có size M mà bot mời lên đơn).
  //  - Đủ size + sđt + địa chỉ -> mới mời "Em lên đơn cho mình nha chị?".
  if (mem.customerSize && (avail.size === 0 || avail.has(mem.customerSize))) {
    mem.orderInvited = true;   // báo giá đã kèm câu mời/xin -> KHÔNG follow-up mời lại (tránh lặp)
    const _addrOk = addrReady(mem);
    const _missing = [];
    if (!mem.phone) _missing.push("số điện thoại");
    if (!_addrOk) _missing.push("địa chỉ");
    if (_missing.length) {
      // CHƯA đủ liên hệ -> XIN sđt+địa chỉ (không mời "em lên đơn cho mình nha" khi chưa có gì để lên đơn).
      return ` Chị cho em xin ${joinVi(_missing)} để em lên đơn ${sizeLabel(mem.customerSize)} cho mình nha ạ`;
    }
    // Đủ size + sđt + địa chỉ -> mới mời chốt.
    return " " + orderActionLine(mem, mem.customerSize);
  }
  // Mẫu chỉ FREESIZE -> VẪN CÓ CÂU ĐUÔI (yêu cầu shop). TUYỆT ĐỐI không đọc size S/M/L của khách ra.
  if (avail.size === 1 && avail.has("FREESIZE")) {
    const noBody = !mem.weightKg && !mem.measure3V;
    // (a) CHƯA biết khách mặc gì / khách L+ mà chưa có cân nặng -> xin cao+nặng để tư vấn size.
    if ((!mem.customerSize && noBody) || (freesizeNeedsWeightCheck(mem) && noBody)) {
      return " Dạ chị cho em xin chiều cao và cân nặng để em tư vấn size cho mình nha ạ";
    }
    // (b) Khách mặc VỪA freesize (S/M hoặc đã có cân nặng/số đo) -> trấn an + phần liên hệ:
    //     chưa đủ sđt/địa chỉ -> "Chị ưng sản phẩm cho em xin..."; đủ -> mời lên đơn.
    mem.orderInvited = true;
    const _cta = (mem && mem.phone && mem.address)
      ? "Chị ưng em lên đơn cho mình nha"
      : "Chị ưng sản phẩm cho em xin số điện thoại và địa chỉ để em lên đơn cho mình nha?";
    return " Dạ chị mặc freesize là vừa đấy ạ. " + _cta;
  }
  // [FIX Nguyễn Đạt 2026-08-17] Trước khi HỎI size: soi CHÍNH TIN KHÁCH LƯỢT NÀY — khách vừa khai cân
  // ("m55 42kg mẫu xanh size gì") mà bot hỏi lại "cho em xin chiều cao cân nặng" là tự vả. Có cân trong
  // tin -> tư vấn size NGAY theo bảng cân (một chốt tại hàm đuôi = trị mọi nhánh dùng chung đuôi này).
  try {
    // Ưu tiên CỜ AI (do_luong - ngữ cảnh TOÀN hội thoại: khách khai ở tin trước cũng bắt được),
    // parse regex tin-hiện-tại chỉ là dự phòng khi AI mù.
    const _kgNow = parseWeightKg(mem._aiDoLuong || "") || parseWeightKg(mem._lastCustText || "");
    if (_kgNow && _kgNow >= 35 && _kgNow <= 61) {
      const _bsNow = weightToBaseSize(_kgNow);
      mem.customerWeightKg = _kgNow;
      console.log(`[SIZE ĐUÔI] khách vừa khai ${_kgNow}kg trong tin -> tư vấn ${_bsNow} luôn, KHÔNG hỏi lại số đo.`);
      return ` Dạ với ${_kgNow}kg chị mặc ${sizeLabel(_bsNow)} là chuẩn form nha ạ. Chị ưng em lên đơn ${sizeLabel(_bsNow)} cho mình nhe ạ?`;
    }
  } catch (_) {}
  // CHƯA có size -> CHỈ hỏi size (luân phiên 2 câu), TUYỆT ĐỐI không liệt kê S/M/L ra cho khách.
  const _ASK_SIZE = [
    "Chị thường mặc size bao nhiêu để em tư vấn cho mình ạ?",
    "Chị cho em xin chiều cao và cân nặng để em tư vấn size chuẩn cho mình nha!"
  ];
  mem.askSizeIdx = ((mem.askSizeIdx || 0) + 1) % _ASK_SIZE.length;
  return " " + _ASK_SIZE[mem.askSizeIdx];
}
function buildCommentOpener(product, mem) {
  if (!product) return "Dạ chị quan tâm mẫu nào gửi hình ảnh bên em báo giá và tư vấn cho mình nha ạ.";
  const label = productLabel(product);
  const priceStr = priceLine(product);
  const head = priceStr ? `Dạ ${label} ${priceStr} ạ.` : `Dạ ${label} ạ.`;
  return head + sizeTailForProduct(mem, product);
}

// ===== GIAI ĐOẠN HỘI THOẠI (suy từ trạng thái, không đoán): MO -> THAN -> KET =====
//   MO  = chưa báo giá mẫu nào (chưa mở).
//   THAN= đã báo giá ít nhất 1 mẫu, chưa chốt (đang giải đáp/thuyết phục).
//   KET = đã chốt đơn (orderClosed).
// Quy tắc: KHÔNG thụt lùi. THÂN không quay lại MỞ (không báo giá lại mẫu đã báo);
//          KẾT không quay lại MỞ/THÂN (không báo giá lại, không lôi kéo lại từ đầu).
function convPhase(mem) {
  if (mem && mem.orderClosed) return "KET";
  if (mem && mem.pricedCodes && mem.pricedCodes.length) return "THAN";
  return "MO";
}

// MỞ chỉ 1 LẦN/mẫu: nếu mẫu ĐÃ báo giá 24h -> trả câu DẪN DẮT (KHÔNG lặp giá);
// chưa báo giá -> opener đầy đủ (có giá). Dùng cho các "lưới an toàn".
function openerOrLead(product, mem) {
  if (!product) return buildCommentOpener(product, mem);
  const k = String(product.code || "").toUpperCase();
  if (quotedRecently(mem, k)) {
    const tail = sizeTailForProduct(mem, product);   // "" nếu đã đủ size -> không hỏi lại
    return `Dạ ${productLabel(product)} ạ.` + (tail || " Chị cần em tư vấn thêm gì về mẫu này không ạ");
  }
  return buildCommentOpener(product, mem);
}

// ===== FOLLOW-UP: câu CHỈ TRẢ LỜI (không kèm hành động) -> chờ ~30s, khách im thì gửi 1 CÂU HÀNH ĐỘNG =====
const FOLLOWUP_DELAY_MS = 15 * 1000;   // mặc định 15s khách im -> gửi 1 câu hành động
const pendingFollowups = new Map();   // convId -> { at, action, delay }
let _sendingFollowup = false;         // đang gửi 1 follow-up -> KHÔNG cho hook tự hẹn follow-up MỚI (tránh nhắc vô hạn)

// ===== MAP TAY: Ad ID THẬT -> mẫu (cứu ad "dark post" không đọc được ảnh/caption) =====
// File ad_product_map.json cạnh bot:  { "120253029752640550": "CORINE", ... }
// Giá trị = TÊN mẫu (khớp như khách gõ) HOẶC mã sản phẩm. Owner thêm 1 dòng/ad, KHÔNG cần sửa code.
// Tự nạp lại khi file đổi (sửa map xong KHÔNG phải tắt/bật bot).
let _adMap = {}, _adMapMtime = -1;
const _AD_MAP_PATH = require("path").join(__dirname, "ad_product_map.json");
const _AD_LEARNED_PATH = require("path").join(__dirname, "ad_learned_map.json");   // map TỰ HỌC từ tên ad (API)
function loadAdMap() {
  try {
    const fs = require("fs");
    const st = fs.statSync(_AD_MAP_PATH);
    let stL = null;
    try { stL = fs.statSync(_AD_LEARNED_PATH); } catch (_) {}
    const _mt = st.mtimeMs + "|" + (stL ? stL.mtimeMs : 0);
    if (_mt === _adMapMtime) return;
    const m = {};
    // (1) Map TỰ HỌC (bóc từ tên ad qua API) nạp trước...
    if (stL) {
      try {
        const rawL = JSON.parse(fs.readFileSync(_AD_LEARNED_PATH, "utf8"));
        for (const k of Object.keys(rawL)) { if (!k || k.startsWith("_") || !rawL[k]) continue; m[String(k).trim()] = String(rawL[k]).trim(); }
      } catch (_) {}
    }
    // (2) ...map TAY đè lên (người luôn thắng máy khi trùng key).
    const raw = JSON.parse(fs.readFileSync(_AD_MAP_PATH, "utf8"));
    for (const k of Object.keys(raw)) { if (!k || k.startsWith("_") || !raw[k]) continue; m[String(k).trim()] = String(raw[k]).trim(); }
    _adMap = m; _adMapMtime = _mt;
    console.log(`[ADS MAP] đã nạp ${Object.keys(_adMap).length} ad->mẫu (tay: ad_product_map.json + tự học: ad_learned_map.json)`);
  } catch (_) { if (!_adMapMtime) _adMapMtime = "0"; }   // không có file -> map rỗng, vẫn chạy
}
// [TỰ HỌC] Ghi nhớ adId/postId/storyId -> mã mẫu (nguồn: MÃ trong TÊN AD đọc qua Marketing API).
// File riêng ad_learned_map.json để không đụng file map tay; map tay luôn đè khi trùng key.
function learnAdProduct(keys, code) {
  try {
    if (!code) return;
    const fs = require("fs");
    let m = {};
    try { m = JSON.parse(fs.readFileSync(_AD_LEARNED_PATH, "utf8")) || {}; } catch (_) {}
    let changed = false;
    const saved = [];
    for (const k of keys || []) {
      const kk = String(k || "").trim();
      if (!kk || !/^\d{6,}$/.test(kk)) continue;
      if (m[kk] !== code) { m[kk] = code; changed = true; saved.push(kk); }
    }
    if (changed) {
      fs.writeFileSync(_AD_LEARNED_PATH, JSON.stringify(m, null, 2));
      _adMapMtime = "";   // ép nạp lại ở lần lookup sau
      console.log(`[ADS MAP] TỰ HỌC: ${saved.join(", ")} -> ${code}`);
    }
  } catch (e) { console.log(`[ADS MAP] tự học LỖI: ${(e && e.message) || e}`); }
}
function lookupAdProduct(adId) {
  loadAdMap();
  if (!adId) return null;
  const v = _adMap[String(adId).trim()];
  if (!v || typeof v !== "string") return null;
  const i = v.indexOf("|");                       // định dạng "MÃ|Màu" -> chỉ lấy MÃ
  return ((i >= 0 ? v.slice(0, i) : v).trim()) || null;
}
// MÀU shop gắn thẳng vào MAP cho bài ad (định dạng "MÃ|Màu", vd "MGKVX6310|Hồng"). Không có "|" -> null.
function lookupAdColor(adId) {
  loadAdMap();
  if (!adId) return null;
  const v = _adMap[String(adId).trim()];
  if (!v || typeof v !== "string") return null;
  const i = v.indexOf("|");
  return i >= 0 ? (v.slice(i + 1).trim() || null) : null;
}

// ===== HẸN GỬI LẠI ẢNH khi khách KHÔNG CÓ MẶT (#551) =====
// Khách bấm xem nhưng FB báo "không có mặt" -> gửi ảnh thất bại. Retry liền vô ích.
// -> Hẹn quay lại gửi CHỈ ẢNH sau 10p -> 30p -> 1h (3 lần). Mỗi lần chỉ gửi nếu khách CHƯA nhắn lại.
// Gửi được -> follow-up nhắc tính TỪ LÚC GỬI ĐƯỢC. 3 lần vẫn vắng -> thôi.
const pendingImageResends = new Map();   // convId -> { code, items, color, attempt, nextAt, sinceTs }
// Hội thoại bị NGỪNG gửi giữa chừng vì KHÁCH chen tin mới -> ÉP xử lại lượt poll sau
// (kẻo list lọc rớt "shop nhắn cuối" làm tin/ảnh khách vừa gửi bị bỏ quên).
const forceRecheckConvs = new Set();     // chứa String(convId)
const _RESEND_DELAYS = { 1: 10 * 60 * 1000, 2: 30 * 60 * 1000, 3: 60 * 60 * 1000, 4: 120 * 60 * 1000 };  // 10p -> 30p -> 1h -> 2h
const _RESEND_MAX = 4;
function scheduleImageResend(convId, code, items, color) {
  const cid = String(convId);
  if (pendingImageResends.has(cid)) return;   // đã có hẹn -> giữ nguyên (không dồn)
  pendingImageResends.set(cid, {
    code: String(code || "").toUpperCase(),
    items: (items || []).filter(i => i && (i.contentId || i.url)),
    color: color || null,
    attempt: 1,                       // lần quay lại số 1 = sau 10p
    nextAt: Date.now() + _RESEND_DELAYS[1],
    sinceTs: Date.now()               // mốc để biết khách có NHẮN LẠI sau khi gửi hụt không
  });
  // GẮN THẺ "AI-XL ảnh" (184) để NV thấy còn nợ ảnh. Thẻ 184 KHÔNG chặn -> Bảo Trâm vẫn nhắn khách bình thường.
  try { tagXuLyAnh(cid); } catch (_) {}
  console.log(`[${BOT_NAME}] HẸN gửi lại ảnh ${code} cho ${cid} sau 10 phút (lần 1/${_RESEND_MAX}) + gắn thẻ AI-XL ảnh.`);
}
async function sweepImageResends() {
  const now = Date.now();
  for (const [cid, e] of [...pendingImageResends.entries()]) {
    if (now < e.nextAt) continue;
    let data = null;
    try { data = await readConversation(cid); } catch (_) { continue; }   // đọc lỗi -> để vòng sau thử lại
    // Khách ĐÃ NHẮN LẠI sau khi gửi hụt -> huỷ hẹn (luồng thường sẽ lo, KHÔNG gỡ thẻ - để NV còn thấy nợ ảnh).
    const repliedAfter = (data && data.messages || []).some(m =>
      m && m.sender === "customer" && parseTime(m.insertedAt) > e.sinceTs);
    if (repliedAfter) {
      pendingImageResends.delete(cid);
      console.log(`[${BOT_NAME}] Hẹn gửi ảnh ${e.code} (${cid}): khách ĐÃ nhắn lại -> HUỶ hẹn (luồng thường xử lý).`);
      continue;
    }
    // [FIX Túy Loan 2026-08-09] NGƯỜI THẬT đang cầm hội thoại -> HUỶ hẹn, GIỮ thẻ nợ ảnh cho nhân viên
    // tự gửi (bot xả ảnh nợ vào giữa mạch nhân viên đang tư vấn = lạc quẻ, phá mạch).
    if (humanTookOverInbox(data.messages)) {
      pendingImageResends.delete(cid);
      console.log(`[${BOT_NAME}] Hẹn gửi ảnh ${e.code} (${cid}): NGƯỜI THẬT đang xử hội thoại -> HUỶ hẹn, giữ thẻ nợ ảnh cho NV.`);
      continue;
    }
    // Gửi CHỈ ẢNH (không kèm chữ).
    let sres = { ok: false };
    try { sres = await sendImages3(cid, (e.items || []).slice(0, 3)); } catch (_) {}
    if (sres && sres.ok) {
      pendingImageResends.delete(cid);
      const mem = getConversationState(cid);
      mem.sentImageCodes = mem.sentImageCodes || [];
      if (!mem.sentImageCodes.includes(e.code)) mem.sentImageCodes.push(e.code);
      updateConversationState(cid, mem);
      try { await untagXuLyAnh(cid); } catch (_) {}   // gửi được ảnh -> TỰ GỠ thẻ AI-XL ảnh
      console.log(`[${BOT_NAME}] Gửi LẠI ảnh ${e.code} (${cid}) THÀNH CÔNG (lần ${e.attempt}/${_RESEND_MAX}) -> gỡ thẻ + bám follow-up từ giờ.`);
      // Follow-up nhắc tính TỪ LÚC GỬI ĐƯỢC ẢNH.
      try {
        const cat = await ensureCatalog();
        const product = cat.byCode.get(e.code) || { code: e.code };
        scheduleFollowup(cid, mem, product, mem.lastBotReply || "");
      } catch (_) {}
      continue;
    }
    // Vẫn KHÔNG CÓ MẶT -> hẹn lần kế (30p -> 1h -> 2h). Hết 4 lần -> thôi (giữ thẻ để NV xử tay).
    if (sres && sres.notAvailable) {
      const next = e.attempt + 1;
      if (next > _RESEND_MAX) {
        pendingImageResends.delete(cid);
        console.log(`[${BOT_NAME}] Gửi lại ảnh ${e.code} (${cid}): ${_RESEND_MAX} lần vẫn KHÔNG CÓ MẶT -> THÔI (giữ thẻ AI-XL ảnh cho NV).`);
      } else {
        e.attempt = next; e.nextAt = now + _RESEND_DELAYS[next];
        console.log(`[${BOT_NAME}] Gửi lại ảnh ${e.code} (${cid}) lần ${e.attempt - 1} vẫn vắng -> hẹn lại sau ${_RESEND_DELAYS[next] / 60000} phút (lần ${e.attempt}/${_RESEND_MAX}).`);
      }
      continue;
    }
    // Lỗi KHÁC (content_id hỏng...) -> không phải "vắng" -> thôi, không lặp vô ích.
    pendingImageResends.delete(cid);
    console.log(`[${BOT_NAME}] Gửi lại ảnh ${e.code} (${cid}) lỗi KHÁC (không phải vắng) -> THÔI.`);
  }
}
// Câu reply ĐÃ có sẵn hành động (mời chốt/hỏi size/xin info...) thì KHÔNG cần follow-up nữa.
function replyHasAction(text) {
  const t = String(text || "").toLowerCase();
  return /(lên đơn|chốt|size (nào|bao nhiêu|gì)|mặc size|sđt|số điện thoại|địa chỉ|chiều cao và cân nặng|nặng (khoảng |bao nhiêu)?(bao nhiêu )?kg|bao nhiêu kg|cân nặng|không có size vừa|chưa có size phù hợp|lựa mẫu khác|ưng .*(lên|lấy)|ưng mẫu nào|mẫu nào nhắn|tư vấn thêm cho mình|cho em xin|chị thường mặc|thích màu nào|gửi ảnh từng màu)/i.test(t);
}
// ===== POOL CÂU HÀNH ĐỘNG (bám đuôi) — chọn theo NGỮ CẢNH, xoay vòng, bổ trợ câu trên, không lặp lõi =====
// Cờ 1-lần: mem.saidBestSeller (1 lần/đợt), mem.saidNewColl[code] (1 lần/mẫu).
function _actionCore(line) {
  const l = String(line || "").toLowerCase();
  if (/best-seller/.test(l)) return "bestseller";
  if (/bộ sưu tập mới/.test(l)) return "newcoll";
  if (/ưu đãi/.test(l)) return "uudai";
  if (/màu nào hơn/.test(l)) return "mau";
  if (/xin size|size để em tư vấn|cho em xin size|thường mặc size|cho em xin chiều cao/.test(l)) return "xinsize";
  if (/lên đơn|lấy size|em chốt|ưng .*chốt|chốt cho/.test(l)) return "chot";
  return l.slice(0, 14);
}
// Size DÙNG ĐỂ LÊN ĐƠN = size khách (effectiveSize) HOẶC size NGƯỜI NHẬN khi MUA HỘ (giftSize).
// FIX #4: khách mua hộ đã cho "size m" cho người nhận -> coi như ĐÃ biết size, KHÔNG hỏi lại size nữa.
// Vẫn validate giftSize nằm trong bảng size mẫu (tránh chốt size mẫu không có).
function _orderSize(mem, product) {
  const es = effectiveSize(mem, product);
  if (es) return es;
  const g = mem && mem.giftSize;
  if (g && g !== "FREESIZE") {
    const avail = parseAvailableSizes(product && product.size);
    if (!avail.size || avail.has(g)) return g;
  }
  return null;
}
// Đuôi CHỐT động theo thông tin khách ĐÃ có: chưa size -> xin cao/nặng; có size chưa contact -> xin sđt+địa chỉ; đủ -> lên đơn.
function _closeTail(mem, product) {
  // LỖI 4a: khách gửi/được báo NHIỀU mẫu mà CHƯA chốt 1 mẫu -> KHÔNG ép "lên đơn size X" cho 1 mẫu;
  // hỏi xác nhận lên đơn cả cụm hoặc chốt mẫu nào (tránh tự quyết mẫu khách chưa chọn).
  // KHÁCH gửi/được báo NHIỀU mẫu mà CHƯA chốt 1 mẫu -> KHÔNG ép "lên đơn size X" cho 1 mẫu, và
  // KHÔNG nói "lên đơn tổng N mẫu" (khách chưa chọn). Theo yêu cầu shop: 2+ mẫu -> HỎI SIZE (nếu chưa biết),
  // biết rồi -> mời chọn mẫu để lên đơn.
  const cluster = dedupByCode((mem && mem.quotedProducts) || []);
  if (cluster.length >= 2) {
    const esMulti = _orderSize(mem, product);
    if (!esMulti) return "chị thường mặc size bao nhiêu ạ? để em tư vấn size cho mình ạ";
    return "chị ưng mẫu nào em lên đơn cho mình nha ạ?";
  }
  const es = _orderSize(mem, product);
  const szTxt = es === "FREESIZE" ? "freesize" : (es ? sizeLabel(es) : "");
  const hasContact = !!(mem && mem.phone && mem.address);
  if (!es) return "chị thường mặc size bao nhiêu ạ? để em tư vấn size chuẩn cho mình ạ?";
  if (!hasContact) return "Chị ưng sản phẩm gửi em xin số điện thoại và địa chỉ em lên đơn cho mình nha?";
  return `em lên đơn ${szTxt} cho mình luôn nha chị?`;
}
function _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function pickFollowupAction(mem, product, replyText) {
  if (!product) return null;
  if (recommend.isOutOfStock(product)) return null;
  if (mem && product && mem.noFitForCode === product.code) return null;
  mem = mem || {};
  const code = product.code;
  const es = _orderSize(mem, product);                    // "FREESIZE" | "S".. | null (gồm size MUA HỘ)
  const sizeKnown = !!es;
  const szTxt = es === "FREESIZE" ? "freesize" : (es ? sizeLabel(es) : "");
  const rTxt = String(replyText || "");
  const replySaysSize = /size\s*[smlx]|lên đơn size|lấy size|chốt size/i.test(rTxt);
  const hasSale = isOnSale(product);
  const isNew = !!(product.isNew || product.bstNew || product.newCollection || product.newColl);  // cờ BST mới (đọc từ cột T)
  const colors = (typeof colorListForModel === "function" ? (colorListForModel(product, code) || []) : []);
  const manyColors = colors.length >= 2 && /màu/i.test(rTxt);   // chỉ gợi "màu nào hơn" khi câu trên đang nói về màu
  const tail = _closeTail(mem, product);   // đuôi chốt động theo thông tin có sẵn

  // LỖI 3: mẫu CÓ 2+ màu, câu trên đang nói về màu, mà khách CHƯA chốt màu -> followup phải HỎI MÀU,
  // KHÔNG đẩy CTA "lên đơn size" lên (khách còn đang chọn màu, chốt size là chưa hợp lý).
  const _colorChosen = (typeof chosenColorForCode === "function") ? (chosenColorForCode(mem, product) || "") : "";
  if (manyColors && !_colorChosen) return "Dạ chị ưng màu nào hơn để em tư vấn cho mình ạ?";

  const pool = [];
  // --- Theo SIZE ---
  if (sizeKnown) {
    pool.push(`Dạ ${tail}`);
    pool.push(`Dạ mặc mẫu này đi làm hay đi chơi đều hợp, lại dễ phối lắm ạ. ${_cap(tail)}`);
    pool.push(`Dạ mẫu này lên dáng xinh lắm ạ, ${tail}`);
  } else if (replySaysSize) {
    pool.push(`Dạ mẫu này lên dáng xinh lắm ạ, ${tail}`);
  } else {
    pool.push(`Dạ ${tail}`);   // chưa biết size -> đuôi tự là "chị thường mặc size bao nhiêu..."
  }
  if (manyColors) pool.push("Dạ chị ưng màu nào hơn để em tư vấn cho mình ạ?");
  if (hasSale) {
    pool.push(`Dạ mẫu này đang có ưu đãi nên giá này là tốt nhất rồi ạ. ${_cap(tail)}`);
    pool.push(`Dạ bên em đang có ưu đãi, mẫu này còn rất ít mà hàng sale hết nhanh lắm ạ. ${_cap(tail)}`);
    // % giảm THỰC của mã (không nói cứng "50%" để khỏi sai dữ liệu). Chỉ thêm khi tính được % hợp lệ.
    const _g = parseMoney(product.price), _s = parseMoney(product.salePrice);
    const _dp = (_g && _s && _s < _g) ? Math.round((_g - _s) / _g * 100) : 0;
    if (_dp >= 10) {
      pool.push(`Dạ mẫu này đang ưu đãi giảm tới ${_dp}%, số lượng không còn nhiều ạ. Chị cho em xin size (hoặc cao/nặng) để em check xem còn hàng không nha.`);
      pool.push(`Dạ mẫu này đang giảm tới ${_dp}% chị ơi, số lượng còn ít thôi ạ. Chị mặc size nào để em kiểm tra còn hàng cho mình nha.`);
    }
  }
  if (!mem.saidBestSeller) pool.push(`Dạ mẫu này là best-seller hiện tại bên em đó ạ, nhiều chị lấy lắm. ${_cap(tail)}`);
  if (isNew && !((mem.saidNewColl || {})[code])) {
    pool.push(`Dạ mẫu này nằm trong bộ sưu tập mới nhất bên em đó chị, vừa ra mắt nên còn rất hot, nhiều khách quan tâm lắm ạ. ${_cap(tail)}`);
    pool.push(`Dạ đây là mẫu thuộc bộ sưu tập mới nhất bên em, chất đẹp mà kiểu dáng đang là xu hướng, lên người sang lắm ạ. ${_cap(tail)}`);
  }
  // Câu B: hỏi khách còn phân vân điểm nào (size/chất/mẫu) -> dùng được cả khi đã/chưa có size.
  pool.push("Dạ không biết chị còn phân vân điểm nào không ạ — về size, chất váy hay mẫu — chị cứ nói em tư vấn thêm cho mình dễ chọn nha!");
  // Câu A: CHƯA có size -> hỏi ưng mẫu + xin cao/nặng (chỉ thêm khi chưa biết size, tránh hỏi lại size khi đã có).
  if (!sizeKnown) {
    const _pname = (product && product.name) ? product.name : "này";
    pool.push(`Dạ chị ơi, mình xem mẫu ${_pname} thấy ưng không ạ? Chị nhắn em chiều cao với cân nặng là em tư vấn size vừa đẹp cho mình nha`);
  }

  // Loại câu TRÙNG LÕI với câu trên (replyText) + câu vừa gửi (tránh "trên 1 đằng dưới 1 nẻo" & lặp).
  const rCore = _actionCore(rTxt);
  const lastCore = mem.lastCtaSent ? _actionCore(mem.lastCtaSent) : "";
  let cands = pool.filter(line => {
    const c = _actionCore(line);
    if (rTxt && c === rCore) return false;
    if (lastCore && c === lastCore) return false;
    return true;
  });
  if (!cands.length) cands = pool;
  if (!cands.length) return null;

  const idx = (mem.ctaIdx || 0) % cands.length;
  mem.ctaIdx = idx + 1;
  let chosen = cands[idx];
  // CHỐNG LẶP: câu bot VỪA gửi đã hỏi size mà follow-up này lại hỏi y vậy -> đổi sang câu KHÔNG hỏi size;
  //  không có thì BỎ follow-up (thà im còn hơn lặp "chị thường mặc size bao nhiêu" 2 lần liền).
  const _SIZE_ASK = /thường mặc size|xin size|cho em xin chiều cao|chiều cao với cân nặng|cho em xin size|size để em tư vấn|mặc size bao nhiêu|mặc size nào|check.*còn hàng|kiểm tra còn hàng/i;
  if (_SIZE_ASK.test(chosen) && _SIZE_ASK.test(String(mem.lastBotReply || ""))) {
    const alt = cands.find(l => !_SIZE_ASK.test(l));
    if (alt) chosen = alt; else return null;
  }
  if (/best-seller/i.test(chosen)) mem.saidBestSeller = true;
  if (/bộ sưu tập mới/i.test(chosen)) { mem.saidNewColl = mem.saidNewColl || {}; mem.saidNewColl[code] = true; }
  // KHÔNG ghi mem.lastCtaSent ở đây: hàm này chỉ CHỌN câu (scheduleFollowup còn so lastCtaSent ngay sau đó
  //  để chống trùng; nếu ghi sớm sẽ tự so với chính mình -> luôn "trùng" -> follow-up KHÔNG BAO GIỜ bắn).
  //  lastCtaSent chỉ được ghi khi câu THỰC SỰ GỬI (sweepFollowups / appendCTA).
  return chosen;
}
// Câu hành động phù hợp ngữ cảnh (dùng cho appendCTA - nối liền).
function followupAction(mem, product) {
  return pickFollowupAction(mem, product, "");
}
// Nối CÂU HÀNH ĐỘNG vào câu trả lời suông (khi câu đó chưa có hành động) -> mỗi câu trả lời đều có CTA.
function appendCTA(reply, mem, product) {
  if (!reply || replyHasAction(reply)) return reply;                 // đã có hành động -> giữ nguyên (follow-up 60s sẽ bám tiếp)
  if (mem && mem.orderClosed) return reply;                          // đã chốt -> không gặng
  if (/đặt hàng|chúc chị|cảm ơn chị|chờ em (kiểm|một)|nhờ (nhân viên|nv)|chưa có size phù hợp|không có size vừa|chưa có size .*(của (chị|mình)|rồi)|lựa mẫu khác|tham khảo (thêm )?mẫu khác/i.test(reply)) return reply;
  const action = pickFollowupAction(mem, product, reply);            // câu hành động hợp ngữ cảnh
  if (!action) return reply;
  if (mem) mem.lastCtaSent = action;
  let tail = action.replace(/^Dạ\s*/i, "");
  tail = tail.charAt(0).toUpperCase() + tail.slice(1);
  const body = String(reply).trim().replace(/[.\s]+$/u, "");
  return `${body}. ${tail}`;
}
// Khách vừa HỎI thông tin / XIN xem ảnh / nói THAM KHẢO THÊM -> KHÔNG được tự nhắc "lên đơn".
function customerJustAsking(text) {
  const t = String(text || "");
  if (!t.trim()) return false;
  return looksLikeQuestion(t) || asksOtherColors(t) || wantsToBrowseMore(t) || wantsConsult(t)
    || /(gửi|gui|cho|xem|coi|xin)\s*(chị|c|em|mình|minh)?\s*(xem|coi|ảnh|hình|anh|hinh)/i.test(t)
    || /(ảnh|hình)\s*(màu|mau)/i.test(t);
}
// Hẹn follow-up SAU KHI gửi câu trả lời. 2 loại: 30s (câu CHỈ trả lời) / 60s (câu ĐÃ có sẵn hành động).
function scheduleFollowup(convId, mem, product, reply) {
  // [DIAG] log lý do bỏ follow (gỡ sau khi xong) — để biết vì sao follow 5s không bắn.
  const _diag = (why) => { try { console.log(`[${BOT_NAME}] [follow-skip] ${why} | conv=${convId} | reply="${String(reply||"").slice(0,40)}"`); } catch(_){} };
  if (!product) { _diag("KHÔNG có product"); pendingFollowups.delete(String(convId)); return; }
  if (!reply || !reply.trim() || reply.startsWith("[")) { _diag("reply rỗng/[]"); pendingFollowups.delete(String(convId)); return; }
  if (isCheckLaterReply(reply)) { _diag("câu chờ-kiểm-tra"); pendingFollowups.delete(String(convId)); return; }
  if (/đặt hàng|chúc chị một ngày|cảm ơn chị|gửi (lại )?(hình|ảnh)/i.test(reply)) { _diag("câu chốt/cảm ơn/gửi ảnh"); pendingFollowups.delete(String(convId)); return; }
  if (/gửi qua j&t|phí ship|miễn phí ship|kho bắc giang| là chất |đổi trong \d+ ngày|bảo hành|đơn của chị tổng|thanh toán khi nhận/i.test(reply)) { _diag("câu thông tin ship/chất/chính sách"); pendingFollowups.delete(String(convId)); return; }
  if (/chưa có size phù hợp|không có size vừa|chưa có size .*(của (chị|mình)|rồi ạ)|lựa mẫu khác|tham khảo (thêm )?mẫu khác|chưa có .*(của (chị|mình)) rồi/i.test(reply)) { _diag("câu hết size/lựa mẫu khác"); pendingFollowups.delete(String(convId)); return; }
  if (mem && mem.orderedByCode && product && mem.orderedByCode[_up((product && product.code) || "")]) { _diag("mẫu đã trong đơn chốt"); pendingFollowups.delete(String(convId)); return; }
  if (mem && mem.orderClosed) { _diag("orderClosed=true"); pendingFollowups.delete(String(convId)); return; }
  if (mem && mem.botHandoffAt) { _diag("botHandoffAt (đã nhường người)"); pendingFollowups.delete(String(convId)); return; }
  if (/sđt|số điện thoại|sdt|địa chỉ/i.test(reply) && !(mem && mem.phone && mem.address)) { _diag("câu xin sđt/địa chỉ + chưa đủ contact"); pendingFollowups.delete(String(convId)); return; }
  const hasAction = replyHasAction(reply);
  // STAGE follow-up:
  //  - Mở đầu hội thoại (chưa từng follow đợt này): lần 1 sau 5s (stage 1) -> bắn xong tự hẹn lần 2 sau 2h (stage 2).
  //  - Các đợt sau (khách đã nhắn lại + bot trả + khách lại im): chỉ 1 lần sau 2h (stage 0).
  const FIVE_SEC = 10 * 60 * 1000;   // [SỬA Thuy Nguyen] follow-up lần đầu: 5s -> 10 phút (tránh giục dồn)
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const _firstTurn = !mem._followedOnce;   // đợt MỞ ĐẦU hội thoại -> được 2 lần (5s + 2h)
  const stage = _firstTurn ? 1 : 0;
  const delay = _firstTurn ? FIVE_SEC : TWO_HOURS;
  // Chọn câu hành động: nếu câu trên ĐÃ có hành động thì truyền reply để tránh trùng lõi (bổ trợ, không lặp).
  const action = pickFollowupAction(mem, product, hasAction ? reply : "");
  if (!action) { _diag("pickFollowupAction trả null (hết câu)"); pendingFollowups.delete(String(convId)); return; }
  // CHỐNG TRÙNG CÂU: không lặp đúng câu vừa gửi, cũng không lặp câu đã follow trước đó trong hội thoại.
  mem._followedLines = mem._followedLines || [];
  const _aCore = _actionCore(action);
  if (mem && mem.lastCtaSent && _actionCore(mem.lastCtaSent) === _aCore) { _diag("trùng lastCtaSent"); pendingFollowups.delete(String(convId)); return; }
  if (mem._followedLines.includes(_aCore)) { _diag("câu đã follow rồi (trùng _followedLines)"); pendingFollowups.delete(String(convId)); return; }
  if (mem && mem.botHandoffAt) { mem.botHandoffAt = 0; }
  pendingFollowups.set(String(convId), { at: Date.now(), action, delay, stage, product, custAt: lastCustomerMsgAt.get(String(convId)) || 0 });
  try { console.log(`[${BOT_NAME}] [follow-hẹn] stage ${stage}, sau ${Math.round(delay/1000)}s -> "${String(action).slice(0,40)}" | conv=${convId}`); } catch(_){}
}
function cancelFollowup(convId) { pendingFollowups.delete(String(convId)); }
// Quét: hội thoại đã qua 60s mà khách CHƯA nhắn lại (entry còn đây) -> gửi câu hành động.
// Gửi GALLERY 10 mẫu MỚI cho khách "Bắt đầu" (Get Started). Trả số mẫu đã gửi, hoặc false nếu không có mẫu.
async function sendGetStartedGallery(cid, mem) {
  const _cat = await ensureCatalog();
  const _news = (_cat.list || []).filter(p => p && p.isNew && !recommend.isOutOfStock(p));
  for (let i = _news.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [_news[i], _news[j]] = [_news[j], _news[i]]; }
  const _campCode = "MGKVX6310";
  const _camp = (_cat.list || []).find(p => String(p.code || "").toUpperCase().trim() === _campCode && !recommend.isOutOfStock(p));
  const _newsOrdered = _camp ? [_camp, ..._news.filter(p => String(p.code || "").toUpperCase().trim() !== _campCode)] : _news;
  const _gal = recommend.buildGallery(_newsOrdered, { maxModels: 10, withPrices: false });
  if (!_gal) return false;
  await sendGallery(cid, _gal, mem, "Dạ em gửi chị một số mẫu để tham khảo ạ. Chị quan tâm mẫu nào thì nhắn lại giúp em, em sẽ hỗ trợ thêm thông tin chi tiết nhé.");
  return _gal.count || true;
}

async function sweepFollowups() {
  const now = Date.now();
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  // ĐẾM GIỜ FOLLOW từ thời điểm MUỘN HƠN giữa: tin khách cuối (custAt) và lúc bot HẸN (at).
  //  - Khách nhắn realtime: custAt ~ at -> đếm như thường (10 phút kể từ khách ngừng gõ).
  //  - Tin khách CŨ (nhắn TRƯỚC khi bật bot): custAt xa quá khứ -> nếu chỉ lấy custAt thì delay vượt NGAY
  //    -> follow bắn tức thì (lỗi: hẹn 600s mà bắn sau 1 phút). Lấy max(custAt, at) -> vẫn đợi đủ 10 phút kể từ lúc hẹn.
  const _baseAt = (info) => Math.max(info.custAt || 0, info.at || 0);
  const _due = [...pendingFollowups.entries()].filter(([, info]) => now - _baseAt(info) >= (info.delay || FOLLOWUP_DELAY_MS)).length;
  if (pendingFollowups.size > 0) console.log(`[${BOT_NAME}] [follow-sweep] đang chờ ${pendingFollowups.size} hội thoại, đến hạn ${_due}.`);
  for (const [cid, info] of [...pendingFollowups.entries()]) {
    if (now - _baseAt(info) < (info.delay || FOLLOWUP_DELAY_MS)) continue;   // đếm từ TIN KHÁCH (5s / 2h)
    pendingFollowups.delete(cid);
    try {
      const _m0 = getConversationState(cid);
      // CHẶN follow-up: còn thẻ giữ người thật / bot vừa nhường người / ĐƠN ĐÃ CHỐT (theo yêu cầu shop).
      if (_m0 && (_m0.aiStandsOut || _m0.botHandoffAt)) {
        console.log(`[${BOT_NAME}] Bỏ follow-up: hội thoại đang giữ người thật (AI đứng ngoài). Conv: ${cid}`);
        continue;
      }
      if (_m0 && _m0.orderClosed) {   // đã chốt đơn -> DỪNG follow (follow chỉ tới khi khách chốt).
        console.log(`[${BOT_NAME}] Bỏ follow-up: đơn ĐÃ CHỐT -> dừng nhắc. Conv: ${cid}`);
        continue;
      }
      // Khách đã NHẮN TIẾP sau mốc hẹn (tin khách mới hơn custAt) -> KHÔNG bắn follow cũ.
      //  Lượt bot trả tin mới đó sẽ hẹn follow MỚI, đếm 2h lại từ tin khách mới nhất.
      if ((lastCustomerMsgAt.get(cid) || 0) > (info.custAt || 0)) {
        console.log(`[${BOT_NAME}] Bỏ follow-up: khách vừa nhắn tiếp -> mốc đổi, sẽ follow lại từ tin mới. Conv: ${cid}`);
        continue;
      }
      // ===== GALLERY "Bắt đầu" ĐÃ HOÃN: tới hạn mà khách KHÔNG gửi ảnh/mẫu -> giờ mới gửi gallery 10 mẫu.
      //   (Khách gửi ảnh/mẫu trong lúc chờ -> guard "khách vừa nhắn tiếp" ở trên đã HUỶ; vòng poll thường báo giá mẫu đó.)
      //   KHÔNG đi qua guard "đọc lại Pancake/ép xử lại" bên dưới, vì với gallery thì chính "Bắt đầu" là tin chờ trả.
      if (info.kind === "GS_GALLERY") {
        try {
          const _mg = getConversationState(cid) || {};
          if (_mg.newGallerySent || _mg.orderClosed || _mg.botHandoffAt) {
            console.log(`[${BOT_NAME}] [Bắt đầu] hết hạn chờ nhưng đã có xử lý khác -> KHÔNG gửi gallery. Conv: ${cid}`);
            continue;
          }
          // Khách đã có MẪU (bot khoá mẫu / đã báo giá) trong lúc chờ -> HUỶ gallery.
          if (_mg.currentProduct || (Array.isArray(_mg.quotedProducts) && _mg.quotedProducts.length)) {
            console.log(`[${BOT_NAME}] [Bắt đầu] khách đã có mẫu trong lúc chờ -> HUỶ gallery (để báo giá mẫu đó lo). Conv: ${cid}`);
            continue;
          }
          const _sent = await sendGetStartedGallery(cid, _mg);
          if (_sent) {
            _mg.newGallerySent = true; _mg._gsDeferAt = null;
            updateConversationState(cid, _mg);
            console.log(`[${BOT_NAME}] [Bắt đầu] hết hạn chờ ~${Math.round((info.delay || 0) / 1000)}s, khách KHÔNG gửi ảnh/mẫu -> GỬI gallery 10 mẫu. Conv: ${cid}`);
          } else {
            console.log(`[${BOT_NAME}] [Bắt đầu] hết hạn chờ nhưng KHÔNG có mẫu MỚI để gửi gallery. Conv: ${cid}`);
          }
        } catch (e) { console.log("[GS_GALLERY] lỗi:", e.message); }
        continue;
      }
      // [FIX Tầm Dương] lastCustomerMsgAt cập nhật TRỄ (chỉ đổi khi poll đọc tới conv). Tin khách có thể tới
      //   GIỮA lúc hẹn (5s) mà mem chưa biết -> follow bắn ĐÈ tin khách. -> ĐỌC LẠI Pancake ngay trước khi gửi:
      //   nếu tin CUỐI là của KHÁCH mà shop CHƯA trả -> BỎ follow + ÉP xử lại để TRẢ LỜI KHÁCH (không chèn).
      try {
        const _chk = await readConversation(cid);
        const _msgs = (_chk && _chk.messages) || [];
        if (_msgs.length) {
          const _lastCust = getLastCustomerMessages(_msgs);
          if (_lastCust && _lastCust.length && !shopRepliedAfterLastCustomer(_msgs)) {
            forceRecheckConvs.add(String(cid));   // ép vòng sau xử lại -> trả lời tin khách
            console.log(`[${BOT_NAME}] Bỏ follow-up: khách CÓ tin mới chưa được trả (đọc lại Pancake) -> ÉP xử lại trả khách, KHÔNG chèn follow. Conv: ${cid}`);
            continue;
          }
        }
      } catch (_) { /* đọc lỗi -> vẫn gửi follow như cũ (an toàn) */ }
      _sendingFollowup = true;
      await sendInboxMessage(cid, info.action);
      const m = getConversationState(cid);
      m.lastBotReply = info.action;
      m.lastCtaSent = info.action;   // nhớ câu CTA đã gửi -> lần sau không lặp lõi này
      m._followedOnce = true;        // đợt MỞ ĐẦU đã follow -> đợt sau chỉ còn 1 lần (2h)
      m._followedLines = m._followedLines || [];
      const _core = _actionCore(info.action);
      if (!m._followedLines.includes(_core)) m._followedLines.push(_core);   // chống TRÙNG CÂU các lần sau
      updateConversationState(cid, m);
      console.log(`[${BOT_NAME}] Follow-up (stage ${info.stage}, hẹn ${Math.round((info.delay || 5000) / 1000)}s) -> ${info.action}`);
      // STAGE 1 (lần 1 @5s của đợt MỞ ĐẦU) -> hẹn tiếp LẦN 2 sau 2h (stage 2), trừ khi khách nhắn lại.
      if (info.stage === 1 && info.product) {
        const action2 = pickFollowupAction(m, info.product, info.action);
        if (action2 && !m._followedLines.includes(_actionCore(action2))) {
          pendingFollowups.set(cid, { at: Date.now(), action: action2, delay: TWO_HOURS, stage: 2, product: info.product, custAt: lastCustomerMsgAt.get(cid) || 0 });
        }
      }
    } catch (e) { console.log("Lỗi follow-up:", e.message); }
    finally { _sendingFollowup = false; }
  }
}

async function processOneConversation(conversation) {
  const conversationId = conversation.id;
  // [VÀO XỬ] soi conv nào ĐƯỢC đưa vào xử lý + trạng thái lúc vào (để truy độ trễ: nếu khách gửi tin mà
  //  KHÔNG thấy dòng này -> kẹt ở bước LỌC fresh/đọc list; nếu CÓ dòng này mà bot không trả -> kẹt bên trong).
  {
    const _lsb = conversation.last_sent_by ? (conversation.last_sent_by.admin_name || "(rỗng=khách)") : "(không có)";
    console.log(`[VÀO XỬ] ${conversation.from && conversation.from.name} | seen=${conversation.seen} | last_sent_by=${_lsb} | updated=${conversation.updated_at} | id=${conversationId}`);
  }
  forceRecheckConvs.delete(String(conversationId));   // 1 lần: đã đưa vào xử lý thì xoá cờ ép (nếu lại bị ngừng giữa chừng sẽ set lại)
  // CỜ: conv ĐANG CHƯA ĐỌC (seen=false, kể cả đã-đọc-rồi-ấn-lại-chưa-đọc) + KHÁCH nhắn cuối = khách ĐANG CHỜ thật.
  //  -> Tin nhắn TRƯỚC khi bot bật có thể đã nằm trong processedMessageIds (lưu bền) từ lần chạy/đụng trước,
  //     khiến cụm bị coi là "đã xử lý" và BỎ QUA. Với conv chưa-đọc-khách-chờ thì BỎ kiểm processed để VẪN trả lời.
  const _unreadCustomerWaiting = (conversation.seen === false) && khachDangCho(conversation);
  const mem = getConversationState(conversationId);
  mem._pageId = String(conversationId).split("_")[0];   // [CHƯƠNG TRÌNH KM] cho buildDiscountReply tra khuyen_mai.json theo page
  _curPageId = mem._pageId;   // [SALE GỌN] cho priceLine (hàm thuần, không có mem) tra được chương trình
  // CHỈ huỷ follow-up khi KHÁCH thật sự là người nhắn CUỐI (tức khách vừa nhắn tin mới -> đang chờ shop).
  // Nếu tin cuối là phía shop/bot (khachDangCho=false) -> ĐỪNG huỷ: để câu nhắc 15s/60s kịp bắn,
  // không bị xoá oan mỗi vòng poll. (Trước đây huỷ cho MỌI hội thoại trong fresh -> có thể giết follow-up sớm.)
  if (khachDangCho(conversation)) cancelFollowup(conversationId);
  // RỬA dữ liệu cũ: FREESIZE KHÔNG phải size người -> xoá khỏi customerSize (memory cũ có thể đã lưu nhầm).
  if (mem.customerSize === "FREESIZE") { mem.customerSize = null; mem.sizeFromCustomer = false; }
  _turnCtx = { convId: conversationId, mem, productInfo: null, _imgSentCodes: new Set() };   // ngữ cảnh để sendInboxMessage tự hẹn follow-up; _imgSentCodes: chống gửi ảnh CÙNG mã 2 lần trong 1 lượt (Đặng Vân)
  mem.sentImageCodes = mem.sentImageCodes || [];
  mem.pricedCodes = mem.pricedCodes || [];

  // ===== HỘI THOẠI CÒN THẺ GIỮ: kiểm TRƯỚC khi đọc tin (tags lấy sẵn từ list -> KHÔNG tốn request) =====
  // CÒN thẻ giữ (CHỜ XL 183 / ĐƠN ƯU TIÊN 185) = người thật đang xử lý -> AI ĐỨNG NGOÀI.
  // (Thẻ XL ảnh 184 KHÔNG chặn.)
  // ĐA TRANG: nạp bộ id thẻ giữ ĐÚNG theo page trước khi kiểm (id thẻ khác nhau mỗi page).
  const _holdPid = pageRegistry.pageIdFromConv(conversationId) || String(conversationId).split("_")[0];
  try { await ensureHoldTagIdsForPage(_holdPid, pageRegistry.tokenForConv(conversationId)); } catch (_) {}
  if (convHasHoldTag(conversation, _holdPid)) {
    mem.aiStandsOut = true; updateConversationState(conversationId, mem);   // đánh dấu để sweepFollowups KHÔNG bắn follow-up
    cancelFollowup(conversationId);
    if (logThrottle("hold_" + conversationId))
      console.log(`[${BOT_NAME}] Còn thẻ giữ (CHỜ XL/ĐƠN ƯU TIÊN/Hàng đổi/Đang hoàn) -> người thật xử lý, AI đứng ngoài. Conv: ${conversationId}`);
    return false;
  }
  if (mem.aiStandsOut) { mem.aiStandsOut = false; updateConversationState(conversationId, mem); }   // hết thẻ giữ -> cho phép lại
  // RESET cờ bàn giao đầu lượt: botHandoffAt được set ở ~15 chỗ mỗi lần nhường người, nhưng trước đây
  // hầu như không reset -> dính mãi -> sweepFollowups/scheduleFollowup luôn bỏ follow-up ở MỌI lượt sau.
  // Đến đây nghĩa là hội thoại KHÔNG còn thẻ giữ (người thật không ôm) -> cờ cũ vô nghĩa, xoá.
  // Nếu lượt này bot LẠI nhường người, code sẽ set lại botHandoffAt=Date.now() ngay trong lượt -> vẫn chặn đúng.
  if (mem.botHandoffAt) { mem.botHandoffAt = 0; updateConversationState(conversationId, mem); }

  // ===== TỰ GỠ THẺ AI-XL ảnh (184) NẾU BOT ĐÃ GỬI ĐƯỢC ẢNH cho mẫu đang focus =====
  // Chống RACE: có lúc bot báo giá -> gắn 184 -> vài giây sau mới gửi được ảnh (hoặc gắn/gửi lệch nhịp)
  // khiến thẻ kẹt lại. Mỗi vòng poll, nếu CÒN thẻ 184 mà bot ĐÃ gửi ảnh cho mã đang focus -> gỡ thẻ.
  if (convHasImageTag(conversation)) {
    const _focusCode = _codeUp(mem.currentProduct);
    const _sentForFocus = _focusCode && (mem.sentImageCodes || []).includes(_focusCode);
    const _sentAny = (mem.sentImageCodes || []).length > 0 || (mem.sentGalleryCodes || []).length > 0;
    if (_sentForFocus || (!_focusCode && _sentAny)) {
      try { await untagXuLyAnh(conversationId); } catch (_) {}
      if (logThrottle("untagimg_" + conversationId))
        console.log(`[${BOT_NAME}] Còn thẻ AI-XL ảnh nhưng bot ĐÃ gửi ảnh (mã ${_focusCode || "?"}) -> TỰ GỠ thẻ. Conv: ${conversationId}`);
    }
  }

  // ===== BỎ ĐỌC LẠI HỘI THOẠI KHÔNG ĐỔI (tiết kiệm doc-tin-nhan / tránh 429) =====
  // Lần trước đã đọc đúng hội thoại NÀY ở đúng trạng thái này (cùng updated_at + cùng đọc/chưa-đọc)
  // và kết luận KHÔNG có gì để làm -> KHÔNG đọc lại tin.
  // KHOÁ cache GỒM cả trạng thái seen: nếu shop bấm "ĐÁNH DẤU CHƯA ĐỌC" (seen: true -> false) để trả
  // hội thoại lại cho Bảo Trâm, khoá sẽ ĐỔI -> bot ĐỌC LẠI và có cơ hội trả lời, dù updated_at không đổi.
  // QUAN TRỌNG: khoá cache gồm cả seen. Khi conv CHƯA ĐỌC (seen=false) mà updated_at đổi -> _curUpd đổi ->
  //  không khớp skipUpd -> bot ĐỌC LẠI (đúng). Giữ nguyên cơ chế này.
  const _curUpd = String(conversation.updated_at || "") + "|" + (conversation.seen === false ? "unread" : "seen");
  // NGOẠI LỆ: conv CHƯA ĐỌC + khách nhắn cuối (_unreadCustomerWaiting) -> khách ĐANG CHỜ thật.
  //  Đừng để chốt skipUpd chặn im lặng (các vòng trước có thể đã set skipUpd=_curUpd khi bị coi "đã xử lý"),
  //  vì như vậy tin nhắn TRƯỚC khi bật bot sẽ không bao giờ được đọc lại + trả. Cho đi tiếp để xử.
  if (!_unreadCustomerWaiting && _curUpd && mem.skipUpd === _curUpd) return false;

  const data = await readConversation(conversationId, conversation);

  // ===== HẬU MÃI: đơn ĐÃ mua đang GIAO LẠI / HOÀN (người thật đang lo) -> NHƯỜNG NGƯỜI THẬT, KHÔNG bán =====
  // Tín hiệu hậu mãi nằm trong tin KHÁCH/NGƯỜI THẬT (giao lại / hoàn / phí ship hoàn...). Bắt SỚM, TRƯỚC cổng ad
  // + trước size/ảnh, để bot KHÔNG báo giá / hỏi size / gửi ảnh đè lên việc người thật đang xử giao-hoàn.
  // (Đơn đã chốt qua bot thì bỏ qua: luồng sau-chốt có xử riêng.)
  try {
    // CHỈ nhường-người-thật khi khách THỰC SỰ vừa nhắn (shop/NV CHƯA trả lời sau tin khách cuối).
    // Nếu shop/NV/bot nhắn cuối (khách im) -> KHÔNG gắn thẻ (tránh gắn lặp vô hạn khi khách không nhắn gì,
    // vd shop tự nhắn follow-up giao hàng trên đơn đã chốt -> detector bắt từ khoá -> gắn -> NV gỡ -> bot gắn lại).
    const _psBatch = getLastCustomerMessages(data.messages) || [];
    const _psText = _psBatch.filter(m => m && m.type === "text").map(m => m.text || "").join(" ");
    if (!mem.orderClosed && _psBatch.length && !shopRepliedAfterLastCustomer(data.messages)
        && (postSaleContext(data.messages) || saysOrderAlreadyPlaced(_psText))) {
      await tagChoXuLyVaUnread(conversationId);
      mem.lastBotReply = HUMAN_CHECK_REPLY; mem.botHandoffAt = Date.now();
      console.log(`[${BOT_NAME}] HẬU MÃI/ĐƠN ĐÃ CÓ (giao lại/hoàn/"hôm trước lên đơn rồi") -> gắn người thật, AI đứng ngoài. Conv: ${conversationId}`);
      updateConversationState(conversationId, mem); markProcessed(_psBatch);
      return true;
    }
  } catch (_) {}

  // Mốc thời điểm tin KHÁCH (inbox) cuối lúc bắt đầu lượt -> sendGallery dùng để biết khách có chen tin MỚI
  // trong lúc đang gửi loạt ảnh (thì NGỪNG bắn tiếp, tránh đè/trôi tin khách).
  try {
    const _lastCust = getLastCustomerMessages(data.messages);
    if (_turnCtx && _turnCtx.convId === conversationId && _lastCust.length) {
      _turnCtx.lastCustAt = new Date(_lastCust[_lastCust.length - 1].insertedAt).getTime();
    }
  } catch (_) {}

  // ===== DUMP CHẨN ĐOÁN ADS: in field cấp HỘI THOẠI `ads` / `ad_ids` từ object LIST (v2) =====
  // API tin-nhắn KHÔNG trả creative ad. Ad ID THẬT (vd 120253029752640550) + có thể cả post/ảnh
  // nhiều khả năng nằm ở conversation.ads / conversation.ad_ids. In RA để khoá đúng nguồn rồi mới xử.
  try {
    const _hasAdField = (conversation && (conversation.ad_ids || conversation.ads)) || data.fromAd;
    if (_hasAdField && logThrottle("adsraw_" + conversationId)) {
      console.log(`[ADS RAW] conv=${conversationId} | ad_ids=${JSON.stringify(conversation && conversation.ad_ids || null)} | ads=${JSON.stringify(conversation && conversation.ads || null).slice(0, 600)} | post_id=${conversation && conversation.post_id || "-"} | readerAdId=${data.adId || "-"}`);
    }
  } catch (_) {}

  // ===== Ad ID THẬT + post_id của bài ad từ field HỘI THOẠI (ads/ad_ids) =====
  // API tin-nhắn KHÔNG trả creative ad; chỉ object hội thoại (list v2) có. Đây là NGUỒN ĐÚNG:
  // - ad_ids[0] / ads[0].ad_id = Ad ID THẬT (vd 120253029752640550) -> dùng để TRA MAP + dedup.
  // - ads[0].post_id = bài ad (thường là dark post, đọc creative hay rỗng) -> chỉ ghi chú.
  try {
    const _ads = conversation && Array.isArray(conversation.ads) ? conversation.ads : null;
    const _adIds = conversation && Array.isArray(conversation.ad_ids) ? conversation.ad_ids : null;
    // ads có thể là DANH SÁCH nhiều ad -> ưu tiên ad MỚI NHẤT (inserted_at lớn nhất) = ad khách vừa bấm.
    let _cands = [];
    if (_ads && _ads.length) {
      _cands = _ads.map(a => ({
        adId: a && a.ad_id ? String(a.ad_id) : null,
        postId: a && a.post_id ? String(a.post_id).split("_").pop() : null,
        t: a && a.inserted_at ? new Date(a.inserted_at).getTime() : 0
      })).filter(c => c.adId || c.postId).sort((x, y) => y.t - x.t);
    } else if (_adIds && _adIds.length) {
      _cands = _adIds.map(id => ({ adId: String(id), postId: null, t: 0 }));
    }
    if (_cands.length) {
      data.fromAd = true;
      data.adCandidates = _cands;                 // [{adId, postId}] mới->cũ: tra map theo ad_id HOẶC post_id
      if (_cands[0].adId) data.adId = _cands[0].adId;
      if (_cands[0].postId && !data.adPostId) data.adPostId = _cands[0].postId;
    }
  } catch (_) {}

  // Không thẻ -> xoá mốc bàn giao cũ (nếu có) để khỏi vướng, rồi xử lý bình thường.
  if (mem.botHandoffAt) {
    mem.botHandoffAt = 0;
    // Thẻ giữ vừa bị GỠ (người thật muốn AI thử lại) -> BỎ đánh dấu "đã xử lý" cụm tin khách cuối
    // để AI trả lời lại NGAY trong lượt này, không phải tắt/bật lại cmd.
    try {
      const _lastBatch = getLastCustomerMessages(data.messages) || [];
      let _cleared = 0;
      for (const m of _lastBatch) { if (processedMessageIds.delete(m.messageId)) _cleared++; processingMessageIds.delete(m.messageId); }
      if (_cleared) { saveProcessed(processedMessageIds); console.log(`[${BOT_NAME}] Thẻ giữ vừa bị GỠ -> cho AI xử lý lại ${_cleared} tin khách cuối. Conv: ${conversationId}`); }
    } catch (_) {}
    updateConversationState(conversationId, mem);
  }

  const isCommentOrigin =
    String(conversation.type || "").toUpperCase() === "COMMENT" || !!data.postId;
  const windowOpen = data.canInbox === true || hasInboxMessage(data.messages);
  const inboxId = data.inboxConversationId;
  // ĐÍCH gửi DM cho tin ĐẦU từ comment:
  //  - ƯU TIÊN kênh private_reply (m_...) -> FB gắn banner "phản hồi bình luận + Link Facebook"
  //    để ADMIN biết tin nhắn xuất phát từ bình luận nào (truy nguồn). Tin này vẫn vào luồng Messenger.
  //  - Không có private_reply -> mới gửi vào hội thoại inbox (sẽ KHÔNG có banner).
  const dmTarget =
    (data.privateReplyId ? data.privateReplyId :
      ((data.canInbox === true && inboxId) ? inboxId :
        (windowOpen ? (inboxId || conversationId) : null)));
  const humanInbox = humanTookOverInbox(data.messages);
  const humanComment = humanTookOverComment(data.messages);   // [FIX Khoai Khoai] người thật đã trả lời COMMENT công khai

  // ===== HỘI THOẠI TỪ BÌNH LUẬN: BOT LO TRỌN LUỒNG =====
  // 1) (tùy chọn) Trả lời comment công khai.
  // 2) Nhắn RIÊNG vào HỘI THOẠI INBOX: mẫu + giá + size + 3 ảnh.
  if (isCommentOrigin) {
    // [FIX Khoai Khoai] Bình luận này NGƯỜI THẬT đã trả lời (kênh COMMENT công khai HOẶC đã vào inbox)
    //  -> bot IM HẲN, KHÔNG chen (không gửi giá/ảnh inbox, không thả comment công khai).
    //  (Lỗi cũ: humanTookOverInbox chỉ soi INBOX nên người thật trả lời ở COMMENT thì lọt -> bot chen.)
    //  SIẾT: chỉ áp cho conv COMMENT THẬT (type=COMMENT). KHÔNG đụng conv ad-inbox (type=INBOX + postId)
    //  để khách bấm AD MỚI vẫn được báo giá bình thường (không regress luồng ad).
    const _isRealCommentConv = String(conversation.type || "").toUpperCase() === "COMMENT";
    if (_isRealCommentConv && (humanInbox || humanComment)) {
      console.log(`[${BOT_NAME}] [BỎ QUA comment] ${data.customerName || conversationId}: người thật đã trả lời (${humanComment ? "comment" : ""}${humanComment && humanInbox ? "+" : ""}${humanInbox ? "inbox" : ""}) -> bot ĐỨNG NGOÀI, không chen. post: ${data.postId}`);
      return false;
    }
    // comment mới nhất của khách (để lấy comment id + để chào công khai)
    const custComments = (data.messages || []).filter(m => m.sender === "customer" && m.channel === "COMMENT");
    const lastComment = custComments[custComments.length - 1];
    const commentId = lastComment ? lastComment.messageId : null;

    // [FIX Thu Hiền 2026-07-17] Conv comment có id = bàiId_kháchId TÁI SỬ DỤNG VĨNH VIỄN: khách từng
    // comment bài này (bot đã gửi giá 1 lần, cờ commentProductSent=true nằm lì trong bộ nhớ) -> comment
    // MỚI hôm nay bị coi "đã phục vụ rồi" -> IM VĨNH VIỄN, rơi xuống [BỎ QUA batch rỗng]. Luật: comment
    // MỚI hơn lần phục vụ trước >= 10 phút -> MỞ LẠI luồng comment phục vụ như lần đầu.
    if ((mem.commentProductSent || mem.commentOpenerSent) && lastComment
        && parseTime(lastComment.insertedAt) > (mem.commentServedAt || 0) + 10 * 60 * 1000) {
      console.log(`[COMMENT] khách comment MỚI (${lastComment.insertedAt}) sau lần phục vụ trước -> MỞ LẠI luồng comment. Conv: ${conversationId}`);
      mem.commentProductSent = false; mem.commentOpenerSent = false;
    }
    // ----- BƯỚC 2: nhắn RIÊNG mẫu + giá + size + 3 ảnh (1 lần) -----
    if (!mem.commentProductSent && !mem.commentOpenerSent && !humanInbox) {
      if (!commentId && !dmTarget) {
        console.log("COMMENT: chưa có comment id / kênh nhắn riêng -> chờ. post:", data.postId);
        return false;
      }
      // FIX video/reel: caption bài thường nằm ở adTitle (postCaption rỗng khi đọc reel) -> GỘP đủ nguồn
      // (postCaption + adTitle + candidates) rồi mới dò tên mẫu. norm() đã NFKC nên chữ in đậm vẫn khớp.
      const _postCap = [data.postCaption, data.adTitle, ...(data.adCaptionCandidates || [])]
        .filter(c => c && String(c).trim()).join(" \n ");
      const _postRes = await resolveProductFromPost(_postCap, data.postImages);
      const product = _postRes && _postRes.product ? _postRes.product : null;
      const _postColor = _postRes && _postRes.color ? _postRes.color : "";
      // QUY TẮC 1 MẪU / 1 LẦN GIÁ / 24h: nếu mẫu này đã báo giá ở luồng ad/inbox trong 24h -> chỉ dẫn dắt, KHÔNG lặp giá.
      const opener = openerOrLead(product, mem);
      console.log(
        "COMMENT chuẩn bị nhắn riêng | post:", data.postId,
        "| inboxId:", inboxId, "| privateReplyId:", data.privateReplyId,
        "| commentId:", commentId, "| can_inbox:", data.canInbox
      );

      // Gửi qua private_replies theo COMMENT ID. LƯU Ý: banner "phản hồi bình luận + link"
      // do FACEBOOK quyết định (thường chỉ hiện với khách CHƯA có luồng inbox). success!=false
      // chỉ nghĩa là gửi được, KHÔNG đảm bảo có banner.
      // ƯU TIÊN private_reply theo COMMENT ID -> FB gắn banner "phản hồi bình luận + Link Facebook"
      // để biết khách đến từ bài nào. Ảnh gửi RIÊNG ở bước sau (chờ FB mở thread).
      let ok = false, effTarget = inboxId || conversationId, prResp = null;
      // post_id để FB gắn banner "phản hồi bình luận + Link". Comment conv id = "POSTID_xxx"
      // -> nếu reader chưa ra postId, lấy POSTID ngay từ id hội thoại (khác page id) -> có banner.
      const _convFirst = String(conversationId).split("_")[0];
      const _postIdForReply = data.postId
        || ((_convFirst && _convFirst !== String(PAGE_ID) && /^\d{6,}$/.test(_convFirst)) ? _convFirst : null);
      if (commentId) {
        prResp = await sendPrivateReply(conversationId, opener, commentId, _postIdForReply);
        ok = prResp && prResp.success !== false;
        console.log("COMMENT private_replies | commentId:", commentId, "| post_id:", _postIdForReply, "| can_reply_privately:", data.canReplyPrivately, "| PHẢN HỒI:", JSON.stringify(prResp));
        if (ok) effTarget = inboxId || conversationId;
      }
      // Fallback: gửi thẳng vào inbox (KHÔNG banner) nếu private_replies không được
      if (!ok) {
        const target = inboxId || (data.privateReplyId || conversationId);
        const r = await sendInboxMessage(target, opener);
        ok = r && r.success !== false;
        if (ok) effTarget = target;
        console.log("COMMENT fallback inbox | đích:", target, "| OK:", ok);
      }
      console.log(
        "COMMENT->INBOX (tin sản phẩm):", opener,
        "| mẫu:", product ? `${product.name}(${product.code})` : "(không nhận ra)",
        "| đích ảnh:", effTarget, "| gửi OK?:", ok
      );
      mem.commentProductSent = true;
      mem.commentServedAt = Date.now();   // [FIX Thu Hiền] mốc phục vụ - so với comment mới để mở lại luồng
      if (product) {
        mem.currentProduct = product;
        mem.commentPostProduct = product;
        mem.quotedProducts = [product];
        const k = String(product.code || "").toUpperCase();
        if (k && (product.priceText || priceIsValid(product.price))) {
          markPriced(mem, k);
        }
        // Khách nói rõ MÀU trong BÌNH LUẬN (vd "Giannal màu Hồng") -> lọc ảnh đúng màu (như luồng ads).
        // AN TOÀN: chỉ ép màu khi mẫu THỰC SỰ có ảnh màu đó; không có -> gửi ảnh mặc định (tránh strict -> rỗng).
        try {
          const _cmtText = custComments.map(c => c.text).filter(Boolean).join(" ");
          const _cmtColor = extractColor(_cmtText);
          if (_cmtColor) {
            let _hasColor = false;
            try { _hasColor = (imageItemsByColor(k, _cmtColor, 1, false) || []).length > 0; } catch (_) {}
            if (_hasColor) {
              mem.askedImageColor = _cmtColor;
              console.log(`[${BOT_NAME}] Comment: khách xin màu "${_cmtColor}" + mẫu ${k} CÓ ảnh màu đó -> gửi đúng màu.`);
            } else {
              console.log(`[${BOT_NAME}] Comment: khách xin màu "${_cmtColor}" nhưng mẫu ${k} KHÔNG có ảnh màu đó -> gửi ảnh mặc định.`);
            }
          }
          // Khách KHÔNG xin màu cụ thể -> nhớ MÀU Ở BÀI ĐĂNG để gửi lại ảnh CÙNG màu bài (men theo bài comment).
          if (!_cmtColor && _postColor) {
            mem.sourceColorByCode = Object.assign({}, mem.sourceColorByCode || {}, { [k]: _postColor });
            console.log(`[${BOT_NAME}] Comment: màu Ở BÀI = "${_postColor}" (mẫu ${k}) -> gửi lại ảnh đúng màu bài (khách chưa xin màu).`);
          }
        } catch (_) {}
        // 3 ẢNH của mẫu - gửi RIÊNG vào cùng đích DM, SAU tin chữ (chờ FB mở thread cho media).
        // CHỈ gửi ảnh khi CỬA SỔ 24h ĐÃ MỞ (khách đã nhắn inbox). Comment-only -> FB chỉ cho 1 tin
        // private-reply (đã dùng cho chữ); gửi thêm ảnh sẽ dính #10 "ngoài khoảng thời gian".
        let _commentImgSent = false;   // chỉ true khi ảnh THỰC SỰ gửi được -> mới đánh dấu đã-gửi bên inbox
        // [FIX Phạm Thu Quỳnh] TRƯỚC: windowOpen=false (khách mới comment, chưa nhắn inbox) -> KHÔNG thử gửi, phán luôn
        //   "HOÃN gửi ảnh". Nhưng THỰC TẾ gửi ảnh qua private_reply VẪN ĐƯỢC (chữ đã gửi được thì ảnh thường cũng được)
        //   -> "chưa thử đã báo không gửi được" là SAI. NAY: LUÔN THỬ GỬI; chỉ khi gửi HỤT THẬT mới gắn thẻ nợ ảnh.
        //   (lớp gửi ảnh đã tự xử #10 "ngoài cửa sổ 24h" = dừng, không spam -> thử là an toàn.)
        if (ok && !mem.sentImageCodes.includes(k)) {
          let _imgOk = false;
          try {
            await delay(2200);   // chờ FB MỞ thread inbox cho media (800ms chưa kịp -> "Something went wrong")
            _imgOk = await maybeSendImages(effTarget, k, mem, true);
          } catch (e) {
            console.log("COMMENT->INBOX ảnh: LỖI", e.message);
          }
          _commentImgSent = !!_imgOk;
          // Gửi HỤT THẬT (ngoài cửa sổ 24h / mẫu thiếu ảnh / lỗi) -> GẮN THẺ AI-XL ảnh (nợ ảnh).
          //   Khách nhắn inbox (cửa sổ mở) bot gửi ảnh -> thẻ TỰ GỠ ở luồng gửi ảnh (untagXuLyAnh khi gửi OK).
          if (!_imgOk) {
            try { await tagXuLyAnhVaUnread(effTarget); } catch (_) {}
            if (inboxId && inboxId !== effTarget) { try { await tagXuLyAnhVaUnread(inboxId); } catch (_) {} }
            mem.botHandoffAt = Date.now();
            console.log(`[${BOT_NAME}] COMMENT: THỬ gửi ảnh mẫu ${k} CHƯA được (ngoài cửa sổ 24h/thiếu ảnh) -> gắn thẻ AI-XL ảnh (nợ ảnh; khách nhắn inbox sẽ gửi + TỰ GỠ thẻ).`);
          }
        }
        // LƯU mẫu sang hội thoại INBOX -> khi khách trả lời tiếp trong tin nhắn, bot bám đúng mẫu.
        if (inboxId && inboxId !== conversationId) {
          try {
            const im = getConversationState(inboxId);
            im.currentProduct = product;
            im.commentPostProduct = product;
            im.quotedProducts = [product];
            im.pricedCodes = Array.from(new Set([...(im.pricedCodes || []), k].filter(Boolean)));
            // CHỈ đánh dấu đã-gửi-ảnh khi THỰC SỰ gửi được. Nếu HOÃN (cửa sổ chưa mở) -> KHÔNG thêm k
            // -> khi khách NHẮN INBOX (cửa sổ mở), luồng inbox sẽ gửi ảnh mẫu này.
            if (_commentImgSent) im.sentImageCodes = Array.from(new Set([...(im.sentImageCodes || []), k].filter(Boolean)));
            // QUAN TRỌNG cho quy tắc 24h: chép cả MỐC GIỜ báo giá (pricedAt). Thiếu nó -> quotedRecently
            // bên inbox = false -> báo giá LẠI mẫu này khi khách chuyển từ comment sang nhắn tin (lỗi 24h).
            im.pricedAt = Object.assign({}, im.pricedAt || {}, mem.pricedAt || {});
            // Chép MÀU BÀI để gửi lại ảnh đúng màu khi khách nhắn tiếp bên inbox.
            if (mem.sourceColorByCode) im.sourceColorByCode = Object.assign({}, im.sourceColorByCode || {}, mem.sourceColorByCode);
            updateConversationState(inboxId, im);
          } catch (_) {}
        }
      }
      mem.lastBotReply = opener;
      mem.askedContact = false;

      // ----- SAU KHI ĐÃ NHẮN RIÊNG: trả lời CÔNG KHAI dưới bình luận (điều hướng qua tin nhắn,
      //       KHÔNG báo giá, KHÔNG tư vấn sâu) + LIKE bình luận. Botcake đã tắt nên Node lo. -----
      if (POST_PUBLIC_COMMENT && commentId && ok && !mem.commentPublicReplied && !humanInbox) {
        const ten = String(data.customerName || "").trim();
        const hook = ten
          ? `Dạ chị ${ten} check tin nhắn shop vừa gửi nhe ạ, em vừa gửi thông tin chi tiết để tư vấn kỹ hơn cho mình rồi đó ạ`
          : "Dạ chị check tin nhắn shop vừa gửi nhe ạ, em vừa gửi thông tin chi tiết để tư vấn kỹ hơn cho mình rồi đó ạ";
        try {
          const r = await replyComment(conversationId, hook, commentId);
          const rok = r && r.success !== false;
          console.log("COMMENT (CÔNG KHAI điều hướng):", hook, "| OK?:", rok, "| PHẢN HỒI:", JSON.stringify(r));
          if (rok) mem.commentPublicReplied = true;
        } catch (e) { console.log("COMMENT công khai LỖI:", e.message); }
      }

      updateConversationState(conversationId, mem);
      return true;
    }
    // Đã nhắn sản phẩm -> xử lý tin nhắn của khách bên dưới (nếu có).
  }

  // ===== TIN TỪ QUẢNG CÁO -> BÁO GIÁ ĐÚNG mẫu trong bài quảng cáo (ĐÈ mẫu đang khóa) =====
  // Khách vừa bấm vào ads mẫu MỚI -> phải báo giá mẫu ads đó, KHÔNG nối tiếp mẫu đang tư vấn.
  // Ngoại lệ: bấm ads RỒI gửi ẢNH khác -> tư vấn theo ảnh khách (KHÔNG ép mẫu ads).
  const _adTurnHasImage = getLastCustomerMessages(data.messages).some(x => x.type === "image" && x.imageUrl);
  // Ảnh MỚI khách gửi lượt này (KHÔNG tính ảnh CŨ bóc từ replied_message) -> để phân biệt "khách vừa gửi ảnh"
  //   vs "khách reply tin cũ có ảnh". Ảnh reply là NGỮ CẢNH CŨ, KHÔNG được đè ad khách vừa bấm.
  const _freshTurnImage = getLastCustomerMessages(data.messages).some(x => x.type === "image" && x.imageUrl && !x.fromReply);
  const _adId = data.adId || null;
  mem._adUnresolvedModel = false;   // reset đầu lượt: cờ "ad không ra mẫu" chỉ sống trong lượt xử lý hiện tại
  // Tin khách LƯỢT NÀY (text). Nếu là CÂU HỎI TIẾP về mẫu (khai cân nặng + hỏi size, hỏi size, bảng size,
  // chất, địa chỉ) MÀ đã từng báo giá mẫu trong hội thoại -> khách ĐANG được tư vấn, KHÔNG phải bấm AD MỚI.
  const _adCustNow = getLastCustomerMessages(data.messages).filter(m => m && m.type === "text").map(m => m.text || "").join(" ");
  // CÂU HỎI THUỘC TÍNH MẪU (lót/quần trong, đệm ngực, co giãn, mỏng/hở, sợ ngắn, màu khác, còn hàng).
  // Đây là khách HỎI SÂU về mẫu đang xem -> KHÔNG phải bấm ad mới -> TUYỆT ĐỐI không báo giá lại,
  // phải để handler thuộc tính (vd "có quần/lót bên trong" ~dòng 6225) trả lời / hoặc giao người thật.
  // (Lỗi gốc: "Có quần trong k shop" rơi vào cổng ADS -> buildCommentOpener -> báo giá lại, nuốt câu hỏi.)
  const _adAttrQ = asksInnerLining(_adCustNow) || asksBreastPad(_adCustNow) || asksStretch(_adCustNow)
    || isSheerConcern(_adCustNow) || worriesGarmentShort(_adCustNow)
    || asksSkirtOrSet(_adCustNow) || asksCategory(_adCustNow)   // liền hay rời / áo hay váy hay set -> ĐỂ HANDLER trả lời, không báo giá đè
    || asksOtherColors(_adCustNow) || asksInStock(_adCustNow);
  const _adFollowupQ = asksWeightForSize(_adCustNow) || !!parseWeightKg(_adCustNow)        // "50 ký mặc size nào"
    || !!extractStatedSize(_adCustNow) || asksWhichSizeAdvice(_adCustNow) || asksWhatSize(_adCustNow)
    || asksSizeChart(_adCustNow) || asksMaterial(_adCustNow) || asksShopAddress(_adCustNow)
    || _adAttrQ;   // BỔ SUNG: câu hỏi thuộc tính cũng là HỎI TIẾP về mẫu (không báo giá lại)
  // ĐÃ từng báo giá mẫu trong hội thoại này (lock có thể bị xoá nhưng pricedCodes vẫn còn) -> không phải khách mới.
  // ĐỌC THÊM LỊCH SỬ TIN (botQuotedPriceInHistory): sau RESTART mem mất sạch -> vẫn biết "đã báo giá rồi"
  // -> mọi câu HỎI TIẾP (size/số đo/chất/màu...) KHÔNG bị cổng ADS báo giá LẠI. (Yêu cầu shop: cổng ADS phải nhớ.)
  const _adHadModel = !!(mem.currentProduct || (mem.pricedCodes && mem.pricedCodes.length)
    || botQuotedPriceInHistory(data.messages));
  // Khách KHAI cân nặng/số đo (không phải mua hộ) = đang TRẢ LỜI câu hỏi size -> CHẮC CHẮN mẫu đã được
  // bàn từ trước (không ai tự khai cân nặng khi chưa xem mẫu). Sau RESTART mem mất sạch -> _adHadModel=false
  // -> cổng ADS tưởng "ad mới" báo giá LẠI, nuốt câu cao/nặng. Cờ này buộc cổng ADS NHƯỜNG handler tính size,
  // và buộc KHÔI PHỤC mẫu (từ adId->mã) dù pricedCodes rỗng. (Giống guard _givesBodyInfo ở đường Hỏi-giá.)
  const _adGivesBody = (!!parseWeightKg(_adCustNow) || !!parse3V(_adCustNow) || !!parseBodyMeasures(_adCustNow)) && !isGiftContext(_adCustNow);
  const _adSkipForFollowup = (_adFollowupQ && _adHadModel) || _adGivesBody;
  // KHÔI PHỤC khoá mẫu khi khách hỏi tiếp NHƯNG lock đã bị xoá / mất state (log: lock= trống).
  // Chạy cho cả _adSkipForFollowup LẪN _adAttrQ (kể cả khi pricedCodes rỗng) -> đảm bảo productInfo có
  // để handler thuộc tính (lót/đệm/co giãn/size...) trả lời, KHÔNG rơi vào "Hỏi giá mẫu mới".
  if ((_adSkipForFollowup || _adAttrQ) && !mem.currentProduct) {
    try {
      const _c = await ensureCatalog();
      let _p = null;
      // (a) Từ pricedCodes (mẫu vừa báo giá trong hội thoại này).
      if (mem.pricedCodes && mem.pricedCodes.length) {
        const _lastCode = String(mem.pricedCodes[mem.pricedCodes.length - 1] || "").toUpperCase();
        _p = _c.byCode.get(_lastCode) || null;
      }
      // (b) Mất sạch state -> resolve lại mẫu từ ADS: map adId/postId -> mã, hoặc mã nằm trong tên ad.
      if (!_p && _adId) {
        // [FIX Nhung Cao] ƯU TIÊN postId (bài khách THỰC comment/lượt này) trước adPostId (metadata ads,
        //   dễ là ad CŨ trỏ bài mẫu KHÁC -> resolve nhầm Giannal thay vì Miretta).
        const _mc = (data.postId && lookupAdProduct(data.postId)) || lookupAdProduct(_adId) || (data.adPostId && lookupAdProduct(data.adPostId));
        if (_mc) _p = _c.byCode.get(String(_mc).toUpperCase()) || ((await findInText(String(_mc))) || [])[0] || null;
        if (!_p && data.adTitle) {
          const _toks = String(data.adTitle).toUpperCase().match(/[A-Z0-9]{6,}/g) || [];
          for (const tk of _toks) { const _q = _c.byCode.get(tk); if (_q) { _p = _q; break; } }
        }
      }
      if (_p) {
        mem.currentProduct = _p; mem.quotedProducts = [_p];
        console.log(`[${BOT_NAME}] Ads follow-up/thuộc-tính (khách hỏi "${_adCustNow.slice(0, 30)}") -> KHÔI PHỤC khoá mẫu ${_p.code} để handler trả lời (lót/đệm/co giãn/size...).`);
      }
    } catch (_) {}
  }
  // [FIX Nhung Cao 2026-07-07] SỔ adId ĐÃ THẤY trong hội thoại: metadata ads DÍNH SẴN trên conv nên
  //   lượt NÀO cũng đọc ra _adId (khách KHÔNG hề bấm gì). Chỉ coi là "KHÁCH BẤM AD MỚI" khi adId này
  //   CHƯA TỪNG xuất hiện ở các lượt trước. Ad cũ dính sẵn -> KHÔNG được xoá lock (lỗi Nhung Cao: lock
  //   ảnh Miretta MRKSQ6035 bị ad Giannal dính sẵn xoá ngay lượt khách nhắn "Kem" -> CHỐT ĐƠN NHẦM MẪU).
  //   Ca GRAVELLE/Celyne (bấm ad mới THẬT) vẫn chạy: adId lần đầu xuất hiện -> _adIsNewClick=true -> xoá như cũ.
  mem.seenAdIds = mem.seenAdIds || [];
  const _adIsNewClick = !!(_adId && !mem.seenAdIds.includes(String(_adId)));
  if (_adId && _adIsNewClick) {
    mem.seenAdIds.push(String(_adId));
    if (mem.seenAdIds.length > 20) mem.seenAdIds = mem.seenAdIds.slice(-20);
  }
  // KHÁCH BẤM AD MỚI (khác ad đã chốt/khóa trước đó) + đơn CHƯA chốt -> XOÁ KHÓA MẪU CŨ để ad mới resolve sạch.
  // (Lỗi: khách từng hỏi Miretta/Corine ở tin cũ -> bấm ad Celyne nhưng bot bám mẫu cũ -> báo giá SAI.)
  // NHƯNG: nếu khách chỉ HỎI TIẾP về mẫu đang khoá (size/chất...) -> KHÔNG xoá (kẻo switch=true -> báo giá lại).
  if (data.fromAd && _adId && _adIsNewClick && mem.lastAdId && String(_adId) !== String(mem.lastAdId) && !mem.orderClosed
      && !_adSkipForFollowup) {
    mem.currentProduct = null; mem.commentPostProduct = null; mem.quotedProducts = []; mem.adQuotedFor = null;
    console.log(`[${BOT_NAME}] Bấm AD MỚI (${_adId} khác ad cũ ${mem.lastAdId}) -> xoá khóa mẫu cũ, resolve theo ad mới.`);
  }
  // BỔ SUNG (ưu tiên GẦN NHẤT): mẫu cũ khoá bởi ẢNH khách gửi (KHÔNG qua ad -> mem.lastAdId trống) mà giờ khách
  //   BẤM AD MỚI và lượt này KHÔNG gửi ảnh MỚI (chỉ có ảnh CŨ bóc từ replied_message) -> AD mới THẮNG ảnh cũ.
  //   (Lỗi GRAVELLE: khách gửi ảnh Fioraia trước, sau bấm ad Gravelle -> bot vẫn báo Fioraia vì fix cũ chỉ xử ad-vs-ad.)
  // [FIX Nhung Cao] thêm _adIsNewClick: ad DÍNH SẴN (đã thấy ở lượt trước) thì KHÔNG thắng ảnh cũ nữa.
  if (data.fromAd && _adId && _adIsNewClick && !mem.lastAdId && mem.currentProduct && !mem.orderClosed
      && !_adSkipForFollowup && !_freshTurnImage && mem.adQuotedFor !== _adId) {
    mem.currentProduct = null; mem.commentPostProduct = null; mem.quotedProducts = []; mem.adQuotedFor = null;
    console.log(`[${BOT_NAME}] Bấm AD MỚI (${_adId}), mẫu cũ khoá bởi ẢNH (lastAdId trống) + lượt này KHÔNG ảnh mới -> AD thắng ảnh cũ, xoá lock.`);
  }
  const _alreadyQuotedAd = !!(_adId && mem.adQuotedFor === _adId);            // đã báo ĐÚNG mẫu cho ads này rồi
  const _adTries = (mem.adTryId === _adId) ? (mem.adTryCount || 0) : 0;        // số lần đã thử cho ads này
  // CHẨN ĐOÁN: in đủ điều kiện cổng ads (chỉ khi có dấu hiệu ad) để biết VÌ SAO luồng ads không chạy.
  if (data.fromAd || _adId) try {
    console.log(`[ADS GATE] fromAd=${data.fromAd} adId=${_adId} | commentOrigin=${isCommentOrigin} commentOpener=${!!mem.commentOpenerSent} human=${humanInbox} orderClosed=${!!mem.orderClosed} turnImg=${_adTurnHasImage} alreadyQuoted=${_alreadyQuotedAd} tries=${_adTries} shopReplied=${shopRepliedAfterLastCustomer(data.messages)} | lock=${_codeUp(mem.currentProduct)} cap="${String(data.adTitle || data.postCaption || "").replace(/\s+/g, " ").slice(0, 45)}"`);
  } catch (_) {}
  // ===== KHÁCH BẤM ADS (mẫu A) NHƯNG GỬI ẢNH mẫu KHÁC (B) -> coi như 2 SẢN PHẨM =====
  // Lượt có ẢNH thì cổng ADS dưới (có !_adTurnHasImage) bị bỏ qua -> mẫu ADS "treo" rồi báo TRỄ ở lượt sau
  // (không ảnh) -> ĐÈ focus mẫu ảnh (lỗi Mona/Plena). Sửa: ĐÁNH DẤU adQuotedFor NGAY (chặn cổng ADS chạy lại
  // lượt sau) + GHIM mẫu ADS để báo LIỀN SAU mẫu ảnh khách (cùng lượt, liền nhau).
  if (data.fromAd && _adId && _adTurnHasImage && !mem.orderClosed && !isCommentOrigin
      && !mem.adQuotedFor && !mem.pendingAdQuote && !mem.commentOpenerSent) {
    let _adP = null;
    try {
      // [FIX Nhung Cao] ƯU TIÊN postId (bài lượt này) trước adPostId (metadata ads dính sẵn).
      const _mc = (data.postId && lookupAdProduct(data.postId)) || lookupAdProduct(_adId) || (data.adPostId && lookupAdProduct(data.adPostId));
      if (_mc) { const _c = await ensureCatalog(); _adP = _c.byCode.get(String(_mc).toUpperCase()) || ((await findInText(String(_mc))) || [])[0] || null; }
    } catch (_) {}
    if (!_adP) {
      try {
        const _c = await ensureCatalog();
        const _toks = String(data.adTitle || "").toUpperCase().match(/[A-Z0-9]{6,}/g) || [];
        for (const tk of _toks) { const _p = _c.byCode.get(tk); if (_p) { _adP = _p; break; } }
      } catch (_) {}
    }
    if (!_adP) { try { const _h = await findInText(String(data.adTitle || "")); if (_h && _h.length) _adP = _h[0]; } catch (_) {} }
    // Dù CÓ/ KHÔNG resolve được mẫu ADS -> vẫn khoá cổng ADS (chặn báo TRỄ đè focus).
    mem.adQuotedFor = _adId; mem.lastAdId = _adId;
    if (_adP) {
      // [SỬA Palia+Galisse] KHÔNG ghim mẫu ADS làm "SP thứ 2" nữa. Khách gửi ẢNH mẫu mới (Palia) thì CHỈ báo
      //   đúng mẫu ảnh đó; KHÔNG lôi mẫu ad (thường là ad CŨ, vd Galisse tháng 6) vào báo giá kèm -> tránh
      //   báo giá mẫu khách KHÔNG hỏi ở lượt này. Vẫn khoá cổng ADS ở trên để mẫu ad không đè focus lượt sau.
      console.log(`[${BOT_NAME}] ADS (${_adP.code}/${_adP.name}) + khách gửi ẢNH mẫu KHÁC -> CHỈ báo mẫu ảnh, KHOÁ cổng ADS (KHÔNG ghim mẫu ad làm SP2).`);
    } else {
      console.log(`[${BOT_NAME}] ADS (adId=${_adId}) chưa resolve được mẫu + khách gửi ẢNH mẫu khác -> KHOÁ cổng ADS (chống đè focus), tư vấn theo ảnh khách.`);
    }
  }
  const _adTextBlocks = adCustTextBlocksQuote(_adCustNow) || isSensitiveHandoff(_adCustNow) || isPriorityOrder(_adCustNow) || asksOrderStatus(_adCustNow)
    || wantsToExchange(_adCustNow) || asksExchangeReceived(_adCustNow)   // ĐỔI HÀNG / hỏi "shop nhận hàng đổi chưa" (hậu mãi) -> KHÔNG báo giá đè, nhường người thật
    || customerGaveContact(_adCustNow) || mem._addrJustGiven;   // khách CHO sđt/địa chỉ (SẴN SÀNG CHỐT) -> KHÔNG báo giá lại + hỏi size, để LUỒNG CHỐT lo
  // Tin khách CHỈ là 👍 / ok / ừ / cảm ơn (hoặc STICKER rỗng khi ĐANG có người thật) -> KHÔNG phải "bấm ad hỏi mẫu"
  // -> ĐỪNG báo giá đè (ca thật: thread khiếu nại giao hàng đơn đã hoàn, người thật đang xử, khách thả 👍 -> bot chen báo giá).
  // Tin khách CHỈ là 👍 / ok / ừ / cảm ơn / sticker rỗng -> KHÔNG phải "bấm ad hỏi mẫu" -> ĐỪNG báo giá đè.
  // (ca thật: thread đơn đã HOÀN, NV xử lý từ lâu, khách thả 👍 -> bot chen báo giá. KHÔNG dựa vào humanInbox vì NV có thể xử đã lâu.)
  const _adHasHistory = (Array.isArray(data.messages) && data.messages.length >= 3)
    || _alreadyQuotedAd || mem.adQuotedFor || mem.commentOpenerSent
    || (Array.isArray(mem.quotedProducts) && mem.quotedProducts.length) || mem.orderClosed;
  const _adAck = isBareAck(_adCustNow) || isAffirmation(_adCustNow) || isFriendlyRemark(_adCustNow) || isPostOrderChitChat(_adCustNow)
    || (!String(_adCustNow).trim() && _adHasHistory);
  // LẦN ĐẦU TỪ AD (chưa từng báo giá mẫu nào trong hội thoại) -> LUÔN báo giá DÙ KHÁCH GÕ GÌ
  // (size, "còn hàng", "mẫu đẹp"...). Opener sẽ BÁM size/đưa câu hành động (xem (b) bên dưới).
  // VẪN chặn ca xấu: huỷ/hoàn/đã-đặt + CHO sđt-địa-chỉ (đi CHỐT, trong _adTextBlocks) + 👍/ack (_adAck).
  const _adFirstAd = !mem.adQuotedFor && !mem.commentProductSent && !(Array.isArray(mem.quotedProducts) && mem.quotedProducts.length)
    && !botQuotedPriceInHistory(data.messages);   // LỊCH SỬ đã có báo giá -> KHÔNG phải "ad lần đầu" (sau restart mem trống vẫn biết)
  // ĐÃ có lịch sử (bấm ad mới giữa chừng) -> GIỮ chặn hỏi-thuộc-tính / hỏi-tiếp để KHÔNG báo giá LẠI (giữ FIX A).
  // Câu hỏi THUỘC TÍNH/LOẠI (lót/đệm/co giãn/mỏng/ngắn/màu/còn hàng/liền-rời/áo-váy-set) -> LUÔN nhường
  // handler trả lời (kể cả lần đầu từ ad) thay vì báo giá đè câu hỏi. Còn hỏi-tiếp khác (size/chất...) chỉ
  // nhường khi ĐÃ có lịch sử (lần đầu vẫn báo giá + bám size theo FIX M).
  const _adDontOpen = _adTextBlocks || _adAck || _adAttrQ || _adGivesBody || (!_adFirstAd && _adSkipForFollowup);
  // ===== PHƯƠNG ÁN 1: TIN MƠ HỒ (trống/like/sticker không chữ) -> GỌI AI gắn nhãn để quyết có báo giá không.
  // Tin RÕ (hỏi giá / bấm ad lần đầu có chữ) KHÔNG đụng AI (nhanh như cũ). Chỉ ca trống mới hỏi AI 1 lần.
  // Lỗi gốc: like sticker id lạ -> reader cho text RỖNG -> cổng ad coi tin-trống là "muốn báo giá" -> báo bậy.
  let _adAiSaysNoQuote = false;
  {
    const _isBlankTurn = !String(_adCustNow).trim();   // lượt này khách KHÔNG gõ chữ (like/sticker/tin trống)
    if (_isBlankTurn && data.fromAd && _adId && !mem.adQuotedFor && botQuotedPriceInHistory(data.messages)) {
      // Hội thoại ĐÃ có báo giá trước đó + giờ khách chỉ like/trống -> gần như chắc KHÔNG phải hỏi giá mới.
      // Hỏi AI cho chắc (truyền "👍" vì là like/sticker, classifyIntent bỏ qua text rỗng).
      try {
        const _lab = await classifyIntent({
          text: "👍",
          lockedProductName: (mem.currentProduct && (mem.currentProduct.name || mem.currentProduct.code)) || "",
          lastShopLine: mem.lastBotReply || ""
        });
        if (_lab && _lab.ok && !["PRICE_ASK"].includes(_lab.kind)) {
          _adAiSaysNoQuote = true;   // AI bảo KHÔNG phải hỏi giá -> cổng ad KHÔNG báo giá
          console.log(`[${BOT_NAME}] Cổng ad: tin trống/like + đã có báo giá -> AI nhãn=${_lab.kind} (không phải hỏi giá) -> KHÔNG báo giá lại.`);
        }
      } catch (_) {}
    }
  }
  const _adWantsQuote = !_adAiSaysNoQuote && (_adFirstAd || isPriceAsk(_adCustNow, mem.lastIntent)
    || (!String(_adCustNow).trim() && !botQuotedPriceInHistory(data.messages)));   // tin trống -> chỉ báo giá nếu hội thoại CHƯA có báo giá nào
  // CA NGOAN: khách nhắc NHIỀU mẫu ("mấy cái này"/"các mẫu") + lượt này KHÔNG có ảnh để bot gom đủ
  // -> cổng ad chỉ có 1 mẫu (mẫu ad) -> KHÔNG báo giá thiếu 1 mẫu -> NGƯỜI THẬT báo đủ (nguyên tắc "thiếu mẫu -> người thật").
  if (data.fromAd && _adId && referencesMultipleModels(_adCustNow) && !_adTurnHasImage && !mem.orderClosed
      && !shopRepliedAfterLastCustomer(data.messages)) {
    try { await tagChoXuLyVaUnread(conversationId); } catch (_) {}
    mem.botHandoffAt = Date.now();
    console.log(`[${BOT_NAME}] Khách nhắc NHIỀU mẫu (mấy cái này...) + không ảnh lượt này -> bot không gom đủ -> NGƯỜI THẬT. Conv: ${conversationId}`);
    mem.lastBotReply = HUMAN_CHECK_REPLY; markProcessed(getLastCustomerMessages(data.messages));
    updateConversationState(conversationId, mem); return true;
  }
  // [FIX Hoang Quynh Nga] Conv ĐẾN TỪ AD nhưng hội thoại ĐÃ là HẬU-ĐƠN (khách "đã đặt / 7 ngày từ chốt đơn /
  //   từ chối nhận hàng / khi nào nhận hàng", HOẶC shop đã xác nhận đơn trong lịch sử). Khi bot RESTART mất mem
  //   (orderClosed/alreadyQuoted=false) -> cổng ad TƯỞNG khách vừa bấm ad mới -> báo giá LẠI mẫu (Orissa). SAI.
  //   -> Soi CẢ lịch sử tin khách (không chỉ tin lượt này); nếu là hậu-đơn: bật cờ + GIAO NGƯỜI THẬT (đây hay là
  //      khiếu nại giao hàng), TUYỆT ĐỐI không báo giá lại.
  const _adHistPostOrder = !!(shopConfirmedOrderInHistory(data.messages)
    || (Array.isArray(data.messages) ? data.messages : [])
         .filter(m => m && m.sender === "customer" && m.type === "text" && m.text)
         .slice(-12)
         .some(m => adCustTextBlocksQuote(m.text)
                 || /(từ chối nhận|ngày chốt đơn|từ ngày chốt|đã chốt đơn|chốt đơn (hàng|rồi)|7 ngày.*(chốt|đặt)|nhận (đc|được|dc).*hàng.*(đặt|chốt))/i.test(String(m.text))));
  // [FIX Phuong Pham — KHÁCH CŨ ĐẶT THÊM] Khách đã có đơn NHƯNG lượt NÀY gửi ẢNH mẫu (xem mẫu mới)
  //  + KHÔNG hỏi về đơn cũ -> đây là MUA THÊM, KHÔNG giao người thật, để chạy xuống nhánh báo giá mẫu mới.
  //  (Mẫu trùng đơn đã đặt -> guard orderedByCode ở nhánh báo giá dưới tự chặn báo lại; ở đây chỉ KHÔNG chặn mua thêm.)
  const _ordQuestionNow = adCustTextBlocksQuote(String(_adCustNow || ""))
    || /(từ chối nhận|ngày chốt đơn|từ ngày chốt|đã chốt đơn|chốt đơn (hàng|rồi)|7 ngày.*(chốt|đặt)|nhận (đc|được|dc).*hàng.*(đặt|chốt)|khi nào.*(nhận|giao|hàng|ship)|bao (giờ|lâu).*(nhận|giao|hàng)|đổi (size|hàng|trả)|hoàn (hàng|tiền)|đơn (của )?(mình|em|chị|c)\b)/i.test(String(_adCustNow || ""));
  const _newModelShoppingNow = _adTurnHasImage && !_ordQuestionNow;   // gửi ẢNH mẫu mới + không hỏi đơn cũ
  if (_newModelShoppingNow && _adHistPostOrder && data.fromAd && _adId) {
    console.log(`[${BOT_NAME}] [đặt thêm] Khách đã có đơn nhưng gửi ẢNH mẫu mới + không hỏi đơn cũ -> KHÔNG giao người thật, cho báo giá mẫu mới. Conv: ${conversationId}`);
  }
  if (data.fromAd && _adId && _adHistPostOrder && _ordQuestionNow && !isCommentOrigin && !mem.orderClosed && !_newModelShoppingNow
      && !shopRepliedAfterLastCustomer(data.messages)) {   // [FIX Hoàng Thu Thủy] CHỈ giao người khi tin HIỆN TẠI hỏi về ĐƠN CŨ (_ordQuestionNow);
    //   câu hỏi MẪU MỚI / size / câu chung -> KHÔNG giao người, để bot trả (kịch bản có sẵn). [FIX Hoàng Yến] người thật/bot ĐÃ nhắn cuối -> KHÔNG tag.
    mem._postOrderThread = true;
    const _aHT = String(_adCustNow || "").trim();   // [FIX CRASH] latestText CHƯA khai báo ở đây (mãi ~5699); dùng _adCustNow (5257)
    if (_aHT && !isBareAck(_aHT) && !isAffirmation(_aHT) && !isFriendlyRemark(_aHT)) {
      try { await tagChoXuLyVaUnread(conversationId); } catch (_) {}
      mem.botHandoffAt = Date.now();
      console.log(`[${BOT_NAME}] Conv TỪ AD nhưng hội thoại ĐÃ là HẬU-ĐƠN (khách nhắc đơn đã đặt/chốt/giao/từ chối nhận) -> KHÔNG báo giá lại, GIAO NGƯỜI THẬT. Conv: ${conversationId}`);
      updateConversationState(conversationId, mem); markProcessed(getLastCustomerMessages(data.messages)); return true;
    }
  }
  if (data.fromAd && _adId && !isCommentOrigin && !mem.commentOpenerSent && _adWantsQuote && !_adDontOpen
      && !mem.orderClosed && !_adTurnHasImage && !_adHistPostOrder
      && !_alreadyQuotedAd && _adTries < 8
      && !shopRepliedAfterLastCustomer(data.messages)) {   // CHỐNG LẶP/chen ngang: NV/bot vừa trả lời SAU tin khách thì thôi
    // (BỎ chặn humanInbox: khách CŨ từng được NV tư vấn vẫn được báo giá khi BẤM AD MỚI — đúng ý: ad click -> báo mẫu của ad.
    //  Vẫn an toàn nhờ: thẻ giữ CHỜ XL/ĐƠN ƯU TIÊN chặn từ trên + shopRepliedAfterLastCustomer chặn khi người thật đang trả lời.)
    // ĐỌC CREATIVE QUA MARKETING API (nếu có FB_ADS_TOKEN): ảnh + caption + tên ad (chứa mã).
    // [FIX Pham Huệ 2026-07-07] _adId nhiều khi là STORY/POST id (story_fbid từ tin khách) chứ KHÔNG phải
    //   ad id thật -> gọi endpoint ad sẽ lỗi (#12) và MẤT adName (mã mẫu trong tên ad). Sửa: lấy ad id
    //   THẬT (dạng 120...) từ metadata ads của hội thoại (ưu tiên inserted_at MỚI NHẤT); _adId dạng post
    //   thì truyền làm postId để fb_ads đọc thẳng bài.
    let _fbCr = null;
    let _realAdId = /^120\d{12,}$/.test(String(_adId || "")) ? String(_adId) : null;
    if (!_realAdId) {
      try {
        const _adsArr = (typeof conversation !== "undefined" && conversation && conversation.ads) || [];
        let _best = null;
        for (const a of _adsArr) {
          if (a && /^120\d{12,}$/.test(String(a.ad_id || ""))) {
            if (!_best || String(a.inserted_at || "") > String(_best.inserted_at || "")) _best = a;
          }
        }
        if (_best) _realAdId = String(_best.ad_id);
      } catch (_) {}
    }
    if (fbAds.hasToken() && (_realAdId || (_adId && /^\d{6,}$/.test(String(_adId))))) {
      try {
        _fbCr = await fbAds.fetchAdCreative(_realAdId || _adId, {
          postId: data.adPostId || (_realAdId && String(_adId) !== String(_realAdId) ? String(_adId) : null),
          pageId: String(conversationId).split("_")[0]
        });
      } catch (_) {}
      if (_fbCr && _fbCr.error) console.log(`[ADS API] đọc ad ${_realAdId || _adId} LỖI: ${_fbCr.error}`);
      else if (_fbCr) console.log(`[ADS API] ad ${_realAdId || _adId}: ${_fbCr.images.length} ảnh + ${_fbCr.caption.length} caption | tên="${(_fbCr.adName || "").slice(0, 45)}" | bài=${_fbCr.storyId || "-"}`);
    }
    const adImgs = [data.adPhotoUrl, ...(data.postImages || []), ...((_fbCr && _fbCr.images) || [])].filter(Boolean);
    mem.adTryId = _adId; mem.adTryCount = _adTries + 1;   // đếm số lần thử / 1 ads (chống vision lặp vô hạn)
    // Gom nguồn caption + TÁCH TÊN DẪN ĐẦU (phần trước | - – : xuống dòng).
    // Caption quảng cáo thường mở đầu bằng TÊN mẫu, vd "GRAVELLE | BẢN GIAO HƯỞNG...".
    // [FIX GIAVELLE->Fioraen] adCaptionCandidates hay LẪN TIN ĐỐI THOẠI CỦA SHOP (vd "Dạ chị thường mặc size
    //   bao nhiêu để em kiểm tra") -> trong đó có tên mẫu shop nhắc TRƯỚC ĐÓ (Fioraen) -> dò nhầm mẫu, báo giá SAI.
    //   -> LOẠI các câu là TIN ĐỐI THOẠI của shop khỏi nguồn dò tên. Ad caption thật (vd "GIAVELLE | DẤU ẤN...")
    //   không phải lời thoại nên vẫn giữ. Loại xong không còn nguồn ad thật -> CHƯA RA MẪU -> nhường người thật.
    const _looksLikeShopReply = (s) => {
      const t = String(s || "").toLowerCase().trim();
      if (!t) return false;
      if (/^d[ạa]([\s,.:!]|$)/.test(t)) return true;   // bot/nhân viên luôn mở đầu "Dạ..."
      // [FIX LienAnh 2026-07-07] TEXT GIAO DIỆN Pancake/FB lẫn vào caption candidates ("Bạn đang phản hồi
      // bình luận của người dùng về...", "đã trả lời một quảng cáo"...) -> trong đó có tên BÀI KHÁC ->
      // dò nhầm mẫu (báo Orlina trong khi bài là mẫu khác). Chữ hệ thống KHÔNG bao giờ là caption bài.
      if (/^(bạn|ban) (đang|dang) (phản hồi|phan hoi|trả lời|tra loi)|phản hồi bình luận của người dùng|đã trả lời (một )?(quảng cáo|bài viết)|replied to (a |an |your |the )?(post|ad|comment|story)|you are replying/i.test(t)) return true;
      return /(cho em xin|ch[ịi] cho em|em ki[ểe]m tra|em nh[ậa]n [đd]ư[ợo]c|size bao nhi[êe]u [đd][ểe] em|l[êe]n [đd]ơn cho m[ìi]nh|[đd][ểe] em t[ưu] v[ấa]n|em g[ửu]i ch[ịi]|b[áa]o gi[áa].*[đd]$|shop ch[àa]o|ch[àa]o ch[ịi])/.test(t);
    };
    // [FIX Truong Thao 2026-07-11] Tin báo giá cũ của shop bị CẮT THÀNH DÒNG LẺ ("Thiết kế Irida ... 850.000 đ")
    // -> mất chữ "Dạ..." mở đầu -> lách qua _looksLikeShopReply -> báo mẫu CŨ (Irida) trong khi ad thật là
    // LONDYNN. Phép thử không lách được: ứng viên caption là CHUỖI CON của bất kỳ tin shop/page từng gửi
    // trong hội thoại -> đồ lịch sử, LOẠI (caption bài thật không bao giờ nằm nguyên văn trong tin chat).
    const _shopBlob = (() => {
      try {
        const _n = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
        return _n((data.messages || [])
          .filter(m => m && m.sender === "shop" && (m.text || m.message))
          .map(m => String(m.text || m.message)).join(" \n "));
      } catch (_) { return ""; }
    })();
    const _isFromShopHistory = (c) => {
      try {
        const _n = String(c || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
        return _n.length >= 15 && _shopBlob.includes(_n.slice(0, 60));
      } catch (_) { return false; }
    };
    const _capSources = [data.adTitle, data.postCaption, ...(data.adCaptionCandidates || []), ...((_fbCr && _fbCr.caption) || [])]
      .filter(c => c && String(c).trim() && !_looksLikeShopReply(c) && !_isFromShopHistory(c));
    // CHỈ nhận tên dẫn đầu NGẮN (<=4 từ) làm tên mẫu. Câu marketing dài KHÔNG dùng để khớp tên.
    // BỎ emoji/ký hiệu (✨🌴...) để "✨ CORINE" -> "CORINE"; thêm từng TỪ dài (tên mẫu thường 1 từ).
    const _cleanLead = s => String(s || "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
    const _leadNames = [];
    // [TỰ HỌC organic 2026-07-07] đánh dấu lead đến từ caption ĐỌC TRỰC TIẾP QUA API (nguồn sạch,
    // không lẫn lịch sử hội thoại) -> khớp ra mẫu thì được phép TỰ HỌC map postId->mã cho bài organic.
    const _apiCaps = new Set(((_fbCr && _fbCr.caption) || []).map(x => String(x)));
    const _leadFromApi = new Set();
    for (const c of _capSources) {
      const _isApi = _apiCaps.has(String(c));
      const seg = _cleanLead(String(c).split(/[|\-–—:\n]/)[0]);
      if (seg.length >= 4 && seg.split(/\s+/).length <= 4 && !_leadNames.includes(seg)) _leadNames.push(seg);
      if (_isApi && seg.length >= 4) _leadFromApi.add(seg);
      for (const w of seg.split(/\s+/)) {
        if (w.length >= 4 && !_leadNames.includes(w)) _leadNames.push(w);
        if (_isApi && w.length >= 4) _leadFromApi.add(w);
      }
    }
    let product = null;
    let _how = "";
    // 0) KHÁCH TỰ GÕ TÊN MẪU TRONG LƯỢT TRẢ LỜI AD NÀY (vd "tư vấn thiết kế Celyne") -> TIN CẬY CAO NHẤT.
    //    CHỈ lấy tin của LƯỢT HIỆN TẠI (getLastCustomerMessages) — KHÔNG lấy lịch sử cũ, vì khách từng hỏi
    //    mẫu khác (Miretta/Corine...) ở tin cũ sẽ làm findInText ra MẪU CŨ -> báo giá ad SAI.
    try {
      const _custTxt = getLastCustomerMessages(data.messages)
        .filter(m => m && m.type === "text" && m.text)
        .map(m => m.text).join(" ");
      if (_custTxt && _custTxt.replace(/[^\p{L}]/gu, "").length >= 3) {
        const hit = await findInText(_custTxt);
        if (hit && hit.length) { product = hit[0]; _how = "khách gõ tên mẫu (lượt này)"; }
      }
    } catch (_) {}
    // 1) MÃ trong TÊN AD (vd "MR0VX6349-1606-Grace...") — token TRÙNG mã catalog (EXACT) = CHẮC CHẮN NHẤT
    //    sau khách gõ. PHẢI chạy TRƯỚC caption: caption hay lẫn câu rác ("Dạ em rất vui được hỗ trợ...") làm
    //    lead "được" khớp nhầm mẫu khác (lỗi: ad Grace mà báo Corine).
    if (!product && _fbCr && _fbCr.adName) {
      try {
        const _c = await ensureCatalog();
        const toks = String(_fbCr.adName).toUpperCase().match(/[A-Z0-9]{6,}/g) || [];
        for (const tk of toks) { const _p = _c.byCode.get(tk); if (_p) { product = _p; _how = "mã trong tên ad (" + tk + ")"; break; } }
        // [TỰ HỌC 2026-07-07] Ra mã từ TÊN AD (nguồn chắc nhất) -> ghi nhớ vĩnh viễn mọi id liên quan
        //   (ad id thật, bài creative, story khách bấm, adPostId) -> lần sau KHỎI gọi API/vision,
        //   kể cả lượt webhook chỉ có story_fbid. Hết cảnh map tay từng bài.
        if (product) learnAdProduct([_realAdId, (_fbCr && _fbCr.storyId), String(_adId || ""), data.adPostId], String(product.code).toUpperCase());
      } catch (_) {}
    }
    // 1.5) MAP (tay + tự học) theo adId/postId — [FIX LienAnh 2026-07-07] map do NGƯỜI khẳng định phải đứng
    //      TRÊN caption/vision (trước đây map nằm CUỐI -> caption rác dính chữ "Orlina" từ lịch sử vẫn thắng
    //      map đúng của shop). Thứ tự mới: khách gõ tên > mã trong tên ad > MAP > caption > vision.
    //      RÀO ĐỘ TƯƠI (chống lỗi kiểu Nhung Cao): chỉ tra map bằng các id thuộc HÀNH ĐỘNG LƯỢT NÀY —
    //      _adId (story_fbid tin khách VỪA gửi), _realAdId (ad inserted_at MỚI NHẤT), bài creative của ad đó.
    //      adPostId từ METADATA chỉ được tra khi ad này là ad MỚI bấm lần đầu (_adIsNewClick) — bài CŨ dính
    //      metadata KHÔNG được lôi map ra áp cho ngữ cảnh mới.
    if (!product) {
      try {
        const _mapEarlyCands = [];
        if (_adId) _mapEarlyCands.push({ id: String(_adId), tag: "bài/ad tin lượt này" });
        if (_realAdId && String(_realAdId) !== String(_adId)) _mapEarlyCands.push({ id: String(_realAdId), tag: "ad id thật mới nhất" });
        if (_fbCr && _fbCr.storyId) _mapEarlyCands.push({ id: String(_fbCr.storyId), tag: "bài creative của ad" });
        if (data.adPostId && _adIsNewClick) _mapEarlyCands.push({ id: String(data.adPostId), tag: "adPostId (ad MỚI bấm)" });
        let _mE = null, _mEKey = "";
        for (const c of _mapEarlyCands) {
          const k = lookupAdProduct(c.id);
          if (k) { _mE = k; _mEKey = c.tag + " " + c.id; break; }
        }
        if (_mE) {
          const _cM = await ensureCatalog();
          const _pM = _cM.byCode.get(String(_mE).toUpperCase());
          if (_pM) { product = _pM; _how = "MAP ưu tiên (" + _mEKey + ")"; console.log(`[${BOT_NAME}] Ad ${_adId} -> MAP ƯU TIÊN (${_mEKey}) ra mẫu ${_pM.code} (${_pM.name}) — chặn trước caption/vision.`); }
        }
      } catch (_) {}
    }
    // 2) CAPTION: TÊN DẪN ĐẦU (vd "CELYNE", "GIANNAL", "CORINE") — shop GHI RÕ tên mẫu trong cap.
    //    LỌC từ thường tiếng Việt (được, shop, hỗ trợ...) để không khớp nhầm khi caption bị lẫn câu rác.
    const _leadStop = new Set(["được","duoc","shop","chị","chi","mình","minh","cảm","cam","hỗ","trợ","tro","giúp","giup","rất","vui","nhớ","giữ","hàng","mẫu","mau","này","nay","size","giá","gia","đẹp","dep","cho","của","cua","nhé","nha","hôm","nay","vâng","dạ","em","anh","thông","tin","ảnh","anh","màu","mau","đơn","luôn","nhận","order"]);
    for (const cand of _leadNames) {
      if (product) break;
      if (_leadStop.has(String(cand).toLowerCase())) continue;   // bỏ từ rác
      try { const hit = await findInText(cand); if (hit && hit.length) { product = hit[0]; _how = _leadFromApi.has(cand) ? "tên dẫn đầu (caption API)" : "tên dẫn đầu (caption)"; break; } } catch (_) {}
      // [FIX ALISSE/Galisse] tên ad gõ LỆCH/THIẾU chữ (ad "ALISSE" vs catalog "Galisse") -> khớp CHÍNH XÁC trượt
      //   -> thử FUZZY (giống fix tên mẫu gõ sai ở luồng chữ). Chỉ khi findInText không ra.
      try { const fz = await fuzzyFindModel(cand); if (fz && fz.product) { product = fz.product; _how = `tên dẫn đầu FUZZY (caption "${String(cand).slice(0, 16)}" ~ ${fz.product.name})`; break; } } catch (_) {}
    }
    // [TỰ HỌC organic] mẫu ra từ caption ĐỌC QUA API (bài viết thường đọc trực tiếp Graph, nguồn sạch)
    // -> ghi nhớ postId/bài -> mã, lần sau tra map ra ngay không cần gọi API/vision nữa.
    if (product && _how === "tên dẫn đầu (caption API)") {
      try { learnAdProduct([String(_adId || ""), data.adPostId, (_fbCr && _fbCr.storyId)], String(product.code).toUpperCase()); } catch (_) {}
    }
    // 3) VISION đọc ẢNH ad — DỰ PHÒNG (chỉ dùng khi tên ad + caption KHÔNG ra; ảnh ghép/chụp bài dễ đọc sai).
    let _adVisionColor = "";
    if (!product) {
      for (const url of adImgs.slice(0, 3)) {
        try { const r = await resolveImageRetry(url, 2); if (r?.ok && r?.product) { product = r.product; if (r.color) _adVisionColor = r.color; _how = "ảnh/vision (dự phòng)"; break; } } catch (_) {}
      }
    }
    // 4) MAP TAY theo Ad ID HOẶC post_id (lưới đỡ: token lỗi/ad lạ/creative rỗng).
    let _mapped = null, _mapKey = "";   // KHAI BÁO SCOPE NGOÀI -> còn dùng ở "if (_adId && !_mapped)" cuối (sửa crash: _mapped is not defined)
    if (!product) {
      const _mapCands = (data.adCandidates && data.adCandidates.length)
        ? data.adCandidates
        : [{ adId: _adId, postId: data.adPostId || null }];
      for (const c of _mapCands) {
        const k1 = c.adId ? lookupAdProduct(c.adId) : null;
        if (k1) { _mapped = k1; _mapKey = "adId " + c.adId; break; }
        const k2 = c.postId ? lookupAdProduct(c.postId) : null;
        if (k2) { _mapped = k2; _mapKey = "postId " + c.postId; break; }
      }
      if (_mapped) {
        try { const hit = await findInText(_mapped); if (hit && hit.length) { product = hit[0]; _how = "map (" + _mapKey + ")"; } } catch (_) {}
        if (!product) { try { const _c = await ensureCatalog(); const _p = _c.byCode.get(String(_mapped).toUpperCase()); if (_p) { product = _p; _how = "map (" + _mapKey + ")"; } } catch (_) {} }
        if (product) console.log(`[${BOT_NAME}] Ad ${_adId} -> MAP (${_mapKey}) ra mẫu ${product.code} (${product.name}).`);
        else console.log(`[ADS MAP] map="${_mapped}" (${_mapKey}) KHÔNG khớp mẫu nào trong catalog -> kiểm lại tên/mã.`);
      }
    }
    // LOG CHẨN ĐOÁN: thấy gì + khớp ra sao (để soi khi trượt).
    try {
      console.log(`[${BOT_NAME}] QUẢNG CÁO adId=${_adId} | caps=${_capSources.length} imgs=${adImgs.length} | lead="${(_leadNames[0] || "").slice(0, 30)}" cap0="${(_capSources[0] || "").slice(0, 45)}" -> ${product ? `RA ${product.code} (${product.name}) qua ${_how}` : "CHƯA RA MẪU"}`);
    } catch (_) {}
    // ===== [AI-QUYẾT trọng tài CỔNG ADS 2026-07-07] =====
    // Nguyên tắc shop: BÁM HÀNH ĐỘNG GẦN NHẤT, MỚI NHẤT của khách. Cổng ads trước đây tự chốt mẫu bằng
    // tên-ad/caption/vision rồi return SỚM -> AI-QUYẾT (điểm nối chính) không bao giờ được hỏi ở đúng nơi
    // loạn mẫu nhiều nhất (ca Pham Huệ/Féline). Giờ: TRƯỚC khi báo giá, đưa toàn bộ ứng viên + hội thoại
    // cho AI phân xử. shadow (log_so_sanh): chỉ in so sánh; bat_referent: AI đủ tự tin + mã có trong
    // catalog -> ĐÈ kết quả cổng ads.
    // [FIX LienAnh] Mẫu ra từ CAPTION (nguồn yếu: hay lẫn chữ hệ thống/câu marketing) -> chạy thêm VISION
    // 2 ảnh đầu của bài làm ỨNG VIÊN ĐỐI CHỨNG. Trọng tài chỉ có 1 ứng viên thì gật là tất yếu — phải có
    // ít nhất 2 nguồn để AI phân xử thật.
    let _agVisionAlt = null;
    if (product && /caption/i.test(String(_how || "")) && adImgs.length) {
      try {
        for (const url of adImgs.slice(0, 2)) {
          const r = await resolveImageRetry(url, 1);
          if (r?.ok && r?.product && String(r.product.code).toUpperCase() !== String(product.code).toUpperCase()) {
            _agVisionAlt = r.product;
            console.log(`[${BOT_NAME}] ADS đối chứng: caption ra ${product.code} nhưng VISION ảnh bài ra ${r.product.code} -> đưa cả 2 cho AI phân xử.`);
            break;
          }
        }
      } catch (_) {}
    }
    try {
      const _agCfg = aiQuyetCfg();
      if (_agCfg.log_so_sanh || _agCfg.bat_referent) {
        const _agTurns = (data.messages || [])
          .filter(m => m && (m.text || m.type === "photo") && m.type !== "system").slice(-20)
          .map(m => (m.sender === "shop" ? "SHOP: " : "KHACH: ") + (m.text ? String(m.text).replace(/\s+/g, " ").slice(0, 160) : "[gửi ảnh]")).join("\n");
        const _agSeen = new Set(); const _agC = [];
        const _agPush = (p, nguon) => { if (!p || !p.code) return; const kk = String(p.code).toUpperCase(); if (_agSeen.has(kk)) return; _agSeen.add(kk); _agC.push(`${kk} | ${p.name || "?"} | nguồn=${nguon}`); };
        if (product) _agPush(product, "cổng ads vừa nhận qua " + (_how || "?") + " — TỪ AD KHÁCH BẤM LƯỢT NÀY (MỚI NHẤT)");
        if (_agVisionAlt) _agPush(_agVisionAlt, "VISION nhận diện ẢNH của chính bài khách bấm LƯỢT NÀY (đối chứng — ảnh thường đáng tin hơn caption)");
        for (const p of (mem.sessionProducts || [])) _agPush(p, "đã nhắc tới trong phiên");
        if (mem.currentProduct) _agPush(mem.currentProduct, "mẫu đang khoá từ TRƯỚC trong hội thoại");
        for (const p of (mem.quotedProducts || [])) _agPush(p, "đã báo giá trước đó trong hội thoại");
        const _agKnown = [
          _fbCr && _fbCr.adName ? `Tên quảng cáo khách vừa bấm: "${String(_fbCr.adName).slice(0, 60)}"` : "",
          _fbCr && _fbCr.storyId ? `Bài creative THẬT của quảng cáo: ${_fbCr.storyId}` : "",
          _capSources[0] ? `Caption bài khách bấm (thô): "${String(_capSources[0]).replace(/\s+/g, " ").slice(0, 100)}"` : "",
          "LƯU Ý: khách VỪA bấm quảng cáo -> mẫu của quảng cáo lượt này thường là mẫu khách đang hỏi, trừ khi hội thoại cho thấy khách đang nói tiếp mẫu khác. Caption chứa tên mẫu KHÁC các ứng viên -> để referent=UNKNOWN (đừng gật bừa ứng viên)."
        ].filter(Boolean).join("\n");
        const _agT0 = Date.now();
        const _ag = await aiQuyet.quyetDinh({ turns: _agTurns, candidatesText: _agC.join("\n"), known: _agKnown });
        if (_ag && _ag.ok) {
          console.log(`[AI-QUYẾT ads] referent=${_ag.referent}(${_ag.do_tin_cay}) | cổng ads chọn=${product ? product.code : "-"} | ${Date.now() - _agT0}ms`);
          if (_agCfg.bat_referent && _ag.referent && _ag.referent !== "UNKNOWN" && _ag.do_tin_cay >= _agCfg.nguong
              && (!product || _ag.referent !== String(product.code).toUpperCase())) {
            const _cAg = await ensureCatalog();
            const _pAg = _cAg.byCode.get(_ag.referent);   // RÀO: mã phải có thật trong catalog
            if (_pAg) { product = _pAg; _how = "AI-QUYẾT trọng tài"; console.log(`[AI-QUYẾT ads] ĐÈ kết quả cổng ads -> ${_ag.referent} (tin cậy ${_ag.do_tin_cay}).`); }
            else console.log(`[AI-QUYẾT ads] BỎ: mã ${_ag.referent} không có trong catalog -> giữ kết quả cổng ads.`);
          }
        } else if (_ag) { console.log(`[AI-QUYẾT ads] BỎ QUA (${_ag.reason || "?"}) -> giữ kết quả cổng ads.`); }
      }
    } catch (e) { console.log(`[AI-QUYẾT ads] LỖI: ${(e && e.message) || e} -> giữ kết quả cổng ads.`); }
    if (product) {
      // BÁM size khách VỪA cho ở tin này (vd "cho c size s") TRƯỚC khi dựng opener -> sizeTailForProduct
      // sẽ ra CÂU HÀNH ĐỘNG (lên đơn size X) thay vì hỏi lại size. KHÔNG ép FREESIZE, không ghi đè size đã có.
      if (!mem.customerSize) { try { const _sz = extractStatedSize(_adCustNow); if (_sz && _sz !== "FREESIZE") { mem.customerSize = _sz; mem.sizeFromCustomer = true; console.log(`[${BOT_NAME}] AD: bám size khách vừa cho = ${_sz} -> opener xác nhận size + câu chốt.`); } } catch (_) {} }
      // QUY TẮC 1 MẪU / 1 LẦN GIÁ / 24h: openerOrLead -> mẫu CHƯA báo giá 24h thì opener đầy đủ (có giá);
      // ĐÃ báo giá (qua ad khác / comment / inbox) thì chỉ câu dẫn dắt, KHÔNG lặp giá. (buildCommentOpener
      // cũ luôn kèm giá + chỉ chặn theo từng adId -> bấm ad MỚI cùng mẫu vẫn báo giá lại trong 24h.)
      const opener = openerOrLead(product, mem);   // ĐẢO THỨ TỰ: dựng câu opener NHƯNG gửi SAU ảnh (ảnh trước, text sau)
      mem.currentProduct = product;
      mem.commentPostProduct = product;
      mem.quotedProducts = [product];
      mem.orderClosed = false;
      mem.adQuotedFor = _adId;       // CHỈ đánh dấu xong khi ĐÃ báo được mẫu -> không lặp, không nhiễm
      mem.lastAdId = _adId;
      const k = String(product.code || "").toUpperCase();
      if (k && (product.priceText || priceIsValid(product.price))) markPriced(mem, k);
      // Khách nói rõ MÀU trong câu (vd "Giannal màu Hồng") -> lọc ảnh đúng màu đó (dùng lại cơ chế strict của maybeSendImages).
      const _adCustText = getLastCustomerMessages(data.messages)
        .filter(x => x.type === "text" && x.text)
        .map(x => x.text).join(" ");
      const _adColor = extractColor(_adCustText);
      if (_adColor) { mem.askedImageColor = _adColor; console.log(`[${BOT_NAME}] Ad: khách xin màu "${_adColor}" -> lọc ảnh đúng màu.`); }
      // Khách KHÔNG xin màu -> nhớ MÀU Ở ẢNH ADS (vision khớp; nếu chưa có thì soi lại ảnh ad) để gửi lại ảnh CÙNG màu ad.
      if (!_adColor) {
        // (1) MÀU shop gắn THẲNG vào MAP cho bài ad này ("MGKVX6310|Hồng") -> ƯU TIÊN, khỏi đoán.
        let _srcColor = lookupAdColor(_adId)
                     || (data.adPostId && lookupAdColor(data.adPostId))
                     || (data.postId && lookupAdColor(data.postId)) || "";
        if (_srcColor) console.log(`[${BOT_NAME}] Ad: MÀU từ MAP = "${_srcColor}" (bài ${_adId}) -> gửi đúng màu này.`);
        // (2) Vision đọc ảnh ad. (3) đọc màu từ ảnh creative (KÈM neo tấm ảnh bìa để dẫn ĐÚNG màu).
        if (!_srcColor) _srcColor = _adVisionColor || "";
        if (!_srcColor) {
          try {
            const _sc = await sourceColorAndImgForCode(adImgs, k);
            if (_sc.color) _srcColor = _sc.color;
            // NEO gallery vào tấm catalog KHỚP ảnh bìa ad -> maybeSendImages đưa tấm này lên ĐẦU.
            // Nhờ vậy dù KHÔNG gọi được tên màu (kem/trắng-kem), loạt ảnh vẫn DẪN bằng đúng ảnh bìa,
            // không còn cảnh "ad kem -> 3 ảnh hồng" (pool nghiêng hồng).
            if (_sc.imageId) {
              mem.matchedImgByCode = Object.assign({}, mem.matchedImgByCode || {}, { [k]: _sc.imageId });
              console.log(`[${BOT_NAME}] Ad: NEO ảnh bìa (imageId ${_sc.imageId}) cho mẫu ${k} -> gallery dẫn bằng ảnh đúng màu bìa.`);
            }
          } catch (_) {}
        }
        // (4) LƯỚI CUỐI: đọc màu từ CAPTION/tên ad, NHƯNG chỉ nhận nếu là MÀU THẬT của mẫu (lọc getCodeColors).
        //     Vá gốc ca "ad Miretta màu KEM nhưng gửi ảnh HỒNG": vision hay đọc trượt tông kem/trắng-kem
        //     -> _srcColor rỗng -> rơi vào "gửi ảnh đầu pool" (pool nghiêng hồng). Lọc-theo-màu-thật diệt
        //     được false-positive kiểu "NÀNG ĐANG TÌM" -> "Tím" (Tím không phải màu của mẫu -> bỏ).
        if (!_srcColor) {
          const _capForColor = `${data.adTitle || ""} ${data.postCaption || ""} ${(data.adCaptionCandidates || []).join(" ")}`;
          const _capColor = colorFromAdTextForModel(_capForColor, k);
          if (_capColor) { _srcColor = _capColor; console.log(`[${BOT_NAME}] Ad: MÀU từ CAPTION (đã lọc theo màu THẬT của mẫu ${k}) = "${_capColor}" -> gửi đúng màu này.`); }
        }
        // Hết nguồn màu -> gửi ĐỦ màu. Muốn 1 màu chắc chắn: gắn "MÃ|Màu" vào MAP.
        if (_srcColor) {
          mem.sourceColorByCode = Object.assign({}, mem.sourceColorByCode || {}, { [k]: _srcColor });
          console.log(`[${BOT_NAME}] Ad: màu nguồn = "${_srcColor}" (mẫu ${k}) -> gửi lại ảnh đúng màu ad (khách chưa xin màu).`);
        }
      }
      // GỬI ẢNH CATALOG FULL-RES (content_id Pancake / Drive =w1600) — GIỐNG MỌI LUỒNG KHÁC.
      // KHÔNG gửi ảnh creative FB (_fbCr.images): các field link_data.picture / child_attachments.picture /
      // thumbnail_url của FB là ảnh PREVIEW BÉ TÍ (~130px) -> khách nhận ảnh nhỏ xíu (xem lỗi cũ).
      // _fbCr CHỈ dùng để NHẬN DIỆN mẫu (vision/caption/tên ad) ở trên, không dùng làm ảnh gửi.
      try {
        await delay(800);
        const _adImgOk = await maybeSendImages(conversationId, k, mem, true);
        if (!_adImgOk) {
          // Không gửi được ảnh sau báo giá (mẫu thiếu ảnh / lỗi) -> AI-XL ảnh cho người thật bổ sung.
          try { await tagXuLyAnhVaUnread(conversationId); } catch (_) {}
          mem.botHandoffAt = Date.now();
          console.log(`[${BOT_NAME}] ADS: KHÔNG gửi được ảnh mẫu ${k} sau báo giá -> gắn thẻ AI-XL ảnh.`);
        }
      } catch (_) {}
      // ĐẢO THỨ TỰ: gửi TEXT opener (giá + câu hành động ở cuối) SAU khi đã gửi ảnh -> ảnh trước, text sau, hành động sau cùng.
      await sendInboxMessage(conversationId, opener);
      // Ghi NGUỒN ADS vào ô Ghi chú (1 lần/hội thoại) -> NV thấy khách đến từ ad nào, bài nào.
      if (!mem.adNoteWritten) {
        const _postId = data.adPostId || data.postId || "";
        const _postLink = _postId ? `facebook.com/${_postId}` : "";
        const _adName = String(data.adTitle || data.postCaption || "").split("\n")[0].slice(0, 60).trim();
        const _note = `🎯 Khách từ ADS${_adName ? `: ${_adName}` : ""}`
          + (_postLink ? ` | bài: ${_postLink}` : "")
          + ` | mẫu: ${product.name} (${product.code})`
          + (_adId ? ` | adId: ${_adId}` : "");
        try { await addConversationNote(conversationId, _note); } catch (_) {}
        mem.adNoteWritten = true;
      }
      mem.lastBotReply = opener;
      // KHÔNG bỏ sót ý khác trong tin: khách vừa đến từ ad VỪA xin "cho bảng size" -> gửi kèm bảng size.
      try { await maybeSendSizeChart(conversationId, _adCustNow, product, mem); } catch (_) {}
      scheduleFollowup(conversationId, mem, product, opener);   // ad-khách cũng được NHẮC như luồng thường (trước đây thiếu -> ad ko follow)
      console.log(`[${BOT_NAME}] Tin từ QUẢNG CÁO -> báo giá mẫu ${product.code} (${product.name}) | adId=${_adId} | title="${(data.adTitle || data.postCaption || "").slice(0, 40)}".`);
      // CHẶN GỐC LẶP BÁO GIÁ: đánh dấu tin opener ĐÃ XỬ -> vòng quét sau KHÔNG xử lại -> không sinh báo giá lần 2.
      // CẨN THẬN: nếu opener còn hỏi GIAO/SHIP (cái quote CHƯA trả) -> KHÔNG đánh dấu, để handler giao trả nốt lượt sau.
      // (Hỏi thuộc tính/màu/chất/tồn/tra-đơn -> đã bị _adDontOpen chặn không vào đây; bảng size -> maybeSendSizeChart đã gửi.)
      if (!isDeliveryTimeQuestion(_adCustNow) && !isDeliveryConcern(_adCustNow)) {
        try { markProcessed(getLastCustomerMessages(data.messages)); } catch (_) {}
        console.log(`[${BOT_NAME}] -> đã đánh dấu opener xử xong (chống lặp gốc).`);
      } else {
        console.log(`[${BOT_NAME}] -> opener còn hỏi GIAO/SHIP -> KHÔNG đánh dấu, để handler giao trả nốt.`);
      }
      // Khách từ ad thắc mắc "chưa thấy gửi set váy / sao chưa gửi" -> ĐÃ báo giá + gửi ảnh ở trên -> GẮN người
      // thật xử tiếp (theo yêu cầu shop: hỏi hàng từ ad mà thắc mắc chưa nhận -> báo giá XONG rồi gắn người thật).
      if (asksWhyNotSentYet(_adCustNow)) {
        try { await tagChoXuLyVaUnread(conversationId); } catch (_) {}
        mem.botHandoffAt = Date.now();
        console.log(`[${BOT_NAME}] Ad: khách thắc mắc "chưa thấy gửi/chưa gửi" ("${String(_adCustNow).slice(0, 30)}") -> báo giá xong -> GẮN người thật.`);
      }
      updateConversationState(conversationId, mem);
      return true;
    }
    // Chưa nhận ra mẫu -> KHÔNG đánh dấu xong -> còn lượt thử sau (tối đa 4) khi có caption tốt hơn.
    console.log(`[${BOT_NAME}] Tin từ QUẢNG CÁO chưa nhận ra mẫu (adId=${_adId}, try=${mem.adTryCount}, title="${(data.adTitle || data.postCaption || "").slice(0, 40)}") -> thử lại/luồng thường.`);
    mem._adUnresolvedModel = true;   // CỜ: khách ĐẾN TỪ AD mà ad KHÔNG xác định được mẫu -> KHÔNG cho luồng thường đoán mẫu từ caption (tránh lôi mẫu vô can ra báo giá sai).
    if (_adId && !_mapped) {
      const _pid = (data.adCandidates && data.adCandidates[0] && data.adCandidates[0].postId) || data.adPostId || "";
      console.log(`[ADS MAP] >>> THÊM vào ad_product_map.json: "${_pid || _adId}": "<tên/mã mẫu>"  (dùng post_id "${_pid}" cover MỌI ad của bài này; hoặc ad_id "${_adId}").`);
    }
    updateConversationState(conversationId, mem);
  }

  // Tin khách để xử lý: lấy cụm tin mới nhất của khách.
  // (Đã bỏ cơ chế "gộp tin sau người thật" theo mốc 5 phút — giờ điều phối hoàn toàn bằng THẺ.)
  let batch = getLastCustomerMessages(data.messages);
  if (!batch.length) {
    if (logThrottle("nobatch_" + conversationId)) {
      const lastMsg = (data.messages || [])[ (data.messages || []).length - 1 ];
      console.log(`[BỎ QUA] ${data.customerName} (${conversationId}): KHÔNG lấy được cụm tin khách (batch rỗng). Tổng tin: ${(data.messages||[]).length} | tin cuối sender=${lastMsg && lastMsg.sender} channel=${lastMsg && lastMsg.channel} | cmtSent=${!!mem.commentProductSent}/${!!mem.commentOpenerSent} servedAt=${mem.commentServedAt || 0}`);
    }
    mem.skipUpd = _curUpd; updateConversationState(conversationId, mem);   // không có gì làm -> khỏi đọc lại tới khi có tin mới
    return false;
  }
  // QUAN TRỌNG: cụm 15s có thể lẫn tin CŨ đã trả lời. Chỉ giữ tin MỚI (chưa xử lý) để tránh
  // bỏ sót tin mới chỉ vì nó nằm chung cụm với 1 tin cũ đã xử lý (trước đây dùng .some() -> bỏ cả cụm).
  //  NGOẠI LỆ: conv CHƯA ĐỌC + khách nhắn cuối (_unreadCustomerWaiting) -> khách đang chờ thật, dù messageId
  //  đã nằm trong processedMessageIds (lần chạy trước đã đụng/gắn thẻ) vẫn PHẢI trả -> KHÔNG lọc theo processed.
  const batchNew = _unreadCustomerWaiting
    ? batch
    : batch.filter(m => !processedMessageIds.has(m.messageId) && !processingMessageIds.has(m.messageId));
  if (!batchNew.length) {
    if (logThrottle("done_" + conversationId))
      console.log(`[BỎ QUA] ${data.customerName} (${conversationId}): không còn tin MỚI (cả cụm đã xử lý). ids=${batch.map(m=>m.messageId).join(",")}`);
    mem.skipUpd = _curUpd; updateConversationState(conversationId, mem);   // đã xử lý hết -> khỏi đọc lại tới khi có tin mới
    return false;
  }
  batch = batchNew;

  // CHỐT CHẶN CHỐNG LẶP (quan trọng): nếu SHOP/Botcake đã trả lời THẬT (text có nội dung / ảnh)
  // SAU tin khách cuối -> coi như đã xử lý rồi, KHÔNG báo giá lại. Xử lý ca: Botcake trả lời lúc
  // code CHƯA chạy (tin chưa nằm trong "đã xử") -> bật code lên không bị trả lại loạt tin cũ.
  const _lastCustAt = Math.max(...batch.map(m => parseTime(m.insertedAt)));
  noteCustomerMsgAt(conversationId, _lastCustAt);   // mốc tin khách mới nhất -> để vòng đang gửi ảnh biết khách vừa chen tin
  const _shopReplyAfter = (data.messages || []).some(m => {
    if (!m || m.sender !== "shop") return false;
    // Tin do CHÍNH BOT gửi -> đã track riêng bằng processedMessageIds; KHÔNG dùng nó để kết luận "đã trả".
    //  (Chống ca: bot trả tin CŨ landing SAU tin mới của khách -> tưởng đã trả -> bỏ rớt tin mới.)
    if (m.messageId && botSentIds.has(String(m.messageId))) return false;
    if (parseTime(m.insertedAt) <= _lastCustAt + 1000) return false;   // phải SAU tin khách
    if (m.type === "image") return true;                                // shop (NGƯỜI THẬT/Botcake) gửi ảnh = đã trả lời
    if (m.type === "text" && m.text && m.text.trim()
        && !/đã trả lời một quảng cáo/i.test(m.text)) return true;       // text thật (bỏ dòng hệ thống)
    return false;
  });
  if (_shopReplyAfter) {
    markProcessed(batch);   // đánh dấu đã xử để khỏi kiểm lại mỗi vòng (đỡ tốn request)
    if (logThrottle("shopreplied_" + conversationId))
      console.log(`[BỎ QUA] ${data.customerName} (${conversationId}): shop/Botcake đã trả lời sau tin khách -> KHÔNG báo lại (chống lặp).`);
    mem.skipUpd = _curUpd; updateConversationState(conversationId, mem);   // shop đã trả lời -> khỏi đọc lại tới khi có tin mới
    return false;
  }

  // DEBOUNCE: đợi khách ngừng gõ vài giây mới trả lời (gộp tin + cho tin người thật kịp hiện).
  const latestAt = Math.max(...batch.map(m => parseTime(m.insertedAt)));
  if (Date.now() - latestAt < DEBOUNCE_MS) {
    if (logThrottle("debounce_" + conversationId))
      console.log(`[CHỜ DEBOUNCE] ${data.customerName} (${conversationId}): tin mới ${Math.round((Date.now()-latestAt)/1000)}s trước, đợi khách gõ xong.`);
    return false;  // chưa markProcessing -> vòng sau xử lý lại
  }

  // (Đã bỏ luật "chờ 5 phút / phát hiện người thật sát giờ gửi".)
  // Điều phối người thật vs AI giờ CHỈ dựa vào THẺ (đã kiểm tra convHasHoldTag ở đầu hàm):
  // còn thẻ giữ -> AI đứng ngoài; gỡ thẻ -> AI xử lý ngay.

  if (!_unreadCustomerWaiting && hasProcessed(batch)) return false;
  markProcessing(batch);

  try {
    console.log("------------------------------");
    console.log("Khách:", data.customerName, "| Conv:", conversationId);
    console.log("Tin:", batch.map(m => `${m.type}: ${m.text}`).join(" | "));

    updateMemoryFromBatch(mem, batch);

    // NFKC: chữ/số CÁCH ĐIỆU (Unicode toán học in đậm/nghiêng: 𝟬𝟵𝟴𝟵.. , 𝘾𝙝𝙞..) -> ASCII thường,
    // để regex SĐT/địa chỉ bắt được. An toàn cho tiếng Việt (giữ dấu), emoji không đổi.
    const latestTextRaw = batch.filter(x => x.type === "text").map(x => (x.text || "").normalize("NFKC")).join(" ");
    const latestText = normalizeViet(latestTextRaw);   // dò ý trên bản CHUẨN HOÁ (viết tắt/lặp -> chuẩn)
    mem._lastCustText = latestText;   // [CHƯƠNG TRÌNH KM] để buildDiscountReply phân biệt khách hỏi "áp dụng online không"
    if (_turnCtx) _turnCtx.customerText = latestText;   // để scheduleFollowup biết khách vừa HỎI gì
    let askImages = wantsImages(latestText);
    mem.lastIntent = detectIntent(latestText);
    let priceAsk = isPriceAsk(latestText, mem.lastIntent);   // [AI-QUYẾT giá] giá trị regex BAN ĐẦU; sẽ bị AI ghi đè ngay sau khi AI đọc (xem dưới)

    // (Luồng SHOWROOM — chọn cơ sở / sẽ ghé / hẹn giờ — đã chuyển xuống SAU khi AI đọc để AI quyết nhãn.)

    // ===== KHÁCH BÁO BOT TRẢ LỜI SAI/LẠC ĐỀ ("shop nhắn nhầm", "sai rồi", "không liên quan") =====
    // -> DỪNG, KHÔNG phun thêm câu mẫu theo từ khoá. Nhường NGƯỜI THẬT đọc lại hội thoại để hiểu đúng ý khách.
    if (saysBotMistake(latestText)) {
      await tagChoXuLyVaUnread(conversationId);
      mem.botHandoffAt = Date.now();
      console.log(`[${BOT_NAME}] Khách báo BOT trả lời SAI/LẠC ĐỀ ("${latestText.slice(0, 40)}") -> DỪNG phun câu mẫu, nhường NGƯỜI THẬT (AI-CHỜ XL).`);
      mem.lastBotReply = "[bot sai -> người thật]";
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }
    // ===== KHÁCH SO SÁNH SHOP KHÁC / HỎI HÀNG THẬT-GIẢ / CHÍNH HÃNG ("bên nào mới chuẩn") =====
    // -> nhạy cảm; bot KHÔNG tự khẳng định quan hệ làm ăn / độ thật giả. Nhường NGƯỜI THẬT.
    if (asksShopComparison(latestText) && !_nhanCamRegex(mem, "asksShopComparison", [])) {
      await tagChoXuLyVaUnread(conversationId);
      mem.botHandoffAt = Date.now();
      console.log(`[${BOT_NAME}] Khách SO SÁNH shop khác / hỏi hàng thật-giả ("${latestText.slice(0, 40)}") -> nhường NGƯỜI THẬT (AI-CHỜ XL), KHÔNG tự chế.`);
      mem.lastBotReply = "[so sánh shop -> người thật]";
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH SỐT RUỘT / CHÊ CHẬM / MỈA "bán hàng kiểu gì" =====
    // -> đừng để bot/AI trả filler (gửi lại ảnh, lặp giá...). Nhường NGƯỜI THẬT xoa dịu + chốt.
    if (saysImpatientOrSlow(latestText)) {
      await tagChoXuLyVaUnread(conversationId);
      mem.botHandoffAt = Date.now();
      console.log(`[${BOT_NAME}] Khách SỐT RUỘT/chê chậm ("${latestText.slice(0, 40)}") -> nhường NGƯỜI THẬT (AI-CHỜ XL), KHÔNG trả filler.`);
      mem.lastBotReply = "[khách sốt ruột -> người thật]";
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    const imageCount = batch.filter(x => x.type === "image" && x.imageUrl).length;
    // CHỐNG LẶP ẢNH: bot đã gửi ảnh trong hội thoại (đọc lịch sử -> sống sót RESTART) thì KHÔNG tự gửi lại,
    // TRỪ: khách VỪA gửi ảnh lượt này / khách XIN xem ảnh / báo giá §13 (set cờ riêng tại chỗ đó).
    mem._imgShownBefore = botSentImagesInHistory(data.messages);
    // THREAD HẬU MÃI: shop đã xác nhận/nhắc ĐƠN ĐÃ ĐẶT trong lịch sử -> KHÔNG báo giá mẫu mới đè lên (Huệ Nhi).
    mem._postOrderThread = shopConfirmedOrderInHistory(data.messages);
    mem._imgAllowSend = (imageCount > 0) || askImages;
    // Khách gửi ẢNH MẪU MỚI = bắt đầu đợt tư vấn mới -> cho phép mời lên đơn lại 1 lần (reset chống-lặp).
    if (imageCount > 0) { mem.orderInvited = false; mem.lastCtaSent = null; mem.priceObjectionHandled = false; mem.priceObjectionCount = 0; mem.priceComparisonHandled = false; mem.saidBestSeller = false; mem.ctaIdx = 0; }
    const fromImages = await getProductsFromImages(batch);
    const imgColors = (fromImages && fromImages._colorByCode) || {};
    // Khách GỬI ẢNH mà vision nhận ra mẫu -> nhớ là MẪU ẢNH GẦN NHẤT ĐÃ HIỆN (để follow-up bằng chữ bám đúng mẫu này).
    if (fromImages && fromImages.length && fromImages[0] && fromImages[0].code) {
      mem.lastShownCode = String(fromImages[0].code).toUpperCase(); mem.lastShownAt = Date.now();
    }
    let fromText = latestText ? await findInText(latestText) : [];

    // ===== TIN CHỈ LÀ NÚT "BẮT ĐẦU" (Get Started) -> GỬI GALLERY MẪU MỚI, KHÔNG derive mẫu từ caption ad cũ =====
    // Lỗi Huệ Nhi: bấm "Bắt đầu" -> CLIP đọc caption ad cũ ra Celyne -> bot báo giá mẫu mới. "Bắt đầu" là nút mở màn
    // Messenger, KHÔNG phải khách hỏi mẫu. -> Xoá mẫu derive nhầm + gửi 10 mẫu MỚI cho khách chọn (1 lần/hội thoại).
    // TRỪ: thread đã có đơn (hậu mãi) -> để guard hậu mãi / người thật lo, KHÔNG dội gallery.
    if (isGetStartedOnly(latestText) && imageCount === 0 && !mem._postOrderThread
        && !humanInbox && !mem.orderClosed && !mem.newGallerySent) {
      // Xoá mọi mẫu code vừa đoán từ caption/khoá cũ -> tránh nhánh dưới báo giá nhầm.
      fromText = []; mem.currentProduct = null; mem.commentPostProduct = null; mem.quotedProducts = [];
      // KHÔNG gửi gallery NGAY: Pancake hay TÁCH cụm khởi đầu -> "Bắt đầu" tới trước, vài-chục giây sau
      //  khách mới gửi ẢNH/MẪU ở lượt riêng. Gửi gallery ngay -> khách bị NHẬN CẢ gallery 10 mẫu (thừa) lẫn
      //  giá mẫu họ quan tâm. -> HOÃN gallery ~22s qua bộ hẹn-giờ (sweep): KHÔNG đứng chờ, đi xử conv khác;
      //  nếu trong lúc chờ khách gửi ảnh/mẫu -> guard "khách vừa nhắn tiếp" HUỶ gallery, vòng poll báo giá mẫu đó;
      //  hết hạn mà vẫn chỉ "Bắt đầu" -> sweep mới gửi gallery 10 mẫu.
      const GS_GALLERY_DELAY = 22000;
      pendingFollowups.set(String(conversationId), {
        at: Date.now(),
        custAt: lastCustomerMsgAt.get(String(conversationId)) || 0,
        delay: GS_GALLERY_DELAY,
        stage: 0,
        kind: "GS_GALLERY"
      });
      mem._gsDeferAt = Date.now();
      console.log(`[${BOT_NAME}] Tin CHỈ "Bắt đầu" (Get Started) -> HOÃN gallery ${GS_GALLERY_DELAY / 1000}s (đi xử conv khác trước; khách gửi ảnh/mẫu thì HUỶ gallery). Conv: ${conversationId}`);
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // CỜ hậu-đơn BỀN (đặt SỚM, trước khối ADS): conv ĐÃ chốt đơn (everOrdered / có mã trong orderedByCode).
    //  -> Các nhánh ADS "không đọc được mẫu -> gắn người thật" KHÔNG được tóm conv đã chốt. Câu sau chốt ("ok e",
    //     "gửi chuẩn nha", "mấy ngày nhận") thuộc khối HẬU-ĐƠN ở dưới, KHÔNG phải khách mới từ quảng cáo.
    //  (orderClosed bị reset mỗi lượt nên KHÔNG đủ tin; everOrdered/orderedByCode mới bền qua các lượt.)
    const _isPostOrderConv = !!(mem.everOrdered || (mem.orderedByCode && Object.keys(mem.orderedByCode).length));

    // ===== ADS/BÀI VIẾT MẪU MỚI nhưng KHÔNG đọc được creative + đang khoá mẫu KHÁC =====
    // Pancake KHÔNG trả ảnh/caption cho ad của page này; khách "replied to a post" chỉ kèm link pfbid
    // (không gọi lại API được). Cổng QUẢNG CÁO ở trên đã thử ĐỌC mẫu ad: nếu ĐỌC ĐƯỢC thì nó báo & return rồi.
    // Tới đây nghĩa là KHÔNG đọc được. Nếu cứ chạy tiếp, nhánh báo giá sẽ dùng MẪU ĐANG KHOÁ (cũ) -> BÁO SAI
    // (vd: khoá Oviya, nhưng khách vừa bấm ad FELINE). -> XOÁ khoá cũ + ĐẨY NGƯỜI THẬT, KHÔNG báo lại mẫu cũ.
    if (data.fromAd && _adId
        && (data.adRepliedPostId || data.adRepliedPfbid)   // CÓ marker "khách vừa trả lời 1 bài/ad" (tín hiệu MẪU MỚI thật)
        && _adId !== mem.lastAdId                           // ad NÀY chưa từng báo đúng
        && mem.adEscalatedFor !== _adId                     // chưa đẩy người thật cho ad này (chạy 1 lần)
        && mem.currentProduct                               // ĐANG khoá 1 mẫu -> nguy cơ báo SAI mẫu đó
        && imageCount === 0                                 // khách KHÔNG tự gửi ảnh mẫu
        && !fromImages.length && !fromText.length           // khách KHÔNG nêu tên/ảnh mẫu nào -> thật sự không biết mẫu ad
        && !isCommentOrigin && !humanInbox && !mem.orderClosed && !_isPostOrderConv
        && !shopRepliedAfterLastCustomer(data.messages)) {
      const _oldLock = _codeUp(mem.currentProduct);
      mem.adEscalatedFor = _adId;
      mem.currentProduct = null; mem.commentPostProduct = null; mem.quotedProducts = [];   // XOÁ khoá cũ kẻo nhánh dưới báo lại
      await tagChoXuLyVaUnread(conversationId);
      const _pf = data.adRepliedPfbid ? ` | bài: .../posts/${String(data.adRepliedPfbid).slice(0, 30)}` : (data.adRepliedPostId ? ` | bài: ${data.adRepliedPostId}` : "");
      console.log(`[${BOT_NAME}] ADS mẫu MỚI (adId=${_adId}) KHÔNG đọc được creative + đang khoá mẫu khác (${_oldLock}) -> XOÁ khoá + ĐẨY NGƯỜI THẬT, KHÔNG báo lại mẫu cũ.${_pf}`);
      mem.lastBotReply = HUMAN_CHECK_REPLY; mem.botHandoffAt = Date.now();
      updateConversationState(conversationId, mem); markProcessed(batch);
      return true;
    }
    // THÔNG MINH: CLIP ảnh TRƯỢT + tin nhắn KHÔNG có tên mẫu -> đọc TÊN sản phẩm trong CAPTION quảng cáo
    // HOẶC trong TIN SHOP đã báo trong thread (vd shop đã nhắn "Thiết kế Giannal: 890k" -> đó là mẫu đang tư vấn).
    if (!fromImages.length && !fromText.length) {
      // [FIX Ngoc Lan] Khách CHỐT theo MÀU khi đang có ≥2 mẫu: "cho chị bộ hồng" -> chọn mẫu MÀU HỒNG
      //   (Giannal), KHÔNG vớ mẫu-ảnh-cuối (Delicacy trắng). Đúng 1 mẫu khớp màu -> chọn; mơ hồ (0/≥2) -> để luồng cũ.
      if (imageCount === 0 && Array.isArray(mem.quotedProducts) && mem.quotedProducts.length >= 2) {
        try {
          const _txtColor = extractColor(latestText);
          if (_txtColor) {
            const _colorOf = (code) => {
              const C = String(code || "").toUpperCase();
              return (mem.orderColorByCode || {})[C] || (mem.orderColorByCode || {})[code]
                  || (mem.sourceColorByCode || {})[C] || (mem.sourceColorByCode || {})[code]
                  || (mem.colorByCode || {})[C] || (mem.colorByCode || {})[code] || null;
            };
            const _match = mem.quotedProducts.filter(p => { const mc = _colorOf(p && p.code); return mc && colorMatches(mc, _txtColor); });
            if (_match.length === 1) {
              fromText = [_match[0]];
              console.log(`[reader] [FIX Ngoc Lan] khách nói màu "${_txtColor}" + đang có ${mem.quotedProducts.length} mẫu -> chọn ĐÚNG mẫu màu đó: ${_match[0].code} (${_match[0].name}).`);
            } else {
              console.log(`[reader] [FIX Ngoc Lan] khách nói màu "${_txtColor}" nhưng ${_match.length} mẫu khớp (mơ hồ) -> KHÔNG đoán, để luồng cũ.`);
            }
          }
        } catch (_) {}
      }
      // ƯU TIÊN: follow-up bằng CHỮ ("có màu khác/size/giá") ngay sau khi 1 bộ ẢNH vừa hiện (bot HOẶC khách gửi)
      // -> bám MẪU CỦA ẢNH GẦN NHẤT đó, KHÔNG vớ 1 câu chữ cũ (lỗi Phuong Pham: reply vào bộ ảnh kem nhưng
      //    bot vớ "Oviya" từ câu báo giá cũ). Pancake KHÔNG đưa tấm ảnh được-reply -> dùng trí nhớ "mẫu vừa hiện".
      //  [Ngoc Lan] CHỈ bám mẫu-ảnh-cuối khi color-picker ở trên CHƯA chọn được mẫu (fromText còn rỗng).
      if (!fromText.length && imageCount === 0 && mem.lastShownCode && mem.lastShownAt && (Date.now() - mem.lastShownAt < 30 * 60 * 1000)) {
        try {
          const _cat = await ensureCatalog();
          const _p = _cat.byCode.get(String(mem.lastShownCode).toUpperCase());
          if (_p) { fromText = [_p]; console.log(`[reader] follow-up bằng chữ -> bám MẪU ẢNH GẦN NHẤT đã hiện: ${_p.code} (${_p.name}).`); }
        } catch (_) {}
      }
      // Caption AD/POST: chỉ khi khách ĐẾN TỪ ad/comment lượt này (ảnh khả năng là ảnh của bài -> hợp lệ).
      // NHƯNG nếu ad ĐÃ thử mà KHÔNG xác định được mẫu (_adUnresolvedModel) -> KHÔNG đoán từ caption nữa
      // (tránh quét tin shop cũ / candidate đời nào rồi lôi 1 mẫu vô can ra báo giá sai). Để nhường người thật.
      // [FIX Thuận Vỏ] Khách GỬI ẢNH mà vision TRƯỢT (imageCount>0) -> ảnh là MẪU KHÁCH MUỐN HỎI, KHÔNG phải
      //   mẫu trong caption ad. TUYỆT ĐỐI không lôi caption ra đoán -> để rơi xuống "ảnh không nhận ra" = NGƯỜI THẬT.
      //   (lỗi: ảnh set lạ + đang khoá Plena -> caption đọc trượt ra Mireva -> giữ Plena -> báo giá SAI.)
      const adCaptions = ((data.fromAd || isCommentOrigin) && !mem._adUnresolvedModel && imageCount === 0)
        ? [data.adTitle, data.postCaption, ...(data.adCaptionCandidates || [])].filter(c => c && String(c).trim())
        : [];
      // Tin SHOP cũ: CHỈ dùng khi khách KHÔNG gửi ảnh lượt này (follow-up bằng chữ kiểu "giá").
      //  Khách GỬI ẢNH mà vision TRƯỢT = ảnh là mẫu MỚI bot chưa nhận ra -> TUYỆT ĐỐI không lấy mẫu shop nhắc
      //  trước đó để báo giá (lỗi Phuong Pham: ảnh quần short lạ -> bot báo "Ovella" theo tin shop cũ).
      // Khách vừa gửi ẢNH mẫu MỚI mà vision đọc trượt (lượt trước) -> giờ "báo giá mẫu này / còn mẫu này"
      // = hỏi mẫu MỚI đó, KHÔNG phải mẫu shop báo trước. KHÔNG vớ tin shop cũ -> để nhường người thật.
      // [FIX Nguyễn Hương] Khách ĐẾN TỪ AD/COMMENT: TUYỆT ĐỐI KHÔNG đoán mẫu từ tin shop cũ (shopMsgs).
      //   Lỗi: ad Giannal, caption không ra mẫu -> tụt xuống tin shop cũ -> vớ "Yelissea" (mẫu vô can) -> báo giá SAI.
      //   Ca từ-ad: chỉ được dùng caption ad + VISION ảnh bài ad (xử ở dưới); trượt cả 2 -> NGƯỜI THẬT.
      const _refersNewModel = /(m[ẫâ]u|m[ẩâ]u|b[ộô]|set|v[áa]y|đ[ầâ]m|[áa]o|c[áa]i)\s*(n[àa] ?y|nay|kia|đ[óo]|do|đ[âa]y|day|m[ớo]i|moi)|c[òo]n\s*(m[ẫâ]u|c[áa]i|b[ộô]|set|v[áa]y|đ[ầâ]m)|b[áa]o\s*gi[áa]\s*(m[ẫâ]u|c[áa]i|b[ộô]|set|v[áa]y|đ[ầâ]m)/i.test(latestText || "");
      const _recentUnresolvedImg = mem._unresolvedImgAt && (Date.now() - mem._unresolvedImgAt < 15 * 60 * 1000);
      const _fromAdOrComment = !!(data.fromAd || _adId || isCommentOrigin);
      const shopMsgs = (imageCount === 0 && !_fromAdOrComment && !(_recentUnresolvedImg && _refersNewModel) && !mem._adUnresolvedModel && !_isPostOrderConv)
        ? (data.messages || [])
            .filter(m => m && m.sender === "shop" && m.type === "text" && m.text && m.text.length >= 8)
            .map(m => m.text).reverse().slice(0, 12)
        : [];
      if (_recentUnresolvedImg && _refersNewModel && imageCount === 0) {
        console.log(`[reader] khách vừa gửi ảnh mẫu MỚI (vision trượt) + hỏi "${String(latestText).slice(0,30)}" -> KHÔNG vớ mẫu shop cũ, nhường người thật.`);
      }
      const captions = [...adCaptions, ...shopMsgs];
      if (!fromText.length) for (const cap of captions) {
        try {
          const hit = await findInText(cap);
          if (hit && hit.length) {
            fromText = hit;
            console.log(`[reader] CLIP trượt -> đọc TÊN từ ${adCaptions.includes(cap) ? "caption ad/post" : "tin shop"} -> ${hit[0].code} (${hit[0].name}) | "${String(cap).slice(0, 50)}"`);
            break;
          }
        } catch (_) {}
      }
      // [FIX Nguyễn Hương] Khách ĐẾN TỪ AD + caption KHÔNG ra mẫu + KHÔNG ảnh khách -> NHẬN DIỆN ẢNH BÀI AD.
      //   Vision đọc ảnh của BÀI quảng cáo (postImages/adPhotoUrl) để ra mẫu. Trượt cả vision -> nhường người thật
      //   (xử ở nhánh "_adUnresolvedModel" / cổng ad). TUYỆT ĐỐI không quay lại đoán tin shop cũ (đã chặn shopMsgs).
      if (!fromText.length && (data.fromAd || _adId) && imageCount === 0 && !_isPostOrderConv) {
        const _adPostImgs = [data.adPhotoUrl, ...(data.postImages || [])].filter(Boolean);
        if (_adPostImgs.length) {
          try {
            const _capForPost = [data.adTitle, data.postCaption, ...(data.adCaptionCandidates || [])].filter(c => c && String(c).trim()).join(" \n ");
            const _pr = await resolveProductFromPost(_capForPost, _adPostImgs);
            if (_pr && _pr.product) {
              fromText = [_pr.product];
              if (_pr.color) { const _kc = String(_pr.product.code || "").toUpperCase(); mem.sourceColorByCode = Object.assign({}, mem.sourceColorByCode || {}, { [_kc]: _pr.color }); }
              console.log(`[reader] AD caption trượt -> VISION ẢNH BÀI AD -> ${_pr.product.code} (${_pr.product.name})${_pr.color ? " màu " + _pr.color : ""}.`);
            } else {
              console.log(`[reader] AD caption trượt + VISION ảnh bài ad cũng KHÔNG ra mẫu (${_adPostImgs.length} ảnh) -> nhường người thật, KHÔNG đoán tin shop cũ.`);
            }
          } catch (e) { console.log(`[reader] VISION ảnh bài ad lỗi: ${e.message}`); }
        }
        // Vision ảnh bài ad cũng trượt -> đánh cờ ad-không-ra-mẫu + nhường NGƯỜI THẬT (không báo bừa).
        if (!fromText.length) {
          // LỖI TẠM THỜI (429 rate-limit / API ad deprecated) khi đọc bài ad -> ĐỪNG gắn người thật.
          //  Bỏ qua lượt để QUÉT LẠI vòng sau (như gỡ thẻ tay). Chỉ thử tối đa 5 lần rồi mới đành nhường người.
          if (data._adFetchTransientFail) {
            mem._adRlRetry = (mem._adRlRetry || 0) + 1;
            if (mem._adRlRetry <= 5) {
              console.log(`[reader] AD ${_adId || "-"}: đọc bài ad LỖI TẠM THỜI (429) -> KHÔNG gắn người, để QUÉT LẠI (lần ${mem._adRlRetry}/5).`);
              updateConversationState(conversationId, mem);
              try { forceRecheckConvs.add(String(conversationId)); } catch (_) {}   // [FIX Quyen Luu] chống LIST lọc rớt khi đang chờ quét lại
              return true;   // KHÔNG markProcessed -> vòng sau đọc lại; KHÔNG tag 183
            }
            console.log(`[reader] AD ${_adId || "-"}: 429 kéo dài quá ${mem._adRlRetry} lần -> đành nhường người thật.`);
          }
          // [MAP NGUỒN CUỐI - ca Linh Phạm 2026-07-17] Bài quá cũ Pancake không trả + tên ad không đọc được
          // + caption trống + vision trắng — NHƯNG adPostId có sẵn trong MAP TAY (1555383752809784=Giannal).
          // Luật id-tươi (fix Nhung Cao) cấm adPostId cũ để chống ad-cũ-cướp-mẫu — đúng khi hội thoại ĐANG
          // bám mẫu khác; còn khi MỌI nguồn cạn VÀ hội thoại không bám mẫu nào -> map tay là chính xác nhất
          // còn lại, dùng làm NGUỒN CUỐI trước khi quét lại/nhường người.
          if (data.adPostId && !mem.currentProduct && !(mem.quotedProducts || []).length) {
            try {
              const _mL = lookupAdProduct(String(data.adPostId));
              if (_mL) {
                const _cL = await ensureCatalog();
                const _pL = _cL.byCode.get(String(_mL).toUpperCase());
                if (_pL) {
                  product = _pL; _how = "MAP nguồn cuối (adPostId " + data.adPostId + ")";
                  console.log(`[${BOT_NAME}] Ad ${_adId || "-"} -> MAP NGUỒN CUỐI (adPostId ${data.adPostId}) ra mẫu ${_pL.code} (${_pL.name}) — mọi nguồn tươi đã cạn, hội thoại không bám mẫu khác.`);
                }
              }
            } catch (_) {}
          }
          if (product) { /* đã cứu được bằng map nguồn cuối -> đi tiếp luồng báo giá bên dưới */ } else {
          // [FIX gắn-183-quá-sớm] ad chưa ra mẫu có thể do ad_ids/creative CHƯA kịp load ở nhịp quét đầu.
          //  Giống hệt gỡ thẻ tay rồi bot chạy lại là ra -> QUÉT LẠI vài nhịp TRƯỚC khi đành gắn người thật.
          if ((mem._adResolveRetry || 0) < 3) {
            mem._adResolveRetry = (mem._adResolveRetry || 0) + 1;
            console.log(`[reader] AD ${_adId || "-"}: chưa ra mẫu -> KHÔNG gắn người, QUÉT LẠI (lần ${mem._adResolveRetry}/3).`);
            updateConversationState(conversationId, mem);
            // [FIX Quyen Luu 2026-07-07] Hoãn xong bot có thể đã nhắn ở lượt trước -> last_sent_by=bot ->
            // vòng LIST lọc rớt "coi như đã trả" -> KHÔNG BAO GIỜ quét lại lần 2/3, câu khách rơi hố đen.
            // Ghi vào forceRecheckConvs: vòng LIST luôn nhặt lại conv này cho tới khi cụm tin được xử thật.
            try { forceRecheckConvs.add(String(conversationId)); } catch (_) {}
            return true;   // KHÔNG markProcessed -> vòng sau đọc lại; KHÔNG tag 183
          }
          mem._adResolveRetry = 0;   // đã thử đủ -> reset rồi mới đành nhường người thật
          mem._adUnresolvedModel = true;
          try { await tagChoXuLyVaUnread(conversationId); } catch (_) {}
          mem.botHandoffAt = Date.now();
          console.log(`[reader] AD ${_adId || "-"}: caption + ảnh bài đều KHÔNG ra mẫu -> GẮN người thật (không vớ mẫu shop cũ).`);
          mem.lastBotReply = HUMAN_CHECK_REPLY; updateConversationState(conversationId, mem); markProcessed(batch); return true;
          }   // đóng else (không cứu được bằng map nguồn cuối)
        }
      }
    }
    // CLIP trượt + caption KHÔNG ra + có ẢNH -> OCR đọc CHỮ trong ảnh (tên SP in trên ảnh chụp màn hình post).
    let _modelFromOcrOnly = false;   // mẫu CHỈ do OCR đọc chữ trong ảnh đoán ra (vision CLIP đã trượt) -> ĐỘ TIN THẤP
    if (!fromImages.length && !fromText.length && imageCount > 0) {
      const _imgs = batch.filter(x => x.type === "image" && x.imageUrl);
      for (const im of _imgs) {
        const ocrText = await ocrImageText(im.imageUrl);
        if (!ocrText) continue;
        try {
          const hit = await findInText(ocrText);
          if (hit && hit.length) {
            fromText = hit;
            _modelFromOcrOnly = true;
            console.log(`[reader] CLIP trượt -> OCR đọc tên trong ảnh -> ${hit[0].code} (${hit[0].name}) | "${ocrText.slice(0, 60).replace(/\s+/g, " ")}"`);
            break;
          }
        } catch (_) {}
      }
    }
    const thisTurn = dedupByCode([...fromImages, ...fromText]);
    const unresolved = Math.max(0, imageCount - fromImages.length);
    // VISION (CLIP) TRƯỢT + mẫu CHỈ do OCR đọc chữ trong ảnh đoán ra -> độ tin THẤP, dễ báo nhầm mẫu.
    //  Nguyên tắc: "nhận diện không chắc -> nhường NGƯỜI THẬT, KHÔNG báo giá bừa". Gắn AI-CHỜ XL, im.
    if (imageCount > 0 && fromImages.length === 0 && _modelFromOcrOnly && !isCommentOrigin) {
      try { await tagChoXuLyVaUnread(conversationId); } catch (_) {}
      mem.botHandoffAt = Date.now();
      console.log(`[reader] Ảnh + VISION trượt, mẫu chỉ do OCR đoán -> KHÔNG báo bừa, gắn NGƯỜI THẬT (nhường xử lý).`);
      mem.lastBotReply = "[ocr-uncertain]"; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }
    // NHỚ: khách vừa gửi ẢNH mà vision KHÔNG đọc ra mẫu (mẫu MỚI bot chưa biết) -> đánh dấu thời điểm.
    // Lượt sau khách nhắn "báo giá mẫu này / còn mẫu này" (không ảnh) -> KHÔNG vớ nhầm mẫu shop cũ.
    if (imageCount > 0 && fromImages.length === 0) mem._unresolvedImgAt = Date.now();
    else if (fromImages.length > 0) mem._unresolvedImgAt = 0;
    // MÀU khách gửi (đọc từ tên file ảnh khớp) cho mẫu nhận ra đầu tiên -> nhớ lại để tư vấn/lên đơn.
    // [SỬA Thuy Nguyen] KHÔI PHỤC SIZE TỪ LỊCH SỬ: khách đã cho size / cân nặng ở LƯỢT TRƯỚC
    //  (mem mất do restart, hoặc size nằm ngoài batch hiện tại) -> nạp lại để KHÔNG hỏi lại "chiều cao cân nặng".
    if (!mem.customerSize && Array.isArray(data.messages)) {
      try {
        const _custTexts = data.messages
          .filter(m => m && m.sender === "customer" && m.type === "text" && m.text)
          .map(m => m.text);
        for (let i = _custTexts.length - 1; i >= 0; i--) {
          if (isGiftContext(_custTexts[i])) continue;
          const _sz = extractStatedSize(_custTexts[i]);
          if (_sz && _sz !== "FREESIZE") {
            mem.customerSize = _sz; mem.sizeFromCustomer = true;
            console.log(`[${BOT_NAME}] [SỬA Thuy Nguyen] khôi phục size khách = ${_sz} từ lịch sử -> KHÔNG hỏi lại.`);
            break;
          }
          const _kg = parseWeightKg(_custTexts[i]);
          if (_kg && _kg > 0) { mem._weightFromHistory = _kg; if (!mem.weightKg) mem.weightKg = _kg; }   // [FIX Hien Nguyen] nhớ CÂN NẶNG thật -> suy size lúc chốt, KHÔNG xin lại
        }
      } catch (_) {}
    }

    const _topImgCode = String((fromImages[0] && fromImages[0].code) || "").toUpperCase();
    const _imgColor = _topImgCode ? (imgColors[_topImgCode] || "") : "";
    if (_imgColor) { mem.imageColor = _imgColor; mem.imageColorCode = _topImgCode; }
    // Lưu MÀU theo từng mã (khách gửi nhiều mẫu -> mỗi mẫu 1 màu) để lọc theo màu & lên đơn.
    if (Object.keys(imgColors).length) {
      mem.colorByCode = Object.assign({}, mem.colorByCode || {}, imgColors);
      // CASE A: khách GỬI ảnh và KHÔNG hỏi/đòi xem màu khác -> mặc định CHỐT đúng màu của ảnh đó.
      const _askingColor = !!extractColor(latestText) || asksOtherColors(latestText);
      if (!_askingColor) {
        mem.orderColorByCode = Object.assign({}, mem.orderColorByCode || {}, imgColors);
      }
    }
    // Lưu tấm ẢNH KHỚP NHẤT theo mã (để gửi lại đúng ảnh khách gửi, tránh gửi nhầm ảnh khác trong cùng mã).
    const matchedImgs = (fromImages && fromImages._matchedImgByCode) || {};
    if (Object.keys(matchedImgs).length) {
      mem.matchedImgByCode = Object.assign({}, mem.matchedImgByCode || {}, matchedImgs);
    }
    // Khách quan tâm/đưa MẪU MỚI ở lượt này -> mở lại cờ chốt (cho phép chốt đơn tiếp theo).
    const _wasOrderClosed = mem.orderClosed;   // [GĐ4] nhớ trạng thái CHỐT trước khi reset (để biết khách đang THÊM vào đơn đã chốt)
    if (thisTurn.length > 0) mem.orderClosed = false;

    // ===== AI ĐỌC TIN ĐẦU TIÊN (phương án B - bản LAI AN TOÀN) =====
    // AI đọc tin khách trước, CHỈ GẮN NHÃN + rút size/địa chỉ mà code (regex) hay trượt.
    // AI **KHÔNG** chế giá/đơn/sđt -> phần tiền/đơn vẫn 100% code. Lỗi/timeout/tắt -> bỏ qua,
    // chạy thuần code như cũ. Bật/tắt bằng env AI_READ_FIRST (mặc định "on").
    mem._aiIntent = null;
    mem._aiConcern = null;
    mem._aiSize = null;           // size AI bóc -> reset mỗi lượt, tránh dính size lượt cũ
    mem._aiOk = false;            // [AI-QUYẾT] AI đã đọc & phân loại ĐƯỢC lượt này? -> dùng để: AI chạy thì TIN AI,
    mem._aiAsksPrice = false;     //   regex chỉ ĐỠ khi AI rỗng/timeout (thay vì OR khiến regex tự bắn false-positive).
    mem._aiPaymentMethod = false;
    mem._aiPhone = null;              // sđt AI bóc sạch lượt này (hiểu câu ghép) -> regex chỉ KIỂM 10 số
    mem._aiAddrComplete = null;       // AI phán địa chỉ đủ giao chưa (null=AI không phán -> regex đỡ). AI CHỈ được NỚI (true), không ép thiếu.
    mem._aiProvinceConfirm = false;   // AI thấy tỉnh/thành thuộc diện SÁP NHẬP -> hỏi xác nhận (phương án B)
    mem._aiRefersTo = null;           // [ĐA MẪU] mẫu khách nhắc (AI neo) - reset mỗi lượt
    mem._aiIsAddress = false;         // tin lượt này có phải địa chỉ không (để AI ép "thiếu" đúng lúc)
    if (String(process.env.AI_READ_FIRST || "on").toLowerCase() === "on"
        && latestText && latestText.trim().length >= 1) {
      try {
        // [NGỮ CẢNH ĐA MẪU] tóm tắt mẫu ĐÃ BÁO GIÁ + vài lượt gần nhất -> AI neo "set jum trắng"/"mẫu xanh"/"cái kia" đúng mẫu.
        const _qp = (mem.quotedProducts || []).filter(p => p && p.name);
        const _orderCtx = _qp.length
          ? ("Mẫu đã báo giá: " + _qp.map(p => {
              const pr = p.priceText || (p.price ? String(p.price) : "");
              return `${p.name}${p.code ? "(" + p.code + ")" : ""}${pr ? " " + pr : ""}${p.color ? " màu " + p.color : ""}`;
            }).join("; ") + (mem.orderClosed ? ". Đã có đơn chốt." : ""))
          : "";
        const _recent = (Array.isArray(data.messages) ? data.messages : [])
          .filter(m => m && m.type === "text" && m.text && String(m.text).trim())
          .slice(-6)
          .map(m => `${m.sender === "shop" ? "Shop" : "Khách"}: ${String(m.text).slice(0, 90)}`)
          .join("\n");
        const _lab = await classifyIntent({
          text: latestTextRaw || latestText,
          lockedProductName: (mem.currentProduct && (mem.currentProduct.name || mem.currentProduct.code)) || "",
          lastShopLine: mem.lastBotReply || "",
          knownAddress: mem.address || "",
          orderContext: _orderCtx,
          recentTurns: _recent
        });
        if (_lab && _lab.ok) {
          mem._aiIntent = _lab.kind;
          mem._aiConcern = _lab.concern || null;   // AI bóc đặc điểm khách lo: ngan/mong/chat/cogian/lot/dem
          mem._aiSize = (_lab.size && _lab.size !== "FREESIZE") ? String(_lab.size).toUpperCase() : null;   // size AI bóc lượt này (dùng khi extractStatedSize trượt vì gõ sai "Szai/síze")
          mem._aiDoLuong = _lab.do_luong ? String(_lab.do_luong) : null;   // [NGỮ CẢNH SỐ ĐO] AI gom từ TOÀN hội thoại ("1m55/42kg") - nguồn sự thật số đo, code chỉ đọc
          mem._aiOk = true;
          mem._aiAsksPrice = !!_lab.asks_price || _lab.kind === "PRICE_ASK";
          mem._aiPaymentMethod = _lab.kind === "PAYMENT_METHOD";
          mem._aiPhone = (typeof _lab.phone === "string" && /^0\d{9}$/.test(_lab.phone)) ? _lab.phone : null;
          mem._aiAddrComplete = (typeof _lab.address_complete === "boolean") ? _lab.address_complete : null;
          mem._aiProvinceConfirm = _lab.province_confirm === true;
          mem._aiRefersTo = _lab.refers_to || null;   // [ĐA MẪU] mẫu khách nhắc (AI neo) - hiện CHỈ ghi log để theo dõi, CHƯA tự chốt
          mem._aiIsAddress = !!_lab.is_address;        // tin lượt này CÓ nội dung địa chỉ? (để AI được ép "thiếu" đúng lúc)
          console.log(`[AI-READ] nhãn=${_lab.kind} | size=${_lab.size || "-"} addr=${_lab.is_address} order=${_lab.wants_order} price=${_lab.asks_price} chart=${_lab.asks_size_chart} concern=${_lab.concern || "-"} | phone=${_lab.phone || "-"} addrDu=${_lab.address_complete} provConfirm=${_lab.province_confirm} refers=${_lab.refers_to || "-"}`);
          // (1) SIZE: AI bắt được size mà extractStatedSize trượt -> điền, hết hỏi lại size.
          // [FIX Thuy Nguyen 2026-07-11] "M62 53 kg" = cao 1m62 nặng 53kg (khách gõ tắt) — AI vớ chữ "M"
          // phán size=M -> hệ thống tin nhầm "khách TỰ KHAI M" (sizeFromCustomer=true) -> về sau nhánh
          // tôn-trọng-size-khách bảo vệ một lời khai KHÔNG TỒN TẠI. Luật BẰNG CHỨNG: chỉ nhận size khi tin
          // có ngữ cảnh size rõ ("size M"/"mặc M"/"lấy M"/"M nhé"); chữ cái DÍNH LIỀN SỐ (m62/M62/1m62)
          // hoặc tin đang là cụm số-đo thì KHÔNG BAO GIỜ là size.
          const _szEvid = /\b(size|sz|mặc|mac|lấy|lay|chốt|chot|đổi|doi)\s*(s|m|l|xl|xxl|2xl)\b|\b(s|m|l|xl|xxl)\s*(nhé|nha|nhe|ạ|a|đi|di)\b/i.test(String(latestText || ""));
          const _szHeightTrap = /\b1?m\s?\d{2}\b|\bm\d{2}\b/i.test(String(latestText || ""));
          if (_lab.size && _lab.size !== "FREESIZE" && !mem.customerSize && !isGiftContext(latestText)) {
            if (!_szEvid && _szHeightTrap) {
              console.log(`[AI-READ] size=${_lab.size} bị BỎ: tin là cụm SỐ ĐO ("${String(latestText || "").slice(0, 25)}"), chữ cái dính số = chiều cao, không phải size khách khai.`);
            } else {
              mem.customerSize = _lab.size; mem.sizeFromCustomer = _szEvid;   // không đủ bằng chứng -> KHÔNG đánh dấu "khách tự khai"
              console.log(`[AI-READ] -> set size khách = ${_lab.size} (code đã trượt)${_szEvid ? "" : " | bằng chứng yếu -> KHÔNG khóa sizeFromCustomer"}.`);
            }
          }
          // (2) ĐỊA CHỈ giao: AI nhận ra mà code trượt -> đánh dấu ĐANG CHO ĐỊA CHỈ (=> luồng chốt, KHÔNG báo giá lại).
          //     AI CHỈ phất cờ "đây là địa chỉ"; CHUỖI địa chỉ thật vẫn do code bóc (cleanAddress), KHÔNG để AI bịa.
          // [GUARD] Nếu nhãn chính là CÂU HỎI (hỏi hàng đẹp như hình, hỏi giá, bảng size, lăn tăn, cảm ơn, gấp...)
          // thì TUYỆT ĐỐI không ép thành "đang cho địa chỉ/chốt" — 1 câu hỏi không thể là địa chỉ. Tránh chốt nhầm.
          const _askKinds = ["AUTHENTICITY_QA", "PRICE_ASK", "SIZE_CHART", "QUALITY_CONCERN", "POLICY_QA", "POST_ORDER_CHITCHAT", "POST_ORDER_REQUEST", "POST_ORDER_CONFIRMED", "THANKS", "URGENT", "COLOR_ASK", "ASK_COLOR"];
          const _isAskLabel = _askKinds.includes(String(_lab.kind || "").toUpperCase());
          if ((_lab.is_address || _lab.kind === "ADDRESS") && !_isAskLabel && !mem._addrJustGiven && !asksShopAddress(latestText)
              && !looksLikeQuestion(latestText)) {
            mem._addrJustGiven = true; mem._reaskedAddr = false;
            if (!mem.address) {
              try {
                const _caddr = cleanAddress(latestTextRaw || latestText);
                // [FIX Nhung Cao "Địa chỉ: Có mấy màu"] AI có thể phất NHẦM is_address cho câu thường ->
                //   CHỈ lưu khi chuỗi có tín hiệu địa chỉ THẬT: có tỉnh/địa danh (vn_address) hoặc tầng
                //   hành chính (thôn/xã/phường/đường/số nhà...). Không có -> BỎ, không lưu rác vào đơn.
                const _fca = _va.fold(_caddr);
                const _okAddr = !!(_va.explicitProvince(_fca)
                  || (typeof _va.hasAreaToken === "function" && _va.hasAreaToken(_fca))
                  || /(\d+[a-z]?\s*(\/|-)\s*\d+)|((số|so)\s*(nhà|nha)?\s*\d)|((thôn|thon|xóm|xom|ấp|ap|đội|doi|khu|tổ|to|lô|lo|kiệt|kiet)\s*\d*\s)|((xã|xa|phường|phuong|thị\s*trấn|thi\s*tran|quận|quan|huyện|huyen)\s)|((đường|duong|phố|pho|ngõ|ngo|ngách|ngach|hẻm|hem)\s)/i.test(" " + _caddr + " "));
                if (_okAddr) { mem.address = _caddr; }
                else { console.log(`[AI-READ] -> BỎ lưu địa chỉ: "${String(_caddr).slice(0, 30)}" KHÔNG có tín hiệu địa danh (AI phất nhầm is_address).`); }
              } catch (_) {}
            }
            console.log(`[AI-READ] -> coi là ĐỊA CHỈ giao / đang chốt (code đã trượt).`);
          } else if ((_lab.is_address || _lab.kind === "ADDRESS") && (_isAskLabel || looksLikeQuestion(latestText))) {
            console.log(`[AI-READ] -> BỎ cờ địa-chỉ vì là câu HỎI (nhãn ${_lab.kind}) -> không chốt nhầm.`);
          }
          // (3) SĐT: AI phất cờ có sđt mà code chưa bắt -> để code bóc SỐ thật từ chữ (regex), KHÔNG để AI bịa số.
          if ((_lab.has_phone || _lab.kind === "PHONE") && !mem.phone) {
            try { const _ph = ((latestTextRaw || latestText || "").match(/(?:\+?84|0)(?:\d[\s.\-]?){8,10}\d/) || [])[0] || null; if (_ph) { mem.phone = _ph.replace(/[\s.\-]/g, ""); console.log(`[AI-READ] -> bóc SĐT (code regex) = ${mem.phone}.`); } } catch (_) {}
          }
        } else {
          // AI trả về KHÔNG ok (timeout / lỗi API / rỗng) -> ghi rõ để theo dõi (thay vì im lặng)
          console.log(`[AI-READ] BỎ QUA: AI không trả nhãn (ok=false) -> chạy thuần code. reason=${(_lab && _lab.reason) || "timeout/loi-api"}`);
        }
      } catch (e) {
        console.log(`[AI-READ] LỖI: ${(e && e.message) || e} -> bỏ qua, chạy thuần code`);
      }
    }
    // ===== AI-FIRST DISPATCH (lưới hiểu-cả-câu) =====
    // [AI-QUYẾT ưu tiên] productInfo/quotedProducts khai báo SỚM tại đây (trước điểm AI) để hàm hành-động
    // _aiQuyetHanhDong (gọi ngay sau khi AI trả JSON) gán được khi CHOT_DON. FOCUS phía dưới gán đè bình thường.
    let productInfo = null;
    let quotedProducts = mem.quotedProducts || [];
    // ===== [AI-QUYẾT] Gọi 1 lần/lượt: AI đọc hội thoại + ứng viên mẫu -> JSON quyết định =====
    // Kết quả để ở mem._aiQ; các điểm nối (referent sau FOCUS, contact/chốt đơn) dùng theo công tắc.
    mem._aiQ = null;
    {
      const _aqCfg = aiQuyetCfg();
      if (_aqCfg.log_so_sanh || _aqCfg.bat_referent || _aqCfg.bat_diachi_chotdon) {
        try {
          // (1) Hội thoại gần nhất: KHACH/SHOP, cũ -> mới (SHOP gồm cả bot lẫn nhân viên).
          const _aqTurns = (data.messages || [])
            .filter(m => m && (m.text || m.type === "photo") && m.type !== "system")
            .slice(-20)
            .map(m => (m.sender === "shop" ? "SHOP: " : "KHACH: ") + (m.text ? String(m.text).replace(/\s+/g, " ").slice(0, 160) : "[gửi ảnh]"))
            .join("\n");
          // (2) Ứng viên mẫu: từ cụm đã báo + vision lượt này + ad/bài lượt này (kèm nguồn để AI cân).
          const _aqSeen = new Set(); const _aqCands = [];
          const _aqPush = (p, nguon) => {
            if (!p || !p.code) return; const k = String(p.code).toUpperCase();
            if (_aqSeen.has(k)) return; _aqSeen.add(k);
            _aqCands.push(`${k} | ${p.name || "?"} | màu:${String(p.color || "").replace(/\s+/g, " ").slice(0, 60)} | size:${p.size || "?"} | nguồn=${nguon}`);
          };
          for (const p of (fromImages || [])) _aqPush(p, "ẢNH khách gửi LƯỢT NÀY");
          for (const p of (fromText || [])) _aqPush(p, "khách GÕ TÊN lượt này");
          for (const p of (mem.quotedProducts || [])) _aqPush(p, "ĐÃ tư vấn/báo giá trong hội thoại");
          if (mem.currentProduct) _aqPush(mem.currentProduct, "mẫu đang khoá");
          // ad/bài dính trên hội thoại: chỉ đưa TÊN nguồn để AI tự cân (map được thì kèm mã)
          try {
            const _aqAdCode = (typeof lookupAdProduct === "function") ? (lookupAdProduct(_adId) || (data.adPostId && lookupAdProduct(data.adPostId)) || (data.postId && lookupAdProduct(data.postId))) : null;
            if (_aqAdCode) { const _c2 = await ensureCatalog(); const _p2 = _c2.byCode.get(String(_aqAdCode).toUpperCase()); if (_p2) _aqPush(_p2, "QUẢNG CÁO dính trên hội thoại (cẩn thận: có thể là ad CŨ)"); }
            else if (data.adTitle || data.postCaption) { _aqCands.push(`(chưa rõ mã) | caption ad/bài: "${String(data.adTitle || data.postCaption).replace(/\s+/g, " ").slice(0, 80)}" | nguồn=QUẢNG CÁO dính trên hội thoại`); }
          } catch (_) {}
          // (3) Thông tin đã gom
          const _aqKnown = [
            mem._aiIntent ? `NHÃN tin mới nhất (bộ phân loại): ${mem._aiIntent}${mem._aiConcern ? " | quan tâm: " + mem._aiConcern : ""} — nhãn thuộc nhóm CÂU HỎI SẢN PHẨM (hỏi màu/chất/tồn/giá/bảng size...) thì hanh_dong PHẢI là TU_VAN.` : "",
            mem.phone ? `SĐT: ${mem.phone}` : "SĐT: chưa có",
            mem.address ? `Địa chỉ đã gom: "${String(mem.address).slice(0, 200)}"` : "Địa chỉ: chưa có",
            mem.customerSize ? `Size khách: ${mem.customerSize}` : (mem.weightKg ? `Cân nặng: ${mem.weightKg}kg` : "Size: chưa có"),
            mem.orderClosed ? "ĐƠN ĐÃ CHỐT RỒI (không chốt lại)" : "Đơn: chưa chốt",
            mem._provConfirmDone ? "ĐÃ hỏi xác nhận tỉnh rồi (không hỏi lại)" : ""
          ].filter(Boolean).join("\n");
          const _aqT0 = Date.now();
          const _aq = await aiQuyet.quyetDinh({ turns: _aqTurns, candidatesText: _aqCands.join("\n"), known: _aqKnown });
          if (_aq && _aq.ok) {
            mem._aiQ = _aq;
            console.log(`[AI-QUYẾT] referent=${_aq.referent}(${_aq.do_tin_cay}) | mẫu_cũ=[${_aq.mau_cu.join(",")}] | địa_chỉ=${_aq.dia_chi.trang_thai}${_aq.dia_chi.thieu.length ? "(thiếu " + _aq.dia_chi.thieu.join("+") + ")" : ""}${_aq.dia_chi.dia_chi_chuan ? ` | địa_chỉ_chuẩn="${_aq.dia_chi.dia_chi_chuan.slice(0, 70)}"` : ""} | hành_động=${_aq.hanh_dong} | ${Date.now() - _aqT0}ms`);
          } else {
            console.log(`[AI-QUYẾT] BỎ QUA (${(_aq && _aq.reason) || "khong-ro"}) -> chạy luật cũ.`);
          }
        } catch (e) { console.log(`[AI-QUYẾT] LỖI: ${(e && e.message) || e} -> chạy luật cũ.`); }
      }
    }
    // ===== AI-FIRST DISPATCH (tiếp) =====
    // ===== [CỔNG SALE GỌN 2026-07] che_do_sale_gon bật: bot CHỈ làm 4 việc — báo giá / chất liệu /
    // tư vấn size từ số đo / 2 câu chương trình. MỌI THỨ KHÁC: IM LẶNG TUYỆT ĐỐI + gắn Chờ-XL cho người
    // thật (khách gửi contact, muốn chốt, hậu mãi, câu hỏi khác...). Xã giao thuần thì im không cần gắn.
    // Gạt cờ false / hết hạn chương trình -> cổng tự biến mất, code gốc chạy y nguyên.
    try {
      const _sg0 = saleProgram(mem._pageId);
      if ((_sg0 && _sg0.che_do_sale_gon) || cheDoChiBaoGia()) {
        const _sgK = String(mem._aiIntent || "");
        const _sgXaGiao = ["THANKS", "POST_ORDER_CHITCHAT", "DEFER_DECISION", "CONSULT_FAMILY", "GREETING"].includes(_sgK);
        // [SỬA ca Linh Phạm 2026-07-17] Chặn theo LOẠI CÂU HỎI, KHÔNG chặn theo lịch sử: dấu "đã báo giá"
        // trong bộ nhớ có thể là của TUẦN TRƯỚC (khách cũ) -> khách quay lại hỏi MẪU MỚI mà bị câm oan.
        // Luật: chỉ các luồng DẪN TỚI BÁO GIÁ được chạy (ad/ảnh/hỏi giá/gõ tên/tồn/màu/chào) — mẫu đã báo
        // rồi thì sổ chống-trùng + giãn CTA tự đỡ spam. MỌI câu khác ("sale chưa", size, chất liệu, ship...)
        // -> IM + gắn Chờ-XL cho người thật. Xã giao thuần im không gắn.
        const _sgImgN = batch.filter(x => x.type === "image").length;
        // [SIẾT CUỐI 2026-07] Khách hỏi CHƯƠNG TRÌNH/SALE/ONLINE (nhãn DISCOUNT) -> cũng IM + người thật
        // (tắt nốt 2 câu trả lời chương trình theo lệnh; chặn TRƯỚC allow kẻo cờ price=true lách qua).
        if (_sgK === "DISCOUNT") {
          await tagChoXuLyVaUnread(conversationId);
          console.log(`[SALE GỌN] khách hỏi chương trình/sale (nhãn=DISCOUNT) -> IM LẶNG + gắn Chờ-XL cho người thật.`);
          updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        const _sgAllow = ["PRICE_ASK", "GREETING"].includes(_sgK)
          || mem._aiAsksPrice === true || _sgImgN > 0 || data.fromAd === true;
        if (!_sgAllow) {
          if (!_sgXaGiao) { await tagChoXuLyVaUnread(conversationId); }
          console.log(`[SALE GỌN] ngoài luồng báo giá (nhãn=${_sgK || "?"}) -> IM LẶNG${_sgXaGiao ? " (xã giao, không gắn)" : " + gắn Chờ-XL cho người thật"}.`);
          updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
      }
    } catch (e) { console.log(`[SALE GỌN] lỗi cổng: ${(e && e.message) || e} -> chạy bình thường.`); }
    // ===== [AI-QUYẾT ƯU TIÊN 2026-07-11] ĐẢO QUYỀN LỰC: AI PHÁT LỆNH TRƯỚC, rừng luật cũ là quân dự bị =====
    // AI vừa trả JSON ở trên. Hành động DỨT KHOÁT (XIN_SDT/XIN_DIA_CHI/XAC_NHAN_TINH/CHOT_DON/IM_NHUONG_NGUOI,
    // tin cậy đủ, qua rào hậu mãi + thẩm định) -> xử NGAY TẠI ĐÂY — không handler nào (chất liệu/báo giá/size...)
    // còn cướp được lượt (trị tận gốc lớp lỗi Lan Dieu/Hân Ngô). AI nói TU_VAN / không chắc / timeout / công tắc
    // tắt -> hàm trả false -> TOÀN BỘ luật cũ chạy y nguyên như trước.
    try {
      if (await _aiQuyetHanhDong()) {
        console.log(`[AI-QUYẾT ưu tiên] AI phát lệnh TRƯỚC dispatch -> đã xử xong lượt, luật cũ không chạy.`);
        return true;
      }
    } catch (e) { console.log(`[AI-QUYẾT ưu tiên] LỖI: ${(e && e.message) || e} -> luật cũ cầm lái.`); }
    // _ai("X") = AI gắn nhãn X. Dùng để OR vào điều kiện nhánh sẵn có -> bắt được khi TỪ-KHOÁ TRƯỢT.
    // Code vẫn DUYỆT trong từng handler (sheet/POS/catalog). AI timeout/OTHER -> _ai luôn false -> chạy thuần từ-khoá.
    const _ai = (k) => mem._aiIntent === k;

    // [AI-QUYẾT giá] AI đã đọc xong ở trên. AI chạy được -> GIÁ do AI quyết (mem._aiAsksPrice);
    // AI rỗng/timeout -> giữ giá trị regex isPriceAsk đã tính ở trên (lưới đỡ). Mọi nhánh phía dưới
    // dùng biến priceAsk này (1 nguồn sự thật) -> hết cảnh regex "tranh quyền" báo giá sai.
    if (mem._aiOk) priceAsk = mem._aiAsksPrice;

    // [AI-QUYẾT dùng chung] AI sống -> chỉ tin nhãn AI (bỏ regex); AI rỗng/timeout -> regex đỡ.
    // CHỈ dùng cho nhóm thông tin/hỏi sản phẩm. KHÔNG dùng cho hard-guard (CK/huỷ/khiếu nại/từ chối/chốt).
    const _aiOr = (rx, k) => mem._aiOk ? _ai(k) : rx;

    // ===== [SHOWROOM] AI GẮN NHÃN -> CODE TRẢ THEO NHÃN (đặt SAU khi AI đọc; regex chỉ đỡ khi AI chết) =====
    // (1) Đang chờ khách trả lời "hôm nào ghé?" (state showroomVisitAsked):
    if (mem.showroomVisitAsked && (Date.now() - mem.showroomVisitAsked) < 2 * 60 * 60 * 1000 && !mem.orderClosed) {
      const _cantCome = /(bận|chưa (qua|đi|ghé|sang|sắp xếp) (được|đc|dc)|không (qua|đi|ghé) (được|đc|dc)|để (sau|hôm khác|bữa khác)|chưa biết (khi nào|hôm nào)|chưa chắc|chưa rảnh)/i.test(latestText);
      if (mentionsVisitTime(latestText) && !_cantCome) {
        // B2: khách HẸN GIỜ cụ thể -> NGƯỜI THẬT sắp xếp giữ hàng + tiếp đón.
        mem.showroomVisitAsked = null;
        try { await tagChoXuLyVaUnread(conversationId); } catch (_) {}
        mem.botHandoffAt = Date.now();
        console.log(`[${BOT_NAME}] Khách hẹn giờ ghé showroom ("${latestText.slice(0, 30)}") -> GIAO NGƯỜI THẬT (giữ hàng).`);
        mem.lastBotReply = "[hẹn ghé showroom -> người thật]";
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      if (!_aiOr(wantsVisitShowroom(latestText), "STORE_VISIT") && !_ai("STORE_ADDRESS") && !showroomReplyFor(latestText)) {
        // B3: CHƯA chốt thời gian (bận/lưỡng lự) -> thuyết phục: ghé thử HOẶC ship tận nơi kiểm hàng.
        mem.showroomVisitAsked = null;
        const reply = "Dạ chị tiện thì ghé thử cho ưng ý nha. Còn nếu mấy hôm này chị bận chưa qua được, em tư vấn và ship tận nơi, cho kiểm hàng trước khi thanh toán luôn — chị khỏi mất công đi lại ạ.";
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Khách chưa chốt giờ ghé -> thuyết phục (ghé thử / ship tận nơi).`);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
    }
    // (2) [STORE_VISIT] Khách BÁO/HẸN SẼ GHÉ -> xin size GIỮ HÀNG + hỏi hôm nào ghé. (AI quyết; regex đỡ)
    if (_aiOr(wantsVisitShowroom(latestText), "STORE_VISIT") && !mem.orderClosed && !mem.showroomVisitAsked) {
      mem.pendingShowroomChoice = null;
      if (mem._addrJustGiven) mem.address = null;
      const _svReply = showroomVisitReply(latestText, mem);
      mem.showroomVisitAsked = Date.now();
      await sendInboxMessage(conversationId, _svReply);
      console.log(`[${BOT_NAME}] [STORE_VISIT] khách báo SẼ GHÉ -> xin size giữ hàng + hỏi hôm nào ghé.`);
      mem.lastBotReply = _svReply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }
    // (3) Đang chờ khách CHỌN cơ sở (sau danh sách showroom) + khách đáp tên cơ sở (AI: STORE_ADDRESS).
    if (mem.pendingShowroomChoice && (Date.now() - mem.pendingShowroomChoice) < 30 * 60 * 1000 && !mem.orderClosed) {
      if (_aiOr(!!showroomReplyFor(latestText), "STORE_ADDRESS")) {
        const _srReply = showroomReplyFor(latestText);
        if (_srReply) {
          mem.pendingShowroomChoice = null;
          if (mem._addrJustGiven) mem.address = null;   // tên cơ sở bị bắt nhầm thành địa chỉ giao -> xoá
          await sendInboxMessage(conversationId, _srReply);
          console.log(`[${BOT_NAME}] Khách CHỌN/HỎI CƠ SỞ (qua shop) -> trả đúng cơ sở, KHÔNG lên đơn giao.`);
          mem.lastBotReply = _srReply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
      }
      if ((Date.now() - mem.pendingShowroomChoice) >= 30 * 60 * 1000) mem.pendingShowroomChoice = null;
    }

    // [FIX màu — Thuthanh Pham] Khách GÕ THẲNG 1 màu CÓ trong danh sách màu của mẫu đang focus
    //   (vd "thích màu kem", "màu kem nha", "lấy màu kem") -> đó là MÀU KHÁCH CHỌN -> ghi vào
    //   orderColorByCode để chốt ĐÚNG, GHI ĐÈ màu mặc-định-theo-ad/ảnh (hồng). Bỏ qua khi khách HỎI
    //   "màu khác" / CHÊ màu. Đặt ở ĐẦU dispatch -> áp cho MỌI nhánh (size/địa chỉ/chốt) phía dưới.
    //   (Lỗi gốc: ad hồng -> bot bám hồng, khách nói "màu kem" mấy lần nhưng chốt đơn vẫn ra "hồng".)
    try {
      if (productInfo && !asksOtherColors(latestText) && !dislikesColor(latestText)) {
        const _ccol = String(productInfo.code || "").toUpperCase();
        const _colsHere = (typeof modelColorList === "function") ? (modelColorList(productInfo) || []) : [];
        if (_ccol && _colsHere.length >= 2) {
          const _statedColor = extractColor(latestText);
          if (_statedColor) {
            const _canonColor = _colsHere.find(c => colorMatches(c, _statedColor) || colorMatches(_statedColor, c));
            if (_canonColor) {
              mem.orderColorByCode = mem.orderColorByCode || {};
              const _prevCol = mem.orderColorByCode[_ccol];
              mem.orderColorByCode[_ccol] = String(_canonColor).toLowerCase();
              if (mem.multiColorInterest === _ccol) mem.multiColorInterest = null;   // khách đã CHỐT màu -> hết phân vân
              if (_prevCol !== mem.orderColorByCode[_ccol]) console.log(`[${BOT_NAME}] Khách GÕ chọn màu "${_canonColor}" cho ${_ccol} -> ghi đè màu chốt (trước: ${_prevCol || "-"}).`);
            }
          }
        }
      }
    } catch (_) {}

    // ===== CHẾ ĐỘ HẬU-ĐƠN (đơn đã chốt ở lượt trước, khách nhắn thêm) =====
    // Yêu cầu shop: đơn ĐÃ chốt + đã xác nhận, sau đó khách hỏi thêm ("hàng đẹp như hình ko",
    // "giao sớm nhé", "(y)", "ok e") -> CÓ hỏi thì TRẢ LỜI, nhưng TUYỆT ĐỐI:
    //   - KHÔNG chốt đơn lại / gửi lại câu xác nhận đơn.
    //   - KHÔNG follow-up, KHÔNG kéo ngược về tư vấn / báo giá / hỏi size.
    // CHỈ áp khi lượt này khách KHÔNG đưa MẪU MỚI (không ảnh sản phẩm mới, không tên/mã mẫu mới,
    // không "lấy thêm / đặt thêm") -> trường hợp thêm mẫu vào đơn vẫn giữ luồng GĐ4 riêng bên dưới.
    {
      const _addsNewModel = (fromImages && fromImages.length) || (fromText && fromText.length)
        || /(lấy thêm|đặt thêm|mua thêm|thêm (mẫu|cái|bộ|váy|set|chiếc)|còn mẫu|mẫu khác|cái (kia|nớ|này) nữa|đặt (luôn|thêm) (cả|con|cái))/i.test(latestText || "");
      // ĐÃ CHỐT? KHÔNG chỉ dựa _wasOrderClosed (cờ này bị reset mỗi lượt, hoặc KHÔNG bật khi SHOP chốt TAY).
      // Dùng tín hiệu BỀN: everOrdered, hoặc đã có ÍT NHẤT 1 mã trong orderedByCode (= đơn đã lên).
      const _hasOrderedCode = !!(mem.orderedByCode && Object.keys(mem.orderedByCode).length);
      // + _postOrderThread = shop ĐÃ xác nhận/giao đơn trong LỊCH SỬ (đọc messages -> bắt cả đơn do NGƯỜI THẬT
      //   chốt tay / đã gửi hàng, mà mem cờ everOrdered/orderedByCode KHÔNG bật). Lỗi Giang Dao: đơn đã GỬI,
      //   khách "Ok" -> bot tưởng chốt mới -> hỏi lại size. Có cờ này thì "Ok"/"đã gửi chưa" -> xử hậu-đơn.
      const _isPostOrder = _wasOrderClosed || mem.everOrdered || _hasOrderedCode || mem._postOrderThread;
      if (_isPostOrder && !_addsNewModel && !humanInbox) {
        mem.orderClosed = true; mem.orderState = "DA_CHOT"; mem.everOrdered = true;  // KHÔI PHỤC: đây KHÔNG phải thêm mẫu
        cancelFollowup(conversationId);   // hậu-đơn: tắt mọi follow đang chờ

        // (a) Khách HỎI "hàng đẹp như hình ko / ngoài đời có giống ảnh" -> trấn an nhẹ, KHÔNG chốt/follow.
        if (asksLooksLikePhotos(latestText) || _ai("AUTHENTICITY_QA")) {
          const reply = buildLooksReassure(mem);
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] [HẬU-ĐƠN] khách hỏi đẹp như hình -> trấn an, KHÔNG chốt/follow.`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        // (b) Khách HỎI THỜI GIAN GIAO ("bao giờ nhận", "mấy ngày", "giao sớm nhé") -> trả lời gọn, KHÔNG chốt/follow.
        if (/(mấy ngày|bao lâu|bao nhiêu ngày|mấy hôm|khi nào (nhận|có|giao|tới|về)|ngày nào (nhận|có)|giao (sớm|nhanh|gấp)|ship (mấy|bao|lâu))/i.test(latestText || "")) {
          const reply = "Dạ đơn em đã lên rồi ạ, bên em sẽ đóng gói và gửi đi sớm nhất cho mình, thường 5-7 ngày là chị nhận được tuỳ khu vực nha. Chị thông cảm chờ shipper giúp em ạ.";
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] [HẬU-ĐƠN] khách hỏi thời gian giao -> trả lời gọn, KHÔNG chốt/follow.`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        // (b2) Khách DẶN DÒ về đơn sau khi chốt (gửi chuẩn, gói kỹ, gửi đúng mẫu/size, đừng nhầm...) -> nhãn AI
        //      POST_ORDER_REQUEST. Đáp CAM KẾT trấn an, KHÔNG chốt/follow. (Dùng AI hiểu Ý, không phụ thuộc từ khoá.)
        if (_ai("POST_ORDER_REQUEST")) {
          const _porReplies = [
            "Dạ chị yên tâm, bên em đóng gói kỹ và gửi đúng mẫu ạ. Có gì cần hỗ trợ chị nhắn em nha.",
            "Shop em làm ăn lâu dài nên uy tín đặt lên hàng đầu, chị nhận hàng chắc chắn ưng ý ạ."
          ];
          const reply = _porReplies[Math.floor(Math.random() * _porReplies.length)];
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] [HẬU-ĐƠN] nhãn POST_ORDER_REQUEST (khách dặn dò gửi chuẩn) -> cam kết trấn an, KHÔNG chốt/follow.`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        // (b3) Khách LO LẮNG / E NGẠI sau chốt ("chị chỉ sợ ko đẹp thui", "mua hàng onl giờ sợ lắm",
        //      "lo chất lượng", "sợ ko giống"...). KHÔNG phải khiếu nại gay gắt -> TRẤN AN UY TÍN, KHÔNG chốt/follow.
        //      Bắt qua nhãn AI (FIT_SUITABILITY / COMPLAINT khi chỉ là lo nhẹ) HOẶC cụm lo lắng quen thuộc.
        const _isHardComplaint = /(lừa đảo|lừa|bóc phốt|phốt|trả (hàng|lại)|hoàn (tiền|hàng)|hủy đơn|huỷ đơn|báo công an|report|đánh giá (1 sao|xấu)|tệ thật|quá tệ|thất vọng|bực (mình|thật|quá)|sao (lâu|mãi|giờ vẫn))/i.test(latestText || "");
        if (!_isHardComplaint && (_ai("FIT_SUITABILITY") || _ai("COMPLAINT") || _ai("QUALITY_CONCERN")
            || /(chỉ sợ|sợ (ko|không|kg|hông|hong)|sợ (lắm|quá|thật)|mua (hàng )?(onl|online|trên mạng).{0,12}(sợ|lo|ngại)|lo (lắm|quá|ko đẹp|không đẹp)|(ko|không) (biết )?(có )?(đẹp|giống|ổn) (ko|không|kg)|hồi hộp|hên xui)/i.test(latestText || ""))) {
          const _worryReplies = [
            "Dạ chị yên tâm ạ, mẫu này ngoài đời lên dáng rất đẹp, shop em làm ăn lâu dài nên uy tín đặt lên hàng đầu, chị nhận hàng chắc chắn ưng ý ạ.",
            "Dạ chị đừng lo nha, bên em gửi đúng mẫu - đúng size chị đã chốt, hàng đẹp như hình ạ. Chị nhận hàng kiểm tra thoải mái rồi mới thanh toán nha."
          ];
          const reply = _worryReplies[Math.floor(Math.random() * _worryReplies.length)];
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] [HẬU-ĐƠN] khách LO LẮNG sau chốt (nhãn=${mem._aiIntent || "-"}) -> trấn an uy tín, KHÔNG chốt/follow.`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        // (b4) Khách KHẲNG ĐỊNH ĐÃ MUA/ĐÃ LẤY RỒI ("c lấy rồi mà e", "chị đặt rồi nha", "mua rồi") -> phản hồi
        //      lại câu shop hỏi "lấy thêm ạ?" = ĐÃ ĐẶT RỒI, đừng hỏi nữa. Dùng nhãn AI POST_ORDER_CONFIRMED;
        //      regex đỡ khi AI trượt (AI hay gắn nhầm ADD_TO_ORDER). Xác nhận nhẹ, KHÔNG mời chốt / lên đơn lại.
        if (_ai("POST_ORDER_CONFIRMED")
            || /(lấy|lay|mua|đặt|dat|order|chốt|chot)\s*(rồi|roi|rùi|ròi|xong)|(đã|da)\s*(lấy|mua|đặt|chốt)|(rồi|roi|rùi)\s*(mà|ma)\b|nãy.{0,6}(lấy|mua|đặt)|(lấy|mua|đặt).{0,4}(nãy|lúc nãy)/i.test(latestText || "")) {
          const reply = "Dạ vâng, đơn của chị em đã lên rồi ạ, Có gì cần hỗ trợ chị cứ nhắn em ạ.";
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] [HẬU-ĐƠN] khách khẳng định ĐÃ MUA/LẤY RỒI (nhãn=${mem._aiIntent || "-"}) -> xác nhận nhẹ, KHÔNG mời chốt lại.`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        // (c) Khách chỉ XÃ GIAO / ĐỒNG Ý ("ok e", "(y)", "cảm ơn", thả tim) -> IM (không spam câu chốt/follow).
        const _t = String(latestText || "").trim();
        if (!_t || isBareAck(_t) || isAffirmation(_t) || isFriendlyRemark(_t) || isPostOrderChitChat(_t) || _isBlankPing(_t)) {
          console.log(`[${BOT_NAME}] [HẬU-ĐƠN] khách xã giao/đồng ý sau khi đã chốt -> IM, không làm gì thêm.`);
          updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        // (d) Còn lại (câu hỏi khác hậu-đơn: chính sách, chất liệu, đổi/trả...) -> để chảy xuống handler QA tương ứng,
        //     orderClosed vẫn = true nên các handler đó CHỈ trả lời, KHÔNG kèm CTA chốt (đã có guard !orderClosed sẵn).
      }
    }

    // ===== MẠNG AN TOÀN cho nhãn OTHER: AI KHÔNG tìm được nhãn = câu lạ -> GIAO NGƯỜI THẬT, KHÔNG để code đoán.
    // (theo yêu cầu: code xử OTHER hay sai -> thà nhường người. Vd "mình lấy màu giống ảnh" bị OTHER -> trấn an nhầm.)
    // LOẠI TRỪ: tin rỗng/like/ack/cảm ơn/chitchat (khách thả tim, "ok", "vâng") -> KHÔNG gắn thẻ, để luồng cũ xử êm.
    // GÁC: chỉ chặn khi KHÔNG có tín hiệu tiền/đơn/địa chỉ/sđt/size (mấy ý đó code xử chắc tay, đã phất cờ ở trên).
    {
      const _otherText = String(latestText || "").trim();
      const _isAckLike = !_otherText || isBareAck(_otherText) || isAffirmation(_otherText)
        || isFriendlyRemark(_otherText) || isPostOrderChitChat(_otherText) || _isBlankPing(_otherText);
      const _hasOrderSignal = mem._addrJustGiven || mem.phone || mem.customerSize
        || priceAsk || customerWantsToOrder(latestText, mem.lastIntent)
        || customerGaveContact(latestText);
      // [ĐỠ OTHER] Câu mở đầu có TÊN MẪU cụ thể ("tư vấn thiết kế Giannal màu hồng") nhưng AI lỡ gắn OTHER
      //  -> KHÔNG giao người. Nếu tên khớp catalog thì để chảy xuống luồng báo giá + gửi ảnh (đúng ý shop:
      //  mở đầu không ảnh nhưng có tên mẫu thì PHẢI báo giá + ảnh). Chỉ đỡ khi khách CHỦ ĐỘNG nhắc mẫu bằng chữ.
      let _otherNamesModel = false;
      if (_ai("OTHER") && !_isAckLike && !_hasOrderSignal && _textRefersModel(_otherText)) {
        try { const _h = await findInText(_otherText); if (_h && _h.length) { _otherNamesModel = true;
          console.log(`[ĐỠ OTHER] câu có TÊN MẪU "${_h[0].code}" (${_h[0].name}) -> KHÔNG giao người, chảy xuống báo giá+ảnh.`); } } catch (_) {}
      }
      if (_ai("OTHER") && !_isAckLike && !_hasOrderSignal && !_otherNamesModel && !mem.orderClosed && !humanInbox) {
        try { await tagChoXuLyVaUnread(conversationId); } catch (_) {}
        mem.botHandoffAt = Date.now();
        console.log(`[DISPATCH] AI nhãn=OTHER (không nhận ra ý) -> GIAO NGƯỜI THẬT (im, AI-CHỜ XL). Câu: "${_otherText.slice(0, 40)}"`);
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
    }

    // AI hay nhầm "giá"/"lấy giá" -> DISCOUNT. Chỉ cho nhãn DISCOUNT kích nhánh giảm giá khi câu THỰC SỰ
    // có từ giảm/sale/bớt... -> tránh nuốt câu HỎI GIÁ (vd "Let giá s ak") thành câu "ít khi giảm giá".
    const _aiDiscount = _ai("DISCOUNT") && /giảm|bớt|sale|\bkm\b|khuyến m[ãa]i|ưu đãi|deal|fix giá|rẻ hơn|mềm giá|giá tốt/i.test(String(latestText || "").toLowerCase());
    // (C) NHÃN CẦN NGƯỜI THẬT: AI nhận ra mà từ-khoá có thể trượt -> giao người, KHÔNG tự trả.
    //     Gác: KHÔNG cướp lượt nếu đang rõ ràng là chốt đơn/hỏi giá (để luồng tiền/đơn của code lo).
    // + Code tự bắt ngữ cảnh THANH TOÁN (đã ck / nhận tiền chưa / bên c nhận chưa / báo thành công) -> người thật,
    //   KHÔNG để AI-REPLY tự soạn (vd nhại "hệ thống lỗi"). Việc tiền nong = người thật xác minh.
    const _paymentSentAsk = /đã ck|đã chuyển khoản|chuyển khoản rồi|\bck rồi\b|chuyển tiền rồi|báo thành công|nhận được tiền|nhận tiền chưa|nhận (tiền )?chưa|bên (c|e|chị|shop|mình) nhận (tiền )?chưa/i.test(String(latestText || ""));
    if ((_ai("COMPLAINT") || _ai("PAYMENT_CONFIRM") || _ai("CANCEL_ORDER") || _paymentSentAsk)
        && !priceAsk && !customerWantsToOrder(latestText, mem.lastIntent)
        && !customerGaveContact(latestText)) {
      const _why = _ai("COMPLAINT") ? "khách bức xúc/khiếu nại" : (_ai("PAYMENT_CONFIRM") ? "xác nhận đã chuyển tiền" : (_ai("CANCEL_ORDER") ? "muốn huỷ đơn" : "hỏi/nhắc chuyển khoản-nhận tiền (code bắt)"));
      // [NGUYÊN TẮC] Giao NGƯỜI THẬT (gắn thẻ CHỜ XL) -> CHỈ GẮN THẺ + IM LẶNG, KHÔNG nói gì với khách.
      try { await tagChoXuLyVaUnread(conversationId); } catch (_) {}
      mem.botHandoffAt = Date.now();
      console.log(`[DISPATCH] AI=${mem._aiIntent} (${_why}) + từ-khoá tiền/đơn KHÔNG khớp -> GIAO NGƯỜI THẬT (im lặng, chỉ gắn thẻ).`);
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // (C2) KHẨN / DEADLINE: AI=URGENT, hoặc code bắt MỐC NGÀY cụ thể (mai/T4/trước thứ 5/đi tiệc) khi KHÔNG phải
    //      đang hỏi giá / chốt / cho contact -> ĐƠN ƯU TIÊN, người thật. (AI chỉ phân nhánh; câu trả do code.)
    if (_ai("URGENT")
        || (isUrgentSpecificDate(latestText) && !priceAsk
            && !customerWantsToOrder(latestText, mem.lastIntent) && !customerGaveContact(latestText))) {
      // [NGUYÊN TẮC] Giao NGƯỜI THẬT (gắn thẻ ĐƠN ƯU TIÊN) -> CHỈ GẮN THẺ + IM LẶNG, KHÔNG nói gì với khách.
      try { await tagDonUuTienVaUnread(conversationId); } catch (_) {}
      mem.botHandoffAt = Date.now();
      console.log(`[DISPATCH] URGENT (deadline/gấp - ${_ai("URGENT") ? "AI" : "code mốc ngày"}) -> ĐƠN ƯU TIÊN, người thật (im lặng, chỉ gắn thẻ).`);
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }
    // để MỌI lần gửi ảnh lượt này (kể cả luồng báo giá/AI) đều ưu tiên ĐÚNG màu đó.
    // (Trước đây chỉ nhớ khi khách XIN ẢNH -> câu "tư vấn ... màu Hồng" bị bỏ màu. Nay nhắc màu là nhớ.)
    {
      const _reqC = extractColor(latestText);
      mem.askedImageColor = _reqC || null;
      // Cờ khách XIN ĐỦ MÀU lượt này -> maybeSendImages mới được bung đủ màu. Mặc định false (gửi màu bìa).
      mem._wantAllColors = wantsAllColorsImages(latestText) || wantsAllColorsLoose(latestText);
    }

    console.log(`Khách gửi ${imageCount} ảnh | nhận diện ${fromImages.length} từ ảnh${_imgColor ? ` (màu: ${_imgColor})` : ""}, ${fromText.length} từ chữ | trượt ${unresolved}`);
    if (thisTurn.length) console.log("MẪU:", thisTurn.map(p => `${p.name || "?"}(${p.code})=${p.price}`).join(" | "));

    // ===== KHÁCH ĐỒNG Ý NHẬN HÀNG + THANH TOÁN (COD) -> đơn đã có, CHỈ CẢM ƠN, TUYỆT ĐỐI KHÔNG báo giá =====
    // (Ngọc Huyền: đơn đã chốt sẵn, khách "Mình nhận hàng thanh toán nha shop" + ảnh -> bot báo giá Miretta.
    //  Câu này KHÔNG BAO GIỜ là tin tư vấn mẫu mới -> chặn NGAY, trước cả khâu nhận ảnh/báo giá.)
    if (confirmsCodReceipt(latestText)) {
      const reply = "Dạ vâng ạ, em cảm ơn chị nhiều. Đơn em đã lên rồi, chị nhận hàng và thanh toán giúp em khi shipper giao nha. Có gì cần hỗ trợ chị cứ nhắn em ạ.";
      await sendInboxMessage(conversationId, reply);
      mem.orderClosed = true; mem.orderState = "DA_CHOT"; mem.everOrdered = true;
      console.log(`[${BOT_NAME}] Khách ĐỒNG Ý nhận hàng + thanh toán (COD) -> cảm ơn, KHÔNG báo giá.`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== STATE GUARD: ĐƠN ĐÃ CHỐT + lượt này KHÔNG đưa mẫu mới + tin MƠ HỒ (AI=OTHER) -> hậu mãi đơn cũ =====
    // Khách đã chốt đơn, giờ nhắn 1 câu mơ hồ ("ui e ơi", "alo", "đó") mà KHÔNG đưa ảnh/tên mẫu mới
    // -> KHÔNG vớ mẫu từ ad/CLIP để báo giá lại; nhường người thật. (Đưa mẫu mới / nhãn rõ -> giữ handler riêng.)
    if (mem.orderClosed && _ai("OTHER")
        && !fromImages.length && !fromText.length
        && !customerGaveContact(latestText) && !priceAsk) {
      await tagChoXuLyVaUnread(conversationId);
      mem.botHandoffAt = Date.now();
      console.log(`[${BOT_NAME}] ĐƠN ĐÃ CHỐT + tin mơ hồ + không mẫu mới -> hậu mãi đơn cũ, nhường người thật. Conv: ${conversationId}`);
      mem.lastBotReply = HUMAN_CHECK_REPLY; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }
    // OCR ảnh hay đọc RÁC (ảnh giày dép/card SP -> "Mã/Giá/màu" thành địa chỉ) -> chốt bậy. Theo yêu cầu shop:
    // ảnh địa chỉ thì NGƯỜI THẬT kiểm tra, bot KHÔNG tự nhận diện điền vào đơn.
    const _recentShop = (data.messages || []).filter(m => m && m.sender === "shop" && m.type === "text")
      .slice(-5).map(m => String(m.text || "")).join(" ");
    const _botAskedAddr = /địa chỉ|dia chi|đ\/c\b/i.test(_recentShop) || /địa chỉ|dia chi|đ\/c\b/i.test(String(mem.lastBotReply || ""));
    if (imageCount > 0 && _botAskedAddr && !addrReady(mem) && thisTurn.length === 0) {
      if (mem.address && isGarbageAddress(mem.address)) mem.address = null;   // xoá rác OCR tồn đọng
      const reply = "Dạ em nhận được ảnh của chị rồi ạ. Để tránh sai sót khi giao, chị nhắn giúp em địa chỉ bằng tin nhắn chữ (số nhà - phường/xã - tỉnh/thành) nha, hoặc chờ em kiểm tra lại giúp mình ạ.";
      await sendInboxMessage(conversationId, reply);
      await tagChoXuLyVaUnread(conversationId); mem.botHandoffAt = Date.now();
      console.log(`[${BOT_NAME}] Khách gửi ĐỊA CHỈ bằng ẢNH -> KHÔNG tự OCR điền, GẮN NGƯỜI THẬT + xin địa chỉ bằng chữ.`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // KHÓA mẫu theo BÀI POST cho hội thoại từ comment: khách không nêu mẫu mới ở lượt này
    // thì luôn bám đúng mẫu của bài (chống lẫn mẫu kiểu Celyra -> Corine).
    if (isCommentOrigin && thisTurn.length === 0 && mem.commentPostProduct) {
      mem.currentProduct = mem.commentPostProduct;
      if (!mem.quotedProducts || !mem.quotedProducts.length) mem.quotedProducts = [mem.commentPostProduct];
    }

    // Khách gửi ảnh MỚI nhưng không nhận ra -> báo chờ, không lôi mẫu cũ
    if (thisTurn.length === 0 && imageCount > 0) {
      // KHÔNG xử lý được (ảnh không nhận ra) -> CHỈ gắn AI-CHỜ XL (183) + IM, để người thật trả lời.
      // (KHÔNG gắn AI-XL ảnh: thẻ 184 chỉ dành cho ca tin TỪ COMMENT mà bot KHÔNG GỬI ĐƯỢC ảnh.)
      await tagChoXuLyVaUnread(conversationId);
      console.log(`Ảnh mới không nhận ra -> gắn thẻ AI-CHỜ XL + chưa đọc (IM, để người thật xử lý)`);
      mem.lastBotReply = "[unrecognized]";
      mem.botHandoffAt = Date.now();
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // Khách gửi NHIỀU ảnh, CHỈ nhận ra 1 mẫu (còn mẫu CHƯA nhận ra) -> BÁO GIÁ mẫu nhận ra trước,
    // SAU ĐÓ gắn AI-CHỜ XL cho mã còn lại (người thật bổ sung). KHÔNG bỏ hết.
    // TRỪ: khách hỏi "người mẫu mặc size gì/cao nặng" (MODEL_REFERENCE) -> nhường handler model-size trả đúng,
    //      KHÔNG báo giá nuốt câu hỏi (ca Thanh Duy: hỏi "mẫu shop đang mặc sz gì" mà bị báo giá).
    if (imageCount >= 2 && unresolved > 0 && thisTurn.length === 1
        && !asksModelSize(latestText) && !_ai("MODEL_REFERENCE")) {
      // (TDZ FIX) tại đây `productInfo` CHƯA khai báo (mãi dòng ~5013) -> đọc nó gây crash
      // "Cannot access 'productInfo' before initialization" -> rớt hẳn hội thoại. Mẫu vừa nhận ra = thisTurn[0].
      const _pi = thisTurn[0];
      const k = String((_pi && _pi.code) || "").toUpperCase();
      const pl = _pi && priceLine(_pi);
      if (pl) {
        // TÁCH 2 TIN: câu BÁO GIÁ riêng (chắc chắn tới khách) — KHÔNG ghép cụm "kiểm tra...rồi báo"
        //  vào cùng tin, vì isWaitHandoffMsg sẽ tóm cả tin -> nuốt mất phần báo giá (ca Thanh Duy: khách
        //  chỉ nhận ảnh, KHÔNG nhận báo giá rồi bị ngắt). Báo giá XONG mã nhận ra -> mới gắn thẻ mã còn lại.
        const _quote = openerOrLead(_pi, mem);
        await sendInboxMessage(conversationId, _quote);          // BÁO GIÁ mẫu đã nhận ra -> CHẮC CHẮN gửi
        markPriced(mem, k);
        await maybeSendImages(conversationId, k, mem, true);     // gửi ảnh mẫu ĐÃ nhận ra
        try { await _sendInboxMessage(conversationId, "Còn mẫu kia em kiểm tra lại thông tin rồi báo chị ngay nha."); } catch (_) {}  // raw -> báo cho khách biết, không bị lọc báo-chờ
        await tagChoXuLyVaUnread(conversationId);                // mã CÒN LẠI chưa nhận ra -> AI-CHỜ XL cho người thật (SAU khi đã báo giá xong)
        mem.botHandoffAt = Date.now();
        console.log(`Gửi ${imageCount} ảnh, nhận ra ${fromImages.length} -> BÁO GIÁ XONG mẫu ${k} + AI-CHỜ XL cho ${unresolved} mã chưa nhận ra.`);
        mem.lastBotReply = _quote; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // Giá mẫu nhận ra cũng lỗi -> chờ kiểm tra + tag (như cũ).
      const reply = "Dạ mẫu này em kiểm tra lại thông tin rồi báo mình ạ, chị chờ em 1 lát nhe";
      await sendInboxMessage(conversationId, reply);
      await tagChoXuLyVaUnread(conversationId);
      mem.botHandoffAt = Date.now();
      console.log(`Gửi ${imageCount} ảnh, nhận ra ${fromImages.length} nhưng GIÁ lỗi -> chờ + AI-CHỜ XL.`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== [GĐ4] GỘP MẪU VÀO ĐƠN ĐÃ CHỐT =====
    // Đơn ĐÃ chốt + đủ sđt/địa chỉ + khách "lấy thêm"/thêm mẫu -> APPEND mẫu mới (KHÔNG ghi đè cụm cũ),
    // xác nhận lại ĐƠN TỔNG về ĐỊA CHỈ CŨ. TUYỆT ĐỐI không đòi lại địa chỉ, không tư vấn lại từ đầu.
    {
      const _addIntent = /lấy thêm|lên đơn thêm|đặt thêm|thêm mẫu|mẫu này nữa|thêm \d+ mẫu|lấy luôn cả/i.test(latestText)
        || routeBatch(batch.filter(x => x.type === "text").map(x => x.text || "")).some(r => r.intent === "THEM_MAU_VAO_DON")
        || _ai("ADD_TO_ORDER");
      // GỬI ẢNH MẪU ≠ ĐỒNG Ý CHỐT. Khách từng chốt 1 đơn, lần sau gửi ảnh mẫu khác có thể chỉ ĐANG XEM/HỎI.
      // -> TUYỆT ĐỐI không tự nhét mẫu vào đơn cũ. Chỉ thêm vào đơn khi khách NÓI RÕ ("lấy thêm/chốt thêm" = _addIntent).
      // Mẫu mới gửi tới -> để luồng dưới BÁO GIÁ (§13/sendBlocks), KHÔNG auto-chốt.
      const _hadClosedOrder = _wasOrderClosed && mem.phone && mem.address && (mem.quotedProducts || []).length >= 1;
      if (_hadClosedOrder && _addIntent) {
        mem.orderState = "DANG_THEM_MAU";
        if (!thisTurn.length) {
          const reply = "Dạ chị muốn lấy thêm mẫu nào ạ, chị gửi em ảnh hoặc tên mẫu để em thêm vào đơn cho mình nha";
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] [GĐ4] Khách muốn thêm mẫu nhưng chưa rõ mẫu -> hỏi mẫu nào (giữ đơn cũ, không đòi địa chỉ).`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        mem.quotedProducts = dedupByCode([...(mem.quotedProducts || []), ...thisTurn]);   // APPEND, giữ mẫu đã chốt
        mem.orderLines = null; mem.orderLinesCode = null;   // thêm mẫu mới -> tính tổng theo cụm (gồm mẫu mới), bỏ cấu trúc dòng cũ
        const _pi = mem.quotedProducts[0];
        const _tot = computeOrderTotal(mem, _pi);
        const _sizeOk = !orderNeedsSize(mem, _pi) || mem.customerSize;
        if (mem.address && isGarbageAddress(mem.address)) { mem.address = null; }
        if (_tot.known && _sizeOk && addrReady(mem)) {
          mem.orderClosed = false;
          const reply = await sendOrderClose(conversationId, mem, _pi);   // gửi tin "đang tạo" + ảnh -> câu cảm ơn (ĐƠN TỔNG, sđt/địa chỉ CŨ)
          await tagAiChot(conversationId);
          mem.orderClosed = true; mem.orderState = "DA_CHOT"; mem.everOrdered = true;
          console.log(`[${BOT_NAME}] [GĐ4] Thêm ${thisTurn.length} mẫu vào đơn đã chốt -> XÁC NHẬN ĐƠN TỔNG (${mem.quotedProducts.length} mẫu), GIỮ địa chỉ cũ.`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        // ĐỊA CHỈ cũ KHÔNG hợp lệ (rỗng/rác/thiếu) mà đủ giá+size -> xin LẠI địa chỉ, không chốt bừa.
        if (_tot.known && _sizeOk && !addrReady(mem)) {
          const reply = "Dạ chị cho em xin lại địa chỉ nhận hàng (số nhà, đường, phường/xã) để em chốt đơn tổng cho mình nha ạ";
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] [GĐ4] Thêm mẫu nhưng ĐỊA CHỈ cũ KHÔNG hợp lệ -> xin lại địa chỉ.`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        // thiếu giá/size mẫu mới -> xin nốt đúng phần thiếu, TUYỆT ĐỐI không đòi địa chỉ
        if (!_tot.known) {
          const reply = "Dạ chị chờ em kiểm tra thông tin mẫu mới rồi chốt đơn tổng cho mình nha";
          await sendInboxMessage(conversationId, reply);
          await tagChoXuLyVaUnread(conversationId); mem.botHandoffAt = Date.now();
          console.log(`[${BOT_NAME}] [GĐ4] Thêm mẫu nhưng thiếu GIÁ mẫu mới -> CHỜ XL, KHÔNG đòi địa chỉ.`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        const reply = "Dạ em thêm mẫu vào đơn cho chị rồi ạ, chị cho em xin size mẫu mới để em chốt đơn tổng nha";
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] [GĐ4] Thêm mẫu -> thiếu SIZE mẫu mới, xin nốt, KHÔNG đòi địa chỉ.`);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
    }

    // ===== KHÁCH MUỐN XEM MẪU ĐANG GIẢM GIÁ (cột K>0) -> mời + gửi ảnh từng mẫu (2 ảnh/mẫu, ALBUM; lỗi -> gửi lẻ) =====
    if (asksShowSaleItems(latestText) && !_nhanCamRegex(mem, "asksShowSaleItems", ["DISCOUNT"])) {
      try {
        const _cat = await ensureCatalog();
        let _sale = (_cat.list || []).filter(p => p && isOnSale(p) && recommend.sellable(p));
        if (_sale.length) {
          // xáo trộn cho đỡ lặp thứ tự, giới hạn số mẫu gửi (tránh spam)
          for (let i = _sale.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [_sale[i], _sale[j]] = [_sale[j], _sale[i]]; }
          const _pick = _sale.slice(0, 8);
          await sendInboxMessage(conversationId, "Dạ hiện tại bên em có các mẫu này đang được giảm giá đó ạ, vì giảm sâu nên số lượng mẫu cũng không còn nhiều, chị lựa sớm gửi lại em tư vấn nhe ạ");
          let _sent = 0;
          for (const p of _pick) {
            const C = String(p.code || "").toUpperCase();
            let imgs = [];
            try { imgs = (imageItemsByColor(C, null, 2, true) || []).slice(0, 2); } catch (_) {}
            if (!imgs.length) continue;
            try {
              // sendImages3: gửi ALBUM 2 ảnh 1 phát; ảnh lỗi -> tự gửi LẺ (dự phòng) trong hàm.
              const r = await sendImages3(conversationId, imgs);
              if (r && (r.ok || r.n > 0)) _sent++;
            } catch (e) { try { console.log(`[sale] gửi ảnh lỗi ${C}: ${e.message}`); } catch (_) {} }
          }
          console.log(`[${BOT_NAME}] Khách xin xem MẪU GIẢM GIÁ (cột K>0) -> đã gửi ${_sent}/${_pick.length} mẫu (2 ảnh/mẫu, album).`);
          mem.lastBotReply = "[mẫu giảm giá]";
          updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        console.log(`[${BOT_NAME}] Khách xin mẫu giảm giá nhưng KHÔNG có mẫu nào cột K>0 còn hàng -> để luồng khác xử lý.`);
      } catch (e) { try { console.log("[sale] lỗi:", e.message); } catch (_) {} }
    }

    // (productInfo/quotedProducts đã khai báo SỚM phía trên — trước điểm AI-QUYẾT)

    if (thisTurn.length > 1) {
      // ===== KHÁCH NÊU NHIỀU MẪU TRONG 1 LƯỢT (nhiều ảnh / nhiều tên) -> tư vấn cả cụm =====
      // Đây là ý định rõ ràng muốn xem nhiều mẫu, KHÔNG coi là trôi mã.
      quotedProducts = thisTurn;
      mem.quotedProducts = thisTurn;
      productInfo = thisTurn[0];
      mem.currentProduct = thisTurn[0];
      mem.upsellAsked = false;   // ĐỢT xem mẫu MỚI -> cho phép hỏi vớt lại 1 lần
      console.log(`FOCUS: multi (${thisTurn.length} mẫu) -> [${thisTurn.map(p => p.code).join(", ")}]`);
    } else {
      // ===== SINGLE FOCUS: dùng cơ chế KHÓA MẪU (chống nhảy mã loạn xạ) =====
      const priorCluster = (mem.quotedProducts || []).slice();   // cụm mẫu TRƯỚC khi xử lý lượt này
      const focus = decideFocus(mem, { fromImages, fromText, latestText });
      console.log(`FOCUS: ${focus.reason} | lock=${(mem.currentProduct && mem.currentProduct.code) || "-"} -> ${(focus.product && focus.product.code) || "-"} | switch=${!!focus.switched}`);

      if (focus.product) {
        productInfo = focus.product;
        mem.currentProduct = focus.product;
        if (focus.switched) {
          // Đổi mẫu THẬT (vision ra mã khác, hoặc khách gõ tên/mã).
          const fc = _codeUp(focus.product);
          const cur = mem.quotedProducts || [];
          if (cur.some(p => _codeUp(p) === fc)) {
            if (cur.length > 1 && !wantsAllModels(latestText)) {
              // Khách QUAN TÂM SÂU 1 mẫu trong cụm (hỏi chất/giá/size mẫu đó) -> CO cụm về mẫu đó.
              // Các mẫu còn lại đẩy sang sessionProducts để HỎI VỚT khi khách chốt.
              rememberSessionProducts(mem, cur);
              quotedProducts = [focus.product];
              mem.quotedProducts = [focus.product];
              mem.upsellAsked = false;   // mẫu focus mới -> cho phép hỏi vớt 1 lần
              console.log(`FOCUS narrow (hỏi sâu): cụm ${cur.length} mẫu -> 1 (${fc}), ${cur.length - 1} mẫu để vớt.`);
            } else {
              // "lấy cả/hết" hoặc cụm chỉ 1 mẫu -> giữ nguyên cụm.
              quotedProducts = cur;
              mem.quotedProducts = cur;
            }
          } else {
            // Mẫu hoàn toàn mới -> chuyển focus + cụm sang mẫu mới.
            quotedProducts = [focus.product];
            mem.quotedProducts = [focus.product];
          }
        } else {
          // GIỮ mẫu khóa -> TUYỆT ĐỐI KHÔNG co danh sách quote lại.
          // (Giữ nguyên cụm nhiều mẫu đã báo để khi khách "chốt hết" còn lên đủ đơn.)
          if (!mem.quotedProducts || !mem.quotedProducts.length) mem.quotedProducts = [focus.product];
          quotedProducts = mem.quotedProducts;
        }
      }

      // ===== NARROW: trong CỤM nhiều mẫu, khách CHỐT/LẤY ĐÍCH DANH 1 mẫu (vd "lấy Mironne") =====
      // -> co cụm về ĐÚNG mẫu đó để lên đơn 1 mẫu. 2 mẫu kia vẫn nằm ở sessionProducts ->
      //    handler "vớt đơn" (CA 3) sẽ hỏi "có lấy luôn mẫu kia không". KHÔNG áp dụng cho câu hỏi.
      const pickedOne = (thisTurn.length === 1) ? thisTurn[0] : null;
      if (pickedOne
          && priorCluster.length > 1
          && priorCluster.some(p => _codeUp(p) === _codeUp(pickedOne))
          && customerWantsToOrder(latestText, mem.lastIntent)
          && !looksLikeQuestion(latestText)
          && !isQualityHesitation(latestText)) {
        productInfo = pickedOne;
        mem.currentProduct = pickedOne;
        quotedProducts = [pickedOne];
        mem.quotedProducts = [pickedOne];
        console.log(`FOCUS narrow: khách chốt đích danh ${pickedOne.code} -> co cụm ${priorCluster.length} mẫu về 1 (mẫu còn lại để vớt đơn).`);
      }
    }

    // ===== [AI-QUYẾT referent] AI đọc hội thoại quyết KHÁCH ĐANG NÓI MẪU NÀO =====
    // log_so_sanh: chỉ in "AI chọn X | luật cũ chọn Y" để đối chiếu (shadow).
    // bat_referent: AI đủ tự tin + mã CÓ TRONG CATALOG -> đè focus luật cũ.
    {
      const _rqCfg = aiQuyetCfg();
      const _rq = mem._aiQ;
      if (_rq && _rq.ok && _rq.referent && _rq.referent !== "UNKNOWN") {
        const _oldCode = _codeUp(productInfo) || "-";
        if (_rq.referent !== _oldCode) {
          console.log(`[AI-QUYẾT so sánh] referent: AI=${_rq.referent}(${_rq.do_tin_cay}) | luật cũ=${_oldCode}`);
        }
        if (_rqCfg.bat_referent && _rq.do_tin_cay >= _rqCfg.nguong && _rq.referent !== _oldCode && !mem.orderClosed) {
          // [ĐAI AN TOÀN đa mẫu - ca Tuệ Oanh] Lượt có >=2 mẫu DO CHÍNH KHÁCH GỬI LƯỢT NÀY (>=2 ảnh / gõ >=2
          // tên mẫu): schema AI chỉ trả 1 referent nên nó buộc phải "chọn 1 trong 2" -> đè là phá luật multi.
          // [SỬA ca Móm Yêu 2026-07-11] CHỈ tính đa-mẫu của CHÍNH LƯỢT NÀY — cụm nhiều mẫu TỒN DƯ trong bộ
          // nhớ (khách hỏi từ trước, đã là chuyện cũ) KHÔNG được trói AI: khách trả số đo cho mạch Giannal
          // mà đai tính cụm Nayeli/Elegance/Silhouette cũ là "đa mẫu" -> chặn oan AI đang ĐÚNG -> luật multi
          // xả 8 câu cho cụm cũ.
          const _rqMulti = ((fromImages || []).length >= 2) || ((fromText || []).length >= 2);
          if (_rqMulti) {
            console.log(`[AI-QUYẾT referent] LƯỢT ĐA MẪU (${(fromImages || []).length} ảnh) -> giữ luật multi, AI không đè.`);
          } else try {
            const _cR = await ensureCatalog();
            const _pR = _cR.byCode.get(_rq.referent);   // RÀO: mã phải có thật trong catalog
            if (_pR) {
              productInfo = _pR; mem.currentProduct = _pR;
              quotedProducts = [_pR]; mem.quotedProducts = [_pR];
              console.log(`[AI-QUYẾT referent] ĐÈ focus: ${_oldCode} -> ${_rq.referent} (tin cậy ${_rq.do_tin_cay}).`);
            } else {
              console.log(`[AI-QUYẾT referent] BỎ: mã ${_rq.referent} KHÔNG có trong catalog -> giữ luật cũ (${_oldCode}).`);
            }
          } catch (_) {}
        }
      }
    }

    // ===== "Bắt đầu"/"ib"/chào mở đầu MÀ mẫu đang khoá là mẫu CŨ (đã báo giá >24h trước) =====
    //       -> coi như khách MỚI: BỎ mẫu cũ, KHÔNG lôi ra báo giá lại; mở lại gallery để gửi MẪU MỚI.
    //       Biết mẫu cũ bằng mem.pricedAt[code] (lúc markPriced lưu Date.now()): nếu >24h trước = cũ.
    {
      const _openerNow = /^(bắt đầu|bat dau|get started|started|menu|ib|inbox|\/?start)\b/i.test(String(latestText || "").trim())
        || isGreetingPing(latestText) || isOpenerPing(latestText);
      // mẫu CHỈ đến từ lịch sử/khoá (không phải khách nêu mẫu MỚI trong tin này: không ảnh, không tên mẫu)
      const _noNewModelThisTurn = thisTurn.length === 0 && imageCount === 0;
      if (_openerNow && _noNewModelThisTurn && productInfo) {
        const _pc = _codeUp(productInfo);
        const _pAt = (mem.pricedAt && mem.pricedAt[_pc]) || 0;
        // Tín hiệu CŨ (1): đã báo giá mẫu này >24h trước.
        const _pricedStale = _pAt > 0 && (Date.now() - _pAt > 24 * 3600 * 1000);
        // Tín hiệu CŨ (2): KHOẢNG CÁCH thời gian — tin "Bắt đầu" cách lần hoạt động trước >24h
        //   (mẫu đọc từ tin shop CŨ, không có pricedAt -> vẫn bắt được khách quay lại sau lâu).
        let _gapStale = false;
        try {
          const _ts = (data.messages || []).map(m => parseTime(m && m.inserted_at)).filter(t => t > 0).sort((a, b) => a - b);
          if (_ts.length >= 2) {
            const _last = _ts[_ts.length - 1];
            let _prev = 0;
            for (let i = _ts.length - 2; i >= 0; i--) { if (_last - _ts[i] > 10 * 60 * 1000) { _prev = _ts[i]; break; } }  // bỏ tin cùng phiên (<10p)
            if (_prev > 0 && (_last - _prev > 24 * 3600 * 1000)) _gapStale = true;
          }
        } catch (_) {}
        const _stale = _pricedStale || _gapStale;
        if (_stale) {
          console.log(`[${BOT_NAME}] "Mở đầu" + mẫu khoá ${_pc} đã CŨ (pricedStale=${_pricedStale} gapStale=${_gapStale}) -> coi như khách MỚI: BỎ mẫu cũ, gửi gallery mẫu mới.`);
          productInfo = null;
          mem.currentProduct = null;
          mem.commentPostProduct = null;
          mem.quotedProducts = [];
          quotedProducts = [];
          mem.newGallerySent = false;   // cho phép gửi lại gallery mẫu mới cho khách quay lại sau >24h
        }
      }
    }

    if (_turnCtx) _turnCtx.productInfo = productInfo;   // cho sendInboxMessage chọn câu follow-up đúng mẫu
    // ≥2 CÂU HỎI THUỘC TÍNH trong 1 lượt (chất liệu / co giãn / lót / set-liền) -> để AI GỘP trả ĐỦ ý
    // (mượt + không bỏ sót), thay vì handler đơn lẻ trả 1 ý rồi return. Chỉ khi AI_REPLY_MODE=on.
    const _attrQ = [
      asksMaterial(latestText) && !priceAsk,
      asksStretch(latestText),
      asksFabricFeel(latestText),
      asksInnerLining(latestText),
      asksBreastPad(latestText),
      asksSkirtOrSet(latestText),
      worriesGarmentShort(latestText),
    ].filter(Boolean).length;
    const _multiAttrQ = _attrQ >= 2 && !!productInfo
      && (process.env.AI_REPLY_MODE || "off").toLowerCase() === "on"
      && !priceAsk && !isAngryOrSensitive(latestText) && !isSensitiveHandoff(latestText)
      && !saysBotMistake(latestText) && !asksShopComparison(latestText);
    if (_multiAttrQ) console.log(`[${BOT_NAME}] LƯỢT có ${_attrQ} câu hỏi thuộc tính -> để AI gộp trả ĐỦ ý (chặn handler đơn lẻ).`);
    // Ghi nhớ mẫu trong phiên (để vớt đơn): mẫu lượt này + mẫu focus hiện tại.
    rememberSessionProducts(mem, thisTurn.length ? thisTurn : (productInfo ? [productInfo] : []));

    // ===== KHÁCH PHẢN ÁNH BÁO GIÁ CHƯA ĐỦ MẪU ("còn mẫu còn lại đã đủ đâu", "báo giá chưa đủ mẫu") =====
    // -> KHÔNG đoán mò/đẩy đơn 1 mẫu. Để NGƯỜI THẬT bổ sung giá các mẫu còn lại (AI-CHỜ XL). Ưu tiên cao, chặn trước mọi nhánh chốt/AI.
    if (complainsMissingModel(latestText)) {
      const reply = "Dạ chị chờ em kiểm tra lại và báo đủ giá các mẫu còn lại cho mình nha ạ";
      await sendInboxMessage(conversationId, reply);
      await tagChoXuLyVaUnread(conversationId);
      mem.botHandoffAt = Date.now();
      cancelFollowup(conversationId);
      console.log(`[${BOT_NAME}] Khách phản ánh CHƯA ĐỦ MẪU/báo giá thiếu -> AI-CHỜ XL (người thật bổ sung), KHÔNG đoán.`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH GỬI SĐT SAI ĐỘ DÀI (không đủ 10 số) -> HỎI LẠI số chuẩn, KHÔNG lưu/không chốt =====
    if (mem.phoneInvalid) {
      const n = mem.phoneInvalid;
      const reply = `Dạ em thấy sđt chị gửi có ${n} số, chị gửi lại giúp em số điện thoại chuẩn với ạ`;
      await sendInboxMessage(conversationId, reply);
      mem.phoneInvalid = null;   // đã hỏi -> xoá cờ (tránh lặp)
      console.log(`[${BOT_NAME}] SĐT khách gửi ${n} số (không đủ 10) -> hỏi lại số chuẩn.`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH BÁO SẼ GỬI ĐỊA CHỈ SAU (AI: SEND_ADDRESS_LATER) -> ghi nhận, CHỜ, KHÔNG giục, KHÔNG đẩy size/màu =====
    if (_ai("SEND_ADDRESS_LATER") && !looksLikeQuestion(latestText)) {
      // Phân biệt 2 ca:
      //  (A) ĐỔI địa chỉ: khách báo KHÔNG còn ở chỗ cũ / muốn GỬI VỀ ĐỊA CHỈ MỚI (chưa đưa địa chỉ) -> XIN địa chỉ mới luôn.
      //  (B) HẸN GỬI SAU: khách bảo lát/tí sẽ gửi địa chỉ -> ghi nhận chờ + nhắc nhẹ nhanh hết hàng.
      const _lt = String(latestText || "").toLowerCase();
      const _changeAddr = /(kh[oô]ng|kh[oô]ng còn|ko|k)\s*(ở|o)\s*(đó|đo|đấy|day|chỗ (cũ|đó)|nhà cũ)\s*(nữa|nua)?|chuyển (nhà|chỗ|qua|sang)|(gửi|giao|ship)\s*(về|ve|qua|sang|đến|den|tới|toi)?\s*(địa chỉ|đc|chỗ)?\s*mới|đổi (địa chỉ|đc|chỗ)|địa chỉ mới/i.test(_lt);
      const reply = _changeAddr
        ? "Dạ vâng chị nhắn em xin địa chỉ mới ạ"
        : "Dạ vâng có địa chỉ chị gửi em sớm nhe ạ, mẫu này bên em cũng nhanh hết hàng.";
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách báo ${_changeAddr ? "ĐỔI địa chỉ -> xin địa chỉ mới" : "SẼ GỬI ĐỊA CHỈ SAU -> ghi nhận chờ"} (AI).`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== NHÓM NHÃN HẬU MÃI / KỸ THUẬT -> GẮN NGƯỜI THẬT (bot dễ sai, đụng đơn/tiền) =====
    // EDIT_ORDER, EXCHANGE_REQUEST, DEFECT_REPORT, REFUND_REQUEST, CK_PROOF, REFUSE_DELIVERY,
    // DELIVERY_PREFERENCE, PRODUCT_DETAIL_QA, STYLING_QA, STORE_STOCK
    {
      const _HANDOFF_KINDS = ["EDIT_ORDER","EXCHANGE_REQUEST","DEFECT_REPORT","REFUND_REQUEST","CK_PROOF","REFUSE_DELIVERY","DELIVERY_PREFERENCE","PRODUCT_DETAIL_QA","STYLING_QA","STORE_STOCK","WHOLESALE"];
      // [FIX Thuthanh Pham] PRODUCT_DETAIL_QA mà là CÂU HỎI THUỘC TÍNH TRẢ LỜI ĐƯỢC -> KHÔNG nhảy vào nhánh
      //   báo-giá/đẩy-người ở đây; để chảy xuống handler thuộc tính trả lời ĐÚNG câu khách.
      //   TÍN HIỆU CHÍNH = concern do AI gắn (lot/dem/cogian/chat/mong/ngan). Regex chỉ là LƯỚI ĐỠ khi AI trượt
      //   (ca Thuthanh: AI lỡ trả concern=- cho "Có quần luôn... phải mặc thêm" -> regex đỡ; prompt đã bổ sung
      //   để lần sau AI tự gắn concern="lot").
      const _attrConcern = ["lot", "dem", "cogian", "chat", "mong", "ngan"].includes(mem._aiConcern || "");
      const _answerableAttrQA = _attrConcern
        || asksInnerLining(latestText) || asksBreastPad(latestText) || asksStretch(latestText);
      if (_HANDOFF_KINDS.includes(mem._aiIntent)
          && !(mem._aiIntent === "PRODUCT_DETAIL_QA" && productInfo && _answerableAttrQA)) {
        // STYLING_QA / PRODUCT_DETAIL_QA: nếu khách đang quan tâm 1 mẫu mà mẫu đó CHƯA báo giá
        // -> ƯU TIÊN báo giá + ảnh trước (đúng nguyên tắc "quan tâm mẫu -> báo giá trước"), KHÔNG đẩy người thật vội.
        // (vd "Tư vấn cho chị mẫu Camellia" = khách mới hỏi mẫu, cần báo giá; KHÔNG phải hỏi phối đồ sâu.)
        if ((mem._aiIntent === "STYLING_QA" || mem._aiIntent === "PRODUCT_DETAIL_QA") && productInfo) {
          const _sc = _codeUp(productInfo);
          if (_sc && !quotedRecently(mem, _sc) && !(mem.orderedByCode && mem.orderedByCode[_sc]) && priceLine(productInfo)) {
            const _opener = buildCommentOpener(productInfo, mem);
            await sendInboxMessage(conversationId, _opener);
            markPriced(mem, _sc);
            if (!mem.quotedProducts) mem.quotedProducts = [];
            if (!mem.quotedProducts.some(x => String(x.code || "").toUpperCase() === _sc)) mem.quotedProducts.push(productInfo);
            mem._imgAllowSend = true;   // báo giá lần đầu -> ĐƯỢC gửi ảnh (kể cả khi ad đã hiện ảnh trong hội thoại)
            try { await maybeSendImages(conversationId, productInfo.code, mem, true); } catch (_) {}
            console.log(`[${BOT_NAME}] Nhãn ${mem._aiIntent} + mẫu CHƯA báo giá -> BÁO GIÁ + ảnh (${_sc}) thay vì gắn người thật.`);
            mem.lastBotReply = _opener; updateConversationState(conversationId, mem); markProcessed(batch); return true;
          }
        }
        // 1 câu trấn an ngắn cho ca hậu mãi cần xử lý đơn; nhãn kỹ thuật/hỏi-hàng thì im, chỉ gắn thẻ.
        const _needAck = ["EDIT_ORDER","EXCHANGE_REQUEST","DEFECT_REPORT","REFUND_REQUEST","CK_PROOF"].includes(mem._aiIntent);
        if (_needAck) {
          const reply = "Dạ em ghi nhận rồi ạ, chị chờ em kiểm tra lại và hỗ trợ mình ngay nha ạ";
          await sendInboxMessage(conversationId, reply);
          mem.lastBotReply = reply;
        }
        try { await tagChoXuLyVaUnread(conversationId); } catch (_) {}
        mem.botHandoffAt = Date.now();
        console.log(`[${BOT_NAME}] Nhãn ${mem._aiIntent} -> GẮN NGƯỜI THẬT (${_needAck ? "ack ngắn" : "im"}).`);
        updateConversationState(conversationId, mem);
        markProcessed(batch);
        return true;
      }
    }


    if (saysWillSendNewAddress(latestText) && !looksLikeQuestion(latestText)) {
      mem.address = null;   // địa chỉ cũ không còn dùng -> xoá để không lên đơn nhầm về địa chỉ cũ
      const reply = "Dạ vâng có địa chỉ mới chị gửi em sớm để em lên đơn cho mình nha ạ";
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách báo sẽ gửi ĐỊA CHỈ MỚI / không ở địa chỉ cũ -> xác nhận chờ, xoá địa chỉ cũ.`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== [AI-QUYẾT contact/chốt đơn] AI quyết địa chỉ đủ/thiếu + hành động + soạn tin theo PHOM =====
    // [ĐẢO QUYỀN LỰC 2026-07-11] Thân khối nằm trong HÀM HOISTED _aiQuyetHanhDong — được GỌI Ở ĐẦU DISPATCH
    // (ngay sau khi AI trả JSON), TRƯỚC mọi handler luật cũ. Vị trí này chỉ còn là nơi khai báo hàm.
    async function _aiQuyetHanhDong() {
      const _cqCfg = aiQuyetCfg();
      const _cq = mem._aiQ;
      const _cqActs = ["XIN_SDT", "XIN_DIA_CHI", "XAC_NHAN_TINH", "HOI_SIZE", "HOI_MAU", "CHOT_DON", "IM_NHUONG_NGUOI"];
      if (_cqCfg.bat_diachi_chotdon && _cq && _cq.ok && _cqActs.includes(_cq.hanh_dong)
          && _cq.do_tin_cay >= _cqCfg.nguong && !mem.orderClosed && !humanInbox) {
        // [RÀO THỨ TỰ BÁN HÀNG - ca Trang Nguyen 2026-07-11] Khách đang HỎI GIÁ / lượt ĐA MẪU (nhiều ảnh)
        // / mẫu đang bám CHƯA ĐƯỢC BÁO GIÁ -> phải TƯ VẤN/BÁO GIÁ trước (rừng luật cũ + nhánh multi làm
        // việc này rất tốt). AI đòi xin thông tin/chốt lúc này = kéo khách lên đơn mẫu chưa biết giá -> ĐỨNG
        // NHÌN (trả false), chỉ IM_NHUONG_NGUOI được phép đi qua.
        if (_cq.hanh_dong !== "IM_NHUONG_NGUOI") {
          // [RÀO HẸN SAU - ca Bích Phượng 2026-07-11] Khách TỪ CHỐI KHÉO/hẹn sau ("e mua e liên hệ lại",
          // "để mình tham khảo/suy nghĩ đã") -> shop ĐÃ có kịch bản thuyết-phục-mềm rất khéo (lùi nhẹ +
          // ảnh góc khác + "khi nào cần chị cứ nhắn em"). AI dí XIN_SDT lúc này = bám đuổi phản cảm ->
          // ĐỨNG NHÌN, nhường kịch bản.
          if (wantsToBrowseMore(latestText) || String(mem._aiIntent || "") === "DEFER_DECISION") {
            console.log(`[AI-QUYẾT] ĐỨNG NHÌN (khách hẹn sau/từ chối khéo) -> kịch bản thuyết-phục-mềm cầm lượt, không dí xin thông tin.`);
            return false;
          }
          // [RÀO CÂU HỎI SẢN PHẨM - ca Thuy Nguyen 2026-07-11] Khách đang HỎI về sản phẩm (màu/chất/tồn/
          // set/bảng size/ship...) -> việc lượt này là TRẢ LỜI CÂU HỎI (luật cũ + sheet làm chuẩn). AI đòi
          // xin thông tin lúc này = bỏ rơi câu hỏi của khách ("Có đen k e" mà bị dí xin SĐT) -> ĐỨNG NHÌN.
          const _cqAskKinds = ["COLOR_ASK", "ASK_COLOR", "MATERIAL_QA", "PRODUCT_DETAIL_QA", "STOCK", "SET_TYPE", "SIZE_CHART", "SHIP_FEE", "SHIP_TIME", "SHIP_ORIGIN", "INSPECT_REQUEST", "TRYON_REQUEST", "DISCOUNT", "PRICE_OBJECTION"];
          if (_cqAskKinds.includes(String(mem._aiIntent || ""))) {
            console.log(`[AI-QUYẾT] ĐỨNG NHÌN (nhãn ${mem._aiIntent} = khách đang HỎI sản phẩm) -> luật cũ trả lời câu hỏi, AI không xin thông tin đè.`);
            return false;
          }
          const _cqAskPrice = String(mem._aiIntent || "") === "PRICE_ASK" || mem._aiAsksPrice === true;
          const _cqMultiTurn = (fromImages || []).length >= 2;
          const _cqRefUp = String(_cq.referent || "").toUpperCase();
          const _cqRefUnpriced = _cqRefUp && _cqRefUp !== "UNKNOWN"
            && !(mem.pricedCodes || []).map(x => String(x).toUpperCase()).includes(_cqRefUp);
          if (_cqAskPrice || _cqMultiTurn || _cqRefUnpriced) {
            console.log(`[AI-QUYẾT] ĐỨNG NHÌN (${_cqAskPrice ? "khách đang hỏi giá" : _cqMultiTurn ? "lượt đa mẫu" : "mẫu " + _cqRefUp + " CHƯA được báo giá"}) -> luật cũ tư vấn/báo giá trước, không xin thông tin vội.`);
            return false;
          }
        }
        // [RÀO HẬU MÃI - ca Hân Ngô 2026-07-11] Nhãn lượt này thuộc nhóm hậu mãi (đổi/hoàn/sửa đơn/hàng lỗi/
        // chuyển khoản...) -> việc của NHÂN VIÊN đối chiếu đơn cũ. AI có đề xuất XIN_*/CHOT_DON cũng KHÔNG
        // được làm — ép về IM_NHUONG_NGUOI (rào cứng, kể cả khi prompt trượt).
        const _cqAfterSale = ["EXCHANGE_REQUEST", "REFUND_REQUEST", "EDIT_ORDER", "DEFECT_REPORT", "CK_PROOF", "REFUSE_DELIVERY", "CANCEL_ORDER"].includes(String(mem._aiIntent || ""));
        if (_cqAfterSale && _cq.hanh_dong !== "IM_NHUONG_NGUOI") {
          console.log(`[AI-QUYẾT] nhãn hậu mãi ${mem._aiIntent} -> ép ${_cq.hanh_dong} về IM_NHUONG_NGUOI (đổi/hoàn là việc người thật).`);
          _cq.hanh_dong = "IM_NHUONG_NGUOI"; _cq.tin_nhan = "";
        }
        // AI gộp được địa chỉ chuẩn từ các mảnh -> nhận vào mem (qua rào địa danh thật)
        if (_cq.dia_chi && _cq.dia_chi.dia_chi_chuan && _aqLooksAddr(_cq.dia_chi.dia_chi_chuan)) {
          mem.address = _cq.dia_chi.dia_chi_chuan;
        }
        if (_cq.hanh_dong === "IM_NHUONG_NGUOI") {
          await tagChoXuLyVaUnread(conversationId);
          mem.botHandoffAt = Date.now();
          console.log(`[AI-QUYẾT] IM_NHUONG_NGUOI -> gắn Chờ-XL, bot đứng ngoài.`);
          updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        if (_cq.hanh_dong !== "CHOT_DON") {
          // Câu xin thông tin: dùng tin AI soạn theo phom; rỗng/quá dài -> phom mặc định.
          const _cqDef = {
            XIN_SDT: "Dạ em nhận được thông tin của chị rồi ạ, chị cho em xin số điện thoại để em lên đơn cho mình nha ạ",
            XIN_DIA_CHI: "Dạ chị cho em xin địa chỉ nhận hàng (số nhà, phường/xã, tỉnh/thành) để em lên đơn cho mình nha ạ",
            XAC_NHAN_TINH: "Dạ khu vực của mình có thay đổi tên tỉnh/thành theo cập nhật hành chính mới, chị xác nhận giúp em địa chỉ đang ở TỈNH/THÀNH PHỐ nào ạ? 🥰",
            HOI_SIZE: "Dạ chị cho em xin chiều cao cân nặng để em tư vấn size chuẩn cho mình nha",
            HOI_MAU: "Dạ chị lấy màu nào ạ để em lên đơn cho mình nha"
          };
          let _cqMsg = String(_cq.tin_nhan || "").trim();
          if (!_cqMsg || _cqMsg.length > 350 || /\d[\d.,]{2,}\s*(đ|vnđ|vnd)\b/i.test(_cqMsg)) _cqMsg = _cqDef[_cq.hanh_dong];
          // Không hỏi lại thứ ĐÃ có (rào chống lặp kiểu Mỹ Linh)
          if (_cq.hanh_dong === "XIN_SDT" && mem.phone) { console.log(`[AI-QUYẾT] BỎ XIN_SDT: đã có sđt -> để luật cũ chạy.`); }
          else if (_cq.hanh_dong === "XAC_NHAN_TINH" && mem._provConfirmDone) { console.log(`[AI-QUYẾT] BỎ XAC_NHAN_TINH: đã hỏi rồi -> để luật cũ chạy.`); }
          else {
            if (_cq.hanh_dong === "XAC_NHAN_TINH") { mem._addrAwaitProvince = true; mem._provConfirmDone = true; }
            if (_cq.hanh_dong === "XIN_DIA_CHI" || _cq.hanh_dong === "XAC_NHAN_TINH") mem._reaskedAddr = true;
            await sendInboxMessage(conversationId, _cqMsg);
            console.log(`[AI-QUYẾT] ${_cq.hanh_dong} -> "${_cqMsg.slice(0, 60)}"`);
            mem.lastBotReply = _cqMsg; updateConversationState(conversationId, mem); markProcessed(batch); return true;
          }
        } else {
          // ===== CHOT_DON: thẩm định TỪNG TRƯỜNG (từng SẢN PHẨM nếu đơn nhiều mẫu) rồi mới chốt =====
          const _cqFail = [];
          const _cqItemsIn = (_cq.don && _cq.don.san_pham && _cq.don.san_pham.length)
            ? _cq.don.san_pham
            : [{ ma: (_cq.don && _cq.don.ma) || _cq.referent, mau_sac: (_cq.don && _cq.don.mau_sac) || "", size: (_cq.don && _cq.don.size) || "" }];
          const _cqItems = [];   // [{prod, size, color}]
          try {
            const _cC = await ensureCatalog();
            for (const it of _cqItemsIn) {
              const _ma = String((it && it.ma) || "").toUpperCase();
              const _p = _cC.byCode.get(_ma) || null;
              if (!_p) { _cqFail.push(`mã "${_ma || "(trống)"}" không có trong catalog`); continue; }
              let _sz = String((it && it.size) || "").toUpperCase() || null;
              const _avail = parseAvailableSizes(_p.size);
              const _needSize = _avail.size > 0 && !_avail.has("FREESIZE");
              if (_needSize) {
                if (_sz && _avail.has(_sz)) { /* ok */ }
                else if (mem.customerSize && _avail.has(String(mem.customerSize).toUpperCase())) { _sz = String(mem.customerSize).toUpperCase(); }
                else { _cqFail.push(`size "${_sz || mem.customerSize || "(trống)"}" không nằm trong bảng size mẫu ${_ma} (${_p.size})`); continue; }
              } else { _sz = null; }
              _cqItems.push({ prod: _p, size: _sz, color: String((it && it.mau_sac) || "").toLowerCase() || null });
            }
            if (!_cqItems.length) _cqFail.push("không có sản phẩm hợp lệ nào");
          } catch (_) { _cqFail.push("không nạp được catalog"); }
          let _cqSdt = String((_cq.don && _cq.don.sdt) || mem.phone || "").replace(/[\s.\-]/g, "");
          if (/^\+?84\d{9}$/.test(_cqSdt)) _cqSdt = "0" + _cqSdt.replace(/^\+?84/, "");
          if (!/^0\d{9,10}$/.test(_cqSdt)) _cqFail.push(`sđt "${_cqSdt || "(trống)"}" sai định dạng`);
          const _cqAddr = String((_cq.don && _cq.don.dia_chi) || (_cq.dia_chi && _cq.dia_chi.dia_chi_chuan) || mem.address || "").trim();
          if (!_aqLooksAddr(_cqAddr)) _cqFail.push(`địa chỉ "${_cqAddr.slice(0, 30)}" không có địa danh thật`);
          if (_cqFail.length) {
            await tagChoXuLyVaUnread(conversationId);
            mem.botHandoffAt = Date.now();
            console.log(`[AI-QUYẾT] CHOT_DON bị CHẶN (thẩm định trượt: ${_cqFail.join("; ")}) -> gắn người thật, KHÔNG chốt bừa.`);
            updateConversationState(conversationId, mem); markProcessed(batch); return true;
          }
          // Thẩm định OK -> ghi trường vào mem rồi chốt. COD do code tra sheet, KHÔNG lấy số của AI.
          mem.phone = _cqSdt; mem.address = _cqAddr;
          mem.orderColorByCode = mem.orderColorByCode || {};
          for (const it of _cqItems) { if (it.color) mem.orderColorByCode[String(it.prod.code).toUpperCase()] = it.color; }
          const _cqSameSize = _cqItems.every(it => !it.size || it.size === _cqItems[0].size);
          if (_cqItems[0].size && _cqSameSize) { mem.customerSize = _cqItems[0].size; mem.sizeFromCustomer = true; }
          const _cqProds = _cqItems.map(it => it.prod);
          mem.quotedProducts = _cqProds; mem.currentProduct = _cqProds[0]; productInfo = _cqProds[0];
          if (_cqItems.length > 1) {
            // ĐƠN NHIỀU MẪU -> dựng orderLines: buildOrderConfirmation/computeOrderTotal render từng dòng + cộng tiền từng món.
            mem.orderLines = _cqItems.map(it => ({ code: String(it.prod.code).toUpperCase(), color: it.color, size: it.size, qty: 1 }));
            mem.orderLinesCode = null;
          }
          await sendOrderCreatingWithImages(conversationId, mem, _cqProds[0]);
          // Tin xác nhận: đơn 1 mẫu ưu tiên phom AI soạn (phải có {COD} + đúng sđt); đơn NHIỀU mẫu / phom
          // AI thiếu trường -> phom code dựng (buildOrderConfirmation render đủ từng dòng, COD từ sheet).
          let _cqConfirm = String(_cq.tin_nhan || "");
          const _cqTot = computeOrderTotal(mem, _cqProds[0]);
          const _cqCod = (_cqTot.known && _cqTot.total > 0) ? (_fmtMoney(_cqTot.total) + "đ") : "";
          if (_cqItems.length === 1 && _cqConfirm.includes("{COD}") && _cqConfirm.includes(_cqSdt) && /Sản phẩm/i.test(_cqConfirm) && _cqCod) {
            _cqConfirm = _cqConfirm.replace(/\{COD\}/g, _cqCod) + "\n" + orderGreeting(mem);
          } else {
            _cqConfirm = buildOrderConfirmation(mem, _cqProds[0]);
            if (_cqItems.length === 1) console.log(`[AI-QUYẾT] phom AI soạn thiếu trường -> dùng phom code dựng (an toàn).`);
          }
          await sendInboxMessage(conversationId, _cqConfirm);
          await tagAiChot(conversationId);
          mem.orderClosed = true; mem.orderState = "DA_CHOT"; mem.everOrdered = true;
          cancelFollowup(conversationId);
          console.log(`[AI-QUYẾT] CHỐT ĐƠN ${_cqItems.length} MẪU: ${_cqItems.map(it => String(it.prod.code).toUpperCase() + (it.size ? "/" + it.size : "")).join(", ")} | COD sheet=${_cqCod || "?"} | tin cậy ${_cq.do_tin_cay}.`);
          mem.lastBotReply = _cqConfirm; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
      }
      return false;   // AI nói TU_VAN / công tắc tắt / không đủ tự tin -> luật cũ cầm lái
    }

    // ===== ĐANG CHỜ KHÁCH CHO TỈNH (khu vực trùng nhiều tỉnh) — TUYỆT ĐỐI không nhảy về "lên đơn size" =====
    if (mem._addrAwaitProvince && !mem.orderClosed) {
      const _provKey = _va.explicitProvince(_va.fold(latestText))
        || (mem.address ? _va.explicitProvince(_va.fold(mem.address)) : null);
      if (_provKey) {
        // Khách ĐÃ cho tỉnh -> ghép vào địa chỉ + xoá cờ chờ.
        const _provDisp = _va.provinceDisplay(_provKey);
        if (mem.address && !_va.explicitProvince(_va.fold(mem.address))) {
          mem.address = (String(mem.address).replace(/[,\s]+$/, "") + ", " + _provDisp).trim();
        }
        mem._addrAwaitProvince = false; mem._addrProvAskCount = 0; mem._addrProvCandidates = null;
        mem._provConfirmDone = true; mem._aiProvinceConfirm = false;   // [FIX Mỹ Linh] khách ĐÃ trả lời tỉnh -> tắt hẳn vòng hỏi xác nhận
        const _pi = productInfo || (mem.quotedProducts && mem.quotedProducts[0]) || null;
        const _sizeOk = !_pi || !orderNeedsSize(mem, _pi) || mem.customerSize;
        if (_pi && mem.phone && addrReady(mem) && _sizeOk) {
          const reply = await sendOrderClose(conversationId, mem, _pi);
          await tagAiChot(conversationId);
          mem.orderClosed = true; mem.orderState = "DA_CHOT"; mem.everOrdered = true; cancelFollowup(conversationId);
          console.log(`[${BOT_NAME}] Khách cho tỉnh "${_provDisp}" -> địa chỉ đủ -> CHỐT ĐƠN.`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        // có tỉnh nhưng còn thiếu size/sđt -> để luồng dưới xin nốt (đã xoá cờ, không lặp).
      } else {
        // Khách trả lời KHÔNG nêu tỉnh (vd "Đúng rồi e") -> HỎI LẠI tỉnh, KHÔNG quay về lên đơn.
        mem._addrProvAskCount = (mem._addrProvAskCount || 0) + 1;
        if (mem._addrProvAskCount <= 2) {
          const _cand = mem._addrProvCandidates || [];
          const _opt = _cand.length >= 2 ? ` (em thấy có ở ${_cand.slice(0, 3).join(", ")})` : "";
          const reply = `Dạ khu vực này có ở vài tỉnh/thành nên em chưa ghi địa chỉ được ạ. Chị cho em xin TÊN TỈNH/THÀNH PHỐ${_opt} để em lên đơn cho chuẩn nha ạ`;
          await sendInboxMessage(conversationId, reply);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        // hỏi 2 lần vẫn không rõ tỉnh -> nhường người thật (an toàn, không tự đoán).
        mem._addrAwaitProvince = false;
        await tagChoXuLyVaUnread(conversationId); mem.botHandoffAt = Date.now();
        console.log(`[${BOT_NAME}] Hỏi tỉnh ${mem._addrProvAskCount} lần vẫn không rõ -> nhường người thật.`);
        mem.lastBotReply = HUMAN_CHECK_REPLY; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
    }

    // ===== KHÁCH XÁC NHẬN TỈNH (sau khi bot hỏi "địa chỉ này ở X đúng không") -> ghép tỉnh + chốt nếu đủ =====
    if (mem._addrConfirmProv && !looksLikeQuestion(latestText)
        && (isAffirmation(latestText) || /\b(đúng|dung|phải|phai|chuẩn|chuan|chính xác|chinh xac|ừ|u|um|ờ|đc|dc)\b/i.test(latestText))) {
      const prov = mem._addrConfirmProv;   // đã là TÊN HIỂN THỊ tỉnh (vd "Hà Nội")
      if (mem.address && !_va.explicitProvince(_va.fold(mem.address))) {
        mem.address = (String(mem.address).replace(/[,\s]+$/, "") + ", " + prov).trim();
      }
      mem._addrConfirmProv = null; mem._addrJustGiven = true; mem._reaskedAddr = false;
      const _pi = productInfo || (mem.quotedProducts && mem.quotedProducts[0]) || null;
      const _sizeOk = !_pi || !orderNeedsSize(mem, _pi) || mem.customerSize;
      if (_pi && mem.phone && addrReady(mem) && _sizeOk && !mem.orderClosed) {
        const reply = await sendOrderClose(conversationId, mem, _pi);
        await tagAiChot(conversationId);
        mem.orderClosed = true; mem.orderState = "DA_CHOT"; mem.everOrdered = true; cancelFollowup(conversationId);
        console.log(`[${BOT_NAME}] Khách XÁC NHẬN tỉnh "${prov}" -> ghép địa chỉ + CHỐT ĐƠN.`);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      const _miss = [];
      if (_pi && orderNeedsSize(mem, _pi) && !mem.customerSize) _miss.push("size");
      if (!mem.phone) _miss.push("số điện thoại");
      const reply = _miss.length
        ? `Dạ em ghi nhận địa chỉ ở ${prov} rồi ạ. Chị cho em xin thêm ${joinVi(_miss)} để em lên đơn cho mình nha`
        : `Dạ em ghi nhận địa chỉ ở ${prov} cho mình rồi nha chị ạ.`;
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách xác nhận tỉnh "${prov}" -> ghép địa chỉ, còn thiếu ${_miss.join("+") || "(không)"}.`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH VỪA CHO SĐT/ĐỊA CHỈ (thông tin để CHỐT) -> TIẾN TỚI CHỐT, TUYỆT ĐỐI KHÔNG BÁO GIÁ LẠI =====
    // Tin chỉ có sđt/địa chỉ (không có chữ "lên đơn", không mẫu/ảnh) trước đây không thoả customerWantsToOrder
    // -> rơi xuống §13 báo giá lại + hỏi lại size. Chặn tại đây: đủ thì CHỐT, thiếu thì XÁC NHẬN đã nhận + xin ĐÚNG cái thiếu.
    {
      const _phoneNow = /(?:\+?84|0)(?:[\s.\-]?\d){6,11}(?![\d])/.test(latestText);
      // [GUARD] nhãn AI là câu HỎI (hỏi hàng đẹp như hình, hỏi giá, bảng size...) -> KHÔNG coi là "vừa cho contact để chốt".
      const _askKindsClose = ["AUTHENTICITY_QA", "PRICE_ASK", "SIZE_CHART", "QUALITY_CONCERN", "POLICY_QA", "POST_ORDER_CHITCHAT", "POST_ORDER_REQUEST", "POST_ORDER_CONFIRMED", "THANKS", "URGENT"];
      const _isAskLabelClose = _askKindsClose.includes(String(mem._aiIntent || "").toUpperCase());
      const _gaveContactNow = (mem._addrJustGiven || (_phoneNow && mem.phone)) && !looksLikeQuestion(latestText) && !_isAskLabelClose;
      if (_gaveContactNow && productInfo && !mem.orderClosed) {
        const _availC = parseAvailableSizes(productInfo.size);
        const _needSizeC = _availC.size > 0 && !_availC.has("FREESIZE");
        let _effC = effectiveSize(mem, productInfo);
        // [FIX Hien Nguyen] đã biết CÂN NẶNG (đã tư vấn size từ cân nặng ở lượt trước) mà chưa lưu size
        //   -> SUY size từ cân nặng + lưu lại, ĐỪNG xin lại size khi khách đã cho contact.
        if (_needSizeC && !_effC && mem.weightKg) {
          const _rw = resolveSizeByWeight(mem.weightKg, productInfo.size);
          if (_rw && _rw !== "OVER" && _rw !== "FREESIZE") {
            mem.customerSize = _rw; mem.sizeFromCustomer = false;
            _effC = effectiveSize(mem, productInfo);
            console.log(`[${BOT_NAME}] Chốt-contact: suy size ${_rw} từ ${mem.weightKg}kg (đã tư vấn trước) -> KHÔNG xin lại size.`);
          }
        }
        const _haveSizeC = !_needSizeC || !!_effC;
        const _colsC = (typeof modelColorList === "function") ? (modelColorList(productInfo) || []) : [];
        // MÀU MẶC ĐỊNH KHI CHỐT (sao y luật 7811): mẫu NHIỀU màu nhưng cả hội thoại bám 1 MÀU
        // (màu ad/comment/ảnh đã gửi) + khách KHÔNG hỏi màu khác -> coi như khách chốt màu đó,
        // KHÔNG hỏi "lấy màu nào" (tránh hỏi thừa kiểu Ovelles làm khách rối). Khách hỏi màu khác -> vẫn hỏi.
        try {
          const _ccC = String(productInfo.code || "").toUpperCase();
          if (_colsC.length >= 2 && !(mem.orderColorByCode && mem.orderColorByCode[_ccC])) {
            if (asksOtherColors(latestText)) mem.multiColorInterest = _ccC;   // khách hỏi màu khác -> PHẢI hỏi
            const _focusC = mem.askedImageColor || mem.lastSentImageColor
                         || (mem.sourceColorByCode || {})[_ccC] || (mem.colorByCode || {})[_ccC] || null;
            const _focusCanonC = _focusC ? (_colsC.find(c => colorMatches(c, _focusC) || colorMatches(_focusC, c)) || null) : null;
            if (_focusCanonC && mem.multiColorInterest !== _ccC) {
              mem.orderColorByCode = mem.orderColorByCode || {};
              mem.orderColorByCode[_ccC] = String(_focusCanonC).toLowerCase();
              console.log(`[${BOT_NAME}] Chốt-contact: mẫu ${_ccC} nhiều màu nhưng hội thoại bám 1 màu (${_focusCanonC}) -> MẶC ĐỊNH màu đó, KHÔNG hỏi.`);
            }
          }
        } catch (_) {}
        // [FIX Lưu Phương Thảo] CHỈ hỏi "lấy màu nào" khi khách THỰC SỰ quan tâm >=2 màu
        // (multiColorInterest = đã hỏi màu khác) HOẶC bot đã gửi ĐỦ MÀU cho mẫu này. Nếu suốt hội thoại
        // mẫu chỉ xuất hiện 1 màu (màu ad/ảnh bìa) + khách KHÔNG hỏi màu khác -> mặc định màu đó, KHÔNG hỏi.
        // (lỗi: bài ad 1 màu, khách cho luôn sđt+đc, bot vẫn hỏi "lấy màu nào" -> hỏi thừa.)
        const _ccNeed = String(productInfo.code || "").toUpperCase();
        const _multiInterest = (mem.multiColorInterest === _ccNeed)
          || (mem._sentAllColorsFor === _ccNeed) || asksOtherColors(latestText);
        // [FIX Shuixian Yu] Khách chỉ BÁM 1 MÀU (ad/ảnh đã xem) + KHÔNG hỏi màu khác -> BẮT đúng màu đó
        //   vào đơn (sao y cổng tryCloseFromState ~1457). Trước đây thiếu bước này -> đơn rớt về màu ĐẦU
        //   sheet (kem) + xác nhận thiếu màu. Giờ lên đơn ĐÚNG màu khách bám.
        if (_colsC.length >= 2 && !_multiInterest && !(mem.orderColorByCode && mem.orderColorByCode[_ccNeed])) {
          const _focusCol = mem.askedImageColor || mem.lastSentImageColor
                         || (mem.sourceColorByCode || {})[_ccNeed] || (mem.colorByCode || {})[_ccNeed] || null;
          const _focusCanon = _focusCol ? (_colsC.find(c => colorMatches(c, _focusCol) || colorMatches(_focusCol, c)) || null) : null;
          if (_focusCanon) {
            mem.orderColorByCode = mem.orderColorByCode || {};
            mem.orderColorByCode[_ccNeed] = String(_focusCanon).toLowerCase();
            console.log(`[${BOT_NAME}] [màu đơn] khách bám 1 màu "${_focusCanon}" (mẫu ${_ccNeed}) -> lên đơn đúng màu đó.`);
          }
        }
        // Mẫu nhiều màu mà SAU bước bắt-màu VẪN chưa có màu chốt -> HỎI màu, KHÔNG lên đơn thiếu màu/màu kem mặc định.
        const _needColorC = _colsC.length >= 2
          && !(typeof chosenColorForCode === "function" && chosenColorForCode(mem, productInfo));
        const _missC = [];
        // XOÁ địa chỉ RÁC tồn đọng (ký tự lạ / data catalog) để không chốt nhầm về rác.
        if (mem.address && isGarbageAddress(mem.address)) { mem.address = null; }
        const _addrOkC = addrReady(mem);
        if (!mem.phone) _missC.push("số điện thoại");

        // ===== [RÀO NHIỀU MẪU 2026-07-07 - ca Xinh Pham] Khách từng nói LẤY NHIỀU MẪU ở các tin mà
        // NGƯỜI THẬT đang trả lời (bot đứng ngoài nên CHƯA TỪNG ĐỌC: "Mình lấy 2 set", "Cho mình đặt
        // 2 mẫu này nhé") -> đến tin contact bot nhảy vào chốt theo trí nhớ riêng = CHỐT THIẾU MẪU.
        // Rào: trước khi chốt, quét 10 tin khách gần nhất (kể cả tin đã bị coi là người-xử). Có tín
        // hiệu N mẫu mà cụm chốt < N: gộp đủ N mẫu đã tư vấn trong phiên -> chốt ĐƠN NHIỀU DÒNG;
        // không gộp đủ -> gắn người thật + ghi chú, TUYỆT ĐỐI không chốt thiếu.
        try {
          const _mmTxt = (data.messages || [])
            .filter(m => m && m.sender !== "shop" && m.type === "text" && m.text)
            .slice(-10).map(m => String(m.text).replace(/\s+/g, " ")).join(" | ");
          const _mmM = /(?:lấy|lay|đặt|dat|mua|chốt|chot)\s*(?:cả\s*|ca\s*)?(\d|hai|ba|bốn|bon)\s*(?:mẫu|mau|set|bộ|bo|cái|cai|váy|vay|đầm|dam)|cả\s*(2|hai)\s*mẫu|(2|hai)\s*mẫu\s*(?:này|nay)/i.exec(_mmTxt);
          if (_mmM && (mem.quotedProducts || []).length <= 1) {
            const _mmNumRaw = String(_mmM[1] || _mmM[2] || _mmM[3] || "2").toLowerCase();
            const _mmWant = ({ "2": 2, "hai": 2, "3": 3, "ba": 3, "4": 4, "bốn": 4, "bon": 4 })[_mmNumRaw] || 2;
            const _mmSeen = new Set(); const _mmList = [];
            const _mmAdd = (p) => { if (p && p.code && !_mmSeen.has(_up(p.code))) { _mmSeen.add(_up(p.code)); _mmList.push(p); } };
            for (const p of (mem.quotedProducts || [])) _mmAdd(p);
            if (productInfo) _mmAdd(productInfo);
            for (const p of (mem.sessionProducts || [])) _mmAdd(p);
            if (_mmList.length >= _mmWant) {
              const _mmPick = _mmList.slice(0, _mmWant);
              mem.quotedProducts = _mmPick;
              mem.orderLines = _mmPick.map(p => ({
                code: _up(p.code),
                color: (mem.orderColorByCode || {})[_up(p.code)] || (mem.sourceColorByCode || {})[_up(p.code)] || (mem.colorByCode || {})[_up(p.code)] || null,
                size: _effC || null, qty: 1
              }));
              mem.orderLinesCode = null;
              console.log(`[RÀO NHIỀU MẪU] khách nói lấy ${_mmWant} mẫu ("${String(_mmM[0]).slice(0, 30)}") -> chốt ĐƠN ${_mmPick.length} MẪU: ${_mmPick.map(p => _up(p.code)).join(", ")}.`);
            } else {
              await tagChoXuLyVaUnread(conversationId);
              try { await addConversationNote(conversationId, `⚠️ Khách nói lấy ${_mmWant} mẫu ("${String(_mmM[0]).slice(0, 40)}") nhưng bot chỉ xác định được ${_mmList.length} mẫu (${_mmList.map(p => _up(p.code)).join(", ") || "-"}) -> nhờ người thật lên đơn ĐỦ mẫu.`); } catch (_) {}
              mem.botHandoffAt = Date.now();
              console.log(`[RÀO NHIỀU MẪU] khách nói lấy ${_mmWant} mẫu nhưng bot chỉ xác định được ${_mmList.length} -> KHÔNG chốt thiếu, gắn người thật + ghi chú.`);
              updateConversationState(conversationId, mem); markProcessed(batch); return true;
            }
          }
        } catch (_) {}
        if (!_missC.length && _haveSizeC && !_needColorC && _addrOkC) {
          const reply = await sendOrderClose(conversationId, mem, productInfo);
          await tagAiChot(conversationId);
          mem.orderClosed = true; mem.orderState = "DA_CHOT"; mem.everOrdered = true;
          cancelFollowup(conversationId);
          console.log(`[${BOT_NAME}] Khách cho contact -> CHỐT ĐƠN ${_codeUp(productInfo)} (size ${_effC || "free"}).`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        // Còn thiếu -> XÁC NHẬN đã nhận + xin ĐÚNG cái thiếu (size/màu/sđt trước; ĐỊA CHỈ 3 tầng / xác nhận tỉnh sau).
        if (_missC.length) {
          const reply = `Dạ em nhận được thông tin của chị rồi ạ, chị cho em xin thêm ${joinVi(_missC)} để em lên đơn cho mình nha ạ`;
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] Khách cho contact, thiếu ${_missC.join("+")} -> xin nốt, KHÔNG báo giá lại.`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        if (_needColorC) {
          const reply = "Dạ em nhận được thông tin của chị rồi ạ, chị lấy màu nào ạ để em lên đơn cho mình nha";
          await sendInboxMessage(conversationId, reply);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        if (!_haveSizeC) {
          const reply = "Dạ em nhận được thông tin của chị rồi ạ, chị cho em xin size (hoặc chiều cao cân nặng) để em lên đơn cho mình nha ạ";
          await sendInboxMessage(conversationId, reply);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        if (!_addrOkC) {
          // Đủ sđt+size+màu, CHỈ thiếu/khuyết ĐỊA CHỈ -> xin tầng thiếu / HỎI XÁC NHẬN TỈNH (3 tầng).
          const reply = addressGapReply(mem.address, mem) || "Dạ chị cho em xin địa chỉ nhận hàng (số nhà, phường/xã, tỉnh/thành) để em lên đơn cho mình nha ạ";
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] Khách cho contact, ĐỊA CHỈ chưa đủ 3 tầng${mem._addrConfirmProv ? " (hỏi xác nhận tỉnh " + mem._addrConfirmProv + ")" : ""} -> xin nốt.`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
      }
    }

    // ===== [NHÃN AI] ORDER_CLOSE -> CODE đi tới CHỐT (AI gắn nhãn, code làm theo) =====
    // Đặt CAO hơn nhánh "xem màu" (8143) + báo giá lại để chúng KHÔNG cướp lượt chọn-màu-để-chốt.
    // Vẫn giữ rào an toàn: CODE tự dựng câu chốt (buildOrderConfirmation), KHÔNG cho AI soạn lời.
    if (!mem.orderClosed
        && _ai("ORDER_CLOSE")
        && !looksLikeQuestion(latestText)
        && !shopRepliedAfterLastCustomer(data.messages)) {
      const _piCl = productInfo || (mem.quotedProducts && mem.quotedProducts[0]) || null;
      const _rCl = tryCloseFromState(mem, _piCl, latestText);
      if (_rCl.status === "done") {
        // GUARD chống tạo ĐƠN TRÙNG: mẫu này ĐÃ có đơn trong hội thoại (bot/NV chốt trước, kể cả
        //   TRƯỚC khi pm2 restart làm mất RAM) -> KHÔNG tạo lại. Chỉ trấn an "đơn vẫn giữ nguyên".
        if (orderedInThread(data.messages, _piCl)) {
          // Khách CHỈ xã giao sau khi đã có đơn (Dạ/Vâng/Ok/👍/POST_ORDER_CHITCHAT) -> câu
          //   "đơn vẫn giữ nguyên" KHÔNG hợp (nghe như đang chốt lại). Đáp GỌN kiểu tán gẫu sau chốt.
          const _justChit = isBareAck(latestText) || isAffirmation(latestText)
            || isPostOrderChitChat(latestText) || _ai("POST_ORDER_CHITCHAT");
          if (_justChit) {
            mem.orderClosed = true; mem.orderState = "DA_CHOT"; mem.everOrdered = true; mem._postChotClosed = true;
            cancelFollowup(conversationId);
            const _chit = "Dạ vâng ạ";
            await sendInboxMessage(conversationId, _chit);
            console.log(`[${BOT_NAME}] [NHÃN ORDER_CLOSE] ĐÃ có đơn ${_codeUp(_piCl)} + khách chỉ xã giao -> đáp GỌN (KHÔNG "đơn giữ nguyên").`);
            mem.lastBotReply = _chit; updateConversationState(conversationId, mem); markProcessed(batch); return true;
          }
          const _reAck = "Dạ đơn của mình em vẫn giữ nguyên nha chị, chị yên tâm ạ. Có gì cần thêm chị cứ nhắn em nhé.";
          await sendInboxMessage(conversationId, _reAck);
          mem.orderClosed = true; mem.orderState = "DA_CHOT"; mem.everOrdered = true; cancelFollowup(conversationId);
          console.log(`[${BOT_NAME}] [NHÃN ORDER_CLOSE] ĐÃ có đơn ${_codeUp(_piCl)} trong hội thoại (quét luồng) -> KHÔNG tạo TRÙNG, chỉ trấn an.`);
          mem.lastBotReply = _reAck; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        await sendOrderCreatingWithImages(conversationId, mem, _piCl);   // tin "đang tạo" + ảnh đúng màu TRƯỚC câu cảm ơn
        await sendInboxMessage(conversationId, _rCl.reply);
        await tagAiChot(conversationId);
        mem.orderClosed = true; mem.orderState = "DA_CHOT"; mem.everOrdered = true; cancelFollowup(conversationId);
        console.log(`[${BOT_NAME}] [NHÃN ORDER_CLOSE] đủ thông tin -> CHỐT ĐƠN ${_codeUp(_piCl)}.`);
        mem.lastBotReply = _rCl.reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      if (_rCl.status === "color") {
        try {
          const _ccCl = _codeUp(_piCl); const _itemsCl = [];
          for (const c of (modelColorList(_piCl) || []).slice(0, 3)) {
            const im = (imageItemsByColor(_ccCl, c, 1, false) || [])[0];
            if (im) _itemsCl.push(im);
          }
          if (_itemsCl.length) await sendImages3(conversationId, _itemsCl, null);
        } catch (_) {}
        await sendInboxMessage(conversationId, _rCl.reply);
        console.log(`[${BOT_NAME}] [NHÃN ORDER_CLOSE] mẫu nhiều màu chưa chốt màu -> hỏi màu (kèm ảnh đủ màu).`);
        mem.lastBotReply = _rCl.reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      if (_rCl.status === "ask") {
        await sendInboxMessage(conversationId, _rCl.reply);
        console.log(`[${BOT_NAME}] [NHÃN ORDER_CLOSE] thiếu thông tin -> xin nốt (KHÔNG tư vấn lại).`);
        mem.lastBotReply = _rCl.reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // status === "handoff": không tra được mẫu -> KHÔNG return, để luồng dưới / người thật xử.
      console.log(`[${BOT_NAME}] [NHÃN ORDER_CLOSE] ${_rCl.reason} -> để luồng dưới/người thật.`);
    }

    // ===== [GĐ2] CỔNG ROUTER: chặn 3 ý hay bị nhánh tham lam chộp nhầm, xử TỪNG tin của khách =====
    // intent_router chấm độ chắc + soi cả cụm + tha gõ sai ("chấy gi"). CHỈ cầm trịch:
    //   HỎI CHẤT LIỆU / HỎI TỔNG TIỀN / HỎI PHÍ-MIỄN SHIP — mấy ý này trong ảnh hay bị size/đẩy-đơn/đòi-địa-chỉ cướp.
    // Mọi ý khác (kể cả hỏi HÃNG ship, thời gian giao) -> KHÔNG đụng, để luồng cũ chạy y nguyên.
    {
      const _routerMsgs = batch.filter(x => x.type === "text").map(x => x.text || "");
      const _hits = routeBatch(_routerMsgs);
      const _hit = (name) => _hits.find(r => r.intent === name);
      // THEO AI: nếu AI đã gán 1 nhãn Ý ĐỊNH RÕ RÀNG (giảm giá/hỏi giá/chốt đơn/hậu mãi...),
      //  thì cổng L1 (regex) KHÔNG được cướp sang "hỏi chất liệu/co giãn" do trùng chữ (vd "có đang GIẢM" ~ "co dãn").
      const _aiOverridesAttr = _ai("DISCOUNT") || _ai("PRICE_ASK") || _ai("ORDER_CLOSE") || _ai("ADD_TO_ORDER")
        || _ai("CANCEL_ORDER") || _ai("ORDER_STATUS") || _ai("PAYMENT_CONFIRM") || _ai("TOTAL_PAYMENT");

      // (0) HỎI GIẶT GIŨ / RA MÀU / PHAI (AI: WASH_CARE) -> trả câu chăm sóc; denim có câu riêng.
      if (_ai("WASH_CARE")) {
        const _mat = String((productInfo && productInfo.material) || "").toLowerCase();
        const _isDenim = /denim|jean|bò\b|nhuộm|chàm/.test(_mat) || /denim|jean|bò |đồ bò/.test(String(latestText||"").toLowerCase());
        let reply;
        if (_isDenim) {
          reply = "Dạ denim/đồ nhuộm thì vài lần đầu sẽ ra màu chàm là đặc trưng tự nhiên nha chị, mình giặt riêng với nước lạnh, không ngâm lâu là giữ màu đẹp lâu ạ. Sau vài lần là hết ra màu nha!";
        } else if (/ra m[àa]u|phai/.test(String(latestText||"").toLowerCase())) {
          reply = "Dạ chất này bên em không bị ra màu đâu chị, mình giặt bình thường yên tâm nha. Lần đầu giặt riêng cho chắc là được ạ";
        } else {
          reply = "Dạ chất này giặt máy bình thường được nha chị, mình giặt ở chế độ nhẹ là được ạ. Lộn trái áo và giặt với nước lạnh thì giữ màu bền đẹp lâu hơn nha!";
        }
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Khách hỏi GIẶT GIŨ/RA MÀU (WASH_CARE)${_isDenim ? " [denim]" : ""}.`);
        mem.lastBotReply = reply;
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }

      // (1) HỎI CHẤT LIỆU -> trả từ sheet nếu có, không có/chưa rõ mẫu -> CHỜ XL. Chặn TRƯỚC nhánh size.
      if (_hit("HOI_CHAT_LIEU") && !_multiAttrQ && !_aiOverridesAttr) {
        const _r = productInfo ? materialReplyFromSheet(productInfo) : null;
        if (_r) {
          await sendInboxMessage(conversationId, _r);
          console.log(`[${BOT_NAME}] [router] HỎI CHẤT LIỆU -> sheet: ${productInfo.material}`);
          mem.lastBotReply = _r; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        const _w = "Dạ chị chờ em kiểm tra lại chất liệu mẫu này rồi báo mình ngay nha ạ";
        await sendInboxMessage(conversationId, _w);
        await tagChoXuLyVaUnread(conversationId);
        console.log(`[${BOT_NAME}] [router] HỎI CHẤT LIỆU (sheet trống/chưa rõ mẫu) -> CHỜ XL.`);
        mem.lastBotReply = _w; mem.botHandoffAt = Date.now();
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }

      // (1b) HỎI ĐỘ CO GIÃN -> đọc ĐÚNG cột S (productInfo.stretch). Chặn TRƯỚC handler giá (chống nhãn ASK_PRICE bậy của bộ cũ).
      if (_hit("HOI_CO_GIAN") && !_multiAttrQ && !_aiOverridesAttr) {
        const _sr = productInfo ? stretchReplyFromSheet(productInfo, mem) : null;
        if (_sr) {
          await sendInboxMessage(conversationId, _sr);
          console.log(`[${BOT_NAME}] [router] HỎI CO GIÃN -> cột S: "${productInfo.stretch}"`);
          mem.lastBotReply = _sr; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        const _w = "Dạ phần co giãn của mẫu này em kiểm tra lại rồi báo mình ngay nha ạ";
        await sendInboxMessage(conversationId, _w);
        await tagChoXuLyVaUnread(conversationId);
        console.log(`[${BOT_NAME}] [router] HỎI CO GIÃN (cột S trống/chưa rõ mẫu) -> CHỜ XL.`);
        mem.lastBotReply = _w; mem.botHandoffAt = Date.now();
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }

      // (2) HỎI TỔNG TIỀN -> tính tổng (y hệt handler cũ). Chặn TRƯỚC nhánh đòi-địa-chỉ/đẩy-đơn.
      if (_hit("HOI_TONG_TIEN") && (productInfo || (mem.quotedProducts && mem.quotedProducts.length))) {
        const { sum, ship, total, known } = computeOrderTotal(mem, productInfo);
        let _r;
        if (known && sum > 0) {
          const _shipTxt = ship ? `(gồm ${_fmtMoney(sum)}đ tiền hàng + ${_fmtMoney(ship)}đ ship)` : "(đã freeship)";
          _r = `Dạ đơn của chị tổng ${_fmtMoney(total)}đ ${_shipTxt} ạ, mình thanh toán khi nhận hàng nha`;
        } else {
          _r = "Dạ chị chốt giúp em mẫu (và số lượng) là em tính tổng chính xác rồi báo lại mình ngay nha";
        }
        await sendInboxMessage(conversationId, _r);
        console.log(`[${BOT_NAME}] [router] HỎI TỔNG TIỀN -> ${known ? _fmtMoney(total) + "đ" : "thiếu dữ liệu"}.`);
        mem.lastBotReply = _r; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }

      // (3) HỎI SHIP: CHỈ ôm câu PHÍ/MIỄN ship -> trả theo QUY TẮC SẴN CÓ (shipReplyText). Câu HÃNG/THỜI GIAN để luồng cũ.
      const _sh = _hit("HOI_SHIP");
      if (_sh) {
        const _m = routerFold(_sh.text);
        const _isFee = /(mien ship|free ship|freeship|phi ship|tien ship|ship bao nhieu|co tinh ship|co mat ship|ship het bao nhieu|co ship khong)/.test(_m);
        const _prods = (mem.quotedProducts && mem.quotedProducts.length) ? mem.quotedProducts : (productInfo ? [productInfo] : []);
        if (_isFee && _prods.length) {
          const _r = shipReplyText(_prods);   // <500k +30k, ≥500k freeship (quy tắc shop)
          await sendInboxMessage(conversationId, _r);
          console.log(`[${BOT_NAME}] [router] HỎI PHÍ/MIỄN SHIP -> theo quy tắc: ${_r}`);
          mem.lastBotReply = _r; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        // không phải hỏi phí / chưa rõ mẫu -> để luồng cũ (asksShippingCarrier / isShipFeeQuestion) lo, KHÔNG đụng.
      }
    }

    // ===== KHÁCH CHỌN THEO MÀU giữa NHIỀU mẫu đang xem ("chị thích váy màu hồng thôi", "lấy cái xanh") =====
    // Hiểu MÀU khách gửi (mem.colorByCode = màu đọc từ tên file ảnh) hoặc cột màu SP -> co cụm về đúng mẫu màu đó.
    {
      const _wantColor = extractColor(latestText);
      const _cluster = (mem.quotedProducts || []);
      const _isAvailQ = /\b(có|còn|co|con)\b.{0,30}\b(không|ko|kg|hông|hong)\b/i.test(latestText);  // "có màu X không" = hỏi, KHÔNG phải chốt
      const _pickIntent = /thích|thik|ưng|lấy|lay|chọn|chon|mua|chốt|chot|thôi|thui|cái (này|kia|đó)|cai (nay|kia|do)|con (này|kia)|mẫu (này|kia)|mau (nay|kia)/i.test(latestText)
        && !dislikesColor(latestText);   // "KHÔNG thích màu X" -> KHÔNG phải chọn màu X (để Phương án 2 xử lý)
      if (_wantColor && _cluster.length > 1 && _pickIntent && !_isAvailQ) {
        const byImg = _cluster.find(p => colorMatches((mem.colorByCode || {})[String(p.code || "").toUpperCase()], _wantColor));
        const bySheet = _cluster.find(p => colorMatches(p.color, _wantColor));
        const picked = byImg || bySheet;
        if (picked) {
          productInfo = picked;
          mem.currentProduct = picked;
          mem.quotedProducts = [picked];
          quotedProducts = [picked];
          mem.orderColor = _wantColor;        // nhớ màu đã chọn để LÊN ĐƠN
          mem.orderColorByCode = Object.assign({}, mem.orderColorByCode || {}, { [String(picked.code || "").toUpperCase()]: _wantColor });
          mem.upsellAsked = false;
          if (_turnCtx) _turnCtx.productInfo = picked;
          console.log(`[${BOT_NAME}] Khách chọn theo MÀU "${_wantColor}" -> co về mẫu ${picked.code} (${picked.name}) | nguồn màu: ${byImg ? "ảnh" : "sheet"}.`);
        }
      } else if (_wantColor && _cluster.length === 1 && _pickIntent && !_isAvailQ) {
        // chỉ 1 mẫu đang xem + khách nói màu -> nhớ màu cho đơn (không đổi mẫu).
        mem.orderColor = _wantColor;
        const _c1 = String(((productInfo || _cluster[0] || {}).code) || "").toUpperCase();
        if (_c1) mem.orderColorByCode = Object.assign({}, mem.orderColorByCode || {}, { [_c1]: _wantColor });
      }
    }

    // ===== MẪU KHÁCH QUAN TÂM ĐÃ HẾT HÀNG (cột E = "HẾT HÀNG") =====
    //  -> báo hết hàng + gửi MẪU MỚI TƯƠNG TỰ (còn hàng). KHÔNG báo giá / KHÔNG gửi ảnh mẫu hết này.
    //  NHƯNG: nếu khách gửi CỤM NHIỀU MẪU mà còn mẫu CÒN HÀNG -> KHÔNG dừng ở đây,
    //  để block báo giá nhiều mẫu (§17) lo: báo giá mẫu còn hàng + sendBlocks tự báo hết mẫu hết.
    const _ooCluster = [...(mem.quotedProducts || []), ...(Array.isArray(thisTurn) ? thisTurn : [])];
    const _ooClusterInStock = _ooCluster.length > 1
      && _ooCluster.some(p => p && !recommend.isOutOfStock(p) && recommend.sellable(p));
    if (productInfo && recommend.isOutOfStock(productInfo) && !_ooClusterInStock) {
      const code = String(productInfo.code || "").toUpperCase();
      // Khách hỏi "khi nào có hàng LẠI / bao giờ về / restock" -> báo NGỪNG SẢN XUẤT, không bán lại (tạo khan hiếm).
      const asksRestock = /(khi nào|bao giờ|chừng nào|lúc nào|hôm nào|mai mốt)[^?]{0,20}(có|về|nhập|bán|sản xuất|lại)|có\s*(hàng\s*)?lại|về\s*hàng|nhập\s*(lại|hàng)|restock|sản xuất\s*(lại|thêm)|còn\s*(bán|hàng)[^?]{0,10}(không|ko|chưa|nữa)/i.test(latestText);
      if (asksRestock && mem.restockToldFor !== code) {
        const reply = "Dạ mẫu này bên em ngưng sản xuất, không bán trở lại nữa rồi chị ạ. Đồ bên em hết nhanh lắm, chị tham khảo mấy mẫu mới em vừa gửi nha, cũng xinh không kém đâu ạ";
        await sendInboxMessage(conversationId, reply);
        mem.restockToldFor = code;
        mem.outOfStockNotifiedFor = code;
        mem.lastBotReply = reply;
        console.log(`[${BOT_NAME}] Mẫu ${code} HẾT HÀNG + khách hỏi khi nào có lại -> báo NGỪNG SẢN XUẤT (khan hiếm).`);
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      const first = mem.outOfStockNotifiedFor !== code;
      const reply = first
        ? "Dạ mẫu này hiện bên em hết hàng rồi ạ. Em gửi chị vài mẫu mới tương tự bên em nha"
        : "Dạ mẫu này bên em hết hàng rồi ạ, chị tham khảo mấy mẫu mới em vừa gửi nha";
      await sendInboxMessage(conversationId, reply);
      mem.outOfStockNotifiedFor = code;
      mem.lastBotReply = reply;
      if (first) {
        let sent = false;
        try {
          const gallery = await buildOOSSimilarGallery(code, mem);
          if (gallery) { await sendGallery(conversationId, gallery, mem, null); sent = true; }
        } catch (e) { console.log("[hết hàng] gửi mẫu tương tự lỗi:", e.message); }
        if (!sent) {
          await sendInboxMessage(conversationId, "Dạ chị chờ em chọn vài mẫu mới gửi chị tham khảo nha");
          await tagChoXuLyVaUnread(conversationId);
          mem.botHandoffAt = Date.now();
        }
      }
      console.log(`[${BOT_NAME}] Mẫu ${code} HẾT HÀNG -> báo hết + ${first ? "gửi mẫu mới tương tự" : "không lặp gallery"}.`);
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== HỎI HÀNG ĐỔI GỬI VỀ ĐÃ NHẬN CHƯA -> NGƯỜI THẬT kiểm kho (KHÔNG hỏi lý do đổi, KHÔNG báo giá) =====
    if (asksExchangeReceived(latestText) && !_nhanCamRegex(mem, "asksExchangeReceived", ["EXCHANGE_REQUEST", "RETURN_POLICY", "ORDER_STATUS"])) {
      const reply = "Dạ chị chờ em kiểm tra xem đơn đổi của mình về tới kho chưa rồi báo lại mình ngay nha ạ";
      await sendInboxMessage(conversationId, reply);
      await tagChoXuLyVaUnread(conversationId);
      console.log(`[${BOT_NAME}] Hỏi hàng đổi đã nhận chưa -> CHỜ XL người thật kiểm kho (không báo giá).`);
      mem.lastBotReply = reply; mem.botHandoffAt = Date.now();
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== ĐỔI HÀNG: ĐỒNG CẢM / hỏi lý do TRƯỚC -> rồi mới hướng dẫn gửi hàng (tránh cụt) =====
    // Khách hỏi ĐƠN VỊ VẬN CHUYỂN -> J&T (chỉ trả khi hỏi).
    // ===== VÙNG CHÍNH SÁCH CỐ ĐỊNH (đã xác nhận: J&T-only, COD chuẩn) =====
    // (1) Khách ĐÒI/TỪ CHỐI hãng khác -> trả THẲNG sự thật: shop chỉ gửi J&T (KHÔNG tự đồng ý hãng khác).
    if (demandsOtherCarrier(latestText)) {
      const reply = "Dạ đơn bên em hiện chỉ gửi qua J&T thôi ạ, bên em chưa hỗ trợ hãng khác, mong chị thông cảm giúp em nha";
      await sendInboxMessage(conversationId, reply);
      scheduleFollowup(conversationId, mem, productInfo, reply);
      console.log(`[${BOT_NAME}] Khách đòi/từ chối hãng khác -> trả J&T-only (chính sách cố định).`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }
    // (2) Khách hỏi/từ chối CK trước hoặc muốn COD:
    //     - Câu MẶC CẢ (CK trước XIN GIẢM) -> chuyện deal -> NGƯỜI THẬT.
    //     - Còn lại -> TRẤN AN COD (chính sách chuẩn: nhận hàng kiểm tra rồi trả, không bắt CK trước).
    if (questionsOrRefusesPrepay(latestText)) {
      // Khách XIN GIẢM (kể cả "CK trước có được giảm") = CHÊ GIÁ -> THUYẾT PHỤC giá niêm yết + freeship
      // (shop bán giá niêm yết, KHÔNG đẩy người thật).
      if (asksDiscount(latestText) || _aiDiscount) {
        const reply = productInfo
          ? buildDiscountReply(productInfo, mem)
          : "Dạ bên em bán theo giá niêm yết nên ít khi giảm lắm chị ạ, bù lại đơn trên 500k em freeship cho mình nha";
        await sendInboxMessage(conversationId, reply);
        scheduleFollowup(conversationId, mem, productInfo, reply);
        console.log(`[${BOT_NAME}] Khách CK trước + xin giảm -> thuyết phục giá niêm yết (không đẩy người thật).`);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // Còn lại: hỏi/từ chối CK trước, muốn COD -> TRẤN AN COD (chính sách chuẩn).
      const reply = "Dạ bên em ship COD, chị nhận hàng kiểm tra rồi thanh toán ạ, mình không cần chuyển khoản trước đâu nha";
      await sendInboxMessage(conversationId, reply);
      scheduleFollowup(conversationId, mem, productInfo, reply);
      console.log(`[${BOT_NAME}] Khách hỏi/từ chối CK trước -> trấn an COD (chính sách chuẩn).`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    if (asksShippingCarrier(latestText) || _ai("SHIPPING_CARRIER")) {
      const reply = "Dạ đơn gửi qua J&T chị nha, giao toàn quốc và cho kiểm hàng trước khi trả tiền ạ";
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi đơn vị vận chuyển -> J&T (không follow-up lan man).`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // Khách muốn SHOP QUA TẬN NƠI LẤY hàng để đổi (không muốn đi ship) -> NGƯỜI THẬT (không tự hứa).
    if (wantsShopComePickup(latestText)
        && (/(đổi|trả|lấy lại|nhận lại|hàng)/.test(latestText) || mem.exchangeStage || mem.exchangeGuided)) {
      const reply = "Dạ phần này để em nhờ bạn phụ trách bên em hỗ trợ và sắp xếp trực tiếp cho mình nha ạ";
      await sendInboxMessage(conversationId, reply);
      await tagChoXuLyVaUnread(conversationId);
      mem.botHandoffAt = Date.now(); mem.lastBotReply = reply;
      console.log(`[${BOT_NAME}] Khách muốn shop qua tận nơi lấy hàng đổi -> NGƯỜI THẬT.`);
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    if (wantsToExchange(latestText)
        || (mem.exchangeStage && /đổi|ship|gửi (hàng|lại|về)|bill|phí|lỗi|rộng|chật|nóng|dày|mỏng|lộ|màu|không vừa|ko vừa|hỗ trợ|như nào|thế nào|kiểu gì|ra sao|vẫn|muốn đổi|địa chỉ|gửi (về )?đâu|chỗ nào|về đâu/i.test(latestText))) {
      // CÂU MỞ ĐẦU ĐỔI MỚI ("muốn đổi hàng", "nhận hàng rồi muốn đổi"...) -> RESET luồng cũ, làm lại từ đồng cảm
      // (tránh: lần đổi trước đã set exchangeGuided -> giờ tưởng "đi sâu" -> đẩy người thật oan).
      const _freshExchange = /(muốn đổi|đổi hàng|nhận (hàng|đc|được).{0,20}(muốn )?đổi|gửi (về )?(lại )?đổi|đổi cho (chị|c|mình))/i.test(latestText);
      if (_freshExchange && (mem.exchangeGuided || mem.exchangeStage)) {
        mem.exchangeGuided = false; mem.exchangeStage = null;
      }
      // Đã hướng dẫn xong + khách hỏi TIẾP chi tiết (phí/bill/ship... KHÔNG phải mở đổi mới) -> NGƯỜI THẬT.
      if (mem.exchangeGuided) {
        await tagChoXuLyVaUnread(conversationId);
        console.log(`[${BOT_NAME}] Đổi hàng đi sâu (sau hướng dẫn) -> thẻ AI-CHỜ XLY cho người thật.`);
        mem.lastBotReply = HUMAN_CHECK_REPLY; mem.botHandoffAt = Date.now();
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // Khách HỎI CHUNG "đổi hàng như nào" mà CHƯA mua / CHƯA nhận hàng -> trả CHÍNH SÁCH 15 ngày + điều kiện,
      // KHÔNG đưa địa chỉ gửi-về (đó là bước cho khách ĐÃ nhận hàng).
      const _receivedCtx = mem.orderClosed || asksExchangeReceived(latestText) || mem.exchangeStage
        || /(đã nhận|nhận hàng rồi|nhận được hàng|mua rồi|đã mua|mặc rồi|nhận rồi|hàng về rồi|bị (rộng|chật|lỗi|sai)|rộng quá|chật quá|lỗi rồi)/i.test(latestText);
      if (!_receivedCtx) {
        const reply = "Dạ bên em hỗ trợ đổi hàng trong vòng 15 ngày chị nha, điều kiện sản phẩm chưa qua sử dụng và còn nguyên tem mác ạ";
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Hỏi "đổi hàng như nào" (chưa mua/chưa nhận) -> trả CHÍNH SÁCH 15 ngày (không đưa địa chỉ gửi về).`);
        scheduleFollowup(conversationId, mem, productInfo, reply);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      const reason = exchangeReason(latestText);
      const sendGuide = async () => {
        const parts = buildExchangeGuide();
        for (let i = 0; i < parts.length; i++) {
          await sendInboxMessage(conversationId, parts[i]);
          if (i < parts.length - 1) await new Promise(r => setTimeout(r, 600));
        }
        mem.exchangeGuided = true;
        mem.lastBotReply = parts[parts.length - 1];
      };
      // (A) Chê CHẤT nóng/dày -> ĐỒNG CẢM + giải thích (giữ khách), CHƯA đưa địa chỉ.
      if (reason === "hot") {
        const reply = "Dạ em xin lỗi vì chất chưa đúng ý chị. Chị cho em hỏi chị thấy chất bị sao ạ — mỏng, thô hay nóng? Để em tư vấn đúng cho chị nha. Thường mẫu này vải hơi đứng form nên mới giữ dáng đẹp, mặc vài lần giặt sẽ mềm hơn đó chị.";
        await sendInboxMessage(conversationId, reply);
        mem.exchangeStage = "reassured"; mem.lastBotReply = reply;
        console.log(`[${BOT_NAME}] Đổi hàng: chê chất nóng/dày -> đồng cảm + giải thích (giữ khách).`);
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // (B) Sợ CHẤT mỏng/lộ -> ĐỒNG CẢM + giải thích vải mát + gợi ý lớp lót (giữ khách).
      if (reason === "thin") {
        const reply = "Dạ em xin lỗi vì chất chưa đúng ý chị. Mẫu này vải mỏng nhẹ là để mặc mát, thoáng, không bí nóng đó chị — kiểu vải mùa hè ạ. Nếu chị sợ lộ thì mặc kèm lớp lót bên trong là kín đáo mà vẫn mát, lên dáng rất xinh luôn.";
        await sendInboxMessage(conversationId, reply);
        mem.exchangeStage = "reassured"; mem.lastBotReply = reply;
        console.log(`[${BOT_NAME}] Đổi hàng: sợ chất mỏng/lộ -> đồng cảm + giải thích (giữ khách).`);
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // (C) SIZE rộng/chật -> ĐỒNG CẢM + đề nghị đổi đúng size, RỒI đưa hướng dẫn gửi hàng.
      if (reason === "loose" || reason === "tight" || reason === "sizemisc") {
        const dir = reason === "tight" ? "lên size lớn hơn cho chị mặc thoải mái"
          : reason === "loose" ? "xuống size nhỏ hơn cho ôm vừa dáng"
            : "sang size vừa hơn cho chị";
        const reply = `Dạ em xin lỗi vì size chưa vừa ý chị. Chị gửi lại hàng, em đổi cho chị ${dir} nha chị.`;
        await sendInboxMessage(conversationId, reply);
        await new Promise(r => setTimeout(r, 600));
        await sendGuide();
        console.log(`[${BOT_NAME}] Đổi hàng: lý do SIZE (${reason}) -> đồng cảm + hướng dẫn gửi hàng.`);
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // (D) CHƯA RÕ lý do và CHƯA hỏi -> ĐỒNG CẢM + HỎI form/màu/chất (chưa đưa địa chỉ).
      if (mem.exchangeStage !== "asked") {
        const reply = "Dạ chị nhận hàng rồi mà chưa ưng ạ. Chị cho em xin biết món chưa ổn ở đâu — form, màu hay chất vải ạ? Chị nói em nghe để em hỗ trợ chị tốt nhất nha.";
        await sendInboxMessage(conversationId, reply);
        mem.exchangeStage = "asked"; mem.lastBotReply = reply;
        console.log(`[${BOT_NAME}] Đổi hàng: chưa rõ lý do -> đồng cảm + hỏi form/màu/chất.`);
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // (E) Đã hỏi/đã trấn an mà khách VẪN muốn đổi (hoặc lý do màu) -> đưa hướng dẫn gửi hàng.
      await sendGuide();
      console.log(`[${BOT_NAME}] Đổi hàng: khách vẫn muốn đổi -> hướng dẫn gửi hàng (2 tin).`);
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }
    // ===== CÂU LO LẮNG / NHẮN NHỦ / ACK (chủ yếu SAU CHỐT) -> trả lời NGẮN-ẤM, KHÔNG stall, KHÔNG hướng dẫn trả hàng =====
    {
      const _noUpsellPending = !mem.pendingUpsell || !mem.pendingUpsell.length;
      // (0) KHÁCH LO VỀ TÔNG MÀU: sợ màu SÁNG quá / sợ màu TỐI quá không hợp -> trấn an theo tông.
      //  Ưu tiên nhãn AI concern (mau_sang / mau_toi); lưới regex phụ khi AI bí. Điền {màu} theo màu đang tư vấn.
      {
        const _twl = String(latestText || "").toLowerCase();
        const _worryTok = /(sợ|lo\b|ngại|kén|ko hợp|không hợp|hợp ko|hợp không|có hợp|liệu|nhìn già|hơi già|bị già|sến|đứng tuổi|chói quá|nổi quá)/;
        const _brightTok = /(màu\s*)?(sáng|nhạt|chói|nhợt|lòe loẹt|tươi quá|nổi quá)/;
        const _darkTok = /(màu\s*)?(tối|trầm|đen|sẫm|thẫm|đậm|xỉn)/;
        const _cwBright = mem._aiConcern === "mau_sang" || (_brightTok.test(_twl) && _worryTok.test(_twl));
        const _cwDark = mem._aiConcern === "mau_toi" || (_darkTok.test(_twl) && _worryTok.test(_twl));
        if ((_cwBright || _cwDark) && productInfo && !priceAsk && !asksSizeChart(latestText)) {
          const _cwCode = _codeUp(productInfo);
          const _cwColor = (mem.sourceColorByCode || {})[_cwCode] || (mem.colorByCode || {})[_cwCode] || null;
          const _tonPhrase = _cwColor ? `tông ${_cwColor} này` : `tông màu này`;
          const reply = _cwDark
            ? `Dạ chị yên tâm, ${_tonPhrase} tuy trầm nhưng lại rất sang và dễ phối đồ ạ. Màu tối mặc lên nhìn tinh tế, gọn gàng, mà lại tôn dáng nữa — nhiều chị chuộng vì mặc đi đâu cũng hợp đó chị.`
            : `Dạ chị yên tâm, ${_tonPhrase} là màu sáng nhưng dịu, không bị chói nên rất dễ mặc và tôn da ạ 💕 mặc lên rồi lại mê vì trông tươi tắn, trẻ trung hơn hẳn đó chị.`;
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] Khách lo TÔNG MÀU (${_cwDark ? "tối" : "sáng"}) mẫu ${_cwCode}${_cwColor ? " màu " + _cwColor : ""} -> trấn an tông màu.`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
      }
      // (1) Lo mặc có HỢP DÁNG/tông da không -> trấn an LOOK, KHÔNG lôi size. Điều phối theo NHÃN AI FIT_SUITABILITY
      //  (đã tách: bầu->PREGNANCY_FIT, sợ-không-vừa->SIZE_ADVICE). regex worriesAboutLook là lưới phụ khi AI bí.
      // [FIX Phuong Pham] CHỈ trấn an khi mẫu ĐANG xét ĐÃ được báo giá trong luồng. Nếu khách vừa SWITCH sang
      //   mẫu MỚI chưa báo giá (vd "tư vấn thiết kế Giannal" trong khi đang khoá mẫu khác) -> KHÔNG trấn an suông,
      //   để rớt xuống luồng BÁO GIÁ mẫu mới trước. (Tránh: hỏi Giannal -> bot nói "mẫu này dễ mặc" mà chưa báo giá.)
      const _fitCode = _codeUp(productInfo);
      const _fitModelQuoted = !!(_fitCode && (quotedRecently(mem, _fitCode) || pricedInThread(data.messages, productInfo)));
      if ((_ai("FIT_SUITABILITY") || worriesAboutLook(latestText)) && !priceAsk && !asksSizeChart(latestText)
          && _fitModelQuoted) {
        // Lo HỢP DÁNG/phom + mẫu CÓ nghệ sĩ diện -> gửi ẢNH NGHỆ SĨ thuyết phục (1 lần/mã).
        if (await maybeSendCelebPitch(conversationId, productInfo, mem)) {
          updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        // 3 BIẾN THỂ theo thông tin ĐÃ có:
        //  (1) có SỐ ĐO 3 vòng (ngực/eo/hông) -> "với số đo của chị..."
        //  (2) có CÂN NẶNG hoặc SIZE -> "với thông số của chị..."
        //  (3) KHÔNG có gì -> trấn an + XIN chiều cao/cân nặng để tư vấn.
        let reply;
        if (mem.measure3V) {
          reply = "Dạ chị yên tâm ạ, mẫu này khá dễ mặc và không kén dáng đâu ạ. Với số đo của chị thì em tự tin chị mặc sẽ rất đẹp ạ";
        } else if (mem.weightKg || mem.customerSize) {
          reply = "Dạ chị yên tâm ạ, mẫu này khá dễ mặc và không kén dáng đâu ạ. Với thông số của chị thì em tự tin chị mặc sẽ rất đẹp ạ";
        } else {
          reply = "Dạ chị yên tâm ạ, mẫu này khá dễ mặc và không kén dáng đâu ạ. Chị cho em xin chiều cao, cân nặng em tư vấn cho mình nhe";
        }
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Khách lo MẶC CÓ HỢP/ĐẸP (look) -> trấn an dáng (${mem.measure3V ? "có số đo" : (mem.weightKg || mem.customerSize) ? "có thông số" : "xin cao/nặng"}).`);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // (2) HỎI nếu không vừa thì trả/đổi được không -> trấn an ĐỔI size/mẫu + động viên nhận hàng (KHÔNG hướng dẫn trả hàng, KHÔNG tag ưu tiên).
      if (asksReturnIfNotFit(latestText) && !_nhanCamRegex(mem, "asksReturnIfNotFit", ["RETURN_POLICY", "EXCHANGE_REQUEST"])) {
        const reply = "Dạ chị yên tâm nha ạ, khi nhận hàng mình được kiểm tra sản phẩm trước khi thanh toán. Nếu nhận hàng có vấn đề về size em vẫn hỗ trợ đổi size hoặc đổi sang mẫu khác cho mình chị nha";
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Khách HỎI đổi nếu không vừa -> trấn an đổi size/mẫu (KHÔNG tag ưu tiên).`);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // (3) SAU CHỐT: lời NHẮN NHỦ thân thiện -> handler tổng (5) lo (AI tự do có khung). Ở đây chỉ xử khi CHƯA chốt.
      if (!mem.everOrdered && mem.orderClosed && _noUpsellPending && isFriendlyRemark(latestText)) {
        const reply = "Dạ chị iu cứ yên tâm nha, em sẽ kiểm hàng kỹ và đóng gói cẩn thận gửi chị ạ";
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Sau chốt: nhắn nhủ -> trả lời ấm, ngắn.`);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // (4) SAU CHỐT: ACK thuần -> handler tổng (5) lo. Chỉ xử riêng ca asksPaymentReceived (đã có nhánh khác).
      // (5) SAU CHỐT: câu KHEN VUI / TÁM ("chốt nhanh thế", "nhiệt tình ghê") -> trả lời ấm, ngắn (KHÔNG hỏi lấy thêm).
      // ===== TRÒ CHUYỆN SAU CHỐT (AI TỰ DO CÓ KHUNG) =====
      // Đơn ĐÃ chốt (everOrdered, không phụ thuộc orderClosed bị reset) + khách chỉ XÃ GIAO TRƠ
      // (ok/vâng/cảm ơn/khen) -> 1 câu ấm: cảm ơn -> trấn an bước tiếp -> chúc. KHÉP hội thoại, KHÔNG mở bán mới.
      // ===== [KỊCH BẢN 4 NHÃN RỖNG 2026-07-11] Nhãn có trong bộ phân loại nhưng trước đây KHÔNG handler
      // nào nhận -> rớt xuống gắn người vô lý. Bổ sung kịch bản đúng phận từng nhãn: =====
      // (1) WAITING_REPLY — khách giục "shop ơi sao chưa rep" -> xin lỗi + mời nêu lại, KHÔNG im, KHÔNG tag.
      if (_ai("WAITING_REPLY") && !customerGaveContact(latestText)) {
        const _wrReply = "Dạ em đây ạ, em xin lỗi để chị chờ lâu 🥰 Chị cần em hỗ trợ thêm về mẫu, size hay giá thì chị nhắn giúp em, em tư vấn cho mình ngay ạ.";
        await sendInboxMessage(conversationId, _wrReply);
        console.log(`[${BOT_NAME}] Nhãn WAITING_REPLY -> xin lỗi + mời nêu lại nhu cầu.`);
        mem.lastBotReply = _wrReply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // (2) CONSULT_FAMILY — "để hỏi chồng/hỏi mẹ đã" = hẹn sau kiểu gia đình -> lùi nhẹ giữ cửa, không bám đuổi.
      if (_ai("CONSULT_FAMILY") && !customerGaveContact(latestText)) {
        const _cfReply = "Dạ vâng ạ, chị cứ trao đổi thêm với người nhà nha. Mẫu này bên em đang được nhiều khách chọn vì phom lên rất xinh, khi nào mình quyết chị nhắn em, em giữ tư vấn cho mình nhé ạ 🥰";
        await sendInboxMessage(conversationId, _cfReply);
        console.log(`[${BOT_NAME}] Nhãn CONSULT_FAMILY -> lùi nhẹ giữ cửa (kiểu hẹn sau).`);
        mem.lastBotReply = _cfReply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // (3) PRICE_DISCREPANCY — khách thắc mắc GIÁ LỆCH (ad ghi khác / thấy giá cũ): chuyện tiền -> bot KHÔNG
      // tự phân xử; giữ khách 1 câu + gắn người kiểm tra, kèm ghi chú cho nhân viên.
      if (_ai("PRICE_DISCREPANCY")) {
        const _pdReply = "Dạ chị chờ em xíu, em kiểm tra lại giá chính xác của mẫu cho mình ngay ạ, có gì em báo chị liền nha 🥰";
        await sendInboxMessage(conversationId, _pdReply);
        await tagChoXuLyVaUnread(conversationId);
        try { await addConversationNote(conversationId, `⚠️ Khách thắc mắc GIÁ LỆCH ("${String(latestText || "").slice(0, 60)}") -> nhờ người thật đối chiếu giá ad/sheet và trả lời.`); } catch (_) {}
        mem.botHandoffAt = Date.now();
        console.log(`[${BOT_NAME}] Nhãn PRICE_DISCREPANCY -> giữ khách + gắn người đối chiếu giá (chuyện tiền không tự phân xử).`);
        mem.lastBotReply = _pdReply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // (4) MULTI_MODEL — khách ưng NHIỀU mẫu cùng lúc, chưa chốt riêng 1 -> tư vấn CHUNG cả cụm + dẫn về size.
      if (_ai("MULTI_MODEL") && (mem.quotedProducts || []).length >= 2 && !customerGaveContact(latestText)) {
        const _mmN = (mem.quotedProducts || []).length;
        const _mmReply = mem.customerSize
          ? `Dạ cả ${_mmN} mẫu chị đang xem đều có sẵn ạ, chị ưng mẫu nào (hoặc lấy cả ${_mmN}) chị nhắn em, em lên đơn size ${_sizeShort(mem.customerSize)} cho mình luôn nha 🥰`
          : `Dạ cả ${_mmN} mẫu chị đang xem đều có sẵn ạ. Chị cho em xin chiều cao cân nặng để em tư vấn size chuẩn, chị ưng mẫu nào em lên đơn mẫu đó cho mình nha 🥰`;
        await sendInboxMessage(conversationId, _mmReply);
        console.log(`[${BOT_NAME}] Nhãn MULTI_MODEL -> tư vấn CHUNG cụm ${_mmN} mẫu, dẫn về size, không khoá 1 mẫu.`);
        mem.lastBotReply = _mmReply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // CẤM: báo giá/đọc lại tiền, mời mẫu mới/upsell, hỏi kéo dài, hứa giờ giao cụ thể.
      if ((mem.everOrdered || mem.orderClosed) && _noUpsellPending
          && !asksPaymentReceived(latestText) && !_ai("PAYMENT_CONFIRM") && !_ai("CK_PROOF")
          && (isPostOrderChitChat(latestText) || isBareAck(latestText) || isAffirmation(latestText) || isFriendlyRemark(latestText) || _ai("THANKS") || _ai("POST_ORDER_CHITCHAT"))) {
        // GIỚI HẠN LƯỢT: đã đáp 1 câu đóng rồi mà khách vẫn ack trơ -> IM, tránh lải nhải.
        if (mem._postChotClosed && (isBareAck(latestText) || isAffirmation(latestText))) {
          console.log(`[${BOT_NAME}] Sau chốt: khách ack tiếp -> IM (đã đáp câu đóng).`);
          mem.skipUpd = _curUpd;   // đã xử (IM có chủ đích) -> khỏi đọc lại mỗi vòng dù conv còn chưa đọc
          markProcessed(batch); updateConversationState(conversationId, mem); return true;
        }
        // CHỌN CÂU THEO NGỮ CẢNH (không xoay vòng ngẫu nhiên):
        const _tl = String(latestText || "").toLowerCase();
        const _saysBye = /(tạm biệt|bye|chào (em|shop)|ngủ ngon|good ?night|đi ngủ|tối rồi)/i.test(_tl);
        // [FIX Shuixian Yu] CHỈ coi là KHEN khi có tín hiệu khen THẬT (từ khen / nhận xét gửi hàng đẹp).
        //   "Ok/vâng" tuy AI gắn POST_ORDER_CHITCHAT nhưng KHÔNG phải khen -> bỏ nhãn đó + loại bare-ack.
        const _praise = (isPostOrderChitChat(latestText) || isFriendlyRemark(latestText)
          || /(nhiệt tình|dễ thương|đáng yêu|tốt|giỏi|kỹ|chu đáo|tận tình)/i.test(_tl))
          && !isBareAck(latestText) && !isAffirmation(latestText);
        // Mua đồ cho DỊP (đi tiệc/đi chơi/Tết/cưới) -> dựa vào cờ dịp đã ghi nhận hoặc text đơn.
        const _occasion = mem._boughtForOccasion
          || /(đi tiệc|dự tiệc|đám cưới|ăn hỏi|đi chơi|du lịch|đi biển|tết|sinh nhật|sự kiện)/i.test(_tl);
        const _justAck = isBareAck(latestText) || isAffirmation(latestText) || _ai("THANKS");

        let reply;
        if (_occasion) {
          reply = "Dạ chúc chị diện đồ thật xinh và có buổi tiệc/chuyến đi thật vui nha 🥰 Hàng về mình mặc thử thấy ưng thì cho shop xin ít phản hồi với ạ!";
        } else if (_saysBye) {
          reply = "Dạ em cảm ơn chị đã tin tưởng shop ạ 🥰 Chúc chị buổi tối vui vẻ, hàng về ưng ý nhớ quay lại shop nha!";
        } else if (_praise) {
          reply = "Dạ được hỗ trợ chị là em vui rồi ạ 🥰 Chị mặc đẹp nhớ quay lại shop nha, có mẫu mới em báo chị sớm ạ!";
        } else if (isBareAck(latestText) || isAffirmation(latestText) || _ai("POST_ORDER_CHITCHAT")) {
          // [Bổ sung kịch bản POST_ORDER_CHITCHAT] Khách chỉ "ok/vâng" = kết thúc hội thoại -> đáp GỌN.
          reply = "Dạ vâng ạ";
        } else {
          // lần đầu sau chốt + tin CÓ nội dung (không phải ack) -> cảm ơn + trấn an đơn đang xử lý
          reply = "Dạ em cảm ơn chị nhiều nha 🥰 Đơn của mình shop đóng gói gửi đi, shipper sẽ liên hệ chị khi giao ạ. Chị nhận hàng ưng ý nhớ ủng hộ shop dài dài nha!";
        }
        await sendInboxMessage(conversationId, reply);
        mem._postChotClosed = true;   // đánh dấu đã đáp câu đóng -> lượt ack sau thì im
        console.log(`[${BOT_NAME}] Sau chốt (AI tự do có khung): câu ấm khép hội thoại, không bán mới.`);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
    }

    // ===== QUY TẮC BÁO GIÁ + TRẢ LỜI: khách GỬI ẢNH 1 mẫu kèm CÂU HỎI (không phải hỏi giá/chốt/đưa thông tin),
    //        mà mẫu CHƯA báo giá trong 24h -> BÁO GIÁ + 3 ẢNH 1 LẦN (ghi thời gian), RỒI để handler câu hỏi trả lời tiếp.
    //        (Trong 24h mỗi mẫu chỉ báo giá 1 lần; ảnh trơ / hỏi giá -> §13 lo; đang chốt/đưa contact -> bỏ qua.)
    let _preQuotedNow = false;
    {
      const _hasText = !!(latestText && latestText.replace(/[^\p{L}\p{N}]/gu, "").length >= 2);
      const _closingNow = !!(parseWeightKg(latestText) || parse3V(latestText) || extractStatedSize(latestText)
        || mem._addrJustGiven || customerWantsToOrder(latestText, mem.lastIntent)
        || /(?<!\d)(?:0|\+?84)\d[\d\s.\-]{7,}\d(?!\d)/.test(latestText));
      const _codeQ = _codeUp(productInfo);
      if (thisTurn.length === 1 && imageCount > 0 && productInfo && _hasText
          && !priceAsk
          && !_closingNow
          && !quotedRecently(mem, _codeQ)
          && !(mem.orderedByCode && mem.orderedByCode[_codeQ])
          && !recommend.isOutOfStock(productInfo)) {
        const _plQ = priceLine(productInfo);
        if (_plQ) {
          const _openerQ = buildCommentOpener(productInfo, mem);   // "Dạ <mẫu> giá ...đ ạ." + dẫn dắt size
          await sendInboxMessage(conversationId, _openerQ);
          markPriced(mem, _codeQ);
          await maybeSendImages(conversationId, productInfo.code, mem, true);
          _preQuotedNow = true;
          // 2 SP: khách bấm ADS mẫu KHÁC -> báo LIỀN mẫu ADS đang ghim ngay sau mẫu ảnh khách.
          if (mem.pendingAdQuote && String(mem.pendingAdQuote).toUpperCase() !== _codeQ) {
            const _pc2 = String(mem.pendingAdQuote).toUpperCase();
            try {
              if (!quotedRecently(mem, _pc2)) {
                const _cc2 = await ensureCatalog();
                const _pp2 = _cc2.byCode.get(_pc2);
                if (_pp2 && !recommend.isOutOfStock(_pp2)) {
                  await delay(700);
                  const _po2 = buildCommentOpener(_pp2, mem);
                  await sendInboxMessage(conversationId, _po2);
                  markPriced(mem, _pc2);
                  if (!mem.quotedProducts) mem.quotedProducts = [];
                  if (!mem.quotedProducts.some(x => String(x.code || "").toUpperCase() === _pc2)) mem.quotedProducts.push(_pp2);
                  await maybeSendImages(conversationId, _pc2, mem, true);
                  mem.lastBotReply = _po2;
                  console.log(`[${BOT_NAME}] Báo LIỀN mẫu ADS đang ghim ${_pc2} ngay sau mẫu ảnh ${_codeQ} (coi như 2 SP).`);
                }
              }
            } catch (e) { console.log("[pendingAd] lỗi:", e.message); }
            mem.pendingAdQuote = null;
          }
          console.log(`[${BOT_NAME}] Ảnh mẫu mới ${_codeQ} chưa báo giá 24h + có câu hỏi -> BÁO GIÁ + ảnh TRƯỚC, rồi trả lời câu hỏi.`);
          updateConversationState(conversationId, mem);
          // KHÔNG return -> handler câu hỏi bên dưới (còn hàng/chất liệu/màu...) trả lời tiếp.
        }
      }
    }

    // ===== KHÁCH HỎI "CÓ HÀNG SẴN KHÔNG" -> xác nhận có sẵn + CÂU HÀNH ĐỘNG (KHÔNG liệt kê size) =====
    if ((_aiOr(asksInStock(latestText), "STOCK")) && productInfo && !recommend.isOutOfStock(productInfo)
        && !asksInStockOrPreorder(latestText)
        && !asksWhichSpecificSize(latestText)   // "có XL không" = hỏi mẫu CÓ size đó không -> để handler đối chiếu BẢNG SIZE (dưới), KHÔNG tự "lên đơn size XL"
        && !asksBreastPad(latestText) && !wantsBackView(latestText)) {
      // Hỏi có sẵn Ở CỬA HÀNG / showroom / cơ sở -> bot KHÔNG nắm tồn tại cửa hàng -> nhường người thật (AI-CHỜ XL).
      if (/(cửa hàng|cua hang|\bch\b|show ?room|cơ sở|cơ sỡ|co so|chi nhánh|chi nhanh|tại (shop|store)|ở (shop|store))/i.test(latestText)) {
        await tagChoXuLyVaUnread(conversationId);
        console.log(`[${BOT_NAME}] Hỏi hàng sẵn TẠI CỬA HÀNG (${productInfo.code}) -> AI-CHỜ XL (bot không nắm tồn CH).`);
        mem.lastBotReply = HUMAN_CHECK_REPLY; mem.botHandoffAt = Date.now();
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      const needSize = orderNeedsSize(mem, productInfo);
      const haveSize = mem.customerSize && mem.customerSize !== "FREESIZE";
      const _hasContact = mem.phone && mem.address;   // [NGUYÊN TẮC] CHỈ mời "lên đơn" khi đủ size + sđt + địa chỉ; thiếu -> xin contact
      const _askedSize = /\bsize\b|\bsai\b|cỡ\b/i.test(latestText);   // khách hỏi THẲNG về size -> trả lời bám "có size của chị"
      let reply;
      // 2+ mẫu đang xét mà khách hỏi "mẫu nào có sẵn" -> xác nhận CẢ N mẫu đều sẵn, KHÔNG đẩy đơn 1 mẫu/size.
      // [FIX Tuệ Oanh 2026-07-07] Khách MỞ ĐẦU bằng ảnh + "còn ko" (CHƯA từng được báo giá) mà chỉ trả
      // "có sẵn ạ" trống trơn là hụt nhịp bán hàng -> mẫu nào CHƯA báo giá thì kèm luôn TÊN + GIÁ, và
      // ghi nhận đã-báo-giá để lượt sau không báo đè.
      if (Array.isArray(mem.quotedProducts) && mem.quotedProducts.length >= 2) {
        const n = mem.quotedProducts.length;
        const _unpriced = mem.quotedProducts.filter(p => p && p.code && !(mem.pricedCodes || []).includes(String(p.code).toUpperCase()));
        let _priceLine = "";
        if (_unpriced.length) {
          _priceLine = " " + _unpriced.map(p => `${productLabel(p)} giá ${_fmtMoney(p.price)}đ`).join(", ") + ".";
          mem.pricedCodes = mem.pricedCodes || [];
          for (const p of _unpriced) { const k = String(p.code).toUpperCase(); if (!mem.pricedCodes.includes(k)) mem.pricedCodes.push(k); }
        }
        if (_askedSize) reply = haveSize
          ? `Dạ cả ${n} mẫu này đều có sẵn size ${mem.customerSize} của chị đó ạ,${_priceLine ? _priceLine + " Chị" : " chị"} lấy cả ${n} đúng không ạ?`
          : `Dạ cả ${n} mẫu này đều có đủ size cho chị đó ạ,${_priceLine} chị cho em xin size (hoặc cao/nặng) để em tư vấn cho mình nha`
        else reply = `Dạ cả ${n} mẫu bên em đều có sẵn ạ,${_priceLine ? _priceLine + " Chị" : " chị"} lấy cả ${n} đúng không ạ?`;
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Hỏi ${_askedSize ? "có SIZE" : "có sẵn"} với ${n} mẫu -> xác nhận CẢ ${n} mẫu${_unpriced.length ? " + BÁO GIÁ " + _unpriced.length + " mẫu chưa báo" : ""} (không đẩy đơn 1 mẫu).`);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      if (_preQuotedNow) reply = "Dạ mẫu này có sẵn ạ";   // vừa báo giá ở trên (đã dẫn size) -> chỉ xác nhận sẵn, không hỏi size lại
      else if (_askedSize && haveSize) reply = _hasContact
        ? `Dạ mẫu này có sẵn size ${mem.customerSize} của chị ạ, em lên đơn cho mình nha`
        : `Dạ mẫu này có sẵn size ${mem.customerSize} của chị ạ. Chị cho em xin số điện thoại và địa chỉ để em lên đơn cho mình nha?`;
      else if (_askedSize) reply = "Dạ mẫu này có đủ size cho chị ạ, chị mặc size bao nhiêu để em tư vấn cho mình ạ?";
      else if (!needSize) reply = _hasContact
        ? "Dạ hàng có sẵn chị ạ, em lên đơn cho mình nha"
        : "Dạ hàng có sẵn chị ạ. Chị cho em xin số điện thoại và địa chỉ để em lên đơn cho mình nha?";
      else if (haveSize) reply = _hasContact
        ? `Dạ hàng có sẵn chị ạ, em lên đơn size ${mem.customerSize} cho mình nhe ạ`
        : `Dạ hàng có sẵn chị ạ. Chị cho em xin số điện thoại và địa chỉ để em lên đơn size ${mem.customerSize} cho mình nha?`;
      else reply = "Dạ hàng có sẵn chị ạ, chị thường mặc size bao nhiêu (hoặc cho em xin cao/nặng) để em tư vấn cho mình ạ";
      // QUY TẮC: mã CHƯA TỪNG báo giá -> BÁO GIÁ trước rồi mới trả lời (kể cả đang trả lời câu hỏi khác). _preQuotedNow = vừa báo ở trên rồi.
      const _slUp = String(productInfo.code || "").toUpperCase();
      const _slPl = priceLine(productInfo);
      const _slNotQuoted = _slPl && !quotedRecently(mem, productInfo.code) && !(mem.pricedCodes || []).some(c => String(c).toUpperCase() === _slUp);
      const _slQuoteNow = _slNotQuoted && !_preQuotedNow;
      if (_slQuoteNow) {
        reply = `Dạ ${productLabel(productInfo)} ${_slPl}, ${reply.replace(/^Dạ\s*/i, "")}`;
        markPriced(mem, productInfo.code);
      }
      await sendInboxMessage(conversationId, reply);
      // [FIX Ngo Kim Anh] BÁO GIÁ lần đầu trong nhánh "hàng sẵn" -> GỬI KÈM ẢNH (trước giờ chỉ báo giá CHỮ, thiếu ảnh).
      //   force=false -> nếu ảnh đã gửi trước đó thì tự bỏ qua, không gửi đúp.
      if (_slQuoteNow) { try { mem._imgAllowSend = true; await maybeSendImages(conversationId, productInfo.code, mem, false); } catch (_) {} }
      console.log(`[${BOT_NAME}] Hỏi hàng sẵn (${productInfo.code}) -> xác nhận + ${haveSize ? "mời chốt" : (needSize ? "hỏi size" : "mời chốt")}.`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // (a2) "KO ƯNG ĐC ĐỔI KO" = hỏi chính sách đổi (KHÔNG phải đồng ý chốt) -> trả điều kiện đổi NGAY,
    //      ưu tiên cao, không bị chặn bởi exchangeGuided, chạy TRƯỚC mọi luồng chốt đơn.
    if (asksExchangeIfNotLike(latestText) && !_nhanCamRegex(mem, "asksExchangeIfNotLike", ["RETURN_POLICY", "EXCHANGE_REQUEST"])) {
      const reply = "Dạ chị yên tâm, bên em hỗ trợ đổi trong 15 ngày nha. Mình chỉ cần giữ sản phẩm chưa qua sử dụng và còn nguyên tem mác là đổi thoải mái ạ, có gì không vừa ý chị cứ nhắn em hỗ trợ liền.";
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi "ko ưng có đổi được không" -> trả chính sách đổi 15 ngày (không nhầm là chốt).`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // (a3) "SAO EM BIẾT CHỊ VỪA SIZE?" -> trả CĂN CỨ. Chỉ nói "chị đã cung cấp" khi ĐÚNG có dữ liệu;
    //      chưa có thì KHÔNG bịa -> xin chiều cao cân nặng để tư vấn chuẩn.
    if (asksHowKnowSize(latestText) && !_nhanCamRegex(mem, "asksHowKnowSize", ["SIZE_CHART", "SIZE_ADVICE"])) {
      let reply;
      if (mem.sizeFromCustomer && mem.customerSize) {
        reply = "Dạ trước đó chị có cung cấp size cho bên em khi tư vấn rồi nên em vẫn còn lưu thông tin ạ";
      } else if (mem.weightKg || mem.measure3V) {
        reply = "Dạ trước đó chị có cho em xin chiều cao cân nặng nên em tư vấn size vừa form cho mình ạ";
      } else {
        reply = "Dạ để tư vấn size chuẩn nhất, chị cho em xin chiều cao và cân nặng nha, em chọn size vừa form cho mình ạ";
        mem.customerSize = null;   // chưa có căn cứ -> KHÔNG khẳng định "vừa size X" nữa
      }
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi căn cứ biết size -> ${mem.sizeFromCustomer ? "đã cung cấp size" : (mem.weightKg ? "đã có cao/nặng" : "xin cao/nặng (không bịa)")}.`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // (b) HỎI CHÍNH SÁCH đổi (chưa chắc đã mua) -> trả lời điều kiện đổi, KHÔNG gửi hướng dẫn gửi hàng vội.
    if (asksExchangePolicy(latestText) && !mem.exchangeGuided) {
      const reply = "Dạ chị yên tâm, bên em hỗ trợ đổi trong 15 ngày nha. Mình chỉ cần giữ sản phẩm chưa qua sử dụng và còn nguyên tem mác là đổi thoải mái ạ, có gì không vừa ý chị cứ nhắn em hỗ trợ liền.";
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi CHÍNH SÁCH đổi -> trả lời điều kiện đổi.`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== GIỮ ĐƠN khi khách ĐỔI Ý / đòi huỷ (gần chốt) -> hỏi lý do rồi gỡ GIÁ/FORM, MỖI nhánh 1 lần; =====
    // sau đó nếu khách vẫn dứt khoát thì để cụm ĐƠN ƯU TIÊN bên dưới nhường người thật.
    {
      const _hasCtx = !!(productInfo || mem.orderClosed || (mem.quotedProducts || []).length);
      const _rLabel = productInfo ? productLabel(productInfo)
        : ((mem.quotedProducts || [])[0] ? productLabel(mem.quotedProducts[0]) : "mẫu này");
      // Khách quay lại MUỐN MUA -> bỏ trạng thái giữ đơn, để luồng chốt chạy.
      if (mem.retainStage && !wantsToCancelSoft(latestText)
          && (customerWantsToOrder(latestText, mem.lastIntent) || isAffirmation(latestText))) {
        mem.retainStage = null;
      } else if (_hasCtx && !isReturnRefund(latestText)) {
        // (1) Lần đầu đổi ý/đòi huỷ -> HỎI LÝ DO (giá hay form) để gỡ.
        if (!mem.retainStage && wantsToCancelSoft(latestText)) {
          const reply = "Dạ vâng, chị đổi ý là vì lăn tăn giá hay sợ form mặc lên không hợp ạ? Chị nói em nghe, biết đâu em gỡ được cho chị, chứ chị thích mà bỏ qua thì tiếc lắm";
          await sendInboxMessage(conversationId, reply);
          mem.retainStage = "asked";
          console.log(`[${BOT_NAME}] Khách đổi ý -> hỏi lý do (giữ đơn lần 1).`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        // (2) Đã hỏi lý do -> khách lăn tăn GIÁ -> dẫn giá trị + freeship (1 lần).
        if (mem.retainStage === "asked" && cancelReasonPrice(latestText) && !cancelReasonForm(latestText)) {
          const reply = `Dạ em hiểu mà chị. Nhưng ${_rLabel} là đồ thiết kế, mặc lên sang hơn giá tiền á chị — đi làm, đi chơi, đi tiệc đều lên dáng, mua một lần mặc được nhiều dịp nên tính ra rất đáng. Shop freeship cho chị nữa ạ.`;
          await sendInboxMessage(conversationId, reply);
          mem.retainStage = "offered";
          console.log(`[${BOT_NAME}] Giữ đơn: lý do GIÁ -> dẫn giá trị + freeship.`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        // (3) Đã hỏi lý do -> khách lo FORM -> trấn an dáng + kiểm tra hàng trước khi thanh toán (1 lần).
        if (mem.retainStage === "asked" && cancelReasonForm(latestText)) {
          const reply = `Dạ cái này chị yên tâm tuyệt đối nha${_rLabel} tôn dáng, người gầy hay đầy đặn mặc đều lên hết á chị. Mà để chị chắc chắn, mình được kiểm tra hàng trước khi thanh toán ạ, chị yên tâm nha`;
          await sendInboxMessage(conversationId, reply);
          mem.retainStage = "offered";
          console.log(`[${BOT_NAME}] Giữ đơn: lo FORM -> trấn an + kiểm tra hàng trước thanh toán.`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        // (4) Đã giữ rồi mà khách VẪN dứt khoát huỷ -> KHÔNG chặn ở đây; rơi xuống cụm ĐƠN ƯU TIÊN (nhường người thật).
      }
    }

    // ===== ĐƠN ƯU TIÊN (thẻ 185): cần gấp / ngày-giờ nhận cụ thể, hủy đơn, hoàn-trả hàng =====
    // -> không tự cam kết, gắn thẻ AI-ĐƠN ƯU TIÊN + chưa đọc để NV xử TRƯỚC. Chạy trước mọi thứ.
    if (isPriorityOrder(latestText)) {
      const why = priorityReason(latestText);
      await tagDonUuTienVaUnread(conversationId);
      // ĐÒI HỦY + đơn đang ở "ĐÃ XÁC NHẬN" (POS status=1) -> gắn THÊM thẻ "AI- Gửi đơn gấp" (206) để NV đẩy đơn gấp.
      if (isCancelOrder(latestText)) {
        try {
          const _phoneChk = mem.phone || (String(latestTextRaw || "").match(/(?:\+?84|0)(?:\d[\s.-]?){8,10}\d/) || [])[0] || null;
          if (posConfigured() && _phoneChk) {
            const _pageIdChk = String(conversationId).split("_")[0];
            const _rawChk = await getOrdersByPhone(_phoneChk);
            const _hasConfirmed = (_rawChk || []).some(o => Number(o.status) === 1 && (!_pageIdChk || String(o.page_id || "") === _pageIdChk));
            if (_hasConfirmed) { await tagGuiDonGap(conversationId); console.log(`ĐÒI HỦY + đơn ĐÃ XÁC NHẬN (status=1) -> gắn THÊM AI-Gửi đơn gấp (206).`); }
            else console.log(`ĐÒI HỦY nhưng KHÔNG có đơn status=1 (đã xác nhận) -> chỉ ĐƠN ƯU TIÊN.`);
          }
        } catch (e) { try { console.log("check 'đã xác nhận' để gắn Gửi đơn gấp lỗi:", e.message); } catch (_) {} }
      }
      console.log(`ĐƠN ƯU TIÊN (${why}) -> câu chờ + thẻ AI-ĐƠN ƯU TIÊN (185).`);
      mem.lastBotReply = HUMAN_CHECK_REPLY;
      mem.botHandoffAt = Date.now();
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH HỎI TRẠNG THÁI ĐƠN ("hàng của chị đến đâu rồi") -> TRA POS rồi trả lời =====
    // Khớp PAGE khách đang nhắn; CHỈ xét trạng thái 1/2/4/5; xử lý TÁCH ĐƠN (khách nhiều đơn).
    if (asksOrderStatus(latestText) || _ai("ORDER_STATUS")) {
      const phone = mem.phone || (latestTextRaw.match(/(?:\+?84|0)(?:\d[\s.-]?){8,10}\d/) || [])[0] || null;
      const handoff = async (logMsg) => {
        await tagChoXuLyVaUnread(conversationId);
        console.log(logMsg);
        mem.lastBotReply = HUMAN_CHECK_REPLY; mem.botHandoffAt = Date.now();
        updateConversationState(conversationId, mem); markProcessed(batch);
      };
      if (!posConfigured()) { await handoff("Hỏi trạng thái đơn nhưng POS chưa cấu hình -> thẻ AI-CHỜ XLY."); return true; }
      if (!phone) {
        const reply = "Dạ chị cho em xin số điện thoại đặt hàng để em kiểm tra đơn giúp mình nha ạ.";
        await sendInboxMessage(conversationId, reply);
        console.log("Hỏi trạng thái đơn nhưng chưa có SĐT -> xin SĐT.");
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // CHỈ lấy đơn CÙNG PAGE khách đang nhắn + đúng trạng thái cần báo (1 xác nhận, 2 đã gửi, 4/5 hoàn).
      const pageId = String(conversationId).split("_")[0];
      const RELEVANT = new Set([1, 2, 4, 5]);
      const raw = await getOrdersByPhone(phone);
      // [DEBUG CẤU TRÚC ĐƠN] in 1 đơn mẫu để xác định: mã trạng thái thật, field sản phẩm, field thời gian.
      // -> dùng để code chính xác phần "đủ điều kiện đổi hàng". Có thể bỏ sau khi đã chốt mapping.
      try {
        const s = (raw || [])[0];
        if (s) {
          const keys = Object.keys(s);
          const itemsKey = ["items", "order_items", "products", "order_products", "line_items"].find(k => Array.isArray(s[k]));
          console.log(`[POS DEBUG] đơn[0] keys: ${keys.join(",")}`);
          console.log(`[POS DEBUG] status=${JSON.stringify(s.status)} status_name=${JSON.stringify(s.status_name || s.sub_status || s.status_text || null)} inserted_at=${JSON.stringify(s.inserted_at)} updated_at=${JSON.stringify(s.updated_at)} confirmed_at=${JSON.stringify(s.confirmed_at || s.status_history || null)}`);
          if (itemsKey) console.log(`[POS DEBUG] items.field="${itemsKey}" | item[0]=${JSON.stringify((s[itemsKey] || [])[0] || null).slice(0, 600)}`);
          else console.log(`[POS DEBUG] KHÔNG thấy field danh sách sản phẩm trong đơn (keys ở trên).`);
        }
      } catch (_) {}
      const orders = (raw || []).filter(o =>
        RELEVANT.has(Number(o.status)) && (!pageId || String(o.page_id || "") === pageId)
      );
      if (!orders.length) { await handoff(`Tra đơn SĐT ${phone} (page ${pageId}): KHÔNG thấy đơn phù hợp -> thẻ AI-CHỜ XLY.`); return true; }

      const statuses = orders.map(o => Number(o.status));
      // (1) TÁCH ĐƠN: chỉ cần CÓ 1 đơn ĐÃ GỬI HÀNG (2) -> báo đã gửi.
      if (statuses.includes(2)) {
        const reply = "Dạ hàng của chị đã được gửi đi rồi ạ, chị chờ khoảng 2-3 ngày là nhận được nha.";
        await sendInboxMessage(conversationId, reply);
        console.log(`Tra đơn ${phone}: có đơn status=2 -> báo đã gửi.`);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // (2) Có đơn ĐANG/ĐÃ HOÀN (4/5): hàng giao không thành công, cần người thật xử lý (giao lại/liên hệ).
      if (statuses.some(s => s === 4 || s === 5)) { await handoff(`Tra đơn ${phone}: có đơn hoàn (4/5) -> thẻ AI-CHỜ XLY.`); return true; }
      // (3) Tất cả ĐÃ XÁC NHẬN (1): phân biệt khách VỪA đặt vs đã CHỜ mấy ngày.
      // Khách HỎI/GIỤC/THAN về đơn ĐÃ XÁC NHẬN -> gắn thêm "AI- Gửi đơn gấp" (206) để NV đẩy đơn.
      try { await tagGuiDonGap(conversationId); console.log(`Tra đơn ${phone}: đơn ĐÃ XÁC NHẬN (status=1) + khách hỏi/giục -> gắn AI-Gửi đơn gấp (206).`); } catch (_) {}
      const oldestAgeMs = Math.max(...orders.map(o => orderAgeMs(o)));
      const WAIT_MS = ORDER_WAIT_PERSUADE_DAYS * 24 * 3600 * 1000;
      let reply;
      if (oldestAgeMs >= WAIT_MS) {
        // Đã chờ mấy ngày mà chưa nhận -> thuyết phục, luân phiên 2 câu.
        const persuade = [
          "Dạ chị iu chờ thêm giúp em mấy hôm nữa nha, bên em đang gấp rút hoàn thiện để gửi đi rồi ạ.",
          "Dạ đơn hàng đợt này hơi quá tải nên bên em đang cố gắng nhanh nhất để gửi đến chị, mong chị thông cảm ạ."
        ];
        const i = (mem.orderWaitIdx || 0) % persuade.length;
        reply = persuade[i];
        mem.orderWaitIdx = i + 1;
      } else {
        // Khách VỪA đặt xong -> báo trung tính, TUYỆT ĐỐI KHÔNG dùng câu "chờ thêm mấy hôm/quá tải".
        reply = "Dạ đơn của chị đã được xác nhận, bên em đang chuẩn bị để gửi đi sớm cho mình nha.";
      }
      await sendInboxMessage(conversationId, reply);
      console.log(`Tra đơn ${phone}: tất cả status=1, đơn cũ nhất ~${Math.round(oldestAgeMs/86400000)} ngày -> ${oldestAgeMs >= WAIT_MS ? "thuyết phục chờ" : "báo đã xác nhận"}.`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH HỎI CHÂN VÁY / SET MÀ MẪU ĐANG NHẬN DIỆN KHÔNG PHẢI -> KHÔNG ĐOÁN BỪA, gắn thẻ AI-CHỜ XLY =====
    // Vd: bot nhận diện ra ÁO, khách nói "mình đang hỏi chân váy mà" / "set này có cả chân váy".
    // Nếu mẫu focus KHÔNG phải set/chân váy (theo category) -> TUYỆT ĐỐI không tự bịa tên/thành phần set.
    if (productInfo && (_aiOr(asksSkirtOrSet(latestText), "SET_TYPE")) && !_multiAttrQ
        && !/(giá|gia\b|bao nhiêu|bao nhieu|nhiêu tiền|nhieu tien|mấy tiền|may tien|bao tiền|nhiêu ạ|nhiêu vậy)/i.test(latestText)) {
      const cat = String(productInfo.category || "").toLowerCase();
      const label = productLabel(productInfo);
      // RULE theo cột D (category): có ký hiệu "set" -> SET RỜI; không có "set" -> VÁY LIỀN. KHÔNG nhường người thật.
      const isSet = /\bset\b|set /.test(cat);
      // CÂU HÀNH ĐỘNG tuỳ trạng thái -> KHÔNG lặp "tư vấn size" nếu đã tư vấn size rồi (tránh vòng luẩn quẩn).
      let _cta;
      if (mem.customerSize) {                                   // ĐÃ có size -> hướng tới CHỐT, không tư vấn size lại
        _cta = (mem.phone && mem.address)
          ? `Để em lên đơn${noiNhanAddr(mem)} cho mình nhe ạ.`
          : `Chị ưng sản phẩm gửi em xin số điện thoại và địa chỉ em lên đơn cho mình nha?`;
      } else {                                                  // CHƯA có size -> CHỈ hỏi size (KHÔNG nói "lên đơn")
        _cta = `Chị thường mặc size bao nhiêu vậy ạ?`;
      }
      let reply;
      if (asksBottomPart(latestText) && !_nhanCamRegex(mem, "asksBottomPart", ["SET_TYPE", "PRODUCT_DETAIL_QA"])) {
        // Hỏi PHẦN DƯỚI là gì -> theo cột D: có "quần" -> quần; có "chân váy" -> chân váy;
        // chỉ "set" (không rõ) -> trả cấu trúc set (áo + phần dưới), KHÔNG khẳng định quần/váy; không set -> váy liền.
        const _q = /quần|quan/.test(cat);
        const _cv = /chân váy|chan vay/.test(cat);
        if (isSet && _q)       reply = `Dạ đúng rồi ạ, ${label} là set áo + quần, phần dưới là quần ạ. ${_cta}`;
        else if (isSet && _cv) reply = `Dạ ${label} là set áo + chân váy, phần dưới là chân váy ạ. ${_cta}`;
        else if (isSet)        reply = `Dạ ${label} là set rời gồm áo và phần dưới ạ. ${_cta}`;
        else                   reply = `Dạ ${label} là váy liền 1 món ạ, không tách phần dưới riêng đâu ạ. ${_cta}`;
      } else if (_aiOr(asksBuySeparate(latestText), "BUY_SEPARATE")) {
        // Khách hỏi MUA/BÁN LẺ TỪNG MÓN: set = bán nguyên set, KHÔNG bán rời; váy = 1 món sẵn.
        reply = isSet
          ? `Dạ ${label} là set, bên em bán nguyên set chứ không bán lẻ từng món chị nha. ${_cta}`
          : `Dạ ${label} là váy liền 1 món chị nha. ${_cta}`;
      } else {
        reply = isSet
          ? `Dạ ${label} là set rời ạ. ${_cta}`
          : `Dạ ${label} là váy liền ạ. ${_cta}`;
      }
      // CHƯA báo giá mẫu này -> BÁO GIÁ + trả lời. Đã báo rồi (kể cả NGƯỜI THẬT gõ tay / lượt trước) -> chỉ trả lời.
      const _codeUp = String(productInfo.code || "").toUpperCase();
      const _notQuotedYet = priceIsValid(productInfo.price) && !quotedRecently(mem, productInfo.code)
        && !(mem.pricedCodes || []).some(c => String(c).toUpperCase() === _codeUp)
        && !pricedInThread(data.messages, productInfo);   // QUÉT cả luồng: giá mẫu đã xuất hiện (do bot/người thật) -> KHÔNG báo lại
      if (_notQuotedYet) {
        const _ans = reply.replace(new RegExp("^Dạ\\s*" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*", "i"), "");
        reply = `Dạ ${label} giá ${formatPrice(productInfo.price)}, ${_ans}`;
        markPriced(mem, productInfo.code);
      }
      await sendInboxMessage(conversationId, reply);
      console.log(`Khách hỏi set/liền${asksBuySeparate(latestText) ? "/bán riêng" : ""} -> ${isSet ? "SET" : "VÁY LIỀN"} (mẫu ${productInfo.code}, cat="${cat || "?"}", size=${mem.customerSize || "-"}).`);
      mem.lastBotReply = reply; scheduleFollowup(conversationId, mem, productInfo, reply);
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH HỎI "MẪU NÀY CÓ PHẢI FREESIZE KHÔNG" -> trả NGẮN, KHÔNG liệt kê S/M/L =====
    if (asksIsFreesize(latestText) && productInfo && !parseWeightKg(latestText)) {
      const a = parseAvailableSizes(productInfo.size);
      const isFree = a.size === 1 && a.has("FREESIZE");
      const label = productLabel(productInfo);
      let reply;
      if (isFree) {
        reply = mem.customerSize
          ? `Dạ ${label} là freesize chị ạ, chị mặc mẫu này vừa đẹp đó ạ.`
          : `Dạ ${label} là freesize chị ạ, chiều cao và cân nặng của chị thế nào để em tư vấn cho mình nha ạ?`;
      } else {
        // KHÔNG liệt kê các size. Có size khách -> nói ĐÚNG size đó; chưa biết -> hỏi.
        reply = (mem.customerSize && (a.size === 0 || a.has(mem.customerSize)))
          ? `Dạ ${label} không phải freesize ạ, mẫu này bên em có ${sizeLabel(mem.customerSize)} phù hợp với chị đó ạ.`
          : `Dạ ${label} không phải freesize ạ, chị thường mặc size nào để em tư vấn cho mình nha ạ?`;
      }
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi có freesize không -> ${isFree ? "freesize" : "không freesize (không liệt kê)"}.`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH THẮC MẮC TẠI SAO MẪU THÌ S/M/L, MẪU THÌ FREESIZE -> giải thích ngắn =====
    if (asksWhySizeDiffer(latestText) && !_nhanCamRegex(mem, "asksWhySizeDiffer", ["SIZE_CHART", "SIZE_ADVICE", "SIZE_CONSISTENCY"])) {
      const reply = "Dạ cũng tùy từng mẫu mà bên em thiết kế phom và size khác nhau ạ, các mẫu freesize đa phần phom rộng rãi thoải mái, độ co giãn cao nên ôm được nhiều dáng người hơn đó chị.";
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách thắc mắc S/M/L vs freesize -> câu giải thích.`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH HỎI YES/NO "CÓ SIZE KHÔNG" -> "Dạ bên em có đủ size ạ" + hỏi size khách (nếu CHƯA biết) =====
    if (asksHasSize(latestText) && productInfo && !parseWeightKg(latestText)) {
      const a = parseAvailableSizes(productInfo.size);
      const isFree = a.size === 1 && a.has("FREESIZE");
      let reply;
      if (isFree) {
        reply = mem.customerSize
          ? `Dạ ${productLabel(productInfo)} là freesize, chị mặc vừa đẹp đó ạ.`
          : `Dạ ${productLabel(productInfo)} là freesize ạ, chị cho em xin chiều cao và cân nặng để em tư vấn cho mình nha ạ?`;
      } else if (mem.customerSize && (a.size === 0 || a.has(mem.customerSize))) {
        reply = `Dạ bên em còn đủ size ạ, chị mặc ${sizeLabel(mem.customerSize)} là vừa đó ạ. ${orderCtaOrAskContact(mem)}`;
      } else {
        reply = "Dạ bên em có đủ size ạ, chị thường mặc size bao nhiêu ạ?";
      }
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi "có size không" -> xác nhận có đủ size${mem.customerSize ? "" : " + hỏi size"}.`);
      mem.lastBotReply = reply;
      scheduleFollowup(conversationId, mem, productInfo, reply);
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH HỎI "MẪU NÀY SIZE GÌ / CÓ SIZE NÀO" -> trả theo mẫu (freesize vs S/M/L), nhất quán =====
    if (asksWhatSize(latestText) && productInfo && !parseWeightKg(latestText)) {
      const a = parseAvailableSizes(productInfo.size);
      const isFree = a.size === 1 && a.has("FREESIZE");
      const label = productLabel(productInfo);
      // (tư vấn) Khách hỏi "NÊN/MẶC size nào" + đã biết size khách HAY MẶC -> tư vấn size đó + trấn an đổi (KHÔNG liệt kê).
      const stated = extractStatedSize(latestText) || (mem.sizeFromCustomer ? mem.customerSize : null);
      if (!isFree && asksWhichSizeAdvice(latestText) && stated && stated !== "FREESIZE" && (a.size === 0 || a.has(stated))) {
        mem.customerSize = stated; mem.sizeFromCustomer = true;
        const reply = `Dạ vậy em lấy ${sizeLabel(stated)} hay mặc cho mình nha, rộng chật thế nào em sẽ hỗ trợ chị đổi hàng ạ`;
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Khách hỏi nên mặc size nào + hay mặc ${stated} -> tư vấn ${stated} + trấn an đổi (không liệt kê).`);
        scheduleFollowup(conversationId, mem, productInfo, reply);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      let reply;
      if (isFree) {
        // FREESIZE: đã biết size khách -> vừa đẹp; chưa biết -> HỎI CHIỀU CAO + CÂN NẶNG (không hỏi "size nào").
        reply = mem.customerSize
          ? `Dạ ${label} có freesize chị ạ, chị mặc mẫu này rất vừa và đẹp đó ạ.`
          : `Dạ ${label} có freesize chị ạ, chiều cao và cân nặng của chị thế nào để em tư vấn cho mình nha ạ?`;
      } else {
        // KHÁCH HỎI THẲNG "có size gì" -> ĐÂY là lúc ĐƯỢC liệt kê size. Trả lời ĐÚNG câu hỏi rồi mới dẫn dắt.
        const sizesTxt = [...a].map(s => s === "FREESIZE" ? "freesize" : s).join(", ");
        const tail = (mem.noFitForCode === productInfo.code)
          ? ", nhưng với số đo của mình thì mẫu này chưa có size phù hợp nên chị tham khảo thêm mẫu khác giúp em nha"
          : (mem.customerSize && (a.size === 0 || a.has(mem.customerSize)))
            ? `, chị mặc ${sizeLabel(mem.customerSize)} là vừa đó ạ`
            : ", chị thường mặc size nào để em tư vấn cho mình nha";
        reply = sizesTxt
          ? `Dạ mẫu này bên em có size ${sizesTxt} ạ${tail}.`
          : `Dạ chị thường mặc size nào để em tư vấn cho mình nha ạ?`;
      }
      // [FIX Trang Đặng] Mẫu CHƯA báo giá mà khách hỏi "có size nào" -> BÁO GIÁ + ẢNH trước rồi mới trả size.
      const _szUp = String(productInfo.code || "").toUpperCase();
      const _szPl = priceLine(productInfo);
      const _szQuoteNow = _szPl && !quotedRecently(mem, productInfo.code) && !(mem.pricedCodes || []).some(c => String(c).toUpperCase() === _szUp);
      if (_szQuoteNow) { reply = `Dạ ${productLabel(productInfo)} ${_szPl}. ${reply.replace(/^Dạ\s*/i, "")}`; markPriced(mem, productInfo.code); }
      await sendInboxMessage(conversationId, reply);
      if (_szQuoteNow) { try { mem._imgAllowSend = true; await maybeSendImages(conversationId, productInfo.code, mem, false); } catch (_) {} }
      console.log(`[${BOT_NAME}] Khách hỏi size gì -> ${_szQuoteNow ? "BÁO GIÁ + ẢNH trước rồi " : ""}${isFree ? "freesize" : "S/M/L"} (nhất quán).`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH HỎI "SIZE X / mẫu này BAO NHIÊU KG MẶC VỪA" -> theo BẢNG SIZE; mẫu FREESIZE -> trả freesize =====
    if (asksWeightForSize(latestText) && !parseWeightKg(latestText)) {
      const a = productInfo ? parseAvailableSizes(productInfo.size) : new Set();
      const isFree = a.size === 1 && a.has("FREESIZE");
      let reply;
      if (isFree) {
        // MẪU FREESIZE -> KHÔNG đưa bảng S/M/L. LUÔN trả KHOẢNG CÂN NẶNG freesize (khách đang hỏi đúng cái đó).
        const range = SIZE_WEIGHT.FREESIZE;   // "42-57kg"
        reply = (freesizeNeedsWeightCheck(mem) && !mem.weightKg && !mem.measure3V)
          ? `Dạ ${productLabel(productInfo)} là freesize, phù hợp với người khoảng ${range} ạ. Chị cho em xin chiều cao và cân nặng để em kiểm tra mặc có vừa không nha`
          : `Dạ ${productLabel(productInfo)} là freesize, phù hợp với người khoảng ${range} ạ. Chị mặc mẫu này vừa đẹp đó ạ. ${orderCtaOrAskContact(mem)}`;
      } else {
        const sz = extractAskedSize(latestText);
        const range = sz && SIZE_WEIGHT[sz];
        // ĐUÔI LINH HOẠT 4 trạng thái (chưa có size -> xin cao/nặng; có size + thiếu sđt/địa chỉ -> xin liên hệ;
        //  đủ -> mời lên đơn; freesize) — dùng chung sizeTailForProduct để nhất quán mọi câu tư vấn.
        let tail;
        try { tail = productInfo ? sizeTailForProduct(mem, productInfo) : ""; } catch (_) { tail = ""; }
        if (!tail) {
          const known = mem.customerSize && mem.customerSize !== "FREESIZE";
          tail = known
            ? ` Chị mặc ${sizeLabel(mem.customerSize)} là có size của mình rồi đó ạ.`
            : " Chị cho em xin chiều cao cân nặng của mình, em xem size nào vừa form đẹp nhất rồi tư vấn cho chị nha?";
        }
        if (range) {
          // Hỏi ĐÍCH DANH 1 size: "size S dành cho bao cân" -> trả DẢI CÂN của size đó (theo SIZE_WEIGHT).
          reply = `Dạ ${sz === "FREESIZE" ? "Freesize" : `size ${sz}`} dành cho khoảng ${range} ạ.${tail}`;
        } else {
          // Hỏi CHUNG "váy này cho người bao nhiêu kg" -> nêu RANGE SIZE mẫu THỰC CÓ.
          const avail = productInfo ? parseAvailableSizes(productInfo.size) : new Set();
          const ordered = ["S", "M", "L", "XL", "XXL", "XXXL"].filter(s => avail.has(s));
          if (ordered.length >= 2) {
            const lo = ordered[0], hi = ordered[ordered.length - 1];
            const loKg = (SIZE_WEIGHT[lo] || "").split("-")[0];
            const hiKg = (SIZE_WEIGHT[hi] || "").replace("kg", "").split("-")[1];
            const kgTxt = (loKg && hiKg) ? ` (khoảng ${loKg}-${hiKg}kg)` : "";
            reply = `Dạ váy bên em có đủ size từ ${lo} đến ${hi}${kgTxt} chị ạ.${tail}`;
          } else if (ordered.length === 1) {
            const s1 = ordered[0];
            reply = `Dạ mẫu này bên em có size ${s1} (khoảng ${SIZE_WEIGHT[s1] || "—"}) chị ạ.${tail}`;
          } else {
            reply = `Dạ bảng size bên em: S khoảng 40-48kg, M khoảng 49-55kg, L khoảng 56-59kg ạ.${tail}`;
          }
        }
      }
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi cân nặng/size -> ${isFree ? "freesize" : "bảng S/M/L"}.`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH HỎI VÌ SAO VỪA SIZE ĐÓ (thường mặc size khác) -> giải thích bằng số đo từng vòng =====
    if (asksWhySize(latestText) && mem.recommendedSizeReason) {
      const { size, nguc, eo, mong } = mem.recommendedSizeReason;
      const c = SIZE_CHART_3V[size];
      let reply;
      if (c) {
        reply = `Dạ vì số đo của chị (ngực ${nguc}, eo ${eo}, mông ${mong}) khớp với khoảng size ${size} bên em (ngực ${c.nguc[0]}-${c.nguc[1]}, eo ${c.eo[0]}-${c.eo[1]}, mông ${c.mong[0]}-${c.mong[1]}) nên chị mặc ${sizeLabel(size)} là vừa vặn tôn dáng nhất ạ. Size to hơn sẽ hơi rộng so với số đo của mình đó chị`;
      } else {
        reply = `Dạ với số đo của chị thì ${sizeLabel(size)} là vừa form đẹp nhất bên em đó ạ`;
      }
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Giải thích vì sao size ${size} theo số đo ${nguc}-${eo}-${mong}.`);
      mem.lastBotReply = reply;
      scheduleFollowup(conversationId, mem, productInfo, reply);
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== LỖI 4b: ĐANG CÓ 2+ MẪU (cụm) mà khách hỏi "(số đo) vừa MẪU NÀO" =====
    // KHÔNG chọn đại 1 mẫu. Biết size -> nói size đó vừa VỚI CÁC MẪU; chưa biết -> xin chiều cao cân nặng.
    {
      const _cluster = (mem.quotedProducts || []);
      const _lt = String(latestText || "").toLowerCase();
      const _asksWhichFits = _cluster.length >= 2 && (
        /(vừa|hợp|mặc (được|vừa))\s*(mẫu|cái|con|bộ) nào/.test(_lt) ||
        /(\beo\b|vòng|ngực|mông|cao|nặng|\bkg\b|\bcm\b)[^?]{0,22}(vừa|hợp)[^?]{0,8}(mẫu|cái|con) nào/.test(_lt) ||
        /(\beo\b|vòng eo)[^?]{0,14}\d{2,3}[^?]{0,16}(mẫu|cái|con) nào/.test(_lt)
      );
      if (_asksWhichFits) {
        let es = effectiveSize(mem, productInfo || _cluster[0]);
        if (!es) {
          // Khách đưa ĐỦ 3 vòng ngay trong câu -> suy size để nói "vừa X với các mẫu" (eo lẻ thì không suy, xin thêm).
          const m3 = parse3V(_lt) || (asksSizeForMeasure(_lt) ? mem.measure3V : null);
          const _p = productInfo || _cluster[0];
          if (m3 && _p) {
            const avail = parseAvailableSizes(_p.size);
            const availList = ["S", "M", "L", "XL", "XXL", "XXXL"].filter(s => avail.has(s));
            const r = resolveSizeBy3V(m3[0], m3[1], m3[2], availList);
            if (r.size && !r.over) es = r.size;
          }
        }
        const reply = es
          ? `Dạ với thông số của chị thì vừa ${es === "FREESIZE" ? "freesize" : sizeLabel(es)} với các mẫu bên em đó ạ. Chị chốt mẫu nào em lên đơn cho mình nha?`
          : `Dạ chị cho em xin chiều cao cân nặng để em tư vấn size vừa cho các mẫu mình đang xem nha ạ`;
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Hỏi "vừa mẫu nào" trong cụm ${_cluster.length} mẫu -> ${es ? "size " + es + " cho mọi mẫu" : "xin số đo"} (KHÔNG chọn 1 mẫu).`);
        mem.lastBotReply = reply; scheduleFollowup(conversationId, mem, productInfo || _cluster[0], reply);
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
    }

    // ===== KHÁCH HỎI SỐ ĐO CỦA 1 SIZE THEO BẢNG ("L eo bao nhiêu", "ngực size M mấy") -> TRẢ số đo, KHÔNG báo giá/hết size =====
    {
      const _ms = asksMeasureOfSize(latestText);
      if (_ms) {
        const dimLabel = { nguc: "ngực", eo: "eo", mong: "mông" };
        const avail = parseAvailableSizes(productInfo && productInfo.size);
        const availList = ["S", "M", "L"].filter(s => SIZE_CHART_3V[s] && (!avail || avail.size === 0 || avail.has(s)));
        const sizesToShow = (_ms.size && SIZE_CHART_3V[_ms.size]) ? [_ms.size]
          : (availList.length ? availList : ["S", "M", "L"]);
        const parts = sizesToShow.filter(s => SIZE_CHART_3V[s]).map(s => {
          const r = SIZE_CHART_3V[s][_ms.dim];
          return `${sizeLabel(s)} ${dimLabel[_ms.dim]} ${r[0]}-${r[1]}`;
        });
        let reply;
        if (parts.length === 1) reply = `Dạ ${parts[0]}cm ạ. Chị cho em xin chiều cao cân nặng để em tư vấn size vừa nhất cho mình nha ạ`;
        else reply = `Dạ ${dimLabel[_ms.dim]} theo bảng size bên em: ${parts.join(", ")} (cm) ạ. Chị cho em xin chiều cao cân nặng để em tư vấn size vừa cho mình nha ạ`;
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Khách hỏi ${dimLabel[_ms.dim]} size ${_ms.size || "(mọi size)"} -> trả số đo bảng (${parts.join(" | ")}).`);
        mem.lastBotReply = reply; scheduleFollowup(conversationId, mem, productInfo, reply);
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
    }

    // ===== KHÁCH CHO SỐ ĐO 3 VÒNG (hoặc hỏi "số đo này mặc size gì") -> TƯ VẤN SIZE THEO BẢNG, không gửi bảng =====
    {
      const m3 = parse3V(latestText) || (asksSizeForMeasure(latestText) ? mem.measure3V : null);
      if (m3 && productInfo) {
        const [nguc, eo, mong] = m3;
        const avail = parseAvailableSizes(productInfo.size);
        const isFree = avail.size === 1 && avail.has("FREESIZE");
        const availList = ["S", "M", "L", "XL", "XXL", "XXXL"].filter(s => avail.has(s));
        const { size: _m3size, over: _m3over } = resolveSizeBy3V(nguc, eo, mong, availList);   // CHỈ xét size shop ĐANG CÓ
        // CÂN NẶNG LÀ CHÍNH: đã có cân nặng -> theo size cân nặng, số đo không kéo sang size khác.
        const _wf3 = sizeWeightFirst(_m3size, mem, productInfo);
        const size = _wf3.fromWeight ? _wf3.size : _m3size;
        const over = _wf3.fromWeight ? false : _m3over;
        const soDoTxt = `${nguc}-${eo}-${mong}`;
        let reply;
        if (isFree) {
          reply = `Dạ mẫu này là freesize, với số đo ${soDoTxt} của chị thì mặc vừa đẹp ạ. ${orderCtaOrAskContact(mem)}`;
        } else if (size && !over) {
          // CÓ size vừa trong các size shop đang có -> tư vấn luôn (kể cả khách thường mặc size khác)
          mem.customerSize = size; mem.sizeFromCustomer = true;
          if (!_wf3.fromWeight) mem.recommendedSizeReason = { size, nguc, eo, mong };   // nhớ để giải thích nếu khách hỏi "sao lại size này"
          if (mem.noFitForCode === productInfo.code) mem.noFitForCode = null;
          reply = _wf3.fromWeight
            ? `Dạ với chiều cao cân nặng của chị thì mặc ${sizeLabel(size)} mẫu này bên em là vừa xinh đó ạ, mình lấy ${sizeLabel(size)} nha chị?`
            : `Dạ em thấy với thông số mình cung cấp thì chị vừa ${sizeLabel(size)} mẫu này bên em đó ạ, mình lấy ${sizeLabel(size)} nha chị?`;
        } else {
          // Số đo VƯỢT size lớn nhất shop đang có -> mới báo không vừa
          const have = availList;
          mem.noFitForCode = productInfo.code;
          reply = `Dạ với số đo ${soDoTxt} thì tiếc quá mẫu này bên em ${have.length ? "chỉ có size " + have.join(", ") + ", " : ""}chưa có size vừa cho chị rồi ạ. Chị tham khảo thêm mẫu khác bên em nha, biết đâu có mẫu hợp hơn`;
        }
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Số đo ${soDoTxt} -> size ${size || "(không vừa)"} | mẫu ${productInfo.code} (có: ${availList.join(",") || "freesize"}).`);
        mem.lastBotReply = reply;
        scheduleFollowup(conversationId, mem, productInfo, reply);
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
    }

    // ===== KHÁCH CHO SỐ ĐO CÓ NHÃN TỪNG PHẦN ("v1 85 eo 68", "ngực 85 eo 68") -> tư vấn size, KHÔNG báo giá lại =====
    {
      const _bm = parse3V(latestText) ? null : parseBodyMeasures(latestText);   // đủ 3 số -> block trên lo; chỉ xử số đo lẻ có nhãn
      if (_bm && productInfo) {
        const avail = parseAvailableSizes(productInfo.size);
        const isFree = avail.size === 1 && avail.has("FREESIZE");
        const availList = ["S", "M", "L", "XL", "XXL", "XXXL"].filter(s => avail.has(s));
        const { size: _bmsize, over: _bmover } = resolveSizeByMeasures(_bm, availList);
        const soDoTxt = [_bm.nguc != null ? "ngực " + _bm.nguc : "", _bm.eo != null ? "eo " + _bm.eo : "", _bm.mong != null ? "mông " + _bm.mong : ""].filter(Boolean).join(", ");
        // CÂN NẶNG LÀ CHÍNH: đã có cân nặng -> theo size cân nặng, số đo không kéo sang size khác.
        const _wfm = sizeWeightFirst(_bmsize, mem, productInfo);
        const size = _wfm.fromWeight ? _wfm.size : _bmsize;
        const over = _wfm.fromWeight ? false : _bmover;
        let reply;
        if (isFree) {
          reply = `Dạ mẫu này là freesize, với số đo (${soDoTxt}) của chị thì mặc vừa đẹp ạ. ${orderCtaOrAskContact(mem)}`;
        } else if (size && !over) {
          mem.customerSize = size; mem.sizeFromCustomer = true;
          if (mem.noFitForCode === productInfo.code) mem.noFitForCode = null;
          reply = _wfm.fromWeight
            ? `Dạ với chiều cao cân nặng của chị thì mặc ${sizeLabel(size)} mẫu này bên em là vừa xinh đó ạ, mình lấy ${sizeLabel(size)} nha chị?`
            : `Dạ với số đo (${soDoTxt}) thì chị mặc ${sizeLabel(size)} mẫu này bên em là vừa form đó ạ, mình lấy ${sizeLabel(size)} nha chị?`;
        } else if (over) {
          // QUY TRÌNH HẾT SIZE: số đo LẺ (chưa đủ 3 vòng) vượt -> CHƯA kết luận hết. Phải có cao/nặng (hoặc đủ 3 vòng) mới chốt.
          const _nMeas = [_bm.nguc, _bm.eo, _bm.mong].filter(v => v != null).length;
          if (_nMeas < 3 && !mem.weightKg && !mem.measure3V) {
            reply = `Dạ chị cho em xin chiều cao và cân nặng của mình để em check lại phía thiết kế xem có vừa không nha ạ`;
            console.log(`[${BOT_NAME}] Số đo lẻ (${soDoTxt}) vượt size NHƯNG chưa có cao/nặng -> XIN cao/nặng (CHƯA kết luận hết size).`);
          } else {
            mem.noFitForCode = productInfo.code;
            reply = `Dạ với số đo (${soDoTxt}) thì tiếc quá mẫu này bên em ${availList.length ? "chỉ có size " + availList.join(", ") + ", " : ""}chưa có size vừa cho chị rồi ạ. Chị tham khảo thêm mẫu khác bên em nha ạ`;
          }
        } else {
          reply = `Dạ chị cho em xin thêm chiều cao cân nặng (hoặc đủ số đo 3 vòng) để em tư vấn size chuẩn cho mình nha ạ`;
        }
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Số đo có nhãn (${soDoTxt}) -> size ${size || "(chưa đủ/không vừa)"} | mẫu ${productInfo.code} (có: ${availList.join(",") || "freesize"}).`);
        mem.lastBotReply = reply;
        scheduleFollowup(conversationId, mem, productInfo, reply);
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
    }

    // ===== KHÁCH TỰ KHAI SIZE CỦA MÌNH ("mình mặc L", "size L số đo 85-67-89") -> tư vấn CÓ/KHÔNG size đó =====
    {
      // extractStatedSize bắt theo regex; gõ sai "Szai/síze/sz ai" -> trượt. Khi AI nhãn=SIZE và bóc được size
      // (vd "Szai M e" -> size=M) thì DÙNG size AI làm statedNow -> có kịch bản trả, hết bị đẩy người oan (Tham Lai).
      const statedNow = extractStatedSize(latestText)
        || ((mem._aiIntent === "SIZE" && mem._aiSize) ? mem._aiSize : null);
      const hasPhoneInMsg = /(?:\+?84|0)(?:[\s.\-]?\d){8,9}(?![\d])/.test(latestText);
      if (statedNow && statedNow !== "FREESIZE" && productInfo && !isGiftContext(latestText) && !hasPhoneInMsg) {
        const avail = parseAvailableSizes(productInfo.size);
        const isFree = avail.size === 1 && avail.has("FREESIZE");
        const _sizeKnown = avail.size > 0 && !isFree;        // CÓ dữ liệu size cụ thể để kiểm
        // Chỉ ghi customerSize = size khách khai khi size đó CÓ sẵn (hoặc mẫu không kê size); KHÔNG ghi khi đang lưỡng lự.
        if (!mem.sizeWavering && (avail.size === 0 || isFree || avail.has(statedNow))) {
          mem.customerSize = statedNow; mem.sizeFromCustomer = true;
        }
        // QUY TRÌNH HẾT SIZE: KHÔNG vội báo "không có size". Phải xét cao/nặng trước.
        if (_sizeKnown && !avail.has(statedNow)) {
          const availList = ["S", "M", "L", "XL", "XXL", "XXXL"].filter(s => avail.has(s));
          let reply = null;
          // (1) CÓ số đo 3V -> thử fit size ĐANG CÓ
          if (mem.measure3V) {
            const [nguc, eo, mong] = mem.measure3V;
            const { size: fit, over } = resolveSizeBy3V(nguc, eo, mong, availList);
            if (fit && !over) {
              if (!isGiftContext(latestText)) mem.customerSize = fit;
              mem.recommendedSizeReason = { size: fit, nguc, eo, mong };
              if (mem.noFitForCode === productInfo.code) mem.noFitForCode = null;
              reply = `Dạ tuy chị hay mặc ${sizeLabel(statedNow)} nhưng với số đo ${nguc}-${eo}-${mong} của chị thì mặc ${sizeLabel(fit)} mẫu này bên em là vừa form đẹp nhất đó ạ, mình lấy ${sizeLabel(fit)} nha chị?`;
            }
          }
          // (2) CÓ cân nặng -> thử fit size ĐANG CÓ theo cân nặng
          if (!reply && mem.weightKg) {
            const rec = resolveSizeByWeight(mem.weightKg, productInfo.size);
            if (rec && rec !== "OVER" && (avail.has(rec) || rec === "FREESIZE")) {
              if (!isGiftContext(latestText) && rec !== "FREESIZE") mem.customerSize = rec;
              if (mem.noFitForCode === productInfo.code) mem.noFitForCode = null;
              reply = `Dạ tuy chị hay mặc ${sizeLabel(statedNow)} nhưng với ${mem.weightKg}kg thì mặc ${sizeLabel(rec)} mẫu này bên em là vừa form đẹp nhất ạ, mình lấy ${sizeLabel(rec)} nha chị?`;
            }
          }
          // (3) CHƯA có cao/nặng/số đo -> KHÔNG báo hết size. XIN chiều cao + cân nặng để kiểm tra fit size đang có.
          if (!reply && !mem.measure3V && !mem.weightKg) {
            mem.sizeWavering = false;
            reply = `Dạ mẫu này bên em ${availList.length ? "đang có size " + availList.join(", ") + " ạ. " : ""}Chị cho em xin chiều cao và cân nặng để em kiểm tra size vừa form cho mình nha ạ`;
            await sendInboxMessage(conversationId, reply);
            console.log(`[${BOT_NAME}] Khách khai size ${statedNow} (mẫu chỉ có ${availList.join(",")}) NHƯNG chưa có cao/nặng -> XIN cao/nặng (CHƯA kết luận hết size).`);
            mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
          }
          // (4) ĐÃ có cân nặng/số đo mà VẪN không fit -> giờ MỚI được báo hết size.
          if (!reply) {
            mem.noFitForCode = productInfo.code;
            reply = `Dạ tiếc quá, mẫu này bên em ${availList.length ? "chỉ có size " + availList.join(", ") : "chưa có size phù hợp"} thôi, với số đo của chị thì chưa có size vừa rồi ạ. Chị tham khảo thêm mẫu khác bên em nha, biết đâu có mẫu hợp hơn`;
            cancelFollowup(conversationId);   // hết size -> NGỪNG follow-up
          }
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] Khách khai size ${statedNow} -> mẫu ${productInfo.code}: ${mem.noFitForCode === productInfo.code ? "HẾT size (đã có cao/nặng)" : "gợi size vừa form"}.`);
          mem.lastBotReply = reply;
          updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        // Khách CHỐT kèm size ("ok lên đơn size M đi") -> KHÔNG hỏi lại size/lên đơn (điều đã biết).
        // (Tới đây nghĩa là size CÓ sẵn hoặc freesize/không rõ size -> mới được phép chốt.)
        // Thiếu sđt/địa chỉ -> xin đúng cái chưa biết; đủ contact -> để luồng tạo đơn bên dưới lo.
        if (customerWantsToOrder(latestText, mem.lastIntent)) {
          if (!(mem.phone && mem.address)) {
            const r = `Dạ chị ưng sản phẩm cho em xin số điện thoại và địa chỉ để em lên đơn ${sizeLabel(statedNow)} cho mình nha?`;
            await sendInboxMessage(conversationId, r);
            console.log(`[${BOT_NAME}] Khách chốt kèm size ${statedNow} (mẫu CÓ size), thiếu contact -> xin sđt/địa chỉ.`);
            mem.lastBotReply = r; mem.askedContact = true;
            updateConversationState(conversationId, mem); markProcessed(batch); return true;
          }
          updateConversationState(conversationId, mem);   // đủ contact -> rơi xuống luồng tạo đơn
        } else {
        let reply;
        const _hasContact = mem.phone && mem.address;   // [NGUYÊN TẮC] "ưng em lên đơn" CHỈ khi đã đủ size + sđt + địa chỉ
        if (isFree) {
          reply = _hasContact
            ? `Dạ mẫu này freesize chị mặc vừa đẹp đó ạ. Chị ưng em lên đơn cho mình nha`
            : `Dạ mẫu này freesize chị mặc vừa đẹp đó ạ. Chị cho em xin số điện thoại và địa chỉ để em lên đơn cho mình nha?`;
        } else if (avail.has(statedNow) || avail.size === 0) {
          if (mem.noFitForCode === productInfo.code) mem.noFitForCode = null;
          reply = _hasContact
            ? `Dạ mẫu này bên em có ${sizeLabel(statedNow)} đó ạ, chị mặc là vừa xinh đó ạ. Chị ưng em lên đơn cho mình nha`
            : `Dạ mẫu này bên em có ${sizeLabel(statedNow)} đó ạ, chị mặc là vừa xinh đó ạ. Chị cho em xin số điện thoại và địa chỉ để em lên đơn ${sizeLabel(statedNow)} cho mình nha?`;
        }
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Khách khai size ${statedNow} -> mẫu ${productInfo.code} ${isFree ? "freesize" : "CÓ"}.`);
        mem.lastBotReply = reply;
        scheduleFollowup(conversationId, mem, productInfo, reply);
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
      }
    }

    // ===== KHÁCH XIN XEM BẢNG SỐ ĐO / THÔNG SỐ -> gửi ảnh bảng size (ảnh 3) hoặc số đo bằng chữ =====
    // CHỈ early-return khi KHÔNG có mẫu MỚI chưa báo giá lượt này (nếu có -> để nhánh báo giá chạy, rider sẽ
    // gửi kèm bảng size -> không bỏ sót giá lẫn bảng size). (chống "đọc 2 hiểu 1")
    const _hasNewModelToQuote = Array.isArray(thisTurn) && thisTurn.some(p =>
      p && p.code && !quotedRecently(mem, String(p.code).toUpperCase()));
    if ((_aiOr(asksSizeChart(latestText), "SIZE_CHART")) && !_hasNewModelToQuote) {
      let sentImg = false;
      if (SIZE_GUIDE_IMG && (SIZE_GUIDE_IMG.url || SIZE_GUIDE_IMG.contentId)) {
        await sendInboxMessage(conversationId, "Dạ em gửi chị bảng size để mình tham khảo nha ạ");
        // Gửi qua HÀM CHUẨN: content_id (đáng tin) trước, URL sau -> 1 ảnh bảng size.
        const sres = await sendImages3(conversationId, [{ url: SIZE_GUIDE_IMG.url, contentId: SIZE_GUIDE_IMG.contentId }]);
        sentImg = !!(sres && sres.ok);
        console.log(`[${BOT_NAME}] Gửi ẢNH bảng size -> sentImg=${sentImg} (n=${sres && sres.n}).`);
        if (sentImg) {
          // CÂU HÀNH ĐỘNG sau ảnh, THEO MẪU: freesize -> nói freesize; S/M/L -> theo size khách; chưa biết -> hỏi.
          const a = parseAvailableSizes(productInfo && productInfo.size);
          const isFree = a.size === 1 && a.has("FREESIZE");
          let action;
          if (isFree) {
            action = freesizeLine(mem, productInfo);   // freesize -> chỉ nói freesize (KHÔNG đọc size S/M/L khách ra); L+ chưa có cân nặng -> hỏi cao/nặng
          } else if (mem.noFitForCode === (productInfo && productInfo.code)) {
            // ĐÃ báo mẫu này KHÔNG có size vừa -> KHÔNG mời lên đơn size cũ (tránh mâu thuẫn "không size" rồi "size M lên đơn").
            action = "Dạ với số đo của mình thì mẫu này chưa có size phù hợp, chị tham khảo thêm bảng size và mẫu khác giúp em nha ạ";
          } else if (mem.customerSize && (a.size === 0 || a.has(mem.customerSize))) {
            action = `Dạ ${orderActionLine(mem, mem.customerSize)}`;
          } else {
            action = "Dạ chị thường mặc size nào để em tư vấn cho mình nha ạ";
          }
          await sendInboxMessage(conversationId, action);
        } else {
          // Có ảnh bảng size nhưng gửi lỗi -> ÂM THẦM gắn AI-XL ảnh (NV gửi), KHÔNG nhắn khách gì.
          await tagXuLyAnhVaUnread(conversationId);
          mem.botHandoffAt = Date.now();
        }
      } else {
        await sendInboxMessage(conversationId, SIZE_GUIDE_TEXT);  // KHÔNG tìm thấy ảnh bảng size -> tạm gửi chữ
      }
      mem.lastBotReply = "[bảng size]";
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH PHẢN ĐỐI "NÓNG / BÍ / thích chất mát" -> THUYẾT PHỤC LINH HOẠT (xoay câu, không lặp mô tả) =====
    if (isHeatComfortObjection(latestText) && !priceAsk) {
      const reply = buildHeatPersuade(mem, productInfo);
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách kêu nóng/bí -> thuyết phục linh hoạt (xoay câu), không lặp mô tả.`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH XIN MAY/SỬA/CHỈNH theo yêu cầu riêng -> bên em KHÔNG nhận, giữ nguyên thiết kế gốc + trấn an chiều dài =====
    if (asksCustomTailor(latestText) && !_nhanCamRegex(mem, "asksCustomTailor", ["PRODUCT_DETAIL_QA"])) {
      const scripts = [
        "Dạ hiện tại bên em không nhận điều chỉnh theo yêu cầu riêng của từng khách ạ. Các mẫu bên em khi lên form đều đã được tính toán và thiết kế hoàn chỉnh, nên mình sẽ giữ nguyên theo mẫu gốc để đảm bảo chất lượng tốt nhất ạ.",
        "Dạ mỗi mẫu bên em đều được hoàn thiện theo một form chuẩn nên hiện tại bên em xin phép giữ nguyên thiết kế gốc để đảm bảo sản phẩm đẹp nhất có thể ạ.",
        "Dạ hiện tại bên em chưa nhận may đo, chỉnh sửa theo số đo riêng của khách hàng ạ.",
        "Dạ bên em mong muốn giữ đúng tinh thần thiết kế của mẫu nên hiện chưa nhận thay đổi theo yêu cầu riêng ạ.",
      ];
      mem.tailorIdx = ((mem.tailorIdx || 0) + 1) % scripts.length;
      const reply = scripts[mem.tailorIdx] + " Chị yên tâm về chiều dài nha, bên em đã canh tỉ lệ rất kỹ để mặc lên tôn dáng nhất có thể rồi ạ.";
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách xin may/sửa theo yêu cầu -> TỪ CHỐI (giữ thiết kế gốc) + trấn an chiều dài.`);
      mem.lastBotReply = reply;
      scheduleFollowup(conversationId, mem, productInfo, reply);
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH HỎI SỐ ĐO / CHIỀU DÀI CỤ THỂ -> KHÔNG BỊA, KHÔNG đẩy CTA chốt. Có trong mô tả thì trả, không thì hẹn kiểm tra =====
    if (asksSpecificMeasurement(latestText) && !_nhanCamRegex(mem, "asksSpecificMeasurement", ["SIZE_CHART", "SIZE_ADVICE", "PRODUCT_DETAIL_QA"])) {
      // productInfo có thể null (mất focus) -> dùng mẫu đang khoá trong quotedProducts để vẫn trả lời đúng câu hỏi số đo.
      const measProd = productInfo || (Array.isArray(mem.quotedProducts) && mem.quotedProducts.length === 1 ? mem.quotedProducts[0] : null);
      const found = measProd ? measurementFromDesc(measProd, latestText) : null;
      if (found) {
        const nameTxt = productLabelSp(measProd);
        const reply = `Dạ ${nameTxt}${found} chị nha ạ, chiều dài này ${praise(mem)} đó chị ạ.`;
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Số đo lấy từ MÔ TẢ: ${found}`);
        mem.lastBotReply = reply;
      } else {
        // KHÔNG có số đo trong dữ liệu (hoặc chưa khoá đúng 1 mẫu) -> TUYỆT ĐỐI không bịa, KHÔNG xin sđt/chốt. Hẹn kiểm tra + thẻ CHỜ XL.
        const reply = "Dạ số đo chi tiết của mẫu này để em kiểm tra lại cho chính xác rồi báo mình ngay nha";
        await sendInboxMessage(conversationId, reply);
        await tagChoXuLyVaUnread(conversationId);
        mem.botHandoffAt = Date.now();
        console.log(`[${BOT_NAME}] Khách hỏi số đo nhưng MÔ TẢ không có/chưa khoá mẫu -> KHÔNG bịa, hẹn kiểm tra + thẻ CHỜ XL.`);
        mem.lastBotReply = reply;
      }
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH LO ÁO MỎNG / HỞ / XUYÊN THẤU -> TƯ VẤN PHỐI ĐỒ (áo bra/lớp lót nude) =====
    // KHÔNG chạy khi khách lo NGẮN (ngắn != mỏng). AI-READ vớt thêm: concern="ngan" -> nhường short.
    if ((isSheerConcern(latestText) || mem._aiConcern === "mong")
        && !worriesGarmentShort(latestText) && mem._aiConcern !== "ngan"
        && !priceAsk && !cheDoChiBaoGia()) {
      const _shAdv = productInfo && productInfo.material ? materialAdviceSentence(productInfo.material) : "";
      if (_shAdv) {
        await sendInboxMessage(conversationId, _shAdv);
        console.log(`[${BOT_NAME}] Khách lo áo mỏng/hở -> trả material_advice theo chất "${productInfo.material}".`);
        mem.lastBotReply = _shAdv;
      } else {
        await tagChoXuLyVaUnread(conversationId);
        console.log(`[${BOT_NAME}] Khách lo áo mỏng/hở nhưng mẫu KHÔNG có dữ liệu chất liệu -> IM + gắn Chờ-XL (không nói bừa).`);
      }
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH HỎI CÓ 1 SIZE CỤ THỂ KHÔNG ("co xl ko", "có size L ko") -> trả ĐÚNG bảng size (KHÔNG bịa) =====
    {
      const _szAsk = asksWhichSpecificSize(latestText);
      if (_szAsk && productInfo && !_multiAttrQ && !priceAsk) {
        const a = parseAvailableSizes(productInfo.size);
        const _allSizes = ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "FREESIZE"].filter(s => a.has(s));
        if (a.size > 0) {
          let reply;
          if (a.has(_szAsk)) {
            reply = `Dạ mẫu này có size ${_szAsk} chị nha ạ.`;
          } else if (a.has("FREESIZE")) {
            reply = `Dạ mẫu này là freesize ạ (không chia size ${_szAsk}), mặc vừa nhiều dáng lắm chị nha.`;
          } else {
            // KHÔNG có size khách hỏi -> nêu size đang có + VỚT bằng cao/nặng (kiểm tra mặc có vừa size hiện có không).
            const _listTxt = _allSizes.length ? _allSizes.join(", ") : "S, M, L";
            const _knownFit = mem.customerSize && mem.customerSize !== "FREESIZE" && a.has(mem.customerSize);
            const _forWhom = mem._giftFor ? ` của ${mem._giftFor}` : "";   // mua tặng ai -> đúng quan hệ; mua cho mình -> bỏ trống
            reply = _knownFit
              ? `Dạ mẫu này không có size ${_szAsk} ạ, bên em có size ${_listTxt}. Với số đo của chị thì mặc ${sizeLabel(mem.customerSize)} là vừa form đó ạ.`
              : `Dạ mẫu này không có size ${_szAsk} ạ, bên em có size ${_listTxt}. Chị cho em xin chiều cao và cân nặng${_forWhom} để em kiểm tra mặc có vừa size nào không nha ạ.`;
          }
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] Hỏi có size ${_szAsk} -> bảng [${_allSizes.join("/")}] -> ${a.has(_szAsk) ? "CÓ" : "KHÔNG (vớt cao/nặng)"}.`);
          mem.lastBotReply = reply; scheduleFollowup(conversationId, mem, productInfo, reply);
          updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
      }
    }

    // ===== KHÁCH LO MẪU NGẮN ("có ngắn ko", "bên ngoài ngắn quá ko") -> trấn an độ dài thiết kế, KHÔNG báo giá =====
    if ((worriesGarmentShort(latestText) || mem._aiConcern === "ngan") && productInfo && !_multiAttrQ
        && !asksSpecificMeasurement(latestText) && !priceAsk) {
      const reply = "Dạ mẫu này được thiết kế riêng để tôn form và dáng người chị ạ. Độ dài vừa phải, không quá ngắn, mặc lên ôm nhẹ tôn đường cong mà vẫn kín đáo lịch sự lắm chị.";
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách lo mẫu NGẮN -> trấn an độ dài vừa phải (không báo giá).`);
      mem.lastBotReply = reply; scheduleFollowup(conversationId, mem, productInfo, reply);
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH NGHI "KHÔNG ĐẸP NHƯ TƯ VẤN" -> trấn an em tư vấn thật, KHÔNG báo giá =====
    if (doubtsAdvisedQuality(latestText) && !priceAsk) {
      const reply = "Dạ chị yên tâm, em tư vấn thật chứ không nói quá đâu ạ. Em muốn chị nhận hàng ưng để còn quay lại ủng hộ em dài dài chứ";
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách nghi không đẹp như tư vấn -> trấn an (tư vấn thật), không báo giá.`);
      mem.lastBotReply = reply;
      scheduleFollowup(conversationId, mem, productInfo, reply);
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH SO SÁNH GIÁ (chỗ khác/bên ngoài rẻ hơn) -> nêu khác biệt đồ thiết kế vs đại trà, KHÔNG báo lại giá =====
    if (priceComparison(latestText) && productInfo) {
      if (mem.priceComparisonHandled) {
        // đã giải thích khác biệt 1 lần mà khách vẫn so giá -> GẮN người thật IM LẶNG (không nhắn "chờ/báo lại").
        await tagChoXuLyVaUnread(conversationId);
        console.log(`[${BOT_NAME}] Khách vẫn so giá sau khi đã giải thích -> CHỜ XL người thật (im lặng).`);
        mem.botHandoffAt = Date.now();
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      const reply = _rotLine(mem, "_cmpIdx", _PRICE_COMPARE_LINES);
      await sendInboxMessage(conversationId, reply);
      mem.priceComparisonHandled = true;   // chỉ giải thích khác biệt 1 lần/đợt
      console.log(`[${BOT_NAME}] Khách so giá chỗ khác -> nêu khác biệt đồ thiết kế vs đại trà (không báo lại giá).`);
      mem.lastBotReply = reply;
      scheduleFollowup(conversationId, mem, productInfo, reply);
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH PHẢN ĐỐI GIÁ (đắt/cao quá) -> thuyết phục GIÁ TRỊ + freeship, KHÔNG báo lại giá =====
    if ((priceObjection(latestText) || _ai("PRICE_OBJECTION")) && productInfo) {
      const _pvCount = mem.priceObjectionCount || 0;
      if (_pvCount >= _PRICE_VALUE_LINES.length) {
        // đã thuyết phục đủ (2 câu) mà khách VẪN chê giá -> GẮN người thật IM LẶNG (không nhắn "chờ/báo lại").
        await tagChoXuLyVaUnread(conversationId);
        console.log(`[${BOT_NAME}] Khách vẫn chê giá sau ${_pvCount} câu thuyết phục -> CHỜ XL người thật (im lặng).`);
        mem.botHandoffAt = Date.now();
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      const reply = _PRICE_VALUE_LINES[_pvCount];   // ĐÚNG THỨ TỰ: lần 1 -> câu 1 (ưu tiên), lần 2 -> câu 2
      await sendInboxMessage(conversationId, reply);
      mem.priceObjectionCount = _pvCount + 1;
      mem.priceObjectionHandled = true;   // giữ tương thích cờ cũ
      console.log(`[${BOT_NAME}] Khách phản đối giá (lần ${_pvCount + 1}) -> thuyết phục câu ${_pvCount + 1}/${_PRICE_VALUE_LINES.length} (không báo lại giá).`);
      mem.lastBotReply = reply;
      scheduleFollowup(conversationId, mem, productInfo, reply);
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== (8) KHÁCH LO UY TÍN / SỢ BOM / SỢ LỪA / hàng giả hình -> trấn an COD (kiểm tra trước khi trả tiền) =====
    if (fearsTrustOrScam(latestText) && !priceAsk && !asksOrderStatus(latestText)) {
      const reply = _rotLine(mem, "_trustIdx", _TRUST_LINES);
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách lo uy tín/bom hàng -> trấn an COD (kiểm tra trước khi trả tiền).`);
      mem.lastBotReply = reply;
      if (productInfo) scheduleFollowup(conversationId, mem, productInfo, reply);
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== (5) BAO GIỜ CÓ HÀNG/MÀU/SIZE LẠI (restock) -> mẫu hết KHÔNG tái sản xuất =====
    if (asksRestock(latestText) && !asksOrderStatus(latestText)) {
      const reply = "Dạ mẫu/size/màu này bên em tạm hết ạ. Các mẫu đã hết thì bên em không tái sản xuất lại nữa, nên chị chốt sớm các mẫu còn lại để khỏi lỡ nha ạ.";
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi restock -> mẫu hết không tái sản xuất.`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== (3) BẦU / SAU SINH mặc được không -> HỎI mấy tháng + nhường người thật (không tự khẳng định) =====
    // Điều phối theo NHÃN AI: PREGNANCY_FIT (đã tách riêng khỏi FIT_SUITABILITY). regex asksPregnancyFit chỉ là
    //  lưới phụ khi AI bí. KHÔNG dùng FIT_SUITABILITY ở đây (nhãn đó giờ chỉ là hợp dáng/tông da, không phải bầu).
    if (_ai("PREGNANCY_FIT") || asksPregnancyFit(latestText)) {
      const reply = "Dạ chị bầu được mấy tháng rồi ạ? Chị cho em xin số đo cụ thể để em tư vấn thoải mái và đúng size cho mình nha.";
      await sendInboxMessage(conversationId, reply);
      await tagChoXuLyVaUnread(conversationId);   // không chắc chắn về mặc-được -> để người thật xác nhận
      mem.botHandoffAt = Date.now();
      console.log(`[${BOT_NAME}] Khách hỏi bầu/sau sinh -> hỏi mấy tháng + nhường người thật (không tự khẳng định).`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== (4) HÀNG CÓ SẴN HAY ĐẶT TRƯỚC -> có sẵn + ưu tiên gửi sớm; đuôi chốt ĐỘNG (có size ko xin size...) =====
    if ((_aiOr(asksInStockOrPreorder(latestText), "RESTOCK_PREORDER")) && productInfo && !asksOrderStatus(latestText)) {
      const reply = "Dạ hàng bên em có sẵn nha chị. Một ngày bên em có rất nhiều khách đặt nên mẫu có sẵn sẽ ưu tiên gửi cho khách đặt trước, " + _closeTail(mem, productInfo);
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi có sẵn/đặt trước -> có sẵn + ưu tiên + đuôi chốt động.`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH HỎI "NGOÀI ĐỜI CÓ ĐẸP NHƯ HÌNH" -> trấn an NHẸ NHÀNG, KHÔNG nhắc hoàn/hủy =====
    if ((asksLooksLikePhotos(latestText) || _ai("AUTHENTICITY_QA")) && !priceAsk) {
      const reply = buildLooksReassure(mem);
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi đẹp như hình -> trấn an nhẹ (không nhắc hoàn/hủy).`);
      mem.lastBotReply = reply;
      scheduleFollowup(conversationId, mem, productInfo, reply);
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH LĂN TĂN / lo CHẤT LƯỢNG -> THUYẾT PHỤC (hàng thiết kế), KHÔNG chốt vồ vập =====
    // (đặt trước nhánh hỏi giá/size để khách phân vân được trấn an trước, không bị đẩy chốt luôn)
    // ===== KHÁCH HỎI CHÍNH SÁCH hoàn/hủy/đổi/trả -> CHỈ Ở ĐÂY mới nói "không hoàn-hủy" =====
    // ===== KHÁCH HỎI VÌ SAO KHÔNG ĐƯỢC MẶC THỬ -> giải thích đồng cảm (giữ hàng mới 100%), vẫn được kiểm tra =====
    if (asksWhyNoTryOn(latestText) && !_nhanCamRegex(mem, "asksWhyNoTryOn", ["TRYON_REQUEST", "INSPECT_REQUEST"])) {
      const reply = "Dạ bên em rất hiểu tâm lý muốn thử trước khi nhận hàng của mình ạ. Tuy nhiên để đảm bảo sản phẩm luôn ở tình trạng mới 100% và giữ tiêu chuẩn chất lượng cho tất cả khách hàng, đơn vị vận chuyển sẽ chưa hỗ trợ mặc thử khi giao hàng. Chị vẫn được kiểm tra kỹ sản phẩm trước khi thanh toán để yên tâm nhận hàng ạ";
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi vì sao không được thử -> giải thích đồng cảm.`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH HỎI CÓ ĐƯỢC MẶC/THỬ HÀNG -> được kiểm tra, nhưng CHƯA hỗ trợ mặc thử =====
    if (asksTryOn(latestText) || _ai("TRYON_REQUEST")) {
      const reply = "Dạ khi nhận hàng, chị có thể kiểm tra sản phẩm trước khi thanh toán ạ. Tuy nhiên chị lưu ý giúp em sản phẩm sẽ chưa hỗ trợ mặc thử trong quá trình giao nhận hàng ạ";
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi mặc/thử hàng -> được kiểm tra, chưa mặc thử.`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH HỎI XEM HÀNG / ĐỒNG KIỂM (không hỏi thử) -> khẳng định được kiểm tra + ĐUÔI LINH HOẠT =====
    if (asksInspectBeforePay(latestText) || _ai("INSPECT_REQUEST")) {
      // Đầu câu trấn an kiểm hàng; ĐUÔI theo tình trạng (chưa có size -> hỏi size; có size thiếu liên hệ -> xin sđt/địa chỉ;
      // đủ hết -> mới mời lên đơn) — KHÔNG mời "lên đơn" cứng khi còn thiếu thông tin.
      const _head = "Dạ khi nhận hàng chị có thể kiểm tra sản phẩm trước khi thanh toán nha 💕 Bên em cho kiểm hàng trước vì rất tự tin vào chất lượng sản phẩm của mình ạ.";
      let _tail = "";
      if (productInfo) { try { _tail = sizeTailForProduct(mem, productInfo) || ""; } catch (_) {} }
      const reply = _head + _tail;
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi xem hàng/đồng kiểm -> khẳng định kiểm tra + đuôi linh hoạt (size/liên hệ/mời chốt).`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    if (_aiOr(asksReturnPolicy(latestText), "RETURN_POLICY")) {
      const reply = "Dạ bên em hỗ trợ ĐỔI size/mẫu trong 15 ngày chị nha, điều kiện sản phẩm chưa qua sử dụng và còn nguyên tem mác ạ. Bên em chưa hỗ trợ hoàn/trả tiền nha chị";
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi chính sách hoàn/hủy/đổi -> trả chính sách (chỉ khi được hỏi).`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH HỎI "ÁO HAY VÁY HAY SET / LÀ GÌ" -> trả CHỦNG LOẠI từ sheet TRƯỚC (không nhả action) =====
    if (asksCategory(latestText) && productInfo) {
      const reply = categoryReplyFromSheet(productInfo);
      if (reply) {
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Khách hỏi loại (áo/váy/set) -> trả chủng loại: ${productInfo.category}`);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
    }

    // ===== KHÁCH HỎI CHẤT LIỆU / VẢI -> trả từ SHEET (KHÔNG bịa, KHÔNG nhả câu hoàn-hủy) =====
    // ===== KHÁCH XIN ẢNH MẶT SAU (hoặc mặt trước+sau) -> bot CHƯA có nhận diện ảnh mặt sau đáng tin
    //       -> ÂM THẦM gắn NGƯỜI THẬT (AI-CHỜ XL) để xử lý. KHÔNG nhắn khách gì (không hứa suông). =====
    if (_aiOr(wantsBackView(latestText), "BACK_VIEW")) {
      await tagChoXuLyVaUnread(conversationId);
      mem.botHandoffAt = Date.now(); mem.lastBotReply = "[mặt sau - chờ NV]";
      console.log(`[${BOT_NAME}] Khách xin ảnh MẶT SAU -> bot chưa nhận diện ảnh mặt sau -> ÂM THẦM gắn AI-CHỜ XL (KHÔNG nhắn khách).`);
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH CHÊ/LO CẠP CHUN -> trấn an theo thiết kế (kịch bản cố định) =====
    if (worriesElasticWaist(latestText)) {
      const reply = "Dạ cạp chun bây giờ thiết kế bản đẹp, mặc lên vẫn gọn gàng và lịch sự chị ạ, mà được cái thoải mái cả ngày, ngồi lâu hay ăn uống đều dễ chịu hơn cạp cứng nhiều ạ";
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách lo cạp chun -> trấn an theo thiết kế.`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH XIN ẢNH/QUAY CHỤP THỰC TẾ TẠI SHOP -> bot không tự chụp được -> ÂM THẦM gắn AI-XL ảnh =====
    if (asksSpecificPhoto(latestText) && !_nhanCamRegex(mem, "asksSpecificPhoto", ["IMAGE_REQ", "BACK_VIEW"])) {
      await tagXuLyAnhVaUnread(conversationId);
      mem.botHandoffAt = Date.now(); mem.lastBotReply = "[ảnh chi tiết - chờ NV]";
      console.log(`[${BOT_NAME}] Khách xin ảnh CHI TIẾT -> ÂM THẦM gắn AI-XL ảnh (NV chụp/bổ sung, không nhắn khách).`);
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    if (asksShopLivePhoto(latestText) && !_nhanCamRegex(mem, "asksShopLivePhoto", ["IMAGE_REQ"])) {
      const reply = "Dạ phần ảnh chụp thực tế tại shop để em nhờ bạn bên kho chụp rồi gửi mình ngay nha ạ";
      await sendInboxMessage(conversationId, reply);
      await tagChoXuLyVaUnread(conversationId);
      console.log(`[${BOT_NAME}] Khách xin ảnh chụp thực tế tại shop -> CHỜ XL người thật (không trả bừa).`);
      mem.lastBotReply = reply; mem.botHandoffAt = Date.now();
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH NGHI ẢNH KHÔNG THẬT -> gửi lại ảnh + khẳng định ảnh thật của thương hiệu; nghi tiếp -> NGƯỜI THẬT =====
    if (doubtsPhotosReal(latestText) && productInfo) {
      if (mem.photoRealAsserted) {
        // đã khẳng định 1 lần mà khách vẫn nghi -> nhường người thật
        const reply = "Dạ để em nhờ bạn bên shop gửi thêm hình thực tế cho mình yên tâm nha ạ";
        await sendInboxMessage(conversationId, reply);
        await tagChoXuLyVaUnread(conversationId);
        console.log(`[${BOT_NAME}] Khách vẫn nghi ảnh thật sau khi đã khẳng định -> CHỜ XL người thật.`);
        mem.lastBotReply = reply; mem.botHandoffAt = Date.now();
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      await maybeSendImages(conversationId, productInfo.code, mem, true);
      const reply = "Dạ đây là hình ảnh do thương hiệu bên em tự sản xuất ra chứ không phải lấy trên mạng đâu ạ, chị yên tâm nha";
      await sendInboxMessage(conversationId, reply);
      mem.photoRealAsserted = true;
      console.log(`[${BOT_NAME}] Khách nghi ảnh thật -> gửi ảnh + khẳng định ảnh thương hiệu.`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH HỎI NGƯỜI MẪU CAO/NẶNG/MẶC SIZE GÌ -> trả đúng ý; cân nặng chỉ nói khi khách hỏi tới =====
    if (_aiOr(asksModelSize(latestText), "MODEL_REFERENCE")) {
      const asksWeightToo = /(nặng|cân|kg|kí|ký)/i.test(latestText);
      // Khách hỏi "mẫu mặc SIZE gì / sz mấy" -> trả SIZE người mẫu (không phải chiều cao).
      const asksWornSize = /(size|sz)\s*(gì|gi|nào|nao|mấy|may|bao nhiêu|bn)|(mặc|mac)\s*(là )?(size|sz)/i.test(latestText);
      let reply;
      if (asksWornSize) {
        reply = `Dạ người mẫu bên em đang mặc size ${MODEL_SIZE} ạ. Mẫu này mặc lên tôn dáng lắm, chị cho em xin chiều cao cân nặng để em tư vấn size chuẩn cho mình nha ạ`;
      } else if (asksWeightToo) {
        reply = `Dạ người mẫu bên em cao ${MODEL_HEIGHT}, nặng ${MODEL_WEIGHT} ạ. Mẫu này lên dáng rất tôn người đó chị`;
      } else {
        reply = `Dạ người mẫu bên em cao ${MODEL_HEIGHT} ạ. Mẫu này mặc lên tôn dáng lắm, chị mặc cũng sẽ rất đẹp đó ạ`;
      }
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi người mẫu ${asksWornSize ? "MẶC SIZE -> " + MODEL_SIZE : "cao/nặng -> " + MODEL_HEIGHT + (asksWeightToo ? "/" + MODEL_WEIGHT : "")}.`);
      mem.lastBotReply = reply;
      scheduleFollowup(conversationId, mem, productInfo, reply);
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH LO VÁY NGẮN -> trấn an theo thiết kế (tối ưu tỷ lệ, tôn dáng); kèm chiều cao mẫu nếu khách hỏi luôn =====
    if (worriesShort(latestText)) {
      const scripts = [
        "Dạ mẫu này theo tinh thần tối ưu tỷ lệ cơ thể nên phần chiều dài được tính toán kỹ lắm chị. Khi mặc lên sẽ cho hiệu ứng vóc dáng cao hơn, gọn hơn và rất tôn dáng ạ",
        "Dạ đây là độ dài chủ đích của thiết kế chị nhé. Lên dáng sẽ giúp tỷ lệ cơ thể cân đối hơn, tạo cảm giác cao và thanh thoát hơn rất nhiều ạ",
      ];
      mem.shortIdx = ((mem.shortIdx || 0) + 1) % scripts.length;
      let reply = scripts[mem.shortIdx];
      if (asksModelSize(latestText)) reply += ` Người mẫu bên em cao ${MODEL_HEIGHT} ạ.`;   // hỏi luôn chiều cao mẫu -> trả kèm
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách lo váy ngắn -> trấn an theo thiết kế.`);
      mem.lastBotReply = reply;
      scheduleFollowup(conversationId, mem, productInfo, reply);
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH HỎI PHOM & Mys.P CÓ PHẢI 1 SHOP -> CÙNG 1 HỆ THỐNG =====
    if (_aiOr(asksSameShop(latestText), "SAME_SHOP_QA")) {
      const _pi = productInfo || (mem.quotedProducts || [])[0] || null;
      const _tail = _pi ? (" " + _cap(_closeTail(mem, _pi))) : " Chị ưng mẫu nào nhắn em để em tư vấn thêm cho mình nha ạ.";
      const reply = "Dạ vâng, PHOM và Mys.P là cùng một hệ thống của shop mình ạ, chị yên tâm nha." + _tail;
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi PHOM & Mys.P -> cùng 1 hệ thống + câu hành động.`);
      scheduleFollowup(conversationId, mem, _pi, reply);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH ĐÃ ĐẶT / muốn ĐI-LÊN ĐƠN qua kênh TIKTOK -> nhường NGƯỜI THẬT (bot KHÔNG xử đơn TikTok) =====
    // "Nay đi đơn bên tiktok cho mình nha" = khách đã đặt, muốn lên đơn qua TikTok -> gắn AI-CHỜ XL, KHÔNG nhắn.
    if (_aiOr(/(đi|lên|chốt|đặt)\s*đơn.{0,20}(tiktok|tik ?tok|tóp ?tóp)|(tiktok|tik ?tok|tóp ?tóp).{0,15}(đi|lên|chốt)\s*đơn/i.test(latestText), "TIKTOK_ORDER")) {
      try { await tagChoXuLyVaUnread(conversationId); } catch (_) {}
      console.log(`[${BOT_NAME}] Khách đi/lên đơn qua TikTok (đã đặt) -> nhường NGƯỜI THẬT (AI-CHỜ XL), KHÔNG nhắn.`);
      mem.botHandoffAt = Date.now(); updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH HỎI BÁN TRÊN SÀN SHOPEE -> shop CHỈ bán Facebook (TikTok chỉ vài mẫu, nói khi được hỏi) =====
    if (_aiOr(asksSellOnShopee(latestText), "ASK_SHOPEE")) {
      const _pi = productInfo || (mem.quotedProducts || [])[0] || null;
      const _tail = _pi ? (" " + _cap(_closeTail(mem, _pi))) : " Chị ưng mẫu nào nhắn em để em tư vấn thêm cho mình nha ạ.";
      const reply = "Dạ hiện tại shop em không mở bán trên sàn Shopee ạ, các mẫu mới bên em đều cập nhật ở Facebook ạ." + _tail;
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi bán Shopee -> KHÔNG bán Shopee (cập nhật ở Facebook) + câu hành động.`);
      scheduleFollowup(conversationId, mem, _pi, reply);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH HỎI BÁN TRÊN TIKTOK -> CÓ nhưng chỉ vài mẫu; đầy đủ ở Facebook =====
    if (_aiOr(asksSellOnTiktok(latestText), "ASK_TIKTOK")) {
      const _pi = productInfo || (mem.quotedProducts || [])[0] || null;
      const _tail = _pi ? (" " + _cap(_closeTail(mem, _pi))) : " Chị ưng mẫu nào nhắn em để em tư vấn thêm cho mình nha ạ.";
      const reply = "Dạ bên em có TikTok nhưng chỉ cập nhật một số mẫu thôi ạ, đầy đủ mẫu mới thì chị xem ở Facebook nha." + _tail;
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi bán TikTok -> CÓ nhưng vài mẫu, đầy đủ ở Facebook + câu hành động.`);
      scheduleFollowup(conversationId, mem, _pi, reply);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH HỎI "CÓ QUẦN/LỚP LÓT BÊN TRONG KHÔNG" -> đọc MÔ TẢ; có ghi -> trả lời, KHÔNG có -> NGƯỜI THẬT =====
    // (KHÔNG tự bịa "có/không" vì là thuộc tính thật của mẫu. Thu Thuỷ Lương: "co quân bên trong ko shop".)
    if ((asksInnerLining(latestText) || mem._aiConcern === "lot") && productInfo && !_multiAttrQ) {
      const _src = (String(productInfo.description || "") + " " + String(productInfo.material || "") + " " + String(productInfo.padInfo || ""))
        .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
      const _hasLining = /(quan trong|quan lot|quan bao ho|quan dui|co quan|lop lot|lot lien|lien quan|vay lot|lot vay|lot ben trong|co lot|2\s*lop|hai\s*lop|02\s*lop)/.test(_src)
        && !/(khong|ko|chua)\s*(co\s*)?(quan|lot)/.test(_src);
      // Khách hỏi RÕ "QUẦN trong" (vd "váy có quần trong không") mà mô tả CHỈ ghi "2 lớp/lót" chung chung
      // (KHÔNG ghi rõ chữ QUẦN) -> KHÔNG khẳng định có/không (vì "2 lớp" có thể là lót VÁY, không phải quần)
      // -> NGƯỜI THẬT xác nhận. (Theo yêu cầu shop: hỏi chi tiết quần lót thì không được tự nói có/không.)
      const _asksPants = /quan/.test(String(latestText || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
      const _descSaysPants = /(quan trong|quan lot|quan bao ho|quan dui|co quan|lot quan|quan ben trong|quan\s*2\s*lop)/.test(_src)
        && !/(khong|ko|chua)\s*(co\s*)?quan/.test(_src);
      if (_asksPants && !_descSaysPants) {
        const reply = "Dạ phần quần/lót bên trong của mẫu này em kiểm tra lại cho chính xác rồi báo chị ngay nha ạ.";
        await sendInboxMessage(conversationId, reply);
        await tagChoXuLyVaUnread(conversationId);
        mem.botHandoffAt = Date.now();
        console.log(`[${BOT_NAME}] Hỏi RÕ "quần trong" nhưng mô tả chỉ ghi "2 lớp/lót" (không rõ QUẦN) -> NGƯỜI THẬT (không bịa).`);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      if (_hasLining) {
        const reply = "Dạ mẫu này có lớp lót/quần bên trong ạ, chị yên tâm mặc không lo lộ nha.";
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Hỏi "có quần/lót bên trong" -> mô tả CÓ ghi -> trả lời CÓ.`);
        scheduleFollowup(conversationId, mem, productInfo, reply);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // Mô tả KHÔNG ghi -> KHÔNG bịa. Nhờ người thật xác nhận chính xác cho khách.
      const reply = "Dạ phần lót/quần bên trong của mẫu này em kiểm tra lại cho chính xác rồi báo chị ngay nha ạ.";
      await sendInboxMessage(conversationId, reply);
      await tagChoXuLyVaUnread(conversationId);
      mem.botHandoffAt = Date.now();
      console.log(`[${BOT_NAME}] Hỏi "có quần/lót bên trong" nhưng mô tả KHÔNG ghi -> NGƯỜI THẬT (không bịa).`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH HỎI CO GIÃN -> chỉ trả nếu SHEET có thông tin; KHÔNG có -> NGƯỜI THẬT (TUYỆT ĐỐI không báo giá) =====
    if ((asksBreastPad(latestText) || mem._aiConcern === "dem") && productInfo && !_multiAttrQ) {
      // Cột R (chỉ số 17) -> product.padInfo. Có ghi "đệm/mút/lót ngực" (và không phủ định) -> CÓ đệm.
      const padRaw = String(productInfo.padInfo || productInfo.breastPad || "").toLowerCase();
      const padFold = padRaw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
      const hasPad = /(dem|mut|lot|don)/.test(padFold) && !/(khong|ko|chua|no)\s*(co\s*)?(dem|mut|lot|don)/.test(padFold);
      let reply;
      if (hasPad) {
        reply = _rotLine(mem, "_padIdx", [
          "Dạ có sẵn đệm ngực luôn chị nha, mặc lên gọn gàng tôn dáng mà khỏi cần mặc thêm áo trong, tiện lắm ạ",
          `Dạ ${productLabel(productInfo)} có đệm ngực sẵn nha chị, mặc vào là gọn gàng tôn dáng luôn ạ ❤️`,
        ]) + ". " + _cap(_closeTail(mem, productInfo));
      } else {
        // Cột R TRỐNG / không ghi -> hiểu là KHÔNG có đệm. Xoay 2 câu.
        const noPad = [
          "Dạ mẫu này thiết kế không có đệm ngực chị ạ, để giữ form áo mềm mại, lên dáng tự nhiên hơn. Đệm cố định nhiều khi không vừa với mọi người nên bên em để trống cho chị dễ tùy chỉnh theo ý mình ạ.",
          "Dạ mẫu này bên em không kèm đệm ngực nha chị, vừa giúp áo nhẹ thoáng hơn, vừa không lo đệm bị xô lệch hay vón sau khi giặt ạ. Nếu chị thích thì có thể lót thêm miếng dán hoặc mặc áo trong tùy ý ạ.",
        ];
        mem.padIdx = (mem.padIdx || 0) % noPad.length;
        reply = noPad[mem.padIdx];
        mem.padIdx += 1;
      }
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi đệm ngực -> ${hasPad ? "CÓ đệm (cột R)" : "KHÔNG đệm (mặc định)"}.`);
      scheduleFollowup(conversationId, mem, productInfo, reply);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    if ((asksStretch(latestText) || mem._aiConcern === "cogian") && productInfo && !_multiAttrQ) {
      const _sr = stretchReplyFromSheet(productInfo, mem);   // ĐỌC CỘT S (product.stretch), không suy từ cột chất liệu
      if (_sr) {
        await sendInboxMessage(conversationId, _sr);
        console.log(`[${BOT_NAME}] Hỏi co giãn -> cột S "${productInfo.stretch}" -> trả lời.`);
        mem.lastBotReply = _sr; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      const wait = "Dạ phần co giãn của mẫu này để em kiểm tra kỹ rồi báo lại mình ngay nha ạ";
      await sendInboxMessage(conversationId, wait);
      await tagChoXuLyVaUnread(conversationId);
      console.log(`[${BOT_NAME}] Hỏi co giãn nhưng cột S trống -> CHỜ XL người thật (không báo giá).`);
      mem.lastBotReply = wait; mem.botHandoffAt = Date.now();
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // Hỏi CẢM GIÁC/TÍNH CHẤT VẢI (mềm/cứng/dày/mỏng/nóng/mát...) -> CHỜ XL người thật, KHÔNG báo giá, KHÔNG tự đoán.
    if (asksFabricFeel(latestText) && !asksStretch(latestText) && !_multiAttrQ) {
      const _mat = materialReplyFromSheet(productInfo);   // sheet có chất liệu -> nói chất liệu, nhường người thật phần mềm/cứng
      const wait = _mat
        ? `${_mat}. Còn độ mềm/cứng cụ thể chị chờ em kiểm tra kỹ rồi báo lại mình ngay nha ạ`
        : "Dạ phần chất vải mẫu này để em kiểm tra kỹ rồi báo lại mình ngay nha ạ";
      await sendInboxMessage(conversationId, wait);
      await tagChoXuLyVaUnread(conversationId);
      mem.botHandoffAt = Date.now();
      console.log(`[${BOT_NAME}] Khách hỏi cảm giác vải (mềm/cứng/dày/mỏng...) -> CHỜ XL, KHÔNG báo giá.`);
      mem.lastBotReply = wait; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // [GUARD béo/dáng] AI hay gắn nhầm concern=chat cho câu lo BÉO/BỤNG ("bụng c to", "mặc sợ béo").
    //  Nếu khách đang lo DÁNG (worriesAboutLook) mà KHÔNG thực sự hỏi vải -> BỎ cờ chat, để rớt xuống trấn an dáng.
    // [GUARD cờ mồ côi - ca Hân Ngô 2026-07-11] concern=chat còn bị dính từ NGỮ CẢNH CŨ vào tin chẳng liên quan
    //  ("Dạ đúng rồi ạ" - khách đang XÁC NHẬN đổi hàng) -> handler chất liệu cướp lượt, báo giá + ảnh vô duyên.
    //  Luật: cờ phụ phải có BẰNG CHỨNG TRONG CHÍNH TIN NÀY — tin không có lấy 1 từ về vải/cảm giác mặc thì
    //  concern=chat đơn độc KHÔNG được kích handler (nhãn MATERIAL_QA thật thì vẫn chạy bình thường).
    const _matEvidence = /(chất|chat lieu|vải|vai|đũi|dui|linen|cotton|voan|lụa|lua|tơ|thô|tho|nóng|nong|mát|mat|nhăn|nhan|dày|day|mỏng|mong|xù|bai|co giãn|co gian|codan)/i.test(String(latestText || ""));
    const _matByConcernOnly = (mem._aiConcern === "chat") && !asksMaterial(latestText) && !_ai("MATERIAL_QA");
    if (_matByConcernOnly && !_matEvidence) {
      console.log(`[${BOT_NAME}] concern=chat MỒ CÔI (tin "${String(latestText || "").slice(0, 25)}" không có chữ nào về vải) -> BỎ cờ, không cướp lượt.`);
      mem._aiConcern = null;
    }
    const _sgMatOff = (() => { try { const p = saleProgram(mem._pageId); return !!(p && p.che_do_sale_gon) || cheDoChiBaoGia(); } catch (_) { return false; } })();
    if (!_sgMatOff && ((!mem._aiOk && asksMaterial(latestText)) || _ai("MATERIAL_QA") || (mem._aiConcern === "chat" && !(worriesAboutLook(latestText) && _matByConcernOnly))) && productInfo && !_multiAttrQ) {
      const reply = materialReplyFromSheet(productInfo);
      if (reply) {
        // THÂN: trả lời xong kèm HÀNH ĐỘNG đẩy về size/chốt. KẾT (đã chốt): CHỈ trả lời, KHÔNG nài lên đơn lại.
        let full = reply;
        if (!mem.orderClosed) {
          const _tail = _cap(_closeTail(mem, productInfo));
          if (_tail) full = `${reply} ${_tail}`;
        }
        // [FIX Thanh Tran] Mẫu CHƯA TỪNG báo giá mà khách hỏi chất liệu (Genova) -> BÁO GIÁ + ẢNH TRƯỚC, rồi trả
        //   lời chất liệu (đúng nguyên tắc "quan tâm mẫu chưa báo giá -> báo giá trước"). force=false: ảnh đã gửi thì bỏ qua.
        const _muUp = String(productInfo.code || "").toUpperCase();
        const _muPl = priceLine(productInfo);
        const _muQuoteNow = _muPl && !quotedRecently(mem, productInfo.code) && !(mem.pricedCodes || []).some(c => String(c).toUpperCase() === _muUp);
        if (_muQuoteNow) { full = `Dạ ${productLabel(productInfo)} ${_muPl}. ${full.replace(/^Dạ\s*/i, "")}`; markPriced(mem, productInfo.code); }
        await sendInboxMessage(conversationId, full);
        if (_muQuoteNow) { try { mem._imgAllowSend = true; await maybeSendImages(conversationId, productInfo.code, mem, false); } catch (_) {} }
        scheduleFollowup(conversationId, mem, productInfo, full);   // tự né khi đã chốt
        console.log(`[${BOT_NAME}] Khách hỏi chất liệu -> ${_muQuoteNow ? "BÁO GIÁ + ẢNH trước rồi " : ""}trả từ sheet${mem.orderClosed ? " (đã chốt: chỉ trả lời)" : " + CTA"}: ${productInfo.material}`);
        mem.lastBotReply = full; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // sheet không có chất liệu -> CHỜ XL (không bịa)
      const wait = "Dạ chị chờ em kiểm tra lại chất liệu mẫu này rồi báo mình ngay nha ạ";
      await sendInboxMessage(conversationId, wait);
      await tagChoXuLyVaUnread(conversationId);
      console.log(`[${BOT_NAME}] Khách hỏi chất liệu nhưng sheet KHÔNG có -> CHỜ XL + thẻ.`);
      mem.lastBotReply = wait; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH HỎI SIZE CÁC MẪU CÓ GIỐNG NHAU KHÔNG (nhãn AI SIZE_CONSISTENCY) =====
    // Giải thích: mỗi mẫu thông số riêng nên size khác nhau tùy form. Chưa có size -> luân phiên 3 câu (kèm xin cao/nặng);
    //  đã có size -> chỉ giải thích gọn.
    if (_ai("SIZE_CONSISTENCY")) {
      const _hasSize = mem.customerSize || mem.measure3V || mem.weightKg;
      let reply;
      if (_hasSize) {
        reply = "Dạ mỗi mẫu bên em có thông số riêng nên size sẽ khác nhau một chút tùy kiểu dáng chị ạ.";
      } else {
        const _SC_LINES = [
          "Dạ mỗi mẫu bên em có thông số riêng nên size sẽ khác nhau một chút tùy kiểu dáng ạ. Chị cho em xin chiều cao và cân nặng để em tư vấn size chuẩn cho mình nha!",
          "Dạ mỗi mẫu có thông số riêng nên size khác nhau tùy form chị nha. Chị cho em xin chiều cao, cân nặng để em tư vấn size chuẩn cho mẫu này nha!",
          "Dạ size mỗi mẫu khác nhau tùy form ạ. Chị cho em xin cao/nặng để em tư vấn đúng size mẫu này nha!"
        ];
        mem.scIdx = ((mem.scIdx || 0) + 1) % _SC_LINES.length;
        reply = _SC_LINES[mem.scIdx];
      }
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi size các mẫu có giống nhau (SIZE_CONSISTENCY) -> giải thích thông số riêng tùy form${_hasSize ? "" : " + xin cao/nặng"}.`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== LO SIZE KHÔNG VỪA (nhãn AI SIZE_ADVICE: "sợ không vừa/sợ chật") -> trấn an + XIN SỐ ĐO tư vấn size =====
    // Tách khỏi "lăn tăn chất lượng" (buildReassureReply). Đây là lo VỪA NGƯỜI -> hỏi số đo để tư vấn size đúng.
    if (_ai("SIZE_ADVICE") && !priceAsk && !asksSizeChart(latestText)
        && !isAskingSizeAdvice(latestText)) {   // nếu khách đã kèm số đo/size -> để nhánh tư vấn size theo số đo lo
      const hasInfo = mem.customerSize || mem.measure3V || mem.weightKg;
      const reply = hasInfo
        ? "Dạ với số đo của chị thì em tư vấn size vừa form, mặc lên rất tôn dáng và thoải mái nên chị yên tâm nha ạ."
        : "Dạ chị yên tâm nha, mẫu này bên em có nhiều size. Chị cho em xin chiều cao cân nặng để em tư vấn size vừa vặn chuẩn cho mình nha ạ.";
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách LO SIZE không vừa (SIZE_ADVICE) -> trấn an + xin số đo tư vấn size.`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    if (isQualityHesitation(latestText) && !priceAsk && !asksSizeChart(latestText)) {
      // Mẫu CÓ nghệ sĩ diện (cột V) -> thuyết phục bằng ẢNH NGHỆ SĨ (1 lần/mã); KHÔNG có thì trấn an thường.
      if (await maybeSendCelebPitch(conversationId, productInfo, mem)) {
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      const reply = buildReassureReply(mem);
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách lăn tăn/lo chất lượng -> thuyết phục (hàng thiết kế), không chốt vồ vập.`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH HỎI "ĐỊA CHỈ CŨ LÀ GÌ / ĐỊA CHỈ NÀO" -> trả địa chỉ ĐANG LƯU, KHÔNG BỊA =====
    if (asksWhatOldAddress(latestText) && !_nhanCamRegex(mem, "asksWhatOldAddress", ["ADDRESS", "SEND_ADDRESS_LATER"])) {
      let reply;
      if (mem.address && String(mem.address).trim().length >= 6) {
        reply = `Dạ địa chỉ em đang lưu của chị là: ${mem.address}${mem.phone ? " - SĐT " + mem.phone : ""} ạ. Mình giao về đây đúng không chị`;
      } else {
        reply = "Dạ chị cho em xin lại địa chỉ nhận hàng (số nhà, đường, phường/xã, tỉnh/thành) để em lên đơn cho chính xác nha ạ";
      }
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi địa chỉ cũ -> ${mem.address ? "trả địa chỉ đã lưu" : "XIN LẠI (không bịa)"}.`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH HỎI MÀU CÓ HỢP TÔNG DA KHÔNG -> NGHIÊNG HẲN 1 MÀU + mời chốt (KHÔNG lặp gửi ảnh) =====
    if (asksSkinToneFit(latestText) && !_nhanCamRegex(mem, "asksSkinToneFit", ["FIT_SUITABILITY", "COLOR_ASK", "OCCASION_QA"])) {
      const t = latestText.toLowerCase();
      const dark = _isDarkSkin(t);
      const code = productInfo ? String(productInfo.code || "").toUpperCase() : "";
      const cols = productInfo ? colorListForModel(productInfo, code) : [];
      const rec = colorForSkin(cols, dark);   // màu nghiêng theo tông da
      let reply;
      if (dark) {
        reply = rec
          ? `Dạ làn da ngăm mặc tông sáng là tôn nhất ạ, em nghiêng về màu ${rec} — lên dáng sáng da và nổi bật hơn đó chị`
          : `Dạ làn da ngăm hợp các tông sáng như kem, be, pastel ạ, mặc lên sáng da và tôn người hơn đó chị`;
      } else {
        reply = rec
          ? `Dạ da chị sáng thì mặc màu nào cũng tôn ạ, cả tông trầm lẫn tông sáng đều hợp và lên dáng đẹp. Em nghiêng về màu ${rec} hơn, trông tây và sang chị ạ`
          : `Dạ da chị sáng thì mặc màu nào cũng tôn ạ, cả tông trầm lẫn tông sáng đều hợp và lên dáng đẹp chị ạ`;
      }
      // Nhớ màu nghiêng + mời CHỐT (không gửi lại ảnh).
      if (rec && productInfo) {
        mem.pendingColorConfirm = { code, color: rec };
        const haveSize = mem.customerSize && mem.customerSize !== "FREESIZE";
        reply += haveSize
          ? ` Chị ưng em lên đơn màu ${rec} size ${mem.customerSize} cho mình nha ạ.`
          : ` Chị ưng màu ${rec} em lên đơn cho mình nha ạ.`;
      }
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Hỏi màu hợp TÔNG DA (${dark ? "ngăm" : "sáng"}) -> nghiêng "${rec || "(không có mẫu)"}" + mời chốt.`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH HỎI "MÀU NÀO ĐẸP HƠN" (phân vân MÀU của mẫu đang xem, KHÔNG phải chọn mẫu) =====
    if ((_aiOr(asksWhichColorNicer(latestText), "COMPARE_MODELS")) && productInfo) {
      const code = String(productInfo.code || "").toUpperCase();
      const byKey = new Map();
      for (const c of [...cleanColors(productInfo.color), ...(getCodeColors(code) || [])]) {
        const k = _foldKey(c); if (k && !byKey.has(k)) byKey.set(k, c);
      }
      const cols = [...byKey.values()];
      const reply = colorAdviceReply(cols);
      // NHỚ màu nghiêng (rec) -> khách "lấy cho c"/"ok" sau đó hiểu là lấy ĐÚNG màu này (không hỏi lại).
      const rec = recommendedColorOf(cols);
      if (rec && cols.length >= 2) mem.pendingColorConfirm = { code, color: rec };
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi MÀU nào đẹp hơn (mẫu ${code}) -> tư vấn MÀU + nghiêng "${rec}", KHÔNG recommend mẫu.`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH NHỜ TƯ VẤN CHỌN 1 MẪU ĐÃ XEM ("mẫu nào đẹp", "nên lấy mẫu nào") -> KHÔNG gửi mẫu mới =====
    if ((_aiOr(asksAdviceAmongShown(latestText), "COMPARE_MODELS")) && !extractColor(latestText)) {
      // Chọn 1 mẫu trong các mẫu khách ĐÃ xem: ưu tiên mẫu đang focus, rồi mẫu đã báo giá, còn bán + không hết.
      const cand = [];
      if (productInfo) cand.push(productInfo);
      for (const p of (mem.quotedProducts || [])) cand.push(p);
      let pick = null;
      try {
        const cat = await ensureCatalog();
        for (const p of cand) {
          const full = p && (cat.byCode.get(String(p.code || "").toUpperCase()) || p);
          if (full && recommend.sellable(full) && !recommend.isOutOfStock(full)) { pick = full; break; }
        }
      } catch (_) { pick = cand.find(Boolean) || null; }

      if (pick) {
        const nm = productLabel(pick);
        const reply = `Dạ trong mấy mẫu chị xem thì em thấy ${nm} hợp với chị nhất ạ, mẫu này ${praise(mem)}, lại dễ phối đồ nữa. Chị lấy mẫu này em lên đơn cho mình nha`;
        await sendInboxMessage(conversationId, reply);
        // đưa mẫu này thành focus để chốt tiếp
        mem.currentProduct = pick.code;
        if (!mem.quotedProducts) mem.quotedProducts = [];
        mem.lastBotReply = reply;
        console.log(`[${BOT_NAME}] Khách nhờ chọn mẫu đẹp -> tư vấn mẫu ĐÃ xem: ${pick.code} (${pick.name}).`);
        scheduleFollowup(conversationId, mem, pick, reply);
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // chưa có mẫu nào đã xem -> hỏi gu để tư vấn (không gửi mẫu mới vô cớ)
      const reply = "Dạ chị thích phong cách nhẹ nhàng nữ tính hay cá tính trẻ trung để em tư vấn mẫu hợp với mình nha";
      await sendInboxMessage(conversationId, reply);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH HỎI ĐỒ ĐI BIỂN -> lọc cột U="Biển" (đúng chủng loại nếu khách nói rõ) + gửi ẢNH tham khảo =====
    if ((_aiOr(asksBeachWear(latestText), "OCCASION_QA"))
        && !(productInfo && /(mẫu|váy|đầm|set|áo|bộ|cái)\s*(này|đó|kia)/i.test(latestText))) {   // "váy NÀY mặc đi biển được ko" = hỏi mẫu hiện tại, KHÔNG gửi gallery
      mem._boughtForOccasion = true;   // ghi nhận khách mua cho DỊP -> câu chúc sau chốt theo dịp
      let prods = await recommend.findBeach(catWanted);
      // xáo trộn (Fisher-Yates) để nhặt 10 mẫu ngẫu nhiên khi khách không nói rõ chủng loại
      for (let i = prods.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [prods[i], prods[j]] = [prods[j], prods[i]]; }
      const gallery = recommend.buildGallery(prods, { exclude: [...(mem.sentGalleryCodes || [])], maxModels: 10, withPrices: false });
      if (gallery) {
        const kieu = catWanted === "set" ? "set" : catWanted === "vay" ? "váy" : catWanted === "ao" ? "áo" : catWanted === "quan" ? "quần" : "mẫu";
        await sendGallery(conversationId, gallery, mem, `Dạ em gửi chị vài ${kieu} đi biển xinh bên em, chị xem ưng mẫu nào em tư vấn thêm cho mình nha`);
        console.log(`[${BOT_NAME}] Khách hỏi đồ ĐI BIỂN (${catWanted || "all"}) -> gửi ${gallery.count} mẫu (cột U=Biển).`);
        scheduleFollowup(conversationId, mem, productInfo, mem.lastBotReply);
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // chưa lọc được mẫu nào (thiếu ảnh/sheet) -> nhờ NV
      const reply = "Dạ chị chờ em chọn vài mẫu đi biển gửi chị tham khảo nha";
      await sendInboxMessage(conversationId, reply);
      await tagChoXuLyVaUnread(conversationId);
      mem.botHandoffAt = Date.now(); mem.lastBotReply = reply;
      console.log(`[${BOT_NAME}] Khách hỏi đồ đi biển nhưng chưa gửi tự động được -> nhờ NV.`);
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH XIN MẪU TƯƠNG TỰ / MẪU KHÁC -> TỰ gửi gallery (CLIP); không ra thì nhờ NV =====
    // Chạy cả khi khách CHÊ màu rồi xin mẫu tương tự (vd "ko thích hồng tím, gửi mẫu tương tự") -> gửi MẪU KHÁC, KHÔNG gửi lại màu chê.
    {
      const _wantSimilar = (_aiOr(asksSimilarModels(latestText), "SIMILAR_MODELS")) && !asksOtherColors(latestText);
      const _wantNew = asksNewCollection(latestText);
      const _dislikeSimilar = _wantSimilar && dislikesColor(latestText);
      if (_wantNew || (_wantSimilar && (_dislikeSimilar || (!extractColor(latestText) && !recommend.extractAttributes(latestText).length)))) {
        if (await tryBrowseGallery(conversationId, latestText, mem, productInfo)) {
          scheduleFollowup(conversationId, mem, productInfo, mem.lastBotReply);
          updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        const reply = "Dạ chị chờ em chọn thêm vài mẫu tương tự gửi chị xem nha";
        await sendInboxMessage(conversationId, reply);
        await tagChoXuLyVaUnread(conversationId);
        console.log(`[${BOT_NAME}] Mẫu tương tự: chưa gửi tự động được -> nhờ NV.`);
        mem.lastBotReply = reply;
        mem.botHandoffAt = Date.now();
        updateConversationState(conversationId, mem);
        markProcessed(batch);
        return true;
      }
    }

    // ===== KHÁCH MUỐN XEM ẢNH CẢ NHIỀU MÀU ("gửi cả 2 màu") -> gửi TỪNG màu + 3 ảnh, theo thứ tự =====
    if ((wantsAllColorsImages(latestText) || wantsAllColorsLoose(latestText)) && productInfo) {
      const code = String(productInfo.code || "").toUpperCase();
      const byKey = new Map();
      for (const c of [...cleanColors(productInfo.color), ...(getCodeColors(code) || [])]) {
        const k = _foldKey(c); if (k && !byKey.has(k)) byKey.set(k, { key: k, display: c });
      }
      const modelColors = [...byKey.values()];
      if (modelColors.length) {
        let sentAny = false;
        for (const col of modelColors.slice(0, 4)) {
          const items = imageItemsByExactColor(code, col.key, 3);
          if (!items.length) continue;
          await sendInboxMessage(conversationId, `Dạ em gửi màu ${String(col.display).toLowerCase()} ạ`);
          const sres = await sendImages3(conversationId, items.slice(0, 3));
          if (sres.ok) sentAny = true;
          try { await delay(300); } catch (_) {}
        }
        if (sentAny) {
          if (!mem.sentImageCodes.includes(code)) mem.sentImageCodes.push(code);
          const haveSize = mem.customerSize && mem.customerSize !== "FREESIZE";
          const cta = haveSize
            ? `Chị ưng màu nào em lên đơn size ${mem.customerSize} cho mình nha`
            : `Chị ưng màu nào nhắn em lên đơn cho mình nha`;
          await sendInboxMessage(conversationId, cta);
          console.log(`[${BOT_NAME}] Gửi CẢ ${modelColors.length} màu của ${code} (mỗi màu 3 ảnh) + câu chốt.`);
          mem.lastBotReply = cta; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
      }
      // không gửi được -> để các handler màu bên dưới xử lý
    }

    // ===== XEM ẢNH THEO MÀU (KHỚP MÀU THẬT CỦA MẪU) — bền với dấu/khoảng trắng/viết liền =====
    // Sửa lỗi: "nâu vàng" trước đây bị đọc thành "Vàng" -> báo "chưa có màu vàng" + gửi nhầm màu.
    {
      const _viewVerb = /(gửi|gui|xem|coi)/i.test(latestText) || /^\s*(màu|mau)\b/i.test(latestText);
      const _wantsOtherModels = /(mẫu khác|mẫu nào khác|còn mẫu|các mẫu|những mẫu|mấy mẫu|xem (thêm )?(các |những |mấy )?mẫu|váy nào|đầm nào|set nào|áo nào|sản phẩm nào|mẫu nào (màu|khác))/i.test(latestText);
      // NHƯỜNG LƯỢT: (lỗi 2) khách hỏi "ảnh đã gửi màu gì" -> để handler riêng phía dưới trả đúng 1 màu;
      //              (lỗi 4) tin có >=2 cân nặng (tư vấn 2 người) -> để nhánh đa-người xử lý, đừng đi hỏi/gửi màu.
      const _yieldToOther = asksWhatColorIsImage(latestText) || parseAllWeights(latestText).length >= 2;
      if (productInfo && _viewVerb && !_wantsOtherModels && !asksOtherColors(latestText) && !_yieldToOther && !asksOrderStatus(latestText)) {
        const code = String(productInfo.code || "").toUpperCase();
        // Màu thật: hiển thị ưu tiên theo SHEET, khớp gộp cả màu từ TÊN ẢNH.
        const byKey = new Map();
        for (const c of [...cleanColors(productInfo.color), ...(getCodeColors(code) || [])]) {
          const k = _foldKey(c); if (k && !byKey.has(k)) byKey.set(k, c);
        }
        const modelColors = [...byKey.entries()].map(([key, display]) => ({ key, display }));
        const mentionsImg = /(ảnh|hình|anh|hinh)/i.test(latestText);
        if (modelColors.length) {
          const res = resolveColorForImages(latestText, modelColors);
          // chỉ xử lý ở đây khi khách thực sự muốn XEM (nói ảnh/hình) HOẶC đã nêu/khớp được màu cụ thể
          if (mentionsImg || res.status === "one" || res.status === "none" || (res.status === "ask" && mentionsImg)) {
            if (res.status === "ask") {
              const opts = [...new Set((res.colors || modelColors).map(c => String(c.display).toLowerCase()))];
              const reply = `Dạ mẫu này có ${joinVi(opts)} ạ, chị muốn xem màu nào để em gửi đúng cho mình nha`;
              await sendInboxMessage(conversationId, reply);
              console.log(`[${BOT_NAME}] Xem ảnh nhưng MÀU mơ hồ (${opts.join("/")}) -> hỏi lại chị muốn màu nào.`);
              mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
            }
            if (res.status === "none") {
              const have = modelColors.map(c => String(c.display).toLowerCase());
              const reply = `Dạ mẫu này bên em ${have.length === 1 ? `chỉ có màu ${have[0]}` : `có ${joinVi(have)}`} thôi ạ, chị xem giúp em màu nào trong các màu này nha`;
              await sendInboxMessage(conversationId, reply);
              console.log(`[${BOT_NAME}] Xem ảnh màu KHÔNG có ở mẫu ${code} -> báo các màu đang có.`);
              mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
            }
            // res.status === "one"
            const col = res.color;
            if (!recommend.isOutOfStock(productInfo)) {
              const items = imageItemsByExactColor(code, col.key, 3);
              const urls = items.map(i => i.url).filter(Boolean);
              const cids = items.map(i => i.contentId).filter(Boolean);
              if (urls.length || cids.length) {
                const sres = await sendImages3(conversationId, items.slice(0, 3));
                const ok = sres.ok;
                const reply = `Dạ em gửi màu ${String(col.display).toLowerCase()} ạ`;
                await sendInboxMessage(conversationId, reply);
                if (!mem.sentImageCodes.includes(code)) mem.sentImageCodes.push(code);
                mem.lastSentImageColor = col.display; mem.askedImageColor = col.display;
                mem.lastSentColorByCode = Object.assign({}, mem.lastSentColorByCode || {}, { [code]: col.display });
                console.log(`[${BOT_NAME}] Gửi ${sres.n || 0} ảnh ĐÚNG màu "${col.display}" (key=${col.key}) của ${code} -> ${ok ? "OK" : "thử lại"}.`);
                scheduleFollowup(conversationId, mem, productInfo, reply);
                mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
              }
              // có màu nhưng CHƯA có ảnh gắn đúng màu -> ÂM THẦM gắn AI-XL ảnh (NV gửi đúng màu), KHÔNG nhắn khách.
              await tagXuLyAnhVaUnread(conversationId);
              console.log(`[${BOT_NAME}] Mẫu ${code} có màu "${col.display}" nhưng chưa có ảnh gắn màu -> ÂM THẦM gắn AI-XL ảnh.`);
              mem.lastBotReply = "[ảnh màu - chờ NV]"; mem.botHandoffAt = Date.now();
              updateConversationState(conversationId, mem); markProcessed(batch); return true;
            }
          }
        }
      }
    }

    // ===== KHÁCH HỎI/DUYỆT THEO MÀU CỤ THỂ =====
    {
      const askColor = extractColor(latestText);
      const isAvailQ = /\?|(có|còn|co|con)\b[^?]{0,30}(không|ko|kg|hông|hong)|cho (xem|mình xem|coi)|bên (em|mình)|shop|còn màu|gửi|xem|nào|xin (ảnh|hình|cái)|ảnh màu|hình màu|ảnh|hình/i.test(latestText);
      // ĐANG HỎI GIÁ -> KHÔNG rẽ vào nhánh màu, để xuống nhánh BÁO GIÁ (tránh cướp câu hỏi giá).
      const _isPriceQ = /(giá|gia\b|bao nhiêu|bao nhieu|nhiêu tiền|nhieu tien|mấy tiền|may tien|bao tiền|nhiêu ạ|nhiêu vậy)/i.test(latestText);
      if (askColor && isAvailQ && !asksOtherColors(latestText) && !_isPriceQ) {
        // Khách CHỦ ĐÍCH muốn MẪU KHÁC (không phải mẫu đang xem)?
        const wantsOtherModels = /(mẫu khác|mẫu nào khác|còn mẫu|các mẫu|những mẫu|mấy mẫu|xem (thêm )?(các |những |mấy )?mẫu|bên em (có|còn)[^?]{0,14}(mẫu|váy|đầm|sản phẩm) nào|shop (có|còn)[^?]{0,14}(mẫu|váy|đầm) nào|váy nào|đầm nào|set nào|áo nào|sản phẩm nào|mẫu nào (màu|khác)|mẫu màu)/i.test(latestText);
        const wantsToSee = /(gửi|xem|cho (xem|coi|mình xem)|ảnh|hình|coi)/i.test(latestText);

        // (1) CÓ MẪU ĐANG XEM + KHÔNG đòi mẫu khác -> hiểu là "xem MẪU NÀY ở màu đó"
        if (productInfo && !wantsOtherModels) {
          const code = String(productInfo.code || "").toUpperCase();
          const colors = cleanColors(productInfo.color);
          const hasInSheet = colors.some(c => colorMatches(c, askColor));
          const hasInImg = (getCodeColors(code) || []).some(c => colorMatches(c, askColor) || colorMatches(askColor, c));

          if (wantsToSee && (hasInSheet || hasInImg)) {
            // Màu để TÌM ẢNH: ưu tiên TÊN MÀU ĐÚNG trong sheet/ảnh khớp với màu khách hỏi
            // (vd khách "hồng tím" -> extractColor ra "Hồng" cụt; sheet ghi "Hồng tím" -> dùng "Hồng tím" mới khớp ảnh).
            const lookupColor =
              colors.find(c => colorMatches(c, askColor) || colorMatches(askColor, c)) ||
              (getCodeColors(code) || []).find(c => colorMatches(c, askColor) || colorMatches(askColor, c)) ||
              askColor;
            // Gửi ẢNH màu đó CỦA MẪU NÀY -> CHỈ ảnh, KHÔNG báo giá lại (khách đã ở trong mẫu này).
            // Yêu cầu XEM MÀU -> gửi bằng URL ảnh Drive thật TRƯỚC (đúng màu 100%, tránh content_id bị map nhầm màu),
            // content_id chỉ làm dự phòng khi URL bị FB từ chối.
            const items = imageItemsByColor(code, lookupColor, 3, false);   // [{contentId,url}] ĐÚNG màu, không fallback (tối thiểu 3 ảnh)
            const urls = items.map(i => i.url).filter(Boolean);
            const cids = items.map(i => i.contentId).filter(Boolean);
            if (urls.length || cids.length) {
              const _items = [];
              for (let i = 0; i < 3; i++) { const u = urls[i] || null, c = cids[i] || null; if (u || c) _items.push({ url: u, contentId: c }); }
              const sres = await sendImages3(conversationId, _items);
              const ok = sres.ok;
              const reply = `Dạ đây là mẫu màu ${lookupColor.toLowerCase()} chị nha`;
              await sendInboxMessage(conversationId, reply);
              if (!mem.sentImageCodes.includes(code)) mem.sentImageCodes.push(code);
              mem.lastSentImageColor = lookupColor;
              mem.lastSentColorByCode = Object.assign({}, mem.lastSentColorByCode || {}, { [code]: lookupColor });
              mem.lastBotReply = reply;
              console.log(`[${BOT_NAME}] Gửi ảnh màu "${lookupColor}" của MẪU ĐANG XEM ${code} (${urls.length} ảnh URL${ok ? "" : " + content_id"}, không báo giá) -> ${ok ? "OK" : "thử content_id"}.`);
              scheduleFollowup(conversationId, mem, productInfo, reply);
              updateConversationState(conversationId, mem); markProcessed(batch); return true;
            }
            // Mẫu CÓ màu (theo sheet) nhưng ảnh CHƯA gắn tên màu -> ÂM THẦM gắn AI-XL ảnh (NV gửi đúng ảnh).
            await tagXuLyAnhVaUnread(conversationId);
            console.log(`[${BOT_NAME}] Mẫu ${code} có màu "${lookupColor}" nhưng chưa có ảnh gắn màu -> ÂM THẦM gắn AI-XL ảnh.`);
            mem.lastBotReply = "[ảnh màu - chờ NV]"; mem.botHandoffAt = Date.now();
            updateConversationState(conversationId, mem); markProcessed(batch); return true;
          }

          // Chỉ HỎI (không xin ảnh) hoặc mẫu KHÔNG có màu đó -> trả lời từ cột màu SP
          let reply;
          if (!colors.length) { reply = "Dạ màu của mẫu này để em kiểm tra lại rồi báo mình nha"; await tagChoXuLyVaUnread(conversationId); mem.botHandoffAt = Date.now(); }
          else if (hasInSheet) reply = `Dạ mẫu này có màu ${askColor.toLowerCase()} chị nha ạ.`;
          else reply = `Dạ mẫu này bên em ${colors.length === 1 ? `chỉ có màu ${colors[0]}` : `có ${joinVi(colors)}`} thôi ạ, chưa có màu ${askColor.toLowerCase()} ạ.`;
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] Hỏi màu "${askColor}" về mẫu ${code} -> ${hasInSheet ? "CÓ" : "KHÔNG"}.`);
          mem.lastBotReply = reply;
          scheduleFollowup(conversationId, mem, productInfo, reply);
          updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }

        // (2) DUYỆT CATALOG theo màu (không có mẫu đang xem HOẶC đòi mẫu khác) -> gửi ẢNH trước, KHÔNG báo giá
        if (await tryBrowseGallery(conversationId, latestText, mem, productInfo)) {
          scheduleFollowup(conversationId, mem, productInfo, mem.lastBotReply);
          updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        const reply = `Dạ mẫu màu ${askColor.toLowerCase()} bên em chị chờ em chọn gửi mình xem nha`;
        await sendInboxMessage(conversationId, reply);
        await tagChoXuLyVaUnread(conversationId);
        console.log(`[${BOT_NAME}] Duyệt màu "${askColor}": chưa có ảnh đúng màu -> nhờ NV.`);
        mem.lastBotReply = reply; mem.botHandoffAt = Date.now();
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
    }

    // ===== KHÁCH DUYỆT THEO KIỂU (không màu): "váy dài tay", "đầm 2 dây", "mẫu suông" =====
    {
      const attrs = recommend.extractAttributes(latestText);
      const browseVerb = /(gửi|xem|cho (xem|coi)|có|còn|mẫu nào|váy nào|đầm nào|bên em|shop|tư vấn|nào)/i.test(latestText);
      if (attrs.length && browseVerb && !extractColor(latestText)) {
        if (await tryBrowseGallery(conversationId, latestText, mem, productInfo)) {
          scheduleFollowup(conversationId, mem, productInfo, mem.lastBotReply);
          updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        const reply = `Dạ chị chờ em chọn vài mẫu ${attrs.map(x => x.canon).join(", ")} gửi mình nha`;
        await sendInboxMessage(conversationId, reply);
        await tagChoXuLyVaUnread(conversationId);
        console.log(`[${BOT_NAME}] Duyệt kiểu "${attrs.map(x => x.canon).join(",")}": chưa ra -> nhờ NV.`);
        mem.lastBotReply = reply; mem.botHandoffAt = Date.now();
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
    }

    // ===== KHÁCH HỎI "ẢNH NÀY LÀ MÀU GÌ" -> trả ĐÚNG màu của ẢNH ĐÃ GỬI (1 màu), KHÔNG liệt kê hết =====
    if (asksWhatColorIsImage(latestText) && productInfo) {
      const code = String(productInfo.code || "").toUpperCase();
      // Màu HỢP LỆ của mẫu này (từ tên ảnh + sheet) -> để LOẠI màu lạc (vd "vàng" sót từ mẫu khác).
      const validKeys = new Set([...(getCodeColors(code) || []), ...cleanColors(productInfo.color)].map(c => _foldKey(c)).filter(Boolean));
      const _isValid = c => c && validKeys.has(_foldKey(c));
      let imgColor = "";
      const perCode = mem.lastSentColorByCode && mem.lastSentColorByCode[code];   // màu ảnh ĐÃ GỬI cho ĐÚNG mẫu này
      if (_isValid(perCode)) imgColor = perCode;
      else if (_isValid(mem.lastSentImageColor)) imgColor = mem.lastSentImageColor;   // chỉ dùng nếu THUỘC mẫu này
      if (!imgColor) imgColor = representativeColor(code) || "";                       // màu thật từ ảnh mẫu
      if (!imgColor) { const colors = cleanColors(productInfo.color); if (colors.length === 1) imgColor = colors[0]; }
      let reply;
      if (imgColor) {
        const c = imgColor.toLowerCase();
        reply = `Dạ ảnh này màu ${c} chị ạ, màu ${c} dễ mặc dễ phối đồ lắm ạ`;
      } else {
        reply = "Dạ để em xem lại ảnh rồi báo đúng màu cho mình nha";
      }
      reply = appendCTA(reply, mem, productInfo);
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Hỏi "ảnh này màu gì" -> ${imgColor || "(chưa đọc được)"} | mã ${code} (màu hợp lệ: ${[...validKeys].join("/")})`);
      mem.lastBotReply = reply;
      scheduleFollowup(conversationId, mem, productInfo, reply);
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== PHƯƠNG ÁN 2: KHÁCH CHÊ MÀU đang xem -> pitch MÀU CÒN LẠI ("đang rất hot"); hết màu -> gợi ý MẪU KHÁC =====
    if (dislikesColor(latestText) && productInfo && !recommend.isOutOfStock(productInfo)) {
      const code = String(productInfo.code || "").toUpperCase();
      const shown = new Set(
        [mem.lastSentImageColor, mem.imageColor, mem.orderColor, ...(mem.suggestedColors || [])]
          .filter(Boolean).map(c => foldVi(c))
      );
      // Màu mẫu CÓ (sheet + ảnh), bỏ màu đã cho xem + màu khách vừa chê.
      const disliked = extractColor(latestText);
      if (disliked) shown.add(foldVi(disliked));
      const allColors = [...new Set([...cleanColors(productInfo.color), ...getCodeColors(code)])];
      const other = allColors.find(c => c && !shown.has(foldVi(c)));

      if (other) {
        // PHƯƠNG ÁN 2a: pitch màu còn lại + gửi ảnh màu đó (nếu có ảnh gắn màu)
        const reply = `Dạ mẫu này còn có màu ${other.toLowerCase()} đang rất hot bên em, chị xem thử màu này nha, biết đâu hợp với mình hơn đó ạ`;
        await sendInboxMessage(conversationId, reply);
        const ids = contentIdsByColor(code, other, 3);
        if (ids.length) {
          try { await _sendInboxContentIds(conversationId, ids); } catch (e) { console.log("[planB] gửi ảnh màu lỗi:", e.message); }
          mem.lastSentImageColor = other;
        }
        mem.suggestedColors = [...(mem.suggestedColors || []), other];
        mem.lastBotReply = reply;
        console.log(`[${BOT_NAME}] PHƯƠNG ÁN 2a: khách chê màu -> pitch màu "${other}" của mẫu ${code}.`);
        scheduleFollowup(conversationId, mem, productInfo, reply);
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }

      // PHƯƠNG ÁN 2b: hết màu để pitch -> gợi ý MẪU KHÁC tương tự (đúng chủng loại + có size khách, ảnh thôi, không giá)
      let sent = false;
      try {
        const gallery = await buildOOSSimilarGallery(code, mem);
        if (gallery) {
          await sendGallery(conversationId, gallery, mem, "Dạ hay chị tham khảo thêm mấy mẫu này bên em nha, cũng đang hot lắm ạ");
          sent = true;
        }
      } catch (e) { console.log("[planB] gợi ý mẫu khác lỗi:", e.message); }
      if (!sent) {
        const reply = "Dạ để em chọn thêm vài mẫu khác hợp gu chị rồi gửi mình tham khảo nha";
        await sendInboxMessage(conversationId, reply);
        await tagChoXuLyVaUnread(conversationId);
        mem.botHandoffAt = Date.now();
        mem.lastBotReply = reply;
      }
      console.log(`[${BOT_NAME}] PHƯƠNG ÁN 2b: hết màu mẫu ${code} -> gợi ý mẫu khác.`);
      updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH HỎI MÀU ("có màu khác không", "có mấy màu") -> trả thẳng từ dữ liệu, KHÔNG chờ XL =====
    // ===== KHÁCH HỎI "EM LÊN ĐƠN MÀU GÌ" -> NÓI ĐÚNG MÀU SẼ LÊN (không liệt kê) =====
    if (asksWhichColorOrdering(latestText) && productInfo) {
      const _code = String(productInfo.code || "").toUpperCase();
      const col = (mem.orderColorByCode && mem.orderColorByCode[_code])
        || (mem.pendingColorConfirm && mem.pendingColorConfirm.code === _code && mem.pendingColorConfirm.color)
        || mem.orderColor || mem.lastSentImageColor || mem.askedImageColor || "";
      let reply;
      if (col) {
        mem.orderColorByCode = Object.assign({}, mem.orderColorByCode || {}, { [_code]: col });   // chốt màu này vào đơn
        mem.pendingColorConfirm = null;
        reply = `Dạ em lên màu ${String(col).toLowerCase()} cho mình nha ạ, nếu chị muốn màu khác thì nhắn em đổi giúp nha`;
      } else {
        const byKey = new Map();
        for (const c of [...cleanColors(productInfo.color), ...(getCodeColors(_code) || [])]) { const k = _foldKey(c); if (k && !byKey.has(k)) byKey.set(k, c); }
        const cols = [...byKey.values()].map(c => String(c).toLowerCase());
        reply = cols.length ? `Dạ chị muốn lấy màu nào trong ${joinVi(cols)} để em lên đơn cho mình nha` : `Dạ chị muốn lấy màu nào để em lên đơn cho mình nha`;
      }
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi "lên đơn màu gì" (${_code}) -> ${col ? "nói màu " + col : "hỏi chọn màu"}.`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH ĐANG ĐƯỢC MỜI CHỌN MÀU + vừa NÓI TÊN 1 MÀU CÓ trong mẫu -> CHỐT MÀU, tiến tới size =====
    //  (chống spam lặp câu "chị thích màu nào" khi khách đã trả lời "Hồng ạ"). Khách ĐÃ CÓ ảnh rồi ->
    //  CHỈ ghi nhận màu + hỏi size; chỉ gửi ảnh nếu mẫu này CHƯA từng gửi đúng màu khách chọn.
    if (mem.awaitingColorPick && productInfo && !asksOtherColors(latestText)) {
      const _pickRaw = extractColor(latestText);
      const _codeC = String(productInfo.code || "").toUpperCase();
      const _colorsM = colorListForModel(productInfo, _codeC).map(c => String(c).toLowerCase());
      const _pickF = _pickRaw ? foldVi(String(_pickRaw)) : null;
      const _match = _pickF ? _colorsM.find(c => { const cf = foldVi(c); return cf === _pickF || cf.includes(_pickF) || _pickF.includes(cf); }) : null;
      if (_match) {
        mem.awaitingColorPick = false;
        mem.orderColor = _match;
        mem.orderColorByCode = Object.assign({}, mem.orderColorByCode || {}, { [_codeC]: _match });
        // ĐÃ gửi đúng màu này rồi (khách đang nhìn ảnh) -> KHÔNG gửi lại ảnh, chỉ ghi nhận + hỏi size để CHỐT.
        const _sentThisColor = foldVi(String(mem.lastSentImageColor || "")) === _pickF
          || (Array.isArray(mem._sentImgColors) && mem._sentImgColors.map(c => foldVi(String(c))).includes(_pickF));
        if (_sentThisColor) {
          const _r = mem.customerSize
            ? `Dạ em ghi nhận mẫu này màu ${_match} cho mình nha. ${orderCtaOrAskContact(mem)}`
            : `Dạ mẫu này màu ${_match} xinh lắm ạ. Chị thường mặc size bao nhiêu để em tư vấn cho mình nhe ạ?`;
          await sendInboxMessage(conversationId, _r);
          console.log(`[${BOT_NAME}] Khách CHỐT màu "${_match}" (đã có ảnh) -> ghi nhận + ${mem.customerSize ? "CTA chốt" : "hỏi size"}, KHÔNG gửi lại ảnh.`);
          mem.lastBotReply = _r; cancelFollowup(conversationId);
          updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        // CHƯA gửi màu này -> gửi ảnh đúng màu (1 lần) + hỏi size.
        let items = [];
        try { items = imageItemsByColor(_codeC, _match, 3, false) || []; } catch (_) {}
        if (!items.length) { try { items = imageItemsByColor(_codeC, null, 3, true) || []; } catch (_) {} }
        const _lead = `Dạ em gửi chị ảnh mẫu này màu ${_match} nha ạ. Chị thường mặc size bao nhiêu để em tư vấn cho mình nhe ạ?`;
        mem.lastSentImageColor = _match;
        mem._sentImgColors = Array.from(new Set([...(mem._sentImgColors || []), _match]));
        if (items.length) { try { await sendImages3(conversationId, items, _lead); } catch (_) { await sendInboxMessage(conversationId, _lead); } }
        else { await sendInboxMessage(conversationId, _lead); }
        console.log(`[${BOT_NAME}] Khách CHỌN màu "${_match}" (chưa có ảnh màu này) -> gửi ảnh + hỏi size.`);
        mem.lastBotReply = _lead; cancelFollowup(conversationId);
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
    }

    if ((_aiOr(asksOtherColors(latestText), "COLOR_ASK")) && productInfo) {
      const colors = colorListForModel(productInfo, String(productInfo.code || "").toUpperCase()).map(c => String(c).toLowerCase());
      let reply;
      if (colors.length === 0) {
        reply = "Dạ màu của mẫu này để em kiểm tra lại rồi báo mình nha";
        await tagChoXuLyVaUnread(conversationId); mem.botHandoffAt = Date.now();
      } else if (colors.length === 1) {
        // 1 MÀU: KHÔNG nói "chỉ có" -> nói "làm riêng màu X" + điểm cộng để khách yên tâm.
        const _c1Pl = !(mem.pricedCodes || []).includes(String(productInfo.code || "").toUpperCase()) ? priceLine(productInfo) : "";
        reply = `${_c1Pl ? `Dạ ${productLabel(productInfo)} ${_c1Pl} ạ.\n` : ""}${_c1Pl ? "Mẫu" : "Dạ mẫu này"} bên em làm riêng màu ${colors[0]} ạ — màu này đang rất được ưa chuộng, dễ phối đồ, hợp nhiều dáng người chị nha.`;
        if (_c1Pl) markPriced(mem, String(productInfo.code || "").toUpperCase());
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Hỏi màu -> mẫu 1 màu (${colors[0]}).`);
        mem.lastBotReply = reply; cancelFollowup(conversationId);
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      } else {
        // ≥2 MÀU: liệt kê đủ màu + GỬI ẢNH THẬT TỪNG MÀU (mỗi màu 2 tấm, dạng album).
        // [FIX Sun Sun 2026-08-09] Khách HỎI GIÁ mà mẫu chưa được báo giá -> câu GIÁ phải ĐỨNG ĐẦU,
        // tư vấn màu theo sau (luật chỉ-báo-giá: không được tư vấn màu chay nuốt mất giá).
        const _clPl = !(mem.pricedCodes || []).includes(String(productInfo.code || "").toUpperCase()) ? priceLine(productInfo) : "";
        const _clGia = _clPl ? `Dạ ${productLabel(productInfo)} ${_clPl} ạ.\n` : "";
        reply = `${_clGia}${_clGia ? "Mẫu" : "Dạ mẫu này"} bên em có ${joinVi(colors)} chị nha. Em gửi ảnh thật từng màu chị xem thích màu nào hơn ạ?`;
        if (_clPl) markPriced(mem, String(productInfo.code || "").toUpperCase());
        mem.awaitingColorPick = true;   // khách chọn màu / "ok" -> luồng gửi ảnh từng màu lo
        const _codeC2 = String(productInfo.code || "").toUpperCase();
        let _firstSend = true, _sentAny = false;
        for (const _col of colors) {
          let _imgs = [];
          try { _imgs = imageItemsByColor(_codeC2, _col, 2, false) || []; } catch (_) {}
          _imgs = (_imgs || []).slice(0, 2);            // mỗi màu TỐI ĐA 2 ảnh
          if (!_imgs.length) continue;                  // màu không có ảnh -> bỏ qua, không kẹt
          try {
            await sendImages3(conversationId, _imgs, _firstSend ? reply : null);   // chữ chỉ kèm album ĐẦU
            _firstSend = false; _sentAny = true;
            mem.lastSentImageColor = _col;
            mem._sentImgColors = Array.from(new Set([...(mem._sentImgColors || []), _col]));
          } catch (_) {}
        }
        if (!_sentAny) { try { await sendInboxMessage(conversationId, reply); } catch (_) {} }   // không có ảnh màu nào -> vẫn gửi chữ
        mem._sentAllColorsFor = _codeC2;   // đã gửi đủ màu -> luồng sau biết để hỏi size/chốt, không hỏi lại màu
        console.log(`[${BOT_NAME}] Hỏi màu (≥2) -> liệt kê + GỬI ẢNH TỪNG MÀU 2 tấm/màu [${colors.join(", ")}]${_sentAny ? "" : " (KHÔNG có ảnh màu -> chỉ chữ)"}.`);
        mem.lastBotReply = reply; cancelFollowup(conversationId);
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // CHỈ còn nhánh 0 màu rơi xuống đây (đã gắn người thật ở trên).
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Hỏi màu -> 0 màu trong sheet -> người thật kiểm.`);
      mem.lastBotReply = reply;
      cancelFollowup(conversationId);
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH HỎI HÀNG GỬI TỪ ĐÂU / KHO Ở ĐÂU -> mới nói kho Bắc Giang (nội bộ) =====
    // [FIX 2026-07-11] "cửa HÀNG Ở ĐÂU" chứa nguyên cụm "hàng ở đâu" -> regex kho cướp lượt của nhánh
    // ĐỊA CHỈ CỬA HÀNG dù AI đã chấm đúng STORE_ADDRESS -> khách hỏi showroom (đang sale 50% tại showroom!)
    // lại nhận câu ship COD. Nhánh kho phải NHƯỜNG khi câu thực chất hỏi cửa hàng.
    if (asksShipOrigin(latestText) && !asksShopAddress(latestText) && !_ai("STORE_ADDRESS") && !_ai("STORE_VISIT")
        && !/(cửa hàng|cua hang|showroom|shop ở đâu|shop o dau|mua trực tiếp|mua truc tiep|ghé (xem|thử|mua)|qua (xem|thử|mua))/i.test(String(latestText || ""))) {
      const reply = buildShipOriginReply();
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi hàng gửi từ đâu -> trả kho Bắc Giang.`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH HỎI ĐỊA CHỈ SHOP / SHOWROOM -> trả địa chỉ cơ sở, KHÔNG báo giá =====
    if (_aiOr(asksShopAddress(latestText), "STORE_ADDRESS")) {
      const _specificSr = showroomReplyFor(latestText);   // hỏi ĐÍCH DANH 1 địa danh (Bắc Giang/Nghệ An/HN/HCM...) -> trả đúng nơi đó
      let reply = _specificSr || buildShopAddressReply();
      // [CHƯƠNG TRÌNH KM] Khách nhắc tới CỬA HÀNG -> kèm giới thiệu chương trình sale showroom (còn hạn mới nói).
      const _srProg = saleProgram(mem._pageId);
      // [KM KÍN 2026-07-20] Khách hỏi địa chỉ KHÔNG còn được kèm câu chương trình (khách online ở xa nghe
      // "showroom giảm giá" dễ hủy đơn). Chỉ kèm khi config khai riêng cau_tai_cua_hang (hiện để trống).
      if (_srProg && _srProg.cau_tai_cua_hang) reply = reply + "\n" + _srProg.cau_tai_cua_hang;
      await sendInboxMessage(conversationId, reply);
      if (!_specificSr) mem.pendingShowroomChoice = Date.now();   // [FIX Chu Nguyet] chỉ trả danh sách CHUNG mới chờ khách chọn cơ sở
      console.log(`[${BOT_NAME}] Khách hỏi địa chỉ shop -> trả ${_specificSr ? "cơ sở đích danh" : "2 showroom"}${_srProg ? " + giới thiệu chương trình sale showroom" : ""} (không báo giá).`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH HỎI GIẢM GIÁ / SALE -> nói rõ có/không ưu đãi, KHÔNG lặp giá gốc =====
    if ((asksDiscount(latestText) || _aiDiscount) && productInfo) {
      mem._asksMoreDiscount = asksMoreDiscount(latestText);
      const reply = buildDiscountReply(productInfo, mem);
      // QUY TẮC: BÁO GIÁ mẫu LẦN ĐẦU (mẫu đó CHƯA gửi ảnh) -> BẮT BUỘC kèm ẢNH, kể cả hội thoại đã gửi ảnh mẫu khác.
      const _dc = String(productInfo.code || "").toUpperCase();
      if (_dc && !(mem.sentImageCodes || []).includes(_dc)) {
        mem._imgAllowSend = true;   // đây LÀ báo giá -> được phép gửi ảnh (vượt guard "đã gửi ảnh trong hội thoại")
        try { await maybeSendImages(conversationId, _dc, mem, true); } catch (_) {}
      }
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi giảm giá -> ${productInfo.salePrice ? "có ưu đãi" : "chưa có sale"}.`);
      mem.lastBotReply = reply;
      scheduleFollowup(conversationId, mem, productInfo, reply);
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH HỎI TỔNG TIỀN THANH TOÁN ("của chị hết mấy", "tổng bao nhiêu") =====
    if ((_aiOr(asksTotalPayment(latestText), "TOTAL_PAYMENT")) && (productInfo || (mem.quotedProducts && mem.quotedProducts.length))) {
      const { sum, ship, total, known } = computeOrderTotal(mem, productInfo);
      let reply;
      if (known && sum > 0) {
        const shipTxt = ship ? `(gồm ${_fmtMoney(sum)}đ tiền hàng + ${_fmtMoney(ship)}đ ship)` : "(đã freeship)";
        reply = `Dạ đơn của chị tổng ${_fmtMoney(total)}đ ${shipTxt} ạ, mình thanh toán khi nhận hàng nha`;
      } else {
        reply = "Dạ chị chốt giúp em mẫu (và số lượng) là em tính tổng chính xác rồi báo lại mình ngay nha";
      }
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi tổng tiền -> ${known ? _fmtMoney(total) + "đ" : "thiếu dữ liệu, hẹn báo lại"}.`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH HỎI GIÁ, hoặc GỬI MẪU MỚI (chưa báo giá) -> BÁO GIÁ NGAY =====
    // "Còn mẫu này" / gửi ảnh mẫu mới trong lúc đang hỏi giá = muốn biết GIÁ mẫu đó.
    // CHỈ áp dụng khi 0-1 mẫu trong lượt này (nhiều mẫu -> nhánh ĐA MẪU §17 lo).
    // §13: KHÁCH GỬI ẢNH 1 mẫu -> LUÔN báo giá + 3 ảnh + dẫn dắt TRƯỚC (kể cả mẫu đã báo giá trước đó),
    // KHÔNG được nhảy thẳng sang "em lên đơn / vớt đơn". Chỉ bỏ qua khi khách nói RÕ ý chốt.
    const _fromImageThisTurn = imageCount > 0 && fromImages.length >= 1 && productInfo
      && fromImages.some(p => String(p.code || "").toUpperCase() === String(productInfo.code || "").toUpperCase());
    // Ảnh mẫu của bài ADS/COMMENT hay TỰ BÁM theo MỌI tin khách. Chỉ coi là "khách CHỦ ĐỘNG gửi ảnh để hỏi giá"
    // khi tin gần như CHỈ có ảnh (không kèm chữ có nghĩa). Nếu khách đang HỎI/CHÊ (vd "có size ko", "mắc quá")
    // thì ĐỪNG để ảnh bám đó kích báo giá lại — nhường handler đúng (size/đắt/bảng size...) xử lý.
    const _meaningfulText = !!(latestText && latestText.replace(/[^\p{L}\p{N}]/gu, "").length >= 2);
    const _activeImageQuote = _fromImageThisTurn && !_meaningfulText
      && !quotedRecently(mem, String(productInfo.code || "").toUpperCase());   // ĐÃ báo giá 24h -> KHÔNG báo lại khi gửi lại ảnh
    const _newModelPresented = thisTurn.length === 1 && productInfo
      && (_activeImageQuote || !mem.pricedCodes.includes(String(productInfo.code || "").toUpperCase()))
      && !/(chốt|lấy|đặt|order|lên đơn|ưng)/i.test(latestText)   // có ý chốt thì để CA 3 lo
      // [FIX Lan Dieu 2026-07-11] Khách chỉ nói câu XÃ GIAO ("Cảm ơn e") mà "mẫu mới" xuất hiện trong lượt
      // (thường là hàng GIẢ: ảnh/caption lịch sử nhả ra khi bài không đọc được + state mất) -> KHÔNG AI đi
      // báo giá đáp lại lời cảm ơn cả. Nhãn xã giao thuần + không hỏi giá + khách không gửi ảnh/gõ tên mẫu
      // -> cấm nhánh báo-giá-mẫu-mới; để handler nhãn (THANKS/chitchat) trả lời đúng phép lịch sự.
      && !(["THANKS", "POST_ORDER_CHITCHAT", "POST_ORDER_CONFIRMED", "DEFER_DECISION"].includes(String(mem._aiIntent || "")) && !priceAsk && imageCount === 0 && !(fromText || []).length);
    // KHÁCH CUNG CẤP CHIỀU CAO/CÂN NẶNG/SỐ ĐO = đang TRẢ LỜI câu hỏi size -> phải đi TƯ VẤN SIZE,
    // TUYỆT ĐỐI KHÔNG báo giá lại + gửi lại ảnh khi khách đang TRẢ LỜI / CHỐT (lỗi cũ: cho cao-nặng / địa chỉ /
    // size / "ship về đấy" / "lấy mẫu này" mà vẫn bị báo giá lại — do ảnh ADS/COMMENT đi kèm tin khách kích §13).
    const _givesBodyInfo = !!(parseWeightKg(latestText) || parse3V(latestText)) && !isGiftContext(latestText);
    const _shipIntentNow = /(?<![\p{L}])(ship|gửi|giao)\s*(về|tới|đến|cho|hàng)/iu.test(latestText) || wantsShipOldAddress(latestText);
    const _orderIntentNow = customerWantsToOrder(latestText, mem.lastIntent)
      || /(?<![\p{L}\p{N}])(chốt|lấy|đặt|order|lên đơn|lấy luôn|chốt luôn)(?![\p{L}\p{N}])/iu.test(latestText);
    const _phoneInTextNow = /(?<!\d)(?:0|\+?84)\d[\d\s.\-]{7,}\d(?!\d)/.test(latestText);
    const _givesClosingInfo = _givesBodyInfo || mem._addrJustGiven || !!extractStatedSize(latestText)
      || _shipIntentNow || _orderIntentNow || _phoneInTextNow;
    // MÃ ĐÃ LÊN ĐƠN (có trong orderedByCode = đã xác nhận đơn) -> KHÔNG báo giá lại mẫu đó nữa.
    // Khách muốn đặt THÊM thì handler "mua lại mẫu đã chốt" (bên dưới) hỏi xác nhận; còn lại = hậu-đơn.
    // [FIX Phuong Pham] orderedByCode được ghi cho MỌI quotedProducts lúc chốt (kể cả mẫu chỉ quote chung,
    //   không thật sự vào đơn). Nên khi khách HỎI GIÁ/SWITCH sang mẫu MỚI ở lượt này (priceAsk hoặc mẫu mới
    //   vừa hiện), KHÔNG coi là "đã chốt" -> vẫn báo giá. Tránh: ad Giannal vừa hỏi -> bị nói "đã trong đơn".
    const _orderedRaw = !!(productInfo && mem.orderedByCode
      && mem.orderedByCode[String(productInfo.code || "").toUpperCase()]);
    const _askingThisModelNow = priceAsk || (_newModelPresented && !_orderIntentNow);
    const _alreadyOrdered = _orderedRaw && !_askingThisModelNow;
    // ===== CHỐT VIDEO (đặt TRƯỚC mọi handler gửi ẢNH): khách xin VIDEO + mẫu CÓ video -> gửi VIDEO =====
    //   Nhãn AI VIDEO_REQ là CHÍNH; regex là lưới phụ (phòng AI bí). Mẫu = productInfo (vision/khoá) | currentProduct.
    //   Mẫu KHÔNG có video trong video_index.json -> KHÔNG chặn (rớt xuống ảnh/giá như thường). Lỗi gửi -> cũng rớt xuống.
    {
      const _vt = String(latestText || "").toLowerCase();
      const _wantVideo = _ai("VIDEO_REQ")
        || /(video|clip|review)/.test(_vt)
        || /(mẫu|mau)\s*(thật|that)/.test(_vt)
        || /(mặc|mac)\s*(thật|that)/.test(_vt)
        || /l[êe]n\s*(ng[uư][oờ]i|d[áa]ng)/.test(_vt)
        || /ngo[àa]i\s*đ[ơờ]i/.test(_vt);
      const _vcode = _codeUp(productInfo) || (mem.currentProduct ? String(mem.currentProduct).toUpperCase().trim() : null);
      if (_wantVideo && !humanInbox && !mem.orderClosed && _vcode && productVideos.hasVideo(_vcode)) {
        try {
          const _vid = productVideos.videoContentIdByCode(_vcode);
          if (_vid) {
            await _sendInboxMessageWithImages(
              conversationId,
              "Dạ em gửi chị video mẫu lên người thật ạ. Mẫu này bên em đang bán rất chạy đó ạ.",
              [_vid], null
            );
            console.log(`[${BOT_NAME}] Khách XIN VIDEO (nhãn=${_ai("VIDEO_REQ") ? "VIDEO_REQ" : "regex"}) -> gửi video mẫu ${_vcode}. Conv: ${conversationId}`);
            updateConversationState(conversationId, mem); markProcessed(batch); return true;
          }
        } catch (e) { console.log("[video-req] lỗi gửi video:", e.message); }
        // không gửi được -> KHÔNG chặn, rớt xuống luồng ảnh/giá
      }
    }
    // ===== HƯỚNG A: KHÁCH CHỈ XIN ẢNH + giá ĐÃ có trong luồng (kể cả NV gõ tay) -> KHÔNG báo giá lại =====
    // Bot mù với tin người thật (quotedRecently chỉ nhớ giá BOT báo). NV báo giá tay -> mem.pricedCodes rỗng
    // -> _newModelPresented=true -> §13 báo giá LẠI + gửi lại ảnh dù khách chỉ hỏi "có ảnh nguyên váy này ko".
    // pricedInThread quét luồng: thấy mẫu này ĐÃ có giá -> NHƯỜNG xuống handler IMAGE_REQ (gửi ảnh thuần, không nhắc giá).
    const _imgOnlyReq = (_ai("IMAGE_REQ") || wantsImages(latestText)) && !priceAsk;
    const _priceAlreadyInThread = pricedInThread(data.messages, productInfo);
    if (_imgOnlyReq && _priceAlreadyInThread && _newModelPresented) {
      console.log(`[${BOT_NAME}] Khách XIN ẢNH + mẫu ${String(productInfo.code || "").toUpperCase()} ĐÃ có giá trong luồng (bot/NV) -> KHÔNG báo giá lại, nhường handler ảnh (gửi ảnh thuần).`);
    }
    // ===== HẬU MÃI: để AI GẮN NHÃN (ORDER_STATUS / REFUND_REQUEST / EXCHANGE_REQUEST / DEFECT_REPORT...) =====
    // ĐÃ BỎ guard code tự đoán "thread hậu mãi" từ lịch sử (shopConfirmedOrderInHistory): nó chặn SAI khi khách
    //  đã từng đặt 1 đơn rồi hỏi GIÁ mẫu MỚI (Phuong Pham gửi 2 ảnh Olyssa/Oriva + "Giá mây e" -> bị giao người thật).
    //  Hậu mãi thật (hỏi ship/tra đơn/đổi-trả) -> AI gắn nhãn tương ứng -> handler ORDER_STATUS @~6775 & nhóm
    //  hậu-mãi @~5998 lo giao người thật. Khách hỏi GIÁ (PRICE_ASK) -> báo giá bình thường.
    // [FIX Vân Phùng Lê vs Nga Le] TÁCH khách CŨ vs MỚI khi CHỈ chào trống + mẫu resolve từ ẢNH ad:
    //   - Khách CŨ (đã từng được báo giá trong lịch sử = botQuotedPriceInHistory) -> chỉ chào "em ơi" thì
    //     KHÔNG báo giá đè (mã ad đã báo rồi). Chào nhẹ, chờ khách nêu nhu cầu / hỏi giá cụ thể.
    //   - Khách MỚI (chưa từng báo giá) -> KHÔNG chặn ở đây, rơi xuống block 9097 báo giá mẫu ad (luật: ad mới -> báo giá).
    //   - Khách hỏi GIÁ cụ thể (priceAsk) -> gate KHÔNG bắt (có !priceAsk) -> xuống 9097 báo giá. (đúng "trừ khi hỏi giá cụ thể")
    const _greetingOnlyAdModelOld = mem._aiOk && _ai("GREETING") && !priceAsk && imageCount === 0
      && !_fromImageThisTurn && _newModelPresented && !_givesClosingInfo && !_orderIntentNow
      && botQuotedPriceInHistory(data.messages);
    if (_greetingOnlyAdModelOld) {
      // Xác nhận mẫu khách đang quan tâm + đuôi LINH HOẠT (đã có/chưa có size, có/chưa có địa chỉ, freesize)
      // dùng lại sizeTailForProduct GIỐNG các câu báo giá khác. KHÔNG báo giá đè (mã ad đã báo trong lịch sử).
      const _label = productLabel(productInfo);
      let _tail = "";
      try { _tail = sizeTailForProduct(mem, productInfo) || ""; } catch (_) {}
      const _greet = `Dạ chị đang quan tâm mẫu ${_label} đúng không ạ, Mẫu này đang được nhiều chị mê lắm!${_tail}`;
      await sendInboxMessage(conversationId, _greet);
      console.log(`[${BOT_NAME}] Khách CŨ chỉ chào ("${latestText}") (lịch sử ĐÃ báo giá) -> xác nhận mẫu ${_label} + hỏi size/đuôi linh hoạt, KHÔNG báo giá đè.`);
      mem.lastBotReply = _greet; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }
    if ((priceAsk || _newModelPresented) && productInfo && thisTurn.length <= 1 && !_givesClosingInfo && !_alreadyOrdered
        && !(_imgOnlyReq && _priceAlreadyInThread)) {
      const k = String(productInfo.code || "").toUpperCase();
      // CHỐNG LẶP BÁO GIÁ (đường Hỏi-giá, giống FIX Y cho đường tư vấn): mẫu này ĐÃ báo giá trong hội thoại
      // (vd cổng AD vừa báo, HOẶC người thật gõ tay) + khách vẫn CHỈ hỏi giá -> KHÔNG báo lại, KHÔNG gửi lại 3 ảnh.
      // (Mẫu MỚI -> chưa quotedRecently/không có trong luồng -> vẫn báo bình thường. Hỏi ý KHÁC như size/màu/chất -> handler trên đã lo.)
      if (quotedRecently(mem, k) || _priceAlreadyInThread) {
        console.log(`[${BOT_NAME}] Hỏi giá nhưng mẫu ${k} ĐÃ báo giá ${quotedRecently(mem, k) ? "lượt trước (bot)" : "trong luồng (NV/bot)"} -> KHÔNG báo lại / không gửi lại ảnh (chống lặp).`);
        markProcessed(batch); return true;
      }
      const pl = priceLine(productInfo);
      console.log(`Hỏi giá${_newModelPresented && !priceAsk ? " (mẫu mới gửi)" : ""} | mẫu ${productInfo.name}(${k}) | price="${productInfo.price}" sale="${productInfo.salePrice}" priceText="${productInfo.priceText || ""}" -> "${pl}"`);
      if (pl) {
        const reply = buildCommentOpener(productInfo, mem);   // giá (+ưu đãi) + dẫn dắt size
        markPriced(mem, k);
        mem._imgAllowSend = true;   // báo giá -> được kèm ảnh (kể cả đã gửi ảnh mẫu khác trước đó)
        if (data.fromAd) ensureSourceColorFromCaption(mem, k, `${data.adTitle || ""} ${data.postCaption || ""} ${(data.adCaptionCandidates || []).join(" ")}`);
        await maybeSendImages(conversationId, k, mem, true);   // ĐẢO THỨ TỰ: gửi ẢNH TRƯỚC (§13: báo giá -> BẮT BUỘC kèm 3 ảnh, kể cả đã gửi)
        await sendInboxMessage(conversationId, reply);          // ĐẢO THỨ TỰ: rồi mới gửi TEXT (giá + câu hành động ở cuối -> hành động luôn sau cùng)
        // 2 SP: khách bấm ADS mẫu KHÁC -> báo LIỀN mẫu ADS đang ghim (Plena) ngay sau mẫu ảnh khách (Mona).
        if (mem.pendingAdQuote && String(mem.pendingAdQuote).toUpperCase() !== k) {
          const _pc = String(mem.pendingAdQuote).toUpperCase();
          try {
            if (!quotedRecently(mem, _pc)) {
              const _cc = await ensureCatalog();
              const _pp = _cc.byCode.get(_pc);
              if (_pp && !recommend.isOutOfStock(_pp)) {
                await delay(700);
                const _po = buildCommentOpener(_pp, mem);
                markPriced(mem, _pc);
                if (!mem.quotedProducts) mem.quotedProducts = [];
                if (!mem.quotedProducts.some(x => String(x.code || "").toUpperCase() === _pc)) mem.quotedProducts.push(_pp);
                if (data.fromAd) ensureSourceColorFromCaption(mem, _pc, `${data.adTitle || ""} ${data.postCaption || ""} ${(data.adCaptionCandidates || []).join(" ")}`);
                await maybeSendImages(conversationId, _pc, mem, true);   // ĐẢO: ảnh trước
                await sendInboxMessage(conversationId, _po);             // ĐẢO: text sau
                mem.lastBotReply = _po;
                console.log(`[${BOT_NAME}] Báo LIỀN mẫu ADS đang ghim ${_pc} ngay sau mẫu ảnh ${k} (coi như 2 SP).`);
              }
            }
          } catch (e) { console.log("[pendingAd] lỗi:", e.message); }
          mem.pendingAdQuote = null;
        }
        console.log("Báo giá (code):", reply);
        mem.lastBotReply = reply;
        // Khách VỪA xin bảng size cùng tin -> gửi kèm (không bỏ sót ý).
        try { await maybeSendSizeChart(conversationId, latestText, productInfo, mem); } catch (_) {}
        scheduleFollowup(conversationId, mem, productInfo, reply);   // báo giá suông (freesize) -> 30s sau nhắc hành động
        updateConversationState(conversationId, mem);
        markProcessed(batch);
        return true;
      }
      // Giá KHÔNG có/sai trong sheet -> KHÔNG bịa, nhờ người thật kiểm tra
      await tagChoXuLyVaUnread(conversationId);
      console.log(`GIÁ THIẾU/LỖI cho mã ${k} (sheet) -> chờ kiểm tra + thẻ AI-CHỜ XL.`);
      mem.lastBotReply = HUMAN_CHECK_REPLY;
      mem.botHandoffAt = Date.now();
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== Hỏi PHÍ SHIP / THỜI GIAN GIAO -> trả lời gọn theo §14, KHÔNG báo lại giá =====
    if (thisTurn.length <= 1) {
      if (isDeliveryConcern(latestText) && mem.lastWasDelivery) {
        // Khách chê lâu SAU khi đã báo 5-7 ngày -> giờ mới đưa lý do mềm
        await sendInboxMessage(conversationId, DELIVERY_SLOW_REPLY);
        console.log("Khách lăn tăn thời gian giao -> đưa lý do mềm.");
        mem.lastWasDelivery = false;
        mem.lastBotReply = DELIVERY_SLOW_REPLY;
        updateConversationState(conversationId, mem);
        markProcessed(batch);
        return true;
      }
      if ((_aiOr(isDeliveryTimeQuestion(latestText), "DELIVERY_QA")) && !isUrgentSpecificDate(latestText)) {
        // Hỏi chung chung -> 5-7 ngày (đơn đã chốt -> KHÔNG mời lên đơn lại)
        const dtr = deliveryTimeReply(mem);
        await sendInboxMessage(conversationId, dtr);
        console.log(`Hỏi thời gian giao (chung) -> trả 5-7 ngày${mem.orderClosed ? " (đơn đã chốt, không mời lại)" : " + dẫn dắt"}.`);
        mem.lastWasDelivery = true;
        mem.lastBotReply = dtr;
        updateConversationState(conversationId, mem);
        markProcessed(batch);
        return true;
      }
      if (isShipFeeQuestion(latestText)) {
        const prods = quotedProducts.length ? quotedProducts : (productInfo ? [productInfo] : []);
        if (prods.length) {
          let reply = shipReplyText(prods);
          // Tin TRỘN ship + cân nặng (vd "Có mất phí ship k ạ. Mình 1m58 nặng 53kg") -> trả ship + GỘP tư vấn
          // size luôn. Nếu không gộp ở đây, handler tính size phía dưới KHÔNG chạy (vì đã return) -> bỏ sót size.
          try {
            const _wk = parseWeightKg(latestText);
            const _pi = productInfo || prods[0];
            if (_wk && !isGiftContext(latestText) && _pi && _pi.size) {
              const _rec = resolveSizeByWeight(_wk, _pi.size);
              if (_rec && _rec !== "OVER" && _rec !== "FREESIZE") {
                mem.weightKg = _wk; mem.customerSize = _rec; mem.sizeFromCustomer = false;
                reply += ` Dạ với ${_wk}kg chị mặc ${sizeLabel(_rec)} là vừa xinh ạ.`;
              } else if (_rec === "FREESIZE") {
                mem.weightKg = _wk;
                reply += ` Dạ mẫu này freesize, với ${_wk}kg chị mặc vừa đẹp ạ.`;
              }
            }
          } catch (_) {}
          await sendInboxMessage(conversationId, reply);
          console.log("Hỏi phí ship -> trả lời kết quả (không đọc luật, không báo lại giá):", reply);
          mem.lastBotReply = reply;
          updateConversationState(conversationId, mem);
          markProcessed(batch);
          return true;
        }
        // chưa biết mẫu nào -> để AI trả lời chính sách ship chung
      }
    }

    // NHIỀU MẪU MỚI -> block §17 (BÁO GIÁ từng mẫu). NHƯNG nếu khách đang CHỐT (lấy/chốt/đặt...) thì
    // KHÔNG báo giá lại — để luồng chốt đơn bên dưới lo (vd "lấy Gabriella và Pora").
    const _explicitOrderNow =
      /(?<![\p{L}\p{N}])(chốt|lấy|đặt|order|lấy luôn|chốt luôn)(?![\p{L}\p{N}])/iu.test(latestText) ||
      /lên đơn|ok lấy|ok lên|đồng ý lên|gửi hàng đi|ship đi/i.test(latestText);
    if (thisTurn.length > 1 && !_explicitOrderNow) {
      // SUY size TRƯỚC (nếu khách cho cao/nặng/số đo ngay trong tin) -> để biết mẫu nào còn/hết SIZE khách.
      const _wMulti = parseWeightKg(latestText);
      const _3vMulti = parse3V(latestText);
      if (!mem.customerSize && _wMulti && !isGiftContext(latestText)) {
        mem.weightKg = _wMulti;
        const _baseSz = weightToBaseSize(_wMulti);
        if (_baseSz) { mem.customerSize = _baseSz; mem.sizeFromCustomer = false; }
        console.log(`[${BOT_NAME}] Đa mẫu: khách cho ${_wMulti}kg -> suy size ${_baseSz} (KHÔNG hỏi lại cao/nặng).`);
      } else if (!mem.customerSize && _3vMulti) {
        mem.measure3V = _3vMulti;
      }
      // CÓ cân nặng/số đo khách -> TÁCH mẫu CÒN size vs HẾT size khách.
      // QUY TẮC: phải có cân/số đo trước mới được phán "hết size". Chưa có -> báo giá cả cụm như cũ.
      const _bodyKnown = !!(mem.weightKg || mem.measure3V);
      let _inStock = thisTurn, _noSize = [];
      if (_bodyKnown) {
        _inStock = []; _noSize = [];
        for (const p of thisTurn) {
          if (recommend.isOutOfStock(p)) { _inStock.push(p); continue; }   // hết cả mẫu -> sendBlocks tự báo "hết hàng"
          const _av = parseAvailableSizes(p.size);
          if (_av.size === 0 || _av.has("FREESIZE")) { _inStock.push(p); continue; }   // không kê size / freesize -> coi như có
          let _fit = null;
          if (mem.measure3V) { const r = resolveSizeBy3V(mem.measure3V[0], mem.measure3V[1], mem.measure3V[2], ["S","M","L","XL","XXL","XXXL"].filter(s => _av.has(s))); _fit = r && !r.over ? r.size : null; }
          if (!_fit && mem.weightKg) { const r = resolveSizeByWeight(mem.weightKg, p.size); _fit = (r && r !== "OVER") ? r : null; }
          if (!_fit && mem.customerSize && _av.has(mem.customerSize)) _fit = mem.customerSize;
          if (_fit) _inStock.push(p); else _noSize.push(p);
        }
      }
      // Báo giá + ảnh CHỈ mẫu còn (size khách). Mẫu hết size: KHÔNG báo giá, KHÔNG gửi mẫu tương tự.
      if (_inStock.length) await sendBlocks(conversationId, _inStock, mem, askImages, priceAsk);
      // Thông báo mẫu HẾT size khách — KHÔNG vơ cả nắm (chỉ nêu đúng mẫu hết, hướng về mẫu còn).
      if (_noSize.length) {
        const _noNames = _noSize.map(p => productLabel(p)).join(", ");
        const _okNames = _inStock.filter(p => !recommend.isOutOfStock(p)).map(p => productLabel(p));
        const _okLead = _okNames.length ? _okNames.join(", ") : "";
        let _hetMsg;
        if (_okLead) {
          _hetMsg = `Dạ ${_noNames} hiện tại đang không có size của mình chị ạ. Riêng ${_okLead} thì bên em vẫn còn size cho mình nha`;
        } else {
          _hetMsg = `Dạ ${_noNames} hiện tại đang không có size của mình chị ạ`;
        }
        await sendInboxMessage(conversationId, _hetMsg);
        console.log(`[${BOT_NAME}] Đa mẫu: HẾT size khách [${_noNames}] -> không báo giá; còn [${_okLead || "-"}].`);
      }
      // 1 CÂU HÀNH ĐỘNG DUY NHẤT theo trạng thái:
      //  - CHƯA biết size & không suy được -> HỎI cao/nặng.
      //  - Biết size, còn mẫu, CHƯA đủ sđt+địa chỉ -> mời + xin info.
      //  - Biết size, còn mẫu, ĐỦ info -> mời lên đơn.
      const _hasContact = mem.phone && addrReady(mem);
      const _someInStock = _inStock.some(p => !recommend.isOutOfStock(p));
      let closeText;
      if (mem.customerSize && _someInStock && _hasContact) {
        closeText = "Dạ chị ưng mẫu nào em lên đơn cho mình luôn nha ạ.";
      } else if (mem.customerSize && _someInStock) {
        closeText = "Dạ chị ưng mẫu nào cho em xin số điện thoại và địa chỉ để em lên đơn cho mình nha ạ.";
      } else if (mem.measure3V && _someInStock) {
        closeText = "Dạ chị ưng mẫu nào em tư vấn size theo số đo rồi lên đơn cho mình nha ạ.";
      } else if (!_someInStock && _noSize.length) {
        // Tất cả mẫu khách gửi đều hết size khách -> mời chọn mẫu khác (KHÔNG tự gửi mẫu tương tự).
        closeText = "Dạ mình tham khảo thêm mẫu khác bên em nha, biết đâu có mẫu hợp size hơn ạ.";
      } else {
        closeText = "Dạ chị cho em xin chiều cao và cân nặng để em tư vấn size cho mình nha ạ?";
      }
      // [SALE GỌN 2026-07] Cuối CỤM nhiều mẫu: kèm câu CHƯƠNG TRÌNH đúng MỘT LẦN trước câu hành động
      // (từng block giá ở trên giữ gọn, không lặp câu chương trình theo từng mẫu).
      try {
        const _sgC = saleProgram(mem._pageId);
        if (_sgC && _sgC.che_do_sale_gon && _sgC.cau_kem_bao_gia) closeText = _sgC.cau_kem_bao_gia + " ạ.\n" + closeText;
      } catch (_) {}
      await sendInboxMessage(conversationId, closeText);
      mem.askedContact = replyAsksContact(closeText);
      // Khách VỪA xin bảng size trong cùng tin -> gửi kèm (không bỏ sót ý).
      try { await maybeSendSizeChart(conversationId, latestText, thisTurn[0] || productInfo, mem); } catch (_) {}
      console.log("ĐÃ GỬI", thisTurn.length, "block");
      if (unresolved > 0 && imageCount >= 2) {
        // Gửi 2+ mẫu mà CÒN mẫu CHƯA nhận ra (thiếu giá) -> báo chờ + AI-CHỜ XL (chặn AI, người thật bổ sung giá), KHÔNG dùng AI-XL ảnh.
        const wait = "Dạ chị chờ 1 lát em kiểm tra thông tin các mẫu còn lại rồi báo chị ạ";
        await sendInboxMessage(conversationId, wait);
        await tagChoXuLyVaUnread(conversationId);
        mem.botHandoffAt = Date.now();
        console.log(`Có ${unresolved} mẫu chưa nhận ra (thiếu giá) -> báo chờ + AI-CHỜ XL + chưa đọc`);
      }
      mem.lastBotReply = "[multi-block]";
      cancelFollowup(conversationId);   // ĐA MẪU: câu "chị ưng mẫu nào nhắn em" đã là lời mời -> KHÔNG follow-up "mẫu này" (tránh 2 câu hành động lặp/spam)
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH THAN "KHÔNG CÓ SIZE" sau khi tư vấn 2 người (1 người CÓ size, 1 người KHÔNG) =====
    // Chặn AI tóm tắt sai "không có cho cả hai": nói ĐÚNG người vừa vẫn lấy được, người kia gợi ý mẫu khác.
    if (lamentsNoSize(latestText) && mem.multiAdvice
        && (mem.multiAdvice.fit || []).length && (mem.multiAdvice.over || []).length
        && (Date.now() - (mem.multiAdvice.ts || 0) < 3600000)) {
      const fitTxt = mem.multiAdvice.fit
        .map(f => `${f.label} thì vẫn lấy được ${f.size === "FREESIZE" ? "freesize" : sizeLabel(f.size)} vừa đẹp`)
        .join(", ");
      const overTxt = mem.multiAdvice.over.map(o => o.label).join(", ");
      const reply = `Dạ ${fitTxt} nha chị, chỉ ${overTxt} thì mẫu này chưa có size vừa thôi ạ. Phần đó chị tham khảo thêm mẫu khác bên em cho hợp, em gợi ý giúp mình nha?`;
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách than không có size (1 vừa 1 không) -> nói đúng. fit=[${fitTxt}] over=[${overTxt}]`);
      mem.multiAdvice = null;   // tiêu thụ 1 lần, tránh lặp/misfire về sau
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== ĐIỀU 10/11: KHÁCH HỎI CHO 2+ NGƯỜI trong 1 tin (mỗi người 1 cân nặng, có/không kèm màu) =====
    // "Màu vàng 61kg, màu hồng tím 55kg" HOẶC "M56 50kg với m6 60kg" -> tư vấn TỪNG người 1 size,
    // xử lý cả ca KHÔNG VỪA (vượt size), và HỎI "mua tặng bạn ạ?" (vì 2 người = mua hộ/tặng).
    {
      const cwPairs = productInfo ? parseColorWeightPairs(latestText, productInfo) : [];
      const allW = productInfo ? parseAllWeights(latestText) : [];
      const distinctW = [...new Set(allW)];
      const multiByColor = cwPairs.length >= 2;
      const multiByWeight = distinctW.length >= 2;
      if (productInfo && (multiByColor || multiByWeight)) {
        const avail = parseAvailableSizes(productInfo.size);
        const isFree = avail.size === 1 && avail.has("FREESIZE");
        const code = _up(productInfo.code || "");
        mem.sizeByLine = mem.sizeByLine || {};
        // Đơn vị tư vấn: ưu tiên gắn theo MÀU nếu có đủ cặp màu+cân; nếu không thì theo từng CÂN NẶNG.
        const units = multiByColor
          ? cwPairs.map(p => ({ label: `màu ${p.color} ${p.kg}kg`, kg: p.kg, color: p.color }))
          : distinctW.map(kg => ({ label: `${kg}kg`, kg }));
        const parts = [];
        const fit = [], over = [];
        for (const u of units) {
          let recSize = null;
          if (isFree) {
            if (u.kg >= 42 && u.kg <= (SIZE_MAX_KG.FREESIZE || 57)) recSize = "FREESIZE";
          } else {
            const rec = resolveSizeByWeight(u.kg, productInfo.size);
            if (rec && rec !== "OVER") recSize = rec;
          }
          if (recSize) {
            if (u.color && recSize !== "FREESIZE") mem.sizeByLine[code + "|" + foldVi(u.color)] = recSize;   // size RIÊNG theo màu để chốt đơn ghi đủ
            fit.push({ label: u.label, kg: u.kg, size: recSize });
            parts.push(recSize === "FREESIZE" ? `${u.label} mặc freesize vừa đẹp` : `${u.label} thì mặc vừa ${sizeLabel(recSize)}`);
          } else {
            over.push({ label: u.label, kg: u.kg });
            parts.push(`${u.label} thì hiện mẫu này bên em chưa có size vừa rồi ạ, tiếc quá`);
          }
        }
        // 2 người -> coi như mua hộ/tặng: KHÔNG đụng size của khách, KHÔNG nói "trước đó chị hay mặc X".
        mem.isGift = true;
        // NHỚ kết quả (ai vừa / ai không) -> nếu khách than "không có size", trả lời ĐÚNG, không để AI tóm tắt sai.
        mem.multiAdvice = { fit, over, code, ts: Date.now() };
        const reply = `Dạ ${parts.join(", còn ")}, chị mua tặng bạn ạ?`;
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Tư vấn 2+ người (${multiByColor ? "theo màu" : "theo cân nặng"}) -> ${parts.join(" | ")}`);
        mem.lastBotReply = reply;
        updateConversationState(conversationId, mem);
        markProcessed(batch);
        return true;
      }
    }

    // ===== ĐIỀU 8: KHÁCH LĂN TĂN size (cùng 1 tin "lúc S lúc M") -> tư vấn theo BẢNG SIZE CHUẨN =====
    if (mem.sizeWavering && productInfo && !isGiftContext(latestText)) {
      const avail = parseAvailableSizes(productInfo.size);
      const isFree = avail.size === 1 && avail.has("FREESIZE");
      let reply;
      if (isFree) {
        reply = freesizeLine(mem, productInfo);
      } else if (mem.weightKg) {
        const rec = resolveSizeByWeight(mem.weightKg, productInfo.size);
        if (rec && rec !== "OVER") {
          if (rec !== "FREESIZE") { mem.customerSize = rec; mem.sizeFromCustomer = false; }
          reply = `Dạ vậy với ${mem.weightKg}kg em lấy ${sizeLabel(rec)} là chuẩn form nhất cho mình nha chị`;
        } else reply = noFitReply(mem.weightKg);
      } else if (mem.measure3V) {
        const { size, over } = resolveSizeBy3V(mem.measure3V[0], mem.measure3V[1], mem.measure3V[2], [...avail]);
        if (size && !over) {
          mem.customerSize = size; mem.sizeFromCustomer = false;
          reply = `Dạ với số đo của mình em lấy ${sizeLabel(size)} là chuẩn nhất cho chị nha`;
        } else reply = noFitReply(null);
      } else {
        // CHƯA có cân nặng/số đo -> không chốt bừa size nào, xin để tư vấn theo bảng chuẩn.
        reply = "Dạ để em tư vấn size chuẩn nhất cho mình, chị cho em xin chiều cao và cân nặng của mình nha ạ";
      }
      mem.sizeWavering = false;   // đã xử lý lượt này
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách lăn tăn size (${(mem.waverSizes || []).join("/")}) -> tư vấn theo bảng chuẩn.`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== TƯ VẤN SIZE BẰNG CODE: khách báo cân nặng -> chốt 1 size đúng mẫu THỰC CÓ =====
    {
      const weightKg = parseWeightKg(latestText);
      const availStr = productInfo && productInfo.size;
      const rec = weightKg && availStr ? resolveSizeByWeight(weightKg, availStr) : null;
      // QUY TẮC: khách quan tâm 1 mẫu mà mẫu đó CHƯA TỪNG báo giá -> BÁO GIÁ + ẢNH TRƯỚC, rồi mới tư vấn size.
      // (vd: bấm ad rồi hỏi "size 60kg" ngay -> phải báo giá Camellia trước, không nhảy thẳng vào size.)
      if (rec && productInfo) {
        const _sc = _codeUp(productInfo);
        if (_sc && !quotedRecently(mem, _sc) && !(mem.orderedByCode && mem.orderedByCode[_sc])) {
          const _pl = priceLine(productInfo);
          if (_pl) {
            const _opener = buildCommentOpener(productInfo, mem);   // "Dạ <mẫu> giá ...đ ạ." + dẫn dắt
            await sendInboxMessage(conversationId, _opener);
            markPriced(mem, _sc);
            if (!mem.quotedProducts) mem.quotedProducts = [];
            if (!mem.quotedProducts.some(x => String(x.code || "").toUpperCase() === _sc)) mem.quotedProducts.push(productInfo);
            try { await maybeSendImages(conversationId, productInfo.code, mem, true); } catch (_) {}
            console.log(`[${BOT_NAME}] Khách hỏi size mẫu CHƯA báo giá -> BÁO GIÁ + ảnh TRƯỚC (${_sc}), rồi tư vấn size.`);
          }
        }
      }
      // Khách mua TẶNG / mua HỘ / mua CHO người khác -> cân nặng là của người được mua, KHÔNG phải khách.
      // Xét THEO TỪNG TIN (vd "bạn em 50kg" = mua hộ; còn "chị 45kg" = chính khách).
      const isGift = isGiftContext(latestText);
      if (rec === "OVER") {
        // Cân nặng KHÔNG nằm trong size nào mẫu có -> KHÔNG ép size.
        // Khách XL+ (vượt size L của shop) -> KHÔNG điều hướng mẫu khác; chỉ quá riêng mẫu này -> mời mẫu khác.
        mem.weightKg = weightKg;                 // NHỚ cân nặng khách (dùng lại, KHÔNG hỏi lại)
        if (!isGift) mem.noFitForCode = productInfo.code;   // NHỚ mẫu này không vừa -> không lặp hỏi/ chốt
        mem.pendingSizeByWeight = false;
        // Cân TRONG tầm shop (<=60kg) + không phải mua hộ -> gợi ý MẪU MỚI KHÁC có size của khách (8 mẫu, 2 ảnh/mẫu).
        if (weightKg && weightKg <= SHOP_MAX_KG && !isGift) {
          const _n = await sendNoFitAlternatives(conversationId, mem, weightKg, productInfo.code);
          if (_n > 0) {
            console.log(`Size OVER ${weightKg}kg mẫu ${productInfo.code} -> gửi ${_n} mẫu MỚI khác CÓ size của khách (2 ảnh/mẫu).`);
            mem.lastBotReply = "[mẫu khác có size]";
            updateConversationState(conversationId, mem); markProcessed(batch); return true;
          }
          // Không có mẫu mới nào vừa -> câu tiếc gọn (đúng kịch bản 2).
          const reply2 = "Dạ tiếc quá, mẫu này hiện tại không có size vừa với chị rồi ạ, chị lựa mẫu khác giúp em nha.";
          await sendInboxMessage(conversationId, reply2);
          console.log(`Size OVER ${weightKg}kg mẫu ${productInfo.code} -> KHÔNG có mẫu mới nào vừa -> câu tiếc gọn.`);
          mem.lastBotReply = reply2; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        const reply = noFitReply(weightKg);
        await sendInboxMessage(conversationId, reply);
        console.log(`Size OVER: ${weightKg}kg vượt mẫu ${productInfo.code} (có: ${availStr}); >shopMax=${weightKg > SHOP_MAX_KG} -> ${weightKg > SHOP_MAX_KG ? "không điều hướng" : "mời mẫu khác"}.`);
        mem.lastBotReply = reply;
        updateConversationState(conversationId, mem);
        markProcessed(batch);
        return true;
      }
      if (rec) {
        mem.weightKg = weightKg;                                  // NHỚ cân nặng khách
        if (mem.noFitForCode === (productInfo && productInfo.code)) mem.noFitForCode = null;  // mẫu này lại vừa -> bỏ cờ
        // [CHỐNG LẶP size] tin bot vừa gửi CHƯA kịp về Pancake -> vòng quét sau shopReplied=false -> vào lại đây gửi
        //  câu size y hệt (chỉ khác praise() random) -> khách thấy 3-4 câu trùng (Tham Lai/Nguyet). Nếu cùng
        //  (cân|size|mẫu) vừa tư vấn <120s -> BỎ QUA, không gửi lại, chờ Pancake đồng bộ.
        const _szSig = `${weightKg}|${rec}|${(productInfo && productInfo.code) || ""}`;
        if (mem._sizeAdviceSig === _szSig && (Date.now() - (mem._sizeAdviceAt || 0)) < 120000) {
          console.log(`[${BOT_NAME}] [chống lặp size] đã tư vấn ${_szSig} <120s trước -> KHÔNG gửi lại (đợi Pancake đồng bộ).`);
          markProcessed(batch); return true;
        }
        mem._sizeAdviceSig = _szSig; mem._sizeAdviceAt = Date.now();
        if (isGift) {
          // Mua cho người khác: tư vấn theo cân nặng đưa ra, xưng "mình" (KHÔNG "chị mặc"),
          // có size vừa -> NÊU SIZE + mời để lại sđt/địa chỉ lên đơn (KHÔNG ghi đè size của khách).
          const nameTxt = productLabelSp(productInfo);
          const _giftAct = (mem.phone && mem.address)
            ? `Chị yêu thích sản phẩm thì em lên đơn ${sizeLabel(rec)}${noiNhanAddr(mem)} cho mình nha.`
            : `Chị ưng sản phẩm gửi em xin số điện thoại và địa chỉ em lên đơn cho mình nha?`;
          const reply = `Dạ với ${weightKg}kg mình vừa với ${sizeLabel(rec)} bên em đó ạ, ${nameTxt}${praise(mem)} đó ạ. ${_giftAct}`;
          await sendInboxMessage(conversationId, reply);
          console.log(`Tư vấn size (mua tặng người khác): ${weightKg}kg -> ${rec} (mẫu có: ${availStr}) + mời để lại sđt`);
          mem.giftSize = rec;
          mem.lastBotReply = reply;
          updateConversationState(conversationId, mem);
          markProcessed(batch);
          return true;
        }
        // VÊNH với size KHÁCH ĐÃ TỰ KHAI (vd khách gõ "mặc M", cân nặng ra L).
        // [FIX Shuixian Yu] Khách TỰ KHAI size (sizeFromCustomer===true) -> TÔN TRỌNG Ý KHÁCH, KHÔNG đè
        //   bằng size cân nặng. Cân nặng CHỈ để gợi ý; khách chốt size nào thì LÊN ĐƠN size đó.
        //   (Trước đây cân lệch >3kg -> đè size khách bằng size bảng -> tư vấn M chốt L, SAI ý khách.)
        if (mem.customerSize && mem.customerSize !== rec
            && mem.sizeFromCustomer === true
            && rec !== "FREESIZE" && mem.customerSize !== "FREESIZE") {
          const _old = String(mem.customerSize).toUpperCase();
          mem.customerSize = _old;            // GIỮ đúng size khách chốt (KHÔNG đè bằng rec)
          // sizeFromCustomer giữ true -> vẫn là ý khách.
          const _act = (mem.phone && mem.address)
            ? `Để em lên đơn${noiNhanAddr(mem)} cho mình nhe ạ.`
            : `Chị ưng sản phẩm gửi em xin số điện thoại và địa chỉ em lên đơn cho mình nha?`;
          const ask = `Dạ chị quen mặc ${sizeLabel(_old)} thì em lên đơn ${sizeLabel(_old)} cho mình nha ạ. ${_act}`;
          await sendInboxMessage(conversationId, ask);
          console.log(`Tư vấn size: khách TỰ KHAI ${_old} (cân ${weightKg}kg gợi ý ${rec}) -> TÔN TRỌNG khách, CHỐT ${_old}`);
          mem.lastBotReply = ask;
          updateConversationState(conversationId, mem);
          markProcessed(batch);
          return true;
        }
        if (rec !== "FREESIZE") mem.customerSize = rec;   // KHÔNG lưu FREESIZE làm size khách
        mem.sizeFromCustomer = false;   // size do BOT suy từ cân nặng -> KHÔNG dùng làm "lịch sử khách"
        const nameTxt = productLabelSp(productInfo);
        // ĐỦ sđt+địa chỉ -> mời chốt về địa chỉ cũ; CHƯA đủ -> xin liên hệ kiểu MỀM ("Chị ưng sản phẩm cho em xin...").
        const tail = (mem.phone && mem.address)
          ? `${nameTxt}${praise(mem)} đó chị, em lên đơn${noiNhanAddr(mem)} cho mình nhe ạ.`
          : `${nameTxt}${praise(mem)} đó chị, Chị ưng sản phẩm cho em xin số điện thoại và địa chỉ em lên đơn cho mình nhe?`;
        const reply = `Dạ với ${weightKg}kg chị mặc ${sizeLabel(rec)} là vừa xinh ạ, ${tail}`;
        await sendInboxMessage(conversationId, reply);
        console.log(`Tư vấn size bằng code: ${weightKg}kg -> ${rec} (mẫu có: ${availStr})`);
        mem.lastBotReply = reply;
        updateConversationState(conversationId, mem);
        markProcessed(batch);
        return true;
      }
    }

    // ===== ĐƠN NHIỀU DÒNG: "lấy s kem, m nâu" / "đen s, m xám" / "2 chiếc m" / "mỗi màu 1 chiếc" =====
    // Cùng 1 mẫu vẫn tách được nhiều dòng (mỗi màu/size/số lượng). Chống lên đơn THIẾU.
    // Cổng: chỉ khi khách ĐANG CHỐT / ĐANG CHỌN MÀU, và KHÔNG phải câu hỏi tồn kho.
    if (productInfo && !mem.orderClosed && !asksInStock(latestText) && !looksLikeQuestion(latestText)) {
      const _code = _up(productInfo.code);
      const _colorVocab = [...cleanColors(productInfo.color), ...(getCodeColors(_code) || [])];
      const _sizeVocab = [...parseAvailableSizes(productInfo.size)];
      const _imgColorForCode = (mem.colorByCode || {})[_code] || mem.imageColor || "";   // màu KHÁCH GỬI ẢNH -> "màu ăn theo ảnh"
      const _lines = parseOrderLines(latestText, {
        colors: _colorVocab, sizes: _sizeVocab,
        askedColor: mem.askedImageColor || _imgColorForCode || "", askedSize: mem.customerSize || "",
      });
      // Kích hoạt khi: khách đang chốt / đang chọn màu / HOẶC mỗi dòng đã đủ màu+size (rõ là liệt kê món).
      const _strongItemized = _lines.length >= 2 && _lines.every(l => l.color && l.size);
      const _gate = customerWantsToOrder(latestText, mem.lastIntent) || mem.awaitingColorPick || _strongItemized;
      if (_lines.length && _gate) {
        for (const ln of _lines) ln.code = _code;   // cùng mẫu đang khoá
        const _avail = parseAvailableSizes(productInfo.size);
        const _needSize = _avail.size > 0 && !_avail.has("FREESIZE");
        const _nColors = _colorVocab.length;
        const _missSize = _needSize && _lines.some(l => !l.size);
        const _missColor = _nColors >= 2 && _lines.some(l => !l.color);
        if (_missColor) {
          const reply = _lines.length >= 2
            ? "Dạ chị cho em xin màu của từng món để em lên đơn đủ cho mình nha ạ"
            : "Dạ mẫu này mình lấy màu nào ạ để em lên đơn cho mình nha?";
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] [đơn nhiều dòng] thiếu MÀU ${_lines.length >= 2 ? "1 số dòng" : "(1 mẫu)"} -> xin màu. lines=${JSON.stringify(_lines)}`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        if (_missSize) {
          const reply = _lines.length >= 2
            ? "Dạ chị cho em xin size của từng món để em lên đơn đủ cho mình nha ạ"
            : "Dạ chị lấy size nào ạ để em lên đơn cho mình nha?";
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] [đơn nhiều dòng] thiếu SIZE ${_lines.length >= 2 ? "1 số dòng" : "(1 mẫu)"} -> xin size. lines=${JSON.stringify(_lines)}`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        mem.orderLines = _lines;                       // chốt cấu trúc đơn nhiều dòng
        mem.orderLinesCode = _code;
        const _tot = computeOrderTotal(mem, productInfo);
        if (mem.phone && addrReady(mem) && _tot.known) {
          const reply = await sendOrderClose(conversationId, mem, productInfo);
          await tagAiChot(conversationId);
          mem.orderClosed = true; mem.orderState = "DA_CHOT"; mem.everOrdered = true;
          console.log(`[${BOT_NAME}] [đơn nhiều dòng] CHỐT ${_lines.length} dòng (tổng ${_fmtMoney(_tot.total)}đ): ${JSON.stringify(_lines)}`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        const reply = `Dạ em ghi nhận ${_lines.length} món rồi ạ, chị cho em xin sđt và địa chỉ để em lên đơn cho mình nha`;
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] [đơn nhiều dòng] ghi nhận ${_lines.length} dòng, thiếu sđt/địa chỉ -> xin.`);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
    }

    // ===== KHÁCH TỰ NÓI SIZE -> THEO SIZE KHÁCH (ghi đè size cũ), chốt bằng code =====
    // Khách gầy/béo thay đổi nên nói "c mặc S mà" -> phải theo S, KHÔNG bám size cũ trong bộ nhớ.
    {
      const stated = extractStatedSize(latestText);
      if (stated && productInfo) {
        const avail = parseAvailableSizes(productInfo.size);
        const isFree = avail.has("FREESIZE");                 // freesize -> vừa với mọi size khách nói
        const has = avail.size === 0 || avail.has(stated);   // không rõ size mẫu thì cứ theo khách
        const giftCtx = isGiftContext(latestText);            // "mua hộ bạn size XL" -> XL là của người nhận
        const nameTxt = productLabelSp(productInfo);
        let reply;
        if (giftCtx) {
          // MUA HỘ: KHÔNG ghi đè size của khách, KHÔNG xưng "em lấy chị". Lưu giftSize.
          mem.giftSize = stated;
          mem.isGift = true;
          if (isFree) {
            // Mẫu freesize -> KHÔNG đọc size người nhận ra. S/M yên tâm; L+ -> hỏi cao/nặng của bạn để kiểm tra.
            reply = FREE_SAFE_SIZES.has(_up(stated))
              ? `Dạ ${nameTxt}là freesize, bạn mình mặc vừa đẹp đó ạ.`
              : `Dạ ${nameTxt}là freesize ạ, chị cho em xin chiều cao và cân nặng của bạn để em kiểm tra mặc có vừa không nha?`;
          } else if (has) {
            reply = `Dạ ${nameTxt}có ${sizeLabel(stated)} ạ, chị lấy giúp bạn size này nha. Chị cho em xin sđt và địa chỉ em lên đơn cho mình nhe ạ`;
          } else {
            reply = `Dạ mẫu này chưa có ${sizeLabel(stated)} cho bạn mình ạ, chị cho em xin chiều cao và cân nặng của bạn để em tư vấn size vừa nha?`;
          }
          await sendInboxMessage(conversationId, reply);
          console.log(`Khách MUA HỘ -> size người nhận=${stated} (KHÔNG đụng size khách).`);
          mem.lastBotReply = reply;
          updateConversationState(conversationId, mem);
          markProcessed(batch);
          return true;
        }
        if (isFree) {
          // MẪU FREESIZE -> KHÔNG đọc size S/M/L khách ra. S/M yên tâm; L+ chưa có cân nặng -> kiểm tra cao/nặng.
          if (stated !== "FREESIZE") { mem.customerSize = stated; mem.sizeFromCustomer = true; }
          const safe = FREE_SAFE_SIZES.has(_up(stated)) || stated === "FREESIZE" || mem.weightKg || mem.measure3V;
          if (safe) {
            reply = (mem.phone && mem.address)
              ? `Dạ ${nameTxt}là freesize, chị mặc vừa đẹp đó ạ, em lên đơn${noiNhanAddr(mem)} cho mình nha.`
              : `Dạ ${nameTxt}là freesize, chị mặc vừa đẹp đó ạ.`;
          } else {
            // khách mặc L trở lên mà chưa có cân nặng -> phải kiểm tra (freesize chỉ tới ~57kg)
            reply = `Dạ ${nameTxt}là freesize ạ, chị cho em xin chiều cao và cân nặng để em kiểm tra mặc có vừa không nha ạ?`;
          }
        } else if (has) {
          if (stated !== "FREESIZE") mem.customerSize = stated;  // size mẫu CÓ -> lưu, dùng để chốt (không lưu FREESIZE)
          mem.sizeFromCustomer = true;
          // ĐỦ THÔNG TIN (size + SĐT + ĐỊA CHỈ) + có Ý CHỐT / "ship về" / vừa cho địa chỉ -> CHỐT ĐƠN LUÔN
          // (lỗi cũ: khách cho cả size+đc+sđt mà bot vẫn đi báo giá / hỏi vòng).
          if (mem.phone && addrReady(mem) && !mem.orderClosed
              && (customerWantsToOrder(latestText, mem.lastIntent) || wantsShipOldAddress(latestText) || mem._addrJustGiven)) {
            const oc = await sendOrderClose(conversationId, mem, productInfo);
            await tagAiChot(conversationId);
            mem.orderClosed = true; mem.orderState = "DA_CHOT"; mem.everOrdered = true;
            console.log(`[${BOT_NAME}] Khách cho SIZE + SĐT + ĐỊA CHỈ (+ý chốt) -> CHỐT ĐƠN luôn (không báo giá lại).`);
            mem.lastBotReply = oc; updateConversationState(conversationId, mem); markProcessed(batch); return true;
          }
          const closeAsk = (mem.phone && mem.address)
            ? `em lên đơn${noiNhanAddr(mem)} cho mình nhe ạ`
            : "Chị ưng sản phẩm gửi em xin số điện thoại và địa chỉ em lên đơn cho mình nha?";
          reply = `Dạ vâng, em lấy chị ${sizeLabel(stated)} nha ạ. ${nameTxt}${praise(mem)} đó chị, ${closeAsk}.`;
        } else {
          // KHÁCH KHAI size mẫu KHÔNG CÓ (vd khách XL, mẫu chỉ S,M).
          mem.customerSize = null;
          mem.sizeFromCustomer = false;
          if (mem.noFitForCode === productInfo.code) {
            // ĐÃ xác định mẫu này KHÔNG có size vừa -> KHÔNG hỏi lại, khẳng định (theo cân nặng đã biết).
            reply = noFitReply(mem.weightKg);
          } else if (mem.weightKg) {
            // ĐÃ biết cân nặng -> soi bảng size mẫu, TUYỆT ĐỐI KHÔNG hỏi lại chiều cao/cân nặng.
            const recW = resolveSizeByWeight(mem.weightKg, productInfo.size);
            if (recW === "OVER" || !recW) {
              mem.noFitForCode = productInfo.code;
              reply = noFitReply(mem.weightKg);
            } else {
              if (recW !== "FREESIZE") mem.customerSize = recW;
              const closeAsk = (mem.phone && mem.address)
                ? `em lên đơn${noiNhanAddr(mem)} cho mình nhe ạ`
                : "Chị ưng sản phẩm cho em xin số điện thoại và địa chỉ em lên đơn cho mình nhe?";
              reply = `Dạ với ${mem.weightKg}kg chị mặc ${sizeLabel(recW)} là vừa xinh ạ, ${closeAsk}`;
            }
          } else {
            // CHƯA biết cân nặng -> hỏi (KHÔNG liệt kê size).
            reply = "Dạ chiều cao và cân nặng của chị thế nào vậy ạ?";
          }
        }
        await sendInboxMessage(conversationId, reply);
        console.log(`Khách tự nói size ${stated} -> theo khách. has=${has}. REPLY: ${reply}`);
        mem.lastBotReply = reply;
        updateConversationState(conversationId, mem);
        markProcessed(batch);
        return true;
      }
    }

    // ===== CHUYỂN KHOẢN: phân biệt rõ 2 ca (chạy TRƯỚC AI để chắc chắn) =====
    // CA 1: khách BÁO đã chuyển / nhờ XÁC THỰC đã nhận tiền chưa
    //   -> TUYỆT ĐỐI không tự xác nhận. Gắn thẻ AI-CHỜ XL để NGƯỜI THẬT kiểm tra giao dịch.
    if (asksPaymentReceived(latestText) && !_nhanCamRegex(mem, "asksPaymentReceived", ["PAYMENT_CONFIRM", "CK_PROOF", "ORDER_STATUS"])) {
      const reply = `Dạ chị chờ em chút, em kiểm tra lại giao dịch rồi báo lại mình ngay nha ạ`;
      await sendInboxMessage(conversationId, reply);
      await tagChoXuLyVaUnread(conversationId);
      console.log(`[${BOT_NAME}] Khách nhờ XÁC THỰC đã nhận tiền -> KHÔNG tự xác nhận, gắn thẻ AI-CHỜ XL cho người thật.`);
      mem.lastBotReply = reply;
      mem.botHandoffAt = Date.now();
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }
    // CA 2: khách MUỐN chuyển khoản / xin thông tin tài khoản -> cung cấp STK theo kịch bản.
    // [AI-QUYẾT cụm CK] AI chạy được -> CHỈ tin nhãn PAYMENT_METHOD (hết cảnh regex bắt nhầm "măck"=mặc).
    //   AI rỗng/timeout -> mới rớt về regex wantsBankInfo (lưới đỡ). Số STK vẫn do code (buildBankInfoReply).
    if (mem._aiOk ? _ai("PAYMENT_METHOD") : wantsBankInfo(latestText)) {
      const reply = buildBankInfoReply();
      await sendInboxMessage(conversationId, reply);
      // Gửi KÈM ảnh mã QR (mặc định) nếu đã cấu hình QR_URL.
      if (QR_URL) {
        const r = await sendInboxImageUrl(conversationId, QR_URL);
        console.log(`[${BOT_NAME}] Gửi ẢNH mã QR (content_url) -> sentImg=${!!(r && r.success !== false)} | URL=${QR_URL} | ${JSON.stringify(r).slice(0,160)}`);
      }
      console.log(`[${BOT_NAME}] Khách xin thông tin chuyển khoản -> gửi STK${QR_URL ? " + QR" : ""} theo kịch bản.`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH HỎI "SHOP CÓ ĐỊA CHỈ/SĐT CỦA CHỊ RỒI À?" -> trả lời thẳng + XIN ĐỒNG Ý RÕ RÀNG (KHÔNG tự chốt) =====
    if (asksIfHasInfo(latestText) && !mem.orderClosed && !customerGaveContact(latestText)) {
      const have = [];
      if (mem.phone) have.push("số điện thoại");
      if (mem.address) have.push("địa chỉ cũ");
      let reply;
      if (have.length) {
        // CÓ thông tin -> xác nhận, NHƯNG phải để khách đồng ý mới lên đơn (không tự chốt khi khách mới hỏi).
        reply = `Dạ em có ${have.join(" và ")} của mình rồi ạ. Chị xác nhận giúp em là lên đơn luôn nha ạ?`;
      } else {
        reply = "Dạ em kiểm tra hệ thống thì chưa có thông tin của mình ạ, chị gửi giúp em số điện thoại và địa chỉ nhận hàng nha ạ.";
      }
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách hỏi shop có info chưa -> trả lời (${have.length ? "có" : "chưa có"}), KHÔNG tự chốt, chờ khách đồng ý.`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH NÓI ĐÃ GỬI INFO / MUỐN SHIP ĐỊA CHỈ CŨ nhưng HỆ THỐNG CHƯA CÓ -> báo chưa thấy, xin gửi lại =====
    // TUYỆT ĐỐI không lặp câu mời/chốt size. Chỉ chạy khi đang THIẾU sđt/địa chỉ + tin này KHÔNG kèm info mới.
    if ((claimsAlreadyGaveInfo(latestText) || wantsShipOldAddress(latestText))
        && !customerGaveContact(latestText) && (!mem.phone || !mem.address) && !mem.orderClosed) {
      // [FIX Thu Trang 2026-07-08] Khách nói ĐÚNG: địa chỉ đã gửi ở trên — nhưng tin đó rơi vào vùng
      // người-thật-trả-lời / cụm bị bỏ nên luật cũ (ghi sổ theo LƯỢT) chưa từng ghi -> mem.address trống
      // -> xin đi xin lại, khách bực. AI-QUYẾT đọc NGUYÊN 20 tin lịch sử nên NHÌN THẤY địa chỉ đó
      // (địa_chỉ=DU + dia_chi_chuan). -> Trước khi mở miệng xin lại: hỏi AI; AI chấm ĐỦ + chuỗi gộp qua
      // được RÀO ĐỊA DANH THẬT -> nhận vào bộ nhớ luôn, khỏi xin (thiếu sđt thì chỉ xin đúng sđt).
      if (!mem.address && mem._aiQ && mem._aiQ.ok && mem._aiQ.dia_chi
          && mem._aiQ.dia_chi.trang_thai === "DU" && _aqLooksAddr(mem._aiQ.dia_chi.dia_chi_chuan)) {
        mem.address = mem._aiQ.dia_chi.dia_chi_chuan;
        console.log(`[${BOT_NAME}] [AI-QUYẾT cứu] khách nói "cho trên rồi" + AI đọc thấy địa chỉ trong lịch sử -> NHẬN "${String(mem.address).slice(0, 60)}" (qua rào địa danh), KHÔNG xin lại.`);
        updateConversationState(conversationId, mem);
        // KHÔNG return: chảy tiếp xuống dưới — đủ cả sđt thì luật chốt tự chạy, thiếu sđt thì nhánh dưới xin đúng sđt.
      }
      // KHÁCH "ship về đấy" nhưng hệ thống KHÔNG có địa chỉ -> XIN LẠI 1 lần; vẫn không có -> NGƯỜI THẬT.
      if (!mem.address) {
        if (mem._reaskedAddr) {
          await sendInboxMessage(conversationId, "Dạ chị ơi, em chưa đọc được địa chỉ của mình, em nhờ bạn phụ trách hỗ trợ chị lên đơn ngay nha ạ.");
          await tagChoXuLyVaUnread(conversationId); mem.botHandoffAt = Date.now();
          console.log(`[${BOT_NAME}] "ship về đấy" nhưng VẪN không có địa chỉ sau khi đã xin -> ĐẨY NGƯỜI THẬT.`);
          mem.lastBotReply = "[human-no-addr]";
          updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        mem._reaskedAddr = true;
        const reply = "Dạ chị ơi, cho em xin lại địa chỉ với ạ.";
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] "ship về đấy"/địa chỉ cũ nhưng hệ thống CHƯA có địa chỉ -> XIN LẠI (lần 1).`);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // Có địa chỉ nhưng thiếu SĐT -> xin nốt 1 LẦN; khách nói "đã gửi ở trên" mà VẪN không bắt được -> NGƯỜI THẬT (đừng cãi tay đôi).
      if (mem._reaskedPhone) {
        await sendInboxMessage(conversationId, "Dạ chị ơi, em chưa đọc được số điện thoại của mình, em nhờ bạn phụ trách hỗ trợ chị lên đơn ngay nha ạ.");
        await tagChoXuLyVaUnread(conversationId); mem.botHandoffAt = Date.now();
        console.log(`[${BOT_NAME}] Khách nói SĐT "đã gửi ở trên" nhưng VẪN không bắt được sau khi đã xin -> ĐẨY NGƯỜI THẬT.`);
        mem.lastBotReply = "[human-no-phone]";
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      mem._reaskedPhone = true;
      const reply = "Dạ chị cho em xin số điện thoại để em lên đơn gửi về địa chỉ cho mình nha ạ.";
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] "ship về đấy" -> có địa chỉ, thiếu SĐT -> xin SĐT (lần 1).`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH XIN "TƯ VẤN" VỀ MẪU ĐANG XEM (CHỈ khi KHÔNG có ảnh lượt này) -> BÁO GIÁ + 3 ẢNH =====
    // Có ảnh -> đã được luồng "gửi ảnh -> báo giá" ở trên xử lý; ở đây chỉ lo trường hợp tư vấn bằng CHỮ.
    if (wantsConsult(latestText) && productInfo && imageCount === 0 && !looksLikeQuestion(latestText)
        && !customerGaveContact(latestText) && !asksSimilarModels(latestText) && !asksAdviceAmongShown(latestText)) {
      // CHỐNG BÁO GIÁ 2 LẦN: mẫu này ĐÃ báo giá trong hội thoại (vd cổng AD vừa báo giá + gửi ảnh ngay trước)
      // -> KHÔNG báo lại / KHÔNG gửi lại 3 ảnh. Im lặng (đã trả ở lượt trước).
      if (quotedRecently(mem, String(productInfo.code || "").toUpperCase())) {
        console.log(`[${BOT_NAME}] Khách xin "tư vấn" nhưng mẫu ${productInfo.code} ĐÃ báo giá lượt trước -> KHÔNG báo lại (chống trùng).`);
        markProcessed(batch); return true;
      }
      const label = productLabel(productInfo);
      const pl = productInfo.priceText && String(productInfo.priceText).trim();
      const reply = pl
        ? `Dạ ${label} ${pl} ạ. Mẫu này phom lên rất xinh và tôn dáng, được nhiều khách bên em chọn lắm chị nha`
        : `Dạ ${label} mặc lên rất xinh và tôn dáng, được nhiều khách bên em chọn lắm chị nha`;
      await sendInboxMessage(conversationId, reply);
      await maybeSendImages(conversationId, productInfo.code, mem, true);   // 3 ảnh
      console.log(`[${BOT_NAME}] Khách xin "tư vấn" -> báo giá + 3 ảnh (mẫu ${productInfo.code}).`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH MUỐN THAM KHẢO THÊM / CHƯA QUYẾT -> LÙI NHẸ, thuyết phục mềm, (tuỳ) gửi 3 ảnh KHÁC =====
    // KHÔNG gặng chốt, KHÔNG hỏi màu, KHÔNG vớt đơn. Đúng tinh thần: khách hỏi/được gì thì xử nấy, không ép hành động.
    if ((_aiOr(wantsToBrowseMore(latestText), "SIMILAR_MODELS") || _ai("DEFER_DECISION")) && !customerGaveContact(latestText) && !looksLikeQuestion(latestText)) {
      mem.pendingColorConfirm = null;   // huỷ mọi gặng hỏi màu đang treo
      mem.pendingUpsell = [];           // huỷ vớt đơn đang treo
      mem.orderClosed = false;
      const p = productInfo || (mem.quotedProducts || [])[0];
      let sentExtra = false;
      if (p && p.code && !recommend.isOutOfStock(p)) {
        const code = String(p.code).toUpperCase();
        // gửi 3 ảnh KHÁC với mấy ảnh đã gửi: nhớ "đã gửi tới đâu" theo từng mã (mặc định bỏ 3 ảnh đầu lúc báo giá).
        mem.browseImgShown = mem.browseImgShown || {};
        const shown = mem.browseImgShown[code] || 3;
        const color = chosenColorForCode(mem, p) || mem.lastSentImageColor || mem.askedImageColor || "";
        let items = imageItemsByColor(code, color || null, shown + 3, /*colorFallback*/ true);
        let win = items.slice(shown, shown + 3);
        if (!win.length) { items = imageItemsByColor(code, null, shown + 3, true); win = items.slice(shown, shown + 3); }
        const urls = win.map(i => i.url).filter(Boolean);
        const cids = win.map(i => i.contentId).filter(Boolean);
        if (urls.length || cids.length) {
          const sres = await sendImages3(conversationId, win.slice(0, 3));
          if (sres.ok) { sentExtra = true; mem.browseImgShown[code] = shown + (sres.n || urls.length || cids.length); }
        }
      }
      const reply = sentExtra
        ? "Dạ chị cứ tham khảo thêm giúp em nha ạ. Em gửi thêm vài hình để mình nhìn rõ hơn chất liệu và phom dáng nhé."
        : "Dạ chị cứ tham khảo thêm nha. Riêng mẫu này đang được khá nhiều khách bên em chọn vì phom lên rất xinh và tôn dáng ạ. Khi nào cần em tư vấn thêm chị cứ nhắn em nha.";
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách THAM KHẢO THÊM -> lùi nhẹ${sentExtra ? " + gửi 3 ảnh khác" : ""}, không gặng chốt/hỏi màu.`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== TRẢ LỜI XÁC NHẬN MÀU (bot vừa hỏi "lấy màu X nha?") =====
    // Khách "ừ/ok" -> chốt đúng màu vừa gợi ý; khách nêu màu khác -> đổi sang màu đó.
    if (mem.pendingColorConfirm && mem.pendingColorConfirm.code && !looksLikeQuestion(latestText)) {
      const pcc = mem.pendingColorConfirm;
      const namedColor = extractColor(latestText);
      let chosen = null;
      if (namedColor) chosen = namedColor;                                  // khách nêu màu cụ thể
      else if ((isAffirmation(latestText) || customerWantsToOrder(latestText, mem.lastIntent)) && pcc.color) chosen = pcc.color;  // "ừ/ok/vậy lấy cho c" -> đúng màu gợi ý
      if (chosen) {
        mem.orderColorByCode = Object.assign({}, mem.orderColorByCode || {}, { [pcc.code]: chosen });
        mem.orderColor = chosen;
        mem.pendingColorConfirm = null;
        console.log(`[${BOT_NAME}] Khách XÁC NHẬN màu "${chosen}" cho ${pcc.code} -> tiếp tục chốt.`);
        // KHÔNG return -> để luồng chốt chạy tiếp trong cùng lượt (đã đủ màu).
      } else if (/(không|ko|hong|hông|thôi|khác|đổi|chưa)/i.test(String(latestText || "").toLowerCase()) && !isAffirmation(latestText)) {
        mem.pendingColorConfirm = null;   // khách chưa quyết -> bỏ pending, để luồng thường xử lý
      }
    }

    // ===== MUA LẠI MẪU ĐÃ TỪNG CHỐT -> HỎI XÁC NHẬN (tránh lên đơn lặp do khách quên đã đặt) =====
    if (productInfo && !looksLikeQuestion(latestText)) {
      const _ocode = String(productInfo.code || "").toUpperCase();
      const _ord = mem.orderedByCode && mem.orderedByCode[_ocode];
      const _lt = String(latestText || "").toLowerCase();
      // CHỈ coi là "đặt lại" khi khách THỰC SỰ ra lệnh mua (động từ mua / "lấy thêm") — KHÔNG tính câu ậm ừ / khen vui.
      const _orderIntent = (customerWantsToOrder(latestText, mem.lastIntent)
          || /(lấy|mua|đặt|order|chốt)\s*(thêm|nữa|luôn|cái|chiếc|mẫu|màu|váy|đầm|set|bộ|cho)/i.test(_lt)
          || /(thêm|nữa)\s*(1 |một |2 |hai )?(cái|chiếc|mẫu|váy|đầm|bộ)/i.test(_lt))
        && !isBareAck(latestText) && !isPostOrderChitChat(latestText);
      if (mem.pendingRepeatConfirm === _ocode) {
        const _addMore = /(thêm|nữa|đặt thêm|lấy thêm|lấy nữa|mua thêm|2 cái|hai cái|cái nữa|chiếc nữa|lấy 2)/i.test(_lt) || isAffirmation(latestText);
        const _no = /(thôi|thui|ko|không|nhầm|quên|đặt rồi|có rồi|khỏi|nhầm rồi)/i.test(_lt);
        if (_no && !_addMore) {
          mem.pendingRepeatConfirm = null;
          const reply = "Dạ vâng, đơn của mình em vẫn giữ nguyên nha chị";
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] Mua lại ${_ocode}: khách nói KHÔNG lấy thêm -> giữ đơn cũ.`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        if (_addMore) {
          mem.pendingRepeatConfirm = null;
          mem.orderClosed = false;   // cho phép lên đơn MỚI
          mem.upsellAsked = true;    // không hỏi vớt
          console.log(`[${BOT_NAME}] Mua lại ${_ocode}: khách XÁC NHẬN lấy thêm -> cho lên đơn mới.`);
          // KHÔNG return -> rơi xuống cụm chốt để lên đơn.
        }
      } else if (_ord && _orderIntent) {
        const oldColor = _ord.color ? `màu ${String(_ord.color).toLowerCase()} ` : "";
        const oldSize = _ord.size && _ord.size !== "FREESIZE" ? `size ${_ord.size} ` : (_ord.size === "FREESIZE" ? "freesize " : "");
        const newColor = chosenColorForCode(mem, productInfo) || mem.lastSentImageColor || mem.askedImageColor || "";
        const newDiff = newColor && _ord.color && _foldKey(newColor) !== _foldKey(_ord.color);
        const tail = newDiff ? `giờ lấy thêm màu ${String(newColor).toLowerCase()} hả chị?` : `giờ lấy thêm ạ chị?`;
        const reply = `Dạ ${productLabel(productInfo)} em có lên đơn ${oldColor}${oldSize}cho mình rồi ạ, ${tail}`;
        mem.pendingRepeatConfirm = _ocode;
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Khách mua lại ${_ocode} (đã chốt ${_ord.color || "?"}/${_ord.size || "?"}) -> HỎI xác nhận, KHÔNG lên đơn lặp.`);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
    }

    // ===== KHÁCH CHỐT ĐÚNG CÁC MẪU HỌ GỬI ("lên đơn 2 mẫu chị gửi", "chốt 2 mẫu này") =====
    // -> Chốt cụm khách gửi (dùng màu đã bắt từ ảnh khách gửi), BỎ mẫu vớt, KHÔNG hỏi màu/vớt lung tung nữa.
    if (confirmsSentModels(latestText) && !looksLikeQuestion(latestText)
        && (productInfo || (mem.quotedProducts && mem.quotedProducts.length))) {
      // bỏ mẫu VỚT đang chờ khỏi cụm
      const upsellCodes = new Set((mem.pendingUpsell || []).map(c => String(c).toUpperCase()));
      if (upsellCodes.size && Array.isArray(mem.quotedProducts) && mem.quotedProducts.length) {
        const kept = mem.quotedProducts.filter(p => !upsellCodes.has(String((p && p.code) || "").toUpperCase()));
        if (kept.length) { mem.quotedProducts = kept; quotedProducts = kept; }
      }
      mem.pendingUpsell = []; mem.upsellAsked = true;
      const _pi = productInfo || (mem.quotedProducts || [])[0];
      const needSize = orderNeedsSize(mem, _pi);
      const fullInfo = (!needSize || mem.customerSize) && mem.phone && addrReady(mem);
      let reply;
      if (mem.orderClosed) {
        reply = `Dạ vâng em chốt đơn cho mình nha ạ`;
      } else if (fullInfo) {
        reply = buildOrderConfirmation(mem, _pi); await sendOrderCreatingWithImages(conversationId, mem, _pi); mem.orderClosed = true; mem.everOrdered = true; await tagAiChot(conversationId);
      } else {
        reply = buildOrderInvite(mem, _pi);   // thiếu size/sđt/địa chỉ -> xin nốt, KHÔNG hỏi màu lung tung
      }
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách CHỐT mẫu họ gửi -> ${mem.orderClosed ? "đã chốt" : (fullInfo ? "chốt đơn" : "xin info thiếu")} cụm ${(mem.quotedProducts || []).length} mẫu, bỏ ${upsellCodes.size} mẫu vớt.`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== GÁC MÀU: mẫu NHIỀU màu, khách muốn CHỐT nhưng CHƯA chốt màu =====
    // QUY TẮC: cả hội thoại chỉ bám 1 MÀU (ảnh đã gửi / màu ad / ảnh khách) -> MẶC ĐỊNH chốt màu đó, KHÔNG hỏi.
    // CHỈ hỏi "lấy màu nào" + GỬI ẢNH ĐỦ MÀU khi khách quan tâm >=2 màu (hỏi màu khác) hoặc chưa rõ màu nào.
    if (productInfo && !looksLikeQuestion(latestText)
        && !(mem.pendingColorConfirm && mem.pendingColorConfirm.code)
        && needsColorConfirm(mem, productInfo)) {
      const wantsClose = isAffirmation(latestText)
        || customerWantsToOrder(latestText, mem.lastIntent)
        || customerGaveContact(latestText);
      if (wantsClose) {
        const _cc = String(productInfo.code || "").toUpperCase();
        const _colors = modelColorList(productInfo);
        const _focus = mem.askedImageColor || mem.lastSentImageColor
                    || (mem.sourceColorByCode || {})[_cc] || (mem.colorByCode || {})[_cc] || null;
        const _focusCanon = _focus ? (_colors.find(c => colorMatches(c, _focus) || colorMatches(_focus, c)) || null) : null;
        if (asksOtherColors(latestText)) mem.multiColorInterest = _cc;   // khách hỏi màu khác cho ĐÚNG mẫu này
        const _multiInterest = mem.multiColorInterest === _cc;
        if (_focusCanon && !_multiInterest) {
          // 1 MÀU xuyên suốt -> mặc định khách chốt màu đó. KHÔNG hỏi -> rơi xuống luồng chốt với màu đã set.
          mem.orderColorByCode = mem.orderColorByCode || {};
          mem.orderColorByCode[_cc] = String(_focusCanon).toLowerCase();
          console.log(`[${BOT_NAME}] Mẫu ${_cc} nhiều màu nhưng hội thoại bám 1 màu (${_focusCanon}) -> MẶC ĐỊNH chốt màu đó, KHÔNG hỏi màu.`);
        } else {
          // CHƯA rõ màu / khách quan tâm >=2 màu -> GỬI ẢNH ĐỦ MÀU (mỗi màu 1 tấm) rồi HỎI lấy màu nào.
          try {
            const _items = [];
            for (const c of _colors.slice(0, 3)) {
              const im = (imageItemsByColor(_cc, c, 1, false) || [])[0];
              if (im) _items.push(im);
            }
            if (_items.length) { await sendImages3(conversationId, _items, null); console.log(`[${BOT_NAME}] Hỏi màu -> gửi kèm ${_items.length} ảnh đủ màu cho ${_cc}.`); }
          } catch (_) {}
          const ask = colorConfirmAsk(mem, productInfo);   // set mem.pendingColorConfirm
          await sendInboxMessage(conversationId, ask);
          console.log(`[${BOT_NAME}] Mẫu ${productInfo.code} nhiều màu, khách quan tâm >=2 màu/chưa rõ màu -> hỏi xác nhận màu (kèm ảnh đủ màu).`);
          mem.lastBotReply = ask;
          updateConversationState(conversationId, mem);
          markProcessed(batch);
          return true;
        }
      }
    }

    // ===== VỚT ĐƠN (multi-mẫu): khách hỏi sâu 1 mẫu rồi chốt -> CHỐT mẫu đó + HỎI vớt mẫu còn lại =====
    {
      const declineUpsell = wantsOnlyOneModel(latestText)
        || /^(thôi|thui|ko|không|khỏi)\b|chỉ (mẫu|cái|con) này|mỗi (mẫu|cái|con) này|lấy (mẫu|cái|con) này thôi/i.test(String(latestText || "").toLowerCase())
        || confirmsSentModels(latestText);   // "lên đơn 2 mẫu chị gửi" = chỉ chốt mẫu khách gửi, từ chối vớt
      const agreeUpsell = isAffirmation(latestText) || wantsAllModels(latestText)
        || /(lấy|lên đơn) (luôn|hết|cả|thêm)|(ừ|ok|oke|vâng|đồng ý).{0,12}(lấy|lên)/i.test(String(latestText || "").toLowerCase());

      // (4a) ĐÃ HỎI VỚT trước đó (pendingUpsell) -> xử lý câu trả lời.
      if (mem.pendingUpsell && mem.pendingUpsell.length && !looksLikeQuestion(latestText)) {
        // CHỈ coi "ok/ừ" là ĐỒNG Ý VỚT khi câu BOT VỪA GỬI đúng là CÂU HỎI VỚT.
        // Nếu bot vừa MỜI/CHỐT 1 MẪU cụ thể ("Em lên đơn Set Corine...") thì "ok" = chốt MẪU ĐÓ, KHÔNG gộp mẫu cũ.
        const lastWasUpsellAsk = /muốn lấy luôn|lấy luôn[^?]*nữa không|lấy thêm[^?]*không|lấy luôn[^?]*không/i.test(mem.lastBotReply || "");
        if (!lastWasUpsellAsk) {
          mem.pendingUpsell = [];   // câu hỏi vớt đã cũ/không còn hiệu lực -> bỏ, chốt 1 mẫu đang focus
          console.log(`[${BOT_NAME}] "ok" nhưng câu trước KHÔNG phải hỏi vớt -> bỏ pendingUpsell, chốt 1 mẫu.`);
        } else if (agreeUpsell && !declineUpsell) {
          // Gộp các mẫu vớt vào cụm rồi để handler chốt lên đủ đơn.
          const byCode = new Map((mem.sessionProducts || []).map(p => [p.code, p]));
          const adds = mem.pendingUpsell.map(c => byCode.get(c)).filter(Boolean);
          mem.quotedProducts = dedupByCode([...(mem.quotedProducts || []), ...adds]);
          quotedProducts = mem.quotedProducts;
          mem.pendingUpsell = [];
          mem.upsellAsked = true;
          console.log(`[${BOT_NAME}] Khách ĐỒNG Ý vớt -> gộp ${adds.length} mẫu, chốt tất cả (${mem.quotedProducts.length} mẫu).`);
          // KHÔNG return -> rơi xuống handler chốt đơn để lên đủ đơn.
        } else if (declineUpsell) {
          // Bỏ mẫu VỚT khỏi cụm để chốt ĐÚNG các mẫu khách đang giữ (mẫu khách gửi), không kéo mẫu vớt vào bullet.
          const upsellCodes = new Set((mem.pendingUpsell || []).map(c => String(c).toUpperCase()));
          mem.pendingUpsell = [];
          mem.upsellAsked = true;
          if (upsellCodes.size && Array.isArray(mem.quotedProducts) && mem.quotedProducts.length) {
            const kept = mem.quotedProducts.filter(p => !upsellCodes.has(String((p && p.code) || "").toUpperCase()));
            if (kept.length) { mem.quotedProducts = kept; quotedProducts = kept; if (!productInfo) productInfo = kept[0]; }
          }
          if (!wantsOnlyOneModel(latestText)) {
            // chốt/mời gọn cụm khách đang giữ (1 hoặc nhiều mẫu khách gửi) — KHÔNG kéo mẫu vớt.
            const needSize = orderNeedsSize(mem, productInfo);
            const fullInfo = (!needSize || mem.customerSize) && mem.phone && addrReady(mem);
            let reply;
            if (fullInfo && !mem.orderClosed) { reply = buildOrderConfirmation(mem, productInfo); await sendOrderCreatingWithImages(conversationId, mem, productInfo); mem.orderClosed = true; mem.everOrdered = true; await tagAiChot(conversationId); }
            else reply = buildOrderInvite(mem, productInfo);
            await sendInboxMessage(conversationId, reply);
            console.log(`[${BOT_NAME}] Khách TỪ CHỐI vớt -> chốt cụm khách gửi (${(mem.quotedProducts || []).length} mẫu), bỏ ${upsellCodes.size} mẫu vớt (${fullInfo ? "chốt" : "mời"}).`);
            mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
          }
          // wantsOnlyOneModel -> để handler "chỉ lấy 1 mẫu" bên dưới chọn đúng mẫu khách nêu.
          console.log(`[${BOT_NAME}] Khách từ chối vớt + chỉ lấy 1 mẫu -> handler dưới xử lý.`);
        }
      }

      // (3) CHƯA hỏi vớt, khách order 1 mẫu, còn mẫu khác đã tư vấn trong phiên -> HỎI VỚT (chưa chốt vội).
      if ((!mem.pendingUpsell || !mem.pendingUpsell.length) && productInfo) {
        const orderIntent = isAffirmation(latestText) || customerWantsToOrder(latestText, mem.lastIntent);
        const singleFocus = (mem.quotedProducts || []).length <= 1;
        const others = (await sellableSessionModels(mem, productInfo.code)).slice().sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 3);
        if (orderIntent && singleFocus && others.length > 0 && !mem.upsellAsked
            && !looksLikeQuestion(latestText) && !wantsAllModels(latestText) && !wantsOnlyOneModel(latestText)) {
          const otherNames = joinVi(others.map(p => productLabel(p)).filter(Boolean));
          const reply = `Dạ em lên đơn ${productWithSizeLabel(mem, productInfo)} ạ. Chị có muốn lấy luôn ${otherNames} nữa không ạ`;
          mem.pendingUpsell = others.map(p => p.code);
          mem.upsellAsked = true;
          mem.orderClosed = false;
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] Khách order 1 mẫu (${productInfo.code}) -> HỎI VỚT ${others.length} mẫu còn lại, CHƯA chốt.`);
          mem.lastBotReply = reply;
          updateConversationState(conversationId, mem);
          markProcessed(batch);
          return true;
        }
      }
    }

    // ===== KHÁCH TỪ CHỐI VỚT ĐƠN / CHỈ LẤY 1 MẪU ("lấy 1 thui", "chỉ lấy Myda", "ko lấy mẫu kia") =====
    // -> CO về đúng 1 mẫu, KHÔNG hỏi vớt nữa (dù trước đã hỏi hay chưa). Chốt/mời gọn 1 lần.
    if (wantsOnlyOneModel(latestText) && !looksLikeQuestion(latestText)
        && (productInfo || (mem.quotedProducts && mem.quotedProducts.length))) {
      // Mẫu giữ lại: mẫu khách vừa nêu (nếu có) -> nếu không thì focus hiện tại.
      const keep = (thisTurn.length === 1) ? thisTurn[0] : (productInfo || (mem.quotedProducts || [])[0]);
      if (keep) {
        productInfo = keep;
        mem.currentProduct = keep;
        quotedProducts = [keep];
        mem.quotedProducts = [keep];
      }
      mem.pendingUpsell = [];
      mem.upsellAsked = true;   // đã chốt 1 mẫu -> KHÔNG bao giờ hỏi vớt nữa trong phiên này
      const needSize = orderNeedsSize(mem, productInfo);
      const fullInfo = (!needSize || mem.customerSize) && mem.phone && addrReady(mem);
      let reply;
      if (fullInfo && !mem.orderClosed) {
        reply = buildOrderConfirmation(mem, productInfo);
        await sendOrderCreatingWithImages(conversationId, mem, productInfo);   // tin "đang tạo" + ảnh đúng màu TRƯỚC câu cảm ơn
        mem.orderClosed = true; mem.everOrdered = true;
        await tagAiChot(conversationId);
      } else if (mem.orderClosed) {
        reply = `Dạ vâng em chốt ${productWithSizeLabel(mem, productInfo)} cho mình nha ạ`;
      } else {
        reply = buildOrderInvite(mem, productInfo);
      }
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách CHỈ lấy 1 mẫu (${productInfo && productInfo.code}) -> chốt gọn, KHÔNG hỏi vớt.`);
      mem.lastBotReply = reply;
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // ===== KHÁCH VỪA CHO ĐỦ SĐT + ĐỊA CHỈ (sau khi được mời/hỏi) -> CHỐT BULLET LUÔN, KHÔNG hỏi lại =====
    {
      const botAskedOrInvited = /lên đơn|chốt đơn|em lên đơn|xin số điện thoại|xin sđt|xin địa chỉ|cho em xin/i.test(String(mem.lastBotReply || ""));
      const nProdC = (mem.quotedProducts && mem.quotedProducts.length) || (productInfo ? 1 : 0);
      const needSizeC = orderNeedsSize(mem, productInfo);
      if (customerGaveContact(latestText) && botAskedOrInvited && (!needSizeC || mem.customerSize) && mem.phone && addrReady(mem)
          && nProdC >= 1 && !looksLikeQuestion(latestText) && !mem.orderClosed) {
        const reply = await sendOrderClose(conversationId, mem, productInfo);
        mem.orderClosed = true;
        await tagAiChot(conversationId);
        console.log(`[${BOT_NAME}] Khách cho đủ SĐT+địa chỉ -> CHỐT ĐƠN (cú pháp đầy đủ), không hỏi lại.`);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
    }

    // ===== BOT VỪA MỜI LÊN ĐƠN + KHÁCH ĐỒNG Ý ("ok e", "lên đơn đi") -> CHỐT NGAY (hoặc xin info thiếu) =====
    //   Tránh lặp lại câu mời. Chỉ kích hoạt khi tin TRƯỚC của bot là câu mời lên đơn.
    {
      const botProposedOrder = /lên đơn|chốt đơn|lên đơn .* cho (chị|mình)|em lên đơn/i.test(String(mem.lastBotReply || ""));
      const alreadyClosed = mem.orderClosed && !customerGaveContact(latestText);
      if (botProposedOrder && isAffirmation(latestText) && !looksLikeQuestion(latestText)
          && !isQualityHesitation(latestText) && !alreadyClosed) {
        const fullInfo = (!orderNeedsSize(mem, productInfo) || mem.customerSize) && mem.phone && addrReady(mem);
        // Đơn giao TỈNH KHÁC địa chỉ cũ -> xin lại địa chỉ mới. NHƯNG nếu khách VỪA đưa địa chỉ
        // hoặc đơn ĐÃ CHỐT (đã có địa chỉ xác nhận) -> KHÔNG đòi lại, dùng địa chỉ đang có.
        if (mem.shipProvince && mem.address && !addressMatchesShipProvince(mem.address, mem.shipProvince)
            && !mem._addrJustGiven && !(_wasOrderClosed || mem.orderClosed)) {
          const reply = "Dạ đơn này mình giao về khu vực khác so với địa chỉ cũ ạ, chị cho em xin lại địa chỉ nhận hàng cụ thể (số nhà, đường, phường/xã, tỉnh/thành) để em lên đơn cho chính xác nha";
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] Khách đồng ý nhưng giao TỈNH KHÁC (${mem.shipProvince}) -> xin địa chỉ mới.`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        if (fullInfo) {
          const reply = await sendOrderClose(conversationId, mem, productInfo);
          await tagAiChot(conversationId);
          console.log(`[${BOT_NAME}] Khách ĐỒNG Ý sau câu mời -> CHỐT ĐƠN (cú pháp đầy đủ) + thẻ AI chốt.`);
          mem.orderClosed = true;
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        } else {
          const missing = [];
          if (orderNeedsSize(mem, productInfo) && !mem.customerSize) missing.push("size");
          if (!mem.phone) missing.push("số điện thoại");
          if (!mem.address) missing.push("địa chỉ nhận hàng");
          const reply = `Dạ chị cho em xin ${missing.join(" và ")} để em lên đơn cho mình nha ạ`;
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] Khách đồng ý nhưng còn thiếu (${missing.join(", ")}) -> xin info, KHÔNG lặp câu mời.`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
      }
    }

    // CA 3 (§9): KHÁCH CHỐT ĐƠN THƯỜNG (không gấp) mà ĐÃ ĐỦ size + SĐT + địa chỉ
    //   -> câu MỜI CHỐT NGẮN GỌN (địa chỉ cũ) + gắn thẻ "AI chốt" (182) để NV lên đơn POS.
    //   KHÔNG gắn ĐƠN ƯU TIÊN (185) và KHÔNG chặn bot: ca gấp/hẹn ngày đã được handler 185 lo ở trên.
    {
      const isNegUng = /(không|ko|hong|hông|chưa|chẳng)\s*ưng/i.test(latestText); // tránh "không ưng"
      const fullInfo = (!orderNeedsSize(mem, productInfo) || mem.customerSize) && mem.phone && addrReady(mem);
      const nProd = (mem.quotedProducts && mem.quotedProducts.length) || (productInfo ? 1 : 0);
      // CHỐT ĐƠN chỉ khi khách nói RÕ Ý CHỐT trong CHÍNH tin này (không tin vào intent cũ),
      // VÀ tin đó KHÔNG phải câu hỏi. Hỏi gì (màu/size/giá/cân nặng/ảnh...) thì PHẢI trả lời câu hỏi trước.
      const explicitOrder =
        /(?<![\p{L}\p{N}])(chốt|lấy|đặt|order|ưng|lấy luôn|chốt luôn)(?![\p{L}\p{N}])/iu.test(latestText) ||
        /lên đơn|ok lấy|ok lên|đồng ý lên|gửi hàng đi|ship đi/i.test(latestText) ||
        isShipOrder(latestText);
      const isQuestion =
        looksLikeQuestion(latestText) ||
        /\?|(có|còn)\s.{0,14}(không|ko|hong|hông|chưa)|bao nhiêu|mấy (màu|size|kg|cân|cái|mẫu)|thế nào|như nào|ra sao|màu gì|màu nào|size gì|size nào|chất liệu|gì (không|ko|ạ|vậy|thế|nhỉ)|được không|được ko|sao ạ|đâu ạ|ở đâu|khi nào|bao lâu|mặc vừa/i.test(latestText);
      const justImages = wantsImages(latestText);   // chỉ chặn khi khách XIN xem ảnh, KHÔNG chặn "lấy mẫu này" kèm ảnh
      const hesitating = isQualityHesitation(latestText); // khách còn lăn tăn -> KHÔNG chốt
      if (explicitOrder && !isNegUng && !isQuestion && !justImages && !hesitating && fullInfo && nProd >= 1 && !_wasOrderClosed) {
        // Đơn này giao về TỈNH KHÁC với địa chỉ đang lưu -> XIN lại địa chỉ mới. NHƯNG nếu khách VỪA đưa địa chỉ
        // hoặc đơn ĐÃ CHỐT -> KHÔNG đòi lại, dùng địa chỉ đang có (tránh lặp câu ngớ ngẩn).
        if (mem.shipProvince && mem.address && !addressMatchesShipProvince(mem.address, mem.shipProvince)
            && !mem._addrJustGiven && !(_wasOrderClosed || mem.orderClosed)) {
          const reply = "Dạ đơn này mình giao về khu vực khác so với địa chỉ cũ ạ, chị cho em xin lại địa chỉ nhận hàng cụ thể (số nhà, đường, phường/xã, tỉnh/thành) để em lên đơn cho chính xác nha";
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] Chốt nhưng giao TỈNH KHÁC (${mem.shipProvince}) ≠ địa chỉ lưu -> XIN địa chỉ mới (không dùng địa chỉ cũ, không bịa).`);
          mem.lastBotReply = reply;
          updateConversationState(conversationId, mem);
          markProcessed(batch);
          return true;
        }
        // KHÁCH VỪA CHỌN MẪU -> MỜI CHỐT NGẮN GỌN (không mô tả dài, chưa gửi phom đầy đủ).
        // Khi khách "ok" ở lượt sau -> handler đồng-ý sẽ gửi PHOM XÁC NHẬN đầy đủ.
        mem.orderClosed = false;   // đơn MỚI đang mời -> mở lại để "ok" lượt sau chốt được
        // VỚT ĐƠN: CHỈ hỏi MỘT LẦN trong phiên (mem.upsellAsked). Khách chốt CHUNG CHUNG (không "cả 2/hết",
        // không "lấy 1 thui") -> mời mẫu đang quan tâm + hỏi vớt vài mẫu gần nhất. Đã hỏi rồi thì THÔI.
        const othersAll = await sellableSessionModels(mem, productInfo && productInfo.code);
        // Giới hạn 3 mẫu gần nhất cho gọn (đừng liệt kê cả chục mẫu).
        const others = othersAll.slice().sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 3);
        const singleFocus = (mem.quotedProducts || []).length <= 1;
        let reply;
        if (singleFocus && others.length > 0 && !wantsAllModels(latestText) && !mem.upsellAsked) {
          const otherNames = joinVi(others.map(p => productLabel(p)).filter(Boolean));
          reply = buildOrderInvite(mem, productInfo).replace(/( cho mình nha ạ)$/, "")
            + `. Chị có muốn lấy luôn mẫu ${otherNames} nữa không ạ`;
          mem.pendingUpsell = others.map(p => p.code);
          mem.upsellAsked = true;   // đã hỏi vớt -> KHÔNG hỏi lại trong phiên
        } else {
          reply = buildOrderInvite(mem, productInfo);
        }
        await sendInboxMessage(conversationId, reply);
        await tagAiChot(conversationId);   // thẻ "AI chốt" (182) để NV nắm, KHÔNG chặn bot
        console.log(`[${BOT_NAME}] Khách chọn mẫu -> MỜI CHỐT NGẮN${others.length ? " + vớt " + others.length + " mẫu" : ""} (chờ "ok"). (${nProd} mẫu)`);
        mem.lastBotReply = reply;
        updateConversationState(conversationId, mem);
        markProcessed(batch);
        return true;
      }
      // KHÁCH CÓ Ý CHỐT nhưng CHƯA ĐỦ thông tin -> xin info còn thiếu GỌN GÀNG (nêu rõ mẫu), không để AI viết lủng củng.
      if (explicitOrder && !isNegUng && !isQuestion && !justImages && !hesitating && !fullInfo && nProd >= 1) {
        const names = joinVi((mem.quotedProducts || []).map(p => p && p.name ? productLabel(p) : "").filter(Boolean)) || "mẫu này";
        const missing = [];
        if (orderNeedsSize(mem, productInfo) && !mem.customerSize) missing.push("size");
        if (!mem.phone) missing.push("số điện thoại");
        if (!mem.address) missing.push("địa chỉ nhận hàng");
        const reply = `Dạ em lên đơn ${names} cho chị nha. Chị cho em xin ${joinVi(missing)} để em lên đơn cho mình nha ạ`;
        await sendInboxMessage(conversationId, reply);
        mem.orderClosed = false;
        console.log(`[${BOT_NAME}] Khách chốt (${nProd} mẫu) thiếu (${missing.join(", ")}) -> xin info gọn, nêu rõ mẫu.`);
        mem.lastBotReply = reply;
        updateConversationState(conversationId, mem);
        markProcessed(batch);
        return true;
      }
    }

    // ===== KHÁCH VỪA CUNG CẤP ĐỊA CHỈ (mem._addrJustGiven) -> xác nhận/chốt, KHÔNG để rơi xuống AI -> người thật =====
    // Bắt ở đây (sát trước AI) nên MỌI handler đơn ở trên vẫn được ưu tiên; chỉ khi địa chỉ rơi tới đây mới đỡ.
    if (mem._addrJustGiven && (productInfo || (mem.quotedProducts && mem.quotedProducts.length))) {
      if (mem.address && isGarbageAddress(mem.address)) { mem.address = null; }   // xoá địa chỉ rác tồn đọng
      const _fullInfo = (!orderNeedsSize(mem, productInfo) || mem.customerSize) && mem.phone && addrReady(mem);
      if (_fullInfo && !mem.orderClosed) {
        const reply = await sendOrderClose(conversationId, mem, productInfo);
        await tagAiChot(conversationId);
        mem.orderClosed = true;
        console.log(`[${BOT_NAME}] Khách vừa cho ĐỊA CHỈ + đủ info -> CHỐT ĐƠN (không đẩy người).`);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      const _missing = [];
      if (orderNeedsSize(mem, productInfo) && !mem.customerSize) _missing.push("size");
      if (!mem.phone) _missing.push("số điện thoại");
      if (!addrReady(mem)) _missing.push("địa chỉ cụ thể (số nhà, đường, phường/xã)");
      const reply = _missing.length
        ? `Dạ em nhận được địa chỉ của chị rồi ạ. Chị cho em xin thêm ${_missing.join(" và ")} để em lên đơn cho mình nha`
        : `Dạ em gửi về địa chỉ ${cleanAddress(mem.address)} cho mình nha chị?`;
      await sendInboxMessage(conversationId, reply);
      console.log(`[${BOT_NAME}] Khách vừa cho ĐỊA CHỈ (chưa đủ info / chưa có ý chốt) -> xác nhận + xin nốt, KHÔNG đẩy người.`);
      mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
    }

    // ===== KHÁCH ĐỒNG Ý ("ok/oki/đồng ý/chốt/lấy") -> CODE dẫn tiếp theo TRẠNG THÁI hội thoại =====
    // (A) Code viết câu nên KHÔNG bị reply_guard chặn "lên đơn". Đặt sát trước AI -> mọi handler
    //     size/địa chỉ/thuộc tính ở trên vẫn được ưu tiên. Phân biệt "ok lúc mở / thân / kết" bằng
    //     TRẠNG THÁI (đã có mẫu? có size? có sđt+địa chỉ?), KHÔNG bằng chữ "ok".
    if (saysAgree(latestText) && !_multiAttrQ && !mem.orderClosed
        && !extractStatedSize(latestText) && !parseWeightKg(latestText)
        && !isAngryOrSensitive(latestText) && !isSensitiveHandoff(latestText)) {
      const _hasModel = !!(productInfo || (mem.pricedCodes && mem.pricedCodes.length)
        || (mem.quotedProducts && mem.quotedProducts.length));
      if (_hasModel) {
        let reply;
        if (orderNeedsSize(mem, productInfo) && !mem.customerSize) {
          // ĐÃ có mẫu, CHƯA có size (ok lúc THÂN) -> hỏi size (freesize -> hỏi cao/nặng)
          const a = productInfo ? parseAvailableSizes(productInfo.size) : null;
          const isFree = a && a.size === 1 && a.has("FREESIZE");
          reply = isFree
            ? "Dạ mẫu này là freesize, chị cho em xin chiều cao và cân nặng để em tư vấn cho mình nha ạ."
            : "Dạ chị thường mặc size nào để em tư vấn cho mình nha ạ.";
        } else if (mem.phone && mem.address) {
          // ĐỦ size + sđt + địa chỉ (ok lúc KẾT) -> xác nhận lên đơn địa chỉ cũ (đơn thật do người/auto-order)
          reply = `Dạ em lên đơn${noiNhanAddr(mem)} cho mình nhe ạ.`;
        } else {
          // Có size, THIẾU liên hệ (ok lúc KẾT) -> xin sđt + địa chỉ
          reply = "Chị ưng sản phẩm gửi em xin số điện thoại và địa chỉ em lên đơn cho mình nha?";
        }
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Khách ĐỒNG Ý ("${String(latestText).slice(0, 16)}") -> dẫn theo trạng thái (size=${mem.customerSize || "-"} phone=${!!mem.phone} addr=${!!mem.address}).`);
        mem.lastBotReply = reply; scheduleFollowup(conversationId, mem, productInfo, reply);
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // CHƯA có mẫu (ok lúc MỞ) -> không tự chế, để AI/handler khác lo (đừng bịa).
    }

    // 1 MẪU / câu hỏi thường -> AI trả về {reply, action}
    let { reply, action } = await reasoning({
      conversation: buildConversationForAi(data.messages),
      product: productInfo || null,
      state: {
        intent: mem.lastIntent,
        customerName: data.customerName,
        quotedProducts,
        memory: { size: mem.customerSize || null, phone: mem.phone || null, address: mem.address || null }
      }
    });

    // ===== CODE GÁC CỔNG ACTION =====
    // (a) Bắt CỨNG từ cáu giận / đòi gặp người thật -> ép TAG_HUMAN (không phụ thuộc AI)
    if (isAngryOrSensitive(latestText)) {
      action = "TAG_HUMAN";
      if (!reply || !reply.trim()) reply = "Dạ em rất xin lỗi vì để chị chưa hài lòng ạ, em sẽ hỗ trợ mình ngay nha ạ.";
    }

    // (a2) CHỐNG TAG NHẦM khi khách GỬI ẢNH đã nhận ra mẫu: khách VỪA GỬI ẢNH + có mẫu + không nhạy cảm -> NONE để AI tư vấn.
    //      (CHỈ áp khi khách thật sự GỬI ẢNH lượt này — hỏi bằng CHỮ mà AI muốn nhường người thì TÔN TRỌNG, không ép trả lời.)
    if (action === "TAG_HUMAN" && productInfo && imageCount > 0 && !isAngryOrSensitive(latestText) && !isSensitiveHandoff(latestText)) {
      console.log(`AI đòi TAG_HUMAN nhưng khách VỪA đưa mẫu (${productInfo.code}) & không nhạy cảm -> để AI tư vấn (NONE).`);
      action = "NONE";
      reply = openerOrLead(productInfo, mem);   // lưới an toàn: đã báo giá -> dẫn dắt, KHÔNG lặp giá
    }

    // (a3) KHÁCH XIN XEM ẢNH THẬT/ảnh thực tế mẫu đang tư vấn -> GỬI ẢNH luôn (mình CÓ ảnh), KHÔNG chờ.
    if ((_aiOr(wantsImages(latestText), "IMAGE_REQ")) && productInfo && !isAngryOrSensitive(latestText) && !isSensitiveHandoff(latestText)) {
      if (action === "TAG_HUMAN") {
        action = "NONE";
        reply = `Dạ em gửi chị xem ảnh ${productLabel(productInfo)} nhe ạ.`;
      }
      askImages = true;
    }

    // (a3b) CÂU CHÀO HỎI chung ("alo shop", "shop ơi"...) mà ĐANG CÓ MẪU khoá -> trả CÂU MẪU
    //       (nhắc mẫu + giá + hỏi size). Là câu cố định nên KHÔNG vi phạm "không tự chế".
    let _greetScripted = false;
    if (action === "NONE" && !askImages && productInfo
        && isGreetingPing(latestText)
        && !isAngryOrSensitive(latestText) && !isSensitiveHandoff(latestText)) {
      reply = openerOrLead(productInfo, mem);
      _greetScripted = true;
      console.log(`Câu CHÀO HỎI + có mẫu (${productInfo.code}) -> trả câu mẫu (${quotedRecently(mem, String(productInfo.code||"").toUpperCase()) ? "đã báo giá -> dẫn dắt" : "nhắc giá + hỏi size"}), KHÔNG đẩy người.`);
    }

    // (a3c) KHÁCH GỬI ẢNH đã nhận ra mẫu + HỎI GIÁ mẫu đó (mẫu CHƯA báo giá) -> BÁO GIÁ scripted, KHÔNG đẩy người.
    //       (Ca Phuong Pham: gửi ảnh -> đổi sang mẫu mới (switch), hỏi "giá tnao?" mà code không báo giá -> rớt cổng "no script".)
    if (!_greetScripted && productInfo && imageCount > 0
        && priceAsk
        && !quotedRecently(mem, String(productInfo.code || "").toUpperCase())
        && !isAngryOrSensitive(latestText) && !isSensitiveHandoff(latestText)) {
      action = "NONE";
      reply = openerOrLead(productInfo, mem);   // mẫu chưa báo giá -> ra GIÁ + hỏi size
      _greetScripted = true;                     // câu CỐ ĐỊNH -> bỏ qua cổng "AI tự chế" (8600)
      console.log(`Khách gửi ẢNH ra mẫu (${productInfo.code}) + hỏi giá (chưa báo) -> BÁO GIÁ scripted, KHÔNG đẩy người.`);
    }

    // (a3c1) [TOKEN-FREE AD] Khách HỎI GIÁ 1 cái váy/đầm/áo... mà CHƯA ra mẫu + ad_ids CHƯA tải (tin tới qua
    //   WEBHOOK -> data.fromAd=false). Trước đây rớt xuống (a3c2) -> hỏi "nhắn tên mẫu" (vì hasModelNameToken
    //   nhầm "giá/váy"), KHÔNG kịp chờ ad_ids để VISION ẢNH bài ad. -> HOÃN 1 NHỊP (clearProcessing, KHÔNG
    //   markProcessed): nhịp poll sau lấy conv từ LIST (CÓ ad_ids) -> fromAd=true -> khối ADS đọc caption + VISION
    //   ẢNH ad (KHÔNG cần token FB) -> ra mẫu, báo giá đúng. Hoãn TỐI ĐA 1 lần; nhịp sau vẫn không có ad -> rơi
    //   xuống (a3c2)/gallery như cũ. KHÔNG áp khi: đã có mẫu/ảnh, comment, người thật, đơn đã chốt, câu nhạy cảm.
    if (action !== "ORDER_CLOSE" && !askImages && !_greetScripted && !productInfo && !mem.currentProduct
        && imageCount === 0 && !data.fromAd && !mem.orderClosed && !mem._adReferentDeferred
        && !isCommentOrigin && !humanInbox && !mem._postOrderThread
        && !isAngryOrSensitive(latestText) && !isSensitiveHandoff(latestText)
        && (priceAsk || /(giá|gia|bao nhiêu|bn|báo giá|nhiêu)\b/i.test(String(latestText || "")))
        && /(váy|vay|đầm|dam|áo|ao|set|bộ|bo|mẫu|mau|cái|cai|con|chiếc|chiec|này|nay|đó|do|kia|nớ|no)\b/i.test(String(latestText || ""))) {
      mem._adReferentDeferred = true;
      updateConversationState(conversationId, mem);
      clearProcessing(batch);   // KHÔNG markProcessed -> nhịp poll sau lấy từ LIST (có ad_ids) -> đọc/vision ảnh bài ad
      console.log(`[${BOT_NAME}] "${String(latestText || "").slice(0, 35)}" hỏi giá 1 mẫu + chưa ra mẫu + ad_ids chưa tải (webhook) -> HOÃN 1 nhịp đợi ad_ids để VISION ẢNH bài ad (không cần token). Conv: ${conversationId}`);
      return false;
    }

    // (a3c2) KHÁCH GÕ TÊN 1 MẪU CỤ THỂ (chữ) nhưng khớp NGUYÊN VĂN trượt (gõ sai/thiếu chữ: "Alisse"~"Galisse").
    //   Lỗi Mai Thanh Lê: "Giá của thiết kế Alisse là bao nhiêu?" -> productInfo=null -> code dội 10 mẫu MỚI
    //   thay vì BÁO GIÁ. -> Thử KHỚP GẦN ĐÚNG: trúng 1 mẫu -> báo giá mẫu đó; nêu tên mà KHÔNG ra (kể cả gần
    //   đúng) -> HỎI LẠI tên/ảnh (KHÔNG dội gallery ngẫu nhiên). KHÔNG áp khi đến từ ad / đã có đơn / đang nhạy cảm.
    if (!askImages && !_greetScripted && !productInfo && !data.fromAd && imageCount === 0
        && !mem._postOrderThread && !mem.orderClosed
        && !isAngryOrSensitive(latestText) && !isSensitiveHandoff(latestText)
        && hasModelNameToken(latestText)) {
      try {
        const _fz = await fuzzyFindModel(latestText);
        if (_fz && _fz.product) {
          const reply = buildCommentOpener(_fz.product, mem);   // "Dạ <mẫu> giá ... ạ." + hỏi size
          mem.currentProduct = String(_fz.product.code || "").toUpperCase();   // nhớ mẫu để follow-up bám đúng
          await sendInboxMessage(conversationId, reply);
          console.log(`[${BOT_NAME}] Khách gõ tên mẫu "~${_fz.token}" -> KHỚP GẦN ĐÚNG ${_fz.product.code} (${_fz.product.name}, lệch ${_fz.dist}) -> BÁO GIÁ, KHÔNG dội gallery.`);
          mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        const reply = "Dạ chị nhắn giúp em tên mẫu (hoặc gửi ảnh mẫu chị đang xem) để em báo giá chính xác cho mình nha ạ.";
        await sendInboxMessage(conversationId, reply);
        console.log(`[${BOT_NAME}] Khách nêu TÊN MẪU nhưng KHÔNG khớp catalog (kể cả gần đúng) -> hỏi lại tên/ảnh, KHÔNG dội gallery.`);
        mem.lastBotReply = reply; updateConversationState(conversationId, mem); markProcessed(batch); return true;
      } catch (e) { console.log("[fuzzy model] lỗi:", e.message); }
    }

    // [FIX Nguyet Tran — HOÃN đợi ad_ids để ĐỌC ẢNH/TÊN bài ad] Tin tới qua WEBHOOK thì ad_ids thường CHƯA kịp
    //   gắn -> data.fromAd=false -> bot BỎ LUÔN bước tải bài ad + vision ảnh ad. Khách "váy NÀY bao nhiêu" (chỉ
    //   vào 1 mẫu) mà chưa ra mẫu -> HOÃN 1 NHỊP (KHÔNG markProcessed): nhịp poll sau lấy conv từ LIST (CÓ ad_ids)
    //   sẽ chạy đọc bài ad + nhận diện ẢNH ad + khớp TÊN (fuzzy) -> RA mẫu, báo giá đúng. Hoãn TỐI ĐA 1 lần;
    //   nếu nhịp sau VẪN không có ad_ids/không ra mẫu -> rơi xuống khối GIAO NGƯỜI THẬT bên dưới.
    if (action !== "ORDER_CLOSE" && !askImages && !_greetScripted && !productInfo && !mem.currentProduct
        && imageCount === 0 && !data.fromAd && !mem.orderClosed && !mem._adReferentDeferred
        && !hasModelNameToken(latestText)
        && /(này|nay|đó|do|kia|nớ|no)\b/i.test(String(latestText || ""))
        && /(giá|gia|bao nhiêu|bn|báo giá|nhiêu)\b/i.test(String(latestText || ""))
        && /(váy|vay|đầm|dam|áo|ao|set|bộ|bo|mẫu|mau|cái|cai|con|chiếc|chiec)\b/i.test(String(latestText || ""))) {
      mem._adReferentDeferred = true;
      updateConversationState(conversationId, mem);
      clearProcessing(batch);   // KHÔNG markProcessed -> nhịp poll sau lấy từ LIST (có ad_ids) -> đọc bài ad + vision ảnh ad
      console.log(`[${BOT_NAME}] "${String(latestText || "").slice(0, 30)}" chỉ 1 mẫu cụ thể + chưa ra mẫu + ad_ids chưa tải (webhook) -> HOÃN 1 nhịp đợi ad_ids để ĐỌC ẢNH/TÊN bài ad. Conv: ${conversationId}`);
      return false;
    }

    // [FIX Nguyet Tran + SỬA 2026-07-07] Khách hỏi giá 1 MẪU CỤ THỂ ("váy NÀY/đó/kia bao nhiêu") nhưng bot
    //   CHƯA resolve được mẫu (no_detect: KHÔNG ảnh, KHÔNG tên mẫu).
    //   - Hội thoại CÓ ad (_adId có / khách bấm ad mà không đọc được creative) -> khách đang nhìn 1 mẫu CỤ THỂ
    //     của ad: dội 10 mẫu MỚI là gây loạn -> GIAO NGƯỜI THẬT (AI-CHỜ XL), IM (giữ như cũ).
    //   - KHÔNG có ad thật (ads=[] sau khi đã hoãn chờ) + không ảnh -> người thật vào CŨNG không biết "này"
    //     là mẫu nào, đằng nào cũng phải hỏi lại khách -> bot chủ động: XIN ẢNH mẫu khách đang xem + gửi
    //     GALLERY MẪU MỚI để vớt (1 lần/hội thoại). Gửi gallery fail -> rơi về giao người thật như cũ.
    if (action !== "ORDER_CLOSE" && !askImages && !_greetScripted && !productInfo && !mem.currentProduct
        && imageCount === 0 && !data.fromAd && !mem.orderClosed && !hasModelNameToken(latestText)
        && /(này|nay|đó|do|kia|nớ|no)\b/i.test(String(latestText || ""))
        && /(giá|gia|bao nhiêu|bn|báo giá|nhiêu)\b/i.test(String(latestText || ""))
        && /(váy|vay|đầm|dam|áo|ao|set|bộ|bo|mẫu|mau|cái|cai|con|chiếc|chiec|này|nay)\b/i.test(String(latestText || ""))) {
      try {
        if (!_adId && !mem.newGallerySent) {
          // KHÔNG có ad thật -> xin ảnh + dội gallery mẫu MỚI (vớt khách thay vì im chờ người).
          const _gLead = "Dạ chị đang xem mẫu nào chị gửi giúp em ảnh (hoặc chụp màn hình bài viết) để em báo giá chính xác cho mình nha ạ. Trong lúc đó em gửi chị mấy mẫu mới nhất bên em tham khảo thêm nè:";
          await sendInboxMessage(conversationId, _gLead);
          let _gOk = false;
          try { _gOk = await sendGetStartedGallery(conversationId, mem); } catch (_) {}
          if (_gOk) {
            mem.newGallerySent = true;
            console.log(`[${BOT_NAME}] "váy này bao nhiêu" + KHÔNG ad thật + không ảnh -> XIN ẢNH + GỬI GALLERY mẫu MỚI (thay vì giao người thật). Conv: ${conversationId}`);
            mem.lastBotReply = _gLead; updateConversationState(conversationId, mem); markProcessed(batch); return true;
          }
          console.log(`[${BOT_NAME}] Gallery gửi KHÔNG được -> rơi về giao người thật.`);
        }
        await tagChoXuLyVaUnread(conversationId);
        console.log(`[${BOT_NAME}] Khách hỏi giá 1 MẪU CỤ THỂ ("${String(latestText || "").slice(0, 40)}") nhưng CHƯA resolve được mẫu (${_adId ? "có ad " + _adId + " nhưng không đọc được" : "gallery fail/đã gửi rồi"}) -> GIAO NGƯỜI THẬT (AI-CHỜ XL). Conv: ${conversationId}`);
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      } catch (e) { console.log("[handoff váy-này] lỗi:", e.message); }
    }

    // (a3d) MỞ ĐẦU TRỐNG ("Bắt đầu"/chào suông/"lb"/"ib"/"xem"/"tư vấn"/"giá") mà CHƯA có mẫu nào -> GỬI GALLERY 10 MẪU MỚI
    //       (cột T = "mới") để khách chọn. KHÔNG đẩy người (kể cả AI định TAG_HUMAN), KHÔNG chào suông. Chỉ 1 lần/hội thoại.
    if (!askImages && !_greetScripted && !productInfo && !mem.newGallerySent
        && !data.fromAd   // FIX: khách đến từ ADS (bấm 1 mẫu cụ thể) -> KHÔNG dội 10 mẫu MỚI ngẫu nhiên (gây loạn). Để rơi xuống xử lý ad/người thật.
        && !hasModelNameToken(latestText)   // FIX Mai Thanh Lê: câu NÊU TÊN MẪU đã xử ở (a3c2) -> KHÔNG dội gallery đè.
        && !isAngryOrSensitive(latestText) && !isSensitiveHandoff(latestText)
        && (/^(bắt đầu|bat dau|get started|started|menu|\/?start)\b/i.test(String(latestText || "").trim())
            || isGreetingPing(latestText) || isOpenerPing(latestText) || _isBlankPing(latestText)
            // Tin ĐẦU hỏi GIÁ / LOẠI chung chung mà CHƯA rõ mẫu (không ảnh) -> gửi gallery cho khách chọn,
            // thay vì nhường người. Vd Hà Lê: "Giá váy là bao nhiêu?" (không ảnh, không ad, không lock).
            // [FIX Tuyết Babie] khách hỏi giá chung chung mà CHƯA rõ mẫu (ko ad/ko mẫu/ko ảnh) -> gửi gallery.
            //   Dùng NHÃN AI priceAsk (PRICE_ASK) làm nguồn chính (bắt mọi cách gõ: "Xin gia a", "giá nhiêu"...),
            //   regex cứng chỉ là phụ (phòng khi AI tắt). Các chốt chặn ngoài (!productInfo/!fromAd/!newGallerySent) vẫn giữ.
            || (imageCount === 0 && !mem.currentProduct
                && (priceAsk
                    || /(^\s*(giá|gia|bao nhiêu|bn|báo giá|xem giá)|(giá|gia)\s*(váy|vay|đầm|dam|áo|ao|set|bộ|bo|mẫu|mau)|(váy|vay|đầm|dam|áo|ao|set|bộ)\s*(này|nay)?\s*(giá|gia|bao nhiêu|bn)|^\s*(váy|vay|đầm|dam|áo|ao|set|bộ|bo)\s+(giá|gia|bao nhiêu|bn))/i.test(String(latestText || "").trim()))))) {
      try {
        // [FIX vòng lặp HOÃN gallery — Lanh Nguyen "...."] Conv seen=false + khách nhắn cuối -> MỖI vòng poll
        //   re-xử lại "...." (cơ chế "khách đang chờ" bỏ qua "đã xử"), và cancelFollowup() đầu vòng GIẾT cái hẹn
        //   GS_GALLERY trước khi nó kịp chín -> đặt lại 22s mãi -> KẸT vô hạn (không bao giờ gửi, không thoát).
        //   SỬA: kiểm "tới hạn" NGAY tại đây (inline), KHÔNG phụ thuộc cái hẹn (dễ bị giết). Đã hẹn rồi:
        //   - quá 22s, khách vẫn không bấm ad/gửi mẫu -> GỬI gallery NGAY rồi thoát (bot thành người nhắn cuối
        //     -> hết "khách đang chờ" -> rớt khỏi vòng lặp).
        //   - chưa tới hạn -> CHỜ tiếp, KHÔNG đặt lại timer, nhường suất cho conv khác (return false).
        if (mem._gsDeferAt && !mem.newGallerySent) {
          if (Date.now() - mem._gsDeferAt >= 22000) {
            // [FIX Ly Nguyen 2026-07-07] Tới hạn 22s nhưng "đợi ad_ids" chỉ có nghĩa khi đã có LƯỢT ĐỌC
            //   TỪ LIST xác nhận: webhook không bao giờ mang ads (conversation.ads=null), còn LIST luôn trả
            //   MẢNG — rỗng [] nghĩa là "không có ad THẬT", có phần tử nghĩa là khách bấm ad. -> Chỉ được dội
            //   gallery khi (a) lượt này là LIST xác nhận ads rỗng, hoặc (b) đã quá 90s mà vẫn chưa có lượt
            //   LIST nào (van an toàn, không treo khách vô hạn). Chưa xác nhận -> nhường nhịp, KHÔNG đánh dấu
            //   tin đã xử, để nhịp poll LIST xử lại kèm ads -> cổng ads báo giá đúng mẫu.
            const _gsAdsVerified = (typeof conversation !== "undefined") && conversation && Array.isArray(conversation.ads);
            if (!data.fromAd && !_adId && !_gsAdsVerified && (Date.now() - mem._gsDeferAt) < 90000) {
              updateConversationState(conversationId, mem);
              console.log(`[${BOT_NAME}] [Bắt đầu] tới hạn 22s nhưng lượt này là WEBHOOK (ads chưa được LIST xác nhận) -> nhường nhịp, đợi LIST kiểm tra ad trước khi dội gallery. Conv: ${conversationId}`);
              return false;
            }
            let _sentGs = false;
            try { _sentGs = await sendGetStartedGallery(conversationId, mem); } catch (_) {}
            mem._gsDeferAt = null; if (_sentGs) mem.newGallerySent = true;
            updateConversationState(conversationId, mem); markProcessed(batch);
            console.log(`[${BOT_NAME}] [Bắt đầu] tới hạn 22s (inline, thoát vòng lặp) -> ${_sentGs ? "GỬI gallery 10 mẫu" : "KHÔNG gửi được (thôi)"}. Conv: ${conversationId}`);
            return true;
          }
          return false;   // chưa tới hạn -> chờ, KHÔNG đặt lại timer (tránh reset vô hạn)
        }

        //   Nếu dội gallery NGAY -> khách thấy 10 mẫu lạ ĐÈ lên ảnh mình vừa gửi (khách bực: "có ảnh rồi sao
        //   gửi mẫu mới"). -> HOÃN 1 nhịp: tin khách còn "tươi" (<9s) + CHƯA hoãn lần nào -> bỏ lượt này
        //   (clearProcessing, KHÔNG markProcessed) để nhịp poll sau gom đủ ảnh. Có ảnh -> báo giá đúng mẫu;
        //   vẫn trống thật -> nhịp sau (_openerDeferred=true) mới dội gallery. Hoãn TỐI ĐA 1 lần (bounded).
        {
          const _turnCustAt = Math.max(0, ...batch.map(m => parseTime(m && m.insertedAt)).filter(n => n > 0));
          if (_turnCustAt > 0 && (Date.now() - _turnCustAt) < 9000 && !mem._openerDeferred) {
            mem._openerDeferred = true;
            updateConversationState(conversationId, mem);
            clearProcessing(batch);   // KHÔNG markProcessed -> nhịp sau xử lại với batch đầy đủ (gồm ảnh)
            console.log(`[${BOT_NAME}] Mở đầu trống + tin khách còn TƯƠI (<9s) -> HOÃN 1 nhịp gom thêm ảnh/tin trước khi dội gallery. Conv: ${conversationId}`);
            return false;
          }
        }
        const _cat = await ensureCatalog();
        const _news = (_cat.list || []).filter(p => p && p.isNew && !recommend.isOutOfStock(p));
        for (let i = _news.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [_news[i], _news[j]] = [_news[j], _news[i]]; }   // xáo trộn -> đỡ lặp 10 mẫu giống nhau
        // CHIẾN DỊCH: luôn ưu tiên MGKVX6310 ĐẦU gallery mẫu mới (kể cả khi không gắn cờ mẫu mới), nếu còn hàng.
        const _campCode = "MGKVX6310";
        const _camp = (_cat.list || []).find(p => String(p.code || "").toUpperCase().trim() === _campCode && !recommend.isOutOfStock(p));
        const _newsOrdered = _camp
          ? [_camp, ..._news.filter(p => String(p.code || "").toUpperCase().trim() !== _campCode)]
          : _news;
        const _gal = recommend.buildGallery(_newsOrdered, { maxModels: 10, withPrices: false });
        if (_gal) {
          // [v34] KHÔNG dội gallery NGAY: tin "mở đầu trống/hỏi giá chung" hay tới qua WEBHOOK lúc ad_ids CHƯA gắn
          //   (fromAd=false) -> nếu dội liền thì khách bấm AD (vd Giannal) bị nhận 10 mẫu thay vì BÁO GIÁ mẫu ad.
          //   -> HOÃN ~22s qua bộ hẹn (GS_GALLERY): nhịp poll sau lấy từ LIST (CÓ ad_ids) -> khối ADS đọc/vision ra
          //   mẫu -> báo giá; sweep thấy đã có mẫu -> HUỶ gallery. Vẫn trống thật -> hết hạn mới dội gallery.
          const GS_GALLERY_DELAY = 22000;
          pendingFollowups.set(String(conversationId), {
            at: Date.now(),
            custAt: lastCustomerMsgAt.get(String(conversationId)) || 0,
            delay: GS_GALLERY_DELAY, stage: 0, kind: "GS_GALLERY"
          });
          mem._gsDeferAt = Date.now();
          console.log(`[${BOT_NAME}] Mở đầu trống/hỏi giá chung -> HOÃN gallery ${GS_GALLERY_DELAY / 1000}s đợi ad_ids (khách bấm ad thì BÁO GIÁ mẫu, không dội 10 mẫu). Conv: ${conversationId}`);
          updateConversationState(conversationId, mem); markProcessed(batch); return true;
        }
        console.log(`[${BOT_NAME}] Mở đầu trống nhưng KHÔNG có mẫu MỚI (cột T) nào có ảnh -> đẩy người thật.`);
      } catch (e) { console.log("[gallery mới] lỗi:", e.message); }
    }

    // (a3.5) KHÁCH KHAI CHIỀU CAO KHIÊM TỐN (<=156cm) + đang khoá 1 mẫu -> TƯ VẤN trấn an form Việt + CTA.
    //   (vd khách 1m52 lo mặc không hợp so với người mẫu 1m62). Chỉ áp dụng chiều cao THẤP (<=156);
    //   cao hơn 156 -> KHÔNG tự tư vấn (để rơi xuống đẩy người thật, vì dáng cao tư vấn khác).
    if (action === "NONE" && !askImages && !_greetScripted
        && (_ai("WEIGHT_HEIGHT") || /\b1\s?m\s?\d|\bcao\b|\b1[.,]\d|\b15\d\s*c?m?\b/i.test(String(latestText || "")))
        && mem.currentProduct && !humanInbox) {
      // Trích chiều cao (cm) từ câu: "1m52" / "1m5" / "1.52" / "1,52" / "152" / "cao 152" / "152cm".
      const _ht = String(latestText || "").toLowerCase().replace(/\s+/g, " ");
      let _hcm = 0;
      let _m;
      if ((_m = _ht.match(/\b1\s?m\s?([0-9]{1,2})\b/))) {           // 1m52 / 1m5
        const d = _m[1]; _hcm = d.length === 1 ? 100 + parseInt(d, 10) * 10 : 100 + parseInt(d, 10);
      } else if ((_m = _ht.match(/\b1\s?[.,]\s?([0-9]{1,2})\b/))) { // 1.52 / 1,5
        const d = _m[1]; _hcm = d.length === 1 ? 100 + parseInt(d, 10) * 10 : 100 + parseInt(d, 10);
      } else if ((_m = _ht.match(/\b(1[0-9]{2})\s*c?m?\b/))) {      // 152 / 152cm
        _hcm = parseInt(_m[1], 10);
      }
      // Chỉ tư vấn khi trích được chiều cao THẤP hợp lệ: 130–156cm.
      if (_hcm >= 130 && _hcm <= 156) {
        const _hLabel = `1m${String(_hcm - 100).padStart(2, "0")}`;   // 152 -> "1m52"
        const _line = `Dạ các mẫu bên em thiết kế dành cho form phụ nữ Việt nên với chiều cao ${_hLabel} chị mặc freesize sẽ vừa đẹp, lên dáng xinh ạ. Chị ưng em lên đơn cho mình nha!`;
        await sendInboxMessage(conversationId, _line);
        mem.lastBotReply = _line;
        console.log(`[${BOT_NAME}] Khách khai chiều cao khiêm tốn (${_hcm}cm) -> tư vấn form Việt + CTA (freesize).`);
        try { scheduleFollowup(conversationId, mem, productInfo, _line); } catch (_) {}
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      // chiều cao >156 hoặc không trích được -> KHÔNG tự tư vấn, để rơi xuống đẩy người thật.
    }

    // (a4) AI TƯ VẤN CÂU KHÔNG ĐỤNG SỐ — có BỘ SOI (reply_guard) + 3 chế độ qua env AI_REPLY_MODE:
    //      - "off"    (mặc định): GIỮ NGUYÊN luật cũ -> AI tự chế = ĐẨY NGƯỜI THẬT. An toàn tuyệt đối.
    //      - "shadow" : VẪN đẩy người như cũ, NHƯNG IN LOG câu AI định nói + bộ soi PASS/BLOCK -> mày soi traffic thật.
    //      - "on"     : nếu bộ soi PASS (câu sạch, KHÔNG dính tiền/sđt/chốt-đơn/ship/tồn) -> CHO AI tư vấn;
    //                   BLOCK -> đẩy người. (Giá/đơn vẫn 100% do code ở các nhánh trên.)
    if (action === "NONE" && !askImages && !_greetScripted) {
      // CHỈ là lời CHÀO (GREETING) - KHÔNG phải câu hỏi cần trả -> KHÔNG đẩy người thật.
      // (Bot đã chào / đã BÁO GIÁ + ảnh + dẫn size ở nhánh trên nếu có; còn lại đứng yên,
      //  tránh gắn AI-CHỜ XL OAN cho tin chỉ là "Bắt đầu" / "hi" kèm ảnh mẫu — ca Thanh Stubborn.)
      if (_ai("GREETING")) {
        console.log(`[${BOT_NAME}] Chỉ là lời chào (GREETING), không có câu hỏi cần trả -> KHÔNG đẩy người thật.`);
        updateConversationState(conversationId, mem); markProcessed(batch); return true;
      }
      const _aiMode = (process.env.AI_REPLY_MODE || "off").toLowerCase();
      const _vet = vetAdvisoryReply(reply);
      if (_aiMode === "on" && _vet.allow && reply && String(reply).trim()
          && !isAngryOrSensitive(latestText) && !isSensitiveHandoff(latestText)
          && !saysBotMistake(latestText) && !asksShopComparison(latestText)
          // 👍 / ừ / ok / cảm ơn / chào / tán gẫu / "để chị xem" = KHÔNG có câu hỏi -> ĐỪNG để AI tự đẩy size/đẩy đơn.
          // (Khách thả 👍 sau khi "để chị xem" -> bot KHÔNG được chen "Chị mặc size bao nhiêu". Giống hệt off-mode.)
          && !isBareAck(latestText) && !isAffirmation(latestText) && !isFriendlyRemark(latestText)
          && !isPostOrderChitChat(latestText) && !_ai("THANKS") && !_ai("GREETING")
          // KHÁCH CHO SĐT/ĐỊA CHỈ / muốn CHỐT = việc đụng ĐƠN/TIỀN -> KHÔNG để AI tự soạn lời (dễ ra "size phù hợp",
          // "em lên đơn..." mà KHÔNG thực sự tạo đơn). Để CODE chốt; mất mẫu/size -> đẩy NGƯỜI THẬT chốt đúng.
          && !customerGaveContact(latestText) && !mem._addrJustGiven
          && !_ai("ADDRESS") && !_ai("PHONE") && !_ai("ORDER_CLOSE")) {
        console.log(`[AI-REPLY on] bộ soi PASS -> để AI tư vấn: "${String(reply).slice(0, 70)}"`);
        // KHÔNG ép TAG_HUMAN -> câu chảy xuống dây chuyền soi tiếp (7518+) rồi gửi.
      } else {
        if (_aiMode !== "off") {
          console.log(`[AI-REPLY ${_aiMode}] ${_vet.allow ? "PASS" : "BLOCK(" + _vet.reasons.join(",") + ")"} | AI định nói: "${String(reply || "").slice(0, 90)}" -> ${_aiMode === "shadow" ? "GIỮ đẩy người (shadow)" : "đẩy người"}`);
        } else {
          console.log(`[${BOT_NAME}] Câu CHƯA CÓ KỊCH BẢN DẠY (AI định tự trả lời) -> ĐẨY NGƯỜI THẬT, không tự ý chế.`);
        }
        action = "TAG_HUMAN"; reply = "";
      }
    }
    // (b) TAG_HUMAN: nhường người thật. CÓ câu riêng (vd cáu giận) -> nhắn; KHÔNG có (AI ko trả lời được) -> CHỈ gắn thẻ, KHÔNG nhắn "chờ đợi" (tránh nhàm).
    if (action === "TAG_HUMAN") {
      if (reply && reply.trim()) {
        await sendInboxMessage(conversationId, reply);
        mem.lastBotReply = reply;
        console.log("ACTION=TAG_HUMAN -> gửi câu riêng + thẻ AI-CHỜ XL, nhường người thật.");
      } else {
        console.log("ACTION=TAG_HUMAN -> CHỈ gắn thẻ AI-CHỜ XL (AI không trả lời được), KHÔNG nhắn khách.");
      }
      await tagChoXuLyVaUnread(conversationId);
      mem.botHandoffAt = Date.now();
      updateConversationState(conversationId, mem);
      markProcessed(batch);
      return true;
    }

    // (c) SEND_IMAGES: AI đề nghị -> code GÁC CỔNG. Chỉ bật cờ gửi ảnh khi ĐÃ rõ mẫu;
    //     việc gửi đúng mẫu/màu, không trùng, tối đa 3 ảnh do maybeSendImages() lo.
    if (action === "SEND_IMAGES" && productInfo) askImages = true;

    if (!reply || !String(reply).trim()) {
      console.log("AI không trả lời.");
      markProcessed(batch);
      updateConversationState(conversationId, mem);
      return true;
    }

    reply = stripImageLinks(reply);
    if (isAskingSizeAdvice(latestText)) reply = stripAutoSizePick(reply);
    reply = enforceSize(reply, mem.customerSize, productInfo);   // LUÔN ép/khử size theo bảng size mẫu
    // Khách KHÔNG hỏi về co giãn -> cắt cụm "không co giãn" (đừng tự nói điểm trừ)
    if (!asksStretch(latestText)) reply = stripNoStretch(reply);
    reply = stripFillerClose(reply);   // bỏ câu filler "Chị xem giúp em mẫu này nhe ạ"...
    {
      const beforeStock = reply;
      reply = stripOutOfStock(reply);   // bot KHÔNG tự tuyên bố hết hàng
      if (reply !== beforeStock) {
        console.log(`[${BOT_NAME}] Đã cắt câu 'hết hàng' do AI tự bịa (bot không quản tồn kho).`);
        if (!reply || reply.length < 3) {
          // Nếu cả câu chỉ là tuyên bố hết hàng -> thay bằng câu an toàn, KHÔNG từ chối đơn.
          reply = productInfo && productInfo.name
            ? `Dạ ${productLabel(productInfo)} chị ưng thì em lên đơn cho mình nha ạ`
            : "Dạ chị ưng mẫu nào em lên đơn cho mình nha ạ";
        }
      }
    }

    // ===== Chống BÁO GIÁ LẶP: mẫu đã báo giá rồi & khách KHÔNG hỏi giá -> cắt câu giá =====
    {
      const code = String(productInfo?.code || "").toUpperCase();
      const alreadyPriced = code && mem.pricedCodes.includes(code);
      if (alreadyPriced && !priceAsk) {
        const before = reply;
        reply = stripPriceSentences(reply);
        if (reply !== before) console.log(`Đã cắt câu báo giá lặp cho mã ${code} (khách không hỏi giá).`);
      }
    }

    // ===== Chống xin SĐT/địa chỉ SỚM và LẶP =====
    const gaveContact = customerGaveContact(latestText);
    const wantsOrder = customerWantsToOrder(latestText, mem.lastIntent);
    const missingContact = !mem.phone || !mem.address;
    // Chỉ cho phép xin liên hệ khi: còn thiếu + khách có ý mua + (chưa xin ở lượt trước HOẶC khách vừa nói rõ muốn chốt)
    const allowContactAsk = missingContact && wantsOrder && (!mem.askedContact || mem.lastIntent === "ORDER_INTENT");
    if (!allowContactAsk && !gaveContact) {
      const before = reply;
      reply = stripContactRequest(reply);
      if (reply !== before) console.log("Đã cắt câu xin SĐT/địa chỉ (chưa tới bước chốt hoặc tránh lặp).");
    }
    // §5/§8: cắt câu hỏi chủ động "cần em hỗ trợ/tư vấn gì thêm không"
    {
      const before = reply;
      reply = stripProactiveFollowup(reply);
      if (reply !== before) console.log("Đã cắt câu 'cần em tư vấn/hỗ trợ thêm' (vi phạm §5/§8).");
    }
    if (!reply || !reply.trim()) {
      // §9: rơi vào rỗng -> KHÔNG dùng câu hỏi chủ động.
      // Câu hỏi CỤ THỂ (không phải hỏi giá, không phải ý chốt/đưa contact) mà KHÔNG handler nào trả được
      // -> KHÔNG bịa, KHÔNG báo giá: hẹn kiểm tra (câu này khớp isCheckLaterReply -> TỰ gắn AI-CHỜ XL).
      // Tín hiệu hỏi siết (tránh quirk "này" chứa "à" của looksLikeQuestion).
      const _emptyQ = /\?|\b(không|ko|hong|hông|chưa|hả)\b|gì\b|sao\b|thế nào|như nào|ra sao|bao lâu|ở đâu|khi nào|\bmấy\b|nhiêu/i.test(latestText);
      if (_emptyQ && !priceAsk
          && !customerWantsToOrder(latestText, mem.lastIntent) && !customerGaveContact(latestText)) {
        reply = "Dạ câu này chị chờ em kiểm tra lại rồi báo mình ngay nha ạ";
      } else if (productInfo && mem.noFitForCode === productInfo.code) {
        // Mẫu hiện tại đã xác định KHÔNG vừa -> đừng khen/đẩy mẫu đó, mời xem mẫu khác.
        reply = "Dạ chị xem thêm các mẫu khác bên em rồi nhắn em tư vấn giúp mình nha ạ.";
      } else {
        reply = productInfo && productInfo.name
          ? `Dạ ${productLabel(productInfo)} bên em rất nhiều khách thích đó chị ạ.`
          : "Dạ mẫu này bên em rất nhiều khách thích đó chị ạ.";
      }
    }
    mem.askedContact = replyAsksContact(reply);

    // Nếu reply có báo giá -> nhớ mã đã báo giá (lần sau không báo lại trừ khi khách hỏi)
    if (productInfo && productInfo.code) {
      const replyHasPrice = String(reply).split(/(?<=[.!?])\s+|\n+/).some(_isPriceSentence);
      if (replyHasPrice) {
        const k = String(productInfo.code).toUpperCase();
        markPriced(mem, k);
      }
    }

    mem.lastBotReply = reply;
    updateConversationState(conversationId, mem);

    reply = prettifyAddressList(reply);
    await sendInboxMessage(conversationId, reply);
    console.log("REPLY:", reply);

    // gửi ảnh: khách GỬI ẢNH 1 mẫu lượt này -> LUÔN kèm 3 ảnh (§13). Mẫu dò ra TỪ CHỮ/tin shop (khách KHÔNG gửi
    //  ảnh) + chỉ HỎI size/form/chất... -> KHÔNG gửi ảnh (trước đây dựa "đã gửi thì bỏ qua" nhưng sau RESTART mem
    //  mất -> gửi lại cả loạt ảnh vô nghĩa). Khách XIN xem ảnh -> nhánh askImages bên dưới lo.
    if (thisTurn.length === 1 && imageCount > 0) {
      await maybeSendImages(conversationId, thisTurn[0].code, mem, true);
    } else if (askImages && productInfo) {
      // không có mẫu mới nhưng khách xin xem ảnh mẫu đang tư vấn
      await maybeSendImages(conversationId, productInfo.code, mem, true);
    }

    updateConversationState(conversationId, mem);

    // Câu AI chỉ TRẢ LỜI (không có hành động) và không phải "chờ kiểm tra" -> hẹn nhắc hành động sau 60s.
    if (!isCheckLaterReply(reply)) scheduleFollowup(conversationId, mem, productInfo, reply);

    // 2 thẻ độc lập, dính cái nào gắn cái đó (có thể gắn cả 2)
    if (isCheckLaterReply(reply)) {                 // AI báo "chờ kiểm tra" -> thẻ AI - CHỜ XL (183)
      await tagChoXuLyVaUnread(conversationId);
      console.log("AI báo chờ -> gắn thẻ AI-CHỜ XL");
    }
    if (unresolved > 0 && imageCount >= 2) {        // gửi >=2 mẫu mà còn mẫu CHƯA nhận ra (thiếu giá) -> AI-CHỜ XL (người thật xử)
      await tagChoXuLyVaUnread(conversationId);
      mem.botHandoffAt = Date.now();
      console.log(`Có ${unresolved} mẫu chưa nhận ra (thiếu giá) -> gắn thẻ AI-CHỜ XL + chưa đọc`);
    }
    markProcessed(batch);
    return true;
  } catch (err) {
    console.log("Lỗi processOneConversation:", err.message);
    clearProcessing(batch);
    return false;
  }
}

// ===== CHỐNG SPAM KHI PANCAKE TỪ CHỐI (rate-limit / token / bảo trì) =====
// getConversations thất bại (429/lỗi mạng) -> KHÔNG nghỉ dài. Cứ thử lại NGAY ở nhịp poll kế tiếp
// (mỗi POLL_MS). Bot luôn sẵn sàng; Pancake hết bóp là chạy lại tức thì. Log thất bại throttle 30s/lần
// cho đỡ spam. Có data trở lại -> in "đã kết nối lại".
const POLL_MS = 4000;                 // nhịp poll 4s (cache nhẹ -> chỉ 1-2 request/nhịp, vẫn dưới giới hạn 5/s)
let convFailStreak = 0;
let nextPollAt = 0;
let _lastFailLog = 0;
// "Khách đang chờ" = tin CUỐI KHÔNG do admin/bot gửi (last_sent_by không có admin_name).
// Bot/API gửi -> admin_name="Public API"; NV gửi -> tên NV. Khách gửi -> không có admin_name.
// -> Khi khách nhắn cuối mà shop chưa trả lời thì coi là cần xử (dù seen=true do đã mở xem).
function khachDangCho(c) {
  return !(c && c.last_sent_by && c.last_sent_by.admin_name);
}
async function processOnce() {
  if (isRunning) return;
  if (Date.now() < nextPollAt) return;   // (giữ tương thích; hiện không set nghỉ dài nữa)
  isRunning = true;
  try {
    await sweepFollowups();   // gửi câu hành động cho hội thoại khách im >30s sau câu trả lời suông
    await sweepImageResends();   // #551 khách vắng -> hẹn gửi lại ảnh 10p/30p/1h (3 lần)
    const convData = await getConversations(1);
    if (!convData.success) {
      convFailStreak++;
      // [BACKOFF 500] Pancake bóp -> KHÔNG dập đều 4s nữa (càng dập càng bị bóp). Giãn dần: 8s,16s,30s (cap).
      //   Nhờ vậy throttle tự nhả, vòng kế lấy được danh sách MỚI -> đọc kịp tin mới.
      const _bo = Math.min(30000, POLL_MS * Math.pow(2, Math.min(convFailStreak, 3)));
      nextPollAt = Date.now() + _bo;
      if (Date.now() - _lastFailLog > 30000) {
        _lastFailLog = Date.now();
        console.log(`Pancake đang từ chối (429/lỗi) -> GIÃN nhịp ${Math.round(_bo / 1000)}s cho throttle nhả (đã ${convFailStreak} lần). Hết bóp là chạy ngay.`);
      }
      return;
    }
    if (convFailStreak > 0) { console.log("Đã kết nối lại Pancake OK."); convFailStreak = 0; }
    // Lọc: xử hội thoại CHƯA ĐỌC (seen=false) HOẶC khách là người nhắn CUỐI (đang chờ shop) + trong 24h.
    // -> Dù NV đã lỡ mở xem (seen=true) mà khách vẫn đang chờ thì bot VẪN xử, tránh bỏ sót.
    // Các lớp chặn "nhường người thật" (thẻ giữ / NV vừa nhắn / tin đã xử) nằm trong processOneConversation, vẫn nguyên.
    // [LIST_DEBUG] Soi 12 hội thoại MỚI NHẤT (thô, trước khi lọc) + LÝ DO bị loại.
    // Bật bằng:  set LIST_DEBUG=1   rồi  node bot_worker_api_v3.js
    if (process.env.LIST_DEBUG === "1") {
      const newest = (convData.conversations || [])
        .slice().sort((a, b) => parseTime(b.updated_at) - parseTime(a.updated_at)).slice(0, 12);
      console.log("===== [LIST_DEBUG] 12 hội thoại mới nhất (thô) =====");
      for (const c of newest) {
        const lsb = c.last_sent_by ? (c.last_sent_by.admin_name || "(rỗng)") : "(không có)";
        const passSeen = c.seen === false;
        const passWait = khachDangCho(c);
        const pass24h = Date.now() - parseTime(c.updated_at) <= 24 * 60 * 60 * 1000;
        const drop = (passSeen || passWait) ? (pass24h ? "GIỮ" : "LOẠI(quá 24h)") : "LOẠI(seen=true & shop nhắn cuối)";
        console.log(`  [${drop}] ${c.from && c.from.name} | seen=${c.seen} | last_sent_by=${lsb} | updated=${c.updated_at} | id=${c.id}`);
      }
      // DUMP NGUYÊN object 3 hội thoại mới nhất (HOẶC lọc theo tên: set LIST_DUMP_NAME=Phuong)
      // -> để xem CHÍNH XÁC các field thời gian (last_sent_at / inbox_at / snippet...) mà chọn điều kiện "cứu".
      const nameFilter = (process.env.LIST_DUMP_NAME || "").toLowerCase();
      const toDump = nameFilter
        ? newest.filter(c => String(c.from && c.from.name || "").toLowerCase().includes(nameFilter))
        : newest.slice(0, 3);
      for (const c of toDump) {
        console.log(`----- [LIST_DEBUG] RAW: ${c.from && c.from.name} (${c.id}) -----`);
        console.log(JSON.stringify(c, null, 1));
      }
      console.log("===================================================");
    }
    // [CHECK_NAMES] Soi nhanh vài nick cụ thể: có nằm trong N hội thoại lấy về không + bị lọc vì sao.
    // Bật:  set CHECK_NAMES=Cẩm Tú,Phuong Pham,Cẩm   rồi  node bot_worker_api_v3.js
    if (process.env.CHECK_NAMES) {
      const _all = convData.conversations || [];
      const wanted = process.env.CHECK_NAMES.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
      for (const w of wanted) {
        const hits = _all.filter(c => String((c.from && c.from.name) || "").toLowerCase().includes(w));
        if (!hits.length) {
          console.log(`[CHECK] "${w}": KHÔNG có trong ${_all.length} hội thoại lấy về -> KHÔNG được fetch (vấn đề phân trang/khác page).`);
          continue;
        }
        for (const c of hits) {
          const passWait = khachDangCho(c);
          const pass24h = Date.now() - parseTime(c.updated_at) <= 24 * 60 * 60 * 1000;
          const verdict = ((c.seen === false) || passWait) ? (pass24h ? "VÀO list" : "BỊ LỌC(quá 24h)") : "BỊ LỌC(seen=true & shop nhắn cuối)";
          const lsb = c.last_sent_by ? (c.last_sent_by.admin_name || "(rỗng)") : "(không có)";
          console.log(`[CHECK] "${w}": CÓ trong list | name=${c.from && c.from.name} | type=${c.type} | seen=${c.seen} | last_sent_by=${lsb} | updated=${c.updated_at} | -> ${verdict} | id=${c.id}`);
        }
      }
    }
    const fresh = (convData.conversations || [])
      .filter(c => c.seen === false || khachDangCho(c) || forceRecheckConvs.has(String(c.id)))
      // CHƯA ĐỌC + khách nhắn cuối = khách ĐANG CHỜ -> xử BẤT KỂ cũ/mới (tin nhắn trước khi bot bật vẫn phải trả).
      // Các conv khác (đã đọc, hoặc force-recheck) thì vẫn giới hạn 24h để khỏi quét vô hạn.
      .filter(c => (c.seen === false && khachDangCho(c)) || (Date.now() - parseTime(c.updated_at) <= 24 * 60 * 60 * 1000))
      // ƯU TIÊN [FIX bỏ đói tin cũ]: KHÁCH ĐANG CHỜ (chưa đọc + khách nhắn cuối, bot chưa trả) lên TRƯỚC,
      // và trong nhóm đó phục vụ AI CHỜ LÂU NHẤT trước (CŨ-trước/FIFO) -> cap 3-5/nhịp không bỏ sót tin cũ.
      // (Lỗi cũ: sort MỚI-trước + cap 3 -> tin mới (chạy ad) luôn ăn hết 3 suất, tin cũ dưới đáy không tới lượt.)
      .sort((a, b) => {
        const aw = (a.seen === false && khachDangCho(a)) ? 0 : 1;
        const bw = (b.seen === false && khachDangCho(b)) ? 0 : 1;
        if (aw !== bw) return aw - bw;                                       // khách đang chờ -> nhóm trước
        if (aw === 0) return parseTime(a.updated_at) - parseTime(b.updated_at);   // cùng đang chờ -> CŨ trước (không bỏ đói)
        return parseTime(b.updated_at) - parseTime(a.updated_at);                 // nhóm còn lại -> mới trước
      });

    // ===== [WEBHOOK] nhét conv_id Pancake vừa đẩy (real-time) vào hàng xử lý =====
    // Tin mới có thể CHƯA xuất hiện trong danh sách API (API trả bản cũ) -> webhook đưa thẳng conv_id.
    // Conv nào ĐÃ có trong list thì bỏ qua (sẽ xử bình thường). Conv CHƯA có -> dựng object tối thiểu,
    // đặt lên ĐẦU fresh để bot đọc tin theo id (luôn tươi) và trả ngay.
    try {
      const hookIds = await pullWebhookIds();
      if (hookIds.length) {
        const _haveIds = new Set((convData.conversations || []).map(c => String(c.id)));
        const _inFresh = new Set(fresh.map(c => String(c.id)));
        let _added = 0;
        for (const hid of hookIds) {
          if (_inFresh.has(hid)) continue;                 // đã nằm trong fresh -> thôi
          const existing = (convData.conversations || []).find(c => String(c.id) === hid);
          if (existing) {                                   // có trong list nhưng bị lọc -> ép xử lại
            forceRecheckConvs.add(hid);
            fresh.unshift(existing); _inFresh.add(hid); _added++;
          } else {                                          // KHÔNG có trong list -> dựng conv tối thiểu
            const pid = hid.includes("_") ? hid.split("_")[0] : PAGE_ID;
            fresh.unshift({
              id: hid, page_id: pid, type: "INBOX",
              seen: false, last_sent_by: null, tags: [],
              from: { name: "(webhook)" },
              updated_at: new Date().toISOString()
            });
            forceRecheckConvs.add(hid); _inFresh.add(hid); _added++;
          }
        }
        if (_added) console.log(`[WEBHOOK] +${_added} conv_id Pancake đẩy -> đưa lên đầu hàng xử lý: ${hookIds.join(", ")}`);
      }
    } catch (e) { console.log("[WEBHOOK] pull lỗi:", e.message); }

    // [HÀNG ĐỢI] in các conv SẼ được xử lý lượt này (để soi: Thanh Duy gửi tin -> có lọt vào đây không?).
    if (fresh.length > 0) {
      console.log(`[HÀNG ĐỢI] ${fresh.length} conv cần xử: ` +
        fresh.slice(0, 8).map(c => `${c.from && c.from.name}(seen=${c.seen})`).join(", ") +
        (fresh.length > 8 ? ` ...+${fresh.length - 8}` : ""));
    }

    // [LỌC RỚT] Tự động soi: hội thoại MỚI (90 phút gần đây) nhưng KHÔNG vào "Cần xử lý" -> in lý do.
    {
      const NOW = Date.now();
      const RECENT = 90 * 60 * 1000;
      const dropped = (convData.conversations || []).filter(c => {
        const tooOld = NOW - parseTime(c.updated_at) > RECENT;
        if (tooOld) return false;
        const inFresh = (c.seen === false || khachDangCho(c)) && (NOW - parseTime(c.updated_at) <= 24 * 60 * 60 * 1000);
        return !inFresh;
      });
      for (const c of dropped.slice(0, 15)) {
        const lsb = c.last_sent_by ? (c.last_sent_by.admin_name || "(rỗng)") : "(không có)";
        const over24 = NOW - parseTime(c.updated_at) > 24 * 60 * 60 * 1000;
        const why = over24 ? "quá 24h"
          : (c.seen !== false && !khachDangCho(c)) ? "seen=true & SHOP/bot nhắn cuối (list coi như đã trả)"
          : "khác";
        console.log(`  [LỌC RỚT] ${c.from && c.from.name} | type=${c.type} | seen=${c.seen} | last_sent_by=${lsb} | updated=${c.updated_at} | -> ${why} | id=${c.id}`);
      }
    }

    // [THEO DÕI] Soi kỹ nick/ID đang kẹt: tìm theo TÊN (BỎ DẤU, khớp dù có/không dấu) + theo ID cụ thể.
    // Đọc THỬ tin (throttle 60s/ID) để biết bot có lấy được tin khách không.
    // Đổi:  set WATCH_NAMES=a,b,c   và/hoặc  set WATCH_IDS=id1,id2
    {
      const NOW = Date.now();
      const stripVN = s => String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d").toLowerCase().trim();
      const watchNames = (process.env.WATCH_NAMES || "Phuong Pham,Pham Phuong,Tham Tran,Nguyen Thanh Nhu")
        .split(",").map(s => stripVN(s)).filter(Boolean);
      const watchIds = (process.env.WATCH_IDS || "1468690110033030_6394346307338466")
        .split(",").map(s => s.trim()).filter(Boolean);
      const allConv = convData.conversations || [];
      const picked = new Map();
      for (const w of watchNames) {
        const hits = allConv.filter(c => stripVN((c.from && c.from.name) || "").includes(w));
        if (!hits.length) console.log(`  [THEO DÕI] tên "${w}": KHÔNG có trong ${allConv.length} hội thoại lấy về.`);
        for (const c of hits) picked.set(String(c.id), c);
      }
      for (const id of watchIds) if (!picked.has(id)) picked.set(id, allConv.find(c => String(c.id) === id) || null);

      for (const [id, c] of picked) {
        if (c) {
          const lsb = c.last_sent_by ? (c.last_sent_by.admin_name || "(rỗng=khách nhắn cuối)") : "(không có)";
          const within24 = NOW - parseTime(c.updated_at) <= 24 * 60 * 60 * 1000;
          const inFresh = (c.seen === false || khachDangCho(c)) && within24;
          const why = inFresh ? "VÀO 'Cần xử lý'" : (!within24 ? "RỚT (quá 24h)" : "RỚT (seen=true & shop/bot nhắn cuối)");
          console.log(`  [THEO DÕI] ${c.from && c.from.name} | type=${c.type} | seen=${c.seen} | last_sent_by=${lsb} | updated=${c.updated_at} | -> ${why} | id=${id}`);
        } else {
          console.log(`  [THEO DÕI] id=${id}: KHÔNG có trong ${allConv.length} hội thoại lấy về (đọc tin trực tiếp bên dưới).`);
        }
        // ID theo dõi tường minh (WATCH_IDS): đọc MỖI VÒNG để luôn thấy giờ tin cuối. Tên dò trúng: throttle 60s.
        const isExplicitId = watchIds.includes(id);
        if (isExplicitId || NOW - (_watchReadAt.get(id) || 0) > 60000) {
          _watchReadAt.set(id, NOW);
          try {
            const raw = await getMessages(id);
            const norm = normalizeMessages((raw && raw.messages) || []);
            const ci = norm.filter(x => x.sender === "customer" && x.channel !== "COMMENT");
            const cc = norm.filter(x => x.sender === "customer" && x.channel === "COMMENT");
            const last = ci.slice(-2).map(x => `${x.type}:"${String(x.text||"").slice(0,40)}"`).join("  ");
            const lastT = ci.length ? ci[ci.length - 1].insertedAt : (cc.length ? cc[cc.length-1].insertedAt : "?");
            let kl;
            if (ci.length) kl = "❗ CÓ tin INBOX của khách -> BOT PHẢI TRẢ";
            else if (cc.length) kl = "khách CHỈ comment (trả qua bình luận)";
            else kl = "không có tin khách đọc được";
            console.log(`      [THEO DÕI/tin] ${id}: KHÁCH-inbox=${ci.length} | KHÁCH-comment=${cc.length} | tin cuối khách @${lastT} -> ${kl}${last ? " | " + last : ""}`);
          } catch (e) { console.log(`      [THEO DÕI/tin] ${id}: lỗi đọc - ${e.message}`); }
        }
      }
    }

    // Danh sách CHI TIẾT từng hội thoại "Cần xử lý" -> MẶC ĐỊNH TẮT (gây loạn theo dõi).
    // Bật lại khi cần soi:  set SHOW_QUEUE=1
    if (fresh.length > 0 && process.env.SHOW_QUEUE === "1") {
      console.log(`Cần xử lý (chưa đọc / khách chờ, 24h): ${fresh.length} | tổng gộp: ${(convData.conversations || []).length}`);
      for (const c of fresh) {
        const lsb = c.last_sent_by ? (c.last_sent_by.admin_name || "(rỗng)") : "-";
        console.log(`  -> type=${c.type} | from=${c.from && c.from.name} | last_sent_by=${lsb} | id=${c.id}`);
      }
    }
    // Xử NHIỀU khách/nhịp (không còn 1-khách-rồi-nghỉ): giải quyết hàng đợi nhanh.
    // Cap 5/nhịp + nghỉ nhẹ 400ms giữa 2 khách để không dồn request (vẫn dưới 5/s, tính riêng mỗi page).
    let _handled = 0;
    const MAX_PER_CYCLE = 5;
    for (const conv of fresh) {
      const handled = await turnLog.run({
        conversationId: conv.id,
        pageId: pageRegistry.pageIdFromConv(conv.id) || String(conv.id).split("_")[0],
        kenh: String(conv.type || "").toUpperCase().includes("COMMENT") ? "COMMENT" : "INBOX"
      }, () => processOneConversation(conv));
      if (handled) {
        _handled++;
        if (_handled >= MAX_PER_CYCLE) return;
        try { await delay(400); } catch (_) {}
      }
    }
  } catch (err) {
    console.log("Lỗi processOnce:", err.message);
  } finally {
    isRunning = false;
  }
}

async function main() {
  console.log("BOT API V3 RUNNING (gửi ảnh 1 lần + khóa size)...");
  // ===== [SỔ BÀI ADS 2026-07-07] Đồng bộ TOÀN BỘ ads của tài khoản QC -> map tự học, TRƯỚC khi khách bấm =====
  // Cấu hình: FB_ADS_ACCOUNT_IDS trong .env (vd: act_123,act_456) hoặc file fb_ads_accounts.json.
  // Chạy lúc khởi động + lặp 4 tiếng. Tên ad "MÃMẪU-postid-..." -> bóc mã có trong catalog -> ghi
  // ad_learned_map.json cho CẢ ad id lẫn bài creative (story_fbid khách bấm tra trúng ngay).
  async function _syncAdsBook() {
    try {
      const r = await fbAds.syncAdsMap();
      if (!r.ok) { console.log(`[ADS SYNC] bỏ qua: ${r.reason}`); return; }
      const _c = await ensureCatalog();
      let hit = 0;
      for (const ad of r.ads) {
        const toks = String(ad.name || "").toUpperCase().match(/[A-Z0-9]{6,}/g) || [];
        let code = null;
        for (const tk of toks) { if (_c.byCode.get(tk)) { code = tk; break; } }
        if (!code) continue;
        learnAdProduct([ad.adId, ad.storyId], code);
        hit++;
      }
      console.log(`[ADS SYNC] xong: ${r.ads.length} ads -> map được ${hit} ads có mã trong catalog (ads không mã: đặt tên chưa theo quy ước hoặc mẫu chưa vào sheet).`);
    } catch (e) { console.log(`[ADS SYNC] LỖI: ${(e && e.message) || e}`); }
  }
  setTimeout(_syncAdsBook, 20 * 1000);              // khởi động xong 20s thì chạy (đợi catalog nạp)
  setInterval(_syncAdsBook, 4 * 60 * 60 * 1000);    // lặp mỗi 4 tiếng (ad mới lên tự thuộc)
  console.log("[BUILD] v36 | ĐA-PAGE: 1 tiến trình lo nhiều page (suy page theo convId) | 2026-06-22");
  await pageRegistry.init();        // nạp danh sách page + token (account token / pages.json / env)
  await processOnce();
  setInterval(processOnce, POLL_MS);
}

main().catch(console.error);
