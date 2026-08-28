// ============================================================================
// test/hoi_khong_phai_chot.test.js — CÂU HỎI KHÔNG BAO GIỜ ĐƯỢC THÀNH ĐƠN
// ----------------------------------------------------------------------------
// Đo trên page PHOM 26/08/2026, khách Hà Giang:
//   14:33:25 khách: "nhìn vải hơi mỏng nhỉ, mặc lên có sợ bị lộ khuyết điểm k shop"
//   14:33:42 bot  : "Đơn hàng của mình đang được tạo trên hệ thống"
//   14:33:51 bot  : "Cảm ơn chị đã đặt hàng - Váy Tatiana đỏ M - COD 1.290.000đ"
//                   + gắn thẻ 182 (tín hiệu cho order_worker LÊN ĐƠN THẬT)
//
// Ba lỗ cùng lúc:
//   1. AI phất nhầm is_address cho một câu hỏi chất liệu
//   2. HAI danh sách "nhãn là câu hỏi" viết tay ở hai cổng, KHÁC nhau, cả hai
//      đều thiếu MATERIAL_QA (bản ở cổng chốt còn thiếu cả COLOR_ASK)
//   3. looksLikeQuestion không nhận "k" = "không", và cửa sổ .{0,20} hụt
//      đúng một ký tự so với câu thật
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

// Rút CHÍNH hàm trong mã ra chạy thật — chép lại là test bản sao.
function rutHam(ten) {
  const i = SRC.indexOf("function " + ten + "(");
  assert.ok(i > 0, "không thấy hàm " + ten);
  return SRC.slice(i, SRC.indexOf("\n}", i) + 2);
}
const looksLikeQuestion = eval("(" + rutHam("looksLikeQuestion") + ")");

test("câu hỏi chất liệu ngoài đời thật phải được nhận là CÂU HỎI", () => {
  assert.ok(looksLikeQuestion("nhìn vải hơi mỏng nhỉ, mặc lên có sợ bị lộ khuyết điểm k shop"),
    "đúng câu đã làm bot chốt nhầm đơn 1.290.000đ");
});

test('"k" viết tắt của "không" phải được hiểu', () => {
  assert.ok(looksLikeQuestion("vải có dày k shop"));
  assert.ok(looksLikeQuestion("có ship cod k ạ"));
  assert.ok(looksLikeQuestion("còn hàng k"));
});

test("địa chỉ THẬT vẫn KHÔNG được coi là câu hỏi", () => {
  // Nới tay quá thì địa chỉ hoá câu hỏi -> bot không bao giờ chốt được đơn.
  for (const c of [
    "118 Khương Thượng, Đống Đa, Hà Nội",
    "số nhà 12 ngõ 5 Khương Thượng, Đống Đa",
    "em ở 188 khương thượng đống đa hà nội nhé",
    "ship cho mình 2 kg nhé",
    "ok chị lấy mẫu này",
  ]) assert.ok(!looksLikeQuestion(c), `"${c}" bị coi nhầm là câu hỏi`);
});

test("MỘT hàm isAskKind duy nhất, hai cổng cùng gọi", () => {
  assert.match(SRC, /function isAskKind\(kind\)/, "thiếu hàm chung");
  assert.match(SRC, /const _isAskLabel = isAskKind\(_lab\.kind\);/,
    "cổng địa-chỉ không dùng hàm chung");
  assert.match(SRC, /const _isAskLabelClose = isAskKind\(mem\._aiIntent\);/,
    "cổng chốt-đơn không dùng hàm chung");
  assert.ok(!/_askKinds\s*=\s*\[/.test(SRC),
    "vẫn còn danh sách nhãn viết tay — đây chính là chỗ đẻ ra lỗi lần này");
});

test("isAskKind nhận nhãn theo KHUÔN TÊN, không liệt kê tay", () => {
  const isAskKind = eval("(" + rutHam("isAskKind").replace(
    /return _ASK_KINDS_RIENG\.has\(k\);/, "return false;") + ")");
  for (const n of ["MATERIAL_QA", "POLICY_QA", "DELIVERY_QA", "OCCASION_QA",
                   "PRICE_ASK", "COLOR_ASK", "ASK_COLOR", "SIZE_CHART", "QUALITY_CONCERN"]) {
    assert.ok(isAskKind(n), `nhãn ${n} phải được coi là câu hỏi`);
  }
  for (const n of ["ADDRESS", "PHONE", "ORDER_CLOSE"]) {
    assert.ok(!isAskKind(n), `nhãn ${n} KHÔNG được coi là câu hỏi`);
  }
});
