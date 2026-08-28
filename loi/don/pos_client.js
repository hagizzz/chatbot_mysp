// ============================================================================
// pos_client.js — PANCAKE POS OPEN API (pos.pages.fm/api/v1)
// ----------------------------------------------------------------------------
// Chịu trách nhiệm MỌI thứ liên quan POS:
//   - getShops(): lấy danh sách shop (để biết shop_id).
//   - resolveVariant(code, color, size): MÃ sheet -> { product_id, variation_id, price... }
//   - matchProvince(addressText): dò tỉnh/thành từ địa chỉ text (best effort).
//   - createOrder(payload): TẠO ĐƠN (POST /shops/{shop}/orders).
//
// LƯU Ý: api_key + shop_id là credential RIÊNG của POS, KHÁC token Page.
// ============================================================================
const { POS_BASE, POS_API_KEY, POS_SHOP_ID, POS_WAREHOUSE_ID, POS_ORDER_STATUS, DRY_RUN, PAGE_ID, PAGE_NAME, BOT_SELLER_ID } = require("./order_config");

// Trạng thái "Đã xác nhận" của Pancake POS (số). Mặc định 1; chỉnh qua env nếu shop khác.
const POS_ORDER_STATUS_CONFIRMED = process.env.PANCAKE_POS_STATUS_CONFIRMED != null
  ? Number(process.env.PANCAKE_POS_STATUS_CONFIRMED) : 1;

// --- Chuẩn hóa chuỗi: bỏ dấu tiếng Việt, viết HOA, gọn khoảng trắng ---
function fold(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toUpperCase().replace(/\s+/g, " ").trim();
}

function posUrl(path, params = {}) {
  const qp = new URLSearchParams({ api_key: POS_API_KEY, ...params });
  return `${POS_BASE}${path}?${qp.toString()}`;
}

async function posGet(path, params) {
  const res = await fetch(posUrl(path, params));
  const txt = await res.text();
  let data; try { data = JSON.parse(txt); } catch { data = { success: false, _raw: txt.slice(0, 300) }; }
  if (!res.ok) console.log(`[POS GET ${path}] HTTP ${res.status} | ${txt.slice(0, 200)}`);
  return data;
}

