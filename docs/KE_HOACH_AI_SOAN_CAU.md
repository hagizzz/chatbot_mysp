# Kế hoạch: cho AI soạn câu mà vẫn giữ độ chính xác

Viết ngày 25/08/2026. Đọc `docs/BOT_HOAT_DONG_THE_NAO.md` trước để biết bot đang chạy thế nào.

---

## 1. Vấn đề

Hôm nay khách đang chat với một thư viện ~214 câu viết tay nằm thẳng trong
`bot_worker_api_v3.js`. Code chọn đúng câu theo tình huống rồi điền số liệu thật từ catalog.

Ưu: không bao giờ bịa. Nhược:

- **Lặp câu** — khách hỏi ba lần thấy y hệt một câu.
- **Thủng chỗ chưa dạy** — không nhánh nào nhận thì nhường người thật, dù câu đó rất dễ trả lời.
- **Sửa câu phải sửa mã** — 214/241 điểm gửi tin chưa có khoá kịch bản.

Cách sai để chữa: bật `AI_REPLY_MODE=on`. Cách đó chỉ đổi câu hỏi từ *"bot có trả lời được
không"* thành *"bot vừa nói gì với khách vậy"*.

---

## 2. Nguyên tắc: AI diễn đạt, không phải AI trả lời

Rủi ro thật không nằm ở chỗ AI viết chữ — nằm ở chỗ **AI quyết định sự thật**: giá bao nhiêu,
còn hàng không, size nào vừa, chính sách thế nào.

Nếu code đã chốt xong toàn bộ dữ kiện và AI chỉ có việc gói chúng thành câu tiếng Việt tử tế,
rủi ro tụt xuống mức **kiểm được bằng máy**, không phải mức "hy vọng nó không bịa".

```
code quyết  →  { hành động, dữ kiện, được nói, cấm nói, giọng }   ← PHIẾU DỮ KIỆN
                          ↓
                   AI diễn đạt thành câu
                          ↓
              BỘ SOI: mọi số/sự kiện trong câu phải nằm trong phiếu
                          ↓
            đạt → gửi        |        không đạt → dùng câu template gốc
```

**Chặn thì không mất gì** — rơi về đúng câu template hôm nay đang dùng. Sàn chất lượng không
bao giờ thấp hơn hiện tại, chỉ có trần cao lên.

---

## 3. Chia ba đường theo mức rủi ro

### Đường A — câu chạm số/chính sách · GIỮ NGUYÊN CODE

Giá, tồn, ship, size, đơn, hoàn/đổi. Không cho AI đụng, kể cả để "viết lại cho mượt".
Đây cũng là chỗ template không hề dở — khách không cần câu báo giá bay bổng.

### Đường B — câu thuyết phục/đồng cảm không chạm số · AI SOẠN

Trấn an chất liệu, lo màu tối, sợ không hợp dáng, khách chê chậm, khách hẹn sau.
Chỗ template lộ rõ nhất và rủi ro thấp nhất. **Làm trước.**

### Đường C — câu chưa ai dạy · AI SOẠN, MỞ SAU

Hiện nhường người thật 100%. Chỗ AI đem lại giá trị lớn nhất về tỉ lệ trả lời.
Chỉ mở sau khi B chạy ổn và đo được, và chỉ khi AI **trích được căn cứ** trong kịch bản.

---

## 4. Phiếu dữ kiện

Không đưa AI cả hội thoại rồi bảo "trả lời đi". Code lập phiếu trước:

```js
const phieu = {
  y_dinh:   "TRAN_AN_HOP_DANG",
  su_that:  { ma: "MGKVX01", ten: "Celyne", mau: "be", chieu_cao_mau: "1m62" },
  duoc_noi: ["form Việt", "không kén dáng", "xin số đo để tư vấn"],
  cam_noi:  ["giá", "tồn kho", "thời gian giao", "hoàn/hủy", "so sánh shop khác"],
  giong:    "xưng em, gọi chị, 1-2 câu, không quá 45 chữ",
  cau_goc:  "<câu template hôm nay đang gửi — dùng lại khi bộ soi chặn>"
};
```

