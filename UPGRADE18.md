# Fix14: GẮN ĐÈN BÁO từng bước để biết CHÍNH XÁC kẹt ở đâu

Copy 4 file ĐÈ vào C:\AI_HTK_BOT_V5, tắt bot mở lại:
- embedding_worker.py   (đè)
- embedding_core.py     (đè)
- vision_resolver.js    (đè)
- bot_worker_api_v3.js  (đè)

## Mục đích
M�nh không đoán nữa. Bản này in rõ từng bước để biết kẹt ở đâu:
- "[vision] dang nap model..."            -> worker bắt đầu nạp
- "[vision] worker san sang sau Xs ..."   -> nạp xong sau X giây (biết model nạp lâu không)
- "[vision] dang cho worker nap model..." -> bot phải chờ worker (ảnh đến lúc đang nạp)
- "[vision] dang tai anh..."              -> bắt đầu tải ảnh khách gửi
- "[vision] [time] tai_anh=...ms nhan_dien=...ms" -> tải + nhận diện mất bao lâu

## CÁCH TEST ĐÚNG (rất quan trọng)
1. Bấm start_bot.bat. ĐỢI tới khi thấy dòng:
      [vision] worker san sang sau Xs, so mau: 12387
   (ghi nhớ X = bao nhiêu giây)
2. SAU ĐÓ mới gửi 1 ảnh cho bot.
3. Chụp đoạn log từ "dang tai anh..." tới hết, gửi mình. Đặc biệt 2 dòng:
      [vision] worker san sang sau Xs ...
      [vision] [time] tai_anh=...ms nhan_dien=...ms

## Đã sửa thêm
- Không thử lại khi 1 ảnh quá giờ (trước đây timeout còn thử lại -> chậm gấp đôi).

## TỪ CON SỐ, MÌNH SẼ BIẾT:
- san sang sau 60s+   -> NẠP MODEL quá lâu (máy yếu / file model lớn) -> tối ưu nạp.
- tai_anh 10000ms+    -> TẢI ẢNH chậm (đường truyền) -> đổi cách tải.
- nhan_dien 5000ms+   -> MÁY chạy model nặng -> giảm tải / đổi model nhỏ.

Gửi mình mấy con số đó, mình chốt được nguyên nhân thật và sửa trúng.

Chạy lại: bấm đúp start_bot.bat
