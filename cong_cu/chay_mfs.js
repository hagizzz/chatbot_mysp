#!/usr/bin/env node
// ============================================================================
// chay_mfs.js — CHẠY LÕI BOT THẬT TRÊN mfs, an toàn
// ----------------------------------------------------------------------------
//   node chay_mfs.js                 chạy, KHÔNG bật AI (bot dùng luật + kịch bản)
//   node chay_mfs.js --ai            bật AI_REPLY_MODE=on (gọi OpenAI thật, tốn tiền)
//   node chay_mfs.js --tat-ca        bỏ hàng rào CHI_XU_LY_IDS (xử MỌI hội thoại)
//
// Khác `chay_thu.bat` (chạy trên Pancake thật) và khác `chat_thu.js` (giả lập
// hoàn toàn trong RAM): đây là lõi bot THẬT, mạng THẬT, nhưng đầu dây bên kia
// là mfs chứ không phải Pancake.
//
// BỐN LỚP AN TOÀN, không lớp nào dựa vào lớp nào:
//
//   1. CHI_XU_LY_IDS   bot chỉ đụng đúng những hội thoại khai ở đây. Không khai
//                      được cái nào -> bot đứng yên, KHÔNG phải "xử tất".
//   2. ORDER_DRY_RUN=1 không tạo đơn POS thật.
//   3. Chốt tầng fs    lõi bot ghi vào 7 tệp sổ sách bằng đường dẫn CỨNG; mọi
//                      lệnh GHI bị bẻ sang thư mục tạm. Đọc thì vẫn đọc bản thật.
//   4. Kho riêng       MEMORY_DB / SHOP_ID / TURNLOG_DIR trỏ vào chỗ riêng.
//
// Lớp 3 không phải đề phòng suông: dựng môi trường thử lần đầu đã dính đúng lỗi
// này — id tin giả lọt vào `processed_messages.json` khiến chính bot lặng thinh
// ở lần chạy sau, và một hội thoại giả lọt vào `conversation_memory.db`.
// ============================================================================
require("../env_boot");

const path = require("path");
const gl = require("../loi/pancake/pancake_gia_lap");   // chỉ mượn chốt ghi, KHÔNG giả lập mạng

const BAT_AI = process.argv.includes("--ai");
const TAT_CA = process.argv.includes("--tat-ca");