AI trả về `{ cau, can_cu }`, không được trả gì khác.

---

## 5. Bộ soi — bốn phép kiểm, chạy bằng code, không cần người đọc

| # | Phép kiểm | Chặn khi |
|---|---|---|
| 1 | **Số phải khớp phiếu** | Trích mọi con số trong câu, so với tập số trong `su_that`. Có số lạ → chặn |
| 2 | **Bắt buộc trích căn cứ** | `can_cu` phải khớp một đoạn CÓ THẬT trong kịch bản/catalog (so chuỗi đã chuẩn hoá) |
| 3 | **Danh sách cấm nói** | Câu dính chủ đề trong `cam_noi` → chặn cứng, không tuỳ AI phán đoán |
| 4 | **Trần độ dài + giọng** | Quá dài, sai xưng hô, có link/emoji lạ → chặn |

Phép 1 **mạnh hơn `reply_guard` hiện tại**: `reply_guard` chặn *mọi* con số, nên câu nào có
số cũng chết. Phép 1 cho đúng số đi qua — nhờ vậy đường B mới nói được "1m62" mà vẫn an toàn.

Hàm chuẩn hoá chuỗi để so ở phép 2 đã có sẵn: `nguon_cau.chuanHoa`.

---

## 6. Các bước — làm tuần tự, mỗi bước đo xong mới sang bước sau

| Bước | Việc | Đo bằng gì | Trạng thái |
|---|---|---|---|
| **0** | Vá lỗ `askImages` — câu AI tự soạn lọt qua cổng khi lượt đó có gửi ảnh | `npm test` (test mới) | ✅ xong 25/08/2026 |
| **1** | Dời câu viết cứng vào `kho_kich_ban`, mỗi ý 2–3 biến thể quay vòng (`_rotLine` đã có) | `npm run thong-ke-nguon` — tỉ lệ câu có khoá phải lên | 🔸 thí điểm xong (7 khoá của 3 nhãn); còn ~207 câu |
| **2a** | Dựng `soi_cau_ai.js` — bộ soi 4 phép, thuần, test offline | 18 test, gồm cả ca **chặn oan** | ✅ xong 25/08/2026 |
| **2b** | Gọi AI diễn đạt + chạy **shadow** trên 3 nhãn: `FIT_SUITABILITY`, `QUALITY_CONCERN`, `DEFER_DECISION` | % câu bị chặn; đọc tay 100 câu bị chặn xem chặn đúng hay chặn oan | ⬜ |
| **3** | Bật thật 3 nhãn đó | Tỉ lệ nhường người (phải giảm), số ca nói sai sự thật (phải bằng 0) | ⬜ |
| **4** | Mở dần sang đường C, mỗi lần một nhóm nhãn | Bộ ca vàng phát lại (`npm run ca-vang`) trước mỗi lần mở | ⬜ |

**Bước 1 đáng làm kể cả nếu cuối cùng không bật AI** — nó tự giải quyết chuyện lặp câu, và
phiếu dữ kiện ở bước 2 cần biết "câu này vốn định nói gì" (`cau_goc`) nên dù sao cũng phải
làm trước.

---

## 7. Điều kiện bắt buộc trước khi bật thật

Cái giá của kế hoạch này không phải tiền AI (thêm 1 lượt gọi/lượt, từ tối đa 2 lên 3 — nhỏ so
với giá trị một đơn). Cái giá là **độ khó gỡ lỗi**.

Hôm nay lỗi là "nhánh nào bắn câu này" — `nguon_cau` tra ra `tệp:dòng` trong hai giây.
Ngày mai lỗi thành "vì sao AI viết vậy".

→ Mỗi lượt đường B/C **bắt buộc** ghi vào `turn_log`: nguyên phiếu dữ kiện + câu AI trả +
kết quả từng phép soi. Thiếu cái này thì không được bật.

