/**
 * LÕI LUẬT GHẾ NÓNG (Bộ luật v1.0). Máy chủ là nơi duy nhất quyết định đồng hồ, điểm, thứ tự, cấp, kết quả (§16).
 *
 * - Không phụ thuộc React / Express / TikTok. Nhận sự kiện đã chuẩn hóa (InboundEvent) và lệnh quản trị.
 * - Đồng hồ tiêm vào (now) để kiểm thử được; máy chủ gọi tick() đều đặn.
 * - Mọi thay đổi ghế / hàng chờ / chấm điểm được ghi SQLite trong một giao dịch cùng ảnh chụp trạng thái.
 */
import { DEFAULT_RULES, RULES_VERSION, rankTitle, SHORT_RULES, type DisplayConfig, DEFAULT_DISPLAY, type RuleConfig } from './rules';
import { parseCommand, SYNTAX_HINT, type Command } from './commands';
import { pickQuestion, validateQuestion } from './questions';
import { safeDisplayName, shortName, speakableName } from './filter';
import { buildStageGuide, joinVi } from './guide';
import {
  GUIDE_REMINDER_INTERVAL_MS,
  MAX_AUX_PER_QUESTION,
  McDirector,
  MIN_AUX_GAP_MS,
  type McCategory,
  type McDataContext,
} from './mcDirector';
import type { Store, ResultRow } from '../store/db';
import type {
  CommandOutcome,
  Departed,
  EngineState,
  Honor,
  HonorEntry,
  InboundEvent,
  LogEntry,
  Notice,
  Phase,
  Player,
  Question,
  QuestionResult,
  SeatResult,
  SessionScore,
  Tenure,
} from './types';

export interface EngineOptions {
  store: Store;
  now?: () => number;
  rng?: () => number;
  rules?: Partial<RuleConfig>;
}

export type PlayerStatus = 'KHÁN GIẢ' | 'ĐÃ ĐĂNG KÝ' | 'GHẾ CHỜ' | 'ĐƯỢC MỜI' | 'GHẾ NÓNG' | 'TẠM KHÓA';

export interface McLine {
  id: number;
  text: string;
  at: number;
  category?: McCategory;
  templateId?: string;
  durationMs?: number;
  isAux?: boolean;
}

const ACTIVE_PHASES: Phase[] = ['TRANSITION', 'INVITING', 'PREPARE', 'OPEN', 'REVEAL', 'HONOR'];
const NOTICE_MS = 5_000;
const NOTICE_MAX_VISIBLE = 3;
const NOTICE_QUEUE_MAX = 20;
const AUDIENCE_ACTIVE_MS = 10 * 60_000;
const LOG_MAX = 600;
const REPLAY_KINDS = new Set(['cho', 'huy', 'vao', 'nhuong']);

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
export const templateOf = (userId: string) => hash(userId) % 8;

export class GameEngine {
  state: EngineState;
  readonly store: Store;
  readonly now: () => number;
  readonly rng: () => number;
  readonly baseRules: RuleConfig;
  readonly mcDirector: McDirector;
  players = new Map<string, Player>();
  questions: Question[] = [];
  display: DisplayConfig = { ...DEFAULT_DISPLAY };
  /** đáp án đầu tiên của câu đang chạy (đồng bộ với bảng answers) */
  answers = new Map<string, { choice: string; at: number }>();
  log: LogEntry[] = [];
  notices: Notice[] = [];
  private noticeQueue: Omit<Notice, 'until'>[] = [];
  private noticeId = 0;
  private logId = 0;
  private infoCooldown = new Map<string, number>();
  private giftBuffer: { name: string; gift: string; count: number }[] = [];
  private lastGiftNoticeAt = 0;
  private dirtyPlayers = new Set<string>();
  private listeners = new Set<() => void>();
  mc: McLine | null = null;
  private mcId = 0;
  private lastNewcomerAt = -Infinity;
  private revealEncouragedRunId: string | null = null;
  /** đếm số lần chấm để kiểm thử "không chấm hai lần" */
  gradeCount = 0;

  constructor(opts: EngineOptions) {
    this.store = opts.store;
    this.now = opts.now ?? Date.now;
    this.rng = opts.rng ?? Math.random;
    this.baseRules = { ...DEFAULT_RULES, ...(opts.rules ?? {}) };
    this.mcDirector = new McDirector({ now: this.now, rng: this.rng });
    for (const p of this.store.loadPlayers()) this.players.set(p.userId, p);
    this.questions = this.store.loadQuestions();
    const disp = this.store.getMeta('display');
    if (disp) this.display = { ...DEFAULT_DISPLAY, ...JSON.parse(disp) };
    const snap = this.store.loadSnapshot();
    if (snap) {
      this.state = snap;
      this.recover();
    } else {
      this.state = this.initialState();
      this.commit();
    }
  }

  private initialState(): EngineState {
    const now = this.now();
    return {
      version: 1,
      session: null,
      phase: 'NO_SESSION',
      phaseStartedAt: now,
      phaseEndsAt: null,
      pause: null,
      pauseBeforeNext: null,
      seats: Array(this.baseRules.hotSeats).fill(null),
      departed: Array(this.baseRules.hotSeats).fill(null),
      queue: [],
      nextTicket: 1,
      invites: [],
      inviteWave: 0,
      current: null,
      lastResult: null,
      honor: null,
      scores: {},
      usedQuestionIds: [],
      plan: [],
      recentTopics: [],
      lastHard: false,
      lastInteractionAt: now,
      config: { ...this.baseRules },
      pendingConfig: null,
      undo: null,
      audienceShown: [],
      roundBoard: null,
      lastTickAt: now,
      sourceHealthy: false,
      noQuestionsWarning: false,
    };
  }

  // ======================================================================
  // Hạ tầng: lưu, nhật ký, thông báo, MC
  // ======================================================================
  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed() {
    for (const fn of this.listeners) fn();
  }

  /** Ghi ảnh chụp trạng thái + người chơi thay đổi + phần ghi thêm, trong MỘT giao dịch */
  private commit(extra?: () => void) {
    this.store.tx(() => {
      extra?.();
      for (const id of this.dirtyPlayers) {
        const p = this.players.get(id);
        if (p) this.store.upsertPlayer(p);
      }
      this.store.saveSnapshot(this.state);
    });
    this.dirtyPlayers.clear();
    this.changed();
  }

  private addLog(e: Omit<LogEntry, 'id' | 'at'> & { at?: number }) {
    const entry: LogEntry = { id: ++this.logId, at: e.at ?? this.now(), ...e };
    this.log.push(entry);
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
    return entry;
  }
  private sys(message: string) {
    this.addLog({ kind: 'system', message });
  }

  private notice(text: string, kind: Notice['kind'] = 'info') {
    this.noticeQueue.push({ id: ++this.noticeId, text, kind });
    if (this.noticeQueue.length > NOTICE_QUEUE_MAX) this.noticeQueue.shift();
    this.pumpNotices();
  }
  private pumpNotices() {
    const now = this.now();
    this.notices = this.notices.filter((n) => n.until > now);
    while (this.notices.length < NOTICE_MAX_VISIBLE && this.noticeQueue.length) {
      const n = this.noticeQueue.shift()!;
      this.notices.push({ ...n, until: now + (n.kind === 'gift' ? this.state.config.giftFxMs : NOTICE_MS) });
    }
  }

  private say(text: string, meta?: Partial<Omit<McLine, 'id' | 'text' | 'at'>>) {
    const now = this.now();
    const durationMs = meta?.durationMs ?? 3500;
    this.mcDirector.lastSpeechEndAt = Math.max(now, this.mcDirector.lastSpeechEndAt) + durationMs;
    this.mc = {
      id: ++this.mcId,
      text,
      at: now,
      category: meta?.category,
      templateId: meta?.templateId,
      durationMs,
      isAux: meta?.isAux ?? false,
    };
  }

  /**
   * Kiểm tra vị trí thực tế hiện tại của một người chơi ngay trước khi MC phát lời chào.
   * Nếu người chơi đã đổi vị trí (ví dụ từ ghế chờ lên ghế nóng, hoặc đã rời hàng chờ), trả về vị trí thực tế mới.
   */
  resolvePlayerPositionForMc(userId: string): { active: boolean; currentPosNote: string | null } {
    const p = this.players.get(userId);
    if (!p || p.locked) return { active: false, currentPosNote: null };
    const seatIdx = this.seatOf(userId);
    if (seatIdx >= 0) {
      return { active: true, currentPosNote: `ghế nóng số ${seatIdx + 1}` };
    }
    const inv = this.inviteOf(userId);
    if (inv) {
      return { active: true, currentPosNote: `danh sách mời ghế nóng số ${inv.seat}` };
    }
    const qi = this.queueIndex(userId);
    if (qi >= 0) {
      if (qi < this.rules.waitingSeats) {
        return { active: true, currentPosNote: `ghế chờ số ${qi + 1}` };
      }
      return { active: true, currentPosNote: `hàng chờ thứ ${qi + 1}` };
    }
    return { active: true, currentPosNote: null };
  }

