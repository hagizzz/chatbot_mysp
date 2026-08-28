// ============================================================================
// test/hoi_bao_gio_ship.test.js — "TẦM BAO GIỜ SHIP VỀ ĐẤY Ạ"
// ----------------------------------------------------------------------------
// Shop báo 26/08/2026 (ảnh chụp màn hình): khách vừa chốt đơn xong hỏi "tầm bao
// giờ ship về đấy ạ", bot đáp "Dạ vâng ạ, Đơn hàng của mình đang được tạo trên
// hệ thống" rồi gửi thêm MỘT BẢN XÁC NHẬN ĐƠN THỨ HAI + một tấm ảnh.
//
// Log page thật, đúng lượt đó:
//     Tin: text: tầm bao giờ ship về đấy ạ
//     [AI-READ]  nhãn=ORDER_STATUS  tin_cay=0.95            <- ĐÚNG
//     [AI-QUYẾT] hành_động=IM_NHUONG_NGUOI                  <- hợp lý
//     [AI-QUYẾT ưu tiên] LỖI: Cannot access '_ai' before initialization
//                        -> luật cũ cầm lái                 <- SẬP
//
// HAI lỗi chồng lên nhau:
//
// 1) VÙNG CHẾT TẠM THỜI (TDZ). _aiQuyetHanhDong là function declaration nên
//    hoisted, được gọi sớm ở đầu dispatch. Nhưng thân nó dùng _ai("URGENT")
//    trong nhánh IM_NHUONG_NGUOI, mà `const _ai` lại khai báo ~30 dòng SAU lời
//    gọi. Vào nhánh đó là ném lỗi, try nuốt, rừng luật cũ cầm lái và chạy lại
//    nhánh chốt đơn -> khách nhận bản xác nhận thứ hai.
//    => ĐƯỜNG IM_NHUONG_NGUOI CHƯA BAO GIỜ CHẠY ĐƯỢC. Mọi lần AI định nhường
//       cho người thật đều rơi vào catch. Không ai biết, vì chỉ lộ ở 1 dòng log.
//
// 2) Sửa xong (1) thì bot IM + gắn 183 — hết trả lời sai, nhưng vẫn KHÔNG trả
//    lời khách. Mà code ĐÃ CÓ handler tra đơn thật qua POS. Prompt AI-READ
//    (ai_intent.js dòng 177) cũng cố ý gắn ORDER_STATUS "để code tra đơn thật".
//    Nhãn đó chỉ thiếu tên trong danh sách AI-QUYẾT đứng-nhìn.
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

const dongCua = (chuoi, tuVitri = 0) => SRC.slice(0, SRC.indexOf(chuoi, tuVitri)).split("\n").length;

// --- 1. TDZ: khai báo phải đứng TRƯỚC lời gọi -------------------------------
test("const _ai khai báo TRƯỚC khi gọi _aiQuyetHanhDong()", () => {
  const iKhai = SRC.indexOf("const _ai = (k) => mem._aiIntent === k;");
  const iGoi  = SRC.indexOf("if (await _aiQuyetHanhDong())");
  assert.ok(iKhai > 0, "không thấy khai báo _ai");
  assert.ok(iGoi > 0, "không thấy lời gọi _aiQuyetHanhDong");
  assert.ok(iKhai < iGoi,
    `_ai khai báo ở dòng ${dongCua("const _ai = (k) => mem._aiIntent === k;")} nhưng bị gọi từ dòng ` +
    `${dongCua("if (await _aiQuyetHanhDong())")} -> TDZ: "Cannot access '_ai' before initialization". ` +
    "Nhánh IM_NHUONG_NGUOI sập, luật cũ cầm lái, khách nhận tin thừa.");
});

test("chỉ có ĐÚNG MỘT khai báo _ai (hai cái là che nhau, TDZ quay lại)", () => {
  const n = (SRC.match(/const _ai = \(k\) =>/g) || []).length;
  assert.strictEqual(n, 1, `có ${n} khai báo _ai`);
});

test("_aiQuyetHanhDong vẫn THỰC SỰ dùng _ai — nếu không thì test trên vô nghĩa", () => {
  const i = SRC.indexOf("async function _aiQuyetHanhDong()");
  assert.ok(i > 0);
  let sau = 0, het = i;
  for (let k = SRC.indexOf("{", i); k < SRC.length; k++) {
    if (SRC[k] === "{") sau++;
    else if (SRC[k] === "}" && --sau === 0) { het = k; break; }
  }
  assert.match(SRC.slice(i, het), /_ai\("URGENT"\)/,
    "đây là chỗ đã ném lỗi; bỏ nó đi thì cập nhật lại test này");
});

