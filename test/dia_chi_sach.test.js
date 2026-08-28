// ============================================================================
// test/dia_chi_sach.test.js — ĐỊA CHỈ PHẢI SẠCH, KHÔNG NUỐT CÂU CHAT
// ----------------------------------------------------------------------------
// Đo trên page THẬT 25/08/2026. Khách nhắn "thế gửi gấp cho e set này nha".
// Bot lưu vào bộ nhớ:
//     address: "Thanh Xuân, Hà Nội, ấp cho e set này"
// rồi đọc nguyên chuỗi đó ra cho khách xác nhận. Đơn thật đi với địa chỉ này là
// giao hỏng.
//
// Chuỗi lỗi:
//   cleanAddress("thế gửi gấp cho e set này nha") -> "ấp cho e set này"
//       (chữ "ấp" nằm trong danh sách từ khoá địa chỉ — đúng cho "ấp 3 Tân Kiên",
//        sai cho "g|ấp cho e")
//   _mergeIfPartial ghép mảnh đó vào địa chỉ cũ chưa đủ giao -> ra chuỗi bẩn
//
// Gốc: dòng cuối cleanAddress là `return a || addr` — KHÔNG BAO GIỜ trả rỗng.
// Gọt rác xong chẳng còn gì là địa chỉ thì nó vẫn trả phần thừa.
//
// Vá: chốt cuối — kết quả phải có ÍT NHẤT một dấu hiệu địa chỉ thật (chữ số,
// hoặc tên phường/xã/quận/tỉnh tra được trong danh mục hành chính).
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

// Đọc cleanAddress ra khỏi mã rồi chạy — bot_worker không có module.exports.
function layHam(ten) {
  const i = SRC.indexOf("function " + ten + "(");
  assert.ok(i > 0, `không thấy ${ten}`);
  let sau = 0;
  for (let k = SRC.indexOf("{", i); k < SRC.length; k++) {
    if (SRC[k] === "{") sau++;
    else if (SRC[k] === "}" && --sau === 0) return SRC.slice(i, k + 1);
  }
  assert.fail("không đóng được ngoặc " + ten);
}
const scope = { _va: require("../loi/tien_ich/vn_address"), console: { log() {} } };
new Function("s", "with (s) {" + layHam("cleanAddress") + "\n s.clean = cleanAddress; }")(scope);
const clean = scope.clean;

test("câu chat KHÔNG có địa chỉ -> trả RỖNG", () => {
  for (const c of [
    "thế gửi gấp cho e set này nha",   // đúng câu gây lỗi ngoài thật
    "gửi gấp cho e nhé",
    "e cần gấp",
    "tư vấn cho mình những mẫu này với",
    "ok em"
  ]) {
    assert.strictEqual(clean(c), "", `"${c}" phải trả rỗng, không được trả mảnh rác`);
  }
});

test("địa chỉ THẬT vẫn giữ nguyên — vá không được làm hỏng cái đang chạy", () => {
  for (const c of [
    "25 Lý Thường Kiệt, Hoàn Kiếm, Hà Nội",
    "Thanh Xuân, Hà Nội",
    "ngõ 20 Trần Duy Hưng, Cầu Giấy"
  ]) {
    assert.strictEqual(clean(c), c, `"${c}" là địa chỉ thật, phải giữ nguyên`);
  }
});

test('chữ "ấp" hợp lệ khi có số — không cấm nhầm địa chỉ miền Nam', () => {
  // Nới tay sai hướng là chặn luôn "ấp 3 Tân Kiên" — địa chỉ thật của cả vùng.
  assert.strictEqual(clean("ấp 3 Tân Kiên, Bình Chánh"), "ấp 3 Tân Kiên, Bình Chánh");
});

test("chốt cuối dựa trên SỐ hoặc DANH MỤC hành chính, không đoán theo chữ", () => {
  const i = SRC.indexOf("CHỐT CUỐI: kết quả phải CÓ DẤU HIỆU ĐỊA CHỈ THẬT");
  assert.ok(i > 0, "thiếu chốt cuối trong cleanAddress");
  const k = SRC.slice(i, i + 1400);
  assert.match(k, /_va\.hasAreaToken/, "phải tra danh mục phường/xã/quận");
  assert.match(k, /explicitProvince/, "phải nhận cả tên tỉnh/thành");
  assert.match(k, /return "";/, "không đạt thì phải trả rỗng");
});

test("địa danh KHÔNG kèm số vẫn được giữ", () => {
  // "Thanh Xuân, Hà Nội" không có chữ số nào nhưng là địa chỉ thật (chưa đủ giao,
  // nhánh khác sẽ xin thêm số nhà). Chặn nhầm là mất luôn phần khách đã cho.
  assert.notStrictEqual(clean("Cầu Giấy, Hà Nội"), "");
});
