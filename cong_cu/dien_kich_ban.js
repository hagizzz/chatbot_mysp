// ============================================================================
// dien_kich_ban.js — DIỄN TRỌN MỘT VÒNG HỘI THOẠI RỒI IN BẢN GHI
// ----------------------------------------------------------------------------
//   node dien_kich_ban.js                        diễn hết kịch bản trong kich_ban_thu/
//   node dien_kich_ban.js kich_ban_thu/hoi_gia.json     diễn đúng 1 kịch bản
//   node dien_kich_ban.js kich_ban_thu/nghiem_thu.json   diễn một nhóm (tệp chứa nhiều kịch bản)
//   node dien_kich_ban.js --ai                   ép AI_REPLY_MODE=on
//
// Khác `chat_thu.js` ở chỗ không cần ngồi gõ: nạp sẵn lời khách, chạy, rồi
// đưa ra bản ghi để đọc/đối chiếu. Dùng để kiểm tra nhanh sau mỗi lần sửa mã.
//
// Hình dạng một kịch bản (JSON):
//   {
//     "ten": "Hỏi giá rồi chốt",
//     "nguon": { "loai": "quang_cao", "adId": "120254257724490550" },   // tuỳ chọn
//     "luot": [
//       { "khach": "váy này bao nhiêu tiền" },
//       { "anh": "https://..." },              // gửi ảnh mẫu
//       { "cho": 20 },                         // nán thêm 20 giây
//       { "khach": "...", "khongCho": true },  // gửi liền, KHÔNG đợi bot (gộp cụm)
//       { "nhanVien": "Dạ em kiểm tra giúp chị nha" },   // NHÂN VIÊN THẬT trả lời
//       { "goThe": 183 },                      // nhân viên gỡ thẻ
//       { "ganThe": 183 }                      // nhân viên gắn thẻ
//     ]
//   }
//
// "nguon" khai đường vào của khách (bỏ trống = nhắn thẳng):
//   { "loai": "quang_cao", "adId": "...", "postId": "..." }
//   { "loai": "binh_luan", "postId": "...", "caption": "lời bài viết", "anhBai": ["url"] }
//   { "loai": "nhan_thang" }
// ============================================================================
"use strict";

const __goc = require("path").join(__dirname, "..");
const fs = require("fs");
const path = require("path");

const CO_AI = process.argv.includes("--ai");
const duongDanRieng = process.argv.slice(2).find(a => !a.startsWith("--"));

const gl = require("../loi/pancake/pancake_gia_lap");
gl.dungMoiTruongThu({ batAI: CO_AI });

// ---- Nuốt log lõi bot, chỉ giữ lại vào tệp -------------------------------
const TEP_LOG = path.join(__goc, "botlog", "dien_kich_ban.log");
try { fs.mkdirSync(path.dirname(TEP_LOG), { recursive: true }); } catch (_) {}
const ghiLog = fs.createWriteStream(TEP_LOG, { flags: "a" });
const logGoc = console.log.bind(console);
console.log = (...a) => { try { ghiLog.write(a.join(" ") + "\n"); } catch (_) {} };
console.error = console.log;
const inRa = s => logGoc(s);

// ---- Hứng những gì bot gửi ------------------------------------------------
let hopThu = [];
let lanCuoi = 0;
gl.khiBotGui((loai, noiDung) => {
  lanCuoi = Date.now();
  hopThu.push({ loai, noiDung });
});

// ---- Nạp lõi bot ----------------------------------------------------------
inRa("Đang nạp lõi bot...");
require("../bot_worker_api_v3.js");

// ---- Tiện ích -------------------------------------------------------------
const nghi = ms => new Promise(r => setTimeout(r, ms));

// Đợi bot nói xong.
//   toiThieu: LUÔN chờ ngần này đã. Lượt đầu bot phải nạp 589 sản phẩm + 1118
//             map quảng cáo + gọi AI, dễ quá 10 giây — cắt sớm là kết luận oan
//             "bot im lặng" trong khi nó đang nghĩ.
//   imLang  : sau mốc tối thiểu, im ngần này thì coi như xong.
//   toiDa   : trần cứng, tránh treo.
async function doiBotNoiXong({ toiThieu = 14000, imLang = 8000, toiDa = 50000 } = {}) {
  const batDau = Date.now();
  lanCuoi = Date.now();
  while (Date.now() - batDau < toiDa) {
    await nghi(500);
    if (Date.now() - batDau < toiThieu) continue;
    if (Date.now() - lanCuoi >= imLang) return;
  }
}

