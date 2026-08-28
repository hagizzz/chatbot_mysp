# Fix6: nhận diện theo "mẫu nổi trội nhất" - không còn canh ngưỡng tuyệt đối

Thay 1 file: embedding_core.py (copy ĐÈ vào C:\AI_HTK_BOT_V5), chạy lại bot.

## Cách mới hoạt động
Trước: phải đạt điểm tuyệt đối >= 0.24 -> ảnh crop/zoom điểm tụt là trượt, phải canh tay.
Giờ: bot nhìn mẫu nào GIỐNG NHẤT và xem nó có VƯỢT TRỘI các mẫu khác không:
 - Mẫu top1 nổi trội rõ so với top2  -> NHẬN (dù điểm tuyệt đối không cao).
 - Top1 ~ top2 (mơ hồ, không rõ mẫu nào) -> KHÔNG nhận (báo chờ kiểm tra).
 - Ảnh hoàn toàn không liên quan (dưới sàn) -> KHÔNG nhận.

Vì crop/zoom làm điểm CỦA TẤT CẢ mẫu tụt như nhau, nên "thứ hạng" (mẫu nào giống nhất)
vẫn giữ -> cách này tự thích nghi với mọi kích thước ảnh, KHÔNG cần canh từng ảnh.

## Test
Gửi cả ảnh nguyên lẫn ảnh chụp màn hình bị cắt -> xem có nhận đúng kiểu dáng không.
Nếu vẫn còn vài ca mơ hồ nhận nhầm sang mẫu khác -> báo mình, mình siết "độ vượt trội".
Nếu ngược lại còn bỏ sót ảnh rõ ràng -> báo mình, mình nới ra.

## Nếu muốn mạnh hơn nữa (sau này)
Cách triệt để cho ảnh khó: build lại index có thêm các bản cắt của ảnh kho (để ảnh
cắt của khách khớp với bản cắt của kho). Việc này nặng (build lại), khi cần báo mình.

Chạy lại: bấm đúp start_bot.bat
