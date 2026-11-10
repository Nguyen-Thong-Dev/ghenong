/**
 * Hệ thống Nhân vật & Ghế 2.5D đồng bộ của dự án GHẾ NÓNG
 * (Bản đầu: vector 2.5D tự dựng của dự án, hoàn toàn không dùng tài nguyên ảnh của repo tham khảo).
 * - Bảng màu chuẩn gameshow: Nền xanh đêm, Ghế nóng đỏ cam, Đèn vàng ấm, Điểm nhấn xanh ngọc.
 * - Đồng bộ tư thế nhân vật ngồi trong lòng ghế nóng, ghế chờ và ghế khán giả chữ U.
 */
import React from 'react';

export type CharacterPose = 'idle' | 'thinking' | 'answered' | 'correct' | 'wrong' | 'departing' | 'entering' | 'mc';
export type HotSeatVisualState = 'empty' | 'inviting' | 'playing' | 'locked' | 'correct' | 'wrong';

/**
 * 8 tư thế MC áo trắng chuẩn từ bộ ảnh 1024 × 1536 px (điểm neo chân: x=512, y=1440 => 50% 93.75%):
 * - 01: đứng tự nhiên khi chờ
 * - 02: chào mở vòng hoặc đón người lên ghế
 * - 03: đọc câu hỏi khi âm thanh đọc đề đang phát
 * - 04: giới thiệu các lựa chọn
 * - 05: suy nghĩ trong thời gian chờ trả lời
 * - 06: nhắc còn 5 giây
 * - 07: ăn mừng khi vinh danh
 * - 08: động viên sau khi có người bị loại
 */
export type McPoseCode = '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08';

export const MC_WHITE_POSES: Record<
  McPoseCode,
  { code: McPoseCode; file: string; label: string; badgeColor: string }
> = {
  '01': { code: '01', file: '/mc/mc_01_dung.png', label: 'Đứng tự nhiên', badgeColor: '#38bdf8' },
  '02': { code: '02', file: '/mc/mc_02_chao.png', label: 'Chào & đón ghế', badgeColor: '#fbbf24' },
  '03': { code: '03', file: '/mc/mc_03_doc_cau_hoi.png', label: 'Đọc câu hỏi', badgeColor: '#22d3ee' },
  '04': { code: '04', file: '/mc/mc_04_gioi_thieu.png', label: 'Giới thiệu đáp án', badgeColor: '#a78bfa' },
  '05': { code: '05', file: '/mc/mc_05_suy_nghi.png', label: 'Chờ trả lời', badgeColor: '#67e8f9' },
  '06': { code: '06', file: '/mc/mc_06_het_gio.png', label: 'Còn ≤ 5 giây!', badgeColor: '#ef4444' },
  '07': { code: '07', file: '/mc/mc_07_vinh_danh.png', label: 'Vinh danh!', badgeColor: '#fde047' },
  '08': { code: '08', file: '/mc/mc_08_dong_vien.png', label: 'Động viên', badgeColor: '#fb923c' },
};

const MC_POSE_LIST = Object.values(MC_WHITE_POSES);

/**
 * Nhân vật MC áo trắng 8 tư thế (1024 × 1536 px, tỉ lệ khung 2:3).
 * - Hiển thị toàn bộ khung ảnh 2:3, không tự crop theo nhân vật, cùng chiều rộng/cao CSS cho mọi tư thế.
 * - Điểm neo chân cố định tại x=512, y=1440 (50% 93.75%).
 * - Chuyển động thở rất nhẹ (anim-mc-breathe) và chuyển tư thế mềm 240ms (trong khoảng 200–300 ms).
 * - Không kéo giãn hình để giả lập nói chuyện; chưa làm chớp mắt/miệng.
 */
