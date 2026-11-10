/**
 * BỘ ĐẠO DIỄN LỜI THOẠI MC THEO TÌNH HUỐNG & NGÂN HÀNG 180 CÂU THOẠI CÓ ĐIỀU KIỆN
 *
 * Nguyên tắc cốt lõi:
 * 1. Mỗi lời dẫn gắn với một sự kiện thật; mọi con số (số ghế, số người, chuỗi đúng, vị trí chờ, đáp án)
 *    đều lấy từ dữ liệu thật của GameEngine. Tuyệt đối không nói sai thực tế (ví dụ không nói "cả phòng đã trả lời"
 *    khi chưa có ai trả lời).
 * 2. Mỗi câu phụ dài 3–6 giây (3000–6000 ms). Trong 1 câu hỏi tối đa 1–2 câu phụ, cách nhau ít nhất 8 giây.
 * 3. Khi còn <= 5 giây trong pha OPEN: ngừng chào hỏi, cảm ơn quà và đùa; ưu tiên nhắc hết giờ (nhacGio).
 * 4. Không bắt đầu lời phụ nếu thời gian còn lại của pha không đủ phát hết.
 * 5. Người mới chỉ được chào theo lần tương tác hợp lệ đầu tiên; phòng đông gom tối đa 2–3 tên trong 1 lời chào.
 * 6. Quà liên tiếp được gom lời cảm ơn; có thời gian nghỉ gọi tên riêng cho từng người (không gọi tên dồn dập).
 * 7. Ngân hàng 180 câu chia 9 nhóm (mỗi nhóm 20 câu): xáo trộn từng nhóm, dùng hết câu phù hợp rồi mới quay lại;
 *    tránh lặp câu chữ và kiểu đùa (jokeStyle) ở các lượt gần nhau; hủy lời chào/cảm ơn quá cũ; kiểm tra lại
 *    điều kiện & vị trí thật ngay trước khi phát.
 * 8. Nhắc cách chơi khoảng 2–3 phút/lần, ưu tiên lúc chuyển câu hoặc đón người mới, thống nhất với chữ hướng dẫn.
 */
import { speakableName } from './filter';
import { joinVi } from './guide';

export type McCategory =
  | 'chaoHoi'
  | 'huongDan'
  | 'moiLenGhe'
  | 'choTraLoi'
  | 'nhacGio'
  | 'congBoKetQua'
  | 'dongVien'
  | 'vinhDanh'
  | 'camOnQua';

export type JokeStyle = 'warm' | 'witty' | 'dramatic' | 'fact' | 'cheer' | 'calm' | 'none';

export interface McDataContext {
  phase: string;
  round: number;
  code: number;
  topic: string;
  questionText: string;
  /** Số ghế nóng đang có người ngồi (0..5) */
  hotSeatedCount: number;
  /** Số ghế nóng còn trống (0..5) */
  emptySeatCount: number;
  /** Số ghế nóng đã khóa đáp án ở câu hiện tại */
  hotAnsweredCount: number;
  /** Số ghế nóng chưa trả lời ở câu hiện tại */
  hotRemainingCount: number;
  /** Tổng số người (ghế nóng + khán giả) đã khóa đáp án ở câu hiện tại */
  answeredCount: number;
  /** Số người đang ở ghế chờ hiển thị (0..10) */
  waitingCount: number;
  /** Tổng số người trong hàng chờ */
  queueTotal: number;
  /** Chuỗi đúng (cấp) cao nhất hiện tại trên ghế nóng */
  topStreakLevel: number;
  topStreakName: string;
  topStreakSeat: number;
  /** Dữ liệu mời lên ghế */
  invitedNamesText: string;
  invitedCount: number;
  inviteSec: number;
  /** Dữ liệu chào người mới (đã kiểm tra lại vị trí thực tế ngay trước khi phát) */
  welcomeNamesText: string;
  welcomeCount: number;
  welcomeExtraCount: number;
  welcomePositionNote: string;
  /** Dữ liệu công bố kết quả & vinh danh & động viên */
  correctChoice: string;
  totalCorrect: number;
  keepCount: number;
  eliminatedCount: number;
  eliminatedNamesText: string;
  honoredNamesText: string;
  honoredCount: number;
  honoredLevel: number;
  allFloorWon: boolean;
  /** Dữ liệu cảm ơn quà đã gom */
  giftSendersText: string;
  giftSenderCount: number;
  giftName: string;
  giftTotalCount: number;
  /** Thông số luật hiện hành */
  pointsCorrect: number;
  milestonesText: string;
}

export interface McDialogueTemplate {
  id: string;
  category: McCategory;
  situation: string;
  /** Thời lượng dự kiến (ms) — các câu phụ nằm trong khoảng 3000..6000 ms */
  durationMs: number;
  /** Các trường dữ liệu bắt buộc phải có thực trước khi phát */
  requiredFields: (keyof McDataContext)[];
  /** Thời gian tối thiểu trước khi câu này được phép dùng lại (ms) */
  cooldownMs: number;
  /** Kiểu giọng/đùa để không lặp kiểu đùa ở các lượt liên tiếp */
  jokeStyle: JokeStyle;
  /** Điều kiện thực tế phải thỏa mãn ngay tại thời điểm phát */
  when: (ctx: McDataContext) => boolean;
  /** Hàm dựng câu thoại từ dữ liệu thật */
  render: (ctx: McDataContext) => string;
}

export interface EmittedMcLine {
  id: number;
  text: string;
  at: number;
  category: McCategory;
  templateId: string;
  durationMs: number;
  isAux: boolean;
}

const hasAllFields = (ctx: McDataContext, fields: (keyof McDataContext)[]): boolean => {
  for (const f of fields) {
    const v = ctx[f];
    if (v === undefined || v === null || v === '') return false;
    if (typeof v === 'number' && Number.isNaN(v)) return false;
  }
  return true;
};

// ============================================================================
// NGÂN HÀNG 180 CÂU THOẠI CÓ ĐIỀU KIỆN (9 NHÓM × 20 CÂU = 180 CÂU)
// ============================================================================

const CHAO_HOI_TEMPLATES: McDialogueTemplate[] = [
  {
    id: 'chao_01',
    category: 'chaoHoi',
    situation: 'welcome_single_positioned',
    durationMs: 3800,
    requiredFields: ['welcomeNamesText', 'welcomePositionNote'],
    cooldownMs: 90_000,
    jokeStyle: 'warm',
    when: (c) => c.welcomeCount === 1 && Boolean(c.welcomePositionNote),
    render: (c) => `Chào mừng ${c.welcomeNamesText} vừa nhập cuộc, bạn đang ở ${c.welcomePositionNote} nhé!`,
  },
  {
    id: 'chao_02',
    category: 'chaoHoi',
    situation: 'welcome_single_positioned',
    durationMs: 3900,
    requiredFields: ['welcomeNamesText', 'welcomePositionNote'],
    cooldownMs: 90_000,
    jokeStyle: 'cheer',
    when: (c) => c.welcomeCount === 1 && Boolean(c.welcomePositionNote),
    render: (c) => `Rất vui đón ${c.welcomeNamesText} vào trường quay, vị trí của bạn là ${c.welcomePositionNote}!`,
  },
  {
    id: 'chao_03',
    category: 'chaoHoi',
    situation: 'welcome_single_positioned',
    durationMs: 4100,
    requiredFields: ['welcomeNamesText', 'welcomePositionNote'],
    cooldownMs: 90_000,
    jokeStyle: 'witty',
    when: (c) => c.welcomeCount === 1 && Boolean(c.welcomePositionNote),
    render: (c) => `${c.welcomeNamesText} đã điểm danh thành công tại ${c.welcomePositionNote}, khởi động tay săn điểm thôi!`,
  },
  {
    id: 'chao_04',
    category: 'chaoHoi',
    situation: 'welcome_single_positioned',
    durationMs: 3700,
    requiredFields: ['welcomeNamesText', 'welcomePositionNote'],
    cooldownMs: 90_000,
    jokeStyle: 'calm',
    when: (c) => c.welcomeCount === 1 && Boolean(c.welcomePositionNote),
    render: (c) => `Xin chào ${c.welcomeNamesText}, hệ thống đã xếp bạn vào ${c.welcomePositionNote}.`,
  },
  {
    id: 'chao_05',
    category: 'chaoHoi',
    situation: 'welcome_single_positioned',
    durationMs: 4000,
    requiredFields: ['welcomeNamesText', 'welcomePositionNote'],
    cooldownMs: 90_000,
    jokeStyle: 'fact',
    when: (c) => c.welcomeCount === 1 && Boolean(c.welcomePositionNote),
    render: (c) => `Ghi nhận ${c.welcomeNamesText} tham gia phiên chơi, hiện bạn đứng ở ${c.welcomePositionNote}.`,
  },
  {
    id: 'chao_06',
    category: 'chaoHoi',
    situation: 'welcome_single_general',
    durationMs: 3500,
    requiredFields: ['welcomeNamesText'],
    cooldownMs: 90_000,
    jokeStyle: 'warm',
    when: (c) => c.welcomeCount === 1,
    render: (c) => `Chào mừng ${c.welcomeNamesText} đến với trường quay Ghế Nóng hôm nay!`,
  },
  {
    id: 'chao_07',
    category: 'chaoHoi',
    situation: 'welcome_single_general',
    durationMs: 3800,
    requiredFields: ['welcomeNamesText', 'pointsCorrect'],
    cooldownMs: 90_000,
    jokeStyle: 'cheer',
    when: (c) => c.welcomeCount === 1,
    render: (c) => `Đón chào ${c.welcomeNamesText}, mỗi câu trả lời đúng sẽ mang về ngay ${c.pointsCorrect} điểm!`,
  },
  {
    id: 'chao_08',
    category: 'chaoHoi',
    situation: 'welcome_single_general',
    durationMs: 3900,
    requiredFields: ['welcomeNamesText'],
    cooldownMs: 90_000,
    jokeStyle: 'witty',
    when: (c) => c.welcomeCount === 1,
    render: (c) => `${c.welcomeNamesText} vừa vào sân rồi, chúc bạn sớm chiếm được chiếc ghế nóng đỏ cam nhé!`,
  },
  {
    id: 'chao_09',
    category: 'chaoHoi',
    situation: 'welcome_group_2_3',
    durationMs: 4300,
    requiredFields: ['welcomeNamesText', 'welcomeCount'],
    cooldownMs: 90_000,
    jokeStyle: 'warm',
    when: (c) => c.welcomeCount >= 2 && c.welcomeExtraCount === 0,
    render: (c) => `Chào mừng ${c.welcomeNamesText} vừa cùng lúc gia nhập trường quay Ghế Nóng!`,
  },
  {
    id: 'chao_10',
    category: 'chaoHoi',
    situation: 'welcome_group_2_3',
    durationMs: 4500,
    requiredFields: ['welcomeNamesText', 'welcomeCount'],
    cooldownMs: 90_000,
    jokeStyle: 'cheer',
    when: (c) => c.welcomeCount >= 2 && c.welcomeExtraCount === 0,
    render: (c) => `Không khí nóng lên rồi, xin chào ${c.welcomeNamesText} vừa vào hàng ghế chờ!`,
  },
  {
    id: 'chao_11',
    category: 'chaoHoi',
    situation: 'welcome_group_2_3',
    durationMs: 4400,
    requiredFields: ['welcomeNamesText', 'welcomeCount'],
    cooldownMs: 90_000,
    jokeStyle: 'witty',
    when: (c) => c.welcomeCount >= 2 && c.welcomeExtraCount === 0,
    render: (c) => `Đón liền tay ${c.welcomeNamesText}, các đối thủ trên ghế nóng coi chừng nha!`,
  },
  {
    id: 'chao_12',
    category: 'chaoHoi',
    situation: 'welcome_group_2_3',
    durationMs: 4200,
    requiredFields: ['welcomeNamesText', 'welcomeCount'],
    cooldownMs: 90_000,
    jokeStyle: 'fact',
    when: (c) => c.welcomeCount >= 2 && c.welcomeExtraCount === 0,
    render: (c) => `Hệ thống vừa ghi nhận ${c.welcomeNamesText} vào danh sách thi đấu chính thức.`,
  },
  {
    id: 'chao_13',
    category: 'chaoHoi',
    situation: 'welcome_group_crowded',
    durationMs: 4700,
    requiredFields: ['welcomeNamesText', 'welcomeExtraCount'],
    cooldownMs: 90_000,
    jokeStyle: 'warm',
    when: (c) => c.welcomeCount >= 2 && c.welcomeExtraCount > 0,
    render: (c) => `Chào mừng ${c.welcomeNamesText} cùng ${c.welcomeExtraCount} bạn mới vừa nhập cuộc!`,
  },
  {
    id: 'chao_14',
    category: 'chaoHoi',
    situation: 'welcome_group_crowded',
    durationMs: 4800,
    requiredFields: ['welcomeNamesText', 'welcomeExtraCount'],
    cooldownMs: 90_000,
    jokeStyle: 'cheer',
    when: (c) => c.welcomeCount >= 2 && c.welcomeExtraCount > 0,
    render: (c) => `Trường quay đông vui quá, xin chào ${c.welcomeNamesText} và ${c.welcomeExtraCount} bạn vừa tham gia!`,
  },
  {
    id: 'chao_15',
    category: 'chaoHoi',
    situation: 'welcome_group_crowded',
    durationMs: 4600,
    requiredFields: ['welcomeNamesText', 'welcomeExtraCount'],
    cooldownMs: 90_000,
    jokeStyle: 'fact',
    when: (c) => c.welcomeCount >= 2 && c.welcomeExtraCount > 0,
    render: (c) => `Đã xếp chỗ cho ${c.welcomeNamesText} cùng ${c.welcomeExtraCount} người chơi mới vào hàng chờ.`,
  },
  {
    id: 'chao_16',
    category: 'chaoHoi',
    situation: 'welcome_group_crowded',
    durationMs: 4900,
    requiredFields: ['welcomeNamesText', 'welcomeExtraCount'],
    cooldownMs: 90_000,
    jokeStyle: 'witty',
    when: (c) => c.welcomeCount >= 2 && c.welcomeExtraCount > 0,
    render: (c) => `Đoàn quân mới gồm ${c.welcomeNamesText} và ${c.welcomeExtraCount} bạn nữa đã sẵn sàng săn ghế nóng!`,
  },
  {
    id: 'chao_17',
    category: 'chaoHoi',
    situation: 'welcome_any',
    durationMs: 3900,
    requiredFields: ['welcomeNamesText'],
    cooldownMs: 90_000,
    jokeStyle: 'calm',
    when: (c) => c.welcomeCount >= 1,
    render: (c) => `Chào đón ${c.welcomeNamesText}, bạn nhớ theo dõi mã câu trên màn hình để trả lời nhé.`,
  },
  {
    id: 'chao_18',
    category: 'chaoHoi',
    situation: 'welcome_any',
    durationMs: 4100,
    requiredFields: ['welcomeNamesText', 'waitingCount'],
    cooldownMs: 90_000,
    jokeStyle: 'fact',
    when: (c) => c.welcomeCount >= 1 && c.waitingCount > 0,
    render: (c) => `Xin chào ${c.welcomeNamesText}, khu ghế chờ hiện có ${c.waitingCount} bạn đang trực chờ lên sân.`,
  },
  {
    id: 'chao_19',
    category: 'chaoHoi',
    situation: 'welcome_any',
    durationMs: 4000,
    requiredFields: ['welcomeNamesText'],
    cooldownMs: 90_000,
    jokeStyle: 'warm',
    when: (c) => c.welcomeCount >= 1,
    render: (c) => `Rất vui có thêm ${c.welcomeNamesText} đồng hành ở vòng ${c.round} của Ghế Nóng!`,
  },
  {
    id: 'chao_20',
    category: 'chaoHoi',
    situation: 'welcome_any',
    durationMs: 4200,
    requiredFields: ['welcomeNamesText'],
    cooldownMs: 90_000,
    jokeStyle: 'cheer',
    when: (c) => c.welcomeCount >= 1,
    render: (c) => `Chào ${c.welcomeNamesText}, ngay khi có ghế trống hệ thống sẽ tự đẩy người chờ lên ghế nóng!`,
  },
];

