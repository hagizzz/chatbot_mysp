// ============================================================================
// dieu_tiet.js — CHẠY SONG SONG CÓ KIỂM SOÁT + GIỮ NHỊP GỌI PANCAKE
// ----------------------------------------------------------------------------
// Mục 3.9 và mục 11: "một khách gửi ảnh không được làm chậm khách khác".
// Trước GĐ1 bot chạy tuần tự, tối đa 5 hội thoại mỗi nhịp 4 giây, nối đuôi nhau —
// một ca nhận diện ảnh mất 6 giây là cả hàng đợi đứng chờ.
//
// Ba thứ trong file này, cần đủ cả ba mới dám bật song song:
//
//   1. chayNhieu()  — chạy N việc cùng lúc, có trần. Một việc hỏng không kéo sập cả mẻ.
//   2. khoaTheoKhoa() — MỘT hội thoại chỉ được xử lý bởi MỘT luồng tại một thời điểm.
//      Thiếu cái này thì hai luồng cùng đọc/ghi bộ nhớ một khách -> mất dữ liệu,
//      hoặc bot trả lời khách hai lần.
//   3. Giữ nhịp theo TỪNG PAGE — Pancake bóp ~5 request/giây mỗi page. Chạy song song
//      mà không giữ nhịp là ăn 429 ngay. Cài bằng cách bọc fetch toàn cục: mọi lời gọi
//      pages.fm đều tự xếp hàng, không sót chỗ nào, kể cả chỗ chưa rà tới.
//      Gặp 429 -> page đó tự nghỉ (giãn dần), các page khác không bị vạ lây.
// ============================================================================

const SONG_SONG = Number(process.env.SONG_SONG || 6);            // số hội thoại chạy cùng lúc
const NHIP_MOI_GIAY = Number(process.env.PANCAKE_RPS || 4);      // request/giây cho mỗi page
const NHIP_BURST = Number(process.env.PANCAKE_BURST || 4);       // cho phép dồn tối đa
const NGHI_429_MS = Number(process.env.PANCAKE_NGHI_429_MS || 3000);

// ---------------------------------------------------------------------------
// 1. Khoá theo khoá — mỗi hội thoại một hàng đợi riêng
// ---------------------------------------------------------------------------
const _hangDoi = new Map();   // khoá -> Promise của việc cuối cùng đang xếp hàng

function khoaTheoKhoa(khoa, fn) {
  const k = String(khoa);
  const truoc = _hangDoi.get(k) || Promise.resolve();
  // Chạy nối tiếp: việc sau chờ việc trước xong (kể cả khi việc trước lỗi).
  const ketQua = truoc.then(fn, fn);
  // Dây xích chỉ dùng để xếp hàng nên nuốt lỗi, không để thành unhandled rejection.
  const xich = ketQua.then(() => {}, () => {});
  _hangDoi.set(k, xich);
  xich.then(() => { if (_hangDoi.get(k) === xich) _hangDoi.delete(k); });
  return ketQua;
}

function dangBanKhoa(khoa) {
  return _hangDoi.has(String(khoa));
}

// ---------------------------------------------------------------------------
// 2. Chạy nhiều việc cùng lúc, có trần
// ---------------------------------------------------------------------------
async function chayNhieu(danhSach, lam, { toiDa = SONG_SONG, dungSau = null } = {}) {
  const ds = Array.from(danhSach || []);
  const ra = new Array(ds.length);
  let i = 0, xong = 0;

  async function congNhan() {
    while (true) {
      if (dungSau && xong >= dungSau) return;
      const j = i++;
      if (j >= ds.length) return;
      try { ra[j] = await lam(ds[j], j); }
      catch (e) { ra[j] = { _loi: String((e && e.message) || e) }; }
      xong++;
    }
  }

  const n = Math.max(1, Math.min(toiDa, ds.length));
  await Promise.all(Array.from({ length: n }, congNhan));
  return ra;
}

