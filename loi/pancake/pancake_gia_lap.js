// ============================================================================
// pancake_gia_lap.js — PANCAKE GIẢ, DỰNG NGAY TRONG BỘ NHỚ
// ----------------------------------------------------------------------------
// Vì sao có file này: lõi bot là một script liền khối 12.7k dòng, không có
// module.exports nên KHÔNG gọi rời từng hàm được. Nhưng mọi lần bot đọc/gửi
// tin đều đi qua đúng một cửa: hàm `fetch` toàn cục.
//
// => Chặn ngay cửa đó. Bot chạy NGUYÊN VẸN mã thật (đọc tin, hiểu ý, chọn ảnh,
//    chốt đơn, gắn thẻ...), chỉ có điều đầu dây bên kia không phải Pancake thật
//    mà là hội thoại giả nằm trong RAM.
//
// Nguyên tắc an toàn — mọi host đều phải khai báo, không có "mặc định cho qua":
//   pages.fm            -> GIẢ LẬP (không một gói tin nào ra ngoài)
//   pos.pages.fm        -> CHẶN CỨNG (đây là nơi tạo đơn thật)
//   graph.facebook.com  -> CHẶN (đồng bộ quảng cáo, không cần khi chat thử)
//   api.openai.com      -> CHO QUA (muốn xem bot nghĩ thật thì phải gọi AI thật)
//   googleapis/google   -> CHO QUA (đọc kịch bản + bảng hàng, chỉ đọc)
//   ảnh (fbcdn/gg)      -> CHO QUA (nhận diện ảnh cần tải ảnh về)
//   còn lại             -> CHẶN + ném lỗi to cho biết
// ============================================================================
"use strict";

const __goc = require("path").join(__dirname, "..", "..");
const PAGE_ID_GIA = "100000000000001";

// MỘT SỔ KHÁCH GIẢ, không phải một khách duy nhất.
// Vì sao: bộ nhớ hội thoại của bot gắn theo conversationId. Dùng đi dùng lại
// một id thì kịch bản sau thừa hưởng trạng thái của kịch bản trước — đã dính
// đúng lỗi này: kịch bản 1 giao người thật (thẻ 183), sang kịch bản 2 và 3 bot
// vẫn "đứng ngoài" vì tưởng cùng một khách đang chờ nhân viên.
// Mỗi kịch bản lấy một suất -> khách mới tinh, y như ngoài đời.
const PSID_GOC = 200000000000002;
const SO_SUAT = 30;
const DS_CONV = Array.from({ length: SO_SUAT }, (_, i) => `${PAGE_ID_GIA}_${PSID_GOC + i}`);
let _suat = 0;

const psidHienTai = () => String(PSID_GOC + _suat);
const convHienTai = () => DS_CONV[_suat];

const PSID_GIA = String(PSID_GOC);
const CONV_ID = DS_CONV[0];

// ---- Trạng thái hội thoại giả -------------------------------------------
const trangThai = {
  tinNhan: [],          // tin thô đúng hình dạng API Pancake trả về
  seen: false,          // false = chưa đọc -> bot sẽ xử
  lastSentBy: null,     // có admin_name = shop nhắn cuối -> bot bỏ qua
  the: new Set(),       // thẻ đang gắn
  tenKhach: "Khách thử",
  // ĐƯỜNG VÀO của khách. Đây KHÔNG phải chi tiết trang trí: lõi bot có hẳn một
  // chuỗi 6 tầng để suy ra mẫu từ quảng cáo (tên ad -> map tay/tự học -> caption
  // -> vision), và một đường riêng đọc caption bài viết cho khách từ bình luận.
  // Khung thử trước đây ghi cứng ads: [] / ad_ids: [] nên CẢ HAI đường đó chưa
  // từng chạy một lần nào — mọi kịch bản đều thành "khách nhắn thẳng", tức cảnh
  // duy nhất mà bot KHÔNG thể biết "váy này" là váy nào.
  nguon: null,          // null = nhắn thẳng | {loai:"quang_cao"|"binh_luan", adId, postId}
};

