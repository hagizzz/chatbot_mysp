# Bản chốt thiết kế — AI HTK BOT (MYS.P)

> Tài liệu này tổng hợp tất cả những gì đã thống nhất. Mục tiêu: duyệt xong là bắt tay code Giai đoạn 1.

---

## 1. Nguyên tắc cốt lõi

- **Tách code khỏi kịch bản.** Code là "động cơ" chung, không chứa lời thoại bán hàng. Mọi giọng văn, quy trình, luật xử lý nằm ở lớp kiến thức sửa được không cần deploy.
- **Một schema chuẩn 2026.** Code map cột theo *tên tiêu đề* (row 1), không hardcode chữ cái cột → sheet nào đúng phom 2026 là chạy; các sheet cũ sửa tới đâu đúng tới đó.
- **Bám đúng 1 sản phẩm.** Bot không tự gợi ý mẫu/màu khác; chỉ tư vấn mẫu tương tự **khi khách chủ động hỏi**.
- **Không bịa.** Chỉ dùng dữ liệu có trong sheet. Thiếu dữ liệu hoặc không chắc → bàn giao người thật.
- **An toàn ưu tiên.** Mọi tình huống nhạy cảm (thanh toán, khiếu nại, hủy đơn, khách cáu) → gắn thẻ chờ người thật, không tự quyết.

---

## 2. Kiến trúc pipeline (6 tầng)

`Pancake adapter → State store → Hiểu ý khách → Resolve sản phẩm → Soạn trả lời → Gửi qua Pancake`

Mỗi tầng tách bạch, một nguồn sự thật duy nhất cho trạng thái.

---

## 3. Nguồn dữ liệu & nơi lưu

| Nội dung | Nơi lưu | Ai sửa | Cách nạp |
|---|---|---|---|
| Catalog sản phẩm | Google Sheet — **tất cả tab hàng hoá** | Nhân viên | Sheets API, map theo tên cột, cache RAM |
| Luật tình huống (Bật/Tắt) | Tab **AI AGENT** | Nhân viên | Chỉ nạp dòng cột F = "Bật" |
| Kịch bản chính (persona, quy trình) | **Google Doc** | Nhân viên | Docs API, cache RAM, có bản dự phòng trong code |
| Ảnh sản phẩm | Google Drive (tên = mã) | Nhân viên | Build sẵn index ảnh theo mã |

**Tab catalog sẽ nạp:** Mẫu 2026, Mẫu 2025, Đồ Nam 2026, NY SAKI, KID, Túi 2025 *(chờ bạn xác nhận đủ chưa)*.
**Tab bỏ qua:** AI AGENT, Quy định, Thông số chung, Trang tính85.

---

## 4. Bản đồ cột chuẩn 2026

Mã `B` · Chủng loại `D` · Tên `G` · Giá gốc `H` · Giá KM `K` · BST/mùa `L` · Tồn cho AI `M` · Màu `N` · Size `O` · Chất liệu `P` · Mô tả `Q` · Khóa `R` · Độ co giãn `S`.

> Loader map theo *tên header* nên các tab layout cũ (chất liệu ở T/U/V/W) vẫn đúng miễn tiêu đề khớp.

---

## 5. Resolve sản phẩm (thứ tự ưu tiên)

1. Khách gõ **mã** trong text → tra sheet.
2. Khách gửi **ảnh** → vision (perceptual hash) so khớp catalog → ra mã.
3. Khách gõ **tên** sản phẩm (cột G) → dò trong catalog.
4. Không có gì mới → dùng **sản phẩm trong bộ nhớ** (mẫu đang nói).
5. Vẫn không ra → hỏi khéo khách gửi lại ảnh.

- **Vision không chắc 100%** → không đoán, bàn giao người thật (theo luật `image_mismatch` + kịch bản mục 4).
- **Nhiều ảnh cùng lúc** → xử lý theo **từng block riêng**, mỗi mẫu một tin: thông tin + ảnh của đúng mẫu đó, câu dẫn dắt chỉ đặt ở block cuối (kịch bản mục 15).
- **Tách mã từ tên ảnh:** cắt tại dấu cách / `_` / `-` đầu tiên sau khi bỏ đuôi, viết hoa. (Mã viết liền, không separator giữa.)

---

## 6. Bộ nhớ hội thoại

**Một nguồn duy nhất** (thay 2 hệ thống đang giẫm chân nhau — dùng SQLite cho an toàn khi ghi đồng thời).

Lưu mỗi hội thoại: `size`, `phone`, `address`, `currentProduct`, `quotedProducts[]`, `stage`, `lastBotReply`, `botMessageIds[]`.

**Nguyên tắc:** đã có size/địa chỉ/SĐT trong lịch sử thì **tuyệt đối không hỏi lại** (kịch bản mục 7 + luật `no_repeat*`, `customer_history`). Đổi mẫu giữa chừng → xoá context mẫu cũ nhưng **giữ** size/phone/address.

---

## 7. AI trả về `{reply, action}` — không chỉ text

Đây là thay đổi cốt lõi để bộ luật chạy thật. AI sinh ra **câu trả lời + một hành động** cho code thực thi:

