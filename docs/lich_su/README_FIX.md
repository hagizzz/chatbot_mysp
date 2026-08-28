# FIX gộp: (A) không báo giá đè câu hỏi thuộc tính + (B) đúng quy tắc 1 mẫu/1 lần giá/24h

Chỉ sửa 1 file: bot_worker_api_v3.js. Xem chi tiết từng dòng trong FIX_bao_gia_quan_trong.diff.

==================================================================
## FIX A — "Có quần trong k shop" bị báo giá lại (lỗi gốc)
==================================================================
NGUYÊN NHÂN: cổng ADS (~4156) chạy trước, gọi opener báo giá rồi return,
không bao giờ tới handler "có quần/lót bên trong" (~6225). Whitelist follow-up
(_adFollowupQ) thiếu các câu hỏi thuộc tính.

ĐÃ SỬA (khối cổng ADS ~4072–4160):
1. Thêm _adAttrQ = gom các hàm CÓ SẴN nhưng bị sót:
   asksInnerLining, asksBreastPad, asksStretch, isSheerConcern,
   worriesGarmentShort, asksOtherColors, asksInStock.
2. Gộp _adAttrQ vào _adFollowupQ.
3. Cổng báo giá ADS thêm chặn vô điều kiện: && !_adAttrQ.
4. Mở rộng khối KHÔI PHỤC khóa mẫu (chạy cho cả _adAttrQ; nếu pricedCodes rỗng
   thì resolve lại mẫu từ Ad ID / post_id / mã trong tên ad) -> đảm bảo productInfo
   có giá trị để handler thuộc tính trả lời (vá lỗ mất state).

KIỂM CHỨNG: 12 câu mở đầu ad bình thường -> 0/12 bắt nhầm (vẫn báo giá như cũ);
8 câu thuộc tính -> 8/8 bắt đúng (không báo giá lại).

==================================================================
## FIX B — Quy tắc 1 mẫu / 1 lần báo giá / 24h (chỗ hở)
==================================================================
NGUYÊN NHÂN: 2 chỗ gọi thẳng buildCommentOpener (LUÔN kèm giá), không kiểm
quotedRecently theo MÃ:
  - ADS opener (~4249): chỉ chặn theo adId -> bấm ad MỚI cùng mẫu vẫn báo giá lại trong 24h.
  - Comment opener (~3943): chỉ chặn theo từng hội thoại comment.

ĐÃ SỬA: thay buildCommentOpener(...) -> openerOrLead(...) tại 2 chỗ đó.
openerOrLead là helper CÓ SẴN: mẫu CHƯA báo giá 24h -> opener đầy đủ (giữ nguyên hành vi);
mẫu ĐÃ báo giá 24h -> chỉ câu dẫn dắt, KHÔNG lặp giá. (Ngoại lệ "khách hỏi lại giá"
vẫn do các path khác xử lý.)

KIỂM CHỨNG (chạy bằng hàm thật):
  Lần 1 (chưa báo) -> OPENER CÓ GIÁ
  Lần 2 (trong 24h) -> "Dạ Váy Celyne ạ. Chị thường mặc size..." (KHÔNG giá)
  Lần 3 (sau 25h)  -> OPENER CÓ GIÁ lại

Các path báo giá khác đã đúng sẵn, KHÔNG đụng:
  sendBlocks (3350), khối "Hỏi giá/mẫu mới" (~6900), path 5292, helper openerOrLead.

==================================================================
## KHÔNG đụng (cố ý, tách riêng)
==================================================================
- Luồng trả lời COMMENT (state tách rời comment/inbox + cửa sổ DM Facebook).
- Persist mem.adQuotedFor / currentProduct qua restart.
Hai việc này rủi ro hồi quy cao, cần chốt hướng trước.

==================================================================
## Áp dụng & test
==================================================================
- Thay file bot_worker_api_v3.js cũ bằng file trong gói (drop-in). Restart: node bot_worker_api_v3.js
- Đã node --check hợp lệ; self-test node intent_router.js = 27/27 PASS.
- Test thật: bấm ad rồi gõ "có quần trong không", "có đệm ngực ko", "co giãn ko",
  "còn màu khác không", "còn hàng không" -> KHÔNG được báo giá lại.
  Bấm ad MỚI cùng 1 mẫu trong 24h -> KHÔNG lặp giá (chỉ dẫn dắt).

==================================================================
## FIX C — Persist state qua handoff comment -> inbox (giữ đúng 24h)
==================================================================
BỐI CẢNH "persist state": state ĐÃ được lưu sẵn qua state_manager.js
(ghi TOÀN BỘ mem vào conversation_memory.json mỗi lượt) -> persist qua restart
ĐÃ CÓ, không cần sửa. Vấn đề thật là state bị TÁCH giữa 2 hội thoại của cùng 1
khách: COMMENT (id POSTID_commentId) và INBOX (id PAGEID_psid).

LỖI CỤ THỂ: khối đồng bộ comment->inbox (~4029) chép pricedCodes nhưng QUÊN
pricedAt (mốc giờ báo giá). quotedRecently() lại dựa vào pricedAt -> bên inbox
luôn = false -> BÁO GIÁ LẠI mẫu đó khi khách chuyển từ bình luận sang nhắn tin
(phá đúng quy tắc 24h vừa thêm ở FIX B).

ĐÃ SỬA: trong khối đồng bộ, chép thêm:
  - im.pricedAt = merge(im.pricedAt, mem.pricedAt)   -> quotedRecently chạy đúng.
  - im.sourceColorByCode = merge(...)                -> gửi lại ảnh đúng màu bài.

KIỂM CHỨNG (hàm thật):
  CŨ : inbox.quotedRecently = false  (sẽ báo giá lại - sai)
  MỚI: inbox.quotedRecently = true   (không báo lại - đúng)

==================================================================
## Về 2 việc tách riêng — trạng thái hiện tại
==================================================================
(1) PERSIST STATE: đã xử lý đủ. state_manager.js lưu cả mem qua restart;
    FIX C vá nốt lỗ tách state comment<->inbox (mất pricedAt). KHÔNG đụng
    thêm vào state_manager để tránh rủi ro thừa.

(2) LUỒNG TRẢ COMMENT: luồng HIỆN CÓ vẫn trả comment 1 lần (DM mẫu+giá+ảnh
    qua private_reply, + reply công khai điều hướng, + đồng bộ mẫu sang inbox).
    Ca "comment KHÔNG được trả" (vd Phuong Pham) trong log mới chỉ thấy ở dòng
    [THEO DÕI] (debug) -> CHƯA đủ dữ liệu để biết chặn ở đâu: có thể do
    humanInbox=true (NV đã vào inbox -> bot nhường), hoặc dmTarget=null
    (khách chưa từng mở inbox -> FB không cho nhắn riêng), hoặc reader chưa
    nạp commentId/postId cho conv đó.
    -> Để sửa AN TOÀN (không vá mò làm hỏng chỗ khác), cần 1 ca thật:
       gửi mình RAW object của hội thoại comment đó + các dòng log mà
       processOneConversation in ra cho đúng id đó (bật SHOW_QUEUE=1 / LIST_DEBUG=1).
       Có dữ liệu là khoanh được đúng nhánh chặn rồi sửa trúng.

==================================================================
## FIX D — BÙ ẢNH cùng màu khi ảnh ghim chiến dịch gửi lỗi
==================================================================
BỐI CẢNH: mã có ảnh GHIM chiến dịch (CAMPAIGN_PIN). Nếu các ảnh ghim đó gửi
fail (content_id hỏng + URL Drive chưa public) -> trước đây bot gửi 0 ảnh rồi
gắn thẻ AI-XL, khách KHÔNG nhận được ảnh nào.

ĐÃ SỬA (trong maybeSendImages, sau khi gửi cụm ảnh chính):
- Đếm muốn gửi (tối đa 3) vs gửi được. Nếu THIẾU -> lấy ảnh CÙNG MÀU khác
  (loại các tấm vừa thử) gửi BÙ từng tấm cho tới khi đủ.
- Chỉ bù ĐÚNG MÀU đang gửi (không gửi nhầm màu). Khách chen tin -> dừng bù.
- Bù được >=1 tấm -> coi như có ảnh, KHÔNG gắn thẻ "thiếu ảnh".

KIỂM CHỨNG (dữ liệu thật MGKVX6310 màu hồng):
  3 ảnh ghim (q6REeRbI.., w0BCbcEl.., 45WEYeco..) -> CHẾT HẾT (0/3)
  Còn 7 ảnh hồng khác -> BÙ -> gửi đủ 3/3.

LƯU Ý: đây là LƯỚI AN TOÀN. Vẫn nên xử gốc: đặt 3 file ghim "Anyone with the
link" trong Drive (và/hoặc up lại Pancake) để gửi ĐÚNG ảnh chiến dịch như ý.

==================================================================
## FIX E — Định tuyến SAI: hỏi "đã gửi hàng chưa" & hỏi giá mẫu mới
==================================================================
(Sửa 2 file: bot_worker_api_v3.js + product_images.js)

CA 1 — "Shop gửi đồ cho mih chưa ạ" (hỏi đã GỬI HÀNG chưa) -> bot LIỆT KÊ MÀU.
  Gốc: (a) asksOrderStatus TRƯỢT "gửi đồ/hàng ... chưa" (động từ trước danh từ, dùng "đồ").
       (b) nhánh màu có _viewVerb=/(gửi|...)/ -> chữ "gửi" bị hiểu là "gửi ảnh xem".
  ĐÃ SỬA: + asksOrderStatus nhận thêm mẫu "(gửi|giao|ship) (đồ|hàng|cho mình...) ... chưa".
          + nhánh màu thêm điều kiện !asksOrderStatus(latestText) (không cướp lượt).
  -> giờ vào đúng handler TRA ĐƠN (báo trạng thái / hoặc giao người nếu chưa cấu hình POS).

CA 2 — "c xin giá" + ảnh mẫu MỚI (đơn đã chốt) -> bot ĐÒI ĐỊA CHỈ, không báo giá.
  Gốc: _newModelAfterClose (GĐ4 "thêm mẫu vào đơn") KHÔNG loại câu hỏi giá -> nuốt luôn.
  ĐÃ SỬA: thêm !isPriceAsk(...) && !asksOrderStatus(...) vào _newModelAfterClose
  -> khách hỏi giá mẫu mới thì BÁO GIÁ trước, không nhét vào đơn rồi đòi địa chỉ.

PHỤ — màu RÁC "kemmrkvx6310-be":
  Gốc: tên file lỗi "MGKVX6310-KEMMRKVX6310-BE-AI" -> colorFromName bóc ra chuỗi chứa mã sp.
  ĐÃ SỬA (product_images.js): màu chứa 4+ chữ số liền -> coi như KHÔNG đọc được màu (bỏ).
  (Nên đổi tên file đó trong Drive cho sạch: "MGKVX6310-BE-AI".)

