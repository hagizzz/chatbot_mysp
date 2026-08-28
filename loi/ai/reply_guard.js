// reply_guard.js
// ===========================================================================
// SOI CÂU AI TRƯỚC KHI GỬI KHÁCH.
// Triết lý: AI CHỈ được viết câu TƯ VẤN KHÔNG ĐỤNG SỐ (chất vải, phom dáng,
// trấn an, hiểu câu lạ...). MỌI thứ chạm TIỀN / SĐT / CHỐT ĐƠN / SHIP phải do
// CODE (catalog + template + POS) lo. Nên nếu câu AI lỡ dính mấy thứ đó -> CHẶN
// nguyên câu (an toàn hơn là cắt rồi gửi câu cụt), nhường người thật / template.
//
// Hàm thuần (không gọi mạng) -> test được offline.
// ===========================================================================

function vetAdvisoryReply(reply) {
  const t = String(reply || "");
  const reasons = [];
  if (!t.trim()) return { allow: false, reasons: ["rỗng"] };

  // 1) TIỀN: số kèm đơn vị tiền (đ, k, nghìn, triệu, vnđ...)
  if (/\d[\d.,]*\s*(đ|₫|nghìn|nghin|ngàn|ngan|triệu|trieu|vnđ|vnd)/i.test(t)) reasons.push("tiền");
  if (/\d\s*k(?![a-zà-ỹ])/i.test(t)) reasons.push("giá-k");            // "990k", "99 k"
  // 2) SỐ KIỂU GIÁ: 1.190.000 / 990,000 / 990000 ...
  if (/\d{1,3}[.,]\d{3}([.,]\d{3})?(?!\d)/.test(t)) reasons.push("số-giá");
  if (/(?<!\d)\d{6,}(?!\d)/.test(t)) reasons.push("số-dài");           // 6+ số liền: giá/sđt
  // 3) SĐT
  if (/(?<!\d)(?:0|\+?84)\d[\d\s.\-]{7,}\d(?!\d)/.test(t)) reasons.push("sđt");
  // 4) AI ĐƯỢC DẪN CHỐT (xin sđt/địa chỉ, "em lên đơn cho mình", "chốt cho mình") -> KHÔNG chặn mấy cụm này nữa.
  //    NHƯNG vẫn CHẶN khi AI TỰ NHẬN đơn đã xong / nói TỔNG TIỀN / CỌC / STK (việc tạo đơn + tính tiền là của CODE/POS).
  if (/(đã đặt|đã lên đơn|đã chốt|đã tạo đơn|đã xác nhận đơn|xác nhận đơn hàng|tổng đơn|tổng tiền|tổng cộng|thành tiền|đặt cọc|tiền cọc|chuyển khoản|\bstk\b|số tài khoản|\bcod\b)/i.test(t)) reasons.push("đơn-hoàn-tất/tiền");
  if (/(phí ship|phi ship|tiền ship|free ?ship|freeship|miễn ship|mien ship|ship \d|đồng ship)/i.test(t)) reasons.push("ship");
  if (/(hết hàng|het hang|hết size|het size|còn hàng|con hang|còn size|con size|hết màu|het mau|còn \d+ (cái|bộ|chiếc|sản phẩm))/i.test(t)) reasons.push("tồn-kho");

  return { allow: reasons.length === 0, reasons };
}

module.exports = { vetAdvisoryReply };
