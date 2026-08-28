const __goc = require("path").join(__dirname, "..", "..");
// ============================================================================
// giam_sat.js — GIÁM SÁT: BOT CÒN SỐNG KHÔNG, CÓ ĐANG HỎNG ÂM THẦM KHÔNG
// ----------------------------------------------------------------------------
// GĐ1 yêu cầu: tự khởi động lại khi chết, cảnh báo khi bot im quá N phút hoặc tỉ lệ
// lỗi vượt ngưỡng.
//
// "Chết hẳn" thì start_bot.bat đã tự mở lại. Nguy hiểm hơn là ba kiểu hỏng ÂM THẦM,
// tiến trình vẫn sống mà khách không được trả lời:
//   1. ĐỨNG HÌNH  — vòng poll không chạy nữa (kẹt await, hết bộ nhớ, treo I/O)
//   2. IM LẶNG    — vòng poll vẫn chạy nhưng lâu rồi không trả lời ai (token hỏng,
//                   Pancake đổi API, bộ lọc sai) — nguy nhất vì log vẫn trôi bình thường
//   3. LỖI DÀY    — vẫn chạy nhưng phần lớn lượt kết thúc bằng lỗi
//
// Cách 2 tầng: tự chẩn đoán rồi TỰ THOÁT khi đứng hình (để .bat mở lại), và bắn
// cảnh báo ra ngoài (CANH_BAO_WEBHOOK) cho mọi kiểu.
// ============================================================================
const fs = require("fs");
const path = require("path");

const IM_TOI_DA_MS = Number(process.env.GIAMSAT_IM_MS || 15 * 60 * 1000);      // lâu chưa trả lời ai
const DUNG_HINH_MS = Number(process.env.GIAMSAT_DUNG_HINH_MS || 3 * 60 * 1000); // lâu chưa chạy hết một vòng poll
const TI_LE_LOI = Number(process.env.GIAMSAT_TI_LE_LOI || 0.3);                 // 30% lượt lỗi
const TOI_THIEU_DE_XET_LOI = Number(process.env.GIAMSAT_TOI_THIEU || 10);
const WEBHOOK = process.env.CANH_BAO_WEBHOOK || "";
const TU_THOAT = String(process.env.GIAMSAT_TU_THOAT || "on").toLowerCase() !== "off";
const FILE_NHIP = path.join(__goc, "data", "nhip_tim.json");

const _dem = { vongPoll: 0, luot: 0, loi: 0, traLoi: 0 };
let _vongCuoiLuc = Date.now();
let _traLoiCuoiLuc = Date.now();
let _luotKeTuTraLoi = 0;   // số lượt đã xử KỂ TỪ lần trả lời gần nhất
let _batDau = Date.now();
let _daCanhBao = {};

// --- Bot gọi vào ------------------------------------------------------------
function xongVongPoll(soHoiThoai = 0) {
  _dem.vongPoll++;
  _vongCuoiLuc = Date.now();
  _ghiNhip(soHoiThoai);
}

function xongMotLuot({ daTraLoi = false, loi = false } = {}) {
  _dem.luot++;
  _luotKeTuTraLoi++;
  if (loi) _dem.loi++;
  if (daTraLoi) { _dem.traLoi++; _traLoiCuoiLuc = Date.now(); _luotKeTuTraLoi = 0; }
}

function _ghiNhip(soHoiThoai) {
  try {
    fs.mkdirSync(path.dirname(FILE_NHIP), { recursive: true });
    fs.writeFileSync(FILE_NHIP, JSON.stringify({
      luc: new Date().toISOString(),
      pid: process.pid,
      chayTuLuc: new Date(_batDau).toISOString(),
      hoiThoaiVongNay: soHoiThoai,
      ...trangThai()
    }, null, 2), "utf8");
  } catch (_) {}
}

