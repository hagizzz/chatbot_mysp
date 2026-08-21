// ============================================================================
// order_worker.js — TIẾN TRÌNH LÊN ĐƠN TỰ ĐỘNG (CHẠY RIÊNG với bot tư vấn)
// ----------------------------------------------------------------------------
// Luồng mỗi vòng quét:
//   1. Lấy hội thoại -> lọc cái có thẻ "AI chốt" (182) và CHƯA xử lý xong.
//   2. Đọc hội thoại + bộ nhớ tư vấn -> dựng kế hoạch đơn (đối chiếu "cod").
//   3. Mỗi SP đủ điều kiện -> tra biến thể POS -> TẠO 1 ĐƠN RIÊNG (1 SP/đơn).
//      Dòng đã lên trước đó (ghi trong orders_state.json) -> BỎ QUA (chống trùng).
//   4. Nếu MỌI SP đã lên đơn xong & không có dòng thiếu:
//         GỠ thẻ "AI chốt" -> GẮN "AI- Đã xác nhận".
//      Nếu có dòng THIẾU thông tin: KHÔNG lên dòng đó, gắn "AI- CHỜ XL" cho NV.
//
//   Chạy:  node order_worker.js
//   (Bật/tắt độc lập với bot tư vấn — KHÔNG ghi đè conversation_memory.json.)
// ============================================================================
require("./env_boot");   // nạp .env theo BOT_ENV (thật/thử) — phải trước mọi require đọc process.env
const cfg = require("./order_config");
const { getConversations, readConversation } = require("./pancake_reader");
const pageReg = require("./page_registry");
const { hasTag, addTag, removeTag } = require("./conversation_tags");
const hangDoiDon = require("./hang_doi_don");
const { resolveVariant, matchProvince, resolveCommune, createOrder, updateOrder, confirmOrder, getShops, getOrdersByPhone, getOrderById } = require("./pos_client");
const { reportUrgent, markProcessed, markCod, markResult, listOpenOrders, nowVN } = require("./urgent_sheet");
const { writeQuaShop, nowVN: nowVNQS } = require("./quashop_sheet");
const { buildOrderPlan } = require("./order_extractor");
const store = require("./order_store");
const { addConversationNote } = require("./pancake_sender");

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Đã ghi nhận đơn này (mọi trạng thái) chưa? -> chống ghi chú/log lặp mỗi vòng quét.
function _recorded(convId, sig) {
  const c = store.getConv(convId);
  return !!(c.orders && c.orders[sig]);
}

// Phân loại trạng thái đơn POS:
//   'new'  = Mới (status 0) -> CÓ THỂ tái dùng/hoàn thiện.
//   'dead' = huỷ/xoá/hoàn -> bỏ qua.
//   'live' = đã xác nhận trở đi (đã đóng/gửi/nhận...) -> đơn THẬT đang chạy.
const POS_DEAD = new Set([6, 7, 8, 9, 4, 5]);
const POS_NEW  = new Set([0]);
function _statusKind(o) {
  if (!o) return "dead";
  // Shop này trả status_name TIẾNG ANH tin cậy (new/submitted/shipped/...) -> ưu tiên TÊN, số chỉ dự phòng.
  const t = String(o.status_name || "").toLowerCase();
  if (t) {
    if (/hu[ỷy]|cancel|removed|x[óo]a|return|refund|tr[ảa]\s*h[àa]ng|ho[àa]n/.test(t)) return "dead";
    if (/^new$|^m[ớo]i/.test(t)) return "new";
    return "live";   // submitted/confirmed/packing/shipped/received...
  }
  const s = o.status;
  if (typeof s === "number") {
    if (POS_NEW.has(s)) return "new";
    if (POS_DEAD.has(s)) return "dead";
    return "live";
  }
  return "live";
}

// Tập variation_id (UUID biến thể) trong 1 đơn POS — đây mới là khóa khớp ĐÚNG
// (item của đơn KHÔNG chứa mã chữ MGKVX..., chỉ có product_id/variation_id).
function _orderVariationIds(o) {
  const items = o.items || o.order_items || o.products || [];
  return new Set((Array.isArray(items) ? items : []).map(x =>
    String(x.variation_id || (x.variation && x.variation.id) || "")).filter(Boolean));
}
// Tập "mã SP" (folded) xuất hiện trong đơn — để khớp theo MÃ dù size/màu khác (NV sửa size).
function _orderProductCodes(o) {
  const fold = require("./pos_client").fold;
  const items = o.items || o.order_items || o.products || [];
  const out = new Set();
  for (const x of (Array.isArray(items) ? items : [])) {
    const vi = x.variation_info || {};
    const cand = [vi.display_id, vi.fields_display_id, x.product_display_id, x.barcode,
                  (vi.product && vi.product.display_id), (x.product && x.product.display_id)];
    for (const c of cand) { const f = fold(c || ""); if (f) out.add(f); }
  }
  return out;
}
function _orderItemCount(o) {
  if (typeof o.items_length === "number") return o.items_length;
  const items = o.items || o.order_items || o.products || [];
  return Array.isArray(items) ? items.length : 0;
}

// TÌM đơn POS tái dùng được cho 1 biến thể (theo SĐT + variation_id):
//   liveWithProduct  -> đơn đang chạy đã có biến thể này (ĐÃ lên, bỏ qua).
//   sameProductNew   -> đơn "Mới" đã chứa biến thể này (bot tạo dở) -> chỉ xác nhận.
//   emptyDraft       -> đơn "Mới" CHƯA có SP (Pancake auto-tạo) -> nạp SP rồi xác nhận.
async function findReusableOrder(phone, wantVariationId, wantCode) {
  const out = { liveWithProduct: null, sameProductNew: null, emptyDraft: null, liveWithSameCode: null };
  try {
    const list = await getOrdersByPhone(phone);
    const vid = String(wantVariationId || "");
    const wc = (require("./pos_client").fold)(wantCode || "");
    for (const o of list) {
      const kind = _statusKind(o);
      if (kind === "dead") continue;
      const hasWant = vid && _orderVariationIds(o).has(vid);
      // khớp theo MÃ SP (dù size/màu khác) — NV có thể đã sửa size trên đơn.
      const hasCode = wc && [..._orderProductCodes(o)].some(c => c.includes(wc));
      if (kind === "live" && hasWant && !out.liveWithProduct) out.liveWithProduct = o;
      if (kind === "live" && hasCode && !out.liveWithSameCode) out.liveWithSameCode = o;
      if (kind === "new"  && hasWant && !out.sameProductNew) out.sameProductNew = o;
      if (kind === "new"  && _orderItemCount(o) === 0 && !out.emptyDraft) out.emptyDraft = o;
    }
  } catch (e) {
    console.log(`[ĐƠN] tra đơn POS theo SĐT lỗi: ${e.message}`);
  }
  return out;
}

