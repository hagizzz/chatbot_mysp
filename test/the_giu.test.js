// ============================================================================
// test/the_giu.test.js — CHỐT BỘ NHẬN DIỆN THẺ GIỮ KHÔNG ĐƯỢC LỆCH
// ----------------------------------------------------------------------------
// Thẻ giữ là thứ quyết định bot có đứng ngoài một hội thoại hay không
// (bot_worker_api_v3.js:5774 — thoát ngay đầu vòng xử lý, trước cả khi đọc tin).
//
// go_the_giu.js phải nhận diện thẻ giữ Y HỆT lõi bot. Lệch một id là gỡ xong
// bot vẫn đứng ngoài, mà log thì bị logThrottle bóp nên nhìn như bot treo —
// đúng kiểu lỗi tốn cả buổi mới lần ra. Lõi bot không có module.exports nên
// go_the_giu.js buộc phải CHÉP danh sách; test này canh hai bản chép không trôi
// khỏi nhau.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
// [DỌN 27/08/2026] Mã đã chia thư mục (loi/, cong_cu/, thu_nghiem/). Test đọc mã
// nguồn theo TÊN TỆP nên phải tự dò chỗ — cứng đường dẫn vào đây là mỗi lần dọn
// thư mục lại phải sửa hàng loạt test.
function _timTep(f) {
  for (const d of ["", "loi/ai", "loi/pancake", "loi/cau_noi", "loi/don", "loi/san_pham", "loi/bo_nho", "loi/tien_ich", "cong_cu", "thu_nghiem"]) {
    const p = require("path").join(GOC, d, f);
    if (require("fs").existsSync(p)) return p;
  }
  return require("path").join(GOC, f);
}
const doc = f => fs.readFileSync(_timTep(f), "utf8");

// Đọc mảng id thẻ giữ ra khỏi mã nguồn, không cần chạy file.
function docIdTheGiu(tep) {
  const m = doc(tep).match(/HOLD_TAG_IDS\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, `${tep} không khai HOLD_TAG_IDS`);
  return m[1].split(",").map(s => Number(s.trim())).filter(Number.isFinite).sort((a, b) => a - b);
}

function docReTenTheGiu(tep) {
  const m = doc(tep).match(/HOLD_TAG_NAME_RE\s*=\s*(\/.+\/[a-z]*)/);
  assert.ok(m, `${tep} không khai HOLD_TAG_NAME_RE`);
  return m[1];
}

test("go_the_giu.js dùng ĐÚNG danh sách id thẻ giữ của lõi bot", () => {
  assert.deepStrictEqual(
    docIdTheGiu("go_the_giu.js"),
    docIdTheGiu("bot_worker_api_v3.js"),
    "HOLD_TAG_IDS lệch nhau -> gỡ thẻ xong bot VẪN đứng ngoài, mà log không nói gì"
  );
});

test("go_the_giu.js dùng ĐÚNG regex tên thẻ giữ của lõi bot", () => {
  assert.strictEqual(
    docReTenTheGiu("go_the_giu.js"),
    docReTenTheGiu("bot_worker_api_v3.js"),
    "HOLD_TAG_NAME_RE lệch nhau -> thẻ chỉ có tên (không có id) sẽ bị bỏ sót"
  );
});

test("go_the_giu.js KHÔNG gỡ gì khi chưa nêu id", () => {
  // Hàng rào quan trọng nhất: công cụ này chạy trên page THẬT. Không có id thì
  // phải thoát, tuyệt đối không được dò hay quét cả page.
  const src = doc("go_the_giu.js");
  assert.ok(/if\s*\(!convId\)/.test(src), "thiếu chốt chặn khi không có convId");
  assert.ok(/process\.exit\(1\)/.test(src), "không có id thì phải thoát hẳn");
});

test("--thu chỉ chấp nhận CHI_XU_LY_IDS khai đúng 1 hội thoại", () => {
  // Khai nhiều id mà gỡ hàng loạt trên page thật là gỡ nhầm thẻ của khách thật
  // đang chờ nhân viên.
  assert.ok(/ds\.length\s*!==\s*1/.test(doc("go_the_giu.js")),
    "--thu phải từ chối khi CHI_XU_LY_IDS khai khác 1 id");
});
