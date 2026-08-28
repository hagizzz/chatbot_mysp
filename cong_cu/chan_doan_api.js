// chan_doan_api.js — xem RÕ Pancake trả gì: HTTP status + headers + body (v1 & v2).
// Chạy: node chan_doan_api.js
require("dotenv").config();
const https = require("https");

const id  = process.env.PANCAKE_PAGE_ID;
const tok = process.env.PANCAKE_PAGE_ACCESS_TOKEN;

console.log("====== CHẨN ĐOÁN API PANCAKE ======");
console.log("PAGE_ID    :", JSON.stringify(id));
console.log("TOKEN dài  :", (tok || "").length, "ký tự |", (tok || "").slice(0, 14), "...", (tok || "").slice(-8));
if (!id || !tok) { console.log("!!! Thiếu PAGE_ID/TOKEN trong .env"); process.exit(1); }

function thu(nhan, url) {
  return new Promise((done) => {
    console.log("\n----- " + nhan + " -----");
    const req = https.get(url, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => {
        console.log("HTTP STATUS :", r.statusCode, r.statusMessage || "");
        // headers hữu ích để biết throttle / chặn
        const h = r.headers || {};
        const pick = ["retry-after", "x-ratelimit-remaining", "x-ratelimit-limit", "x-deny-reason", "x-request-id", "content-type", "server"];
        for (const k of pick) if (h[k] != null) console.log("  " + k + ":", h[k]);
        console.log("BODY (300 ký tự đầu):", d ? d.slice(0, 300) : "(RỖNG)");
        try {
          const j = JSON.parse(d);
          if (j && j.success === false) console.log(">> JSON success=false:", j.message, "| error_code:", j.error_code);
          else if (j) console.log(">> JSON OK. số hội thoại:", (j.conversations || j.data || []).length);
        } catch (_) { console.log(">> Body KHÔNG phải JSON."); }
        done();
      });
    });
    req.on("error", (e) => { console.log("LỖI MẠNG:", e.message); done(); });
    req.setTimeout(8000, () => { console.log("TIMEOUT (8s) - không phản hồi."); req.destroy(); done(); });
  });
}

(async () => {
  await thu("V2 conversations", `https://pages.fm/api/public_api/v2/pages/${id}/conversations?page_access_token=${tok}`);
  await thu("V1 conversations", `https://pages.fm/api/public_api/v1/pages/${id}/conversations?page_access_token=${tok}`);
  await thu("V1 page info",     `https://pages.fm/api/public_api/v1/pages/${id}?page_access_token=${tok}`);
  console.log("\n====== XONG. Copy nguyên phần kết quả này gửi lại. ======");
})();
