// Zeitraffer: ein Ort (oder die ganze Welt) wächst noch einmal vor den Augen, von der Gründung bis heute.
// Gebäude erscheinen in der Reihenfolge, in der sie gebaut wurden (buildings.replay), die Kamera kreist,
// Jahreszahl und große Ereignisse laufen mit. Die Simulation pausiert so lange.
import { yearOf, dateStr } from '../sim/util.js';
import { L } from '../i18n.js';
import { ARCH } from '../sim/data.js';
import { NX, NY } from '../sim/world.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Timelapse {
  constructor(app, stage, buildings, people, animals) {
    Object.assign(this, { app, stage, buildings, people, animals });
    this.active = false;
    this.box = document.createElement('div');
    this.box.id = 'timelapse';
    document.body.append(this.box);
    window.addEventListener('keydown', e => { if (this.active && e.key === 'Escape') { e.stopImmediatePropagation(); this.stop(); } }, true);
  }

  start(sid) {
    const st = this.app.st;
    if (!st || this.active) return;
    if (this.app.ghost && this.app.ghost.active) this.app.ghost.exit();
    if (this.app.interior && this.app.interior.active) this.app.interior.close();
    const rt = st._rt, s = sid ? rt.sById.get(sid) : null;
    this.s = s;
    this.from = s ? s.founded : 0;
    this.to = st.day;
    const years = (this.to - this.from) / 24;
    this.dur = Math.max(14, Math.min(45, years * 0.18 + 10));
    this.t = 0; this.hold = 0;
    this.saved = { p: this.stage.camera.position.clone(), t: this.stage.controls.target.clone(), speed: this.app.speed, ctl: this.stage.controls.enabled };
    this.app.speed = 0;
    this.stage.controls.enabled = false;
    this.buildings.replay = { day: this.from };
    this.people.hidden = true; this.animals.hidden = true;
    // Große Ereignisse für die Untertitel
    this.events = st.chronicle.filter(c => c.d >= this.from && c.imp >= (s ? 1 : 2) && (!s || c.s === s.id)).map(c => ({ d: c.d, t: c.t }));
    this.ei = 0; this.caption = null;
    this.blds = st.buildings.filter(b => !s || b.s === s.id).map(b => b.d).sort((a, b) => a - b);
    this.angle = Math.atan2(this.saved.p.x - this.saved.t.x, this.saved.p.z - this.saved.t.z);
    this.active = true;
    document.body.classList.add('timelapse');
    this.box.innerHTML = `<div class="tl-head"><small>${L('Zeitraffer', 'Time-lapse')}</small><b>${esc(s ? s.name : L('Die ganze Welt', 'The whole world'))}</b></div>
      <div class="tl-year"></div><div class="tl-sub"></div><div class="tl-cap"></div>
      <div class="tl-bar"><i></i></div><button class="tl-skip">${L('Beenden', 'Stop')} <kbd>Esc</kbd></button>`;
    this.box.querySelector('.tl-skip').onclick = () => this.stop();
  }

  update(dt) {
    if (!this.active) return;
    const st = this.app.st, rt = st._rt;
    this.t += dt;
    const u = Math.min(1, this.t / this.dur);
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    const day = this.from + (this.to - this.from) * e;
    this.buildings.replay.day = day;
    // Kamera: kreist, und rückt mit der Stadt nach außen
    let n = 0; while (n < this.blds.length && this.blds[n] <= day) n++;
    const s = this.s;
    const cx = s ? s.cx - NX / 2 + 0.5 : ARCH / 2 - NX / 2, cz = s ? s.cy - NY / 2 + 0.5 : ARCH / 2 - NY / 2; // ohne Ort: Mitte des Archipels
    const grow = s ? 10 + Math.sqrt(n) * 2.6 : 115;
    this.angle += dt * 0.12;
    const cam = this.stage.camera;
    cam.position.set(cx + Math.sin(this.angle) * grow * 1.25, (s ? 7 : 60) + grow * 0.75, cz + Math.cos(this.angle) * grow * 1.25);
    this.stage.controls.target.set(cx, 0.6, cz);
    cam.lookAt(cx, 0.6, cz);
    // Anzeige
    this.box.querySelector('.tl-year').textContent = L(`Jahr ${yearOf(day)}`, `Year ${yearOf(day)}`);
    this.box.querySelector('.tl-sub').textContent = L(`${n} Gebäude`, `${n} ${n === 1 ? 'building' : 'buildings'}`);
    this.box.querySelector('.tl-bar i').style.width = (u * 100).toFixed(1) + '%';
    while (this.ei < this.events.length && this.events[this.ei].d <= day) {
      const ev = this.events[this.ei++];
      if (!this.caption || this.t - this.caption.t > 1.6) {
        this.caption = { t: this.t };
        const cap = this.box.querySelector('.tl-cap');
        cap.innerHTML = `<small>${esc(dateStr(ev.d))}</small>${esc(ev.t)}`;
        cap.classList.remove('show'); void cap.offsetWidth; cap.classList.add('show');
      }
    }
    if (u >= 1) { this.hold += dt; if (this.hold > 3) this.stop(); }
    void rt;
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.buildings.replay = null;
    this.people.hidden = false; this.animals.hidden = false;
    this.stage.camera.position.copy(this.saved.p);
    this.stage.controls.target.copy(this.saved.t);
    this.stage.controls.enabled = this.saved.ctl;
    this.stage.controls.update();
    this.app.speed = this.saved.speed;
    document.body.classList.remove('timelapse');
    this.box.innerHTML = '';
  }
}
