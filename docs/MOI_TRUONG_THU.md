# Môi trường thử — chat với bot mà không đụng khách thật

Có **hai đường thử**, chọn theo mục đích:

| | Trong máy (`npm run chat-thu`) | Trên page thật (`chay_thu.bat`) |
|---|---|---|
| Tin đi tới ai | không ai — hội thoại nằm trong RAM | **Facebook thật của chính mình** |
| Rủi ro chạm khách thật | không có | có, nếu khai sai `CHI_XU_LY_IDS` |
| Nhắn từ điện thoại được không | không | **được** |
| Thử ảnh, ad, thẻ Pancake thật | không | được |
| Tốn tiền OpenAI | ít | ít |

Phần dưới nói về đường **trong máy**. Đường **trên page thật** ở mục cuối.

Viết ngày 22/08/2026.

Trước đây muốn thử bot phải chạy trên page thật rồi tự nhắn vào, hoặc dựng
`.env.staging` + `CHI_XU_LY_IDS` — vẫn là tin thật đi qua Pancake thật. Giờ có
đường thử **hoàn toàn trong máy**.

## Chạy

```bash
npm run chat-thu           # ngồi gõ, chat tay với bot
npm run dien-kich-ban      # diễn sẵn 3 kịch bản rồi in bản ghi
```

> **`chat-thu` cần CỬA SỔ TERMINAL THẬT** (Windows Terminal / PowerShell / cmd).
> Chạy bằng `!` trong Claude Code, qua đường ống, hay chạy nền đều không có bàn
> phím — stdin đọc EOF ngay và chẳng gõ được gì. Gặp trường hợp đó chương trình
> báo rõ rồi thoát. Muốn thử mà không cần gõ thì dùng `npm run dien-kich-ban`.
>
> (Bộ lái tự động khi kiểm thử: đặt `CHAT_THU_KHONG_CAN_TTY=1` để bỏ chốt này.)

Thêm cờ:

| Cờ | Nghĩa |
|---|---|
| `--ai` | ép `AI_REPLY_MODE=on` (mặc định theo `.env`, đang là `off`) |
| `--chi-tiet` | hiện luôn log lõi bot lên màn hình (chỉ `chat_thu.js`) |

Diễn đúng một kịch bản: `node dien_kich_ban.js kich_ban_thu/co_ban.json`

Lệnh trong lúc chat tay: `/anh <url>` gửi ảnh · `/the` xem thẻ · `/su` xem lại
hội thoại · `/moi` sang khách mới · `/thoat`.

## Nó hoạt động thế nào

Lõi bot là script liền khối 12.7k dòng, **không có `module.exports`** nên không
gọi rời từng hàm được. Nhưng mọi lần đọc/gửi tin đều đi qua đúng một cửa: hàm
`fetch` toàn cục. Nên ta chặn ngay cửa đó (`pancake_gia_lap.js`).

Bot chạy **nguyên vẹn mã thật** — vẫn poll 4 giây, vẫn hiểu ý 3 tầng, vẫn chọn
ảnh, vẫn chốt đơn, vẫn gắn thẻ. Chỉ có đầu dây bên kia là hội thoại nằm trong
RAM chứ không phải Pancake.

| Host | Xử lý |
|---|---|
| `pages.fm` | **giả lập** — không một gói tin nào ra ngoài |
| `pos.pages.fm` | **chặn cứng** — đây là nơi tạo đơn thật |
| `graph.facebook.com`, `hook.nysaki.vn` | chặn |
| `api.openai.com` | **cho qua** — muốn xem bot nghĩ thật thì phải gọi AI thật |
| Google Sheet/Doc, ảnh | cho qua (chỉ đọc) |
| host lạ | chặn + ném lỗi to |

## Không làm bẩn dữ liệu thật

Lõi bot ghi thẳng vào sổ sách của shop bằng **đường dẫn cứng**. Lần dựng đầu
tiên đã dính đúng lỗi này: id tin giả lọt vào `processed_messages.json`, khiến
chính bot lặng thinh ở lần chạy sau vì tưởng đã trả lời rồi; một hội thoại giả
cũng lọt vào `conversation_memory.db` (1495 → 1496). Cả hai đã dọn.

Nay chặn bằng một chốt duy nhất ở tầng `fs`: mọi lệnh **ghi** vào các tệp dưới
đây bị bẻ sang thư mục tạm, còn **đọc** thì vẫn đọc bản thật (vô hại).

`processed_messages.json` · `bot_dup_sent.json` · `pending_followups.json` ·
`orders_state.json` · `ad_learned_map.json` · `ad_product_map.json` ·
`conversation_memory.json`