  /**
   * Thu thập dữ liệu THẬT 100% từ trạng thái hiện tại của máy chủ để điền vào ngân hàng lời thoại MC.
   */
  buildMcContext(extra: Partial<McDataContext> = {}): McDataContext {
    const s = this.state;
    const cur = s.current;
    const q = cur ? this.questionById(cur.questionId) : undefined;
    const seatedTenures = s.seats.filter((t): t is Tenure => Boolean(t));
    const hotSeatedCount = seatedTenures.length;
    const emptySeatCount = this.rules.hotSeats - hotSeatedCount;
    const hotAnsweredCount =
      s.phase === 'OPEN'
        ? seatedTenures.filter((t) => this.answers.has(t.userId)).length
        : s.lastResult
          ? s.lastResult.seats.filter((r) => r.answered).length
          : 0;
    const hotRemainingCount = Math.max(0, hotSeatedCount - hotAnsweredCount);
    const answeredCount = s.phase === 'OPEN' ? this.answers.size : (s.lastResult?.totalAnswers ?? 0);
    const waitingCount = Math.min(s.queue.length, this.rules.waitingSeats);

    // Tìm người đang có chuỗi đúng (level) cao nhất trên ghế nóng
    let topTenure: Tenure | null = null;
    for (const t of seatedTenures) {
      if (!topTenure || t.level > topTenure.level) topTenure = t;
    }

    // Dữ liệu lời mời hiện tại
    const invNames = s.invites.slice(0, 3).map((inv) => `${speakableName(this.nameOf(inv.userId))} ghế ${inv.seat}`);
    const invMore = Math.max(0, s.invites.length - invNames.length);
    const invitedNamesText = invNames.length
      ? `${joinVi(invNames)}${invMore > 0 ? ` và ${invMore} bạn nữa` : ''}`
      : '';

    // Dữ liệu kết quả câu vừa chấm & người bị loại
    const lastRes = s.lastResult;
    const elimSeats = lastRes ? lastRes.seats.filter((r) => !r.stays) : [];
    const elimShown = elimSeats.slice(0, 3).map((r) => speakableName(r.nickname));
    const elimMore = Math.max(0, elimSeats.length - elimShown.length);
    const eliminatedNamesText = elimShown.length
      ? `${joinVi(elimShown)}${elimMore > 0 ? ` và ${elimMore} bạn` : ''}`
      : '';
    const keepCount = lastRes ? lastRes.seats.filter((r) => r.stays).length : (s.honor?.keepCount ?? 0);

    // Dữ liệu vinh danh
    const hEntries = s.honor?.entries ?? [];
    const hShown = hEntries.slice(0, 3).map((e) => speakableName(e.nickname));
    const hMore = Math.max(0, hEntries.length - hShown.length);
    const honoredNamesText = hShown.length ? `${joinVi(hShown)}${hMore > 0 ? ` và ${hMore} bạn` : ''}` : '';
    const honoredLevel = hEntries.length ? Math.max(...hEntries.map((e) => e.level)) : (topTenure?.level ?? 0);

    return {
      phase: s.phase,
      round: s.session?.round ?? 1,
      code: cur?.code ?? s.lastResult?.code ?? s.session?.nextCode ?? 1,
      topic: q?.topic ?? '',
      questionText: q?.text ?? '',
      hotSeatedCount,
      emptySeatCount,
      hotAnsweredCount,
      hotRemainingCount,
      answeredCount,
      waitingCount,
      queueTotal: s.queue.length,
      topStreakLevel: topTenure?.level ?? 0,
      topStreakName: topTenure ? speakableName(this.nameOf(topTenure.userId)) : '',
      topStreakSeat: topTenure?.seat ?? 0,
      invitedNamesText,
      invitedCount: s.invites.length,
      inviteSec: Math.round(this.rules.inviteConfirmMs / 1000),
      welcomeNamesText: '',
      welcomeCount: 0,
      welcomeExtraCount: 0,
      welcomePositionNote: '',
      correctChoice: lastRes?.correct ?? '',
      totalCorrect: lastRes?.totalCorrect ?? 0,
      keepCount,
      eliminatedCount: elimSeats.length,
      eliminatedNamesText,
      honoredNamesText,
      honoredCount: hEntries.length,
      honoredLevel,
      allFloorWon: Boolean(s.honor?.allFloor || (lastRes && lastRes.seats.length === this.rules.hotSeats && keepCount === this.rules.hotSeats)),
      giftSendersText: '',
      giftSenderCount: 0,
      giftName: '',
      giftTotalCount: 0,
      pointsCorrect: this.rules.pointsCorrect,
      milestonesText: joinVi(this.rules.milestones),
      ...extra,
    };
  }

  /**
   * Phát 1 câu thoại từ ngân hàng có điều kiện theo nhóm `category`.
   */
  emitMcFromCategory(
    category: McCategory,
    extraCtx: Partial<McDataContext> = {},
    opts: { isAux?: boolean; remainPhaseMs?: number | null; now?: number } = {},
  ): boolean {
    const ctx = this.buildMcContext(extraCtx);
    const picked = this.mcDirector.pickAndRender(category, ctx, opts);
    if (!picked) return false;
    this.mc = {
      id: ++this.mcId,
      text: picked.text,
      at: picked.at,
      category: picked.category,
      templateId: picked.templateId,
      durationMs: picked.durationMs,
      isAux: picked.isAux,
    };
    return true;
  }

  /**
   * Điều phối lời thoại phụ theo nhịp đồng hồ máy chủ:
   * - Khi còn <= 5 giây ở pha OPEN: ngừng chào hỏi, cảm ơn quà và đùa; ưu tiên nhắc hết giờ (nhacGio).
   * - Trong 1 câu hỏi (OPEN): tối đa 1–2 câu phụ (3–6s), cách nhau ít nhất 8 giây, giữ khoảng yên tĩnh để suy nghĩ,
   *   và không bắt đầu lời phụ nếu thời gian còn lại không đủ phát hết.
   * - Ở pha REVEAL: nếu có người bị loại, sau khi công bố đáp án xong sẽ phát câu động viên (dongVien).
   * - Nhắc cách chơi khoảng 2–3 phút/lần ở lúc chuyển câu hoặc đón người mới (không đọc luật dài lúc đang OPEN).
   */
  private tickMc(now: number): boolean {
    const s = this.state;
    this.mcDirector.pruneStaleQueues(now);
    const remainPhaseMs = s.phaseEndsAt != null ? Math.max(0, s.phaseEndsAt - now) : null;

    // 1. Pha OPEN (Đang nhận đáp án)
    if (s.phase === 'OPEN' && s.current) {
      const runId = s.current.runId;
      // Khi còn <= 5 giây: ngừng mọi chào hỏi / cảm ơn / đùa, ưu tiên nhắc hết giờ
      if (remainPhaseMs !== null && remainPhaseMs <= 5_000 && remainPhaseMs >= 600) {
        if (this.mcDirector.warned5sRunId !== runId) {
          this.mcDirector.warned5sRunId = runId;
          return this.emitMcFromCategory('nhacGio', {}, { isAux: false, remainPhaseMs, now });
        }
        return false;
      }

      // Khi còn > 5.5 giây: kiểm tra điều kiện phát câu phụ (tối đa 1–2 câu phụ, cách nhau >= 8 giây, giữ vài giây yên tĩnh)
      const availBefore5s = remainPhaseMs !== null ? remainPhaseMs - 5_000 : Infinity;
      const elapsedOpenMs = now - s.phaseStartedAt;
      const quietEnough = now >= this.mcDirector.lastSpeechEndAt + 2_200 && elapsedOpenMs >= 5_500;
      const gapEnough = now - this.mcDirector.lastAuxAt >= MIN_AUX_GAP_MS;

      if (
        availBefore5s >= 3_600 &&
        quietEnough &&
        gapEnough &&
        this.mcDirector.auxCountInQuestion < MAX_AUX_PER_QUESTION
      ) {
        // Ưu tiên 1: Cảm ơn quà đã gom (nếu có)
        if (this.mcDirector.pendingGifts.length > 0) {
          const giftBatch = this.mcDirector.consumeGiftBatch(now);
          if (giftBatch) {
            return this.emitMcFromCategory(
              'camOnQua',
              {
                giftSendersText: giftBatch.sendersText,
                giftSenderCount: giftBatch.senderCount,
                giftName: giftBatch.giftName,
                giftTotalCount: giftBatch.totalCount,
              },
              { isAux: true, remainPhaseMs: availBefore5s, now },
            );
          }
        }

        // Ưu tiên 2: Chào người mới (gom 2–3 tên, kiểm tra lại vị trí thực tế ngay trước khi phát)
        if (this.mcDirector.pendingWelcomes.length > 0) {
          const welcomeBatch = this.mcDirector.consumeWelcomeBatch((uid) => this.resolvePlayerPositionForMc(uid), now);
          if (welcomeBatch) {
            return this.emitMcFromCategory(
              'chaoHoi',
              {
                welcomeNamesText: welcomeBatch.namesText,
                welcomeCount: welcomeBatch.count,
                welcomeExtraCount: welcomeBatch.extraCount,
                welcomePositionNote: welcomeBatch.positionNote,
              },
              { isAux: true, remainPhaseMs: availBefore5s, now },
            );
          }
        }

        // Ưu tiên 3: Bình luận tình huống thật khi chờ trả lời (số ghế đã chốt / chuỗi đúng / số người trả lời)
        return this.emitMcFromCategory('choTraLoi', {}, { isAux: true, remainPhaseMs: availBefore5s, now });
      }
      return false;
    }

    // 2. Pha REVEAL (Công bố kết quả): nếu có người bị loại, phát câu động viên ở nửa sau pha REVEAL
    if (s.phase === 'REVEAL' && s.current) {
      const runId = s.current.runId;
      const elapsedReveal = now - s.phaseStartedAt;
      const hasElim = Boolean(s.lastResult?.seats.some((r) => !r.stays));
      if (
        hasElim &&
        this.revealEncouragedRunId !== runId &&
        elapsedReveal >= 2_200 &&
        (remainPhaseMs === null || remainPhaseMs >= 1_800)
      ) {
        this.revealEncouragedRunId = runId;
        return this.emitMcFromCategory('dongVien', {}, { isAux: false, remainPhaseMs, now });
      }
      return false;
    }

    // 3. Các pha chuyển câu / chờ (TRANSITION, INVITING, PREPARE, STANDBY):
    //    Ưu tiên nhắc cách chơi định kỳ 2–3 phút/lần hoặc chào người mới / cảm ơn quà khi MC đang rảnh
    if (['TRANSITION', 'INVITING', 'PREPARE', 'STANDBY'].includes(s.phase)) {
      if (now < this.mcDirector.lastSpeechEndAt + 600) return false;
      const remainBeforeOpenMs =
        s.phase === 'STANDBY'
          ? null
          : s.phase === 'TRANSITION' || s.phase === 'INVITING'
            ? (remainPhaseMs ?? 0) + this.rules.prepareMs
            : remainPhaseMs;
      if (remainBeforeOpenMs !== null && remainBeforeOpenMs < 3_200) return false;

      // Nhắc hướng dẫn cách chơi khoảng 2–3 phút một lần (ưu tiên lúc chuyển câu hoặc đón người mới)
      if (now - this.mcDirector.lastGuideReminderAt >= GUIDE_REMINDER_INTERVAL_MS) {
        this.mcDirector.lastGuideReminderAt = now;
        if (this.emitMcFromCategory('huongDan', {}, { isAux: true, remainPhaseMs: remainBeforeOpenMs, now })) {
          return true;
        }
      }

      if (this.mcDirector.pendingWelcomes.length > 0) {
        const welcomeBatch = this.mcDirector.consumeWelcomeBatch((uid) => this.resolvePlayerPositionForMc(uid), now);
        if (welcomeBatch) {
          return this.emitMcFromCategory(
            'chaoHoi',
            {
              welcomeNamesText: welcomeBatch.namesText,
              welcomeCount: welcomeBatch.count,
              welcomeExtraCount: welcomeBatch.extraCount,
              welcomePositionNote: welcomeBatch.positionNote,
            },
            { isAux: true, remainPhaseMs: remainBeforeOpenMs, now },
          );
        }
      }

      if (this.mcDirector.pendingGifts.length > 0) {
        const giftBatch = this.mcDirector.consumeGiftBatch(now);
        if (giftBatch) {
          return this.emitMcFromCategory(
            'camOnQua',
            {
              giftSendersText: giftBatch.sendersText,
              giftSenderCount: giftBatch.senderCount,
              giftName: giftBatch.giftName,
              giftTotalCount: giftBatch.totalCount,
            },
            { isAux: true, remainPhaseMs: remainBeforeOpenMs, now },
          );
        }
      }
    }

    return false;
  }

