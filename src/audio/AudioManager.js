// Lightweight procedural ambience + BGM via the Web Audio API — no asset
// files needed. A warm pad drone, looping wind noise, day-time cicada
// shimmer, and a gentle koto-ish pentatonic melody on a lookahead
// scheduler. All created lazily after a user gesture (autoplay policy).
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.muted = false;
    this.volume = 0.5;
    this._nextNoteTime = 0;
    this._timer = null;
    this._scale = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25]; // A pentatonic-ish
  }

  // Call from a user gesture (click / pointer lock).
  async start() {
    if (this.enabled) {
      if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      await this.ctx.resume();
      this._build();
      this.enabled = true;
      this._scheduleLoop();
    } catch (e) {
      console.warn('Audio init failed:', e);
    }
  }

  _build() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    // gentle master lowpass (muffled when indoors)
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 16000;
    this.muffle.connect(this.master);
    this.master.connect(ctx.destination);

    // --- warm pad drone (detuned oscillators) ---
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.12;
    this.padGain.connect(this.muffle);
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 600;
    padFilter.connect(this.padGain);
    for (const [f, d] of [[110, -4], [110, 5], [165, 0]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = d;
      o.connect(padFilter);
      o.start();
    }
    // slow breathing LFO on pad volume
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.05;
    lfo.connect(lfoGain);
    lfoGain.connect(this.padGain.gain);
    lfo.start();

    // --- wind (looping filtered noise) ---
    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(2.5);
    noise.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 500;
    windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.06;
    noise.connect(windFilter);
    windFilter.connect(this.windGain);
    this.windGain.connect(this.muffle);
    noise.start();
    // wind gusts
    const wlfo = ctx.createOscillator();
    wlfo.frequency.value = 0.13;
    const wlfoGain = ctx.createGain();
    wlfoGain.gain.value = 0.04;
    wlfo.connect(wlfoGain);
    wlfoGain.connect(this.windGain.gain);
    wlfo.start();

    // --- cicada shimmer (day only) ---
    this.cicadaGain = ctx.createGain();
    this.cicadaGain.gain.value = 0.015;
    this.cicadaGain.connect(this.muffle);
    const cic = ctx.createOscillator();
    cic.type = 'sawtooth';
    cic.frequency.value = 5200;
    const cicAM = ctx.createOscillator();
    cicAM.type = 'square';
    cicAM.frequency.value = 70;
    const cicAMg = ctx.createGain();
    cicAMg.gain.value = 0.012;
    cicAM.connect(cicAMg);
    cicAMg.connect(this.cicadaGain.gain);
    cic.connect(this.cicadaGain);
    cic.start();
    cicAM.start();

    // melody bus
    this.melodyGain = ctx.createGain();
    this.melodyGain.gain.value = 0.0;
    this.melodyGain.connect(this.muffle);
    // fade melody in
    this.melodyGain.gain.setTargetAtTime(0.08, ctx.currentTime, 4);

    this._nextNoteTime = ctx.currentTime + 0.2;
  }

  _noiseBuffer(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // brownish noise — smoother than white
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.0;
    }
    return buf;
  }

  // Lookahead scheduler for the ambient melody.
  _scheduleLoop() {
    const tick = () => {
      if (!this.enabled || !this.ctx) return;
      const ahead = this.ctx.currentTime + 0.3;
      while (this._nextNoteTime < ahead) {
        this._scheduleNote(this._nextNoteTime);
        // sparse, slow phrasing
        const gaps = [0.9, 1.2, 0.6, 1.8, 2.4];
        this._nextNoteTime += gaps[(Math.random() * gaps.length) | 0];
      }
      this._timer = setTimeout(tick, 120);
    };
    tick();
  }

  _scheduleNote(time) {
    if (Math.random() < 0.25) return; // leave some silence
    const ctx = this.ctx;
    const f = this._scale[(Math.random() * this._scale.length) | 0];
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.9, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 1.6); // koto-like decay
    o.connect(g);
    g.connect(this.melodyGain);
    o.start(time);
    o.stop(time + 1.7);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.1);
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setIndoor(indoor) {
    if (!this.enabled) return;
    this.muffle.frequency.setTargetAtTime(indoor ? 1400 : 16000, this.ctx.currentTime, 0.3);
    this.windGain.gain.setTargetAtTime(indoor ? 0.0 : 0.06, this.ctx.currentTime, 0.4);
    this.cicadaGain.gain.setTargetAtTime(indoor ? 0.0 : this._cicadaTarget(), this.ctx.currentTime, 0.4);
  }

  _cicadaTarget() {
    return this._night ? 0.004 : 0.015;
  }

  // t: 0 day → 1 night
  setNight(t) {
    this._night = t > 0.5;
    if (!this.enabled) return;
    this.cicadaGain.gain.setTargetAtTime(this._cicadaTarget(), this.ctx.currentTime, 1.0);
  }

  // Short procedural sound effect, used as the powers' "sound hook".
  // Throttled per-name so continuous powers (held beams) sizzle instead of
  // machine-gunning oscillators.
  sfx(name) {
    if (!this.enabled || this.muted || !this.ctx) return;
    const cfg = SFX[name] || SFX.default;
    const now = this.ctx.currentTime;
    this._sfxLast = this._sfxLast || {};
    if (now - (this._sfxLast[name] || 0) < (cfg.gap || 0.06)) return;
    this._sfxLast[name] = now;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(cfg.vol, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + cfg.dur);
    g.connect(this.muffle || this.master);

    const o = this.ctx.createOscillator();
    o.type = cfg.type;
    o.frequency.setValueAtTime(cfg.f0, now);
    if (cfg.f1) o.frequency.exponentialRampToValueAtTime(cfg.f1, now + cfg.dur);
    o.connect(g);
    o.start(now);
    o.stop(now + cfg.dur + 0.02);
  }

  dispose() {
    if (this._timer) clearTimeout(this._timer);
    this.enabled = false;
    if (this.ctx) this.ctx.close();
    this.ctx = null;
  }
}

