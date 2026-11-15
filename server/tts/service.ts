/**
 * Dịch vụ giọng đọc tiếng Việt (Edge TTS + dự phòng Google TTS).
 * Tận dụng từ server.ts của lop-hoc-chu (MIT License, workaipvlinh-byte).
 * Có giới hạn thời gian (timeout) nghiêm ngặt để lỗi hoặc chậm TTS không bao giờ làm treo cuộc chơi (§6).
 */
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const getTtsVoice = () => (process.env.TTS_VOICE || 'vi-VN-HoaiMyNeural').trim();
const getTtsPitch = () => (process.env.TTS_PITCH || '+4%').trim();

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function splitText(text: string, max = 180): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const win = rest.slice(0, max + 1);
    let cut = Math.max(win.lastIndexOf('. '), win.lastIndexOf('! '), win.lastIndexOf('? '));
    if (cut < max / 2) cut = Math.max(win.lastIndexOf(', '), win.lastIndexOf('; '));
    if (cut < max / 2) cut = win.lastIndexOf(' ');
    if (cut <= 0) cut = max - 1;
    chunks.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

let edgeChain: Promise<unknown> = Promise.resolve();
const edgeInflight = new Map<string, Promise<Buffer>>();
const ttsCache = new Map<string, Buffer>();

async function edgeTtsOnce(text: string, rate: number, voiceName = getTtsVoice()): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeXml(text), {
      rate: `${rate >= 1 ? '+' : ''}${Math.round((rate - 1) * 100)}%`,
      pitch: getTtsPitch(),
      volume: '+0%',
    });
    const chunks: Buffer[] = [];
    const read = (async () => {
      for await (const c of audioStream) chunks.push(c as Buffer);
    })();
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Edge TTS timeout')), 6_000));
    await Promise.race([read, timeout]);
    if (chunks.length === 0) throw new Error('Edge TTS empty');
    return Buffer.concat(chunks);
  } finally {
    try {
      tts.close();
    } catch {}
  }
}

function edgeTts(text: string, rate: number, voiceName = getTtsVoice()): Promise<Buffer> {
  const key = `${voiceName}|${rate}|${text}`;
  const running = edgeInflight.get(key);
  if (running) return running;
  const job = edgeChain.then(() => edgeTtsOnce(text, rate, voiceName));
  edgeChain = job.catch(() => {});
  edgeInflight.set(key, job);
  job.finally(() => edgeInflight.delete(key)).catch(() => {});
  return job;
}

async function googleTts(text: string): Promise<Buffer> {
  const parts: Buffer[] = [];
  for (const chunk of splitText(text)) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5_000);
    try {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q=${encodeURIComponent(chunk)}`;
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://translate.google.com/',
        },
      });
      if (!r.ok) throw new Error(`Google TTS ${r.status}`);
      parts.push(Buffer.from(await r.arrayBuffer()));
    } finally {
      clearTimeout(timer);
    }
  }
  return Buffer.concat(parts);
}

export async function synthesizeSpeech(rawText: string, rate = 1.05): Promise<{ audio: Buffer; fallback: boolean }> {
  const text = String(rawText || '').trim().slice(0, 600);
  if (!text) throw new Error('Thiếu nội dung đọc');
  const voice = getTtsVoice();
  const pitch = getTtsPitch();
  const cleanRate = Math.min(1.4, Math.max(0.7, Number(rate) || 1.05));
  const key = `${voice}|${pitch}|${cleanRate}|${text}`;
  const cached = ttsCache.get(key);
  if (cached) return { audio: cached, fallback: false };

  try {
    const audio = await edgeTts(text, cleanRate, voice);
    ttsCache.set(key, audio);
    if (ttsCache.size > 150) ttsCache.delete(ttsCache.keys().next().value!);
    return { audio, fallback: false };
  } catch {
    const audio = await googleTts(text);
    return { audio, fallback: true };
  }
}
