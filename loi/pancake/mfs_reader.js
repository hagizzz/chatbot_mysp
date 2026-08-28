// ============================================================================
// mfs_reader.js — ĐỌC HỘI THOẠI TỪ mfs, thay cho pancake_reader.js
// ----------------------------------------------------------------------------
// Xuất ĐÚNG 5 tên hàm và ĐÚNG hình dạng dữ liệu mà `pancake_reader.js` xuất,
// vì lõi bot (`bot_worker_api_v3.js`, 12.7k dòng) đọc thẳng các trường đó ở hàng
// trăm chỗ. Đổi hình dạng ở đây là phải sửa lõi — nên không đổi.
//
// Hình dạng phải giữ:
//   getConversations()      -> { success, total, conversations:[ {id, updated_at, ...} ] }
//   readConversation(id)    -> { conversationId, customerName, messages:[...], fromAd, adId, ... }
//   normalizeMessages(ds)   -> [ {type,sender,channel,adminName,text,imageUrl,insertedAt,messageId} ]
//   getMessages(id)         -> mảng tin thô của mfs
//   fetchConversationTags() -> mảng id thẻ, hoặc null nếu đọc không được
//
// KHÁC BIỆT SO VỚI PANCAKE — có thật, không giấu:
//   - Bình luận: mfs chỉ có hội thoại inbox và comment qua `type`; không có
//     khái niệm "trả lời riêng dưới bình luận" nên `privateReplyId` luôn null.
//   - Bài viết: mfs không đi lấy nội dung/ảnh bài Facebook, nên `postCaption`
//     và `postImages` rỗng. Nhánh bot đoán mẫu TỪ ẢNH BÀI VIẾT sẽ không chạy.
//   - Quảng cáo: `adId` đọc được (đã vá `findOne()` bên mfs để trả trường này),
//     nhưng TÊN và ẢNH quảng cáo thì mfs không lưu -> `adTitle`/`adPhotoUrl` rỗng.
// ============================================================================
const mfs = require("./mfs_client");

const GIOI_HAN_DS = Number(process.env.MFS_GIOI_HAN_DS || 100);
// Chỉ lấy hội thoại có tin mới trong ngần này giờ. Bot poll 4 giây một vòng;
// quét cả kho hội thoại mỗi vòng là tự chuốc tải cho Postgres mà không được gì.
const SO_GIO = Number(process.env.MFS_SO_GIO || 24);

/** Đổi một dòng hội thoại của mfs sang hình dạng mà lõi bot đang chờ. */
function _hoaHoiThoai(c) {
  return {
    id: c.id,
    // Lõi bot đọc `updated_at` để sắp và để so mốc thời gian
    updated_at: c.lastMessageAt,
    inserted_at: c.lastMessageAt,
    // Tên khách: mfs ưu tiên tên trong hồ sơ khách, không có thì tên Facebook
    from: { name: (c.contact && c.contact.displayName) || "UNKNOWN", id: c.contact && c.contact.id },
    customers: [{ name: (c.contact && c.contact.displayName) || "UNKNOWN" }],
    conv_from: { name: (c.contact && c.contact.displayName) || "UNKNOWN" },
    snippet: c.lastMessagePreview || "",
    type: c.type,
    // Lõi bot lọc theo thẻ trên ẢNH CHỤP danh sách đầu vòng poll -> phải có sẵn.
    //
    // PHẢI là ĐỐI TƯỢNG {id, name}, không phải mảng chuỗi id. Cổng chặn
    // `convHasHoldTag()` khớp thẻ giữ theo id SỐ hoặc theo TÊN; id của mfs là
    // UUID nên `Number(id)` ra NaN, khớp-theo-id trượt sạch. Chỉ còn đường
    // khớp-theo-tên, mà muốn khớp tên thì tên phải có mặt ở đây.
    //
    // Trả chuỗi id là bot KHÔNG BAO GIỜ thấy "còn thẻ giữ" -> mỗi vòng poll 4
    // giây nó xử lại cùng một hội thoại, gọi OpenAI lại từ đầu. Đã dính đúng
    // lỗi này: 12 vòng lặp trước khi phát hiện.
    tags: Array.isArray(c.tags) ? c.tags.map(t => ({ id: t.id, name: t.name })) : [],
    // Chưa đọc = có việc cho bot. mfs tách "đã đọc" khỏi "đã xử lý" (mục 6).
    seen: c.readStatus === "read",
    unread_count: c.readStatus === "unread" ? 1 : 0,
    handlingStatus: c.handlingStatus,
    source: c.source,
    page_id: c.channel && c.channel.id,
    _mfs: true
  };
}

/**
 * Danh sách hội thoại cần xử.
 *
 * Tham số `_ignored` giữ nguyên để lõi bot gọi y như cũ không phải sửa.
 */
let _daKiemThe = false;

async function getConversations(_ignored = 1) {
  // Kiểm thẻ ĐÚNG MỘT LẦN, ở vòng poll đầu tiên — lúc đó đã chắc chắn đăng
  // nhập được, mà vẫn còn sớm trước khi có khách nào bị xử lý sai.
  if (!_daKiemThe) { _daKiemThe = true; await mfs.kiemTraThe(); }

  const tu = new Date(Date.now() - SO_GIO * 3600 * 1000).toISOString();
  try {
    const ds = await mfs.goi(
      `/conversations?limit=${GIOI_HAN_DS}&from=${encodeURIComponent(tu)}&unreadFirst=true`
    );
    const items = (ds && ds.items) || [];
    const conversations = items.map(_hoaHoiThoai);
    console.log(`[mfs] đọc ${conversations.length} hội thoại (${SO_GIO}h gần nhất)`);
    return { success: true, total: conversations.length, conversations };
  } catch (e) {
    console.log(`[mfs][FETCH] ${e.message}`);
    return { success: false, total: undefined, conversations: [] };
  }
}

