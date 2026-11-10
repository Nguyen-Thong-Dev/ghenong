/**
 * Máy chủ chính của GHẾ NÓNG (Node.js + Express + TypeScript + SQLite).
 * - Chỉ lắng nghe trên 127.0.0.1 (cục bộ), không mở bảng điều khiển ra internet.
 * - Nguồn trạng thái chính nằm hoàn toàn trên máy chủ (GameEngine + Store SQLite).
 * - Trang sân khấu (?view=stage) chỉ nhận publicView() (không có đáp án đúng trước khi chốt).
 * - Các API giả lập (/api/sim/*) tách riêng, có thể tắt hoàn toàn bằng DISABLE_SIM=1 khi vận hành thật.
 */
import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Store } from './store/db';
import { GameEngine } from './core/engine';
import { SAMPLE_QUESTIONS, SIM_PROFILES } from './data/samples';
import { TikTokBridge } from './tiktok/connector';
import { synthesizeSpeech } from './tts/service';
import { AutoSimController } from './sim/autoBot';
import type { InboundEvent } from './core/types';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3008;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, 'data', 'runtime');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'ghenong.sqlite');
const SIM_ENABLED = process.env.DISABLE_SIM !== '1';

fs.mkdirSync(DATA_DIR, { recursive: true });

// Khóa xác thực quản trị cục bộ (§15: trang quản trị yêu cầu xác thực)
const TOKEN_FILE = path.join(DATA_DIR, 'admin-token.txt');
let ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
if (!ADMIN_TOKEN) {
  try {
    ADMIN_TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    ADMIN_TOKEN = 'gn_' + crypto.randomBytes(12).toString('hex');
    fs.writeFileSync(TOKEN_FILE, ADMIN_TOKEN, 'utf8');
  }
}

// Khởi tạo SQLite & nạp câu hỏi mẫu nếu ngân hàng trống
const store = new Store(DB_FILE);
if (store.loadQuestions().length === 0) {
  for (const q of SAMPLE_QUESTIONS) store.upsertQuestion(q);
}

const engine = new GameEngine({ store });
// Nạp sẵn danh sách 30 hồ sơ giả lập (sim_01..sim_30) và tự động điền vào 10 ghế chờ mà không cần gõ "chờ"
if (SIM_ENABLED) {
  const now = Date.now();
  store.tx(() => {
    for (const p of SIM_PROFILES) {
      const existing = engine.players.get(p.userId);
      if (!existing) {
        const player = {
          userId: p.userId,
          nickname: p.nickname,
          avatar: p.avatar,
          createdAt: now,
          autoRequeue: true,
          locked: false,
          bestLevelAll: 0,
          badges: [],
          totalPointsAll: 0,
          lastActiveAt: now,
        };
        engine.players.set(p.userId, player);
        store.upsertPlayer(player);
      } else if (!engine.state.session && !existing.locked) {
        existing.autoRequeue = true;
        existing.lastActiveAt = now;
        store.upsertPlayer(existing);
      }
    }
  });
  engine.refillWaitingQueue();
  engine.rotateAudience();
  store.saveSnapshot(engine.state);
}

// Bộ kết nối TikTok LIVE
const tiktok = new TikTokBridge(
  (ev) => engine.handleInbound(ev),
  (healthy, why) => engine.setSourceHealth(healthy, why),
  () => broadcastAll(),
);

const app = express();

// Chặn DNS rebinding: chỉ chấp nhận localhost, 127.0.0.1, lvh.me
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', 'lvh.me']);
const hostOk = (h?: string) => !!h && LOCAL_HOSTS.has(h.replace(/:\d+$/, '').toLowerCase());
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!hostOk(req.headers.host) || (origin && !hostOk(origin.replace(/^https?:\/\//, '')))) {
    return res.status(403).json({ error: 'Chỉ cho phép truy cập cục bộ' });
  }
  next();
});

app.use(express.json({ limit: '1mb' }));

// ---------- SSE: tách luồng sân khấu (công khai) và bảng điều khiển (quản trị) ----------
let stageClients: { id: string; res: express.Response }[] = [];
let adminClients: express.Response[] = [];

function currentSpeakerId(): string | null {
  return stageClients.length ? stageClients[stageClients.length - 1].id : null;
}

function makeStagePayload() {
  return {
    ...engine.publicView(),
    speakerId: currentSpeakerId(),
    stageCount: stageClients.length,
    live: tiktok.stats,
  };
}