const HUONG_DAN_TEMPLATES: McDialogueTemplate[] = [
  {
    id: 'hd_01',
    category: 'huongDan',
    situation: 'guide_periodic',
    durationMs: 4800,
    requiredFields: ['pointsCorrect'],
    cooldownMs: 180_000,
    jokeStyle: 'fact',
    when: (c) => c.phase !== 'OPEN',
    render: (c) => `Nhắc nhẹ cách chơi: gõ VÀO hoặc trả lời mã câu như 1A, 1B để tự vào ghế chờ và nhận ${c.pointsCorrect} điểm mỗi câu đúng.`,
  },
  {
    id: 'hd_02',
    category: 'huongDan',
    situation: 'guide_periodic',
    durationMs: 4700,
    requiredFields: ['pointsCorrect'],
    cooldownMs: 180_000,
    jokeStyle: 'warm',
    when: (c) => c.phase !== 'OPEN',
    render: (c) => `Bạn mới vào chỉ cần bình luận VÀO hoặc gõ mã câu kèm đáp án, hệ thống tự xếp vào 10 ghế chờ và 5 ghế nóng.`,
  },
  {
    id: 'hd_03',
    category: 'huongDan',
    situation: 'guide_periodic',
    durationMs: 4600,
    requiredFields: ['pointsCorrect'],
    cooldownMs: 180_000,
    jokeStyle: 'calm',
    when: (c) => c.phase !== 'OPEN',
    render: (c) => `Trên sân khấu chỉ khóa đáp án hợp lệ đầu tiên cho mỗi câu; đúng cộng ${c.pointsCorrect} điểm và tăng 1 cấp ghế nóng.`,
  },
  {
    id: 'hd_04',
    category: 'huongDan',
    situation: 'guide_periodic',
    durationMs: 4500,
    requiredFields: ['milestonesText'],
    cooldownMs: 180_000,
    jokeStyle: 'cheer',
    when: (c) => c.phase !== 'OPEN',
    render: (c) => `Giữ ghế nóng trả lời đúng liên tiếp đạt các mốc cấp ${c.milestonesText} sẽ được vinh danh giữa màn hình!`,
  },
  {
    id: 'hd_05',
    category: 'huongDan',
    situation: 'guide_periodic',
    durationMs: 4600,
    requiredFields: ['pointsCorrect'],
    cooldownMs: 180_000,
    jokeStyle: 'fact',
    when: (c) => c.phase !== 'OPEN',
    render: () => `Các lệnh đang dùng trên sân khấu: gõ VÀO để tham gia, ĐIỂM để xem điểm, VỊ TRÍ để xem thứ tự chờ.`,
  },
  {
    id: 'hd_06',
    category: 'huongDan',
    situation: 'guide_periodic',
    durationMs: 4700,
    requiredFields: ['inviteSec'],
    cooldownMs: 180_000,
    jokeStyle: 'calm',
    when: (c) => c.phase !== 'OPEN',
    render: (c) => `Khi được mời lên ghế nóng, bạn tự động vào ghế sau ${c.inviteSec} giây, hoặc gõ SS vào ngay, gõ HỦY nếu muốn nhường.`,
  },
  {
    id: 'hd_07',
    category: 'huongDan',
    situation: 'guide_periodic',
    durationMs: 4500,
    requiredFields: ['pointsCorrect'],
    cooldownMs: 180_000,
    jokeStyle: 'witty',
    when: (c) => c.phase !== 'OPEN',
    render: (c) => `Ngồi khán đài trả lời đúng vẫn bỏ túi ${c.pointsCorrect} điểm như thường, vừa tích điểm vừa chờ tới lượt lên ghế nóng nhé!`,
  },
  {
    id: 'hd_08',
    category: 'huongDan',
    situation: 'guide_periodic',
    durationMs: 4800,
    requiredFields: ['pointsCorrect'],
    cooldownMs: 180_000,
    jokeStyle: 'fact',
    when: (c) => c.phase !== 'OPEN',
    render: () => `Lưu ý quy tắc ghế nóng: trả lời sai sẽ rời ghế về cuối hàng chờ, còn bỏ trống không trả lời sẽ tắt tự xếp lại.`,
  },
  {
    id: 'hd_09',
    category: 'huongDan',
    situation: 'guide_periodic',
    durationMs: 4400,
    requiredFields: ['code'],
    cooldownMs: 180_000,
    jokeStyle: 'warm',
    when: (c) => c.phase !== 'OPEN' && c.code > 0,
    render: (c) => `Ở câu số ${c.code} sắp tới, bạn nhớ gõ đúng mã câu ghép với A, B, C hoặc D nhé!`,
  },
  {
    id: 'hd_10',
    category: 'huongDan',
    situation: 'guide_periodic',
    durationMs: 4500,
    requiredFields: ['pointsCorrect'],
    cooldownMs: 180_000,
    jokeStyle: 'calm',
    when: (c) => c.phase !== 'OPEN',
    render: () => `Nếu đang ngồi ghế nóng mà bận việc, bạn có thể bình luận NHƯỜNG để nhường vị trí cho hàng chờ.`,
  },
  {
    id: 'hd_11',
    category: 'huongDan',
    situation: 'guide_periodic',
    durationMs: 4600,
    requiredFields: ['pointsCorrect'],
    cooldownMs: 180_000,
    jokeStyle: 'cheer',
    when: (c) => c.phase !== 'OPEN',
    render: (c) => `Mỗi câu đúng đều cộng ${c.pointsCorrect} điểm vào bảng xếp hạng phiên, cả ghế nóng lẫn khán giả đều có cơ hội đua top!`,
  },
  {
    id: 'hd_12',
    category: 'huongDan',
    situation: 'guide_periodic',
    durationMs: 4400,
    requiredFields: ['pointsCorrect'],
    cooldownMs: 180_000,
    jokeStyle: 'fact',
    when: (c) => c.phase !== 'OPEN',
    render: () => `Nhớ gõ kèm số câu trước chữ cái đáp án, ví dụ 1A hoặc 2B, gõ chữ cái lẻ hệ thống sẽ không tính đâu nhé.`,
  },
  {
    id: 'hd_13',
    category: 'huongDan',
    situation: 'guide_periodic',
    durationMs: 4600,
    requiredFields: ['pointsCorrect'],
    cooldownMs: 180_000,
    jokeStyle: 'warm',
    when: (c) => c.phase !== 'OPEN',
    render: () => `10 ghế chờ luôn tự động đón người chơi mới khi còn chỗ trống, bạn không cần phải spam lệnh nhiều lần.`,
  },
  {
    id: 'hd_14',
    category: 'huongDan',
    situation: 'guide_periodic',
    durationMs: 4500,
    requiredFields: ['milestonesText'],
    cooldownMs: 180_000,
    jokeStyle: 'dramatic',
    when: (c) => c.phase !== 'OPEN',
    render: (c) => `Ai trụ vững trên ghế nóng qua các mốc cấp ${c.milestonesText} sẽ ghi danh kỷ lục của phiên live hôm nay!`,
  },
  {
    id: 'hd_15',
    category: 'huongDan',
    situation: 'guide_periodic',
    durationMs: 4300,
    requiredFields: ['pointsCorrect'],
    cooldownMs: 180_000,
    jokeStyle: 'calm',
    when: (c) => c.phase !== 'OPEN',
    render: () => `Bạn muốn kiểm tra thành tích cá nhân chỉ cần bình luận ĐIỂM, kết quả sẽ hiện ngay dưới màn hình.`,
  },
  {
    id: 'hd_16',
    category: 'huongDan',
    situation: 'guide_periodic',
    durationMs: 4500,
    requiredFields: ['pointsCorrect'],
    cooldownMs: 180_000,
    jokeStyle: 'witty',
    when: (c) => c.phase !== 'OPEN',
    render: () => `Bí quyết giữ ghế nóng rất đơn giản: nhìn kỹ mã câu, chốt một đáp án duy nhất thật chuẩn trước khi hết giờ!`,
  },
  {
    id: 'hd_17',
    category: 'huongDan',
    situation: 'guide_periodic',
    durationMs: 4600,
    requiredFields: ['pointsCorrect'],
    cooldownMs: 180_000,
    jokeStyle: 'fact',
    when: (c) => c.phase !== 'OPEN',
    render: () => `Người mới lên ghế nóng sẽ bắt đầu từ cấp 0 của lượt giữ ghế mới, hoàn toàn công bằng cho mọi lượt đấu.`,
  },
  {
    id: 'hd_18',
    category: 'huongDan',
    situation: 'guide_periodic',
    durationMs: 4400,
    requiredFields: ['pointsCorrect'],
    cooldownMs: 180_000,
    jokeStyle: 'warm',
    when: (c) => c.phase !== 'OPEN',
    render: () => `Chữ hướng dẫn ngay dưới bảng câu hỏi luôn cập nhật theo từng giai đoạn để các bạn tiện theo dõi.`,
  },
  {
    id: 'hd_19',
    category: 'huongDan',
    situation: 'guide_periodic',
    durationMs: 4500,
    requiredFields: ['pointsCorrect'],
    cooldownMs: 180_000,
    jokeStyle: 'cheer',
    when: (c) => c.phase !== 'OPEN',
    render: (c) => `Gõ VÀO để giữ chỗ hàng chờ, trả lời đúng nhận ${c.pointsCorrect} điểm và sẵn sàng bước lên 5 chiếc ghế nóng!`,
  },
  {
    id: 'hd_20',
    category: 'huongDan',
    situation: 'guide_periodic',
    durationMs: 4500,
    requiredFields: ['pointsCorrect'],
    cooldownMs: 180_000,
    jokeStyle: 'calm',
    when: (c) => c.phase !== 'OPEN',
    render: () => `Mỗi người chơi chỉ chiếm một vị trí duy nhất trên sân, đảm bảo cơ hội lên ghế nóng chia đều cho cả phòng.`,
  },
];