KIỂM CHỨNG:
  asksOrderStatus: "shop gửi đồ/hàng chưa" -> TRUE; "gửi ảnh xem"/"gửi địa chỉ chưa" -> FALSE.
  isPriceAsk("c xin giá") -> TRUE.
  colorFromName("MGKVX6310-KEMMRKVX6310-BE-AI") -> "" ; "MGKVX6310-KEM" -> "Kem".

==================================================================
## FIX F — AI-FIRST DISPATCH (AI hiểu cả câu -> rẽ nhánh; code vẫn duyệt)
==================================================================
(Sửa 2 file: ai_intent.js + bot_worker_api_v3.js)

VẤN ĐỀ: AI chỉ là bộ GẮN NHÃN với 12 nhãn, và nhãn 'kind' gần như KHÔNG được
dùng để định tuyến (chỉ in log). Bộ nhãn lại THIẾU nhiều loại (vd ORDER_STATUS)
nên AI gắn SAI (ca "shop gửi đồ chưa" -> ORDER_CLOSE).

ĐÃ LÀM:
1) ai_intent.js: MỞ RỘNG bộ nhãn 12 -> 29 (thêm ORDER_STATUS, TOTAL_PAYMENT,
   DISCOUNT, PAYMENT_METHOD, STOCK, COLOR_ASK, SIZE_ADVICE, BACK_VIEW,
   SIMILAR_MODELS, RETURN_POLICY, STORE_ADDRESS, SHOPEE_TIKTOK, ADD_TO_ORDER,
   CANCEL_ORDER, PAYMENT_CONFIRM, THANKS, COMPLAINT) + ví dụ trong prompt.
2) bot_worker: thêm helper _ai("X") = (AI gắn nhãn X). Nối nhãn AI vào các nhánh
   THÔNG TIN sẵn có bằng cách OR: "asksX(text) || _ai('LABEL')" -> khi TỪ-KHOÁ
   TRƯỢT nhưng AI hiểu thì vẫn vào ĐÚNG nhánh. Handler vẫn tự DUYỆT (sheet/POS).
   Đã nối: ORDER_STATUS, STOCK, COLOR_ASK, RETURN_POLICY, STORE_ADDRESS,
   PAYMENT_METHOD, BACK_VIEW.
3) Dispatch GIAO NGƯỜI THẬT: AI=COMPLAINT/PAYMENT_CONFIRM/CANCEL_ORDER (và
   từ-khoá tiền/đơn KHÔNG khớp) -> gắn thẻ + giao người, KHÔNG tự trả.
4) GĐ4 "thêm mẫu": chặn thêm bằng !_ai("ORDER_STATUS") && !_ai("PRICE_ASK").

NGUYÊN TẮC GIỮ AN TOÀN:
- TIỀN/ĐƠN (PRICE/ORDER_CLOSE/ADDRESS/PHONE/TOTAL) VẪN do code quyết, KHÔNG nối AI.
- Chỉ OR thêm trigger, KHÔNG xoá/đổi thứ tự nhánh cũ -> chỉ THÊM khả năng bắt khi
  từ-khoá trượt; mọi hành vi cũ giữ nguyên.
- AI timeout / OTHER / độ tin thấp -> _ai luôn false -> chạy thuần từ-khoá như trước.
- Log [DISPATCH] để soi AI rẽ nhánh nào.

LƯU Ý: đây là nền AI-first cho nhóm THÔNG TIN + GIAO NGƯỜI. Các nhãn còn lại
(DISCOUNT, SIMILAR_MODELS, SHOPEE_TIKTOK, SIZE_ADVICE...) nối theo ĐÚNG mẫu 1 dòng
"|| _ai('LABEL')" vào nhánh tương ứng khi cần — không cần đổi kiến trúc.

------------------------------------------------------------------
## FIX F (bổ sung) — NỐI HẾT nhãn AI + địa chỉ/sđt
------------------------------------------------------------------
Đã nối thêm (OR "|| _ai('LABEL')" vào nhánh sẵn có, code vẫn duyệt):
  DISCOUNT, SIZE_CHART, IMAGE_REQ, SHOPEE_TIKTOK, TOTAL_PAYMENT, SIMILAR_MODELS,
  MATERIAL_QA, và concern -> INNER_LINING(lot)/BREAST_PAD(dem)/STRETCH(cogian)/chat.
Tổng nhãn đã nối vào định tuyến: ~18 nhãn + 6 concern.

ĐỊA CHỈ / SĐT (theo yêu cầu):
  - AI phất cờ is_address/has_phone (hoặc kind ADDRESS/PHONE) -> code vào luồng chốt.
  - GIÁ TRỊ thật vẫn do CODE bóc: địa chỉ = cleanAddress(text); sđt = regex số.
    AI KHÔNG bao giờ tự chế số nhà / số điện thoại.

CỐ Ý KHÔNG để AI tự KÍCH HÀNH ĐỘNG (chỉ giữ ở code) — vì là tiền/đơn:
  - PRICE_ASK: vẫn do isPriceAsk (code) kích báo giá; giá lấy từ catalog.
    (Lý do kỹ thuật: priceAsk tính TRƯỚC khi AI chạy trong luồng hiện tại.)
  - ORDER_CLOSE: KHÔNG cho AI tự XÁC NHẬN đơn. Chốt đơn vẫn cần tín hiệu chốt
    của code + đủ phone+address+size thật + POS. (Tránh AI đoán sai -> chốt nhầm.)
  -> AI giúp NHẬN DIỆN/định tuyến; CODE giữ quyền THỰC THI mọi thứ chạm tiền/đơn.

==================================================================
## FIX G — CRASH "_mapped is not defined" (LÀM KẸT HÀNG ĐỢI)
==================================================================
TRIỆU CHỨNG: log lặp liên tục "Lỗi processOnce: _mapped is not defined".
  -> Khách đến từ QUẢNG CÁO không resolve được mẫu (vd Trang Thủy, ad rỗng ad_ids=[])
     bị VĂNG giữa chừng, KHÔNG trả lời. Các khách phía sau cũng bị nghẽn.
GỐC: biến _mapped khai báo `let` BÊN TRONG block `if (!product){...}` nhưng lại
  được dùng NGOÀI block ở "if (_adId && !_mapped)" cuối -> ngoài phạm vi -> ReferenceError.
  (Lỗi SẴN CÓ trong bản gốc, không phải do sửa của các phiên trước.)
SỬA: đưa khai báo `let _mapped = null, _mapKey = ""` ra SCOPE NGOÀI (trước block).
  -> các phép gán bên trong vẫn chạy; ở cuối _mapped luôn tồn tại -> hết crash.
KẾT QUẢ: khách từ quảng cáo không ra mẫu giờ chảy xuống LUỒNG THƯỜNG bình thường
  (báo giá theo ảnh/tên, hoặc giao người nếu chưa rõ mẫu) thay vì văng.

==================================================================
## FIX H — Bot CHEN BÁO GIÁ vào thread khiếu nại (khách thả 👍)
==================================================================
CA THẬT: Cô Bé Hay Cười — đơn đã HOÀN về shop, khách khiếu nại giao hàng,
  NGƯỜI THẬT đang xử lý. Khách thả 👍 -> bot chen "Dạ Váy Giannal giá 890.000đ...".
GỐC: đường báo giá QUẢNG CÁO (mục 4195) CỐ Ý bỏ chặn người thật (để khách cũ
  bấm AD MỚI vẫn được báo giá), chỉ dựa vào shopRepliedAfterLastCustomer.
  Khách thả 👍 SAU tin người thật -> shopReplied=false -> cổng MỞ -> báo giá.
  Một cái 👍 bị hiểu là "bấm ad -> báo giá".
SỬA: thêm guard _adAck = isBareAck || isAffirmation || (humanInbox & tin rỗng/sticker).
  Tin khách CHỈ là 👍/ok/ừ/cảm ơn (hoặc sticker rỗng khi có người thật) -> KHÔNG báo giá.
GIỮ ĐÚNG ca hợp lệ: khách gõ câu hỏi mẫu thật ("có đầm trắng ko") -> VẪN báo giá;
  ad landing mới (rỗng, chưa có người thật) -> VẪN báo giá.

GHI CHÚ ca STOCK (Phuong Pham "có size cua c ko"): AI gắn STOCK -> ĐÚNG
  (hỏi sẵn có size). Bot xác nhận 2 mẫu sẵn -> hợp lý.

------------------------------------------------------------------
## FIX H+I — chỉnh theo phản hồi: câu STOCK bám size + guard 👍 đúng hơn
------------------------------------------------------------------
(I-1) STOCK trả lời BÁM câu hỏi size:
  Khách hỏi "có size của c ko" -> KHÔNG trả chung chung "có sẵn" nữa.
  - Biết size khách: "Dạ cả N mẫu này đều có sẵn size <S> của chị đó ạ, ..."
  - Chưa biết size: "Dạ cả N mẫu này đều có đủ size cho chị đó ạ, chị cho em xin size..."
  - Không nhắc size (chỉ hỏi "còn hàng") -> giữ câu cũ "đều có sẵn".

(I-2) Guard 👍 KHÔNG còn phụ thuộc humanInbox (sửa nhận định trước):
  Ca Cô Bé Hay Cười: NV xử lý đã LÂU, tin cuối là 👍 của khách -> không nên dựa
  vào "người thật đang xử". Đổi điều kiện: tin khách là ack/👍/sticker rỗng + hội
  thoại ĐÃ CÓ lịch sử (>=3 tin, hoặc đã từng báo giá/đã có đơn) -> KHÔNG báo giá.
  -> Bắt cả 👍 dạng text LẪN sticker rỗng, bất kể có người thật hay không.
  -> Giữ đúng: bấm ad có câu hỏi mẫu thật / ad landing mới (1-2 tin) -> VẪN báo giá.

==================================================================
## FIX J — Comment-only: ảnh dính lỗi FB #10 "ngoài khoảng thời gian"
==================================================================
TRIỆU CHỨNG: khách BÌNH LUẬN -> bot gửi chữ (OK) rồi gửi 3 ảnh -> tất cả lỗi
  "(#10) Tin nhắn gửi ngoài khoảng thời gian cho phép" -> gắn nhầm thành "ảnh hỏng".
GỐC (luật Facebook, KHÔNG phải bug ảnh):
  - Khách BÌNH LUẬN: FB chỉ cho gửi 1 tin private-reply (đã dùng cho chữ báo giá).
  - Cửa sổ 24h (gửi nhiều tin/ảnh) CHỈ mở khi khách NHẮN INBOX, KHÔNG mở khi chỉ bình luận.
  - Ảnh = các tin gửi thêm -> ngoài cửa sổ -> FB chặn #10.
SỬA:
  - Chỉ gửi ảnh khi windowOpen (canInbox=true HOẶC khách đã có tin inbox).
  - Comment-only (cửa sổ chưa mở) -> HOÃN gửi ảnh, log rõ "không phải lỗi ảnh",
    KHÔNG gắn thẻ AI-XL ảnh giả.
  - QUAN TRỌNG: chỉ đánh dấu sentImageCodes bên INBOX khi ảnh THỰC SỰ gửi được.
    Nếu hoãn -> KHÔNG đánh dấu -> khi khách NHẮN INBOX (cửa sổ mở) bot gửi ảnh lúc đó.
  - Bot vẫn gửi chữ báo giá + comment công khai "check inbox" để mời khách nhắn tin
    -> khách nhắn -> cửa sổ mở -> ảnh tự gửi. Đúng luật FB, hết spam lỗi #10.

