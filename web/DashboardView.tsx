import React, { useEffect, useState } from 'react';
import { StageCanvas, StageFrame, type StageState } from './StageView';
import { audioManager, type AudioSettings } from './sound';

interface SimProfile {
  userId: string;
  nickname: string;
  avatar: string;
}

interface QuestionItem {
  id: string;
  text: string;
  choices: [string, string, string, string];
  correct: 'A' | 'B' | 'C' | 'D';
  explanation: string;
  topic: string;
  difficulty: 'de' | 'vua' | 'kho';
  source?: string;
  status: 'draft' | 'approved' | 'disabled';
}

interface AdminPayload {
  public: StageState;
  state: {
    phase: string;
    phaseEndsAt: number | null;
    session: { id: string; round: number; nextCode: number; roundActiveMs: number; endRequested: boolean } | null;
    pause: { reason: string; by: string; from: string; at: number; auto: boolean } | null;
    sourceHealthy: boolean;
    config: {
      inviteConfirmMs: number;
      prepareMs: number;
      openMs: number;
      revealMs: number;
      honorMs: number;
      transitionMs: number;
    };
    canUndo: { code: number; replay: number } | null;
    noQuestionsWarning: boolean;
    inviteWave: number;
  };
  current: {
    runId: string;
    questionId: string;
    code: number;
    status: string;
    question?: QuestionItem;
    answers: { userId: string; nickname: string; choice: string; at: number }[];
  } | null;
  seats: { seat: number; userId?: string; nickname?: string; level?: number; recordAtStart?: number }[];
  queue: { pos: number; ticket: number; userId: string; nickname: string; visible: boolean }[];
  invites: { seat: number; userId: string; nickname: string; expiresAt: number; wave: number }[];
  players: {
    userId: string;
    nickname: string;
    status: string;
    autoRequeue: boolean;
    locked: boolean;
    lockReason?: string;
    bestLevelAll: number;
    badges: number[];
    totalPointsAll: number;
    session: { sessionPoints: number; roundPoints: number; correct: number; bestLevelSession: number } | null;
    seat: number | null;
    level: number | null;
  }[];
  playerCount: number;
  questions: QuestionItem[];
  remainingQuestions: number;
  log: {
    id: number;
    at: number;
    kind: string;
    userId?: string;
    nickname?: string;
    text?: string;
    accepted?: boolean;
    message: string;
  }[];
  display: {
    safeTop: number;
    safeBottom: number;
    safeLeft: number;
    safeRight: number;
    ttsEnabled: boolean;
    sfxEnabled?: boolean;
    reduceMotion?: boolean;
  };
  live: {
    isConnected: boolean;
    isConnecting: boolean;
    username: string;
    roomId: string;
    viewerCount: number;
    totalLikes: number;
    error: string;
    simMode: boolean;
  };
  simEnabled: boolean;
  simProfiles: SimProfile[];
  autoSim?: {
    enabled: boolean;
    totalPlayers: number;
    plannedForRunId: string | null;
    pendingActions: number;
    completedActions: number;
    giftsSent: number;
  };
  stageCount: number;
}

