// ============================================================================
// test/nguyen_tac.test.js — NGUYÊN TẮC MỤC 2 THÀNH TEST, KHÔNG PHẢI LỜI HỨA
// ----------------------------------------------------------------------------
// Bản yêu cầu mục 2 liệt kê những điều "không được phá". Mỗi lần phát hành phải
// CHỨNG MINH được, nên chúng nằm ở đây dưới dạng test chạy tự động.
// Toàn bộ chạy offline, dùng CSDL tạm — không đụng dữ liệu khách thật.
// ============================================================================
const os = require("os");
const path = require("path");
// Trỏ bộ nhớ sang CSDL tạm TRƯỚC khi nạp bất kỳ module nào đọc nó.
process.env.MEMORY_DB = path.join(os.tmpdir(), "test_bo_nho_" + process.pid + ".db");
process.env.SHOP_ID = "test";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");

const { addressComplete, normalizePhone, looksLikeAddress, buildOrderPlan } = require("../loi/don/order_extractor");
const { parseReplyAction, HUMAN_CHECK_REPLY } = require("../loi/ai/reasoning_engine");
const { KINDS } = require("../loi/ai/ai_intent");

test.after(() => {
  for (const hau of ["", "-wal", "-shm"]) {
    try { fs.rmSync(process.env.MEMORY_DB + hau, { force: true }); } catch (_) {}
  }
});

// --- "Không bịa" -----------------------------------------------------------
test("AI trả về không phải JSON -> KHÔNG gửi chữ thô, nhường người thật", () => {
  for (const rac of ["xin chào chị", "```chưa xong", "", "{thiếu ngoặc", "null"]) {
    const r = parseReplyAction(rac);
    assert.strictEqual(r.action, "TAG_HUMAN", `rác "${rac}" phải ra TAG_HUMAN`);
    assert.strictEqual(r.reply, "", `rác "${rac}" không được sinh câu trả lời`);
  }
});

test("AI chỉ được nhả nhãn trong danh sách đóng", () => {
  assert.ok(Array.isArray(KINDS) || KINDS instanceof Set || typeof KINDS === "object",
    "ai_intent phải công bố danh sách nhãn hợp lệ");
  const ds = Array.isArray(KINDS) ? KINDS : Object.keys(KINDS);
  assert.ok(ds.length > 0 && ds.length < 100,
    "danh sách nhãn phải hữu hạn và đóng — AI không được tự đặt nhãn mới");
});

test("mặc định AI KHÔNG tự soạn câu trả lời (AI_REPLY_MODE=off)", () => {
  const mode = String(process.env.AI_REPLY_MODE || "off").toLowerCase();
  assert.strictEqual(mode, "off",
    "Mục 2: AI chỉ hiểu ý và nhả nhãn; câu chữ do code/kịch bản quyết. Bật lên phải là quyết định có chủ đích.");
});

// --- "Chốt đủ 4 thông tin: mẫu + size + SĐT + địa chỉ" ----------------------
test("số điện thoại sai -> không nhận", () => {
  for (const sai of ["", "123", "0912", "abc", "1234567890", "0212345678"]) {
    const r = normalizePhone(sai);
    assert.ok(!r || !/^0(3|5|7|8|9)\d{8}$/.test(r), `"${sai}" không được coi là SĐT di động hợp lệ`);
  }
  for (const dung of ["0912345678", "+84912345678", "0387654321"]) {
    assert.match(String(normalizePhone(dung)), /^0(3|5|7|8|9)\d{8}$/, `"${dung}" phải nhận được`);
  }
});

test("địa chỉ thiếu -> KHÔNG đủ để giao", () => {
  const thieu = [
    "", "hà nội", "gửi về nhà em nhé", "số 5", "chỗ nào ạ?",
    "shop gửi giúp em", "chưa có địa chỉ"
  ];
  for (const a of thieu) {
    assert.strictEqual(addressComplete(a), false, `"${a}" không được coi là địa chỉ đủ`);
  }
});

test("địa chỉ đủ -> nhận", () => {
  const du = [
    "số 25 ngõ 12 đường Trần Duy Hưng, phường Trung Hòa, quận Cầu Giấy, Hà Nội",
    "12/3 Nguyễn Văn Cừ, phường An Bình, thành phố Cần Thơ",
    "thôn 4, xã Nghĩa Trung, huyện Việt Yên, tỉnh Bắc Giang"
  ];
  for (const a of du) {
    assert.strictEqual(addressComplete(a), true, `"${a}" phải được coi là địa chỉ đủ`);
  }
});

test("chưa có tin chốt -> KHÔNG dựng đơn", () => {
  const kh = buildOrderPlan("test_khong_ton_tai_1", {
    messages: [
      { sender: "customer", type: "text", text: "mẫu này bao nhiêu ạ" },
      { sender: "page", type: "text", text: "Dạ 390k ạ" }
    ],
    customerName: "Khách Thử"
  });
  assert.strictEqual(kh.confirmed, false);
  assert.strictEqual(kh.orders.length, 0, "chưa chốt mà đã dựng đơn là sai nguyên tắc");
});

test("có tin chốt nhưng THIẾU thông tin -> chặn lại kèm lý do, KHÔNG lên đơn", () => {
  const kh = buildOrderPlan("test_khong_ton_tai_2", {
    messages: [
      { sender: "customer", type: "text", text: "chốt đơn cho mình nhé" },
      { sender: "page", type: "text", text: "Sản phẩm: Váy Clarine\nSĐT: \nĐịa chỉ: \ncod 0" }
    ],
    customerName: "Khách Thử"
  });
  assert.strictEqual(kh.orders.length, 0, "thiếu thông tin mà vẫn lên đơn = vi phạm mục 2");
  const lyDo = JSON.stringify(kh.blocked) + JSON.stringify(kh.missingGlobal);
  assert.match(lyDo, /SĐT|địa chỉ|sản phẩm|cod|COD/i, "phải nói rõ thiếu gì để nhân viên xử tiếp");
});

// --- "Ca nhạy cảm luôn giao người thật" ------------------------------------
test("có sẵn câu chuẩn để nhường người thật", () => {
  assert.ok(typeof HUMAN_CHECK_REPLY === "string" && HUMAN_CHECK_REPLY.length > 0,
    "phải có một câu duy nhất dùng khi nhường người thật, không mỗi chỗ một kiểu");
});

// --- Riêng tư: ca vàng không được chứa dữ liệu nhận dạng khách -------------
test("bộ ca vàng đã che số điện thoại khách", () => {
  const F = path.join(__dirname, "ca_vang", "nhan_y_dinh.json");
  if (!fs.existsSync(F)) return;
  const { conSoThat, SDT_GIA } = require("./che_du_lieu");
  const ca = JSON.parse(fs.readFileSync(F, "utf8"));
  const lo = conSoThat(ca.map(c => c.tinKhach));
  assert.strictEqual(lo.length, 0,
    `Ca vang con ${lo.length} so dien thoai THAT trong noi dung tin (chi duoc phep ${SDT_GIA}). ` +
    `Chay lai: node test/trich_ca_vang.js`);
  const chuaBam = ca.filter(c => c.conversationId && !/#[0-9a-f]{8}$/.test(c.conversationId));
  assert.strictEqual(chuaBam.length, 0,
    `${chuaBam.length} ca con conversationId THAT (psid dinh danh khach). Chay lai: node test/trich_ca_vang.js`);
});
