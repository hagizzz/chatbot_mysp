// ============================================================================
// test/dia_chi.test.js — CHUẨN HOÁ ĐỊA CHỈ THEO DANH MỤC HÀNH CHÍNH 2025
// ----------------------------------------------------------------------------
// Đây là chỗ dễ vỡ âm thầm nhất: sáp nhập tỉnh 2025 làm khách và POS gọi tên khác
// nhau ("Nha Trang" là phường mới nhưng khách vẫn ghi "Khánh Hoà"). Vỡ ở đây thì
// đơn không lên được mà log không báo lỗi gì.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const { fold, explicitProvince, inferProvince, provinceDisplay } = require("../vn_address");

test("bỏ dấu và chuẩn hoá", () => {
  assert.strictEqual(fold("Hà Nội"), "ha noi");
  assert.strictEqual(fold("ĐÀ NẴNG"), "da nang");
  assert.strictEqual(fold("Bà  Rịa   Vũng Tàu"), "ba ria vung tau");
});

test("khách ghi rõ tỉnh -> nhận đúng", () => {
  const ca = [
    ["số 5 ngõ 2 Trần Duy Hưng, Cầu Giấy, Hà Nội", "ha noi"],
    ["12 Nguyễn Huệ, quận 1, TP HCM", "hcm"],
    ["45 Lê Duẩn, Hải Châu, Đà Nẵng", "da nang"]
  ];
  for (const [addr, mong] of ca) {
    const r = explicitProvince(fold(addr));   // hàm nhận chuỗi ĐÃ bỏ dấu — đúng hợp đồng của vn_address
    assert.ok(r, `không nhận ra tỉnh trong "${addr}"`);
    assert.match(fold(String(r)), new RegExp(mong), `"${addr}" -> ${r}, mong ${mong}`);
  }
});

test("khách KHÔNG ghi tỉnh -> suy từ phường/xã, suy không ra thì trả rỗng chứ không đoán bừa", () => {
  const r = inferProvince(fold("một địa chỉ hoàn toàn vô nghĩa xyz 123"));
  assert.ok(!r || r === null || String(r).length === 0,
    "không suy ra được thì phải trả rỗng — đoán bừa tỉnh là gửi hàng sai nơi");
});

test("tên tỉnh hiển thị ổn định (POS khớp theo tên này)", () => {
  const d = provinceDisplay("ha noi");
  assert.ok(typeof d === "string" && d.length > 0, "phải trả tên hiển thị cho tỉnh đã biết");
});
