// Flugphysik (seit 18.10.2026): ein Starrkörper mit sechs Freiheitsgraden in echten Einheiten (Meter, Kilogramm,
// Sekunden). Jede Fläche (linker und rechter Flügel mit Querruder, Höhenleitwerk mit Höhenruder, Seitenleitwerk mit
// Seitenruder) rechnet ihren eigenen Anstellwinkel aus der Anströmung an ihrer Stelle (Fluggeschwindigkeit plus Drehung),
// daraus Auftrieb, Widerstand und Moment nach dem Flächenmodell von Khan und Nahon (2015, wie im Unity Projekt
// "Aircraft Physics"): Auftriebsanstieg nach Streckung, Ruderklappen verschieben den Nullauftriebswinkel, induzierter
// Widerstand, Strömungsabriss mit weichem Übergang ins Plattenmodell bis 90 Grad. Dazu Rumpfwiderstand, Propellerschub
// mit Propellerstrahl über dem Leitwerk, Schwerkraft, Bugradfahrwerk mit Federn, Dämpfern, Reibung und Bremse.
// Rechnet in festen Schritten (240 pro Sekunde), Lage als Quaternion, Drehung im Flugzeugsystem (x rechts, y oben, z vorn).
// Kein THREE nötig, läuft auch in Node (Tests).

export const AIR = 1.225, G = 9.81;
// Luftdichte nach Normatmosphäre (ISA): bis 11 km Troposphäre mit 6,5 Grad pro km Abkühlung, darüber exponentiell
export function airDensity(h) {
  if (h < 11000) return AIR * Math.pow(1 - 2.25577e-5 * Math.max(-500, h), 4.2559);
  return 0.36392 * Math.exp(-(h - 11000) / 6341.6);
}
const D2R = Math.PI / 180;

// kleine Vektor- und Quaternionhelfer (Arrays, schnell und ohne Abhängigkeiten)
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
// q = [x, y, z, w]
export function qrot(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
export const qinv = q => [-q[0], -q[1], -q[2], q[3]];
export function qmul(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
export function qaxis(axis, ang) { const s = Math.sin(ang / 2); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(ang / 2)]; }
const qnorm = q => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));

// ---------- eine aerodynamische Fläche ----------
// pos: Viertelpunkt der Fläche relativ zum Schwerpunkt; c: Profilsehne nach vorn; n: Flächennormale (oben); s = n × c (Spannweite)
export class Surface {
  constructor(o) {
    Object.assign(this, { liftSlope: 2 * Math.PI, skin: 0.02, zeroLift: 0, stallHigh: 15 * D2R, stallLow: -15 * D2R, flapFraction: 0, flap: 0, slip: 0 }, o);
    this.c = norm(o.c); const n0 = norm(o.n); this.n = norm(sub(n0, mul(this.c, dot(n0, this.c)))); this.s = cross(this.n, this.c);
    this.area = this.chord * this.span;
    const AR = this.ar;
    this.cla = this.liftSlope * AR / (AR + 2 * (AR + 4) / (AR + 2)); // Auftriebsanstieg der endlichen Fläche
  }

