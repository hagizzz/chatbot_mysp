// ============================================================================
// test/do_do_nhan.test.js — LUẬT ĐẶT NGƯỠNG do_tin_cay
// ----------------------------------------------------------------------------
// Phần đo thật cần API (do_do_nhan.js gọi gpt-4.1-mini, tốn tiền); phần QUYẾT
// ĐỊNH ngưỡng thì thuần logic nên test được ngay, offline.
//
// Điều phải giữ: bot TỰ TIN TRẢ SAI NHÁNH đắt hơn bot nhường người thật —
// nhưng "đỡ sai" không được phép trở thành "tắt bot". Đo thật 26/08/2026:
// luật cũ (xếp theo ít SAI nhất) chọn ngưỡng 0.95 -> SAI còn 1 nhưng ĐÚNG rơi
// 33 -> 11 và 30/42 lượt đẩy hết cho người thật. Bộ này khoá cả hai đầu.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const { phanLoai, dem, quetNguong, theoNhan } = require("../loi/san_pham/do_do_nhan");

const ca = (nhanDung, nhanDoan, diem) => ({ nhanDung, nhanDoan, diem });

// ---- phanLoai -------------------------------------------------------------
test("ba loại kết quả, không gộp 'sai' vào 'không quyết'", () => {
  assert.strictEqual(phanLoai(ca("PRICE_ASK", "PRICE_ASK", 0.9), 0.6), "dung");
  assert.strictEqual(phanLoai(ca("PRICE_ASK", "DISCOUNT", 0.9), 0.6), "sai");
  assert.strictEqual(phanLoai(ca("PRICE_ASK", "PRICE_ASK", 0.4), 0.6), "khong_quyet",
    "điểm dưới ngưỡng thì dù nhãn có khớp cũng KHÔNG tính là bot trả đúng — lượt đó người thật xử");
});

test("nhãn sai mà điểm thấp vẫn là 'không quyết', không phải 'sai'", () => {
  assert.strictEqual(phanLoai(ca("COMPLAINT", "OTHER", 0.4), 0.6), "khong_quyet",
    "AI tự nhận không chắc và nhường người -> mạng an toàn đã làm đúng việc của nó");
});

test("AI KHÔNG chấm điểm (null) = worker không chặn -> phải tính là ĐÃ QUYẾT", () => {
  assert.strictEqual(phanLoai(ca("PRICE_ASK", "DISCOUNT", null), 0.6), "sai",
    "tính null thành 'không quyết' là tự vẽ số đẹp: ngoài thật lượt đó bot vẫn trả khách");
  assert.strictEqual(phanLoai(ca("PRICE_ASK", "PRICE_ASK", null), 0.6), "dung");
});

test("nhãn khác hoa/thường vẫn là một nhãn", () => {
  assert.strictEqual(phanLoai(ca("price_ask", "PRICE_ASK", 0.9), 0.6), "dung");
});

// ---- dem ------------------------------------------------------------------
test("đếm đủ, không sót ca nào", () => {
  const ds = [ca("A", "A", 0.9), ca("A", "B", 0.9), ca("A", "A", 0.4)];
  const c = dem(ds, 0.6);
  assert.strictEqual(c.dung + c.sai + c.khong_quyet, ds.length);
  assert.deepStrictEqual(c, { dung: 1, sai: 1, khong_quyet: 1 });
});

test("ca CHƯA dán nhãn đúng thì không đếm, không được coi là đúng", () => {
  const c = dem([ca("", "PRICE_ASK", 0.9), ca("A", "A", 0.9)], 0.6);
  assert.deepStrictEqual(c, { dung: 1, sai: 0, khong_quyet: 0 });
});

