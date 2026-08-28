// ============================================================================
// test/mo_man_san_pham.test.js — NHỊP TRẢ LỜI CHO TIN ĐẦU TIÊN VỀ MỘT MẪU
// ----------------------------------------------------------------------------
// Shop chốt nhịp:  1) báo giá  ->  2) ba ảnh  ->  3) trả lời câu khách hỏi
//                  ->  4) câu đuôi (hỏi size / xin sđt+địa chỉ / mời lên đơn)
//
// Nhịp này dễ vỡ theo hai cách, nên phải có test giữ:
//   · Ai đó chuyển lời gọi `moManSanPham` xuống dưới một handler -> handler đó
//     trả lời trước, mất bước "giá trước".
//   · Ai đó thêm `return true` ngay sau cổng -> lượt kết thúc ở bước 2, khách
//     nhận giá + ảnh rồi bot im, không ai trả lời câu họ hỏi.
//
// bot_worker_api_v3.js require vào là chạy bot thật nên không nạp được trong
// test; soi cấu trúc mã nguồn như test/mot_nguon_su_that.test.js vẫn làm.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

function thanHam(ten) {
  const i = SRC.indexOf(`async function ${ten}(`);
  assert.ok(i > 0, `không thấy hàm ${ten}`);
  const j = SRC.indexOf("\n}", i);
  return SRC.slice(i, j);
}

test("cổng mở màn chạy TRƯỚC nhánh báo giá của dispatch", () => {
  const cong = SRC.indexOf("await moManSanPham(");
  const nhanhGia = SRC.indexOf("(priceAsk || _newModelPresented)");
  assert.ok(cong > 0, "không thấy lời gọi moManSanPham trong dispatch");
  assert.ok(nhanhGia > 0, "không thấy nhánh báo giá");
  assert.ok(cong < nhanhGia,
    "cổng mở màn phải đứng trước mọi nhánh chuyên trách, nếu không thì nhánh nào " +
    "nhận câu hỏi sẽ trả lời trước và mất bước báo giá");
});

test("cổng mở màn KHÔNG kết thúc lượt — nhánh dưới còn phải trả lời câu hỏi chính", () => {
  const i = SRC.indexOf("await moManSanPham(");
  const sau = SRC.slice(i, i + 400);
  assert.ok(!/\breturn true\b/.test(sau),
    "có return ngay sau cổng -> khách nhận giá + ảnh rồi bot im, không trả lời câu họ hỏi");
});

test("trong cổng: GIÁ gửi trước, ẢNH gửi sau", () => {
  const than = thanHam("moManSanPham");
  const gia = than.indexOf("sendInboxMessage(conversationId, cau)");
  const anh = than.indexOf("maybeSendImages(");
  assert.ok(gia > 0 && anh > 0, "cổng phải gửi cả câu giá lẫn ảnh");
  assert.ok(gia < anh, "kịch bản §13: báo giá xong mới gửi ảnh kèm");
});

test("cổng KHÔNG tự gắn câu đuôi — đuôi phải đứng sau câu trả lời chính", () => {
  const than = thanHam("moManSanPham");
  assert.ok(!/sizeTailForProduct/.test(than),
    "gắn đuôi ngay ở cổng thì khách bị hỏi size trước khi được trả lời câu mình hỏi, " +
    "và lãnh hai câu đuôi trong một lượt");
});

test("cổng có đủ chốt chặn: đã báo giá 24h / hết hàng / thiếu giá / đã chốt đơn", () => {
  const than = thanHam("moManSanPham");
  for (const [ma, vi] of [
    ["quotedRecently", "mẫu đã báo giá trong 24h -> mở màn lại là lặp giá"],
    ["isOutOfStock", "mẫu hết hàng có nhánh riêng báo hết + gửi mẫu tương tự"],
    ["priceLine", "giá thiếu/lỗi trong sheet -> KHÔNG được bịa giá"],
    ["orderClosed", "đã chốt đơn -> đang ở luồng hậu mãi, không mở màn lại"]
  ]) {
    assert.ok(than.includes(ma), `thiếu chốt "${ma}": ${vi}`);
  }
});

test("nhiều mẫu trong một lượt thì cổng nhường sendBlocks", () => {
  const than = thanHam("moManSanPham");
  assert.ok(/soMauLuotNay\s*>\s*1/.test(than),
    "gửi nhiều mẫu mà cổng cũng chen vào thì khách bị báo giá hai lần cho cùng một mẫu");
});

test("KỊCH BẢN §13 — mọi chỗ báo giá đều là GIÁ trước, ẢNH sau", () => {
  // §13 (kich_ban/luat.txt): "Sau mỗi lần báo giá sản phẩm, bắt buộc gửi kèm hình ảnh
  // đúng mẫu vừa báo giá." Code từng làm ngược (ảnh trước) mà vẫn viện dẫn §13.
  const than = thanHam("sendBlocks");
  const gia = than.indexOf("priceText} ạ.`");
  const anh = than.indexOf("await maybeSendImages(conversationId, p.code, mem, true)");
  assert.ok(gia > 0 && anh > 0, "sendBlocks phải gửi cả giá lẫn ảnh");
  assert.ok(gia < anh, "sendBlocks đang gửi ảnh trước giá — ngược với §13");

  const kb = fs.readFileSync(path.join(GOC, "kich_ban", "luat.txt"), "utf8");
  assert.ok(/Sau mỗi lần báo giá sản phẩm, bắt buộc gửi kèm hình ảnh/.test(kb),
    "§13 trong kịch bản đã đổi chữ -> đọc lại rồi sửa test này cho khớp");
});

test("công tắc MO_MAN_MODE: mặc định on, có shadow và off, đã khai ở .env.example", () => {
  const than = thanHam("moManSanPham");
  assert.ok(/caiDat\("MO_MAN_MODE", "on"\)/.test(than),
    "mặc định phải là on, và đọc qua kho để shop khai được theo từng shop");
  assert.ok(than.includes('=== "off"') && than.includes('=== "shadow"'),
    "phải có đủ ba nấc on/shadow/off để tắt được ngay trên page thật");

  const env = fs.readFileSync(path.join(GOC, ".env.example"), "utf8");
  assert.ok(/^MO_MAN_MODE=/m.test(env), "chưa khai ở .env.example thì shop không biết là có");
});
