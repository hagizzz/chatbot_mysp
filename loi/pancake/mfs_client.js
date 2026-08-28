// ============================================================================
// mfs_client.js — LỚP NỐI HTTP SANG HỆ THỐNG mfs
// ----------------------------------------------------------------------------
// mfs thay Pancake ở phần HỘI THOẠI: đọc tin, gửi tin, gắn thẻ. Phần ĐƠN HÀNG
// vẫn là Pancake POS (mfs cũng đẩy sang POS), nên `pos_client.js` giữ nguyên.
//
// Chỉ file này biết chuyện đăng nhập và token. `mfs_reader.js` / `mfs_sender.js`
// gọi qua đây, không đụng tới xác thực.
//
//   MFS_API_URL=http://localhost:3000/v1
//   MFS_EMAIL=bot@shopmau.vn
//   MFS_PASSWORD=...
//
// Token truy cập sống 15 phút và mfs KHÔNG cấp token dài hạn cho máy — nó xoay
// vòng refresh token qua cookie HttpOnly, thứ sinh ra cho trình duyệt chứ không
// cho tiến trình nền. Nên ở đây đăng nhập lại trước khi hết hạn: rẻ (một lời
// gọi mỗi ~14 phút) và không phải giữ cookie jar.
// ============================================================================

const URL_GOC = String(process.env.MFS_API_URL || "http://localhost:3000/v1").replace(/\/+$/, "");
const EMAIL = process.env.MFS_EMAIL || "";
const MAT_KHAU = process.env.MFS_PASSWORD || "";

// Đăng nhập lại sớm hơn hạn chừng này. Token sống 15 phút; 90 giây đệm đủ để
// một lượt xử lý đang chạy không bị hết hạn giữa chừng.
const DEM_HET_HAN_MS = 90 * 1000;

let _token = null;
let _hetHanMs = 0;
let _dangDangNhap = null;

function daCauHinh() {
  return Boolean(EMAIL && MAT_KHAU);
}

