// Chờ khách nhắn tin MỚI rồi GỠ THẺ GIỮ ngay lúc đó.
// Vì sao cần: hội thoại đang kẹt một tin cũ mà bot không trả lời được. Gỡ thẻ
// sớm thì bot đọc lại đúng tin cũ ấy rồi gắn thẻ lại -> quay vòng. Phải đợi có
// tin mới rồi mới gỡ, để cụm tin bot đọc là cụm MỚI.
require("../env_boot");
const { getConversations } = require("../loi/pancake/pancake_reader");
const { removeTag } = require("../loi/pancake/pancake_sender");

const CONV = String(process.env.CHI_XU_LY_IDS || "").split(",")[0].trim();
const HOLD = [183, 184, 185, 166, 177];   // 184 vào danh sách 25/08/2026 — xem HOLD_TAG_IDS trong bot_worker_api_v3.js
const nghi = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const lay = async () => {
    const d = await getConversations(1);
    return (d.conversations || []).find(c => String(c.id) === CONV) || null;
  };
  const dau = await lay();
  if (!dau) { console.log("KHÔNG thấy hội thoại", CONV); process.exit(1); }
  const moc = new Date(dau.updated_at).getTime();
  console.log(`canh ${CONV} | mốc hiện tại: ${new Date(moc).toLocaleString("vi-VN")}`);

  for (let i = 0; i < 240; i++) {          // tối đa ~20 phút
    await nghi(5000);
    const c = await lay();
    if (!c) continue;
    if (new Date(c.updated_at).getTime() <= moc) continue;
    console.log(`TIN MỚI @${new Date(c.updated_at).toLocaleString("vi-VN")}: "${String(c.snippet || "").slice(0, 60)}"`);
    const ids = (c.tags || []).map(t => Number(t && (t.id ?? t))).filter(n => HOLD.includes(n));
    for (const id of ids) {
      const r = await removeTag(CONV, id);
      console.log(`  gỡ thẻ ${id}:`, (r && r.success !== false) ? "OK" : JSON.stringify(r));
    }
    if (!ids.length) console.log("  (không có thẻ giữ — bot xử được ngay)");
    console.log("XONG — bot sẽ đọc cụm tin mới ở vòng poll kế tiếp.");
    return;
  }
  console.log("HẾT GIỜ CANH — chưa thấy tin mới nào.");
})().catch(e => { console.log("LỖI:", e.message); process.exit(1); });
