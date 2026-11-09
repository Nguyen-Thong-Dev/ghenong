import React, { useEffect, useRef, useState } from 'react';
import { Character25D, type CharacterPose } from './Character25D';
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
  display: { safeTop: number; safeBottom: number; safeLeft: number; safeRight: number; ttsEnabled: boolean };
  shortRules: string;
  timings: { openMs: number; inviteConfirmMs: number };
  speakerId?: string | null;
  stageCount?: number;
}

const PHASE_LABELS: Record<string, string> = {
  NO_SESSION: 'CHỜ BẮT ĐẦU PHIÊN',
  STANDBY: 'MÀN HÌNH CHỜ',
  PAUSED: 'TẠM DỪNG',
  TRANSITION: 'CHUYỂN GHẾ',
  INVITING: 'ĐẨY LÊN GHẾ NÓNG (12S)',
  PREPARE: 'CHUẨN BỊ CÂU HỎI',
  OPEN: 'ĐANG NHẬN ĐÁP ÁN',
  REVEAL: 'CÔNG BỐ ĐÁP ÁN',
  HONOR: 'VINH DANH GHẾ NÓNG',
  ROUND_BOARD: 'TỔNG KẾT HIỆP',
  NO_QUESTIONS: 'NGHỈ GIỮA GIỜ',
  ENDED: 'KẾT THÚC PHIÊN LIVE',
};

/** Khung co giãn đúng tỉ lệ 720 × 1280 (9:16) */
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

