// Kiểm tra token trong .env còn sống không. Chạy: node kiem_tra_token.js
require("dotenv").config();
const https = require("https");

const id = process.env.PANCAKE_PAGE_ID;
const tok = process.env.PANCAKE_PAGE_ACCESS_TOKEN;

console.log("====== KIỂM TRA TOKEN ======");
console.log("PANCAKE_PAGE_ID      :", JSON.stringify(id));
console.log("TOKEN dài            :", (tok || "").length, "ký tự");
console.log("TOKEN đầu...cuối     :", (tok || "").slice(0, 14), "...", (tok || "").slice(-8));
if (!id || !tok) {
  console.log("\n!!! THIẾU PANCAKE_PAGE_ID hoặc PANCAKE_PAGE_ACCESS_TOKEN trong .env -> sửa .env trước.");
  process.exit(1);
}
if (/\s/.test(tok)) console.log("!!! CẢNH BÁO: token có KHOẢNG TRẮNG / xuống dòng -> hỏng, phải dán lại liền 1 dòng.");

const url = `https://pages.fm/api/public_api/v2/pages/${id}/conversations?page_access_token=${tok}`;
console.log("\nĐang gọi thử Pancake...");
https.get(url, (r) => {
  let d = "";
  r.on("data", (c) => (d += c));
  r.on("end", () => {
    try {
      const j = JSON.parse(d);
      if (j && j.success === false) {
        console.log(">> TOKEN HỎNG:", j.message, "(error_code " + j.error_code + ")");
        console.log("   -> Vào Pancake copy token mới, dán lại vào .env (đúng page " + id + ").");
      } else {
        const n = (j.conversations || j.data || []).length;
        console.log(">> TOKEN OK! Lấy được", n, "hội thoại. Token sống, lỗi nằm chỗ khác.");
      }
    } catch (e) {
      console.log(">> Phản hồi lạ (không phải JSON):", d.slice(0, 200));
    }
  });
}).on("error", (e) => console.log("Lỗi mạng:", e.message));
