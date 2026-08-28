// ============================================================================
// test/anh_dung_mau_da_hua.test.js — NÓI GỬI ẢNH MÀU X THÌ PHẢI GỬI MÀU X
// ----------------------------------------------------------------------------
// Ca thử Hà Giang 27/08/2026, mẫu Set Mireva (MRKSQ6017). Log page thật:
//
//   10:06:34  khách gửi ẢNH + "tư vấn e mẫu này"
//             [vision] màu (từ tên file): HỒNG | mã MRKSQ6017
//             -> mem.colorByCode["MRKSQ6017"] = "HỒNG"
//   10:10:03  "còn màu khác k shop"      -> bot: "có hồng và xanh nhạt"
//   10:11:52  "đây mà màu xanh à shop"   -> bot: "Mẫu này có màu xanh chị ạ."
//   10:12:16  "gửi e xem"
//             REPLY: "Dạ em gửi chị xem ảnh màu xanh nhạt của Set Mireva nhe."
//             IMG MRKSQ6017: gửi 3 ảnh (màu: HỒNG) -> OK          <- SAI
//
// GỐC RỄ, hai cái rời nhau:
//   1. mem.colorByCode chỉ có chỗ GHI (:3823 -> gộp vào mem ở :7848), KHÔNG có
//      chỗ xoá, mà lại đứng ĐẦU thứ tự ưu tiên màu. Một lần khách gửi ảnh hồng
//      là mã đó khoá màu hồng đến hết hội thoại, dù sau đó khách đã nói hẳn là
//      đang xem màu xanh.
//   2. Câu chữ do reasoning_engine soạn (biết là xanh nhạt), màu ảnh do
//      maybeSendImages tự chọn (biết là hồng). Hai đường không ai đối chiếu ai
//      — log in hai dòng ngay cạnh nhau mà không có chốt chặn nào.
//
// Nay: câu vừa gửi nêu ĐÚNG MỘT màu thì đó là LỜI HỨA, đứng trên mọi màu nhớ
// được từ trước; không có ảnh màu đã hứa thì THÀ KHÔNG GỬI.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const { mauDuyNhat, extractColor } = require(path.join(GOC, "loi/san_pham/color_utils"));
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

// --- 1. mauDuyNhat: đọc đúng LỜI HỨA, không bịa ra lời hứa -------------------

test("câu đúng ca lỗi -> đọc ra 'Xanh nhạt', không phải 'Hồng'", () => {
  const cau = "Dạ em gửi chị xem ảnh màu xanh nhạt của Set Mireva nhe.";
  assert.strictEqual(mauDuyNhat(cau), "Xanh nhạt");
});

test("'xanh nhạt' KHÔNG bị đếm thành hai màu (xanh nhạt + xanh)", () => {
  // Cụm dài chiếm chỗ trước; "xanh" nằm trong nó nên không tính lại. Sai chỗ này
  // thì mọi câu hứa màu ghép đều ra null -> bản vá thành vô dụng mà không ai biết.
  assert.strictEqual(mauDuyNhat("ảnh màu xanh nhạt ạ"), "Xanh nhạt");
  assert.strictEqual(mauDuyNhat("ảnh màu hồng nhạt ạ"), "Hồng nhạt");
});

test("câu LIỆT KÊ nhiều màu KHÔNG phải lời hứa -> null", () => {
  // "có hồng và xanh nhạt" mà coi là hứa thì bot hứa 2 màu, ảnh gửi 1 -> tệ hơn.
  assert.strictEqual(mauDuyNhat("Dạ mẫu này bên em có hồng và xanh nhạt chị nha."), null);
  assert.strictEqual(extractColor("Dạ mẫu này bên em có hồng và xanh nhạt chị nha."), "Xanh nhạt");
});

test("câu không nêu màu -> null (không ràng buộc gì)", () => {
  assert.strictEqual(mauDuyNhat("gửi e xem"), null);
  assert.strictEqual(mauDuyNhat("Dạ Set Mireva giá 1.200.000đ ạ."), null);
});

test("giữ nguyên các chốt chặn nhầm-dấu của extractColor", () => {
  // "Vâng" fold ra "vang" — không được thành màu Vàng. Lỗi này đã từng ghi đơn sai.
  assert.strictEqual(mauDuyNhat("Vâng vậy mình lấy size M"), null);
  assert.strictEqual(mauDuyNhat("dạ em cảm ơn chị"), null);      // "cảm" không phải Cam
  assert.strictEqual(mauDuyNhat("trang phục này đẹp"), null);    // "trang" không phải Trắng
});

// --- 2. maybeSendImages: lời hứa phải THẮNG màu nhớ từ trước ----------------

function khoiChonMau() {
  const i = SRC.indexOf("const visionColor = (mem.colorByCode || {})[C] || null;");
  assert.ok(i > 0, "không thấy khối chọn màu trong maybeSendImages");
  const j = SRC.indexOf("let contentIds = items.map", i);
  assert.ok(j > i, "không thấy mốc kết thúc khối chọn màu");
  return SRC.slice(i, j);
}

test("lời hứa đứng TRƯỚC visionColor trong thứ tự ưu tiên", () => {
  const k = khoiChonMau();
  assert.match(k, /color = promiseColor \|\| visionColor \|\| reqColor \|\| sourceColor;/,
    "promiseColor phải đứng đầu — đứng sau visionColor là lỗi Hà Giang quay lại nguyên vẹn");
});

test("lời hứa dùng MỘT LẦN rồi xoá, không vắt sang lượt sau", () => {
  const k = khoiChonMau();
  assert.match(k, /mem\._mauVuaHua = null;/,
    "không xoá thì lời hứa cũ lại dính y như mem.colorByCode đang dính");
});

test("đã hứa màu -> strict, và KHÔNG được nới strict để gửi màu khác", () => {
  const k = khoiChonMau();
  assert.match(k, /let strict = !!promiseColor \|\| \(!!reqColor && !visionColor\);/,
    "hứa màu mà không strict thì vẫn fallback sang màu khác");
  // Nhánh promiseColor phải KHÔNG có "strict = false".
  const iHua = k.indexOf("if (promiseColor) {");
  const iElse = k.indexOf("} else {", iHua);
  assert.ok(iHua > 0 && iElse > iHua, "không thấy nhánh xử lý riêng cho màu đã hứa");
  assert.ok(!k.slice(iHua, iElse).includes("strict = false"),
    "nới strict trong nhánh đã-hứa = gửi sai màu, đúng lỗi đang sửa");
});

test("mã chiến dịch KHÔNG được đè lên màu đã hứa", () => {
  assert.match(khoiChonMau(),
    /CAMPAIGN_DEFAULT_COLOR\[C\] && !visionColor && !reqColor && !promiseColor/,
    "màu chiến dịch đè lời hứa thì lại nói một đằng gửi một nẻo");
});

test("câu AI vừa gửi được ghi thành lời hứa ngay tại chỗ gửi", () => {
  const i = SRC.indexOf('console.log("REPLY:", reply);');
  assert.ok(i > 0, "không thấy chỗ gửi câu AI");
  const sau = SRC.slice(i, i + 500);
  assert.match(sau, /mem\._mauVuaHua = mauDuyNhat\(reply\)/,
    "không ghi lời hứa ở đây thì ảnh gửi ngay dưới vẫn tự chọn màu");
  const iImg = SRC.indexOf("maybeSendImages(", i);
  assert.ok(iImg > i, "phải ghi lời hứa TRƯỚC khi gửi ảnh");
});
