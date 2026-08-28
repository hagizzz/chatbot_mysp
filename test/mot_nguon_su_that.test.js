// ============================================================================
// test/mot_nguon_su_that.test.js — CHỐT MỘT NGUỒN SỰ THẬT
// ----------------------------------------------------------------------------
// Ba thứ bước 2 vừa chốt, mỗi thứ một nhóm test:
//   1) Tên bot chỉ được khai MỘT nơi (danh_tinh_bot.js).
//   2) Kịch bản và code không được mâu thuẫn — có bộ soi tự động bắt.
//   3) Ranh giới "code lo số / kịch bản lo lời" phải được thi hành BẰNG CÙNG
//      MỘT bộ soi ở mọi đường AI, không phải mỗi đường một kiểu.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const danhTinh = require("../loi/ai/danh_tinh_bot");
const soiKB = require("../loi/cau_noi/soi_kich_ban");
const { vetAdvisoryReply } = require("../loi/ai/reply_guard");

const GOC = path.join(__dirname, "..");
// [DỌN 27/08/2026] Mã đã chia thư mục (loi/, cong_cu/, thu_nghiem/). Test đọc mã
// nguồn theo TÊN TỆP nên phải tự dò chỗ — cứng đường dẫn vào đây là mỗi lần dọn
// thư mục lại phải sửa hàng loạt test.
function _timTep(f) {
  for (const d of ["", "loi/ai", "loi/pancake", "loi/cau_noi", "loi/don", "loi/san_pham", "loi/bo_nho", "loi/tien_ich", "cong_cu", "thu_nghiem"]) {
    const p = require("path").join(GOC, d, f);
    if (require("fs").existsSync(p)) return p;
  }
  return require("path").join(GOC, f);
}
const doc = f => fs.readFileSync(_timTep(f), "utf8");

// --- 1) TÊN BOT ------------------------------------------------------------
test("tên bot đọc được và đổi được qua biến môi trường", () => {
  assert.ok(danhTinh.TEN_BOT.length >= 2);
  assert.ok(danhTinh.nhacDanhTinh().includes(danhTinh.TEN_BOT));
});

test("KHÔNG nơi nào ngoài danh_tinh_bot được viết cứng tên bot", () => {
  // Đây chính là lỗi cũ: bot_worker khai "Bảo Trâm", kịch bản khai "Bảo Châu",
  // prompt phải tuyên bố "tên này ưu tiên hơn kịch bản" mới thắng được.
  const ten = danhTinh.TEN_BOT;
  for (const f of ["bot_worker_api_v3.js", "reasoning_engine.js", "kich_ban/luat.txt"]) {
    const noiDung = doc(f);
    assert.ok(!noiDung.includes(`"${ten}"`) && !noiDung.includes(`**${ten}**`),
      `${f} còn viết cứng tên bot "${ten}" — phải đọc từ danh_tinh_bot.js`);
  }
});

test("prompt của reasoning_engine chèn tên từ nguồn duy nhất", () => {
  assert.ok(doc("reasoning_engine.js").includes("danhTinh.nhacDanhTinh()"),
    "prompt phải lấy tên qua danh_tinh_bot, không viết cứng");
});

// --- 2) SOI MÂU THUẪN KỊCH BẢN ---------------------------------------------
test("đọc được luật 'không dùng từ X' ra khỏi kịch bản", () => {
  const luat = soiKB.docLuat('Xưng hô: em – chị (tuyệt đối không dùng từ "bạn")\nKhông dùng từ "giữ"');
  assert.deepStrictEqual(luat.tuCam.sort(), ["bạn", "giữ"]);
});

test("bắt được câu viết cứng vi phạm từ cấm, kèm đúng vị trí", () => {
  const cauCode = [
    { van: "da em giu san tai showroom cho chi nha", viTri: "bot_worker_api_v3.js:816" },
    { van: "da chi cho em xin size minh hay mac nha", viTri: "bot_worker_api_v3.js:900" }
  ];
  const { loi } = soiKB.soi('Không dùng từ "giữ"', cauCode, "Bảo Trâm");
  const viPham = loi.filter(l => l.loai === "vi-pham-tu-cam");
  assert.strictEqual(viPham.length, 1);
  assert.deepStrictEqual(viPham[0].viTri, ["bot_worker_api_v3.js:816"]);
});

