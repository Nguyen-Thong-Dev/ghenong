# GHẾ NÓNG (GheNongGame) — Phiên bản 1.0

Game tương tác trực tiếp trên **TikTok LIVE** với phong cách sân khấu 2D có chiều sâu 2.5D (khổ dọc 9:16 chuẩn `720 × 1280`, tự phóng theo cửa sổ), phát hình và tiếng vào **OBS** hoặc **TikTok LIVE Studio**. Người xem tham gia hoàn toàn bằng bình luận, không cần mở trang web riêng và không cần tặng quà.

- **Bộ luật gốc quyết định:** [Bo_luat_Ghe_nong_v1.0.md](./Bo_luat_Ghe_nong_v1.0.md) (xem thêm tóm tắt tại [RULES.md](./RULES.md))
- **Kiến trúc kỹ thuật:** [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Tiến độ & Kiểm thử:** [PROGRESS.md](./PROGRESS.md)
- **Bản quyền & Nguồn tham khảo:** [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)

---

## 1. Yêu cầu môi trường

- **Hệ điều hành:** Windows 10/11 (hoặc macOS/Linux)
- **Node.js:** `>= 22.13` (tích hợp sẵn `node:sqlite` cho cơ sở dữ liệu SQLite, không cần biên dịch C++)
- **Git:** `>= 2.40`

---

## 2. Cách cài đặt và khởi chạy

### Cách 1: Chạy nhanh trên Windows (Bấm đúp 1 lần)
Bấm đúp vào file **[BAT-GHE-NONG.bat](./BAT-GHE-NONG.bat)** trong thư mục dự án. Script sẽ tự cài thư viện (nếu lần đầu), bật máy chủ ở cổng `3008` và mở Bảng điều khiển trên trình duyệt.

### Cách 2: Chạy bằng dòng lệnh (PowerShell / CMD)

```powershell
# 1. Cài đặt thư viện (lần đầu)
npm install

# 2. Khởi chạy máy chủ (mặc định cổng 3008)
npm run dev
```

---

## 3. Địa chỉ mở Bảng điều khiển và Sân khấu

Khi máy chủ đã chạy:

1. **Bảng điều khiển & Bộ giả lập (dành cho người vận hành):**
   👉 `http://localhost:3008`
2. **Màn hình Sân khấu 9:16 (trình duyệt trên máy):**
   👉 `http://localhost:3008/?view=stage`
3. **Đường dẫn đưa vào TikTok LIVE Studio hoặc OBS (nguồn Browser / Link):**
   👉 `http://lvh.me:3008/?view=stage` (Khổ dọc `720 × 1280` hoặc `1080 × 1920`, bật âm thanh)

> **Lưu ý:** Máy chủ chỉ lắng nghe trên `127.0.0.1` (cục bộ) và chặn DNS rebinding để đảm bảo an toàn. Mở thêm hoặc tải lại trang sân khấu không làm tạo vòng chơi mới hay chấm điểm hai lần.

---

## 4. Các lệnh kiểm tra tự động

```powershell
# Kiểm tra kiểu TypeScript
npm run lint

# Chạy 16 bài kiểm tra tự động Lõi Luật (T01 -> T18)
npm test

# Build giao diện và chạy kiểm tra tự động End-to-End (Playwright + Edge)
npm run build
npm run test:ui
```

---

## 5. Vận hành thật (Tắt bộ giả lập)

Khi lên sóng thật, đặt biến môi trường `DISABLE_SIM=1` (trong file `.env` hoặc câu lệnh khởi chạy). Toàn bộ các API `/api/sim/*` và khung nút giả lập sẽ bị khóa hoàn toàn.
