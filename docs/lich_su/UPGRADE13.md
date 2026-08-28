# Fix9 (QUAN TRỌNG): hết TREO/ĐƠ + đang tư vấn size không tự chốt

Copy 2 file ĐÈ vào C:\AI_HTK_BOT_V5, tắt bot mở lại:
- vision_resolver.js   (đè)  vá lỗi treo vô hạn
- reasoning_engine.js  (đè)  đang tư vấn size thì không tự "lấy size X"

## GỐC CỦA TREO (tìm ra trong vision_resolver.js)
Chỗ "await readyPromise" (chờ worker nhận diện sẵn sàng) KHÔNG có timeout.
Khi worker khởi động lại mà khựng/không in "ready" -> bot CHỜ MÃI MÃI -> treo
đúng ở dòng "Tin: ... image: [Photo]" (như log của bạn).

ĐÃ VÁ 3 chỗ:
1. Chờ worker sẵn sàng: tối đa 30s, quá thì coi như lỗi (không chờ vô hạn).
2. Mỗi ảnh: tối đa 30s, quá thì bỏ tấm đó + GIẾT worker dựng lại sạch.
3. Worker chết -> giải phóng mọi tiến trình đang chờ, không ai bị kẹt.
=> Bot KHÔNG BAO GIỜ đứng im vì worker nữa. Ảnh khó lắm thì báo "chờ kiểm tra",
   chứ không treo cả bot.

## Lỗi size khi tư vấn
Khách hỏi "45kg mặc size gì" -> bot tư vấn S/freesize NHƯNG lại tự chốt "lấy size M".
Đã sửa: khi đang TƯ VẤN size, bot chỉ gợi ý, KHÔNG tự nói "em lấy size X".
Chỉ chốt size khi khách đã chọn.

## Sau khi chạy
- Gặp ảnh khó/worker phải dựng lại, bạn sẽ thấy log "[vision] match TIMEOUT ->
  dựng lại worker" rồi bot ĐI TIẾP (không đứng im). Đó là hành vi đúng.
- Nhắc lại: ĐỪNG chạy update_index.py cùng lúc với bot.

## Vẫn nên làm (ngoài bot)
- Bật Google Docs API (log vẫn báo disabled) để bot đọc kịch bản từ Google Doc.
