# Bot hoạt động thế nào — khi nào code, khi nào AI

Ghi ngày 25/08/2026, dựng từ mã nguồn tại chỗ (`bot_worker_api_v3.js`, `ai_intent.js`,
`ai_quyet.js`, `reasoning_engine.js`, `kho_kich_ban.js`, `order_worker.js`, `.env`,
`ai_quyet_config.json`).

Đọc file này để hiểu **hành vi thật của mã**. `QUY_TRINH_HYBRID.md` mô tả **ý định kiến
trúc** — hai thứ đã lệch nhau, xem mục 8.

---

## 1. Luật gốc

> **AI chỉ HIỂU, code mới NÓI.**

AI đọc tin khách rồi trả về *nhãn* và *quyết định* trong một danh sách đóng. Nó không được
viết giá, không được viết số điện thoại, không được tuyên bố còn/hết hàng, không được tự tạo
đơn. Mọi câu chạm tới tiền đều do code lấy từ catalog + kịch bản rồi ghép ra.

Chỗ nào AI không chắc, chỗ nào code chưa được dạy — bot **im** và gắn thẻ cho nhân viên.
Thà im còn hơn nói bậy mất khách.

Ba ký hiệu dùng xuyên suốt tài liệu này:

| Ký hiệu | Nghĩa |
|---|---|
| **CODE** | luật cứng, catalog, template — nơi duy nhất được nói ra con số |
| **AI** | gpt-4.1-mini, chỉ nhả nhãn/JSON, có timeout, hỏng thì code chạy tiếp |
| **NGƯỜI THẬT** | gắn thẻ Pancake, bot đứng ngoài |

---

## 2. Một tin khách đi qua 8 chặng

```
                                        ┌─────────────────────────┐
 1. Lấy hội thoại            CODE       │                         │
 2. Cổng chặn                CODE  ───► │      NGƯỜI THẬT         │
 3. Nhận diện ảnh            MÁY   ───► │  thẻ 183 CHỜ XL         │
 4. AI gắn nhãn              AI         │  thẻ 184 XL ảnh         │
 5. AI ra quyết định         AI    ───► │  thẻ 185 đơn ưu tiên    │
 6. Rừng luật (~200 nhánh)   CODE  ───► │                         │
 7. AI soạn câu tự do        AI    ───► │  Bot ngừng hẳn tới khi  │
    (ĐANG TẮT)                          │  nhân viên gỡ thẻ.      │
 8. Soi câu rồi mới gửi      CODE       └─────────────────────────┘
```

Bốn chặng có lối rẽ sang người thật. Không chặng nào được đoán bừa để đi tiếp.
Ba chặng gọi AI (4, 5, 7) — chặng 7 hiện bị khoá, nên **mỗi lượt tốn tối đa 2 lượt gọi AI**.

### Chặng 1 — Lấy hội thoại · CODE

Vòng lặp 4 giây gọi Pancake lấy danh sách hội thoại; song song đó webhook đẩy thẳng
`conv_id` khi có tin mới. Chỉ giữ hội thoại *chưa đọc* hoặc *khách là người nhắn cuối*,
trong 24 giờ. Hàng đợi ưu tiên khách chờ lâu nhất (FIFO) để tin cũ không bị tin quảng cáo
mới ăn hết suất.

Chạy 6 hội thoại cùng lúc (`SONG_SONG`), mỗi hội thoại một khoá riêng, trần 30 hội thoại
mỗi nhịp (`MAX_MOI_NHIP`). Pancake trả 429 thì giãn nhịp 8s → 16s → 30s thay vì dập đều.

### Chặng 2 — Cổng chặn · CODE → lối ra NGƯỜI THẬT

Bốn câu hỏi, sai một cái là bot rút lui ngay:

- hội thoại còn **thẻ giữ** không (183/184/185/166/177 — theo chốt shop 25/08/2026 thì
  **mọi** thẻ giữ đều làm bot dừng hẳn, không còn chia nhỏ 183 vs 185)
- nhân viên vừa nhắn khách chưa
- cụm tin này xử lý rồi chưa (`processed_messages.json`)
- có dấu hiệu hậu mãi không (giao lại, hoàn hàng, "hôm trước đã lên đơn")

Thêm một bộ nhớ đệm: hội thoại không đổi `updated_at` + trạng thái seen, và lần trước đã
kết luận "không có gì để làm" → bỏ qua, khỏi tốn request đọc tin.

### Chặng 3 — Nhận diện ảnh · MÁY CỤC BỘ (không phải AI ngôn ngữ)

