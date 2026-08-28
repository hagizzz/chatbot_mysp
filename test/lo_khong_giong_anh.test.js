// ============================================================================
// test/lo_khong_giong_anh.test.js — "MUA VỀ MÀ K GIỐNG ĐƯỢC THẾ THÌ SAO"
// ----------------------------------------------------------------------------
// Đo thật 27/08/2026 trên giả lập: câu "mua về mà k giống được thế thì sao shop"
// bị AI gắn nhãn SIZE_ADVICE (tin_cay 0.8), bot đáp:
//
//     "Chị yên tâm nha, mẫu này bên em có nhiều size.
//      Chị cho em xin chiều cao cân nặng để em tư vấn size vừa vặn chuẩn cho mình ạ."
//
// Khách lo HÌNH THỨC, bot trả lời chuyện SIZE. Kiểu sai khó thấy nhất: đọc qua
// vẫn tưởng bot "có trả lời". Ca thứ hai còn tệ hơn — hỏi thẳng khi chưa báo giá
// thì câu lo lắng bị nuốt hẳn, bot chỉ báo giá + xin số đo.
//
// Gốc: bộ nhãn không có chỗ cho tình huống này. Ba nhãn gần nhất đều lệch —
// AUTHENTICITY_QA hỏi về ẢNH, RETURN_POLICY hỏi về QUY ĐỊNH, còn khách thì hỏi
// "THÌ SAO" = tôi được bảo đảm gì. Nay có nhãn RISK_RECOURSE + khoá kịch bản
// lo_khong_giong_anh.
//
// Test đọc thẳng hàm ra khỏi mã nguồn vì bot_worker_api_v3.js là script liền
// khối không có module.exports.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

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
new Function("s", "with (s) { " + layHam("asksRiskRecourse")
  + "\n s.asksRiskRecourse = asksRiskRecourse; }")(scope);
const { asksRiskRecourse } = scope;

// --- Lưới đỡ regex: phải bắt được, kể cả khi AI gắn nhãn sai --------------
test("bắt đúng câu đã đo được ngoài thật", () => {
  assert.ok(asksRiskRecourse("mua về mà k giống được thế thì sao shop"));
});

test("bắt các cách nói khác của cùng nỗi lo", () => {
  for (const c of [
    "mua về không giống ảnh thì sao",
    "hàng về mà không đẹp như hình thì thế nào",
    "lỡ nhận hàng không ưng thì sao ạ",
    "nếu không giống hình thì tính sao shop",
    "mua ve ma khong giong the thi sao",     // không dấu
  ]) assert.ok(asksRiskRecourse(c), `trượt: "${c}"`);
});

// --- Chặn oan: đây mới là chỗ dễ hỏng ------------------------------------
// Bộ test chỉ có ca-bắt thì 100% xanh mà vẫn cướp lượt của nhánh khác. Lo SIZE
// phải ở lại nhánh SIZE (xin số đo), không được rơi vào đây.
test("lo KHÔNG VỪA là chuyện SIZE -> KHÔNG được nhận", () => {
  for (const c of [
    "lỡ mặc không vừa thì sao",
    "sợ không vừa thì sao ạ",
    "nhỡ chật quá thì sao",
    "mua về không vừa thì thế nào",
  ]) assert.ok(!asksRiskRecourse(c), `bắt oan: "${c}"`);
});

test("câu KHÔNG hỏi hậu quả -> KHÔNG nhận", () => {
  for (const c of [
    "ảnh này shop tự chụp à",          // AUTHENTICITY_QA
    "không ưng có được đổi không",     // RETURN_POLICY
    "mẫu này có giống hình không em",  // AUTHENTICITY_QA
    "váy này bao nhiêu tiền",
  ]) assert.ok(!asksRiskRecourse(c), `bắt oan: "${c}"`);
});

test('ranh giới từ theo Unicode: "k" trong chữ tiếng Việt không tính là từ "k"', () => {
  // \b của JS là ranh giới ASCII -> "khách giống ảnh" từng khớp nhầm vì sau "k"
  // là "h"... đây là ca canh cho lần sau ai đó đổi lại thành \b.
  assert.ok(!asksRiskRecourse("khách giống ảnh thì sao"));
});

