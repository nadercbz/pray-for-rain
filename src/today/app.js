// Erde heute (seit 26.10.2026, PLAN_ERDE_HEUTE.md): Start, Zeit, Speichern, Kamera und das Zusammenspiel von Erde und
// Simulation. Eigene Seite (heute.html), damit Inselwelt und Erde vom Anfang unberührt bleiben.
// Seit 27.10.2026 eine einzige nahtlose Erde im Maßstab 1 zu 1 (earth3d/earthview.js): von der Umlaufbahn bis auf den
// Gehweg ohne Kartenwechsel, echte Höhen, echte Straßen und Gebäude, echte Sonne nach Datum und Uhrzeit.
import * as THREE from 'three';
import { createStage } from '../render/scene.js';
import { U } from '../render/mats.js';
import { loadEarth, EARTH } from '../sim/earth.js';
import * as D from '../sim/data.js';
import { L, LANG } from '../i18n.js';
import { Sound } from '../ui/audio.js';
import { loadToday, TODAY, cityStyle } from './data.js';
import { createToday, stepToday, serializeToday, deserializeToday, DPY, dateOf, MANA_MAX } from './sim.js';
import { castToday } from './powers.js';
import { EarthView } from '../earth3d/earthview.js';
import { R, ecef, lonLatOf } from '../earth3d/geo.js';
import { CU } from '../city/mats.js';
import { Life } from '../city/life.js';
import { TodayUI } from './ui.js';
import { EarthFlight } from '../earth3d/earthflight.js';
import { flightPad } from '../ui/touch.js';

const KEY = 'builtitup.today.v1', API = 'api/heute', LOCK = 'builtitup.today.lock';
const Q = new URLSearchParams(location.search);
const LOCAL_ONLY = Q.has('local') || /\.github\.io$/.test(location.hostname);
const DAY = D.DAY_SECONDS, VDAYS = 6, FAST = 100, CATCHUP_MAX = DPY * 60;
const TAB = Math.random().toString(36).slice(2);
const COARSE = matchMedia('(pointer: coarse)').matches;
const $ = s => document.querySelector(s);
const D2R = Math.PI / 180;

const app = { ts: null, speed: 1, acc: 0, running: false, power: null, sound: new Sound(), cityIdx: -1, night: 0, lang: LANG };
window.TODAY_APP = app;

// ---------- Bühne ----------
const stage = createStage($('#c'));
app.stage = stage;
const earth = new EarthView(stage, { coarse: COARSE });
const life = new Life(stage, earth);
app.earth = earth; app.life = life;
// Fliegen wie auf den Inseln, dazu der Düsenjet (earth3d/earthflight.js, Taste P, Knopf mit dem Flugzeug)
const flight = new EarthFlight(stage, app, earth);
app.flight = flight;
if (COARSE) { document.body.classList.add('tflight'); const fp = flightPad(app, flight); fp.hold('rocket', '<svg viewBox="0 0 24 24"><path d="M12 2.5c3 2.5 4.5 6 4.5 10.5l-2 3h-5l-2-3C7.5 8.5 9 5 12 2.5z M9.5 16l-2 4.5 M14.5 16l2 4.5 M12 16.5v5"/></svg><span>' + L('Rakete', 'Rocket') + '</span>', () => flight.keys.add('rocket'), () => flight.keys.delete('rocket')); fp.hold('jet', '<svg viewBox="0 0 24 24"><path d="M4 12h16 M12 4l4 8-4 8"/></svg><span>' + L('Jet', 'Jet') + '</span>', () => flight.setType(flight.type === 'jet' ? 'plane' : 'jet')); }
Object.assign(stage.controls, { minDistance: 0.25, maxDistance: 3.6e6, maxPolarAngle: 1.47, minPolarAngle: 0.02, zoomSpeed: 1.15, panSpeed: 1 });
const cursor = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false }));
cursor.renderOrder = 10; cursor.visible = false;
stage.scene.add(cursor);
let ui = null;