function trangThai() {
  return {
    vongPoll: _dem.vongPoll,
    luot: _dem.luot,
    traLoi: _dem.traLoi,
    loi: _dem.loi,
    tiLeLoi: _dem.luot ? +(_dem.loi / _dem.luot).toFixed(3) : 0,
    imBaoLauMs: Date.now() - _traLoiCuoiLuc,
    luotKeTuTraLoi: _luotKeTuTraLoi,
    vongCuoiCachDayMs: Date.now() - _vongCuoiLuc
  };
}

// --- Phần QUYẾT ĐỊNH: hàm thuần, có test riêng -----------------------------
/**
 * @returns {{muc:"on"|"canh_bao"|"nguy", loai:string|null, loi:string}}
 */
function chanDoan(tt, nguong = {}) {
  const imToiDa = nguong.imToiDaMs ?? IM_TOI_DA_MS;
  const dungHinh = nguong.dungHinhMs ?? DUNG_HINH_MS;
  const tiLe = nguong.tiLeLoi ?? TI_LE_LOI;
  const toiThieu = nguong.toiThieuDeXetLoi ?? TOI_THIEU_DE_XET_LOI;

  if (tt.vongCuoiCachDayMs > dungHinh) {
    return { muc: "nguy", loai: "dung_hinh",
      loi: `Vòng quét không chạy đã ${Math.round(tt.vongCuoiCachDayMs / 1000)}s (ngưỡng ${Math.round(dungHinh / 1000)}s) — bot đứng hình.` };
  }
  if (tt.luot >= toiThieu && tt.tiLeLoi > tiLe) {
    return { muc: "nguy", loai: "loi_day",
      loi: `${Math.round(tt.tiLeLoi * 100)}% lượt kết thúc bằng lỗi (${tt.loi}/${tt.luot}), ngưỡng ${Math.round(tiLe * 100)}%.` };
  }
  // IM LẶNG chỉ có nghĩa khi bot CÓ VIỆC mà không trả lời. Đêm không khách thì
  // im là đúng — kêu lúc đó là cảnh báo giả, mà cảnh báo giả vài lần là người ta
  // thôi đọc cảnh báo.
  if (tt.imBaoLauMs > imToiDa && (tt.luotKeTuTraLoi || 0) >= toiThieu) {
    return { muc: "canh_bao", loai: "im_lang",
      loi: `Đã ${Math.round(tt.imBaoLauMs / 60000)} phút bot không trả lời ai, dù đã xử ${tt.luotKeTuTraLoi} lượt trong khoảng đó (ngưỡng ${Math.round(imToiDa / 60000)} phút). Tiến trình vẫn sống — nghi token hỏng hoặc bộ lọc sai.` };
  }
  return { muc: "on", loai: null, loi: "" };
}

async function _banCanhBao(cd) {
  const dong = `[GIÁM SÁT/${cd.muc.toUpperCase()}] ${cd.loi}`;
  console.log(dong);
  if (!WEBHOOK) return;
  try {
    await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: dong, muc: cd.muc, loai: cd.loai, trangThai: trangThai() })
    });
  } catch (_) {}
}

function batDauCanhGac({ moiMs = 60000 } = {}) {
  const t = setInterval(async () => {
    const cd = chanDoan(trangThai());
    if (cd.muc === "on") { _daCanhBao = {}; return; }

    // Cùng một loại thì 10 phút mới nhắc lại — cảnh báo dồn dập là cảnh báo bị ngó lơ.
    const truoc = _daCanhBao[cd.loai] || 0;
    if (Date.now() - truoc > 10 * 60 * 1000) {
      _daCanhBao[cd.loai] = Date.now();
      await _banCanhBao(cd);
    }

    // ĐỨNG HÌNH thì không cứu được từ bên trong -> thoát để start_bot.bat mở lại.
    if (cd.loai === "dung_hinh" && TU_THOAT) {
      console.log("[GIÁM SÁT] Bot đứng hình -> THOÁT để được mở lại. (tắt bằng GIAMSAT_TU_THOAT=off)");
      setTimeout(() => process.exit(1), 500);
    }
  }, moiMs);
  if (t && t.unref) t.unref();
  return t;
}

module.exports = { xongVongPoll, xongMotLuot, trangThai, chanDoan, batDauCanhGac, FILE_NHIP };
