# AI_CONTEXT — Ngữ cảnh dự án **GHẾ NÓNG (v1.0)**

> Tài liệu tóm tắt nhanh dành cho AI ở phiên làm việc mới để nắm toàn bộ kiến trúc, trạng thái hiện tại, các tính năng đã làm và các lưu ý vận hành/kiểm thử.
> Cập nhật: `2026-11-15` · Nhánh phát triển: `ghe-nong/dev`

---

## 1. Tổng quan dự án
- **Tên dự án:** **GHẾ NÓNG** — Game tương tác TikTok LIVE theo khung dọc 9:16 (`720×1280`).
- **Tài liệu luật chuẩn:** [Bo_luat_Ghe_nong_v1.0.md](Bo_luat_Ghe_nong_v1.0.md), [RULES.md](RULES.md), [ARCHITECTURE.md](ARCHITECTURE.md).
- **Công nghệ:**
  - Backend: Node.js (`>=22.13`), TypeScript (`tsx`), Express, SSE (`/api/stage/stream`, `/api/admin/stream`), SQLite (`node:sqlite` trong `server/store/db.ts`), `tiktok-live-connector` (`^2.5.0`), `msedge-tts` (`2.1.0`).
  - Frontend: React 19, Vite (`^8.3.0`), Web Audio API (`web/sound.ts`), SVG 2.5D (`web/Character25D.tsx`).
  - Kiểm thử: `node:test` (`tests/engine.test.ts`), Playwright + Microsoft Edge (`tests/ui/*.mjs`).

---

## 2. Cấu trúc thư mục chính
- **Khởi động nhanh trên Windows:**
  - `BAT-GHE-NONG.bat`: Khởi động server ở cổng `3008` (`LIVE_MODE=1`) và tự khởi động lại nếu dừng.
  - `MO-SAN-KHAU.bat`: Mở riêng cửa sổ sân khấu 9:16 (`http://localhost:3008/?view=stage`) không thanh địa chỉ, dùng cho TikTok LIVE Studio (Window Capture).
  - `.env` (không commit lên Git, xem `.env.example`): Hiện đặt `DISABLE_SIM=1` để tắt API giả lập khi live thật. Hỗ trợ `PORT`, `TTS_VOICE`, `TTS_PITCH`, `TIKTOK_SIGN_API_KEY`.
- **Backend (`server/`):**
  - `server/index.ts`: Express server, xác thực admin cục bộ (`X-Admin-Token` / `/api/admin/bootstrap`), SSE broadcast, endpoint kết nối TikTok (`/api/admin/tiktok/connect`, `/api/admin/tiktok/sign-key`, `/api/admin/tiktok/disconnect`), quản trị quà (`/api/admin/gifts/*`), và API giả lập (`/api/sim/*`, bị tắt khi `DISABLE_SIM=1`).
  - `server/core/engine.ts`: `GameEngine` — toàn bộ máy trạng thái vòng chơi (`NO_SESSION`, `STANDBY`, `INVITING`, `PREPARE` 7s, `OPEN` 30s, `REVEAL` 8s, `HONOR` 5s, `TRANSITION` 7s, `ROUND_BOARD`, `PAUSED`, `ENDED`), chấm điểm (`+10đ`), xếp hàng 10 ghế chờ + 5 ghế nóng, đồng bộ tên + avatar người xem ở mọi bình luận/quà (`syncProfile`), thực thi quyền lợi quà, hoàn tác (`undoLast`), phục hồi từ SQLite.
  - `server/core/commands.ts`: Bộ phân tích lệnh bình luận (`vao`, `cho`, `huy`, `ss`, `nhuong`, `diem`, `vitri`, `<mã câu><A/B/C/D>`).
  - `server/core/mcDirector.ts`: Điều phối lời MC theo ngữ cảnh, ngân hàng lời thoại, chống nói quá dày trong pha `OPEN` (tối đa 2 câu phụ cách nhau `>= 8s`, chừa 5s cuối nhắc giờ).
  - `server/core/giftPerks.ts`: Lưu cấu hình Gift ID → quyền lợi (`skip_queue`, `steal_seat`, `protect_answer`), tích lũy `unitsPerPerk`, chống xử lý trùng. Mặc định cấu hình trống → quà chỉ hiện lời cảm ơn đúng luật v1.0.
  - `server/core/questions.ts`, `server/data/bank300*.json`, `server/data/samples.ts`: Ngân hàng **320 câu hỏi** (300 câu GN001–GN300 đa chủ đề + 20 câu mẫu); hết ngân hàng tự mở vòng mới liên tục.
  - `server/tiktok/connector.ts`: `TikTokBridge` — kết nối `tiktok-live-connector`, hỗ trợ **EulerStream API Key (`signApiKey`)** (lưu trong SQLite meta `tiktok_sign_api_key` hoặc `.env`), chọn URL avatar hợp lệ (bỏ `.heic`), lọc combo quà không cộng trùng, tự kết nối lại theo exponential backoff.
  - `server/tts/service.ts`: Sinh âm thanh giọng MC bằng Edge TTS (`vi-VN-HoaiMyNeural`).
  - `server/store/db.ts`: SQLite lưu người chơi, câu hỏi, snapshot trạng thái, log sự kiện chống trùng, meta (`gift_perks`, `tiktok_sign_api_key`).