| action | Code làm gì |
|---|---|
| `NONE` | Chỉ gửi text |
| `SEND_IMAGES` | Gửi tối đa 3 ảnh của mã (v1: ảnh bất kỳ) |
| `TAG_HUMAN` | Gắn thẻ "AI chờ xử lý" trên POS + dừng bot |
| `PAUSE` | Tạm ngừng (khách hỏi ảnh thật/video thật...) |
| `CREATE_ORDER` | Lên đơn POS (1 sản phẩm/đơn) — *giai đoạn sau* |

---

## 8. Phân tầng trả lời

- **Câu cố định** (lấy nguyên văn từ sheet/kịch bản): chờ xử lý, chính sách ship/đổi trả, số tài khoản, 3 địa chỉ, giờ mở cửa 8h30.
- **AI tự soạn** (có grounding bằng dữ liệu sheet): tư vấn sản phẩm, báo giá, dẫn dắt, xử lý phân vân — tự nhiên, không robot, mỗi câu có đúng 1 câu dẫn dắt.

---

## 9. Phân biệt người thật vs bot (luật pause 5 phút)

Cả nhân viên lẫn bot gửi tin dưới danh nghĩa Page nên không phân biệt được sẵn. Giải pháp: bot **lưu id mọi tin nó gửi**; tin nào phía shop mà *không* nằm trong danh sách đó = người thật → bot **ngừng 5 phút** kể từ tin cuối của người thật, chỉ tiếp tục khi khách nhắn mới sau 5 phút (luật `human_replied`, `ai_resume`).

---

## 10. Giá, size, chốt đơn

- **Giá:** có giá KM (cột K) thì nói "Giá gốc X, đang giảm còn Y"; không có thì báo giá gốc H.
- **Size:** bảng chuẩn S 40–48kg / M 49–55kg / L 56–59kg / Freesize 42–57kg. Hai trạng thái: chưa có size → hỏi; đã có size → dùng luôn, không hỏi lại. Tư vấn chỉ 1 size, không đưa nhiều lựa chọn.
- **Chốt đơn:** đủ **3 thông tin** (SĐT + địa chỉ + size) mới chốt. Mỗi sản phẩm một lệnh đơn riêng. Tin xác nhận đủ: mã, size, COD; kết thúc có lời chúc.

---

## 11. An toàn / bàn giao người thật (→ `TAG_HUMAN`)

Khách báo đã chuyển khoản · hỏi shop nhận tiền chưa · khiếu nại nhận hàng lỗi · đòi trả/hoàn tiền · hủy đơn · đổi địa chỉ sau khi lên đơn · hỏi tình trạng vận đơn · cần gấp/cam kết thời gian · **khách cáu / dùng từ tiêu cực** (xin lỗi nhẹ rồi bàn giao) · thiếu dữ liệu sản phẩm · ảnh không khớp 100% · hỏi thông tin khách khác / nội bộ shop (từ chối lịch sự).

---

## 12. Các bug hiện tại sẽ sửa

1. Gộp 2 hệ thống bộ nhớ thành một (đang ghi đè lẫn nhau → mất trí nhớ).
2. Sửa lỗi biến `reply` trong nhánh nhiều ảnh (đang ném lỗi, bot im lặng).
3. `spawnSync` → bất đồng bộ (đang chặn cả bot khi nhận diện ảnh).
4. Catalog đọc vào RAM + refresh (đang quét cả sheet mỗi tin → chậm, dễ hết quota).
5. Thêm cột R (khóa) và S (độ co giãn) vào lookup.

---

## 13. Chia giai đoạn

**Giai đoạn 1 — Vá để chạy ổn định:** gộp state, sửa bug nhiều ảnh, async vision, thêm cột R/S. Bot đang chạy không bị sập.

**Giai đoạn 2 — Tối ưu lõi + nền kiến trúc mới:** cache catalog (header-mapping, multi-tab), gộp pipeline hiểu-ý một chỗ, cơ chế `{reply, action}`, nạp kịch bản từ Google Doc + AI AGENT, phân biệt người thật/bot, interface AI **provider-agnostic** (đổi OpenAI/Claude bằng 1 biến `.env`).

**Giai đoạn 3 — Nâng cao:** gửi ảnh đúng màu, mẫu tương tự (`similar_product`) lọc theo mùa, chăm sóc lại sau 12h/24h, lên đơn POS tự động, A/B test OpenAI vs Claude bằng dữ liệu thật.

---

## 14. Cần verify với API Pancake/POS (trước Giai đoạn 2–3)

- Gửi **ảnh/attachment** cho khách qua public API.
- **Gắn thẻ** hội thoại trên POS (cơ chế bàn giao người thật).
- **Tạo đơn** trên POS.
- Service account: **đổi key đã lộ** + cấp scope đọc cả Sheets và Docs.

---

## 15. Còn treo (không chặn Giai đoạn 1)

- Xác nhận đủ danh sách tab catalog cần nạp.
- Chốt model AI (để provider-agnostic test sau).
- Phân loại ảnh theo màu (để Giai đoạn 3).
