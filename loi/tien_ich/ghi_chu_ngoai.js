// ============================================================================
// ghi_chu_ngoai.js — SỔ GHI CHÚ THAY CHO GHI CHÚ PANCAKE
// ----------------------------------------------------------------------------
// Bot có 6 chỗ viết ghi chú cho NHÂN VIÊN: ảnh nhận ra mã nhưng thiếu dòng
// Sheet, khách nói lấy nhiều mẫu mà bot chỉ dò ra một, giá lệch giữa ad và
// sheet, mẫu ứng với quảng cáo...  Tất cả đi qua addConversationNote().
//
// ĐO NGÀY 26/08/2026: endpoint ghi chú KHÔNG TỒN TẠI trong public API của
// Pancake. Thử cả 5 đường (public_api v1/v2 notes, note, v1 notes, comments)
// đều trả `HTTP 404 Page not found`. Nghĩa là mọi ghi chú bot từng viết đều
// rơi vào hư không, và không ai biết vì hàm chỉ in một dòng log rồi trả về.
//
// Nay: gọi API hụt thì ghi vào SỔ RIÊNG, kèm đường báo động nếu shop có khai.
//   · data/ghi_chu_bot.jsonl   — bền, tra được, mỗi dòng một ghi chú
//   · console.log "[GHI-CHÚ]"  — người trực nhìn thấy ngay trên màn hình
//   · CANH_BAO_WEBHOOK         — đẩy sang Slack/Telegram nếu đã khai trong .env
//
// Xem lại:  node ghi_chu_ngoai.js            20 ghi chú gần nhất
//           node ghi_chu_ngoai.js 50         50 ghi chú gần nhất
// ============================================================================
"use strict";
const __goc = require("path").join(__dirname, "..", "..");
const fs = require("fs");
const path = require("path");

const THU_MUC = process.env.GHI_CHU_DIR || path.join(__goc, "data");
const TEP = path.join(THU_MUC, "ghi_chu_bot.jsonl");

function _bảoĐảmThưMục() {
  try { if (!fs.existsSync(THU_MUC)) fs.mkdirSync(THU_MUC, { recursive: true }); } catch (_) {}
}

/**
 * Ghi một ghi chú dành cho NHÂN VIÊN.
 * @param {object} o { conversationId, text, ma, khach }
 * Không bao giờ ném lỗi: ghi chú hụt không được phép làm chết lượt xử của bot.
 */
function ghi(o) {
  const d = {
    luc: new Date().toISOString(),
    conversationId: String((o && o.conversationId) || ""),
    ma: (o && o.ma) || "",
    khach: (o && o.khach) || "",
    text: String((o && o.text) || "").trim()
  };
  if (!d.text) return d;
  try {
    _bảoĐảmThưMục();
    fs.appendFileSync(TEP, JSON.stringify(d) + "\n", "utf8");
  } catch (e) {
    try { console.log("[GHI-CHÚ] KHÔNG ghi được vào sổ:", e.message); } catch (_) {}
  }
  // In ĐẬM để người trực thấy — đây là việc cần NGƯỜI làm, không phải log thường.
  try { console.log(`[GHI-CHÚ] ${d.conversationId} | ${d.text}`); } catch (_) {}
  _webhook(d);
  return d;
}

function _webhook(d) {
  const url = String(process.env.CANH_BAO_WEBHOOK || "").trim();
  if (!url) return;
  try {
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `[BOT cần người xử] ${d.conversationId}\n${d.text}` })
    }).catch(() => {});
  } catch (_) {}
}

/** Đọc lại sổ. Trả mảng, mới nhất trước. */
function doc(soLuong = 20) {
  try {
    const dong = fs.readFileSync(TEP, "utf8").split("\n").filter(Boolean);
    return dong.slice(-soLuong).map(x => { try { return JSON.parse(x); } catch (_) { return null; } })
      .filter(Boolean).reverse();
  } catch (_) { return []; }
}

module.exports = { ghi, doc, TEP };

// --- Chạy trực tiếp: xem sổ -------------------------------------------------
if (require.main === module) {
  const n = Number(process.argv[2] || 20);
  const ds = doc(n);
  if (!ds.length) { console.log("Sổ ghi chú trống:", TEP); process.exit(0); }
  console.log(`${ds.length} ghi chú gần nhất (mới nhất trước) — ${TEP}\n`);
  for (const d of ds) {
    console.log(`  ${new Date(d.luc).toLocaleString("vi-VN")}  ${d.conversationId}`);
    console.log(`     ${d.text}\n`);
  }
}
