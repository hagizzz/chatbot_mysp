const __goc = require("path").join(__dirname, "..", "..");
// ============================================================================
// kho_kich_ban.js — MỘT CHỖ DUY NHẤT CHO MỌI LỜI BOT NÓI
// ----------------------------------------------------------------------------
// Trước đây lời bot nói nằm rải ở 7 nơi: câu viết cứng trong bot_worker (870
// câu), prompt trong reasoning_engine/ai_intent/ai_quyet, Google Doc, tab AI
// AGENT, kich_ban/luat.txt. Không ai biết sửa ở đâu thì bot đổi.
//
// Từ nay: MỌI câu đều có KHOÁ, và khoá tra ở đây.
//
//   kich_ban/mac_dinh.json     kịch bản gốc — mọi shop kế thừa
//   kich_ban/<shopId>.json     shop chỉ khai phần KHÁC với gốc
//
// Bốn tầng, tầng trên đè tầng dưới:
//   1. tab AI AGENT (Sheet)   — kinh doanh sửa nóng, không cần đè bản mới
//   2. kich_ban/<shopId>.json — riêng từng shop
//   3. kich_ban/mac_dinh.json — gốc
//   4. phom code tại chỗ gọi  — lưới đỡ cuối, KHÔNG BAO GIỜ để bot câm
//
// Hai NGĂN, quyền khác nhau:
//   · "cau"    — câu nói với khách. Shop sửa được, Sheet đè được.
//   · "prompt" — LUẬT DẠY AI. Sửa sai một dòng là bot lệch toàn bộ chứ không
//                phải sai một câu, nên shop KHÔNG đè được (loader chặn cứng),
//                Sheet cũng không. Chỉ file gốc mới đổi được.
//
// Đọc đồng bộ, nạp một lần lúc khởi động, tự soi lại mỗi 5 phút -> nhánh cứng
// đang là hàm đồng bộ vẫn gọi được, không phải đổi hàng trăm điểm gọi thành async.
// ============================================================================
const fs = require("fs");
const path = require("path");

const THU_MUC = process.env.KICH_BAN_DIR || path.join(__goc, "kich_ban");

// HAI KHÁI NIỆM KHÁC NHAU, đừng gộp:
//   SHOP_ID           — NGĂN DỮ LIỆU (dòng nào trong CSDL là của ai). Môi trường
//                       thử đặt "mysp_thu" để không lẫn với số liệu thật.
//   KICH_BAN_SHOP_ID  — SHOP NÀO về mặt kinh doanh (nói câu gì, số tài khoản nào).
//                       Bản thử và bản thật CÙNG là MYS.P, nên phải cùng kịch bản.
// Gộp hai cái làm một thì bản thử tra kich_ban/mysp_thu.json -> không có -> bot
// chạy thử từ chối gửi số tài khoản, trông y như lỗi trong khi mã hoàn toàn đúng.
const SHOP_ID = process.env.KICH_BAN_SHOP_ID || process.env.SHOP_ID || "mysp";
const SOI_LAI_MS = 5 * 60 * 1000;

// MỐC HỤT — dấu vô hình gắn vào câu khi tra kho KHÔNG RA và nơi gọi cũng không
// đưa phom code. Vì sao không trả chuỗi rỗng: câu bot hay được GHÉP từ nhiều
// khoá ("dẫn showroom" + danh sách + "mời ghé"), hụt một mảnh mà trả rỗng thì
// phần còn lại vẫn trôi tới khách dưới dạng câu cụt, không ai biết. Gắn mốc thì
// ba hàm gửi tin soi ra ngay và CHẶN — thà không nhắn còn hơn nhắn câu cụt.
// Ký tự NUL: không bao giờ có trong kịch bản thật, không hiện trên màn hình.
const MOC_HUT = "\u0000";

let _kho = null;          // { cau: {khoa: muc}, prompt: {khoa: muc} }
let _napLuc = 0;
let _daKeu = new Set();

