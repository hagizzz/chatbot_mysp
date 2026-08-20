// ============================================================================
// env_boot.js — NẠP BIẾN MÔI TRƯỜNG THEO MÔI TRƯỜNG CHẠY (thật / thử)
// ----------------------------------------------------------------------------
// Vì sao có file này: trước đây mỗi file tự gọi require("dotenv").config() nên
// luôn đọc đúng 1 file .env => không tách được máy chạy THẬT với máy chạy THỬ.
//
// Cách dùng: đặt biến BOT_ENV trước khi chạy.
//     BOT_ENV=staging node bot_worker_api_v3.js     (đọc .env.staging rồi .env)
//     node bot_worker_api_v3.js                     (chỉ đọc .env — chạy thật)
//
// dotenv KHÔNG ghi đè biến đã có, nên file nạp TRƯỚC thắng:
//   .env.<BOT_ENV>  >  .env
// => .env giữ phần dùng chung, .env.staging chỉ khai phần khác biệt
//    (page thử, kho thử, ORDER_DRY_RUN=1 ...).
//
// Nạp file này Ở DÒNG ĐẦU TIÊN của mọi tiến trình chạy nền.
// ============================================================================
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

const ENV = String(process.env.BOT_ENV || "production").trim();
const loaded = [];

function nap(ten) {
  const p = path.join(__dirname, ten);
  if (!fs.existsSync(p)) return false;
  dotenv.config({ path: p });
  loaded.push(ten);
  return true;
}

if (ENV && ENV !== "production") nap(".env." + ENV);
nap(".env");

// Cảnh báo sớm còn hơn chết giữa ca trực.
const BAT_BUOC = ["OPENAI_API_KEY", "PANCAKE_PAGE_ID", "PANCAKE_PAGE_ACCESS_TOKEN"];
const thieu = BAT_BUOC.filter(k => !String(process.env[k] || "").trim());

try {
  console.log(
    `[env] BOT_ENV=${ENV} | đã nạp: ${loaded.join(" + ") || "(không có file .env nào!)"}` +
    (thieu.length ? ` | ⚠ THIẾU: ${thieu.join(", ")}` : "")
  );
} catch (_) {}

// Môi trường thử KHÔNG được phép đụng vào đơn thật nếu quên khai.
if (ENV === "staging" && !process.env.ORDER_DRY_RUN) {
  process.env.ORDER_DRY_RUN = "1";
  try { console.log("[env] staging -> tự bật ORDER_DRY_RUN=1 (không tạo đơn thật)"); } catch (_) {}
}

module.exports = { ENV, loaded, thieu };
