// ============================================================================
// test/hop_dip_mau_nay.test.js — "MẪU NÀY MẶC ĐI <DỊP> ĐƯỢC KHÔNG"
// ----------------------------------------------------------------------------
// Shop đọc tin thật 25/08/2026 và chỉ ra: khách hỏi "mẫu này mặc đi tiệc ở cty
// được k shop", bot đáp "Dạ mẫu này chị cho em xin ít phút để em xác nhận lại
// thông tin với bên kho..." — "thiếu mục trả lời câu hỏi chính của khách".
//
// Đúng: câu đó chỉ nói về việc CỦA SHOP (thiếu dữ liệu), không đụng gì tới điều
// khách hỏi (mặc đi tiệc có hợp không).
//
// Đào ra thì thấy gốc sâu hơn: có HAI kiểu câu hỏi dịp, chỉ một kiểu được xử.
//   · "có đồ đi biển không"          -> nhánh ĐI BIỂN, gửi gallery lọc cột beach
//   · "mẫu NÀY mặc đi tiệc được ko"  -> nhánh ĐI BIỂN CỐ Ý loại ra -> KHÔNG ai nhận
// Kiểu thứ hai đã nằm sẵn trong danh sách 4 ca im lặng ghi ở cổng chặn cuối:
//   "váy này mặc đi ăn cưới có hợp không em" -> [AI-READ] nhãn=OCCASION_QA rồi ... hết.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

function than(ten) {
  const i = SRC.indexOf("function " + ten + "(");
  assert.ok(i > 0, `không thấy ${ten}`);
  let sau = 0;
  for (let k = SRC.indexOf("{", i); k < SRC.length; k++) {
    if (SRC[k] === "{") sau++;
    else if (SRC[k] === "}" && --sau === 0) return SRC.slice(i, k + 1);
  }
  assert.fail("không đóng ngoặc " + ten);
}
// dipKhachHoi cần bảng _DIP_KHACH -> kéo cả khai báo vào.
function boDoDip() {
  const i = SRC.indexOf("const _DIP_KHACH = [");
  assert.ok(i > 0, "thiếu bảng dịp");
  const j = SRC.indexOf("];", i) + 2;
  const s = {};
  new Function("s", "with (s) {" + SRC.slice(i, j) + "\n" + than("dipKhachHoi") + "\n s.f = dipKhachHoi; }")(s);
  return s.f;
}

// --- 1. Dò đúng dịp khách nói -----------------------------------------------
test("dò được dịp trong câu thật của khách", () => {
  const f = boDoDip();
  assert.strictEqual(f("mẫu này mặc đi tiệc ở cty được k shop"), "đi tiệc công ty",
    "chính câu shop chỉ ra — phải nhận được");
  assert.strictEqual(f("váy này mặc đi ăn cưới có hợp không em"), "đi ăn cưới",
    "ca im lặng đã ghi ở cổng chặn cuối");
  assert.strictEqual(f("mẫu này đi làm mặc được không"), "đi làm");
  assert.strictEqual(f("set này mặc đi chơi ổn không shop"), "đi chơi");
  assert.strictEqual(f("váy này mặc đi biển được ko"), "đi biển");
});

test("CỤ THỂ thắng CHUNG CHUNG — không được trả 'đi tiệc' cho tiệc công ty", () => {
  // "tiệc ở cty" khớp cả /đi tiệc/ lẫn /công ty/. Trả sai thì câu trả lời nhắc
  // lại lệch hẳn ý khách: khách nói tiệc công ty, bot nói "đi làm".
  const f = boDoDip();
  assert.strictEqual(f("đi tiệc ở công ty"), "đi tiệc công ty");
  assert.strictEqual(f("mặc đi dự tiệc cưới"), "đi ăn cưới", "cưới cụ thể hơn tiệc");
});

test("không có dịp thì trả rỗng, không đoán bừa", () => {
  const f = boDoDip();
  for (const c of ["mẫu này bao nhiêu tiền", "còn size M không shop", ""]) {
    assert.strictEqual(f(c), "", `"${c}" không nêu dịp nào`);
  }
});

// --- 2. Câu báo chờ phải NHẮC LẠI câu khách hỏi ------------------------------
test("thiếu dòng Sheet + khách nêu dịp -> dùng câu CÓ nhắc dịp", () => {
  const i = SRC.indexOf("ẢNH NHẬN RA RỒI NHƯNG MÃ THIẾU DÒNG SHEET");
  const k = SRC.slice(i, SRC.indexOf("// OCR ảnh hay đọc RÁC", i));
  assert.match(k, /const _dip = dipKhachHoi\(latestText\)/, "chưa dò dịp");
  assert.match(k, /anh_thieu_dong_sheet__co_dip/, "chưa dùng câu có nhắc dịp");
  assert.match(k, /KB\.cau\("anh_thieu_dong_sheet"\)/, "vẫn phải có đường không-có-dịp");
});

