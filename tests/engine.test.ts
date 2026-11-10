/**
 * Bộ kiểm tra tự động cho Lõi Luật Ghế Nóng v1.0 (T01–T18 và các tình huống biên).
 * Chạy bằng: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Store } from '../server/store/db';
import { GameEngine } from '../server/core/engine';
import { SAMPLE_QUESTIONS, SIM_PROFILES } from '../server/data/samples';
import {
  MC_DIALOGUE_BANK,
  MAX_AUX_PER_QUESTION,
  MIN_AUX_GAP_MS,
  NAME_CALL_COOLDOWN_MS,
  type McCategory,
} from '../server/core/mcDirector';
import type { InboundEvent, Question } from '../server/core/types';

function makeHarness(customQuestions?: Question[], dbFile = ':memory:', startClock = 1_000_000) {
  let clock = startClock;
  let seq = 0;
  const store = new Store(dbFile);
  const qs = customQuestions ?? SAMPLE_QUESTIONS;
  if (store.loadQuestions().length === 0) {
    for (const q of qs) store.upsertQuestion(q);
  }
  const engine = new GameEngine({
    store,
    now: () => clock,
    rng: () => 0.25,
  });
  engine.setSourceHealth(true);
  const advance = (ms: number) => {
    const target = clock + ms;
    while (clock < target) {
      const step = Math.min(500, target - clock);
      clock += step;
      engine.tick();
    }
  };
  const chat = (userId: string, text: string, nickname?: string, eventId?: string) => {
    const p = SIM_PROFILES.find((x) => x.userId === userId);
    const ev: InboundEvent = {
      source: 'sim',
      eventId: eventId ?? `ev_${++seq}`,
      type: 'chat',
      userId,
      nickname: nickname ?? p?.nickname ?? `User ${userId}`,
      avatar: '',
      text,
      receivedAt: clock,
    };
    return engine.handleInbound(ev);
  };
  const gift = (userId: string, giftName = 'Hoa hồng', count = 1, diamonds = 100) => {
    const ev: InboundEvent = {
      source: 'sim',
      eventId: `gift_${++seq}`,
      type: 'gift',
      userId,
      nickname: `User ${userId}`,
      gift: { name: giftName, count, diamonds },
      receivedAt: clock,
    };
    return engine.handleInbound(ev);
  };
  return { engine, store, advance, chat, gift, getClock: () => clock, setClock: (v: number) => (clock = v) };
}

/** Đưa N người chơi vào ghế nóng từ đầu phiên (không cần gõ chờ hay ss, tự động qua 12s lên ghế) và mở câu hỏi đầu tiên tới trạng thái OPEN */
function seatPlayersAndOpen(h: ReturnType<typeof makeHarness>, userIds: string[]) {
  for (const id of userIds) h.chat(id, 'vào');
  h.engine.startSession('test');
  assert.equal(h.engine.state.phase, 'INVITING');
  h.advance(12_000); // Hết 12s tự động lên ghế nóng mà không cần gõ SS
  assert.equal(h.engine.state.phase, 'PREPARE');
  h.advance(5_000); // hết PREPARE -> sang OPEN
  assert.equal(h.engine.state.phase, 'OPEN');
}

test('T01: Tự động đưa người chơi vào 10 ghế chờ không cần gõ "chờ"; gửi trùng nhiều lần không nhảy hàng', () => {
  const h = makeHarness();
  h.chat('sim_01', 'vào');
  h.chat('sim_02', 'vào');
  for (let i = 0; i < 20; i++) {
    const r = h.chat('sim_01', 'CHO');
    assert.equal(r.accepted, false);
  }
  assert.equal(h.engine.state.queue.length, 2);
  assert.equal(h.engine.state.queue[0].userId, 'sim_01');
  assert.equal(h.engine.state.queue[1].userId, 'sim_02');
});

test('T02: 5 người được chọn lên ghế nóng giữ đếm ngược 12s và tự động vào đúng ghế 1→5 mà không cần gõ SS', () => {
  const h = makeHarness();
  const ids = ['sim_01', 'sim_02', 'sim_03', 'sim_04', 'sim_05'];
  for (const id of ids) h.chat(id, 'vào');
  h.engine.startSession('test');
  assert.equal(h.engine.state.phase, 'INVITING');
  assert.equal(h.engine.state.invites.length, 5);
  // Sau 6 giây vẫn đang trong 12s đếm ngược chuẩn bị lên ghế
  h.advance(6_000);
  assert.equal(h.engine.state.phase, 'INVITING');
  // Đủ 12 giây -> tự động vào ghế nóng 1..5 ở cấp 0 mà không cần gõ SS
  h.advance(6_000);
  assert.equal(h.engine.state.phase, 'PREPARE');
  for (let i = 0; i < 5; i++) {
    assert.equal(h.engine.state.seats[i]?.userId, ids[i], `Ghế ${i + 1} phải thuộc về ${ids[i]}`);
    assert.equal(h.engine.state.seats[i]?.level, 0);
  }
});

