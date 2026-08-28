// ============================================================================
// soi_kich_ban.js — BẮT MÂU THUẪN GIỮA KỊCH BẢN VÀ CODE
// ----------------------------------------------------------------------------
// Vì sao: kịch bản (Google Doc + tab AI AGENT) và câu viết cứng trong mã nguồn
// là HAI nguồn sự thật chạy song song, không ai đối chiếu. Hậu quả có thật, đo
// được ngay trên bản đang chạy:
//   · kịch bản ghi 'Không dùng từ "giữ"' — mà code có 3 chỗ nhắn khách
//     "em giữ sẵn tại showroom".
//   · kịch bản khai tên "Bảo Châu", code khai "Bảo Trâm".
// Người viết kịch bản không đọc mã nguồn, người sửa mã không mở kịch bản, nên
// những mâu thuẫn kiểu này sống rất lâu và chỉ lộ ra qua lời than của khách.
//
// File này soi tự động. Dùng lại đúng chỉ mục vân tay của nguon_cau.js — tức là
// soi TRÊN CHÍNH những câu code sẽ nhắn khách, không phải soi trên toàn bộ mã.
//
//   node soi_kich_ban.js            # soi kịch bản (Doc nếu có khoá, không thì bản local)
//   node soi_kich_ban.js --local    # ép dùng kich_ban/luat.txt, không gọi mạng
//
// Trả mã thoát 1 nếu có mâu thuẫn -> cắm được vào quy trình phát hành.
// ============================================================================
const fs = require("fs");
const path = require("path");
const nc = require("./nguon_cau");
const danhTinh = require("../ai/danh_tinh_bot");

// --- Đọc các luật KIỂM ĐƯỢC ra khỏi kịch bản ---------------------------------
// Kịch bản viết cho người đọc nên phần lớn là văn xuôi, không kiểm bằng máy được.
// Nhưng vài dòng có dạng rất chuẩn, và đó lại đúng là mấy dòng hay bị vi phạm.

// 'Không dùng từ "giữ"' / "Tuyệt đối không dùng từ 'bạn'" / "cấm dùng từ ..."
const RE_TU_CAM = /(?:không|khong|cấm|cam|tránh|tranh)\s+(?:được\s+|duoc\s+)?(?:dùng|dung|sử dụng|su dung)\s+(?:từ|tu|chữ|chu)\s*["“'']([^"”'']{1,30})["”'']/gi;

// 'Tên: Bảo Châu' / 'Tên bot: ...' — kịch bản KHÔNG được khai tên nữa.
const RE_KHAI_TEN = /^\s*t[êe]n(?:\s*bot)?\s*:\s*([^\n(–-]{2,40})/im;

function docLuat(kichBan) {
  const text = String(kichBan || "");
  const tuCam = [];
  let m;
  RE_TU_CAM.lastIndex = 0;
  while ((m = RE_TU_CAM.exec(text))) {
    const tu = m[1].trim();
    if (tu && !tuCam.includes(tu)) tuCam.push(tu);
  }
  const khaiTen = RE_KHAI_TEN.exec(text);
  return {
    tuCam,
    tenTrongKichBan: khaiTen ? khaiTen[1].trim() : null
  };
}

// --- Soi ---------------------------------------------------------------------
// cauCode: [{ van, viTri }] — chính là chỉ mục vân tay. Truyền vào được để test.
function soi(kichBan, cauCode, tenBot) {
  const luat = docLuat(kichBan);
  const ten = tenBot || danhTinh.TEN_BOT;
  const loi = [];

  // 1) Kịch bản còn khai tên -> hai nguồn sự thật cho cùng một thứ.
  if (luat.tenTrongKichBan) {
    const khac = nc.chuanHoa(luat.tenTrongKichBan) !== nc.chuanHoa(ten);
    loi.push({
      muc: khac ? "nang" : "nhe",
      loai: "khai-ten-hai-noi",
      viec: `Kịch bản khai tên "${luat.tenTrongKichBan}"` +
            (khac ? `, code khai "${ten}" — HAI TÊN KHÁC NHAU.` : ` trùng với code, nhưng vẫn là khai hai nơi.`),
      sua: `Bỏ dòng khai tên khỏi kịch bản. Tên chỉ nằm ở danh_tinh_bot.js (đổi qua biến môi trường TEN_BOT).`
    });
  }

  // 2) Từ kịch bản cấm mà câu viết cứng lại dùng.
  for (const tu of luat.tuCam) {
    const kim = nc.chuanHoa(tu);
    if (!kim) continue;
    const dinh = [];
    for (const c of cauCode) {
      if (c.khachThay === false) continue;      // log/prompt nội bộ, khách không đọc
      // so theo TỪ trọn vẹn, đừng để "giữ" ăn vào "giữa"
      if (new RegExp(`(^| )${kim}( |$)`).test(c.van)) dinh.push(c.viTri);
    }
    if (dinh.length) {
      loi.push({
        muc: "nang",
        loai: "vi-pham-tu-cam",
        viec: `Kịch bản cấm dùng từ "${tu}" nhưng có ${dinh.length} câu viết cứng đang dùng.`,
        sua: `Sửa câu ở: ${dinh.slice(0, 6).join(", ")}${dinh.length > 6 ? ` (và ${dinh.length - 6} chỗ nữa)` : ""}`,
        viTri: dinh
      });
    }
  }

  return { luat, loi };
}

module.exports = { soi, docLuat, RE_TU_CAM, RE_KHAI_TEN };

// --- Chạy trực tiếp ----------------------------------------------------------
if (require.main === module) {
  (async () => {
    const epLocal = process.argv.includes("--local");
    let kichBan = "";
    let tuDau = require("./duong_kich_ban").duongLuat() + " (bản local)";
    if (!epLocal) {
      try {
        require("../../env_boot");
        kichBan = await require("../ai/knowledge_loader").getScript();
        tuDau = "Google Doc (qua knowledge_loader)";
      } catch (e) {
        console.log(`[soi] Không đọc được Doc (${e.message}) -> dùng bản local.`);
      }
    }
    if (!kichBan) {
      kichBan = require("./duong_kich_ban").docLuat();
      if (!kichBan) { console.log("Không có kịch bản để soi."); process.exit(0); }
    }

    const cauKhachThay = nc.chiMuc().filter(m => m.khachThay !== false);
    const { luat, loi } = soi(kichBan, cauKhachThay);

    console.log("=".repeat(74));
    console.log(`SOI MÂU THUẪN KỊCH BẢN ↔ CODE — nguồn kịch bản: ${tuDau}`);
    console.log(`Luật máy kiểm được: ${luat.tuCam.length} từ cấm` +
                (luat.tenTrongKichBan ? `, 1 khai tên` : "") +
                ` | soi trên ${cauKhachThay.length} câu viết cứng khách có thể đọc`);
    console.log("=".repeat(74));

    if (!loi.length) {
      console.log("\n  Không thấy mâu thuẫn nào máy kiểm được.\n");
      process.exit(0);
    }
    for (const l of loi) {
      console.log(`\n  [${l.muc === "nang" ? "NẶNG" : "nhẹ "}] ${l.viec}`);
      console.log(`         -> ${l.sua}`);
    }
    const nang = loi.filter(l => l.muc === "nang").length;
    console.log(`\n  Tổng: ${loi.length} mâu thuẫn (${nang} nặng).\n`);
    process.exit(nang ? 1 : 0);
  })();
}