const MOI_LEN_GHE_TEMPLATES: McDialogueTemplate[] = [
  {
    id: 'moi_01',
    category: 'moiLenGhe',
    situation: 'invite_wave',
    durationMs: 4500,
    requiredFields: ['invitedNamesText', 'inviteSec'],
    cooldownMs: 60_000,
    jokeStyle: 'cheer',
    when: (c) => c.invitedCount >= 1,
    render: (c) => `Xin mời ${c.invitedNamesText} chuẩn bị lên ghế nóng sau ${c.inviteSec} giây, hoặc gõ SS để vào ghế ngay!`,
  },
  {
    id: 'moi_02',
    category: 'moiLenGhe',
    situation: 'invite_wave',
    durationMs: 4600,
    requiredFields: ['invitedNamesText', 'inviteSec'],
    cooldownMs: 60_000,
    jokeStyle: 'warm',
    when: (c) => c.invitedCount >= 1,
    render: (c) => `Cơ hội tới rồi! Đón ${c.invitedNamesText} tiến lên ghế nóng, hệ thống tự xếp ghế sau ${c.inviteSec} giây.`,
  },
  {
    id: 'moi_03',
    category: 'moiLenGhe',
    situation: 'invite_wave',
    durationMs: 4400,
    requiredFields: ['invitedNamesText', 'inviteSec'],
    cooldownMs: 60_000,
    jokeStyle: 'fact',
    when: (c) => c.invitedCount >= 1,
    render: (c) => `Mời ${c.invitedNamesText} vào vị trí ghế nóng, đếm ngược ${c.inviteSec} giây chuẩn bị bắt đầu!`,
  },
  {
    id: 'moi_04',
    category: 'moiLenGhe',
    situation: 'invite_wave',
    durationMs: 4700,
    requiredFields: ['invitedNamesText', 'inviteSec'],
    cooldownMs: 60_000,
    jokeStyle: 'dramatic',
    when: (c) => c.invitedCount >= 1,
    render: (c) => `Đèn sân khấu đã hướng về ${c.invitedNamesText}, chỉ ${c.inviteSec} giây nữa bạn sẽ chính thức ngồi ghế nóng!`,
  },
  {
    id: 'moi_05',
    category: 'moiLenGhe',
    situation: 'invite_wave',
    durationMs: 4600,
    requiredFields: ['invitedNamesText', 'inviteSec'],
    cooldownMs: 60_000,
    jokeStyle: 'witty',
    when: (c) => c.invitedCount >= 1,
    render: (c) => `Ghế nóng gọi tên ${c.invitedNamesText}! Gõ SS nếu muốn ngồi liền, hoặc chờ ${c.inviteSec} giây hệ thống tự đẩy lên nhé.`,
  },
  {
    id: 'moi_06',
    category: 'moiLenGhe',
    situation: 'invite_wave',
    durationMs: 4500,
    requiredFields: ['invitedNamesText', 'inviteSec'],
    cooldownMs: 60_000,
    jokeStyle: 'calm',
    when: (c) => c.invitedCount >= 1,
    render: (c) => `Hàng chờ vừa đẩy ${c.invitedNamesText} lên ghế trống, bạn có ${c.inviteSec} giây chuẩn bị hoặc gõ HỦY nếu nhường.`,
  },
  {
    id: 'moi_07',
    category: 'moiLenGhe',
    situation: 'invite_wave',
    durationMs: 4500,
    requiredFields: ['invitedNamesText', 'inviteSec'],
    cooldownMs: 60_000,
    jokeStyle: 'cheer',
    when: (c) => c.invitedCount >= 2,
    render: (c) => `Chào đón loạt chiến binh mới: ${c.invitedNamesText} chuẩn bị bước lên ghế nóng sau ${c.inviteSec} giây!`,
  },
  {
    id: 'moi_08',
    category: 'moiLenGhe',
    situation: 'invite_wave',
    durationMs: 4400,
    requiredFields: ['invitedNamesText', 'inviteSec'],
    cooldownMs: 60_000,
    jokeStyle: 'warm',
    when: (c) => c.invitedCount === 1,
    render: (c) => `Một chiếc ghế trống đang chờ ${c.invitedNamesText}, sẵn sàng nhập cuộc sau ${c.inviteSec} giây nhé!`,
  },
  {
    id: 'moi_09',
    category: 'moiLenGhe',
    situation: 'invite_wave',
    durationMs: 4600,
    requiredFields: ['invitedNamesText', 'inviteSec', 'waitingCount'],
    cooldownMs: 60_000,
    jokeStyle: 'fact',
    when: (c) => c.invitedCount >= 1,
    render: (c) => `Mời ${c.invitedNamesText} lên ghế nóng sau ${c.inviteSec} giây; khu ghế chờ phía dưới hiện có ${c.waitingCount} bạn kế tiếp.`,
  },
  {
    id: 'moi_10',
    category: 'moiLenGhe',
    situation: 'invite_wave',
    durationMs: 4500,
    requiredFields: ['invitedNamesText', 'inviteSec'],
    cooldownMs: 60_000,
    jokeStyle: 'dramatic',
    when: (c) => c.invitedCount === 5,
    render: (c) => `Cả 5 ghế nóng cùng mở đón ${c.invitedNamesText}, đếm ngược ${c.inviteSec} giây trước khi vào câu hỏi mới!`,
  },
  {
    id: 'moi_11',
    category: 'moiLenGhe',
    situation: 'invite_wave',
    durationMs: 4400,
    requiredFields: ['invitedNamesText', 'inviteSec'],
    cooldownMs: 60_000,
    jokeStyle: 'witty',
    when: (c) => c.invitedCount >= 1,
    render: (c) => `${c.invitedNamesText} ơi, ghế đỏ cam êm lắm nhưng cũng nóng lắm đấy, ${c.inviteSec} giây chuẩn bị bắt đầu!`,
  },
  {
    id: 'moi_12',
    category: 'moiLenGhe',
    situation: 'invite_wave',
    durationMs: 4500,
    requiredFields: ['invitedNamesText', 'inviteSec'],
    cooldownMs: 60_000,
    jokeStyle: 'cheer',
    when: (c) => c.invitedCount >= 1,
    render: (c) => `Mời ${c.invitedNamesText} tiến lên sân khấu chính, sau ${c.inviteSec} giây chúng ta sẽ mở câu hỏi kế tiếp!`,
  },
  {
    id: 'moi_13',
    category: 'moiLenGhe',
    situation: 'invite_wave',
    durationMs: 4300,
    requiredFields: ['invitedNamesText', 'inviteSec'],
    cooldownMs: 60_000,
    jokeStyle: 'calm',
    when: (c) => c.invitedCount >= 1,
    render: (c) => `Đang chuyển ghế cho ${c.invitedNamesText}, thời gian chuẩn bị là ${c.inviteSec} giây.`,
  },
  {
    id: 'moi_14',
    category: 'moiLenGhe',
    situation: 'invite_wave',
    durationMs: 4600,
    requiredFields: ['invitedNamesText', 'inviteSec'],
    cooldownMs: 60_000,
    jokeStyle: 'warm',
    when: (c) => c.invitedCount >= 1,
    render: (c) => `Xin chúc mừng ${c.invitedNamesText} đã tới lượt lên ghế nóng, chỉ ${c.inviteSec} giây nữa là vào trận!`,
  },
  {
    id: 'moi_15',
    category: 'moiLenGhe',
    situation: 'invite_wave',
    durationMs: 4500,
    requiredFields: ['invitedNamesText', 'inviteSec'],
    cooldownMs: 60_000,
    jokeStyle: 'fact',
    when: (c) => c.invitedCount >= 1,
    render: (c) => `Lượt mời ghế nóng: ${c.invitedNamesText}. Bạn có thể gõ SS để vào ngay hoặc đợi hết ${c.inviteSec} giây.`,
  },
  {
    id: 'moi_16',
    category: 'moiLenGhe',
    situation: 'invite_wave',
    durationMs: 4400,
    requiredFields: ['invitedNamesText', 'inviteSec'],
    cooldownMs: 60_000,
    jokeStyle: 'dramatic',
    when: (c) => c.invitedCount >= 1,
    render: (c) => `Sân khấu đang chờ ${c.invitedNamesText} tỏa sáng, ${c.inviteSec} giây chuẩn bị lên ghế nóng bắt đầu!`,
  },
  {
    id: 'moi_17',
    category: 'moiLenGhe',
    situation: 'invite_wave',
    durationMs: 4500,
    requiredFields: ['invitedNamesText', 'inviteSec'],
    cooldownMs: 60_000,
    jokeStyle: 'witty',
    when: (c) => c.invitedCount >= 1,
    render: (c) => `Tới lượt ${c.invitedNamesText} lên thử lửa rồi, hít thở sâu trong ${c.inviteSec} giây nhé!`,
  },
  {
    id: 'moi_18',
    category: 'moiLenGhe',
    situation: 'invite_wave',
    durationMs: 4400,
    requiredFields: ['invitedNamesText', 'inviteSec'],
    cooldownMs: 60_000,
    jokeStyle: 'cheer',
    when: (c) => c.invitedCount >= 1,
    render: (c) => `Cho một tràng pháo tay đón ${c.invitedNamesText} lên ghế nóng sau ${c.inviteSec} giây chuẩn bị!`,
  },
  {
    id: 'moi_19',
    category: 'moiLenGhe',
    situation: 'invite_wave',
    durationMs: 4500,
    requiredFields: ['invitedNamesText', 'inviteSec'],
    cooldownMs: 60_000,
    jokeStyle: 'warm',
    when: (c) => c.invitedCount >= 1,
    render: (c) => `Mời ${c.invitedNamesText} nhận vị trí trên sân khấu, hệ thống tự động khóa ghế sau ${c.inviteSec} giây.`,
  },
  {
    id: 'moi_20',
    category: 'moiLenGhe',
    situation: 'invite_wave',
    durationMs: 4600,
    requiredFields: ['invitedNamesText', 'inviteSec'],
    cooldownMs: 60_000,
    jokeStyle: 'calm',
    when: (c) => c.invitedCount >= 1,
    render: (c) => `Đang đón ${c.invitedNamesText} từ hàng ghế chờ lên ghế nóng trong ${c.inviteSec} giây.`,
  },
];

const CHO_TRA_LOI_TEMPLATES: McDialogueTemplate[] = [
  // Khi thực tế CHƯA CÓ AI trả lời (answeredCount === 0)
  {
    id: 'cho_01',
    category: 'choTraLoi',
    situation: 'no_answers_yet',
    durationMs: 3800,
    requiredFields: ['code'],
    cooldownMs: 75_000,
    jokeStyle: 'fact',
    when: (c) => c.phase === 'OPEN' && c.answeredCount === 0,
    render: (c) => `Hiện chưa có đáp án nào được khóa cho câu ${c.code}, các bạn gõ ${c.code}A đến ${c.code}D nhé!`,
  },
  {
    id: 'cho_02',
    category: 'choTraLoi',
    situation: 'no_answers_yet',
    durationMs: 3900,
    requiredFields: ['code', 'topic'],
    cooldownMs: 75_000,
    jokeStyle: 'witty',
    when: (c) => c.phase === 'OPEN' && c.answeredCount === 0,
    render: (c) => `Câu ${c.code} chủ đề ${c.topic} đang khiến cả phòng đắn đo, ai sẽ là người mở hàng đáp án đầu tiên đây?`,
  },
  {
    id: 'cho_03',
    category: 'choTraLoi',
    situation: 'no_answers_yet',
    durationMs: 3700,
    requiredFields: ['code', 'hotSeatedCount'],
    cooldownMs: 75_000,
    jokeStyle: 'dramatic',
    when: (c) => c.phase === 'OPEN' && c.answeredCount === 0 && c.hotSeatedCount > 0,
    render: (c) => `Cả ${c.hotSeatedCount} ghế nóng vẫn đang suy nghĩ rất kỹ, chưa ai vội chốt câu ${c.code}.`,
  },
  {
    id: 'cho_04',
    category: 'choTraLoi',
    situation: 'no_answers_yet',
    durationMs: 3600,
    requiredFields: ['code'],
    cooldownMs: 75_000,
    jokeStyle: 'calm',
    when: (c) => c.phase === 'OPEN' && c.answeredCount === 0,
    render: (c) => `Các bạn cứ bình tĩnh đọc kỹ đề câu ${c.code}, nhớ gõ kèm số câu trước chữ cái đáp án nhé.`,
  },
  // Khi đã có một số ghế nóng trả lời nhưng chưa đủ (0 < hotAnsweredCount < hotSeatedCount)
  {
    id: 'cho_05',
    category: 'choTraLoi',
    situation: 'partial_hot_answered',
    durationMs: 4100,
    requiredFields: ['hotAnsweredCount', 'hotSeatedCount', 'hotRemainingCount'],
    cooldownMs: 75_000,
    jokeStyle: 'fact',
    when: (c) => c.phase === 'OPEN' && c.hotAnsweredCount > 0 && c.hotRemainingCount > 0,
    render: (c) => `Đã có ${c.hotAnsweredCount} trên ${c.hotSeatedCount} ghế nóng khóa đáp án, còn ${c.hotRemainingCount} ghế đang cân nhắc.`,
  },
  {
    id: 'cho_06',
    category: 'choTraLoi',
    situation: 'partial_hot_answered',
    durationMs: 4000,
    requiredFields: ['hotRemainingCount', 'code', 'answeredCount'],
    cooldownMs: 75_000,
    jokeStyle: 'dramatic',
    when: (c) => c.phase === 'OPEN' && c.hotAnsweredCount > 0 && c.hotRemainingCount > 0,
    render: (c) => `Toàn trường quay đã có ${c.answeredCount} người chốt câu ${c.code}, vẫn còn ${c.hotRemainingCount} ghế nóng chưa ra quyết định!`,
  },
  {
    id: 'cho_07',
    category: 'choTraLoi',
    situation: 'partial_hot_answered',
    durationMs: 3900,
    requiredFields: ['hotAnsweredCount', 'hotRemainingCount'],
    cooldownMs: 75_000,
    jokeStyle: 'witty',
    when: (c) => c.phase === 'OPEN' && c.hotAnsweredCount > 0 && c.hotRemainingCount === 1,
    render: (c) => `${c.hotAnsweredCount} ghế nóng đã chốt xong xuôi, chỉ còn đúng 1 ghế nóng đang giữ bí mật tới phút chót!`,
  },
  {
    id: 'cho_08',
    category: 'choTraLoi',
    situation: 'partial_hot_answered',
    durationMs: 3800,
    requiredFields: ['hotAnsweredCount', 'hotRemainingCount', 'code'],
    cooldownMs: 75_000,
    jokeStyle: 'cheer',
    when: (c) => c.phase === 'OPEN' && c.hotAnsweredCount > 0 && c.hotRemainingCount >= 2,
    render: (c) => `${c.hotAnsweredCount} ghế nóng đã khóa lựa chọn câu ${c.code}, ${c.hotRemainingCount} ghế còn lại nhanh tay lên nhé!`,
  },
  // Khi TẤT CẢ ghế nóng đang ngồi đều đã trả lời thật (hotSeatedCount > 0 && hotAnsweredCount === hotSeatedCount)
  {
    id: 'cho_09',
    category: 'choTraLoi',
    situation: 'all_hot_answered',
    durationMs: 4000,
    requiredFields: ['hotSeatedCount', 'answeredCount', 'code'],
    cooldownMs: 75_000,
    jokeStyle: 'cheer',
    when: (c) => c.phase === 'OPEN' && c.hotSeatedCount > 0 && c.hotAnsweredCount === c.hotSeatedCount,
    render: (c) => `Cả ${c.hotSeatedCount} ghế nóng đều đã khóa đáp án câu ${c.code}! Khán giả vẫn còn giờ để săn thêm điểm nhé.`,
  },
  {
    id: 'cho_10',
    category: 'choTraLoi',
    situation: 'all_hot_answered',
    durationMs: 4100,
    requiredFields: ['hotSeatedCount', 'answeredCount'],
    cooldownMs: 75_000,
    jokeStyle: 'dramatic',
    when: (c) => c.phase === 'OPEN' && c.hotSeatedCount === 5 && c.hotAnsweredCount === 5,
    render: (c) => `Năm trên năm ghế nóng đã chốt xong cùng tổng cộng ${c.answeredCount} lượt trả lời trên toàn sân khấu!`,
  },
  {
    id: 'cho_11',
    category: 'choTraLoi',
    situation: 'all_hot_answered',
    durationMs: 3900,
    requiredFields: ['hotSeatedCount', 'code'],
    cooldownMs: 75_000,
    jokeStyle: 'witty',
    when: (c) => c.phase === 'OPEN' && c.hotSeatedCount > 0 && c.hotAnsweredCount === c.hotSeatedCount,
    render: (c) => `Các ghế nóng chốt câu ${c.code} rất dứt khoát, giờ cùng chờ xem ai sẽ giữ vững chiếc ghế đỏ cam!`,
  },
  // Khi có người đang giữ chuỗi đúng cao trên ghế nóng (topStreakLevel >= 2)
  {
    id: 'cho_12',
    category: 'choTraLoi',
    situation: 'high_streak_watch',
    durationMs: 4200,
    requiredFields: ['topStreakName', 'topStreakSeat', 'topStreakLevel'],
    cooldownMs: 80_000,
    jokeStyle: 'dramatic',
    when: (c) => c.phase === 'OPEN' && c.topStreakLevel >= 2,
    render: (c) => `Ghế số ${c.topStreakSeat} của ${c.topStreakName} đang giữ chuỗi cấp ${c.topStreakLevel}, liệu câu này có nâng cấp tiếp không?`,
  },
  {
    id: 'cho_13',
    category: 'choTraLoi',
    situation: 'high_streak_watch',
    durationMs: 4300,
    requiredFields: ['topStreakName', 'topStreakSeat', 'topStreakLevel'],
    cooldownMs: 80_000,
    jokeStyle: 'cheer',
    when: (c) => c.phase === 'OPEN' && c.topStreakLevel >= 3,
    render: (c) => `${c.topStreakName} ở ghế ${c.topStreakSeat} đã trụ tới cấp ${c.topStreakLevel} rồi, phong độ cực kỳ ấn tượng!`,
  },
  // Thống kê tổng số người đã trả lời thật (answeredCount >= 3)
  {
    id: 'cho_14',
    category: 'choTraLoi',
    situation: 'crowd_answering',
    durationMs: 3800,
    requiredFields: ['answeredCount', 'code'],
    cooldownMs: 75_000,
    jokeStyle: 'fact',
    when: (c) => c.phase === 'OPEN' && c.answeredCount >= 3,
    render: (c) => `Tính tới lúc này đã có ${c.answeredCount} người chơi khóa đáp án cho câu số ${c.code}.`,
  },
  {
    id: 'cho_15',
    category: 'choTraLoi',
    situation: 'crowd_answering',
    durationMs: 4000,
    requiredFields: ['answeredCount', 'waitingCount'],
    cooldownMs: 75_000,
    jokeStyle: 'warm',
    when: (c) => c.phase === 'OPEN' && c.answeredCount >= 5 && c.waitingCount > 0,
    render: (c) => `Đã có ${c.answeredCount} đáp án gửi về, trong khi ${c.waitingCount} ghế chờ phía dưới vẫn đang háo hức chờ cơ hội!`,
  },
  {
    id: 'cho_16',
    category: 'choTraLoi',
    situation: 'crowd_answering',
    durationMs: 3900,
    requiredFields: ['answeredCount', 'code', 'pointsCorrect'],
    cooldownMs: 75_000,
    jokeStyle: 'cheer',
    when: (c) => c.phase === 'OPEN' && c.answeredCount >= 1 && c.answeredCount < 5,
    render: (c) => `Đã có ${c.answeredCount} bạn mở hàng câu ${c.code}, các bạn khác bình luận ngay để săn ${c.pointsCorrect} điểm nhé!`,
  },
  {
    id: 'cho_17',
    category: 'choTraLoi',
    situation: 'crowd_answering',
    durationMs: 4100,
    requiredFields: ['answeredCount', 'topic'],
    cooldownMs: 75_000,
    jokeStyle: 'witty',
    when: (c) => c.phase === 'OPEN' && c.answeredCount >= 8,
    render: (c) => `Chủ đề ${c.topic} sôi nổi thật sự, đã có tới ${c.answeredCount} người chơi chốt phương án của mình!`,
  },
  {
    id: 'cho_18',
    category: 'choTraLoi',
    situation: 'crowd_answering',
    durationMs: 3800,
    requiredFields: ['answeredCount', 'code'],
    cooldownMs: 75_000,
    jokeStyle: 'calm',
    when: (c) => c.phase === 'OPEN' && c.answeredCount >= 2,
    render: (c) => `Hệ thống đã khóa ${c.answeredCount} đáp án hợp lệ cho câu ${c.code}, thời gian vẫn còn cho các bạn chưa gửi.`,
  },
  {
    id: 'cho_19',
    category: 'choTraLoi',
    situation: 'waiting_queue_pressure',
    durationMs: 4000,
    requiredFields: ['waitingCount', 'hotSeatedCount'],
    cooldownMs: 75_000,
    jokeStyle: 'dramatic',
    when: (c) => c.phase === 'OPEN' && c.waitingCount >= 5 && c.hotSeatedCount > 0,
    render: (c) => `Phía dưới đang có ${c.waitingCount} ghế chờ sẵn sàng thế chỗ bất cứ ghế nóng nào sẩy chân ở câu này!`,
  },
  {
    id: 'cho_20',
    category: 'choTraLoi',
    situation: 'crowd_answering',
    durationMs: 3900,
    requiredFields: ['answeredCount', 'code'],
    cooldownMs: 75_000,
    jokeStyle: 'warm',
    when: (c) => c.phase === 'OPEN' && c.answeredCount >= 4,
    render: (c) => `${c.answeredCount} người chơi đã nhập cuộc ở câu ${c.code}, bạn nào chưa chốt thì gõ mã câu kèm A, B, C, D ngay nha!`,
  },
];

