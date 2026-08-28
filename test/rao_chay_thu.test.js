// ============================================================================
// test/rao_chay_thu.test.js — HÀNG RÀO CHI_XU_LY_IDS PHẢI Ở CỬA RA
// ----------------------------------------------------------------------------
// Chốt của shop 26/08/2026: "bot chỉ trả lời với mỗi Hà Giang thôi, không được
// đụng khách thật."
//
// Page MYS.P đang sống: 240 hội thoại, khách nhắn liên tục, nhân viên trả lời
// tay. CHI_XU_LY_IDS là hàng rào DUY NHẤT giữ bot khỏi 239 khách còn lại. Một
// lần sót không phải là một cái thẻ sai — là bot nhắn vào mặt khách thật.
//
// TRƯỚC bản vá, rào chỉ có ở HAI chỗ, cả hai trong vòng phân phối (gạn danh sách
// hội thoại, gạn id webhook). An toàn nhờ SUY LUẬN BẮC CẦU: "mọi thứ gửi tin đều
// nạp từ vòng đã gạn". Đúng ở bản đó, nhưng bot có HAI vòng quét chạy NGOÀI vòng
// phân phối (sweepImageResends, quét follow-up) và 276 điểm gọi hàm gửi. Thêm
// một nguồn gửi mới là rào mất hiệu lực mà không ai thấy.
//
// Cùng đúng loại lỗi ngày 25/08: rào isUrgentSpecificDate ở MỘT trong NĂM nơi
// gọi, bốn nhánh còn lại chạy y như cũ.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

// --- 1. Rào phải nằm ở cửa ra, không phải chỉ ở vòng phân phối --------------
test("mọi hàm gửi tin / gắn thẻ đều đi qua bộ bọc rào", () => {
  // Danh sách này = đúng những gì lõi bot lấy từ module sender. Thêm hàm mới mà
  // quên bọc thì test đỏ.
  const PHAI_BOC = [
    "sendInboxMessage", "replyComment", "sendPrivateReply",
    "sendInboxImages", "sendInboxContentIds", "sendInboxImageUrl",
    "sendInboxImageUrls", "sendInboxMessageWithImages",
    "tagChoXuLyVaUnread", "tagXuLyAnh", "tagXuLyAnhVaUnread", "untagXuLyAnh",
    "tagDonUuTienVaUnread", "tagGuiDonGap", "tagAiChot", "addConversationNote"
  ];
  const thieu = PHAI_BOC.filter(t =>
    !new RegExp(`_bocRaCuaRa\\("${t}",\\s*_SENDER\\.${t}\\)`).test(SRC));
  assert.deepStrictEqual(thieu, [],
    "hàm chưa bọc = một đường gửi thẳng tới khách thật, bỏ qua CHI_XU_LY_IDS");
});

test("KHÔNG destructure thẳng từ module sender nữa", () => {
  // Destructure thẳng là lấy hàm GỐC, không qua rào. Đây chính là hình dạng của
  // mã trước bản vá.
  const dong = SRC.split("\n").filter(l => l.includes("require(_MO_DUN_SENDER)"));
  assert.strictEqual(dong.length, 1, "chỉ được có MỘT cửa nhập module gửi");
  assert.match(dong[0], /^const _SENDER = require\(_MO_DUN_SENDER\);/,
    "còn destructure ở đây là các tên đó trỏ vào hàm GỐC, rào vô hiệu");
});

test("không require thẳng ./pancake_sender hay ./mfs_sender ở chỗ khác", () => {
  // Đường lách duy nhất còn lại. Bịt bằng test.
  for (const m of ["./pancake_sender", "./mfs_sender"]) {
    assert.ok(!SRC.includes(`require("${m}")`),
      `require thẳng ${m} là đi vòng qua rào cửa ra`);
  }
});

