// ============================================================================
// test/giam_sat.test.js — CHẨN ĐOÁN BOT HỎNG ÂM THẦM
// ----------------------------------------------------------------------------
// "Chết hẳn" thì .bat đã mở lại. Cái phải bắt được là ba kiểu hỏng mà tiến trình
// vẫn sống nhưng khách không được trả lời — nguy nhất là IM LẶNG, vì log vẫn trôi
// bình thường nên nhìn vào cửa sổ bot không thấy gì bất thường.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const { chanDoan } = require("../giam_sat");

const NGUONG = { imToiDaMs: 15 * 60000, dungHinhMs: 3 * 60000, tiLeLoi: 0.3, toiThieuDeXetLoi: 10 };
const tt = (p = {}) => ({ vongPoll: 100, luot: 50, traLoi: 40, loi: 0, tiLeLoi: 0, imBaoLauMs: 1000, vongCuoiCachDayMs: 4000, luotKeTuTraLoi: 0, ...p });

test("chạy bình thường -> không kêu", () => {
  assert.strictEqual(chanDoan(tt(), NGUONG).muc, "on");
});

test("đứng hình: vòng quét ngừng chạy -> mức nguy", () => {
  const r = chanDoan(tt({ vongCuoiCachDayMs: 5 * 60000 }), NGUONG);
  assert.strictEqual(r.muc, "nguy");
  assert.strictEqual(r.loai, "dung_hinh");
});

test("im lặng: vẫn quét nhưng lâu rồi không trả lời ai -> cảnh báo", () => {
  const r = chanDoan(tt({ imBaoLauMs: 40 * 60000, luotKeTuTraLoi: 25 }), NGUONG);
  assert.strictEqual(r.loai, "im_lang");
  assert.match(r.loi, /không trả lời/);
});

test("im lặng chưa quá ngưỡng -> im, không làm phiền", () => {
  assert.strictEqual(chanDoan(tt({ imBaoLauMs: 5 * 60000 }), NGUONG).muc, "on");
});

test("lỗi dày -> mức nguy", () => {
  const r = chanDoan(tt({ luot: 20, loi: 12, tiLeLoi: 0.6 }), NGUONG);
  assert.strictEqual(r.loai, "loi_day");
});

test("mới chạy, mẫu quá ít -> KHÔNG kết luận lỗi dày", () => {
  const r = chanDoan(tt({ luot: 3, loi: 3, tiLeLoi: 1 }), NGUONG);
  assert.notStrictEqual(r.loai, "loi_day",
    "3 lượt đầu đều lỗi có thể chỉ là đang khởi động — kêu ngay là cảnh báo giả");
});

test("đứng hình được ưu tiên báo trước im lặng", () => {
  const r = chanDoan(tt({ vongCuoiCachDayMs: 10 * 60000, imBaoLauMs: 60 * 60000, luotKeTuTraLoi: 50 }), NGUONG);
  assert.strictEqual(r.loai, "dung_hinh",
    "đứng hình là nguyên nhân, im lặng là hệ quả — báo nguyên nhân");
});

test("đêm không có khách -> KHÔNG kêu, dù đã lâu không trả lời ai", () => {
  // Đây là cái bẫy dễ dính nhất: 3 giờ sáng không ai nhắn, im 4 tiếng là ĐÚNG.
  // Kêu oan vài đêm là nhân viên thôi đọc cảnh báo, rồi lần hỏng thật cũng bị bỏ qua.
  const r = chanDoan(tt({ imBaoLauMs: 4 * 60 * 60000, luotKeTuTraLoi: 0 }), NGUONG);
  assert.strictEqual(r.muc, "on");
});

test("có việc mà không trả lời được lượt nào -> mới là im lặng thật", () => {
  const r = chanDoan(tt({ imBaoLauMs: 20 * 60000, luotKeTuTraLoi: 30 }), NGUONG);
  assert.strictEqual(r.loai, "im_lang");
  assert.match(r.loi, /30 lượt/);
});
