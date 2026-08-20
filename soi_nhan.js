// ============================================================================
// soi_nhan.js  —  SOI: hội thoại này AI sẽ gắn nhãn gì, câu nào nhường NGƯỜI THẬT?
// ----------------------------------------------------------------------------
// KHÔNG đụng bot đang chạy. Chỉ ĐỌC:
//   1) Danh sách thẻ của page (id -> tên)  — biết thẻ "người thật" nào tồn tại.
//   2) Thẻ HIỆN TẠI đang gắn trên hội thoại — sự thật (ground truth).
//   3) Vài tin cuối của hội thoại — lấy đúng câu khách nhắn.
//   4) Nạp NGUYÊN VĂN các hàm phân loại (gate) trong bot_worker_api_v3.js của bạn,
//      chạy từng câu khách qua -> in ra: bot TỰ TRẢ hay NHƯỜNG NGƯỜI THẬT (thẻ nào).
// Chạy:  node soi_nhan.js  [conversation_id]
//   (không truyền -> mặc định hội thoại trong link bạn gửi)
// ============================================================================
const fs = require("fs");
require("dotenv").config();

const pageReg = require("./page_registry");
let CFG = {};
try { CFG = require("./order_config"); } catch (_) {}
const convTags = (() => { try { return require("./conversation_tags"); } catch (_) { return null; } })();

// Hội thoại mặc định = c_id trong link bạn gửi
const CONV_ID = (process.argv[2] || "1468690110033030_6905067382943473").trim();

// Thẻ GIỮ (AI đứng ngoài) theo bot_worker_api_v3.js: HOLD_TAG_IDS = [183,185,166,177]
const HOLD_IDS = [183, 185, 166, 177];
const XL_ANH_ID = 184; // KHÔNG chặn, chỉ báo "nợ ảnh"
const NAME_HINT = {
  183: "AI - CHỜ XL (chờ thông tin) — NGƯỜI THẬT xử lý, AI đứng ngoài",
  184: "AI- XL ảnh (ảnh nhận không ra) — KHÔNG chặn, NV bổ sung ảnh",
  185: "AI - ĐƠN ƯU TIÊN — giữ",
  166: "Hàng đổi — giữ",
  177: "Đang hoàn — giữ",
  182: "AI chốt (đầu vào cần lên đơn)",
};

const line = (c = "═") => console.log(c.repeat(72));
async function getJson(url) {
  try { const r = await fetch(url); return await r.json().catch(() => null); }
  catch (e) { return { __error: e.message }; }
}

// ---- Trích NGUYÊN VĂN 1 hàm theo tên từ source (đếm ngoặc để lấy đủ thân) ----
function extractFn(src, name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\(", "g");
  const m = re.exec(src);
  if (!m) return null;
  let i = src.indexOf("{", m.index);
  if (i < 0) return null;
  let depth = 0, inS = null, esc = false;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (inS) {
      if (esc) { esc = false; }
      else if (ch === "\\") esc = true;
      else if (ch === inS) inS = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inS = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return src.slice(m.index, j + 1); }
  }
  return null;
}

// Các gate quyết định NHƯỜNG NGƯỜI THẬT hay bot tự trả (lấy đúng tên trong bot_worker_api_v3.js)
const GATE_NAMES = [
  "asksInspectBeforePay", // xem/đồng kiểm trước khi trả tiền -> bot TỰ TRẢ
  "asksTryOn",            // mặc thử -> bot TỰ TRẢ
  "asksWhyNoTryOn",       // vì sao ko được thử -> bot TỰ TRẢ
  "asksReturnPolicy",     // chính sách đổi/trả -> bot TỰ TRẢ
  "fearsTrustOrScam",     // sợ lừa/bom/khác hình -> bot TRẤN AN (COD)
  "asksShopComparison",   // so sánh shop khác / hàng thật-giả -> NGƯỜI THẬT (183)
  "saysBotMistake",       // "bot trả sai/lạc đề" -> NGƯỜI THẬT (183)
  "saysImpatientOrSlow",  // sốt ruột/chê chậm -> NGƯỜI THẬT (183)
  "isCheckLaterReply",    // (áp cho CÂU BOT) "chờ kiểm tra" -> tự gắn 183
];
// Gate nào = nhường người thật (gắn 183)
const HANDOFF_GATES = new Set(["asksShopComparison", "saysBotMistake", "saysImpatientOrSlow"]);
const AUTO_GATES = { // gate -> mô tả bot tự trả
  asksInspectBeforePay: "bot TỰ TRẢ: khẳng định được kiểm tra hàng trước khi thanh toán",
  asksTryOn: "bot TỰ TRẢ: được kiểm tra nhưng chưa hỗ trợ mặc thử",
  asksWhyNoTryOn: "bot TỰ TRẢ: giải thích vì sao chưa cho mặc thử",
  asksReturnPolicy: "bot TỰ TRẢ: chính sách đổi 15 ngày",
  fearsTrustOrScam: "bot TỰ TRẢ: trấn an COD (kiểm hàng trước khi trả tiền)",
};