// Tính phí ship + COD cho 1 đơn (1 SP). Theo kịch bản §14: >500k freeship, <= +30k.
function calcShipCod(totalPrice) {
  const freeship = totalPrice >= cfg.FREESHIP_THRESHOLD;
  const ship = freeship ? 0 : cfg.SHIP_FEE;
  return { isFreeShipping: freeship, cod: totalPrice + ship, shipFee: ship };
}

// Xử lý 1 hội thoại có thẻ AI chốt: dựng kế hoạch ĐƠN -> tạo từng đơn POS (mỗi tin chốt = 1 đơn, nhiều món).
// ---------------------------------------------------------------------------
// Xử lý xong một hội thoại: RÚT KHỎI HÀNG ĐỢI (nguồn thật) rồi mới gỡ thẻ 182
// (chỉ còn là nhãn cho nhân viên nhìn). Thứ tự này quan trọng: gỡ thẻ hỏng thì
// vòng sau cũng không lên đơn lại, vì hàng đợi đã ghi xong.
// ---------------------------------------------------------------------------
async function xongMotHoiThoai(convId, lyDo) {
  try { hangDoiDon.xong(convId, lyDo); }
  catch (e) { console.log(`[ĐƠN] ⚠ không rút được ${convId} khỏi hàng đợi: ${e.message}`); }
  try { await removeTag(convId, cfg.TAG_AI_CHOT); } catch (_) {}
}

