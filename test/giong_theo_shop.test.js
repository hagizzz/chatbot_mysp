// ============================================================================
// test/giong_theo_shop.test.js — VĂN PHONG TÁCH THEO SHOP
// ----------------------------------------------------------------------------
// Vì sao: bán hệ thống này cho shop thứ hai thì mọi shop nói cùng một giọng.
// Luật giọng nằm cứng trong bot_worker — maybeDropDa bỏ chữ "Dạ" mỗi câu thứ 2,
// throttleHearts xoay vòng emoji mỗi 3 tin — nên shop muốn khô khan hơn hay ngọt
// hơn đều phải nhờ lập trình viên sửa mã.
//
// Nay ba nét đó đọc từ ngăn "giong" của kho (mac_dinh.json -> <shopId>.json).
//
// PHÁT HIỆN LÚC DỰNG: _WARM_EMOJIS trong mã là BẢY CHUỖI RỖNG — emoji bay mất
// trong một lần lưu tệp sai bảng mã. Bộ lọc bỏ icon cũng hỏng theo (/[]+/ là lớp
// ký tự RỖNG, không khớp gì). Hậu quả: "icon linh hoạt" chết âm thầm, chỉ còn
// tác dụng đính một DẤU CÁCH thừa vào cuối mỗi tin. Có test canh để không tái diễn.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

// Lấy hai hàm giọng ra khỏi mã nguồn, tiêm KB giả để đổi giọng tuỳ ý.
// (bot_worker_api_v3.js là script liền khối, không có module.exports.)
function layGiong(giong) {
  const i = SRC.indexOf("const _heartCtr");
  const j = SRC.indexOf("\n}", SRC.indexOf("function throttleHearts")) + 2;
  const di = SRC.indexOf("const _daCounter");
  const dj = SRC.indexOf("\n}", SRC.indexOf("function maybeDropDa")) + 2;
  assert.ok(i > 0 && j > i && di > 0 && dj > di, "không lấy được hai hàm giọng khỏi mã nguồn");
  const s = { KB: { giong: (t, d) => (giong[t] !== undefined ? giong[t] : d) } };
  new Function("s", "with (s) {" + SRC.slice(i, j) + "\n" + SRC.slice(di, dj)
    + "\n s.throttleHearts = throttleHearts; s.maybeDropDa = maybeDropDa; s._boIconAm = _boIconAm;"
    + " s._WARM_EMOJIS = _WARM_EMOJIS; }")(s);
  return s;
}
const noi = (s, n, cau) => { let r = cau; for (let k = 0; k < n; k++) r = s.throttleHearts("x", s.maybeDropDa("x", cau)); return r; };

// --- Chữ "Dạ" đầu câu ----------------------------------------------------
test('mo_dau_da="xen_ke" (gốc): cách câu một lần bỏ "Dạ"', () => {
  const s = layGiong({});
  assert.match(s.maybeDropDa("x", "Dạ chị yên tâm nha"), /^Dạ /);
  assert.match(s.maybeDropDa("x", "Dạ chị yên tâm nha"), /^Chị /);   // lượt 2 -> bỏ
});

test('mo_dau_da="luon": câu nào cũng giữ "Dạ"', () => {
  const s = layGiong({ mo_dau_da: "luon" });
  for (let n = 0; n < 4; n++) assert.match(s.maybeDropDa("x", "Dạ chị yên tâm nha"), /^Dạ /);
});

test('mo_dau_da="khong": bỏ hẳn, và VIẾT HOA lại chữ đầu', () => {
  const s = layGiong({ mo_dau_da: "khong" });
  for (let n = 0; n < 4; n++) {
    assert.strictEqual(s.maybeDropDa("x", "Dạ chị yên tâm nha"), "Chị yên tâm nha");
  }
});

test('câu vốn không mở bằng "Dạ" thì không giọng nào đụng vào', () => {
  for (const g of [{}, { mo_dau_da: "luon" }, { mo_dau_da: "khong" }]) {
    assert.strictEqual(layGiong(g).maybeDropDa("x", "Chị mặc size nào ạ"), "Chị mặc size nào ạ");
  }
});

// --- Emoji ---------------------------------------------------------------
test('emoji muc="khong": tắt sạch icon', () => {
  const s = layGiong({ emoji: { muc: "khong" } });
  for (let n = 0; n < 4; n++) {
    assert.strictEqual(s.throttleHearts("x", "Dạ chị yên tâm nha 🥰"), "Dạ chị yên tâm nha");
  }
});

test("emoji: shop khai bộ riêng thì xoay vòng đúng bộ đó", () => {
  const s = layGiong({ emoji: { muc: "nhieu", bo: ["🌷", "💗"] } });
  const ra = [];
  for (let n = 0; n < 4; n++) ra.push(s.throttleHearts("x", "Dạ chị yên tâm nha 🥰"));
  assert.ok(ra.every(c => /[🌷💗]$/.test(c)), "không dùng bộ icon của shop: " + JSON.stringify(ra));
  assert.ok(!ra.some(c => /🥰/.test(c)), "icon gốc chưa bị gỡ trước khi thay: " + JSON.stringify(ra));
  assert.ok(new Set(ra).size > 1, "không xoay vòng, lặp mãi một icon");
});

