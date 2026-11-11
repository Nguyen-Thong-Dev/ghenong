import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = 3209;
const BASE = `http://localhost:${PORT}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghenong-snap-'));
const artifactDir = 'C:\\Users\\HP\\.gemini\\antigravity\\brain\\e569a200-f0f1-4778-88b5-c78c6dad2959';

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

for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try {
    const res = await fetch(`${BASE}/api/stage/state`);
    if (res.ok) break;
  } catch {}
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE);
  await page.waitForSelector('[data-testid="tab-audio"]');
  await page.locator('[data-testid="tab-audio"]').click();
  await new Promise((r) => setTimeout(r, 600));

  const out1 = path.join(artifactDir, 'dashboard-audio-tab.png');
  const out2 = path.resolve('test-results', 'dashboard-audio-tab.png');
  fs.mkdirSync(path.dirname(out2), { recursive: true });

  await page.screenshot({ path: out1 });
  await page.screenshot({ path: out2 });
  console.log('Saved dashboard audio tab screenshot to:', out1);
} finally {
  await browser.close();
  serverProc.kill();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}
