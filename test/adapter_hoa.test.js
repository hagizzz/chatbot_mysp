// ============================================================================
// test/adapter_hoa.test.js — BẢNG QUYẾT ĐỊNH CHUYỂN KHOẢN (mục 7)
// ----------------------------------------------------------------------------
// Mục 7 nói rõ: khớp chắc chắn thì bot xác nhận, KHÔNG chắc thì giao người thật.
// Đây là chỗ liên quan tới tiền của khách nên đóng đinh bằng test ngay từ GĐ0,
// trước cả khi hợp đồng API với hệ thống của Hoà được chốt.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const { quyetDinhChuyenKhoan, CHO_TOI_DA_MS } = require("../adapter_hoa");

test("khớp đủ tiền -> bot tự xác nhận", () => {
  const r = quyetDinhChuyenKhoan({ trang_thai: "khop_du", so_tien: 390000 });
  assert.strictEqual(r.hanhDong, "XAC_NHAN");
  assert.strictEqual(r.nguoiThat, false);
});

test("chưa thấy tiền, còn trong thời gian chờ -> báo khách chờ, chưa làm phiền người thật", () => {
  const r = quyetDinhChuyenKhoan({ trang_thai: "chua_thay" }, 60 * 1000);
  assert.strictEqual(r.hanhDong, "BAO_KHACH_CHO");
  assert.strictEqual(r.nguoiThat, false);
});

test("chờ quá lâu -> giao người thật", () => {
  const r = quyetDinhChuyenKhoan({ trang_thai: "chua_thay" }, CHO_TOI_DA_MS + 1);
  assert.strictEqual(r.hanhDong, "GIAO_NGUOI_THAT");
  assert.strictEqual(r.nguoiThat, true);
});

test("thiếu / thừa / không khớp / trạng thái lạ -> LUÔN giao người thật, bot không đoán", () => {
  for (const tt of ["thieu", "thua", "khong_khop", "", "abcxyz", null, undefined]) {
    const r = quyetDinhChuyenKhoan({ trang_thai: tt });
    assert.strictEqual(r.hanhDong, "GIAO_NGUOI_THAT", `trạng thái "${tt}" phải giao người thật`);
    assert.strictEqual(r.nguoiThat, true);
  }
});

test("kết quả rỗng / hỏng -> giao người thật chứ không tự xác nhận", () => {
  for (const x of [null, undefined, {}, { trang_thai: 123 }]) {
    assert.strictEqual(quyetDinhChuyenKhoan(x).nguoiThat, true);
  }
});