test("câu mẫu KHÔNG có icon -> bot KHÔNG tự thêm, kể cả muc=nhieu", () => {
  const s = layGiong({ emoji: { muc: "nhieu" } });
  for (let n = 0; n < 4; n++) {
    assert.strictEqual(s.throttleHearts("x", "Dạ chị mặc size nào ạ"), "Dạ chị mặc size nào ạ");
  }
});

// --- Hai ca hồi quy, đều là lỗi ĐÃ CÓ THẬT -------------------------------
test("bộ icon mặc định phải là emoji THẬT, không phải chuỗi rỗng", () => {
  const s = layGiong({});
  assert.ok(Array.isArray(s._WARM_EMOJIS) && s._WARM_EMOJIS.length, "_WARM_EMOJIS rỗng");
  assert.ok(s._WARM_EMOJIS.every(e => e && e.length),
    "_WARM_EMOJIS lại chứa chuỗi rỗng -> icon linh hoạt chết âm thầm, chỉ đính dấu cách thừa");
});

test("không được đính DẤU CÁCH thừa vào cuối tin", () => {
  const s = layGiong({});
  for (let n = 0; n < 6; n++) {
    const r = s.throttleHearts("x", "Dạ chị yên tâm nha 🥰");
    assert.ok(!/\s$/.test(r), `đuôi còn khoảng trắng: ${JSON.stringify(r)}`);
  }
});

test("gỡ icon theo DANH SÁCH, không quét dải Unicode (giữ 📍 của địa chỉ)", () => {
  const s = layGiong({});
  const dc = "📍 105 Bà Triệu, Hai Bà Trưng, Hà Nội";
  assert.ok(s._boIconAm(dc, []).includes("📍"),
    "quét dải Unicode sẽ ăn mất 📍 -> địa chỉ showroom mất dấu định vị");
});

// --- Kho: shop đè được, không khai thì kế thừa ---------------------------
function khoTheoShop(shopId) {
  const truoc = process.env.KICH_BAN_SHOP_ID;
  if (shopId) process.env.KICH_BAN_SHOP_ID = shopId; else delete process.env.KICH_BAN_SHOP_ID;
  delete require.cache[require.resolve("../loi/cau_noi/kho_kich_ban")];
  const KB = require("../loi/cau_noi/kho_kich_ban");
  KB.napLai();
  if (truoc === undefined) delete process.env.KICH_BAN_SHOP_ID; else process.env.KICH_BAN_SHOP_ID = truoc;
  delete require.cache[require.resolve("../loi/cau_noi/kho_kich_ban")];
  return KB;
}

test("mac_dinh.json khai giọng GỐC (shop chưa đụng gì thì bot chạy y như cũ)", () => {
  const KB = khoTheoShop("khong_co_shop_nay");
  assert.strictEqual(KB.giong("mo_dau_da"), "xen_ke");
  assert.strictEqual(KB.giong("xung"), "em");
  assert.strictEqual(KB.giong("goi_khach"), "chị");
  const e = KB.giong("emoji", {});
  assert.strictEqual(e.muc, "it");
  assert.ok(Array.isArray(e.bo) && e.bo.every(x => x && x.length), "bộ icon trong kho bị rỗng");
});

test("shop khai giọng riêng thì ĐÈ được ngăn gốc", () => {
  const KB = khoTheoShop("vidu_shop_khac");
  assert.strictEqual(KB.giong("xung"), "shop");
  assert.strictEqual(KB.giong("goi_khach"), "anh");
  assert.strictEqual(KB.giong("mo_dau_da"), "khong");
  assert.strictEqual((KB.giong("emoji", {}) || {}).muc, "khong");
});

test("khoá shop KHÔNG khai thì kế thừa gốc, không rơi về rỗng", () => {
  const KB = khoTheoShop("vidu_shop_khac");
  // vidu_shop_khac không khai "cau" cho khoá này -> phải lấy của mac_dinh.
  const ds = KB.cacCau("tran_an_ngoai_doi");
  assert.ok(ds.length && !ds.some(c => /⟪/.test(c)), "khoá không khai bị hụt thay vì kế thừa");
});

test("giọng sai kiểu / thiếu khoá -> rơi về mặc định, không làm sập câu", () => {
  const s = layGiong({ mo_dau_da: "kieu_la_hoac_go_nham", emoji: "khong-phai-object" });
  assert.ok(typeof s.maybeDropDa("x", "Dạ chị yên tâm nha") === "string");
  assert.ok(typeof s.throttleHearts("x", "Dạ chị yên tâm nha 🥰") === "string");
});

test("kho vẫn hợp lệ sau khi thêm ngăn giong", () => {
  const KB = require("../loi/cau_noi/kho_kich_ban");
  assert.deepStrictEqual(KB.kiemTra().loi, []);
});
