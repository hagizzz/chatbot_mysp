// ============================================================================
// test/bam_khach.test.js — BÁM KHÁCH: SHOP KHAI, BOT CHỈ CHẠY THEO
// ----------------------------------------------------------------------------
// Mục 4.5 yêu cầu tính năng (docs/YEU_CAU_TINH_NANG.txt):
//   "Shop chọn có dùng tính năng bám khách hay không / tự đặt sau bao lâu thì
//    nhắc lần đầu, bao lâu thì nhắc lần hai / tự đặt số lần nhắc tối đa.
//    Bot chỉ chạy theo đúng những gì shop đã khai."
//
// Lịch sử:
//   · trước 25/08 — ba mốc giờ viết cứng ở HAI hàm, giá trị chép trùng nhau,
//     hằng số còn tên FIVE_SEC trong khi giá trị là 10 phút. Không tắt được.
//   · 25/08 sáng  — đưa ra .env.
//   · 25/08 chiều — chuyển vào ngăn "cai_dat" của kho kịch bản để THEO TỪNG SHOP.
//     .env vẫn ăn khi shop chưa khai. Cơ chế: test/cai_dat_theo_shop.test.js
//
// Còn lại của mục 4.5 (GĐ5): shop tự VIẾT NỘI DUNG từng câu nhắc, và tự khai
// trường hợp nào thì ngừng — hiện 10 điều kiện dừng vẫn viết cứng.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

function doc(bieuThuc, env) {
  return execFileSync(process.execPath, ["-e",
    `const KB=require("./loi/cau_noi/kho_kich_ban");process.stdout.write(String(${bieuThuc}))`],
    { cwd: GOC, env: Object.assign({}, process.env, env), encoding: "utf8" }
  ).split("\n").pop().trim();
}
const SACH = { SHOP_ID: "shop_khong_ton_tai", BAM_KHACH: "", BAM_KHACH_LAN1_PHUT: "",
               BAM_KHACH_LAN2_GIO: "", BAM_KHACH_SO_LAN: "" };

test("mặc định khi không ai khai: bật, 10 phút / 2 giờ / 2 lần", () => {
  assert.strictEqual(doc('KB.caiDatBat("BAM_KHACH", true)', SACH), "true");
  assert.strictEqual(doc('KB.caiDatSo("BAM_KHACH_LAN1_PHUT", 10)', SACH), "10");
  assert.strictEqual(doc('KB.caiDatSo("BAM_KHACH_LAN2_GIO", 2)', SACH), "2");
  assert.strictEqual(doc('KB.caiDatSo("BAM_KHACH_SO_LAN", 2)', SACH), "2");
});

test("shop TẮT được tính năng", () => {
  for (const v of ["off", "0", "false", "no", "tat"]) {
    assert.strictEqual(doc('KB.caiDatBat("BAM_KHACH", true)',
      Object.assign({}, SACH, { BAM_KHACH: v })), "false", `"${v}" phải tắt`);
  }
});

test("shop tự đặt thời điểm và số lần", () => {
  const e = Object.assign({}, SACH,
    { BAM_KHACH_LAN1_PHUT: "30", BAM_KHACH_LAN2_GIO: "6", BAM_KHACH_SO_LAN: "1" });
  assert.strictEqual(doc('KB.caiDatSo("BAM_KHACH_LAN1_PHUT", 10)', e), "30");
  assert.strictEqual(doc('KB.caiDatSo("BAM_KHACH_LAN2_GIO", 2)', e), "6");
  assert.strictEqual(doc('KB.caiDatSo("BAM_KHACH_SO_LAN", 2)', e), "1");
});

test("giá trị rác không làm bot chạy loạn", () => {
  // delay = 0 là bot giục khách NGAY LẬP TỨC; NaN là nhắc vô hạn.
  for (const v of ["abc", "-5", "0", "  "]) {
    assert.strictEqual(doc('KB.caiDatSo("BAM_KHACH_LAN1_PHUT", 10)',
      Object.assign({}, SACH, { BAM_KHACH_LAN1_PHUT: v })), "10", `"${v}" phải về mặc định`);
  }
});

// --- Lõi bot phải dùng đúng cấu hình đó -------------------------------------
test("có trần số lần để không phiền khách", () => {
  const i = SRC.indexOf("get SO_LAN()");
  assert.ok(i > 0, "không thấy SO_LAN");
  assert.match(SRC.slice(i, i + 160), /Math\.min\(5/, "khai 99 lần là spam khách — phải kẹp trần");
});

test("mốc giờ viết cứng cũ đã bị gỡ khỏi mã", () => {
  assert.ok(!/const FIVE_SEC\s*=/.test(SRC), "còn FIVE_SEC — tên sai nghĩa, giá trị 10 phút");
  assert.ok(!/const TWO_HOURS\s*=/.test(SRC), "còn TWO_HOURS viết cứng ở hai hàm");
});

test("scheduleFollowup tôn trọng công tắc và số lần shop khai", () => {
  const i = SRC.indexOf("function scheduleFollowup");
  const k = SRC.slice(i, i + 4500);
  assert.match(k, /!BAM_KHACH\.BAT/, "thiếu chốt tắt");
  assert.match(k, /BAM_KHACH\.SO_LAN/, "thiếu chốt số lần tối đa");
  assert.match(k, /BAM_KHACH\.LAN1_MS/, "lần 1 chưa đọc từ cấu hình");
  assert.match(k, /BAM_KHACH\.LAN2_MS/, "lần 2 chưa đọc từ cấu hình");
});

test("sweepFollowups dừng hẳn khi shop tắt, và đếm số lần đã nhắc", () => {
  const i = SRC.indexOf("async function sweepFollowups");
  const k = SRC.slice(i, SRC.indexOf("async function processOneConversation"));
  assert.match(k, /!BAM_KHACH\.BAT[\s\S]{0,120}pendingFollowups\.clear\(\)/,
    "tắt rồi mà hàng đợi còn thì lần bật lại sẽ bắn dồn");
  assert.match(k, /_soLanDaNhac/, "không đếm số lần đã nhắc thì trần số lần vô nghĩa");
});

test("shop khai được trong tệp riêng, không phải mở .env chứa mật khẩu", () => {
  const j = JSON.parse(fs.readFileSync(path.join(GOC, "kich_ban", "mysp.json"), "utf8"));
  assert.ok(j.cai_dat, "tệp shop thiếu ngăn cai_dat");
  for (const k of ["BAM_KHACH", "BAM_KHACH_LAN1_PHUT", "BAM_KHACH_LAN2_GIO", "BAM_KHACH_SO_LAN"]) {
    assert.ok(k in j.cai_dat, `thiếu ${k} trong kich_ban/mysp.json`);
  }
});
