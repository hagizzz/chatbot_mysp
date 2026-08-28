// ============================================================================
// nguon_hoi_thoai.js — KÝ HIỆU NGUỒN HỘI THOẠI (mục 3.5, tiêu chí bắt buộc)
// ----------------------------------------------------------------------------
// "Mỗi hội thoại được gắn dấu TỪ QUẢNG CÁO / TỪ BÌNH LUẬN / NHẮN THẲNG để nhân
// viên nhìn là biết."
//
// Trước GĐ1 bot ĐÃ nhận ra nguồn (dùng để chọn mẫu) nhưng chỉ ghi ghi-chú ở đúng
// một nhánh: khách từ quảng cáo và bot có báo giá. Khách từ bình luận, hoặc khách
// từ quảng cáo mà bot nhường người thật -> nhân viên mở lên không biết khách ở đâu ra.
//
// Nay: mọi hội thoại đều được đánh dấu, đúng MỘT LẦN, ngay khi bot nhìn thấy lần đầu.
// Dấu ghi vào ô Ghi chú của Pancake (nhân viên thấy ngay) và vào log có cấu trúc
// (để mục 9.4 đếm được: khách đến từ đâu thì chốt đơn nhiều hơn).
// ============================================================================
const turnLog = require("../tien_ich/turn_log");

const DAU = {
  quang_cao:  { icon: "🎯", chu: "TỪ QUẢNG CÁO" },
  binh_luan:  { icon: "💬", chu: "TỪ BÌNH LUẬN" },
  nhan_thang: { icon: "✉️", chu: "NHẮN THẲNG" }
};

// Ưu tiên: quảng cáo > bình luận > nhắn thẳng.
// (Khách bấm quảng cáo rồi bình luận dưới bài thì vẫn tính là từ quảng cáo — tiền đã
//  bỏ ra để có khách này, cần biết để đo hiệu quả quảng cáo.)
function xacDinhNguon({ fromAd = false, adId = null, isCommentOrigin = false } = {}) {
  if (fromAd || adId) return "quang_cao";
  if (isCommentOrigin) return "binh_luan";
  return "nhan_thang";
}

function moTa(nguon, chiTiet = {}) {
  const d = DAU[nguon] || DAU.nhan_thang;
  const phan = [`${d.icon} ${d.chu}`];
  if (chiTiet.tenAd) phan.push(String(chiTiet.tenAd).split("\n")[0].slice(0, 60).trim());
  if (chiTiet.adId) phan.push(`adId: ${chiTiet.adId}`);
  if (chiTiet.postId) phan.push(`bài: facebook.com/${chiTiet.postId}`);
  if (chiTiet.maSanPham) phan.push(`mẫu: ${chiTiet.maSanPham}`);
  return phan.join(" | ");
}

/**
 * Đánh dấu nguồn cho một hội thoại. Gọi được nhiều lần, chỉ ghi chú MỘT lần.
 * @param {object} p
 * @param {string} p.conversationId
 * @param {object} p.mem            bộ nhớ hội thoại (dùng cờ _nguonDaGhi để không ghi lại)
 * @param {function} p.ghiChuHam    hàm ghi ghi-chú (addConversationNote); bỏ trống = chỉ ghi log
 */
async function danhDau({ conversationId, mem = {}, nguon, chiTiet = {}, ghiChuHam = null }) {
  const n = nguon || xacDinhNguon(chiTiet);
  turnLog.set({ nguon: n, adId: chiTiet.adId || null, postId: chiTiet.postId || null });
  mem._nguon = n;

  // Ghi chú chỉ một lần cho mỗi hội thoại; ghi lại mỗi lượt là làm rác ô ghi chú.
  if (mem._nguonDaGhi === n) return { nguon: n, daGhi: false };
  if (!ghiChuHam) { mem._nguonDaGhi = n; return { nguon: n, daGhi: false }; }
  try {
    await ghiChuHam(conversationId, moTa(n, chiTiet));
    mem._nguonDaGhi = n;
    return { nguon: n, daGhi: true };
  } catch (e) {
    return { nguon: n, daGhi: false, loi: String((e && e.message) || e) };
  }
}

module.exports = { xacDinhNguon, moTa, danhDau, DAU };
