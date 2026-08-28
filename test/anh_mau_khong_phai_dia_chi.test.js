// ============================================================================
// test/anh_mau_khong_phai_dia_chi.test.js — ẢNH MẪU KHÔNG PHẢI ẢNH ĐỊA CHỈ
// ----------------------------------------------------------------------------
// Có một nhánh: khách gửi ẢNH chụp địa chỉ -> bot KHÔNG tự OCR điền vào đơn
// (OCR hay đọc rác), mà giao người thật. Nhánh này đúng và phải giữ.
//
// Nhưng nó TỪNG không nhìn khách nói gì. Điều kiện chỉ có:
//     có ảnh + bot vừa nhắc "địa chỉ" + địa chỉ chưa đủ + vision trượt
//
// Đo trên page THẬT 25/08/2026:
//     Khách : [ảnh mẫu] + "tư vấn em mẫu này với"
//     AI-READ  : PRICE_ASK        <- hiểu ĐÚNG
//     AI-QUYẾT : TU_VAN           <- hiểu ĐÚNG
//     Bot   : gắn AI-CHỜ XL, "Khách gửi ĐỊA CHỈ bằng ẢNH"
//     Khách : không nhận được gì
//
// Vision trượt (LOW_CONFIDENCE 0.79) là chuyện THƯỜNG với ảnh mẫu, không phải
// bằng chứng đó là ảnh địa chỉ.
//
// Lỗi thứ hai trong cùng nhánh: câu giải thích chứa "chờ em kiểm tra lại" nên
// bị isWaitHandoffMsg nuốt ở cửa gửi -> khách im bặt, không hiểu vì sao.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

function khucNhanh() {
  const i = SRC.indexOf("Khách gửi ĐỊA CHỈ bằng ẢNH");
  assert.ok(i > 0, "không thấy nhánh ảnh-địa-chỉ");
  return SRC.slice(Math.max(0, i - 2200), i + 200);
}

test("nhánh phải xét khách có đang HỎI SẢN PHẨM không", () => {
  const k = khucNhanh();
  assert.match(k, /_hoiSanPham/, "thiếu chốt — ảnh mẫu lại bị nhận nhầm là ảnh địa chỉ");
  assert.match(k, /&&\s*!_hoiSanPham/, "chốt phải nằm TRONG điều kiện của nhánh");
});

test("nhận ra mấy cách khách hay nói khi gửi ảnh mẫu", () => {
  const k = khucNhanh();
  for (const t of ["PRICE_ASK", "tư vấn", "mẫu", "bao nhiêu"]) {
    assert.ok(k.includes(t), `chốt chưa bắt được dấu hiệu "${t}"`);
  }
});

test("câu giải thích KHÔNG được dính cụm báo-chờ, nếu không sẽ bị nuốt", () => {
  const k = khucNhanh();
  const m = k.match(/const reply = "(Dạ em nhận được ảnh[^"]*)"/);
  assert.ok(m, "không thấy câu giải thích của nhánh");
  const cau = m[1];

  // Chạy đúng bộ lọc của cửa gửi, không đoán.
  const i = SRC.indexOf("function isWaitHandoffMsg");
  let sau = 0, than = "";
  for (let k2 = SRC.indexOf("{", i); k2 < SRC.length; k2++) {
    if (SRC[k2] === "{") sau++;
    else if (SRC[k2] === "}" && --sau === 0) { than = SRC.slice(i, k2 + 1); break; }
  }
  const scope = {};
  new Function("s", "with (s) {" + than + "\n s.f = isWaitHandoffMsg; }")(scope);

  assert.strictEqual(scope.f(cau), false,
    `câu này bị isWaitHandoffMsg nuốt -> khách không nhận được gì: "${cau.slice(0, 60)}…"`);
});

test("vẫn giữ nguyên việc KHÔNG tự OCR địa chỉ từ ảnh", () => {
  // Nới tay quá là bot lại tự đọc địa chỉ trong ảnh rồi điền vào đơn — đúng thứ
  // nhánh này sinh ra để chặn.
  const k = khucNhanh();
  assert.match(k, /tagChoXuLyVaUnread/, "vẫn phải giao người thật khi đúng là ảnh địa chỉ");
  assert.match(k, /isGarbageAddress/, "vẫn phải xoá rác OCR tồn đọng");
});
