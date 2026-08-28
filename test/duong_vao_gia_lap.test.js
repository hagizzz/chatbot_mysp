// ============================================================================
// test/duong_vao_gia_lap.test.js — KHUNG THỬ PHẢI DỰNG ĐƯỢC ĐƯỜNG VÀO CỦA KHÁCH
// ----------------------------------------------------------------------------
// Khách nhắn "váy này bao nhiêu" thì bot biết là váy nào hay không phụ thuộc
// hoàn toàn vào ĐƯỜNG VÀO: bấm quảng cáo, bình luận dưới bài, hay tự nhắn thẳng.
// Lõi bot có chuỗi 6 tầng suy ra mẫu từ quảng cáo (tên ad -> map tay/tự học ->
// caption -> vision) và đường đọc caption bài viết cho khách từ bình luận.
//
// Khung thử trước 24/08/2026 ghi cứng `ads: []` / `ad_ids: []`, nên CẢ HAI đường
// đó chưa từng chạy lần nào: mọi kịch bản đều thành khách nhắn thẳng — đúng cái
// cảnh duy nhất bot KHÔNG thể biết mẫu. Chấm điểm bot trên đó là chấm oan.
//
// Test này canh hình dạng dữ liệu khung thử trả ra phải khớp Pancake thật, vì
// lệch một tên trường là bot lại không thấy quảng cáo mà mình chẳng hay biết.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const gl = require("../loi/pancake/pancake_gia_lap");

// Cài bộ chặn fetch của khung giả lập. BẮT BUỘC với mấy test gọi endpoint:
// không cài thì lời gọi đi thẳng ra pages.fm THẬT — test không được chạm mạng.
// node:test chạy mỗi tệp một tiến trình riêng nên vá ở đây không lan sang tệp khác,
// vẫn trả lại fetch gốc lúc xong cho sạch.
const _fetchGoc = globalThis.fetch;
gl.catCau();
test.after(() => { globalThis.fetch = _fetchGoc; });

const DUONG_TIN = "https://pages.fm/api/v1/pages/100000000000001/conversations/x/messages";

function dungLai() {
  gl.xoaHoiThoai();
  gl.themTinKhach("váy này bao nhiêu tiền em", null);
}

test("mặc định = khách NHẮN THẲNG: ads/ad_ids là mảng rỗng, không phải thiếu trường", () => {
  dungLai();
  const c = gl.moTaHoiThoai();
  // Lõi bot phân biệt hội thoại từ DANH SÁCH với hội thoại do webhook đẩy bằng
  // đúng phép thử Array.isArray(conversation.ads). Bỏ trường -> bot tưởng là
  // webhook -> hoãn trả lời tới 90 giây.
  assert.ok(Array.isArray(c.ads), "thiếu mảng ads -> bot tưởng là hội thoại webhook");
  assert.ok(Array.isArray(c.ad_ids), "thiếu mảng ad_ids");
  assert.strictEqual(c.ads.length, 0);
  assert.strictEqual(c.ad_ids.length, 0);
  assert.strictEqual(c.type, "INBOX");
  assert.strictEqual(c.post_id, null);
});

test("khách từ QUẢNG CÁO: ad_id ra đúng chỗ bot đi tìm", () => {
  dungLai();
  gl.datNguon({ loai: "quang_cao", adId: "120254257724490550" });
  const c = gl.moTaHoiThoai();
  assert.deepStrictEqual(c.ad_ids, ["120254257724490550"]);
  assert.strictEqual(c.ads.length, 1);
  assert.strictEqual(c.ads[0].ad_id, "120254257724490550");
  // inserted_at bắt buộc: lõi bot sắp xếp ads theo mốc này để lấy ad MỚI NHẤT
  // (= ad khách vừa bấm) khi một hội thoại dính nhiều ad.
  assert.ok(c.ads[0].inserted_at, "thiếu inserted_at -> bot không chọn được ad mới nhất");
});

test("quảng cáo có post_id: trả về dạng PAGEID_<đuôi> như Pancake thật", () => {
  dungLai();
  gl.datNguon({ loai: "quang_cao", adId: "120254257724490550", postId: "1556179812730178" });
  const c = gl.moTaHoiThoai();
  // Lõi bot cắt đuôi bằng String(post_id).split("_").pop() rồi mới tra map.
  assert.strictEqual(c.ads[0].post_id, "100000000000001_1556179812730178");
  assert.strictEqual(String(c.ads[0].post_id).split("_").pop(), "1556179812730178");
});

