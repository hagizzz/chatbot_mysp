# Kịch bản đang nằm ở đâu — và cách kéo nó về một chỗ

Viết ngày 24/08/2026. Đọc file này khi cần trả lời: *"sửa câu bot nói ở đâu?"*,
*"tại sao sửa Google Doc mà bot không đổi?"*, hoặc trước khi bắt tay vào GĐ3
(trang quản trị).

---

## 1. Chẩn đoán

Kịch bản của bot đang nằm rải ở **7 nơi**, thuộc 3 cấp quyền sửa khác nhau:

| # | Nơi | Ai sửa được |
|---|---|---|
| 1 | Google Doc (`knowledge_loader.js`) | người kinh doanh |
| 2 | `kich_ban/luat.txt` — bản dự phòng khi mất mạng (có `luat.<shopId>.txt` riêng từng shop) | kinh doanh |
| 3 | Google Sheet, tab `AI AGENT` | người kinh doanh |
| 4 | `reasoning_engine.js` — ~270 dòng luật trong prompt | lập trình viên |
| 5 | `bot_worker_api_v3.js` — 442 dòng câu viết cứng | lập trình viên |
| 6 | `ai_intent.js`, `ai_quyet.js` — prompt phân loại / quyết định | lập trình viên |
| 7 | `khuyen_mai.json`, `material_advice.json`, `mau_dict.json`… | nửa nọ nửa kia |

Ba vấn đề, tất cả đều đo được trên bản đang chạy:

**a) Thứ tự ưu tiên ngược.** `bot_worker_api_v3.js` chạy ~8.000 dòng gồm 85 hàm
dò ý và 71 nhánh `if` **trước**, mãi tới dòng ~12.100 mới gọi `reasoning()` —
tức là kịch bản Doc chỉ là lưới đỡ cuối cùng. Câu hỏi nào có nhánh cứng (giá,
size, màu, ship, đổi trả, showroom, chuyển khoản, giảm giá…) thì kịch bản không
bao giờ được đọc tới.

**b) `.env` đang đặt `AI_REPLY_MODE=off`.** Ở chế độ này, câu do AI soạn theo
kịch bản bị đổi thành `TAG_HUMAN` — **không bao giờ gửi cho khách**. Nên phần
kịch bản Doc thực sự chi phối hành vi còn nhỏ hơn nữa.

