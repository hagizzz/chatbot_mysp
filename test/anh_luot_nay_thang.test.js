// ============================================================================
// test/anh_luot_nay_thang.test.js — AI ĐOÁN BẰNG CHỮ ĐÈ LÊN ẢNH KHÁCH VỪA GỬI
// ----------------------------------------------------------------------------
// Shop báo 26/08/2026, ca thử Hà Giang: "trong tn mới nhất, tôi hỏi set ở dưới
// có màu khác không, nhưng bot lại trả lời với set trước đó".
//
// Log page thật, đúng lượt đó:
//     Tin: text: set này có màu khác không ạ | image: [Photo]
//     VISION  : MMVX5282 (Grandeur) điểm 0,9797 cách biệt 0,1083   <- ĐÚNG
//     FOCUS   : image | lock=MGKSQ6072 -> MMVX5282 | switch=true    <- ĐÚNG
//     AI-QUYẾT: referent=MGKSQ6072 (tin cậy 1)                      <- SAI
//     [AI-QUYẾT referent] ĐÈ focus: MMVX5282 -> MGKSQ6072
//     [Bảo Trâm] Hỏi màu -> mẫu 1 màu (xanh).      <- màu của MẪU CŨ
//
// GỐC RỄ: AI-QUYẾT KHÔNG NHÌN THẤY ẢNH. Bản ghi hội thoại đưa cho nó (dựng ở
// ~dòng 7098) rút mọi tin ảnh thành đúng chữ "[gửi ảnh]" — không mã, không tên
// mẫu. Danh sách ứng viên thì có "mẫu đang khoá từ TRƯỚC". Khách gửi ảnh mẫu MỚI
// kèm câu trỏ mơ hồ ("set này…") thì AI chỉ còn mẫu cũ để chọn, chọn với độ tin
// cậy 1,0, rồi lấy chính con số đó đè lên vision.
//
// Không phải AI kém — nó bị hỏi một câu mà nó không có dữ kiện để trả lời.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

function khoiDe() {
  const i = SRC.indexOf("// ===== [AI-QUYẾT referent] AI đọc hội thoại quyết KHÁCH ĐANG NÓI MẪU NÀO =====");
  assert.ok(i > 0, "không thấy khối đè referent");
  const j = SRC.indexOf('// ===== "Bắt đầu"/"ib"/chào mở đầu', i);
  assert.ok(j > i, "không thấy mốc kết thúc khối");
  return SRC.slice(i, j);
}

// --- 1. Đai phải tồn tại và đứng ĐÚNG CHỖ ----------------------------------
test("có đai chặn: ảnh của LƯỢT NÀY thì AI không được đè", () => {
  const k = khoiDe();
  assert.match(k, /_focusTuAnhLuotNay/, "thiếu đai -> lỗi Hà Giang quay lại nguyên vẹn");
  assert.match(k, /_maAnhLuotNay = \(fromImages \|\| \[\]\)\.map\(_codeUp\)/,
    "phải lấy mã từ fromImages (ảnh CỦA LƯỢT NÀY), không phải từ bộ nhớ");
});

test("đai đứng TRƯỚC nhánh đè — đứng sau thì đè xong mới kiểm, vô nghĩa", () => {
  const k = khoiDe();
  const iDai = k.indexOf("if (_focusTuAnhLuotNay)");
  const iDe  = k.indexOf("ĐÈ focus:");
  assert.ok(iDai > 0 && iDe > iDai, "đai phải chặn trước khi tới lệnh đè");
});

test("KHÔNG bỏ đai đa-mẫu cũ (ca Tuệ Oanh / Móm Yêu)", () => {
  // Đai mới là thêm, không phải thay. Bỏ đai cũ là mở lại lỗi khác.
  assert.match(khoiDe(), /LƯỢT ĐA MẪU/, "mất đai đa mẫu");
});

test("log nói rõ VÌ SAO không đè", () => {
  // Không có dòng này thì lần sau đọc log chỉ thấy AI im, không biết bị đai chặn
  // hay AI vốn đồng ý với luật cũ.
  assert.match(khoiDe(), /ẢNH LƯỢT NÀY đã ra .* AI KHÔNG đè/);
});

