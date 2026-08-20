# refresh_names.py — Cập nhật TÊN FILE (để lấy MÀU) theo Drive HIỆN TẠI.
#   - hash_index.json: cập nhật "name" + "code", GIỮ NGUYÊN pancakeId + URL (gửi ảnh không hỏng).
#   - clip_index.npz : cập nhật meta.name + meta.code (KHÔNG re-embed -> nhanh).
#   - Cờ --prune: DỌN luôn entry của ảnh đã XÓA trên Drive (ở CẢ 2 file, vẫn giữ pancakeId các ảnh còn lại).
#
# Dùng khi: bạn ĐỔI TÊN ảnh trên Drive để gắn màu (và/hoặc xóa bớt ảnh). NHỚ TẮT BOT trước khi chạy.
# Chạy:  python refresh_names.py            (chỉ cập nhật tên, KHÔNG xóa entry)
#        python refresh_names.py --prune    (cập nhật tên + dọn ảnh đã xóa khỏi index)
import io
import sys
import json
import re

import numpy as np
from google.oauth2 import service_account
from googleapiclient.discovery import build

DRIVE_FOLDER_ID = "1bA48sjugz9BczcoR0-zOc-VNlIYikp4v"
SA_KEY = "google-service-account.json"
HASH_INDEX = "hash_index.json"
CLIP_INDEX = "clip_index.npz"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


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


def main():
    prune = "--prune" in sys.argv
    svc = drive_service()
    images = list_drive_images(svc)
    name_by_id = {str(f["id"]): f.get("name", "") for f in images}
    log(f"Drive hiện có: {len(images)} ảnh | chế độ: {'CẬP NHẬT + DỌN (--prune)' if prune else 'CHỈ CẬP NHẬT TÊN'}")

    # ---------- 1) hash_index.json ----------
    with open(HASH_INDEX, "r", encoding="utf8") as f:
        arr = json.load(f)
    updated = 0
    gone = sum(1 for it in arr if str(it.get("id")) not in name_by_id)
    kept = []
    for it in arr:
        fid = str(it.get("id"))
        if fid in name_by_id:
            nm = name_by_id[fid]
            if nm and it.get("name") != nm:
                it["name"] = nm
                it["code"] = code_from_name(nm) or it.get("code")
                updated += 1
            kept.append(it)
        elif not prune:
            kept.append(it)   # giữ entry cũ (ảnh đã xóa) nếu không --prune
    with open(HASH_INDEX, "w", encoding="utf8") as f:
        json.dump(kept, f, ensure_ascii=False)
    log(f"hash_index: cập nhật tên {updated} ảnh | " +
        (f"đã DỌN {gone} ảnh đã xóa -> còn {len(kept)}" if prune else f"ảnh đã xóa còn giữ lại: {gone} (chạy --prune để dọn)"))

    # ---------- 2) clip_index.npz ----------
    try:
        d = np.load(CLIP_INDEX, allow_pickle=True)
        emb = d["embeddings"]
        meta = list(d["meta"])
    except Exception as e:
        log("Không nạp được clip_index.npz:", e)
        return
    keep_idx, new_meta, mupd = [], [], 0
    for i, m in enumerate(meta):
        mm = m.item() if hasattr(m, "item") else m
        fid = str(mm.get("id"))
        if fid in name_by_id:
            nm = name_by_id[fid]
            if nm and mm.get("name") != nm:
                mm["name"] = nm
                mm["code"] = code_from_name(nm) or mm.get("code")
                mupd += 1
            keep_idx.append(i); new_meta.append(mm)
        elif not prune:
            keep_idx.append(i); new_meta.append(mm)
    new_emb = emb[keep_idx] if prune else emb
    np.savez_compressed(CLIP_INDEX,
                        embeddings=np.array(new_emb, dtype=np.float32),
                        meta=np.array(new_meta, dtype=object))
    log(f"clip_index: cập nhật tên {mupd} ảnh | tổng còn {len(new_meta)} ảnh.")
    log("XONG. Khởi động lại bot là dùng được màu mới.")


if __name__ == "__main__":
    main()
