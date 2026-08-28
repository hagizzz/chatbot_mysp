// ============================================================================
// so_lieu_shop.test.js — SỐ LIỆU KINH DOANH TÁCH KHỎI MÃ (việc 2 + 3, 24/08/2026)
// ----------------------------------------------------------------------------
// Vì sao có tệp này: số tài khoản / địa chỉ / bảng size từng nằm cứng trong
// bot_worker_api_v3.js. Mở shop mới là phải sửa mã, và quên sửa thì bot vẫn chạy
// trơn tru — chỉ là nói số liệu của MYS.P cho khách shop khác. Kiểu hỏng không
// có dấu hiệu, nên phải có test canh.
// ============================================================================
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const GOC = path.join(__dirname, "..");
const KB = require("../loi/cau_noi/kho_kich_ban");

// --- Bảng cân nặng: BẢN CŨ viết cứng, chép nguyên để đối chiếu ---------------
// Đây là bản trước khi tách. Test đọ bản mới với bản này trên TỪNG cân nặng —
// tách số liệu ra tệp mà lệch một ký thì khách bị tư vấn sai size.
function baseSizeCu(kg) {
  if (kg <= 48) return "S";
  if (kg <= 55) return "M";
  if (kg <= 61) return "L";
  return "L";
}
function allowedCu(kg) {
  const out = [];
  if (kg >= 56 && kg <= 61) out.push("L");
  if (kg >= 49 && kg <= 57) out.push("M");
  if (kg >= 40 && kg <= 48) out.push("S");
  return out;
}

// Bản MỚI: dựng lại đúng cách bot_worker đọc số liệu, để test không phải nạp cả
// lõi 12.7k dòng (tệp đó không có module.exports).
function bangCanNang() {
  return KB.soLieu("bang_can_nang_size", {
    khoang: [
      { size: "L", tu: 56, den: 61 },
      { size: "M", tu: 49, den: 57 },
      { size: "S", tu: 40, den: 48 },
    ],
    nguong_co_ban: [
      { size: "S", den: 48 },
      { size: "M", den: 55 },
      { size: "L", den: 61 },
    ],
    size_qua_tam: "L",
  });
}
function baseSizeMoi(kg) {
  const b = bangCanNang();
  for (const m of b.nguong_co_ban || []) if (kg <= m.den) return m.size;
  return b.size_qua_tam;
}
function allowedMoi(kg) {
  return (bangCanNang().khoang || []).filter(m => kg >= m.tu && kg <= m.den).map(m => m.size);
}

test("bảng cân nặng -> size: bản tách số liệu KHỚP bản viết cứng cũ, từ 30kg tới 90kg", () => {
  for (let kg = 30; kg <= 90; kg++) {
    assert.strictEqual(baseSizeMoi(kg), baseSizeCu(kg), `size cơ bản lệch ở ${kg}kg`);
    assert.deepStrictEqual(allowedMoi(kg), allowedCu(kg), `danh sách size lệch ở ${kg}kg`);
  }
});

test("vùng chồng 56-57kg vẫn ƯU TIÊN size L (L hết mới về M)", () => {
  assert.deepStrictEqual(allowedMoi(56), ["L", "M"]);
  assert.deepStrictEqual(allowedMoi(57), ["L", "M"]);
  assert.strictEqual(baseSizeMoi(56), "L");
});

test("dưới 40kg vẫn ra size S — cố ý không xét cận dưới", () => {
  assert.strictEqual(baseSizeMoi(38), "S");
  assert.deepStrictEqual(allowedMoi(38), [], "nhưng danh sách size hợp cân thì rỗng");
});

test("quá 61kg -> ngoài tầm, danh sách rỗng", () => {
  assert.deepStrictEqual(allowedMoi(65), []);
});

// --- Kho số liệu -------------------------------------------------------------
test("kich_ban/mysp.json khai đủ số liệu bắt buộc", () => {
  const p = path.join(GOC, "kich_ban", "mysp.json");
  const dl = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.ok(dl.so_lieu, "thiếu ngăn so_lieu");
  for (const k of KB.SO_LIEU_BAT_BUOC) {
    assert.ok(k in dl.so_lieu, `mysp.json thiếu số liệu bắt buộc "${k}"`);
  }
});

test("soLieu() trả phom code khi kho chưa có khoá", () => {
  const phom = { day: "la phom" };
  assert.deepStrictEqual(KB.soLieu("khoa_khong_bao_gio_co_that", phom), phom);
});

test("soLieu() KHÔNG có phom -> trả null để nơi gọi nhường người thật", () => {
  assert.strictEqual(KB.soLieu("khoa_khong_bao_gio_co_that_2"), null);
});

test("shop KHÔNG đè được ngăn prompt, nhưng ĐÈ ĐƯỢC ngăn so_lieu", () => {
  // prompt = luật dạy AI (sai một dòng lệch cả bot) -> chặn cứng.
  // so_lieu = số tài khoản/địa chỉ/bảng size -> đúng là thứ riêng từng shop.
  const src = fs.readFileSync(path.join(GOC, "loi/cau_noi/kho_kich_ban.js"), "utf8");
  assert.match(src, /Object\.assign\(soLieuKho,\s*rieng\.so_lieu/,
    "so_lieu phải gộp bản riêng của shop đè lên gốc");
  assert.match(src, /CỐ Ý không gộp rieng\.prompt/,
    "prompt vẫn phải bị chặn không cho shop đè");
});

// --- Số tài khoản: KHÔNG được có lưới đỡ ------------------------------------
test("buildBankInfoReply KHÔNG có phom code — thiếu số tài khoản thì trả null", () => {
  // Mọi số liệu khác thiếu thì bot nói hơi sai; riêng số tài khoản mà mượn của
  // shop khác thì tiền khách chạy sang túi người khác. Phải nhường người thật.
  const src = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");
  assert.match(src, /function bankInfo\(\)\s*\{\s*return KB\.soLieu\("ngan_hang"\);\s*\}/,
    'bankInfo() phải gọi KB.soLieu("ngan_hang") KHÔNG kèm phom code');
  assert.match(src, /Khách xin STK nhưng shop chưa khai "ngan_hang"/,
    "nơi gọi phải có nhánh nhường người thật khi chưa khai số tài khoản");
});

// --- Việc 3: bỏ ID Google gắn cứng ------------------------------------------
test("Sheet danh mục + Doc kịch bản đọc từ biến môi trường", () => {
  const cat = fs.readFileSync(path.join(GOC, "loi/san_pham/catalog_cache.js"), "utf8");
  assert.match(cat, /process\.env\.CATALOG_SHEET_ID/, "catalog_cache phải nhận CATALOG_SHEET_ID");

  const kl = fs.readFileSync(path.join(GOC, "loi/ai/knowledge_loader.js"), "utf8");
  assert.match(kl, /process\.env\.KICH_BAN_DOC_ID/, "knowledge_loader phải nhận KICH_BAN_DOC_ID");
  assert.match(kl, /process\.env\.LUAT_SHEET_ID/, "knowledge_loader phải nhận LUAT_SHEET_ID");
});

test(".env.example khai đủ 3 biến nguồn dữ liệu mới", () => {
  const env = fs.readFileSync(path.join(GOC, ".env.example"), "utf8");
  for (const k of ["CATALOG_SHEET_ID", "KICH_BAN_DOC_ID", "LUAT_SHEET_ID"]) {
    assert.match(env, new RegExp("^" + k + "=", "m"), `.env.example thiếu ${k}`);
  }
});
