#!/usr/bin/env node
// ============================================================================
// thu_mfs.js — THỬ LỚP NỐI mfs bằng dữ liệu thật, KHÔNG chạy lõi bot
// ----------------------------------------------------------------------------
//   node thu_mfs.js            đọc + gửi tin + gắn thẻ (KHÔNG gửi ảnh)
//   node thu_mfs.js --anh      thử luôn cả đường ẢNH (tải lên kho mfs)
//
// Cần .env có MFS_API_URL / MFS_EMAIL / MFS_PASSWORD và mfs đang chạy.
// Tin gửi ra sẽ nằm ở trạng thái `pending` rồi `failed` nếu Page là Page giả —
// đó là ĐÚNG: bot chỉ chịu trách nhiệm tới lúc mfs nhận tin, cổng gửi lo phần
// đẩy sang Meta.
// ============================================================================
require("../env_boot");

const reader = require("../loi/pancake/mfs_reader");
const sender = require("../loi/pancake/mfs_sender");
const mfs = require("../loi/pancake/mfs_client");

const THU_ANH = process.argv.includes("--anh");

let dat = 0, hong = 0;
function ok(ten, dieuKien, ghiChu = "") {
  if (dieuKien) { dat++; console.log(`  ✓ ${ten}${ghiChu ? " — " + ghiChu : ""}`); }
  else { hong++; console.log(`  ✗ ${ten}${ghiChu ? " — " + ghiChu : ""}`); }
}

(async () => {
  console.log(`\nNối tới ${mfs.URL_GOC}\n`);

  console.log("1. Đăng nhập");
  try {
    await mfs.layToken();
    ok("lấy được token", true);
  } catch (e) {
    ok("lấy được token", false, e.message);
    process.exit(1);
  }

  console.log("\n2. Đọc danh sách hội thoại");
  const ds = await reader.getConversations();
  ok("getConversations trả success", ds.success);
  ok("có ít nhất 1 hội thoại", ds.conversations.length > 0, `${ds.conversations.length} hội thoại`);
  if (!ds.conversations.length) {
    console.log("\nKhông có hội thoại nào để thử tiếp. Dừng.");
    process.exit(1);
  }

  const conv = ds.conversations[0];
  const id = conv.id;
  console.log(`   dùng hội thoại ${id} — "${conv.conv_from.name}"`);
  ok("dòng hội thoại có updated_at", Boolean(conv.updated_at));
  ok("dòng hội thoại có mảng tags", Array.isArray(conv.tags));

  console.log("\n3. Đọc chi tiết hội thoại");
  const c = await reader.readConversation(id, conv);
  ok("readConversation trả về object", Boolean(c));
  ok("có conversationId", c.conversationId === id);
  ok("có customerName", Boolean(c.customerName));
  ok("messages là mảng", Array.isArray(c.messages), `${c.messages.length} tin`);

  console.log("\n4. Gửi tin");
  const chu = `thử nối mfs lúc ${new Date().toLocaleTimeString("vi-VN")}`;
  const g = await sender.sendInboxMessage(id, chu);
  ok("sendInboxMessage thành công", g.success === true, g.error || "");
  ok("trả về message_id", Boolean(g.message_id), g.message_id || "");

  console.log("\n5. Tin vừa gửi đọc lại được");
  const c2 = await reader.readConversation(id);
  const thay = c2.messages.find(m => m.text === chu);
  ok("tin nằm trong lịch sử", Boolean(thay));
  if (thay) {
    ok("đúng chiều (shop)", thay.sender === "shop", thay.sender);
    ok("messageId khớp id lúc gửi", thay.messageId === g.message_id);
  }

  console.log("\n6. Gắn thẻ");
  const t = await sender.tagChoXuLyVaUnread(id);
  ok("gắn thẻ chờ người thật", t.tag && t.tag.success === true, (t.tag && t.tag.error) || "");
  ok("đánh dấu chưa đọc", t.unread && t.unread.success === true);

  const dsThe = await reader.fetchConversationTags(id);
  ok("đọc lại thấy thẻ", Array.isArray(dsThe) && dsThe.length > 0, `${(dsThe || []).length} thẻ`);

  const idThe = await mfs.idThe("cho_nguoi_that");
  ok("thẻ đọc lại đúng thẻ vừa gắn", Boolean(idThe) && (dsThe || []).includes(idThe));

  console.log("\n7. Gỡ thẻ");
  const g2 = await sender.removeTag(id, idThe);
  ok("removeTag thành công", g2.success === true, g2.error || "");
  const dsThe2 = await reader.fetchConversationTags(id);
  ok("đọc lại không còn thẻ đó", !(dsThe2 || []).includes(idThe));

  if (THU_ANH) {
    console.log("\n8. Ảnh");
    // Ảnh nhỏ tạo tại chỗ, không phụ thuộc mạng ngoài: 1x1 PNG
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const dataUrl = "data:image/png;base64," + png.toString("base64");
    // _taiAnhLen dùng fetch, mà fetch của Node đọc được data: URL
    const r = await sender.sendInboxImageUrl(id, dataUrl);
    ok("gửi ảnh thành công", r.success === true, r.error || "");

    const truoc = sender._soLanTaiLen();
    const r2 = await sender.sendInboxImageUrl(id, dataUrl);
    ok("gửi lại cùng ảnh vẫn được", r2.success === true, r2.error || "");
    // Đây mới là phép thử thật của sổ nhớ: lần hai KHÔNG được tải lên thêm lần nào
    ok("lần hai không tải lên lại", sender._soLanTaiLen() === truoc,
       `số lần tải lên: ${truoc} -> ${sender._soLanTaiLen()}`);

    // Ghi sổ xuống đĩa rồi đọc lại — lần chạy sau phải dùng lại được
    sender._ghiNgay();
    const fs2 = require("fs");
    let so = {};
    try { so = JSON.parse(fs2.readFileSync("data/mfs_anh_da_tai.json", "utf8")); } catch (_) {}
    ok("sổ nhớ ghi được xuống đĩa", Object.keys(so).length > 0,
       `${Object.keys(so).length} ảnh trong sổ`);
  } else {
    console.log("\n8. Ảnh — bỏ qua (thêm --anh để thử)");
  }

  console.log(`\n${"=".repeat(46)}`);
  console.log(`ĐẠT ${dat} · HỎNG ${hong}`);
  console.log("=".repeat(46));
  process.exit(hong ? 1 : 0);
})().catch(e => {
  console.error("\nLỖI KHÔNG BẮT ĐƯỢC:", e.stack || e.message);
  process.exit(1);
});
