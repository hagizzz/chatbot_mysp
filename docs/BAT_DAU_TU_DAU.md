# Bắt đầu từ đâu — bản đồ dự án cho người mới vào

Viết ngày 21/08/2026. Đọc file này trước, rồi mới đọc `README.md` (kỹ thuật)
và `KE_HOACH_TRIEN_KHAI_MYS.md` (kế hoạch 14 tuần).

---

## 1. Dự án này là gì

Có sẵn **một con bot đang chạy thật** cho shop MYS.P: khách nhắn vào Facebook,
bot đọc qua Pancake, tư vấn, nhận diện ảnh mẫu khách gửi, chốt đơn, đẩy đơn
sang Pancake POS. Nó đã chạy được, có log thật từ tháng 7/2026.

Việc đang làm **không phải viết bot mới**, mà là biến nó từ *"bot riêng của
một shop"* thành *"sản phẩm bán được cho nhiều shop"*. Khác nhau ở chỗ:

| Bot của một shop | Sản phẩm bán cho nhiều shop |
|---|---|
| Kịch bản nằm trong mã nguồn | Kịch bản sửa được qua trang quản trị |
| Một Page, một kho, một bộ thẻ | Mỗi shop một cấu hình riêng |
| Hỏng thì chủ shop tự biết | Phải tự phát hiện và báo động |
| Sửa gì cũng phải gọi lập trình viên | Shop tự làm được |

Kế hoạch: **121 người-ngày, 7 giai đoạn (GĐ0–GĐ7), 14 tuần, đội 2 người.**

---

## 2. Đang ở đâu

Xong **GĐ0** (nền kỹ thuật, 8 ngày) và **GĐ1** (ổn định + chạy song song,
10 ngày). Tức khoảng **18/121 người-ngày ≈ 15%**.

Những thứ đã có thật, không phải kế hoạch suông:

- **Bộ nhớ hội thoại chuyển sang SQLite** — nhanh hơn 199 lần (đo trên dữ liệu
  thật: 3.974ms → 20ms cho một lượt khách). Đây là lý do trước đây bot chỉ xử
  được 5 hội thoại mỗi nhịp 4 giây.
- **Xử lý song song** nhiều hội thoại cùng lúc, có giữ nhịp gọi Pancake để
  không bị chặn (429).
- **56 bài test tự động** — chạy `npm test`, xanh hết.
- **Giám sát** — bot đứng hình/im lặng/lỗi dày thì tự báo động.
- **Log từng lượt** — thống kê được % bot trả lời, % nhường người thật kèm lý
  do, và tiền AI tiêu mỗi tháng.

Trong lúc dựng đường chạy thử hôm nay còn tìm ra và vá **3 lỗi thật**:
1. Môi trường thử tưởng là an toàn nhưng **vẫn lên đơn thật** cho khách.
2. Thiếu thư viện ảnh thì **chết cả bot**, chứ không phải chỉ mất nhận diện ảnh.
3. Máy không có `python` thì **mỗi ảnh treo 60 giây**.

---

## 3. Đang thiếu gì

### A. Thiếu để chạy được — chặn ngay hôm nay

Thư mục này là **bản sao chép về từ máy shop, đã cố tình bỏ lại toàn bộ file
bí mật**. Dữ liệu thì đủ, chìa khoá thì không có cái nào.

| Thiếu | Hậu quả | Lấy ở đâu |
|---|---|---|
| `.env` | **Không chạy được gì cả** | Máy shop, cạnh `bot_worker_api_v3.js` |
| Thư viện Python | Không nhận diện được ảnh khách gửi | `pip install -r requirements.txt` |
| `google-service-account.json` | Mất tính năng "qua shop" và "đơn gấp" (đọc Google Sheet) | Máy shop |
| `fb_ads_tokens.json` | Không biết khách đến từ quảng cáo nào | Máy shop |

Đã có sẵn (không cần lo): chỉ mục ảnh 27MB, bảng băm ảnh 7.8MB, bộ nhớ 1495
hội thoại.

**Chỉ cần 3 dòng trong `.env`** là chat thử được: `OPENAI_API_KEY`,
`PANCAKE_PAGE_ID`, `PANCAKE_PAGE_ACCESS_TOKEN`. Phần POS và Google Sheet để
trống vẫn chạy — mà chạy thử thì cũng không muốn lên đơn thật.

