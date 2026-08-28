// ============================================================================
// soi_cau_ai.js — BỘ SOI CÂU DO AI DIỄN ĐẠT
// ----------------------------------------------------------------------------
// Kế hoạch: docs/KE_HOACH_AI_SOAN_CAU.md (bước 2).
//
// Vì sao có tệp này: reply_guard.js chặn MỌI con số, nên câu nào có số cũng
// chết — dùng được cho "AI tự chế" nhưng không dùng được cho "AI diễn đạt", vì
// diễn đạt thì phải nói được "1m62", "45kg", "size M".
//
// Khác biệt cốt lõi: bộ soi này KHÔNG hỏi "câu có số không" mà hỏi "số trong
// câu có nằm trong PHIẾU DỮ KIỆN mà code đã chốt không". Nhờ vậy nó vừa cho
// diễn đạt tự nhiên, vừa không cho bịa — và cả hai đều kiểm được bằng máy,
// không cần người đọc từng câu.
//
// Toàn hàm THUẦN (không gọi mạng, không đọc tệp) -> test được offline.
// ============================================================================
const { chuanHoa } = require("../cau_noi/nguon_cau");

// --- RANH GIỚI CHỮ ----------------------------------------------------------
// \b của JS là ranh giới ASCII: "ị", "é", "ầ" KHÔNG phải ký tự chữ với nó. Hậu
// quả đo được ngay khi dựng tệp này: /\bk\b/ khớp chữ "k" trong "kén" (sau "k"
// là "é" -> ASCII coi là ranh giới) nên câu "không kén dáng" bị kết tội nói
// GIÁ; còn /\bchị\b/ thì không khớp "chị" bao giờ. Dùng ranh giới Unicode.
// (Cùng lớp lỗi đã được cảnh báo sẵn trong bot_worker_api_v3.js.)
const B0 = "(?<![\\p{L}\\p{N}])";
const B1 = "(?![\\p{L}\\p{N}])";
const bien = than => new RegExp(B0 + "(?:" + than + ")" + B1, "iu");

// --- CHỦ ĐỀ CẤM NÓI ---------------------------------------------------------
// Mỗi chủ đề là một thứ mà CODE (catalog/POS/kịch bản) mới có quyền phát ngôn.
// AI diễn đạt lỡ chạm vào -> chặn nguyên câu, dùng câu gốc.
const CAM_NOI = {
  gia:            new RegExp(B0 + "(giá|tiền|đồng|nghìn|ngàn|triệu|vnđ|vnd)" + B1 + "|₫|\\d\\s*k" + B1, "iu"),
  ton_kho:        /hết hàng|còn hàng|hết size|còn size|hết màu|còn màu|cháy hàng|còn \d+ (cái|chiếc|bộ)/iu,
  thoi_gian_giao: /\d+\s*(ngày|hôm|tiếng|giờ)|hôm nay|ngày mai|mai nhận|nhận được (trong|sau)|giao trong/iu,
  hoan_huy:       /hoàn tiền|hoàn hàng|hủy đơn|huỷ đơn|trả hàng|đổi trả|bảo hành/iu,
  so_sanh_shop:   /shop khác|bên kia|chỗ khác|nơi khác|hàng chợ|hàng nhái|rẻ hơn|đắt hơn/iu,
  y_te:           new RegExp(B0 + "(bầu|mang thai|thai kỳ|sau sinh|cho con bú|dị ứng|bệnh)" + B1, "iu"),
  don_tien:       /đã lên đơn|đã đặt|đã chốt|đã tạo đơn|tổng tiền|tổng đơn|chuyển khoản|số tài khoản|đặt cọc/iu,
};

// --- TRÍCH SỐ ---------------------------------------------------------------
// Bắt cả dạng dính chữ của tiếng Việt: "1m62", "45kg", "990k", và dạng có dấu
// phân cách nghìn "1.190.000". Trả về TẬP chuỗi số đã chuẩn hoá để so bằng nhau.
//
// Chuẩn hoá = bỏ mọi ký tự không phải chữ số: "1m62" -> "162". Nhờ vậy AI viết
// "1m62" hay "162" đều khớp với phiếu, không phụ thuộc cách viết.
function tachSo(text) {
  const s = String(text == null ? "" : text);
  const ra = new Set();
  for (const m of s.matchAll(/\d{1,3}(?:[.,]\d{3})+|\d+\s*[a-zA-ZÀ-ỹ]?\s*\d+|\d+/g)) {
    const chi = m[0].replace(/\D/g, "");
    if (chi) ra.add(chi);
  }
  return ra;
}

