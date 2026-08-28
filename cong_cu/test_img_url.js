// Kiểm tra 1 LINK ẢNH có phải ảnh thô (Facebook/Pancake fetch được) hay không.
// Dùng:  node test_img_url.js "https://..."
const url = process.argv[2];
if (!url) { console.log('Cách dùng: node test_img_url.js "<URL_ẢNH>"'); process.exit(1); }
(async () => {
  try {
    const res = await fetch(url, { redirect: "follow" });
    const ct = res.headers.get("content-type") || "(không có)";
    const buf = Buffer.from(await res.arrayBuffer());
    console.log("HTTP   :", res.status);
    console.log("Kiểu   :", ct);
    console.log("Dung lg:", buf.length, "bytes");
    if (res.ok && ct.startsWith("image/")) {
      console.log("✅ ĐÚNG ảnh thô -> Facebook/Pancake fetch được. Dán link này vào .env là gửi được.");
    } else {
      console.log("❌ KHÔNG phải ảnh thô (trả về '" + ct + "') -> FB KHÔNG nhận.");
      console.log("   Đổi sang link ảnh trực tiếp: lh3.googleusercontent.com/d/<FILEID>  HOẶC host ở imgbb.com / postimages.org.");
    }
  } catch (e) { console.log("Lỗi fetch:", e.message); }
})();
