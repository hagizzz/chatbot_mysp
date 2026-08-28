// Tra sản phẩm theo mã - giờ dùng catalog cache (nhanh, không quét cả sheet mỗi lần).
const { getByCode } = require("./catalog_cache");

async function findProductByCode(code) {
  return await getByCode(code);
}

module.exports = { findProductByCode };