// --- Nhãn phải được khai đủ chỗ ------------------------------------------
test("nhãn RISK_RECOURSE có trong ai_intent.js", () => {
  const ai = fs.readFileSync(path.join(GOC, "loi/ai/ai_intent.js"), "utf8");
  assert.ok(/"RISK_RECOURSE"/.test(ai), "thiếu trong danh sách KINDS");
  assert.ok(/RISK_RECOURSE\s*>\s*RETURN_POLICY/.test(ai),
    "thiếu trong thứ tự ưu tiên, hoặc đứng SAU RETURN_POLICY (phải đứng trước vì cụ thể hơn)");
  assert.ok(/mua về mà k giống được thế thì sao/.test(ai), "prompt thiếu ví dụ dạy AI");
});

test("nhãn được coi là CÂU HỎI, và AI-QUYẾT phải đứng ngoài để code trả lời", () => {
  assert.ok(/"RETURN_POLICY", "RISK_RECOURSE", "STORE_ADDRESS"/.test(SRC),
    "thiếu trong _ASK_KINDS_RIENG -> câu hỏi có thể bị đọc nhầm thành khách cho địa chỉ");
  assert.ok(/"RETURN_POLICY", "RISK_RECOURSE", "DELIVERY_QA"/.test(SRC),
    "thiếu trong danh sách nhãn AI-QUYẾT đứng nhìn -> AI-QUYẾT cướp lượt, nhánh này không chạy tới");
});

// --- Rào chốt đơn: ca NẶNG NHẤT, đo trên page thật -----------------------
// 27/08/2026 khách nhắn đúng câu này -> bot đáp bằng CÂU CHỐT ĐƠN đầy đủ
// ("Cảm ơn chị đã đặt hàng - COD 890.000đ - SĐT... - Địa chỉ..."), khách cãi
// "ủa chưa đặt mà đã chốt đâu" thì bot gửi câu chốt LẦN HAI.
// Hai rào cùng mù: isAskKind("SIZE_ADVICE")=false, looksLikeQuestion=false.
test("câu hỏi này KHÔNG được đọc thành 'khách cho địa chỉ để chốt'", () => {
  const i = SRC.indexOf("const _gaveContactNow");
  assert.ok(i >= 0, "không thấy rào _gaveContactNow");
  const dong = SRC.slice(i, SRC.indexOf(";", i));
  assert.ok(/asksRiskRecourse\(latestText\)/.test(dong),
    "rào chốt-theo-contact phải loại câu hỏi 'thì sao' — nếu không, một câu hỏi lại thành đơn hàng");
});

test("looksLikeQuestion vẫn mù với khuôn '... thì sao' -> rào thứ ba còn cần", () => {
  const s2 = {};
  new Function("s", "with (s) { " + layHam("looksLikeQuestion")
    + "\n s.looksLikeQuestion = looksLikeQuestion; }")(s2);
  assert.ok(!s2.looksLikeQuestion("mua về mà k giống được thế thì sao shop"),
    "looksLikeQuestion nay đã bắt được -> xem lại xem rào thứ ba còn cần không");
});

// SIZE_ADVICE là nhãn CÂU HỎI mà isAskKind từng trả false (không khớp khuôn tên
// *_QA/*_ASK/CHART/CONCERN, cũng không có trong danh sách riêng). Đó là gốc của
// sự cố chốt-đơn 27/08/2026. Không có test này thì ai đó dọn danh sách là lỗi về.
test("SIZE_ADVICE phải được isAskKind coi là CÂU HỎI", () => {
  const s3 = {};
  new Function("s", "with (s) { " + SRC.slice(SRC.indexOf("const _ASK_KINDS_RIENG"), SRC.indexOf("function looksLikeQuestion"))
    + "\n s.isAskKind = isAskKind; }")(s3);
  assert.ok(s3.isAskKind("SIZE_ADVICE"), "SIZE_ADVICE rơi ra ngoài rào -> câu hỏi size có thể bị chốt đơn");
  assert.ok(s3.isAskKind("RISK_RECOURSE"), "RISK_RECOURSE rơi ra ngoài rào");
  // Ca chặn oan: nhãn khách THẬT SỰ chốt đơn thì KHÔNG được coi là câu hỏi,
  // kẻo rào nuốt luôn đường chốt đơn thật.
  for (const k of ["ORDER_CLOSE", "ADDRESS", "PHONE", "SIZE"]) {
    assert.ok(!s3.isAskKind(k), `${k} bị coi nhầm là câu hỏi -> chặn oan đường chốt đơn`);
  }
});

