# Chi phí vận hành — cơ sở để tính giá bán

Lập ngày 22/08/2026. Mọi con số dưới đây **đo từ log chạy thật**, không phải ước lượng.
Nguồn: `data/turnlog/*.jsonl` và `data/thu/turnlog/*.jsonl`.

> **Cỡ mẫu hiện tại: 4 lượt / 10 lần gọi AI.** Đủ để biết đơn giá một lượt, **chưa đủ**
> để biết tỷ lệ giữa các loại lượt trong lưu lượng thật. Xem mục 7 để mở rộng mẫu.

> ## ⚠ ĐỌC MỤC 8 TRƯỚC KHI DÙNG SỐ Ở MỤC 1–3 ĐỂ TÍNH GIÁ BÁN
>
> Mọi con số ở mục 1–3 là **giá niêm yết**. Đo lại 27/08/2026: prompt của bot **đang
> được đệm 93–99%** và phần đệm chỉ tính 1/4 giá. Chi phí THẬT khoảng **147 đ/lượt**,
> không phải 314 đ — tức mục 1–3 đang thổi lên **gấp đôi**.
>
> Lỗi ở khâu đo, không phải ở bot: `turn_log` tính tiền theo bảng giá niêm yết và
> không đọc `prompt_tokens_details.cached_tokens`. Đã vá cùng ngày.

---

## 1. Số đo gốc

Đo trên hội thoại thật của page MYS.P, model `gpt-4.1-mini-2025-04-14`.

| Lượt | Số lần gọi AI | Token vào | Token ra | Tiền |
|---|---|---|---|---|
| 1 | 3 | 29.392 | 189 | $0,01206 |
| 2 | 3 | 29.392 | 187 | $0,01206 |
| 3 | 3 | 29.440 | 186 | $0,01207 |
| 4 | 1 | 2.403 | 143 | $0,00119 |

**Có hai loại lượt, chênh nhau 10 lần:**

| Loại lượt | Khi nào xảy ra | Token vào | Tiền/lượt |
|---|---|---|---|
| **Đầy đủ** — 3 tầng | khách nhắn chữ, bot phải hiểu ý rồi soạn câu | ~29.400 | **$0,0121 ≈ 314 đ** |
| **Rút gọn** — 1 tầng | cổng quảng cáo đã ra mẫu, chỉ cần quyết hành động | ~2.400 | **$0,0012 ≈ 31 đ** |

*(Quy đổi theo 26.000 đ/USD. Đổi tỷ giá thì đổi hết bảng.)*

## 2. Token đi đâu

| Nơi gọi | Số lần | Token vào TB mỗi lần | Ghi chú |
|---|---|---|---|
| `reasoning_engine` | 3 | **16.907** | soạn câu trả lời — ngốn nhất |
| `ai_intent` | 3 | **10.141** | đọc hiểu, nhả nhãn ý định |
| `ai_quyet` | 4 | 2.371 | quyết định hành động |

**Đây là chỗ tiền chảy.** Gần 27.000 token đầu vào của hai tầng trên chủ yếu là
**kịch bản + bảng hàng gửi lại nguyên vẹn mỗi lượt**. Nội dung câu khách chỉ vài chục token.

## 3. Chi phí theo quy mô

Giả định: một hội thoại trung bình **3 lượt bot xử lý**.

| Quy mô | Hội thoại/ngày | Lượt/tháng | Toàn lượt đầy đủ | Pha 50/50 |
|---|---|---|---|---|
| Shop nhỏ | 50 | 4.500 | **1.413.000 đ** | 776.000 đ |
| Shop vừa | 200 | 18.000 | **5.652.000 đ** | 3.105.000 đ |
| Shop lớn | 500 | 45.000 | **14.130.000 đ** | 7.763.000 đ |

> ⚠ **Con số này đủ lớn để quyết định giá bán.** Một shop nhỏ đã tốn ~1,4 triệu/tháng
> tiền AI ở trường hợp xấu nhất. Bán dưới mức đó là lỗ ngay từ khách đầu tiên.
>
> Cột "pha 50/50" chỉ là **giả định**, chưa đo. Phải chạy đủ một tuần lưu lượng thật
> mới biết tỷ lệ lượt đầy đủ / rút gọn.

## 4. Đòn bẩy giảm chi phí

Xếp theo mức ăn tiền:

