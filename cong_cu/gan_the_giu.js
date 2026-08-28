#!/usr/bin/env node
// ============================================================================
// gan_the_giu.js — GẮN THẺ GIỮ để BOT KHÁC đứng ngoài hội thoại thử
// ----------------------------------------------------------------------------
//   node gan_the_giu.js <convId>          CHỈ XEM sẽ gắn gì (không đụng gì)
//   node gan_the_giu.js <convId> --gan    THỰC SỰ gắn thẻ giữ
//   node gan_the_giu.js --thu --gan       gắn cho MỌI id trong CHI_XU_LY_IDS
//
// VÌ SAO CẦN FILE NÀY — mặt còn thiếu của go_the_giu.js
// Page PHOM đang có HAI bot: bản chạy thử ở máy này, và một bản khác ở máy
// khác. Hai bot cùng trả lời thì khách nhận tin đúp, và nhìn từ Facebook KHÔNG
// phân biệt được ai gửi — cả hai đều hiện là "PHOM" (gửi bằng page token,
// không có admin_name). Đo thực tế 27/08/2026: khách nhắn 02:17:48, bot ở đây
// nhường người + gắn thẻ lúc 02:18:22, bot kia vẫn nhả 2 câu lúc 02:18:29 và
// 02:18:31 — vì nó đã đọc hội thoại XONG TRƯỚC khi thẻ kịp tới.
//
// Cách tách (khai trong .env.staging): gắn THẺ GIỮ lên hội thoại thử -> bot kia
// dừng theo đúng luật, còn bot ở đây bỏ qua thẻ nhờ BO_QUA_THE_GIU=on.
// Mẹo đó chỉ ăn khi thẻ có SẴN TRƯỚC lúc khách nhắn. Thẻ do chính bot mình gắn
// thì luôn tới sau — muộn đúng một nhịp, và một nhịp là đủ để bot kia chen vào.
//
// Còn một chỗ dễ sập nữa: reset_hoi_thoai.js --lam GỠ SẠCH thẻ Pancake (việc số
// 6 của nó). Dọn hội thoại xong là bot kia sống lại ngay. Nên nếp đúng khi thử:
//
//     node reset_hoi_thoai.js --thu --lam     (dọn, thẻ bay hết)
//     node gan_the_giu.js --thu --gan         (gắn lại rào)
//     ... rồi mới nhắn thử ...
//
// AN TOÀN: chỉ đụng đúng id được nêu tên. Không có id thì thoát, không dò,
// không quét cả page. Chỉ GẮN, không bao giờ gỡ — muốn gỡ thì go_the_giu.js.
// ============================================================================
"use strict";

require("../env_boot");

const argv = process.argv.slice(2);
const GAN = argv.includes("--gan");
const DUNG_THU = argv.includes("--thu");
let ids = argv.filter(a => !a.startsWith("--"));

if (DUNG_THU && !ids.length) {
  ids = String(process.env.CHI_XU_LY_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!ids.length) {
    console.log("--thu cần CHI_XU_LY_IDS có giá trị. Chạy kèm BOT_ENV=staging.");
    process.exit(1);
  }
  console.log(`[--thu] lấy ${ids.length} id từ CHI_XU_LY_IDS.\n`);
}

if (!ids.length) {
  console.log("Thiếu conversationId.\n");
  console.log("  node gan_the_giu.js <convId>        xem sẽ gắn gì");
  console.log("  node gan_the_giu.js <convId> --gan  gắn thẻ giữ");
  console.log("  node gan_the_giu.js --thu --gan     dùng CHI_XU_LY_IDS (kèm BOT_ENV=staging)");
  console.log("\nChưa biết id thì:  node tim_hoi_thoai.js");
  console.log("Gỡ thẻ thì:        node go_the_giu.js <convId> --go");
  process.exit(1);
}

// Thẻ "AI - CHỜ XL". Cùng con số mà lõi bot và go_the_giu.js coi là thẻ giữ —
// lệch số này thì gắn xong bot kia vẫn nói, mà mình lại tưởng đã rào xong.
const THE_CHO_XL = Number(process.env.PANCAKE_TAG_CHO_XL || 183);