------------------------------------------------------------------
## FIX J (bổ sung) — Hoãn gửi ảnh: GẮN thẻ AI-XL ảnh + TỰ GỠ khi gửi được
------------------------------------------------------------------
- Ca HOÃN gửi ảnh (comment-only, cửa sổ 24h chưa mở): GẮN thẻ AI-XL ảnh để NV
  thấy ĐANG NỢ ẢNH (theo yêu cầu) + unread.
- KHI GỬI ĐƯỢC ẢNH (khách nhắn inbox -> cửa sổ mở -> bot gửi): thẻ TỰ GỠ
  (đã có sẵn: untagXuLyAnh trong luồng gửi ảnh, dòng ~3109/3345/3629).
-> Vòng đời thẻ đúng: bình luận mà chưa gửi được ảnh -> gắn thẻ nợ ảnh;
   khách nhắn tin -> gửi ảnh -> tự gỡ thẻ.

==================================================================
## FIX K — Khách từ QC cho SĐT+ĐỊA CHỈ -> bot vẫn báo giá + hỏi size lại
==================================================================
CA THẬT: Lương Thảo Mi bấm ad Grace -> cho "size s" -> gửi ảnh -> cho SĐT+địa chỉ
  (sẵn sàng chốt). Bot lại trả "Dạ Váy Grace ạ. Chị thường mặc size bao nhiêu..."
  -> hỏi lại size (dù đã cho) + lờ sđt/địa chỉ (đáng lẽ chốt đơn).
GỐC: cổng chặn báo giá quảng cáo (adCustTextBlocksQuote) chỉ chặn huỷ/hoàn/đã-đặt,
  KHÔNG chặn khi khách CHO sđt/địa chỉ -> cổng QC vẫn mở -> báo giá đè luồng chốt.
SỬA: thêm "|| customerGaveContact(_adCustNow) || mem._addrJustGiven" vào _adTextBlocks.
  Khách cho contact -> KHÔNG báo giá lại, để luồng CHỐT ĐƠN xử (size đã cho + sđt + địa chỉ).

==================================================================
## FIX L — ĐẢO LUẬT báo giá QC: chỉ báo khi khách HỎI GIÁ (hoặc mở đầu sạch)
==================================================================
Ý KIẾN ĐÚNG của chủ shop: "báo giá phải chặn tất cả các ca nếu khách không hỏi".
TRƯỚC: cổng báo giá QC dùng BLOCKLIST (chặn từng ca xấu: huỷ/hoàn/đã-đặt/ack/contact...)
  -> vá lỗ hoài, dễ sót -> ca Lương Thảo Mi (cho size+địa chỉ) vẫn bị báo giá.
NAY (luật dương / mặc-định-không-báo):
  const _adWantsQuote = isPriceAsk(_adCustNow) || !_adCustNow.trim();
  Cổng QC CHỈ mở khi: khách THỰC SỰ hỏi giá, HOẶC vừa bấm ad mà CHƯA nói gì (mở đầu sạch).
  Mọi câu khác (cho size, cho sđt/địa chỉ, "shop ở đâu", 👍, hỏi thuộc tính/tồn...) -> KHÔNG
  báo giá; để handler đúng (chốt đơn / size / tồn / ...) xử lý.

LƯU Ý (đánh đổi): khách bấm ad rồi gõ câu KHÔNG hỏi giá (vd "còn hàng ko", "mẫu đẹp")
  -> bot KHÔNG tự báo giá nữa, mà trả lời đúng câu đó. Nếu muốn vẫn show giá khi mới bấm
  ad dù khách gõ gì -> nới _adWantsQuote (báo lại để chỉnh).

GHI CHÚ KIẾN TRÚC: đường báo giá QC chạy TRƯỚC bước AI gắn nhãn (return ~4381, AI ~4616).
  Nên với tin từ QC, AI CHƯA được hỏi tới -> không phải AI sai nhãn, mà cổng QC chặn đầu.

==================================================================
## FIX M — Lần đầu từ AD: LUÔN báo giá + bám size + câu hành động
==================================================================
QUYẾT ĐỊNH của chủ shop: vừa bấm ad (lần đầu) -> LUÔN báo giá DÙ KHÁCH GÕ GÌ
  (size, "còn hàng", "mẫu đẹp"...) = báo giá + trả lời + câu hành động.

(a) Gate báo giá QC:
  - _adFirstAd = chưa từng báo giá mẫu nào trong hội thoại (lần đầu từ ad thật).
  - Lần đầu -> LUÔN mở cổng báo giá (không cần khách hỏi giá).
  - VẪN chặn ca xấu: huỷ/hoàn/đã-đặt + CHO sđt-địa-chỉ (đi CHỐT) + 👍/ack.
  - ĐÃ có lịch sử (bấm ad mới giữa chừng) -> giữ chặn hỏi-thuộc-tính/hỏi-tiếp
    để KHÔNG báo giá lại (giữ FIX A "Có quần trong k shop").

(b) Opener BÁM size khách vừa cho:
  - Trước khi dựng opener, bắt size từ tin khách (extractStatedSize), vd "cho c size s"->S.
  - sizeTailForProduct thấy có size -> ra CÂU HÀNH ĐỘNG: "Em lên đơn size S cho mình nha chị?"
  - => opener = "Dạ Váy Grace giá 890.000đ ạ. Em lên đơn size S cho mình nha chị?"
    (báo giá + xác nhận size + chốt) thay vì hỏi lại size.

LƯU Ý: nếu tin khách CÓ cả sđt/địa chỉ -> KHÔNG vào opener (đi LUỒNG CHỐT, đúng FIX K).
  Trường hợp "size + địa chỉ" cùng lúc -> luồng chốt bắt size + contact -> chốt đơn.

==================================================================
## FIX N — Hỏi GIÁ bị AI gắn nhầm DISCOUNT -> không báo giá
==================================================================
CA THẬT: Ngọc Phụng gửi ảnh Oviya + "Let giá s ak" (= lấy giá size S ạ = HỎI GIÁ).
  [AI-READ] nhãn=DISCOUNT -> bot trả "ít khi giảm giá... freeship..." thay vì BÁO GIÁ.
GỐC: AI (gpt-4.1-mini) hay nhầm "giá"/"lấy giá" thành DISCOUNT. Đã nối _ai("DISCOUNT")
  vào nhánh giảm giá -> nhãn sai kéo nhầm nhánh, nuốt câu hỏi giá.
  (asksDiscount("Let giá s ak") = false -> chỉ do nhãn AI).
SỬA (nguyên tắc cho nhãn money-adjacent): nhãn AI DISCOUNT CHỈ kích nhánh giảm giá
  khi câu THỰC SỰ có từ giảm/bớt/sale/km/ưu đãi/deal/rẻ hơn...
    const _aiDiscount = _ai("DISCOUNT") && /giảm|bớt|sale|.../.test(latestText);
  -> "lấy giá" KHÔNG còn bị coi là giảm giá -> chảy xuống BÁO GIÁ (code isPriceAsk vẫn
     bắt "giá" -> quote Oviya 1.580.000đ). Câu giảm giá thật vẫn vào đúng nhánh.
BÀI HỌC: AI cũng sai nhãn. Với nhãn đụng TIỀN, bắt buộc có TÍN HIỆU CHỮ mới cho AI rẽ.

==================================================================
## FIX O — Khách CŨ gửi cụm ảnh MỚI -> phải BÁO GIÁ (không nhét thẳng vào đơn)
==================================================================
YÊU CẦU: khách đã nói chuyện/đã chốt đơn trước đó, lần này gửi N ảnh MỚI (chưa từng
  báo giá) -> mặc định BÁO GIÁ từng mẫu, GIỮ luật mỗi mẫu báo giá 1 lần/24h.
ĐÃ ĐÚNG sẵn (khách chưa chốt đơn): cụm nhiều mẫu mới -> dòng 7105 sendBlocks báo giá
  từng mẫu; sendBlocks (3383) bỏ qua mẫu đã báo giá 24h -> giữ luật 1 lần.
GỐC THIẾU (khách ĐÃ chốt đơn): nhánh GĐ4 (_newModelAfterClose) bắt MỌI mẫu mới sau
  chốt -> NHÉT vào đơn cũ + xác nhận tổng, KHÔNG báo giá mẫu mới trước.
SỬA: _newModelAfterClose thêm điều kiện "lượt KHÔNG có mẫu chưa-báo-giá":
    && !thisTurn.some(p => !mem.pricedCodes.includes(code))
  -> Có mẫu MỚI chưa báo giá => KHÔNG auto nhét đơn, rơi xuống §13/sendBlocks BÁO GIÁ trước.
     Chỉ mẫu ĐÃ báo giá rồi (khách xem giá rồi) mới auto-thêm vào đơn.
  (Khách nói RÕ "lấy thêm" = _addIntent -> vẫn thêm thẳng, vì đó là ý chốt rõ ràng.)

------------------------------------------------------------------
## FIX O (SỬA LẠI) — GỬI ẢNH ≠ ĐỒNG Ý CHỐT -> bỏ HẲN auto-thêm vào đơn
------------------------------------------------------------------
Phản hồi đúng của chủ shop: gửi ảnh mẫu KHÔNG phải là đồng ý chốt/đặt. Khách từng
  chốt 1 đơn, lần sau gửi ảnh mẫu khác có thể chỉ ĐANG XEM/HỎI -> KHÔNG được tự nhét
  vào đơn rồi xác nhận tổng (kể cả mẫu đã báo giá).
=> GỠ HẲN biến _newModelAfterClose. Nhánh GĐ4 (thêm mẫu vào đơn đã chốt) giờ CHỈ chạy
   khi khách NÓI RÕ: _addIntent = "lấy thêm / lên đơn thêm / đặt thêm / thêm mẫu /
   mẫu này nữa / lấy luôn cả" HOẶC AI=ADD_TO_ORDER HOẶC routeBatch=THEM_MAU_VAO_DON.
KẾT QUẢ:
  - Khách (đã/chưa chốt) gửi ảnh mẫu MỚI mà KHÔNG nói lấy -> BÁO GIÁ mẫu mới (§13/
    sendBlocks), giữ luật mỗi mẫu 1 lần/24h. KHÔNG auto-chốt, KHÔNG đòi địa chỉ.
  - CHỈ khi khách nói rõ "lấy thêm..." -> mới thêm vào đơn cũ + xác nhận tổng.

