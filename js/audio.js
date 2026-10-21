// Tiny synth for retro sound effects. No audio files required.
//
// Browsers block audio until a user gesture happens, so Game calls resume()
// on the first keypress/click. Everything is wrapped in try/catch so a
// misbehaving audio stack can never take down the game loop.

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  resume() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) {
          this.enabled = false;
          return;
        }
        this.ctx = new Ctor();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch {
      this.enabled = false;
    }
  }

  /**
   * Play a single enveloped tone.
   * @param {object} opts
   * @param {number} opts.freq      starting frequency in Hz
   * @param {OscillatorType} opts.type waveform
   * @param {number} opts.duration  seconds
   * @param {number} opts.gain      peak volume (0..1)
   * @param {number} opts.sweep     frequency delta applied over the duration
   * @param {number} opts.delay     seconds to wait before playing
   */
  tone({ freq = 440, type = 'square', duration = 0.08, gain = 0.05, sweep = 0, delay = 0 } = {}) {
    if (!this.ctx || !this.enabled) return;
    try {
      const t0 = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (sweep) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq + sweep), t0 + duration);
      }

      // exponential ramps cannot reach exactly zero, so use a tiny floor value.
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

      osc.connect(env).connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.03);
    } catch {
      this.enabled = false;
    }
  }

  shoot() {
    this.tone({ freq: 900, type: 'square', duration: 0.06, gain: 0.03, sweep: -520 });
  }

  jump() {
    this.tone({ freq: 300, type: 'triangle', duration: 0.13, gain: 0.045, sweep: 280 });
  }

  hit() {
    this.tone({ freq: 260, type: 'sawtooth', duration: 0.06, gain: 0.03, sweep: -140 });
  }

  explode() {
    this.tone({ freq: 150, type: 'sawtooth', duration: 0.3, gain: 0.07, sweep: -110 });
    this.tone({ freq: 90, type: 'square', duration: 0.32, gain: 0.045, sweep: -60 });
  }

  hurt() {
    this.tone({ freq: 190, type: 'square', duration: 0.22, gain: 0.06, sweep: -90 });
  }
}