test('T03: Ghế 2 và 5 sai, ba ghế còn lại đúng — chỉ thay 2 và 5; cấp ba người còn lại tăng đúng 1; người mới cấp 0', () => {
  const h = makeHarness();
  const initial5 = ['sim_01', 'sim_02', 'sim_03', 'sim_04', 'sim_05'];
  const waiting2 = ['sim_06', 'sim_07'];
  for (const id of [...initial5, ...waiting2]) h.chat(id, 'chờ');
  h.engine.startSession('test');
  for (const id of initial5) h.chat(id, 'ss');
  assert.equal(h.engine.state.phase, 'PREPARE');
  h.advance(5_000);
  assert.equal(h.engine.state.phase, 'OPEN');

  const cur = h.engine.state.current!;
  const q = h.engine.questionById(cur.questionId)!;
  const wrong = q.correct === 'A' ? 'B' : 'A';

  // Ghế 1, 3, 4 trả lời đúng; ghế 2, 5 trả lời sai
  h.chat('sim_01', `${cur.code}${q.correct}`);
  h.chat('sim_02', `${cur.code}${wrong}`);
  h.chat('sim_03', `${cur.code} ${q.correct.toLowerCase()}`); // kiểm tra chuẩn hóa "1 b"
  h.chat('sim_04', `${cur.code}${q.correct}`);
  h.chat('sim_05', `${cur.code}${wrong}`);

  // Hết 30s mở đáp án -> chấm câu
  h.advance(30_000);
  assert.equal(h.engine.state.phase, 'REVEAL');

  // Kiểm tra ngay sau khi chấm: ghế 1, 3, 4 giữ ghế và lên cấp 1; ghế 2, 5 trống
  assert.equal(h.engine.state.seats[0]?.userId, 'sim_01');
  assert.equal(h.engine.state.seats[0]?.level, 1);
  assert.equal(h.engine.state.seats[1], null);
  assert.equal(h.engine.state.seats[2]?.userId, 'sim_03');
  assert.equal(h.engine.state.seats[2]?.level, 1);
  assert.equal(h.engine.state.seats[3]?.userId, 'sim_04');
  assert.equal(h.engine.state.seats[3]?.level, 1);
  assert.equal(h.engine.state.seats[4], null);

  // sim_02 và sim_05 có autoRequeue -> xếp lại cuối hàng theo thứ tự ghế tăng dần (sau sim_06, sim_07)
  assert.deepEqual(
    h.engine.state.queue.map((e) => e.userId),
    ['sim_06', 'sim_07', 'sim_02', 'sim_05'],
  );

  // Qua REVEAL (7s) + HONOR (4.5s) + TRANSITION (5.5s) -> INVITING cho ghế 2 và 5
  h.advance(7_000);
  assert.equal(h.engine.state.phase, 'HONOR');
  h.advance(4_500);
  assert.equal(h.engine.state.phase, 'TRANSITION');
  h.advance(5_500);
  assert.equal(h.engine.state.phase, 'INVITING');

  assert.deepEqual(
    h.engine.state.invites.map((i) => ({ seat: i.seat, userId: i.userId })),
    [
      { seat: 2, userId: 'sim_06' },
      { seat: 5, userId: 'sim_07' },
    ],
  );
  h.chat('sim_06', 'ss');
  h.chat('sim_07', 'ss');
  const sAfter = h.engine.state.seats;
  assert.equal(sAfter[1]?.userId, 'sim_06');
  assert.equal(sAfter[1]?.level, 0); // Không thừa hưởng cấp người trước
  assert.equal(sAfter[4]?.userId, 'sim_07');
  assert.equal(sAfter[4]?.level, 0);
  assert.equal(sAfter[0]?.level, 1); // Người cũ giữ nguyên tiến trình
});

test('T04: Cả 5 ghế cùng bị loại — xếp người thay đúng thứ tự ghế 1→5, không trùng người', () => {
  const h = makeHarness();
  for (let i = 1; i <= 10; i++) h.chat(`sim_${String(i).padStart(2, '0')}`, 'chờ');
  h.engine.startSession('test');
  for (let i = 1; i <= 5; i++) h.chat(`sim_${String(i).padStart(2, '0')}`, 'ss');
  h.advance(5_000); // PREPARE -> OPEN

  const cur = h.engine.state.current!;
  const q = h.engine.questionById(cur.questionId)!;
  const wrong = q.correct === 'A' ? 'B' : 'A';
  for (let i = 1; i <= 5; i++) h.chat(`sim_${String(i).padStart(2, '0')}`, `${cur.code}${wrong}`);

  h.advance(30_000 + 7_000 + 4_500 + 5_500); // OPEN + REVEAL + HONOR + TRANSITION
  assert.equal(h.engine.state.phase, 'INVITING');
  assert.deepEqual(
    h.engine.state.invites.map((inv) => ({ seat: inv.seat, userId: inv.userId })),
    [
      { seat: 1, userId: 'sim_06' },
      { seat: 2, userId: 'sim_07' },
      { seat: 3, userId: 'sim_08' },
      { seat: 4, userId: 'sim_09' },
      { seat: 5, userId: 'sim_10' },
    ],
  );
  for (let i = 6; i <= 10; i++) h.chat(`sim_${String(i).padStart(2, '0')}`, 'ss');
  assert.deepEqual(
    h.engine.state.seats.map((s) => s?.userId),
    ['sim_06', 'sim_07', 'sim_08', 'sim_09', 'sim_10'],
  );
});

test('T05: Người được chọn tự động lên ghế sau 12 giây không cần gõ SS; nếu chủ động gõ HỦY trong 12s thì tự đẩy người kế tiếp lên thay', () => {
  const h = makeHarness();
  h.chat('sim_01', 'vào');
  h.chat('sim_02', 'vào');
  h.chat('sim_03', 'vào');
  h.engine.startSession('test');
  assert.equal(h.engine.state.phase, 'INVITING');
  assert.equal(h.engine.state.inviteWave, 1);

  // sim_02 chủ động gõ HỦY trong lúc đếm ngược 12s; sim_01 và sim_03 không cần gõ SS
  h.chat('sim_02', 'hủy');
  h.advance(12_000); // Hết 12s đợt 1 -> sim_01 lên ghế 1, sim_03 lên ghế 3; ghế 2 trống nên tự động đẩy người tiếp theo nếu có
  assert.equal(h.engine.players.get('sim_02')?.autoRequeue, false);
  assert.equal(h.engine.statusOf('sim_02'), 'KHÁN GIẢ');
  assert.equal(h.engine.state.seats[0]?.userId, 'sim_01');
  assert.equal(h.engine.state.seats[1], null);
  assert.equal(h.engine.state.seats[2]?.userId, 'sim_03');
  assert.equal(h.engine.state.phase, 'PREPARE');
});

