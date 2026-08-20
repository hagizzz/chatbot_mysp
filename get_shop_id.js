// Lấy nhanh shop_id: chỉ in TÊN + ID, khỏi lội đống JSON.
// Cách chạy:
//   node get_shop_id.js                (đọc PANCAKE_POS_API_KEY trong .env)
//   node get_shop_id.js API_KEY_CUA_BAN (truyền thẳng key, chưa cần .env)
require("dotenv").config();
const KEY = process.argv[2] || process.env.PANCAKE_POS_API_KEY;
if (!KEY) { console.log("Thiếu api_key. Dùng: node get_shop_id.js API_KEY_CUA_BAN"); process.exit(1); }
(async () => {
  try {
    const res = await fetch(`https://pos.pages.fm/api/v1/shops?api_key=${KEY}`);
    const data = await res.json();
    const shops = data.shops || data.data || [];
    if (!Array.isArray(shops) || !shops.length) {
      console.log("Không lấy được shop. Phản hồi:", JSON.stringify(data).slice(0, 300));
      console.log("-> Kiểm tra lại api_key (có thể sai hoặc chưa kích hoạt).");
      return;
    }
    console.log("=== DANH SÁCH SHOP ===");
    for (const s of shops) console.log(`shop_id = ${s.id}\t| ${s.name || "(không tên)"}`);
    console.log("\n-> Copy số shop_id của shop bán hàng, dán vào .env:  PANCAKE_POS_SHOP_ID=<số>");
  } catch (e) { console.log("Lỗi gọi API:", e.message); }
})();