Khách gửi ảnh mẫu thì một tiến trình Python thường trú (`embedding_worker.py`) so ảnh bằng:

- **CLIP** — `clip_index.npz` (27 MB)
- **perceptual hash** — `hash_index.json`
- **OCR Tesseract** — khi ảnh có chữ
- `celeb_index.json` — nhận ảnh người nổi tiếng

Không tốn tiền OpenAI. Không đủ điểm tin cậy thì bot **tuyệt đối không đoán theo caption
quảng cáo** — gắn thẻ 184 để người thật nhìn ảnh.

> Ngưỡng hiện tại `CLIP_MIN_SCORE=0.80` / `CLIP_MIN_GAP=0.04` là số đặt tay, **chưa từng
> được đo**. Có sẵn bộ đo: `python tao_anh_thu.py 40` rồi `npm run do-anh`.

### Chặng 4 — AI đọc tin, gắn nhãn · AI (`ai_intent.js`)

Lượt gọi AI thứ nhất. Công tắc `AI_READ_FIRST` (mặc định `on`).

- **Vào:** tin mới nhất, mẫu đang khoá, câu shop vừa nói, 6 lượt gần nhất, mẫu đã báo giá
- **Ra:** đúng **một nhãn** trong danh sách đóng ~60 nhãn (`PRICE_ASK`, `SIZE_ADVICE`,
  `ADDRESS`, `DEFECT_REPORT`, `PRICE_OBJECTION`, `DEFER_DECISION`…), kèm vài trường bóc
  sẵn: size, số điện thoại, địa chỉ đã đủ giao chưa

Vì danh sách đóng nên AI không thể chế ra thứ code chưa biết xử lý. Không nhận ra ý thì
nhãn `OTHER` — và `OTHER` đi thẳng sang người thật, không để code đoán.

Timeout hay hỏng khoá → `mem._aiOk = false` → toàn bộ nhánh dưới tự động quay về regex.

### Chặng 5 — AI ra quyết định · AI (`ai_quyet.js`)

Lượt gọi AI thứ hai, tầng "hiểu" mạnh nhất. gpt-4.1-mini, temperature 0, timeout 7 giây,
max 450 token.

- **Vào:** 20 lượt hội thoại gần nhất + **danh sách mẫu ứng viên** (từ ảnh lượt này, từ tên
  khách gõ, từ mẫu đã báo giá, từ quảng cáo dính trên hội thoại) + thông tin đã gom
- **Ra:** JSON — khách đang nói mẫu nào (`referent`), địa chỉ đủ hay thiếu mảnh nào, lượt
  này nên làm gì (`TU_VAN` / `HOI_SIZE` / `HOI_MAU` / `XIN_SDT` / `XIN_DIA_CHI` /
  `XAC_NHAN_TINH` / `CHOT_DON` / `IM_NHUONG_NGUOI`), câu nhắn soạn theo phom, độ tin cậy

**Ba cái khoá:**

1. Mã hàng phải nằm trong danh sách ứng viên (`_sanitize` lọc)
2. Mọi con số tiền bị thay bằng `{COD}` để code điền lại từ sheet
3. AI nói `CHOT_DON` thì code thẩm định lại **từng trường**: mã có trong catalog? địa chỉ có
   địa danh thật? sđt đúng 10 số?

Nếu AI ra lệnh dứt khoát và đủ tin cậy (ngưỡng 0.7), lệnh chạy **trước** cả rừng luật —
kiến trúc đã đảo quyền: AI phát lệnh, luật cũ làm quân dự bị. Công tắc trong
`ai_quyet_config.json`, sửa xong không cần khởi động lại.

### Chặng 6 — Rừng luật · CODE

Gần **200 nhánh**, mỗi nhánh là một tình huống bán hàng thật đã từng gặp: hỏi chất liệu,
hỏi co giãn, đòi ảnh mặt sau, chê giá, so sánh shop khác, hỏi bầu mặc được không, cho số đo
ba vòng, lấy thêm mẫu vào đơn đã chốt, đòi đổi hàng…

**Thứ tự rất quan trọng:** nhánh cụ thể đặt trước nhánh tham lam, để câu "size" không cướp
mất câu "size các mẫu có giống nhau không".

Mỗi nhánh trả lời bằng *template + dữ liệu thật* từ catalog Google Sheet, bảng size, bảng
khuyến mãi. **Đây là nơi duy nhất trong cả hệ thống được phép nói ra một con số.** Nhánh nào
tra sheet không thấy dữ liệu thì không bịa — nhường người thật.