  // Beiwerte [Auftrieb, Widerstand, Moment] bei Anstellwinkel a und Klappenwinkel f (rad)
  coeffs(a, f) {
    const cla = this.cla, AR = this.ar;
    let dCl = 0;
    if (this.flapFraction > 0) {
      const th = Math.acos(2 * this.flapFraction - 1);
      const eff = 1 - (th - Math.sin(th)) / Math.PI;
      dCl = cla * eff * lerp(0.8, 0.4, (Math.abs(f) / D2R - 10) / 50) * f;
    }
    const a0 = this.zeroLift - dCl / cla;
    const fr = Math.max(0, Math.min(1, 1 - 0.5 * (this.flapFraction - 0.1) / 0.3));
    const clHi = cla * (this.stallHigh - this.zeroLift) + dCl * fr;
    const clLo = cla * (this.stallLow - this.zeroLift) + dCl * fr;
    const sHi = a0 + clHi / cla, sLo = a0 + clLo / cla;
    const padHi = lerp(15, 5, (f / D2R + 50) / 100) * D2R, padLo = lerp(15, 5, (-f / D2R + 50) / 100) * D2R;
    const low = aa => {
      const cl = cla * (aa - a0);
      const ai = cl / (Math.PI * AR);
      const ae = aa - a0 - ai;
      const ct = this.skin * Math.cos(ae);
      const cn = (cl + Math.sin(ae) * ct) / Math.cos(ae);
      // Khan und Nahon rechnen die Normalkraft wie an einer ebenen Platte und lassen die Saugkraft an der Vorderkante weg.
      // Bei anliegender Strömung hat ein echtes Profil sie fast ganz: dann bleibt nur der induzierte Widerstand nach der
      // Traglinientheorie (cl * ai, Oswald-Faktor 0,85). Zum Abriss hin übernimmt die Plattenformel über die Überblendung.
      const cdPlate = cn * Math.sin(ae) + ct * Math.cos(ae);
      const cdLine = ct + cl * ai / 0.85;
      const cd = lerp(cdPlate, cdLine, 0.9);
      const cm = -cn * (0.25 - 0.175 * (1 - 2 * Math.abs(ae) / Math.PI));
      return [cl, cd, cm];
    };
    const stall = (aa, stallA) => {
      let ai;
      const clS = cla * (stallA - a0);
      ai = clS / (Math.PI * AR);
      const lp = aa > stallA ? (Math.PI / 2 - Math.min(aa, Math.PI / 2)) / (Math.PI / 2 - stallA) : (-Math.PI / 2 - Math.max(aa, -Math.PI / 2)) / (-Math.PI / 2 - stallA);
      ai = lerp(0, ai, lp);
      const ae = aa - a0 - ai;
      const f90 = 1.98 - 0.0426 * f * f + 0.21 * f;
      const cn = f90 * Math.sin(ae) * (1 / (0.56 + 0.44 * Math.abs(Math.sin(ae))) - 0.41 * (1 - Math.exp(-17 / AR)));
      const ct = 0.5 * this.skin * Math.cos(ae);
      const cl = cn * Math.cos(ae) - ct * Math.sin(ae);
      const cd = cn * Math.sin(ae) + ct * Math.cos(ae);
      const cm = -cn * (0.25 - 0.175 * (1 - 2 * Math.abs(ae) / Math.PI));
      return [cl, cd, cm];
    };
    if (a < sHi && a > sLo) return low(a);
    if (a > sHi + padHi || a < sLo - padLo) return stall(a, a > 0 ? sHi : sLo);
    if (a > sHi) { const L = low(sHi), H = stall(sHi + padHi, sHi), t = (a - sHi) / padHi; return [lerp(L[0], H[0], t), lerp(L[1], H[1], t), lerp(L[2], H[2], t)]; }
    const L = low(sLo), H = stall(sLo - padLo, sLo), t = (sLo - a) / padLo;
    return [lerp(L[0], H[0], t), lerp(L[1], H[1], t), lerp(L[2], H[2], t)];
  }

  // Kraft und Moment im Flugzeugsystem bei Luftbewegung va (Luft relativ zur Fläche)
  force(va, out, rho = AIR) {
    const vs = dot(va, this.s);
    const v = sub(va, mul(this.s, vs)); // Anteil längs der Spannweite trägt nicht
    const V2 = dot(v, v);
    if (V2 < 1e-4) { this.alpha = 0; return; }
    const a = Math.atan2(dot(v, this.n), -dot(v, this.c));
    this.alpha = a;
    const [cl, cd, cm] = this.coeffs(a, this.flap);
    const q = 0.5 * rho * V2;
    const dDir = norm(v), lDir = norm(cross(this.s, dDir));
    const F = add(mul(lDir, cl * q * this.area), mul(dDir, cd * q * this.area));
    out.f = add(out.f, F);
    out.m = add(add(out.m, cross(this.pos, F)), mul(this.s, -cm * q * this.area * this.chord));
    this.lift = cl * q * this.area;
  }
}

