const __goc = require("path").join(__dirname, "..", "..");
// Cầu nối sang worker nhận diện ảnh CLIP (thường trú). Gọn & ổn định:
// - Worker GIỮ SỐNG (chỉ dựng lại khi nó thực sự thoát).
// - Đánh ID cho mỗi yêu cầu -> phản hồi trễ tự bỏ qua, không lệch hàng đợi.
// - Chờ "sẵn sàng" dùng race riêng, KHÔNG làm hỏng readyPromise -> không respawn loop.
const { spawn } = require("child_process");
const { findProductByCode } = require("./product_lookup");
const { getColorByImageId } = require("./product_images");
const { splitColors, colorMatches, extractColor } = require("./color_utils");

let proc = null;
let readyPromise = null;
let readyResolve = null;
let readyReject = null;
let lineBuffer = "";
let workerReady = false;
let reqSeq = 0;
const pending = new Map();        // id -> finish
let chain = Promise.resolve();

const MATCH_TIMEOUT_MS = 35000;   // mỗi ảnh tối đa 35s
const READY_RACE_MS = 60000;      // chờ worker nạp model tối đa 60s (cho 1 yêu cầu)

function handleLine(line) {
  line = line.trim();
  if (!line) return;
  let obj;
  try { obj = JSON.parse(line); } catch { return; }

  if (Object.prototype.hasOwnProperty.call(obj, "ready")) {
    if (obj.ready) {
      workerReady = true;
      console.log("[vision] worker sẵn sàng, số mẫu:", obj.count);
      if (readyResolve) readyResolve(obj);
    } else {
      console.log("[vision] worker lỗi nạp:", obj.error);
      if (readyReject) readyReject(new Error(obj.error || "worker not ready"));
    }
    return;
  }

  const id = obj.id;
  if (id != null && pending.has(id)) {
    const finish = pending.get(id);
    pending.delete(id);
    finish(obj);
  }
}

function ensureWorker() {
  if (proc) return;

  readyPromise = new Promise((res, rej) => { readyResolve = res; readyReject = rej; });
  // Worker ảnh chết trước khi có ai chờ (thiếu numpy/open_clip, python hỏng...) thì
  // readyPromise bị từ chối mà không ai bắt -> Node giết luôn CẢ TIẾN TRÌNH BOT.
  // Gắn sẵn chỗ bắt rỗng: callWorker vẫn nhận lỗi qua Promise.race bên dưới,
  // còn bot thì chỉ mất khả năng nhận diện ảnh chứ không chết theo.
  readyPromise.catch(() => {});

  // PYTHON_BIN: máy nào dùng "py", hoặc python trong venv, thì khai lại trong .env.
  const PYTHON_BIN = String(process.env.PYTHON_BIN || "python").trim() || "python";
  // [DỌN 27/08/2026] Script Python chuyển vào python/. cwd vẫn là GỐC để mấy tệp
  // chỉ mục (clip_index.npz, hash_index.json) nằm cạnh gốc vẫn tra được như cũ.
  proc = spawn(PYTHON_BIN, ["python/embedding_worker.py"], { cwd: __goc });

  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", chunk => {
    lineBuffer += chunk;
    let idx;
    while ((idx = lineBuffer.indexOf("\n")) >= 0) {
      const line = lineBuffer.slice(0, idx);
      lineBuffer = lineBuffer.slice(idx + 1);
      handleLine(line);
    }
  });

  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", d => process.stdout.write("[vision] " + d));

  // Một chỗ dọn dẹp duy nhất cho MỌI kiểu chết của worker.
  // Trước đây "error" (không có python trên máy) chỉ ghi log mà không từ chối
  // readyPromise -> mỗi ảnh treo đủ READY_RACE_MS = 60 giây rồi mới chịu thua.
  let daHaGuc = false;
  const haGuc = (lyDo) => {
    if (daHaGuc) return;
    daHaGuc = true;
    proc = null;
    workerReady = false;
    if (readyReject) readyReject(new Error(lyDo));
    for (const [, finish] of pending) {
      try { finish({ ok: false, reason: "WORKER_DOWN" }); } catch (_) {}
    }
    pending.clear();
  };

  proc.on("exit", code => {
    console.log("[vision] worker thoát, code:", code);
    haGuc("worker exited");
  });

  proc.on("error", err => {
    console.log(`[vision] không mở được worker ảnh: ${err.message}. Bot chạy tiếp, tạm thời KHÔNG nhận diện được ảnh.`);
    haGuc("worker spawn failed: " + err.message);
  });
}

