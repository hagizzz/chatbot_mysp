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
// Trả VỊ TRÍ khớp (không chỉ có/không) — mauDuyNhat cần biết đoạn nào đã bị màu
// DÀI hơn chiếm, để "xanh" nằm trong "xanh nhạt" không bị đếm thành màu thứ hai.
function _timWord(foldedText, variant) {
  // Không dùng RegExp: variant do ta tự khai (chữ thường + khoảng trắng), mà nhồi
  // nó vào nguồn regex thì phải escape — chỗ escape đó chính là nơi dễ viết sai.
  // Dò bằng indexOf rồi tự kiểm hai đầu: cùng luật ranh giới, không cần escape.
  const laChu = (c) => c !== "" && c !== undefined && /[a-z0-9]/.test(c);
  for (let from = 0; ; ) {
    const i = foldedText.indexOf(variant, from);
    if (i < 0) return null;
    const cuoi = i + variant.length;
    if (!laChu(foldedText[i - 1]) && !laChu(foldedText[cuoi])) return { dau: i, cuoi };
    from = i + 1;
  }
}
function _hasWord(foldedText, variant) { return !!_timWord(foldedText, variant); }

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
// MỌI màu được nêu trong câu, KHÔNG đếm trùng khi các cụm chồng nhau.
// COLOR_DEFS xếp cụm DÀI trước, nên "xanh nhạt" ăn trước; đến lượt "Xanh" thì
// đoạn chữ đó đã bị chiếm -> bỏ. Thiếu bước này thì "màu xanh nhạt" đếm ra HAI màu.
function _moiMauTrongCau(text) {
  const raw = String(text || "");
  const t = foldVi(raw);
  const low = raw.toLowerCase();
  const daPhu = [];
  const chongLan = (a, b) => daPhu.some(([x, y]) => a < y && x < b);
  const ra = [];
  for (const [canon, variants] of COLOR_DEFS) {
    for (const v of variants) {
      const m = _timWord(t, v);
      if (!m) continue;
      // Cùng bộ chốt chặn nhầm-dấu như extractColor — sửa một chỗ phải sửa cả hai.
      if (canon === "Đất" && !/đất/i.test(raw)) continue;
      if (v === "do"  && !/đỏ/i.test(raw)) continue;
      if (v === "den" && !/đen/i.test(raw)) continue;
      if (v === "cam" && !low.includes("cam")) continue;
      if (v === "vang" && !/vàng/i.test(raw)) continue;
      if (v === "trang" && !/trắng/i.test(raw)) continue;
      if (chongLan(m.dau, m.cuoi)) continue;   // nằm trong một màu DÀI hơn đã tính
      daPhu.push([m.dau, m.cuoi]);
      ra.push(canon);
      break;
    }
  }
  return ra;
}

// Câu nêu ĐÚNG MỘT màu -> trả màu đó; nêu 0 hoặc từ 2 màu trở lên -> null.
//
// VÌ SAO KHÔNG DÙNG extractColor: nó trả màu ĐẦU TIÊN, nên câu liệt kê
// "bên em có hồng và xanh nhạt" cũng ra một màu. Lấy cái đó làm "màu bot vừa
// hứa" thì thành ra bot hứa hai màu mà ảnh chỉ gửi một — còn tệ hơn lỗi đang
// sửa. Chỉ câu nêu duy nhất một màu mới là LỜI HỨA ràng buộc được.
function mauDuyNhat(text) {
  const ds = _moiMauTrongCau(text);
  return ds.length === 1 ? ds[0] : null;
}

function splitColors(colorStr) {
  return String(colorStr || "")
    .split(/[,/|;\n]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

module.exports = { foldVi, extractColor, mauDuyNhat, mentionsAnyColor, colorMatches, splitColors, COLOR_DEFS };