  private setPhase(p: Phase, durMs: number | null) {
    const now = this.now();
    this.state.phase = p;
    this.state.phaseStartedAt = now;
    this.state.phaseEndsAt = durMs == null ? null : now + durMs;
  }

  get rules() {
    return this.state.config;
  }

  // ======================================================================
  // Người chơi
  // ======================================================================
  private ensurePlayer(ev: InboundEvent): { player: Player; created: boolean } {
    const id = ev.userId!;
    let p = this.players.get(id);
    const nickname = safeDisplayName(ev.nickname);
    if (!p) {
      p = {
        userId: id,
        nickname,
        avatar: ev.avatar ?? '',
        createdAt: ev.receivedAt,
        autoRequeue: true,
        locked: false,
        bestLevelAll: 0,
        badges: [],
        totalPointsAll: 0,
        lastActiveAt: ev.receivedAt,
      };
      this.players.set(id, p);
      this.dirtyPlayers.add(id);
      return { player: p, created: true };
    }
    // §2: tên đổi không làm mất hồ sơ
    if (p.nickname !== nickname || (ev.avatar && ev.avatar !== p.avatar)) {
      p.nickname = nickname;
      if (ev.avatar) p.avatar = ev.avatar;
      this.dirtyPlayers.add(id);
    }
    p.lastActiveAt = ev.receivedAt;
    return { player: p, created: false };
  }

  seatOf(userId: string): number {
    return this.state.seats.findIndex((t) => t?.userId === userId);
  }
  queueIndex(userId: string): number {
    return this.state.queue.findIndex((q) => q.userId === userId);
  }
  inviteOf(userId: string) {
    return this.state.invites.find((i) => i.userId === userId);
  }

  statusOf(userId: string): PlayerStatus {
    const p = this.players.get(userId);
    if (p?.locked) return 'TẠM KHÓA';
    if (this.seatOf(userId) >= 0) return 'GHẾ NÓNG';
    if (this.inviteOf(userId)) return 'ĐƯỢC MỜI';
    const qi = this.queueIndex(userId);
    if (qi >= 0) return qi < this.rules.waitingSeats ? 'GHẾ CHỜ' : 'ĐÃ ĐĂNG KÝ';
    return 'KHÁN GIẢ';
  }

  private scoreOf(userId: string): SessionScore {
    return (this.state.scores[userId] ??= { sessionPoints: 0, roundPoints: 0, correct: 0, bestLevelSession: 0 });
  }

  private nameOf(userId: string) {
    return this.players.get(userId)?.nickname ?? 'Người chơi';
  }

  private vacateSeat(idx: number, reason: Departed['reason']) {
    const t = this.state.seats[idx];
    if (!t) return;
    this.state.seats[idx] = null;
    this.state.departed[idx] = { userId: t.userId, nickname: this.nameOf(t.userId), reason };
  }

  /**
   * Tự động đưa người chơi hợp lệ vào 10 ghế chờ mà không cần gõ "chờ".
   * Khi ghế chờ (< 10) còn trống, tự động lấy người chơi đang có autoRequeue = true và chưa có vị trí đẩy vào hàng chờ.
   */
  refillWaitingQueue(): boolean {
    const busy = new Set<string>([
      ...this.state.seats.filter(Boolean).map((t) => t!.userId),
      ...this.state.invites.map((i) => i.userId),
      ...this.state.queue.map((q) => q.userId),
    ]);
    let added = false;
    for (const p of this.players.values()) {
      if (this.state.queue.length >= this.rules.waitingSeats) break;
      if (!p.locked && p.autoRequeue && !busy.has(p.userId)) {
        this.state.queue.push({ ticket: this.state.nextTicket++, userId: p.userId });
        busy.add(p.userId);
        added = true;
      }
    }
    return added;
  }

  /** Đưa người được chọn vào ghế nóng (tự động sau 12s hoặc khi gõ SS sớm) */
  private seatInvitedPlayer(inv: { seat: number; userId: string; expiresAt: number; wave: number }, now: number, mode: 'auto' | 'manual'): boolean {
    const idx = inv.seat - 1;
    this.state.invites = this.state.invites.filter((i) => i !== inv);
    if (this.state.seats[idx]) return false;
    const p = this.players.get(inv.userId);
    const name = p?.nickname ?? 'Người chơi';
    this.state.seats[idx] = {
      tenureId: `${inv.userId}@${now}`,
      userId: inv.userId,
      seat: inv.seat,
      level: 0,
      startedAt: now,
      recordAtStart: p?.bestLevelAll ?? 0,
      recordBrokenAnnounced: false,
    };
    this.state.departed[idx] = null;
    this.notice(`🔥 ${shortName(name, 18)} lên ghế ${inv.seat}`, 'system');
    this.addLog({
      kind: 'system',
      userId: inv.userId,
      nickname: name,
      message:
        mode === 'auto'
          ? `Hoàn tất ${this.rules.inviteConfirmMs / 1000} giây: tự động lên ghế nóng số ${inv.seat}, cấp khởi đầu 0`
          : `Đã xác nhận lên ghế nóng số ${inv.seat}, cấp khởi đầu 0`,
    });
    return true;
  }

  // ======================================================================
  // Sự kiện vào (bình luận / quà) — CÙNG một luồng cho giả lập và TikTok
  // ======================================================================
  handleInbound(ev: InboundEvent, opts: { replay?: boolean } = {}): CommandOutcome {
    if (ev.type === 'like') return { accepted: false, reason: 'Thả tim không ảnh hưởng luật chơi' };
    if (ev.type === 'gift') return this.handleGift(ev);

    const text = String(ev.text ?? '');
    if (!ev.userId) {
      // §2: chưa có định danh đáng tin cậy -> không ghi điểm/ghế, ghi lỗi
      this.addLog({ kind: 'error', text, nickname: ev.nickname, accepted: false, message: 'Bỏ qua: sự kiện thiếu định danh tài khoản ổn định' });
      this.changed();
      return { accepted: false, reason: 'Thiếu định danh tài khoản' };
    }
    const cmd = parseCommand(text);
    if (!cmd) {
      this.addLog({ kind: 'command', userId: ev.userId, nickname: ev.nickname, text, accepted: false, message: 'Không phải lệnh (bình luận thường, không tính). ' + SYNTAX_HINT });
      this.changed();
      return { accepted: false, reason: 'Không phải lệnh' };
    }
    if (!opts.replay) {
      if (!ev.eventId) return this.reject(ev, cmd, 'Sự kiện thiếu mã, không xử lý');
      if (!this.store.markEvent(ev.eventId, ev.source, ev.receivedAt)) {
        return this.reject(ev, cmd, `Sự kiện trùng (mã ${ev.eventId} đã xử lý), bỏ qua`);
      }
    }
    const { player } = this.ensurePlayer(ev);
    if (player.locked) return this.reject(ev, cmd, 'Tài khoản đang bị tạm khóa');

    let out: CommandOutcome;
    switch (cmd.kind) {
      case 'vao':
        out = this.cmdVao(player);
        break;
      case 'cho':
        out = this.cmdCho(player);
        break;
      case 'huy':
        out = this.cmdHuy(player);
        break;
      case 'ss':
        out = this.cmdSs(player);
        break;
      case 'nhuong':
        out = this.cmdNhuong(player);
        break;
      case 'diem':
      case 'vitri':
        out = this.cmdInfo(player, cmd.kind);
        break;
      case 'answer':
        out = this.cmdAnswer(player, cmd, ev);
        break;
    }
    out.command = cmd.kind;
    this.addLog({ kind: 'command', userId: player.userId, nickname: player.nickname, text, accepted: out.accepted, message: out.reason });
    try {
      this.store.logCommand(ev.receivedAt, player.userId, text, out.accepted, out.reason);
    } catch {
      // nhật ký lỗi không được làm hỏng luồng chơi
    }
    if (out.accepted) {
      this.state.lastInteractionAt = ev.receivedAt;
      if (cmd.kind !== 'huy' && cmd.kind !== 'nhuong') {
        this.refillWaitingQueue();
      }
      const posInfo = this.resolvePlayerPositionForMc(player.userId);
      if (
        this.mcDirector.enqueueNewcomerOnFirstValidAction(
          player.userId,
          player.nickname,
          posInfo.currentPosNote ?? '',
          ev.receivedAt,
        )
      ) {
        this.lastNewcomerAt = ev.receivedAt;
      }
      if (this.state.undo && !opts.replay && REPLAY_KINDS.has(cmd.kind)) this.state.undo.replay.push(ev);
      if (this.state.phase === 'STANDBY') {
        this.sys('Có tương tác mới: đánh thức game');
        this.beginBoundary();
      }
    }
    if (cmd.kind === 'answer' && out.accepted) {
      // đáp án đã ghi trong bảng answers (khóa đáp án đầu tiên); câu chưa chấm thì không cần chụp lại toàn bộ trạng thái
      if (this.dirtyPlayers.size) this.commit();
      else this.changed();
    } else if (out.accepted || this.dirtyPlayers.size) {
      this.commit();
    } else {
      this.changed();
    }
    return out;
  }

  private reject(ev: InboundEvent, cmd: Command, reason: string): CommandOutcome {
    this.addLog({ kind: 'command', userId: ev.userId, nickname: ev.nickname, text: ev.text, accepted: false, message: reason });
    try {
      this.store.logCommand(ev.receivedAt, ev.userId ?? '', String(ev.text ?? ''), false, reason);
    } catch {
      // bỏ qua
    }
    this.changed();
    return { accepted: false, reason, command: cmd.kind };
  }

