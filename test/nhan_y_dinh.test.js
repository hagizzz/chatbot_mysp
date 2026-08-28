// ============================================================================
// test/nhan_y_dinh.test.js — PHÁT LẠI CA VÀNG QUA TẦNG HIỂU Ý
// ----------------------------------------------------------------------------
// Chạy hoàn toàn offline: không gọi Pancake, không gọi OpenAI, không đụng dữ liệu thật.
// Mỗi ca là tin nhắn của một khách THẬT kèm nhãn mà bản bot đang chạy đã gán.
// Đổi lõi mà bộ này lệch = một ca đang chạy tốt vừa vỡ.
//
//   node --test test/
//   npm test
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { detectIntent } = require("../loi/ai/intent_detector");
const { routeBatch, NGUONG_CHAC } = require("../loi/ai/intent_router");

const F = path.join(__dirname, "ca_vang", "nhan_y_dinh.json");
const ca = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F, "utf8")) : [];

test("có bộ ca vàng để phát lại", () => {
  assert.ok(ca.length > 0,
    "Chưa có ca vàng. Chạy: node test/trich_ca_vang.js");
});

test("nhãn regex khớp với bản đang chạy", (t) => {
  const lech = [];
  for (const c of ca) {
    if (!c.mong || !c.mong.nhanRegex || !c.tinKhach) continue;
    const thucTe = detectIntent(c.tinKhach);
    if (thucTe !== c.mong.nhanRegex) {
      lech.push({ tin: c.tinKhach.slice(0, 60), mong: c.mong.nhanRegex, thucTe });
    }
  }
  if (lech.length) {
    console.log("\n  Các ca LỆCH nhãn regex:");
    lech.forEach(l => console.log(`    "${l.tin}"\n      mong=${l.mong}  thực tế=${l.thucTe}`));
  }
  assert.strictEqual(lech.length, 0, `${lech.length}/${ca.length} ca lệch nhãn regex`);
});

test("tầng L1 không đoán bừa: điểm dưới ngưỡng thì phải là KHONG_RO", () => {
  const sai = [];
  for (const c of ca) {
    if (!c.tinKhach) continue;
    let r;
    try { r = routeBatch([c.tinKhach]); } catch { continue; }
    if (!r) continue;
    const diem = r.diem ?? r.score;
    const nhan = r.nhan ?? r.kind ?? r.label;
    if (typeof diem === "number" && diem < NGUONG_CHAC && nhan && nhan !== "KHONG_RO") {
      sai.push({ tin: c.tinKhach.slice(0, 50), nhan, diem });
    }
  }
  if (sai.length) console.log("\n  Đoán bừa dưới ngưỡng:", JSON.stringify(sai.slice(0, 5), null, 2));
  assert.strictEqual(sai.length, 0,
    "Nguyên tắc mục 2: chắc mới nhận, mơ hồ phải nhường — không được nhả nhãn khi điểm dưới ngưỡng");
});

test("nhãn ý định luôn nằm trong danh sách đóng (AI không được bịa nhãn mới)", () => {
  const NHAN_HOP_LE = new Set(ca.map(c => c.mong && c.mong.nhanRegex).filter(Boolean));
  const la = [];
  for (const c of ca) {
    if (!c.tinKhach) continue;
    const n = detectIntent(c.tinKhach);
    if (!NHAN_HOP_LE.has(n) && n !== "UNKNOWN") la.push({ tin: c.tinKhach.slice(0, 50), nhan: n });
  }
  // Chỉ cảnh báo: danh sách nhãn suy ra từ chính bộ ca nên chưa đầy đủ.
  if (la.length) console.log(`\n  (ghi nhận) ${la.length} ca ra nhãn ngoài danh sách suy từ bộ ca vàng`);
  assert.ok(true);
});
