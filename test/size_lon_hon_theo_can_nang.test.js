// ============================================================================
// test/size_lon_hon_theo_can_nang.test.js — XIN SIZE LỚN HƠN THÌ TRA BẢNG CÂN NẶNG
// ----------------------------------------------------------------------------
// Ca Hà Giang 27/08/2026: "dạo này em tăng lên 57kg rồi shop, có size lớn hơn
// cho e k ạ" -> bot đáp "mẫu này có size L". ĐÚNG đáp án, nhưng đúng do TAI NẠN:
//
//   asksWhichSpecificSize khớp /\b(?:size|sz)\s*(...|s|m|l)\b/ trên chữ "size lớn"
//   -> bắt được "l", vì \b sau "l" khớp ("ớ" là ký tự ngoài ASCII).
//
// Hệ quả: con số 57kg không được dùng lần nào, còn "size to hơn" / "size rộng
// hơn" thì trượt sạch. Bảng cân nặng thì nằm sẵn trong kịch bản và ghi rõ đúng
// ca này (kich_ban/mysp.json -> bang_can_nang_size):
//   "Vùng chồng 56-57kg thuộc cả M lẫn L -> L đứng trước nên được chọn khi còn hàng."
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
const CAN = ["hoiSizeKhac", "asksWhichSpecificSize"];
const scope = {};
new Function("s", "with (s) { " + CAN.map(layHam).join("\n") + "\n"
  + CAN.map(n => `s.${n} = ${n};`).join(" ") + " }")(scope);
const { hoiSizeKhac, asksWhichSpecificSize } = scope;

test('"size lớn" KHÔNG còn bị đọc thành size L', () => {
  assert.strictEqual(asksWhichSpecificSize("có size lớn hơn cho e k ạ"), null,
    'đọc "size lớn" thành size L là ăn may — đúng đáp án bằng đường sai');
});

test("hỏi tên size CỤ THỂ thì vẫn nhận đúng như trước", () => {
  assert.strictEqual(asksWhichSpecificSize("có size L ko shop"), "L");
  assert.strictEqual(asksWhichSpecificSize("còn size xl không ạ"), "XL");
  assert.strictEqual(asksWhichSpecificSize("bên mình có freesize k"), "FREESIZE");
});

test("bắt được xin size LỚN HƠN, đủ mấy cách nói", () => {
  for (const c of [
    "dạo này em tăng lên 57kg rồi shop, có size lớn hơn cho e k ạ",
    "có size to hơn không shop",
    "có size rộng hơn k",
    "shop có size bự hơn không ạ"
  ]) assert.strictEqual(hoiSizeKhac(c), "lon", `trượt: "${c}"`);
});

test("bắt được xin size NHỎ HƠN", () => {
  for (const c of ["có size nhỏ hơn k ạ", "size bé hơn không shop", "có size ôm hơn k"])
    assert.strictEqual(hoiSizeKhac(c), "nho", `trượt: "${c}"`);
});

test("câu KHÔNG xin đổi cỡ -> không bắt bừa", () => {
  for (const c of ["set này bao nhiêu tiền", "có size L ko shop", "cho e xin ảnh màu hồng"])
    assert.strictEqual(hoiSizeKhac(c), null, `bắt bừa: "${c}"`);
});

test("nhánh trả lời phải TRA BẢNG CÂN NẶNG, không đoán", () => {
  const i = SRC.indexOf("KHÁCH XIN SIZE LỚN HƠN / NHỎ HƠN");
  assert.ok(i > 0, "không thấy nhánh xin size lớn/nhỏ hơn");
  const k = SRC.slice(i, i + 3000);
  assert.match(k, /parseWeightKg\(latestText\) \|\| mem\.weightKg/, "phải lấy cân nặng của lượt này, hoặc cân đã biết");
  assert.match(k, /resolveSizeByWeight\(_kg, productInfo\.size\)/, "phải tra bảng cân nặng của kịch bản");
  assert.match(k, /noFitReply\(_kg\)/, "vượt tầm size phải dùng câu 'không vừa' sẵn có, không ép size sai");
  assert.match(k, /em lên đơn size \$\{_sz\} cho mình luôn nha chị/, "biết size rồi thì phải mời chốt");
});

test("chưa biết cân nặng thì KHÔNG đoán size", () => {
  const i = SRC.indexOf("KHÁCH XIN SIZE LỚN HƠN / NHỎ HƠN");
  const k = SRC.slice(i, i + 3000);
  assert.match(k, /Chị cho em xin chiều cao và cân nặng/, "không có cân nặng -> xin số đo, đừng phán bừa");
});

test("nhánh mới đứng TRƯỚC nhánh hỏi-1-size-cụ-thể", () => {
  const iMoi = SRC.indexOf("KHÁCH XIN SIZE LỚN HƠN / NHỎ HƠN");
  const iCu  = SRC.indexOf("KHÁCH HỎI CÓ 1 SIZE CỤ THỂ KHÔNG");
  assert.ok(iMoi > 0 && iCu > iMoi, "đứng sau thì nhánh cũ lại nuốt trước, vá thành vô nghĩa");
});
