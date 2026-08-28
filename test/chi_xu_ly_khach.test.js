// ============================================================================
// test/chi_xu_ly_khach.test.js — MỞ HÀNG RÀO THEO KHÁCH
// ----------------------------------------------------------------------------
// Khách bình luận bài mới -> hội thoại mới, id mới. Khai tay từng id vào
// CHI_XU_LY_IDS thì mỗi bài là một vòng "bình luận -> tra id -> sửa .env ->
// khởi động lại 3 phút", không bao giờ đo kịp luồng bình luận.
//
// CHI_XU_LY_KHACH khai MÃ KHÁCH; vòng quét gặp hội thoại của đúng khách đó thì
// tự thêm vào danh sách trắng.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

function khoi() {
  const i = SRC.indexOf("function _moKhoaTheoKhach");
  assert.ok(i > 0, "không thấy hàm _moKhoaTheoKhach");
  return SRC.slice(i, i + 900);
}

test("chỉ có tác dụng khi ĐANG chạy thử", () => {
  const k = khoi();
  assert.match(k, /if \(!CHI_XU_LY_IDS\.size/,
    "thiếu khoá: hàng rào đang TẮT mà tự bật lên giữa chừng là đổi hành vi bản thật");
});

test("khớp theo mã khách, thêm id hội thoại vào danh sách trắng", () => {
  const k = khoi();
  assert.match(k, /c\.from && c\.from\.id/, "phải đọc mã khách từ hội thoại");
  assert.match(k, /CHI_XU_LY_IDS\.add\(id\)/, "không thêm thì rào vẫn chặn");
});

test("có ghi log mỗi lần mở thêm", () => {
  const k = khoi();
  assert.match(k, /nhận thêm hội thoại/,
    "nới hàng rào an toàn mà lặng lẽ thì không ai biết bot vừa được phép đụng thêm ai");
});

test("được gọi TRƯỚC bộ lọc danh sách", () => {
  const iGoi = SRC.indexOf("_moKhoaTheoKhach(convData.conversations)");
  const iLoc = SRC.indexOf("CHI_XU_LY_IDS.has(String(c.id))");
  assert.ok(iGoi > 0, "không thấy chỗ gọi trong vòng quét");
  assert.ok(iLoc > iGoi, "gọi sau bộ lọc thì hội thoại mới bị loại ngay lượt đó");
});