export function McWhiteHost25D({
  poseCode,
  width = 172,
  height = 258,
  reduceMotion = false,
}: {
  poseCode: McPoseCode;
  width?: number;
  height?: number;
  reduceMotion?: boolean;
}) {
  const activeMeta = MC_WHITE_POSES[poseCode] ?? MC_WHITE_POSES['01'];

  return (
    <div
      data-testid="mc-white-host"
      data-mc-pose={poseCode}
      data-mc-file={activeMeta.file}
      className={reduceMotion ? undefined : 'anim-mc-breathe'}
      style={{
        position: 'relative',
        width,
        height,
        flexShrink: 0,
        transformOrigin: '50% 93.75%',
        pointerEvents: 'none',
      }}
    >
      {/* Bóng đổ mặt sàn dưới điểm neo bàn chân (y = 93.75% khung 1536px) */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '93.75%',
          width: Math.round(width * 0.56),
          height: 14,
          transform: 'translate(-50%, -45%)',
          borderRadius: '50%',
          background: 'radial-gradient(ellipse at center, rgba(34,211,238,0.42) 0%, rgba(0,0,0,0.72) 72%, rgba(0,0,0,0) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* 8 lớp ảnh PNG RGBA cùng kích thước CSS width × height, chuyển tư thế mượt 240ms */}
      {MC_POSE_LIST.map((item) => {
        const isActive = item.code === poseCode;
        return (
          <img
            key={item.code}
            src={item.file}
            alt={`MC tư thế ${item.code} - ${item.label}`}
            draggable={false}
            className="mc-pose-layer"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width,
              height,
              display: 'block',
              opacity: isActive ? 1 : 0,
              transform: isActive ? 'scale(1)' : 'scale(0.988)',
              filter: 'drop-shadow(0 8px 14px rgba(0, 0, 0, 0.65))',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
        );
      })}
    </div>
  );
}

const PALETTES = [
  { shirt: '#2563eb', shirtDark: '#1d4ed8', hair: '#1e293b', accent: '#93c5fd' },
  { shirt: '#db2777', shirtDark: '#be185d', hair: '#3f2314', accent: '#f9a8d4' },
  { shirt: '#059669', shirtDark: '#047857', hair: '#0f172a', accent: '#6ee7b7' },
  { shirt: '#d97706', shirtDark: '#b45309', hair: '#451a03', accent: '#fde68a' },
  { shirt: '#7c3aed', shirtDark: '#6d28d9', hair: '#1e1b4b', accent: '#c4b5fd' },
  { shirt: '#0891b2', shirtDark: '#0e7490', hair: '#18181b', accent: '#67e8f9' },
  { shirt: '#e11d48', shirtDark: '#be123c', hair: '#27272a', accent: '#fda4af' },
  { shirt: '#0d9488', shirtDark: '#0f766e', hair: '#292524', accent: '#5eead4' },
];

export function Character25D({
  template = 0,
  pose = 'idle',
  size = 58,
  speaking = false,
  showShadow = true,
}: {
  template?: number;
  pose?: CharacterPose;
  size?: number;
  speaking?: boolean;
  showShadow?: boolean;
}) {
  const pal = PALETTES[Math.abs(template) % PALETTES.length];
  const isMc = pose === 'mc';
  const shirtColor = isMc ? '#0e7490' : pal.shirt;
  const shirtDark = isMc ? '#155e75' : pal.shirtDark;
  const animClass =
    pose === 'correct'
      ? 'anim-jump'
      : pose === 'departing'
        ? 'anim-down'
        : pose === 'thinking' || speaking
          ? 'anim-bob'
          : '';

  return (
    <svg
      width={size}
      height={size * 1.12}
      viewBox="0 0 80 90"
      className={animClass}
      style={{ overflow: 'visible', filter: 'drop-shadow(0 4px 5px rgba(0,0,0,0.55))' }}
    >
      {showShadow && <ellipse cx="40" cy="82" rx="21" ry="5.5" fill="rgba(0,0,0,0.45)" />}

      {/* Thân áo 2.5D có khối sáng tối */}
      <path d="M19 78 C19 54, 61 54, 61 78 Z" fill={shirtColor} stroke="#090d16" strokeWidth="2.4" />
      <path d="M40 58 C51 58, 59 64, 60 77 L40 77 Z" fill={shirtDark} opacity="0.45" />

      {/* Cổ áo / Cà vạt vàng ấm của MC */}
      {isMc ? (
        <>
          <polygon points="32,56 40,63 48,56" fill="#e0f2fe" />
          <polygon points="40,58 36,70 40,76 44,70" fill="#fbbf24" stroke="#090d16" strokeWidth="1" />
        </>
      ) : (
        <path d="M32 57 L40 64 L48 57" fill="none" stroke={pal.accent} strokeWidth="2.5" strokeLinecap="round" />
      )}

      {/* Cánh tay theo tư thế */}
      {pose === 'correct' ? (
        <>
          <path d="M21 63 L9 40" stroke={shirtColor} strokeWidth="7.5" strokeLinecap="round" />
          <circle cx="9" cy="39" r="5" fill="#fde68a" stroke="#090d16" strokeWidth="1.5" />
          <path d="M59 63 L71 40" stroke={shirtColor} strokeWidth="7.5" strokeLinecap="round" />
          <circle cx="71" cy="39" r="5" fill="#fde68a" stroke="#090d16" strokeWidth="1.5" />
        </>
      ) : pose === 'answered' ? (
        <>
          <path d="M58 63 L68 45" stroke={shirtColor} strokeWidth="7" strokeLinecap="round" />
          <circle cx="68" cy="44" r="5" fill="#fde68a" stroke="#090d16" strokeWidth="1.5" />
        </>
      ) : isMc ? (
        <>
          <path d="M22 63 L15 73" stroke={shirtColor} strokeWidth="6.5" strokeLinecap="round" />
          <path d="M57 63 L67 51" stroke={shirtColor} strokeWidth="6.5" strokeLinecap="round" />
          <line x1="67" y1="51" x2="63" y2="38" stroke="#cbd5e1" strokeWidth="3" strokeLinecap="round" />
          <circle cx="62" cy="36" r="5.2" fill="#fbbf24" stroke="#090d16" strokeWidth="1.6" />
        </>
      ) : (
        <>
          <path d="M21 63 L16 74" stroke={shirtColor} strokeWidth="6" strokeLinecap="round" />
          <path d="M59 63 L64 74" stroke={shirtColor} strokeWidth="6" strokeLinecap="round" />
        </>
      )}

      {/* Đầu & khuôn mặt hoạt hình 2.5D */}
      <circle cx="40" cy="35" r="19" fill="#fed7aa" stroke="#090d16" strokeWidth="2.4" />
      {/* Má hồng nhẹ */}
      <ellipse cx="27" cy="39" rx="3.2" ry="1.8" fill="#fb7185" opacity="0.45" />
      <ellipse cx="53" cy="39" rx="3.2" ry="1.8" fill="#fb7185" opacity="0.45" />

      {/* Kiểu tóc theo mẫu */}
      {isMc ? (
        <path d="M20 34 C19 14, 61 13, 60 34 C54 22, 27 21, 20 34 Z" fill="#0f172a" />
      ) : template % 3 === 0 ? (
        <path d="M21 33 C21 15, 59 15, 59 33 C54 23, 26 23, 21 33 Z" fill={pal.hair} />
      ) : template % 3 === 1 ? (
        <path d="M20 35 C19 14, 61 14, 60 35 C56 25, 46 21, 40 23 C34 21, 24 25, 20 35 Z" fill={pal.hair} />
      ) : (
        <path d="M19 36 C18 14, 62 14, 61 36 C56 22, 24 22, 19 36 Z" fill={pal.hair} />
      )}

      {/* Biểu cảm mắt & miệng */}
      {pose === 'wrong' || pose === 'departing' ? (
        <>
          <path d="M29 32 L35 36 M35 32 L29 36" stroke="#090d16" strokeWidth="2.3" strokeLinecap="round" />
          <path d="M45 32 L51 36 M51 32 L45 36" stroke="#090d16" strokeWidth="2.3" strokeLinecap="round" />
          <path d="M34 45 Q40 40 46 45" fill="none" stroke="#090d16" strokeWidth="2.3" strokeLinecap="round" />
        </>
      ) : pose === 'correct' ? (
        <>
          <path d="M28 34 Q32 29 36 34" fill="none" stroke="#090d16" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M44 34 Q48 29 52 34" fill="none" stroke="#090d16" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M32 41 Q40 50 48 41 Z" fill="#ef4444" stroke="#090d16" strokeWidth="1.6" />
        </>
      ) : (
        <>
          <circle cx="32.5" cy="34" r="2.7" fill="#090d16" />
          <circle cx="47.5" cy="34" r="2.7" fill="#090d16" />
          <circle cx="31.7" cy="33.1" r="0.9" fill="#ffffff" />
          <circle cx="46.7" cy="33.1" r="0.9" fill="#ffffff" />
          {speaking ? (
            <ellipse cx="40" cy="43.5" rx="4.5" ry="3.2" fill="#ef4444" stroke="#090d16" strokeWidth="1.2" />
          ) : (
            <path d="M34.5 43 Q40 47.5 45.5 43" fill="none" stroke="#090d16" strokeWidth="2.2" strokeLinecap="round" />
          )}
        </>
      )}
    </svg>
  );
}

/**
 * Tổ hợp GHẾ NÓNG 2.5D ĐỎ CAM + NHÂN VẬT ĐỒNG BỘ.
 * Bao gồm: Đế bục tròn phát sáng, lưng ghế gameshow đỏ cam, nhân vật ngồi trong ghế, tay vịn và đệm ghế trước.
 */
export function HotSeatUnit25D({
  seatNumber,
  visualState,
  template = 0,
  pose = 'idle',
}: {
  seatNumber: number;
  visualState: HotSeatVisualState;
  template?: number;
  pose?: CharacterPose;
}) {
  const isEmpty = visualState === 'empty';
  const isCorrect = visualState === 'correct';
  const isWrong = visualState === 'wrong';
  const isLocked = visualState === 'locked';
  const isInviting = visualState === 'inviting';

  const rimColor = isCorrect
    ? '#fbbf24'
    : isWrong
      ? '#ef4444'
      : isLocked
        ? '#22d3ee'
        : isInviting
          ? '#fde047'
          : isEmpty
            ? '#64748b'
            : '#f97316';

  const backFillTop = isCorrect ? '#ea580c' : isWrong ? '#7f1d1d' : isEmpty ? '#1e293b' : '#ea580c';
  const backFillBottom = isCorrect ? '#9a3412' : isWrong ? '#450a0a' : isEmpty ? '#0f172a' : '#7c2d12';
  const cushionFill = isEmpty ? '#334155' : isWrong ? '#991b1b' : '#f97316';

  return (
    <div style={{ position: 'relative', width: 112, height: 108, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Lưng ghế nóng 2.5D & Đế bục tròn (Lớp sau nhân vật) */}
      <svg
        width={112}
        height={108}
        viewBox="0 0 112 108"
        style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
      >
        <defs>
          <linearGradient id={`hsBack_${seatNumber}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={backFillTop} />
            <stop offset="100%" stopColor={backFillBottom} />
          </linearGradient>
        </defs>

        {/* Bóng đổ mặt sàn dưới bục ghế */}
        <ellipse cx="56" cy="99" rx="48" ry="10" fill="rgba(0,0,0,0.65)" />

        {/* Bục tròn ghế nóng 2.5D */}
        <ellipse
          cx="56"
          cy="94"
          rx="44"
          ry="9"
          fill="#090d1b"
          stroke={rimColor}
          strokeWidth={isCorrect || isLocked ? 3 : 2}
        />
        <ellipse cx="56" cy="91" rx="37" ry="6.5" fill={isCorrect ? 'rgba(251,191,36,0.35)' : 'rgba(249,115,22,0.22)'} />

        {/* Thân lưng ghế nóng hình vòm gameshow */}
        <path
          d="M 25 84 L 20 26 Q 20 12 34 12 L 78 12 Q 92 12 92 26 L 87 84 Z"
          fill={`url(#hsBack_${seatNumber})`}
          stroke={rimColor}
          strokeWidth="2.6"
        />
        {/* Đường viền đèn neon bên trong lưng ghế */}
        <path
          d="M 30 78 L 26 28 Q 26 18 36 18 L 76 18 Q 86 18 86 28 L 82 78"
          fill="none"
          stroke={isCorrect ? '#fde68a' : isLocked ? '#67e8f9' : '#fdba74'}
          strokeWidth="1.4"
          strokeOpacity="0.65"
        />
      </svg>

      {/* Nhân vật ngồi chính giữa lòng ghế nóng */}
      {!isEmpty && (
        <div
          style={{
            position: 'relative',
            zIndex: 2,
            transform: 'translateY(-4px)',
            opacity: isInviting ? 0.85 : 1,
          }}
        >
          <Character25D template={template} pose={pose} size={62} showShadow={false} />
        </div>
      )}

      {/* Tay vịn 2 bên & Đệm ghế trước (Lớp ôm phía trước tạo chiều sâu 2.5D) */}
      <svg
        width={112}
        height={108}
        viewBox="0 0 112 108"
        style={{ position: 'absolute', inset: 0, zIndex: 3, overflow: 'visible', pointerEvents: 'none' }}
      >
        {/* Tay vịn trái & phải đỏ cam */}
        <rect x="14" y="56" width="13" height="24" rx="6" fill={cushionFill} stroke="#090d16" strokeWidth="2" />
        <rect x="85" y="56" width="13" height="24" rx="6" fill={cushionFill} stroke="#090d16" strokeWidth="2" />
        <ellipse cx="20.5" cy="58" rx="4.5" ry="2.2" fill="#fed7aa" opacity="0.65" />
        <ellipse cx="91.5" cy="58" rx="4.5" ry="2.2" fill="#fed7aa" opacity="0.65" />

        {/* Đệm ngồi mặt trước + Huy hiệu số ghế tròn ở chính giữa */}
        <rect x="22" y="73" width="68" height="14" rx="6" fill={cushionFill} stroke={rimColor} strokeWidth="2" />
        <circle cx="56" cy="80" r="10.5" fill="#090d1b" stroke={rimColor} strokeWidth="2.2" />
        <text x="56" y="84" textAnchor="middle" fill="#fbbf24" fontSize="12" fontWeight="900">
          {seatNumber}
        </text>

        {/* Nếu ghế trống: hiện chữ TRỐNG rõ trên lưng ghế */}
        {isEmpty && (
          <text x="56" y="50" textAnchor="middle" fill="#94a3b8" fontSize="11.5" fontWeight="800" letterSpacing="0.5">
            TRỐNG
          </text>
        )}
      </svg>
    </div>
  );
}

/**
 * Tổ hợp GHẾ CHỜ 2.5D + NHÂN VẬT ĐỒNG BỘ (dùng cho 10 ghế chờ, 2 hàng × 5 ghế).
 */
export function WaitingSeatUnit25D({
  pos,
  name,
  occupied,
  template = 0,
}: {
  pos: number;
  name: string;
  occupied: boolean;
  template?: number;
}) {
  return (
    <div
      data-testid={`waiting-seat-${pos}`}
      style={{
        background: occupied
          ? 'linear-gradient(180deg, rgba(14, 116, 144, 0.36) 0%, rgba(9, 13, 28, 0.95) 100%)'
          : 'rgba(9, 13, 28, 0.78)',
        border: `1.8px solid ${occupied ? '#22d3ee' : '#334155'}`,
        borderRadius: 12,
        padding: '4px 6px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 52,
        boxShadow: occupied ? '0 4px 12px rgba(6, 182, 212, 0.2)' : 'none',
      }}
    >
      {/* Hình chiếc ghế chờ 2.5D + Nhân vật ngồi trên ghế */}
      <div style={{ position: 'relative', width: 36, height: 42, flexShrink: 0 }}>
        <svg width={36} height={42} viewBox="0 0 36 42" style={{ position: 'absolute', inset: 0 }}>
          {/* Lưng ghế chờ */}
          <rect
            x="5"
            y="4"
            width="26"
            height="28"
            rx="6"
            fill={occupied ? '#0e7490' : '#1e293b'}
            stroke={occupied ? '#22d3ee' : '#475569'}
            strokeWidth="1.6"
          />
          {/* Đệm ghế chờ */}
          <rect
            x="3"
            y="29"
            width="30"
            height="8"
            rx="3.5"
            fill={occupied ? '#06b6d4' : '#334155'}
            stroke="#090d16"
            strokeWidth="1.4"
          />
        </svg>
        {occupied && (
          <div style={{ position: 'absolute', left: 2, top: 1, zIndex: 2 }}>
            <Character25D template={template} pose="idle" size={32} showShadow={false} />
          </div>
        )}
      </div>

      {/* Số thứ tự #1..#10 và tên người chờ (không bị xuống dòng hay cắt chữ) */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              background: occupied ? '#fbbf24' : '#334155',
              color: occupied ? '#090d1b' : '#cbd5e1',
              fontSize: 10,
              fontWeight: 900,
              padding: '1px 5px',
              borderRadius: 4,
              lineHeight: 1.15,
              whiteSpace: 'nowrap',
            }}
          >
            GHẾ #{pos}
          </span>
        </div>
        <div
          style={{
            fontSize: 11.5,
            fontWeight: 800,
            color: occupied ? '#ffffff' : '#64748b',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginTop: 2,
          }}
        >
          {occupied ? name : 'Đang trống'}
        </div>
      </div>
    </div>
  );
}

/**
 * Ghế khán giả 2.5D trên khán đài hình chữ U (vị trí ghế cụ thể, có người ngồi hoặc trống).
 */
export function AudienceSeatUnit25D({
  occupied,
  template = 0,
}: {
  occupied: boolean;
  template?: number;
}) {
  return (
    <div style={{ position: 'relative', width: 32, height: 36 }}>
      <svg width={32} height={36} viewBox="0 0 32 36" style={{ position: 'absolute', inset: 0 }}>
        <ellipse cx="16" cy="33" rx="12" ry="3" fill="rgba(0,0,0,0.45)" />
        <rect
          x="5"
          y="6"
          width="22"
          height="20"
          rx="5"
          fill={occupied ? '#1e3a8a' : '#0f172a'}
          stroke={occupied ? '#38bdf8' : '#334155'}
          strokeWidth="1.4"
        />
        <rect
          x="3"
          y="23"
          width="26"
          height="6.5"
          rx="3"
          fill={occupied ? '#ea580c' : '#1e293b'}
          stroke="#090d16"
          strokeWidth="1.2"
        />
      </svg>
      {occupied && (
        <div style={{ position: 'absolute', left: 1, top: -2, zIndex: 2 }}>
          <Character25D template={template} pose="idle" size={30} showShadow={false} />
        </div>
      )}
    </div>
  );
}
