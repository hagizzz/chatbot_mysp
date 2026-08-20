// ============================================================================
// list_users.js — Liệt kê nhân viên POS: id NỘI BỘ (để gán) + Facebook ID + tên.
// Chạy:  node list_users.js
// Tìm dòng có Facebook ID = 1789212091309467 (Nguyễn Thu) -> copy "id POS" của dòng đó.
// ============================================================================
require("dotenv").config();
const { POS_BASE, POS_API_KEY, POS_SHOP_ID } = require("./order_config");

async function get(path) {
  const res = await fetch(`${POS_BASE}${path}${path.includes("?") ? "&" : "?"}api_key=${POS_API_KEY}`);
  const txt = await res.text();
  let d; try { d = JSON.parse(txt); } catch { return { _raw: txt.slice(0, 200), _status: res.status }; }
  return d;
}
function rows(arr) {
  for (const u of arr) {
    const id = u.id || u.user_id || u.uid || "?";
    const fb = u.fb_id || u.facebook_id || u.psid || "-";
    const nm = u.name || u.full_name || u.fb_name || u.email || "?";
    console.log(`  id POS = ${id}  | FB = ${fb}  | tên = ${nm}`);
  }
}
(async () => {
  for (const p of [`/shops/${POS_SHOP_ID}/users`, `/shops/${POS_SHOP_ID}/staffs`, `/shops/${POS_SHOP_ID}`]) {
    const d = await get(p);
    const arr = d.data?.users || d.users || d.data?.staffs || d.staffs ||
      (Array.isArray(d.data) ? d.data : (Array.isArray(d.users) ? d.users : null));
    console.log(`\n=== ${p} ===`);
    if (Array.isArray(arr) && arr.length) { rows(arr); console.log(`(${arr.length} nhân viên) -> COPY "id POS" của Nguyễn Thu (FB 1789212091309467)`); return; }
    if (d.data && typeof d.data === "object") console.log("  keys:", Object.keys(d.data).join(", "));
    else console.log("  (không có list)", d._raw || "");
  }
  console.log("\nKhông ra danh sách -> gửi mình ảnh này, mình chỉ cách khác lấy id POS.");
})();
