import React, { useEffect, useRef, useState } from 'react';
import {
  AudienceSeatUnit25D,
  Character25D,
  HotSeatUnit25D,
  MC_WHITE_POSES,
  McWhiteHost25D,
  WaitingSeatUnit25D,
  type CharacterPose,
  type HotSeatVisualState,
  type McPoseCode,
} from './Character25D';
import { stageSfx, stageVoice } from './sound';

export const STAGE_W = 720;
export const STAGE_H = 1280;

export interface StageState {
  serverNow: number;
  rulesVersion: string;
  phase: string;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  session: { round: number; nextCode: number; endRequested: boolean } | null;
  pauseReason: string | null;
  question: { code: number; topic: string; text?: string; choices?: string[]; difficulty?: string } | null;
  reveal: { correct: 'A' | 'B' | 'C' | 'D'; explanation: string; totalAnswers: number; totalCorrect: number } | null;
  answeredCount: number | null;
  seats: {
    seat: number;
    occupant: {
      userId: string;
      name: string;
      avatar: string;
      template: number;
      level: number;
      title: string;
      points?: number;
      answered?: boolean;
      result?: 'correct' | 'wrong' | 'none';
    } | null;
    departed: {
      userId: string;
      name: string;
      template: number;
      reason: string;
      result?: 'wrong' | 'none';
    } | null;
    invite: {
      userId: string;
      name: string;
      template: number;
      expiresAt: number;
    } | null;
  }[];
  waiting: { pos: number; userId: string; name: string; template: number }[];
  registeredMore: number;
  audience: { userId: string; name: string; template: number }[];
  audienceTotal: number;
  leaderboard: { rank: number; userId: string; nickname: string; points: number }[];
  honor: {
    kind: 'milestone' | 'keep' | 'fresh' | 'none';
    entries: { userId: string; nickname: string; level: number; template: number; tags: ('milestone' | 'record')[] }[];
    keepCount: number;
    allFloor: boolean;
    correctSeats: number[];
  } | null;
  roundBoard: { rank: number; userId: string; nickname: string; points: number }[] | null;
  finalBoard: { rank: number; userId: string; nickname: string; points: number }[] | null;
  notices: { id: number; text: string; kind: 'info' | 'gift' | 'system' }[];
  mc: { id: number; text: string; at: number } | null;
  display: {
    safeTop: number;
    safeBottom: number;
    safeLeft: number;
    safeRight: number;
    ttsEnabled: boolean;
    sfxEnabled?: boolean;
    reduceMotion?: boolean;
  };
  shortRules: string;
  timings: { openMs: number; inviteConfirmMs: number };
  speakerId?: string | null;
  stageCount?: number;
}

const PHASE_LABELS: Record<string, string> = {
  NO_SESSION: 'CHỜ MỞ PHIÊN',
  STANDBY: 'SÂN KHẤU CHỜ',
  PAUSED: 'TẠM DỪNG',
  TRANSITION: 'ĐỔI GHẾ NÓNG',
  INVITING: 'ĐANG MỜI LÊN GHẾ (12S)',
  PREPARE: 'CHUẨN BỊ CÂU HỎI',
  OPEN: 'ĐANG NHẬN ĐÁP ÁN',
  REVEAL: 'CÔNG BỐ ĐÁP ÁN',
  HONOR: 'VINH DANH GHẾ NÓNG',
  ROUND_BOARD: 'TỔNG KẾT VÒNG',
  NO_QUESTIONS: 'NGHỈ GIỮA GIỜ',
  ENDED: 'KẾT THÚC PHIÊN',
};

/** Hướng dẫn chơi ngắn gọn, tự động thay đổi theo trạng thái hiện tại */
function getDynamicGuide(data: StageState): { badge: string; text: string } {
  const code = data.question?.code ?? 1;
  switch (data.phase) {
    case 'OPEN':
      return {
        badge: 'CÚ PHÁP TRẢ LỜI',
        text: `Bình luận ${code}A · ${code}B · ${code}C · ${code}D (Đúng +10đ & +1 cấp)`,
      };
    case 'PREPARE':
      return {
        badge: 'CHUẨN BỊ',
        text: `Sắp mở Câu #${code} — Sẵn sàng gõ ${code}A / ${code}B / ${code}C / ${code}D`,
      };
    case 'INVITING':
      return {
        badge: 'LÊN GHẾ NÓNG',
        text: 'Ghế Chờ tự động vào Ghế Nóng sau 12s · Gõ HỦY nếu nhường',
      };
    case 'REVEAL':
    case 'HONOR':
      return {
        badge: 'LUẬT GHẾ NÓNG',
        text: 'Đúng: Giữ ghế +10đ & tăng cấp · Sai/Hết giờ: Nhường ghế',
      };
    default:
      return {
        badge: 'HƯỚNG DẪN NHANH',
        text: 'Tự động vào 10 Ghế Chờ & 5 Ghế Nóng · Gõ ĐIỂM / VỊ TRÍ',
      };
  }
}

