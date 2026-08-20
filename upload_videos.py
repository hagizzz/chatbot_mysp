# =====================================================================
# Up VIDEO sản phẩm từ Drive lên Pancake -> lưu content_id theo MÃ vào video_index.json.
# TỰ NÉN video > 15MB xuống dưới giới hạn (Pancake chặn >15MB) bằng ffmpeg.
# ---------------------------------------------------------------------
# Cần: .env (PANCAKE_PAGE_ID, PANCAKE_PAGE_ACCESS_TOKEN) + google-service-account.json
#      pip install google-api-python-client google-auth requests python-dotenv
#      ffmpeg (để nén video to). Tải: https://www.gyan.dev/ffmpeg/builds/ -> giải nén ->
#         thêm thư mục bin vào PATH, HOẶC để ffmpeg.exe ngay trong C:\AI_HTK_BOT_V5.
#      KHÔNG có ffmpeg -> video to bị BỎ QUA (video nhỏ <15MB vẫn up bình thường).
#
# Chạy:
#   python upload_videos.py              -> up video MỚI (nén nếu cần)
#   python upload_videos.py --refresh    -> up lại tất cả
#   python upload_videos.py --refresh MRVX559,MRKVX6032  -> up lại vài mã
# =====================================================================
import os
import io
import sys
import json
import time
import re
import shutil
import tempfile
import subprocess

import requests
from dotenv import load_dotenv
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

load_dotenv()
PAGE_ID = os.environ.get("PANCAKE_PAGE_ID")
PAGE_TOKEN = os.environ.get("PANCAKE_PAGE_ACCESS_TOKEN")
SA_KEY = "google-service-account.json"
DRIVE_FOLDER_ID = "1bA48sjugz9BczcoR0-zOc-VNlIYikp4v"
VIDEO_INDEX = "video_index.json"

LIMIT = 15 * 1024 * 1024          # Pancake chặn > 15MB
TARGET = 14 * 1024 * 1024         # nén nhắm dưới mức này cho chắc

UPLOAD_URL = f"https://pages.fm/api/public_api/v1/pages/{PAGE_ID}/upload_contents?page_access_token={PAGE_TOKEN}"

# ffmpeg: ưu tiên ffmpeg.exe trong thư mục hiện tại, rồi tới PATH
_LOCAL_FF = os.path.join(os.getcwd(), "ffmpeg.exe")
FFMPEG = _LOCAL_FF if os.path.isfile(_LOCAL_FF) else shutil.which("ffmpeg")

REFRESH = ("--refresh" in sys.argv) or ("--all" in sys.argv)
CODES_FILTER = None
for _a in sys.argv[1:]:
    if _a.startswith("--"):
        continue
    CODES_FILTER = set(c.strip().upper() for c in _a.split(",") if c.strip())


def log(*a):
    print(*a, flush=True)


def code_from_name(name):
    m = re.match(r"^([A-Za-z0-9]+)", str(name or "").strip())
    return m.group(1).upper() if m else None