// --- 2. Quét cả LỚP lỗi, không chỉ một chỗ ----------------------------------
test("không biến const/let nào khác bị _aiQuyetHanhDong dùng trước khi khai báo", () => {
  // Một chỗ sửa xong không có nghĩa là hết. Hàm này bị gọi cách chỗ định nghĩa
  // ~850 dòng; mọi const khai báo trong khoảng đó đều là bẫy TDZ tiềm tàng.
  const iGoi = SRC.indexOf("if (await _aiQuyetHanhDong())");
  const iHam = SRC.indexOf("async function _aiQuyetHanhDong()");
  assert.ok(iGoi > 0 && iHam > iGoi);

  let sau = 0, het = iHam;
  for (let k = SRC.indexOf("{", iHam); k < SRC.length; k++) {
    if (SRC[k] === "{") sau++;
    else if (SRC[k] === "}" && --sau === 0) { het = k; break; }
  }
  const than = SRC.slice(iHam, het);

  const dong = SRC.split("\n");
  const dGoi = SRC.slice(0, iGoi).split("\n").length;
  const dHam = SRC.slice(0, iHam).split("\n").length;

  // CHỈ xét khai báo ở ĐÚNG tầng thân hàm dispatch (thụt 4 dấu cách). Khai báo
  // sâu hơn nằm trong khối con — tầm vực khác, không thể là bẫy TDZ cho hàm này.
  // Lỏng tay ở đây là báo bừa: lần đầu chạy nó tố `const n` ở dòng 8693, vốn
  // nằm gọn trong một khối if và chỉ trùng chữ cái "n" trong thân hàm.
  const nghi = [];
  for (let n = dGoi; n < dHam; n++) {
    const m = /^ {4}(const|let)\s+([A-Za-z_$][\w$]*)\s*=/.exec(dong[n - 1] || "");
    if (!m) continue;
    const ten = m[2].replace(/\$/g, "\\$");
    if (new RegExp("[^\\w$.]" + ten + "\\s*[(\\[.,)\\]}=;]").test(than)) nghi.push(`dòng ${n}: ${m[1]} ${m[2]}`);
  }
  assert.deepStrictEqual(nghi, [],
    "biến khai báo SAU lời gọi mà thân hàm có dùng -> TDZ, sập lặng lẽ trong khối try:\n  " + nghi.join("\n  "));
});

// --- 3. Nhường lượt cho handler tra đơn thật --------------------------------
test("ORDER_STATUS nằm trong danh sách AI-QUYẾT ĐỨNG NHÌN", () => {
  const i = SRC.indexOf("const _cqAskKinds = [");
  assert.ok(i > 0, "không thấy danh sách đứng nhìn");
  const ds = SRC.slice(i, SRC.indexOf("];", i));
  assert.match(ds, /"ORDER_STATUS"/,
    "thiếu -> AI-QUYẾT cướp lượt, phát IM_NHUONG_NGUOI, handler tra đơn không bao giờ chạy");
});

test("handler tra đơn thật vẫn còn và vẫn tra POS", () => {
  // Đưa ORDER_STATUS vào danh sách đứng-nhìn chỉ đúng khi CÓ handler nhận lượt.
  const i = SRC.indexOf('if (asksOrderStatus(latestText) || _ai("ORDER_STATUS")) {');
  assert.ok(i > 0, "mất handler ORDER_STATUS -> nhường lượt cho hư không, bot im hoàn toàn");
  // Nới 1400 -> 2200 ngày 26/08/2026: handoff() nay PHẢI nhắn khách một câu trước
  // khi gắn thẻ (trước đó gắn thẻ rồi im), nên thân hàm dài thêm. Điều test canh
  // vẫn y nguyên: handler còn tra POS thật, còn nhánh POS-chưa-cấu-hình, còn xin sđt.
  const k = SRC.slice(i, i + 2200);
  assert.match(k, /getOrdersByPhone\(phone\)/, "handler phải tra đơn THẬT");
  assert.match(k, /if \(!posConfigured\(\)\)/, "POS chưa cấu hình -> phải nhường người thật, không im suông");
  assert.match(k, /chị cho em xin số điện thoại đặt hàng/, "thiếu sđt -> phải xin, không im");
});

test("KHÔNG đụng nhầm nhóm hậu mãi — đổi/hoàn vẫn là việc người thật", () => {
  const i = SRC.indexOf("const _cqAfterSale = [");
  const ds = SRC.slice(i, SRC.indexOf("]", i));
  for (const n of ["EXCHANGE_REQUEST", "REFUND_REQUEST", "CANCEL_ORDER"]) {
    assert.ok(ds.includes(`"${n}"`), `${n} phải còn trong nhóm hậu mãi`);
  }
  assert.ok(!ds.includes('"ORDER_STATUS"'),
    "ORDER_STATUS là TRA đơn, không phải đổi/hoàn — xếp vào hậu mãi là lại khoá cứng về IM_NHUONG_NGUOI");
});

// --- 4. Ghi lại chốt của prompt để không sửa ngược nhau ---------------------
test("prompt AI-READ vẫn chốt: hậu-đơn hỏi thời gian nhận -> ORDER_STATUS", () => {
  const P = fs.readFileSync(path.join(GOC, "loi/ai/ai_intent.js"), "utf8");
  assert.match(P, /ĐÃ CHỐT ĐƠN[\s\S]{0,400}ORDER_STATUS/,
    "nếu prompt đổi sang DELIVERY_QA thì luồng khác hẳn — xem lại test này cùng lúc");
});
