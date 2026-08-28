# Fix2: hết bịa, hết "chờ kiểm tra" sai chỗ, hết lặp xin SĐT

Copy 3 file ĐÈ vào C:\AI_HTK_BOT_V5:
- catalog_cache.js     (đè)  mỗi TÊN chỉ lấy 1 mẫu (tránh Grace 2026 lẫn 2025)
- reasoning_engine.js  (đè)  luật rõ: có dữ liệu thì trả lời thẳng, không có thì chờ, CẤM bịa
- bot_worker_api_v3.js (đè)  luôn truyền mẫu đã nhận cho AI + log rõ mẫu nào, giá nào

## Đã sửa
1. "Chờ kiểm tra" khi đã có dữ liệu: giờ có dữ liệu -> AI buộc trả lời thẳng, cấm nói chờ.
   Chỉ nói chờ khi THẬT SỰ không xác định được mẫu.
2. Bịa màu/giá/chất liệu: luật cấm bịa mạnh hơn; màu chỉ nói đúng trường color
   (1 màu thì nói 1 màu, không bịa 2 màu).
3. Grace sai giá: do trùng tên 2 mẫu -> nay mỗi tên chỉ lấy 1 (ưu tiên 2026).
4. Lặp xin SĐT/địa chỉ mỗi câu: chỉ xin khi tới bước chốt và chưa có; không lặp.

## Cách kiểm tra qua log (cửa sổ đen)
- Dòng "MẪU NHẬN DIỆN: Grace(MR0VX6349)=850000" -> biết bot tra ra đúng mẫu + giá chưa.
- Nếu thấy "KHÔNG xác định mẫu" mà đáng lẽ phải ra -> báo mình, đó là lỗi nhận diện tên.

Chạy lại: bấm đúp start_bot.bat
