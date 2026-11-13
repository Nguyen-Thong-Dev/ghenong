/**
 * Ngân hàng 300 câu hỏi Ghế Nóng (bộ khởi đầu v1.0, nguồn do người vận hành cung cấp).
 * - Dữ liệu gốc lưu dạng mảng gọn 3 phần (bank300.part1/2/3.json) để dễ biên tập.
 * - Nạp 1 lần và chuyển sang chuẩn Question của lõi luật:
 *   - difficulty: easy/de -> 'de', medium/vua -> 'vua', hard/kho -> 'kho'
 *   - explanation rỗng -> câu chào giải thích an toàn (engine yêu cầu không để trống)
 *   - status: 'approved' để vào vòng chọn câu ngay
 * - Bộ câu này KHÔNG có mã trùng với 20 câu mẫu q01..q20 (tiền tố GN).
 */
import fs from 'fs';
import path from 'path';
import type { Difficulty, Question } from '../core/types';

type Row = [string, string, string, string, string, string, string, string, string, string];

const normDifficulty = (d: string): Difficulty => {
  const k = d.trim().toLowerCase();
  if (k === 'easy' || k === 'de' || k === 'dễ') return 'de';
  if (k === 'hard' || k === 'kho' || k === 'khó') return 'kho';
  return 'vua';
};

function loadRows(): Row[] {
  const rows: Row[] = [];
  for (const part of ['part1', 'part2', 'part3']) {
    const file = path.join(import.meta.dirname, `bank300.${part}.json`);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Row[];
    rows.push(...parsed);
  }
  return rows;
}

const FALLBACK_EXPLANATION = 'Câu này trả lời theo kiến thức phổ thông; MC đọc đáp án đúng để chốt.';

let cache: Question[] | null = null;

/** 300 câu đã chuyển sang chuẩn lõi luật, sắp theo mã GN001..GN300 */
export function loadBank300(): Question[] {
  if (cache) return cache;
  const rows = loadRows();
  const seen = new Set<string>();
  const questions: Question[] = [];
  for (const r of rows) {
    const [id, topic, difficulty, text, a, b, c, d, correct, explanation] = r;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const choices = [a, b, c, d].map((x) => String(x ?? '').trim());
    questions.push({
      id: String(id).trim(),
      text: String(text ?? '').trim(),
      choices: choices as Question['choices'],
      correct: (['A', 'B', 'C', 'D'].includes(String(correct).trim().toUpperCase())
        ? String(correct).trim().toUpperCase()
        : 'A') as Question['correct'],
      explanation: String(explanation ?? '').trim() || FALLBACK_EXPLANATION,
      topic: String(topic ?? 'Tổng hợp').trim(),
      difficulty: normDifficulty(difficulty),
      source: 'Ngân hàng 300 câu Ghế Nóng v1.0',
      status: 'approved',
    });
  }
  cache = questions;
  return questions;
}
