// ============================================================================
// test/kho_kich_ban.test.js — LƯỚI AN TOÀN CHO KHO KỊCH BẢN
// ----------------------------------------------------------------------------
// Sau khi rút, câu bot nói KHÔNG còn nằm trong mã nữa mà nằm trong
// kich_ban/mac_dinh.json. Đổi lại sự gọn gàng đó, ta mất lưới đỡ "phom code
// ngay tại chỗ" — nên lưới phải chuyển sang đây, và phải chặt hơn:
//
//   1. Mọi khoá mã nguồn gọi đều PHẢI có trong kho (thiếu = bot câm một câu).
//   2. Mọi ô {…} trong câu đều PHẢI được nơi gọi truyền vào.
//   3. Render phải GIỐNG HỆT ngữ nghĩa chuỗi mẫu của JS — đây là điều kiện để
//      việc rút không đổi hành vi bot đang chạy thật.
//   4. Shop KHÔNG được đè ngăn "prompt" (luật dạy AI).
// ============================================================================
const os = require("node:os");
const path = require("node:path");
process.env.TURNLOG_DIR = path.join(os.tmpdir(), "turnlog-test-kho");

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const KB = require("../loi/cau_noi/kho_kich_ban");

const GOC = path.join(__dirname, "..");
const TEP_MA = ["bot_worker_api_v3.js"];
const kho = JSON.parse(fs.readFileSync(path.join(GOC, "kich_ban", "mac_dinh.json"), "utf8"));