function makeAdminPayload() {
  return {
    ...engine.adminView(),
    live: tiktok.stats,
    simEnabled: SIM_ENABLED,
    simProfiles: SIM_PROFILES,
    autoSim: autoSim.getStatus(),
    stageCount: stageClients.length,
  };
}

let broadcastScheduled = false;
function broadcastAll() {
  if (broadcastScheduled) return;
  broadcastScheduled = true;
  queueMicrotask(() => {
    broadcastScheduled = false;
    if (stageClients.length) {
      const stageMsg = `event: state\ndata: ${JSON.stringify(makeStagePayload())}\n\n`;
      for (const c of stageClients) {
        try {
          c.res.write(stageMsg);
        } catch {}
      }
    }
    if (adminClients.length) {
      const adminMsg = `event: admin\ndata: ${JSON.stringify(makeAdminPayload())}\n\n`;
      for (const res of adminClients) {
        try {
          res.write(adminMsg);
        } catch {}
      }
    }
  });
}

const autoSim = new AutoSimController(engine, () => broadcastAll(), SIM_ENABLED && process.env.E2E_TEST !== '1');
engine.onChange(() => broadcastAll());
tiktok.setSimMode(SIM_ENABLED);

// Nhịp đồng hồ máy chủ 200ms
let lastPhase = engine.state.phase;
setInterval(() => {
  engine.tick();
  autoSim.tick();
  if (engine.state.phase !== lastPhase) {
    lastPhase = engine.state.phase;
    broadcastAll();
  }
}, 200);

// ---------- API Sân khấu (chỉ đọc, không lộ đáp án đúng trước khi chốt) ----------
app.get('/api/stage/state', (_req, res) => {
  res.json(makeStagePayload());
});

app.get('/api/stage/stream', (req, res) => {
  const id = String(req.query.stageId || `stage_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`).slice(0, 48);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  stageClients = [...stageClients.filter((c) => c.id !== id), { id, res }];
  res.write(`event: state\ndata: ${JSON.stringify(makeStagePayload())}\n\n`);
  broadcastAll();

  const hb = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      clearInterval(hb);
    }
  }, 15_000);

  req.on('close', () => {
    clearInterval(hb);
    stageClients = stageClients.filter((c) => c.res !== res);
    broadcastAll();
  });
});

// ---------- API Giọng đọc tiếng Việt ----------
app.get('/api/tts', async (req, res) => {
  try {
    const text = String(req.query.text || '').trim();
    const rate = Number(req.query.rate) || 1.05;
    const { audio, fallback } = await synthesizeSpeech(text, rate);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', fallback ? 'no-store' : 'public, max-age=3600');
    res.send(audio);
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : 'TTS unavailable' });
  }
});

// ---------- Xác thực quản trị ----------
app.get('/api/admin/bootstrap', (_req, res) => {
  // Dịch vụ chỉ nghe trên 127.0.0.1: cấp mã xác thực cho bảng điều khiển cục bộ
  res.json({ token: ADMIN_TOKEN, simEnabled: SIM_ENABLED });
});

const requireAdmin: express.RequestHandler = (req, res, next) => {
  const token = String(req.headers['x-admin-token'] || req.query.token || '');
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ accepted: false, reason: 'Thiếu hoặc sai mã xác thực quản trị (X-Admin-Token)' });
  }
  next();
};

app.get('/api/admin/state', requireAdmin, (_req, res) => {
  res.json(makeAdminPayload());
});

app.get('/api/admin/stream', requireAdmin, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  adminClients.push(res);
  res.write(`event: admin\ndata: ${JSON.stringify(makeAdminPayload())}\n\n`);

  const hb = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      clearInterval(hb);
    }
  }, 15_000);

  req.on('close', () => {
    clearInterval(hb);
    adminClients = adminClients.filter((c) => c !== res);
  });
});

// Điều khiển phiên & câu hỏi
app.post('/api/admin/session/start', requireAdmin, (_req, res) => res.json(engine.startSession('admin')));
app.post('/api/admin/session/end', requireAdmin, (_req, res) => res.json(engine.endSession('admin')));
app.post('/api/admin/session/pause', requireAdmin, (req, res) => res.json(engine.pause('admin', req.body?.reason || 'Quản trị tạm dừng')));
app.post('/api/admin/session/resume', requireAdmin, (_req, res) => res.json(engine.resume('admin')));
app.post('/api/admin/question/cancel', requireAdmin, (req, res) => res.json(engine.cancelQuestion('admin', req.body?.reason || 'Quản trị hủy câu')));
app.post('/api/admin/question/undo', requireAdmin, (req, res) => res.json(engine.undoLast('admin', req.body?.reason || 'Hoàn tác câu vừa chấm')));

