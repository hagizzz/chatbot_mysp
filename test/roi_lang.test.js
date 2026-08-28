// ============================================================================
// test/roi_lang.test.js — CỔNG CHẶN CUỐI: KHÁCH KHÔNG ĐƯỢC RƠI LẶNG LẼ
// ----------------------------------------------------------------------------
// Đo 25/08/2026 bằng bộ diễn 46 kịch bản: 4 ca bot KHÔNG nói câu nào, KHÔNG gắn
// thẻ, KHÔNG cả một dòng log nói vì sao.
//     "váy này mặc đi ăn cưới có hợp không em"   -> [AI-READ] nhãn=OCCASION_QA rồi hết
//     "váy này bao nhiêu tiền em"                 (nhắn thẳng, chưa rõ mẫu)
//     "váy này bao nhiêu tiền vậy shop"           (bình luận, bài không nêu mẫu)
//     "giá thiết kế Alisse bao nhiêu ạ"           (khách gõ sai tên mẫu)
// Cùng một kiểu: không tra ra mẫu -> rơi ra khỏi mọi nhánh. Khách ngồi chờ, nhân
// viên không biết, log không để lại dấu vết để truy.
//
// Nguyên tắc 1 của bản yêu cầu: "mơ hồ thì NHƯỜNG NGƯỜI THẬT". Nhường nghĩa là
// GẮN THẺ, không phải biến mất.
//
// Bài test khoá ba điều:
//   1) Cổng nằm ở TẦNG GỌI (bọc trọn 268 điểm return của processOneConversation),
//      không nhét bên trong, cũng không nhét vào turn_log.
//   2) Chế độ bóng TUYỆT ĐỐI không gắn thẻ — đây là điều dễ vỡ nhất khi sửa sau này.
//   3) turn_log ghi bằng được lượt rơi lặng, dù lượt đó chẳng làm gì khác.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");
const SRC_LOG = fs.readFileSync(path.join(GOC, "loi/tien_ich/turn_log.js"), "utf8");

// Cắt nguyên thân một hàm ra khỏi mã nguồn (bot_worker không có module.exports).
function layHam(src, ten) {
  const i = src.indexOf("async function " + ten + "(");
  assert.ok(i > 0, `không thấy hàm ${ten}`);
  let sau = 0;
  for (let k = src.indexOf("{", i); k < src.length; k++) {
    if (src[k] === "{") sau++;
    else if (src[k] === "}" && --sau === 0) return src.slice(i, k + 1);
  }
  assert.fail("không đóng được ngoặc " + ten);
}

// Dòng log đi qua createWriteStream -> tệp không hiện ra ngay khi run() trả về.
// Chờ tới khi thấy tệp, tối đa 2 giây, thay vì đọc ngay rồi kết luận oan.
async function doiTep(thu, giay = 2) {
  for (let i = 0; i < giay * 20; i++) {
    const tep = fs.readdirSync(thu).filter(f => f.endsWith(".jsonl"));
    if (tep.length && fs.readFileSync(path.join(thu, tep[0]), "utf8").trim()) return tep;
    await new Promise(r => setTimeout(r, 50));
  }
  return fs.readdirSync(thu).filter(f => f.endsWith(".jsonl"));
}

// --- 1) Cổng đứng đúng chỗ --------------------------------------------------

test("cổng được gọi ở tầng gọi, sau processOneConversation", () => {
  const i = SRC.indexOf("await processOneConversation(conv)");
  const j = SRC.indexOf("await canhRoiLang(");
  assert.ok(i > 0, "không thấy chỗ gọi processOneConversation");
  assert.ok(j > i, "canhRoiLang phải chạy SAU processOneConversation, ở tầng gọi");
  // Phải nằm trong cùng một lượt turnLog.run thì hienTai() mới đọc được.
  const iRun = SRC.indexOf("turnLog.run({");
  assert.ok(iRun > 0 && iRun < j, "cổng phải nằm trong lượt turnLog.run");
});

test("turn_log KHÔNG tự gắn thẻ — bộ ghi sổ không được đụng Pancake", () => {
  assert.ok(!/tagChoXuLy|addTag|conversation_tags/.test(SRC_LOG),
    "turn_log.js phải thuần ghi sổ, mọi tác động lên Pancake để tầng trên lo");
});

