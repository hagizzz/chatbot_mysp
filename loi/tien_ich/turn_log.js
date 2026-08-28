const __goc = require("path").join(__dirname, "..", "..");
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
//   turnLog.nguonCau("ai_tu_do", reply, "reasoning_engine.js")   // ai soạn câu thì tự khai
// ============================================================================
const fs = require("fs");
const path = require("path");
const { AsyncLocalStorage } = require("async_hooks");
const nguonCauLib = require("../cau_noi/nguon_cau");

const als = new AsyncLocalStorage();

const DIR = process.env.TURNLOG_DIR || path.join(__goc, "data", "turnlog");
const BAT = String(process.env.TURNLOG || "on").toLowerCase() !== "off";
const SHOP_ID = process.env.SHOP_ID || "mysp";        // GĐ2 sẽ thay bằng shop thật
const ENV = process.env.BOT_ENV || "production";

// Giá gpt-4.1-mini (USD/1 triệu token) — sửa ở đây khi đổi mô hình hoặc bảng giá.
// Đơn giá USD cho MỘT TRIỆU token. Cập nhật khi nhà cung cấp đổi giá.
// "vaoDem" = giá cho token ĐƯỢC ĐỆM (cached input). Nhà cung cấp giảm mạnh phần
// prompt lặp lại, và prompt của bot lặp rất nhiều: hai khối SYS chiếm ~38% token
// vào và giống hệt nhau mọi lượt. Không khai vaoDem thì tính bằng giá thường —
// tức trở về đúng cách tính cũ, không bao giờ tính hụt tiền.
const GIA = {
  "gpt-4.1-mini": { vao: 0.40, vaoDem: 0.10, ra: 1.60 },
  "gpt-4.1":      { vao: 2.00, vaoDem: 0.50, ra: 8.00 },
  "gpt-4o-mini":  { vao: 0.15, vaoDem: 0.075, ra: 0.60 }
};

// OpenAI KHÔNG trả về đúng tên mình gửi đi: gửi "gpt-4.1-mini" thì nó đáp
// "gpt-4.1-mini-2025-04-14" (tên có gắn ngày bản). Tra bảng bằng dấu bằng là
// trượt -> mọi lượt ghi tienUSD = 0. Đây là lỗi thật đã xảy ra: token đếm đúng
// nhưng tiền mất sạch, nên mục 9.5 (chi phí AI theo shop) không có gì để chặn.
// Nay khớp theo TIỀN TỐ, lấy khoá dài nhất khớp được (để "gpt-4.1-mini-..."
// ăn vào "gpt-4.1-mini" chứ không rơi nhầm vào "gpt-4.1").
const _KHOA_GIA = Object.keys(GIA).sort((a, b) => b.length - a.length);
function traGia(model) {
  const m = String(model || "");
  for (const k of _KHOA_GIA) if (m === k || m.startsWith(k)) return GIA[k];
  return null;
}

// Model lạ (đổi nhà cung cấp, gõ nhầm tên) thì phải KÊU, đừng lặng lẽ tính 0 đồng.
const _daKeu = new Set();
function _keuModelLa(model) {
  const m = String(model || "?");
  if (_daKeu.has(m)) return;
  _daKeu.add(m);
  try {
    console.log(`[turn-log] ⚠ CHƯA CÓ ĐƠN GIÁ cho model "${m}" -> chi phí đang bị tính là 0. Thêm vào bảng GIA trong turn_log.js.`);
  } catch (_) {}
}

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
    nguonCau: null,                  // nhanh_cung | ai_tu_do | ai_quyet | luat_sheet | khong_ro
    nguonCauViTri: null,             // "tệp:dòng" đẻ ra câu (khi là nhánh cứng)
    guiDi: [],
    theGan: [],
    theGo: [],
    nhuongNguoiThat: null,
    roiLang: false,                  // [CỔNG CHẶN CUỐI] lượt CÓ tin khách mà bot không nói,
                                     // không gắn thẻ, không nhường ai — khách bị bỏ rơi lặng lẽ
    ai: [],
    tokenVao: 0,
    tokenDem: 0,       // phần token vào ĐƯỢC ĐỆM (nằm trong tokenVao, không cộng thêm)
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
      delete t._khai;   // lời khai nguồn câu — đã dùng xong lúc gửi, không cần ghi ra tệp
      // Lượt không làm gì (bot bỏ qua hội thoại) thì không cần ghi -> log khỏi loãng.
      // NGOẠI LỆ: lượt RƠI LẶNG phải ghi bằng được — đó chính là thứ cần đếm.
      if (t.daTraLoi || t.ai.length || t.theGan.length || t.theGo.length || t.nhuongNguoiThat || t.loi || t.roiLang) {
        ghiDong(t);
      }
    }
  });
}

