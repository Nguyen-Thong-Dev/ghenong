/**
 * Hệ thống quản lý âm thanh tập trung cho gameshow GHẾ NÓNG:
 * - Nhạc nền (BGM): Nhạc giao lưu (Funky Electronic Lounge) & Nhạc suy nghĩ (Suspense Tension Pulse).
 * - Hiệu ứng (SFX): Đếm ngược (10..1s), Trả lời đúng, Trả lời sai, Lên ghế nóng, Vinh danh.
 * - Giọng đọc MC (TTS): Hàng đợi tự gỡ kẹt qua /api/tts.
 * - Quản lý âm lượng 4 kênh: Tổng (Master), Nhạc nền (BGM), Hiệu ứng (SFX), Giọng MC (Voice).
 * - Auto-ducking: Tự động giảm nhạc nền -10 dB (~0.316x) khi MC nói, tăng lại êm dịu khi nói xong (có giới hạn an toàn 25s chống kẹt).
 * - Đảm bảo chỉ 1 bài BGM phát tại một thời điểm, chuyển bài mượt, không giật hoặc lặp lại bài cũ.
 * - Nhạc nền dùng lookahead scheduler (đặt lịch nốt theo đồng hồ AudioContext) nên không vỡ/yếu khi tab nền bị trình duyệt giảm timer.
 * - Chống chồng âm thanh (SFX debouncing & unified reveal chime cho 5 ghế).
 * - Đồng bộ thời gian thực giữa Bảng điều khiển (Dashboard) và Sân khấu (Stage) qua BroadcastChannel/localStorage.
 * - Xử lý chính sách Autoplay của trình duyệt qua resumeContext().
 */

export interface AudioSettings {
  masterMuted: boolean;
  masterVolume: number; // 0..1
  bgmEnabled: boolean;
  bgmVolume: number; // 0..1
  bgmTrack: 'auto' | 'lobby' | 'thinking' | 'off';
  sfxEnabled: boolean;
  sfxVolume: number; // 0..1
  mcEnabled: boolean;
  mcVolume: number; // 0..1
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  masterMuted: false,
  masterVolume: 0.85,
  bgmEnabled: true,
  bgmVolume: 0.6,
  bgmTrack: 'auto',
  sfxEnabled: true,
  sfxVolume: 0.8,
  mcEnabled: true,
  mcVolume: 0.95,
};

const STORAGE_SETTINGS_KEY = 'gn_audio_settings_v1';
const DUCK_FACTOR = 0.3162; // -10 dB = 10^(-10/20)

type SfxKind = 'countdown' | 'correct' | 'wrong' | 'seat' | 'honor';
type BgmType = 'lobby' | 'thinking' | 'off';
type AudioFileKey = 'lobby' | 'thinking' | 'countdown' | 'correct' | 'honor';

const AUDIO_FILE_URLS: Record<AudioFileKey, string> = {
  lobby: '/audio/giao-luu.mp3',
  thinking: '/audio/suy-nghi.mp3',
  countdown: '/audio/dem-nguoc.mp3',
  correct: '/audio/tra-loi-dung.mp3',
  honor: '/audio/vinh-danh.mp3',
};

class StageAudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  // Bộ đệm MP3 đã giải mã và các nguồn phát đang chạy
  private audioBuffers: Partial<Record<AudioFileKey, AudioBuffer>> = {};
  private loadingBuffers: Partial<Record<AudioFileKey, Promise<AudioBuffer | null>>> = {};
  private activeBgmSource: AudioBufferSourceNode | null = null;
  private activeSfxSources: Set<AudioBufferSourceNode> = new Set();
  private activeCountdownSource: AudioBufferSourceNode | null = null;
  private bgmRunToken = 0;

  private settings: AudioSettings;
  private subscribers: Set<(s: AudioSettings) => void> = new Set();
  private broadcast: BroadcastChannel | null = null;

  // Trạng thái vận hành
  private speakerAllowed = true;
  private isMcSpeaking = false;
  private currentBgmTrack: BgmType = 'off';
  private bgmLoopTimer: ReturnType<typeof setInterval> | null = null;
  private bgmStep = 0;
  private bgmStepDur = 0.139; // giây / bước (16th note ở 108 BPM)
  private bgmNextNoteTime = 0; // mốc thời gian tuyệt đối của bước kế tiếp theo đồng hồ AudioContext
  private activeBgmOscs: Set<OscillatorNode> = new Set();
  private lastGameStateArgs: [string, number | null, boolean] | null = null;
  private mcDuckGuard: ReturnType<typeof setTimeout> | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private previewingSound: string | null = null;

  // Khử trùng hiệu ứng âm thanh
  private lastSfxTime: Record<string, number> = {};
  private lastRevealPhaseKey = '';

  constructor() {
    this.settings = this.loadSettings();
    if (typeof window !== 'undefined') {
      try {
        this.broadcast = new BroadcastChannel('ghenong_audio_sync');
        this.broadcast.onmessage = (ev) => {
          if (ev.data && typeof ev.data === 'object' && ev.data.type === 'SYNC_SETTINGS') {
            this.applySettingsLocally(ev.data.settings, false);
          }
        };
      } catch {}

      window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_SETTINGS_KEY && e.newValue) {
          try {
            const parsed = JSON.parse(e.newValue);
            this.applySettingsLocally(parsed, false);
          } catch {}
        }
      });

      // Tự động mở khóa Web Audio khi người dùng tương tác lần đầu
      const unlock = () => {
        const ctx = this.getContext();
        if (ctx && ctx.state === 'suspended') {
          void ctx.resume().then(() => this.notify());
        }
      };
      window.addEventListener('pointerdown', unlock, { passive: true });
      window.addEventListener('click', unlock, { passive: true });
      window.addEventListener('keydown', unlock, { passive: true });
      window.addEventListener('touchstart', unlock, { passive: true });

      // Khi tab quay lại hiển thị: trình duyệt có thể đã dừng timer, khôi phục nhạc nền ngay
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !this.previewingSound) {
          const ctx = this.getContext();
          if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
          if (this.currentBgmTrack !== 'off') this.playBgmTrack(this.currentBgmTrack, true);
        }
      });
    }
  }

  private loadSettings(): AudioSettings {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_SETTINGS_KEY);
        if (raw) return { ...DEFAULT_AUDIO_SETTINGS, ...JSON.parse(raw) };
      }
    } catch {}
    return { ...DEFAULT_AUDIO_SETTINGS };
  }

  private saveSettings() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(this.settings));
      }
      this.broadcast?.postMessage({ type: 'SYNC_SETTINGS', settings: this.settings });
    } catch {}
  }

  getSettings(): AudioSettings {
    return { ...this.settings };
  }

  subscribe(fn: (s: AudioSettings) => void): () => void {
    this.subscribers.add(fn);
    fn(this.getSettings());
    return () => this.subscribers.delete(fn);
  }

  private notify() {
    const s = this.getSettings();
    for (const sub of this.subscribers) {
      try {
        sub(s);
      } catch {}
    }
  }

  private applySettingsLocally(newSettings: Partial<AudioSettings>, persist = true) {
    this.settings = { ...this.settings, ...newSettings };
    if (persist) this.saveSettings();
    this.updateGains();
    this.notify();
  }

  setSpeakerAllowed(allowed: boolean) {
    const changed = this.speakerAllowed !== allowed;
    this.speakerAllowed = allowed;
    this.updateGains();
    // Vừa bị tước quyền phát tiếng (mở cửa sổ sân khấu khác): dừng nhạc và giọng đọc ngay
    if (changed && !allowed) {
      this.stopAll();
      this.stageVoiceStopHook?.();
    }
    // Vừa lấy lại quyền phát tiếng (đóng cửa sổ kia): khôi phục nhạc nền ngay theo trạng thái game
    if (changed && allowed && this.lastGameStateArgs) {
      const [phase, remainSec, isMcActive] = this.lastGameStateArgs;
      this.setGameState(phase, remainSec, isMcActive);
    }
  }

  /** Hook để StageView gắn hàm dừng giọng đọc (tránh phụ thuộc vòng) */
  stageVoiceStopHook: (() => void) | null = null;

  setMasterMuted(muted: boolean) {
    this.applySettingsLocally({ masterMuted: muted });
  }

  setMasterVolume(vol: number) {
    this.applySettingsLocally({ masterVolume: Math.max(0, Math.min(1, vol)) });
  }

  setBgmEnabled(enabled: boolean) {
    this.applySettingsLocally({ bgmEnabled: enabled });
  }

  setBgmVolume(vol: number) {
    this.applySettingsLocally({ bgmVolume: Math.max(0, Math.min(1, vol)) });
  }

  setBgmTrack(track: 'auto' | 'lobby' | 'thinking' | 'off') {
    this.applySettingsLocally({ bgmTrack: track });
  }

  setSfxEnabled(enabled: boolean) {
    this.applySettingsLocally({ sfxEnabled: enabled });
  }

  setSfxVolume(vol: number) {
    this.applySettingsLocally({ sfxVolume: Math.max(0, Math.min(1, vol)) });
  }

  setMcEnabled(enabled: boolean) {
    this.applySettingsLocally({ mcEnabled: enabled });
  }

  setMcVolume(vol: number) {
    this.applySettingsLocally({ mcVolume: Math.max(0, Math.min(1, vol)) });
  }

  /** Lấy AudioContext an toàn và khởi tạo chuỗi Master / BGM / SFX GainNodes */
  getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
      if (!this.ctx) {
        const AudioCtxClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtxClass) return null;
        this.ctx = new AudioCtxClass();

        // Chuỗi Master
        this.masterGain = this.ctx.createGain();
        this.masterGain.connect(this.ctx.destination);

        // Chuỗi BGM
        this.bgmGain = this.ctx.createGain();
        this.bgmGain.connect(this.masterGain);

        // Chuỗi SFX
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.connect(this.masterGain);

        this.updateGains();
        this.preloadAudioFiles();
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  /** Tải trước và giải mã 5 file MP3 (Giao lưu, Suy nghĩ, Đếm ngược, Trả lời đúng, Vinh danh) */
  private preloadAudioFiles() {
    for (const key of Object.keys(AUDIO_FILE_URLS) as AudioFileKey[]) {
      void this.loadAudioBuffer(key);
    }
  }

  private loadAudioBuffer(key: AudioFileKey): Promise<AudioBuffer | null> {
    if (this.audioBuffers[key]) return Promise.resolve(this.audioBuffers[key]!);
    if (this.loadingBuffers[key]) return this.loadingBuffers[key]!;
    const ctx = this.getContext();
    if (!ctx || typeof fetch === 'undefined') return Promise.resolve(null);

    const promise = fetch(AUDIO_FILE_URLS[key])
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => {
        this.audioBuffers[key] = buf;
        return buf;
      })
      .catch(() => null);

    this.loadingBuffers[key] = promise;
    return promise;
  }

  async resumeContext(): Promise<void> {
    const ctx = this.getContext();
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {}
    }
  }

  isSuspended(): boolean {
    if (!this.ctx) return true;
    return this.ctx.state === 'suspended';
  }

  /** Cập nhật mức Gain theo các kênh và tính năng ducking (-10 dB khi MC nói) */
  private updateGains() {
    if (!this.ctx || !this.masterGain || !this.bgmGain || !this.sfxGain) return;
    const now = this.ctx.currentTime;

    const masterVal = this.settings.masterMuted ? 0 : this.settings.masterVolume;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
    this.masterGain.gain.linearRampToValueAtTime(masterVal, now + 0.05);

    // BGM Gain: tính cả trạng thái BGM bật/tắt và Ducking khi MC nói (-10 dB = ~0.316x)
    let targetBgm = this.settings.bgmEnabled ? this.settings.bgmVolume : 0;
    if (this.isMcSpeaking) {
      targetBgm *= DUCK_FACTOR;
    }
    this.bgmGain.gain.cancelScheduledValues(now);
    this.bgmGain.gain.setValueAtTime(this.bgmGain.gain.value, now);
    // Khi MC bắt đầu nói: giảm nhạc nhanh (120ms); khi nói xong: tăng nhạc lại mượt (420ms)
    const rampTime = this.isMcSpeaking ? 0.12 : 0.42;
    this.bgmGain.gain.linearRampToValueAtTime(targetBgm, now + rampTime);

    // SFX Gain
    const targetSfx = this.settings.sfxEnabled ? this.settings.sfxVolume : 0;
    this.sfxGain.gain.cancelScheduledValues(now);
    this.sfxGain.gain.setValueAtTime(this.sfxGain.gain.value, now);
    this.sfxGain.gain.linearRampToValueAtTime(targetSfx, now + 0.05);
  }

  /** Khi MC bắt đầu/kết thúc phát biểu: kích hoạt auto-ducking */
  setMcSpeaking(speaking: boolean) {
    if (this.isMcSpeaking === speaking) return;
    this.isMcSpeaking = speaking;
    this.updateGains();
    // Giới hạn an toàn: nếu sau 25 giây không ai gỡ cờ "đang nói" thì tự gỡ,
    // tránh nhạc nền bị ghép nhỏ -10 dB vĩnh viễn khi TTS lỗi mà không phát sự kiện kết thúc.
    if (this.mcDuckGuard) clearTimeout(this.mcDuckGuard);
    if (speaking) {
      this.mcDuckGuard = setTimeout(() => {
        if (this.isMcSpeaking) {
          this.isMcSpeaking = false;
          this.updateGains();
        }
      }, 25_000);
    } else {
      this.mcDuckGuard = null;
    }
  }

  /** Âm lượng thực tế dành cho thẻ Audio của giọng đọc MC */
  getEffectiveMcVolume(): number {
    if (this.settings.masterMuted || !this.settings.mcEnabled) return 0;
    return Math.max(0, Math.min(1, this.settings.masterVolume * this.settings.mcVolume));
  }

  // ==========================================================================
  // NHẠC NỀN (BGM): LOBBY FUNKY & THINKING SUSPENSE
  // ==========================================================================

  /**
   * Cập nhật trạng thái game để tự động chọn bài BGM phù hợp:
   * - STANDBY, NO_SESSION, INVITING, ROUND_BOARD, NO_QUESTIONS, PAUSED: Lobby Funky
   * - OPEN (nhận đáp án): Thinking Suspense
   * - PREPARE, REVEAL, HONOR, ENDED: Tắt BGM để nhường lời MC và SFX
   */
  setGameState(phase: string, remainSec: number | null, isMcActive: boolean) {
    if (!this.speakerAllowed) {
      this.playBgmTrack('off');
      return;
    }
    if (this.previewingSound) return;

    // Ghi nhớ lại để khôi phục sau khi nghe thử (preview) kết thúc
    this.lastGameStateArgs = [phase, remainSec, isMcActive];

    if (phase !== 'OPEN') {
      this.stopCountdownSource();
    }

    if (isMcActive) {
      this.setMcSpeaking(true);
    } else {
      // MC đã nói xong / lời thoại hết hạn mà không có âm thanh: trả nhạc nền về mức bình thường,
      // nếu không nhạc sẽ bị kẹt ở mức ducking -10 dB mãi mãi.
      this.setMcSpeaking(false);
    }

    if (this.settings.bgmTrack !== 'auto') {
      if (this.settings.bgmTrack === 'lobby') this.playBgmTrack('lobby');
      else if (this.settings.bgmTrack === 'thinking') this.playBgmTrack('thinking');
      else this.playBgmTrack('off');
      return;
    }

    // Tự động theo trạng thái game
    if (['STANDBY', 'NO_SESSION', 'INVITING', 'ROUND_BOARD', 'NO_QUESTIONS', 'PAUSED'].includes(phase)) {
      this.playBgmTrack('lobby');
    } else if (phase === 'OPEN') {
      // Khi còn > 5s trong pha OPEN: phát nhạc suy nghĩ; 5s cuối chỉ giữ đếm ngược dồn dập
      if (remainSec === null || remainSec > 5) {
        this.playBgmTrack('thinking');
      } else {
        this.playBgmTrack('off');
      }
    } else {
      this.playBgmTrack('off');
    }
  }

  /** Phát bài BGM duy nhất mà không giật hoặc khởi động lại nếu đang phát bài đó */
  playBgmTrack(track: BgmType, force = false) {
    if (!force && !this.speakerAllowed) {
      this.stopBgmLoop();
      return;
    }
    if (this.currentBgmTrack === track && !force) return;
    this.stopBgmLoop();
    this.currentBgmTrack = track;
    this.bgmStep = 0;

    if (track === 'off') return;

    const ctx = this.getContext();
    if (!ctx || !this.bgmGain) return;

    const runToken = ++this.bgmRunToken;
    const startBufferLoop = (buf: AudioBuffer) => {
      if (this.bgmRunToken !== runToken || this.currentBgmTrack !== track || !this.bgmGain) return;
      try {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.connect(this.bgmGain);
        src.start(0);
        this.activeBgmSource = src;
      } catch {}
    };

    const cached = this.audioBuffers[track];
    if (cached) {
      startBufferLoop(cached);
      return;
    }

    void this.loadAudioBuffer(track).then((buf) => {
      if (this.bgmRunToken !== runToken || this.currentBgmTrack !== track) return;
      if (buf) {
        startBufferLoop(buf);
      } else {
        this.startSynthesizedBgmFallback(track, ctx);
      }
    });
  }

  /** Dự phòng tổng hợp bằng Web Audio nếu file MP3 nhạc nền bị thiếu hoặc lỗi tải */
  private startSynthesizedBgmFallback(track: 'lobby' | 'thinking', ctx: AudioContext) {
    const scheduleAheadSec = 0.12;
    const tickMs = 40;

    const schedulerFor = (stepDur: number, composeStep: (step: number, tSec: number) => void) => {
      this.bgmNextNoteTime = ctx.currentTime + 0.06;
      this.bgmLoopTimer = setInterval(() => {
        if (this.currentBgmTrack === 'off') return;
        if (!this.settings.bgmEnabled || !this.speakerAllowed) {
          this.bgmNextNoteTime = ctx.currentTime;
          return;
        }
        if (this.bgmNextNoteTime < ctx.currentTime - 0.3) {
          this.bgmNextNoteTime = ctx.currentTime + 0.02;
        }
        while (this.bgmNextNoteTime < ctx.currentTime + scheduleAheadSec) {
          const step = this.bgmStep % 16;
          composeStep(step, this.bgmNextNoteTime);
          this.bgmStep++;
          this.bgmNextNoteTime += stepDur;
        }
      }, tickMs);
    };

    if (track === 'lobby') {
      const stepDur = 60 / 108 / 4;
      this.bgmStepDur = stepDur;
      schedulerFor(stepDur, (step, t) => this.composeLobbyStep(step, t));
    } else if (track === 'thinking') {
      const stepDur = 60 / 75;
      this.bgmStepDur = stepDur;
      schedulerFor(stepDur, (step, t) => this.composeThinkingStep(step, t));
    }
  }

  private stopBgmLoop() {
    this.bgmRunToken++;
    if (this.activeBgmSource) {
      try {
        this.activeBgmSource.stop();
        this.activeBgmSource.disconnect();
      } catch {}
      this.activeBgmSource = null;
    }
    if (this.bgmLoopTimer) {
      clearInterval(this.bgmLoopTimer);
      this.bgmLoopTimer = null;
    }
    // Dứt điểm các nốt đã đặt lịch để không văng tiếng lẻ sau khi đổi/tắt bài
    const ctx = this.ctx;
    if (ctx) {
      for (const osc of this.activeBgmOscs) {
        try {
          osc.stop(ctx.currentTime + 0.05);
        } catch {}
      }
    }
    this.activeBgmOscs.clear();
    this.currentBgmTrack = 'off';
  }

  /**
   * Nhạc giao lưu (Lobby): Rhythmic Funky Electronic Lounge.
   * Vui tươi, tràn đầy năng lượng gameshow, bassline nảy, hợp âm Rhodes và bộ gõ sắc nét.
   */
  private composeLobbyStep(step: number, tSec: number) {
    // 1. Funky Bassline (Triangle osc + lowpass filter)
    const bassNotes: Record<number, number> = {
      0: 65.41,  // C2
      3: 65.41,  // C2
      6: 77.78,  // Eb2
      8: 87.31,  // F2
      10: 87.31, // F2
      11: 98.0,  // G2
      14: 116.54 // Bb2
    };
    if (bassNotes[step]) {
      this.playBgmTone(bassNotes[step], 180, 'triangle', 0.35, 750, tSec);
    }

    // 2. Chords Stabs (Cm7 / Fm7 warm Rhodes stabs)
    if (step === 4) {
      // Cm7 (Eb4, G4, Bb4)
      this.playBgmTone(311.13, 220, 'sine', 0.26, 2200, tSec);
      this.playBgmTone(392.0, 220, 'triangle', 0.24, 2200, tSec);
      this.playBgmTone(466.16, 220, 'triangle', 0.24, 2200, tSec);
    } else if (step === 7) {
      // Anticipation stab
      this.playBgmTone(349.23, 140, 'sine', 0.22, 2200, tSec);
      this.playBgmTone(415.3, 140, 'triangle', 0.20, 2200, tSec);
    } else if (step === 12) {
      // Fm7 (F4, Ab4, C5)
      this.playBgmTone(349.23, 240, 'sine', 0.26, 2200, tSec);
      this.playBgmTone(415.3, 240, 'triangle', 0.24, 2200, tSec);
      this.playBgmTone(523.25, 240, 'triangle', 0.24, 2200, tSec);
    }

    // 3. Shaker / Hi-hat pulse on odd 16th steps
    if (step % 2 === 1) {
      this.playBgmTone(2800, 24, 'sine', 0.16, 5000, tSec);
    }
    // Light punch kick on beat 1 & 3
    if (step === 0 || step === 8) {
      this.playBgmTone(120, 80, 'sine', 0.32, 400, tSec);
    }
  }

  /**
   * Nhạc suy nghĩ (Thinking): Suspense Tension Pulse.
   * Hồi hộp nhẹ, ít giai điệu gây phân tâm, tiếng đập nhịp tim ấm và đồng hồ trường quay.
   */
  private composeThinkingStep(step: number, tSec: number) {
    const beat = step % 4;

    // 1. Warm Sub Drone on beat 0 (D2 / 73.4 Hz + D3 / 146.8 Hz)
    if (beat === 0) {
      this.playBgmTone(73.42, 750, 'sine', 0.30, 350, tSec);
      this.playBgmTone(146.83, 650, 'triangle', 0.18, 450, tSec);
    }

    // 2. Suspenseful fifths interval
    if (beat === 2) {
      this.playBgmTone(196.0, 700, 'sine', 0.22, 500, tSec); // G3
      this.playBgmTone(293.66, 700, 'triangle', 0.18, 500, tSec); // D4
    }

    // 3. Studio clock tick on every beat
    this.playBgmTone(1200, 25, 'triangle', 0.22, 3500, tSec);
  }

  private playBgmTone(
    freq: number,
    durationMs: number,
    type: OscillatorType,
    gainVal: number,
    filterFreq?: number,
    startAtSec?: number,
  ) {
    const ctx = this.getContext();
    if (!ctx || !this.bgmGain) return;
    try {
      const now = startAtSec ?? ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(gainVal, now);
      gain.gain.setValueAtTime(gainVal * 0.75, now + (durationMs * 0.5) / 1000);
      gain.gain.linearRampToValueAtTime(0.001, now + durationMs / 1000);

      if (filterFreq) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(filterFreq, now);
        osc.connect(filter);
        filter.connect(gain);
      } else {
        osc.connect(gain);
      }

      gain.connect(this.bgmGain);
      osc.start(now);
      osc.stop(now + durationMs / 1000);
      this.trackBgmOsc(osc, now + durationMs / 1000);
    } catch {}
  }

  /** Theo dõi nốt BGM đang kéo dài để có thể dừng gọn khi đổi bài/tắt nhạc */
  private trackBgmOsc(osc: OscillatorNode, endAtSec: number) {
    this.activeBgmOscs.add(osc);
    osc.addEventListener('ended', () => {
      this.activeBgmOscs.delete(osc);
    });
    // Dọn rác đề phòng: sự kiện 'ended' đôi khi không bắn khi stop() bị chồng
    const leftoverMs = Math.max(50, (endAtSec - (this.ctx?.currentTime ?? 0)) * 1000 + 300);
    setTimeout(() => this.activeBgmOscs.delete(osc), leftoverMs);
  }

  // ==========================================================================
  // HIỆU ỨNG ÂM THANH (SFX): TẬP TRUNG, RÕ NÉT, KHÔNG CHỒNG ÂM
  // ==========================================================================

  playSfxTone(freq: number, durationMs: number, type: OscillatorType = 'sine', gainVal = 0.35, delayMs = 0) {
    const ctx = this.getContext();
    if (!ctx || !this.sfxGain || !this.settings.sfxEnabled) return;
    try {
      const startAt = ctx.currentTime + Math.max(0, delayMs / 1000);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, startAt);

      gain.gain.setValueAtTime(gainVal, startAt);
      gain.gain.setValueAtTime(gainVal * 0.8, startAt + (durationMs * 0.4) / 1000);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + durationMs / 1000);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(startAt);
      osc.stop(startAt + durationMs / 1000);
    } catch {}
  }

  /**
   * Phát hiệu ứng âm thanh theo sự kiện thực tế của game:
   * - 'countdown': đếm ngược 10..1s
   * - 'correct': trả lời đúng
   * - 'wrong': trả lời sai
   * - 'seat': lên ghế nóng
   * - 'honor': vinh danh
   */
  playSfx(kind: SfxKind, param?: number, force = false) {
    if (!force && (!this.settings.sfxEnabled || !this.speakerAllowed)) return;

    // Chống phát dày đặc lặp lại trong 250ms (ngoại trừ countdown theo giây)
    const now = Date.now();
    if (!force && kind !== 'countdown' && this.lastSfxTime[kind] && now - this.lastSfxTime[kind] < 250) {
      return;
    }
    this.lastSfxTime[kind] = now;

    switch (kind) {
      case 'countdown':
        this.playCountdownSfx(param ?? 5);
        break;
      case 'correct':
        this.playCorrectSfx();
        break;
      case 'wrong':
        this.playWrongSfx();
        break;
      case 'seat':
        this.playSeatSfx();
        break;
      case 'honor':
        this.playHonorFanfare();
        break;
    }
  }

  private stopCountdownSource() {
    if (this.activeCountdownSource) {
      try {
        this.activeCountdownSource.stop();
        this.activeCountdownSource.disconnect();
      } catch {}
      this.activeCountdownSource = null;
    }
  }

  private stopActiveSfxSources() {
    this.stopCountdownSource();
    for (const src of this.activeSfxSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {}
    }
    this.activeSfxSources.clear();
  }

  private playBufferSfx(
    key: 'correct' | 'honor' | 'countdown',
    fallback: () => void,
    offsetSec = 0,
    durationSec?: number,
    isCountdown = false,
  ) {
    const ctx = this.getContext();
    if (!ctx || !this.sfxGain) return;

    const startFromBuf = (buf: AudioBuffer) => {
      if (!this.sfxGain) return;
      try {
        if (isCountdown) {
          this.stopCountdownSource();
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.sfxGain);
        const safeOffset = Math.max(0, Math.min(Math.max(0, buf.duration - 0.1), offsetSec));
        if (durationSec !== undefined) {
          src.start(0, safeOffset, Math.max(0.05, Math.min(durationSec, buf.duration - safeOffset)));
        } else {
          src.start(0, safeOffset);
        }
        if (isCountdown) {
          this.activeCountdownSource = src;
          src.onended = () => {
            if (this.activeCountdownSource === src) this.activeCountdownSource = null;
          };
        } else {
          this.activeSfxSources.add(src);
          src.onended = () => {
            this.activeSfxSources.delete(src);
          };
        }
      } catch {
        fallback();
      }
    };

    const cached = this.audioBuffers[key];
    if (cached) {
      startFromBuf(cached);
      return;
    }
    void this.loadAudioBuffer(key).then((buf) => {
      if (buf) startFromBuf(buf);
      else fallback();
    });
  }

  /** Đếm ngược 10..1s (dùng file Điếm ngược.mp3 khớp mốc 30 - remainSec, dự phòng nốt tổng hợp) */
  private playCountdownSfx(remainSec: number) {
    if (remainSec < 1 || remainSec > 10) return;
    const offsetSec = Math.max(0, 30 - remainSec);
    // Ở giây cuối (1s) phát luôn chuông kết thúc ở mốc 30s của file (~2.3s); các giây khác phát đúng 1.05s
    const durSec = remainSec <= 1 ? 2.35 : 1.05;
    this.playBufferSfx(
      'countdown',
      () => {
        if (remainSec <= 1) {
          this.playSfxTone(1046.5, 120, 'triangle', 0.50);
          this.playSfxTone(1318.5, 180, 'triangle', 0.52, 90);
        } else if (remainSec <= 5) {
          this.playSfxTone(987.77, 95, 'triangle', 0.42);
          this.playSfxTone(1174.66, 85, 'sine', 0.38, 70);
        } else {
          this.playSfxTone(783.99, 85, 'triangle', 0.35);
        }
      },
      offsetSec,
      durSec,
      true,
    );
  }

  /** Hiệu ứng Trả lời đúng (dùng file Trả lời đúng.mp3, dự phòng arpeggio) */
  private playCorrectSfx() {
    this.playBufferSfx('correct', () => {
      this.playSfxTone(523.25, 200, 'triangle', 0.40, 0);
      this.playSfxTone(659.25, 200, 'triangle', 0.42, 75);
      this.playSfxTone(783.99, 220, 'triangle', 0.44, 150);
      this.playSfxTone(1046.5, 450, 'triangle', 0.52, 225);
      this.playSfxTone(1318.5, 420, 'sine', 0.35, 235);
    });
  }

  /** Hiệu ứng Trả lời sai / Rớt ghế (Soft gameshow buzzer) */
  private playWrongSfx() {
    // 2 nốt trầm gameshow tụt dốc rõ ràng, không gây chói tai
    this.playSfxTone(233.08, 250, 'sawtooth', 0.38, 0);
    this.playSfxTone(220.0, 250, 'sawtooth', 0.35, 0);
    this.playSfxTone(164.81, 380, 'triangle', 0.42, 160);
  }

  /** Hiệu ứng Lên ghế nóng / Thay người (Seat climb whoosh & chime) */
  private playSeatSfx() {
    // Tiếng lướt nhẹ lên ghế + chuông pha lê
    this.playSfxTone(330.0, 140, 'triangle', 0.38, 0);
    this.playSfxTone(440.0, 150, 'triangle', 0.40, 60);
    this.playSfxTone(659.25, 260, 'triangle', 0.44, 120);
    this.playSfxTone(1174.66, 320, 'sine', 0.32, 130);
  }

  /** Hiệu ứng Vinh danh ghế nóng (dùng file Vinh Danh.mp3, dự phòng fanfare) */
  private playHonorFanfare() {
    this.playBufferSfx('honor', () => {
      this.playSfxTone(392.0, 140, 'triangle', 0.44, 0);
      this.playSfxTone(523.25, 140, 'triangle', 0.46, 100);
      this.playSfxTone(659.25, 150, 'triangle', 0.48, 200);
      this.playSfxTone(783.99, 170, 'triangle', 0.52, 300);

      this.playSfxTone(523.25, 1400, 'triangle', 0.50, 420);
      this.playSfxTone(783.99, 1400, 'triangle', 0.48, 420);
      this.playSfxTone(1046.5, 1400, 'triangle', 0.58, 420);
      this.playSfxTone(1318.5, 1100, 'sine', 0.38, 430);
    });
  }

  /**
   * Phát 1 hiệu ứng công bố duy nhất cho cả 5 ghế ở pha REVEAL:
   * "Với kết quả của 5 ghế, dùng một hiệu ứng công bố chung; không chồng 5 âm thanh."
   */
  handleRevealPhase(phaseKey: string, hasAnyCorrect: boolean) {
    if (!this.speakerAllowed) return;
    if (this.lastRevealPhaseKey === phaseKey) return;
    this.lastRevealPhaseKey = phaseKey;
    if (hasAnyCorrect) {
      this.playSfx('correct');
    } else {
      this.playSfx('wrong');
    }
  }

  // ==========================================================================
  // NGHE THỬ DÀNH CHO BẢNG ĐIỀU KHIỂN (OPERATOR PREVIEW)
  // ==========================================================================

  previewSound(sound: 'lobby' | 'thinking' | 'countdown' | 'correct' | 'wrong' | 'seat' | 'honor') {
    void this.resumeContext();
    this.stopPreview();
    this.previewingSound = sound;

    if (sound === 'lobby') {
      this.playBgmTrack('lobby', true);
      this.previewTimer = setTimeout(() => this.stopPreview(), 8000);
    } else if (sound === 'thinking') {
      this.playBgmTrack('thinking', true);
      this.previewTimer = setTimeout(() => this.stopPreview(), 8000);
    } else if (sound === 'countdown') {
      // Nghe thử 5 giây cuối + tiếng chuông hết giờ của Điếm ngược.mp3 (~6.5s)
      this.playBufferSfx('countdown', () => this.playCountdownSfx(5), 25, 6.5, true);
      this.previewTimer = setTimeout(() => this.stopPreview(), 6600);
    } else {
      this.playSfx(sound as SfxKind, undefined, true);
      const durMs = sound === 'honor' ? 5300 : sound === 'correct' ? 4200 : 2000;
      this.previewTimer = setTimeout(() => this.stopPreview(), durMs);
    }
  }

  stopPreview() {
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    const wasBgmPreview = this.previewingSound === 'lobby' || this.previewingSound === 'thinking';
    this.previewingSound = null;
    this.stopActiveSfxSources();
    if (wasBgmPreview) {
      this.stopBgmLoop();
      // Khôi phục ngay nhạc nền theo trạng thái game đang dừng (không đợi đồng bộ kế tiếp)
      if (this.speakerAllowed && this.lastGameStateArgs) {
        const [phase, remainSec, isMcActive] = this.lastGameStateArgs;
        this.setGameState(phase, remainSec, isMcActive);
      }
    }
  }

  getPreviewingSound(): string | null {
    return this.previewingSound;
  }

  stopAll() {
    this.stopPreview();
    this.stopActiveSfxSources();
    this.stopBgmLoop();
  }
}

