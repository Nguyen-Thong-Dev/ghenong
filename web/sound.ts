/**
 * Hệ thống quản lý âm thanh tập trung cho gameshow GHẾ NÓNG:
 * - Nhạc nền (BGM): Nhạc giao lưu (Funky Electronic Lounge) & Nhạc suy nghĩ (Suspense Tension Pulse).
 * - Hiệu ứng (SFX): Đếm ngược (10..1s), Trả lời đúng, Trả lời sai, Lên ghế nóng, Vinh danh.
 * - Giọng đọc MC (TTS): Hàng đợi tự gỡ kẹt qua /api/tts.
 * - Quản lý âm lượng 4 kênh: Tổng (Master), Nhạc nền (BGM), Hiệu ứng (SFX), Giọng MC (Voice).
 * - Auto-ducking: Tự động giảm nhạc nền -10 dB (~0.316x) khi MC nói, tăng lại êm dịu khi nói xong.
 * - Đảm bảo chỉ 1 bài BGM phát tại một thời điểm, chuyển bài mượt, không giật hoặc lặp lại bài cũ.
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

class StageAudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  private settings: AudioSettings;
  private subscribers: Set<(s: AudioSettings) => void> = new Set();
  private broadcast: BroadcastChannel | null = null;

  // Trạng thái vận hành
  private speakerAllowed = true;
  private isMcSpeaking = false;
  private currentBgmTrack: BgmType = 'off';
  private bgmLoopTimer: ReturnType<typeof setInterval> | null = null;
  private bgmStep = 0;
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
    this.speakerAllowed = allowed;
    this.updateGains();
  }

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
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
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

    if (isMcActive) {
      this.setMcSpeaking(true);
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
    if (this.currentBgmTrack === track) return;
    this.stopBgmLoop();
    this.currentBgmTrack = track;
    this.bgmStep = 0;

    if (track === 'off') return;

    const ctx = this.getContext();
    if (!ctx) return;

    if (track === 'lobby') {
      this.startLobbyBgm();
    } else if (track === 'thinking') {
      this.startThinkingBgm();
    }
  }

  private stopBgmLoop() {
    if (this.bgmLoopTimer) {
      clearInterval(this.bgmLoopTimer);
      this.bgmLoopTimer = null;
    }
    this.currentBgmTrack = 'off';
  }

  /**
   * Nhạc giao lưu (Lobby): Rhythmic Funky Electronic Lounge.
   * Vui nhẹ, phong cách gameshow hiện đại, bassline nảy, hợp âm Rhodes nhẹ và bộ gõ shaker.
   */
  private startLobbyBgm() {
    const ctx = this.getContext();
    if (!ctx) return;

    // Tempo: 108 BPM (16th note ~138.8ms)
    const stepMs = 138.8;
    this.bgmLoopTimer = setInterval(() => {
      if (this.currentBgmTrack !== 'lobby' || !this.settings.bgmEnabled) return;
      const step = this.bgmStep % 16;
      this.bgmStep++;

      // 1. Funky Bassline (Triangle osc + lowpass envelope)
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
        this.playBgmTone(bassNotes[step], 140, 'triangle', 0.12, 450);
      }

      // 2. Chords Stabs (Cm7 / Fm7 funky stabs)
      if (step === 4) {
        // Cm7 (Eb4, G4, Bb4)
        this.playBgmTone(311.13, 160, 'sine', 0.04, 1200);
        this.playBgmTone(392.0, 160, 'sine', 0.035, 1200);
        this.playBgmTone(466.16, 160, 'triangle', 0.035, 1200);
      } else if (step === 7) {
        // Anticipation stab
        this.playBgmTone(349.23, 110, 'sine', 0.03, 1200);
        this.playBgmTone(415.3, 110, 'sine', 0.025, 1200);
      } else if (step === 12) {
        // Fm7 (F4, Ab4, C5)
        this.playBgmTone(349.23, 170, 'sine', 0.04, 1200);
        this.playBgmTone(415.3, 170, 'sine', 0.035, 1200);
        this.playBgmTone(523.25, 170, 'triangle', 0.035, 1200);
      }

      // 3. Shaker / Hi-hat pulse on odd 16th steps
      if (step % 2 === 1) {
        this.playBgmTone(3200, 16, 'sine', 0.012, 4000);
      }
      // Light punch on beat 1 & 3
      if (step === 0 || step === 8) {
        this.playBgmTone(95, 55, 'sine', 0.065, 300);
      }
    }, stepMs);
  }

  /**
   * Nhạc suy nghĩ (Thinking): Suspense Tension Pulse.
   * Hồi hộp nhẹ, ít giai điệu gây phân tâm, tiếng đập nhịp tim ấm và đồng hồ tĩnh lặng.
   */
  private startThinkingBgm() {
    const ctx = this.getContext();
    if (!ctx) return;

    // Tempo: 75 BPM (1 beat = 800ms)
    const stepMs = 800;
    this.bgmLoopTimer = setInterval(() => {
      if (this.currentBgmTrack !== 'thinking' || !this.settings.bgmEnabled) return;
      const beat = this.bgmStep % 4;
      this.bgmStep++;

      // 1. Warm Sub Drone on beat 0 (D2 / 73.4 Hz)
      if (beat === 0) {
        this.playBgmTone(73.42, 700, 'sine', 0.05, 250);
        this.playBgmTone(146.83, 600, 'triangle', 0.02, 350);
      }

      // 2. Suspenseful fifths interval
      if (beat === 2) {
        this.playBgmTone(196.0, 650, 'sine', 0.03, 400); // G3
        this.playBgmTone(293.66, 650, 'sine', 0.025, 400); // D4
      }

      // 3. Studio clock tick on every beat
      this.playBgmTone(1150, 18, 'sine', 0.018, 3000);
    }, stepMs);
  }

  private playBgmTone(freq: number, durationMs: number, type: OscillatorType, gainVal: number, filterFreq?: number) {
    const ctx = this.getContext();
    if (!ctx || !this.bgmGain) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(gainVal, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);

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
    } catch {}
  }

  // ==========================================================================
  // HIỆU ỨNG ÂM THANH (SFX): TẬP TRUNG, KHÔNG CHỒNG ÂM
  // ==========================================================================

  playSfxTone(freq: number, durationMs: number, type: OscillatorType = 'sine', gainVal = 0.1, delayMs = 0) {
    const ctx = this.getContext();
    if (!ctx || !this.sfxGain || !this.settings.sfxEnabled) return;
    try {
      const startAt = ctx.currentTime + Math.max(0, delayMs / 1000);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, startAt);

      gain.gain.setValueAtTime(gainVal, startAt);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationMs / 1000);

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

  /** Đếm ngược 10..1s */
  private playCountdownSfx(remainSec: number) {
    if (remainSec < 1 || remainSec > 10) return;
    if (remainSec <= 1) {
      // 1s cuối: âm báo chốt sổ cao độ
      this.playSfxTone(1046.5, 95, 'triangle', 0.12);
      this.playSfxTone(1318.5, 140, 'triangle', 0.13, 90);
    } else if (remainSec <= 5) {
      // 5s -> 2s: nhịp cảnh báo kép dồn dập
      this.playSfxTone(987.77, 75, 'triangle', 0.1);
      this.playSfxTone(1174.66, 65, 'sine', 0.08, 70);
    } else {
      // 10s -> 6s: nhịp tích tắc đồng hồ trường quay rõ ràng
      this.playSfxTone(783.99, 65, 'sine', 0.07);
    }
  }

  /** Hiệu ứng Trả lời đúng (Celebratory chime) */
  private playCorrectSfx() {
    // Chuỗi 4 nốt arpeggio mừng chiến thắng: C5 -> E5 -> G5 -> C6
    this.playSfxTone(523.25, 180, 'triangle', 0.11, 0);
    this.playSfxTone(659.25, 180, 'triangle', 0.11, 75);
    this.playSfxTone(783.99, 200, 'triangle', 0.12, 150);
    this.playSfxTone(1046.5, 360, 'triangle', 0.13, 225);
    this.playSfxTone(1318.5, 320, 'sine', 0.08, 235);
  }

  /** Hiệu ứng Trả lời sai / Rớt ghế (Soft gameshow buzzer) */
  private playWrongSfx() {
    // 2 nốt trầm gameshow tụt dốc nhẹ nhàng, không gây chói tai
    this.playSfxTone(233.08, 220, 'sawtooth', 0.09, 0);
    this.playSfxTone(220.0, 220, 'sawtooth', 0.08, 0);
    this.playSfxTone(164.81, 320, 'triangle', 0.1, 160);
  }

  /** Hiệu ứng Lên ghế nóng / Thay người (Seat climb whoosh & chime) */
  private playSeatSfx() {
    // Tiếng lướt nhẹ lên ghế + chuông pha lê
    this.playSfxTone(330.0, 110, 'triangle', 0.09, 0);
    this.playSfxTone(440.0, 120, 'triangle', 0.09, 60);
    this.playSfxTone(659.25, 220, 'triangle', 0.11, 120);
    this.playSfxTone(1174.66, 260, 'sine', 0.07, 130);
  }

  /** Hiệu ứng Vinh danh ghế nóng (Victory Fanfare) */
  private playHonorFanfare() {
    // Fanfare kèn đồng hoành tráng: G4 -> C5 -> E5 -> G5 -> Hợp âm C6 rực rỡ
    this.playSfxTone(392.0, 120, 'triangle', 0.11, 0);
    this.playSfxTone(523.25, 120, 'triangle', 0.12, 100);
    this.playSfxTone(659.25, 120, 'triangle', 0.12, 200);
    this.playSfxTone(783.99, 140, 'triangle', 0.13, 300);

    // Hợp âm vinh quang C Major
    this.playSfxTone(523.25, 1200, 'triangle', 0.14, 420);
    this.playSfxTone(783.99, 1200, 'triangle', 0.12, 420);
    this.playSfxTone(1046.5, 1200, 'triangle', 0.15, 420);
    this.playSfxTone(1318.5, 900, 'sine', 0.08, 430);
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
      this.previewTimer = setTimeout(() => this.stopPreview(), 6000);
    } else if (sound === 'thinking') {
      this.playBgmTrack('thinking', true);
      this.previewTimer = setTimeout(() => this.stopPreview(), 6000);
    } else if (sound === 'countdown') {
      this.playSfx('countdown', 5, true);
      setTimeout(() => this.playSfx('countdown', 1, true), 700);
      this.previewTimer = setTimeout(() => this.stopPreview(), 1400);
    } else {
      this.playSfx(sound as SfxKind, undefined, true);
      this.previewTimer = setTimeout(() => this.stopPreview(), 2000);
    }
  }

  stopPreview() {
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    if (this.previewingSound === 'lobby' || this.previewingSound === 'thinking') {
      this.stopBgmLoop();
    }
    this.previewingSound = null;
  }

  getPreviewingSound(): string | null {
    return this.previewingSound;
  }

  stopAll() {
    this.stopPreview();
    this.stopBgmLoop();
  }
}

export const audioManager = new StageAudioManager();

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
    } else {
      audioManager.playBgmTrack('off');
    }
  }
}

export const stageSfx = new LegacyStageSfx();
