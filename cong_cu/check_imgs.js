// SOI ẢNH theo MÃ: xem tên file + màu bot đọc ra + có pancakeId không.
// Chạy:  node check_imgs.js MRKVX6311
// (hoặc thêm màu cần kiểm:  node check_imgs.js MRKVX6311 Kem )
const pi = require("../loi/san_pham/product_images");
const cu = require("../loi/san_pham/color_utils");

const code = (process.argv[2] || "").toUpperCase().trim();
const wantColor = process.argv[3] || "";

if (!code) {
  console.log("Cách dùng:  node check_imgs.js <MÃ> [màu]");
  console.log("Ví dụ:      node check_imgs.js MRKVX6311 Kem");
  process.exit(1);
}

const items = pi.itemsByCode(code);
console.log(`\n=== Mã ${code}: ${items.length} ảnh trong index ===`);
for (const it of items) {
  const color = pi.colorFromName(it.name, it.code) || "(không đọc được màu)";
  const back = pi.isBackImage(it.name) ? "  [MẶT SAU]" : "";
  const pid = it.pancakeId ? "pancakeId:CÓ" : "pancakeId:KHÔNG";
  const url = it.downloadUrl || it.thumbnailUrl || "(không có url)";
  console.log(`  màu="${color}"${back}  | ${pid} | tên="${it.name}"\n     URL: ${url}`);
}

if (wantColor) {
  const matched = items.filter(it => {
    const c = pi.colorFromName(it.name, it.code);
    return c && (cu.colorMatches(c, wantColor) || cu.colorMatches(wantColor, c));
  });
  console.log(`\n=== Lọc theo màu "${wantColor}": ${matched.length} ảnh sẽ được gửi ===`);
  for (const it of matched) console.log(`  -> "${it.name}"  (màu đọc ra: "${pi.colorFromName(it.name, it.code)}")\n     URL: ${it.downloadUrl || it.thumbnailUrl || "(không có)"}`);
  console.log("\n>> Click vào URL từng ảnh ở trên để xem ảnh THẬT là màu gì.");
  console.log(">> Nếu URL hiện đúng màu kem -> lỗi do content_id map nhầm (bản mới đã gửi bằng URL nên sẽ đúng).");
  console.log(">> Nếu URL hiện màu nâu mà tên lại là -Kem- -> file Drive đặt sai, đổi tên rồi chạy refresh_names.py.");
}
console.log("");
