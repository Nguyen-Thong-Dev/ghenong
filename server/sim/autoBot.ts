import type { GameEngine } from '../core/engine';
import type { InboundEvent } from '../core/types';
import { SIM_PROFILES } from '../data/samples';

const GIFT_CATALOG = [
  { name: 'Hoa hồng', diamonds: 1, maxCount: 5 },
  { name: 'Tim hồng', diamonds: 5, maxCount: 3 },
  { name: 'Cà phê', diamonds: 10, maxCount: 2 },
  { name: 'Kem ốc quế', diamonds: 15, maxCount: 3 },
  { name: 'Pháo hoa', diamonds: 99, maxCount: 1 },
  { name: 'Vương miện', diamonds: 199, maxCount: 1 },
  { name: 'Sư tử vàng', diamonds: 500, maxCount: 1 },
];

const CASUAL_CHATS = [
  'Câu này hay quá!',
  'Dễ mà anh em ơi',
  'Chắc chắn đáp án này luôn',
  'Hồi hộp quá 🔥',
  'Ghế nóng căng não thật sự',
];

interface ScheduledSimAction {
  at: number;
  done: boolean;
  label: string;
  run: (now: number) => void;
}

export interface AutoSimStatus {
  enabled: boolean;
  totalPlayers: number;
  plannedForRunId: string | null;
  pendingActions: number;
  completedActions: number;
  giftsSent: number;
}

/**
 * Bộ mô phỏng 30 người chơi tự động như người thật (Auto-Bot):
 * - Tất cả sự kiện đều đi qua engine.handleInbound(ev) thật, không sửa điểm/ghế trực tiếp.
 * - Khi câu hỏi mở (OPEN): lên lịch rải rác cho 30 người chơi gồm nhóm trả lời sớm, nhóm trả lời giữa giờ,
 *   nhóm trả lời sau (sát giờ), người đổi ý gửi lại lần 2, người trả lời quá hạn, người xem điểm/vị trí.
 * - Định kỳ tặng quà TikTok và tự gõ "vào"/"chờ" nếu trước đó bị rớt hàng chờ.
 */
export class AutoSimController {
  enabled: boolean;
  private engine: GameEngine;
  private onActivity: () => void;
  private seq = 10_000;
  private plannedRunId: string | null = null;
  private actions: ScheduledSimAction[] = [];
  private nextGiftAt = 0;
  private nextRejoinCheckAt = 0;
  private giftsSent = 0;

  constructor(engine: GameEngine, onActivity: () => void, defaultEnabled = true) {
    this.engine = engine;
    this.onActivity = onActivity;
    this.enabled = defaultEnabled;
    const now = Date.now();
    this.nextGiftAt = now + 5_000;
    this.nextRejoinCheckAt = now + 8_000;
  }

  getStatus(): AutoSimStatus {
    const completed = this.actions.filter((a) => a.done).length;
    const pending = this.actions.length - completed;
    return {
      enabled: this.enabled,
      totalPlayers: SIM_PROFILES.length,
      plannedForRunId: this.plannedRunId,
      pendingActions: pending,
      completedActions: completed,
      giftsSent: this.giftsSent,
    };
  }

  setEnabled(flag: boolean, now = Date.now()) {
    this.enabled = flag;
    if (flag) {
      this.plannedRunId = null;
      this.actions = [];
      this.nextGiftAt = now + 3_500;
      this.tick(now);
    } else {
      this.actions = [];
    }
  }

  private rand(min: number, max: number) {
    return min + Math.random() * (max - min);
  }

  private sendChat(userId: string, text: string, now: number, late = false) {
    const profile = SIM_PROFILES.find((p) => p.userId === userId);
    const cur = this.engine.state.current;
    const receivedAt = late && cur?.closesAt ? Math.max(now, cur.closesAt) : now;
    const ev: InboundEvent = {
      source: 'sim',
      eventId: `autosim_${now}_${++this.seq}`,
      type: 'chat',
      userId,
      nickname: profile?.nickname ?? `Người chơi ${userId}`,
      avatar: profile?.avatar ?? '',
      text,
      receivedAt,
    };
    this.engine.handleInbound(ev);
    this.onActivity();
  }

