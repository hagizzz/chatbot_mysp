// ============================================================================
// test/tach_tin.test.js — TÁCH TIN DỒN DẬP THÀNH NHIỀU TIN
// ----------------------------------------------------------------------------
// Yêu cầu shop 25/08/2026. Bot gửi nguyên khối:
//   "Dạ Set Zoise giá 1.650.000đ ạ. Dạ em lên đơn size M cho mình nha.
//    Chị xác nhận giúp em vẫn giao về …, sđt … đúng không ạ?"
// Ba việc trong một tin, khách đọc thấy dồn. Tách thành ba tin:
//   1) báo giá   2) size (khi đã biết từ trước)   3) xác nhận địa chỉ + sđt
//
// Tách ở CỬA GỬI chứ không sửa từng chỗ ghép: câu này được dựng ở nhiều nhánh
// (mở màn, báo giá lại, đuôi mở màn…), vá từng nơi vừa sót vừa dễ lệch nhau.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

// Dựng lại đúng phép chia của bản vá để chạy thử trên câu thật.
function chia(raw) {
  const _coGia = /giá[^!?]{0,40}?(đ|vnđ)(?![a-zà-ỹ])/i.test(raw);
  const _coHanhDong = /(size|sđt|số điện thoại|địa chỉ|lên đơn|xác nhận)/i.test(raw);
  if (!(_coGia && _coHanhDong && raw.length > 90)) return [raw];
  const _CHE = "";
  const _che = raw.replace(/(\d)[.](\d)/g, "$1" + _CHE + "$2");
  const _cau = (_che.match(/[^.?!]+[.?!]+|\S[^.?!]*$/g) || []).map(x => x.split(_CHE).join("."));
  if (_cau.length < 2) return [raw];
  const p = { gia: [], size: [], lienHe: [] };
  for (const c of _cau) {
    const t = c.trim();
    if (!t) continue;
    if (/(sđt|số điện thoại|địa chỉ|giao về|xác nhận)/i.test(t)) p.lienHe.push(t);
    else if (/(size|cân nặng|chiều cao)/i.test(t)) p.size.push(t);
    else p.gia.push(t);
  }
  const ra = [p.gia.join(" "), p.size.join(" "), p.lienHe.join(" ")].map(x => x.trim()).filter(Boolean);
  return ra.length >= 2 ? ra : [raw];
}

test("đúng câu shop phàn nàn -> tách làm 3 tin", () => {
  const raw = "Dạ Set Zoise giá 1.650.000đ ạ. Dạ em lên đơn size M cho mình nha. "
            + "Chị xác nhận giúp em vẫn giao về Thanh Xuân, Hà Nội, sđt 0385539117 đúng không ạ?";
  const t = chia(raw);
  assert.strictEqual(t.length, 3, "phải ra đúng 3 tin");
  assert.match(t[0], /giá 1\.650\.000đ/, "tin 1 = báo giá");
  assert.match(t[1], /size M/, "tin 2 = size");
  assert.match(t[2], /sđt|địa chỉ|giao về/, "tin 3 = xác nhận liên hệ");
});

test("không có size từ trước -> chỉ 2 tin, không đẻ tin rỗng", () => {
  const raw = "Dạ Váy Giannal giá 890.000đ ạ. Chị cho em xin số điện thoại và địa chỉ để em lên đơn cho mình nha ạ?";
  const t = chia(raw);
  assert.strictEqual(t.length, 2);
  assert.ok(t.every(x => x.trim()), "không được có tin rỗng");
});

test("câu NGẮN hoặc câu thường KHÔNG bị tách", () => {
  for (const c of [
    "Dạ Set Corae giá 990.000đ ạ.",
    "Dạ chị thường mặc size nào để em tư vấn cho mình nha ạ",
    "Dạ bên em ship COD, chị nhận hàng kiểm tra rồi thanh toán ạ"
  ]) {
    assert.deepStrictEqual(chia(c), [c], `"${c.slice(0, 30)}…" không được tách`);
  }
});

test("tách xong KHÔNG mất chữ nào", () => {
  const raw = "Dạ Set Zoise giá 1.650.000đ ạ. Dạ em lên đơn size M cho mình nha. "
            + "Chị xác nhận giúp em vẫn giao về Thanh Xuân, Hà Nội, sđt 0385539117 đúng không ạ?";
  const goc = raw.replace(/\s+/g, "");
  const sau = chia(raw).join("").replace(/\s+/g, "");
  assert.strictEqual(sau, goc, "tách làm rơi hoặc nhân đôi chữ");
});

// --- Bản vá phải nằm trong mã, và tắt được ----------------------------------
test("cửa gửi có khối tách tin", () => {
  assert.match(SRC, /TÁCH TIN DỒN DẬP/, "thiếu khối tách tin ở sendInboxMessage");
  assert.match(SRC, /TACH_TIN/, "phải tắt được bằng biến môi trường");
});

test("mỗi mảnh đi lại ĐÚNG đường gửi cũ", () => {
  // Gọi thẳng _sendInboxMessage là mất chống-trùng, mất sổ id bot, mất follow-up.
  const i = SRC.indexOf("TÁCH TIN DỒN DẬP");
  const k = SRC.slice(i, i + 4000);
  assert.match(k, /await sendInboxMessage\(target, _tin\[i\]\)/,
    "phải gọi lại sendInboxMessage, không gọi tắt hàm gửi thô");
});

test("có nghỉ giữa các tin cho tự nhiên", () => {
  const i = SRC.indexOf("TÁCH TIN DỒN DẬP");
  const k = SRC.slice(i, i + 4000);
  assert.match(k, /delay\(\d{3,4}\)/, "gửi liền tay 3 tin cũng là dồn dập kiểu khác");
});
