// ============================================================================
// test/phi_doi_tra_nhuong_nv.test.js — HỎI PHÍ ĐỔI TRẢ: TRẢ PHẦN CÓ, GIAO PHẦN THIẾU
// ----------------------------------------------------------------------------
// Khách hỏi "shop cho đổi trả MIỄN PHÍ k". Kịch bản khai được hai phần ba câu:
//   kich_ban/luat.txt:163  đổi trong 15 ngày, chưa qua sử dụng, còn nguyên tem mác
//   kich_ban/luat.txt:164  không hoàn hàng, trừ khi lỗi shop
// Còn AI CHỊU PHÍ gửi hàng về thì KHÔNG dòng nào khai. (Dòng freeship :162 là phí
// ship GIAO ĐƠN trên 500k, không liên quan tới đổi.)
//
// Bot đoán khoản này = hứa sai TIỀN với khách. Nên luật là: trả phần có dữ liệu,
// nói thẳng phần phí nhờ nhân viên xác nhận, rồi gắn thẻ cho người thật vào chốt.
// Im lặng bỏ qua vế "miễn phí" cũng không được — khách sẽ hỏi lại.
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
const scope = {};
new Function("s", "with (s) { " + layHam("hoiPhiDoiTra") + "\n s.hoiPhiDoiTra = hoiPhiDoiTra; }")(scope);
const { hoiPhiDoiTra } = scope;

test("nhận ra khách đang hỏi PHÍ đổi/trả", () => {
  for (const c of [
    "mua về thử k ưng shop cho đổi trả miễn phí k shop",   // đúng câu gây ra việc này
    "đổi hàng có mất phí không ạ",
    "trả hàng thì ai chịu phí ship",
    "đổi size có tốn tiền k shop",
    "shop cho đổi free không"
  ]) assert.strictEqual(hoiPhiDoiTra(c), true, `trượt: "${c}"`);
});

test("hỏi chính sách đổi mà KHÔNG hỏi phí -> không gắn thẻ oan", () => {
  // Mấy câu này bot trả trọn vẹn được, kéo nhân viên vào là phiền người ta.
  for (const c of [
    "shop cho đổi trả trong bao lâu ạ",
    "có được đổi size không em",
    "chính sách đổi trả thế nào"
  ]) assert.strictEqual(hoiPhiDoiTra(c), false, `bắt bừa: "${c}"`);
});

test("câu KHÔNG dính đổi/trả thì phí ship giao hàng không tính", () => {
  assert.strictEqual(hoiPhiDoiTra("ship về Hà Nội mất phí bao nhiêu"), false);
  assert.strictEqual(hoiPhiDoiTra("đơn này có miễn phí ship không"), false);
});

test("cả BA nhánh trả chính sách đều phải giao phần phí cho nhân viên", () => {
  const n = SRC.split("if (_phi) await nhuongNVChotPhiDoiTra(conversationId, mem);").length - 1;
  assert.strictEqual(n, 3,
    "có 3 nhánh trả chính sách đổi/trả (a2, b, RETURN_POLICY) — sót nhánh nào là khách hỏi phí ở đó bị nuốt");
});

test("phần phí được nói RA với khách, không im lặng bỏ qua", () => {
  const n = SRC.split('_phi ? " " + cauPhiDoiTra() : ""').length - 1
          + SRC.split('_phi ? ". " + cauPhiDoiTra() : ""').length - 1;
  assert.strictEqual(n, 3, "cả 3 nhánh phải chèn câu về phí vào chính câu trả lời");
});

test("câu về phí nằm trong KHO KỊCH BẢN, không viết cứng trong mã", () => {
  // kho_kich_ban.js: "MỌI câu đều có KHOÁ". Viết cứng thì shop muốn đổi lời phải
  // mở mã — đúng thứ cái kho sinh ra để tránh.
  const kho = JSON.parse(fs.readFileSync(path.join(GOC, "kich_ban", "mac_dinh.json"), "utf8"));
  const muc = kho.cau["doi_tra__phi_nho_nhan_vien"];
  assert.ok(muc && muc.cau, "thiếu khoá doi_tra__phi_nho_nhan_vien trong kho");
  assert.match(muc.cau, /phí đổi/, "câu phải nói tới phí đổi");
  assert.match(SRC, /function cauPhiDoiTra\(\) \{ return KB\.cau\("doi_tra__phi_nho_nhan_vien"\); \}/,
    "mã phải tra kho, không giữ bản sao chuỗi");
});

test("giao nhân viên = gắn thẻ + đánh dấu chưa đọc, không chỉ ghi log", () => {
  const i = SRC.indexOf("async function nhuongNVChotPhiDoiTra(");
  assert.ok(i > 0, "không thấy hàm giao việc cho nhân viên");
  const k = SRC.slice(i, i + 600);
  assert.match(k, /tagChoXuLyVaUnread\(conversationId\)/, "phải gắn thẻ + chưa đọc thì NV mới thấy");
  assert.match(k, /mem\.botHandoffAt = Date\.now\(\)/, "phải đánh dấu đã bàn giao");
});