// Id tin phải DUY NHẤT GIỮA CÁC LẦN CHẠY. Trước đây đánh số lại từ tin_1 mỗi
// lần chạy -> sổ "tin đã xử" của lần trước còn nhớ id đó -> bot lặng thinh vì
// tưởng đã trả lời rồi. Kẹp thêm mốc giờ lúc khởi động cho khỏi đụng nhau.
const _MOC = Date.now().toString(36);
let _dem = 0;
const _id = () => `thu_${_MOC}_${++_dem}`;
const _gio = () => new Date().toISOString();

// Ai nhận được cái bot gửi ra (REPL cắm hàm vào đây).
let _nhanBotGui = () => {};
function khiBotGui(fn) { _nhanBotGui = fn; }

// ---- Bơm tin vào hội thoại ----------------------------------------------
function themTinKhach(chu, urlAnh) {
  const atts = urlAnh ? [{ type: "photo", url: urlAnh }] : [];
  trangThai.tinNhan.push({
    id: _id(),
    type: "INBOX",
    from: { id: psidHienTai(), name: trangThai.tenKhach },
    message: chu || "",
    original_message: chu || "",
    attachments: atts,
    inserted_at: _gio(),
  });
  // Khách vừa nhắn => chưa đọc, khách là người nhắn cuối => bot phải xử.
  trangThai.seen = false;
  trangThai.lastSentBy = null;
}

function themTinShop(chu) {
  trangThai.tinNhan.push({
    id: _id(),
    type: "INBOX",
    from: { id: PAGE_ID_GIA, name: "Page Thử", admin_name: "Bot" },
    message: chu || "",
    original_message: chu || "",
    attachments: [],
    inserted_at: _gio(),
  });
  // Shop vừa nhắn => bot không xử lại vòng sau (đúng như thật).
  trangThai.seen = true;
  trangThai.lastSentBy = { admin_name: "Bot" };
}

// Giả lập NHÂN VIÊN THẬT trả lời khách. Khác themTinShop (tin của bot):
// tin này mang TÊN nhân viên, và id KHÔNG nằm trong sổ botSentIds của lõi bot,
// nên isHumanInboxMsg() nhận ra là người thật.
//
// Cần cho việc thử luật chốt 25/08/2026: "chỉ khi nhân viên vào TRẢ LỜI và GỠ
// thẻ thì bot mới được trả lời tiếp". Không có hàm này thì không dựng được cảnh
// đó, và cũng không phân biệt được "gỡ thẻ rồi" với "gỡ thẻ + đã trả lời".
function themTinNhanVien(chu, tenNhanVien) {
  trangThai.tinNhan.push({
    id: _id(),
    type: "INBOX",
    from: { id: PAGE_ID_GIA, name: "Page Thử", admin_name: String(tenNhanVien || "Nguyễn Yến") },
    message: chu || "",
    original_message: chu || "",
    attachments: [],
    inserted_at: _gio(),
  });
  trangThai.seen = true;
  trangThai.lastSentBy = { admin_name: String(tenNhanVien || "Nguyễn Yến") };
}

// Gắn / gỡ thẻ bằng tay như nhân viên làm trên Pancake.
function nhanVienGanThe(id) { trangThai.the.add(String(id)); }
function nhanVienGoThe(id) { trangThai.the.delete(String(id)); }

function xoaHoiThoai() {
  trangThai.tinNhan.length = 0;
  trangThai.seen = false;
  trangThai.lastSentBy = null;
  trangThai.the.clear();
  trangThai.nguon = null;   // khách mới = đường vào mới, không thừa hưởng ad cũ
  // CỐ Ý KHÔNG đặt lại _dem. Id tin phải DUY NHẤT trong cả lần chạy, không chỉ
  // trong một hội thoại. Đặt lại về 0 thì tin đầu của MỌI hội thoại đều mang id
  // "thu_<mốc>_1" -> lõi bot coi cụm tin của khách thứ hai là "đã xử lý rồi".
  //
  // Trước 25/08/2026 lỗi này bị CHE: ngoại lệ _unreadCustomerWaiting bỏ qua kiểm
  // tra tin-đã-xử cho mọi hội thoại chưa đọc. Sáng 25/08 vá chỗ đó (chặn xử lại
  // cùng một tin) là lộ ngay: chạy 44 kịch bản thì 24 cái "câm hoàn toàn", trong
  // khi bot không hề sai — nó chỉ thấy toàn tin đã xử.
}

