// test_read.js — kiểm tra BỘ AI ĐỌC TIN ĐẦU TIÊN (ai_intent.js) với key thật.
// Chạy: node test_read.js
require("dotenv").config();
const { classifyIntent } = require("./ai_intent");

const CASES = [
  { text: "L em", ctx: { lockedProductName: "Corae", lastShopLine: "Dạ Set Corae giá 990.000đ ạ. Chị thường mặc size bao nhiêu" } },
  { text: "21A lê thị kinh nhà bè", ctx: { lockedProductName: "Corae" } },
  { text: "Triem tra được ko", ctx: { lockedProductName: "Corae" } },
  { text: "quan day thun ha e", ctx: { lockedProductName: "Corae" } },
  { text: "B cho m bảng size ah", ctx: { lockedProductName: "Gabrielles" } },
  { text: "bao nhiêu vậy shop", ctx: {} },
  { text: "lấy mẫu này nha", ctx: { lockedProductName: "Plena" } },
  { text: "0901234567 nguyễn văn a 12 lê lợi q1", ctx: {} },
  { text: "alo shop ơi", ctx: {} },
  { text: "vải có nóng không em", ctx: { lockedProductName: "Pora" } }
];

(async () => {
  console.log("AI_READ_FIRST =", JSON.stringify(process.env.AI_READ_FIRST || "(chưa đặt -> mặc định on)"));
  console.log("OPENAI_API_KEY =", process.env.OPENAI_API_KEY ? "(có)" : "(THIẾU!)");
  console.log("-".repeat(70));
  for (const c of CASES) {
    const t0 = Date.now();
    const r = await classifyIntent({ text: c.text, ...c.ctx });
    const ms = Date.now() - t0;
    if (!r.ok) { console.log(`❌ "${c.text}" -> AI KHÔNG trả lời được (${ms}ms)`); continue; }
    console.log(`✅ "${c.text}"  (${ms}ms)`);
    console.log(`     kind=${r.kind} | size=${r.size || "-"} | addr=${r.is_address} | order=${r.wants_order} | price=${r.asks_price} | chart=${r.asks_size_chart}`);
  }
  console.log("-".repeat(70));
  console.log("=> Mong đợi: 'L em'->SIZE size=L | '21A...'->ADDRESS addr=true order=true | 'cho bảng size'->SIZE_CHART chart=true | 'vải nóng'->MATERIAL_QA");
})();