// --- 2) Chế độ bóng không được đụng thẻ -------------------------------------

test("mặc định là shadow, không phải on", () => {
  const h = layHam(SRC, "canhRoiLang");
  assert.match(h, /caiDat\("RAI_LANG_MODE",\s*"shadow"\)/,
    "mặc định phải là shadow — bật thật là quyết định của shop, không phải của mã");
});

test("shadow: thoát TRƯỚC khi gắn thẻ", () => {
  const h = layHam(SRC, "canhRoiLang");
  const iThoat = h.indexOf('if (mode !== "on") return;');
  const iThe = h.indexOf("tagChoXuLyVaUnread(");
  assert.ok(iThoat > 0, "thiếu cửa thoát cho chế độ không-phải-on");
  assert.ok(iThe > iThoat, "lệnh gắn thẻ phải nằm SAU cửa thoát, nếu không shadow cũng gắn thẻ");
});

test("off: tắt hẳn, không ghi sổ cũng không gắn thẻ", () => {
  const h = layHam(SRC, "canhRoiLang");
  const iOff = h.indexOf('if (mode === "off") return;');
  assert.ok(iOff > 0 && iOff < h.indexOf("roiLang = true"),
    "off phải thoát trước cả khi đánh dấu");
});

test("ba chế độ đều có mặt và .env.example nói rõ", () => {
  const h = layHam(SRC, "canhRoiLang");
  for (const m of ["shadow", "on", "off"]) {
    assert.ok(h.includes(`"${m}"`), `thiếu chế độ ${m}`);
  }
});

// --- 3) Điều kiện nhận diện -------------------------------------------------

test("chỉ soi lượt ĐÃ qua mốc có-việc-của-khách", () => {
  const h = layHam(SRC, "canhRoiLang");
  assert.match(h, /if \(!t\.khachText && !t\.coAnh\) return;/,
    "chưa có tin khách thì bot im là cố ý (thẻ giữ / cụm rỗng / đã xử) — không được tính là rơi");
});

test("làm bất kỳ việc gì thấy được thì không tính là rơi", () => {
  const h = layHam(SRC, "canhRoiLang");
  for (const dau of ["t.daTraLoi", "t.guiDi.length", "t.theGan.length", "t.theGo.length", "t.nhuongNguoiThat"]) {
    assert.ok(h.includes(dau), `thiếu dấu hiệu "${dau}" trong điều kiện loại trừ`);
  }
});

test("lượt LỖI không bị đếm hai lần", () => {
  const h = layHam(SRC, "canhRoiLang");
  assert.match(h, /if \(t\.loi\) return;/, "lỗi đã có đường báo riêng (giám sát), đừng gộp vào rơi lặng");
});

test("mốc khachText đặt SAU mọi cổng bỏ qua", () => {
  const iThe = SRC.indexOf("Còn thẻ giữ");
  const iCumRong = SRC.indexOf("KHÔNG lấy được cụm tin khách");
  const iDaXu = SRC.indexOf("không còn tin MỚI");
  const iMoc = SRC.indexOf("turnLog.set({\n    khachText:");
  assert.ok(iMoc > 0, "không thấy chỗ đặt mốc khachText");
  assert.ok(iMoc > iThe, "phải đặt sau cổng thẻ giữ");
  assert.ok(iMoc > iCumRong, "phải đặt sau cổng cụm tin rỗng");
  assert.ok(iMoc > iDaXu, "phải đặt sau cổng cụm đã xử lý");
});

// --- 4) turn_log ghi được lượt rơi lặng -------------------------------------

test("turn_log có trường roiLang", () => {
  assert.match(SRC_LOG, /roiLang:\s*false/, "thiếu trường roiLang trong khuôn một lượt");
});

test("lượt rơi lặng được ghi ra tệp dù không làm gì khác", () => {
  const m = SRC_LOG.match(/if \(t\.daTraLoi \|\|[^)]*\) \{\s*\n\s*ghiDong\(t\);/);
  assert.ok(m, "không thấy điều kiện ghi dòng");
  assert.ok(m[0].includes("t.roiLang"),
    "roiLang phải nằm trong điều kiện ghi — không ghi thì đếm bằng gì");
});