// Element-flavoured one-shot blips for the power system.
const SFX = {
  fire: { type: 'sawtooth', f0: 220, f1: 60, dur: 0.35, vol: 0.18, gap: 0.08 },
  water: { type: 'sine', f0: 900, f1: 200, dur: 0.3, vol: 0.16, gap: 0.08 },
  earth: { type: 'square', f0: 90, f1: 45, dur: 0.4, vol: 0.2, gap: 0.1 },
  lightning: { type: 'square', f0: 1800, f1: 300, dur: 0.18, vol: 0.16, gap: 0.05 },
  fry: { type: 'sawtooth', f0: 320, f1: 380, dur: 0.12, vol: 0.08, gap: 0.07 },
  switch: { type: 'triangle', f0: 660, f1: 990, dur: 0.08, vol: 0.1, gap: 0.02 },
  // Wave-5 abilities & sword
  sword: { type: 'sawtooth', f0: 1400, f1: 600, dur: 0.14, vol: 0.13, gap: 0.05 },
  swordheavy: { type: 'sawtooth', f0: 900, f1: 300, dur: 0.26, vol: 0.18, gap: 0.05 },
  swordhit: { type: 'square', f0: 520, f1: 160, dur: 0.12, vol: 0.16, gap: 0.03 },
  parry: { type: 'triangle', f0: 2200, f1: 1400, dur: 0.16, vol: 0.18, gap: 0.04 },
  unsheath: { type: 'triangle', f0: 1800, f1: 900, dur: 0.18, vol: 0.12, gap: 0.05 },
  dash: { type: 'sine', f0: 240, f1: 720, dur: 0.18, vol: 0.14, gap: 0.05 },
  shield: { type: 'sine', f0: 320, f1: 520, dur: 0.22, vol: 0.12, gap: 0.05 },
  shieldbreak: { type: 'square', f0: 400, f1: 90, dur: 0.35, vol: 0.2, gap: 0.05 },
  atomic: { type: 'sawtooth', f0: 140, f1: 30, dur: 0.9, vol: 0.26, gap: 0.2 }, // deep detonation boom
  default: { type: 'triangle', f0: 440, dur: 0.12, vol: 0.12, gap: 0.06 },
};
