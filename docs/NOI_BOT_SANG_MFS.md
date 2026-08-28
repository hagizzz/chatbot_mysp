# Nối bot sang mfs — thay Pancake ở phần hội thoại

Viết ngày 24/08/2026.

## Đổi nguồn bằng một dòng

```dotenv
NGUON_TIN=mfs          # hoặc: pancake (mặc định, giữ nguyên hành vi cũ)

MFS_API_URL=http://localhost:3000/v1
MFS_EMAIL=bot@shopmau.vn
MFS_PASSWORD=...
```

Không khai `NGUON_TIN` thì bot chạy y như trước qua Pancake. Đây là chốt an
toàn có chủ ý: đưa mã này lên máy shop không làm đổi hành vi cho tới khi ai đó
cố ý bật.

Kiểm lớp nối mà **không** phải chạy cả con bot:

```bash
node thu_mfs.js          # đọc, gửi tin, gắn thẻ, gỡ thẻ
node thu_mfs.js --anh    # thêm đường ảnh (tải lên kho mfs)
```

## Nó nối ở đâu

Lõi bot là `bot_worker_api_v3.js`, **12.7k dòng, không có `module.exports`** —
không gọi rời từng hàm được. Nhưng toàn bộ việc đọc và gửi của nó đi qua đúng
hai cửa: `require("./pancake_reader")` và `require("./pancake_sender")`. Nên
chỗ nối nằm đúng hai dòng đó, không phải rải khắp lõi.

```
bot_worker_api_v3.js
   │  NGUON_TIN=pancake ──> pancake_reader.js / pancake_sender.js ──> pages.fm
   └─ NGUON_TIN=mfs     ──> mfs_reader.js     / mfs_sender.js     ──> mfs API
                                    └── mfs_client.js (đăng nhập, token, quy đổi thẻ)
```

`mfs_sender.js` xuất **đúng 23 tên hàm**, `mfs_reader.js` xuất **đúng 5**, cùng
tên và cùng hình dạng dữ liệu trả về. Lý do phải khớp tuyệt đối: lõi bot gọi
`sendInboxMessage` **241 lần** và `tagChoXuLyVaUnread` **67 lần**; lệch một chữ
là phải sửa từng chỗ.

| Việc | Pancake | mfs |
|---|---|---|
| Đọc danh sách | `GET /pages/:id/conversations` | `GET /v1/conversations` |
| Đọc tin | `GET .../messages` | `GET /v1/conversations/:id/messages` |
| Gửi tin | `POST .../messages` | `POST /v1/conversations/:id/messages` |
| Gắn thẻ | `POST .../tags` thẻ số 182/183 | `POST /v1/conversations/:id/tags` thẻ UUID |
| Chưa đọc | `POST .../unread` | `POST .../read {read:false}` + `.../handled {handled:false}` |
| Ghi chú | ô ghi chú của hội thoại | ghi chú ở **hồ sơ khách** (`PATCH /v1/customers/:id`) |
| Đơn hàng | `pos.pages.fm` | **vẫn `pos.pages.fm`** — mfs cũng đẩy sang POS |

**Đơn hàng không đổi.** "Bỏ Pancake" chỉ đúng với phần hội thoại; Pancake POS
vẫn là hệ thống đơn, nên `pos_client.js`, `order_worker.js`, `hang_doi_don.js`
giữ nguyên, không đụng tới.

## Ba chỗ phải dịch, không phải chép

### 1. Ảnh — chỗ tốn công nhất

Pancake nhận `content_id` (ảnh đã nằm sẵn trong kho Pancake). mfs chỉ nhận
`storageKey` — tệp phải nằm trong kho của mfs trước. Nên đường đi thành:

```
content_id ──(hash_index.json)──> URL Drive ──(tải về)──> POST /v1/uploads ──> storageKey
```

Kết quả tải lên được nhớ theo URL trong `data/mfs_anh_da_tai.json`. Không nhớ
thì mỗi lượt khách hỏi giá là một lần tải vài MB lên kho, cùng tấm ảnh, mỗi
ngày vài trăm lần. Đã đo trong bài thử: gửi lại cùng ảnh, số lần tải lên giữ
nguyên 1.

Được thêm một thứ Pancake không cho: mfs gửi **chữ và nhiều ảnh trong cùng một
tin** (`groupImages`), nên khách thấy một nhóm ảnh thay vì ba tin liên tiếp.

### 2. Thẻ — số đổi thành UUID

Pancake đánh số thẻ toàn hệ thống (182 = "AI chốt", 183 = "AI chờ xử lý").
mfs cấp UUID riêng cho từng shop, nên không thể ghi cứng. Bot gọi theo **vai
trò**, tên thẻ khai trong `.env`, UUID tra một lần rồi nhớ:

