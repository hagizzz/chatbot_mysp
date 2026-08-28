// ============================================================================
// test/hoi_hop_dip.test.js — HỎI HỢP DỊP KHÔNG PHẢI LÀ CÓ DEADLINE
// ----------------------------------------------------------------------------
// Đo trên page THẬT 25/08/2026:
//     Khách   : "mẫu này mặc đi tiệc ở cty được k shop" + ảnh
//     AI-READ : OCCASION_QA          <- đọc ĐÚNG
//     Bot     : gắn 185 ĐƠN ƯU TIÊN rồi IM
//     Log     : [DISPATCH] URGENT (deadline/gấp - code mốc ngày)
//
// Khách hỏi mẫu có HỢP DỊP không, bị đọc thành "tôi có tiệc, cần gấp". Rồi đẩy
// vào hàng đợi đơn gấp và không trả lời gì.
//
// Nguyên nhân: isUrgentSpecificDate mục (3) bắt mọi câu có "đi tiệc / đám cưới /
// sự kiện" là gấp. Nhánh C2 chạy theo regex đó, KHÔNG nhìn nhãn AI.
//
// Tài liệu yêu cầu tách bạch hai việc:
//   OCCASION_QA — "hỏi mẫu cho DỊP: đi biển / đi tiệc / đi cưới / công sở"  -> TƯ VẤN
//   URGENT      — "khách có DEADLINE: mai chị đi, T4 là đi rồi, cần gấp"    -> người thật
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

// Chạy chính hàm dò trong mã, không đoán.
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
const sc = {};
new Function("s", "with (s) {" + layHam("isUrgentSpecificDate") + "\n s.f = isUrgentSpecificDate; }")(sc);

test("bộ dò regex VẪN bắt mấy câu có deadline thật", () => {
  // Không được nới tay: khách có deadline thật thì phải vào hàng đợi ưu tiên.
  for (const c of [
    "mai chị đi rồi, kịp không em",
    "cần gấp nhé shop",
    "thứ 4 chị cần mặc",
    "chị có tiệc, gửi nhanh giúp"
  ]) {
    assert.strictEqual(sc.f(c), true, `"${c}" là deadline thật, phải bắt`);
  }
});

test("bộ dò TỰ phân biệt được câu HỎI HỢP DỊP", () => {
  // Ban đầu tôi chỉ rào ở MỘT nơi gọi (nhánh DISPATCH). Hàm này có 5 nơi gọi; giả lập
  // bắt được nhánh isPriorityOrder vẫn gắn 185 y như cũ. -> Rào chuyển vào chính hàm.
  for (const c of [
    "mẫu này mặc đi tiệc ở cty được k shop",
    "váy này mặc đi ăn cưới có hợp không em",
    "set này đi tiệc ổn không shop",
    "đầm này mặc dự tiệc được chứ"
  ]) {
    assert.strictEqual(sc.f(c), false, `"${c}" là HỎI HỢP DỊP, không phải deadline`);
  }
});

test("có thêm MỐC NGÀY thì vẫn là gấp, dù câu ở dạng hỏi", () => {
  // "mẫu này mặc đi tiệc THỨ 5 được không" -> khách có deadline thật, mục 1/2 phải bắt.
  for (const c of [
    "mẫu này mặc đi tiệc thứ 5 được không",
    "váy này đi ăn cưới ngày mai kịp không em",
    "set này đi tiệc tối nay có kịp ko"
  ]) {
    assert.strictEqual(sc.f(c), true, `"${c}" CÓ mốc ngày -> vẫn phải tính là gấp`);
  }
});

test("rào nằm TRONG hàm, không phải ở từng nơi gọi", () => {
  // 5 nơi gọi. Rào ở nơi gọi là chắc chắn sót — đã sót thật một lần.
  const i = SRC.indexOf("function isUrgentSpecificDate");
  const k = SRC.slice(i, i + 3000);
  assert.match(k, /_hoiHopDip = _troVaoMau && _duoiNghiVan/,
    "rào phải nằm trong chính bộ dò");
});

test("nhánh URGENT có rào _hoiHopDip", () => {
  const i = SRC.indexOf("HỎI HỢP DỊP ≠ CÓ DEADLINE");
  assert.ok(i > 0, "thiếu rào hỏi-hợp-dịp");
  const k = SRC.slice(i, i + 1600);
  assert.match(k, /_hoiHopDip/, "thiếu biến rào");
  assert.match(k, /_ai\("OCCASION_QA"\)/, "phải nhận nhãn OCCASION_QA");
  assert.match(k, /_ai\("FIT_SUITABILITY"\)/, "hỏi hợp dáng cũng cùng loại");
  assert.match(k, /isUrgentSpecificDate\(latestText\) && !_hoiHopDip/,
    "rào phải chặn ĐÚNG nhánh regex, không chặn nhánh nhãn AI");
});

test("nhãn URGENT THẬT của AI vẫn đi qua, không bị rào chặn", () => {
  // Khách vừa hỏi hợp dịp vừa nói gấp thật -> AI gắn URGENT -> phải vào hàng ưu tiên.
  const i = SRC.indexOf("HỎI HỢP DỊP ≠ CÓ DEADLINE");
  const k = SRC.slice(i, i + 1600);
  assert.match(k, /if \(_ai\("URGENT"\)\s*\n?\s*\|\|/,
    "nhánh nhãn AI phải đứng riêng, KHÔNG kèm !_hoiHopDip");
});
