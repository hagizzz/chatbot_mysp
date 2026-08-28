# Fix4: bắt đủ ảnh khi gửi nhiều (retry) + không báo nhầm mẫu cũ

Copy 2 file ĐÈ vào C:\AI_HTK_BOT_V5:
- embedding_core.py     (đè)  tải ảnh thử lại 3 lần
- bot_worker_api_v3.js  (đè)  retry nhận diện + sửa logic mẫu cũ

## Phân tích lỗi (quan trọng)
Cùng 1 ảnh: gửi 1 mình thì nhận ra, gửi chung nhiều ảnh lại trượt
=> KHÔNG phải lỗi nhận diện (ảnh đó nhận được). Là lỗi TẢI ẢNH chập chờn khi
   tải nhiều tấm liên tiếp -> vài tấm rớt/timeout.

## Đã sửa
1. Thử lại khi tải/nhận diện ảnh lỗi tạm thời (3 lần, có giãn nhịp) ở cả Python
   và Node. Ảnh "trượt vì tải lỗi" giờ sẽ được thử lại -> bắt đủ hơn.
   (Riêng ảnh điểm thấp thật - LOW_CONFIDENCE - thì không thử lại, vì là nhận diện.)
2. Khách gửi ảnh MỚI mà không nhận ra mẫu nào -> báo "chờ kiểm tra", KHÔNG lôi
   2 mẫu cũ ra báo lại (lỗi trước đây).
3. Log rõ hơn: "Khách gửi N ảnh | nhận diện M từ ảnh | trượt K".

## Test
Gửi 4-5 ảnh cùng lúc, xem log dòng "Khách gửi 4 ảnh | nhận diện 4 ... | trượt 0".
Nếu vẫn còn trượt, xem dòng VISION của tấm trượt ghi reason gì:
- DOWNLOAD_FAIL/TIMEOUT/WORKER -> vẫn là tải lỗi, báo mình tăng số lần thử.
- LOW_CONFIDENCE -> là điểm nhận diện thấp thật, lúc đó canh MIN_SCORE.

Chạy lại: bấm đúp start_bot.bat
