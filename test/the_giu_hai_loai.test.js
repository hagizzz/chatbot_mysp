// ============================================================================
// test/the_giu_hai_loai.test.js — CẦN NGƯỜI THẬT THÌ BOT DỪNG HẲN
// ----------------------------------------------------------------------------
// CHỐT SHOP 25/08/2026:
//   "Những trường hợp không tự xử lý được, cần người thật vào xử lý thì sẽ không
//    làm gì tiếp; chỉ khi nhân viên vào TRẢ LỜI và GỠ đi những thẻ đó thì lúc này
//    bot mới được trả lời tiếp."
//
// Trước đó bot chia nhỏ: 183 dừng hẳn, còn 184/185 vẫn cho trả lời câu hỏi. Nay bỏ
// cách chia đó — MỘT luật duy nhất cho mọi thẻ giữ, nhân viên không phải nhớ thẻ nào
// cho bot nói tiếp.
//
// ĐIỀU KIỆN NHẬN LẠI — hiện tại: CHỈ CẦN GỠ THẺ.
// Shop chốt thêm cùng ngày: "tạm thời chỉ cần gỡ thẻ là bot hoạt động trở lại; điều
// kiện nhân viên trả lời rồi mới gỡ thẻ sẽ siết sau."
// -> Chốt "nhân viên đã trả lời" đã viết xong và có test, nhưng nằm sau công tắc
//    SIET_NHAN_VIEN_TRA_LOI (mặc định off). Siết lại chỉ bằng một dòng .env.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

// --- 1) Mọi thẻ cần-người-thật đều chặn -------------------------------------
test("cả 183, 184, 185 đều nằm trong danh sách thẻ chặn", () => {
  const m = SRC.match(/HOLD_TAG_IDS\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, "không thấy HOLD_TAG_IDS");
  const ids = m[1].split(",").map(x => Number(x.trim()));
  for (const id of [183, 184, 185, 166, 177]) {
    assert.ok(ids.includes(id), `thẻ ${id} phải chặn bot`);
  }
});

test("cổng chặn thoát sớm cho MỌI thẻ giữ, không chia nhỏ nữa", () => {
  const i = SRC.indexOf("if (convHasHoldTag(conversation, _holdPid))");
  assert.ok(i > 0, "không thấy cổng chặn");
  const k = SRC.slice(i, i + 1200);
  assert.match(k, /return false/, "phải thoát sớm");
  assert.ok(!/DON_UU_TIEN\s*\)/.test(k),
    "còn nhánh riêng cho ĐƠN ƯU TIÊN -> vẫn đang chia nhỏ, trái chốt shop");
});

test("cờ cho-trả-lời-một-phần đã bị gỡ sạch", () => {
  // Để lại là mã chết, người sau đọc tưởng bot còn chạy kiểu cũ.
  assert.strictEqual((SRC.match(/_chiTraLoi/g) || []).length, 0,
    "còn sót _chiTraLoi trong mã");
});

// --- 2) Điều kiện nhận lại: gỡ thẻ VÀ nhân viên đã trả lời ------------------
test("chốt nhân-viên-đã-trả-lời có sẵn, sau bật là dùng được", () => {
  const i = SRC.indexOf("GỠ THẺ THÔI CHƯA ĐỦ");
  assert.ok(i > 0, "thiếu chốt nhân-viên-đã-trả-lời");
  const k = SRC.slice(i, i + 4200);
  assert.match(k, /isHumanInboxMsg/, "phải nhận diện tin của người thật, không tính tin bot");
  assert.match(k, /_giuTuLuc/, "phải so với MỐC lúc hội thoại bị giữ");
  assert.match(k, /return false/, "chưa ai trả lời thì vẫn đứng ngoài");
});

test("chốt đó là CÔNG TẮC, mặc định TẮT — shop chốt 25/08", () => {
  // "Tạm thời chỉ cần gỡ thẻ là bot hoạt động trở lại; điều kiện nhân viên trả
  //  lời rồi mới gỡ thẻ sẽ siết sau." -> giữ mã, tắt mặc định, bật bằng .env.
  const i = SRC.indexOf("SIET_NHAN_VIEN_TRA_LOI");
  assert.ok(i > 0, "thiếu công tắc");
  const k = SRC.slice(Math.max(0, i - 1200), i + 900);
  assert.match(k, /caiDatBat\("SIET_NHAN_VIEN_TRA_LOI", false\)/,
    "mặc định phải là off, và đọc qua kho để shop khai được theo từng shop");
  assert.match(k, /if \(!_siet\)/, "tắt thì gỡ thẻ là nhận lại ngay");
});

test(".env.example nói rõ công tắc này", () => {
  const env = fs.readFileSync(path.join(GOC, ".env.example"), "utf8");
  assert.ok(env.includes("SIET_NHAN_VIEN_TRA_LOI=off"), ".env.example thiếu công tắc");
});

test("mốc giữ chỉ ghi LẦN ĐẦU, không dập lại mỗi vòng poll", () => {
  // Dập lại thì tin trả lời của nhân viên luôn thành "trước mốc" -> bot không
  // bao giờ được chạy lại.
  const i = SRC.indexOf("if (convHasHoldTag(conversation, _holdPid))");
  const k = SRC.slice(i, i + 1200);
  assert.match(k, /if \(!mem\._giuTuLuc\) mem\._giuTuLuc = Date\.now\(\)/,
    "phải chỉ ghi khi chưa có mốc");
});

