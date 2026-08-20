# KẾ HOẠCH TRIỂN KHAI — Chatbot tư vấn bán hàng (MYS)

> Đối chiếu giữa `Yeu-cau-tinh-nang-Chatbot-MYS.pdf` (7 trang, 11 mục) và mã nguồn hiện có tại
> `C:\Users\Admin\Documents\chatbot`. Lập ngày 19/08/2026.

---

## 1. Kết luận ngắn

Bot hiện tại **làm tốt phần lõi bán hàng cho một shop** (hiểu ý khách, nhận diện ảnh, chuẩn hoá địa chỉ,
tự lên đơn POS, nhận mẫu từ quảng cáo/bình luận). Đó là khoảng **55–60% khối lượng của mục 2, 3 và 4**
trong bản yêu cầu.

Phần còn thiếu **không phải là thêm tính năng, mà là đổi hình dạng sản phẩm**: từ *một bot chạy cho shop
MYS.P* thành *một sản phẩm nhiều shop cùng dùng, tự cấu hình, đo đếm được*. Cụ thể là các mục 5, 6, 9, 10
và một phần mục 4 và 7 — hiện gần như chưa có gì.

**Ước lượng: 101 người-ngày công việc + 20% dự phòng ≈ 121 người-ngày.**

| Đội hình | Thời gian hoàn thành toàn bộ | Mốc bán được bản thương mại đầu tiên |
|---|---|---|
| 1 lập trình viên | ~24 tuần (6 tháng) | tuần 16 |
| 2 người (1 backend + 1 frontend) | ~14 tuần (3,5 tháng) | tuần 9 |
| 3 người (2 backend + 1 frontend) | ~10 tuần (2,5 tháng) | tuần 6–7 |

Kế hoạch dưới đây viết theo **đội 2 người, 14 tuần**.

---

## 2. Hiện trạng mã nguồn (khảo sát thực tế)

**Đang có và chạy được:**

| Hạng mục | Chi tiết |
|---|---|
| Lõi tư vấn | `bot_worker_api_v3.js` — 12.739 dòng (952 KB), 1 tiến trình Node.js |
| Hiểu ý khách | 3 tầng như tài liệu `QUY_TRINH_HYBRID.md`: regex chấm độ chắc (`intent_router.js`) → AI nhả nhãn (`ai_intent.js`, `ai_quyet.js`) → code hành động (`reasoning_engine.js`) |
| Nhận diện ảnh | CLIP embedding (`clip_index.npz` 27 MB) + perceptual hash (`hash_index.json` 8 MB) + OCR tiếng Việt (tesseract). Worker Python chạy bất đồng bộ |
| Địa chỉ | `vn_address.js` + danh mục hành chính 2025 (`vn_wards_2025.json`), khớp về danh mục của POS |
| Lên đơn tự động | `order_worker.js` chạy riêng: quét thẻ "AI chốt" → tạo đơn POS, chống trùng bằng `orders_state.json` |
| Nguồn tin nhắn | Nhận `ad_id`/`post_id`, tự học bản đồ quảng cáo → mẫu (`fb_ads.js`, `ad_learned_map.json`, đồng bộ 4 giờ/lần) |
| Đa Page | `page_registry.js` — 1 tiến trình phục vụ nhiều Page Facebook, suy token theo hội thoại |
| Kịch bản ngoài code | Nạp từ 1 Google Doc + tab "AI AGENT" của 1 Google Sheet (`knowledge_loader.js`) |

**Những điểm yếu nền tảng phải xử lý trước khi làm tính năng mới:**

1. **Không có quản lý phiên bản.** Không phải kho git. Quy trình phát hành hiện tại là *chép đè file* — trong
   thư mục có ~40 file `SUA_LOI_v*.txt` / `HUONG_DAN_*.txt` mô tả từng lần vá tay. Bán ra ngoài mà giữ cách
   này thì không thể vá lỗi cho nhiều shop.
2. **Không có bộ kiểm thử.** Mỗi lần sửa monolith 12.7k dòng là một lần đánh cược với các ca đang chạy tốt.
3. **Xử lý tuần tự.** Vòng lặp poll 4 giây, khoá `isRunning`, tối đa 5 hội thoại mỗi nhịp, chạy nối tiếp
   nhau. → **Chưa đạt tiêu chí "một khách gửi ảnh không làm chậm khách khác"** (mục 3.9 và mục 11).
