# ============================================================================
# tao_anh_thu.py — DỰNG BỘ ẢNH THỬ CHO PHÉP ĐO ĐỘ NHẬN DIỆN (GĐ1)
# ----------------------------------------------------------------------------
# Kế hoạch đòi đo trên "ảnh cắt, ảnh chụp màn hình, ảnh chụp lại từ điện thoại,
# ảnh mờ, ảnh lệch màu" — đúng những kiểu ảnh khách hay gửi, và đúng những kiểu
# mà chỉ mục CLIP CHƯA từng thấy (chỉ mục dựng từ ảnh gốc sạch của shop).
#
# Không cần chụp tay: sinh biến thể từ chính ảnh danh mục trong hash_index.json.
# Đáp án nằm trong TÊN FILE nên bộ đo không cần file nhãn riêng.
#
#   python tao_anh_thu.py 40         # 40 mẫu × 5 biến thể = 200 ảnh thử
#
# Ra: test/anh_thu/<MÃ>__<biến thể>.jpg
# ============================================================================
import io, json, os, random, sys

import requests
from PIL import Image, ImageEnhance, ImageFilter

SO_MAU = int(sys.argv[1]) if len(sys.argv) > 1 else 40
RA = os.path.join("test", "anh_thu")
random.seed(20260819)   # cố định để chạy lại ra cùng bộ ảnh, số đo so sánh được giữa các lần


def tai(url):
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=25)
    r.raise_for_status()
    return Image.open(io.BytesIO(r.content)).convert("RGB")


def cat(img):
    """Khách cắt lấy phần thân áo, bỏ đầu/chân — mất bối cảnh."""
    w, h = img.size
    return img.crop((int(w * .18), int(h * .12), int(w * .82), int(h * .78)))


def chup_man_hinh(img):
    """Ảnh chụp màn hình điện thoại: có thanh trạng thái + viền + nén."""
    w, h = img.size
    nen = Image.new("RGB", (w, h + int(h * .12)), (245, 245, 247))
    nen.paste(img, (0, int(h * .08)))
    for x in range(0, w, 3):                       # vệt thanh trạng thái
        nen.putpixel((x, int(h * .03)), (30, 30, 30))
    return nen


def chup_lai(img):
    """Chụp lại màn hình bằng điện thoại: hơi nghiêng, ám vàng, có nhiễu."""
    w, h = img.size
    img = img.rotate(random.uniform(-3.5, 3.5), expand=False, fillcolor=(20, 20, 20))
    img = ImageEnhance.Brightness(img).enhance(random.uniform(0.82, 0.95))
    r, g, b = img.split()
    b = b.point(lambda v: max(0, int(v * 0.90)))    # ám vàng của đèn phòng
    img = Image.merge("RGB", (r, g, b))
    return img.filter(ImageFilter.GaussianBlur(0.6))


def mo(img):
    """Ảnh rung/mờ — rất hay gặp khi khách chụp vội."""
    return img.filter(ImageFilter.GaussianBlur(2.2))


def lech_mau(img):
    """Màn hình khác nhau lên màu khác nhau; ảnh qua nhiều lần gửi cũng lệch."""
    img = ImageEnhance.Color(img).enhance(random.uniform(0.55, 1.55))
    return ImageEnhance.Contrast(img).enhance(random.uniform(0.8, 1.3))


BIEN_THE = {"cat": cat, "chup_man_hinh": chup_man_hinh, "chup_lai": chup_lai,
            "mo": mo, "lech_mau": lech_mau}


def main():
    if not os.path.exists("hash_index.json"):
        print("Không thấy hash_index.json — chạy update_index.py trước.")
        return
    with open("hash_index.json", encoding="utf-8") as f:
        muc = json.load(f)

    # Mỗi mã lấy MỘT ảnh; trải đều danh mục chứ không lấy dồn một chỗ.
    theo_ma = {}
    for m in (muc.values() if isinstance(muc, dict) else muc):
        code = str((m or {}).get("code") or "").upper().strip()
        url = (m or {}).get("thumbnailUrl") or ""
        if code and url and code not in theo_ma:
            theo_ma[code] = url

    ma = sorted(theo_ma)
    if len(ma) > SO_MAU:
        buoc = len(ma) / SO_MAU
        ma = [ma[int(i * buoc)] for i in range(SO_MAU)]

    os.makedirs(RA, exist_ok=True)
    n_ok = n_loi = 0
    for i, code in enumerate(ma, 1):
        try:
            goc = tai(theo_ma[code])
        except Exception as e:
            print(f"  [{i}/{len(ma)}] {code}: tải hỏng ({e})")
            n_loi += 1
            continue
        for ten, ham in BIEN_THE.items():
            try:
                ham(goc).save(os.path.join(RA, f"{code}__{ten}.jpg"), quality=72)
                n_ok += 1
            except Exception as e:
                print(f"  {code}/{ten}: {e}")
                n_loi += 1
        if i % 10 == 0:
            print(f"  ...{i}/{len(ma)} mẫu")

    print(f"\nXong: {n_ok} ảnh thử trong {RA} ({n_loi} lỗi), {len(ma)} mẫu × {len(BIEN_THE)} biến thể.")
    print("Đo:  node do_do_nhan_dien_anh.js")


if __name__ == "__main__":
    main()
