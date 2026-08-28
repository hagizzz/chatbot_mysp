const __goc = require("path").join(__dirname, "..", "..");
// ============================================================================
// duong_kich_ban.js — MỘT CHỖ DUY NHẤT TRẢ LỜI "KỊCH BẢN NẰM Ở ĐÂU"
// ----------------------------------------------------------------------------
// Trước đây luật nghiệp vụ nằm ở kich_ban.txt ngoài gốc dự án, còn câu chữ nằm
// trong kich_ban/. Hai nơi, hai kiểu, và không chỗ nào tách được theo shop.
//
// Nay gom hết vào THƯ MỤC kich_ban/, và mọi thứ đều theo shop được:
//
//   kich_ban/luat.txt            luật nghiệp vụ GỐC — mọi shop kế thừa
//   kich_ban/luat.<shopId>.txt   luật riêng của shop (có thì dùng, không thì lấy gốc)
//   kich_ban/mac_dinh.json       câu nói GỐC — mọi shop kế thừa
//   kich_ban/<shopId>.json       câu nói riêng của shop (đè lên gốc, chỉ ngăn "cau")
//   kich_ban/khong_rut.txt       danh sách câu KHÔNG rút về kho
//
// Thêm shop mới = thêm hai tệp mang tên shop đó, không sửa một dòng mã nào.
// ============================================================================
const fs = require("fs");
const path = require("path");

const THU_MUC = process.env.KICH_BAN_DIR || path.join(__goc, "kich_ban");
const SHOP_ID = process.env.SHOP_ID || "mysp";

/** Đường dẫn tệp luật nghiệp vụ: ưu tiên bản riêng của shop, không có thì lấy gốc. */
function duongLuat(shopId) {
  const sid = String(shopId || SHOP_ID);
  const rieng = path.join(THU_MUC, `luat.${sid}.txt`);
  if (fs.existsSync(rieng)) return rieng;
  return path.join(THU_MUC, "luat.txt");
}

/** Nội dung luật nghiệp vụ (chuỗi rỗng nếu không có tệp nào). */
function docLuat(shopId) {
  try { return fs.readFileSync(duongLuat(shopId), "utf8").trim(); }
  catch (_) { return ""; }
}

module.exports = { THU_MUC, SHOP_ID, duongLuat, docLuat };
