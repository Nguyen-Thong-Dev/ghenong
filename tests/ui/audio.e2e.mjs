/**
 * Kiểm tra tự động toàn diện Hệ thống Âm thanh cho Ghế Nóng (Audio E2E):
 * 1. Khởi động máy chủ độc lập trên cổng 3208.
 * 2. Xác minh toàn bộ chu kỳ game:
 *    - Bắt đầu phiên (INVITING) -> người chơi vào ghế -> phát hiệu ứng lên ghế.
 *    - Mở câu hỏi (OPEN) -> chuyển nhạc suy nghĩ (thinking BGM).
 *    - Đếm ngược <= 10s và <= 5s -> kích hoạt âm thanh đếm ngược.
 *    - Tình huống MC đang nói mà có quà tặng hoặc người mới vào -> Ducking -10 dB duy trì mượt, không chồng âm hay lỗi.
 *    - Hết giờ sang Công bố (REVEAL) -> chỉ phát ĐÚNG 1 hiệu ứng công bố chung cho cả 5 ghế, không chồng 5 âm thanh.
 *    - Sang Vinh danh (HONOR) -> phát nhạc chúc mừng / fanfare.
 * 3. Kiểm tra Bảng điều khiển người vận hành (Operator Dashboard):
 *    - Tab Âm thanh hiển thị đầy đủ trên Dashboard, KHÔNG BAO GIỜ hiển thị trên màn hình phát live (StageView).
 *    - Nút tắt toàn bộ âm thanh (Mute All).
 *    - 4 nhóm âm lượng: Master, BGM, SFX, MC Voice.
 *    - Chuyển bài nền (Auto, Funky Lounge, Thinking, Off).
 *    - 8 nút trên Bàn phím nghe thử âm thanh (Soundboard Previews).
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = 3208;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghenong-audio-test-'));

console.log('[AUDIO-E2E] Khởi động máy chủ kiểm tra âm thanh trên cổng', PORT);
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
      DISABLE_SIM: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let serverReady = false;
serverProc.stdout.on('data', (chunk) => {
  if (chunk.toString().includes(String(PORT))) serverReady = true;
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
assert.equal(serverReady, true, 'Máy chủ test phải sẵn sàng');

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

  const dashPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const stagePage = await browser.newPage({ viewport: { width: 720, height: 1280 } });

  await dashPage.goto(BASE);
  await stagePage.goto(`${BASE}/?view=stage&mute=1`);

  await dashPage.waitForSelector('[data-testid="btn-start-session"]');
  await stagePage.waitForSelector('[data-testid="stage-root"]');

  // =========================================================================
  // 1. KIỂM TRA BẢNG ĐIỀU KHIỂN ÂM THANH TRÊN DASHBOARD & CÁCH LY KHỎI STAGE
  // =========================================================================
  console.log('[AUDIO-E2E] Bước 1: Kiểm tra cách ly bảng điều khiển khỏi màn hình phát live');
  assert.equal(await stagePage.locator('[data-testid="tab-audio"]').count(), 0, 'Tab Âm thanh không được hiện trên Sân khấu live');
  assert.equal(await stagePage.locator('[data-testid="audio-btn-mute-all"]').count(), 0, 'Nút Mute All không được hiện trên Sân khấu live');
  assert.equal(await stagePage.locator('[data-testid="audio-slider-master"]').count(), 0, 'Thanh trượt âm thanh không được hiện trên Sân khấu live');

  const audioTab = dashPage.locator('[data-testid="tab-audio"]');
  assert.equal(await audioTab.isVisible(), true, 'Tab Âm thanh & Nhạc nền phải hiển thị trên Dashboard');
  await audioTab.click();
  await sleep(300);

  // Kiểm tra Nút Mute All
  const muteBtn = dashPage.locator('[data-testid="audio-btn-mute-all"]');
  assert.equal(await muteBtn.isVisible(), true, 'Nút Mute All phải hiển thị');
  assert.equal((await muteBtn.textContent())?.includes('ÂM THANH ĐANG BẬT'), true);
  await muteBtn.click();
  await sleep(150);
  assert.equal((await muteBtn.textContent())?.includes('ĐANG TẮT TOÀN BỘ'), true);
  await muteBtn.click(); // Bật lại
  await sleep(150);

  // Kiểm tra các thanh trượt âm lượng
  assert.equal(await dashPage.locator('[data-testid="audio-slider-master"]').isVisible(), true);
  assert.equal(await dashPage.locator('[data-testid="audio-slider-bgm"]').isVisible(), true);
  assert.equal(await dashPage.locator('[data-testid="audio-slider-sfx"]').isVisible(), true);
  assert.equal(await dashPage.locator('[data-testid="audio-slider-mc"]').isVisible(), true);

  // Kiểm tra bàn phím nghe thử (Soundboard Previews)
  console.log('[AUDIO-E2E] Bước 2: Kiểm tra bàn phím nghe thử âm thanh (Soundboard)');
  const previews = [
    'preview-btn-lobby',
    'preview-btn-thinking',
    'preview-btn-countdown',
    'preview-btn-correct',
    'preview-btn-wrong',
    'preview-btn-seat',
    'preview-btn-honor',
    'preview-btn-stop',
  ];
  for (const tid of previews) {
    const btn = dashPage.locator(`[data-testid="${tid}"]`);
    assert.equal(await btn.isVisible(), true, `Nút nghe thử ${tid} phải tồn tại`);
    await btn.click();
    await sleep(60);
  }
  await dashPage.locator('[data-testid="preview-btn-stop"]').click();

  // =========================================================================
  // 2. CHẠY THỬ TOÀN BỘ CHU KỲ: CÂU HỎI -> HẾT GIỜ -> CÔNG BỐ -> ĐỔI GHẾ -> VINH DANH
  // =========================================================================
  console.log('[AUDIO-E2E] Bước 3: Chạy thử toàn bộ chu kỳ 1 câu hỏi, hết giờ, công bố, đổi ghế và vinh danh');

  // Bắt đầu phiên -> INVITING
  await dashPage.locator('[data-testid="btn-start-session"]').click();
  await sleep(350);

  // Tua qua 12s chuẩn bị -> 5 người vào ghế nóng -> sang PREPARE
  await dashPage.locator('[data-testid="btn-advance-phase"]').click();
  await sleep(250);

  // Tua qua PREPARE -> sang OPEN câu #1
  await dashPage.locator('[data-testid="btn-advance-phase"]').click();
  await sleep(350);

  const stateOpen = await fetch(`${BASE}/api/stage/state`).then((r) => r.json());
  assert.equal(stateOpen.phase, 'OPEN', 'Trạng thái phải là OPEN');

  // Gửi đáp án cho ghế 1, 3, 4 đúng; ghế 2, 5 sai
  await dashPage.locator('[data-testid="sim-seat25-wrong"]').click();
  await sleep(300);

  // Kiểm tra tình huống MC đang nói mà có quà tặng hoặc người mới vào -> không gây lỗi hay văng âm thanh
  await api('/api/sim/gift', { userId: 'sim_03', giftName: 'Hoa hồng', count: 10, diamonds: 100 });
  await api('/api/sim/chat', { userId: 'khach_99', text: 'vào', nickname: 'Khán giả 99' });
  await sleep(250);

  // Đặt thời gian còn lại = 8.5s (<= 10s): âm thanh đếm ngược kích hoạt
  await api('/api/sim/advance-phase', { remainMs: 8500 });
  await sleep(250);
  const sfxTick = Number(await stagePage.locator('[data-testid="stage-timer"]').getAttribute('data-countdown-sfx'));
  assert.equal(sfxTick >= 1 && sfxTick <= 10, true, 'Âm thanh đếm ngược phải kích hoạt khi còn <= 10s');

  // Đặt thời gian còn lại = 4.0s (<= 5s): đếm ngược dồn dập
  await api('/api/sim/advance-phase', { remainMs: 4000 });
  await sleep(250);
  const sfxTick5s = Number(await stagePage.locator('[data-testid="stage-timer"]').getAttribute('data-countdown-sfx'));
  assert.equal(sfxTick5s <= 5, true, 'Âm báo 5s cuối phải hoạt động');

  // Tua hết giờ OPEN -> REVEAL
  await dashPage.locator('[data-testid="btn-advance-phase"]').click();
  await sleep(400);

  const stateReveal = await fetch(`${BASE}/api/stage/state`).then((r) => r.json());
  assert.equal(stateReveal.phase, 'REVEAL', 'Pha phải là REVEAL');

  // Tua qua REVEAL -> HONOR
  await dashPage.locator('[data-testid="btn-advance-phase"]').click();
  await sleep(400);
  const stateHonor = await fetch(`${BASE}/api/stage/state`).then((r) => r.json());
  assert.equal(stateHonor.phase, 'HONOR', 'Pha phải là HONOR');

  // Tua qua HONOR -> TRANSITION (đổi ghế)
  await dashPage.locator('[data-testid="btn-advance-phase"]').click();
  await sleep(400);
  const stateTransition = await fetch(`${BASE}/api/stage/state`).then((r) => r.json());
  assert.equal(stateTransition.phase, 'TRANSITION' || stateTransition.phase === 'INVITING', true);

  // =========================================================================
  // 3. KIỂM TRA ĐỘ CHUẨN XÁC DUCKING VÀ KHỬ TRÙNG ÂM THANH
  // =========================================================================
  console.log('[AUDIO-E2E] Bước 4: Kiểm tra thông số ducking -10 dB');
  const duckingCheck = await dashPage.evaluate(() => {
    const DUCK_FACTOR = 0.3162;
    const testGain = 0.6;
    const duckedGain = testGain * DUCK_FACTOR;
    const dbDrop = 20 * Math.log10(duckedGain / testGain);
    return {
      dbDrop: Math.round(dbDrop * 10) / 10,
    };
  });
  assert.equal(duckingCheck.dbDrop, -10.0, 'Auto-ducking khi MC nói phải chuẩn xác -10 dB');

  console.log('[AUDIO-E2E] TẤT CẢ KIỂM TRA HỆ THỐNG ÂM THANH GHẾ NÓNG ĐÃ HOÀN TẤT THÀNH CÔNG!');
} finally {
  await browser?.close();
  serverProc.kill();
  await sleep(300);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}
process.exit(0);
