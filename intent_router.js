// intent_router.js — LỚP NHẬN DIỆN Ý ĐỊNH (L1) cho bot Muse Wear.
// Triết lý (đã thống nhất trong QUY_TRINH_HYBRID.md):
//   1. CHẮC mới nhận. Mơ hồ -> KHONG_RO -> nhường (AI/người thật). KHÔNG đoán bừa.
//   2. Soi CẢ CỤM, không bắt theo 1 từ rời. Một từ đơn -> điểm thấp -> không đủ nhận.
//   3. Xử TỪNG câu trong cụm (khách nhắn 2-3 tin -> duyệt từng tin, không chỉ tin cuối).
//   4. Module này CHỈ HIỂU (nhả nhãn + độ chắc + bằng chứng). KHÔNG viết câu, KHÔNG đụng tiền.

const NGUONG_CHAC = 0.6;   // điểm < ngưỡng -> coi như KHONG_RO

// Bỏ dấu, đ->d, gộp khoảng trắng. Giữ chữ thường để soi cụm.
function fold(s = "") {
  return String(s).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ").trim();
}

// Tách cụm khách thành TỪNG tin. input: string hoặc mảng tin. Tách thêm theo xuống dòng.
function splitMessages(input) {
  const arr = Array.isArray(input) ? input : [input];
  const out = [];
  for (const m of arr) {
    const raw = String(m || "").trim();
    if (!raw) continue;
    raw.split(/[\n\r]+/).map(s => s.trim()).filter(Boolean).forEach(s => out.push(s));
  }
  return out;
}

const has = (t, re) => re.test(t);
const cnt = (t, res) => res.reduce((n, re) => n + (re.test(t) ? 1 : 0), 0);

// ===== TÍN HIỆU DÙNG CHUNG (soi cả cụm) =====
const SIG = {
  // câu hỏi chất liệu/vải — kể cả gõ sai "chấy gi", "chất j", "vai j"
  material: /(chat lieu|chat vai|\bchat gi\b|\bchat j\b|\bcha[ty] gi\b|\bchay gi\b|vai gi|vai j|vai nhu (the )?nao|lam bang gi|chat the nao)/,
  // câu hỏi ĐỘ CO GIÃN (cột S) — bỏ dấu nên "co giãn"/"co gian"/"co dãn" gộp chung
  //  \b cuối CHỐNG khớp nhầm: "co dang" (có đang giảm) chứa "co dan" -> không có biên -> KHÔNG nhận là co giãn.
  stretch: /\b(co gian|co dan|do co gian|gian khong|dan khong|gian ko|dan ko|co gian khong|co dan khong)\b/,
  // ship / giao hàng / miễn phí ship
  ship: /(mien ship|free ship|freeship|phi ship|tien ship|\bship\b|giao hang|van chuyen|bao lau (nhan|den|co)|may ngay (nhan|den|co)|ship bao nhieu|co ship)/,
  // tổng tiền / bill
  total: /(tong bill|tinh bill|chot bill|tong tien|tong (la )?bao nhieu|tong (het )?bao nhieu|het tat ca|tat ca (la )?bao nhieu|cong (lai|het) (la )?bao nhieu|tong bao tien|het bao nhieu tien)/,
  // giá 1 mẫu
  price: /(gia bao nhieu|bao nhieu (tien|1|mot)|\bgia\b|may tien|bn tien|xin gia|cho (c|chi|e|em|minh) gia|gia mau)/,
  // size: từ size + ngữ cảnh
  sizeWord: /\b(size|sz|s|m|l|xl|xxl|freesize|free size|fs)\b/,
  sizeCtx: /(size nao|size gi|co size|con size|size bao nhieu|mac size|lay size|len don size|so do|cao .* nang|nang .* cao|\d{2,3}\s*kg|bao nhieu kg|mac (co )?vua|vua khong|vua ko|fit khong)/,
  color: /(mau gi|mau nao|co may mau|nhung mau|mau sac|bao nhieu mau|con mau|co mau nao)/,
  stock: /(con hang|con khong|con ko|con size|het hang|con mau|con khong em|con hang khong)/,
  discount: /(giam gia|\bsale\b|khuyen mai|uu dai|co giam|bot gia|mua \d+ (co )?giam)/,
  returnPol: /(doi hang|tra hang|hoan hang|doi tra|bao hanh|loi (thi )?doi|khong vua (co )?doi)/,
  storeAddr: /(shop o dau|dia chi shop|cua hang o dau|showroom|co so o dau|den shop|qua shop|mua truc tiep)/,
  payment: /(chuyen khoan|\bstk\b|so tai khoan|chuyen tien truoc|cong thanh toan|qr|momo)/,
  // chốt đơn / đặt
  order: /(\bchot\b|chot don|chot luon|len don|dat hang|dat mua|lay mau nay|mua mau nay|lay cho (chi|minh)|chi lay|minh lay|\border\b)/,
  // thêm mẫu vào đơn đang có
  addMore: /(len don them|dat them|lay them|mua them|them \d+ mau|\d+ mau nay nua|lay ca \d+|mau nay nua)/,
  // khách báo sẽ gửi địa chỉ mới / không ở địa chỉ cũ
  newAddrLater: /((doi|cho).{0,12}(gui|cho|nhan).{0,10}dia chi moi|gui dia chi moi|dia chi moi\b|(khong|ko|hong) (con )?(o |tai )?(dia chi |dc )?cu|doi dia chi|chuyen nha)/,
  greeting: /^(chao|hello|hi|helo|alo|ad oi|em oi|shop oi|c oi|e oi|ban oi)\b/,
  thanks: /\b(cam on|cam o n|thanks|thank you|tks|ok e|oke e|ok em)\b/,
};

