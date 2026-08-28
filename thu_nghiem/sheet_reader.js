const __goc = require("path").join(__dirname, "..");
// File test tiện ích: tra nhanh 1 mã trong Google Sheet (không được import bởi bot).
// Cột đã chỉnh theo phom 2026: N=màu(13), O=size(14), P=chất liệu(15).
const { google } = require("googleapis");
const path = require("path");

const SHEET_ID = "1Qdhp9YS0mePn7G3focqAhqV3Mb1eymFqbX0EC1bFCVs";

async function main() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__goc, "google-service-account.json"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  });

  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Mẫu 2026!A:Z"
  });

  const rows = response.data.values || [];
  console.log("Tổng dòng:", rows.length);

  const targetCode = "MRKVX6032";

  for (const row of rows) {
    const code = row[1]; // cột B
    if (code === targetCode) {
      console.log("===== TÌM THẤY =====");
      console.log({
        code: row[1],
        category: row[3],
        name: row[6],
        price: row[7],
        salePrice: row[10],
        stock: row[12],
        color: row[13],
        size: row[14],
        material: row[15]
      });
      break;
    }
  }
}

main();
