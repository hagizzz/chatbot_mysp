// ============================================================================
// test/hai_dia_chi_hai_don.test.js — MỖI NƠI GIAO MỘT ĐƠN
// ----------------------------------------------------------------------------
// Ca Hà Giang 27/08/2026: "e lấy 1c trắng ship về địa chỉ cũ, và 1c đen ship về
// địa chỉ 67 Nguyễn Xiển, Thanh Xuân, Hà nội nhé" -> bot lên MỘT đơn, lấy địa chỉ
// thứ hai cho cả hai món. Cái áo trắng đáng lẽ về địa chỉ cũ lại đi về nhà kia.
//
// Đã thử dạy AI điền địa chỉ cho từng món (ai_quyet.js: san_pham[i].dia_chi). Nó
// KHÔNG làm — vẫn dồn cả hai nơi vào một chuỗi dia_chi_chuan. Giao sai nhà là loại
// lỗi không được phép phụ thuộc vào việc model hôm nay có nghe lời hay không, nên
// việc tách phải là MÃ TẤT ĐỊNH. Tệp này canh đúng chỗ đó.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");
const SRC_EX = fs.readFileSync(path.join(GOC, "loi/don/order_extractor.js"), "utf8");
const { extractColor, foldVi } = require(path.join(GOC, "loi/san_pham/color_utils"));

function layHam(ten) {
  const i = SRC.indexOf("function " + ten + "(");
  assert.ok(i >= 0, "khong thay ham " + ten);
  let sau = 0;
  for (let k = SRC.indexOf("{", i); k < SRC.length; k++) {
    if (SRC[k] === "{") sau++;
    else if (SRC[k] === "}" && --sau === 0) return SRC.slice(i, k + 1);
  }
  assert.fail("khong dong duoc ngoac cua " + ten);
}
const _i0 = SRC.indexOf("const _RE_GIAO_VE");
const _i1 = SRC.indexOf("function tachNoiGiaoTheoMon(");
assert.ok(_i0 > 0 && _i1 > _i0, "khong thay khoi hang so cua bo tach noi giao");
const HANG_SO = SRC.slice(_i0, _i1);
const scope = { extractColor, foldVi };
new Function("s", "with (s) { " + HANG_SO + "\n" + layHam("tachNoiGiaoTheoMon") + "\n"
  + layHam("gomDongTheoNoiGiao") + "\n s.tachNoiGiaoTheoMon = tachNoiGiaoTheoMon;"
  + " s.gomDongTheoNoiGiao = gomDongTheoNoiGiao; }")(scope);
const { tachNoiGiaoTheoMon, gomDongTheoNoiGiao } = scope;

const MEM = { address: "118 Khuong Thuong, Dong Da, Ha Noi" };

// --- 1. Doc ra dung hai noi giao ------------------------------------------

test("cau gay loi -> tach ra DUNG hai noi giao, dung mau", () => {
  const r = tachNoiGiaoTheoMon(
    "e lay 1c trang ship ve dia chi cu, va 1c den ship ve dia chi 67 Nguyen Xien, Thanh Xuan, Ha noi nhe", MEM);
  assert.strictEqual(r.length, 2, "khong tach duoc -> hai mon lai chung mot dia chi");
  assert.strictEqual(r[1].address, "67 Nguyen Xien, Thanh Xuan, Ha noi");
});

test('"dia chi cu" lay dia chi DA LUU, khong de AI bia lai', () => {
  const r = tachNoiGiaoTheoMon(
    "1c kem ship ve dia chi cu, con 1c den ship ve 67 Nguyen Xien, Thanh Xuan, Ha Noi", MEM);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].address, MEM.address, "bia lai dia chi cu = giao sai nha");
});

test("dia chi day dau phay van khong bi cat nham", () => {
  // Day la ly do khong cat theo dau phay: dia chi tu no da co 2-3 dau phay.
  const r = tachNoiGiaoTheoMon(
    "1c kem ship ve 118 Khuong Thuong, Dong Da, Ha Noi, va 1c den ship ve 67 Nguyen Xien, Thanh Xuan, Ha Noi", MEM);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].address, "118 Khuong Thuong, Dong Da, Ha Noi");
  assert.strictEqual(r[1].address, "67 Nguyen Xien, Thanh Xuan, Ha Noi");
});

// --- 2. KHONG duoc tach nham ----------------------------------------------

test("mot noi giao -> KHONG tach", () => {
  assert.deepStrictEqual(tachNoiGiaoTheoMon("ship ve 67 Nguyen Xien, Thanh Xuan, Ha Noi nhe", MEM), []);
  assert.deepStrictEqual(tachNoiGiaoTheoMon("e lay 2c den ship ve 67 Nguyen Xien, Ha Noi", MEM), []);
});

test("hai menh de nhung CUNG mot noi -> van la mot don", () => {
  const r = tachNoiGiaoTheoMon(
    "1c kem ship ve 67 Nguyen Xien, Ha Noi, va 1c den ship ve 67 Nguyen Xien, Ha Noi", MEM);
  assert.deepStrictEqual(r, [], "cung dia chi ma tach doi la de khach nhan hai lan ship");
});

test('"dia chi cu" ma bo nho CHUA co dia chi -> bo qua, khong dung chuoi "cu"', () => {
  const r = tachNoiGiaoTheoMon(
    "1c kem ship ve dia chi cu, va 1c den ship ve 67 Nguyen Xien, Ha Noi", { address: "" });
  assert.deepStrictEqual(r, [], 'ghi dia chi la chu "cu" thi don khong the giao duoc');
});