export function DashboardView() {
  const [token, setToken] = useState<string>('');
  const [admin, setAdmin] = useState<AdminPayload | null>(null);
  const [selectedSim, setSelectedSim] = useState<string>('sim_01');
  const [customText, setCustomText] = useState<string>('');
  const [feedback, setFeedback] = useState<string>('');
  const [tiktokUser, setTiktokUser] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'seats' | 'players' | 'questions' | 'logs' | 'audio'>('logs');
  const [showSafeGuide, setShowSafeGuide] = useState<boolean>(false);
  const [modReason, setModReason] = useState<string>('Vi phạm nội quy phòng live');

  // Quản lý âm thanh tập trung
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(() => audioManager.getSettings());
  const [audioSuspended, setAudioSuspended] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [dashboardAudioOn, setDashboardAudioOn] = useState<boolean>(false);

  useEffect(() => {
    const unsub = audioManager.subscribe((s) => {
      setAudioSettings(s);
    });
    const check = () => {
      setAudioSuspended(audioManager.isSuspended());
      setPreviewing(audioManager.getPreviewingSound());
    };
    check();
    const t = setInterval(check, 600);
    return () => {
      unsub();
      clearInterval(t);
    };
  }, []);

  // Form thêm câu hỏi mới
  const [newQ, setNewQ] = useState({
    id: '',
    text: '',
    cA: '',
    cB: '',
    cC: '',
    cD: '',
    correct: 'A' as 'A' | 'B' | 'C' | 'D',
    explanation: '',
    topic: 'Tổng hợp',
    difficulty: 'vua' as 'de' | 'vua' | 'kho',
  });

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    (async () => {
      try {
        const boot = await fetch('/api/admin/bootstrap').then((r) => r.json());
        if (cancelled) return;
        setToken(boot.token);
        es = new EventSource(`/api/admin/stream?token=${encodeURIComponent(boot.token)}`);
        es.addEventListener('admin', (ev) => {
          try {
            setAdmin(JSON.parse((ev as MessageEvent).data));
          } catch {}
        });
      } catch (e) {
        setFeedback(`Lỗi kết nối máy chủ: ${e}`);
      }
    })();
    return () => {
      cancelled = true;
      es?.close();
    };
  }, []);

  const callApi = async (url: string, body?: unknown) => {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: body ? JSON.stringify(body) : undefined,
      }).then((x) => x.json());
      if (r?.reason) setFeedback(`${r.accepted ? '✅' : '⛔'} ${r.reason}`);
      return r;
    } catch (e) {
      setFeedback(`⛔ Lỗi gọi API: ${e}`);
      return null;
    }
  };

  const sendSimChat = async (userId: string, text: string, extra?: { eventId?: string; late?: boolean; nickname?: string }) => {
    return callApi('/api/sim/chat', { userId, text, ...extra });
  };

  // Gửi đáp án đúng/sai cho người chơi đang chọn
  const sendSimAnswer = async (userId: string, mode: 'correct' | 'wrong' | 'dup' | 'late') => {
    const cur = admin?.current;
    const q = cur?.question;
    if (!cur || !q) {
      setFeedback('⛔ Hiện chưa có câu hỏi đang mở/chuẩn bị để gửi đáp án');
      return;
    }
    const wrongChoice = q.correct === 'A' ? 'B' : 'A';
    const choice = mode === 'correct' || mode === 'dup' || mode === 'late' ? q.correct : wrongChoice;
    const text = `${cur.code}${choice}`;
    if (mode === 'dup') {
      const dupId = `dup_${userId}_${cur.code}`;
      await sendSimChat(userId, text, { eventId: dupId });
      await sendSimChat(userId, text, { eventId: dupId });
      return;
    }
    if (mode === 'late') {
      await sendSimChat(userId, text, { late: true });
      return;
    }
    await sendSimChat(userId, text);
  };

  // Kịch bản tự động gửi bình luận cho tình huống Ghế 2 và Ghế 5 sai
  const runScenarioSeat2And5Wrong = async () => {
    const cur = admin?.current;
    const q = cur?.question;
    if (!cur || !q || admin?.state.phase !== 'OPEN') {
      setFeedback('⛔ Hãy mở câu hỏi tới giai đoạn ĐANG NHẬN ĐÁP ÁN (OPEN) trước khi bấm kịch bản trả lời');
      return;
    }
    const wrongChoice = q.correct === 'A' ? 'B' : 'A';
    for (const s of admin.seats) {
      if (!s.userId) continue;
      const isWrongSeat = s.seat === 2 || s.seat === 5;
      const choice = isWrongSeat ? wrongChoice : q.correct;
      await sendSimChat(s.userId, `${cur.code}${choice}`);
    }
    setFeedback('✅ Đã gửi bình luận: Ghế 1, 3, 4 trả lời ĐÚNG; Ghế 2 và 5 trả lời SAI. Bấm "⏩ Tua nhanh bước hiện tại" để chấm câu ngay!');
  };

  const runScenarioAll5Wrong = async () => {
    const cur = admin?.current;
    const q = cur?.question;
    if (!cur || !q || admin?.state.phase !== 'OPEN') {
      setFeedback('⛔ Hãy mở câu hỏi tới giai đoạn ĐANG NHẬN ĐÁP ÁN (OPEN) trước');
      return;
    }
    const wrongChoice = q.correct === 'A' ? 'B' : 'A';
    for (const s of admin.seats) {
      if (!s.userId) continue;
      await sendSimChat(s.userId, `${cur.code}${wrongChoice}`);
    }
    setFeedback('✅ Đã gửi bình luận: Cả 5 ghế nóng đều trả lời SAI. Bấm "⏩ Tua nhanh bước hiện tại" để chấm câu!');
  };

  const runScenarioQueue7 = async () => {
    for (let i = 1; i <= 7; i++) {
      const id = `sim_${String(i).padStart(2, '0')}`;
      await sendSimChat(id, 'vào');
    }
    setFeedback('✅ Đã đưa 7 người (sim_01..sim_07) vào hàng ghế chờ tự động');
  };

  const runScenarioConfirmAllInvites = async () => {
    if (!admin?.invites.length) {
      setFeedback('⛔ Hiện không có ai đang trong 12 giây chuẩn bị lên ghế nóng');
      return;
    }
    await callApi('/api/sim/advance-phase');
    setFeedback('✅ Đã hoàn tất 12 giây chuẩn bị: tất cả người được chọn tự động lên ghế nóng (không cần gõ SS)!');
  };

  const runScenario30AudienceCorrect = async () => {
    const cur = admin?.current;
    const q = cur?.question;
    if (!cur || !q || admin?.state.phase !== 'OPEN') {
      setFeedback('⛔ Cần ở giai đoạn ĐANG NHẬN ĐÁP ÁN (OPEN) để khán giả trả lời');
      return;
    }
    for (let i = 1; i <= 30; i++) {
      await sendSimChat(`khach_${i}`, `${cur.code}${q.correct}`, { nickname: `Khán giả #${i}` });
    }
    setFeedback('✅ 30 khán giả mới đã gửi đáp án đúng (+10đ và tự động lấp vào ghế chờ nếu trống)');
  };

  if (!admin) {
    return (
      <div style={{ padding: 32, color: '#fbbf24', fontSize: 18, fontWeight: 700 }}>
        Đang tải Bảng điều khiển GHẾ NÓNG... {feedback}
      </div>
    );
  }

  const stageUrl = `${window.location.origin}/?view=stage`;
  const obsUrl = `http://lvh.me:${window.location.port || 3008}/?view=stage`;
  const curQ = admin.current?.question;

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        gap: 14,
        padding: 12,
        background: '#060913',
        color: '#f1f5f9',
        overflow: 'hidden',
      }}
    >
      {/* CỘT TRÁI & GIỮA: ĐIỀU KHIỂN, GIẢ LẬP VÀ QUẢN TRỊ */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          overflowY: 'auto',
          paddingRight: 4,
        }}
      >
        {/* Thanh tiêu đề & Trạng thái kết nối */}
        <div
          style={{
            background: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: 14,
            padding: '10px 14px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20, fontWeight: 900, color: '#fbbf24' }}>🔥 BẢNG ĐIỀU KHIỂN — GHẾ NÓNG v1.0</span>
              <span
                data-testid="admin-phase-badge"
                style={{
                  background: '#1e293b',
                  border: '1px solid #38bdf8',
                  color: '#38bdf8',
                  fontSize: 12,
                  fontWeight: 800,
                  padding: '2px 10px',
                  borderRadius: 99,
                }}
              >
                Pha: {admin.state.phase}
              </span>
              <span
                style={{
                  background: admin.state.sourceHealthy ? 'rgba(16,185,129,0.18)' : 'rgba(239,68,68,0.2)',
                  color: admin.state.sourceHealthy ? '#34d399' : '#f87171',
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '2px 9px',
                  borderRadius: 99,
                }}
              >
                {admin.state.sourceHealthy ? '● Nguồn bình luận: Khỏe' : '● Nguồn bình luận: Mất kết nối'}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
              Link OBS / LIVE Studio (720×1280):{' '}
              <a href={stageUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8', fontWeight: 700 }}>
                {obsUrl}
              </a>{' '}
              · Đang mở {admin.stageCount} trang sân khấu · Câu hợp lệ còn lại: <b>{admin.remainingQuestions}</b>
            </div>
          </div>

          {/* Kết nối TikTok LIVE */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              value={tiktokUser}
              onChange={(e) => setTiktokUser(e.target.value)}
              placeholder="username TikTok (khi lên live)"
              style={{
                background: '#1e293b',
                border: '1px solid #334155',
                color: '#f8fafc',
                borderRadius: 8,
                padding: '6px 10px',
                fontSize: 12.5,
                width: 190,
              }}
            />
            <Btn onClick={() => callApi('/api/admin/tiktok/connect', { username: tiktokUser })} disabled={!tiktokUser.trim()}>
              Kết nối TikTok
            </Btn>
            {admin.live.isConnected && (
              <Btn tone="danger" onClick={() => callApi('/api/admin/tiktok/disconnect')}>
                Ngắt
              </Btn>
            )}
          </div>
        </div>

        {/* Thanh phản hồi tức thì */}
        {feedback && (
          <div
            data-testid="admin-feedback"
            style={{
              background: 'rgba(30, 41, 59, 0.95)',
              border: '1.5px solid #fbbf24',
              borderRadius: 10,
              padding: '7px 12px',
              fontSize: 13,
              fontWeight: 700,
              color: '#fef08a',
            }}
          >
            {feedback}
          </div>
        )}

        {/* KHỐI 1: ĐIỀU KHIỂN PHIÊN & VÒNG ĐỜI CÂU HỎI */}
        <div
          style={{
            background: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: 14,
            padding: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: '#e2e8f0' }}>
              🎛️ ĐIỀU KHIỂN PHIÊN LIVE & VÒNG ĐỜI CÂU HỎI
            </span>
            {curQ && (
              <span style={{ fontSize: 12.5, color: '#38bdf8', fontWeight: 700 }}>
                Đang ở Câu #{admin.current?.code} ({curQ.topic}) — Đáp án đúng (chỉ quản trị thấy):{' '}
                <b style={{ color: '#fde047' }}>
                  {admin.current?.code}
                  {curQ.correct}
                </b>
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Btn
              testId="btn-start-session"
              tone="primary"
              onClick={() => callApi('/api/admin/session/start')}
              disabled={Boolean(admin.state.session && admin.state.phase !== 'ENDED')}
            >
              ▶️ Bắt đầu phiên
            </Btn>
            <Btn
              testId="btn-advance-phase"
              tone="accent"
              onClick={() => callApi('/api/sim/advance-phase')}
              disabled={!admin.simEnabled}
            >
              ⏩ Tua nhanh bước hiện tại
            </Btn>
            {admin.state.phase === 'PAUSED' ? (
              <Btn testId="btn-resume" tone="primary" onClick={() => callApi('/api/admin/session/resume')}>
                ▶️ Tiếp tục
              </Btn>
            ) : (
              <Btn
                testId="btn-pause"
                tone="ghost"
                onClick={() => callApi('/api/admin/session/pause', { reason: 'Quản trị tạm dừng' })}
                disabled={!admin.state.session || admin.state.phase === 'ENDED'}
              >
                ⏸️ Tạm dừng
              </Btn>
            )}
            <Btn
              testId="btn-cancel-question"
              tone="ghost"
              onClick={() => callApi('/api/admin/question/cancel', { reason: 'Quản trị hủy câu đang mở' })}
              disabled={!['PREPARE', 'OPEN'].includes(admin.state.phase)}
            >
              🚫 Hủy câu đang mở
            </Btn>
            <Btn
              testId="btn-undo-last"
              tone="ghost"
              onClick={() => callApi('/api/admin/question/undo', { reason: 'Phát hiện câu vừa chấm có lỗi' })}
              disabled={!admin.state.canUndo}
            >
              ↩️ Hoàn tác câu vừa chấm {admin.state.canUndo ? `(#${admin.state.canUndo.code})` : ''}
            </Btn>
            <Btn
              testId="btn-end-session"
              tone="danger"
              onClick={() => callApi('/api/admin/session/end')}
              disabled={!admin.state.session || admin.state.phase === 'ENDED'}
            >
              ⏹️ Kết thúc phiên
            </Btn>
          </div>
        </div>

        {/* KHỐI 2: BỘ GIẢ LẬP BÌNH LUẬN & TÌNH HUỐNG (MỤC 7) */}
        {admin.simEnabled && (
          <div
            style={{
              background: '#0f172a',
              border: '1.5px solid #0284c7',
              borderRadius: 14,
              padding: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: '#38bdf8' }}>
                🧪 BỘ GIẢ LẬP 30 NGƯỜI CHƠI NHƯ THẬT ({admin.simProfiles.length} tài khoản sim_01..sim_30)
              </div>
              {admin.autoSim && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#cbd5e1' }}>
                    Câu này: <b>{admin.autoSim.completedActions}</b> đã gửi · <b>{admin.autoSim.pendingActions}</b> chờ trả lời sau · 🎁{' '}
                    <b>{admin.autoSim.giftsSent}</b> quà
                  </span>
                  <Btn
                    testId="sim-auto-toggle"
                    tone={admin.autoSim.enabled ? 'primary' : 'ghost'}
                    onClick={() => callApi('/api/sim/auto-toggle', { enabled: !admin.autoSim?.enabled })}
                  >
                    {admin.autoSim.enabled ? '🤖 Tự động 30 người: ĐANG BẬT' : '⏸️ Tự động 30 người: ĐANG TẮT'}
                  </Btn>
                  <Btn testId="sim-wave-30" tone="accent" onClick={() => callApi('/api/sim/wave-30')}>
                    🎭 Kích hoạt đợt 30 người (Trả lời + Trả lời sau + Quà)
                  </Btn>
                </div>
              )}
            </div>

            {/* Kịch bản nhanh 1 chạm */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #1e293b' }}>
              <Btn testId="sim-queue-7" tone="accent" onClick={runScenarioQueue7}>
                ⚡ 1. Tự động đưa người chơi vào ghế chờ
              </Btn>
              <Btn testId="sim-confirm-all" tone="accent" onClick={runScenarioConfirmAllInvites}>
                ✅ 2. Qua 12s tự động lên ghế nóng (không cần SS)
              </Btn>
              <Btn testId="sim-seat25-wrong" tone="primary" onClick={runScenarioSeat2And5Wrong}>
                🎯 3. Ghế 2 & 5 trả lời SAI (Ghế 1, 3, 4 ĐÚNG)
              </Btn>
              <Btn testId="sim-all5-wrong" tone="ghost" onClick={runScenarioAll5Wrong}>
                💥 Cả 5 ghế cùng SAI
              </Btn>
              <Btn testId="sim-30-audience" tone="ghost" onClick={runScenario30AudienceCorrect}>
                👥 30 khán giả mới cùng trả lời ĐÚNG
              </Btn>
              <Btn
                testId="sim-toggle-conn"
                tone={admin.state.sourceHealthy ? 'danger' : 'primary'}
                onClick={() => callApi('/api/sim/connection', { healthy: !admin.state.sourceHealthy })}
              >
                {admin.state.sourceHealthy ? '🔌 Giả lập mất kết nối' : '🔌 Khôi phục kết nối'}
              </Btn>
            </div>

            {/* Chọn người giả lập đơn lẻ */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 12.5, fontWeight: 700, color: '#cbd5e1' }}>Người giả lập:</label>
              <select
                data-testid="sim-user-select"
                value={selectedSim}
                onChange={(e) => setSelectedSim(e.target.value)}
                style={{
                  background: '#1e293b',
                  border: '1px solid #334155',
                  color: '#f8fafc',
                  borderRadius: 8,
                  padding: '5px 10px',
                  fontSize: 12.5,
                  fontWeight: 700,
                }}
              >
                {admin.simProfiles.map((p) => {
                  const st = admin.players.find((x) => x.userId === p.userId)?.status ?? 'KHÁN GIẢ';
                  return (
                    <option key={p.userId} value={p.userId}>
                      {p.nickname} ({p.userId}) — [{st}]
                    </option>
                  );
                })}
              </select>

              <Btn testId="sim-cmd-vao" tone="ghost" onClick={() => sendSimChat(selectedSim, 'vào')}>
                👋 VÀO
              </Btn>
              <Btn testId="sim-cmd-cho" tone="ghost" onClick={() => sendSimChat(selectedSim, 'chờ')}>
                🪑 CHỜ (đăng ký)
              </Btn>
              <Btn testId="sim-cmd-huy" tone="ghost" onClick={() => sendSimChat(selectedSim, 'hủy')}>
                ❌ HỦY
              </Btn>
              <Btn testId="sim-cmd-ss" tone="primary" onClick={() => sendSimChat(selectedSim, 'ss')}>
                ✅ SS (lên ghế)
              </Btn>
              <Btn testId="sim-cmd-nhuong" tone="ghost" onClick={() => sendSimChat(selectedSim, 'nhường')}>
                🏳️ NHƯỜNG
              </Btn>
              <Btn tone="ghost" onClick={() => sendSimChat(selectedSim, 'điểm')}>
                📊 ĐIỂM
              </Btn>
              <Btn tone="ghost" onClick={() => sendSimChat(selectedSim, 'vị trí')}>
                📍 VỊ TRÍ
              </Btn>
            </div>

            {/* Gửi đáp án đúng, sai, trùng, quá hạn hoặc bình luận tùy ý */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <Btn testId="sim-ans-correct" tone="primary" onClick={() => sendSimAnswer(selectedSim, 'correct')}>
                🎯 Gửi đáp án ĐÚNG
              </Btn>
              <Btn testId="sim-ans-wrong" tone="danger" onClick={() => sendSimAnswer(selectedSim, 'wrong')}>
                💥 Gửi đáp án SAI
              </Btn>
              <Btn testId="sim-ans-dup" tone="ghost" onClick={() => sendSimAnswer(selectedSim, 'dup')}>
                🔁 Gửi đáp án TRÙNG
              </Btn>
              <Btn testId="sim-ans-late" tone="ghost" onClick={() => sendSimAnswer(selectedSim, 'late')}>
                ⏰ Gửi đáp án QUÁ HẠN
              </Btn>
              <Btn
                testId="sim-gift"
                tone="ghost"
                onClick={() => callApi('/api/sim/gift', { userId: selectedSim, giftName: 'Hoa hồng', count: 5, diamonds: 50 })}
              >
                🎁 Tặng quà
              </Btn>

              <div style={{ display: 'flex', gap: 6, flex: 1, minWidth: 220 }}>
                <input
                  data-testid="sim-custom-input"
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customText.trim()) {
                      void sendSimChat(selectedSim, customText);
                      setCustomText('');
                    }
                  }}
                  placeholder="Gõ bình luận bất kỳ (vd: 1B, chờ, ss, câu sai cú pháp...)"
                  style={{
                    flex: 1,
                    background: '#1e293b',
                    border: '1px solid #334155',
                    color: '#f8fafc',
                    borderRadius: 8,
                    padding: '5px 10px',
                    fontSize: 12.5,
                  }}
                />
                <Btn
                  testId="sim-custom-send"
                  onClick={() => {
                    if (!customText.trim()) return;
                    void sendSimChat(selectedSim, customText);
                    setCustomText('');
                  }}
                >
                  Gửi
                </Btn>
              </div>
            </div>
          </div>
        )}

        {/* KHỐI 3: CÁC TAB QUẢN TRỊ CHI TIẾT */}
        <div
          style={{
            background: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: 14,
            padding: 12,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 280,
          }}
        >
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, borderBottom: '1px solid #1e293b', paddingBottom: 8 }}>
            <TabBtn active={activeTab === 'logs'} onClick={() => setActiveTab('logs')}>
              📜 Nhật ký lệnh & Giải thích ({admin.log.length})
            </TabBtn>
            <TabBtn active={activeTab === 'audio'} onClick={() => setActiveTab('audio')} testId="tab-audio">
              🎚️ Âm thanh & Nhạc nền {audioSettings.masterMuted ? '(🔇 Tắt)' : ''}
            </TabBtn>
            <TabBtn active={activeTab === 'seats'} onClick={() => setActiveTab('seats')}>
              🪑 5 Ghế nóng & Hàng chờ ({admin.queue.length})
            </TabBtn>
            <TabBtn active={activeTab === 'players'} onClick={() => setActiveTab('players')}>
              👥 Người chơi ({admin.playerCount})
            </TabBtn>
            <TabBtn active={activeTab === 'questions'} onClick={() => setActiveTab('questions')}>
              📚 Ngân hàng câu hỏi ({admin.questions.length})
            </TabBtn>
          </div>

          {/* TAB: BẢNG ĐIỀU KHIỂN ÂM THANH CHO NGƯỜI VẬN HÀNH */}
          {activeTab === 'audio' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', maxHeight: 340, paddingRight: 4 }}>
              {/* THANH ĐIỀU KHIỂN CHÍNH & MUTE ALL */}
              <div
                style={{
                  background: '#090d1a',
                  border: '1.5px solid #1e293b',
                  borderRadius: 12,
                  padding: 12,
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <button
                    data-testid="audio-btn-mute-all"
                    onClick={() => audioManager.setMasterMuted(!audioSettings.masterMuted)}
                    style={{
                      background: audioSettings.masterMuted ? '#dc2626' : '#10b981',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 10,
                      padding: '8px 16px',
                      fontSize: 13,
                      fontWeight: 900,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>{audioSettings.masterMuted ? '🔇 ĐANG TẮT TOÀN BỘ' : '🔊 ÂM THANH ĐANG BẬT'}</span>
                    <span style={{ fontSize: 11, opacity: 0.85 }}>(Bấm để {audioSettings.masterMuted ? 'bật' : 'tắt toàn bộ'})</span>
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: '#94a3b8' }}>
                      Âm lượng Tổng:
                    </span>
                    <input
                      data-testid="audio-slider-master"
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(audioSettings.masterVolume * 100)}
                      onChange={(e) => audioManager.setMasterVolume(Number(e.target.value) / 100)}
                      style={{ width: 130 }}
                    />
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: '#fde047', minWidth: 36 }}>
                      {Math.round(audioSettings.masterVolume * 100)}%
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {audioSuspended ? (
                    <button
                      onClick={() => void audioManager.resumeContext()}
                      style={{
                        background: '#f59e0b',
                        color: '#0f172a',
                        border: 'none',
                        borderRadius: 8,
                        padding: '6px 12px',
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      🔓 Trình duyệt đang chặn âm thanh — Bấm mở
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, color: '#34d399', fontWeight: 700 }}>
                      ● Bộ phát âm thanh: Đang hoạt động
                    </span>
                  )}
                </div>
              </div>

              {/* 3 KÊNH ÂM THANH ĐỘC LẬP (BGM, SFX, GIỌNG MC) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
                {/* KÊNH 1: NHẠC NỀN (BGM) */}
                <div
                  style={{
                    background: '#090d1a',
                    border: '1px solid #1e293b',
                    borderRadius: 12,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#38bdf8' }}>
                      🎵 NHẠC NỀN (BGM)
                    </span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>
                      <input
                        data-testid="audio-toggle-bgm"
                        type="checkbox"
                        checked={audioSettings.bgmEnabled}
                        onChange={(e) => audioManager.setBgmEnabled(e.target.checked)}
                      />
                      {audioSettings.bgmEnabled ? 'Bật' : 'Tắt'}
                    </label>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11.5, color: '#94a3b8' }}>Âm lượng:</span>
                    <input
                      data-testid="audio-slider-bgm"
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(audioSettings.bgmVolume * 100)}
                      onChange={(e) => audioManager.setBgmVolume(Number(e.target.value) / 100)}
                      style={{ flex: 1 }}
                    />
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: '#cbd5e1', minWidth: 32 }}>
                      {Math.round(audioSettings.bgmVolume * 100)}%
                    </span>
                  </div>

                  {/* CHỌN BÀI NỀN */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 11.5, color: '#94a3b8' }}>Chế độ phát bài:</span>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                      <button
                        onClick={() => audioManager.setBgmTrack('auto')}
                        style={{
                          background: audioSettings.bgmTrack === 'auto' ? '#0284c7' : '#1e293b',
                          color: '#f8fafc',
                          border: 'none',
                          borderRadius: 6,
                          padding: '5px 8px',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        📻 Tự động theo trạng thái
                      </button>
                      <button
                        onClick={() => audioManager.setBgmTrack('lobby')}
                        style={{
                          background: audioSettings.bgmTrack === 'lobby' ? '#0284c7' : '#1e293b',
                          color: '#f8fafc',
                          border: 'none',
                          borderRadius: 6,
                          padding: '5px 8px',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        🎷 Nhạc giao lưu (Funky)
                      </button>
                      <button
                        onClick={() => audioManager.setBgmTrack('thinking')}
                        style={{
                          background: audioSettings.bgmTrack === 'thinking' ? '#0284c7' : '#1e293b',
                          color: '#f8fafc',
                          border: 'none',
                          borderRadius: 6,
                          padding: '5px 8px',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        🧠 Nhạc suy nghĩ (Pulse)
                      </button>
                      <button
                        onClick={() => audioManager.setBgmTrack('off')}
                        style={{
                          background: audioSettings.bgmTrack === 'off' ? '#b91c1c' : '#1e293b',
                          color: '#f8fafc',
                          border: 'none',
                          borderRadius: 6,
                          padding: '5px 8px',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        ⏹️ Tắt nhạc nền
                      </button>
                    </div>
                  </div>

                  <div style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic', marginTop: 2 }}>
                    💡 Tự động giảm 10 dB khi MC nói để nghe rõ lời; tăng lại mượt khi nói xong.
                  </div>
                </div>

                {/* KÊNH 2: HIỆU ỨNG ÂM THANH (SFX) */}
                <div
                  style={{
                    background: '#090d1a',
                    border: '1px solid #1e293b',
                    borderRadius: 12,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#38bdf8' }}>
                      ⚡ HIỆU ỨNG ÂM THANH (SFX)
                    </span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>
                      <input
                        data-testid="audio-toggle-sfx"
                        type="checkbox"
                        checked={audioSettings.sfxEnabled}
                        onChange={(e) => {
                          audioManager.setSfxEnabled(e.target.checked);
                          void callApi('/api/admin/config/display', { sfxEnabled: e.target.checked });
                        }}
                      />
                      {audioSettings.sfxEnabled ? 'Bật' : 'Tắt'}
                    </label>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11.5, color: '#94a3b8' }}>Âm lượng:</span>
                    <input
                      data-testid="audio-slider-sfx"
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(audioSettings.sfxVolume * 100)}
                      onChange={(e) => audioManager.setSfxVolume(Number(e.target.value) / 100)}
                      style={{ flex: 1 }}
                    />
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: '#cbd5e1', minWidth: 32 }}>
                      {Math.round(audioSettings.sfxVolume * 100)}%
                    </span>
                  </div>

                  <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
                    Gồm: Đếm ngược (10..1s), Trả lời đúng, Trả lời sai, Đổi ghế, Vinh danh.
                  </div>

                  <div style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic', marginTop: 'auto' }}>
                    💡 Với 5 ghế nóng, công bố chung 1 hiệu ứng thống nhất, chống chồng âm gây ồn.
                  </div>
                </div>

                {/* KÊNH 3: GIỌNG ĐỌC MC (TTS) */}
                <div
                  style={{
                    background: '#090d1a',
                    border: '1px solid #1e293b',
                    borderRadius: 12,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#38bdf8' }}>
                      🎙️ GIỌNG ĐỌC MC (TTS)
                    </span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>
                      <input
                        data-testid="audio-toggle-mc"
                        type="checkbox"
                        checked={audioSettings.mcEnabled}
                        onChange={(e) => {
                          audioManager.setMcEnabled(e.target.checked);
                          void callApi('/api/admin/config/display', { ttsEnabled: e.target.checked });
                        }}
                      />
                      {audioSettings.mcEnabled ? 'Bật' : 'Tắt'}
                    </label>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11.5, color: '#94a3b8' }}>Âm lượng:</span>
                    <input
                      data-testid="audio-slider-mc"
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(audioSettings.mcVolume * 100)}
                      onChange={(e) => audioManager.setMcVolume(Number(e.target.value) / 100)}
                      style={{ flex: 1 }}
                    />
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: '#cbd5e1', minWidth: 32 }}>
                      {Math.round(audioSettings.mcVolume * 100)}%
                    </span>
                  </div>

                  <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
                    Tự động đồng bộ với hàng đợi phát thanh của MC và tư thế 01..08.
                  </div>

                  <div style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic', marginTop: 'auto' }}>
                    💡 Hàng đợi tự gỡ kẹt tối đa 6s bảo đảm không bao giờ làm treo luồng game.
                  </div>
                </div>
              </div>

              {/* KHU VỰC NGHE THỬ ÂM THANH (PREVIEW SOUNDBOARD) */}
              <div
                style={{
                  background: '#090d1a',
                  border: '1px solid #1e293b',
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: '#fbbf24' }}>
                    🎧 BÀN PHÍM NGHE THỬ ÂM THANH (PREVIEW)
                  </span>
                  {previewing && (
                    <span style={{ fontSize: 11.5, color: '#38bdf8', fontWeight: 700 }}>
                      Đang phát thử: {previewing.toUpperCase()}...
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <button
                    data-testid="preview-btn-lobby"
                    onClick={() => audioManager.previewSound('lobby')}
                    style={{
                      background: previewing === 'lobby' ? '#0284c7' : '#1e293b',
                      color: '#f8fafc',
                      border: '1px solid #334155',
                      borderRadius: 8,
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    🎷 Nhạc giao lưu (Funky)
                  </button>

                  <button
                    data-testid="preview-btn-thinking"
                    onClick={() => audioManager.previewSound('thinking')}
                    style={{
                      background: previewing === 'thinking' ? '#0284c7' : '#1e293b',
                      color: '#f8fafc',
                      border: '1px solid #334155',
                      borderRadius: 8,
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    🧠 Nhạc suy nghĩ (Pulse)
                  </button>

                  <button
                    data-testid="preview-btn-countdown"
                    onClick={() => audioManager.previewSound('countdown')}
                    style={{
                      background: previewing === 'countdown' ? '#0284c7' : '#1e293b',
                      color: '#f8fafc',
                      border: '1px solid #334155',
                      borderRadius: 8,
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ⏱️ Đếm ngược (5s & 1s)
                  </button>

                  <button
                    data-testid="preview-btn-correct"
                    onClick={() => audioManager.previewSound('correct')}
                    style={{
                      background: previewing === 'correct' ? '#10b981' : '#1e293b',
                      color: '#f8fafc',
                      border: '1px solid #334155',
                      borderRadius: 8,
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ✅ Trả lời đúng (Chime)
                  </button>

                  <button
                    data-testid="preview-btn-wrong"
                    onClick={() => audioManager.previewSound('wrong')}
                    style={{
                      background: previewing === 'wrong' ? '#ef4444' : '#1e293b',
                      color: '#f8fafc',
                      border: '1px solid #334155',
                      borderRadius: 8,
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ❌ Trả lời sai (Buzzer)
                  </button>

                  <button
                    data-testid="preview-btn-seat"
                    onClick={() => audioManager.previewSound('seat')}
                    style={{
                      background: previewing === 'seat' ? '#0284c7' : '#1e293b',
                      color: '#f8fafc',
                      border: '1px solid #334155',
                      borderRadius: 8,
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    🪑 Lên ghế nóng (Whoosh)
                  </button>

                  <button
                    data-testid="preview-btn-honor"
                    onClick={() => audioManager.previewSound('honor')}
                    style={{
                      background: previewing === 'honor' ? '#f59e0b' : '#1e293b',
                      color: '#f8fafc',
                      border: '1px solid #334155',
                      borderRadius: 8,
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    🏆 Vinh danh (Fanfare)
                  </button>

                  <button
                    data-testid="preview-btn-stop"
                    onClick={() => audioManager.stopPreview()}
                    style={{
                      background: '#334155',
                      color: '#e2e8f0',
                      border: 'none',
                      borderRadius: 8,
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    ⏹️ Dừng phát thử
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 1: NHẬT KÝ LỆNH & CẤU HÌNH */}
          {activeTab === 'logs' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 12, flex: 1, minHeight: 0 }}>
              <div
                data-testid="command-log-list"
                style={{
                  background: '#090d1a',
                  border: '1px solid #1e293b',
                  borderRadius: 10,
                  padding: 8,
                  overflowY: 'auto',
                  maxHeight: 330,
                  fontSize: 12,
                }}
              >
                {admin.log.length === 0 ? (
                  <div style={{ color: '#64748b', padding: 8 }}>Chưa có sự kiện nào.</div>
                ) : (
                  [...admin.log].reverse().map((item) => (
                    <div
                      key={item.id}
                      style={{
                        padding: '5px 8px',
                        borderBottom: '1px solid #1e293b',
                        display: 'flex',
                        gap: 8,
                        alignItems: 'baseline',
                      }}
                    >
                      <span style={{ color: '#64748b', fontSize: 11, flexShrink: 0 }}>
                        {new Date(item.at).toLocaleTimeString('vi-VN')}
                      </span>
                      {item.kind === 'command' ? (
                        <span
                          style={{
                            color: item.accepted ? '#34d399' : '#f87171',
                            fontWeight: 800,
                            flexShrink: 0,
                          }}
                        >
                          {item.accepted ? '✅ NHẬN' : '⛔ TỪ CHỐI'}
                        </span>
                      ) : (
                        <span style={{ color: '#38bdf8', fontWeight: 700, flexShrink: 0 }}>[{item.kind.toUpperCase()}]</span>
                      )}
                      <span style={{ color: '#e2e8f0' }}>
                        {item.nickname ? <b>{item.nickname}</b> : null}
                        {item.text ? (
                          <code style={{ background: '#1e293b', padding: '1px 5px', borderRadius: 4, margin: '0 6px', color: '#fde047' }}>
                            {item.text}
                          </code>
                        ) : null}{' '}
                        — {item.message}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* Cột phải của tab Logs: Cấu hình vùng an toàn & Sao lưu */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                <div style={{ background: '#1e293b', borderRadius: 10, padding: 10 }}>
                  <div style={{ fontWeight: 800, color: '#fbbf24', marginBottom: 6 }}>
                    ⚙️ Âm thanh, Giảm chuyển động & Vùng an toàn
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                      <input
                        data-testid="toggle-tts"
                        type="checkbox"
                        checked={admin.display.ttsEnabled}
                        onChange={(e) => callApi('/api/admin/config/display', { ttsEnabled: e.target.checked })}
                      />
                      Giọng đọc MC (TTS)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                      <input
                        data-testid="toggle-sfx"
                        type="checkbox"
                        checked={admin.display.sfxEnabled !== false}
                        onChange={(e) => callApi('/api/admin/config/display', { sfxEnabled: e.target.checked })}
                      />
                      Âm thanh hiệu ứng (SFX)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                      <input
                        data-testid="toggle-reduce-motion"
                        type="checkbox"
                        checked={Boolean(admin.display.reduceMotion)}
                        onChange={(e) => callApi('/api/admin/config/display', { reduceMotion: e.target.checked })}
                      />
                      Giảm chuyển động
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                      <input type="checkbox" checked={showSafeGuide} onChange={(e) => setShowSafeGuide(e.target.checked)} />
                      Khung vùng an toàn
                    </label>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <label>
                      Lề trên ({admin.display.safeTop}px)
                      <input
                        type="range"
                        min={20}
                        max={220}
                        value={admin.display.safeTop}
                        onChange={(e) => callApi('/api/admin/config/display', { safeTop: Number(e.target.value) })}
                        style={{ width: '100%' }}
                      />
                    </label>
                    <label>
                      Lề dưới ({admin.display.safeBottom}px)
                      <input
                        type="range"
                        min={40}
                        max={260}
                        value={admin.display.safeBottom}
                        onChange={(e) => callApi('/api/admin/config/display', { safeBottom: Number(e.target.value) })}
                        style={{ width: '100%' }}
                      />
                    </label>
                  </div>
                </div>

                <div style={{ background: '#1e293b', borderRadius: 10, padding: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <Btn onClick={() => callApi('/api/admin/backup')}>💾 Sao lưu SQLite</Btn>
                  <a
                    href={`/api/admin/logs/export?token=${encodeURIComponent(token)}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      background: '#334155',
                      color: '#f8fafc',
                      padding: '6px 11px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      textDecoration: 'none',
                    }}
                  >
                    📥 Xuất nhật ký JSON
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 5 GHẾ NÓNG & HÀNG CHỜ */}
          {activeTab === 'seats' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, overflowY: 'auto', maxHeight: 330 }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#fbbf24', marginBottom: 6 }}>
                  🔥 5 GHẾ NÓNG HIỆN TẠI
                </div>
                {admin.seats.map((s) => (
                  <div
                    key={s.seat}
                    style={{
                      background: '#1e293b',
                      borderRadius: 8,
                      padding: '6px 10px',
                      marginBottom: 6,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 12.5,
                    }}
                  >
                    <span>
                      <b>Ghế {s.seat}:</b>{' '}
                      {s.userId ? `${s.nickname} (${s.userId}) — Cấp ${s.level}` : <i style={{ color: '#64748b' }}>Đang trống</i>}
                    </span>
                    {s.userId && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Btn tone="ghost" onClick={() => sendSimChat(s.userId!, 'nhường')}>
                          Nhường
                        </Btn>
                        <Btn
                          tone="danger"
                          onClick={() => callApi('/api/admin/player/kick', { userId: s.userId, reason: modReason })}
                        >
                          Cho rời ghế
                        </Btn>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#38bdf8', marginBottom: 6 }}>
                  ⏳ DANH SÁCH HÀNG CHỜ ({admin.queue.length} người)
                </div>
                {admin.queue.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#64748b' }}>Hàng chờ đang trống.</div>
                ) : (
                  admin.queue.map((q) => (
                    <div
                      key={q.ticket}
                      style={{
                        background: '#1e293b',
                        borderRadius: 8,
                        padding: '5px 10px',
                        marginBottom: 4,
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 12,
                      }}
                    >
                      <span>
                        <b>#{q.pos}</b> (vé {q.ticket}): {q.nickname} ({q.userId})
                      </span>
                      <span style={{ color: q.visible ? '#38bdf8' : '#94a3b8' }}>
                        {q.visible ? 'Ghế chờ 1–10' : 'Khán đài đăng ký'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 3: NGƯỜI CHƠI */}
          {activeTab === 'players' && (
            <div style={{ overflowY: 'auto', maxHeight: 330 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>Lý do xử lý vi phạm:</span>
                <input
                  value={modReason}
                  onChange={(e) => setModReason(e.target.value)}
                  style={{
                    background: '#1e293b',
                    border: '1px solid #334155',
                    color: '#f8fafc',
                    borderRadius: 6,
                    padding: '4px 8px',
                    fontSize: 12,
                    width: 260,
                  }}
                />
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#94a3b8', borderBottom: '1px solid #334155' }}>
                    <th style={{ padding: 5 }}>Tài khoản</th>
                    <th>Trạng thái</th>
                    <th>Điểm phiên</th>
                    <th>Kỷ lục cấp</th>
                    <th>Tự xếp lại</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {admin.players.map((p) => (
                    <tr key={p.userId} style={{ borderBottom: '1px solid #1e293b' }}>
                      <td style={{ padding: 5 }}>
                        <b>{p.nickname}</b> <span style={{ color: '#64748b' }}>({p.userId})</span>
                      </td>
                      <td style={{ color: p.status === 'GHẾ NÓNG' ? '#fbbf24' : '#38bdf8', fontWeight: 700 }}>{p.status}</td>
                      <td>{p.session?.sessionPoints ?? 0}đ</td>
                      <td>Cấp {p.bestLevelAll}</td>
                      <td>{p.autoRequeue ? 'Bật' : 'Tắt'}</td>
                      <td>
                        <Btn
                          tone={p.locked ? 'primary' : 'danger'}
                          onClick={() =>
                            callApi('/api/admin/player/lock', { userId: p.userId, locked: !p.locked, reason: modReason })
                          }
                        >
                          {p.locked ? 'Mở khóa' : 'Tạm khóa'}
                        </Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 4: NGÂN HÀNG CÂU HỎI */}
          {activeTab === 'questions' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 12, overflowY: 'auto', maxHeight: 330 }}>
              <div style={{ overflowY: 'auto', maxHeight: 315 }}>
                {admin.questions.map((q) => (
                  <div
                    key={q.id}
                    style={{
                      background: '#1e293b',
                      borderRadius: 8,
                      padding: '6px 10px',
                      marginBottom: 6,
                      fontSize: 12,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <div>
                      <b>[{q.id}]</b> ({q.topic} · {q.difficulty}) {q.text} —{' '}
                      <span style={{ color: '#34d399', fontWeight: 700 }}>Đáp án {q.correct}</span>
                    </div>
                    <Btn
                      tone={q.status === 'approved' ? 'ghost' : 'primary'}
                      onClick={() =>
                        callApi('/api/admin/questions/status', {
                          id: q.id,
                          status: q.status === 'approved' ? 'disabled' : 'approved',
                        })
                      }
                    >
                      {q.status === 'approved' ? 'Tắt' : 'Duyệt'}
                    </Btn>
                  </div>
                ))}
              </div>

              {/* Thêm câu hỏi mới */}
              <div style={{ background: '#1e293b', borderRadius: 10, padding: 10, fontSize: 12 }}>
                <div style={{ fontWeight: 800, color: '#fbbf24', marginBottom: 6 }}>➕ Thêm câu hỏi mới</div>
                <div style={{ display: 'grid', gap: 5 }}>
                  <input
                    placeholder="Mã câu (vd: q21)"
                    value={newQ.id}
                    onChange={(e) => setNewQ({ ...newQ, id: e.target.value })}
                    style={{ background: '#0f172a', border: '1px solid #334155', color: '#fff', padding: 5, borderRadius: 6 }}
                  />
                  <input
                    placeholder="Nội dung câu hỏi"
                    value={newQ.text}
                    onChange={(e) => setNewQ({ ...newQ, text: e.target.value })}
                    style={{ background: '#0f172a', border: '1px solid #334155', color: '#fff', padding: 5, borderRadius: 6 }}
                  />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    <input
                      placeholder="Lựa chọn A"
                      value={newQ.cA}
                      onChange={(e) => setNewQ({ ...newQ, cA: e.target.value })}
                      style={{ background: '#0f172a', border: '1px solid #334155', color: '#fff', padding: 5, borderRadius: 6 }}
                    />
                    <input
                      placeholder="Lựa chọn B"
                      value={newQ.cB}
                      onChange={(e) => setNewQ({ ...newQ, cB: e.target.value })}
                      style={{ background: '#0f172a', border: '1px solid #334155', color: '#fff', padding: 5, borderRadius: 6 }}
                    />
                    <input
                      placeholder="Lựa chọn C"
                      value={newQ.cC}
                      onChange={(e) => setNewQ({ ...newQ, cC: e.target.value })}
                      style={{ background: '#0f172a', border: '1px solid #334155', color: '#fff', padding: 5, borderRadius: 6 }}
                    />
                    <input
                      placeholder="Lựa chọn D"
                      value={newQ.cD}
                      onChange={(e) => setNewQ({ ...newQ, cD: e.target.value })}
                      style={{ background: '#0f172a', border: '1px solid #334155', color: '#fff', padding: 5, borderRadius: 6 }}
                    />
                  </div>
                  <input
                    placeholder="Giải thích ngắn"
                    value={newQ.explanation}
                    onChange={(e) => setNewQ({ ...newQ, explanation: e.target.value })}
                    style={{ background: '#0f172a', border: '1px solid #334155', color: '#fff', padding: 5, borderRadius: 6 }}
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select
                      value={newQ.correct}
                      onChange={(e) => setNewQ({ ...newQ, correct: e.target.value as 'A' | 'B' | 'C' | 'D' })}
                      style={{ background: '#0f172a', color: '#fff', padding: 5, borderRadius: 6 }}
                    >
                      <option value="A">Đúng: A</option>
                      <option value="B">Đúng: B</option>
                      <option value="C">Đúng: C</option>
                      <option value="D">Đúng: D</option>
                    </select>
                    <Btn
                      tone="primary"
                      onClick={() =>
                        callApi('/api/admin/questions/upsert', {
                          id: newQ.id,
                          text: newQ.text,
                          choices: [newQ.cA, newQ.cB, newQ.cC, newQ.cD],
                          correct: newQ.correct,
                          explanation: newQ.explanation,
                          topic: newQ.topic,
                          difficulty: newQ.difficulty,
                          status: 'approved',
                        })
                      }
                    >
                      Lưu & Duyệt
                    </Btn>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CỘT PHẢI: KHUNG XEM TRƯỚC SÂN KHẤU 9:16 TRỰC TIẾP */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: 390, marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8' }}>
            📱 XEM TRƯỚC SÂN KHẤU 9:16
          </span>
          <button
            data-testid="btn-toggle-dashboard-audio"
            onClick={() => {
              void audioManager.resumeContext();
              setDashboardAudioOn(!dashboardAudioOn);
            }}
            style={{
              background: dashboardAudioOn ? '#059669' : '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              borderRadius: 6,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>{dashboardAudioOn ? '🔊' : '🔈'}</span>
            <span>{dashboardAudioOn ? 'Tiếng: BẬT' : 'Tiếng: TẮT'}</span>
          </button>
        </div>
        <StageFrame maxWidth={390} maxHeight={window.innerHeight - 54}>
          <StageCanvas data={admin.public} mute={!dashboardAudioOn} showSafeGuide={showSafeGuide} />
        </StageFrame>
      </div>
    </div>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  tone = 'ghost',
  testId,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'accent' | 'ghost' | 'danger';
  testId?: string;
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: '#f59e0b', color: '#0f172a' },
    accent: { background: '#0284c7', color: '#f8fafc' },
    ghost: { background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155' },
    danger: { background: '#b91c1c', color: '#fef2f2' },
  };
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...styles[tone],
        padding: '6px 11px',
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 800,
        border: styles[tone].border || 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.42 : 1,
      }}
    >
      {children}
    </button>
  );
}

function TabBtn({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      style={{
        background: active ? '#0284c7' : '#1e293b',
        color: '#f8fafc',
        border: 'none',
        padding: '6px 12px',
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 800,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
