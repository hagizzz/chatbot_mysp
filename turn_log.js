// ============================================================================
// turn_log.js — LOG CÓ CẤU TRÚC CHO MỖI LƯỢT XỬ LÝ MỘT HỘI THOẠI
// ----------------------------------------------------------------------------
// Vì sao: log hiện tại là văn xuôi tiếng Việt cho người đọc, KHÔNG đếm được.
// Mục 9.4 (thống kê giá trị bot) và 9.5 (chi phí AI theo shop) của bản yêu cầu
// đều cần số. Số đó phải bắt đầu chảy TỪ BÂY GIỜ thì đến GĐ6 mới có dữ liệu lịch sử.
//
// Ghi ra: data/turnlog/YYYY-MM-DD.jsonl — mỗi lượt 1 dòng JSON.
// Ghi nối (append), không đọc lại, không giữ trong RAM -> không ảnh hưởng tốc độ.
//
// Dùng AsyncLocalStorage nên khi GĐ1 chạy song song nhiều hội thoại, mỗi lượt
// vẫn tự gom đúng số liệu của mình mà không phải truyền tham số qua 300 điểm gọi.
//
//   turnLog.run({conversationId, pageId, ...}, async () => { ...xử lý... })
//   turnLog.set({intent: "ASK_PRICE"})      // ở bất kỳ đâu bên trong
//   turnLog.ai({model, promptTokens, completionTokens, where})
//   turnLog.tag("add", 183)
//   turnLog.sent("text", "Dạ chị ơi...")
//   turnLog.handoff("ảnh không nhận diện được")
// ============================================================================
const fs = require("fs");
const path = require("path");
const { AsyncLocalStorage } = require("async_hooks");

const als = new AsyncLocalStorage();

const DIR = process.env.TURNLOG_DIR || path.join(__dirname, "data", "turnlog");
const BAT = String(process.env.TURNLOG || "on").toLowerCase() !== "off";
const SHOP_ID = process.env.SHOP_ID || "mysp";        // GĐ2 sẽ thay bằng shop thật
const ENV = process.env.BOT_ENV || "production";

// Giá gpt-4.1-mini (USD/1 triệu token) — sửa ở đây khi đổi mô hình hoặc bảng giá.
const GIA = {
  "gpt-4.1-mini": { vao: 0.40, ra: 1.60 },
  "gpt-4.1":      { vao: 2.00, ra: 8.00 },
  "gpt-4o-mini":  { vao: 0.15, ra: 0.60 }
};

let _stream = null;
let _streamNgay = "";

// Thẻ "AI- chờ xử lý" = tín hiệu bot nhường người thật (mục 9.4 cần đếm kèm LÝ DO).
const TAG_CHO_XL = Number(process.env.PANCAKE_TAG_AI_CHO_XL || 183);

// --- Bắt lý do nhường người thật mà không phải sửa hàng trăm điểm gọi -------
// Mã hiện có LUÔN in một dòng tiếng Việt giải thích ngay cạnh chỗ gắn thẻ
// ("... -> NGƯỜI THẬT", "... nhường NGƯỜI THẬT (AI-CHỜ XL)"). Ta nghe lén những
// dòng đó TRONG phạm vi một lượt, cuối lượt nếu thấy có gắn thẻ chờ-xử-lý thì
// lấy dòng gần nhất làm lý do. Không đụng vào luồng xử lý, gỡ ra lúc nào cũng được.
const RE_LY_DO = /(ngư[oờ]i th[aậ]t|CH[OỜ] XL|nh[uư][oờ]ng)/i;
const _consoleLogGoc = console.log;
console.log = function (...args) {
  try {
    const t = als.getStore();
    if (t && args.length && typeof args[0] === "string" && RE_LY_DO.test(args[0])) {
      t._lyDo = args[0].replace(/^\[[^\]]*\]\s*/, "").slice(0, 200);
    }
  } catch (_) {}
  return _consoleLogGoc.apply(console, args);
};

function ngayHomNay() {
  return new Date().toISOString().slice(0, 10);
}

function ghiDong(obj) {
  if (!BAT) return;
  try {
    const ngay = ngayHomNay();
    if (_streamNgay !== ngay) {
      if (_stream) { try { _stream.end(); } catch (_) {} }
      fs.mkdirSync(DIR, { recursive: true });
      _stream = fs.createWriteStream(path.join(DIR, ngay + ".jsonl"), { flags: "a" });
      _stream.on("error", () => { _stream = null; _streamNgay = ""; });
      _streamNgay = ngay;
    }
    if (_stream) _stream.write(JSON.stringify(obj) + "\n");
  } catch (_) { /* log hỏng không bao giờ được làm chết bot */ }
}