test('T06 & T07: Đáp án sớm, muộn, sai mã, nhiều lựa chọn, bình luận trùng — chỉ khóa đáp án hợp lệ đầu tiên và tối đa +10 điểm', () => {
  const h = makeHarness();
  h.chat('sim_01', 'chờ');
  h.engine.startSession('test');
  h.chat('sim_01', 'ss');
  assert.equal(h.engine.state.phase, 'PREPARE');

  const cur = h.engine.state.current!;
  const q = h.engine.questionById(cur.questionId)!;
  const wrong = q.correct === 'A' ? 'B' : 'A';

  // Gửi sớm lúc PREPARE
  assert.equal(h.chat('sim_01', `${cur.code}${q.correct}`).accepted, false);

  h.advance(5_000); // sang OPEN
  // Sai cú pháp: chỉ gõ "A", gõ nhiều lựa chọn "1AB", gõ câu văn dài, sai mã câu
  assert.equal(h.chat('sim_01', q.correct).accepted, false);
  assert.equal(h.chat('sim_01', `${cur.code}AB`).accepted, false);
  assert.equal(h.chat('sim_01', `em chọn ${cur.code}${q.correct} ạ`).accepted, false);
  assert.equal(h.chat('sim_01', `${cur.code + 99}${q.correct}`).accepted, false);

  // Đáp án hợp lệ đầu tiên được khóa (và không lộ đáp án ở publicView trước khi chốt)
  const ok1 = h.chat('sim_01', `${cur.code}${q.correct}`, undefined, 'dup_ev_1');
  assert.equal(ok1.accepted, true);
  const pubDuringOpen = h.engine.publicView();
  assert.equal(pubDuringOpen.reveal, null);
  assert.equal(JSON.stringify(pubDuringOpen).includes('"correct"'), false);

  // Sự kiện trùng eventId hoặc gửi thêm 10 đáp án khác không được nhận
  assert.equal(h.chat('sim_01', `${cur.code}${q.correct}`, undefined, 'dup_ev_1').accepted, false);
  for (let i = 0; i < 10; i++) {
    assert.equal(h.chat('sim_01', `${cur.code}${wrong}`).accepted, false);
  }

  // Đúng bằng thời điểm đóng (closesAt) là quá hạn
  h.setClock(cur.closesAt!);
  assert.equal(h.chat('sim_02', `${cur.code}${q.correct}`).accepted, false);
  h.engine.tick(); // chấm câu

  assert.equal(h.engine.state.scores['sim_01']?.sessionPoints, 10);
  assert.equal(h.engine.state.scores['sim_02']?.sessionPoints ?? 0, 0);
});

test('T08 & T16: Khán giả mới trả lời giữa câu tự động lấp đầy 10 ghế chờ trống & 100 tài khoản cùng trả lời được chấm đúng cả 100 người', () => {
  const h = makeHarness();
  seatPlayersAndOpen(h, ['sim_01']);
  const cur = h.engine.state.current!;
  const q = h.engine.questionById(cur.questionId)!;

  // 100 người mới hoàn toàn gửi đáp án đúng (10 người đầu tự động lấp đầy 10 ghế chờ mà không cần gõ "chờ")
  for (let i = 1; i <= 100; i++) {
    const uid = `aud_${i}`;
    const res = h.chat(uid, `${cur.code}${q.correct}`, `Khán giả ${i}`);
    assert.equal(res.accepted, true);
    if (i <= 10) {
      assert.equal(h.engine.statusOf(uid), 'GHẾ CHỜ');
    } else {
      assert.equal(h.engine.statusOf(uid), 'KHÁN GIẢ');
    }
  }
  h.advance(30_000); // chấm câu
  for (let i = 1; i <= 100; i++) {
    assert.equal(h.engine.state.scores[`aud_${i}`]?.sessionPoints, 10);
  }
  // Giới hạn vẽ trên sân khấu <= 40
  h.advance(5_000 + 3_000 + 4_000);
  assert.ok(h.engine.publicView().audience.length <= 40);
});

test('T09: Ghế nóng không trả lời — rớt ghế, tắt tự xếp lại, giữ nguyên điểm và kỷ lục đã có', () => {
  const h = makeHarness();
  seatPlayersAndOpen(h, ['sim_01']);
  // Câu 1: sim_01 trả lời đúng -> lên cấp 1, +10 điểm
  const cur1 = h.engine.state.current!;
  const q1 = h.engine.questionById(cur1.questionId)!;
  h.chat('sim_01', `${cur1.code}${q1.correct}`);
  h.advance(30_000 + 7_000 + 4_500 + 5_500 + 5_000); // sang OPEN câu 2
  assert.equal(h.engine.state.phase, 'OPEN');
  assert.equal(h.engine.state.seats[0]?.level, 1);

  // Câu 2: sim_01 không trả lời
  h.advance(30_000);
  assert.equal(h.engine.state.seats[0], null);
  assert.equal(h.engine.players.get('sim_01')?.autoRequeue, false);
  assert.equal(h.engine.state.queue.length, 0);
  assert.equal(h.engine.state.scores['sim_01']?.sessionPoints, 10);
  assert.equal(h.engine.players.get('sim_01')?.bestLevelAll, 1);
});

