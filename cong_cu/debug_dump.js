// debug_dump.js — chạy 1 LẦN để xem cấu trúc hội thoại inbox-từ-bình-luận.
// File này KHÔNG ảnh hưởng gì tới bot, chỉ in dữ liệu ra màn hình.
//
// CÁCH DÙNG:
//   1) Để 1 khách (hoặc nick khác của mày) BÌNH LUẬN vào 1 bài có sản phẩm.
//   2) Đợi Botcake gửi tin mở màn vào inbox cho khách đó.
//   3) Mở CMD, gõ:
//         cd /d C:\AI_HTK_BOT_V5
//         node debug_dump.js > dump.txt
//   4) Mở file dump.txt (nằm trong C:\AI_HTK_BOT_V5), copy hết gửi cho tao.
//   (File này KHÔNG in token, an toàn.)

require("dotenv").config();

const PAGE_ID = process.env.PANCAKE_PAGE_ID;
const PAGE_TOKEN = process.env.PANCAKE_PAGE_ACCESS_TOKEN;
const BASE = "https://pages.fm/api/public_api/v1";

async function getJson(url) {
  const r = await fetch(url);
  return r.json();
}

(async () => {
  if (!PAGE_ID || !PAGE_TOKEN) {
    console.log("Thiếu PANCAKE_PAGE_ID hoặc PANCAKE_PAGE_ACCESS_TOKEN trong .env");
    return;
  }

  const since = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
  const until = Math.floor(Date.now() / 1000);

  // Lấy TẤT CẢ hội thoại gần đây (KHÔNG lọc type) để bắt cả inbox-từ-comment
  const listUrl =
    `${BASE}/pages/${PAGE_ID}/conversations` +
    `?page_access_token=${PAGE_TOKEN}` +
    `&since=${since}&until=${until}` +
    `&page_number=1&page_size=20`;

  const list = await getJson(listUrl);
  const convs = list.conversations || [];
  console.log("=== DANH SÁCH 20 HỘI THOẠI GẦN NHẤT ===");
  console.log("success:", list.success, "| total:", list.total, "| lấy được:", convs.length);

  // In gọn từng hội thoại + đánh dấu cái nào có dấu hiệu đến từ bình luận
  for (const c of convs) {
    const blob = JSON.stringify(c).toLowerCase();
    const looksFromComment =
      blob.includes("comment") || blob.includes("post_id") || blob.includes("phản hồi bình luận") || blob.includes("phan hoi binh luan");
    console.log({
      id: c.id,
      type: c.type,
      from: c.from && c.from.name,
      post_id: c.post_id,
      tu_binh_luan: looksFromComment ? "CÓ_THỂ_ĐÚNG" : "",
      keys: Object.keys(c)
    });
  }

  // Chọn 1 hội thoại có vẻ đến từ comment để dump chi tiết; nếu không có thì lấy cái đầu
  const target =
    convs.find(c => JSON.stringify(c).toLowerCase().includes("comment") || c.post_id) ||
    convs[0];

  if (!target) {
    console.log("\nKhông có hội thoại nào để dump.");
    return;
  }

  console.log("\n=== RAW CONVERSATION (1 cái) ===");
  console.log(JSON.stringify(target, null, 2));

  console.log("\n=== RAW MESSAGES của hội thoại đó (cắt 9000 ký tự) ===");
  const msgs = await getJson(
    `${BASE}/pages/${PAGE_ID}/conversations/${target.id}/messages?page_access_token=${PAGE_TOKEN}`
  );
  console.log(JSON.stringify(msgs, null, 2).slice(0, 9000));
})().catch(e => console.log("LỖI:", e.message));
