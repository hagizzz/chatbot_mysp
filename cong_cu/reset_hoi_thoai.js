#!/usr/bin/env node
// ============================================================================
// reset_hoi_thoai.js — DỌN SẠCH MỘT HỘI THOẠI ĐỂ THỬ LẠI TỪ ĐẦU
// ----------------------------------------------------------------------------
//   node reset_hoi_thoai.js <convId>              CHỈ XEM, không đụng gì
//   node reset_hoi_thoai.js --thu                 lấy id từ CHI_XU_LY_IDS
//   node reset_hoi_thoai.js --thu --lam           THỰC SỰ dọn
//   node reset_hoi_thoai.js --thu --lam --tra-loi-lai
//                                                 dọn xong CHỪA cụm tin khách
//                                                 cuối để bot trả lời lại ngay
//
// VÌ SAO CẦN
// Thử trên page thật, một hội thoại chạy dở dang để lại dấu vết ở SÁU chỗ khác
// nhau. Xoá thiếu một chỗ là lần thử sau không còn "từ đầu" nữa mà vẫn mang
// theo nửa cái đơn cũ — rất khó nhận ra, vì mỗi chỗ nằm một tệp:
//
//   1. bo_nho_thu.db / hoi_thoai      địa chỉ, sđt, size, mẫu đang xem, mã đã báo giá
//   2. bo_nho_thu.db / hang_doi_don   phiếu chờ LÊN ĐƠN (order_worker sẽ nuốt)
//   3. bot_dup_sent.json              sổ chống gửi trùng -> câu y hệt sẽ bị nuốt
//   4. pending_followups.json         hẹn nhắc lại sau 2 tiếng
//   5. processed_messages.json        sổ tin đã xử (ĐĨA, sống qua restart)
//   6. Thẻ trên Pancake               thẻ giữ -> bot đứng ngoài vĩnh viễn
//
// Còn hai sổ nữa nằm trong RAM (botSentIds, _daXuLyLuotChay) — tắt/bật lại bot
// là sạch. Script nhắc ở cuối.
//
// ĐIỀU QUAN TRỌNG NHẤT: MẶC ĐỊNH script ĐÁNH DẤU ĐÃ XỬ toàn bộ tin cũ.
// Hội thoại này là KHÁCH THẬT. Xoá sổ tin đã xử mà không đánh dấu lại thì vòng
// poll kế tiếp bot đọc thấy cả lịch sử là "tin mới" và trả lời lại từng câu —
// khách nhận một tràng tin nhắn cũ. "Từ đầu" nghĩa là bộ nhớ sạch, KHÔNG phải
// diễn lại lịch sử.
//
// AN TOÀN: chỉ đụng đúng id được nêu tên. Không quét page, không dò.
// ============================================================================
"use strict";

const __goc = require("path").join(__dirname, "..");
require("../env_boot");

const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const LAM         = argv.includes("--lam");
const TRA_LOI_LAI = argv.includes("--tra-loi-lai");
const GO_THE_SHOP = argv.includes("--go-ca-the-shop");
const DUNG_THU    = argv.includes("--thu");
const GIU_LICH_SU = argv.includes("--giu-lich-su");
let convId = argv.find(a => !a.startsWith("--"));

if (DUNG_THU && !convId) {
  const ds = String(process.env.CHI_XU_LY_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (ds.length !== 1) {
    console.log(`--thu cần CHI_XU_LY_IDS khai ĐÚNG 1 hội thoại, đang thấy ${ds.length}.`);
    console.log("Chạy kèm BOT_ENV=staging, hoặc nêu thẳng id.");
    process.exit(1);
  }
  convId = ds[0];
}

if (!convId) {
  console.log("Thiếu conversationId.\n");
  console.log("  node reset_hoi_thoai.js <convId>            xem sẽ dọn những gì");
  console.log("  node reset_hoi_thoai.js --thu --lam         dọn hội thoại đang thử");
  console.log("\nChưa biết id thì:  node tim_hoi_thoai.js");
  process.exit(1);
}

// ---- Thẻ ------------------------------------------------------------------
// Thẻ do CHÍNH BOT gắn -> reset là phải gỡ, không cần hỏi ai.
const THE_CUA_BOT = [
  [182, "AI chốt"],
  [183, "AI-Chờ XL"],
  [184, "AI-XL ảnh"],
  [185, "AI-Đơn ưu tiên"],
  [186, "AI đã xác nhận"],
  [204, "AI đã xác nhận"],
  [206, "AI-Gửi đơn gấp"]
];
// Thẻ của NGƯỜI THẬT trong shop. Cũng chặn bot (nằm trong HOLD_TAG_IDS) nhưng
// mang thông tin nghiệp vụ có thật — gỡ hộ là xoá mất việc của nhân viên.
// Chỉ gỡ khi được nêu đích danh --go-ca-the-shop.
const THE_CUA_SHOP = [[166, "Hàng đổi"], [177, "Đang hoàn"]];

const TEN_THE = new Map([...THE_CUA_BOT, ...THE_CUA_SHOP]);

const SHOP_ID = process.env.SHOP_ID || "mysp";
const DB_FILE = process.env.MEMORY_DB || path.join(__goc, "conversation_memory.db");

const P_DUP    = path.join(__goc, "bot_dup_sent.json");
const P_FOLLOW = path.join(__goc, "pending_followups.json");
const P_XULY   = path.join(__goc, "processed_messages.json");

const docJson = (p, macDinh) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (_) { return macDinh; }
};