- **Frontend (`web/`):**
  - `web/StageView.tsx`: Màn hình sân khấu 9:16 (`?view=stage`) — 5 ghế nóng, 10 ghế chờ (2×5), khán đài chữ U (30 chỗ), bảng câu hỏi, MC 8 tư thế, bảng xếp hạng, vinh danh, toast thông báo giữa bảng câu hỏi và 5 ghế nóng, nút mở khóa âm thanh trình duyệt. **Tuyệt đối cách ly** khỏi các bảng điều khiển vận hành (âm thanh, quà).
  - `web/Character25D.tsx`: Nhân vật SVG 2.5D và 8 tư thế MC áo trắng (`McWhiteHost25D`). Hỗ trợ hiển thị **avatar thật của người xem** (`safeAvatarUrl`, `useAvatarLoaded`), tự rơi về mặt hoạt hình mặc định nếu thiếu hoặc lỗi ảnh.
  - `web/DashboardView.tsx`: Bảng điều khiển quản trị (`http://localhost:3008`) gồm ô kết nối TikTok + **EulerStream API Key**, điều khiển phiên, giả lập 30 người chơi, và các tab: Nhật ký & Vùng an toàn, Âm thanh & Nhạc nền, **Quà & Quyền lợi** (`web/GiftPanel.tsx`), 5 Ghế nóng & Hàng chờ, Người chơi, Ngân hàng câu hỏi.
  - `web/sound.ts`: Hệ thống âm thanh Web Audio API tập trung — tách âm lượng Master / Nhạc nền / SFX / Giọng MC, ducking `-10 dB` khi MC nói, lookahead scheduler, soundboard nghe thử trên Dashboard.

---

## 3. Lệnh chạy & kiểm thử
> **Lưu ý trên Windows PowerShell:** Nếu execution policy chặn `npm.ps1`, dùng `npm.cmd`.

```powershell
npm.cmd run lint        # Kiểm tra TypeScript (tsc --noEmit)
npm.cmd test            # 28 bài test lõi luật (T01–T30 trong tests/engine.test.ts)
npm.cmd run build       # Build Vite production (dist/)
npm.cmd run test:ui     # E2E Playwright (Edge): 8 tư thế MC, giao diện 2.5D, 720x1280 & 360x640
npm.cmd run test:audio  # E2E Playwright: cách ly âm thanh, soundboard, chu kỳ game, ducking -10 dB
npm.cmd run test:avatar # E2E Playwright: avatar người xem (ghế nóng/chờ/khán giả) + tab GiftPanel
npm.cmd run dev         # Chạy server + Vite cục bộ (cổng 3008)
```

---

## 4. Trạng thái kiểm thử gần nhất
- `npm.cmd run lint`: **Đạt** (0 lỗi TypeScript).
- `npm.cmd test`: **Đạt 28/28** (bao gồm `T26–T29` quyền lợi quà và `T30` đồng bộ tên + avatar).
- `npm.cmd run build`: **Đạt**.
- `test:ui`, `test:audio`, `test:avatar`: Đã chạy và đạt trước commit cuối `5c015d3` (riêng `5c015d3` chỉ thêm `signApiKey` vào `connector.ts`, `index.ts`, `DashboardView.tsx` và đã kiểm tra lại `lint`, `test` 28/28, `build`).

---

## 5. Những điểm còn lại / lưu ý cho phiên sau
1. **Kết nối TikTok LIVE thật & EulerStream API Key:**
   - Mạng của người dùng gặp lỗi `401 Anonymous access is not available` từ EulerStream. Đã bổ sung ô nhập & lưu **EulerStream API Key** (`signApiKey`) trên Dashboard + `.env` (`TIKTOK_SIGN_API_KEY`). Cần người dùng dán key miễn phí từ `eulerstream.com` và thử live thật để kiểm tra độ trễ bình luận, avatar TikTok thực tế và lấy `Gift ID` thật.
2. **File `.env` cục bộ:**
   - Đang đặt `DISABLE_SIM=1` để phục vụ live thật. Nếu muốn test giả lập trên Dashboard thì đổi tạm về `DISABLE_SIM=0`. (Các script E2E đã tự ghi đè `DISABLE_SIM=0` khi chạy).
3. **Đồ họa & Vận hành dài giờ:**
   - Nhân vật ghế nóng/chờ/khán giả hiện dùng vector SVG 2.5D + avatar tròn người xem (MC dùng 8 ảnh áo trắng).
   - Chưa kiểm thử chạy tải liên tục 6 giờ trên VPS.
