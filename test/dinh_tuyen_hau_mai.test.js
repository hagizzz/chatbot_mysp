// ============================================================================
// test/dinh_tuyen_hau_mai.test.js — CỔNG HẬU MÃI KHÔNG ĐƯỢC NUỐT CÂU HỎI CHÍNH SÁCH
// ----------------------------------------------------------------------------
// Cổng HẬU MÃI chạy RẤT SỚM (ngay sau readConversation, trước toàn bộ định
// tuyến ý định). Nó gắn thẻ 183 rồi thoát, nên câu nào lọt vào đây là hết
// đường: bot không những không trả lời lượt này, mà thẻ giữ còn khiến nó đứng
// ngoài hội thoại đó vĩnh viễn.
//
// Đo được 24/08/2026 khi dò 14 câu hỏi thường gặp: "shop cho đổi trả trong bao
// lâu ạ" — một câu hỏi TRƯỚC khi mua — bị nuốt vào đây, dù
// buildReturnPolicyReply() có sẵn câu trả lời.
//
// Cách bắt: isReturnRefund("đổi trả") = true, mà isPolicyQuestion = false vì
// câu không có "có...không" cũng không có chữ "chính sách".
//
// Test này đọc thẳng hai hàm ra khỏi mã nguồn rồi chạy, vì bot_worker_api_v3.js
// là script liền khối không có module.exports.
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

const scope = {};
new Function("s", "with (s) { " + layHam("isPolicyQuestion") + "\n" + layHam("isReturnRefund")
  + "\n" + layHam("statedReturnAction")
  + "\n s.isPolicyQuestion = isPolicyQuestion; s.isReturnRefund = isReturnRefund;"
  + "\n s.statedReturnAction = statedReturnAction; }")(scope);
const { isPolicyQuestion, isReturnRefund, statedReturnAction } = scope;

// postSaleContext có NHIỀU vế; roiVaoHauMai bên dưới chỉ mô phỏng đúng vế :4864.
// Mấy ca "đã nhận hàng rồi đòi trả lại" bị vế statedReturnAction (:4863) bắt
// TRƯỚC, nên phải dựng phép thử đầy đủ mới kiểm được chúng.
const roiVaoHauMaiDayDu = c => statedReturnAction(c) || (isReturnRefund(c) && !isPolicyQuestion(c));

// Đúng phép thử mà cổng HẬU MÃI dùng: bắt chữ hoàn/trả mà KHÔNG phải hỏi chính sách.
const roiVaoHauMai = c => isReturnRefund(c) && !isPolicyQuestion(c);

test("hỏi THỜI HẠN đổi trả (chưa mua) -> KHÔNG được rơi vào cổng hậu mãi", () => {
  for (const c of [
    "shop cho đổi trả trong bao lâu ạ",
    "đổi trả trong mấy ngày em",
    "shop hỗ trợ đổi trả bao lâu",
    "thời hạn đổi hàng là bao nhiêu ngày",
    "được đổi trong vòng mấy hôm hả em"
  ]) {
    assert.strictEqual(roiVaoHauMai(c), false,
      `"${c}" bị cổng HẬU MÃI nuốt -> gắn thẻ 183 rồi im, dù có sẵn buildReturnPolicyReply()`);
  }
});

test("mấy vế hỏi chính sách CŨ vẫn nhận đúng như trước", () => {
  for (const c of [
    "có được đổi trả không em",
    "chính sách đổi trả thế nào",
    "quy định đổi trả ra sao",
    "shop có hỗ trợ đổi hàng không"
  ]) {
    assert.strictEqual(roiVaoHauMai(c), false, `"${c}" phải là câu hỏi chính sách`);
  }
});

test("HẬU MÃI THẬT vẫn phải nhường người thật — không được nới quá tay", () => {
  // Đây là vế nguy hiểm của bản vá: nới isPolicyQuestion rộng quá thì bot sẽ
  // đem chính sách ra trả lời một khách đang bức xúc vì hàng lỗi.
  for (const c of [
    "hàng bị lỗi, đổi trả thế nào giờ",
    "chị gửi hoàn hàng rồi nhé",
    "em muốn trả lại hàng, đã nhận rồi",
    "shop hoàn tiền cho chị đi"
  ]) {
    assert.strictEqual(roiVaoHauMai(c), true,
      `"${c}" là hậu mãi thật, PHẢI nhường người thật`);
  }
});

// ============================================================================
// [CA HÀ GIANG 27/08/2026] Lối lọt thứ hai của cùng cái cổng — VIẾT TẮT.
// Khách: "mua về thử k ưng shop cho đổi trả miễn phí k shop"
// Danh sách cũ có "không ưng|ko ưng|hông ưng" mà thiếu đúng "k ưng".
// Hậu quả không dừng ở một câu: chữ "đổi trả" nằm lại trong cửa sổ 5 tin mà
// postSaleContext quét, nên tin SAU đó ("dạo này em tăng lên 57kg rồi shop, có
// size...") cũng bị nuốt. Log ghi 132 lượt nhường người thật liên tiếp.
// ============================================================================
test("hỏi chính sách TRƯỚC KHI MUA, viết tắt -> KHÔNG được rơi vào cổng hậu mãi", () => {
  for (const c of [
    "mua về thử k ưng shop cho đổi trả miễn phí k shop",   // đúng câu gây lỗi
    "mua về k ưng có đổi được k",
    "mua về mà kg thích thì đổi trả sao ạ",
    "shop cho đổi trả miễn phí không",                      // viết đủ chữ cũng từng trượt
    "bên em có hỗ trợ đổi trả không ạ"
  ]) {
    assert.strictEqual(roiVaoHauMaiDayDu(c), false,
      `"${c}" bị cổng HẬU MÃI nuốt -> gắn 183 rồi im, và nuốt luôn mọi tin sau đó`);
  }
});

test("nới xong HẬU MÃI THẬT vẫn phải nhường người thật", () => {
  // Vế nguy hiểm của bản vá này. Ba lối lọt mới đều bị chặn bởi dấu hiệu ĐÃ NHẬN HÀNG.
  for (const c of [
    "hàng nhận rồi mà k ưng, cho chị đổi trả",      // có "k ưng" NHƯNG đã nhận hàng
    "shop hoàn tiền cho chị đi",                     // "shop ... cho" nhưng là ĐÒI hoàn
    "em vừa nhận hàng, mua về không ưng muốn trả lại",
    "hàng về rồi shop cho đổi trả nhé"
  ]) {
    assert.strictEqual(roiVaoHauMaiDayDu(c), true,
      `"${c}" là hậu mãi thật, PHẢI nhường người thật`);
  }
});
