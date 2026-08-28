// ============================================================================
// test/gui_binh_luan_dung_page.test.js
// GỬI THEO BÌNH LUẬN: ĐÚNG PAGE, VÀ LỖI PHẢI RA LỖI
// ----------------------------------------------------------------------------
// Đo trên page PHOM 26/08/2026, hai lỗi cùng một lượt:
//
// 1. private_replies trả {"message":"conversation_id not found","error_code":120}
//    vì id conv bình luận là "POSTID_kháchId" -> hàm gửi suy ra id BÀI VIẾT, không
//    ra page, rồi rơi xuống PAGE_ID trong .env (Mys.P) -> gửi comment của PHOM
//    sang page khác. Ở cấu hình đa-page thì hỏng 100%.
//
// 2. Trả lời công khai nhận về CHUỖI "Server internal error", mà chuỗi không có
//    .success nên `r.success !== false` ra true -> log in "OK?: true", bot đặt cờ
//    đã-trả-lời và không bao giờ thử lại. Dưới bài không có gì.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SENDER = fs.readFileSync(path.join(GOC, "loi/pancake/pancake_sender.js"), "utf8");
const WORKER = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

test("phản hồi KHÔNG phải object -> coi là THẤT BẠI", () => {
  const { _thanhCong } = require(path.join(GOC, "loi/pancake/pancake_sender.js"));
  assert.strictEqual(_thanhCong("Server internal error"), false, "chuỗi lỗi vẫn bị coi là thành công");
  assert.strictEqual(_thanhCong(null), false);
  assert.strictEqual(_thanhCong(undefined), false);
  assert.strictEqual(_thanhCong([]), false);
  assert.strictEqual(_thanhCong({ success: false }), false);
  // Vẫn phải nhận đúng ca thành công, không thì bot tưởng gửi hụt rồi gửi lại loạn.
  assert.strictEqual(_thanhCong({ success: true }), true);
  assert.strictEqual(_thanhCong({ id: "m_abc" }), true, "Pancake hay trả object không có cờ success");
});

test("replyComment / sendPrivateReply nhận page THẬT từ nơi gọi", () => {
  assert.match(SENDER, /function _pc\(conversationId, _pageHint\)/, "_pc chưa nhận gợi ý page");
  assert.match(SENDER, /String\(_pageHint \|\| ""\)\.trim\(\) \|\| reg\.pageIdFromConv/,
    "gợi ý page phải được ưu tiên TRƯỚC khi suy từ id hội thoại");
  assert.match(SENDER, /async function replyComment\(conversationId, text, commentId, pageId\)/);
  assert.match(SENDER, /async function sendPrivateReply\(conversationId, text, commentId, postId, pageId\)/);
});

test("bot_worker TRUYỀN page thật khi gửi theo bình luận", () => {
  assert.match(WORKER, /sendPrivateReply\(conversationId, opener, commentId, _postIdForReply,\s*\n?\s*\(conversation && conversation\.page_id\) \|\| _holdPid\)/,
    "không truyền page -> hàm gửi lại phải tự đoán, và đoán sai như cũ");
  assert.match(WORKER, /replyComment\(conversationId, hook, commentId, \(conversation && conversation\.page_id\) \|\| _holdPid\)/);
});

test("replyComment hỏng thì TRẢ VỀ hỏng, kèm log", () => {
  const i = SENDER.indexOf("async function replyComment");
  const than = SENDER.slice(i, i + 1200);
  assert.match(than, /_thanhCong\(_out\)/, "vẫn dùng phép kiểm cũ");
  assert.match(than, /replyComment HỎNG/, "hỏng mà không kêu thì lại chìm như cũ");
  assert.match(than, /reason: "API_TU_CHOI"/, "phải trả về thất bại rõ ràng cho nơi gọi");
});
