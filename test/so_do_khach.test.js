// ============================================================================
// test/so_do_khach.test.js — ĐƯA SỐ ĐO RỒI THÌ ĐỪNG HỎI LẠI
// ----------------------------------------------------------------------------
// Đo trên page THẬT ngày 24/08/2026. Khách nhắn:
//     "e cao m6, nặng 53kg thì size gì ạ"
// Bot đáp: "Dạ chị cho em xin chiều cao cân nặng để em tư vấn size chuẩn"
// — hỏi lại đúng thứ khách vừa đưa. Log:
//     [AI-QUYẾT] hành_động=HOI_SIZE
//     [AI-QUYẾT ưu tiên] AI phát lệnh TRƯỚC dispatch -> luật cũ không chạy
//
// Ba tầng cộng lại mới ra lỗi:
//   1) "HOI_SIZE" nghĩa là ĐI XIN số đo, nhưng khách HỎI VỀ size trông cũng
//      giống một lượt "về size" -> AI chọn nhầm.
//   2) Prompt có luật "không hỏi lại thứ đã có" nhưng KHÔNG nói riêng về
//      chiều cao/cân nặng.
//   3) AI-QUYẾT chặn TRƯỚC dispatch -> mọi nhánh cứng biết tư vấn size đều
//      không được chạy tới. Một quyết định sai của AI khoá luôn lưới đỡ.
//
// Vá: thêm LUẬT SỐ ĐO vào prompt, và nới bộ dò chiều cao để bắt "m6" (khách
// gõ nhanh, bỏ số 1 đằng trước).
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

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

// --- 1) Prompt AI-QUYẾT -----------------------------------------------------
test("prompt ai_quyet có LUẬT SỐ ĐO cấm hỏi lại chiều cao/cân nặng", () => {
  const p = doc("ai_quyet.js");
  assert.match(p, /LUẬT SỐ ĐO/, "thiếu LUẬT SỐ ĐO trong prompt");
  assert.match(p, /KHÔNG chọn HOI_SIZE/,
    "luật phải nói thẳng: đã có số đo thì KHÔNG chọn HOI_SIZE");
});

test("luật nêu ĐỦ mấy dạng khách hay gõ tắt", () => {
  const p = doc("ai_quyet.js");
  // Không liệt kê đủ thì AI vẫn trượt đúng ca đã đo được.
  for (const dang of ["1m6", "m6", "53kg", "160cm"]) {
    assert.ok(p.includes(dang), `LUẬT SỐ ĐO chưa nêu dạng "${dang}"`);
  }
});

test("phom HOI_SIZE có ghi chú chỉ dùng khi CHƯA có số đo", () => {
  const p = doc("ai_quyet.js");
  const i = p.indexOf("- HOI_SIZE:");
  assert.ok(i > 0, "không thấy phom HOI_SIZE");
  const dong = p.slice(i, p.indexOf("\n", i));
  assert.match(dong, /CHỈ khi/, "phom HOI_SIZE thiếu điều kiện -> AI dễ chọn bừa");
});

test("HOI_SIZE vẫn nằm trong danh sách hành động hợp lệ", () => {
  // Vá là THU HẸP lúc dùng, không phải bỏ hành động. Hội thoại chưa có số đo
  // nào thì vẫn phải hỏi.
  assert.match(doc("ai_quyet.js"), /HANH_DONG\s*=\s*\[[^\]]*"HOI_SIZE"/);
});

// --- 2) Bộ dò chiều cao trong lõi bot ---------------------------------------
// Đọc thẳng đoạn dò ra khỏi mã nguồn rồi chạy, vì bot_worker_api_v3.js là
// script liền khối không có module.exports.
function doChieuCao(cau) {
  const src = doc("bot_worker_api_v3.js");
  const i = src.indexOf('// 1m52 / 1m5');
  assert.ok(i > 0, "không thấy bộ dò chiều cao");
  const dau = src.lastIndexOf("let _m;", i);
  const cuoi = src.indexOf("\n      }", src.indexOf("h >= 130 && h <= 199", i)) + "\n      }".length;
  const doan = src.slice(dau, cuoi);
  const fn = new Function("_ht", "let _hcm = 0;\n" + doan + "\nreturn _hcm;");
  return fn(String(cau).toLowerCase().replace(/\s+/g, " "));
}

test("dò được mấy dạng chiều cao CŨ — bản vá không làm hỏng cái đang chạy", () => {
  assert.strictEqual(doChieuCao("chị cao 1m52 nặng 50kg"), 152);
  assert.strictEqual(doChieuCao("cao 1m5"), 150);
  assert.strictEqual(doChieuCao("mình cao 1.52"), 152);
  assert.strictEqual(doChieuCao("cao 155cm"), 155);
});

test('dò được dạng gõ tắt "m6" / "m58" — đúng ca đo được trên page thật', () => {
  assert.strictEqual(doChieuCao("e cao m6, nặng 53kg thì size gì ạ"), 160);
  assert.strictEqual(doChieuCao("cao m58 nặng 55kg"), 158);
  assert.strictEqual(doChieuCao("m7 61kg"), 170);
});

test("KHÔNG nuốt nhầm mấy chuỗi trông giống chiều cao", () => {
  // Nới regex mà không rào thì "size m6" hay mã hàng cũng thành chiều cao.
  assert.strictEqual(doChieuCao("cho chị size m"), 0);
  assert.strictEqual(doChieuCao("lấy mã MGKSQ6072"), 0);
  assert.strictEqual(doChieuCao("m2 thôi"), 0, "120cm không phải chiều cao người lớn -> phải bỏ");
});
