// ============================================================================
// test/ghi_chu_khong_duoc_mat.test.js — GHI CHÚ CHO NHÂN VIÊN KHÔNG ĐƯỢC RƠI MẤT
// ----------------------------------------------------------------------------
// Bot có 6 chỗ viết ghi chú nhờ NGƯỜI THẬT xử: thiếu dòng Sheet, khách lấy
// nhiều mẫu mà bot dò ra ít hơn, giá lệch ad/sheet...
//
// Đo 26/08/2026 trên page PHOM: endpoint ghi chú của Pancake trả 404 ở CẢ 5
// đường thử. Mọi ghi chú bot từng viết đều rơi vào hư không — hàm chỉ in một
// dòng log rồi trả về, nên không ai phát hiện suốt thời gian dài.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const GOC = path.join(__dirname, "..");

test("hụt API -> ghi chú vẫn vào sổ ngoài, không mất", () => {
  const tam = fs.mkdtempSync(path.join(os.tmpdir(), "ghichu-"));
  process.env.GHI_CHU_DIR = tam;
  delete require.cache[require.resolve(path.join(GOC, "loi/tien_ich/ghi_chu_ngoai.js"))];
  const so = require(path.join(GOC, "loi/tien_ich/ghi_chu_ngoai.js"));

  so.ghi({ conversationId: "123_456", text: "Bot NHẬN RA mẫu MRKVX6490 nhưng thiếu dòng Sheet" });
  const ds = so.doc(5);
  assert.strictEqual(ds.length, 1, "ghi chú không vào sổ");
  assert.match(ds[0].text, /MRKVX6490/, "mất tên mã -> nhân viên không biết thêm dòng nào");
  assert.strictEqual(ds[0].conversationId, "123_456");
  assert.ok(ds[0].luc, "thiếu mốc thời gian");
});

test("ghi chú rỗng thì bỏ qua, không làm bẩn sổ", () => {
  const tam = fs.mkdtempSync(path.join(os.tmpdir(), "ghichu-"));
  process.env.GHI_CHU_DIR = tam;
  delete require.cache[require.resolve(path.join(GOC, "loi/tien_ich/ghi_chu_ngoai.js"))];
  const so = require(path.join(GOC, "loi/tien_ich/ghi_chu_ngoai.js"));
  so.ghi({ conversationId: "1_2", text: "   " });
  assert.strictEqual(so.doc(5).length, 0);
});

test("pancake_sender KHÔNG còn nuốt ghi chú khi API hụt", () => {
  const SRC = fs.readFileSync(path.join(GOC, "loi/pancake/pancake_sender.js"), "utf8");
  const i = SRC.indexOf("async function addConversationNote");
  const khoi = SRC.slice(i, i + 2200);
  assert.match(khoi, /require\("[^"]*ghi_chu_ngoai"\)\.ghi/,
    "hụt API mà không đổ sang sổ ngoài -> ghi chú lại rơi mất như cũ");
  assert.match(khoi, /_ghiChuApiSong = false/,
    "phải nhớ API chết để thôi bắn 3 request hụt cho MỖI ghi chú");
});

test("ghi chú không bao giờ được ném lỗi làm chết lượt xử", () => {
  process.env.GHI_CHU_DIR = "Z:/khong/ton/tai/duong/nay";
  delete require.cache[require.resolve(path.join(GOC, "loi/tien_ich/ghi_chu_ngoai.js"))];
  const so = require(path.join(GOC, "loi/tien_ich/ghi_chu_ngoai.js"));
  assert.doesNotThrow(() => so.ghi({ conversationId: "1_2", text: "thử ghi vào ổ không tồn tại" }));
});
