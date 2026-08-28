# Tạo "sổ embedding" cho toàn bộ sản phẩm. Chạy MỘT lần (và mỗi khi catalog đổi nhiều).
#
# Cách 1 (khuyên dùng nếu có ảnh trên máy):
#   python build_embedding_index.py --images "C:\duong_dan\thu_muc_anh"
#   -> quét mọi ảnh, lấy mã từ tên file (phần trước dấu cách / _ / -)
#
# Cách 2 (mặc định, không cần ảnh local):
#   python build_embedding_index.py
#   -> đọc hash_index.json, tải ảnh theo URL trong đó rồi tạo embedding
import os
import sys
import json
import glob
import argparse

import numpy as np

import embedding_core as core

IMG_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".bmp")


def collect_from_folder(folder):
    items = []
    for path in glob.glob(os.path.join(folder, "**", "*"), recursive=True):
        if path.lower().endswith(IMG_EXTS):
            items.append({"code": core.code_from_filename(path), "name": "", "path": path})
    return items


def collect_from_hash_index(hash_file):
    with open(hash_file, "r", encoding="utf8") as f:
        data = json.load(f)
    items = []
    for it in data:
        code = str(it.get("code") or "").strip().upper()
        if not code:
            continue
        url = it.get("thumbnailUrl") or it.get("downloadUrl")
        if not url:
            continue
        items.append({"code": code, "name": str(it.get("name") or ""), "url": url})
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", help="Thư mục ảnh sản phẩm trên máy (tên file = mã)")
    ap.add_argument("--hash", default="hash_index.json", help="File hash_index.json (mặc định)")
    args = ap.parse_args()

    model = core.get_model()

    if args.images:
        items = collect_from_folder(args.images)
        mode = f"thư mục {args.images}"
    else:
        items = collect_from_hash_index(args.hash)
        mode = f"hash_index ({args.hash})"

    print(f"Nguồn: {mode} | tổng mục: {len(items)}", file=sys.stderr)

    codes, names, vecs = [], [], []
    ok, skip = 0, 0

    for i, it in enumerate(items, 1):
        try:
            from PIL import Image
            if "path" in it:
                img = Image.open(it["path"]).convert("RGB")
            else:
                img = core.download_image(it["url"])
            v = core.embed_images(model, [img])[0]
            codes.append(it["code"])
            names.append(it["name"])
            vecs.append(v)
            ok += 1
        except Exception as e:
            skip += 1
            print(f"  Bỏ qua {it.get('code')}: {e}", file=sys.stderr)

        if i % 25 == 0:
            print(f"  ...đã xử lý {i}/{len(items)}", file=sys.stderr)

    if not vecs:
        print("KHÔNG tạo được embedding nào. Kiểm tra lại nguồn ảnh.", file=sys.stderr)
        sys.exit(1)

    emb = np.vstack(vecs).astype(np.float32)
    np.savez_compressed(
        core.INDEX_FILE,
        codes=np.array(codes, dtype=object),
        names=np.array(names, dtype=object),
        embeddings=emb
    )
    print(f"XONG. Đã lưu {core.INDEX_FILE}: thành công {ok}, bỏ qua {skip}.", file=sys.stderr)


if __name__ == "__main__":
    main()
