// test/nhan_dien_anh_hong.test.js — WORKER ẢNH CHẾT THÌ BOT KHÔNG ĐƯỢC CHẾT THEO
// Vì sao có bài này: vision_resolver tạo readyPromise rồi từ chối nó khi worker
// thoát. Nếu chưa ai chờ lời hứa đó, Node coi là "từ chối không ai bắt" và GIẾT
// CẢ TIẾN TRÌNH BOT. Thực tế đã xảy ra trên máy thiếu numpy: bot chết ngay khi mở.
// Mất nhận diện ảnh là chấp nhận được; chết cả bot thì không.
const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const GOC = path.join(__dirname, "..");

// Ép worker chết chắc chắn bằng cách trỏ sang trình python không tồn tại.
const MOI_TRUONG = { ...process.env, PYTHON_BIN: "python_khong_ton_tai_9x8y7z" };

test("worker ảnh chết -> bot vẫn sống, chỉ trả về không nhận được", () => {
  const ra = execFileSync(
    process.execPath,
    ["-e", `
      const v = require("./vision_resolver");
      v.resolveImage({ url: "file:///khong-co-that.jpg" })
        .then(r => { console.log("KETQUA:" + (r && r.ok === false ? "khong-nhan-duoc" : "bat-ngo")); })
        .catch(e => { console.log("KETQUA:nem-loi:" + e.message); });
      // Sống thêm một nhịp để bắt trọn cú "từ chối không ai bắt" nếu nó quay lại.
      setTimeout(() => { console.log("BOT_VAN_SONG"); process.exit(0); }, 3000);
    `],
    { cwd: GOC, env: MOI_TRUONG, encoding: "utf8", timeout: 30000 }
  );

  assert.match(ra, /BOT_VAN_SONG/, "tiến trình phải sống qua được cái chết của worker ảnh");
  assert.match(ra, /KETQUA:khong-nhan-duoc/, "phải trả về ok:false chứ không được ném lỗi ra ngoài");
});
