# Fix15 (TRÚNG GỐC RỄ): worker gửi tín hiệu "sẵn sàng" cho Node -> HẾT TREO

Chỉ thay 1 file: embedding_worker.py (copy ĐÈ vào C:\AI_HTK_BOT_V5), tắt bot mở lại.

## GỐC RỄ THẬT SỰ CỦA "ĐỨNG ĐƠ MÃI KHÔNG TRẢ LỜI"
Log cho thấy: "worker san sang sau 7s" (worker nạp xong, máy KHỎE) NHƯNG Node vẫn
"dang cho worker nap model" lặp mãi -> Node KHÔNG BIẾT worker đã sẵn sàng.

Lý do: worker chỉ in chữ "san sang" ra màn hình (stderr), nhưng Node chờ một
TÍN HIỆU JSON {"ready":true} qua kênh stdout. Worker KHÔNG gửi tín hiệu đó
-> Node chờ vô vọng -> mỗi ảnh treo tới 60s -> "đứng đơ".

KHÔNG phải máy yếu (nạp chỉ 7s), KHÔNG phải mạng, KHÔNG phải nhận diện.
Là Node và worker "nói chuyện lệch kênh".

## ĐÃ SỬA
embedding_worker.py giờ gửi đúng dòng {"ready":true,"count":...} qua stdout ngay
khi nạp xong -> Node nhận biết worker sẵn sàng -> xử lý ảnh NGAY, không chờ.
(Đã mô phỏng kiểm chứng: Node bắt được ready, không treo.)

## SAU KHI CHẠY - phải thấy:
- "[vision] worker san sang sau Xs ..." (như cũ)
- Gửi ảnh -> KHÔNG còn "dang cho worker nap model" lặp lại.
- Thấy ngay "[vision] dang tai anh..." rồi "[vision] [time] tai_anh=.. nhan_dien=.."
  rồi REPLY. Nhanh.

Nếu vẫn treo -> chụp gửi mình (nhưng mô phỏng cho thấy đã thông).

Chạy lại: bấm đúp start_bot.bat