const NHAC_GIO_TEMPLATES: McDialogueTemplate[] = [
  {
    id: 'gio_01',
    category: 'nhacGio',
    situation: 'time_5s_remaining_hot',
    durationMs: 2800,
    requiredFields: ['code', 'hotRemainingCount'],
    cooldownMs: 45_000,
    jokeStyle: 'dramatic',
    when: (c) => c.phase === 'OPEN' && c.hotRemainingCount > 0,
    render: (c) => `Còn 5 giây cuối câu ${c.code}, ${c.hotRemainingCount} ghế nóng chưa trả lời chốt ngay kẻo rớt ghế!`,
  },
  {
    id: 'gio_02',
    category: 'nhacGio',
    situation: 'time_5s_remaining_hot',
    durationMs: 2700,
    requiredFields: ['hotRemainingCount'],
    cooldownMs: 45_000,
    jokeStyle: 'fact',
    when: (c) => c.phase === 'OPEN' && c.hotRemainingCount > 0,
    render: (c) => `5 giây cuối cùng! Vẫn còn ${c.hotRemainingCount} ghế nóng chưa khóa đáp án!`,
  },
  {
    id: 'gio_03',
    category: 'nhacGio',
    situation: 'time_5s_remaining_hot',
    durationMs: 2800,
    requiredFields: ['code', 'hotRemainingCount'],
    cooldownMs: 45_000,
    jokeStyle: 'cheer',
    when: (c) => c.phase === 'OPEN' && c.hotRemainingCount === 1,
    render: (c) => `Chỉ còn 5 giây cho câu ${c.code}, ghế nóng cuối cùng mau đưa ra lựa chọn nào!`,
  },
  {
    id: 'gio_04',
    category: 'nhacGio',
    situation: 'time_5s_all_hot_done',
    durationMs: 2700,
    requiredFields: ['code', 'hotSeatedCount'],
    cooldownMs: 45_000,
    jokeStyle: 'cheer',
    when: (c) => c.phase === 'OPEN' && c.hotSeatedCount > 0 && c.hotRemainingCount === 0,
    render: (c) => `5 giây cuối câu ${c.code}! Ghế nóng đã chốt đủ, khán giả nhanh tay gửi đáp án cuối nhé!`,
  },
  {
    id: 'gio_05',
    category: 'nhacGio',
    situation: 'time_5s_general',
    durationMs: 2600,
    requiredFields: ['code'],
    cooldownMs: 45_000,
    jokeStyle: 'dramatic',
    when: (c) => c.phase === 'OPEN',
    render: (c) => `Còn đúng 5 giây cho câu ${c.code}, nhanh tay chốt đáp án trước khi khóa sổ!`,
  },
  {
    id: 'gio_06',
    category: 'nhacGio',
    situation: 'time_5s_general',
    durationMs: 2600,
    requiredFields: ['code'],
    cooldownMs: 45_000,
    jokeStyle: 'fact',
    when: (c) => c.phase === 'OPEN',
    render: (c) => `5 giây đếm ngược câu ${c.code}, chuẩn bị đóng nhận đáp án!`,
  },
  {
    id: 'gio_07',
    category: 'nhacGio',
    situation: 'time_5s_general',
    durationMs: 2700,
    requiredFields: ['code'],
    cooldownMs: 45_000,
    jokeStyle: 'warm',
    when: (c) => c.phase === 'OPEN',
    render: (c) => `Sắp hết giờ câu ${c.code} rồi, còn 5 giây cuối cho các bạn chưa kịp gửi!`,
  },
  {
    id: 'gio_08',
    category: 'nhacGio',
    situation: 'time_5s_general',
    durationMs: 2600,
    requiredFields: ['code'],
    cooldownMs: 45_000,
    jokeStyle: 'calm',
    when: (c) => c.phase === 'OPEN',
    render: (c) => `Còn 5 giây nhận đáp án câu ${c.code}, hệ thống sắp khóa câu trả lời.`,
  },
  {
    id: 'gio_09',
    category: 'nhacGio',
    situation: 'time_5s_general',
    durationMs: 2700,
    requiredFields: ['code', 'answeredCount'],
    cooldownMs: 45_000,
    jokeStyle: 'fact',
    when: (c) => c.phase === 'OPEN' && c.answeredCount > 0,
    render: (c) => `5 giây cuối câu ${c.code}, đã có ${c.answeredCount} bạn chốt, ai chưa gửi nhanh tay nào!`,
  },
  {
    id: 'gio_10',
    category: 'nhacGio',
    situation: 'time_5s_general',
    durationMs: 2600,
    requiredFields: ['code'],
    cooldownMs: 45_000,
    jokeStyle: 'dramatic',
    when: (c) => c.phase === 'OPEN',
    render: (c) => `Đồng hồ báo đỏ 5 giây cuối! Gõ ngay ${c.code}A, ${c.code}B, ${c.code}C hoặc ${c.code}D!`,
  },
  {
    id: 'gio_11',
    category: 'nhacGio',
    situation: 'time_5s_general',
    durationMs: 2600,
    requiredFields: ['code'],
    cooldownMs: 45_000,
    jokeStyle: 'cheer',
    when: (c) => c.phase === 'OPEN',
    render: (c) => `5 giây nước rút của câu ${c.code}, chốt liền tay kẻo trễ giờ nhé!`,
  },
  {
    id: 'gio_12',
    category: 'nhacGio',
    situation: 'time_5s_no_answer',
    durationMs: 2700,
    requiredFields: ['code'],
    cooldownMs: 45_000,
    jokeStyle: 'dramatic',
    when: (c) => c.phase === 'OPEN' && c.answeredCount === 0,
    render: (c) => `Còn 5 giây cuối câu ${c.code} mà chưa ai khóa đáp án, mau chốt ngay thôi!`,
  },
  {
    id: 'gio_13',
    category: 'nhacGio',
    situation: 'time_5s_general',
    durationMs: 2600,
    requiredFields: ['code'],
    cooldownMs: 45_000,
    jokeStyle: 'fact',
    when: (c) => c.phase === 'OPEN',
    render: (c) => `Thời gian câu ${c.code} chỉ còn 5 giây, quá hạn hệ thống sẽ không tính điểm.`,
  },
  {
    id: 'gio_14',
    category: 'nhacGio',
    situation: 'time_5s_general',
    durationMs: 2500,
    requiredFields: ['code'],
    cooldownMs: 45_000,
    jokeStyle: 'calm',
    when: (c) => c.phase === 'OPEN',
    render: (c) => `5 giây cuối cùng cho câu hỏi số ${c.code}!`,
  },
  {
    id: 'gio_15',
    category: 'nhacGio',
    situation: 'time_5s_general',
    durationMs: 2700,
    requiredFields: ['code'],
    cooldownMs: 45_000,
    jokeStyle: 'warm',
    when: (c) => c.phase === 'OPEN',
    render: (c) => `Nhắc giờ câu ${c.code}: chỉ còn 5 giây nữa là khép lại phần nhận đáp án!`,
  },
  {
    id: 'gio_16',
    category: 'nhacGio',
    situation: 'time_5s_remaining_hot',
    durationMs: 2800,
    requiredFields: ['hotRemainingCount', 'code'],
    cooldownMs: 45_000,
    jokeStyle: 'dramatic',
    when: (c) => c.phase === 'OPEN' && c.hotRemainingCount >= 2,
    render: (c) => `5 giây cuối! ${c.hotRemainingCount} ghế nóng chưa gửi câu ${c.code} hãy khóa đáp án ngay lập tức!`,
  },
  {
    id: 'gio_17',
    category: 'nhacGio',
    situation: 'time_5s_general',
    durationMs: 2600,
    requiredFields: ['code'],
    cooldownMs: 45_000,
    jokeStyle: 'cheer',
    when: (c) => c.phase === 'OPEN',
    render: (c) => `Còn 5 giây cuối để ghi điểm ở câu ${c.code}, nhanh tay lên nào các bạn!`,
  },
  {
    id: 'gio_18',
    category: 'nhacGio',
    situation: 'time_5s_general',
    durationMs: 2600,
    requiredFields: ['code'],
    cooldownMs: 45_000,
    jokeStyle: 'fact',
    when: (c) => c.phase === 'OPEN',
    render: (c) => `Đếm ngược 5 giây cuối câu ${c.code} trước khi công bố đáp án đúng!`,
  },
  {
    id: 'gio_19',
    category: 'nhacGio',
    situation: 'time_5s_general',
    durationMs: 2600,
    requiredFields: ['code'],
    cooldownMs: 45_000,
    jokeStyle: 'calm',
    when: (c) => c.phase === 'OPEN',
    render: (c) => `Hết giờ tới nơi rồi, 5 giây cuối cho câu ${c.code} nhé!`,
  },
  {
    id: 'gio_20',
    category: 'nhacGio',
    situation: 'time_5s_general',
    durationMs: 2700,
    requiredFields: ['code'],
    cooldownMs: 45_000,
    jokeStyle: 'dramatic',
    when: (c) => c.phase === 'OPEN',
    render: (c) => `5, 4, 3... những giây cuối cùng để khóa đáp án câu ${c.code}!`,
  },
];

