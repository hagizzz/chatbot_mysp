#!/usr/bin/env node
// ============================================================================
// test/thu_them_ca_vang.js — KÉO HỘI THOẠI THẬT TỪ PANCAKE ĐỂ BỔ SUNG CA VÀNG
// ----------------------------------------------------------------------------
// Log pm2 chỉ giữ 20.000 dòng cuối nên trích từ log không đủ 150–200 ca. Lệnh này
// lấy thẳng hội thoại thật về, gắn nhãn bằng CHÍNH tầng hiểu ý đang chạy, rồi
// đóng băng làm mốc so sánh cho các bản sau.
//
//   node test/thu_them_ca_vang.js 200        # lấy tới khi đủ 200 ca
//   node test/thu_them_ca_vang.js 200 --ai   # gọi thêm AI để có cả nhãn AI (tốn tiền)
//
// CHỈ ĐỌC. Không gửi tin, không gắn thẻ, không tạo đơn.
// CHẠY TRÊN MÁY CÓ .env THẬT.
//
// RIÊNG TƯ: ca vàng chứa tin nhắn khách thật -> tự che số điện thoại và tên riêng
// trước khi ghi ra file. Đừng gỡ phần che này.
// ============================================================================
require("../env_boot");
const fs = require("fs");
const path = require("path");
const { getConversations, getMessages, normalizeMessages } = require("../loi/pancake/pancake_reader");
const { detectIntent } = require("../loi/ai/intent_detector");
const { routeBatch } = require("../loi/ai/intent_router");

const MUC_TIEU = Number(process.argv.find(a => /^\d+$/.test(a)) || 200);
const DUNG_AI = process.argv.includes("--ai");
const F = path.join(__dirname, "ca_vang", "nhan_y_dinh.json");

const { che, cheConvId } = require("./che_du_lieu");

(async () => {
  const cu = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F, "utf8")) : [];
  const daCo = new Set(cu.map(c => String(c.tinKhach || "").toLowerCase().trim()));
  const them = [];

  console.log(`Đang có ${cu.length} ca. Mục tiêu ${MUC_TIEU}.`);

  let trang = 1;
  while (cu.length + them.length < MUC_TIEU && trang <= 12) {
    const r = await getConversations(trang);
    if (!r || !r.success || !(r.conversations || []).length) {
      console.log(`Trang ${trang}: không lấy được (${(r && r.reason) || "?"}) -> dừng.`);
      break;
    }
    for (const c of r.conversations) {
      if (cu.length + them.length >= MUC_TIEU) break;
      let tin;
      try { tin = normalizeMessages(((await getMessages(c.id)) || {}).messages || []); }
      catch { continue; }
      const cua = tin.filter(x => x.sender === "customer" && String(x.text || "").trim());
      for (const t of cua.slice(-3)) {
        const text = che(String(t.text).trim());
        const khoa = text.toLowerCase();
        if (!khoa || khoa.length < 3 || daCo.has(khoa)) continue;
        daCo.add(khoa);
        const r1 = detectIntent(text);
        let r2 = null;
        try { r2 = routeBatch([text]); } catch (_) {}
        const ca = {
          nguon: "pancake",
          conversationId: cheConvId(String(c.id)),
          tinKhach: text,
          mong: {
            nhanRegex: r1,
            nhanRouter: r2 && (r2.nhan || r2.kind || r2.label) || null,
            doChac: r2 && (r2.diem ?? r2.score) || null,
            nhanAI: null
          },
          boiCanh: { kenh: String(c.type || "").toUpperCase().includes("COMMENT") ? "COMMENT" : "INBOX" }
        };
        if (DUNG_AI) {
          try {
            const { classifyIntent } = require("../loi/ai/ai_intent");
            const lab = await classifyIntent({ text });
            if (lab && lab.ok) ca.mong.nhanAI = lab.kind;
          } catch (_) {}
        }
        them.push(ca);
        if (cu.length + them.length >= MUC_TIEU) break;
      }
    }
    console.log(`  ...trang ${trang}: tổng ${cu.length + them.length}/${MUC_TIEU}`);
    trang++;
  }

  const ra = cu.concat(them);
  fs.writeFileSync(F, JSON.stringify(ra, null, 2), "utf8");
  console.log(`\nĐã thêm ${them.length} ca. Tổng ${ra.length} -> ${path.relative(process.cwd(), F)}`);
  console.log(`Xem lại file (số điện thoại đã che) rồi commit vào git làm mốc.`);
  console.log(`Chạy đối chiếu:  npm test`);
})();