// Feld des Spielrasters (2048 mal 1024, Länge minus 169 an der Naht) zu Länge und Breite und zurück
export const llOfTile = (tx, ty) => [(((-169 + (tx + 0.5) / 2048 * 360) + 540) % 360) - 180, 90 - (ty + 0.5) / 1024 * 180];
export const tileOfLL = (lon, lat) => [Math.floor(((((lon + 169) % 360) + 360) % 360) / 360 * 2048), Math.min(1023, Math.max(0, Math.floor((90 - lat) / 180 * 1024)))];
app.llOfTile = llOfTile; app.tileOfLL = tileOfLL;

// ---------- Speichern ----------
function localLoad() { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; } }
async function serverLoad() {
  if (LOCAL_ONLY) return null;
  try { const r = await fetch(API, { cache: 'no-store' }); app.serverSync = r.ok || r.status === 204; return r.status === 200 ? await r.json() : null; } catch { app.serverSync = false; return null; }
}
let lastServer = 0;
function save(force) {
  const ts = app.ts; if (!ts || !ownLock()) return;
  ts.savedAt = Date.now(); ts.acc = app.acc;
  const json = serializeToday(ts);
  try { localStorage.setItem(KEY, json); } catch { /* voll */ }
  if (app.serverSync && (force || Date.now() - lastServer > 45000)) {
    lastServer = Date.now();
    fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Tab': TAB }, body: json, keepalive: json.length < 60000 }).catch(() => {});
  }
}
function ownLock() { try { const l = JSON.parse(localStorage.getItem(LOCK) || 'null'); return !l || l.id === TAB || Date.now() - l.t > 7000; } catch { return true; } }
setInterval(() => { if (ownLock()) try { localStorage.setItem(LOCK, JSON.stringify({ id: TAB, t: Date.now() })); } catch { /* egal */ } }, 2000);
addEventListener('visibilitychange', () => { if (document.hidden) save(true); });
addEventListener('pagehide', () => save(true));