async function handleConversation(conv) {
  const convId = conv.id || conv.conversation_id;
  if (!convId) return;

  let detail;
  try { detail = await readConversation(convId); }
  catch (e) { console.log(`[ĐƠN] đọc hội thoại ${convId} lỗi:`, e.message); return; }

  const plan = buildOrderPlan(convId, detail);

  if (!plan.confirmed) {
    console.log(`[ĐƠN] ${convId}: đã báo chốt nhưng CHƯA thấy tin chốt (cod) -> chờ.`);
    return;
  }

  let allOk = true;
  let addressIncomplete = false;   // có đơn nào thiếu Phường/Xã -> gắn CHỜ XL cho NV điền nốt
  const usedOrderIds = new Set();   // tránh tái dùng cùng 1 đơn POS cho 2 món trong cùng lần quét

  // ----- DUYỆT TỪNG TIN CHỐT -> TÁCH MỖI SẢN PHẨM THÀNH 1 ĐƠN RIÊNG -----
  for (const order of plan.orders) {
    // Tỉnh/thành PHẢI nhận diện được (đủ để giao). Không ra -> nhờ NV.
    let province = null;
    try { province = await matchProvince(order.address); } catch (_) {}
    if (!province) {
      console.log(`[ĐƠN] ${convId}: KHÔNG nhận diện tỉnh/thành từ "${order.address}" -> nhờ NV.`);
      if (!_recorded(convId, order.sig)) { try { await addConversationNote(convId, `[AI chưa lên đơn] Không nhận diện được tỉnh/thành từ địa chỉ: "${order.address}" — nhờ anh/chị bổ sung tỉnh/thành.`); } catch (_) {} }
      store.recordOrder(convId, order.sig, { status: "blocked", reason: "không nhận diện tỉnh/thành", address: order.address });
      await addTag(convId, cfg.TAG_THIEU_DIACHI);
      await xongMotHoiThoai(convId, "không nhận diện được tỉnh/thành");
      allOk = false;
      continue;
    }

    const single = order.items.length === 1;   // 1 SP: giữ ĐÚNG COD bot chốt; nhiều SP: tách + tính COD/ship từng đơn.

    // ----- MỖI SẢN PHẨM = 1 ĐƠN -----
    for (const it of order.items) {
      const itemSig = `${it.code}:${it.color}:${it.size}:${it.quantity}`.toUpperCase();

      // ĐÃ tạo đơn cho item này trước đó & đơn còn sống (kể cả NV đã sửa size/màu) -> KHÔNG tạo lại.
      const rec = (store.getConv(convId).orders || {})[itemSig];
      if (rec && rec.status === "created" && rec.posOrderId && !usedOrderIds.has(rec.posOrderId)) {
        let eo = null; try { eo = await getOrderById(rec.posOrderId); } catch (_) {}
        if (eo && _statusKind(eo) !== "dead") {
          usedOrderIds.add(rec.posOrderId);
          continue; // đơn đã có, tôn trọng chỉnh tay của NV
        }
      }

      // Tra biến thể POS cho MÓN này.
      const v = await resolveVariant(it.code, it.color, it.size);
      if (!v.ok) {
        const itemFail = `${it.code} | ${it.color} | ${it.size}: ${v.reason}`;
        console.log(`[ĐƠN] ${convId}: KHÔNG tra được biến thể POS -> ${itemFail}`);
        if (!_recorded(convId, itemSig)) { try { await addConversationNote(convId, `[AI chưa lên đơn] Không tra được biến thể POS: ${itemFail}`); } catch (_) {} }
        store.recordOrder(convId, itemSig, { status: "failed", lastError: itemFail });
        await addTag(convId, cfg.TAG_AI_CHO_XL);
        allOk = false;
        continue;
      }
      const posItem = { product_id: v.product_id, variation_id: v.variation_id, quantity: it.quantity };

      // Dò Phường/Xã (commune) -> gắn mã để POS không báo địa chỉ thiếu (chấm than đỏ).
      let commune = null;
      try { commune = await resolveCommune(province, order.address); } catch (_) {}
      if (commune) console.log(`[ĐƠN] ${convId}: Phường/Xã (${commune.matched}) -> ${commune.commune_name} (id ${commune.commune_id}, new ${commune.new_commune_id})`);
      else { console.log(`[ĐƠN] ${convId}: ⚠ KHÔNG dò được Phường/Xã từ "${order.address}" -> tạo đơn nhưng gắn CHỜ XL để NV điền phường.`); addressIncomplete = true; }

      // COD: 1 SP -> dùng đúng số bot chốt; nhiều SP -> tính riêng từng đơn (§14: >=500k freeship, <500k +30k ship).
      const itemTotal = (it.price || 0) * it.quantity;
      let cod, isFreeShipping;
      if (single) { cod = order.cod; isFreeShipping = order.cod <= itemTotal + 1; }
      else { const sc = calcShipCod(itemTotal); cod = sc.cod; isFreeShipping = sc.isFreeShipping; }
      const note = `[AI lên đơn] ${it.productName}(${it.code}) ${it.color} ${it.size} x${it.quantity} | COD ${cod}`;
      // Đủ Phường/Xã -> tạo thẳng Đã xác nhận; thiếu -> để Mới cho NV điền địa chỉ rồi xác nhận.
      const useStatus = commune ? cfg.POS_STATUS_CONFIRMED : cfg.POS_ORDER_STATUS;

      // TÌM đơn POS tái dùng được theo SĐT + variation_id (UUID biến thể — khớp chính xác).
      const reuse = await findReusableOrder(order.phone, v.variation_id, it.code);

      // 1) Đã có đơn ĐANG CHẠY chứa SP này -> coi như xong, KHÔNG tạo trùng.
      if (reuse.liveWithProduct && !usedOrderIds.has(reuse.liveWithProduct.id)) {
        const o = reuse.liveWithProduct;
        console.log(`[ĐƠN] ${convId}: [${itemSig}] ĐÃ có đơn đang chạy #${o.display_id || o.id} (${o.status_name || o.status}) -> bỏ qua.`);
        store.recordOrder(convId, itemSig, { status: "created", posOrderId: o.id, posDisplayId: o.display_id, note: "khớp đơn POS đang chạy" });
        usedOrderIds.add(o.id);
        continue;
      }

      // 1b) Đã có đơn ĐANG CHẠY cùng MÃ SP nhưng size/màu KHÁC (NV đã sửa tay) -> TÔN TRỌNG, không tạo lại.
      if (reuse.liveWithSameCode && !usedOrderIds.has(reuse.liveWithSameCode.id)) {
        const o = reuse.liveWithSameCode;
        console.log(`[ĐƠN] ${convId}: [${itemSig}] ĐÃ có đơn đang chạy #${o.display_id || o.id} cùng MÃ ${it.code} (NV chỉnh size/màu) -> TÔN TRỌNG, không tạo lại.`);
        store.recordOrder(convId, itemSig, { status: "created", posOrderId: o.id, posDisplayId: o.display_id, note: "đơn đã có (NV sửa size/màu)" });
        usedOrderIds.add(o.id);
        continue;
      }

      let r = null, mode = "";
      // 2) Có đơn "Mới" đã chứa đúng SP (vd bot tạo dở trước đó) -> chỉ XÁC NHẬN.
      if (reuse.sameProductNew && !usedOrderIds.has(reuse.sameProductNew.id)) {
        const o = reuse.sameProductNew;
        mode = `xác nhận đơn Mới sẵn #${o.display_id || o.id}`;
        r = await updateOrder(o.id, {
          fullName: order.fullName, phone: order.phone, addressText: order.address, province, commune,
          items: [posItem], totalPrice: itemTotal, cod, isFreeShipping, note,
          status: useStatus, pageId: conv.page_id || (String(convId).split("_")[0] || null)
        });
        if (r.success) usedOrderIds.add(o.id);
      }
      // 3) Có đơn "Mới" TRỐNG (Pancake auto-tạo, sẵn FB+SĐT) -> NẠP SP + địa chỉ rồi XÁC NHẬN.
      else if (reuse.emptyDraft && !usedOrderIds.has(reuse.emptyDraft.id)) {
        const o = reuse.emptyDraft;
        mode = `hoàn thiện đơn Mới trống #${o.display_id || o.id}`;
        r = await updateOrder(o.id, {
          fullName: order.fullName, phone: order.phone, addressText: order.address, province, commune,
          items: [posItem], totalPrice: itemTotal, cod, isFreeShipping, note,
          status: useStatus, pageId: conv.page_id || (String(convId).split("_")[0] || null)
        });
        if (r.success) usedOrderIds.add(o.id);
      }
      // 4) Không có đơn nào tái dùng -> TẠO MỚI, tạo thẳng trạng thái Đã xác nhận.
      else {
        mode = "tạo đơn mới";
        r = await createOrder({
          fullName: order.fullName, phone: order.phone, addressText: order.address, province, commune,
          items: [posItem], totalPrice: itemTotal, cod, isFreeShipping, note,
          customerFbId: order.customerFbId || (String(convId).split("_")[1] || null),
          conversationId: convId, customerName: order.fullName, status: useStatus,
          pageId: conv.page_id || (String(convId).split("_")[0] || null)
        });
        if (r.success && r.orderId) usedOrderIds.add(r.orderId);
      }

      if (r && r.success) {
        console.log(`[ĐƠN] ${convId}: ✅ ${mode} (1 SP, COD ${cod}đ) -> id=${r.orderId} (#${r.displayId})${r.raw && r.raw.dryRun ? " [DRY_RUN]" : ""}`);
        store.recordOrder(convId, itemSig, { status: "created", posOrderId: r.orderId, posDisplayId: r.displayId, cod, lastError: null });
        // DỌN đơn Mới RỖNG (0 SP) còn sót cùng SĐT (Pancake auto-tạo / bot tạo dở) -> XOÁ, tránh kẹt.
        try {
          const leftover = await getOrdersByPhone(order.phone);
          for (const o of leftover) {
            if (_statusKind(o) === "new" && _orderItemCount(o) === 0 &&
                String(o.id) !== String(r.orderId) && !usedOrderIds.has(o.id)) {
              let okDel = false;
              try {
                const du = `${cfg.POS_BASE}/shops/${cfg.POS_SHOP_ID}/orders/${o.id}?api_key=${cfg.POS_API_KEY}`;
                const dr = await fetch(du, { method: "DELETE" });
                const dj = await dr.json().catch(() => ({}));
                okDel = dr.ok && dj.success !== false;
              } catch (_) {}
              console.log(`[ĐƠN] ${convId}: 🧹 đơn Mới RỖNG #${o.display_id || o.id} -> ${okDel ? "đã xoá" : "không xoá được (NV xoá tay nếu cần)"}.`);
              usedOrderIds.add(o.id);
            }
          }
        } catch (_) {}
      } else {
        const err = (r && r.raw) ? JSON.stringify(r.raw).slice(0, 300) : "unknown";
        console.log(`[ĐƠN] ${convId}: ❌ ${mode} LỖI ->`, err);
        store.recordOrder(convId, itemSig, { status: "failed", lastError: err });
        try { await addConversationNote(convId, `[AI chưa lên đơn] POS báo lỗi (${mode}): ${err}`); } catch (_) {}
        await addTag(convId, cfg.TAG_AI_CHO_XL);
        allOk = false;
      }
      await sleep(500);   // nhẹ tay với POS API
    }
  }

  // ----- ĐƠN THIẾU THÔNG TIN -> báo NV (ghi rõ thiếu gì) -----
  if (plan.blocked.length) {
    const fresh = plan.blocked.filter(b => !_recorded(convId, b.sig));
    const lines = plan.blocked.map(b => `• ${(b.items || []).join(", ") || "(chưa rõ SP)"}: ${b.reasons.join("; ")}`).join("\n");
    console.log(`[ĐƠN] ${convId}: ${plan.blocked.length} đơn THIẾU thông tin (mới: ${fresh.length}) -> nhờ NV:\n${lines}`);
    if (fresh.length) {
      const freshLines = fresh.map(b => `• ${(b.items || []).join(", ") || "(chưa rõ SP)"}: ${b.reasons.join("; ")}`).join("\n");
      try { await addConversationNote(convId, "[AI chưa lên được đơn - thiếu/sai thông tin]\n" + freshLines); } catch (_) {}
      for (const b of fresh) store.recordOrder(convId, b.sig, { status: "blocked", reasons: b.reasons });
    }
    await addTag(convId, cfg.TAG_AI_CHO_XL);
    allOk = false;
  }
  if (plan.missingGlobal.length) {
    console.log(`[ĐƠN] ${convId}: thiếu chung -> ${plan.missingGlobal.join(" | ")}`);
    try { await addConversationNote(convId, "[AI chưa lên được đơn] " + plan.missingGlobal.join(" | ")); } catch (_) {}
    await addTag(convId, cfg.TAG_AI_CHO_XL);
    allOk = false;
  }

  // ----- TẤT CẢ ổn & có >=1 đơn -> đổi thẻ -----
  if (allOk && plan.orders.length) {
    // Đơn đã tạo NHƯNG thiếu Phường/Xã -> gắn "Thiếu địa chỉ" để NV vào điền nốt.
    if (addressIncomplete) {
      await addTag(convId, cfg.TAG_THIEU_DIACHI);
      await xongMotHoiThoai(convId, `đã tạo ${plan.orders.length} đơn, thiếu Phường/Xã`);
      console.log(`[ĐƠN] ${convId}: ✅ đã tạo ${plan.orders.length} đơn nhưng THIẾU Phường/Xã -> gắn "Thiếu địa chỉ" (${cfg.TAG_THIEU_DIACHI}) để NV điền.`);
      return;
    }
    if (cfg.TAG_AI_DA_XACNHAN == null) {
      console.log(`[ĐƠN] ${convId}: đã lên đơn xong nhưng CHƯA cấu hình PANCAKE_TAG_AI_DA_XACNHAN -> không đổi thẻ. (điền id vào .env)`);
      return;
    }
    await addTag(convId, cfg.TAG_AI_DA_XACNHAN);
    await xongMotHoiThoai(convId, `đã lên ${plan.orders.length} đơn`);
    console.log(`[ĐƠN] ${convId}: 🎯 đã lên ${plan.orders.length} đơn -> đổi thẻ AI chốt -> AI- Đã xác nhận.`);
  }
}