  private sendRandomGift(now: number, preferredUserId?: string) {
    const profile =
      (preferredUserId ? SIM_PROFILES.find((p) => p.userId === preferredUserId) : undefined) ??
      SIM_PROFILES[Math.floor(Math.random() * SIM_PROFILES.length)];
    const giftItem = GIFT_CATALOG[Math.floor(Math.random() * GIFT_CATALOG.length)];
    const count = 1 + Math.floor(Math.random() * giftItem.maxCount);
    const ev: InboundEvent = {
      source: 'sim',
      eventId: `autosimgift_${now}_${++this.seq}`,
      type: 'gift',
      userId: profile.userId,
      nickname: profile.nickname,
      gift: {
        name: giftItem.name,
        count,
        diamonds: giftItem.diamonds * count,
      },
      receivedAt: now,
    };
    this.engine.handleInbound(ev);
    this.giftsSent++;
    this.onActivity();
  }

  /** Lên kịch bản trả lời tự nhiên cho 30 người chơi khi một câu hỏi vừa mở (OPEN) */
  private planQuestionActions(now: number) {
    const s = this.engine.state;
    const cur = s.current;
    if (!cur || s.phase !== 'OPEN' || cur.closesAt == null) return;
    const closesAt = cur.closesAt;
    const q = this.engine.questionById(cur.questionId);
    if (!q) return;

    this.plannedRunId = cur.runId;
    this.actions = [];

    const openDuration = Math.max(6_000, closesAt - now);
    const allChoices: ('A' | 'B' | 'C' | 'D')[] = ['A', 'B', 'C', 'D'];
    const wrongChoices = allChoices.filter((c) => c !== q.correct);
    const pickWrong = () => wrongChoices[Math.floor(Math.random() * wrongChoices.length)];
    const formatAnswer = (code: number, choice: string) => {
      const r = Math.random();
      if (r < 0.72) return `${code}${choice}`;
      if (r < 0.88) return `${code} ${choice.toLowerCase()}`;
      return `câu ${code}${choice}`;
    };

    const hotSeatIds = new Set(s.seats.filter(Boolean).map((t) => t!.userId));

    // 1. Lên lịch cho 5 người trên Ghế Nóng: phản xạ từ 1.5s -> 22s (có người trả lời nhanh, có người suy nghĩ trả lời sau)
    s.seats.forEach((tenure, idx) => {
      if (!tenure) return;
      const userId = tenure.userId;
      // 76% trả lời đúng, 24% trả lời sai để sân đấu có cả giữ ghế lên cấp và đổi người mới
      const isCorrect = Math.random() < 0.76;
      const choice = isCorrect ? q.correct : pickWrong();
      // Phân bổ thời gian: ghế trả lời sớm (1.8–6s), ghế trả lời vừa (6–14s), ghế trả lời sau (14–22s)
      const delayRatio = idx % 3 === 0 ? this.rand(0.06, 0.22) : idx % 3 === 1 ? this.rand(0.22, 0.48) : this.rand(0.48, 0.74);
      const answerAt = now + Math.min(openDuration - 1_500, Math.round(openDuration * delayRatio));

      this.actions.push({
        at: answerAt,
        done: false,
        label: `Ghế ${idx + 1} (${userId}) trả lời`,
        run: (t) => this.sendChat(userId, formatAnswer(cur.code, choice), t),
      });

      // 20% xác suất người trên ghế nóng bối rối gõ lại đáp án khác sau đó 2.5s (để mô phỏng khóa đáp án đầu tiên)
      if (Math.random() < 0.2) {
        const secondChoice = isCorrect ? pickWrong() : q.correct;
        this.actions.push({
          at: Math.min(closesAt - 500, answerAt + 2_400),
          done: false,
          label: `Ghế ${idx + 1} (${userId}) thử đổi đáp án`,
          run: (t) => this.sendChat(userId, `${cur.code}${secondChoice}`, t),
        });
      }
    });

    // 2. Lên lịch cho 25 người còn lại (10 ghế chờ + 15 khán giả): chia làm 3 đợt (Sớm, Giữa giờ, Trả lời sau) + Quá hạn + Tặng quà
    const others = SIM_PROFILES.filter((p) => !hotSeatIds.has(p.userId));
    others.forEach((profile, index) => {
      // Khoảng 88% người xem tham gia trả lời mỗi câu
      if (Math.random() > 0.88) return;

      // 1 người cuối danh sách thử gửi quá hạn (sát hoặc chạm mốc đóng câu)
      if (index === others.length - 1) {
        this.actions.push({
          at: Math.max(now + 2_000, closesAt - 400),
          done: false,
          label: `${profile.nickname} trả lời quá hạn`,
          run: (t) => this.sendChat(profile.userId, `${cur.code}${q.correct}`, t, true),
        });
        return;
      }

      // Chia thành 3 nhóm: trả lời sớm (1.2s–7s), trả lời giữa (7s–16s), trả lời sau/muộn (16s–26.5s)
      let delayMs: number;
      if (index < 8) {
        delayMs = this.rand(1_200, Math.min(7_500, openDuration * 0.28));
      } else if (index < 17) {
        delayMs = this.rand(Math.min(7_500, openDuration * 0.28), Math.min(17_000, openDuration * 0.6));
      } else {
        delayMs = this.rand(Math.min(17_000, openDuration * 0.6), Math.max(2_500, openDuration - 2_000));
      }

      const isCorrect = Math.random() < 0.68;
      const choice = isCorrect ? q.correct : pickWrong();

      this.actions.push({
        at: Math.round(now + delayMs),
        done: false,
        label: `${profile.nickname} trả lời`,
        run: (t) => this.sendChat(profile.userId, formatAnswer(cur.code, choice), t),
      });
    });

    // 3. Thêm vài thao tác tương tác đời thực trong lúc câu hỏi đang chạy: hỏi điểm, hỏi vị trí, bình luận thường, tặng quà
    const randomViewer1 = others[Math.floor(Math.random() * others.length)];
    const randomViewer2 = others[Math.floor(Math.random() * others.length)];
    if (randomViewer1) {
      this.actions.push({
        at: Math.round(now + this.rand(4_000, 12_000)),
        done: false,
        label: `${randomViewer1.nickname} kiểm tra điểm/vị trí`,
        run: (t) => this.sendChat(randomViewer1.userId, Math.random() < 0.5 ? 'điểm' : 'vị trí', t),
      });
    }
    if (randomViewer2) {
      const chatLine = CASUAL_CHATS[Math.floor(Math.random() * CASUAL_CHATS.length)];
      this.actions.push({
        at: Math.round(now + this.rand(9_000, 20_000)),
        done: false,
        label: `${randomViewer2.nickname} trò chuyện`,
        run: (t) => this.sendChat(randomViewer2.userId, chatLine, t),
      });
    }

    this.actions.sort((a, b) => a.at - b.at);
  }