function hienTai() {
  return als.getStore() || null;
}

// --- Bắt đầu một lượt và chạy toàn bộ việc xử lý bên trong nó -----------------
function run(ctx, fn) {
  if (!BAT) return fn();
  const t = {
    ts: new Date().toISOString(),
    env: ENV,
    shopId: SHOP_ID,
    conversationId: String(ctx.conversationId || ""),
    pageId: String(ctx.pageId || ""),
    kenh: ctx.kenh || "",            // INBOX | COMMENT
    nguon: ctx.nguon || "",          // quang_cao | binh_luan | nhan_thang
    adId: ctx.adId || null,
    postId: ctx.postId || null,
    khachText: String(ctx.khachText || "").slice(0, 500),
    coAnh: !!ctx.coAnh,
    intent: null,
    intentNguon: null,               // regex | ai | ai_quyet
    sanPham: null,
    hanhDong: null,
    daTraLoi: false,
    guiDi: [],
    theGan: [],
    theGo: [],
    nhuongNguoiThat: null,
    ai: [],
    tokenVao: 0,
    tokenRa: 0,
    tienUSD: 0,
    loi: null,
    msBatDau: Date.now(),
    ms: 0
  };
  return als.run(t, async () => {
    try {
      return await fn();
    } catch (e) {
      t.loi = String((e && e.message) || e).slice(0, 300);
      throw e;
    } finally {
      t.ms = Date.now() - t.msBatDau;
      delete t.msBatDau;
      if (!t.nhuongNguoiThat && t.theGan.some(x => x.id === TAG_CHO_XL)) {
        t.nhuongNguoiThat = t._lyDo || "khong-ro";
      }
      delete t._lyDo;
      delete t._luot;   // túi ngữ cảnh của lượt (Set, object bộ nhớ...) — không đưa vào log
      // Lượt không làm gì (bot bỏ qua hội thoại) thì không cần ghi -> log khỏi loãng.
      if (t.daTraLoi || t.ai.length || t.theGan.length || t.theGo.length || t.nhuongNguoiThat || t.loi) {
        ghiDong(t);
      }
    }
  });
}

function set(patch) {
  const t = hienTai();
  if (t && patch) Object.assign(t, patch);
}

function ai({ model = "?", promptTokens = 0, completionTokens = 0, where = "", ms = 0, ok = true } = {}) {
  const t = hienTai();
  const g = GIA[model] || { vao: 0, ra: 0 };
  const tien = (promptTokens / 1e6) * g.vao + (completionTokens / 1e6) * g.ra;
  if (!t) {
    // Gọi AI ngoài một lượt (script chẩn đoán) -> vẫn ghi 1 dòng riêng để không mất chi phí.
    ghiDong({ ts: new Date().toISOString(), env: ENV, shopId: SHOP_ID, loai: "ai_ngoai_luot", model, where, tokenVao: promptTokens, tokenRa: completionTokens, tienUSD: +tien.toFixed(6), ok });
    return;
  }
  t.ai.push({ model, where, vao: promptTokens, ra: completionTokens, ms, ok });
  t.tokenVao += promptTokens;
  t.tokenRa += completionTokens;
  t.tienUSD = +(t.tienUSD + tien).toFixed(6);
}

function tag(kieu, tagId, lyDo) {
  const t = hienTai();
  if (!t || tagId == null) return;
  const m = { id: Number(tagId), lyDo: lyDo || undefined };
  if (kieu === "remove") t.theGo.push(m); else t.theGan.push(m);
}

function sent(kieu, noiDung) {
  const t = hienTai();
  if (!t) return;
  t.daTraLoi = true;
  t.guiDi.push({ kieu, noiDung: String(noiDung || "").slice(0, 300) });
}

function handoff(lyDo) {
  const t = hienTai();
  if (!t) return;
  t.nhuongNguoiThat = String(lyDo || "khong-ro").slice(0, 200);
}

// Trích usage từ object trả về của OpenAI SDK.
function tuOpenAI(resp, where, model, ms) {
  const u = (resp && resp.usage) || {};
  ai({
    model: (resp && resp.model) || model || "?",
    promptTokens: u.prompt_tokens || 0,
    completionTokens: u.completion_tokens || 0,
    where, ms, ok: true
  });
}

module.exports = { run, set, ai, tag, sent, handoff, tuOpenAI, hienTai, GIA, DIR };
