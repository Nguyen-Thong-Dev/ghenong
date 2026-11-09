/**
 * Lưu trữ SQLite (node:sqlite, có sẵn trong Node >= 22.13, không cần biên dịch thư viện native).
 *
 * - Bảng chuẩn hóa: người chơi, sự kiện đã xử lý (chống trùng), lượt câu hỏi, đáp án đầu tiên,
 *   kết quả từng câu, nhật ký lệnh, nhật ký quản trị, lịch sử cấu hình, ngân hàng câu hỏi.
 * - Ảnh chụp trạng thái MÁY CHỦ (không phải giao diện) được ghi trong CÙNG giao dịch với mỗi thay đổi
 *   ghế/hàng chờ/chấm điểm, nên khởi động lại không bị lệch giữa kết quả đã chấm và vị trí ghế.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import type { EngineState, Player, Question } from '../core/types';

export interface ResultRow {
  runId: string;
  userId: string;
  role: 'hot' | 'other';
  seat: number | null;
  choice: string | null;
  correct: boolean;
  points: number;
  levelBefore: number | null;
  levelAfter: number | null;
}

export class Store {
  readonly db: DatabaseSync;
  private depth = 0;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS players (user_id TEXT PRIMARY KEY, nickname TEXT, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS processed_events (event_id TEXT PRIMARY KEY, source TEXT, received_at INTEGER);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, started_at INTEGER, ended_at INTEGER);
      CREATE TABLE IF NOT EXISTS question_runs (
        run_id TEXT PRIMARY KEY, session_id TEXT, code INTEGER, question_id TEXT, status TEXT,
        prepared_at INTEGER, opened_at INTEGER, closes_at INTEGER, graded_at INTEGER, note TEXT,
        UNIQUE(session_id, code));
      CREATE TABLE IF NOT EXISTS answers (
        run_id TEXT, user_id TEXT, choice TEXT, received_at INTEGER, event_id TEXT,
        PRIMARY KEY (run_id, user_id));
      CREATE TABLE IF NOT EXISTS question_results (
        run_id TEXT, user_id TEXT, role TEXT, seat INTEGER, choice TEXT, correct INTEGER, points INTEGER,
        level_before INTEGER, level_after INTEGER, undone INTEGER DEFAULT 0,
        PRIMARY KEY (run_id, user_id));
      CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, status TEXT, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS command_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, user_id TEXT, text TEXT, accepted INTEGER, reason TEXT);
      CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, actor TEXT, action TEXT, detail TEXT);
      CREATE TABLE IF NOT EXISTS config_history (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, actor TEXT, config TEXT);
    `);
  }

  /** Giao dịch lồng được: chỉ lớp ngoài cùng BEGIN/COMMIT */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth++;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    } finally {
      this.depth--;
    }
  }

  // ---------- ảnh chụp trạng thái máy chủ ----------
  loadSnapshot(): EngineState | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('engine') as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as EngineState) : null;
  }
  saveSnapshot(s: EngineState) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('engine', JSON.stringify(s));
  }
  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }
  setMeta(key: string, value: string) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  // ---------- người chơi ----------
  loadPlayers(): Player[] {
    return (this.db.prepare('SELECT data FROM players').all() as { data: string }[]).map((r) => JSON.parse(r.data));
  }
  upsertPlayer(p: Player) {
    this.db
      .prepare('INSERT INTO players (user_id, nickname, data) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET nickname = excluded.nickname, data = excluded.data')
      .run(p.userId, p.nickname, JSON.stringify(p));
  }

  // ---------- chống xử lý trùng ----------
  /** true nếu sự kiện mới; false nếu đã xử lý trước đó */
  markEvent(eventId: string, source: string, at: number): boolean {
    const r = this.db.prepare('INSERT OR IGNORE INTO processed_events (event_id, source, received_at) VALUES (?, ?, ?)').run(eventId, source, at);
    return Number(r.changes) > 0;
  }

  // ---------- phiên, lượt câu hỏi, đáp án, kết quả ----------
  insertSession(id: string, at: number) {
    this.db.prepare('INSERT OR IGNORE INTO sessions (id, started_at) VALUES (?, ?)').run(id, at);
  }
  endSession(id: string, at: number) {
    this.db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(at, id);
  }
  insertRun(r: { runId: string; sessionId: string; code: number; questionId: string; preparedAt: number }) {
    this.db
      .prepare("INSERT INTO question_runs (run_id, session_id, code, question_id, status, prepared_at) VALUES (?, ?, ?, ?, 'prepare', ?)")
      .run(r.runId, r.sessionId, r.code, r.questionId, r.preparedAt);
  }
  setRunStatus(runId: string, status: string, fields: { openedAt?: number; closesAt?: number; gradedAt?: number; note?: string } = {}) {
    this.db
      .prepare(
        'UPDATE question_runs SET status = ?, opened_at = COALESCE(?, opened_at), closes_at = COALESCE(?, closes_at), graded_at = COALESCE(?, graded_at), note = COALESCE(?, note) WHERE run_id = ?',
      )
      .run(status, fields.openedAt ?? null, fields.closesAt ?? null, fields.gradedAt ?? null, fields.note ?? null, runId);
  }
  getRunStatus(runId: string): string | null {
    const row = this.db.prepare('SELECT status FROM question_runs WHERE run_id = ?').get(runId) as { status: string } | undefined;
    return row?.status ?? null;
  }
  /** Khóa đáp án đầu tiên: PRIMARY KEY (run_id, user_id) — trả về false nếu tài khoản đã có đáp án */
  insertAnswer(runId: string, userId: string, choice: string, at: number, eventId: string): boolean {
    const r = this.db
      .prepare('INSERT OR IGNORE INTO answers (run_id, user_id, choice, received_at, event_id) VALUES (?, ?, ?, ?, ?)')
      .run(runId, userId, choice, at, eventId);
    return Number(r.changes) > 0;
  }
  loadAnswers(runId: string): Map<string, { choice: string; at: number }> {
    const rows = this.db.prepare('SELECT user_id, choice, received_at FROM answers WHERE run_id = ?').all(runId) as {
      user_id: string;
      choice: string;
      received_at: number;
    }[];
    return new Map(rows.map((r) => [r.user_id, { choice: r.choice, at: r.received_at }]));
  }
  insertResults(rows: ResultRow[]) {
    const st = this.db.prepare(
      'INSERT INTO question_results (run_id, user_id, role, seat, choice, correct, points, level_before, level_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const r of rows) st.run(r.runId, r.userId, r.role, r.seat, r.choice, r.correct ? 1 : 0, r.points, r.levelBefore, r.levelAfter);
  }
  markResultsUndone(runId: string) {
    this.db.prepare('UPDATE question_results SET undone = 1 WHERE run_id = ?').run(runId);
  }
  countResults(runId: string): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM question_results WHERE run_id = ?').get(runId) as { n: number }).n);
  }

  // ---------- ngân hàng câu hỏi ----------
  loadQuestions(): Question[] {
    return (this.db.prepare('SELECT data FROM questions ORDER BY rowid').all() as { data: string }[]).map((r) => JSON.parse(r.data));
  }
  upsertQuestion(q: Question) {
    this.db
      .prepare('INSERT INTO questions (id, status, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data')
      .run(q.id, q.status, JSON.stringify(q));
  }

  // ---------- nhật ký ----------
  logCommand(at: number, userId: string, text: string, accepted: boolean, reason: string) {
    this.db.prepare('INSERT INTO command_log (at, user_id, text, accepted, reason) VALUES (?, ?, ?, ?, ?)').run(at, userId, text.slice(0, 200), accepted ? 1 : 0, reason);
  }
  audit(at: number, actor: string, action: string, detail: string) {
    this.db.prepare('INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)').run(at, actor, action, detail);
  }
  saveConfigHistory(at: number, actor: string, config: unknown) {
    this.db.prepare('INSERT INTO config_history (at, actor, config) VALUES (?, ?, ?)').run(at, actor, JSON.stringify(config));
  }
  exportLogs(limit = 5000) {
    return {
      commands: this.db.prepare('SELECT * FROM command_log ORDER BY id DESC LIMIT ?').all(limit),
      audit: this.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit),
      runs: this.db.prepare('SELECT * FROM question_runs ORDER BY prepared_at DESC LIMIT ?').all(limit),
      configHistory: this.db.prepare('SELECT * FROM config_history ORDER BY id DESC LIMIT 200').all(),
    };
  }

  /** Sao lưu ra một file SQLite riêng (VACUUM INTO) */
  backupTo(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  }

  close() {
    this.db.close();
  }
}
