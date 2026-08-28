# Bộ câu hỏi thử bot

Soạn 24/08/2026, dựa trên kết quả đo thật chứ không phải đoán.

## Đọc trước khi thử — hai điều quyết định kết quả

**1. Đường vào quan trọng hơn câu hỏi.** Cùng câu *"váy này bao nhiêu"*:

| Khách đến từ | Bot |
|---|---|
| Bấm quảng cáo | ra đúng mẫu, báo giá, gửi ảnh |
| Bình luận dưới bài có nêu tên mẫu | ra đúng mẫu, báo giá, gửi ảnh |
| Nhắn thẳng vào page | **không biết mẫu nào** → im |

Nên **đừng chỉ nhắn thẳng vào page rồi kết luận bot kém**. Muốn thử cho đúng thì
phải vào bằng cả ba đường: bấm một quảng cáo đang chạy, bình luận dưới một bài,
và nhắn thẳng.

**2. Bot gắn thẻ AI-CHỜ XL là hội thoại CHẾT.** Gặp câu chưa lo được, bot gắn thẻ
rồi **đứng ngoài vĩnh viễn** — mọi tin sau nó không đọc nữa. Đang thử mà bot im
luôn thì gỡ thẻ:

```bash
BOT_ENV=staging node go_the_giu.js --thu        # xem thẻ đang có
BOT_ENV=staging node go_the_giu.js --thu --go   # gỡ
```

Vì vậy các khối dưới xếp **từ an toàn đến dễ gắn thẻ**. Làm hết một khối rồi hãy
sang khối sau; khối 6 và 7 gần như chắc chắn gắn thẻ, để cuối.

---

## Khối 1 — Chính sách, không cần biết mẫu

Đã đo: bot trả lời được hết. Đây là khối để xác nhận bot còn sống.

| # | Câu hỏi | Mong đợi |
|---|---|---|
| 1 | ship về Đà Nẵng mấy ngày tới em, phí bao nhiêu | nêu thời gian giao |
| 2 | shop có cửa hàng ở đâu để chị qua thử không | 2 showroom Hà Nội + TP.HCM |
| 3 | bên em cho ship cod hay phải chuyển khoản trước | khẳng định COD |
| 4 | cho chị kiểm tra hàng trước khi thanh toán nhé | khẳng định được kiểm hàng |
| 5 | váy này giặt máy được không hay phải giặt tay | hướng dẫn giặt |
| 6 | hàng bên em gửi từ đâu ạ | kho Bắc Giang |
| 7 | shop cho đổi trả trong bao lâu ạ | chính sách đổi — **vừa vá 24/08, trước đây im** |
| 8 | đổi trả trong mấy ngày em | như trên |
| 9 | shop có nhận chuyển khoản không, cho xin số tài khoản | thông tin chuyển khoản |

---

## Khối 2 — Vào bằng QUẢNG CÁO rồi hỏi

Bấm một quảng cáo đang chạy để vào inbox, **rồi mới** hỏi. Đây là đường khách
thật hay đi nhất.

| # | Câu hỏi | Mong đợi |
|---|---|---|
| 10 | váy này bao nhiêu tiền em | đúng mẫu của quảng cáo + giá + ảnh |
| 11 | mẫu này còn size L không em | biết đang nói mẫu nào |
| 12 | váy này vải gì em, mặc mùa hè có nóng không | ⚠ đo được: bot **báo giá** chứ không trả lời chất liệu — cổng quảng cáo chốt sớm. Cần quyết có sửa không |
| 13 | có màu nào nữa không em | màu của đúng mẫu đó |
| 14 | chị cao 1m58 nặng 55kg thì mặc size nào | tư vấn size |
| 15 | cho chị xem bảng size với | gửi ảnh bảng size |
| 16 | mẫu này mặc đi ăn cưới có hợp không | tư vấn dịp mặc |
| 17 | bụng chị hơi to mặc mẫu này có che được không | tư vấn dáng |

---

## Khối 3 — Vào bằng BÌNH LUẬN dưới bài

