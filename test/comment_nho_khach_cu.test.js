// ============================================================================
// test/comment_nho_khach_cu.test.js — KHÁCH CŨ BÌNH LUẬN THÌ ĐỪNG HỎI LẠI
// ----------------------------------------------------------------------------
// Bảng bộ nhớ khoá theo (shop_id, conversation_id). Hội thoại BÌNH LUẬN mang id
// "POSTID_kháchId", khác id inbox -> mem trống, dù cùng một khách.
//
// Đo trên page PHOM 26/08/2026: khách đã có size M, sđt, địa chỉ và đã chốt 3
// đơn bên inbox. Comment vào bài -> bot vẫn "Chị cho em xin chiều cao và cân
// nặng". Vi phạm Nguyên tắc 4 (docs/YEU_CAU_TINH_NANG.txt).
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

function khoiMuon() {
  const i = SRC.indexOf("_MUON_TU_INBOX");
  assert.ok(i > 0, "không thấy nhánh mượn bộ nhớ inbox");
  return SRC.slice(i - 200, i + 1800);
}

test("hội thoại bình luận mượn thông tin khách từ inbox", () => {
  const k = khoiMuon();
  assert.match(k, /isCommentOrigin && inboxId/, "thiếu điều kiện: chỉ áp cho conv bình luận");
  assert.match(k, /getConversationState\(inboxId\)/, "không đọc bộ nhớ hội thoại inbox");
  for (const f of ["customerSize", "phone", "address"]) {
    assert.ok(k.includes(f), `thiếu trường "${f}" — vẫn sẽ hỏi lại thứ khách đã cho`);
  }
});

test("KHÔNG mượn mẫu / khoá / trạng thái đơn", () => {
  // Mẫu ở hội thoại bình luận phải là mẫu của BÀI khách vừa bình luận.
  // Mượn lock bên inbox sang là báo giá nhầm mẫu — hỏng nặng hơn lỗi đang chữa.
  const i = SRC.indexOf("const _MUON_TU_INBOX");
  const dsMuon = SRC.slice(i, SRC.indexOf("];", i));
  for (const cam of ["currentProduct", "lastShownCode", "quotedProducts", "orderClosed",
                     "sentImageCodes", "commentProductSent", "lastAdId"]) {
    assert.ok(!dsMuon.includes(cam), `KHÔNG được mượn "${cam}" từ hội thoại khác`);
  }
});

test("chỉ mượn khi bên bình luận CHƯA có — không đè", () => {
  const k = khoiMuon();
  assert.match(k, /cu === undefined \|\| cu === null \|\| cu === ""/,
    "phải kiểm ô đang trống trước khi mượn, không thì đè mất thứ khách vừa cho ở bình luận");
});

test("có ghi log khi mượn — không được lặng lẽ", () => {
  const k = khoiMuon();
  assert.match(k, /mượn thông tin khách từ hội thoại inbox/,
    "mượn dữ liệu giữa hai hội thoại mà không kêu thì sau này không lần ra được");
});