// ---- quetNguong -----------------------------------------------------------
test("đạt được SAI=0 thì chọn ngưỡng đó, và lấy ngưỡng cho ĐÚNG nhiều nhất", () => {
  // sai chỉ xuất hiện ở điểm 0.5 -> mọi ngưỡng > 0.5 đều sạch; ngưỡng càng thấp càng nhiều ĐÚNG
  const ds = [ca("A", "B", 0.5), ca("A", "A", 0.6), ca("A", "A", 0.8), ca("A", "A", 0.95)];
  const { tot_nhat, datDuocSaiToiDa } = quetNguong(ds);
  assert.strictEqual(datDuocSaiToiDa, true);
  assert.strictEqual(tot_nhat.sai, 0);
  assert.strictEqual(tot_nhat.dung, 3, "phải giữ được cả 3 ca đúng, đừng siết quá tay");
});

test("KHÔNG ngưỡng nào sạch -> không được chọn ngưỡng giết hết ĐÚNG để đổi lấy ít SAI", () => {
  // 1 ca sai ở điểm rất cao (0.95) + 10 ca đúng rải từ 0.6 đến 0.9.
  // Xếp theo "ít SAI nhất" sẽ nhảy lên ngưỡng cao nhất và mất gần hết ĐÚNG.
  const ds = [ca("A", "B", 0.95)];
  for (let i = 0; i < 10; i++) ds.push(ca("A", "A", 0.6 + (i % 4) * 0.1));
  const { tot_nhat, datDuocSaiToiDa } = quetNguong(ds);
  assert.strictEqual(datDuocSaiToiDa, false);
  assert.ok(tot_nhat.dung >= 8,
    `ngưỡng đề xuất chỉ giữ ${tot_nhat.dung}/10 ca đúng — đó là tắt bot chứ không phải đặt ngưỡng`);
});

test("giaSai cao thì chấp nhận nhường người nhiều hơn để bớt SAI", () => {
  // 1 ca sai ở 0.7 (siết ngưỡng là cắt được) + 1 ca sai ở 0.95 (không ngưỡng nào cứu)
  // -> luôn rơi vào nhánh cân đo, và nhánh đó phải nghe theo giá của một ca SAI.
  const ds = [ca("A", "B", 0.7), ca("A", "B", 0.95), ca("A", "A", 0.6), ca("A", "A", 0.65)];
  const re = quetNguong(ds, { giaSai: 1 }).tot_nhat;      // SAI rẻ -> ngưỡng thấp, giữ ĐÚNG
  const dat = quetNguong(ds, { giaSai: 50 }).tot_nhat;    // SAI đắt -> siết ngưỡng
  assert.ok(dat.nguong > re.nguong, "giá SAI đắt lên mà ngưỡng không siết theo là luật cân đo hỏng");
  assert.ok(dat.sai < re.sai, "siết ngưỡng mà số ca SAI không giảm thì siết để làm gì");
});

test("bảng quét phủ đủ dải và mỗi dòng cộng lại đúng số ca", () => {
  const ds = [ca("A", "A", 0.9), ca("A", "B", 0.5), ca("A", "A", null)];
  const { bang } = quetNguong(ds);
  assert.ok(bang.length >= 13, "phải quét từ 0.30 đến 0.95");
  for (const r of bang) {
    assert.strictEqual(r.dung + r.sai + r.khong_quyet, ds.length, `dòng ngưỡng ${r.nguong} sót ca`);
  }
});

// ---- theoNhan -------------------------------------------------------------
test("gom theo NHÃN ĐÚNG để biết dòng luật nào trong prompt cần sửa", () => {
  const ds = [
    ca("PRICE_ASK", "PRICE_ASK", 0.9),
    ca("PRICE_ASK", "DISCOUNT", 0.9),
    ca("ORDER_STATUS", "DELIVERY_QA", 0.9)
  ];
  const b = theoNhan(ds, 0.6);
  assert.deepStrictEqual(b.PRICE_ASK, { dung: 1, sai: 1, khong_quyet: 0 });
  assert.deepStrictEqual(b.ORDER_STATUS, { dung: 0, sai: 1, khong_quyet: 0 });
});
