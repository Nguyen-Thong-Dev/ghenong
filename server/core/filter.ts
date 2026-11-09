/**
 * Bộ lọc tên hiển thị và nội dung.
 * Tận dụng từ lop-hoc-chu (src/live/bannedWords.ts, src/live/names.ts) — MIT License,
 * Copyright (c) 2026 workaipvlinh-byte. Xem THIRD_PARTY_NOTICES.md.
 * Thay đổi: gộp hai file, thêm displayName() rút gọn tên cho ghế, chạy ở máy chủ.
 */

// Single words, lowercase, compared token by token
const BANNED_TOKENS = new Set([
  // Vietnamese vulgar (accented) and unambiguous teen-code
  'lồn', 'lìn', 'cặc', 'buồi', 'đéo', 'địt', 'đụ', 'đĩ', 'cứt', 'đm', 'đmm', 'đcm', 'đkm',
  'dm', 'dmm', 'dcm', 'dkm', 'vcl', 'vkl', 'vcc', 'clgt', 'loz', 'dit', 'ditme', 'dume', 'cmm',
  // English
  'fuck', 'fck', 'fuk', 'shit', 'bitch', 'dick', 'pussy', 'sex', 'sexy', 'porn', 'nude', 'xxx', 'cave',
  // Violence, gambling, scams
  'giết', 'chém', 'casino', 'scam',
]);

// Multi-word phrases, compared on the lowercase text with single spaces
const BANNED_PHRASES = [
  'địt mẹ', 'đụ má', 'đù má', 'đéo mẹ', 'con đĩ', 'dit me', 'du ma',
  'ma túy', 'ma tuý', 'thuốc lắc', 'cần sa', 'cá độ', 'lô đề', 'cờ bạc', 'chuyển khoản', 'lừa đảo',
];

const normalize = (text: string) => text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
const tokensOf = (text: string) => normalize(text).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);

export function containsBanned(text: string): boolean {
  if (!text) return false;
  const tokens = tokensOf(text);
  if (tokens.some((t) => BANNED_TOKENS.has(t))) return true;
  const joined = ` ${tokens.join(' ')} `;
  return BANNED_PHRASES.some((p) => joined.includes(` ${p} `));
}

/** Tên an toàn để hiện trên sân khấu: bỏ ký tự điều khiển, tên có từ cấm -> ẩn (vẫn giữ định danh) */
export function safeDisplayName(nickname: string | undefined): string {
  const clean = String(nickname ?? '')
    .normalize('NFKC')
    .replace(/[\x00-\x1f\x7f\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .trim()
    .slice(0, 60);
  if (!clean) return 'Người chơi';
  if (containsBanned(clean)) return 'Người chơi (tên ẩn)';
  return clean;
}

/** Rút gọn tên trên ghế (§11) — trang quản trị vẫn lưu tên đầy đủ */
export function shortName(name: string, max = 14): string {
  const chars = [...name];
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : name;
}

const DIGITS: Record<string, string> = {
  '0': 'không', '1': 'một', '2': 'hai', '3': 'ba', '4': 'bốn',
  '5': 'năm', '6': 'sáu', '7': 'bảy', '8': 'tám', '9': 'chín',
};
const NAME_STARTS = [
  'hoang', 'tuyet', 'thanh', 'trung', 'quang', 'minh', 'ngoc', 'phuc', 'xuan', 'quoc',
  'viet', 'tien', 'tuan', 'hong', 'duy', 'van', 'kim', 'hai', 'nam',
];
const MAX_WORDS = 5;

/** Tên TikTok -> tên cho giọng đọc (từ names.ts của lop-hoc-chu) */
export function speakableName(nickname: string): string {
  if (!nickname) return 'bạn';
  let clean = nickname
    .normalize('NFKC')
    .replace(/[\u{FE00}-\u{FE0F}\u200D\u20E3]/gu, '')
    .replace(/[^\p{L}\p{M}\p{N}\s._-]/gu, ' ')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean || containsBanned(clean)) return 'bạn';
  if (/^user\d{4,}$/i.test(clean)) return 'bạn';
  clean = clean
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .replace(/(\d)(\p{L})/gu, '$1 $2')
    .replace(/[._-]+/g, ' ');
  const out: string[] = [];
  for (const w of clean.split(/\s+/).filter(Boolean)) {
    if (/^\d+$/.test(w)) {
      if (w.length <= 4) out.push(w.split('').map((d) => DIGITS[d]).join(' '));
      continue;
    }
    const start = /^[a-z]+$/.test(w) ? NAME_STARTS.find((p) => w.startsWith(p) && w.length - p.length >= 2) : undefined;
    if (start) out.push(start, w.slice(start.length));
    else out.push(w);
  }
  return out.slice(0, MAX_WORDS).join(' ').trim() || 'bạn';
}
