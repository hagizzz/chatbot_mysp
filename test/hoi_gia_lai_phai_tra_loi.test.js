// ============================================================================
// test/hoi_gia_lai_phai_tra_loi.test.js — HỎI GIÁ THÌ PHẢI ĐƯỢC TRẢ LỜI
// ----------------------------------------------------------------------------
// Đo trên page PHOM 26/08/2026:
//   14:33 bot báo giá Váy Tatiana 1.290.000đ
//   16:37 khách gửi LẠI ảnh mẫu đó + gõ đúng một chữ "giá"
//   16:37 bot IM HOÀN TOÀN
//
// Log: "Hỏi giá nhưng mẫu MRVX5422 ĐÃ báo giá lượt trước (bot) -> KHÔNG báo lại"
// Chốt chống lặp dùng quotedRecently với cửa sổ 24 GIỜ. Nó sinh ra cho ca "vừa
// báo giá xong vài giây", nhưng 24 giờ là quá rộng để im trước một câu hỏi thẳng.
//
// Bộ canh RƠI LẶNG bắt được ca này ("[RƠI LẶNG shadow] … khách: giá") nhưng đang
// ở chế độ bóng nên chỉ ghi sổ, không cứu được khách.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

function khoiChongLap() {
  const i = SRC.indexOf("NHẮC LẠI GIÁ, không gửi lại ảnh");
  assert.ok(i > 0, "không thấy nhánh nhắc lại giá");
  return SRC.slice(i - 1600, i + 300);
}

test("hỏi giá sau thời gian nguội -> NHẮC LẠI GIÁ, không im", () => {
  const k = khoiChongLap();
  assert.match(k, /if \(priceAsk && !_vuaBaoGia\)/,
    "thiếu điều kiện: khách hỏi thẳng giá mà vẫn rơi vào nhánh im");
  assert.match(k, /await sendInboxMessage\(conversationId, _nhacGia\)/,
    "không gửi gì thì vẫn im như cũ");
});

test("vừa báo giá trong vài phút -> VẪN im (chống đúp thật)", () => {
  const k = khoiChongLap();
  assert.match(k, /_vuaBaoGia = quotedRecently\(mem, k, _VUA_BAO_GIA_PHUT \/ 60\)/,
    "phải có cửa sổ nguội tính bằng PHÚT, không thì mất luôn chống-đúp");
  assert.match(SRC, /const _VUA_BAO_GIA_PHUT = Number\(process\.env\.VUA_BAO_GIA_PHUT \|\| 5\)/,
    "ngưỡng phải khai được qua .env, shop tự chỉnh");
});

test("KHÔNG gửi lại ảnh khi chỉ nhắc giá", () => {
  const k = khoiChongLap();
  const iNhac = k.indexOf("_nhacGia");
  const doan = k.slice(iNhac, iNhac + 600);
  assert.ok(!/maybeSendImages/.test(doan),
    "nhắc giá mà dội lại 3 ảnh là quay về đúng thứ chống-lặp sinh ra để ngăn");
});

test("nhánh im cũ vẫn còn cho ca không hỏi giá", () => {
  assert.match(SRC, /ĐÃ báo giá \$\{quotedRecently\(mem, k\) \? "lượt trước \(bot\)" : "trong luồng \(NV\/bot\)"\}/,
    "mất nhánh cũ -> mọi tin nhắc lại mẫu đều bị báo giá lại");
});
