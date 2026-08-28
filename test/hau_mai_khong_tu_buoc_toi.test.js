// ============================================================================
// test/hau_mai_khong_tu_buoc_toi.test.js — BOT KHÔNG ĐƯỢC LẤY CÂU CỦA CHÍNH NÓ
//                                          LÀM BẰNG CHỨNG BUỘC TỘI MÌNH
// ----------------------------------------------------------------------------
// Ca thật đo trên page THẬT 25/08/2026 — khách Hà Giang, hội thoại
// 1468690110033030_28072582612392839:
//
//   [bot]     "Dạ em nhận được ẢNH của chị rồi ạ. Để tránh sai sót khi giao,
//              chị nhắn giúp em địa chỉ bằng tin nhắn chữ ạ."      -> _RE_RECEIVED
//   [bot]     "Dạ chị bỏ qua giúp em TIN NHẮN xin địa chỉ lúc nãy nhé,
//              em gửi nhầm ạ."                                     -> _RE_FITBAD
//   [khách]   "mẫu này có size không ạ" + ảnh
//
// postSaleFitComplaint ghép hai câu của BOT thành "khách đã nhận hàng và shop
// gửi nhầm" -> cổng hậu mãi gắn thẻ 183 -> nhân viên gỡ thẻ -> vòng poll sau
// gắn lại (log ghi đúng 2 vòng cách nhau 48 giây). Khách hỏi 2 lần, không ai trả.
//
// Hai lỗi độc lập, test cả hai:
//   1. CẤU TRÚC — hàm xét cả tin phía shop, chỉ loại tin bot bằng botSentIds,
//      mà botSentIds là Set trong RAM: bot khởi động lại là quên sạch.
//   2. CHỮ NGHĨA — "nhận được" / "gửi nhầm" bắt trần trụi, không phân biệt
//      nhận ẢNH với nhận HÀNG, gửi nhầm TIN NHẮN với gửi nhầm HÀNG.
//
// Đọc thẳng hàm ra khỏi mã nguồn rồi chạy — cùng lối với dinh_tuyen_hau_mai.test.js.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "bot_worker_api_v3.js"), "utf8");

function layHam(ten) {
  const i = SRC.indexOf("function " + ten + "(");
  assert.ok(i >= 0, `không thấy hàm ${ten} trong bot_worker_api_v3.js`);
  let sau = 0;
  for (let k = SRC.indexOf("{", i); k < SRC.length; k++) {
    if (SRC[k] === "{") sau++;
    else if (SRC[k] === "}" && --sau === 0) return SRC.slice(i, k + 1);
  }
  assert.fail(`không đóng được ngoặc của ${ten}`);
}
function layHang(dau) {
  const i = SRC.indexOf(dau);
  assert.ok(i >= 0, `không thấy dòng bắt đầu bằng "${dau}"`);
  return SRC.slice(i, SRC.indexOf("\n", i));
}

const scope = { botSentIds: new Set() };
new Function("s", "with (s) {"
  + layHang("const _RE_RECEIVED") + "\n"
  + layHang("const _RE_FITBAD") + "\n"
  + layHang("const _RE_VE_HANG") + "\n"
  + layHang("const _RE_VE_TIN") + "\n"
  + "let _psBangChung = null;\n"
  + layHam("_laBangChungHang") + "\n"
  + layHam("postSaleFitComplaint") + "\n"
  + " s.postSaleFitComplaint = postSaleFitComplaint; s._laBangChungHang = _laBangChungHang; }")(scope);
const { postSaleFitComplaint, _laBangChungHang } = scope;

const tin = (sender, text, i) => ({ sender, text, type: "text", messageId: "m" + i });

// --- CA THẬT ----------------------------------------------------------------
test("ca Hà Giang: hai câu của BOT không được ghép thành khiếu nại", () => {
  const ms = [
    tin("customer", "[Photo]", 1),
    tin("shop", "Dạ em nhận được ảnh của chị rồi ạ. Để tránh sai sót khi giao, chị nhắn giúp em địa chỉ bằng tin nhắn chữ ạ.", 2),
    tin("shop", "Dạ chị bỏ qua giúp em tin nhắn xin địa chỉ lúc nãy nhé, em gửi nhầm ạ.", 3),
    tin("customer", "mẫu này có size không ạ", 4),
  ];
  assert.strictEqual(postSaleFitComplaint(ms), false,
    "câu hỏi size của khách mới bị nuốt vào cổng hậu mãi vì hai câu của chính bot");
});

test("bot khởi động lại (botSentIds rỗng) cũng KHÔNG được đổi kết quả", () => {
  // Đây chính là chỗ thủng: botSentIds là bộ nhớ RAM. Chốt phải là `sender`.
  const ms = [
    tin("shop", "Dạ em nhận được ảnh của chị rồi ạ", 1),
    tin("shop", "Dạ em gửi nhầm ạ, chị bỏ qua tin nhắn lúc nãy nhé", 2),
  ];
  scope.botSentIds.clear();                       // giả lập vừa khởi động lại
  assert.strictEqual(postSaleFitComplaint(ms), false);
});

// --- VẪN PHẢI BẮT ĐƯỢC CA THẬT ---------------------------------------------
test("khách thật sự nhận hàng và kêu không vừa -> VẪN bắt (không được vá quá tay)", () => {
  const ms = [
    tin("customer", "chị nhận hàng rồi em ơi", 1),
    tin("customer", "váy chật quá em ạ, mặc không vừa", 2),
  ];
  assert.strictEqual(postSaleFitComplaint(ms), true,
    "vá xong mà bỏ sót ca hậu mãi thật thì bot sẽ chen vào giữa lúc người thật đang xử");
});

test("khách nhận hàng + kêu gửi sai mẫu -> VẪN bắt", () => {
  const ms = [
    tin("customer", "hàng về rồi nhưng shop gửi sai size", 1),
  ];
  assert.strictEqual(postSaleFitComplaint(ms), true);
});

// --- CHỈ MỘT NỬA TÍN HIỆU THÌ KHÔNG ĐỦ -------------------------------------
test("chỉ có 'nhận hàng' mà không kêu gì -> không phải khiếu nại", () => {
  assert.strictEqual(postSaleFitComplaint([tin("customer", "chị nhận hàng rồi nhé, cảm ơn em", 1)]), false);
});

test("khách hỏi TRƯỚC khi mua 'mặc có chật không' -> không phải khiếu nại", () => {
  assert.strictEqual(postSaleFitComplaint([tin("customer", "váy này mặc có chật không em", 1)]), false);
});

// --- PHÉP LỌC CHỮ NGHĨA -----------------------------------------------------
test("câu nói về ảnh/tin nhắn mà không nhắc hàng -> không tính là bằng chứng", () => {
  assert.strictEqual(_laBangChungHang("em nhận được ảnh của chị rồi ạ"), false);
  assert.strictEqual(_laBangChungHang("tin nhắn xin địa chỉ lúc nãy em gửi nhầm ạ"), false);
  assert.strictEqual(_laBangChungHang("em nhận được thông tin của chị rồi"), false);
});

test("câu có nhắc HÀNG thì vẫn tính, dù có kèm chữ ảnh/tin nhắn", () => {
  assert.strictEqual(_laBangChungHang("chị gửi ảnh cái váy shop gửi nhầm nè"), true);
  assert.strictEqual(_laBangChungHang("hàng về rồi nhưng chật quá"), true);
});