// Sang một KHÁCH MỚI: đổi suất hội thoại rồi xoá sạch. Bot sẽ coi đây là
// người hoàn toàn khác, không mang theo thẻ giữ hay trí nhớ của kịch bản trước.
function hoiThoaiMoi() {
  _suat = (_suat + 1) % SO_SUAT;
  xoaHoiThoai();
  return convHienTai();
}

// Khai ĐƯỜNG VÀO cho hội thoại đang diễn. Gọi sau hoiThoaiMoi().
//   datNguon({ loai: "quang_cao", adId: "120254257724490550" })
//   datNguon({ loai: "quang_cao", postId: "1556179812730178" })
//   datNguon({ loai: "binh_luan", postId: "1555383752809784" })
//   datNguon(null)  hoặc  { loai: "nhan_thang" }   -> khách tự nhắn vào page
function datNguon(n) {
  if (!n || n.loai === "nhan_thang") { trangThai.nguon = null; return null; }
  trangThai.nguon = {
    loai: n.loai,
    adId: n.adId ? String(n.adId) : null,
    postId: n.postId ? String(n.postId) : null,
    caption: n.caption ? String(n.caption) : "",   // lời bài viết — nguồn chính để suy ra mẫu
    anhBai: Array.isArray(n.anhBai) ? n.anhBai : [],
  };
  return trangThai.nguon;
}

function _adsCuaNguon() {
  const n = trangThai.nguon;
  if (!n || n.loai !== "quang_cao") return [];
  // Hình dạng khớp Pancake thật: ads[] có ad_id, post_id, inserted_at (lõi bot
  // sắp xếp theo inserted_at để lấy ad MỚI NHẤT = ad khách vừa bấm).
  return [{
    ad_id: n.adId || null,
    post_id: n.postId ? `${PAGE_ID_GIA}_${n.postId}` : null,
    inserted_at: trangThai.tinNhan.length ? trangThai.tinNhan[0].inserted_at : _gio(),
  }];
}

function _adIdsCuaNguon() {
  const n = trangThai.nguon;
  return (n && n.loai === "quang_cao" && n.adId) ? [n.adId] : [];
}

function moTaHoiThoai() {
  return {
    id: convHienTai(),
    page_id: PAGE_ID_GIA,
    type: (trangThai.nguon && trangThai.nguon.loai === "binh_luan") ? "COMMENT" : "INBOX",
    from: { id: psidHienTai(), name: trangThai.tenKhach },
    seen: trangThai.seen,
    last_sent_by: trangThai.lastSentBy,
    updated_at: trangThai.tinNhan.length
      ? trangThai.tinNhan[trangThai.tinNhan.length - 1].inserted_at
      : _gio(),
    inserted_at: trangThai.tinNhan.length ? trangThai.tinNhan[0].inserted_at : _gio(),
    snippet: trangThai.tinNhan.length
      ? String(trangThai.tinNhan[trangThai.tinNhan.length - 1].message || "").slice(0, 80)
      : "",
    tags: [...trangThai.the].map(id => ({ id })),

    // ---- MẤY TRƯỜNG DƯỚI ĐÂY LÀ BẮT BUỘC, ĐỪNG BỎ ----------------------
    // Lõi bot phân biệt "hội thoại lấy từ DANH SÁCH" với "hội thoại do webhook
    // đẩy vào" bằng đúng một phép thử: `Array.isArray(conversation.ads)`.
    // Webhook không bao giờ mang `ads`, còn danh sách thì luôn có.
    //
    // Thiếu `ads` -> bot tưởng đây là hội thoại webhook -> gặp câu hỏi giá
    // chung nó HOÃN gallery và chờ "LIST xác nhận ad", lặp mãi tới khi hết
    // 90 giây mới chịu trả lời. Ngồi chat thì tưởng bot chết.
    // (Log lõi: "[Bắt đầu] tới hạn 22s nhưng lượt này là WEBHOOK ...")
    // Khách từ QUẢNG CÁO: Pancake trả ad_id (và thường cả post_id của bài ad) ở
    // ĐÂY, trong object hội thoại của danh sách v2 — API tin nhắn KHÔNG có.
    // Đây chính là nguồn mà bot tra ad_learned_map.json (1.110 dòng) để ra mẫu.
    // Khách nhắn thẳng -> vẫn phải là MẢNG RỖNG, đừng bỏ trường: lõi bot phân
    // biệt "hội thoại từ DANH SÁCH" với "hội thoại do webhook đẩy" bằng đúng
    // phép thử Array.isArray(conversation.ads).
    ads: _adsCuaNguon(),
    ad_ids: _adIdsCuaNguon(),

    // Vài trường nữa cho khớp hình dạng thật của API v2 (đã đối chiếu với
    // hội thoại thật: id, type, tags, seen, from, snippet, inserted_at,
    // updated_at, message_count, page_id, ..., ads, ad_ids, ...).
    message_count: trangThai.tinNhan.length,
    has_phone: false,
    post_id: (trangThai.nguon && trangThai.nguon.loai === "binh_luan")
      ? (trangThai.nguon.postId || null) : null,
    customers: [{ id: psidHienTai(), name: trangThai.tenKhach }],
    assignee_ids: [],
    tag_histories: [],
  };
}