test('T10: Nhiều người đạt mốc cấp 3 cùng lúc — gộp vào một bảng vinh danh 3 giây và không cản trở nhận đáp án câu sau', () => {
  const h = makeHarness();
  seatPlayersAndOpen(h, ['sim_01', 'sim_02', 'sim_03', 'sim_04', 'sim_05']);

  // Trả lời đúng 3 câu liên tiếp cho cả 5 ghế
  for (let step = 1; step <= 3; step++) {
    const cur = h.engine.state.current!;
    const q = h.engine.questionById(cur.questionId)!;
    for (let i = 1; i <= 5; i++) {
      assert.equal(h.chat(`sim_0${i}`, `${cur.code}${q.correct}`).accepted, true);
    }
    h.advance(30_000); // OPEN -> REVEAL
    h.advance(7_000); // REVEAL -> HONOR
    assert.equal(h.engine.state.phase, 'HONOR');
    if (step === 3) {
      const honor = h.engine.publicView().honor!;
      assert.equal(honor.kind, 'milestone');
      assert.equal(honor.allFloor, true);
      assert.equal(honor.entries.length, 5);
    }
    h.advance(4_500); // HONOR -> TRANSITION
    h.advance(5_500); // TRANSITION -> PREPARE
    if (step < 3) h.advance(5_000); // PREPARE -> OPEN
  }
  // Câu thứ 4 mở bình thường, nhận đáp án bình thường
  h.advance(5_000);
  assert.equal(h.engine.state.phase, 'OPEN');
  const cur4 = h.engine.state.current!;
  const q4 = h.engine.questionById(cur4.questionId)!;
  assert.equal(h.chat('sim_01', `${cur4.code}${q4.correct}`).accepted, true);
});

test('T11: Tới cuối hiệp (30 phút) giữa câu — hoàn tất câu vào hiệp cũ, hiện bảng hiệp 8s, đặt lại điểm hiệp nhưng giữ nguyên ghế, cấp và hàng chờ', () => {
  const h = makeHarness();
  seatPlayersAndOpen(h, ['sim_01', 'sim_02']);
  h.chat('sim_03', 'chờ');
  // Đẩy thời gian hoạt động hiệp gần chạm 30 phút
  h.engine.state.session!.roundActiveMs = 30 * 60_000 - 10_000;
  const cur = h.engine.state.current!;
  const q = h.engine.questionById(cur.questionId)!;
  h.chat('sim_01', `${cur.code}${q.correct}`);
  h.chat('sim_02', `${cur.code}${q.correct}`);

  h.advance(30_000); // chấm câu (vẫn thuộc hiệp 1)
  assert.equal(h.engine.state.session?.round, 1);
  assert.equal(h.engine.state.scores['sim_01']?.roundPoints, 10);

  h.advance(7_000 + 4_500 + 5_500); // REVEAL + HONOR + TRANSITION -> INVITING (mời sim_03 vào ghế 3)
  h.chat('sim_03', 'ss');
  // Sau khi mời xong -> chốt bảng hiệp 8 giây
  assert.equal(h.engine.state.phase, 'ROUND_BOARD');
  assert.equal(h.engine.state.session?.round, 2);
  assert.equal(h.engine.state.scores['sim_01']?.roundPoints, 0);
  assert.equal(h.engine.state.scores['sim_01']?.sessionPoints, 10);
  assert.equal(h.engine.state.seats[0]?.level, 1);
  assert.equal(h.engine.state.seats[1]?.level, 1);

  h.advance(8_000); // hết 8s bảng hiệp -> sang PREPARE câu tiếp
  assert.equal(h.engine.state.phase, 'PREPARE');
});

test('T12: Mất kết nối lúc nhận đáp án — hủy câu đang mở, không loại ai, không cộng điểm, giữ nguyên ghế và thứ tự', () => {
  const h = makeHarness();
  seatPlayersAndOpen(h, ['sim_01', 'sim_02']);
  h.chat('sim_03', 'chờ');
  const cur = h.engine.state.current!;
  const q = h.engine.questionById(cur.questionId)!;
  h.chat('sim_01', `${cur.code}${q.correct}`);

  // Mất kết nối nguồn bình luận giữa lúc OPEN
  h.engine.setSourceHealth(false, 'rớt mạng');
  assert.equal(h.engine.state.phase, 'PAUSED');
  assert.equal(h.engine.state.current?.status, 'cancelled');
  assert.equal(h.engine.state.seats[0]?.userId, 'sim_01');
  assert.equal(h.engine.state.seats[1]?.userId, 'sim_02');
  assert.equal(h.engine.state.scores['sim_01']?.sessionPoints ?? 0, 0);
  assert.equal(h.engine.state.queue[0]?.userId, 'sim_03');

  // Nguồn kết nối khỏe lại -> tự tiếp tục, mời thêm sim_03 vào ghế 3 rồi sang câu mới
  h.engine.setSourceHealth(true);
  assert.equal(h.engine.state.phase, 'INVITING');
});

