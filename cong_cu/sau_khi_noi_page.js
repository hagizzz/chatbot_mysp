#!/usr/bin/env node
// ============================================================================
// sau_khi_noi_page.js — BA VIỆC PHẢI LÀM NGAY SAU KHI NỐI PAGE VÀO mfs
// ----------------------------------------------------------------------------
// Nối Page xong KHÔNG phải là chạy được ngay. Còn ba việc, thiếu bất kỳ cái nào
// thì bot im lặng mà không báo lỗi gì:
//
//   1. Gán Page cho tài khoản bot. mfs mặc định TỪ CHỐI: tài khoản chưa được
//      gán Page nào thì thấy 0 hội thoại — không lỗi, không cảnh báo, chỉ là
//      không có việc gì làm. Đây là chỗ dễ mất buổi nhất.
//   2. Đăng ký app vào Page (subscribed_apps). Không có thì Meta không đẩy
//      webhook về, tin khách nhắn sẽ không bao giờ tới.
//   3. Kiểm lại đường webhook xuyên hầm còn sống không.
//
//   node sau_khi_noi_page.js
// ============================================================================
require("../env_boot");

const { execFileSync } = require("child_process");
const path = require("path");

const API = process.env.MFS_API_URL || "http://localhost:3000/v1";
const QUAN_TRI_EMAIL = process.env.MFS_ADMIN_EMAIL || "admin@shopmau.vn";
const QUAN_TRI_MK = process.env.MFS_ADMIN_PASSWORD || "MatKhau123!";
const BOT_EMAIL = process.env.MFS_EMAIL;

const PSQL = "C:/Users/Admin/Documents/mfs-ha-tang/pgsql/bin/psql.exe";
const CSDL = "postgres://postgres:postgres@localhost:5432/mfs";

function sql(cau) {
  // Cờ phải đứng TRƯỚC chuỗi kết nối, và chuỗi kết nối phải đi kèm -d.
  // Để chuỗi lên đầu thì psql coi các cờ phía sau là tên người dùng và lặng lẽ bỏ qua.
  return execFileSync(PSQL, ["-t", "-A", "-F", "|", "-d", CSDL, "-c", cau], { encoding: "utf8" }).trim();
}

(async () => {
  // ---- Đăng nhập quyền quản trị (gán Page đòi quyền admin) -----------------
  const dn = await fetch(`${API}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: QUAN_TRI_EMAIL, password: QUAN_TRI_MK })
  }).then(r => r.json());
  if (!dn.accessToken) {
    console.error(`Không đăng nhập được bằng ${QUAN_TRI_EMAIL}. Dừng.`);
    process.exit(1);
  }
  const H = { Authorization: "Bearer " + dn.accessToken, "Content-Type": "application/json" };

  // ---- 1. Gán TẤT CẢ Page thật cho tài khoản bot ---------------------------
  console.log("1. Gán Page cho tài khoản bot");

  const dsPage = sql(`select id||'|'||external_id||'|'||name from channel_connections where status='active'`)
    .split("\n").filter(Boolean)
    .map(d => { const [id, ext, ten] = d.split("|"); return { id, ext, ten }; });

  if (!dsPage.length) {
    console.error("   Chưa có Page nào trong mfs. Nối Page trước đã.");
    process.exit(1);
  }

  // Bỏ Page giả — gán nó cho bot chỉ tổ làm bot đi quét một Page không có thật
  const that = dsPage.filter(p => p.ext !== "PAGE_THU_MFS");
  if (!that.length) {
    console.error("   Chỉ có Page giả (PAGE_THU_MFS), chưa có Page thật nào.");
    process.exit(1);
  }
  for (const p of that) console.log(`   ${p.ext}  ${p.ten}`);

  const nd = await fetch(`${API}/users`, { headers: H }).then(r => r.json());
  const bot = (nd.items || nd || []).find(u => u.email === BOT_EMAIL);
  if (!bot) {
    console.error(`   Không thấy tài khoản bot "${BOT_EMAIL}" trong mfs.`);
    process.exit(1);
  }

  const r1 = await fetch(`${API}/users/${bot.id}/channels`, {
    method: "PUT", headers: H, body: JSON.stringify({ channelIds: that.map(p => p.id) })
  });
  console.log(`   -> HTTP ${r1.status} ${r1.ok ? "đã gán" : "HỎNG"}`);
  if (!r1.ok) console.log("   ", (await r1.text()).slice(0, 200));

  // ---- 2. Đăng ký app vào Page --------------------------------------------
  console.log("\n2. Đăng ký app vào Page (tunnel:sync --apply)");
  try {
    const out = execFileSync("npm", ["run", "tunnel:sync", "--", "--apply"], {
      cwd: "C:/Users/Admin/Documents/mfs/apps/api", encoding: "utf8", shell: true
    });
    for (const d of out.split("\n").filter(d => /Page|webhook|Webhook|du|dang ky|BO QUA|->/i.test(d))) {
      console.log("   " + d.trim());
    }
  } catch (e) {
    console.log("   tunnel:sync hỏng:", String(e.message).slice(0, 300));
  }

  // ---- 3. Kiểm đường webhook ----------------------------------------------
  console.log("\n3. Đường webhook xuyên hầm");
  const fs = require("fs");
  const envMfs = fs.readFileSync("C:/Users/Admin/Documents/mfs/apps/api/.env", "utf8");
  const url = (envMfs.match(/^PUBLIC_API_URL=(.+)$/m) || [])[1];
  const tok = (envMfs.match(/^META_VERIFY_TOKEN=(.+)$/m) || [])[1];
  if (!url || !tok) {
    console.log("   Thiếu PUBLIC_API_URL hoặc META_VERIFY_TOKEN trong .env của mfs");
  } else {
    const u = `${url.trim()}/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(tok.trim())}&hub.challenge=THU`;
    try {
      const res = await fetch(u);
      const body = (await res.text()).trim();
      console.log(`   ${url.trim()} -> HTTP ${res.status} ${body === "THU" ? "(trả đúng challenge)" : "(" + body.slice(0, 40) + ")"}`);
      if (res.status !== 200 || body !== "THU") {
        console.log("   >>> Meta sẽ KHÔNG đẩy tin về được. Kiểm cloudflared còn chạy không.");
      }
    } catch (e) {
      console.log("   không gọi được:", e.message);
      console.log("   >>> Hầm chết. Dựng lại rồi chạy: npm run tunnel:sync -- --apply");
    }
  }

  console.log(`\nXong. Bước tiếp: node chay_mfs.js --ai`);
})().catch(e => { console.error("Hỏng:", e.stack || e.message); process.exit(1); });
