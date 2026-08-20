// Tiện ích MÀU tiếng Việt: fold dấu, nhận diện màu trong câu, so màu với SP.
// Dùng cho: lên đơn theo màu, lọc mẫu theo màu khách thích, khách hỏi "có màu X không".

function foldVi(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

// canonical (hiển thị) -> các biến thể đã fold. CỤM DÀI để TRƯỚC (xanh nhat trước xanh).
const COLOR_DEFS = [
  ["Xanh navy", ["xanh navy", "navy"]],
  ["Xanh cổ vịt", ["xanh co vit", "co vit"]],
  ["Xanh rêu", ["xanh reu", "reu"]],
  ["Xanh lá", ["xanh la", "xanh la cay"]],
  ["Xanh biển", ["xanh bien"]],
  ["Xanh dương", ["xanh duong"]],
  ["Xanh mint", ["xanh mint", "mint"]],
  ["Xanh nhạt", ["xanh nhat", "xanh la nhat", "xanh duong nhat"]],
  ["Xanh đậm", ["xanh dam"]],
  ["Xanh", ["xanh", "blue", "green"]],
  ["Hồng nhạt", ["hong nhat", "hong pastel"]],
  ["Hồng đất", ["hong dat"]],
  ["Hồng", ["hong", "pink"]],
  ["Đỏ đô", ["do do", "đo", "bordeaux", "booc do", "boc do"]],
  ["Đỏ", ["do", "red", "do tuoi"]],
  ["Trắng kem", ["trang kem"]],
  ["Trắng", ["trang", "white"]],
  ["Đen", ["den", "black"]],
  ["Vàng", ["vang", "yellow", "vang bo"]],
  ["Nâu", ["nau", "brown", "nau tay"]],
  ["Tím", ["tim", "purple", "tim than"]],
  ["Cam", ["cam", "orange"]],
  ["Xám", ["xam", "ghi", "gray", "grey"]],
  ["Rêu", ["reu"]],
  ["Đất", ["dat", "mau dat"]],
  ["Bạc", ["bac", "silver"]],
  ["Be", ["be", "beige", "nude"]],
  ["Kem", ["kem", "cream"]],
];

// Khớp 1 biến thể màu trong câu (đã fold), theo ranh giới từ (không bắt nhầm "den" trong "denim"? -> "denim" fold = "denim", \bden\b không khớp).
function _hasWord(foldedText, variant) {
  // variant có thể nhiều từ ("xanh nhat") -> escape khoảng trắng
  const v = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${v}([^a-z0-9]|$)`).test(foldedText);
}

// Trả về canonical color đầu tiên TÌM ĐƯỢC trong câu (vd "chị thích màu hồng" -> "Hồng"), hoặc null.
function extractColor(text) {
  const raw = String(text || "");
  const t = foldVi(raw);
  const low = raw.toLowerCase();
  for (const [canon, variants] of COLOR_DEFS) {
    for (const v of variants) {
      if (!_hasWord(t, v)) continue;
      // "đặt"/"đặt hàng"/"đặt mẫu" fold ra "dat" TRÙNG màu "Đất" -> chỉ nhận "Đất" khi bản gốc THẬT có chữ "đất".
      if (canon === "Đất" && !/đất/i.test(raw)) continue;
      // BIẾN THỂ NGẮN dễ trùng từ thường khi bỏ dấu -> chỉ nhận là MÀU khi câu GỐC có đúng chữ:
      //  "do"  : "đồ"(quần áo)/"đô"/"do"(=vì) KHÔNG phải Đỏ -> cần chữ "đỏ" có dấu.
      //  "den" : "đến"(tới) KHÔNG phải Đen -> cần chữ "đen".
      //  "cam" : "cảm"(cảm ơn) KHÔNG phải Cam -> cần chữ "cam" KHÔNG dấu (cảm không chứa "cam").
      if (v === "do"  && !/đỏ/i.test(raw)) continue;
      if (v === "den" && !/đen/i.test(raw)) continue;
      if (v === "cam" && !low.includes("cam")) continue;
      //  "vang": "vâng"(đồng ý)/"vắng"/"vầng" bỏ dấu ĐỀU ra "vang" -> chỉ nhận màu Vàng khi bản gốc THẬT có
      //  chữ "vàng" (dấu à). (Lỗi: "Vâng vậy mình lấy size M" -> chốt đơn ghi màu "vàng".)
      if (v === "vang" && !/vàng/i.test(raw)) continue;
      //  "trang": "trang phục/trang nhã/trang trí/trang điểm/trang sức" bỏ dấu = "trang" -> KHÔNG phải màu Trắng.
      //  Chỉ nhận màu Trắng qua alias này khi bản gốc THẬT có chữ "trắng" (dấu). (Lỗi: caption ad "trang phục" -> tưởng AD 1 màu trắng -> gửi thiếu màu.)
      if (v === "trang" && !/trắng/i.test(raw)) continue;
      return canon;
    }
  }
  return null;
}

// Câu KHÁCH có đang nói về MÀU không (để phân biệt với hỏi linh tinh).
function mentionsAnyColor(text) {
  return extractColor(text) != null;
}

// 1 chuỗi màu (vd "Hồng", "XANH NHAT", "Đỏ đô") có khớp canonical color đang hỏi không.
// dùng cho: so màu khách hỏi với màu SP (từ cột color sheet hoặc từ tên file ảnh).
function colorMatches(productColorRaw, queryCanon) {
  if (!productColorRaw || !queryCanon) return false;
  const def = COLOR_DEFS.find(d => d[0] === queryCanon);
  const variants = def ? def[1] : [foldVi(queryCanon)];
  const pc = foldVi(productColorRaw);
  // khớp nếu biến thể màu hỏi xuất hiện trong chuỗi màu SP (vd query "Xanh" -> SP "xanh nhat" KHÔNG nên khớp ngược;
  //   nhưng SP "xanh" khớp query "Xanh"). Ta khớp theo từ.
  return variants.some(v => _hasWord(pc, v) || pc === v);
}

// Tách danh sách màu của SP từ cột color (đã có cleanColors ở worker; ở đây tách thô để so khớp).
function splitColors(colorStr) {
  return String(colorStr || "")
    .split(/[,/|;\n]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

module.exports = { foldVi, extractColor, mentionsAnyColor, colorMatches, splitColors, COLOR_DEFS };
