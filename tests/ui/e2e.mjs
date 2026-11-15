/**
 * Kiểm tra tự động Giao diện Sân khấu 2.5D, Nhân vật MC Áo Trắng 8 Tư Thế & Máy chủ (End-to-End bằng Playwright + Microsoft Edge):
 * - Kiểm tra cả kích thước gốc 720 × 1280 (9:16) và kích thước hiển thị điện thoại 360 × 640.
 * - Xác minh ánh xạ đầy đủ 8 tư thế MC áo trắng (01..08):
 *   + 01: đứng tự nhiên khi chờ (NO_SESSION / STANDBY / sau khi hành động ngắn kết thúc)
 *   + 02: chào mở vòng hoặc đón người lên ghế (INVITING / đón người lên ghế)
 *   + 03: đọc câu hỏi khi mở đề / âm thanh đọc đề đang phát
 *   + 04: giới thiệu các lựa chọn (ngay sau nhịp đọc đề)
 *   + 05: suy nghĩ trong thời gian chờ trả lời (OPEN, còn > 5s)
 *   + 06: nhắc còn 5 giây (OPEN, còn <= 5s, ưu tiên hơn động tác chờ)
 *   + 07: ăn mừng khi vinh danh (HONOR, ưu tiên hơn động tác thường)
 *   + 08: động viên sau khi có người bị loại (REVEAL khi có ghế rớt, sau đó trở về 01)
 * - Xác minh hiệu ứng âm thanh đếm ngược khi còn 10 giây đổ lại (10..1s).
 * - Xác minh tải lại sân khấu (F5) không phát lại lời chào (02) hoặc vinh danh (07) cũ.
 * - Xác minh MC lớn dễ nhìn trên điện thoại, chừa không gian cho tay, không che câu hỏi, đáp án hoặc đồng hồ.
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
      DISABLE_SIM: '0',
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
  await sleep(900);

  // -------------------------------------------------------------------------
  // KIỂM TRA TƯ THẾ 01: Đứng tự nhiên khi chờ (NO_SESSION) & Hướng dẫn 2 dòng cho người mới
  // -------------------------------------------------------------------------
  const pose01 = await stagePage720.getByTestId('mc-white-host').getAttribute('data-mc-pose');
  assert.equal(pose01, '01', 'Khi sân khấu đang chờ (NO_SESSION), MC phải ở tư thế 01 (đứng tự nhiên)');
  const fixedGuide0 = await stagePage720.getByTestId('guide-fixed-line').textContent();
  const dynGuide0 = await stagePage720.getByTestId('guide-dynamic-text').textContent();
  assert.equal(fixedGuide0?.includes('CÁCH THAM GIA'), true, 'Phải có dòng cố định về cách tham gia');
  assert.equal(dynGuide0?.includes('Các lệnh đang được sử dụng hiện tại'), true, 'Khi chờ phải hiện các lệnh đang được sử dụng hiện tại');
  await stagePage720.screenshot({ path: path.join(outDir, 'mc-pose-01-standby.png') });

  // -------------------------------------------------------------------------
  // KIỂM TRA TƯ THẾ 02: Chào mở vòng hoặc đón người lên ghế (INVITING) & Hướng dẫn mời ghế
  // -------------------------------------------------------------------------
  await dashPage.getByTestId('btn-start-session').click();
  await sleep(350);
  const pose02 = await stagePage720.getByTestId('mc-white-host').getAttribute('data-mc-pose');
  assert.equal(pose02, '02', 'Khi bắt đầu vòng / đón người lên ghế nóng (INVITING), MC phải ở tư thế 02 (chào)');
  const dynGuideInvite = await stagePage720.getByTestId('guide-dynamic-text').textContent();
  assert.equal(dynGuideInvite?.includes('SS') && dynGuideInvite?.includes('s)'), true, 'Khi mời lên ghế phải hiện tên, lệnh SS và số giây còn lại');
  await stagePage720.screenshot({ path: path.join(outDir, 'stage-inviting.png') });
  await stagePage360.screenshot({ path: path.join(outDir, 'stage-360x640-inviting.png') });

  // Kiểm tra tải lại sân khấu (F5) trong lúc INVITING: không phát lại lời chào cũ (trở về 01)
  await stagePage720.reload();
  await sleep(500);
  const poseAfterInviteReload = await stagePage720.getByTestId('mc-white-host').getAttribute('data-mc-pose');
  assert.equal(poseAfterInviteReload, '01', 'Tải lại sân khấu không được phát lại lời chào cũ (về tư thế 01)');

  // -------------------------------------------------------------------------
  // KIỂM TRA TƯ THẾ 03 -> 04 -> 05: Đọc câu hỏi -> Giới thiệu lựa chọn -> Suy nghĩ chờ trả lời
  // -------------------------------------------------------------------------
  // Qua 12s chuẩn bị -> 5 người vào ghế nóng 1..5, sang PREPARE
  await dashPage.getByTestId('btn-advance-phase').click();
  await sleep(250);
  // Qua 5s PREPARE -> sang OPEN câu #1
  await dashPage.getByTestId('btn-advance-phase').click();
  await sleep(350);

  // Ngay đầu pha OPEN (< 2s): Tư thế 03 (Đọc câu hỏi)
  const pose03 = await stagePage720.getByTestId('mc-white-host').getAttribute('data-mc-pose');
  assert.equal(pose03, '03', 'Khi mới mở câu hỏi (đang đọc đề), MC phải ở tư thế 03 (đọc câu hỏi)');
  await stagePage720.screenshot({ path: path.join(outDir, 'mc-pose-03-reading.png') });

  // Sau ~2.1s từ lúc mở đề: chuyển sang Tư thế 04 (Giới thiệu các lựa chọn)
  await sleep(2000);
  const pose04 = await stagePage720.getByTestId('mc-white-host').getAttribute('data-mc-pose');
  assert.equal(pose04, '04', 'Sau khi đọc câu hỏi, MC phải chuyển sang tư thế 04 (giới thiệu các lựa chọn)');
  await stagePage720.screenshot({ path: path.join(outDir, 'mc-pose-04-choices.png') });

  // Sau khi kết thúc hành động ngắn giới thiệu lựa chọn (~2.4s tiếp): chuyển về Tư thế 05 (Suy nghĩ trong thời gian chờ trả lời)
  await sleep(2500);
  const pose05 = await stagePage720.getByTestId('mc-white-host').getAttribute('data-mc-pose');
  assert.equal(pose05, '05', 'Khi chờ người chơi trả lời (còn > 5s), MC phải ở tư thế 05 (suy nghĩ)');

  const stateOpen1 = await fetch(`${BASE}/api/stage/state`).then((r) => r.json());
  assert.equal(stateOpen1.phase, 'OPEN');
  assert.equal(stateOpen1.seats.filter((s) => s.occupant).length, 5, 'Phải có đủ 5 người trên ghế nóng');
  assert.equal(stateOpen1.waiting.length, 10, 'Phải có đủ 10 người trên ghế chờ (2 hàng × 5 ghế)');
  assert.equal(stateOpen1.audience.length >= 30, true, 'Phải có đủ 30 khán giả trong danh sách khán đài');
  const dynGuideOpen = await stagePage720.getByTestId('guide-dynamic-text').textContent();
  assert.equal(
    dynGuideOpen?.includes(`Bình luận ${stateOpen1.question.code}A · ${stateOpen1.question.code}B · ${stateOpen1.question.code}C · ${stateOpen1.question.code}D`),
    true,
    'Khi mở câu hỏi phải hiện đúng mã câu đang mở trên dòng hướng dẫn động',
  );

  // Cho 2 ghế nóng (ghế 1 và ghế 3) khóa đáp án trước để thấy rõ trạng thái "ĐÃ KHÓA ĐÁP ÁN"
  const adminOpen1 = await fetch(`${BASE}/api/admin/state`, { headers }).then((r) => r.json());
  const q1 = adminOpen1.current.question;
  await api('/api/sim/chat', { userId: 'sim_01', text: `${adminOpen1.current.code}${q1.correct}` });
  await api('/api/sim/chat', { userId: 'sim_03', text: `${adminOpen1.current.code}${q1.correct}` });
  await sleep(350);

  // Kiểm tra kích thước MC lớn dễ nhìn & không chồng lấn chữ với màn hình câu hỏi, đáp án, đồng hồ
  const layoutCheck = await stagePage720.evaluate(() => {
    const rect = (tid) => document.querySelector(`[data-testid="${tid}"]`)?.getBoundingClientRect();
    const mcBox = rect('stage-mc');
    const mcHost = rect('mc-white-host');
    const qb = rect('question-board');
    const timer = rect('stage-timer');
    const qText = rect('question-text');
    const choiceA = rect('choice-A');
    const hs = rect('hot-seats-row');
    const ws = rect('waiting-seats-section');
    return {
      mcWidth: mcHost.width,
      mcHeight: mcHost.height,
      mcRightLeQbLeft: mcBox.right <= qb.left + 1,
      mcHostRightLeQbLeft: mcHost.right <= qb.left + 1,
      mcNotOverlapTimer: mcHost.right <= timer.left,
      mcNotOverlapQText: mcHost.right <= qText.left,
      mcNotOverlapChoiceA: mcHost.right <= choiceA.left,
      qbBottomLeHsTop: qb.bottom <= hs.top + 8,
      hsBottomLeWsTop: hs.bottom <= ws.top + 4,
    };
  });
  assert.equal(layoutCheck.mcWidth >= 160 && layoutCheck.mcHeight >= 240, true, 'Kích thước MC phải lớn rõ ràng (168×252 tỉ lệ 2:3)');
  assert.equal(layoutCheck.mcRightLeQbLeft, true, 'Khung MC không đè lên màn hình câu hỏi');
  assert.equal(layoutCheck.mcHostRightLeQbLeft, true, 'Hình nhân vật MC (kể cả tay) không đè lên màn hình câu hỏi');
  assert.equal(layoutCheck.mcNotOverlapTimer, true, 'MC không che đồng hồ');
  assert.equal(layoutCheck.mcNotOverlapQText, true, 'MC không che câu hỏi');
  assert.equal(layoutCheck.mcNotOverlapChoiceA, true, 'MC không che đáp án');
  assert.equal(layoutCheck.qbBottomLeHsTop, true, 'Màn hình câu hỏi không đè lên 5 ghế nóng');
  assert.equal(layoutCheck.hsBottomLeWsTop, true, '5 ghế nóng không đè lên 10 ghế chờ');

  await stagePage720.screenshot({ path: path.join(outDir, 'stage-full-5-10-30.png') });
  await stagePage360.screenshot({ path: path.join(outDir, 'stage-360x640-full.png') });
  await dashPage.screenshot({ path: path.join(outDir, 'dashboard-open.png') });

  // -------------------------------------------------------------------------
  // KIỂM TRA ÂM BÁO <= 10 GIÂY & TƯ THẾ 06 (NHẮC CÒN <= 5 GIÂY)
  // -------------------------------------------------------------------------
  // Đặt thời gian còn lại = 9 giây (<= 10 giây): âm thanh đếm ngược kích hoạt, MC vẫn ở tư thế 05
  await api('/api/sim/advance-phase', { remainMs: 8800 });
  await sleep(300);
  const sfxAt9s = Number(await stagePage720.getByTestId('stage-timer').getAttribute('data-countdown-sfx'));
  assert.equal(sfxAt9s >= 1 && sfxAt9s <= 10, true, 'Khi còn <= 10 giây phải kích hoạt hiệu ứng âm thanh đếm ngược');

  // Đặt thời gian còn lại = 4.6 giây (<= 5 giây): MC ưu tiên chuyển ngay sang tư thế 06 (nhắc còn 5 giây)
  await api('/api/sim/advance-phase', { remainMs: 4600 });
  await sleep(300);
  const pose06 = await stagePage720.getByTestId('mc-white-host').getAttribute('data-mc-pose');
  assert.equal(pose06, '06', 'Khi thời gian còn <= 5 giây, MC phải ưu tiên chuyển sang tư thế 06 (nhắc còn 5 giây)');
  await stagePage720.screenshot({ path: path.join(outDir, 'mc-pose-06-5sec-warning.png') });
  await stagePage360.screenshot({ path: path.join(outDir, 'stage-360x640-5sec-warning.png') });

  // -------------------------------------------------------------------------
  // KIỂM TRA TƯ THẾ 08: Động viên sau khi có người bị loại (Ghế 2 và 5 bị loại) -> rồi trở về 01
  // -------------------------------------------------------------------------
  await dashPage.getByTestId('sim-seat25-wrong').click();
  await sleep(300);
  // Tua hết giờ OPEN -> sang REVEAL
  await dashPage.getByTestId('btn-advance-phase').click();
  await sleep(400);

  const pose08 = await stagePage720.getByTestId('mc-white-host').getAttribute('data-mc-pose');
  assert.equal(pose08, '08', 'Sau khi có người bị loại ở pha REVEAL, MC phải ở tư thế 08 (động viên)');
  const dynGuideReveal = await stagePage720.getByTestId('guide-dynamic-text').textContent();
  assert.equal(
    dynGuideReveal?.includes('+10đ') && dynGuideReveal?.includes('rời ghế'),
    true,
    'Khi công bố kết quả phải hiện giải thích đúng được gì, sai/không trả lời đi đâu',
  );

  // Xác minh đèn Spotlight chiến thắng bật sáng ở đúng ghế 1, 3, 4 và không bật ở ghế 2, 5
  assert.equal(await stagePage720.getByTestId('spotlight-correct-1').count(), 1, 'Ghế 1 đúng phải có đèn Spotlight chiếu sáng');
  assert.equal(await stagePage720.getByTestId('spotlight-correct-2').count(), 0, 'Ghế 2 sai không có đèn Spotlight chiến thắng');
  assert.equal(await stagePage720.getByTestId('spotlight-correct-3').count(), 1, 'Ghế 3 đúng phải có đèn Spotlight chiếu sáng');
  assert.equal(await stagePage720.getByTestId('spotlight-correct-4').count(), 1, 'Ghế 4 đúng phải có đèn Spotlight chiếu sáng');
  assert.equal(await stagePage720.getByTestId('spotlight-correct-5').count(), 0, 'Ghế 5 sai không có đèn Spotlight chiến thắng');

  await stagePage720.screenshot({ path: path.join(outDir, 'stage-seat2-5-eliminated.png') });
  await stagePage360.screenshot({ path: path.join(outDir, 'stage-360x640-seat2-5-eliminated.png') });

  // Chờ hành động ngắn động viên (08) kết thúc (~3.2s) -> MC tự động trở về tư thế 01 (đứng tự nhiên)
  await sleep(3100);
  const poseAfter08ShortAction = await stagePage720.getByTestId('mc-white-host').getAttribute('data-mc-pose');
  assert.equal(poseAfter08ShortAction, '01', 'Khi hành động ngắn động viên (08) kết thúc, MC phải trở về tư thế 01');

  // Tua qua REVEAL -> HONOR -> TRANSITION -> INVITING -> PREPARE -> OPEN câu #2
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
  // KIỂM TRA TƯ THẾ 07: Ăn mừng khi vinh danh (Nhiều người được vinh danh cùng lúc)
  // -------------------------------------------------------------------------
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
  await sleep(400);

  const pose07 = await stagePage720.getByTestId('mc-white-host').getAttribute('data-mc-pose');
  assert.equal(pose07, '07', 'Khi vinh danh (HONOR), MC phải ở tư thế 07 (ăn mừng vinh danh)');
  assert.equal(await stagePage720.getByTestId('honor-overlay').isVisible(), true, 'Bảng vinh danh nhiều người cùng lúc phải hiển thị');
  await stagePage720.screenshot({ path: path.join(outDir, 'stage-multi-honor.png') });
  await stagePage360.screenshot({ path: path.join(outDir, 'stage-360x640-multi-honor.png') });

  // Kiểm tra tải lại sân khấu (F5) trong lúc HONOR: không phát lại vinh danh cũ (MC về tư thế 01, không nổ lại anim-honor)
  await stagePage720.reload();
  await sleep(500);
  const poseAfterHonorReload = await stagePage720.getByTestId('mc-white-host').getAttribute('data-mc-pose');
  assert.equal(poseAfterHonorReload, '01', 'Tải lại sân khấu không được phát lại tư thế vinh danh cũ (về tư thế 01)');
  assert.equal(await stagePage720.locator('.anim-honor').count(), 0, 'Tải lại sân khấu không được phát lại hoạt ảnh vinh danh cũ');

  // -------------------------------------------------------------------------
  // KIỂM TRA CÂU HỎI DÀI + 4 ĐÁP ÁN DÀI VỚI MC KÍCH THƯỚC LỚN
  // -------------------------------------------------------------------------
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

  console.log('[E2E] TẤT CẢ KIỂM TRA 8 TƯ THẾ MC ÁO TRẮNG, ÂM BÁO 10S & GIAO DIỆN 2.5D ĐỀU ĐẠT!');
} finally {
  await browser?.close();
  serverProc.kill();
  await sleep(300);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}
process.exit(0);