// ===== ĐƠN GẤP (thẻ 206 "AI- Gửi đơn gấp") =====
// POS shop này trả status_name TIẾNG ANH (submitted/shipped/...) -> map sang VI.
const EN_VI = {
  new: "Mới", confirmed: "Đã xác nhận", submitted: "Đã xác nhận",
  packing: "Đang đóng hàng", waiting: "Chờ chuyển hàng",
  shipped: "Đã gửi hàng", shipping: "Đang giao",
  received: "Đã nhận", delivered: "Đã nhận", completed: "Đã nhận",
  returning: "Đang hoàn", returned: "Đã hoàn", refunded: "Đã hoàn",
  canceled: "Đã hủy", cancelled: "Đã hủy", removed: "Đã xoá"
};
function statusVi(o) {
  const raw = String((o && o.status_name) || "").trim();
  if (raw && /^[a-zA-Z_ ]+$/.test(raw)) {            // tên tiếng Anh -> dịch
    const key = raw.toLowerCase().replace(/\s+/g, "");
    return EN_VI[key] || raw;
  }
  if (raw && !/^\d+$/.test(raw)) return raw;          // đã là tiếng Việt
  return raw || String((o && o.status) ?? "");
}
// Mã SP cho sheet: lấy từ ghi chú đơn "[AI lên đơn] Tên(MÃ) MÀU SIZE xN" -> "MÃ-MÀU-SIZE".
function productCodeFromNote(note) {
  const m = String(note || "").match(/\(([A-Za-z0-9]+)\)\s*(.*?)\s*x\d/);
  if (!m) return "";
  const code = m[1];
  const cs = (m[2] || "").trim().replace(/\s+/g, "-");
  return cs ? `${code}-${cs}` : code;
}
// Mã SP cho sheet từ ITEMS đơn (đơn NV tạo, note không theo mẫu) -> lấy mã biến thể SP đầu.
function productCodeFromItems(o) {
  const items = (o && (o.items || o.order_items || o.products)) || [];
  if (!Array.isArray(items) || !items.length) return "";
  const it = items[0] || {};
  const vi = it.variation_info || {};
  const code = vi.display_id || vi.fields_display_id || it.product_display_id ||
               (vi.product && vi.product.display_id) || it.barcode || "";
  return String(code || "").trim();
}
// "Thời gian xử lý" = khi đơn sang "Đã gửi hàng" (shop này: status 2 / "shipped").
function isShippingStatus(o) {
  const st = Number(o && o.status);
  const n = (require("./pos_client").fold)(o.status_name || "");
  if (st === 2 || st === 5) return true;
  return /GUI HANG|SHIPPED|SHIPPING|DELIVER/.test(n);
}
// "Kết quả" cuối: Đã nhận / Đã hoàn / Đã hủy -> trả tên VI, không thì null.
function finalResult(o) {
  const n = (require("./pos_client").fold)(o.status_name || "");
  if (/DA NHAN|RECEIVED|DELIVERED|COMPLETED|SUCCESS/.test(n)) return "Đã nhận";
  if (/HOAN|RETURNED|RETURNING|REFUND/.test(n)) return "Đã hoàn";
  if (/HUY|CANCEL/.test(n)) return "Đã hủy";
  return null;
}
// Trạng thái cho cột "Kết quả": text + có phải trạng thái CUỐI không (final -> ngừng theo dõi).
// Thứ tự ưu tiên: hủy/hoàn/nhận (cuối) -> chuyển hàng (chưa cuối).
function statusResult(o) {
  const st = Number(o && o.status);
  const n = (require("./pos_client").fold)(o.status_name || "");
  if (/HUY|CANCEL|REMOVED/.test(n)) return { text: "Đã hủy", final: true };
  if (/HOAN|RETURNED|RETURNING|REFUND/.test(n)) return { text: "Hàng hoàn", final: true };
  if (/DA NHAN|RECEIVED|DELIVERED|COMPLETED|SUCCESS/.test(n)) return { text: "Đã nhận", final: true };
  if (st === 2 || st === 5 || /GUI HANG|SHIPPED|SHIPPING|DELIVER/.test(n)) return { text: "Đã chuyển hàng", final: false };
  return { text: "", final: false };
}
const FINAL_RESULTS = new Set(["Đã nhận", "Hàng hoàn", "Đã hủy"]);

