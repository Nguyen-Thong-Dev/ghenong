/**
 * Probe chẩn đoán âm thanh: đo xem Web Audio có thực sự tạo & phát nốt hay không.
 * - Bọc AudioContext.createOscillator để đếm số nốt, tần số, gain, thời điểm.
 * - Đo trạng thái AudioContext (suspended/running), gain của master/bgm/sfx.
 * Chạy: node scripts/probe-audio.mjs
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = 3211;
const BASE = `http://localhost:${PORT}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghenong-probe-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const serverProc = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tmpDir, NODE_ENV: 'production', E2E_TEST: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
serverProc.stderr.on('data', (c) => process.stderr.write(c));

for (let i = 0; i < 60; i++) {
  await sleep(300);
  try {
    const r = await fetch(`${BASE}/api/stage/state`);
    if (r.ok) break;
  } catch {}
}

const boot = await fetch(`${BASE}/api/admin/bootstrap`).then((r) => r.json());
const headers = { 'Content-Type': 'application/json', 'X-Admin-Token': boot.token };
const api = (url, body) =>
  fetch(`${BASE}${url}`, { method: 'POST', headers, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });

  // Bọc AudioContext TRƯỚC khi app nạp
  await page.addInitScript(() => {
    window.__osc = [];
    window.__ctxs = [];
    const Orig = window.AudioContext;
    class Wrapped extends Orig {
      constructor(...a) {
        super(...a);
        window.__ctxs.push(this);
        this.addEventListener?.('statechange', () => window.__osc.push({ kind: 'state', state: this.state, t: performance.now() }));
      }
      createOscillator() {
        const o = super.createOscillator();
        const rec = { kind: 'osc', freq: null, type: null, t: performance.now(), started: false, stopped: false };
        const origStart = o.start.bind(o);
        const origStop = o.stop.bind(o);
        try {
          o.frequency.addEventListener?.('value', () => {});
        } catch {}
        // ghi lại tần số tại thời điểm start()
        o.start = (when) => {
          try {
            rec.freq = o.frequency.value;
            rec.type = o.type;
          } catch {}
          rec.started = true;
          rec.startedAt = performance.now();
          return origStart(when);
        };
        o.stop = (when) => { rec.stopped = true; return origStop(when); };
        window.__osc.push(rec);
        return o;
      }
    }
    window.AudioContext = Wrapped;
    window.webkitAudioContext = Wrapped;
  });

  await page.goto(`${BASE}/?view=stage`);
  await page.waitForSelector('[data-testid="stage-root"]');
  await sleep(1500);

  const snap = async (label) => {
    const r = await page.evaluate(() => ({
      ctxs: window.__ctxs.length,
      state: window.__ctxs.map((c) => c.state),
      sampleRate: window.__ctxs.map((c) => c.sampleRate),
      oscTotal: window.__osc.filter((o) => o.kind === 'osc').length,
      oscStarted: window.__osc.filter((o) => o.kind === 'osc' && o.started).length,
      freqs: window.__osc.filter((o) => o.kind === 'osc' && o.started).slice(-12).map((o) => o.freq),
      events: window.__osc.filter((o) => o.kind === 'state'),
      hasAudioMgr: typeof window.__audioManager !== 'undefined',
    }));
    console.log(`\n[${label}]`, JSON.stringify({ ...r, freqs: r.freqs.map((f) => (f ? Math.round(f) : f)) }, null, 0));
    return r;
  };

  await snap('A. NO_SESSION (STANDBY/lobby BGM dự kiến)');

  // Bắt đầu phiên -> INVITING
  await api('/api/admin/session/start');
  await sleep(2500);
  await snap('B. INVITING (lobby BGM dự kiến)');

  // Qua inviting -> PREPARE -> OPEN
  await api('/api/sim/advance-phase');
  await sleep(600);
  await api('/api/sim/advance-phase');
  await sleep(3000);
  await snap('C. OPEN (thinking BGM + đếm ngược dự kiến)');

  // Đẩy tới 4s còn lại để có SFX đếm ngược
  await api('/api/sim/advance-phase', { remainMs: 4200 });
  await sleep(2500);
  await snap('D. OPEN còn ~4s (SFX đếm ngược dự kiến)');

  // Reveal
  await api('/api/sim/advance-phase');
  await sleep(1200);
  await snap('E. REVEAL (SFX công bố dự kiến)');
} finally {
  await browser.close();
  serverProc.kill();
  await sleep(300);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}
process.exit(0);