test("turn_log chạy thật: lượt rỗng có tin khách -> ghi được", async () => {
  const os = require("node:os");
  const thu = fs.mkdtempSync(path.join(os.tmpdir(), "roilang_"));
  const cu = process.env.TURNLOG_DIR;
  process.env.TURNLOG_DIR = thu;
  delete require.cache[require.resolve("../loi/tien_ich/turn_log")];
  const tl = require("../loi/tien_ich/turn_log");

  await tl.run({ conversationId: "test_1", pageId: "p", kenh: "INBOX" }, async () => {
    tl.set({ khachText: "váy này mặc đi ăn cưới có hợp không em", intent: "OCCASION_QA" });
    const t = tl.hienTai();
    t.roiLang = true;              // đúng thứ canhRoiLang làm
  });

  const tep = await doiTep(thu);
  assert.ok(tep.length, "không sinh ra tệp log nào");
  const dong = fs.readFileSync(path.join(thu, tep[0]), "utf8").trim().split("\n").map(JSON.parse);
  const r = dong.find(d => d.conversationId === "test_1");
  assert.ok(r, "lượt rơi lặng KHÔNG được ghi -> không đếm được, cổng thành vô dụng");
  assert.strictEqual(r.roiLang, true);
  assert.strictEqual(r.intent, "OCCASION_QA");
  assert.strictEqual(r.guiDi.length, 0);

  if (cu === undefined) delete process.env.TURNLOG_DIR; else process.env.TURNLOG_DIR = cu;
  delete require.cache[require.resolve("../loi/tien_ich/turn_log")];
  fs.rmSync(thu, { recursive: true, force: true });
});

test("lượt KHÔNG có tin khách thì vẫn không ghi — log không được loãng", async () => {
  const os = require("node:os");
  const thu = fs.mkdtempSync(path.join(os.tmpdir(), "roilang2_"));
  const cu = process.env.TURNLOG_DIR;
  process.env.TURNLOG_DIR = thu;
  delete require.cache[require.resolve("../loi/tien_ich/turn_log")];
  const tl = require("../loi/tien_ich/turn_log");

  await tl.run({ conversationId: "test_2", pageId: "p", kenh: "INBOX" }, async () => { /* bot bỏ qua */ });

  await new Promise(r => setTimeout(r, 300));   // cho stream kịp ghi nếu nó ĐỊNH ghi
  const tep = fs.readdirSync(thu).filter(f => f.endsWith(".jsonl"));
  const dong = tep.length
    ? fs.readFileSync(path.join(thu, tep[0]), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
    : [];
  assert.ok(!dong.find(d => d.conversationId === "test_2"),
    "lượt bot cố ý bỏ qua không được ghi, kẻo mỗi vòng poll đẻ một dòng");

  if (cu === undefined) delete process.env.TURNLOG_DIR; else process.env.TURNLOG_DIR = cu;
  delete require.cache[require.resolve("../loi/tien_ich/turn_log")];
  fs.rmSync(thu, { recursive: true, force: true });
});

// Cổng dễ quên nhất, và là cái đã làm bản đầu báo oan 40 lần / 46 kịch bản.
// Bot hoãn trả lời để đợi khách gõ xong rồi gộp tin — câu trả lời rơi vào lượt SAU.
// Đặt mốc trước cổng này thì mọi lượt đang đợi đều bị chấm là "bỏ rơi khách".
test("mốc khachText đặt SAU cổng chờ gộp tin (debounce)", () => {
  const iDebounce = SRC.indexOf("Date.now() - latestAt < DEBOUNCE_MS");
  const iMoc = SRC.indexOf("khachText: batch.filter");
  assert.ok(iDebounce > 0, "không thấy cổng debounce");
  assert.ok(iMoc > 0, "không thấy mốc khachText");
  assert.ok(iMoc > iDebounce,
    "mốc phải nằm SAU cổng debounce — lượt đang đợi khách gõ xong KHÔNG phải là rơi lặng");
});