const CONG_BO_KET_QUA_TEMPLATES: McDialogueTemplate[] = [
  {
    id: 'kq_01',
    category: 'congBoKetQua',
    situation: 'reveal_with_stats',
    durationMs: 3800,
    requiredFields: ['code', 'correctChoice', 'totalCorrect', 'answeredCount'],
    cooldownMs: 60_000,
    jokeStyle: 'fact',
    when: (c) => c.answeredCount > 0 && c.totalCorrect > 0,
    render: (c) => `Hết giờ! Đáp án đúng câu ${c.code} là ${c.correctChoice}, có ${c.totalCorrect} trên ${c.answeredCount} bạn trả lời chính xác!`,
  },
  {
    id: 'kq_02',
    category: 'congBoKetQua',
    situation: 'reveal_with_stats',
    durationMs: 3900,
    requiredFields: ['code', 'correctChoice', 'keepCount'],
    cooldownMs: 60_000,
    jokeStyle: 'cheer',
    when: (c) => c.keepCount > 0 && c.eliminatedCount === 0,
    render: (c) => `Đáp án câu ${c.code} là ${c.correctChoice}! Tuyệt vời, cả ${c.keepCount} ghế nóng đều trả lời đúng và giữ vững ghế!`,
  },
  {
    id: 'kq_03',
    category: 'congBoKetQua',
    situation: 'reveal_mixed',
    durationMs: 4100,
    requiredFields: ['code', 'correctChoice', 'keepCount', 'eliminatedCount'],
    cooldownMs: 60_000,
    jokeStyle: 'dramatic',
    when: (c) => c.keepCount > 0 && c.eliminatedCount > 0,
    render: (c) => `Đáp án câu ${c.code} là ${c.correctChoice}! ${c.keepCount} ghế nóng trụ vững và ${c.eliminatedCount} ghế phải nhường chỗ.`,
  },
  {
    id: 'kq_04',
    category: 'congBoKetQua',
    situation: 'reveal_all_eliminated',
    durationMs: 4000,
    requiredFields: ['code', 'correctChoice', 'eliminatedCount'],
    cooldownMs: 60_000,
    jokeStyle: 'dramatic',
    when: (c) => c.keepCount === 0 && c.eliminatedCount > 0,
    render: (c) => `Đáp án đúng câu ${c.code} là ${c.correctChoice}! Một câu hỏi bất ngờ khiến cả ${c.eliminatedCount} ghế nóng cùng rời ghế!`,
  },
  {
    id: 'kq_05',
    category: 'congBoKetQua',
    situation: 'reveal_no_one_correct',
    durationMs: 3800,
    requiredFields: ['code', 'correctChoice', 'answeredCount'],
    cooldownMs: 60_000,
    jokeStyle: 'witty',
    when: (c) => c.answeredCount > 0 && c.totalCorrect === 0,
    render: (c) => `Đáp án câu ${c.code} là ${c.correctChoice}! Cả ${c.answeredCount} lượt chọn đều lệch nhịp mất rồi, câu sau gỡ lại nhé!`,
  },
  {
    id: 'kq_06',
    category: 'congBoKetQua',
    situation: 'reveal_no_answers',
    durationMs: 3400,
    requiredFields: ['code', 'correctChoice'],
    cooldownMs: 60_000,
    jokeStyle: 'calm',
    when: (c) => c.answeredCount === 0,
    render: (c) => `Khép lại câu ${c.code}, đáp án đúng của chương trình là phương án ${c.correctChoice}.`,
  },
  {
    id: 'kq_07',
    category: 'congBoKetQua',
    situation: 'reveal_with_stats',
    durationMs: 3900,
    requiredFields: ['code', 'correctChoice', 'totalCorrect', 'pointsCorrect'],
    cooldownMs: 60_000,
    jokeStyle: 'warm',
    when: (c) => c.totalCorrect > 0,
    render: (c) => `Phương án ${c.correctChoice} là đáp án đúng của câu ${c.code}, chúc mừng ${c.totalCorrect} bạn nhận thêm ${c.pointsCorrect} điểm!`,
  },
  {
    id: 'kq_08',
    category: 'congBoKetQua',
    situation: 'reveal_with_stats',
    durationMs: 3700,
    requiredFields: ['code', 'correctChoice', 'totalCorrect'],
    cooldownMs: 60_000,
    jokeStyle: 'cheer',
    when: (c) => c.totalCorrect >= 5,
    render: (c) => `Đáp án chính xác câu ${c.code} là ${c.correctChoice}, có tới ${c.totalCorrect} người chơi ghi điểm ở lượt này!`,
  },
  {
    id: 'kq_09',
    category: 'congBoKetQua',
    situation: 'reveal_general',
    durationMs: 3500,
    requiredFields: ['code', 'correctChoice'],
    cooldownMs: 60_000,
    jokeStyle: 'fact',
    when: () => true,
    render: (c) => `Chốt kết quả câu số ${c.code}: đáp án đúng là phương án ${c.correctChoice}.`,
  },
  {
    id: 'kq_10',
    category: 'congBoKetQua',
    situation: 'reveal_mixed',
    durationMs: 4000,
    requiredFields: ['correctChoice', 'keepCount', 'totalCorrect'],
    cooldownMs: 60_000,
    jokeStyle: 'fact',
    when: (c) => c.keepCount > 0 && c.totalCorrect > 0,
    render: (c) => `Với đáp án ${c.correctChoice}, ${c.keepCount} ghế nóng tăng thêm 1 cấp và tổng cộng ${c.totalCorrect} bạn được cộng điểm.`,
  },
  {
    id: 'kq_11',
    category: 'congBoKetQua',
    situation: 'reveal_with_stats',
    durationMs: 3800,
    requiredFields: ['code', 'correctChoice', 'totalCorrect'],
    cooldownMs: 60_000,
    jokeStyle: 'witty',
    when: (c) => c.totalCorrect === 1,
    render: (c) => `Đáp án câu ${c.code} là ${c.correctChoice}, chỉ có duy nhất 1 người chơi xuất sắc giải đúng câu này!`,
  },
  {
    id: 'kq_12',
    category: 'congBoKetQua',
    situation: 'reveal_with_stats',
    durationMs: 3800,
    requiredFields: ['code', 'correctChoice', 'totalCorrect', 'answeredCount'],
    cooldownMs: 60_000,
    jokeStyle: 'calm',
    when: (c) => c.answeredCount > 0 && c.totalCorrect > 0,
    render: (c) => `Kết thúc câu ${c.code}, đáp án đúng là ${c.correctChoice} với ${c.totalCorrect} lựa chọn chính xác.`,
  },
  {
    id: 'kq_13',
    category: 'congBoKetQua',
    situation: 'reveal_all_correct',
    durationMs: 3900,
    requiredFields: ['code', 'correctChoice', 'answeredCount'],
    cooldownMs: 60_000,
    jokeStyle: 'cheer',
    when: (c) => c.answeredCount >= 3 && c.totalCorrect === c.answeredCount,
    render: (c) => `Đáp án câu ${c.code} là ${c.correctChoice}! Cả ${c.answeredCount} người trả lời đều đúng tuyệt đối một trăm phần trăm!`,
  },
  {
    id: 'kq_14',
    category: 'congBoKetQua',
    situation: 'reveal_mixed',
    durationMs: 4000,
    requiredFields: ['code', 'correctChoice', 'eliminatedCount'],
    cooldownMs: 60_000,
    jokeStyle: 'dramatic',
    when: (c) => c.eliminatedCount >= 2,
    render: (c) => `Đáp án đúng câu ${c.code} là ${c.correctChoice}, đã có ${c.eliminatedCount} chiếc ghế nóng đổi chủ sau câu hỏi này!`,
  },
  {
    id: 'kq_15',
    category: 'congBoKetQua',
    situation: 'reveal_general',
    durationMs: 3600,
    requiredFields: ['code', 'correctChoice', 'pointsCorrect'],
    cooldownMs: 60_000,
    jokeStyle: 'warm',
    when: (c) => c.totalCorrect > 0,
    render: (c) => `Câu ${c.code} khép lại với đáp án ${c.correctChoice}, ${c.pointsCorrect} điểm thưởng đã được cộng cho các bạn chọn đúng.`,
  },
  {
    id: 'kq_16',
    category: 'congBoKetQua',
    situation: 'reveal_keep',
    durationMs: 3900,
    requiredFields: ['code', 'correctChoice', 'keepCount'],
    cooldownMs: 60_000,
    jokeStyle: 'cheer',
    when: (c) => c.keepCount >= 3,
    render: (c) => `Đáp án đúng câu ${c.code} là ${c.correctChoice}, ${c.keepCount} ghế nóng xuất sắc bảo vệ thành công vị trí của mình!`,
  },
  {
    id: 'kq_17',
    category: 'congBoKetQua',
    situation: 'reveal_general',
    durationMs: 3500,
    requiredFields: ['code', 'correctChoice'],
    cooldownMs: 60_000,
    jokeStyle: 'calm',
    when: () => true,
    render: (c) => `Công bố kết quả câu ${c.code}: lựa chọn chính xác là ${c.correctChoice}.`,
  },
  {
    id: 'kq_18',
    category: 'congBoKetQua',
    situation: 'reveal_with_stats',
    durationMs: 3900,
    requiredFields: ['code', 'correctChoice', 'totalCorrect', 'answeredCount'],
    cooldownMs: 60_000,
    jokeStyle: 'fact',
    when: (c) => c.answeredCount >= 2 && c.totalCorrect > 0,
    render: (c) => `Ở câu ${c.code}, phương án ${c.correctChoice} mang về điểm thưởng cho ${c.totalCorrect} trong tổng số ${c.answeredCount} bạn tham gia.`,
  },
  {
    id: 'kq_19',
    category: 'congBoKetQua',
    situation: 'reveal_single_keep',
    durationMs: 4000,
    requiredFields: ['code', 'correctChoice', 'eliminatedCount'],
    cooldownMs: 60_000,
    jokeStyle: 'dramatic',
    when: (c) => c.keepCount === 1 && c.eliminatedCount >= 2,
    render: (c) => `Đáp án câu ${c.code} là ${c.correctChoice}! Chỉ còn duy nhất 1 ghế nóng trụ lại trên sân khấu sau thử thách này!`,
  },
  {
    id: 'kq_20',
    category: 'congBoKetQua',
    situation: 'reveal_general',
    durationMs: 3700,
    requiredFields: ['code', 'correctChoice', 'keepCount'],
    cooldownMs: 60_000,
    jokeStyle: 'warm',
    when: (c) => c.keepCount > 0,
    render: (c) => `Đáp án đúng câu ${c.code} là ${c.correctChoice}, chúc mừng ${c.keepCount} ghế nóng tiếp tục hành trình chinh phục cấp bậc mới!`,
  },
];