async function handleUrgent(conv) {
  const convId = conv.id || conv.conversation_id;
  if (!convId) return;
  const stored = store.getConv(convId);
  const orders = stored.orders || {};
  const orderIds = [...new Set(
    Object.values(orders).filter(o => o.status === "created" && o.posOrderId).map(o => String(o.posOrderId))
  )];
  // FALLBACK: hội thoại chưa có đơn bot tạo -> tra đơn KH theo SĐT (đơn NV tạo vẫn báo GẤP được).
  if (!orderIds.length) {
    // Quét MỌI SĐT trong object hội thoại (recent_phone_numbers, customers, page_customer, hồ sơ KH...).
    const phones = [];
    try {
      const blob = JSON.stringify(conv);
      const m = blob.match(/(?:84|0)\d{9}/g) || [];
      for (let p of m) { if (p.startsWith("84")) p = "0" + p.slice(2); if (p.length === 10) phones.push(p); }
    } catch (_) {}
    for (const ph of [...new Set(phones)]) {
      try {
        const list = await getOrdersByPhone(ph);
        for (const o of list) {
          if (_statusKind(o) !== "dead" && _orderItemCount(o) > 0) orderIds.push(String(o.id));
        }
      } catch (_) {}
      if (orderIds.length) break;
    }
  }
  const uniqOrderIds = [...new Set(orderIds)];
  if (!uniqOrderIds.length) {
    let nph = 0; try { nph = (JSON.stringify(conv).match(/(?:84|0)\d{9}/g) || []).length; } catch (_) {}
    console.log(`[GẤP] ${convId}: có thẻ 206 nhưng CHƯA tìm thấy đơn (SĐT bắt được: ${nph}). ${nph ? "Đơn có thể chưa lên / SĐT khác." : "Hội thoại chưa có SĐT -> chờ có đơn."}`);
    return;
  }

  for (const orderId of uniqOrderIds) {
    const u = store.getUrgent(convId, orderId) || {};
    if (u.done) continue; // đã ghi Kết quả -> ngừng theo dõi

    let o = null;
    try { o = await getOrderById(orderId); } catch (_) {}
    if (!o) continue;
    const sheetKey = u.sheetId || o.display_id || orderId;

    // GẮN THẺ ĐƠN "GẤP" — chạy mỗi vòng, đơn nào thiếu thẻ thì gắn (kể cả đã báo trước đó).
    const hasGap = Array.isArray(o.tags) && o.tags.some(t => Number(t.id) === Number(cfg.ORDER_TAG_GAP_ID));
    const noteHasGap = /🔴\s*GẤP/.test(o.note || "");
    if (!hasGap || !noteHasGap) {
      const tags = (Array.isArray(o.tags) ? o.tags.slice() : []);
      if (!hasGap) tags.push({ id: Number(cfg.ORDER_TAG_GAP_ID), name: cfg.ORDER_TAG_GAP_NAME });
      const upd = { tags, pageId: o.page_id || (o.page && o.page.id) || null };
      if (!noteHasGap) upd.note = `${o.note || ""}  🔴 GẤP`.trim();
      try {
        const ur = await updateOrder(orderId, upd);
        if (ur && ur.success) {
          console.log(`[GẤP] ${convId}: đơn ${orderId} -> gắn thẻ GẤP (id ${cfg.ORDER_TAG_GAP_ID})${!noteHasGap ? " + note 🔴 GẤP" : ""} OK.`);
        } else {
          console.log(`[GẤP] ${convId}: đơn ${orderId} -> gắn GẤP THẤT BẠI | POS:`, JSON.stringify(ur && ur.raw).slice(0, 200));
        }
      } catch (e) { console.log(`[GẤP] gắn thẻ lỗi:`, e.message); }
    }

    // 1) BÁO: có đơn (chưa chết) & chưa báo -> ghi sheet (Thời gian báo). Cột D = trạng thái hiện tại.
    if (!u.reported && _statusKind(o) !== "dead") {
      const productCode = productCodeFromNote(o.note) || productCodeFromItems(o) || "";
      const reportTime = nowVN();
      const r = await reportUrgent({
        orderId: sheetKey, page: cfg.PAGE_NAME, productCode,
        status: statusVi(o), reportTime, cod: (o.cod != null ? o.cod : 0)
      });
      Object.assign(u, { reported: true, reportTime, sheetId: sheetKey });
      store.setUrgent(convId, orderId, u);
      console.log(`[GẤP] ${convId}: đơn ${orderId} (${sheetKey}) ĐÃ XÁC NHẬN -> báo sheet${r.dup ? " (đã có)" : ""}. Thời gian báo ${reportTime}.`);
    }
    if (!u.reported) continue; // chưa báo thì chưa theo dõi tiếp

    // COD: bổ sung nếu chưa có (đơn cũ / báo trước khi có cột COD).
    if (!u.codWritten && o.cod != null) {
      await markCod(sheetKey, o.cod);
      Object.assign(u, { codWritten: true });
      store.setUrgent(convId, orderId, u);
    }

    // 2) XỬ LÝ: đơn sang "Đã gửi hàng" -> ghi Thời gian xử lý (1 lần).
    if (!u.processed && isShippingStatus(o)) {
      const t = nowVN();
      await markProcessed(sheetKey, t);
      Object.assign(u, { processed: true, processTime: t });
      store.setUrgent(convId, orderId, u);
      console.log(`[GẤP] ${convId}: đơn ${orderId} -> Đã gửi hàng -> Thời gian xử lý ${t}.`);
    }

    // 3) KẾT QUẢ (cột H): Đã chuyển hàng -> Đã nhận/Hàng hoàn/Đã hủy. Cập nhật khi đổi; dừng khi CUỐI.
    const sr = statusResult(o);
    if (sr.text && sr.text !== u.result) {
      await markResult(sheetKey, sr.text);
      Object.assign(u, { result: sr.text, done: !!sr.final });
      store.setUrgent(convId, orderId, u);
      console.log(`[GẤP] ${convId}: đơn ${orderId} -> KẾT QUẢ "${sr.text}"${sr.final ? " (cuối, ngừng theo dõi)" : ""}.`);
    }
  }
}

