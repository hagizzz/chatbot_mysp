// ============================================================================
// test/che_du_lieu.js — CHE DỮ LIỆU KHÁCH TRƯỚC KHI ĐƯA VÀO BỘ CA VÀNG
// ----------------------------------------------------------------------------
// Ca vàng là tin nhắn khách THẬT, nằm trong git, chép sang máy khác, đưa cho lập
// trình viên mới. Hai thứ phải che:
//
//   1. SỐ ĐIỆN THOẠI trong nội dung tin -> thay bằng 0900000000.
//      Che kiểu GIỮ HÌNH DẠNG (vẫn là số di động hợp lệ) nên nhãn PROVIDE_PHONE
//      vẫn dò ra đúng, test phát lại vẫn còn giá trị.
//
//   2. conversationId = "{pageId}_{psid}". psid định danh một người dùng Facebook
//      cụ thể -> chỉ giữ pageId + 8 ký tự băm: "1468690110033030_#3f9a1c22".
//      Bảng tra ngược ghi ra test/ca_vang/tra_cuu_conv.local.json — file này
//      .gitignore, chỉ nằm trên máy shop, để còn mở lại đúng hội thoại mà soi.
// ============================================================================
const crypto = require("crypto");

const SDT_GIA = "0900000000";
const SO_GIA = "000000";

function che(s) {
  return String(s || "")
    .replace(/(?:\+?84|0)(?:\d[\s.\-]?){8,10}\d/g, SDT_GIA)
    .replace(/\b\d{6,}\b/g, m => (m === SDT_GIA ? m : SO_GIA));
}

function cheConvId(id, bangTra) {
  const s = String(id || "");
  const i = s.indexOf("_");
  if (i < 0) return s;
  const pageId = s.slice(0, i), psid = s.slice(i + 1);
  const bam = "#" + crypto.createHash("sha256").update(psid).digest("hex").slice(0, 8);
  const raGon = pageId + "_" + bam;
  if (bangTra) bangTra[raGon] = s;
  return raGon;
}

// Kiểm riêng tư: chỉ soi NỘI DUNG TIN (conversationId đã băm nên không tính).
function conSoThat(cacTin) {
  const ra = [];
  for (const t of cacTin) {
    for (const m of String(t || "").match(/\b0(3|5|7|8|9)\d{8}\b/g) || []) {
      if (m !== SDT_GIA) ra.push(m);
    }
  }
  return ra;
}

module.exports = { che, cheConvId, conSoThat, SDT_GIA, SO_GIA };