const DONG_VIEN_TEMPLATES: McDialogueTemplate[] = [
  {
    id: 'dv_01',
    category: 'dongVien',
    situation: 'encourage_named',
    durationMs: 3900,
    requiredFields: ['eliminatedNamesText', 'eliminatedCount'],
    cooldownMs: 75_000,
    jokeStyle: 'warm',
    when: (c) => c.eliminatedCount >= 1 && Boolean(c.eliminatedNamesText),
    render: (c) => `Tiếc quá cho ${c.eliminatedNamesText}, điểm số của bạn vẫn được giữ nguyên và hẹn tái đấu ở lượt ghế sau nhé!`,
  },
  {
    id: 'dv_02',
    category: 'dongVien',
    situation: 'encourage_named',
    durationMs: 4000,
    requiredFields: ['eliminatedNamesText', 'eliminatedCount'],
    cooldownMs: 75_000,
    jokeStyle: 'cheer',
    when: (c) => c.eliminatedCount >= 1 && Boolean(c.eliminatedNamesText),
    render: (c) => `${c.eliminatedNamesText} tạm nhường ghế nóng một nhịp thôi, tiếp tục trả lời từ hàng chờ để tích điểm nhé!`,
  },
  {
    id: 'dv_03',
    category: 'dongVien',
    situation: 'encourage_named',
    durationMs: 3800,
    requiredFields: ['eliminatedNamesText', 'eliminatedCount'],
    cooldownMs: 75_000,
    jokeStyle: 'calm',
    when: (c) => c.eliminatedCount >= 1 && Boolean(c.eliminatedNamesText),
    render: (c) => `Không sao cả ${c.eliminatedNamesText} ơi, hệ thống đã xếp bạn về hàng chờ để chuẩn bị cho lần trở lại tiếp theo.`,
  },
  {
    id: 'dv_04',
    category: 'dongVien',
    situation: 'encourage_named',
    durationMs: 4100,
    requiredFields: ['eliminatedNamesText', 'eliminatedCount'],
    cooldownMs: 75_000,
    jokeStyle: 'witty',
    when: (c) => c.eliminatedCount >= 1 && Boolean(c.eliminatedNamesText),
    render: (c) => `Câu vừa rồi hơi lắt léo chút xíu, ${c.eliminatedNamesText} xuống nghỉ chân uống miếng nước rồi lên phục thù nha!`,
  },
  {
    id: 'dv_05',
    category: 'dongVien',
    situation: 'encourage_all_out',
    durationMs: 4100,
    requiredFields: ['eliminatedCount'],
    cooldownMs: 75_000,
    jokeStyle: 'dramatic',
    when: (c) => c.keepCount === 0 && c.eliminatedCount >= 3,
    render: (c) => `Một pha đổi máu toàn bộ ghế nóng! Các bạn vừa rời ghế đừng nản lòng, cơ hội lên lại vẫn rộng mở!`,
  },
  {
    id: 'dv_06',
    category: 'dongVien',
    situation: 'encourage_all_out',
    durationMs: 3900,
    requiredFields: ['eliminatedCount'],
    cooldownMs: 75_000,
    jokeStyle: 'warm',
    when: (c) => c.keepCount === 0 && c.eliminatedCount >= 1,
    render: () => `Sân đấu chuẩn bị đón loạt người chơi mới, các bạn vừa rời ghế vẫn giữ nguyên toàn bộ điểm phiên đã tích lũy!`,
  },
  {
    id: 'dv_07',
    category: 'dongVien',
    situation: 'encourage_some_out',
    durationMs: 3800,
    requiredFields: ['eliminatedCount', 'pointsCorrect'],
    cooldownMs: 75_000,
    jokeStyle: 'fact',
    when: (c) => c.eliminatedCount >= 1,
    render: (c) => `${c.eliminatedCount} bạn rời ghế nóng vẫn có thể trả lời câu tiếp theo từ khán đài để nhận ${c.pointsCorrect} điểm mỗi câu đúng.`,
  },
  {
    id: 'dv_08',
    category: 'dongVien',
    situation: 'encourage_some_out',
    durationMs: 3700,
    requiredFields: ['eliminatedCount'],
    cooldownMs: 75_000,
    jokeStyle: 'warm',
    when: (c) => c.eliminatedCount === 1,
    render: () => `Chỉ trượt một nhịp thôi, giữ vững tinh thần để sớm quay lại chiếc ghế nóng nhé!`,
  },
  {
    id: 'dv_09',
    category: 'dongVien',
    situation: 'encourage_some_out',
    durationMs: 3900,
    requiredFields: ['eliminatedCount'],
    cooldownMs: 75_000,
    jokeStyle: 'cheer',
    when: (c) => c.eliminatedCount >= 2,
    render: (c) => `Cảm ơn ${c.eliminatedCount} bạn vừa thi đấu hết mình trên ghế nóng, hẹn gặp lại các bạn ở lượt ghế kế tiếp!`,
  },
  {
    id: 'dv_10',
    category: 'dongVien',
    situation: 'encourage_some_out',
    durationMs: 3800,
    requiredFields: ['eliminatedNamesText'],
    cooldownMs: 75_000,
    jokeStyle: 'calm',
    when: (c) => c.eliminatedCount >= 1 && Boolean(c.eliminatedNamesText),
    render: (c) => `Kỷ lục cấp và điểm số của ${c.eliminatedNamesText} đã được bảo toàn, sẵn sàng làm lại từ câu sau nhé.`,
  },
  {
    id: 'dv_11',
    category: 'dongVien',
    situation: 'encourage_some_out',
    durationMs: 3900,
    requiredFields: ['eliminatedCount'],
    cooldownMs: 75_000,
    jokeStyle: 'witty',
    when: (c) => c.eliminatedCount >= 1,
    render: () => `Thắng keo này ta bày keo khác, ở Ghế Nóng chỉ cần trả lời đều tay là điểm vẫn tăng vù vù!`,
  },
  {
    id: 'dv_12',
    category: 'dongVien',
    situation: 'encourage_named',
    durationMs: 4000,
    requiredFields: ['eliminatedNamesText'],
    cooldownMs: 75_000,
    jokeStyle: 'warm',
    when: (c) => c.eliminatedCount >= 1 && Boolean(c.eliminatedNamesText),
    render: (c) => `Động viên ${c.eliminatedNamesText} nhé, bạn nào lỡ hết giờ chưa trả lời thì nhớ gõ VÀO để bật lại tự xếp hàng nha!`,
  },
  {
    id: 'dv_13',
    category: 'dongVien',
    situation: 'encourage_some_out',
    durationMs: 3700,
    requiredFields: ['eliminatedCount'],
    cooldownMs: 75_000,
    jokeStyle: 'fact',
    when: (c) => c.eliminatedCount >= 1,
    render: (c) => `Có ${c.eliminatedCount} vị trí ghế nóng vừa trống ra, cơ hội đang chuyển giao cho các bạn ở hàng ghế chờ.`,
  },
  {
    id: 'dv_14',
    category: 'dongVien',
    situation: 'encourage_some_out',
    durationMs: 3800,
    requiredFields: ['eliminatedNamesText'],
    cooldownMs: 75_000,
    jokeStyle: 'cheer',
    when: (c) => c.eliminatedCount >= 1 && Boolean(c.eliminatedNamesText),
    render: (c) => `Cho ${c.eliminatedNamesText} một tràng vỗ tay khích lệ, lượt sau lên ghế quyết tâm phá kỷ lục nhé!`,
  },
  {
    id: 'dv_15',
    category: 'dongVien',
    situation: 'encourage_some_out',
    durationMs: 3700,
    requiredFields: ['eliminatedCount'],
    cooldownMs: 75_000,
    jokeStyle: 'calm',
    when: (c) => c.eliminatedCount >= 1,
    render: () => `Mỗi câu hỏi là một thử thách mới, các bạn vừa rời ghế cứ tiếp tục bình luận đáp án để giữ nhịp nhé.`,
  },
  {
    id: 'dv_16',
    category: 'dongVien',
    situation: 'encourage_named',
    durationMs: 3900,
    requiredFields: ['eliminatedNamesText'],
    cooldownMs: 75_000,
    jokeStyle: 'warm',
    when: (c) => c.eliminatedCount >= 1 && Boolean(c.eliminatedNamesText),
    render: (c) => `${c.eliminatedNamesText} đừng tiếc nuối lâu nha, câu hỏi mới sắp mở ngay sau bước chuyển ghế này rồi!`,
  },
  {
    id: 'dv_17',
    category: 'dongVien',
    situation: 'encourage_some_out',
    durationMs: 3800,
    requiredFields: ['eliminatedCount'],
    cooldownMs: 75_000,
    jokeStyle: 'witty',
    when: (c) => c.eliminatedCount >= 2,
    render: (c) => `Câu hỏi vừa rồi sàng lọc khá gắt, ${c.eliminatedCount} bạn tạm lui về tuyến hai dưỡng sức một chút nhé!`,
  },
  {
    id: 'dv_18',
    category: 'dongVien',
    situation: 'encourage_some_out',
    durationMs: 3700,
    requiredFields: ['eliminatedCount'],
    cooldownMs: 75_000,
    jokeStyle: 'cheer',
    when: (c) => c.eliminatedCount >= 1,
    render: () => `Đường đua bảng xếp hạng vẫn còn dài, ngồi ghế chờ trả lời đúng vẫn cộng đủ điểm như trên ghế nóng!`,
  },
  {
    id: 'dv_19',
    category: 'dongVien',
    situation: 'encourage_named',
    durationMs: 3900,
    requiredFields: ['eliminatedNamesText'],
    cooldownMs: 75_000,
    jokeStyle: 'calm',
    when: (c) => c.eliminatedCount >= 1 && Boolean(c.eliminatedNamesText),
    render: (c) => `Hẹn gặp lại ${c.eliminatedNamesText} trên ghế nóng sau ít phút nữa, chúc bạn câu tiếp theo chọn thật chuẩn!`,
  },
  {
    id: 'dv_20',
    category: 'dongVien',
    situation: 'encourage_some_out',
    durationMs: 3800,
    requiredFields: ['eliminatedCount'],
    cooldownMs: 75_000,
    jokeStyle: 'warm',
    when: (c) => c.eliminatedCount >= 1,
    render: (c) => `Dù ${c.eliminatedCount} ghế phải nhường chỗ nhưng cuộc vui mới chỉ bắt đầu, cùng cố gắng ở câu kế tiếp nhé!`,
  },
];

const VINH_DANH_TEMPLATES: McDialogueTemplate[] = [
  {
    id: 'vd_01',
    category: 'vinhDanh',
    situation: 'honor_milestone',
    durationMs: 4200,
    requiredFields: ['honoredNamesText', 'honoredLevel'],
    cooldownMs: 60_000,
    jokeStyle: 'cheer',
    when: (c) => c.honoredCount >= 1,
    render: (c) =>
      `${c.allFloorWon ? 'Cả sàn cùng thắng! ' : ''}Vinh danh ${c.honoredNamesText} xuất sắc cán mốc cấp ${c.honoredLevel} trên ghế nóng!`,
  },
  {
    id: 'vd_02',
    category: 'vinhDanh',
    situation: 'honor_milestone',
    durationMs: 4300,
    requiredFields: ['honoredNamesText', 'honoredLevel'],
    cooldownMs: 60_000,
    jokeStyle: 'dramatic',
    when: (c) => c.honoredCount >= 1,
    render: (c) => `Quá bản lĩnh! Chúc mừng ${c.honoredNamesText} đã chinh phục thành công cột mốc vinh danh cấp ${c.honoredLevel}!`,
  },
  {
    id: 'vd_03',
    category: 'vinhDanh',
    situation: 'honor_milestone',
    durationMs: 4100,
    requiredFields: ['honoredNamesText', 'honoredLevel'],
    cooldownMs: 60_000,
    jokeStyle: 'warm',
    when: (c) => c.honoredCount >= 1,
    render: (c) => `Đèn vàng vinh danh xin gọi tên ${c.honoredNamesText} với chuỗi trả lời đúng liên tiếp đạt cấp ${c.honoredLevel}!`,
  },
  {
    id: 'vd_04',
    category: 'vinhDanh',
    situation: 'honor_milestone_multi',
    durationMs: 4400,
    requiredFields: ['honoredNamesText', 'honoredCount', 'honoredLevel'],
    cooldownMs: 60_000,
    jokeStyle: 'cheer',
    when: (c) => c.honoredCount >= 2,
    render: (c) => `Kỷ lục nối tiếp kỷ lục! Cùng lúc ${c.honoredCount} người chơi là ${c.honoredNamesText} đạt mốc vinh danh cấp ${c.honoredLevel}!`,
  },
  {
    id: 'vd_05',
    category: 'vinhDanh',
    situation: 'honor_milestone',
    durationMs: 4000,
    requiredFields: ['honoredNamesText', 'honoredLevel'],
    cooldownMs: 60_000,
    jokeStyle: 'witty',
    when: (c) => c.honoredCount >= 1,
    render: (c) => `Ghế nóng hôm nay gặp đúng chủ nhân rồi, chúc mừng ${c.honoredNamesText} vươn lên cấp ${c.honoredLevel}!`,
  },
  {
    id: 'vd_06',
    category: 'vinhDanh',
    situation: 'honor_all_floor',
    durationMs: 3900,
    requiredFields: ['keepCount'],
    cooldownMs: 60_000,
    jokeStyle: 'cheer',
    when: (c) => c.allFloorWon && c.honoredCount === 0,
    render: () => `Tuyệt vời! Cả 5 ghế nóng cùng trả lời đúng, giữ nguyên đội hình và tăng thêm 1 cấp!`,
  },
  {
    id: 'vd_07',
    category: 'vinhDanh',
    situation: 'honor_all_floor',
    durationMs: 4000,
    requiredFields: ['keepCount'],
    cooldownMs: 60_000,
    jokeStyle: 'dramatic',
    when: (c) => c.allFloorWon && c.honoredCount === 0,
    render: () => `Cả sàn giữ ghế! 5 chùm đèn chiến thắng cùng bật sáng cho cả 5 vị trí ghế nóng!`,
  },
  {
    id: 'vd_08',
    category: 'vinhDanh',
    situation: 'honor_all_floor',
    durationMs: 3800,
    requiredFields: ['keepCount'],
    cooldownMs: 60_000,
    jokeStyle: 'witty',
    when: (c) => c.allFloorWon && c.honoredCount === 0,
    render: () => `5 ghế nóng bảo vệ chỗ ngồi quá chắc chắn, hàng ghế chờ đành kiên nhẫn thêm một câu nữa nhé!`,
  },
  {
    id: 'vd_09',
    category: 'vinhDanh',
    situation: 'honor_keep',
    durationMs: 3700,
    requiredFields: ['keepCount', 'pointsCorrect'],
    cooldownMs: 60_000,
    jokeStyle: 'cheer',
    when: (c) => c.keepCount > 0 && !c.allFloorWon && c.honoredCount === 0,
    render: (c) => `Chúc mừng ${c.keepCount} ghế nóng trả lời đúng, nhận thêm ${c.pointsCorrect} điểm và tăng 1 cấp giữ ghế!`,
  },
  {
    id: 'vd_10',
    category: 'vinhDanh',
    situation: 'honor_keep',
    durationMs: 3800,
    requiredFields: ['keepCount'],
    cooldownMs: 60_000,
    jokeStyle: 'warm',
    when: (c) => c.keepCount > 0 && !c.allFloorWon && c.honoredCount === 0,
    render: (c) => `Đèn sân khấu đang chiếu sáng vinh danh ${c.keepCount} người chơi trụ vững trên ghế nóng ở lượt này!`,
  },
  {
    id: 'vd_11',
    category: 'vinhDanh',
    situation: 'honor_keep_top_streak',
    durationMs: 4100,
    requiredFields: ['keepCount', 'topStreakName', 'topStreakLevel'],
    cooldownMs: 60_000,
    jokeStyle: 'dramatic',
    when: (c) => c.keepCount > 0 && c.topStreakLevel >= 2 && c.honoredCount === 0,
    render: (c) => `${c.keepCount} người giữ ghế thành công, dẫn đầu là ${c.topStreakName} đang sở hữu chuỗi cấp ${c.topStreakLevel}!`,
  },
  {
    id: 'vd_12',
    category: 'vinhDanh',
    situation: 'honor_keep',
    durationMs: 3600,
    requiredFields: ['keepCount'],
    cooldownMs: 60_000,
    jokeStyle: 'fact',
    when: (c) => c.keepCount > 0 && c.honoredCount === 0,
    render: (c) => `Ghi nhận ${c.keepCount} ghế nóng vượt qua câu hỏi để bước tiếp với cấp bậc cao hơn.`,
  },
  {
    id: 'vd_13',
    category: 'vinhDanh',
    situation: 'honor_single_survivor',
    durationMs: 3900,
    requiredFields: ['topStreakName', 'topStreakSeat', 'topStreakLevel'],
    cooldownMs: 60_000,
    jokeStyle: 'dramatic',
    when: (c) => c.keepCount === 1 && c.honoredCount === 0 && Boolean(c.topStreakName),
    render: (c) => `Một mình ${c.topStreakName} ở ghế số ${c.topStreakSeat} trụ vững và vươn lên cấp ${c.topStreakLevel}!`,
  },
  {
    id: 'vd_14',
    category: 'vinhDanh',
    situation: 'honor_milestone',
    durationMs: 4200,
    requiredFields: ['honoredNamesText', 'honoredLevel'],
    cooldownMs: 60_000,
    jokeStyle: 'fact',
    when: (c) => c.honoredCount >= 1,
    render: (c) => `Huy hiệu mốc cấp ${c.honoredLevel} vừa được trao trực tiếp cho ${c.honoredNamesText} trên bảng vàng Ghế Nóng!`,
  },
  {
    id: 'vd_15',
    category: 'vinhDanh',
    situation: 'honor_keep',
    durationMs: 3700,
    requiredFields: ['keepCount'],
    cooldownMs: 60_000,
    jokeStyle: 'calm',
    when: (c) => c.keepCount > 0 && c.honoredCount === 0,
    render: (c) => `${c.keepCount} vị trí ghế nóng trả lời chính xác sẽ giữ nguyên ghế để bước sang câu tiếp theo.`,
  },
  {
    id: 'vd_16',
    category: 'vinhDanh',
    situation: 'honor_keep',
    durationMs: 3800,
    requiredFields: ['keepCount'],
    cooldownMs: 60_000,
    jokeStyle: 'witty',
    when: (c) => c.keepCount >= 3 && c.honoredCount === 0,
    render: (c) => `${c.keepCount} ghế nóng vẫn ngồi rất vững vàng, phong độ thi đấu hôm nay thật đáng nể!`,
  },
  {
    id: 'vd_17',
    category: 'vinhDanh',
    situation: 'honor_milestone',
    durationMs: 4100,
    requiredFields: ['honoredNamesText', 'honoredLevel'],
    cooldownMs: 60_000,
    jokeStyle: 'cheer',
    when: (c) => c.honoredCount >= 1,
    render: (c) => `Xin chúc mừng ${c.honoredNamesText} đã ghi dấu ấn rực rỡ ở cấp bậc ${c.honoredLevel}!`,
  },
  {
    id: 'vd_18',
    category: 'vinhDanh',
    situation: 'honor_keep',
    durationMs: 3800,
    requiredFields: ['keepCount', 'pointsCorrect'],
    cooldownMs: 60_000,
    jokeStyle: 'warm',
    when: (c) => c.keepCount > 0 && c.honoredCount === 0,
    render: (c) => `Vinh danh ${c.keepCount} ghế nóng xuất sắc mang về thêm ${c.pointsCorrect} điểm và nâng cao cấp bậc!`,
  },
  {
    id: 'vd_19',
    category: 'vinhDanh',
    situation: 'honor_all_floor',
    durationMs: 3900,
    requiredFields: ['keepCount'],
    cooldownMs: 60_000,
    jokeStyle: 'warm',
    when: (c) => c.allFloorWon,
    render: () => `Một lượt đấu hoàn hảo cho cả 5 ghế nóng, tất cả đều trả lời đúng và cùng thăng cấp!`,
  },
  {
    id: 'vd_20',
    category: 'vinhDanh',
    situation: 'honor_keep',
    durationMs: 3700,
    requiredFields: ['keepCount'],
    cooldownMs: 60_000,
    jokeStyle: 'cheer',
    when: (c) => c.keepCount > 0,
    render: (c) => `Chúc mừng ${c.keepCount} người chơi giữ vững ghế nóng sau câu hỏi vừa rồi!`,
  },
];