test("delay KHÔNG bị bọc — nó không nhận conversationId", () => {
  // Bọc delay thì mọi lần chờ đều bị coi là "gửi tới hội thoại undefined" và
  // trả về ngay: bot mất hết nhịp nghỉ, bắn tin dồn cục.
  assert.match(SRC, /const delay = _SENDER\.delay;/,
    "delay phải lấy trực tiếp, không qua bộ bọc");
  assert.ok(!/_bocRaCuaRa\("delay"/.test(SRC), "không được bọc delay");
});

// --- 2. Bộ rào chạy đúng ----------------------------------------------------
function boDoRao(danhSach) {
  const i = SRC.indexOf("function _ngoaiDanhSachTrang(target)");
  assert.ok(i > 0, "không thấy hàm rào");
  const than = SRC.slice(i, SRC.indexOf("\n}", i) + 2);
  const s = { CHI_XU_LY_IDS: new Set(danhSach) };
  new Function("s", "with (s) {" + than + "\n s.f = _ngoaiDanhSachTrang; }")(s);
  return s.f;
}

test("chặn đúng: id không khai thì CHẶN, id khai thì CHO QUA", () => {
  const HA_GIANG = "1468690110033030_28072582612392839";
  const f = boDoRao([HA_GIANG]);
  assert.strictEqual(f(HA_GIANG), false, "Hà Giang phải đi được, không thì ca thử chết");
  // Ba khách THẬT lấy từ log chạy thật 26/08.
  for (const thuc of [
    "1468690110033030_9815387131913748",   // Thi Le Tham Tran — "Gửi size S cho mình lại nha shop"
    "1468690110033030_8835866549861049",   // Huong Pham
    "1468690110033030_37808171635494727"   // Mai Trang
  ]) assert.strictEqual(f(thuc), true, `PHẢI chặn khách thật ${thuc}`);
});

test("không khai CHI_XU_LY_IDS -> KHÔNG chặn gì (bản chạy thật)", () => {
  const f = boDoRao([]);
  assert.strictEqual(f("bat_ky_hoi_thoai_nao"), false,
    "rào bật khi danh sách rỗng thì bản chạy thật của shop câm hoàn toàn");
});

test("id rỗng / null / undefined -> CHẶN khi đang chạy thử", () => {
  // Một nhánh gọi thiếu tham số thì target là undefined. Cho qua là bắn tin đi
  // đâu không biết; chặn là an toàn.
  const f = boDoRao(["conv_thu"]);
  for (const xau of [undefined, null, "", 0]) {
    assert.strictEqual(f(xau), true, `target ${JSON.stringify(xau)} phải bị chặn`);
  }
});

test("so sánh theo CHUỖI — id số không lọt vì khác kiểu", () => {
  const f = boDoRao(["12345_67890"]);
  assert.strictEqual(f("12345_67890"), false);
  assert.strictEqual(f("12345_67891"), true, "sai một chữ số vẫn phải chặn");
});

// --- 3. Vẫn giữ nguyên hai rào cũ ở vòng phân phối --------------------------
test("rào cũ ở vòng phân phối KHÔNG bị bỏ đi", () => {
  // Rào cửa ra là lớp thứ hai, không phải lớp thay thế. Rào ở vòng phân phối còn
  // tiết kiệm cả việc đọc tin + gọi AI cho 239 hội thoại không liên quan.
  assert.match(SRC, /\.filter\(c => !CHI_XU_LY_IDS\.size \|\| CHI_XU_LY_IDS\.has\(String\(c\.id\)\)\)/,
    "mất rào gạn danh sách hội thoại");
  assert.match(SRC, /if \(CHI_XU_LY_IDS\.size && !CHI_XU_LY_IDS\.has\(String\(hid\)\)\) continue;/,
    "mất rào gạn id webhook");
});

test("log khi CHẶN, nhưng không phình", () => {
  const i = SRC.indexOf("function _bocRaCuaRa(ten, fn)");
  const than = SRC.slice(i, SRC.indexOf("\n}", SRC.indexOf("return fn.apply", i)));
  assert.match(than, /RÀO CHẠY THỬ/, "chặn mà im thì không ai biết rào vừa cứu một bàn");
  assert.match(than, /_daCanhBaoChan/, "phải throttle, không thì log ngập mỗi vòng poll");
});
