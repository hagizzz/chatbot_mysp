// ============================================================================
// va_206_huy_don.js — VÁ: khách ĐÒI HỦY đơn ĐÃ XÁC NHẬN (hội thoại từ ad) mà
//   chỉ gắn 183, KHÔNG gắn AI-Gửi đơn gấp (206).
// Sửa: trong nhánh "hậu-đơn từ ad", nếu câu khách là đòi hủy + có đơn đã xác nhận
//   -> gắn THÊM 206 (giữ nguyên 183 + giao người thật). Có tra POS status=1;
//   nếu thiếu SĐT thì dựa lịch sử chat (shop đã 'cảm ơn đã đặt / sẽ gửi...').
// An toàn: tự backup, tự kiểm tra cú pháp, hỏng thì tự khôi phục.
// Chạy trong C:\AI_HTK_BOT_V5 :   node va_206_huy_don.js   (rồi pm2 restart bot)
// ============================================================================
const fs = require("fs");
const cp = require("child_process");
const FILE = "bot_worker_api_v3.js";
function die(m){ console.log("\n[HUY] "+m+"\n(Chưa sửa gì — file gốc còn nguyên.)"); process.exit(1); }

if (!fs.existsSync(FILE)) die("Không thấy "+FILE+". Chạy trong C:\\AI_HTK_BOT_V5.");
let src = fs.readFileSync(FILE, "utf8");
if (src.includes("_conf206")) { console.log("[OK] Đã vá trước đó rồi (_conf206 có sẵn). Không làm gì thêm."); process.exit(0); }

const ANCHOR = '      console.log(`[${BOT_NAME}] Conv TỪ AD nhưng hội thoại ĐÃ là HẬU-ĐƠN (khách nhắc đơn đã đặt/chốt/giao/từ chối nhận) -> KHÔNG báo giá lại, GIAO NGƯỜI THẬT. Conv: ${conversationId}`);';

const n = src.split(ANCHOR).length - 1;
if (n !== 1) die("Neo chèn xuất hiện "+n+" lần (cần đúng 1). File có thể đã đổi phiên bản — dừng.");

const INSERT =
'      // [FIX 206] hậu-đơn từ ad + khách ĐÒI HỦY đơn đã xác nhận -> gắn THÊM AI-Gửi đơn gấp (206) cho NV xử gấp.\n' +
'      if (isCancelOrder(_aHT)) {\n' +
'        try {\n' +
'          let _conf206 = false;\n' +
'          const _ph206 = mem.phone || (String(_aHT).match(/(?:\\+?84|0)(?:\\d[\\s.-]?){8,10}\\d/) || [])[0] || null;\n' +
'          if (posConfigured() && _ph206) {\n' +
'            const _pg206 = String(conversationId).split("_")[0];\n' +
'            const _rw206 = await getOrdersByPhone(_ph206);\n' +
'            _conf206 = (_rw206 || []).some(o => Number(o.status) === 1 && (!_pg206 || String(o.page_id || "") === _pg206));\n' +
'          }\n' +
'          if (!_conf206 && shopConfirmedOrderInHistory(data.messages)) _conf206 = true;\n' +
'          if (_conf206) { await tagGuiDonGap(conversationId); console.log(`[hau-don AD] DOI HUY + don da xac nhan -> gan THEM AI-Gui don gap (206).`); }\n' +
'        } catch (_) {}\n' +
'      }\n';

const patched = src.replace(ANCHOR, INSERT + ANCHOR);

const ts = new Date().toISOString().replace(/[:.]/g,"-");
const bak = FILE + ".bak-" + ts;
fs.writeFileSync(bak, src, "utf8");
fs.writeFileSync(FILE, patched, "utf8");
try { cp.execSync('node --check "' + FILE + '"', { stdio:"pipe" }); }
catch (e) { fs.writeFileSync(FILE, src, "utf8"); die("Vá xong bị lỗi cú pháp -> ĐÃ KHÔI PHỤC file gốc. Lỗi: " + (e.stderr?e.stderr.toString().slice(0,200):e.message)); }

console.log("========================================");
console.log("[THANH CONG] Đã vá xong 206 (đòi hủy đơn đã xác nhận).");
console.log(" - Backup: " + bak);
console.log("BƯỚC CUỐI: pm2 restart bot");
console.log("HOÀN TÁC: copy đè file backup lên " + FILE + " rồi pm2 restart bot.");
console.log("========================================");
