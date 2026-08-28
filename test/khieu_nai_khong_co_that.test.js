// ============================================================================
// test/khieu_nai_khong_co_that.test.js — HAI CÂU CỦA SHOP GHÉP THÀNH MỘT KHIẾU NẠI
// ----------------------------------------------------------------------------
// Ca thật, hội thoại Hà Giang 25/08/2026. Khách nhắn "mẫu này có size không ạ"
// (hai lần), bot gắn 183 AI-CHỜ XL rồi im — không một câu nào trước đó, không cả
// AI-READ hay nhận ảnh, vì cổng HẬU MÃI chặn ngay đầu vòng xử.
//
// Bằng chứng mà cổng đó dựa vào là HAI TIN CỦA SHOP:
//     "Dạ em NHẬN ĐƯỢC ảnh của chị rồi ạ..."      -> _RE_RECEIVED  "khách đã nhận hàng"
//     "...lúc nãy nhé, em GỬI NHẦM ạ."             -> _RE_FITBAD    "shop gửi sai hàng"
// Ghép lại thành "khách nhận hàng rồi, shop gửi sai" — một khiếu nại chưa bao giờ
// tồn tại. Câu thứ hai còn là câu XIN LỖI về việc nhắn nhầm, không liên quan hàng hoá.
//
// Chỉ KHÁCH mới biết mình đã nhận hàng chưa và mặc có vừa không. Tin của shop/bot
// không bao giờ được dùng làm bằng chứng buộc tội chính shop.
//
// Trước đây hàm chỉ loại tin bot bằng botSentIds — mà đó là Set trong RAM, bot khởi
// động lại là quên sạch, nên mọi câu bot từng nói biến thành "tin người thật".
// ============================================================================
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const GOC = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(GOC, "bot_worker_api_v3.js"), "utf8");

function than(ten) {
  const i = SRC.indexOf("function " + ten + "(");
  assert.ok(i > 0, `không thấy ${ten}`);
  let sau = 0;
  for (let k = SRC.indexOf("{", i); k < SRC.length; k++) {
    if (SRC[k] === "{") sau++;
    else if (SRC[k] === "}" && --sau === 0) return SRC.slice(i, k + 1);
  }
  assert.fail("không đóng ngoặc " + ten);
}

// Dựng lại hàm thật, kéo theo hai hằng regex và các phụ thuộc.
function boDo() {
  // Khai báo trong mã căn cột nên có chỗ hai dấu cách trước "=" — bóc theo regex,
  // không so chuỗi cứng.
  const lay = (ten) => {
    const m = new RegExp("^\\s*const\\s+" + ten + "\\s*=.*$", "m").exec(SRC);
    assert.ok(m, `không thấy ${ten}`);
    return m[0];
  };
  const s = { botSentIds: new Set(), _psBangChung: null };
  new Function("s", "with (s) {" +
    lay("_RE_RECEIVED") + "\n" + lay("_RE_FITBAD") + "\n" + lay("_RE_VE_TIN") + "\n" +
    than("_laBangChungHang") + "\n" + than("postSaleFitComplaint") + "\n" +
    " s.f = postSaleFitComplaint; }")(s);
  return s.f;
}

const TIN = (sender, text, id) => ({ sender, type: "text", text, messageId: id });

test("hai câu của SHOP không được ghép thành khiếu nại", () => {
  const f = boDo();
  const hoiThoai = [
    TIN("shop", "Dạ em nhận được ảnh của chị rồi ạ. Để tránh sai sót khi giao, chị nhắn giúp em địa chỉ bằng tin nhắn chữ ạ.", "m1"),
    TIN("shop", "Dạ chị bỏ qua giúp em tin nhắn xin địa chỉ lúc nãy nhé, em gửi nhầm ạ.", "m2"),
    TIN("shop", "Dạ mẫu này chị cho em xin ít phút để em xác nhận lại thông tin với bên kho, xong em báo chị ngay ạ.", "m3"),
    TIN("customer", "mẫu này có size không ạ", "m4")
  ];
  assert.strictEqual(f(hoiThoai), false,
    "hai tin SHOP ghép thành khiếu nại -> khách hỏi size mà bị gắn 183 rồi im");
});

test("từng câu shop RIÊNG LẺ vẫn khớp regex — nên rào phải theo NGƯỜI NÓI", () => {
  // Ghi lại sự thật: bản thân hai regex không sai, chúng bắt đúng cụm.
  // Sai là ở chỗ trước đây không hỏi AI nói câu đó.
  const RECV = new RegExp(SRC.match(/const _RE_RECEIVED = \/(.+)\/i;/)[1], "i");
  const FIT  = new RegExp(SRC.match(/const _RE_FITBAD = \/(.+)\/i;/)[1], "i");
  assert.ok(RECV.test("Dạ em nhận được ảnh của chị rồi ạ"), "nếu không khớp thì test này vô nghĩa");
  assert.ok(FIT.test("lúc nãy nhé, em gửi nhầm ạ"), "'gửi nhầm' = shop gửi sai hàng");
});

test("KHÁCH thật sự khiếu nại thì VẪN phải bắt", () => {
  // Không được nới tay: đây đúng là ca phải nhường người thật.
  const f = boDo();
  assert.strictEqual(f([
    TIN("customer", "chị nhận hàng rồi em ơi", "c1"),
    TIN("customer", "mà mặc rộng quá không vừa", "c2")
  ]), true, "khách nhận hàng + kêu không vừa -> đúng là hậu mãi");
});

test("một mình khách nhận hàng, KHÔNG kêu gì -> không phải khiếu nại", () => {
  const f = boDo();
  assert.strictEqual(f([
    TIN("customer", "chị nhận được hàng rồi nhé", "c1"),
    TIN("customer", "đẹp lắm em ạ", "c2")
  ]), false, "nhận hàng xong khen đẹp mà bị nhường người thật thì hỏng");
});

test("KHÔNG được dựa vào botSentIds để loại tin bot", () => {
  // botSentIds là Set trong RAM (dòng ~79). Bot khởi động lại là quên sạch, mọi câu
  // bot từng nói thành "tin người thật". Rào phải là sender, không phải sổ nhớ.
  const k = than("postSaleFitComplaint");
  assert.match(k, /m\.sender !== "customer"/,
    "thiếu rào theo NGƯỜI NÓI -> qua một lần restart là lỗi quay lại y nguyên");
  // So theo LỆNH THẬT, không so theo chữ: chú thích ngay trên cũng nhắc "botSentIds",
  // tìm bằng chuỗi là bắt nhầm chính lời giải thích.
  const iSender = k.indexOf('m.sender !== "customer"');
  const iBook = k.indexOf("botSentIds.has(");
  assert.ok(iSender >= 0 && (iBook < 0 || iSender < iBook),
    "rào sender phải đứng TRƯỚC botSentIds, không thì vẫn phụ thuộc sổ RAM");
});

test("cổng HẬU MÃI in BẰNG CHỨNG khi gắn thẻ", () => {
  // Cổng này gắn thẻ rồi thoát ngay, không chạy AI-READ. Không in bằng chứng thì
  // đọc log chỉ thấy "gắn người thật", không biết vì sao một câu hỏi size lại bị nhường.
  const i = SRC.indexOf("HẬU MÃI/ĐƠN ĐÃ CÓ");
  assert.ok(i > 0, "không thấy cổng hậu mãi");
  const k = SRC.slice(Math.max(0, i - 2000), i + 300);
  assert.match(k, /bằng chứng:/, "thiếu bằng chứng trong log");
});
