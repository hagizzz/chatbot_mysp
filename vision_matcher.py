import sys
import json
import requests
from io import BytesIO
from collections import defaultdict

from PIL import Image, ImageOps
import imagehash

HASH_INDEX_FILE = "hash_index.json"

HASH_TOP_N = 120

MAX_DISTANCE_STRONG = 8
MAX_DISTANCE_ACCEPT = 12
MIN_GAP_OK = 2
MIN_VOTE_OK = 2


def load_pil_from_url(url):
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
    r.raise_for_status()
    return Image.open(BytesIO(r.content)).convert("RGB")


def load_cache():
    with open(HASH_INDEX_FILE, "r", encoding="utf8") as f:
        return json.load(f)


def normalize_code(code):
    return str(code or "").strip().upper()


def crop_box(img, l, t, r, b):
    w, h = img.size
    l = max(0, min(w - 1, int(l)))
    r = max(l + 1, min(w, int(r)))
    t = max(0, min(h - 1, int(t)))
    b = max(t + 1, min(h, int(b)))
    return img.crop((l, t, r, b))


def crop_product_area(img):
    img = ImageOps.exif_transpose(img).convert("RGB")
    w, h = img.size

    crops = []
    crops.append(("original", img))
    crops.append(("fb_mobile_main_1", crop_box(img, 0, h * 0.12, w, h * 0.72)))
    crops.append(("fb_mobile_main_2", crop_box(img, 0, h * 0.14, w, h * 0.76)))
    crops.append(("fb_mobile_main_3", crop_box(img, 0, h * 0.16, w, h * 0.80)))
    crops.append(("center_90", crop_box(img, w * 0.03, h * 0.08, w * 0.97, h * 0.92)))
    crops.append(("center_82", crop_box(img, w * 0.08, h * 0.12, w * 0.92, h * 0.88)))
    crops.append(("center_74", crop_box(img, w * 0.13, h * 0.16, w * 0.87, h * 0.86)))
    crops.append(("person_full", crop_box(img, w * 0.08, h * 0.14, w * 0.92, h * 0.84)))
    crops.append(("person_upper", crop_box(img, w * 0.08, h * 0.14, w * 0.92, h * 0.62)))
    crops.append(("person_lower", crop_box(img, w * 0.08, h * 0.35, w * 0.92, h * 0.86)))
    crops.append(("remove_top_bottom_1", crop_box(img, 0, h * 0.10, w, h * 0.88)))
    crops.append(("remove_top_bottom_2", crop_box(img, 0, h * 0.18, w, h * 0.90)))

    final = []
    for name, c in crops:
        cw, ch = c.size
        if cw >= 120 and ch >= 120:
            final.append((name, c))
    return final


def resize_for_hash(img):
    w, h = img.size
    if w <= 0 or h <= 0:
        return img
    target_w = 512
    target_h = max(120, int(target_w * h / w))
    return img.resize((target_w, target_h))


def build_customer_hashes(img):
    hashes = []
    for crop_name, crop in crop_product_area(img):
        try:
            c = resize_for_hash(crop)
            hashes.append({"crop": crop_name, "hashType": "phash", "hash": imagehash.phash(c)})
            hashes.append({"crop": crop_name, "hashType": "dhash", "hash": imagehash.dhash(c)})
            hashes.append({"crop": crop_name, "hashType": "whash", "hash": imagehash.whash(c)})
        except Exception:
            pass
    return hashes


def match_image(customer_url):
    cache = load_cache()
    customer_img = load_pil_from_url(customer_url)
    customer_hashes = build_customer_hashes(customer_img)

    if not customer_hashes:
        return {"ok": False, "reason": "CUSTOMER_HASH_FAILED"}

    all_rows = []
    for item in cache:
        try:
            code = normalize_code(item.get("code"))
            if not code:
                continue

            db_hash = imagehash.hex_to_hash(item["hash"])
            best_distance = 999
            best_crop = ""
            best_hash_type = ""

            for h in customer_hashes:
                distance = h["hash"] - db_hash
                if distance < best_distance:
                    best_distance = int(distance)
                    best_crop = h["crop"]
                    best_hash_type = h["hashType"]

            all_rows.append({
                "code": code,
                "name": str(item.get("name") or ""),
                "id": item.get("id"),
                "hashDistance": int(best_distance),
                "bestCrop": best_crop,
                "bestHashType": best_hash_type,
                "thumbnailUrl": item.get("thumbnailUrl"),
                "downloadUrl": item.get("downloadUrl")
            })
        except Exception:
            continue

    all_rows = sorted(all_rows, key=lambda x: x["hashDistance"])
    top = all_rows[:HASH_TOP_N]

    if not top:
        return {"ok": False, "reason": "NO_HASH_RESULT"}

    groups = defaultdict(lambda: {
        "code": None, "bestName": "", "bestDistance": 999,
        "vote": 0, "bestCrop": "", "bestHashType": "", "items": []
    })

    for item in top:
        code = item["code"]
        g = groups[code]
        g["code"] = code
        g["vote"] += 1
        g["items"].append(item)
        if item["hashDistance"] < g["bestDistance"]:
            g["bestDistance"] = int(item["hashDistance"])
            g["bestName"] = item["name"]
            g["bestCrop"] = item["bestCrop"]
            g["bestHashType"] = item["bestHashType"]

    ranked = sorted(groups.values(), key=lambda x: (x["bestDistance"], -x["vote"]))

    best = ranked[0]
    second = ranked[1] if len(ranked) > 1 else None

    best_distance = int(best["bestDistance"])
    second_distance = int(second["bestDistance"]) if second else 999
    gap = second_distance - best_distance
    vote = int(best["vote"])

    top_candidates = [
        {
            "code": x["code"], "bestName": x["bestName"],
            "bestDistance": int(x["bestDistance"]), "vote": int(x["vote"]),
            "bestCrop": x["bestCrop"], "bestHashType": x["bestHashType"]
        }
        for x in ranked[:10]
    ]

    strong = best_distance <= MAX_DISTANCE_STRONG and (gap >= MIN_GAP_OK or vote >= MIN_VOTE_OK)
    accept = best_distance <= MAX_DISTANCE_ACCEPT and vote >= MIN_VOTE_OK and gap >= 1

    if strong or accept:
        return {
            "ok": True, "code": best["code"], "name": best["bestName"],
            "hashDistance": best_distance, "secondDistance": second_distance,
            "gap": gap, "vote": vote, "bestCrop": best["bestCrop"],
            "bestHashType": best["bestHashType"],
            "mode": "V4_PRODUCT_AREA_CROP_HASH", "topCandidates": top_candidates
        }

    return {
        "ok": False, "reason": "LOW_CONFIDENCE",
        "bestCode": best["code"], "bestName": best["bestName"],
        "bestDistance": best_distance, "secondDistance": second_distance,
        "gap": gap, "vote": vote, "bestCrop": best["bestCrop"],
        "bestHashType": best["bestHashType"],
        "mode": "V4_PRODUCT_AREA_CROP_HASH", "topCandidates": top_candidates
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "reason": "MISSING_IMAGE_URL"}, ensure_ascii=False))
        sys.exit()

    try:
        result = match_image(sys.argv[1])
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "reason": str(e)}, ensure_ascii=False))
