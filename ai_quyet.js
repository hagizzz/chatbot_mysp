// ai_quyet.js
// ============================================================================
// TẦNG "AI QUYẾT ĐỊNH" (kiến trúc mới 2026-07-07) — AI làm phần HIỂU, code làm
// phần SỰ THẬT + HÀNH ĐỘNG.
//
// Mỗi lượt tin, AI nhận: hội thoại gần nhất (KHACH/SHOP), danh sách MẪU ỨNG VIÊN
// (kèm nguồn: ẢNH/AD/COMMENT/ĐÃ BÁO GIÁ + thời điểm), thông tin đã gom (sđt, địa
// chỉ, size, màu). AI trả về 1 JSON quyết định:
//   - referent  : khách ĐANG nói mẫu nào (mã trong danh sách ứng viên) / UNKNOWN
//   - mau_cu    : các mã đã là chuyện cũ, KHÔNG động vào nữa
//   - dia_chi   : { trang_thai: DU|THIEU|XAC_NHAN_TINH, thieu: [...], dia_chi_chuan }
//   - hanh_dong : TU_VAN | HOI_SIZE | HOI_MAU | XIN_SDT | XIN_DIA_CHI |
//                 XAC_NHAN_TINH | CHOT_DON | IM_NHUONG_NGUOI
//   - tin_nhan  : câu gửi khách (soạn theo PHOM bên dưới; chỗ tiền ghi {COD})
//   - don       : { ma, mau_sac, size, sdt, dia_chi } (chỉ khi CHOT_DON)
//   - do_tin_cay: 0..1
//
// NGUYÊN TẮC CỨNG (code phía worker THẨM ĐỊNH lại trước khi làm theo):
//   - AI KHÔNG được bịa mã ngoài danh sách ứng viên.
//   - AI KHÔNG được ghi số tiền — chỗ tiền ghi đúng chuỗi {COD}, code tra sheet điền.
//   - Mã phải có trong catalog; địa chỉ phải có địa danh thật; sđt đúng định dạng.
//   - AI không chắc -> hanh_dong = IM_NHUONG_NGUOI (thà nhường người còn hơn sai).
//
// Lỗi/timeout -> {ok:false} -> worker chạy luật cũ y nguyên (không phụ thuộc AI).
// ============================================================================
require("dotenv").config();
const OpenAI = require("openai");

