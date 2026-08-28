// TEST đọc nội dung ad qua Facebook Graph API.
// Chạy:  node test_ad.js 120254526531590550
// Cần .env có dòng:  FB_ADS_TOKEN=EAA....
try { require("dotenv").config(); } catch (_) {}
const https = require("https");

const TOKEN = process.env.FB_ADS_TOKEN || "";
const adId = process.argv[2] || "120254526531590550";
const VER = "v21.0";

if (!TOKEN) { console.error("THIẾU FB_ADS_TOKEN trong .env"); process.exit(1); }

const fields = "name,effective_status,creative{name,title,body,object_story_spec,asset_feed_spec}";
const url = `https://graph.facebook.com/${VER}/${adId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(TOKEN)}`;

https.get(url, (res) => {
  let buf = "";
  res.on("data", d => buf += d);
  res.on("end", () => {
    console.log("HTTP", res.statusCode);
    try {
      const j = JSON.parse(buf);
      console.log(JSON.stringify(j, null, 2));
      // rút gọn các chỗ hay chứa TÊN MẪU để dễ nhìn
      const cr = j.creative || {};
      const oss = cr.object_story_spec || {};
      const link = oss.link_data || {};
      const vid = oss.video_data || {};
      console.log("\n==== TÓM TẮT ====");
      console.log("ad.name      :", j.name || "-");
      console.log("creative.name:", cr.name || "-");
      console.log("title        :", cr.title || link.name || vid.title || "-");
      console.log("body/message :", (cr.body || link.message || vid.message || "-").slice(0, 120));
    } catch (e) {
      console.log("Không parse được JSON. Raw:\n", buf.slice(0, 800));
    }
  });
}).on("error", e => console.error("Lỗi mạng:", e.message));