async function _dangNhap() {
  if (!daCauHinh()) {
    throw new Error("CHUA_CAU_HINH_MFS: thiếu MFS_EMAIL / MFS_PASSWORD trong .env");
  }
  const res = await fetch(`${URL_GOC}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: MAT_KHAU })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.accessToken) {
    const ly = (data && data.error && data.error.message) || `HTTP ${res.status}`;
    throw new Error(`MFS_DANG_NHAP_HONG: ${ly}`);
  }
  _token = data.accessToken;
  _hetHanMs = data.expiresAt ? new Date(data.expiresAt).getTime() : Date.now() + 15 * 60 * 1000;
  console.log(`[mfs] đăng nhập ${EMAIL} — token tới ${new Date(_hetHanMs).toLocaleTimeString("vi-VN")}`);
  return _token;
}

/** Lấy token còn hạn. Nhiều lời gọi song song chỉ đẻ ĐÚNG một lần đăng nhập. */
async function layToken(epMoi = false) {
  if (!epMoi && _token && Date.now() < _hetHanMs - DEM_HET_HAN_MS) return _token;
  if (!_dangDangNhap) {
    _dangDangNhap = _dangNhap().finally(() => { _dangDangNhap = null; });
  }
  return _dangDangNhap;
}

/**
 * Gọi một đường dẫn của mfs.
 *
 * Gặp 401 thì đăng nhập lại rồi thử LẠI ĐÚNG MỘT LẦN — token hết hạn sớm hơn
 * dự tính (người khác thu hồi phiên, đổi mật khẩu) là chuyện có thật, mà thử
 * lại vô hạn thì một tài khoản bị khoá sẽ thành vòng lặp gọi mạng.
 */
async function goi(duong, { method = "GET", body = null, headers = {}, raw = false } = {}) {
  const chay = async (token) => {
    const h = { Authorization: `Bearer ${token}`, ...headers };
    let than = body;
    if (body && !(body instanceof FormData) && typeof body === "object") {
      h["Content-Type"] = "application/json";
      than = JSON.stringify(body);
    }
    return fetch(URL_GOC + duong, { method, headers: h, body: than });
  };

  let res = await chay(await layToken());
  if (res.status === 401) {
    res = await chay(await layToken(true));
  }

  if (raw) return res;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const ly = (data && data.error && data.error.message) || `HTTP ${res.status}`;
    const e = new Error(`mfs ${method} ${duong}: ${ly}`);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

/** Gọi mà KHÔNG ném lỗi — dùng cho việc phụ (gắn thẻ, đánh dấu chưa đọc). */
async function goiNhe(duong, opt = {}) {
  try {
    return { success: true, data: await goi(duong, opt) };
  } catch (e) {
    console.log(`[mfs] ${e.message}`);
    return { success: false, error: e.message, status: e.status };
  }
}

// ===== THẺ: mfs dùng UUID theo từng shop, không dùng số như Pancake ==========
// Bot gọi theo VAI TRÒ của thẻ ("chờ người thật", "AI chốt"), tên thẻ khai trong
// .env, còn UUID thì tra một lần rồi nhớ. Thiếu thẻ thì tạo luôn — bắt người
// dùng vào giao diện tạo tay trước khi bot chạy được là một bước thừa, và tên
// thẻ đã nằm trong .env rồi.
const TEN_THE = {
  cho_nguoi_that: process.env.MFS_THE_CHO_NGUOI_THAT || "Chờ người thật",
  ai_chot: process.env.MFS_THE_AI_CHOT || "Đã chốt đơn",
  xu_ly_anh: process.env.MFS_THE_XU_LY_ANH || "Ảnh chưa nhận ra",
  don_uu_tien: process.env.MFS_THE_DON_UU_TIEN || "Đơn ưu tiên",
  gui_don_gap: process.env.MFS_THE_GUI_DON_GAP || "Gửi gấp"
};
const MAU_THE = {
  cho_nguoi_that: "#B32D22",
  ai_chot: "#1F8A4C",
  xu_ly_anh: "#C2650B",
  don_uu_tien: "#6B3FA0",
  gui_don_gap: "#B32D22"
};

let _theTheoTen = null;      // tên (thường hoá) -> uuid
let _dangNapThe = null;

async function _napThe() {
  const ds = await goi("/tags?scope=conversation");
  const m = new Map();
  for (const t of Array.isArray(ds) ? ds : []) {
    m.set(String(t.name || "").trim().toLowerCase(), t.id);
  }
  _theTheoTen = m;
  return m;
}

async function _bangThe(epNap = false) {
  if (!epNap && _theTheoTen) return _theTheoTen;
  if (!_dangNapThe) {
    _dangNapThe = _napThe().finally(() => { _dangNapThe = null; });
  }
  return _dangNapThe;
}

/** Đổi vai trò thẻ -> uuid. Chưa có thẻ thì tạo. Hỏng thì trả null. */
async function idThe(vaiTro) {
  const ten = TEN_THE[vaiTro];
  if (!ten) return null;
  const khoa = ten.trim().toLowerCase();

  let bang = await _bangThe();
  if (bang.has(khoa)) return bang.get(khoa);

  // Nạp lại một lần: thẻ có thể vừa được tạo ở giao diện sau khi bot khởi động
  bang = await _bangThe(true);
  if (bang.has(khoa)) return bang.get(khoa);

  const r = await goiNhe("/tags", {
    method: "POST",
    body: { scope: "conversation", name: ten, color: MAU_THE[vaiTro] || "#888888" }
  });
  if (!r.success) return null;
  const id = r.data && (r.data.id || (Array.isArray(r.data) && r.data[0] && r.data[0].id));
  if (id) {
    _theTheoTen.set(khoa, id);
    console.log(`[mfs] tạo thẻ "${ten}" (${vaiTro}) -> ${id}`);
  }
  return id || null;
}

/**
 * Kiểm CẢ NĂM thẻ ngay lúc khởi động, báo to nếu thiếu.
 *
 * Vì sao phải có: tài khoản bot mang vai trò Nhân viên, mà tạo thẻ đòi quyền
 * `settings.tags` của quản trị -> `idThe()` sẽ trả null. Lúc đó bot vẫn chạy,
 * vẫn trả lời khách, nhưng KHÔNG gắn được thẻ "chờ người thật" — nghĩa là ca
 * cần người thật vào cứu sẽ nằm im không ai biết. Đó là hỏng ở chỗ nguy hiểm
 * nhất, nên phải kêu ngay từ đầu chứ không để lộ ra sau vài giờ.
 */
async function kiemTraThe() {
  const thieu = [];
  for (const vaiTro of Object.keys(TEN_THE)) {
    const id = await idThe(vaiTro);
    if (!id) thieu.push(`${vaiTro} ("${TEN_THE[vaiTro]}")`);
  }
  if (thieu.length) {
    console.log("=".repeat(70));
    console.log("CẢNH BÁO: thiếu thẻ trong mfs, bot sẽ KHÔNG gắn được các thẻ sau:");
    for (const t of thieu) console.log("   - " + t);
    console.log("Hậu quả: ca cần người thật xử lý sẽ không nổi lên cho nhân viên.");
    console.log("Cách sửa: vào mfs > Cài đặt > Thẻ, tạo đúng các tên trên;");
    console.log("hoặc cấp quyền settings.tags cho tài khoản bot để nó tự tạo.");
    console.log("=".repeat(70));
  }
  return { du: thieu.length === 0, thieu };
}

module.exports = {
  goi, goiNhe, layToken, daCauHinh, idThe, TEN_THE, kiemTraThe,
  URL_GOC,
  // để thử: xoá bộ nhớ đệm thẻ
  _quenThe: () => { _theTheoTen = null; }
};