4. **Bộ nhớ hội thoại lưu bằng file JSON.** `state_manager.js` đọc *toàn bộ* `conversation_memory.json`
   (850 KB) rồi ghi lại *toàn bộ* mỗi lần đọc/ghi một hội thoại. Càng nhiều khách càng chậm, và không an
   toàn khi có nhiều tiến trình cùng ghi.
5. **Mọi thứ đều gắn cứng vào shop MYS.P.** ID Google Doc/Sheet, ID thẻ (182, 183, 185, 205, 206, 174…),
   số tài khoản, địa chỉ showroom, hàng trăm câu thoại tiếng Việt nằm thẳng trong code. → Không thể giao
   cho shop thứ hai.
6. **Không đo được gì.** Không đếm tin bot trả, không đếm ca nhường người thật, không đo token/chi phí AI
   (đang dùng `gpt-4.1-mini` ở 3 điểm gọi).

---

## 3. Đối chiếu yêu cầu ↔ hiện trạng

| Mục trong PDF | Hiện trạng | Trạng thái | Xử lý ở |
|---|---|---|---|
| 2. Nguyên tắc không được phá | Đã bám sát: chắc mới trả lời, không bịa, bám 1 sản phẩm, không hỏi lại, chốt đủ 4 thông tin, giao người thật ở ca nhạy cảm | **Có** | Giữ, biến thành bộ test |
| 3.1 Hiểu đúng ý khách (3 bước) | Đủ 3 tầng, AI chỉ nhả nhãn cố định | **Có** | — |
| 3.2 Nhớ thông tin khách | Có, nhưng lưu bằng file JSON toàn phần | **Một phần** | GĐ0 |
| 3.3 Ngừng khi có thẻ chờ xử lý | Có (thẻ 183/185/166/177) | **Có** | — |
| 3.4 Nhận diện ảnh | Có CLIP + hash + OCR; **chưa từng đo độ chính xác** trên ảnh cắt/chụp màn hình/mờ | **Một phần** | GĐ1 |
| 3.5 Nhận diện nguồn tin | Nhận được nguồn; **chưa có ký hiệu nguồn hiển thị cho nhân viên** | **Một phần** | GĐ1 |
| 3.6 Báo giá & tư vấn size | Có | **Có** | — |
| 3.7 Xử lý địa chỉ | Có, khớp danh mục vận chuyển | **Có** | — |
| 3.8 Lên đơn tự động | Có, tín hiệu chốt = gắn thẻ "AI chốt" | **Có** | Chuẩn hoá thành sự kiện ở GĐ2 |
| 3.9 Không làm chậm nhau | Xử lý tuần tự 5 hội thoại/nhịp | **Chưa** | GĐ1 |
| 4.1 Size từ số đo + lịch sử mua | Chỉ có bảng size theo cân nặng | **Chưa** | GĐ5 |
| 4.2 Giảm tỷ lệ hoàn | Không có dữ liệu hoàn | **Chưa** | GĐ5 |
| 4.3 Nhận ra khách quen | Không có hồ sơ khách | **Chưa** | GĐ5 |
| 4.4 Ảnh thật của khách đã mua | Không có kho ảnh feedback | **Chưa** | GĐ5 |
| 4.5 Nhắc lại khách bỏ giữa chừng | Có cơ chế nhắc 15 giây/2 giờ nhưng **gắn cứng trong code**, shop không cấu hình được | **Một phần** | GĐ5 |
| 5. Nơi đặt câu lệnh & kịch bản | 1 Google Doc + 1 tab Sheet dùng chung; không phiên bản, không quay lui, không sandbox | **Một phần** | GĐ2 + GĐ3 |
| 6. Thẻ hội thoại | ID thẻ gắn cứng; shop không tự tạo/dạy bot gắn thẻ được | **Chưa** | GĐ4 |
| 7. Xác nhận chuyển khoản | Mọi ca chuyển khoản đều giao người thật | **Chưa** | GĐ6 |
| 8. Kết nối hệ thống của Hoà | Chưa có hợp đồng API | **Chưa** | GĐ0 (chốt) → GĐ4/6 |
| 9.1 Tách dữ liệu theo shop | Không có khái niệm shop | **Chưa** | GĐ2 |
| 9.2 Shop mới tự bắt đầu | Không | **Chưa** | GĐ3 + GĐ7 |
| 9.3 Bật tắt theo shop/Page + hạn mức dùng thử | Không | **Chưa** | GĐ3 |
| 9.4 Thống kê giá trị bot | Không | **Chưa** | GĐ6 |
| 9.5 Chi phí AI theo shop | Không | **Chưa** | GĐ6 |
| 10. Chế độ bán tự động | Không | **Chưa** | GĐ4 |