/** Tọa độ khán đài hình chữ U (40 vị trí cố định bao quanh 2 cánh và đáy chữ U) */
const U_STAND_SLOTS: { x: number; y: number }[] = (() => {
  const slots: { x: number; y: number }[] = [];
  // Cánh trái chữ U (10 chỗ)
  for (let i = 0; i < 10; i++) {
    slots.push({ x: 22 + (i % 2) * 26, y: 740 + Math.floor(i / 2) * 48 });
  }
  // Cánh phải chữ U (10 chỗ)
  for (let i = 0; i < 10; i++) {
    slots.push({ x: 672 + (i % 2) * 26, y: 740 + Math.floor(i / 2) * 48 });
  }
  // Đáy vòng cung chữ U (20 chỗ)
  for (let i = 0; i < 20; i++) {
    const col = i % 10;
    const row = Math.floor(i / 10);
    const arcY = Math.round(Math.sin((col / 9) * Math.PI) * 16);
    slots.push({ x: 96 + col * 58, y: 952 + row * 38 + arcY });
  }
  return slots;
})();

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
  const prevPhaseRef = useRef<string>('');

  useEffect(() => {
    if (!data) return;
    setNowOffset(data.serverNow - Date.now());
    const isSpeaker = Boolean(myStageId && data.speakerId === myStageId && !mute && data.display.ttsEnabled);
    stageVoice.enabled = isSpeaker;
    stageSfx.enabled = isSpeaker;
    stageVoice.speakMcLine(data.mc, isSpeaker);
    if (data.phase !== prevPhaseRef.current) {
      prevPhaseRef.current = data.phase;
      if (isSpeaker) stageSfx.playPhase(data.phase);
    }
  }, [data, myStageId, mute]);

  useEffect(() => {
    const t = setInterval(() => setTickNow(Date.now() + nowOffset), 100);
    return () => clearInterval(t);
  }, [nowOffset]);

  if (!data) {
    return (
      <div
        style={{
          width: STAGE_W,
          height: STAGE_H,
          background: '#090d1e',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
          fontWeight: 700,
          color: '#fbbf24',
        }}
      >
        Đang đồng bộ trạng thái từ máy chủ GHẾ NÓNG...
      </div>
    );
  }

  const remainSec = data.phaseEndsAt ? Math.max(0, Math.ceil((data.phaseEndsAt - tickNow) / 1000)) : null;
  const safe = data.display;

  return (
    <div
      data-testid="stage-root"
      style={{
        width: STAGE_W,
        height: STAGE_H,
        position: 'relative',
        background: 'radial-gradient(ellipse at 50% 18%, #1e295b 0%, #0b1026 55%, #050814 100%)',
        color: '#f8fafc',
        overflow: 'hidden',
      }}
    >
      {/* Phối cảnh sân khấu 2.5D: luồng đèn Spotlight và mặt sàn elip đồng tâm */}
      <svg
        width={STAGE_W}
        height={STAGE_H}
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        <defs>
          <linearGradient id="spotBeam" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="spotBeamHot" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.26" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="stageFloor" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#1e3a8a" stopOpacity="0.65" />
            <stop offset="65%" stopColor="#0f172a" stopOpacity="0.88" />
            <stop offset="100%" stopColor="#020617" stopOpacity="0.98" />
          </radialGradient>
        </defs>

        {/* 5 chùm đèn chiếu xuống 5 ghế nóng */}
        {[95, 228, 360, 492, 625].map((cx, idx) => (
          <polygon
            key={idx}
            points={`${cx - 18},0 ${cx + 18},0 ${cx + 68},690 ${cx - 68},690`}
            fill={data.seats[idx]?.occupant ? 'url(#spotBeamHot)' : 'url(#spotBeam)'}
          />
        ))}

        {/* Khán đài chữ U phối cảnh 2.5D */}
        <path
          d="M 14 710 L 82 710 L 82 955 Q 360 1035 638 955 L 638 710 L 706 710 L 706 1015 Q 360 1105 14 1015 Z"
          fill="rgba(15, 23, 42, 0.85)"
          stroke="rgba(56, 189, 248, 0.28)"
          strokeWidth="2"
        />

        {/* Sàn sân đấu chính 2.5D */}
        <ellipse cx="360" cy="645" rx="342" ry="96" fill="url(#stageFloor)" stroke="#38bdf8" strokeWidth="2.5" strokeOpacity="0.5" />
        <ellipse cx="360" cy="645" rx="285" ry="72" fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="8 6" strokeOpacity="0.45" />

        {/* Bậc thềm 10 ghế chờ */}
        <path
          d="M 86 735 L 634 735 L 656 925 L 64 925 Z"
          fill="rgba(15, 23, 42, 0.88)"
          stroke="rgba(148, 163, 184, 0.35)"
          strokeWidth="2"
        />
      </svg>

      {/* Vùng an toàn hiển thị nội dung chính */}
      <div
        style={{
          position: 'absolute',
          top: safe.safeTop,
          bottom: safe.safeBottom,
          left: safe.safeLeft,
          right: safe.safeRight,
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: 'none',
        }}
      >
        {/* 1. THANH ĐẦU SÂN KHẤU: Tên game, Hiệp, Đồng hồ, Top 5 Bảng xếp hạng */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          {/* Cụm thương hiệu & trạng thái */}
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,41,59,0.92))',
              border: '2px solid #f59e0b',
              borderRadius: 16,
              padding: '8px 14px',
              boxShadow: '0 8px 20px rgba(0,0,0,0.5)',
              minWidth: 230,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 24, fontWeight: 900, letterSpacing: 1, color: '#fbbf24' }}>🔥 GHẾ NÓNG</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  background: '#1e293b',
                  color: '#93c5fd',
                  padding: '2px 7px',
                  borderRadius: 99,
                  border: '1px solid #3b82f6',
                }}
              >
                { data.session ? `HIỆP ${data.session.round}` : 'v1.0' }
              </span>
            </div>
            <div data-testid="stage-phase" style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginTop: 2 }}>
              {PHASE_LABELS[data.phase] ?? data.phase}
            </div>
          </div>

          {/* Đồng hồ đếm ngược trung tâm */}
          <div
            data-testid="stage-timer"
            style={{
              width: 82,
              height: 82,
              borderRadius: '50%',
              background:
                data.phase === 'OPEN' && remainSec !== null && remainSec <= 5
                  ? 'radial-gradient(circle, #dc2626, #7f1d1d)'
                  : 'radial-gradient(circle, #1e293b, #0f172a)',
              border: `4px solid ${data.phase === 'OPEN' ? '#38bdf8' : '#f59e0b'}`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 22px rgba(56,189,248,0.4)',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 30, fontWeight: 900, lineHeight: 1, color: '#ffffff' }}>
              {remainSec !== null ? remainSec : '—'}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', marginTop: 2 }}>GIÂY</span>
          </div>

          {/* Bảng xếp hạng Top 5 điểm phiên gọn gàng (§9) */}
          <div
            data-testid="stage-leaderboard"
            style={{
              background: 'rgba(15, 23, 42, 0.92)',
              border: '1.5px solid rgba(56, 189, 248, 0.45)',
              borderRadius: 14,
              padding: '6px 10px',
              width: 245,
              boxShadow: '0 8px 20px rgba(0,0,0,0.45)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', marginBottom: 3, letterSpacing: 0.5 }}>
              🏆 TOP 5 ĐIỂM PHIÊN
            </div>
            {data.leaderboard.length === 0 ? (
              <div style={{ fontSize: 11, color: '#64748b' }}>Chưa có điểm — trả lời đúng +10đ</div>
            ) : (
              data.leaderboard.map((row) => (
                <div
                  key={row.userId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 11.5,
                    lineHeight: 1.35,
                    color: row.rank === 1 ? '#fde047' : '#e2e8f0',
                    fontWeight: row.rank <= 2 ? 700 : 500,
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 175 }}>
                    #{row.rank} {row.nickname}
                  </span>
                  <span style={{ fontWeight: 800 }}>{row.points}đ</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 2. KHUNG LỆNH HƯỚNG DẪN CHƠI + MÀN HÌNH CÂU HỎI & 4 LỰA CHỌN A/B/C/D */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 10, marginTop: 10, minHeight: 310 }}>
          {/* Khung hiển thị các lệnh hướng dẫn chơi (thay thế hoàn toàn MC & khung MC) */}
          <div
            data-testid="command-guide-box"
            style={{
              width: 158,
              background: 'linear-gradient(180deg, rgba(15,23,42,0.96) 0%, rgba(9,13,30,0.98) 100%)',
              border: '2px solid rgba(56, 189, 248, 0.65)',
              borderRadius: 16,
              padding: '10px 8px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '0 10px 24px rgba(0,0,0,0.55)',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 900,
                background: 'linear-gradient(90deg, #f59e0b, #fbbf24)',
                color: '#0f172a',
                padding: '4px 8px',
                borderRadius: 8,
                textAlign: 'center',
                letterSpacing: 0.3,
              }}
            >
              📋 LỆNH HƯỚNG DẪN
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6, flex: 1, justifyContent: 'center' }}>
              {[
                {
                  cmd: data.question ? `${data.question.code}A / ${data.question.code}B` : '1A / 1B / 1C / 1D',
                  desc: 'Trả lời câu hỏi (+10đ)',
                  highlight: true,
                },
                {
                  cmd: 'TỰ ĐỘNG',
                  desc: 'Vào 10 ghế chờ & đẩy lên ghế nóng (12s)',
                  highlight: false,
                },
                {
                  cmd: 'VÀO / CHỜ',
                  desc: 'Vào lại hàng ghế chờ',
                  highlight: false,
                },
                {
                  cmd: 'NHƯỜNG / HỦY',
                  desc: 'Rời ghế nóng / hàng chờ',
                  highlight: false,
                },
                {
                  cmd: 'ĐIỂM / VỊ TRÍ',
                  desc: 'Xem điểm & số ghế',
                  highlight: false,
                },
              ].map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    background: item.highlight ? 'rgba(251, 191, 36, 0.14)' : 'rgba(30, 41, 59, 0.85)',
                    border: `1px solid ${item.highlight ? 'rgba(251, 191, 36, 0.55)' : 'rgba(71, 85, 105, 0.55)'}`,
                    borderRadius: 9,
                    padding: '4px 6px',
                  }}
                >
                  <div
                    style={{
                      fontSize: 11.5,
                      fontWeight: 900,
                      color: item.highlight ? '#fde047' : '#38bdf8',
                      lineHeight: 1.2,
                    }}
                  >
                    {item.cmd}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#e2e8f0', lineHeight: 1.25, marginTop: 1 }}>
                    {item.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Màn hình LED câu hỏi lớn — rõ ràng trên điện thoại */}
          <div
            data-testid="question-board"
            style={{
              flex: 1,
              background: 'linear-gradient(180deg, #0f172a 0%, #090d1f 100%)',
              border: '2.5px solid #38bdf8',
              borderRadius: 18,
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: '0 12px 32px rgba(0,0,0,0.65), inset 0 0 24px rgba(56,189,248,0.12)',
            }}
          >
            {data.question ? (
              <>
                {/* Thanh mã câu + chủ đề + hướng dẫn cú pháp */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      data-testid="question-code"
                      style={{
                        background: '#fbbf24',
                        color: '#0f172a',
                        fontWeight: 900,
                        fontSize: 16,
                        padding: '3px 10px',
                        borderRadius: 8,
                      }}
                    >
                      CÂU #{data.question.code}
                    </span>
                    <span
                      style={{
                        background: '#1e293b',
                        color: '#7dd3fc',
                        fontWeight: 700,
                        fontSize: 13,
                        padding: '3px 9px',
                        borderRadius: 8,
                        border: '1px solid #0284c7',
                      }}
                    >
                      {data.question.topic}
                    </span>
                  </div>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: '#fde047' }}>
                    {data.phase === 'OPEN'
                      ? `Gõ: ${data.question.code}A · ${data.question.code}B · ${data.question.code}C · ${data.question.code}D`
                      : data.answeredCount != null
                        ? `${data.answeredCount} người đã trả lời`
                        : ''}
                  </span>
                </div>

                {/* Nội dung đề */}
                {data.question.text ? (
                  <>
                    <div
                      data-testid="question-text"
                      style={{
                        fontSize: 20,
                        fontWeight: 800,
                        lineHeight: 1.32,
                        color: '#ffffff',
                        margin: '8px 0',
                      }}
                    >
                      {data.question.text}
                    </div>

                    {/* 4 Lựa chọn A, B, C, D */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {(['A', 'B', 'C', 'D'] as const).map((letter, idx) => {
                        const isCorrect = data.reveal?.correct === letter;
                        const bg = isCorrect
                          ? 'linear-gradient(135deg, #059669, #047857)'
                          : 'linear-gradient(135deg, #1e293b, #0f172a)';
                        const border = isCorrect ? '2.5px solid #34d399' : '1.5px solid #334155';
                        return (
                          <div
                            key={letter}
                            data-testid={`choice-${letter}`}
                            style={{
                              background: bg,
                              border,
                              borderRadius: 12,
                              padding: '8px 10px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              minHeight: 54,
                              boxShadow: isCorrect ? '0 0 16px rgba(52,211,153,0.45)' : 'none',
                            }}
                          >
                            <span
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 8,
                                background: isCorrect ? '#ecfdf5' : '#fbbf24',
                                color: '#0f172a',
                                fontWeight: 900,
                                fontSize: 16,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                              }}
                            >
                              {data.question?.code}
                              {letter}
                            </span>
                            <span style={{ fontSize: 15.5, fontWeight: 700, color: '#f8fafc', lineHeight: 1.22 }}>
                              {data.question?.choices?.[idx] ?? ''}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Giải thích ngắn khi công bố hoặc số người đã trả lời khi đang mở */}
                    {data.reveal ? (
                      <div
                        data-testid="question-explanation"
                        style={{
                          marginTop: 6,
                          padding: '6px 10px',
                          borderRadius: 10,
                          background: 'rgba(6, 95, 70, 0.35)',
                          border: '1px solid #10b981',
                          fontSize: 13,
                          color: '#d1fae5',
                          fontWeight: 600,
                        }}
                      >
                        ✅ <b>Đáp án {data.reveal.correct}:</b> {data.reveal.explanation} ({data.reveal.totalCorrect}/
                        {data.reveal.totalAnswers} bạn trả lời đúng)
                      </div>
                    ) : (
                      <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8' }}>
                        <span>Đáp án hợp lệ đầu tiên được chốt · Đúng +10đ</span>
                        <span style={{ color: '#38bdf8', fontWeight: 700 }}>
                          Đã nhận: {data.answeredCount ?? 0} câu trả lời
                        </span>
                      </div>
                    )}
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
                    <div style={{ fontSize: 24, fontWeight: 900, color: '#fbbf24' }}>
                      CHUẨN BỊ CÂU #{data.question.code}
                    </div>
                    <div style={{ fontSize: 16, color: '#cbd5e1', marginTop: 6 }}>
                      Chủ đề: <b style={{ color: '#38bdf8' }}>{data.question.topic}</b> — Đề và 4 lựa chọn sẽ mở sau{' '}
                      {remainSec ?? 5} giây!
                    </div>
                  </div>
                )}
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
                  padding: 12,
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 900, color: '#fbbf24' }}>
                  {data.phase === 'INVITING'
                    ? '🔔 ĐANG ĐẨY NGƯỜI CHỜ LÊN GHẾ NÓNG (12 GIÂY)!'
                    : data.phase === 'NO_QUESTIONS'
                      ? '☕ ĐÃ HẾT CÂU HỎI TRONG PHIÊN — TẠM NGHỈ'
                      : data.phase === 'PAUSED'
                        ? `⏸️ ĐANG TẠM DỪNG: ${data.pauseReason || ''}`
                        : '🔥 SÂN ĐẤU GHẾ NÓNG (5 GHẾ ĐỘC LẬP)'}
                </div>
                <div style={{ fontSize: 14.5, color: '#cbd5e1', marginTop: 8, maxWidth: 460, lineHeight: 1.4 }}>
                  {data.phase === 'INVITING'
                    ? 'Người chơi từ ghế chờ tự động lên ghế nóng sau 12 giây chuẩn bị (không cần gõ SS)!'
                    : '10 ghế chờ tự động đón người chơi và đẩy lên 5 ghế nóng khi có ghế trống!'}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. SÂN ĐẤU 5 GHẾ NÓNG ĐỘC LẬP (Đánh số cố định 1–5) */}
      <div
        data-testid="hot-seats-row"
        style={{
          position: 'absolute',
          left: 16,
          right: 16,
          top: 446,
          height: 250,
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 8,
          alignItems: 'end',
          pointerEvents: 'none',
        }}
      >
        {data.seats.map((s, idx) => {
          // Phối cảnh vòng cung 2.5D: ghế giữa (3) có chiều sâu nổi bật
          const arcOffset = [14, 5, 0, 5, 14][idx] ?? 0;
          const occ = s.occupant;
          const inv = s.invite;
          const dep = s.departed;
          let pose: CharacterPose = 'idle';
          if (occ) {
            if (occ.result === 'correct') pose = 'correct';
            else if (occ.result === 'wrong' || occ.result === 'none') pose = 'wrong';
            else if (occ.answered) pose = 'answered';
            else if (data.phase === 'OPEN') pose = 'thinking';
          } else if (dep) {
            pose = 'departing';
          }

          const borderColor =
            occ?.result === 'correct'
              ? '#10b981'
              : occ?.result === 'wrong' || occ?.result === 'none'
                ? '#ef4444'
                : inv
                  ? '#fbbf24'
                  : occ
                    ? '#38bdf8'
                    : '#475569';

          const invRemain = inv ? Math.max(0, Math.ceil((inv.expiresAt - tickNow) / 1000)) : 0;

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
              {/* Trạng thái trả lời / kết quả trên đầu ghế */}
              <div style={{ minHeight: 24, marginBottom: 2 }}>
                {occ?.result === 'correct' && (
                  <span
                    style={{
                      background: '#059669',
                      color: '#ecfdf5',
                      fontSize: 11,
                      fontWeight: 900,
                      padding: '2px 8px',
                      borderRadius: 99,
                      border: '1px solid #34d399',
                    }}
                  >
                    ✓ ĐÚNG (+1 CẤP)
                  </span>
                )}
                {(occ?.result === 'wrong' || dep?.result === 'wrong') && (
                  <span
                    style={{
                      background: '#b91c1c',
                      color: '#fef2f2',
                      fontSize: 11,
                      fontWeight: 900,
                      padding: '2px 8px',
                      borderRadius: 99,
                    }}
                  >
                    ✗ RỚT GHẾ
                  </span>
                )}
                {(occ?.result === 'none' || dep?.result === 'none') && (
                  <span
                    style={{
                      background: '#7c2d12',
                      color: '#ffedd5',
                      fontSize: 11,
                      fontWeight: 900,
                      padding: '2px 8px',
                      borderRadius: 99,
                    }}
                  >
                    ⏰ HẾT GIỜ
                  </span>
                )}
                {!occ?.result && occ?.answered && (
                  <span
                    style={{
                      background: '#0369a1',
                      color: '#e0f2fe',
                      fontSize: 11,
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: 99,
                    }}
                  >
                    🔒 Đã trả lời
                  </span>
                )}
                {inv && (
                  <span
                    style={{
                      background: '#f59e0b',
                      color: '#0f172a',
                      fontSize: 11,
                      fontWeight: 900,
                      padding: '2px 8px',
                      borderRadius: 99,
                    }}
                  >
                    Lên ghế ({invRemain}s)
                  </span>
                )}
              </div>

              {/* Nhân vật trên ghế */}
              <div style={{ height: 84, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                {occ ? (
                  <Character25D template={occ.template} pose={pose} size={68} />
                ) : dep ? (
                  <Character25D template={dep.template} pose="departing" size={62} />
                ) : inv ? (
                  <div style={{ opacity: 0.72 }}>
                    <Character25D template={inv.template} pose="entering" size={62} />
                  </div>
                ) : (
                  <div
                    style={{
                      width: 54,
                      height: 54,
                      borderRadius: '50%',
                      border: '2px dashed #475569',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#64748b',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    TRỐNG
                  </div>
                )}
              </div>

              {/* Bục ghế nóng 2.5D có số ghế 1–5 cố định */}
              <div
                style={{
                  width: '100%',
                  background: occ
                    ? 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)'
                    : 'linear-gradient(180deg, rgba(30,41,59,0.65) 0%, rgba(15,23,42,0.75) 100%)',
                  border: `2.5px solid ${borderColor}`,
                  borderRadius: 14,
                  padding: '6px 5px',
                  textAlign: 'center',
                  boxShadow: occ ? `0 8px 20px rgba(0,0,0,0.6), 0 0 14px ${borderColor}44` : '0 4px 10px rgba(0,0,0,0.4)',
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 900,
                    color: '#fbbf24',
                    letterSpacing: 0.5,
                  }}
                >
                  GHẾ NÓNG {s.seat}
                </div>
                <div
                  data-testid={`hot-seat-${s.seat}-name`}
                  style={{
                    fontSize: 13.5,
                    fontWeight: 800,
                    color: occ ? '#ffffff' : inv ? '#fde047' : '#64748b',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginTop: 2,
                  }}
                >
                  {occ ? occ.name : inv ? `Lên: ${inv.name}` : dep ? `${dep.name} (rời)` : 'Đang trống'}
                </div>
                <div
                  data-testid={`hot-seat-${s.seat}-level`}
                  style={{
                    marginTop: 3,
                    fontSize: 11,
                    fontWeight: 800,
                    padding: '2px 6px',
                    borderRadius: 6,
                    background: occ ? 'rgba(56, 189, 248, 0.18)' : 'rgba(51, 65, 85, 0.35)',
                    color: occ ? '#7dd3fc' : '#94a3b8',
                  }}
                >
                  {occ ? `Cấp ${occ.level} · ${occ.title}` : inv ? `Tự vào (${invRemain}s)` : 'Cấp —'}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 4. HÀNG 10 GHẾ CHỜ TRỰC QUAN (Thể hiện rõ thứ tự 1–10) */}
      <div
        data-testid="waiting-seats-section"
        style={{
          position: 'absolute',
          left: 84,
          right: 84,
          top: 718,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 6,
            padding: '0 6px',
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 900, color: '#38bdf8', letterSpacing: 0.3, whiteSpace: 'nowrap' }}>
            ⏳ 10 GHẾ CHỜ TỰ ĐỘNG (TỰ ĐẨY LÊN GHẾ NÓNG)
          </span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#cbd5e1', whiteSpace: 'nowrap' }}>
            {data.registeredMore > 0
              ? `+${data.registeredMore} bạn đang đợi`
              : 'Tự động vào ghế trống'}
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 6,
          }}
        >
          {Array.from({ length: 10 }, (_, idx) => {
            const pos = idx + 1;
            const w = data.waiting.find((x) => x.pos === pos);
            return (
              <div
                key={pos}
                data-testid={`waiting-seat-${pos}`}
                style={{
                  background: w ? 'rgba(30, 41, 59, 0.92)' : 'rgba(15, 23, 42, 0.65)',
                  border: `1.5px solid ${w ? '#38bdf8' : '#334155'}`,
                  borderRadius: 10,
                  padding: '5px 6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  minHeight: 50,
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    background: w ? '#0284c7' : '#1e293b',
                    color: '#ffffff',
                    fontSize: 11.5,
                    fontWeight: 900,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  #{pos}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 11.5,
                      fontWeight: 700,
                      color: w ? '#f8fafc' : '#64748b',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {w ? w.name : 'Trống'}
                  </div>
                  <div style={{ fontSize: 9.5, color: w ? '#93c5fd' : '#475569' }}>
                    {w ? `Chờ lượt #${pos}` : '—'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 5. KHU KHÁN ĐÀI HÌNH CHỮ U (Vẽ tối đa 40 nhân vật, không nhồi tên gây rối mắt) */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {data.audience.slice(0, 40).map((aud, idx) => {
          const slot = U_STAND_SLOTS[idx];
          if (!slot) return null;
          return (
            <div
              key={aud.userId}
              style={{
                position: 'absolute',
                left: slot.x,
                top: slot.y,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <Character25D template={aud.template} pose="idle" size={34} />
            </div>
          );
        })}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 882,
            transform: 'translateX(-50%)',
            background: 'rgba(15, 23, 42, 0.92)',
            border: '1px solid rgba(148, 163, 184, 0.35)',
            borderRadius: 99,
            padding: '4px 16px',
            fontSize: 11.5,
            fontWeight: 700,
            color: '#cbd5e1',
            whiteSpace: 'nowrap',
          }}
        >
          🏟️ KHÁN ĐÀI CHỮ U · {data.audienceTotal} người tham gia (hiển thị {data.audience.length}/40 đại diện)
        </div>
      </div>

      {/* 6. THÔNG BÁO XẾP HÀNG (Điểm / Vị trí / Cảm ơn quà — ngoài vùng đề & đáp án) */}
      {data.notices.length > 0 && (
        <div
          style={{
            position: 'absolute',
            left: 84,
            right: 84,
            top: 1044,
            display: 'flex',
            justifyContent: 'center',
            gap: 8,
            flexWrap: 'wrap',
            pointerEvents: 'none',
          }}
        >
          {data.notices.slice(0, 2).map((n) => (
            <div
              key={n.id}
              style={{
                background:
                  n.kind === 'gift'
                    ? 'linear-gradient(90deg, rgba(180,83,9,0.95), rgba(146,64,14,0.95))'
                    : 'rgba(15, 23, 42, 0.94)',
                border: `1.5px solid ${n.kind === 'gift' ? '#fbbf24' : '#38bdf8'}`,
                borderRadius: 99,
                padding: '4px 14px',
                fontSize: 12,
                fontWeight: 700,
                color: '#f8fafc',
              }}
            >
              {n.text}
            </div>
          ))}
        </div>
      )}

      {/* 7. DÒNG LUẬT NGẮN CUỐI SÂN KHẤU (§19) */}
      <div
        style={{
          position: 'absolute',
          left: safe.safeLeft,
          right: safe.safeRight,
          bottom: Math.max(12, safe.safeBottom - 36),
          background: 'rgba(9, 13, 30, 0.92)',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          borderRadius: 10,
          padding: '6px 12px',
          fontSize: 11.5,
          lineHeight: 1.35,
          color: '#cbd5e1',
          textAlign: 'center',
          pointerEvents: 'none',
        }}
      >
        {data.shortRules}
      </div>

      {/* 8. HIỆU ỨNG VINH DANH GIỮA MÀN HÌNH TRONG 3 GIÂY (§10) */}
      {data.phase === 'HONOR' && data.honor && (
        <div
          data-testid="honor-overlay"
          className="anim-honor"
          style={{
            position: 'absolute',
            left: 44,
            right: 44,
            top: 410,
            background: 'linear-gradient(135deg, rgba(15,23,42,0.97), rgba(30,27,75,0.97))',
            border: '3px solid #fbbf24',
            borderRadius: 24,
            padding: '18px 20px',
            textAlign: 'center',
            boxShadow: '0 20px 60px rgba(0,0,0,0.85), 0 0 40px rgba(251,191,36,0.45)',
            zIndex: 30,
            pointerEvents: 'none',
          }}
        >
          {data.honor.allFloor && (
            <div style={{ fontSize: 22, fontWeight: 900, color: '#fde047', marginBottom: 6 }}>
              🔥 CẢ SÀN GIỮ GHẾ! 🔥
            </div>
          )}
          {data.honor.kind === 'milestone' ? (
            <>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#38bdf8', marginBottom: 10 }}>
                🏅 VINH DANH ĐẠT MỐC & KỶ LỤC MỚI
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap' }}>
                {data.honor.entries.map((e) => (
                  <div
                    key={e.userId}
                    style={{
                      background: 'rgba(30, 41, 59, 0.9)',
                      border: '2px solid #fbbf24',
                      borderRadius: 14,
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Character25D template={e.template} pose="correct" size={44} />
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: 14, fontWeight: 900, color: '#ffffff' }}>{e.nickname}</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#fde047' }}>
                        Cấp {e.level}{' '}
                        {e.tags.includes('record') ? '· Phá kỷ lục!' : '· Đạt mốc huy hiệu!'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : data.honor.kind === 'keep' ? (
            <div style={{ fontSize: 24, fontWeight: 900, color: '#34d399' }}>
              ✨ {data.honor.keepCount} NGƯỜI GIỮ GHẾ (+1 CẤP)
            </div>
          ) : (
            <div style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0' }}>
              🌟 Sân đấu đón lượt mới
            </div>
          )}
        </div>
      )}

      {/* 9. BẢNG TỔNG KẾT HIỆP 8 GIÂY HOẶC KẾT THÚC PHIÊN (§9) */}
      {(data.phase === 'ROUND_BOARD' && data.roundBoard) || (data.phase === 'ENDED' && data.finalBoard) ? (
        <div
          style={{
            position: 'absolute',
            left: 52,
            right: 52,
            top: 360,
            background: 'rgba(15, 23, 42, 0.97)',
            border: '3px solid #38bdf8',
            borderRadius: 22,
            padding: 20,
            zIndex: 35,
            boxShadow: '0 24px 60px rgba(0,0,0,0.85)',
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 900, color: '#fbbf24', textAlign: 'center', marginBottom: 12 }}>
            {data.phase === 'ENDED' ? '🏆 TỔNG KẾT PHIÊN LIVE' : '📊 BẢNG XẾP HẠNG HIỆP VỪA KẾT THÚC'}
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
                fontWeight: 700,
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
          }}
        />
      )}
    </div>
  );
}