// ---- Phân loại host ------------------------------------------------------
const CHO_QUA = [
  "api.openai.com",
  "oauth2.googleapis.com", "www.googleapis.com", "sheets.googleapis.com",
  "docs.googleapis.com", "drive.googleapis.com", "accounts.google.com",
  "lh3.googleusercontent.com", "drive.google.com",
];
const CHAN = {
  "pos.pages.fm": "POS — đây là nơi TẠO ĐƠN THẬT",
  "graph.facebook.com": "Facebook Ads — không cần khi chat thử",
  "hook.nysaki.vn": "webhook nhận tin thật",
};
const LA_ANH = /(fbcdn|cdninstagram|scontent)/i;

function traLoiJson(obj, status = 200) {
  const chu = JSON.stringify(obj);
  return new Response(chu, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---- Cài đặt bộ chặn -----------------------------------------------------
function catCau() {
  const fetchThat = globalThis.fetch;

  globalThis.fetch = async function (dauVao, tuyChon) {
    const url = String((dauVao && dauVao.url) || dauVao || "");
    const cach = String((tuyChon && tuyChon.method) || "GET").toUpperCase();

    let host = "";
    try { host = new URL(url).hostname; } catch (_) { host = ""; }

    // 1) Pancake -> giả lập trọn vẹn
    if (host === "pages.fm") return giaLapPancake(url, cach, tuyChon);

    // 2) Chặn cứng, nêu rõ lý do
    if (CHAN[host]) {
      throw new Error(
        `[GIẢ LẬP] CHẶN gọi ra ${host} — ${CHAN[host]}. ` +
        `Môi trường thử không được phép đụng vào đây.`
      );
    }

    // 3) Cho qua: AI thật, kịch bản thật, ảnh thật
    if (CHO_QUA.includes(host) || LA_ANH.test(host)) return fetchThat(dauVao, tuyChon);

    // 4) Không khai báo = không cho đi (thà ồn còn hơn lọt)
    throw new Error(
      `[GIẢ LẬP] CHẶN host lạ: ${host || url.slice(0, 60)}. ` +
      `Muốn cho phép thì thêm vào CHO_QUA trong pancake_gia_lap.js.`
    );
  };
}

// ---- Bộ giả lập API Pancake ---------------------------------------------
async function giaLapPancake(url, cach, tuyChon) {
  const duong = (() => { try { return new URL(url).pathname; } catch (_) { return url; } })();

  let than = null;
  try { than = tuyChon && tuyChon.body ? JSON.parse(tuyChon.body) : null; } catch (_) { than = null; }

  // Danh sách page (page_registry gọi lúc khởi động)
  if (/\/api\/v1\/pages$/.test(duong)) {
    return traLoiJson({
      success: true,
      categorized: [{ pages: [{ id: PAGE_ID_GIA, name: "Page Thử", page_access_token: "TOKEN_GIA" }] }],
    });
  }

  // Gửi tin  (POST .../conversations/<id>/messages)
  if (/\/conversations\/[^/]+\/messages$/.test(duong) && cach === "POST") {
    const chu = String((than && than.message) || "").trim();
    const anh = (than && (than.content_ids || than.image_urls || than.urls)) || null;
    if (chu) { themTinShop(chu); _nhanBotGui("chu", chu); }
    if (anh && anh.length) _nhanBotGui("anh", anh);
    return traLoiJson({ success: true, message_id: _id() });
  }

  // Đọc tin  (GET .../conversations/<id>/messages)
  // Khách từ BÌNH LUẬN: bài viết đi kèm nằm ở ĐÂY, trong thân trả lời của API
  // tin nhắn — KHÔNG phải ở object hội thoại. pancake_reader đọc đúng hai chỗ:
  //   postId      = data.post.id   hoặc  data.post_id
  //   postCaption = data.post.message
  // Thiếu chúng thì bot không có caption để suy ra mẫu, và ta lại tưởng đường
  // bình luận của bot hỏng — trong khi thật ra khung thử không đưa bài cho nó.
  if (/\/conversations\/[^/]+\/messages$/.test(duong)) {
    // MỘT hội thoại một lúc. trangThai là kho DUY NHẤT, nên nếu trả nguyên kho
    // cho MỌI id thì:
    //   · hội thoại của kịch bản TRƯỚC (lõi bot còn giữ trong hàng đợi) nhận
    //     được tin của kịch bản ĐANG diễn -> bot đánh dấu mấy id tin ấy "đã xử
    //     lý" dưới tên hội thoại cũ;
    //   · tới lượt hội thoại THẬT của kịch bản thì cả cụm đã nằm trong sổ
    //     chống-trùng -> "[BỎ QUA] không còn tin MỚI" -> bot câm.
    //   · id giả "khong-theo-doi-ai" (lõi bot đọc chỉ để in log THEO DÕI) cũng
    //     kéo về nguyên cụm tin đang sống, thêm một đường đánh dấu nhầm nữa.
    // Đo 25/08/2026: 9/10 kịch bản báo "bot không nói câu nào" vì đúng chuỗi này.
    // Thắng thua tuỳ thứ tự vòng poll nên lúc chạy được lúc không — càng khó ngờ.
    // Nay: chỉ hội thoại ĐANG diễn mới có tin, id khác trả rỗng.
    const _convHoi = (duong.match(/conversations\/([^/]+)\/messages$/) || [])[1] || "";
    const _dungHoiThoai = decodeURIComponent(_convHoi) === convHienTai();
    const ra = { success: true, messages: _dungHoiThoai ? trangThai.tinNhan : [] };
    if (process.env.GIA_LAP_DEBUG) {
      const _cv = (duong.match(/conversations\/([^/]+)\//) || [])[1] || "?";
      require("fs").appendFileSync("botlog/gia_lap_debug.log",
        `DOC conv=${_cv} suat=${_suat} dung=${_dungHoiThoai} tra_ve=[${(ra.messages || []).map(m => m.id + ":" + m.type).join(",")}]
`);
    }
    const n = trangThai.nguon;
    if (n && n.loai === "binh_luan" && n.postId) {
      ra.post_id = n.postId;
      ra.post = {
        id: n.postId,
        message: n.caption || "",
        attachments: (n.anhBai || []).map(u => ({ type: "photo", url: u })),
      };
    }
    return traLoiJson(ra);
  }

  // Gắn / gỡ thẻ
  if (/\/conversations\/[^/]+\/tags$/.test(duong)) {
    const idThe = String((than && (than.tag_id ?? than.tagId)) ?? "");
    if (cach === "DELETE" || (than && (than.action === "remove" || than.action === "delete"))) {
      trangThai.the.delete(idThe); _nhanBotGui("go_the", idThe);
    } else if (idThe) {
      trangThai.the.add(idThe); _nhanBotGui("gan_the", idThe);
    }
    return traLoiJson({ success: true });
  }

  // Đánh dấu chưa đọc / ghi chú nội bộ
  if (/\/conversations\/[^/]+\/(unread|notes?)$/.test(duong)) {
    if (/notes?$/.test(duong)) _nhanBotGui("ghi_chu", String((than && (than.message || than.note)) || ""));
    return traLoiJson({ success: true });
  }

  // Danh sách hội thoại (vòng poll 4 giây)
  // Hội thoại RỖNG thì đừng khoe ra: bot sẽ nhặt lên rồi than "batch rỗng",
  // vừa bẩn log vừa làm nó ghi nhớ một lượt hỏng trước khi khách kịp nói gì.
  if (/\/conversations$/.test(duong)) {
    const ds = trangThai.tinNhan.length ? [moTaHoiThoai()] : [];
    return traLoiJson({ success: true, total: ds.length, conversations: ds });
  }

  // Đường dẫn Pancake chưa dạy -> trả rỗng nhưng báo để còn bổ sung
  return traLoiJson({ success: true, _giaLap: "chua_day", _duong: duong, messages: [], conversations: [] });
}

// ---- Chặn ghi đè lên DỮ LIỆU THẬT ---------------------------------------
// Lõi bot ghi thẳng vào mấy tệp dữ liệu của shop bằng đường dẫn CỨNG (không có
// biến môi trường để đổi). Chạy thử mà để nguyên thì hội thoại giả sẽ lẫn vào
// sổ sách thật — đúng lỗi đã xảy ra một lần: id tin giả lọt vào
// processed_messages.json rồi khiến chính bot lặng thinh ở lần chạy sau.
//
// Cách bịt: một chốt duy nhất ở tầng fs, y như đã làm với fetch. Mọi lệnh GHI
// vào các tệp dưới đây bị bẻ sang thư mục tạm. ĐỌC thì vẫn cho đọc bản thật
// (bảng hàng, map quảng cáo... chỉ đọc nên vô hại).
const TEP_CAN_GIU = new Set([
  "processed_messages.json",     // sổ tin đã xử
  "bot_dup_sent.json",           // chống gửi trùng
  "pending_followups.json",      // hẹn nhắc lại
  "orders_state.json",           // trạng thái đơn
  "ad_learned_map.json",         // map quảng cáo tự học
  "ad_product_map.json",
  "conversation_memory.json",    // bộ nhớ hội thoại bản cũ
]);

let THU_MUC_TAM = null;
function thuMucTam() {
  if (!THU_MUC_TAM) {
    const os = require("os"), fs = require("fs"), path = require("path");
    THU_MUC_TAM = fs.mkdtempSync(path.join(os.tmpdir(), "chat_thu_"));
  }
  return THU_MUC_TAM;
}

function chuyenHuongGhi() {
  const fs = require("fs");
  const path = require("path");

  const beDuong = p => {
    try {
      const s = String(typeof p === "string" ? p : (p && p.toString) ? p.toString() : "");
      if (!s) return p;
      const ten = path.basename(s);
      if (!TEP_CAN_GIU.has(ten)) return p;
      // Chỉ bẻ khi đúng là tệp nằm cạnh mã nguồn (tệp thật của shop).
      if (path.resolve(path.dirname(s)) !== path.resolve(__goc)) return p;
      return path.join(thuMucTam(), ten);
    } catch (_) { return p; }
  };

  for (const ten of ["writeFileSync", "writeFile", "appendFileSync", "appendFile", "createWriteStream", "renameSync", "unlinkSync"]) {
    const goc = fs[ten];
    if (typeof goc !== "function") continue;
    fs[ten] = function (duong, ...con) { return goc.call(fs, beDuong(duong), ...con); };
  }
}

// ---- Dựng cả môi trường thử trong một lời gọi ---------------------------
// Phải gọi TRƯỚC khi require("../../bot_worker_api_v3.js").
// dotenv không ghi đè biến đã có -> đặt ở đây thì .env thua, mình thắng.
// Riêng OPENAI_API_KEY và Google vẫn để .env nạp (cần AI thật, kịch bản thật).
function dungMoiTruongThu({ batAI = false } = {}) {
  process.env.PANCAKE_PAGE_ID = PAGE_ID_GIA;
  process.env.PANCAKE_PAGE_ACCESS_TOKEN = "TOKEN_GIA";
  process.env.PANCAKE_USER_ACCESS_TOKEN = "";   // đừng đi liệt kê page thật
  process.env.ORDER_DRY_RUN = "1";              // không bao giờ tạo đơn thật
  process.env.CHI_XU_LY_IDS = DS_CONV.join(",");   // chỉ đụng mấy hội thoại giả này
  process.env.SONG_SONG = "1";                  // tuần tự cho log dễ đọc
  process.env.MAX_MOI_NHIP = "5";
  process.env.GIAMSAT_TU_THOAT = "off";         // đừng tự thoát giữa chừng
  process.env.CANH_BAO_WEBHOOK = "";
  process.env.WEBHOOK_PULL_URL = "";
  process.env.FB_ADS_TOKEN = "";                // khỏi đồng bộ quảng cáo
  process.env.FB_ADS_ACCOUNT_IDS = "";
  process.env.HOA_API_MODE = "gia_lap";
  // Tách hẳn kho dữ liệu: CSDL riêng, mã shop riêng, sổ log lượt riêng.
  // (Ba thứ này lõi bot có sẵn biến môi trường để đổi — dùng cho đúng ý.)
  const path_ = require("path");
  process.env.MEMORY_DB = path_.join(thuMucTam(), "bo_nho_thu.db");
  process.env.SHOP_ID = "mysp_thu";
  process.env.TURNLOG_DIR = path_.join(thuMucTam(), "turnlog");

  // Còn lại là mấy tệp đường dẫn CỨNG -> bẻ ở tầng fs.
  chuyenHuongGhi();
  // Lõi bot có danh sách "theo dõi" CỨNG (nick thật + 1 hội thoại thật của
  // MYS.P). ĐỂ TRỐNG LÀ RƠI VỀ MẶC ĐỊNH ĐÓ -> phải khai một giá trị không khớp ai.
  //
  // TRƯỚC ĐÂY khai cả 30 hội thoại giả. Hậu quả đo được 24/08/2026: mỗi vòng poll
  // bot đọc tin của cả 30 id chỉ để IN LOG theo dõi -> "[REQ] 38 request / 10s |
  // doc-tin-nhan: 37". Vòng lặp bị bóp nghẹt, kịch bản chờ hết 50 giây mà bot
  // chưa kịp tới lượt -> bản ghi kết luận "bot câm hoàn toàn" trong khi bot chỉ
  // đang xếp hàng. Cùng lúc đẻ ra hàng nghìn dòng "[THEO DÕI/tin]" làm log không
  // đọc nổi (một lần chạy: 3.889 dòng).
  //
  // Log theo dõi chỉ để chẩn đoán, không ảnh hưởng hành vi -> tắt hẳn.
  process.env.WATCH_IDS = "khong-theo-doi-ai";
  process.env.WATCH_NAMES = "khong-theo-doi-ai";
  if (batAI) process.env.AI_REPLY_MODE = "on";

  catCau();

  // pages.json THẬT nằm cạnh mã nguồn -> page_registry sẽ nạp 4 page thật.
  // Không có hại (mọi lời gọi pages.fm đều bị giả lập) nhưng làm log rối và
  // dễ khiến người đọc tưởng đang chạy trên page thật. Thay bằng sổ 1 page giả.
  const duong = require.resolve("./page_registry.js");
  const soPage = [{ id: PAGE_ID_GIA, token: "TOKEN_GIA", name: "Page Thử" }];
  require.cache[duong] = {
    id: duong, filename: duong, loaded: true,
    exports: {
      init: async () => soPage,
      getToken: () => "TOKEN_GIA",
      tokenForConv: () => "TOKEN_GIA",
      pageIdFromConv: convId => {
        const s = String(convId || ""); const i = s.indexOf("_");
        return i > 0 ? s.slice(0, i) : "";
      },
      listPages: () => soPage,
      pageName: () => "Page Thử",
      isKnownPage: id => String(id) === PAGE_ID_GIA,
    },
  };
}

module.exports = {
  PAGE_ID_GIA, PSID_GIA, CONV_ID,
  trangThai, catCau, khiBotGui, dungMoiTruongThu, thuMucTam,
  // Xuất riêng để `chay_mfs.js` dùng lại đúng chốt này mà KHÔNG kéo theo phần
  // giả lập fetch — chạy trên mfs thì mạng phải là mạng thật.
  chuyenHuongGhi, TEP_CAN_GIU,
  themTinKhach, themTinShop, themTinNhanVien, nhanVienGanThe, nhanVienGoThe,
  xoaHoiThoai, hoiThoaiMoi, moTaHoiThoai, datNguon,
  convHienTai, psidHienTai, DS_CONV,
};
