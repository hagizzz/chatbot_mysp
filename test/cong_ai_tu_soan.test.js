// ============================================================================
// test/cong_ai_tu_soan.test.js — CÔNG TẮC "off" PHẢI THẬT SỰ LÀ OFF
// ----------------------------------------------------------------------------
// Kế hoạch: docs/KE_HOACH_AI_SOAN_CAU.md — bước 0.
//
// Lỗ đã vá 25/08/2026: cổng chặn câu AI tự soạn (khối "(a4)" trong
// bot_worker_api_v3.js) từng có điều kiện `!askImages`. Nên mỗi khi lượt đó CÓ
// GỬI ẢNH (khách xin xem ảnh + đang khoá một mẫu), câu do reasoning_engine tự
// soạn đi THẲNG tới khách — không qua bộ soi, bất kể AI_REPLY_MODE=off.
//
// Vì sao phải có test: đây là loại lỗi im lặng nhất trong dự án. Không ai thấy
// gì sai trong log, chỉ là công tắc nói dối — và mọi số đo "câu bot nói ra đến
// từ đâu" ở các bước sau đều sai theo.
//
// Test đọc MÃ NGUỒN (không chạy bot) — cùng lối với khong_hoi_lai.test.js.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

// Lấy khối (a4): từ chỗ khai báo cổng tới hết nhánh xử lý SEND_IMAGES.
function khoiCong() {
  const i = SRC.indexOf('// (a4) AI TƯ VẤN CÂU KHÔNG ĐỤNG SỐ');
  assert.ok(i > 0, "không thấy khối (a4) — cổng chặn câu AI tự soạn");
  const j = SRC.indexOf('action === "SEND_IMAGES"', i);
  assert.ok(j > i, "không thấy nhánh SEND_IMAGES sau cổng (a4)");
  return SRC.slice(i, j);
}

test("cổng chặn câu AI tự soạn KHÔNG được bỏ qua khi lượt đó có gửi ảnh", () => {
  const k = khoiCong();
  assert.ok(
    !/if \(action === "NONE" && !askImages && !_greetScripted\)/.test(k),
    'cổng vẫn còn điều kiện `!askImages` -> câu AI tự soạn lọt tới khách khi lượt đó gửi ảnh, ' +
    'AI_REPLY_MODE=off không còn nghĩa lý gì'
  );
  assert.match(k, /if \(action === "NONE" && !_greetScripted\)/,
    "cổng phải áp cho MỌI câu AI tự soạn, không loại trừ lượt gửi ảnh");
});

test("bị chặn mà đang gửi ảnh -> GIỮ luồng ảnh, chỉ thay câu dẫn (không nhường người)", () => {
  const k = khoiCong();
  assert.match(k, /if \(askImages\)/,
    "phải tách hình phạt theo askImages: gửi ảnh thì thay câu dẫn, không giết cả loạt ảnh");
  assert.match(k, /KB\.cau\("dan_gui_anh"/,
    "câu dẫn thay thế phải lấy từ kho kịch bản (khoá dan_gui_anh), không viết cứng");
  // Nhánh TAG_HUMAN vẫn phải còn cho trường hợp KHÔNG gửi ảnh.
  assert.match(k, /else \{\s*\n\s*action = "TAG_HUMAN"; reply = "";/,
    "không gửi ảnh thì vẫn phải nhường người thật như cũ");
});

test("chốt GREETING trong cổng không được nuốt loạt ảnh", () => {
  const k = khoiCong();
  assert.match(k, /_ai\("GREETING"\) && !askImages/,
    'chốt GREETING phải kèm `!askImages`, nếu không khách chào kèm xin ảnh sẽ mất loạt ảnh ' +
    '(trước đây chốt này nằm sau `!askImages` của cổng nên vô hại)');
});

test("khoá kịch bản dan_gui_anh có thật trong kho gốc", () => {
  const kho = JSON.parse(fs.readFileSync(path.join(GOC, "kich_ban", "mac_dinh.json"), "utf8"));
  const muc = kho.cau && kho.cau["dan_gui_anh"];
  assert.ok(muc, "thiếu khoá dan_gui_anh trong kich_ban/mac_dinh.json");
  assert.ok(Array.isArray(muc.bien) && muc.bien.includes("mau"),
    "dan_gui_anh phải khai biến {mau} để điền tên mẫu");
});