test("khách từ BÌNH LUẬN: type=COMMENT và có post_id", () => {
  dungLai();
  gl.datNguon({ loai: "binh_luan", postId: "1555383752809784" });
  const c = gl.moTaHoiThoai();
  assert.strictEqual(c.type, "COMMENT");
  assert.strictEqual(c.post_id, "1555383752809784");
  assert.strictEqual(c.ads.length, 0, "khách bình luận không phải khách quảng cáo");
});

test("khách MỚI thì đường vào phải sạch, không thừa hưởng quảng cáo cũ", () => {
  dungLai();
  gl.datNguon({ loai: "quang_cao", adId: "120254257724490550" });
  gl.hoiThoaiMoi();
  gl.themTinKhach("alo shop", null);
  const c = gl.moTaHoiThoai();
  assert.strictEqual(c.ad_ids.length, 0, "khách mới vẫn dính ad của kịch bản trước");
  assert.strictEqual(c.type, "INBOX");
});

test("ad_id trong kịch bản phải là ad CÓ THẬT trong bản đồ, nếu không thử cũng vô nghĩa", () => {
  // Khai một ad_id bịa thì chuỗi suy-ra-mẫu chắc chắn trượt, và ta lại tưởng
  // bot hỏng. Mấy id dùng trong test này phải tra ra mẫu thật.
  const map = require("../ad_learned_map.json");
  for (const id of ["120254257724490550", "1556179812730178", "1555383752809784"]) {
    assert.ok(map[id], `ad_learned_map.json không có "${id}" — đổi sang id khác trong bản đồ`);
  }
});

test("khách từ BÌNH LUẬN: bài viết phải nằm trong THÂN TRẢ LỜI của API tin nhắn", async () => {
  // pancake_reader đọc bài ở data.post / data.post_id của API TIN NHẮN, không
  // phải ở object hội thoại. Đặt nhầm chỗ thì postCaption rỗng -> bot không có
  // gì để suy ra mẫu, và ta lại tưởng đường bình luận của bot hỏng.
  dungLai();
  gl.datNguon({ loai: "binh_luan", postId: "1555383752809784", caption: "GIANNAL DRESS — váy tay bồng" });

  const res = await fetch(DUONG_TIN);
  const d = await res.json();
  assert.strictEqual(d.post_id, "1555383752809784");
  assert.ok(d.post, "thiếu data.post -> reader không lấy được caption");
  assert.strictEqual(d.post.id, "1555383752809784");
  assert.match(d.post.message, /GIANNAL/);
});

test("khách QUẢNG CÁO / NHẮN THẲNG thì API tin nhắn KHÔNG kèm bài", async () => {
  dungLai();
  gl.datNguon({ loai: "quang_cao", adId: "120254257724490550" });
  const d = await (await fetch(DUONG_TIN)).json();
  assert.strictEqual(d.post_id, undefined);
  assert.strictEqual(d.post, undefined);
});

test("id tin KHÔNG được lặp giữa các hội thoại", () => {
  // Lỗi đo được 25/08/2026: xoaHoiThoai() đặt lại bộ đếm về 0, nên tin đầu của
  // MỌI hội thoại đều mang id "thu_<mốc>_1". Lõi bot coi cụm tin của khách thứ
  // hai là "đã xử lý rồi" -> chạy 44 kịch bản thì 24 cái câm, mà bot không hề sai.
  // Trước đó lỗi bị che vì ngoại lệ _unreadCustomerWaiting bỏ qua kiểm tra.
  const thay = new Set();
  for (let i = 0; i < 5; i++) {
    gl.hoiThoaiMoi();
    gl.themTinKhach("tin " + i, null);
    const id = gl.trangThai.tinNhan[0].id;
    assert.ok(!thay.has(id), `id "${id}" lặp lại ở hội thoại thứ ${i + 1}`);
    thay.add(id);
  }
});

test("xoaHoiThoai KHÔNG đặt lại bộ đếm id", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "loi/pancake/pancake_gia_lap.js"), "utf8");
  const i = src.indexOf("function xoaHoiThoai");
  assert.ok(i > 0, "khong thay xoaHoiThoai");
  // Cắt đúng thân hàm, không lấn sang hàm kế (hoiThoaiMoi cũng nhắc tới _dem).
  const k = src.slice(i, src.indexOf(String.fromCharCode(10) + "}", i));
  const dongMa = k.split(String.fromCharCode(10)).filter(d => !d.trim().startsWith("//"));
  assert.ok(!dongMa.some(d => /_dem\s*=\s*0/.test(d)),
    "còn đặt lại _dem -> id tin lại trùng giữa các hội thoại");
});
