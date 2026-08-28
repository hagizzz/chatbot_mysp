// ============================================================================
// test/khoa_tien_trinh.test.js — HAI BOT CÙNG SỐNG = KHÁCH NHẬN TIN ĐÔI
// ----------------------------------------------------------------------------
// Shop báo 26/08/2026: "bot trả lời 2 tin nhắn liên tiếp trùng nhau".
//
// Log page thật, hội thoại Hà Giang:
//   02:43:38 KHÁCH  vậy lấy e cái màu hồng size M nhé
//   02:44:02 SHOP   ...chị CHO EM XIN THÊM số điện thoại để em lên đơn cho mình ạ
//   02:44:08 SHOP   ...chị ƯNG Ý CHO EM XIN số điện thoại để em lên đơn cho mình ạ?
//
// Hai tiến trình bot cùng sống ~15 giây (khởi động lại giữa lúc một lượt đang
// chạy dở). Tiến trình cũ gửi câu 1 rồi bị giết TRƯỚC khi ghi xuống đĩa hai
// cuốn sổ của nó — processed_messages.json ghi trễ 3 giây (processed_store.js
// dòng ~30), bot_dup_sent.json cũng ghi trễ. Tiến trình mới đọc đĩa, không thấy
// dấu vết, tưởng chưa ai trả lời -> soạn lại và gửi câu 2.
//
// Bằng chứng trong bot_dup_sent.json sau ca đó: có ngăn 02:43:16 và 02:44:07,
// KHÔNG có 02:44:02 — đúng câu của tiến trình bị giết.
//
// SỔ CHỐNG TRÙNG KHÔNG BAO GIỜ BẮT ĐƯỢC ca này: nó so chuỗi đã chuẩn hoá, mà
// hai câu trên là hai cách diễn đạt khác nhau của cùng một ý. Phải chặn ở gốc.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync, spawn } = require("node:child_process");

// Một tiến trình THẬT còn sống, pid khác pid của test. Không dùng PID cố định:
// PID 1 có trên Linux/macOS nhưng KHÔNG có trên Windows -> test xanh ở máy này,
// đỏ ở máy kia (đã dính đúng vậy khi viết tệp này).
function deTienTrinhSong() {
  const p = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)"], { stdio: "ignore" });
  return { pid: p.pid, giet: () => { try { p.kill(); } catch (_) {} } };
}

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

function nap() {
  const tep = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "khoa_")), "bot.lock");
  const cu = process.env.KHOA_TIEN_TRINH_FILE;
  process.env.KHOA_TIEN_TRINH_FILE = tep;
  delete require.cache[require.resolve(path.join(GOC, "loi/tien_ich/khoa_tien_trinh.js"))];
  const m = require(path.join(GOC, "loi/tien_ich/khoa_tien_trinh.js"));
  return {
    m, tep,
    tra() {
      if (cu === undefined) delete process.env.KHOA_TIEN_TRINH_FILE;
      else process.env.KHOA_TIEN_TRINH_FILE = cu;
      delete require.cache[require.resolve(path.join(GOC, "loi/tien_ich/khoa_tien_trinh.js"))];
    }
  };
}

// --- 1. Giữ / nhả ------------------------------------------------------------
test("chưa ai giữ -> giữ được, và ghi PID xuống tệp", () => {
  const t = nap();
  try {
    const r = t.m.giu();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(JSON.parse(fs.readFileSync(t.tep, "utf8")).pid, process.pid);
  } finally { t.m.nha(); t.tra(); }
});

test("CHÍNH MÌNH giữ lại lần nữa -> vẫn cho (không tự chặn mình)", () => {
  const t = nap();
  try {
    assert.strictEqual(t.m.giu().ok, true);
    assert.strictEqual(t.m.giu().ok, true, "tự chặn mình thì bot không bao giờ khởi động được");
  } finally { t.m.nha(); t.tra(); }
});

