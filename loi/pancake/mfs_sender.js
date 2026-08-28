const __goc = require("path").join(__dirname, "..", "..");
// ============================================================================
// mfs_sender.js — GỬI TIN / GẮN THẺ QUA mfs, thay cho pancake_sender.js
// ----------------------------------------------------------------------------
// Xuất ĐÚNG 23 tên hàm mà `pancake_sender.js` xuất. Lõi bot gọi `sendInboxMessage`
// 241 lần và `tagChoXuLyVaUnread` 67 lần — đổi tên hay đổi kiểu trả về là phải
// sửa từng chỗ, nên giữ nguyên cả hai.
//
// BA CHỖ KHÁC HẲN PANCAKE
//
// 1. ẢNH. Pancake nhận `content_id` (ảnh đã up sẵn trong kho Pancake) hoặc URL.
//    mfs chỉ nhận `storageKey` — tệp phải nằm trong kho của mfs trước. Nên ở đây:
//        content_id --(hash_index.json)--> URL Drive --(tải về)--> POST /uploads --> storageKey
//    Kết quả tải lên được NHỚ LẠI theo URL (`data/mfs_anh_da_tai.json`), vì shop
//    gửi đi gửi lại cùng một bộ ảnh sản phẩm mỗi ngày; không nhớ thì mỗi lượt
//    khách hỏi là một lần tải 2MB lên kho.
//
// 2. THẺ. Pancake dùng số (182, 183…), mfs dùng UUID theo từng shop. Quy đổi
//    nằm ở `mfs_client.idThe()`, tra theo TÊN thẻ khai trong .env.
//
// 3. BÌNH LUẬN. mfs chưa có trả lời bình luận / trả lời riêng. Hai hàm đó trả
//    `{ success:false, reason:"MFS_CHUA_HO_TRO" }` chứ KHÔNG lặng lẽ báo thành
//    công — lõi bot đọc `success` để quyết có gắn thẻ nhường người thật không.
// ============================================================================
const fs = require("fs");
const path = require("path");
const mfs = require("./mfs_client");
const turnLog = require("../tien_ich/turn_log");

const FILE_NHO_ANH = path.join(__goc, "data", "mfs_anh_da_tai.json");
const HASH_FILE = path.join(__goc, "hash_index.json");

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== NHỚ ẢNH ĐÃ TẢI LÊN: url -> storageKey ================================
let _nhoAnh = null;
function _napNhoAnh() {
  if (_nhoAnh) return _nhoAnh;
  try {
    _nhoAnh = JSON.parse(fs.readFileSync(FILE_NHO_ANH, "utf8"));
  } catch (_) { _nhoAnh = {}; }
  return _nhoAnh;
}
let _henGhi = null;
function _ghiNgay() {
  if (_henGhi) { clearTimeout(_henGhi); _henGhi = null; }
  if (!_nhoAnh) return;
  try {
    fs.mkdirSync(path.dirname(FILE_NHO_ANH), { recursive: true });
    fs.writeFileSync(FILE_NHO_ANH, JSON.stringify(_nhoAnh, null, 0), "utf8");
  } catch (e) { console.log(`[mfs] không ghi được sổ ảnh: ${e.message}`); }
}
function _ghiNhoAnh() {
  // Gộp ghi: một lượt gửi 3 ảnh thì ghi đĩa MỘT lần, không phải ba.
  if (_henGhi) return;
  _henGhi = setTimeout(() => { _henGhi = null; _ghiNgay(); }, 1500);
  // unref để sổ ảnh không giữ tiến trình sống; bù lại phải ghi nốt lúc thoát,
  // nếu không lần chạy sau sẽ tải lên lại toàn bộ ảnh của lượt cuối.
  if (_henGhi.unref) _henGhi.unref();
}
process.once("exit", _ghiNgay);

// Đếm số lần THỰC SỰ tải lên (không tính lần dùng lại sổ nhớ) — để bài thử
// kiểm được rằng bộ nhớ đệm có tác dụng thật.
let _soLanTaiLen = 0;

