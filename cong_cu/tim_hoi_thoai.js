// ============================================================================
// tim_hoi_thoai.js — TÌM conversationId ĐỂ ĐIỀN VÀO CHI_XU_LY_IDS
// ----------------------------------------------------------------------------
//   node tim_hoi_thoai.js              20 hội thoại mới nhất
//   node tim_hoi_thoai.js Phương        chỉ những nick có chữ "Phương"
//   node tim_hoi_thoai.js Phương 50     tìm trong 50 hội thoại mới nhất
//
// CHỈ ĐỌC: không gửi tin, không gắn thẻ, không đụng gì. Chạy bao nhiêu lần
// cũng được.
//
// Dùng để làm gì: muốn chạy thử trên page THẬT mà không đụng khách thật thì
// phải khai CHI_XU_LY_IDS=<id hội thoại của mình> trong .env.staging. File này
// đi tìm đúng cái id đó.
//
// Cách làm: lấy Facebook cá nhân nhắn một câu vào page (vd "test bot"), rồi
// chạy file này và tìm tên mình trong danh sách.
// ============================================================================
"use strict";

require("../env_boot");
const { getConversations } = require("../loi/pancake/pancake_reader");
const reg = require("../loi/pancake/page_registry");

const tuKhoa = (process.argv[2] || "").toLowerCase();
const soLuong = Number(process.argv[3] || 20);

const boDau = s => String(s || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase().trim();

(async () => {
  console.log("Đang hỏi Pancake...\n");
  // NAP DANH SACH PAGE TRUOC. Thieu dong nay thi page_registry rong va
  // pancake_reader roi ve dung MOT page trong .env -- tim hoi thoai cua page
  // thu hai (PHOM, Cupid, Maria...) se ra "khong thay nick nao khop",
  // trong y nhu chua nhan vao page trong khi da nhan roi.
  await reg.init();

  const d = await getConversations(1);

  if (!d || d.success !== true) {
    console.log("KHÔNG lấy được danh sách hội thoại.");
    console.log("Kiểm tra token:  node kiem_tra_token.js");
    process.exit(1);
  }

  let ds = (d.conversations || [])
    .slice()
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));

  if (tuKhoa) {
    const k = boDau(tuKhoa);
    ds = ds.filter(c => boDau(c.from && c.from.name).includes(k));
  }
  ds = ds.slice(0, soLuong);

  if (!ds.length) {
    console.log(tuKhoa
      ? `Không thấy nick nào khớp "${tuKhoa}" trong ${d.conversations.length} hội thoại lấy về.`
      : "Không có hội thoại nào.");
    console.log("\nNhớ nhắn vào page bằng Facebook cá nhân TRƯỚC, rồi mới chạy file này.");
    process.exit(0);
  }

  console.log(`${ds.length} hội thoại (mới nhất trước):\n`);
  for (const c of ds) {
    const ten = (c.from && c.from.name) || "(không tên)";
    const gio = c.updated_at ? new Date(c.updated_at).toLocaleString("vi-VN") : "?";
    const cuoi = String(c.snippet || "").replace(/\s+/g, " ").slice(0, 50);
    console.log(`  ${ten}`);
    console.log(`    id   : ${c.id}`);
    console.log(`    lúc  : ${gio}${cuoi ? `  |  "${cuoi}"` : ""}`);
    console.log("");
  }

  console.log("─".repeat(62));
  console.log("Chép dòng `id` của CHÍNH MÌNH vào .env.staging:");
  console.log(`    CHI_XU_LY_IDS=${ds[0].id}`);
  console.log("");
  console.log("Nhiều nick thì ngăn bằng dấu phẩy, KHÔNG có khoảng trắng.");
  console.log("Bot sẽ CHỈ đụng đúng mấy id này, mọi khách khác bị bỏ qua hoàn toàn.");
})().catch(e => {
  console.log("LỖI:", (e && e.message) || e);
  process.exit(1);
});