test("tiến trình KHÁC còn sống đang giữ -> CHẶN", () => {
  const t = nap();
  const kia = deTienTrinhSong();
  try {
    fs.writeFileSync(t.tep, JSON.stringify({ pid: kia.pid, tu_luc: new Date().toISOString(), moi_truong: "staging", chi_xu_ly: 1 }), "utf8");
    const r = t.m.giu();
    assert.strictEqual(r.ok, false, "cho qua = hai bot cùng sống = khách nhận tin đôi");
    assert.strictEqual(r.chu.pid, kia.pid, "phải trả về chủ khoá để in ra cho người dùng");
    assert.match(t.m.loiChan(r.chu), new RegExp(String(kia.pid)), "câu báo phải nêu PID để còn taskkill");
  } finally { kia.giet(); t.tra(); }
});

test("khoá CŨ (tiến trình đã chết) -> tự dọn, KHÔNG chặn oan", () => {
  // Sau một cú sập, khoá còn nằm đó. Chặn ở đây là bot không bao giờ dậy lại.
  const t = nap();
  try {
    const pidChet = layPidChet();
    fs.writeFileSync(t.tep, JSON.stringify({ pid: pidChet, tu_luc: new Date().toISOString() }), "utf8");
    assert.strictEqual(t.m.giu().ok, true, `PID ${pidChet} đã chết -> phải cho chạy`);
  } finally { t.m.nha(); t.tra(); }
});

test("tệp khoá HỎNG -> coi như không có khoá, không ném lỗi", () => {
  const t = nap();
  try {
    fs.writeFileSync(t.tep, "{ không phải json", "utf8");
    assert.strictEqual(t.m.giu().ok, true, "tệp hỏng mà chặn thì bot chết cứng, phải xoá tay mới chạy được");
  } finally { t.m.nha(); t.tra(); }
});

test("--ep-khoa cướp được khoá của tiến trình còn sống", () => {
  const t = nap();
  const kia = deTienTrinhSong();
  try {
    fs.writeFileSync(t.tep, JSON.stringify({ pid: kia.pid, tu_luc: new Date().toISOString() }), "utf8");
    assert.strictEqual(t.m.giu({ ep: false }).ok, false);
    assert.strictEqual(t.m.giu({ ep: true }).ok, true, "phải có đường thoát khi khoá kẹt");
  } finally { kia.giet(); t.m.nha(); t.tra(); }
});

test("nha() chỉ xoá khoá CỦA MÌNH", () => {
  // Nhả khoá của tiến trình khác là mở cửa cho đúng cái lỗi đang chặn.
  const t = nap();
  const kia = deTienTrinhSong();
  try {
    fs.writeFileSync(t.tep, JSON.stringify({ pid: kia.pid, tu_luc: new Date().toISOString() }), "utf8");
    t.m.nha();
    assert.ok(fs.existsSync(t.tep), "đã xoá khoá của tiến trình khác");
  } finally { kia.giet(); t.tra(); }
});

// PID chắc chắn đã chết: đẻ một tiến trình rồi đợi nó thoát.
function layPidChet() {
  const r = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  return Number(r.stdout.trim());
}

test("conSong đọc đúng sống/chết", () => {
  const t = nap();
  try {
    assert.strictEqual(t.m.conSong(process.pid), true, "chính mình phải là còn sống");
    assert.strictEqual(t.m.conSong(layPidChet()), false);
    for (const xau of [0, -1, NaN, null, undefined, "abc"]) {
      assert.strictEqual(t.m.conSong(xau), false, `pid ${JSON.stringify(xau)} không hợp lệ`);
    }
  } finally { t.tra(); }
});

