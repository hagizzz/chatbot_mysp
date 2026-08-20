# Test nhận diện 1 ảnh: python match_test.py "<url>"
import sys
import io

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import json
import embedding_core as core


def main():
    if len(sys.argv) < 2:
        print('Dùng: python match_test.py "<url_ảnh>"')
        return
    url = sys.argv[1]
    model, preprocess = core.get_model()
    db, meta = core.load_index()
    res = core.match(url, model, preprocess, db, meta)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    print("\nNgưỡng: STRONG_SCORE=%.3f FLOOR_SCORE=%.3f CLEAR_GAP=%.3f"
          % (core.STRONG_SCORE, core.FLOOR_SCORE, core.CLEAR_GAP))


if __name__ == "__main__":
    main()
