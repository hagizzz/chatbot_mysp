// ============================================================================
// test/rao_cau_hoi.test.js — KHÁCH ĐANG HỎI THÌ PHẢI TRẢ LỜI, ĐỪNG XIN SĐT
// ----------------------------------------------------------------------------
// AI-QUYẾT chạy TRƯỚC dispatch ("[AI-QUYẾT ưu tiên] AI phát lệnh TRƯỚC dispatch
// -> luật cũ không chạy"). Nó quyết sai một lượt là khoá luôn toàn bộ nhánh cứng
// phía sau — kể cả nhánh BIẾT trả lời đúng câu khách hỏi.
//
// Rào `_cqAskKinds` sinh ra để chặn chuyện đó: nhãn nào là "khách đang HỎI" thì
// AI-QUYẾT đứng nhìn. Nhưng rào bị hai lỗi, phát hiện 24/08/2026:
//
//   1) 6/14 tên trong rào KHÔNG TỒN TẠI trong bộ nhãn của ai_intent.js —
//      ASK_COLOR, SHIP_FEE, SHIP_TIME, SHIP_ORIGIN, INSPECT_REQUEST,
//      TRYON_REQUEST (tàn dư tầng regex cũ). mem._aiIntent chỉ nhận nhãn từ
//      classifyIntent nên chúng không bao giờ khớp -> rào chỉ che 8 nhãn thật.
//
//   2) Hàng chục nhãn HỎI thật lọt qua. Đo được: "shop có cho kiểm hàng k ạ"
//      (DELIVERY_QA) -> AI phát XIN_SDT -> "em nhận được thông tin của chị rồi
//      ạ, cho em xin số điện thoại" trong khi bot CÓ SẴN câu trả lời đúng.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");

function nhanThat() {
  const src = fs.readFileSync(path.join(GOC, "loi/ai/ai_intent.js"), "utf8");
  const m = src.match(/const KINDS = \[([\s\S]*?)\n\];/);
  assert.ok(m, "không đọc được KINDS trong ai_intent.js");
  return [...m[1].matchAll(/"([A-Z_]+)"/g)].map(x => x[1]);
}

function nhanTrongRao() {
  const src = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");
  const i = src.indexOf("const _cqAskKinds = [");
  assert.ok(i > 0, "không thấy rào _cqAskKinds");
  const doan = src.slice(i, src.indexOf("];", i));
  return [...doan.matchAll(/"([A-Z_]+)"/g)].map(x => x[1]);
}

test("rào KHÔNG được chứa nhãn ma — tên không có trong ai_intent", () => {
  const that = new Set(nhanThat());
  const ma = nhanTrongRao().filter(k => !that.has(k));
  assert.deepStrictEqual(ma, [],
    `rào có ${ma.length} nhãn không tồn tại (${ma.join(", ")}) -> không bao giờ khớp, rào hở mà không ai biết`);
});

test("mấy nhãn HỎI đã gây lỗi thật phải nằm trong rào", () => {
  const rao = new Set(nhanTrongRao());
  // DELIVERY_QA là ca đo được ngày 24/08. Mấy nhãn còn lại cùng nhóm "khách hỏi
  // chính sách/sản phẩm" — cùng đường hỏng, chặn luôn một thể.
  for (const k of ["DELIVERY_QA", "RETURN_POLICY", "WASH_CARE", "STORE_ADDRESS",
                   "SIZE_ADVICE", "OCCASION_QA", "FIT_SUITABILITY", "AUTHENTICITY_QA"]) {
    assert.ok(rao.has(k), `thiếu "${k}" -> khách hỏi câu này sẽ bị dí xin số điện thoại`);
  }
});

test("nhãn khách CHO dữ liệu KHÔNG được nằm trong rào", () => {
  // Đây mới là lúc AI-QUYẾT phải làm việc. Nhét vào rào là bot không bao giờ
  // chốt được đơn.
  const rao = new Set(nhanTrongRao());
  for (const k of ["SIZE", "PHONE", "ADDRESS", "WEIGHT_HEIGHT", "ORDER_CLOSE", "ADD_TO_ORDER"]) {
    assert.ok(!rao.has(k), `"${k}" nằm trong rào -> AI-QUYẾT đứng nhìn cả lúc cần chốt đơn`);
  }
});

test("nhãn hậu mãi KHÔNG nằm trong rào này — đã có rào riêng", () => {
  const rao = new Set(nhanTrongRao());
  for (const k of ["EXCHANGE_REQUEST", "DEFECT_REPORT", "REFUND_REQUEST", "EDIT_ORDER", "CK_PROOF"]) {
    assert.ok(!rao.has(k), `"${k}" thuộc nhóm hậu mãi, đã có rào riêng bên dưới — để hai chỗ là loạn`);
  }
});

test("rào phủ được phần lớn nhãn HỎI, không phải vài cái lẻ", () => {
  // Lỗi cũ là rào quá hẹp (8 nhãn thật). Canh để không tụt lại như trước.
  assert.ok(nhanTrongRao().length >= 30,
    `rào chỉ có ${nhanTrongRao().length} nhãn — quá hẹp, nhãn hỏi khác sẽ lại lọt`);
});