// ---------- das Flugzeug ----------
// Leichtes Sportflugzeug (Hochdecker): 650 kg, 9,2 m Spannweite, Abreißgeschwindigkeit rund 85 km/h, Spitze rund 190 km/h
export function lightPlane() {
  const wing = { chord: 1.55, span: 4.4, ar: 6.0, zeroLift: -2.5 * D2R, stallHigh: 15 * D2R, stallLow: -14 * D2R, skin: 0.017, flapFraction: 0.25 };
  const inc = 2 * D2R, dih = 3 * D2R;
  const tailInc = -1.9 * D2R;
  return {
    mass: 650,
    inertia: [1150, 1650, 800], // Nicken (x), Gieren (y), Rollen (z) in kg m²
    // Motor mit Turbolader: 250 kW bis 9 km Volldruckhöhe, darüber sinkt die Leistung mit der Luftdichte.
    // Propellerschub ηP / (v + ηP / T0): im Stand T0, schnell fast konstante Leistung. Turbo-Taste: Überladedruck (Spielhilfe)
    power: 250000, eta: 0.8, thrustStatic: 3600, turboAlt: 9000, boost: 2.2, propDisc: 2.6,
    cdA: [2.0, 3.2, 0.24], // Rumpfwiderstand quer, senkrecht, längs (m²)
    surfaces: [
      new Surface({ name: 'wingL', ...wing, pos: [-2.4, 0.95, 0.12], c: [0, Math.sin(inc), Math.cos(inc)], n: [Math.sin(dih), Math.cos(dih) * Math.cos(inc), -Math.sin(inc)], ctrl: 'roll', sign: 1, max: 10 * D2R }),
      new Surface({ name: 'wingR', ...wing, pos: [2.4, 0.95, 0.12], c: [0, Math.sin(inc), Math.cos(inc)], n: [-Math.sin(dih), Math.cos(dih) * Math.cos(inc), -Math.sin(inc)], ctrl: 'roll', sign: -1, max: 10 * D2R }),
      new Surface({ name: 'htail', chord: 0.78, span: 3.0, ar: 3.9, pos: [0, 0.3, -4.55], c: [0, Math.sin(tailInc), Math.cos(tailInc)], n: [0, Math.cos(tailInc), -Math.sin(tailInc)], flapFraction: 0.4, ctrl: 'pitch', sign: -1, max: 24 * D2R, skin: 0.02, slip: 0.65 }),
      new Surface({ name: 'vtail', chord: 0.9, span: 1.25, ar: 1.8, pos: [0, 0.9, -4.7], c: [0, 0, 1], n: [1, 0, 0], flapFraction: 0.38, ctrl: 'yaw', sign: -1, max: 25 * D2R, skin: 0.02, slip: 0.6 }),
    ],
    // Räder (Aufstandspunkt) und Punkte, die nie den Boden berühren dürfen
    wheels: [
      { pos: [0, -1.2, 1.75], nose: true }, { pos: [-1.15, -1.2, -0.3] }, { pos: [1.15, -1.2, -0.3] },
    ],
    hard: [[-4.6, 1.0, 0.2], [4.6, 1.0, 0.2], [0, 0.1, 2.4], [0, 1.6, -5.0], [-1.6, 0.35, -4.6], [1.6, 0.35, -4.6]],
    // Schleifsporn unter dem Heck: beim Überrotieren schleift er, erst ein harter Schlag ist Bruch
    skids: [[0, -0.45, -3.3], [0, -0.2, -4.6]],
  };
}