// nhận diện địa chỉ thật (số nhà + từ khoá đường/phường...) — cả cụm
function looksLikeAddress(t) {
  const hasNum = /\d{1,4}/.test(t);
  const hasStreet = /(so nha|ngo |ngach|hem |duong |pho |phuong |\bxa\b|quan |huyen |\btinh\b|tp |thanh pho|chung cu|toa |thon |\bap\b|to \d|khu |thi tran|thi xa)/.test(t);
  return hasNum && hasStreet;
}
// sđt: chuỗi số dài 9-11 sau khi bỏ ký tự ngăn
function looksLikePhone(t) {
  const digits = (t.match(/(?:\+?84|0)[\s.\-]?(?:\d[\s.\-]?){8,10}\d/g) || []);
  return digits.length > 0;
}
// size "trần" (chỉ M / size L) không kèm câu hỏi -> khách ĐANG CUNG CẤP size
function bareSizeProvide(t) {
  if (!/^(\s*(size|sz)\s*)?(xs|s|m|l|xl|xxl|xxxl|freesize|free size|fs)\s*$/.test(t)) return false;
  return true;
}

// ===== BẢNG NHÃN: mỗi nhãn chấm điểm 0..1 theo SỐ tín hiệu (cả cụm), có chống tham lam =====
// Trả về [{intent, score, evidence}]
function scoreAll(text) {
  const t = fold(text);
  const out = [];
  const push = (intent, score, evidence) => { if (score > 0) out.push({ intent, score: Math.min(1, score), evidence }); };

  // --- nhãn CỤ THỂ (ưu tiên, đặt trước nhánh tham lam) ---
  if (has(t, SIG.stretch))  push("HOI_CO_GIAN", 0.93, "hỏi độ co giãn (cột S)");
  if (has(t, SIG.material)) push("HOI_CHAT_LIEU", 0.92, "tín hiệu chất liệu/vải");
  if (has(t, SIG.ship))     push("HOI_SHIP", 0.9, "tín hiệu ship/giao hàng");
  if (has(t, SIG.total))    push("HOI_TONG_TIEN", 0.92, "tín hiệu tổng tiền/bill");
  if (has(t, SIG.color))    push("HOI_MAU", 0.85, "hỏi màu (cụ thể)");
  if (has(t, SIG.stock))    push("HOI_TON_KHO", 0.82, "hỏi còn hàng");
  if (has(t, SIG.discount)) push("HOI_GIAM_GIA", 0.85, "hỏi giảm giá");
  if (has(t, SIG.returnPol))push("HOI_DOI_TRA", 0.85, "hỏi đổi/trả");
  if (has(t, SIG.storeAddr))push("HOI_DIA_CHI_SHOP", 0.85, "hỏi địa chỉ shop");
  if (has(t, SIG.payment))  push("HOI_THANH_TOAN", 0.82, "hỏi chuyển khoản/STK");
  if (has(t, SIG.newAddrLater) && !/\d/.test(t)) push("DIA_CHI_SE_GUI_SAU", 0.85, "báo gửi địa chỉ mới/không ở cũ");

  // --- cung cấp dữ liệu ---
  if (looksLikePhone(t)) push("CUNG_CAP_SDT", 0.88, "có chuỗi sđt");
  if (looksLikeAddress(t)) push("CUNG_CAP_DIA_CHI", 0.8, "có số nhà + từ khoá đường/phường");
  if (bareSizeProvide(t)) push("CUNG_CAP_SIZE", 0.8, "size trần (đang cung cấp)");

  // --- GIÁ 1 mẫu (không tính nếu là TỔNG TIỀN) ---
  if (has(t, SIG.price) && !has(t, SIG.total)) push("HOI_GIA", 0.8, "hỏi giá 1 mẫu");

  // --- SIZE (THAM LAM): chỉ nhận khi có TỪ size + NGỮ CẢNH size, và KHÔNG phải hỏi chất liệu/màu ---
  if (has(t, SIG.sizeWord) && has(t, SIG.sizeCtx) && !has(t, SIG.material) && !has(t, SIG.color)) {
    push("HOI_SIZE", 0.82, "size + ngữ cảnh size");
  } else if (has(t, SIG.sizeCtx) && !has(t, SIG.material)) {
    push("HOI_SIZE", 0.7, "ngữ cảnh tư vấn size (cao/nặng/vừa)");
  } else if (has(t, SIG.sizeWord) && !has(t, SIG.sizeCtx)) {
    // CHỈ có chữ "size"/"M"/"L" lạc, không ngữ cảnh -> điểm THẤP, không đủ tự nhận (chống chộp nhầm "chất gì")
    push("HOI_SIZE", 0.35, "chỉ có từ size lẻ (yếu)");
  }

  // --- THÊM MẪU / CHỐT ĐƠN ---
  if (has(t, SIG.addMore)) push("THEM_MAU_VAO_DON", 0.85, "lên đơn thêm/đặt thêm mẫu");
  if (has(t, SIG.order) && !has(t, SIG.addMore)) push("CHOT_DON", 0.8, "chốt/lên đơn/lấy mẫu");

  // --- xã giao ---
  if (has(t, SIG.greeting)) push("CHAO_HOI", 0.9, "chào hỏi đầu câu");
  if (has(t, SIG.thanks))   push("CAM_ON", 0.85, "cảm ơn");

  return out.sort((a, b) => b.score - a.score);
}