// Quản lý ngân hàng câu hỏi
app.post('/api/admin/questions/upsert', requireAdmin, (req, res) => res.json(engine.upsertQuestion('admin', req.body)));
app.post('/api/admin/questions/status', requireAdmin, (req, res) =>
  res.json(engine.setQuestionStatus('admin', String(req.body?.id || ''), req.body?.status)),
);

// Quản lý người chơi (rời ghế / khóa tài khoản có lý do; không có API đẩy lên đầu hàng)
app.post('/api/admin/player/kick', requireAdmin, (req, res) =>
  res.json(engine.kickFromSeat('admin', String(req.body?.userId || ''), String(req.body?.reason || ''))),
);
app.post('/api/admin/player/lock', requireAdmin, (req, res) =>
  res.json(engine.setLocked('admin', String(req.body?.userId || ''), Boolean(req.body?.locked), String(req.body?.reason || ''))),
);

// Cấu hình thông số cho câu tiếp theo & hiển thị vùng an toàn
app.post('/api/admin/config/rules', requireAdmin, (req, res) => res.json(engine.setRules('admin', req.body || {})));
app.post('/api/admin/config/display', requireAdmin, (req, res) => res.json(engine.setDisplay('admin', req.body || {})));

// Sao lưu & xuất nhật ký
app.post('/api/admin/backup', requireAdmin, (_req, res) => {
  try {
    const file = path.join(DATA_DIR, `backup-${Date.now()}.sqlite`);
    store.backupTo(file);
    res.json({ accepted: true, reason: `Đã sao lưu vào ${path.basename(file)}`, file });
  } catch (err) {
    res.status(500).json({ accepted: false, reason: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/admin/logs/export', requireAdmin, (_req, res) => {
  res.json(store.exportLogs(2000));
});

// Kết nối TikTok LIVE
app.post('/api/admin/tiktok/connect', requireAdmin, async (req, res) => {
  try {
    const r = await tiktok.connect(req.body?.username || '');
    res.json({ accepted: true, reason: `Đã kết nối phòng ${r.roomId || ''}` });
  } catch (err) {
    res.status(400).json({ accepted: false, reason: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/admin/tiktok/disconnect', requireAdmin, (_req, res) => {
  tiktok.disconnect();
  res.json({ accepted: true, reason: 'Đã ngắt kết nối TikTok' });
});

// ---------- API Giả lập tách biệt (có thể tắt bằng DISABLE_SIM=1 khi vận hành thật) ----------
let simSeq = 0;
if (SIM_ENABLED) {
  app.post('/api/sim/chat', requireAdmin, (req, res) => {
    const { userId, nickname, text, eventId, late } = req.body || {};
    const profile = SIM_PROFILES.find((p) => p.userId === userId);
    const now = Date.now();
    // Nếu chọn gửi quá hạn (late = true) khi câu đang mở: đặt thời điểm nhận = closesAt để kiểm tra chặn đáp án trễ
    const receivedAt =
      late && engine.state.current?.closesAt ? Math.max(now, engine.state.current.closesAt) : now;
    const ev: InboundEvent = {
      source: 'sim',
      eventId: eventId ? String(eventId) : `sim_${now}_${++simSeq}`,
      type: 'chat',
      userId: String(userId ?? ''),
      nickname: nickname ?? profile?.nickname ?? `Khách ${userId}`,
      avatar: profile?.avatar ?? '',
      text: String(text ?? ''),
      receivedAt,
    };
    const out = engine.handleInbound(ev);
    res.json({ ...out, eventId: ev.eventId, receivedAt });
  });

  app.post('/api/sim/gift', requireAdmin, (req, res) => {
    const { userId, giftName, count, diamonds } = req.body || {};
    const profile = SIM_PROFILES.find((p) => p.userId === userId);
    const now = Date.now();
    const ev: InboundEvent = {
      source: 'sim',
      eventId: `simgift_${now}_${++simSeq}`,
      type: 'gift',
      userId: String(userId || 'sim_01'),
      nickname: profile?.nickname ?? 'Người xem',
      gift: {
        name: String(giftName || 'Hoa hồng'),
        count: Number(count) || 1,
        diamonds: Number(diamonds) || 10,
      },
      receivedAt: now,
    };
    res.json(engine.handleInbound(ev));
  });

  app.post('/api/sim/connection', requireAdmin, (req, res) => {
    const healthy = Boolean(req.body?.healthy);
    engine.setSourceHealth(healthy, req.body?.reason || (healthy ? 'Khôi phục kết nối giả lập' : 'Mất kết nối giả lập'));
    res.json({ accepted: true, reason: healthy ? 'Đã giả lập kết nối khỏe lại' : 'Đã giả lập mất kết nối' });
  });

  // Tua nhanh đồng hồ của giai đoạn hiện tại (vẫn đi qua engine.tick() và lõi chấm điểm thật)
  app.post('/api/sim/advance-phase', requireAdmin, (req, res) => {
    const s = engine.state;
    const now = Date.now();
    const remainMs = typeof req.body?.remainMs === 'number' ? req.body.remainMs : null;
    if (remainMs !== null && s.phaseEndsAt != null) {
      s.phaseEndsAt = now + remainMs;
      s.phaseStartedAt = Math.min(s.phaseStartedAt, now - 6000);
      if (s.current && s.phase === 'OPEN') s.current.closesAt = now + remainMs;
      engine.tick();
      broadcastAll();
      return res.json({ accepted: true, reason: `Đã đặt thời gian còn lại = ${Math.ceil(remainMs / 1000)}s`, phase: engine.state.phase });
    }
    if (s.phase === 'INVITING' && s.invites.length) {
      for (const inv of s.invites) inv.expiresAt = now - 1;
      engine.tick();
      broadcastAll();
      return res.json({ accepted: true, reason: 'Đã hoàn tất 12 giây chuẩn bị: người chơi tự động lên ghế nóng', phase: engine.state.phase });
    }
    if (s.phaseEndsAt != null) {
      s.phaseEndsAt = now - 1;
      if (s.current && s.phase === 'OPEN') s.current.closesAt = now - 1;
      engine.tick();
      broadcastAll();
      return res.json({ accepted: true, reason: `Đã chuyển sang giai đoạn ${engine.state.phase}`, phase: engine.state.phase });
    }
    res.json({ accepted: false, reason: 'Giai đoạn hiện tại không có đồng hồ đếm ngược' });
  });

  // Bật / tắt chế độ 30 người chơi tự động trả lời & tặng quà như người thật
  app.post('/api/sim/auto-toggle', requireAdmin, (req, res) => {
    const next = typeof req.body?.enabled === 'boolean' ? req.body.enabled : !autoSim.enabled;
    autoSim.setEnabled(next);
    broadcastAll();
    res.json({
      accepted: true,
      enabled: autoSim.enabled,
      reason: autoSim.enabled
        ? '🤖 Đã BẬT chế độ 30 người chơi tự động (tự trả lời sớm/muộn, tặng quà, đổi ý, trả lời trễ như người thật)'
        : '⏸️ Đã TẮT chế độ 30 người chơi tự động',
    });
  });

  // Kích hoạt ngay 1 đợt 30 người chơi tương tác như thật (trả lời ngay + trả lời sau vài giây + tặng quà + trả lời trễ)
  app.post('/api/sim/wave-30', requireAdmin, (_req, res) => {
    const out = autoSim.triggerRealisticWaveNow();
    broadcastAll();
    res.json(out);
  });
} else {
  app.use('/api/sim', (_req, res) => {
    res.status(403).json({ accepted: false, reason: 'Chế độ giả lập đã bị vô hiệu hóa (DISABLE_SIM=1)' });
  });
}

// ---------- Phục vụ giao diện React (Vite middleware hoặc bản build) ----------
async function start() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer } = await import('vite');
    const vite = await createServer({
      configFile: path.join(ROOT_DIR, 'vite.config.ts'),
      server:
        process.env.LIVE_MODE === '1'
          ? { middlewareMode: true, hmr: false, ws: false }
          : { middlewareMode: true, hmr: { port: 24688 } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.use((_req, res) => res.sendFile(path.join(distDir, 'index.html')));
  }

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`============================================================`);
    console.log(`🔥 GHẾ NÓNG (v1.0) đã chạy trên máy cục bộ!`);
    console.log(`👉 Bảng điều khiển & Giả lập : http://localhost:${PORT}`);
    console.log(`👉 Màn hình Sân khấu (9:16)  : http://localhost:${PORT}/?view=stage`);
    console.log(`👉 Link cho OBS / LIVE Studio: http://lvh.me:${PORT}/?view=stage`);
    console.log(`============================================================`);
  });
}

start();
