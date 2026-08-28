# Kiểm kê NHÃN Ý ĐỊNH + kế hoạch AI-first dispatch

Tài liệu này tổng hợp: (1) nhãn ĐANG CÓ, (2) nhãn CÒN THIẾU cần bổ sung,
(3) trường hợp GIAO NGƯỜI THẬT, (4) bộ nhãn hợp nhất đề xuất.
Cơ sở: quét trực tiếp `ai_intent.js`, `intent_router.js`, `bot_worker_api_v3.js`.

================================================================
## 1) NHÃN AI HIỆN CÓ (ai_intent.js)
================================================================
AI xuất 2 phần: `kind` (12 nhãn) + `concern` (6 đặc điểm phụ).

### kind — 12 nhãn
| kind          | Ý nghĩa                                              | Tiền/đơn? |
|---------------|------------------------------------------------------|-----------|
| SIZE          | Khách CHO size của mình ("L em", "mặc M")            | không     |
| WEIGHT_HEIGHT | Khách cho cân nặng/chiều cao/số đo ("45kg 1m50")     | không     |
| ADDRESS       | Khách CHO địa chỉ giao                                | đơn       |
| PHONE         | Khách cho số điện thoại                               | đơn       |
| ORDER_CLOSE   | Khách CHỐT/đồng ý lấy ("lấy mẫu này", "chốt đơn")     | ĐƠN       |
| PRICE_ASK     | Khách HỎI giá ("bao nhiêu", "giá sao")               | TIỀN      |
| SIZE_CHART    | Khách xin BẢNG size / thông số                        | không     |
| IMAGE_REQ     | Khách xin xem thêm ảnh/màu                            | không     |
| MATERIAL_QA   | Hỏi chất liệu/co giãn/form/nóng/nhăn (tư vấn)         | không     |
| DELIVERY_QA   | Hỏi ship/phí ship/bao lâu/kiểm hàng/COD              | không*    |
| GREETING      | Chào/ping mở đầu ("alo", "ib", "shop ơi")           | không     |
| OTHER         | Còn lại                                              | -         |

### concern — 6 đặc điểm (đi kèm kind)
ngan (sợ ngắn) · mong (sợ mỏng/hở) · chat (chất liệu) · cogian (co giãn) ·
lot (quần/lót trong) · dem (đệm ngực).

> LƯU Ý LỚN: hiện code CHỈ đọc `kind` cho size/địa chỉ, và đọc `concern` ở
> ĐÚNG 2 nhánh (mong, ngan). `kind` (ORDER_CLOSE/PRICE_ASK...) KHÔNG được dùng
> để rẽ nhánh — chỉ in log. Nên AI đang gần như KHÔNG điều khiển định tuyến.

================================================================
## 2) NHÃN CODE ĐANG XỬ nhưng AI CHƯA gắn được -> CẦN BỔ SUNG
================================================================
(Code có hàm xử lý + có nhánh trả lời, nhưng AI không có ô để gắn -> AI gắn sai.)

| Nhãn đề xuất       | Câu ví dụ                              | Hàm code đang có             | Loại     |
|--------------------|----------------------------------------|------------------------------|----------|
| ORDER_STATUS ★     | "shop gửi hàng chưa", "đơn tới đâu rồi" | asksOrderStatus              | tra đơn  |
| TOTAL_PAYMENT      | "tổng bill bao nhiêu", "hết tất cả"     | asksTotalPayment             | TIỀN     |
| DISCOUNT           | "giảm giá không", "sale", "bớt"         | asksDiscount/asksMoreDiscount| TIỀN     |
| PRICE_OBJECTION    | "đắt thế", "mắc quá"                     | priceObjection               | TIỀN     |
| PRICE_COMPARISON   | "chỗ khác bán rẻ hơn"                    | priceComparison              | TIỀN     |
| STOCK              | "còn hàng không", "còn size không"      | asksInStock/asksHasSize      | thông tin|
| COLOR              | "có màu nào", "còn màu khác"            | asksOtherColors              | thông tin|
| INNER_LINING       | "có quần trong không" (concern=lot)     | asksInnerLining              | thông tin|
| BREAST_PAD         | "có đệm ngực không" (concern=dem)        | asksBreastPad                | thông tin|
| STRETCH            | "vải co giãn không" (concern=cogian)     | asksStretch                  | thông tin|
| RETURN_POLICY      | "đổi trả thế nào", "không vừa đổi được?" | asksReturnPolicy/Exchange    | chính sách|
| STORE_ADDRESS      | "shop ở đâu", "qua shop được không"     | asksShopAddress              | chính sách|
| PAYMENT_METHOD     | "stk", "chuyển khoản", "momo"           | wantsBankInfo                | thông tin|
| PAYMENT_CONFIRM    | "ck rồi nhé", "nhận được tiền chưa"     | asksPaymentReceived          | NGƯỜI THẬT|
| ADD_TO_ORDER       | "lấy thêm mẫu này nữa"                   | customerWantsToOrder + router| ĐƠN      |
| CANCEL_ORDER       | "huỷ đơn", "thôi không lấy nữa"          | isCancelOrder                | NGƯỜI THẬT|
| BACK_VIEW          | "cho xem mặt sau"                       | wantsBackView                | thông tin|
| REAL_PHOTO         | "ảnh thật chụp ở shop"                   | asksShopLivePhoto            | NGƯỜI THẬT|
| SIMILAR_MODELS     | "còn mẫu nào tương tự"                   | asksSimilarModels/wantsAllModels| thông tin|
| SHOPEE_TIKTOK      | "bán shopee/tiktok không"                | asksSellOnShopee/Tiktok      | thông tin|
| COMPLAINT/ANGRY    | bực, khiếu nại, gắt                      | isAngryOrSensitive           | NGƯỜI THẬT|
| THANKS/ACK         | "cảm ơn", "ok", "vâng"                   | isAffirmation/isFriendlyRemark| xã giao |

