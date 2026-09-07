// Web Audio API ile sıfır harici dosya bağımlılığıyla üretilen hafif ve tatmin edici ses efektleri
class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled: boolean = true;

  constructor() {
    // Ses tercihi local storage / store'dan okunabilir
    const saved = localStorage.getItem("ocr_sound_effects");
    if (saved !== null) {
      this.enabled = saved === "true";
    }
  }

  public setEnabled(val: boolean) {
    this.enabled = val;
    localStorage.setItem("ocr_sound_effects", String(val));
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  private getContext(): AudioContext | null {
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * Ekran kırpma / yakalama deklanşör sesi
   */
  public playShutter() {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    // 1. Tık sesi (Kısa frekans darbesi)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.04);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.05);

    // 2. İkinci kilitlenme sesi (shutter snap)
    setTimeout(() => {
      if (!ctx || ctx.state === "closed") return;
      const t = ctx.currentTime;
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();

      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(1200, t);
      osc2.frequency.exponentialRampToValueAtTime(300, t + 0.06);

      gain2.gain.setValueAtTime(0.25, t);
      gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);

      osc2.start(t);
      osc2.stop(t + 0.07);
    }, 45);
  }

  /**
   * Metin kopyalandığında veya işlem tamamlandığında çalan hafif tatlı bildirim tonu
   */
  public playSuccess() {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 akoru

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + i * 0.04);

      gain.gain.setValueAtTime(0.12, now + i * 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.04 + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + i * 0.04);
      osc.stop(now + i * 0.04 + 0.2);
    });
  }

  /**
   * Kırpmaya başlama anındaki hafif haptik ses
   */
  public playSnipStart() {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.03);

    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.035);
  }

  /**
   * Sayaç / geri sayım veya küçük işlem tık sesi
   */
  public playTick() {
    if (!this.enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(900, now);
    osc.frequency.exponentialRampToValueAtTime(450, now + 0.025);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.03);
  }
}

export const sounds = new SoundManager();
