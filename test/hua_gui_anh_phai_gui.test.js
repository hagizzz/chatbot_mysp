// ============================================================================
// test/hua_gui_anh_phai_gui.test.js — HỨA GỬI ẢNH THÌ PHẢI GỬI
// ----------------------------------------------------------------------------
// Đo trên page PHOM 26/08/2026 (khách Hà Giang):
//   10:28 và 10:36 bot đã gửi ảnh Áo Londyn
//   10:38:00 khách "có ảnh khách thật mặc không shop"
//   10:38:17 bot "Em gửi chị xem ảnh Áo Londyn ạ."  -> rồi KHÔNG gửi tấm nào.
//
// Đường đi của lỗi:
//   · wantsImages() đòi "ảnh thật" LIỀN NHAU -> "ảnh khách thật" trượt -> askImages=false
//   · mem._imgAllowSend chốt sớm = (imageCount>0) || askImages  -> false
//   · nhãn AI IMAGE_REQ vớt được ở (a3) -> askImages=true, NHƯNG cờ vẫn false
//   · maybeSendImages: "đã gửi ảnh trong hội thoại && !_imgAllowSend" chặn TRƯỚC mọi
//     force -> ảnh không đi, mà leadText thì vẫn đi -> bot hứa rồi im.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

// Lấy CHÍNH regex trong mã ra chạy thật, không chép lại (chép lại là test bản sao).
function reXinAnh() {
  const m = SRC.match(/function wantsImages\(text\) \{\s*return \/(.+?)\/i\.test/s);
  assert.ok(m, "không tìm thấy regex trong wantsImages");
  return new RegExp(m[1], "i");
}

test("khách xin ảnh NGƯỜI MẶC THẬT -> regex phải bắt được", () => {
  const re = reXinAnh();
  assert.ok(re.test("có ảnh khách thật mặc không shop"), "ca thật 26/08/2026 vẫn trượt");
  assert.ok(re.test("có ảnh người mặc không ạ"));
  assert.ok(re.test("shop có ảnh khách mặc chưa"));
});

test("câu KHÔNG xin ảnh thì đừng bắt bừa", () => {
  // Nới tay quá thì mọi câu đều thành "xin ảnh" -> bot dội ảnh vô cớ.
  const re = reXinAnh();
  assert.ok(!re.test("size M mặc vừa không shop"));
  assert.ok(!re.test("bao giờ ship về đấy ạ"));
  assert.ok(!re.test("giá bao nhiêu vậy"));
});

test("khách XIN THÊM ẢNH / ảnh MÀU KHÁC -> regex phải bắt được", () => {
  // Đo trên page PHOM 26/08/2026 10:49:22: khách "em xin thêm ảnh của màu khác với",
  // bot đáp "Áo Londyn chị ưng thì em lên đơn cho mình ạ" — giục chốt, không đúng trọng tâm.
  // Regex cũ đòi động từ DÍNH LIỀN danh từ ("gửi ảnh"), nên "gửi THÊM ảnh", "xin ảnh",
  // "xin thêm ảnh" đều trượt -> không nhận ra là câu xin ảnh -> rơi xuống nhánh CTA.
  const re = reXinAnh();
  assert.ok(re.test("em xin thêm ảnh của màu khác với"), "ca thật 26/08/2026 vẫn trượt");
  assert.ok(re.test("xin ảnh với"));
  assert.ok(re.test("gửi thêm ảnh đi shop"));
  assert.ok(re.test("còn ảnh nào khác không"));
  assert.ok(re.test("cho xin ảnh màu đỏ"));
});

test("câu hỏi MÀU không kèm chữ ảnh thì KHÔNG phải xin ảnh", () => {
  // "có mấy màu ạ" đã có nhánh riêng (liệt kê màu rồi mới gửi ảnh từng màu).
  // Bắt nhầm sang xin-ảnh là nhảy cóc mất câu liệt kê màu.
  const re = reXinAnh();
  assert.ok(!re.test("có mấy màu ạ"));
  assert.ok(!re.test("shop có ship COD không"));
  assert.ok(!re.test("em cho địa chỉ đây shop"));
});

test("(a3) khách xin ảnh qua NHÃN AI -> phải bật mem._imgAllowSend", () => {
  const i = SRC.indexOf("KHÁCH XIN XEM ẢNH THẬT");
  assert.ok(i > 0, "không thấy nhánh (a3)");
  const khoi = SRC.slice(i, i + 1200);
  assert.match(khoi, /askImages = true;/, "mất nhánh bật askImages");
  assert.match(khoi, /mem\._imgAllowSend = true;/,
    "askImages=true mà không bật _imgAllowSend -> chốt 'đã gửi ảnh trong hội thoại' chặn hết ảnh");
  assert.ok(khoi.indexOf("askImages = true;") < khoi.indexOf("mem._imgAllowSend = true;") + 400,
    "hai dòng phải đi liền nhau, tách ra là lần sau lại quên một cái");
});

test("action SEND_IMAGES cũng phải bật cờ", () => {
  const m = SRC.match(/if \(action === "SEND_IMAGES" && productInfo\)[^\n]*/);
  assert.ok(m, "không thấy nhánh SEND_IMAGES");
  assert.match(m[0], /mem\._imgAllowSend = true/,
    "AI phát SEND_IMAGES cũng là khách xin ảnh — thiếu cờ là lại hứa suông");
});

test("cờ phải được bật TRƯỚC chỗ gọi maybeSendImages của nhánh askImages", () => {
  const iCo = SRC.indexOf("KHÁCH XIN XEM ẢNH THẬT");
  const iGui = SRC.indexOf("} else if (askImages && productInfo) {");
  assert.ok(iCo > 0 && iGui > iCo,
    "bật cờ sau lệnh gửi thì ảnh đã bị chặn xong rồi");
});
