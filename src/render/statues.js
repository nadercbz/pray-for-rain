// Denkmäler für Legenden (26.11.2026). Stirbt ein berühmter Mensch (st.ancestors), setzt sein Ort ihm ein Denkmal:
// in frühen Zeiten einen Gedenkstein, ab den Stadtstaaten eine Statue. Die Modelle kommen aus Blender
// (tools/blender_statue.py, assets/models/denkmal.glb). Reine Anzeige, die Simulation weiß nichts davon.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { NX, NY, wx, wz } from './scene.js';
import { groundY } from './terrain.js';
import { L } from '../i18n.js';

const MAX = 24;
export class Statues {
  constructor(stage) {
    this.stage = stage; this.group = new THREE.Group(); this.group.name = 'denkmal';
    stage.scene.add(this.group);
    this.geo = null; this.sig = ''; this.list = []; this.lastT = -9;
    this.stone = new THREE.MeshStandardMaterial({ color: '#b9b3a6', roughness: 0.92, metalness: 0 });
    this.bronze = new THREE.MeshStandardMaterial({ color: '#6f8a72', roughness: 0.55, metalness: 0.55 });
    this.label = document.createElement('div'); this.label.id = 'denkmalTag'; document.body.append(this.label);
    new GLTFLoader().load('assets/models/denkmal.glb', g => {
      this.geo = {};
      g.scene.traverse(o => { if (o.isMesh) { const q = o.geometry.clone(); o.updateWorldMatrix(true, false); q.applyMatrix4(o.matrixWorld); q.computeVertexNormals(); this.geo[o.name] = q; } });
      this.sig = '';
    }, undefined, () => { this.geo = null; });
  }

  // freies Feld nahe der Ortsmitte, am liebsten auf dem Platz
  spot(st, s) {
    const T = st.tiles, rt = st._rt;
    let best = null, bs = -1;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = s.cx + dx, y = s.cy + dy;
      if (x < 1 || y < 1 || x >= NX - 1 || y >= NY - 1) continue;
      const i = y * NX + x, d = Math.hypot(dx, dy);
      if (d < 1.2 || d > 4.2 || rt.bldAt[i] || T.h[i] < 1 || T.river[i] || T.tree[i]) continue;
      const stv = T.st ? T.st[i] : 0;
      if (stv && !(stv & 8)) continue;          // nicht mitten auf der Straße
      const sc = (stv & 8 ? 10 : 0) + 5 - d + ((x * 7 + y * 13 + s.id) % 3) * 0.1;
      if (sc > bs) { bs = sc; best = [x, y]; }
    }
    return best;
  }

  sync(st, t) {
    if (!this.geo || t - this.lastT < 4) return;
    this.lastT = t;
    const rt = st._rt, want = [];
    const by = new Map();
    for (const a of st.ancestors) { const s = rt.sById.get(a.s); if (!s || !s.alive || (s.era | 0) < 1 || ((a.fame | 0) < 3 && !a.title)) continue; const o = by.get(s.id); if (!o || (a.fame | 0) > (o.fame | 0)) by.set(s.id, a); }
    for (const [sid, a] of by) { const s = rt.sById.get(sid); want.push({ s, a }); }
    want.sort((p, q) => (q.a.fame | 0) - (p.a.fame | 0)); want.length = Math.min(want.length, MAX);
    const sig = want.map(w => w.s.id + ':' + w.a.n + ':' + (w.s.era | 0) + ':' + w.s.cx + ',' + w.s.cy).join('|') + '#' + st.buildings.length;
    if (sig === this.sig) return;
    this.sig = sig;
    this.group.clear(); this.list = [];
    for (const w of want) {
      const p = this.spot(st, w.s); if (!p) continue;
      const era = w.s.era | 0, h = (w.a.n.length + w.s.id) % 2;
      const name = era < 3 ? 'gedenkstein' : h ? 'statue_stab' : 'statue_buch';
      const geo = this.geo[name]; if (!geo) continue;
      const m = new THREE.Mesh(geo, era >= 5 && h ? this.bronze : this.stone);
      const X = wx(p[0]), Z = wz(p[1]);
      m.position.set(X, groundY(X, Z), Z);
      m.rotation.y = Math.atan2(wx(w.s.cx) - X, wz(w.s.cy) - Z);   // blickt zur Ortsmitte
      m.scale.setScalar(era < 3 ? 1 : 1.15);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
      this.list.push({ sid: w.s.id, town: w.s.name, name: (w.a.title ? w.a.title + ' ' : '') + w.a.n, x: p[0], y: p[1], pos: m.position, stone: era < 3 });
    }
  }

  // Namensschild am nächsten Denkmal, wenn man nah genug ist
  // Ladung eines Handelsschiffs: was der eine Hafen übrig hat, gegen das, was der andere übrig hat
  cargo(st, S) {
    const rt = st._rt, A = rt.sById.get(S.a), B = rt.sById.get(S.b);
    if (!A || !B) return '';
    const N = { food: L('Getreide', 'grain'), wood: L('Holz', 'timber'), stone: L('Stein', 'stone'), ore: L('Erz', 'ore'), tools: L('Werkzeug', 'tools'), goods: L('Waren', 'goods') };
    const top = (s, not) => { let k = null, v = 0; for (const key in N) { const per = (s.stock[key] || 0) / (key === 'food' ? 6 : 1); if (key !== not && per > v) { v = per; k = key; } } return k; };
    const a = top(A), b = top(B, a);
    return L(`Handelsschiff ${A.name} und ${B.name}`, `Trade ship ${A.name} and ${B.name}`) + (a && b ? ' · ' + N[a] + L(' gegen ', ' for ') + N[b] : a ? ' · ' + N[a] : '');
  }

  update(st, t, hide, fleet) {
    this.sync(st, t);
    const cam = this.stage.camera, tg = this.stage.controls.target;
    let best = null, bd = 14;
    // Handelsschiff unter dem Blick
    if (!hide && fleet && cam.position.distanceTo(tg) < 40) for (const S of fleet) {
      const m = S.L && S.L.m; if (!m || !m.visible || S.fading) continue;
      const d = Math.hypot(m.position.x - tg.x, m.position.z - tg.z);
      if (d < 7 && d < bd) { bd = d; if (!S._tag || S._tagT !== (t / 5 | 0)) { S._tagT = t / 5 | 0; S._tag = { pos: m.position, ship: this.cargo(st, S) }; } best = S._tag; }
    }
    if (!best && !hide && cam.position.distanceTo(tg) < 34) for (const e of this.list) { const d = Math.hypot(e.pos.x - tg.x, e.pos.z - tg.z); if (d < bd) { bd = d; best = e; } }
    if (!best) { if (this.shown) { this.label.classList.remove('show'); this.shown = null; } return; }
    const v = this._v || (this._v = new THREE.Vector3());
    v.copy(best.pos); v.y += 0.85; v.project(cam);
    if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) { this.label.classList.remove('show'); this.shown = null; return; }
    if (this.shown !== best) { this.shown = best; this.label.textContent = best.ship ? best.ship : (best.stone ? L('Gedenkstein für ', 'Memorial stone for ') : L('Denkmal für ', 'Monument to ')) + best.name; this.label.classList.add('show'); }
    this.label.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2 * innerWidth).toFixed(1)}px, ${((1 - v.y) / 2 * innerHeight).toFixed(1)}px)`;
  }
}
