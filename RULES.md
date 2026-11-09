# TÓM TẮT VÀ ĐỐI CHIẾU BỘ LUẬT GHẾ NÓNG — PHIÊN BẢN 1.0

> **Tài liệu nguồn quyết định tuyệt đối:** [Bo_luat_Ghe_nong_v1.0.md](./Bo_luat_Ghe_nong_v1.0.md)
> Mọi thông số thời gian, điểm số, cấp bậc và trạng thái dưới đây được cài đặt tại [`server/core/rules.ts`](./server/core/rules.ts), [`server/core/commands.ts`](./server/core/commands.ts) và [`server/core/engine.ts`](./server/core/engine.ts).

## 1. Luồng tham gia và Trạng thái người chơi (§2, §3, §4)

Một tài khoản (định danh bằng `userId` ổn định, không ghép theo tên hiển thị) chỉ thuộc đúng **một trạng thái** tại một thời điểm:

`KHÁN GIẢ` → gõ `chờ` → `GHẾ CHỜ` (10 vị trí đầu) hoặc `ĐÃ ĐĂNG KÝ` (vị trí 11+) → được gọi tên vào ghế trống → `ĐƯỢC MỜI` (12 giây xác nhận `ss`) → `GHẾ NÓNG` (ghế 1–5).

| Lệnh bình luận | Quy tắc xử lý |
|---|---|
| `vao` / `vào` | Tạo hồ sơ khán giả nếu chưa có; không tự đăng ký ghế. |
| `cho` / `chờ` | Cấp số thứ tự tăng dần cuối hàng chờ, bật tự xếp lại (`autoRequeue = true`). Gửi lại `chờ` không đổi thứ tự. |
| `huy` / `hủy` | Rời danh sách chờ, hủy lời mời (nếu có), tắt tự xếp lại; nếu đang ở ghế nóng thì vẫn giữ ghế đến khi nhường/rớt. |
| `ss` / `sẵn sàng` | Chỉ có hiệu lực khi đang `ĐƯỢC MỜI` trong hạn 12 giây. Chuyển vào ghế nóng đã dành với **Cấp 0**. |
| `nhuong` / `nhường` | Rời ghế nóng và tắt tự xếp lại. Nếu câu đang mở: đáp án đã gửi (nếu đúng) vẫn được `+10` điểm nhưng không tăng cấp; ghế chỉ bổ sung sau câu đó. |
| `<Mã câu><A/B/C/D>` | Ví dụ `23B` hoặc `23 b` (chuẩn hóa thành `23B`). Không nhận riêng `A/B/C/D`, không đọc trong câu dài, không nhận nhiều lựa chọn. |
| `diem` / `điểm` | Hiện điểm phiên, kỷ lục cấp và số huy hiệu (cooldown 15 giây/người). |
| `vitri` / `vị trí` | Hiện số ghế nóng hoặc số thứ tự hàng chờ (cooldown 15 giây/người). |

## 2. Vòng đời một câu hỏi (§6, §7)

1. **CHUẨN BỊ (`PREPARE` — 5 giây):** Hiện mã câu và chủ đề, chốt danh sách người đang ngồi ghế nóng; chưa lộ đề và 4 lựa chọn.
2. **MỞ ĐÁP ÁN (`OPEN` — 30 giây):** Hiện câu hỏi, 4 lựa chọn A/B/C/D, đồng hồ đếm ngược. Nhận đáp án hợp lệ đầu tiên khi `now < closesAt` (đúng bằng `closesAt` là trễ). Trang sân khấu không nhận đáp án đúng trong giai đoạn này.
3. **KHÓA VÀ CHẤM (`<= 1 giây`):** Chấm đúng một lần duy nhất trong giao dịch SQLite.
4. **CÔNG BỐ (`REVEAL` — 5 giây):** Hiện đáp án đúng, giải thích ngắn và kết quả từng ghế.
5. **VINH DANH (`HONOR` — 3 giây):** Gộp những người đạt mốc cấp `3 / 6 / 10 / 15` hoặc phá kỷ lục cá nhân trên một bảng vinh danh chung 3 giây; có dòng `CẢ SÀN GIỮ GHẾ!` nếu đủ 5 ghế cùng đúng.
6. **CHUYỂN GHẾ (`TRANSITION` — 4 giây + tối đa 2 đợt mời × 12 giây):** Chỉ thay các ghế trống theo thứ tự ghế `1 → 5`.

## 3. Điểm, Cấp bậc và Khi rớt ghế (§5, §8, §9, §13)

- **Điểm:** Mọi vai trả lời đúng đều `+10 điểm`; sai hoặc không trả lời `+0 điểm`. Không thưởng tốc độ, không nhân điểm vì quà tặng.
- **Cấp ghế nóng:** Bắt đầu từ `Cấp 0` (*Tân binh*), mỗi câu đúng trên ghế nóng `+1 cấp` (*1–2: Khởi động, 3–5: Đầu lạnh, 6–9: Cao thủ, 10–14: Bậc thầy, 15+: Huyền thoại*).
- **Trả lời sai ở ghế nóng:** Rớt ghế; nếu đang bật `autoRequeue` thì tự xếp vào cuối hàng chờ theo thứ tự số ghế tăng dần (đứng sau mọi người đã đăng ký trước lúc chấm).
- **Không trả lời ở ghế nóng:** Rớt ghế và tắt `autoRequeue` để tránh gọi lặp người vắng mặt.
- **Hiệp 30 phút:** Chốt bảng hiệp 8 giây sau khi hoàn tất câu đang chơi, đặt lại điểm hiệp nhưng giữ nguyên ghế nóng, cấp bậc và hàng chờ.
- **Quà tặng:** Chỉ hiện thông báo cảm ơn ngắn tối đa 2 giây ngoài vùng câu hỏi; hoàn toàn không ảnh hưởng điểm, cấp bậc, thứ tự chờ hay quyền giữ ghế.
