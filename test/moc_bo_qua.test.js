// ============================================================================
// test/moc_bo_qua.test.js — MỐC BỎ QUA TIN CŨ
// ----------------------------------------------------------------------------
// Shop hỏi 26/08/2026: "reset lại hết tn trong hội thoại, có xoá được tin nhắn
// trong messenger không". KHÔNG xoá được — API Meta không có endpoint xoá tin
// trong hội thoại, Pancake public_api cũng không.
//
// Nên reset chỉ sạch một nửa: dọn xong bộ nhớ, nhưng mỗi lượt bot vẫn nạp 20 tin
// cuối THẲNG TỪ PANCAKE vào cửa sổ AI (buildConversationForAi, dòng ~3544) — AI
// vẫn đọc thấy 'số nhà 67, Thanh Xuân', size M, 9 mã đã báo giá của ca cũ.
//
// Không xoá được thì che: tin cũ hơn MỐC coi như không tồn tại.
//
// Mốc còn là thứ shop cần khi bot lên page thật: page đang có 240 hội thoại với
// cả năm lịch sử; ngày đầu bật bot mà không có mốc là nó đọc hết đống cũ đó.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

// Mỗi lần nạp module với MỘT tệp riêng trong thư mục tạm: không đụng
// moc_bo_qua.json thật của máy đang chạy thử.
function nap(noiDung, env) {
  const tep = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "moc_")), "moc_bo_qua.json");
  if (noiDung !== undefined) fs.writeFileSync(tep, JSON.stringify(noiDung), "utf8");
  const cuFile = process.env.MOC_BO_QUA_FILE;
  const cuEnv = process.env.BO_QUA_TIN_TRUOC;
  process.env.MOC_BO_QUA_FILE = tep;
  if (env === undefined) delete process.env.BO_QUA_TIN_TRUOC;
  else process.env.BO_QUA_TIN_TRUOC = env;
  delete require.cache[require.resolve(path.join(GOC, "loi/bo_nho/moc_bo_qua.js"))];
  const m = require(path.join(GOC, "loi/bo_nho/moc_bo_qua.js"));
  return {
    m, tep,
    tra() {
      if (cuFile === undefined) delete process.env.MOC_BO_QUA_FILE; else process.env.MOC_BO_QUA_FILE = cuFile;
      if (cuEnv === undefined) delete process.env.BO_QUA_TIN_TRUOC; else process.env.BO_QUA_TIN_TRUOC = cuEnv;
      delete require.cache[require.resolve(path.join(GOC, "loi/bo_nho/moc_bo_qua.js"))];
    }
  };
}

// --- 1. Không cấu hình gì -> hành vi y như trước ----------------------------
test("chưa đặt mốc thì trả 0 — bot chạy y như chưa có tính năng này", () => {
  const t = nap(undefined, undefined);
  try {
    assert.strictEqual(t.m.moc("conv1"), 0, "0 = không có mốc = không lọc gì cả");
  } finally { t.tra(); }
});

test("tệp HỎNG cũng trả 0, không ném lỗi làm chết bot", () => {
  const t = nap(undefined, undefined);
  try {
    fs.writeFileSync(t.tep, "{ đây không phải json", "utf8");
    assert.strictEqual(t.m.moc("conv1"), 0,
      "tệp hỏng mà ném lỗi thì mất cả vòng poll; mà lọc bừa thì bot mù cả hội thoại");
  } finally { t.tra(); }
});

// --- 2. Hai tầng mốc --------------------------------------------------------
test("mốc toàn cục trong .env áp cho MỌI hội thoại", () => {
  const t = nap(undefined, "2026-08-26T00:00:00Z");
  try {
    assert.strictEqual(t.m.moc("bat_ky"), Date.parse("2026-08-26T00:00:00Z"));
  } finally { t.tra(); }
});

test("mốc riêng của hội thoại chỉ áp cho đúng hội thoại đó", () => {
  const t = nap({ "convA": "2026-08-26T10:00:00Z" }, undefined);
  try {
    assert.strictEqual(t.m.moc("convA"), Date.parse("2026-08-26T10:00:00Z"));
    assert.strictEqual(t.m.moc("convB"), 0, "reset một hội thoại không được làm câm hội thoại khác");
  } finally { t.tra(); }
});

