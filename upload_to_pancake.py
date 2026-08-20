# Up sẵn ảnh sản phẩm lên Pancake (1 lần), lưu content_id vào hash_index.json (trường pancakeId).
# Sau đó bot gửi ảnh bằng content_id -> Pancake hiển thị được (hết vỡ), khách vẫn nhận ảnh.
#
# Cần: file .env có PANCAKE_PAGE_ID, PANCAKE_PAGE_ACCESS_TOKEN; hash_index.json có sẵn (id ảnh Drive).
# Cài 1 lần (nếu chưa): pip install requests python-dotenv
# Chạy: python upload_to_pancake.py     (NÊN tắt bot trước)
import os
import io
import sys
import json
import time

import requests
from PIL import Image
from dotenv import load_dotenv

load_dotenv()
PAGE_ID = os.environ.get("PANCAKE_PAGE_ID")
PAGE_TOKEN = os.environ.get("PANCAKE_PAGE_ACCESS_TOKEN")
HASH_INDEX = "hash_index.json"

UPLOAD_URL = f"https://pages.fm/api/public_api/v1/pages/{PAGE_ID}/upload_contents?page_access_token={PAGE_TOKEN}"

# Chế độ chạy (đọc tham số dòng lệnh):
#   python upload_to_pancake.py                -> CHỈ up ảnh MỚI (chưa có content_id). (mặc định)
#   python upload_to_pancake.py --refresh      -> UP LẠI TẤT CẢ, làm mới content_id (dùng khi ảnh hết hạn, bị vỡ).
#   python upload_to_pancake.py --refresh MMVX5211,MMVX5232  -> up lại CHỈ vài mã (nhẹ, nhanh).
REFRESH = ("--refresh" in sys.argv) or ("--all" in sys.argv)
CODES_FILTER = None
for _a in sys.argv[1:]:
    if _a.startswith("--"):
        continue
    CODES_FILTER = set(c.strip().upper() for c in _a.split(",") if c.strip())


def need_upload(item):
    # lọc theo mã nếu có chỉ định
    if CODES_FILTER is not None and str(item.get("code") or "").upper() not in CODES_FILTER:
        return False
    if REFRESH:
        return True                      # up lại (làm mới content_id)
    return not item.get("pancakeId")     # mặc định: chỉ ảnh chưa có content_id


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def drive_download_url(fid):
    # tải ảnh gốc từ Drive bằng id (đã có trong hash_index)
    return f"https://drive.google.com/uc?export=download&id={fid}"


def _is_real_image(b):
    # Bytes phải MỞ ĐƯỢC bằng PIL và có kích thước hợp lý -> mới là ảnh thật.
    # (Drive hay trả trang HTML "quá giới hạn/không xem được" >1000 byte -> KHÔNG phải ảnh -> bỏ.)
    if not b or len(b) < 1500:
        return False
    try:
        im = Image.open(io.BytesIO(b))
        im.verify()                      # phát hiện file hỏng/không phải ảnh
        w, h = im.size
        return w >= 50 and h >= 50
    except Exception:
        return False


def fetch_image_bytes(item):
    # ưu tiên link lh3 đang có trong hash_index (đáng tin), fallback sang Drive id.
    urls = []
    if item.get("downloadUrl"):
        urls.append(item["downloadUrl"])
    if item.get("thumbnailUrl"):
        urls.append(item["thumbnailUrl"])
    if item.get("id"):
        urls.append(drive_download_url(item["id"]))
    for u in urls:
        try:
            r = requests.get(u, timeout=20, headers={"User-Agent": "Mozilla/5.0"})
            if r.ok and _is_real_image(r.content):   # CHỈ nhận ẢNH THẬT (bỏ trang HTML lỗi/giới hạn)
                return r.content
        except Exception:
            continue
    return None


def shrink_image(img_bytes, max_side=1000, quality=80):
    # Thu nhỏ + nén để up nhanh, nhẹ (ảnh chat không cần to). Lỗi mở ảnh -> trả None (KHÔNG up rác).
    try:
        im = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        w, h = im.size
        scale = max_side / float(max(w, h))
        if scale < 1:
            im = im.resize((int(w * scale), int(h * scale)))
        out = io.BytesIO()
        im.save(out, format="JPEG", quality=quality, optimize=True)
        return out.getvalue()
    except Exception:
        return None  # không mở được = không phải ảnh thật -> bỏ (tránh up ảnh vỡ)


def upload_to_pancake(img_bytes, name="image.jpg"):
    files = {"file": (name, io.BytesIO(img_bytes), "image/jpeg")}
    r = requests.post(UPLOAD_URL, files=files, timeout=60)
    r.raise_for_status()
    data = r.json()
    if data.get("success") and data.get("id"):
        return data["id"]
    raise RuntimeError(f"upload thất bại: {data}")


def main():
    if not PAGE_ID or not PAGE_TOKEN:
        log("Thiếu PANCAKE_PAGE_ID hoặc PANCAKE_PAGE_ACCESS_TOKEN trong .env")
        return

    with open(HASH_INDEX, encoding="utf8") as f:
        arr = json.load(f)

    todo = [x for x in arr if need_upload(x)]
    mode = "UP LẠI TẤT CẢ (refresh content_id)" if REFRESH else "chỉ ảnh mới (chưa có content_id)"
    if CODES_FILTER is not None:
        mode += f" | chỉ mã: {', '.join(sorted(CODES_FILTER))}"
    log(f"Tổng {len(arr)} ảnh | chế độ: {mode} | cần up: {len(todo)} ảnh")

    done = 0
    for i, item in enumerate(arr):
        if not need_upload(item):
            continue
        img = fetch_image_bytes(item)
        if not img:
            log(f"  bỏ qua (không tải được ẢNH THẬT - Drive lỗi/giới hạn/không public): {item.get('code')} / {item.get('id')}")
            continue
        img = shrink_image(img)
        if not img:
            log(f"  bỏ qua (file tải về KHÔNG phải ảnh): {item.get('code')} / {item.get('id')}")
            continue
        try:
            cid = upload_to_pancake(img, item.get("name") or "image.jpg")
            item["pancakeId"] = cid
            done += 1
        except Exception as e:
            log(f"  lỗi up {item.get('code')}: {e}")
            time.sleep(1)
            continue

        if done % 20 == 0:
            log(f"  ...đã up {done} ảnh")
            with open(HASH_INDEX, "w", encoding="utf8") as f:
                json.dump(arr, f, ensure_ascii=False)
        time.sleep(0.15)  # nhẹ tay tránh rate limit 5 req/giây

    with open(HASH_INDEX, "w", encoding="utf8") as f:
        json.dump(arr, f, ensure_ascii=False)
    log(f"XONG. Đã up {done} ảnh lên Pancake. Lưu content_id vào hash_index.json.")


if __name__ == "__main__":
    main()