// --- 3. Gom nhom -----------------------------------------------------------

test("gom dong theo noi giao: cung dia chi thi chung mot don", () => {
  const nhom = gomDongTheoNoiGiao([
    { code: "A", address: "67 Nguyen Xien, Ha Noi" },
    { code: "B", address: "118 Khuong Thuong, Ha Noi" },
    { code: "C", address: "67 Nguyen Xien, Ha Noi" }
  ]);
  assert.strictEqual(nhom.length, 2);
  assert.strictEqual(nhom[0].lines.length, 2, "hai mon cung nha phai chung mot don");
});

// --- 4. Duong ong lam don: order_extractor -------------------------------

test("order_extractor nhan cum tin chot danh nhan (don i/N)", () => {
  assert.match(SRC_EX, /const _RE_NHAN = /, "thieu bo nhan dien nhan cum");
  assert.match(SRC_EX, /if \(_soDon >= 2 && cods\.length >= _soDon\)/, "thieu nhanh xu cum nhieu don");
  assert.match(SRC_EX, /Number\(m\[1\]\) === k \+ 1/, "cum phai du va dung thu tu 1..N moi nhan");
  assert.match(SRC_EX, /if \(!codEntries\) codEntries = _layMotCai\(\);/,
    "cum khong du thi phai quay ve luat cu, tha lam mot don con hon lam thieu/thua");
});

test("chu ky chong trung co kem NOI GIAO khi la cum nhieu don", () => {
  assert.match(SRC_EX, /if \(nhieuNoiGiao && order\.address\) order\.sig \+= `\|@\$\{fold\(order\.address\)\}`;/,
    "hai mon giong het khac nha se bi coi la trung -> khach chi nhan mot nua");
});

test("bot danh nhan (don i/N) len tung tin chot", () => {
  assert.match(SRC, /buildOrderConfirmation\(mem, _p0, _N > 1 \? `\(đơn \$\{_i \+ 1\}\/\$\{_N\}\)` : ""\)/,
    "khong danh nhan thi order_extractor khong biet day la cum -> lai gop mot don");
});

// ============================================================================
// [27/08/2026] ĐỊA CHỈ MỚI NHẤT — nhưng phải LÀ địa chỉ.
// Shop yêu cầu: khách đưa địa chỉ mới thì lưu lại, đơn sau tự dùng cái mới nhất.
// Đo thật: khách đã đổi sang "188 Khương Thượng, Đống Đa, Hà Nội", lượt sau nhắn
// "e lấy thêm 1 cái Mironne màu hồng size M nữa nhé" -> câu đó bị bóc thành địa chỉ
// và ĐÈ MẤT địa chỉ thật. Lượt sau bot đi xin lại địa chỉ khách vừa đưa, còn câu
// xác nhận đọc ra "vẫn giao về 1 cái Mironne màu hồng size M nữa".
// ============================================================================
test("mọi chỗ ghi địa chỉ đều đi qua datDiaChi, không gán thẳng", () => {
  const xau = SRC.split("\n").filter(l =>
    /mem\.address = /.test(l) && !/mem\.address = null/.test(l)
    && !/function datDiaChi/.test(l) && !/mem\.address = moi;/.test(l)
    && !/_g\.address/.test(l)                      // gán từ nhóm đã được khách xác nhận
    && !l.includes('+ ", " +'));               // ghép thêm tỉnh vào chính địa chỉ đang có
  assert.deepStrictEqual(xau, [],
    "gán thẳng mem.address là mở lại đường cho tên món hàng đè mất địa chỉ thật:\n" + xau.join("\n"));
});

test("datDiaChi giữ địa chỉ cũ khi cái mới không giống địa chỉ", () => {
  const i = SRC.indexOf("function datDiaChi(");
  assert.ok(i > 0, "không thấy hàm datDiaChi");
  const k = SRC.slice(i, i + 1100);
  assert.match(k, /if \(cu && _aqLooksAddr\(cu\) && !_aqLooksAddr\(moi\)\)/,
    "thiếu rào: cái mới phải trông như địa chỉ mới được đè cái cũ");
  assert.match(k, /BỎ QUA "địa chỉ" mới/, "bỏ qua thì phải nói ra, không im lặng");
  assert.match(k, /ĐỔI ĐỊA CHỈ:/, "đổi thật thì phải ghi mốc để sau truy được");
});

test("mọi lần XOÁ địa chỉ đều để lại dấu vết", () => {
  // 9 chỗ xoá mà log không nói gì thì mỗi lần mất địa chỉ là một buổi mò.
  const thang = SRC.split("\n").filter(l => /mem\.address = null/.test(l) && !/function xoaDiaChi/.test(l));
  assert.ok(thang.length <= 1, "còn chỗ xoá thẳng không qua xoaDiaChi:\n" + thang.join("\n"));
  assert.match(SRC, /function xoaDiaChi\(mem, viTri\)/, "thiếu hàm xoá có ghi dấu");
  const soCho = SRC.split("xoaDiaChi(mem,").length - 1;
  assert.ok(soCho >= 9, `phải còn đủ 9 chỗ xoá đi qua hàm, thấy ${soCho}`);
});