// Mọi số có mặt trong phiếu (gộp cả su_that lẫn duoc_noi) -> tập số HỢP LỆ.
function soHopLe(phieu) {
  const ra = new Set();
  const gom = v => {
    if (v == null) return;
    if (Array.isArray(v)) return v.forEach(gom);
    if (typeof v === "object") return Object.values(v).forEach(gom);
    for (const n of tachSo(v)) ra.add(n);
  };
  gom(phieu && phieu.su_that);
  gom(phieu && phieu.duoc_noi);
  return ra;
}

// --- SOI CĂN CỨ -------------------------------------------------------------
// AI phải trích một đoạn làm căn cứ. Đoạn đó phải CÓ THẬT trong nguồn (kịch bản
// đã rút + mô tả sản phẩm từ sheet). So bằng chữ trần (bỏ dấu, bỏ dấu câu) vì
// AI hay chép lại lệch dấu/hoa thường.
function canCuCoThat(canCu, nguon) {
  const c = chuanHoa(canCu);
  if (c.length < 12) return false;              // quá ngắn -> dễ đụng hàng, không tính là căn cứ
  return (nguon || []).some(n => chuanHoa(n).includes(c));
}

/**
 * Soi câu AI vừa diễn đạt.
 * @param {string} cau      câu AI trả về
 * @param {object} phieu    phiếu dữ kiện code đã lập
 * @param {object} opts     { canCu: string, nguon: string[] } — bật phép kiểm căn cứ
 * @returns {{dat: boolean, loi: Array<{ma: string, chiTiet: string}>}}
 */
function soiCau(cau, phieu = {}, opts = {}) {
  const t = String(cau == null ? "" : cau).trim();
  const loi = [];
  const keu = (ma, chiTiet) => loi.push({ ma, chiTiet });

  if (!t) { keu("CAU_RONG", "AI không trả câu nào"); return { dat: false, loi }; }

  // (4a) trần độ dài — giọng nhắn tin, không phải bài văn
  const toiDa = (phieu.giong && phieu.giong.toi_da_chu) || 45;
  const soChu = t.split(/\s+/).filter(Boolean).length;
  if (soChu > toiDa) keu("QUA_DAI", `${soChu} chữ, trần ${toiDa}`);

  // (4b) giọng: cấm "bạn"/"quý khách" (luật kịch bản), phải gọi chị/mình
  if (bien("bạn|quý khách|khách hàng").test(t)) keu("SAI_XUNG_HO", 'dùng "bạn"/"quý khách"');
  if (!bien("chị|mình").test(t)) keu("SAI_XUNG_HO", "không gọi chị/mình");

  // (4c) rác kỹ thuật lọt ra khách: link, ô biến chưa điền, thẻ
  if (/(https?:\/\/|www\.)/i.test(t)) keu("CO_LINK", "câu có đường dẫn");
  if (/[{}<>]/.test(t)) keu("CO_O_TRONG", "còn ô biến / thẻ chưa điền");

  // (3) chủ đề cấm nói
  for (const cd of (phieu.cam_noi || [])) {
    const re = CAM_NOI[cd];
    if (re && re.test(t)) keu("CAM_NOI", cd);
  }

  // (1) số lạ — số nào trong câu mà phiếu không có thì là số AI tự bịa
  const hopLe = soHopLe(phieu);
  for (const n of tachSo(t)) {
    if (!hopLe.has(n)) keu("SO_LA", n);
  }

  // (2) căn cứ — chỉ bật khi nơi gọi có đưa nguồn (đường C); đường B không cần
  if (opts.nguon) {
    if (!opts.canCu) keu("THIEU_CAN_CU", "AI không trích căn cứ");
    else if (!canCuCoThat(opts.canCu, opts.nguon)) keu("CAN_CU_BIA", String(opts.canCu).slice(0, 60));
  }

  return { dat: loi.length === 0, loi };
}

// Gọn cho log: "SO_LA(2000)+CAM_NOI(gia)" hoặc "DAT".
function tomTat(kq) {
  if (!kq || kq.dat) return "DAT";
  return kq.loi.map(l => `${l.ma}(${l.chiTiet})`).join("+");
}

module.exports = { soiCau, tomTat, tachSo, soHopLe, canCuCoThat, CAM_NOI };