export const audioManager = new StageAudioManager();
audioManager.stageVoiceStopHook = () => stageVoice.stop();

// ============================================================================
// HÀNG ĐỢI GIỌNG ĐỌC TIẾNG VIỆT MC (TTS)
// ============================================================================

const MC_SEEN_STORAGE_KEY = 'gn_last_mc_id';

class StageVoice {
  enabled = false;
  rate = 1.05;
  private lastMcId = 0;
  private current: HTMLAudioElement | null = null;
  private guardTimer: ReturnType<typeof setTimeout> | null = null;
  onSpeakingChange?: (speaking: boolean) => void;

  constructor() {
    try {
      const saved = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(MC_SEEN_STORAGE_KEY) : null;
      if (saved) this.lastMcId = Number(saved) || 0;
    } catch {}
  }

  /** Đánh dấu lời thoại MC đã qua để không phát lại lời chào/vinh danh cũ khi F5 */
  markSeen(mcId?: number | null) {
    if (!mcId || mcId <= this.lastMcId) return;
    this.lastMcId = mcId;
    try {
      sessionStorage.setItem(MC_SEEN_STORAGE_KEY, String(mcId));
    } catch {}
  }

  speakMcLine(mc: { id: number; text: string } | null, allowAudio: boolean) {
    if (!mc || mc.id <= this.lastMcId) return;
    this.markSeen(mc.id);
    if (!allowAudio || !this.enabled || !mc.text.trim()) return;
    this.playUrl(`/api/tts?rate=${this.rate}&text=${encodeURIComponent(mc.text.trim())}`);
  }

