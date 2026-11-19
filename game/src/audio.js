// Synthesized sound for Solmaris Heat v2: no audio files, everything is
// WebAudio oscillators and filtered noise, so the game stays offline.
// Engine hum follows driving speed, a two-tone siren fades in with police,
// horns honk in traffic — and the car radio runs a tiny step sequencer
// with three generated stations: Solmaris Funk (bass + hats groove),
// Neon Coast FM (synthwave arp) and KSOL Talk (blip chatter over static).
// R or [ ] changes station while driving.

export const STATIONS = [
  { id: 0, name: 'RADIO OFF' },
  { id: 1, name: 'SOLMARIS FUNK 98.1' },
  { id: 2, name: 'NEON COAST FM' },
  { id: 3, name: 'KSOL TALK 640' },
];

export class SoundFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenFlip = 0;
    this.radioGain = null;
    this.radioStep = 0;
    this.radioTimer = 0;
    this.station = 0;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.radioGain = this.ctx.createGain();
    this.radioGain.gain.value = 0;
    this.radioGain.connect(this.master);
    this.startAmbient();
    this.startEngine();
    this.startSiren();
  }
  startAmbient() {
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
  setStation(n) {
    this.station = ((n % STATIONS.length) + STATIONS.length) % STATIONS.length;
    this.radioStep = 0;
    this.radioTimer = 0;
    return STATIONS[this.station];
  }
  cycleStation(dir) { return this.setStation(this.station + (dir || 1)); }

  // --- radio sequencer: 8th-note steps at ~112 BPM, per-station patterns
  radioNote(freq, dur, type, vol, when, dest) {
    const t = when;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain); gain.connect(dest || this.radioGain);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
  radioHat(when, vol) {
    const t = when;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * 0.04));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass'; filter.frequency.value = 6000;
    const gain = this.ctx.createGain(); gain.gain.value = vol;
    src.connect(filter); filter.connect(gain); gain.connect(this.radioGain);
    src.start(t);
  }
  updateRadio(dt, driving) {
    if (!this.ctx || this.muted) return;
    const target = driving && this.station > 0 ? 0.16 : 0.0;
    this.radioGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.15);
    if (!driving || this.station === 0) return;
    this.radioTimer -= dt;
    if (this.radioTimer > 0) return;
    const stepDur = 60 / 112 / 2;
    this.radioTimer = stepDur;
    const t = this.ctx.currentTime + 0.02;
    const s = this.radioStep % 32;
    this.radioStep++;
    if (this.station === 1) {
      // FUNK: octave bass groove in A, hats on off-beats, clav-ish stabs
      const bass = [55, 0, 55, 0, 65.4, 0, 55, 0, 49, 0, 49, 0, 55, 0, 82.4, 0, 55, 0, 55, 0, 65.4, 0, 55, 0, 73.4, 0, 65.4, 0, 61.7, 0, 55, 0];
      if (bass[s]) this.radioNote(bass[s] * 2, 0.16, 'square', 0.5, t);
      if (s % 2 === 1) this.radioHat(t, 0.20);
      if (s % 8 === 4) this.radioNote(220, 0.09, 'sawtooth', 0.16, t);
      if (s % 16 === 14) this.radioNote(330, 0.09, 'sawtooth', 0.14, t);
    } else if (this.station === 2) {
      // SYNTHWAVE: minor arp ladder + a low pad pulse on the bar
      const arp = [110, 131.9, 164.8, 220, 164.8, 131.9, 110, 131.9, 98, 123.5, 146.8, 196, 146.8, 123.5, 98, 123.5,
                   110, 131.9, 164.8, 220, 164.8, 131.9, 110, 131.9, 87.3, 110, 131.9, 174.6, 131.9, 110, 87.3, 110];
      this.radioNote(arp[s] * 2, 0.14, 'sawtooth', 0.16, t);
      if (s % 16 === 0) this.radioNote(arp[s], 0.9, 'triangle', 0.3, t);
      if (s % 4 === 2) this.radioHat(t, 0.10);
    } else if (this.station === 3) {
      // TALK: bursts of formant-ish blips over a faint static bed
      if (s % 8 === 0) this.radioHat(t, 0.05);
      const talk = [0, 320, 0, 410, 360, 0, 0, 290, 0, 380, 0, 340, 300, 0, 430, 0, 0, 310, 350, 0, 0, 270, 0, 390, 330, 0, 0, 300, 0, 360, 0, 0];
      if (talk[s]) this.radioNote(talk[s], 0.1, 'triangle', 0.22, t);
      if (s === 24) this.radioNote(880, 0.12, 'sine', 0.12, t);   // station ident beep
    }
  }
  update(dt, speedRatio, driving, sirenLevel) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    if (this.engineGain) {
      const target = driving ? 0.05 + Math.abs(speedRatio) * 0.06 : 0.0;
      this.engineGain.gain.setTargetAtTime(target, t, 0.08);
      this.engineOsc.frequency.setTargetAtTime(55 + Math.abs(speedRatio) * 135, t, 0.08);
    }
    if (this.sirenGain) {
      this.sirenFlip += dt;
      const freq = this.sirenFlip % 0.9 < 0.45 ? 660 : 880;
      this.sirenOsc.frequency.setTargetAtTime(freq, t, 0.03);
      this.sirenGain.gain.setTargetAtTime(sirenLevel * 0.028, t, 0.2);
    }
    this.updateRadio(dt, driving);
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
  honk() { this.blip(370, 0.16, 'square', 0.07); setTimeout(() => { /* second tone */ }, 0); this.blip(466, 0.16, 'square', 0.05); }
  scrape() { this.noiseBurst(0.2, 0.22, 2400); }
  explosion() { this.noiseBurst(0.7, 0.6, 140); this.blip(70, 0.55, 'sine', 0.4, 34); }
  gunshot() { this.noiseBurst(0.16, 0.5, 1600); this.blip(160, 0.1, 'sawtooth', 0.2, 50); }
  dryClick() { this.blip(1350, 0.035, 'square', 0.09); this.noiseBurst(0.03, 0.10, 2600); }
  door() { this.blip(220, 0.07, 'square', 0.08); this.noiseBurst(0.05, 0.1, 500); }
  spray() { this.noiseBurst(0.5, 0.18, 3200); }
  success() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.16, 'triangle', 0.14), i * 95)); }
  fail() { [392, 330, 262].forEach((f, i) => setTimeout(() => this.blip(f, 0.2, 'triangle', 0.13), i * 130)); }
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }
}