==================================================================
## FIX P — Khách cho ĐỊA CHỈ/SĐT mà AI tự soạn lời "size phù hợp" (không chốt thật)
==================================================================
CA THẬT: Ly Hoàng Khánh — bot đã tư vấn "size M", xin địa chỉ. Khách cho sđt+địa chỉ.
  Log: FOCUS no_detect, lock=-, size=- (MẪU Celyne + size M ĐÃ MẤT khỏi state).
  -> luồng chốt code không chạy (action=NONE) -> rơi vào [AI-REPLY on] -> AI tự soạn
  "Em lên đơn váy Celyne size phù hợp cho mình nha" (KHÔNG tạo đơn thật; "size phù hợp"
  = placeholder do bộ khử-size-bịa (dòng 1462) thay "size M" vì size đã mất).
PHÂN TÍCH:
  - Gốc sâu: MẤT STATE mẫu+size giữa các lượt (cần log lượt trước để truy vì sao Celyne
    lock biến mất -> chưa sửa ở đây).
  - Nguy hiểm trước mắt: AI được tự trả lời lượt KHÁCH-CHO-ĐỊA-CHỈ (đụng đơn/tiền).
SỬA (an toàn, đúng nguyên tắc tiền/đơn = code/người, không để AI chế):
  - Cổng [AI-REPLY on] thêm chặn: customerGaveContact(latestText) || mem._addrJustGiven
    || _ai(ADDRESS) || _ai(PHONE) || _ai(ORDER_CLOSE) -> KHÔNG cho AI tự soạn lời.
  - Mẫu/size còn -> luồng chốt code chạy (ở nhánh trên, không tới đây).
    Mất mẫu/size -> ĐẨY NGƯỜI THẬT chốt đúng (không ra câu "size phù hợp" sai lệch).
CẦN LÀM TIẾP (cần log): truy vì sao mẫu Celyne + size M bị mất state ở lượt cho địa chỉ
  -> nếu giữ được state, bot tự chốt (buildOrderConfirmation) thay vì đẩy người.

==================================================================
## FIX Q — BỔ SUNG câu xử lý 8 tình huống (đuôi chốt ĐỘNG _closeTail)
==================================================================
NGUYÊN TẮC: mọi câu dẫn tới size/contact dùng _closeTail -> CÓ size KHÔNG xin size,
  CÓ địa chỉ KHÔNG xin địa chỉ, đủ thông tin -> mời lên đơn. Freeship đơn trên 500k.

(1) CHÊ ĐẮT / mặc cả (priceObjection): thay câu cũ -> 3 câu giá-trị + freeship 500k + COD (xoay vòng).
    SO GIÁ chỗ khác (priceComparison): thay -> 3 câu định vị thương hiệu/thiết kế (xoay vòng).
(3) BẦU / SAU SINH (asksPregnancyFit): HỎI "bầu mấy tháng" + nhường người thật (không tự khẳng định mặc-được).
(4) CÓ SẴN / ĐẶT TRƯỚC (asksInStockOrPreorder): "hàng có sẵn + ưu tiên gửi sớm" + _closeTail.
    (đã chặn asksInStock nuốt câu "có sẵn hay phải đặt").
(5) RESTOCK (asksRestock): "mẫu hết không tái sản xuất, chốt sớm mẫu còn lại".
(8) UY TÍN / BOM HÀNG (fearsTrustOrScam): trấn an COD (kiểm tra hàng trước khi trả tiền), 2 câu xoay vòng.

ĐÃ CÓ SẴN (không cần thêm):
(6) BIGSIZE / ngoài bảng size: câu "tiếc quá... không có size vừa... lựa mẫu khác" (dòng 1932/5949).
(7) HOÀN TIỀN / LỖI: nhường NGƯỜI THẬT (chính sách nhạy cảm).

CÒN LẠI — CẦN DỮ LIỆU (chưa làm, tránh bịa):
(2) MÀU X CÒN/HẾT: cần dữ liệu TỒN theo MÀU mới nói "còn/hết" chính xác. Hiện bot chưa có
    cột tồn-màu tin cậy -> chưa wire "còn màu be"/"hết màu đen". Nếu có cột tồn màu (hoặc
    quy ước màu hết) -> mình wire: màu còn -> xác nhận + _closeTail; màu hết -> gợi màu còn lại.

==================================================================
## FIX R — Hoàn thiện câu CHẤT/CO GIÃN/NÓNG/ĐỆM (tên mẫu + xoay vòng + đuôi động)
==================================================================
- CHẤT LIỆU (materialReplyFromSheet): vải mát -> câu đầy đủ "...thoáng mát dễ chịu...
  hợp thời tiết nóng, đứng/ngồi cả ngày thoải mái"; vải thường -> "Dạ {mẫu} là chất {chất} ạ"
  (KHÔNG nói thoáng mát cho vải dày).
- CO GIÃN (stretchReplyFromSheet, thêm tham số mem để xoay vòng):
  + KHÔNG co giãn: 2 câu (chất đứng/phom đẹp/bền không dão) xoay vòng.
  + CÓ co giãn: 2 câu (dễ mặc/ít kén dáng/cử động thoải mái) xoay vòng.
  -> cập nhật 2 nơi gọi truyền mem.
- NÓNG/BÍ (buildHeatPersuade(mem, product)): 2 câu của shop, có {tên mẫu}, 1 câu nhắc
  "kiểm hàng trước khi thanh toán". -> cập nhật nơi gọi truyền productInfo.
- ĐỆM NGỰC (CÓ): 2 câu xoay vòng + ĐUÔI CHỐT ĐỘNG _closeTail
  (có size -> mời lên đơn; chưa size -> xin số đo; có size chưa contact -> xin sđt+địa chỉ).

==================================================================
## FIX S — "Váy liền hay rời" bị báo giá đè (câu hỏi thuộc tính trên ad lần đầu)
==================================================================
CA THẬT: Minh Ngàn (ad Giannal) hỏi "Váy liền hay rời ạ" -> bot BÁO GIÁ LẠI + hỏi size,
  KHÔNG trả lời liền/rời.
