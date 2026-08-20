require("dotenv").config();
const reg = require("./page_registry");

const PAGE_ID = process.env.PANCAKE_PAGE_ID;
const PAGE_TOKEN = process.env.PANCAKE_PAGE_ACCESS_TOKEN;

// ĐA-PAGE: suy pageId từ convId ("pageId_userId") -> tra token page đó. Không ra thì dùng env (bản 1-page).
// LƯU Ý: comment conv có id "POSTID_xxx" -> pageIdFromConv ra POST id (KHÔNG phải page) -> phải chỉnh về page thật.
function _pc(conversationId) {
  let pid = reg.pageIdFromConv(conversationId) || PAGE_ID;
  if (!reg.isKnownPage(pid) && !(PAGE_ID && pid === PAGE_ID)) {
    const pages = reg.listPages();
    if (pages.length === 1) pid = pages[0].id;        // 1 page -> chắc chắn là nó (sửa gửi comment)
    else if (PAGE_ID) pid = PAGE_ID;
  }
  const tok = reg.getToken(pid) || PAGE_TOKEN;
  return { pid, tok };
}

function endpoint(conversationId) {
  const { pid, tok } = _pc(conversationId);
  return (
    `https://pages.fm/api/public_api/v1/pages/${pid}/conversations/${conversationId}/messages` +
    `?page_access_token=${tok}`
  );
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Gửi TIN CHỮ qua action tùy chọn (mặc định reply_inbox = tin nhắn riêng).
async function sendInboxMessage(conversationId, text) {
  if (!conversationId) throw new Error("Thiếu conversationId");
  if (!text || !String(text).trim()) return { success: false, reason: "EMPTY_MESSAGE" };

  const res = await fetch(endpoint(conversationId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reply_inbox", message: String(text).trim() })
  });
  return await res.json();
}

// TRẢ LỜI COMMENT CÔNG KHAI. action: "reply_comment", cần message_id = id comment của khách.
async function replyComment(conversationId, text, commentId) {
  if (!conversationId) throw new Error("Thiếu conversationId");
  if (!text || !String(text).trim()) return { success: false, reason: "EMPTY_MESSAGE" };
  const body = { action: "reply_comment", message: String(text).trim() };
  if (commentId) body.message_id = commentId;   // Pancake yêu cầu 'message_id'
  const res = await fetch(endpoint(conversationId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return await res.json().catch(() => ({ success: false, reason: "BAD_JSON" }));
}

// Gửi ẢNH bằng content_ids (id ảnh đã up sẵn lên Pancake qua upload_contents).
// Facebook cho tối đa 30 ảnh/lần -> gửi cả cụm 1 lần.
async function sendInboxContentIds(conversationId, contentIds) {
  if (!conversationId) throw new Error("Thiếu conversationId");
  const ids = (contentIds || []).filter(Boolean);
  if (!ids.length) return { success: false, reason: "EMPTY_CONTENT" };

  const res = await fetch(endpoint(conversationId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reply_inbox", content_ids: ids })
  });
  return await res.json();
}

// Tương thích chỗ gọi cũ: nhận danh sách (giờ là content_ids), gửi 1 lần.
async function sendInboxImages(conversationId, contentIds, max = 3) {
  const ids = (contentIds || []).slice(0, max).filter(Boolean);
  if (!ids.length) return [];
  const r = await sendInboxContentIds(conversationId, ids);
  return [r];
}

// Gửi ẢNH bằng LINK trực tiếp (content_url). Dùng cho ảnh host ngoài (Drive direct, imgbb...).
// Trả về phản hồi API để chỗ gọi tự log/kiểm tra Pancake có nhận hay không.
async function sendInboxImageUrl(conversationId, imageUrl) {
  if (!conversationId) throw new Error("Thiếu conversationId");
  if (!imageUrl) return { success: false, reason: "EMPTY_URL" };
  const res = await fetch(endpoint(conversationId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reply_inbox", content_url: String(imageUrl).trim() })
  });
  return await res.json();
}

// Gửi NHIỀU ảnh URL trong 1 LẦN GỌI (để 3 ảnh 1 mẫu ra CÙNG LÚC, không lẻ tẻ).
// Thử content_urls (mảng). Pancake không nhận -> trả success:false để caller fallback gửi lẻ.
async function sendInboxImageUrls(conversationId, imageUrls) {
  if (!conversationId) throw new Error("Thiếu conversationId");
  const urls = (imageUrls || []).map(u => String(u || "").trim()).filter(Boolean);
  if (!urls.length) return { success: false, reason: "EMPTY_URLS" };
  const res = await fetch(endpoint(conversationId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reply_inbox", content_urls: urls })
  });
  return await res.json();
}

// Giữ hàm cũ để không vỡ chỗ nào còn gọi (nhưng giờ coi tham số là content_id)
async function sendInboxImage(conversationId, contentId) {
  return sendInboxContentIds(conversationId, [contentId]);
}

// GỬI CHỮ + ẢNH TRONG 1 LẦN GỌI (1 message duy nhất mang cả text + album).
// Dùng cho LEAD COMMENT/ADS: chỉ có 1 "slot" trả lời -> nhồi cả chữ + ảnh vào đó để KHỎI dính
// (#551) "Người này hiện không có mặt" khi gửi ảnh ở message thứ 2.
// Ưu tiên content_ids (album đã up Pancake); nếu KHÔNG có id thì dùng content_urls.
async function sendInboxMessageWithImages(conversationId, text, contentIds, imageUrls) {
  if (!conversationId) throw new Error("Thiếu conversationId");
  const ids = (contentIds || []).filter(Boolean).slice(0, 30);
  const urls = (imageUrls || []).map(u => String(u || "").trim()).filter(Boolean).slice(0, 30);
  const body = { action: "reply_inbox" };
  if (text && String(text).trim()) body.message = String(text).trim();
  if (ids.length) body.content_ids = ids;
  else if (urls.length) body.content_urls = urls;
  if (!body.message && !body.content_ids && !body.content_urls) return { success: false, reason: "EMPTY" };
  const res = await fetch(endpoint(conversationId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return await res.json().catch(() => ({ success: false, reason: "BAD_JSON" }));
}


const TAG_AI_CHO_XL = 183; // id thẻ "AI - CHỜ XL" (chờ thông tin)
const TAG_AI_XL_ANH = 184; // id thẻ "AI- XL ảnh" (ảnh nhận không ra)
const TAG_AI_DON_UU_TIEN = 185; // id thẻ "AI- ĐƠN ƯU TIÊN" (đơn gấp / ưu tiên xử lý)
const TAG_AI_GUI_DON_GAP = process.env.PANCAKE_TAG_GUI_DON_GAP ? Number(process.env.PANCAKE_TAG_GUI_DON_GAP) : 206; // id thẻ "AI- Gửi đơn gấp"
// Thẻ "AI chốt" (id 182) cho ĐƠN THƯỜNG (không gấp) — KHÔNG chặn bot, chỉ đánh dấu để NV lên đơn POS.
// Có thể ghi đè qua .env: PANCAKE_TAG_AI_CHOT=<id>.
const TAG_AI_CHOT = process.env.PANCAKE_TAG_AI_CHOT ? Number(process.env.PANCAKE_TAG_AI_CHOT) : 182;

function tagEndpoint(conversationId) {
  const { pid, tok } = _pc(conversationId);
  return (
    `https://pages.fm/api/public_api/v1/pages/${pid}/conversations/${conversationId}/tags` +
    `?page_access_token=${tok}`
  );
}

// Gắn 1 thẻ vào hội thoại. Thử vài kiểu tham số + THỬ LẠI tối đa 3 vòng (khắc phục "lúc gắn lúc ko").
async function addTag(conversationId, tagId) {
  if (!conversationId || tagId == null) return { success: false, reason: "MISSING" };
  const bodies = [
    { action: "add", tag_id: tagId },
    { action: "add", tag_id: String(tagId) },
    { tag_id: tagId }
  ];
  let last = null;
  for (let round = 1; round <= 3; round++) {
    for (const body of bodies) {
      try {
        const res = await fetch(tagEndpoint(conversationId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        last = data;
        if (res.ok && data && data.success !== false) return data;
      } catch (e) {
        last = { error: e.message };
      }
    }
    // Cả 3 kiểu đều fail ở vòng này -> nghỉ ngắn rồi thử lại (Pancake thi thoảng chập).
    if (round < 3) await new Promise(r => setTimeout(r, 1200));
  }
  console.log(`addTag THẤT BẠI sau 3 vòng | conv=${conversationId} tag=${tagId} | last=`, JSON.stringify(last));
  return last || { success: false };
}

async function tagChoXuLy(conversationId) {
  const r = await addTag(conversationId, TAG_AI_CHO_XL);
  console.log("TAG AI-CHỜ XL:", JSON.stringify(r));
  return r;
}

// GỠ 1 thẻ khỏi hội thoại (thử vài kiểu tham số + 3 vòng như addTag).
async function removeTag(conversationId, tagId) {
  if (!conversationId || tagId == null) return { success: false, reason: "MISSING" };
  const bodies = [
    { action: "remove", tag_id: tagId },
    { action: "remove", tag_id: String(tagId) },
    { action: "delete", tag_id: tagId }
  ];
  let last = null;
  for (let round = 1; round <= 3; round++) {
    for (const body of bodies) {
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
    }
    if (round < 3) await new Promise(r => setTimeout(r, 1200));
  }
  return last || { success: false };
}
async function untagXuLyAnh(conversationId) {
  const r = await removeTag(conversationId, TAG_AI_XL_ANH);
  console.log("GỠ thẻ AI-XL ảnh:", JSON.stringify(r));
  return r;
}

// Đánh dấu hội thoại CHƯA ĐỌC (để nổi lên cho nhân viên xử lý)
async function markUnread(conversationId) {
  if (!conversationId) return { success: false };
  const { pid, tok } = _pc(conversationId);
  const url =
    `https://pages.fm/api/public_api/v1/pages/${pid}/conversations/${conversationId}/unread` +
    `?page_access_token=${tok}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    return await res.json().catch(() => ({}));
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Gắn thẻ AI-CHỜ XL XONG -> chuyển cuộc về CHƯA ĐỌC
async function tagChoXuLyVaUnread(conversationId) {
  const t = await tagChoXuLy(conversationId);
  const u = await markUnread(conversationId);
  console.log("UNREAD:", JSON.stringify(u));
  return { tag: t, unread: u };
}

// Thẻ riêng cho trường hợp ẢNH nhận không ra: "AI- XL ảnh" (184) + chưa đọc
async function tagXuLyAnh(conversationId) {
  const r = await addTag(conversationId, TAG_AI_XL_ANH);
  console.log("TAG AI-XL ảnh:", JSON.stringify(r));
  return r;
}
async function tagXuLyAnhVaUnread(conversationId) {
  const t = await tagXuLyAnh(conversationId);
  const u = await markUnread(conversationId);
  console.log("UNREAD:", JSON.stringify(u));
  return { tag: t, unread: u };
}

// Thẻ riêng cho ĐƠN GẤP / ưu tiên: "AI- ĐƠN ƯU TIÊN" (185) + chưa đọc (nổi lên cho NV ưu tiên xử)
async function tagDonUuTien(conversationId) {
  const r = await addTag(conversationId, TAG_AI_DON_UU_TIEN);
  console.log("TAG AI-ĐƠN ƯU TIÊN:", JSON.stringify(r));
  return r;
}
async function tagDonUuTienVaUnread(conversationId) {
  const t = await tagDonUuTien(conversationId);
  const u = await markUnread(conversationId);
  console.log("UNREAD:", JSON.stringify(u));
  return { tag: t, unread: u };
}
// Thẻ "AI- Gửi đơn gấp" (206): gắn THÊM cho ca ĐÒI HỦY khi đơn đang ở "ĐÃ XÁC NHẬN" -> NV đẩy đơn gấp.
async function tagGuiDonGap(conversationId) {
  const r = await addTag(conversationId, TAG_AI_GUI_DON_GAP);
  console.log("TAG AI-Gửi đơn gấp (206):", JSON.stringify(r));
  return r;
}
// Thẻ "AI chốt" (182) cho ĐƠN THƯỜNG -> NV thấy mà lên đơn POS. KHÔNG đánh dấu chưa đọc,
// KHÔNG chặn bot (182 không nằm trong nhóm thẻ giữ) -> bot vẫn trả lời tiếp các câu hỏi sau.
async function tagAiChot(conversationId) {
  const r = await addTag(conversationId, TAG_AI_CHOT);
  console.log("TAG AI chốt (182):", JSON.stringify(r));
  return r;
}

// Gửi DM RIÊNG theo BÌNH LUẬN (action private_replies + comment id) -> FB gắn banner
// "phản hồi bình luận + Link Facebook". Đây là cách có banner kể cả khi không có privateReplyId.
async function sendPrivateReply(conversationId, text, commentId, postId) {
  if (!conversationId || !commentId) return { success: false, reason: "MISSING" };
  if (!text || !String(text).trim()) return { success: false, reason: "EMPTY_MESSAGE" };
  const body = { action: "private_replies", message: String(text).trim(), message_id: commentId };
  if (postId) body.post_id = postId;   // FB yêu cầu post_id cho private_replies -> mới ra banner
  const res = await fetch(endpoint(conversationId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return await res.json().catch(() => ({ success: false, reason: "BAD_JSON" }));
}

// Ghi GHI CHÚ nội bộ vào hội thoại (ô "Nhập ghi chú") -> NV thấy nguồn ads, KHÔNG gửi cho khách.
// LƯU Ý: chưa chắc Pancake public API hỗ trợ endpoint này -> thử vài kiểu, log rõ kết quả để còn biết.
async function addConversationNote(conversationId, text) {
  if (!conversationId || !text || !String(text).trim()) return { success: false, reason: "MISSING" };
  const msg = String(text).trim();
  const { pid, tok } = _pc(conversationId);
  const attempts = [
    { url: `https://pages.fm/api/public_api/v1/pages/${pid}/conversations/${conversationId}/notes?page_access_token=${tok}`, body: { message: msg } },
    { url: `https://pages.fm/api/public_api/v1/pages/${pid}/conversations/${conversationId}/notes?page_access_token=${tok}`, body: { note: msg } },
    { url: `https://pages.fm/api/public_api/v1/pages/${pid}/conversations/${conversationId}/note?page_access_token=${tok}`, body: { message: msg } }
  ];
  let last = null;
  for (const a of attempts) {
    try {
      const res = await fetch(a.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(a.body)
      });
      last = await res.json().catch(() => ({ success: false, _status: res.status }));
      if (last && last.success === true) { console.log("NOTE ads: OK"); return last; }
    } catch (e) { last = { success: false, error: e.message }; }
  }
  console.log("NOTE ads: KHÔNG ghi được (API có thể không hỗ trợ) | PHẢN HỒI:", JSON.stringify(last));
  return last || { success: false };
}

module.exports = { sendInboxMessage, replyComment, sendPrivateReply, sendInboxImage, sendInboxImages, sendInboxContentIds, sendInboxImageUrl, sendInboxImageUrls, sendInboxMessageWithImages, addTag, removeTag, tagChoXuLy, markUnread, tagChoXuLyVaUnread, tagXuLyAnh, tagXuLyAnhVaUnread, untagXuLyAnh, tagDonUuTien, tagDonUuTienVaUnread, tagGuiDonGap, tagAiChot, addConversationNote, delay };
