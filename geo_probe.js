// ============================================================================
// geo_probe.js — DÒ API ĐỊA CHỈ (Phường/Xã) CỦA PANCAKE POS
// Chạy trên máy có .env (gọi được POS):  node geo_probe.js
// Nó tìm tỉnh "Thái Nguyên", rồi thử nhiều endpoint để lấy Phường/Xã,
// in ra endpoint nào CHẠY + vài mẫu dữ liệu. Gửi toàn bộ output cho mình.
// ============================================================================
require("dotenv").config();
const { POS_BASE, POS_API_KEY, POS_SHOP_ID } = require("./order_config");

function url(path, params = {}) {
  const qp = new URLSearchParams({ api_key: POS_API_KEY, ...params });
  return `${POS_BASE}${path}?${qp.toString()}`;
}
async function get(path, params) {
  try {
    const res = await fetch(url(path, params));
    const txt = await res.text();
    let data; try { data = JSON.parse(txt); } catch { data = { _raw: txt.slice(0, 200) }; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) { return { ok: false, status: 0, data: { _err: e.message } }; }
}
function sample(arr) {
  if (!Array.isArray(arr)) return "(không phải mảng)";
  return arr.slice(0, 6).map(x => JSON.stringify(x)).join("\n      ");
}

(async () => {
  if (!POS_API_KEY || !POS_SHOP_ID) { console.log("THIẾU api_key/shop_id trong .env"); return; }
  console.log("=== 1) /geo/provinces -> tìm Thái Nguyên ===");
  const prov = await get("/geo/provinces");
  const plist = prov.data.data || prov.data.provinces || [];
  console.log("status:", prov.status, "| số tỉnh:", Array.isArray(plist) ? plist.length : "?");
  if (Array.isArray(plist) && plist.length) console.log("   mẫu tỉnh:", JSON.stringify(plist[0]));
  const TN = (Array.isArray(plist) ? plist : []).find(p =>
    /thai nguyen/i.test(String(p.name || p.province_name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
  if (!TN) { console.log("KHÔNG thấy Thái Nguyên trong danh sách tỉnh -> dừng."); return; }
  const pid = TN.id || TN.province_id;
  console.log("   -> Thái Nguyên id =", pid, "| object:", JSON.stringify(TN));

  console.log("\n=== 2) THỬ CÁC ENDPOINT LẤY PHƯỜNG/XÃ (2 cấp) THEO province_id ===");
  const tries2 = [
    ["/geo/communes", { province_id: pid }],
    ["/geo/wards", { province_id: pid }],
    ["/geo/communes", { province_ids: pid }],
    [`/geo/provinces/${pid}/communes`, {}],
    [`/geo/provinces/${pid}/wards`, {}],
    ["/geo/districts", { province_id: pid }],   // hệ 3 cấp cũ (nếu còn)
  ];
  for (const [path, params] of tries2) {
    const r = await get(path, params);
    const arr = r.data.data || r.data.communes || r.data.wards || r.data.districts || r.data;
    const n = Array.isArray(arr) ? arr.length : 0;
    console.log(`\n-> ${path} ${JSON.stringify(params)} | HTTP ${r.status} | mảng: ${n}`);
    if (n) {
      console.log("   mẫu 6 phần tử:\n      " + sample(arr));
      // thử tìm Phan Đình Phùng cho chắc
      const found = arr.find(x => /phan dinh phung/i.test(String(x.name || x.commune_name || x.ward_name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
      if (found) console.log("   >>> TÌM THẤY 'Phan Đình Phùng':", JSON.stringify(found));
    } else if (r.data && (r.data._err || r.data._raw)) {
      console.log("   lỗi/raw:", JSON.stringify(r.data).slice(0, 200));
    }
  }

  console.log("\n=== 3) (nếu hệ 3 cấp) thử communes theo district_id đầu tiên ===");
  const dr = await get("/geo/districts", { province_id: pid });
  const darr = dr.data.data || dr.data.districts || [];
  if (Array.isArray(darr) && darr.length) {
    const did = darr[0].id || darr[0].district_id;
    console.log("   district mẫu:", JSON.stringify(darr[0]));
    for (const [path, params] of [["/geo/communes", { district_id: did }], ["/geo/wards", { district_id: did }], [`/geo/districts/${did}/communes`, {}]]) {
      const r = await get(path, params);
      const arr = r.data.data || r.data.communes || r.data.wards || r.data;
      const n = Array.isArray(arr) ? arr.length : 0;
      console.log(`-> ${path} ${JSON.stringify(params)} | HTTP ${r.status} | mảng: ${n}`);
      if (n) console.log("   mẫu:\n      " + sample(arr));
    }
  } else {
    console.log("   /geo/districts rỗng -> shop dùng hệ 2 CẤP (tỉnh -> phường/xã).");
  }
  console.log("\n=== XONG. Copy TOÀN BỘ output này gửi lại. ===");
})();

// ============================================================================
// PHẦN 4 — IN 1 ĐƠN THẬT theo SĐT để xem cấu trúc field (status/items/địa chỉ).
// Chạy:  node geo_probe.js 0987690509
// ============================================================================
(async () => {
  const phone = process.argv[2];
  if (!phone) { console.log("\n(Bỏ qua phần dump đơn: chạy `node geo_probe.js 0987690509` để xem 1 đơn thật.)"); return; }
  await new Promise(r => setTimeout(r, 1500));
  console.log(`\n=== 4) DUMP 1 ĐƠN THẬT theo SĐT ${phone} ===`);
  const r = await get(`/shops/${POS_SHOP_ID}/orders`, { search: phone.replace(/[^\d]/g, ""), page_size: 5, page_number: 1, option_sort: "inserted_at_desc" });
  const list = r.data.data || r.data.orders || [];
  console.log("HTTP", r.status, "| số đơn:", Array.isArray(list) ? list.length : "?");
  if (Array.isArray(list) && list.length) {
    const o = list.find(x => String(x.display_id || x.id) === "109379") || list[0];
    console.log("\n--- ĐƠN MẪU (rút gọn các field quan trọng) ---");
    console.log("id:", o.id, "| display_id:", o.display_id, "| status:", o.status, "| status_name:", o.status_name);
    console.log("keys đơn:", Object.keys(o).join(", "));
    const items = o.items || o.order_items || o.products || o.order_products;
    console.log("\nfield items thực tế:", o.items ? "items" : o.order_items ? "order_items" : o.products ? "products" : o.order_products ? "order_products" : "(KHÔNG thấy)");
    if (Array.isArray(items) && items.length) {
      console.log("keys 1 item:", Object.keys(items[0]).join(", "));
      console.log("item[0]:", JSON.stringify(items[0]).slice(0, 600));
    }
    const sa = o.shipping_address || o.address || o.bill_address;
    console.log("\nshipping_address keys:", sa ? Object.keys(sa).join(", ") : "(không có)");
    if (sa) console.log("shipping_address:", JSON.stringify(sa).slice(0, 700));
  }
  console.log("\n=== XONG PHẦN 4. Gửi lại toàn bộ. ===");
})();