// Theo dõi F (Đã gửi hàng) + G (Kết quả) cho MỌI đơn gấp đã báo — KHÔNG cần thẻ 206 còn hay mất.
async function followUrgent() {
  const watch = store.listUrgentWatch();
  if (!watch.length) return;
  for (const { convId, orderId, urgent } of watch) {
    let o = null;
    try { o = await getOrderById(orderId); } catch (_) {}
    if (!o) continue;
    const u = store.getUrgent(convId, orderId) || urgent || {};
    const sheetKey = u.sheetId || o.display_id || orderId;

    if (!u.processed && isShippingStatus(o)) {
      const t = nowVN();
      await markProcessed(sheetKey, t);
      Object.assign(u, { processed: true, processTime: t });
      store.setUrgent(convId, orderId, u);
      console.log(`[GẤP] ${convId}: đơn ${orderId} -> Đã gửi hàng -> Thời gian xử lý ${t}.`);
    }
    if (!u.codWritten && o.cod != null) { await markCod(sheetKey, o.cod); Object.assign(u, { codWritten: true }); store.setUrgent(convId, orderId, u); }
    const sr = statusResult(o);
    if (sr.text && sr.text !== u.result) {
      await markResult(sheetKey, sr.text);
      Object.assign(u, { result: sr.text, done: !!sr.final });
      store.setUrgent(convId, orderId, u);
      console.log(`[GẤP] ${convId}: đơn ${orderId} -> KẾT QUẢ "${sr.text}"${sr.final ? " (cuối, ngừng)" : ""}.`);
    }
    await sleep(150);
  }
}