// ---------- Zeit ----------
const nextFrame = () => new Promise(r => requestAnimationFrame(r));
async function catchUp(seconds, onProgress) {
  const ts = app.ts;
  let days = Math.floor((app.acc + Math.max(0, seconds)) / DAY);
  const capped = days > CATCHUP_MAX; if (capped) days = CATCHUP_MAX;
  app.acc = capped ? 0 : (app.acc + seconds) % DAY;
  const n0 = ts.news.length;
  let t0 = performance.now();
  for (let d = 0; d < days; d++) { stepToday(ts); if (performance.now() - t0 > 30) { onProgress && onProgress(d / days); await nextFrame(); t0 = performance.now(); } }
  ts._rt.news.length = 0; ts._rt.fx.length = 0;
  return { days, news: ts.news.slice(n0) };
}
app.setSpeed = s => { app.speed = s; ui && ui.syncSpeed(); };
// Uhrzeit der Welt (UTC in Stunden): ein sichtbarer Tag dauert 6 Spieltage (3 Minuten), wie im übrigen Spiel
const utcHours = () => { const ts = app.ts; if (app.fixUtc != null) return app.fixUtc; return ts ? ((ts.day % VDAYS + app.acc / DAY) / VDAYS * 24 + 6) % 24 : 11; };
// Sonne: Deklination nach Jahrestag, Unterpunkt nach Uhrzeit
function sunEcef() {
  const d = app.ts ? dateOf(app.ts.day) : new Date(Date.UTC(2026, 9, 26));
  const doy = (d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000;
  const dec = -23.44 * Math.cos(2 * Math.PI * (doy + 10) / 365);
  const lon = (12 - utcHours()) * 15;
  const p = ecef(lon, dec, 0);
  return new THREE.Vector3(p[0], p[1], p[2]).normalize();
}

// ---------- Kamera ----------
const tg = stage.controls.target;
// Ursprung der Welt auf das Blickziel legen (Kamera und Ziel umrechnen, Ziel auf den Boden)
function rebase() {
  const [lon, lat] = earth.lonLatOfWorld(tg);
  const camE = earth.ecefOf(stage.camera.position);
  earth.setOrigin(lon, lat);
  const o = earth.F.o, c = new THREE.Vector3(camE[0] - o[0], camE[1] - o[1], camE[2] - o[2]).applyMatrix4(earth.M);
  stage.camera.position.copy(c);
  tg.set(0, earth.heightAt(lon, lat), 0);
  if (camAnim) camAnim.rebased = true;
}
app.rebase = rebase;
// Flug zu einem Ort: das Ziel wandert über den Großkreis, der Abstand geht hoch und wieder runter
let camAnim = null;
app.flyToLL = (lon, lat, dist = 80) => {
  const [lon0, lat0] = earth.lonLatOfWorld(tg), d0 = stage.camera.position.distanceTo(tg);
  const a = ecef(lon0, lat0, 0), b = ecef(lon, lat, 0);
  const ang = Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (R * R))));
  const peak = Math.max(d0, dist, ang * R * 0.9);
  camAnim = { t: 0, lon0, lat0, lon, lat, d0, d1: dist, peak, dur: Math.min(4.5, 1.2 + Math.log10(1 + ang * R / 100) * 0.7), off: stage.camera.position.clone().sub(tg).normalize() };
};
app.stopFly = () => { camAnim = null; };
app.flyTo = (tx, ty, distOld = 50) => { const [lon, lat] = llOfTile(tx, ty); app.flyToLL(lon, lat, distOld * 1600); };
app.flyToCity = i => { const C = TODAY.cities, pop = Math.max(C.pop[i], C.metro[i]); app.flyToLL(C.lon[i], C.lat[i], pop > 3e6 ? 260 : pop > 3e5 ? 140 : 70); };
app.enterCity = app.flyToCity;
function slerpLL(lon0, lat0, lon1, lat1, k) {
  const a = ecef(lon0, lat0, 0), b = ecef(lon1, lat1, 0), dot = Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (R * R))), w = Math.acos(dot);
  if (w < 1e-7) return [lon1, lat1];
  const s = Math.sin(w), f0 = Math.sin((1 - k) * w) / s, f1 = Math.sin(k * w) / s;
  const p = [a[0] * f0 + b[0] * f1, a[1] * f0 + b[1] * f1, a[2] * f0 + b[2] * f1];
  const ll = lonLatOf(p[0], p[1], p[2]);
  return [ll[0], ll[1]];
}
function stepCamAnim(dt) {
  const A = camAnim; if (!A) return;
  A.t = Math.min(1, A.t + dt / A.dur);
  const k = A.t < 0.5 ? 4 * A.t ** 3 : 1 - (-2 * A.t + 2) ** 3 / 2;
  const [lon, lat] = slerpLL(A.lon0, A.lat0, A.lon, A.lat, k);
  // Abstand: logarithmisch über den Scheitel
  const l0 = Math.log(A.d0), lp = Math.log(A.peak), l1 = Math.log(A.d1);
  const ld = A.t < 0.5 ? l0 + (lp - l0) * Math.sin(A.t * Math.PI) : l1 + (lp - l1) * Math.sin(A.t * Math.PI);
  earth.setOrigin(lon, lat);
  tg.set(0, earth.heightAt(lon, lat), 0);
  // nah am Ziel schräg von der Seite statt senkrecht von oben (aus dem All kommt der Blick sonst steil herunter)
  const side = new THREE.Vector3(A.off.x, 0, A.off.z); if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
  side.normalize().multiplyScalar(0.8); side.y = 0.6;
  const off = A.off.clone().lerp(side, A.d1 < 800 ? THREE.MathUtils.smoothstep(A.t, 0.45, 1) : 0).normalize();
  if (off.y < 0.35) { off.y = 0.55; off.normalize(); }
  stage.camera.position.copy(tg).addScaledVector(off, Math.exp(ld));
  if (A.t >= 1) camAnim = null;
}
// Tastatur: Ziel über die Tangentialebene schieben (Tempo nach Höhe), drehen, zoomen
const keys = new Set();
const KEYMAP = { w: 'f', arrowup: 'f', s: 'b', arrowdown: 'b', a: 'l', arrowleft: 'l', d: 'r', arrowright: 'r', q: 'ql', e: 'qr', '+': 'in', '=': 'in', '-': 'out' };
addEventListener('keydown', e => {
  if (e.target.closest('input, textarea') || flight.active) return;
  const k = e.key.toLowerCase();
  if (KEYMAP[k]) { keys.add(KEYMAP[k]); e.preventDefault(); return; }
  if (k === 'escape') { if (app.power) { app.power = null; ui.syncPower(); } else ui.closeAll(); }
  else if (k === 'b' || k === 'i') ui.toggleBook();
  else if (k === 'c') ui.toggleNews();
  else if (k === 'h') ui.openHero();
  else if (k === 'g') app.flyToLL(...earth.lonLatOfWorld(tg).slice(0, 2), 1.4e6);
  else if (k === '1') app.setSpeed(1); else if (k === '2') app.setSpeed(3); else if (k === '3') app.setSpeed(10); else if (k === '4') app.setSpeed(100); else if (k === '5') app.setSpeed(500); else if (k === '6') app.setSpeed(1000);
  else if (k === ' ') { app.paused = !app.paused; ui.syncSpeed(); e.preventDefault(); }
});
addEventListener('keyup', e => { const k = KEYMAP[e.key.toLowerCase()]; if (k) keys.delete(k); });
addEventListener('blur', () => keys.clear());
const panV = new THREE.Vector3();
function keyCamera(dt) {
  const want = new THREE.Vector3(), cam = stage.camera.position;
  if (keys.size) {
    const fw = new THREE.Vector3(tg.x - cam.x, 0, tg.z - cam.z); if (fw.lengthSq() < 1e-8) fw.set(0, 0, -1); fw.normalize();
    const rt = new THREE.Vector3(-fw.z, 0, fw.x);
    const dist = cam.distanceTo(tg), speed = Math.max(0.6, dist * 0.9);
    if (keys.has('f')) want.add(fw); if (keys.has('b')) want.sub(fw); if (keys.has('r')) want.add(rt); if (keys.has('l')) want.sub(rt);
    if (want.lengthSq()) want.normalize().multiplyScalar(speed);
    const rot = (keys.has('qr') ? 1 : 0) - (keys.has('ql') ? 1 : 0), zoom = (keys.has('out') ? 1 : 0) - (keys.has('in') ? 1 : 0);
    if (rot || zoom) {
      const off = cam.clone().sub(tg);
      if (rot) off.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot * dt * 1.3);
      if (zoom) off.multiplyScalar(THREE.MathUtils.clamp(1 + zoom * dt * 1.6, stage.controls.minDistance / off.length(), stage.controls.maxDistance / off.length()));
      cam.copy(tg).add(off);
    }
    if (want.lengthSq() || rot || zoom) camAnim = null;
  }
  panV.lerp(want, Math.min(1, dt * 7));
  if (panV.lengthSq() > 1e-6) { const d = panV.clone().multiplyScalar(dt); tg.add(d); cam.add(d); }
}