// Bóc mọi lời gọi KB.cau("khoa", { a: …, b: … }) ra khỏi mã nguồn.
function cacLoiGoi(src) {
  const ra = [];
  const re = /KB\.(cau|cacCau)\(\s*"([A-Za-z0-9_]+)"/g;
  let m;
  while ((m = re.exec(src))) {
    const khoa = m[2];
    // đọc tiếp để lấy danh sách ô truyền vào (nếu có)
    let i = re.lastIndex, sau = 1, oList = null;
    while (i < src.length && sau > 0) {
      const c = src[i];
      if (c === "(") sau++;
      else if (c === ")") { sau--; if (!sau) break; }
      else if (c === "{" && oList === null) {
        // đọc các tên ô ở mức ngoài cùng của object literal
        oList = [];
        let j = i + 1, sauN = 1, chuoi = null;
        let dauMuc = j;
        while (j < src.length && sauN > 0) {
          const d = src[j];
          if (chuoi) { if (d === chuoi && src[j - 1] !== "\\") chuoi = null; }
          else if (d === '"' || d === "'" || d === "`") chuoi = d;
          else if (d === "{" || d === "(" || d === "[") sauN++;
          else if (d === "}" || d === ")" || d === "]") {
            sauN--;
            if (!sauN) { oList.push(src.slice(dauMuc, j)); break; }
          } else if (d === "," && sauN === 1) { oList.push(src.slice(dauMuc, j)); dauMuc = j + 1; }
          j++;
        }
        oList = oList.map(x => (x.split(":")[0] || "").trim()).filter(Boolean);
        i = j;
      }
      i++;
    }
    ra.push({ khoa, o: oList });
  }
  return ra;
}

const goi = [];
for (const t of TEP_MA) goi.push(...cacLoiGoi(fs.readFileSync(path.join(GOC, t), "utf8")).map(g => ({ ...g, tep: t })));

test("có gọi kho thật (đề phòng test tự huyễn hoặc)", () => {
  assert.ok(goi.length >= 15, `mới thấy ${goi.length} lời gọi KB — kiểm lại bộ bóc`);
});

test("MỌI khoá mã nguồn gọi đều có trong kho", () => {
  const thieu = goi.filter(g => !kho.cau[g.khoa]).map(g => `${g.tep}: ${g.khoa}`);
  assert.deepStrictEqual(thieu, [], "khoá không có trong kich_ban/mac_dinh.json -> bot sẽ câm câu đó");
});

test("MỌI ô {…} trong câu đều được nơi gọi truyền vào", () => {
  const loi = [];
  for (const g of goi) {
    const muc = kho.cau[g.khoa];
    if (!muc || !muc.bien || !muc.bien.length) continue;
    const truyen = new Set(g.o || []);
    for (const b of muc.bien) {
      if (!truyen.has(b)) loi.push(`${g.khoa}: câu cần ô {${b}} mà nơi gọi không truyền`);
    }
  }
  assert.deepStrictEqual(loi, []);
});

test("kho tự soi không có lỗi", () => {
  const kq = KB.kiemTra();
  assert.deepStrictEqual(kq.loi, []);
});

test("render giống HỆT ngữ nghĩa chuỗi mẫu của JS", () => {
  // Đây là điều kiện để rút mà không đổi hành vi. Biến rỗng / null phải cho ra
  // đúng cái mà `${x}` cho ra, không được coi là 'thiếu' rồi rơi về phom.
  const ten = "", gia = null, duoi = "nha chị";
  const goc = `Dạ ${ten}giá ${gia} ${duoi}`;
  assert.strictEqual(KB.render("Dạ {ten}giá {gia} {duoi}", { ten, gia, duoi }), goc.replace("null", ""));
  assert.strictEqual(KB.render("a {x} b", { x: "" }), "a  b");
  assert.strictEqual(KB.render("mở {{ đóng }}", {}), "mở { đóng }");
});

test("nơi gọi QUÊN truyền ô -> báo lỗi và rơi về phom, KHÔNG gửi khách chuỗi {…}", () => {
  const r = KB.render("Dạ giá {gia} ạ", {});
  assert.ok(r && r.loi, "phải báo lỗi chứ không render bừa");
  assert.strictEqual(KB.cau("khoa_khong_ton_tai", null, "PHOM"), "PHOM");
});

test("khoá lạ -> trả phom code, không nổ", () => {
  assert.strictEqual(KB.cau("khong_he_co_khoa_nay", {}, "PHOM"), "PHOM");
});

// Trước đây tra hụt mà KHÔNG có phom thì trả chuỗi rỗng. Chuỗi rỗng là thứ trôi
// lọt: nó ghép vào câu khác thành câu cụt rồi tới khách, không ai biết. Nay trả
// câu gắn MỐC HỤT để ba hàm gửi tin chặn được, kèm đúng tên khoá bị hụt.
test("tra hụt mà KHÔNG có phom -> gắn mốc hụt, không trả chuỗi rỗng", () => {
  const r = KB.cau("khong_he_co_khoa_nay");
  assert.notStrictEqual(r, "", "chuỗi rỗng trôi lọt xuống API mà không ai biết");
  assert.ok(r.includes(KB.MOC_HUT), "phải gắn mốc hụt");
  assert.ok(r.includes("khong_he_co_khoa_nay"), "mốc phải kèm tên khoá để còn truy");
});

test("chốt trước khi gửi: câu tốt cho qua, câu hụt và câu rỗng bị chặn", () => {
  assert.strictEqual(KB.vetTruocKhiGui("Dạ vâng chị ạ").ok, true);

  const rong = KB.vetTruocKhiGui("   ");
  assert.strictEqual(rong.ok, false);
  assert.strictEqual(rong.ma, "CAU_RONG");

  // Ca thật sự nguy: câu GHÉP từ nhiều khoá, chỉ hụt một mảnh. Phần còn lại vẫn
  // đọc được nên chuỗi-rỗng-kiểu-cũ sẽ trôi lọt; mốc thì soi ra.
  const ghep = "Dạ shop em ở " + KB.cau("dia_chi_khong_co") + " chị nha";
  const v = KB.vetTruocKhiGui(ghep);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.ma, "KICH_BAN_HUT");
  assert.deepStrictEqual(v.khoa, ["dia_chi_khong_co"], "phải chỉ ra ĐÚNG khoá hụt");
});

