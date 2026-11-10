/**
 * Thông số luật — lấy NGUYÊN từ Bo_luat_Ghe_nong_v1.0.md. Không tự đổi số.
 * Mỗi số ghi kèm mục trong bộ luật để đối chiếu.
 * Thay đổi sau chạy thử phải nâng phiên bản luật (mục 1, 18) và chỉ áp dụng từ câu tiếp theo (mục 7, 15).
 */
export const RULES_VERSION = '1.0';

export interface RuleConfig {
  /** §1: 5 ghế nóng */
  hotSeats: number;
  /** §1, §4: 10 ghế chờ hiển thị */
  waitingSeats: number;
  /** §4.3: đếm ngược xác nhận lời mời */
  inviteConfirmMs: number;
  /** §4.6: tối đa 2 đợt mời mỗi lần chuyển câu */
  maxInviteWaves: number;
  /** §6: các giai đoạn của một câu */
  prepareMs: number;
  openMs: number;
  revealMs: number;
  honorMs: number;
  transitionMs: number;
  /** §8: đúng +10, sai/không trả lời +0 */
  pointsCorrect: number;
  /** §8, §10: mốc huy hiệu / vinh danh */
  milestones: number[];
  /** §3: lệnh điểm/vị trí chờ 15 giây mỗi người */
  infoCooldownMs: number;
  /** §4: 120 giây không có tương tác hợp lệ và không còn ghế nóng -> màn hình chờ */
  idleStandbyMs: number;
  /** §9: một hiệp 30 phút thời gian game hoạt động */
  roundActiveMs: number;
  /** §9: chốt bảng hiệp hiện 8 giây */
  roundBoardMs: number;
  /** §9: top 5 gọn ở sân khấu */
  leaderboardTop: number;
  /** §11: khán đài tối đa 40 nhân vật trong khung hình */
  audienceRenderMax: number;
  /** §13: hiệu ứng quà tối đa 2 giây */
  giftFxMs: number;
}

export const DEFAULT_RULES: RuleConfig = {
  hotSeats: 5,
  waitingSeats: 10,
  inviteConfirmMs: 12_000,
  maxInviteWaves: 2,
  prepareMs: 5_000,
  openMs: 30_000,
  revealMs: 7_000,
  honorMs: 4_500,
  transitionMs: 5_500,
  pointsCorrect: 10,
  milestones: [3, 6, 10, 15],
  infoCooldownMs: 15_000,
  idleStandbyMs: 120_000,
  roundActiveMs: 30 * 60_000,
  roundBoardMs: 8_000,
  leaderboardTop: 5,
  audienceRenderMax: 40,
  giftFxMs: 2_000,
};

/** §8: danh hiệu theo cấp lượt hiện tại */
export function rankTitle(level: number): string {
  if (level >= 15) return 'Huyền thoại';
  if (level >= 10) return 'Bậc thầy';
  if (level >= 6) return 'Cao thủ';
  if (level >= 3) return 'Đầu lạnh';
  if (level >= 1) return 'Khởi động';
  return 'Tân binh';
}

/** Các thông số hiển thị (không phải luật) — chỉnh được ở bảng điều khiển */
export interface DisplayConfig {
  safeTop: number;
  safeBottom: number;
  safeLeft: number;
  safeRight: number;
  ttsEnabled: boolean;
  sfxEnabled: boolean;
  reduceMotion: boolean;
}

export const DEFAULT_DISPLAY: DisplayConfig = {
  safeTop: 28,
  safeBottom: 28,
  safeLeft: 14,
  safeRight: 14,
  ttsEnabled: true,
  sfxEnabled: true,
  reduceMotion: false,
};

/** §19: luật ngắn hiện trong game */
export const SHORT_RULES =
  'Người chơi tự động vào 10 ghế chờ và tự đẩy lên 5 ghế nóng khi có ghế trống (đếm ngược 12s, không cần gõ CHỜ hay SS). Trả lời theo mã câu (ví dụ 1A, 1B). Đúng +10đ, ghế nóng tăng 1 cấp; sai hoặc hết giờ nhường ghế.';
