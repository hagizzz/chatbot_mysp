// ============================================================================
// order_config.js — CẤU HÌNH CHO HỆ THỐNG LÊN ĐƠN TỰ ĐỘNG (TÁCH BIỆT tư vấn)
// ----------------------------------------------------------------------------
// Toàn bộ biến cấu hình của riêng phần LÊN ĐƠN nằm ở đây. Không đụng tới
// config.js của bot tư vấn để tránh chồng chéo.
// Mọi giá trị nhạy cảm (token, api_key, shop_id) đọc từ .env.
// ============================================================================
require("dotenv").config();

module.exports = {
  // ---- PUBLIC API (pages.fm) — để ĐỌC hội thoại + ĐỔI THẺ (giống bot tư vấn) ----
  PAGE_ID: process.env.PANCAKE_PAGE_ID,
  PAGE_NAME: process.env.PANCAKE_PAGE_NAME || "Mys.P",
  // Cách 1: gán đơn cho 1 user POS -> cột "NV xác nhận". (UUID nội bộ của Nguyễn Thu)
  BOT_SELLER_ID: process.env.PANCAKE_BOT_SELLER_ID || "33aded55-4e50-4f40-9fd2-474b8b9af715",
  PAGE_TOKEN: process.env.PANCAKE_PAGE_ACCESS_TOKEN,

  // ---- POS OPEN API (pos.pages.fm) — để TẠO ĐƠN (credential RIÊNG, khác token Page) ----
  // Lấy api_key: POS -> Setting -> Advance -> Third-party connection -> Webhook/API -> API KEY -> Create
  // Lấy shop_id: gọi GET /shops, hoặc xem trên URL khi đăng nhập pos.pages.fm
  POS_BASE: "https://pos.pages.fm/api/v1",
  POS_API_KEY: process.env.PANCAKE_POS_API_KEY || "",
  POS_SHOP_ID: process.env.PANCAKE_POS_SHOP_ID || "",
  // warehouse_id (kho xuất). Để trống -> dùng kho mặc định của shop nếu POS cho phép.
  POS_WAREHOUSE_ID: process.env.PANCAKE_POS_WAREHOUSE_ID || "",

  // ---- THẺ (TAG) ----
  // "AI chốt" (đầu vào): hội thoại có thẻ này = cần lên đơn. Mặc định 182 (khớp pancake_sender.js).
  TAG_AI_CHOT: process.env.PANCAKE_TAG_AI_CHOT ? Number(process.env.PANCAKE_TAG_AI_CHOT) : 182,
  // "AI- Đã xác nhận" (đầu ra): gắn sau khi đã lên đơn THÀNH CÔNG. BẮT BUỘC khai trong .env.
  //   -> chạy `node list_tags.js` để lấy id, hoặc tạo thẻ mới trong Pancake rồi điền id vào .env.
  TAG_AI_DA_XACNHAN: process.env.PANCAKE_TAG_AI_DA_XACNHAN ? Number(process.env.PANCAKE_TAG_AI_DA_XACNHAN) : null,
  // "AI- CHỜ XL" (đầu ra phụ): khi THIẾU thông tin / không lên được đơn -> gắn để NV xử tay.
  //   Mặc định 183 (khớp pancake_sender.js: TAG_AI_CHO_XL).
  TAG_AI_CHO_XL: process.env.PANCAKE_TAG_AI_CHO_XL ? Number(process.env.PANCAKE_TAG_AI_CHO_XL) : 183,
  // "Thiếu địa chỉ": gắn khi đơn lên nhưng địa chỉ có vấn đề (không ra tỉnh / không ra phường-xã).
  TAG_THIEU_DIACHI: process.env.PANCAKE_TAG_THIEU_DIACHI ? Number(process.env.PANCAKE_TAG_THIEU_DIACHI) : 205,
  // "AI- Gửi đơn gấp": hội thoại gắn thẻ này + đơn đã xác nhận -> báo lên sheet Đơn gấp.
  TAG_GUI_GAP: process.env.PANCAKE_TAG_GUI_GAP ? Number(process.env.PANCAKE_TAG_GUI_GAP) : 206,
  // Thẻ ĐƠN "GẤP" (gắn lên đơn POS, hiện cột Thẻ). id lấy từ đơn thật.
  ORDER_TAG_GAP_ID: process.env.PANCAKE_ORDER_TAG_GAP_ID ? Number(process.env.PANCAKE_ORDER_TAG_GAP_ID) : 88,
  ORDER_TAG_GAP_NAME: process.env.PANCAKE_ORDER_TAG_GAP_NAME || "GẤP",

  // ---- QUA SHOP (thẻ 174) ----
  // Đơn ở 2 kho này (từ tháng 6/2026) -> đổ sang tab "QUA SHOP"; khách đã có đơn -> gỡ thẻ 174.
  TAG_QUA_SHOP: process.env.PANCAKE_TAG_QUA_SHOP ? Number(process.env.PANCAKE_TAG_QUA_SHOP) : 174,
  QUASHOP_WAREHOUSE_IDS: (process.env.PANCAKE_QUASHOP_WAREHOUSES ||
    "d911e5eb-c05a-49eb-8a00-4981d10c7301,4572bb41-95bc-4845-bb0f-5a4255e08822").split(",").map(s => s.trim()).filter(Boolean),
  QUASHOP_FROM_DATE: process.env.PANCAKE_QUASHOP_FROM_DATE || "2026-06-01",

  // ---- TRẠNG THÁI ĐƠN POS ----
  // 0 = ĐƠN MỚI / "chờ xác nhận" (an toàn: bot tạo đơn nháp, NV/POS rà rồi mới xác nhận đẩy ship).
  // Nếu muốn bot tạo thẳng trạng thái "đã xác nhận", đổi ENV PANCAKE_POS_ORDER_STATUS=1.
  POS_ORDER_STATUS: process.env.PANCAKE_POS_ORDER_STATUS != null ? Number(process.env.PANCAKE_POS_ORDER_STATUS) : 0,

  // Trạng thái "Đã xác nhận" (số). Bot lên đơn xong sẽ ép đơn về trạng thái này.
  // Mặc định 1. Nếu shop của bạn dùng số khác cho "Đã xác nhận", đổi ENV PANCAKE_POS_STATUS_CONFIRMED.
  POS_STATUS_CONFIRMED: process.env.PANCAKE_POS_STATUS_CONFIRMED != null ? Number(process.env.PANCAKE_POS_STATUS_CONFIRMED) : 1,

  // ---- VÒNG LẶP ----
  POLL_MS: Number(process.env.ORDER_POLL_MS || 15000),   // mỗi 15s quét 1 lần (đơn không cần nhanh như chat)
  // Nhận mọi cách viết bật: 1 / true / yes / on. Trước đây chỉ nhận "true" nên
  // env_boot.js đặt ORDER_DRY_RUN="1" cho staging mà không hề có tác dụng -> vẫn tạo đơn thật.
  DRY_RUN: ["1", "true", "yes", "on"].includes(String(process.env.ORDER_DRY_RUN || "").trim().toLowerCase()), // bật = KHÔNG gọi POS thật, chỉ in payload

  // ---- FILE DỮ LIỆU RIÊNG (TÁCH BIỆT với conversation_memory.json) ----
  ORDERS_STATE_FILE: "./orders_state.json",
  // File bộ nhớ của bot TƯ VẤN — CHỈ ĐỌC để lấy mã/size/sđt/địa chỉ đã chốt. KHÔNG bao giờ ghi.
  CONSULT_MEMORY_FILE: "./conversation_memory.json",

  // ---- SHIP (theo kịch ban §14) ----
  FREESHIP_THRESHOLD: 500000,   // tổng > 500k -> freeship; <= -> +30k
  SHIP_FEE: 30000,
};
