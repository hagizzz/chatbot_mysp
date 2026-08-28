// ============================================================================
// test/bo_nhan_chuan.test.js — CÔNG CỤ DỰNG BỘ NHÃN CHUẨN
// ----------------------------------------------------------------------------
// Bộ nhãn chuẩn là MỐC để chấm bot gắn nhãn đúng hay sai. Mốc mà sai thì mọi
// con số đo sau đó đều sai theo, nên đường đi của dữ liệu phải chắc:
// log -> gom, bỏ trùng, CHE số điện thoại -> CSV shop sửa -> nạp lại.
// Hai chỗ nguy nhất, bộ này canh cả hai:
//   1. Che riêng tư trượt -> số điện thoại khách thật nằm trong git.
//   2. Nạp CSV nuốt nhãn gõ sai -> ca đó âm thầm biến mất khỏi phép đo.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const { khoaTrung, bocTuLog, gopBoCa, raCsv, docCsv, tuCsv } = require("../loi/cau_noi/bo_nhan_chuan");

const LOG_MAU = [
  "0|bot      | ------------------------------",
  "0|bot      | Khách: Quynh Nguyen | Conv: 1405324086167653_26665341566472547",
  "0|bot      | Tin: text: Bộ này có những màu nào shop | image: [Photo]",
  "0|bot      | [AI-READ] nhãn=COLOR_ASK | size=- addr=false",
  "0|bot      | MẪU: Celyne(MRKVX6305)=950000",
  "0|bot      | ------------------------------",
  "0|bot      | Khách: Trang Linh | Conv: 1468690110033030_36627306376918006",
  "0|bot      | Tin: text: Minhf xin giá shop oi",
  "0|bot      | [AI-READ] nhãn=PRICE_ASK | size=-"
].join("\n");

// ---- bóc từ log -----------------------------------------------------------
test("bóc đúng câu khách, bỏ phần đuôi image/text của log", () => {
  const ra = bocTuLog(LOG_MAU);
  assert.strictEqual(ra.length, 2);
  assert.strictEqual(ra[0].tin, "Bộ này có những màu nào shop");
  assert.strictEqual(ra[0].coAnh, true, "mất cờ ảnh là mất ngữ cảnh: 'Bn ạ' + ảnh khác hẳn 'Bn ạ' trơ trọi");
  assert.strictEqual(ra[1].coAnh, false);
});

test("lấy kèm nhãn bot đang gắn và mẫu đang nói tới", () => {
  const ra = bocTuLog(LOG_MAU);
  assert.strictEqual(ra[0].nhanCu, "COLOR_ASK");
  assert.match(ra[0].mauDangNoi, /Celyne/);
  assert.strictEqual(ra[1].nhanCu, "PRICE_ASK");
});

test("không vơ nhãn của lượt sau cho lượt trước", () => {
  const ra = bocTuLog(["Tin: text: câu một", "Tin: text: câu hai", "[AI-READ] nhãn=STOCK"].join("\n"));
  assert.strictEqual(ra[0].nhanCu, "", "gặp lượt mới phải dừng, đừng mượn nhãn của câu khác");
  assert.strictEqual(ra[1].nhanCu, "STOCK");
});

// ---- gom + che ------------------------------------------------------------
test("SỐ ĐIỆN THOẠI khách bị che trước khi vào bộ ca", () => {
  const ds = gopBoCa([{ nguon: "log", ds: [{ tin: "0987654321 số 5 Lê Lợi" }] }]);
  assert.ok(!/0987654321/.test(ds[0].tin), "lọt số thật vào tệp đem chia sẻ là hỏng");
  assert.match(ds[0].tin, /0900000000/, "che kiểu giữ hình dạng: vẫn là số di động hợp lệ");
});

test("câu trùng chỉ giữ một, và giữ bản NHIỀU ngữ cảnh hơn", () => {
  const ds = gopBoCa([
    { nguon: "log", ds: [{ tin: "mẫu này bao nhiêu" }] },
    { nguon: "bo_nho", ds: [{ tin: "Mẫu này  bao nhiêu", mauDangNoi: "Celyne", tinShopTruoc: "Dạ chị cần mẫu nào ạ" }] }
  ]);
  assert.strictEqual(ds.length, 1, "khác hoa thường/dấu cách vẫn là một câu");
  assert.strictEqual(ds[0].mauDangNoi, "Celyne");
  assert.strictEqual(ds[0].tinShopTruoc, "Dạ chị cần mẫu nào ạ", "bản sau có ngữ cảnh thì phải nhặt lấy");
});

test("câu rỗng / một ký tự thì bỏ", () => {
  assert.strictEqual(gopBoCa([{ nguon: "log", ds: [{ tin: "" }, { tin: "a" }, { tin: "ok" }] }]).length, 1);
});

test("khoá so trùng không phân biệt hoa thường và dấu cách thừa", () => {
  assert.strictEqual(khoaTrung("  Xin  GIÁ ạ "), khoaTrung("xin giá ạ"));
});

// ---- CSV đi và về ---------------------------------------------------------
test("CSV đi rồi về vẫn nguyên câu, kể cả câu có dấu phẩy và dấu nháy", () => {
  const goc = [{ tin: 'lấy cho chị 1 cái, size M, "màu kem" nhé', nhanDeXuat: "ORDER_CLOSE" }];
  const { ca, loi } = tuCsv(docCsv(raCsv(goc)));
  assert.deepStrictEqual(loi, []);
  assert.strictEqual(ca[0].tin, goc[0].tin);
  assert.strictEqual(ca[0].nhanDung, "ORDER_CLOSE");
});

test("Excel đổi dấu phân cách sang ';' thì vẫn đọc được", () => {
  const csv = "stt;cau_khach;nhan_dung\n1;xin giá;PRICE_ASK";
  const { ca } = tuCsv(docCsv(csv));
  assert.strictEqual(ca.length, 1);
  assert.strictEqual(ca[0].nhanDung, "PRICE_ASK");
});

test("cờ ảnh trong CSV thành ngữ cảnh chữ để đưa cho bộ phân loại", () => {
  const { ca } = tuCsv(docCsv("cau_khach,co_anh,nhan_dung\nmẫu này bn,có,PRICE_ASK"));
  assert.match(ca[0].boiCanh, /ảnh/);
});

// ---- nạp lại: không được nuốt lỗi -----------------------------------------
test("nhãn gõ sai phải BÁO, không được lặng lẽ bỏ ca đó", () => {
  const { ca, loi } = tuCsv(docCsv("cau_khach,nhan_dung\nxin giá,GIA_CA\nxin giá 2,PRICE_ASK"));
  assert.strictEqual(ca.length, 1);
  assert.strictEqual(loi.length, 1);
  assert.match(loi[0], /GIA_CA/);
  assert.match(loi[0], /dòng 2/, "phải chỉ đúng dòng để shop mở Excel sửa");
});

test("ô nhãn bỏ trống cũng phải báo", () => {
  const { ca, loi } = tuCsv(docCsv("cau_khach,nhan_dung\nxin giá,"));
  assert.strictEqual(ca.length, 0);
  assert.match(loi[0], /chưa dán nhãn/);
});

test("nhãn viết thường vẫn nhận", () => {
  const { ca } = tuCsv(docCsv("cau_khach,nhan_dung\nxin giá,price_ask"));
  assert.strictEqual(ca[0].nhanDung, "PRICE_ASK");
});