const CAM_ON_QUA_TEMPLATES: McDialogueTemplate[] = [
  {
    id: 'qua_01',
    category: 'camOnQua',
    situation: 'gift_single',
    durationMs: 3600,
    requiredFields: ['giftSendersText', 'giftName'],
    cooldownMs: 75_000,
    jokeStyle: 'warm',
    when: (c) => c.giftSenderCount === 1 && c.giftTotalCount === 1,
    render: (c) => `Cảm ơn ${c.giftSendersText} vừa gửi tặng ${c.giftName} tiếp lửa cho trường quay nhé!`,
  },
  {
    id: 'qua_02',
    category: 'camOnQua',
    situation: 'gift_single_combo',
    durationMs: 3800,
    requiredFields: ['giftSendersText', 'giftName', 'giftTotalCount'],
    cooldownMs: 75_000,
    jokeStyle: 'cheer',
    when: (c) => c.giftSenderCount === 1 && c.giftTotalCount > 1,
    render: (c) => `Cảm ơn ${c.giftSendersText} đã gửi liền ${c.giftTotalCount} phần quà ${c.giftName} cổ vũ các ghế nóng!`,
  },
  {
    id: 'qua_03',
    category: 'camOnQua',
    situation: 'gift_single',
    durationMs: 3700,
    requiredFields: ['giftSendersText', 'giftName'],
    cooldownMs: 75_000,
    jokeStyle: 'witty',
    when: (c) => c.giftSenderCount === 1,
    render: (c) => `Nhận được ${c.giftName} từ ${c.giftSendersText} là không khí sân khấu bừng sáng hẳn lên, cảm ơn bạn nhiều nha!`,
  },
  {
    id: 'qua_04',
    category: 'camOnQua',
    situation: 'gift_single',
    durationMs: 3500,
    requiredFields: ['giftSendersText', 'giftName'],
    cooldownMs: 75_000,
    jokeStyle: 'calm',
    when: (c) => c.giftSenderCount === 1,
    render: (c) => `Xin cảm ơn món quà ${c.giftName} rất dễ thương đến từ bạn ${c.giftSendersText}.`,
  },
  {
    id: 'qua_05',
    category: 'camOnQua',
    situation: 'gift_single',
    durationMs: 3600,
    requiredFields: ['giftSendersText', 'giftName'],
    cooldownMs: 75_000,
    jokeStyle: 'warm',
    when: (c) => c.giftSenderCount === 1,
    render: (c) => `Cảm ơn ${c.giftSendersText} đã tặng ${c.giftName}, chúc bạn trả lời thật chuẩn và gặt hái nhiều điểm cao!`,
  },
  {
    id: 'qua_06',
    category: 'camOnQua',
    situation: 'gift_single',
    durationMs: 3700,
    requiredFields: ['giftSendersText', 'giftName'],
    cooldownMs: 75_000,
    jokeStyle: 'cheer',
    when: (c) => c.giftSenderCount === 1,
    render: (c) => `Một phần quà ${c.giftName} tuyệt đẹp từ ${c.giftSendersText}, cảm ơn sự ủng hộ nhiệt tình của bạn!`,
  },
  {
    id: 'qua_07',
    category: 'camOnQua',
    situation: 'gift_single',
    durationMs: 3800,
    requiredFields: ['giftSendersText', 'giftName'],
    cooldownMs: 75_000,
    jokeStyle: 'fact',
    when: (c) => c.giftSenderCount === 1,
    render: (c) => `Trường quay xin cảm ơn ${c.giftSendersText} vừa gửi tặng ${c.giftName} cổ vũ tinh thần cả phòng chơi.`,
  },
  {
    id: 'qua_08',
    category: 'camOnQua',
    situation: 'gift_single',
    durationMs: 3600,
    requiredFields: ['giftSendersText', 'giftName'],
    cooldownMs: 75_000,
    jokeStyle: 'warm',
    when: (c) => c.giftSenderCount === 1,
    render: (c) => `Cảm ơn tấm lòng của ${c.giftSendersText} với món quà ${c.giftName} gửi tới chương trình!`,
  },
  {
    id: 'qua_09',
    category: 'camOnQua',
    situation: 'gift_multi',
    durationMs: 4100,
    requiredFields: ['giftSendersText', 'giftTotalCount'],
    cooldownMs: 75_000,
    jokeStyle: 'warm',
    when: (c) => c.giftSenderCount >= 2,
    render: (c) => `Cảm ơn ${c.giftSendersText} vừa gửi liền ${c.giftTotalCount} phần quà làm nóng bầu không khí trường quay!`,
  },
  {
    id: 'qua_10',
    category: 'camOnQua',
    situation: 'gift_multi',
    durationMs: 4200,
    requiredFields: ['giftSendersText', 'giftSenderCount'],
    cooldownMs: 75_000,
    jokeStyle: 'cheer',
    when: (c) => c.giftSenderCount >= 2,
    render: (c) => `Cơn mưa quà tặng từ ${c.giftSendersText}! Cảm ơn các bạn đã cổ vũ nhiệt tình cho phiên live!`,
  },
  {
    id: 'qua_11',
    category: 'camOnQua',
    situation: 'gift_multi',
    durationMs: 4000,
    requiredFields: ['giftSendersText', 'giftTotalCount'],
    cooldownMs: 75_000,
    jokeStyle: 'witty',
    when: (c) => c.giftSenderCount >= 2,
    render: (c) => `${c.giftSendersText} vừa tiếp thêm ${c.giftTotalCount} phần quà siêu chất, các ghế nóng nhớ thi đấu thật sung nhé!`,
  },
  {
    id: 'qua_12',
    category: 'camOnQua',
    situation: 'gift_multi',
    durationMs: 3900,
    requiredFields: ['giftSendersText'],
    cooldownMs: 75_000,
    jokeStyle: 'calm',
    when: (c) => c.giftSenderCount >= 2,
    render: (c) => `Xin gửi lời cảm ơn chân thành tới ${c.giftSendersText} đã gửi quà ủng hộ trường quay Ghế Nóng.`,
  },
  {
    id: 'qua_13',
    category: 'camOnQua',
    situation: 'gift_multi',
    durationMs: 4100,
    requiredFields: ['giftSendersText', 'giftTotalCount'],
    cooldownMs: 75_000,
    jokeStyle: 'fact',
    when: (c) => c.giftSenderCount >= 2,
    render: (c) => `Ghi nhận ${c.giftTotalCount} món quà khích lệ vừa được gửi từ ${c.giftSendersText}, cảm ơn các bạn rất nhiều!`,
  },
  {
    id: 'qua_14',
    category: 'camOnQua',
    situation: 'gift_any',
    durationMs: 3700,
    requiredFields: ['giftSendersText'],
    cooldownMs: 75_000,
    jokeStyle: 'warm',
    when: (c) => c.giftSenderCount >= 1,
    render: (c) => `Cảm ơn ${c.giftSendersText} đã gửi quà động viên, chúc bạn một buổi tối thật nhiều niềm vui trên Ghế Nóng!`,
  },
  {
    id: 'qua_15',
    category: 'camOnQua',
    situation: 'gift_any',
    durationMs: 3800,
    requiredFields: ['giftSendersText'],
    cooldownMs: 75_000,
    jokeStyle: 'cheer',
    when: (c) => c.giftSenderCount >= 1,
    render: (c) => `Tuyệt vời quá, cảm ơn ${c.giftSendersText} đã thả quà rực rỡ trên màn hình sân khấu!`,
  },
  {
    id: 'qua_16',
    category: 'camOnQua',
    situation: 'gift_any',
    durationMs: 3600,
    requiredFields: ['giftSendersText'],
    cooldownMs: 75_000,
    jokeStyle: 'calm',
    when: (c) => c.giftSenderCount >= 1,
    render: (c) => `Cảm ơn sự đồng hành và những món quà ấm áp từ ${c.giftSendersText} nhé.`,
  },
  {
    id: 'qua_17',
    category: 'camOnQua',
    situation: 'gift_any',
    durationMs: 3900,
    requiredFields: ['giftSendersText'],
    cooldownMs: 75_000,
    jokeStyle: 'witty',
    when: (c) => c.giftSenderCount >= 1,
    render: (c) => `Quà của ${c.giftSendersText} vừa bay qua làm MC cũng thấy hào hứng lây, cảm ơn bạn thật nhiều!`,
  },
  {
    id: 'qua_18',
    category: 'camOnQua',
    situation: 'gift_any',
    durationMs: 3700,
    requiredFields: ['giftSendersText', 'round'],
    cooldownMs: 75_000,
    jokeStyle: 'warm',
    when: (c) => c.giftSenderCount >= 1,
    render: (c) => `Cảm ơn ${c.giftSendersText} đã tiếp thêm năng lượng cho vòng ${c.round} của trường quay hôm nay!`,
  },
  {
    id: 'qua_19',
    category: 'camOnQua',
    situation: 'gift_any',
    durationMs: 3800,
    requiredFields: ['giftSendersText', 'giftTotalCount'],
    cooldownMs: 75_000,
    jokeStyle: 'cheer',
    when: (c) => c.giftSenderCount >= 1,
    render: (c) => `Xin cảm ơn ${c.giftTotalCount} phần quà cổ vũ đầy nhiệt huyết đến từ ${c.giftSendersText}!`,
  },
  {
    id: 'qua_20',
    category: 'camOnQua',
    situation: 'gift_any',
    durationMs: 3700,
    requiredFields: ['giftSendersText'],
    cooldownMs: 75_000,
    jokeStyle: 'fact',
    when: (c) => c.giftSenderCount >= 1,
    render: (c) => `Cảm ơn ${c.giftSendersText} đã tặng quà khích lệ; mọi điểm số và vị trí ghế vẫn đua công bằng theo câu trả lời nhé!`,
  },
];

export const MC_DIALOGUE_BANK: McDialogueTemplate[] = [
  ...CHAO_HOI_TEMPLATES,
  ...HUONG_DAN_TEMPLATES,
  ...MOI_LEN_GHE_TEMPLATES,
  ...CHO_TRA_LOI_TEMPLATES,
  ...NHAC_GIO_TEMPLATES,
  ...CONG_BO_KET_QUA_TEMPLATES,
  ...DONG_VIEN_TEMPLATES,
  ...VINH_DANH_TEMPLATES,
  ...CAM_ON_QUA_TEMPLATES,
];

