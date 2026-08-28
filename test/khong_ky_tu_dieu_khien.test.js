// ============================================================================
// test/khong_ky_tu_dieu_khien.test.js — REGEX CHẠY RỖNG MÀ KHÔNG AI BIẾT
// ----------------------------------------------------------------------------
// Một loại lỗi đã cắn HAI lần trong ngày 25/08/2026. Cả hai đều là điều kiện KHÔNG
// BAO GIỜ ĐÚNG: không lỗi cú pháp, không log, đọc mã thì thấy đúng.
//
//   lần 1 — /\bgiá\b/ : trong regex JS "á" không phải ký tự từ, nên \b cạnh nó
//           không bao giờ khớp. Chốt tách tin báo giá chạy rỗng suốt.
//
//   lần 2 — sửa mã bằng script Python, viết "\b" trong chuỗi THƯỜNG. Python đổi \b
//           thành KÝ TỰ BACKSPACE (0x08) rồi ghi thẳng vào tệp. Regex thành
//           /<BS>(mẫu|váy|...)<BS>/. Dính đúng rào _hoiSanPham -> khách hỏi
//           "mẫu này mặc đi tiệc được không" mà bot đòi địa chỉ. Mất nhiều vòng mới
//           truy ra, vì ký tự đó vô hình.
//
// Ranh giới từ cho tiếng Việt: (?<![\p{L}]) / (?![\p{L}]) với cờ u. KHÔNG phải \b.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const TEP = fs.readdirSync(GOC)
  .filter(f => f.endsWith(".js") && !f.startsWith("_"))
  .concat(fs.readdirSync(path.join(GOC, "test"))
    .filter(f => f.endsWith(".js")).map(f => path.join("test", f)));

// --- 1. Ký tự điều khiển do escape đẻ ra ------------------------------------
// 0x00 và 0x01 dùng CÓ CHỦ Ý, không phải tai nạn:
//   0x00 — MỐC HỤT của kho kịch bản (đánh dấu câu tra hụt để chặn gửi)
//   0x01 — mốc che dấu chấm phân cách nghìn trong TÁCH TIN (1.650.000đ không bị cắt đôi)
// Cấm đúng họ ký tự mà escape Python đẻ ra. Không cái nào có lý do tồn tại trong JS,
// và tất cả đều vô hình khi đọc mã.
const CAM = { 7: "\\a", 8: "\\b", 11: "\\v", 12: "\\f", 27: "\\e" };

test("không tệp mã nào dính ký tự điều khiển do escape đẻ ra", () => {
  const xau = [];
  for (const f of TEP) {
    const s = fs.readFileSync(path.join(GOC, f), "utf8");
    for (let i = 0; i < s.length; i++) {
      const m = s.charCodeAt(i);
      if (CAM[m]) {
        xau.push(`${f}:${s.slice(0, i).split("\n").length} dính 0x${m.toString(16).padStart(2, "0")} (từ "${CAM[m]}")`);
        break;
      }
    }
  }
  assert.deepStrictEqual(xau, [],
    "ký tự điều khiển trong mã = regex chạy rỗng mà KHÔNG báo lỗi. Sửa mã bằng Python phải dùng chuỗi thô r'...'");
});

// --- 2. \b cạnh chữ có dấu --------------------------------------------------
// Đây là lỗi CÓ THẬT ở những chỗ dưới, nhưng sửa 20 chỗ một lúc là đổi hành vi ở 20
// nhánh khác nhau — phải làm riêng từng cái, có kịch bản riêng. Test này KHÔNG bắt
// sửa chúng; nó chặn PHÁT SINH THÊM. Sửa được chỗ nào thì HẠ con số, đừng nâng.
const SO_CHO_DA_BIET = 20;

test("không phát sinh thêm chỗ dùng \\b sát chữ có dấu", () => {
  const s = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");
  const re = /\\b(?=[^\x00-\x7F])|(?<=[^\x00-\x7F])\\b/g;
  const dong = new Set();
  let m;
  while ((m = re.exec(s)) !== null) {
    const dau = s.lastIndexOf("\n", m.index) + 1;
    const noiDung = s.slice(dau, s.indexOf("\n", m.index));
    if (noiDung.trim().startsWith("//")) continue;   // chú thích đang GIẢI THÍCH cái bẫy này
    dong.add(s.slice(0, m.index).split("\n").length);
  }
  assert.ok(dong.size <= SO_CHO_DA_BIET,
    `${dong.size} chỗ dùng \\b sát chữ có dấu (mốc đã biết: ${SO_CHO_DA_BIET}). ` +
    `Dòng: ${[...dong].join(", ")}. Dùng (?<![\\p{L}]) / (?![\\p{L}]) với cờ u thay cho \\b.`);
});

// --- 3. Rào đã sửa phải THẬT SỰ chạy ----------------------------------------
test("rào _hoiSanPham khớp đúng câu đã gây lỗi ngoài thật", () => {
  // Không kiểm hình thức — bóc chính regex trong mã ra chạy.
  const s = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");
  const i = s.indexOf("const _hoiSanPham =");
  assert.ok(i > 0, "không thấy rào _hoiSanPham");
  const than = s.slice(i, s.indexOf(";", s.indexOf('latestText || ""))', i)) + 1);
  const res = [...than.matchAll(/\/((?:[^/\\\n]|\\.)+)\/([a-z]*)\.test/g)].map(x => new RegExp(x[1], x[2]));
  assert.ok(res.length >= 2, `mới bóc được ${res.length} regex trong rào`);
  const khop = (t) => res.some(r => r.test(t));

  for (const c of [
    "mẫu này mặc đi tiệc ở cty được k shop",   // câu thật — bot đã đòi địa chỉ vì rào chết
    "tư vấn em mẫu này với",                    // ca ghi sẵn trong chú thích của rào
    "váy này bao nhiêu"
  ]) assert.ok(khop(c), `rào phải BẬT cho "${c}" — không thì bot lại đòi địa chỉ`);

  for (const c of [
    "số 25 Lê Lợi, phường Bến Nghé, quận 1",   // địa chỉ thật -> nhánh ảnh-địa-chỉ phải chạy
    "0912345678"
  ]) assert.ok(!khop(c), `rào phải TẮT cho "${c}" — bật hết thì nhánh ảnh-địa-chỉ chết hẳn`);
});

test("ranh giới Unicode không bắt nhầm chữ nằm trong từ khác", () => {
  const R = /(?<![\p{L}])(mẫu|mau|váy|vay|đầm|dam|set|bộ|bo|áo|ao|chân váy)(?![\p{L}])/iu;
  assert.ok(!R.test("bao nhiêu tiền"), '"ao" trong "bao" không được tính là áo');
  assert.ok(!R.test("giao hàng"), '"ao" trong "giao" không được tính');
  assert.ok(!R.test("bọc kỹ giúp em"), '"bo" trong "bọc" không được tính');
  assert.ok(R.test("cho em xem áo này"), "áo đứng riêng thì phải bắt");
});
