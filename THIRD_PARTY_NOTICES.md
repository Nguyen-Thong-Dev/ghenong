# THÔNG BÁO BẢN QUYỀN VÀ MÃ NGUỒN BÊN THỨ BA (THIRD-PARTY NOTICES)

Dự án **GheNongGame (GHẾ NÓNG)** được phát triển độc lập theo tài liệu thiết kế `Bo_luat_Ghe_nong_v1.0.md`, có tham khảo và tận dụng chọn lọc một số kỹ thuật hạ tầng từ kho mã nguồn mở sau:

## 1. Kho mã nguồn tham khảo: `lop-hoc-chu`

- **Nguồn:** `https://github.com/workaipvlinh-byte/lop-hoc-chu`
- **Tác giả:** `workaipvlinh-byte` (PVLinh)
- **Commit tham khảo:** `38daf573a45565c009da35918f0d0c7bb230d963` (`2026-11-07 19:15:50 +0700`)
- **Giấy phép phần mã nguồn:** MIT License (xem toàn văn bên dưới).
- **Những phần kỹ thuật được tận dụng có chọn lọc và điều chỉnh:**
  1. `server/core/filter.ts`: danh sách từ cấm tiếng Việt/tiếng Anh và hàm chuẩn hóa tên đọc tiếng Việt (`speakableName`), điều chỉnh từ `src/live/bannedWords.ts` và `src/live/names.ts`.
  2. `server/tiktok/connector.ts`: cơ chế kết nối `tiktok-live-connector`, tự kết nối lại theo cấp số nhân và chống tính lặp chuỗi quà combo (`streakCounts`), điều chỉnh từ `server.ts` để chuẩn hóa thành `InboundEvent` với định danh tài khoản ổn định (`userId`) và mã sự kiện (`msgId`).
  3. `server/tts/service.ts` & `web/sound.ts`: cơ chế gọi giọng đọc `msedge-tts` kèm dự phòng Google TTS và hàng đợi tự gỡ kẹt bằng timeout, điều chỉnh từ `server.ts` và `src/live/voice.ts`.
  4. `web/StageView.tsx` (`StageFrame`): kỹ thuật co giãn khung dọc 9:16 theo cửa sổ trình duyệt.
- **Lưu ý về tài sản hình ảnh:** Theo đúng thông báo của tác giả `lop-hoc-chu` và yêu cầu của dự án, **GheNongGame hoàn toàn KHÔNG sử dụng** ảnh nhân vật (`nhan-vat/`), ảnh nền hay nhận diện thương hiệu của `lop-hoc-chu`. Toàn bộ nhân vật và sân khấu 2.5D trong bản đầu của `GheNongGame` là đồ họa vector/SVG tự dựng riêng (`web/Character25D.tsx`, `web/StageView.tsx`).

### Toàn văn giấy phép MIT của `lop-hoc-chu`

```text
MIT License

Copyright (c) 2026 workaipvlinh-byte

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 2. Các thư viện mã nguồn mở chính trong `package.json`

- `express` — MIT License
- `react`, `react-dom` — MIT License
- `tiktok-live-connector` — MIT License
- `msedge-tts` — MIT License
- `vite`, `@vitejs/plugin-react` — MIT License
- `typescript`, `tsx` — Apache-2.0 / MIT License