// ---------- Kräfte ----------
app.choosePower = id => { app.power = app.power === id ? null : id; ui.syncPower(); };
function castAt(lon, lat) {
  const id = app.power; if (!id || !app.ts) return;
  const P = D.POWER[id];
  const [x, y] = tileOfLL(lon, lat);
  const tgt = { x, y };
  const near = cityNear(lon, lat, 40);
  if (near >= 0 && stage.camera.position.distanceTo(tg) < 3000) tgt.city = near;
  if (P.target === 'person' && app.ts.hero && near === app.ts.hero.city) tgt.hero = true;
  const res = castToday(app.ts, id, tgt);
  if (!res.ok) { ui.toast(res.why || L('Das geht hier nicht.', 'That does not work here.'), 'warn'); return; }
  app.sound.power && app.sound.power(id);
  ui.toast(`${P.name}: ${res.text ? res.text.slice(0, 140) : L('gewirkt', 'cast')}`, 'god');
  if (stage.camera.position.distanceTo(tg) < 400) life.effect(id);
  app.power = null; ui.syncPower(); ui.renderNews(); ui.renderPrayers();
}
app.castHere = () => { const [lon, lat] = earth.lonLatOfWorld(tg); castAt(lon, lat); };
// nächste Stadt zu einem Punkt (km), größere zuerst
function cityNear(lon, lat, km = 30) {
  const C = TODAY.cities, [tx, ty] = tileOfLL(lon, lat), r = Math.ceil(km / 18) + 1;
  let best = -1, bs = -1e9;
  for (let gy = (ty - r) >> 3; gy <= (ty + r) >> 3; gy++) for (let gx = (tx - r) >> 3; gx <= (tx + r) >> 3; gx++) {
    const a = C.grid.get(gy * 256 + ((gx + 256) % 256)); if (!a) continue;
    for (const i of a) {
      const dlat = (C.lat[i] - lat) * 111, dlon = (((C.lon[i] - lon + 540) % 360) - 180) * 111 * Math.cos(lat * D2R), d = Math.hypot(dlat, dlon);
      const rad = 2 + Math.sqrt(Math.max(C.pop[i], C.metro[i])) / 220;
      if (d > km + rad) continue;
      const s = Math.log10(Math.max(C.pop[i], 1000)) - d / Math.max(4, rad);
      if (s > bs) { bs = s; best = i; }
    }
  }
  return best;
}
app.cityNear = cityNear;