// Theo dõi F/G/H + COD DỰA TRÊN SHEET (không phụ thuộc state): quét Mã ID trong sheet,
// đơn nào chưa có Kết quả CUỐI -> tra POS -> điền COD / Thời gian xử lý / Kết quả.
async function followUrgentSheet() {
  let open = [];
  try { open = await listOpenOrders(); } catch (e) { return; }
  for (const it of open) {
    let o = null;
    try { o = await getOrderById(it.orderId); } catch (_) {}
    if (!o) continue;
    if (!it.cod && o.cod != null) { await markCod(it.orderId, o.cod); }   // bổ sung COD cho MỌI đơn (kể cả đã xong)
    if (FINAL_RESULTS.has(it.result)) { await sleep(80); continue; }       // đã có Kết quả CUỐI -> chỉ backfill COD
    if (!it.hasProcessed && isShippingStatus(o)) {
      await markProcessed(it.orderId, nowVN());
      console.log(`[GẤP] đơn ${it.orderId} -> Đã gửi hàng -> điền Thời gian xử lý (từ sheet).`);
    }
    const sr = statusResult(o);
    if (sr.text && sr.text !== it.result) {
      await markResult(it.orderId, sr.text);
      console.log(`[GẤP] đơn ${it.orderId} -> KẾT QUẢ "${sr.text}"${sr.final ? " (cuối)" : ""} (từ sheet).`);
    }
    await sleep(120);
  }
}
// Đơn của khách (từ QUASHOP_FROM_DATE) ở kho HN 105 Bà Triệu / HCM Nguyễn Trãi -> đổ tab "QUA SHOP".
// Khách đã có đơn hợp lệ -> GỠ thẻ 174.
function _orderDateStr(o) {
  const d = o.inserted_at || o.updated_at || o.created_at || "";
  return String(d || "");
}
async function handleQuaShop(conv) {
  const convId = conv.id || conv.conversation_id;
  if (!convId) return;
  // Quét mọi SĐT trong object hội thoại.
  const phones = [];
  try {
    const m = JSON.stringify(conv).match(/(?:84|0)\d{9}/g) || [];
    for (let p of m) { if (p.startsWith("84")) p = "0" + p.slice(2); if (p.length === 10) phones.push(p); }
  } catch (_) {}
  const uniq = [...new Set(phones)];
  if (!uniq.length) { console.log(`[QUASHOP] ${convId}: có thẻ 174 nhưng chưa có SĐT -> chờ.`); return; }

  const wh = new Set((cfg.QUASHOP_WAREHOUSE_IDS || []).map(String));
  const fromDate = String(cfg.QUASHOP_FROM_DATE || "2026-06-01");
  let wrote = 0, matched = 0;
  for (const ph of uniq) {
    let list = [];
    try { list = await getOrdersByPhone(ph); } catch (_) {}
    for (const o of list) {
      if (_statusKind(o) === "dead") continue;
      const wid = String(o.warehouse_id || (o.warehouse_info && o.warehouse_info.id) || "");
      if (!wh.has(wid)) continue;                      // không thuộc 2 kho -> bỏ
      if (_orderDateStr(o).slice(0, 10) < fromDate) continue; // trước tháng 6 -> bỏ
      matched++;
      const productCode = productCodeFromNote(o.note) || productCodeFromItems(o) || "";
      const whName = (o.warehouse_info && o.warehouse_info.name) || "";
      const pageNm = pageReg.pageName(o.page_id) || cfg.PAGE_NAME;
      const r = await writeQuaShop({
        orderId: o.id, date: _orderDateStr(o).replace("T", " ").slice(0, 19) || nowVNQS(),
        page: pageNm, productCode, warehouse: whName,
        cod: o.cod, prepaid: (o.prepaid != null ? o.prepaid : 0), status: statusVi(o)
      });
      if (r && r.ok && !r.dup) { wrote++; console.log(`[QUASHOP] ${convId}: đơn ${o.id} (${whName}) -> ghi sheet OK.`); }
    }
  }
  if (matched > 0) {
    // Khách đã có đơn hợp lệ -> gỡ thẻ 174.
    try { await removeTag(convId, cfg.TAG_QUA_SHOP); } catch (_) {}
    console.log(`[QUASHOP] ${convId}: khách đã có ${matched} đơn hợp lệ (ghi mới ${wrote}) -> gỡ thẻ QUA SHOP (174).`);
  } else {
    console.log(`[QUASHOP] ${convId}: chưa có đơn ở kho 105 Bà Triệu/Nguyễn Trãi (từ ${fromDate}) -> giữ thẻ, chờ.`);
  }
}

// DON_NGUON: lấy tín hiệu "hội thoại đã chốt" từ đâu.
//   bang   = chỉ hàng đợi SQLite (bot ghi vào). Sạch nhất.
//   the    = chỉ thẻ 182 trên Pancake. Cách cũ, để quay lui nếu có sự cố.
//   ca_hai = cả hai, gộp lại và bỏ trùng. MẶC ĐỊNH.
// Mặc định là ca_hai vì nhân viên đang có thói quen GẮN TAY thẻ 182 để nhờ bot
// lên đơn — bỏ đường đó đi mà không báo là cắt mất một quy trình đang chạy.
const DON_NGUON = String(process.env.DON_NGUON || "ca_hai").trim().toLowerCase();
const DUNG_BANG = DON_NGUON === "bang" || DON_NGUON === "ca_hai";
const DUNG_THE  = DON_NGUON === "the"  || DON_NGUON === "ca_hai";
const CANH_BAO_SAU_LAN = Number(process.env.DON_CANH_BAO_SAU_LAN || 40);   // 40 x 15s = 10 phút

