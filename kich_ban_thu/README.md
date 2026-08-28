# Kịch bản THỬ — bốn tệp, một thư mục

Đây là kịch bản để **thử bot**, khác hẳn `kich_ban/` (là lời bot nói với khách thật).

Trước 25/08/2026 có **49 tệp rải ở 6 thư mục con**, trùng lặp và số thứ tự đụng nhau
(`10_bao_quan.json` cạnh `10_mo_man_chat_lieu.json`). Nay gom về bốn tệp theo nhóm.

| Tệp | Số kịch bản | Thử cái gì |
|---|---|---|
| `co_ban.json` | 4 | Luồng bán hàng thường ngày: hỏi giá, chốt đơn, ca khó, mở màn |
| `duong_vao.json` | 5 | Khách đến từ quảng cáo / bình luận / nhắn thẳng |
| `cau_hoi.json` | 17 | Phủ từng loại câu hỏi, mỗi câu một hội thoại riêng |
| `nghiem_thu.json` | 20 | Mỗi kịch bản nhắm đúng một bản vá hoặc một tiêu chí |

## Chạy

```bash
npm run dien-kich-ban                                  # cả bốn tệp
node dien_kich_ban.js kich_ban_thu/nghiem_thu.json     # một nhóm
AI_REPLY_MODE=shadow node dien_kich_ban.js kich_ban_thu/duong_vao.json
```

Chạy trên **Pancake giả lập**, không đụng page thật, không đụng khách nào. Có gọi
OpenAI thật nên **tốn tiền**, tuy ít. `AI_REPLY_MODE=shadow` cho xem AI *định* nói gì
mà không đổi hành vi.

## Hình dạng một tệp

```json
{
  "nhom": "Nghiệm thu — mỗi kịch bản nhắm một bản vá",
  "kich_ban": [
    {
      "ten": "Khách bấm quảng cáo rồi hỏi giá",
      "nguon": { "loai": "quang_cao", "adId": "120254257724490550" },
      "luot": [
        { "khach": "váy này bao nhiêu tiền em" },
        { "anh": "https://..." },
        { "cho": 10 },
        { "nhanVien": "Dạ em kiểm tra giúp chị nha" },
        { "goThe": 183 }
      ]
    }
  ]
}
```

Một tệp nhận **một kịch bản**, **một mảng**, hoặc `{ nhom, kich_ban[] }`.

### Khai đường vào (`nguon`)

| Khai | Dùng khi |
|---|---|
| `{ "loai": "quang_cao", "adId": "…", "postId": "…" }` | khách bấm quảng cáo |
| `{ "loai": "binh_luan", "postId": "…", "caption": "…" }` | khách bình luận dưới bài |
| `{ "loai": "nhan_thang" }` hoặc bỏ trống | khách tự nhắn vào page |

`adId` phải là ad **có thật** trong `ad_learned_map.json`, không thì chuỗi suy-ra-mẫu
chắc chắn trượt và ta lại tưởng bot hỏng. Có test canh việc này.

### Các loại lượt

| Lượt | Nghĩa |
|---|---|
| `{ "khach": "…" }` | khách nhắn |
| `{ "anh": "url" }` | khách gửi ảnh (kèm `khach` được) |
| `{ "cho": 10 }` | nán thêm 10 giây |
| `{ "nhanVien": "…" }` | **nhân viên thật** trả lời |
| `{ "ganThe": 183 }` / `{ "goThe": 183 }` | nhân viên gắn / gỡ thẻ |

Ba loại cuối cần cho việc thử luật thẻ giữ — không có chúng thì không phân biệt được
"gỡ thẻ rồi" với "gỡ thẻ + nhân viên đã trả lời".

## Cho shop khác dùng

Thả thêm một tệp `.json` vào thư mục này là xong — bộ diễn tự nạp mọi tệp `.json`.
Muốn shop nào chỉ chạy bộ của mình thì trỏ thẳng đường dẫn tệp đó.

## Đọc kết quả cho đúng

Ba dòng này **không phải lỗi**: bot gộp tin nên câu trả lời hay hiện ở lượt sau · bot
im **mà có gắn thẻ** là cố ý nhường người · bot đứng ngoài khi hội thoại còn thẻ giữ.
Chỉ **im mà không gắn gì** mới đáng lo.

Bảng đúng/sai từng kịch bản: `docs/CAU_HOI_THU_BOT.md`.
Log lõi bot đầy đủ: `botlog/dien_kich_ban.log`.