// ===== content_id (Pancake) -> URL ảnh thật =================================
// hash_index.json là sổ ảnh sẵn có của bot: mỗi mục có `pancakeId` và `downloadUrl`.
let _urlTheoCid = null;
function _bangCid() {
  if (_urlTheoCid) return _urlTheoCid;
  _urlTheoCid = new Map();
  try {
    const arr = JSON.parse(fs.readFileSync(HASH_FILE, "utf8"));
    for (const it of arr) {
      if (it && it.pancakeId) {
        const u = it.downloadUrl || it.thumbnailUrl;
        if (u) _urlTheoCid.set(String(it.pancakeId), u);
      }
    }
    console.log(`[mfs] sổ ảnh: ${_urlTheoCid.size} content_id đổi được sang URL`);
  } catch (e) {
    console.log(`[mfs] không đọc được hash_index.json: ${e.message}`);
  }
  return _urlTheoCid;
}

function _urlTuContentId(cid) {
  if (!cid) return null;
  const s = String(cid);
  // Truyền thẳng URL cũng nhận — lõi bot có chỗ trộn lẫn hai loại
  if (/^https?:\/\//i.test(s)) return s;
  return _bangCid().get(s) || null;
}

const TOI_DA_ANH = 10 * 1024 * 1024;   // mfs chặn ảnh > 10MB (uploads.module.ts)

/** Tải một ảnh từ URL lên kho của mfs, trả `storageKey`. Hỏng thì trả null. */
async function _taiAnhLen(url) {
  if (!url) return null;
  const nho = _napNhoAnh();
  if (nho[url]) return nho[url];

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`[mfs][ẢNH] tải về hỏng HTTP ${res.status}: ${String(url).slice(0, 90)}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    if (buf.length > TOI_DA_ANH) {
      console.log(`[mfs][ẢNH] ${Math.round(buf.length / 1048576)}MB > 10MB, mfs sẽ từ chối: ${String(url).slice(0, 90)}`);
      return null;
    }

    // mfs nhận diện loại tệp theo BYTE ĐẦU chứ không theo tên, nên tên gửi lên
    // chỉ để hiển thị; đặt đuôi .jpg cho gọn.
    const fd = new FormData();
    fd.append("file", new Blob([buf]), `sp_${Date.now()}.jpg`);
    const kq = await mfs.goi("/uploads", { method: "POST", body: fd });
    if (!kq || !kq.storageKey) return null;
    _soLanTaiLen++;

    nho[url] = kq.storageKey;
    _ghiNhoAnh();
    return kq.storageKey;
  } catch (e) {
    console.log(`[mfs][ẢNH] ${e.message}`);
    return null;
  }
}

// ===== GỬI TIN ==============================================================
/**
 * Gửi một tin. Trả về hình dạng mà lõi bot đang đọc:
 *   { success, message_id, ... }  hoặc  { success:false, error }
 */
async function _guiTin(conversationId, { text = "", storageKeys = [], gopAnh = false } = {}) {
  if (!conversationId) return { success: false, reason: "MISSING" };

  const chu = String(text || "").trim();
  if (!chu && !storageKeys.length) return { success: false, reason: "RỖNG" };

  // mfs chặn body > 4000 ký tự. Cắt còn hơn để cả tin bị từ chối.
  const than = {
    contentType: storageKeys.length && !chu ? "image" : "text",
    groupImages: Boolean(gopAnh)
  };
  if (chu) than.body = chu.slice(0, 4000);
  if (storageKeys.length) {
    than.attachments = storageKeys.slice(0, 20).map(k => ({ storageKey: k, kind: "image" }));
  }

  try {
    const kq = await mfs.goi(`/conversations/${conversationId}/messages`, {
      method: "POST", body: than
    });
    // mfs trả 202 kèm bản ghi tin (đang chờ cổng gửi đẩy sang Meta)
    const id = kq && kq.id;
    // Trước đây gọi turnLog.sent(id) -> id tin rơi vào ô "kiểu", nội dung để trống
    // nên log lượt mất chữ và không truy được nguồn câu. Gọi đúng chữ ký (kiểu, nội dung).
    try { turnLog.sent && turnLog.sent(storageKeys.length && !chu ? "image" : "inbox", chu); } catch (_) {}
    return { success: true, message_id: id, id, data: kq };
  } catch (e) {
    return { success: false, error: e.message, status: e.status };
  }
}

async function sendInboxMessage(conversationId, text) {
  const r = await _guiTin(conversationId, { text });
  if (!r.success) console.log(`[mfs] gửi hỏng: ${r.error || r.reason}`);
  return r;
}

/** Gửi ảnh theo content_id của Pancake — đổi sang URL rồi tải lên mfs. */
async function sendInboxContentIds(conversationId, contentIds) {
  const urls = (contentIds || []).map(_urlTuContentId).filter(Boolean);
  const thieu = (contentIds || []).length - urls.length;
  if (thieu > 0) console.log(`[mfs] ${thieu} content_id không tra được URL trong hash_index.json`);
  return sendInboxImageUrls(conversationId, urls);
}

async function sendInboxImages(conversationId, contentIds, max = 3) {
  return sendInboxContentIds(conversationId, (contentIds || []).slice(0, max));
}

async function sendInboxImage(conversationId, contentId) {
  return sendInboxContentIds(conversationId, [contentId]);
}

async function sendInboxImageUrl(conversationId, imageUrl) {
  const key = await _taiAnhLen(imageUrl);
  if (!key) return { success: false, error: "TAI_ANH_LEN_HONG" };
  return _guiTin(conversationId, { storageKeys: [key] });
}

/**
 * Nhiều ảnh trong MỘT tin.
 *
 * Pancake gửi từng ảnh một tin; mfs gửi được cả chùm (`groupImages`) nên khách
 * thấy một nhóm ảnh thay vì ba tin liên tiếp. Ảnh nào tải lên hỏng thì BỎ ảnh
 * đó chứ không bỏ cả tin.
 */
async function sendInboxImageUrls(conversationId, imageUrls) {
  const keys = [];
  for (const u of imageUrls || []) {
    const k = await _taiAnhLen(u);
    if (k) keys.push(k);
  }
  if (!keys.length) return { success: false, error: "KHONG_CO_ANH_NAO_LEN_DUOC" };
  return _guiTin(conversationId, { storageKeys: keys, gopAnh: keys.length > 1 });
}

async function sendInboxMessageWithImages(conversationId, text, contentIds, imageUrls) {
  const urls = [
    ...(contentIds || []).map(_urlTuContentId).filter(Boolean),
    ...(imageUrls || [])
  ];
  const keys = [];
  for (const u of urls) {
    const k = await _taiAnhLen(u);
    if (k) keys.push(k);
  }
  // Chữ và ảnh đi CÙNG một tin — mfs cho phép, Pancake thì không
  return _guiTin(conversationId, { text, storageKeys: keys, gopAnh: keys.length > 1 });
}

// ===== BÌNH LUẬN: mfs chưa có =============================================
async function replyComment(conversationId, text, commentId) {
  console.log(`[mfs] trả lời bình luận: mfs chưa hỗ trợ (conv=${conversationId} cmt=${commentId})`);
  return { success: false, reason: "MFS_CHUA_HO_TRO" };
}
async function sendPrivateReply(conversationId, text, commentId, postId) {
  console.log(`[mfs] trả lời riêng dưới bình luận: mfs chưa hỗ trợ (conv=${conversationId})`);
  return { success: false, reason: "MFS_CHUA_HO_TRO" };
}

// ===== THẺ ==================================================================
async function addTag(conversationId, tagId) {
  if (!conversationId || !tagId) return { success: false, reason: "MISSING" };
  const r = await mfs.goiNhe(`/conversations/${conversationId}/tags`, {
    method: "POST", body: { tagId, applyToAllOfCustomer: false }
  });
  if (r.success) { try { turnLog.tag("add", tagId); } catch (_) {} }
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

async function removeTag(conversationId, tagId) {
  if (!conversationId || !tagId) return { success: false, reason: "MISSING" };
  const r = await mfs.goiNhe(`/conversations/${conversationId}/tags/${tagId}`, { method: "DELETE" });
  if (r.success) { try { turnLog.tag("remove", tagId); } catch (_) {} }
  return r.success ? { success: true, data: r.data } : { success: false, error: r.error };
}

async function _gan(conversationId, vaiTro, nhan) {
  const id = await mfs.idThe(vaiTro);
  if (!id) {
    console.log(`[mfs] không có thẻ "${vaiTro}" -> BỎ QUA gắn thẻ`);
    return { success: false, reason: "KHONG_CO_THE" };
  }
  const r = await addTag(conversationId, id);
  console.log(`TAG ${nhan}: ${JSON.stringify(r.success ? "ok" : r)}`);
  return r;
}

async function tagChoXuLy(conversationId) { return _gan(conversationId, "cho_nguoi_that", "CHỜ NGƯỜI THẬT"); }
async function tagXuLyAnh(conversationId) { return _gan(conversationId, "xu_ly_anh", "XL ẢNH"); }
async function tagDonUuTien(conversationId) { return _gan(conversationId, "don_uu_tien", "ĐƠN ƯU TIÊN"); }
async function tagGuiDonGap(conversationId) { return _gan(conversationId, "gui_don_gap", "GỬI ĐƠN GẤP"); }
async function tagAiChot(conversationId) { return _gan(conversationId, "ai_chot", "AI CHỐT"); }

async function untagXuLyAnh(conversationId) {
  const id = await mfs.idThe("xu_ly_anh");
  if (!id) return { success: false, reason: "KHONG_CO_THE" };
  const r = await removeTag(conversationId, id);
  console.log(`GỠ thẻ XL ảnh: ${JSON.stringify(r.success ? "ok" : r)}`);
  return r;
}

/**
 * Đánh dấu CHƯA ĐỌC để hội thoại nổi lên cho nhân viên.
 *
 * Lưu ý: mfs tách "chưa đọc" khỏi "chờ xử lý" (mục 6) — đọc rồi mà chưa trả lời
 * vẫn là chờ xử lý. Bot đánh dấu chưa đọc để giống hành vi cũ trên Pancake, và
 * gắn thêm `handlingStatus=pending` mới là tín hiệu đúng của mfs.
 */
async function markUnread(conversationId) {
  if (!conversationId) return { success: false };
  const r = await mfs.goiNhe(`/conversations/${conversationId}/read`, {
    method: "POST", body: { read: false }
  });
  // Đưa về "chờ xử lý" — đây mới là hàng đợi thật của nhân viên trong mfs
  await mfs.goiNhe(`/conversations/${conversationId}/handled`, {
    method: "POST", body: { handled: false }
  });
  return r.success ? { success: true } : { success: false, error: r.error };
}

async function tagChoXuLyVaUnread(conversationId) {
  const t = await tagChoXuLy(conversationId);
  const u = await markUnread(conversationId);
  return { tag: t, unread: u };
}
async function tagXuLyAnhVaUnread(conversationId) {
  const t = await tagXuLyAnh(conversationId);
  const u = await markUnread(conversationId);
  return { tag: t, unread: u };
}
async function tagDonUuTienVaUnread(conversationId) {
  const t = await tagDonUuTien(conversationId);
  const u = await markUnread(conversationId);
  return { tag: t, unread: u };
}

/**
 * Ghi chú.
 *
 * Pancake có ô ghi chú ngay trên hội thoại; mfs để ghi chú ở HỒ SƠ KHÁCH. Nên
 * ở đây phải tra hội thoại -> khách rồi mới ghi. Hội thoại chưa gộp vào hồ sơ
 * khách nào thì không có chỗ ghi — báo rõ chứ không im lặng nuốt.
 */
async function addConversationNote(conversationId, text) {
  if (!conversationId || !text) return { success: false, reason: "MISSING" };
  const c = await mfs.goiNhe(`/conversations/${conversationId}`);
  if (!c.success) return { success: false, error: c.error };

  const khachId = c.data && c.data.customerId;
  if (!khachId) {
    console.log(`[mfs] ghi chú: hội thoại ${conversationId} chưa có hồ sơ khách -> không ghi được`);
    return { success: false, reason: "CHUA_CO_HO_SO_KHACH" };
  }

  const cu = await mfs.goiNhe(`/customers/${khachId}`);
  const ghiCu = (cu.success && cu.data && cu.data.note) || "";
  const moi = ghiCu ? `${ghiCu}\n${text}` : String(text);

  const r = await mfs.goiNhe(`/customers/${khachId}`, {
    method: "PATCH", body: { note: moi.slice(0, 2000) }
  });
  return r.success ? { success: true } : { success: false, error: r.error };
}

module.exports = {
  sendInboxMessage, replyComment, sendPrivateReply, sendInboxImage, sendInboxImages,
  sendInboxContentIds, sendInboxImageUrl, sendInboxImageUrls, sendInboxMessageWithImages,
  addTag, removeTag, tagChoXuLy, markUnread, tagChoXuLyVaUnread, tagXuLyAnh,
  tagXuLyAnhVaUnread, untagXuLyAnh, tagDonUuTien, tagDonUuTienVaUnread, tagGuiDonGap,
  tagAiChot, addConversationNote, delay,
  // chỉ dùng cho bài thử
  _soLanTaiLen: () => _soLanTaiLen, _ghiNgay
};
