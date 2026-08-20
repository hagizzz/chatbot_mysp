#!/usr/bin/env node
// ============================================================================
// chuyen_bo_nho_sang_sqlite.js — CHUYỂN conversation_memory.json -> SQLite
// ----------------------------------------------------------------------------
//   node chuyen_bo_nho_sang_sqlite.js            # chuyển thật
//   node chuyen_bo_nho_sang_sqlite.js --thu      # chỉ đếm, không ghi
//   node chuyen_bo_nho_sang_sqlite.js --xuat-lai # xuất SQLite ngược ra JSON để đối chiếu
//
// AN TOÀN: KHÔNG xoá, KHÔNG sửa file JSON cũ. Chạy lại nhiều lần vẫn ra cùng kết quả.
// Chạy xong hãy đối chiếu bằng --xuat-lai rồi mới đổi bot sang dùng SQLite.
// ============================================================================
require("./env_boot");
const fs = require("fs");
const path = require("path");
const store = require("./conversation_store");

const THU = process.argv.includes("--thu");
const XUAT_LAI = process.argv.includes("--xuat-lai");

if (XUAT_LAI) {
  const out = store.xuatJSON();
  const f = path.join(__dirname, "conversation_memory.tu_sqlite.json");
  fs.writeFileSync(f, JSON.stringify(out, null, 2), "utf8");
  console.log(`Đã xuất ${Object.keys(out).length} hội thoại từ SQLite -> ${path.basename(f)}`);
  console.log("Đối chiếu:  node chuyen_bo_nho_sang_sqlite.js --so-sanh");
  process.exit(0);
}

if (process.argv.includes("--so-sanh")) {
  const cu = JSON.parse(fs.readFileSync(store.JSON_CU, "utf8"));
  const moi = store.xuatJSON();
  const kCu = Object.keys(cu), kMoi = Object.keys(moi);
  const thieu = kCu.filter(k => !(k in moi));
  let lech = [];
  for (const k of kCu) {
    if (!(k in moi)) continue;
    if (JSON.stringify(cu[k]) !== JSON.stringify(moi[k])) lech.push(k);
  }
  console.log(`JSON cũ : ${kCu.length} hội thoại`);
  console.log(`SQLite  : ${kMoi.length} hội thoại`);
  console.log(`Thiếu   : ${thieu.length}${thieu.length ? " -> " + thieu.slice(0, 5).join(", ") : ""}`);
  console.log(`Lệch nội dung: ${lech.length}${lech.length ? " -> " + lech.slice(0, 5).join(", ") : ""}`);
  console.log(thieu.length === 0 && lech.length === 0 ? "\n✓ KHỚP HOÀN TOÀN — đổi bot sang SQLite được." : "\n✗ CHƯA khớp, đừng đổi vội.");
  process.exit(thieu.length || lech.length ? 1 : 0);
}

if (!fs.existsSync(store.JSON_CU)) {
  console.log(`Không thấy ${store.JSON_CU} — không có gì để chuyển (máy mới thì đây là bình thường).`);
  process.exit(0);
}

const t0 = Date.now();
const cu = JSON.parse(fs.readFileSync(store.JSON_CU, "utf8"));
const ids = Object.keys(cu);
console.log(`Đọc ${ids.length} hội thoại từ ${path.basename(store.JSON_CU)} (${(fs.statSync(store.JSON_CU).size / 1024).toFixed(0)} KB)`);

if (THU) {
  console.log("(--thu) Không ghi gì. Bỏ cờ --thu để chuyển thật.");
  process.exit(0);
}

let n = 0;
for (const id of ids) {
  const v = cu[id];
  if (!v || typeof v !== "object") continue;
  store.updateConversationState(id, v);
  n++;
  if (n % 500 === 0) console.log(`  ... ${n}/${ids.length}`);
}
console.log(`\nĐã chuyển ${n} hội thoại trong ${Date.now() - t0} ms.`);
console.log(`CSDL: ${store.DB_FILE} (${(fs.statSync(store.DB_FILE).size / 1024).toFixed(0)} KB)`);
console.log(`\nĐối chiếu ngay:  node chuyen_bo_nho_sang_sqlite.js --so-sanh`);
store.dong();
