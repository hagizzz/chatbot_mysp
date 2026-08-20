============================================================
  BỘ "LÊN ĐƠN POS" — HƯỚNG DẪN NHANH (đọc cái này trước)
============================================================

GÓI NÀY GỒM GÌ
--------------
  order_worker.js        - tiến trình chính (chạy: node order_worker.js)
  order_extractor.js     - suy ra đơn từ hội thoại  *** ĐÃ SỬA LỖI GIÁ ***
  order_config.js        - cấu hình riêng phần lên đơn
  order_store.js         - nhớ đơn đã/chưa lên (orders_state.json), chống trùng
  conversation_tags.js   - đọc/gắn/gỡ thẻ
  pos_client.js          - gọi Pancake POS API (tra mã->biến thể, tạo đơn)
  get_shop_id.js         - lấy shop_id từ api_key
  list_tags.js           - liệt kê id các thẻ
  kiem_tra_token.js      - kiểm Page token còn sống không
  kiem_tra_lendon.js     - *** MỚI: kiểm TẤT CẢ trước khi chạy ***
  kiem_tra_lendon.bat    - *** MỚI: bấm đúp để chạy kiểm tra ***
  .env.order.example     - *** MỚI: mẫu biến .env cần điền ***
  HUONG_DAN_LEN_DON.txt  - hướng dẫn chi tiết (lấy key, lấy id thẻ...)

CÁCH DÙNG (chép đè vào C:\AI_HTK_BOT_V5)
----------------------------------------
1. Chép TẤT CẢ file trên vào C:\AI_HTK_BOT_V5 (đè file cũ nếu trùng tên).
   (Các file phụ thuộc pancake_reader.js, pancake_sender.js, color_utils.js,
    product_reply_rules.js... ĐÃ CÓ SẴN trong thư mục đó — không cần chép lại.)

2. Mở .env.order.example, COPY các dòng vào file .env hiện có rồi điền giá trị
   thật (KHÔNG xóa biến cũ của bot tư vấn). Cách lấy từng giá trị: xem
   HUONG_DAN_LEN_DON.txt.

3. >>> BẤM ĐÚP kiem_tra_lendon.bat <<<
   - Nó kiểm: POS api_key + shop_id, Page token, các thẻ map đúng id chưa,
     và NẠP THỬ sản phẩm POS (chỗ hay hỏng nhất).
   - Báo "❌ CHƯA CHẠY ĐƯỢC" -> sửa theo dòng ❌ rồi bấm lại.
   - Báo "✅ SẴN SÀNG" -> qua bước 4.

4. CHẠY THỬ (KHÔNG tạo đơn thật): trong .env đặt  ORDER_DRY_RUN=true
   rồi:  node order_worker.js
   - Xem log in payload từng đơn. Soi mã/màu/size/sđt/địa chỉ/COD đúng chưa.

5. CHẠY THẬT: bỏ ORDER_DRY_RUN (hoặc đặt =false) rồi:  node order_worker.js
   - Chạy SONG SONG với bot tư vấn (2 cửa sổ CMD riêng), không xung đột.

ĐÃ SỬA GÌ TRONG GÓI NÀY
-----------------------
- order_extractor.js: giá sản phẩm trước đây chỉ đọc field "price", bỏ qua
  "salePrice" -> hàng đang SALE bị tính sai tiền, và vài mã chỉ có
  "originalPrice" thì ra 0đ (total_price gửi POS = 0). Đã đổi sang dùng
  getPrice() (salePrice -> price -> originalPrice) đúng như bot tư vấn.

CÒN PHẢI TỰ KIỂM VỚI POS THẬT (mình không có key nên không test live được)
-------------------------------------------------------------------------
- Bước "NẠP THỬ sản phẩm" trong kiem_tra_lendon, và lúc DRY_RUN: nếu báo
  "KHÔNG tra được biến thể" -> POS lưu MÃ ở chỗ khác / tên biến thể lạ.
  Gửi log đó để chỉnh productCodeCandidates / pickVariation trong pos_client.js.