Xen giữa rừng luật là `intent_router.js`: regex có chấm điểm (ngưỡng 0.6) làm cổng gác cho
ba ý dễ bắt nhầm nhất, xử **từng tin** một chứ không chỉ tin cuối.

### Chặng 7 — AI soạn câu tự do · AI (`reasoning_engine.js`) — **ĐANG TẮT**

Rơi tới đây nghĩa là không nhánh nào nhận. AI được đưa cả kịch bản Google Doc + luật tab
"AI AGENT" + dữ liệu mẫu, soạn ra `{reply, action}` với `action` là `NONE` / `TAG_HUMAN` /
`SEND_IMAGES`.

Nhưng `AI_REPLY_MODE` trong `.env` đang là **off** → câu AI vừa soạn **không được gửi**,
lượt đó chuyển thành gắn thẻ 183 cho người thật.

| Chế độ | Hành vi |
|---|---|
| `off` (đang dùng) | AI tự chế → nhường người thật. An toàn tuyệt đối. |
| `shadow` | Vẫn nhường người, nhưng in log câu AI định nói + kết quả bộ soi → đo trên traffic thật |
| `on` | Bộ soi PASS thì cho gửi; BLOCK thì nhường người |

Khi bật `on`, mỗi câu còn phải qua `reply_guard.js`: dính tiền, giá "990k", số điện thoại,
phí ship, tồn kho, hay câu "đã lên đơn / tổng tiền / STK" → **chặn nguyên câu** (chặn cả câu
an toàn hơn cắt rồi gửi câu cụt).

### Chặng 8 — Soi câu rồi mới gửi · CODE

Câu nào cũng đi qua dây chuyền cuối:

- cắt câu báo giá lặp cho mẫu đã báo
- ép size về đúng bảng size của mẫu
- xoá câu tự tuyên bố hết hàng
- bỏ câu mời chào thừa, tiết chế icon
- chặn xin số điện thoại quá sớm hoặc lặp lại
- sổ chống trùng `bot_dup_sent.json` chặn gửi hai lần cùng một câu

Gửi xong: ghi bộ nhớ hội thoại (SQLite), đánh dấu cụm tin đã xử lý, hẹn câu nhắc nếu khách
im, và — nếu vừa chốt đơn — ghi vào hàng đợi lên đơn.

---

## 3. Ranh giới: khi nào AI, khi nào code

Cách chia **không theo chủ đề** ("địa chỉ thì AI, giá thì regex" — cách đó đẻ ra hai hệ
tranh nhau một tin) mà theo **tầng việc**: hiểu hay làm.

| Việc | Ai làm | Vì sao |
|---|---|---|
| Hiểu tin viết tắt, sai chính tả | AI | "chấy gi", "Szai", "m6 53kg" — regex chịu chết |
| Khách đang nói mẫu nào | AI | Phải đọc cả dòng thời gian: ảnh mới, quảng cáo cũ, mạch tư vấn dở |
| Địa chỉ đủ ba tầng chưa | AI + CODE | AI phán đủ/thiếu và gộp mảnh rải rác; code bóc chuỗi thật + đối chiếu danh mục xã/phường 2025 |
| Nói giá, tổng tiền, phí ship | CODE | Lấy từ catalog + bảng KM. AI viết số tiền → lọc thành `{COD}` hoặc chặn cả câu |
| Còn hàng / hết hàng | CODE | Bot không quản tồn kho; câu "hết hàng" do AI sinh ra bị cắt bỏ |
| Chọn size theo cân nặng / số đo | CODE | Tra bảng size, giao với size mẫu thực có. AI chỉ bóc con số |
| Tạo đơn | CODE | AI nhiều nhất là *đề nghị* `CHOT_DON`; code thẩm định từng trường |
| Nhận diện ảnh mẫu | MÁY CỤC BỘ | CLIP + pHash + OCR chạy trên máy shop, không gọi API |
| Hậu mãi, khiếu nại, chuyển khoản | NGƯỜI | Đụng đơn và tiền đã trả — bot chỉ được gắn thẻ |
| Câu chưa ai dạy | NGƯỜI | Mặc định hiện tại: thà im còn hơn nói bậy |

---

## 4. Lời bot nói đến từ đâu

Cùng một câu chào có thể sinh ra từ bốn nơi — đây là lý do nhiều lần "sửa Google Doc mà bot
không đổi". `kho_kich_ban.js` gom lại thành **bốn tầng, tầng trên đè tầng dưới**:

1. **Tab "AI AGENT" trong Google Sheet** — kinh doanh sửa nóng, nạp lại mỗi 5 phút
2. **`kich_ban/<shop>.json`** — mỗi shop chỉ khai phần *khác* với gốc (số tài khoản,
   showroom, công tắc riêng)
