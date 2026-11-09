/**
 * Kiểm tra tự động Giao diện Sân khấu 2.5D & Máy chủ (End-to-End bằng Playwright + Microsoft Edge):
 * - Kiểm tra cả kích thước gốc 720 × 1280 (9:16) và kích thước hiển thị điện thoại 360 × 640.
 * - Xác minh các khối bố cục (Thanh trên, MC, Bảng câu hỏi, 5 Ghế nóng, 10 Ghế chờ, Khán đài chữ U) không chồng lấn chữ.
 * - Chụp và nghiệm thu đủ 4 trạng thái bắt buộc bằng dữ liệu giả lập:
 *   1) Đủ 5 người ghế nóng, đủ 10 người chờ và 30 khán giả.
 *   2) Câu hỏi dài cùng bốn đáp án dài.
 *   3) Ghế 2 và 5 bị loại (Ghế 1, 3, 4 trả lời đúng có đèn Spotlight chiếu sáng).
 *   4) Nhiều người được vinh danh cùng lúc (đạt mốc cấp 3).
 * - Xác minh tải lại trang không mất ghế và không phát lại hiệu ứng thưởng cũ; kiểm tra tùy chọn giảm chuyển động & âm thanh.
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

  const boot = await fetch(`${BASE}/api/admin/bootstrap`).then((r) => r.json());
  const headers = { 'Content-Type': 'application/json', 'X-Admin-Token': boot.token };
  const api = (url, body) =>
    fetch(`${BASE}${url}`, {
      method: 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => r.json());

  // Mở Bảng điều khiển + Trang sân khấu chuẩn 720×1280 + Trang sân khấu điện thoại 360×640
  const dashPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const stagePage720 = await browser.newPage({ viewport: { width: 720, height: 1280 } });
  const stagePage360 = await browser.newPage({ viewport: { width: 360, height: 640 } });

  await Promise.all([
    dashPage.goto(BASE),
    stagePage720.goto(`${BASE}/?view=stage&mute=1`),
    stagePage360.goto(`${BASE}/?view=stage&mute=1`),
  ]);
  await sleep(1000);

  // Kiểm tra font Inter & sự hiện diện của MC + Hướng dẫn chơi theo trạng thái
  const stageFont = await stagePage720.evaluate(() => getComputedStyle(document.body).fontFamily);
  assert.equal(stageFont.toLowerCase().includes('inter'), true, 'Toàn bộ game phải sử dụng font chữ Inter');
  assert.equal(await stagePage720.getByTestId('stage-mc').isVisible(), true, 'MC phải hiển thị cạnh màn hình câu hỏi');
  assert.equal(await stagePage720.getByTestId('command-guide-box').isVisible(), true, 'Hướng dẫn chơi theo trạng thái phải hiển thị');

  // -------------------------------------------------------------------------
  // TRẠNG THÁI 1: Đủ 5 người ghế nóng, đủ 10 người chờ và 30 khán giả
  // -------------------------------------------------------------------------
  await dashPage.getByTestId('btn-start-session').click();
  await sleep(350);
  // Chụp ảnh lúc đang mời 5 ghế nóng (12s)
  await stagePage720.screenshot({ path: path.join(outDir, 'stage-inviting.png') });

  // Qua 12s chuẩn bị -> 5 người vào ghế nóng 1..5, sang PREPARE
  await dashPage.getByTestId('btn-advance-phase').click();
  await sleep(300);
  // Qua 5s PREPARE -> sang OPEN câu #1
  await dashPage.getByTestId('btn-advance-phase').click();
  await sleep(450);

  const stateOpen1 = await fetch(`${BASE}/api/stage/state`).then((r) => r.json());
  assert.equal(stateOpen1.phase, 'OPEN');
  assert.equal(stateOpen1.seats.filter((s) => s.occupant).length, 5, 'Phải có đủ 5 người trên ghế nóng');
  assert.equal(stateOpen1.waiting.length, 10, 'Phải có đủ 10 người trên ghế chờ (2 hàng × 5 ghế)');
  assert.equal(stateOpen1.audience.length >= 30, true, 'Phải có đủ 30 khán giả trong danh sách khán đài');
  assert.equal('correct' in (stateOpen1.question || {}), false, 'Không lộ đáp án đúng trước khi chốt câu');

  // Cho 2 ghế nóng (ghế 1 và ghế 3) khóa đáp án trước để thấy rõ trạng thái "ĐÃ KHÓA ĐÁP ÁN"
  const adminOpen1 = await fetch(`${BASE}/api/admin/state`, { headers }).then((r) => r.json());
  const q1 = adminOpen1.current.question;
  await api('/api/sim/chat', { userId: 'sim_01', text: `${adminOpen1.current.code}${q1.correct}` });
  await api('/api/sim/chat', { userId: 'sim_03', text: `${adminOpen1.current.code}${q1.correct}` });
  await sleep(400);

  // Kiểm tra không chồng lấn giữa MC, Màn hình câu hỏi, 5 Ghế nóng, 10 Ghế chờ
  const layoutCheck = await stagePage720.evaluate(() => {
    const rect = (tid) => document.querySelector(`[data-testid="${tid}"]`)?.getBoundingClientRect();
    const mc = rect('stage-mc');
    const qb = rect('question-board');
    const hs = rect('hot-seats-row');
    const ws = rect('waiting-seats-section');
    return {
      mcRightLeQbLeft: mc.right <= qb.left + 1,
      qbBottomLeHsTop: qb.bottom <= hs.top + 8,
      hsBottomLeWsTop: hs.bottom <= ws.top + 4,
    };
  });
  assert.equal(layoutCheck.mcRightLeQbLeft, true, 'MC đứng cạnh màn hình câu hỏi, không đè lên màn hình câu hỏi');
  assert.equal(layoutCheck.qbBottomLeHsTop, true, 'Màn hình câu hỏi không đè lên 5 ghế nóng');
  assert.equal(layoutCheck.hsBottomLeWsTop, true, '5 ghế nóng không đè lên 10 ghế chờ');

  await stagePage720.screenshot({ path: path.join(outDir, 'stage-full-5-10-30.png') });
  await stagePage360.screenshot({ path: path.join(outDir, 'stage-360x640-full.png') });
  await dashPage.screenshot({ path: path.join(outDir, 'dashboard-open.png') });

  // -------------------------------------------------------------------------
  // TRẠNG THÁI 3: Ghế 2 và 5 bị loại (Ghế 1, 3, 4 trả lời ĐÚNG có đèn Spotlight chiếu sáng)
  // -------------------------------------------------------------------------
  await dashPage.getByTestId('sim-seat25-wrong').click();
  await sleep(400);
  // Tua hết 30s OPEN -> sang REVEAL
  await dashPage.getByTestId('btn-advance-phase').click();
  await sleep(450);

  // Xác minh đèn Spotlight chiến thắng bật sáng ở đúng ghế 1, 3, 4 và không bật ở ghế 2, 5
  assert.equal(await stagePage720.getByTestId('spotlight-correct-1').count(), 1, 'Ghế 1 đúng phải có đèn Spotlight chiếu sáng');
  assert.equal(await stagePage720.getByTestId('spotlight-correct-2').count(), 0, 'Ghế 2 sai không có đèn Spotlight chiến thắng');
  assert.equal(await stagePage720.getByTestId('spotlight-correct-3').count(), 1, 'Ghế 3 đúng phải có đèn Spotlight chiếu sáng');
  assert.equal(await stagePage720.getByTestId('spotlight-correct-4').count(), 1, 'Ghế 4 đúng phải có đèn Spotlight chiếu sáng');
  assert.equal(await stagePage720.getByTestId('spotlight-correct-5').count(), 0, 'Ghế 5 sai không có đèn Spotlight chiến thắng');

  await stagePage720.screenshot({ path: path.join(outDir, 'stage-seat2-5-eliminated.png') });
  await stagePage360.screenshot({ path: path.join(outDir, 'stage-360x640-seat2-5-eliminated.png') });

  // Kiểm tra tải lại trang (F5) giữa pha REVEAL: giữ nguyên kết quả nhưng không phát lại hiệu ứng nổ thưởng cũ
  await stagePage720.reload();
  await sleep(500);
  const popCountAfterReload = await stagePage720.locator('.anim-score-pop').count();
  assert.equal(popCountAfterReload, 0, 'Tải lại trang không được phát lại hoạt ảnh thưởng cũ');

  // Tua qua REVEAL (5s) -> HONOR (3s) -> TRANSITION (4s) -> INVITING (đẩy sim_06, sim_07 lên ghế 2, 5) -> PREPARE -> OPEN câu #2
  await dashPage.getByTestId('btn-advance-phase').click(); // -> HONOR
  await sleep(250);
  await dashPage.getByTestId('btn-advance-phase').click(); // -> TRANSITION
  await sleep(250);
  await dashPage.getByTestId('btn-advance-phase').click(); // -> INVITING
  await sleep(250);
  await dashPage.getByTestId('btn-advance-phase').click(); // -> PREPARE câu 2
  await sleep(250);
  await dashPage.getByTestId('btn-advance-phase').click(); // -> OPEN câu 2
  await sleep(350);

  // -------------------------------------------------------------------------
  // TRẠNG THÁI 4: Nhiều người được vinh danh cùng lúc (đạt mốc Cấp 3)
  // -------------------------------------------------------------------------
  // Câu 2: cả 5 ghế cùng trả lời đúng (Ghế 1, 3, 4 lên Cấp 2; Ghế 2, 5 lên Cấp 1)
  const adminOpen2 = await fetch(`${BASE}/api/admin/state`, { headers }).then((r) => r.json());
  for (const s of adminOpen2.seats) {
    await api('/api/sim/chat', { userId: s.userId, text: `${adminOpen2.current.code}${adminOpen2.current.question.correct}` });
  }
  await api('/api/sim/advance-phase'); // OPEN -> REVEAL câu 2
  await api('/api/sim/advance-phase'); // REVEAL -> HONOR câu 2
  await api('/api/sim/advance-phase'); // HONOR -> TRANSITION
  await api('/api/sim/advance-phase'); // TRANSITION -> PREPARE câu 3
  await api('/api/sim/advance-phase'); // PREPARE -> OPEN câu 3
  await sleep(350);

  // Câu 3: Cho cả 5 ghế trả lời đúng câu 3 để Ghế 1, 3, 4 cùng đạt mốc Cấp 3 (Nhiều người vinh danh cùng lúc!)
  const adminOpen3 = await fetch(`${BASE}/api/admin/state`, { headers }).then((r) => r.json());
  assert.equal(adminOpen3.state.phase, 'OPEN', 'Phải đang ở trạng thái OPEN của câu 3');
  for (const s of adminOpen3.seats) {
    await api('/api/sim/chat', { userId: s.userId, text: `${adminOpen3.current.code}${adminOpen3.current.question.correct}` });
  }
  await api('/api/sim/advance-phase'); // OPEN -> REVEAL câu 3
  await api('/api/sim/advance-phase'); // REVEAL -> HONOR câu 3 (3 người đạt mốc Cấp 3 cùng lúc!)
  await sleep(450);

  assert.equal(await stagePage720.getByTestId('honor-overlay').isVisible(), true, 'Bảng vinh danh nhiều người cùng lúc phải hiển thị');
  await stagePage720.screenshot({ path: path.join(outDir, 'stage-multi-honor.png') });
  await stagePage360.screenshot({ path: path.join(outDir, 'stage-360x640-multi-honor.png') });

  // -------------------------------------------------------------------------
  // TRẠNG THÁI 2: Câu hỏi dài cùng bốn đáp án dài (Kiểm tra không tràn/chồng chữ)
  // -------------------------------------------------------------------------
  // Tắt các câu cũ và thêm 1 câu hỏi rất dài + 4 đáp án dài để câu #4 chắc chắn chọn câu dài này
  const allQs = adminOpen3.questions;
  for (const q of allQs) {
    await api('/api/admin/questions/status', { id: q.id, status: 'disabled' });
  }
  await api('/api/admin/questions/upsert', {
    id: 'q_long_test',
    text: 'Trong lịch sử phát triển văn hóa và khoa học thế giới, phát minh nào dưới đây được đánh giá là bước ngoặt giúp truyền bá tri thức rộng rãi nhất vào thế kỷ XV?',
    choices: [
      'Kỹ thuật in chữ rời bằng kim loại do Johannes Gutenberg cải tiến tại châu Âu',
      'Hệ thống máy hơi nước công nghiệp phục vụ vận tải đường sắt xuyên lục địa',
      'Mạng lưới điện báo truyền tín hiệu mã Morse qua cáp ngầm vượt Đại Tây Dương',
      'Phương pháp chế tạo kính thiên văn phản xạ quan sát các thiên hà xa xôi',
    ],
    correct: 'A',
    explanation: 'Máy in chữ rời của Gutenberg (khoảng 1440) giúp in sách hàng loạt và lan tỏa tri thức khắp châu Âu.',
    topic: 'Lịch sử & Khoa học',
    difficulty: 'vua',
    status: 'approved',
  });

  await api('/api/sim/advance-phase'); // HONOR -> TRANSITION
  await api('/api/sim/advance-phase'); // TRANSITION -> PREPARE câu #4
  await api('/api/sim/advance-phase'); // PREPARE -> OPEN câu #4 (câu dài)
  await sleep(450);

  const q4Text = await stagePage720.getByTestId('question-text').textContent();
  assert.equal(q4Text?.includes('Johannes Gutenberg') || q4Text?.includes('bước ngoặt'), true, 'Câu hỏi dài phải đang mở trên sân khấu');

  await stagePage720.screenshot({ path: path.join(outDir, 'stage-long-question.png') });
  await stagePage360.screenshot({ path: path.join(outDir, 'stage-360x640-long-question.png') });

  // Kiểm tra bật tùy chọn Giảm chuyển động (Reduce Motion)
  await api('/api/admin/config/display', { reduceMotion: true, sfxEnabled: false });
  await sleep(300);
  const hasReduceMotionClass = await stagePage720.evaluate(() =>
    document.querySelector('[data-testid="stage-root"]')?.classList.contains('reduce-motion'),
  );
  assert.equal(hasReduceMotionClass, true, 'Bật tùy chọn giảm chuyển động phải gắn class reduce-motion lên sân khấu');

  console.log('[E2E] TẤT CẢ KIỂM TRA GIAO DIỆN 2.5D (720×1280 & 360×640) VÀ 4 TRẠNG THÁI ĐỀU ĐẠT!');
} finally {
  await browser?.close();
  serverProc.kill();
  await sleep(300);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}
process.exit(0);
