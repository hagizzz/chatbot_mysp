// ============================================================================
// test/khong_hoi_lai.test.js — ĐÃ CÓ TRONG LỊCH SỬ THÌ XÁC NHẬN, ĐỪNG XIN LẠI
// ----------------------------------------------------------------------------
// Yêu cầu tính năng (docs/YEU_CAU_TINH_NANG.txt):
//   · Nguyên tắc 4: "Đã có size, màu, địa chỉ, số điện thoại trong lịch sử thì
//     TUYỆT ĐỐI không hỏi lại."
//   · Mục 3.8:      "Khách đặt thêm mẫu thì CHỈ hỏi thông tin của mẫu mới, giữ
//     nguyên địa chỉ và số điện thoại đã có."
//   · Mục 3.7:      "Chỉ hỏi lại khách khi thật sự không tra ra được."
//
// Đo trên page THẬT 24/08/2026 — vi phạm cả ba:
//   Khách chốt đơn xong (sđt 0385…, địa chỉ "Thanh Xuân, Hà Nội"), gửi ảnh mẫu
//   mới. Bot đáp: "Chị cho em xin địa chỉ để em lên đơn size M cho mình nha ạ".
//   Nguyên nhân: addrReady() trả false vì địa chỉ thiếu phường — nhưng THIẾU
//   TẦNG khác hẳn CHƯA CÓ GÌ, mà nhánh đuôi gộp chung làm một.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

function duoiSize() {
  const i = SRC.indexOf("function sizeTailForProduct");
  assert.ok(i > 0, "không thấy sizeTailForProduct");
  return SRC.slice(i, i + 4000);
}

test("khách ĐÃ TỪNG chốt đơn -> XÁC NHẬN liên hệ cũ, không xin lại", () => {
  const d = duoiSize();
  assert.match(d, /_daTungDat/, "thiếu nhánh nhận ra khách đã từng đặt");
  assert.match(d, /everOrdered|orderClosed/, "phải dựa trên cờ đã-từng-đặt trong bộ nhớ hội thoại");
  assert.match(d, /xac_nhan_lien_he_cu/, "phải dùng khoá kịch bản xác nhận, không viết cứng");
});

test("có địa chỉ nhưng THIẾU TẦNG -> xin đúng tầng thiếu, không xin lại cả địa chỉ", () => {
  const d = duoiSize();
  assert.match(d, /addressGapReply/,
    "phải gọi addressGapReply — nó đã biết xin đúng phường/quận/tỉnh còn thiếu");
});

test("CHƯA có gì thật thì vẫn xin bình thường", () => {
  // Nới tay quá thì khách mới toanh cũng không được hỏi sđt -> không chốt được đơn.
  const d = duoiSize();
  assert.match(d, /Chị cho em xin \$\{joinVi\(_missing\)\}/,
    "mất nhánh xin liên hệ cho khách mới");
});

test("thứ tự nhánh: xác nhận-cũ đứng TRƯỚC xin-mới", () => {
  const d = duoiSize();
  const iXacNhan = d.indexOf("_daTungDat");
  const iGap = d.indexOf("addressGapReply");
  const iXin = d.indexOf("Chị cho em xin ${joinVi(_missing)}");
  assert.ok(iXacNhan > 0 && iGap > iXacNhan && iXin > iGap,
    "phải theo thứ tự: đã-từng-đặt -> thiếu-tầng -> chưa-có-gì; đảo thứ tự là lại xin lại từ đầu");
});

// --- Câu trong kho -----------------------------------------------------------
test("khoá xac_nhan_lien_he_cu có trong kho và render đủ 3 ô", () => {
  const KB = require("../loi/cau_noi/kho_kich_ban");
  const c = KB.cau("xac_nhan_lien_he_cu",
    { size: "size M", diaChi: "Thanh Xuân, Hà Nội", sdt: "0385539117" });
  assert.match(c, /size M/);
  assert.match(c, /Thanh Xuân, Hà Nội/);
  assert.match(c, /0385539117/);
  // Phải là câu XÁC NHẬN (có dấu hỏi), không phải câu đi xin.
  assert.match(c, /\?/, "phải là câu hỏi xác nhận");
  assert.ok(!/cho em xin (số điện thoại|địa chỉ)/i.test(c),
    "câu xác nhận KHÔNG được chứa vế đi xin lại thông tin");
});

