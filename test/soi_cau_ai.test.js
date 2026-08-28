// ============================================================================
// test/soi_cau_ai.test.js — BỘ SOI CÂU AI DIỄN ĐẠT
// ----------------------------------------------------------------------------
// Kế hoạch: docs/KE_HOACH_AI_SOAN_CAU.md (bước 2).
//
// Điều kiện để dám bật AI diễn đạt: bộ soi phải CHẶN ĐÚNG những thứ mà một câu
// sai có thể gây mất khách (bịa số, chạm giá/tồn/chính sách), mà KHÔNG chặn oan
// câu diễn đạt lành — chặn oan nhiều thì bật cũng như không, vì lúc nào cũng
// rơi về câu template cũ.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");

const { soiCau, tomTat, tachSo } = require("../loi/ai/soi_cau_ai");

// Phiếu mẫu: đúng ca FIT_SUITABILITY có số đo người mẫu.
const PHIEU = {
  y_dinh: "TRAN_AN_HOP_DANG",
  su_that: { ma: "MGKVX01", ten: "Celyne", mau: "be", chieu_cao_mau: "1m62", can_nang_khach: "45kg" },
  duoc_noi: ["form Việt", "không kén dáng"],
  cam_noi: ["gia", "ton_kho", "thoi_gian_giao", "hoan_huy", "so_sanh_shop", "y_te", "don_tien"],
  giong: { toi_da_chu: 45 },
  cau_goc: "Dạ chị yên tâm ạ, mẫu này khá dễ mặc và không kén dáng đâu ạ."
};

// --- CHO QUA: câu diễn đạt lành ---------------------------------------------
test("câu diễn đạt lành, không số -> ĐẠT", () => {
  const kq = soiCau("Dạ chị yên tâm nha, mẫu này form Việt nên không kén dáng đâu ạ.", PHIEU);
  assert.strictEqual(kq.dat, true, tomTat(kq));
});

test("số CÓ TRONG PHIẾU thì được nói — đây là điểm khác reply_guard", () => {
  const kq = soiCau("Dạ mẫu ảnh cao 1m62 mà chị 45kg thì mặc lên rất xinh ạ.", PHIEU);
  assert.strictEqual(kq.dat, true, tomTat(kq));
});

test("viết 162 hay 1m62 đều khớp — chuẩn hoá bỏ chữ dính", () => {
  const kq = soiCau("Dạ người mẫu cao 162 thôi mà lên dáng đẹp lắm chị ạ.", PHIEU);
  assert.strictEqual(kq.dat, true, tomTat(kq));
});

// --- CHẶN: bịa số -----------------------------------------------------------
test("số KHÔNG có trong phiếu -> chặn SO_LA", () => {
  const kq = soiCau("Dạ mẫu này bên em bán được 2000 chiếc rồi chị ạ.", PHIEU);
  assert.strictEqual(kq.dat, false);
  assert.ok(kq.loi.some(l => l.ma === "SO_LA" && l.chiTiet === "2000"), tomTat(kq));
});

// --- CHẶN: chạm chủ đề của code --------------------------------------------
test("chạm GIÁ -> chặn, dù không viết con số nào", () => {
  const kq = soiCau("Dạ giá mẫu này đang rất tốt chị ạ, chị yên tâm nha.", PHIEU);
  assert.ok(kq.loi.some(l => l.ma === "CAM_NOI" && l.chiTiet === "gia"), tomTat(kq));
});

test("chạm TỒN KHO -> chặn (bot không quản kho)", () => {
  const kq = soiCau("Dạ mẫu này còn hàng chị nhé, chị yên tâm ạ.", PHIEU);
  assert.ok(kq.loi.some(l => l.ma === "CAM_NOI" && l.chiTiet === "ton_kho"), tomTat(kq));
});

test("chạm HOÀN/HỦY -> chặn (chỉ nói khi khách HỎI chính sách)", () => {
  const kq = soiCau("Dạ không vừa thì chị cứ đổi trả thoải mái nha chị.", PHIEU);
  assert.ok(kq.loi.some(l => l.ma === "CAM_NOI" && l.chiTiet === "hoan_huy"), tomTat(kq));
});