---

## 4. Chiến lược: bọc và rút lõi, không viết lại

Bot đang chạy ra tiền. Viết lại từ đầu là bỏ đi hai năm kinh nghiệm bán hàng đã được mã hoá thành hàng trăm
nhánh xử lý — và mất doanh thu trong lúc làm. Cách làm đề xuất:

1. **Dựng lưới an toàn trước** (git, bộ test phát lại hội thoại thật) rồi mới đụng vào lõi.
2. **Giữ nguyên động cơ**, đưa mọi thứ riêng của shop MYS.P ra ngoài thành *gói cấu hình theo shop*. Mỗi câu
   thoại rút ra đều để lại bản mặc định trùng khít câu cũ → rút xong bot vẫn trả lời y hệt hôm nay.
3. **Rút theo nhóm nhãn ý định**, mỗi đợt một nhóm, chạy test hồi quy sau mỗi đợt. Không rút một lần.
4. **Tính năng mới viết thành module riêng**, không nhồi tiếp vào `bot_worker_api_v3.js`.

Nguyên tắc mục 2 của bản yêu cầu được **biến thành test tự động**, không phải lời hứa: mỗi lần phát hành đều
phải chứng minh "không bịa", "không hỏi lại thông tin đã có", "chốt đủ 4 thông tin", "ca nhạy cảm luôn giao
người thật".

---

## 5. Kế hoạch theo giai đoạn

### GĐ0 — Nền kỹ thuật · 8 người-ngày · tuần 1–2

*Không có giai đoạn này thì mọi giai đoạn sau đều là đánh cược.*

- Đưa mã nguồn vào git; tách bí mật ra `.env`; viết `README` chạy được từ máy trắng; dựng môi trường thử
  (staging) tách khỏi máy đang chạy thật.
- **Bộ test phát lại**: trích 150–200 hội thoại thật từ `conversation_memory.json` và `log.txt` thành bộ ca
  vàng, chạy offline, so nhãn ý định + câu trả lời + hành động. Đây là tài sản quan trọng nhất của giai đoạn.
- Chuyển bộ nhớ hội thoại từ file JSON sang cơ sở dữ liệu (SQLite trước, cấu trúc sẵn để lên PostgreSQL khi
  nhiều shop); viết script chuyển dữ liệu cũ.
- Ghi log có cấu trúc cho mọi lượt: tin vào, nhãn, hành động, thẻ, lý do nhường người thật, token vào/ra.
  → là nền cho mục 9.4 và 9.5 sau này.
- **Chốt hợp đồng API với hệ thống của bạn Hoà** (mục 8): gửi tin, gắn/gỡ thẻ, khung gợi ý bán tự động, kết
  quả đối soát chuyển khoản, sự kiện chốt đơn. Chốt xong, hai bên tự làm với dữ liệu giả, không chờ nhau.

**Đầu ra:** sửa code mà biết ngay có vỡ gì không; số liệu bắt đầu chảy.

### GĐ1 — Ổn định và song song · 10 người-ngày · tuần 3–4

- **Xử lý song song theo hội thoại**: khoá theo `conversationId`, chạy 5–10 hội thoại đồng thời, có bộ điều
  tiết nhịp theo từng Page để không dính 429 của Pancake. Việc nhận diện ảnh đẩy sang hàng đợi riêng.
  → đạt tiêu chí "một khách gửi ảnh không làm chậm khách khác".
- Chuyển sang nhận webhook (đã có sẵn `pullWebhookIds`), giữ poll làm lưới dự phòng → phản hồi nhanh hơn,
  ít gọi thừa hơn.
- Giám sát: tự khởi động lại khi chết, cảnh báo khi bot im quá N phút hoặc tỉ lệ lỗi vượt ngưỡng.
- **Ký hiệu nguồn hội thoại** (mục 3.5, tiêu chí bắt buộc): mỗi hội thoại được gắn dấu *từ quảng cáo / từ
  bình luận / nhắn thẳng* để nhân viên nhìn là biết.
- **Đo độ nhận diện ảnh**: dựng bộ ảnh thử (ảnh cắt, ảnh chụp màn hình, ảnh chụp lại từ điện thoại, ảnh mờ,
  ảnh lệch màu), đo tỉ lệ đúng/sai/không quyết, đặt ngưỡng — dưới ngưỡng thì giao người thật.

