/**
 * NGUỒN HƯỚNG DẪN DUY NHẤT cho cả chữ trên sân khấu và lời MC.
 * - Một dòng cố định về cách tham gia (luôn hiện trên sân khấu).
 * - Một dòng thay đổi theo giai đoạn:
 *   + Người mới vào xem / Chờ mở phiên: Các lệnh đang được sử dụng hiện tại
 *   + Câu hỏi mở: "Bình luận 23A · 23B · 23C · 23D" — mã lấy từ câu hiện tại
 *   + Có lời mời lên ghế: Tên người được mời, lệnh xác nhận và thời gian còn lại
 *   + Công bố kết quả: Quy tắc đúng được gì, sai thì chuyển đi đâu
 *   + Chuyển vòng: Cách tính thành tích và điều kiện thắng theo luật đang áp dụng
 * - Chữ hướng dẫn và lời MC dùng chung các hằng số này để luôn thống nhất 100%.
 */
import type { RuleConfig } from './rules';

/** Các lệnh đang có hiệu lực theo luật v1.0 (commands.ts) */
export const GUIDE_COMMANDS = ['VÀO', 'CHỜ', 'SS', 'HỦY', 'NHƯỜNG', 'ĐIỂM', 'VỊ TRÍ'] as const;

/** Dòng cố định về cách tham gia luôn hiển thị trên sân khấu */
export const JOIN_LINE =
  'CÁCH THAM GIA: Bình luận VÀO hoặc mã đáp án (1A..1D) → Tự vào 10 Ghế Chờ & 5 Ghế Nóng';

/** Nội dung hiển thị cho người mới vào xem: các lệnh đang được sử dụng hiện tại */
export const ACTIVE_COMMANDS_TEXT =
  'Các lệnh đang được sử dụng hiện tại: VÀO · CHỜ · 1A..1D · SS · HỦY · NHƯỜNG · ĐIỂM · VỊ TRÍ';

export interface StageGuide {
  /** Dòng cố định về cách tham gia */
  fixed: string;
  /** Nhãn giai đoạn của dòng hướng dẫn động */
  badge: string;
  /** Nội dung dòng hướng dẫn thay đổi theo giai đoạn */
  text: string;
  /** Khi có lời mời lên ghế: mốc hết hạn (ms) để giao diện cập nhật số giây còn lại theo thời gian thực */
  deadlineAt: number | null;
}

export interface GuideInput {
  phase: string;
  code: number | null;
  nextCode: number;
  invites: { name: string; seat: number; expiresAt: number }[];
  rules: Pick<RuleConfig, 'pointsCorrect' | 'milestones' | 'roundActiveMs' | 'inviteConfirmMs'>;
  /** Nếu vừa có người mới vào xem/tương tác lần đầu ở trạng thái chờ/chuyển câu */
  hasRecentNewcomer?: boolean;
}

export function joinVi(items: (string | number)[]): string {
  const xs = items.map(String).filter(Boolean);
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} và ${xs[xs.length - 1]}`;
}

export const answerSyntax = (code: number) => `${code}A · ${code}B · ${code}C · ${code}D`;

export function buildStageGuide(g: GuideInput): StageGuide {
  const pts = g.rules.pointsCorrect;
  const base = { fixed: JOIN_LINE, deadlineAt: null as number | null };

  switch (g.phase) {
    case 'OPEN': {
      const c = g.code ?? g.nextCode;
      return {
        ...base,
        badge: 'CÂU HỎI MỞ',
        text: `Bình luận ${answerSyntax(c)} — Đúng +${pts}đ, giữ ghế & +1 cấp`,
      };
    }
    case 'PREPARE': {
      const c = g.code ?? g.nextCode;
      if (g.hasRecentNewcomer) {
        return {
          ...base,
          badge: 'LỆNH ĐANG DÙNG',
          text: `${ACTIVE_COMMANDS_TEXT}`,
        };
      }
      return {
        ...base,
        badge: 'SẮP MỞ CÂU',
        text: `Bình luận ${answerSyntax(c)} ngay khi mở đề — Đúng +${pts}đ & +1 cấp`,
      };
    }
    case 'INVITING': {
      const shown = g.invites.slice(0, 2).map((i) => `${i.name} (Ghế ${i.seat})`);
      const more = Math.max(0, g.invites.length - shown.length);
      const deadline = g.invites.length ? Math.max(...g.invites.map((i) => i.expiresAt)) : null;
      const who = shown.length ? `${shown.join(', ')}${more > 0 ? ` +${more} bạn` : ''}` : 'Người chờ đầu hàng';
      return {
        ...base,
        badge: 'MỜI LÊN GHẾ',
        text: `${who} · Lệnh SS xác nhận ({sec}s) · HỦY nếu nhường`,
        deadlineAt: deadline,
      };
    }
    case 'REVEAL':
    case 'HONOR':
      return {
        ...base,
        badge: 'QUY TẮC KẾT QUẢ',
        text: `Đúng: +${pts}đ, giữ ghế & +1 cấp · Sai: về cuối hàng chờ · Không trả lời: rời ghế`,
      };
    case 'TRANSITION':
    case 'ROUND_BOARD':
      return {
        ...base,
        badge: 'CHUYỂN VÒNG',
        text: `Đúng +${pts}đ/câu · Vinh danh cấp ${g.rules.milestones.join('·')} · Thắng vòng: điểm hiệp ${Math.round(
          g.rules.roundActiveMs / 60_000,
        )}p cao nhất`,
      };
    default:
      return {
        ...base,
        badge: 'CÁC LỆNH HIỆN TẠI',
        text: ACTIVE_COMMANDS_TEXT,
      };
  }
}
