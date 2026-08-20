# Fix10: size - xác nhận lại khi mâu thuẫn, không tự chốt đè dữ liệu cũ

Copy 2 file ĐÈ vào C:\AI_HTK_BOT_V5, tắt bot mở lại:
- reasoning_engine.js   (đè)
- bot_worker_api_v3.js  (đè)

## Vấn đề
Bộ nhớ đã lưu khách size M. Khách hỏi "45kg mặc size gì" -> bot tư vấn S
NHƯNG lại tự chốt "em lấy size M" -> vừa nói S vừa chốt M, mâu thuẫn, máy móc.
Người thật sẽ xác nhận lại: "45kg mặc S ạ. Mà em đang lưu size M của mình,
chị lấy S hay vẫn M ạ? Hay mình mua tặng ai ạ?"

## Đã sửa (2 lớp)
1. Luật AI: khi tư vấn size mà KHÁC size đã lưu -> phải DỪNG HỎI XÁC NHẬN,
   không tự chốt. Trùng thì xác nhận luôn. Không vừa tư vấn size này vừa
   chốt size khác trong 1 câu.
2. Chặn ở CODE: khi khách đang HỎI tư vấn size (có kg/chiều cao/"size gì"),
   tự GỠ câu "em lấy size X" ra khỏi câu trả lời -> chắc chắn không tự chốt
   dù AI có lỡ viết.

## Sau khi chạy
Test: lưu trước size M cho 1 khách, rồi hỏi "45kg mặc size gì" -> bot phải
tư vấn S và HỎI LẠI chị lấy S hay M, KHÔNG tự chốt M.
