// ============================================================================
// test/go_the_tra_loi_ngay.test.js — GỠ THẺ XONG BOT PHẢI TRẢ LỜI NGAY
// ----------------------------------------------------------------------------
// Câu hỏi của shop 25/08/2026: "gỡ thẻ rồi thì bot có vào trả lời được liền không?"
//
// Đúng ra: gỡ thẻ -> vòng poll kế (≤4 giây) bot trả lời NGAY tin khách đang chờ,
// KHÔNG bắt khách nhắn lại.
//
// Nhưng có hai sổ nhớ "tin đã xử lý", và phải mở khoá CẢ HAI:
//   · processedMessageIds — sổ ĐĨA, sống qua restart
//   · _daXuLyLuotChay     — sổ RAM, thêm sáng 25/08 để chặn vòng lặp xử lại
//
// Đường cũ (dòng ~6231) chỉ xoá sổ đĩa, và chỉ chạy khi cờ botHandoffAt được đặt.
// Hai vấn đề:
//   1) không xoá sổ RAM -> cụm tin vẫn bị coi là "đã xử lượt này" -> bot im
//   2) hai nhánh gắn thẻ 184 CỐ Ý không đặt botHandoffAt (chỉ nhờ nhìn giúp một
//      tấm ảnh, không phải nhường cả hội thoại) -> đường cũ không bao giờ chạy
//
// Cả hai đều do thay đổi trong CHÍNH ngày 25/08 sinh ra — bắt được nhờ shop hỏi.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

function khoiNhanLai() {
  const i = SRC.indexOf("const _moKhoaCumCuoi");
  assert.ok(i > 0, "thiếu hàm mở khoá cụm tin cuối");
  return SRC.slice(i, i + 1600);
}

test("gỡ thẻ thì mở khoá cụm tin cuối, không bắt khách nhắn lại", () => {
  assert.match(SRC, /_moKhoaCumCuoi\(\)/, "chưa gọi hàm mở khoá");
  assert.ok((SRC.match(/_moKhoaCumCuoi\(\)/g) || []).length >= 2,
    "phải gọi ở CẢ HAI đường nhận lại: chế độ thường và chế độ siết");
});

test("mở khoá CẢ HAI sổ nhớ, không sót sổ nào", () => {
  const k = khoiNhanLai();
  assert.match(k, /processedMessageIds\.delete/, "thiếu xoá sổ đĩa");
  assert.match(k, /_daXuLyLuotChay\.delete/,
    "thiếu xoá sổ RAM -> gỡ thẻ xong bot vẫn im vì tưởng đã xử cụm này rồi");
  assert.match(k, /processingMessageIds\.delete/, "thiếu xoá sổ đang-xử");
});

test("KHÔNG phụ thuộc cờ botHandoffAt", () => {
  // Hai nhánh thẻ 184 cố ý không đặt cờ đó. Dựa vào nó là gỡ thẻ 184 xong bot
  // không bao giờ trả lời lại.
  const k = khoiNhanLai();
  assert.ok(!/botHandoffAt/.test(k),
    "hàm mở khoá không được dựa vào botHandoffAt");
});

test("chỉ mở khoá CỤM TIN CUỐI, không xoá cả sổ", () => {
  // Xoá sạch sổ là bot trả lời lại toàn bộ lịch sử hội thoại.
  const k = khoiNhanLai();
  assert.match(k, /getLastCustomerMessages/, "phải lấy đúng cụm tin khách cuối");
  assert.ok(!/\.clear\(\)/.test(k), "không được xoá sạch sổ");
});

test("ghi sổ đĩa xuống file sau khi mở khoá", () => {
  // Không ghi thì restart xong id lại nằm trong sổ, bot lại im.
  assert.match(khoiNhanLai(), /saveProcessed\(processedMessageIds\)/);
});

test("có log để truy khi bot vẫn im sau khi gỡ thẻ", () => {
  assert.match(khoiNhanLai(), /mở khoá .* tin khách cuối/,
    "thiếu log -> lần sau lại phải đọc mã mới biết vì sao bot im");
});
