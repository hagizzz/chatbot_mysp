# Cấu trúc thư mục

Chia ngày 27/08/2026. Trước đó **271 tệp nằm chung ở thư mục gốc** — mã lõi, công cụ gõ tay,
script dò lỗi dùng một lần, log dump, bản sao lưu, nhật ký sửa lỗi từ tháng trước, tất cả lẫn
vào nhau.

```
/                        ĐIỂM VÀO + DỮ LIỆU + CẤU HÌNH
  bot_worker_api_v3.js     lõi bot (script liền khối, không có module.exports)
  order_worker.js          tiến trình lên đơn
  env_boot.js              nạp .env theo BOT_ENV — phải chạy đầu tiên
  *.json, *.npz, *.db      dữ liệu: bảng hàng, chỉ mục ảnh, bộ nhớ hội thoại
  *.bat                    lệnh chạy hằng ngày
  .env, .env.staging       bí mật (không vào git)

  loi/          55 tệp   THƯ VIỆN LÕI, chia theo MIỀN NGHIỆP VỤ
    ai/           9        ai_intent · ai_quyet · reasoning_engine · soi_cau_ai
                           reply_guard · intent_detector · intent_router
                           knowledge_loader · danh_tinh_bot
    pancake/      8        pancake_reader/sender · pancake_gia_lap · page_registry
                           conversation_tags · mfs_client/reader/sender
    cau_noi/      5        kho_kich_ban · duong_kich_ban · nguon_cau
                           soi_kich_ban · bo_nhan_chuan
    don/          6        order_config/extractor/store · hang_doi_don
                           pos_client · adapter_hoa
    san_pham/    11        catalog_cache · product_* · recommend · celeb_images
                           color_utils · vision_resolver · do_do_nhan*
    bo_nho/       6        conversation_store · state_manager* · processed_store
                           moc_bo_qua · nguon_hoi_thoai
    tien_ich/    10        turn_log · giam_sat · dieu_tiet · khoa_tien_trinh
                           config · vn_address · ghi_chu_ngoai · fb_ads
                           quashop_sheet · urgent_sheet

  cong_cu/      33 tệp   CÔNG CỤ GÕ TAY — chạy thủ công, không ai require
                         chat_thu · dien_kich_ban · thong_ke · do_dem · go_the_giu
                         gan_the_giu · reset_hoi_thoai · tim_hoi_thoai...

  thu_nghiem/   10 tệp   DÒ LỖI MỘT LẦN — giữ làm tư liệu, không ai gọi

  python/       15 tệp   ĐỒNG BỘ ẢNH — nhận diện, dựng chỉ mục, tải ảnh lên Pancake
  kich_ban/              KỊCH BẢN theo shop (mac_dinh.json + <shopId>.json)
  kich_ban_thu/          kịch bản để THỬ bot
  test/                  bộ test + test/log_that/ (log hội thoại thật, nguồn ca vàng)
  docs/                  tài liệu — docs/lich_su/ (nhật ký cũ), docs/huong_dan/
  luu_tru/               kho lưu: bản sao lưu, log cũ, tệp rỗng. KHÔNG vào git.
  data/, botlog/         dữ liệu chạy + log
```

## Ba luật phải giữ

**1. Dữ liệu ở lại GỐC, chỉ mã mới vào thư mục.** 38 tệp dùng `__dirname` để tìm dữ liệu
(`data/`, `google-service-account.json`, `kich_ban/`, `conversation_memory.db`...). Tệp nào
bị dời thì `__dirname` của nó được thay bằng một cái neo trỏ về gốc, **sâu đúng bằng số
tầng đã dời**:

```js
const __goc = require("path").join(__dirname, "..");         // cong_cu/, thu_nghiem/
const __goc = require("path").join(__dirname, "..", "..");   // loi/<nhóm>/
```

Dời dữ liệu đi nữa là phải sửa lại toàn bộ chỗ đó — chưa đáng.

**2. `require` phải ghi đủ thư mục.** Bỏ sót không phải lúc nào cũng báo lỗi:

```js
require("./moc_bo_qua")        // ✗ Node lấy moc_bo_qua.JSON ở gốc — KHÔNG lỗi
require("./loi/moc_bo_qua")    // ✓
```

Ca thật: dòng thiếu `loi/` khiến `_mocBoQua.moc()` thành `undefined`, cả lượt xử lý chết lặng
trong `readConversation` — không câu trả lời, không thẻ, **không một dòng lỗi nào**. Mất một
giờ mới truy ra. `test/duong_dan_module.test.js` canh đúng cái bẫy này.

**3. Require ĐỘNG phải sửa tay.** Không công cụ dò nào thấy được:

```js
const _MO_DUN_READER = _dungMfs ? "./loi/pancake/mfs_reader" : "./loi/pancake/pancake_reader";
```

Cả dự án chỉ có một chỗ như vậy (bộ chọn reader/sender theo MFS), đã có test khoá lại — và
test đó đã bắt được đúng lỗi này ngay trong đợt chia cây, khi 592/596 test khác vẫn xanh.

## Đổi chỗ tệp thì kiểm những gì

```bash
npm test                                  # 596 test, có test canh đường dẫn
node cong_cu/dien_kich_ban.js kich_ban_thu/co_ban.json   # nạp TRỌN lõi bot
```

Chỉ `npm test` xanh là **chưa đủ** — đợt chia này từng có lúc 591/591 xanh trong khi bot chạy
thật thì câm hoàn toàn. Phải diễn ít nhất một kịch bản.

## Thứ CỐ Ý không dời

- `bot_worker_api_v3.js`, `order_worker.js`, `env_boot.js` — điểm vào, `.bat` và
  `package.json` gọi thẳng.
- `test/log_that/` — log hội thoại thật, có tên và tin nhắn khách. Đã chặn trong `.gitignore`.
- `luu_tru/` — chứa `.env.staging.bak` (có bí mật) và ~70 MB chỉ mục. Cũng chặn trong git.

## Sổ tay hoàn tác

`luu_tru/SO_TAY_DON_DEP.tsv` ghi từng tệp đã dời (nơi mới ↔ nơi cũ).
`luu_tru/truoc_khi_chia/` giữ bản gốc của toàn bộ `.js`/`.py`/`.bat` trước lúc chia.