// Phân loại 1 tin -> nhãn chắc nhất, hoặc KHONG_RO nếu dưới ngưỡng / có 2 nhãn mạnh ngang nhau (mâu thuẫn).
function routeOne(text) {
  const ranked = scoreAll(text);
  if (!ranked.length) return { text, intent: "KHONG_RO", confidence: 0, evidence: "không khớp tín hiệu nào", candidates: [] };
  const top = ranked[0];
  // Chống chộp nhầm đã do CHẤM ĐIỂM lo (từ lẻ -> điểm thấp; nhánh tham lam cần đủ tín hiệu).
  // Ở đây chỉ cần GÁC NGƯỠNG: chắc thì nhận, dưới ngưỡng -> nhường.
  if (top.score < NGUONG_CHAC) {
    return { text, intent: "KHONG_RO", confidence: top.score, evidence: `dưới ngưỡng (${top.evidence})`, candidates: ranked.slice(0, 3) };
  }
  return { text, intent: top.intent, confidence: top.score, evidence: top.evidence, candidates: ranked.slice(0, 3) };
}

// Phân loại CẢ CỤM: trả về MẢNG (1 kết quả / tin) -> bot xử TỪNG tin, không chỉ tin cuối.
function routeBatch(input) {
  return splitMessages(input).map(routeOne);
}