// Cụm tin khách CUỐI = dãy tin liên tiếp của khách ở cuối hội thoại. Chỉ dùng
// cho --tra-loi-lai. Cùng cách hiểu với getLastCustomerMessages trong lõi bot.
function cumTinKhachCuoi(tin) {
  const ra = [];
  for (let i = tin.length - 1; i >= 0; i--) {
    if (tin[i].sender !== "customer") break;
    ra.unshift(tin[i]);
  }
  return ra;
}

(async () => {
  console.log("=".repeat(72));
  console.log("RESET HỘI THOẠI" + (LAM ? "" : "  —  CHỈ XEM (thêm --lam để thực sự dọn)"));
  console.log("=".repeat(72));
  console.log(`hội thoại : ${convId}`);
  console.log(`shop_id   : ${SHOP_ID}`);
  console.log(`CSDL      : ${DB_FILE}`);
  console.log("");

  // ---- 1. Hỏi Pancake: tin nhắn + thẻ ------------------------------------
  const { getMessages, normalizeMessages, fetchConversationTags, getConversations } = require("../loi/pancake/pancake_reader");
  const pageId = String(convId).split("_")[0];

  // Đọc thẻ theo HAI đường. Đường nhẹ (/conversations/<id>/tags) đo thực tế
  // 26/08 trả null cho chính hội thoại này, trong khi hội thoại ĐANG có thẻ 202.
  // Tin vào mỗi đường đó thì script báo "không có thẻ" rồi bỏ qua bước gỡ —
  // reset xong bot vẫn đứng ngoài vì thẻ giữ còn nguyên. Hụt thì hỏi danh sách
  // hội thoại (nặng hơn: quét 240 hội thoại) — đó là đường go_the_giu.js dùng.
  async function docThe() {
    const nhe = await fetchConversationTags(convId, pageId);
    if (nhe != null && nhe.length) return { ids: nhe, duong: "endpoint /tags" };
    const d = await getConversations(1);
    const conv = d && d.success === true
      ? (d.conversations || []).find(c => String(c.id) === String(convId)) : null;
    if (!conv) return { ids: nhe, duong: nhe == null ? null : "endpoint /tags" };
    const ra = new Set();
    for (const t of conv.tags || []) {
      const n = Number(t && typeof t === "object" ? (t.id != null ? t.id : t.tag_id) : t);
      if (Number.isFinite(n)) ra.add(n);
    }
    for (const t of conv.tag_ids || []) { const n = Number(t); if (Number.isFinite(n)) ra.add(n); }
    for (const h of conv.tag_histories || []) {
      if (h && h.tag_id != null && h.removed !== true && h.is_removed !== true) ra.add(Number(h.tag_id));
    }
    // Lọc id <= 0: payload Pancake thỉnh thoảng có phần tử rỗng, Number("") ra 0
    // -> in ra thành "thẻ 0" và làm người đọc tưởng có thẻ lạ.
    return { ids: [...ra].filter(n => n > 0), duong: "danh sách hội thoại" };
  }

  let tin = [];
  try {
    const raw = await getMessages(convId, pageId);
    tin = normalizeMessages((raw && (raw.messages || raw.data)) || [], pageId) || [];
  } catch (e) {
    console.log("KHÔNG đọc được tin nhắn: " + (e && e.message));
    console.log("Không có danh sách tin thì KHÔNG thể đánh dấu đã-xử -> dừng, tránh bot");
    console.log("trả lời lại toàn bộ lịch sử cho khách thật.");
    process.exit(1);
  }
  const idTin = [...new Set(tin.map(m => m && m.messageId).filter(Boolean))];
  const cumCuoi = cumTinKhachCuoi(tin);
  console.log(`[1] Pancake : ${tin.length} tin, ${idTin.length} id khác nhau. Cụm tin khách cuối: ${cumCuoi.length} tin.`);
  for (const m of cumCuoi.slice(-3)) {
    console.log(`      · ${String(m.text || "[" + m.type + "]").slice(0, 70)}`);
  }

  const { ids: _the, duong: _duongThe } = await docThe();
  if (_the == null) {
    // Không phân biệt được "sạch thẻ" với "hỏng đường đọc" -> DỪNG. Reset mà bỏ
    // sót thẻ giữ là ca thử sau bot im hoàn toàn, mất cả buổi mới truy ra.
    console.log("[2] Thẻ     : KHÔNG đọc được (cả hai đường đều hụt).");
    console.log("      Dừng lại: không dám dọn khi chưa biết hội thoại còn thẻ giữ hay không.");
    console.log("      Kiểm tra token:  node kiem_tra_token.js");
    process.exit(1);
  }
  const theDangCo = _the;
  const goBot  = theDangCo.filter(id => THE_CUA_BOT.some(t => t[0] === id));
  const coShop = theDangCo.filter(id => THE_CUA_SHOP.some(t => t[0] === id));
  const theKhac = theDangCo.filter(id => !TEN_THE.has(id));
  console.log(`[2] Thẻ     : ${theDangCo.length ? theDangCo.map(id => id + (TEN_THE.get(id) ? " " + TEN_THE.get(id) : "")).join(", ") : "(không có)"}  [đọc qua ${_duongThe}]`);
  if (theKhac.length) {
    console.log(`      ${theKhac.join(", ")} không phải thẻ bot -> KHÔNG đụng.`);
  }
  if (coShop.length && !GO_THE_SHOP) {
    console.log(`      ⚠ ${coShop.map(id => id + " " + TEN_THE.get(id)).join(", ")} là thẻ NHÂN VIÊN gắn, KHÔNG gỡ.`);
    console.log("        Thẻ này cũng chặn bot. Muốn gỡ luôn: thêm --go-ca-the-shop");
  }

  // ---- 2. Xem CSDL --------------------------------------------------------
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(DB_FILE);
  db.exec("PRAGMA busy_timeout = 5000");
  const coBang = (n) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(n);

  let dongNho = null, dongDon = [];
  if (coBang("hoi_thoai")) {
    dongNho = db.prepare("SELECT du_lieu, sua_luc FROM hoi_thoai WHERE shop_id=? AND conversation_id=?").get(SHOP_ID, convId) || null;
  }
  if (coBang("hang_doi_don")) {
    dongDon = db.prepare("SELECT trang_thai, tao_luc FROM hang_doi_don WHERE shop_id=? AND conversation_id=?").all(SHOP_ID, convId) || [];
  }

  if (dongNho) {
    let d = {};
    try { d = JSON.parse(dongNho.du_lieu); } catch (_) {}
    const tom = [
      d.currentProduct && d.currentProduct.code ? "mẫu " + d.currentProduct.code : null,
      d.customerSize ? "size " + d.customerSize : null,
      d.phone ? "sđt " + d.phone : null,
      d.address ? 'địa chỉ "' + d.address + '"' : null,
      d.stage ? "giai đoạn " + d.stage : null,
      Array.isArray(d.pricedCodes) && d.pricedCodes.length ? d.pricedCodes.length + " mã đã báo giá" : null,
      d.aiStandsOut ? "ĐANG đứng ngoài" : null
    ].filter(Boolean);
    console.log(`[3] Bộ nhớ  : có, sửa lần cuối ${dongNho.sua_luc}`);
    console.log(`      ${tom.join(" | ") || "(toàn giá trị mặc định)"}`);
  } else {
    console.log("[3] Bộ nhớ  : (không có dòng nào)");
  }
  console.log(`[4] Hàng đợi lên đơn: ${dongDon.length ? dongDon.map(r => r.trang_thai + " từ " + r.tao_luc).join(", ") : "(trống)"}`);

  // ---- 3. Xem mấy tệp JSON ------------------------------------------------
  const dup = docJson(P_DUP, {});
  const soDup = Array.isArray(dup[convId]) ? dup[convId].length : 0;
  const follow = docJson(P_FOLLOW, []);
  const soFollow = Array.isArray(follow) ? follow.filter(x => Array.isArray(x) && String(x[0]) === String(convId)).length : 0;
  const xuLy = new Set(docJson(P_XULY, []));
  const daCo = idTin.filter(id => xuLy.has(id)).length;
  console.log(`[5] Chống trùng     : ${soDup} câu đã ghi sổ`);
  console.log(`[6] Hẹn nhắc lại    : ${soFollow} lịch`);
  console.log(`[7] Sổ tin đã xử    : ${daCo}/${idTin.length} tin của hội thoại này đã được đánh dấu`);

  // ---- Mốc bỏ qua tin cũ ---------------------------------------------------
  // Sổ tin đã xử chỉ ngăn bot TRẢ LỜI LẠI tin cũ. Nó KHÔNG giấu tin cũ khỏi AI:
  // mỗi lượt bot vẫn nạp 20 tin cuối vào cửa sổ (buildConversationForAi) nên AI
  // vẫn đọc thấy địa chỉ cũ, size cũ, giá đã báo. Muốn "từ đầu" thật thì phải
  // đặt mốc. Messenger không cho xoá tin nên đây là cách duy nhất.
  const mocBoQua = require("../loi/bo_nho/moc_bo_qua");
  const mocCu = mocBoQua.moc(convId);
  // Mốc = ngay SAU tin cuối cùng đang có, chứ không phải Date.now(). Giờ máy và
  // giờ Pancake lệch nhau vài giây là đủ để một tin cũ lọt qua mốc.
  // Đọc giờ bằng ĐÚNG hàm lõi bot dùng. Tự new Date() ở đây là lệch 7 tiếng —
  // xem chú thích gioTin trong moc_bo_qua.js, đã cắn một lần ngày 26/08.
  const gio = (m) => mocBoQua.gioTin(m && m.insertedAt);
  const tCuoi = Math.max(0, ...tin.map(gio));
  // --tra-loi-lai muốn bot TRẢ LỜI cụm tin khách cuối -> mốc phải đứng TRƯỚC cụm
  // đó, không thì vừa mở khoá trong sổ tin đã xử vừa giấu nó đi bằng mốc, và bot
  // im như chưa reset. Hai cơ chế phải chỉ về cùng một hướng.
  const tCumCuoi = cumCuoi.length ? Math.min(...cumCuoi.map(gio).filter(t => t > 0)) : 0;
  const mocMoi = (TRA_LOI_LAI && tCumCuoi)
    ? tCumCuoi - 1000
    : (tCuoi ? tCuoi : Date.now()) + 1000;
  console.log(`[8] Mốc bỏ qua      : ${mocCu ? new Date(mocCu).toISOString() : "(chưa có)"}`
    + (GIU_LICH_SU ? "  -> --giu-lich-su: KHÔNG đặt mốc" : `  -> sẽ đặt ${new Date(mocMoi).toISOString()}`));

  console.log("");
  if (!LAM) {
    console.log("SẼ LÀM (khi thêm --lam):");
    console.log(`   gỡ ${goBot.length + (GO_THE_SHOP ? coShop.length : 0)} thẻ` + (goBot.length ? " (" + goBot.join(", ") + ")" : ""));
    console.log(`   xoá ${dongNho ? 1 : 0} dòng bộ nhớ, ${dongDon.length} phiếu chờ lên đơn`);
    console.log(`   xoá ${soDup} câu chống trùng, ${soFollow} lịch nhắc`);
    if (TRA_LOI_LAI) {
      console.log(`   đánh dấu đã-xử ${idTin.length - cumCuoi.length} tin cũ, CHỪA ${cumCuoi.length} tin khách cuối để bot trả lời lại`);
    } else {
      console.log(`   đánh dấu đã-xử CẢ ${idTin.length} tin -> bot KHÔNG diễn lại lịch sử với khách`);
    }
    if (!GIU_LICH_SU) console.log(`   đặt mốc bỏ qua -> AI không còn đọc thấy ${tin.length} tin cũ`);
    db.close();
    return;
  }

  // ---- 4. LÀM THẬT --------------------------------------------------------
  console.log("--- BẮT ĐẦU DỌN ---");

  // 4a. Thẻ. Gỡ TRƯỚC khi xoá bộ nhớ: nếu bot đang chạy và nhảy vào giữa
  //     chừng thì thà nó thấy bộ nhớ cũ + không thẻ (im lặng chờ) còn hơn
  //     thấy bộ nhớ rỗng + thẻ giữ (ghi lại một dòng rác mới).
  const { removeTag } = require("../loi/pancake/pancake_sender");
  const canGo = [...goBot, ...(GO_THE_SHOP ? coShop : [])];
  for (const id of canGo) {
    const r = await removeTag(convId, id);
    console.log(`   gỡ thẻ ${id} ${TEN_THE.get(id) || ""}: ${r && r.success !== false ? "OK" : "THẤT BẠI " + JSON.stringify(r)}`);
  }
  if (!canGo.length) console.log("   thẻ: không có gì phải gỡ");

  // 4b. CSDL
  if (coBang("hoi_thoai")) {
    const n = db.prepare("DELETE FROM hoi_thoai WHERE shop_id=? AND conversation_id=?").run(SHOP_ID, convId).changes;
    console.log(`   xoá bộ nhớ hội thoại: ${n} dòng`);
  }
  if (coBang("hang_doi_don")) {
    const n = db.prepare("DELETE FROM hang_doi_don WHERE shop_id=? AND conversation_id=?").run(SHOP_ID, convId).changes;
    console.log(`   xoá phiếu chờ lên đơn: ${n} dòng`);
  }
  db.close();

  // 4c. Chống trùng
  if (dup[convId]) {
    delete dup[convId];
    fs.writeFileSync(P_DUP, JSON.stringify(dup), "utf8");
    console.log(`   xoá sổ chống trùng: ${soDup} câu`);
  } else {
    console.log("   sổ chống trùng: trống sẵn");
  }

  // 4d. Hẹn nhắc lại
  if (soFollow) {
    fs.writeFileSync(P_FOLLOW, JSON.stringify(follow.filter(x => !(Array.isArray(x) && String(x[0]) === String(convId)))), "utf8");
    console.log(`   xoá lịch nhắc: ${soFollow}`);
  } else {
    console.log("   lịch nhắc: trống sẵn");
  }

  // 4e. Sổ tin đã xử — bước GIỮ KHÁCH KHÔNG BỊ SPAM
  const chua = TRA_LOI_LAI ? new Set(cumCuoi.map(m => m.messageId)) : new Set();
  let them = 0, bo = 0;
  for (const id of idTin) {
    if (chua.has(id)) { if (xuLy.delete(id)) bo++; }
    else if (!xuLy.has(id)) { xuLy.add(id); them++; }
  }
  fs.writeFileSync(P_XULY, JSON.stringify([...xuLy].slice(-5000)), "utf8");
  console.log(`   sổ tin đã xử: đánh dấu thêm ${them} tin cũ` + (TRA_LOI_LAI ? `, mở lại ${bo} tin của cụm cuối` : ""));

  // 4f. Mốc bỏ qua — thứ THẬT SỰ làm hội thoại "trắng" trong mắt AI
  if (GIU_LICH_SU) {
    console.log("   mốc bỏ qua: --giu-lich-su -> giữ nguyên, AI vẫn đọc 20 tin cuối");
  } else {
    mocBoQua.dat(convId, mocMoi);
    console.log(`   đặt mốc bỏ qua: ${new Date(mocMoi).toISOString()} -> giấu ${tin.filter(m => gio(m) && gio(m) < mocMoi).length}/${tin.length} tin cũ khỏi AI`);
  }

  console.log("");
  console.log("=".repeat(72));
  console.log("XONG. Hội thoại đã sạch.");
  console.log("");
  console.log("Còn HAI sổ nằm trong RAM của tiến trình bot — phải TẮT/BẬT LẠI bot mới sạch:");
  console.log("   botSentIds        (bot tự nhận ra câu mình đã gửi)");
  console.log("   _daXuLyLuotChay   (chặn xử lại trong cùng lượt chạy)");
  console.log("Bot đang chạy mà không khởi động lại thì nó vẫn nhớ lượt cũ.");
  console.log("(Riêng MỐC BỎ QUA thì đọc lại theo mtime — ăn ngay, không cần restart.)");
  if (!TRA_LOI_LAI) {
    console.log("");
    console.log("Toàn bộ tin cũ đã đánh dấu đã-xử -> bot sẽ IM cho tới khi có tin MỚI.");
    console.log("Nhắn một câu vào hội thoại để bắt đầu ca thử.");
  }
  console.log("=".repeat(72));
})().catch(e => {
  console.log("LỖI: " + ((e && e.stack) || e));
  process.exit(1);
});