3. **`kich_ban/mac_dinh.json`** — kịch bản gốc mọi shop kế thừa
4. **Phom viết cứng trong mã** — lưới đỡ cuối để bot không bao giờ câm

Bản gốc chia **hai ngăn, quyền khác nhau**:

- `cau` — câu nói với khách. Shop sửa được, Sheet đè được.
- `prompt` — luật dạy AI. Shop **không** đè được (loader chặn cứng), vì sai một dòng là lệch
  cả hành vi chứ không phải sai một câu.

Tra kho hụt mà nơi gọi cũng không có phom → câu bị gắn dấu vô hình (`MOC_HUT`) và **chặn
không gửi**: thà không nhắn còn hơn nhắn câu cụt.

**Muốn biết thực tế câu vừa gửi đến từ đâu:**

```bash
npm run thong-ke-nguon    # đếm theo nguồn: nhanh_cung / ai_tu_do / ai_quyet / luat_sheet
npm run soi-kich-ban      # bắt mâu thuẫn giữa kịch bản và câu viết cứng
```

`nguon_cau.js` dò vân chữ ngược về đúng `tệp:dòng` đẻ ra câu đó.

---

## 5. Sau khi chốt: đơn đi đường riêng

```
  bot tư vấn  ──ghi──►  hàng đợi SQLite  ──đọc──►  lên đơn POS
  bot_worker             hang_doi_don               order_worker
       │                                                 ▲
       └────── thẻ 182 (nay chỉ còn là nhãn cho NV nhìn) ─┘
```

Hai tiến trình **bật/tắt độc lập**. Trước đây chính cái thẻ Pancake là dây điện giữa hai
tiến trình: Pancake trục trặc hoặc nhân viên gỡ nhầm thẻ là đơn im lặng biến mất. Nay tín
hiệu đi qua bảng SQLite, gắn thẻ hụt cũng không mất đơn.

`DON_NGUON` trong `.env`:

| Giá trị | Nghĩa |
|---|---|
| `ca_hai` | **mặc định** — cả bảng lẫn thẻ, bỏ trùng. Giữ được thói quen NV gắn tay thẻ 182 |
| `bang` | chỉ bảng SQLite. Sạch nhất, nhưng gắn tay thẻ 182 hết tác dụng |
| `the` | chỉ thẻ Pancake. Cách cũ, để quay lui khi có sự cố |

`order_worker.js` tra biến thể trên POS, tạo **một đơn cho một sản phẩm**, ghi
`orders_state.json` để không lên trùng, tính phí ship theo kịch bản (trên 500k miễn ship).
Dòng nào thiếu thông tin thì **không** lên đơn dòng đó mà gắn thẻ 183 cho nhân viên.

---

## 6. Công tắc — đổi hành vi mà không sửa mã

| Công tắc | Đang là | Tác dụng |
|---|---|---|
| `AI_REPLY_MODE` | `off` | off = AI tự soạn câu thì nhường người · shadow = chỉ ghi log · on = cho gửi nếu qua bộ soi |
| `AI_READ_FIRST` | `on` | Tắt là bỏ tầng AI gắn nhãn, bot chạy thuần regex như bản cũ |
| `ai_quyet_config.json` | bật cả 3 | `bat_referent`, `bat_diachi_chotdon`, `log_so_sanh` — không cần khởi động lại |
| `SIET_NHAN_VIEN_TRA_LOI` | `off` | Bật thì gỡ thẻ thôi chưa đủ, phải có tin của NV rồi bot mới nhận lại hội thoại |
| `che_do_sale_gon` | theo chương trình | Bot chỉ làm 4 việc (báo giá / chất liệu / size từ số đo / câu chương trình), khác → im + gắn thẻ |
| `CHI_XU_LY_IDS` | trống | Danh sách trắng chạy thử trên page thật: bot chỉ đụng đúng vài hội thoại khai ra |
| `SONG_SONG` | `6` | Số hội thoại xử cùng lúc; đặt 1 là quay về tuần tự |
| `BOT_ENV=staging` | — | Nạp `.env.staging` trước và **tự bật `ORDER_DRY_RUN`** — không tạo đơn thật |

---

## 7. Đo và canh

- **Mỗi lượt một dòng JSON** — `turn_log.js` ghi `data/turnlog/<ngày>.jsonl`: nhãn ý định,
  thẻ đã gắn, câu đã gửi, lý do nhường người, số token và tiền AI của lượt đó.
  `npm run thong-ke` ra tỉ lệ bot trả lời / nhường người kèm lý do và tiền AI mỗi tháng.