PHÂN TÍCH (đáp câu hỏi chủ shop "có phải vì hỏi giá nên AI ko kịp vào?"):
  - KHÔNG phải AI không kịp. Bot CÓ handler "liền/rời" (asksSkirtOrSet -> "Dạ ... là váy
    liền/set rời ạ" + CTA thích ứng).
  - Lỗi: ĐƯỜNG BÁO GIÁ QUẢNG CÁO chạy TRƯỚC handler (luật FIX M "lần đầu từ ad luôn báo giá").
    Tin báo giá đầu đến từ Botcake/comment nên bot này KHÔNG ghi nhận -> coi "liền/rời" là
    LẦN ĐẦU từ ad -> báo giá đè câu hỏi.
SỬA:
  - Thêm asksSkirtOrSet (liền/rời) + asksCategory (áo/váy/set) vào _adAttrQ.
  - _adDontOpen: câu hỏi THUỘC TÍNH/LOẠI (_adAttrQ) LUÔN nhường handler trả lời, KỂ CẢ lần
    đầu từ ad (trước đây chỉ nhường khi đã có lịch sử). -> "liền/rời", "chất", "còn hàng",
    "màu", "lót/đệm/co giãn/mỏng/ngắn" => handler trả lời, KHÔNG báo giá đè.
  - GIỮ FIX M: landing rỗng / hỏi giá / khai size -> vẫn báo giá (+ bám size). Block khôi phục
    mẫu (4190) đã chạy cho _adAttrQ -> handler có productInfo để trả lời.

==================================================================
## FIX T — 3 vấn đề từ hội thoại Thuy Linh
==================================================================
### T1. SĐT/địa chỉ chữ CÁCH ĐIỆU không nhận ra (gốc của "xin SĐT mãi")
CA THẬT: khách gửi "𝟮𝟵𝘾𝙝𝙞 𝙇𝙖̆𝙣𝙜 - 𝙃𝙪̛̃𝙪 𝙇𝙪̃𝙣𝙜 -𝙇𝙖̣𝙣𝙜 𝙎𝙤̛𝙣 ☎ 𝟬𝟵𝟴𝟵𝟭𝟳𝟵𝟬𝟲𝟬"
  -> đây là Unicode TOÁN HỌC (in đậm/nghiêng), KHÔNG phải ảnh, KHÔNG phải text ASCII.
  Regex SĐT cần số ASCII nên TRƯỢT -> bot "thiếu SĐT -> xin nốt" lặp lại.
SỬA: chuẩn hoá NFKC text khách NGAY NGUỒN (mỗi tin trong batch, dòng latestTextRaw) + thêm NFKC
  vào normalizeViet. NFKC đổi 𝟬->0, 𝘾->C... -> "29Chi Lăng - Hữu Lũng -Lạng Sơn ☎ 0989179060",
  regex bắt được "0989179060". An toàn cho tiếng Việt (giữ dấu), emoji không đổi.

### T2. Khách nói "đã gửi ở trên rồi" mà bot vẫn không bắt được -> ĐẨY NGƯỜI (đừng cãi tay đôi)
CA THẬT: bot xin SĐT -> khách "Sdt ở trên c gửi r mac" -> bot vẫn "xin SĐT" tiếp (cãi tay đôi).
SỬA:
  - Mở rộng claimsAlreadyGaveInfo: bắt thêm "ở trên/nãy ... rồi", "(gửi/cho/đưa/cung cấp) ... rồi".
  - Nhánh "có địa chỉ, thiếu SĐT" (trước chỉ xin lại mãi): nay XIN 1 LẦN, lần sau khách vẫn nói
    đã gửi mà KHÔNG bắt được -> "em nhờ bạn phụ trách hỗ trợ" + thẻ CHỜ XL người thật. Cờ
    _reaskedPhone reset khi bắt được SĐT hợp lệ. (Nhánh địa chỉ đã có sẵn cơ chế này từ trước.)
  - LƯU Ý: T1 (NFKC) đã giải quyết ĐÚNG ca này (giờ bắt được SĐT); T2 là LƯỚI AN TOÀN khi
    trích xuất thật sự thất bại.

### T3. "Váy liền hay rời" khi CHƯA báo giá -> phải BÁO GIÁ kèm (chủ shop yêu cầu)
Tinh chỉnh FIX S: handler asksSkirtOrSet nay kiểm tra đã báo giá chưa.
  - CHƯA báo giá (mã chưa trong pricedCodes / chưa quotedRecently) -> ghép giá vào đầu:
    "Dạ Váy Giannal giá 890.000đ, là váy liền ạ. [CTA]" + markPriced.
  - ĐÃ báo giá -> chỉ trả lời "Dạ Váy Giannal là váy liền ạ. [CTA]" (không báo lại).

==================================================================
## FIX U — Tin khách CHEN vào lúc bot đang gửi ảnh (chậm) bị nuốt
==================================================================
CA THẬT: Nhật Quyên hỏi "Chi nhánh ở Vinh có sẵn ko em" TRONG lúc bot gửi ảnh từng-tấm
  (album content_id lỗi -> gửi chậm). Bot gửi xong -> bot là "người nhắn cuối" -> filter list
  (khachDangCho theo last_sent_by) LOẠI hội thoại -> tin "Vinh" không bao giờ được mở lại -> KHÔNG trả.
  (Khách gõ "." để bump -> "." rỗng nội dung -> AI=OTHER -> chỉ hỏi size.)
PHÂN TÍCH:
  - KHÔNG phải thiếu detector: "chi nhánh ở Vinh có sẵn" khớp asksShopAddress + asksInStock (có handler).
  - Gốc TIMING: _spoke() (bắt chen tin) dựa vào lastCustomerMsgAt, map này chỉ cập nhật khi bot POLL;
    lúc gửi ảnh chậm bot không poll -> không thấy tin chen. Xong gửi -> list loại theo "ai nhắn cuối".
SỬA (không đụng logic "ai nhắn cuối", dùng đúng batchNew lọc-theo-messageId đã có):
  - maybeSendImages: đặt mốc _imgT0 đầu hàm; gửi ảnh xong mà CHẬM (>4s, tức path gửi-từng-tấm)
    -> forceRecheckConvs.add(conv) (ép xử lại 1 LƯỢT, cờ tự xoá ở đầu processOneConversation).
  - Vòng sau: hội thoại được mở lại; batchNew (4472, lọc theo messageId) thấy tin khách CHƯA xử
    -> trả nốt (handler chi-nhánh/có-sẵn lo). KHÔNG có tin mới -> guard 4477 (!batchNew.length)
    -> bot IM, chỉ tốn 1 lần đọc. _shopReplyAfter loại tin của chính bot nên không tự chặn.
  - Người thật nhắn xen vẫn được tôn trọng (_shopReplyAfter=true -> nhường người).
GHI CHÚ: phần "lưu câu hỏi chưa trả lời để bump lôi ra" (phụ) CHƯA làm — fix này đã trả tin chen
  TRƯỚC khi khách phải bump nên phần lớn ca được giải quyết; thêm sau nếu vẫn cần.

==================================================================
## FIX V — Khách cho SĐT xong, bot HỎI "lấy màu nào" thừa (Phuong Pham)
==================================================================
CA THẬT: Khách vào từ comment bài Ovelles (MRKVX6331) màu hồng -> bot báo giá + gửi ảnh hồng.
  Khách cho size M + SĐT -> bot hỏi "chị lấy màu nào ạ để em lên đơn" -> khách rối "E đang hỏi mẫu nào".
GỐC:
  - Handler "khách cho contact -> chốt" (~5076) tính _needColorC = mẫu >=2 màu && CHƯA chốt màu (chosenColorForCode).
  - chosenColorForCode (1639) CHỈ tính "đã chốt" khi khách TỰ chọn/gửi ảnh đúng màu (orderColorByCode) hoặc mẫu 1 màu;
    CỐ TÌNH bỏ qua sourceColorByCode (màu hồng đến từ comment) để tránh lên đơn sai màu.
  - Ovelles >=2 màu, hồng mới là MÀU NGUỒN -> _needColorC=true -> hỏi "lấy màu nào".
  - Đã có luật ngược ở 7811 ("bám 1 màu -> MẶC ĐỊNH chốt màu đó, KHÔNG hỏi") nhưng nằm SAU handler 5076 nên không tới được.
SỬA (sao y guard của luật 7811, đặt TRƯỚC khi tính _needColorC):
  - Mẫu >=2 màu & chưa chốt màu: nếu khách KHÔNG hỏi màu khác (asksOtherColors) và hội thoại bám 1 màu
    (_focus = askedImageColor / lastSentImageColor / sourceColorByCode / colorByCode, khớp 1 màu của mẫu)
    -> set mem.orderColorByCode[code] = màu đó -> chosenColorForCode trả màu -> _needColorC=false.
  - Bot KHÔNG hỏi màu nữa, rơi xuống xin nốt ĐỊA CHỈ (cái thật sự thiếu) rồi chốt.
  - An toàn: chỉ mặc định khi RÕ 1 màu xuyên suốt + khách KHÔNG hỏi màu khác -> không lên đơn sai màu.
    Khách hỏi màu khác (asksOtherColors) -> set multiColorInterest -> VẪN hỏi "lấy màu nào" như cũ.

==================================================================
## FIX W — Đơn HẬU MÃI (giao lại / hoàn) bị bot nhảy vào BÁN
==================================================================
2 CA THẬT:
  - CA1 Milan Pham (Givora): đơn đang GIAO LẠI lần 3 (ship gọi ko nghe, "nhận đơn giúp"). Người thật đang lo.
    Khách "Cứ giao giờ như chị nói" -> bot (từ ad Givora) BÁO GIÁ "Set Givora 990.000đ" + ảnh. SAI.
  - CA2 Thanh Huyền (hoàn): đơn cũ đang HOÀN ("hỗ trợ 30k phí ship hoàn hàng"). Khách "R mà bạn".
    -> CLIP trượt -> vớ tên mẫu shop cũ MMVX502 (Nayeli, mẫu KHÁC) -> hỏi size + GỬI 7 ẢNH. SAI.
GỐC CHUNG:
  - isPriorityOrder/isSensitiveHandoff CHỈ soi tin KHÁCH mới nhất (vô hại) -> trượt.
  - Tín hiệu hậu mãi nằm trong tin NGƯỜI THẬT (giao lại / phí ship hoàn) -> không ai soi.
  - Cổng ad-quote (4280+) chạy TRƯỚC handoff theo trạng-thái-đơn (5704) nên báo giá trước.
  - Lỗ hổng CA2: lệnh GỬI ẢNH không qua bộ "nhường người" -> text bị bỏ nhưng 7 ảnh vẫn gửi.
SỬA (detector + chốt SỚM, theo đúng chốt của shop):
  - Thêm postSaleContext(messages): quét ~10 tin gần nhất CỦA KHÁCH+NGƯỜI THẬT (LOẠI tin bot qua botSentIds),
    bắt cụm RÕ: DELIV (giao lại/ship báo-gọi/không nghe máy/nhận đơn giúp/hàng giao từ ngày/hẹn giao),
    RFEE ("phí ship hoàn" - KHÔNG bắt "phí ship" chung = pre-sale), + statedReturnAction/isReturnRefund(!policy).
  - Chốt đặt NGAY sau readConversation (trước cổng ad + size + ảnh): nếu !orderClosed && postSaleContext
    -> tagChoXuLyVaUnread (gắn người thật) + markProcessed + return. Bot KHÔNG báo giá/size/ảnh.
  - Vòng sau: thẻ AI-CHỜ XL còn -> chốt "thẻ giữ -> AI đứng ngoài" (3914) lo, không lặp.
AN TOÀN (đã test offline): CA1/CA2 -> true; "ship bao lâu" / "có được đổi trả không" / "giá bao nhiêu" -> false.
  - KHÔNG bỏ option tra-đơn-theo-SĐT (1 khách nhiều đơn, phải khớp mã SP mới đúng -> phức tạp/dễ sai).
  - KHÔNG nhét "phí ship" chung (pre-sale có quy định riêng).
  - LƯU Ý: nếu Botcake (bot phụ của shop) tự nhắn câu giao/hoàn thì cũng tính hậu mãi (không nằm trong botSentIds)
    -> handoff, chấp nhận được vì đó cũng là dấu hiệu đang xử đơn.

==================================================================
## FIX W+ — Mở rộng detector hậu mãi: thread ĐANG CHỜ GIAO (hỏi tình trạng đơn)
==================================================================
CA THẬT (Thien Ngoc Nguyen): khách hỏi giao đơn cũ ("e giao chưa", "nay đã giao hàng chưa", "T4 là chị đi rồi").
  Bot đã auto-trả "chờ thêm... ưu tiên gửi tới chị sớm" ở lượt trước. Lượt sau khách "Ui e ơi / T4 là chị đi rồi"
  (vô hại) -> CLIP trượt -> vớ tên mẫu từ caption ad/post (Plena) -> "Hỏi giá mẫu mới gửi" -> báo 990k. SAI.
VÌ SAO FIX W TRƯỢT: detector W chỉ bắt giao-lại/hoàn/phí-ship-hoàn. "đã giao chưa" / "chờ thêm / giao kịp"
  KHÔNG khớp -> postSaleContext=false -> không chặn.
SỬA (thêm Part B vào postSaleContext): nếu lịch sử gần đây có câu CHỜ-GIAO của shop/BOT (kể cả tin bot, vì
  chính bot auto-trả "chờ thêm" lượt trước): chờ thêm / gấp rút hoàn thiện / quá tải / cố gắng (nhanh nhất/giao) /
  đang chuẩn bị để gửi / ưu tiên gửi -> coi là HẬU MÃI -> nhường người thật.
  - GIỮ tính năng auto trả tình trạng đơn ở lượt ĐẦU (lúc đó CHƯA có câu chờ-giao -> Part B chưa kích).
  - "đã gửi đi rồi" (đơn đã ship xong) KHÔNG nằm trong WAIT -> không handoff thừa.
TEST OFFLINE: CA3(chờ giao)/CA1/CA2/chuẩn-bị-gửi -> true; báo-giá+size-M / "ship bao lâu" / "đã gửi đi rồi+cảm ơn" -> false.

==================================================================
## FIX X — Nhãn URGENT + state guard đơn đã chốt (AI làm não, code trả lời)
==================================================================
THEO CHỈ ĐẠO SHOP: dùng STATE (mem) thay vì nhét lịch sử cho AI (tốn token, không hiệu quả);
  AI CHỈ phân nhánh (trả 1 nhãn), câu trả khách LUÔN do code; mọi nhãn nhạy -> người thật.

A) ai_intent.js: THÊM nhãn "URGENT" (deadline/gấp: "mai chị đi", "T4 là đi rồi", "cần gấp", "trước thứ 5",
   đi tiệc/cưới) + ví dụ prompt + đặt ưu tiên cao (sau CANCEL_ORDER). AI chỉ trả nhãn này, KHÔNG tự soạn câu.
B) bot_worker DISPATCH (~4780): _ai("URGENT") HOẶC code bắt mốc ngày (isUrgentSpecificDate) khi KHÔNG phải
   hỏi-giá/chốt/cho-contact -> gắn AI-ĐƠN ƯU TIÊN (tagDonUuTienVaUnread) + câu ack do CODE viết -> người thật.
C) isUrgentSpecificDate: nhận thêm viết tắt "T2..T7" và "CN" -> "T4 là chị đi rồi" giờ thành ĐƠN ƯU TIÊN
   (lưới deterministic, phòng khi AI off/timeout). Test: T4/t5/CN -> true; "giá bao nhiêu"/"size m" -> false.
D) STATE GUARD (~4810): đơn ĐÃ CHỐT (mem.orderClosed) + tin MƠ HỒ (AI=OTHER) + KHÔNG đưa mẫu mới
   (!fromImages && !fromText) + không contact/không hỏi giá -> KHÔNG vớ mẫu ad/CLIP báo giá lại; nhường người.
   - Hẹp & an toàn: chỉ kích khi AI=OTHER; mọi nhãn rõ (THANKS/ORDER_STATUS/DELIVERY_QA/SIZE/PRICE...) giữ handler cũ.
   - Khách đưa mẫu MỚI (ảnh/tên) -> đơn mới, guard bỏ qua, bán bình thường (tránh conflation tin cũ).

