// ============================================================================
// dump_order_fb.js — SOI field link Facebook của 1 đơn ĐÃ link đúng.
// Chạy:  node dump_order_fb.js 109449
// (thay 109449 = id đơn mà thẻ Khách hàng ĐANG hiện đúng FB, vd đơn ảnh 2)
// In ra các field liên quan account/page/psid để biết Pancake lưu thế nào.
// ============================================================================
require("dotenv").config();
const { POS_BASE, POS_API_KEY, POS_SHOP_ID } = require("../loi/don/order_config");

const orderId = process.argv[2];
if (!orderId) { console.log("Thiếu id đơn. Vd: node dump_order_fb.js 109449"); process.exit(1); }

(async () => {
  const url = `${POS_BASE}/shops/${POS_SHOP_ID}/orders/${orderId}?api_key=${POS_API_KEY}`;
  const res = await fetch(url);
  const txt = await res.text();
  let d; try { d = JSON.parse(txt); } catch { console.log("RAW:", txt.slice(0, 400)); return; }
  const o = d.data || d;

  const KEYS = ["account","account_id","account_name","page_id","fb_id","psid",
    "customer_id","conversation_id","post_id","ad_id","order_sources","source",
    "page","customer"];
  console.log(`=== Đơn #${orderId} — field link FB ===`);
  for (const k of KEYS) {
    if (o[k] !== undefined) {
      let v = o[k];
      if (v && typeof v === "object") v = JSON.stringify(v).slice(0, 300);
      console.log(`  ${k}:`, v);
    }
  }
  // in toàn bộ key cấp 1 để không bỏ sót
  console.log("\n--- TẤT CẢ key cấp 1 của đơn ---");
  console.log(Object.keys(o).join(", "));
  // nếu có object customer, in field của nó
  if (o.customer && typeof o.customer === "object") {
    console.log("\n--- customer.* ---");
    console.log(JSON.stringify(o.customer, null, 2).slice(0, 800));
  }
})();
