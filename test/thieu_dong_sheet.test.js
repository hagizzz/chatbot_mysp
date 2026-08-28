// ============================================================================
// test/thieu_dong_sheet.test.js — ẢNH NHẬN RA RỒI MÀ MÃ THIẾU DÒNG SHEET
// ----------------------------------------------------------------------------
// Đo trên page THẬT 25/08/2026:
//     Khách   : gửi ảnh
//     Vision  : MRQN553, điểm 0.9937, cách biệt 0.1155  <- nhận ra gần như chắc chắn
//     Sheet   : MRQN553 KHÔNG có dòng nào trong 589 dòng
//     Bot     : bỏ tấm ảnh -> rơi vào nhánh "không nhận ra mẫu nào" -> gắn thẻ rồi IM
//
// Không phải bot đọc kém. Kho CLIP có 19 tấm của mã này, ảnh có trên Drive. Thiếu
// là thiếu DÒNG HÀNG để lấy giá.
//
// Quét toàn kho 25/08: 265/738 mã có ảnh mà không có dòng Sheet
//                    = 2.510/15.221 ảnh (16,5%). Cứ 6 tấm thì 1 tấm rơi kiểu này.
//
// Gộp chung với "không nhận ra" sai hai lần: sai với khách (im lặng), sai với nhân
// viên (ghi chú bảo "bot không nhận ra mẫu" trong khi bot biết thừa mã là gì).
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

function thanHam(ten) {
  const i = SRC.indexOf("function " + ten + "(");
  assert.ok(i > 0, `không thấy ${ten}`);
  let sau = 0;
  for (let k = SRC.indexOf("{", i); k < SRC.length; k++) {
    if (SRC[k] === "{") sau++;
    else if (SRC[k] === "}" && --sau === 0) return SRC.slice(i, k + 1);
  }
  assert.fail("không đóng được ngoặc " + ten);
}

// Cắt ĐÚNG thân nhánh: chặn ở đầu nhánh kế tiếp. Lấy cửa sổ theo số ký tự thì
// khối bên dưới lọt vào, test bắt nhầm chữ của nhánh khác.
function khoiThieuSheet() {
  const i = SRC.indexOf("ẢNH NHẬN RA RỒI NHƯNG MÃ THIẾU DÒNG SHEET");
  assert.ok(i > 0, "chưa có nhánh thiếu-dòng-sheet");
  const j = SRC.indexOf("// OCR ảnh hay đọc RÁC", i);
  assert.ok(j > i, "không thấy mốc kết thúc nhánh");
  return SRC.slice(i, j);
}

// --- 1. Thông tin phải sống sót tới nhánh xử lý -----------------------------
test("getProductsFromImages GOM mã NOT_FOUND_IN_SHEET, không vứt đi", () => {
  const k = thanHam("getProductsFromImages");
  assert.match(k, /NOT_FOUND_IN_SHEET/,
    "không bắt lý do này thì nhánh dưới chỉ thấy 'không nhận ra mẫu nào'");
  assert.match(k, /_thieuDongSheet/, "thiếu chỗ trả mã ra ngoài");
  assert.match(k, /r\?\.code \|\| r\?\.vision\?\.code/, "phải lấy được MÃ, không chỉ lấy lý do");
});

test("gom mã KHÔNG được làm hỏng danh sách sản phẩm trả về", () => {
  // products là mảng SP; đính kèm phải là thuộc tính ẩn, nếu không .length và
  // vòng lặp trên nó sẽ sai -> hỏng mọi nhánh báo giá.
  const k = thanHam("getProductsFromImages");
  assert.match(k, /defineProperty\(products, "_thieuDongSheet", \{ value: thieuDongSheet, enumerable: false \}\)/,
    "phải là thuộc tính ẩn giống _colorByCode");
});

test("mã trùng chỉ ghi một lần", () => {
  // Khách gửi 4 tấm cùng một mẫu -> ghi chú không được lặp mã 4 lần.
  assert.match(thanHam("getProductsFromImages"), /!thieuDongSheet\.some\(x => x\.code === _m\)/);
});

// --- 2. Nhánh phải NÓI, không được im ---------------------------------------
test("bot NÓI với khách, không im lặng gắn thẻ rồi thôi", () => {
  const k = khoiThieuSheet();
  assert.match(k, /await sendInboxMessage\(conversationId, reply\)/,
    "im lặng chính là lỗi đang sửa");
});

test("nhánh này đứng TRƯỚC nhánh 'không nhận ra ảnh nào'", () => {
  // Đứng sau là không bao giờ chạy tới: nhánh kia bắt cùng điều kiện rộng hơn.
  const a = SRC.indexOf("ẢNH NHẬN RA RỒI NHƯNG MÃ THIẾU DÒNG SHEET");
  const b = SRC.indexOf("Khách gửi ảnh MỚI nhưng không nhận ra");
  assert.ok(a > 0 && b > 0 && a < b, "nhánh thiếu-dòng-sheet phải đặt trước");
});

test("nhánh này đứng TRƯỚC nhánh 'khách gửi ĐỊA CHỈ bằng ẢNH'", () => {
  // Dựng lại trong giả lập 25/08: đặt sau thì nhánh địa chỉ cướp lượt — khách gửi ảnh mẫu
  // giữa lúc đang dở địa chỉ, bot đòi "nhắn địa chỉ bằng tin nhắn chữ" rồi gắn 183, hội
  // thoại chết. Ảnh mà vision ĐÃ RA MÃ thì chắc chắn không phải ảnh địa chỉ.
  const a = SRC.indexOf("ẢNH NHẬN RA RỒI NHƯNG MÃ THIẾU DÒNG SHEET");
  const b = SRC.indexOf("// OCR ảnh hay đọc RÁC");
  assert.ok(a > 0 && b > 0 && a < b, "phải đặt trước nhánh ảnh-địa-chỉ");
});

