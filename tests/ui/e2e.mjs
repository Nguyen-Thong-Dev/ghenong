/**
 * Kiểm tra tự động Giao diện & Máy chủ (End-to-End bằng Playwright + Microsoft Edge):
 * - Mở Bảng điều khiển và 2 trang Sân khấu cùng lúc.
 * - Xác minh không lộ đáp án đúng xuống trang sân khấu trước khi chốt câu.
 * - Xác minh tải lại trang sân khấu không làm mất ghế hoặc reset lượt chơi.
 * - Xác minh mở 2 trang sân khấu không tạo 2 vòng chơi hay chấm điểm 2 lần.
 * - Chạy kịch bản Ghế 2 và Ghế 5 bị loại trực tiếp trên giao diện và chụp ảnh nghiệm thu.
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = 3108;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghenong-e2e-'));
const outDir = path.resolve('test-results');
fs.mkdirSync(outDir, { recursive: true });

console.log('[E2E] Khởi động máy chủ GHẾ NÓNG trên cổng', PORT);
const serverProc = spawn(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'],
  {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: tmpDir,
      NODE_ENV: 'production',
      E2E_TEST: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let serverReady = false;
serverProc.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  if (chunk.toString().includes('3108')) serverReady = true;
});
serverProc.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

for (let i = 0; i < 60 && !serverReady; i++) {
  await sleep(300);
  try {
    const r = await fetch(`${BASE}/api/stage/state`);
    if (r.ok) serverReady = true;
  } catch {}
}
assert.equal(serverReady, true, 'Máy chủ phải khởi động thành công');

let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });

  // 1. Mở Bảng điều khiển + 2 trang Sân khấu (kiểm tra mở 2 trang sân khấu cùng lúc)
  const dashPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const stagePage1 = await browser.newPage({ viewport: { width: 720, height: 1280 } });
  const stagePage2 = await browser.newPage({ viewport: { width: 720, height: 1280 } });

  await Promise.all([
    dashPage.goto(BASE),
    stagePage1.goto(`${BASE}/?view=stage&mute=1`),
    stagePage2.goto(`${BASE}/?view=stage&mute=1`),
  ]);
  await sleep(1200);

  // Kiểm tra 4 cập nhật mới trên giao diện:
  // (1) Font Inter được áp dụng cho toàn bộ game
  const stageFont = await stagePage1.evaluate(() => getComputedStyle(document.body).fontFamily);
  assert.equal(stageFont.toLowerCase().includes('inter'), true, 'Toàn bộ game phải sử dụng font chữ Inter');

  // (2) Đã xóa bỏ MC & khung MC, thay bằng khung Lệnh hướng dẫn chơi
  const guideVisible = await stagePage1.getByTestId('command-guide-box').isVisible();
  assert.equal(guideVisible, true, 'Khung hiển thị các lệnh hướng dẫn chơi phải hiển thị thay cho MC');
  const stageHtml = await stagePage1.content();
  assert.equal(stageHtml.includes('MC GHẾ NÓNG'), false, 'Không còn khung MC trên sân khấu');

  // (3) 10 Ghế chờ tự động đưa người chơi vào ngay từ đầu mà không cần phải nhập "chờ", và có đủ 30 người chơi giả lập
  const stageStateInitial = await fetch(`${BASE}/api/stage/state`).then((r) => r.json());
  assert.equal(stageStateInitial.waiting.length, 10, '10 ghế chờ phải tự động có đủ 10 người chơi mà không cần gõ "chờ"');
  assert.equal(stageStateInitial.audienceTotal, 30, 'Phòng chơi có đủ 30 người chơi giả lập');

  // 2. Bấm "Bắt đầu phiên" -> tự động đẩy 5 người đầu từ ghế chờ lên 5 ghế nóng (đếm ngược 12s) và tự lấp đầy lại 10 ghế chờ
  await dashPage.getByTestId('btn-start-session').click();
  await sleep(400);

  const stageStateInviting = await fetch(`${BASE}/api/stage/state`).then((r) => r.json());
  assert.equal(stageStateInviting.phase, 'INVITING');
  assert.equal(stageStateInviting.waiting.length, 10, 'Khi 5 người được đẩy lên ghế nóng, 10 ghế chờ tự động lấp đầy người tiếp theo');

  // 3. Qua 12s đếm ngược (không cần gõ "SS") -> 5 người tự động vào ghế nóng 1..5, chuyển sang PREPARE
  await dashPage.getByTestId('btn-advance-phase').click();
  await sleep(400);

  // 4. Bấm "Tua nhanh bước hiện tại" để từ PREPARE sang OPEN (Đang nhận đáp án)
  await dashPage.getByTestId('btn-advance-phase').click();
  await sleep(500);

  // Xác minh API công khai của sân khấu KHÔNG chứa đáp án đúng khi câu đang mở
  const stageStateOpen = await fetch(`${BASE}/api/stage/state`).then((r) => r.json());
  assert.equal(stageStateOpen.phase, 'OPEN');
  assert.equal(stageStateOpen.reveal, null);
  assert.equal('correct' in (stageStateOpen.question || {}), false, 'Không được lộ đáp án đúng ở publicView trước khi chốt câu');
  assert.equal(stageStateOpen.stageCount, 2, 'Máy chủ nhận biết đang mở 2 trang sân khấu');

  // Chụp ảnh sân khấu lúc đang mở câu hỏi (OPEN)
  await stagePage1.screenshot({ path: path.join(outDir, 'stage-open.png') });
  await dashPage.screenshot({ path: path.join(outDir, 'dashboard-open.png') });

  // 5. Tải lại (reload) trang sân khấu 1 giữa lúc câu đang mở -> không mất ghế, không reset câu
  await stagePage1.reload();
  await sleep(600);
  const seat1NameAfterReload = await stagePage1.getByTestId('hot-seat-1-name').textContent();
  assert.equal(seat1NameAfterReload?.includes('Minh Tuấn'), true, 'Tải lại trang sân khấu không làm mất người ngồi ghế 1');

  // 6. Chạy tình huống bắt buộc: Ghế 2 và 5 trả lời SAI (Ghế 1, 3, 4 trả lời ĐÚNG)
  await dashPage.getByTestId('sim-seat25-wrong').click();
  await sleep(500);

  // Tua hết 30s mở đáp án để khóa và chấm câu
  await dashPage.getByTestId('btn-advance-phase').click();
  await sleep(500);

  // Kiểm tra trạng thái REVEAL trên cả máy chủ và trang sân khấu
  const boot = await fetch(`${BASE}/api/admin/bootstrap`).then((r) => r.json());
  const adminAfterGrade = await fetch(`${BASE}/api/admin/state`, {
    headers: { 'X-Admin-Token': boot.token },
  }).then((r) => r.json());

  assert.equal(adminAfterGrade.state.phase, 'REVEAL');
  assert.equal(adminAfterGrade.gradeCount, 1, 'Mở 2 trang sân khấu chỉ được chấm đúng 1 lần');
  assert.equal(adminAfterGrade.seats[0].userId, 'sim_01');
  assert.equal(adminAfterGrade.seats[0].level, 1);
  assert.equal(adminAfterGrade.seats[1].userId, undefined, 'Ghế 2 trả lời sai phải rời ghế');
  assert.equal(adminAfterGrade.seats[2].userId, 'sim_03');
  assert.equal(adminAfterGrade.seats[2].level, 1);
  assert.equal(adminAfterGrade.seats[3].userId, 'sim_04');
  assert.equal(adminAfterGrade.seats[3].level, 1);
  assert.equal(adminAfterGrade.seats[4].userId, undefined, 'Ghế 5 trả lời sai phải rời ghế');

  await stagePage1.screenshot({ path: path.join(outDir, 'stage-reveal.png') });

  // 7. Tua sang HONOR (Vinh danh 3 giây giữa màn hình)
  await dashPage.getByTestId('btn-advance-phase').click();
  await sleep(400);
  const honorVisible = await stagePage1.getByTestId('honor-overlay').isVisible();
  assert.equal(honorVisible, true, 'Hiệu ứng vinh danh giữa màn hình phải hiển thị trong pha HONOR');
  await stagePage1.screenshot({ path: path.join(outDir, 'stage-honor.png') });

  // 8. Tua qua HONOR (3s) -> TRANSITION (4s) -> INVITING (mời người chờ vào ghế 2 và 5)
  await dashPage.getByTestId('btn-advance-phase').click();
  await sleep(300);
  await dashPage.getByTestId('btn-advance-phase').click();
  await sleep(400);

  // Xác nhận sim_06 và sim_07 vào ghế 2 và 5
  await dashPage.getByTestId('sim-confirm-all').click();
  await sleep(400);

  const adminAfterReplace = await fetch(`${BASE}/api/admin/state`, {
    headers: { 'X-Admin-Token': boot.token },
  }).then((r) => r.json());
  assert.equal(adminAfterReplace.seats[1].userId, 'sim_06', 'Ghế 2 được thay bằng người chờ đầu hàng (sim_06)');
  assert.equal(adminAfterReplace.seats[1].level, 0, 'Người mới vào ghế 2 bắt đầu ở Cấp 0');
  assert.equal(adminAfterReplace.seats[4].userId, 'sim_07', 'Ghế 5 được thay bằng người chờ tiếp theo (sim_07)');
  assert.equal(adminAfterReplace.seats[4].level, 0, 'Người mới vào ghế 5 bắt đầu ở Cấp 0');
  assert.equal(adminAfterReplace.seats[0].level, 1, 'Ghế 1 giữ nguyên Cấp 1');

  console.log('[E2E] TẤT CẢ KIỂM TRA GIAO DIỆN & MÁY CHỦ ĐỀU ĐẠT!');
} finally {
  await browser?.close();
  serverProc.kill();
  await sleep(300);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
  process.exit(0);
}