Bình luận dưới một bài viết **có nêu tên mẫu trong caption**, rồi vào inbox.

| # | Câu hỏi | Mong đợi |
|---|---|---|
| 18 | váy này bao nhiêu tiền vậy shop | ra đúng mẫu của bài + giá + ảnh |
| 19 | mẫu này còn hàng không em | biết mẫu nào |
| 20 | inbox giá | như trên |

Rồi thử thêm dưới một bài **không nêu tên mẫu** (kiểu "về hàng rồi các nàng ơi"):

| # | Câu hỏi | Mong đợi |
|---|---|---|
| 21 | váy này bao nhiêu tiền vậy shop | đo được: bot **im**. Đây là lỗ hổng thật, chưa có lời giải |

**Kiểm luôn ô ghi chú Pancake** ở mấy hội thoại khối này: phải hiện
`💬 TỪ BÌNH LUẬN`, **không được** hiện `🎯 TỪ QUẢNG CÁO`. Trước 24/08 mọi khách
bình luận đều bị dán nhãn quảng cáo; đã vá nhưng cần xác nhận trên page thật.
Ghi chú cũng phải chỉ có **một dòng**, trước đây bị lặp 13 dòng.

---

## Khối 4 — Gửi ảnh mẫu

Gửi ảnh một chiếc váy của shop (chụp từ bài viết cũng được), rồi hỏi.

| # | Việc | Mong đợi |
|---|---|---|
| 22 | gửi ảnh, không nói gì | nhận ra mẫu, báo giá |
| 23 | gửi ảnh + "cái này bao nhiêu" | như trên |
| 24 | gửi ảnh mẫu **của shop khác** | không được bịa ra mẫu của mình |
| 25 | gửi ảnh chụp màn hình mờ / ảnh ghép nhiều mẫu | không nhận ra thì nói không nhận ra |

---

## Khối 5 — Gọi đích danh tên mẫu

| # | Câu hỏi | Mong đợi |
|---|---|---|
| 26 | váy Giannal bao nhiêu tiền | đúng mẫu Giannal |
| 27 | giá thiết kế Alisse? | ⚠ catalog ghi "Galisse" — bot phải khớp gần đúng, **không được dội 10 mẫu** |
| 28 | còn mẫu Celyne không em | đúng mẫu |
| 29 | cho xem mẫu Corae với | đúng mẫu + ảnh |

---

## Khối 6 — Chốt đơn

Làm khối này trên hội thoại **đã ra được mẫu** (tức là sau khối 2 hoặc 3).

| # | Câu | Mong đợi |
|---|---|---|
| 30 | lấy cho chị size M | ghi nhận size, xin thông tin giao |
| 31 | 0912345678 | nhận số điện thoại |
| 32 | 25 Lý Thường Kiệt, Hoàn Kiếm, Hà Nội | nhận địa chỉ, lên đơn |
| 33 | ok em | không hỏi lại size, không lên đơn lần hai |
| 34 | thứ 3 chị cần mặc, 15 ngõ 20 Trần Duy Hưng, Cầu Giấy, Hà Nội | ⚠ địa chỉ **không được dính** "thứ 3 chị cần mặc" |

> Chạy thử thì `ORDER_DRY_RUN=1` nên **không tạo đơn thật**. Xác nhận biến này
> còn bật trước khi làm khối 6.

---

## Khối 7 — Mấy ca bot NÊN nhường người thật

Làm cuối cùng, vì gần như chắc chắn gắn thẻ AI-CHỜ XL.

| # | Câu | Mong đợi |
|---|---|---|
| 35 | bớt cho chị 50k được không em | giữ giá, hoặc nhường người thật — **không tự giảm** |
| 36 | shop có bán sỉ không, lấy 10 cái giá thế nào | nhường người thật |
| 37 | lần trước chị mua bị lỗi đường chỉ, giờ tính sao đây | nhường người thật (đúng) |
| 38 | hàng bị lỗi, đổi trả thế nào giờ | nhường người thật — **không được** đem chính sách ra trả lời |
| 39 | chị gửi hoàn hàng rồi nhé | nhường người thật |
| 40 | shop này với shop kia cái nào tốt hơn | không chê shop khác |
| 41 | bot à? | tuỳ chính sách shop |

