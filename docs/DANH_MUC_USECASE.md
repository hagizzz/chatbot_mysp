# Danh mục use-case — mọi tình huống bot gặp khách

Soạn 25/08/2026. Không phải nghĩ ra: **68 ý định** dưới đây lấy thẳng từ bộ nhãn của
`ai_intent.js` — đó là toàn bộ những gì bot phân biệt được. Thêm gì ngoài danh sách này
thì bot rơi vào `OTHER`.

Một use-case đầy đủ = **đường vào** × **ý định** × **trạng thái hội thoại**. Ba trục,
mỗi trục ở một mục dưới đây.

---

## A · Bốn đường vào

Quyết định bot có biết *"váy này"* là váy nào hay không. Cùng một câu hỏi, ba đường vào
cho ba kết quả khác nhau — đây là trục hay bị bỏ sót nhất khi thử.

| # | Đường vào | Bot suy ra mẫu bằng gì | Ký hiệu cho nhân viên |
|---|---|---|---|
| A1 | Bấm **quảng cáo** | 6 tầng: khách gõ tên → mã trong tên ad → bản đồ tay + tự học (1.110 dòng) → caption bài → vision ảnh → AI-QUYẾT phân xử | 🎯 TỪ QUẢNG CÁO |
| A2 | **Bình luận** dưới bài | đọc bài thật qua Pancake → caption → tên mẫu | 💬 TỪ BÌNH LUẬN |
| A3 | **Nhắn thẳng** vào page | không có gì — chỉ khi khách gửi ảnh hoặc gõ tên mẫu | ✉️ NHẮN THẲNG |
| A4 | **Gửi ảnh** | nhận diện ảnh (15.221 ảnh trong index) | theo đường vào gốc |

**Phải thử cả bốn.** Chấm điểm bot chỉ trên A3 là chấm oan — đó là cảnh nghèo dữ liệu nhất.

---

## B · 68 ý định khách

### B1 · Khách CHO dữ liệu (5)

| Nhãn | Câu mẫu | Bot phải |
|---|---|---|
| `SIZE` | "L em", "mặc M" | ghi nhận, **không hỏi lại** |
| `WEIGHT_HEIGHT` | "45kg 1m50", "m6 53kg" | tư vấn size **từ số đo**, không hỏi lại |
| `ADDRESS` | "25 Lý Thường Kiệt, Hoàn Kiếm, HN" | chuẩn hoá, xin **đúng tầng còn thiếu** |
| `SEND_ADDRESS_LATER` | "lát gửi địa chỉ" | ghi nhận, chờ, **không giục** |
| `PHONE` | "0912345678" | ghi nhận |

### B2 · Đơn hàng (5)

| Nhãn | Câu mẫu | Bot phải |
|---|---|---|
| `ORDER_CLOSE` | "lấy mẫu này", "chốt đơn" | chốt khi **đủ 4 thông tin**; thiếu thì xin nốt |
| `ADD_TO_ORDER` | "lấy thêm cái này nữa" | thêm mẫu, **giữ nguyên** sđt/địa chỉ đã có |
| `CANCEL_ORDER` | "thôi không lấy nữa" | người thật |
| `ORDER_STATUS` | "đơn tới đâu rồi" | tra đơn / người thật |
| `PAYMENT_CONFIRM` | "ck rồi nhé" | người thật đối soát |

### B3 · Hậu mãi — hầu hết giao NGƯỜI THẬT (7)

`EDIT_ORDER` sửa đơn đã đặt · `EXCHANGE_REQUEST` đổi sau khi mua · `DEFECT_REPORT` hàng
lỗi/giao sai · `REFUND_REQUEST` đòi hoàn tiền · `CK_PROOF` gửi ảnh bill · `REFUSE_DELIVERY`
bom hàng · `DELIVERY_PREFERENCE` dặn giờ giao

**Đây là nhóm nguyên tắc 7 của yêu cầu** — luôn giao người thật, bot tuyệt đối không tự xử.

### B4 · Tiền (6)

| Nhãn | Câu mẫu | Bẫy |
|---|---|---|
| `PRICE_ASK` | "bao nhiêu" | phải ra **đúng mẫu** theo đường vào |
| `TOTAL_PAYMENT` | "tổng hết bao nhiêu" | |
| `DISCOUNT` | "bớt 50k được không" | **không tự giảm** |
| `PRICE_OBJECTION` | "đắt quá", "bên kia rẻ hơn" | thuyết phục giá trị, không hạ giá |
| `PRICE_DISCREPANCY` | "lúc 950 lúc 890" | **giải thích 2 mẫu khác nhau**, không phải chê giá |
| `PAYMENT_METHOD` | "có COD không" | |

### B5 · Hỏi sản phẩm (26) — nhóm to nhất

**Tồn kho:** `STOCK` còn hàng/còn size · `STORE_STOCK` có sẵn ở cửa hàng *(người thật)* ·
`RESTOCK_PREORDER` khi nào có lại

