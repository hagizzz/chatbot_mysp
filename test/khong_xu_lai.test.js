// ============================================================================
// test/khong_xu_lai.test.js — ĐỪNG XỬ LẠI CÙNG MỘT TIN
// ----------------------------------------------------------------------------
// Người dùng báo "bot trả lời hơi chậm" ngày 25/08/2026. Đọc log ra thứ khác
// hẳn giả thuyết ban đầu (AI chậm):
//
//     số lần xử cùng một tin      : 7
//     số lần gắn lại thẻ 185      : 7
//     tổng thời gian gọi AI-QUYẾT : 23.024 ms  (7 lần, trung bình 3,3 giây)
//     đọc bài quảng cáo (trượt)   : 7 lần
//
// Khách vẫn không nhận được gì. Vòng lặp mới là thứ làm chậm, không phải AI.
//
// HAI NGUYÊN NHÂN:
//
// 1) Nhánh nào "gắn thẻ rồi im" đều gọi markUnread -> conv vẫn chưa-đọc + khách
//    nhắn cuối -> ngoại lệ _unreadCustomerWaiting bỏ kiểm processed -> vòng poll
//    sau xử lại y nguyên. Ngoại lệ đó vốn sinh ra cho tin của LẦN CHẠY TRƯỚC,
//    không phải tin chính tiến trình này vừa xử.
//
// 2) fetchPancakePost chỉ cache khi THÀNH CÔNG. Bài cũ ngoài 120 ngày trượt mãi
//    -> lượt nào cũng gọi lại Pancake, lần nào cũng trượt.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const BOT = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");
const READER = fs.readFileSync(path.join(GOC, "loi/pancake/pancake_reader.js"), "utf8");

// --- 1) Không xử lại cụm tin chính lần chạy này đã xử -----------------------
test("có sổ ghi tin đã xử TRONG LẦN CHẠY NÀY", () => {
  assert.match(BOT, /_daXuLyLuotChay/, "thiếu sổ theo lần chạy");
  assert.match(BOT, /markProcessed[\s\S]{0,400}_daXuLyLuotChay\.add/,
    "markProcessed phải ghi vào sổ, nếu không sổ luôn rỗng");
});

test("ngoại lệ chưa-đọc-khách-chờ KHÔNG còn bỏ qua cụm vừa xử", () => {
  const i = BOT.indexOf("const batchNew =");
  assert.ok(i > 0, "không thấy chỗ lọc tin mới");
  const k = BOT.slice(Math.max(0, i - 900), i + 400);
  assert.match(k, /_cumDaXuLuotNay/, "thiếu chốt cụm-đã-xử-lượt-này");
  assert.match(k, /_unreadCustomerWaiting && !_cumDaXuLuotNay/,
    "ngoại lệ phải bị chặn khi cụm đã xử trong lần chạy này");
});

test("cụm rỗng KHÔNG bị coi là đã xử", () => {
  // batch.every() trên mảng rỗng trả TRUE -> nếu quên chốt length thì mọi cụm
  // rỗng thành "đã xử", ngoại lệ tắt sai chỗ.
  const i = BOT.indexOf("const _cumDaXuLuotNay");
  const dong = BOT.slice(i, BOT.indexOf("\n", i));
  assert.match(dong, /batch\.length > 0/, "thiếu chốt mảng rỗng");
});

test("sổ theo lần chạy có chặn phình bộ nhớ", () => {
  const i = BOT.indexOf("_daXuLyLuotChay.add");
  const k = BOT.slice(i, i + 400);
  assert.match(k, /size > \d+/, "không chặn kích thước -> chạy dài ngày là phình RAM");
});

test("vẫn giữ ngoại lệ cho tin của LẦN CHẠY TRƯỚC", () => {
  // Đây là lý do ngoại lệ tồn tại: tin nhắn trước khi bật bot đã nằm trong sổ
  // ĐĨA nhưng chưa bao giờ được trả lời. Bỏ mất là bot lại lặng thinh sau restart.
  assert.match(BOT, /_unreadCustomerWaiting\s*&&\s*!_cumDaXuLuotNay\s*\)?\s*\n?\s*\?\s*batch/,
    "ngoại lệ phải còn nguyên cho tin lần chạy trước");
});

// --- 2) Nhớ cả lần trượt khi đọc bài quảng cáo ------------------------------
test("bài quảng cáo đọc trượt cũng được cache", () => {
  const i = READER.indexOf("if (result) _postCache.set");
  assert.ok(i > 0, "không thấy chỗ cache bài");
  const k = READER.slice(i, i + 300);
  assert.match(k, /else if \(!_adFetchRL\) _postCache\.set/,
    "trượt mà không cache -> lượt nào cũng gọi lại Pancake, lần nào cũng trượt");
});

test("lỗi 429 thì KHÔNG cache — đó là lỗi tạm thời", () => {
  // Cache cả 429 là tự khoá mình 30 phút vì một lần bị bóp nhịp.
  const i = READER.indexOf("if (result) _postCache.set");
  const k = READER.slice(i, i + 300);
  assert.match(k, /!_adFetchRL/, "phải loại trừ 429 khỏi cache-âm");
});

test("cache đọc ra vẫn xử đúng giá trị null", () => {
  // `return cached.result` với result=null là ĐÚNG (đã biết trượt). Chốt là điều
  // kiện kiểm cache phải xét sự tồn tại của bản ghi, không xét giá trị.
  const i = READER.indexOf("const cached = _postCache.get(sfb)");
  const k = READER.slice(i, i + 250);
  assert.match(k, /if \(cached &&/, "phải kiểm cached tồn tại, không kiểm cached.result");
});