Ba thứ có sẵn biến môi trường thì dùng cho đúng ý: `MEMORY_DB` (CSDL riêng),
`SHOP_ID=mysp_thu`, `TURNLOG_DIR`.

**Cách tự kiểm:** lấy `md5sum` mấy tệp trên trước và sau khi chạy — phải giống
hệt nhau. Đã kiểm sau 6 lần chạy: không tệp nào đổi, CSDL vẫn đúng 1495 hội thoại.

## Đọc bản ghi cho đúng

Bot **cố ý im** trong hai trường hợp, và đó là đúng nguyên tắc chứ không phải hỏng:

| Dòng in ra | Nghĩa |
|---|---|
| `(bot cố ý không trả lời — vừa giao người thật)` | gặp câu chưa có kịch bản dạy → gắn thẻ 183, không bịa |
| `(bot đứng ngoài — còn thẻ giữ 183)` | hội thoại đang chờ nhân viên, AI không chen vào |
| `(chưa trả lời ngay — bot đang gộp với tin kế tiếp)` | `DEBOUNCE_MS=2500`: bot đợi khách gõ xong rồi **gộp mấy tin liền nhau thành một lượt**, nên câu trả lời hiện ở lượt sau |
| `CẢ KỊCH BẢN bot không nói câu nào, cũng không gắn thẻ` | **cái này mới đáng lo** |

Vì bot gộp tin, **đừng chấm điểm từng lượt** — chấm cả kịch bản.

Mỗi kịch bản chạy trên **một hội thoại riêng**. Trước đây dùng chung một id nên
kịch bản 1 giao người thật (thẻ 183) là kịch bản 2 và 3 thừa hưởng luôn, bot
"đứng ngoài" suốt. Nay `hoiThoaiMoi()` cấp một suất khách mới mỗi lần.

## ĐƯỜNG VÀO của khách — thứ quyết định bot có biết "váy này" là váy nào

Thêm 24/08/2026, sau khi phát hiện mọi kết luận trước đó đều đo trên hoàn cảnh
nghèo nhất.

Khách nhắn *"váy này bao nhiêu"* thì bot biết là váy nào hay không **phụ thuộc
hoàn toàn vào đường vào**:

| Đường vào | Bot suy ra mẫu bằng gì |
|---|---|
| Bấm **quảng cáo** | 6 tầng: khách gõ tên → mã trong tên ad → bản đồ tay + tự học (1.110 dòng) → caption bài → vision đọc ảnh → AI-QUYẾT phân xử |
| **Bình luận** dưới bài | đọc bài THẬT qua Pancake (`pancake_reader` v17) → caption → tên mẫu → nhớ vào `commentPostProduct` |
| **Nhắn thẳng** | không có gì cả — đây là cảnh DUY NHẤT bot thật sự không biết mẫu |

Khung thử **trước hôm nay ghi cứng `ads: []` / `ad_ids: []`**, nên hai đường đầu
chưa từng chạy một lần nào: mọi kịch bản đều là khách nhắn thẳng. Chấm điểm bot
trên đó rồi kết luận "bot thiếu kịch bản" là chấm oan — đo thử lại với đúng
đường vào thì cùng câu hỏi ấy bot báo giá đủ ảnh đủ mẫu.

Khai đường vào trong kịch bản:

```json
{
  "ten": "Khách bấm quảng cáo rồi hỏi giá",
  "nguon": { "loai": "quang_cao", "adId": "120254257724490550" },
  "luot": [{ "khach": "váy này bao nhiêu tiền em" }]
}
```

| Trường | Dùng khi |
|---|---|
| `{ "loai": "quang_cao", "adId": "...", "postId": "..." }` | khách bấm quảng cáo |
| `{ "loai": "binh_luan", "postId": "...", "caption": "...", "anhBai": ["url"] }` | khách bình luận dưới bài |
| `{ "loai": "nhan_thang" }` hoặc bỏ trống | khách tự nhắn vào page |

Hai chỗ dễ sai, đã có test canh (`test/duong_vao_gia_lap.test.js`):

- **`ad_id` phải là ad CÓ THẬT** trong `ad_learned_map.json`. Bịa một id thì
  chuỗi suy-ra-mẫu chắc chắn trượt, rồi ta lại tưởng bot hỏng.
- **Bài viết nằm trong thân trả lời của API TIN NHẮN**, không phải ở object hội
  thoại: `pancake_reader` đọc `data.post.message` và `data.post_id`. Đặt nhầm chỗ
  thì caption rỗng, bot không có gì để suy ra mẫu.

