// ============================================================================
// test/chong_trung.test.js — CHẶN BOT TỰ LẶP, NHƯNG ĐỪNG CHẶN CÂU TRẢ LỜI
// ----------------------------------------------------------------------------
// Sổ chống-trùng nhớ 5 câu gần nhất trong 10 phút, trùng trong 8 phút thì BỎ.
// Nó sinh ra để chặn bot TỰ nhắc lại một câu trong cùng mạch (ca Móm Yêu:
// "size M vừa xinh" bắn 2 lần).
//
// Đo trên page THẬT 24/08/2026 — nó chặn nhầm:
//     Khách : "đặt 2c này miễn ship cả 2 đúng k ạ"
//     Bot   : soạn đúng "Dạ mẫu này em miễn phí ship cho mình ạ"
//     Sổ    : ⛔ TRÙNG câu đã gửi 318s trước -> BỎ
//     Khách : KHÔNG NHẬN ĐƯỢC GÌ
// Và lặp lại mỗi vòng poll (318s, 328s...) nên hội thoại treo hẳn.
//
// Khách hỏi lại thì trả lời lại là ĐÚNG, dù câu trả lời tình cờ giống hệt.
// Vá: cho qua khi tin KHÁCH mới hơn lần gửi cũ.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "bot_worker_api_v3.js"), "utf8");

// Dựng lại đúng phép quyết định của bản vá, chạy được mà không cần cả lõi bot.
function coGui({ gapMs, lastCustAt, dupAt }) {
  const trung = gapMs < 8 * 60 * 1000;
  if (!trung) return true;
  const khachDaNhanLai = !!lastCustAt && lastCustAt > dupAt;
  return khachDaNhanLai;
}

test("bot TỰ lặp trong cùng lượt -> vẫn CHẶN (giữ nguyên ca Móm Yêu)", () => {
  const dupAt = 1000000;
  // Trong cùng một lượt, tin khách LUÔN cũ hơn lần bot gửi đầu tiên.
  assert.strictEqual(coGui({ gapMs: 5000, lastCustAt: dupAt - 3000, dupAt }), false);
});

test("khách nhắn lại sau đó -> PHẢI gửi, dù câu giống hệt", () => {
  const dupAt = 1000000;
  // Đúng ca đo được: câu cũ gửi 318s trước, khách vừa nhắn câu hỏi mới.
  assert.strictEqual(coGui({ gapMs: 318000, lastCustAt: dupAt + 300000, dupAt }), true);
});

test("quá 8 phút thì hết trùng, gửi bình thường", () => {
  const dupAt = 1000000;
  assert.strictEqual(coGui({ gapMs: 9 * 60 * 1000, lastCustAt: dupAt - 1000, dupAt }), true);
});

test("không biết mốc tin khách -> giữ hành vi CŨ là chặn", () => {
  // Thiếu dữ liệu thì phải nghiêng về an toàn: thà không nhắn còn hơn nhắn lặp.
  const dupAt = 1000000;
  assert.strictEqual(coGui({ gapMs: 5000, lastCustAt: null, dupAt }), false);
  assert.strictEqual(coGui({ gapMs: 5000, lastCustAt: 0, dupAt }), false);
});

// --- Canh bản vá còn nằm trong mã ------------------------------------------
test("mã có ngoại lệ 'khách đã nhắn lại' trong sổ chống-trùng", () => {
  const i = SRC.indexOf("TRÙNG câu đã gửi");
  assert.ok(i > 0, "không thấy sổ chống-trùng");
  const khuc = SRC.slice(Math.max(0, i - 1400), i + 600);
  assert.match(khuc, /_khachDaNhanLai/, "mất ngoại lệ -> câu trả lời cho câu hỏi mới lại bị nuốt");
  assert.match(khuc, /lastCustAt/, "ngoại lệ phải dựa trên mốc tin KHÁCH, không phải mốc khác");
});

test("ngoại lệ mặc định là CHẶN khi không đọc được mốc", () => {
  const i = SRC.indexOf("_khachDaNhanLai = false");
  assert.ok(i > 0, "phải khởi tạo false — lỗi đọc mốc thì giữ hành vi cũ");
});