// ---------------------------------------------------------------------------
// 3. Giữ nhịp gọi Pancake theo từng page (gáo token) + tự nghỉ khi dính 429
// ---------------------------------------------------------------------------
const _gao = new Map();   // pageId -> { token, capNhatLuc, nghiToi }

function _layGao(pageId) {
  let g = _gao.get(pageId);
  if (!g) { g = { token: NHIP_BURST, capNhatLuc: Date.now(), nghiToi: 0 }; _gao.set(pageId, g); }
  return g;
}

const _nghi = ms => new Promise(r => setTimeout(r, ms));

async function nhip(pageId) {
  const g = _layGao(String(pageId || "chung"));
  while (true) {
    const now = Date.now();
    if (g.nghiToi > now) { await _nghi(Math.min(g.nghiToi - now, 1000)); continue; }
    // Nạp lại token theo thời gian trôi qua.
    const troiQua = (now - g.capNhatLuc) / 1000;
    if (troiQua > 0) {
      g.token = Math.min(NHIP_BURST, g.token + troiQua * NHIP_MOI_GIAY);
      g.capNhatLuc = now;
    }
    if (g.token >= 1) { g.token -= 1; return; }
    await _nghi(Math.ceil((1 - g.token) / NHIP_MOI_GIAY * 1000));
  }
}

function baoBiBop(pageId) {
  const g = _layGao(String(pageId || "chung"));
  // Giãn dần: mỗi lần dính 429 liên tiếp thì nghỉ lâu hơn, tối đa 30 giây.
  g.lien = Math.min((g.lien || 0) + 1, 4);
  g.nghiToi = Date.now() + NGHI_429_MS * Math.pow(2, g.lien - 1);
  g.token = 0;
  return g.nghiToi - Date.now();
}

function baoOn(pageId) {
  const g = _layGao(String(pageId || "chung"));
  g.lien = 0;
}

// --- Bọc fetch toàn cục: mọi lời gọi pages.fm đều đi qua bộ giữ nhịp --------
// Làm ở MỘT chỗ nên không sót lời gọi nào, kể cả chỗ chưa rà tới. URL không phải
// pages.fm (OpenAI, Google, Facebook Graph...) đi thẳng, không bị ảnh hưởng.
const RE_PAGE = /pages\.fm\/api\/(?:public_api\/)?v\d+\/pages\/([^/?#]+)/i;
let _daBoc = false;

function bocFetch() {
  if (_daBoc || typeof globalThis.fetch !== "function") return;
  _daBoc = true;
  const goc = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async function (url, opts) {
    let pageId = null;
    try {
      const s = typeof url === "string" ? url : (url && url.url) || "";
      const m = RE_PAGE.exec(s);
      if (m) pageId = m[1];
    } catch (_) {}
    if (!pageId) return goc(url, opts);
    await nhip(pageId);
    const res = await goc(url, opts);
    try {
      if (res && res.status === 429) {
        const ms = baoBiBop(pageId);
        console.log(`[nhịp] Page ${pageId} bị Pancake bóp (429) -> nghỉ ${Math.round(ms / 1000)}s. Các page khác vẫn chạy.`);
      } else if (res && res.ok) {
        baoOn(pageId);
      }
    } catch (_) {}
    return res;
  };
}

function trangThai() {
  const ra = {};
  for (const [pid, g] of _gao) {
    ra[pid] = { token: +g.token.toFixed(2), dangNghiMs: Math.max(0, g.nghiToi - Date.now()), lan429LienTiep: g.lien || 0 };
  }
  return { songSong: SONG_SONG, nhipMoiGiay: NHIP_MOI_GIAY, page: ra, hoiThoaiDangKhoa: _hangDoi.size };
}

module.exports = {
  khoaTheoKhoa, dangBanKhoa, chayNhieu, nhip, baoBiBop, baoOn, bocFetch, trangThai,
  SONG_SONG, NHIP_MOI_GIAY
};