const reg = require("../loi/pancake/page_registry");
const { getConversations } = require("../loi/pancake/pancake_reader");

// Gắn thẻ, có nêu THẲNG page. Không dùng pancake_sender.addTag được vì hàm đó
// tự suy page từ id — mà hội thoại COMMENT mang id "POSTID_xxx" nên suy ra POST
// id, không phải page, rồi rơi về PANCAKE_PAGE_ID và gọi nhầm page.
// (Cùng cái bẫy pancake_reader.getMessages đã phải nhận pageIdHint để né.)
async function gan(convId, pid, tagId) {
  const tok = reg.getToken(pid);
  if (!tok) return { success: false, reason: "KHONG_CO_TOKEN_PAGE_" + pid };
  const url = `https://pages.fm/api/public_api/v1/pages/${pid}/conversations/${convId}/tags` +
              `?page_access_token=${tok}`;
  let last = null;
  for (let vong = 1; vong <= 3; vong++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", tag_id: tagId })
      });
      last = await res.json().catch(() => ({}));
      if (res.ok && last && last.success !== false) return last;
    } catch (e) { last = { error: e.message }; }
    if (vong < 3) await new Promise(r => setTimeout(r, 1200));
  }
  return last || { success: false };
}

// Page THẬT của một hội thoại: lấy từ field page_id trong danh sách, vì id của
// hội thoại comment không nói lên page.
async function timPage(ids) {
  const ra = new Map();
  for (const id of ids) {
    const pid = String(id).split("_")[0];
    if (reg.isKnownPage(pid)) ra.set(id, pid);          // inbox: id đã mang page
  }
  if (ra.size === ids.length) return ra;
  const d = await getConversations(1).catch(() => null);
  for (const c of (d && d.conversations) || []) {
    const id = String(c.id);
    if (ids.includes(id) && !ra.has(id) && c.page_id) ra.set(id, String(c.page_id));
  }
  return ra;
}

(async () => {
  // PHẢI nạp sổ page trước. Không nạp thì pancake_sender._pc rơi về
  // PANCAKE_PAGE_ID của .env (Mys.P) rồi gọi thẳng page SAI với token SAI —
  // Pancake trả "Missing required field: 'action'", một thông báo chẳng liên
  // quan gì tới nguyên nhân thật, đủ để mất nửa giờ soi nhầm chỗ.
  await reg.init();

  if (!GAN) {
    console.log(`Sẽ gắn thẻ ${THE_CHO_XL} (AI - CHỜ XL) cho ${ids.length} hội thoại:`);
    for (const id of ids) console.log(`   ${id}`);
    console.log("\nCHỈ XEM — chưa đụng gì. Thêm --gan để thực sự gắn.");
    return;
  }

  const page = await timPage(ids);
  let ok = 0;
  for (const id of ids) {
    const pid = page.get(id);
    if (!pid) {
      console.log(`✘ ${id}  -> không tra được page (hội thoại cũ quá, không nằm trang đầu). Nhắn một câu vào đó rồi chạy lại.`);
      continue;
    }
    const r = await gan(id, pid, THE_CHO_XL);
    const dat = r && r.success !== false;
    if (dat) ok++;
    console.log(`${dat ? "✔" : "✘"} ${id}  (page ${reg.pageName(pid) || pid})${dat ? "" : "  -> " + JSON.stringify(r).slice(0, 120)}`);
  }

  console.log(`\nGắn được ${ok}/${ids.length}.`);
  if (ok) {
    console.log("Bot KHÁC sẽ đứng ngoài mấy hội thoại này. Bot ở đây vẫn phục vụ nhờ BO_QUA_THE_GIU=on");
    console.log("(cờ đó chỉ có tác dụng khi CHI_XU_LY_IDS có giá trị — bản thật không bao giờ dính).");
  }
})().catch(e => { console.error("LỖI:", e.message); process.exit(1); });
