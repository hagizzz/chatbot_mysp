// ============================================================================
// khoa_tien_trinh.js — CHỈ CHO MỘT BOT CHẠY MỖI LẦN
// ----------------------------------------------------------------------------
// CA THẬT 26/08/2026, hội thoại Hà Giang. Khách nhắn "vậy lấy e cái màu hồng
// size M nhé", rồi nhận HAI tin gần như y hệt cách nhau 6 giây:
//
//   02:44:02  Dạ em nhận được thông tin của chị rồi ạ, chị CHO EM XIN THÊM
//             số điện thoại để em lên đơn cho mình ạ
//   02:44:08  Dạ em nhận được thông tin của chị rồi ạ, chị ƯNG Ý CHO EM XIN
//             số điện thoại để em lên đơn cho mình ạ?
//
// Nguyên nhân: HAI tiến trình bot cùng sống trong ~15 giây (khởi động lại giữa
// lúc một lượt đang chạy dở). Tiến trình cũ gửi câu 1 rồi bị giết TRƯỚC khi kịp
// ghi xuống đĩa hai cuốn sổ của nó (processed_messages.json ghi trễ 3 giây,
// bot_dup_sent.json cũng ghi trễ). Tiến trình mới đọc đĩa, không thấy dấu vết
// nào, tưởng chưa ai trả lời -> soạn lại và gửi câu 2.
//
// SỔ CHỐNG TRÙNG KHÔNG CỨU ĐƯỢC ca này: nó so chuỗi sau khi chuẩn hoá, mà hai
// câu trên là hai cách diễn đạt KHÁC NHAU của cùng một ý (AI soạn lại mỗi lần
// một khác). Không có cách nào bắt bằng cách so chữ.
//
// Nên chặn ở gốc: đừng bao giờ để hai tiến trình cùng sống.
//
// Chuyện này KHÔNG chỉ xảy ra khi lập trình viên khởi động lại. Ngoài thật,
// người của shop bấm nhầm chay_thu.bat hai lần là MỌI khách đều nhận tin đôi.
//
// Khoá cũ (tiến trình đã chết) thì tự dọn — không bao giờ chặn oan lần chạy sau
// một cú sập.
// ============================================================================
"use strict";

const __goc = require("path").join(__dirname, "..", "..");
const fs = require("fs");
const path = require("path");

const TEP = process.env.KHOA_TIEN_TRINH_FILE || path.join(__goc, "bot.lock");

// NHỊP TIM. Chỉ dựa vào PID là chưa đủ, và đã tự cắn ngay hôm đặt khoá:
//   · Hệ điều hành DÙNG LẠI số PID. Khoá cũ trỏ vào một PID mà tình cờ có tiến
//     trình khác đang mang -> khoá kẹt VĨNH VIỄN, không ai chạy bot được nữa.
//   · process.kill(pid,0) trả EPERM khi PID thuộc tiến trình của người dùng khác
//     -> ta buộc phải coi là "còn sống", lại kẹt.
// Nên chủ khoá phải TỰ ĐIỂM DANH: cứ NHIP_MS lại ghi lại mốc. Khoá quá HAN_MS
// không điểm danh = chủ đã chết, dọn được, bất kể PID nói gì.
// Khoá GIAM MẤT bot còn tệ hơn khoá không có: bot không chạy thì không khách nào
// được trả lời.
const NHIP_MS = Number(process.env.KHOA_NHIP_MS || 15000);
const HAN_MS  = Number(process.env.KHOA_HAN_MS || 60000);   // 4 nhịp hụt
let _batNhip = null;

// Tiến trình còn sống không? signal 0 không gửi gì, chỉ hỏi hệ điều hành.
//   ESRCH = không có tiến trình đó -> khoá cũ, dọn được.
//   EPERM = có tiến trình nhưng không đủ quyền hỏi -> COI LÀ CÒN SỐNG (an toàn:
//           thà không khởi động được còn hơn hai bot cùng nhắn khách).
function conSong(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e && e.code === "EPERM"; }
}

function doc() {
  try {
    const j = JSON.parse(fs.readFileSync(TEP, "utf8"));
    return (j && typeof j === "object") ? j : null;
  } catch (_) { return null; }
}

