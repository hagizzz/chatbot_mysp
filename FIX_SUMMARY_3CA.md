# TỔNG HỢP SỬA 3 CA: Nguyễn Minh Hải · Giang Dao · Thuy Nguyễn

Ngày: 2026-06-26. File sửa: `bot_worker_api_v3.js` (đã `node --check` đạt).

Nguyên tắc giữ nguyên: **AI gắn nhãn — CODE làm theo nhãn.** AI KHÔNG tự soạn/bịa đơn;
code mới là người dựng câu chốt. Các thay đổi dưới đây chỉ "nối" nhãn vào nhánh code.

---

## ĐÃ SỬA TRONG CODE (áp + verify)

### 1. Nối nhãn AI `ORDER_CLOSE` vào việc chốt  — (chính: Nguyễn Minh Hải)
- **Thêm hàm `tryCloseFromState(mem, productInfo, latestText)`** (dòng ~1270):
  - Đủ {mẫu + size + màu + sđt + địa chỉ} -> `done` + câu chốt `buildOrderConfirmation`.
  - Mẫu nhiều màu nhưng hội thoại bám 1 màu (ad/ảnh) + khách không hỏi màu khác -> mặc định màu đó, KHÔNG hỏi thừa.
  - Thiếu field -> `ask` + xin ĐÚNG cái thiếu (sđt -> màu -> size -> địa chỉ), KHÔNG tư vấn lại.
  - Không tra được mẫu -> `handoff` (người thật).
- **Thêm khối điều phối** (trước cổng router GĐ2, đặt CAO hơn nhánh "xem màu" 8143):
  ```
  if (!mem.orderClosed && _ai("ORDER_CLOSE") && !looksLikeQuestion && !shopRepliedAfter) {
      tryCloseFromState -> done: chốt | color: hỏi màu+ảnh | ask: xin nốt | handoff: người thật
  }
  ```
- **Kết quả NMH**: "Màu hồng nhé" -> AI=ORDER_CLOSE -> đủ size L + sđt + địa chỉ + màu hồng
  -> CHỐT LUÔN, hết cảnh "Em gửi màu hồng ạ" + không hỏi lại màu.
- Lý do trước đây hỏng: nhãn ORDER_CLOSE vốn KHÔNG được nối vào hành động nào
  (chủ ý an toàn "đơn/tiền không nối AI"), nên cú chốt bị nhánh "xem màu" (dòng 8143) cướp lượt.

### 2. Không hỏi lại size khi khách đã cho ở lượt trước — (Thuy Nguyễn)
- **Thêm khôi phục `mem.customerSize` từ LỊCH SỬ** (sau khối AI-READ, ~dòng 5700):
  quét mọi tin khách trong `data.messages`, nếu từng có size (vd "thường mặc sz L")
  -> nạp lại `mem.customerSize` -> không đính câu "cho em xin chiều cao và cân nặng" nữa.
- Lý do trước đây hỏng: size khách cho ở lượt/ngày trước, mem mất sau restart hoặc nằm
  ngoài batch hiện tại -> bot tưởng chưa có -> hỏi lại.

### 3. Follow-up lần đầu: 5 giây -> 10 phút — (Thuy Nguyễn yêu cầu)
- `FIVE_SEC = 5*1000` -> `10*60*1000` (dòng ~4659). Hết cảnh giục dồn ngay sau 5s.

---

## GIANG DAO — đính chính + việc cần làm tiếp

### Đính chính phân tích về `ad_product_map.json`
Sau khi rà lại TẤT CẢ ad trỏ về post `1555383752809784` trong log, **mọi ad đều là Giannal**
(tên ad: "MGKVX6310-...Giannal..."). Ad của Giang Dao (`120253563115210550`) cũng cùng cụm Giannal.
=> **Dòng map `"1555383752809784": "MGKVX6310"` KHÔNG sai.** Giang Dao VÀO từ ad Giannal,
nhưng trong hội thoại **người thật chuyển sang tư vấn/chốt mẫu Delicacy (MRVX588)** (khách gửi
ảnh Delicacy + người thật báo giá 1.350.000 + lên đơn size M).

### Bản chất lỗi Giang Dao (KHÔNG phải map, KHÔNG phải sai nhãn)
Hội thoại LAI: **người thật đang lái sang Delicacy, nhưng lock của bot vẫn dính Giannal (mẫu ad)**.
Khi khách trả "Màu trắng" (đang chọn 1 trong 2 màu Delicacy người thật vừa hỏi), bot lấy nhầm
mẫu Giannal đi kiểm màu -> "kem hồng nâu be cam" (màu Giannal). Và câu trả lời trễ cho "Màu này là
màu gì" bị chèn SAU khi người thật đã chốt + khách "Ok".

### Hai phần ĐÃ giảm nhẹ nhờ patch trên
- Nhánh "xem màu" (8143) không còn cướp lượt "Màu trắng" nếu AI gắn ORDER_CLOSE (khối điều phối chặn trên).

### Hai phần CÒN LẠI — cần làm cẩn thận (KHUYẾN NGHỊ, chưa áp vì rủi ro production)

**(A) Đồng bộ lock theo mẫu NGƯỜI THẬT đang bán / VISION điểm cao** — `resolveProduct` dòng ~2738
(`text_falsematch_keep`):
- Khi lịch sử có người thật BÁO GIÁ / GỬI ẢNH / LÊN ĐƠN một mẫu KHÁC mẫu ad (vd Delicacy 1.350.000),
  hoặc VISION ảnh điểm cao (>0.9) ra mẫu khác -> **cho đổi lock theo mẫu đó**, đừng ghì mẫu ad.
- Cần test kỹ vì `resolveProduct` ảnh hưởng mọi hội thoại.

**(B) Bot ĐỨNG NGOÀI khi người thật đang lái + re-check trước khi gửi**:
- Nếu `last_sent_by` là admin NGƯỜI THẬT (không phải Public API/Botcake) và vừa trả lời gần đây
  -> bot defer (gắn CHỜ XL), huỷ `pendingFollowups`.
- **Re-check ngay TRƯỚC mỗi `sendInboxMessage`**: nếu có người thật trả lời / có tin chốt đơn
  xuất hiện SAU tin khách đang xử -> HUỶ câu đang định gửi (chống câu trễ chèn loạn như Giang Dao #10).
- Đây là fix gốc cho "hội thoại lai" nhưng đụng đường gửi chung -> cần test.

---

## Ghi chú rủi ro của việc nối ORDER_CLOSE
Vì giờ code làm theo nhãn AI, nếu AI thi thoảng gắn NHẦM `ORDER_CLOSE`:
- Có đủ data + đúng mẫu -> có thể chốt sớm. (bù lại: chỉ kích khi !mem.orderClosed, !câu hỏi, !người thật vừa trả.)
- Thiếu data -> chỉ xin nốt cái thiếu (an toàn, không chốt bừa).
Đây là đánh đổi của thiết kế "code làm theo nhãn AI" như yêu cầu.
