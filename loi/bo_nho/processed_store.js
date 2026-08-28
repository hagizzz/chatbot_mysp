const __goc = require("path").join(__dirname, "..", "..");
const fs = require("fs");
const path = require("path");

const FILE = path.join(__goc, "processed_messages.json");
const MAX_IDS = 5000;          // chỉ giữ N id gần nhất -> file KHÔNG phình, ghi nhanh, hết đơ

let _saveTimer = null;
let _dirty = false;
let _lastSet = null;

function loadProcessed() {
  try {
    if (!fs.existsSync(FILE)) return new Set();
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const arr = Array.isArray(data) ? data : [];
    return new Set(arr.slice(-MAX_IDS));   // nạp tối đa N id gần nhất
  } catch {
    return new Set();
  }
}

function _flush() {
  _dirty = false;
  if (!_lastSet) return;
  try { fs.writeFile(FILE, JSON.stringify([...(_lastSet)].slice(-MAX_IDS)), "utf8", () => {}); } catch {}
}

// Ghi BẤT ĐỒNG BỘ + GỘP (debounce) tối đa mỗi 3s -> không block vòng lặp (trước đây ghi đồng bộ mỗi tin -> đơ).
function saveProcessed(set) {
  _lastSet = set;
  _dirty = true;
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => { _saveTimer = null; if (_dirty) _flush(); }, 3000);
}

function addProcessed(set, id) {
  set.add(id);
  if (set.size > MAX_IDS) {              // cắt bớt id cũ nhất khi vượt ngưỡng
    const arr = [...set];
    set.clear();
    for (const x of arr.slice(-MAX_IDS)) set.add(x);
  }
  saveProcessed(set);
}

// Ghi nốt khi thoát chương trình để không mất id vừa xử lý.
process.on("exit", () => {
  if (_dirty && _lastSet) {
    try { fs.writeFileSync(FILE, JSON.stringify([...(_lastSet)].slice(-MAX_IDS)), "utf8"); } catch {}
  }
});

module.exports = {
  loadProcessed,
  saveProcessed,
  addProcessed
};