// Cổng quảng cáo: khách hỏi ngay TIN ĐẦU. Cổng ads VẪN phải chạy (nó là chỗ giải
// ra mẫu từ adId — chặn nó thì reader quét 3 lần không ra mẫu rồi gắn người thật,
// mất cả giá lẫn ảnh lẫn câu trả lời; đã thử và đo được đúng như vậy). Cái phải bỏ
// là markProcessed — giữ lượt lại cho nhánh RISK_RECOURSE trả nốt.
test("cổng quảng cáo phải trả nốt câu 'thì sao' NGAY trong lượt", () => {
  assert.ok(/const _adRiskQ = asksRiskRecourse\(_adCustNow\)/.test(SRC), "thiếu khai _adRiskQ");
  const i = SRC.indexOf("await maybeSendSizeChart(conversationId, _adCustNow");
  assert.ok(i >= 0, "không thấy chỗ cổng ads trả nốt ý phụ");
  const sau = SRC.slice(i, i + 900);
  assert.ok(/if \(_adRiskQ\)/.test(sau) && /lo_khong_giong_anh/.test(sau),
    "cổng ads chưa trả câu quyền lợi -> khách hỏi ngay tin đầu từ ad sẽ không được trả lời");
});

// Đã ĐO: bỏ markProcessed rồi trông vào vòng sau là KHÔNG chạy — bot vừa nhắn nên
// hội thoại thành "shop nhắn cuối", bộ lọc danh sách loại ra, chờ 40s vẫn im.
test("vẫn đánh dấu opener xử-xong (không trông vào vòng quét sau)", () => {
  const i = SRC.indexOf("!isDeliveryTimeQuestion(_adCustNow)");
  assert.ok(i >= 0, "không thấy rào markProcessed của cổng ads");
  assert.ok(!/&& !_adRiskQ\)/.test(SRC.slice(i, i + 120)),
    "lại bỏ markProcessed cho _adRiskQ -> vòng sau không tới, khách không được trả lời");
});

test("KHÔNG chặn cổng ads bằng _adDontOpen (đã thử, hỏng nặng hơn)", () => {
  const i = SRC.indexOf("const _adDontOpen");
  assert.ok(i >= 0, "không thấy _adDontOpen");
  assert.ok(!/_adRiskQ/.test(SRC.slice(i, SRC.indexOf("\n", i))),
    "_adRiskQ quay lại _adDontOpen -> cổng ads không giải được mẫu -> bot gắn người thật, mất cả giá lẫn ảnh");
});

// --- Câu trả lời phải trả đúng thứ khách hỏi -----------------------------
test("kho kịch bản có khoá lo_khong_giong_anh, đủ ba ý", () => {
  const KB = require("../loi/cau_noi/kho_kich_ban");
  const ds = KB.cacCau("lo_khong_giong_anh");
  assert.ok(Array.isArray(ds) && ds.length >= 2, "cần ít nhất 2 biến thể để xoay vòng");
  for (const c of ds) {
    assert.ok(!/⟪/.test(c), `khoá hụt trong kho -> ${c}`);
    // (2) là ý quan trọng nhất: trả lời thẳng cho chữ "thì sao".
    assert.ok(/tự chụp/.test(c), `thiếu ý "ảnh thật shop tự chụp": ${c}`);
    assert.ok(/kiểm/.test(c) && /thanh toán|trả tiền/.test(c),
      `thiếu ý "được kiểm hàng trước khi thanh toán": ${c}`);
    assert.ok(/đổi/.test(c) && /15 ngày/.test(c), `thiếu ý "đổi trong 15 ngày": ${c}`);
  }
});

test("kho kịch bản vẫn hợp lệ sau khi thêm khoá", () => {
  const KB = require("../loi/cau_noi/kho_kich_ban");
  const kq = KB.kiemTra();
  assert.deepStrictEqual(kq.loi, [], "kich_ban/*.json có lỗi");
});
