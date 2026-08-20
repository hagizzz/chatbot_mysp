// quashop_sheet.js — Ghi "QUA SHOP" vào Google Sheet (cùng service account đang đọc SP).
// Tab "QUA SHOP", cột: A Ngày tháng | B Mã ID | C page | D Mã sản phẩm | E KHO | F COD | G Tiền trả trước | H Trạng thái đơn
// Dedup theo cột B (Mã ID = mã đơn POS).
const { google } = require("googleapis");
const path = require("path");

const SHEET_ID = process.env.QUASHOP_SHEET_ID || "1Qdhp9YS0mePn7G3focqAhqV3Mb1eymFqbX0EC1bFCVs";
const TAB = process.env.QUASHOP_SHEET_TAB || "QUA SHOP";
const KEYFILE = path.join(__dirname, "google-service-account.json");

let _sheets = null;
async function sheetsApi() {
  if (_sheets) return _sheets;
  const auth = new google.auth.GoogleAuth({
    keyFile: KEYFILE,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const client = await auth.getClient();
  _sheets = google.sheets({ version: "v4", auth: client });
  return _sheets;
}
function nowVN() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).replace("T", " ");
}
// Cột B (Mã ID) đã có -> để dedup.
async function colB() {
  const s = await sheetsApi();
  const r = await s.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TAB}!B:B` });
  return (r.data.values || []).map(row => String(row[0] || ""));
}

// Ghi 1 đơn "qua shop" (nếu Mã ID chưa có). row = {orderId, date, page, productCode, warehouse, cod, prepaid, status}
async function writeQuaShop(row) {
  try {
    const ids = await colB();
    if (ids.includes(String(row.orderId))) return { ok: true, dup: true };
    const s = await sheetsApi();
    await s.spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range: `${TAB}!A:H`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[
        row.date || nowVN(), String(row.orderId), row.page || "", row.productCode || "",
        row.warehouse || "", (row.cod != null ? row.cod : ""), (row.prepaid != null ? row.prepaid : ""),
        row.status || ""
      ]] },
    });
    return { ok: true };
  } catch (e) { console.log("[QUASHOP][sheet] writeQuaShop lỗi:", e.message); return { ok: false, err: e.message }; }
}

module.exports = { writeQuaShop, nowVN };
