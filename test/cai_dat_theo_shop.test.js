// ============================================================================
// test/cai_dat_theo_shop.test.js — CÔNG TẮC HÀNH VI PHẢI THEO TỪNG SHOP
// ----------------------------------------------------------------------------
// Trước 25/08/2026 tám công tắc hành vi nằm trong .env, lẫn giữa 99 dòng token và
// khoá API. Hai vấn đề:
//   · .env là của CẢ TIẾN TRÌNH -> hai shop chạy chung hệ thống thì không shop nào
//     có công tắc riêng. Hỏng mục 9.1 và 9.3 của yêu cầu tính năng.
//   · Kinh doanh muốn tắt bám khách phải mở tệp chứa mật khẩu.
//
// Nay công tắc nằm ở ngăn "cai_dat" trong kho kịch bản, theo thứ tự:
//     kich_ban/<shopId>.json  >  kich_ban/mac_dinh.json  >  .env  >  mặc định trong mã
//
// Để .env SAU cùng là có chủ ý: shop chưa khai gì thì mọi thứ chạy y như trước.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const GOC = path.join(__dirname, "..");

// Chạy tiến trình con để mỗi ca có SHOP_ID và .env riêng — kho nhớ theo tiến trình.
function doc(bieuThuc, env) {
  const out = execFileSync(process.execPath, ["-e",
    `const KB=require("./loi/cau_noi/kho_kich_ban");process.stdout.write(String(${bieuThuc}))`],
    { cwd: GOC, env: Object.assign({}, process.env, env), encoding: "utf8" });
  return out.split("\n").pop().trim();
}

test("shop có khai -> lấy theo tệp của shop", () => {
  assert.strictEqual(doc('KB.caiDat("BAM_KHACH_LAN1_PHUT", 99)', { SHOP_ID: "mysp" }), "10");
});

test("shop CHƯA khai gì -> rơi về mặc định, chạy được ngay", () => {
  // Mục 9.2: "shop mới tự bắt đầu được". Thiếu tệp riêng không được làm bot chết.
  assert.strictEqual(doc('KB.caiDatSo("BAM_KHACH_SO_LAN", 2)', { SHOP_ID: "shop_khong_ton_tai" }), "2");
});

test(".env vẫn ăn khi shop chưa khai — không phá cấu hình cũ", () => {
  assert.strictEqual(
    doc('KB.caiDat("MOT_CONG_TAC_LA", "md")', { SHOP_ID: "shop_khong_ton_tai", MOT_CONG_TAC_LA: "tu_env" }),
    "tu_env");
});

test("tệp của shop THẮNG .env — đây là điểm mấu chốt của đa shop", () => {
  // Không thắng thì một biến .env đặt nhầm sẽ đè lên cấu hình của mọi shop.
  assert.strictEqual(
    doc('KB.caiDat("BAM_KHACH_LAN1_PHUT", 99)', { SHOP_ID: "mysp", BAM_KHACH_LAN1_PHUT: "77" }),
    "10");
});

test("caiDatBat hiểu cả boolean trong JSON lẫn chuỗi trong .env", () => {
  const e = { SHOP_ID: "shop_khong_ton_tai" };
  for (const v of ["off", "0", "false", "no", "tat", "khong"]) {
    assert.strictEqual(doc('KB.caiDatBat("X", true)', Object.assign({ X: v }, e)), "false", `"${v}" phải là tắt`);
  }
  for (const v of ["on", "1", "true", "bat"]) {
    assert.strictEqual(doc('KB.caiDatBat("X", false)', Object.assign({ X: v }, e)), "true", `"${v}" phải là bật`);
  }
});

test("caiDatSo: giá trị rác về mặc định, không trả 0 hay NaN", () => {
  // delay = 0 là bot giục khách ngay lập tức; NaN là nhắc vô hạn.
  const e = { SHOP_ID: "shop_khong_ton_tai" };
  for (const v of ["abc", "-5", "0", ""]) {
    assert.strictEqual(doc('KB.caiDatSo("X", 10)', Object.assign({ X: v }, e)), "10", `"${v}" phải về mặc định`);
  }
});

// --- Lõi bot phải THẬT SỰ dùng, không chỉ khai ra rồi bỏ đó -----------------
test("lõi bot đọc công tắc từ kho, không đọc thẳng process.env nữa", () => {
  const src = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");
  for (const t of ["BAM_KHACH", "TACH_TIN", "SIET_NHAN_VIEN_TRA_LOI", "AI_REPLY_MODE", "MO_MAN_MODE"]) {
    assert.ok(!new RegExp(`process\\.env\\.${t}\\b`).test(src),
      `còn đọc thẳng process.env.${t} -> shop khai trong tệp riêng sẽ không ăn`);
  }
  assert.ok((src.match(/KB\.caiDat/g) || []).length >= 8, "phải có đủ chỗ đọc qua kho");
});

test("BAM_KHACH đọc LIVE, không chốt cứng lúc khởi động", () => {
  // Chốt cứng thì shop sửa tệp phải khởi động lại bot — mất hẳn cái lợi của kho.
  const src = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");
  const i = src.indexOf("const BAM_KHACH = {");
  const k = src.slice(i, i + 700);
  assert.match(k, /get BAT\(\)/, "phải là getter để đọc lại mỗi lần dùng");
  assert.match(k, /get SO_LAN\(\)/);
});

test("mac_dinh.json để ngăn cai_dat TRỐNG, chỉ có ghi chú", () => {
  // Khai giá trị ở gốc là ép cho MỌI shop và vô hiệu hoá .env của họ.
  const j = JSON.parse(fs.readFileSync(path.join(GOC, "kich_ban", "mac_dinh.json"), "utf8"));
  assert.ok(j.cai_dat, "thiếu ngăn cai_dat");
  const khoaThat = Object.keys(j.cai_dat).filter(k => !k.startsWith("_"));
  assert.deepStrictEqual(khoaThat, [], `mac_dinh.json không nên khai sẵn: ${khoaThat.join(", ")}`);
});