test("chạm Y TẾ (bầu) -> chặn, không tự khẳng định thay người thật", () => {
  const kq = soiCau("Dạ chị đang bầu mặc mẫu này vẫn thoải mái nha chị.", PHIEU);
  assert.ok(kq.loi.some(l => l.ma === "CAM_NOI" && l.chiTiet === "y_te"), tomTat(kq));
});

test("tự nhận ĐÃ LÊN ĐƠN -> chặn (tạo đơn là việc của code/POS)", () => {
  const kq = soiCau("Dạ em đã lên đơn cho chị rồi nha, chị chờ hàng nhé.", PHIEU);
  assert.ok(kq.loi.some(l => l.ma === "CAM_NOI" && l.chiTiet === "don_tien"), tomTat(kq));
});

// --- CHẶN: giọng và rác kỹ thuật -------------------------------------------
test('dùng từ "bạn" -> chặn (kịch bản cấm)', () => {
  const kq = soiCau("Dạ bạn yên tâm nha, mẫu này rất dễ mặc ạ.", PHIEU);
  assert.ok(kq.loi.some(l => l.ma === "SAI_XUNG_HO"), tomTat(kq));
});

test("còn ô biến chưa điền -> chặn, đừng để {mau} tới khách", () => {
  const kq = soiCau("Dạ chị yên tâm, mẫu {mau} này không kén dáng đâu ạ.", PHIEU);
  assert.ok(kq.loi.some(l => l.ma === "CO_O_TRONG"), tomTat(kq));
});

test("câu quá dài -> chặn (giọng nhắn tin, không phải bài văn)", () => {
  const dai = "Dạ chị yên tâm nha " + "mẫu này dễ mặc lắm ạ ".repeat(12);
  const kq = soiCau(dai, PHIEU);
  assert.ok(kq.loi.some(l => l.ma === "QUA_DAI"), tomTat(kq));
});

test("câu rỗng -> chặn", () => {
  assert.strictEqual(soiCau("", PHIEU).dat, false);
  assert.strictEqual(soiCau(null, PHIEU).dat, false);
});

// --- CĂN CỨ (đường C) -------------------------------------------------------
const NGUON = ["Chất liệu lụa mềm, form suông dáng dài, không kén dáng, mặc mát"];

test("có nguồn mà AI không trích căn cứ -> chặn", () => {
  const kq = soiCau("Dạ mẫu này mặc mát lắm chị ạ.", PHIEU, { nguon: NGUON });
  assert.ok(kq.loi.some(l => l.ma === "THIEU_CAN_CU"), tomTat(kq));
});

test("căn cứ bịa (không có trong nguồn) -> chặn", () => {
  const kq = soiCau("Dạ mẫu này chống nhăn chị ạ.", PHIEU,
    { nguon: NGUON, canCu: "vải chống nhăn tuyệt đối" });
  assert.ok(kq.loi.some(l => l.ma === "CAN_CU_BIA"), tomTat(kq));
});

test("căn cứ CÓ THẬT trong nguồn -> cho qua, kể cả lệch dấu/hoa thường", () => {
  const kq = soiCau("Dạ mẫu này mặc mát lắm chị ạ.", PHIEU,
    { nguon: NGUON, canCu: "Form suông dáng dài, KHÔNG kén dáng" });
  assert.strictEqual(kq.dat, true, tomTat(kq));
});

// --- TIỆN ÍCH ---------------------------------------------------------------
test("tachSo gom được dạng dính chữ của tiếng Việt", () => {
  assert.deepStrictEqual([...tachSo("cao 1m62 nặng 45kg mặc size M")].sort(), ["162", "45"]);
  assert.deepStrictEqual([...tachSo("1.190.000")], ["1190000"]);
});

test("tomTat gộp mọi lỗi thành một dòng đọc được trong log", () => {
  const kq = soiCau("Dạ bạn yên tâm, giá mẫu này 2000 ạ.", PHIEU);
  const s = tomTat(kq);
  assert.match(s, /SAI_XUNG_HO/);
  assert.match(s, /CAM_NOI\(gia\)/);
  assert.match(s, /SO_LA\(2000\)/);
});