export class Aircraft {
  constructor(spec = lightPlane()) {
    this.spec = spec;
    this.pos = [0, 100, 0]; this.vel = [0, 0, 40]; this.q = [0, 0, 0, 1]; this.w = [0, 0, 0];
    this.ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 0.7, brake: 0, boost: 0 };
    this.thrust = 0; this.acc = [0, 0, 0]; this.load = 1; this.onGround = false; this.contact = 0;
    this.crash = null;
  }

  place(pos, heading, speed, pitch = 0) {
    this.pos = pos.slice();
    this.q = qmul(qaxis([0, 1, 0], heading), qaxis([1, 0, 0], -pitch));
    this.vel = qrot(this.q, [0, 0, speed]);
    this.w = [0, 0, 0]; this.crash = null;
  }

  // Werte für die Anzeige
  get speed() { return len(this.vel); }
  get bodyVel() { return qrot(qinv(this.q), this.vel); }
  get forward() { return qrot(this.q, [0, 0, 1]); }
  get up() { return qrot(this.q, [0, 1, 0]); }
  get right() { return qrot(this.q, [1, 0, 0]); }
  get aoa() { const v = this.bodyVel; return Math.atan2(-v[1], v[2]); }
  get slipAngle() { const v = this.bodyVel; return Math.atan2(v[0], v[2]); }
  get bank() { const r = this.right; return Math.asin(Math.max(-1, Math.min(1, -r[1]))) * (this.up[1] < 0 ? -1 : 1) + (this.up[1] < 0 ? Math.PI * Math.sign(-r[1] || 1) : 0); }
  get pitchAngle() { return Math.asin(Math.max(-1, Math.min(1, this.forward[1]))); }
  get heading() { const f = this.forward; return Math.atan2(f[0], f[2]); }

  // env: ground(x, z) → Bodenhöhe in Metern (Wasser eingerechnet), water(x, z) → true über Wasser, obstacle(x, z) → Höhe von Häusern und Bäumen
  step(dt, env) {
    if (this.crash) return;
    const S = this.spec, c = this.ctl;
    // Ruder folgen den Eingaben
    for (const sf of S.surfaces) sf.flap = (c[sf.ctrl] || 0) * sf.sign * sf.max;
    const vb = qrot(qinv(this.q), this.vel);
    const out = { f: [0, 0, 0], m: [0, 0, 0] };
    // Schub: nimmt mit der Geschwindigkeit ab, dazu der Propellerstrahl, der das Leitwerk anbläst
    const vz = Math.max(0, vb[2]);
    const rho = airDensity(this.pos[1]);
    this.rho = rho;
    const turbo = this.pos[1] < S.turboAlt ? 1 : rho / airDensity(S.turboAlt);
    const pw = c.throttle * (1 + (S.boost - 1) * (c.boost || 0)) * turbo;
    const etaP = S.eta * S.power * pw, T0 = S.thrustStatic * pw * Math.cbrt(rho / AIR);
    const T = pw > 1e-4 ? etaP / (vz + etaP / T0) : 0;
    this.thrust = T;
    out.f[2] += T;
    const wash = Math.sqrt(vz * vz + 2 * T / (rho * S.propDisc)) - vz;
    for (const sf of S.surfaces) {
      const vp = add(vb, cross(this.w, sf.pos));
      let va = mul(vp, -1);
      if (sf.slip) va = add(va, [0, 0, -wash * sf.slip]);
      sf.force(va, out, rho);
    }
    // Rumpf
    for (let i = 0; i < 3; i++) out.f[i] -= 0.5 * rho * S.cdA[i] * Math.abs(vb[i]) * vb[i];
    let fw = qrot(this.q, out.f);
    fw = add(fw, [0, -S.mass * G, 0]);
    let mb = out.m;
    // Boden: Räder federn, rollen, bremsen; andere Teile am Boden heißt Bruch
    this.onGround = false; this.contact = 0;
    const steer = vz < 18 ? c.yaw * 0.45 : c.yaw * 0.12; // Bugrad lenkt mit dem Seitenruder
    for (const wh of S.wheels) {
      const r = wh.pos, P = add(this.pos, qrot(this.q, r));
      const h = env.ground(P[0], P[2]);
      const d = h - P[1];
      if (d <= 0) continue;
      this.onGround = true; this.contact++;
      const vp = add(this.vel, qrot(this.q, cross(this.w, r)));
      if (vp[1] < -6.5 && !this.crash) { this.crash = { why: 'hart', at: P, v: len(vp) }; return; }
      if (env.water && env.water(P[0], P[2])) { this.crash = { why: 'wasser', at: P, v: len(vp) }; return; }
      const n = env.normal ? env.normal(P[0], P[2]) : [0, 1, 0];
      const Fn = Math.max(0, 52000 * d - 5200 * dot(vp, n));
      let fdir = qrot(this.q, wh.nose ? [Math.sin(steer), 0, Math.cos(steer)] : [0, 0, 1]);
      fdir = norm(sub(fdir, mul(n, dot(fdir, n))));
      const ldir = cross(n, fdir);
      const vf = dot(vp, fdir), vl = dot(vp, ldir);
      const mu = c.brake > 0 && !wh.nose ? 0.55 * c.brake + 0.02 : 0.022;
      const Ff = -Math.sign(vf) * mu * Fn * Math.min(1, Math.abs(vf) / 0.4);
      const Fl = -0.85 * Fn * Math.max(-1, Math.min(1, vl / 0.5));
      const Fc = add(add(mul(n, Fn), mul(fdir, Ff)), mul(ldir, Fl));
      fw = add(fw, Fc);
      mb = add(mb, cross(r, qrot(qinv(this.q), Fc)));
    }
    for (const r of S.skids || []) {
      const P = add(this.pos, qrot(this.q, r));
      const h = env.ground(P[0], P[2]);
      const d = h - P[1];
      if (d <= 0) continue;
      const vp = add(this.vel, qrot(this.q, cross(this.w, r)));
      if (vp[1] < -4 || (env.water && env.water(P[0], P[2]))) { this.crash = { why: env.water && env.water(P[0], P[2]) ? 'wasser' : 'heck', at: P, v: len(vp) }; return; }
      const Fn = Math.max(0, 60000 * d - 6000 * vp[1]);
      const vh = [vp[0], 0, vp[2]], sp = len(vh);
      const Fc = add([0, Fn, 0], sp > 0.01 ? mul(vh, -0.6 * Fn / sp) : [0, 0, 0]);
      fw = add(fw, Fc);
      mb = add(mb, cross(r, qrot(qinv(this.q), Fc)));
      this.scrape = (this.scrape || 0) + 1;
    }
    for (const r of S.hard) {
      const P = add(this.pos, qrot(this.q, r));
      const h = env.ground(P[0], P[2]);
      if (P[1] < h) { this.crash = { why: env.water && env.water(P[0], P[2]) ? 'wasser' : 'boden', at: P, v: this.speed }; return; }
      if (env.obstacle) { const o = env.obstacle(P[0], P[2]); if (o > h && P[1] < o) { this.crash = { why: 'hindernis', at: P, v: this.speed }; return; } }
    }
    // Bewegung (halbimplizit: erst Geschwindigkeit, dann Ort)
    const acc = mul(fw, 1 / S.mass);
    this.acc = acc;
    this.vel = add(this.vel, mul(acc, dt));
    this.pos = add(this.pos, mul(this.vel, dt));
    const I = S.inertia, w = this.w;
    const Iw = [I[0] * w[0], I[1] * w[1], I[2] * w[2]];
    const gyro = cross(w, Iw);
    const dw = [(mb[0] - gyro[0]) / I[0], (mb[1] - gyro[1]) / I[1], (mb[2] - gyro[2]) / I[2]];
    this.w = add(w, mul(dw, dt));
    const wq = [this.w[0], this.w[1], this.w[2], 0];
    const dq = qmul(this.q, wq);
    this.q = qnorm([this.q[0] + dq[0] * 0.5 * dt, this.q[1] + dq[1] * 0.5 * dt, this.q[2] + dq[2] * 0.5 * dt, this.q[3] + dq[3] * 0.5 * dt]);
    // Lastvielfaches: Beschleunigung ohne Schwerkraft entlang der Hochachse
    const aNoG = add(acc, [0, G, 0]);
    this.load = dot(aNoG, this.up) / G;
  }

  // in festen Schritten rechnen
  update(dt, env, hz = 240) {
    this.accum = (this.accum || 0) + Math.min(dt, 0.1);
    const h = 1 / hz;
    let n = 0;
    while (this.accum >= h && n < 40) { this.step(h, env); this.accum -= h; n++; if (this.crash) break; }
  }
}