// Khoá còn hiệu lực không? Phải THOẢ CẢ HAI: PID còn sống VÀ còn điểm danh.
// Khoá đời cũ chưa có trường nhip -> coi như còn điểm danh (chỉ xét PID), để
// nâng cấp giữa chừng không làm bot đang chạy bị cướp khoá.
function conHieuLuc(cu) {
  if (!cu || !conSong(Number(cu.pid))) return false;
  if (!cu.nhip) return true;
  const t = new Date(cu.nhip).getTime();
  if (!Number.isFinite(t)) return true;
  return (Date.now() - t) <= HAN_MS;
}

// Trả về { ok, chu } — chu là chủ khoá hiện tại khi ok=false.
function giu({ ep = false, ten = "bot" } = {}) {
  const cu = doc();
  if (cu && !ep && Number(cu.pid) !== process.pid && conHieuLuc(cu)) {
    return { ok: false, chu: cu };
  }
  const moi = {
    pid: process.pid,
    ten,
    tu_luc: new Date().toISOString(),
    nhip: new Date().toISOString(),
    // Ghi lại mấy rào quan trọng để nhìn khoá là biết tiến trình kia đang chạy
    // ở chế độ nào — thật hay thử, và đang khoá vào mấy hội thoại.
    moi_truong: process.env.BOT_ENV || "that",
    chi_xu_ly: String(process.env.CHI_XU_LY_IDS || "").split(",").map(s => s.trim()).filter(Boolean).length
  };
  fs.writeFileSync(TEP, JSON.stringify(moi, null, 2), "utf8");

  // unref: nhịp tim KHÔNG được giữ tiến trình sống. Thiếu chữ này thì bot xử
  // xong hết việc vẫn không thoát được, và các script dùng chung mô-đun sẽ treo.
  if (!_batNhip) {
    _batNhip = setInterval(() => {
      try {
        const h = doc();
        if (!h || Number(h.pid) !== process.pid) return;   // đã bị cướp khoá -> thôi
        h.nhip = new Date().toISOString();
        fs.writeFileSync(TEP, JSON.stringify(h, null, 2), "utf8");
      } catch (_) {}
    }, NHIP_MS);
    if (_batNhip.unref) _batNhip.unref();
  }
  return { ok: true, chu: moi };
}

function nha() {
  if (_batNhip) { clearInterval(_batNhip); _batNhip = null; }
  const cu = doc();
  if (cu && Number(cu.pid) === process.pid) {
    try { fs.unlinkSync(TEP); } catch (_) {}
  }
}

// Dựng sẵn câu giải thích để lõi bot chỉ việc in — chỗ gọi không phải soạn lại.
function loiChan(chu) {
  const tuoi = chu && chu.tu_luc ? Math.round((Date.now() - new Date(chu.tu_luc).getTime()) / 1000) : 0;
  return [
    "",
    "  ĐÃ CÓ MỘT BOT ĐANG CHẠY -> KHÔNG khởi động thêm.",
    `     tiến trình  : PID ${chu && chu.pid}`,
    `     chạy từ     : ${chu && chu.tu_luc}${tuoi ? `  (${tuoi}s trước)` : ""}`,
    `     điểm danh   : ${(chu && chu.nhip) || "(khoá đời cũ, không có)"}`,
    `     môi trường  : ${chu && chu.moi_truong}`,
    `     CHI_XU_LY_IDS: ${chu && chu.chi_xu_ly} hội thoại`,
    "",
    "  Hai bot cùng sống = KHÁCH NHẬN TIN ĐÔI. Đo thật 26/08/2026: khách nhận",
    "  hai câu xin số điện thoại cách nhau 6 giây, chữ khác nhau nên sổ chống",
    "  trùng không bắt được.",
    "",
    "  Muốn chạy bản mới thì DỪNG bản cũ trước:",
    `     taskkill /PID ${chu && chu.pid} /F        (Windows)`,
    "",
    "  Chắc chắn tiến trình kia đã chết mà khoá vẫn còn thì:  node bot_worker_api_v3.js --ep-khoa",
    ""
  ].join("\n");
}

module.exports = { giu, nha, doc, conSong, conHieuLuc, loiChan, TEP, NHIP_MS, HAN_MS };