**Đầu ra:** đạt phần lớn tiêu chí vận hành ở mục 11.

### GĐ2 — Tách kịch bản khỏi code, dựng nền nhiều shop · 15 người-ngày · tuần 5–7

*Đây là giai đoạn quyết định việc bán được hay không (mục 5 + 9.1 + 9.2).*

- Mô hình dữ liệu: **shop → page → hội thoại**. Mọi bảng có `shop_id`, mọi truy vấn bắt buộc lọc theo
  `shop_id`, có test tự động chứng minh không có đường nào đọc chéo dữ liệu shop khác.
- **Gói cấu hình shop** có phiên bản: giọng văn/persona, kịch bản theo giai đoạn hội thoại, câu mẫu theo từng
  nhãn ý định, danh sách nhãn, luật gắn thẻ, chính sách (ship, đổi trả, số tài khoản, showroom), công tắc
  từng tính năng, các ngưỡng.
- Rút câu thoại gắn cứng ra template theo từng nhóm nhãn (mỗi câu có khoá riêng + bản mặc định = câu hiện tại).
- **Quy tắc ưu tiên rõ ràng** (yêu cầu riêng của mục 5): luật cứng (mục 2) > cấu hình shop > kịch bản >
  mặc định. Viết thành tài liệu một trang cho người dùng: viết gì, ở đâu, thì bot hiểu.
- Lưu phiên bản cũ + quay lui; nhật ký ai sửa gì lúc nào.
- **Sandbox thử nghiệm**: gõ một câu khách mẫu → hiện nhãn nhận ra, câu bot định trả, hành động và thẻ sẽ
  gắn — không gửi cho khách.
- Chuẩn hoá tín hiệu chốt đơn thành sự kiện có cấu trúc thay vì chỉ dựa vào thẻ.

**Đầu ra:** shop thứ hai chạy được trên cùng hệ thống, dữ liệu và kịch bản tách bạch hoàn toàn.

### GĐ3 — Trang quản trị · 20 người-ngày (5 backend + 15 frontend) · tuần 5–9, song song GĐ2

> **Cần chốt trước:** làm trang riêng hay nhúng vào hệ thống quản trị hội thoại của bạn Hoà. Quyết định này
> ảnh hưởng trực tiếp 15–20 người-ngày.

Các màn hình:

- Đăng nhập, phân quyền, chọn shop/Page
- **Kịch bản & câu lệnh**: soạn thảo, xem phiên bản, quay lui, thử nghiệm trước khi áp dụng
- **Danh mục sản phẩm**: shop tự nối Google Sheet hoặc POS của họ
- **Thẻ**: thẻ hệ thống (đổi tên/màu, không xoá được) và thẻ shop (tự tạo, tự xoá)
- **Chế độ**: tự động / bán tự động / tắt — theo shop và theo từng Page
- **Bám khách**: bật tắt, mốc nhắc lần 1 và lần 2, nội dung từng câu, số lần tối đa, điều kiện ngừng nhắc
- **Hạn mức**: số tin dùng thử miễn phí, ngưỡng chi phí AI, hành vi khi vượt
- **Thống kê** và **chi phí AI** (dữ liệu thật đổ về ở GĐ6)

### GĐ4 — Chế độ bán tự động + thẻ theo shop · 8 người-ngày · tuần 8–9

- Ba chế độ chuyển được theo shop và theo Page: **tự động / bán tự động / tắt**.
- Chế độ bán tự động: sinh **2–3 phương án trả lời**, đẩy sang hệ thống quản trị để nhân viên chọn.
  **Không bao giờ tự gửi.**
- Ghi nhận nhân viên có dùng gợi ý không, sửa nhiều hay ít → chỉ số chất lượng bot.
- Thẻ hệ thống (cần người thật xử lý / ảnh không nhận diện được / tình huống nhạy cảm): đổi được tên và màu,
  không xoá được. Thẻ shop: tự tạo không giới hạn.
- **Dạy bot gắn thẻ**: shop khai "gặp ý định X thì gắn thẻ Y", bot làm theo, không cần lập trình viên.

**Mốc thương mại: hết tuần 9 đã có bản bán được** — nhiều shop, tự sửa kịch bản, tự quản thẻ, bật tắt theo
Page, có chế độ bán tự động cho shop chưa tin bot.

### GĐ5 — Năm tính năng tạo khác biệt · 22 người-ngày · tuần 10–13