  private cmdVao(p: Player): CommandOutcome {
    if (!p.autoRequeue) {
      p.autoRequeue = true;
      this.dirtyPlayers.add(p.userId);
    }
    if (this.seatOf(p.userId) < 0 && !this.inviteOf(p.userId) && this.queueIndex(p.userId) < 0) {
      this.state.queue.push({ ticket: this.state.nextTicket++, userId: p.userId });
      const pos = this.state.queue.length;
      return {
        accepted: true,
        reason: `Đã tham gia và tự động vào hàng ghế chờ (thứ tự #${pos})`,
      };
    }
    return { accepted: true, reason: 'Đã tham gia phòng chơi (đang có vị trí trên sân/hàng chờ)' };
  }

  private cmdCho(p: Player): CommandOutcome {
    const s = this.seatOf(p.userId);
    if (s >= 0) return { accepted: false, reason: `Đang ở ghế nóng số ${s + 1}, không cần đăng ký` };
    const inv = this.inviteOf(p.userId);
    if (inv) return { accepted: false, reason: `Đang được chọn lên ghế ${inv.seat} (tự động vào ghế sau 12s)` };
    const qi = this.queueIndex(p.userId);
    if (qi >= 0) return { accepted: false, reason: `Đã có số thứ tự ${qi + 1}; gửi lại "chờ" không đổi thứ tự` };
    this.state.queue.push({ ticket: this.state.nextTicket++, userId: p.userId });
    if (!p.autoRequeue) {
      p.autoRequeue = true;
      this.dirtyPlayers.add(p.userId);
    }
    const pos = this.state.queue.length;
    return { accepted: true, reason: `Đã vào hàng chờ, thứ tự ${pos}${pos <= this.rules.waitingSeats ? ' (ghế chờ)' : ' (ngồi khán đài chờ tới lượt)'}; bật tự xếp lại` };
  }

  private cmdHuy(p: Player): CommandOutcome {
    const parts: string[] = [];
    const qi = this.queueIndex(p.userId);
    if (qi >= 0) {
      this.state.queue.splice(qi, 1);
      parts.push('rời danh sách chờ');
    }
    const inv = this.inviteOf(p.userId);
    if (inv) {
      this.state.invites = this.state.invites.filter((i) => i !== inv);
      parts.push(`hủy lên ghế ${inv.seat}`);
    }
    const wasAuto = p.autoRequeue;
    if (p.autoRequeue) {
      p.autoRequeue = false;
      this.dirtyPlayers.add(p.userId);
    }
    const s = this.seatOf(p.userId);
    if (s >= 0) parts.push(`tắt tự xếp lại, vẫn giữ ghế ${s + 1} tới khi nhường/rớt`);
    else if (wasAuto || parts.length) parts.push('tắt tự xếp lại');
    if (!parts.length) return { accepted: false, reason: 'Chưa trong hàng chờ nên không có gì để hủy' };
    this.refillWaitingQueue();
    if (inv && this.state.phase === 'INVITING' && this.state.invites.length === 0) this.endWave();
    return { accepted: true, reason: 'Đã ' + parts.join(', ') };
  }

  private cmdSs(p: Player): CommandOutcome {
    const inv = this.inviteOf(p.userId);
    if (!inv) return { accepted: false, reason: 'Chỉ dùng khi đang trong 12 giây chuẩn bị lên ghế nóng' };
    const now = this.now();
    const idx = inv.seat - 1;
    if (this.state.seats[idx]) return { accepted: false, reason: `Ghế ${inv.seat} đã có người, bỏ qua` };
    this.seatInvitedPlayer(inv, now, 'manual');
    if (this.state.phase === 'INVITING' && this.state.invites.length === 0) this.endWave();
    return { accepted: true, reason: `Đã vào ghế nóng số ${inv.seat}, cấp khởi đầu 0` };
  }

  private cmdNhuong(p: Player): CommandOutcome {
    const s = this.seatOf(p.userId);
    if (s < 0) return { accepted: false, reason: '"nhường" chỉ dùng khi đang ở ghế nóng' };
    this.vacateSeat(s, 'yield');
    if (p.autoRequeue) {
      p.autoRequeue = false;
      this.dirtyPlayers.add(p.userId);
    }
    const open = this.state.phase === 'PREPARE' || this.state.phase === 'OPEN';
    return {
      accepted: true,
      reason: `Đã nhường ghế ${s + 1}, tắt tự xếp lại.${open ? ' Câu đang mở: đáp án (nếu có) chấm theo vai khán giả; ghế được bổ sung sau câu này' : ' Ghế được bổ sung ở lần chuyển câu tới'}`,
    };
  }

  private cmdInfo(p: Player, kind: 'diem' | 'vitri'): CommandOutcome {
    const now = this.now();
    const key = `${p.userId}:${kind}`;
    const last = this.infoCooldown.get(key) ?? -Infinity;
    if (now - last < this.rules.infoCooldownMs) {
      return { accepted: false, reason: `Lệnh "${kind === 'diem' ? 'điểm' : 'vị trí'}" chờ ${Math.ceil((this.rules.infoCooldownMs - (now - last)) / 1000)} giây nữa` };
    }
    this.infoCooldown.set(key, now);
    const name = shortName(p.nickname, 16);
    if (kind === 'diem') {
      const sc = this.state.scores[p.userId];
      this.notice(`${name}: ${sc?.sessionPoints ?? 0} điểm phiên · kỷ lục cấp ${p.bestLevelAll} · ${p.badges.length} huy hiệu`);
    } else {
      const s = this.seatOf(p.userId);
      const inv = this.inviteOf(p.userId);
      const qi = this.queueIndex(p.userId);
      this.notice(
        s >= 0
          ? `${name}: đang ở ghế nóng số ${s + 1}`
          : inv
            ? `${name}: được mời lên ghế ${inv.seat}, gõ SS`
            : qi >= 0
              ? `${name}: thứ tự chờ số ${qi + 1}`
              : `${name}: chưa đăng ký, gõ CHỜ để xếp hàng`,
      );
    }
    return { accepted: true, reason: 'Đã hiện thông tin trên bảng thông báo' };
  }

  private cmdAnswer(p: Player, cmd: Extract<Command, { kind: 'answer' }>, ev: InboundEvent): CommandOutcome {
    const cur = this.state.current;
    const now = ev.receivedAt;
    if (this.state.phase !== 'OPEN' || !cur || cur.status !== 'open' || cur.closesAt == null) {
      const why = this.state.phase === 'PREPARE' ? 'gửi sớm (câu chưa mở)' : 'không có câu đang mở nhận đáp án';
      return { accepted: false, reason: `Không tính: ${why}` };
    }
    if (cmd.code !== cur.code) return { accepted: false, reason: `Không tính: sai mã câu (đang là câu ${cur.code}, ví dụ ${cur.code}B)` };
    // §7: nhận khi now < thời điểm đóng; đúng bằng thời điểm đóng là trễ
    if (!(now < cur.closesAt)) return { accepted: false, reason: 'Không tính: quá hạn nhận đáp án' };
    if (this.answers.has(p.userId)) return { accepted: false, reason: `Không tính: đã khóa đáp án đầu tiên cho câu ${cur.code}` };
    if (!this.store.insertAnswer(cur.runId, p.userId, cmd.choice, now, ev.eventId)) {
      return { accepted: false, reason: `Không tính: đã khóa đáp án đầu tiên cho câu ${cur.code}` };
    }
    this.answers.set(p.userId, { choice: cmd.choice, at: now });
    const role = this.seatOf(p.userId) >= 0 ? 'ghế nóng' : 'khán giả';
    return { accepted: true, reason: `Đã khóa đáp án câu ${cur.code} (${role})` };
  }

  // ---------- Quà (§13): chỉ hiệu ứng trang trí, KHÔNG đổi điểm/thứ tự/kết quả ----------
  private handleGift(ev: InboundEvent): CommandOutcome {
    if (ev.eventId && !this.store.markEvent(ev.eventId, ev.source, ev.receivedAt)) {
      return { accepted: false, reason: 'Sự kiện quà trùng, bỏ qua' };
    }
    const name = shortName(safeDisplayName(ev.nickname), 16);
    const g = ev.gift ?? { name: 'Quà', count: 1, diamonds: 1 };
    const count = Math.max(1, g.count | 0);
    const uid = (ev.userId || '').trim() || `guest_${name}`;
    this.mcDirector.enqueueGift(uid, safeDisplayName(ev.nickname), g.name, count, ev.receivedAt);
    this.giftBuffer.push({ name, gift: g.name, count });
    this.addLog({ kind: 'system', userId: ev.userId, nickname: ev.nickname, message: `Quà "${g.name}" ×${g.count}: chỉ hiệu ứng cảm ơn, không đổi điểm/ghế/hàng chờ` });
    this.flushGifts();
    this.changed();
    return { accepted: true, reason: 'Quà chỉ dùng để cảm ơn' };
  }
  private flushGifts() {
    const now = this.now();
    if (!this.giftBuffer.length || now - this.lastGiftNoticeAt < this.rules.giftFxMs) return;
    const names = [...new Set(this.giftBuffer.map((g) => g.name))];
    const total = this.giftBuffer.reduce((a, g) => a + g.count, 0);
    const text =
      names.length === 1
        ? `🎁 Cảm ơn ${names[0]} đã tặng ${this.giftBuffer[0].gift}${total > 1 ? ` ×${total}` : ''}!`
        : `🎁 Cảm ơn ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` và ${names.length - 2} bạn` : ''} đã tặng quà!`;
    this.giftBuffer = [];
    this.lastGiftNoticeAt = now;
    this.notice(text, 'gift');
  }

  // ======================================================================
  // Đồng hồ
  // ======================================================================
  tick() {
    const now = this.now();
    const s = this.state;
    let dirty = false;
    if (s.session && ACTIVE_PHASES.includes(s.phase)) s.session.roundActiveMs += Math.max(0, now - s.lastTickAt);
    s.lastTickAt = now;
    const before = this.notices.length + this.noticeQueue.length;
    this.pumpNotices();
    this.flushGifts();
    if (this.notices.length + this.noticeQueue.length !== before) dirty = true;

    if (s.phase === 'INVITING') {
      const ready = s.invites.filter((i) => now >= i.expiresAt);
      for (const inv of ready) {
        this.seatInvitedPlayer(inv, now, 'auto');
      }
      if (ready.length) {
        if (s.invites.length === 0) this.endWave();
        else this.commit();
        return;
      }
    } else {
      let guard = 0;
      while (s.phaseEndsAt != null && now >= s.phaseEndsAt && guard++ < 10) {
        this.advance();
        dirty = false;
      }
    }
    if (this.tickMc(now)) dirty = true;
    if (dirty) this.changed();
  }

