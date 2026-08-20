// Nạp "kiến thức" cho AI: kịch bản (Google Doc) + luật tình huống (tab AI AGENT).
// Có cache + dự phòng local để bot không bao giờ chạy với kịch bản rỗng.
const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");

const SA_KEY = path.join(__dirname, "google-service-account.json");
const SHEET_ID = "1Qdhp9YS0mePn7G3focqAhqV3Mb1eymFqbX0EC1bFCVs";
const DOC_ID = "16CHNDP4D1S3LLODA-PqWaBLbjOApgvV8pkdHCc-Rt3g";
const AGENT_TAB = "AI AGENT";
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
  try {
    return fs.readFileSync(path.join(__dirname, "kich_ban.txt"), "utf8").trim();
  } catch {
    return "";
  }
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
async function getAgentRuleMap() {
  const list = await getAgentRules();
  const map = {};
  for (const r of (list || [])) {
    const key = String(r.loai || "").trim().toLowerCase();
    if (key) map[key] = r;
  }
  return map;
}

module.exports = { getScript, getAgentRules, getAgentRuleMap };
