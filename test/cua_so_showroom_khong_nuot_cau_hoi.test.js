// ============================================================================
// test/cua_so_showroom_khong_nuot_cau_hoi.test.js
// CỬA SỔ "HÔM NÀO GHÉ?" KHÔNG ĐƯỢC NUỐT CÂU HỎI KHÁC
// ----------------------------------------------------------------------------
// Đo trên page PHOM 26/08/2026:
//   15:03:40 khách "bên mình có cửa hàng k nhỉ, e muốn qua thử"
//            -> bot đưa địa chỉ showroom + hỏi "chị tính ghé hôm nào"
//   15:05:19 khách "mẫu đó còn màu khác k shop"            (nhãn COLOR_ASK)
//   15:05:33 bot   "Dạ chị tiện thì ghé thử cho ưng ý nha..."   <- LẠC ĐỀ
//
// Nhánh B3 mở một cửa sổ 2 TIẾNG và chỉ chừa ba lối ra (STORE_VISIT /
// STORE_ADDRESS / showroomReplyFor). Mọi tin khác rơi vào đó, bị trả lời bằng
// câu mời ghé showroom, rồi `return true` kết thúc lượt — câu hỏi thật không
// bao giờ tới được nhánh trả lời.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

function khoiB3() {
  const i = SRC.indexOf("Khách chưa chốt giờ ghé");
  assert.ok(i > 0, "không thấy nhánh B3");
  const j = SRC.lastIndexOf("if (mem.showroomVisitAsked", i);
  assert.ok(j > 0 && j < i, "không thấy đầu cửa sổ showroom");
  return SRC.slice(j, i);
}

test("khách hỏi chuyện khác -> B3 KHÔNG được cướp lượt", () => {
  const k = khoiB3();
  assert.match(k, /_hoiChuyenKhac/,
    "thiếu rào: mọi tin trong 2 tiếng vẫn bị trả lời bằng câu mời ghé showroom");
  assert.match(k, /isAskKind\(mem\._aiIntent\)/,
    "phải soi nhãn AI — COLOR_ASK/PRICE_ASK/MATERIAL_QA đều là câu hỏi cần trả");
  assert.match(k, /looksLikeQuestion\(latestText\)/,
    "phải soi cả chữ, phòng khi AI chết hoặc trả nhãn lạ");
});

test("rào đứng TRƯỚC điều kiện cũ, trong cùng một if", () => {
  const k = khoiB3();
  const iRao = k.indexOf("!_hoiChuyenKhac");
  const iCu = k.indexOf('_aiOr(wantsVisitShowroom(latestText), "STORE_VISIT")');
  assert.ok(iRao > 0 && iCu > iRao, "đặt sau thì thứ tự đọc rối, dễ sửa hỏng lần sau");
});

test("vẫn giữ ba lối ra cũ — không phá nhánh showroom", () => {
  const k = khoiB3();
  for (const x of ["STORE_VISIT", "STORE_ADDRESS", "showroomReplyFor"]) {
    assert.ok(k.includes(x), `mất lối ra ${x} -> hỏng luồng mời ghé showroom`);
  }
});

test("tin KHÔNG phải câu hỏi vẫn vào B3 như cũ", () => {
  // "bận quá chưa qua được" / "để hôm khác" phải tiếp tục được thuyết phục,
  // không thì nới rào xong mất luôn nhánh chốt showroom.
  const i = SRC.indexOf("function looksLikeQuestion(text) {");
  const looksLikeQuestion = eval("(" + SRC.slice(i, SRC.indexOf("\n}", i) + 2) + ")");
  for (const c of ["bận quá chưa qua được", "để hôm khác nha", "ok chị biết rồi"]) {
    assert.ok(!looksLikeQuestion(c), `"${c}" bị coi là câu hỏi -> mất nhánh thuyết phục`);
  }
});