| Đòn bẩy | Cách làm | Ước tính giảm |
|---|---|---|
| **Bộ nhớ đệm prompt** | Kịch bản + bảng hàng giống hệt nhau mỗi lượt, nằm ở đầu prompt — đúng dạng nhà cung cấp cho đệm. Cần đo lại với đơn giá đệm hiện hành. | lớn nhất, nên làm trước |
| **Chỉ gửi phần kịch bản liên quan** | Đang gửi cả kho tri thức cho mọi câu hỏi. Chọn lọc theo nhãn ý định. | lớn |
| **Chặn tầng 3 khi tầng 1 đã chắc** | `intent_router.js` chấm độ chắc; điểm cao thì không cần gọi `reasoning_engine` (16.907 token). | vừa |
| **Đổi model theo việc** | `ai_intent` chỉ nhả nhãn cố định — việc dễ, có thể dùng model rẻ hơn. `reasoning_engine` soạn câu cho khách thì giữ model tốt. | vừa |

## 5. Các khoản khác

| Khoản | Tính tiền thế nào | Ghi chú |
|---|---|---|
| **Pancake** | thuê bao tháng | shop đã trả, bot không làm phát sinh thêm |
| **Pancake POS** | thuê bao tháng | như trên |
| **Facebook Messenger API** | miễn phí | |
| **Google Docs / Sheets API** | trong hạn miễn phí | đọc kịch bản, bảng hàng |
| **Nhận diện ảnh (CLIP)** | **0 đ** | chạy cục bộ trên CPU, không gọi API |
| **OCR (tesseract.js)** | **0 đ** | chạy cục bộ |
| **Model CLIP** | tải một lần 578 MB | miễn phí |
| **VPS** | thuê bao tháng | Ubuntu 24.04, đang chạy |

## 6. Khoản ẩn: cú bấm quảng cáo khi test

**Người test dễ tự đốt tiền quảng cáo mà không biết.**

Bấm vào một quảng cáo đang chạy để mở hội thoại thử = một cú bấm thật, Facebook tính
tiền vào tài khoản quảng cáo của shop. Với chiến dịch mục tiêu tin nhắn, một hội thoại
phát sinh thường **đắt hơn toàn bộ tiền AI của cả buổi test**.

Đã xảy ra thật ngày 22/08/2026: hội thoại thử mang `adId=120256396807590550`,
`click_from: facebook`.

**Cách tránh:** nhắn thẳng vào page qua Messenger, đừng bấm qua quảng cáo.
Đánh đổi: mất luồng ads, bot sẽ hỏi "chị đang xem mẫu nào" thay vì báo giá luôn.

Muốn thử mà không tốn gì cả thì dùng môi trường trong máy: `npm run chat-thu`
(xem `docs/MOI_TRUONG_THU.md`) — chỉ tốn tiền AI, không đụng Facebook.

## 7. Tự đo lại

```bash
npm run thong-ke                 # 7 ngày gần nhất, kèm lý do nhường người thật
node thong_ke.js 30              # 30 ngày
```

Số liệu thô nằm ở `data/turnlog/YYYY-MM-DD.jsonl`, mỗi lượt một dòng JSON, có sẵn
`tokenVao`, `tokenRa`, `tienUSD`, và mảng `ai[]` ghi rõ từng lần gọi ở đâu.

Muốn mẫu đủ lớn để tính giá bán thì cho bot chạy thật **ít nhất một tuần**, rồi đọc lại
mục 1 và mục 3 của file này bằng số mới.

## 8. Đơn giá tham chiếu

Khai trong `turn_log.js`, biến `GIA`, đơn vị **USD cho một triệu token**:

| Model | Vào | Ra |
|---|---|---|
| `gpt-4.1-mini` | 0,40 | 1,60 |
| `gpt-4.1` | 2,00 | 8,00 |
| `gpt-4o-mini` | 0,15 | 0,60 |

Nhà cung cấp đổi giá thì sửa đúng chỗ này, mọi thống kê tự theo.

## 9. Một lỗi đã vá — và vì sao nó nguy hiểm

Trước 22/08/2026, **mọi lượt đều ghi `tienUSD: 0`**.

Nguyên nhân: bảng giá khai khoá là `"gpt-4.1-mini"`, nhưng OpenAI trả về tên có gắn ngày
bản — `"gpt-4.1-mini-2025-04-14"`. Tra bảng bằng dấu bằng nên trượt, rơi về `{vao:0, ra:0}`.

Token vẫn đếm đúng, chỉ tiền là mất sạch. Hậu quả: mục 9.5 của bản yêu cầu
(*đặt hạn mức chặn khi vượt ngưỡng*) **không có gì để chặn** — sổ luôn báo 0 đồng.