**Size:** `SIZE_CHART` xin bảng size · `SIZE_ADVICE` nên lấy size nào · `SIZE_CONSISTENCY`
size các mẫu có giống nhau không

**Mẫu mã:** `COLOR_ASK` mấy màu · `MATERIAL_QA` chất liệu · `WASH_CARE` giặt giũ ·
`SET_TYPE` set gồm gì · `PRODUCT_DETAIL_QA` có khoá/túi không *(người thật)* ·
`AUTHENTICITY_QA` giống hình không · `BUY_SEPARATE` mua tách lẻ

**Hợp không:** `OCCASION_QA` đi cưới/đi biển · `FIT_SUITABILITY` da ngăm/người mập ·
`PREGNANCY_FIT` bầu mặc được không · `MODEL_REFERENCE` người mẫu cao nặng bao nhiêu ·
`STYLING_QA` phối sao cho đẹp *(người thật)*

**Xin xem thêm:** `IMAGE_REQ` ảnh · `VIDEO_REQ` video · `BACK_VIEW` mặt sau ·
`SIMILAR_MODELS` mẫu tương tự · `COMPARE_MODELS` chọn giúp mẫu nào đẹp hơn ·
`MULTI_MODEL` thích cả mấy mẫu · `BROWSE_CATALOG` xem hàng mới

**Chần chừ:** `DEFER_DECISION` "để chị suy nghĩ" → **lùi nhẹ, không bám đuổi**

### B6 · Vận chuyển / chính sách (9)

`DELIVERY_QA` ship/phí/bao lâu/kiểm hàng · `RETURN_POLICY` đổi trả · `STORE_ADDRESS`
shop ở đâu · `STORE_VISIT` hẹn sẽ ghé · `ASK_SHOPEE` / `ASK_TIKTOK` có bán trên sàn không ·
`TIKTOK_ORDER` đã đặt qua TikTok *(người thật)* · `SAME_SHOP_QA` hai page cùng shop hả ·
`WHOLESALE` hỏi sỉ *(người thật)*

### B7 · Xã giao / khác (10)

| Nhãn | Bot phải |
|---|---|
| `GREETING` "alo shop ơi" | chào, **không đẩy người thật** |
| `THANKS` "ok", "vâng" | ack nhẹ |
| `POST_ORDER_CHITCHAT` khen shop sau chốt | câu ấm khép hội thoại |
| `POST_ORDER_REQUEST` "gói kỹ nhé" | **cam kết trấn an**, không chốt lại |
| `POST_ORDER_CONFIRMED` "chị lấy rồi mà" | xác nhận nhẹ, **không mời lên đơn lại** |
| `COMPLAINT` bực bội | người thật |
| `URGENT` "mai chị đi rồi" | thẻ **185 ĐƠN ƯU TIÊN** |
| `WAITING_REPLY` "sao chưa trả lời" | người thật |
| `CONSULT_FAMILY` "để chị hỏi chồng" | người thật, **không gặng size/màu** |
| `OTHER` | người thật |

---

## C · Thẻ hội thoại

### C1 · Năm thẻ bot dùng

| Thẻ | Khi nào bot gắn | Bot có dừng không |
|---|---|---|
| **182** AI chốt | chốt đơn xong | không |
| **183** AI-CHỜ XL | không tự xử được, cần người | **DỪNG HẲN** |
| **184** AI-XL ảnh | ảnh khách gửi không nhận ra | **DỪNG HẲN** |
| **185** ĐƠN ƯU TIÊN | khách giục gấp / có deadline | **DỪNG HẲN** |
| **206** Gửi đơn gấp | đòi huỷ khi đơn đã xác nhận | không |

### C2 · Use-case về thẻ

| # | Tình huống | Đúng thì phải thấy |
|---|---|---|
| C2.1 | Bot gắn 183 | khách hỏi tiếp → bot **không đọc tin** |
| C2.2 | Nhân viên **gỡ thẻ** | bot nhận lại ngay vòng poll kế |
| C2.3 | Gỡ thẻ khi bật `SIET_NHAN_VIEN_TRA_LOI=on` | phải có **cả** nhân viên đã trả lời |
| C2.4 | Nhân viên gắn thẻ 183 bằng tay | bot dừng ngay |
| C2.5 | Bot nhận ra mẫu sau khi từng gắn 184 | bot **tự gỡ** 184 |
| C2.6 | Thẻ chồng nhau (182+183+185) | 183 thắng, bot dừng |
| C2.7 | Ghi chú nguồn vào ô ghi chú | đúng **một dòng**, không lặp |

---

## D · Trạng thái hội thoại

Cùng một câu hỏi nhưng bot phải xử khác nhau tuỳ trạng thái. Đây là trục hay quên nhất.