(async () => {
  line();
  console.log("SOI NHÃN HỘI THOẠI");
  console.log("conversation_id :", CONV_ID);
  line();

  // token cho page của hội thoại này
  try { await pageReg.init(); } catch (e) { console.log("[pages] init lỗi:", e.message); }
  const pid = pageReg.pageIdFromConv(CONV_ID) || CFG.PAGE_ID || process.env.PANCAKE_PAGE_ID;
  const tok = pageReg.tokenForConv(CONV_ID) || CFG.PAGE_TOKEN || process.env.PANCAKE_PAGE_ACCESS_TOKEN;
  console.log("page_id         :", pid);
  console.log("có token?       :", tok ? "CÓ" : "KHÔNG (thiếu token -> phần Pancake sẽ trống)");
  line("─");

  // (1) DANH SÁCH THẺ CỦA PAGE
  const tagName = {};
  if (pid && tok) {
    const data = await getJson(`https://pages.fm/api/public_api/v1/pages/${pid}/tags?page_access_token=${tok}`);
    const tags = (data && (data.tags || data.data)) || (Array.isArray(data) ? data : []);
    console.log("【1】 DANH SÁCH THẺ CỦA PAGE (id -> tên):");
    if (Array.isArray(tags) && tags.length) {
      for (const t of tags) {
        const id = t.id != null ? Number(t.id) : Number(t.tag_id);
        const nm = t.text || t.name || t.title || "(không tên)";
        tagName[id] = nm;
        const flag = HOLD_IDS.includes(id) ? "  <== THẺ GIỮ (NGƯỜI THẬT xử lý, AI đứng ngoài)"
                   : id === XL_ANH_ID ? "  <== XL ảnh (không chặn)"
                   : "";
        console.log(`   id=${id}\t| ${nm}${flag}`);
      }
    } else {
      console.log("   (không đọc được danh sách thẻ) phản hồi:", JSON.stringify(data).slice(0, 300));
    }
  } else {
    console.log("【1】 Bỏ qua (thiếu page/token).");
  }
  line("─");

  // (2) THẺ HIỆN TẠI TRÊN HỘI THOẠI  == SỰ THẬT
  console.log("【2】 THẺ ĐANG GẮN TRÊN HỘI THOẠI NÀY (sự thật):");
  let curIds = [];
  if (pid && tok) {
    const base = `https://pages.fm/api/public_api/v1/pages/${pid}/conversations/${CONV_ID}`;
    let conv = await getJson(`${base}/tags?page_access_token=${tok}`);
    if (!conv || conv.__error || (!conv.tags && !conv.tag_ids && !conv.conversation_tags && !conv.tag_histories))
      conv = await getJson(`${base}?page_access_token=${tok}`);
    const co = (conv && (conv.conversation || conv.data)) || conv || {};
    curIds = convTags ? convTags.extractTagIds(co) : [];
    if (!curIds.length && Array.isArray(co.tags)) curIds = co.tags.map(x => Number(x && x.id != null ? x.id : x)).filter(n => !isNaN(n));
    if (curIds.length) {
      for (const id of curIds) {
        const nm = tagName[id] || NAME_HINT[id] || "(?)";
        const flag = HOLD_IDS.includes(id) ? "  ===> ĐANG NHƯỜNG NGƯỜI THẬT"
                   : id === XL_ANH_ID ? "  (nợ ảnh, không chặn)" : "";
        console.log(`   • id=${id}  ${nm}${flag}`);
      }
      const holding = curIds.filter(id => HOLD_IDS.includes(id));
      console.log(holding.length
        ? `\n   => KẾT: hội thoại ĐANG có thẻ giữ [${holding.join(", ")}] -> AI ĐỨNG NGOÀI, cần người thật.`
        : "\n   => KẾT: chưa có thẻ giữ nào -> AI vẫn đang tự xử.");
    } else {
      console.log("   (chưa gắn thẻ nào, hoặc không đọc được)");
    }
  } else console.log("   Bỏ qua (thiếu page/token).");
  line("─");

  // (3) LẤY VÀI TIN CUỐI
  console.log("【3】 TIN NHẮN CUỐI (K=khách, S=shop/bot):");
  let inbound = [];   // câu KHÁCH
  let botReplies = []; // câu SHOP/BOT (để soi 'chờ kiểm tra' tự gắn 183)
  if (pid && tok) {
    const md = await getJson(`https://pages.fm/api/public_api/v1/pages/${pid}/conversations/${CONV_ID}/messages?page_access_token=${tok}`);
    let msgs = (md && (md.messages || md.data)) || (Array.isArray(md) ? md : []);
    if (Array.isArray(msgs)) {
      // chuẩn hoá + sắp theo thời gian tăng dần, lấy 14 tin cuối
      msgs = msgs.map(m => ({
        text: (m.message || m.original_message || m.content || m.text || "").toString(),
        fromPage: (m.is_from_page === true) || (m.from && m.from.is_page === true) || m.type === "page",
        at: m.inserted_at || m.created_time || m.updated_at || ""
      })).filter(m => m.text.trim());
      msgs.sort((a, b) => String(a.at).localeCompare(String(b.at)));
      const tail = msgs.slice(-14);
      for (const m of tail) {
        const who = m.fromPage ? "S" : "K";
        console.log(`   [${who}] ${m.text.replace(/\s+/g, " ").slice(0, 90)}`);
        if (m.fromPage) botReplies.push(m.text); else inbound.push(m.text);
      }
    } else console.log("   (không đọc được tin nhắn)", JSON.stringify(md).slice(0, 200));
  } else {
    // Không có token -> dùng đúng 3 câu khách trong ảnh bạn gửi để vẫn soi được logic
    inbound = ["Co may mau vay e", "Mau xanh y hinh dung k e", "Co dc ktra hang k e"];
    console.log("   (thiếu token) -> dùng 3 câu khách trong ảnh:");
    inbound.forEach(t => console.log("   [K] " + t));
  }
  line("─");

  // (4) NẠP GATE THẬT TỪ bot_worker_api_v3.js, CHẠY TỪNG CÂU
  console.log("【4】 CHẠY TỪNG CÂU KHÁCH QUA GATE THẬT CỦA BOT:");
  const gate = {};
  let srcOk = false;
  try {
    const src = fs.readFileSync("./bot_worker_api_v3.js", "utf8");
    srcOk = true;
    for (const nm of GATE_NAMES) {
      const body = extractFn(src, nm);
      if (!body) { console.log(`   ! không tìm thấy hàm ${nm} (bỏ qua)`); continue; }
      try { gate[nm] = eval("(" + body + ")"); }
      catch (e) { console.log(`   ! eval ${nm} lỗi: ${e.message}`); }
    }
  } catch (e) {
    console.log("   ! Không đọc được bot_worker_api_v3.js:", e.message,
      "\n   -> đặt soi_nhan.js CÙNG thư mục C:\\AI_HTK_BOT_V5 rồi chạy lại.");
  }

  const runGates = (txt) => {
    const hit = [];
    for (const nm of GATE_NAMES) {
      if (nm === "isCheckLaterReply") continue; // gate này áp cho CÂU BOT, xử riêng
      if (typeof gate[nm] !== "function") continue;
      try { if (gate[nm](txt)) hit.push(nm); } catch (_) {}
    }
    return hit;
  };

  if (srcOk && inbound.length) {
    inbound.forEach((txt, k) => {
      const hits = runGates(txt);
      console.log(`\n   Câu K#${k + 1}: "${txt.replace(/\s+/g, " ").slice(0, 70)}"`);
      if (!hits.length) {
        console.log("      -> không khớp gate handoff/auto nào ở đây -> đi tiếp các nhánh khác (giá/size/AI...).");
      } else {
        for (const h of hits) {
          if (HANDOFF_GATES.has(h))
            console.log(`      -> [${h}] NHƯỜNG NGƯỜI THẬT: gắn thẻ AI-CHỜ XL (183) + chuyển CHƯA ĐỌC.`);
          else
            console.log(`      -> [${h}] ${AUTO_GATES[h] || "bot tự trả"} (KHÔNG gắn người thật).`);
        }
      }
    });
  }

  // Soi câu BOT: có câu "chờ kiểm tra" nào -> tự gắn 183 không
  if (srcOk && typeof gate.isCheckLaterReply === "function" && botReplies.length) {
    const waited = botReplies.filter(r => { try { return gate.isCheckLaterReply(r); } catch (_) { return false; } });
    if (waited.length) {
      console.log(`\n   * Có ${waited.length} câu BOT mang nghĩa "chờ kiểm tra" -> mỗi câu này TỰ gắn AI-CHỜ XL (183):`);
      waited.forEach(r => console.log(`      - "${r.replace(/\s+/g, " ").slice(0, 70)}"`));
    }
  }

  line();
  console.log("TÓM TẮT");
  console.log("• Nhãn DUY NHẤT nghĩa 'cần NGƯỜI THẬT' cho ca tư vấn text = AI - CHỜ XL (id 183),");
  console.log("  luôn kèm chuyển hội thoại về CHƯA ĐỌC. (Thẻ 184 'XL ảnh' KHÔNG chặn.)");
  console.log("• Nó được gắn khi: bot nói 'chờ kiểm tra', hoặc khách so sánh shop/nghi hàng thật-giả,");
  console.log("  báo bot trả sai, sốt ruột chê chậm, hỏi chất liệu/co giãn mà sheet trống, ảnh không nhận ra...");
  console.log("• Xem mục 【2】 để biết hội thoại NÀY hiện đã có 183 chưa (đó là câu trả lời chắc chắn nhất).");
  line();
})();
