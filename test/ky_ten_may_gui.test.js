// ============================================================================
// ky_ten_may_gui.test.js — CHỮ KÝ CUỐI CÂU ĐỂ BIẾT TIN CỦA MÁY NÀO
// ----------------------------------------------------------------------------
// Một page đang có hai bot, cả hai đều hiện "Public API" trong Pancake nên
// không phân biệt được. Chữ ký cuối câu là cách duy nhất còn lại — nhưng KHÁCH
// ĐỌC ĐƯỢC nó, nên điều PHẢI giữ là: không khai KY_TEN thì TUYỆT ĐỐI không ký.
// Bản thật chỉ đọc .env (không có KY_TEN) -> im lặng như cũ.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

// Nạp pancake_sender với KY_TEN đặt sẵn (module đọc env lúc require -> phải
// xoá cache giữa các ca thử).
function nap(env) {
  for (const k of ["KY_TEN", "KY_DAU"]) delete process.env[k];
  Object.assign(process.env, env);
  delete require.cache[require.resolve(path.join(__dirname, "..", "loi/pancake/pancake_sender.js"))];
  return require(path.join(__dirname, "..", "loi/pancake/pancake_sender.js")).kyTen;
}

test("KHÔNG khai KY_TEN -> không ký gì (bản thật phải sạch)", () => {
  const kyTen = nap({});
  assert.strictEqual(kyTen("Dạ chị ơi, váy này 890k ạ"), "Dạ chị ơi, váy này 890k ạ");
});

test("Khai KY_TEN -> ký vào cuối, xuống dòng", () => {
  const kyTen = nap({ KY_TEN: "Giang" });
  assert.strictEqual(kyTen("Dạ chị ơi"), "Dạ chị ơi\n— Giang");
});

test("Ký hai lần vẫn chỉ một chữ ký", () => {
  const kyTen = nap({ KY_TEN: "Giang" });
  assert.strictEqual(kyTen(kyTen("Dạ chị ơi")), "Dạ chị ơi\n— Giang");
});

test("Câu rỗng / null -> không đẻ ra tin chỉ có chữ ký", () => {
  const kyTen = nap({ KY_TEN: "Giang" });
  assert.strictEqual(kyTen(""), "");
  assert.strictEqual(kyTen(null), "");
  assert.strictEqual(kyTen("   "), "");
});

test("KY_DAU đổi được dấu đứng trước tên", () => {
  const kyTen = nap({ KY_TEN: "Giang", KY_DAU: "[bot]" });
  assert.strictEqual(kyTen("Dạ chị ơi"), "Dạ chị ơi\n[bot] Giang");
});
