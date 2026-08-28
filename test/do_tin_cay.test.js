// ============================================================================
// test/do_tin_cay.test.js — AI KHÔNG CHẮC THÌ PHẢI NHƯỜNG NGƯỜI THẬT
// ----------------------------------------------------------------------------
// Trước bản này: ai_intent.js chỉ trả nhãn, KHÔNG trả độ tin cậy. Nhãn đoán bừa
// và nhãn chắc chắn đi vào worker y như nhau -> chỉ khi AI lỗi/timeout code mới
// rơi về regex. Đo tay 45 ca thật trong test/ca_vang/nhan_y_dinh.json: 4 ca sai
// rõ (vd "c có hỏi set này đâu mà e tư vấn" -> OTHER thay vì COMPLAINT), toàn là
// câu cụt/mơ hồ — đúng loại câu AI tự biết mình không chắc.
//
// Nay AI tự chấm do_tin_cay (0..1). Dưới NGUONG_TIN_CAY (mặc định 0.6) -> worker
// gắn AI-CHỜ XL + im, giao người thật. Bộ này khoá 3 điều:
//   1. _safe kẹp điểm đúng, AI quên điền -> null (KHÔNG tự bịa 1 = tin bừa).
//   2. Prompt có dạy cách chấm + do_tin_cay nằm trong khuôn JSON.
//   3. Worker có mạng an toàn, đủ gác, và null thì KHÔNG chặn (giữ hành vi cũ).
//
//   node --test test/
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const { _safe } = require("../loi/ai/ai_intent");
const srcIntent = fs.readFileSync(path.join(GOC, "loi/ai/ai_intent.js"), "utf8");
const srcWorker = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

// ---- 1. _safe kẹp điểm --------------------------------------------------
test("_safe giữ nguyên điểm hợp lệ", () => {
  assert.strictEqual(_safe({ kind: "PRICE_ASK", do_tin_cay: 0.85 }).do_tin_cay, 0.85);
  assert.strictEqual(_safe({ kind: "OTHER", do_tin_cay: 0 }).do_tin_cay, 0);
});

test("_safe kẹp điểm ngoài khoảng về [0,1]", () => {
  assert.strictEqual(_safe({ kind: "PRICE_ASK", do_tin_cay: 5 }).do_tin_cay, 1);
  assert.strictEqual(_safe({ kind: "PRICE_ASK", do_tin_cay: -2 }).do_tin_cay, 0);
});

test("AI quên điền / trả chữ -> null, KHÔNG tự bịa 1", () => {
  assert.strictEqual(_safe({ kind: "PRICE_ASK" }).do_tin_cay, null,
    "thiếu điểm mà mặc định 1 thì mạng an toàn không bao giờ kích");
  assert.strictEqual(_safe({ kind: "PRICE_ASK", do_tin_cay: "cao" }).do_tin_cay, null);
  assert.strictEqual(_safe({ kind: "PRICE_ASK", do_tin_cay: null }).do_tin_cay, null);
});

test("do_tin_cay không làm hỏng các trường cũ", () => {
  const r = _safe({ kind: "SIZE", size: "l", concern: "mong", do_tin_cay: 0.9 });
  assert.strictEqual(r.kind, "SIZE");
  assert.strictEqual(r.size, "L");
  assert.strictEqual(r.concern, "mong");
  assert.strictEqual(r.ok, true);
});

// ---- 2. Prompt ------------------------------------------------------------
test("khuôn JSON có ô do_tin_cay", () => {
  assert.ok(/"do_tin_cay":/.test(srcIntent),
    "không khai trong khuôn JSON thì AI không biết đường trả");
});

test("prompt DẠY cách chấm, không chỉ nêu tên trường", () => {
  assert.ok(/ĐỘ TIN CẬY \(do_tin_cay\)/.test(srcIntent), "thiếu mục dạy chấm điểm");
  assert.ok(/KHÔNG được mặc định 1/.test(srcIntent),
    "không cấm thì model có thói quen trả 1 cho mọi câu -> ngưỡng vô nghĩa");
  assert.ok(/OTHER" luôn <= 0\.4/.test(srcIntent),
    "OTHER = không hiểu ý khách, phải kéo điểm xuống");
});

// ---- 3. Mạng an toàn trong worker ----------------------------------------
function khoiNguong() {
  const i = srcWorker.indexOf("const _nguongTC = Number(process.env.NGUONG_TIN_CAY");
  assert.ok(i > 0, "không thấy mạng an toàn ngưỡng tin cậy trong bot_worker_api_v3.js");
  return srcWorker.slice(i, i + 1600);
}

test("ngưỡng đọc từ env NGUONG_TIN_CAY, mặc định 0.6", () => {
  assert.ok(/process\.env\.NGUONG_TIN_CAY \|\| 0\.6/.test(khoiNguong()),
    "phải chỉnh được ngưỡng bằng env mà không phải sửa code");
});

test("dưới ngưỡng thì GẮN THẺ NGƯỜI THẬT + IM, không trả lời khách", () => {
  const k = khoiNguong();
  assert.ok(/_tinCay < _nguongTC/.test(k), "thiếu phép so với ngưỡng");
  assert.ok(/tagChoXuLyVaUnread\(conversationId\)/.test(k), "phải gắn AI-CHỜ XL + chuyển CHƯA ĐỌC");
  assert.ok(/markProcessed\(batch\); return true;/.test(k), "phải dừng lượt, không chảy xuống nhánh đoán");
  assert.ok(!/sendInboxMessage/.test(k), "giao người thật là IM LẶNG, không nhắn gì cho khách");
});

test("AI không chấm điểm (null) thì KHÔNG chặn — giữ nguyên hành vi cũ", () => {
  assert.ok(/typeof _tinCay === "number"/.test(khoiNguong()),
    "thiếu rào này thì null bị so sánh thành 0 < 0.6 -> giao người thật MỌI lượt");
});

test("đủ gác: ack/xã giao, tín hiệu tiền-đơn, đã chốt đơn, người thật đang xử", () => {
  const k = khoiNguong();
  for (const gac of ["_tcAckLike", "_tcOrderSignal", "mem.orderClosed", "humanInbox"]) {
    assert.ok(k.includes("!" + gac), `thiếu gác ${gac} -> chặn nhầm lượt code vốn xử chắc tay`);
  }
});

test("điểm được reset mỗi lượt, không dính điểm lượt trước", () => {
  assert.ok(/mem\._aiTinCay = null;/.test(srcWorker), "thiếu reset _aiTinCay đầu lượt");
  assert.ok(/mem\._aiTinCay = \(typeof _lab\.do_tin_cay === "number"\)/.test(srcWorker),
    "thiếu chỗ nạp điểm AI vừa chấm");
});

test("log AI-READ in ra điểm để soi ngoài thật", () => {
  assert.ok(/tin_cay=\$\{_lab\.do_tin_cay/.test(srcWorker),
    "không log điểm thì không đo được ngưỡng đặt cao hay thấp");
});
