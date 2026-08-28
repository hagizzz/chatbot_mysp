# Lõi nhận diện ảnh dùng open_clip + clip_index.npz.
import sys
import time
from io import BytesIO
from collections import defaultdict

import numpy as np
import requests
from PIL import Image, ImageOps

import os

INDEX_FILE = "clip_index.npz"
MODEL_ARCH = "ViT-B-32"
MODEL_PRETRAINED = "laion2b_s34b_b79k"

# Ngưỡng nhận diện. Có thể chỉnh qua biến môi trường mà KHÔNG cần sửa code:
#   CLIP_MIN_SCORE: điểm tối thiểu của mẫu khớp nhất (mặc định 0.24).
#   CLIP_MIN_GAP:   khoảng cách điểm tối thiểu giữa mẫu #1 và mẫu #2.
#     -> 2 mẫu NHÌN GIỐNG NHAU sẽ có điểm sát nhau; gap nhỏ = nhập nhằng -> coi là KHÔNG chắc (LOW_CONFIDENCE),
#        bot sẽ KHÔNG đoán bừa mà nhường người thật, thay vì gửi nhầm mẫu.
#     Cũ 0.015 quá lỏng -> sau khi thêm mẫu mới giống nhau dễ chọn nhầm. Nâng mặc định lên 0.03.
# 2026-06: ảnh mẫu CHƯA cập nhật vào hệ thống vẫn khớp "gần giống nhất" (vd Camellia) -> BÁO BỪA.
#   Nâng ngưỡng: điểm tối thiểu 0.24->0.28, khoảng cách (gap) top1-top2 0.03->0.06 để loại ảnh "không có trong kho".
#   Vẫn chỉnh được qua biến môi trường CLIP_MIN_SCORE / CLIP_MIN_GAP (xem log "VISION: ... score/gap/top" để canh số).
# [FIX MẪU MA Camellia 2026-07-17] Sàn 0.26 gần như vô nghĩa: match THẬT trong kho toàn 0.90-0.97,
# ảnh NGOÀI catalog (selfie/ảnh lạ) vẫn đạt 0.6-0.7 + gap đủ -> nhận bừa mẫu "đỡ lạ nhất" (Camellia
# 0.6555 ok!). Nâng sàn lên 0.80: ảnh không thuộc kho -> ok:false, thà im hơn báo mẫu ma.
# Vẫn chỉnh nóng được qua biến môi trường CLIP_MIN_SCORE (vd thấy trượt oan vùng 0.78-0.80 thì hạ).
MIN_SCORE = float(os.environ.get("CLIP_MIN_SCORE", "0.80"))
MIN_GAP = float(os.environ.get("CLIP_MIN_GAP", "0.04"))

_model = None
_preprocess = None
_device = None


def get_model():
    global _model, _preprocess, _device
    if _model is None:
        real = sys.stdout
        sys.stdout = sys.stderr
        try:
            import torch
            import open_clip
            _device = "cuda" if torch.cuda.is_available() else "cpu"
            m, _, pp = open_clip.create_model_and_transforms(
                MODEL_ARCH, pretrained=MODEL_PRETRAINED, device=_device
            )
            m.eval()
            _model, _preprocess = m, pp
        finally:
            sys.stdout = real
    return _model, _preprocess


def load_index():
    data = np.load(INDEX_FILE, allow_pickle=True)
    return data["embeddings"], data["meta"]


def load_image(url):
    # Đường dẫn TỆP trên máy (dùng cho bộ đo độ nhận diện: test/anh_thu/*.jpg).
    # Nhận cả "file://..." lẫn đường dẫn trần. Không có mạng vẫn đo được.
    u = str(url or "")
    if not u.lower().startswith(("http://", "https://")):
        p = u[7:] if u.lower().startswith("file://") else u
        return Image.open(p).convert("RGB")

    # Thử lại tối đa 3 lần - tải nhiều ảnh liên tiếp dễ rớt 1-2 tấm
    last = None
    for attempt in range(3):
        try:
            r = requests.get(
                url,
                headers={"User-Agent": "Mozilla/5.0", "Accept": "image/*,*/*"},
                timeout=25
            )
            r.raise_for_status()
            return Image.open(BytesIO(r.content)).convert("RGB")
        except Exception as e:
            last = e
            time.sleep(0.6 * (attempt + 1))
    raise last