async function posPost(path, body, params) {
  const res = await fetch(posUrl(path, params), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const txt = await res.text();
  let data; try { data = JSON.parse(txt); } catch { data = { success: false, _raw: txt.slice(0, 500) }; }
  if (!res.ok) console.log(`[POS POST ${path}] HTTP ${res.status} | ${txt.slice(0, 400)}`);
  return data;
}

async function posPut(path, body, params) {
  const res = await fetch(posUrl(path, params), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const txt = await res.text();
  let data; try { data = JSON.parse(txt); } catch { data = { success: false, _raw: txt.slice(0, 500) }; }
  if (!res.ok) console.log(`[POS PUT ${path}] HTTP ${res.status} | ${txt.slice(0, 400)}`);
  return data;
}

// ----------------------------------------------------------------------------
// SHOPS
// ----------------------------------------------------------------------------
async function getShops() {
  const d = await posGet("/shops");
  return d.shops || d.data || [];
}

// ----------------------------------------------------------------------------
// PRODUCTS — nạp 1 lần, cache RAM, index theo MÃ; mỗi product giữ list variation.
// ----------------------------------------------------------------------------
let _prodCache = { at: 0, byCode: new Map(), count: 0 };
const PROD_TTL = 10 * 60 * 1000;   // 10 phút

// Lấy "mã đối chiếu" từ 1 product POS (thử nhiều trường có thể chứa mã sheet).
function productCodeCandidates(p) {
  const out = [];
  for (const v of [p.display_id, p.custom_id, p.code, p.sku, p.barcode, p.name]) {
    if (v != null && String(v).trim()) out.push(fold(v));
  }
  // mã có thể nằm ở barcode của variation
  for (const vr of p.variations || []) {
    for (const v of [vr.barcode, vr.custom_id, vr.display_id, vr.sku]) {
      if (v != null && String(v).trim()) out.push(fold(v));
    }
  }
  return out;
}

async function _fetchAllProducts() {
  const byCode = new Map();
  let count = 0;
  // POS phân trang: page_number + page_size. Quét tối đa 60 trang (an toàn).
  for (let page = 1; page <= 60; page++) {
    const d = await posGet(`/shops/${POS_SHOP_ID}/products`, { page_number: page, page_size: 100 });
    const list = d.data || d.products || [];
    if (!Array.isArray(list) || list.length === 0) break;
    for (const p of list) {
      count++;
      for (const cand of productCodeCandidates(p)) {
        if (!byCode.has(cand)) byCode.set(cand, p);
      }
    }
    if (list.length < 100) break;
  }
  _prodCache = { at: Date.now(), byCode, count };
  console.log(`[POS] đã nạp ${count} sản phẩm POS (index ${byCode.size} khóa mã).`);
  return _prodCache;
}

async function ensureProducts() {
  if (_prodCache.count && Date.now() - _prodCache.at < PROD_TTL) return _prodCache;
  try { return await _fetchAllProducts(); }
  catch (e) { console.log("[POS] nạp sản phẩm lỗi:", e.message); return _prodCache; }
}

// Trong 1 product, tìm VARIATION khớp ĐÚNG màu + size.
function pickVariation(product, color, size) {
  const variations = product.variations || [];
  if (!variations.length) return { best: null, available: [] };
  const wantC = fold(color);
  const wantS = fold(size);
  const wantCTokens = wantC.split(/[^A-Z0-9]+/).filter(t => t.length >= 2);

  // Lấy chuỗi mô tả thuộc tính của 1 variation (gộp fields + name + title).
  const variationAttrs = (vr) => {
    const parts = [];
    for (const f of vr.fields || vr.variation_fields || []) {
      if (f && (f.value || f.name)) parts.push(`${f.name || ""}:${f.value || ""}`);
    }
    if (vr.name) parts.push(vr.name);
    if (vr.title) parts.push(vr.title);
    if (Array.isArray(vr.detail_variations)) {
      for (const d of vr.detail_variations) parts.push(`${d.name || ""}:${d.value || ""}`);
    }
    return fold(parts.join(" | "));
  };

  const available = variations.map(variationAttrs);

  // Size khớp = chữ size đứng tách (S/M/L/FREESIZE...).
  const sizeOk = (attrs) => !!wantS && new RegExp(`(^|[^A-Z0-9])${wantS}([^A-Z0-9]|$)`).test(attrs);

  // Chấm điểm màu: đếm số token màu xuất hiện trong mô tả biến thể.
  // (vd "DEN BE" -> [DEN, BE]; biến thể "DENBE" hay "DEN PHOI BE" đều trúng cả 2.)
  const colorScore = (attrs) => {
    if (!wantCTokens.length) return 0;
    let s = 0;
    for (const t of wantCTokens) if (attrs.includes(t)) s++;
    return s;
  };

  // ĐIỂM GỘP: màu là CHÍNH (x100), size phụ (+10). KHÔNG loại cứng theo size ->
  // màu đúng mà size ghi lệch vẫn lên được (lấy đúng biến thể POS theo màu).
  let best = null, bestScore = 0;
  for (const vr of variations) {
    const attrs = variationAttrs(vr);
    const sc = colorScore(attrs) * 100 + (sizeOk(attrs) ? 10 : 0);
    if (sc > bestScore) { best = vr; bestScore = sc; }
  }
  // Không có yêu cầu màu -> ưu tiên size; không nữa thì lấy biến thể duy nhất.
  if (!best && !wantCTokens.length) {
    best = variations.find(vr => sizeOk(variationAttrs(vr))) || (variations.length === 1 ? variations[0] : null);
  }
  if (!best && variations.length === 1) best = variations[0];
  return { best, available };
}

// MÃ sheet (+ màu + size) -> thông tin biến thể POS để bỏ vào dòng đơn.
// Trả { ok, product_id, variation_id, price, weight, productName, reason }.
async function resolveVariant(code, color, size) {
  const c = await ensureProducts();
  const product = c.byCode.get(fold(code));
  if (!product) return { ok: false, reason: `KHÔNG tìm thấy SP POS cho mã ${code}` };
  const { best: vr, available } = pickVariation(product, color, size);
  if (!vr) {
    const list = (available || []).slice(0, 12).join("  ||  ");
    return { ok: false, reason: `Mã ${code} không có biến thể khớp màu "${color}" size "${size}". POS đang có: [ ${list} ]` };
  }
  const matchedLabel = (vr.variation_info && vr.variation_info.detail) ||
    (Array.isArray(vr.fields) ? vr.fields.map(f => `${f.name}:${f.value}`).join(",") : "") ||
    vr.name || "";
  console.log(`[POS biến thể] mã ${code} | xin "${color}/${size}" -> chọn POS: ${matchedLabel || vr.id}`);
  return {
    ok: true,
    product_id: vr.product_id || product.id || product.product_id,
    variation_id: vr.id || vr.variation_id,
    price: Number(vr.retail_price || vr.price || product.retail_price || 0) || 0,
    weight: Number(vr.weight || 0) || 0,
    productName: product.name || ""
  };
}

// ----------------------------------------------------------------------------
// GEO — dò tỉnh/thành từ địa chỉ text (best effort, chỉ để gắn province_id).
// ----------------------------------------------------------------------------
let _provCache = { at: 0, list: [] };
async function ensureProvinces() {
  if (_provCache.list.length && Date.now() - _provCache.at < 24 * 3600 * 1000) return _provCache.list;
  try {
    const d = await posGet("/geo/provinces");
    _provCache = { at: Date.now(), list: d.data || d.provinces || [] };
  } catch (e) { console.log("[POS] /geo/provinces lỗi:", e.message); }
  return _provCache.list;
}

// Trả { province_id, province_name, new_province_id } nếu dò được, ngược lại null.
async function matchProvince(addressText) {
  const list = await ensureProvinces();
  if (!list.length) return null;
  const a = fold(addressText);
  let hit = null;
  for (const p of list) {
    const name = fold(p.name || p.province_name || "");
    // bỏ tiền tố "TINH"/"THANH PHO" để khớp lỏng
    const bare = name.replace(/^(TINH|THANH PHO|TP)\s+/i, "");
    if (bare && a.includes(bare)) { hit = p; break; }
  }
  if (!hit) return null;
  return {
    province_id: String(hit.id || hit.province_id),
    province_name: hit.name || hit.province_name,
    new_province_id: hit.new_id || null
  };
}

// ---- PHƯỜNG/XÃ (commune) ----
// /geo/communes?province_id=<id> trả [{id,name,district_id,province_id,new_id,...}]
const _communeCache = {};   // provinceId -> { at, list }
async function ensureCommunes(provinceId) {
  const key = String(provinceId);
  const c = _communeCache[key];
  if (c && c.list.length && Date.now() - c.at < 24 * 3600 * 1000) return c.list;
  let list = [];
  try {
    const d = await posGet("/geo/communes", { province_id: key });
    list = d.data || d.communes || [];
  } catch (e) { console.log("[POS] /geo/communes lỗi:", e.message); }
  _communeCache[key] = { at: Date.now(), list: Array.isArray(list) ? list : [] };
  return _communeCache[key].list;
}

// Dò Phường/Xã từ địa chỉ text — MAP CẢ DANH SÁCH CŨ LẪN MỚI (sau sáp nhập 2025).
//   - phường CŨ:  /geo/communes?province_id=<id cũ>   (mỗi cái có new_id -> phường mới)
//   - phường MỚI: /geo/communes?province_id=<new_id tỉnh>  (id chính là mã phường mới)
// Khách ghi tên cũ HAY mới đều khớp. Ưu tiên tên DÀI nhất (vd "Tây Nha Trang" > "Nha Trang").
// Trả { commune_id, commune_name, district_id, new_commune_id } hoặc null.
async function resolveCommune(province, addressText) {
  // Cho phép gọi cũ resolveCommune(provinceIdString, addr) lẫn mới resolveCommune(provinceObj, addr).
  const oldId = typeof province === "object" ? province.province_id : province;
  const newProvId = typeof province === "object" ? province.new_province_id : null;

  const oldList = await ensureCommunes(oldId);
  const newList = newProvId ? await ensureCommunes(newProvId) : [];

  // Gộp ứng viên, đánh dấu nguồn (cũ/mới).
  const cands = [];
  for (const c of oldList) cands.push({ src: "old", c });
  for (const c of newList) cands.push({ src: "new", c });
  if (!cands.length) return null;

  const a = fold(addressText);
  let best = null, bestLen = 0;
  for (const cand of cands) {
    const full = fold(cand.c.name || cand.c.commune_name || "");
    const bare = full.replace(/^(PHUONG|XA|THI TRAN|TT|P|X)\s+/i, "").trim();
    if (bare.length < 3) continue;
    if (a.includes(bare) && bare.length > bestLen) { best = cand; bestLen = bare.length; }
  }
  if (!best) return null;

  const c = best.c;
  if (best.src === "new") {
    // Khớp danh sách MỚI: id chính là mã phường mới -> phải gửi kèm TỈNH mã MỚI cho khớp hệ 2 cấp.
    return {
      commune_id: String(c.id),
      commune_name: c.name || c.commune_name,
      district_id: c.district_id != null ? String(c.district_id) : null,
      new_commune_id: String(c.id),
      use_province_id: newProvId,        // <-- dùng tỉnh mã mới
      use_new_province_id: newProvId,
      matched: "mới"
    };
  }
  // Khớp danh sách CŨ: mã cũ + new_id. (giữ đúng format đã làm Thái Nguyên xanh)
  return {
    commune_id: String(c.id || c.commune_id),
    commune_name: c.name || c.commune_name,
    district_id: c.district_id != null ? String(c.district_id) : null,
    new_commune_id: c.new_id || null,
    use_province_id: oldId,              // <-- giữ tỉnh mã cũ
    use_new_province_id: newProvId,
    matched: "cũ"
  };
}

// ----------------------------------------------------------------------------
// CREATE ORDER — POST /shops/{shop}/orders
// ----------------------------------------------------------------------------
// args: {
//   fullName, phone, addressText, province, items:[{product_id, variation_id, quantity}],
//   totalPrice, cod, isFreeShipping, note, customerFbId
// }
async function createOrder(args) {
  const province = args.province || {};
  const desiredStatus = (args.status != null ? Number(args.status) : POS_ORDER_STATUS);
  // 2 BƯỚC để ghi "NV xác nhận": nếu muốn Đã xác nhận (status!=0) và có tài khoản bot ->
  // tạo đơn ở "Mới" (0) trước, rồi gọi xác nhận riêng (đổi 0->status) kèm editor = bot.
  const twoStep = !!BOT_SELLER_ID && desiredStatus !== 0;
  const body = {
    bill_full_name: args.fullName,
    bill_phone_number: args.phone,
    status: twoStep ? 0 : desiredStatus,
    is_free_shipping: !!args.isFreeShipping,
    customer_pay_fee: false,
    cod: Number(args.cod || 0),
    total_price: Number(args.totalPrice || 0),
    note: args.note || "",
    items: (args.items || []).map(it => ({
      product_id: it.product_id,
      variation_id: it.variation_id,
      quantity: Number(it.quantity || 1),
      discount_each_product: 0,
      is_bonus_product: false,
      is_discount_percent: false,
      is_wholesale: false,
      one_time_product: false
    })),
    shipping_address: {
      full_name: args.fullName,
      phone_number: args.phone,
      address: args.addressText,
      full_address: args.addressText,
      province_id: (args.commune && args.commune.use_province_id) || province.province_id || null,
      province_name: province.province_name || null,
      new_province_id: (args.commune && args.commune.use_new_province_id) || province.new_province_id || null,
      district_id: (args.commune && args.commune.district_id) || null,
      commune_id: (args.commune && args.commune.commune_id) || null,
      commune_name: (args.commune && args.commune.commune_name) || null,
      new_commune_id: (args.commune && args.commune.new_commune_id) || null,
      country_code: "84"
    }
  };
  if (POS_WAREHOUSE_ID) body.warehouse_id = POS_WAREHOUSE_ID;
  // Nguồn đơn = page CỦA HỘI THOẠI (đa page). args.pageId từ conv.page_id; fallback PAGE_ID (.env).
  const pageId = String(args.pageId || PAGE_ID || "");
  if (pageId) body.page_id = pageId;
  // Liên kết hội thoại FB (id dạng "{page}_{psid}") — chỉ là chuỗi, an toàn.
  const convFb = args.conversationId ||
    (args.customerFbId && pageId ? `${pageId}_${args.customerFbId}` : null);
  if (convFb) body.conversation_id = convFb;
  // Cách 1: gán người phụ trách + người sửa cuối = tài khoản bot -> "Phân công cho" + "NV xác nhận".
  if (BOT_SELLER_ID) { body.assigning_seller_id = String(BOT_SELLER_ID); body.last_editor_id = String(BOT_SELLER_ID); body.editor_id = String(BOT_SELLER_ID); }

  if (DRY_RUN) {
    console.log("[DRY_RUN] KHÔNG gọi POS. Payload đơn:\n", JSON.stringify(body, null, 2));
    return { success: true, dryRun: true, data: { id: "DRYRUN", display_id: "DRYRUN" } };
  }

  let d = await posPost(`/shops/${POS_SHOP_ID}/orders`, body);
  let order = d.data || d;
  let realId = (order && (order.id || order.order_id)) || null;

  // Nếu lỗi mà có field phụ (assigning_seller_id / conversation_id / page_id) -> thử lại KHÔNG có chúng,
  // để đơn vẫn lên (tránh 1 field sai làm hỏng cả đơn). Log rõ field nào gây lỗi.
  if (!realId && (body.assigning_seller_id || body.conversation_id || body.page_id)) {
    console.log(`[POS] tạo đơn lỗi với field phụ -> thử lại KHÔNG gắn assigning_seller_id/conversation_id/page_id.`);
    const b2 = Object.assign({}, body);
    delete b2.assigning_seller_id; delete b2.last_editor_id; delete b2.editor_id; delete b2.conversation_id; delete b2.page_id;
    d = await posPost(`/shops/${POS_SHOP_ID}/orders`, b2);
    order = d.data || d;
    realId = (order && (order.id || order.order_id)) || null;
    if (realId) console.log(`[POS] ✅ tạo lại OK -> id ${realId} (1 trong các field phụ bị POS từ chối; báo để chỉnh).`);
  }

  // BƯỚC 2: đơn đã tạo ở "Mới" -> xác nhận riêng (đổi sang desiredStatus) để Pancake ghi NGƯỜI xác nhận.
  if (realId && twoStep) {
    try {
      const c = await updateOrder(realId, { status: desiredStatus, pageId: pageId || undefined });
      console.log(`[POS] xác nhận đơn ${realId}: Mới -> ${desiredStatus} (NV xác nhận = bot) ${c.success ? "OK" : "lỗi"}.`);
    } catch (e) { console.log(`[POS] xác nhận đơn ${realId} lỗi:`, e.message); }
  }

  const ok = !!realId;
  return {
    success: ok,
    orderId: realId,
    displayId: (order && order.display_id) || null,
    raw: d
  };
}

// ----------------------------------------------------------------------------
// TRA TRẠNG THÁI ĐƠN — cho bot trả lời "hàng của chị đến đâu rồi".
//   - getOrdersByPhone(phone): GET /shops/{shop}/orders?search=<sđt> (mới nhất trước, lấy tới 20 đơn
//     để xử lý ca TÁCH ĐƠN). Lọc theo PAGE + trạng thái do worker làm.
//   - getOrderById(id):        GET /shops/{shop}/orders/{id}
// ----------------------------------------------------------------------------
function posConfigured() {
  return !!(POS_API_KEY && POS_SHOP_ID);
}

async function getOrdersByPhone(phone) {
  const p = String(phone || "").replace(/[^\d]/g, "");
  if (!p || !posConfigured()) return [];
  try {
    const d = await posGet(`/shops/${POS_SHOP_ID}/orders`, { search: p, page_size: 20, page_number: 1, option_sort: "inserted_at_desc" });
    const list = d.data || d.orders || [];
    return Array.isArray(list) ? list : [];
  } catch (e) { console.log("[POS] getOrdersByPhone lỗi:", e.message); return []; }
}

async function getOrderById(orderId) {
  if (!orderId || !posConfigured()) return null;
  try {
    const d = await posGet(`/shops/${POS_SHOP_ID}/orders/${orderId}`);
    return d.data || d.order || (d && d.id ? d : null);
  } catch (e) { console.log("[POS] getOrderById lỗi:", e.message); return null; }
}

// ----------------------------------------------------------------------------
// CẬP NHẬT ĐƠN SẴN CÓ — PUT /shops/{shop}/orders/{id}
// Dùng để HOÀN THIỆN đơn "Mới" mà Pancake auto-tạo (đã có tên FB + SĐT):
// nạp SP + địa chỉ + COD và ép trạng thái sang Đã xác nhận, THAY VÌ tạo đơn mới.
//   args giống createOrder + có thể truyền status.
// ----------------------------------------------------------------------------
async function updateOrder(orderId, args) {
  if (!orderId) return { success: false, raw: { _err: "thiếu orderId" } };
  const province = args.province || {};
  const body = {};
  if (args.status != null) body.status = Number(args.status);
  if (args.fullName != null) body.bill_full_name = args.fullName;
  if (args.phone != null) body.bill_phone_number = args.phone;
  if (args.isFreeShipping != null) body.is_free_shipping = !!args.isFreeShipping;
  if (args.cod != null) body.cod = Number(args.cod || 0);
  if (args.totalPrice != null) body.total_price = Number(args.totalPrice || 0);
  if (args.note != null) body.note = args.note;
  if (Array.isArray(args.tags)) body.tags = args.tags;
  // CHỈ set page khi được truyền vào (KHÔNG fallback Mys.P) -> cập nhật trạng thái không ghi đè page đơn.
  if (args.pageId) body.page_id = String(args.pageId);
  if (BOT_SELLER_ID) { body.assigning_seller_id = String(BOT_SELLER_ID); body.last_editor_id = String(BOT_SELLER_ID); body.editor_id = String(BOT_SELLER_ID); }
  if (Array.isArray(args.items)) {
    body.items = args.items.map(it => ({
      product_id: it.product_id, variation_id: it.variation_id,
      quantity: Number(it.quantity || 1),
      discount_each_product: 0, is_bonus_product: false,
      is_discount_percent: false, is_wholesale: false, one_time_product: false
    }));
  }
  if (args.addressText != null) {
    body.shipping_address = {
      full_name: args.fullName, phone_number: args.phone,
      address: args.addressText, full_address: args.addressText,
      province_id: (args.commune && args.commune.use_province_id) || province.province_id || null,
      province_name: province.province_name || null,
      new_province_id: (args.commune && args.commune.use_new_province_id) || province.new_province_id || null,
      district_id: (args.commune && args.commune.district_id) || null,
      commune_id: (args.commune && args.commune.commune_id) || null,
      commune_name: (args.commune && args.commune.commune_name) || null,
      new_commune_id: (args.commune && args.commune.new_commune_id) || null,
      country_code: "84"
    };
  }
  if (DRY_RUN) {
    console.log(`[DRY_RUN] KHÔNG gọi POS. Cập nhật đơn #${orderId}:\n`, JSON.stringify(body, null, 2));
    return { success: true, dryRun: true, orderId };
  }
  const d = await posPut(`/shops/${POS_SHOP_ID}/orders/${orderId}`, body);
  const order = d.data || d;
  const realId = (order && (order.id || order.order_id)) || (d.success === true ? orderId : null);
  return { success: !!realId, orderId: realId, displayId: (order && order.display_id) || null, raw: d };
}

// Chỉ đổi TRẠNG THÁI đơn (vd: Mới -> Đã xác nhận).
async function confirmOrder(orderId, statusValue) {
  return updateOrder(orderId, { status: (statusValue != null ? statusValue : POS_ORDER_STATUS_CONFIRMED) });
}

module.exports = { fold, getShops, ensureProducts, resolveVariant, matchProvince, resolveCommune, createOrder, updateOrder, confirmOrder, getOrdersByPhone, getOrderById, posConfigured };