test("chỉ chạy khi THẬT SỰ có mã bị thiếu dòng", () => {
  const k = khoiThieuSheet();
  assert.match(k, /thisTurn\.length === 0 && imageCount > 0 && _thieuSheet\.length/,
    "thiếu chốt _thieuSheet.length -> nuốt luôn ca ảnh lạ thật, khách bị trả lời sai bản chất");
});

// --- 3. Gắn đúng thẻ, không khoá hội thoại ----------------------------------
test("gắn 184 AI-XL ảnh, KHÔNG gắn thẻ giữ 183", () => {
  const k = khoiThieuSheet();
  assert.match(k, /tagXuLyAnhVaUnread/, "phải gắn thẻ ảnh cho nhân viên thấy");
  assert.ok(!/tagChoXuLyVaUnread/.test(k),
    "183 là thẻ giữ -> khoá cả hội thoại, khách hỏi câu khác bot cũng không đọc");
});

test("KHÔNG đặt botHandoffAt — chỉ nhờ thêm một dòng hàng", () => {
  // Bắt PHÉP GÁN, không bắt chữ: chính nhánh này có chú thích giải thích vì sao
  // không đặt cờ, nên tìm theo chữ là tự bắt nhầm chú thích của mình.
  assert.ok(!/mem\.botHandoffAt\s*=/.test(khoiThieuSheet()),
    "đặt cờ nhường-cả-hội-thoại là chặn oan follow-up và các nhánh khác");
});

test("ghi chú NÊU ĐÍCH DANH MÃ để nhân viên biết thêm dòng nào", () => {
  const k = khoiThieuSheet();
  assert.match(k, /_maThieu/, "không nêu mã thì nhân viên phải tự mò lại từ ảnh");
  assert.ok(!/Bot KHÔNG đứng ngoài/.test(k),
    "184 NẰM TRONG HOLD_TAG_IDS -> nói 'bot không đứng ngoài' là sai, đọc log sẽ hiểu nhầm");
  assert.match(k, /KHÔNG có dòng trong Sheet/, "ghi chú phải nói đúng bản chất, không nói 'bot không nhận ra'");
});

// --- 4. Câu nói: shop sửa được, và phải TỚI ĐƯỢC tay khách ------------------
test("câu lấy từ kho kịch bản, shop khác custom được", () => {
  assert.match(khoiThieuSheet(), /KB\.cau\("anh_thieu_dong_sheet"\)/);
  const j = JSON.parse(fs.readFileSync(path.join(GOC, "kich_ban", "mac_dinh.json"), "utf8"));
  assert.ok(j.cau && j.cau.anh_thieu_dong_sheet, "thiếu khoá trong kho -> KB.cau trả MỐC HỤT, bot bị chặn gửi");
});

test("câu tra ra được, KHÔNG dính mốc hụt", () => {
  // Tra hụt thì vetTruocKhiGui chặn -> bot im, y hệt lỗi đang sửa.
  const c = execFileSync(process.execPath, ["-e",
    `const KB=require("./loi/cau_noi/kho_kich_ban");process.stdout.write(KB.cau("anh_thieu_dong_sheet"))`],
    { cwd: GOC, encoding: "utf8" }).split("\n").pop();
  assert.ok(c.length > 20, "câu rỗng");
  assert.ok(c.indexOf(String.fromCharCode(0)) < 0, "dính MỐC HỤT -> sẽ bị chặn gửi");
});

test("câu KHÔNG bị isWaitHandoffMsg nuốt", () => {
  // Cái bẫy: sendInboxMessage nuốt mọi câu báo-chờ. Câu đầu tiên tôi viết là
  // "kiểm tra lại thông tin rồi báo chị" -> khớp luật 3 -> khách không nhận
  // được gì, y hệt lỗi đang sửa. Test này khoá lại để lần sau sửa câu không tái phạm.
  const s = {};
  new Function("s", "with (s) {" + thanHam("isWaitHandoffMsg") + "\n s.f = isWaitHandoffMsg; }")(s);
  const c = execFileSync(process.execPath, ["-e",
    `const KB=require("./loi/cau_noi/kho_kich_ban");process.stdout.write(KB.cau("anh_thieu_dong_sheet"))`],
    { cwd: GOC, encoding: "utf8" }).split("\n").pop();
  assert.strictEqual(s.f(c), false,
    `câu "${c}" bị coi là báo-chờ -> sendInboxMessage NUỐT -> bot lại im. Tránh cụm "chờ/đợi ... kiểm tra" và "kiểm tra ... rồi báo".`);
});

// --- 5. Log phải in mã, nếu không lần sau lại phải đoán ---------------------
test("log VISION in cả MÃ khi hỏng", () => {
  // Dòng log cũ chỉ có reason/score/gap -> nhìn không biết là ảnh lạ hay mã
  // thiếu dòng. Đã đoán sai một lần vì thiếu đúng thông tin này.
  const k = thanHam("getProductsFromImages");
  assert.match(k, /reason: r\?\.reason \|\| r\?\.vision\?\.reason, code:/,
    "nhánh log hỏng chưa in code");
});
