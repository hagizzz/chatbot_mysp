// ============================================================================
// kiem_tra_lendon.js — KIỂM TRA TRƯỚC KHI CHẠY LÊN ĐƠN (preflight)
// ----------------------------------------------------------------------------
// Chạy:  node kiem_tra_lendon.js      (hoặc bấm đúp kiem_tra_lendon.bat)
//
// Dùng LẠI đúng các module mà order_worker.js dùng -> nếu file này báo "SẴN SÀNG"
// thì order_worker.js chạy được. Kiểm 5 thứ:
//   1) Cấu hình .env có đủ chưa (POS key/shop, Page id/token, thẻ).
//   2) POS api_key SỐNG chưa + shop_id có ĐÚNG trong danh sách shop không.
//   3) Page token SỐNG chưa (đọc thử hội thoại như worker) + đếm "AI chốt".
//   4) Các THẺ (AI chốt / AI- Đã xác nhận / AI- CHỜ XL) có TỒN TẠI đúng id không.
//   5) NẠP THỬ sản phẩm POS (đây là chỗ hay hỏng nhất: tra mã->biến thể).
// KHÔNG tạo đơn, KHÔNG đổi thẻ, KHÔNG ghi gì. Chỉ ĐỌC để kiểm tra.
// ============================================================================
require("dotenv").config();

const cfg = require("../loi/don/order_config");

const PASS = "✅"; const FAIL = "❌"; const WARN = "⚠️ ";
let hardFail = false;   // có lỗi CHẶN (không chạy thật được)
let softWarn = false;   // có cảnh báo (chạy được nhưng nên xem lại)

function line() { console.log("-".repeat(60)); }
function mask(s) { s = String(s || ""); return s.length <= 10 ? s : s.slice(0, 6) + "..." + s.slice(-4); }

