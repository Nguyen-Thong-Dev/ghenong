/**
 * Chọn câu hỏi theo §12:
 * - Chỉ câu đã duyệt, không lặp ID trong phiên (kể cả câu đã hủy).
 * - Mỗi nhóm 10 câu: 3 dễ, 5 vừa, 2 khó; xáo thứ tự; không hai câu khó liên tiếp nếu có đủ nội dung.
 * - Không quá 3 câu liên tiếp cùng chủ đề.
 * - Hết câu: trả về null (engine chuyển màn hình nghỉ, không lặp, không bịa câu).
 */
import type { Difficulty, Question } from './types';

export function buildBlock(rng: () => number, lastHard: boolean): Difficulty[] {
  const base: Difficulty[] = ['de', 'de', 'de', 'vua', 'vua', 'vua', 'vua', 'vua', 'kho', 'kho'];
  for (let attempt = 0; attempt < 200; attempt++) {
    const a = [...base];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    const ok = a.every((d, i) => d !== 'kho' || (i === 0 ? !lastHard : a[i - 1] !== 'kho'));
    if (ok) return a;
  }
  return ['vua', 'kho', 'de', 'vua', 'vua', 'kho', 'de', 'vua', 'de', 'vua'];
}

export interface PickResult {
  question: Question;
  plan: Difficulty[];
  note?: string;
}

export function pickQuestion(
  bank: Question[],
  used: Set<string>,
  plan: Difficulty[],
  recentTopics: string[],
  lastHard: boolean,
  rng: () => number,
): PickResult | null {
  const pool = bank.filter((q) => q.status === 'approved' && !used.has(q.id));
  if (pool.length === 0) return null;
  let p = plan.length ? [...plan] : buildBlock(rng, lastHard);
  const target = p[0];
  const last3 = recentTopics.slice(-3);
  const bannedTopic = last3.length === 3 && last3.every((t) => t === last3[0]) ? last3[0] : null;
  const topicOk = (q: Question) => q.topic !== bannedTopic;
  const hardOk = (q: Question) => !(lastHard && q.difficulty === 'kho');

  const tiers: { filter: (q: Question) => boolean; note?: string }[] = [
    { filter: (q) => q.difficulty === target && topicOk(q) && hardOk(q) },
    { filter: (q) => topicOk(q) && hardOk(q), note: `thiếu câu mức "${target}", dùng mức khác` },
    { filter: (q) => hardOk(q), note: 'thiếu nội dung: buộc lặp chủ đề quá 3 câu' },
    { filter: () => true, note: 'thiếu nội dung: buộc hai câu khó liên tiếp' },
  ];
  for (const tier of tiers) {
    const cands = pool.filter(tier.filter);
    if (!cands.length) continue;
    const q = cands[Math.floor(rng() * cands.length)];
    const idx = p.indexOf(q.difficulty);
    if (idx >= 0) p.splice(idx, 1);
    else p.shift();
    return { question: q, plan: p, note: tier.note };
  }
  return null;
}

export function validateQuestion(q: Partial<Question>): string | null {
  if (!q.id || typeof q.id !== 'string') return 'Thiếu mã câu';
  if (!q.text || !String(q.text).trim()) return 'Thiếu nội dung câu hỏi';
  if (!Array.isArray(q.choices) || q.choices.length !== 4) return 'Cần đúng 4 lựa chọn';
  const norm = q.choices.map((c) => String(c ?? '').trim().toLowerCase());
  if (norm.some((c) => !c)) return 'Có lựa chọn trống';
  if (new Set(norm).size !== 4) return '4 lựa chọn phải khác nhau';
  if (!q.correct || !['A', 'B', 'C', 'D'].includes(q.correct)) return 'Đáp án đúng phải là A, B, C hoặc D';
  if (!q.explanation || !String(q.explanation).trim()) return 'Thiếu giải thích ngắn';
  if (!q.topic || !String(q.topic).trim()) return 'Thiếu chủ đề';
  if (!q.difficulty || !['de', 'vua', 'kho'].includes(q.difficulty)) return 'Mức khó phải là de / vua / kho';
  return null;
}