def drive_service():
    creds = service_account.Credentials.from_service_account_file(
        SA_KEY, scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    return build("drive", "v3", credentials=creds)


def list_drive_videos(svc):
    out, token = [], None
    while True:
        resp = svc.files().list(
            q=f"'{DRIVE_FOLDER_ID}' in parents and trashed=false",
            fields="nextPageToken, files(id,name,mimeType)",
            pageSize=1000, pageToken=token,
        ).execute()
        out.extend(resp.get("files", []))
        token = resp.get("nextPageToken")
        if not token:
            break
    return [f for f in out if str(f.get("mimeType", "")).startswith("video/")]


def download_bytes(svc, file_id):
    for attempt in range(3):
        try:
            req = svc.files().get_media(fileId=file_id)
            buf = io.BytesIO()
            dl = MediaIoBaseDownload(buf, req)
            done = False
            while not done:
                _, done = dl.next_chunk()
            return buf.getvalue()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(0.8 * (attempt + 1))


# Nén video xuống dưới TARGET bằng ffmpeg. Trả (bytes_mp4) hoặc None nếu không nén được.
def compress(src_bytes, name):
    if not FFMPEG:
        return None
    ext = os.path.splitext(name)[1] or ".mp4"
    in_path = os.path.join(tempfile.gettempdir(), f"vin_{int(time.time()*1000)}{ext}")
    with open(in_path, "wb") as f:
        f.write(src_bytes)
    # Thử lần lượt: hạ dần độ phân giải + tăng nén tới khi <= TARGET
    attempts = [
        ["-vf", "scale=-2:720", "-c:v", "libx264", "-crf", "28", "-preset", "veryfast", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart"],
        ["-vf", "scale=-2:540", "-c:v", "libx264", "-crf", "30", "-preset", "veryfast", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart"],
        ["-vf", "scale=-2:480", "-c:v", "libx264", "-crf", "33", "-preset", "veryfast", "-c:a", "aac", "-b:a", "80k", "-movflags", "+faststart"],
        ["-vf", "scale=-2:360", "-c:v", "libx264", "-crf", "35", "-preset", "veryfast", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart"],
    ]
    best = None
    for args in attempts:
        out_path = os.path.join(tempfile.gettempdir(), f"vout_{int(time.time()*1000)}.mp4")
        try:
            subprocess.run([FFMPEG, "-y", "-i", in_path] + args + [out_path],
                           capture_output=True, timeout=900)
            if os.path.isfile(out_path):
                sz = os.path.getsize(out_path)
                if best is None or sz < best[1]:
                    if best:
                        try: os.remove(best[0])
                        except Exception: pass
                    best = (out_path, sz)
                else:
                    try: os.remove(out_path)
                    except Exception: pass
                if best[1] <= TARGET:
                    break
        except Exception:
            try: os.remove(out_path)
            except Exception: pass
    try: os.remove(in_path)
    except Exception: pass
    if best and best[1] <= LIMIT:
        with open(best[0], "rb") as f:
            data = f.read()
        try: os.remove(best[0])
        except Exception: pass
        return data
    if best:
        try: os.remove(best[0])
        except Exception: pass
    return None


def upload_to_pancake(vid_bytes, name, mime):
    last = None
    for attempt in range(3):   # thử lại nếu lỗi MẠNG tạm (Connection reset)
        try:
            files = {"file": (name, io.BytesIO(vid_bytes), mime or "video/mp4")}
            r = requests.post(UPLOAD_URL, files=files, timeout=300)
            if r.status_code == 413:
                raise RuntimeError("413 (Pancake chặn: file quá lớn)")
            r.raise_for_status()
            data = r.json()
            cid = data.get("id") or (data.get("content") or {}).get("id")
            if data.get("success") and cid:
                return cid
            raise RuntimeError(f"{data}")
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            last = e; time.sleep(1.2 * (attempt + 1))
        except Exception as e:
            raise
    raise RuntimeError(f"mạng lỗi nhiều lần: {last}")


def load_index():
    if os.path.isfile(VIDEO_INDEX):
        try:
            with open(VIDEO_INDEX, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_index(idx):
    with open(VIDEO_INDEX, "w", encoding="utf-8") as f:
        json.dump(idx, f, ensure_ascii=False, indent=2)


def already_have(idx, code, file_id):
    for it in idx.get(code, []):
        if it.get("fileId") == file_id and it.get("contentId"):
            return True
    return False


def main():
    if not PAGE_ID or not PAGE_TOKEN:
        log("THIẾU PANCAKE_PAGE_ID / PANCAKE_PAGE_ACCESS_TOKEN trong .env"); return
    if not os.path.isfile(SA_KEY):
        log(f"THIẾU {SA_KEY}"); return
    log(f"ffmpeg: {'CÓ -> sẽ nén video to' if FFMPEG else 'KHÔNG có -> video >15MB sẽ BỎ QUA (cài ffmpeg để lấy hết)'}")

    svc = drive_service()
    vids = list_drive_videos(svc)
    log(f"Drive: thấy {len(vids)} video.")

    idx = {} if REFRESH else load_index()
    done = skip = fail = big = 0

    for f in vids:
        fid = f["id"]; name = f.get("name") or "video.mp4"; mime = f.get("mimeType") or "video/mp4"
        code = code_from_name(name)
        if not code:
            continue
        if CODES_FILTER and code not in CODES_FILTER:
            continue
        if not REFRESH and already_have(idx, code, fid):
            skip += 1
            continue
        try:
            raw = download_bytes(svc, fid)
            up_name, up_mime = name, mime
            if len(raw) > LIMIT:
                log(f"  {code}: {name} = {len(raw)//1024//1024}MB > 15MB -> nén ...")
                comp = compress(raw, name)
                if comp is None:
                    big += 1
                    log(f"  BỎ QUA {code}: quá 15MB và {'nén vẫn không xuống nổi' if FFMPEG else 'chưa có ffmpeg'}.")
                    continue
                raw = comp
                up_name = os.path.splitext(name)[0] + ".mp4"
                up_mime = "video/mp4"
                log(f"    nén xong -> {len(raw)//1024//1024}MB, up ...")
            else:
                log(f"  Up {code}: {name} ({len(raw)//1024//1024}MB) ...")
            cid = upload_to_pancake(raw, up_name, up_mime)
            idx.setdefault(code, [])
            idx[code] = [it for it in idx[code] if it.get("fileId") != fid]
            idx[code].append({"contentId": cid, "name": name, "fileId": fid})
            done += 1
            save_index(idx)
        except Exception as e:
            fail += 1
            log(f"  LỖI {code} ({name}): {e}")

    save_index(idx)
    log(f"\nXONG. Up {done} | bỏ qua (đã có) {skip} | quá cỡ bỏ {big} | lỗi khác {fail}. -> {VIDEO_INDEX}")
    if big and not FFMPEG:
        log("=> Cài ffmpeg rồi chạy lại để lấy nốt video to.")


if __name__ == "__main__":
    main()
