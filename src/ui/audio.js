// Klang ohne Dateien: Meer, Wind, Regen, Vögel, Grillen, Donner und eine leise generative Musik.
export class Sound {
  constructor() {
    this.ctx = null;
    try { this.on = localStorage.getItem('biu.sound') !== '0'; } catch { this.on = true; }
    this.nextNote = 0;
    this.nextBird = 0;
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.on ? 0.8 : 0; this.master.connect(ctx.destination);
    // Hall
    this.verb = ctx.createConvolver();
    const len = ctx.sampleRate * 3.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.verb.buffer = ir;
    this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.55;
    this.verb.connect(this.verbGain).connect(this.master);
    // Rauschen
    const nb = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate), nd = nb.getChannelData(0);
    let last = 0;
    for (let i = 0; i < nd.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; nd[i] = last * 3.5; }
    const wb = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate), wd = wb.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    // Meer
    this.sea = ctx.createGain(); this.sea.gain.value = 0.0;
    const seaF = ctx.createBiquadFilter(); seaF.type = 'lowpass'; seaF.frequency.value = 420;
    loop(nb).connect(seaF).connect(this.sea).connect(this.master);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09; const lg = ctx.createGain(); lg.gain.value = 0.18; lfo.connect(lg).connect(this.sea.gain); lfo.start();
    // Wind
    this.wind = ctx.createGain(); this.wind.gain.value = 0;
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 500; this.windF.Q.value = 0.8;
    loop(wb).connect(this.windF).connect(this.wind).connect(this.master);
    const wl = ctx.createOscillator(); wl.frequency.value = 0.13; const wlg = ctx.createGain(); wlg.gain.value = 220; wl.connect(wlg).connect(this.windF.frequency); wl.start();
    // Regen
    this.rain = ctx.createGain(); this.rain.gain.value = 0;
    const rf = ctx.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 1800;
    const rf2 = ctx.createBiquadFilter(); rf2.type = 'lowpass'; rf2.frequency.value = 7000;
    loop(wb).connect(rf).connect(rf2).connect(this.rain).connect(this.master);
    this.noiseBuf = wb;
  }

  setOn(v) {
    this.on = v;
    try { localStorage.setItem('biu.sound', v ? '1' : '0'); } catch { /* egal */ }
    if (this.master) this.master.gain.setTargetAtTime(v ? (this.ducked ? 0.3 : 0.8) : 0, this.ctx.currentTime, 0.3);
  }

  // Leiser, solange die Erzählstimme spricht (src/ui/voice.js)
  duck(v) {
    this.ducked = v;
    if (this.master && this.on) this.master.gain.setTargetAtTime(v ? 0.3 : 0.8, this.ctx.currentTime, v ? 0.15 : 0.6);
  }

  update(wxs, night, season, era) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    this.sea.gain.setTargetAtTime(0.32 + wxs.storm * 0.25, t, 1.5);
    this.wind.gain.setTargetAtTime(0.02 + wxs.storm * 0.22 + wxs.snow * 0.04, t, 1.5);
    this.rain.gain.setTargetAtTime(wxs.rain * 0.16, t, 1.5);
    // Vögel am Tag, Grillen in Sommernächten
    if (t > this.nextBird) {
      this.nextBird = t + 1.5 + Math.random() * 5;
      if (night < 0.4 && wxs.rain < 0.3 && season !== 3) this.chirp();
      else if (night > 0.6 && season === 1) this.cricket();
    }
    // Musik
    if (t > this.nextNote) {
      this.nextNote = t + 2.6 + Math.random() * 4.5;
      const major = [62, 64, 66, 69, 71, 74, 76, 78];
      const minor = [62, 65, 67, 69, 72, 74, 77];
      const scale = night > 0.5 || wxs.gloom > 0.5 ? minor : major;
      const n = scale[Math.floor(Math.random() * scale.length)] - (Math.random() < 0.3 ? 12 : 0);
      this.note(n, 0.045, 5);
      if (Math.random() < 0.25) this.note(scale[0] - 24, 0.03, 9);
    }
  }

  // Flugmotor (seit 18.10.2026, Flugmodus): zwei Sägezähne und ein Rechteck durch einen Tiefpass, Drehzahl nach Gas und
  // Fahrtwind, dazu Fahrtwind als Rauschen, das mit der Geschwindigkeit lauter und heller wird
  engine(on, rpm = 0, load = 0, speed = 0, warn = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (!this.eng && on) {
      const g = ctx.createGain(); g.gain.value = 0;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 1.2;
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
      const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.detune.value = 9;
      const o3 = ctx.createOscillator(); o3.type = 'square';
      const g3 = ctx.createGain(); g3.gain.value = 0.35;
      o1.connect(f); o2.connect(f); o3.connect(g3).connect(f); f.connect(g).connect(this.master);
      o1.start(); o2.start(); o3.start();
      const wg = ctx.createGain(); wg.gain.value = 0;
      const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 700; wf.Q.value = 0.6;
      const ws = ctx.createBufferSource(); ws.buffer = this.noiseBuf; ws.loop = true; ws.start();
      ws.connect(wf).connect(wg).connect(this.master);
      const bg = ctx.createGain(); bg.gain.value = 0;
      const bo = ctx.createOscillator(); bo.type = 'square'; bo.frequency.value = 880; bo.start(); bo.connect(bg).connect(this.master);
      this.eng = { g, f, o1, o2, o3, wg, wf, bg };
    }
    const E = this.eng;
    if (!E) return;
    const base = 34 + rpm * 92;
    E.o1.frequency.setTargetAtTime(base, t, 0.08); E.o2.frequency.setTargetAtTime(base * 1.005, t, 0.08); E.o3.frequency.setTargetAtTime(base * 0.5, t, 0.08);
    E.f.frequency.setTargetAtTime(380 + rpm * 1700 + load * 400, t, 0.1);
    E.g.gain.setTargetAtTime(on && this.on ? 0.035 + rpm * 0.05 : 0, t, 0.15);
    E.wg.gain.setTargetAtTime(on && this.on ? Math.min(0.3, speed / 70 * 0.3) : 0, t, 0.3);
    E.wf.frequency.setTargetAtTime(400 + speed * 18, t, 0.3);
    E.bg.gain.setTargetAtTime(on && this.on && warn && (t * 4 % 1) < 0.5 ? 0.025 : 0, t, 0.02);
  }

  note(midi, vol, dur) {
    const ctx = this.ctx, t = ctx.currentTime;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o2.type = 'triangle'; o.frequency.value = f; o2.frequency.value = f * 2.001;
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o.connect(g); o2.connect(g2).connect(g);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.verb); g.connect(this.master);
    o.start(t); o2.start(t); o.stop(t + dur); o2.stop(t + dur);
  }

  chirp() {
    const ctx = this.ctx, t = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 4), base = 2200 + Math.random() * 1800;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), s = t + i * 0.12;
      o.frequency.setValueAtTime(base, s); o.frequency.exponentialRampToValueAtTime(base * 1.4, s + 0.06);
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.018, s + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.09);
      o.connect(g).connect(this.verb); g.connect(this.master); o.start(s); o.stop(s + 0.1);
    }
  }

  cricket() {
    const ctx = this.ctx, t = ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), s = t + i * 0.07;
      o.frequency.value = 4400; g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.006, s + 0.01); g.gain.linearRampToValueAtTime(0, s + 0.04);
      o.connect(g).connect(this.master); o.start(s); o.stop(s + 0.05);
    }
  }

  thunder(big) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime + (big ? 0 : 0.6 + Math.random());
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = big ? 900 : 300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(big ? 0.9 : 0.4, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + (big ? 3 : 4));
    s.connect(f).connect(g).connect(this.master); g.connect(this.verb);
    s.start(t); s.stop(t + 4.5);
  }

  boom() { this.thunder(true); }

  chime() {
    if (!this.ctx || !this.on) return;
    [74, 78, 81, 86].forEach((m, i) => setTimeout(() => this.note(m, 0.06, 3.5), i * 110));
  }
}
