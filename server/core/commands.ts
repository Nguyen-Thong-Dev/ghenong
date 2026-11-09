/**
 * Chuẩn hóa bình luận thành lệnh (§3 bộ luật). Dùng chung cho nguồn giả lập và TikTok thật.
 * - Không phân biệt hoa/thường, bỏ khoảng trắng đầu/cuối.
 * - Đáp án "23B" / "23 b" -> { code: 23, choice: 'B' }.
 * - Không nhận A/B/C/D đơn lẻ, không đọc đáp án trong câu dài, không nhận nhiều lựa chọn.
 */
export type Command =
  | { kind: 'vao' }
  | { kind: 'cho' }
  | { kind: 'huy' }
  | { kind: 'ss' }
  | { kind: 'nhuong' }
  | { kind: 'diem' }
  | { kind: 'vitri' }
  | { kind: 'answer'; code: number; choice: 'A' | 'B' | 'C' | 'D' };

const KEYWORDS: Record<string, Command['kind']> = {
  vao: 'vao',
  'vào': 'vao',
  cho: 'cho',
  'chờ': 'cho',
  huy: 'huy',
  'hủy': 'huy',
  'huỷ': 'huy', // kiểu bỏ dấu cũ của "hủy"
  ss: 'ss',
  'sẵn sàng': 'ss',
  nhuong: 'nhuong',
  'nhường': 'nhuong',
  diem: 'diem',
  'điểm': 'diem',
  vitri: 'vitri',
  'vị trí': 'vitri',
};

const ANSWER_RE = /^(\d{1,5})\s*([abcd])$/i;

export function normalizeText(raw: string): string {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function parseCommand(raw: string): Command | null {
  const t = normalizeText(raw);
  if (!t) return null;
  const kw = KEYWORDS[t];
  if (kw) return { kind: kw } as Command;
  const m = ANSWER_RE.exec(t);
  if (m) return { kind: 'answer', code: Number(m[1]), choice: m[2].toUpperCase() as 'A' | 'B' | 'C' | 'D' };
  return null;
}

/** Hướng dẫn cú pháp ngắn cho người mới (§3: mỗi thông báo có hướng dẫn đúng cú pháp) */
export const SYNTAX_HINT = 'Gõ VÀO để tham gia · CHỜ để xếp hàng · mã câu + đáp án, ví dụ 23B';