module.exports = { routeBatch, routeOne, scoreAll, splitMessages, fold, NGUONG_CHAC };

// ===== SELF-TEST: chạy `node intent_router.js` =====
if (require.main === module) {
  const cases = [
    // [tin, nhãn mong đợi]
    ["Mireva chất gì", "HOI_CHAT_LIEU"],
    ["Mireva chấy gi", "HOI_CHAT_LIEU"],     // gõ sai
    ["váy này vải gì v", "HOI_CHAT_LIEU"],
    ["có co giãn ko", "HOI_CO_GIAN"],         // đủ dấu
    ["có co gian ko", "HOI_CO_GIAN"],         // THIẾU dấu (ca lỗi thật)
    ["co dãn không em", "HOI_CO_GIAN"],
    ["chất này có co giãn ko", "HOI_CO_GIAN"], // có cả "chất" nhưng hỏi co giãn -> ưu tiên co giãn
    ["Có miễn ship không em", "HOI_SHIP"],
    ["Miễn ship không em", "HOI_SHIP"],
    ["Tổng bill lại cho chị", "HOI_TONG_TIEN"],
    ["tính bill cho mình", "HOI_TONG_TIEN"],
    ["Lên đơn thêm 2 mẫu này", "THEM_MAU_VAO_DON"],
    ["lên đơn size M", "HOI_SIZE"],          // có size + ngữ cảnh
    ["chị thường mặc size nào", "HOI_SIZE"],
    ["M", "CUNG_CAP_SIZE"],                   // size trần
    ["0828696329", "CUNG_CAP_SDT"],
    ["Số 1 huỳnh thúc kháng phường bắc giang tỉnh bắc ninh", "CUNG_CAP_DIA_CHI"],
    ["đợi mình gửi địa chỉ mới", "DIA_CHI_SE_GUI_SAU"],
    ["mẫu này bao nhiêu tiền", "HOI_GIA"],
    ["có mấy màu vậy em", "HOI_MAU"],
    ["còn hàng không em", "HOI_TON_KHO"],
    ["chốt cho chị mẫu này", "CHOT_DON"],
    ["em ơi", "CHAO_HOI"],
    ["ok cảm ơn em", "CAM_ON"],
    // PHẢI ra KHONG_RO (mơ hồ / chưa dạy):
    ["mẫu này ok phết nhỉ", "KHONG_RO"],
    ["hôm nay trời đẹp ghê", "KHONG_RO"],
    ["thế à", "KHONG_RO"],
  ];
  let pass = 0;
  for (const [msg, exp] of cases) {
    const r = routeOne(msg);
    const ok = r.intent === exp;
    if (ok) pass++;
    console.log(`  ${ok ? "✓" : "✗ SAI"}  ${String(r.intent).padEnd(20)} (${r.confidence.toFixed(2)})  ${JSON.stringify(msg)}${ok ? "" : "  [mong: " + exp + "]"}`);
  }
  // test xử TỪNG câu trong cụm nhiều tin
  console.log("\n  -- Cụm nhiều tin (xử từng câu) --");
  const batch = routeBatch(["Ok", "Tổng bill lại cho chị", "Có miễn ship không em"]);
  batch.forEach(r => console.log(`    • ${String(r.intent).padEnd(18)} ${JSON.stringify(r.text)}`));
  console.log(`\n  KẾT QUẢ: ${pass}/${cases.length} ${pass === cases.length ? "PASS" : "CÒN SAI"}`);
}