// --- 1b. Nhịp tim: khoá không được GIAM bot ---------------------------------
// Đã tự cắn ngay hôm đặt khoá: bot cũ chết, khoá còn, tiến trình mới bị chặn và
// KHÔNG CÁCH NÀO chạy được. Khoá giam mất bot còn tệ hơn không có khoá — bot
// không chạy thì không khách nào được trả lời.
test("chủ khoá còn sống nhưng NGỪNG ĐIỂM DANH quá hạn -> coi là khoá cũ", () => {
  const t = nap();
  const kia = deTienTrinhSong();
  try {
    const qua = new Date(Date.now() - t.m.HAN_MS - 5000).toISOString();
    fs.writeFileSync(t.tep, JSON.stringify({ pid: kia.pid, tu_luc: qua, nhip: qua }), "utf8");
    assert.strictEqual(t.m.conHieuLuc({ pid: kia.pid, nhip: qua }), false);
    assert.strictEqual(t.m.giu().ok, true,
      "PID còn sống nhưng đã im lặng quá hạn -> phải cho chạy, nếu không PID bị dùng lại là kẹt vĩnh viễn");
  } finally { kia.giet(); t.m.nha(); t.tra(); }
});

test("chủ khoá VẪN điểm danh -> chặn", () => {
  const t = nap();
  const kia = deTienTrinhSong();
  try {
    const moi = new Date().toISOString();
    fs.writeFileSync(t.tep, JSON.stringify({ pid: kia.pid, tu_luc: moi, nhip: moi }), "utf8");
    assert.strictEqual(t.m.giu().ok, false, "bot đang sống và điểm danh đều -> tuyệt đối không cho chạy thêm");
  } finally { kia.giet(); t.tra(); }
});

test("khoá ĐỜI CŨ (chưa có trường nhip) -> chỉ xét PID, không cướp oan", () => {
  // Nâng cấp giữa chừng: bot đang chạy giữ khoá kiểu cũ. Coi "không có nhịp" là
  // quá hạn thì bản mới cướp khoá ngay -> đúng cảnh hai bot cùng sống.
  const t = nap();
  const kia = deTienTrinhSong();
  try {
    fs.writeFileSync(t.tep, JSON.stringify({ pid: kia.pid, tu_luc: new Date().toISOString() }), "utf8");
    assert.strictEqual(t.m.giu().ok, false);
  } finally { kia.giet(); t.tra(); }
});

test("nhip HỎNG (không đọc được ngày) -> coi như còn hạn, không cướp bừa", () => {
  const t = nap();
  const kia = deTienTrinhSong();
  try {
    assert.strictEqual(t.m.conHieuLuc({ pid: kia.pid, nhip: "hôm qua" }), true);
  } finally { kia.giet(); t.tra(); }
});

test("giu() bật nhịp tim và nhịp KHÔNG giữ tiến trình sống", async () => {
  // Thiếu unref thì bot xử xong vẫn không thoát, và mọi script require mô-đun
  // này sẽ treo 15 giây một nhịp — mãi mãi.
  const S = fs.readFileSync(path.join(GOC, "loi/tien_ich/khoa_tien_trinh.js"), "utf8");
  assert.match(S, /_batNhip\.unref/, "thiếu unref -> tiến trình không bao giờ thoát");
  assert.match(S, /h\.nhip = new Date\(\)\.toISOString\(\)/, "nhịp phải THỰC SỰ ghi lại mốc");
  assert.match(S, /Number\(h\.pid\) !== process\.pid\) return;/,
    "bị cướp khoá rồi thì thôi, không ghi đè khoá của tiến trình khác");

  // Chạy thật với nhịp rất nhanh: mốc phải đổi.
  const tep = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nhip_")), "bot.lock");
  const ra = execFileSync(process.execPath, ["-e",
    `process.env.KHOA_TIEN_TRINH_FILE=${JSON.stringify(tep)};process.env.KHOA_NHIP_MS="40";` +
    `const k=require(${JSON.stringify(path.join(GOC, "loi/tien_ich/khoa_tien_trinh.js"))});k.giu();` +
    `const a=k.doc().nhip;setTimeout(()=>{process.stdout.write(String(k.doc().nhip!==a));},300);`],
    { encoding: "utf8" });
  assert.strictEqual(ra, "true", "mốc điểm danh không đổi -> nhịp tim không chạy");
});