| Tính năng | Việc cần làm | Ngày |
|---|---|---|
| 4.1 Size từ số đo + lịch sử mua | Hồ sơ khách theo số điện thoại: chiều cao, cân nặng, số đo, mẫu + size đã mua; đối chiếu form mẫu (dùng cột khoá/độ co giãn đã có trong sheet); không chắc thì vẫn hỏi | 5 |
| 4.2 Giảm tỷ lệ hoàn | Nạp đơn hoàn từ POS + lý do hoàn → thống kê theo mẫu → luật tư vấn chủ động (hay hoàn vì chật → nhắc lên size; hay hoàn vì chê chất → tả chất kỹ từ đầu); báo cáo tỉ lệ hoàn trước/sau khi dùng bot | 5 |
| 4.3 Nhận ra khách quen | Nhận diện theo số điện thoại/psid, số lần mua, gu màu – kiểu – tầm giá, phản hồi lần trước; nhánh tư vấn riêng cho khách quen | 4 |
| 4.4 Ảnh thật của khách cũ | Kho ảnh feedback theo mã (tải lên từ trang quản trị + gom từ hội thoại, phải duyệt trước khi dùng); quy định che mặt/xin phép; gửi ngay khi khách hỏi | 4 |
| 4.5 Bám khách cấu hình được | Tổng quát hoá cơ chế nhắc hiện có thành lịch nhắc do shop khai: thời điểm, nội dung, số lần, điều kiện dừng; chống nhắc ngoài cửa sổ 24 giờ | 4 |

> **Rủi ro dữ liệu:** 4.2 phụ thuộc việc POS có trả *lý do hoàn* hay không. Nếu không có, phải để nhân viên
> nhập lý do khi nhận hàng hoàn — cần chốt sớm.

### GĐ6 — Đối soát chuyển khoản, thống kê, chi phí · 8 người-ngày · tuần 12–13

- **Chuyển khoản (mục 7):** bot chỉ *đọc kết quả đối soát* từ hệ thống của Hoà, không tự tra ngân hàng.
  Khớp chắc chắn và đủ tiền → xác nhận với khách, chuyển đơn sang đã thanh toán. Chưa thấy tiền → báo khách
  chờ rồi kiểm tra lại. Chờ quá lâu, thiếu, thừa, không khớp → giao người thật.
- **Thống kê (mục 9.4):** số tin bot trả thay nhân viên, số hội thoại bot xử lý trọn vẹn, số đơn phát sinh từ
  hội thoại có bot, số ca nhường người thật kèm lý do.
- **Chi phí AI (mục 9.5):** đo token theo từng shop, quy ra tiền, đặt hạn mức và tự chặn khi vượt; ghép với
  hạn mức dùng thử ở GĐ3.

### GĐ7 — Đóng gói và chạy thử với shop ngoài · 10 người-ngày · tuần 14

- Luồng tự phục vụ cho shop mới: nối Page → nối danh mục → chọn bộ kịch bản mẫu → chỉnh giọng văn → bật bot
  ở chế độ bán tự động.
- **Bộ kịch bản mẫu ngành thời trang** để shop mới dùng được ngay.
- Kiểm thử cách ly hai shop (test tự động, không kiểm tay).
- Soát đủ **27 tiêu chí ở mục 11** trên môi trường thật.
- Chạy thử với một shop ngoài, tài liệu hướng dẫn + video ngắn.

---

## 6. Lịch tổng (đội 2 người)

| Tuần | Backend | Frontend |
|---|---|---|
| 1–2 | GĐ0 nền kỹ thuật | Dựng khung trang quản trị, thiết kế màn hình |
| 3–4 | GĐ1 ổn định + song song | GĐ3 màn hình kịch bản, danh mục |
| 5–7 | GĐ2 tách kịch bản, nền nhiều shop | GĐ3 thẻ, chế độ, bám khách, hạn mức |
| 8–9 | GĐ4 bán tự động + thẻ theo shop | GĐ3 hoàn tất + sandbox thử nghiệm |
| 10–11 | GĐ5 tính năng 4.1, 4.3 | GĐ5 giao diện hồ sơ khách, kho ảnh thật |
| 12–13 | GĐ5 tính năng 4.2, 4.4, 4.5 + GĐ6 | GĐ6 màn thống kê + chi phí |
| 14 | GĐ7 đóng gói, pilot, nghiệm thu 27 tiêu chí | Tài liệu hướng dẫn |

