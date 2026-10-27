// Oberfläche: Kopfleiste, Kräfte, Chronik, Inselbuch, Gebete, Inspektor, Fenster.
import * as D from '../sim/data.js';
import { dateStr, ageOf, yearOf, seasonOf } from '../sim/util.js';
import { techCost } from '../sim/core.js';
import { L, LANG, setLang } from '../i18n.js';
import { peopleTab, economyTab, personBlocks, settlementEconomy } from './book.js';
import { openDiary, diaryButtons } from './diary_ui.js';
import { startDiary } from '../sim/diary.js';
import { voiceOn, setVoiceOn } from './voice.js';
import { faceOf } from './faces.js';
import { tourOff, setTourOff, resetTour, startTour } from './tour.js';
import { societyTab, injectSocietyCss } from './society_ui.js';
import { militaryTab, PACT_NAME } from './military_ui.js';
import { statesTab, officesHtml } from './states_ui.js';
import { progName, progCost } from '../sim/progress.js';
import { toggleLab } from './lab_ui.js';

const $ = (s, el = document) => el.querySelector(s);
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = v => Math.round(v * 100) + '%';
const bar = (v, cls = '') => `<div class="mbar ${cls}"><i style="width:${Math.max(0, Math.min(100, v * 100)).toFixed(0)}%"></i></div>`;
const plural = (n, one, many) => (n === 1 ? one : many);
// Tempo mit Tausenderpunkt (Deutsch) oder Komma (Englisch): 10.000×
const speedLabel = sp => (sp >= 10000 ? L(sp.toLocaleString('de-DE'), sp.toLocaleString('en-US')) : String(sp)) + '×';
// Zahl mit Einheit: dur(3, 'Tag', 'Tage', 'day', 'days') ergibt "3 Tage" oder "3 days"
const dur = (n, de1, deN, en1, enN) => L(`${n} ${n === 1 ? de1 : deN}`, `${n} ${n === 1 ? en1 : enN}`);

export const CARD = id => `assets/cards/${id}.webp`;
const KIND_FILTER = { gott: 'gott', deutung: 'gott', mythos: 'gott', gebet: 'gott', geburt: 'leben', tod: 'leben', fest: 'leben', leben: 'leben', gruendung: 'leben', fremde: 'leben', natur: 'leben', glaube: 'gott', seuche: 'leben', wanderung: 'leben', politik: 'politik', krieg: 'krieg', piraten: 'krieg', wissen: 'wissen', epoche: 'wissen', bau: 'wissen', fund: 'wissen', erkundung: 'wissen' };
const KIND_LABEL = {
  gott: L('Geist', 'Spirit'), deutung: L('Deutung', 'Interpretation'), mythos: L('Mythos', 'Myth'), gebet: L('Gebet', 'Prayer'), geburt: L('Leben', 'Life'),
  tod: L('Tod', 'Death'), fest: L('Fest', 'Feast'), leben: L('Leben', 'Life'), gruendung: L('Gründung', 'Founding'), fremde: L('Fremde', 'Strangers'), natur: L('Natur', 'Nature'),
  politik: L('Politik', 'Politics'), krieg: L('Krieg', 'War'), wissen: L('Wissen', 'Knowledge'), epoche: L('Epoche', 'Era'), bau: L('Bau', 'Building'),
  piraten: L('Piraten', 'Pirates'), fund: L('Fund', 'Discovery'),
  glaube: L('Glaube', 'Faith'), seuche: L('Seuche', 'Epidemic'), wanderung: L('Wanderung', 'Migration'),
};
const POWER_VERB = {
  regen: L('um Regen', 'for rain'), sonne: L('um Sonne', 'for sunshine'), segen: L('um Segen für die Felder', 'for a blessing on the fields'), heilung: L('um Heilung', 'for healing'),
  nebel: L('um Schutz im Nebel', 'for shelter in the fog'), regenbogen: L('um ein Zeichen des Friedens', 'for a sign of peace'), fische: L('um Fische', 'for fish'),
  funke: L('um Erkenntnis', 'for insight'), komet: L('um ein Zeichen', 'for a sign'),
};
const WEATHER_NAME = { klar: L('Klar', 'Clear'), wolkig: L('Bewölkt', 'Cloudy'), regen: L('Regen', 'Rain'), sturm: L('Sturm', 'Storm'), schnee: L('Schnee', 'Snow'), nebel: L('Nebel', 'Fog') };
const TARGET_TXT = {
  global: L('Wirkt auf die ganze Insel', 'Affects the whole island'), person: L('Ziel: ein Mensch', 'Target: a person'), settlement: L('Ziel: eine Siedlung', 'Target: a settlement'),
  mountain: L('Ziel: ein Berg', 'Target: a mountain'), coast: L('Ziel: eine Küste', 'Target: a coast'), point: L('Ziel: ein Ort', 'Target: a place'),
};
// Die Simulation speichert Todesursachen als deutsche Kürzel, hier erst bei der Anzeige übersetzt
const CAUSE_NAME = {
  Alter: L('Alter', 'Old age'), Fieber: L('Fieber', 'Fever'), Hunger: L('Hunger', 'Hunger'), 'Schwäche': L('Schwäche', 'Frailty'), 'Unglück': L('Unglück', 'Accident'),
  See: L('See', 'At sea'), Blitz: L('Blitz', 'Lightning'), Flut: L('Flut', 'Flood'), Vertreibung: L('Vertreibung', 'Exile'),
  'beim Beben': L('beim Beben', 'In the earthquake'), 'unter der Lava': L('unter der Lava', 'Under the lava'), 'beim Einschlag': L('beim Einschlag', 'In the meteor strike'), 'Wölfe': L('von Wölfen gerissen', 'Killed by wolves'),
  Krieg: L('Krieg', 'War'), Aufstand: L('Aufstand', 'Uprising'), Seuche: L('Seuche', 'Plague'), Streit: L('im Streit erschlagen', 'Killed in a quarrel'), Verfolgung: L('verfolgt und erschlagen', 'Killed in persecution'),
};
const causeName = c => CAUSE_NAME[c] || c;
// Pixar Gesicht als kleines Bild in der Personenkarte (Standbild, die Karte baut sich alle 2 s neu)
function faceAvatar(st, p) {
  const f = faceOf(st, p);
  return `<img src="${f.video ? f.poster : f.still}" alt="">`;
}
const QUALITY_NAME = { hoch: L('hoch', 'high'), mittel: L('mittel', 'medium'), niedrig: L('niedrig', 'low') };

export class UI {
  constructor(app) {
    this.app = app;
    this.filter = 'alle';
    this.chronSeen = 0;
    this.leftTab = 'siedlungen';
    this.detail = null;
    this.inspect = null;
    this.cat = 'wetter';
    this.dreamTheme = null;
    this.lastHeavy = 0;
    this.build();
  }