test("nha() tắt nhịp tim", () => {
  assert.match(fs.readFileSync(path.join(GOC, "loi/tien_ich/khoa_tien_trinh.js"), "utf8"),
    /function nha\(\) \{\s*if \(_batNhip\) \{ clearInterval\(_batNhip\)/,
    "nhả khoá mà còn đập nhịp là ghi đè khoá của tiến trình vừa nhận");
});

// --- 2. Lõi bot phải THẬT SỰ gọi khoá ---------------------------------------
test("bot lấy khoá NGAY sau env_boot, trước khi nạp vision", () => {
  // Nạp vision mất 12 giây và ngốn RAM. Chặn sau đó thì tiến trình thừa vẫn kịp
  // dựng cả worker rồi mới chết — và tệ hơn, có thể đã kịp gọi Pancake.
  // Dò CHUỖI CÓ THẬT trong bot_worker_api_v3.js — tệp đó nằm ở GỐC nên đường dẫn
  // của nó là "./...", không phải "../...". (Bộ dọn thư mục 27/08/2026 từng đổi
  // nhầm hai chuỗi này thành "../" vì tưởng là require của chính tệp test.)
  const iEnv = SRC.indexOf('require("./env_boot")');
  const iKhoa = SRC.indexOf('require("./loi/tien_ich/khoa_tien_trinh")');
  const iVision = SRC.indexOf("vision_resolver");
  assert.ok(iKhoa > iEnv, "khoá phải sau env_boot (cần biết BOT_ENV)");
  assert.ok(iVision < 0 || iKhoa < iVision, "khoá phải TRƯỚC vision");
});

test("chặn thì THOÁT hẳn, không chạy tiếp", () => {
  const i = SRC.indexOf("const _kq = _khoa.giu(");
  const k = SRC.slice(i, i + 400);
  assert.match(k, /process\.exit\(1\)/, "in cảnh báo rồi chạy tiếp = vẫn hai bot");
  assert.match(k, /_khoa\.loiChan\(_kq\.chu\)/, "phải nói rõ ai đang giữ, không thì người dùng bó tay");
});

test("nhả khoá ở mọi đường thoát bình thường", () => {
  const i = SRC.indexOf("const _kq = _khoa.giu(");
  const k = SRC.slice(i, i + 700);
  assert.match(k, /process\.on\("exit", \(\) => _khoa\.nha\(\)\)/);
  for (const tin of ["SIGINT", "SIGTERM"]) {
    assert.ok(k.includes(tin), `thiếu ${tin} -> Ctrl+C xong khoá còn kẹt lại`);
  }
});

test("bot.lock nằm trong .gitignore", () => {
  const g = fs.readFileSync(path.join(GOC, ".gitignore"), "utf8");
  assert.match(g, /^bot\.lock$/m, "PID của máy này không việc gì phải vào git");
});

// --- 3. Chạy thật: tiến trình thứ hai phải bị chặn --------------------------
test("gọi hai lần trong HAI tiến trình thật -> cái thứ hai bị chặn", async () => {
  // Ca thật, không phải mô phỏng: đúng tình huống 26/08 — tiến trình cũ còn sống
  // thì tiến trình mới KHÔNG được phép chạy.
  const tep = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "khoa2_")), "bot.lock");
  const duong = JSON.stringify(path.join(GOC, "loi/tien_ich/khoa_tien_trinh.js"));
  const ma = (song) => `process.env.KHOA_TIEN_TRINH_FILE=${JSON.stringify(tep)};` +
    `const k=require(${duong});process.stdout.write(String(k.giu().ok));` +
    (song ? "setTimeout(()=>{},10000);" : "");

  const p1 = spawn(process.execPath, ["-e", ma(true)], { stdio: ["ignore", "pipe", "ignore"] });
  try {
    const ra = await new Promise((ok, hong) => {
      let s = "";
      p1.stdout.on("data", d => { s += d; if (s.length) ok(s); });
      p1.on("error", hong);
      p1.on("exit", () => ok(s));
    });
    assert.strictEqual(ra, "true", "tiến trình 1 phải giữ được khoá");
    assert.strictEqual(execFileSync(process.execPath, ["-e", ma(false)], { encoding: "utf8" }), "false",
      "tiến trình 2 PHẢI bị chặn — đây chính là ca gây tin đôi cho khách");
  } finally { p1.kill(); }
});
