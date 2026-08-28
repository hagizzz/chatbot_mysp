// ============================================================================
// test/nhan_nguon.test.js — NHÃN NGUỒN PHẢI ĐÚNG, VÀ CHỈ GHI MỘT LẦN
// ----------------------------------------------------------------------------
// nguon_hoi_thoai.js sinh ra để làm đúng một việc: "mỗi hội thoại được gắn dấu
// TỪ QUẢNG CÁO / TỪ BÌNH LUẬN / NHẮN THẲNG để nhân viên nhìn là biết", và để
// đo xem khách đến từ đâu thì chốt đơn nhiều hơn.
//
// Hai lỗi đo được ngày 24/08/2026 khi dò theo từng đường vào:
//
//   1) MỌI khách bình luận bị dán nhãn "🎯 TỪ QUẢNG CÁO".
//      pancake_reader bật data.fromAd cho MỌI hội thoại có bài viết (dòng 709,
//      chú thích ghi rõ "Hội thoại COMMENT cũng có post") để lấy caption suy ra
//      mẫu — việc đó đúng. Nhưng bot_worker đem đúng cờ suy-diễn ấy đi gắn nhãn
//      -> số đo hiệu quả quảng cáo bị thổi lên bằng lượng khách tự nhiên.
//
//   2) Ô ghi chú bị ghi lại mỗi vòng poll: một hội thoại nhận 13 dòng GIỐNG HỆT
//      trong ~40 giây. Cờ chống-lặp chỉ nằm trong RAM, lượt nào bot không trả
//      lời thì mem không được lưu.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { xacDinhNguon, danhDau } = require("../loi/bo_nho/nguon_hoi_thoai");

// --- 1) Phân loại nguồn -----------------------------------------------------
// Đây là phép tính bot_worker làm trước khi gọi danhDau. Chép đúng công thức ở
// bot_worker_api_v3.js; có test bên dưới canh hai bên không trôi khỏi nhau.
const laQuangCao = ({ adCandidates = [], fromAd = false, isCommentOrigin = false }) =>
  (adCandidates.length > 0) || (!!fromAd && !isCommentOrigin);

function nguonCuaCa(ca) {
  return xacDinhNguon({ fromAd: laQuangCao(ca), isCommentOrigin: ca.isCommentOrigin });
}

test("khách BÌNH LUẬN dưới bài -> TỪ BÌNH LUẬN, dù reader đã bật fromAd", () => {
  // Đúng cảnh đo được: hội thoại COMMENT, Pancake KHÔNG báo ad nào
  // (ads/ad_ids rỗng), nhưng reader bật fromAd vì hội thoại có bài viết.
  assert.strictEqual(nguonCuaCa({
    adCandidates: [], fromAd: true, isCommentOrigin: true
  }), "binh_luan");
});

test("khách bấm QUẢNG CÁO -> TỪ QUẢNG CÁO", () => {
  assert.strictEqual(nguonCuaCa({
    adCandidates: [{ adId: "120254257724490550" }], fromAd: true, isCommentOrigin: false
  }), "quang_cao");
});

test("bấm quảng cáo RỒI bình luận -> vẫn TỪ QUẢNG CÁO (tiền đã bỏ ra)", () => {
  // Thứ tự ưu tiên này là CỐ Ý và phải giữ. Cái sai trước đây không phải thứ tự,
  // mà là để một cờ suy-diễn đóng vai bằng chứng bấm quảng cáo.
  assert.strictEqual(nguonCuaCa({
    adCandidates: [{ adId: "120254257724490550" }], fromAd: true, isCommentOrigin: true
  }), "quang_cao");
});

test("khách tự nhắn vào page -> NHẮN THẲNG", () => {
  assert.strictEqual(nguonCuaCa({
    adCandidates: [], fromAd: false, isCommentOrigin: false
  }), "nhan_thang");
});

test("hội thoại INBOX có tín hiệu ad thật từ reader (referral/ad_clicks) -> TỪ QUẢNG CÁO", () => {
  // Không phải ad nào cũng lộ ở conversation.ads: reader còn bắt được qua
  // referral trong tin và data.ad_clicks. Không có bài viết + không phải comment
  // -> fromAd lúc này là tín hiệu thật, phải tin.
  assert.strictEqual(nguonCuaCa({
    adCandidates: [], fromAd: true, isCommentOrigin: false
  }), "quang_cao");
});

// --- 2) Ghi chú chỉ một lần -------------------------------------------------
test("ghi chú nguồn chỉ ghi MỘT lần cho mỗi hội thoại", async () => {
  const daGhi = [];
  const mem = {};
  const goi = () => danhDau({
    conversationId: "p_1", mem,
    chiTiet: { fromAd: true, adId: "123", isCommentOrigin: false },
    ghiChuHam: async (_id, chu) => { daGhi.push(chu); }
  });
  await goi(); await goi(); await goi();
  assert.strictEqual(daGhi.length, 1, `ghi ${daGhi.length} lần — ô ghi chú là chỗ nhân viên đọc, không phải log`);
});

test("bot_worker phải LƯU cờ chống-lặp ngay sau khi ghi chú", () => {
  // Cờ chỉ nằm trong RAM thì lượt nào bot không trả lời là mem không được lưu,
  // vòng poll sau ghi chú lại từ đầu — đó chính là ca 13 dòng trùng nhau.
  const src = fs.readFileSync(path.join(__dirname, "..", "bot_worker_api_v3.js"), "utf8");
  const i = src.indexOf("nguonHoiThoai.danhDau");
  assert.ok(i > 0, "không thấy chỗ gọi nguonHoiThoai.danhDau");
  const khuc = src.slice(i, i + 1200);
  assert.match(khuc, /daGhi\)?\s*\)?\s*updateConversationState/,
    "sau khi ghi chú phải updateConversationState, nếu không cờ chống-lặp mất khi bot không trả lời");
});

test("công thức 'thế nào là quảng cáo thật' ở bot_worker khớp với test này", () => {
  // Test trên chép công thức. Chép thì phải canh, không thì sửa một bên là test
  // vẫn xanh mà bot vẫn dán nhãn sai.
  const src = fs.readFileSync(path.join(__dirname, "..", "bot_worker_api_v3.js"), "utf8");
  assert.match(src, /_adThat\s*=\s*Array\.isArray\(data\.adCandidates\)\s*&&\s*data\.adCandidates\.length\s*>\s*0/,
    "bot_worker đổi cách nhận 'ad thật' — cập nhật laQuangCao() trong test này");
  assert.match(src, /_laQuangCao\s*=\s*_adThat\s*\|\|\s*\(!!data\.fromAd\s*&&\s*!isCommentOrigin\)/,
    "bot_worker đổi công thức nhãn nguồn — cập nhật laQuangCao() trong test này");
});
