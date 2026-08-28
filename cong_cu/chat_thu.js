// ============================================================================
// chat_thu.js — NGỒI CHAT THẲNG VỚI BOT, KHÔNG ĐỤNG KHÁCH THẬT
// ----------------------------------------------------------------------------
//   node chat_thu.js              chat bình thường (màn hình sạch)
//   node chat_thu.js --chi-tiet   hiện luôn log lõi bot (soi lỗi)
//   node chat_thu.js --ai         bật AI_REPLY_MODE=on cho lượt thử này
//
// Bot chạy ĐÚNG mã thật: vẫn poll 4 giây, vẫn hiểu ý 3 tầng, vẫn chọn ảnh,
// vẫn chốt đơn, vẫn gắn thẻ. Chỉ khác: đầu dây bên kia là hội thoại trong RAM
// chứ không phải Pancake. Xem `pancake_gia_lap.js`.
//
// Lệnh trong lúc chat:
//   /anh <url>    gửi ảnh (thử nhận diện mẫu)
//   /the          xem bot đã gắn thẻ nào
//   /su           xem lại toàn bộ hội thoại
//   /moi          xoá sạch, bắt đầu hội thoại mới
//   /thoat        thoát
// ============================================================================
"use strict";

const __goc = require("path").join(__dirname, "..");
const path = require("path");
const fs = require("fs");
const readline = require("readline");

const CHI_TIET = process.argv.includes("--chi-tiet");
const BAT_AI = process.argv.includes("--ai");

// ---------------------------------------------------------------------------
// 0) PHẢI CÓ BÀN PHÍM THẬT
// ----------------------------------------------------------------------------
// Đây là chương trình gõ tay. Chạy qua đường ống / chạy nền / chạy bằng `!` của
// Claude Code thì stdin KHÔNG phải terminal: đọc được EOF ngay, readline đóng
// liền, và ta ngồi chờ 40 giây nạp lõi để rồi chẳng gõ được gì.
// Chặn ngay từ đây, báo cho rõ, còn hơn để người dùng tưởng chương trình hỏng.
// ---------------------------------------------------------------------------
// Cửa thoát cho máy: bộ lái tự động (kiểm thử) bơm lệnh qua đường ống nên
// cũng không có TTY. Đặt CHAT_THU_KHONG_CAN_TTY=1 để bỏ qua chốt này.
if (!process.stdin.isTTY && process.env.CHAT_THU_KHONG_CAN_TTY !== "1") {
  console.error("\x1b[31m[chat_thu] stdin không phải bàn phím -> không chat được.\x1b[0m");
  console.error("");
  console.error("  Mở CỬA SỔ TERMINAL THẬT (Windows Terminal / PowerShell / cmd), rồi:");
  console.error("      cd C:\\Users\\Admin\\Documents\\chatbot");
  console.error("      npm run chat-thu");
  console.error("");
  console.error("  Chạy bằng `!` trong Claude Code hoặc qua đường ống thì KHÔNG dùng được.");
  console.error("  Muốn thử tự động, không cần gõ, thì dùng:");
  console.error("      npm run dien-kich-ban");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1) ÉP MÔI TRƯỜNG TRƯỚC KHI NẠP BẤT CỨ THỨ GÌ
//    dotenv không ghi đè biến đã có -> đặt ở đây là .env thua, mình thắng.
//    Khoá OpenAI + Google vẫn để .env nạp bình thường (cần AI thật, kịch bản thật).
// ---------------------------------------------------------------------------
const gl = require("../loi/pancake/pancake_gia_lap");
gl.dungMoiTruongThu({ batAI: BAT_AI });

// ---------------------------------------------------------------------------
// 2) GOM LOG CỦA LÕI BOT — luôn ghi ra tệp, chỉ hiện lên màn hình khi --chi-tiet
// ---------------------------------------------------------------------------
const TEP_LOG = path.join(__goc, "botlog", "chat_thu.log");
try { fs.mkdirSync(path.dirname(TEP_LOG), { recursive: true }); } catch (_) {}
const ghiLog = fs.createWriteStream(TEP_LOG, { flags: "a" });
ghiLog.write(`\n\n===== phiên mới ${new Date().toISOString()} =====\n`);

const logGoc = console.log.bind(console);
const errGoc = console.error.bind(console);
function chuyenLog(...a) {
  const dong = a.map(x => (typeof x === "string" ? x : require("util").inspect(x, { depth: 3 }))).join(" ");
  try { ghiLog.write(dong + "\n"); } catch (_) {}
  if (CHI_TIET) logGoc("\x1b[90m" + dong + "\x1b[0m");
}
console.log = chuyenLog;
console.error = chuyenLog;

// ---------------------------------------------------------------------------
// 3) IN RA MÀN HÌNH
// ---------------------------------------------------------------------------
let rl = null;
function in_(dong) {
  if (rl) { readline.cursorTo(process.stdout, 0); readline.clearLine(process.stdout, 0); }
  process.stdout.write(dong + "\n");
  if (rl) rl.prompt(true);
}
const mau = {
  bot: s => "\x1b[36m" + s + "\x1b[0m",
  he: s => "\x1b[33m" + s + "\x1b[0m",
  mo: s => "\x1b[90m" + s + "\x1b[0m",
  do_: s => "\x1b[31m" + s + "\x1b[0m",
};

let dangLamNong = true;   // bật từ đầu, tắt khi khung chat mở