  private playUrl(url: string) {
    this.stop();
    try {
      const audio = new Audio(url);
      audio.volume = audioManager.getEffectiveMcVolume();
      this.current = audio;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        if (this.guardTimer) clearTimeout(this.guardTimer);
        this.guardTimer = null;
        this.onSpeakingChange?.(false);
        audioManager.setMcSpeaking(false);
        try {
          audio.pause();
          audio.removeAttribute('src');
        } catch {}
        if (this.current === audio) this.current = null;
      };

      // Đánh dấu "đang nói" ngay khi bắt đầu tải để ducking có hiệu lực từ sớm;
      // nếu TTS không bao giờ phát được (lỗi mạng, 503...), guard 6s sẽ tự gỡ cờ qua done()
      this.onSpeakingChange?.(true);
      audioManager.setMcSpeaking(true);

      // Giới hạn tối đa 6 giây chờ tải, tránh kẹt hàng đợi
      this.guardTimer = setTimeout(done, 6_000);
      audio.onplaying = () => {
        if (finished) return;
        this.onSpeakingChange?.(true);
        audioManager.setMcSpeaking(true);
        if (this.guardTimer) clearTimeout(this.guardTimer);
        const durMs = Number.isFinite(audio.duration) ? audio.duration * 1000 + 2000 : 12_000;
        this.guardTimer = setTimeout(done, durMs);
      };
      audio.onended = done;
      audio.onerror = done;
      audio.play().catch(done);
    } catch {
      this.onSpeakingChange?.(false);
      audioManager.setMcSpeaking(false);
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
    audioManager.setMcSpeaking(false);
  }
}

export const stageVoice = new StageVoice();

// ============================================================================
// LỚP TƯƠNG THÍCH NGƯỢC CHO SFX CŨ
// ============================================================================

class LegacyStageSfx {
  enabled = true;
  lastCountdownTickSec: number | null = null;

  tone(freq: number, durationMs: number, type: OscillatorType = 'sine', gainVal = 0.08) {
    audioManager.playSfxTone(freq, durationMs, type, gainVal);
  }

  playPhase(phase: string) {
    if (phase === 'OPEN') {
      audioManager.playSfxTone(523.25, 140, 'triangle', 0.09);
      setTimeout(() => audioManager.playSfxTone(659.25, 180, 'triangle', 0.09), 120);
    } else if (phase === 'HONOR') {
      audioManager.playSfx('honor');
    }
  }

  playCountdownTick(remainSec: number) {
    if (remainSec < 1 || remainSec > 10) return;
    this.lastCountdownTickSec = remainSec;
    audioManager.playSfx('countdown', remainSec);
  }

  updateThinkingBgm(active: boolean, ducked: boolean) {
    audioManager.setMcSpeaking(ducked);
    if (active) {
      audioManager.playBgmTrack('thinking');
    }
  }
}

export const stageSfx = new LegacyStageSfx();
