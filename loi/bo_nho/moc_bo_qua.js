// ============================================================================
// moc_bo_qua.js — MỐC BỎ QUA TIN CŨ ("lịch sử hội thoại bắt đầu từ đây")
// ----------------------------------------------------------------------------
// VẤN ĐỀ
// Messenger KHÔNG cho xoá tin nhắn. API Meta không có endpoint xoá tin trong hội
// thoại, Pancake public_api cũng không. Nên "reset hội thoại về trắng" trên page
// thật là chuyện không làm được theo nghĩa đen.
//
// Mà mỗi lượt bot lại nạp 20 tin cuối thẳng từ Pancake vào cửa sổ của AI
// (buildConversationForAi). Dọn sạch bộ nhớ xong bot vẫn đọc thấy địa chỉ cũ,
// size cũ, giá đã báo — reset chỉ sạch một nửa.
//
// CÁCH LÀM
// Không xoá được thì che. Mỗi hội thoại có một MỐC; tin nhắn cũ hơn mốc coi như
// không tồn tại — không vào cửa sổ AI, không thành cụm tin cần trả lời, không
// tính vào dò khiếu nại hay dò địa chỉ. Đặt lại mốc = reset lịch sử.
//
// HAI TẦNG MỐC, lấy cái MUỘN HƠN:
//   · toàn cục — .env:  BO_QUA_TIN_TRUOC=2026-08-26T00:00:00Z
//         Đây là thứ shop cần khi bot lên page thật: page đang có 240 hội thoại
//         với cả năm lịch sử. Không có mốc thì ngày đầu bật bot, nó đọc hết đống
//         cũ đó và diễn lại.
//   · từng hội thoại — moc_bo_qua.json:  { "<convId>": "<ISO>" }
//         reset_hoi_thoai.js ghi vào đây. Dùng cho ca thử.
//
// Đọc lại theo mtime nên SỬA TỆP KHÔNG CẦN KHỞI ĐỘNG LẠI BOT — reset giữa lúc
// bot đang chạy vẫn ăn ngay vòng poll kế tiếp.
//
// Chạy trực tiếp để xem/sửa:
//     node moc_bo_qua.js                      liệt kê mốc đang có
//     node moc_bo_qua.js <convId> bay_gio     đặt mốc = bây giờ
//     node moc_bo_qua.js <convId> --xoa       bỏ mốc của hội thoại đó
// ============================================================================
"use strict";

const __goc = require("path").join(__dirname, "..", "..");
const fs = require("fs");
const path = require("path");

const TEP = process.env.MOC_BO_QUA_FILE || path.join(__goc, "moc_bo_qua.json");
const KHOA_TOAN_CUC = "*";

let _cache = null;
let _mtime = -1;

// Nhận ISO ("2026-08-26T00:00:00Z"), ms, hoặc "bay_gio"/"now". Không đọc được -> 0.
// Trả 0 chứ không NaN: mọi chỗ dùng đều so `if (!moc) return` nên 0 nghĩa là
// "không có mốc, giữ nguyên hành vi cũ" — hỏng cấu hình thì bot chạy như trước,
// KHÔNG phải bot mù cả hội thoại.
function docMoc(v) {
  if (v == null || v === "") return 0;
  const s = String(v).trim();
  if (/^(bay_gio|bay gio|now)$/i.test(s)) return Date.now();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n < 1e12 ? n * 1000 : n;      // giây -> ms
  }
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : 0;
}

function nap() {
  let mt = -1;
  try { mt = fs.statSync(TEP).mtimeMs; } catch (_) { mt = 0; }
  if (_cache && mt === _mtime) return _cache;
  _mtime = mt;
  _cache = {};
  if (mt) {
    try {
      const j = JSON.parse(fs.readFileSync(TEP, "utf8"));
      if (j && typeof j === "object" && !Array.isArray(j)) _cache = j;
    } catch (e) {
      // Tệp hỏng: KÊU TO rồi coi như không có mốc. Im lặng ở đây là kiểu lỗi tệ
      // nhất — bot chạy y như cũ mà người dùng đinh ninh đã reset.
      console.log(`[mốc bỏ qua] ĐỌC HỎNG ${TEP}: ${e.message} -> coi như KHÔNG có mốc nào.`);
      _cache = {};
    }
  }
  return _cache;
}

function ghi(obj) {
  fs.writeFileSync(TEP, JSON.stringify(obj, null, 2), "utf8");
  _cache = null;
  _mtime = -1;
}