async function tick() {
  // ---- 1) HÀNG ĐỢI TRƯỚC, và KHÔNG phụ thuộc Pancake còn sống hay không ----
  // Đây là điểm mấu chốt: trước đây Pancake lỗi là cả vòng này thoát sớm,
  // đơn nằm im. Giờ hàng đợi vẫn chạy dù Pancake có trục trặc.
  const tuBang = [];
  if (DUNG_BANG) {
    try {
      for (const r of hangDoiDon.layCho(200)) tuBang.push(String(r.conversation_id));
    } catch (e) { console.log("[ĐƠN] ⚠ đọc hàng đợi lỗi:", e.message); }
  }

  let data = null;
  try { data = await getConversations(1); }
  catch (e) { console.log("[ĐƠN] lấy hội thoại lỗi:", e.message); }
  const capDuocPancake = !!(data && data.success === true);
  if (!capDuocPancake && !tuBang.length) {
    console.log("[ĐƠN] API hội thoại chưa OK và hàng đợi rỗng -> bỏ vòng này.");
    return;
  }
  if (!capDuocPancake) console.log("[ĐƠN] ⚠ Pancake chưa OK, nhưng vẫn chạy tiếp bằng hàng đợi.");

  const convs = capDuocPancake ? (data.conversations || []) : [];
  const theoId = new Map(convs.map(c => [String(c.id), c]));

  // Gộp hai nguồn, bỏ trùng, giữ nguyên thứ tự: hàng đợi trước (cũ trước).
  const canXu = new Map();
  for (const id of tuBang) canXu.set(id, theoId.get(id) || { id });
  let soTuThe = 0;
  if (DUNG_THE) {
    for (const c of convs) {
      if (!hasTag(c, cfg.TAG_AI_CHOT)) continue;
      if (canXu.has(String(c.id))) continue;
      canXu.set(String(c.id), c);
      soTuThe++;
    }
  }

  console.log(`[ĐƠN] tổng ${convs.length} hội thoại | hàng đợi: ${tuBang.length} | thêm từ thẻ ${cfg.TAG_AI_CHOT}: ${soTuThe} | sẽ xử: ${canXu.size}`);

  for (const [convId, c] of canXu) {
    // Đếm số lần thử để hội thoại kẹt mãi không im lặng trôi qua.
    if (DUNG_BANG) {
      try {
        const lan = hangDoiDon.danhDauDaThu(convId);
        if (lan === CANH_BAO_SAU_LAN) {
          console.log(`[ĐƠN] ⚠ ${convId} đã thử ${lan} lần mà chưa lên được đơn -> nhờ người thật xem.`);
        }
      } catch (_) {}
    }
    try { await handleConversation(c); }
    catch (e) { console.log("[ĐƠN] xử lý hội thoại lỗi:", e.message); }
    await sleep(300);
  }

  // ĐƠN GẤP: hội thoại gắn thẻ 206 -> báo/ theo dõi tới khi "Chuyển hàng".
  const urgentConvs = convs.filter(c => hasTag(c, cfg.TAG_GUI_GAP));
  if (urgentConvs.length) console.log(`[GẤP] có thẻ Gửi đơn gấp (${cfg.TAG_GUI_GAP}): ${urgentConvs.length}`);
  for (const c of urgentConvs) {
    try { await handleUrgent(c); }
    catch (e) { console.log("[GẤP] xử lý lỗi:", e.message); }
    await sleep(200);
  }

  // Theo dõi tiếp F/G cho đơn gấp đã báo — kể cả hội thoại đã gỡ thẻ 206.
  try { await followUrgent(); }
  catch (e) { console.log("[GẤP] theo dõi F/G lỗi:", e.message); }
  // Theo dõi F/G DỰA TRÊN SHEET (không phụ thuộc state) — bù cho đơn cũ khi state bị reset.
  try { await followUrgentSheet(); }
  catch (e) { console.log("[GẤP] theo dõi F/G (sheet) lỗi:", e.message); }

  // QUA SHOP: hội thoại thẻ 174 -> đổ đơn ở kho 105 Bà Triệu / Nguyễn Trãi -> gỡ thẻ khi có đơn.
  const quaShopConvs = convs.filter(c => hasTag(c, cfg.TAG_QUA_SHOP));
  if (quaShopConvs.length) console.log(`[QUASHOP] có thẻ QUA SHOP (${cfg.TAG_QUA_SHOP}): ${quaShopConvs.length}`);
  for (const c of quaShopConvs) {
    try { await handleQuaShop(c); }
    catch (e) { console.log("[QUASHOP] xử lý lỗi:", e.message); }
    await sleep(200);
  }
}

async function main() {
  // Kiểm tra cấu hình tối thiểu.
  const miss = [];
  if (!cfg.PAGE_ID) miss.push("PANCAKE_PAGE_ID");
  if (!cfg.PAGE_TOKEN) miss.push("PANCAKE_PAGE_ACCESS_TOKEN");
  if (!cfg.POS_API_KEY) miss.push("PANCAKE_POS_API_KEY");
  if (!cfg.POS_SHOP_ID) miss.push("PANCAKE_POS_SHOP_ID");
  if (miss.length) {
    console.log("THIẾU cấu hình trong .env:", miss.join(", "));
    console.log("-> Lên đơn POS cần PANCAKE_POS_API_KEY + PANCAKE_POS_SHOP_ID (khác token Page).");
    if (miss.includes("PANCAKE_POS_API_KEY") || miss.includes("PANCAKE_POS_SHOP_ID")) process.exit(1);
  }
  if (cfg.TAG_AI_DA_XACNHAN == null) {
    console.log("CẢNH BÁO: chưa cấu hình PANCAKE_TAG_AI_DA_XACNHAN -> sẽ lên đơn nhưng KHÔNG tự đổi thẻ. (chạy `node list_tags.js` lấy id)");
  }
  if (cfg.DRY_RUN) console.log("CHẾ ĐỘ DRY_RUN: chỉ in payload, KHÔNG gọi POS thật.");

  console.log(`[ĐƠN] nguồn tín hiệu chốt: DON_NGUON=${DON_NGUON} (bảng=${DUNG_BANG ? "có" : "không"}, thẻ ${cfg.TAG_AI_CHOT}=${DUNG_THE ? "có" : "không"})`);
  if (DUNG_BANG) {
    try {
      hangDoiDon.donCu(30);   // dọn dòng 'xong' cũ hơn 30 ngày cho bảng khỏi phình
      console.log(`[ĐƠN] hàng đợi đang chờ: ${hangDoiDon.demCho()} hội thoại.`);
    } catch (e) { console.log("[ĐƠN] ⚠ mở hàng đợi lỗi:", e.message); }
  }

  // ĐA-PAGE: nạp toàn bộ page (pages.json / PANCAKE_USER_ACCESS_TOKEN / .env 1-page).
  try { await pageReg.init(); }
  catch (e) { console.log("[pages] init lỗi:", e.message); }

  // In shop để xác nhận credential đúng.
  try {
    const shops = await getShops();
    const me = shops.find(s => String(s.id) === String(cfg.POS_SHOP_ID));
    console.log(`[ĐƠN] POS OK | shop_id=${cfg.POS_SHOP_ID}${me ? ` (${me.name})` : " (CẢNH BÁO: không thấy shop_id này trong danh sách /shops)"}`);
  } catch (e) { console.log("[ĐƠN] gọi /shops lỗi (kiểm tra api_key):", e.message); }

  console.log(`=== ORDER WORKER chạy | quét mỗi ${cfg.POLL_MS / 1000}s ===`);
  // vòng lặp liên tục
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await tick();
    await sleep(cfg.POLL_MS);
  }
}

if (require.main === module) main();

module.exports = { tick, handleConversation, calcShipCod };
