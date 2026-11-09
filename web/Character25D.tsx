/**
 * Nhân vật 2.5D bằng SVG tự tạo của dự án GHẾ NÓNG (bản đầu — hình tạm vector rõ nét,
 * hoàn toàn không dùng ảnh nhân vật/nền của repo tham khảo).
 * Hỗ trợ 8 mẫu ngoại hình cố định theo tài khoản và các tư thế:
 * chờ suy nghĩ, đã trả lời, đúng, sai, đi xuống, đi lên, và MC dẫn chương trình (§10, §11).
 */
import React from 'react';

export type CharacterPose = 'idle' | 'thinking' | 'answered' | 'correct' | 'wrong' | 'departing' | 'entering' | 'mc';

const PALETTES = [
  { shirt: '#3b82f6', hair: '#1e293b', accent: '#93c5fd' },
  { shirt: '#ec4899', hair: '#3f2314', accent: '#f9a8d4' },
  { shirt: '#10b981', hair: '#0f172a', accent: '#6ee7b7' },
  { shirt: '#f59e0b', hair: '#451a03', accent: '#fde68a' },
  { shirt: '#8b5cf6', hair: '#1e1b4b', accent: '#c4b5fd' },
  { shirt: '#06b6d4', hair: '#18181b', accent: '#67e8f9' },
  { shirt: '#ef4444', hair: '#27272a', accent: '#fca5a5' },
  { shirt: '#14b8a6', hair: '#292524', accent: '#5eead4' },
];

export function Character25D({
  template = 0,
  pose = 'idle',
  size = 58,
  speaking = false,
}: {
  template?: number;
  pose?: CharacterPose;
  size?: number;
  speaking?: boolean;
}) {
  const pal = PALETTES[Math.abs(template) % PALETTES.length];
  const isMc = pose === 'mc';
  const shirtColor = isMc ? '#d97706' : pal.shirt;
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
      height={size * 1.15}
      viewBox="0 0 80 92"
      className={animClass}
      style={{ overflow: 'visible', filter: 'drop-shadow(0 5px 6px rgba(0,0,0,0.55))' }}
    >
      {/* Bóng đổ mặt sàn 2.5D */}
      <ellipse cx="40" cy="84" rx="22" ry="6" fill="rgba(0,0,0,0.48)" />

      {/* Thân áo 2.5D có khối sáng tối */}
      <path
        d="M20 78 C20 56, 60 56, 60 78 Z"
        fill={shirtColor}
        stroke="#0f172a"
        strokeWidth="2.5"
      />
      {/* Cổ áo / Cà vạt MC */}
      {isMc ? (
        <polygon points="40,56 36,68 40,74 44,68" fill="#fef08a" />
      ) : (
        <path d="M33 57 L40 64 L47 57" fill="none" stroke={pal.accent} strokeWidth="2.5" strokeLinecap="round" />
      )}

      {/* Tay trái & tay phải theo tư thế */}
      {pose === 'correct' ? (
        <>
          <path d="M22 64 L10 42" stroke={shirtColor} strokeWidth="7" strokeLinecap="round" />
          <circle cx="10" cy="41" r="5" fill="#fde68a" />
          <path d="M58 64 L70 42" stroke={shirtColor} strokeWidth="7" strokeLinecap="round" />
          <circle cx="70" cy="41" r="5" fill="#fde68a" />
        </>
      ) : pose === 'answered' ? (
        <>
          <path d="M58 64 L68 46" stroke={shirtColor} strokeWidth="7" strokeLinecap="round" />
          <circle cx="68" cy="45" r="5" fill="#fde68a" />
        </>
      ) : isMc ? (
        <>
          {/* Tay MC cầm micro */}
          <path d="M56 64 L66 52" stroke="#d97706" strokeWidth="7" strokeLinecap="round" />
          <line x1="66" y1="52" x2="62" y2="40" stroke="#94a3b8" strokeWidth="3" />
          <circle cx="61" cy="38" r="5" fill="#38bdf8" stroke="#0f172a" strokeWidth="1.5" />
        </>
      ) : null}

      {/* Đầu nhân vật */}
      <circle cx="40" cy="36" r="19" fill="#fed7aa" stroke="#0f172a" strokeWidth="2.5" />

      {/* Kiểu tóc theo template */}
      {template % 2 === 0 ? (
        <path d="M21 34 C21 16, 59 16, 59 34 C54 24, 26 24, 21 34 Z" fill={pal.hair} />
      ) : (
        <path d="M20 36 C19 15, 61 15, 60 36 C56 26, 46 22, 40 24 C34 22, 24 26, 20 36 Z" fill={pal.hair} />
      )}

      {/* Biểu cảm mắt & miệng */}
      {pose === 'wrong' || pose === 'departing' ? (
        <>
          <path d="M30 33 L35 37 M35 33 L30 37" stroke="#0f172a" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M45 33 L50 37 M50 33 L45 37" stroke="#0f172a" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M34 46 Q40 41 46 46" fill="none" stroke="#0f172a" strokeWidth="2.2" strokeLinecap="round" />
        </>
      ) : pose === 'correct' ? (
        <>
          <path d="M29 35 Q32.5 30 36 35" fill="none" stroke="#0f172a" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M44 35 Q47.5 30 51 35" fill="none" stroke="#0f172a" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M33 42 Q40 50 47 42 Z" fill="#ef4444" stroke="#0f172a" strokeWidth="1.5" />
        </>
      ) : (
        <>
          <circle cx="33" cy="35" r="2.6" fill="#0f172a" />
          <circle cx="47" cy="35" r="2.6" fill="#0f172a" />
          {speaking ? (
            <ellipse cx="40" cy="44" rx="4.5" ry="3.5" fill="#ef4444" />
          ) : (
            <path d="M35 44 Q40 48 45 44" fill="none" stroke="#0f172a" strokeWidth="2.2" strokeLinecap="round" />
          )}
        </>
      )}

      {/* Dấu trạng thái nhỏ trên đầu */}
      {pose === 'thinking' && (
        <g transform="translate(56, 12)">
          <circle cx="8" cy="8" r="9" fill="#1e293b" stroke="#fbbf24" strokeWidth="1.5" />
          <text x="8" y="12" textAnchor="middle" fill="#fbbf24" fontSize="11" fontWeight="800">
            ?
          </text>
        </g>
      )}
      {pose === 'answered' && (
        <g transform="translate(56, 12)">
          <circle cx="8" cy="8" r="9" fill="#065f46" stroke="#34d399" strokeWidth="1.5" />
          <text x="8" y="12" textAnchor="middle" fill="#ecfdf5" fontSize="10" fontWeight="800">
            ✓
          </text>
        </g>
      )}
    </svg>
  );
}