test("lấy mốc MUỘN HƠN — mốc riêng cũ hơn KHÔNG chọc thủng hàng rào toàn cục", () => {
  // Mốc toàn cục là chốt của shop: "đừng đọc lịch sử trước ngày bật bot". Nếu để
  // mốc riêng đè xuống, một lệnh reset lỡ tay là bot lôi cả năm lịch sử ra đọc.
  const t = nap({ "convA": "2026-01-01T00:00:00Z" }, "2026-08-26T00:00:00Z");
  try {
    assert.strictEqual(t.m.moc("convA"), Date.parse("2026-08-26T00:00:00Z"));
  } finally { t.tra(); }
});

test("mốc riêng MUỘN hơn thì thắng", () => {
  const t = nap({ "convA": "2026-08-26T12:00:00Z" }, "2026-08-26T00:00:00Z");
  try {
    assert.strictEqual(t.m.moc("convA"), Date.parse("2026-08-26T12:00:00Z"));
  } finally { t.tra(); }
});

// --- 3. Đọc mốc từ nhiều dạng ----------------------------------------------
test("đọc được ISO, ms, giây và 'bay_gio'; rác thì ra 0", () => {
  const t = nap(undefined, undefined);
  try {
    const { docMoc } = t.m;
    assert.strictEqual(docMoc("2026-08-26T00:00:00Z"), Date.parse("2026-08-26T00:00:00Z"));
    assert.strictEqual(docMoc(1787000000000), 1787000000000);
    assert.strictEqual(docMoc("1787000000"), 1787000000000, "giây -> ms");
    assert.ok(docMoc("bay_gio") > Date.parse("2026-01-01"), "'bay_gio' = lúc gọi");
    for (const rac of ["hôm qua", "", null, undefined, "abc"]) {
      assert.strictEqual(docMoc(rac), 0, `"${rac}" phải ra 0, KHÔNG được ra NaN`);
    }
  } finally { t.tra(); }
});

test("NaN không được lọt ra ngoài — so sánh với NaN luôn false, bot sẽ giấu SẠCH tin", () => {
  const t = nap({ "convA": "hôm kia" }, undefined);
  try {
    assert.strictEqual(t.m.moc("convA"), 0);
  } finally { t.tra(); }
});

// --- 4. Ghi / xoá ----------------------------------------------------------
test("dat rồi moc đọc lại được ngay, không cần khởi động lại", () => {
  const t = nap({}, undefined);
  try {
    const khi = Date.parse("2026-08-26T09:30:00Z");
    t.m.dat("convA", khi);
    assert.strictEqual(t.m.moc("convA"), khi, "cache theo mtime phải tự làm mới");
    assert.ok(t.m.xoa("convA"));
    assert.strictEqual(t.m.moc("convA"), 0);
    assert.strictEqual(t.m.xoa("convA"), false, "xoá cái không có -> false, không ném");
  } finally { t.tra(); }
});

test("dat KHÔNG đè mốc của hội thoại khác", () => {
  const t = nap({ "convB": "2026-08-20T00:00:00Z" }, undefined);
  try {
    t.m.dat("convA", Date.parse("2026-08-26T00:00:00Z"));
    assert.strictEqual(t.m.moc("convB"), Date.parse("2026-08-20T00:00:00Z"));
  } finally { t.tra(); }
});