test("câu có-dịp nhắc lại dịp và KHÔNG phán mẫu hợp/không hợp", () => {
  // Không có dòng Sheet = không có căn cứ nào. Phán "hợp lắm ạ" đúng cái shop sợ nhất.
  const c = execFileSync(process.execPath, ["-e",
    `const KB=require("./loi/cau_noi/kho_kich_ban");process.stdout.write(KB.cau("anh_thieu_dong_sheet__co_dip",{dip:"đi tiệc công ty"}))`],
    { cwd: GOC, encoding: "utf8" }).split("\n").pop();
  assert.match(c, /đi tiệc công ty/, "không nhắc lại dịp thì vẫn là lỗi shop đã chỉ ra");
  assert.ok(!/(rất hợp|hợp lắm|đẹp lắm|được nha)/.test(c),
    `chưa có dữ liệu mà đã phán: "${c}"`);
});

// --- 3. Nhánh trả lời thật cho "mẫu NÀY" ------------------------------------
function khoiHopDip() {
  const i = SRC.indexOf('"MẪU NÀY MẶC ĐI <DỊP> ĐƯỢC KHÔNG"');
  assert.ok(i > 0, "chưa có nhánh trả lời hợp dịp cho mẫu đang xem");
  const j = SRC.indexOf("if (asksSkinToneFit(latestText)", i);
  assert.ok(j > i, "không thấy mốc kết thúc nhánh");
  return SRC.slice(i, j);
}

test("có nhánh TRẢ LỜI, không phải chỉ gắn thẻ rồi im", () => {
  const k = khoiHopDip();
  assert.match(k, /await sendInboxMessage\(conversationId, reply\)/);
  assert.match(k, /KB\.cau\("hop_dip__mau_nay"/, "câu phải nằm trong kho, shop sửa được");
});

test("chỉ chạy khi CÓ dòng Sheet — không có thì để nhánh thiếu-dòng lo", () => {
  const k = khoiHopDip();
  assert.match(k, /_dipHoi && productInfo/,
    "thiếu chốt productInfo -> đọc category/material của undefined, hoặc bịa khi không có dữ liệu");
});

test("KHÔNG cướp lượt của nhánh ĐI BIỂN (nhánh đó có dữ liệu thật, cột beach)", () => {
  assert.match(khoiHopDip(), /!asksBeachWear\(latestText\)/,
    "cướp lượt là mất luôn gallery lọc theo cột beach");
});

test("nhận cả nhãn AI lẫn cách gọi 'mẫu này' bằng chữ", () => {
  const k = khoiHopDip();
  assert.match(k, /_ai\("OCCASION_QA"\)/);
  assert.match(k, /_ai\("FIT_SUITABILITY"\)/);
  assert.match(k, /_hoiMauNay/, "AI trượt nhãn thì còn đường chữ đỡ");
});

test("câu trả lời nêu chủng loại + chất liệu LẤY TỪ Sheet, không tự nghĩ ra", () => {
  const k = khoiHopDip();
  assert.match(k, /productInfo\.category/, "chủng loại phải từ dòng Sheet");
  assert.match(k, /productInfo\.material/, "chất liệu phải từ dòng Sheet");
});

test("cột chất liệu TRỐNG thì câu không bị cụt", () => {
  // Nhiều mã bỏ trống cột chất liệu -> ghép thô thành "là set quần, ạ".
  const doc = (bien) => execFileSync(process.execPath, ["-e",
    `const KB=require("./loi/cau_noi/kho_kich_ban");process.stdout.write(KB.cau("hop_dip__mau_nay",${JSON.stringify(bien)}))`],
    { cwd: GOC, encoding: "utf8" }).split("\n").pop();
  const trong = doc({ dip: "đi ăn cưới", loai: "váy", chatVe: "" });
  assert.ok(!/,\s*ạ/.test(trong), `câu cụt khi thiếu chất liệu: "${trong}"`);
  assert.match(trong, /đi ăn cưới/, "phải nhắc lại dịp");
  const co = doc({ dip: "đi làm", loai: "set quần", chatVe: ", chất linen" });
  assert.match(co, /chất linen/);
});

test("nhớ khách mua CHO DỊP để câu chúc sau khi chốt bám đúng dịp", () => {
  assert.match(khoiHopDip(), /_boughtForOccasion = true/);
});
