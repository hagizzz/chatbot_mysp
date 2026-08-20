# Cập nhật BỔ SUNG ảnh sản phẩm mới vào clip_index.npz (nhận diện) và hash_index.json (gửi ảnh).
# Chỉ thêm ảnh MỚI. Link lưu dạng googleusercontent (hiển thị trực tiếp). Có thử lại khi tải lỗi.
#
# Cài 1 lần:  pip install google-api-python-client google-auth
# Chạy:       python update_index.py     (NHỚ TẮT BOT trước khi chạy)
import io
import sys
import json
import re
import time

import requests
import numpy as np
from PIL import Image

import embedding_core as core
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

DRIVE_FOLDER_ID = "1bA48sjugz9BczcoR0-zOc-VNlIYikp4v"
SA_KEY = "google-service-account.json"
CLIP_INDEX = "clip_index.npz"
HASH_INDEX = "hash_index.json"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def direct_link(fid, w=1000):
    return f"https://lh3.googleusercontent.com/d/{fid}=w{w}"


def code_from_name(name):
    m = re.match(r"^([A-Za-z0-9]+)", str(name or "").strip())
    return m.group(1).upper() if m else None


def drive_service():
    creds = service_account.Credentials.from_service_account_file(
        SA_KEY, scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    return build("drive", "v3", credentials=creds)


def list_drive_images(svc):
    files, token = [], None
    while True:
        res = svc.files().list(
            q=f"'{DRIVE_FOLDER_ID}' in parents and trashed=false",
            fields="nextPageToken, files(id,name,mimeType)",
            pageSize=1000, pageToken=token
        ).execute()
        files += res.get("files", [])
        token = res.get("nextPageToken")
        if not token:
            break
    return [f for f in files if str(f.get("mimeType", "")).startswith("image/")]


def _open_rgb(b):
    return Image.open(io.BytesIO(b)).convert("RGB")


def download_image(svc, file_id):
    # 1) Tải BYTES GỐC qua Drive API (thử lại nếu lỗi MẠNG).
    raw, last = None, None
    for attempt in range(3):
        try:
            req = svc.files().get_media(fileId=file_id)
            buf = io.BytesIO()
            dl = MediaIoBaseDownload(buf, req)
            done = False
            while not done:
                _, done = dl.next_chunk()
            raw = buf.getvalue()
            break
        except Exception as e:
            last = e
            time.sleep(0.8 * (attempt + 1))
    # 2) Thử mở bytes gốc (JPEG/PNG -> OK luôn).
    if raw:
        try:
            return _open_rgb(raw)
        except Exception as e:
            last = e   # vd HEIC: PIL không đọc được bytes gốc -> sang bước 3
    # 3) FALLBACK: tải bản JPEG qua link googleusercontent (Google tự convert HEIC -> JPEG).
    for w in (1600, 1000):
        try:
            r = requests.get(direct_link(file_id, w), timeout=30,
                             headers={"User-Agent": "Mozilla/5.0"})
            if r.ok and r.content and len(r.content) > 1000:
                return _open_rgb(r.content)
        except Exception as e:
            last = e
    raise last or RuntimeError("không tải/đọc được ảnh")


def load_clip():
    try:
        data = np.load(CLIP_INDEX, allow_pickle=True)
        emb = list(data["embeddings"])
        meta = list(data["meta"])
    except Exception as e:
        log("Chưa có clip_index.npz (tạo mới):", e)
        emb, meta = [], []
    ids = set()
    for m in meta:
        if hasattr(m, "item"):
            m = m.item()
        fid = (m or {}).get("id")
        if fid:
            ids.add(str(fid))
    return emb, meta, ids


def save_clip(emb, meta):
    np.savez_compressed(CLIP_INDEX, embeddings=np.array(emb, dtype=np.float32),
                        meta=np.array(meta, dtype=object))


def load_hash():
    try:
        with open(HASH_INDEX, "r", encoding="utf8") as f:
            arr = json.load(f)
    except Exception:
        arr = []
    ids = set(str(x.get("id")) for x in arr if x.get("id"))
    return arr, ids


def save_hash(arr):
    with open(HASH_INDEX, "w", encoding="utf8") as f:
        json.dump(arr, f, ensure_ascii=False)


def main():
    emb, meta, clip_ids = load_clip()
    hash_arr, hash_ids = load_hash()
    log(f"Index hiện có: clip {len(meta)} ảnh | hash {len(hash_arr)} ảnh")

    model, preprocess = core.get_model()
    svc = drive_service()
    images = list_drive_images(svc)
    log(f"Drive có: {len(images)} ảnh")

    todo = [f for f in images if str(f["id"]) not in clip_ids and code_from_name(f["name"])]
    log(f"Cần bổ sung: {len(todo)} ảnh mới")

    added = 0
    for i, f in enumerate(todo, 1):
        fid = str(f["id"])
        code = code_from_name(f["name"])
        try:
            img = download_image(svc, fid)
            v = core.embed_images(model, preprocess, [img])[0]
            emb.append(v)
            meta.append({"id": fid, "code": code, "name": "", "url": ""})
            clip_ids.add(fid)
            if fid not in hash_ids:
                hash_arr.append({
                    "id": fid,
                    "code": code,
                    "name": f.get("name", ""),
                    "mimeType": f.get("mimeType", "image/jpeg"),
                    "thumbnailUrl": direct_link(fid, 1000),
                    "downloadUrl": direct_link(fid, 1600),
                    "webViewLink": f"https://drive.google.com/file/d/{fid}/view"
                })
                hash_ids.add(fid)
            added += 1
        except Exception as e:
            log(f"  Bỏ qua {code}: {e}")
        if i % 20 == 0:
            log(f"  ...{i}/{len(todo)} (đã thêm {added})")
            save_clip(emb, meta)
            save_hash(hash_arr)

    save_clip(emb, meta)
    save_hash(hash_arr)
    log(f"XONG. Đã bổ sung {added} ảnh. Tổng: clip {len(meta)} | hash {len(hash_arr)}.")


if __name__ == "__main__":
    main()