test("cacCau tra hụt cũng phải kêu, không trả mảng rỗng", () => {
  const ds = KB.cacCau("khoa_khong_he_co_bien_the");
  assert.ok(Array.isArray(ds) && ds.length > 0, "mảng rỗng làm nơi gọi im lặng bỏ lượt");
  assert.ok(ds[0].includes(KB.MOC_HUT));
});

test("mọi câu trong kho đều là chuỗi có chữ, không rỗng", () => {
  for (const [k, v] of Object.entries(kho.cau)) {
    const ds = Array.isArray(v.cau) ? v.cau : [v.cau];
    for (const c of ds) {
      assert.strictEqual(typeof c, "string", `khoá ${k} không phải chuỗi`);
      assert.ok(c.trim().length > 0, `khoá ${k} rỗng`);
    }
  }
});

test("mỗi câu đều có mô tả để người kinh doanh biết nó dùng lúc nào", () => {
  const thieu = Object.entries(kho.cau).filter(([, v]) => !v.mo_ta).map(([k]) => k);
  assert.deepStrictEqual(thieu, [], "thiếu mô tả -> trang quản trị sau này không hiển thị được gì");
});

test("shop KHÔNG đè được ngăn prompt (luật dạy AI)", () => {
  const tam = fs.mkdtempSync(path.join(os.tmpdir(), "kb-"));
  fs.writeFileSync(path.join(tam, "mac_dinh.json"), JSON.stringify({
    cau: { a: { cau: "gốc", bien: [] } },
    prompt: { luat: { cau: "LUẬT GỐC", bien: [] } }
  }));
  fs.writeFileSync(path.join(tam, "shopx.json"), JSON.stringify({
    cau: { a: { cau: "shop đè", bien: [] } },
    prompt: { luat: { cau: "SHOP TỰ SỬA LUẬT", bien: [] } }
  }));
  const cuDir = process.env.KICH_BAN_DIR, cuShop = process.env.SHOP_ID;
  process.env.KICH_BAN_DIR = tam; process.env.SHOP_ID = "shopx";
  delete require.cache[require.resolve("../loi/cau_noi/kho_kich_ban")];
  const KB2 = require("../loi/cau_noi/kho_kich_ban");
  try {
    assert.strictEqual(KB2.cau("a"), "shop đè", "shop PHẢI đè được câu nói với khách");
    assert.strictEqual(KB2.prompt("luat"), "LUẬT GỐC", "shop KHÔNG được đè luật dạy AI");
  } finally {
    if (cuDir === undefined) delete process.env.KICH_BAN_DIR; else process.env.KICH_BAN_DIR = cuDir;
    if (cuShop === undefined) delete process.env.SHOP_ID; else process.env.SHOP_ID = cuShop;
    delete require.cache[require.resolve("../loi/cau_noi/kho_kich_ban")];
  }
});

test("câu gõ tay trong Sheet dính tiền/sđt -> BỎ, dùng kịch bản gốc", () => {
  // Ranh giới "code lo số / kịch bản lo lời" phải áp cả cho lớp đè Sheet, không
  // riêng gì câu AI. Người kinh doanh gõ giá vào Sheet là tháng sau bot nói sai giá.
  const kl = require("../loi/ai/knowledge_loader");
  const goc = kl.luatMapDaCo;
  const thu = (vd) => {
    kl.luatMapDaCo = () => ({ hoi_size: { vd } });
    delete require.cache[require.resolve("../loi/cau_noi/kho_kich_ban")];
    const KB2 = require("../loi/cau_noi/kho_kich_ban");
    try { return KB2.cau("hoi_size"); }
    finally { kl.luatMapDaCo = goc; delete require.cache[require.resolve("../loi/cau_noi/kho_kich_ban")]; }
  };
  const gocCau = kho.cau.hoi_size.cau;
  assert.strictEqual(thu("Chị hay mặc size nào ạ"), "Chị hay mặc size nào ạ", "câu sạch phải được dùng");
  assert.strictEqual(thu("Mẫu này 990k chị nha, size nào ạ"), gocCau, "câu dính giá phải bị bỏ");
  assert.strictEqual(thu("Gọi em 0912345678 nha chị"), gocCau, "câu dính sđt phải bị bỏ");
});