(async () => {
  console.log("============================================================");
  console.log("   KIỂM TRA TRƯỚC KHI LÊN ĐƠN (preflight) — chỉ ĐỌC");
  console.log("============================================================");

  // ---------- 1) CẤU HÌNH .env ----------
  line(); console.log("1) CẤU HÌNH .env");
  const need = {
    PANCAKE_PAGE_ID: cfg.PAGE_ID,
    PANCAKE_PAGE_ACCESS_TOKEN: cfg.PAGE_TOKEN,
    PANCAKE_POS_API_KEY: cfg.POS_API_KEY,
    PANCAKE_POS_SHOP_ID: cfg.POS_SHOP_ID,
  };
  for (const [k, v] of Object.entries(need)) {
    if (v) console.log(`  ${PASS} ${k} = ${mask(v)}`);
    else { console.log(`  ${FAIL} ${k} = (TRỐNG) -> bắt buộc phải điền vào .env`); hardFail = true; }
  }
  if (/\s/.test(String(cfg.PAGE_TOKEN || ""))) {
    console.log(`  ${FAIL} PAGE token có KHOẢNG TRẮNG/xuống dòng -> hỏng, dán lại liền 1 dòng.`); hardFail = true;
  }
  if (cfg.TAG_AI_DA_XACNHAN == null) {
    console.log(`  ${WARN}PANCAKE_TAG_AI_DA_XACNHAN chưa khai -> sẽ lên đơn nhưng KHÔNG tự đổi thẻ.`); softWarn = true;
  } else console.log(`  ${PASS} PANCAKE_TAG_AI_DA_XACNHAN = ${cfg.TAG_AI_DA_XACNHAN}`);
  console.log(`  •  TAG_AI_CHOT (đầu vào) = ${cfg.TAG_AI_CHOT} | TAG_AI_CHO_XL = ${cfg.TAG_AI_CHO_XL}`);
  console.log(`  •  POS_ORDER_STATUS = ${cfg.POS_ORDER_STATUS} (0=đơn nháp/chờ xác nhận; 1=xác nhận luôn)`);
  console.log(`  •  DRY_RUN = ${cfg.DRY_RUN}  ${cfg.DRY_RUN ? "(CHẠY THỬ: KHÔNG tạo đơn thật)" : "(CHẠY THẬT: SẼ tạo đơn POS)"}`);

  if (!need.PANCAKE_POS_API_KEY || !need.PANCAKE_POS_SHOP_ID) {
    line(); console.log(`${FAIL} Thiếu POS api_key/shop_id -> dừng kiểm tra (không gọi được POS).`);
    return done();
  }

  // ---------- 2) POS api_key + shop_id ----------
  line(); console.log("2) POS api_key + shop_id (pos.pages.fm)");
  try {
    const { getShops } = require("../loi/don/pos_client");
    const shops = await getShops();
    if (!Array.isArray(shops) || !shops.length) {
      console.log(`  ${FAIL} Không lấy được shop nào -> api_key SAI hoặc chưa kích hoạt.`); hardFail = true;
    } else {
      const me = shops.find(s => String(s.id) === String(cfg.POS_SHOP_ID));
      console.log(`  ${PASS} api_key SỐNG | thấy ${shops.length} shop.`);
      if (me) console.log(`  ${PASS} shop_id ${cfg.POS_SHOP_ID} ĐÚNG -> "${me.name || "(không tên)"}"`);
      else {
        console.log(`  ${FAIL} shop_id ${cfg.POS_SHOP_ID} KHÔNG có trong danh sách. Các shop hợp lệ:`);
        for (const s of shops) console.log(`       shop_id=${s.id} | ${s.name || "(không tên)"}`);
        hardFail = true;
      }
    }
  } catch (e) { console.log(`  ${FAIL} Gọi POS /shops lỗi:`, e.message); hardFail = true; }

  // ---------- 3) Page token (đọc hội thoại như worker) ----------
  line(); console.log("3) Page token (đọc hội thoại — giống order_worker)");
  try {
    const { getConversations } = require("../loi/pancake/pancake_reader");
    const { hasTag } = require("../loi/pancake/conversation_tags");
    const data = await getConversations(1);
    if (!data || data.success !== true) {
      console.log(`  ${FAIL} API hội thoại từ chối -> Page token HỎNG/sai page. (chạy node kiem_tra_token.js)`); hardFail = true;
    } else {
      const convs = data.conversations || [];
      const tagged = convs.filter(c => hasTag(c, cfg.TAG_AI_CHOT));
      console.log(`  ${PASS} Page token SỐNG | lấy ${convs.length} hội thoại.`);
      console.log(`  •  Đang có thẻ "AI chốt" (${cfg.TAG_AI_CHOT}): ${tagged.length} hội thoại -> đây là số đơn worker sẽ thử lên.`);
      if (!tagged.length) { console.log(`  ${WARN}Chưa hội thoại nào gắn thẻ "AI chốt" -> worker chạy nhưng chưa có gì để lên.`); softWarn = true; }
    }
  } catch (e) { console.log(`  ${FAIL} Đọc hội thoại lỗi:`, e.message); hardFail = true; }

  // ---------- 4) Thẻ có đúng id không ----------
  line(); console.log("4) THẺ (kiểm id đã map đúng tên chưa)");
  try {
    const url = `https://pages.fm/api/public_api/v1/pages/${cfg.PAGE_ID}/tags?page_access_token=${cfg.PAGE_TOKEN}`;
    const res = await fetch(url);
    const d = await res.json().catch(() => ({}));
    const tags = d.tags || d.data || [];
    if (!Array.isArray(tags) || !tags.length) {
      console.log(`  ${WARN}Không đọc được danh sách thẻ (bỏ qua kiểm tên thẻ).`); softWarn = true;
    } else {
      const nameOf = id => {
        const t = tags.find(x => String(x.id != null ? x.id : x.tag_id) === String(id));
        return t ? (t.text || t.name || t.title || "(không tên)") : null;
      };
      const checkTag = (label, id, required) => {
        if (id == null) { if (required) { console.log(`  ${WARN}${label}: chưa khai id.`); softWarn = true; } return; }
        const nm = nameOf(id);
        if (nm) console.log(`  ${PASS} ${label} id=${id} -> "${nm}"`);
        else { console.log(`  ${FAIL} ${label} id=${id} KHÔNG tồn tại trên page -> sửa lại id trong .env. (node list_tags.js)`); if (required) hardFail = true; else softWarn = true; }
      };
      checkTag("AI chốt        ", cfg.TAG_AI_CHOT, true);
      checkTag("AI- Đã xác nhận", cfg.TAG_AI_DA_XACNHAN, false);
      checkTag("AI- CHỜ XL     ", cfg.TAG_AI_CHO_XL, false);
      console.log(`  •  Mở mắt nhìn TÊN thẻ ở trên: phải khớp ý bạn (nhất là "AI chốt" và "AI- Đã xác nhận").`);
    }
  } catch (e) { console.log(`  ${WARN}Kiểm thẻ lỗi:`, e.message); softWarn = true; }

  // ---------- 5) Nạp thử sản phẩm POS (tra mã -> biến thể) ----------
  line(); console.log("5) NẠP THỬ sản phẩm POS (chỗ hay hỏng nhất)");
  try {
    const { ensureProducts } = require("../loi/don/pos_client");
    const c = await ensureProducts();
    if (c && c.count) {
      console.log(`  ${PASS} Nạp được ${c.count} sản phẩm POS | index ${c.byCode.size} khóa mã.`);
      console.log(`  •  Nếu lên đơn báo "KHÔNG tra được biến thể" -> POS lưu MÃ ở chỗ khác,`);
      console.log(`     gửi tao log để chỉnh hàm productCodeCandidates / pickVariation trong pos_client.js.`);
    } else { console.log(`  ${FAIL} Không nạp được sản phẩm nào -> kiểm api_key/shop_id hoặc quyền đọc product.`); hardFail = true; }
  } catch (e) { console.log(`  ${FAIL} Nạp sản phẩm lỗi:`, e.message); hardFail = true; }

  done();
})();

function done() {
  console.log("\n============================================================");
  if (hardFail) {
    console.log(`${FAIL} CHƯA CHẠY ĐƯỢC — còn lỗi CHẶN ở trên (dòng ❌). Sửa xong chạy lại file này.`);
  } else if (softWarn) {
    console.log(`${WARN}SẴN SÀNG (có cảnh báo ⚠️). Khuyên: để ORDER_DRY_RUN=true chạy thử order_worker trước.`);
  } else {
    console.log(`${PASS} SẴN SÀNG. Mọi credential OK.`);
    console.log(`   -> Chạy THỬ trước: đặt ORDER_DRY_RUN=true rồi 'node order_worker.js' (chỉ in payload).`);
    console.log(`   -> Yên tâm thì bỏ ORDER_DRY_RUN (hoặc =false) rồi chạy thật.`);
  }
  console.log("============================================================");
  process.exit(hardFail ? 1 : 0);
}