// --- 2. Điều kiện đai chạy đúng trên số liệu ca thật ------------------------
function boDoDieuKien() {
  const k = khoiDe();
  const m = /const _maAnhLuotNay = ([\s\S]*?)\n\s*const _focusTuAnhLuotNay = ([\s\S]*?);/.exec(k);
  assert.ok(m, "không bóc được điều kiện đai");
  const s = {};
  new Function("s",
    "s.f = function (fromImages, _oldCode) {" +
    "  const _codeUp = p => String((p && p.code) || '').toUpperCase();" +
    "  const _maAnhLuotNay = " + m[1].trim() +
    "  const _focusTuAnhLuotNay = " + m[2].trim() + ";" +
    "  return _focusTuAnhLuotNay; };")(s);
  return s.f;
}

test("dựng lại ĐÚNG ca Hà Giang: ảnh ra MMVX5282 -> chặn đè", () => {
  const f = boDoDieuKien();
  assert.strictEqual(f([{ code: "MMVX5282" }], "MMVX5282"), true,
    "focus đến từ ảnh lượt này -> PHẢI chặn, không thì bot lại trả lời mẫu cũ");
});

test("khách KHÔNG gửi ảnh lượt này -> AI vẫn được đè như cũ", () => {
  // Đai phải hẹp. Rộng tay là vô hiệu hoá AI-QUYẾT ở mọi ca nó đang làm đúng.
  const f = boDoDieuKien();
  assert.strictEqual(f([], "MGKSQ6072"), false, "không ảnh -> AI cứ đè");
  assert.strictEqual(f(null, "MGKSQ6072"), false, "fromImages rỗng -> AI cứ đè");
});

test("focus KHÔNG đến từ ảnh (ảnh ra mã khác) -> AI vẫn được đè", () => {
  const f = boDoDieuKien();
  assert.strictEqual(f([{ code: "MMVX5282" }], "MGKSQ6072"), false,
    "focus là mẫu khoá cũ chứ không phải mẫu trong ảnh -> đai không được với tay tới");
});

test("không có focus (_oldCode = '-') thì đai KHÔNG bật", () => {
  const f = boDoDieuKien();
  assert.strictEqual(f([{ code: "MMVX5282" }], "-"), false,
    "'-' là mã giả khi chưa có mẫu nào; coi nó là mã thật thì đai bật bừa");
  assert.strictEqual(f([{ code: "MMVX5282" }], ""), false);
});

test("so mã KHÔNG phân biệt hoa thường", () => {
  const f = boDoDieuKien();
  assert.strictEqual(f([{ code: "mmvx5282" }], "MMVX5282"), true,
    "catalog và vision không phải lúc nào cũng cùng kiểu chữ");
});

// --- 3. Ghi lại GỐC RỄ để lần sau không sửa nhầm chỗ ------------------------
test("AI-QUYẾT vẫn chỉ nhận '[gửi ảnh]' — đai là vá, chưa phải chữa gốc", () => {
  // Chữa gốc = đưa mã vision của ảnh khách gửi LƯỢT NÀY vào danh sách ứng viên
  // của AI-QUYẾT. Chừng nào dòng này còn đúng thì AI vẫn đoán mù, và đai bên
  // trên là thứ duy nhất giữ cho bot trả lời đúng mẫu.
  assert.match(SRC, /m\.text \? String\(m\.text\)\.replace\(\/\\s\+\/g, " "\)\.slice\(0, 160\) : "\[gửi ảnh\]"/,
    "nếu đã sửa chỗ này để AI thấy mẫu trong ảnh -> cập nhật lại test và cân nhắc nới đai");
});

test("ứng viên đưa cho AI có 'mẫu đang khoá từ TRƯỚC' — nguồn của cú đoán sai", () => {
  assert.match(SRC, /mẫu đang khoá từ TRƯỚC trong hội thoại/,
    "đây là ứng viên duy nhất AI có khi khách gửi ảnh mẫu mới + câu trỏ mơ hồ");
});
