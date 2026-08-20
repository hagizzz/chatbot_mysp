# Fix3: nhiều mẫu trả lời đúng cấu trúc block (§17) + bắt ảnh tốt hơn

Chỉ thay 1 file: bot_worker_api_v3.js  (copy ĐÈ vào C:\AI_HTK_BOT_V5)

## Đã sửa

1. NHIỀU MẪU (2 mẫu trở lên) giờ trả lời ĐÚNG §17:
   - Mỗi mẫu: 1 câu "Dạ mẫu [tên] giá [giá] ạ" + 3 ảnh đúng mã đó.
   - Xong mẫu này mới sang mẫu kia (block riêng từng mẫu).
   - Câu xin SĐT/địa chỉ (dẫn dắt) chỉ gửi 1 LẦN ở cuối, không lặp.
   -> Phần này code tự dựng, không qua AI (vì AI không gửi ảnh được, không xen kẽ được).

2. 1 MẪU hoặc câu hỏi thường: vẫn qua AI như cũ (trả lời tự nhiên) + gửi 3 ảnh.

3. Bắt ảnh tốt hơn:
   - Nới khung gom ảnh 8s -> 15s (khách gửi nhiều ảnh rải vài giây vẫn gom đủ).
   - Log rõ: "Khách gửi N ảnh | nhận diện M từ ảnh".
   - Ảnh chưa nhận ra -> báo "còn X mẫu em kiểm tra lại" (không bỏ im).

## Lưu ý về "chưa bắt đủ ảnh"

Nếu khách gửi 5 ảnh mà log báo "nhận diện 3 từ ảnh" -> 2 ảnh kia CLIP chấm điểm
thấp hơn ngưỡng nên trượt. Đây là độ nhạy nhận diện, KHÔNG phải mất ảnh.
Muốn bắt nhiều hơn: chạy match_test.py trên ảnh bị trượt, xem điểm số, rồi hạ
MIN_SCORE trong embedding_core.py (gửi mình điểm số, mình canh ngưỡng cho).

Chạy lại: bấm đúp start_bot.bat