  private advance() {
    switch (this.state.phase) {
      case 'PREPARE':
        return this.openQuestion();
      case 'OPEN':
        return this.grade();
      case 'REVEAL':
        this.setPhase('HONOR', this.rules.honorMs);
        this.sayHonor();
        return this.commit();
      case 'HONOR':
        if (this.state.session?.endRequested) return this.finishSession('Kết thúc phiên theo yêu cầu (sau câu đang chơi)');
        this.setPhase('TRANSITION', this.rules.transitionMs);
        return this.commit();
      case 'TRANSITION':
        return this.beginBoundary();
      case 'ROUND_BOARD':
        this.state.roundBoard = null;
        return this.nextQuestion();
      default:
        this.state.phaseEndsAt = null;
    }
  }

  // ======================================================================
  // Ranh giới câu: chuyển ghế -> mời -> (hiệp) -> câu mới
  // ======================================================================
  private beginBoundary() {
    const s = this.state;
    if (!s.session) return;
    s.departed = s.departed.map(() => null);
    s.lastResult = null;
    s.honor = null;
    if (s.session.endRequested) return this.finishSession('Kết thúc phiên theo yêu cầu');
    if (!s.sourceHealthy) return this.pauseInternal('Mất kết nối nguồn bình luận: tạm dừng trước câu tiếp', 'system', true);
    if (s.pauseBeforeNext) {
      const why = s.pauseBeforeNext;
      s.pauseBeforeNext = null;
      return this.pauseInternal(why, 'system', true);
    }
    this.refillWaitingQueue();
    this.rotateAudience();
    this.startWave(1);
  }

  private startWave(n: number) {
    const s = this.state;
    const now = this.now();
    this.refillWaitingQueue();
    const empty = s.seats.map((t, i) => (t ? -1 : i)).filter((i) => i >= 0);
    if (n > this.rules.maxInviteWaves || empty.length === 0 || s.queue.length === 0) return this.afterSeating();
    s.inviteWave = n;
    const names: string[] = [];
    for (const idx of empty) {
      const entry = s.queue.shift();
      if (!entry) break;
      s.invites.push({ seat: idx + 1, userId: entry.userId, expiresAt: now + this.rules.inviteConfirmMs, wave: n });
      names.push(`${speakableName(this.nameOf(entry.userId))} ghế ${idx + 1}`);
      this.addLog({
        kind: 'system',
        userId: entry.userId,
        nickname: this.nameOf(entry.userId),
        message: `Đợt ${n}: tự động chọn lên ghế nóng ${idx + 1} (đếm ngược ${this.rules.inviteConfirmMs / 1000} giây, không cần gõ SS)`,
      });
    }
    this.refillWaitingQueue();
    this.rotateAudience();
    this.setPhase('INVITING', this.rules.inviteConfirmMs);
    if (!this.emitMcFromCategory('moiLenGhe', {}, { isAux: false, now })) {
      this.say(`Mời ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` và ${names.length - 3} bạn nữa` : ''} chuẩn bị lên ghế nóng sau 12 giây.`, {
        category: 'moiLenGhe',
        durationMs: 4200,
      });
    }
    this.commit();
  }

  private endWave() {
    const s = this.state;
    const wave = s.inviteWave;
    const empty = s.seats.some((t) => !t);
    if (wave < this.rules.maxInviteWaves && empty && s.queue.length > 0) return this.startWave(wave + 1);
    if (empty && wave >= this.rules.maxInviteWaves) this.sys(`Đã đủ ${this.rules.maxInviteWaves} đợt mời: ghế còn trống chờ tới lần chuyển câu sau`);
    this.afterSeating();
  }

  private afterSeating() {
    const s = this.state;
    s.inviteWave = 0;
    s.invites = [];
    if (s.session && s.session.roundActiveMs >= this.rules.roundActiveMs) return this.closeRound();
    this.nextQuestion();
  }

  private closeRound() {
    const s = this.state;
    const sess = s.session!;
    s.roundBoard = this.ranking('roundPoints', 10);
    this.sys(`Chốt bảng hiệp ${sess.round}`);
    for (const sc of Object.values(s.scores)) sc.roundPoints = 0;
    sess.round += 1;
    sess.roundActiveMs = 0;
    this.setPhase('ROUND_BOARD', this.rules.roundBoardMs);
    if (!this.emitMcFromCategory('huongDan', {}, { isAux: false, now: this.now() })) {
      this.say(`Kết thúc hiệp ${sess.round - 1}. Chúc mừng các bạn dẫn đầu!`, { category: 'huongDan', durationMs: 3800 });
    }
    this.commit();
  }

  ranking(field: 'roundPoints' | 'sessionPoints', limit: number) {
    const rows = Object.entries(this.state.scores)
      .filter(([, v]) => v[field] > 0)
      .map(([userId, v]) => ({ userId, nickname: this.nameOf(userId), points: v[field] }))
      .sort((a, b) => b.points - a.points || a.nickname.localeCompare(b.nickname) || a.userId.localeCompare(b.userId));
    // §9: bằng điểm đồng hạng
    let rank = 0;
    let prev = -1;
    return rows.slice(0, limit).map((r, i) => {
      if (r.points !== prev) {
        rank = i + 1;
        prev = r.points;
      }
      return { rank, ...r };
    });
  }

  private nextQuestion() {
    const s = this.state;
    const now = this.now();
    if (!s.session) return;
    if (s.pendingConfig) {
      s.config = s.pendingConfig;
      s.pendingConfig = null;
      this.sys('Áp dụng thông số mới từ câu này');
    }
    const anySeated = s.seats.some(Boolean);
    if (!anySeated && now - s.lastInteractionAt >= this.rules.idleStandbyMs) {
      this.setPhase('STANDBY', null);
      this.sys(`Không còn ghế nóng và ${this.rules.idleStandbyMs / 1000} giây không có tương tác hợp lệ: màn hình chờ`);
      this.say('Sân khấu tạm nghỉ. Bình luận VÀO hoặc CHỜ để bắt đầu!', { category: 'huongDan', durationMs: 3800 });
      return this.commit();
    }
    const used = new Set(s.usedQuestionIds);
    const pick = pickQuestion(this.questions, used, s.plan, s.recentTopics, s.lastHard, this.rng);
    if (!pick) {
      s.noQuestionsWarning = true;
      s.current = null;
      this.setPhase('NO_QUESTIONS', null);
      this.addLog({ kind: 'error', message: 'Hết câu hỏi đã duyệt trong phiên: chuyển màn hình nghỉ, không lặp câu cũ' });
      this.say('Đã hết câu hỏi của phiên này. Cảm ơn các bạn, chúng ta nghỉ một chút nhé!', { category: 'huongDan', durationMs: 4000 });
      return this.commit();
    }
    if (pick.note) this.sys(`Chọn câu: ${pick.note}`);
    const q = pick.question;
    const code = s.session.nextCode++;
    const runId = `${s.session.id}-${code}`;
    s.usedQuestionIds.push(q.id);
    s.recentTopics = [...s.recentTopics, q.topic].slice(-5);
    s.lastHard = q.difficulty === 'kho';
    s.plan = pick.plan;
    s.current = {
      runId,
      questionId: q.id,
      code,
      status: 'prepare',
      openedAt: null,
      closesAt: null,
      seatHolders: s.seats.filter((t): t is Tenure => !!t).map((t) => ({ seat: t.seat, userId: t.userId })),
    };
    s.undo = null; // câu kế tiếp đã bắt đầu: không hoàn tác câu trước nữa
    this.answers.clear();
    this.setPhase('PREPARE', this.rules.prepareMs);
    if (now - this.mcDirector.lastGuideReminderAt >= GUIDE_REMINDER_INTERVAL_MS) {
      this.mcDirector.lastGuideReminderAt = now;
      if (!this.emitMcFromCategory('huongDan', {}, { isAux: false, now })) {
        this.say(`Câu ${code}. Chủ đề ${q.topic}. Gõ ${code}A, ${code}B, ${code}C hoặc ${code}D khi mở câu nhé!`, {
          category: 'huongDan',
          durationMs: 3600,
        });
      }
    } else {
      this.say(`Câu ${code}. Chủ đề ${q.topic}.`, { category: 'huongDan', durationMs: 2500 });
    }
    this.commit(() => this.store.insertRun({ runId, sessionId: s.session!.id, code, questionId: q.id, preparedAt: now }));
  }

  private openQuestion() {
    const s = this.state;
    const cur = s.current!;
    const now = this.now();
    cur.status = 'open';
    cur.openedAt = now;
    cur.closesAt = now + this.rules.openMs;
    s.phase = 'OPEN';
    s.phaseStartedAt = now;
    s.phaseEndsAt = cur.closesAt;
    const q = this.questionById(cur.questionId);
    this.mcDirector.onQuestionStart(cur.runId, now, 3600);
    this.say(q ? q.text : `Câu ${cur.code}`, { category: 'huongDan', durationMs: 3600, isAux: false });
    this.commit(() => this.store.setRunStatus(cur.runId, 'open', { openedAt: now, closesAt: cur.closesAt! }));
  }

  questionById(id: string) {
    return this.questions.find((q) => q.id === id);
  }