// ============================================================================
// BỘ ĐIỀU KHIỂN LỜI THOẠI MC (McDirector)
// ============================================================================

export interface PendingWelcomeItem {
  userId: string;
  nickname: string;
  enqueuedAt: number;
  initialPosNote: string;
}

export interface PendingGiftItem {
  userId: string;
  nickname: string;
  giftName: string;
  count: number;
  enqueuedAt: number;
}

/** Hủy lời chào/cảm ơn quá cũ (> 25 giây) thay vì để hàng đợi kéo dài vài phút */
export const MAX_PENDING_AGE_MS = 25_000;
/** Khoảng cách tối thiểu giữa 2 câu phụ trong cùng 1 câu hỏi (8 giây) */
export const MIN_AUX_GAP_MS = 8_000;
/** Số câu phụ tối đa trong 1 câu hỏi (1–2 câu phụ) */
export const MAX_AUX_PER_QUESTION = 2;
/** Thời gian nghỉ riêng trước khi gọi lại tên cùng 1 người chơi (25 giây) */
export const NAME_CALL_COOLDOWN_MS = 25_000;
/** Chu kỳ nhắc hướng dẫn cách chơi (2.5 phút = 150 giây, nằm trong khoảng 2–3 phút) */
export const GUIDE_REMINDER_INTERVAL_MS = 150_000;

export class McDirector {
  private readonly now: () => number;
  private readonly rng: () => number;
  private seq = 0;

  /** Túi xáo trộn (shuffle bag) cho từng nhóm: dùng hết câu phù hợp rồi mới quay lại */
  private decks = new Map<McCategory, string[]>();
  /** Thời điểm gần nhất từng mẫu câu được phát (chống lặp theo cooldownMs) */
  private lastTemplateUsedAt = new Map<string, number>();
  /** 2 kiểu đùa (jokeStyle) gần nhất để tránh lặp kiểu đùa ở các lượt sát nhau */
  private recentJokeStyles: JokeStyle[] = [];
  /** Thời điểm gần nhất từng người chơi được MC gọi tên (có thời gian nghỉ riêng) */
  private lastUserNamedAt = new Map<string, number>();
  /** Tập người chơi đã được chào trong phiên hiện tại (chỉ chào ở lần tương tác hợp lệ đầu tiên) */
  private welcomedInSession = new Set<string>();

  /** Hàng đợi người mới chờ chào */
  pendingWelcomes: PendingWelcomeItem[] = [];
  /** Hàng đợi quà chờ cảm ơn */
  pendingGifts: PendingGiftItem[] = [];

  /** Theo dõi câu phụ trong câu hỏi đang mở */
  currentRunId: string | null = null;
  auxCountInQuestion = 0;
  lastAuxAt = -Infinity;
  lastSpeechEndAt = -Infinity;
  warned5sRunId: string | null = null;
  lastGuideReminderAt = -Infinity;

  constructor(opts: { now: () => number; rng: () => number }) {
    this.now = opts.now;
    this.rng = opts.rng;
  }

  resetForNewSession(now = this.now()) {
    this.welcomedInSession.clear();
    this.pendingWelcomes = [];
    this.pendingGifts = [];
    this.currentRunId = null;
    this.auxCountInQuestion = 0;
    this.lastAuxAt = -Infinity;
    this.lastSpeechEndAt = now;
    this.warned5sRunId = null;
    this.lastGuideReminderAt = now;
  }

  onQuestionStart(runId: string, now = this.now(), primarySpeechDurationMs = 3500) {
    this.currentRunId = runId;
    this.auxCountInQuestion = 0;
    this.lastAuxAt = now;
    this.lastSpeechEndAt = Math.max(this.lastSpeechEndAt, now + primarySpeechDurationMs);
    this.warned5sRunId = null;
  }

  /** Kiểm tra xem người chơi có đang trong thời gian nghỉ gọi tên hay không */
  canCallUserName(userId: string, now = this.now()): boolean {
    if (!userId) return false;
    const last = this.lastUserNamedAt.get(userId);
    if (last === undefined) return true;
    return now - last >= NAME_CALL_COOLDOWN_MS;
  }

  markUserNamed(userId: string, now = this.now()) {
    if (!userId) return;
    this.lastUserNamedAt.set(userId, now);
  }

  /**
   * Ghi nhận người mới theo lần tương tác hợp lệ đầu tiên (không dựa vào suy đoán ai đang xem).
   */
  enqueueNewcomerOnFirstValidAction(userId: string, nickname: string, initialPosNote: string, now = this.now()): boolean {
    if (!userId || this.welcomedInSession.has(userId)) return false;
    this.welcomedInSession.add(userId);
    this.pruneStaleQueues(now);
    this.pendingWelcomes.push({
      userId,
      nickname,
      enqueuedAt: now,
      initialPosNote,
    });
    return true;
  }

  /**
   * Ghi nhận quà tặng để gom lời cảm ơn; không gọi dồn dập tên một người.
   */
  enqueueGift(userId: string, nickname: string, giftName: string, count: number, now = this.now()) {
    this.pruneStaleQueues(now);
    const existing = this.pendingGifts.find((g) => g.userId === userId);
    if (existing) {
      existing.count += Math.max(1, count | 0);
      existing.giftName = giftName || existing.giftName;
      existing.enqueuedAt = now;
      return;
    }
    this.pendingGifts.push({
      userId,
      nickname,
      giftName: giftName || 'Quà',
      count: Math.max(1, count | 0),
      enqueuedAt: now,
    });
  }

  /** Hủy lời chào / lời cảm ơn quá cũ (> 25s) thay vì để hàng đợi kéo dài vài phút */
  pruneStaleQueues(now = this.now()) {
    this.pendingWelcomes = this.pendingWelcomes.filter((w) => now - w.enqueuedAt <= MAX_PENDING_AGE_MS);
    this.pendingGifts = this.pendingGifts.filter((g) => now - g.enqueuedAt <= MAX_PENDING_AGE_MS);
  }

  private getShuffledDeck(category: McCategory): string[] {
    let deck = this.decks.get(category);
    if (!deck || deck.length === 0) {
      const ids = MC_DIALOGUE_BANK.filter((t) => t.category === category).map((t) => t.id);
      // Xáo trộn Fisher-Yates bằng rng tiêm vào
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        const tmp = ids[i];
        ids[i] = ids[j];
        ids[j] = tmp;
      }
      deck = ids;
      this.decks.set(category, deck);
    }
    return deck;
  }

  /**
   * Chọn 1 câu phù hợp nhất từ nhóm `category`:
   * - Xáo trộn từng nhóm, dùng hết câu phù hợp trong túi (deck) rồi mới nạp/xáo trộn lại.
   * - Kiểm tra `requiredFields` và `when(ctx)` ngay trước khi phát.
   * - Tôn trọng `cooldownMs` và tránh lặp `jokeStyle` với lượt liền trước.
   */
  pickAndRender(
    category: McCategory,
    ctx: McDataContext,
    opts: { isAux?: boolean; remainPhaseMs?: number | null; now?: number } = {},
  ): EmittedMcLine | null {
    const now = opts.now ?? this.now();
    const isAux = Boolean(opts.isAux);
    const remainPhaseMs = opts.remainPhaseMs ?? null;

    const allInCategory = MC_DIALOGUE_BANK.filter((t) => t.category === category);
    if (allInCategory.length === 0) return null;

    const isEligible = (t: McDialogueTemplate, strictCooldown: boolean, strictJokeStyle: boolean): boolean => {
      if (!hasAllFields(ctx, t.requiredFields)) return false;
      if (!t.when(ctx)) return false;
      // Không bắt đầu lời phụ nếu thời gian còn lại không đủ phát hết
      if (isAux && remainPhaseMs !== null && remainPhaseMs < t.durationMs + 350) {
        return false;
      }
      if (strictCooldown) {
        const lastUsed = this.lastTemplateUsedAt.get(t.id);
        if (lastUsed !== undefined && now - lastUsed < t.cooldownMs) return false;
      }
      if (strictJokeStyle && t.jokeStyle !== 'none' && t.jokeStyle !== 'fact') {
        const lastStyle = this.recentJokeStyles[this.recentJokeStyles.length - 1];
        if (lastStyle && lastStyle === t.jokeStyle) return false;
      }
      return true;
    };

    const tryFromDeck = (deck: string[], strictCooldown: boolean, strictJoke: boolean): McDialogueTemplate | null => {
      for (let i = 0; i < deck.length; i++) {
        const id = deck[i];
        const tpl = allInCategory.find((x) => x.id === id);
        if (tpl && isEligible(tpl, strictCooldown, strictJoke)) {
          deck.splice(i, 1);
          return tpl;
        }
      }
      return null;
    };

    let deck = this.getShuffledDeck(category);
    let chosen =
      tryFromDeck(deck, true, true) ??
      tryFromDeck(deck, true, false);

    if (!chosen) {
      // Nếu những câu còn lại trong túi hiện tại không khớp tình huống, nạp túi mới đã xáo trộn để dùng hết câu phù hợp
      this.decks.delete(category);
      deck = this.getShuffledDeck(category);
      chosen =
        tryFromDeck(deck, true, true) ??
        tryFromDeck(deck, true, false) ??
        tryFromDeck(deck, false, true) ??
        tryFromDeck(deck, false, false);
    }

    if (!chosen) return null;

    const text = chosen.render(ctx).trim();
    if (!text) return null;

    this.lastTemplateUsedAt.set(chosen.id, now);
    if (chosen.jokeStyle !== 'none') {
      this.recentJokeStyles.push(chosen.jokeStyle);
      if (this.recentJokeStyles.length > 3) this.recentJokeStyles.shift();
    }
    this.lastSpeechEndAt = Math.max(now, this.lastSpeechEndAt) + chosen.durationMs;
    if (isAux) {
      this.auxCountInQuestion += 1;
      this.lastAuxAt = now;
    }

    return {
      id: ++this.seq,
      text,
      at: now,
      category: chosen.category,
      templateId: chosen.id,
      durationMs: chosen.durationMs,
      isAux,
    };
  }

  /**
   * Tiêu thụ hàng đợi chào người mới (gom tối đa 2–3 tên khi phòng đông) và KIỂM TRA LẠI vị trí thực tế ngay trước khi phát:
   * - Nếu người chơi đã đổi vị trí so với lúc vào hàng đợi, lấy vị trí mới thực tế hoặc bỏ ghi chú vị trí cũ.
   * - Nếu người chơi đã rời phòng / bị khóa, loại bỏ khỏi lời chào.
   */
  consumeWelcomeBatch(
    resolveCurrentPosition: (userId: string) => { active: boolean; currentPosNote: string | null },
    now = this.now(),
  ): {
    namesText: string;
    count: number;
    extraCount: number;
    positionNote: string;
    namedUserIds: string[];
  } | null {
    this.pruneStaleQueues(now);
    if (this.pendingWelcomes.length === 0) return null;

    const validItems: { userId: string; speakName: string; currentPosNote: string | null }[] = [];
    while (this.pendingWelcomes.length > 0) {
      const item = this.pendingWelcomes[0];
      const check = resolveCurrentPosition(item.userId);
      if (!check.active) {
        // Người chơi không còn trong hàng chờ/ghế nóng -> bỏ lời chào cũ
        this.pendingWelcomes.shift();
        continue;
      }
      if (!this.canCallUserName(item.userId, now)) {
        // Đang trong thời gian nghỉ gọi tên của người này -> bỏ qua để tránh gọi dồn dập
        this.pendingWelcomes.shift();
        continue;
      }
      this.pendingWelcomes.shift();
      validItems.push({
        userId: item.userId,
        speakName: speakableName(item.nickname),
        // Chỉ lấy vị trí khi vị trí hiện tại vẫn đúng & rõ ràng; nếu đã đổi vị trí sang trạng thái khác thì dùng vị trí mới
        currentPosNote: check.currentPosNote,
      });
    }

    if (validItems.length === 0) return null;

    // Gom tối đa 2–3 tên trong một lời chào
    const shown = validItems.slice(0, 3);
    const extraCount = Math.max(0, validItems.length - shown.length);
    for (const s of shown) this.markUserNamed(s.userId, now);

    // Lấy vị trí thực tế hiện tại (đã kiểm tra lại ngay trước khi phát; nếu người chơi đã hủy/đổi vị trí thì dùng vị trí mới hoặc bỏ vị trí cũ)
    const verifiedPosNote = shown.find((s) => Boolean(s.currentPosNote))?.currentPosNote ?? '';

    return {
      namesText: joinVi(shown.map((s) => s.speakName)),
      count: shown.length,
      extraCount,
      positionNote: verifiedPosNote,
      namedUserIds: shown.map((s) => s.userId),
    };
  }

  /**
   * Tiêu thụ hàng đợi cảm ơn quà đã gom; tôn trọng thời gian nghỉ gọi tên từng người để không gọi tên dồn dập.
   */
  consumeGiftBatch(now = this.now()): {
    sendersText: string;
    senderCount: number;
    giftName: string;
    totalCount: number;
  } | null {
    this.pruneStaleQueues(now);
    if (this.pendingGifts.length === 0) return null;

    const callable = this.pendingGifts.filter((g) => this.canCallUserName(g.userId, now));
    if (callable.length === 0) {
      // Nếu tất cả người tặng trong hàng đợi vừa mới được gọi tên xong, xóa các quà đã gom để không làm kẹt hàng đợi
      this.pendingGifts = [];
      return null;
    }

    const totalCount = callable.reduce((acc, g) => acc + g.count, 0);
    const firstGiftName = callable[0].giftName;
    const shown = callable.slice(0, 3);
    const extra = Math.max(0, callable.length - shown.length);
    for (const s of shown) this.markUserNamed(s.userId, now);
    this.pendingGifts = [];

    const baseNames = joinVi(shown.map((s) => speakableName(s.nickname)));
    const sendersText = extra > 0 ? `${baseNames} và ${extra} bạn` : baseNames;

    return {
      sendersText,
      senderCount: callable.length,
      giftName: firstGiftName,
      totalCount,
    };
  }
}