Đã sửa: tra theo **tiền tố**, lấy khoá dài nhất khớp được (để `gpt-4.1-mini-...` ăn vào
`gpt-4.1-mini` chứ không rơi nhầm vào `gpt-4.1`). Gặp model chưa có đơn giá thì **in cảnh
báo ra log** thay vì lặng lẽ tính 0 đồng:

```
[turn-log] ⚠ CHƯA CÓ ĐƠN GIÁ cho model "..." -> chi phí đang bị tính là 0.
```

**Bài học cho lần sau:** mọi con số 0 trong sổ chi phí đều phải nghi ngờ trước khi tin.

---

## 8. Đệm prompt — đo lại 27/08/2026

Mục 4 khuyên "làm bộ nhớ đệm prompt trước khi chốt bảng giá bán". Hoá ra **nó đã chạy
sẵn từ lâu**, tự động, không ai bật gì cả. Chỉ có sổ sách là không biết.

Đo bằng `node do_dem.js` (gọi thật 3 lần mỗi tầng, dùng đúng khối prompt đang chạy):

| Tầng | Token vào | Được đệm (lượt 2–3) | Giá niêm yết | Thực trả | Tiết kiệm |
|---|---|---|---|---|---|
| `ai_intent` | 10.944 | 10.752 — **98%** | $0,00438 | $0,00115 | **74%** |
| `ai_quyet` | 2.880 | 2.688 — **93%** | $0,00115 | $0,00035 | **70%** |
| `reasoning_engine` (khối kịch bản+luật) | 9.347 | 9.216 — **99%** | $0,00374 | $0,00097 | **74%** |

Điều kiện để đệm ăn: khối tĩnh phải nằm **đầu chuỗi message** và không đổi. Cả ba tầng
vốn đã dựng đúng như vậy. Thêm một dòng biến vào đầu prompt là mất sạch phần giảm — mà
**không có gì báo**, chỉ hoá đơn tự đội lên. Chạy lại `do_dem.js` sau mỗi lần sửa prompt.

### Đơn giá THẬT một lượt đầy đủ

| Tầng | Token vào | Phần trả giá đầy đủ | Tiền |
|---|---|---|---|
| `ai_intent` | 10.141 | ~200 | $0,00108 |
| `ai_quyet` | 2.371 | ~170 | $0,00029 |
| `reasoning_engine` | 16.907 | **~7.560** (phần ĐỔI theo lượt) | $0,00399 |
| token ra | ~190 | — | $0,00030 |
| **Tổng** | | | **$0,0057 ≈ 147 đ** |

**Chỗ tiền thật sự chảy nay đã đổi.** Không còn là "kịch bản gửi lại mỗi lượt" — khối đó
đệm 99%, chỉ còn tốn ~24 đ/lượt. Nay **54% hoá đơn** nằm ở phần **đổi theo từng lượt**
của `reasoning_engine`: tóm tắt sản phẩm, danh sách mẫu đã báo giá, tóm tắt hội thoại
(~7.560 token/lượt, không đệm được vì lượt nào cũng khác).

Hệ quả cho việc tối ưu: **RAG trên kịch bản/luật gần như không đáng làm nữa** — cắt
9.000 token đang được giảm 75% chỉ tiết kiệm ~22 đ/lượt, đổi lại thêm một kiểu hỏng mới
(tra trượt = bot quên luật nó vốn biết, âm thầm). Muốn cắt tiếp thì cắt **phần biến**:
gửi ít mẫu đã báo giá hơn, tóm tắt hội thoại ngắn hơn.

---

## Tóm tắt cho việc định giá

1. Đơn giá một lượt đầy đủ: **~147 đ** (không phải 314 đ — xem mục 8). Rút gọn: ~15 đ.
2. Shop nhỏ 50 hội thoại/ngày: **0,4 – 0,7 triệu đồng/tháng** tiền AI.
3. ~~Hơn 90% chi phí nằm ở kịch bản gửi lại mỗi lượt~~ — **sai từ 27/08/2026**. Khối đó
   đệm 99%. Nay 54% hoá đơn là phần **biến theo lượt** của `reasoning_engine`.
4. Chi phí ngoài AI gần như bằng 0 — nhận diện ảnh và OCR chạy cục bộ.
5. Cỡ mẫu hiện mới 4 lượt. **Chạy thật một tuần rồi hãy chốt giá** — nay `thong_ke.js`
   có in tỉ lệ đệm nên số đo sẽ là tiền thật, không phải giá niêm yết.