  /**
   * Kích hoạt ngay 1 đợt mô phỏng 30 người chơi (gồm người trả lời ngay, người trả lời sau vài giây, tặng quà và trả lời trễ)
   * để người vận hành có thể thấy hiệu ứng tức thì khi bấm nút.
   */
  triggerRealisticWaveNow(now = Date.now()): { accepted: boolean; reason: string } {
    const s = this.engine.state;
    const cur = s.current;
    // Luôn bắn ngay 2 món quà từ người xem ngẫu nhiên
    this.sendRandomGift(now);
    setTimeout(() => this.sendRandomGift(Date.now()), 900);

    if (s.phase !== 'OPEN' || !cur) {
      return {
        accepted: true,
        reason: 'Đã mô phỏng người chơi tặng quà & tương tác! (Khi câu hỏi ở trạng thái ĐANG NHẬN ĐÁP ÁN, 30 người sẽ tự động trả lời rải rác)',
      };
    }

    const q = this.engine.questionById(cur.questionId);
    if (!q) return { accepted: false, reason: 'Không tìm thấy câu hỏi hiện tại' };

    const allChoices: ('A' | 'B' | 'C' | 'D')[] = ['A', 'B', 'C', 'D'];
    const wrongChoices = allChoices.filter((c) => c !== q.correct);
    const pickWrong = () => wrongChoices[Math.floor(Math.random() * wrongChoices.length)];

    // Chia 30 người thành: 12 người trả lời ngay (0–1.2s), 12 người trả lời sau (1.5s–4.5s), 4 người trả lời muộn hơn (5s–7.5s), 2 người gửi quá hạn/đổi ý
    SIM_PROFILES.forEach((p, idx) => {
      if (this.engine.answers.has(p.userId)) return;
      const isHot = this.engine.seatOf(p.userId) >= 0;
      const isCorrect = Math.random() < (isHot ? 0.78 : 0.7);
      const choice = isCorrect ? q.correct : pickWrong();

      if (idx === SIM_PROFILES.length - 1) {
        // 1 người gửi đáp án quá hạn
        this.actions.push({
          at: now + 1_800,
          done: false,
          label: `${p.nickname} trả lời quá hạn`,
          run: (t) => this.sendChat(p.userId, `${cur.code}${q.correct}`, t, true),
        });
        return;
      }

      const delay =
        idx < 10
          ? idx * 120
          : idx < 22
            ? 1_400 + (idx - 10) * 280
            : 4_800 + (idx - 22) * 380;

      this.actions.push({
        at: now + delay,
        done: false,
        label: `${p.nickname} trả lời`,
        run: (t) => this.sendChat(p.userId, `${cur.code}${choice}`, t),
      });
    });

    this.actions.sort((a, b) => a.at - b.at);
    this.tick(now);
    return {
      accepted: true,
      reason: 'Đã kích hoạt đợt mô phỏng 30 người chơi: trả lời sớm, trả lời sau (rải rác 1–7s), tặng quà và trả lời trễ!',
    };
  }

