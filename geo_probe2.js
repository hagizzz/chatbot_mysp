// ============================================================================
// geo_probe2.js — TÌM DANH SÁCH PHƯỜNG/XÃ MỚI (sau sáp nhập 2025)
// Chạy:  node geo_probe2.js
// Tìm tỉnh Khánh Hòa, thử lấy phường theo CẢ id cũ lẫn new_id, tìm "Nha Trang".
// Gửi TOÀN BỘ output lại.
// ============================================================================
require("dotenv").config();
const { POS_BASE, POS_API_KEY } = require("./order_config");

function url(path, params = {}) {
  const qp = new URLSearchParams({ api_key: POS_API_KEY, ...params });
  return `${POS_BASE}${path}?${qp.toString()}`;
}
async function get(path, params) {
  try {
    const res = await fetch(url(path, params));
    const txt = await res.text();
    let data; try { data = JSON.parse(txt); } catch { data = { _raw: txt.slice(0, 150) }; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) { return { ok: false, status: 0, data: { _err: e.message } }; }
}
const fold = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toUpperCase();
function findNhaTrang(arr) {
  if (!Array.isArray(arr)) return null;
  return arr.filter(x => fold(x.name || x.commune_name || "").includes("NHA TRANG"));
}

(async () => {
  console.log("=== Tìm tỉnh Khánh Hòa ===");
  const prov = await get("/geo/provinces");
  const plist = prov.data.data || prov.data.provinces || [];
  const KH = plist.find(p => fold(p.name || p.province_name).includes("KHANH HOA"));
  if (!KH) { console.log("KHÔNG thấy Khánh Hòa. Danh sách có:", plist.slice(0,5).map(p=>p.name)); return; }
  const idCu = KH.id || KH.province_id;
  const idMoi = KH.new_id;
  console.log("Khánh Hòa:", JSON.stringify(KH), "| id cũ =", idCu, "| new_id =", idMoi);

  const tries = [
    ["/geo/communes", { province_id: idCu }],            // cũ
    ["/geo/communes", { province_id: idMoi }],           // thử new_id
    ["/geo/communes", { new_province_id: idMoi }],
    ["/geo/new_communes", { province_id: idCu }],
    ["/geo/new_communes", { province_id: idMoi }],
    ["/geo/wards", { province_id: idMoi }],
    ["/geo/communes_v2", { province_id: idCu }],
    ["/geo/communes", { province_id: idCu, version: "new" }],
    ["/geo/communes", { province_id: idCu, v: 2 }],
  ];
  for (const [path, params] of tries) {
    const r = await get(path, params);
    const arr = r.data.data || r.data.communes || r.data.wards || r.data;
    const n = Array.isArray(arr) ? arr.length : 0;
    console.log(`\n-> ${path} ${JSON.stringify(params)} | HTTP ${r.status} | mảng: ${n}`);
    if (n) {
      console.log("   mẫu 3:", JSON.stringify(arr.slice(0, 3)));
      const nt = findNhaTrang(arr);
      if (nt && nt.length) console.log("   >>> CÓ 'Nha Trang':", JSON.stringify(nt.slice(0, 8)));
      else console.log("   (không có phường tên chứa 'Nha Trang' trong list này)");
    } else if (r.data && (r.data._err || r.data._raw)) {
      console.log("   lỗi/raw:", JSON.stringify(r.data).slice(0, 160));
    }
  }
  console.log("\n=== XONG. Gửi toàn bộ output. ===");
})();