// ============================================================================
// LƯỚI LÚC CHẠY THẬT — CI không có mặt lúc shop tự sửa kich_ban/<shop>.json
// ============================================================================

test("tệp kịch bản hỏng giữa chừng -> GIỮ bản tốt, KHÔNG hoá kho rỗng", () => {
  const tam = fs.mkdtempSync(path.join(os.tmpdir(), "kb-hong-"));
  const tep = path.join(tam, "mac_dinh.json");
  fs.writeFileSync(tep, JSON.stringify({ cau: { a: { cau: "câu gốc", bien: [] } } }));

  const cuDir = process.env.KICH_BAN_DIR;
  process.env.KICH_BAN_DIR = tam;
  delete require.cache[require.resolve("../loi/cau_noi/kho_kich_ban")];
  const KB2 = require("../loi/cau_noi/kho_kich_ban");
  try {
    assert.strictEqual(KB2.cau("a"), "câu gốc");

    // Shop sửa tệp và gõ thiếu một dấu phẩy. Đây là ca sẽ xảy ra thật.
    fs.writeFileSync(tep, '{ "cau": { "a": { "cau": "câu mới" } ');
    KB2.napLai();
    assert.strictEqual(KB2.cau("a"), "câu gốc",
      "tệp hỏng mà nạp đè bằng kho rỗng thì MỌI khoá hụt cùng lúc -> bot câm hàng loạt");

    // Sửa xong thì phải tự nhận bản mới, không cần khởi động lại.
    fs.writeFileSync(tep, JSON.stringify({ cau: { a: { cau: "câu đã sửa", bien: [] } } }));
    KB2.napLai();
    assert.strictEqual(KB2.cau("a"), "câu đã sửa");
  } finally {
    if (cuDir === undefined) delete process.env.KICH_BAN_DIR; else process.env.KICH_BAN_DIR = cuDir;
    delete require.cache[require.resolve("../loi/cau_noi/kho_kich_ban")];
  }
});

test("MỌI hàm gửi tin cho khách đều qua chốt vetTruocKhiGui", () => {
  const src = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");
  for (const ham of ["sendInboxMessage", "sendPrivateReply", "replyComment"]) {
    const i = src.indexOf(`async function ${ham}(`);
    assert.ok(i > 0, `không thấy hàm ${ham}`);
    const than = src.slice(i, i + 1200);
    assert.ok(/KB\.vetTruocKhiGui\(/.test(than),
      `${ham} chưa có chốt kịch bản -> câu hụt/rỗng vẫn tới được khách`);
  }
});

test("câu đã có khoá thì KHÔNG được còn bản sao viết cứng trong mã", () => {
  // Rút mà để sót bản sao thì kho không còn là nguồn duy nhất: shop sửa kho,
  // bot vẫn nói câu cũ ở những chỗ sót. Đã dính đúng ca này với "hoi_size".
  const nc = require("../loi/cau_noi/nguon_cau");
  const sot = [];
  for (const tep of TEP_MA) {
    const src = fs.readFileSync(path.join(GOC, tep), "utf8");
    const chuoi = nc.tachChuoi(src).map(c => c.noiDung);
    for (const [khoa, muc] of Object.entries(kho.cau)) {
      const ds = Array.isArray(muc.cau) ? muc.cau : [muc.cau];
      for (const cau of ds) {
        if (typeof cau !== "string") continue;
        if (/\{[a-zA-Z_]/.test(cau)) continue;        // câu có ô -> so nguyên văn không có nghĩa
        if (cau.trim().length < 25) continue;         // mảnh ngắn dễ đụng hàng
        if (chuoi.some(s => s.includes(cau))) sot.push(`${tep}: khoá "${khoa}"`);
      }
    }
  }
  assert.deepStrictEqual(sot, [], "còn bản sao viết cứng của câu đã rút:\n  " + sot.join("\n  "));
});