/** Tin thô của một hội thoại. `pageIdHint` không dùng — mfs tự biết Page. */
async function getMessages(conversationId, _pageIdHint) {
  try {
    const ds = await mfs.goi(`/conversations/${conversationId}/messages`);
    // Trả về { items, ... } hoặc mảng trần, tuỳ phiên bản -> nhận cả hai
    return Array.isArray(ds) ? ds : (ds && ds.items) || [];
  } catch (e) {
    console.log(`[mfs][MSG] ${e.message}`);
    return [];
  }
}

/**
 * Đổi tin của mfs sang hình dạng lõi bot đọc.
 *
 * Một tin của mfs có thể mang NHIỀU đính kèm; lõi bot thì coi mỗi ảnh là một
 * mục riêng (nhận diện ảnh chạy trên từng ảnh một). Nên một tin có 3 ảnh + chữ
 * sẽ nở thành 4 mục — đúng như `pancake_reader` vẫn làm.
 */
function normalizeMessages(apiMessages, _pageId) {
  const result = [];

  for (const m of apiMessages || []) {
    const sender = m.direction === "inbound" ? "customer" : "shop";
    // mfs đóng dấu 'agent' cho MỌI tin gửi qua API, kể cả tin của bot (xem
    // messages.service.ts). Nên KHÔNG dùng senderType để phân biệt người thật
    // với bot — lõi bot vẫn phân biệt bằng danh sách id tin nó đã gửi.
    const adminName = (m.senderUser && m.senderUser.fullName) || (sender === "shop" ? "mfs" : null);
    const channel = "INBOX";
    const insertedAt = m.createdAt;
    const text = String(m.body || "").trim();

    if (text) {
      result.push({
        type: "text", sender, channel, adminName,
        text, imageUrl: null, insertedAt, messageId: m.id
      });
    }

    for (const a of m.attachments || []) {
      if (a.kind !== "image") continue;
      if (!a.url) continue;   // chưa ký được đường dẫn thì bỏ, không đoán
      result.push({
        type: "image", sender, channel, adminName,
        text: "[Photo]", imageUrl: a.url, insertedAt, messageId: m.id
      });
    }
  }

  result.sort((a, b) => new Date(a.insertedAt) - new Date(b.insertedAt));
  return result;
}

/**
 * Đọc đủ một hội thoại: thông tin khách + toàn bộ tin.
 *
 * `convMeta` là dòng hội thoại đã có sẵn từ vòng poll — nhận vào để khỏi gọi
 * lại API, y như `pancake_reader` vẫn làm.
 */
async function readConversation(conversationId, convMeta = null) {
  let chiTiet = null;
  try {
    chiTiet = await mfs.goi(`/conversations/${conversationId}`);
  } catch (e) {
    console.log(`[mfs][READ] ${e.message}`);
    if (!convMeta) return null;
  }

  const messages = normalizeMessages(await getMessages(conversationId));
  const nguon = (chiTiet && chiTiet.source) || (convMeta && convMeta.source) || "direct";
  const tuQuangCao = nguon === "ad";

  return {
    conversationId,
    customerName:
      (chiTiet && chiTiet.contact && chiTiet.contact.displayName) ||
      (convMeta && convMeta.conv_from && convMeta.conv_from.name) ||
      "UNKNOWN",

    // Bài viết: mfs không đi lấy nội dung bài Facebook -> để trống, không bịa
    postId: null,
    postCaption: "",
    postImages: [],

    // Trả lời riêng dưới bình luận: mfs không có khái niệm này
    privateReplyId: null,
    canReplyPrivately: false,

    canInbox: true,
    customerPsid: (chiTiet && chiTiet.contact && chiTiet.contact.id) || null,
    inboxConversationId: conversationId,

    fromAd: tuQuangCao,
    adId: (chiTiet && chiTiet.adId) || null,
    adTitle: "",
    adPhotoUrl: null,
    adCaptionCandidates: [],
    adPostId: null,
    adRepliedPostId: null,
    adRepliedPfbid: null,

    // Riêng của mfs, lõi bot chưa dùng nhưng để sẵn cho phần sau
    botMode: (chiTiet && chiTiet.botMode) || null,
    customerId: (chiTiet && chiTiet.customerId) || null,
    handlingStatus: (chiTiet && chiTiet.handlingStatus) || null,

    messages
  };
}

/**
 * Đọc THẺ TƯƠI ngay trước lúc gửi (chống chạy đua: người thật gắn thẻ giữ sau
 * khi hội thoại đã được bốc lên xử).
 *
 * Trả mảng id thẻ; đọc KHÔNG được thì trả `null` — lõi bot hiểu null là "không
 * biết" và sẽ không chặn, giữ nguyên hành vi cũ.
 */
async function fetchConversationTags(conversationId, _pageIdHint) {
  try {
    const ds = await mfs.goi(`/conversations/${conversationId}/tags`);
    return (Array.isArray(ds) ? ds : []).map(t => t.id);
  } catch (e) {
    console.log(`[mfs][TAG-ĐỌC] ${e.message}`);
    return null;
  }
}

module.exports = {
  getConversations,
  getMessages,
  readConversation,
  normalizeMessages,
  fetchConversationTags
};
