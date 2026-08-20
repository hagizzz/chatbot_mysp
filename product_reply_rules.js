// Đã TẮT luật cứng (địa chỉ/ship/đổi trả/thanh toán) để tránh đè và mâu thuẫn với kịch bản Doc.
// Mọi câu trả lời giờ đi qua AI (đã được kịch bản + dữ liệu sản phẩm dẫn dắt).
// Giữ lại getPrice cho nơi khác dùng nếu cần.
function hasValidPrice(value) {
  const t = String(value || "").trim();
  if (!t || t === "0" || t.includes("#")) return false;
  if (t.toLowerCase() === "null" || t.toLowerCase() === "undefined") return false;
  return /\d/.test(t);
}

function getPrice(product) {
  if (!product) return "";
  if (hasValidPrice(product.salePrice)) return product.salePrice;
  if (hasValidPrice(product.price)) return product.price;
  if (hasValidPrice(product.originalPrice)) return product.originalPrice;
  return "";
}

function buildHardReply() {
  return null; // luôn trả null -> để AI xử lý theo kịch bản
}

module.exports = { buildHardReply, getPrice };
