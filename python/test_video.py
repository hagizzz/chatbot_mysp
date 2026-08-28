# =====================================================================
# TEST: Pancake có gửi được VIDEO (kéo thẳng từ Drive) không?
# ---------------------------------------------------------------------
# KHÔNG cần tải video tay. Script tự tải 1 video từ Drive bằng service account
# (google-service-account.json - cái đang dùng cho ảnh), rồi up lên Pancake.
#
# Chạy trong C:\AI_HTK_BOT_V5 (nơi có .env + google-service-account.json):
#   python test_video.py                      -> test 1 video MẶC ĐỊNH (file id dưới)
#   python test_video.py <DRIVE_FILE_ID>      -> test video Drive khác
#   python test_video.py <DRIVE_FILE_ID> <conv_id>  -> up XONG gửi luôn vào hội thoại test
#
# Cần (đã có sẵn vì update_index.py dùng): pip install google-api-python-client google-auth requests python-dotenv
# Dán nguyên output cho tao.
# =====================================================================
import os
import io
import sys
import json

import requests
from dotenv import load_dotenv
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

load_dotenv()
PAGE_ID = os.environ.get("PANCAKE_PAGE_ID")
PAGE_TOKEN = os.environ.get("PANCAKE_PAGE_ACCESS_TOKEN")
SA_KEY = "google-service-account.json"

# Video mặc định = link mày gửi (https://drive.google.com/file/d/<ID>/view)
DEFAULT_FILE_ID = "1HpIW76q45srd7hXFgigxafnxdRfAp_hn"


def log(*a):
    print(*a, flush=True)


def drive_service():
    creds = service_account.Credentials.from_service_account_file(
        SA_KEY, scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    return build("drive", "v3", credentials=creds)


def main():
    if not PAGE_ID or not PAGE_TOKEN:
        log("THIẾU PANCAKE_PAGE_ID / PANCAKE_PAGE_ACCESS_TOKEN trong .env"); return
    if not os.path.isfile(SA_KEY):
        log(f"THIẾU {SA_KEY} (cần để tải Drive)"); return

    file_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_FILE_ID
    conv_id = sys.argv[2] if len(sys.argv) > 2 else None

    # ---- BƯỚC 0: tải video TỪ DRIVE ----
    log(f"== Tải video từ Drive: file_id={file_id} ==")
    svc = drive_service()
    try:
        meta = svc.files().get(fileId=file_id, fields="id,name,mimeType,size").execute()
        log("Drive file:", json.dumps(meta, ensure_ascii=False))
    except Exception as e:
        log("LỖI đọc metadata Drive (service account có quyền vào file/thư mục này không?):", e); return

    try:
        req = svc.files().get_media(fileId=file_id)
        buf = io.BytesIO()
        dl = MediaIoBaseDownload(buf, req)
        done = False
        while not done:
            _, done = dl.next_chunk()
        vid = buf.getvalue()
    except Exception as e:
        log("LỖI tải bytes video từ Drive:", e); return

    name = meta.get("name") or "video.mp4"
    mime = meta.get("mimeType") or "video/mp4"
    log(f"=> Tải OK: {name} | {len(vid)} bytes | mime={mime}")

    upload_url = (f"https://pages.fm/api/public_api/v1/pages/{PAGE_ID}"
                  f"/upload_contents?page_access_token={PAGE_TOKEN}")

    # ---- BƯỚC 1: UP VIDEO lên Pancake ----
    log("\n--- BƯỚC 1: UP VIDEO lên Pancake (upload_contents) ---")
    content_id = None
    try:
        files = {"file": (name, io.BytesIO(vid), mime)}
        r = requests.post(upload_url, files=files, timeout=300)
        log(f"HTTP {r.status_code}")
        try:
            data = r.json()
            log("PHẢN HỒI:", json.dumps(data, ensure_ascii=False)[:700])
            content_id = data.get("id") or (data.get("content") or {}).get("id")
        except Exception:
            log("PHẢN HỒI (không phải JSON):", r.text[:700])
    except Exception as e:
        log("LỖI up:", e)

    if content_id:
        log(f"=> UP OK, content_id = {content_id}")
    else:
        log("=> UP KHÔNG ra content_id (Pancake có thể không nhận video qua endpoint này).")

    if not conv_id:
        log("\n(KHÔNG có conv_id -> dừng ở bước up. Muốn test GỬI thì chạy lại kèm conv_id.)")
        return

    if not content_id:
        log("\n(Không có content_id -> bỏ qua bước gửi.)"); return

    # ---- BƯỚC 2: GỬI vào hội thoại bằng content_ids ----
    send_url = (f"https://pages.fm/api/public_api/v1/pages/{PAGE_ID}"
                f"/conversations/{conv_id}/messages?page_access_token={PAGE_TOKEN}")
    log("\n--- BƯỚC 2: GỬI vào hội thoại bằng content_ids ---")
    try:
        r = requests.post(send_url, json={"action": "reply_inbox", "content_ids": [content_id]}, timeout=60)
        log(f"HTTP {r.status_code} | PHẢN HỒI:", r.text[:500])
        log(">>> Mở Pancake/Messenger xem khách CÓ nhận được VIDEO thật không.")
    except Exception as e:
        log("LỖI gửi:", e)

    log("\n== XONG. Dán nguyên output này cho tao. ==")


if __name__ == "__main__":
    main()