KIỂM SOÁT QUYỀN AI: các nhánh mới (URGENT) AI chỉ cho RA NHÃN; định tuyến + câu trả đều do code.
  KHÔNG đụng hệ AI-REPLY (reasoning) hiện có (rủi ro cao, không nằm trong yêu cầu) - chỉ siết nhánh nhạy.
LƯU Ý: state guard D chỉ phủ đơn BOT tự chốt (mem.orderClosed). Đơn người-thật-lên/phiên cũ -> FIX W (hậu mãi) lo.

==================================================================
## FIX Y — Báo giá 2 lần + AI tự soạn câu trong ngữ cảnh thanh toán
==================================================================
LỖI 2 (Mai Đức Trung - báo giá Mironne 2 lần):
  - Lần 1: CỔNG AD (khách trả lời ad gõ tên mẫu -> báo giá). Lần 2: handler "Khách xin tư vấn" (cùng câu opener
    "Tư vấn cho Chị thiết kế Mironne") báo giá LẠI + gửi lại 3 ảnh. Cờ alreadyQuoted chặn cổng AD nhưng KHÔNG chặn
    handler "tư vấn".
  - FIX (~7755): handler "tư vấn" check quotedRecently(mem, code). ĐÃ báo giá lượt trước -> markProcessed + return,
    KHÔNG báo lại, KHÔNG gửi lại ảnh (im lặng, đã trả ở lượt trước).

LỖI 1 (Phạm Trà My - AI tự soạn "hệ thống lỗi" giữa ngữ cảnh thanh toán):
  - GỐC: hệ AI-REPLY (reasoning) TỰ SOẠN câu trả lời, BẬT bằng AI_REPLY_MODE=on trong .env. Khách hỏi "Bên c nhận
    chưa" (đã nhận TIỀN chưa) nhưng AI phân loại "Vâng"=THANKS -> lọt -> AI-REPLY nhại "hệ thống lỗi" của người thật.
  - FIX CHÍNH (.env, KHÔNG cần sửa code): đặt **AI_REPLY_MODE=off** -> AI KHÔNG bao giờ tự soạn câu trả khách.
    Đúng nguyên tắc shop: AI chỉ phân nhánh, code trả lời. (Câu không có kịch bản -> đẩy người thật.)
  - FIX CODE (phòng thủ, ~4764): thêm detector ngữ cảnh THANH TOÁN bằng code (đã ck / chuyển khoản rồi / ck rồi /
    báo thành công / nhận được tiền / nhận tiền chưa / bên c nhận chưa) -> NGƯỜI THẬT. Không phụ thuộc nhãn AI,
    chạy TRƯỚC đường AI-REPLY -> dù AI_REPLY_MODE còn =on cũng không nhảy vào việc tiền nong.

==================================================================
## FIX Z — Ca Ngoan: khách nhắc NHIỀU mẫu mà cổng ad báo giá 1 mẫu
==================================================================
HIỆN TƯỢNG: Ngoan gửi 5 ảnh + "Mấy cái này" + "Nặng 46,5kg" -> bot báo giá ĐÚNG 1 mẫu (Miretta của ad).
PHÂN TÍCH (từ log): KHÔNG có turn "Khách gửi 5 ảnh" nào -> 5 ảnh KHÔNG được xử như lượt nhận diện
  (nhiều khả năng bị gộp vào ảnh bài ad: log ghi imgs=16). Bot chỉ thấy phần CHỮ ("Mấy cái này"/"Nặng..."),
  cổng ad (turnImg=false) báo giá mẫu ad Miretta.
FIX (cổng ad, ngay trước khối báo giá):
  - Thêm hàm referencesMultipleModels(text): bắt "mấy cái này / mấy mẫu này / các mẫu / những bộ / 2 mẫu này / nhiều mẫu".
  - Nếu fromAd + khách nhắc NHIỀU mẫu + lượt này KHÔNG có ảnh (!_adTurnHasImage) + chưa có người thật trả sau
    -> KHÔNG báo giá 1 mẫu ad (thiếu) -> gắn AI-CHỜ XL + NGƯỜI THẬT báo đủ. (Đúng nguyên tắc "thiếu mẫu -> người thật".)
  - Khách gửi ẢNH thật lượt này (turnImg=true, ≥2 mẫu) -> KHÔNG vướng guard này, luồng multi-quote lo như cũ.
GIỚI HẠN (nói thẳng): fix bắt theo TÍN HIỆU CHỮ "mấy cái này". GỐC sâu hơn (5 ảnh khách bị gộp vào ảnh ad,
  không thành lượt nhận diện) CHƯA xử - cần repro + log lúc 5 ảnh tới để sửa tầng đọc ảnh/album.

==================================================================
## FIX Z2 — GỐC ca Ngoan: ảnh album bị RƠI khỏi batch (chỉ nhận text, bỏ ảnh)
==================================================================
GỐC THẬT (xác nhận qua screenshot có timestamp): getLastCustomerMessages gộp lượt theo cửa sổ 15 GIÂY.
  Khách gửi 5 ẢNH (album) -> rồi MỚI gõ "Mấy cái này" + "Nặng 46,5kg" (mất >15s).
  -> Lúc bot xử, 5 ảnh đã quá 15s -> BỊ LOẠI khỏi batch -> _adTurnHasImage=false
  -> cổng ad (turnImg=false) báo mẫu ad (Miretta) rồi return, CHƯA tới khâu getProductsFromImages.
  => Đây là lý do "bot chỉ nhận diện text mà bỏ ảnh nhiều". KHÔNG phải do các fix trước làm bung.
FIX (getLastCustomerMessages): tin THƯỜNG giữ 15s như cũ; riêng ẢNH giữ cửa sổ 90s -> album gửi sớm rồi
  gõ chữ sau KHÔNG bị rơi. (Ảnh đã xử lượt trước -> batchNew lọc, không báo lại; mẫu đã báo -> FIX Y chặn trùng.)
KẾT HỢP FIX Z: nếu khách KHÔNG gửi ảnh, chỉ gõ "mấy cái này" -> FIX Z giao người thật. Nếu CÓ ảnh (giờ đã giữ
  được) -> nhận diện + báo đủ mẫu (luồng multi-quote). Hai fix bù nhau.

==================================================================
## FIX Z3 — Gộp lượt theo BIÊN HỘI THOẠI (bỏ cửa sổ thời gian)
==================================================================
Thay cách FIX Z2 (cửa sổ 90s cho ảnh) bằng cách ĐÚNG bản chất theo yêu cầu shop:
  getLastCustomerMessages = LẤY CẢ LƯỢT KHÁCH = MỌI tin khách kể từ tin SHOP/bot GẦN NHẤT.
  KHÔNG cắt theo 15s/90s nữa. Khách gửi album ảnh rồi vài chục giây/phút sau mới gõ chữ -> vẫn CÙNG 1 lượt.
ƯU ĐIỂM so với cửa sổ thời gian:
  - Không bao giờ rơi ảnh dù khách gõ chữ trễ bao lâu.
  - Ảnh ĐÃ được bot trả lời -> nằm TRƯỚC tin bot -> tự bị loại -> KHÔNG báo trùng (sạch hơn cửa sổ 90s).
  - debounce "đợi khách gõ xong" vẫn do lastCustomerMsgAt (2.5s) lo riêng -> không ảnh hưởng.
Fallback: nếu shop/bot nhắn cuối (chưa có tin khách mới) -> cụm khách cuối 15s (giữ hành vi cũ, tránh rỗng bất ngờ).
Kiểm: KB album+chữ -> giữ đủ ảnh; KB ảnh-đã-báo + chữ mới -> chỉ lấy chữ mới (không báo lại); node --check OK; 27/27.

==================================================================
## FIX Y2 — Lặp báo giá ở đường "Hỏi giá" (Thuỳ Dung)
==================================================================
HIỆN TƯỢNG: cổng AD báo Talia (lượt 1) -> "Cin giá" -> handler "Hỏi giá" báo Talia LẦN 2 + gửi lại 3 ảnh.
GỐC: FIX Y mới chặn đường "tư vấn"; đường "Hỏi giá" (priceAsk) CHƯA check mẫu đã báo -> báo lại.
FIX (~7237, ngay sau const k): if (quotedRecently(mem, k)) -> markProcessed + return (KHÔNG báo lại, không gửi lại ảnh).
  Đúng nguyên tắc shop: khách vẫn CHỈ hỏi giá + mẫu đã báo -> không gửi thêm. Mẫu MỚI (chưa quotedRecently) -> báo bình thường.
  Hỏi ý KHÁC (size/màu/chất) -> handler trên đã lo trước khối này.
GHI CHÚ: gốc sâu hơn là cổng AD báo giá xong KHÔNG markProcessed -> tin opener bị xử lại lượt sau. quotedRecently
  (FIX Y + Y2) là lưới chặn chắc cho mọi đường. Nếu muốn triệt để có thể thêm markProcessed vào return của cổng AD.

==================================================================
## FIX Y3 — Chặn GỐC lặp báo giá: markProcessed ở cổng AD (cẩn thận)
==================================================================
GỐC: cổng AD báo giá xong KHÔNG markProcessed tin opener -> vòng quét sau xử lại opener -> handler khác báo giá lần 2.
FIX (chỗ return của cổng AD, sau log "Tin từ QUẢNG CÁO -> báo giá"):
  - Đánh dấu tin opener ĐÃ XỬ (markProcessed) -> vòng sau không xử lại -> KHÔNG đường nào báo lại được.
  - CẨN THẬN (tránh bỏ sót ý): nếu opener còn hỏi GIAO/SHIP (isDeliveryTimeQuestion/isDeliveryConcern) -> KHÔNG đánh dấu,
    để handler giao trả nốt lượt sau. (Hỏi thuộc tính/màu/chất/tồn/tra-đơn -> đã bị _adDontOpen chặn, không vào nhánh quote;
    bảng size -> maybeSendSizeChart đã gửi kèm.)
  Test: "Cin giá"/"tư vấn"/bấm-ad-suông/"giá sao" -> ĐÁNH DẤU; "giá ... ship mấy ngày"/"bao lâu nhận hàng" -> GIỮ LẠI.
KẾT HỢP: Y3 (chặn gốc) + Y/Y2 (lưới quotedRecently ở handler tư-vấn & Hỏi-giá) -> chống lặp 2 lớp, chắc chắn.

==================================================================
## FIX AA — Hỏi "có QUẦN trong không": "2 lớp/lót" KHÔNG đủ để khẳng định
==================================================================
HIỆN TƯỢNG (Hà Thu): khách hỏi "Váy có quần trong K a"; sheet mẫu Giannal ghi "VÁY ... 2 LỚP" -> bot trả
  "Dạ mẫu này có lớp lót/quần bên trong ạ" -> SAI vì "2 lớp" có thể là lót VÁY, KHÔNG chắc là QUẦN.
