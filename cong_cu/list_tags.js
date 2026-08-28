// Liệt kê TẤT CẢ thẻ (tag) của Page kèm ID, để biết id thẻ "AI chốt".
// Dùng:  node list_tags.js
require("dotenv").config();
const PAGE_ID = process.env.PANCAKE_PAGE_ID;
const TOKEN = process.env.PANCAKE_PAGE_ACCESS_TOKEN;
if (!PAGE_ID || !TOKEN) { console.log("Thiếu PANCAKE_PAGE_ID hoặc PANCAKE_PAGE_ACCESS_TOKEN trong .env"); process.exit(1); }
(async () => {
  try {
    const url = `https://pages.fm/api/public_api/v1/pages/${PAGE_ID}/tags?page_access_token=${TOKEN}`;
    const res = await fetch(url);
    const data = await res.json();
    const tags = data.tags || data.data || data;
    if (!Array.isArray(tags)) { console.log("Phản hồi không như mong đợi:", JSON.stringify(data).slice(0, 400)); return; }
    console.log("=== DANH SÁCH THẺ ===");
    for (const t of tags) {
      const id = t.id != null ? t.id : t.tag_id;
      const name = t.text || t.name || t.title || "(không tên)";
      console.log(`id=${id}\t| ${name}`);
    }
    console.log("\n-> Tìm dòng tên 'AI chốt', lấy số id, dán vào .env:  PANCAKE_TAG_AI_CHOT=<id>");
  } catch (e) { console.log("Lỗi:", e.message); }
})();
