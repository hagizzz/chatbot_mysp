# Gửi ẢNH THẬT cho khách qua API Pancake

Khi bot báo giá / nhận diện được mẫu nào trong lượt -> tự gửi 2-3 ẢNH THẬT của
mẫu đó cho khách (dán inline trong inbox, KHÔNG phải link chữ).

## File copy ĐÈ vào C:\AI_HTK_BOT_V5

- pancake_sender.js      (đè)  thêm gửi ảnh qua content_url
- product_images.js      (mới) lấy link ảnh theo mã từ hash_index.json
- bot_worker_api_v3.js   (đè)  báo giá mẫu nào -> gửi ảnh mẫu đó

(Cần có sẵn hash_index.json trong thư mục - bạn đã copy từ V4.)

## Cách hoạt động

- Khách gửi ảnh / nhắn tên mẫu -> bot nhận diện -> trả lời chữ + gửi kèm ảnh.
- 1 mẫu: gửi 3 ảnh. Nhiều mẫu: 2 ảnh mỗi mẫu.
- Ảnh lấy từ hash_index.json (ưu tiên link thumbnail để Pancake tải nhanh).

## QUAN TRỌNG - 2 điểm cần test thực tế

1. Tham số gửi ảnh: mình DÙNG `content_url`. Đây là cách phổ biến của Pancake,
   NHƯNG nếu Pancake báo bạn tên tham số khác, mở pancake_sender.js sửa đúng 1 chữ
   "content_url" trong hàm sendInboxImage là xong. (Bạn xác nhận lại với Pancake.)

2. Link ảnh phải để Pancake TẢI ĐƯỢC. Ảnh trong hash_index.json là link Google
   Drive. Đa số tải được, nhưng nếu log báo lỗi gửi ảnh thì có thể link Drive
   không cho tải -> lúc đó báo mình, sẽ đổi nguồn ảnh (vd host công khai).

## Chạy

Copy 3 file vào C:\AI_HTK_BOT_V5, chạy:
   node bot_worker_api_v3.js

Test: từ nick khác gửi 1 ảnh mẫu vào page -> bot phải trả lời + GỬI ẢNH mẫu đó.
Xem log dòng "IMG <mã>: gửi x/y ảnh".
