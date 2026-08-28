// ============================================================================
// test/duong_dan_module.test.js — ĐƯỜNG DẪN MÔ-ĐUN SAU KHI CHIA THƯ MỤC
// ----------------------------------------------------------------------------
// Ngày 27/08/2026 mã nguồn được chia vào loi/ · cong_cu/ · thu_nghiem/ · python/.
// Đợt đó lộ ra một cái bẫy tốn cả giờ để truy:
//
//   bot_worker_api_v3.js còn dòng  require("./moc_bo_qua")
//   moc_bo_qua.js đã sang loi/, NHƯNG ở gốc có moc_bo_qua.JSON (tệp dữ liệu).
//   Node thử .js không thấy -> lấy luôn .json. KHÔNG một lỗi nào.
//   _mocBoQua thành object dữ liệu, _mocBoQua.moc() là undefined,
//   -> cả lượt xử lý chết lặng trong readConversation: không trả lời, không thẻ,
//      không dòng log nào. Bộ kiểm đường dẫn cũng bị che mắt vì "vẫn giải được".
//
// Hai phép kiểm dưới đây chạy thuần offline, quét cả cây mã.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const BO = ["node_modules", ".git", "__pycache__", "data", "botlog", "luu_tru"];

function quetJs(d, ra = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (BO.includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) quetJs(p, ra);
    else if (/\.js$/.test(e.name)) ra.push(p);
  }
  return ra;
}
// CỐ Ý bỏ qua thư mục test/: trong đó có require nằm trong CHUỖI truyền cho
// `node -e` của tiến trình con, mà tiến trình con chạy với cwd = GỐC nên viết
// "./loi/..." mới đúng — quét theo vị trí tệp test sẽ kết tội oan. Bản thân bộ
// test hỏng đường dẫn thì cứ chạy là đỏ ngay, không cần canh thêm. Rủi ro
// "hỏng lặng" chỉ nằm ở mã chạy thật.
const DS_JS = quetJs(GOC).filter(p => !/[\\/]test[\\/]/.test(p));
const RE_REQUIRE = /require\(\s*["'](\.\.?\/[^"']+)["']\s*\)/g;

test("mọi require tương đối đều giải ra được", () => {
  const hong = [];
  for (const p of DS_JS) {
    for (const m of fs.readFileSync(p, "utf8").matchAll(RE_REQUIRE)) {
      const t = path.resolve(path.dirname(p), m[1]);
      if (!fs.existsSync(t) && !fs.existsSync(t + ".js") && !fs.existsSync(t + ".json")) {
        hong.push(`${path.relative(GOC, p)} -> ${m[1]}`);
      }
    }
  }
  assert.deepStrictEqual(hong, [], "require trỏ vào chỗ không tồn tại:\n  " + hong.join("\n  "));
});

test('không require nào rơi nhầm vào tệp .json cùng tên (bẫy "moc_bo_qua")', () => {
  const bay = [];
  for (const p of DS_JS) {
    for (const m of fs.readFileSync(p, "utf8").matchAll(RE_REQUIRE)) {
      const spec = m[1];
      if (/\.(js|json)$/.test(spec)) continue;        // ghi rõ đuôi thì không dính bẫy
      const t = path.resolve(path.dirname(p), spec);
      if (fs.existsSync(t + ".js")) continue;         // giải đúng ra .js
      if (fs.existsSync(t + ".json")) {
        bay.push(`${path.relative(GOC, p)} -> ${spec} (đang nạp ${path.basename(t)}.json)`);
      }
    }
  }
  assert.deepStrictEqual(bay, [],
    "require nạp nhầm tệp DỮ LIỆU thay vì MÃ — hỏng lặng, không lỗi:\n  " + bay.join("\n  "));
});

// Require ĐỘNG (tên nằm trong biến) thì mọi công cụ dò tự động đều mù. Chỗ duy
// nhất trong dự án là bộ chọn reader/sender theo MFS — khoá lại để lần dọn sau
// không ai quên sửa tay.
test("require ĐỘNG của reader/sender trỏ đúng vào loi/pancake/", () => {
  const src = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");
  for (const ten of ["mfs_reader", "pancake_reader", "mfs_sender", "pancake_sender"]) {
    assert.ok(src.includes(`"./loi/pancake/${ten}"`),
      `bot_worker phải trỏ "./loi/pancake/${ten}" — đây là require động, không công cụ nào dò ra`);
    assert.ok(fs.existsSync(path.join(GOC, "loi", "pancake", ten + ".js")), `thiếu loi/pancake/${ten}.js`);
  }
});

test("script Python được gọi theo đường dẫn python/", () => {
  const vr = fs.readFileSync(path.join(GOC, "loi", "san_pham", "vision_resolver.js"), "utf8");
  assert.ok(/["']python\/embedding_worker\.py["']/.test(vr),
    "vision_resolver phải gọi python/embedding_worker.py (cwd vẫn là gốc)");
  assert.ok(fs.existsSync(path.join(GOC, "python", "embedding_worker.py")), "thiếu python/embedding_worker.py");
});

test("bộ đo nguồn câu quét đúng chỗ reasoning_engine đang nằm", () => {
  const nc = fs.readFileSync(path.join(GOC, "loi", "cau_noi", "nguon_cau.js"), "utf8");
  assert.ok(/"loi\/ai\/reasoning_engine\.js"/.test(nc),
    "TEP_QUET còn trỏ reasoning_engine.js ở gốc -> bộ đo lặng lẽ bỏ qua, mọi câu của nó thành khong_ro");
  for (const t of ["bot_worker_api_v3.js", "loi/ai/reasoning_engine.js", "order_worker.js"]) {
    assert.ok(fs.existsSync(path.join(GOC, t)), `TEP_QUET nêu ${t} nhưng tệp không có`);
  }
});