### B. Thiếu quyết định — chặn công việc tiếp theo

Sáu câu trong mục 7 của kế hoạch. Không ai ngoài phía anh/chị trả lời được:

| # | Câu hỏi | Chặn cái gì |
|---|---|---|
| 1 | Trang quản trị làm riêng hay nhúng vào hệ thống của Hoà? | 15–20 người-ngày (GĐ3) |
| 2 | Hợp đồng API với hệ thống của Hoà | GĐ4 + GĐ6 |
| 3 | 6 tháng đầu bao nhiêu shop, bao nhiêu tin/ngày? | Chọn SQLite hay PostgreSQL |
| 4 | POS có trả lý do hoàn hàng không? | Tính năng 4.2 |
| 5 | Ngân sách AI mỗi tháng? | Chọn mô hình |
| 6 | Ảnh thật của khách cũ lấy từ đâu, ai duyệt? | Tính năng "ảnh khách thật" |

Câu 1 đã bàn: **làm riêng trước, nhúng sau** — trừ màn hình gợi ý bán tự động
thì phải đi thẳng vào hệ thống của Hoà ngay từ đầu.

### C. Thiếu đo lường — đang đoán mò

| Đang đoán | Sự thật là gì | Đo bằng cách nào |
|---|---|---|
| Ngưỡng nhận diện ảnh `0.80` / `0.04` | **Chưa từng ai đo** | `python tao_anh_thu.py 40` rồi `npm run do-anh` |
| Bộ ca vàng để phát lại | Mới có **68/200 ca** | `node test/thu_them_ca_vang.js 200` |
| Chạy song song có ổn không | **Chưa chạy lần nào trên máy thật** | Chạy thử bậc 3 |

---

## 4. Đề xuất — làm gì trước

Thứ tự này chọn theo nguyên tắc: **cái gì chặn nhiều thứ nhất thì làm trước.**

### Bước 1 — Lấy `.env` về (cần anh/chị · ~30 phút)

Đây là thứ chặn nhiều nhất. Không có nó thì không chat được, không đo được,
không chạy thử được — mọi thứ khác đứng lại.

Trên máy shop:
```
pm2 ls
pm2 info <tên tiến trình>      →  xem dòng "exec cwd"
```
`.env` nằm trong thư mục đó. Chép cả `google-service-account.json` và
`fb_ads_tokens.json` luôn thể.

*Không lấy được thì tạo mới cũng xong* — xem bảng ở mục 3A, mất chừng một giờ.

### Bước 2 — Cài thư viện Python (máy tự làm · ~20 phút, tải ~2.5GB)

```
pip install -r requirements.txt
```

### Bước 3 — Chat thử (sau bước 1 · ~5 phút)

```
copy .env.staging.example .env.staging
```
Điền `CHI_XU_LY_IDS=<id hội thoại của nick mình>` rồi bấm `chay_thu.bat`.
Bot **chỉ** đụng đúng hội thoại đó. Không lên đơn thật.

Diễn đủ một vòng: hỏi giá → gửi ảnh mẫu → chốt → cho địa chỉ → giục gửi gấp.

### Bước 4 — Đo ngưỡng nhận diện ảnh (sau bước 2 · máy tự chạy)

```
python tao_anh_thu.py 40
npm run do-anh
```
Bộ đo sẽ đề xuất cặp ngưỡng cho **số ca SAI bằng 0**. Điền vào `.env`.

### Bước 5 — Trả lời 6 câu ở mục 3B (cần anh/chị)

Không phải trả lời hết một lúc. Câu 3 (bao nhiêu shop) và câu 5 (ngân sách AI)
là gấp nhất, vì chúng quyết định kiến trúc của GĐ2 sắp làm.

### Bước 6 — Vào GĐ2 (15 người-ngày)

Tách kịch bản ra khỏi mã nguồn, dựng nền nhiều shop. Đây là giai đoạn biến
"bot của MYS.P" thành "sản phẩm". Không bị chặn bởi câu 1 và câu 2.

---

## 5. Nếu chỉ có 30 phút

Làm **bước 1**. Chỉ bước 1 thôi. Mọi thứ còn lại máy tự chạy được hoặc chờ
được, riêng `.env` thì không ai làm thay.
