# TIẾN ĐỘ DỰ ÁN & KẾT QUẢ KIỂM TRA (PROGRESS)

Cập nhật: `09/11/2026` — Phiên bản luật: `v1.0`

## 1. Những hạng mục đã hoàn thành

- [x] **Môi trường & Khởi tạo an toàn:**
  - Cài đặt và xác minh Git `2.56.0.windows.4`, Node.js `v26.13.0`, npm `11.20.0`.
  - Clone repo tham khảo `lop-hoc-chu` (commit `38daf573a45565c009da35918f0d0c7bb230d963`) vào thư mục tách biệt `reference/lop-hoc-chu`, khóa push về repo tác giả (`DISABLED_no_push_to_author`), chạy toàn bộ kiểm tra gốc (`lint`, `quiz.check`, `bank.check`, `build` và chạy thử luồng giả lập).
  - Khởi tạo repo Git riêng cho `GheNongGame` với nhánh phát triển `ghe-nong/dev`.
- [x] **Lõi luật máy chủ (`server/core/`) & Lưu trữ SQLite (`server/store/db.ts`):**
  - Triển khai đầy đủ các trạng thái người chơi (`KHÁN GIẢ`, `ĐÃ ĐĂNG KÝ`, `GHẾ CHỜ`, `ĐƯỢC MỜI`, `GHẾ NÓNG`, `TẠM KHÓA`), các lệnh (`vao`, `cho`, `huy`, `ss`, `nhuong`, `diem`, `vitri`, `<mã câu><A/B/C/D>`) và vòng đời câu hỏi (`PREPARE` 5s → `OPEN` 30s → `REVEAL` 5s → `HONOR` 3s → `TRANSITION` 4s + tối đa 2 đợt mời 12s).
  - Lưu trữ SQLite chuẩn hóa kèm ảnh chụp trạng thái đồng bộ trong cùng giao dịch; hỗ trợ hoàn tác câu vừa chấm (`undoLast`), hủy câu đang mở (`cancelQuestion`) và khôi phục phiên sau khi máy chủ khởi động lại (`recover`).
  - Không gửi đáp án đúng xuống trang sân khấu trước khi chốt câu.
- [x] **Giao diện Sân khấu 2.5D (`720 × 1280`) & Bảng điều khiển tách riêng (`web/`):**
  - Sân khấu dọc 9:16 với 5 ghế nóng (đánh số cố định 1–5), 1 MC, 10 ghế chờ có thứ tự `#1`..`#10`, khán đài hình chữ U (vẽ tối đa 40 nhân vật đại diện), màn hình câu hỏi 4 lựa chọn chữ lớn, đồng hồ, bảng xếp hạng Top 5 và bảng vinh danh 3 giây giữa màn hình.
  - Bảng điều khiển tách riêng có xác thực cục bộ, tích hợp bộ giả lập 24 người chơi mẫu (`sim_01`..`sim_24`), 20 câu hỏi trắc nghiệm tiếng Việt mẫu đã duyệt (có giải thích), quản lý người chơi/câu hỏi, chỉnh vùng an toàn TikTok và nhật ký giải thích từng lệnh.
- [x] **Kiểm tra tự động:**
  - `npm run lint`: Đạt (0 lỗi TypeScript).
  - `npm test` (`tests/engine.test.ts`): Đạt **16/16** bài kiểm tra tự động bao phủ toàn bộ bộ nghiệm thu `T01`–`T18`.
  - `npm run test:ui` (`tests/ui/e2e.mjs`): Đạt kiểm tra giao diện & máy chủ trên trình duyệt Microsoft Edge (Playwright), xác minh kịch bản ghế 2 & 5 bị loại, tải lại trang sân khấu không mất ghế, mở 2 trang sân khấu không tạo 2 vòng chơi hay chấm 2 lần.

## 2. Những phần đang là hình tạm hoặc chưa thực hiện trong giai đoạn này

- **Đồ họa nhân vật & sân khấu:** Đang sử dụng bộ nhân vật vector/SVG 2.5D tự tạo (`web/Character25D.tsx`) và nền sân khấu vector/CSS 2.5D làm **hình tạm rõ nét cho bản đầu** (hoàn toàn không dùng ảnh của repo `lop-hoc-chu`). Khi có bộ sprite nhân vật và nền 2.5D hoàn thiện của họa sĩ, chỉ cần thay vào `Character25D.tsx` và `StageView.tsx`.
- **Ngân hàng câu hỏi vận hành dài giờ:** Có **320 câu hỏi đã duyệt** trong ngân hàng SQLite (`server/data/runtime/ghenong.sqlite`): **300 câu GN001–GN300 đa chủ đề, đa độ khó** (12 chủ đề: Đời sống, Ẩm thực, Tiếng Việt, Tuổi thơ, Thiên nhiên, Khoa học, Địa lý, Công nghệ, Suy luận, Tiếng Anh, Thể thao, Âm nhạc) + 20 câu mẫu cũ `q01..q20`. Khi hết câu trong phiên, engine tự mở vòng mới, giữ 20 câu vừa chơi để tránh lặp sát, không treo màn hình nghỉ (`T24`, `T25`).
- **Kiểm thử tải 6 giờ liên tục trên VPS (`T19`, `T20`) và phòng TikTok LIVE thật:** Chưa thực hiện trong giai đoạn local này; cần thực hiện khi triển khai lên VPS và nối phòng live thật.

## 3. Bước tiếp theo

1. ✅ Nhập ngân hàng câu hỏi: 300 câu GN đã duyệt (có thể tiếp tục bổ sung thêm để đạt mục tiêu 500+ câu cho phiên 6 giờ).
2. Thay bộ hình tạm SVG 2.5D bằng bộ tranh nhân vật (MC, thí sinh ghế nóng, khán giả) hoàn thiện của dự án.
3. Thử nghiệm kết nối với một buổi phát TikTok LIVE thật (chế độ thử nghiệm) để đo độ trễ bình luận và tinh chỉnh vùng an toàn (Safe Area) trên màn hình điện thoại.
4. Đưa lên máy chủ VPS, cấu hình `DISABLE_SIM=1` và chạy bài kiểm thử vận hành liên tục (`T19`, `T20`).
