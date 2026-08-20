# Bot tư vấn bán hàng (MYS.P) — chạy từ máy trắng

Bot đọc tin nhắn Facebook qua Pancake, tư vấn sản phẩm thời trang, nhận diện ảnh mẫu,
chuẩn hoá địa chỉ và tự lên đơn POS.

Kế hoạch phát triển: [`KE_HOACH_TRIEN_KHAI_MYS.md`](KE_HOACH_TRIEN_KHAI_MYS.md).
Quy trình hiểu ý khách 3 tầng: [`QUY_TRINH_HYBRID.md`](QUY_TRINH_HYBRID.md).

---

## 1. Cần có trước

| Thứ | Bản | Ghi chú |
|---|---|---|
| Node.js | ≥ 20 (đang chạy 24) | `node -v` |
| Python | ≥ 3.10 | chỉ cần nếu dùng nhận diện ảnh |
| Tài khoản Pancake | — | có quyền đọc hội thoại + gắn thẻ + tạo đơn POS |
| Khoá OpenAI | — | đang dùng `gpt-4.1-mini` |
| `google-service-account.json` | — | đặt cạnh mã nguồn, dùng để đọc kịch bản từ Google Doc/Sheet |

## 2. Cài

```bash
npm install
pip install -r requirements.txt        # bỏ qua nếu không dùng nhận diện ảnh
cp .env.example .env                   # rồi mở .env ra điền
```

Lấy ID thẻ thật của shop (mặc định trong `.env.example` là thẻ của MYS.P):

```bash
node list_tags.js
```

## 3. Chỉ mục cho nhận diện ảnh

Ba tệp chỉ mục **không nằm trong git** vì nặng ~35 MB và tái tạo được:

| Tệp | Sinh bằng | Dùng để |
|---|---|---|
| `clip_index.npz` | `python build_embedding_index.py` | so ảnh bằng CLIP |
| `hash_index.json` | `python update_index.py` | so ảnh bằng perceptual hash |
| `celeb_index.json` | `python build_celeb_index.py` | nhận ảnh người nổi tiếng |

Không có ba tệp này bot vẫn chạy, chỉ là mọi ảnh khách gửi đều nhường người thật.

## 4. Chạy

```bash
node bot_worker_api_v3.js      # tư vấn — tiến trình chính
node order_worker.js           # lên đơn tự động — tiến trình RIÊNG, bật/tắt độc lập
```

Trên Windows: `start_bot.bat` (tự khởi động lại khi chết) và `truy_bot.bat`.

### Môi trường thử (staging)

Tạo `.env.staging` chỉ khai phần **khác** với `.env` (page thử, kho thử...), rồi:

```bash
BOT_ENV=staging node bot_worker_api_v3.js
```

`env_boot.js` nạp `.env.staging` trước rồi mới tới `.env` (nạp trước thắng), và **tự bật
`ORDER_DRY_RUN=1`** nên môi trường thử không bao giờ tạo đơn thật.

## 5. Kiểm tra nhanh khi nghi có sự cố

```bash
node kiem_tra_token.js        # token page còn sống không
node test_read.js             # đọc thử hội thoại
node test_ai.js               # gọi thử OpenAI
node kiem_tra_lendon.js       # soi vì sao 1 hội thoại chưa lên đơn
node chan_doan_api.js         # chẩn đoán API Pancake
```

Soi một khách cụ thể mà không đụng khách khác:

```bash
WATCH_IDS=<conversationId> DUMP_CONV=<conversationId> node bot_worker_api_v3.js
```

## 6. Bản đồ mã nguồn

| Tệp | Việc |
|---|---|
| `bot_worker_api_v3.js` | lõi tư vấn (12.7k dòng) — vòng lặp poll 4 giây |
| `intent_router.js` | tầng 1: regex chấm độ chắc |
| `ai_intent.js`, `ai_quyet.js` | tầng 2: AI nhả nhãn cố định |
| `reasoning_engine.js` | tầng 3: code quyết định hành động |
| `pancake_reader.js` / `pancake_sender.js` | đọc / gửi tin |
| `page_registry.js`, `pages_config.js` | nhiều Page trên một tiến trình |
| `vn_address.js` + `vn_wards_2025.json` | chuẩn hoá địa chỉ theo danh mục 2025 |
| `order_worker.js` + `order_*.js` + `pos_client.js` | lên đơn POS |
| `knowledge_loader.js` | nạp kịch bản từ Google Doc + tab "AI AGENT" |
| `conversation_store.js` | bộ nhớ hội thoại (SQLite) |
| `turn_log.js` | log có cấu trúc mỗi lượt |
| `env_boot.js` | nạp biến môi trường theo `BOT_ENV` |

## 7. Quy ước làm việc

- **Không chép đè file nữa.** Mọi thay đổi đi qua git: nhánh → sửa → chạy test phát lại → gộp.
- Chạy test hồi quy trước mỗi lần phát hành: `npm test`.
- Tệp `SUA_LOI_v*.txt`, `HUONG_DAN_*.txt` là nhật ký các lần vá tay **trước khi có git** — giữ để tra cứu, không thêm mới.