// Bot gửi gì thì hiện nấy.
gl.khiBotGui((loai, noiDung) => {
  if (dangLamNong) return;   // lượt làm nóng: nuốt hết, đừng làm rối màn hình
  if (loai === "chu") in_(mau.bot("BOT   > ") + noiDung);
  else if (loai === "anh") in_(mau.bot("BOT   > ") + mau.mo(`[gửi ${noiDung.length} ảnh]`));
  else if (loai === "gan_the") in_(mau.mo(`        · gắn thẻ ${noiDung}`));
  else if (loai === "go_the") in_(mau.mo(`        · gỡ thẻ ${noiDung}`));
  else if (loai === "ghi_chu") in_(mau.mo(`        · ghi chú: ${String(noiDung).slice(0, 70)}`));
});

// ---------------------------------------------------------------------------
// 4) NẠP LÕI BOT — từ đây nó tự chạy vòng poll 4 giây
// ---------------------------------------------------------------------------
in_(mau.he("Đang nạp lõi bot (bảng hàng + kịch bản)... chờ chút."));
try {
  require("../bot_worker_api_v3.js");
} catch (e) {
  errGoc(mau.do_("Nạp lõi bot HỎNG: " + (e && e.message)));
  errGoc(mau.mo("Log đầy đủ: " + TEP_LOG));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 5) KHUNG CHAT
// ---------------------------------------------------------------------------
// Lượt ĐẦU sau khi khởi động luôn chậm: bot phải nạp bảng hàng (589 mẫu) +
// map quảng cáo (1118 dòng) + gọi AI lần đầu, dễ quá 30 giây. Để người dùng
// gánh lượt đó thì câu mở màn như rơi vào hư không, tưởng bot hỏng.
// Đốt sẵn một lượt vô thưởng vô phạt, KHÔNG hiện lên màn hình, rồi mới mở khung chat.
in_(mau.he("Đang làm nóng (nạp bảng hàng + map quảng cáo)... khoảng 40 giây."));
gl.themTinKhach("alo shop ơi", null);

setTimeout(() => {
  gl.hoiThoaiMoi();   // vứt lượt làm nóng, bắt đầu bằng khách sạch
  // KHÔNG tắt `dangLamNong` theo đồng hồ: lượt làm nóng có thể trả lời muộn hơn
  // 40 giây và câu trả lời thừa đó sẽ nhảy lên màn hình. Chỉ mở tiếng khi
  // NGƯỜI DÙNG gõ câu đầu — lúc ấy mọi thứ còn sót lại đều là của lượt cũ.

  in_("");
  in_(mau.he("══════════════════════════════════════════════════════════"));
  in_(mau.he("  CHAT THỬ — không đụng khách thật, không tạo đơn thật"));
  in_(mau.he("══════════════════════════════════════════════════════════"));
  in_(mau.mo(`  hội thoại giả : ${gl.CONV_ID}`));
  in_(mau.mo(`  AI_REPLY_MODE : ${process.env.AI_REPLY_MODE || "(theo .env)"}${BAT_AI ? "  (ép bật bằng --ai)" : ""}`));
  in_(mau.mo(`  log đầy đủ    : ${TEP_LOG}`));
  in_(mau.mo("  lệnh: /anh <url>  /the  /su  /moi  /thoat"));
  in_(mau.mo("  bot poll 4 giây/lần -> gõ xong đợi vài giây."));
  in_("");

  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt("\x1b[32mKHÁCH > \x1b[0m");
  rl.prompt();

  rl.on("line", line => {
    const s = line.trim();
    if (!s) { rl.prompt(); return; }

    if (s === "/thoat") { daDong = true; in_(mau.he("Tạm biệt.")); process.exit(0); }

    if (s === "/moi") {
      const idMoi = gl.hoiThoaiMoi();
      in_(mau.he("Khách MỚI. Bot không nhớ gì về lượt trước. ") + mau.mo(idMoi));
      rl.prompt(); return;
    }

    if (s === "/the") {
      const t = [...gl.trangThai.the];
      in_(mau.he("Thẻ đang gắn: ") + (t.length ? t.join(", ") : mau.mo("(chưa có)")));
      rl.prompt(); return;
    }

    if (s === "/su") {
      in_(mau.he("--- toàn bộ hội thoại ---"));
      for (const m of gl.trangThai.tinNhan) {
        const laShop = String(m.from.id) === gl.PAGE_ID_GIA;
        const anh = (m.attachments || []).length ? " [có ảnh]" : "";
        in_((laShop ? mau.bot("  BOT   > ") : mau.he("  KHÁCH > ")) + (m.message || "") + mau.mo(anh));
      }
      in_(mau.he("--- hết ---"));
      rl.prompt(); return;
    }

    if (s.startsWith("/anh ")) {
      const url = s.slice(5).trim();
      if (!/^https?:\/\//i.test(url)) {
        in_(mau.do_("URL ảnh phải bắt đầu bằng http(s)://"));
      } else {
        dangLamNong = false;
        gl.themTinKhach("", url);
        in_(mau.mo("        · đã gửi ảnh, chờ bot nhận diện..."));
      }
      rl.prompt(); return;
    }

    if (s.startsWith("/")) { in_(mau.do_("Lệnh lạ. Có: /anh /the /su /moi /thoat")); rl.prompt(); return; }

    dangLamNong = false;
    gl.themTinKhach(s, null);
    rl.prompt();
  });

  rl.on("close", () => { daDong = true; in_(mau.he("Tạm biệt.")); process.exit(0); });
}, 40000);

process.on("unhandledRejection", e => {
  const m = String((e && e.message) || e);
  if (/\[GIẢ LẬP\]/.test(m)) in_(mau.do_("  ⚠ " + m));
  else chuyenLog("unhandledRejection: " + m);
});