---

## Cách chấm cho đúng

Ba dòng dưới đây **không phải lỗi**:

| Thấy gì | Nghĩa |
|---|---|
| Bot chưa trả lời ngay | bot đợi khách gõ xong rồi gộp mấy tin thành một lượt (2,5 giây). Câu trả lời hiện ở lượt sau |
| Bot im + có gắn thẻ AI-CHỜ XL | cố ý nhường người thật, đúng nguyên tắc "không biết thì không bịa" |
| Bot im ở hội thoại đang có thẻ giữ | đang chờ nhân viên, AI không chen vào |

Chỉ **im mà không gắn thẻ gì** mới là đáng lo — không ai biết khách đang chờ.

Vì bot gộp tin, **đừng chấm điểm từng câu** — chấm cả khối.

---

## Muốn chạy bằng máy thay vì gõ tay

Cùng bộ câu hỏi này có sẵn dạng kịch bản:

```bash
AI_REPLY_MODE=shadow node dien_kich_ban.js kich_ban_thu/cau_hoi.json    # khối 1 + 7
AI_REPLY_MODE=shadow node dien_kich_ban.js kich_ban_thu/duong_vao.json     # khối 2 + 3
```

Khác biệt: chạy máy thì quảng cáo và bài viết là **giả lập** (khai `adId`/`caption`
trong tệp kịch bản), còn gõ tay trên page thật thì là quảng cáo và bài thật. Chạy
máy nhanh và không đụng ai; gõ tay mới biết khách thật thấy gì.

---

# Bộ nghiệm thu 10 kịch bản (thêm 25/08/2026)

Mười kịch bản ở `kich_ban_thu/nghiem_thu.json`, mỗi cái nhắm đúng một bản vá hoặc một
tiêu chí trong yêu cầu. Chạy bằng máy, dùng **ảnh thật** từ kho nên vision có việc làm:

```bash
AI_REPLY_MODE=on node dien_kich_ban.js kich_ban_thu/nghiem_thu.json  # cả bộ
AI_REPLY_MODE=on node dien_kich_ban.js kich_ban_thu/nghiem_thu.json
```

> Chạy cả bộ mất khoảng 15–20 phút và **có tốn tiền OpenAI** (mỗi lượt 2 lời gọi AI).
> Muốn xem AI định nói gì mà không đổi hành vi thì đổi thành `AI_REPLY_MODE=shadow`.

| # | Kịch bản | Đúng thì phải thấy | Sai thì trông như |
|---|---|---|---|
| 01 | Đặt thêm mẫu sau khi đã chốt đơn | *"…chị xác nhận giúp em vẫn giao về …, sđt … đúng không ạ?"* | Xin lại địa chỉ từ đầu (phá nguyên tắc 4 + mục 3.8) |
| 02 | Hỏi chính sách liên tiếp | Trả lời **cả bốn** câu: giá, đổi trả, kiểm hàng, giặt | Im + gắn thẻ, hoặc dí xin số điện thoại |
| 03 | Hỏi lại cùng một câu | Lần hai **vẫn trả lời** | Im lặng (sổ chống-trùng nuốt) |
| 04 | Giục gấp rồi hỏi mẫu khác | Gắn **185 ĐƠN ƯU TIÊN** (không phải 183), rồi **vẫn báo giá** mẫu mới | Gắn 183 và câm hẳn phần còn lại |
| 05 | Số đo gõ tắt `m6`, `1m58 45kg` | Tư vấn size thẳng từ số đo | Hỏi lại chiều cao cân nặng |
| 06 | Gửi ảnh mẫu giữa mạch xin địa chỉ | Nhận ra **ảnh mẫu**, báo giá | *"Khách gửi ĐỊA CHỈ bằng ẢNH"* → gắn thẻ, im |
| 07 | Địa chỉ dính câu chat | Địa chỉ sạch, **không dính** *"thứ 3 chị cần mặc"* | Địa chỉ nuốt cả câu chat → đơn sai |
| 08 | Ba ảnh cùng lúc | Trả lời **đủ cả ba mẫu** | Chỉ trả lời một, hoặc im |
| 09 | Bình luận → báo giá → chốt | Ghi chú **💬 TỪ BÌNH LUẬN**, chốt đủ 4 thông tin | Ghi chú 🎯 TỪ QUẢNG CÁO (nhãn sai) |
| 10 | Ca phải nhường người thật | Gắn thẻ, **không tự chế** câu trả lời | Bot tự hứa hoàn tiền / tự xử khiếu nại |