/** Khung co giãn đúng tỉ lệ 720 × 1280 (9:16), rõ nét cả ở 360 × 640 */
export function StageFrame({
  children,
  maxWidth,
  maxHeight,
}: {
  children: React.ReactNode;
  maxWidth?: number;
  maxHeight?: number;
}) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () => {
      const w = Math.min(window.innerWidth, maxWidth ?? window.innerWidth);
      const h = Math.min(window.innerHeight, maxHeight ?? window.innerHeight);
      setScale(Math.min(w / STAGE_W, h / STAGE_H));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [maxWidth, maxHeight]);

  return (
    <div
      style={{
        width: Math.round(STAGE_W * scale),
        height: Math.round(STAGE_H * scale),
        position: 'relative',
        overflow: 'hidden',
        borderRadius: maxWidth ? 16 : 0,
        boxShadow: '0 20px 50px rgba(0,0,0,0.75)',
      }}
    >
      <div
        style={{
          width: STAGE_W,
          height: STAGE_H,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * 30 vị trí ghế cụ thể trên khán đài hình chữ U bao quanh sân khấu:
 * - Cánh trái chữ U: 8 ghế (2 cột × 4 hàng)
 * - Cánh phải chữ U: 8 ghế (2 cột × 4 hàng)
 * - Đáy vòng cung chữ U: 14 ghế (2 hàng × 7 ghế uốn cong theo đáy chữ U)
 * Tổng cộng đúng 30 ghế khán giả hiển thị rõ ràng; người vượt quá 30 vẫn được máy chủ xử lý và chờ chỗ trống để lấp vào.
 */
const U_STAND_SLOTS: { x: number; y: number }[] = (() => {
  const slots: { x: number; y: number }[] = [];
  // 8 ghế cánh trái chữ U (x = 22 và 54, tách biệt hoàn toàn với khu 10 ghế chờ)
  for (let i = 0; i < 8; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    slots.push({ x: 22 + col * 32, y: 786 + row * 56 });
  }
  // 8 ghế cánh phải chữ U (x = 666 và 698, đối xứng hoàn hảo với cánh trái)
  for (let i = 0; i < 8; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    slots.push({ x: 666 + col * 32, y: 786 + row * 56 });
  }
  // 14 ghế vòng cung đáy chữ U (2 hàng × 7 ghế)
  for (let i = 0; i < 14; i++) {
    const col = i % 7;
    const row = Math.floor(i / 7);
    const norm = (col - 3) / 3; // -1 .. +1
    const curveY = Math.round((1 - norm * norm) * 18);
    slots.push({ x: 114 + col * 82, y: 1008 + row * 52 + curveY });
  }
  return slots;
})();

const HOT_SEAT_CENTERS_X = [88, 224, 360, 496, 632];

/**
 * Điều khiển 8 tư thế MC áo trắng dựa trên trạng thái và sự kiện thực tế của game:
 * - 01: đứng tự nhiên khi chờ
 * - 02: chào mở vòng hoặc đón người lên ghế
 * - 03: đọc câu hỏi khi âm thanh đọc đề đang phát
 * - 04: giới thiệu các lựa chọn
 * - 05: suy nghĩ trong thời gian chờ trả lời
 * - 06: nhắc còn 5 giây (ưu tiên cao hơn động tác chờ/suy nghĩ/đọc đề/giới thiệu trong pha OPEN)
 * - 07: ăn mừng khi vinh danh (ưu tiên cao hơn động tác thường)
 * - 08: động viên sau khi có người bị loại
 * Các hành động ngắn kết thúc thì trở về trạng thái phù hợp. Tải lại trang không phát lại lời chào hoặc vinh danh cũ.
 */
export function resolveMcPose(params: {
  data: StageState;
  remainSec: number | null;
  mcSpeaking: boolean;
  elapsedPhaseMs: number;
  sinceQuestionSpeechEndMs: number | null;
  isWelcomePulse: boolean;
  isReloadedOldPhase: boolean;
}): McPoseCode {
  const {
    data,
    remainSec,
    mcSpeaking,
    elapsedPhaseMs,
    sinceQuestionSpeechEndMs,
    isWelcomePulse,
    isReloadedOldPhase,
  } = params;

  const hasEliminated = data.seats.some(
    (s) => s.departed !== null || s.occupant?.result === 'wrong' || s.occupant?.result === 'none',
  );
  const hasHonored = Boolean(
    data.honor &&
      (data.honor.kind === 'milestone' || data.honor.kind === 'keep' || data.honor.correctSeats.length > 0),
  );
  const hasCorrectSeat = data.seats.some((s) => s.occupant?.result === 'correct');

  // 1. Ưu tiên cao nhất trong pha OPEN: Nhắc còn 5 giây (06) > mọi động tác chờ/đọc/giới thiệu/suy nghĩ
  if (data.phase === 'OPEN' && remainSec !== null && remainSec <= 5) {
    return '06';
  }

  // 2. Pha VINH DANH (HONOR) hoặc BẢNG TỔNG KẾT VÒNG (ROUND_BOARD):
  //    Ưu tiên ăn mừng vinh danh (07) hơn động tác thường; nếu tải lại sân khấu ở pha vinh danh cũ thì về 01
  if (data.phase === 'HONOR') {
    if (isReloadedOldPhase) return '01';
    if (hasHonored) return '07';
    if ((data.honor?.kind === 'fresh' || hasEliminated) && elapsedPhaseMs < 2600) return '08';
    return '01';
  }

  if (data.phase === 'ROUND_BOARD') {
    if (!isReloadedOldPhase && elapsedPhaseMs < 3000) return '07';
    return '01';
  }

  // 3. Pha CÔNG BỐ ĐÁP ÁN (REVEAL) & CHUYỂN CÂU (TRANSITION):
  //    Nếu có người bị loại -> động viên (08) trong nhịp ngắn rồi về đứng tự nhiên (01)
  if (data.phase === 'REVEAL') {
    if (isReloadedOldPhase) return '01';
    if (hasEliminated) {
      return elapsedPhaseMs < 3200 ? '08' : '01';
    }
    if (hasCorrectSeat && elapsedPhaseMs < 2600) {
      return '07';
    }
    return elapsedPhaseMs < 2200 ? '04' : '01';
  }

  if (data.phase === 'TRANSITION') {
    if (!isReloadedOldPhase && hasEliminated && elapsedPhaseMs < 2200) {
      return '08';
    }
    if (!isReloadedOldPhase && isWelcomePulse) {
      return '02';
    }
    return '01';
  }

  // 4. Pha CHUẨN BỊ CÂU HỎI (PREPARE):
  //    Khi âm thanh đọc đề đang phát (hoặc nhịp đầu đọc mã câu/chủ đề) -> 03; sau đó giới thiệu ngắn (04) hoặc đứng chờ (01)
  if (data.phase === 'PREPARE') {
    if (mcSpeaking) return '03';
    if (!isReloadedOldPhase && elapsedPhaseMs < 1800) return '03';
    if (!isReloadedOldPhase && elapsedPhaseMs < 3400) return '04';
    return '01';
  }

  // 5. Pha MỞ CÂU HỎI NHẬN ĐÁP ÁN (OPEN, khi thời gian còn > 5 giây):
  //    - 03: Đọc câu hỏi khi âm thanh đọc đề đang phát (hoặc 2.0s đầu mở đề khi tắt tiếng)
  //    - 04: Giới thiệu 4 lựa chọn ngay sau khi đọc câu hỏi (~2.4s)
  //    - 05: Suy nghĩ trong thời gian chờ người chơi trả lời
  if (data.phase === 'OPEN') {
    if (mcSpeaking) return '03';
    if (sinceQuestionSpeechEndMs !== null && sinceQuestionSpeechEndMs < 2400) {
      return '04';
    }
    if (!isReloadedOldPhase && sinceQuestionSpeechEndMs === null) {
      if (elapsedPhaseMs < 2000) return '03';
      if (elapsedPhaseMs < 4400) return '04';
    }
    return '05';
  }

  // 6. Pha ĐÓN NGƯỜI LÊN GHẾ (INVITING) hoặc mới mở vòng / đón người vừa ngồi vào ghế nóng:
  //    - 02: Chào mở vòng hoặc đón người lên ghế (hành động ngắn ~3.6s rồi trở về 01; không phát lại khi F5)
  if (data.phase === 'INVITING') {
    if (isReloadedOldPhase) return '01';
    if (elapsedPhaseMs < 3600 || isWelcomePulse) return '02';
    return '01';
  }

  if (!isReloadedOldPhase && isWelcomePulse) {
    return '02';
  }

  // 7. Mặc định khi chờ (NO_SESSION, STANDBY, PAUSED, NO_QUESTIONS, ENDED): 01 đứng tự nhiên
  return '01';
}

export function StageCanvas({
  data,
  myStageId,
  mute = false,
  showSafeGuide = false,
}: {
  data: StageState | null;
  myStageId?: string;
  mute?: boolean;
  showSafeGuide?: boolean;
}) {
  const [nowOffset, setNowOffset] = useState(0);
  const [tickNow, setTickNow] = useState(() => Date.now());
  const [mcSpeaking, setMcSpeaking] = useState(false);
  const [freshRewardKey, setFreshRewardKey] = useState<string>('');
  const [reloadedFxKey, setReloadedFxKey] = useState<string>('');
  const [questionSpeechEndedAt, setQuestionSpeechEndedAt] = useState<number | null>(null);
  const [welcomeUntilAt, setWelcomeUntilAt] = useState<number>(0);
  const [lastCountdownSec, setLastCountdownSec] = useState<number | null>(null);

  const isFirstSyncRef = useRef<boolean>(true);
  const lastFxKeyRef = useRef<string>('');
  const prevSpeakingRef = useRef<boolean>(false);
  const prevPhaseRef = useRef<string>('');
  const prevRoundRef = useRef<number>(0);
  const prevSeatedSigRef = useRef<string>('');
  const lastCountdownKeyRef = useRef<string>('');

  useEffect(() => {
    try {
      lastFxKeyRef.current = sessionStorage.getItem('gn_last_fx_key') || '';
    } catch {}
    stageVoice.onSpeakingChange = (speaking) => {
      setMcSpeaking(speaking);
    };
    return () => {
      stageVoice.onSpeakingChange = undefined;
    };
  }, []);

  // Ghi nhận thời điểm âm thanh đọc đề vừa kết thúc để chuyển mượt từ tư thế 03 (đọc câu hỏi) -> 04 (giới thiệu lựa chọn) -> 05 (suy nghĩ)
  useEffect(() => {
    if (prevSpeakingRef.current && !mcSpeaking && data?.phase === 'OPEN') {
      setQuestionSpeechEndedAt(Date.now() + nowOffset);
    }
    prevSpeakingRef.current = mcSpeaking;
  }, [mcSpeaking, data?.phase, nowOffset]);

  useEffect(() => {
    if (!data) return;
    setNowOffset(data.serverNow - Date.now());
    const sfxAllowed = data.display.sfxEnabled !== false;
    const isSpeaker = Boolean(myStageId && data.speakerId === myStageId && !mute);
    stageVoice.enabled = isSpeaker && Boolean(data.display.ttsEnabled);
    stageSfx.enabled = isSpeaker && sfxAllowed;

    const fxKey = `${data.question?.code ?? 0}:${data.phase}:${data.phaseStartedAt}`;
    const ageMs = Math.max(0, data.serverNow - data.phaseStartedAt);
    const alreadyPlayed = lastFxKeyRef.current === fxKey;
    const seatedSig = data.seats.map((s) => s.occupant?.userId ?? '').join('|');
    const curRound = data.session?.round ?? 0;

    if (isFirstSyncRef.current) {
      isFirstSyncRef.current = false;
      prevPhaseRef.current = data.phase;
      prevRoundRef.current = curRound;
      prevSeatedSigRef.current = seatedSig;
      // Khi tải lại trang (F5): nếu sự kiện/pha này đã phát trước đó hoặc đã qua > 1.5s thì KHÔNG phát lại lời chào hay vinh danh cũ
      lastFxKeyRef.current = fxKey;
      try {
        sessionStorage.setItem('gn_last_fx_key', fxKey);
      } catch {}
      if (!alreadyPlayed && ageMs <= 1500) {
        setFreshRewardKey(fxKey);
        if (stageVoice.enabled) stageVoice.speakMcLine(data.mc, true);
        if (stageSfx.enabled) stageSfx.playPhase(data.phase);
      } else {
        setReloadedFxKey(fxKey);
        stageVoice.markSeen(data.mc?.id);
      }
      return;
    }

    if (fxKey !== lastFxKeyRef.current) {
      lastFxKeyRef.current = fxKey;
      setReloadedFxKey('');
      if (data.phase !== prevPhaseRef.current) {
        setQuestionSpeechEndedAt(null);
      }
      prevPhaseRef.current = data.phase;
      try {
        sessionStorage.setItem('gn_last_fx_key', fxKey);
      } catch {}
      setFreshRewardKey(fxKey);
      if (stageSfx.enabled) stageSfx.playPhase(data.phase);
    }

    // Phát hiện mở vòng mới hoặc đón người mới bước lên ghế nóng -> bật nhịp chào/đón ghế ngắn (02)
    if (curRound > 0 && curRound !== prevRoundRef.current) {
      prevRoundRef.current = curRound;
      setWelcomeUntilAt(data.serverNow + 2600);
    }
    if (seatedSig !== prevSeatedSigRef.current) {
      const prevIds = prevSeatedSigRef.current.split('|').filter(Boolean);
      const nextIds = seatedSig.split('|').filter(Boolean);
      const addedSeat = nextIds.some((id) => !prevIds.includes(id));
      prevSeatedSigRef.current = seatedSig;
      if (addedSeat) {
        setWelcomeUntilAt(data.serverNow + 2400);
      }
    }

    if (stageVoice.enabled) {
      stageVoice.speakMcLine(data.mc, true);
    } else {
      stageVoice.markSeen(data.mc?.id);
    }
  }, [data, myStageId, mute]);

  useEffect(() => {
    const t = setInterval(() => setTickNow(Date.now() + nowOffset), 100);
    return () => clearInterval(t);
  }, [nowOffset]);

  // Hiệu ứng âm thanh đếm ngược khi gần hết giờ còn 10 giây đổ lại (10..1s) trong pha OPEN
  const remainSec = data?.phaseEndsAt ? Math.max(0, Math.ceil((data.phaseEndsAt - tickNow) / 1000)) : null;
  useEffect(() => {
    if (!data || data.phase !== 'OPEN' || remainSec === null || remainSec < 1 || remainSec > 10) {
      if (data?.phase !== 'OPEN') setLastCountdownSec(null);
      return;
    }
    const tickKey = `${data.question?.code ?? 0}:${data.phaseStartedAt}:${remainSec}`;
    if (lastCountdownKeyRef.current !== tickKey) {
      lastCountdownKeyRef.current = tickKey;
      setLastCountdownSec(remainSec);
      stageSfx.playCountdownTick(remainSec);
    }
  }, [data, remainSec]);

  if (!data) {
    return (
      <div
        style={{
          width: STAGE_W,
          height: STAGE_H,
          background: '#050a1b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 22,
          fontWeight: 800,
          color: '#fbbf24',
        }}
      >
        Đang kết nối trường quay GHẾ NÓNG...
      </div>
    );
  }

  const safe = data.display;
  const reduceMotion = Boolean(data.display.reduceMotion);
  const currentFxKey = `${data.question?.code ?? 0}:${data.phase}:${data.phaseStartedAt}`;
  const isReloadedOldPhase = reloadedFxKey === currentFxKey;
  const isFreshReward = !reduceMotion && freshRewardKey === currentFxKey && !isReloadedOldPhase;
  const guide = getDynamicGuide(data);

  const elapsedPhaseMs = Math.max(0, tickNow - data.phaseStartedAt);
  const sinceQuestionSpeechEndMs =
    questionSpeechEndedAt !== null ? Math.max(0, tickNow - questionSpeechEndedAt) : null;
  const isWelcomePulse = tickNow < welcomeUntilAt;

  const mcPose = resolveMcPose({
    data,
    remainSec,
    mcSpeaking,
    elapsedPhaseMs,
    sinceQuestionSpeechEndMs,
    isWelcomePulse,
    isReloadedOldPhase,
  });
  const mcPoseMeta = MC_WHITE_POSES[mcPose];

  // Cỡ chữ tự động co giãn khi câu hỏi dài hoặc 4 đáp án dài để hiển thị đầy đủ 100%, không cắt chữ
  const qTextLen = data.question?.text?.length ?? 0;
  const qFontSize = qTextLen > 130 ? 14.5 : qTextLen > 90 ? 16.5 : 18.5;

  return (
    <div
      data-testid="stage-root"
      className={reduceMotion ? 'reduce-motion' : undefined}
      style={{
        width: STAGE_W,
        height: STAGE_H,
        position: 'relative',
        background: 'radial-gradient(ellipse at 50% 14%, #132a5e 0%, #08122c 52%, #040816 100%)',
        color: '#f8fafc',
        overflow: 'hidden',
      }}
    >
      {/* ====================================================================
          LỚP NỀN SÂN KHẤU GAMESHOW 2.5D: Giàn đèn trần, 5 Spotlight & Khán đài chữ U
         ==================================================================== */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        <defs>
          {/* Chùm đèn vàng ấm mặc định */}
          <linearGradient id="spotWarm" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.32" />
            <stop offset="65%" stopColor="#f59e0b" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </linearGradient>
          {/* Chùm đèn xanh ngọc khi đang ngồi ghế nóng */}
          <linearGradient id="spotCyan" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.34" />
            <stop offset="70%" stopColor="#06b6d4" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
          </linearGradient>
          {/* Chùm đèn Spotlight RỰC RỠ chiếu thẳng vào ghế nóng trả lời ĐÚNG */}
          <linearGradient id="spotVictory" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fef08a" stopOpacity="0.78" />
            <stop offset="45%" stopColor="#fbbf24" stopOpacity="0.42" />
            <stop offset="85%" stopColor="#22d3ee" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
          {/* Mặt sàn trường quay 2.5D */}
          <radialGradient id="gameshowFloor" cx="50%" cy="48%" r="52%">
            <stop offset="0%" stopColor="#17377a" stopOpacity="0.85" />
            <stop offset="62%" stopColor="#0b193d" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#04091a" stopOpacity="1" />
          </radialGradient>
        </defs>

        {/* Vòm ánh sáng trường quay phía trên */}
        <ellipse cx="360" cy="40" rx="350" ry="70" fill="rgba(6, 182, 212, 0.12)" />
        <path d="M 0 14 L 720 14" stroke="#1e3a8a" strokeWidth="4" opacity="0.7" />

        {/* 5 Đèn trần & Chùm sáng Spotlight chiếu vào đúng 5 vị trí ghế nóng */}
        {HOT_SEAT_CENTERS_X.map((cx, idx) => {
          const seatData = data.seats[idx];
          const isSeatCorrect =
            seatData?.occupant?.result === 'correct' || Boolean(data.honor?.correctSeats?.includes(idx + 1));
          const hasOccupant = Boolean(seatData?.occupant || seatData?.invite);
          const beamFill = isSeatCorrect ? 'url(#spotVictory)' : hasOccupant ? 'url(#spotCyan)' : 'url(#spotWarm)';

          return (
            <g key={idx} data-testid={isSeatCorrect ? `spotlight-correct-${idx + 1}` : `spotlight-${idx + 1}`}>
              <polygon
                className={isSeatCorrect ? 'anim-spotlight' : undefined}
                points={`${cx - 14},12 ${cx + 14},12 ${cx + 66},650 ${cx - 66},650`}
                fill={beamFill}
              />
              {/* Đèn pha trên giàn trần */}
              <rect x={cx - 14} y={4} width={28} height={10} rx={4} fill="#1e293b" stroke="#fbbf24" strokeWidth="1.5" />
              <ellipse
                cx={cx}
                cy={14}
                rx={11}
                ry={3.5}
                fill={isSeatCorrect ? '#fef08a' : hasOccupant ? '#22d3ee' : '#fbbf24'}
              />
              {/* Hào quang rực sáng dưới sàn khi ghế nóng trả lời ĐÚNG */}
              {isSeatCorrect && (
                <ellipse
                  cx={cx}
                  cy={608}
                  rx={58}
                  ry={18}
                  fill="rgba(251, 191, 36, 0.42)"
                  stroke="#fde047"
                  strokeWidth="2"
                />
              )}
            </g>
          );
        })}

        {/* Sàn sân khấu chính hình elip đồng tâm 2.5D */}
        <ellipse cx="360" cy="612" rx="348" ry="88" fill="url(#gameshowFloor)" stroke="#06b6d4" strokeWidth="2.5" strokeOpacity="0.65" />
        <ellipse cx="360" cy="612" rx="304" ry="66" fill="none" stroke="#fbbf24" strokeWidth="1.8" strokeDasharray="10 6" strokeOpacity="0.55" />

        {/* Khán đài hình chữ U 2.5D bao quanh sân khấu (2 cánh + đáy vòng cung) */}
        <path
          d="M 8 742 L 88 742 L 88 978 Q 360 1042 632 978 L 632 742 L 712 742 L 712 1142 Q 360 1218 8 1142 Z"
          fill="rgba(7, 14, 34, 0.92)"
          stroke="#06b6d4"
          strokeWidth="2"
          strokeOpacity="0.45"
        />
        {/* Đường bậc thềm khán đài chữ U */}
        <path
          d="M 16 995 Q 360 1068 704 995"
          fill="none"
          stroke="rgba(251, 191, 36, 0.28)"
          strokeWidth="1.5"
          strokeDasharray="6 6"
        />
        <path
          d="M 16 1052 Q 360 1126 704 1052"
          fill="none"
          stroke="rgba(34, 211, 238, 0.25)"
          strokeWidth="1.5"
          strokeDasharray="6 6"
        />

        {/* Bậc thềm trung tâm dành cho 10 Ghế Chờ (2 hàng × 5 ghế) */}
        <path
          d="M 94 744 L 626 744 L 636 938 L 84 938 Z"
          fill="rgba(10, 20, 48, 0.94)"
          stroke="#22d3ee"
          strokeWidth="2"
          strokeOpacity="0.5"
        />
      </svg>

      {/* ====================================================================
          1. PHÍA TRÊN: Tên game nhỏ gọn, Vòng chơi & Bảng xếp hạng Top 5
         ==================================================================== */}
      <div
        style={{
          position: 'absolute',
          top: Math.max(18, safe.safeTop),
          left: safe.safeLeft,
          right: safe.safeRight,
          display: 'flex',
          alignItems: 'stretch',
          justifyContent: 'space-between',
          gap: 10,
          pointerEvents: 'none',
          zIndex: 10,
        }}
      >
        {/* Cụm thương hiệu nhỏ gọn + Vòng chơi + Trạng thái */}
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(8, 16, 40, 0.96), rgba(15, 30, 68, 0.94))',
            border: '2px solid #f97316',
            borderRadius: 14,
            padding: '7px 12px',
            boxShadow: '0 8px 20px rgba(0,0,0,0.55)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            minWidth: 215,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 21, fontWeight: 900, letterSpacing: 0.6, color: '#fbbf24' }}>🔥 GHẾ NÓNG</span>
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 800,
                background: '#0e7490',
                color: '#ecfeff',
                padding: '2px 8px',
                borderRadius: 99,
                border: '1px solid #22d3ee',
              }}
            >
              {data.session ? `VÒNG ${data.session.round}` : `LUẬT v${data.rulesVersion}`}
            </span>
          </div>
          <div
            data-testid="stage-phase"
            style={{
              fontSize: 12.5,
              fontWeight: 800,
              color: '#67e8f9',
              marginTop: 3,
              letterSpacing: 0.3,
            }}
          >
            {PHASE_LABELS[data.phase] ?? data.phase}
          </div>
        </div>

        {/* Bảng xếp hạng Top 5 điểm phiên rõ nét */}
        <div
          data-testid="stage-leaderboard"
          style={{
            background: 'linear-gradient(135deg, rgba(8, 16, 40, 0.96), rgba(12, 24, 56, 0.94))',
            border: '2px solid #06b6d4',
            borderRadius: 14,
            padding: '6px 12px',
            flex: 1,
            maxWidth: 440,
            boxShadow: '0 8px 20px rgba(0,0,0,0.55)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
            <span style={{ fontSize: 11.5, fontWeight: 900, color: '#fbbf24', letterSpacing: 0.4 }}>
              🏆 BẢNG XẾP HẠNG TOP 5
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: '#67e8f9' }}>Đúng +10đ/câu</span>
          </div>
          {data.leaderboard.length === 0 ? (
            <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', padding: '4px 0' }}>
              Chưa có điểm — Trả lời đúng câu hỏi để lên Bảng Xếp Hạng!
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
              {data.leaderboard.slice(0, 5).map((row) => (
                <div
                  key={row.userId}
                  style={{
                    background: row.rank === 1 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(15, 23, 42, 0.85)',
                    border: `1px solid ${row.rank === 1 ? '#fbbf24' : '#1e3a8a'}`,
                    borderRadius: 8,
                    padding: '3px 5px',
                    textAlign: 'center',
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10.5,
                      fontWeight: 800,
                      color: row.rank === 1 ? '#fde047' : '#cbd5e1',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    #{row.rank} {row.nickname}
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 900, color: '#22d3ee' }}>{row.points}đ</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ====================================================================
          2. KHU TRUNG TÂM PHÍA TRÊN: MC áo trắng 8 tư thế đứng cạnh + Màn hình câu hỏi, 4 đáp án & Đồng hồ
         ==================================================================== */}
      <div
        style={{
          position: 'absolute',
          top: Math.max(96, safe.safeTop + 74),
          left: safe.safeLeft,
          right: safe.safeRight,
          height: 344,
          display: 'flex',
          alignItems: 'stretch',
          gap: 8,
          pointerEvents: 'none',
          zIndex: 10,
        }}
      >
        {/* MC áo trắng 8 tư thế đứng cạnh màn hình câu hỏi — khung riêng 176px rộng rãi cho tay, KHÔNG BAO GIỜ che chữ */}
        <div
          data-testid="stage-mc"
          data-mc-pose={mcPose}
          style={{
            width: 176,
            background: 'linear-gradient(180deg, rgba(12, 24, 56, 0.94) 0%, rgba(6, 12, 30, 0.98) 100%)',
            border: `2px solid ${mcPose === '06' ? '#ef4444' : mcPose === '07' ? '#fde047' : '#fbbf24'}`,
            borderRadius: 16,
            padding: '5px 4px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 10px 24px rgba(0,0,0,0.65)',
            flexShrink: 0,
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span
              style={{
                background: 'linear-gradient(90deg, #f59e0b, #fbbf24)',
                color: '#090d1b',
                fontSize: 10.5,
                fontWeight: 900,
                padding: '2px 7px',
                borderRadius: 99,
                whiteSpace: 'nowrap',
              }}
            >
              🎤 MC #{mcPose}
            </span>
            <span
              data-testid="stage-mc-pose-label"
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: mcPoseMeta.badgeColor,
                whiteSpace: 'nowrap',
              }}
            >
              {mcPoseMeta.label}
            </span>
          </div>

          {/* Khung ảnh MC áo trắng chuẩn 2:3 (168 × 252 px, hiển thị toàn khung 1024 × 1536 không crop) */}
          <div style={{ margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <McWhiteHost25D poseCode={mcPose} width={168} height={252} reduceMotion={reduceMotion} />
          </div>

          {/* Bục đứng MC 2.5D + Trạng thái dẫn ngắn gọn */}
          <div
            style={{
              width: '100%',
              background: 'linear-gradient(180deg, #1e3a8a 0%, #0f172a 100%)',
              border: '1.5px solid #22d3ee',
              borderRadius: 10,
              padding: '4px 5px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 9.5, fontWeight: 900, color: '#fde047', whiteSpace: 'nowrap' }}>
              {mcPoseMeta.label.toUpperCase()}
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: '#e0f2fe', marginTop: 1, lineHeight: 1.15, whiteSpace: 'nowrap' }}>
              {data.phase === 'OPEN'
                ? remainSec !== null && remainSec <= 5
                  ? `⚠️ Sắp hết giờ (${remainSec}s)!`
                  : `Đang mở Câu #${data.question?.code}`
                : data.phase === 'INVITING'
                  ? 'Đón người lên ghế (12s)'
                  : data.phase === 'REVEAL'
                    ? `Đáp án đúng: ${data.reveal?.correct ?? ''}`
                    : data.phase === 'HONOR'
                      ? 'Vinh danh ghế nóng!'
                      : 'Trường quay sẵn sàng'}
            </div>
          </div>
        </div>

        {/* Màn hình câu hỏi trung tâm + Đồng hồ rõ ràng + 4 lựa chọn A/B/C/D */}
        <div
          data-testid="question-board"
          style={{
            flex: 1,
            minWidth: 0,
            background: 'linear-gradient(180deg, #0b193d 0%, #060f26 100%)',
            border: '2.5px solid #22d3ee',
            borderRadius: 18,
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: '0 14px 32px rgba(0,0,0,0.7), inset 0 0 28px rgba(6, 182, 212, 0.16)',
          }}
        >
          {/* Thanh đầu màn hình câu hỏi: Mã câu + Chủ đề + ĐỒNG HỒ RÕ RÀNG */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span
                data-testid="question-code"
                style={{
                  background: 'linear-gradient(135deg, #f97316, #ea580c)',
                  color: '#ffffff',
                  fontWeight: 900,
                  fontSize: 15,
                  padding: '3px 10px',
                  borderRadius: 8,
                  border: '1.5px solid #fdba74',
                  whiteSpace: 'nowrap',
                }}
              >
                {data.question ? `CÂU #${data.question.code}` : 'GHẾ NÓNG'}
              </span>
              {data.question && (
                <span
                  style={{
                    background: 'rgba(6, 182, 212, 0.18)',
                    color: '#67e8f9',
                    fontWeight: 800,
                    fontSize: 12.5,
                    padding: '3px 8px',
                    borderRadius: 8,
                    border: '1px solid #06b6d4',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {data.question.topic}
                </span>
              )}
              {data.answeredCount != null && (
                <span style={{ fontSize: 12, fontWeight: 800, color: '#fde047', whiteSpace: 'nowrap' }}>
                  · Đã chốt: {data.answeredCount}
                </span>
              )}
            </div>

            {/* Đồng hồ đếm ngược nổi bật ngay trên màn hình câu hỏi (có âm báo khi còn ≤ 10s) */}
            <div
              data-testid="stage-timer"
              data-countdown-sfx={lastCountdownSec ?? ''}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background:
                  data.phase === 'OPEN' && remainSec !== null && remainSec <= 5
                    ? 'linear-gradient(135deg, #dc2626, #991b1b)'
                    : data.phase === 'OPEN' && remainSec !== null && remainSec <= 10
                      ? 'linear-gradient(135deg, #b45309, #78350f)'
                      : 'linear-gradient(135deg, #0f172a, #1e293b)',
                border: `2.5px solid ${
                  data.phase === 'OPEN' && remainSec !== null && remainSec <= 5
                    ? '#fef08a'
                    : data.phase === 'OPEN'
                      ? '#fbbf24'
                      : '#22d3ee'
                }`,
                borderRadius: 99,
                padding: '3px 12px',
                boxShadow: '0 0 16px rgba(251, 191, 36, 0.35)',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 800, color: '#fde68a' }}>⏱️</span>
              <span style={{ fontSize: 22, fontWeight: 900, color: '#ffffff', lineHeight: 1 }}>
                {remainSec !== null ? `${remainSec}s` : '—'}
              </span>
            </div>
          </div>

          {/* Nội dung câu hỏi & 4 đáp án A/B/C/D */}
          {data.question ? (
            data.question.text ? (
              <>
                <div
                  data-testid="question-text"
                  style={{
                    fontSize: qFontSize,
                    fontWeight: 800,
                    lineHeight: 1.24,
                    color: '#ffffff',
                    margin: '4px 0',
                  }}
                >
                  {data.question.text}
                </div>

                {/* 4 lựa chọn A, B, C, D — tự động điều chỉnh cỡ chữ khi đáp án dài, không cắt chữ */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {(['A', 'B', 'C', 'D'] as const).map((letter, idx) => {
                    const rawChoice = data.question?.choices?.[idx] ?? '';
                    const isCorrect = data.reveal?.correct === letter;
                    const choiceFontSize = rawChoice.length > 55 ? 11.2 : rawChoice.length > 38 ? 12.2 : rawChoice.length > 24 ? 13.8 : 15.5;
                    return (
                      <div
                        key={letter}
                        data-testid={`choice-${letter}`}
                        style={{
                          background: isCorrect
                            ? 'linear-gradient(135deg, #059669, #047857)'
                            : 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.92))',
                          border: isCorrect ? '2.5px solid #fde047' : '1.8px solid #0891b2',
                          borderRadius: 12,
                          padding: '5px 7px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          minHeight: 54,
                          boxShadow: isCorrect ? '0 0 18px rgba(251, 191, 36, 0.45)' : 'none',
                        }}
                      >
                        <span
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            background: isCorrect ? '#fde047' : '#f97316',
                            color: isCorrect ? '#090d1b' : '#ffffff',
                            fontWeight: 900,
                            fontSize: 14.5,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {data.question?.code}
                          {letter}
                        </span>
                        <span
                          style={{
                            fontSize: choiceFontSize,
                            fontWeight: 700,
                            color: '#f8fafc',
                            lineHeight: 1.18,
                          }}
                        >
                          {rawChoice}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 23, fontWeight: 900, color: '#fbbf24' }}>
                  CHUẨN BỊ CÂU #{data.question.code}
                </div>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: '#e2e8f0', marginTop: 6 }}>
                  Chủ đề: <b style={{ color: '#22d3ee' }}>{data.question.topic}</b> · Mở đề sau {remainSec ?? 5} giây!
                </div>
              </div>
            )
          ) : (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: 8,
              }}
            >
              <div style={{ fontSize: 21, fontWeight: 900, color: '#fbbf24' }}>
                {data.phase === 'INVITING'
                  ? '🔔 ĐANG ĐẨY NGƯỜI CHỜ LÊN 5 GHẾ NÓNG (12 GIÂY)'
                  : data.phase === 'NO_QUESTIONS'
                    ? '☕ ĐÃ HẾT CÂU HỎI TRONG PHIÊN — TẠM NGHỈ'
                    : data.phase === 'PAUSED'
                      ? `⏸️ TẠM DỪNG: ${data.pauseReason || ''}`
                      : '🔥 TRƯỜNG QUAY GHẾ NÓNG 2.5D'}
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: '#cbd5e1', marginTop: 6 }}>
                {data.phase === 'INVITING'
                  ? 'Người chơi từ Ghế Chờ tự động vào Ghế Nóng sau 12 giây chuẩn bị!'
                  : '5 Ghế Nóng Đỏ Cam · 10 Ghế Chờ (2 hàng × 5) · Khán Đài Chữ U'}
              </div>
            </div>
          )}

          {/* Thanh đáy màn hình câu hỏi: Giải thích đáp án HOẶC Hướng dẫn chơi ngắn gọn theo trạng thái */}
          {data.reveal ? (
            <div
              data-testid="question-explanation"
              style={{
                marginTop: 4,
                padding: '5px 10px',
                borderRadius: 10,
                background: 'rgba(5, 150, 105, 0.32)',
                border: '1.5px solid #34d399',
                fontSize: 13,
                color: '#ecfdf5',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              ✅ Đáp án {data.reveal.correct}: {data.reveal.explanation} ({data.reveal.totalCorrect}/
              {data.reveal.totalAnswers} đúng)
            </div>
          ) : (
            <div
              data-testid="command-guide-box"
              style={{
                marginTop: 4,
                padding: '5px 10px',
                borderRadius: 10,
                background: 'rgba(15, 23, 42, 0.92)',
                border: '1.5px solid #fbbf24',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span
                style={{
                  background: '#fbbf24',
                  color: '#090d1b',
                  fontSize: 10.5,
                  fontWeight: 900,
                  padding: '2px 7px',
                  borderRadius: 6,
                  flexShrink: 0,
                }}
              >
                {guide.badge}
              </span>
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 800,
                  color: '#fef3c7',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {guide.text}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ====================================================================
          3. PHÍA DƯỚI MÀN HÌNH: ĐÚNG 5 GHẾ NÓNG ĐỎ CAM (Ghế + Nhân vật + Số ghế + Tên + Điểm + Cấp bậc)
         ==================================================================== */}
      <div
        data-testid="hot-seats-row"
        style={{
          position: 'absolute',
          left: 14,
          right: 14,
          top: 454,
          height: 274,
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 6,
          alignItems: 'end',
          pointerEvents: 'none',
          zIndex: 12,
        }}
      >
        {data.seats.map((s, idx) => {
          const arcOffset = [12, 4, 0, 4, 12][idx] ?? 0;
          const occ = s.occupant;
          const inv = s.invite;
          const dep = s.departed;

          let pose: CharacterPose = 'idle';
          let visualState: HotSeatVisualState = 'empty';
          if (occ) {
            if (occ.result === 'correct') {
              pose = 'correct';
              visualState = 'correct';
            } else if (occ.result === 'wrong' || occ.result === 'none') {
              pose = 'wrong';
              visualState = 'wrong';
            } else if (occ.answered) {
              pose = 'answered';
              visualState = 'locked';
            } else {
              pose = data.phase === 'OPEN' ? 'thinking' : 'idle';
              visualState = 'playing';
            }
          } else if (dep) {
            pose = 'departing';
            visualState = 'wrong';
          } else if (inv) {
            pose = 'entering';
            visualState = 'inviting';
          }

          const invRemain = inv ? Math.max(0, Math.ceil((inv.expiresAt - tickNow) / 1000)) : 0;
          const cardBorder =
            visualState === 'correct'
              ? '#fbbf24'
              : visualState === 'wrong'
                ? '#ef4444'
                : visualState === 'locked'
                  ? '#22d3ee'
                  : visualState === 'inviting'
                    ? '#fde047'
                    : visualState === 'playing'
                      ? '#f97316'
                      : '#475569';

          return (
            <div
              key={s.seat}
              data-testid={`hot-seat-${s.seat}`}
              style={{
                transform: `translateY(${arcOffset}px)`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
              }}
            >
              {/* Nhãn trạng thái ghế nóng & hiệu ứng thưởng +10đ/+1 cấp */}
              <div style={{ minHeight: 24, marginBottom: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {visualState === 'correct' && (
                  <span
                    className={isFreshReward ? 'anim-score-pop' : undefined}
                    style={{
                      background: 'linear-gradient(90deg, #f59e0b, #10b981)',
                      color: '#090d1b',
                      fontSize: 11,
                      fontWeight: 900,
                      padding: '2px 8px',
                      borderRadius: 99,
                      border: '1.5px solid #fef08a',
                      boxShadow: '0 0 12px rgba(251, 191, 36, 0.6)',
                    }}
                  >
                    ✨ +10Đ · +1 CẤP
                  </span>
                )}
                {visualState === 'wrong' && (
                  <span
                    style={{
                      background: '#dc2626',
                      color: '#ffffff',
                      fontSize: 11,
                      fontWeight: 900,
                      padding: '2px 8px',
                      borderRadius: 99,
                      border: '1px solid #fca5a5',
                    }}
                  >
                    {occ?.result === 'none' || dep?.result === 'none' ? '⏰ HẾT GIỜ' : '✗ RỚT GHẾ'}
                  </span>
                )}
                {visualState === 'locked' && (
                  <span
                    style={{
                      background: '#0891b2',
                      color: '#ecfeff',
                      fontSize: 10.5,
                      fontWeight: 900,
                      padding: '2px 8px',
                      borderRadius: 99,
                      border: '1px solid #67e8f9',
                    }}
                  >
                    🔒 ĐÃ KHÓA ĐÁP ÁN
                  </span>
                )}
                {visualState === 'inviting' && (
                  <span
                    style={{
                      background: '#fbbf24',
                      color: '#090d1b',
                      fontSize: 10.5,
                      fontWeight: 900,
                      padding: '2px 8px',
                      borderRadius: 99,
                    }}
                  >
                    ⏳ ĐANG MỜI ({invRemain}s)
                  </span>
                )}
                {visualState === 'playing' && (
                  <span
                    style={{
                      background: 'rgba(249, 115, 22, 0.25)',
                      color: '#fed7aa',
                      fontSize: 10.5,
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: 99,
                      border: '1px solid #f97316',
                    }}
                  >
                    🔥 ĐANG CHƠI
                  </span>
                )}
                {visualState === 'empty' && (
                  <span
                    style={{
                      background: 'rgba(30, 41, 59, 0.75)',
                      color: '#94a3b8',
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: 99,
                    }}
                  >
                    GHẾ TRỐNG
                  </span>
                )}
              </div>

              {/* Tổ hợp Chiếc ghế nóng 2.5D đỏ cam + Nhân vật + Số ghế */}
              <HotSeatUnit25D
                seatNumber={s.seat}
                visualState={visualState}
                template={occ?.template ?? dep?.template ?? inv?.template ?? s.seat}
                pose={pose}
              />

              {/* Bảng tên, Điểm và Cấp bậc ngay dưới chân ghế nóng */}
              <div
                style={{
                  width: '100%',
                  background: occ
                    ? 'linear-gradient(180deg, rgba(15, 23, 42, 0.96) 0%, rgba(8, 13, 28, 0.98) 100%)'
                    : 'rgba(9, 13, 28, 0.86)',
                  border: `2px solid ${cardBorder}`,
                  borderRadius: 12,
                  padding: '5px 5px',
                  textAlign: 'center',
                  boxShadow: occ ? `0 8px 18px rgba(0,0,0,0.65), 0 0 12px ${cardBorder}44` : 'none',
                }}
              >
                <div
                  data-testid={`hot-seat-${s.seat}-name`}
                  style={{
                    fontSize: 13,
                    fontWeight: 900,
                    color: occ ? '#ffffff' : inv ? '#fde047' : '#94a3b8',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {occ ? occ.name : inv ? `Mời: ${inv.name}` : dep ? `${dep.name} (rời)` : `Ghế nóng #${s.seat}`}
                </div>

                {/* Điểm phiên + Cấp bậc rõ ràng */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 3,
                    marginTop: 3,
                    padding: '2px 5px',
                    borderRadius: 6,
                    background: occ ? 'rgba(6, 182, 212, 0.16)' : 'rgba(30, 41, 59, 0.45)',
                  }}
                >
                  <span
                    data-testid={`hot-seat-${s.seat}-points`}
                    style={{
                      fontSize: 11,
                      fontWeight: 900,
                      color: occ ? '#fde047' : '#64748b',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {occ ? `${occ.points ?? 0}đ` : '0đ'}
                  </span>
                  <span
                    data-testid={`hot-seat-${s.seat}-level`}
                    style={{
                      fontSize: 10.5,
                      fontWeight: 800,
                      color: occ ? '#67e8f9' : '#64748b',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {occ ? `Cấp ${occ.level} · ${occ.title}` : inv ? `Lên (${invRemain}s)` : 'Cấp —'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ====================================================================
          4. KHU CHỜ: ĐÚNG 10 GHẾ CHỜ, HAI HÀNG, MỖI HÀNG 5 GHẾ
         ==================================================================== */}
      <div
        data-testid="waiting-seats-section"
        style={{
          position: 'absolute',
          left: 94,
          right: 94,
          top: 750,
          pointerEvents: 'none',
          zIndex: 11,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 6,
            padding: '0 4px',
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 900, color: '#22d3ee', letterSpacing: 0.3, whiteSpace: 'nowrap' }}>
            ⏳ 10 GHẾ CHỜ (2 HÀNG × 5 GHẾ — TỰ ĐẨY LÊN GHẾ NÓNG)
          </span>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: '#fde68a', whiteSpace: 'nowrap' }}>
            {data.registeredMore > 0
              ? `+${data.registeredMore} người chờ tiếp theo`
              : `${data.waiting.length}/10 ghế có người`}
          </span>
        </div>

        {/* Lưới đúng 2 hàng × 5 ghế = 10 ghế chờ */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gridTemplateRows: 'repeat(2, auto)',
            gap: 6,
          }}
        >
          {Array.from({ length: 10 }, (_, idx) => {
            const pos = idx + 1;
            const w = data.waiting.find((x) => x.pos === pos);
            return (
              <WaitingSeatUnit25D
                key={pos}
                pos={pos}
                name={w ? w.name : 'Trống'}
                occupied={Boolean(w)}
                template={w?.template ?? pos}
              />
            );
          })}
        </div>
      </div>

      {/* ====================================================================
          5. KHÁN GIẢ NGỒI THÀNH CHỮ U BAO QUANH SÂN KHẤU (30 vị trí ghế cụ thể)
         ==================================================================== */}
      <div data-testid="audience-u-stand" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 9 }}>
        {U_STAND_SLOTS.map((slot, idx) => {
          const aud = data.audience[idx];
          return (
            <div
              key={idx}
              data-testid={`audience-seat-${idx + 1}`}
              style={{
                position: 'absolute',
                left: slot.x,
                top: slot.y,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <AudienceSeatUnit25D occupied={Boolean(aud)} template={aud?.template ?? idx} />
            </div>
          );
        })}

        {/* Bảng thông tin Khán đài chữ U */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 952,
            transform: 'translateX(-50%)',
            background: 'linear-gradient(90deg, rgba(8, 16, 40, 0.95), rgba(15, 30, 68, 0.95))',
            border: '1.5px solid #06b6d4',
            borderRadius: 99,
            padding: '4px 16px',
            fontSize: 12,
            fontWeight: 800,
            color: '#e0f2fe',
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 14px rgba(0,0,0,0.6)',
          }}
        >
          🏟️ KHÁN ĐÀI CHỮ U: {Math.min(data.audience.length, U_STAND_SLOTS.length)}/{U_STAND_SLOTS.length} ghế khán giả
          {data.audienceTotal > 15 + U_STAND_SLOTS.length
            ? ` · +${data.audienceTotal - (15 + U_STAND_SLOTS.length)} người đang chơi chờ ghế trống`
            : ` · Tổng ${data.audienceTotal} người đang tham gia`}
        </div>
      </div>

      {/* ====================================================================
          6. THÔNG BÁO SỰ KIỆN / QUÀ TẶNG GỌN GÀNG
         ==================================================================== */}
      {data.notices.length > 0 && (
        <div
          style={{
            position: 'absolute',
            left: 36,
            right: 36,
            bottom: Math.max(18, safe.safeBottom),
            display: 'flex',
            justifyContent: 'center',
            gap: 8,
            flexWrap: 'wrap',
            pointerEvents: 'none',
            zIndex: 20,
          }}
        >
          {data.notices.slice(0, 2).map((n) => (
            <div
              key={n.id}
              style={{
                background:
                  n.kind === 'gift'
                    ? 'linear-gradient(90deg, rgba(234, 88, 12, 0.96), rgba(180, 83, 9, 0.96))'
                    : 'rgba(8, 16, 40, 0.95)',
                border: `2px solid ${n.kind === 'gift' ? '#fbbf24' : '#22d3ee'}`,
                borderRadius: 99,
                padding: '5px 16px',
                fontSize: 13,
                fontWeight: 800,
                color: '#ffffff',
                boxShadow: '0 6px 18px rgba(0,0,0,0.65)',
              }}
            >
              {n.text}
            </div>
          ))}
        </div>
      )}

      {/* ====================================================================
          7. HIỆU ỨNG VINH DANH GIỮA MÀN HÌNH TRONG 3 GIÂY (Gộp nhiều người cùng lúc)
         ==================================================================== */}
      {data.phase === 'HONOR' && data.honor && (
        <div
          data-testid="honor-overlay"
          className={isFreshReward ? 'anim-honor' : undefined}
          style={{
            position: 'absolute',
            left: 202,
            right: 18,
            top: 168,
            background: 'linear-gradient(135deg, rgba(8, 16, 40, 0.98), rgba(23, 37, 84, 0.98))',
            border: '3px solid #fbbf24',
            borderRadius: 20,
            padding: '14px 16px',
            textAlign: 'center',
            boxShadow: '0 20px 50px rgba(0,0,0,0.88), 0 0 36px rgba(251, 191, 36, 0.5)',
            zIndex: 30,
            pointerEvents: 'none',
          }}
        >
          {data.honor.allFloor && (
            <div style={{ fontSize: 22, fontWeight: 900, color: '#fde047', marginBottom: 6 }}>
              🔥 CẢ 5 GHẾ NÓNG CÙNG THẮNG! 🔥
            </div>
          )}
          {data.honor.kind === 'milestone' ? (
            <>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#22d3ee', marginBottom: 10 }}>
                🏅 VINH DANH ĐẠT MỐC HUY HIỆU & KỶ LỤC MỚI ({data.honor.entries.length} NGƯỜI CHƠI)
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
                {data.honor.entries.map((e) => (
                  <div
                    key={e.userId}
                    style={{
                      background: 'linear-gradient(135deg, rgba(234, 88, 12, 0.28), rgba(15, 23, 42, 0.95))',
                      border: '2px solid #fbbf24',
                      borderRadius: 14,
                      padding: '6px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Character25D template={e.template} pose="correct" size={42} showShadow={false} />
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: 14, fontWeight: 900, color: '#ffffff' }}>{e.nickname}</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#fde047' }}>
                        Cấp {e.level} · {e.tags.includes('record') ? 'Phá kỷ lục!' : 'Đạt mốc vinh danh!'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : data.honor.kind === 'keep' ? (
            <div style={{ fontSize: 23, fontWeight: 900, color: '#fde047' }}>
              ✨ {data.honor.keepCount} GHẾ NÓNG TRẢ LỜI ĐÚNG (+10Đ & +1 CẤP)
            </div>
          ) : (
            <div style={{ fontSize: 21, fontWeight: 900, color: '#67e8f9' }}>
              🌟 SÂN ĐẤU ĐÓN LƯỢT NGƯỜI CHƠI MỚI LÊN GHẾ NÓNG
            </div>
          )}
        </div>
      )}

      {/* ====================================================================
          8. BẢNG TỔNG KẾT VÒNG HOẶC KẾT THÚC PHIÊN
         ==================================================================== */}
      {(data.phase === 'ROUND_BOARD' && data.roundBoard) || (data.phase === 'ENDED' && data.finalBoard) ? (
        <div
          style={{
            position: 'absolute',
            left: 48,
            right: 48,
            top: 350,
            background: 'rgba(8, 16, 40, 0.98)',
            border: '3px solid #22d3ee',
            borderRadius: 22,
            padding: 20,
            zIndex: 35,
            boxShadow: '0 24px 60px rgba(0,0,0,0.88)',
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 900, color: '#fbbf24', textAlign: 'center', marginBottom: 12 }}>
            {data.phase === 'ENDED' ? '🏆 TỔNG KẾT PHIÊN LIVE' : '📊 BẢNG XẾP HẠNG VÒNG VỪA KẾT THÚC'}
          </div>
          {(data.phase === 'ENDED' ? data.finalBoard : data.roundBoard)?.map((r) => (
            <div
              key={r.userId}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '6px 12px',
                borderBottom: '1px solid #1e293b',
                fontSize: 15,
                fontWeight: 800,
              }}
            >
              <span>
                Hạng #{r.rank} — {r.nickname}
              </span>
              <span style={{ color: '#fde047' }}>{r.points} điểm</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Khung căn vùng an toàn TikTok (chỉ hiện khi bật kiểm tra) */}
      {showSafeGuide && (
        <div
          style={{
            position: 'absolute',
            top: safe.safeTop,
            bottom: safe.safeBottom,
            left: safe.safeLeft,
            right: safe.safeRight,
            border: '2px dashed rgba(251, 191, 36, 0.75)',
            pointerEvents: 'none',
            zIndex: 50,
          }}
        />
      )}
    </div>
  );
}
