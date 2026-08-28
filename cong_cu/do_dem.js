#!/usr/bin/env node
// ============================================================================
// do_dem.js — PROMPT CÓ ĐANG ĐƯỢC ĐỆM KHÔNG?
// ----------------------------------------------------------------------------
//   node do_dem.js            đo cả ba tầng AI
//   node do_dem.js ai_intent  đo một tầng
//
// VÌ SAO CẦN
// 97% chi phí AI nằm ở TOKEN VÀO, và ~38% token vào là hai khối prompt giống hệt
// nhau ở mọi lượt (đo 27/08/2026: ai_intent 8.980 token, ai_quyet 2.310).
// Nhà cung cấp giảm mạnh phần prompt lặp lại, nhưng CHỈ KHI khối tĩnh nằm ở ĐẦU
// chuỗi và không đổi. Thêm một dòng biến vào đầu prompt là mất sạch phần giảm —
// mà không có gì báo, chỉ hoá đơn tự đội lên.
//
// Đo thật 27/08/2026: lượt đầu 0%, từ lượt hai trở đi 98%. Tức đệm ĐANG chạy.
// Chạy lại tệp này sau mỗi lần sửa prompt để biết mình có vừa làm hỏng nó không.
//
// LƯU Ý ĐỌC KẾT QUẢ: lượt ĐẦU luôn 0% (đệm chưa có gì). Phải nhìn lượt 2-3.
// Đệm cũng nguội sau vài phút không dùng, nên chạy lúc bot đang vắng khách thì
// lượt đầu của khách tiếp theo vẫn trả giá đầy đủ — đó là bình thường.
//
// TỐN TIỀN: mỗi tầng gọi thật 3 lần. Tổng khoảng $0,01.
// ============================================================================
"use strict";

const __goc = require("path").join(__dirname, "..");
require("../env_boot");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const { GIA } = require("../loi/tien_ich/turn_log");

const MODEL = "gpt-4.1-mini";
const SO_LAN = 3;

// Lấy khối SYS THẲNG từ mã nguồn — đo đúng cái đang chạy, không phải bản chép tay.
function laySYS(tep) {
  const src = fs.readFileSync(path.join(__goc, tep), "utf8");
  const i = src.indexOf("const SYS = `");
  if (i < 0) return null;
  const j = src.indexOf("`;", i);
  return src.slice(i + 13, j)
    // Chỗ nội suy duy nhất trong SYS là danh sách nhãn — thay bằng chuỗi giả cùng
    // vai trò; độ dài lệch vài token không đổi kết luận đệm/không đệm.
    .replace(/\$\{[^}]*\}/g, "NHAN_A|NHAN_B|NHAN_C");
}

const TANG = {
  // Đường dẫn tính từ THƯ MỤC GỐC (__goc), nên phải kèm "loi/" sau đợt chia thư mục.
  ai_intent: () => laySYS("loi/ai/ai_intent.js"),
  ai_quyet:  () => laySYS("loi/ai/ai_quyet.js"),
  // reasoning_engine dựng prompt trong hàm (kịch bản Doc + luật Sheet), không có
  // hằng SYS -> dựng lại đúng phần TĨNH của nó: Doc + luật, hai thứ chỉ đổi mỗi 5 phút.
  reasoning_engine: async () => {
    const kl = require("../loi/ai/knowledge_loader");
    const script = await kl.getScript().catch(() => "");
    const rules = await kl.getAgentRules().catch(() => []);
    if (!script && !rules.length) return null;
    return `================ KỊCH BẢN CHÍNH ================\n${script}\n` +
           `================ LUẬT TÌNH HUỐNG ================\n${JSON.stringify(rules)}`;
  }
};

const chon = process.argv.slice(2).filter(a => !a.startsWith("--"));
const danhSach = chon.length ? chon : Object.keys(TANG);

(async () => {
  if (!process.env.OPENAI_API_KEY) {
    console.log("Thiếu OPENAI_API_KEY trong .env.");
    process.exit(1);
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const gia = GIA[MODEL] || { vao: 0, vaoDem: 0, ra: 0 };

  for (const ten of danhSach) {
    if (!TANG[ten]) { console.log(`Không biết tầng "${ten}". Có: ${Object.keys(TANG).join(", ")}`); continue; }
    const SYS = await TANG[ten]();
    if (!SYS) { console.log(`\n${ten}: không lấy được khối tĩnh -> bỏ qua.`); continue; }

    console.log(`\n=== ${ten} ===`);
    let cuoi = null;
    for (let n = 1; n <= SO_LAN; n++) {
      const r = await client.chat.completions.create({
        model: MODEL, temperature: 0, max_tokens: 5,
        messages: [{ role: "system", content: SYS },
                   { role: "user", content: 'Tin khách: "váy này bao nhiêu" — trả về đúng 1 từ.' }]
      });
      const u = r.usage || {};
      const vao = u.prompt_tokens || 0;
      const dem = (u.prompt_tokens_details || {}).cached_tokens || 0;
      const pt = vao ? Math.round((dem / vao) * 100) : 0;
      console.log(`  lần ${n}: vào=${vao} | được đệm=${dem} (${pt}%)`);
      cuoi = { vao, dem };
    }
    if (cuoi) {
      const day = (cuoi.vao / 1e6) * gia.vao;
      const that = ((cuoi.vao - cuoi.dem) / 1e6) * gia.vao + (cuoi.dem / 1e6) * (gia.vaoDem ?? gia.vao);
      const tiet = day ? Math.round((1 - that / day) * 100) : 0;
      console.log(`  -> giá đầy đủ $${day.toFixed(5)} | thực trả $${that.toFixed(5)} | tiết kiệm ${tiet}%`);
      if (cuoi.dem === 0) {
        console.log("  ⚠ KHÔNG đệm được gì ở lượt cuối. Xem có biến nào lọt vào ĐẦU prompt không.");
      }
    }
  }
  console.log("\nLượt 1 luôn 0% (đệm chưa có gì) — nhìn lượt 2-3 mới đúng.");
})().catch(e => { console.error("LỖI:", e.message); process.exit(1); });
