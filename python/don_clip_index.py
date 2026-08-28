# -*- coding: utf-8 -*-
# ============================================================
# DON "SO VECTOR" NHAN DIEN ANH (clip_index.npz)
# ------------------------------------------------------------
# Van de: index bi PHINH - vai mau co 90-126 anh (vd Meridian 110 anh) ->
# tro thanh "NAM CHAM" hut anh khach vao nham mau. Avg chi ~17 anh/ma.
# Cach xu ly (KHONG can build lai, GIU nguyen vector da co):
#   1) Bo cac entry MA RAC (ten file khong co ma that: rong / PHOTOREALISTIC / QUALITY...)
#   2) GIOI HAN moi ma toi da MAX_PER_CODE anh -> can bang lai, het nam cham.
#   * GIU LAI anh AI (-AI) vi co 167 ma CHI co anh AI, bo di se mat nhan dien.
#
# CHI anh huong NHAN DIEN ANH. KHONG dung toi viec GUI ANH cho khach
# (gui anh dung hash_index.json, khong dung file nay).
#
# CACH CHAY (tat bot truoc):
#   cd /d C:\AI_HTK_BOT_V5
#   python don_clip_index.py
# Xong -> mo lai bot.
# (Tu dong tao clip_index.npz.bak de phong ho. Muon quay lai: doi .bak ve .npz.)
# ============================================================
import os
import sys
import shutil
from collections import defaultdict

import numpy as np

INDEX = "clip_index.npz"
MAX_PER_CODE = 30   # so anh toi da giu cho MOI ma (giam nam cham). Muon chat hon: ha xuong 20.

# Cac "ma" rac do tach nham tu ten file anh AI (khong phai ma san pham).
GARBAGE = {
    "", "PHOTOREALISTIC", "QUALITY", "PHOTO", "IMAGE", "IMG",
    "PORTRAIT", "REALISTIC", "RENDER", "HD", "4K", "AI", "A", "AN", "THE", "THIS",
}


def main():
    if not os.path.exists(INDEX):
        print("Khong thay", INDEX, "trong thu muc hien tai.")
        sys.exit(1)

    shutil.copy(INDEX, INDEX + ".bak")
    print("Da sao luu:", INDEX + ".bak")

    d = np.load(INDEX, allow_pickle=True)
    if "embeddings" not in d or "meta" not in d:
        print("File index khong dung dinh dang (thieu embeddings/meta).")
        sys.exit(1)
    emb = d["embeddings"]
    meta = d["meta"]
    metas = [m.item() if hasattr(m, "item") else m for m in meta]

    keep = []
    per_code = defaultdict(int)
    n_garbage = n_cap = 0
    for i, m in enumerate(metas):
        code = str(m.get("code") or "").upper().strip()
        if code in GARBAGE:
            n_garbage += 1
            continue
        if per_code[code] >= MAX_PER_CODE:
            n_cap += 1
            continue
        per_code[code] += 1
        keep.append(i)

    keep = np.array(keep, dtype=int)
    emb2 = emb[keep]
    meta2 = meta[keep]

    # Luu LAI dung dinh dang (embeddings + meta) de bot doc duoc nhu cu.
    np.savez_compressed(INDEX, embeddings=emb2, meta=meta2)

    print(f"Truoc:  {len(metas):>6} anh")
    print(f"Sau:    {len(keep):>6} anh")
    print(f"  - bo {n_garbage} anh MA RAC (ten khong co ma san pham)")
    print(f"  - bo {n_cap} anh vuot gioi han {MAX_PER_CODE} anh/ma (het nam cham)")
    print(f"  - so MA con lai: {len(per_code)}")
    print("XONG. Tat bot -> chay xong file nay -> mo lai bot.")
    print("Muon hoan tac: xoa clip_index.npz, doi ten clip_index.npz.bak thanh clip_index.npz.")


if __name__ == "__main__":
    main()
