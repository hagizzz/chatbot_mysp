#!/usr/bin/env node
// ============================================================================
// go_the_giu.js — XEM / GỠ THẺ GIỮ CỦA MỘT HỘI THOẠI
// ----------------------------------------------------------------------------
//   node go_the_giu.js <convId>          CHỈ XEM thẻ đang có (không đụng gì)
//   node go_the_giu.js <convId> --go     GỠ mọi thẻ giữ khỏi hội thoại đó
//   node go_the_giu.js --thu             dùng luôn CHI_XU_LY_IDS trong .env.staging
//
// VÌ SAO CẦN FILE NÀY
// Hội thoại còn thẻ giữ (AI-CHỜ XL / ĐƠN ƯU TIÊN / Hàng đổi / Đang hoàn) thì
// bot ĐỨNG NGOÀI VĨNH VIỄN — bot_worker_api_v3.js:5774 thoát ngay đầu vòng xử
// lý, trước cả khi đọc tin. Log câu đó lại bị logThrottle bóp nên chỉ in một
// lần; nhìn log về sau tưởng bot treo, thật ra nó đang cố ý im.
//
// Khi chạy thử trên page thật ta khoá đúng MỘT hội thoại (CHI_XU_LY_IDS). Chỉ
// cần một câu rơi vào nhánh "chưa có kịch bản dạy" là hội thoại đó dính thẻ và
// chết hẳn — mọi câu thử sau đó bot không thèm đọc. Không có đường gỡ thì mỗi
// lần thử lại phải vào Pancake bấm tay.
//
// AN TOÀN: chỉ đụng đúng id được nêu tên. Không có id thì thoát, không dò, không
// quét cả page.
// ============================================================================
"use strict";

require("../env_boot");

const argv = process.argv.slice(2);
const GO = argv.includes("--go");
const DUNG_THU = argv.includes("--thu");
let convId = argv.find(a => !a.startsWith("--"));

if (DUNG_THU && !convId) {
  const ds = String(process.env.CHI_XU_LY_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (ds.length !== 1) {
    console.log(`--thu cần CHI_XU_LY_IDS khai ĐÚNG 1 hội thoại, đang thấy ${ds.length}.`);
    console.log("Chạy với BOT_ENV=staging, hoặc nêu thẳng id:  node go_the_giu.js <convId>");
    process.exit(1);
  }
  convId = ds[0];
  console.log(`[--thu] lấy id từ CHI_XU_LY_IDS: ${convId}\n`);
}

if (!convId) {
  console.log("Thiếu conversationId.\n");
  console.log("  node go_the_giu.js <convId>         xem thẻ");
  console.log("  node go_the_giu.js <convId> --go    gỡ thẻ giữ");
  console.log("  node go_the_giu.js --thu --go       dùng CHI_XU_LY_IDS (chạy kèm BOT_ENV=staging)");
  console.log("\nChưa biết id thì:  node tim_hoi_thoai.js");
  process.exit(1);
}

// Cùng bộ nhận diện thẻ giữ với lõi bot. Chép giá trị chứ không require được:
// bot_worker_api_v3.js không có module.exports (script liền khối 12.7k dòng).
// Lệch bộ này với lõi thì gỡ xong bot vẫn đứng ngoài -> có test chặn (xem
// test/the_giu.test.js).
const HOLD_TAG_IDS = [183, 184, 185, 166, 177];   // 184 thêm 25/08/2026 — xem chốt shop trong bot_worker
const HOLD_TAG_NAME_RE = /chờ\s*xl|chờ\s*người\s*thật|đơn\s*ưu\s*tiên|hàng\s*đổi|đang\s*hoàn/i;

const { getConversations } = require("../loi/pancake/pancake_reader");
const { removeTag } = require("../loi/pancake/pancake_sender");

// Thẻ có thể nằm ở nhiều field khác nhau tuỳ payload Pancake trả về.
function docThe(conv) {
  const ra = new Map();   // id -> tên
  const nhet = (id, ten) => {
    const n = Number(id);
    if (Number.isFinite(n)) ra.set(n, ten || ra.get(n) || "");
  };
  for (const t of (conv && conv.tags) || []) {
    if (t == null) continue;
    if (typeof t === "number" || typeof t === "string") nhet(t, typeof t === "string" ? t : "");
    else nhet(t.id != null ? t.id : t.tag_id, t.text || t.name || t.title || "");
  }
  for (const t of (conv && conv.tag_ids) || []) nhet(t, "");
  for (const h of (conv && conv.tag_histories) || []) {
    if (h && h.tag_id != null) nhet(h.tag_id, h.tag_name || h.name || "");
  }
  return ra;
}

const laTheGiu = (id, ten) => HOLD_TAG_IDS.includes(Number(id)) || HOLD_TAG_NAME_RE.test(String(ten || ""));

(async () => {
  console.log("Đang hỏi Pancake...\n");
  const d = await getConversations(1);
  if (!d || d.success !== true) {
    console.log("KHÔNG lấy được danh sách hội thoại. Kiểm tra token:  node kiem_tra_token.js");
    process.exit(1);
  }

  const conv = (d.conversations || []).find(c => String(c.id) === String(convId));
  if (!conv) {
    console.log(`Không thấy hội thoại ${convId} trong ${(d.conversations || []).length} hội thoại lấy về.`);
    console.log("Hội thoại cũ quá có thể không nằm trong trang đầu. Nhắn một câu vào đó rồi chạy lại.");
    process.exit(1);
  }

  const ten = (conv.from && conv.from.name) || "(không tên)";
  const the = docThe(conv);
  console.log(`Hội thoại: ${ten}`);
  console.log(`id       : ${conv.id}`);

  if (!the.size) {
    console.log("thẻ      : (không có thẻ nào)\n");
    console.log("=> Bot KHÔNG bị thẻ giữ chặn.");
    return;
  }

  console.log("thẻ      :");
  const canGo = [];
  for (const [id, tenThe] of the) {
    const giu = laTheGiu(id, tenThe);
    if (giu) canGo.push(id);
    console.log(`   ${giu ? "⛔" : "  "} ${id}${tenThe ? "  " + tenThe : ""}${giu ? "   <- THẺ GIỮ, bot đứng ngoài" : ""}`);
  }
  console.log("");

  if (!canGo.length) {
    console.log("=> Không có thẻ giữ nào. Bot KHÔNG bị chặn bởi thẻ.");
    return;
  }

  if (!GO) {
    console.log(`=> ${canGo.length} thẻ giữ đang chặn bot. Gỡ bằng:`);
    console.log(`      node go_the_giu.js ${convId} --go`);
    return;
  }

  for (const id of canGo) {
    const r = await removeTag(convId, id);
    const ok = r && r.success !== false;
    console.log(`GỠ thẻ ${id}: ${ok ? "OK" : "THẤT BẠI — " + JSON.stringify(r)}`);
  }
  console.log("\nGỡ xong. Bot sẽ xử lý lại hội thoại này ở vòng poll kế tiếp.");
})().catch(e => {
  console.log("LỖI:", (e && e.message) || e);
  process.exit(1);
});