test("KHÔNG báo oan: 'giữ' không được ăn vào 'giữa'", () => {
  const cauCode = [{ van: "chi mac o giua nguoi thi vua dep", viTri: "x.js:1" }];
  const { loi } = soiKB.soi('Không dùng từ "giữ"', cauCode, "Bảo Trâm");
  assert.strictEqual(loi.filter(l => l.loai === "vi-pham-tu-cam").length, 0);
});

test("kịch bản khai tên khác code -> báo NẶNG", () => {
  const { loi } = soiKB.soi("Tên: Bảo Châu\n", [], "Bảo Trâm");
  const l = loi.find(x => x.loai === "khai-ten-hai-noi");
  assert.ok(l, "phải bắt được việc kịch bản khai tên");
  assert.strictEqual(l.muc, "nang");
});

test("kich_ban/luat.txt hiện tại KHÔNG còn khai tên bot", () => {
  assert.strictEqual(soiKB.docLuat(doc("kich_ban/luat.txt")).tenTrongKichBan, null);
});

// --- 3) RANH GIỚI CODE / KỊCH BẢN ------------------------------------------
test("5 phom code của đường AI-QUYẾT đều PASS bộ soi chung", () => {
  // Nếu phom code mà bị chính bộ soi chặn thì bật RANH_GIOI_MODE=on sẽ làm bot câm.
  const phom = [
    "Dạ em nhận được thông tin của chị rồi ạ, chị cho em xin số điện thoại để em lên đơn cho mình nha ạ",
    "Dạ chị cho em xin địa chỉ nhận hàng (số nhà, phường/xã, tỉnh/thành) để em lên đơn cho mình nha ạ",
    "Dạ khu vực của mình có thay đổi tên tỉnh/thành theo cập nhật hành chính mới, chị xác nhận giúp em địa chỉ đang ở TỈNH/THÀNH PHỐ nào ạ? 🥰",
    "Dạ chị cho em xin chiều cao cân nặng để em tư vấn size chuẩn cho mình nha",
    "Dạ chị lấy màu nào ạ để em lên đơn cho mình nha"
  ];
  for (const p of phom) {
    const v = vetAdvisoryReply(p);
    assert.ok(v.allow, `phom code bị chặn (${v.reasons.join(",")}): "${p.slice(0, 50)}"`);
  }
});

test("bộ soi chung chặn đúng thứ mà bộ lọc một-dòng cũ để lọt", () => {
  // Bộ lọc cũ của đường AI-QUYẾT: chỉ bắt số kèm "đ/vnđ".
  const locCu = t => /\d[\d.,]{2,}\s*(đ|vnđ|vnd)\b/i.test(t);
  const lotLuoiCu = [
    "Dạ đơn của mình 990k, bên em freeship luôn nha chị",
    "Dạ em đã lên đơn cho chị rồi nha, số 0912345678 đúng không ạ",
    "Dạ tổng tiền của chị là 1.190.000 nha"
  ];
  for (const t of lotLuoiCu) {
    assert.strictEqual(locCu(t), false, `dựng sai ca thử: lọc cũ đã chặn "${t}"`);
    assert.strictEqual(vetAdvisoryReply(t).allow, false, `bộ soi chung phải chặn: "${t}"`);
  }
});

test("đường AI-QUYẾT đã dùng bộ soi chung, và mặc định là chế độ bóng", () => {
  const src = doc("bot_worker_api_v3.js");
  assert.ok(src.includes("_cqVet = _cqMsg ? vetAdvisoryReply(_cqMsg)"),
    "đường AI-QUYẾT phải gọi bộ soi chung reply_guard");
  assert.ok(/RANH_GIOI_MODE \|\| "shadow"/.test(src),
    "mặc định phải là shadow — bật thẳng sẽ đổi hành vi bot đang chạy thật");
});
