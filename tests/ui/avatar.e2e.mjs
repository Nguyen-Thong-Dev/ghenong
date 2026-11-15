/**
 * Kiểm tra tự động: avatar người xem hiển thị ở ghế nóng / ghế chờ / khán đài và tab cấu hình quà.
 * Chạy: npm run test:avatar
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = 3308;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghenong-avatar-test-'));
const outDir = path.resolve('test-results');
fs.mkdirSync(outDir, { recursive: true });

// PNG 8x8 đỏ (avatar giả)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVQI12P8z8Dwn4EIwDiqkL4KAEa0Av8fN4zPAAAAAElFTkSuQmCC',
  'base64',
);

const serverProc = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tmpDir, NODE_ENV: 'production', E2E_TEST: '1', DISABLE_SIM: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
serverProc.stderr.on('data', (c) => process.stderr.write(c));
let ready = false;
for (let i = 0; i < 80 && !ready; i++) {
  await sleep(300);
  try {
    ready = (await fetch(`${BASE}/api/stage/state`)).ok;
  } catch {}
}
assert.equal(ready, true, 'Máy chủ test phải sẵn sàng');

let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const boot = await fetch(`${BASE}/api/admin/bootstrap`).then((r) => r.json());
  const headers = { 'Content-Type': 'application/json', 'X-Admin-Token': boot.token };
  const api = (url, body) =>
    fetch(`${BASE}${url}`, { method: 'POST', headers, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

  const ctx = await browser.newContext({ viewport: { width: 720, height: 1280 } });
  // Phục vụ avatar giả cho mọi URL avatar-test; URL hỏng trả 404 để thử dự phòng
  await ctx.route('**/avatar-test/**', (route) =>
    route.request().url().includes('broken')
      ? route.fulfill({ status: 404, body: 'x' })
      : route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
  );
  const stage = await ctx.newPage();
  await stage.goto(`${BASE}/?view=stage&mute=1`);
  await stage.waitForSelector('[data-testid="stage-root"]');

  // 7 người vào: 5 lên ghế nóng, 1 chờ, 1 ảnh hỏng; thêm khán giả
  const users = [];
  for (let i = 1; i <= 9; i++) users.push(`avt_${i}`);
  for (const [i, u] of users.entries()) {
    const broken = u === 'avt_7';
    await api('/api/sim/chat', {
      userId: u,
      nickname: `Khan ${i + 1}`,
      avatar: `http://example.test/avatar-test/${broken ? 'broken' : 'ok'}_${i}.png`,
      text: 'vào',
    });
  }
  await api('/api/admin/session/start').catch(() => null);
  await sleep(1500);

  const countAvatars = () => stage.locator('[data-testid="avatar-image"]').count();
  let n = 0;
  for (let i = 0; i < 20 && n < 5; i++) {
    n = await countAvatars();
    if (n < 5) await sleep(500);
  }
  console.log('[AVATAR-E2E] Số avatar đang hiển thị trên sân khấu:', n);
  assert.ok(n >= 5, 'Phải hiển thị avatar thật (ghế nóng/chờ/khán giả), thấy ' + n);

  // Ảnh lỗi phải rơi về mặt hoạt hình: không có <image> trỏ tới URL broken
  const hrefs = await stage.locator('[data-testid="avatar-image"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  assert.equal(hrefs.some((h) => h && h.includes('broken')), false, 'Avatar lỗi phải dùng mặt hoạt hình dự phòng');
  await stage.screenshot({ path: path.join(outDir, 'stage-avatars.png') });

  // Tab quà
  const dash = await ctx.newPage();
  await dash.setViewportSize({ width: 1440, height: 900 });
  await dash.goto(BASE);
  await dash.waitForSelector('[data-testid="tab-gifts"]');
  await dash.click('[data-testid="tab-gifts"]');
  await dash.waitForSelector('[data-testid="gift-panel"]');
  await dash.fill('[data-testid="gift-id-input"]', '5655');
  await dash.fill('[data-testid="gift-name-input"]', 'Hoa hồng');
  await dash.selectOption('[data-testid="gift-action-select"]', 'protect_answer');
  await dash.click('[data-testid="gift-save"]');
  await dash.waitForFunction(() => document.querySelector('[data-testid="gift-panel"]')?.textContent?.includes('Hoa hồng'));
  const admin = await fetch(`${BASE}/api/admin/state`, { headers }).then((r) => r.json()).catch(() => null);
  if (admin?.gifts) {
    const c = admin.gifts.config.find((x) => x.giftId === '5655');
    assert.ok(c && c.action === 'protect_answer' && c.enabled, 'Cấu hình quà phải được lưu');
  }
  assert.equal(await stage.locator('[data-testid="gift-panel"]').count(), 0, 'Tab quà không được hiện trên sân khấu live');
  await dash.screenshot({ path: path.join(outDir, 'dashboard-gifts.png') });

  console.log('[AVATAR-E2E] TẤT CẢ KIỂM TRA AVATAR & CẤU HÌNH QUÀ ĐỀU ĐẠT!');
} finally {
  await browser?.close();
  serverProc.kill();
}
process.exit(0);
