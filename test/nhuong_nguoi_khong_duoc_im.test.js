// ============================================================================
// test/nhuong_nguoi_khong_duoc_im.test.js — NHƯỜNG NGƯỜI THẬT ≠ IM LẶNG
// ----------------------------------------------------------------------------
// Đo trên page PHOM 26/08/2026:
//   14:51:27 khách: "thế gộp đơn này với đơn trước luôn thành 1 đơn cho em luôn nha"
//   14:52:47 khách: "để trả phí ship luôn 1 lần"
//   bot     : CHOT_DON bị chặn (đúng — gộp/sửa đơn là việc người thật)
//             -> gắn thẻ 183 -> KHÔNG NÓI GÌ.
// Khách ngồi chờ, nhân viên chỉ thấy một cái thẻ trống.
//
// Không tự xử là đúng. Im lặng thì không.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

function khoiChanChot() {
  const i = SRC.indexOf("CHOT_DON bị CHẶN");
  assert.ok(i > 0, "không thấy nhánh chặn chốt đơn");
  const j = SRC.lastIndexOf("if (_cqFail.length) {", i);
  assert.ok(j > 0 && j < i, "không thấy đầu khối");
  return SRC.slice(j, i);
}

test("chặn chốt đơn -> PHẢI nhắn khách một câu trước khi nhường", () => {
  const k = khoiChanChot();
  assert.match(k, /sendInboxMessage\(conversationId, _cauChuyen\)/,
    "vẫn im lặng gắn thẻ — khách không biết chuyện gì đang xảy ra");
});

test("câu lấy từ KHO, không viết cứng trong mã", () => {
  const k = khoiChanChot();
  assert.match(k, /KB\.cau\("chuyen_nguoi_that"/,
    "shop phải sửa được câu này mà không cần mở mã");
  assert.ok(!/"Dạ phần này em nhờ bạn phụ trách/.test(k),
    "KHÔNG được chép câu vào mã làm phom — kho phải là nguồn duy nhất " +
    "(luật trong test/kho_kich_ban.test.js). Tra hụt đã có MỐC HỤT lo.");
});

test("nhắn TRƯỚC khi gắn thẻ", () => {
  const k = khoiChanChot();
  const iNhan = k.indexOf("sendInboxMessage");
  const iThe = k.indexOf("tagChoXuLyVaUnread");
  assert.ok(iNhan > 0 && iThe > iNhan, "gắn thẻ trước rồi mới nhắn thì thứ tự log rối");
});

test("câu này KHÔNG bị isWaitHandoffMsg nuốt", () => {
  // Bẫy đã cắn một lần ở nhánh thiếu-dòng-Sheet: cụm "chờ em kiểm tra…" bị
  // hàm này coi là câu báo-chờ và nuốt -> bot lại im đúng như trước khi vá.
  const i = SRC.indexOf("function isWaitHandoffMsg(text) {");
  const isWaitHandoffMsg = eval("(" + SRC.slice(i, SRC.indexOf("\n}", i) + 2) + ")");
  const cau = require(path.join(GOC, "loi/cau_noi/kho_kich_ban")).cau("chuyen_nguoi_that");
  assert.ok(cau && cau.trim(), "kho không có câu");
  assert.ok(!isWaitHandoffMsg(cau), `câu "${cau}" sẽ bị nuốt -> bot vẫn im`);
});

test("khoá chuyen_nguoi_that có trong kho và không dính mốc hụt", () => {
  const KB = require(path.join(GOC, "loi/cau_noi/kho_kich_ban"));
  const c = KB.cau("chuyen_nguoi_that");
  assert.ok(KB.vetTruocKhiGui(c).ok, "câu dính mốc hụt -> bị chặn không gửi được");
});

// --- Nhánh TRA ĐƠN cũng không được im -----------------------------------------
// Đo 26/08/2026 16:57: khách "tầm mấy ngày có hàng vậy ạ" -> bot tra POS, đơn có
// nhưng KHÔNG có sản phẩm (item[0]=null) -> "không thấy đơn phù hợp" -> gắn 183
// và im. Hàm handoff() gán mem.lastBotReply = HUMAN_CHECK_REPLY nhưng KHÔNG gửi,
// nên sổ ghi như đã nói còn khách không nhận chữ nào.
function khoiHandoffDon() {
  const i = SRC.indexOf("const handoff = async (logMsg)");
  assert.ok(i > 0, "không thấy hàm handoff của nhánh tra đơn");
  return SRC.slice(i, i + 1200);
}

test("tra đơn không ra -> PHẢI nhắn khách trước khi gắn thẻ", () => {
  const h = khoiHandoffDon();
  assert.match(h, /sendInboxMessage\(conversationId, _cauChuyen\)/,
    "vẫn gắn thẻ rồi im — khách hỏi đơn mà không nhận được gì");
  assert.match(h, /KB\.cau\("chuyen_nguoi_that"\)/,
    "phải dùng khoá kho, không viết cứng");
});

test("KHÔNG gửi HUMAN_CHECK_REPLY — câu đó bị isWaitHandoffMsg nuốt", () => {
  const i = SRC.indexOf("function isWaitHandoffMsg(text) {");
  const KET = String.fromCharCode(10) + "}";   // tránh escape trong chuỗi
  const isWaitHandoffMsg = eval("(" + SRC.slice(i, SRC.indexOf(KET, i) + 2) + ")");
  const { HUMAN_CHECK_REPLY } = require(path.join(GOC, "loi/ai/reasoning_engine"));
  assert.ok(isWaitHandoffMsg(HUMAN_CHECK_REPLY),
    "nếu câu này KHÔNG còn bị nuốt thì xem lại chú thích trong handoff()");
  const h = khoiHandoffDon();
  const iGui = h.indexOf("sendInboxMessage");
  assert.ok(!/sendInboxMessage\(conversationId, HUMAN_CHECK_REPLY\)/.test(h),
    "gửi thẳng HUMAN_CHECK_REPLY thì bị nuốt, bot vẫn im");
  assert.ok(iGui > 0);
});

test("nhắn TRƯỚC khi gắn thẻ ở nhánh tra đơn", () => {
  const h = khoiHandoffDon();
  assert.ok(h.indexOf("sendInboxMessage") < h.indexOf("tagChoXuLyVaUnread"),
    "gắn thẻ trước rồi mới nhắn thì thứ tự log rối");
});