| # | Trạng thái | Bẫy |
|---|---|---|
| D1 | Khách **mới tinh** | chưa có gì trong bộ nhớ |
| D2 | Đã báo giá mẫu A | hỏi lại mẫu A → **không báo giá lại** trong 24h |
| D3 | Đã có size | **không hỏi lại size** |
| D4 | Đã có sđt + địa chỉ | **xác nhận**, không xin lại |
| D5 | **Đã chốt đơn**, khách đặt thêm | chỉ hỏi thông tin mẫu mới |
| D6 | Đã chốt đơn, khách nhắn "ok" | không hỏi lại size, không lên đơn hai |
| D7 | **Người thật vừa trả lời** | bot lùi ra, không chen |
| D8 | Hội thoại **còn thẻ giữ** | bot đứng ngoài |
| D9 | Khách **im rồi quay lại** sau vài giờ | không nhắc lại như khách mới |
| D10 | Khách **đổi ý** sang mẫu khác giữa chừng | bám mẫu **mới nhất** |
| D11 | Nhiều mẫu cùng lúc | tư vấn cả cụm, không khoá một mẫu |

---

## E · Ca biên — tất cả đều từ lỗi thật đã gặp

| # | Ca | Bẫy đã từng dính |
|---|---|---|
| E1 | Ảnh **shop khác** | bot phải **không bịa** — đã thử, đạt |
| E2 | Ảnh mờ / chụp màn hình / ảnh cắt | tiêu chí 11 yêu cầu vẫn nhận ra |
| E3 | Gửi **nhiều ảnh** cùng lúc | phải trả lời **đủ**, nhận ra 1/3 thì nói rõ |
| E4 | Ảnh mẫu **giữa mạch xin địa chỉ** | từng bị nhận nhầm là "ảnh địa chỉ" |
| E5 | Địa chỉ **dính câu chat** | "thế gửi gấp cho e set này" → từng lọt vào địa chỉ |
| E6 | Gõ **sai tên mẫu** | "Alisse" vs "Galisse" — khớp gần đúng, không dội 10 mẫu |
| E7 | Gõ **tắt, không dấu** | "sp nay bn v shop" |
| E8 | Hỏi **đi hỏi lại** cùng câu | sổ chống-trùng từng nuốt câu trả lời |
| E9 | "tư vấn mẫu này **nữa**" | từng bị đọc thành chốt đơn |
| E10 | Hỏi **thời hạn** đổi trả | "đổi trả trong bao lâu" từng bị cổng hậu mãi nuốt |
| E11 | Giá có **dấu chấm ngăn nghìn** | bộ tách tin từng xé "1.650.000đ" thành "1. 650. 000đ" |
| E12 | Quảng cáo **bài cũ** ngoài 120 ngày | Pancake không đọc được bài |
| E13 | Nhiều tin **gõ liền tay** | bot gộp thành một lượt (debounce 2,5 giây) |

---

## F · Cách chấm

Ba dòng này **không phải lỗi**:

| Thấy gì | Nghĩa |
|---|---|
| Bot chưa trả lời ngay | đang gộp tin, câu trả lời hiện ở lượt sau |
| Bot im **mà có gắn thẻ** | cố ý nhường người thật — đúng nguyên tắc 1 và 2 |
| Bot đứng ngoài khi có thẻ giữ | đúng mục 3.3 |

Chỉ **im mà không gắn thẻ gì** mới đáng lo — không ai biết khách đang chờ.

---

## G · Chạy bằng máy

46 kịch bản đã dựng sẵn, phủ phần lớn danh mục trên:

```bash
npm run dien-kich-ban                                  # cả 4 nhóm
node dien_kich_ban.js kich_ban_thu/nghiem_thu.json     # một nhóm
```

Bản đồ: `kich_ban_thu/README.md`. Bảng đúng/sai từng kịch bản: `docs/CAU_HOI_THU_BOT.md`.

### Còn thiếu kịch bản — ưu tiên bổ sung

Đối chiếu danh mục này với 46 kịch bản hiện có, những nhóm **chưa có kịch bản nào**:

- `PRICE_DISCREPANCY` — khách thắc mắc hai giá vênh
- `PREGNANCY_FIT` — bầu / sau sinh
- `SAME_SHOP_QA` — hai page cùng shop hả
- `ASK_SHOPEE` / `ASK_TIKTOK` / `TIKTOK_ORDER`
- `DEFER_DECISION` — "để chị suy nghĩ đã"
- `CONSULT_FAMILY` — "để chị hỏi chồng"
- `WAITING_REPLY` — "sao chưa trả lời"
- `POST_ORDER_REQUEST` — "gói kỹ nhé"
- `BUY_SEPARATE` — mua tách lẻ set
- `VIDEO_REQ` / `BACK_VIEW`
- D7, D9 — người thật vừa trả lời · khách quay lại sau vài giờ
- E2 — ảnh mờ / chụp màn hình
