/** Kiểu dữ liệu dùng chung của lõi luật. Không phụ thuộc React, Express hay TikTok. */
import type { RuleConfig } from './rules';

export type Choice = 'A' | 'B' | 'C' | 'D';

export type Phase =
  | 'NO_SESSION' // chưa bắt đầu phiên
  | 'STANDBY' // §4: màn hình chờ (không ghế nóng, 120s không tương tác)
  | 'PAUSED' // §14
  | 'TRANSITION' // §6: CHUYỂN GHẾ 4 giây
  | 'INVITING' // §4: đợt mời, 12 giây xác nhận
  | 'PREPARE' // §6: CHUẨN BỊ 5 giây
  | 'OPEN' // §6: MỞ ĐÁP ÁN 30 giây
  | 'REVEAL' // §6: CÔNG BỐ 5 giây
  | 'HONOR' // §6: VINH DANH 3 giây
  | 'ROUND_BOARD' // §9: chốt bảng hiệp 8 giây
  | 'NO_QUESTIONS' // §12: hết câu hợp lệ -> màn hình nghỉ
  | 'ENDED'; // §9: kết thúc phiên

export type Difficulty = 'de' | 'vua' | 'kho';

export interface Question {
  id: string;
  text: string;
  choices: [string, string, string, string];
  correct: Choice;
  explanation: string;
  topic: string;
  difficulty: Difficulty;
  source?: string;
  status: 'draft' | 'approved' | 'disabled';
}

export interface Player {
  userId: string;
  nickname: string;
  avatar: string;
  createdAt: number;
  /** §3: bật khi gửi "chờ"; tắt khi hủy / không xác nhận / không trả lời / nhường */
  autoRequeue: boolean;
  locked: boolean;
  lockReason?: string;
  /** §8: kỷ lục cấp mọi phiên */
  bestLevelAll: number;
  /** §8: huy hiệu mốc đã đạt lần đầu */
  badges: number[];
  /** tổng điểm mọi phiên (lịch sử) */
  totalPointsAll: number;
  lastActiveAt: number;
}

export interface Tenure {
  tenureId: string;
  userId: string;
  seat: number; // 1..5
  level: number;
  startedAt: number;
  /** kỷ lục mọi phiên lúc bắt đầu lượt — dùng cho vinh danh phá kỷ lục (§10) */
  recordAtStart: number;
  recordBrokenAnnounced: boolean;
}

export interface Departed {
  userId: string;
  nickname: string;
  reason: 'wrong' | 'no_answer' | 'yield' | 'kick' | 'locked' | 'session_end';
}

export interface Invite {
  seat: number;
  userId: string;
  expiresAt: number;
  wave: number;
}

export interface QueueEntry {
  ticket: number;
  userId: string;
}

export interface SessionScore {
  sessionPoints: number;
  roundPoints: number;
  correct: number;
  bestLevelSession: number;
}

export interface CurrentQuestion {
  runId: string;
  questionId: string;
  code: number;
  status: 'prepare' | 'open' | 'graded' | 'cancelled';
  openedAt: number | null;
  closesAt: number | null;
  /** §6 CHUẨN BỊ: chốt danh sách người đang ghế nóng */
  seatHolders: { seat: number; userId: string }[];
}

export interface SeatResult {
  seat: number;
  userId: string;
  nickname: string;
  answered: boolean;
  correct: boolean;
  levelAfter: number;
  stays: boolean;
}

export interface QuestionResult {
  runId: string;
  code: number;
  correct: Choice;
  explanation: string;
  seats: SeatResult[];
  totalAnswers: number;
  totalCorrect: number;
}

export interface HonorEntry {
  userId: string;
  nickname: string;
  avatar: string;
  level: number;
  template: number;
  tags: ('milestone' | 'record')[];
}

export interface Honor {
  kind: 'milestone' | 'keep' | 'fresh' | 'none';
  entries: HonorEntry[];
  keepCount: number;
  allFloor: boolean;
  correctSeats: number[];
}

export interface RoundBoardRow {
  rank: number;
  userId: string;
  nickname: string;
  points: number;
}

export interface UndoInfo {
  runId: string;
  code: number;
  /** JSON trạng thái engine ngay trước khi chấm */
  snapshot: string;
  /** hồ sơ người chơi bị ảnh hưởng, trước khi chấm */
  players: Player[];
  /** đăng ký/hủy thủ công sau khi chấm, phát lại khi hoàn tác (§14) */
  replay: InboundEvent[];
}

export interface EngineState {
  version: 1;
  session: {
    id: string;
    startedAt: number;
    round: number;
    roundActiveMs: number;
    nextCode: number;
    endRequested: boolean;
  } | null;
  phase: Phase;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  pause: { reason: string; by: string; from: Phase; at: number; auto: boolean } | null;
  pauseBeforeNext: string | null;
  seats: (Tenure | null)[];
  departed: (Departed | null)[];
  queue: QueueEntry[];
  nextTicket: number;
  invites: Invite[];
  inviteWave: number;
  current: CurrentQuestion | null;
  lastResult: QuestionResult | null;
  honor: Honor | null;
  scores: Record<string, SessionScore>;
  usedQuestionIds: string[];
  plan: Difficulty[];
  recentTopics: string[];
  lastHard: boolean;
  lastInteractionAt: number;
  config: RuleConfig;
  pendingConfig: RuleConfig | null;
  undo: UndoInfo | null;
  audienceShown: string[];
  roundBoard: RoundBoardRow[] | null;
  lastTickAt: number;
  sourceHealthy: boolean;
  noQuestionsWarning: boolean;
}

/** Sự kiện vào đã chuẩn hóa — mọi nguồn (giả lập, TikTok) đều đổi về dạng này */
export interface InboundEvent {
  source: 'sim' | 'tiktok';
  /** định danh sự kiện để chống xử lý lại (msgId TikTok hoặc id do bộ giả lập sinh) */
  eventId: string;
  type: 'chat' | 'gift' | 'like';
  /** định danh tài khoản ổn định (TikTok userId). Thiếu -> không ghi điểm/ghế */
  userId?: string;
  nickname?: string;
  avatar?: string;
  text?: string;
  gift?: { name: string; count: number; diamonds: number };
  /** giờ máy chủ nhận (ms) — gán bởi máy chủ, không lấy từ máy người xem (§4, §7) */
  receivedAt: number;
}

export interface CommandOutcome {
  accepted: boolean;
  reason: string;
  command?: string;
}

export interface LogEntry {
  id: number;
  at: number;
  kind: 'command' | 'system' | 'admin' | 'error';
  userId?: string;
  nickname?: string;
  text?: string;
  accepted?: boolean;
  message: string;
}

export interface Notice {
  id: number;
  text: string;
  kind: 'info' | 'gift' | 'system';
  until: number;
}