// --- 5. Lõi bot: KHÔNG nơi gọi nào được lách bộ lọc -------------------------
// Đây là chốt quan trọng nhất của tệp test này. Ngày 25/08 đã có bài học đắt:
// rào isUrgentSpecificDate ở MỘT trong NĂM nơi gọi, bốn nhánh còn lại chạy y
// như cũ và giả lập mới bắt được. readConversation có BA nơi gọi.
test("readConversation gốc chỉ được gọi ĐÚNG MỘT LẦN — trong hàm bọc", () => {
  const soLan = (SRC.match(/_readConversationGoc\s*\(/g) || []).length;
  assert.strictEqual(soLan, 1,
    `_readConversationGoc bị gọi ${soLan} lần. Gọi thẳng tên gốc là ĐI VÒNG QUA mốc: ` +
    "nhánh đó vẫn đọc trọn lịch sử. Mọi nơi phải gọi readConversation(...)");
});

test("tên gốc đã đổi khi import — không còn readConversation trần để gọi nhầm", () => {
  const dong = SRC.split("\n").find(l => l.includes("require(_MO_DUN_READER)"));
  assert.ok(dong, "không thấy dòng import reader");
  assert.match(dong, /readConversation:\s*_readConversationGoc/,
    "còn import tên trần thì hàm bọc bị đè và mốc chết lặng lẽ");
});

test("hàm bọc THẬT SỰ lọc, và các nơi gọi vẫn còn", () => {
  const i = SRC.indexOf("async function readConversation(conversationId, convMeta)");
  assert.ok(i > 0, "không thấy hàm bọc");
  const than = SRC.slice(i, SRC.indexOf("\n}", i));
  assert.match(than, /_mocBoQua\.moc\(conversationId\)/, "chưa tra mốc");
  assert.match(than, /data\.messages\s*=\s*data\.messages\.filter/, "chưa lọc tin");
  assert.ok((SRC.match(/[^_]readConversation\(/g) || []).length >= 3,
    "phải còn đủ 3 nơi gọi qua hàm bọc");
});

test("mốc 0 thì TRẢ NGUYÊN dữ liệu — không đụng gì khi shop chưa bật", () => {
  const i = SRC.indexOf("async function readConversation(conversationId, convMeta)");
  const than = SRC.slice(i, SRC.indexOf("\n}", i));
  assert.match(than, /if \(!moc \|\| !data \|\| !Array\.isArray\(data\.messages\)/,
    "thiếu đường thoát sớm -> mọi shop chưa cấu hình đều phải chịu chi phí lọc + rủi ro");
});

test("tin KHÔNG có dấu thời gian thì GIỮ, không vứt", () => {
  // Chiều hỏng an toàn là "bot thấy nhiều hơn" (như trước khi có mốc), chứ không
  // phải "bot mù mất một tin khách đang chờ".
  const i = SRC.indexOf("async function readConversation(conversationId, convMeta)");
  const than = SRC.slice(i, SRC.indexOf("\n}", i));
  assert.match(than, /return !t \|\| t >= moc/,
    "phải giữ tin không có insertedAt");
});

// --- 6. Lọc chạy đúng trên dữ liệu thật -------------------------------------
test("bộ lọc bóc từ mã ra chạy: giấu tin cũ, giữ tin mới", () => {
  const i = SRC.indexOf("async function readConversation(conversationId, convMeta)");
  const than = SRC.slice(i, SRC.indexOf("\n}", i));
  const mLoc = /data\.messages = data\.messages\.filter\(m => \{([\s\S]*?)\}\);/.exec(than);
  assert.ok(mLoc, "không bóc được thân bộ lọc");

  const s = {};
  new Function("s", "with (s) {" +
    // parseTime là hàm thật của lõi bot — chép nguyên để test đúng cái đang chạy.
    (() => { const j = SRC.indexOf("function parseTime(s)"); return SRC.slice(j, SRC.indexOf("\n}", j) + 2); })() +
    "\n s.loc = (msgs, moc) => msgs.filter(m => {" + mLoc[1] + "}); }")(s);

  const moc = Date.parse("2026-08-26T00:00:00Z");
  const tin = [
    { text: "địa chỉ cũ Thanh Xuân, Hà Nội", insertedAt: "2026-08-25T10:00:00Z" },
    { text: "số nhà 67",                     insertedAt: "2026-08-25T10:05:00Z" },
    { text: "tin mới của ca thử",            insertedAt: "2026-08-26T09:00:00Z" },
    { text: "không có dấu thời gian" }
  ];
  const ra = s.loc(tin, moc).map(m => m.text);
  assert.deepStrictEqual(ra, ["tin mới của ca thử", "không có dấu thời gian"],
    "địa chỉ cũ lọt qua mốc thì reset vô nghĩa — đúng lỗi đang sửa");
});

test("gioTin khớp TỪNG CHỮ với parseTime của lõi bot", () => {
  // Lỗi thật 26/08/2026: reset_hoi_thoai.js tự dùng new Date() để tính mốc.
  // Pancake trả "2026-08-25T10:29:15.176000" (KHÔNG có múi giờ); JS coi là giờ
  // máy, parseTime gắn "Z" coi là UTC -> lệch ĐÚNG 7 tiếng ở Việt Nam. Mốc đặt
  // ra thấp hơn mọi tin cũ, bot vẫn đọc trọn 35 tin, mà script in "giấu 35/35".
  // Không lỗi, không log, số liệu còn khẳng định là xong.
  const s = {};
  const j = SRC.indexOf("function parseTime(s)");
  new Function("s", "with (s) {" + SRC.slice(j, SRC.indexOf("\n}", j) + 2) + "\n s.p = parseTime; }")(s);
  const t = nap(undefined, undefined);
  try {
    const ca = [
      "2026-08-25T10:29:15.176000",     // <- dạng Pancake THẬT trả về
      "2026-08-25T10:29:15",
      "2026-08-25 10:29:15",
      "2026-08-25T10:29:15Z",
      "2026-08-25T10:29:15+07:00",
      "2026-08-25T10:29:15+0700",
      1787000000000, 1787000000, 0, null, "", "rác"
    ];
    for (const c of ca) {
      assert.strictEqual(t.m.gioTin(c), s.p(c),
        `lệch ở ${JSON.stringify(c)}: mốc và lõi bot phải hiểu giờ y hệt nhau`);
    }
    assert.strictEqual(t.m.gioTin("2026-08-25T10:29:15.176000"), Date.parse("2026-08-25T10:29:15.176Z"),
      "dạng Pancake không múi giờ phải hiểu là UTC");
  } finally { t.tra(); }
});

test("reset_hoi_thoai.js KHÔNG được tự new Date() trên giờ tin nhắn", () => {
  const R = fs.readFileSync(path.join(GOC, "cong_cu/reset_hoi_thoai.js"), "utf8");
  assert.match(R, /mocBoQua\.gioTin\(m && m\.insertedAt\)/, "phải dùng chung hàm đọc giờ");
  assert.ok(!/new Date\(\s*\(?m\s*&&\s*m\.insertedAt/.test(R),
    "tự new Date() trên insertedAt là lệch 7 tiếng, mốc đặt ra vô tác dụng");
});

test("Pancake trả giờ KHÔNG có múi ('2026-08-25 10:00:00') vẫn so đúng", () => {
  // parseTime coi dạng này là UTC. Nếu bộ lọc tự new Date() thì lệch 7 tiếng và
  // một buổi sáng tin cũ lọt qua mốc.
  const s = {};
  const j = SRC.indexOf("function parseTime(s)");
  new Function("s", "with (s) {" + SRC.slice(j, SRC.indexOf("\n}", j) + 2) + "\n s.p = parseTime; }")(s);
  assert.strictEqual(s.p("2026-08-25 10:00:00"), Date.parse("2026-08-25T10:00:00Z"));
});

// --- 7. Công cụ reset phải đặt mốc ------------------------------------------
test("reset_hoi_thoai.js đặt mốc, và --tra-loi-lai đặt mốc TRƯỚC cụm tin cuối", () => {
  const R = fs.readFileSync(path.join(GOC, "cong_cu/reset_hoi_thoai.js"), "utf8");
  assert.match(R, /mocBoQua\.dat\(convId, mocMoi\)/, "reset mà không đặt mốc thì sạch nửa vời");
  assert.match(R, /TRA_LOI_LAI && tCumCuoi/,
    "--tra-loi-lai mà mốc đứng SAU cụm tin cuối thì vừa mở khoá vừa giấu đi -> bot im như chưa reset");
  assert.match(R, /GIU_LICH_SU/, "phải có đường từ chối đặt mốc");
});