function veBanGhi(luot) {
  const out = [];
  for (const m of hopThu) {
    if (m.loai === "chu") out.push("  BOT   > " + m.noiDung);
    else if (m.loai === "anh") out.push(`  BOT   > [gửi ${m.noiDung.length} ảnh]`);
    else if (m.loai === "gan_the") out.push(`          · gắn thẻ ${m.noiDung}`);
    else if (m.loai === "go_the") out.push(`          · gỡ thẻ ${m.noiDung}`);
    else if (m.loai === "ghi_chu") out.push(`          · ghi chú: ${String(m.noiDung).slice(0, 60)}`);
  }
  return out;
}

// ---- Chạy một kịch bản ----------------------------------------------------
async function dien(kb) {
  inRa("");
  inRa("══════════════════════════════════════════════════════════");
  inRa("  KỊCH BẢN: " + (kb.nhom ? "[" + kb.nhom + "] " : "") + (kb.ten || "(không tên)"));
  inRa("══════════════════════════════════════════════════════════");

  gl.hoiThoaiMoi();   // khách MỚI cho mỗi kịch bản, không thừa hưởng thẻ giữ
  // ĐƯỜNG VÀO: khách bấm quảng cáo / bình luận dưới bài / tự nhắn thẳng.
  // Khai được cái này mới thử được chuỗi suy-ra-mẫu của bot; không khai thì mọi
  // kịch bản đều là khách nhắn thẳng — cảnh DUY NHẤT bot không thể biết "váy
  // này" là váy nào, nên chấm điểm bot trên đó là chấm oan.
  if (kb.nguon) {
    const n = gl.datNguon(kb.nguon);
    if (n) inRa(`  [nguồn] ${n.loai}${n.adId ? "  adId=" + n.adId : ""}${n.postId ? "  postId=" + n.postId : ""}`);
  }
  await nghi(6000);   // để vòng poll kịp thấy hội thoại cũ đã rỗng trước khi khách mới nói

  let soLuotBotIm = 0;
  let botDaTungNoi = false;

  for (const luot of kb.luot || []) {
    if (luot.cho) { await nghi(luot.cho * 1000); continue; }

    // NHÂN VIÊN THẬT vào cuộc — dựng cảnh cho luật "gỡ thẻ + đã trả lời".
    if (luot.nhanVien) {
      inRa("  NV     > " + luot.nhanVien);
      gl.themTinNhanVien(luot.nhanVien);
      continue;
    }
    if (luot.ganThe) { inRa(`  [nhân viên gắn thẻ ${luot.ganThe}]`); gl.nhanVienGanThe(luot.ganThe); continue; }
    if (luot.goThe)  { inRa(`  [nhân viên gỡ thẻ ${luot.goThe}]`);  gl.nhanVienGoThe(luot.goThe);  continue; }

    hopThu = [];
    if (luot.anh) {
      inRa("  KHÁCH > [gửi ảnh] " + String(luot.anh).slice(0, 60));
      gl.themTinKhach(luot.khach || "", luot.anh);
    } else {
      inRa("  KHÁCH > " + luot.khach);
      gl.themTinKhach(luot.khach, null);
    }

    // { "khach": "...", "khongCho": true } -> gửi rồi ĐI TIẾP NGAY, không đợi bot.
    // Để dựng cảnh khách gõ hai tin liền nhau: cả hai rơi vào CÙNG một cụm và bot
    // gộp lại xử một lượt. Không có cờ này thì mọi tin đều thành lượt riêng, và
    // luật "một lượt nhiều ý" không đời nào chạy tới trong lúc thử.
    if (luot.khongCho) continue;

    await doiBotNoiXong();

    const banGhi = veBanGhi();
    banGhi.forEach(d => inRa(d));

    // Phân biệt cho rõ: KHÔNG trả lời mà CÓ gắn thẻ = bot cố ý nhường người
    // thật (đúng nguyên tắc "không biết thì không bịa"). Còn không nói không
    // gắn gì mới thật sự là im lặng đáng ngờ.
    const coNoi = banGhi.some(d => d.includes("BOT   >"));
    const vuaGanThe = banGhi.some(d => d.includes("gắn thẻ"));
    // Thẻ giữ đang treo (183 CHỜ XL, 184...) => bot CỐ Ý đứng ngoài cho tới khi
    // người thật gỡ thẻ. Im lúc này là đúng nguyên tắc, không phải hỏng.
    const dangCoTheGiu = gl.trangThai.the.size > 0;

    if (coNoi) botDaTungNoi = true;
    else if (vuaGanThe) inRa("  \x1b[33m(bot cố ý không trả lời — vừa giao người thật)\x1b[0m");
    else if (dangCoTheGiu) inRa("  \x1b[33m(bot đứng ngoài — hội thoại còn thẻ giữ " + [...gl.trangThai.the].join(",") + ")\x1b[0m");
    else {
      // KHÔNG tính là lỗi. Bot cố tình đợi khách ngừng gõ (DEBOUNCE_MS=2500)
      // rồi GỘP mấy tin liền nhau thành MỘT lượt — log lõi ghi rõ:
      //   Tin: text: <câu 1> | text: <câu 2>
      // Nên câu trả lời cho lượt này thường hiện ở lượt kế tiếp. Chấm từng
      // lượt là chấm oan; chỉ khi cả kịch bản bot không nói câu nào mới đáng lo.
      inRa("  \x1b[90m(chưa trả lời ngay — bot đang gộp với tin kế tiếp)\x1b[0m");
      soLuotBotIm++;
    }
  }

  inRa("");
  inRa(`  → thẻ cuối cùng: ${[...gl.trangThai.the].join(", ") || "(không có)"}`);
  if (!botDaTungNoi && !gl.trangThai.the.size) {
    inRa("  → \x1b[31mCẢ KỊCH BẢN bot không nói câu nào, cũng không gắn thẻ — ĐÁNG NGỜ\x1b[0m");
    return 1;
  }
  if (soLuotBotIm) inRa(`  \x1b[90m→ ${soLuotBotIm} lượt bot gộp/không trả lời ngay (bình thường)\x1b[0m`);
  return 0;
}