function callWorker(payload, timeoutMs) {
  const run = async () => {
    ensureWorker();
    if (!workerReady) console.log("[vision] dang cho worker nap model, vui long doi...");
    try {
      await Promise.race([
        readyPromise,
        new Promise((_, rej) => setTimeout(() => rej(new Error("READY_TIMEOUT")), READY_RACE_MS))
      ]);
    } catch (e) {
      return { ok: false, reason: "WORKER_NOT_READY", error: String((e && e.message) || e) };
    }

    const id = ++reqSeq;
    return await new Promise(resolve => {
      let done = false;
      const finish = v => { if (!done) { done = true; pending.delete(id); resolve(v); } };
      pending.set(id, finish);
      try {
        proc.stdin.write(JSON.stringify(Object.assign({ id }, payload)) + "\n");
      } catch (e) {
        pending.delete(id);
        return finish({ ok: false, reason: "WRITE_FAIL" });
      }
      setTimeout(() => {
        if (done) return;
        finish({ ok: false, reason: "TIMEOUT" });
      }, timeoutMs);
    });
  };

  const p = chain.then(run, run);
  chain = p.then(() => {}, () => {});
  return p;
}

function matchImageByVision(imageUrl) {
  return callWorker({ imageUrl }, MATCH_TIMEOUT_MS);
}

// Tìm các MÃ giống kiểu dáng với 1 mã (CLIP). Trả mảng [{code, score}] đã xếp hạng.
async function similarByCode(code, n = 30) {
  const r = await callWorker({ cmd: "similar", code: String(code || "").toUpperCase(), n }, MATCH_TIMEOUT_MS);
  return (r && r.ok && Array.isArray(r.codes)) ? r.codes : [];
}

async function resolveImage(imageUrl) {
  const vision = await matchImageByVision(imageUrl);
  if (!vision.ok || !vision.code) {
    return { ok: false, reason: vision.reason || "VISION_FAIL", score: vision.score, gap: vision.gap, top: vision.top, vision };
  }
  const product = await findProductByCode(vision.code);
  if (!product) {
    return { ok: false, reason: "NOT_FOUND_IN_SHEET", code: vision.code, score: vision.score, gap: vision.gap };
  }
  // MÀU đọc từ TÊN FILE của ảnh khớp nhất (hash_index.json). Lọc rác: chỉ nhận nếu KHỚP màu SP
  // trong sheet (ưu tiên), hoặc là MÀU hợp lệ khi SP không khai màu. -> tên kiểu "AI"/"OD"/rỗng bị bỏ.
  let color = "";
  try {
    const raw = getColorByImageId(vision.image_id) || "";
    if (raw) {
      const sheet = splitColors(product.color || "");
      if (sheet.length) {
        const hit = sheet.find(c => colorMatches(c, raw) || colorMatches(raw, c));
        color = hit || "";
      } else {
        color = extractColor(raw) ? raw : "";
      }
    }
  } catch (_) {}
  if (color) console.log(`[vision] màu (từ tên file): ${color} | mã ${vision.code} | img ${vision.image_id}`);
  return { ok: true, code: vision.code, product, color, imageId: vision.image_id || null, score: vision.score, gap: vision.gap, top: vision.top };
}

ensureWorker(); // warm-up sớm

module.exports = { resolveImage, similarByCode };
