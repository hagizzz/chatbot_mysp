function normalizeText(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectIntent(text = "") {
  const raw = String(text || "").trim();
  const t = normalizeText(raw);

  if (!t) return "UNKNOWN";

  if (/^(chao|hello|hi|helo|alo|em oi|shop oi|c oi|e oi)\b/.test(t)) {
    return "GREETING";
  }

  if (/\b(cam on|thanks|thank|ok e|oke e|ok em)\b/.test(t)) {
    return "THANKS";
  }

  if (/(?:\+?84|0)(?:\d[\s.-]?){8,10}\d/.test(raw)) {
    return "PROVIDE_PHONE";
  }

  // ĐỊA CHỈ: tránh khớp nhầm từ thời trang ("quần" -> "quan"/quận, "phở", "áo"...) và "quan tâm/quán".
  // Quy tắc: chỉ nhận khi có từ khoá địa chỉ TƯỜNG MINH (địa chỉ/số nhà/chung cư), HOẶC dấu hiệu YẾU + có SỐ
  // (địa chỉ thật gần như luôn có số nhà/ngõ/quận); và KHÔNG nằm trong ngữ cảnh quần áo.
  const _garmentCtx = /(quan ao|quan dui|quan lot|quan sooc|quan short|quan tat|quan legging|quan jean|quan tay|quan ong|quan baggy|quan trong|quan om|lop lot|lot ben trong|ben trong|chan vay|\bao\b|\bvay\b|\bdam\b|\bset\b|\bsize\b)/i.test(t);
  const _addrExplicit = /(dia chi|so nha|chung cu|ngach|to dan pho|khu pho)/i.test(t);
  const _addrWeak = /(nguyen|tran |le |pham|hoang|ngo |duong |pho |phuong|xa |quan |huyen|tinh|thanh pho|\btp\b)/i.test(t);
  if (!_garmentCtx && (_addrExplicit || (_addrWeak && /\d/.test(t)))) {
    return "PROVIDE_ADDRESS";
  }

  // SIZE: dùng ranh giới UNICODE (?<![\p{L}\p{N}]) ... (?![\p{L}\p{N}]) — KHÔNG dùng \b ASCII của JS,
  // vì \b coi ký tự có dấu là "non-word" -> "Mình"/"Lan"/"Số"... bị đọc nhầm chữ đầu thành size M/L/S
  // (=> "Mình xin giá..." bị tưởng là cho size -> chặn báo giá). Phải là size ĐỨNG RIÊNG.
  if (/(?<![\p{L}\p{N}])(?:size|sz)?\s*(xs|s|m|l|xl|xxl|xxxl|freesize|free\s?size|fs)(?![\p{L}\p{N}])/iu.test(raw)) {
    if (!/(co|con|vua|mac|mặc|kg|size nao|size gi|tu van)/i.test(raw)) {
      return "PROVIDE_SIZE";
    }
  }

  if (
    t.includes("gia") ||
    t.includes("bao nhieu") ||
    t.includes("may tien") ||
    t.includes("bn tien") ||
    t.includes("cho c gia") ||
    t.includes("xin gia")
  ) {
    return "ASK_PRICE";
  }

  if (
    /\b\d{2,3}\s*kg\b/i.test(raw) ||
    t.includes("bao nhieu kg") ||
    t.includes("vua khong") ||
    t.includes("vua ko") ||
    t.includes("mac vua") ||
    t.includes("mặc vừa")
  ) {
    return "ASK_SIZE_ADVICE";
  }

  if (
    t.includes("size") ||
    t.includes("sz") ||
    t.includes("co s") ||
    t.includes("co m") ||
    t.includes("co l") ||
    t.includes("co xl") ||
    t.includes("con s") ||
    t.includes("con m") ||
    t.includes("con l") ||
    t.includes("con xl")
  ) {
    return "ASK_SIZE";
  }

  if (
    t.includes("mau") ||
    t.includes("co may mau") ||
    t.includes("nhung mau gi")
  ) {
    return "ASK_COLOR";
  }

  if (
    t.includes("chat lieu") ||
    t.includes("vai gi") ||
    t.includes("vai nhu nao") ||
    t.includes("co gian")
  ) {
    return "ASK_MATERIAL";
  }

  if (
    t.includes("con hang") ||
    t.includes("con khong") ||
    t.includes("con ko") ||
    t.includes("het hang")
  ) {
    return "ASK_STOCK";
  }

  if (
    t.includes("giam gia") ||
    t.includes("sale") ||
    t.includes("khuyen mai") ||
    t.includes("mua 2 co giam")
  ) {
    return "ASK_DISCOUNT";
  }

  if (
    t.includes("ship") ||
    t.includes("giao hang") ||
    t.includes("van chuyen") ||
    t.includes("bao lau nhan")
  ) {
    return "ASK_SHIPPING";
  }

  if (
    t.includes("doi hang") ||
    t.includes("tra hang") ||
    t.includes("hoan hang") ||
    t.includes("doi tra")
  ) {
    return "ASK_RETURN_POLICY";
  }

  if (
    t.includes("shop o dau") ||
    t.includes("dia chi shop") ||
    t.includes("cua hang") ||
    t.includes("showroom") ||
    t.includes("co so")
  ) {
    return "ASK_STORE_ADDRESS";
  }

  if (
    t.includes("chuyen khoan") ||
    t.includes("stk") ||
    t.includes("so tai khoan") ||
    t.includes("thanh toan")
  ) {
    return "ASK_PAYMENT";
  }

  if (
    t.includes("chi lay") ||
    t.includes("lay cho chi") ||
    t.includes("chot") ||
    t.includes("len don") ||
    t.includes("dat hang") ||
    t.includes("mua mau nay") ||
    t.includes("lay mau nay") ||
    t.includes("lay them")
  ) {
    return "ORDER_INTENT";
  }

  return "UNKNOWN";
}

module.exports = {
  detectIntent,
  normalizeText
};
