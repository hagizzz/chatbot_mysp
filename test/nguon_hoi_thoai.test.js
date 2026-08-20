// ============================================================================
// test/nguon_hoi_thoai.test.js — KÝ HIỆU NGUỒN (mục 3.5)
// ----------------------------------------------------------------------------
// Tiêu chí nghiệm thu mục 11 đòi "ký hiệu nguồn rõ ràng". Nghĩa là MỌI hội thoại
// đều phải có dấu, không sót loại nào, và không ghi chú lặp làm rác ô ghi chú.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const { xacDinhNguon, moTa, danhDau } = require("../nguon_hoi_thoai");

test("phân loại đủ ba nguồn, không có ca nào rơi ra ngoài", () => {
  assert.strictEqual(xacDinhNguon({ fromAd: true }), "quang_cao");
  assert.strictEqual(xacDinhNguon({ adId: "123" }), "quang_cao");
  assert.strictEqual(xacDinhNguon({ isCommentOrigin: true }), "binh_luan");
  assert.strictEqual(xacDinhNguon({}), "nhan_thang");
  assert.strictEqual(xacDinhNguon(), "nhan_thang", "không có thông tin gì vẫn phải ra một nhãn");
});

test("khách bấm quảng cáo rồi bình luận -> vẫn tính là từ quảng cáo", () => {
  assert.strictEqual(xacDinhNguon({ fromAd: true, isCommentOrigin: true }), "quang_cao",
    "tiền quảng cáo đã bỏ ra để có khách này — phải đếm về quảng cáo thì mới đo được hiệu quả");
});

test("dấu hiển thị cho nhân viên đọc được ngay", () => {
  const s = moTa("quang_cao", { tenAd: "Váy Palia thu đông", adId: "999", postId: "888" });
  assert.match(s, /TỪ QUẢNG CÁO/);
  assert.match(s, /Váy Palia/);
  assert.match(s, /999/);
  assert.match(moTa("binh_luan"), /TỪ BÌNH LUẬN/);
  assert.match(moTa("nhan_thang"), /NHẮN THẲNG/);
});

test("chỉ ghi ghi-chú MỘT lần cho mỗi hội thoại", async () => {
  const mem = {};
  let soLan = 0;
  const ghi = async () => { soLan++; return { success: true }; };
  for (let i = 0; i < 5; i++) {
    await danhDau({ conversationId: "c1", mem, chiTiet: { isCommentOrigin: true }, ghiChuHam: ghi });
  }
  assert.strictEqual(soLan, 1, "ghi lại mỗi lượt là làm rác ô ghi chú của nhân viên");
  assert.strictEqual(mem._nguon, "binh_luan");
});

test("ghi ghi-chú hỏng -> KHÔNG đánh dấu là đã ghi, lượt sau thử lại", async () => {
  const mem = {};
  let soLan = 0;
  const hong = async () => { soLan++; throw new Error("Pancake từ chối"); };
  await danhDau({ conversationId: "c2", mem, chiTiet: {}, ghiChuHam: hong });
  await danhDau({ conversationId: "c2", mem, chiTiet: {}, ghiChuHam: hong });
  assert.strictEqual(soLan, 2, "ghi hỏng mà coi như xong thì hội thoại đó mất dấu nguồn vĩnh viễn");
});

test("ghi chú hỏng không làm hỏng lượt xử lý", async () => {
  const r = await danhDau({
    conversationId: "c3", mem: {}, chiTiet: { fromAd: true },
    ghiChuHam: async () => { throw new Error("mạng chập"); }
  });
  assert.strictEqual(r.nguon, "quang_cao");
  assert.strictEqual(r.daGhi, false);
});
