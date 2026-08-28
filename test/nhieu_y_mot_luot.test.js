// ============================================================================
// test/nhieu_y_mot_luot.test.js — MỘT LƯỢT NHIỀU Ý, MỖI Ý MỘT TIN
// ----------------------------------------------------------------------------
// Ca Hà Giang 27/08/2026. Khách nhắn hai tin liền nhau:
//     "mua về thử k ưng shop cho đổi trả miễn phí k shop"
//     "dạo này em tăng lên 57kg rồi shop, có size lớn hơn cho e k ạ"
// Hai tin bị gộp thành MỘT chuỗi rồi chạy qua dây 212 nhánh khớp-trước-thắng.
// Nhánh chính-sách-đổi khớp trước, trả lời xong là markProcessed(batch) + return
// -> câu size KHÔNG bị hoãn mà mất hẳn (vòng poll sau in "không còn tin MỚI").
//
// Cách vá: KHÔNG đụng 212 nhánh. Cắt lượt thành hai ý ngay từ đầu, vòng một chỉ
// thấy ý 1, vòng hai chạy lại đúng ý 2 và gửi thành TIN RIÊNG.
//
// Chỗ nguy hiểm là cắt QUÁ TAY: gộp tin là hành vi cố ý ("váy này" + "bao nhiêu
// tiền" là MỘT ý). Nửa dưới của tệp này canh đúng chuyện đó.
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
const CAN = ["looksLikeQuestion", "_chuDeCuaY", "tachYTrongLuot",
             "isReturnRefund", "asksReturnPolicy", "asksExchangeIfNotLike", "wantsImages"];
const scope = {};
new Function("s", "with (s) { " + CAN.map(layHam).join("\n") + "\n"
  + CAN.map(n => `s.${n} = ${n};`).join(" ") + " }")(scope);
const { tachYTrongLuot, _chuDeCuaY } = scope;

const tin = (...ts) => ts.map(t => ({ type: "text", text: t }));

// --- 1. Ca gây lỗi: phải cắt --------------------------------------------

test("hai tin khác chủ đề -> cắt thành 2 ý", () => {
  const ys = tachYTrongLuot(tin(
    "mua về thử k ưng shop cho đổi trả miễn phí k shop",
    "dạo này em tăng lên 57kg rồi shop, có size lớn hơn cho e k ạ"));
  assert.strictEqual(ys.length, 2, "không cắt -> câu size lại mất như cũ");
  assert.match(ys[0], /đổi trả/);
  assert.match(ys[1], /size lớn hơn/);
});

test("đọc đúng chủ đề của từng ý", () => {
  assert.strictEqual(_chuDeCuaY("mua về thử k ưng shop cho đổi trả miễn phí k shop"), "chinh_sach");
  assert.strictEqual(_chuDeCuaY("dạo này em tăng lên 57kg rồi shop, có size lớn hơn cho e k ạ"), "size");
});

// --- 2. KHÔNG được cắt quá tay ------------------------------------------

test("một ý gõ làm hai tin -> KHÔNG cắt", () => {
  // "váy này" không có chủ đề rõ -> phần đầu mờ nghĩa, cắt ra là hỏng cả hai vế.
  assert.deepStrictEqual(tachYTrongLuot(tin("váy này", "bao nhiêu tiền")), []);
});

test("tin cuối là BỔ NGỮ (không phải câu hỏi) -> KHÔNG cắt", () => {
  // "màu hồng nha" là bổ ngữ cho "cho e xin ảnh", cắt ra thành hai câu trả lời là loạn.
  assert.deepStrictEqual(tachYTrongLuot(tin("cho e xin ảnh", "màu hồng nha")), []);
  assert.deepStrictEqual(tachYTrongLuot(tin("mẫu này còn size M k", "ok chị lấy size M")), []);
});

test("hai tin CÙNG chủ đề -> KHÔNG cắt (tránh trả lời đúp)", () => {
  assert.deepStrictEqual(tachYTrongLuot(tin("còn size M k shop", "size M còn hàng không ạ")), []);
});

test("một tin duy nhất -> không có gì để cắt", () => {
  assert.deepStrictEqual(tachYTrongLuot(tin("có size lớn hơn k ạ")), []);
  assert.deepStrictEqual(tachYTrongLuot([]), []);
});

test("từ 3 tin trở lên -> cắt ĐÚNG MỘT nhát (trần 2 vòng)", () => {
  const ys = tachYTrongLuot(tin("set này đẹp quá", "giá bao nhiêu v shop", "có size lớn hơn k ạ"));
  assert.strictEqual(ys.length, 2, "phải luôn ra đúng 2 ý, không đẻ thêm vòng");
  assert.match(ys[0], /giá bao nhiêu/, "phần đầu gộp lại làm ý 1");
});

// --- 3. Đường dây hai vòng phải còn nguyên -------------------------------

test("vòng gọi có chạy thêm lượt cho ý còn lại", () => {
  const i = SRC.indexOf("ok = await processOneConversation(conv);");
  assert.ok(i > 0, "không thấy chỗ gọi vòng một");
  const sau = SRC.slice(i, i + 900);
  assert.match(sau, /_Y_CON_LAI\.get\(String\(conv\.id\)\)/, "không đọc ý còn lại thì vòng hai không bao giờ chạy");
  assert.match(sau, /_Y_CON_LAI\.delete\(String\(conv\.id\)\)/, "không xoá -> ý cũ vắt sang lượt sau");
  assert.match(sau, /if \(ok && _yCon\) await processOneConversation\(conv, _yCon\)/,
    "vòng hai phải chạy, và CHỈ khi vòng một đã trả lời thật");
});

test("vòng ép ý được bỏ qua ba cổng vốn chặn nó", () => {
  // Cả ba cổng đều đúng cho lượt thường, nhưng lượt ép ý thì tin đã bị đánh dấu
  // xử lý ở vòng một -> không bỏ qua là vòng hai chết ngay tại cửa.
  assert.match(SRC, /if \(!_epY && !batchNew\.length\) \{/, "cổng 'không còn tin MỚI'");
  assert.match(SRC, /if \(!_epY && !_unreadCustomerWaiting && hasProcessed\(batch\)\) return false;/, "cổng hasProcessed");
  assert.match(SRC, /if \(!_epY && _shopReplyAfter\) \{/, "cổng 'shop đã trả lời sau tin khách'");
});

test("lượt KHÔNG cắt thì phải xoá ý cũ trong sổ", () => {
  assert.match(SRC, /_Y_CON_LAI\.delete\(String\(conversationId\)\);/,
    "không xoá -> lượt sau bị chèn một câu trả lời lạc lõng của lượt trước");
});
