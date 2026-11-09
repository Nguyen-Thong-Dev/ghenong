# KIẾN TRÚC KỸ THUẬT — GHẾ NÓNG (GheNongGame v1.0)

## 1. Sơ đồ tổng thể và Nguyên tắc thiết kế

Khác với repo tham khảo `lop-hoc-chu` (vốn đặt lõi trạng thái game trong component React của trang sân khấu), **GheNongGame** chuyển toàn bộ nguồn trạng thái chính lên **Máy chủ Node.js** và lưu bền vững vào **SQLite**:

```mermaid
flowchart LR
  subgraph Sources["Nguồn sự kiện"]
    TT["TikTok LIVE\n(TikTokBridge)"]
    SIM["Bộ giả lập\n(/api/sim/*)"]
  end

  subgraph Server["Máy chủ Cục bộ (127.0.0.1:3008)"]
    NORM["Chuẩn hóa lệnh\n(commands.ts)"]
    ENG["Lõi luật GameEngine\n(engine.ts)"]
    DB[("SQLite WAL\n(store/db.ts)")]
    TTS["Edge/Google TTS\n(tts/service.ts)"]
  end

  subgraph Clients["Giao diện Trình duyệt (React + Vite)"]
    STAGE["Sân khấu 9:16 (720×1280)\n/?view=stage"]
    DASH["Bảng điều khiển & Giả lập\n/"]
  end

  TT -->|InboundEvent| NORM
  SIM -->|InboundEvent| NORM
  NORM --> ENG
  ENG <-->|Giao dịch ACID| DB
  ENG -->|publicView qua SSE\n(KHÔNG lộ đáp án sớm)| STAGE
  ENG <-->|adminView + Lệnh quản trị\n(X-Admin-Token)| DASH
  STAGE -->|Tải âm thanh có timeout 6s| TTS
```

## 2. Cấu trúc thư mục

- [`server/core/rules.ts`](./server/core/rules.ts): Toàn bộ hằng số thời gian, điểm số, mốc huy hiệu và danh hiệu theo đúng `Bo_luat_Ghe_nong_v1.0.md`.
- [`server/core/commands.ts`](./server/core/commands.ts): Bộ phân tích và chuẩn hóa cú pháp lệnh (`vao`, `cho`, `huy`, `ss`, `nhuong`, `diem`, `vitri`, `23B`). Dùng chung cho cả bình luận TikTok thật và bình luận giả lập.
- [`server/core/questions.ts`](./server/core/questions.ts): Thuật toán chọn câu hỏi theo khối 10 câu (`3 dễ : 5 vừa : 2 khó`), chống 2 câu khó liên tiếp, chống quá 3 câu cùng chủ đề và chống lặp câu trong cùng phiên.
- [`server/core/filter.ts`](./server/core/filter.ts): Bộ lọc từ cấm, rút gọn tên hiển thị trên ghế và chuyển tên thành dạng đọc tiếng Việt cho MC.
- [`server/core/engine.ts`](./server/core/engine.ts): Máy trạng thái hữu hạn (State Machine) điều phối toàn bộ vòng đời phiên, hiệp, câu hỏi, lời mời, ghế nóng, chấm điểm, hoàn tác (`undoLast`) và phục hồi sau sự cố (`recover`).
- [`server/store/db.ts`](./server/store/db.ts): Lớp lưu trữ SQLite (`node:sqlite` với `PRAGMA journal_mode = WAL`), lưu bảng người chơi, sự kiện đã xử lý (`processed_events`), lượt câu hỏi (`question_runs`), đáp án đầu tiên (`answers`), kết quả từng câu (`question_results`), nhật ký lệnh và lịch sử cấu hình.
- [`server/tiktok/connector.ts`](./server/tiktok/connector.ts): Kết nối `tiktok-live-connector`, tự động kết nối lại và báo trạng thái sức khỏe kết nối (`setSourceHealth`) cho `GameEngine`.
- [`server/tts/service.ts`](./server/tts/service.ts): Tổng hợp giọng đọc tiếng Việt bằng `msedge-tts` kèm dự phòng Google TTS và bộ nhớ đệm.
- [`server/index.ts`](./server/index.ts): Máy chủ Express cục bộ (`127.0.0.1`), chống DNS rebinding, tách riêng `/api/stage/*`, `/api/admin/*` (yêu cầu `X-Admin-Token`) và `/api/sim/*` (tắt được bằng `DISABLE_SIM=1`).
- [`web/StageView.tsx`](./web/StageView.tsx) & [`web/Character25D.tsx`](./web/Character25D.tsx): Giao diện sân khấu 2.5D khổ `720 × 1280` chỉ đọc trạng thái và phát hiệu ứng/âm thanh.
- [`web/DashboardView.tsx`](./web/DashboardView.tsx): Bảng điều khiển quản trị và công cụ giả lập.

## 3. Cơ chế chống trùng, bảo mật và phục hồi

1. **Chống xử lý trùng sự kiện & đáp án:**
   - Bảng `processed_events(event_id PRIMARY KEY)` chặn mọi sự kiện có cùng `eventId` (mã `msgId` của TikTok hoặc mã sự kiện giả lập).
   - Bảng `answers(run_id, user_id PRIMARY KEY)` đảm bảo mỗi tài khoản chỉ khóa được duy nhất đáp án hợp lệ đầu tiên trong mỗi câu.
   - Hàm `grade()` kiểm tra cả trạng thái bộ nhớ và bảng `question_runs` / `question_results` trong SQLite trước khi chấm, đảm bảo mỗi câu chỉ chấm đúng 1 lần dù mở bao nhiêu tab sân khấu.
2. **Không lộ đáp án đúng trước khi chốt:**
   - Hàm `engine.publicView()` chỉ đưa trường `reveal: { correct, explanation }` vào dữ liệu gửi xuống `/api/stage/*` khi câu hỏi đã chuyển sang trạng thái `graded` (`REVEAL` / `HONOR`).
3. **Phục hồi khi máy chủ khởi động lại (`recover`):**
   - Nếu khởi động lại khi câu đang mở (`PREPARE` / `OPEN`): tự động hủy câu chưa chấm, giữ nguyên ghế nóng/cấp bậc/hàng chờ trước câu và mở câu mới khi nguồn kết nối khỏe.
   - Nếu khởi động lại sau khi đã chấm (`REVEAL` / `HONOR` / `TRANSITION`): giữ nguyên kết quả đã chấm (không chấm lại) và tiếp tục bước chuyển ghế.