  // ======================================================================
  // KHÓA VÀ CHẤM — chỉ một lần cho mỗi câu
  // ======================================================================
  private grade() {
    const s = this.state;
    const cur = s.current;
    if (!cur || cur.status !== 'open') return;
    // chống chấm hai lần: kiểm tra cả trạng thái trong DB
    if (this.store.getRunStatus(cur.runId) === 'graded' || this.store.countResults(cur.runId) > 0) {
      this.addLog({ kind: 'error', message: `Câu ${cur.code} đã được chấm trước đó, không chấm lại` });
      cur.status = 'graded';
      this.setPhase('REVEAL', this.rules.revealMs);
      return this.commit();
    }
    const q = this.questionById(cur.questionId)!;
    const now = this.now();
    // ảnh chụp trước khi chấm (cho hoàn tác §14)
    const affected = new Set<string>([...this.answers.keys(), ...s.seats.filter(Boolean).map((t) => t!.userId)]);
    const undoSnapshot = JSON.stringify({ ...s, undo: null });
    const undoPlayers = [...affected].map((id) => this.players.get(id)).filter((p): p is Player => !!p).map((p) => structuredClone(p));

    cur.status = 'graded';
    this.gradeCount++;
    const rows: ResultRow[] = [];
    const seatResults: SeatResult[] = [];
    const honorEntries: HonorEntry[] = [];
    const wrongRequeue: string[] = [];
    const gradedHot = new Set<string>();
    const P = this.rules.pointsCorrect;

    const award = (userId: string) => {
      const sc = this.scoreOf(userId);
      sc.sessionPoints += P;
      sc.roundPoints += P;
      sc.correct += 1;
      const p = this.players.get(userId);
      if (p) {
        p.totalPointsAll += P;
        this.dirtyPlayers.add(userId);
      }
    };

    // 1) Ghế nóng: theo số ghế tăng dần
    s.seats.forEach((t, idx) => {
      if (!t) return;
      const p = this.players.get(t.userId)!;
      const ans = this.answers.get(t.userId);
      const ok = ans?.choice === q.correct;
      const levelBefore = t.level;
      gradedHot.add(t.userId);
      if (ok) {
        t.level += 1;
        award(t.userId);
        const sc = this.scoreOf(t.userId);
        sc.bestLevelSession = Math.max(sc.bestLevelSession, t.level);
        const tags: HonorEntry['tags'] = [];
        if (this.rules.milestones.includes(t.level)) {
          tags.push('milestone');
          if (!p.badges.includes(t.level)) p.badges.push(t.level); // huy hiệu lưu lần đầu đạt
        }
        if (t.recordAtStart > 0 && t.level > t.recordAtStart && !t.recordBrokenAnnounced) {
          tags.push('record');
          t.recordBrokenAnnounced = true;
        }
        if (t.level > p.bestLevelAll) p.bestLevelAll = t.level;
        this.dirtyPlayers.add(p.userId);
        if (tags.length) honorEntries.push({ userId: p.userId, nickname: p.nickname, avatar: p.avatar, level: t.level, template: templateOf(p.userId), tags });
      } else {
        this.vacateSeat(idx, ans ? 'wrong' : 'no_answer');
        if (ans) {
          if (p.autoRequeue) wrongRequeue.push(p.userId); // §5: sai -> cuối hàng nếu bật tự xếp lại
        } else if (p.autoRequeue) {
          p.autoRequeue = false; // §5: không trả lời -> tắt tự xếp lại
          this.dirtyPlayers.add(p.userId);
        }
      }
      seatResults.push({ seat: idx + 1, userId: p.userId, nickname: p.nickname, answered: !!ans, correct: ok, levelAfter: ok ? t.level : levelBefore, stays: ok });
      rows.push({ runId: cur.runId, userId: p.userId, role: 'hot', seat: idx + 1, choice: ans?.choice ?? null, correct: ok, points: ok ? P : 0, levelBefore, levelAfter: ok ? t.level : levelBefore });
    });

    // 2) Mọi người khác có đáp án (khán đài, ghế chờ, đã nhường...): đúng +10, không đổi thứ tự
    let totalCorrect = seatResults.filter((r) => r.correct).length;
    for (const [userId, ans] of this.answers) {
      if (gradedHot.has(userId)) continue;
      const ok = ans.choice === q.correct;
      if (ok) {
        award(userId);
        totalCorrect++;
      }
      rows.push({ runId: cur.runId, userId, role: 'other', seat: null, choice: ans.choice, correct: ok, points: ok ? P : 0, levelBefore: null, levelAfter: null });
    }

    // 3) Người sai có tự xếp lại: thêm cuối hàng theo số ghế tăng dần, sau mọi người đã đăng ký trước lúc chấm
    for (const userId of wrongRequeue) s.queue.push({ ticket: s.nextTicket++, userId });
    this.refillWaitingQueue();

    const result: QuestionResult = {
      runId: cur.runId,
      code: cur.code,
      correct: q.correct,
      explanation: q.explanation,
      seats: seatResults,
      totalAnswers: this.answers.size,
      totalCorrect,
    };
    s.lastResult = result;
    s.honor = this.buildHonor(seatResults, honorEntries);
    s.undo = { runId: cur.runId, code: cur.code, snapshot: undoSnapshot, players: undoPlayers, replay: [] };
    this.setPhase('REVEAL', this.rules.revealMs);
    this.sys(`Chấm câu ${cur.code}: ${this.answers.size} đáp án, ${totalCorrect} đúng; ghế nóng đúng ${seatResults.filter((r) => r.correct).length}/${seatResults.length}`);
    if (!this.emitMcFromCategory('congBoKetQua', {}, { isAux: false, now })) {
      this.say(`Đáp án đúng là ${q.correct}.`, { category: 'congBoKetQua', durationMs: 3200 });
    }
    this.commit(() => {
      this.store.setRunStatus(cur.runId, 'graded', { gradedAt: now });
      this.store.insertResults(rows);
    });
  }

  private buildHonor(seats: SeatResult[], entries: HonorEntry[]): Honor {
    const correctSeats = seats.filter((r) => r.correct).map((r) => r.seat);
    const allFloor = seats.length === this.rules.hotSeats && correctSeats.length === this.rules.hotSeats;
    if (entries.length) return { kind: 'milestone', entries, keepCount: correctSeats.length, allFloor, correctSeats };
    if (correctSeats.length) return { kind: 'keep', entries: [], keepCount: correctSeats.length, allFloor, correctSeats };
    if (seats.length) return { kind: 'fresh', entries: [], keepCount: 0, allFloor: false, correctSeats };
    return { kind: 'none', entries: [], keepCount: 0, allFloor: false, correctSeats };
  }

  private sayHonor() {
    const h = this.state.honor;
    if (!h) return;
    const now = this.now();
    if (h.kind === 'milestone' || h.kind === 'keep') {
      if (!this.emitMcFromCategory('vinhDanh', {}, { isAux: false, now })) {
        if (h.kind === 'milestone') {
          const names = h.entries.slice(0, 3).map((e) => speakableName(e.nickname));
          this.say(`${h.allFloor ? 'Cả sàn giữ ghế! ' : ''}Chúc mừng ${names.join(', ')}${h.entries.length > 3 ? ` và ${h.entries.length - 3} bạn` : ''}!`, {
            category: 'vinhDanh',
            durationMs: 4200,
          });
        } else {
          this.say(h.allFloor ? 'Cả sàn giữ ghế!' : `${h.keepCount} người giữ ghế!`, {
            category: 'vinhDanh',
            durationMs: 3600,
          });
        }
      }
    } else if (h.kind === 'fresh') {
      if (!this.emitMcFromCategory('dongVien', {}, { isAux: false, now })) {
        this.say('Sân đấu đón lượt mới!', { category: 'dongVien', durationMs: 3500 });
      }
    }
  }

  // ======================================================================
  // Quản trị
  // ======================================================================
  private audit(actor: string, action: string, detail: string) {
    this.addLog({ kind: 'admin', message: `[${actor}] ${action}: ${detail}` });
    try {
      this.store.audit(this.now(), actor, action, detail);
    } catch {
      // bỏ qua
    }
  }

  startSession(actor = 'admin'): CommandOutcome {
    const s = this.state;
    if (s.session && s.phase !== 'ENDED') return { accepted: false, reason: 'Đang có phiên chạy' };
    const now = this.now();
    const id = `S${now}`;
    const keepHealth = s.sourceHealthy;
    const preQueue = s.queue;
    const preNextTicket = s.nextTicket;
    this.state = this.initialState();
    this.state.sourceHealthy = keepHealth;
    this.state.queue = preQueue;
    this.state.nextTicket = preNextTicket;
    this.state.session = { id, startedAt: now, round: 1, roundActiveMs: 0, nextCode: 1, endRequested: false };
    this.answers.clear();
    this.mcDirector.resetForNewSession(now);
    // Tự động lấp đầy 10 ghế chờ từ danh sách người chơi hợp lệ mà không cần gõ "chờ"
    this.refillWaitingQueue();
    this.store.tx(() => this.store.insertSession(id, now));
    this.audit(actor, 'Bắt đầu phiên', id);
    this.beginBoundary();
    if (this.state.phase === 'NO_SESSION') this.commit();
    return { accepted: true, reason: `Đã bắt đầu phiên ${id}` };
  }

  endSession(actor = 'admin'): CommandOutcome {
    const s = this.state;
    if (!s.session || s.phase === 'ENDED') return { accepted: false, reason: 'Không có phiên đang chạy' };
    if (['PREPARE', 'OPEN', 'REVEAL', 'HONOR'].includes(s.phase)) {
      s.session.endRequested = true;
      this.audit(actor, 'Yêu cầu kết thúc phiên', 'chốt sau câu đang chơi');
      this.commit();
      return { accepted: true, reason: 'Sẽ kết thúc sau câu đang chơi' };
    }
    this.audit(actor, 'Kết thúc phiên', s.session.id);
    this.finishSession('Kết thúc phiên');
    return { accepted: true, reason: 'Đã kết thúc phiên' };
  }

  private finishSession(why: string) {
    const s = this.state;
    if (!s.session) return;
    s.seats.forEach((_, i) => this.vacateSeat(i, 'session_end'));
    s.queue = [];
    s.invites = [];
    s.inviteWave = 0;
    s.undo = null;
    for (const p of this.players.values()) {
      if (p.autoRequeue) {
        p.autoRequeue = false;
        this.dirtyPlayers.add(p.userId);
      }
    }
    s.session.endRequested = false;
    this.setPhase('ENDED', null);
    this.sys(why + ': giữ điểm lịch sử/kỷ lục/huy hiệu; kết thúc lượt giữ ghế; xóa hàng chờ');
    this.say('Cảm ơn các bạn đã tham gia Ghế Nóng! Hẹn gặp lại!');
    const id = s.session.id;
    this.commit(() => this.store.endSession(id, this.now()));
  }

  private cancelCurrent(note: string) {
    const cur = this.state.current;
    if (!cur || (cur.status !== 'prepare' && cur.status !== 'open')) return false;
    cur.status = 'cancelled';
    this.answers.clear();
    this.store.setRunStatus(cur.runId, 'cancelled', { note });
    this.addLog({ kind: 'system', message: `Hủy câu ${cur.code} (${note}): không chấm, không loại ai, không cộng điểm; giữ ghế và thứ tự` });
    return true;
  }

  private pauseInternal(reason: string, by: string, auto: boolean) {
    const s = this.state;
    const from = s.phase;
    if (from === 'PREPARE' || from === 'OPEN') this.cancelCurrent(reason);
    s.pause = { reason, by, from, at: this.now(), auto };
    this.setPhase('PAUSED', null);
    this.sys(`Tạm dừng: ${reason}`);
    this.commit();
  }

