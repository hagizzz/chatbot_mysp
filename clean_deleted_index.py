# -*- coding: utf-8 -*-
# Dọn INDEX: xóa khỏi clip_index.npz + hash_index.json những ảnh mà Drive KHÔNG còn
# (đã xóa / bỏ vào thùng rác). update_index.py chỉ THÊM, không bao giờ TRỪ -> dùng file này để đồng bộ.
#
# CÁCH CHẠY (tắt bot trước để không tranh file):
#   pm2 stop bot
#   python clean_deleted_index.py
#   pm2 start bot
#
# An toàn:
#   - Tạo backup .bak trước khi ghi đè.
#   - Chỉ xóa ảnh ĐÃ XÁC MINH là không còn (404/trashed). Ảnh chỉ bị đổi thư mục -> GIỮ.
#   - Nếu số ảnh cần xóa > 50% index -> DỪNG (đề phòng nhầm), không ghi gì.

import os
import sys
import json
import shutil
import ast

import numpy as np
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# ==== khớp với update_index.py ====
DRIVE_FOLDER_ID = "1bA48sjugz9BczcoR0-zOc-VNlIYikp4v"
SA_KEY = "google-service-account.json"
CLIP_INDEX = "clip_index.npz"
HASH_INDEX = "hash_index.json"

SAFETY_MAX_RATIO = 0.50  # xóa quá nửa index -> nghi ngờ -> dừng


def log(*a):
    print(*a, flush=True)


def drive_service():
    creds = service_account.Credentials.from_service_account_file(
        SA_KEY, scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    return build("drive", "v3", credentials=creds)


def list_live_ids(svc):
    """ID mọi ảnh CÒN SỐNG trong thư mục Drive (trashed=false)."""
    live, token = set(), None
    while True:
        res = svc.files().list(
            q=f"'{DRIVE_FOLDER_ID}' in parents and trashed=false",
            fields="nextPageToken, files(id,mimeType)",
            pageSize=1000, pageToken=token,
        ).execute()
        for f in res.get("files", []):
            if str(f.get("mimeType", "")).startswith("image/"):
                live.add(f["id"])
        token = res.get("nextPageToken")
        if not token:
            break
    return live


def confirm_gone(svc, fid):
    """True nếu file THỰC SỰ không còn (404) hoặc đã vào thùng rác. Còn sống -> False (giữ lại)."""
    try:
        meta = svc.files().get(fileId=fid, fields="id,trashed",
                               supportsAllDrives=True).execute()
        return bool(meta.get("trashed"))
    except HttpError as e:
        if getattr(e, "resp", None) is not None and e.resp.status == 404:
            return True
        # lỗi khác (mạng/quyền) -> KHÔNG dám xóa
        log(f"  [!] lỗi kiểm tra {fid}: {e} -> GIỮ lại cho an toàn")
        return False


def as_dict(x):
    """meta phần tử có thể là dict hoặc chuỗi "{...}" -> trả về dict."""
    if isinstance(x, dict):
        return x
    try:
        return ast.literal_eval(str(x))
    except Exception:
        return {}


def get_id(x):
    return str(as_dict(x).get("id", "")).strip()


def main():
    for f in (SA_KEY, CLIP_INDEX, HASH_INDEX):
        if not os.path.exists(f):
            log(f"THIẾU FILE: {f} (chạy trong thư mục C:\\AI_HTK_BOT_V5)")
            sys.exit(1)

    log("== Đọc index ==")
    d = np.load(CLIP_INDEX, allow_pickle=True)
    embeddings = d["embeddings"]
    meta = list(d["meta"])
    n = len(meta)
    log(f"clip_index: {n} ảnh (embeddings shape {embeddings.shape})")

    with open(HASH_INDEX, "r", encoding="utf-8") as fp:
        hash_list = json.load(fp)
    log(f"hash_index: {len(hash_list)} ảnh")

    log("== Lấy danh sách ảnh CÒN SỐNG trên Drive ==")
    svc = drive_service()
    live = list_live_ids(svc)
    log(f"Drive còn sống: {len(live)} ảnh")

    # Ứng viên = ảnh trong index không nằm trong danh sách sống của thư mục.
    cand = []
    for i, m in enumerate(meta):
        fid = get_id(m)
        if fid and fid not in live:
            cand.append((i, fid))
    log(f"Nghi ngờ đã xóa (không thấy trong thư mục): {len(cand)} ảnh -> đang xác minh từng tấm...")

    # Xác minh từng ứng viên: chỉ xóa nếu THỰC SỰ 404/trashed.
    gone = set()
    for k, (i, fid) in enumerate(cand, 1):
        if confirm_gone(svc, fid):
            gone.add(fid)
        if k % 25 == 0 or k == len(cand):
            log(f"  ...đã kiểm {k}/{len(cand)}, xác nhận xóa {len(gone)}")

    if not gone:
        log("KHÔNG có ảnh nào cần xóa. Index đã sạch. (Không ghi gì.)")
        return

    ratio = len(gone) / max(1, n)
    log(f"\n== KẾT QUẢ: sẽ xóa {len(gone)} ảnh ({ratio*100:.1f}% index) ==")
    if ratio > SAFETY_MAX_RATIO:
        log(f"DỪNG: xóa hơn {int(SAFETY_MAX_RATIO*100)}% index -> nghi ngờ sai. KHÔNG ghi gì.")
        log("Kiểm tra lại DRIVE_FOLDER_ID / quyền service account rồi chạy lại.")
        sys.exit(2)

    # Danh sách xóa (để đối chiếu)
    log("Các ảnh bị loại:")
    shown = 0
    for m in meta:
        if get_id(m) in gone:
            dd = as_dict(m)
            log(f"   - {dd.get('code','?')} | {dd.get('name','?')} | {dd.get('id')}")
            shown += 1
            if shown >= 200:
                log(f"   ... (+{len(gone)-shown} ảnh nữa)")
                break

    # Lọc clip_index (embeddings + meta) theo mask GIỮ
    keep_mask = np.array([get_id(m) not in gone for m in meta])
    new_emb = embeddings[keep_mask]
    new_meta = [m for m in meta if get_id(m) not in gone]

    # Lọc hash_index theo id
    new_hash = [h for h in hash_list if str(h.get("id", "")).strip() not in gone]

    # Backup rồi ghi
    shutil.copy2(CLIP_INDEX, CLIP_INDEX + ".bak")
    shutil.copy2(HASH_INDEX, HASH_INDEX + ".bak")
    log(f"\nĐã backup: {CLIP_INDEX}.bak , {HASH_INDEX}.bak")

    np.savez_compressed(CLIP_INDEX, embeddings=new_emb,
                        meta=np.array(new_meta, dtype=object))
    with open(HASH_INDEX, "w", encoding="utf-8") as fp:
        json.dump(new_hash, fp, ensure_ascii=False)

    log("== XONG ==")
    log(f"clip_index: {n} -> {len(new_meta)} ảnh")
    log(f"hash_index: {len(hash_list)} -> {len(new_hash)} ảnh")
    log("Nếu có sự cố, khôi phục bằng cách đổi tên 2 file .bak về tên gốc.")


if __name__ == "__main__":
    main()