test("kho kịch bản không có lỗi sau khi thêm khoá", () => {
  const kq = require("../loi/cau_noi/kho_kich_ban").kiemTra();
  assert.deepStrictEqual(kq.loi, []);
});

// --- AI-QUYẾT: HOI_SIZE cũng phải có rào chống lặp ---------------------------
// Đo trên page PHOM 26/08/2026 (khách Hà Giang):
//   bot xin chiều cao+cân nặng -> khách "e cao m6 nặng 53kg ạ"
//   bot hỏi "thường mặc size nào" -> khách "bth e mặc size M"
//   bot LẠI xin chiều cao cân nặng -> về đúng câu đầu vòng.
// Nguyên nhân: rào "không hỏi lại thứ ĐÃ có" của AI-QUYẾT chỉ che XIN_SDT và
// XAC_NHAN_TINH; HOI_SIZE không ai canh nên đi thẳng ra khách.
function raoAiQuyet() {
  const i = SRC.indexOf("Không hỏi lại thứ ĐÃ có");
  assert.ok(i > 0, "không thấy rào chống lặp của AI-QUYẾT");
  return SRC.slice(i, i + 3000);
}

test("AI-QUYẾT: đã có size hoặc số đo -> BỎ HOI_SIZE, không xin lại", () => {
  const r = raoAiQuyet();
  assert.match(r, /_cq\.hanh_dong === "HOI_SIZE"/, "thiếu nhánh canh HOI_SIZE");
  assert.match(r, /mem\.customerSize/, "phải soi size đã có trong bộ nhớ");
  assert.match(r, /mem\.weightKg|mem\.customerWeightKg/, "phải soi cân nặng đã có");
  assert.match(r, /mem\.measure3V/, "phải soi số đo 3 vòng đã có");
});

test("AI-QUYẾT: soi CẢ tin lượt này, không chỉ bộ nhớ", () => {
  // Khách vừa gõ số đo trong chính lượt đó thì mem chưa kịp ghi — chỉ soi mem
  // là vẫn hỏi lại đúng thứ khách vừa đưa (đây chính là ca 10:09:16).
  const r = raoAiQuyet();
  assert.match(r, /parseWeightKg\(latestText/,
    "phải parse cân nặng từ tin khách lượt này");
});

test("AI-QUYẾT: nhánh BỎ HOI_SIZE đứng TRƯỚC lệnh gửi tin", () => {
  const r = raoAiQuyet();
  const iBo = r.indexOf('"HOI_SIZE"');
  const iGui = r.indexOf("sendInboxMessage");
  assert.ok(iBo > 0 && iGui > iBo,
    "đặt rào sau lệnh gửi thì câu hỏi lặp đã tới khách rồi");
});

test("AI-QUYẾT: đã có địa chỉ ĐỦ TẦNG -> BỎ XIN_DIA_CHI", () => {
  // Chuỗi rào từng che XIN_SDT, XAC_NHAN_TINH, HOI_SIZE mà sót XIN_DIA_CHI.
  // Khách đã cho địa chỉ và bot đã chốt 4 đơn về đúng địa chỉ đó, vẫn bị hỏi lại.
  const r = raoAiQuyet();
  assert.match(r, /_cq\.hanh_dong === "XIN_DIA_CHI" && mem\.address && addrReady\(mem\)/,
    "thiếu rào -> bot xin lại địa chỉ khách đã đưa");
});

test("địa chỉ THIẾU TẦNG thì KHÔNG bỏ — để luật cũ xin đúng mảnh thiếu", () => {
  // Bỏ luôn khi địa chỉ cụt là hỏng kiểu khác: bot không bao giờ xin nốt phường/quận.
  const r = raoAiQuyet();
  assert.match(r, /addrReady\(mem\)/,
    "phải kiểm ĐỦ TẦNG, không phải chỉ kiểm có chuỗi địa chỉ");
  assert.match(SRC, /function addressGapReply/,
    "mất addressGapReply thì nhánh thiếu-tầng không còn ai lo");
});
