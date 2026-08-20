// ============================================================================
// test/dieu_tiet.test.js — SONG SONG CÓ KIỂM SOÁT
// ----------------------------------------------------------------------------
// Ba điều phải đúng trước khi dám bật song song trên bot đang chạy ra tiền:
//   1. một hội thoại không bao giờ bị hai luồng xử cùng lúc
//   2. một khách chậm không chặn khách khác  (mục 3.9)
//   3. gọi Pancake không vượt nhịp -> không tự chuốc 429
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const dt = require("../dieu_tiet");

const nghi = ms => new Promise(r => setTimeout(r, ms));

test("một hội thoại chỉ được xử lý bởi một luồng tại một thời điểm", async () => {
  let dangChay = 0, dinhNhau = 0;
  const viec = async () => {
    dangChay++;
    if (dangChay > 1) dinhNhau++;
    await nghi(20);
    dangChay--;
  };
  await Promise.all(Array.from({ length: 8 }, () => dt.khoaTheoKhoa("conv_A", viec)));
  assert.strictEqual(dinhNhau, 0, "hai luồng cùng xử một hội thoại = mất dữ liệu hoặc trả lời 2 lần");
});

test("hai hội thoại KHÁC nhau chạy song song, không chờ nhau", async () => {
  const t0 = Date.now();
  await Promise.all([
    dt.khoaTheoKhoa("conv_B", () => nghi(60)),
    dt.khoaTheoKhoa("conv_C", () => nghi(60))
  ]);
  const ms = Date.now() - t0;
  assert.ok(ms < 110, `hai hội thoại khác nhau phải chạy cùng lúc (mất ${ms} ms, lẽ ra ~60 ms)`);
});

test("một việc lỗi không chặn hàng đợi của chính hội thoại đó", async () => {
  const ra = [];
  const p1 = dt.khoaTheoKhoa("conv_D", async () => { throw new Error("hỏng"); }).catch(e => ra.push("loi"));
  const p2 = dt.khoaTheoKhoa("conv_D", async () => { ra.push("van chay"); });
  await Promise.all([p1, p2]);
  assert.deepStrictEqual(ra, ["loi", "van chay"]);
});

test("khách chậm KHÔNG làm chậm khách khác (mục 3.9)", async () => {
  // 1 khách gửi ảnh (200 ms) + 5 khách nhắn chữ (10 ms).
  const viec = [200, 10, 10, 10, 10, 10];
  const xongLuc = [];
  const t0 = Date.now();
  await dt.chayNhieu(viec, async (ms, i) => {
    await nghi(ms);
    xongLuc[i] = Date.now() - t0;
  }, { toiDa: 6 });
  for (let i = 1; i < viec.length; i++) {
    assert.ok(xongLuc[i] < 100,
      `khách #${i} phải xong sớm dù khách #0 đang xử ảnh (thực tế ${xongLuc[i]} ms)`);
  }
  assert.ok(xongLuc[0] >= 190, "khách gửi ảnh vẫn phải được xử xong");
});

test("một hội thoại hỏng không kéo sập cả mẻ", async () => {
  const ra = await dt.chayNhieu([1, 2, 3, 4], async (x) => {
    if (x === 2) throw new Error("hỏng ở hội thoại 2");
    return x * 10;
  }, { toiDa: 4 });
  assert.strictEqual(ra[0], 10);
  assert.ok(ra[1] && ra[1]._loi, "hội thoại hỏng phải được ghi nhận riêng");
  assert.strictEqual(ra[2], 30);
  assert.strictEqual(ra[3], 40);
});

test("giữ nhịp: không vượt số request/giây cho mỗi page", async () => {
  const t0 = Date.now();
  // Gáo đầy cho phép dồn PANCAKE_BURST cái đầu tiên; số còn lại phải bị giãn ra.
  const N = dt.NHIP_MOI_GIAY * 2 + 4;
  for (let i = 0; i < N; i++) await dt.nhip("page_test_1");
  const giay = (Date.now() - t0) / 1000;
  const nhipThucTe = N / Math.max(giay, 0.001);
  assert.ok(nhipThucTe <= dt.NHIP_MOI_GIAY * 2.2,
    `nhịp thực tế ${nhipThucTe.toFixed(1)}/s vượt trần ${dt.NHIP_MOI_GIAY}/s -> sẽ ăn 429`);
});

test("page dính 429 thì nghỉ, page khác KHÔNG bị vạ lây", async () => {
  dt.baoBiBop("page_bi_bop");
  const t0 = Date.now();
  await dt.nhip("page_binh_thuong");
  assert.ok(Date.now() - t0 < 50, "page khác phải chạy ngay, không chờ page đang bị bóp");
  const tt = dt.trangThai();
  assert.ok(tt.page["page_bi_bop"].dangNghiMs > 0, "page bị bóp phải đang trong thời gian nghỉ");
  dt.baoOn("page_bi_bop");
});
