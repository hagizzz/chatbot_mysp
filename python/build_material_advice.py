# -*- coding: utf-8 -*-
"""
Build material_advice.json từ file p.xlsx (sheet "Tư vấn chất liệu").
  - Cột B = tên chất liệu (có thể kèm tiếng Anh + chú thích trong ngoặc).
  - Cột D = CÂU TƯ VẤN gửi khách.
Khi khách hỏi chất gì -> bot tra câu tư vấn theo chất liệu của mã (catalog r[15], cột P),
khớp MỀM theo từ khoá. Nếu câu có cụm "chất này" -> thay bằng "chất <tên chất của mã>".

Output: material_advice.json
  {
    "rows": [ {"name","adv","keys":[...],"fam":"<từ-họ>"} ... ],
    "famDefault": { "lua": idx, "voan": idx, ... }   # đại diện cho mỗi "họ chất" khi khớp lỏng
  }
"""
import json, re, unicodedata
import openpyxl

SRC = "/mnt/user-data/uploads/Tu_van_chat_lieu_Mys_P__3_.xlsx"
OUT = "material_advice.json"

def fold(s):
    s = str(s or "").lower().strip()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("đ", "d").replace("Đ", "d")
    s = re.sub(r"[^a-z0-9\s/]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

# từ chung KHÔNG dùng làm khoá (quá mơ hồ)
STOP = {"silk","fabric","blend","va","vai","cao","cap","chung","mo","ta","can","ghi",
        "ro","ten","thuong","mai","xac","minh","mau","phoi","faux","pu","gia","with",
        "and","the","mix","tren","nen"}

# bảng "họ chất" -> từ khoá nhận diện (để fallback khi tên mã ngắn/khác cách viết)
FAMILIES = ["lua","to","voan","chiffon","organza","linen","lanh","doi","cotton","kate",
            "suiting","kaki","len","da","tweed","tuyt","visco","viscose","rayon","tencel",
            "lyocell","bamboo","ren","lace","satin","jacquard","gam","kim","denim","jean",
            "jersey","knit","thun","twill","cheo","scuba","nhung","tulle","luoi","mesh","peach"]

def leading_fam(folded):
    toks = folded.split()
    for t in toks:
        if t in FAMILIES:
            return t
    return toks[0] if toks else ""

def keys_from_name(name):
    """Sinh danh sách khoá đã fold từ tên cột B (cả phần Anh, phần ngoặc, các mảnh /)."""
    raw = str(name or "")
    # tách phần trong ngoặc ra để lấy chú thích tiếng Việt
    paren = re.findall(r"\(([^)]*)\)", raw)
    nonparen = re.sub(r"\([^)]*\)", " ", raw)
    chunks = []
    for part in re.split(r"[/]", nonparen):
        f = fold(part)
        if f: chunks.append(f)
    for p in paren:
        for part in re.split(r"[/,]", p):
            f = fold(part)
            if f: chunks.append(f)
    # thêm từng token có nghĩa (>=4 ký tự, không thuộc STOP)
    keys = set()
    for c in chunks:
        if 3 <= len(c) <= 40:
            keys.add(c)
        for tok in c.split():
            if len(tok) >= 4 and tok not in STOP:
                keys.add(tok)
            # giữ vài từ ngắn quan trọng
            if tok in ("to","da","len","ren","gam","kim","dui","doi","nhung","lanh","kate"):
                keys.add(tok)
    # bỏ khoá rác
    keys = {k for k in keys if k and k not in STOP and not k.isdigit()}
    # QUY ĐỔI Anh -> Việt: tên file mới gọn theo tiếng Anh, nhưng catalog (cột P) shop ghi tiếng Việt
    # ("Voan","Lụa","Ren","Lanh"...) -> thêm khoá tiếng Việt tương ứng để khớp được.
    EN2VI = {
        "chiffon": ["voan"], "voile": ["voan"], "voan": ["voan"],
        "silk": ["lua", "to"], "satin": ["satin"],
        "lace": ["ren"], "linen": ["lanh", "dui"],
        "denim": ["denim", "jean"], "jersey": ["thun"], "knit": ["det kim"],
        "twill": ["cheo"], "mesh": ["luoi"], "suede": ["da lon"],
        "tulle": ["tuyn"], "organza": ["to"], "scuba": ["scuba"],
        "kaki": ["kaki"], "cotton": ["cotton"], "kate": ["kate"],
        "len": ["len"], "gam": ["gam"], "nhung": ["nhung"], "tweed": ["tweed"],
    }
    add = set()
    for k in list(keys):
        for tok in k.split():
            if tok in EN2VI:
                for vi in EN2VI[tok]:
                    add.add(vi)
    keys |= add
    return sorted(keys, key=lambda x: (-len(x), x))

def clean_display(name):
    """Tên hiển thị gọn (phòng khi cần) — lấy đoạn trước ngoặc/dấu /."""
    raw = re.sub(r"\([^)]*\)", "", str(name or "")).strip()
    raw = re.split(r"[/]", raw)[0].strip()
    return raw

def main():
    wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
    ws = wb["Tư vấn chất liệu"]
    rows = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        if not r or not r[0] or len(r) < 4 or not r[3]:
            continue
        name = str(r[0]).strip()      # cột A = Chất liệu (layout file mới)
        adv  = str(r[3]).strip()      # cột D = câu tư vấn gửi khách
        if len(adv) < 5:
            continue
        f = fold(name)
        rows.append({
            "name": name,
            "display": clean_display(name),
            "adv": adv,
            "keys": keys_from_name(name),
            "fam": leading_fam(f),
        })

    # famDefault: đại diện mỗi họ = dòng đầu tiên (tên ngắn nhất) thuộc họ đó
    famDefault = {}
    for fam in FAMILIES:
        cand = [i for i,row in enumerate(rows) if row["fam"] == fam]
        if not cand:
            # tìm dòng có khoá == fam
            cand = [i for i,row in enumerate(rows) if fam in row["keys"]]
        if cand:
            cand.sort(key=lambda i: len(rows[i]["name"]))
            famDefault[fam] = cand[0]
    # gộp đồng nghĩa
    alias = {"jean":"denim","lanh":"linen","doi":"linen","lyocell":"tencel",
             "viscose":"visco","lace":"ren","cheo":"twill","luoi":"mesh"}
    for a,b in alias.items():
        if a not in famDefault and b in famDefault:
            famDefault[a] = famDefault[b]

    # ƯU TIÊN: tên chất 1 TỪ mơ hồ -> trỏ về dòng tư vấn ĐẠI DIỆN chuẩn (tránh đụng nhầm,
    # vd "Dạ" (vải dạ) khác "Da" (da thuộc); "Nhung" -> suiting nhung, không phải da nhung).
    def idx_of(exact_name):
        for i,row in enumerate(rows):
            if row["name"] == exact_name:
                return i
        return None
    OVERRIDE = {
        "lua":  "Raw Silk",
        "to":   "Tơ Xốp",
        "voan": "Silk Chiffon",
        "chiffon": "Silk Chiffon",
        "cotton":"Cotton Pima",
        "kate": "Kate",
        "denim":"Denim",
        "jean": "Denim",
        "len":  "Len",
        "da":   "Dạ / Dạ Mịn",
        "nhung":"Peach Skin Suiting",
        "ren":  "Lace",
        "lace": "Lace",
        "satin":"Satin",
        "gam":  "Gấm Tô Châu",
        "thun": "Jersey",
        "dui":  "Đũi Linen",
        "doi":  "Đũi Linen",
        "lanh": "Linen / Slub Linen / Textured Linen",
        "linen":"Linen / Slub Linen / Textured Linen",
        "tweed":"Dạ Tweed",
    }
    single = {}
    for k,nm in OVERRIDE.items():
        i = idx_of(nm)
        if i is not None:
            single[k] = i
            famDefault[k] = i   # đồng bộ cả fallback

    data = {"rows": rows, "famDefault": famDefault, "single": single}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    print(f"✅ Ghi {OUT}: {len(rows)} chất liệu, {len(famDefault)} họ fallback.")
    # vài ví dụ
    for i in (0,5,8,66):
        if i < len(rows):
            print(f"  [{i}] {rows[i]['name']!r} fam={rows[i]['fam']} keys={rows[i]['keys'][:5]}")

if __name__ == "__main__":
    main()
