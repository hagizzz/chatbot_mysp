# Fix12 (QUAN TRỌNG): trả lại tốc độ nhanh như fix4 - hết nạp lại model

Copy 3 file ĐÈ vào C:\AI_HTK_BOT_V5, TẮT BOT MỞ LẠI:
- embedding_core.py     (đè)  TẮT gọi HuggingFace -> nạp model nhanh
- vision_resolver.js    (đè)  worker giữ sống, không nạp lại lung tung
- embedding_worker.py   (đè)

## GỐC CHẬM (từ log của bạn)
1. Mỗi lần worker khởi động, nó gọi lên HuggingFace ("unauthenticated requests to
   the HF Hub ... rate limits") -> bị giới hạn tốc độ -> nạp model rất chậm.
2. Resolver mình sửa ở fix9/11 khiến worker phải nạp lại nhiều lần
   ("worker sẵn sàng" xuất hiện 2 lần trong log = nạp 2 lần).
=> Cộng lại thành "mãi không trả lời". Fix4 nhanh vì hồi đó resolver đơn giản,
   worker nạp 1 lần rồi giữ.

## ĐÃ SỬA
1. embedding_core.py: đặt HF_HUB_OFFLINE -> dùng model ĐÃ TẢI SẴN trong máy,
   KHÔNG gọi HuggingFace nữa -> nạp nhanh, không bị giới hạn tốc độ.
2. vision_resolver.js: gọn lại như fix4 - worker GIỮ SỐNG (chỉ dựng lại khi nó
   thực sự thoát), không tự nạp lại. Vẫn an toàn nhờ đánh ID từng yêu cầu.

## SAU KHI CHẠY - log ĐÚNG:
- "[vision] worker sẵn sàng, số mẫu: ..." chỉ hiện 1 LẦN lúc khởi động.
- KHÔNG còn dòng "Warning ... HF Hub" lặp lại mỗi lần có ảnh.
- Trả lời nhanh trở lại như fix4.

## NẾU VISION KHÔNG CHẠY sau khi đổi (hiếm)
Nếu báo lỗi không nạp được model (do chưa có cache), MỞ embedding_core.py xóa 3 dòng
os.environ HF_HUB_OFFLINE/TRANSFORMERS_OFFLINE ở đầu file, lưu, chạy lại 1 lần để nó
tải model, rồi thêm lại sau. (Bình thường máy bạn đã có cache nên không cần.)

Chạy lại: bấm đúp start_bot.bat
