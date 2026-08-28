# Fix11 (QUAN TRỌNG - sửa lỗi mình gây ra ở fix9): hết kẹt/đơ vì worker dựng lại

Copy 3 file ĐÈ vào C:\AI_HTK_BOT_V5, TẮT BOT MỞ LẠI:
- vision_resolver.js    (đè)
- embedding_worker.py   (đè)
- embedding_core.py     (đè)

## XIN LỖI - GỐC LÀ DO FIX9
Ở fix9 mình cho "quá giờ là GIẾT worker rồi dựng lại". Mà dựng lại = nạp lại model
10-20 giây. Gặp vài ảnh chậm -> giết, nạp lại, ảnh kế chờ nạp, lại giết... -> vòng
lặp dựng lại -> KẸT 10 PHÚT. Log có "[vision] worker thoát, code: null" rồi
"worker sẵn sàng" lặp lại = đúng cái này.

## CÁCH SỬA ĐÚNG (fix11)
1. KHÔNG giết worker khi 1 ảnh chậm nữa. Worker GIỮ SỐNG, không nạp lại model liên tục.
2. Đánh ID cho từng yêu cầu ảnh -> phản hồi trễ tự bị bỏ qua, không làm lệch hàng đợi
   (đây là lý do trước phải giết để "dọn hàng" - giờ không cần).
3. Rút ngắn thời gian tải 1 ảnh (tối đa ~24s thay vì ~75s) -> 1 ảnh xấu không ngốn lâu.
4. Vẫn có timeout mọi bước -> bot KHÔNG treo vô hạn, nhưng cũng KHÔNG dựng lại worker
   vô tội vạ.

=> Bot chạy mượt, không còn vòng lặp nạp lại model.

## Sau khi chạy, log ĐÚNG sẽ là:
- "[vision] worker sẵn sàng, số mẫu: ..." xuất hiện 1 LẦN lúc khởi động (không lặp lại
  nhiều lần nữa).
- Ảnh khó lắm thì thấy "[vision] match quá giờ -> bỏ tấm này, worker vẫn chạy tiếp"
  rồi bot đi tiếp NGAY (worker KHÔNG thoát/nạp lại).
- KHÔNG còn "[vision] worker thoát, code: null" lặp đi lặp lại.

Nếu vẫn thấy "worker thoát" lặp nhiều lần -> chụp gửi mình, có thể là máy thiếu RAM.

## Nhắc lại
- ĐỪNG chạy update_index.py cùng lúc với bot.
- Nên bật Google Docs API (log vẫn báo disabled).