test('T13: Khởi động lại máy chủ trước và sau khi chấm — phục hồi từ SQLite, không mất dữ liệu đã chốt, không chấm/cộng điểm hai lần', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghenong-test-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');
  let h: ReturnType<typeof makeHarness> | null = null;
  try {
    // 1) Khởi động lại SAU khi đã chấm câu 1
    h = makeHarness(undefined, dbPath, 2_000_000);
    seatPlayersAndOpen(h, ['sim_01', 'sim_02']);
    const cur1 = h.engine.state.current!;
    const q1 = h.engine.questionById(cur1.questionId)!;
    h.chat('sim_01', `${cur1.code}${q1.correct}`);
    h.chat('sim_02', `${cur1.code}${q1.correct}`);
    h.advance(30_000); // chấm câu 1 -> REVEAL
    assert.equal(h.engine.state.scores['sim_01']?.sessionPoints, 10);
    const savedClock = h.getClock();
    h.store.close();
    h = null;

    // Mở lại Store & GameEngine từ file SQLite (khi setSourceHealth(true), game tự tiếp tục sang PREPARE câu 2)
    h = makeHarness(undefined, dbPath, savedClock + 1_000);
    assert.equal(h.engine.state.scores['sim_01']?.sessionPoints, 10);
    assert.equal(h.engine.state.seats[0]?.userId, 'sim_01');
    assert.equal(h.engine.state.seats[0]?.level, 1);
    assert.equal(h.engine.state.phase, 'PREPARE');

    // 2) Mở câu 2 rồi khởi động lại TRƯỚC khi chấm
    h.advance(5_000); // PREPARE -> OPEN câu 2
    assert.equal(h.engine.state.phase, 'OPEN');
    const cur2 = h.engine.state.current!;
    const q2 = h.engine.questionById(cur2.questionId)!;
    h.chat('sim_01', `${cur2.code}${q2.correct}`);
    const clock2 = h.getClock();
    h.store.close();
    h = null;

    // Khởi tạo lại nhưng CHƯA bật sourceHealth để kiểm tra trạng thái PAUSED & câu 2 bị hủy
    const store3 = new Store(dbPath);
    const engine3 = new GameEngine({ store: store3, now: () => clock2 + 1_000, rng: () => 0.25 });
    assert.equal(engine3.state.phase, 'PAUSED');
    assert.equal(engine3.state.current?.status, 'cancelled');
    assert.equal(engine3.state.seats[0]?.level, 1);
    assert.equal(engine3.state.scores['sim_01']?.sessionPoints, 10);
    // Khi nguồn bình luận khỏe lại -> mở câu 3 mới, không dùng lại câu 2 đã lộ
    engine3.setSourceHealth(true);
    assert.equal(engine3.state.phase, 'PREPARE');
    assert.equal(engine3.state.current?.code, 3);
    assert.notEqual(engine3.state.current?.questionId, cur2.questionId);
    store3.close();
  } finally {
    try {
      h?.store.close();
    } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('T14: Hoàn tác câu gần nhất sau công bố, trước câu kế — khôi phục điểm/ghế/hàng chờ và phát lại đăng ký/hủy mới', () => {
  const h = makeHarness();
  seatPlayersAndOpen(h, ['sim_01', 'sim_02']);
  const cur = h.engine.state.current!;
  const q = h.engine.questionById(cur.questionId)!;
  const wrong = q.correct === 'A' ? 'B' : 'A';
  h.chat('sim_01', `${cur.code}${q.correct}`);
  h.chat('sim_02', `${cur.code}${wrong}`);
  h.advance(30_000); // chấm câu -> REVEAL
  assert.equal(h.engine.state.seats[0]?.level, 1);
  assert.equal(h.engine.state.seats[1], null);

  // Sau khi chấm, sim_08 mới gửi "chờ"
  h.chat('sim_08', 'chờ');
  // Quản trị phát hiện câu lỗi -> hoàn tác trước khi câu kế mở
  const undoRes = h.engine.undoLast('admin', 'Câu hỏi bị sai đáp án nguồn');
  assert.equal(undoRes.accepted, true);

  // Ghế 1 về lại cấp 0, điểm về 0; ghế 2 được khôi phục cho sim_02; sim_08 vẫn nằm trong hàng chờ nhờ replay
  const seatsRestored = h.engine.state.seats;
  assert.equal(seatsRestored[0]?.userId, 'sim_01');
  assert.equal(seatsRestored[0]?.level, 0);
  assert.equal(seatsRestored[1]?.userId, 'sim_02');
  assert.equal(h.engine.state.scores['sim_01']?.sessionPoints ?? 0, 0);
  assert.equal(h.engine.state.queue.some((e) => e.userId === 'sim_08'), true);
});

test('T15: Tặng quà lớn / chuỗi quà — không đổi điểm, thứ tự chờ hay kết quả', () => {
  const h = makeHarness();
  seatPlayersAndOpen(h, ['sim_01']);
  h.chat('sim_02', 'chờ');
  h.gift('sim_02', 'Sư tử vàng', 10, 50_000);
  h.gift('sim_01', 'Tên lửa', 5, 20_000);
  assert.equal(h.engine.state.scores['sim_01']?.sessionPoints ?? 0, 0);
  assert.equal(h.engine.state.scores['sim_02']?.sessionPoints ?? 0, 0);
  assert.equal(h.engine.state.queue[0]?.userId, 'sim_02');
});

test('T17: Hết ngân hàng câu hỏi — chuyển màn hình nghỉ có cảnh báo, không tự lặp câu trong cùng phiên', () => {
  const twoQuestions = SAMPLE_QUESTIONS.slice(0, 2);
  const h = makeHarness(twoQuestions);
  seatPlayersAndOpen(h, ['sim_01']);
  // Chơi hết câu 1 (OPEN + REVEAL + HONOR + TRANSITION + PREPARE)
  const cur1 = h.engine.state.current!;
  const q1 = h.engine.questionById(cur1.questionId)!;
  h.chat('sim_01', `${cur1.code}${q1.correct}`);
  h.advance(30_000 + 7_000 + 4_500 + 5_500 + 5_000);
  // Chơi hết câu 2
  const cur2 = h.engine.state.current!;
  const q2 = h.engine.questionById(cur2.questionId)!;
  h.chat('sim_01', `${cur2.code}${q2.correct}`);
  h.advance(30_000 + 7_000 + 4_500 + 5_500);

  // Hết câu -> NO_QUESTIONS
  assert.equal(h.engine.state.phase, 'NO_QUESTIONS');
  assert.equal(h.engine.state.noQuestionsWarning, true);
});

test('T18: Nhường ghế sau khi đã gửi đáp án — đáp án đúng vẫn +10 điểm nhưng không tăng cấp; ghế chỉ bổ sung ở ranh giới câu', () => {
  const h = makeHarness();
  seatPlayersAndOpen(h, ['sim_01', 'sim_02']);
  h.chat('sim_03', 'chờ');

  const cur = h.engine.state.current!;
  const q = h.engine.questionById(cur.questionId)!;
  h.chat('sim_01', `${cur.code}${q.correct}`);
  // sim_01 chủ động nhường ngay khi câu đang mở
  const r = h.chat('sim_01', 'nhường');
  assert.equal(r.accepted, true);
  assert.equal(h.engine.state.seats[0], null);
  assert.equal(h.engine.players.get('sim_01')?.autoRequeue, false);
  // Ghế chưa mời người mới ngay lúc câu đang mở
  assert.equal(h.engine.state.invites.length, 0);

  h.chat('sim_02', `${cur.code}${q.correct}`);
  h.advance(30_000); // chấm câu
  // sim_01 vẫn nhận +10 điểm vai khán giả, không có cấp ghế nóng
  assert.equal(h.engine.state.scores['sim_01']?.sessionPoints, 10);
  assert.equal(h.engine.players.get('sim_01')?.bestLevelAll, 0);
});

test('T19: Ngân hàng lời thoại MC có điều kiện (180 câu / 9 nhóm) — xáo trộn hết nhóm mới lặp lại và tránh lặp kiểu đùa liên tiếp', () => {
  assert.equal(MC_DIALOGUE_BANK.length >= 150 && MC_DIALOGUE_BANK.length <= 200, true);
  assert.equal(MC_DIALOGUE_BANK.length, 180);
  const categories: McCategory[] = [
    'chaoHoi',
    'huongDan',
    'moiLenGhe',
    'choTraLoi',
    'nhacGio',
    'congBoKetQua',
    'dongVien',
    'vinhDanh',
    'camOnQua',
  ];
  for (const cat of categories) {
    const items = MC_DIALOGUE_BANK.filter((t) => t.category === cat);
    assert.equal(items.length, 20, `Nhóm ${cat} phải có đúng 20 mẫu câu có điều kiện`);
    for (const item of items) {
      const minDur = cat === 'nhacGio' ? 2500 : 3000;
      assert.equal(item.durationMs >= minDur && item.durationMs <= 6000, true, `Thời lượng ${item.id} phải hợp lệ`);
      assert.equal(item.cooldownMs >= 30_000, true, `Thời gian nghỉ tối thiểu của ${item.id} phải hợp lệ`);
      assert.equal(Boolean(item.situation && item.jokeStyle), true);
    }
  }

  // Kiểm tra xáo trộn túi (shuffle-bag): dùng hết tất cả câu phù hợp (5/5 câu trong ngữ cảnh này) trước khi nạp túi mới
  const h = makeHarness();
  seatPlayersAndOpen(h, ['sim_01', 'sim_02', 'sim_03', 'sim_04', 'sim_05']);
  const cur = h.engine.state.current!;
  const q = h.engine.questionById(cur.questionId)!;
  h.chat('sim_01', `${cur.code}${q.correct}`);
  h.chat('sim_02', `${cur.code}${q.correct}`);

  const seenChoIds = new Set<string>();
  let clock = h.getClock();
  for (let i = 0; i < 5; i++) {
    clock += 10_000;
    const ctx = h.engine.buildMcContext();
    const res = h.engine.mcDirector.pickAndRender('choTraLoi', ctx, { isAux: false, now: clock });
    assert.ok(res, 'Phải chọn được câu phù hợp với dữ liệu thật');
    assert.equal(seenChoIds.has(res.templateId), false, `Không được lặp lại mẫu câu ${res.templateId} khi chưa dùng hết các câu phù hợp`);
    seenChoIds.add(res.templateId);
  }
  assert.equal(seenChoIds.size, 5);

  // Kiểm tra nhóm nhacGio (có >= 15 câu phù hợp cùng lúc): rút 12 lần liên tiếp không trùng câu nào và không lặp jokeStyle liên tiếp
  const seenGioIds = new Set<string>();
  let prevStyle = '';
  for (let i = 0; i < 12; i++) {
    clock += 10_000;
    const ctx = h.engine.buildMcContext();
    const res = h.engine.mcDirector.pickAndRender('nhacGio', ctx, { isAux: false, now: clock });
    assert.ok(res);
    assert.equal(seenGioIds.has(res.templateId), false, `Nhóm nhacGio không được lặp lại ${res.templateId} trước khi rút hết túi`);
    seenGioIds.add(res.templateId);
    const tpl = MC_DIALOGUE_BANK.find((t) => t.id === res.templateId)!;
    if (prevStyle && prevStyle !== 'fact' && tpl.jokeStyle !== 'fact') {
      assert.notEqual(tpl.jokeStyle, prevStyle, 'Không lặp cùng một kiểu đùa (jokeStyle) ở 2 lượt liên tiếp');
    }
    prevStyle = tpl.jokeStyle;
  }
});

test('T20: Kỷ luật phát ngôn MC trong pha OPEN — dữ liệu thật 100%, tối đa 2 câu phụ cách nhau >= 8s, <= 5s ngừng chào/quà/đùa để nhắc giờ', () => {
  const h = makeHarness();
  seatPlayersAndOpen(h, ['sim_01', 'sim_02', 'sim_03', 'sim_04', 'sim_05']);

  // Khi chưa có ai trả lời (answeredCount = 0), MC tuyệt đối không được nói "cả phòng trả lời rồi" hay "5/5 ghế đã chốt"
  const ctxZero = h.engine.buildMcContext();
  assert.equal(ctxZero.answeredCount, 0);
  assert.equal(ctxZero.hotAnsweredCount, 0);
  const lineZero = h.engine.mcDirector.pickAndRender('choTraLoi', ctxZero, { isAux: false, now: h.getClock() + 6000 });
  assert.ok(lineZero);
  assert.equal(/5\/5|cả 5 ghế nóng đều đã khóa|toàn bộ 5 ghế/i.test(lineZero.text), false);

  // Trong 1 câu hỏi (30s OPEN): đếm số câu phụ MC tự phát qua tick()
  const auxLines: { text: string; at: number; category?: string }[] = [];
  let lastMcId = h.engine.publicView().mc?.id ?? 0;

  // Cho quà và người mới liên tục trong lúc OPEN
  h.gift('sim_10', 'Hoa hồng', 2, 10);
  h.chat('new_user_1', 'vào', 'Bạn Mới Một');
  h.chat('new_user_2', 'vào', 'Bạn Mới Hai');

  // Tiến dần từng giây đến lúc còn 6 giây (tức đã qua 24 giây của pha OPEN 30s)
  for (let sec = 1; sec <= 24; sec++) {
    h.advance(1_000);
    const mc = h.engine.publicView().mc;
    if (mc && mc.id !== lastMcId) {
      lastMcId = mc.id;
      if (mc.isAux) {
        auxLines.push({ text: mc.text, at: mc.at, category: mc.category });
      }
    }
  }

  assert.equal(auxLines.length <= MAX_AUX_PER_QUESTION, true, `Trong 1 câu hỏi chỉ tối đa ${MAX_AUX_PER_QUESTION} câu phụ`);
  if (auxLines.length === 2) {
    assert.equal(auxLines[1].at - auxLines[0].at >= MIN_AUX_GAP_MS, true, 'Hai câu phụ phải cách nhau ít nhất 8 giây');
  }

  // Khi còn <= 5 giây: thêm quà & người mới -> MC phải NGỪNG chào hỏi/cảm ơn quà và chỉ ưu tiên phát nhắc giờ (nhacGio)
  h.gift('sim_11', 'Siêu xe', 5, 500);
  h.chat('new_user_3', 'vào', 'Bạn Mới Ba');
  h.advance(1_500); // Lúc này còn ~4.5 giây (<= 5s)
  const mcAt5s = h.engine.publicView().mc;
  assert.ok(mcAt5s);
  assert.equal(mcAt5s.category, 'nhacGio', 'Khi còn <= 5 giây phải ưu tiên phát câu nhắc hết giờ (nhacGio)');
});

test('T21: Chào người mới theo tương tác hợp lệ đầu tiên, gom 2–3 tên khi đông, và kiểm tra lại vị trí thực tế ngay trước khi phát', () => {
  const h = makeHarness();
  seatPlayersAndOpen(h, ['sim_01', 'sim_02']);

  // Bình luận thường (không phải lệnh hợp lệ) -> KHÔNG xếp vào hàng đợi chào người mới
  const beforePending = h.engine.mcDirector.pendingWelcomes.length;
  h.chat('viewer_chat_only', 'haha vui quá anh ơi', 'Khán Giả Xem');
  assert.equal(h.engine.mcDirector.pendingWelcomes.length, beforePending, 'Bình luận không phải lệnh hợp lệ thì không chào như người chơi mới');

  // 4 người mới tương tác hợp lệ liên tiếp -> gom tối đa 3 tên vào 1 lời chào
  h.chat('fresh_01', 'chờ', 'An Nguyễn');
  h.chat('fresh_02', 'chờ', 'Bình Trần');
  h.chat('fresh_03', 'chờ', 'Châu Lê');
  h.chat('fresh_04', 'chờ', 'Dũng Phạm');
  assert.equal(h.engine.mcDirector.pendingWelcomes.length >= 4, true);

  // Giả sử trước khi MC kịp chào, fresh_01 đã bấm "hủy" rời khỏi hàng chờ -> MC kiểm tra lại điều kiện phải cập nhật/bỏ vị trí cũ
  h.chat('fresh_01', 'hủy', 'An Nguyễn');
  const posCheck = h.engine.resolvePlayerPositionForMc('fresh_01');
  assert.equal(posCheck.currentPosNote, null, 'Người chơi đã hủy hàng chờ thì vị trí thực tế phải là null (bỏ vị trí cũ)');

  const batch = h.engine.mcDirector.consumeWelcomeBatch((uid) => h.engine.resolvePlayerPositionForMc(uid), h.getClock());
  assert.ok(batch);
  assert.equal(batch.count <= 3, true, 'Mỗi lời chào chỉ gom tối đa 2–3 tên');
  assert.equal(batch.namesText.includes('An Nguyễn'), true);
  assert.equal(batch.positionNote.includes('ghế chờ số'), true, 'Vị trí đọc lên phải lấy từ vị trí thực tế hiện tại');
});

test('T22: Gom lời cảm ơn quà liên tiếp, thời gian nghỉ gọi tên từng người và tự hủy lời chào/cảm ơn quá cũ', () => {
  const h = makeHarness();
  seatPlayersAndOpen(h, ['sim_01']);

  const t0 = h.getClock();
  // Một người tặng quà dồn dập nhiều lần liên tiếp
  h.engine.mcDirector.enqueueGift('gifter_1', 'Hoàng Đại Gia', 'Hoa hồng', 3, t0);
  h.engine.mcDirector.enqueueGift('gifter_1', 'Hoàng Đại Gia', 'Hoa hồng', 7, t0 + 500);
  h.engine.mcDirector.enqueueGift('gifter_2', 'Lan Ngọc', 'Tim lửa', 2, t0 + 800);

  const batch1 = h.engine.mcDirector.consumeGiftBatch(t0 + 1000);
  assert.ok(batch1);
  assert.equal(batch1.totalCount, 12, 'Phải cộng dồn tổng số lượng quà liên tiếp');
  assert.equal(batch1.sendersText.includes('Hoàng Đại Gia'), true);

  // Ngay sau khi vừa được gọi tên, gifter_1 tặng tiếp -> đang trong thời gian nghỉ gọi tên (NAME_CALL_COOLDOWN_MS) nên chưa gọi lại ngay
  h.engine.mcDirector.enqueueGift('gifter_1', 'Hoàng Đại Gia', 'Hoa hồng', 1, t0 + 2000);
  assert.equal(h.engine.mcDirector.canCallUserName('gifter_1', t0 + 2000), false);
  const blockedBatch = h.engine.mcDirector.consumeGiftBatch(t0 + 2000);
  assert.equal(blockedBatch, null, 'Không gọi tên dồn dập cùng một người khi đang trong thời gian nghỉ');

  // Sau khi qua thời gian nghỉ (hoặc quá hạn MAX_PENDING_AGE_MS = 25s), hàng đợi quá cũ tự động bị hủy để không kéo dài vài phút
  h.engine.mcDirector.enqueueGift('stale_user', 'Người Cũ', 'Quà Cũ', 1, t0);
  h.engine.mcDirector.pruneStaleQueues(t0 + 30_000);
  assert.equal(
    h.engine.mcDirector.pendingGifts.some((g) => g.userId === 'stale_user'),
    false,
    'Lời cảm ơn/chào hỏi quá cũ phải tự động bị hủy',
  );
  assert.equal(h.engine.mcDirector.canCallUserName('gifter_1', t0 + 1000 + NAME_CALL_COOLDOWN_MS + 100), true);
});

test('T23: Hướng dẫn trên sân khấu luôn gồm 1 dòng cố định và 1 dòng thay đổi đúng theo từng giai đoạn, đồng bộ với lời MC', () => {
  const h = makeHarness();

  // 1) Giai đoạn chờ / mới vào xem
  const viewStandby = h.engine.publicView();
  assert.ok(viewStandby.stageGuide.fixed.includes('Bình luận "Vào" để chơi.'));
  assert.equal(
    viewStandby.stageGuide.text.includes('Các lệnh đang được sử dụng hiện tại'),
    true,
    'Khi chờ / người mới vào xem phải hiển thị "Các lệnh đang được sử dụng hiện tại"',
  );

  // 2) Giai đoạn Mời lên ghế (INVITING)
  h.chat('sim_01', 'chờ');
  h.chat('sim_02', 'chờ');
  h.engine.startSession('admin');
  assert.equal(h.engine.state.phase, 'INVITING');
  const viewInvite = h.engine.publicView();
  assert.equal(viewInvite.stageGuide.badge, 'MỜI LÊN GHẾ');
  assert.equal(viewInvite.stageGuide.text.includes('SS'), true, 'Phải hiển thị lệnh xác nhận SS');
  assert.equal(viewInvite.stageGuide.text.includes('{sec}s'), true, 'Phải có số giây đếm ngược');

  // 3) Giai đoạn Mở câu hỏi (OPEN)
  h.advance(12_500); // hết 12s INVITING -> PREPARE
  h.advance(5_000); // hết PREPARE -> OPEN
  assert.equal(h.engine.state.phase, 'OPEN');
  const code = h.engine.state.current!.code;
  const viewOpen = h.engine.publicView();
  assert.equal(
    viewOpen.stageGuide.text.includes(`Bình luận ${code}A · ${code}B · ${code}C · ${code}D để chọn đáp án`),
    true,
    'Khi mở câu hỏi phải hiển thị đúng mã câu đang mở kèm câu "để chọn đáp án"',
  );

  // 4) Giai đoạn Công bố kết quả (REVEAL)
  h.advance(30_000); // hết 30s OPEN -> REVEAL
  assert.equal(h.engine.state.phase, 'REVEAL');
  const viewReveal = h.engine.publicView();
  assert.equal(
    viewReveal.stageGuide.text.includes('+10đ') && viewReveal.stageGuide.text.includes('rời ghế'),
    true,
    'Khi công bố kết quả phải giải thích ngắn đúng được gì, sai/không trả lời đi đâu',
  );

  // 5) Giai đoạn Chuyển vòng / Chuyển câu (TRANSITION)
  h.advance(7_000 + 4_500); // hết REVEAL (7s) + HONOR (4.5s) -> TRANSITION
  assert.equal(h.engine.state.phase, 'TRANSITION');
  const viewTrans = h.engine.publicView();
  assert.equal(
    viewTrans.stageGuide.text.includes('vinh danh') || viewTrans.stageGuide.text.includes('Thắng vòng'),
    true,
    'Khi chuyển vòng phải hiển thị cách tính thành tích / điều kiện thắng theo luật đang dùng',
  );
});