// ---------- Klicks ----------
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let downAt = null;
const canvas = $('#c');
// Verliert der Browser die Grafik (zu wenig Speicher, Treiber), wird gespeichert und die Seite neu geladen, statt stehen
// zu bleiben (seit 27.10.2026)
canvas.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  try { save(true); } catch { /* egal */ }
  if (ui) ui.toast(L('Die Grafik startet neu …', 'Restarting graphics …'), 'warn');
  setTimeout(() => location.reload(), 1500);
}, false);
canvas.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY, performance.now()]; });
canvas.addEventListener('pointermove', e => { mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); app.hover = pick(); });
canvas.addEventListener('pointerup', e => {
  if (flight.active) return;
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6 || performance.now() - downAt[2] > 600) return;
  mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  const p = pick(); if (!p) return;
  if (app.power) { castAt(p.lon, p.lat); return; }
  const dist = stage.camera.position.distanceTo(tg);
  if (dist < 300) {
    const who = life.pick(ray);
    if (who && who.hero) { ui.openHero(); return; }
    if (who) { ui.showCitizen(who); return; }
  }
  const ci = cityNear(p.lon, p.lat, Math.max(3, Math.min(300, dist * 0.004 * 10)));
  if (ci >= 0) ui.inspectCity(ci); else ui.inspectPlace(p.lon, p.lat);
});
canvas.addEventListener('dblclick', () => { if (flight.active) return; const p = pick(); if (!p) return; const d = stage.camera.position.distanceTo(tg); app.flyToLL(p.lon, p.lat, Math.max(30, d * 0.25)); });
// Punkt unter der Maus: Strahl gegen die Kugel (Radius plus Bodenhöhe), einmal nachgebessert
function pick() {
  ray.setFromCamera(mouse, stage.camera);
  const o = earth.ecefOf(ray.ray.origin), dW = ray.ray.direction.clone().applyMatrix4(earth.Mi);
  let rr = R + Math.max(0, tg.y);
  for (let k = 0; k < 2; k++) {
    const b = o[0] * dW.x + o[1] * dW.y + o[2] * dW.z, c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - rr * rr, disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc); if (t < 0) return null;
    const P = [o[0] + dW.x * t, o[1] + dW.y * t, o[2] + dW.z * t], [lon, lat] = lonLatOf(P[0], P[1], P[2]);
    const h = earth.heightAt(lon, lat);
    if (k === 1 || Math.abs(R + h - rr) < 0.5) return { lon, lat, h, w: earth.worldOf(lon, lat, h) };
    rr = R + h;
  }
  return null;
}

