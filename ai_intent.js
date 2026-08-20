// ai_intent.js
// ============================================================================
// BỘ "AI ĐỌC TIN ĐẦU TIÊN" (phương án B - bản LAI AN TOÀN).
// Vai trò: AI đọc tin MỚI NHẤT của khách rồi CHỈ GẮN NHÃN (size? địa chỉ? hỏi
// giá? chốt đơn? hỏi vải?...) + rút vài trường (size, có phải địa chỉ...).
// AI **KHÔNG** tự chế giá/đơn/sđt — phần tiền/đơn vẫn 100% do code làm.
// Code dùng nhãn này để ĐỊNH TUYẾN cho đúng -> hết cảnh "đọc 2 hiểu 1".
//
// Trả về object an toàn (không bao giờ throw). Lỗi/timeout -> {ok:false} ->
// bot_worker cứ chạy thuần code như cũ (không phụ thuộc AI để hoạt động).
// ============================================================================
require("dotenv").config();
const turnLog = require("./turn_log");
const OpenAI = require("openai");

let _client = null;
function client() {
  if (_client) return _client;
  if (!process.env.OPENAI_API_KEY) return null;
  _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

const KINDS = [
  // --- KHÁCH CHO DỮ LIỆU ---
  "SIZE",          // khách CHO size ("L em", "mặc M")
  "WEIGHT_HEIGHT", // cân nặng/chiều cao/số đo ("45kg 1m50")
  "ADDRESS",       // khách CHO địa chỉ giao
  "SEND_ADDRESS_LATER", // khách BÁO sẽ gửi địa chỉ sau ("lát gửi địa chỉ","tí gửi sau") — ghi nhận, chờ, KHÔNG giục
  "PHONE",         // khách cho số điện thoại
  // --- ĐƠN ---
  "ORDER_CLOSE",   // chốt/đồng ý lấy ("lấy mẫu này", "chốt đơn")
  "ADD_TO_ORDER",  // lấy THÊM mẫu vào đơn đã có ("lấy thêm cái này nữa")
  "CANCEL_ORDER",  // huỷ đơn / thôi không lấy nữa
  "ORDER_STATUS",  // hỏi ĐÃ GỬI HÀNG CHƯA / đơn tới đâu rồi / khi nào nhận (đã đặt)
  "PAYMENT_CONFIRM", // "ck rồi nhé" / "nhận được tiền chưa" (xác nhận đã trả tiền)
  // --- HẬU MÃI / SAU MUA (hầu hết -> NGƯỜI THẬT) ---
  "EDIT_ORDER",    // sửa đơn ĐÃ đặt (chưa ship): đổi giúp địa chỉ/sđt/size -> người thật sửa POS
  "EXCHANGE_REQUEST", // ĐỔI size/mẫu SAU khi đã mua (khác RETURN_POLICY = chỉ HỎI chính sách) -> người thật
  "DEFECT_REPORT", // nhận hàng GIAO SAI/THIẾU/LỖI -> người thật
  "REFUND_REQUEST",// đòi TRẢ LẠI lấy tiền / hoàn tiền -> người thật
  "CK_PROOF",      // khách GỬI ẢNH bill chuyển khoản -> người thật kiểm
  "REFUSE_DELIVERY", // bom hàng / không nhận / "đừng gửi nữa" -> người thật
  "DELIVERY_PREFERENCE", // dặn giờ giao / gọi trước khi giao -> ghi nhận / người thật
  // --- TIỀN ---
  "PRICE_ASK",     // hỏi giá 1 mẫu ("bao nhiêu", "giá sao")
  "TOTAL_PAYMENT", // hỏi TỔNG bill / tổng tiền tất cả
  "DISCOUNT",      // hỏi giảm giá / sale / bớt / khuyến mãi
  "PRICE_OBJECTION",// CHÊ GIÁ / thấy đắt-cao-mắc / phân vân VÌ giá ("giá hơi cao", "đắt quá", "mắc thế", "bên kia rẻ hơn") -> thuyết phục GIÁ TRỊ + freeship
  "PRICE_DISCREPANCY",// THẮC MẮC 2 GIÁ VÊNH ("lúc 950 lúc 890", "sao 2 giá", "vừa báo 890 giờ 950") — tưởng 1 mẫu báo 2 giá. THỰC RA là 2 MẪU khác nhau -> giải thích, KHÔNG phải chê giá.
  "PAYMENT_METHOD",// hỏi cách trả: stk / chuyển khoản / momo / qr
  // --- HỎI SẢN PHẨM (thông tin) ---
  "STOCK",         // còn hàng / còn size không
  "COLOR_ASK",     // hỏi màu / còn màu khác / có mấy màu
  "SIZE_CHART",    // xin BẢNG size / thông số
  "SIZE_ADVICE",   // tư vấn nên lấy size nào (theo cân nặng/chiều cao)
  "SIZE_CONSISTENCY", // hỏi size CÁC MẪU có GIỐNG NHAU không / size shop có đồng nhất không (khác SIZE_ADVICE/SIZE_CHART)
  "IMAGE_REQ",     // xin xem thêm ẢNH
  "VIDEO_REQ",     // xin xem VIDEO / clip / mẫu thật quay / lên người / ngoài đời (KHÁC IMAGE_REQ)
  "BACK_VIEW",     // xin xem ảnh MẶT SAU / mặt lưng
  "SIMILAR_MODELS",// còn mẫu nào tương tự / mẫu khác
  "DEFER_DECISION",// khách HẸN SAU / TỪ CHỐI KHÉO: "để mình suy nghĩ/cân nhắc/tham khảo thêm", "e mua e liên hệ lại", "khi nào cần em nhắn shop", "từ từ đã", "cảm ơn để sau" -> KHÔNG bám đuổi xin thông tin, dùng kịch bản lùi-nhẹ thuyết phục mềm
  "COMPARE_MODELS",// nhờ CHỌN GIÚP mẫu/màu nào đẹp hơn trong số đã xem (đòn chốt đơn)
  "MULTI_MODEL",   // khách quan tâm/nhắm NHIỀU mẫu cùng lúc, CHƯA chốt riêng 1 ("mẫu nào cũng thích", "thích cả mấy mẫu", "lấy mỗi thứ 1 cái", cho số đo khi đang xem CẢ CỤM) -> tư vấn CHUNG cả cụm, KHÔNG khoá 1 mẫu
  "BROWSE_CATALOG",// xin XEM HÀNG: hàng mới / đồ sale / có loại nào / xem hết mẫu
  "OCCASION_QA",   // hỏi mẫu cho DỊP: đi biển / đi tiệc / đi cưới / công sở
  "FIT_SUITABILITY", // hợp DÁNG/tông da: da ngăm hợp ko / người mập-lùn mặc đẹp ko / có tôn dáng ko (KHÔNG gồm bầu, KHÔNG gồm số đo)
  "PREGNANCY_FIT",   // BẦU / SAU SINH / cho con bú mặc được không (tách riêng để code hỏi 'mấy tháng' + nhường người, KHÔNG đụng câu hợp dáng)
  "MODEL_REFERENCE", // người mẫu cao/nặng/mặc size gì / sao mẫu mặc size khác
  "BUY_SEPARATE",  // mua TÁCH LẺ áo/quần của set (liên quan giá+tồn)
  "AUTHENTICITY_QA", // giống hình ko / ảnh thật shop chụp ko / có chính hãng ko
  "PRODUCT_DETAIL_QA", // chi tiết KỸ THUẬT mẫu: có khoá/kéo/túi/dây chỉnh/độ dài cụ thể -> người thật (bot dễ sai)
  "STYLING_QA",    // "mặc kiểu gì / phối sao cho đẹp" -> người thật
  "STORE_STOCK",   // "có sẵn ở CỬA HÀNG ko" (tồn tại cửa hàng, bot không biết) -> người thật
  "RESTOCK_PREORDER",// còn hàng hay ĐẶT TRƯỚC / khi nào có hàng lại (khác STOCK = còn/hết ngay)
  "MATERIAL_QA",   // chất liệu/co giãn/form/nóng/nhăn/lót/đệm (tư vấn) — xem thêm concern
  "WASH_CARE",     // hỏi GIẶT GIŨ: giặt máy được ko / có ra màu / có phai / bảo quản
  "SET_TYPE",      // hỏi MẪU liền hay rời / có phải set / set gồm gì / phần dưới là gì (trả lời theo cột category)
  // --- VẬN CHUYỂN / CHÍNH SÁCH ---
  "DELIVERY_QA",   // ship/phí ship/bao lâu/kiểm hàng/COD
  "RETURN_POLICY", // đổi/trả/bảo hành/không vừa đổi được không
  "STORE_ADDRESS", // shop ở đâu / qua shop / mua trực tiếp
  "STORE_VISIT",   // khách BÁO/HẸN SẼ GHÉ cửa hàng xem trực tiếp ("gần Bà Triệu sẽ ghé", "mai qua xem", "tiện qua thử")
  "ASK_SHOPEE",    // HỎI có bán trên shopee không
  "ASK_TIKTOK",    // HỎI có bán trên tiktok không
  "TIKTOK_ORDER",  // ĐÃ đặt / muốn ĐI-LÊN đơn qua kênh TikTok -> NGƯỜI THẬT (KHÔNG phải hỏi có bán tiktok)
  "SAME_SHOP_QA",  // "PHOM với Mys.P có phải 1 ko", "2 page này cùng shop hả", "Miss.P với Phom là 1 à" -> đúng, cùng 1 hệ thống
  "WHOLESALE",     // hỏi SỈ / buôn / CTV / lấy về bán / giá sỉ -> NGƯỜI THẬT
  // --- XÃ GIAO / KHÁC ---
  "GREETING",      // chào/ping mở đầu ("alo","ib","shop ơi")
  "THANKS",        // cảm ơn / ok / vâng (ack)
  "POST_ORDER_CHITCHAT", // xã giao SAU CHỐT: khen shop / tạm biệt / chúc / tám vui (KHÔNG nghiệp vụ) -> câu ấm khép hội thoại
  "POST_ORDER_REQUEST",  // DẶN DÒ SAU CHỐT: "gửi chuẩn hàng nhe", "gói kỹ", "gửi đúng mẫu/size", "đừng nhầm", "đóng cẩn thận", "chọn hàng đẹp" -> CAM KẾT trấn an, KHÔNG chốt lại/follow
  "POST_ORDER_CONFIRMED", // KHÁCH KHẲNG ĐỊNH ĐÃ MUA/ĐÃ LẤY RỒI: "c lấy rồi mà e", "chị đặt rồi nha", "mua rồi mà", "đã chốt rồi" (phản hồi khi shop hỏi lấy thêm ko) -> xác nhận nhẹ, KHÔNG mời chốt/lên đơn lại
  "COMPLAINT",     // bực bội / khiếu nại / phàn nàn (cần người thật)
  "URGENT",        // KHÁCH có DEADLINE/gấp: "mai chị đi", "T4 là đi rồi", "cần gấp", "trước thứ 5", đi tiệc/cưới -> người thật
  "WAITING_REPLY", // KHÁCH GIỤC/ĐÒI phản hồi: "sao chưa trả lời", "B ơi chưa có câu trả lời ạ", "chưa rep em", "alo shop ơi", "có ai ko" -> người thật (đang chờ shop/NV xử lý, KHÔNG báo giá)
  "CONSULT_FAMILY", // khách ĐỂ HỎI NGƯỜI NHÀ rồi mới quyết ("để chị hỏi con gái", "hỏi chồng đã", "bàn với ông xã", "thông qua vợ") -> GẮN NGƯỜI THẬT, KHÔNG gặng màu/size
  "OTHER"          // còn lại
];

const SYS = `Bạn là BỘ PHÂN LOẠI ý định tin nhắn khách cho 1 shop thời trang nữ (Việt Nam).
Nhiệm vụ: đọc TIN MỚI NHẤT của khách và phân loại. CHỈ trả JSON, KHÔNG giải thích, KHÔNG thêm chữ nào ngoài JSON.
TUYỆT ĐỐI KHÔNG bịa giá, KHÔNG chốt đơn, KHÔNG soạn câu trả lời. Bạn chỉ GẮN NHÃN.
DÙNG "Bối cảnh" (đã có đơn hay chưa, đã có size/sđt/địa chỉ) + "Hội thoại gần đây" để HIỂU đúng TIN MỚI NHẤT (câu ngắn, tham chiếu, đã mua hay chưa mua). NHƯNG LUÔN gắn nhãn cho TIN MỚI NHẤT — TUYỆT ĐỐI KHÔNG gắn nhãn cho tin cũ trong hội thoại.

Hiểu tiếng Việt có dấu/không dấu, viết tắt, teencode. Ví dụ quan trọng:
- "L em" / "M ạ" / "lấy size L" -> SIZE.
- "45kg 1m50" / "cao 1m6 nặng 50" / "m55 42kg" (viết tắt 1m55) / "m55 42kg mẫu xanh size gì được ạ" (số đo + chọn màu + hỏi size trong MỘT câu: ưu tiên số đo) -> WEIGHT_HEIGHT, do_luong điền đủ ("1m55/42kg").
- LUẬT CỜ do_luong (NGỮ CẢNH SỐ ĐO - đọc TOÀN hội thoại, không chỉ tin cuối): khách ĐÃ cho chiều cao/cân nặng ở BẤT KỲ tin nào -> do_luong PHẢI có giá trị (gom đủ cao+cân nếu có). Khách hỏi "size gì/mặc vừa không" mà tin TRƯỚC đã khai số đo -> kind=SIZE_ADVICE + do_luong=<số đã khai> (hệ thống sẽ tư vấn thẳng, KHÔNG hỏi lại). CHƯA TỪNG khai -> do_luong=null (hệ thống mới được hỏi).
- "21A Lê Thị Kinh Nhà Bè" (số nhà + đường/khu vực) -> ADDRESS, is_address=true, wants_order=true.
- "lát gửi địa chỉ sau" / "tí nữa gửi địa chỉ" / "để xíu gửi đc" / "có địa chỉ gửi sau nha" (BÁO sẽ gửi, CHƯA gửi địa chỉ nào) -> SEND_ADDRESS_LATER.
- "gửi chị" / "gửi đi" / "gửi mình" / "gửi e xem" / "gửi cho c" / "gửi với" (CỤT, KHÔNG hề có chữ "địa chỉ/đc/nhà/đường") -> ĐÂY KHÔNG PHẢI SEND_ADDRESS_LATER. Khách chỉ nói cụt (ý: shop gửi thêm ảnh/thông tin, hoặc nói trống). SEND_ADDRESS_LATER CHỈ khi câu có chữ "địa chỉ" (hoặc "đc"/"nhà"/"đường") + ý HẸN GỬI SAU. Câu "gửi" trống mà chưa có size/số đo -> để nhãn OTHER (code sẽ xin chiều cao cân nặng). TUYỆT ĐỐI đừng suy "gửi chị" thành "gửi địa chỉ".
- "gửi về đây cho c" / "gửi về đấy nhé" / "ship về đó" / "giao về đây" KHI tin có địa chỉ HOẶC "Tin shop ngay trước" đang xin/xác nhận địa chỉ (vd shop vừa hỏi "địa chỉ này ở ... đúng không", "giao về đây đúng không", "cho em xin địa chỉ") -> ĐÂY LÀ XÁC NHẬN GIAO về địa chỉ đã có, KHÔNG phải SEND_ADDRESS_LATER -> ORDER_CLOSE, wants_order=true. (Chỉ khi CHƯA có địa chỉ nào và shop không hỏi địa chỉ thì "gửi về đây" mới để nhãn thường.)
- DÙNG "Tin shop ngay trước" để hiểu câu NGẮN của khách: nếu shop VỪA hỏi xác nhận TỈNH/ĐỊA CHỈ ("...ở [tỉnh] đúng không chị", "giao về đây đúng không") mà khách trả lời ĐỒNG Ý ngắn ("ừ", "ukm", "uk e", "ok", "vâng", "đúng rồi", "phải", nhắc lại TÊN TỈNH như "Bắc Ninh", "BN mới", "Hà Nội nhé") -> ĐÂY LÀ XÁC NHẬN CHỐT, KHÔNG phải PRICE_ASK/GREETING -> ORDER_CLOSE, wants_order=true. (vd shop hỏi "địa chỉ này ở Bắc Ninh đúng không chị?" + khách "ukm e, BN mới" -> ORDER_CLOSE.)
- QUY TẮC NGỮ CẢNH (CỰC QUAN TRỌNG cho câu CỤT/MƠ HỒ): LUÔN đọc "Tin shop ngay trước" + "Hội thoại gần đây" để hiểu khách đang ĐÁP lại điều gì. Cùng 1 câu khách nhưng shop hỏi khác nhau -> nhãn khác nhau:
  • Shop vừa "xin chiều cao/cân nặng" + khách đáp "gửi chị"/"đây"/"ok"/số đo -> liên quan SIZE/số đo (WEIGHT_HEIGHT nếu có số, hoặc OTHER nếu trống), KHÔNG phải SEND_ADDRESS_LATER/ORDER_CLOSE.
  • Shop vừa "xin số điện thoại + địa chỉ" + khách "gửi sau"/"lát gửi" -> SEND_ADDRESS_LATER.
  • Shop vừa "báo giá" + khách "hơi cao"/"đắt thế" -> PRICE_OBJECTION (chê giá), KHÔNG phải WEIGHT_HEIGHT dù có chữ "cao".
  • Shop vừa "liệt kê cơ sở/showroom" + khách nói tên địa danh ngắn -> STORE_ADDRESS.
  Nếu "Tin shop ngay trước" KHÔNG xin địa chỉ thì câu "gửi..." trống TUYỆT ĐỐI KHÔNG suy thành gửi-địa-chỉ.
- "0901234567" -> PHONE.
- "lấy mẫu này" / "chốt" / "ok đặt 1 cái" -> ORDER_CLOSE, wants_order=true.
- "lấy màu này" / "lấy màu giống ảnh" / "lấy màu như hình" / "lấy màu đó" / "chọn màu hồng" / "mình lấy màu be" / "lên đơn màu xanh" (khách CHỌN MÀU để lên đơn, đang trong bước chốt) -> ORDER_CLOSE, wants_order=true.
- "lấy thêm cái này nữa" / "thêm mẫu này vào đơn" -> ADD_TO_ORDER.
- "huỷ đơn" / "thôi ko lấy nữa" / "ko lấy hàng đâu" / "thôi mình ko lấy" / "ko mua nữa đâu" -> CANCEL_ORDER.
- "shop gửi hàng chưa" / "đơn tới đâu rồi" / "đặt mấy ngày rồi chưa thấy hàng" / "sao giờ chưa giao" (khách ĐÃ ĐẶT, TRA tình trạng đơn HOẶC phàn nàn chưa nhận) -> ORDER_STATUS.
- "em ck rồi nhé" / "shop nhận được tiền chưa" -> PAYMENT_CONFIRM.
- "bao nhiêu" / "giá sao" / "nhiêu vậy" -> PRICE_ASK, asks_price=true.
- VIẾT TẮT HỎI GIÁ: "bn", "bnn", "bn e", "bn em", "bnn ak", "bn ạ", "bao nhiu", "nhiu", "nhiu vậy", "ngiu", "giá nhiu" -> đều là HỎI GIÁ -> asks_price=true.
- QUAN TRỌNG: nếu trong tin có TỪ HỎI GIÁ ("bao nhiêu"/"bn"/"bnn"/"giá"/"nhiu"...) thì asks_price=true KỂ CẢ khi kind là FIT_SUITABILITY / GREETING / MATERIAL_QA / PRODUCT_DETAIL_QA... (vd "Bn em" + "Trễ vai có mặc lên ko" -> kind=FIT_SUITABILITY NHƯNG asks_price=true; "Bnn ak" + ảnh -> kind=GREETING NHƯNG asks_price=true). ĐỪNG để sót cờ asks_price chỉ vì câu còn có ý khác.
- "tư vấn cho chị thiết kế Giannal màu hồng" / "cho em xem mẫu Lerina" / "mẫu Gwenelle còn ko" / "tư vấn giúp e set Aria" / "xem váy Féline với" (khách MỞ ĐẦU nêu TÊN 1 mẫu/thiết kế cụ thể, muốn được tư vấn/xem/báo giá mẫu đó — KỂ CẢ khi không có chữ "giá") -> PRICE_ASK, asks_price=true. TUYỆT ĐỐI KHÔNG để thành OTHER: câu có TÊN MẪU rõ ràng thì luôn là khách muốn xem/mua mẫu đó.
- MẪU CHƯA ĐƯỢC BÁO GIÁ: nếu khách hỏi THUỘC TÍNH của 1 mẫu (màu/size/tồn kho/chất liệu/dáng...) — vd "Giannal có sẵn size nào?", "Lerina còn màu gì", "set Aria vải dày ko" — MÀ "Tin shop ngay trước" KHÔNG hề có giá (không có chữ "giá"/"đ"/"…000") -> ngoài kind đúng (STOCK/COLOR_ASK/MATERIAL_QA/...), VẪN đặt asks_price=true (để code báo giá + gửi ảnh mẫu kèm theo). Nếu "Tin shop ngay trước" ĐÃ có giá mẫu đó rồi thì KHÔNG cần đặt asks_price (chỉ trả lời đúng thuộc tính khách hỏi).
- "tổng bao nhiêu" / "tính hết bao nhiêu" / "tổng bill" -> TOTAL_PAYMENT.
- "giảm giá ko" / "sale ko" / "bớt chút" / "chương trình sinh nhật giảm 50% hả" / "đang có ct gì" / "sale sinh nhật còn không" / "ưu đãi 50% áp mẫu này ko" -> DISCOUNT (mọi câu hỏi về sale/chương trình khuyến mãi/ưu đãi đang chạy).
- "giá hơi cao" / "giá hơi cao e" / "hơi đắt" / "đắt quá" / "mắc thế" / "mắc quá e" / "sao đắt vậy" / "giá chát quá" / "giá cao quá ạ" / "cao thế" / "đắt đỏ ghê" (khách CHÊ GIÁ / thấy đắt-cao-mắc, đang phân vân VÌ giá) -> PRICE_OBJECTION. Đây KHÁC: (a) DISCOUNT = khách HỎI có giảm/sale/bớt không (xin ưu đãi cụ thể); (b) PRICE_ASK = khách HỎI giá bao nhiêu (chưa biết giá); (c) COMPLAINT = khách BỰC BỘI về dịch vụ/hàng lỗi/giao sai. CHÊ GIÁ chỉ là thấy đắt -> bot thuyết phục giá trị + freeship, KHÔNG phải khiếu nại. TUYỆT ĐỐI đừng gắn "giá hơi cao/đắt quá" thành COMPLAINT.
- "bên kia bán rẻ hơn" / "chỗ khác có 500k" / "shop khác rẻ hơn nhiều" / "trên mạng bán rẻ hơn" / "mẫu này nơi khác có 300" (khách SO SÁNH giá với shop khác, chê bên mình đắt hơn) -> PRICE_OBJECTION (code có câu riêng nói khác biệt thiết kế/thương hiệu). KHÁC DISCOUNT (xin giảm cho mẫu đang xem).
- "lúc 950 lúc 890" / "lúc thì 890 lúc thì 950" / "sao vừa báo 890 giờ lại 950" / "sao 2 giá vậy" / "sao lại có 2 giá" / "giá lúc này lúc kia" (khách thấy CÓ 2 MỨC GIÁ KHÁC NHAU nên THẮC MẮC, tưởng 1 mẫu báo 2 giá) -> PRICE_DISCREPANCY. Đây KHÔNG phải chê giá (PRICE_OBJECTION) và KHÔNG phải hỏi giá 1 mẫu (PRICE_ASK). Bản chất: shop đã báo giá 2 MẪU khác nhau (mỗi mẫu 1 giá) làm khách nhầm -> bot xin lỗi + giải thích 2 mẫu khác nhau nên giá khác nhau + hỏi khách ưng mẫu nào. TUYỆT ĐỐI đừng gắn "lúc X lúc Y" thành PRICE_OBJECTION.
- LƯU Ý "cao" CHỈ là chê giá khi gắn với GIÁ/TIỀN. Nếu "cao" tả CHIỀU CAO cơ thể ("em hơi cao 1m70", "dáng hơi cao", "người cao") -> KHÔNG phải PRICE_OBJECTION, đó là WEIGHT_HEIGHT/SIZE_ADVICE.
- "stk" / "số tài khoản" / "chuyển khoản" / "momo" -> PAYMENT_METHOD.
- "còn hàng ko" / "còn size M ko" -> STOCK.
- "có mấy màu" / "còn màu nào khác" -> COLOR_ASK.
- "màu trắng kem à bạn?" / "màu kem đúng không ạ?" / "mẫu này màu tím à?" / "có màu đen không?" (khách HỎI/XÁC NHẬN về MỘT màu cụ thể) -> COLOR_ASK. Đây là khách ĐANG HỎI cho chắc màu, CHƯA chọn màu để lên đơn -> TUYỆT ĐỐI KHÔNG gắn ORDER_CLOSE/chốt màu. (Chỉ khi khách nói dứt khoát "lấy màu kem" / "màu kem nhé" / "chốt màu tím" MỚI là ORDER_CLOSE.)
- "cho xin bảng size" / "thông số" -> SIZE_CHART.
- "nặng 55kg lấy size nào" / "size nào hợp" -> SIZE_ADVICE.
- "các mẫu size có giống nhau ko" / "size shop có đồng nhất ko" / "size mẫu này với mẫu kia có như nhau ko" / "size bên mình chuẩn giống nhau hết ko" / "mặc size M bên này có vừa như mẫu trước ko" (hỏi size CÁC MẪU có GIỐNG/ĐỒNG NHẤT không) -> SIZE_CONSISTENCY.
- "cho xem thêm ảnh" -> IMAGE_REQ.
- "có video ko" / "cho xem video" / "xin clip" / "xem mẫu thật" / "mặc lên người sao" / "quay video" / "mẫu ngoài đời" -> VIDEO_REQ (KHÔNG phải IMAGE_REQ). Hễ khách nhắc tới VIDEO/CLIP hoặc xin xem mẫu THẬT/LÊN NGƯỜI/NGOÀI ĐỜI thì là VIDEO_REQ, kể cả khi câu có chữ "gửi xem" hay kèm mã mẫu (vd "MRVX559 gửi xem video" -> VIDEO_REQ).
- "cho xem mặt sau" / "ảnh mặt lưng" -> BACK_VIEW.
- "còn mẫu nào tương tự" / "mẫu khác giống vậy" -> SIMILAR_MODELS.
- "để mình suy nghĩ/cân nhắc/tham khảo thêm" / "e mua e liên hệ lại" / "khi nào cần em nhắn shop" / "mua mình ib sau" / "cảm ơn shop, để sau" / "từ từ đã" -> DEFER_DECISION (khách hẹn sau/từ chối khéo; KHÔNG phải POST_ORDER_CONFIRMED - khách CHƯA mua, chỉ hoãn quyết định).
- "em thấy mẫu nào đẹp hơn" / "bộ nào hợp với chị" / "2 mẫu này nên lấy cái nào" / "màu nào đẹp hơn" (nhờ CHỌN GIÚP giữa các mẫu/màu đã xem) -> COMPARE_MODELS.
- "có hàng mới ko" / "cho xem đồ đang sale" / "shop có những loại váy gì" / "cho xem hết mẫu" / "xem thêm mẫu nữa" -> BROWSE_CATALOG.
- "có đồ đi biển ko" / "mẫu nào mặc đi tiệc" / "đi cưới mặc gì" / "đồ công sở" -> OCCASION_QA.
- "da ngăm mặc hợp ko" / "người mập mặc đẹp ko" / "dáng lùn mặc ok ko" / "mặc có tôn dáng ko" / "có hợp với em ko" (hợp DÁNG/tông da, KHÔNG kèm số đo, KHÔNG phải bầu) -> FIT_SUITABILITY.
- "bầu mặc được ko" / "đang mang thai mặc ok ko" / "sau sinh mặc vừa ko" / "đang cho con bú mặc set này được ko" -> PREGNANCY_FIT.
- "sợ không vừa" / "sợ chật" / "lỡ mặc không vừa thì sao" / "không biết có vừa em ko" (LO SIZE có vừa người mình không) -> SIZE_ADVICE.
- "người mẫu cao nặng bao nhiêu" / "mẫu mặc size gì" / "sao mẫu mặc size khác em" -> MODEL_REFERENCE.
- "mua lẻ áo được ko" / "tách quần bán riêng ko" / "chỉ lấy áo của set" -> BUY_SEPARATE.
- "giống hình ko" / "ảnh thật shop chụp à" / "có phải chính hãng ko" / "y hình ko" -> AUTHENTICITY_QA.
- HỎI NGUỒN GỐC/LOẠI HÀNG: "hàng thiết kế hay hàng gì" / "đồ thiết kế à" / "hàng tự thiết kế hay nhập" / "hàng xưởng hả" / "hàng quảng châu à" / "hàng chợ hay thiết kế" / "hàng gì vậy" / "nguồn gốc/xuất xứ ở đâu" / "made in đâu" / "tự sản xuất à" -> AUTHENTICITY_QA (KHÔNG phải GREETING/OTHER, dù câu cụt). Đây là khách hỏi MẶT HÀNG này là loại gì -> code trả "hàng thiết kế tự lên mẫu + sản xuất".
- "đằng sau có kéo khoá ko" / "có túi ko" / "dây áo chỉnh được ko" / "có khuy ko" / "dài bao nhiêu cm" / "có hở lưng ko" / "khoét lưng ko" / "hở lưng nhiều ko" / "có xẻ (tà/đùi) ko" / "cổ khoét sâu ko" / "hở vai ko" / "lưng liền hay hở" (chi tiết KỸ THUẬT / KIỂU DÁNG cụ thể mà bot KHÔNG chắc) -> PRODUCT_DETAIL_QA (KHÔNG phải MATERIAL_QA — hở/khoét/xẻ là THIẾT KẾ, không phải chất liệu).
- "mặc kiểu gì ạ" / "phối với gì cho đẹp" / "mix đồ sao" -> STYLING_QA.
- "có sẵn ở cửa hàng ko" / "ghé shop có hàng ko" / "ở CH còn ko" -> STORE_STOCK.
- "hết hàng thì khi nào có lại" / "còn hàng hay đặt trước" / "bao giờ về hàng" -> RESTOCK_PREORDER.
- "vải gì" / "co giãn ko" / "mặc nóng ko" / "có nhăn ko" / "có quần trong ko" / "có quần luôn ko" / "có kèm quần ko" / "phải mặc thêm (quần) ko" / "mặc trong có gì" / "có đệm ngực ko" -> MATERIAL_QA (+ điền concern).
- "giặt máy được ko" / "có ra màu ko" / "có phai ko" / "bảo quản sao" / "giặt tay hay máy" -> WASH_CARE.
- "đổi giúp em địa chỉ" / "sửa sđt trong đơn" / "đổi size trong đơn vừa đặt" (đơn ĐÃ đặt, muốn SỬA) -> EDIT_ORDER.
- "đơn tuần trước muốn đổi size" / "mặc rộng quá đổi mẫu khác" / "shop qua lấy hàng đổi" (ĐÃ NHẬN hàng rồi và THỰC SỰ muốn đổi 1 món cụ thể) -> EXCHANGE_REQUEST. KHÔNG dùng cho câu HỎI ĐIỀU KIỆN/QUY ĐỊNH ("có được đổi không", "không ưng đổi đc ko", "lỡ không vừa đổi được ko") -> cái đó là RETURN_POLICY.
- "nhận hàng bị giao sai mẫu" / "thiếu 1 món" / "hàng bị lỗi/rách/bẩn" -> DEFECT_REPORT.
- "trả lại lấy tiền" / "hoàn tiền cho em" / "cho em refund" / "chuyển lại tiền cho chị" (ĐÒI/YÊU CẦU hoàn tiền THỰC SỰ, đã nhận hàng muốn trả lấy tiền) -> REFUND_REQUEST. KHÔNG dùng cho câu HỎI ĐIỀU KIỆN "có được hoàn (tiền/hàng) không" / "hoàn tiền được ko" -> cái đó là RETURN_POLICY.
- (khách GỬI ẢNH bill/biên lai chuyển khoản) -> CK_PROOF.
- "đừng gửi nữa" / "không nhận đâu" / "bom đơn" / "hủy không lấy hàng giao tới" -> REFUSE_DELIVERY.
- "giao giờ hành chính nha" / "gọi trước khi giao" / "chiều mới có nhà" -> DELIVERY_PREFERENCE.
- "set này liền hay rời" / "sét này là liền ak" / "có phải set ko" / "là váy liền hả" / "set gồm mấy món" / "phần dưới là quần hay váy" -> SET_TYPE.
- "ship bao lâu" / "phí ship" / "kiểm tra hàng được ko" / "cod" / "mấy ngày nhận hàng" / "bao giờ giao" / "giao mất mấy ngày" / "khi nào nhận được" / "ah mấy ngày chị nhận hàng" (hỏi THỜI LƯỢNG giao chung — KỂ CẢ NGAY SAU KHI CHỐT ĐƠN — mà KHÔNG kèm phàn nàn kiểu "đặt rồi mà chưa thấy") -> DELIVERY_QA. KHÔNG để thành ORDER_STATUS: ORDER_STATUS chỉ khi khách TRA tình trạng đơn đã đặt / phàn nàn chưa nhận.
- NGOẠI LỆ HẬU-ĐƠN (QUAN TRỌNG): nếu "Bối cảnh" cho biết ĐÃ CHỐT ĐƠN (khách đã mua mẫu này rồi) mà khách hỏi THỜI GIAN NHẬN / "bao giờ nhận", "tầm mấy hôm nữa nhận", "2 hôm nữa nhận à", "đến đâu rồi", "sắp tới chưa" -> đây là hỏi về ĐƠN ĐÃ ĐẶT của họ -> ORDER_STATUS (để code tra đơn thật), KHÔNG phải DELIVERY_QA. (DELIVERY_QA chỉ dùng khi CHƯA có đơn — khách hỏi chính sách giao trước khi mua.)
- "đổi trả thế nào" / "ko vừa đổi đc ko" / "không ưng có được đổi không" / "ko ưng đổi đc ko" / "có được đổi không" / "đổi được ko" / "lỡ không vừa có đổi được ko" / "nếu không thích thì đổi/trả được không" / "có được hoàn (tiền/hàng) không" / "hoàn tiền được ko" / "có hoàn tiền không" / "bảo hành" (HỎI QUY ĐỊNH/ĐIỀU KIỆN đổi-trả-hoàn, thường dạng "CÓ ĐƯỢC ... KHÔNG" hoặc "nếu/lỡ/không ưng/không vừa ... đổi/trả/hoàn") -> RETURN_POLICY. LƯU Ý: dạng câu HỎI ĐIỀU KIỆN này LUÔN là RETURN_POLICY, KỂ CẢ vừa chốt đơn xong — KHÔNG phải EXCHANGE_REQUEST / REFUND_REQUEST (khách chưa nhận hàng, chỉ hỏi cho yên tâm). Câu hỏi về HOÀN TIỀN ("có được hoàn không") cũng là RETURN_POLICY; chỉ khi khách ĐÒI hoàn thực sự ("hoàn tiền cho em", "trả lại lấy tiền") mới là REFUND_REQUEST.
- "mẫu nào cũng đẹp" / "mẫu nào cũng thích" / "thích cả mấy mẫu" / "cái nào cũng ưng" / "lấy mỗi thứ 1 cái" / "thích hết á" / "đẹp hết trơn" (khách khen/thích NHIỀU mẫu cùng lúc, CHƯA chọn riêng 1) -> MULTI_MODEL. ĐỪNG đọc thành COMPARE_MODELS (cái đó là nhờ CHỌN GIÚP mẫu nào đẹp HƠN). KHÁC ORDER_CLOSE (chưa chốt mẫu cụ thể).
- "shop ở đâu" / "qua shop xem đc ko" / "mua trực tiếp" -> STORE_ADDRESS.
- "xin địa chỉ shop" / "cho xin địa chỉ cửa hàng" / "địa chỉ shop ở đâu" / "shop có địa chỉ nào" / "cho mình xin địa chỉ store" / "địa chỉ bên em" / "shop địa chỉ chỗ nào" (khách HỎI/XIN địa chỉ CỬA HÀNG để biết shop ở đâu / ghé mua) -> STORE_ADDRESS, is_address=FALSE, wants_order=FALSE. CỰC KỲ QUAN TRỌNG: câu có chữ "xin/cho xin" + "địa chỉ" + "shop/cửa hàng/store/bên em" -> LUÔN là STORE_ADDRESS (hỏi địa chỉ SHOP), TUYỆT ĐỐI KHÔNG phải ADDRESS. ADDRESS chỉ khi khách TỰ ĐỌC địa chỉ NHÀ MÌNH để giao hàng (có số nhà/đường/phường/xã/quận cụ thể, vd "123 Lê Lợi P5 Q3"). Hỏi "địa chỉ shop" = STORE_ADDRESS; đọc "địa chỉ nhà tôi là..." = ADDRESS.
- "gần Bà Triệu có gì c sẽ ghé" / "mai e qua xem trực tiếp" / "để qua shop thử" / "tiện qua lấy luôn" / "hôm nào rảnh ghé showroom" / "chiều nay e qua" (khách BÁO/HẸN SẼ GHÉ cửa hàng xem trực tiếp) -> STORE_VISIT, is_address=FALSE, wants_order=FALSE. KHÁC STORE_ADDRESS (chỉ HỎI địa chỉ): STORE_VISIT là khách đã có Ý ĐỊNH ĐẾN. Khách kèm GIỜ/NGÀY cụ thể ("mai", "thứ 7", "chiều nay") -> VẪN STORE_VISIT (phần hẹn lịch để code lo). ĐỪNG đọc "Bà Triệu/địa danh" trong câu này thành ADDRESS giao hàng.
- KHI "Tin shop ngay trước" vừa liệt kê CƠ SỞ/showroom rồi hỏi "chị có gần showroom/cơ sở nào không?" mà khách đáp 1 TÊN ĐỊA DANH/CƠ SỞ ngắn ("Bà Triệu", "Hà Nội", "Nguyễn Trãi", "Bắc Ninh", "gần HN"...) -> ĐÂY LÀ CHỌN CƠ SỞ ĐỂ QUA SHOP -> STORE_ADDRESS, is_address=FALSE, wants_order=FALSE. ĐỪNG đọc thành ADDRESS (địa chỉ giao) / ORDER_CLOSE — khách đang hỏi qua shop, KHÔNG đặt ship.
- "có bán shopee ko" / "shop bán trên shopee ko" / "sopi có ko" (HỎI có bán trên Shopee) -> ASK_SHOPEE.
- "có bán tiktok ko" / "shop có tiktok ko" / "Tiktok á shop" / "bên mình có tóp tóp ko" (HỎI có bán trên TikTok) -> ASK_TIKTOK.
- "nay đi đơn bên tiktok cho mình nha" / "lên đơn tiktok nhé" / "đơn này qua tiktok" / "chốt đơn bên tiktok" / "đi đơn tiktok giúp c" (khách ĐÃ ĐẶT / muốn LÊN ĐƠN qua kênh TikTok — KHÔNG phải hỏi có bán TikTok không) -> TIKTOK_ORDER, wants_order=true.
- "PHOM với Mys.P có phải 1 ko" / "bên Phom với Misp là 1 hay sao nhỉ" / "2 page này cùng shop hả" / "Miss.P với Phom là 1 à" / "Phom với Mỹ P là 1 shop đúng ko" / "page này với bên kia chung shop ko" (khách hỏi 2 page/tên shop PHOM và Mys.P có CÙNG 1 shop/hệ thống không) -> SAME_SHOP_QA. ĐỪNG đọc thành OTHER/GREETING.
- "lấy sỉ giá sao" / "mua buôn" / "làm CTV được ko" / "lấy về bán lại" / "giá sỉ bao nhiêu" / "đổ sỉ" -> WHOLESALE.
- "alo" / "ib" / "shop ơi" / "ad ơi" -> GREETING.
- "cảm ơn" / "ok e" / "vâng ạ" -> THANKS.
- "shop nhiệt tình ghê" / "em dễ thương quá" / "tạm biệt em nha" / "shop tư vấn kỹ thật" / "cảm ơn shop nhiều" (khi ĐÃ chốt đơn, nói chuyện thân thiện/khen/chào tạm biệt, KHÔNG hỏi nghiệp vụ) -> POST_ORDER_CHITCHAT.
- KHI đơn ĐÃ ĐƯỢC TẠO/XÁC NHẬN (shop đã gửi "Cảm ơn chị đã đặt hàng" / "đơn đang được tạo trên hệ thống") mà khách chỉ ack NGẮN để KẾT THÚC ("ok", "vâng", "ừ", "dạ rồi", "ok chị", "okе", "vâng ạ", "uki") -> POST_ORDER_CHITCHAT (kết thúc hội thoại, bot đáp gọn). ĐỪNG đọc "ok/vâng" hậu-đơn này thành ORDER_CLOSE / xác nhận lại / nghiệp vụ — ĐƠN ĐÃ CÓ RỒI, khách chỉ chốt lời cho xong. (KHÁC với "ok/vâng" trả lời câu shop hỏi xác nhận TỈNH/ĐỊA CHỈ khi đơn CHƯA tạo -> cái đó mới là ORDER_CLOSE.)
- CỰC QUAN TRỌNG: "Dạ" / "vâng" / "ok" / "uki" khi đơn CHƯA được tạo (đang TƯ VẤN: shop vừa tư vấn size / vừa trấn an "được kiểm tra hàng trước khi thanh toán" / vừa xin SĐT+địa chỉ) -> ĐÂY KHÔNG PHẢI POST_ORDER_CHITCHAT. Đó là khách ĐỒNG Ý TIẾP TỤC MUA (sắp chốt) -> để nhãn ORDER_CLOSE (wants_order=true) nếu rõ ý chốt, hoặc OTHER nếu chỉ ậm ừ. POST_ORDER_CHITCHAT CHỈ dùng khi "Bối cảnh" = ĐÃ CHỐT ĐƠN. Nếu "Bối cảnh: CHƯA có đơn" thì TUYỆT ĐỐI không gắn POST_ORDER_CHITCHAT/POST_ORDER_CONFIRMED/POST_ORDER_REQUEST. (vd shop "được kiểm tra hàng trước khi thanh toán ạ" + khách "Dạ" + Bối cảnh CHƯA có đơn -> khách đồng ý kiểm hàng, sắp chốt -> ORDER_CLOSE, KHÔNG phải POST_ORDER_CHITCHAT.)
- "gửi chuẩn hàng nhe" / "gói kỹ giúp em" / "gửi đúng mẫu/đúng size nha" / "đừng gửi nhầm" / "đóng cẩn thận giúp em" / "chọn hàng đẹp cho chị" / "kiểm hàng kỹ trước khi gửi" (khi ĐÃ chốt đơn, DẶN DÒ/YÊU CẦU về đóng gói - gửi đúng - chất lượng, KHÔNG phải câu HỎI) -> POST_ORDER_REQUEST.
  * LƯU Ý PHÂN BIỆT: "CHO kiểm tra hàng nhé" / "cho khách kiểm tra hàng" / "được kiểm tra hàng không" / "đồng kiểm" / "kiểm hàng trước khi thanh toán" = khách xin ĐỒNG KIỂM (được tự mở/kiểm hàng trước khi trả tiền) -> KHÔNG phải POST_ORDER_REQUEST. Đây là câu hỏi CHÍNH SÁCH -> DELIVERY_QA. (POST_ORDER_REQUEST là dặn SHOP "kiểm/gói KỸ trước khi GỬI"; còn "cho kiểm tra hàng" là KHÁCH muốn tự kiểm khi nhận.)
- "c lấy rồi mà e" / "chị đặt rồi nha" / "mua rồi mà em" / "đã chốt rồi mà" / "nãy chị lấy rồi" (khách KHẲNG ĐỊNH ĐÃ MUA/ĐÃ ĐẶT rồi, thường phản hồi khi shop hỏi "lấy thêm ạ?"; KHÁC với muốn đặt THÊM) -> POST_ORDER_CONFIRMED. LƯU Ý: "lấy RỒI/mua RỒI/đặt RỒI" = đã mua (POST_ORDER_CONFIRMED); còn "lấy THÊM/đặt THÊM/lấy luôn/lấy nhé" = muốn mua (ADD_TO_ORDER hoặc ORDER_CLOSE).
- "lừa đảo à" / "sao lâu thế" / "bực thật" / khiếu nại gay gắt -> COMPLAINT.
- "mai chị đi rồi" / "T4 là chị đi rồi" / "trước thứ 5 giúp e" / "cần gấp" / "đi tiệc/cưới cuối tuần" / "giao kịp ko" (khách có MỐC NGÀY hoặc GẤP cần nhận) -> URGENT.
- "để chị hỏi con gái xem sao" / "để mình hỏi chồng đã" / "hỏi ông xã cái đã" / "bàn với vợ rồi quyết" / "thông qua bà xã đã" / "để hỏi ý con nhé" / "hỏi người nhà xem đã" / "để chị hỏi mẹ cái" (khách MUỐN HỎI Ý NGƯỜI NHÀ/người thân trước khi quyết mua) -> CONSULT_FAMILY. Đây là khách HOÃN để tham khảo người nhà -> bot gắn NGƯỜI THẬT chăm, KHÔNG gặng màu/size/chốt. PHÂN BIỆT: "hỏi con gái em mặc size gì" (hỏi số đo để tư vấn) -> KHÔNG phải CONSULT_FAMILY (đó là SIZE_ADVICE). CONSULT_FAMILY = khách để dành QUYẾT ĐỊNH cho người nhà.
- "sao chưa trả lời" / "B ơi chưa có câu trả lời ạ" / "chưa rep em à" / "shop chưa phản hồi" / "alo shop ơi" / "có ai ở đó ko" / "sao im vậy" / "đợi mãi chưa thấy" (khách GIỤC/ĐÒI shop phản hồi — đang chờ shop/nhân viên xử lý việc gì đó, KHÔNG phải hỏi mẫu/giá) -> WAITING_REPLY. ĐỪNG đọc thành OTHER. (Lịch sự hay gắt đều tính; nếu gắt/khiếu nại rõ thì ưu tiên COMPLAINT.) PHÂN BIỆT RÕ: WAITING_REPLY = giục shop TRẢ LỜI/REP tin nhắn. KHÁC: hỏi THỜI GIAN giao trước/khi mua ("giao bao lâu", "mấy ngày nhận hàng", "ship mấy ngày") -> DELIVERY_QA (KHÔNG phải WAITING_REPLY); tra ĐƠN ĐÃ ĐẶT / "sao chưa giao hàng", "đặt rồi chưa thấy hàng", "đơn tới đâu rồi" -> ORDER_STATUS (KHÔNG phải WAITING_REPLY).

NGOÀI kind, nếu khách LO/HỎI về 1 ĐẶC ĐIỂM mẫu, điền "concern" (phân biệt RÕ, đừng lẫn):
- "ngắn" (sợ ngắn, thấy ngắn, hơi ngắn, váy cộc) -> concern="ngan".
- "mỏng / hở / xuyên thấu / lộ / mặc trong suốt" (về VẢI mỏng hoặc hở da) -> concern="mong".
- "chất liệu / vải gì / mặc nóng ko / nhăn ko" -> concern="chat".
- "co giãn ko / có giãn ko / độ co" -> concern="cogian".
- "có lót ko / quần trong / 2 lớp / có quần luôn ko / có kèm quần / có sẵn quần / phải mặc thêm (quần) ko / mặc trong có gì" -> concern="lot".
- "có đệm/mút ngực ko" -> concern="dem".
LƯU Ý: "ngắn" KHÁC "mỏng" — KHÔNG gộp. Không có đặc điểm nào -> concern=null.
Nếu tin có NHIỀU ý, chọn kind theo ý QUAN TRỌNG NHẤT (ưu tiên: TIKTOK_ORDER > ORDER_CLOSE > POST_ORDER_CONFIRMED > ADD_TO_ORDER > CANCEL_ORDER > REFUSE_DELIVERY > URGENT > WAITING_REPLY > REFUND_REQUEST > DEFECT_REPORT > EXCHANGE_REQUEST > EDIT_ORDER > CK_PROOF > PAYMENT_CONFIRM > ORDER_STATUS > DELIVERY_PREFERENCE > ADDRESS > PHONE > SEND_ADDRESS_LATER > SIZE > TOTAL_PAYMENT > WHOLESALE > PRICE_ASK > DISCOUNT > PRICE_DISCREPANCY > PRICE_OBJECTION > PAYMENT_METHOD > STOCK > RESTOCK_PREORDER > SIZE_ADVICE > SIZE_CONSISTENCY > SIZE_CHART > COLOR_ASK > COMPARE_MODELS > MULTI_MODEL > BACK_VIEW > VIDEO_REQ > IMAGE_REQ > SIMILAR_MODELS > DEFER_DECISION > BROWSE_CATALOG > OCCASION_QA > FIT_SUITABILITY > PREGNANCY_FIT > MODEL_REFERENCE > BUY_SEPARATE > AUTHENTICITY_QA > MATERIAL_QA > WASH_CARE > PRODUCT_DETAIL_QA > STYLING_QA > SET_TYPE > RETURN_POLICY > DELIVERY_QA > STORE_STOCK > STORE_VISIT > STORE_ADDRESS > SAME_SHOP_QA > ASK_SHOPEE > ASK_TIKTOK > WEIGHT_HEIGHT > COMPLAINT > CONSULT_FAMILY > GREETING > POST_ORDER_REQUEST > POST_ORDER_CHITCHAT > THANKS > OTHER), nhưng vẫn điền các cờ phụ (size, is_address, wants_order, asks_size_chart, asks_price, concern) nếu xuất hiện.

BÓC THÔNG TIN GIAO HÀNG (điền cả khi kind KHÁC ADDRESS/PHONE, nếu tin có):
- phone: nếu tin CÓ số điện thoại, tách ra ĐÚNG số di động 10 số (bắt đầu bằng 0). HIỂU câu ghép: "Hoa 0877846686 22 Võ Nguyên..." hay "0877846686\\n22..." -> phone="0877846686" ("22" là SỐ NHÀ, KHÔNG phải sđt). "0926855666 53/275..." -> phone="0926855666". KHÔNG gộp số nhà vào sđt. Tin không có sđt -> phone=null.
- address_complete: XÉT "Địa chỉ đã biết từ trước" (nếu có) CỘNG tin mới -> đã ĐỦ ĐỂ GIAO chưa? ĐỦ = có [số nhà / thôn-xóm-ngõ] + [phường/xã HOẶC quận/huyện] + [tỉnh/thành]. ĐỌC HIỂU như người thật, TUYỆT ĐỐI KHÔNG đếm ký tự. Vd "56 Đặng Nguyên Cẩn, p Long Toàn, tp Bà Rịa" -> true; "Số 27 Khu Vân Quan, phường Đa Phúc, quận Dương Kinh, TP Hải Phòng" -> true. Chỉ có tên+sđt, chưa có địa chỉ -> false. Thiếu tỉnh/phường/số nhà -> false.
- province_confirm: đặt true khi địa chỉ dùng TÊN TỈNH/HUYỆN/THÀNH ĐÃ SÁP NHẬP HOẶC ĐỔI theo cải cách hành chính 2025 (vd "Bà Rịa", "Vũng Tàu", "Nam Định", "Hà Nam", "Bình Dương", "Bắc Kạn", "Hà Tây"...) -> shop cần XÁC NHẬN tỉnh/thành MỚI cho chuẩn. Tỉnh/thành hiện hành, không thuộc diện sáp nhập -> false.

THAM CHIẾU MẪU (đa mẫu): khi khách nói CỤT/tham chiếu — "lấy set jum trắng" / "lấy mẫu xanh" / "cái kia" / "mẫu trắng trước" / "em lấy chị áo đen" — NEO vào ĐÚNG mẫu trong "Bối cảnh" (danh sách mẫu đã báo giá), dựa vào MÀU/LOẠI/TÊN khách nêu. Điền refers_to = tên (hoặc tên+màu) mẫu khách đang nhắc. Nếu khách chốt/lấy 1 mẫu rõ ràng -> kind=ORDER_CLOSE, wants_order=true, refers_to=<mẫu đó>. KHÔNG khớp được mẫu nào trong danh sách -> refers_to=null (để người thật xử, đừng đoán mẫu).

Trả JSON đúng khuôn:
{"kind":"<MỘT trong: ${KINDS.join("|")}>","size":"S|M|L|XL|XXL|FREESIZE|null","do_luong":"<SỐ ĐO khách đã cho trong TOÀN HỘI THOẠI (kể cả tin trước), dạng '1m55/42kg' hoặc '42kg' hoặc null nếu CHƯA TỪNG cho>","is_address":true/false,"has_phone":true/false,"phone":"<10 số đã tách sạch, hoặc null>","wants_order":true/false,"asks_price":true/false,"asks_size_chart":true/false,"address_complete":true/false,"province_confirm":true/false,"refers_to":"<tên/màu mẫu khách đang nhắc, hoặc null>","concern":"ngan|mong|chat|cogian|lot|dem|null"}`;

function _safe(obj) {
  const out = {
    ok: true,
    kind: "OTHER",
    size: null,
    do_luong: null,
    is_address: false,
    has_phone: false,
    phone: null,
    wants_order: false,
    asks_price: false,
    asks_size_chart: false,
    address_complete: false,
    province_confirm: false,
    refers_to: null,
    concern: null
  };
  try {
    if (obj && typeof obj === "object") {
      const k = String(obj.kind || "").toUpperCase().trim();
      if (KINDS.includes(k)) out.kind = k;
      let s = obj.size == null ? null : String(obj.size).toUpperCase().replace(/\s+/g, "").trim();
      if (s === "FREESIZE" || s === "FS") s = "FREESIZE";
      if (["XS", "S", "M", "L", "XL", "XXL", "XXXL", "FREESIZE"].includes(s)) out.size = s; else out.size = null;
      out.is_address = !!obj.is_address;
      out.has_phone = !!obj.has_phone;
      { const ph = String(obj.phone == null ? "" : obj.phone).replace(/\D/g, ""); out.phone = /^0\d{9}$/.test(ph) ? ph : null; }
      out.wants_order = !!obj.wants_order;
      out.asks_price = !!obj.asks_price;
      out.asks_size_chart = !!obj.asks_size_chart;
      out.address_complete = !!obj.address_complete;
      out.province_confirm = !!obj.province_confirm;
      { const rt = String(obj.refers_to == null ? "" : obj.refers_to).trim(); out.refers_to = (rt && rt.toLowerCase() !== "null") ? rt.slice(0, 60) : null; }
      const cc = String(obj.concern || "").toLowerCase().trim();
      out.concern = ["ngan", "mong", "chat", "cogian", "lot", "dem"].includes(cc) ? cc : null;
    }
  } catch (_) {}
  return out;
}

// classifyIntent({text, lockedProductName, lastShopLine, timeoutMs})
// -> Promise<{ok, kind, size, is_address, has_phone, wants_order, asks_price, asks_size_chart}>
// KHÔNG bao giờ throw. ok=false nghĩa là không phân loại được -> code tự lo.
async function classifyIntent({ text, lockedProductName = "", lastShopLine = "", orderContext = "", recentTurns = "", knownAddress = "", timeoutMs = 6000 } = {}) {
  const msg = String(text || "").trim();
  if (!msg) return { ok: false, reason: "text-rong" };
  const c = client();
  if (!c) return { ok: false, reason: "thieu-API-key" };

  const userPrompt =
    (lockedProductName ? `Mẫu đang nói tới: ${lockedProductName}\n` : "") +
    (orderContext ? `Bối cảnh: ${String(orderContext).slice(0, 200)}\n` : "") +
    (recentTurns ? `Hội thoại gần đây (cũ->mới, chỉ để HIỂU ngữ cảnh):\n${String(recentTurns).slice(0, 900)}\n` : "") +
    (lastShopLine ? `Tin shop ngay trước: ${String(lastShopLine).slice(0, 120)}\n` : "") +
    (knownAddress ? `Địa chỉ đã biết từ trước (cộng với tin mới để xét address_complete): "${String(knownAddress).slice(0, 200)}"\n` : "") +
    `TIN MỚI NHẤT CỦA KHÁCH (gắn nhãn cho ĐÚNG tin này): "${msg.slice(0, 400)}"\n` +
    `Trả JSON nhãn:`;

  try {
    const p = c.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      max_tokens: 200,
      messages: [
        { role: "system", content: SYS },
        { role: "user", content: userPrompt }
      ]
    });
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs));
    const _t0 = Date.now();
    const resp = await Promise.race([p, timeout]);
    turnLog.tuOpenAI(resp, "ai_intent", "gpt-4.1-mini", Date.now() - _t0);
    let raw = String(resp.choices?.[0]?.message?.content || "").trim();
    raw = raw.replace(/^```(json)?/i, "").replace(/```$/i, "").trim();
    const i = raw.indexOf("{"), j = raw.lastIndexOf("}");
    if (i >= 0 && j > i) raw = raw.slice(i, j + 1);
    const obj = JSON.parse(raw);
    return _safe(obj);
  } catch (e) {
    turnLog.ai({ model: "gpt-4.1-mini", where: "ai_intent", ok: false });
    return { ok: false, reason: (e && e.message === "timeout") ? ("timeout>" + timeoutMs + "ms") : ("loi:" + ((e && e.message) || "khong-ro")) };
  }
}

module.exports = { classifyIntent, KINDS };