  /** Nhịp kiểm tra định kỳ (gọi mỗi 200ms từ máy chủ) */
  tick(now = Date.now()) {
    const s = this.engine.state;

    // Kể cả khi tắt auto-mode, vẫn thực thi các hành động đã được kích hoạt thủ công bằng nút bấm
    if (s.phase === 'OPEN' && s.current) {
      if (this.enabled && this.plannedRunId !== s.current.runId) {
        this.planQuestionActions(now);
      }
      for (const act of this.actions) {
        if (!act.done && now >= act.at) {
          act.done = true;
          if (this.engine.state.phase === 'OPEN') {
            act.run(now);
          }
        }
      }
    } else {
      this.actions = [];
    }

    if (!this.enabled || !s.session || ['NO_SESSION', 'ENDED', 'PAUSED'].includes(s.phase)) return;

    // Định kỳ 6–12 giây có người chơi ngẫu nhiên tặng quà
    if (now >= this.nextGiftAt) {
      this.nextGiftAt = now + Math.round(this.rand(6_000, 12_000));
      this.sendRandomGift(now);
    }

    // Định kỳ kiểm tra nếu có người chơi giả lập bị tắt autoRequeue (do câu trước quên trả lời) thì tự gõ "vào" để xếp hàng lại như người thật
    if (now >= this.nextRejoinCheckAt) {
      this.nextRejoinCheckAt = now + 7_000;
      for (const prof of SIM_PROFILES) {
        const pl = this.engine.players.get(prof.userId);
        if (pl && !pl.locked && !pl.autoRequeue && this.engine.seatOf(prof.userId) < 0) {
          this.sendChat(prof.userId, 'vào', now);
          break;
        }
      }
    }
  }
}
