// ============================================================================
// adapter_hoa.js — LỚP NỐI SANG HỆ THỐNG QUẢN TRỊ HỘI THOẠI (bạn Hoà)
// ----------------------------------------------------------------------------
// Mục 8 của bản yêu cầu. Hợp đồng API CHƯA chốt, nên file này tồn tại để bên bot
// KHÔNG PHẢI CHỜ: mọi tính năng GĐ4 (bán tự động) và GĐ6 (đối soát chuyển khoản)
// gọi qua đây, chạy được ngay bằng dữ liệu giả.
//
//   HOA_API_MODE=gia_lap   (mặc định) ghi ra data/hoa_gia_lap.jsonl, trả kết quả giả hợp lệ
//   HOA_API_MODE=that      gọi thật, cần HOA_API_URL + HOA_API_TOKEN
//
// Chốt xong hợp đồng: sửa DUY NHẤT phần _goiThat() bên dưới. Mọi nơi gọi giữ nguyên.
// Dự thảo hợp đồng: docs/HOP_DONG_API_HOA.md
// ============================================================================
const fs = require("fs");
const path = require("path");

const MODE = String(process.env.HOA_API_MODE || "gia_lap").toLowerCase();
const URL_GOC = String(process.env.HOA_API_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.HOA_API_TOKEN || "";
const SHOP_ID = process.env.SHOP_ID || "mysp";
const FILE_GIA_LAP = path.join(__dirname, "data", "hoa_gia_lap.jsonl");

let _dem = 0;

function _ghiGiaLap(duong, than, ketQua) {
  try {
    fs.mkdirSync(path.dirname(FILE_GIA_LAP), { recursive: true });
    fs.appendFileSync(FILE_GIA_LAP,
      JSON.stringify({ ts: new Date().toISOString(), duong, than, ketQua }) + "\n", "utf8");
  } catch (_) {}
}

async function _goiThat(duong, than) {
  if (!URL_GOC) return { ok: false, ly_do: "CHUA_CAU_HINH_HOA_API_URL" };
  const res = await fetch(URL_GOC + duong, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: JSON.stringify(than)
  });
  return await res.json().catch(() => ({ ok: false, ly_do: "BAD_JSON" }));
}

async function _goi(duong, than, ketQuaGia) {
  const day = { shop_id: SHOP_ID, ...than };
  if (MODE === "that") {
    try { return await _goiThat(duong, day); }
    catch (e) { return { ok: false, ly_do: String(e.message).slice(0, 120) }; }
  }
  const gia = { ok: true, gia_lap: true, ...ketQuaGia };
  _ghiGiaLap(duong, day, gia);
  return gia;
}

// --- 1. Gửi tin -------------------------------------------------------------
function guiTin({ conversationId, kieu = "text", noiDung = "", anh = [], idempotencyKey }) {
  return _goi("/api/v1/messages", {
    conversation_id: conversationId, kieu, noi_dung: noiDung, anh,
    idempotency_key: idempotencyKey || `${conversationId}:${++_dem}`
  }, { message_id: "gia_" + (++_dem), trung_lap: false });
}

// --- 2. Thẻ -----------------------------------------------------------------
function datThe({ conversationId, tagId, hanhDong = "add", lyDo = "" }) {
  return _goi("/api/v1/tags", {
    conversation_id: conversationId, tag_id: tagId, hanh_dong: hanhDong, ly_do: lyDo
  }, {});
}

// --- 3. Gợi ý bán tự động (mục 10) — BOT KHÔNG BAO GIỜ TỰ GỬI ---------------
function dayGoiY({ conversationId, goiY = [], nhanYDinh = null, sanPham = null }) {
  const ds = goiY.slice(0, 3).map(g => ({
    noi_dung: String(g.noiDung || g.noi_dung || ""),
    ly_do: String(g.lyDo || g.ly_do || ""),
    do_tin_cay: Number(g.doTinCay ?? g.do_tin_cay ?? 0)
  }));
  return _goi("/api/v1/suggestions", {
    conversation_id: conversationId, goi_y: ds, nhan_y_dinh: nhanYDinh, san_pham: sanPham
  }, { suggestion_id: "gy_" + (++_dem) });
}

// --- 5. Sự kiện chốt đơn ----------------------------------------------------
function baoChotDon({ conversationId, orderId, sanPham = [], sdt, diaChi, cod, nguon = "bot" }) {
  return _goi("/api/v1/orders/closed", {
    conversation_id: conversationId, order_id: orderId, san_pham: sanPham,
    sdt, dia_chi: diaChi, cod, nguon
  }, {});
}

// --- 4. Đối soát chuyển khoản (mục 7) — bot CHỈ ĐỌC kết quả -----------------
// Bảng quyết định. Bot KHÔNG tự tra ngân hàng, KHÔNG tự quyết ca không chắc.
const CHO_TOI_DA_MS = Number(process.env.HOA_CK_CHO_TOI_DA_MS || 15 * 60 * 1000);

function quyetDinhChuyenKhoan(ketQua, daChoMs = 0) {
  const tt = String((ketQua && ketQua.trang_thai) || "").toLowerCase();
  if (tt === "khop_du") {
    return { hanhDong: "XAC_NHAN", nguoiThat: false, ghiChu: "khớp chắc chắn và đủ tiền" };
  }
  if (tt === "chua_thay") {
    if (daChoMs >= CHO_TOI_DA_MS) {
      return { hanhDong: "GIAO_NGUOI_THAT", nguoiThat: true, ghiChu: `chờ quá ${Math.round(CHO_TOI_DA_MS / 60000)} phút vẫn chưa thấy tiền` };
    }
    return { hanhDong: "BAO_KHACH_CHO", nguoiThat: false, ghiChu: "chưa thấy tiền, hẹn kiểm lại" };
  }
  // thiếu / thừa / không khớp / trạng thái lạ -> KHÔNG đoán.
  return { hanhDong: "GIAO_NGUOI_THAT", nguoiThat: true, ghiChu: `trạng thái "${tt || "không rõ"}" — bot không tự quyết` };
}

module.exports = {
  guiTin, datThe, dayGoiY, baoChotDon, quyetDinhChuyenKhoan,
  MODE, CHO_TOI_DA_MS, FILE_GIA_LAP
};