**c) Hai nguồn sự thật đánh nhau.** Bằng chứng nằm ngay trong mã: `kich_ban/luat.txt`
khai tên "Bảo Châu", code khai "Bảo Trâm", và prompt phải tuyên bố *"tên này ƯU
TIÊN HƠN mọi tên khác trong kịch bản"* mới thắng được. Kịch bản ghi `Không dùng
từ "giữ"` mà code có 15 câu nhắn khách dùng đúng từ đó.

Hệ quả với kế hoạch: **GĐ3 (trang quản trị, 15–20 người-ngày) sẽ gần như vô dụng
nếu làm trước khi rút nhánh cứng** — shop sửa được Doc và Sheet, nhưng phần lớn
câu bot thật sự nói ra nằm ngoài tầm với.

---

## 2. Bước 1 — Đo trước, đừng đoán

```bash
npm run thong-ke-nguon          # 7 ngày gần nhất
node thong_ke_nguon.js 30 --top 40
```

`turn_log.js` giờ gắn **nguồn** cho từng tin bot gửi đi:

| Nguồn | Nghĩa là |
|---|---|
| `nhanh_cung` | câu viết cứng trong mã — kèm đúng `tệp:dòng` |
| `ai_tu_do` | AI soạn theo kịch bản Doc + tab AI AGENT |
| `ai_quyet` | tầng AI-QUYẾT tự soạn |
| `luat_sheet` | câu lấy thẳng từ tab AI AGENT |
| `khong_ro` | chưa truy được |

Cách làm (`nguon_cau.js`) — **không phải sửa 442 chỗ viết cứng**:

1. Ai soạn câu thì tự khai (`turnLog.nguonCau(...)`). Lời khai bị **loại** nếu
   code đè lại câu khác — không đếm nhầm công cho kịch bản.
2. Không ai khai thì **dò vân chữ**: quét sẵn mọi chuỗi trong mã nguồn, lấy đoạn
   tĩnh dài nhất làm vân tay, soi câu vừa gửi xem trùng vân của dòng nào.

Báo cáo trả về hai con số quyết định mọi thứ phía sau: **kịch bản với tới bao
nhiêu %**, và **nhánh cứng nào đẻ ra nhiều câu nhất** — đó chính là thứ tự phải
rút, không làm theo cảm tính.

---

## 3. Bước 2 — Chốt một nguồn sự thật

**Tên bot.** Giờ nằm ở `danh_tinh_bot.js`, đổi qua biến môi trường `TEN_BOT`.
`bot_worker` và prompt của `reasoning_engine` đều đọc về đó. `kich_ban/luat.txt` đã
bỏ dòng khai tên. Có test chặn việc viết cứng lại.

> Google Doc thật vẫn có thể còn dòng "Tên: Bảo Châu" — phía kinh doanh cần xoá
> dòng đó khỏi Doc. Bộ soi ở dưới sẽ kêu nếu chưa xoá.

**Bộ soi mâu thuẫn.**

```bash
npm run soi-kich-ban            # đọc Doc nếu có khoá
node soi_kich_ban.js --local    # ép dùng kich_ban/luat.txt, không gọi mạng
```

Nó đọc các luật máy kiểm được ra khỏi kịch bản (`Không dùng từ "X"`, khai tên)
rồi soi ngược lại trên **chính những câu code sẽ nhắn khách**. Trả mã thoát 1
nếu có mâu thuẫn nặng → cắm được vào quy trình phát hành.

Kết quả hiện tại: 20 câu dùng từ "bạn", 15 câu dùng từ "giữ" — cả hai đều bị
kịch bản cấm.

**Ranh giới "code lo số / kịch bản lo lời".** Nguyên tắc này đã được viết ở
`reasoning_engine` mục 0c3 và có sẵn bộ soi đủ 9 luật (`reply_guard.js`), nhưng
trước đây **chỉ chặn ở một đường**. Đường AI-QUYẾT chỉ có một dòng regex bắt
`…đ/vnđ`, để lọt `990k`, `freeship`, `đã lên đơn`, và cả số điện thoại.

Nay hai đường dùng **chung một bộ soi**, điều khiển bằng `RANH_GIOI_MODE`:

| Giá trị | Hành vi |
|---|---|
| `shadow` (mặc định) | chỉ ghi log câu vi phạm, **không đổi hành vi** |
| `on` | câu dính luật → thay bằng phom code |
| `off` | tắt hẳn, về đúng luật cũ |

Mặc định là `shadow` vì bot đang chạy thật: gom số liệu vài ngày, đọc log
`[RANH-GIỚI shadow]`, thấy sạch thì mới bật `on`.

---

## 4. Bước 3 — Rút nhánh cứng về Sheet

`kho_kich_ban.js` là đường rút. Ở nhánh cứng:

```js
return KB.cau("hang_gui_tu_dau");                    // lời nằm trong kho
return KB.cau("hang_gui_tu_dau", {}, "Dạ hàng …");   // kèm phom code đỡ lưng
```

Bốn tầng, tầng trên đè tầng dưới:

- Tab `AI AGENT` có dòng đúng khoá và đang **Bật** (cột F) → dùng câu ở cột D.
- `kich_ban/<shopId>.json` → riêng từng shop.
- `kich_ban/mac_dinh.json` → kịch bản gốc, mọi shop kế thừa.
- Phom code ở chỗ gọi → lưới cuối.

Câu ở Sheet dính tiền / sđt / chốt đơn / ship / tồn kho thì **bỏ**, dùng kịch
bản gốc. Luật này bật ngay từ đầu, không có chế độ bóng: đây là đường mới, chưa
có hành vi cũ nào để giữ. Gõ một cái giá vào Sheet thì tháng sau giá đổi mà câu
vẫn nói giá cũ.

**Tra hụt thì sao.** Không có phom code mà tra hụt kho, `KB.cau()` **không** trả
chuỗi rỗng — chuỗi rỗng là thứ trôi lọt, nó ghép vào câu khác thành câu cụt rồi
tới khách mà không ai biết. Nó trả câu gắn **mốc hụt** (ký tự NUL, vô hình), và
cả ba hàm gửi tin (`sendInboxMessage`, `sendPrivateReply`, `replyComment`) gọi
`KB.vetTruocKhiGui()` để chặn, ghi log kèm đúng tên khoá bị hụt. Thà không nhắn
còn hơn nhắn câu cụt.

Kho cũng **giữ bản tốt**: tệp JSON hỏng giữa lúc bot đang chạy (shop tự sửa,
thiếu một dấu phẩy) thì kho giữ nguyên bản nạp được gần nhất và kêu log, chứ
không nạp đè bằng kho rỗng làm mọi khoá hụt cùng lúc. Sửa xong tệp là tự nạp
lại, không cần khởi động lại bot.

`getAgentRuleMap()` đã nằm sẵn trong `knowledge_loader.js` từ trước nhưng **chưa
nơi nào gọi** — giờ đã nối.

### Lô đã rút

| Khoá cần khai ở cột A | Thay cho |
|---|---|
| `hoi_size` | câu hỏi size — gom từ nhiều chỗ về một hàm `cauHoiSize()` |
| `hang_gui_tu_dau` | `buildShipOriginReply()` |
| `dia_chi_shop_mo` | câu dẫn trước danh sách showroom |
| `dia_chi_shop_moi` | câu mời ghé / chốt online sau danh sách |
| `bang_size_dan` | câu dẫn trước khi gửi ảnh bảng size |

Địa chỉ showroom vẫn do code dựng — đó là **dữ liệu**, không phải lời.

### Rút tiếp thế nào

1. `npm run thong-ke-nguon` → bảng xếp hạng theo câu bot **đã nói thật**. Cần
   bot chạy vài ngày sau khi cắm bộ đo; chưa có số thì nó nói thẳng là chưa có.
2. Chưa có số thì tạm dùng `node rut_kich_ban.js --xep-hang` — xếp hạng theo số
   câu **trong mã**, gom theo hàm và theo biển báo nhánh (`// ===== … =====`).
   Nó in sẵn dòng *"chỉ cần rút N/M nhóm là phủ 80%"*. Đọc số đó trước khi lập
   kế hoạch: hiện tại là **140/229 nhóm**, tức là không có nhánh nào béo để rút
   trước cho nhanh — câu rải đều, và việc rút sẽ dài chứ không có phím tắt.
3. Nhánh chỉ có chữ → rút thẳng. Nhánh có số (giá, tổng đơn, phí ship) → **tách
   đôi**: phần lời rút về Sheet, phần số để code dựng, như `buildShopAddressReply()`.
4. Mỗi lần rút xong: `npm test` và `npm run soi-kich-ban`.

---

## 5. Việc còn lại cho phía kinh doanh

| Việc | Vì sao |
|---|---|
| Xoá dòng khai tên khỏi Google Doc | còn để đó là vẫn hai nguồn sự thật |
| Sửa 2 luật cấm từ trong kịch bản, hoặc sửa 35 câu code | hiện đang mâu thuẫn, `npm run soi-kich-ban` liệt kê đủ vị trí |
| Khai 5 khoá ở lô đầu vào tab `AI AGENT` | chưa khai thì bot vẫn chạy bằng phom code, nhưng chưa được lợi gì |
| Quyết `AI_REPLY_MODE` | đang `off` nên kịch bản Doc gần như không tới được khách |