function set(patch) {
  const t = hienTai();
  if (t && patch) Object.assign(t, patch);
}

function ai({ model = "?", promptTokens = 0, completionTokens = 0, cachedTokens = 0, where = "", ms = 0, ok = true } = {}) {
  const t = hienTai();
  let g = traGia(model);
  if (!g) { _keuModelLa(model); g = { vao: 0, ra: 0 }; }
  // Token ĐƯỢC ĐỆM tính giá riêng. Trước đây tính hết theo giá niêm yết, nên số
  // tiền trong sổ là TRẦN chứ không phải hoá đơn thật — mà 97% chi phí nằm ở
  // token vào, và ~38% token vào là hai khối prompt y hệt nhau mọi lượt (đo
  // 27/08/2026: ai_intent 8.980 + ai_quyet 2.310). Không tách ra thì không thấy
  // được phần đệm đang tiết kiệm bao nhiêu, và mọi bàn bạc về RAG đều là đoán.
  const dem = Math.min(Math.max(0, cachedTokens), promptTokens);   // đệm không thể nhiều hơn tổng
  const thuong = promptTokens - dem;
  const giaDem = (g.vaoDem === undefined || g.vaoDem === null) ? g.vao : g.vaoDem;
  const tien = (thuong / 1e6) * g.vao + (dem / 1e6) * giaDem + (completionTokens / 1e6) * g.ra;
  if (!t) {
    // Gọi AI ngoài một lượt (script chẩn đoán) -> vẫn ghi 1 dòng riêng để không mất chi phí.
    ghiDong({ ts: new Date().toISOString(), env: ENV, shopId: SHOP_ID, loai: "ai_ngoai_luot", model, where, tokenVao: promptTokens, tokenDem: dem, tokenRa: completionTokens, tienUSD: +tien.toFixed(6), ok });
    return;
  }
  t.ai.push({ model, where, vao: promptTokens, dem, ra: completionTokens, ms, ok });
  t.tokenVao += promptTokens;
  t.tokenDem = (t.tokenDem || 0) + dem;
  t.tokenRa += completionTokens;
  t.tienUSD = +(t.tienUSD + tien).toFixed(6);
}

function tag(kieu, tagId, lyDo) {
  const t = hienTai();
  if (!t || tagId == null) return;
  const m = { id: Number(tagId), lyDo: lyDo || undefined };
  if (kieu === "remove") t.theGo.push(m); else t.theGan.push(m);
}

// Ai soạn câu thì tự khai ở đây. Khai xong câu vẫn có thể bị code đè lại, nên lời
// khai chỉ là ỨNG VIÊN — lúc gửi mới đối chiếu với câu thật rồi mới tính.
function nguonCau(nguon, cauDinhNoi, viTri) {
  const t = hienTai();
  if (!t || !nguon) return;
  const norm = nguonCauLib.chuanHoa(cauDinhNoi);
  if (!norm) return;
  if (!t._khai) t._khai = [];
  t._khai.unshift({ nguon, norm, viTri: viTri || null });   // khai mới nhất xét trước
  if (t._khai.length > 8) t._khai.length = 8;
}

function sent(kieu, noiDung) {
  const t = hienTai();
  if (!t) return;
  t.daTraLoi = true;
  const chu = String(noiDung || "");
  const m = { kieu, noiDung: chu.slice(0, 300) };
  // Truy nguồn từng tin: câu này do kịch bản dạy hay do code viết cứng?
  // Bọc try vì đây là việc ĐO — hỏng thì thôi, tuyệt đối không được làm chết lượt.
  if (chu.trim()) {
    try {
      const r = nguonCauLib.truyNguon(chu, t._khai);
      m.nguon = r.nguon;
      if (r.viTri) m.viTri = r.viTri;
      if (!t.nguonCau) { t.nguonCau = r.nguon; t.nguonCauViTri = r.viTri || null; }
    } catch (_) {}
  }
  t.guiDi.push(m);
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
    // OpenAI để số token được đệm ở prompt_tokens_details.cached_tokens, và nó
    // ĐÃ NẰM TRONG prompt_tokens chứ không cộng thêm. Trước đây không ai đọc ô
    // này nên sổ luôn tính giá đầy đủ cho cả phần được giảm.
    cachedTokens: (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0,
    completionTokens: u.completion_tokens || 0,
    where, ms, ok: true
  });
}

module.exports = { run, set, ai, tag, sent, handoff, nguonCau, tuOpenAI, hienTai, GIA, DIR };