// ---- Vào việc -------------------------------------------------------------
// Lượt ĐẦU TIÊN sau khi khởi động luôn chậm: bot phải nạp bảng hàng (589 mẫu),
// map quảng cáo (1118 dòng) và gọi AI lần đầu. Nếu để kịch bản gánh lượt đó thì
// câu mở màn hay bị chấm nhầm là "bot im lặng". Đốt một lượt vô thưởng vô phạt
// cho máy nóng lên, rồi mới diễn thật.
async function lamNong() {
  inRa("Đang làm nóng (nạp bảng hàng + map quảng cáo)...");
  gl.themTinKhach("alo shop ơi", null);
  await doiBotNoiXong({ toiThieu: 20000, imLang: 8000, toiDa: 60000 });
  gl.hoiThoaiMoi();
  hopThu = [];
  await nghi(5000);   // để vòng poll thấy hội thoại đã rỗng
}

(async () => {
  // Đợi bảng hàng + kịch bản nạp xong rồi mới diễn.
  await nghi(8000);
  await lamNong();

  // Nhận: 1 tệp .json, MỘT THƯ MỤC kịch bản, hoặc không nêu gì (mặc định
  // kich_ban_thu/). Nhận cả thư mục là để dò lỗ hổng: mỗi câu hỏi một tệp
  // riêng -> mỗi câu một hội thoại riêng, nên thẻ giữ do câu này sinh ra không
  // giết mất mấy câu sau. Nhét hết vào một kịch bản thì chỉ đo được câu đầu.
  // Một tệp .json chứa MỘT kịch bản, hoặc MỘT MẢNG nhiều kịch bản, hoặc
  // { "nhom": "...", "kich_ban": [...] }. Cho phép mảng để gom 49 tệp lẻ về vài
  // tệp theo nhóm — dễ quản lý, và mỗi shop chỉ cần một tệp riêng của mình.
  function napTep(duong) {
    const j = JSON.parse(fs.readFileSync(duong, "utf8"));
    const ds = Array.isArray(j) ? j : (Array.isArray(j.kich_ban) ? j.kich_ban : [j]);
    const nhom = (!Array.isArray(j) && j.nhom) ? String(j.nhom) : "";
    return ds.filter(Boolean).map(k => nhom && !k.nhom ? Object.assign({ nhom }, k) : k);
  }
  function napThuMuc(thuMuc) {
    const tep = fs.readdirSync(thuMuc).filter(f => f.endsWith(".json")).sort();
    if (!tep.length) { inRa("Không thấy kịch bản .json nào trong " + thuMuc); process.exit(1); }
    return tep.flatMap(f => napTep(path.join(thuMuc, f)));
  }

  let danhSach = [];
  if (duongDanRieng) {
    if (!fs.existsSync(duongDanRieng)) { inRa("Không thấy: " + duongDanRieng); process.exit(1); }
    danhSach = fs.statSync(duongDanRieng).isDirectory()
      ? napThuMuc(duongDanRieng)
      : napTep(duongDanRieng);
  } else {
    const thuMuc = path.join(__goc, "kich_ban_thu");
    if (!fs.existsSync(thuMuc)) { inRa("Không thấy thư mục kich_ban_thu/"); process.exit(1); }
    danhSach = napThuMuc(thuMuc);
  }

  let tongIm = 0;
  for (const kb of danhSach) tongIm += await dien(kb);

  inRa("");
  inRa("══════════════════════════════════════════════════════════");
  inRa(`  XONG ${danhSach.length} kịch bản` + (tongIm ? ` — \x1b[31m${tongIm} kịch bản bot câm hoàn toàn\x1b[0m` : " — kịch bản nào bot cũng có phản ứng"));
  inRa("  log lõi bot đầy đủ: " + TEP_LOG);
  inRa("══════════════════════════════════════════════════════════");
  process.exit(0);
})();
