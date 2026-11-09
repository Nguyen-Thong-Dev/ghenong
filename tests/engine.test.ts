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

/** Đưa N người chơi vào ghế nóng từ đầu phiên và mở câu hỏi đầu tiên tới trạng thái OPEN */
function seatPlayersAndOpen(h: ReturnType<typeof makeHarness>, userIds: string[]) {
  for (const id of userIds) h.chat(id, 'chờ');
  h.engine.startSession('test');
  assert.equal(h.engine.state.phase, 'INVITING');
  for (const id of userIds.slice(0, 5)) h.chat(id, 'ss');
  assert.equal(h.engine.state.phase, 'PREPARE');
  h.advance(5_000); // hết PREPARE -> sang OPEN
  assert.equal(h.engine.state.phase, 'OPEN');
}

test('T01: Cùng tài khoản gửi "chờ" 20 lần — chỉ có 1 vị trí, không nhảy hàng', () => {
  const h = makeHarness();
  h.chat('sim_01', 'chờ');
  h.chat('sim_02', 'chờ');
  for (let i = 0; i < 20; i++) {
    const r = h.chat('sim_01', 'CHO');
    assert.equal(r.accepted, false);
  }
  assert.equal(h.engine.state.queue.length, 2);
  assert.equal(h.engine.state.queue[0].userId, 'sim_01');
  assert.equal(h.engine.state.queue[1].userId, 'sim_02');
});

test('T02: 5 người cùng gửi ss — mỗi người đúng ghế đã dành, không chiếm chéo', () => {
  const h = makeHarness();
  const ids = ['sim_01', 'sim_02', 'sim_03', 'sim_04', 'sim_05'];
  for (const id of ids) h.chat(id, 'chờ');
  h.engine.startSession('test');
  assert.equal(h.engine.state.phase, 'INVITING');
  assert.equal(h.engine.state.invites.length, 5);
  // Gửi ss theo thứ tự đảo ngược
  for (const id of [...ids].reverse()) {
    const r = h.chat(id, 'sẵn sàng');
    assert.equal(r.accepted, true);
  }
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

  // Qua REVEAL (5s) + HONOR (3s) + TRANSITION (4s) -> INVITING cho ghế 2 và 5
  h.advance(5_000);
  assert.equal(h.engine.state.phase, 'HONOR');
  h.advance(3_000);
  assert.equal(h.engine.state.phase, 'TRANSITION');
  h.advance(4_000);
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

  h.advance(30_000 + 5_000 + 3_000 + 4_000); // OPEN + REVEAL + HONOR + TRANSITION
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

test('T05: Người được mời im lặng — hết 12 giây bỏ lời mời, tắt tự xếp lại, gọi đợt 2; tối đa 2 đợt không treo game', () => {
  const h = makeHarness();
  h.chat('sim_01', 'chờ');
  h.chat('sim_02', 'chờ');
  h.engine.startSession('test');
  assert.equal(h.engine.state.phase, 'INVITING');
  assert.equal(h.engine.state.inviteWave, 1);

  // sim_01 xác nhận, sim_02 im lặng
  h.chat('sim_01', 'ss');
  // Thêm sim_03 vào hàng chờ để đợt 2 có người gọi
  h.chat('sim_03', 'chờ');
  h.advance(12_000); // Hết 12s đợt 1
  assert.equal(h.engine.players.get('sim_02')?.autoRequeue, false);
  assert.equal(h.engine.statusOf('sim_02'), 'KHÁN GIẢ');

  // Đợt 2 tự động gọi sim_03 vào ghế 2
  assert.equal(h.engine.state.phase, 'INVITING');
  assert.equal(h.engine.state.inviteWave, 2);
  assert.equal(h.engine.state.invites[0]?.userId, 'sim_03');
  assert.equal(h.engine.state.invites[0]?.seat, 2);

  // sim_03 cũng im lặng -> hết 12s đợt 2 -> vào PREPARE câu hỏi mới, không mời đợt 3
  h.chat('sim_04', 'chờ');
  h.advance(12_000);
  assert.equal(h.engine.state.phase, 'PREPARE');
  assert.equal(h.engine.state.seats[0]?.userId, 'sim_01');
  assert.equal(h.engine.state.seats[1], null);
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

test('T08 & T16: Khán giả mới trả lời giữa câu & 100 tài khoản cùng trả lời — chấm đúng cả 100 người dù chỉ vẽ tối đa 40 khán giả', () => {
  const h = makeHarness();
  seatPlayersAndOpen(h, ['sim_01']);
  const cur = h.engine.state.current!;
  const q = h.engine.questionById(cur.questionId)!;

  // 100 khán giả mới hoàn toàn gửi đáp án đúng
  for (let i = 1; i <= 100; i++) {
    const uid = `aud_${i}`;
    const res = h.chat(uid, `${cur.code}${q.correct}`, `Khán giả ${i}`);
    assert.equal(res.accepted, true);
    // Không tự động vào hàng chờ
    assert.equal(h.engine.statusOf(uid), 'KHÁN GIẢ');
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
  h.advance(30_000 + 5_000 + 3_000 + 4_000 + 5_000); // sang OPEN câu 2
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
    h.advance(5_000); // REVEAL -> HONOR
    assert.equal(h.engine.state.phase, 'HONOR');
    if (step === 3) {
      const honor = h.engine.publicView().honor!;
      assert.equal(honor.kind, 'milestone');
      assert.equal(honor.allFloor, true);
      assert.equal(honor.entries.length, 5);
    }
    h.advance(3_000); // HONOR (đúng 3s) -> TRANSITION
    h.advance(4_000); // TRANSITION -> PREPARE
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

  h.advance(5_000 + 3_000 + 4_000); // REVEAL + HONOR + TRANSITION -> INVITING (mời sim_03 vào ghế 3)
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
  // Chơi hết câu 1
  const cur1 = h.engine.state.current!;
  const q1 = h.engine.questionById(cur1.questionId)!;
  h.chat('sim_01', `${cur1.code}${q1.correct}`);
  h.advance(30_000 + 5_000 + 3_000 + 4_000 + 5_000);
  // Chơi hết câu 2
  const cur2 = h.engine.state.current!;
  const q2 = h.engine.questionById(cur2.questionId)!;
  h.chat('sim_01', `${cur2.code}${q2.correct}`);
  h.advance(30_000 + 5_000 + 3_000 + 4_000);

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
