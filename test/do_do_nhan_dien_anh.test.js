// ============================================================================
// test/do_do_nhan_dien_anh.test.js — LUẬT ĐẶT NGƯỠNG NHẬN DIỆN ẢNH
// ----------------------------------------------------------------------------
// Phần đo thật cần model CLIP; phần QUYẾT ĐỊNH thì thuần logic nên test được ngay.
// Điều phải giữ: một ca KHẲNG ĐỊNH NHẦM đắt hơn nhiều ca NHƯỜNG NGƯỜI THẬT, nên
// bộ chọn ngưỡng không bao giờ được đổi "sai" lấy "đúng".
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const { phanLoai, dem, timNguong, theoBienThe } = require("../loi/san_pham/do_do_nhan_dien_anh");

const ca = (maDung, maDoan, score, gap, bienThe = "cat") => ({ maDung, maDoan, score, gap, bienThe });

test("ba loại kết quả, không gộp 'sai' vào 'không quyết'", () => {
  assert.strictEqual(phanLoai(ca("A", "A", 0.9, 0.1), 0.8, 0.04), "dung");
  assert.strictEqual(phanLoai(ca("A", "B", 0.9, 0.1), 0.8, 0.04), "sai");
  assert.strictEqual(phanLoai(ca("A", "A", 0.7, 0.1), 0.8, 0.04), "khong_quyet");
  assert.strictEqual(phanLoai(ca("A", "A", 0.9, 0.01), 0.8, 0.04), "khong_quyet",
    "điểm cao nhưng hai mẫu sát nhau -> nhập nhằng -> phải nhường, không được đoán");
});

test("mã khác hoa/thường vẫn là một mã", () => {
  assert.strictEqual(phanLoai(ca("mrad5171", "MRAD5171", 0.9, 0.1), 0.8, 0.04), "dung");
});

test("đếm đủ, không sót ca nào", () => {
  const ds = [ca("A", "A", .9, .1), ca("A", "B", .9, .1), ca("A", "A", .5, .1)];
  const c = dem(ds, 0.8, 0.04);
  assert.strictEqual(c.dung + c.sai + c.khong_quyet, ds.length);
  assert.deepStrictEqual(c, { dung: 1, sai: 1, khong_quyet: 1 });
});

test("chọn ngưỡng: KHÔNG đổi một ca sai lấy thêm ca đúng", () => {
  const ds = [
    // ngưỡng thấp: được thêm 3 ca đúng nhưng kèm 1 ca khẳng định nhầm
    ca("A", "A", 0.70, 0.05), ca("B", "B", 0.71, 0.05), ca("C", "C", 0.72, 0.05),
    ca("D", "X", 0.73, 0.05),
    // ngưỡng cao: 2 ca đúng, sạch
    ca("E", "E", 0.92, 0.10), ca("F", "F", 0.93, 0.10)
  ];
  const { tot_nhat, datDuocSaiBang0 } = timNguong(ds);
  assert.strictEqual(datDuocSaiBang0, true);
  assert.strictEqual(tot_nhat.sai, 0, "thà nhường người thật còn hơn báo giá nhầm mẫu cho khách");
  assert.strictEqual(tot_nhat.dung, 2);
  // Loại ca nhầm bằng đường nào cũng được (nâng điểm hay siết khoảng cách),
  // miễn là ở cặp ngưỡng đã chọn nó KHÔNG còn được khẳng định.
  assert.notStrictEqual(phanLoai(ca("D", "X", 0.73, 0.05), tot_nhat.minScore, tot_nhat.minGap), "sai");
});

test("có ca sai ở MỌI ngưỡng -> nói thẳng là không phải chuyện ngưỡng", () => {
  // mẫu đúng bị chấm thấp hơn mẫu khác ở mọi mức -> chỉ mục có vấn đề, không phải ngưỡng
  const ds = [ca("A", "B", 0.99, 0.20), ca("C", "C", 0.95, 0.15)];
  const { datDuocSaiBang0 } = timNguong(ds);
  assert.strictEqual(datDuocSaiBang0, false);
});

test("giữa hai cặp ngưỡng cùng kết quả, chọn cặp dễ thở hơn", () => {
  const ds = [ca("A", "A", 0.95, 0.12), ca("B", "B", 0.96, 0.13)];
  const { tot_nhat } = timNguong(ds);
  assert.strictEqual(tot_nhat.dung, 2);
  assert.ok(tot_nhat.minScore <= 0.95,
    "ngưỡng chặt quá thì ảnh lạ ngoài bộ thử sẽ trượt oan hàng loạt");
});

test("bóc tách theo kiểu ảnh để biết hỏng ở đâu", () => {
  const ds = [ca("A", "A", .9, .1, "mo"), ca("B", "X", .9, .1, "mo"), ca("C", "C", .9, .1, "cat")];
  const b = theoBienThe(ds, 0.8, 0.04);
  assert.strictEqual(b.mo.dung, 1);
  assert.strictEqual(b.mo.sai, 1);
  assert.strictEqual(b.cat.dung, 1);
});