FIX (handler "có quần/lót bên trong", ~6594): tách 2 trường hợp:
  - Khách hỏi RÕ "quần" (_asksPants: normalize bỏ dấu rồi khớp "quan") + mô tả KHÔNG ghi rõ chữ QUẦN
    (_descSaysPants=false; "2 lớp/lót" chung chung không tính) -> KHÔNG khẳng định có/không -> NGƯỜI THẬT.
  - Mô tả ghi RÕ quần (lót quần / quần 2 lớp / set + quần...) -> trả lời CÓ như cũ.
  - Hỏi CHUNG "có lót không" (không nhắc quần) -> "2 lớp/lót" vẫn đủ trả lời như cũ.
LƯU Ý regex: "quần" có ký tự "ầ" -> phải normalize NFD bỏ dấu rồi khớp "quan" (regex /qu[aâ]n/ trượt "quần").

==================================================================
## FIX AB — "mẫu này bao nhiêu tiền" bị nhầm thành TỔNG TIỀN (Thanhphuong Cao)
==================================================================
HIỆN TƯỢNG: khách gửi ảnh Miretta + "shop ơi mẫu này bao nhiêu tiền ạ" (hỏi giá 1 mẫu, AI gắn PRICE_ASK đúng)
  -> bot trả "Dạ đơn của chị tổng 950.000đ ạ, thanh toán khi nhận hàng" (coi là TỔNG TIỀN / chốt đơn) thay vì BÁO GIÁ.
GỐC: asksTotalPayment() bắt cả "bao nhiêu tiền|nhiêu tiền|bao tiền|mấy tiền" -> đây là HỎI GIÁ 1 MẪU, không phải tổng bill.
  Nhánh tổng-tiền (~7212) chạy TRƯỚC nhánh báo-giá nên cướp lượt.
FIX (asksTotalPayment, ~439): BỎ 4 cụm "bao nhiêu tiền|bao tiền|mấy tiền|nhiêu tiền" khỏi regex.
  -> chúng rơi về PRICE_ASK -> handler báo giá. Giữ các cụm TỔNG thật (tổng/tất cả/tính hết/cộng lại/bill/thanh toán hết).
  Test: "mẫu này bao nhiêu tiền"/"cái này nhiêu tiền" -> false (báo giá); "tổng bao nhiêu"/"tính hết"/"tổng bill" -> true.

==================================================================
## FIX AC — Gắn thẻ AI-CHỜ XL lặp vô hạn khi KHÔNG có tin khách (Lua Nguyen)
==================================================================
HIỆN TƯỢNG: đơn ĐÃ chốt/giao (Ovielle, đã thanh toán COD). Shop tự nhắn follow-up giao hàng
  ("shop vừa gọi chị nhưng chưa được... đơn hàng chưa được giao thành công..."). Khách KHÔNG nhắn gì.
  Bot (Public API) cứ gắn thẻ AI-CHỜ XL mỗi vòng poll -> NV gỡ -> bot gắn lại -> lặp vô hạn (17:40/47/50/51/52/56).
GỐC: cổng HẬU MÃI (~3995) chạy `postSaleContext(last5)` rồi tagChoXuLyVaUnread MỖI VÒNG, KHÔNG kiểm tra
  có tin khách MỚI hay không. Đơn lên qua người thật nên mem.orderClosed=false -> không bị chặn.
  Detector bắt từ khoá giao-hàng (kể cả trong tin của chính SHOP) -> gắn thẻ dù khách im.
FIX: cổng HẬU MÃI chỉ gắn thẻ khi:
  - getLastCustomerMessages có tin (lượt khách thực sự có), VÀ
  - !shopRepliedAfterLastCustomer (khách nhắn CUỐI - shop/NV CHƯA trả lời sau tin khách).
  -> shop/NV/bot nhắn cuối (khách im) -> KHÔNG gắn thẻ nữa. Khách thực sự nhắn hậu mãi ("giao lại giúp")
     -> vẫn gắn người thật như cũ (giữ FIX W).

==================================================================
## FIX AD — Khách khai chiều cao/cân nặng nhưng bot KHÔNG tư vấn size (Huế Lê / Hà Thu)
==================================================================
HIỆN TƯỢNG:
  - Huế Lê: bot hỏi "chiều cao cân nặng của mình là bao nhiêu", khách trả "Mình cao 1m50 nặng 54kg"
    -> bot BÁO GIÁ LẠI "Dạ Váy Giannal 890.000đ, chị thường mặc size bao nhiêu" (bỏ qua cao/nặng).
  - Hà Thu: khách "Có mất phí ship k ạ. Mình 1m58 nặng 53kg" -> không tự ra size.
GỐC 1 (cổng ADS, ~4262): bot bị RESTART (log nhiều ^C + chạy lại) -> mem mất sạch -> pricedCodes/currentProduct rỗng
  -> _adHadModel=false, _adFirstAd=true -> cổng ADS tưởng "khách bấm ad mới" -> BÁO GIÁ LẠI, nuốt câu cao/nặng.
  Handler tính size (~7505) nằm SAU cổng ADS nên không bao giờ chạy. (parseWeightKg đọc đúng 54/53, KHÔNG phải lỗi đọc.)
  FIX 1: thêm cờ _adGivesBody = (parseWeightKg || parse3V) && !mua-hộ. Khách khai cân nặng/số đo = đang TRẢ LỜI
    câu hỏi size (chắc chắn mẫu đã bàn từ trước) -> cổng ADS KHÔNG báo giá lại (_adDontOpen) + KHÔI PHỤC mẫu
    (từ adId->mã, dù pricedCodes rỗng) -> nhường handler tính size. (Giống guard _givesBodyInfo đã có ở đường Hỏi-giá.)
GỐC 2 (handler phí ship, ~7348): tin TRỘN "phí ship + cân nặng" -> handler ship trả lời ship rồi return
  -> handler tính size phía dưới KHÔNG chạy -> bỏ sót size.
  FIX 2: handler ship GỘP thêm câu size khi tin kèm cân nặng -> trả CẢ ship + size trong 1 câu
    ("Bên em miễn ship... Dạ với 53kg chị mặc size M là vừa form rồi ạ.").
KẾT QUẢ: khách cho cao/nặng (kể cả sau restart, kể cả kèm hỏi ship) -> bot tự ra size, KHÔNG báo giá lại / hỏi lại size.

==================================================================
## FIX AE — "Vâng" (đồng ý) bị nhận thành màu "vàng" + xác minh màu theo sheet (Nguyễn Thị Hà Thu)
==================================================================
HIỆN TƯỢNG: khách "Vâng vậy mình lấy size M" -> chốt đơn ghi "Váy Giannal - VÀNG - size M" (Giannal chỉ có hồng).
GỐC: color_utils.extractColor fold bỏ dấu -> "vâng"->"vang", "vàng"->"vang" -> trùng biến thể màu "vang"=Vàng.
FIX AE-1 (color_utils.js): thêm guard giống do/den/cam -> chỉ nhận màu Vàng khi câu GỐC có chữ "vàng" (dấu à).
  -> "vâng/vắng/vầng" không còn bị nhận là màu vàng. ("màu vàng"/"vàng bơ"/"yellow" vẫn nhận đúng.)
FIX AE-2 (chosenColorForCode ~1640, bot_worker): XÁC MINH THEO SHEET. Màu chốt PHẢI nằm trong danh sách màu
  thật của mẫu (modelColorList). Nếu mẫu có liệt kê màu mà màu chốt KHÔNG khớp -> nhận định SAI -> BỎ, để
  trống -> bot hỏi lại màu, KHÔNG ghi màu sai vào đơn. (Lớp chặn phòng khi đọc nhầm màu từ nguồn khác.)
  *** Nhớ thay luôn color_utils.js ***

==================================================================
## FIX AF — Khách từ AD thắc mắc "chưa thấy gửi set váy" -> báo giá XONG rồi gắn người thật (Hằng Nguyễn)
==================================================================
HIỆN TƯỢNG: khách bấm ad Giannal rồi nhắn "Chưa thấy gửi set váy cho chị?" -> bot CHỈ báo giá, không gắn người thật.
GỐC: adCustTextBlocksQuote chỉ bắt "chưa (thấy|nhận) HÀNG/ĐƠN" (đòi giao đơn đã mua). "chưa thấy gửi set váy"
  (đòi/thắc mắc CHƯA NHẬN sản phẩm shop hứa gửi) không khớp -> bot báo giá xong là thôi.
FIX: thêm detector asksWhyNotSentYet ("chưa thấy gửi/sao chưa gửi/gửi ... chưa/chưa thấy set|váy|ảnh|đầm").
  Hook trong cổng ADS: sau khi báo giá + gửi ảnh -> nếu khớp -> tagChoXuLyVaUnread (báo giá XONG rồi gắn người thật).

==================================================================
## FIX AG — Crash "productInfo before initialization" làm RỚT khách gửi 2+ ảnh (Minh Chuyên)
==================================================================
HIỆN TƯỢNG: khách gửi 2 ảnh, nhận ra 1 mẫu (MMAD511/Aleena) + 1 ảnh trượt -> log lặp mỗi vòng:
  "Lỗi processOneConversation: Cannot access 'productInfo' before initialization" -> RỚT HẲN hội thoại đó.
GỐC: handler "2+ ảnh, nhận ra 1 mẫu" (dòng ~4933) mở đầu bằng `const _pi = productInfo || thisTurn[0];`
  nhưng `productInfo` mãi dòng ~5013 mới khai báo (let) -> đọc trong "vùng chết tạm thời" (TDZ) -> ném lỗi.
FIX: đổi thành `const _pi = thisTurn[0];` (mẫu vừa nhận ra). Tại điểm này productInfo luôn null nên nghĩa giữ nguyên.
KẾT QUẢ: đúng quy tắc shop -> 2+ ảnh nhận ra mẫu nào thì BÁO GIÁ mẫu đó + gửi ảnh, rồi gắn AI-CHỜ XL cho mã
  trượt để người thật gửi nốt. Không còn rớt hội thoại.

==================================================================
## FIX AH — Cổng ADS NHỚ "đã báo giá rồi" qua LỊCH SỬ + nhận số đo có nhãn (Mộc Nhiên)
==================================================================
HIỆN TƯỢNG: khách bấm ad Giannal -> bot báo giá. Khách nhắn "C v1 85 eo 68" (vòng 1=85, eo=68 = số đo)
  -> bot BÁO GIÁ LẠI y hệt thay vì tư vấn size. (Lặp lại sau mỗi restart vì mem mất sạch.)
GỐC 1 (báo lại): cổng ADS biết "đã có mẫu" qua _adHadModel = mem.currentProduct || mem.pricedCodes -> ĐỀU nằm
  trong mem -> RESTART mất -> tưởng "khách mới" -> báo giá lại. Các detector _adGivesBody (parseWeightKg/parse3V)
  cũng không bắt được "v1 85 eo 68" (chỉ 2 số có nhãn, parse3V cần đủ 3 số liền).
