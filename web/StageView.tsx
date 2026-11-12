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
import { audioManager, stageSfx, stageVoice } from './sound';

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
  mc: {
    id: number;
    text: string;
    at: number;
    category?:
      | 'chaoHoi'
      | 'huongDan'
      | 'moiLenGhe'
      | 'choTraLoi'
      | 'nhacGio'
      | 'congBoKetQua'
      | 'dongVien'
      | 'vinhDanh'
      | 'camOnQua';
    templateId?: string;
    durationMs?: number;
    isAux?: boolean;
  } | null;
  stageGuide?: {
    fixed: string;
    badge: string;
    text: string;
    deadlineAt: number | null;
  };
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

/**
 * Hướng dẫn trên sân khấu đồng bộ 100% với lời MC:
 * - 1 dòng cố định về cách tham gia (`fixedJoinLine`)
 * - 1 dòng thay đổi theo giai đoạn (`text` + `badge`)
 */
function getDynamicGuide(
  data: StageState,
  tickNow: number,
): { fixedJoinLine: string; badge: string; text: string } {
  const DEFAULT_JOIN_LINE =
    'CÁCH THAM GIA: Bình luận "Vào" để chơi.';
  if (data.stageGuide) {
    const invExp = data.stageGuide.deadlineAt;
    const invSec =
      invExp != null
        ? Math.max(0, Math.ceil((invExp - tickNow) / 1000))
        : data.phaseEndsAt != null
          ? Math.max(0, Math.ceil((data.phaseEndsAt - tickNow) / 1000))
          : 12;
    return {
      fixedJoinLine: data.stageGuide.fixed || DEFAULT_JOIN_LINE,
      badge: data.stageGuide.badge,
      text: data.stageGuide.text.replace(/\{sec\}/g, String(invSec)),
    };
  }
  const code = data.question?.code ?? 1;
  switch (data.phase) {
    case 'OPEN':
      return {
        fixedJoinLine: DEFAULT_JOIN_LINE,
        badge: 'CÂU HỎI MỞ',
        text: `Bình luận ${code}A · ${code}B · ${code}C · ${code}D để chọn đáp án`,
      };
    case 'PREPARE':
      return {
        fixedJoinLine: DEFAULT_JOIN_LINE,
        badge: 'SẮP MỞ CÂU HỎI',
        text: `Bình luận ${code}A · ${code}B · ${code}C · ${code}D để chọn đáp án ngay khi mở đề`,
      };
    case 'INVITING':
      return {
        fixedJoinLine: DEFAULT_JOIN_LINE,
        badge: 'MỜI LÊN GHẾ',
        text: 'Ghế Chờ tự động vào Ghế Nóng sau 12s · Gõ SS vào ngay hoặc HỦY nếu nhường',
      };
    case 'REVEAL':
    case 'HONOR':
      return {
        fixedJoinLine: DEFAULT_JOIN_LINE,
        badge: 'KẾT QUẢ & LUẬT GHẾ',
        text: 'Đúng: +10đ, giữ ghế nóng & +1 cấp · Sai: rời ghế, về cuối hàng chờ · Không trả lời: rời ghế, tắt tự xếp lại',
      };
    case 'TRANSITION':
    case 'ROUND_BOARD':
      return {
        fixedJoinLine: DEFAULT_JOIN_LINE,
        badge: 'LUẬT TÍNH THÀNH TÍCH',
        text: 'Mỗi câu đúng +10đ (cả ghế nóng & khán giả) · Giữ ghế đạt mốc cấp 3, 5, 10, 15 nhận Huy hiệu Vinh danh!',
      };
    default:
      return {
        fixedJoinLine: DEFAULT_JOIN_LINE,
        badge: 'LỆNH ĐANG DÙNG',
        text: 'Các lệnh đang được sử dụng hiện tại: VÀO · CHỜ · [Mã câu][A/B/C/D] · SS · HỦY · NHƯỜNG · ĐIỂM · VỊ TRÍ',
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
  const [audioSuspended, setAudioSuspended] = useState(false);
  const isSpeaker = !mute && (!data?.speakerId || data.speakerId === myStageId || (data?.stageCount ?? 0) <= 1);

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

    const checkSuspended = () => {
      setAudioSuspended(audioManager.isSuspended());
    };
    checkSuspended();
    window.addEventListener('pointerdown', checkSuspended, { passive: true });
    window.addEventListener('keydown', checkSuspended, { passive: true });
    const timer = setInterval(checkSuspended, 1200);

    return () => {
      stageVoice.onSpeakingChange = undefined;
      window.removeEventListener('pointerdown', checkSuspended);
      window.removeEventListener('keydown', checkSuspended);
      clearInterval(timer);
      audioManager.stopAll();
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
    const isSpeaker = !mute && (!data.speakerId || data.speakerId === myStageId || (data.stageCount ?? 0) <= 1);
    stageVoice.enabled = isSpeaker && Boolean(data.display.ttsEnabled);
    stageSfx.enabled = isSpeaker && sfxAllowed;
    audioManager.setSpeakerAllowed(isSpeaker);

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
        if (stageSfx.enabled) {
          if (data.phase === 'REVEAL') {
            const hasAnyCorrect = data.seats.some((s) => s.occupant?.result === 'correct');
            audioManager.handleRevealPhase(fxKey, hasAnyCorrect);
          } else if (data.phase === 'HONOR') {
            audioManager.playSfx('honor');
          } else {
            stageSfx.playPhase(data.phase);
          }
        }
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
      if (stageSfx.enabled) {
        if (data.phase === 'REVEAL') {
          const hasAnyCorrect = data.seats.some((s) => s.occupant?.result === 'correct');
          audioManager.handleRevealPhase(fxKey, hasAnyCorrect);
        } else if (data.phase === 'HONOR') {
          audioManager.playSfx('honor');
        } else {
          stageSfx.playPhase(data.phase);
        }
      }
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
        if (stageSfx.enabled) {
          audioManager.playSfx('seat');
        }
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

  // Nhạc nền suy nghĩ nhẹ trong khoảng lặng khi mở câu hỏi (còn > 5s), tự động giảm nhỏ khi MC đang nói
  const isMcLineActive = Boolean(
    data?.mc &&
      tickNow - data.mc.at >= -500 &&
      tickNow - data.mc.at < (data.mc.durationMs ?? 4000),
  );
  useEffect(() => {
    if (!data) return;
    const isMcActive = Boolean(mcSpeaking || isMcLineActive);
    audioManager.setGameState(data.phase, remainSec, isMcActive);
  }, [data?.phase, remainSec, mcSpeaking, isMcLineActive]);

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
  const guide = getDynamicGuide(data, tickNow);

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
        background: 'radial-gradient(ellipse at 50% 12%, #18336d 0%, #0a1738 48%, #030714 100%)',
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
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.38" />
            <stop offset="60%" stopColor="#f59e0b" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </linearGradient>
          {/* Chùm đèn xanh ngọc khi đang ngồi ghế nóng */}
          <linearGradient id="spotCyan" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.42" />
            <stop offset="65%" stopColor="#06b6d4" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
          </linearGradient>
          {/* Chùm đèn Spotlight RỰC RỠ chiếu thẳng vào ghế nóng trả lời ĐÚNG */}
          <linearGradient id="spotVictory" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fef08a" stopOpacity="0.85" />
            <stop offset="35%" stopColor="#fbbf24" stopOpacity="0.5" />
            <stop offset="75%" stopColor="#22d3ee" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
          {/* Mặt sàn trường quay 2.5D phản chiếu ánh đèn studio */}
          <radialGradient id="gameshowFloor" cx="50%" cy="46%" r="54%">
            <stop offset="0%" stopColor="#1e40af" stopOpacity="0.9" />
            <stop offset="45%" stopColor="#112558" stopOpacity="0.95" />
            <stop offset="85%" stopColor="#071129" stopOpacity="0.98" />
            <stop offset="100%" stopColor="#030715" stopOpacity="1" />
          </radialGradient>
          {/* Bục ghế chờ VIP */}
          <linearGradient id="waitingPodiumGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0e2a5c" stopOpacity="0.96" />
            <stop offset="100%" stopColor="#071228" stopOpacity="0.98" />
          </linearGradient>
        </defs>

        {/* Giàn khung thép sân khấu Gameshow (Studio Lighting Truss) */}
        <path d="M 0 10 L 720 10 M 0 22 L 720 22" stroke="#1e293b" strokeWidth="3" opacity="0.85" />
        {Array.from({ length: 24 }).map((_, i) => (
          <line
            key={`truss_${i}`}
            x1={i * 30}
            y1={10}
            x2={i * 30 + 15}
            y2={22}
            stroke="#334155"
            strokeWidth="1.5"
            opacity="0.6"
          />
        ))}

        {/* Vòm ánh sáng trường quay phía trên (Studio Dome Glow) */}
        <ellipse cx="360" cy="38" rx="350" ry="60" fill="rgba(34, 211, 238, 0.14)" />
        <ellipse cx="360" cy="18" rx="280" ry="24" fill="rgba(251, 191, 36, 0.08)" />

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
                points={`${cx - 16},22 ${cx + 16},22 ${cx + 70},645 ${cx - 70},645`}
                fill={beamFill}
              />
              {/* Đèn pha trên giàn trần với thấu kính phát sáng */}
              <rect x={cx - 16} y={12} width={32} height={12} rx={4} fill="#0f172a" stroke="#475569" strokeWidth="1.5" />
              <ellipse
                cx={cx}
                cy={22}
                rx={13}
                ry={4}
                fill={isSeatCorrect ? '#fef08a' : hasOccupant ? '#22d3ee' : '#fbbf24'}
                filter="drop-shadow(0 0 6px rgba(251, 191, 36, 0.8))"
              />
              {/* Hào quang rực sáng dưới sàn khi ghế nóng trả lời ĐÚNG */}
              {isSeatCorrect && (
                <g>
                  <ellipse
                    cx={cx}
                    cy={612}
                    rx={64}
                    ry={20}
                    fill="rgba(251, 191, 36, 0.45)"
                    stroke="#fde047"
                    strokeWidth="2.5"
                  />
                  <ellipse
                    cx={cx}
                    cy={612}
                    rx={42}
                    ry={12}
                    fill="rgba(254, 240, 138, 0.35)"
                  />
                </g>
              )}
            </g>
          );
        })}

        {/* Sàn sân khấu chính hình elip đồng tâm 2.5D */}
        <ellipse cx="360" cy="614" rx="352" ry="90" fill="url(#gameshowFloor)" stroke="#06b6d4" strokeWidth="2.8" strokeOpacity="0.75" />
        <ellipse cx="360" cy="614" rx="312" ry="68" fill="none" stroke="#fbbf24" strokeWidth="2" strokeDasharray="12 6" strokeOpacity="0.65" />
        <ellipse cx="360" cy="614" rx="260" ry="48" fill="none" stroke="rgba(34, 211, 238, 0.35)" strokeWidth="1.5" />

        {/* Khán đài hình chữ U 2.5D bao quanh sân khấu (2 cánh + đáy vòng cung) */}
        <path
          d="M 8 740 L 88 740 L 88 976 Q 360 1040 632 976 L 632 740 L 712 740 L 712 1142 Q 360 1218 8 1142 Z"
          fill="rgba(6, 12, 30, 0.94)"
          stroke="#06b6d4"
          strokeWidth="2"
          strokeOpacity="0.5"
        />
        {/* Đường bậc thềm khán đài chữ U */}
        <path
          d="M 16 995 Q 360 1068 704 995"
          fill="none"
          stroke="rgba(251, 191, 36, 0.32)"
          strokeWidth="1.6"
          strokeDasharray="6 6"
        />
        <path
          d="M 16 1052 Q 360 1126 704 1052"
          fill="none"
          stroke="rgba(34, 211, 238, 0.28)"
          strokeWidth="1.6"
          strokeDasharray="6 6"
        />

        {/* Bậc thềm trung tâm dành cho 10 Ghế Chờ (2 hàng × 5 ghế) */}
        <path
          d="M 52 742 L 668 742 L 678 940 L 42 940 Z"
          fill="url(#waitingPodiumGrad)"
          stroke="#22d3ee"
          strokeWidth="2"
          strokeOpacity="0.6"
        />
        <line x1="54" y1="744" x2="666" y2="744" stroke="#38bdf8" strokeWidth="2" strokeOpacity="0.8" />
      </svg>

      {/* ====================================================================
          1. PHÍA TRÊN: Tên game nhỏ gọn, Vòng chơi & Bảng xếp hạng Top 5
         ==================================================================== */}
      <div
        style={{
          position: 'absolute',
          top: Math.max(16, safe.safeTop),
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
            background: 'linear-gradient(135deg, rgba(8, 16, 42, 0.96) 0%, rgba(15, 30, 72, 0.94) 100%)',
            border: '2px solid #f97316',
            borderRadius: 14,
            padding: '7px 14px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.1)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            minWidth: 220,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontSize: 21,
                fontWeight: 900,
                letterSpacing: 0.6,
                color: '#fbbf24',
                textShadow: '0 2px 8px rgba(251, 191, 36, 0.5)',
              }}
            >
              🔥 GHẾ NÓNG
            </span>
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 900,
                background: 'linear-gradient(90deg, #0284c7, #0e7490)',
                color: '#ecfeff',
                padding: '2px 8px',
                borderRadius: 99,
                border: '1px solid #38bdf8',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span
                className="anim-live-dot"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#ef4444',
                  display: 'inline-block',
                }}
              />
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
              letterSpacing: 0.4,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ color: '#fbbf24', fontSize: 10 }}>▶</span>
            {PHASE_LABELS[data.phase] ?? data.phase}
          </div>
        </div>

        {/* Bảng xếp hạng Top 5 điểm phiên rõ nét */}
        <div
          data-testid="stage-leaderboard"
          style={{
            background: 'linear-gradient(135deg, rgba(8, 16, 42, 0.96) 0%, rgba(12, 24, 60, 0.94) 100%)',
            border: '2px solid #06b6d4',
            borderRadius: 14,
            padding: '6px 12px',
            flex: 1,
            maxWidth: 440,
            boxShadow: '0 8px 24px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.08)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: '#fbbf24', letterSpacing: 0.4 }}>
              🏆 BẢNG XẾP HẠNG TOP 5
            </span>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 800,
                color: '#22d3ee',
                background: 'rgba(6, 182, 212, 0.15)',
                padding: '1px 6px',
                borderRadius: 4,
                border: '1px solid rgba(6, 182, 212, 0.3)',
              }}
            >
              Đúng +10đ/câu
            </span>
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
                    background:
                      row.rank === 1
                        ? 'linear-gradient(180deg, rgba(245, 158, 11, 0.28) 0%, rgba(15, 23, 42, 0.9) 100%)'
                        : 'rgba(15, 23, 42, 0.85)',
                    border: `1px solid ${row.rank === 1 ? '#fbbf24' : '#1e3a8a'}`,
                    borderRadius: 8,
                    padding: '3px 5px',
                    textAlign: 'center',
                    minWidth: 0,
                    boxShadow: row.rank === 1 ? '0 0 10px rgba(251, 191, 36, 0.35)' : 'none',
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
                    {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : `#${row.rank}`} {row.nickname}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 900, color: '#22d3ee' }}>{row.points}đ</div>
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
            background: 'linear-gradient(180deg, rgba(12, 24, 60, 0.96) 0%, rgba(6, 12, 32, 0.98) 100%)',
            border: `2px solid ${mcPose === '06' ? '#ef4444' : mcPose === '07' ? '#fde047' : '#fbbf24'}`,
            borderRadius: 16,
            padding: '6px 4px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 12px 28px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.1)',
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
                padding: '2px 8px',
                borderRadius: 99,
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 6px rgba(245, 158, 11, 0.4)',
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

          {/* Bục đứng MC 2.5D + Lời dẫn tình huống hiện tại (hoặc trạng thái yên tĩnh suy nghĩ) */}
          <div
            style={{
              width: '100%',
              background: 'linear-gradient(180deg, #1e3a8a 0%, #0f172a 100%)',
              border: '1.5px solid #22d3ee',
              borderRadius: 10,
              padding: '3px 6px',
              textAlign: 'center',
              overflow: 'hidden',
              boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ fontSize: 9.5, fontWeight: 900, color: '#fde047', whiteSpace: 'nowrap' }}>
              {mcPoseMeta.label.toUpperCase()}
            </div>
            <div
              data-testid="stage-mc-speech"
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#e0f2fe',
                marginTop: 1,
                lineHeight: 1.18,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                minHeight: 24,
              }}
            >
              {isMcLineActive && !isReloadedOldPhase && data.mc?.text
                ? `“${data.mc.text}”`
                : data.phase === 'OPEN'
                  ? remainSec !== null && remainSec <= 5
                    ? `⚠️ Sắp hết giờ (${remainSec}s)!`
                    : `🤫 Yên tĩnh suy nghĩ Câu #${data.question?.code}`
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
            background: 'linear-gradient(180deg, #0c1c46 0%, #050d22 100%)',
            border: '2.5px solid #22d3ee',
            borderRadius: 18,
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: '0 16px 36px rgba(0,0,0,0.75), inset 0 0 32px rgba(6, 182, 212, 0.18)',
            overflow: 'hidden',
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
                  padding: '3px 11px',
                  borderRadius: 8,
                  border: '1.5px solid #fdba74',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 2px 8px rgba(234, 88, 12, 0.45)',
                }}
              >
                {data.question ? `CÂU #${data.question.code}` : 'GHẾ NÓNG'}
              </span>
              {data.question && (
                <span
                  style={{
                    background: 'rgba(6, 182, 212, 0.2)',
                    color: '#67e8f9',
                    fontWeight: 800,
                    fontSize: 12.5,
                    padding: '3px 9px',
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
              className={data.phase === 'OPEN' && remainSec !== null && remainSec <= 5 && !reduceMotion ? 'anim-timer-alert' : undefined}
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
                padding: '3px 14px',
                boxShadow:
                  data.phase === 'OPEN' && remainSec !== null && remainSec <= 5
                    ? '0 0 20px rgba(239, 68, 68, 0.8)'
                    : '0 0 16px rgba(251, 191, 36, 0.4)',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 800, color: '#fde68a' }}>⏱️</span>
              <span style={{ fontSize: 23, fontWeight: 900, color: '#ffffff', lineHeight: 1 }}>
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
                    lineHeight: 1.22,
                    color: '#ffffff',
                    margin: '3px 0',
                    textShadow: '0 1px 3px rgba(0,0,0,0.6)',
                  }}
                >
                  {data.question.text}
                </div>

                {/* 4 lựa chọn A, B, C, D — tự động điều chỉnh cỡ chữ khi đáp án dài, không cắt chữ */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {(['A', 'B', 'C', 'D'] as const).map((letter, idx) => {
                    const rawChoice = data.question?.choices?.[idx] ?? '';
                    const isCorrect = data.reveal?.correct === letter;
                    const choiceFontSize =
                      rawChoice.length > 55 ? 11.2 : rawChoice.length > 38 ? 12.2 : rawChoice.length > 24 ? 13.8 : 15.2;
                    return (
                      <div
                        key={letter}
                        data-testid={`choice-${letter}`}
                        style={{
                          background: isCorrect
                            ? 'linear-gradient(135deg, #059669 0%, #047857 100%)'
                            : 'linear-gradient(135deg, rgba(15, 23, 42, 0.96) 0%, rgba(30, 41, 62, 0.92) 100%)',
                          border: isCorrect ? '2.5px solid #fde047' : '1.8px solid #0891b2',
                          borderRadius: 12,
                          padding: '5px 8px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 7,
                          minHeight: data.reveal ? 45 : 50,
                          boxShadow: isCorrect
                            ? '0 0 22px rgba(251, 191, 36, 0.5), inset 0 1px 0 rgba(255,255,255,0.2)'
                            : '0 4px 10px rgba(0,0,0,0.3)',
                          transition: 'all 200ms ease',
                        }}
                      >
                        <span
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            background: isCorrect
                              ? 'linear-gradient(135deg, #fef08a, #fbbf24)'
                              : 'linear-gradient(135deg, #f97316, #ea580c)',
                            color: isCorrect ? '#090d1b' : '#ffffff',
                            fontWeight: 900,
                            fontSize: 14,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
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
                <div style={{ fontSize: 24, fontWeight: 900, color: '#fbbf24', textShadow: '0 2px 10px rgba(251, 191, 36, 0.4)' }}>
                  CHUẨN BỊ CÂU #{data.question.code}
                </div>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: '#e2e8f0', marginTop: 6 }}>
                  Chủ đề: <b style={{ color: '#22d3ee' }}>{data.question.topic}</b> · Mở đề sau {remainSec ?? 7} giây!
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
              <div style={{ fontSize: 21, fontWeight: 900, color: '#fbbf24', textShadow: '0 2px 8px rgba(251, 191, 36, 0.4)' }}>
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

          {/* Giải thích đáp án ngắn gọn khi công bố kết quả */}
          {data.reveal && (
            <div
              data-testid="question-explanation"
              style={{
                marginTop: 2,
                padding: '3px 10px',
                borderRadius: 8,
                background: 'linear-gradient(90deg, rgba(5, 150, 105, 0.4) 0%, rgba(4, 120, 87, 0.3) 100%)',
                border: '1.5px solid #34d399',
                fontSize: 11.5,
                color: '#ecfdf5',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}
            >
              ✅ Đáp án {data.reveal.correct}: {data.reveal.explanation} ({data.reveal.totalCorrect}/
              {data.reveal.totalAnswers} đúng)
            </div>
          )}

          {/* Khung hướng dẫn 2 dòng đồng bộ với lời MC:
              - Dòng 1 cố định: Cách tham gia & hệ thống lệnh
              - Dòng 2 thay đổi theo giai đoạn: Mới vào / Mở câu hỏi / Mời lên ghế / Công bố kết quả / Chuyển vòng */}
          <div
            data-testid="command-guide-box"
            style={{
              marginTop: 2,
              padding: '4px 10px',
              borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.96) 0%, rgba(10, 18, 36, 0.98) 100%)',
              border: '1.5px solid #fbbf24',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}
          >
            {/* Dòng 1 cố định: Cách tham gia */}
            <div
              data-testid="guide-fixed-line"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  background: 'linear-gradient(90deg, #0284c7, #0e7490)',
                  color: '#ecfeff',
                  fontSize: 9.2,
                  fontWeight: 900,
                  padding: '1px 6px',
                  borderRadius: 4,
                  border: '1px solid #22d3ee',
                  flexShrink: 0,
                }}
              >
                CÁCH THAM GIA
              </span>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: '#cbd5e1',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {guide.fixedJoinLine.replace(/^CÁCH THAM GIA:\s*/i, '')}
              </span>
            </div>

            {/* Dòng 2 thay đổi theo giai đoạn */}
            <div
              data-testid="guide-dynamic-line"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                minWidth: 0,
              }}
            >
              <span
                data-testid="guide-dynamic-badge"
                style={{
                  background: 'linear-gradient(90deg, #f59e0b, #fbbf24)',
                  color: '#090d1b',
                  fontSize: 9.8,
                  fontWeight: 900,
                  padding: '1px 6px',
                  borderRadius: 4,
                  flexShrink: 0,
                }}
              >
                {guide.badge}
              </span>
              <span
                data-testid="guide-dynamic-text"
                style={{
                  fontSize: 11.5,
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
          </div>
        </div>
      </div>

      {/* ====================================================================
          3. PHÍA DƯỚI MÀN HÌNH: THÔNG BÁO SỰ KIỆN / QUÀ TẶNG (NẰM GIỮA BẢNG CÂU HỎI VÀ 5 GHẾ NÓNG)
         ==================================================================== */}
      {data.notices.length > 0 && (
        <div
          data-testid="stage-notices-toast"
          style={{
            position: 'absolute',
            left: 36,
            right: 36,
            top: Math.max(96, safe.safeTop + 74) + 348,
            display: 'flex',
            justifyContent: 'center',
            gap: 8,
            flexWrap: 'wrap',
            pointerEvents: 'none',
            zIndex: 25,
          }}
        >
          {data.notices.slice(0, 2).map((n) => (
            <div
              key={n.id}
              style={{
                background:
                  n.kind === 'gift'
                    ? 'linear-gradient(90deg, rgba(234, 88, 12, 0.96) 0%, rgba(180, 83, 9, 0.96) 100%)'
                    : 'linear-gradient(90deg, rgba(8, 20, 50, 0.96) 0%, rgba(12, 32, 76, 0.96) 100%)',
                border: `2px solid ${n.kind === 'gift' ? '#fbbf24' : '#22d3ee'}`,
                borderRadius: 99,
                padding: '4px 16px',
                fontSize: 12.5,
                fontWeight: 800,
                color: '#ffffff',
                boxShadow: n.kind === 'gift' ? '0 6px 20px rgba(234, 88, 12, 0.55)' : '0 6px 18px rgba(0,0,0,0.65)',
              }}
            >
              {n.text}
            </div>
          ))}
        </div>
      )}

      {/* ====================================================================
          3. PHÍA DƯỚI MÀN HÌNH: ĐÚNG 5 GHẾ NÓNG ĐỎ CAM (Ghế + Nhân vật + Số ghế + Tên + Điểm + Cấp bậc)
         ==================================================================== */}
      <div
        data-testid="hot-seats-row"
        style={{
          position: 'absolute',
          left: 14,
          right: 14,
          top: 462,
          height: 270,
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
                      boxShadow: '0 0 14px rgba(251, 191, 36, 0.7)',
                    }}
                  >
                    ✨ +10Đ · +1 CẤP
                  </span>
                )}
                {visualState === 'wrong' && (
                  <span
                    style={{
                      background: 'linear-gradient(90deg, #ef4444, #dc2626)',
                      color: '#ffffff',
                      fontSize: 11,
                      fontWeight: 900,
                      padding: '2px 8px',
                      borderRadius: 99,
                      border: '1px solid #fca5a5',
                      boxShadow: '0 2px 8px rgba(239, 68, 68, 0.45)',
                    }}
                  >
                    {occ?.result === 'none' || dep?.result === 'none' ? '⏰ HẾT GIỜ' : '✗ RỚT GHẾ'}
                  </span>
                )}
                {visualState === 'locked' && (
                  <span
                    style={{
                      background: 'linear-gradient(90deg, #0284c7, #0891b2)',
                      color: '#ecfeff',
                      fontSize: 10.5,
                      fontWeight: 900,
                      padding: '2px 8px',
                      borderRadius: 99,
                      border: '1px solid #67e8f9',
                      boxShadow: '0 2px 8px rgba(8, 145, 178, 0.45)',
                    }}
                  >
                    🔒 ĐÃ KHÓA ĐÁP ÁN
                  </span>
                )}
                {visualState === 'inviting' && (
                  <span
                    style={{
                      background: 'linear-gradient(90deg, #f59e0b, #fbbf24)',
                      color: '#090d1b',
                      fontSize: 10.5,
                      fontWeight: 900,
                      padding: '2px 8px',
                      borderRadius: 99,
                      boxShadow: '0 2px 8px rgba(251, 191, 36, 0.5)',
                    }}
                  >
                    ⏳ ĐANG MỜI ({invRemain}s)
                  </span>
                )}
                {visualState === 'playing' && (
                  <span
                    style={{
                      background: 'linear-gradient(90deg, rgba(249, 115, 22, 0.35), rgba(234, 88, 12, 0.35))',
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
                    ? 'linear-gradient(180deg, rgba(15, 23, 42, 0.96) 0%, rgba(8, 13, 30, 0.98) 100%)'
                    : 'rgba(9, 13, 30, 0.88)',
                  border: `2px solid ${cardBorder}`,
                  borderRadius: 12,
                  padding: '5px 5px',
                  textAlign: 'center',
                  boxShadow: occ ? `0 8px 20px rgba(0,0,0,0.7), 0 0 12px ${cardBorder}44` : 'none',
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
                    background: occ ? 'rgba(6, 182, 212, 0.18)' : 'rgba(30, 41, 59, 0.45)',
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
          left: 56,
          right: 56,
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
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 800,
              color: '#fde68a',
              background: 'rgba(245, 158, 11, 0.15)',
              padding: '1px 7px',
              borderRadius: 6,
              border: '1px solid rgba(245, 158, 11, 0.35)',
              whiteSpace: 'nowrap',
            }}
          >
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
            background: 'linear-gradient(90deg, rgba(8, 16, 42, 0.96) 0%, rgba(15, 30, 72, 0.96) 100%)',
            border: '1.5px solid #06b6d4',
            borderRadius: 99,
            padding: '5px 18px',
            fontSize: 12,
            fontWeight: 800,
            color: '#e0f2fe',
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 16px rgba(0,0,0,0.65)',
          }}
        >
          🏟️ KHÁN ĐÀI CHỮ U: {Math.min(data.audience.length, U_STAND_SLOTS.length)}/{U_STAND_SLOTS.length} ghế khán giả
          {data.audienceTotal > 15 + U_STAND_SLOTS.length
            ? ` · +${data.audienceTotal - (15 + U_STAND_SLOTS.length)} người đang chơi chờ ghế trống`
            : ` · Tổng ${data.audienceTotal} người đang tham gia`}
        </div>
      </div>

      {/* ====================================================================
          7. HIỆU ỨNG VINH DANH GIỮA MÀN HÌNH TRONG 3 GIÂY (Gộp nhiều người cùng lúc)
         ==================================================================== */}
      {data.phase === 'HONOR' && data.honor && (
        <div
          data-testid="honor-overlay"
          className={isFreshReward ? 'anim-honor' : undefined}
          style={{
            position: 'absolute',
            left: 200,
            right: 18,
            top: 164,
            background: 'linear-gradient(135deg, rgba(8, 16, 42, 0.98) 0%, rgba(24, 38, 88, 0.98) 100%)',
            border: '3px solid #fbbf24',
            borderRadius: 20,
            padding: '16px 18px',
            textAlign: 'center',
            boxShadow: '0 24px 60px rgba(0,0,0,0.92), 0 0 40px rgba(251, 191, 36, 0.55)',
            zIndex: 30,
            pointerEvents: 'none',
          }}
        >
          {data.honor.allFloor && (
            <div style={{ fontSize: 23, fontWeight: 900, color: '#fde047', marginBottom: 6, textShadow: '0 2px 10px rgba(251, 191, 36, 0.6)' }}>
              🔥 CẢ 5 GHẾ NÓNG CÙNG THẮNG! 🔥
            </div>
          )}
          {data.honor.kind === 'milestone' ? (
            <>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#22d3ee', marginBottom: 10, letterSpacing: 0.3 }}>
                🏅 VINH DANH ĐẠT MỐC HUY HIỆU & KỶ LỤC MỚI ({data.honor.entries.length} NGƯỜI CHƠI)
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
                {data.honor.entries.map((e) => (
                  <div
                    key={e.userId}
                    style={{
                      background: 'linear-gradient(135deg, rgba(234, 88, 12, 0.32) 0%, rgba(15, 23, 42, 0.96) 100%)',
                      border: '2px solid #fbbf24',
                      borderRadius: 14,
                      padding: '6px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
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
            <div style={{ fontSize: 23, fontWeight: 900, color: '#fde047', textShadow: '0 2px 10px rgba(251, 191, 36, 0.5)' }}>
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
            background: 'linear-gradient(135deg, rgba(8, 16, 42, 0.98) 0%, rgba(15, 30, 72, 0.98) 100%)',
            border: '3px solid #22d3ee',
            borderRadius: 22,
            padding: 22,
            zIndex: 35,
            boxShadow: '0 24px 60px rgba(0,0,0,0.9), 0 0 30px rgba(6, 182, 212, 0.35)',
          }}
        >
          <div style={{ fontSize: 23, fontWeight: 900, color: '#fbbf24', textAlign: 'center', marginBottom: 14, textShadow: '0 2px 10px rgba(251, 191, 36, 0.5)' }}>
            {data.phase === 'ENDED' ? '🏆 TỔNG KẾT PHIÊN LIVE' : '📊 BẢNG XẾP HẠNG VÒNG VỪA KẾT THÚC'}
          </div>
          {(data.phase === 'ENDED' ? data.finalBoard : data.roundBoard)?.map((r) => (
            <div
              key={r.userId}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '7px 14px',
                borderBottom: '1px solid #1e293b',
                fontSize: 15,
                fontWeight: 800,
              }}
            >
              <span>
                {r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `#${r.rank}`} {r.nickname}
              </span>
              <span style={{ color: '#fde047', fontWeight: 900 }}>{r.points} điểm</span>
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

      {/* Nút mở khóa âm thanh nếu trình duyệt yêu cầu cử chỉ bấm lần đầu */}
      {audioSuspended && isSpeaker && !mute && (
        <button
          data-testid="stage-audio-unlock-btn"
          onClick={() => {
            void audioManager.resumeContext();
            setAudioSuspended(audioManager.isSuspended());
          }}
          style={{
            position: 'absolute',
            bottom: 14,
            right: 14,
            zIndex: 9999,
            background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
            border: '2px solid #38bdf8',
            color: '#ffffff',
            borderRadius: 999,
            padding: '7px 16px',
            fontSize: 12.5,
            fontWeight: 900,
            cursor: 'pointer',
            boxShadow: '0 6px 20px rgba(0,0,0,0.7), 0 0 15px rgba(56, 189, 248, 0.4)',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
          }}
        >
          <span style={{ fontSize: 16 }}>🔊</span>
          <span>Bấm vào đây để BẬT ÂM THANH sân khấu</span>
        </button>
      )}

      {/* Cảnh báo im lặng: cửa sổ này KHÔNG phải người phát tiếng vì có cửa sổ sân khấu khác chiếm quyền */}
      {!isSpeaker && !mute && (
        <div
          data-testid="stage-muted-note"
          style={{
            position: 'absolute',
            bottom: 14,
            right: 14,
            zIndex: 9998,
            background: 'rgba(15, 23, 42, 0.88)',
            border: '1.5px solid #64748b',
            color: '#cbd5e1',
            borderRadius: 10,
            padding: '6px 12px',
            fontSize: 11.5,
            fontWeight: 700,
            maxWidth: 320,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span style={{ fontSize: 14 }}>🔈</span>
          <span>Tab này đang TẮT TIẾNG vì có cửa sổ Sân khấu khác đang phát tiếng (chỉ 1 cửa sổ phát để tránh vang dội). Đóng cửa sổ kia để chuyển quyền phát.</span>
        </div>
      )}
    </div>
  );
}
