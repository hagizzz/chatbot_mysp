// ============================================================================
// test/tu_van_phai_mo_man.test.js — XIN TƯ VẤN THÌ PHẢI CÓ GIÁ + ẢNH TRƯỚC
// ----------------------------------------------------------------------------
// kich_ban/luat.txt §13 (:128-136): tin đầu của khách về một mẫu thì nhịp trả
// lời là 1) báo giá  2) gửi 3 ảnh đúng mẫu  3) trả lời câu khách hỏi  4) câu đuôi.
// Và ":136 Sau mỗi lần báo giá sản phẩm, bắt buộc gửi kèm hình ảnh đúng mẫu."
//
// Ca Hà Giang 27/08/2026: khách gửi ẢNH mẫu Ginevra (MRAD5446) + "tư vấn e mẫu
// này đi". Bot đáp đúng MỘT câu:
//     "Dạ với số đo của chị thì em tư vấn size vừa form, mặc lên rất tôn dáng..."
// Không tên mẫu, không giá, không ảnh.
//
// KHÔNG phải nhánh hỏng — bot đang tuân một luật KHÁC: ":135 Mẫu đã báo giá trong
// 24 giờ thì không mở màn lại, tránh lặp giá". Hội thoại thử đã đi qua 13 mẫu nên
// MRAD5446 nằm sẵn trong pricedCodes -> moManSanPham thoát ở chốt quotedRecently.
//
// Luật chống-lặp đúng cho MỘT MẠCH tư vấn liền. Nhưng khách quay lại xin tư vấn
// một mẫu là mở lượt bán MỚI cho mẫu đó. Nay: xin tư vấn thì mở màn lại, với điều
// kiện lần báo giá gần nhất của ĐÚNG mã đó đã quá _VUA_BAO_GIA_PHUT phút — chốt
// chống đúp trong cùng một mạch vẫn nguyên.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

function layHam(ten) {
  const i = SRC.indexOf("function " + ten + "(");
  assert.ok(i >= 0, `không thấy hàm ${ten}`);
  let sau = 0;
  for (let k = SRC.indexOf("{", i); k < SRC.length; k++) {
    if (SRC[k] === "{") sau++;
    else if (SRC[k] === "}" && --sau === 0) return SRC.slice(i, k + 1);
  }
  assert.fail("không đóng được ngoặc của " + ten);
}
const scope = {};
new Function("s", "with (s) { " + layHam("xinTuVanMau") + "\n s.xinTuVanMau = xinTuVanMau; }")(scope);
const { xinTuVanMau } = scope;

test("nhận ra khách XIN TƯ VẤN một mẫu", () => {
  for (const c of [
    "tư vấn e mẫu này đi",              // đúng câu gây ra việc này
    "tư vấn giúp em với shop",
    "mẫu này thế nào shop",
    "set này như nào ạ",
    "xem giúp em mẫu này với"
  ]) assert.strictEqual(xinTuVanMau(c), true, `trượt: "${c}"`);
});

test("câu hỏi thuộc tính lẻ KHÔNG phải xin tư vấn", () => {
  for (const c of [
    "mẫu này bao nhiêu tiền",
    "còn size M k shop",
    "cho e xin ảnh thật",
    "ship về Hà Nội mấy ngày"
  ]) assert.strictEqual(xinTuVanMau(c), false, `bắt bừa: "${c}"`);
});

test("mở màn nhận được cờ xin-tư-vấn từ nơi gọi", () => {
  assert.match(SRC, /moManSanPham\(conversationId, mem, product, soMauLuotNay, epTuVan\)/,
    "hàm phải nhận cờ");
  assert.match(SRC, /moManSanPham\(conversationId, mem, productInfo, thisTurn\.length,[\s\S]{0,80}xinTuVanMau\(latestText\)\)/,
    "nơi gọi không truyền cờ thì bản vá nằm chết trong hàm");
});

test("chốt 24h chỉ được nới khi CÓ xin tư vấn VÀ đã quá mạch", () => {
  const i = SRC.indexOf("if (quotedRecently(mem, k)) {");
  assert.ok(i > 0, "không thấy chốt 24h trong moManSanPham");
  const k = SRC.slice(i, i + 900);
  assert.match(k, /_VUA_BAO_GIA_PHUT \* 60 \* 1000/, "phải đo bằng mốc chống-đúp sẵn có, không tự đặt số mới");
  assert.match(k, /if \(!\(epTuVan && _daLau\)\) return false;/,
    "thiếu một trong hai điều kiện là quay lại lặp giá trong cùng một mạch");
});

test("mở màn vẫn là GIÁ rồi mới tới ẢNH, đúng thứ tự luật §13", () => {
  const i = SRC.indexOf("async function moManSanPham(");
  const k = SRC.slice(i, i + 2600);
  const iGia = k.indexOf("// 1. GIÁ");
  const iAnh = k.indexOf("// 2. BA ẢNH");
  assert.ok(iGia > 0 && iAnh > iGia, "ảnh phải đi SAU giá");
  assert.match(k, /mem\._imgAllowSend = true;/, "không mở cổng này thì ảnh bị chặn bởi _imgShownBefore");
});