  build() {
    // Kräfte-Dock
    const dock = $('#dock');
    const tabs = h('div', 'dock-tabs');
    for (const [k, name] of Object.entries(D.POWER_CATS)) {
      const b = h('button', 'dtab' + (k === this.cat ? ' on' : ''), name);
      b.onclick = () => { this.cat = k; tabs.querySelectorAll('.dtab').forEach(x => x.classList.toggle('on', x === b)); this.renderCards(); };
      tabs.append(b);
    }
    dock.append(tabs, h('div', 'cards'));
    this.renderCards();
    // Chronik-Filter
    const f = $('#chron .filters');
    for (const [k, n] of [['alle', L('Alle', 'All')], ['gott', L('Geist', 'Spirit')], ['leben', L('Leben', 'Life')], ['politik', L('Politik', 'Politics')], ['krieg', L('Krieg', 'War')], ['wissen', L('Wissen', 'Knowledge')]]) {
      const b = h('button', k === this.filter ? 'on' : '', n);
      b.onclick = () => { this.filter = k; f.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); this.renderChron(true); };
      f.append(b);
    }
    // Inselbuch-Tabs
    const lt = $('#left .tabs');
    for (const [k, n] of [['siedlungen', L('Siedlungen', 'Settlements')], ['menschen', L('Menschen', 'People')], ['wirtschaft', L('Wirtschaft', 'Economy')], ['gesellschaft', L('Gesellschaft', 'Society')], ['militaer', L('Militär', 'Military')], ['staaten', L('Staaten', 'States')], ['inseln', L('Inseln', 'Islands')], ['wissen', L('Wissen', 'Knowledge')], ['mythen', L('Mythen', 'Myths')], ['verlauf', L('Verlauf', 'History')]]) {
      const b = h('button', k === this.leftTab ? 'on' : '', n);
      b.onclick = () => { this.leftTab = k; this.detail = null; lt.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); this.renderLeft(true); };
      lt.append(b);
    }
    $('#btnChron').onclick = () => document.body.classList.toggle('chron-open');
    // Labor (lab_ui.js): Knopf oben und im Reiter Gesellschaft
    this.app.openLab = () => toggleLab(this.app, true);
    if ($('#btnLab')) $('#btnLab').onclick = () => toggleLab(this.app);
    injectSocietyCss();
    $('#btnIsland').onclick = () => { document.body.classList.toggle('left-open'); this.renderLeft(true); };
    $('#chron .close').onclick = () => document.body.classList.remove('chron-open');
    $('#left .close').onclick = () => document.body.classList.remove('left-open');
    $('#btnSound').onclick = () => { this.app.toggleSound(); this.syncSound(); };
    $('#btnMenu').onclick = () => this.menu();
    $('#btnHelp').onclick = () => this.help();
    document.querySelectorAll('#speed button[data-s]').forEach(b => { b.onclick = e => { e.stopPropagation(); this.app.setSpeed(+b.dataset.s); $('#speed').classList.remove('open'); }; });
    // 100× bis 100.000× stecken in einem kleinen Menü hinter », damit die Leiste nicht überläuft
    const fb = $('#fastBtn');
    if (fb) {
      fb.onclick = e => { e.stopPropagation(); $('#speed').classList.toggle('open'); };
      document.addEventListener('click', () => $('#speed').classList.remove('open'));
    }
    this.syncSound();
  }

  syncSound() { $('#btnSound').classList.toggle('off', !this.app.sound.on); }

  renderCards() {
    const wrap = $('#dock .cards');
    wrap.innerHTML = '';
    D.POWERS.filter(p => p.cat === this.cat).forEach((P, i) => {
      const c = h('button', 'card');
      c.dataset.id = P.id;
      c.dataset.prayed = L('Gebet', 'Prayer'); // für die Markierung "Gebet" auf der Karte (styles.css kann attr(data-prayed) nutzen)
      c.innerHTML = `<span class="ckey">${i + 1}</span><img src="${CARD(P.id)}" alt="" loading="lazy"><div class="cfoot"><span class="cname">${P.name}</span><span class="ccost">${P.cost}</span></div><div class="ctip"><b>${P.name}</b><span>${P.info}</span><em>${TARGET_TXT[P.target] || TARGET_TXT.point}</em></div>`;
      c.onclick = () => this.app.choosePower(P.id);
      wrap.append(c);
    });
    this.updateCards();
  }

  updateCards() {
    const st = this.app.st;
    if (!st) return;
    document.querySelectorAll('#dock .card').forEach(c => {
      const P = D.POWER[c.dataset.id];
      c.classList.toggle('poor', st.mana < P.cost);
      c.classList.toggle('active', this.app.power === P.id);
      c.classList.toggle('prayed', st.prayers.some(p => p.power === P.id));
    });
  }

  // ---------- Kopfleiste ----------
  updateTop(st, frac) {
    const season = seasonOf(st.day);
    const hour = Math.floor(frac * 24), min = Math.floor((frac * 24 - hour) * 60 / 15) * 15;
    const yr = yearOf(st.day), dd = (st.day % D.DAYS_PER_SEASON) + 1;
    $('#date').textContent = L(`Jahr ${yr} · ${D.SEASONS[season]} · Tag ${dd}`, `Year ${yr} · ${D.SEASONS[season]} · Day ${dd}`);
    const sp = this.app.speed;
    const yrS = (D.DAYS_PER_YEAR * D.DAY_SECONDS / sp).toFixed(sp >= 500 ? 1 : 0);
    // ab 10.000× zählt, was der Rechner schafft: gemessene Jahre pro Sekunde
    const yps = (this.app.daysPerSec || 0) / D.DAYS_PER_YEAR, ypsS = yps >= 10 ? Math.round(yps) : yps.toFixed(1);
    $('#clock').textContent = sp > 1000 ? L(`${speedLabel(sp)} · ≈ ${String(ypsS).replace('.', ',')} Jahre pro s`, `${speedLabel(sp)} · ≈ ${ypsS} years per s`)
      : sp >= 100 ? L(`${sp}× · 1 Jahr ≈ ${yrS.replace('.', ',')} s`, `${sp}× · 1 year ≈ ${yrS} s`)
      : `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')} · ${WEATHER_NAME[st.weather.kind] || ''}${st.weather.god ? ' ✦' : ''}`;
    const I = this.app.focusIsle();
    const multi = st.isles.filter(o => st.settlements.some(x => x.alive && x.isle === o.id)).length > 1;
    $('#era').textContent = D.ERAS[I ? I.era : st.era].name + (multi && I ? ' · ' + I.name : '');
    $('#popN').textContent = st.people.length;
    $('#setN').textContent = st.settlements.filter(s => s.alive).length;
    $('#faithN').textContent = pct(st.faithAvg || 0);
    const cur = I && I.research.cur && D.TECH[I.research.cur];
    const inhabited = I && st.settlements.some(x => x.alive && x.isle === I.id);
    const fut = inhabited && !cur && I.techs.length >= D.TECHS.length; // alles Wissen: weiter mit Fortschrittsstufen
    $('#resName').textContent = !inhabited ? (I ? L(`${I.name}: unbewohnt`, `${I.name}: uninhabited`) : '') : cur ? cur.name : fut ? L(`Fortschritt ${(I.prog | 0) + 1}: ${progName(I.prog | 0)}`, `Progress ${(I.prog | 0) + 1}: ${progName(I.prog | 0)}`) : L('Alles entdeckt', 'Everything discovered');
    $('#resBar').style.width = cur && inhabited ? Math.min(100, I.research.pts / techCost(st, I, cur) * 100) + '%' : fut ? Math.min(100, I.research.pts / progCost(I.prog | 0) * 100) + '%' : inhabited ? '100%' : '0%';
    const max = D.ERAS[st.era].mana;
    $('#manaN').textContent = Math.floor(st.mana);
    $('#manaMax').textContent = max;
    const ring = $('#manaRing');
    ring.style.strokeDashoffset = (1 - st.mana / max) * 276;
    const rate = (st.manaRate || 0).toFixed(1);
    $('#manaRate').textContent = L(`+${rate} pro Tag`, `+${rate} per day`);
    document.querySelectorAll('#speed button[data-s]').forEach(b => b.classList.toggle('on', +b.dataset.s === this.app.speed));
    const fb = $('#fastBtn');
    if (fb) { const fast = this.app.speed >= 100; fb.textContent = fast ? speedLabel(this.app.speed) : '»'; fb.classList.toggle('on', fast); }
  }

  // ---------- Chronik ----------
  renderChron(full) {
    const st = this.app.st, list = $('#chron .list');
    if (full) { list.innerHTML = ''; this.chronSeen = Math.max(0, st.chronicle.length - 220); }
    const items = st.chronicle.slice(this.chronSeen);
    this.chronSeen = st.chronicle.length;
    const frag = document.createDocumentFragment();
    for (const e of items) {
      if (this.filter !== 'alle' && KIND_FILTER[e.k] !== this.filter) continue;
      const s = e.s >= 0 ? st._rt.sById.get(e.s) : null;
      const el = h('div', `ce k-${e.k} imp${e.imp}`);
      el.innerHTML = `<div class="cmeta"><span class="cdot"></span>${dateStr(e.d)}${s ? ` · <span style="color:${s.color}">${esc(s.name)}</span>` : ''}<span class="ck">${KIND_LABEL[e.k] || ''}</span></div><p>${esc(e.t)}</p>`;
      if (e.x != null || s) el.onclick = () => this.app.focus(e.x ?? s.cx, e.y ?? s.cy, 38);
      if (e.pid) el.onclick = () => this.app.selectPerson(e.pid, true);
      frag.prepend(el);
    }
    list.prepend(frag);
    while (list.children.length > 260) list.lastChild.remove();
    // Ticker: die letzten wichtigen Zeilen, wenn die Chronik zu ist
    if (!full) {
      const tk = $('#ticker');
      for (const e of items) {
        if (e.imp < 1 && e.k !== 'gebet') continue;
        const el = h('div', 'tk', `<small>${dateStr(e.d)}</small>${esc(e.t)}`);
        el.onclick = () => document.body.classList.add('chron-open');
        tk.append(el);
        setTimeout(() => el.classList.add('old'), 9000);
        setTimeout(() => el.remove(), 16000);
      }
      while (tk.children.length > 3) tk.firstChild.remove();
    }
  }

  // ---------- Gebete ----------
  renderPrayers(st) {
    const box = $('#prayers');
    const key = st.prayers.map(p => p.id + ':' + Math.max(0, p.until - st.day)).join('|') + (this.prayAll ? '+' : '');
    if (key === this.prayKey) return;
    this.prayKey = key;
    box.innerHTML = '';
    // Dringendste zuerst, höchstens zwei offen, der Rest hinter einem Knopf
    const list = st.prayers.slice().sort((a, b) => a.until - b.until);
    const shown = this.prayAll ? list : list.slice(0, 2);
    for (const p of shown) {
      const s = st._rt.sById.get(p.s);
      if (!s) continue;
      const left = Math.max(0, p.until - st.day);
      const el = h('button', 'prayer');
      const verb = POWER_VERB[p.power] || '';
      el.innerHTML = `<img src="${CARD(p.power)}" alt=""><div><b>${L(`${esc(p.whoN)} aus ${esc(s.name)} betet ${verb}`, `${esc(p.whoN)} from ${esc(s.name)} prays ${verb}`)}</b><span>„${esc(p.t)}“</span>${bar(left / 12, 'gold')}</div>`;
      el.title = L(`Noch ${left} Tage. Klicke, um die Kraft zu wählen.`, `${left} ${plural(left, 'day', 'days')} left. Click to choose the power.`);
      el.onclick = () => { this.app.focus(s.cx, s.cy, 45); this.app.choosePower(p.power, s); };
      box.append(el);
    }
    if (list.length > 2) {
      const more = h('button', 'prayer-more');
      more.textContent = this.prayAll ? L('Weniger zeigen', 'Show fewer') : L(`+${list.length - 2} weitere Gebete`, `+${list.length - 2} more ${plural(list.length - 2, 'prayer', 'prayers')}`);
      more.onclick = () => { this.prayAll = !this.prayAll; this.renderPrayers(st); };
      box.append(more);
    }
  }

  // ---------- Inselbuch ----------
  renderLeft(force) {
    const st = this.app.st, body = $('#left .body');
    if (!st) return;
    const wide = !this.detail && (this.leftTab === 'menschen' || this.leftTab === 'wirtschaft' || this.leftTab === 'gesellschaft' || this.leftTab === 'militaer' || this.leftTab === 'staaten');
    document.body.classList.toggle('left-wide', wide && document.body.classList.contains('left-open'));
    if (this.detail) return this.renderSettlement(this.detail);
    if (wide) {
      // Diese Reiter nicht ständig neu bauen, solange jemand darin liest, tippt oder scrollt
      const busy = document.querySelector('#left:hover') || (document.activeElement && document.activeElement.closest && document.activeElement.closest('#left'));
      if (!force && (busy || performance.now() - (this.bookAt || 0) < 12000)) return;
      this.bookAt = performance.now();
      const top = body.scrollTop;
      if (this.leftTab === 'menschen') peopleTab(this, st, body); else if (this.leftTab === 'gesellschaft') societyTab(this, st, body); else if (this.leftTab === 'militaer') militaryTab(this, st, body); else if (this.leftTab === 'staaten') statesTab(this, st, body); else economyTab(this, st, body);
      body.scrollTop = top;
      return;
    }
    if (this.leftTab === 'siedlungen') {
      let html = '';
      for (const s of st.settlements) {
        const lead = s.gov.leader ? st._rt.pById.get(s.gov.leader) : null;
        if (!s.alive) {
          const by = s.endedBy ? st._rt.sById.get(s.endedBy) : null;
          const why = by ? L(`erobert von ${esc(by.name)}`, `conquered by ${esc(by.name)}`) : L('verlassen', 'abandoned');
          html += `<div class="scard dead"><div class="sname"><i style="background:${s.color}"></i>${esc(s.name)}</div><small>${why}, ${L('Jahr', 'year')} ${yearOf(s.ended || 0)}</small></div>`;
          continue;
        }
        const war = s.war ? st._rt.sById.get(s.war) : null;
        const allies = Object.keys(s.ally).map(id => st._rt.sById.get(+id)).filter(o => o && o.alive);
        html += `<button class="scard" data-id="${s.id}">
          <div class="sname"><i style="background:${s.color}"></i>${esc(s.name)}<span class="spop">${s.pop}</span></div>
          <div class="sgov">${D.GOVS[s.gov.type].name}${lead ? ` · ${esc(lead.lt)} ${esc(lead.n)}` : ''}</div>
          <div class="sbars"><label>${L('Glück', 'Joy')}</label>${bar(s.hap)}<label>${L('Glaube', 'Faith')}</label>${bar(s.faith, 'gold')}<label>${L('Unruhe', 'Unrest')}</label>${bar(s.unrest, 'red')}</div>
          ${war ? `<div class="badge war">${L(`Krieg mit ${esc(war.name)}`, `At war with ${esc(war.name)}`)}</div>` : ''}${allies.map(a => `<div class="badge ally">${L(`Bund mit ${esc(a.name)}`, `Allied with ${esc(a.name)}`)}</div>`).join('')}
        </button>`;
      }
      body.innerHTML = html;
      body.querySelectorAll('.scard[data-id]').forEach(b => { b.onclick = () => { this.detail = +b.dataset.id; const s = st._rt.sById.get(this.detail); this.app.focus(s.cx, s.cy, 50); this.renderLeft(); }; });
    } else if (this.leftTab === 'inseln') {
      let html = `<p class="muted">${L('Jede Insel hat ihr eigenes Volk, ihr eigenes Wissen und ihre eigene Zeit. Erst Schiffe bringen sie zusammen.', 'Every island has its own people, its own knowledge and its own time. Only ships bring them together.')}</p>`;
      for (const I of st.isles) {
        const sets = st.settlements.filter(x => x.alive && x.isle === I.id);
        const pop = sets.reduce((a, x) => a + x.pop, 0);
        const cur = I.research.cur && D.TECH[I.research.cur];
        const contacts = Object.keys(I.contact).map(id => st._rt.iById.get(+id)).filter(Boolean);
        const seen = Object.keys(I.seen).map(id => st._rt.iById.get(+id)).filter(o => o && !I.contact[o.id]);
        const popTxt = sets.length ? L(`${pop} Menschen`, `${pop} ${plural(pop, 'person', 'people')}`) : L('unbewohnt', 'uninhabited');
        const subTxt = sets.length ? D.ERAS[I.era].name + ' · ' + sets.map(x => esc(x.name)).join(', ') : L('Wälder, Strände, Stille', 'Forests, beaches, silence');
        const knows = contacts.map(o => esc(o.name)).join(', '), found = seen.map(o => esc(o.name)).join(', ');
        html += `<button class="scard isle" data-isle="${I.id}">
          <div class="sname"><i style="background:${sets[0] ? sets[0].color : '#9aa3a8'}"></i>${esc(I.name)}<span class="spop">${popTxt}</span></div>
          <div class="sgov">${subTxt} · ${I.area} ${L('Felder', 'tiles')}</div>
          ${sets.length && cur ? `<div class="sbars"><label>${L('Forschung', 'Research')}</label>${bar(I.research.pts / techCost(st, I, cur), 'blue')}</div><small class="muted">${cur.name}</small>` : ''}
          ${contacts.length ? `<div class="badge ally">${L(`kennt ${knows}`, `knows ${knows}`)}</div>` : sets.length ? `<div class="badge">${L('allein auf der Welt', 'alone in the world')}</div>` : ''}
          ${seen.length ? `<div class="badge">${L(`entdeckt: ${found}`, `discovered: ${found}`)}</div>` : ''}
        </button>`;
      }
      const routes = (st.trade || []).length;
      html += `<p class="muted">${routes ? L(`${routes} Handelsrouten über das Meer.`, `${routes} trade ${plural(routes, 'route', 'routes')} across the sea.`) : L('Noch fährt kein Handelsschiff zwischen den Inseln.', 'No trade ship sails between the islands yet.')}</p>`;
      body.innerHTML = html;
      body.querySelectorAll('.scard[data-isle]').forEach(b => { b.onclick = () => { const I = st._rt.iById.get(+b.dataset.isle); this.wissenIsle = I.id; this.app.focus(I.cx, I.cy, 70); }; });
    } else if (this.leftTab === 'wissen') {
      const lived = st.isles.filter(o => st.settlements.some(x => x.alive && x.isle === o.id));
      const fi = this.app.focusIsle();
      let I = st._rt.iById.get(this.wissenIsle) || (fi && lived.includes(fi) ? fi : lived[0]) || st.isles[0];
      let html = lived.length > 1 ? `<div class="isle-chips">${lived.map(o => `<button data-i="${o.id}" class="${o === I ? 'on' : ''}">${esc(o.name)}</button>`).join('')}</div>` : '';
      const cur = I.research.cur && D.TECH[I.research.cur];
      html += `<div class="era-now"><small>${L(`Epoche auf ${esc(I.name)}`, `Era on ${esc(I.name)}`)}</small><b>${D.ERAS[I.era].name}</b><span>${D.ERAS[I.era].sub}</span></div>`;
      if (cur) html += `<div class="res-now"><small>${L('Die Gelehrten grübeln über', 'The scholars are pondering')}</small><b>${cur.name}</b>${bar(I.research.pts / techCost(st, I, cur), 'blue')}<span>${cur.info}${techCost(st, I, cur) < cur.cost ? L(' Nachbarn kennen es schon, das hilft.', ' Neighbors already know it, which helps.') : ''}</span></div>`;
      const known = new Set(I.techs);
      for (const e of D.ERAS) {
        const techs = D.TECHS.filter(t => t.era === e.id);
        html += `<div class="tera ${e.id <= I.era ? 'reached' : ''}"><h4>${e.name}</h4><div class="tlist">${techs.map(t => {
          const k = known.has(t.id), c = I.research.cur === t.id;
          return `<span class="tech ${k ? 'known' : ''} ${c ? 'cur' : ''}" title="${esc(t.info)}">${t.name}</span>`;
        }).join('')}</div></div>`;
      }
      body.innerHTML = html;
      body.querySelectorAll('.isle-chips button').forEach(b => { b.onclick = () => { this.wissenIsle = +b.dataset.i; this.renderLeft(); }; });
    } else if (this.leftTab === 'mythen') {
      let html = `<h3 class="sect">${L('Mythen', 'Myths')}</h3>`;
      if (!st.myths.length) html += `<p class="muted">${L('Noch erzählt niemand von dir. Zeig dich.', 'Nobody tells tales of you yet. Show yourself.')}</p>`;
      for (const m of st.myths.slice().reverse()) {
        const s = st._rt.sById.get(m.s);
        html += `<div class="myth"><img src="${CARD(m.kind)}" alt=""><div><b>${esc(m.name)}</b><small>${s ? esc(s.name) : ''} · ${L('seit Jahr', 'since year')} ${yearOf(m.d)}${m.good ? L(' · jährliches Fest', ' · yearly feast') : ''}</small></div></div>`;
      }
      html += `<h3 class="sect">${L('Ahnenhalle', 'Hall of Ancestors')}</h3>`;
      if (!st.ancestors.length) html += `<p class="muted">${L('Die Großen dieser Insel leben noch.', 'The great ones of this island are still alive.')}</p>`;
      for (const a of st.ancestors.slice(0, 30)) {
        const s = st._rt.sById.get(a.s);
        html += `<div class="anc"><b>${esc(a.title ? a.title + ' ' : '')}${esc(a.n)}</b><small>${s ? esc(s.name) + ' · ' : ''}${L(`Jahr ${yearOf(a.b)} bis ${yearOf(a.d)}`, `Year ${yearOf(a.b)} to ${yearOf(a.d)}`)} · ${esc(causeName(a.cause))}</small><ul>${a.bio.slice(-3).map(b => `<li>${esc(b[1])}</li>`).join('')}</ul></div>`;
      }
      body.innerHTML = html;
    } else {
      body.innerHTML = `<button class="tlbtn">${L('Die ganze Weltgeschichte im Zeitraffer', 'The whole history of the world in time-lapse')}</button><h3 class="sect">${L('Menschen auf der Insel', 'People on the island')}</h3><canvas id="chart" width="560" height="200"></canvas>
        <div class="stats">
          <div><b>${st.counts.births}</b><small>${L('Geburten', 'Births')}</small></div><div><b>${st.counts.deaths}</b><small>${L('Tote', 'Deaths')}</small></div>
          <div><b>${st.counts.powers}</b><small>${L('Eingriffe', 'Interventions')}</small></div><div><b>${st.counts.answered}</b><small>${L('erhörte Gebete', 'Answered prayers')}</small></div>
          <div><b>${new Set(st.isles.flatMap(I => I.techs)).size}</b><small>${L('Entdeckungen', 'Discoveries')}</small></div><div><b>${st.myths.length}</b><small>${L('Mythen', 'Myths')}</small></div>
        </div>`;
      this.drawChart(st);
      body.querySelector('.tlbtn').onclick = () => { document.body.classList.remove('left-open'); this.app.timelapse.start(null); };
    }
  }

  drawChart(st) {
    const cv = $('#chart');
    if (!cv) return;
    const g = cv.getContext('2d'), W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    const data = st.stats;
    if (data.length < 2) { g.fillStyle = 'rgba(246,239,226,0.6)'; g.font = '14px Manrope'; g.fillText(L('Nach dem ersten Jahr erscheint hier der Verlauf.', 'After the first year, the curve appears here.'), 16, 100); return; }
    const max = Math.max(...data.map(d => d.pop)) * 1.1;
    g.strokeStyle = 'rgba(246,239,226,0.12)'; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, H * i / 4); g.lineTo(W, H * i / 4); g.stroke(); }
    const line = (fn, col, fill) => {
      g.beginPath();
      data.forEach((d, i) => { const x = i / (data.length - 1) * W, y = H - fn(d) * H * 0.92 - 4; i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.strokeStyle = col; g.lineWidth = 2.2; g.stroke();
      if (fill) { g.lineTo(W, H); g.lineTo(0, H); g.fillStyle = fill; g.fill(); }
    };
    line(d => d.pop / max, '#9fd4c8', 'rgba(159,212,200,0.12)');
    line(d => d.faith, '#e9b44c');
    g.fillStyle = '#9fd4c8'; g.font = '600 12px Manrope'; g.fillText(L(`Menschen (max ${Math.round(max / 1.1)})`, `People (max ${Math.round(max / 1.1)})`), 10, 16);
    g.fillStyle = '#e9b44c'; g.fillText(L('Glaube', 'Faith'), 10, 32);
    let last = -1;
    data.forEach((d, i) => { if (d.era !== last && i) { const x = i / (data.length - 1) * W; g.fillStyle = 'rgba(246,239,226,0.35)'; g.fillRect(x, 0, 1, H); g.fillText(D.ERAS[d.era].name, x + 4, H - 6); } last = d.era; });
  }

  renderSettlement(id) {
    const st = this.app.st, s = st._rt.sById.get(id), body = $('#left .body');
    if (!s) { this.detail = null; return this.renderLeft(); }
    const lead = s.gov.leader ? st._rt.pById.get(s.gov.leader) : null;
    const fac = s.fac || {};
    const notable = st.people.filter(p => p.s === s.id && (p.lt || p.title)).slice(0, 8);
    // Nachbarn: Beziehung, Krieg mit Namen, Bund, Pakt (diplomacy.js) und Groll
    const PACT = PACT_NAME; // seit 24.10.2026 mit Verteidigungs-, Militär- und Nichtangriffspakt (military_ui.js)
    const rels = st.settlements.filter(o => o.alive && o !== s).map(o => {
      const P = s.pact && s.pact[o.id] && s.pact[o.id].until > st.day ? s.pact[o.id] : null;
      const g = Math.round((s.grudge && s.grudge[o.id]) || 0);
      const tag = s.war === o.id ? `${L('Krieg', 'War')}${s.warName ? ': ' + esc(s.warName) : ''}` : P ? `${PACT[P.kind] || L('Pakt', 'Pact')} ${L('bis Jahr', 'until year')} ${yearOf(P.until)}` : s.ally[o.id] ? L('Bund', 'Alliance') : g > 25 ? L(`Groll ${g}`, `Grudge ${g}`) : Math.round(s.rel[o.id] ?? 0);
      return `<div class="rel"><span><i style="background:${o.color}"></i>${esc(o.name)}</span>${bar(((s.rel[o.id] ?? 0) + 100) / 200, (s.rel[o.id] ?? 0) < -30 ? 'red' : (s.rel[o.id] ?? 0) > 50 ? 'green' : '')}<em>${tag}</em></div>`;
    }).join('');
    const counts = {};
    for (const b of st.buildings) if (b.s === s.id) counts[b.t] = (counts[b.t] || 0) + 1;
    const STOCK = [['food', L('Nahrung', 'Food')], ['wood', L('Holz', 'Wood')], ['stone', L('Stein', 'Stone')], ['ore', L('Erz', 'Ore')], ['tools', L('Werkzeug', 'Tools')], ['goods', L('Waren', 'Goods')], ['gold', L('Gold', 'Gold')]];
    body.innerHTML = `
      <button class="back">${L('← Alle Siedlungen', '← All settlements')}</button>
      <button class="tlbtn">${L('Wachstum im Zeitraffer ansehen', 'Watch it grow in time-lapse')}</button>
      <div class="shead" style="--sc:${s.color}"><h2>${esc(s.name)}</h2><span>${L(`gegründet im Jahr ${yearOf(s.founded)} · ${s.pop} Menschen`, `founded in year ${yearOf(s.founded)} · ${s.pop} ${plural(s.pop, 'person', 'people')}`)}</span>${s.splitFrom && st._rt.sById.get(s.splitFrom) ? `<span class="split">${L(`abgespalten von ${esc(st._rt.sById.get(s.splitFrom).name)}`, `split from ${esc(st._rt.sById.get(s.splitFrom).name)}`)}${D.FACTIONS[s.creed] ? ` · ${D.FACTIONS[s.creed].name}` : ''}</span>` : ''}</div>
      <div class="gov"><b>${D.GOVS[s.gov.type].name}</b>${lead ? `<button class="plink" data-pid="${lead.id}">${esc(lead.lt)} ${esc(lead.n)}</button>` : ''}<small>${L('seit Jahr', 'since year')} ${yearOf(s.gov.since)}${s.gov.dyn ? ` · ${L('Haus', 'House')} ${esc(s.gov.dyn)}` : ''}</small></div>
      <div class="sbars wide"><label>${L('Glück', 'Joy')}</label>${bar(s.hap)}<label>${L('Glaube', 'Faith')}</label>${bar(s.faith, 'gold')}<label>${L('Unruhe', 'Unrest')}</label>${bar(s.unrest, 'red')}<label>${L('Hunger', 'Hunger')}</label>${bar(s.hunger, 'red')}</div>
      <h3 class="sect">${L('Kultur', 'Culture')}</h3>
      <div class="culture">${Object.entries(D.CULTURE).map(([k, n]) => `<label>${n}</label>${bar(s.cult[k], 'c-' + k)}`).join('')}</div>
      <h3 class="sect">${L('Kräfte im Volk', 'Factions')}</h3>
      <div class="facbar">${Object.entries(D.FACTIONS).map(([k, f]) => `<i style="flex:${(fac[k] || 0) + 0.001};background:${f.color}" title="${f.name} ${pct(fac[k] || 0)}"></i>`).join('')}</div>
      <div class="faclegend">${Object.entries(D.FACTIONS).map(([k, f]) => `<span><i style="background:${f.color}"></i>${f.name.replace('Die ', '').replace('Das ', '').replace('The ', '')} ${pct(fac[k] || 0)}</span>`).join('')}</div>
      <h3 class="sect">${L('Gesetze', 'Laws')}</h3>
      <div class="laws">${s.laws.length ? s.laws.map(l => `<div class="law"><b>${D.LAWS[l].name}</b><small>${D.LAWS[l].info}</small></div>`).join('') : `<p class="muted">${L('Keine Gesetze. Noch regelt das Herz.', 'No laws yet. The heart still rules.')}</p>`}</div>
      <h3 class="sect">${L('Vorräte', 'Supplies')}</h3>
      <div class="stock">${STOCK.filter(([k]) => k !== 'gold').map(([k, n]) => `<div><b>${Math.floor(s.stock[k])}</b><small>${n}</small></div>`).join('')}</div>
      ${settlementEconomy(st, s, p => `<button class="plink" data-pid="${p.id}">${esc(p.n)}</button>`)}
      ${rels ? `<h3 class="sect">${L('Nachbarn', 'Neighbors')}</h3>${rels}` : ''}
      <h3 class="sect">${L('Bekannte Gesichter', 'Familiar Faces')}</h3>
      <div class="people">${notable.length ? notable.map(p => `<button class="plink" data-pid="${p.id}">${esc(p.lt || p.title)} ${esc(p.n)}</button>`).join('') : `<p class="muted">${L('Noch hat sich niemand einen Namen gemacht.', 'Nobody has made a name for themselves yet.')}</p>`}</div>
      <h3 class="sect">${L('Bauten', 'Buildings')}</h3>
      <div class="blist">${Object.entries(counts).map(([t, n]) => `<span>${D.BUILDINGS[t].name} ${n}</span>`).join('')}</div>`;
    body.querySelector('.back').onclick = () => { this.detail = null; this.renderLeft(); };
    body.querySelector('.tlbtn').onclick = () => { document.body.classList.remove('left-open'); this.app.timelapse.start(s.id); };
    body.querySelectorAll('.plink').forEach(b => { b.onclick = () => this.app.selectPerson(+b.dataset.pid, true); });
  }

  // ---------- Inspektor ----------
  showPerson(p) {
    const st = this.app.st;
    this.inspect = { kind: 'p', id: p.id };
    const s = st._rt.sById.get(p.s);
    const pa = p.pa ? st._rt.pById.get(p.pa) : null;
    const mo = p.mo ? st._rt.pById.get(p.mo) : null, fa = p.fa ? st._rt.pById.get(p.fa) : null;
    const box = $('#inspector');
    box.className = 'show';
    const TR = { mut: L('Mut', 'Courage'), fleiss: L('Fleiß', 'Diligence'), glaube: L('Frömmigkeit', 'Piety'), neugier: L('Neugier', 'Curiosity'), wut: L('Zorn', 'Temper'), charisma: L('Ausstrahlung', 'Charisma'), kunst: L('Kunstsinn', 'Artistry') };
    const plink = q => `<button class="plink" data-pid="${q.id}">${esc(q.n)}</button>`;
    const age = Math.floor(ageOf(st, p));
    const sexTxt = p.sex === 'f' ? L('Frau', 'Woman') : L('Mann', 'Man');
    const ageTxt = L(`${age} Jahre`, `${age} ${plural(age, 'year', 'years')} old`);
    const parents = [mo, fa].filter(Boolean).map(plink).join(L(' und ', ' and '));
    box.innerHTML = `<button class="x">×</button>
      <div class="ihead"><div class="avatar face-av" style="--c:${s ? s.color : '#999'}">${faceAvatar(st, p)}</div><div><h3>${esc(p.lt || p.title ? (p.lt || p.title) + ' ' : '')}${esc(p.n)}</h3><small>${sexTxt}, ${ageTxt} · ${D.JOBS[p.job]?.name || p.job} · ${L('Familie', 'Family')} ${esc(p.clan)}${s ? ` · ${esc(s.name)}` : ''}</small></div></div>
      <div class="sbars wide"><label>${L('Gesundheit', 'Health')}</label>${bar(p.hp, 'green')}<label>${L('Glück', 'Joy')}</label>${bar(p.hap)}<label>${L('Glaube', 'Faith')}</label>${bar(p.faith, 'gold')}</div>
      <div class="traits">${Object.entries(TR).map(([k, n]) => `<label>${n}</label>${bar(p.tr[k], 'thin')}`).join('')}</div>
      <div class="fam">${p.kids ? L(`${p.kids} ${p.kids === 1 ? 'Kind' : 'Kinder'}. `, `${p.kids} ${p.kids === 1 ? 'child' : 'children'}. `) : ''}${mo || fa ? L(`Kind von ${parents}.`, `Child of ${parents}.`) : ''}${p.dream ? L(` Träumte von ${D.DREAMS[p.dream].name}.`, ` Dreamed of ${D.DREAMS[p.dream].name}.`) : ''}${p.foreign ? L(' Kam von fern.', ' Came from afar.') : ''}${p.sick ? L(' Liegt krank.', ' Is ill.') : ''}</div>
      ${officesHtml(st, p)}
      ${personBlocks(st, p, plink)}
      <h4 class="isect">${L('Lebenslauf', 'Life')}</h4>
      <ul class="bio">${p.bio.slice().reverse().map(b => `<li><span>${L('J', 'Y')}${yearOf(b[0])}</span>${esc(b[1])}</li>`).join('')}</ul>
      <div class="iact"><button class="follow">${this.app.followId === p.id ? L('Nicht mehr folgen', 'Stop following') : L('Folgen', 'Follow')}</button><button class="dream">${L('Traum senden', 'Send a dream')}</button>${diaryButtons(st, p)}</div>`;
    box.querySelector('.x').onclick = () => this.closeInspector();
    box.querySelector('.follow').onclick = () => { this.app.follow(this.app.followId === p.id ? null : p.id); this.showPerson(p); };
    box.querySelector('.dream').onclick = () => this.app.choosePower('traum', null, p.id);
    const dr = box.querySelector('.dread'), db = box.querySelector('.dbegin');
    if (dr) dr.onclick = () => openDiary(this.app, { id: +dr.dataset.id });
    if (db) db.onclick = () => { const d = startDiary(st, p); openDiary(this.app, { id: d.id }); this.showPerson(p); };
    box.querySelector('.dstory').onclick = () => openDiary(this.app, { story: p.id });
    box.querySelectorAll('.plink').forEach(b => { b.onclick = () => this.app.selectPerson(+b.dataset.pid, true); });
  }

  showBuilding(b) {
    const st = this.app.st, s = st._rt.sById.get(b.s), def = D.BUILDINGS[b.t];
    this.inspect = { kind: 'b', id: b.id };
    const workers = st.people.filter(p => p.w === b.id);
    const residents = st.people.filter(p => p.home === b.id);
    const box = $('#inspector');
    box.className = 'show';
    const title = b.t === 'zentrum' && s ? L(`Herz von ${esc(s.name)}`, `Heart of ${esc(s.name)}`) : def.name;
    const styleTxt = L(` · Baustil ${D.ERAS[b.lvl].name}`, ` · ${D.ERAS[b.lvl].name} style`);
    box.innerHTML = `<button class="x">×</button>
      <div class="ihead"><div class="avatar sq" style="--c:${s ? s.color : '#999'}">⌂</div><div><h3>${title}</h3><small>${s ? esc(s.name) : L('verlassen', 'abandoned')}${styleTxt}${b.prog < 1 ? L(` · im Bau ${pct(b.prog)}`, ` · under construction ${pct(b.prog)}`) : ''}${b.hp < 1 ? L(' · beschädigt', ' · damaged') : ''}</small></div></div>
      ${workers.length ? `<p class="fam">${L('Hier arbeiten', 'Working here')}: ${workers.slice(0, 10).map(p => `<button class="plink" data-pid="${p.id}">${esc(p.n)}</button>`).join(', ')}</p>` : ''}
      ${residents.length ? `<p class="fam">${L('Hier wohnen', 'Living here')}: ${residents.slice(0, 12).map(p => `<button class="plink" data-pid="${p.id}">${esc(p.n)}</button>`).join(', ')}</p>` : ''}
      <div class="iact">${b.prog >= 1 ? `<button class="ienter">${L('Hineinschauen', 'Look inside')}</button>` : ''}${b.t === 'zentrum' && s ? `<button class="sopen">${L('Siedlung öffnen', 'Open settlement')}</button>` : ''}</div>`;
    box.querySelector('.x').onclick = () => this.closeInspector();
    box.querySelectorAll('.plink').forEach(x => { x.onclick = () => this.app.selectPerson(+x.dataset.pid, true); });
    const ie = box.querySelector('.ienter');
    if (ie) ie.onclick = () => this.app.enterBuilding(b);
    const so = box.querySelector('.sopen');
    if (so) so.onclick = () => this.openSettlement(s.id);
  }

  openSettlement(id) {
    document.body.classList.add('left-open');
    this.leftTab = 'siedlungen';
    document.querySelectorAll('#left .tabs button').forEach((x, i) => x.classList.toggle('on', i === 0));
    this.detail = id;
    this.renderLeft();
  }

  closeInspector() { $('#inspector').className = ''; this.inspect = null; this.app.selectPerson(null); }

  refreshInspector() {
    if (!this.inspect) return;
    const st = this.app.st;
    if (this.inspect.kind === 'p') { const p = st._rt.pById.get(this.inspect.id); if (p) this.showPerson(p); else this.closeInspector(); }
    else { const b = st._rt.bById.get(this.inspect.id); if (b) this.showBuilding(b); else this.closeInspector(); }
  }

  // ---------- Ziel und Hinweise ----------
  hint(text) {
    const el = $('#hint');
    if (!text) { el.className = ''; return; }
    // am Handy gibt es keine Esc Taste: der Hinweis selbst ist der Abbrechen Knopf (ui/touch.js)
    el.innerHTML = text + (document.body.classList.contains('touch') ? L(' <kbd>× abbrechen</kbd>', ' <kbd>× cancel</kbd>') : L(' <kbd>Esc</kbd> bricht ab', ' <kbd>Esc</kbd> to cancel'));
    el.className = 'show';
  }

  dreamPicker(cb) {
    const m = $('#modal');
    m.innerHTML = `<div class="mbox dream"><img class="mart" src="${CARD('traum')}" alt=""><h2>${L('Wovon soll geträumt werden?', 'What shall be dreamed of?')}</h2><p>${L('Ein Traum verändert einen Menschen. Und manchmal ein ganzes Volk.', 'A dream changes a person. And sometimes a whole people.')}</p>
      <div class="themes">${Object.entries(D.DREAMS).map(([k, d]) => `<button data-k="${k}">${d.name}</button>`).join('')}</div><button class="ghost cancel">${L('Abbrechen', 'Cancel')}</button></div>`;
    m.className = 'show';
    m.querySelectorAll('.themes button').forEach(b => { b.onclick = () => { m.className = ''; cb(b.dataset.k); }; });
    m.querySelector('.cancel').onclick = () => { m.className = ''; cb(null); };
  }

  toast(text, kind = '') {
    const t = h('div', 'toast ' + kind, esc(text));
    $('#toasts').append(t);
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3800);
  }

  // ---------- Fenster ----------
  modal(html, buttons = [[L('Weiter', 'Continue'), null]]) {
    const m = $('#modal');
    m.innerHTML = `<div class="mbox">${html}<div class="mbtns">${buttons.map(([n], i) => `<button class="${i ? 'ghost' : ''}" data-i="${i}">${n}</button>`).join('')}</div></div>`;
    m.className = 'show';
    m.querySelectorAll('.mbtns button').forEach(b => { b.onclick = () => { m.className = ''; const fn = buttons[+b.dataset.i][1]; if (fn) fn(); }; });
  }

  eraModal(era) {
    const e = D.ERAS[era];
    const techs = D.TECHS.filter(t => t.era === era).map(t => t.name).join(', ');
    this.modal(`<img class="mart wide" src="assets/eras/era${era}.webp" alt=""><small class="kicker">${L('Eine neue Zeit beginnt', 'A new age begins')}</small><h2>${e.name}</h2><p>${L(`${e.sub}. In dieser Zeit lockt: ${techs}.`, `${e.sub}. This age holds new promise: ${techs}.`)}</p><p class="muted">${L(`Deine Kraft wächst auf ${e.mana}.`, `Your power grows to ${e.mana}.`)}</p>`);
  }

  welcomeBack(info) {
    const st = this.app.st;
    const items = info.entries.filter(e => e.imp >= 1).slice(-14);
    const away = info.seconds;
    const awayTxt = away > 86400 ? dur(Math.floor(away / 86400), 'Tag', 'Tage', 'day', 'days') : away > 3600 ? dur(Math.floor(away / 3600), 'Stunde', 'Stunden', 'hour', 'hours') : dur(Math.max(1, Math.floor(away / 60)), 'Minute', 'Minuten', 'minute', 'minutes');
    const yrs = info.days / D.DAYS_PER_YEAR;
    const islandTxt = yrs >= 1 ? dur(Math.floor(yrs), 'Jahr', 'Jahre', 'year', 'years') : dur(info.days, 'Tag', 'Tage', 'day', 'days');
    this.modal(`<small class="kicker">${L('Während du fort warst', 'While you were away')}</small><h2>${L(`${awayTxt} für dich. ${islandTxt} für die Insel.`, `${awayTxt} for you. ${islandTxt} for the island.`)}</h2>
      <div class="wb-stats"><div><b>${info.popBefore} → ${st.people.length}</b><small>${L('Menschen', 'People')}</small></div><div><b>${info.births}</b><small>${L('Geburten', 'Births')}</small></div><div><b>${info.deaths}</b><small>${L('Tote', 'Deaths')}</small></div><div><b>${D.ERAS[st.era].name}</b><small>${L('Epoche', 'Era')}</small></div></div>
      ${items.length ? `<ul class="wb">${items.map(e => `<li><span>${dateStr(e.d)}</span>${esc(e.t)}</li>`).join('')}</ul>` : `<p class="muted">${L('Es war ruhig. Die Menschen haben gelebt, geliebt und gearbeitet.', 'It was quiet. The people lived, loved and worked.')}</p>`}
      ${info.capped ? `<p class="muted">${L('Die Zeit war so lang, dass nur ein Teil davon nachgeholt wurde.', 'So much time passed that only part of it could be caught up.')}</p>` : ''}`, [[L('Zur Insel', 'To the island'), null]]);
  }

  menu() {
    const app = this.app;
    this.modal(`<h2>${L('Einstellungen', 'Settings')}</h2>
      <div class="opts">
        <label>${L('Sprache', 'Language')}</label><div class="seg" id="optL"><button data-l="en" class="${LANG === 'en' ? 'on' : ''}">English</button><button data-l="de" class="${LANG === 'de' ? 'on' : ''}">Deutsch</button></div>
        <label>${L('Grafik', 'Graphics')}</label><div class="seg" id="optQ">${['hoch', 'mittel', 'niedrig'].map(q => `<button data-q="${q}" class="${app.stage.quality === q ? 'on' : ''}">${QUALITY_NAME[q]}</button>`).join('')}</div>
        <label>${L('Gebiete zeigen', 'Show territories')}</label><div class="seg" id="optT"><button data-t="1" class="${app.view.territory ? 'on' : ''}">${L('an', 'on')}</button><button data-t="0" class="${!app.view.territory ? 'on' : ''}">${L('aus', 'off')}</button></div>
        <label>${L('Spielstand', 'Save file')}</label><div class="seg"><button id="optExp">${L('sichern als Datei', 'save to file')}</button><button id="optImp">${L('laden', 'load')}</button></div>
        <label>${L('Erzählstimme', 'Narrator')}</label><div class="seg" id="optV"><button data-v="1" class="${voiceOn() ? 'on' : ''}">${L('an', 'on')}</button><button data-v="0" class="${!voiceOn() ? 'on' : ''}">${L('aus', 'off')}</button></div>
        <label>${L('Tutorial', 'Tutorial')}</label><div class="seg" id="optTut"><button data-t="1" class="${!tourOff() ? 'on' : ''}">${L('an', 'on')}</button><button data-t="0" class="${tourOff() ? 'on' : ''}">${L('aus', 'off')}</button></div>
        <label>${L('Einführung', 'Introduction')}</label><div class="seg"><button id="optTrailer">${L('ansehen', 'watch')}</button></div>
        <label>${L('Welt', 'World')}</label><div class="seg"><button id="optWorld">${app.earthMode || app.levelMode ? L('zur Inselwelt', 'to the island world') : L('Neue Welt: Erde', 'New World: Earth')}</button></div>
        <label>${L('Baukasten', 'Level editor')}</label><div class="seg"><button id="optBuild">${L('eigene Level bauen', 'build your own levels')}</button></div>
        <label>${L('Mit Freund spielen', 'Play with a friend')}</label><div class="seg"><button id="optCoop">${app.coop && app.coop.joined ? L('verbunden', 'connected') : app.coop && app.coop.guest ? L('Gast', 'guest') : app.coop && app.coop.host ? L('Einladung', 'invitation') : L('Gastgeber oder Beitreten', 'host or join')}</button></div>
      </div>
      <p class="muted">${L(`Die Insel speichert sich selbst, im Browser${app.serverSync ? ' und auf deinem Mac' : ''}. Sie lebt weiter, solange du weg bist.`, `The island saves itself, in the browser${app.serverSync ? ' and on your Mac' : ''}. It lives on while you are away.`)}</p>`,
    [[L('Schließen', 'Close'), null], [app.earthMode ? L('Neue Erde beginnen', 'Begin a new Earth') : L('Neue Insel erschaffen', 'Create a new island'), () => this.confirmNew()]]);
    $('#optWorld').onclick = () => (app.earthMode ? app.leaveEarth() : app.levelMode ? app.leaveLevel() : app.enterEarth(true));
    $('#optBuild').onclick = () => { $('#modal').className = ''; if (app.levelMode && app.editor) app.editor.open(); else app.enterLevel(); };
    $('#optCoop').onclick = () => { if (app.openCoop) app.openCoop(); }; // Mehrspieler (ui/coop_ui.js)
    document.querySelectorAll('#optL button').forEach(b => { b.onclick = () => { if (b.dataset.l !== LANG) setLang(b.dataset.l); }; });
    document.querySelectorAll('#optQ button').forEach(b => { b.onclick = () => { app.setQuality(b.dataset.q); document.querySelectorAll('#optQ button').forEach(x => x.classList.toggle('on', x === b)); }; });
    document.querySelectorAll('#optT button').forEach(b => { b.onclick = () => { app.view.territory = b.dataset.t === '1'; app.colorsDirty = true; document.querySelectorAll('#optT button').forEach(x => x.classList.toggle('on', x === b)); }; });
    $('#optExp').onclick = () => app.exportSave();
    $('#optImp').onclick = () => app.importSave();
    document.querySelectorAll('#optV button').forEach(b => { b.onclick = () => { setVoiceOn(b.dataset.v === '1'); document.querySelectorAll('#optV button').forEach(x => x.classList.toggle('on', x === b)); }; });
    document.querySelectorAll('#optTut button').forEach(b => { b.onclick = () => { setTourOff(b.dataset.t === '0'); document.querySelectorAll('#optTut button').forEach(x => x.classList.toggle('on', x === b)); }; });
    $('#optTrailer').onclick = () => { this.closeModal ? this.closeModal() : (document.querySelector('#modal').className = ''); app.showTrailer(); };
  }

  confirmNew() {
    if (this.app.earthMode) {
      this.modal(`<h2>${L('Eine neue Erde?', 'A new Earth?')}</h2><p>${L('Die jetzige Erde mit all ihren Völkern verschwindet. Deine Inselwelt bleibt, wie sie ist.', 'The current Earth with all its peoples will vanish. Your island world stays as it is.')}</p>`,
        [[L('Ja, neue Erde', 'Yes, new Earth'), () => this.app.newWorld()], [L('Abbrechen', 'Cancel'), null]]);
      return;
    }
    this.modal(`<h2>${L('Eine neue Insel?', 'A new island?')}</h2><p>${L('Die jetzige Welt mit all ihren Menschen, Mythen und Toten verschwindet für immer. Sichere sie vorher als Datei, wenn du sie behalten willst.', 'The current world, with all its people, myths and dead, will vanish forever. Save it to a file first if you want to keep it.')}</p>`,
      [[L('Ja, neu erschaffen', 'Yes, create anew'), () => this.app.newWorld()], [L('Abbrechen', 'Cancel'), null]]);
  }

  help() {
    this.modal(`<h2>${L('Du bist der Geist dieser Welt', 'You are the spirit of this world')}</h2>
      <ul class="help">
        <li>${L('<b>Kein Gott, ein Geist.</b> Du bist Wind, Wasser und Wetter. Du formst das Land und gehst in ihre Träume. Die Menschen deuten dich auf ihre Weise.', '<b>Not a god, a spirit.</b> You are wind, water and weather. You shape the land and walk into their dreams. The people read you in their own way.')}</li>
        <li>${L('<b>Karten:</b> eine wählen, dann auf die Welt tippen. Deine Kraft wächst mit ihrem Glauben.', '<b>Cards:</b> pick one, then touch the world. Your power grows with their faith.')}</li>
        <li>${L('<b>Gebete</b> erscheinen oben. Antworte rechtzeitig, dann entsteht vielleicht ein Mythos.', '<b>Prayers</b> appear at the top. Answer in time, and a myth may be born.')}</li>
        <li>${L('<b>Dein Leben:</b> <kbd>H</kbd> zeigt deine Geschichte und dein Tagebuch, <kbd>G</kbd> lässt dich als Geist über die Insel gehen.', '<b>Your life:</b> <kbd>H</kbd> shows your story and diary, <kbd>G</kbd> lets you walk the island as a spirit.')}</li>
        <li>${L('<b>Steuerung:</b> ziehen dreht, Rad zoomt, Klick zeigt Geschichten. <kbd>I</kbd> Inselbuch, <kbd>C</kbd> Chronik, <kbd>1</kbd> bis <kbd>8</kbd> Tempo.', '<b>Controls:</b> drag to turn, scroll to zoom, click for stories. <kbd>I</kbd> Island Book, <kbd>C</kbd> Chronicle, <kbd>1</kbd> to <kbd>8</kbd> speed.')}</li>
        <li>${L('<b>Die Welt:</b> Pfeiltasten oder <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> schieben den Blick, <kbd>Q</kbd> und <kbd>E</kbd> drehen, <kbd>+</kbd> und <kbd>-</kbd> zoomen. <kbd>M</kbd> öffnet die Karte der Menschen: sie zeigt nur, was sie schon erkundet haben. Im Osten und Süden wartet ein großes Festland.', '<b>The world:</b> arrow keys or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move the view, <kbd>Q</kbd> and <kbd>E</kbd> turn, <kbd>+</kbd> and <kbd>-</kbd> zoom. <kbd>M</kbd> opens the people\'s map: it only shows what they have explored. A great mainland waits in the east and south.')}</li>
        <li>${L('<b>Die Zeit läuft weiter</b>, auch wenn du gehst. Ein Jahr dauert 12 Minuten.', '<b>Time keeps flowing</b>, even when you leave. A year takes 12 minutes.')}</li>
      </ul>${this.app.earthMode ? `<p class="muted credits">${L('Die Erde nach echten Daten: Höhen NOAA NCEI ETOPO1, Klima nach Beck et al. (2023), Köppen-Geiger Karten 1991 bis 2020, CC BY 4.0, Flüsse, Seen, Gegenden und Meere aus Natural Earth (gemeinfrei). Ein Feld ist rund 20 km groß.', 'The Earth from real data: elevation NOAA NCEI ETOPO1, climate after Beck et al. (2023), Köppen-Geiger maps 1991 to 2020, CC BY 4.0, rivers, lakes, regions and seas from Natural Earth (public domain). One tile is about 20 km across.')}</p>` : ''}`, [[L('Verstanden', 'Got it'), null], [L('Tutorial nochmal', 'Replay tutorial'), () => { setTourOff(false); resetTour(this.app); startTour(this.app); }]]);
  }

  // ---------- Takt ----------
  update(st, frac, force) {
    this.updateTop(st, frac);
    this.updateCards();
    this.renderPrayers(st);
    if (st.chronicle.length !== this.chronSeen) this.renderChron(false);
    const now = performance.now();
    if (force || now - this.lastHeavy > 2000) {
      this.lastHeavy = now;
      if (document.body.classList.contains('left-open')) this.renderLeft();
      if (this.inspect && !document.querySelector('#inspector:hover')) this.refreshInspector();
    }
  }
}
