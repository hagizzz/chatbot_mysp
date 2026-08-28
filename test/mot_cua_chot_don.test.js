// ============================================================================
// test/mot_cua_chot_don.test.js — MỌI ĐƯỜNG CHỐT ĐƠN ĐỀU QUA MỘT CỬA
// ----------------------------------------------------------------------------
// Ca Hà Giang 27/08/2026. Bước "đọc lại cho khách xác nhận" ban đầu chỉ bọc được
// nhánh AI-QUYẾT. Tám nhánh còn lại vẫn chốt thẳng, và một trong số đó cắn ngay:
//
//   Tin: "tư vấn e thêm mẫu này" + ảnh mẫu MỚI
//   [AI-READ]  nhãn=PRICE_ASK        <- khách HỎI GIÁ
//   [AI-QUYẾT] hành_động=TU_VAN      <- AI bảo TƯ VẤN
//   [GĐ4] Thêm 1 mẫu vào đơn đã chốt -> "Cảm ơn chị đã đặt hàng ... COD 1.915.000đ"
//
// Hai lỗi chồng nhau:
//   1. regex đoán ý khớp cụm "thêm mẫu" trong "tư vấn e THÊM MẪU này";
//   2. nhánh đó tự gửi tin chốt + tự gắn 182, không đi qua bước xác nhận.
//
// Vá regex thì còn sót nhánh khác. Nên dồn: sendOrderClose là CỬA DUY NHẤT phát
// tin chốt, và nó chỉ đọc lại đơn. Chỉ nhánh "khách gật" mới thật sự chốt.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "bot_worker_api_v3.js"), "utf8");

test("MỌI nơi gọi sendOrderClose đều có chốt chặn chờ-xác-nhận ngay sau", () => {
  const dong = SRC.split("\n");
  const goi = [];
  dong.forEach((l, i) => { if (/const \w+ = await sendOrderClose\(/.test(l)) goi.push(i); });
  assert.ok(goi.length >= 9, `phải còn đủ các nơi gọi, thấy ${goi.length}`);
  for (const i of goi) {
    const sau = dong.slice(i + 1, i + 5).join("\n");
    assert.match(sau, /if \(mem\._dangChoXacNhan\)/,
      `nơi gọi dòng ${i + 1} thiếu chốt chặn -> nhánh này lại chốt thẳng, không ai xác nhận`);
  }
});

test("sendOrderClose KHÔNG còn tự phát tin chốt", () => {
  const i = SRC.indexOf("async function sendOrderClose(");
  const j = SRC.indexOf("\n}", i);
  const k = SRC.slice(i, j);
  assert.ok(!k.includes("buildOrderConfirmation("),
    "còn dựng tin chốt trong cửa này là còn đường chốt không qua xác nhận");
  assert.ok(!k.includes("sendOrderCreatingWithImages("),
    'câu "đơn đang được tạo" không được nói khi mới chỉ đọc lại đơn');
  assert.match(k, /mem\.donChoXacNhan = \{/, "phải cất bản nháp để nhánh gật dùng lại");
  assert.match(k, /mem\._dangChoXacNhan = true;/, "phải báo nơi gọi biết là chưa chốt");
  assert.match(k, /buildDocLaiDon\(/, "phải đọc lại đơn cho khách");
});

test("chỉ nhánh KHÁCH GẬT mới gắn thẻ AI chốt", () => {
  // tagAiChot còn được gọi ở đâu thì chỗ đó phải nằm sau một chốt _dangChoXacNhan.
  const i = SRC.indexOf("Khách XÁC NHẬN bản đọc lại");
  assert.ok(i > 0, "không thấy nhánh khách gật");
  const truoc = SRC.slice(Math.max(0, i - 1200), i);
  assert.match(truoc, /await tagAiChot\(conversationId\);/, "nhánh gật phải là nơi gắn 182");
  assert.match(truoc, /mem\.orderClosed = true;/, "và là nơi đặt orderClosed");
});

test('"tư vấn e thêm mẫu này" KHÔNG được hiểu là thêm vào đơn', () => {
  const i = SRC.indexOf("const _addRo = _ai(\"ADD_TO_ORDER\");");
  assert.ok(i > 0, "không thấy chỗ tách 'AI nói rõ' với 'đoán theo chữ'");
  const k = SRC.slice(i, i + 1200);
  assert.match(k, /const _addIntent = _addRo \|\| \(_addDoan && _dongTuMua && !_aiNoiTuVan\);/,
    "đoán theo chữ phải kèm động từ mua VÀ không trái ý AI");
  assert.match(k, /_aiNoiTuVan = String\(\(mem\._aiQ && mem\._aiQ\.hanh_dong\) \|\| ""\) === "TU_VAN"/,
    "phải tôn trọng khi AI nói TU_VAN");
});

test("bản nháp để quên quá lâu thì bỏ, không lên đơn theo thứ khách đã quên", () => {
  const i = SRC.indexOf("mem.donChoXacNhan && Array.isArray(mem.donChoXacNhan.nhom)");
  assert.ok(i > 0, "không thấy nhánh xử bản nháp");
  assert.match(SRC.slice(i, i + 700), /6 \* 3600 \* 1000/, "thiếu hạn sống của bản nháp");
});
