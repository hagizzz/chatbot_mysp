#!/usr/bin/env node
// ============================================================================
// test/trich_ca_vang.js — TRÍCH CA VÀNG TỪ DỮ LIỆU CHẠY THẬT
// ----------------------------------------------------------------------------
// "Ca vàng" = một tin nhắn KHÁCH THẬT + nhãn/hành động mà bản bot ĐANG CHẠY đã
// quyết. Đây là mốc so sánh: sau này rút câu thoại ra cấu hình (GĐ2) hay đổi lõi,
// chạy lại bộ này phải ra y hệt — lệch chỗ nào là biết ngay chỗ đó vỡ.
//
// Hai nguồn có sẵn trên máy:
//   1. conversation_memory.json — _lastCustText + lastIntent + _aiIntent + mẫu đang khoá
//   2. log pm2 (log*.txt, botlog/, các file dump) — cặp "Khách:/Tin: text:" + hành động sau đó
//
//   node test/trich_ca_vang.js
// ============================================================================
const fs = require("fs");
const path = require("path");

const { che, cheConvId } = require("./che_du_lieu");

const GOC = path.join(__dirname, "..");
const RA = path.join(__dirname, "ca_vang");
fs.mkdirSync(RA, { recursive: true });

const ca = [];
const daThay = new Set();
const bangTra = {};   // ma bam -> conversationId that (chi luu tren may nay)

function them(c) {
  const khoa = (c.tinKhach || "").toLowerCase().trim();
  if (!khoa || khoa.length < 2 || daThay.has(khoa)) return;
  daThay.add(khoa);
  ca.push(c);
}

// ---- Nguồn 1: bộ nhớ hội thoại ---------------------------------------------
function tuBoNho() {
  const f = path.join(GOC, "conversation_memory.json");
  if (!fs.existsSync(f)) return 0;
  const d = JSON.parse(fs.readFileSync(f, "utf8"));
  let n = 0;
  for (const [cid, m] of Object.entries(d)) {
    if (!m || !m._lastCustText) continue;
    them({
      nguon: "bo_nho",
      conversationId: cheConvId(cid, bangTra),
      tinKhach: che(String(m._lastCustText)),
      mong: {
        nhanRegex: m.lastIntent || null,
        nhanAI: m._aiIntent || null,
        maSanPham: (m.currentProduct && (m.currentProduct.code || m.currentProduct.name)) || null,
        size: m.customerSize || null,
        canNang: m.customerWeightKg || m.weightKg || null,
        giaiDoan: m.stage || null
      },
      boiCanh: {
        daBaoGia: Array.isArray(m.pricedCodes) && m.pricedCodes.length > 0,
        daGuiAnh: Array.isArray(m.sentImageCodes) && m.sentImageCodes.length > 0,
        daChotDon: !!m.orderClosed,
        coSDT: !!m.phone,
        coDiaChi: !!m.address
      }
    });
    n++;
  }
  return n;
}

// ---- Nguồn 2: log pm2 -------------------------------------------------------
// Mỗi lượt in ra:  "Khách: <tên> | Conv: <id>"  rồi  "Tin: text: <nội dung>"
// rồi các dòng hành động (TAG AI-CHỜ XL / [Bảo Trâm] ... / VISION: ...).
const RE_KHACH = /Khách:\s*(.+?)\s*\|\s*Conv:\s*(\S+)/;
const RE_TIN = /Tin:\s*(text|image):\s*(.*)$/;

function tuLog() {
  const files = [
    ...fs.readdirSync(GOC).filter(f => /^log\d*\.txt$/.test(f)).map(f => path.join(GOC, f)),
    ...["ngockoy.txt", "ngockoy2.txt", "tl.txt", "ln.txt", "ln2.txt", "vid.txt", "pp.txt", "mona2.txt", "mona3.txt"]
      .map(f => path.join(GOC, f)).filter(fs.existsSync),
    ...(fs.existsSync(path.join(GOC, "botlog"))
      ? fs.readdirSync(path.join(GOC, "botlog")).map(f => path.join(GOC, "botlog", f)) : [])
  ];
  let n = 0;
  for (const f of files) {
    let dong;
    try { dong = fs.readFileSync(f, "utf8").split(/\r?\n/); } catch { continue; }
    for (let i = 0; i < dong.length; i++) {
      const mk = dong[i].match(RE_KHACH);
      if (!mk) continue;
      // Tin của khách nằm trong vài dòng kế tiếp.
      let tin = null, loai = null;
      for (let j = i + 1; j < Math.min(i + 4, dong.length); j++) {
        const mt = dong[j].match(RE_TIN);
        if (mt) { loai = mt[1]; tin = mt[2].trim(); break; }
      }
      if (!tin) continue;
      // Hành động bot làm sau đó (trong 12 dòng kế) — mốc so sánh về HÀNH VI.
      const sau = dong.slice(i + 1, i + 13).join("\n");
      them({
        nguon: "log:" + path.basename(f),
        conversationId: cheConvId(mk[2], bangTra),
        tinKhach: loai === "image" ? "" : che(tin),
        coAnh: loai === "image",
        mong: {
          nhuongNguoiThat: /TAG AI-CHỜ XL|NGƯỜI THẬT|người thật/.test(sau) || null,
          botDaGui: /\[gửi tin\]|Đã gửi|reply_inbox/.test(sau) || null
        },
        ghiChu: (sau.match(/\[[^\]]+\][^\n]{0,120}/g) || []).slice(0, 3)
      });
      n++;
    }
  }
  return n;
}

const n1 = tuBoNho();
const n2 = tuLog();

// Chia hai tệp: nhãn ý định (chạy được offline) và hành vi (cần bối cảnh đầy đủ).
const caNhan = ca.filter(c => c.mong && c.mong.nhanRegex);
const caHanhVi = ca.filter(c => !(c.mong && c.mong.nhanRegex));

fs.writeFileSync(path.join(RA, "nhan_y_dinh.json"), JSON.stringify(caNhan, null, 2), "utf8");
fs.writeFileSync(path.join(RA, "hanh_vi.json"), JSON.stringify(caHanhVi, null, 2), "utf8");

fs.writeFileSync(path.join(RA, "tra_cuu_conv.local.json"), JSON.stringify(bangTra, null, 2), "utf8");

console.log(`Bộ nhớ hội thoại : ${n1} lượt có tin khách`);
console.log(`Log pm2          : ${n2} lượt`);
console.log(`Sau khi bỏ trùng : ${ca.length} ca vàng`);
console.log(`  -> test/ca_vang/nhan_y_dinh.json : ${caNhan.length} ca (so nhãn, chạy offline)`);
console.log(`  -> test/ca_vang/hanh_vi.json     : ${caHanhVi.length} ca (so hành vi)`);
if (ca.length < 150) {
  console.log(`\n⚠ Mới có ${ca.length}/150 ca. Log trên máy này chỉ giữ 20.000 dòng cuối nên`);
  console.log(`  không đủ. Bổ sung bằng cách kéo hội thoại thật về từ Pancake:`);
  console.log(`      node test/thu_them_ca_vang.js 200`);
  console.log(`  (cần .env có PANCAKE_PAGE_ACCESS_TOKEN — chạy trên máy đang chạy bot thật)`);
}