GỐC 2 (không tư vấn được size): không có hàm đọc số đo lẻ có nhãn (ngực/eo/mông).
FIX:
 1) botQuotedPriceInHistory(messages): đọc TỪ tin nhắn (sender="shop") xem shop/bot ĐÃ báo giá chưa -> SỐNG QUA
    RESTART. Đưa vào _adHadModel -> cổng ADS NHỚ "đã báo rồi" -> mọi câu hỏi tiếp (size/số đo/chất/màu) KHÔNG
    bị báo giá lại nữa, kể cả sau restart. (Đây là cái shop yêu cầu: "cổng ADS phải biết mẫu đã báo rồi".)
 2) parseBodyMeasures("v1 85 eo 68"/"ngực 85 eo 68 mông 92") -> {nguc,eo,mong} (thiếu vòng nào = null).
    Đưa vào _adGivesBody -> cổng ADS nhường handler + khôi phục khoá mẫu từ adId.
 3) resolveSizeByMeasures + handler mới: số đo có nhãn -> vote size (vd ngực 85 + eo 68 -> size M) -> tư vấn
    "mình lấy size M nha chị?" thay vì báo giá lại.

==================================================================
## FIX AI — Sau RESTART, cổng ADS báo giá LẠC đè đơn/đổi-trả đang dở (Linh Khánh + Nguyễn Mỹ Hạnh)
==================================================================
HIỆN TƯỢNG:
 - Ca 1 (Linh Khánh): đang dở đơn váy Grace (đã cho size S, bot xin địa chỉ) -> khách "Chất gì vậy ạ" -> bot trả
   "Áo Maelis ... Len Merino" (SAI mẫu, lôi mẫu áo khác).
 - Ca 2 (Nguyễn Mỹ Hạnh): khách nói cả tràng ĐỔI SIZE / thu hàng về / có con nhỏ không đi gửi được (hậu mãi)
   -> bot "Set Corine giá 950.000đ" (báo giá đè).
GỐC CHUNG (đọc log): cả 2 đều `[ADS GATE] ... lock= cap=""` -> mem TRỐNG sau RESTART. Hội thoại có ad_ids CŨ
 (Maelis/Corine) -> cổng ADS tưởng "bấm ad mới" -> báo giá mẫu ad cũ, ĐÈ lên context đang chạy. Ca 1: cú báo giá
 Maelis lạc làm reader đọc tên mẫu từ tin shop = Maelis -> "chất gì" trả Maelis.
FIX AI-1 (cổng ADS NHỚ QUA LỊCH SỬ): `_adFirstAd` và nhánh "tin trống" của `_adWantsQuote` nay đọc thêm
 botQuotedPriceInHistory(messages). Hội thoại ĐÃ có câu báo giá (kể cả format "Thiết kế GRACE : 850.000 đ")
 -> KHÔNG còn là "ad lần đầu" -> tin trống/không-phải-hỏi-giá KHÔNG báo giá lại. Hết quote lạc sau restart.
 -> Ca 1: không quote Maelis -> "chất gì" bám lại mẫu đang xem (Grace). Ca 2: không quote Corine.
FIX AI-2 (nhận diện hậu mãi-đổi-size, bền VIẾT TẮT): thêm talksPostSaleExchange (đổi sz/size + logistics:
 thu/nhận/gửi lại, "con nhỏ", "không đi gửi được", "ship sz mới") cắm vào postSaleContext, guard !isPolicyQuestion
 (câu HỎI chính sách trước mua vẫn được bot trả lời). -> Ca 2 vào gate hậu mãi -> gắn người thật, KHÔNG báo giá.

==================================================================
## FIX AJ — Khách thả 👍 mà bot tự đẩy size/đẩy đơn (Ngoan Nguyễn Thị) — do AI_REPLY_MODE=on
==================================================================
HIỆN TƯỢNG: khách "Để chị xem" rồi thả 👍 (nhãn THANKS) -> bot "Chị thường mặc size bao nhiêu..." (đẩy size).
GỐC (đọc log): `[AI-REPLY on] bộ soi PASS -> để AI tư vấn` -> AI_REPLY_MODE đang BẬT -> đường AI TỰ VIẾT câu trả
  lời (free-text) hoạt động. Bộ soi (reply_guard) thấy câu "sạch" (không đụng tiền/sđt) nên cho AI tự nói ->
  AI đẩy size dù khách chỉ thả 👍. Vi phạm nguyên tắc "AI chỉ phân nhánh, CODE trả lời".
FIX (chặn cứng): thêm điều kiện vào cổng AI-REPLY (mục a4) -> KHÔNG cho AI tự nói khi tin khách là
  isBareAck / isAffirmation / isFriendlyRemark / isPostOrderChitChat / nhãn THANKS / nhãn GREETING.
  -> 👍/ừ/ok/cảm ơn/chào/tán gẫu: AI KHÔNG đẩy size/đẩy đơn (rơi về luật cũ = nhường người thật), giống off-mode.
KHUYẾN NGHỊ MẠNH: đặt AI_REPLY_MODE=off trong .env. Đường AI free-text vốn nên TẮT (AI chỉ phân nhánh, code trả
  lời). FIX AJ chỉ là chặn phòng khi ai đó bật on; muốn an toàn tuyệt đối thì off.

==================================================================
## FIX AK — Khách hỏi size/form mà bot DUMP cả loạt ảnh đủ màu (Hà Thu)
==================================================================
HIỆN TƯỢNG: khách "Fom váy bên mình ntn thì lấy size cho m" (hỏi form/size) -> bot trả size XONG còn gửi 10 ảnh
  đủ 6 màu (2 ảnh/màu). Khách KHÔNG xin ảnh.
GỐC (đọc log): cuối luồng reasoning có `if (thisTurn.length === 1) maybeSendImages(..., imageCount > 0)`.
  `thisTurn` chứa cả mẫu DÒ RA TỪ CHỮ (reader đọc tên Giannal từ caption), khách không gửi ảnh (imageCount=0).
  force=false -> dựa "maybeSendImages tự bỏ qua nếu ĐÃ gửi ảnh". Nhưng sau RESTART mem mất -> không nhớ đã gửi
  -> gửi lại CẢ LOẠT ảnh đủ màu vô nghĩa.
FIX: nhánh này CHỈ gửi ảnh khi khách THẬT SỰ gửi ảnh lượt này (imageCount > 0). Mẫu dò từ CHỮ + hỏi size/form/
  chất -> KHÔNG gửi ảnh. (Khách XIN xem ảnh -> nhánh askImages vẫn gửi như cũ; báo giá -> §13 vẫn kèm 3 ảnh.)
LƯU Ý: ca này AI_REPLY_MODE cũng đang on (AI tự trả size). Vẫn khuyến nghị AI_REPLY_MODE=off.

==================================================================
## FIX AL — LOẠN GỬI ẢNH: cứ mỗi lượt hỏi (form/size/màu) lại dump cả loạt ảnh (Hà Thu)
==================================================================
HIỆN TƯỢNG: báo giá + gửi ảnh lần đầu = ĐÚNG. Nhưng sau đó khách hỏi gì (form/size/"có 3 màu"...) bot CỨ gửi lại
  ảnh -> loạn, "động tẹo là gửi". Không ai xin ảnh cũng tự gửi.
GỐC: maybeSendImages chống trùng bằng mem.sentImageCodes, NHƯNG (1) sau RESTART mem mất sạch -> quên đã gửi ->
  gửi lại; (2) RẤT nhiều chỗ gọi force=true -> bỏ qua luôn chống-trùng. (FIX AK chỉ vá 1 nhánh form/size.)
FIX (chốt chặn 1 chỗ, đọc LỊCH SỬ -> sống sót restart):
  - Thêm botSentImagesInHistory(messages): bot/shop đã gửi >=1 ẢNH trong hội thoại chưa (m.sender=shop & type=image).
  - Mỗi lượt: mem._imgShownBefore = đã-gửi-ảnh-trong-lịch-sử; mem._imgAllowSend = (khách VỪA gửi ảnh) || (khách XIN xem ảnh).
  - Đầu maybeSendImages: nếu _imgShownBefore && !_imgAllowSend -> KHÔNG gửi (chặn TRƯỚC mọi force). Khách hỏi
    size/form/màu/chất chỉ nhận CHỮ, không dump ảnh.
  - §13 báo giá: set _imgAllowSend=true -> báo giá (kể cả mẫu MỚI sau khi đã gửi ảnh mẫu khác) vẫn kèm ảnh.
KẾT QUẢ: ảnh gửi 1 lần (lúc báo giá / khách xin xem / khách gửi ảnh). Hỏi qua hỏi lại KHÔNG còn dump ảnh.
  (Ảnh size-guide & ảnh chọn-từng-màu qua sendImages3 trực tiếp KHÔNG bị chặn -> vẫn gửi khi khách chủ động.)

==================================================================
## FIX AM — (1) Còn thẻ AI-CHỜ XL vẫn gửi follow-up  (2) "hôm trước lên đơn rồi mà" không nhường người (Thien Ngoc Nguyen)
==================================================================
VẤN ĐỀ 1 — gắn AI-CHỜ XL rồi BOT VẪN bắn follow-up cho khách:
  GỐC: sweepFollowups chỉ bỏ follow-up khi mem.aiStandsOut=true. aiStandsOut CHỈ set ở ĐẦU LƯỢT khi hội thoại
    ĐÃ có sẵn thẻ giữ. Khi bot TỰ gắn AI-CHỜ XL GIỮA LƯỢT (tagChoXuLyVaUnread) thì chỉ set botHandoffAt, KHÔNG
    set aiStandsOut -> follow-up đang chờ vẫn bắn.
  FIX: (a) sweepFollowups bỏ follow-up khi (aiStandsOut HOẶC botHandoffAt) — mọi chỗ gắn thẻ đều set botHandoffAt.
       (b) scheduleFollowup: KHÔNG hẹn follow-up nếu lượt này đã nhường người (botHandoffAt).
  -> Hội thoại còn thẻ giữ / vừa nhường người = AI TUYỆT ĐỐI không nhắn gì (kể cả follow-up).

VẤN ĐỀ 2 — khách "Sao hôm trc thì ok lên đơn rồi mà" (đã có đơn 108239) mà bot báo giá lại + đòi lại sđt/size:
  GỐC: restart mất mem (orderClosed/size/sđt) -> bot quên đã có đơn -> coi như khách mới -> báo giá + xin info lại.
    Câu thắc mắc đơn-đã-có không có detector -> AI tự xử (AI_REPLY on).
  FIX: thêm saysOrderAlreadyPlaced(text) — bắt "hôm trước/bữa trước ... ok/lên đơn", "lên đơn/chốt ... rồi mà"
    (KHÔNG bắt nhầm ý ĐỊNH lên đơn mới "em muốn lên đơn"). Cắm vào CỔNG HẬU MÃI đầu lượt -> gắn NGƯỜI THẬT,
    KHÔNG báo giá/đòi info. (Vẫn giữ guard: chỉ gắn khi khách thực sự vừa nhắn, shop/NV chưa trả lời.)
  LƯU Ý GỐC SÂU: bot KHÔNG đọc đơn đã tồn trên Pancake; trạng thái đơn chỉ ở mem -> restart là mất. Muốn diệt
    tận gốc nhóm lỗi "quên đơn sau restart" nên persist mem ra file (đã đề xuất, chưa làm).
