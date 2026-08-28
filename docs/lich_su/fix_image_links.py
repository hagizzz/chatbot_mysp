# Đổi link ảnh trong hash_index.json sang dạng googleusercontent (hiển thị trực tiếp trên trình duyệt,
# Pancake không còn vỡ ảnh). Tự sao lưu .bak.
import json
import os
import shutil

HASH_INDEX = "hash_index.json"


def direct_link(file_id, w=1000):
    # Dạng lh3.googleusercontent.com hiển thị trực tiếp trong trình duyệt
    return f"https://lh3.googleusercontent.com/d/{file_id}=w{w}"


def main():
    if not os.path.exists(HASH_INDEX):
        print("Không thấy hash_index.json trong thư mục hiện tại.")
        return

    shutil.copy(HASH_INDEX, HASH_INDEX + ".bak")
    print("Đã sao lưu:", HASH_INDEX + ".bak")

    with open(HASH_INDEX, encoding="utf8") as f:
        arr = json.load(f)

    changed = 0
    for x in arr:
        fid = x.get("id")
        if not fid:
            continue
        x["thumbnailUrl"] = direct_link(fid, 1000)
        x["downloadUrl"] = direct_link(fid, 1600)
        changed += 1

    with open(HASH_INDEX, "w", encoding="utf8") as f:
        json.dump(arr, f, ensure_ascii=False)

    print(f"Đã đổi link cho {changed} ảnh. Xong.")
    print("Tắt bot mở lại để dùng link mới.")


if __name__ == "__main__":
    main()
