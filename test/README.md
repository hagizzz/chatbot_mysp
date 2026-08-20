# Bộ test — lưới an toàn trước khi đụng vào lõi 12.7k dòng

```bash
npm test                       # chạy tất cả, offline, ~1 giây
node test/trich_ca_vang.js     # dựng lại bộ ca vàng từ dữ liệu chạy thật
```

Không gọi Pancake, không gọi OpenAI, không đụng dữ liệu khách (CSDL tạm trong thư mục tạm của máy).

## Có gì

| Tệp | Kiểm cái gì |
|---|---|
| `nhan_y_dinh.test.js` | Phát lại **ca vàng** — tin khách thật + nhãn mà bản đang chạy đã gán. Lệch = một ca đang chạy tốt vừa vỡ. |
| `nguyen_tac.test.js` | **Nguyên tắc mục 2** của bản yêu cầu, dưới dạng test: không bịa, chốt đủ 4 thông tin, ca nhạy cảm giao người thật. |
| `dia_chi.test.js` | Chuẩn hoá địa chỉ theo danh mục 2025 — chỗ vỡ âm thầm nhất (đơn không lên mà log không báo lỗi). |

## Ca vàng

`test/ca_vang/nhan_y_dinh.json` — mỗi ca là một tin nhắn khách thật kèm nhãn bản đang chạy đã quyết.
Trích từ `conversation_memory.json` và log pm2.

**Máy này chỉ dựng được 68 ca**, không phải 150–200 như kế hoạch ước tính: log pm2 chỉ giữ 20.000 dòng
cuối nên phần lớn hội thoại cũ đã trôi mất. Bổ sung bằng cách kéo hội thoại thật về từ Pancake:

```bash
node test/thu_them_ca_vang.js 200        # cần .env thật; CHỈ ĐỌC, không gửi tin, không gắn thẻ
node test/thu_them_ca_vang.js 200 --ai   # gắn thêm nhãn AI (tốn tiền OpenAI)
```

## Riêng tư

Ca vàng nằm trong git nên trước khi ghi ra file:

- **Số điện thoại** trong tin nhắn → `0900000000` (giữ hình dạng để nhãn `PROVIDE_PHONE` vẫn dò đúng).
- **conversationId** → `{pageId}_#<8 ký tự băm>`; psid định danh một người dùng Facebook cụ thể.
  Bảng tra ngược nằm ở `test/ca_vang/tra_cuu_conv.local.json` — **không** vào git, chỉ ở máy shop,
  để còn mở lại đúng hội thoại mà soi khi một ca vỡ.

`nguyen_tac.test.js` có test canh đúng hai điều trên — quên che là test đỏ.

## Khi một ca vỡ

1. `npm test` in ra tin nhắn, nhãn mong đợi và nhãn thực tế.
2. Tra `tra_cuu_conv.local.json` lấy conversationId thật.
3. Soi riêng ca đó: `WATCH_IDS=<id> DUMP_CONV=<id> node bot_worker_api_v3.js`.
4. Sửa xong chạy lại `npm test`. **Không sửa ca vàng cho khớp với code mới** — trừ khi nhãn cũ
   thật sự sai, và khi đó ghi lý do vào commit.