function _keu(msg) {
  if (_daKeu.has(msg)) return;
  _daKeu.add(msg);
  try { console.log("[kho-kịch-bản] " + msg); } catch (_) {}
}

// Trả { trang, dl }. Phải phân biệt được BA trạng thái, không gộp làm hai:
//   "khong_co" — không có tệp. HỢP LỆ (shop chưa khai riêng) -> coi như rỗng.
//   "hong"     — CÓ tệp nhưng đọc/phân tích không được. KHÁC HẲN rỗng: coi nó
//                là rỗng thì mọi khoá tra hụt cùng một lúc.
//   "co"       — đọc được.
function _docTep(ten) {
  let t;
  try {
    t = fs.readFileSync(path.join(THU_MUC, ten), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return { trang: "khong_co", dl: null };
    _keu(`không đọc được ${ten}: ${e.message}`);
    return { trang: "hong", dl: null };
  }
  try {
    return { trang: "co", dl: JSON.parse(t) };
  } catch (e) {
    _keu(`hỏng tệp ${ten}: ${e.message}`);
    return { trang: "hong", dl: null };
  }
}

// Chuẩn hoá một mục: cho phép viết tắt "khoa": "câu" thay vì {cau: "..."}.
function _chuanMuc(v) {
  if (v == null) return null;
  if (typeof v === "string") return { cau: v, bien: [] };
  if (Array.isArray(v)) return { cau: v, bien: [] };
  const m = { cau: v.cau, bien: Array.isArray(v.bien) ? v.bien : [], mo_ta: v.mo_ta };
  return (m.cau == null) ? null : m;
}

function _gopNgan(dich, nguon) {
  for (const [k, v] of Object.entries(nguon || {})) {
    const m = _chuanMuc(v);
    if (m) dich[k] = m;
  }
}

function nap(epNap) {
  if (_kho && !epNap && Date.now() - _napLuc < SOI_LAI_MS) return _kho;

  const tGoc = _docTep("mac_dinh.json");
  const tRieng = _docTep(SHOP_ID + ".json");

  // GIỮ BẢN TỐT. Kho tự soi lại mỗi 5 phút, nên tệp hỏng GIỮA LÚC BOT ĐANG CHẠY
  // là chuyện sẽ xảy ra thật khi shop tự sửa kich_ban/<shop>.json và gõ thiếu
  // một dấu phẩy. Nạp đè bằng kho rỗng lúc đó = bot hụt toàn bộ khoá cùng lúc.
  // Thà chạy tiếp bằng bản nạp được gần nhất và kêu to.
  if ((tGoc.trang === "hong" || tRieng.trang === "hong") && _kho) {
    _keu("tệp kịch bản hỏng -> GIỮ bản nạp được gần nhất, bot không đổi hành vi. Sửa xong tệp là tự nạp lại.");
    _napLuc = Date.now();
    return _kho;
  }

  const goc = tGoc.dl || {};
  const rieng = tRieng.dl || {};

  const cau = {};
  _gopNgan(cau, goc.cau);
  _gopNgan(cau, rieng.cau);          // shop đè lên gốc

  // Ngăn "so_lieu": SỐ LIỆU KINH DOANH, không phải câu nói — số tài khoản, địa chỉ
  // showroom, bảng size. Trước đây nằm cứng trong bot_worker nên mỗi shop mới là
  // một nhánh code riêng. Shop ĐÈ ĐƯỢC (đây đúng là thứ riêng của từng shop),
  // nhưng Sheet thì KHÔNG: người kinh doanh gõ nhầm một chữ số tài khoản trên
  // Sheet là tiền khách chạy sang tài khoản người khác.
  // Gộp theo KHOÁ (không trộn sâu): shop khai "ngan_hang" là thay trọn cụm đó.
  // Trộn sâu sẽ đẻ ra cụm lai — nửa số tài khoản shop này, nửa shop kia.
  const soLieuKho = {};
  Object.assign(soLieuKho, goc.so_lieu || {});
  Object.assign(soLieuKho, rieng.so_lieu || {});

  // Ngăn "cai_dat": CÔNG TẮC HÀNH VI của shop — bật tắt bám khách, tách tin,
  // chế độ AI... Trước đây nằm trong .env, mà .env là của CẢ TIẾN TRÌNH: hai shop
  // chạy chung hệ thống thì không shop nào có công tắc riêng (hỏng mục 9.1 và 9.3
  // của yêu cầu). Và công tắc nằm lẫn giữa 99 dòng token/khoá API — kinh doanh
  // muốn tắt bám khách phải mở tệp chứa mật khẩu.
  //
  // Shop ĐÈ ĐƯỢC. Sheet thì KHÔNG: công tắc đổi hành vi toàn bộ bot, không phải
  // một câu chữ — gõ nhầm trên Sheet là bot đổi cách chạy mà không ai hay.
  //
  // Thứ tự ưu tiên (xem hàm caiDat): shop > gốc > .env > mặc định trong mã.
  // Để .env SAU cùng là có chủ ý: shop chưa khai gì thì mọi thứ chạy y như cũ.
  const caiDatKho = {};
  Object.assign(caiDatKho, goc.cai_dat || {});
  Object.assign(caiDatKho, rieng.cai_dat || {});

  const prompt = {};
  _gopNgan(prompt, goc.prompt);
  // CỐ Ý không gộp rieng.prompt: prompt là luật dạy AI, shop không được đè.
  if (rieng.prompt && Object.keys(rieng.prompt).length) {
    _keu(`kich_ban/${SHOP_ID}.json có khai ngăn "prompt" — BỎ QUA. ` +
         `Prompt là luật dạy AI, chỉ sửa được ở mac_dinh.json.`);
  }

  // Ngăn "giong": VĂN PHONG — cách nói, không phải nội dung nói gì.
  // Trước đây nằm cứng trong bot_worker (maybeDropDa bỏ "Dạ" mỗi câu thứ 2,
  // throttleHearts xoay vòng emoji mỗi 3 tin). Nghĩa là mọi shop dùng chung một
  // giọng, muốn khô khan hơn hay ngọt hơn đều phải sửa mã — hỏng hẳn chuyện bán
  // cho shop thứ hai.
  //
  // Shop ĐÈ ĐƯỢC, và đây là ngăn shop NÊN đụng nhất: nó không thể làm sai sự
  // thật. Đổi giọng cùng lắm là câu nghe lạ tai, không bao giờ ra sai giá hay
  // sai địa chỉ — khác hẳn "so_lieu" (sai là tiền chạy nhầm tài khoản) và
  // "cai_dat" (sai là đổi cách chạy mà không ai hay).
  //
  // Gộp NÔNG theo khoá, giống cai_dat: shop khai "emoji" là thay trọn cụm đó.
  // Trộn sâu sẽ đẻ ra cụm lai — shop tắt emoji mà vẫn dính bộ icon của gốc.
  const giongKho = {};
  Object.assign(giongKho, goc.giong || {});
  Object.assign(giongKho, rieng.giong || {});

  _kho = { cau, prompt, so_lieu: soLieuKho , caiDat: caiDatKho, giong: giongKho };
  _napLuc = Date.now();
  return _kho;
}

// Số liệu mà shop KHÔNG khai thì bot không được tự bịa cũng không được mượn của
// shop khác. Danh sách này để kiemTra() kêu lúc phát hành, và để biết cái gì là
// bắt buộc khi mở shop mới.
const SO_LIEU_BAT_BUOC = [
  "ngan_hang",           // số tài khoản nhận tiền
  "showroom",            // địa chỉ cơ sở
  "dia_chi_doi_hang",    // nơi khách gửi hàng đổi về
  "bang_size_3_vong",    // số đo 3 vòng -> size
  "bang_can_nang_size",  // cân nặng -> size
];

/**
 * Lấy SỐ LIỆU kinh doanh của shop (không phải câu nói).
 * @param {string} khoa       khoá trong ngăn "so_lieu"
 * @param {*} [phomCode]      giá trị dự phòng khi kho chưa có khoá
 *
 * Không có khoá và cũng không đưa phom -> trả null và KÊU. Nơi gọi phải tự xử
 * (nhường người thật), tuyệt đối đừng để null trôi vào câu nói với khách.
 */
function soLieu(khoa, phomCode) {
  try {
    const v = nap().so_lieu[khoa];
    if (v !== undefined && v !== null) return v;
  } catch (e) {
    _keu(`lỗi khi tra số liệu "${khoa}": ${e.message}`);
  }
  if (phomCode === undefined) { _keu(`chưa có số liệu "${khoa}" -> trả null, nơi gọi phải nhường người thật`); return null; }
  _keu(`chưa có số liệu "${khoa}" -> dùng phom code`);
  return phomCode;
}

// --- Render: "Dạ {ten} giá {gia}" + {ten, gia} -> câu hoàn chỉnh -------------
// "{{" là dấu { thật.
//
// QUAN TRỌNG — phân biệt hai chuyện dễ lẫn:
//   · Nơi gọi KHÔNG truyền ô đó         -> kho và code lệch nhau -> BÁO LỖI,
//     rơi về phom code. Không bao giờ gửi khách câu còn nguyên "{gia}".
//   · Nơi gọi CÓ truyền, giá trị rỗng   -> HỢP LỆ. Mã này đầy biến rỗng có chủ
//     ý (tên mẫu chưa biết, đuôi câu tuỳ ngữ cảnh). Chuỗi mẫu `${x}` của JS cho
//     ra "" thì ở đây cũng phải cho ra "" — nếu coi rỗng là thiếu thì mọi câu
//     kiểu đó rơi hết về phom, tệ hơn nữa là bot câm.
// Nói gọn: bám ĐÚNG ngữ nghĩa chuỗi mẫu của JS để việc rút không đổi hành vi.
const RE_O = /\{\{|\}\}|\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
function render(mau, bien, khongKiemThieu) {
  if (typeof mau !== "string") return null;
  let thieu = null;
  const ra = mau.replace(RE_O, (khop, ten) => {
    if (khop === "{{") return "{";
    if (khop === "}}") return "}";
    if (!khongKiemThieu && !(bien && Object.prototype.hasOwnProperty.call(bien, ten))) {
      thieu = thieu || ten;
      return "";
    }
    const v = bien[ten];
    return (v === undefined || v === null) ? "" : String(v);
  });
  if (thieu) return { loi: "nơi gọi không truyền ô {" + thieu + "}" };
  return ra;
}

// --- Lớp đè từ Sheet ---------------------------------------------------------
// Nạp lười để tránh vòng require (knowledge_loader/turn_log kéo theo nguon_cau).
let _sheet = null;
let _soi = null;
function _cauSheet(khoa) {
  try {
    if (_sheet === null) _sheet = require("../ai/knowledge_loader");
    const map = _sheet.luatMapDaCo && _sheet.luatMapDaCo();
    if (!map) return null;
    const dong = map[String(khoa).toLowerCase()];
    const c = dong && String(dong.vd || "").trim();
    if (!c) return null;

    // RANH GIỚI "code lo số / kịch bản lo lời" — áp cả cho câu gõ tay trong Sheet.
    // Người kinh doanh gõ một cái giá vào ô câu mẫu thì tháng sau giá đổi mà bot
    // vẫn đọc giá cũ cho khách. Tiền/sđt/tồn kho phải để code tra.
    if (_soi === null) _soi = require("../ai/reply_guard").vetAdvisoryReply;
    const vet = _soi(c);
    if (!vet.allow) {
      _keu(`câu Sheet của "${khoa}" dính ${vet.reasons.join(",")} -> BỎ, dùng kịch bản gốc. ` +
           `Đừng gõ tiền/số điện thoại/tồn kho vào Sheet.`);
      return null;
    }
    return c;
  } catch (_) { return null; }
}

// --- Cửa chính ---------------------------------------------------------------
/**
 * Lấy câu nói với khách.
 * @param {string} khoa      khoá trong ngăn "cau"
 * @param {object} [bien]    giá trị chèn vào {…}
 * @param {string} [phomCode] câu viết cứng cũ — lưới đỡ cuối cùng
 *
 * KHÔNG có phomCode mà tra hụt -> trả câu gắn MỐC HỤT, KHÔNG trả chuỗi rỗng.
 * Chuỗi rỗng là thứ trôi lọt: nó ghép vào câu khác thành câu cụt rồi tới khách.
 * Mốc thì ba hàm gửi tin soi ra và chặn, kèm đúng tên khoá bị hụt.
 */
function cau(khoa, bien, phomCode) {
  const duPhong = phomCode === undefined ? (MOC_HUT + khoa + MOC_HUT) : String(phomCode);
  try {
    const kho = nap();
    const muc = kho.cau[khoa];

    // Tầng 1: Sheet đè (chỉ với câu KHÔNG có biến — Sheet không biết truyền biến)
    if (muc && (!muc.bien || !muc.bien.length)) {
      const s = _cauSheet(khoa);
      if (s) {
        const r = render(s, bien);
        if (typeof r === "string") {
          try { require("../tien_ich/turn_log").nguonCau("luat_sheet", r, "AI AGENT:" + khoa); } catch (_) {}
          return r;
        }
      }
    }

    const _loi = phomCode === undefined ? "CHẶN không cho gửi (không có phom code)" : "dùng phom code";
    if (!muc) { _keu(`chưa có khoá "${khoa}" trong kho -> ${_loi}`); return duPhong; }

    const mau = Array.isArray(muc.cau) ? muc.cau[0] : muc.cau;
    const r = render(mau, bien);
    if (typeof r !== "string") {
      _keu(`khoá "${khoa}": ${r && r.loi} -> ${_loi}`);
      return duPhong;
    }
    // KHAI NGUỒN cho bộ đo: câu này đến từ kho kịch bản, kèm luôn KHOÁ. Chính
    // xác hơn dò vân chữ, và cho ra bảng "khoá nào được dùng nhiều nhất" —
    // đúng thứ trang quản trị cần để xếp thứ tự màn hình.
    try { require("../tien_ich/turn_log").nguonCau("kich_ban", r, "kịch bản:" + khoa); } catch (_) {}
    return r;
  } catch (e) {
    _keu(`lỗi khi tra "${khoa}": ${e.message} -> dùng phom code`);
    return duPhong;
  }
}

/** Câu có nhiều biến thể để xoay vòng cho đỡ nhàm. Trả về MẢNG. */
function cacCau(khoa, bien, phomArr) {
  const duPhong = Array.isArray(phomArr) ? phomArr
                : phomArr ? [String(phomArr)]
                : [MOC_HUT + khoa + MOC_HUT];   // hụt thì cũng phải KÊU, không trả mảng rỗng
  try {
    const muc = nap().cau[khoa];
    if (!muc) { _keu(`chưa có khoá "${khoa}" trong kho -> dùng phom code`); return duPhong; }
    const ds = Array.isArray(muc.cau) ? muc.cau : [muc.cau];
    const ra = [];
    for (const m of ds) {
      const r = render(m, bien);
      if (typeof r === "string") ra.push(r);
    }
    if (!ra.length) { _keu(`khoá "${khoa}": không render được biến thể nào -> phom code`); return duPhong; }
    return ra;
  } catch (_) { return duPhong; }
}

/**
 * Đọc một CÔNG TẮC HÀNH VI. Thứ tự: kich_ban/<shopId>.json > mac_dinh.json > .env > mặc định.
 * Đọc LIVE từ kho (kho tự soi lại mỗi 5 phút) -> shop sửa tệp là ăn, không cần khởi động lại bot.
 * @param {string} ten      tên công tắc, VD "BAM_KHACH"
 * @param {*} macDinh       giá trị khi không nơi nào khai
 */
function caiDat(ten, macDinh) {
  try {
    const kho = nap();
    if (kho.caiDat && Object.prototype.hasOwnProperty.call(kho.caiDat, ten)) return kho.caiDat[ten];
  } catch (_) {}
  const v = process.env[ten];
  return (v === undefined || v === "") ? macDinh : v;
}

/**
 * Lấy một nét GIỌNG của shop (văn phong, không phải nội dung).
 * Thứ tự: shop > gốc > mặc định gọi ở nơi dùng.
 * KHÔNG đọc .env như caiDat: giọng là thứ của SHOP, mà .env là của cả tiến
 * trình — hai shop chạy chung một tiến trình thì .env không tách được ai với ai.
 * @param {string} ten     khoá trong ngăn "giong" (vd "mo_dau_da", "emoji")
 * @param {*} [macDinh]    trả về khi kho chưa khai — phải là HÀNH VI CŨ,
 *                         để shop chưa khai gì thì bot chạy y như trước.
 */
function giong(ten, macDinh) {
  try {
    const kho = nap();
    if (kho.giong && Object.prototype.hasOwnProperty.call(kho.giong, ten)) {
      const v = kho.giong[ten];
      if (v !== null && v !== undefined && v !== "") return v;
    }
  } catch (_) {}
  return macDinh;
}

/** Công tắc dạng bật/tắt. Nhận cả boolean trong JSON lẫn chuỗi trong .env. */
function caiDatBat(ten, macDinh) {
  const v = caiDat(ten, macDinh);
  if (typeof v === "boolean") return v;
  return !["off", "0", "false", "no", "tat", "khong"].includes(String(v).trim().toLowerCase());
}

/** Công tắc dạng SỐ DƯƠNG. Giá trị rác -> rơi về mặc định, không trả 0 hay NaN. */
function caiDatSo(ten, macDinh) {
  const n = Number(caiDat(ten, macDinh));
  return (Number.isFinite(n) && n > 0) ? n : macDinh;
}

/** Lấy khối prompt (luật dạy AI). Shop KHÔNG đè được khoá này. */
function prompt(khoa, phomCode) {
  const duPhong = phomCode === undefined ? "" : String(phomCode);
  try {
    const muc = nap().prompt[khoa];
    if (!muc) { _keu(`chưa có prompt "${khoa}" trong kho -> dùng phom code`); return duPhong; }
    const mau = Array.isArray(muc.cau) ? muc.cau.join("\n") : muc.cau;
    return typeof mau === "string" ? mau : duPhong;
  } catch (_) { return duPhong; }
}

/**
 * Soi kho trước khi phát hành. Trả { loi: [], canh_bao: [] }.
 * Chạy được offline, dùng trong test và trong quy trình đè bản mới.
 */
function kiemTra() {
  const loi = [], canhBao = [];
  const tGoc = _docTep("mac_dinh.json");
  if (tGoc.trang !== "co") {
    loi.push(tGoc.trang === "hong" ? "kich_ban/mac_dinh.json hỏng, không đọc được"
                                   : "thiếu kich_ban/mac_dinh.json");
    return { loi, canh_bao: canhBao };
  }
  const goc = tGoc.dl || {};

  const kho = nap(true);
  for (const [khoa, muc] of Object.entries(kho.cau)) {
    const ds = Array.isArray(muc.cau) ? muc.cau : [muc.cau];
    if (!ds.length || ds.some(x => typeof x !== "string" || !x.trim())) {
      loi.push(`khoá "${khoa}": câu rỗng hoặc không phải chuỗi`);
      continue;
    }
    // Mọi ô {…} trong câu phải được khai ở "bien", và ngược lại.
    const trongCau = new Set();
    for (const m of ds) {
      let k; const re = new RegExp(RE_O.source, "g");
      while ((k = re.exec(m))) if (k[1]) trongCau.add(k[1]);
    }
    const khai = new Set(muc.bien || []);
    for (const b of trongCau) if (!khai.has(b)) loi.push(`khoá "${khoa}": câu dùng {${b}} nhưng không khai trong "bien"`);
    for (const b of khai) if (!trongCau.has(b)) canhBao.push(`khoá "${khoa}": khai biến "${b}" nhưng câu không dùng`);
  }

  // Shop khai khoá lạ (gõ sai tên) -> câu đó không bao giờ tới được khách.
  const tRieng = _docTep(SHOP_ID + ".json");
  if (tRieng.trang === "hong") loi.push(`kich_ban/${SHOP_ID}.json hỏng, không đọc được`);
  const rieng = tRieng.dl;
  if (rieng && rieng.cau) {
    const gocCau = (goc.cau || {});
    for (const k of Object.keys(rieng.cau)) {
      if (!(k in gocCau)) canhBao.push(`kich_ban/${SHOP_ID}.json khai khoá "${k}" không có trong mac_dinh.json`);
    }
  }

  // Số liệu bắt buộc: thiếu là bot mượn số của shop khác (phom code trong mã vẫn
  // là của MYS.P). Đây là kiểu hỏng KHÔNG có dấu hiệu — bot vẫn nhắn trơn tru,
  // chỉ là nhắn số tài khoản/địa chỉ/bảng size của người khác.
  for (const k of SO_LIEU_BAT_BUOC) {
    if (!(k in kho.so_lieu)) {
      canhBao.push(`thiếu số liệu "${k}" — khai trong kich_ban/${SHOP_ID}.json, ` +
                   `không khai thì bot dùng số liệu MYS.P viết cứng trong mã`);
    }
  }
  return { loi, canh_bao: canhBao };
}

function napLai() { _daKeu = new Set(); return nap(true); }

/**
 * CHỐT CUỐI TRƯỚC KHI GỬI KHÁCH. Mọi hàm gửi tin phải qua đây.
 *
 * Test ở CI đã chặn việc mã gọi khoá không có trong kho. Nhưng CI không có mặt
 * lúc 11 giờ đêm khi shop tự sửa kich_ban/<shop>.json trên máy thật — nên phải
 * có lưới lúc chạy. Trả { ok, ma, khoa }:
 *   ma = "KICH_BAN_HUT"  câu có mảnh tra hụt kho  -> tên khoá nằm trong .khoa
 *   ma = "CAU_RONG"      câu rỗng/toàn khoảng trắng
 */
function vetTruocKhiGui(text) {
  const s = String(text == null ? "" : text);
  if (s.includes(MOC_HUT)) {
    const khoa = [];
    const re = new RegExp(MOC_HUT + "([^" + MOC_HUT + "]*)" + MOC_HUT, "g");
    let m;
    while ((m = re.exec(s))) khoa.push(m[1]);
    return { ok: false, ma: "KICH_BAN_HUT", khoa };
  }
  if (!s.trim()) return { ok: false, ma: "CAU_RONG", khoa: [] };
  return { ok: true, ma: "", khoa: [] };
}

module.exports = {
  cau, cacCau, prompt, soLieu, caiDat, caiDatBat, caiDatSo, giong, kiemTra, napLai, render, nap,
  vetTruocKhiGui, MOC_HUT, THU_MUC, SHOP_ID, SO_LIEU_BAT_BUOC
};
