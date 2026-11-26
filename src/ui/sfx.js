// Mehr Klang (seit 26.11.2026, Naders Auftrag "alles umsetzen"): ein eigener Klang für jede der 19 Kräfte, leise Klicks
// für die Oberfläche, Geräusche der Orte beim Heranzoomen (Stimmen, Schmiede, Hafen), Musik, die mit Epoche und Lage
// mitgeht, und kurze Stimmen der Menschen. Alles ohne Dateien, mit WebAudio erzeugt wie audio.js. Wird als Zusatz an
// die Klasse Sound gehängt (installSfx), audio.js bleibt, wie es ist.
const midi = m => 440 * Math.pow(2, (m - 69) / 12);

export function installSfx(Sound) {
  const P = Sound.prototype;

  // ---------- Bausteine ----------
  P._tone = function (f, t0, dur, vol, o = {}) {
    const ctx = this.ctx, a = ctx.createOscillator(), g = ctx.createGain();
    a.type = o.type || 'sine'; a.frequency.setValueAtTime(f, t0);
    if (o.to) a.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + dur * (o.glide || 1));
    if (o.detune) a.detune.value = o.detune;
    const at = o.attack ?? 0.02;
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(vol, t0 + at); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    a.connect(g); g.connect(this.master); if (o.verb !== false) g.connect(this.verb);
    a.start(t0); a.stop(t0 + dur + 0.05);
  };
  P._noise = function (t0, dur, vol, o = {}) {
    const ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noiseBuf; s.loop = true;
    f.type = o.type || 'lowpass'; f.frequency.setValueAtTime(o.f0 || 800, t0); f.Q.value = o.Q || 0.7;
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1), t0 + dur);
    const at = o.attack ?? dur * 0.25;
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(vol, t0 + at); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g); g.connect(this.master); if (o.verb) g.connect(this.verb);
    s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.05);
  };
  const ok = S => S.ctx && S.on && S.noiseBuf;

  // ---------- Kräfte ----------
  const POWER = {
    regen: (S, t) => { S._noise(t, 2.6, 0.16, { type: 'bandpass', f0: 5200, f1: 2200, Q: 0.5, verb: true }); [79, 76, 72, 69].forEach((m, i) => S._tone(midi(m), t + 0.15 + i * 0.16, 1.2, 0.05, { type: 'triangle' })); },
    sonne: (S, t) => { [60, 64, 67, 72, 76].forEach((m, i) => S._tone(midi(m), t + i * 0.07, 3.2, 0.05, { attack: 0.5 })); S._tone(midi(88), t + 0.5, 2.4, 0.018, { attack: 0.8 }); },
    sturm: (S, t) => { S._noise(t, 3.4, 0.28, { type: 'bandpass', f0: 240, f1: 1500, Q: 1.4, verb: true }); S._noise(t + 0.4, 3, 0.2, { f0: 160, f1: 70 }); S._tone(52, t, 3, 0.07, { type: 'sawtooth', to: 38 }); },
    blitz: (S, t) => { S._noise(t, 0.16, 0.5, { type: 'highpass', f0: 2600, attack: 0.004 }); S._tone(1800, t, 0.25, 0.1, { type: 'square', to: 90, verb: false }); S.thunder(true); },
    schnee: (S, t) => { S._noise(t, 3, 0.07, { type: 'highpass', f0: 6500, verb: true }); [84, 88, 91, 96].forEach((m, i) => S._tone(midi(m), t + i * 0.22, 2.2, 0.03)); },
    nebel: (S, t) => { [50, 53, 57].forEach(m => S._tone(midi(m), t, 4.2, 0.045, { attack: 1.4 })); S._noise(t, 4, 0.05, { f0: 500, f1: 220, verb: true }); },
    regenbogen: (S, t) => { [60, 62, 64, 67, 69, 72, 76].forEach((m, i) => S._tone(midi(m), t + i * 0.11, 2, 0.05, { type: 'triangle' })); S._tone(midi(84), t + 0.8, 2.6, 0.03, { attack: 0.6 }); },
    segen: (S, t) => { [67, 71, 74, 79].forEach((m, i) => { S._tone(midi(m), t + i * 0.05, 4, 0.05); S._tone(midi(m) * 2.76, t + i * 0.05, 1.6, 0.012); }); },
    fische: (S, t) => { for (let i = 0; i < 9; i++) { const f = 380 + Math.random() * 500; S._tone(f, t + i * 0.09 + Math.random() * 0.05, 0.16, 0.05, { to: f * 2.2, verb: false }); } S._noise(t, 1.2, 0.08, { type: 'bandpass', f0: 900, f1: 2400, Q: 2 }); },
    beben: (S, t) => { S._noise(t, 3.2, 0.5, { f0: 110, f1: 55, attack: 0.3 }); S._tone(44, t, 3, 0.2, { type: 'triangle', to: 31, verb: false }); for (let i = 0; i < 6; i++) S._noise(t + 0.3 + i * 0.35 + Math.random() * 0.2, 0.25, 0.14, { type: 'bandpass', f0: 600 + Math.random() * 900, Q: 3, attack: 0.01 }); },
    vulkan: (S, t) => { S._noise(t, 4.5, 0.5, { f0: 90, f1: 420, attack: 1.2, verb: true }); S._tone(36, t, 4.2, 0.18, { type: 'sawtooth', to: 52, verb: false }); S._noise(t + 1.2, 2.6, 0.22, { type: 'bandpass', f0: 1400, f1: 500, Q: 0.8 }); },
    flut: (S, t) => { S._noise(t, 4.2, 0.42, { type: 'bandpass', f0: 2600, f1: 240, Q: 0.6, attack: 1, verb: true }); S._tone(58, t + 0.4, 3.4, 0.09, { to: 41, verb: false }); },
    meteor: (S, t) => { S._tone(2400, t, 1.3, 0.09, { type: 'sawtooth', to: 110, attack: 0.3, verb: false }); S._noise(t, 1.3, 0.14, { type: 'bandpass', f0: 3200, f1: 500, Q: 1.5 }); setTimeout(() => S.boom(), 1250); },
    traum: (S, t) => { [69, 72, 76, 81].forEach((m, i) => { S._tone(midi(m), t + i * 0.3, 3.4, 0.04, { attack: 1.2, detune: -7 }); S._tone(midi(m), t + i * 0.3, 3.4, 0.03, { attack: 1.2, detune: 8 }); }); },
    funke: (S, t) => { [72, 76, 79, 84, 88, 91].forEach((m, i) => S._tone(midi(m), t + i * 0.045, 0.5, 0.05, { type: 'triangle' })); S._noise(t, 0.3, 0.07, { type: 'highpass', f0: 5000, attack: 0.01 }); },
    komet: (S, t) => { S._tone(midi(96), t, 4, 0.03, { to: midi(72), attack: 0.6 }); S._tone(midi(91), t + 0.1, 4, 0.025, { to: midi(67), attack: 0.7 }); S._noise(t, 3.6, 0.05, { type: 'highpass', f0: 7000, f1: 2500, verb: true }); },
    fremde: (S, t) => { [[50, 0], [57, 0], [50, 0.9], [62, 0.9]].forEach(([m, d]) => S._tone(midi(m), t + d, 0.85, 0.05, { type: 'sawtooth', attack: 0.12 })); S._noise(t, 2, 0.05, { type: 'bandpass', f0: 600, Q: 0.5, verb: true }); },
    heilung: (S, t) => { [62, 66, 69, 74, 78].forEach((m, i) => S._tone(midi(m), t + i * 0.2, 2.6, 0.045, { attack: 0.3 })); },
    seuche: (S, t) => { [45, 46, 51].forEach(m => S._tone(midi(m), t, 3.6, 0.05, { type: 'triangle', attack: 0.9 })); S._noise(t + 0.3, 3, 0.05, { type: 'bandpass', f0: 300, f1: 180, Q: 4, verb: true }); },
  };
  P.power = function (id) {
    if (!ok(this)) return;
    const f = POWER[id];
    if (!f) return this.chime();
    f(this, this.ctx.currentTime + 0.02);
  };
  // Kombination zweier Kräfte: heller Doppelklang
  P.combo = function () { if (!ok(this)) return; const t = this.ctx.currentTime + 0.25; [72, 79, 84, 91].forEach((m, i) => this._tone(midi(m), t + i * 0.06, 2.4, 0.045, { type: 'triangle' })); };

  // ---------- Oberfläche ----------
  P.click = function () { if (!ok(this)) return; const t = this.ctx.currentTime; this._tone(1150, t, 0.07, 0.022, { type: 'triangle', to: 820, attack: 0.004, verb: false }); };
  P.openSnd = function () { if (!ok(this)) return; const t = this.ctx.currentTime; this._tone(520, t, 0.16, 0.024, { to: 880, attack: 0.01, verb: false }); };
  P.deny = function () { if (!ok(this)) return; const t = this.ctx.currentTime; this._tone(220, t, 0.18, 0.035, { type: 'triangle', to: 150, verb: false }); };
  P.goal = function () { if (!ok(this)) return; const t = this.ctx.currentTime; [67, 72, 76, 79, 84].forEach((m, i) => this._tone(midi(m), t + i * 0.09, 1.8, 0.05, { type: 'triangle' })); };

  // ---------- Stimmen der Menschen: drei bis fünf Silben, Tonhöhe nach Mensch (Frau höher, Kind am höchsten) ----------
  P.babble = function (seed = 1, kind = 'm') {
    if (!ok(this)) return;
    const ctx = this.ctx; let t = ctx.currentTime + 0.02, s = (seed * 9301 + 49297) % 233280;
    const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    const base = kind === 'k' ? 330 : kind === 'f' ? 215 : 130;
    const n = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const dur = 0.09 + rnd() * 0.1, f0 = base * (0.9 + rnd() * 0.35);
      const o = ctx.createOscillator(), g = ctx.createGain(), bp = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * (0.88 + rnd() * 0.3), t + dur);
      bp.type = 'bandpass'; bp.frequency.value = [700, 1100, 500, 1500, 900][Math.floor(rnd() * 5)]; bp.Q.value = 3.5;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(bp).connect(g).connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
      t += dur + 0.02 + rnd() * 0.05;
    }
  };

  // ---------- Orte: Stimmengewirr, Schmiede, Hafen, je näher die Kamera, desto lauter ----------
  // info: { near 0..1, pop, era, hafen, schmiede, markt, nacht 0..1, krieg }
  P.place = function (info) {
    if (!this.ctx || !this.noiseBuf) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (!this._pl) {
      const g = ctx.createGain(); g.gain.value = 0;
      const mk = (f, Q) => { const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = Q; s.connect(b).connect(g); s.start(0, Math.random()); return b; };
      const a = mk(520, 1.6), b = mk(1150, 2.2);
      // Stimmen schwanken langsam: zwei träge Schwinger auf die Filter
      for (const [flt, hz, amt] of [[a, 0.31, 160], [b, 0.47, 320]]) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = hz; lg.gain.value = amt; l.connect(lg).connect(flt.frequency); l.start(); }
      g.connect(this.master);
      this._pl = { g, next: 0 };
    }
    const L = this._pl, n = Math.max(0, Math.min(1, info.near || 0)) * (this.on ? 1 : 0);
    const crowd = n * Math.min(1, (info.pop || 0) / 160) * (1 - (info.nacht || 0) * 0.85);
    L.g.gain.setTargetAtTime(crowd * 0.085, t, 0.6);
    if (n < 0.25 || !this.on || t < L.next) return;
    L.next = t + 0.5 + Math.random() * 2.2;
    const day = (info.nacht || 0) < 0.5, r = Math.random();
    if (info.krieg && r < 0.5) { this._noise(t, 0.12, 0.05 * n, { type: 'bandpass', f0: 2400 + Math.random() * 1500, Q: 5, attack: 0.004 }); this._tone(180 + Math.random() * 60, t, 0.12, 0.03 * n, { type: 'square', to: 90, verb: false }); }
    else if (info.schmiede && day && r < 0.3) { for (let i = 0; i < 2; i++) { const s = t + i * 0.32; this._tone(1850 + Math.random() * 300, s, 0.35, 0.03 * n, { type: 'triangle', attack: 0.003 }); this._tone(3120, s, 0.2, 0.012 * n, { attack: 0.003 }); } }
    else if (info.hafen && r < 0.55) { if (Math.random() < 0.5) { const f = 900 + Math.random() * 300; this._tone(f, t, 0.5, 0.022 * n, { to: f * 0.72, attack: 0.05 }); this._tone(f * 1.1, t + 0.42, 0.4, 0.018 * n, { to: f * 0.8, attack: 0.05 }); } else this._noise(t, 0.8, 0.03 * n, { type: 'bandpass', f0: 300, f1: 180, Q: 1.2 }); }
    else if (info.markt && day && r < 0.75) { const f = 400 + Math.random() * 300; this._tone(f, t, 0.2, 0.018 * n, { type: 'sawtooth', to: f * 1.3, verb: false }); }
    else if ((info.era | 0) >= 6 && day && r < 0.9) { this._tone(310, t, 0.22, 0.014 * n, { type: 'square', verb: false }); }
    else if (day && (info.pop || 0) > 20) this.babble(Math.floor(Math.random() * 1e5), ['m', 'f', 'k'][Math.floor(Math.random() * 3)]);
  };

  // ---------- Musik, die mitgeht: Tonart, Dichte und Klang nach Epoche, Nähe zur Stadt, Nacht, Krieg ----------
  // mood setzt main.js: { era, near, krieg, feier }
  P.musicTick = function (t, night, wxs) {
    if (t < this.nextNote) return;
    const M = this.mood || {}, era = M.era | 0, busy = Math.max(0, Math.min(1, M.near || 0));
    const war = !!M.krieg, dark = night > 0.5 || wxs.gloom > 0.5;
    const SCALES = {
      penta: [62, 64, 67, 69, 71, 74, 76], dorisch: [62, 64, 65, 67, 69, 71, 72, 74], dur: [62, 64, 66, 67, 69, 71, 73, 74, 78],
      moll: [62, 64, 65, 67, 69, 70, 72, 74], krieg: [57, 58, 60, 62, 64, 65, 68],
    };
    const scale = war ? SCALES.krieg : dark ? SCALES.moll : era <= 1 ? SCALES.penta : era <= 4 ? SCALES.dorisch : SCALES.dur;
    const gap = (war ? 1.4 : 2.6 - busy * 0.9 - Math.min(0.8, era * 0.1)) + Math.random() * (war ? 1.6 : 4.2 - busy * 1.6);
    this.nextNote = t + Math.max(0.7, gap);
    const pick = () => scale[Math.floor(Math.random() * scale.length)];
    const n = pick() - (Math.random() < 0.3 ? 12 : 0);
    const now = this.ctx.currentTime;
    if (era <= 1) { this.note(n, 0.05, 5.5); if (Math.random() < 0.3) this._tone(midi(n + 12), now + 0.4, 1.6, 0.012, { attack: 0.3 }); }              // Flöte, weit
    else if (era <= 3) { this._tone(midi(n), now, 2.2, 0.05, { type: 'triangle', attack: 0.008 }); if (Math.random() < 0.5) this._tone(midi(pick()), now + 0.28, 2, 0.035, { type: 'triangle', attack: 0.008 }); } // gezupft
    else if (era <= 5) { this.note(n, 0.042, 5); this._tone(midi(n + 7), now + 0.02, 3.2, 0.02, { attack: 0.5 }); if (Math.random() < 0.35) this.note(scale[0] - 24, 0.035, 8); }                                // Quinten, Orgel
    else { [0, 4, 7].forEach((d, i) => this._tone(midi(n + d - (i ? 0 : 12)), now + i * 0.05, 3.6, 0.026, { attack: 0.4 })); if (busy > 0.4 && Math.random() < 0.5) this._tone(midi(pick() + 12), now + 0.5, 1.2, 0.02, { type: 'triangle', attack: 0.01 }); } // Akkorde
    if (war && Math.random() < 0.7) { for (let i = 0; i < 2; i++) this._noise(now + i * 0.42, 0.3, 0.16, { f0: 130, f1: 60, attack: 0.005 }); }  // Trommel
    else if (Math.random() < 0.22) this.note(scale[0] - 24, 0.03, 9);
  };
}