def _crop(img, l, t, r, b):
    w, h = img.size
    return img.crop((
        int(max(0, l * w)), int(max(0, t * h)),
        int(min(w, r * w)), int(min(h, b * h))
    ))


def make_variants(img):
    img = ImageOps.exif_transpose(img).convert("RGB")
    return [
        img,
        _crop(img, 0.00, 0.12, 1.00, 0.78),
        _crop(img, 0.00, 0.16, 1.00, 0.84),
        _crop(img, 0.05, 0.12, 0.95, 0.88),
        _crop(img, 0.10, 0.15, 0.90, 0.86),
        _crop(img, 0.15, 0.18, 0.85, 0.82),
    ]


def embed_images(model, preprocess, images):
    import torch
    tensors = torch.stack([preprocess(im) for im in images]).to(_device)
    with torch.no_grad():
        emb = model.encode_image(tensors)
        emb = emb / emb.norm(dim=-1, keepdim=True)
    return emb.cpu().numpy().astype(np.float32)


def similar_by_code(code, n, db, meta):
    """Tìm các MÃ có ảnh GIỐNG NHẤT với mã đã cho (CLIP nearest-neighbor theo vector trung bình của mã)."""
    code = str(code or "").upper().strip()
    if not code:
        return {"ok": False, "reason": "NO_CODE", "codes": []}
    idxs = []
    for i, m in enumerate(meta):
        mm = m.item() if hasattr(m, "item") else m
        if str(mm.get("code") or "").upper().strip() == code:
            idxs.append(i)
    if not idxs:
        return {"ok": False, "reason": "CODE_NOT_IN_INDEX", "codes": []}
    qv = np.asarray(db)[idxs].mean(axis=0)
    qv = qv / (np.linalg.norm(qv) + 1e-9)
    scores = np.asarray(db) @ qv
    order = np.argsort(-scores)
    best = {}
    for i in order[:800]:
        mm = meta[i].item() if hasattr(meta[i], "item") else meta[i]
        c = str(mm.get("code") or "").upper().strip()
        if not c or c == code:
            continue
        s = float(scores[i])
        if c not in best or s > best[c]:
            best[c] = s
        if len(best) >= max(n * 4, 40):
            break
    ranked = sorted(best.items(), key=lambda kv: kv[1], reverse=True)[:int(n)]
    return {"ok": True, "codes": [{"code": c, "score": round(s, 4)} for c, s in ranked]}


def match(url, model, preprocess, db, meta):
    try:
        img = load_image(url)
    except Exception as e:
        return {"ok": False, "reason": "DOWNLOAD_FAIL", "error": str(e)}

    variants = make_variants(img)
    q = embed_images(model, preprocess, variants)
    scores = (db @ q.T).max(axis=1)
    top_idx = np.argsort(-scores)[:30]

    groups = defaultdict(lambda: {"code": None, "bestName": "", "bestScore": -1, "vote": 0, "bestId": ""})
    for idx in top_idx:
        item = meta[idx]
        if hasattr(item, "item"):
            item = item.item()
        code = str(item.get("code") or "").upper().strip()
        if not code:
            continue
        s = float(scores[idx])
        g = groups[code]
        g["code"] = code
        g["vote"] += 1
        if s > g["bestScore"]:
            g["bestScore"] = s
            g["bestName"] = item.get("name") or ""
            g["bestId"] = str(item.get("id") or "")

    ranked = sorted(groups.values(), key=lambda x: (x["bestScore"], x["vote"]), reverse=True)
    if not ranked:
        return {"ok": False, "reason": "NO_MATCH"}

    best = ranked[0]
    second = ranked[1] if len(ranked) > 1 else None
    bs = float(best["bestScore"])
    ss = float(second["bestScore"]) if second else 0.0
    gap = bs - ss

    top = [
        {"code": x["code"], "name": x["bestName"],
         "score": round(float(x["bestScore"]), 4), "vote": x["vote"]}
        for x in ranked[:5]
    ]
    ok = bs >= MIN_SCORE and gap >= MIN_GAP

    return {
        "ok": bool(ok),
        "code": best["code"] if ok else None,
        "name": best["bestName"],
        "image_id": best["bestId"],
        "score": round(bs, 4),
        "gap": round(gap, 4),
        "reason": None if ok else "LOW_CONFIDENCE",
        "top": top
    }