Kịch bản mẫu nằm ở `kich_ban_thu/duong_vao.json`. Bản đồ cả thư mục: `kich_ban_thu/README.md`.

## Viết thêm kịch bản

Thả một tệp `.json` vào `kich_ban_thu/`, hoặc thêm vào mảng `kich_ban` của một tệp có sẵn:

```json
{
  "ten": "Khách đòi xem ảnh thật",
  "luot": [
    { "khach": "cho xem ảnh thật đi shop" },
    { "anh": "https://..." },
    { "cho": 20 }
  ]
}
```

`cho` là số giây nán thêm — dùng khi muốn xem bot có tự nhắc lại không.

## Hạn chế đang có

- ~~**Nhận diện ảnh chưa chạy được**: máy chưa có `numpy`/`open_clip`.~~
  **Đã cài xong — kiểm lại 24/08/2026:** có `numpy`, `open_clip`, `torch 2.13.0+cpu`.
  Gửi `/anh` là bot nhận diện thật. Lượt đầu vẫn chậm vì phải nạp model.
- Lượt đầu sau khi khởi động luôn chậm (nạp 589 sản phẩm + 1118 map quảng cáo),
  nên `dien_kich_ban.js` đốt một lượt làm nóng trước khi diễn thật.
- Gọi AI thật nên **có tốn tiền OpenAI**, tuy rất ít.


---

# Thử trực tiếp trên page thật

Dùng khi muốn nhắn từ Facebook/điện thoại của mình và xem bot trả lời y như
khách thật thấy.

## Các bước

```bash
# 1) Lấy Facebook cá nhân nhắn vào page MYS.P một câu, ví dụ "test bot"

# 2) Tìm id hội thoại của mình  (CHỈ ĐỌC, không gửi gì)
node tim_hoi_thoai.js
node tim_hoi_thoai.js Phương        # lọc theo tên cho nhanh

# 3) Chép id đó vào .env.staging, thay dòng
#    CHI_XU_LY_IDS=CHUA_DIEN_ID_CUA_TOI

# 4) Chạy
chay_thu.bat
```

Ctrl+C để dừng. Bot **không** tự mở lại (đây là bản chạy thử).

## Vì sao an toàn

Bốn lớp, không lớp nào dựa vào lớp nào:

| Lớp | Chặn cái gì |
|---|---|
| `CHI_XU_LY_IDS` | bot chỉ đụng đúng id khai — mọi khách khác bị bỏ qua hoàn toàn |
| `ORDER_DRY_RUN=1` | không tạo đơn POS thật |
| `WEBHOOK_PULL_URL=` (trống) | tắt đường webhook đẩy hội thoại vào |
| `MEMORY_DB` riêng | không ghi vào CSDL sản xuất |

Giá trị mặc định trong `.env.staging` là `CHUA_DIEN_ID_CUA_TOI` — không khớp
hội thoại nào, nên lỡ chạy khi chưa điền thì bot đụng **zero** khách.

**Tuyệt đối không để `CHI_XU_LY_IDS` trống.** Trống = bot trả lời cả 240 khách
thật đang chờ nhân viên.

## Một lỗ thủng đã vá (22/08/2026)

Hàng rào `CHI_XU_LY_IDS` **từng không kín**. Khối webhook trong `processOnce()`
chạy *sau* bộ lọc và `fresh.unshift(...)` thẳng vào hàng xử lý mà không áp lại
danh sách trắng.

Đo thực tế trước khi vá — khai đúng **1** id, chạy 50 giây:

```
[HÀNG ĐỢI] 4210 conv cần xử: (webhook)(seen=false), ...
[VÀO XỬ] Bi Nguyễn | id=1553605292987630_1375025524141463     <- KHÁCH THẬT
```

May là chưa kịp gửi tin nào cho ai. Đã vá trong `bot_worker_api_v3.js` (áp
danh sách trắng ngay trong vòng lặp webhook) và tắt luôn webhook ở
`.env.staging` cho chắc hai lớp.

Sau khi vá, cùng phép thử: đọc 360 hội thoại → **vào xử lý 0, gửi 0, gắn thẻ 0**.

Lần chạy đó cũng lộ chuyện `.env.staging` mẫu thiếu `MEMORY_DB`: 50 giây đẻ
1503 dòng vào `conversation_memory.db` sản xuất. Đã dọn (1495 dòng thật còn
nguyên, đối chiếu từng dòng: 0 dòng khác nội dung) và bổ sung `MEMORY_DB`.
