# Dự thảo hợp đồng API — bot ↔ hệ thống quản trị hội thoại (bạn Hoà)

> Mục 8 của bản yêu cầu. **Đây là bản dự thảo để hai bên chốt**, không phải bản đã thống nhất.
> Kế hoạch đặt hạn: chốt trong tuần 1–2, chậm nhất tuần 3.
> Chốt xong hai bên tự làm với dữ liệu giả, không chờ nhau — lớp `adapter_hoa.js` đã có sẵn
> chế độ giả lập để bên bot làm trước.

## Nguyên tắc

1. **Bot không bao giờ tự gửi tin ở chế độ bán tự động.** Bot chỉ đẩy *gợi ý*; người bấm gửi.
2. **Bot không tự tra ngân hàng.** Bot chỉ *đọc kết quả đối soát* mà hệ thống của Hoà trả về.
3. Mọi lời gọi đều mang `shop_id`. Không có `shop_id` thì từ chối — đây là lớp chặn đọc chéo
   dữ liệu giữa các shop (mục 9.1).
4. Mọi lời gọi đều **chạy lại được**: có `idempotency_key`, gọi hai lần không tạo hai kết quả.

## 5 nhóm cần chốt

### 1. Gửi tin

```
POST /api/v1/messages
{ "shop_id","conversation_id","kieu":"text|image","noi_dung","anh":[url],
  "idempotency_key" }
-> { "ok", "message_id", "trung_lap": bool }
```

Cần chốt: ai giữ cửa sổ 24 giờ của Facebook — bot tự kiểm hay hệ thống Hoà trả lỗi rõ ràng?
(Hiện bot tự xử `#10 ngoài cửa sổ`, xem `HUONG_DAN_ANH_PANCAKE.txt`.)

### 2. Gắn / gỡ thẻ

```
POST /api/v1/tags   { "shop_id","conversation_id","tag_id","hanh_dong":"add|remove","ly_do" }
GET  /api/v1/tags   ?shop_id=...           -> danh sách thẻ + thẻ nào là thẻ hệ thống
```

Cần chốt: **thẻ hệ thống không xoá được** (mục 6) do bên nào canh — bot hay hệ thống Hoà?
Đề xuất: hệ thống Hoà canh, vì nó sở hữu giao diện quản thẻ.

### 3. Khung gợi ý bán tự động (mục 10)

```
POST /api/v1/suggestions
{ "shop_id","conversation_id",
  "goi_y":[ {"noi_dung","ly_do","do_tin_cay":0..1} ],   // 2–3 phương án
  "nhan_y_dinh","san_pham" }
-> { "ok","suggestion_id" }

WEBHOOK ngược:  POST <url của bot>/suggestion-result
{ "suggestion_id","da_dung": bool, "chon_phuong_an": 0|1|2, "noi_dung_da_sua" }
```

Webhook ngược là **bắt buộc** — không có nó thì không đo được "nhân viên có dùng gợi ý không,
sửa nhiều hay ít", tức mất chỉ số chất lượng bot ở GĐ4.

### 4. Kết quả đối soát chuyển khoản (mục 7)

```
WEBHOOK:  POST <url của bot>/payment-matched
{ "shop_id","conversation_id"|"order_id","trang_thai":"khop_du|thieu|thua|khong_khop|chua_thay",
  "so_tien","noi_dung_ck","thoi_diem" }
```

Bot xử theo bảng: `khop_du` → xác nhận với khách + chuyển đơn sang đã thanh toán.
`chua_thay` → báo khách chờ rồi kiểm lại. `thieu` / `thua` / `khong_khop` / chờ quá lâu →
**giao người thật**, bot không tự quyết.

Cần chốt: **thời gian chờ tối đa** trước khi giao người thật (đề xuất 15 phút), và ai gửi lại
`chua_thay` — Hoà đẩy định kỳ hay bot hỏi lại?

### 5. Sự kiện chốt đơn

```
POST /api/v1/orders/closed
{ "shop_id","conversation_id","order_id","san_pham":[{ma,mau,size,sl}],
  "sdt","dia_chi","cod","nguon":"bot|nhan_vien" }
```

Thay cho tín hiệu hiện tại là *thẻ "AI chốt" (182)*. Thẻ vẫn giữ để nhân viên nhìn thấy,
nhưng luồng máy chạy trên sự kiện có cấu trúc (GĐ2).

## Ba câu hỏi chặn tiến độ

1. **Xác thực**: token tĩnh mỗi shop, hay OAuth? Ai cấp, xoay vòng thế nào?
2. **Chiều webhook**: Hoà gọi vào bot (bot phải có URL công khai) hay bot hỏi định kỳ?
   Bot hiện đã có `WEBHOOK_PULL_URL` — hỏi định kỳ dễ triển khai hơn cho máy chạy tại shop.
3. **Ai là nguồn sự thật của danh sách shop và Page?** Đề xuất: hệ thống Hoà, bot đồng bộ về.

## Trong lúc chờ chốt

`adapter_hoa.js` chạy ở chế độ `HOA_API_MODE=gia_lap`: ghi mọi lời gọi ra
`data/hoa_gia_lap.jsonl` và trả kết quả giả hợp lệ. Bên bot làm được toàn bộ GĐ4 và GĐ6
mà chưa cần API thật; chốt xong chỉ đổi `HOA_API_MODE=that` và điền `HOA_API_URL`.