// ---------- Bildtakt ----------
let last = performance.now(), clock = 0, lastWall = Date.now(), lastUi = 0, catching = false;
const C1 = new THREE.Color(), SPACE = new THREE.Color('#05070d'), SPACEH = new THREE.Color('#0b1430');
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = Math.max(last, now); clock += dt; // nie rückwärts (Zeitstempel aus zwei Quellen)
  const ts = app.ts;
  if (ts && app.running && !catching && !app.paused && ownLock()) {
    const wall = Date.now(), gap = (wall - lastWall) / 1000; lastWall = wall;
    if (gap > 3) { catching = true; catchUp(gap).then(info => { catching = false; if (info.days >= DPY) ui.welcomeBack(info); ui.renderNews(true); save(true); }); }
    app.acc += dt * app.speed;
    let steps = 0;
    const max = app.speed >= 1000 ? 40 : app.speed >= 100 ? 12 : 4;
    while (app.acc >= DAY && steps < max) { app.acc -= DAY; stepToday(ts); steps++; }
    if (app.acc >= DAY) app.acc = DAY * 0.98;
    if (steps) onDays(steps);
  } else lastWall = Date.now();
  if (!earth.ready) { stage.composer.render(); return; }
  let dist;
  if (flight.active) {
    // im Flug führt das Flugzeug Kamera und Blickziel, der Ursprung wandert mit ihm (earthflight.js)
    flight.update(dt, clock);
  } else {
    // Kamera: Flug, Tastatur, Maus, dann Ursprung nachziehen
    stepCamAnim(dt);
    keyCamera(dt);
    dist = stage.camera.position.distanceTo(tg);
    stage.controls.maxPolarAngle = dist > 60000 ? 0.9 : dist > 6000 ? 1.25 : 1.47;
    stage.controls.rotateSpeed = 0.55; stage.controls.panSpeed = 1;
    stage.controls.update();
    if (Math.hypot(tg.x, tg.z) > Math.max(30, dist * 0.04) || Math.abs(tg.y - earth.heightAt(...earth.lonLatOfWorld(tg).slice(0, 2))) > Math.max(5, dist * 0.2)) rebase();
    else tg.y += (earth.heightAt(earth.F.lon, earth.F.lat) - tg.y) * Math.min(1, dt * 5);
    // Kamera bleibt über dem Boden
    { const [cl, cb, ch] = earth.lonLatOfWorld(stage.camera.position), g = earth.heightAt(cl, cb) + 0.12; if (ch < g) stage.camera.position.y += g - ch; }
  }
  dist = stage.camera.position.distanceTo(tg);
  const alt = earth.update(dt, stage.camera, tg);
  // für Nebel, Leben, Namen und Schatten zählt im Flug die Höhe, nicht der Abstand der Kamera zum Flugzeug
  const viewD = flight.active ? Math.max(dist, alt) : dist;
  // Sonne und Licht: echte Richtung, Himmelsfarben nach der Ortszeit am Blickziel
  const sE = sunEcef(); earth.sunEcef.copy(sE);
  const sW = earth.dirToWorld([sE.x, sE.y, sE.z]).normalize();
  const f = app.fixTod != null ? app.fixTod : app.speed >= FAST ? 0.45 : ((((utcHours() + earth.F.lon / 15) / 24) % 1) + 1) % 1;
  const { dayLight } = stage.setTime(f, { clouds: 0.3 });
  if (sW.y > -0.04) { stage.sunDir.copy(sW); stage.sky.material.uniforms.sunDir.value.copy(sW); }
  app.night = 1 - dayLight;
  U.uTime.value = clock; CU.uNight.value = app.night; CU.uLit.value = 0.12 + app.night * 0.2;
  // Weltraum: Himmel, Sterne und Mond fahren mit der Kamera, oben wird der Himmel schwarz, der Dunst verschwindet
  const space = THREE.MathUtils.smoothstep(alt, 2000, 10000); // 20 bis 100 km: darüber ist der Himmel schwarz
  const camFar = Math.max(4000, Math.min(4.5e7, dist * 4 + Math.sqrt(2 * R * alt + alt * alt) * 1.3));
  for (const o of [stage.sky, stage.stars, stage.moon]) { o.position.copy(stage.camera.position); }
  const sk = camFar * 0.9 / 900; stage.sky.scale.setScalar(sk); stage.stars.scale.setScalar(sk); stage.moon.scale.setScalar(sk);
  if (space > 0) {
    const su = stage.sky.material.uniforms;
    su.zen.value.lerp(SPACE, space); su.hor.value.lerp(C1.copy(SPACEH), space); su.glow.value *= 1 - space * 0.6; su.cirrus.value *= 1 - space;
    stage.stars.material.opacity = Math.max(stage.stars.material.opacity, space * 0.85);
  }
  const fogMul = 1 + alt / 60;
  // Nebel wächst mit der Höhe; im All keiner (nah nie hinter fern, sonst färbt der Nebel die ganze Kugel)
  if (space > 0.95) { stage.scene.fog.near = 1e9; stage.scene.fog.far = 2e9; }
  else { stage.scene.fog.far *= fogMul; stage.scene.fog.near = Math.min(stage.scene.fog.near * fogMul, stage.scene.fog.far * 0.6); }
  stage.camera.near = flight.active && flight.view === 1 ? 0.004 : THREE.MathUtils.clamp(dist * 0.0015, flight.active ? 0.008 : 0.02, 3000);
  stage.camera.far = camFar;
  stage.camera.updateProjectionMatrix();
  // Schatten nur nah am Boden: aus der Höhe aus (ohne neues Übersetzen der Shader), die Schattenkarte ruht
  const shK = 1 - THREE.MathUtils.smoothstep(viewD, 280, 520);
  stage.sun.shadow.intensity *= shK; stage.sun.shadow.autoUpdate = shK > 0;
  if (shK > 0) stage.followShadow(flight.active ? flight.shadowAt : tg, Math.min(viewD, 150), 130);
  // Kontaktschatten und Schärfentiefe nur nah am Boden (aus der Höhe verdunkeln sie halbe Bilder)
  stage.gtao.enabled = stage.quality === 'hoch' && viewD < 300;
  stage.grade.uniforms.blur.value = stage.quality === 'niedrig' || dist > 250 || flight.active ? 0 : THREE.MathUtils.clamp(1.0 - dist / 160, 0.12, 0.7);
  stage.grade.uniforms.focusZ.value = dist; stage.grade.uniforms.aperture.value = stage.grade.uniforms.blur.value * 0.85;
  stage.grade.uniforms.time.value = clock;
  stage.bloom.strength = 0.18 + app.night * 0.22 + space * 0.15; stage.bloom.threshold = 0.85 - app.night * 0.15;
  // Leben nahe am Boden, mit der Stadt am Blickziel (Namen, Linksverkehr, dein Mensch)
  if (flight.active ? flight.agl < 30 : dist < 600) {
    const [lon, lat] = [earth.F.lon, earth.F.lat], ci = app.frameNo++ % 30 === 0 ? cityNear(lon, lat, 25) : app.cityIdx;
    if (ci !== app.cityIdx && ci >= 0) {
      app.cityIdx = ci;
      const ctry = TODAY.byId.get(TODAY.cities.ctry[ci]);
      earth.style = cityStyle(ctry && ctry.iso3, TODAY.cities.lat[ci]); earth.lang = LANG === 'de' ? 'de' : 'en';
      life.enter(ci, ctry, app.ts && app.ts.hero && app.ts.hero.city === ci && app.ts.hero.alive !== false ? app.ts.hero.name : null);
    }
    life.update(dt, clock, app.night, app.speed);
  } else if (life.group.visible) { life.exit(); app.cityIdx = -1; }
  if (app.power) {
    const p = app.hover;
    cursor.visible = !!p;
    if (p) { cursor.position.copy(p.w).y += 0.05; cursor.scale.setScalar(Math.max(4, dist * 0.06)); }
  } else cursor.visible = false;
  stage.composer.render();
  if (ui) { ui.labels(viewD, alt); if (now - lastUi > 250) { lastUi = now; ui.update(); } }
}
app.frameNo = 0;
// ein Bild von Hand (Prüfstand im versteckten Vorschaufenster, dort ruht requestAnimationFrame)
app.tick = t => frame(t ?? performance.now());
let lastSave = 0;
function onDays() {
  const ts = app.ts;
  for (const e of ts._rt.news) ui.ticker(e);
  ts._rt.news.length = 0;
  for (const e of ts._rt.fx) {
    if (e.type === 'heroSay') { if (app.speed < FAST) ui.toast(e.text, 'big'); }
    else if (e.type === 'hero') ui.toast(L(`${e.from} ist gestorben. Deine Geschichte geht weiter mit ${e.to}.`, `${e.from} has died. Your story continues with ${e.to}.`), 'big');
    else if (e.type === 'heroEnd') ui.toast(L(`Mit ${e.from} endet deine Familie.`, `Your family ends with ${e.from}.`), 'big');
    else if (e.type === 'quake' && stage.camera.position.distanceTo(tg) < 400) life.effect('beben');
  }
  ts._rt.fx.length = 0;
  if (Date.now() - lastSave > (app.speed >= FAST ? 4000 : 1500)) { lastSave = Date.now(); save(); }
}