---

## 8. Nhật ký thi hành

### Bước 0 — vá lỗ `askImages` · xong 25/08/2026

**Lỗ:** cổng chặn câu AI tự soạn (`bot_worker_api_v3.js`, khối `(a4)`) có điều kiện
`!askImages`. Nên mỗi khi lượt đó có gửi ảnh (khách xin xem ảnh + đang khoá một mẫu), câu AI
tự soạn đi thẳng tới khách, **không qua bộ soi, bất kể `AI_REPLY_MODE=off`**.

Hệ quả: công tắc `off` không thật sự off → mọi số đo ở các bước sau đều nói dối.

**Vá:** cổng nay áp cho MỌI câu AI tự soạn. Khác biệt duy nhất là hình phạt:

- không gửi ảnh → nhường người thật (như cũ)
- **có** gửi ảnh → vẫn gửi ảnh, chỉ **thay câu dẫn** bằng phom cố định (`dan_gui_anh` trong
  kho kịch bản) — không giết luồng ảnh

Kèm theo: chốt `GREETING` bên trong cổng phải thêm `!askImages`, nếu không khách chào kèm
xin ảnh sẽ bị nuốt mất loạt ảnh.

Test: `test/cong_ai_tu_soan.test.js`.

### Bước 1 (thí điểm) — rút 7 câu của 3 nhãn vào kho · xong 25/08/2026

Rút đúng phần mà bước 2 cần `cau_goc`:

| Khoá | Dùng ở |
|---|---|
| `tran_an_chat_luong` (3 biến thể, xoay vòng) | `buildReassureReply` |
| `tran_an_ngoai_doi` (2 biến thể, xoay vòng) | `buildLooksReassure` |
| `tran_an_hop_dang__co_so_do` / `__co_thong_so` / `__chua_co_gi` | nhãn `FIT_SUITABILITY` |
| `tham_khao_them__co_gui_anh` / `__khong_gui_anh` | nhãn `DEFER_DECISION` |
| `dan_gui_anh` | khối `(a4)`, bước 0 |

**Bài học:** lần rút đầu tiên tôi để lại bản sao viết cứng làm "phom code đỡ" —
`test/kho_kich_ban.test.js` chặn ngay. Quy ước của dự án: rút vào kho thì **xoá hẳn** bản
trong mã, kho hụt thì `vetTruocKhiGui` chặn không gửi. Thà không nhắn còn hơn nhắn câu cũ mà
shop tưởng mình đã sửa.

Còn lại ~207 câu. Rút tiếp theo cụm, mỗi cụm chạy `npm test` + `npm run soi-kich-ban`.

### Bước 2a — bộ soi `soi_cau_ai.js` · xong 25/08/2026

Bốn phép kiểm như mục 5. Điểm khác `reply_guard`: **cho phép đúng số trong phiếu**, chặn số lạ.

Hai lỗi tìm ra ngay khi dựng, cùng một gốc — **ranh giới `\b` của JS là ranh giới ASCII, không
hiểu chữ tiếng Việt**:

- `/\bk\b/` (định bắt "990k") khớp chữ "k" trong **"kén"** — vì sau "k" là "é", ASCII coi là
  ranh giới. Hậu quả: câu lành *"không kén dáng"* bị kết tội nói GIÁ.
- `/\bchị\b/` **không bao giờ** khớp "chị" — nên phép kiểm xưng hô kết tội mọi câu.

Cả hai đều là chặn oan, và chặn oan thì bật AI cũng như không. Nay dùng ranh giới Unicode
`(?<![\p{L}\p{N}])`. Đây là lý do bộ test phải có **cả ca cho-qua**, không chỉ ca chặn — nếu
chỉ test ca chặn thì 14/14 xanh và lỗi này lọt thẳng ra khách.

Test: `test/soi_cau_ai.test.js` (18 ca). Toàn bộ: 305 test xanh.