  pause(actor = 'admin', reason = 'Quản trị tạm dừng'): CommandOutcome {
    const s = this.state;
    if (!s.session || ['NO_SESSION', 'ENDED', 'PAUSED'].includes(s.phase)) return { accepted: false, reason: 'Không thể tạm dừng lúc này' };
    this.audit(actor, 'Tạm dừng', reason);
    this.pauseInternal(reason, actor, false);
    return { accepted: true, reason: 'Đã tạm dừng' + (s.current?.status === 'cancelled' ? ' (câu đang mở đã hủy, không tái dùng)' : '') };
  }

  resume(actor = 'admin'): CommandOutcome {
    const s = this.state;
    if (s.phase !== 'PAUSED' || !s.pause) return { accepted: false, reason: 'Game không ở trạng thái tạm dừng' };
    if (!s.sourceHealthy) return { accepted: false, reason: 'Nguồn bình luận chưa kết nối: chưa thể tiếp tục' };
    const from = s.pause.from;
    s.pause = null;
    this.audit(actor, 'Tiếp tục', `từ ${from}`);
    if (from === 'INVITING' && s.invites.length) {
      // §14: tiếp tục bước mời -> cấp lại đủ 12 giây cho lời mời đang mở
      const now = this.now();
      for (const inv of s.invites) inv.expiresAt = now + this.rules.inviteConfirmMs;
      this.setPhase('INVITING', this.rules.inviteConfirmMs);
      this.commit();
    } else {
      this.beginBoundary();
    }
    return { accepted: true, reason: 'Đã tiếp tục' };
  }

  /** Nguồn bình luận báo khỏe / mất (§14) */
  setSourceHealth(healthy: boolean, why = '') {
    const s = this.state;
    if (s.sourceHealthy === healthy) return;
    s.sourceHealthy = healthy;
    this.sys(healthy ? 'Nguồn bình luận đã kết nối' : `Nguồn bình luận mất kết nối${why ? `: ${why}` : ''}`);
    if (!healthy) {
      if (s.phase === 'OPEN' || s.phase === 'PREPARE' || s.phase === 'INVITING') {
        return this.pauseInternal('Mất kết nối nguồn bình luận trong lúc câu/lời mời đang mở', 'system', true);
      }
      // các pha khác: kết quả đã chấm được giữ; beginBoundary sẽ tạm dừng trước câu tiếp
      return this.commit();
    }
    if (s.phase === 'PAUSED' && s.pause?.auto) {
      this.resume('system');
      return;
    }
    this.commit();
  }

  cancelQuestion(actor: string, reason: string): CommandOutcome {
    if (!this.cancelCurrent(`quản trị hủy: ${reason}`)) return { accepted: false, reason: 'Không có câu chưa chấm để hủy (câu đã chấm thì dùng Hoàn tác)' };
    this.audit(actor, 'Hủy câu', reason);
    this.beginBoundary();
    return { accepted: true, reason: 'Đã hủy câu; chuyển câu mới' };
  }

  /** §14: Hoàn tác câu gần nhất — chỉ khi câu kế tiếp chưa bắt đầu */
  undoLast(actor: string, reason: string): CommandOutcome {
    const s = this.state;
    const u = s.undo;
    if (!u) return { accepted: false, reason: 'Không có câu nào đủ điều kiện hoàn tác (câu kế tiếp đã bắt đầu hoặc chưa chấm câu nào)' };
    if (!reason.trim()) return { accepted: false, reason: 'Cần ghi lý do' };
    const keep = { sourceHealthy: s.sourceHealthy, pendingConfig: s.pendingConfig, config: s.config };
    const restored = JSON.parse(u.snapshot) as EngineState;
    this.state = { ...restored, ...keep, undo: null, lastTickAt: this.now() };
    for (const p of u.players) {
      this.players.set(p.userId, structuredClone(p));
      this.dirtyPlayers.add(p.userId);
    }
    const st = this.state;
    if (st.current) st.current.status = 'cancelled';
    st.invites = [];
    st.inviteWave = 0;
    st.lastResult = null;
    st.honor = null;
    st.departed = st.departed.map(() => null);
    this.answers.clear();
    st.pause = { reason: `Đã hoàn tác câu ${u.code}: ${reason}`, by: actor, from: 'TRANSITION', at: this.now(), auto: false };
    this.setPhase('PAUSED', null);
    this.audit(actor, `Hoàn tác câu ${u.code}`, reason);
    // phát lại đăng ký/hủy thủ công phát sinh sau thời điểm chụp
    for (const ev of u.replay) this.handleInbound(ev, { replay: true });
    this.commit(() => {
      this.store.setRunStatus(u.runId, 'undone', { note: `${actor}: ${reason}` });
      this.store.markResultsUndone(u.runId);
    });
    return { accepted: true, reason: `Đã hoàn tác câu ${u.code}; phát lại ${u.replay.length} đăng ký/hủy. Bấm Tiếp tục để chơi câu mới` };
  }

  kickFromSeat(actor: string, userId: string, reason: string): CommandOutcome {
    const idx = this.seatOf(userId);
    if (idx < 0) return { accepted: false, reason: 'Người này không ở ghế nóng' };
    if (!reason.trim()) return { accepted: false, reason: 'Cần ghi lý do' };
    this.vacateSeat(idx, 'kick');
    const p = this.players.get(userId);
    if (p?.autoRequeue) {
      p.autoRequeue = false;
      this.dirtyPlayers.add(userId);
    }
    this.audit(actor, 'Cho rời ghế', `${this.nameOf(userId)} (${userId}) ghế ${idx + 1}: ${reason}`);
    this.commit();
    return { accepted: true, reason: `Đã cho rời ghế ${idx + 1}; ghế bổ sung ở lần chuyển câu tới` };
  }

  setLocked(actor: string, userId: string, locked: boolean, reason: string): CommandOutcome {
    const p = this.players.get(userId);
    if (!p) return { accepted: false, reason: 'Không tìm thấy người chơi' };
    if (!reason.trim()) return { accepted: false, reason: 'Cần ghi lý do' };
    p.locked = locked;
    p.lockReason = locked ? reason : undefined;
    p.autoRequeue = false;
    this.dirtyPlayers.add(userId);
    if (locked) {
      const idx = this.seatOf(userId);
      if (idx >= 0) this.vacateSeat(idx, 'locked');
      this.state.queue = this.state.queue.filter((q) => q.userId !== userId);
      this.state.invites = this.state.invites.filter((i) => i.userId !== userId);
    }
    this.audit(actor, locked ? 'Tạm khóa' : 'Mở khóa', `${p.nickname} (${userId}): ${reason}`);
    if (locked && this.state.phase === 'INVITING' && this.state.invites.length === 0) this.endWave();
    else this.commit();
    return { accepted: true, reason: locked ? 'Đã tạm khóa' : 'Đã mở khóa' };
  }

