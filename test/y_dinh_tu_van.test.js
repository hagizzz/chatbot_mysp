// ============================================================================
// test/y_dinh_tu_van.test.js — XIN TƯ VẤN KHÔNG PHẢI LÀ CHỐT ĐƠN
// ----------------------------------------------------------------------------
// Đo trên page THẬT ngày 24/08/2026. Khách gửi ảnh một mẫu MỚI kèm:
//     "tư vấn e mẫu này nữa"
// Bot đáp (sau khi báo giá + gửi ảnh, hai bước đó đúng):
//     "Em nhận được thông tin của chị rồi ạ, chị cho em xin thêm số điện thoại
//      để em lên đơn cho mình ạ"
// Khách chưa đưa thông tin gì để mà "nhận được", cũng chưa hề đồng ý mua.
//
// Gốc rễ nằm ở tầng đọc ý, không phải ở câu chữ:
//     [AI-READ] nhãn=ORDER_CLOSE | order=true
// Prompt có luật "lấy THÊM/đặt THÊM = muốn mua", nên chữ "nữa" kéo câu đi sai
// hướng dù động từ là "tư vấn". Gắn ORDER_CLOSE xong là rơi thẳng vào nhánh
// "khách đã cho contact -> xin nốt thông tin còn thiếu để lên đơn".
//
// Vá: dạy prompt rằng ĐỘNG TỪ quyết định, không phải chữ "nữa"/"thêm".
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "loi/ai/ai_intent.js"), "utf8");

test("prompt dạy rõ ĐỘNG TỪ quyết định, không phải chữ nữa/thêm", () => {
  assert.match(SRC, /ĐỘNG TỪ quyết định/,
    "thiếu luật phân biệt — chữ 'nữa' sẽ tiếp tục kéo câu tư vấn thành ý mua");
});

test('nêu đích danh câu đã gây lỗi ngoài thật', () => {
  // Ghi đúng câu đã đo được, để người sau biết luật này sinh ra từ ca nào.
  assert.ok(SRC.includes("tư vấn e mẫu này nữa"),
    "luật phải nêu đúng câu đã gây lỗi, không nói chung chung");
});

test("luật chốt wants_order=FALSE cho câu xin tư vấn", () => {
  const i = SRC.indexOf("ĐỘNG TỪ quyết định");
  const khuc = SRC.slice(i, i + 900);
  assert.match(khuc, /wants_order\s*=\s*FALSE/i,
    "phải nói thẳng wants_order=FALSE, nếu không nhánh chốt đơn vẫn bắt được");
  assert.match(khuc, /KHÔNG phải ORDER_CLOSE/,
    "phải cấm đích danh nhãn ORDER_CLOSE");
});

test("KHÔNG cấm nhầm câu THẬT SỰ muốn mua thêm", () => {
  // Nới tay quá thì "lấy thêm cái này nữa" cũng thành hỏi tư vấn -> mất đơn.
  const i = SRC.indexOf("ĐỘNG TỪ quyết định");
  const khuc = SRC.slice(i, i + 900);
  assert.match(khuc, /lấy thêm cái này nữa.*ADD_TO_ORDER/s,
    "luật phải giữ lại đường cho câu muốn mua thêm");
  assert.match(khuc, /lấy mẫu này.*ORDER_CLOSE/s,
    "luật phải giữ lại đường cho câu chốt mẫu");
});

test("ORDER_CLOSE và ADD_TO_ORDER vẫn là nhãn hợp lệ", () => {
  // Vá là THU HẸP lúc dùng, không phải bỏ nhãn.
  assert.match(SRC, /"ORDER_CLOSE"/);
  assert.match(SRC, /"ADD_TO_ORDER"/);
});

// --- Mở rộng 25/08: luật cũ neo quá chặt vào chữ "nữa" ----------------------
test('bắt được cả câu KHÔNG có chữ "nữa"', () => {
  // Ca đo được: "tư vấn cho mình những mẫu này với" + 3 ảnh -> vẫn bị đọc thành
  // ORDER_CLOSE -> bot đi xin SỐ NHÀ. Luật cũ chỉ nêu ví dụ có chữ "nữa".
  assert.ok(SRC.includes("tư vấn cho mình những mẫu này với"),
    "luật phải nêu đúng câu đã gây lỗi lần hai");
  assert.match(SRC, /XEM GIÚP|THAM KHẢO/,
    "phải liệt kê thêm động từ nhờ tư vấn khác");
});

test("ảnh mẫu MỚI chưa báo giá thì không bao giờ là chốt đơn", () => {
  assert.match(SRC, /chưa từng được báo giá mẫu đó => KHÔNG BAO GIỜ là ORDER_CLOSE/,
    "thiếu luật: gửi ảnh mẫu mới là hỏi giá, không phải chốt");
});

// --- Rào ở CODE, không chỉ dạy prompt ---------------------------------------
test("nhánh chốt đơn có rào mẫu-chưa-báo-giá và xin-tư-vấn", () => {
  const bot = fs.readFileSync(path.join(__dirname, "..", "bot_worker_api_v3.js"), "utf8");
  const i = bot.indexOf("[NHÃN AI] ORDER_CLOSE -> CODE đi tới CHỐT");
  assert.ok(i > 0, "không thấy nhánh chốt theo nhãn");
  const k = bot.slice(i, i + 3000);
  assert.match(k, /_mauMoiChuaBaoGia/, "thiếu rào mẫu chưa báo giá");
  assert.match(k, /_xinTuVan/, "thiếu rào khách xin tư vấn");
  assert.match(k, /&& !_mauMoiChuaBaoGia[\s\S]{0,80}&& !_xinTuVan/,
    "hai rào phải nằm TRONG điều kiện vào nhánh");
});

test("rào mẫu-chưa-báo-giá so theo pricedCodes, không đoán", () => {
  const bot = fs.readFileSync(path.join(__dirname, "..", "bot_worker_api_v3.js"), "utf8");
  const i = bot.indexOf("const _mauMoiChuaBaoGia");
  const k = bot.slice(i, i + 400);
  assert.match(k, /thisTurn/, "phải xét mẫu ra được TRONG LƯỢT NÀY");
  assert.match(k, /pricedCodes/, "phải so với sổ mẫu đã báo giá");
});
