// test/moi_truong.test.js — LƯỚI AN TOÀN CỦA MÔI TRƯỜNG THỬ
// Vì sao có bài này: env_boot.js đặt ORDER_DRY_RUN="1" khi BOT_ENV=staging,
// nhưng order_config.js từng chỉ nhận đúng chữ "true" => cái chốt an toàn
// in ra dòng "không tạo đơn thật" mà thực tế VẪN tạo đơn thật.
// Bài test này khoá lại đúng chỗ đó.
const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const GOC = path.join(__dirname, "..");

function docDryRun(env) {
  const ra = execFileSync(
    process.execPath,
    ["-e", 'require("./env_boot"); process.stdout.write(String(require("./order_config").DRY_RUN))'],
    { cwd: GOC, env: { ...process.env, ...env }, encoding: "utf8" }
  );
  return ra.trim().split(/\s+/).pop() === "true";
}

test("BOT_ENV=staging thì KHÔNG BAO GIỜ tạo đơn thật", () => {
  assert.strictEqual(
    docDryRun({ BOT_ENV: "staging", ORDER_DRY_RUN: "" }), true,
    "staging phải bật DRY_RUN — nếu hỏng thì bản chạy thử sẽ lên đơn thật cho khách"
  );
});

test("người dùng khai kiểu nào cũng phải hiểu", () => {
  for (const v of ["1", "true", "TRUE", "yes", "on"]) {
    assert.strictEqual(docDryRun({ BOT_ENV: "production", ORDER_DRY_RUN: v }), true, `"${v}" phải bật DRY_RUN`);
  }
});

test("chạy thật thì không được tự bật DRY_RUN (kẻo im lặng không lên đơn)", () => {
  for (const v of ["", "0", "false", "off"]) {
    assert.strictEqual(docDryRun({ BOT_ENV: "production", ORDER_DRY_RUN: v }), false, `"${v}" phải là chạy thật`);
  }
});