**Hai mốc đáng nhớ:** hết tuần 4 — bot đạt chuẩn vận hành (ổn định, song song, có ký hiệu nguồn).
Hết tuần 9 — có bản bán được cho shop ngoài.

---

## 7. Việc cần chốt trước khi bắt đầu

1. **Trang quản trị làm riêng hay nhúng vào hệ thống của bạn Hoà?** (ảnh hưởng 15–20 người-ngày)
2. **Hợp đồng API với hệ thống của Hoà** — chốt trong tuần 1–2, chậm nhất tuần 3, gồm: gửi tin, gắn/gỡ thẻ,
   khung gợi ý bán tự động, kết quả đối soát chuyển khoản, sự kiện chốt đơn.
3. **Quy mô dự kiến 6 tháng đầu**: bao nhiêu shop, bao nhiêu tin mỗi ngày → quyết định một tiến trình chung
   hay tách tiến trình theo shop, và chọn SQLite hay PostgreSQL.
4. **POS có trả lý do hoàn không?** Nếu không thì ai nhập (ảnh hưởng tính năng 4.2).
5. **Ngân sách AI mỗi tháng** và có cần đổi/so sánh mô hình không (hiện dùng `gpt-4.1-mini`).
6. **Nguồn ảnh thật của khách cũ**: lấy từ đâu, ai duyệt, có xin phép khách không.

---

## 8. Rủi ro chính

| Rủi ro | Mức | Cách giảm |
|---|---|---|
| Sửa monolith 12.7k dòng làm vỡ ca đang chạy tốt | Cao | Bộ test phát lại ở GĐ0 trước khi đụng vào lõi; rút câu thoại theo từng nhóm nhỏ |
| Pancake bóp nhịp (429) khi chạy song song | Trung bình | Bộ điều tiết theo Page + giãn nhịp luỹ tiến (đã có sẵn cơ chế) |
| Tiến độ phụ thuộc hệ thống của bạn Hoà | Trung bình | Chốt hợp đồng API sớm, làm với dữ liệu giả, có lớp adapter để đổi |
| Độ nhận diện ảnh chưa từng được đo | Trung bình | Đo trước ở GĐ1, đặt ngưỡng; dưới ngưỡng thì giao người thật |
| Dữ liệu khách (số đo, ảnh, lịch sử mua) giữa các shop | Cao (pháp lý + niềm tin) | Tách theo `shop_id` từ tầng dữ liệu, có test chứng minh; quy định duyệt ảnh trước khi dùng |
| Ước lượng trượt do yêu cầu phát sinh | Trung bình | Đã cộng 20% dự phòng; ưu tiên mốc tuần 9 (bán được) trước tính năng nâng cao |

---

## 9. Bảng đối chiếu 27 tiêu chí nghiệm thu (mục 11)

| Nhóm tiêu chí | Giai đoạn phủ |
|---|---|
| Chạy ổn định, không tự sập; nhiều ảnh vẫn trả đủ; một khách không làm chậm khách khác | GĐ1 |
| Nhận đúng mẫu từ quảng cáo/bình luận; ký hiệu nguồn rõ ràng; độ nhận diện ảnh cao | GĐ1 |
| Không hỏi lại thông tin đã có; ngừng khi có thẻ chờ; chốt đủ 4 thông tin; địa chỉ thiếu vẫn tra ra; tự lên đơn | Đã có — chuyển thành test tự động ở GĐ0 |
| Tự sửa câu lệnh/kịch bản, áp dụng ngay, quay lui được; có quy tắc bot đọc gì | GĐ2 + GĐ3 |
| Shop tự tạo thẻ và dạy bot gắn thẻ; thẻ hệ thống không xoá được | GĐ4 |
| Ba chế độ tự động / bán tự động / tắt; gợi ý 2–3 phương án, không tự gửi | GĐ4 |
| Tư vấn size theo số đo và lịch sử; nhận ra khách quen; gửi ảnh thật khách cũ; bám khách cấu hình được; thống kê tỉ lệ hoàn | GĐ5 |
| Khớp chuyển khoản thì xác nhận, không chắc thì giao người thật | GĐ6 |
| Hai shop không thấy dữ liệu của nhau; shop mới tự nối danh mục và sửa kịch bản | GĐ2 + GĐ7 |
| Thống kê số tin bot xử lý và chi phí AI theo shop | GĐ6 |
| Mọi nguyên tắc mục 2 vẫn được giữ | Test hồi quy chạy mỗi lần phát hành, từ GĐ0 đến hết |