```dotenv
MFS_THE_CHO_NGUOI_THAT=Chờ người thật
MFS_THE_AI_CHOT=Đã chốt đơn
MFS_THE_XU_LY_ANH=Ảnh chưa nhận ra
MFS_THE_DON_UU_TIEN=Đơn ưu tiên
MFS_THE_GUI_DON_GAP=Gửi gấp
```

Thẻ chưa có thì bot tạo luôn. Bắt người dùng vào giao diện tạo tay năm cái thẻ
trước khi bot chạy được là một bước thừa, mà tên thì đã nằm trong `.env` rồi.

### 3. "Chưa đọc" không còn là một thứ

mfs tách **trạng thái đọc** khỏi **trạng thái xử lý** (mục 6 của nó): đọc rồi
mà chưa trả lời thì vẫn là "chờ xử lý". Pancake chỉ có "chưa đọc". Nên
`markUnread` của bot gọi **cả hai**: `read=false` cho giống hành vi cũ, và
`handled=false` — cái sau mới là hàng đợi thật của nhân viên trong mfs.

## Những thứ mfs CHƯA làm được, đã chốt chứ không giấu

| Mất gì | Vì sao | Hậu quả thật |
|---|---|---|
| Trả lời bình luận | mfs chưa có API bình luận | `replyComment` trả `success:false` — bot sẽ nhường người thật thay vì im lặng. Lõi gọi 3 chỗ. |
| Trả lời riêng dưới bình luận | như trên | `sendPrivateReply` tương tự, 3 chỗ |
| Ảnh/caption bài viết | mfs không đi lấy bài Facebook | Nhánh đoán mẫu **từ ảnh bài viết** không chạy. `postImages` rỗng, `postCaption` rỗng. |
| Tên/ảnh quảng cáo | mfs lưu `ad_id` nhưng không lưu creative | `adTitle`, `adPhotoUrl` rỗng. `adId` thì có (xem dưới). |

Bốn dòng này đều là **mất tính năng thật**, không phải chi tiết kỹ thuật. Nếu
shop đang sống nhờ khách từ bình luận thì phải làm phần bình luận trong mfs
trước khi chuyển hẳn.

## Một chỗ đã vá bên mfs

`GET /v1/conversations/:id` trước đây **không trả `adId`** ra ngoài dù cột
`conversations.ad_id` có dữ liệu. Bot dùng `adId` để tra `ad_learned_map.json`
(1.118 bản đồ quảng cáo → sản phẩm); thiếu nó thì mọi khách đến từ quảng cáo
đều thành "không rõ quảng cáo nào" và bot mất đường đoán mẫu.

Đã thêm `adId` và `botTakenOverAt` vào `findOne()` của
`apps/api/src/modules/conversations/conversations.service.ts`. Typecheck xanh.

## Một cái bẫy chưa gỡ

**mfs đóng dấu `senderType: 'agent'` cho MỌI tin gửi qua API — kể cả tin của
bot** (`messages.service.ts` ghi cứng), và **mỗi lần gửi lại đặt
`botTakenOverAt = now()`** với ý "người thật vừa vào, bot ngừng".

Nghĩa là bot tự gửi tin xong sẽ tự đánh dấu là bị chiếm quyền. Hai trường đó
hiện **không dùng được** để phân biệt người thật với bot.

Chưa hỏng gì, vì bot vốn đã tự lo việc này từ thời Pancake: nó nhớ id mọi tin
nó gửi (`botMessageIds`), tin nào phía shop mà không nằm trong danh sách đó thì
là người thật → ngừng 5 phút. Cơ chế đó chuyển sang mfs nguyên vẹn, và bài thử
đã xác nhận `message_id` trả về lúc gửi khớp đúng id đọc lại được.

Nhưng đây là chỗ nên sửa ở mfs khi làm module bot: cho `POST /messages` nhận
`senderType: 'bot'`, và **không** đặt `botTakenOverAt` khi người gửi là bot.

## Cần gì trước khi chạy thật

1. **Tài khoản riêng cho bot** trong mfs, đừng dùng `admin@shopmau.vn`. Mọi
   thao tác của bot đều vào nhật ký kiểm toán dưới tên tài khoản đó — dùng
   chung tài khoản người thật thì không truy được ai làm gì.
2. **Gán Page cho tài khoản bot.** mfs mặc định **từ chối**: tài khoản chưa
   được gán Page nào thì thấy **0 hội thoại**, và không có lỗi nào hiện ra —
   bot chỉ đơn giản là không thấy việc.
3. **Quyền `conversations.history`** — thiếu là không đọc được lịch sử tin.
4. Bot đăng nhập lại mỗi ~14 phút (token mfs sống 15 phút, không có token dài
   hạn cho máy). Mỗi lần là một phiên mới trong nhật ký; đó là chuyện bình
   thường, không phải dấu hiệu bị dò mật khẩu.
