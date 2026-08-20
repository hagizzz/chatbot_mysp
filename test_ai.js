// ============================================================
// test_ai.js — KIỂM TRA AI (OpenAI) CÓ NỐI ĐƯỢC KHÔNG
// Chạy: node test_ai.js
// - In ra câu AI ĐỊNH trả lời cho 1 câu hỏi mẫu (không đụng số).
// - Chạy luôn bộ soi reply_guard để mày thấy PASS/BLOCK.
// - Lỗi key/mạng -> in rõ lý do.
// KHÔNG gửi gì cho khách. Chỉ test cục bộ.
// ============================================================
require("dotenv").config();

(async () => {
  console.log("AI_REPLY_MODE =", JSON.stringify(process.env.AI_REPLY_MODE || "(chưa đặt)"));
  console.log("OPENAI_API_KEY =", process.env.OPENAI_API_KEY ? "(có, " + process.env.OPENAI_API_KEY.slice(0, 7) + "...)" : "(THIẾU!)");
  console.log("------------------------------------------------------------");

  let reasoning, vetAdvisoryReply;
  try { ({ reasoning } = require("./reasoning_engine")); }
  catch (e) { console.log("KHÔNG nạp được reasoning_engine.js:", e.message); process.exit(1); }
  try { ({ vetAdvisoryReply } = require("./reply_guard")); }
  catch (_) { vetAdvisoryReply = null; }

  // Câu hỏi mẫu KHÔNG có khuôn code (tư vấn chữ) -> ép AI phải nghĩ.
  const conversation = [
    { sender: "customer", type: "text", text: "Váy này vải mặc mùa hè có nóng không em, có bị nhăn nhiều không?" }
  ];
  const product = { name: "Pora", code: "MGVVX6076", price: 850000, size: "S" };
  const state = { intent: null, customerName: "Test", quotedProducts: ["MGVVX6076"], memory: { size: null, phone: null, address: null } };

  console.log('Câu khách (test): "' + conversation[0].text + '"');
  console.log("Đang gọi AI (gpt-4.1-mini)...\n");

  const t0 = Date.now();
  try {
    const out = await reasoning({ conversation, product, state });
    const ms = Date.now() - t0;
    console.log("✅ AI NỐI ĐƯỢC. (" + ms + "ms)");
    console.log("   action :", out && out.action);
    console.log("   reply  :", JSON.stringify(out && out.reply));
    if (vetAdvisoryReply && out && out.reply) {
      const v = vetAdvisoryReply(out.reply);
      console.log("   bộ soi :", v.allow ? "PASS (câu sạch, được phép tư vấn)" : "BLOCK -> " + (v.reasons || []).join(","));
    }
    console.log("\n=> Key OpenAI hoạt động. Khi bật AI_REPLY_MODE=on, câu như trên sẽ được gửi (nếu bộ soi PASS).");
  } catch (e) {
    console.log("❌ AI KHÔNG NỐI ĐƯỢC.");
    console.log("   Lỗi:", e && (e.message || e));
    if (e && e.status) console.log("   HTTP status:", e.status);
    console.log("\nThường do: OPENAI_API_KEY sai/hết hạn/hết credit, hoặc máy chặn mạng ra api.openai.com.");
    process.exit(1);
  }
})();
