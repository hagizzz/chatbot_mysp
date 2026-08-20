// ============================================================================
// va_ad_retry.js  —  VÁ lỗi "bot gắn 183 quá sớm khi ad chưa ra mẫu"
// Sửa: trước khi gắn NGƯỜI THẬT vì ad không ra mẫu, QUÉT LẠI vài nhịp
//      (giống hệt việc gỡ thẻ tay rồi bot chạy lại là ra), đủ số lần mới đành gắn.
// An toàn: tự backup, tự kiểm tra cú pháp; nếu hỏng -> tự khôi phục, KHÔNG đụng bot.
// Chạy trong C:\AI_HTK_BOT_V5 :   node va_ad_retry.js
// ============================================================================
const fs = require("fs");
const cp = require("child_process");
const FILE = "bot_worker_api_v3.js";
const MAX_RETRY = 3;   // số nhịp quét lại trước khi đành gắn người thật (đổi tại đây nếu muốn)

function die(m){ console.log("\n[HUY] "+m+"\n(Chưa sửa gì cả — file gốc còn nguyên.)"); process.exit(1); }

if (!fs.existsSync(FILE)) die("Không thấy "+FILE+". Hãy chạy trong thư mục C:\\AI_HTK_BOT_V5.");
let src = fs.readFileSync(FILE, "utf8");

if (src.includes("_adResolveRetry")) {
  console.log("[OK] File đã được vá trước đó rồi (_adResolveRetry đã có). Không làm gì thêm.");
  process.exit(0);
}

const ANCHOR =
'          mem._adUnresolvedModel = true;\n' +
'          try { await tagChoXuLyVaUnread(conversationId); } catch (_) {}';

const n = src.split(ANCHOR).length - 1;
if (n !== 1) die("Neo chèn xuất hiện "+n+" lần (cần đúng 1). Có thể file đã đổi phiên bản — dừng cho chắc.");

const GUARD =
'          // [FIX gắn-183-quá-sớm] ad chưa ra mẫu có thể do ad_ids/creative CHƯA kịp load ở nhịp quét đầu.\n' +
'          //  Giống hệt gỡ thẻ tay rồi bot chạy lại là ra -> QUÉT LẠI vài nhịp TRƯỚC khi đành gắn người thật.\n' +
'          if ((mem._adResolveRetry || 0) < ' + MAX_RETRY + ') {\n' +
'            mem._adResolveRetry = (mem._adResolveRetry || 0) + 1;\n' +
'            console.log(`[reader] AD ${_adId || "-"}: chưa ra mẫu -> KHÔNG gắn người, QUÉT LẠI (lần ${mem._adResolveRetry}/' + MAX_RETRY + ').`);\n' +
'            updateConversationState(conversationId, mem);\n' +
'            return true;   // KHÔNG markProcessed -> vòng sau đọc lại; KHÔNG tag 183\n' +
'          }\n' +
'          mem._adResolveRetry = 0;   // đã thử đủ -> reset rồi mới đành nhường người thật\n';

const patched = src.replace(ANCHOR, GUARD + ANCHOR);

// backup
const ts = new Date().toISOString().replace(/[:.]/g,"-");
const bak = FILE + ".bak-" + ts;
fs.writeFileSync(bak, src, "utf8");
fs.writeFileSync(FILE, patched, "utf8");

// kiểm tra cú pháp; hỏng -> khôi phục
try {
  cp.execSync('node --check "' + FILE + '"', { stdio: "pipe" });
} catch (e) {
  fs.writeFileSync(FILE, src, "utf8");
  die("Sau khi vá bị lỗi cú pháp -> ĐÃ KHÔI PHỤC file gốc. Lỗi: " + (e.stderr ? e.stderr.toString().slice(0,200) : e.message));
}

console.log("========================================");
console.log("[THANH CONG] Đã vá xong.");
console.log(" - Backup file gốc: " + bak);
console.log(" - Số nhịp quét lại trước khi gắn người thật: " + MAX_RETRY);
console.log("");
console.log("BƯỚC CUỐI: khởi động lại bot để áp dụng:");
console.log("     pm2 restart bot");
console.log("");
console.log("Muốn HOÀN TÁC: copy đè file backup lên " + FILE + " rồi pm2 restart bot.");
console.log("========================================");
