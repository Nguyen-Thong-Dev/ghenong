/**
 * Hàng đợi giọng đọc tiếng Việt và âm thanh hiệu ứng trên trang Sân khấu.
 * Tận dụng ý tưởng hàng đợi tự gỡ kẹt từ voice.ts của lop-hoc-chu (MIT License, workaipvlinh-byte).
 * Bảo đảm lỗi hoặc chậm TTS không bao giờ làm treo cuộc chơi (§6).
 */
class StageVoice {
  enabled = false;
  rate = 1.05;
  private lastMcId = 0;
  private current: HTMLAudioElement | null = null;
  private guardTimer: ReturnType<typeof setTimeout> | null = null;
  onSpeakingChange?: (speaking: boolean) => void;

  speakMcLine(mc: { id: number; text: string } | null, allowAudio: boolean) {
    if (!mc || mc.id === this.lastMcId) return;
    this.lastMcId = mc.id;
    if (!allowAudio || !this.enabled || !mc.text.trim()) return;
    this.playUrl(`/api/tts?rate=${this.rate}&text=${encodeURIComponent(mc.text.trim())}`);
  }

  private playUrl(url: string) {
    this.stop();
    try {
      const audio = new Audio(url);
      this.current = audio;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        if (this.guardTimer) clearTimeout(this.guardTimer);
        this.guardTimer = null;
        this.onSpeakingChange?.(false);
        try {
          audio.pause();
          audio.removeAttribute('src');
        } catch {}
        if (this.current === audio) this.current = null;
      };
      // Giới hạn tối đa 6 giây chờ tải, tránh kẹt hàng đợi
      this.guardTimer = setTimeout(done, 6_000);
      audio.onplaying = () => {
        if (finished) return;
        this.onSpeakingChange?.(true);
        if (this.guardTimer) clearTimeout(this.guardTimer);
        const durMs = Number.isFinite(audio.duration) ? audio.duration * 1000 + 2000 : 12_000;
        this.guardTimer = setTimeout(done, durMs);
      };
      audio.onended = done;
      audio.onerror = done;
      audio.play().catch(done);
    } catch {
      this.onSpeakingChange?.(false);
    }
  }

  stop() {
    if (this.guardTimer) clearTimeout(this.guardTimer);
    this.guardTimer = null;
    if (this.current) {
      try {
        this.current.pause();
        this.current.removeAttribute('src');
      } catch {}
      this.current = null;
    }
    this.onSpeakingChange?.(false);
  }
}

export const stageVoice = new StageVoice();

/** Hiệu ứng âm thanh nhẹ bằng WebAudio (không cần tải file ngoài) */
class StageSfx {
  private ctx: AudioContext | null = null;
  enabled = true;

  private getCtx(): AudioContext | null {
    if (!this.enabled) return null;
    try {
      this.ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      return this.ctx;
    } catch {
      return null;
    }
  }

  tone(freq: number, durationMs: number, type: OscillatorType = 'sine', gainVal = 0.08) {
    const ctx = this.getCtx();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + durationMs / 1000);
    } catch {}
  }

  playPhase(phase: string) {
    if (phase === 'OPEN') {
      this.tone(523.25, 140, 'triangle', 0.09);
      setTimeout(() => this.tone(659.25, 180, 'triangle', 0.09), 120);
    } else if (phase === 'REVEAL') {
      this.tone(440, 160, 'sine', 0.08);
    } else if (phase === 'HONOR') {
      this.tone(587.33, 140, 'triangle', 0.1);
      setTimeout(() => this.tone(880, 260, 'triangle', 0.1), 130);
    }
  }
}

export const stageSfx = new StageSfx();