// ---------- Start ----------
async function boot() {
  try { const q = localStorage.getItem('biu.quality'); if (q) stage.setQuality(q); else if (COARSE) stage.setQuality('mittel'); } catch { /* egal */ }
  ui = new TodayUI(app);
  app.ui = ui;
  ui.intro(L('Die Erde wird geladen …', 'Loading the Earth …'), 0.05);
  requestAnimationFrame(frame);
  try {
    await Promise.all([loadEarth().then(() => ui.intro(null, 0.25)), loadToday().then(() => ui.intro(null, 0.4))]);
  } catch (err) {
    console.error(err);
    ui.intro(L('Die Weltdaten fehlen noch (assets/today). Bitte später noch einmal.', 'The world data is missing (assets/today). Please try again later.'), 0);
    return;
  }
  // Spielstand
  const o = (await serverLoad()) || localLoad();
  if (o && o.kind === 'today' && !Q.has('new')) {
    try { app.ts = deserializeToday(o); app.acc = app.ts.acc || 0; } catch (e) { console.error(e); app.ts = null; }
  }
  // Blick: aus dem All auf die Heimatstadt (oder Europa)
  const home = app.ts && app.ts.hero ? app.ts.hero.city : -1, C = TODAY.cities;
  const lon = home >= 0 ? C.lon[home] : 13.4, lat = home >= 0 ? C.lat[home] : 50;
  earth.setOrigin(lon, lat);
  ui.intro(L('Die Erde wird aufgebaut …', 'Building the Earth …'), 0.55);
  await earth.init(EARTH.bio, EARTH.W, EARTH.H, EARTH.meta.lon0);
  earth.buildLights(TODAY.cities);
  earth.setLandmarks(TODAY.landmarks);
  earth.ready = true;
  tg.set(0, 0, 0);
  stage.camera.position.set(0, 1.25e6, 9e5);
  stage.controls.update();
  ui.intro(null, 1);
  ui.build();
  if (app.ts) {
    const gap = app.ts.savedAt ? (Date.now() - app.ts.savedAt) / 1000 : 0;
    if (gap > 3) {
      ui.intro(L('Die Welt hat sich weitergedreht …', 'The world has kept turning …'), 1);
      catching = true;
      const info = await catchUp(gap, p => ui.intro(null, p));
      catching = false;
      app.pendingWelcome = info;
    }
    ui.ready(true);
  } else ui.ready(false);
  if (Q.has('auto')) app.start();
}
// Neue Erde heute: Heimatstadt und Mensch sind gewählt
app.newWorld = (cityIdx, pick) => {
  app.ts = createToday((Date.now() ^ (Math.random() * 1e9)) >>> 0, { city: cityIdx, pick });
  app.acc = 0;
  save(true);
};
app.start = () => {
  if (!app.ts) { const i = TODAY.cities.en.indexOf('Berlin'); app.newWorld(i >= 0 ? i : 0, 0); }
  app.running = true; last = performance.now(); lastWall = Date.now();
  ui.enterGame();
  if (app.pendingWelcome && app.pendingWelcome.days >= DPY) ui.welcomeBack(app.pendingWelcome);
  app.pendingWelcome = null;
  app.sound.start && app.sound.start();
  const h = app.ts.hero;
  if (h) { const C = TODAY.cities; app.flyToLL(C.lon[h.city], C.lat[h.city], Q.has('city') ? 70 : 2600); }
};
app.save = save;
app.MANA_MAX = MANA_MAX;
boot();