let _client = null;
function client() {
  if (_client) return _client;
  if (!process.env.OPENAI_API_KEY) return null;
  _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

const HANH_DONG = ["TU_VAN", "HOI_SIZE", "HOI_MAU", "XIN_SDT", "XIN_DIA_CHI", "XAC_NHAN_TINH", "CHOT_DON", "IM_NHUONG_NGUOI"];

const SYS = `Bạn là trợ lý bán hàng thời trang nữ của shop (xưng "em", gọi khách là "chị"), nhiệm vụ ĐỌC HIỂU hội thoại và ra QUYẾT ĐỊNH cho lượt này. Trả về DUY NHẤT 1 JSON, không giải thích.

## VIỆC 1 — KHÁCH ĐANG NÓI MẪU NÀO (referent)
- Chỉ được chọn MÃ trong DANH SÁCH ỨNG VIÊN được cung cấp. Không bịa mã.
- Đọc theo DÒNG THỜI GIAN hội thoại: sự kiện khách chủ động GẦN NHẤT (gửi ảnh, bấm quảng cáo mới, gõ tên mẫu, trả lời câu shop vừa hỏi) có trọng số cao nhất. Quảng cáo/bài viết CŨ dính trên hội thoại từ lâu KHÔNG phải mẫu khách đang hỏi.
- Khách trả lời tiếp mạch đang tư vấn (cho số đo, chọn màu, gửi sđt...) => referent = mẫu đang tư vấn dở, KHÔNG nhảy mẫu.
- Nhân viên (SHOP) đang tư vấn tay một mẫu không rõ mã => referent="UNKNOWN" và hanh_dong="IM_NHUONG_NGUOI" (không chen).
- Không đủ căn cứ => referent="UNKNOWN".
- mau_cu = các mã chắc chắn là chuyện cũ đã qua.

## VIỆC 2 — ĐỊA CHỈ ĐỦ HAY THIẾU (dia_chi)
QUAN TRỌNG: mục "THÔNG TIN ĐÃ GOM" chỉ là sổ ghi của HỆ THỐNG và CÓ THỂ SAI/MẤT (bộ nhớ bị reset, tin bị nhân viên xử nên hệ thống không ghi). HỘI THOẠI mới là SỰ THẬT: khách đã gửi sđt/địa chỉ/đã chốt trong hội thoại mà "đã gom" bảo chưa có -> TIN HỘI THOẠI, điền lại từ hội thoại. Ngược lại đừng bịa thứ hội thoại không có. Đơn hàng có thể đã được NHÂN VIÊN tạo trên hệ thống mà hội thoại không hiển thị — thấy shop đã xác nhận ship/size và khách đã "ok" thì coi mạch đó ĐÃ XONG (mau_cu), đừng tư vấn lại từ đầu.
Địa chỉ ĐỦ GIAO khi có cả 3 tầng: (1) chi tiết: số nhà/tên đường hoặc thôn/xóm/ấp/khu; (2) xã/phường/thị trấn; (3) tỉnh/thành phố.
- TÊN TỈNH CŨ trước sáp nhập 1/7/2025 (vd "Hà Nam", "Nam Định" -> Ninh Bình; "Bắc Giang" -> Bắc Ninh; "Hải Dương" -> Hải Phòng; "Thái Bình" -> Hưng Yên; "Vĩnh Phúc" -> Phú Thọ...) VẪN TÍNH LÀ ĐỦ TỈNH — ghi dia_chi_chuan theo tỉnh MỚI, KHÔNG hỏi lại.
- Chỉ dùng XAC_NHAN_TINH khi khu vực THẬT SỰ mơ hồ (trùng nhiều tỉnh) VÀ trước đó CHƯA hỏi. Nếu hội thoại cho thấy shop ĐÃ hỏi tỉnh và khách ĐÃ trả lời (vd "Ninh Bình em") => coi là XONG, ghép tỉnh vào dia_chi_chuan, trang_thai="DU". TUYỆT ĐỐI không hỏi lại câu đã được trả lời.
- Câu hỏi của khách ("Có mấy màu", "bao nhiêu tiền"...) KHÔNG BAO GIỜ là địa chỉ.
- dia_chi_chuan: gộp mọi mảnh địa chỉ khách đã gửi (kể cả rải rác nhiều tin) thành 1 chuỗi sạch, bỏ tên người/sđt/câu chat lẫn vào.

## VIỆC 3 — LƯỢT NÀY NÊN LÀM GÌ (hanh_dong) + SOẠN TIN (tin_nhan) THEO PHOM
Chọn 1: TU_VAN | HOI_SIZE | HOI_MAU | XIN_SDT | XIN_DIA_CHI | XAC_NHAN_TINH | CHOT_DON | IM_NHUONG_NGUOI
- LUẬT THỨ TỰ BÁN HÀNG (BẮT BUỘC): khách đang HỎI GIÁ, hoặc mẫu đang nói tới CHƯA HỀ ĐƯỢC BÁO GIÁ trong hội thoại (nhìn tin SHOP: chưa có câu "giá ...đ" cho mẫu đó) => hanh_dong=TU_VAN (để hệ thống báo giá/tư vấn trước). TUYỆT ĐỐI không XIN_SDT/XIN_DIA_CHI/CHOT_DON khi khách còn chưa biết giá — xin thông tin lên đơn một mẫu khách chưa biết giá là ép khách, dễ bùng đơn. Khách gửi NHIỀU ảnh xin giá => TU_VAN (hệ thống tư vấn cả cụm).
- LUẬT HẬU MÃI (BẮT BUỘC): khách nói về ĐỔI HÀNG / HOÀN TIỀN / SỬA ĐƠN ĐÃ ĐẶT / HỦY ĐƠN / hàng LỖI / giao NHẦM / khiếu nại / đã chuyển khoản => hanh_dong=IM_NHUONG_NGUOI, tin_nhan="". Đây là việc của NHÂN VIÊN (phải đối chiếu đơn cũ trên hệ thống) — TUYỆT ĐỐI không tự xin sđt/địa chỉ, không hỏi size, không chốt đơn mới trong mạch này, kể cả khi thấy thiếu thông tin. Khách xác nhận ("Dạ đúng rồi ạ", "Ok") trong mạch đổi/hoàn cũng vậy: IM_NHUONG_NGUOI.
- TU_VAN: câu hỏi sản phẩm (giá/chất/màu/ảnh...) -> để hệ thống cũ trả lời, tin_nhan để "".
- Đủ mẫu + size + sđt + địa chỉ ĐỦ và khách đồng ý mua/đã cho contact -> CHOT_DON.
- Thiếu gì xin đúng cái đó, MỖI LƯỢT HỎI 1 THỨ, không hỏi lại thứ đã có.
- Nghi ngờ / thông tin mâu thuẫn / nhân viên đang xử lý -> IM_NHUONG_NGUOI, tin_nhan để "".

PHOM tin nhắn (giữ giọng, được đổi từ ngữ tự nhiên nhẹ, KHÔNG thêm thông tin ngoài):
- XIN_SDT: "Dạ em nhận được thông tin của chị rồi ạ, chị ưng ý cho em xin số điện thoại để em lên đơn cho mình nhe ạ?"
- XIN_DIA_CHI: "Dạ em nhận được thông tin của chị rồi ạ, chị ưng ý cho em xin địa chỉ nhận hàng (số nhà, phường/xã, tỉnh/thành) để em lên đơn cho mình nhe ạ?" (thiếu mảnh nào thì xin đúng mảnh đó)
- LUẬT ĐUÔI: câu xin thông tin/mời chốt PHẢI là CÂU HỎI mời nhẹ (kết bằng dấu "?"), TUYỆT ĐỐI không viết dạng khẳng định/ra lệnh ("...để em lên đơn cho mình ạ." là SAI — phải "...chị ưng ý ... nhe ạ?").
- XAC_NHAN_TINH: "Dạ khu vực của mình có thay đổi tên tỉnh/thành theo cập nhật hành chính mới, chị xác nhận giúp em địa chỉ đang ở TỈNH/THÀNH PHỐ nào ạ?"
- HOI_SIZE: "Dạ chị cho em xin chiều cao cân nặng để em tư vấn size chuẩn cho mình nha"
- HOI_MAU: "Dạ chị lấy màu nào ạ để em lên đơn cho mình nha" (CHỈ khi khách thật sự phân vân giữa nhiều màu; hội thoại chỉ nhắc 1 màu thì mặc định màu đó, KHÔNG hỏi)
- CHOT_DON, tin_nhan đúng khung (khách lấy NHIỀU mẫu -> MỖI mẫu 1 dòng "- Sản phẩm:", COD ghi {COD} DUY NHẤT 1 dòng):
"Cảm ơn chị đã đặt hàng
- Sản phẩm: <Tên mẫu 1> - <màu> - size <size>
- Sản phẩm: <Tên mẫu 2> - <màu> - size <size>   (chỉ khi khách lấy mẫu 2)
- COD: {COD}
- SĐT: <sđt>
- Địa chỉ: <địa chỉ đầy đủ>"
  TUYỆT ĐỐI không tự ghi số tiền, chỗ tiền ghi đúng {COD}. Khách nói "lấy 2 mẫu/cả 2/2 set" (kể cả ở tin cũ đã được nhân viên trả lời) -> đơn PHẢI đủ số mẫu đó, chọn đúng các mẫu khách đã xem/được báo giá. Kèm don.san_pham = danh sách [{ma,mau_sac,size}] + sdt + dia_chi.

## ĐẦU RA (JSON duy nhất)
{"referent":"MÃ|UNKNOWN","do_tin_cay":0.0,"mau_cu":[],"dia_chi":{"trang_thai":"DU|THIEU|XAC_NHAN_TINH|KHONG_CO","thieu":[],"dia_chi_chuan":""},"hanh_dong":"...","tin_nhan":"...","don":{"san_pham":[{"ma":"","mau_sac":"","size":""}],"sdt":"","dia_chi":""}}`;

function _s(x, n) { return String(x == null ? "" : x).replace(/\s+/g, " ").trim().slice(0, n || 300); }

function _sanitize(obj) {
  const out = { ok: true };
  out.referent = _s(obj.referent, 30).toUpperCase() || "UNKNOWN";
  out.do_tin_cay = Math.max(0, Math.min(1, Number(obj.do_tin_cay) || 0));
  out.mau_cu = Array.isArray(obj.mau_cu) ? obj.mau_cu.map(x => _s(x, 30).toUpperCase()).filter(Boolean).slice(0, 10) : [];
  const dc = obj.dia_chi || {};
  out.dia_chi = {
    trang_thai: ["DU", "THIEU", "XAC_NHAN_TINH", "KHONG_CO"].includes(String(dc.trang_thai || "").toUpperCase()) ? String(dc.trang_thai).toUpperCase() : "KHONG_CO",
    thieu: Array.isArray(dc.thieu) ? dc.thieu.map(x => _s(x, 40)).filter(Boolean).slice(0, 4) : [],
    dia_chi_chuan: _s(dc.dia_chi_chuan, 250)
  };
  out.hanh_dong = HANH_DONG.includes(String(obj.hanh_dong || "").toUpperCase()) ? String(obj.hanh_dong).toUpperCase() : "TU_VAN";
  out.tin_nhan = String(obj.tin_nhan == null ? "" : obj.tin_nhan).trim().slice(0, 600);
  const d = obj.don || {};
  // don.san_pham = MẢNG sản phẩm (đơn nhiều mẫu); tương thích ngược nếu AI trả kiểu cũ {ma,mau_sac,size}.
  let items = Array.isArray(d.san_pham) ? d.san_pham : (d.ma ? [{ ma: d.ma, mau_sac: d.mau_sac, size: d.size }] : []);
  items = items.map(it => ({
    ma: _s(it && it.ma, 30).toUpperCase(),
    mau_sac: _s(it && it.mau_sac, 40),
    size: _s(it && it.size, 12).toUpperCase()
  })).filter(it => it.ma).slice(0, 5);
  out.don = {
    san_pham: items,
    // giữ trường phẳng cho code cũ đọc (item đầu tiên)
    ma: items.length ? items[0].ma : "",
    mau_sac: items.length ? items[0].mau_sac : "",
    size: items.length ? items[0].size : "",
    sdt: _s(d.sdt, 20).replace(/[\s.\-]/g, ""),
    dia_chi: _s(d.dia_chi, 250)
  };
  return out;
}

// AI KHÔNG được ghi tiền trong tin_nhan (trừ placeholder {COD}) -> lọc phòng hờ.
function _stripMoney(text) {
  return String(text || "").replace(/\d[\d.,]{2,}\s*(đ|d|vnđ|vnd|k)\b/gi, "{COD}");
}

/**
 * AI quyết định cho lượt này.
 * @param {string} turns          Hội thoại gần nhất, mỗi dòng "KHACH: ..." / "SHOP: ...", cũ -> mới.
 * @param {string} candidatesText Danh sách ứng viên, mỗi dòng "MÃ | Tên | giá... | màu:... | size:... | nguồn=... | lúc=..."
 * @param {string} known          Thông tin đã gom: sđt/địa chỉ/size/màu/mẫu đang khoá/đơn đã chốt...
 * @param {number} timeoutMs
 */
async function quyetDinh({ turns = "", candidatesText = "", known = "", timeoutMs = 7000 } = {}) {
  const c = client();
  if (!c) return { ok: false, reason: "thieu-API-key" };
  const userPrompt =
    `## DANH SÁCH MẪU ỨNG VIÊN (chỉ được chọn trong đây)\n${candidatesText || "(trống)"}\n\n` +
    `## THÔNG TIN ĐÃ GOM\n${known || "(trống)"}\n\n` +
    `## HỘI THOẠI (cũ -> mới; dòng cuối là tin MỚI NHẤT của khách)\n${String(turns).slice(0, 3500)}\n\n` +
    `Trả JSON quyết định:`;
  try {
    const p = c.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      max_tokens: 450,
      messages: [{ role: "system", content: SYS }, { role: "user", content: userPrompt }]
    });
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs));
    const resp = await Promise.race([p, timeout]);
    let raw = String(resp.choices?.[0]?.message?.content || "").trim();
    raw = raw.replace(/^```(json)?/i, "").replace(/```$/i, "").trim();
    const i = raw.indexOf("{"), j = raw.lastIndexOf("}");
    if (i >= 0 && j > i) raw = raw.slice(i, j + 1);
    const out = _sanitize(JSON.parse(raw));
    // {COD} là placeholder duy nhất được phép mang "tiền"
    if (out.hanh_dong === "CHOT_DON") out.tin_nhan = _stripMoney(out.tin_nhan);
    else out.tin_nhan = String(out.tin_nhan || "").replace(/\{COD\}/g, "").trim();
    return out;
  } catch (e) {
    return { ok: false, reason: (e && e.message === "timeout") ? ("timeout>" + timeoutMs + "ms") : ("loi:" + ((e && e.message) || "khong-ro")) };
  }
}

module.exports = { quyetDinh, HANH_DONG };
