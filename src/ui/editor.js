// Baukasten (Level Editor, seit 20.10.2026, Naders Wunsch: eigene Karten bauen, Häuser selbst setzen, Level gestalten).
// Werkzeuge in fünf Gruppen (Gelände, Natur, Bauen, Menschen, Ansicht), Pinsel mit Größe, Rückgängig je Strich,
// Bibliothek eigener Level im Browser (pfr.levels, pfr.lvl.<id>), Datei sichern und laden, Testspielen und zurück.
// Bedienung: Maus links malt oder setzt, rechts schiebt die Kamera, Rad zoomt. Am Handy malt ein Finger, zwei Finger
// bewegen die Kamera (der eine Finger schiebt hier nicht, solange ein Werkzeug gewählt ist).
// Die Simulationsseite steht in src/sim/edit.js, die Regeln des Stadtplans in src/sim/cityplan.js.
import * as THREE from 'three';
import * as D from '../sim/data.js';
import { L } from '../i18n.js';
import { serialize, deserialize } from '../sim/core.js';
import { NX, NY, idx, inb } from '../sim/world.js';
import * as E from '../sim/edit.js';
import { FORMS, checkTown, blocksOf, frontOf, zoneOf, SQUARE, BUILT, TRACK, PLAZA } from '../sim/cityplan.js';
import { LANGS, placeName } from '../sim/names.js';
import { Rng } from '../sim/rng.js';
import * as LAB from '../sim/lab.js';

const LIB = 'pfr.levels', LVL = 'pfr.lvl.', DRAFT = 'pfr.lvl.draft';
const $ = s => document.querySelector(s);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Werkzeuge: k Art (brush malt im Kreis, line zieht Kachel für Kachel, click wirkt einmal), op für edit.brush
const TOOLS = {
  gelaende: { name: L('Gelände', 'Terrain'), tools: [
    { id: 'raise', k: 'brush', op: 'raise', name: L('Heben', 'Raise'), icon: '▲' },
    { id: 'lower', k: 'brush', op: 'lower', name: L('Senken', 'Lower'), icon: '▼' },
    { id: 'smooth', k: 'brush', op: 'smooth', name: L('Glätten', 'Smooth'), icon: '≈' },
    { id: 'flatten', k: 'brush', op: 'flatten', name: L('Ebnen', 'Flatten'), icon: '▬' },
    { id: 'land', k: 'brush', op: 'land', name: L('Land', 'Land'), icon: '◆' },
    { id: 'sea', k: 'brush', op: 'sea', name: L('Meer', 'Sea'), icon: '◇' },
  ] },
  natur: { name: L('Natur', 'Nature'), tools: [
    { id: 'forest', k: 'brush', op: 'forest', name: L('Wald', 'Forest'), icon: '♣' },
    { id: 'clear', k: 'brush', op: 'clear', name: L('Roden', 'Clear'), icon: '✂' },
    { id: 'biome', k: 'brush', op: 'biome', name: L('Lebensraum', 'Biome'), icon: '◐' },
    { id: 'fert', k: 'brush', op: 'fert', name: L('Fruchtbar', 'Fertile'), icon: '✿' },
    { id: 'ore', k: 'brush', op: 'ore', name: L('Erz', 'Ore'), icon: '⬢' },
    { id: 'river', k: 'line', name: L('Fluss', 'River'), icon: '∿' },
    { id: 'unriver', k: 'click', name: L('Fluss weg', 'Remove river'), icon: '⌫' },
  ] },
  bauen: { name: L('Bauen', 'Build'), tools: [
    { id: 'town', k: 'click', name: L('Siedlung', 'Settlement'), icon: '⌂' },
    { id: 'building', k: 'click', name: L('Gebäude', 'Building'), icon: '▣' },
    { id: 'street', k: 'line', name: L('Straße', 'Street'), icon: '═' },
    { id: 'square', k: 'line', name: L('Platz', 'Square'), icon: '▦' },
    { id: 'unstreet', k: 'line', name: L('Straße weg', 'Remove street'), icon: '⌫' },
    { id: 'rotate', k: 'click', name: L('Drehen', 'Rotate'), icon: '⟳' },
    { id: 'remove', k: 'click', name: L('Abreißen', 'Demolish'), icon: '✕' },
  ] },
  menschen: { name: L('Menschen', 'People'), tools: [
    { id: 'group', k: 'click', name: L('Ansiedeln', 'Settle people'), icon: '☺' },
    { id: 'plague', k: 'click', name: L('Seuche', 'Epidemic'), icon: '☣' },
    { id: 'faith', k: 'click', name: L('Glaube', 'Faith'), icon: '✦' },
    { id: 'lab', k: 'action', name: L('Labor', 'Lab'), icon: '⚗' },
  ] },
  ansicht: { name: L('Ansicht', 'View'), tools: [
    { id: 'camera', k: 'none', name: L('Kamera', 'Camera'), icon: '✋' },
    { id: 'rules', k: 'toggle', name: L('Regeln', 'Rules'), icon: '◫' },
  ] },
};
const TOOL = {};
for (const g of Object.values(TOOLS)) for (const t of g.tools) TOOL[t.id] = t;

const BUILDABLE = Object.keys(D.BUILDINGS).filter(t => t !== 'zentrum' && t !== 'rakete');

