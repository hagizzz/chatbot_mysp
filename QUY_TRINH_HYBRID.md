# QUY TRÌNH BOT MUSE WEAR — KIẾN TRÚC HYBRID (đã thống nhất)

## 1. NGUYÊN TẮC GỐC (không được phá)
1. **Chắc mới trả lời. Mơ hồ thì KHÔNG trả lời** → nhường người thật. Thà im còn hơn nói bậy mất khách.
2. **Soi CẢ CỤM, không bắt theo 1 từ.** Một từ rời ("size", "M", "gi") KHÔNG đủ để quyết — phải đủ tín hiệu.
3. **Xử TỪNG câu khách gửi.** Khách nhắn 2–3 tin thì duyệt từng tin, không chỉ lấy tin cuối.
4. **AI KHÔNG bao giờ chạm tiền, KHÔNG tự viết câu cho khách.** AI chỉ HIỂU, Code mới NÓI.

## 2. BA TẦNG — AI VAI TRÒ GÌ, CODE VAI TRÒ GÌ

```
Tin khách
   │
   ▼
[L1] REGEX có CHẤM ĐỘ CHẮC   ← rẻ, tức thì, ăn 70–80% ca rõ
   │   chắc (≥ ngưỡng) → nhãn
   │   mơ hồ (< ngưỡng) → KHÔNG_RÕ → đẩy xuống L2
   ▼
[L2] AI PHÂN LOẠI (chỉ nhả NHÃN)  ← chỉ chạy khi L1 mơ hồ
   │   chắc → nhãn ;  không chắc → KHÔNG_RÕ
   ▼
[L3] CODE HÀNH ĐỘNG
   │   có handler cho nhãn → template + DATA THẬT
   │   trạng thái đơn      → máy trạng thái (code)
   │   KHÔNG_RÕ / chưa dạy → NGƯỜI THẬT (AI-CHỜ XL)
```

- **L1 (Regex) = người gác cổng tỉnh táo.** Việc của nó KHÔNG phải "đoán cho bằng được", mà là *"chắc thì nhận, không chắc thì nhường"*. Mỗi nhánh trả về `{nhãn, độ_chắc, bằng_chứng}`.
- **L2 (AI) = người phiên dịch.** Chỉ đọc tin lộn xộn/sai chính tả ("chấy gi") rồi nói "ý này là HỎI_CHẤT_LIỆU". **Không** viết câu, **không** đụng giá/tồn. Output bị giới hạn trong **danh sách nhãn cố định** → không thể chế bậy. Không chắc → `KHÔNG_RÕ`.
- **L3 (Code) = người làm.** Cầm nhãn → bắn template có sẵn + data thật từ catalog. Quản đơn. Tính tiền. Đây là chỗ DUY NHẤT được tạo câu cho khách.

## 3. RANH GIỚI CỨNG (chống loạn)
- AI **chỉ được nhả 1 nhãn trong danh sách**. Không free-text. → không thể chế giá/tồn.
- AI **không chắc → KHÔNG_RÕ → người thật.** (Ép prompt: "thà KHÔNG_RÕ còn hơn đoán".)
- AI phải **trích bằng chứng** trong lời khách cho nhãn nó chọn; không trích được → KHÔNG_RÕ.
- **Code luôn kiểm chứng lại data** dù AI nói gì (vd nhãn ĐỊA_CHỈ_CUNG_CẤP nhưng tin không có số nhà/đường → KHÔNG lưu, đẩy người).

## 4. CÁI BẪY PHẢI TRÁNH
- **KHÔNG chia theo CHỦ ĐỀ** ("địa chỉ thì AI, giá thì regex") → 2 hệ tranh 1 tin → đẻ lỗi chộp-nhầm. 
- Chỉ chia theo **TẦNG (hiểu/làm)** và **THỨ TỰ (regex trước, AI sau)**.
- Nhánh **dễ tham lam** (size, đẩy-đơn, xin-địa-chỉ) phải **bắt buộc đủ tín hiệu** mới được nhận, nếu không thì nhường. Đặt nhánh **cụ thể** (chất liệu, ship, tổng tiền) **TRƯỚC** nhánh tham lam.

## 5. MÁY TRẠNG THÁI ĐƠN (việc của Code, AI không lo nổi)
Đơn có 3 trạng thái:
- `ĐANG_TƯ_VẤN` → `ĐÃ_CHỐT` → `ĐANG_THÊM_MẪU`
- Khi `ĐÃ_CHỐT` + khách "lên đơn thêm" → vào `ĐANG_THÊM_MẪU`:
  - **Chỉ xin info của mẫu MỚI** (size/màu nếu thiếu).
  - **Giữ nguyên** địa chỉ/sđt/mẫu cũ — KHÔNG hỏi lại.
  - **Append** mẫu mới vào cụm, KHÔNG ghi đè (chống lẫn tên/size: Celyne L ≠ Celia M).
  - Xong → **xác nhận lại TỔNG**, không tư vấn lại từ đầu.
- Nhánh "giao khu vực khác → xin lại địa chỉ": **chỉ bắn khi CHƯA có địa chỉ** hoặc khách **chủ động** đổi.

## 6. LỘ TRÌNH (toàn diện = theo giai đoạn, không tắt máy đang chạy)
- **GĐ1 (đang làm):** dựng `intent_router.js` — lớp L1 chấm-độ-chắc, soi-cả-cụm, xử-từng-câu; port toàn bộ nhãn cũ + nhãn mới (chất liệu/ship/tổng tiền/thêm mẫu). Có self-test.
- **GĐ2:** ráp router làm **cổng trước** trong bot, cho mấy nhánh tham lam "chỉ nhận khi chắc". Đo tỉ lệ chộp-nhầm trên log thật.
- **GĐ3:** thêm L2 (AI nhả nhãn) hứng phần KHÔNG_RÕ. Đo tỉ lệ AI nhét bừa.
- **GĐ4:** máy trạng thái đơn (gộp mẫu thêm, không đòi lại địa chỉ, không lan man sau chốt).
- Mỗi GĐ: test + đo + giữ nguyên luồng cũ làm lưới, AI dở thì tắt.

## 7. ĐO LƯỜNG (không tin cảm tính)
Mỗi thay đổi phải chạy trên **log chat thật** và đếm:
- Regex chộp nhầm bao nhiêu % (tưởng trúng mà sai).
- AI nhả nhãn đúng / KHÔNG_RÕ / nhét bừa bao nhiêu %.
- Có số rồi mới quyết bật/tắt từng lớp.