- **Ba kiểu hỏng mà tiến trình vẫn sống** — `giam_sat.js`: vòng quét ngừng > 3 phút thì tự
  thoát cho `start_bot.bat` mở lại; có việc mà 15 phút không trả lời ai → cảnh báo (nghi
  token hỏng); hơn 30% lượt kết thúc bằng lỗi → cảnh báo.
- **Chat thử không đụng khách** — `npm run chat-thu`, `npm run dien-kich-ban`: chạy *nguyên
  vẹn mã thật*, chỉ thay đầu dây bên kia bằng Pancake giả trong RAM. OpenAI vẫn gọi thật,
  POS chặn cứng.
- **Bộ test** — `npm test`, offline, không gọi Pancake/OpenAI, không đụng dữ liệu khách.

---

## 8. Bốn điều nên biết trước khi sửa

### 8.1 Bot hiện tại gần như không có "AI tự nói"

Với `AI_REPLY_MODE=off`, mọi câu AI tự soạn ở chặng 7 đều bị đổi thành nhường người thật.
Ngoại lệ duy nhất là câu do `ai_quyet` soạn theo phom ở chặng 5 (đang bật) — và câu đó đã bị
lọc sạch số tiền.

→ **Tỉ lệ bot trả lời được phụ thuộc gần như hoàn toàn vào độ phủ của rừng luật code**,
không phải vào chất lượng AI.

### 8.2 Rừng luật nằm trong một hàm ~7.000 dòng

`processOneConversation()` chạy từ dòng ~6035 tới ~13130 của `bot_worker_api_v3.js`
(cả tệp 13.4k dòng). Thứ tự các nhánh **chính là** logic ưu tiên — đổi chỗ hai nhánh là đổi
hành vi bot. Đây là món nợ kỹ thuật lớn nhất và là thứ GĐ2 (tách kịch bản khỏi mã) phải gỡ.

### 8.3 Ngưỡng nhận diện ảnh chưa từng được đo

`CLIP_MIN_SCORE=0.80` / `CLIP_MIN_GAP=0.04` là số đặt tay. Bộ đo có sẵn sẽ đề xuất cặp
ngưỡng giữ số ca "khẳng định nhầm mẫu" bằng 0:

```bash
python tao_anh_thu.py 40
npm run do-anh
```

### 8.4 `botSentIds` là bộ nhớ RAM — mọi phép dò dựa vào nó đều thủng sau khởi động lại

`botSentIds` (dòng ~79) là `new Set()` trong RAM, chỉ nhớ tin bot gửi **trong lần chạy hiện
tại**. Bot khởi động lại là quên sạch → mọi câu bot từng nói biến thành "tin người thật".

Đã cắn một lần thật (25/08/2026, khách Hà Giang): `postSaleFitComplaint` lấy hai câu của
**chính bot** — "em nhận được **ảnh** của chị rồi" + "em **gửi nhầm** [tin nhắn] ạ" — ghép
thành "khách đã nhận hàng và shop gửi nhầm", gắn thẻ 183. Nhân viên gỡ thẻ, vòng poll sau
gắn lại. Khách hỏi hai lần không ai trả lời. Đã vá bằng cách chốt theo `sender` thay vì
`botSentIds` (xem `test/hau_mai_khong_tu_buoc_toi.test.js`).

**Còn nợ:** `isHumanInboxMsg` và các phép dò khác trong cổng hậu mãi vẫn dựa vào `botSentIds`.
Cùng lớp lỗi, chưa vá. Cách chữa tận gốc: ghi `botSentIds` xuống SQLite thay vì giữ trong RAM.

### 8.5 Ba tầng trong tài liệu ≠ ba tầng trong mã

`QUY_TRINH_HYBRID.md` mô tả: regex → AI nhãn → code hành động.

Mã thật đi xa hơn:
- AI đọc **trước** regex (chặng 4)
- AI **phát lệnh trước** rừng luật (chặng 5)
- `intent_router.js` — vốn là "tầng 1" trong tài liệu — hiện **chỉ** được dùng làm cổng gác
  cho ba ý dễ bắt nhầm (một chỗ duy nhất trong mã)

→ Đọc tài liệu để hiểu ý định, đọc mã để biết hành vi.

---

*Công tắc đổi thì file này lỗi thời — kiểm lại bằng `npm run thong-ke-nguon`.*

*Bản có sơ đồ vẽ: https://claude.ai/code/artifact/0641f6b6-54e3-431a-8d2e-a33eae3c9bc2*