// Mốc hiệu lực của một hội thoại = MUỘN HƠN giữa mốc toàn cục và mốc riêng.
// Lấy muộn hơn chứ không phải riêng-đè-toàn-cục: mốc toàn cục là hàng rào của
// shop ("đừng đọc lịch sử trước ngày bật bot"), một mốc riêng cũ hơn không được
// phép chọc thủng hàng rào đó.
function moc(conversationId) {
  const j = nap();
  const toanCuc = Math.max(docMoc(process.env.BO_QUA_TIN_TRUOC), docMoc(j[KHOA_TOAN_CUC]));
  const rieng = conversationId ? docMoc(j[String(conversationId)]) : 0;
  return Math.max(toanCuc, rieng);
}

function dat(conversationId, khi) {
  const t = docMoc(khi == null ? Date.now() : khi);
  if (!t) throw new Error(`mốc không đọc được: ${khi}`);
  const j = { ...nap() };
  j[String(conversationId)] = new Date(t).toISOString();
  ghi(j);
  return t;
}

function xoa(conversationId) {
  const j = { ...nap() };
  const k = String(conversationId);
  if (!(k in j)) return false;
  delete j[k];
  ghi(j);
  return true;
}

function tatCa() { return { ...nap() }; }

// Đọc DẤU THỜI GIAN CỦA MỘT TIN NHẮN — phải giống hệt parseTime trong lõi bot.
//
// Pancake trả giờ KHÔNG kèm múi: "2026-08-25T10:29:15.176000".
// JS coi dạng đó là GIỜ MÁY, còn parseTime của lõi bot gắn thêm "Z" và coi là
// UTC. Máy ở Việt Nam (+7) nên hai cách lệch nhau ĐÚNG 7 TIẾNG.
//
// Đo thật 26/08/2026: reset_hoi_thoai.js tự dùng new Date() nên đặt mốc thấp
// hơn tin cũ 7 tiếng. Script in "giấu 35/35 tin" mà bot vẫn đọc trọn 35 tin —
// reset trông như thành công, ca thử thì vẫn dính địa chỉ cũ. Kiểu hỏng tệ nhất:
// không lỗi, không log, số liệu còn khẳng định là xong.
//
// Ai cần so giờ tin nhắn thì gọi hàm này, đừng tự new Date(). Có test đối chiếu
// từng chữ với parseTime trong bot_worker_api_v3.js.
function gioTin(s) {
  if (s == null) return 0;
  if (typeof s === "number") return s < 1e12 ? s * 1000 : s;
  let str = String(s).trim();
  const coMui = /[zZ]$/.test(str) || /[+-]\d{2}:?\d{2}$/.test(str);
  if (!coMui && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(str)) str = str.replace(" ", "T") + "Z";
  const t = new Date(str).getTime();
  return Number.isFinite(t) ? t : 0;
}

module.exports = { moc, dat, xoa, tatCa, docMoc, gioTin, TEP, KHOA_TOAN_CUC };

// ---- Chạy trực tiếp -------------------------------------------------------
if (require.main === module) {
  const argv = process.argv.slice(2);
  const id = argv.find(a => !a.startsWith("--"));
  const khi = argv.filter(a => !a.startsWith("--"))[1];
  if (!id) {
    const j = tatCa();
    const ds = Object.entries(j);
    console.log(`tệp: ${TEP}`);
    console.log(`BO_QUA_TIN_TRUOC (.env): ${process.env.BO_QUA_TIN_TRUOC || "(không đặt)"}`);
    if (!ds.length) console.log("(chưa có mốc nào)");
    for (const [k, v] of ds) console.log(`  ${k === KHOA_TOAN_CUC ? "* (mọi hội thoại)" : k}  ->  ${v}`);
    console.log("\n  node moc_bo_qua.js <convId> bay_gio    đặt mốc = bây giờ");
    console.log("  node moc_bo_qua.js <convId> --xoa      bỏ mốc");
  } else if (argv.includes("--xoa")) {
    console.log(xoa(id) ? `Đã bỏ mốc của ${id}.` : `${id} không có mốc nào.`);
  } else {
    const t = dat(id, khi || Date.now());
    console.log(`Mốc của ${id} = ${new Date(t).toISOString()}`);
    console.log("Tin nhắn cũ hơn mốc này bot sẽ coi như không tồn tại.");
  }
}