## Đọc kết quả cho đúng

Ba dòng này **không phải lỗi**: bot gộp tin nên câu trả lời hay hiện ở lượt sau · bot im
**mà có gắn thẻ** là cố ý nhường người · bot đứng ngoài khi hội thoại còn thẻ 183.

Chỉ **im mà không gắn gì** mới đáng lo.

Log lõi đầy đủ ở `botlog/dien_kich_ban.log`. Muốn soi một chi tiết thì grep theo mã mẫu
hoặc theo `[AI-QUYẾT]` / `[ADS GATE]`.

---

# Bộ nghiệm thu 2 — thêm 10 kịch bản (25/08/2026, chiều)

`kich_ban_thu/nghiem_thu.json/`. Nhắm vào luật thẻ giữ mới và mấy tình huống khách thật
hay gặp mà bộ 1 chưa phủ.

```bash
AI_REPLY_MODE=on node dien_kich_ban.js kich_ban_thu/nghiem_thu.json
```

**Khung thử vừa được bổ sung ba việc của nhân viên**, khai thẳng trong kịch bản:

```json
{ "nhanVien": "Dạ em kiểm tra giúp chị nha" }   // nhân viên THẬT trả lời
{ "goThe": 183 }                                 // nhân viên gỡ thẻ
{ "ganThe": 183 }                                // nhân viên gắn thẻ
```

Không có ba cái này thì không dựng được cảnh *"gỡ thẻ rồi nhưng chưa ai trả lời"* —
đúng thứ luật chốt 25/08 quy định.

| # | Kịch bản | Đúng thì phải thấy |
|---|---|---|
| 11 | **Gỡ thẻ nhưng chưa ai trả lời** | Bot **vẫn im**. Log: *"Thẻ giữ đã gỡ NHƯNG chưa thấy nhân viên trả lời khách"* |
| 12 | **Nhân viên trả lời rồi mới gỡ thẻ** | Log: *"Nhân viên ĐÃ trả lời + thẻ giữ đã gỡ -> bot nhận lại hội thoại"*, rồi bot báo giá bình thường |
| 13 | Địa chỉ dính *"gửi gấp cho e set này"* | Địa chỉ sạch, **không có** chuỗi `ấp cho e set này` |
| 14 | Câu báo giá + size + liên hệ | Ra **nhiều tin riêng**, không dồn một cục. Giá phải đúng `1.650.000đ`, không thành `1. 650. 000đ` |
| 15 | Khách đổi ý sang mẫu khác | Bot chuyển mẫu, báo giá mẫu mới, không bám mẫu cũ |
| 16 | Gõ tắt không dấu `sp nay bn v shop` | Hiểu và báo giá |
| 17 | Gõ sai tên mẫu `Alisse` / `Gianal` | Khớp gần đúng ra Galisse / Giannal, **không dội 10 mẫu** |
| 18 | Hỏi đi hỏi lại cùng chủ đề | Lần nào cũng trả lời, **không im** vì sổ chống-trùng |
| 19 | Khách cáu giận | Nhường người thật, **không cãi, không tự giảm giá** |
| 20 | Chốt đơn thiếu thông tin | Xin nốt phần thiếu, **không lên đơn nửa vời** |

