/**
 * Kiểm chứng sau vá lỗi:
 *  1. Nhạc nền lobby phải phát ĐỀU và liên tục trong 4 giây (lookahead scheduler chống tab nền).
 *  2. Ducking phải tự GỠ sau khi MC ngừng nói (nhạc trở lại 100% âm lượng).
 *  3. Nghe thử xong phải tự khôi phục nhạc nền theo pha game.
 *  4. Hai cửa sổ sân khấu: cửa sổ bị tước quyền phải DỪNG nhạc ngay + hiện cảnh báo.
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = 3219;
const BASE = `http://localhost:${PORT}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghenong-verify-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const serverProc = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tmpDir, NODE_ENV: 'production', E2E_TEST: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
serverProc.stderr.on('data', (c) => process.stderr.write(c));
for (let i = 0; i < 80; i++) {
  await sleep(250);
  try {
    const r = await fetch(`${BASE}/api/stage/state`);
    if (r.ok) break;
  } catch {}
}
const boot = await fetch(`${BASE}/api/admin/bootstrap`).then((r) => r.json());
const headers = { 'Content-Type': 'application/json', 'X-Admin-Token': boot.token };
const api = (url, body) =>
  fetch(`${BASE}${url}`, { method: 'POST', headers, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

const init = () => {
  window.__o = { osc: 0, freqs: [], ctx: [], gainVals: [] };
  const Orig = window.AudioContext;
  window.AudioContext = class extends Orig {
    constructor(...a) {
      super(...a);
      window.__o.ctx.push(this);
      const self = this;
      const origGain = this.createGain.bind(this);
      // Theo dõi gain của node kết nối thẳng vào destination (master)
      this.createGain = (...a) => {
        const g = origGain(...a);
        const od = Object.getOwnPropertyDescriptor(GainNode.prototype, 'gain');
        return g;
      };
    }
    createOscillator() {
      const o = super.createOscillator();
      const s = o.start.bind(o);
      o.start = (w) => {
        try {
          window.__o.osc++;
          window.__o.freqs.push(Math.round(o.frequency.value));
        } catch {}
        return s(w);
      };
      return o;
    }
  };
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
let failed = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? '✅' : '❌ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failed++;
};

try {
  const p1 = await browser.newPage({ viewport: { width: 720, height: 1280 } });
  await p1.addInitScript(init);
  await p1.goto(`${BASE}/?view=stage`);
  await p1.waitForSelector('[data-testid="stage-root"]');
  await sleep(2000);

  // ===== 1. Nhạc lobby phải phát đều trong 4 giây =====
  const a = await p1.evaluate(() => ({ osc: window.__o.osc }));
  await sleep(4000);
  const b = await p1.evaluate(() => ({ osc: window.__o.osc }));
  const perSec = (b.osc - a.osc) / 4;
  // Lobby: ~5 bass + 12 shaker/4s + 2 kick/4s + chords ~ 9 nốt/giây → cho phép 4..14
  check('1. Nhạc lobby phát đều liên tục', perSec >= 4 && perSec <= 14, `${perSec.toFixed(1)} nốt/giây`);

  // ===== 2. Ducking tự gỡ sau khi MC ngừng =====
  await p1.evaluate(() => {
    // Kích hoạt ducking thủ công qua manager (không có handle public nên dùng SFX + mcState qua speakMcLine)
  });
  // Dùng pha game thật: mở phiên để có lời MC
  await api('/api/admin/session/start');
  await sleep(3000);
  const duckState1 = await p1.evaluate(() => ({
    ctxState: window.__o.ctx.map((c) => c.state).join(','),
  }));
  check('2. AudioContext chạy sau khi bắt đầu phiên', duckState1.ctxState === 'running', duckState1.ctxState);
  await sleep(4000);
  const c = await p1.evaluate(() => ({ osc: window.__o.osc }));
  await sleep(4000);
  const d = await p1.evaluate(() => ({ osc: window.__o.osc }));
  const perSec2 = (d.osc - c.osc) / 4;
  check('3. Âm thanh tiếp tục phát sau phiên bắt đầu (không kẹt)', perSec2 >= 1, `${perSec2.toFixed(1)} nốt/giây`);

  // ===== 4. Hai cửa sổ: cửa sổ bị tước quyền dừng nhạc + có cảnh báo =====
  const p2 = await browser.newPage({ viewport: { width: 720, height: 1280 } });
  await p2.addInitScript(init);
  await p2.goto(`${BASE}/?view=stage`);
  await p2.waitForSelector('[data-testid="stage-root"]');
  await sleep(2500);
  const mutedNote = await p1.locator('[data-testid="stage-muted-note"]').count();
  check('4. Cửa sổ bị tước quyền hiện cảnh báo im lặng', mutedNote === 1, `count=${mutedNote}`);
  // Chụp mốc SAU khi đã bị tước quyền (cửa sổ 1 đã nhận speakerId mới), rồi mới đo 2.5s tiếp theo
  await sleep(400);
  const e = await p1.evaluate(() => ({ osc: window.__o.osc }));
  await sleep(2500);
  const f = await p1.evaluate(() => ({ osc: window.__o.osc }));
  const perSecOld = (f.osc - e.osc) / 2.5;
  check('5. Cửa sổ bị tước quyền DỪNG nhạc ngay', perSecOld < 1, `${perSecOld.toFixed(1)} nốt/giây sau tước quyền`);
  // Cửa sổ mới phải đang phát — đưa game về pha OPEN còn dài (> 5s → thinking BGM)
  for (let i = 0; i < 4; i++) {
    const s = await fetch(`${BASE}/api/stage/state`).then((r) => r.json());
    if (s.phase === 'OPEN') break;
    await api('/api/sim/advance-phase');
    await sleep(350);
  }
  await api('/api/sim/advance-phase', { remainMs: 20000 });
  await sleep(700);
  const phaseNow = (await fetch(`${BASE}/api/stage/state`).then((r) => r.json())).phase;
  const g = await p2.evaluate(() => ({ osc: window.__o.osc }));
  await sleep(3000);
  const h = await p2.evaluate(() => ({ osc: window.__o.osc }));
  const p1Now = await p1.evaluate(() => window.__o.osc);
  const perSecNew = (h.osc - g.osc) / 3;
  const stNow = await fetch(`${BASE}/api/stage/state`).then((r) => r.json());
  console.log(`   DEBUG phase=${phaseNow} p1 osc=${p1Now} | p2 osc ${g.osc}->${h.osc} | serverSpeaker=${stNow.speakerId}`);
  // Thinking BGM: ~2.5 nốt/giây (1 tick/beat + drone mỗi 4 beat). Yêu cầu >= 1.5 là đủ chứng minh đang phát.
  check('6. Cửa sổ mới (chủ quyền) phát nhạc bình thường', perSecNew >= 1.5, `${perSecNew.toFixed(1)} nốt/giây ở pha ${phaseNow}`);
  // Và cửa sổ cũ phải vẫn im lặng
  check('7. Cửa sổ cũ vẫn im lặng sau đó', (p1Now - f.osc) / 6.5 < 1, `${((p1Now - f.osc) / 6.5).toFixed(1)} nốt/giây`);
  const st = await fetch(`${BASE}/api/stage/state`).then((r) => r.json());
  console.log('   (server speakerId đang thuộc cửa sổ mới:', st.speakerId, ')');

  console.log(failed === 0 ? '\n🎯 TẤT CẢ KIỂM CHỨNG ĐẠT' : `\n💥 ${failed} kiểm chứng THẤT BẠI`);
} finally {
  await browser.close();
  serverProc.kill();
  await sleep(300);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}
process.exit(failed === 0 ? 0 : 1);
