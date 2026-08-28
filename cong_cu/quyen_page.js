// ============================================================================
// quyen_page.js — TÔI CÓ QUYỀN GÌ TRÊN TỪNG PAGE?
// ----------------------------------------------------------------------------
//   node quyen_page.js              đọc PANCAKE_USER_ACCESS_TOKEN trong .env
//   node quyen_page.js <token>      soi một token khác (không đụng .env)
//
// CHỈ ĐỌC: không sinh token, không gửi gì, không đổi gì. Chạy bao nhiêu lần cũng được.
//
// Vì sao cần: Pancake CHỈ cho sinh page_access_token khi tài khoản có vai trò
// ADMIN trên page đó — mà vai trò này là của PANCAKE, không phải vai trò
// Facebook. Nhận quyền admin trên Facebook KHÔNG tự đổi vai trò trong Pancake.
// Đo 26/08/2026: tài khoản Hà Giang là ADMIN trên Facebook của Lady fashion
// nhưng Pancake vẫn ghi EDIT_PROFILE -> sinh token trả về "Thiếu quyền Admin".
// ============================================================================
"use strict";
require("../env_boot");

const tok = (process.argv[2] || process.env.PANCAKE_USER_ACCESS_TOKEN || "").trim();
if (!tok) {
  console.log("Thiếu token. Khai PANCAKE_USER_ACCESS_TOKEN trong .env, hoặc: node quyen_page.js <token>");
  process.exit(1);
}

function docPayload(t) {
  try { return JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString("utf8")); }
  catch (_) { return null; }
}

(async () => {
  const p = docPayload(tok);
  if (p) {
    console.log(`Tài khoản : ${p.name || "?"}`);
    if (p.exp) console.log(`Hạn token : ${new Date(p.exp * 1000).toLocaleString("vi-VN")}`);
  }
  if (p && !p.session_id) {
    console.log("\n!!! Đây là token của MỘT PAGE, không phải token tài khoản.");
    console.log("    Token tài khoản giải mã ra có name/session_id/exp; token page chỉ có id/timestamp.");
    process.exit(1);
  }

  const r = await fetch(`https://pages.fm/api/v1/pages?access_token=${encodeURIComponent(tok)}`);
  const j = await r.json().catch(() => null);
  if (!j || j.success === false) {
    console.log("\nKHÔNG gọi được Pancake:", (j && j.message) || "(không rõ)");
    if (j && j.error_code === 103) console.log("-> Phiên đăng nhập đã bị huỷ. Đăng nhập lại Pancake rồi lấy token mới.");
    process.exit(1);
  }

  const ds = [];
  for (const [nhom, v] of Object.entries(j.categorized || {})) {
    if (Array.isArray(v)) for (const x of v) if (x && (x.id || x.page_id)) ds.push({ nhom, x });
  }
  if (!ds.length) return console.log("\nTài khoản này không thấy page nào.");

  console.log(`\n${ds.length} page:\n`);
  const duoc = [], khong = [];
  for (const { nhom, x } of ds) {
    const id = String(x.id || x.page_id);
    const vai = x.role_in_page || "(không rõ)";
    const admin = /ADMIN/i.test(vai);
    console.log(`  ${admin ? "✔" : "✘"} ${id}  ${x.name}`);
    console.log(`      vai trò trong Pancake : ${vai}${admin ? "" : "   <- KHÔNG phải ADMIN"}`);
    console.log(`      nhóm                  : ${nhom}`);
    (admin ? duoc : khong).push(x.name);
  }

  console.log("\n" + "─".repeat(62));
  console.log(`Sinh được token cho : ${duoc.join(", ") || "(không page nào)"}`);
  console.log(`KHÔNG sinh được     : ${khong.join(", ") || "(không có)"}`);
  if (khong.length) {
    console.log("\nPage không sinh được thì phải: nhờ chủ tài khoản Pancake nâng vai trò lên ADMIN,");
    console.log("hoặc dùng token của tài khoản đã là ADMIN trên page đó.");
  }
})().catch(e => console.log("LỖI:", (e && e.message) || e));
