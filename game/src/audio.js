// Synthesized sound for Solmaris Heat: no audio files, everything is made
// with WebAudio oscillators and filtered noise, so the game stays offline.
// Engine hum follows driving speed, a two-tone siren fades in with police,
// and one-shot blips cover pickups, punches, gunshots and mission jingles.

export class SoundFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenFlip = 0;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.startAmbient();
    this.startEngine();
    this.startSiren();
  }
  startAmbient() {
    // Soft shoreline noise: looped white noise through a slow lowpass.
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.4;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 420;
    const gain = this.ctx.createGain(); gain.gain.value = 0.035;
    src.connect(filter); filter.connect(gain); gain.connect(this.master);
    src.start();
  }
  startEngine() {
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 300;
    this.engineGain = this.ctx.createGain(); this.engineGain.gain.value = 0;
    this.engineOsc.connect(filter); filter.connect(this.engineGain); this.engineGain.connect(this.master);
    this.engineOsc.start();
  }
  startSiren() {
    this.sirenOsc = this.ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 700;
    this.sirenGain = this.ctx.createGain(); this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
    this.sirenOsc.start();
  }
  update(dt, speedRatio, driving, sirenLevel) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    if (this.engineGain) {
      const target = driving ? 0.05 + Math.abs(speedRatio) * 0.06 : 0.0;
      this.engineGain.gain.setTargetAtTime(target, t, 0.08);
      this.engineOsc.frequency.setTargetAtTime(55 + Math.abs(speedRatio) * 130, t, 0.08);
    }
    if (this.sirenGain) {
      this.sirenFlip += dt;
      const freq = this.sirenFlip % 0.9 < 0.45 ? 660 : 880;
      this.sirenOsc.frequency.setTargetAtTime(freq, t, 0.03);
      this.sirenGain.gain.setTargetAtTime(sirenLevel * 0.028, t, 0.2);
    }
  }
  blip(freq, dur, type, vol, slideTo) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(vol || 0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain); gain.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
  noiseBurst(dur, vol, freq) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass'; filter.frequency.value = freq || 900;
    const gain = this.ctx.createGain(); gain.gain.value = vol;
    src.connect(filter); filter.connect(gain); gain.connect(this.master);
    src.start(t);
  }
  pickup() { this.blip(880, 0.09, 'square', 0.10); setTimeout(() => this.blip(1320, 0.12, 'square', 0.10), 55); }
  punch() { this.noiseBurst(0.09, 0.25, 300); }
  crash() { this.noiseBurst(0.28, 0.4, 220); }
  gunshot() { this.noiseBurst(0.16, 0.5, 1600); this.blip(160, 0.1, 'sawtooth', 0.2, 50); }
  door() { this.blip(220, 0.07, 'square', 0.08); this.noiseBurst(0.05, 0.1, 500); }
  success() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.16, 'triangle', 0.14), i * 95)); }
  fail() { [392, 330, 262].forEach((f, i) => setTimeout(() => this.blip(f, 0.2, 'triangle', 0.13), i * 130)); }
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }
}