test("nhận lại xong thì xoá cờ và mốc", () => {
  const i = SRC.indexOf("GỠ THẺ THÔI CHƯA ĐỦ");
  const k = SRC.slice(i, i + 4200);
  assert.match(k, /mem\.aiStandsOut = false;\s*mem\._giuTuLuc = 0/,
    "không xoá thì lần giữ sau so với mốc cũ, sai hết");
});

test("KHÔNG xoá cờ đứng-ngoài ngay khi hết thẻ", () => {
  // Xoá sớm ở cổng chặn là chốt "nhân viên đã trả lời" không bao giờ chạy tới.
  assert.ok(!/if \(mem\.aiStandsOut\) \{ mem\.aiStandsOut = false; updateConversationState/.test(SRC),
    "còn dòng xoá cờ sớm -> chốt thứ hai bị vô hiệu");
});

// --- 3) Vẫn giữ: chọn ĐÚNG thẻ theo loại việc -------------------------------
test("khách giục gấp vẫn gắn 185, không phải 183", () => {
  // Cả hai đều chặn bot như nhau, nhưng nhân viên lọc theo thẻ để làm việc —
  // nguyên tắc 6 của yêu cầu: thẻ sai là bỏ sót khách hoặc làm nhầm việc.
  const i = SRC.indexOf("IM_NHUONG_NGUOI + khách GIỤC GẤP");
  assert.ok(i > 0, "mất nhánh chọn thẻ cho ca giục gấp");
  const k = SRC.slice(Math.max(0, i - 700), i + 200);
  assert.match(k, /tagDonUuTienVaUnread/, "phải gắn ĐƠN ƯU TIÊN");
});

test("ảnh không nhận ra vẫn gắn 184, không phải 183", () => {
  const i = SRC.indexOf("Khách gửi ảnh MỚI nhưng không nhận ra");
  assert.ok(i > 0, "không thấy nhánh ảnh-không-nhận-ra");
  const k = SRC.slice(i, i + 4200);
  assert.match(k, /tagXuLyAnhVaUnread/, "phải gắn thẻ ảnh (184) cho đúng loại việc");
});

// ============================================================================
// [BỔ SUNG 25/08/2026] 184 LÀ THẺ GIỮ — MÃ ĐỪNG NÓI NGƯỢC LẠI
// ----------------------------------------------------------------------------
// Hai quyết định trong CÙNG một ngày va nhau:
//   · sáng  — đổi 183 -> 184 ở các nhánh ảnh, lý do ghi trong mã: "184 KHÔNG nằm
//             trong HOLD_TAG_IDS nên không chặn, bot vẫn phục vụ tiếp"
//   · chiều — chốt của shop: "cần người thật thì bot không làm gì tiếp"
//             -> 184 ĐƯỢC ĐƯA VÀO HOLD_TAG_IDS
//
// Kết quả: ba chú thích trong mã khẳng định điều ngược hẳn với hành vi thật. Đọc
// chú thích mà sửa tiếp là sửa sai. Bắt được nhờ chạy giả lập, thấy dòng
// "bot đứng ngoài — hội thoại còn thẻ giữ 184".
//
// Các tệp công cụ (canh_tin_moi.js, lichsu.js, soi_nhan.js) cũng giữ danh sách
// cũ thiếu 184 -> báo "không có thẻ giữ" trong khi bot đang đứng ngoài.
// ============================================================================
const fsB = require("node:fs");
const pathB = require("node:path");
const GOCB = pathB.join(__dirname, "..");
const SRCB = fsB.readFileSync(pathB.join(GOCB, "bot_worker_api_v3.js"), "utf8");

test("mã KHÔNG còn chú thích nói 184 không chặn", () => {
  for (const sai of [
    /184 KHÔNG nằm trong HOLD_TAG_IDS nên không chặn/,
    /184 "ảnh không nhận diện được" \(mục 6\.1 yêu cầu\) KHÔNG chặn/,
    /184 \(không phải thẻ giữ\)/
  ]) {
    assert.ok(!sai.test(SRCB),
      `còn chú thích sai: ${sai} — 184 nằm trong HOLD_TAG_IDS, gắn vào là hội thoại dừng`);
  }
});

test("công cụ soi thẻ dùng CÙNG danh sách với lõi bot", () => {
  // Lệch danh sách thì công cụ bảo "không có thẻ giữ" trong khi bot đang im.
  for (const tep of ["canh_tin_moi.js", "lichsu.js", "soi_nhan.js", "go_the_giu.js"]) {
    const _tim = t => ["", "loi/ai", "loi/pancake", "loi/cau_noi", "loi/don", "loi/san_pham", "loi/bo_nho", "loi/tien_ich", "cong_cu", "thu_nghiem"]
      .map(d => pathB.join(GOCB, d, t)).find(x => fsB.existsSync(x)) || pathB.join(GOCB, t);
    const src = fsB.readFileSync(_tim(tep), "utf8");
    const m = src.match(/(?:HOLD|HOLD_IDS|HOLD_TAG_IDS)\s*=\s*\[([^\]]*)\]/);
    assert.ok(m, `${tep}: không thấy danh sách thẻ giữ`);
    const ids = m[1].split(",").map(x => Number(x.trim())).filter(n => !Number.isNaN(n)).sort((a, b) => a - b);
    assert.deepStrictEqual(ids, [166, 177, 183, 184, 185], `${tep} lệch danh sách thẻ giữ`);
  }
});