(async () => {
  // ---- Nguồn: mfs, không phải Pancake -------------------------------------
  process.env.NGUON_TIN = "mfs";

  const mfs = require("../loi/pancake/mfs_client");
  if (!mfs.daCauHinh()) {
    console.error("Thiếu MFS_EMAIL / MFS_PASSWORD trong .env. Dừng.");
    process.exit(1);
  }

  // ---- Đăng nhập TRƯỚC, để hỏng thì hỏng ngay chứ không hỏng giữa chừng ----
  try {
    await mfs.layToken();
  } catch (e) {
    console.error(`Không đăng nhập được vào mfs: ${e.message}`);
    console.error(`   (${process.env.MFS_API_URL || "http://localhost:3000/v1"} — mfs có đang chạy không?)`);
    process.exit(1);
  }

  // ---- Thẻ: thiếu là bot không nhường được người thật ----------------------
  const the = await mfs.kiemTraThe();
  if (!the.du) {
    console.error("Thiếu thẻ (xem cảnh báo trên). Sửa xong hãy chạy lại.");
    process.exit(1);
  }

  // ---- Hàng rào hội thoại -------------------------------------------------
  const reader = require("../loi/pancake/mfs_reader");
  if (TAT_CA) {
    // "Mọi hội thoại" KHÔNG có nghĩa là mọi hội thoại của shop. mfs chặn theo
    // Page: tài khoản bot chỉ thấy hội thoại của những Page đã gán cho nó.
    // Nên hàng rào thật nằm ở danh sách dưới đây — in ra để nhìn thấy được,
    // chứ một dòng "không có hàng rào" là mô tả sai và gây yên tâm nhầm chỗ.
    const dsPage = await mfs.goiNhe("/channels");
    const pages = (dsPage.success && Array.isArray(dsPage.data) ? dsPage.data : []);
    console.log(`
--tat-ca: bot xử MỌI hội thoại của ${pages.length} Page nó được gán:`);
    for (const p of pages) console.log(`   ${p.externalId || p.id}  ${p.name}`);
    if (!pages.length) {
      console.error("   Tài khoản bot chưa được gán Page nào -> sẽ thấy 0 hội thoại. Dừng.");
      process.exit(1);
    }
    process.env.CHI_XU_LY_IDS = "";
  } else if (!process.env.CHI_XU_LY_IDS) {
    // Chưa khai thì tự lấy danh sách hiện có — trên mfs cục bộ thì đây đúng là
    // mấy hội thoại thử. Vẫn IN RA để người chạy nhìn thấy mình đang đụng ai.
    const ds = await reader.getConversations();
    const ids = ds.conversations.map(c => c.id);
    if (!ids.length) {
      console.error("mfs chưa có hội thoại nào. Dừng — chạy tiếp cũng không có việc gì làm.");
      process.exit(1);
    }
    process.env.CHI_XU_LY_IDS = ids.join(",");
    console.log(`\nBot sẽ CHỈ đụng ${ids.length} hội thoại sau:`);
    for (const c of ds.conversations) {
      console.log(`   ${c.id}  ${c.conv_from.name}`);
    }
  }

  // ---- Ba lớp còn lại -----------------------------------------------------
  const tam = gl.thuMucTam();
  process.env.ORDER_DRY_RUN = "1";
  process.env.MEMORY_DB = path.join(tam, "bo_nho_mfs.db");
  process.env.SHOP_ID = "mysp_mfs_thu";
  process.env.TURNLOG_DIR = path.join(tam, "turnlog");
  process.env.WEBHOOK_PULL_URL = "";          // không kéo hội thoại từ đường webhook cũ
  process.env.GIAMSAT_TU_THOAT = "off";
  process.env.HOA_API_MODE = "gia_lap";
  process.env.FB_ADS_TOKEN = "";              // khỏi đi đồng bộ quảng cáo thật
  process.env.FB_ADS_ACCOUNT_IDS = "";
  // KHÔNG để rỗng. Lõi bot có danh sách "theo dõi" GHI CỨNG gồm nick thật và
  // một hội thoại thật của MYS.P; để rỗng là rơi về đúng danh sách đó, và bot
  // sẽ đi đọc hội thoại khách thật. Trên mfs thì id sai kiểu nên bị chặn, nhưng
  // ở chế độ Pancake thì đó là chọc thẳng vào khách thật.
  process.env.WATCH_IDS = process.env.CHI_XU_LY_IDS || "khong-theo-doi-ai";
  process.env.WATCH_NAMES = "khong-theo-doi-ai";
  if (BAT_AI) process.env.AI_REPLY_MODE = "on";

  gl.chuyenHuongGhi();   // chốt tầng fs

  console.log(`
${"=".repeat(64)}
  LÕI BOT THẬT  ->  mfs   ${mfs.URL_GOC}
${"=".repeat(64)}
  AI          : ${process.env.AI_REPLY_MODE === "on" ? "BẬT (gọi OpenAI thật)" : "tắt"}
  Lên đơn thật: KHÔNG (ORDER_DRY_RUN=1)
  Sổ sách     : bẻ sang ${tam}
  Bộ nhớ      : ${process.env.MEMORY_DB}
${"=".repeat(64)}
  Ctrl+C để dừng.
`);

  require("../bot_worker_api_v3.js");
})().catch(e => {
  console.error("Hỏng khi khởi động:", e.stack || e.message);
  process.exit(1);
});
