// test/hang_doi_don.test.js — HÀNG ĐỢI LÊN ĐƠN
// Cái được bảo vệ ở đây là TIỀN: hội thoại đã chốt mà rơi khỏi hàng đợi thì
// khách không nhận được đơn, và không ai biết. Mỗi bài dưới đây khoá một
// đường rơi cụ thể.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const THU_MUC = fs.mkdtempSync(path.join(os.tmpdir(), "hangdoi-"));
process.env.MEMORY_DB = path.join(THU_MUC, "thu.db");
process.env.SHOP_ID = "test";

const hd = require("../loi/don/hang_doi_don");

after(() => {
  hd.dong();
  try { fs.rmSync(THU_MUC, { recursive: true, force: true }); } catch (_) {}
});

test("bot chốt -> hội thoại vào hàng đợi", () => {
  hd.them("PAGE_A1", { pageId: "PAGE" });
  const cho = hd.layCho().map(r => r.conversation_id);
  assert.ok(cho.includes("PAGE_A1"));
  assert.strictEqual(hd.demCho(), 1);
});

test("gọi lại nhiều lần không sinh dòng trùng", () => {
  hd.them("PAGE_A1"); hd.them("PAGE_A1"); hd.them("PAGE_A1");
  assert.strictEqual(hd.layCho().filter(r => r.conversation_id === "PAGE_A1").length, 1);
});

test("lên đơn xong -> rút khỏi hàng đợi, không lên lại lần hai", () => {
  hd.xong("PAGE_A1", "đã lên 1 đơn");
  assert.ok(!hd.layCho().some(r => r.conversation_id === "PAGE_A1"), "đã xong thì không được còn trong hàng chờ");
  assert.strictEqual(hd.xem("PAGE_A1").trang_thai, "xong");
  assert.match(hd.xem("PAGE_A1").ly_do, /đã lên 1 đơn/);
});

test("khách mua lần hai -> hội thoại cũ phải quay lại hàng đợi", () => {
  hd.them("PAGE_A1");
  assert.ok(hd.layCho().some(r => r.conversation_id === "PAGE_A1"), "chốt lại thì phải vào hàng đợi lại");
  assert.strictEqual(hd.xem("PAGE_A1").ly_do, null, "lý do cũ phải được xoá, kẻo đọc log tưởng đã xong");
  hd.xong("PAGE_A1", "xong lần hai");
});

test("cũ trước — không bỏ đói hội thoại chờ lâu", () => {
  for (const id of ["PAGE_B1", "PAGE_B2", "PAGE_B3"]) hd.them(id);
  const cho = hd.layCho().map(r => r.conversation_id);
  assert.deepStrictEqual(cho, ["PAGE_B1", "PAGE_B2", "PAGE_B3"]);
});

test("đếm số lần thử để hội thoại kẹt không trôi qua im lặng", () => {
  assert.strictEqual(hd.danhDauDaThu("PAGE_B1"), 1);
  assert.strictEqual(hd.danhDauDaThu("PAGE_B1"), 2);
  hd.xong("PAGE_B1", "xong");
  assert.strictEqual(hd.danhDauDaThu("PAGE_B1"), 2, "đã xong thì không đếm thêm nữa");
});

test("dọn dòng cũ chỉ đụng vào dòng ĐÃ XONG", () => {
  hd.donCu(0);   // dọn mọi dòng 'xong', kể cả vừa mới xong
  assert.strictEqual(hd.xem("PAGE_B1"), null, "dòng đã xong phải bị dọn");
  const conCho = hd.layCho().map(r => r.conversation_id);
  assert.ok(conCho.includes("PAGE_B2") && conCho.includes("PAGE_B3"), "dòng đang chờ KHÔNG được đụng vào");
});

test("id rỗng không làm sập, cũng không tạo rác", () => {
  assert.strictEqual(hd.them(""), false);
  assert.strictEqual(hd.them(null), false);
  assert.strictEqual(hd.xong(""), false);
  assert.strictEqual(hd.layCho().length, 2);
});

// Cả điểm của việc này là HAI TIẾN TRÌNH khác nhau nói chuyện được với nhau.
// Test trong cùng một tiến trình không chứng minh được điều đó — WAL mới là
// thứ cho phép bot_worker ghi trong khi order_worker đang đọc.
test("tiến trình khác ghi vào -> tiến trình này đọc thấy ngay", () => {
  const { execFileSync } = require("node:child_process");
  execFileSync(process.execPath, ["-e", `
    const hd = require(${JSON.stringify(path.join(__dirname, "..", "loi/don/hang_doi_don.js"))});
    hd.them("PAGE_TIEN_TRINH_KHAC", { pageId: "PAGE" });
    hd.dong();
  `], { env: { ...process.env }, encoding: "utf8", timeout: 20000 });

  const cho = hd.layCho().map(r => r.conversation_id);
  assert.ok(cho.includes("PAGE_TIEN_TRINH_KHAC"),
    "order_worker phải nhìn thấy thứ bot_worker vừa ghi từ tiến trình khác");
});