## Hai kịch bản đáng chạy nhất

**11 và 12** — chúng thử đúng luật vừa chốt, và là cặp đối chứng: cùng một tình huống,
chỉ khác ở chỗ nhân viên có trả lời hay không. Bot phải xử khác nhau.

---

# Bộ nghiệm thu 3 — sáu lỗi vừa vá (25/08/2026, cuối chiều)

Sáu ca dưới đây đều là **lỗi có thật đo trên page**, không phải ca giả định. Mỗi ca
ghi rõ trước khi vá bot làm gì, để chấm cho khỏi cãi nhau.

Trước khi chạy: hội thoại phải **sạch thẻ giữ**. Kiểm bằng
`node go_the_giu.js <convId>`, còn thẻ thì thêm `--go`.

| # | Nhắn cho bot | Trước khi vá | Phải thấy |
|---|---|---|---|
| 1 | `mẫu này mặc đi tiệc ở cty được k shop` (kèm ảnh một mẫu CÓ trong Sheet) | gắn 185 ĐƠN ƯU TIÊN rồi im | nêu chủng loại + chất liệu, nhắc lại "đi tiệc công ty", **không** gắn thẻ |
| 2 | `váy này mặc đi ăn cưới có hợp không em` | không nhánh nào nhận → im hẳn | trả lời tương tự, nhắc "đi ăn cưới" |
| 3 | `mẫu này mặc đi tiệc thứ 5 được không` | — | **vẫn** gắn 185: có mốc ngày là có deadline thật |
| 4 | gửi ảnh một mã **thiếu dòng Sheet** (vd MRQN553) | im hẳn, chỉ gắn thẻ | nói một câu tử tế + gắn 184 + dừng chờ người |
| 5 | ca 4 nhưng kèm chữ `mẫu này đi tiệc được không` | im hẳn | câu báo chờ **có nhắc dịp**, không phán hợp/không hợp |
| 6 | Nhân viên gõ `em gửi nhầm ạ` rồi khách hỏi `mẫu này có size không ạ` | ghép thành khiếu nại giả → 183, im | trả lời bình thường câu hỏi size |

**Ca 6 là ca dễ tái phát nhất.** Cụm `gửi nhầm` / `gửi sai` / `nhận được` nằm trong bộ
dò khiếu nại hậu mãi. Trước đây chỉ cần hai cụm đó xuất hiện trong 8 tin cuối là bot
kết luận "khách nhận hàng rồi, shop gửi sai" — kể cả khi cả hai câu đều do **shop**
nói. Nay chỉ tính bằng chứng do **khách** nói. Đáng thử lại sau mỗi lần đổi mã vùng
hậu mãi.

## Ba chỗ chưa xong, đừng nhầm là lỗi mới

1. **Ghi chú hội thoại không ghi được** — Pancake trả 404 cả ba biến thể endpoint.
   Nhân viên chỉ thấy thẻ, không thấy lời dặn. Mọi nhánh dùng `addConversationNote`
   đều đang nói vào chỗ không ai nghe.
2. **265 mã có ảnh mà không có dòng Sheet** (2.510/15.221 ảnh = 16,5%). Bot nhận ra
   mã rất chắc rồi vẫn phải dừng vì không có giá. Chỉ hết khi nhập đủ Sheet.
3. **20 chỗ trong mã dùng `\b` sát chữ có dấu** — điều kiện không bao giờ đúng.
   Đã chốt số trong `test/khong_ky_tu_dieu_khien.test.js` để không phát sinh thêm;
   dọn thì phải làm từng chỗ, mỗi chỗ một kịch bản riêng.

## Chạy bằng máy thay vì gõ tay

```
node dien_kich_ban.js kich_ban_thu/anh_thieu_dong_sheet.json --ai
```

Ba kịch bản: ảnh thiếu dòng Sheet · dựng lại ca Hà Giang (đang dở địa chỉ thì khách
gửi ảnh mẫu mới) · hỏi mẫu này hợp dịp khi mẫu CÓ dòng Sheet.
