// urgent_sheet.js — Ghi "Đơn gấp" vào Google Sheet (cùng service account đang đọc SP).
// Tab "Đơn gấp", cột (MỚI - có COD):
//  A Mã ID | B page | C Mã sản phẩm | D Trạng thái đơn | E Thời gian khách đòi hàng
//  F Thời gian xử lý | G COD | H Kết quả
const { google } = require("googleapis");
const path = require("path");

const SHEET_ID = process.env.URGENT_SHEET_ID || "1Qdhp9YS0mePn7G3focqAhqV3Mb1eymFqbX0EC1bFCVs";
const TAB = process.env.URGENT_SHEET_TAB || "Đơn gấp";
const KEYFILE = path.join(__dirname, "google-service-account.json");

let _sheets = null;
async function sheetsApi() {
  if (_sheets) return _sheets;
  const auth = new google.auth.GoogleAuth({ keyFile: KEYFILE, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const client = await auth.getClient();
  _sheets = google.sheets({ version: "v4", auth: client });
  return _sheets;
}
function nowVN() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).replace("T", " ");
}
async function colA() {
  const s = await sheetsApi();
  const r = await s.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TAB}!A:A` });
  return (r.data.values || []).map(row => String(row[0] || ""));
}
async function rowOf(orderId) {
  const ids = await colA();
  const idx = ids.findIndex(x => x === String(orderId));
  return idx < 0 ? -1 : idx + 1;
}

// Ghi 1 đơn gấp (nếu chưa có). row = {orderId, page, productCode, status, reportTime?, cod?}
async function reportUrgent(row) {
  try {
    const ids = await colA();
    if (ids.includes(String(row.orderId))) return { ok: true, dup: true };
    const s = await sheetsApi();
    await s.spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range: `${TAB}!A:H`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[
        String(row.orderId), row.page || "", row.productCode || "", row.status || "",
        row.reportTime || nowVN(), "", (row.cod != null ? row.cod : ""), ""
      ]] },
    });
    return { ok: true };
  } catch (e) { console.log("[GẤP][sheet] reportUrgent lỗi:", e.message); return { ok: false, err: e.message }; }
}

// Điền "Thời gian xử lý" (cột F) theo Mã ID.
async function markProcessed(orderId, processTime) {
  try {
    const row = await rowOf(orderId);
    if (row < 0) return { ok: false, err: "không thấy đơn " + orderId };
    const s = await sheetsApi();
    await s.spreadsheets.values.update({
      spreadsheetId: SHEET_ID, range: `${TAB}!F${row}`,
      valueInputOption: "USER_ENTERED", requestBody: { values: [[processTime || nowVN()]] },
    });
    return { ok: true, row };
  } catch (e) { console.log("[GẤP][sheet] markProcessed lỗi:", e.message); return { ok: false, err: e.message }; }
}

// Điền COD (cột G) theo Mã ID.
async function markCod(orderId, cod) {
  try {
    const row = await rowOf(orderId);
    if (row < 0) return { ok: false, err: "không thấy đơn " + orderId };
    const s = await sheetsApi();
    await s.spreadsheets.values.update({
      spreadsheetId: SHEET_ID, range: `${TAB}!G${row}`,
      valueInputOption: "USER_ENTERED", requestBody: { values: [[(cod != null ? cod : "")]] },
    });
    return { ok: true, row };
  } catch (e) { console.log("[GẤP][sheet] markCod lỗi:", e.message); return { ok: false, err: e.message }; }
}

// Điền "Kết quả" (cột H) theo Mã ID: Đã chuyển hàng / Đã nhận / Hàng hoàn / Đã hủy.
async function markResult(orderId, resultText) {
  try {
    const row = await rowOf(orderId);
    if (row < 0) return { ok: false, err: "không thấy đơn " + orderId };
    const s = await sheetsApi();
    await s.spreadsheets.values.update({
      spreadsheetId: SHEET_ID, range: `${TAB}!H${row}`,
      valueInputOption: "USER_ENTERED", requestBody: { values: [[resultText || ""]] },
    });
    return { ok: true, row };
  } catch (e) { console.log("[GẤP][sheet] markResult lỗi:", e.message); return { ok: false, err: e.message }; }
}

// Đọc đơn trong sheet: [{orderId, hasProcessed(F), cod(G), result(H)}] — theo dõi độc lập state.
async function listOpenOrders() {
  const s = await sheetsApi();
  const r = await s.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TAB}!A:H` });
  const rows = r.data.values || [];
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const id = String((rows[i] && rows[i][0]) || "").trim();
    if (!/^\d+$/.test(id)) continue;
    out.push({
      orderId: id,
      hasProcessed: !!String((rows[i][5] || "")).trim(), // F
      cod: String((rows[i][6] || "")).trim(),            // G
      result: String((rows[i][7] || "")).trim(),         // H
    });
  }
  return out;
}

module.exports = { reportUrgent, markProcessed, markCod, markResult, listOpenOrders, nowVN };