  /** §15: chỉnh thông số cho câu/hiệp tiếp theo; lưu lịch sử cấu hình */
  setRules(actor: string, patch: Partial<RuleConfig>): CommandOutcome {
    const allowed: (keyof RuleConfig)[] = ['inviteConfirmMs', 'prepareMs', 'openMs', 'revealMs', 'honorMs', 'transitionMs', 'idleStandbyMs', 'roundActiveMs', 'roundBoardMs', 'infoCooldownMs'];
    const next = { ...(this.state.pendingConfig ?? this.state.config) };
    for (const k of allowed) {
      const v = (patch as Record<string, unknown>)[k];
      if (v === undefined) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 500 || n > 4 * 3600_000) return { accepted: false, reason: `Giá trị ${k} không hợp lệ` };
      (next as unknown as Record<string, number>)[k] = Math.round(n);
    }
    this.state.pendingConfig = next;
    this.store.saveConfigHistory(this.now(), actor, next);
    this.audit(actor, 'Đổi thông số', `${JSON.stringify(patch)} (áp dụng từ câu tiếp theo; luật v${RULES_VERSION} cần nâng phiên bản nếu giữ lâu dài)`);
    this.commit();
    return { accepted: true, reason: 'Đã lưu; áp dụng từ câu tiếp theo' };
  }

  setDisplay(actor: string, patch: Partial<DisplayConfig>): CommandOutcome {
    const d = { ...this.display };
    for (const k of ['safeTop', 'safeBottom', 'safeLeft', 'safeRight'] as const) {
      if (patch[k] !== undefined) d[k] = Math.max(0, Math.min(400, Math.round(Number(patch[k]) || 0)));
    }
    if (typeof patch.ttsEnabled === 'boolean') d.ttsEnabled = patch.ttsEnabled;
    if (typeof patch.sfxEnabled === 'boolean') d.sfxEnabled = patch.sfxEnabled;
    if (typeof patch.reduceMotion === 'boolean') d.reduceMotion = patch.reduceMotion;
    this.display = d;
    this.store.setMeta('display', JSON.stringify(d));
    this.audit(actor, 'Đổi hiển thị', JSON.stringify(patch));
    this.changed();
    return { accepted: true, reason: 'Đã lưu hiển thị' };
  }

  upsertQuestion(actor: string, q: Question): CommandOutcome {
    const err = validateQuestion(q);
    if (err) return { accepted: false, reason: err };
    const clean: Question = {
      id: q.id.trim().slice(0, 60),
      text: q.text.trim(),
      choices: q.choices.map((c) => String(c).trim()) as Question['choices'],
      correct: q.correct,
      explanation: q.explanation.trim(),
      topic: q.topic.trim(),
      difficulty: q.difficulty,
      source: q.source?.trim() || undefined,
      status: q.status === 'approved' || q.status === 'disabled' ? q.status : 'draft',
    };
    this.store.upsertQuestion(clean);
    const i = this.questions.findIndex((x) => x.id === clean.id);
    if (i >= 0) this.questions[i] = clean;
    else this.questions.push(clean);
    this.audit(actor, 'Lưu câu hỏi', `${clean.id} (${clean.status})`);
    this.changed();
    return { accepted: true, reason: 'Đã lưu câu hỏi' };
  }

  setQuestionStatus(actor: string, id: string, status: Question['status']): CommandOutcome {
    const q = this.questions.find((x) => x.id === id);
    if (!q) return { accepted: false, reason: 'Không tìm thấy câu' };
    if (this.state.current?.questionId === id && ['prepare', 'open'].includes(this.state.current.status) && status !== 'approved') {
      return { accepted: false, reason: 'Câu đang chạy: hãy dùng "Hủy câu" trước' };
    }
    q.status = status;
    this.store.upsertQuestion(q);
    this.audit(actor, 'Đổi trạng thái câu', `${id} -> ${status}`);
    if (status === 'approved' && this.state.phase === 'NO_QUESTIONS') this.state.noQuestionsWarning = false;
    this.changed();
    return { accepted: true, reason: 'Đã cập nhật' };
  }

  remainingQuestions() {
    const used = new Set(this.state.usedQuestionIds);
    return this.questions.filter((q) => q.status === 'approved' && !used.has(q.id)).length;
  }

  // ======================================================================
  // Khôi phục sau khởi động lại (§14)
  // ======================================================================
  private recover() {
    const s = this.state;
    const now = this.now();
    s.lastTickAt = now;
    s.sourceHealthy = false; // chờ nguồn bình luận báo khỏe lại
    if (!s.session || s.phase === 'ENDED' || s.phase === 'NO_SESSION') {
      this.commit();
      return;
    }
    const cur = s.current;
    if (cur && (cur.status === 'prepare' || cur.status === 'open')) {
      // câu chưa chấm: hủy, giữ trạng thái trước câu, mở câu mới khi nguồn khỏe
      const dbStatus = this.store.getRunStatus(cur.runId);
      if (dbStatus === 'graded') {
        // không thể xảy ra vì ghi cùng giao dịch, nhưng nếu có thì không chấm lại
        cur.status = 'graded';
      } else {
        this.cancelCurrent('máy chủ khởi động lại lúc câu chưa chấm');
      }
      s.pause = { reason: 'Máy chủ khởi động lại: đã hủy câu chưa chấm, sẽ mở câu mới khi nguồn bình luận khỏe', by: 'system', from: s.phase, at: now, auto: true };
      this.setPhase('PAUSED', null);
    } else if (s.phase === 'INVITING') {
      s.pause = { reason: 'Máy chủ khởi động lại giữa bước mời: giữ chỗ dành, cấp lại đủ thời gian khi tiếp tục', by: 'system', from: 'INVITING', at: now, auto: true };
      this.setPhase('PAUSED', null);
    } else if (s.phase === 'REVEAL' || s.phase === 'HONOR' || s.phase === 'TRANSITION' || s.phase === 'ROUND_BOARD') {
      // đã chấm: không chấm lại; tiếp tục bước chuyển ghế còn dở khi nguồn khỏe
      s.pause = { reason: 'Máy chủ khởi động lại sau khi đã chấm: giữ kết quả, tiếp tục chuyển ghế', by: 'system', from: s.phase, at: now, auto: true };
      this.setPhase('PAUSED', null);
    }
    this.sys('Khôi phục phiên sau khởi động lại (tiếp tục phiên cũ, không mở phiên mới)');
    this.commit();
  }

  // ======================================================================
  // Khán đài: luân phiên ở ranh giới câu (§11)
  // ======================================================================
  rotateAudience() {
    const s = this.state;
    const now = this.now();
    const busy = new Set<string>([
      ...s.seats.filter(Boolean).map((t) => t!.userId),
      ...s.invites.map((i) => i.userId),
      ...s.queue.slice(0, this.rules.waitingSeats).map((q) => q.userId),
    ]);
    const active = [...this.players.values()]
      .filter((p) => !busy.has(p.userId) && !p.locked && now - p.lastActiveAt < AUDIENCE_ACTIVE_MS)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    const max = this.rules.audienceRenderMax;
    if (active.length <= max) {
      s.audienceShown = active.map((p) => p.userId);
      return;
    }
    // giữ một nửa người đang hiện, thay nửa còn lại bằng người hoạt động chưa được hiện
    const keep = s.audienceShown.filter((id) => active.some((p) => p.userId === id)).slice(0, Math.floor(max / 2));
    const fresh = active.filter((p) => !keep.includes(p.userId)).map((p) => p.userId);
    s.audienceShown = [...keep, ...fresh].slice(0, max);
  }

  // ======================================================================
  // Dữ liệu cho giao diện
  // ======================================================================
  private playerCard(userId: string) {
    const p = this.players.get(userId);
    const name = p?.nickname ?? 'Người chơi';
    return { userId, name: shortName(name), avatar: p?.avatar ?? '', template: templateOf(userId) };
  }

  /** Dữ liệu CÔNG KHAI cho sân khấu: KHÔNG chứa đáp án đúng trước khi chốt câu */
  publicView() {
    const s = this.state;
    const now = this.now();
    const cur = s.current;
    const q = cur ? this.questionById(cur.questionId) : undefined;
    const graded = cur?.status === 'graded' && (s.phase === 'REVEAL' || s.phase === 'HONOR');
    let question: null | { code: number; topic: string; text?: string; choices?: string[]; difficulty?: string } = null;
    if (cur && q && cur.status !== 'cancelled') {
      if (s.phase === 'PREPARE') question = { code: cur.code, topic: q.topic };
      else if (s.phase === 'OPEN' || graded) question = { code: cur.code, topic: q.topic, text: q.text, choices: [...q.choices], difficulty: q.difficulty };
    }
    const seatResultOf = (seat: number) => (graded ? s.lastResult?.seats.find((r) => r.seat === seat) : undefined);
    const seats = s.seats.map((t, i) => {
      const seat = i + 1;
      const res = seatResultOf(seat);
      const dep = s.departed[i];
      const inv = s.invites.find((x) => x.seat === seat);
      return {
        seat,
        occupant: t
          ? {
              ...this.playerCard(t.userId),
              level: t.level,
              title: rankTitle(t.level),
              points: s.scores[t.userId]?.sessionPoints ?? 0,
              answered: s.phase === 'OPEN' ? this.answers.has(t.userId) : undefined,
              result: res ? (res.correct ? 'correct' : res.answered ? 'wrong' : 'none') : undefined,
            }
          : null,
        departed: dep ? { ...this.playerCard(dep.userId), reason: dep.reason, result: res ? (res.answered ? 'wrong' : 'none') : undefined } : null,
        invite: inv ? { ...this.playerCard(inv.userId), expiresAt: inv.expiresAt } : null,
      };
    });
    const waiting = s.queue.slice(0, this.rules.waitingSeats).map((qq, i) => ({ pos: i + 1, ...this.playerCard(qq.userId) }));
    const audience = s.audienceShown.slice(0, this.rules.audienceRenderMax).map((id) => this.playerCard(id));
    const activeCount = [...this.players.values()].filter((p) => now - p.lastActiveAt < AUDIENCE_ACTIVE_MS).length;
    return {
      serverNow: now,
      rulesVersion: RULES_VERSION,
      phase: s.phase,
      phaseStartedAt: s.phaseStartedAt,
      phaseEndsAt: s.phaseEndsAt,
      session: s.session ? { round: s.session.round, nextCode: s.session.nextCode, endRequested: s.session.endRequested } : null,
      pauseReason: s.phase === 'PAUSED' ? 'Tạm dừng một chút' : null,
      question,
      reveal: graded && s.lastResult ? { correct: s.lastResult.correct, explanation: s.lastResult.explanation, totalAnswers: s.lastResult.totalAnswers, totalCorrect: s.lastResult.totalCorrect } : null,
      answeredCount: s.phase === 'OPEN' ? this.answers.size : null,
      seats,
      waiting,
      registeredMore: Math.max(0, s.queue.length - this.rules.waitingSeats),
      audience,
      audienceTotal: activeCount,
      leaderboard: this.ranking('sessionPoints', this.rules.leaderboardTop),
      honor: s.phase === 'HONOR' ? s.honor : null,
      roundBoard: s.phase === 'ROUND_BOARD' ? s.roundBoard : null,
      finalBoard: s.phase === 'ENDED' ? this.ranking('sessionPoints', 10) : null,
      notices: this.notices.filter((n) => n.until > now).map((n) => ({ id: n.id, text: n.text, kind: n.kind })),
      mc: this.mc && now - this.mc.at < 8_000 ? this.mc : null,
      stageGuide: buildStageGuide({
        phase: s.phase,
        code: cur?.code ?? null,
        nextCode: s.session?.nextCode ?? 1,
        invites: s.invites.map((i) => ({
          name: shortName(this.nameOf(i.userId)),
          seat: i.seat,
          expiresAt: i.expiresAt,
        })),
        rules: this.rules,
        hasRecentNewcomer: now - this.lastNewcomerAt < 8_000,
      }),
      display: this.display,
      shortRules: SHORT_RULES,
      timings: { openMs: this.rules.openMs, inviteConfirmMs: this.rules.inviteConfirmMs },
    };
  }

  /** Dữ liệu đầy đủ cho bảng điều khiển (chỉ trên máy cục bộ, có xác thực) */
  adminView() {
    const s = this.state;
    const cur = s.current;
    const q = cur ? this.questionById(cur.questionId) : undefined;
    const players = [...this.players.values()]
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .slice(0, 300)
      .map((p) => ({
        userId: p.userId,
        nickname: p.nickname,
        status: this.statusOf(p.userId),
        autoRequeue: p.autoRequeue,
        locked: p.locked,
        lockReason: p.lockReason,
        bestLevelAll: p.bestLevelAll,
        badges: p.badges,
        totalPointsAll: p.totalPointsAll,
        session: s.scores[p.userId] ?? null,
        seat: this.seatOf(p.userId) + 1 || null,
        level: s.seats.find((t) => t?.userId === p.userId)?.level ?? null,
      }));
    return {
      public: this.publicView(),
      state: {
        phase: s.phase,
        phaseEndsAt: s.phaseEndsAt,
        session: s.session,
        pause: s.pause,
        sourceHealthy: s.sourceHealthy,
        config: s.config,
        pendingConfig: s.pendingConfig,
        canUndo: s.undo ? { code: s.undo.code, replay: s.undo.replay.length } : null,
        noQuestionsWarning: s.noQuestionsWarning,
        inviteWave: s.inviteWave,
      },
      current: cur
        ? { ...cur, question: q, answers: [...this.answers].map(([userId, a]) => ({ userId, nickname: this.nameOf(userId), choice: a.choice, at: a.at })) }
        : null,
      seats: s.seats.map((t, i) => (t ? { seat: i + 1, userId: t.userId, nickname: this.nameOf(t.userId), level: t.level, recordAtStart: t.recordAtStart } : { seat: i + 1 })),
      queue: s.queue.map((e, i) => ({ pos: i + 1, ticket: e.ticket, userId: e.userId, nickname: this.nameOf(e.userId), visible: i < s.config.waitingSeats })),
      invites: s.invites.map((i) => ({ ...i, nickname: this.nameOf(i.userId) })),
      players,
      playerCount: this.players.size,
      questions: this.questions,
      remainingQuestions: this.remainingQuestions(),
      lastResult: s.lastResult,
      log: this.log.slice(-300),
      display: this.display,
      gradeCount: this.gradeCount,
    };
  }
}
