import sys
import io
import time

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import json
import embedding_core as core


def main():
    print("[vision] dang nap model...", file=sys.stderr, flush=True)
    t0 = time.time()
    try:
        model, preprocess = core.get_model()
        db, meta = core.load_index()
    except Exception as e:
        # báo lỗi nạp qua stdout để Node biết
        print(json.dumps({"ready": False, "error": str(e)}), flush=True)
        print(f"[vision] nap model LOI: {e}", file=sys.stderr, flush=True)
        return

    # QUAN TRỌNG: gửi tín hiệu READY qua STDOUT (kênh Node lắng nghe), KHÔNG phải stderr
    print(json.dumps({"ready": True, "count": len(meta)}), flush=True)
    print(f"[vision] worker san sang sau {int(time.time()-t0)}s, so mau: {len(meta)}",
          file=sys.stderr, flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            if req.get("cmd") == "similar":
                res = core.similar_by_code(req.get("code"), req.get("n") or 30, db, meta)
            else:
                res = core.match(req.get("imageUrl"), model, preprocess, db, meta)
        except Exception as e:
            res = {"ok": False, "reason": "WORKER_ERROR", "error": str(e)}
        res["id"] = rid
        try:
            print(json.dumps(res, ensure_ascii=False), flush=True)
        except Exception:
            print(json.dumps(res, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
