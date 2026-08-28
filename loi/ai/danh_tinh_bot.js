// ============================================================================
// danh_tinh_bot.js — MỘT NGUỒN SỰ THẬT DUY NHẤT CHO DANH TÍNH BOT
// ----------------------------------------------------------------------------
// Vì sao có file này: tên bot đang được khai ở BA nơi với HAI giá trị khác nhau —
//   kich_ban/luat.txt -> "Bảo Châu"
//   bot_worker_api_v3 -> const BOT_NAME = "Bảo Trâm"
//   reasoning_engine  -> prompt viết cứng "Bảo Trâm", kèm câu phải tuyên bố
//                        "tên này ƯU TIÊN HƠN mọi tên khác trong kịch bản"
// Chính câu tuyên bố ấy là bằng chứng hai nguồn đang đánh nhau: code phải nói to
// hơn kịch bản mới thắng được nó. Sang shop thứ hai thì kiểu chắp vá này gãy.
//
// Từ nay: tên nằm ở ĐÂY, mọi nơi khác đọc về. Đổi tên cho một shop = đổi một
// biến môi trường, không phải sửa mã ở ba chỗ rồi cầu cho không sót chỗ nào.
// ============================================================================

// Shop khác thì đặt TEN_BOT trong .env — không phải sửa mã.
const TEN_BOT = String(process.env.TEN_BOT || "Bảo Trâm").trim();

// Cách xưng hô, cũng là thứ mỗi shop một khác (ngành hàng nam/nữ, tuổi khách).
//
// [TÁCH GIỌNG 27/08/2026] Đọc ngăn "giong" của kho TRƯỚC, .env chỉ đỡ phía sau.
// Lý do: .env là của CẢ TIẾN TRÌNH, mà một tiến trình đang lo 4 page của nhiều
// shop — để xưng hô ở .env thì không shop nào có giọng riêng được. Ngăn "giong"
// tách theo shop nên mới đúng chỗ.
//
// Đọc LƯỜI (mỗi lần gọi), không chốt cứng lúc nạp mô-đun: kho tự soi lại tệp
// mỗi 5 phút, shop sửa giọng là ăn ngay, không phải khởi động lại bot.
let _KB = null;
function _giong(ten, macDinh) {
  try {
    if (_KB === null) _KB = require("../cau_noi/kho_kich_ban");
    const v = _KB.giong(ten, null);
    if (v) return String(v).trim();
  } catch (_) {}
  return macDinh;
}
function xung()     { return _giong("xung",      String(process.env.BOT_XUNG || "em").trim()); }
function goiKhach() { return _giong("goi_khach", String(process.env.BOT_GOI_KHACH || "chị").trim()); }

// ===== TÊN HIỆN TRONG PANCAKE (admin_name) — KHÁC TÊN NÓI VỚI KHÁCH =====
// Pancake đóng dấu tên người gửi lên mỗi tin phía shop:
//   tin bot này gửi qua public_api  -> admin_name = "Public API"
//   tin Botcake gửi                 -> admin_name = "Botcake"
//   tin nhân viên gửi               -> admin_name = tên nhân viên
// Bot dựa vào đúng dấu này để biết "người thật đã vào xử chưa" mà đứng ngoài.
// Nên nếu đổi tên hiển thị bên Pancake mà danh sách dưới đây không đổi theo,
// bot sẽ tưởng TIN CỦA CHÍNH NÓ là tin nhân viên -> tự nhường -> im luôn.
// Đổi tên bên Pancake thì khai lại ở đây (ngăn cách bằng dấu phẩy), đừng sửa mã.
// "Bot" là nhãn pancake_gia_lap.js đóng lên tin bot gửi khi chạy thử ngoại tuyến.
// Thiếu nó thì mọi tin BOT trong bản giả lập bị tính là tin NGƯỜI THẬT -> humanInbox
// bật -> tầng AI-QUYẾT bị chặn -> kịch bản thử luôn rơi về luật cũ. Nghĩa là mọi
// lần chạy dien_kich_ban.js/chat_thu.js trước nay đều nghiệm thu NHẦM nhánh.
const NHAN_BOT_PANCAKE = String(process.env.NHAN_BOT_PANCAKE || "Public API,Botcake,Bot")
  .split(",").map(s => s.trim()).filter(Boolean);

// admin_name này có phải BOT không? (so sánh không phân biệt hoa/thường)
function laNhanBot(adminName) {
  const a = String(adminName || "").trim().toLowerCase();
  if (!a) return false;
  return NHAN_BOT_PANCAKE.some(n => n.toLowerCase() === a);
}

// Câu nhắc danh tính, chèn thẳng vào prompt — để reasoning_engine không phải
// viết cứng tên nữa.
function nhacDanhTinh() {
  return `Bạn tên là **${TEN_BOT}**, xưng "${xung()}" với khách và gọi khách là "${goiKhach()}". ` +
         `Nếu khách hỏi tên thì trả lời đúng "${TEN_BOT}".`;
}

// XUNG / GOI_KHACH để dạng getter chứ không phải hằng: shop sửa giọng trong
// kich_ban/<shop>.json thì kho tự soi lại sau 5 phút và ăn ngay, không cần khởi
// động lại bot. Chốt cứng lúc nạp mô-đun sẽ giữ mãi giá trị lúc bot vừa chạy.
module.exports = {
  TEN_BOT,
  get XUNG() { return xung(); },
  get GOI_KHACH() { return goiKhach(); },
  xung, goiKhach, nhacDanhTinh, NHAN_BOT_PANCAKE, laNhanBot
};