★ = ca thực tế đã gặp (Huyền Phạm). Đây là nhãn quan trọng nhất còn thiếu.

================================================================
## 3) KHI NÀO GIAO NGƯỜI THẬT (giữ nguyên — AI KHÔNG được tự trả)
================================================================
Tổng hợp từ ~140 điểm handoff trong code, gom thành 7 nhóm:

1. SHEET THIẾU DỮ LIỆU: hỏi chất liệu/co giãn/số đo/đệm... mà cột tương ứng
   trống -> không bịa -> CHỜ XL.
2. ẢNH: không gửi được ảnh, xin ảnh thật/ảnh chi tiết tại shop -> AI-XL ảnh.
3. TIỀN ĐÃ TRAO: "ck rồi", "nhận tiền chưa", xác thực cọc -> không tự xác nhận.
4. HUỶ / ĐỔI / TRẢ / HOÀN đi sâu, shop qua lấy hàng -> người thật.
5. NHẠY CẢM: khách bực/gắt/khiếu nại (isAngryOrSensitive) -> người thật.
6. ĐỊA CHỈ/SĐT bằng ẢNH (không OCR), địa chỉ rác -> người thật.
7. NGOÀI KỊCH BẢN: câu chưa được dạy / AI định tự chế câu -> ĐẨY NGƯỜI THẬT
   (lưới an toàn mặc định).

================================================================
## 4) BỘ NHÃN HỢP NHẤT ĐỀ XUẤT (cho AI-first dispatch)
================================================================
Phân 3 tầng theo MỨC AI được phép điều khiển:

### Tầng A — AI gắn nhãn -> AI RẼ NHÁNH (chỉ HỎI THÔNG TIN, không tiền/đơn)
GREETING, THANKS, STOCK, COLOR, INNER_LINING, BREAST_PAD, STRETCH,
MATERIAL_QA, SIZE_CHART, IMAGE_REQ, BACK_VIEW, SIMILAR_MODELS, DELIVERY_QA,
RETURN_POLICY, STORE_ADDRESS, PAYMENT_METHOD, SHOPEE_TIKTOK, ORDER_STATUS,
SIZE_ADVICE.
-> AI hiểu cả câu để chọn nhánh; code CHỈ lấy dữ liệu (sheet/index) trả lời.

### Tầng B — AI gắn nhãn -> nhưng CODE THỰC THI (chạm TIỀN/ĐƠN)
PRICE_ASK, TOTAL_PAYMENT, DISCOUNT, ADD_TO_ORDER, ORDER_CLOSE, ADDRESS, PHONE,
SIZE (cho size).
-> AI chỉ nói "khách muốn X"; giá lấy từ catalog, đơn từ POS, không để AI tự chế.

### Tầng C — AI nhận ra -> GIAO NGƯỜI THẬT ngay (không tự trả)
PAYMENT_CONFIRM, CANCEL_ORDER, COMPLAINT/ANGRY, REAL_PHOTO, và 7 nhóm handoff ở mục 3.

================================================================
## 5) NGUYÊN TẮC AN TOÀN (bắt buộc khi chuyển AI-first)
================================================================
1. KHÔNG xoá chuỗi từ-khoá cũ. Thêm tầng AI-first LÊN TRÊN; từ-khoá làm lưới đỡ.
2. AI timeout / OTHER / độ tin thấp -> rơi xuống chuỗi từ-khoá cũ (như hiện tại).
3. Mọi nhãn Tầng B/C -> code DUYỆT lại trước khi thực thi; AI không tự chạm tiền/đơn.
4. Bật log [DISPATCH] để soi: AI nhãn gì -> vào nhánh nào -> ai quyết (AI/code/từ-khoá).
