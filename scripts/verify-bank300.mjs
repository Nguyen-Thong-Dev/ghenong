/**
 * Kiểm chứng tích hợp ngân hàng 300 câu qua máy chủ thật:
 *  - Khởi động server với DB trống -> tự nạp 300 câu GN + 20 câu mẫu.
 *  - Bảng điều khiển thấy đủ 300+ câu, tất cả đã duyệt.
 *  - Chạy 12 câu liên tiếp: không lặp câu, không bao giờ rơi vào NO_QUESTIONS.
 *  - Sân khấu không lộ đáp án đúng khi đang OPEN.
 */
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = 3231;
const BASE = `http://localhost:${PORT}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghenong-bank-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const serverProc = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: tmpDir, NODE_ENV: 'production', E2E_TEST: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
serverProc.stdout.on('data', (c) => { out += c.toString(); });
serverProc.stderr.on('data', (c) => process.stderr.write(c));

let ready = false;
for (let i = 0; i < 100; i++) {
  await sleep(250);
  try { const r = await fetch(`${BASE}/api/stage/state`); if (r.ok) { ready = true; break; } } catch {}
}
assert.equal(ready, true, 'Máy chủ phải sẵn sàng');

let failed = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? '✅' : '❌ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failed++;
};

try {
  check('1. Log khởi động báo nạp ngân hàng', /Đã nạp ngân hàng câu hỏi khởi đầu: 300 câu GN/.test(out), out.split('\n').find((l) => l.includes('ngân hàng')) || '(không thấy)');

  const boot = await fetch(`${BASE}/api/admin/bootstrap`).then((r) => r.json());
  const headers = { 'Content-Type': 'application/json', 'X-Admin-Token': boot.token };
  const api = (url, body) =>
    fetch(`${BASE}${url}`, { method: 'POST', headers, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
  const admin0 = await fetch(`${BASE}/api/admin/state`, { headers }).then((r) => r.json());

  const gn = admin0.questions.filter((q) => q.id.startsWith('GN'));
  check('2. Dashboard thấy 300 câu GN', gn.length === 300, `${gn.length} câu`);
  check('3. Tất cả câu GN đã duyệt', gn.every((q) => q.status === 'approved'), `số chưa duyệt: ${gn.filter((q) => q.status !== 'approved').length}`);
  check('4. Giữ 20 câu mẫu cũ', admin0.questions.filter((q) => q.id.startsWith('q')).length === 20);
  check('5. Không trùng ID toàn ngân hàng', new Set(admin0.questions.map((q) => q.id)).size === admin0.questions.length);
  const topics = new Set(gn.map((q) => q.topic));
  check('6. Đủ 12 chủ đề', topics.size === 12, `${topics.size} chủ đề: ${[...topics].join(' | ')}`);

  // Chạy 12 câu liên tiếp
  await api('/api/admin/session/start');
  await sleep(400);
  await api('/api/sim/advance-phase');
  await sleep(300);

  const seen = [];
  for (let i = 0; i < 12; i++) {
    let st = await fetch(`${BASE}/api/stage/state`).then((r) => r.json());
    // đảm bảo đang OPEN
    for (let k = 0; k < 6 && st.phase !== 'OPEN'; k++) {
      await api('/api/sim/advance-phase');
      await sleep(250);
      st = await fetch(`${BASE}/api/stage/state`).then((r) => r.json());
    }
    assert.equal(st.phase, 'OPEN', `Lần ${i + 1}: phải vào được OPEN`);
    seen.push(st.question.code);

    // Sân khấu không lộ đáp án khi đang OPEN
    const leak = await fetch(`${BASE}/api/stage/state`).then((r) => r.json());
    check(`7.${i + 1} Không lộ đáp án khi OPEN`, leak.reveal === null && !('correct' in (leak.question || {})), `reveal=${JSON.stringify(leak.reveal)}`);

    // gửi đáp án đúng cho ghế 1..5 rồi tua qua câu
    const admin = await fetch(`${BASE}/api/admin/state`, { headers }).then((r) => r.json());
    const q = admin.current.question;
    for (const s of admin.seats) {
      if (!s.userId) continue;
      await api('/api/sim/chat', { userId: s.userId, text: `${st.question.code}${q.correct}` });
    }
    await api('/api/sim/advance-phase'); // OPEN -> REVEAL
    await sleep(200);
    await api('/api/sim/advance-phase'); // REVEAL -> HONOR
    await sleep(200);
    await api('/api/sim/advance-phase'); // HONOR -> TRANSITION
    await sleep(200);
    await api('/api/sim/advance-phase'); // TRANSITION -> mời/chuyển
    await sleep(200);
    let s2 = await fetch(`${BASE}/api/stage/state`).then((r) => r.json());
    // vượt INVITING nếu có
    for (let k = 0; k < 4 && s2.phase !== 'OPEN' && s2.phase !== 'PREPARE'; k++) {
      await api('/api/sim/advance-phase');
      await sleep(250);
      s2 = await fetch(`${BASE}/api/stage/state`).then((r) => r.json());
    }
    check(`8.${i + 1} Không dừng game sau câu ${i + 1}`, s2.phase !== 'NO_QUESTIONS', `phase=${s2.phase}`);
  }
  check('9. 12 câu liên tiếp không lặp mã câu hiển thị', new Set(seen).size === 12, seen.join(','));

  const adminEnd = await fetch(`${BASE}/api/admin/state`, { headers }).then((r) => r.json());
  const usedLen = (adminEnd.usedQuestionIds ?? adminEnd.state?.usedQuestionIds ?? []).length;
  check('10. Danh sách câu đã dùng trong phiên <= 12', usedLen <= 12, `${usedLen} câu đã dùng`);
  console.log(failed === 0 ? '\n🎯 TẤT CẢ KIỂM CHỨNG ĐẠT' : `\n💥 ${failed} kiểm chứng THẤT BẠI`);
} finally {
  serverProc.kill();
  await sleep(300);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}
process.exit(failed === 0 ? 0 : 1);
