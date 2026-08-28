// ============================================================================
// test/the_anh_khong_nhan_ra.test.js — ẢNH KHÔNG NHẬN RA DÙNG THẺ RIÊNG
// ----------------------------------------------------------------------------
// Yêu cầu tính năng mục 6.1 định nghĩa BA thẻ hệ thống cho BA việc khác nhau:
//     "Cần người thật xử lý · ẢNH KHÔNG NHẬN DIỆN ĐƯỢC · Tình huống nhạy cảm"
//
// Mã cũ gắn thẻ THỨ NHẤT (183 CHỜ XL) cho ca thứ hai. 183 nằm trong
// HOLD_TAG_IDS nên chặn ở ĐẦU vòng xử lý -> bot đứng ngoài CẢ HỘI THOẠI.
//
// Đo trên page thật 25/08/2026: khách gửi ảnh sản phẩm của shop khác (thử xem
// bot có bịa không — bot KHÔNG bịa, đúng). Nhưng nó gắn 183, nên tin tiếp theo
// của khách bot không thèm đọc. Log lặp "Còn thẻ giữ -> AI đứng ngoài", hội
// thoại chết tới khi có người gỡ thẻ tay.
//
// Nguyên tắc 6 của tài liệu: "Gắn thẻ phải đúng. Mỗi thẻ có một ý nghĩa riêng…
// Nhân viên lọc theo thẻ để làm việc, thẻ sai là bỏ sót khách hoặc làm nhầm việc."
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

function khucNhanh() {
  const i = SRC.indexOf("Khách gửi ảnh MỚI nhưng không nhận ra");
  assert.ok(i > 0, "không thấy nhánh ảnh-không-nhận-ra");
  return SRC.slice(i, i + 2400);
}

test("dùng thẻ 184 (ảnh không nhận diện được), không phải 183", () => {
  const k = khucNhanh();
  assert.match(k, /tagXuLyAnhVaUnread/, "phải gắn thẻ AI-XL ảnh (184)");
  assert.ok(!/tagChoXuLyVaUnread/.test(k),
    "còn gắn 183 -> bot vẫn đứng ngoài cả hội thoại vì một tấm ảnh");
});

test("184 CŨNG chặn bot — chốt shop 25/08/2026", () => {
  // ĐỔI Ý so với bản đầu của bản vá này. Ban đầu 184 cố ý KHÔNG chặn để hội thoại
  // không đóng băng. Shop chốt lại: "cần người thật vào xử lý thì bot không làm gì
  // tiếp" — một luật cho mọi thẻ, nhân viên không phải nhớ thẻ nào cho bot nói tiếp.
  // Giá trị còn lại của việc đổi 183 -> 184 là GẮN ĐÚNG LOẠI VIỆC (nguyên tắc 6):
  // nhân viên lọc riêng được ca "cần nhìn giúp tấm ảnh", và đếm được tỷ lệ vision trượt.
  const m = SRC.match(/HOLD_TAG_IDS\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, "không thấy HOLD_TAG_IDS");
  const ids = m[1].split(",").map(x => Number(x.trim()));
  for (const id of [183, 184, 185]) {
    assert.ok(ids.includes(id), `thẻ ${id} phải chặn bot`);
  }
});

test("KHÔNG đặt botHandoffAt — đây không phải nhường cả hội thoại", () => {
  // Chỉ là nhờ nhìn giúp một tấm ảnh. Đặt cờ bàn giao sẽ chặn follow-up và
  // mấy nhánh khác một cách oan uổng.
  const k = khucNhanh();
  assert.ok(!/mem\.botHandoffAt = Date\.now\(\)/.test(k),
    "vẫn đặt botHandoffAt -> bot tự trói mình dù chỉ đọc hụt một tấm ảnh");
});

test("có ghi chú cho nhân viên biết cần làm gì", () => {
  // Nhân viên mở lên phải hiểu ngay: cần nhìn giúp tấm ảnh, không phải cả ca.
  const k = khucNhanh();
  assert.match(k, /addConversationNote/, "thiếu ghi chú -> nhân viên phải đoán");
  assert.match(k, /KHÔNG nhận ra mẫu/, "ghi chú phải nói rõ vướng ở đâu");
});

test("bot vẫn tự gỡ 184 khi sau đó nhận ra mẫu", () => {
  // Không gỡ thì thẻ đọng lại, hàng đợi của nhân viên đầy ca đã xong.
  assert.match(SRC, /untagXuLyAnh/, "mất đường tự gỡ thẻ 184");
});

test("vẫn KHÔNG báo giá khi chưa chắc mẫu — nguyên tắc 2 giữ nguyên", () => {
  // Vá này chỉ đổi THẺ, tuyệt đối không nới việc "không chắc thì không nói".
  const k = khucNhanh();
  assert.match(k, /thisTurn\.length === 0 && imageCount > 0/,
    "điều kiện vào nhánh phải giữ nguyên: có ảnh mà không ra mẫu nào");
  assert.match(k, /return true/, "vẫn phải dừng lượt, không đi tiếp báo giá bừa");
});
