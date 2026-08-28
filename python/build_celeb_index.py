# Build celeb_index.json: quét thư mục Drive "Nghệ sĩ" -> up ảnh lên Pancake -> lưu content_id.
# Bot dùng celeb_index.json để gửi ẢNH NGHỆ SĨ diện mẫu (thuyết phục khách lăn tăn / lo hợp dáng).
#
# ẢNH NÀY TÁCH RIÊNG khỏi ảnh sản phẩm (KHÔNG đụng hash_index.json / vision).
#
# QUY ƯỚC ĐẶT TÊN FILE: bắt đầu bằng MÃ sản phẩm, vd "MRVX559 - vàng - Lan Khue.jpg".
#   -> Mã lấy từ cụm chữ-số đầu tên file. File "Bản sao của..." sẽ bị BỎ (đổi tên lại cho đúng mã).
#
# Cần .env: PANCAKE_PAGE_ID, PANCAKE_PAGE_ACCESS_TOKEN ; google-service-account.json (quyền đọc Drive).
# Cài 1 lần: pip install google-api-python-client google-auth requests pillow python-dotenv
# Chạy:
#   python build_celeb_index.py                 -> up ảnh MỚI (chưa có content_id) + thêm vào index
#   python build_celeb_index.py --refresh       -> up LẠI tất cả (làm mới content_id khi ảnh vỡ/hết hạn)
import os
import io
import sys
import re
import json
import time

import requests
from PIL import Image
from dotenv import load_dotenv
from google.oauth2 import service_account
from googleapiclient.discovery import build

load_dotenv()
PAGE_ID = os.environ.get("PANCAKE_PAGE_ID")
PAGE_TOKEN = os.environ.get("PANCAKE_PAGE_ACCESS_TOKEN")
SA_KEY = "google-service-account.json"
CELEB_INDEX = "celeb_index.json"

# Thư mục Drive "Ảnh AI > Nghệ sĩ"
CELEB_FOLDER_ID = "1oIBG-bki4B04AWYyt7PLhpiYq-fINyDU"

UPLOAD_URL = f"https://pages.fm/api/public_api/v1/pages/{PAGE_ID}/upload_contents?page_access_token={PAGE_TOKEN}"
REFRESH = ("--refresh" in sys.argv) or ("--all" in sys.argv)


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def direct_link(fid, w=1600):
    return f"https://lh3.googleusercontent.com/d/{fid}=w{w}"


def code_from_name(name):
    # Mã = cụm CHỮ-SỐ đầu tên file. Phải >=5 ký tự và CÓ chữ số (loại "Bản sao", tên rác).
    m = re.match(r"^\s*([A-Za-z][A-Za-z0-9]+)", str(name or "").strip())
    if not m:
        return None
    code = m.group(1).upper()
    if len(code) < 5 or not re.search(r"\d", code):
        return None
    return code


def drive_service():
    creds = service_account.Credentials.from_service_account_file(
        SA_KEY, scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    return build("drive", "v3", credentials=creds)


def list_drive_images(svc):
    files, token = [], None
    while True:
        res = svc.files().list(
            q=f"'{CELEB_FOLDER_ID}' in parents and trashed=false",
            fields="nextPageToken, files(id,name,mimeType)",
            pageSize=1000, pageToken=token
        ).execute()
        files += res.get("files", [])
        token = res.get("nextPageToken")
        if not token:
            break
    return [f for f in files if str(f.get("mimeType", "")).startswith("image/")]


def _is_real_image(b):
    if not b or len(b) < 1500:
        return False
    try:
        im = Image.open(io.BytesIO(b))
        im.verify()
        w, h = im.size
        return w >= 50 and h >= 50
    except Exception:
        return False


def fetch_image_bytes(fid):
    for u in (direct_link(fid, 1600), direct_link(fid, 1000),
              f"https://drive.google.com/uc?export=download&id={fid}"):
        try:
            r = requests.get(u, timeout=20, headers={"User-Agent": "Mozilla/5.0"})
            if r.ok and _is_real_image(r.content):
                return r.content
        except Exception:
            continue
    return None


def shrink_image(img_bytes, max_side=1200, quality=82):
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
        return None


def upload_to_pancake(img_bytes, name="celeb.jpg"):
    files = {"file": (name, io.BytesIO(img_bytes), "image/jpeg")}
    r = requests.post(UPLOAD_URL, files=files, timeout=60)
    r.raise_for_status()
    data = r.json()
    if data.get("success") and data.get("id"):
        return data["id"]
    raise RuntimeError(f"upload thất bại: {data}")


def main():
    if not PAGE_ID or not PAGE_TOKEN:
        log("Thiếu PANCAKE_PAGE_ID / PANCAKE_PAGE_ACCESS_TOKEN trong .env")
        return

    # index cũ (để chỉ up ảnh mới, trừ khi --refresh)
    old = {}
    if os.path.exists(CELEB_INDEX) and not REFRESH:
        try:
            for it in json.load(open(CELEB_INDEX, encoding="utf8")):
                if it.get("id"):
                    old[it["id"]] = it
        except Exception:
            old = {}

    svc = drive_service()
    files = list_drive_images(svc)
    log(f"Thư mục Nghệ sĩ: {len(files)} ảnh. Chế độ: {'UP LẠI TẤT CẢ' if REFRESH else 'chỉ ảnh mới'}.")

    out = []
    skipped, done = 0, 0
    for f in files:
        fid, name = f["id"], f.get("name", "")
        code = code_from_name(name)
        if not code:
            skipped += 1
            log(f"  BỎ (không đọc được mã - đổi tên file bắt đầu bằng MÃ): {name}")
            continue

        # đã có content_id (không refresh) -> giữ nguyên
        if fid in old and old[fid].get("pancakeId"):
            out.append(old[fid])
            continue

        img = fetch_image_bytes(fid)
        if not img:
            log(f"  BỎ (Drive không tải được ảnh thật): {name}")
            continue
        small = shrink_image(img)
        if not small:
            log(f"  BỎ (không phải ảnh): {name}")
            continue
        try:
            cid = upload_to_pancake(small, name)
        except Exception as e:
            log(f"  lỗi up {name}: {e}")
            time.sleep(1)
            continue
        out.append({
            "id": fid, "name": name, "code": code,
            "pancakeId": cid, "downloadUrl": direct_link(fid, 1600),
            "thumbnailUrl": direct_link(fid, 1000),
        })
        done += 1
        if done % 10 == 0:
            log(f"  ...đã up {done} ảnh")
            json.dump(out, open(CELEB_INDEX, "w", encoding="utf8"), ensure_ascii=False)
        time.sleep(0.15)  # tránh rate limit

    json.dump(out, open(CELEB_INDEX, "w", encoding="utf8"), ensure_ascii=False)
    by_code = {}
    for it in out:
        by_code.setdefault(it["code"], 0)
        by_code[it["code"]] += 1
    log(f"XONG. {len(out)} ảnh nghệ sĩ / {len(by_code)} mã. Up mới: {done}, bỏ qua: {skipped}.")
    log("Các mã có ảnh nghệ sĩ: " + ", ".join(f"{k}({v})" for k, v in sorted(by_code.items())))


if __name__ == "__main__":
    main()
