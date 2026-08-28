# Kịch bản của shop — tất cả nằm ở đây

Thư mục này là **nơi duy nhất** chứa lời bot nói và luật nghiệp vụ. Trước 25/08/2026
luật nằm ở `kich_ban.txt` ngoài gốc dự án còn câu chữ nằm trong đây — hai nơi, hai
kiểu, và không chỗ nào tách được theo shop.

## Tệp nào chứa gì

| Tệp | Chứa gì | Ai sửa |
|---|---|---|
| `luat.txt` | **Luật nghiệp vụ GỐC** — quy tắc báo giá, gửi ảnh, ship, đổi trả… Mọi shop kế thừa | kinh doanh |
| `luat.<shopId>.txt` | Luật riêng của một shop. Có tệp này thì bot dùng nó **thay cho** `luat.txt` | kinh doanh |
| `mac_dinh.json` | **Câu nói GỐC** có khoá. Mọi shop kế thừa | kinh doanh |
| `<shopId>.json` | Câu riêng của shop — **đè lên** `mac_dinh.json` theo từng khoá | kinh doanh |
| `khong_rut.txt` | Câu KHÔNG được rút về kho (công cụ `rut_kich_ban.js` bỏ qua) | lập trình viên |

### Bốn ngăn trong tệp JSON

| Ngăn | Chứa gì | Shop đè được? | Sheet đè được? |
|---|---|---|---|
| `cau` | câu nói với khách | ✅ | ✅ |
| `so_lieu` | số liệu kinh doanh — số tài khoản, showroom, bảng size | ✅ | ❌ gõ nhầm số tài khoản là tiền chạy đi nơi khác |
| `cai_dat` | **công tắc hành vi** — bật tắt bám khách, tách tin, chế độ AI | ✅ | ❌ đổi cách chạy của cả bot, không phải một câu |
| `prompt` | luật dạy AI | ❌ sửa sai một dòng là bot lệch toàn bộ | ❌ |

### Công tắc hành vi (`cai_dat`)

Trước 25/08/2026 tám công tắc này nằm trong `.env` — mà `.env` là của **cả tiến trình**,
nên hai shop chạy chung hệ thống thì không shop nào có công tắc riêng. Và kinh doanh
muốn tắt bám khách phải mở tệp chứa mật khẩu.

```json
"cai_dat": {
  "BAM_KHACH": "on",
  "BAM_KHACH_LAN1_PHUT": 10,
  "BAM_KHACH_LAN2_GIO": 2,
  "BAM_KHACH_SO_LAN": 2,
  "TACH_TIN": "on",
  "SIET_NHAN_VIEN_TRA_LOI": "off",
  "MO_MAN_MODE": "on"
}
```

Thứ tự ưu tiên: **`<shopId>.json` › `mac_dinh.json` › `.env` › mặc định trong mã.**

`.env` đứng SAU là có chủ ý — shop chưa khai gì thì mọi thứ chạy y như trước.
`mac_dinh.json` **cố ý để trống** ngăn này: khai giá trị ở gốc là ép cho *mọi* shop
và vô hiệu hoá `.env` của họ.

| Công tắc | Nghĩa |
|---|---|
| `BAM_KHACH` | bật/tắt nhắc lại khách bỏ giữa chừng |
| `BAM_KHACH_LAN1_PHUT` | khách im bao nhiêu phút thì nhắc lần đầu |
| `BAM_KHACH_LAN2_GIO` | nhắc lần hai sau bao nhiêu giờ |
| `BAM_KHACH_SO_LAN` | tối đa mấy lần nhắc một hội thoại (trần 5) |
| `TACH_TIN` | tách câu báo giá + size + liên hệ thành nhiều tin |
| `SIET_NHAN_VIEN_TRA_LOI` | `on` = bot chỉ nhận lại khi nhân viên **đã trả lời** và đã gỡ thẻ |
| `MO_MAN_MODE` | nhịp mở màn: giá + 3 ảnh trước mọi thứ khác |
| `AI_REPLY_MODE` | `off` / `shadow` / `on` — cho AI tự soạn câu tư vấn hay không |

`<shopId>` lấy từ biến môi trường `SHOP_ID` (mặc định `mysp`).

## Thêm một shop mới

Không sửa một dòng mã nào:

```bash
SHOP_ID=shopmoi
```

rồi tạo hai tệp — **cả hai đều tuỳ chọn**:

```
kich_ban/luat.shopmoi.txt     luật nghiệp vụ riêng
kich_ban/shopmoi.json         câu nói riêng
```

Thiếu tệp nào thì shop đó dùng bản gốc của tệp ấy. Shop mới chưa khai gì vẫn chạy
được ngay bằng kịch bản gốc — đúng yêu cầu mục 9.2 (*"có bộ kịch bản mẫu để shop mới
bắt đầu ngay, rồi sửa dần theo ý họ"*).

## Bốn tầng, tầng trên đè tầng dưới

```
1. tab AI AGENT (Google Sheet)   kinh doanh sửa nóng, không cần đè bản mới
2. kich_ban/<shopId>.json        riêng từng shop
3. kich_ban/mac_dinh.json        gốc
4. phom code tại chỗ gọi         lưới đỡ cuối, KHÔNG BAO GIỜ để bot câm
```

## Hai ngăn trong tệp JSON, quyền khác nhau

- **`cau`** — câu nói với khách. Shop sửa được, Sheet đè được.
- **`prompt`** — luật dạy AI. Sửa sai một dòng là bot lệch **toàn bộ** chứ không phải
  sai một câu, nên shop **không đè được** (loader chặn cứng). Chỉ `mac_dinh.json` đổi được.

## Sửa xong có phải khởi động lại bot không

| Sửa gì | Có hiệu lực |
|---|---|
| `mac_dinh.json`, `<shopId>.json` | tự nạp lại sau **5 phút**, không cần restart |
| Google Sheet tab `AI AGENT` | như trên |
| `luat.txt`, `luat.<shopId>.txt` | theo nhịp nạp của `knowledge_loader` |
| Công tắc trong `.env` | **phải khởi động lại bot** |

## Trước khi phát hành

```bash
npm test              # có test canh kho không hụt khoá, không lệch biến
npm run soi-kich-ban  # soi mâu thuẫn giữa luật và câu code thật sự nói
```

Bộ soi đọc các luật máy kiểm được ra khỏi `luat.txt` (kiểu `Không dùng từ "X"`, khai
tên bot) rồi soi ngược lại trên chính những câu bot sẽ nhắn khách.

## Đọc thêm

- `docs/KICH_BAN_O_DAU.md` — vì sao có kho này, còn bao nhiêu câu chưa rút
- `docs/YEU_CAU_TINH_NANG.txt` — mục 5 (nơi đặt câu lệnh) và mục 9 (đóng gói bán ra ngoài)
