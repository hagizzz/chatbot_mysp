// ============================================================================
// test/bo_qua_the_giu.test.js — NGOẠI LỆ THẺ GIỮ PHẢI KHOÁ ĐƯỢC HAI LỚP
// ----------------------------------------------------------------------------
// BO_QUA_THE_GIU sinh ra cho MỘT hoàn cảnh: page đã có bot khác chạy sẵn, muốn
// tách thì gắn thẻ giữ để đuổi bot kia, còn bot chạy thử vẫn phục vụ.
//
// Đây là ngoại lệ của một LUẬT AN TOÀN ("cần người thật thì bot không làm gì
// tiếp"), nên phải có khoá: chỉ mở khi ĐANG CHẠY THỬ, tức CHI_XU_LY_IDS có
// giá trị. Bản thật không khai CHI_XU_LY_IDS -> cờ luôn tắt, kể cả khi .env
// lỡ có BO_QUA_THE_GIU=on.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

function khoiKhai() {
  const i = SRC.indexOf("const BO_QUA_THE_GIU");
  assert.ok(i > 0, "không thấy khai BO_QUA_THE_GIU");
  return SRC.slice(i, i + 500);
}

test("cờ CHỈ bật khi CHI_XU_LY_IDS có giá trị", () => {
  const k = khoiKhai();
  assert.match(k, /CHI_XU_LY_IDS\.size > 0/,
    "thiếu khoá chạy-thử -> bản thật cũng bỏ qua được thẻ giữ");
});

test("nhận các cách viết TẮT thông dụng", () => {
  const k = khoiKhai();
  for (const v of ["off", "0", "false", "no"]) {
    assert.ok(k.includes('"' + v + '"'), `thiếu giá trị tắt "${v}"`);
  }
  assert.match(k, /""/, "chuỗi rỗng phải là TẮT, không thì khai biến trống hoá ra bật");
});

test("cổng chặn thẻ giữ vẫn còn nguyên nhánh dừng", () => {
  // Ngoại lệ chỉ được THÊM một nhánh, không được xoá nhánh cũ.
  assert.match(SRC, /\} else if \(convHasHoldTag\(conversation, _holdPid\)\) \{\s*\n\s*mem\.aiStandsOut = true;/,
    "mất nhánh dừng khi có thẻ giữ — bot sẽ chen vào hội thoại nhân viên đang giữ");
  assert.match(SRC, /Còn thẻ giữ/, "mất dòng log báo bot đứng ngoài");
});

test("nhánh ngoại lệ đứng TRƯỚC nhánh dừng", () => {
  const iNgoaiLe = SRC.indexOf("convHasHoldTag(conversation, _holdPid) && BO_QUA_THE_GIU");
  const iDung = SRC.indexOf("} else if (convHasHoldTag(conversation, _holdPid)) {");
  assert.ok(iNgoaiLe > 0 && iDung > iNgoaiLe,
    "đảo thứ tự thì ngoại lệ không bao giờ tới lượt");
});

test("có ghi log khi bỏ qua — không được im lặng", () => {
  const i = SRC.indexOf("BO_QUA_THE_GIU -> có thẻ giữ");
  assert.ok(i > 0, "bỏ qua một luật an toàn mà không kêu tiếng nào là không chấp nhận được");
});