export class Editor {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.cat = 'gelaende';
    this.tool = 'raise';
    this.size = 3;
    this.opt = { biome: 0, building: 'haus', era: 0, cls: 2, n: 14, form: '', lang: 0, og: '', rl: '', cls2: 1, mg: 0, preset: 'beulenpest', share: 3, name: '' };
    this.undoS = []; this.redoS = [];
    this.stroke = null;
    this.showRules = false;
    this.dirty = false;
    this.touches = new Map();
    app.editor = this;
    this.css();
    this.scene3d();
    this.build();
    this.bindPointer();
    setInterval(() => { if (this.active && this.dirty) this.saveDraft(); }, 20000);
  }

  // ---------- Oberfläche ----------

  css() {
    if ($('#edCss')) return;
    const st = document.createElement('style');
    st.id = 'edCss';
    st.textContent = `
#ed { position: fixed; inset: 0; pointer-events: none; z-index: 30; display: none; font-family: var(--sans); color: var(--paper); text-shadow: var(--float-shadow); }
body.editing #ed { display: block; }
body.editing #dock, body.editing #prayers, body.editing #ticker, body.editing #top .chips, body.editing #top .right .seg, body.editing #top .mana, body.editing .hand-hint { display: none !important; }
#ed button { pointer-events: auto; }
#ed .ehead { position: absolute; left: 18px; top: 74px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; pointer-events: auto; max-width: calc(100vw - 36px); }
#ed .ehead input { pointer-events: auto; background: none; border: 0; border-bottom: 1px solid rgba(246,239,226,.3); color: var(--paper); font-family: var(--serif); font-size: 22px; padding: 2px 0; width: 230px; text-shadow: var(--float-shadow); }
#ed .ehead input:focus { outline: none; border-bottom-color: var(--gold2); }
#ed .ehead .kick { font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--gold2); width: 100%; }
#ed .ehead button { font-size: 13px; font-weight: 600; padding: 4px 2px; opacity: .88; }
#ed .ehead button:hover { opacity: 1; color: var(--gold2); }
#ed .ehead button.play { color: var(--gold2); }
#ed .ehead button:disabled { opacity: .35; cursor: default; }
#ed .ebar { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: auto; width: min(980px, calc(100vw - 24px)); }
#ed .ecats { display: flex; gap: 22px; }
#ed .ecats button { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: rgba(246,239,226,.62); padding: 4px 2px; position: relative; }
#ed .ecats button.on { color: var(--paper); }
#ed .ecats button.on::after { content: ''; position: absolute; left: 50%; bottom: -3px; width: 5px; height: 5px; margin-left: -2.5px; border-radius: 50%; background: var(--gold2); box-shadow: 0 0 8px var(--gold); }
#ed .etools { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
#ed .etools button { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 64px; padding: 6px 6px 4px; border-radius: 14px; font-size: 11.5px; color: rgba(246,239,226,.82); transition: background .15s, transform .15s; }
#ed .etools button i { font-style: normal; font-size: 20px; line-height: 22px; }
#ed .etools button:hover { transform: translateY(-2px); }
#ed .etools button.on { background: rgba(233,180,76,.2); color: var(--gold2); box-shadow: inset 0 0 0 1px rgba(233,180,76,.45); }
#ed .eopts { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px 16px; font-size: 12px; min-height: 26px; }
#ed .eopts label { display: flex; align-items: center; gap: 7px; color: rgba(246,239,226,.75); }
#ed .eopts select, #ed .eopts input[type=text], #ed .eopts input[type=number] { pointer-events: auto; background: rgba(10,18,24,.55); color: var(--paper); border: 1px solid rgba(246,239,226,.22); border-radius: 10px; padding: 4px 8px; font: inherit; max-width: 170px; }
#ed .eopts input[type=range] { pointer-events: auto; width: 110px; accent-color: #e9b44c; }
#ed .eopts .seg2 { display: flex; gap: 2px; }
#ed .eopts .seg2 button { padding: 3px 8px; border-radius: 999px; font-size: 12px; color: rgba(246,239,226,.6); }
#ed .eopts .seg2 button.on { color: var(--ink); background: var(--paper); text-shadow: none; }
#ed .einfo { position: absolute; right: 18px; top: 82px; text-align: right; font-size: 12px; line-height: 1.5; color: rgba(246,239,226,.82); max-width: 280px; }
#ed .einfo b { color: var(--paper); font-weight: 600; }
#ed .einfo .bad { color: #ff9d86; }
#ed .einfo .ok { color: #b9dba8; }
#ed .ehint { position: absolute; left: 50%; top: 136px; transform: translateX(-50%); font-size: 13px; color: var(--gold2); opacity: 0; transition: opacity .3s; text-align: center; max-width: 70vw; }
#ed .ehint.show { opacity: 1; }
.lvlist { display: flex; flex-direction: column; gap: 8px; max-height: 46vh; overflow: auto; margin: 10px 0; }
.lvrow { display: flex; align-items: center; gap: 12px; padding: 8px 4px; border-bottom: 1px solid rgba(43,38,32,.12); }
.lvrow .t { flex: 1; min-width: 0; }
.lvrow .t b { display: block; font-family: var(--serif); font-size: 16px; }
.lvrow .t small { color: rgba(43,38,32,.6); }
.lvrow button { font-size: 12.5px; font-weight: 600; color: #8a5a12; padding: 4px 6px; }
.lvkinds { display: flex; gap: 10px; flex-wrap: wrap; margin: 8px 0 4px; }
.lvkinds button { flex: 1 1 140px; text-align: left; padding: 10px 12px; border-radius: 14px; border: 1px solid rgba(43,38,32,.18); }
.lvkinds button b { display: block; font-family: var(--serif); font-size: 15px; }
.lvkinds button small { color: rgba(43,38,32,.62); font-size: 12px; }
.lvkinds button:hover { border-color: #c9922e; }
#btnEditor svg { stroke: var(--gold2); }
@media (max-width: 760px) {
  #ed .ehead { top: 96px; left: 12px; gap: 4px 10px; }
  #ed .ehead input { font-size: 18px; width: 170px; }
  #ed .einfo { display: none; }
  #ed .ehint { top: auto; bottom: 215px; max-width: 88vw; }
  #ed .eopts label.help { display: none; }
  #ed .ebar { bottom: max(8px, env(safe-area-inset-bottom)); gap: 6px; }
  #ed .ecats { gap: 14px; }
  #ed .etools { flex-wrap: nowrap; overflow-x: auto; justify-content: flex-start; width: 100%; padding: 0 6px; scrollbar-width: none; }
  #ed .etools button { min-width: 58px; min-height: 52px; }
  #ed .eopts { gap: 6px 10px; }
  #ed .eopts select, #ed .eopts input[type=text] { max-width: 130px; }
}
@media (max-height: 520px) and (orientation: landscape) {
  #ed .ehead { top: 58px; }
  #ed .ebar { bottom: 6px; gap: 4px; }
  #ed .etools button { min-height: 44px; padding: 3px 4px 2px; }
  #ed .etools button i { font-size: 17px; }
}`;
    document.head.append(st);
  }

  build() {
    const el = document.createElement('div');
    el.id = 'ed';
    el.innerHTML = `
      <div class="ehead">
        <span class="kick">${L('Baukasten', 'Level Editor')}</span>
        <input id="edName" type="text" maxlength="40" spellcheck="false">
        <button data-a="undo" title="${L('Rückgängig (Strg Z)', 'Undo (Ctrl Z)')}">↶ ${L('Zurück', 'Undo')}</button>
        <button data-a="redo" title="${L('Wiederholen (Strg Y)', 'Redo (Ctrl Y)')}">↷</button>
        <button data-a="save">${L('Speichern', 'Save')}</button>
        <button data-a="levels">${L('Meine Level', 'My levels')}</button>
        <button data-a="file">${L('Datei', 'File')}</button>
        <button data-a="play" class="play">▶ ${L('Spielen', 'Play')}</button>
        <button data-a="exit">${L('Beenden', 'Exit')}</button>
      </div>
      <div class="ehint"></div>
      <div class="einfo"></div>
      <div class="ebar">
        <div class="eopts"></div>
        <div class="etools"></div>
        <div class="ecats"></div>
      </div>`;
    document.body.append(el);
    this.el = el;
    el.querySelector('.ecats').innerHTML = Object.entries(TOOLS).map(([k, g]) => `<button data-c="${k}">${g.name}</button>`).join('');
    el.querySelectorAll('.ecats button').forEach(b => { b.onclick = () => this.setCat(b.dataset.c); });
    el.querySelectorAll('.ehead button').forEach(b => { b.onclick = () => this.action(b.dataset.a); });
    const nm = el.querySelector('#edName');
    nm.oninput = () => { if (this.app.st && this.app.st.level) { this.app.st.level.name = nm.value || L('Ohne Namen', 'Untitled'); this.dirty = true; } };
    window.addEventListener('keydown', e => {
      if (!this.active || e.target.closest('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) this.redo(); else this.undo(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); e.stopPropagation(); this.redo(); }
      else if (k === '[') this.setSize(this.size - 1);
      else if (k === ']') this.setSize(this.size + 1);
      else if (k === 'escape') { e.stopPropagation(); this.setTool('camera'); }
    }, true);
    this.setCat('gelaende');
  }

  setCat(c) {
    this.cat = c;
    this.el.querySelectorAll('.ecats button').forEach(b => b.classList.toggle('on', b.dataset.c === c));
    const tl = this.el.querySelector('.etools');
    tl.innerHTML = TOOLS[c].tools.map(t => `<button data-t="${t.id}"><i>${t.icon}</i>${t.name}</button>`).join('');
    tl.querySelectorAll('button').forEach(b => { b.onclick = () => this.setTool(b.dataset.t); });
    if (!TOOLS[c].tools.some(t => t.id === this.tool)) this.setTool(TOOLS[c].tools[0].id);
    else this.setTool(this.tool);
  }

  setTool(id) {
    const t = TOOL[id];
    if (!t) return;
    if (t.k === 'toggle') { this.showRules = !this.showRules; this.rulesDirty = true; this.paintTools(); this.hint(this.showRules ? L('Regeln an: grün freie Parzellen, gelb Höfe und Gärten, blau noch nicht erschlossen, weiß geplante Straßen, rot Verstöße.', 'Rules on: green free lots, yellow yards and gardens, blue not yet developed, white planned streets, red violations.') : L('Regeln aus.', 'Rules off.')); return; }
    if (t.k === 'action') { if (id === 'lab' && this.app.openLab) this.app.openLab(); return; }
    this.tool = id;
    this.paintTools();
    this.options();
    const S = this.app.stage;
    if (S && S.controls && S.controls.touches) S.controls.touches.ONE = t.k === 'none' ? THREE.TOUCH.PAN : null; // am Handy malt ein Finger
    this.ring.visible = false;
  }

  paintTools() {
    this.el.querySelectorAll('.etools button').forEach(b => b.classList.toggle('on', b.dataset.t === this.tool || (b.dataset.t === 'rules' && this.showRules)));
  }

  setSize(v) { this.size = Math.max(0, Math.min(10, v)); const r = this.el.querySelector('#edSize'); if (r) { r.value = this.size; r.nextElementSibling.textContent = this.size + 1; } }

  options() {
    const o = this.opt, st = this.app.st, t = TOOL[this.tool], box = this.el.querySelector('.eopts');
    const sel = (key, list) => `<select data-o="${key}">${list.map(([v, n]) => `<option value="${esc(v)}" ${String(o[key]) === String(v) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
    const eras = D.ERAS.map((e, k) => [k, e.name]);
    const langs = LANGS.map((_, k) => [k, placeName(new Rng(31 + k * 7), k) + ' ' + L('(Sprache ' + (k + 1) + ')', '(language ' + (k + 1) + ')')]);
    const origins = [['', L('Volk des Ortes', 'People of the place')], ...((st && st.origins) || []).map(g => [g.id, g.n])];
    const faiths = [['', L('Glaube des Ortes', 'Faith of the place')], ...((st && st.faiths) || []).map(f => [f.id, f.n])];
    let h = '';
    if (t.k === 'brush') h += `<label>${L('Größe', 'Size')} <input id="edSize" type="range" min="0" max="10" value="${this.size}"><span>${this.size + 1}</span></label>`;
    if (this.tool === 'flatten') h += `<label>${L('Höhe vom ersten Punkt des Strichs', 'Height from the first point of the stroke')}</label>`;
    if (this.tool === 'biome') h += `<label>${L('Lebensraum', 'Biome')} ${sel('biome', D.BIOMES.map((b, k) => [k, b.name]))}</label>`;
    if (this.tool === 'building') h += `<label>${L('Gebäude', 'Building')} ${sel('building', BUILDABLE.map(k => [k, D.BUILDINGS[k].name]).sort((a, b) => a[1].localeCompare(b[1])))}</label><label>${L('Epoche', 'Era')} ${sel('era', eras)}</label>`;
    if (this.tool === 'street') h += `<label>${L('Art', 'Kind')} <span class="seg2" data-o="cls">${[[1, L('Gasse', 'Lane')], [2, L('Straße', 'Street')], [3, L('Hauptstraße', 'Main road')]].map(([v, n]) => `<button data-v="${v}" class="${o.cls === v ? 'on' : ''}">${n}</button>`).join('')}</span></label>`;
    if (this.tool === 'town') h += `<label>${L('Name', 'Name')} <input type="text" data-o="name" value="${esc(o.name)}" placeholder="${L('zufällig', 'random')}"></label><label>${L('Menschen', 'People')} <input type="range" data-o="n" min="4" max="80" value="${o.n}"><span>${o.n}</span></label><label>${L('Epoche', 'Era')} ${sel('era', eras)}</label><label>${L('Stadtform', 'Town form')} ${sel('form', [['', L('nach Kultur und Gelände', 'by culture and terrain')], ...Object.entries(FORMS).map(([k, f]) => [k, f.name])])}</label><label>${L('Sprache', 'Language')} ${sel('lang', langs)}</label>`;
    if (this.tool === 'group') h += `<label>${L('Menschen', 'People')} <input type="range" data-o="n" min="2" max="60" value="${o.n}"><span>${o.n}</span></label><label>${L('Herkunft', 'Origin')} ${sel('og', origins)}</label><label>${L('Glaube', 'Faith')} ${sel('rl', faiths)}</label><label>${L('Schicht', 'Class')} ${sel('cls2', [[0, L('arm', 'poor')], [1, L('einfach', 'common')], [2, L('wohlhabend', 'well off')], [3, L('reich', 'rich')], [4, L('Adel', 'nobility')]])}</label><label>${L('Zugewandert', 'Immigrants')} ${sel('mg', [[0, L('nein', 'no')], [1, L('ja', 'yes')]])}</label>`;
    if (this.tool === 'plague') h += `<label>${L('Krankheit', 'Disease')} ${sel('preset', Object.entries(LAB.PRESETS || {}).map(([k, p]) => [k, p.n]))}</label><label>${L('Erste Fälle in Prozent', 'First cases in percent')} <input type="range" data-o="share" min="1" max="20" value="${o.share}"><span>${o.share}</span></label>`;
    if (this.tool === 'faith') h += `<label>${L('Name', 'Name')} <input type="text" data-o="fname" value="${esc(o.fname || '')}" placeholder="${L('zufällig', 'random')}"></label><label>${L('Anhänger in Prozent', 'Followers in percent')} <input type="range" data-o="fshare" min="5" max="100" value="${o.fshare || 30}"><span>${o.fshare || 30}</span></label>`;
    const help = {
      town: L('Klick aufs Land: eine Siedlung mit Platz, Stadtplan, Häusern und Menschen entsteht.', 'Click on land: a settlement with square, town plan, houses and people appears.'),
      building: L('Klick: Gebäude setzen. Es gehört zur nächsten Siedlung.', 'Click: place a building. It belongs to the nearest settlement.'),
      rotate: L('Klick auf ein Gebäude dreht es um 90 Grad.', 'Click a building to rotate it by 90 degrees.'),
      remove: L('Klick auf ein Gebäude reißt es ab, Klick auf das Zentrum entfernt die ganze Siedlung.', 'Click a building to demolish it, click the center to remove the whole settlement.'),
      river: L('Ziehen: ein Fluss entsteht entlang des Strichs, am besten bis ins Meer.', 'Drag: a river follows your stroke, best all the way to the sea.'),
      unriver: L('Klick auf einen Fluss entfernt ihn.', 'Click a river to remove it.'),
      group: L('Klick auf eine Siedlung: diese Menschen ziehen dort ein.', 'Click a settlement: these people move in there.'),
      plague: L('Klick auf eine Siedlung: die Seuche bricht dort aus.', 'Click a settlement: the epidemic breaks out there.'),
      faith: L('Klick auf eine Siedlung: ein neuer Glaube entsteht dort.', 'Click a settlement: a new faith arises there.'),
      camera: L('Kamera frei: ziehen dreht, rechts schiebt, Rad zoomt.', 'Free camera: drag rotates, right drag pans, wheel zooms.'),
      street: L('Ziehen: Straße von Hand, sofort gebaut. Häuser richten sich danach.', 'Drag: a street by hand, built at once. Houses face it.'),
      square: L('Ziehen: gepflasterter Platz.', 'Drag: a paved square.'),
    }[this.tool];
    if (help) h += `<label class="help" style="opacity:.75">${help}</label>`;
    box.innerHTML = h;
    const r = box.querySelector('#edSize');
    if (r) r.oninput = () => this.setSize(+r.value);
    box.querySelectorAll('select[data-o]').forEach(s => { s.onchange = () => { const v = s.value; o[s.dataset.o] = /^-?\d+$/.test(v) ? +v : v; }; });
    box.querySelectorAll('input[type=range][data-o]').forEach(s => { s.oninput = () => { o[s.dataset.o] = +s.value; s.nextElementSibling.textContent = s.value; }; });
    box.querySelectorAll('input[type=text][data-o]').forEach(s => { s.oninput = () => { o[s.dataset.o] = s.value; }; });
    box.querySelectorAll('.seg2').forEach(g => g.querySelectorAll('button').forEach(b => { b.onclick = () => { o[g.dataset.o] = +b.dataset.v; g.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); }; }));
  }

  hint(t) {
    const h = this.el.querySelector('.ehint');
    h.textContent = t;
    h.classList.add('show');
    clearTimeout(this.hintT);
    this.hintT = setTimeout(() => h.classList.remove('show'), 3800);
  }

  // ---------- 3D: Pinselring und Regel-Ansicht ----------

  scene3d() {
    const g = new THREE.RingGeometry(0.9, 1, 56);
    g.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.85, depthTest: false }));
    this.ring.renderOrder = 20;
    this.ring.visible = false;
    this.app.stage.scene.add(this.ring);
    const q = new THREE.PlaneGeometry(0.86, 0.86);
    q.rotateX(-Math.PI / 2);
    this.ovMax = 9000;
    this.ov = new THREE.InstancedMesh(q, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.42, depthWrite: false }), this.ovMax);
    this.ov.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.ovMax * 3), 3);
    this.ov.count = 0;
    this.ov.renderOrder = 12;
    this.ov.frustumCulled = false;
    this.ov.visible = false;
    this.app.stage.scene.add(this.ov);
    const tick = () => {
      if (this.active && this.showRules && (this.rulesDirty || performance.now() - (this.rulesAt || 0) > 1500)) this.drawRules();
      if (this.ov.visible !== (this.active && this.showRules)) this.ov.visible = this.active && this.showRules;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  drawRules() {
    const app = this.app, st = app.st;
    this.rulesDirty = false; this.rulesAt = performance.now();
    if (!st) return;
    const tg = app.stage.controls.target, cx = Math.round(tg.x + NX / 2 - 0.5), cy = Math.round(tg.z + NY / 2 - 0.5);
    const R = 36, S = st.tiles.st, rt = st._rt, H = st.tiles.h;
    const m = new THREE.Matrix4(), col = new THREE.Color();
    const bad = new Map();
    let viol = 0;
    const towns = st.settlements.filter(s => s.alive && s.plan && Math.hypot(s.cx - cx, s.cy - cy) < R + 30);
    const state = new Map();
    for (const s of towns) {
      const r = checkTown(st, s);
      for (const v of r.list) bad.set(idx(v.x, v.y), v);
      viol += ['r1', 'r2', 'r3', 'r5', 'r6', 'r7', 'r8', 'r9'].reduce((a, k) => a + r[k], 0);
      const B = blocksOf(st, s);
      for (const blk of B.list) for (const i of blk.tiles) state.set(i, blk.open ? 0 : blk.built ? 2 : 1);
    }
    let n = 0;
    for (let y = cy - R; y <= cy + R && n < this.ovMax; y++) for (let x = cx - R; x <= cx + R && n < this.ovMax; x++) {
      if (!inb(x, y) || H[idx(x, y)] < 0) continue;
      const i = idx(x, y);
      let c = null;
      if (bad.has(i)) c = 0xff5a3c;
      else if (S[i] && !(S[i] & BUILT)) c = 0xf2efe6;
      else if (S[i] & TRACK) c = null;
      else if (state.has(i) && !rt.bldAt[i]) {
        const k = state.get(i);
        if (k === 2) c = frontOf(st, x, y) >= 0 ? 0x7fd06a : 0xe9d27a;
        else if (k === 1) c = 0x7d9fe0;
      }
      if (c == null) continue;
      const X = x - NX / 2 + 0.5, Z = y - NY / 2 + 0.5;
      m.makeTranslation(X, app.groundY(X, Z) + 0.07, Z);
      this.ov.setMatrixAt(n, m);
      this.ov.setColorAt(n, col.setHex(c));
      n++;
    }
    this.ov.count = n;
    this.ov.instanceMatrix.needsUpdate = true;
    if (this.ov.instanceColor) this.ov.instanceColor.needsUpdate = true;
    this.viol = viol;
    this.info();
  }

  info(t) {
    const st = this.app.st;
    if (!st) return;
    const el = this.el.querySelector('.einfo');
    let h = '';
    if (t) {
      const i = idx(t.x, t.y), T = st.tiles, b = st._rt.bldAt[i] && st._rt.bById.get(st._rt.bldAt[i]);
      const bio = D.BIOMES[T.bio[i]] || D.BIOMES[0];
      h += `<b>${t.x}, ${t.y}</b> · ${L('Höhe', 'Height')} ${T.h[i]} · ${T.h[i] < 0 ? L('Wasser', 'Water') : bio.name}<br>`;
      if (T.h[i] >= 0) h += `${L('Bäume', 'Trees')} ${T.tree[i]} · ${L('Boden', 'Soil')} ${T.fert[i]}${T.ore[i] ? ' · ' + L('Erz', 'Ore') + ' ' + T.ore[i] : ''}${T.river[i] ? ' · ' + L('Fluss', 'River') : ''}<br>`;
      if (b) h += `<b>${D.BUILDINGS[b.t].name}</b> · ${(st._rt.sById.get(b.s) || {}).name || ''}<br>`;
      const s = E.settlementNear(st, t.x, t.y, 4);
      if (s && s.plan && T.h[i] >= 1) {
        const v = T.st[i];
        h += v ? (v & SQUARE ? L('Platz', 'Square') : [L('Weg', 'Path'), L('Gasse', 'Lane'), L('Straße', 'Street'), L('Hauptstraße', 'Main road')][v & 3] + (v & BUILT ? '' : ' ' + L('(geplant)', '(planned)'))) + '<br>' : frontOf(st, t.x, t.y) >= 0 ? L(`Parzelle · Nutzung: ${{ platz: 'am Platz', haupt: 'Hauptstraße', wohn: 'Wohnen', rand: 'Rand' }[zoneOf(st, s, t.x, t.y)]}`, `Lot · use: ${{ platz: 'on the square', haupt: 'main road', wohn: 'housing', rand: 'edge' }[zoneOf(st, s, t.x, t.y)]}`) + '<br>' : '';
      }
    }
    const towns = st.settlements.filter(s => s.alive);
    h += `${towns.length} ${L('Siedlungen', 'settlements')} · ${st.people.length} ${L('Menschen', 'people')}`;
    if (this.showRules && this.viol != null) h += `<br><span class="${this.viol ? 'bad' : 'ok'}">${this.viol ? L(`${this.viol} Regelverstöße im Blick`, `${this.viol} rule violations in view`) : L('Alle Regeln erfüllt', 'All rules met')}</span>`;
    el.innerHTML = h;
  }

  // ---------- Eingabe ----------

  bindPointer() {
    const app = this.app, canvas = app.stage.renderer.domElement;
    const tileOf = e => app.tileAt(e);
    const onDown = e => {
      if (!this.active || e.target !== canvas) return;
      const t = TOOL[this.tool];
      if (!t || t.k === 'none') return;
      if (e.pointerType === 'touch') {
        this.touches.set(e.pointerId, e);
        if (this.touches.size > 1) { this.cancelStroke(); return; } // zwei Finger: Kamera
        this.pend = { e, t0: performance.now() };
        clearTimeout(this.pendT);
        this.pendT = setTimeout(() => { if (this.pend && this.touches.size === 1) { this.startStroke(this.pend.e); this.pend = null; } }, 110);
        return; // Finger nicht abfangen, sonst kennt die Kamera den zweiten Finger nicht
      }
      if (e.button !== 0) return;
      e.stopPropagation(); e.preventDefault();
      this.startStroke(e);
    };
    const onMove = e => {
      if (!this.active || !app.st) return;
      if (e.pointerType === 'touch') { if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, e); if (this.touches.size > 1) return; }
      const t = e.target === canvas ? tileOf(e) : null;
      this.hover(t);
      if (this.stroke && t) { if (e.pointerType !== 'touch') e.stopPropagation(); this.moveStroke(t); }
      else if (this.pend && t && e.pointerType === 'touch' && Math.hypot(e.clientX - this.pend.e.clientX, e.clientY - this.pend.e.clientY) > 14 && this.touches.size === 1) { clearTimeout(this.pendT); this.startStroke(this.pend.e); this.pend = null; this.moveStroke(t); }
    };
    const onUp = e => {
      if (e.pointerType === 'touch') {
        this.touches.delete(e.pointerId);
        if (this.pend && this.touches.size === 0) { clearTimeout(this.pendT); const p = this.pend; this.pend = null; if (performance.now() - p.t0 < 400) { this.startStroke(p.e); this.endStroke(e); } return; }
      }
      if (!this.active || !this.stroke) return;
      if (e.pointerType !== 'touch') e.stopPropagation();
      this.endStroke(e);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', e => { this.touches.delete(e.pointerId); this.cancelStroke(); }, true);
  }

  hover(t) {
    const app = this.app, tool = TOOL[this.tool];
    this.info(t);
    if (!t || !tool || tool.k === 'none') { this.ring.visible = false; return; }
    const X = t.x - NX / 2 + 0.5, Z = t.y - NY / 2 + 0.5;
    const r = tool.k === 'brush' ? this.size + 0.5 : 0.55;
    this.ring.scale.setScalar(r);
    this.ring.position.set(X, Math.max(0, app.groundY(X, Z)) + 0.1, Z);
    this.ring.visible = true;
  }

  startStroke(e) {
    const t = this.app.tileAt(e);
    if (!t) return;
    const tool = TOOL[this.tool];
    this.snapshot();
    this.stroke = { tool, path: [], last: null, t0: performance.now(), lastApply: 0, x0: e.clientX, y0: e.clientY, flat: this.app.st.tiles.h[idx(t.x, t.y)], changedH: false, once: new Set() };
    if (tool.k !== 'click') this.moveStroke(t);
  }

  cancelStroke() {
    if (!this.stroke) return;
    this.stroke = null;
    this.undo(true); // den angefangenen Strich zurücknehmen
  }

  // 4er Linie zwischen zwei Kacheln (damit beim schnellen Ziehen keine Lücken entstehen)
  line(a, b) {
    const out = [];
    let x = a.x, y = a.y;
    out.push([x, y]);
    while (x !== b.x || y !== b.y) { const dx = b.x - x, dy = b.y - y; if (Math.abs(dx) >= Math.abs(dy)) x += Math.sign(dx); else y += Math.sign(dy); out.push([x, y]); }
    return out;
  }

  moveStroke(t) {
    const S = this.stroke, st = this.app.st, tool = S.tool, now = performance.now();
    if (tool.k === 'click') return;
    const same = S.last && S.last.x === t.x && S.last.y === t.y;
    if (tool.k === 'brush') {
      if (same && now - S.lastApply < 420) return;
      if (same) S.once.clear(); // stillhalten: noch eine Stufe
      const pts = S.last && !same ? this.line(S.last, t).filter((_, k, a) => k === a.length - 1 || k % Math.max(1, this.size) === 0) : [[t.x, t.y]];
      let n = 0;
      const R = this.size + 2;
      for (const [x, y] of pts) {
        const k = E.brush(st, tool.op, x, y, this.size + 0.5, tool.op === 'flatten' ? S.flat : tool.op === 'biome' ? this.opt.biome : undefined, S.once);
        n += k;
        if (k && E.HEIGHT_OPS.has(tool.op)) { const b = [x - R, x + R, y - R, y + R]; S.box = S.box ? [Math.min(S.box[0], b[0]), Math.max(S.box[1], b[1]), Math.min(S.box[2], b[2]), Math.max(S.box[3], b[3])] : b; E.growBox(st, b); }
      }
      if (n) { this.dirty = true; if (E.HEIGHT_OPS.has(tool.op)) S.changedH = true; this.live(S.changedH); }
      S.lastApply = now;
    } else if (tool.k === 'line') {
      if (same) return;
      const pts = S.last ? this.line(S.last, t).slice(1) : [[t.x, t.y]];
      for (const [x, y] of pts) {
        S.path.push(idx(x, y));
        if (this.tool === 'street') E.paintStreet(st, x, y, this.opt.cls);
        else if (this.tool === 'square') E.paintStreet(st, x, y, 'platz');
        else if (this.tool === 'unstreet') E.paintStreet(st, x, y, 0);
      }
      if (this.tool !== 'river') { this.dirty = true; this.live(false); }
    }
    S.last = t;
  }

  // Zwischenbild während des Strichs: Farben sofort, das Gelände im bemalten Ausschnitt höchstens alle 0,12 s
  // (main.js refreshWorld baut über rt.dirtyBox nur dort Gelände und Wasser neu, rund 30 ms)
  live(height) {
    const app = this.app, now = performance.now();
    if (height) {
      if (now - (this.lastBuild || 0) < 90) return; // der Kasten bleibt in rt.dirtyBox und kommt beim nächsten Mal mit
      this.lastBuild = now;
      app.st._rt.dirtyQuick = true;
    }
    app.colorsDirty = true;
    app.refreshWorld(false);
    this.rulesDirty = true;
  }

  endStroke(e) {
    const S = this.stroke, app = this.app, st = app.st;
    this.stroke = null;
    if (!S) return;
    const t = app.tileAt(e) || S.last;
    let msg = null, ok = true;
    if (S.tool.k === 'click' && t) {
      const r = this.click(t);
      if (r && r.err) { msg = r.err; ok = false; } else if (r && r.msg) msg = r.msg;
      if (r === false) ok = false;
    }
    if (this.tool === 'river') { ok = E.addRiver(st, S.path); if (!ok) msg = L('Der Fluss ist zu kurz.', 'The river is too short.'); }
    if (!ok) { this.undo(true); if (msg) this.hint(msg); return; }
    if (msg) this.hint(msg);
    if (S.changedH) E.afterTerrain(st, S.box);
    this.dirty = true;
    app.colorsDirty = true; app.scatterNow = true;
    app.refreshWorld(true);
    this.rulesDirty = true;
    this.info();
    if (this.app.ui) this.app.ui.update(st, 0.5, true);
  }

  click(t) {
    const app = this.app, st = app.st, o = this.opt;
    switch (this.tool) {
      case 'town': {
        const r = E.foundTown(st, t.x, t.y, { n: o.n, era: o.era, form: o.form || undefined, lang: o.lang, name: o.name || undefined });
        if (r.err) return r;
        o.name = '';
        this.options();
        return { msg: L(`${r.s.name} ist gegründet: ${r.s.pop || o.n} Menschen, ${FORMS[r.s.plan.f].name}.`, `${r.s.name} is founded: ${r.s.pop || o.n} people, ${FORMS[r.s.plan.f].name.toLowerCase()}.`) };
      }
      case 'building': return E.placeBuilding(st, o.building, t.x, t.y, o.era);
      case 'rotate': return E.rotateAt(st, t.x, t.y) ? {} : { err: L('Hier steht kein Gebäude.', 'There is no building here.') };
      case 'remove': return E.removeAt(st, t.x, t.y) ? {} : { err: L('Hier steht nichts.', 'Nothing stands here.') };
      case 'unriver': return E.removeRiverAt(st, t.x, t.y, 1) ? {} : { err: L('Hier fließt kein Fluss.', 'No river flows here.') };
      case 'group': case 'plague': case 'faith': {
        const s = E.settlementNear(st, t.x, t.y, 6);
        if (!s) return { err: L('Klicke auf eine Siedlung.', 'Click on a settlement.') };
        if (this.tool === 'group') {
          const made = E.addPeople(st, s, o.n, { og: o.og === '' ? undefined : o.og, rl: o.rl === '' ? undefined : o.rl, cls: o.cls2, mg: o.mg });
          return { msg: L(`${made.length} Menschen ziehen nach ${s.name}.`, `${made.length} people move to ${s.name}.`) };
        }
        if (this.tool === 'plague') {
          if (!LAB.startEpidemic) return { err: L('Die Gesellschaftsschicht fehlt.', 'The society layer is missing.') };
          const dz = LAB.startEpidemic(st, s, o.preset, { share: o.share / 100 });
          return { msg: dz ? L(`${dz.n} bricht in ${s.name} aus.`, `${dz.n} breaks out in ${s.name}.`) : L('Niemand steckt sich an.', 'Nobody catches it.') };
        }
        if (!LAB.foundFaith) return { err: L('Die Gesellschaftsschicht fehlt.', 'The society layer is missing.') };
        const f = LAB.foundFaith(st, s, { name: o.fname || undefined, share: (o.fshare || 30) / 100 });
        return { msg: f ? L(`In ${s.name} entsteht ein neuer Glaube: ${f.n}.`, `A new faith arises in ${s.name}: ${f.n}.`) : null };
      }
      default: return null;
    }
  }

  // ---------- Rückgängig ----------

  snapshot() {
    try { this.undoS.push(serialize(this.app.st)); } catch { return; }
    if (this.undoS.length > 25) this.undoS.shift();
    this.redoS.length = 0;
    this.heads();
  }
  restore(json) {
    const app = this.app, cam = app.stage.camera.position.clone(), tg = app.stage.controls.target.clone();
    const st = deserialize(json);
    app.setWorld(st);
    app.running = false;
    app.stage.camera.position.copy(cam); app.stage.controls.target.copy(tg); app.stage.controls.update();
    this.el.querySelector('#edName').value = st.level ? st.level.name : '';
    this.rulesDirty = true;
  }
  undo(silent) {
    if (!this.undoS.length) return;
    const cur = serialize(this.app.st);
    const prev = this.undoS.pop();
    if (!silent) this.redoS.push(cur);
    this.restore(prev);
    this.heads();
  }
  redo() {
    if (!this.redoS.length) return;
    this.undoS.push(serialize(this.app.st));
    this.restore(this.redoS.pop());
    this.heads();
  }
  heads() {
    const u = this.el.querySelector('[data-a=undo]'), r = this.el.querySelector('[data-a=redo]');
    if (u) u.disabled = !this.undoS.length;
    if (r) r.disabled = !this.redoS.length;
  }

  // ---------- Öffnen, Schließen, Spielen ----------

  open(st) {
    const app = this.app;
    if (st) { app.setWorld(st); this.undoS.length = 0; this.redoS.length = 0; }
    if (!app.st.level) app.st.level = { id: 'lv' + Date.now().toString(36), name: L('Mein Level', 'My level'), desc: '', kind: 'welt', created: Date.now() };
    this.active = true;
    app.running = false;
    document.body.classList.add('editing');
    this.el.querySelector('#edName').value = app.st.level.name;
    this.setCat(this.cat);
    this.heads();
    this.rulesDirty = true;
    if (app.ui && app.ui.closeLeft) app.ui.closeLeft();
    this.info();
  }

  close() {
    this.active = false;
    this.cancelStroke();
    document.body.classList.remove('editing');
    this.ring.visible = false;
    const S = this.app.stage;
    if (S.controls.touches) S.controls.touches.ONE = THREE.TOUCH.PAN;
  }

  async action(a) {
    const app = this.app, ui = app.ui;
    if (a === 'undo') return this.undo();
    if (a === 'redo') return this.redo();
    if (a === 'save') { this.saveLevel(); return; }
    if (a === 'levels') return this.library();
    if (a === 'file') {
      return ui.modal(`<h2>${L('Level als Datei', 'Level as a file')}</h2><p>${L('Sichere dein Level als Datei, um es aufzuheben oder weiterzugeben, oder lade eine Level-Datei.', 'Save your level as a file to keep or share it, or load a level file.')}</p>`,
        [[L('Als Datei sichern', 'Save to file'), () => this.exportFile()], [L('Datei laden', 'Load file'), () => this.importFile()], [L('Abbrechen', 'Cancel'), null]]);
    }
    if (a === 'play') return this.play();
    if (a === 'exit') {
      return ui.modal(`<h2>${L('Baukasten beenden?', 'Leave the editor?')}</h2><p>${L('Dein Level bleibt in "Meine Level". Die Inselwelt läuft weiter, wie du sie verlassen hast.', 'Your level stays in "My levels". The island world continues as you left it.')}</p>`,
        [[L('Speichern und zur Inselwelt', 'Save and go to the island world'), () => { this.saveLevel(true); app.leaveLevel(); }], [L('Weiter bauen', 'Keep building'), null]]);
    }
  }

  play() {
    const app = this.app, st = app.st, warn = E.checkLevel(st);
    const go = () => {
      this.saveLevel(true);
      st.savedAt = Date.now();
      app.acc = 0;
      this.close();
      app.running = true;
      if (app.save) app.save(true);
      app.ui.toast(L('Das Level läuft. Mit dem Hammer oben rechts kommst du zurück in den Baukasten.', 'The level is running. The hammer at the top right takes you back to the editor.'), 'god');
    };
    if (warn.length) app.ui.modal(`<h2>${L('Vor dem Spielen', 'Before playing')}</h2><p>${warn.map(esc).join('<br>')}</p>`, [[L('Trotzdem spielen', 'Play anyway'), go], [L('Weiter bauen', 'Keep building'), null]]);
    else go();
  }

  // aus dem laufenden Level zurück: zum gespeicherten Entwurf oder diesen Stand weiterbauen
  back() {
    const app = this.app, id = app.st && app.st.level && app.st.level.id;
    const saved = id && this.loadJson(id);
    app.ui.modal(`<h2>${L('Zurück in den Baukasten', 'Back to the editor')}</h2><p>${L('Willst du am gespeicherten Entwurf weiterbauen oder am Stand, den das Spiel gerade erreicht hat?', 'Do you want to continue with the saved draft or with the state the game has reached now?')}</p>`,
      [...(saved ? [[L('Gespeicherter Entwurf', 'Saved draft'), () => this.open(deserialize(saved))]] : []), [L('Dieser Stand', 'This state'), () => this.open()], [L('Abbrechen', 'Cancel'), null]]);
  }

  // ---------- Bibliothek ----------

  list() { try { return JSON.parse(localStorage.getItem(LIB) || '[]'); } catch { return []; } }
  loadJson(id) { try { return localStorage.getItem(LVL + id); } catch { return null; } }

  saveLevel(quiet) {
    const st = this.app.st;
    if (!st || !st.level) return false;
    st.level.updated = Date.now();
    const json = serialize(st), info = E.levelInfo(st);
    try {
      localStorage.setItem(LVL + st.level.id, json);
      const L0 = this.list().filter(x => x.id !== info.id);
      L0.unshift(info);
      localStorage.setItem(LIB, JSON.stringify(L0));
      localStorage.removeItem(DRAFT);
      this.dirty = false;
      if (!quiet) this.hint(L(`Gespeichert: ${st.level.name}`, `Saved: ${st.level.name}`));
      return true;
    } catch {
      this.app.ui.toast(L('Der Browser-Speicher ist voll. Sichere das Level als Datei.', 'Browser storage is full. Save the level as a file.'), 'warn');
      return false;
    }
  }

  saveDraft() {
    try { localStorage.setItem(DRAFT, serialize(this.app.st)); this.dirty = false; } catch { /* zu groß: nur über Speichern */ }
  }

  library() {
    const app = this.app, ui = app.ui, items = this.list();
    const when = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const kinds = Object.entries(E.KINDS).map(([k, v]) => `<button data-new="${k}"><b>${v.name}</b><small>${v.info}</small></button>`).join('');
    let mine = false;
    try { mine = !!localStorage.getItem('builtitup.world.v1'); } catch { /* egal */ }
    ui.modal(`<h2>${L('Meine Level', 'My levels')}</h2>
      <p class="muted">${L('Neues Level aus einer Vorlage:', 'New level from a template:')}</p>
      <div class="lvkinds">${kinds}${mine ? `<button data-new="mine"><b>${L('Meine Inselwelt', 'My island world')}</b><small>${L('Eine Kopie deiner Welt als Vorlage, das Original bleibt unberührt', 'A copy of your world as a template, the original stays untouched')}</small></button>` : ''}</div>
      <div class="lvlist">${items.length ? items.map(x => `<div class="lvrow"><div class="t"><b>${esc(x.name)}</b><small>${x.towns} ${L('Siedlungen', 'settlements')} · ${x.people} ${L('Menschen', 'people')} · ${when(x.updated)}</small></div><button data-ed="${x.id}">${L('Bauen', 'Edit')}</button><button data-pl="${x.id}">${L('Spielen', 'Play')}</button><button data-ex="${x.id}">${L('Datei', 'File')}</button><button data-del="${x.id}">${L('Löschen', 'Delete')}</button></div>`).join('') : `<p class="muted">${L('Noch keine gespeicherten Level.', 'No saved levels yet.')}</p>`}</div>`,
    [[L('Schließen', 'Close'), null]]);
    const m = $('#modal');
    const close = () => { m.className = ''; };
    m.querySelectorAll('[data-new]').forEach(b => { b.onclick = () => { close(); this.newLevel(b.dataset.new); }; });
    m.querySelectorAll('[data-ed]').forEach(b => { b.onclick = () => { const j = this.loadJson(b.dataset.ed); close(); if (j) this.open(deserialize(j)); }; });
    m.querySelectorAll('[data-pl]').forEach(b => { b.onclick = () => { const j = this.loadJson(b.dataset.pl); close(); if (j) { this.open(deserialize(j)); this.play(); } }; });
    m.querySelectorAll('[data-ex]').forEach(b => { b.onclick = () => { const j = this.loadJson(b.dataset.ex); if (j) this.download(j, (items.find(x => x.id === b.dataset.ex) || {}).name); }; });
    m.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = () => {
        const x = items.find(q => q.id === b.dataset.del);
        ui.modal(`<h2>${L('Level löschen?', 'Delete level?')}</h2><p>${L(`"${esc(x.name)}" verschwindet aus dem Browser. Eine gesicherte Datei bleibt erhalten.`, `"${esc(x.name)}" disappears from the browser. A saved file is kept.`)}</p>`,
          [[L('Löschen', 'Delete'), () => { try { localStorage.removeItem(LVL + x.id); localStorage.setItem(LIB, JSON.stringify(this.list().filter(q => q.id !== x.id))); } catch { /* egal */ } this.library(); }], [L('Abbrechen', 'Cancel'), () => this.library()]]);
      };
    });
  }

  newLevel(kind) {
    let st;
    if (kind === 'mine') {
      try { st = deserialize(localStorage.getItem('builtitup.world.v1')); } catch { this.app.ui.toast(L('Deine Welt ließ sich nicht lesen.', 'Your world could not be read.'), 'warn'); return; }
      st.level = { id: 'lv' + Date.now().toString(36), name: L('Kopie meiner Welt', 'Copy of my world'), desc: '', kind: 'mine', created: Date.now() };
    } else st = E.newLevel(kind, (Date.now() ^ (Math.random() * 1e9)) >>> 0, E.KINDS[kind] ? E.KINDS[kind].name : '');
    this.open(st);
    const s = st.settlements.find(o => o.alive);
    const c = s || (st.isles[0] ? { cx: st.isles[0].cx, cy: st.isles[0].cy } : { cx: NX / 2, cy: NY / 2 });
    this.app.focus(c.cx, c.cy, kind === 'archipel' ? 90 : 60);
    this.hint(kind === 'leer' ? L('Wähle "Land" und male deine erste Insel.', 'Choose "Land" and paint your first island.') : L('Forme das Land, dann gründe unter "Bauen" eine Siedlung.', 'Shape the land, then found a settlement under "Build".'));
  }

  download(json, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `pray-for-rain-level-${String(name || 'level').toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  exportFile() { this.saveLevel(true); this.download(serialize(this.app.st), this.app.st.level.name); }
  importFile() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      try {
        const o = JSON.parse(await f.text());
        if (o.earth) throw new Error('erde');
        const st = deserialize(o);
        if (!st.level) st.level = { id: 'lv' + Date.now().toString(36), name: f.name.replace(/\.json$/, ''), desc: '', kind: 'datei', created: Date.now() };
        else st.level.id = st.level.id || 'lv' + Date.now().toString(36);
        this.open(st);
        this.saveLevel();
      } catch { this.app.ui.toast(L('Diese Datei ist kein Level.', 'This file is not a level.'), 'warn'); }
    };
    inp.click();
  }
}

// Knopf mit dem Hammer oben rechts (nur in der Level-Welt): zurück in den Baukasten
export function editorButton(app) {
  const icons = document.querySelector('#top .icons');
  if (!icons || document.querySelector('#btnEditor')) return;
  const b = document.createElement('button');
  b.id = 'btnEditor';
  b.title = L('Baukasten', 'Level editor');
  b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4.5l5 5-2 2-5-5z M12.5 6.5L4 15v5h5l8.5-8.5"/></svg>';
  b.onclick = () => { if (app.editor.active) return; app.editor.back(); };
  icons.prepend(b);
}

export { E as edit, DRAFT };
