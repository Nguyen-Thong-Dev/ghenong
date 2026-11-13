/**
 * Nạp trực tiếp 300 câu GN vào cơ sở dữ liệu runtime thật (data/runtime/ghenong.sqlite).
 * - Không ghi đè câu đã tồn tại (chỉ thêm câu thiếu).
 * - Chạy: node scripts/seed-bank300.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DB = path.join(process.cwd(), 'data', 'runtime', 'ghenong.sqlite');
const FALLBACK = 'Câu này trả lời theo kiến thức phổ thông; MC đọc đáp án đúng để chốt.';
const normD = (d) =>
  ['easy', 'de', 'dễ'].includes(d.toLowerCase()) ? 'de' : ['hard', 'kho', 'khó'].includes(d.toLowerCase()) ? 'kho' : 'vua';

const rows = [];
for (const p of ['part1', 'part2', 'part3']) {
  rows.push(...JSON.parse(fs.readFileSync(new URL(`../server/data/bank300.${p}.json`, import.meta.url), 'utf8')));
}

const db = new DatabaseSync(DB);
const existing = new Set(db.prepare('SELECT id FROM questions').all().map((r) => r.id));
const stmt = db.prepare(
  'INSERT INTO questions (id, status, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data',
);
let added = 0;
for (const r of rows) {
  const [id, topic, difficulty, text, a, b, c, d, correct, explanation] = r;
  if (existing.has(id)) continue;
  const q = {
    id: String(id).trim(),
    text: String(text).trim(),
    choices: [String(a), String(b), String(c), String(d)],
    correct: String(correct).trim().toUpperCase(),
    explanation: String(explanation || '').trim() || FALLBACK,
    topic: String(topic).trim(),
    difficulty: normD(String(difficulty)),
    source: 'Ngân hàng 300 câu Ghế Nóng v1.0',
    status: 'approved',
  };
  stmt.run(q.id, q.status, JSON.stringify(q));
  added++;
}
const total = db.prepare('SELECT COUNT(*) AS n FROM questions').get().n;
console.log(`Đã thêm ${added} câu GN | Tổng số câu trong ngân hàng: ${total}`);
db.close();
