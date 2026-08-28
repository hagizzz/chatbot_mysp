const __goc = require("path").join(__dirname, "..", "..");
// Nạp "kiến thức" cho AI: kịch bản (Google Doc) + luật tình huống (tab AI AGENT).
// Có cache + dự phòng local để bot không bao giờ chạy với kịch bản rỗng.
const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");

const SA_KEY = path.join(__goc, "google-service-account.json");

// Kịch bản (Doc) + luật tình huống (tab AI AGENT trong Sheet). Shop khác BẮT BUỘC
// khai KICH_BAN_DOC_ID / LUAT_SHEET_ID trong .env — hai giá trị dưới là bản dự
// phòng của MYS.P, giữ cho bản cũ không khai gì vẫn chạy. Quên khai thì bot chạy
// bằng kịch bản của shop khác mà không báo lỗi, nên phải kêu.
const SHEET_ID_MAC_DINH = "1Qdhp9YS0mePn7G3focqAhqV3Mb1eymFqbX0EC1bFCVs";
const DOC_ID_MAC_DINH = "16CHNDP4D1S3LLODA-PqWaBLbjOApgvV8pkdHCc-Rt3g";
const SHEET_ID = String(process.env.LUAT_SHEET_ID || "").trim() || SHEET_ID_MAC_DINH;
const DOC_ID = String(process.env.KICH_BAN_DOC_ID || "").trim() || DOC_ID_MAC_DINH;
const AGENT_TAB = String(process.env.LUAT_SHEET_TAB || "AI AGENT").trim();
for (const [ten, dung] of [["KICH_BAN_DOC_ID", !!process.env.KICH_BAN_DOC_ID],
                           ["LUAT_SHEET_ID", !!process.env.LUAT_SHEET_ID]]) {
  if (!dung) { try { console.log(`[kiến-thức] ⚠ chưa khai ${ten} -> dùng nguồn mặc định của MYS.P.`); } catch (_) {} }
}
const REFRESH_MS = 5 * 60 * 1000; // làm mới mỗi 5 phút

let _script = { text: "", at: 0 };
let _rules = { list: [], at: 0 };

function auth(scopes) {
  return new google.auth.GoogleAuth({ keyFile: SA_KEY, scopes });
}

async function fetchDocText() {
  const client = await auth([
    "https://www.googleapis.com/auth/documents.readonly"
  ]).getClient();
  const docs = google.docs({ version: "v1", auth: client });
  const res = await docs.documents.get({ documentId: DOC_ID });

  const content = res.data.body?.content || [];
  let out = "";
  for (const el of content) {
    const para = el.paragraph;
    if (!para) continue;
    for (const e of para.elements || []) {
      const t = e.textRun?.content;
      if (t) out += t;
    }
  }
  return out.trim();
}

function localScript() {
  // Bản dự phòng khi mất mạng / chưa có khoá Google Doc.
  // Đường dẫn do duong_kich_ban.js quyết -> tự lấy bản RIÊNG của shop nếu có
  // (kich_ban/luat.<shopId>.txt), không thì bản gốc (kich_ban/luat.txt).
  return require("../cau_noi/duong_kich_ban").docLuat();
}

async function getScript() {
  const now = Date.now();
  if (_script.text && now - _script.at < REFRESH_MS) return _script.text;

  try {
    const text = await fetchDocText();
    if (text) {
      _script = { text, at: now };
      return text;
    }
  } catch (e) {
    console.log("[knowledge] Không đọc được Doc, dùng bản local:", e.message);
  }

  const local = localScript();
  _script = { text: local || _script.text, at: now };
  return _script.text;
}

async function fetchAgentRules() {
  const client = await auth([
    "https://www.googleapis.com/auth/spreadsheets.readonly"
  ]).getClient();
  const sheets = google.sheets({ version: "v4", auth: client });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${AGENT_TAB}!A:G`
  });

  const rows = res.data.values || [];
  const out = [];
  for (let i = 1; i < rows.length; i++) {     // bỏ dòng tiêu đề
    const r = rows[i] || [];
    const loai = String(r[0] || "").trim();
    const dieuKien = String(r[1] || "").trim();
    const phaiLam = String(r[2] || "").trim();
    const vd = String(r[3] || "").trim();
    const bat = String(r[5] || "").trim().toLowerCase();   // cột F

    if (!loai && !dieuKien) continue;
    // chỉ bỏ những dòng tắt rõ ràng; còn lại coi là Bật
    if (bat.includes("tắt") || bat.includes("tat") || bat === "off" || bat === "no" || bat === "0") {
      continue;
    }
    out.push({ loai, dieuKien, phaiLam, vd });
  }
  return out;
}

async function getAgentRules() {
  const now = Date.now();
  if (_rules.list.length && now - _rules.at < REFRESH_MS) return _rules.list;

  try {
    const list = await fetchAgentRules();
    _rules = { list, at: now };
    return list;
  } catch (e) {
    console.log("[knowledge] Không đọc được tab AI AGENT:", e.message);
    return _rules.list; // dùng cache cũ nếu có
  }
}

// Trả map { loại -> { dieuKien, phaiLam, vd } } CHỈ gồm dòng đang BẬT (cột F).
// Dùng để code lấy CÂU MẪU (cột D = vd) theo key, thay vì hardcode trong code.
// Dòng Tắt/không có -> không xuất hiện trong map (handler sẽ tự fallback).
function _dungMap(list) {
  const map = {};
  for (const r of (list || [])) {
    const key = String(r.loai || "").trim().toLowerCase();
    if (key) map[key] = r;
  }
  return map;
}

async function getAgentRuleMap() {
  return _dungMap(await getAgentRules());
}

// Bản ĐỒNG BỘ: chỉ đọc cache sẵn có, KHÔNG chờ mạng. Dùng cho nhánh cứng đang là
// hàm đồng bộ — đổi hết chúng thành async chỉ để lấy một câu chữ thì phải sửa
// hàng trăm điểm gọi, rủi ro lớn hơn lợi ích.
// Cache luôn ấm trong lúc chạy thật: reasoning_engine gọi getAgentRules() mỗi lượt,
// và bản thân cache tự làm mới mỗi 5 phút. Lượt đầu sau khi khởi động chưa có cache
// -> nhánh cứng dùng phom code, hoàn toàn không sao.
function luatMapDaCo() {
  return _rules.list.length ? _dungMap(_rules.list) : null;
}

module.exports = { getScript, getAgentRules, getAgentRuleMap, luatMapDaCo };
