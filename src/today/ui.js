// Erde heute: Oberfläche. Kopfleiste (Datum, Menschen auf der Erde, Länder, Glaube, Klima, Kraft, Tempo), Weltbuch
// (Welt, Länder, Städte, dein Mensch), Nachrichten, Gebete, Kräfte im Dock, Karten für Städte, Länder und Menschen,
// Namensschilder auf Globus und in der Stadt, Startbild mit Wahl der Heimatstadt und des Menschen.
import * as THREE from 'three';
import * as D from '../sim/data.js';
import { L, LANG, setLang } from '../i18n.js';
import { TODAY, cityName, countryName, searchCities, citiesNear } from './data.js';
import { dateText, worldPop, fmtPop, cName, govName, GOV, relation, cityPop, metroPop, capitalAt, DPY, yearOf } from './sim.js';
import { citizen, makePerson, jobText } from './people.js';
import { ethnicList, religionList, worldGroups, median, relOne, REL_NAME as RELN } from './groups.js';
import { ecef } from '../earth3d/geo.js';

const $ = s => document.querySelector(s);
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const v3 = new THREE.Vector3();
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf = (n, d = 0) => Number(n || 0).toLocaleString(LANG === 'de' ? 'de-DE' : 'en-GB', { maximumFractionDigits: d });
const pct = (x, d = 1) => (x * 100).toLocaleString(LANG === 'de' ? 'de-DE' : 'en-GB', { maximumFractionDigits: d }) + ' %';
const money = n => n >= 1e12 ? nf(n / 1e12, 2) + L(' Bio. $', ' tn $') : n >= 1e9 ? nf(n / 1e9, 1) + L(' Mrd. $', ' bn $') : nf(n / 1e6, 0) + L(' Mio. $', ' m $');
const CARD = id => `assets/cards/${id}.webp`;
const ALLY = { EU: 'EU', EURO: 'Euro', SCHENGEN: 'Schengen', NATO: 'NATO', G7: 'G7', G20: 'G20', BRICS: 'BRICS', ASEAN: 'ASEAN', AU: L('Afrikanische Union', 'African Union'), ARAB: L('Arabische Liga', 'Arab League'), GCC: L('Golfrat', 'GCC'), MERCOSUR: 'Mercosur', CSTO: L('OVKS', 'CSTO'), SCO: L('SOZ', 'SCO'), OPEC: 'OPEC', OECD: 'OECD', CW: 'Commonwealth' };
const REL = { chr: L('Christentum', 'Christianity'), isl: L('Islam', 'Islam'), hin: L('Hinduismus', 'Hinduism'), bud: L('Buddhismus', 'Buddhism'), jud: L('Judentum', 'Judaism'), folk: L('Volksreligionen', 'Folk religions'), none: L('ohne Religion', 'unaffiliated'), other: L('andere', 'other') };
// Kräfte in der heutigen Welt (die Texte der Inselwelt sprechen von Inseln und Siedlungen)
const INFO = {
  regen: L('Regen über einem Land. Beendet Dürren, füllt Brunnen, erhört Gebete um Regen.', 'Rain over a country. Ends droughts, fills wells, answers prayers for rain.'),
  sonne: L('Sonne nach Flut und Grau. Die Straßen trocknen, die Menschen gehen raus.', 'Sun after floods and grey skies. Streets dry, people go outside.'),
  sturm: L('Ein Sturm über einer Stadt. Schäden, gestrichene Flüge, Angst macht fromm.', 'A storm over a city. Damage, cancelled flights, fear makes people devout.'),
  blitz: L('Ein Blitz an einem Ort. Ein Video davon geht um die Welt.', 'Lightning at one place. A video of it goes around the world.'),
  schnee: L('Schnee über einer Stadt. Kinder jubeln, der Verkehr steht.', 'Snow over a city. Children cheer, traffic stops.'),
  nebel: L('Dichter Nebel. Die Stadt wird still und geheimnisvoll.', 'Thick fog. The city turns quiet and mysterious.'),
  regenbogen: L('Ein Zeichen der Versöhnung. Kriege in der Nähe enden eher.', 'A sign of reconciliation. Nearby wars are more likely to end.'),
  segen: L('Rekordernte. Brot und Reis werden billiger, die Wirtschaft wächst.', 'Record harvest. Bread and rice get cheaper, the economy grows.'),
  fische: L('Fischschwärme vor der Küste. Volle Netze für ein Küstenland.', 'Shoals of fish off the coast. Full nets for a coastal country.'),
  beben: L('Die Erde bebt. Häuser fallen, Hilfe aus aller Welt kommt.', 'The earth shakes. Buildings fall, help arrives from all over the world.'),
  vulkan: L('Ein Vulkan bricht aus. Asche legt den Flugverkehr lahm, die Welt kühlt kurz ab.', 'A volcano erupts. Ash grounds air traffic, the world cools briefly.'),
  flut: L('Sturmflut. Das Meer steht in den Straßen einer Küstenstadt.', 'Storm surge. The sea stands in the streets of a coastal city.'),
  meteor: L('Ein Meteorit schlägt ein. Forscher und Sammler reisen an.', 'A meteorite strikes. Researchers and collectors arrive.'),
  traum: L('Ein Traum an eine Regierung (auf dem Globus) oder an deinen Menschen (in seiner Stadt). Visionen verändern Völker.', 'A dream for a government (on the globe) or for your person (in their city). Visions change nations.'),
  funke: L('Eine Idee fällt in einen Kopf. Erfindungen kommen schneller.', 'An idea falls into a mind. Inventions come sooner.'),
  komet: L('Ein Komet am Himmel. Jeder deutet ihn anders.', 'A comet in the sky. Everyone reads it differently.'),
  fremde: L('Ein Boot mit Menschen aus einem fernen Land erreicht eine Küste.', 'A boat with people from a distant land reaches a coast.'),
  heilung: L('Kranke stehen auf. Eine Seuche endet, man spricht von einem Wunder.', 'The sick rise. An epidemic ends, people speak of a miracle.'),
  seuche: L('Ein neues Virus. Es reist über die Flughäfen in die Nachbarländer.', 'A new virus. It travels through the airports into neighbouring countries.'),
};
const NEWSK = { welt: L('Welt', 'World'), politik: L('Politik', 'Politics'), wirtschaft: L('Wirtschaft', 'Economy'), krieg: L('Krieg', 'War'), frieden: L('Frieden', 'Peace'), natur: L('Natur', 'Nature'), seuche: L('Gesundheit', 'Health'), wissen: L('Wissen', 'Science'), gott: L('Geist', 'Spirit'), held: L('Dein Mensch', 'Your person') };

export class TodayUI {
  constructor(app) {
    this.app = app;
    this.tab = 'welt'; this.cat = 'wetter'; this.filter = 'alle'; this.detail = null;
    this.lbl = new Map();
    this.lblRoot = $('#labels');
    this.texts();
  }
  get ts() { return this.app.ts; }

  // feste Texte der Seite in der gewählten Sprache
  texts() {
    const set = (s, t, attr) => { const e = $(s); if (e) { if (attr) e.setAttribute(attr, t); else e.textContent = t; } };
    set('#intro .tag', L('Die Erde von heute. Jedes Land, jede Stadt, 8 Milliarden Menschen. Und du bist ihr Geist.', 'The Earth of today. Every country, every city, 8 billion people. And you are its spirit.'));
    set('#intro .claim', L('Stand 26. Oktober 2026', 'As of 26 October 2026'));
    set('#btnBook', L('Weltbuch (B)', 'World book (B)'), 'title');
    set('#btnNews', L('Nachrichten (C)', 'News (C)'), 'title');
    set('#btnHero', L('Dein Mensch (H)', 'Your person (H)'), 'title');
    set('#btnHome', L('Hoch ins All (G)', 'Up to orbit (G)'), 'title');
    set('#btnFly', L('Fliegen (P)', 'Fly (P)'), 'title');
    set('#btnMenu', L('Einstellungen', 'Settings'), 'title');
    set('#btnSound', L('Ton', 'Sound'), 'title');
    set('#left h2', L('Weltbuch', 'World book'));
    set('#chron h2', L('Nachrichten', 'News'));
    set('.mlabel span', L('Kraft', 'Power'));
  }

  // ---------- Startbild ----------
  intro(text, p) {
    if (text) $('#intro .status').textContent = text;
    if (p != null) $('#intro .progress i').style.width = Math.round(p * 100) + '%';
  }
  ready(hasWorld) {
    const go = $('#btnEnter'), nw = $('#btnNew');
    go.disabled = false;
    const ts = this.ts;
    if (hasWorld) {
      go.textContent = L('Weiterspielen', 'Continue');
      const hero = ts.hero ? ` ${L('Dein Mensch', 'Your person')}: ${ts.hero.name}, ${cityName(ts.hero.city, LANG)}.` : '';
      this.intro(`${dateText(ts.day)}. ${fmtPop(worldPop(ts))} ${L('Menschen', 'people')}.${hero}`, 1);
      go.onclick = () => this.app.start();
      nw.style.display = '';
      nw.textContent = L('Neue Erde heute beginnen', 'Begin a new Earth of today');
      nw.onclick = () => this.modal(`<h2>${L('Neu anfangen?', 'Start over?')}</h2><p>${L('Die jetzige Erde heute mit allem, was passiert ist, verschwindet. Deine Inselwelt und die Erde vom Anfang bleiben.', 'The current Earth of today with everything that has happened will vanish. Your island world and the Earth from the beginning stay.')}</p>`, [[L('Ja, neu', 'Yes, new'), () => this.startFlow()], [L('Abbrechen', 'Cancel'), null]]);
    } else {
      go.textContent = L('Die Erde betreten', 'Enter the Earth');
      this.intro(L('Wähle, wo deine Geschichte beginnt.', 'Choose where your story begins.'), 1);
      go.onclick = () => this.startFlow();
      nw.style.display = 'none';
    }
    const back = $('#btnWorlds');
    if (back) { back.textContent = L('Zu den anderen Welten', 'To the other worlds'); back.onclick = () => { try { localStorage.setItem('pfr.world', 'welt'); } catch { /* egal */ } location.href = 'index.html'; }; }
  }
  enterGame() {
    $('#intro').classList.add('gone');
    document.body.classList.add('playing');
    this.renderNews(true); this.renderPrayers(); this.update();
  }

  // Wahl der Heimatstadt, dann des Menschen
  startFlow() {
    const sug = ['Berlin', 'Tokyo', 'New York City', 'Marrakesh', 'Paris', 'London', 'Lagos', 'São Paulo', 'Mumbai', 'Istanbul', 'Seoul', 'Mexico City'];
    const idx = n => { const C = TODAY.cities; for (let i = 0; i < Math.min(C.n, 5000); i++) if (C.en[i] === n) return i; return -1; };
    const chips = sug.map(idx).filter(i => i >= 0).map(i => `<button class="pick" data-i="${i}">${esc(cityName(i, LANG))}</button>`).join('');
    const box = this.modal(`<h2>${L('Wo beginnt deine Geschichte?', 'Where does your story begin?')}</h2>
      <p>${L('Suche eine Stadt oder ein Dorf, irgendwo auf der Erde. Dort lebt dein Mensch.', 'Search for a city or a village anywhere on Earth. That is where your person lives.')}</p>
      <input id="citySearch" class="tsearch" placeholder="${L('Stadt suchen …', 'Search a city …')}" autocomplete="off">
      <div class="picks" id="cityHits">${chips}</div>`, [[L('Abbrechen', 'Cancel'), null]], 'wide');
    const inp = box.querySelector('#citySearch'), hits = box.querySelector('#cityHits');
    const bind = () => hits.querySelectorAll('.pick').forEach(b => { b.onclick = () => this.pickPerson(+b.dataset.i); });
    inp.oninput = () => {
      const r = searchCities(inp.value, 14);
      hits.innerHTML = r.length ? r.map(i => `<button class="pick" data-i="${i}">${esc(cityName(i, LANG))}<small>${esc(countryName(TODAY.byId.get(TODAY.cities.ctry[i]), LANG))} · ${fmtPop(TODAY.cities.pop[i])}</small></button>`).join('') : chips;
      bind();
    };
    bind();
    setTimeout(() => inp.focus(), 50);
  }
  pickPerson(ci) {
    const fake = { seed: (Date.now() & 0xffffff) >>> 0 };
    this.seedPick = fake.seed;
    const cards = [0, 1, 2, 3].map(k => {
      const p = makePerson(fake, ci, k, true);
      return `<button class="pcard" data-k="${k}"><b>${esc(p.name)}</b><span>${p.age} ${L('Jahre', 'years')} · ${esc(jobText(p.job))}</span><small>${p.partner ? L(`lebt mit ${esc(p.partner.name)}`, `lives with ${esc(p.partner.name)}`) : L('allein', 'single')}${p.nKids ? ' · ' + p.nKids + ' ' + L('Kinder', 'children') : ''}</small></button>`;
    }).join('');
    const box = this.modal(`<h2>${L('Wessen Leben lebst du?', 'Whose life do you live?')}</h2><p>${L(`Vier Menschen aus ${esc(cityName(ci, LANG))}. Du begleitest einen von ihnen, bis zum Ende und darüber hinaus.`, `Four people from ${esc(cityName(ci, LANG))}. You follow one of them, to the end and beyond.`)}</p><div class="pcards">${cards}</div>`, [[L('Zurück', 'Back'), () => this.startFlow()]], 'wide');
    box.querySelectorAll('.pcard').forEach(b => { b.onclick = () => { this.closeModal(); this.app.newWorld(ci, +b.dataset.k); this.app.ts.seed = this.seedPick; this.app.ts.hero = makePerson(this.app.ts, ci, +b.dataset.k, true); this.app.start(); }; });
  }

  // ---------- Leiste und Dock ----------
  build() {
    const dock = $('#dock');
    dock.innerHTML = '';
    const tabs = h('div', 'dock-tabs');
    for (const [k, name] of Object.entries(D.POWER_CATS)) {
      const b = h('button', 'dtab' + (k === this.cat ? ' on' : ''), name);
      b.onclick = () => { this.cat = k; tabs.querySelectorAll('.dtab').forEach(x => x.classList.toggle('on', x === b)); this.renderCards(); };
      tabs.append(b);
    }
    dock.append(tabs, h('div', 'cards'));
    this.renderCards();
    const lt = $('#left .tabs'); lt.innerHTML = '';
    for (const [k, n] of [['welt', L('Welt', 'World')], ['laender', L('Länder', 'Countries')], ['staedte', L('Städte', 'Cities')], ['mensch', L('Dein Mensch', 'Your person')]]) {
      const b = h('button', k === this.tab ? 'on' : '', n);
      b.onclick = () => { this.tab = k; this.detail = null; lt.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); this.renderBook(true); };
      lt.append(b);
    }
    const f = $('#chron .filters'); f.innerHTML = '';
    for (const [k, n] of [['alle', L('Alle', 'All')], ['politik', NEWSK.politik], ['krieg', NEWSK.krieg], ['natur', NEWSK.natur], ['wirtschaft', NEWSK.wirtschaft], ['wissen', NEWSK.wissen], ['gott', NEWSK.gott]]) {
      const b = h('button', k === this.filter ? 'on' : '', n);
      b.onclick = () => { this.filter = k; f.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); this.renderNews(true); };
      f.append(b);
    }
    $('#btnBook').onclick = () => this.toggleBook();
    $('#btnNews').onclick = () => this.toggleNews();
    $('#btnHero').onclick = () => this.openHero();
    $('#btnHome').onclick = () => { const [lon, lat] = this.app.earth.lonLatOfWorld(this.app.stage.controls.target); this.app.flyToLL(lon, lat, 1.4e6); };
    $('#btnMenu').onclick = () => this.menu();
    $('#btnFly').onclick = e => { e.currentTarget.blur(); this.flyMenu(); };
    $('#btnSound').onclick = () => { this.app.sound.toggle && this.app.sound.toggle(); };
    $('#left .close').onclick = () => document.body.classList.remove('left-open');
    $('#chron .close').onclick = () => document.body.classList.remove('chron-open');
    document.querySelectorAll('#speed button[data-s]').forEach(b => { b.onclick = e => { e.stopPropagation(); this.app.setSpeed(+b.dataset.s); $('#speed').classList.remove('open'); }; });
    const fb = $('#fastBtn'); if (fb) { fb.onclick = e => { e.stopPropagation(); $('#speed').classList.toggle('open'); }; document.addEventListener('click', () => $('#speed').classList.remove('open')); }
    this.syncSpeed();
  }
  renderCards() {
    const wrap = $('#dock .cards'); wrap.innerHTML = '';
    D.POWERS.filter(p => p.cat === this.cat).forEach((P, i) => {
      const c = h('button', 'card');
      c.dataset.id = P.id; c.dataset.prayed = L('Gebet', 'Prayer');
      c.innerHTML = `<img src="${CARD(P.id)}" alt="" loading="lazy"><div class="cfoot"><span class="cname">${P.name}</span><span class="ccost">${P.cost}</span></div><div class="ctip"><b>${P.name}</b><span>${INFO[P.id] || P.info}</span></div>`;
      c.onclick = () => this.app.choosePower(P.id);
      wrap.append(c);
    });
    this.syncPower();
  }
  syncPower() {
    const ts = this.ts, prayed = new Set((ts ? ts.prayers : []).map(p => p.power));
    document.querySelectorAll('#dock .card').forEach(c => {
      const P = D.POWER[c.dataset.id];
      c.classList.toggle('active', this.app.power === c.dataset.id);
      c.classList.toggle('poor', !!ts && ts.mana < P.cost);
      c.classList.toggle('prayed', prayed.has(c.dataset.id));
    });
    document.body.classList.toggle('aiming', !!this.app.power);
    const hint = $('#hint');
    if (hint) hint.textContent = this.app.power ? L(`${D.POWER[this.app.power].name}: klicke auf einen Ort der Erde`, `${D.POWER[this.app.power].name}: click a place on Earth`) : '';
  }
  syncSpeed() {
    document.querySelectorAll('#speed button[data-s]').forEach(b => b.classList.toggle('on', +b.dataset.s === this.app.speed && !this.app.paused));
  }

  update() {
    const ts = this.ts; if (!ts) return;
    $('#date').textContent = dateText(ts.day);
    $('#popN').textContent = fmtPop(worldPop(ts)).replace(' Milliarden', ' Mrd.').replace(' billion', ' bn');
    $('#ctryN').textContent = nf(TODAY.list.filter((c, i) => ts.c[i].pop > 0 && c.iso3 !== 'ATA').length);
    $('#faithN').textContent = Math.round(ts.w.faith * 100) + ' %';
    $('#tempN').textContent = '+' + ts.w.temp.toFixed(2) + ' °C';
    const ring = $('#manaRing'); if (ring) { const f = ts.mana / this.app.MANA_MAX; ring.style.strokeDasharray = `${f * 276.5} 276.5`; }
    $('#manaN').textContent = Math.floor(ts.mana); $('#manaMax').textContent = this.app.MANA_MAX;
    this.syncPower();
    if (document.body.classList.contains('left-open') && this.tab !== 'laender' && this.tab !== 'staedte') this.renderBook();
    this.placeBar();
  }
  // Ortsleiste oben: wo der Blick gerade ist (Stadt, Land oder Meer) und aus welcher Höhe
  placeBar() {
    const app = this.app, bar = $('#cityBar'), tg = app.stage.controls.target;
    if (!app.earth || !app.earth.ready || !document.body.classList.contains('playing')) { bar.innerHTML = ''; return; }
    const [lon, lat] = app.earth.lonLatOfWorld(tg), dist = app.stage.camera.position.distanceTo(tg) * 10;
    const ci = dist < 6e5 ? app.cityNear(lon, lat, Math.max(4, Math.min(60, dist / 4000))) : -1;
    const [tx, ty] = app.tileOfLL(lon, lat), id = TODAY.ctry[ty * 2048 + tx], K = id && TODAY.byId.get(id), ki = K ? TODAY.list.indexOf(K) : -1;
    const alt = dist < 1000 ? nf(dist) + ' m' : nf(dist / 1000, dist < 1e4 ? 1 : 0) + ' km';
    const key = ci + '|' + ki + '|' + alt;
    if (bar._key === key) return;
    bar._key = key;
    let title, sub;
    if (ci >= 0) { const C = TODAY.cities, c = TODAY.byId.get(C.ctry[ci]); title = (c ? c.flag + ' ' : '') + esc(cityName(ci, LANG)); sub = `${fmtPop(Math.max(cityPop(this.ts, ci), metroPop(this.ts, ci)))} ${L('Menschen', 'people')} · ${L('Blick aus', 'view from')} ${alt}`; }
    else if (K) { title = (K.flag || '') + ' ' + esc(cName(ki)); sub = `${L('Blick aus', 'view from')} ${alt}`; }
    else { title = dist > 3e6 ? L('Die Erde', 'Planet Earth') : L('Offenes Meer', 'Open sea'); sub = `${L('Blick aus', 'view from')} ${alt}`; }
    bar.innerHTML = `${dist > 2e5 ? '' : `<button id="cbBack">${L('↑ Ins All', '↑ Orbit')}</button>`}<div><b>${title}</b><small>${sub}</small></div>${ci >= 0 || K ? '<button id="cbInfo">i</button>' : ''}`;
    const up = bar.querySelector('#cbBack'); if (up) up.onclick = () => app.flyToLL(lon, lat, 1.4e6);
    const inf = bar.querySelector('#cbInfo'); if (inf) inf.onclick = () => { if (ci >= 0) this.inspectCity(ci); else this.inspectPlace(lon, lat); };
  }

  // ---------- Nachrichten ----------
  ticker(e) {
    if (e.imp < 2) return;
    const tk = $('#ticker');
    const el = h('div', 'tk', `<small>${esc(dateText(e.d))} · ${esc(NEWSK[e.k] || '')}</small>${esc(e.t)}`);
    if (e.x != null) el.onclick = () => this.app.flyTo(e.x + 0.5, e.y + 0.5, e.imp >= 3 ? 50 : 40);
    tk.prepend(el);
    while (tk.children.length > 3) tk.lastChild.remove();
    setTimeout(() => el.classList.add('old'), 14000);
    setTimeout(() => el.remove(), 30000);
    if (document.body.classList.contains('chron-open')) this.renderNews();
    // große Einblendung nur für Krieg, Frieden, Durchbrüche und Ereignisse im Land deines Menschen, höchstens alle 6 s
    const hero = this.ts.hero, mine = hero && e.c === hero.ctry;
    if ((e.k === 'krieg' || e.k === 'frieden' || e.k === 'wissen' || mine) && e.imp >= 2 && performance.now() - (this.lastBig || 0) > 6000) {
      this.lastBig = performance.now();
      this.toast(e.t.length > 130 ? e.t.slice(0, 128) + '…' : e.t, 'big');
    }
    this.renderPrayers();
  }
  renderNews(force) {
    const ts = this.ts; if (!ts) return;
    const list = $('#chron .list');
    if (!force && !document.body.classList.contains('chron-open')) return;
    const items = ts.news.filter(e => this.filter === 'alle' || e.k === this.filter || (this.filter === 'krieg' && e.k === 'frieden')).slice(-160).reverse();
    list.innerHTML = items.map((e, k) => `<div class="ce${e.imp >= 3 ? ' big' : ''}" data-k="${k}"><small>${esc(dateText(e.d))}${e.c >= 0 ? ' · ' + (TODAY.list[e.c].flag || '') + ' ' + esc(cName(e.c)) : ''}</small><p>${esc(e.t)}</p></div>`).join('');
    list.querySelectorAll('.ce').forEach(el => { const e = items[+el.dataset.k]; if (e.x != null) el.onclick = () => this.app.flyTo(e.x + 0.5, e.y + 0.5, 45); });
  }
  renderPrayers() {
    const ts = this.ts, box = $('#prayers'); if (!ts || !box) return;
    box.innerHTML = '';
    for (const p of ts.prayers.slice(-3).reverse()) {
      const C = TODAY.list[p.c];
      const el = h('button', 'prayer', `<img src="${CARD(p.power)}" alt=""><div><b>${C.flag || ''} ${esc(p.city >= 0 ? cityName(p.city, LANG) + ', ' : '')}${esc(cName(p.c))}</b><span>„${esc(p.text)}“</span></div>`);
      el.onclick = () => { const at = p.city >= 0 ? [TODAY.cities.tx[p.city], TODAY.cities.ty[p.city]] : capitalAt(p.c); this.app.flyTo(at[0] + 0.5, at[1] + 0.5, 50); this.app.power = p.power; this.syncPower(); };
      box.append(el);
    }
  }
  toggleNews() { document.body.classList.toggle('chron-open'); this.renderNews(true); }

  // ---------- Weltbuch ----------
  toggleBook() { document.body.classList.toggle('left-open'); this.renderBook(true); }
  openHero() { document.body.classList.add('left-open'); this.tab = 'mensch'; $('#left .tabs').querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === 3)); this.renderBook(true); }
  closeAll() { document.body.classList.remove('left-open', 'chron-open'); $('#inspector').classList.remove('show'); }
  renderBook(force) {
    const ts = this.ts, body = $('#left .body'); if (!ts) return;
    if (this.detail && this.detail.k === 'ctry') { body.innerHTML = this.countryHtml(this.detail.i); this.bindCountry(body, this.detail.i); return; }
    if (this.tab === 'welt') body.innerHTML = this.worldHtml();
    else if (this.tab === 'mensch') body.innerHTML = this.heroHtml();
    else if (force && this.tab === 'laender') this.countriesList(body);
    else if (force && this.tab === 'staedte') this.citiesList(body);
    body.querySelectorAll('[data-ctry]').forEach(e => { e.onclick = () => { this.detail = { k: 'ctry', i: +e.dataset.ctry }; this.renderBook(true); }; });
    body.querySelectorAll('[data-city]').forEach(e => { e.onclick = () => this.app.flyToCity(+e.dataset.city, e.dataset.enter === '1'); });
  }
  worldHtml() {
    const ts = this.ts, w = ts.w;
    let gdp = 0; for (const c of ts.c) gdp += c.gdp;
    const wars = ts.wars.map(W => `<li data-ctry="${W.a}">${TODAY.list[W.a].flag || ''}${W.b >= 0 ? ' ' + (TODAY.list[W.b].flag || '') : ''} ${esc(L(W.name.de, W.name.en))} <small>${L('seit', 'since')} ${W.since < 0 ? yearOf(W.since) : esc(dateText(W.since, false))}</small></li>`).join('') || `<li>${L('Kein Krieg zwischen Staaten.', 'No war between states.')}</li>`;
    const done = w.done.length ? w.done.map(id => `<li>${esc(id)}</li>`).join('') : '';
    return `<div class="tbook">
      <h3>${esc(dateText(ts.day))}</h3>
      <div class="kv"><span>${L('Menschen auf der Erde', 'People on Earth')}</span><b>${nf(worldPop(ts))}</b></div>
      <div class="kv"><span>${L('Geboren seit dem 26.10.2026', 'Born since 26 Oct 2026')}</span><b>${nf(w.births)}</b></div>
      <div class="kv"><span>${L('Gestorben', 'Died')}</span><b>${nf(w.deaths)}</b></div>
      <div class="kv"><span>${L('Weltwirtschaft', 'World economy')}</span><b>${money(gdp)}</b></div>
      <div class="kv"><span>${L('Erwärmung seit 1850', 'Warming since 1850')}</span><b>+${w.temp.toFixed(2)} °C</b></div>
      <div class="kv"><span>CO₂</span><b>${w.co2.toFixed(0)} ppm</b></div>
      <div class="kv"><span>${L('Meeresspiegel seit Start', 'Sea level since start')}</span><b>+${w.sea.toFixed(1)} cm</b></div>
      <div class="kv"><span>${L('Glaube der Welt', 'Faith of the world')}</span><b>${Math.round(w.faith * 100)} %</b></div>
      <div class="kv"><span>${L('Erhörte Gebete', 'Answered prayers')}</span><b>${nf(ts.counts.answered)}</b></div>
      ${(() => { const g = worldGroups(ts); const top = Object.entries(g.rel).sort((a, b) => b[1] - a[1]).slice(0, 6); return `<h4>${L('Die Menschheit', 'Humankind')}</h4>
      <div class="kv"><span>${L('Mittleres Alter', 'Median age')}</span><b>${g.median.toFixed(1)} ${L('Jahre', 'years')}</b></div>
      <div class="kv"><span>${L('Unter 15, über 65', 'Under 15, over 65')}</span><b>${pct(g.young, 0)} / ${pct(g.old, 0)}</b></div>
      <div class="kv"><span>${L('In Städten', 'In cities')}</span><b>${pct(g.urban, 0)}</b></div>
      <div class="kv"><span>${L('Leben nicht in ihrem Geburtsland', 'Live outside their country of birth')}</span><b>${fmtPop(g.migrants)}</b></div>
      <div class="kv"><span>${L('Unter 3 $ am Tag', 'Below $3 a day')}</span><b>${fmtPop(g.poor)}</b></div>
      <div class="kv"><span>${L('Lebenserwartung Frauen, Männer', 'Life expectancy women, men')}</span><b>${g.lifeF.toFixed(1)} / ${g.lifeM.toFixed(1)}</b></div>
      <h5>${L('Glaube der Menschheit', 'Faith of humankind')}</h5>${top.map(([k, v]) => `<div class="gbar rel"><span>${esc(RELN[k] || k)}</span><i style="width:${(v * 100).toFixed(1)}%"></i><b>${pct(v, 0)}</b></div>`).join('')}`; })()}
      <h4>${L('Kriege und Konflikte', 'Wars and conflicts')}</h4><ul class="tl">${wars}</ul>
      <h4>${L('Die größten Länder', 'Largest countries')}</h4><ul class="tl">${ts.c.map((c, i) => [i, c.pop]).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([i, p]) => `<li data-ctry="${i}">${TODAY.list[i].flag || ''} ${esc(cName(i))} <small>${fmtPop(p)}</small></li>`).join('')}</ul>
      <h4>${L('Durchbrüche seit Spielbeginn', 'Breakthroughs since the start')}</h4><ul class="tl">${done ? ts.news.filter(e => e.k === 'wissen').map(e => `<li>${esc(e.t)}</li>`).join('') : `<li>${L('Noch keine. Der Funke der Erkenntnis hilft.', 'None yet. The Spark of Insight helps.')}</li>`}</ul>
    </div>`;
  }
  countriesList(body) {
    body.innerHTML = `<div class="tbook"><input class="tsearch" id="ctrySearch" placeholder="${L('Land suchen …', 'Search a country …')}"><div class="sortrow"><button data-s="pop" class="on">${L('Menschen', 'People')}</button><button data-s="gdppc">${L('Wohlstand', 'Wealth')}</button><button data-s="name">${L('Name', 'Name')}</button></div><ul class="tl" id="ctryList"></ul></div>`;
    let sort = 'pop';
    const draw = () => {
      const q = body.querySelector('#ctrySearch').value.toLowerCase(), ts = this.ts;
      const rows = TODAY.list.map((c, i) => i).filter(i => ts.c[i].pop > 0 && (!q || (TODAY.list[i].de + ' ' + TODAY.list[i].en).toLowerCase().includes(q)));
      rows.sort((a, b) => sort === 'name' ? cName(a).localeCompare(cName(b)) : sort === 'gdppc' ? ts.c[b].gdp / ts.c[b].pop - ts.c[a].gdp / ts.c[a].pop : ts.c[b].pop - ts.c[a].pop);
      body.querySelector('#ctryList').innerHTML = rows.map(i => `<li data-ctry="${i}">${TODAY.list[i].flag || ''} ${esc(cName(i))} <small>${fmtPop(ts.c[i].pop)} · ${nf(ts.c[i].gdp / ts.c[i].pop)} $</small></li>`).join('');
      body.querySelectorAll('[data-ctry]').forEach(e => { e.onclick = () => { this.detail = { k: 'ctry', i: +e.dataset.ctry }; this.renderBook(true); }; });
    };
    body.querySelector('#ctrySearch').oninput = draw;
    body.querySelectorAll('.sortrow button').forEach(b => { b.onclick = () => { sort = b.dataset.s; body.querySelectorAll('.sortrow button').forEach(x => x.classList.toggle('on', x === b)); draw(); }; });
    draw();
  }
  citiesList(body) {
    const C = TODAY.cities;
    body.innerHTML = `<div class="tbook"><input class="tsearch" id="citySearch2" placeholder="${L('Eine von ', 'One of ')}${nf(C.n)} ${L('Städten und Orten suchen …', 'cities and towns, search …')}"><ul class="tl" id="cityList"></ul></div>`;
    const draw = () => {
      const q = body.querySelector('#citySearch2').value;
      let rows = q ? searchCities(q, 60) : [];
      if (!q) { const seen = []; for (let i = 0; i < C.n && seen.length < 80; i++) seen.push(i); rows = seen.sort((a, b) => Math.max(C.metro[b], C.pop[b]) - Math.max(C.metro[a], C.pop[a])); }
      body.querySelector('#cityList').innerHTML = rows.map(i => `<li><span data-city="${i}">${TODAY.byId.get(C.ctry[i])?.flag || ''} ${esc(cityName(i, LANG))} <small>${fmtPop(Math.max(metroPop(this.ts, i), cityPop(this.ts, i)))}</small></span><button class="mini" data-city="${i}" data-enter="1">${L('hinfliegen', 'fly there')}</button></li>`).join('');
      body.querySelectorAll('[data-city]').forEach(e => { e.onclick = ev => { ev.stopPropagation(); this.app.flyToCity(+e.dataset.city, e.dataset.enter === '1'); }; });
    };
    body.querySelector('#citySearch2').oninput = draw;
    draw();
  }
  countryHtml(i) {
    const ts = this.ts, C = TODAY.list[i], c = ts.c[i];
    const capI = TODAY.capitalOf.get(C.id);
    const rels = TODAY.list.map((o, j) => j).filter(j => j !== i && ts.c[j].pop > 0).map(j => [j, relation(ts, i, j)]).sort((a, b) => b[1] - a[1]);
    const friends = rels.slice(0, 5), foes = rels.slice(-4).reverse().filter(x => x[1] < 0);
    const relHtml = arr => arr.map(([j, v]) => `<li data-ctry="${j}">${TODAY.list[j].flag || ''} ${esc(cName(j))} <small>${v > 0 ? '+' : ''}${Math.round(v)}</small></li>`).join('');
    const rel = Object.entries(C.rel || {}).filter(([, v]) => v >= 0.01).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${REL[k] || k} ${Math.round(v * 100)} %`).join(', ');
    const wars = ts.wars.filter(W => W.a === i || W.b === i);
    const ne = c.nextE >= 0 ? dateText(c.nextE, false) : L('keine freie Wahl vorgesehen', 'no free election planned');
    return `<div class="tbook">
      <button class="back" id="bkBack">‹ ${L('Zurück', 'Back')}</button>
      <h3 class="flagh"><span class="flag">${C.flag || ''}</span>${esc(cName(i))}</h3>
      <p class="sub">${esc(govName(c.gov))} · ${L('Hauptstadt', 'Capital')} ${capI != null ? `<a data-city="${capI}">${esc(cityName(capI, LANG))}</a>` : esc(L(C.capital?.de, C.capital?.en))}</p>
      <div class="kv"><span>${L('Einwohner', 'Population')}</span><b>${nf(c.pop)}</b></div>
      <div class="kv"><span>${L('Geburten, Sterbefälle je 1000', 'Births, deaths per 1,000')}</span><b>${c.b.toFixed(1)} / ${c.d.toFixed(1)}</b></div>
      <div class="kv"><span>${L('Wirtschaft', 'Economy')}</span><b>${money(c.gdp)}</b></div>
      <div class="kv"><span>${L('Je Mensch', 'Per person')}</span><b>${nf(c.gdp / Math.max(1, c.pop))} $</b></div>
      <div class="kv"><span>${L('Wachstum', 'Growth')}</span><b>${pct(c.g)}</b></div>
      <div class="kv"><span>${L('Teuerung', 'Inflation')}</span><b>${pct(c.infl)}</b></div>
      <div class="kv"><span>${L('Arbeitslos', 'Unemployed')}</span><b>${pct(c.unemp)}</b></div>
      <h4>${L('Regierung', 'Government')}</h4>
      <div class="kv"><span>${esc(L(C.headDe || 'Regierungschef', C.head || 'Head of government'))}</span><b>${esc(c.lead)}</b></div>
      <div class="kv"><span>${L('Zustimmung', 'Approval')}</span><b>${Math.round(c.appr * 100)} %</b></div>
      <div class="kv"><span>${L('Stabilität', 'Stability')}</span><b>${Math.round(c.stab * 100)} %</b></div>
      <div class="kv"><span>${L('Nächste Wahl', 'Next election')}</span><b>${esc(ne)}</b></div>
      <p class="note">${L('Ämter, Staatsform und Wahltermine sind echt, die Namen der Amtsträger im Spiel sind erfunden.', 'Offices, form of government and election dates are real, the names of office holders in the game are invented.')}</p>
      ${wars.length ? `<h4>${L('Krieg', 'War')}</h4><ul class="tl">${wars.map(W => `<li>${esc(L(W.name.de, W.name.en))}</li>`).join('')}</ul>` : ''}
      <h4>${L('Bündnisse', 'Alliances')}</h4><p>${(C.allies || []).map(a => ALLY[a] || a).join(', ') || '–'}</p>
      <h4>${L('Freunde', 'Friends')}</h4><ul class="tl">${relHtml(friends)}</ul>
      ${foes.length ? `<h4>${L('Spannungen', 'Tensions')}</h4><ul class="tl">${relHtml(foes)}</ul>` : ''}
      ${this.peopleHtml(i, rel)}
      <h4>${L('Größte Städte', 'Largest cities')}</h4><ul class="tl">${this.citiesOf(C.id, 8).map(k => `<li><span data-city="${k}">${esc(cityName(k, LANG))} <small>${fmtPop(Math.max(metroPop(ts, k), cityPop(ts, k)))}</small></span><button class="mini" data-city="${k}" data-enter="1">${L('hinfliegen', 'fly there')}</button></li>`).join('')}</ul>
    </div>`;
  }
  // Menschen eines Landes: Alter, Herkunft, Sprachen, Glaube, Zugewanderte, Stadt und Land, Armut (groups.js)
  peopleHtml(i, relFallback) {
    const ts = this.ts, C = TODAY.list[i], c = ts.c[i], P = c.pg, G = C.grp;
    if (!P || !G) return `<h4>${L('Menschen', 'People')}</h4><p>${esc(L(C.langDe || '', C.langEn || ''))}${relFallback ? ' · ' + esc(relFallback) : ''}</p>`;
    const bar = (name, v, cls = '', extra = '') => `<div class="gbar ${cls}"><span>${esc(name)}${extra}</span><i style="width:${Math.max(1.5, Math.min(100, v * 100)).toFixed(1)}%"></i><b>${pct(v, v < 0.1 ? 1 : 0)}</b></div>`;
    const eth = ethnicList(ts, i).slice(0, 8), rel = religionList(ts, i).slice(0, 7), lang = (G.lang || []).slice(0, 5);
    const orig = Object.entries(P.o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([iso, v]) => { const S = TODAY.byIso.get(iso); if (!S) return ''; const j = TODAY.list.indexOf(S); return `<li data-ctry="${j}">${S.flag || ''} ${esc(cName(j))} <small>${pct(v, 0)}</small></li>`; }).join('');
    const est = new Set(G.est || []), mark = k => est.has(k) ? ` <small class="est">${L('geschätzt', 'estimate')}</small>` : '';
    return `<h4>${L('Menschen', 'People')}</h4>
      <div class="ages"><div style="flex:${P.a[0]}"><b>${pct(P.a[0], 0)}</b><small>${L('unter 15', 'under 15')}</small></div><div style="flex:${P.a[1]}"><b>${pct(P.a[1], 0)}</b><small>15 ${L('bis', 'to')} 64</small></div><div style="flex:${Math.max(0.04, P.a[2])}"><b>${pct(P.a[2], 0)}</b><small>65+</small></div></div>
      <div class="kv"><span>${L('Mittleres Alter', 'Median age')}</span><b>${median(c).toFixed(1)} ${L('Jahre', 'years')}</b></div>
      <div class="kv"><span>${L('Lebenserwartung Frauen, Männer', 'Life expectancy women, men')}</span><b>${P.lf.toFixed(0)} / ${P.lm.toFixed(0)}</b></div>
      <div class="kv"><span>${L('In Städten, auf dem Land', 'Urban, rural')}</span><b>${pct(P.u, 0)} / ${pct(1 - P.u, 0)}</b></div>
      <div class="kv"><span>${L('Unter 3 $ am Tag', 'Below $3 a day')}</span><b>${pct(P.pv, P.pv < 0.1 ? 1 : 0)}</b></div>
      <div class="kv"><span>${L('Ungleichheit (Gini)', 'Inequality (Gini)')}</span><b>${P.gi.toFixed(0)}</b></div>
      <div class="kv"><span>${L('Lesen und Schreiben', 'Literacy')}</span><b>${pct(P.li, 0)}</b></div>
      <h5>${L('Herkunft und Volksgruppen', 'Origins and ethnic groups')}${mark('ethnic')}</h5>${eth.map(e => bar(e.name, e.share, e.iso ? 'new' : '')).join('')}
      <h5>${L('Glaube', 'Religion')}${mark('rel')}</h5>${rel.map(r => bar(r.name, r.share, 'rel')).join('')}
      ${lang.length ? `<h5>${L('Sprachen', 'Languages')}${mark('lang')}</h5><p>${lang.map(l => `${esc(L(l[0], l[1]))} ${pct(l[2], 0)}`).join(' · ')}${G.multi ? ` <small>${L('(viele sprechen mehrere)', '(many speak several)')}</small>` : ''}</p>` : ''}
      <h5>${L('Zugewanderte', 'Immigrants')}: ${pct(P.m, 1)} <small>(${fmtPop(P.m * c.pop)})</small></h5>${orig ? `<ul class="tl">${orig}</ul>` : ''}
      ${C.curName ? `<p class="note">${L('Währung', 'Currency')}: ${esc(C.curName)}</p>` : ''}`;
  }
  citiesOf(id, n) { const C = TODAY.cities, out = []; for (let i = 0; i < C.n && out.length < n * 3; i++) if (C.ctry[i] === id) out.push(i); return out.sort((a, b) => Math.max(C.metro[b], C.pop[b]) - Math.max(C.metro[a], C.pop[a])).slice(0, n); }
  bindCountry(body, i) {
    body.querySelector('#bkBack').onclick = () => { this.detail = null; this.renderBook(true); };
    body.querySelectorAll('[data-ctry]').forEach(e => { e.onclick = () => { this.detail = { k: 'ctry', i: +e.dataset.ctry }; this.renderBook(true); }; });
    body.querySelectorAll('[data-city]').forEach(e => { e.onclick = ev => { ev.stopPropagation(); this.app.flyToCity(+e.dataset.city, e.dataset.enter === '1'); }; });
  }
  heroHtml() {
    const H = this.ts.hero;
    if (!H) return `<div class="tbook"><p>${L('Du begleitest gerade keinen Menschen.', 'You are not following anyone right now.')}</p></div>`;
    const age = Math.floor(H.age);
    return `<div class="tbook">
      <h3>${esc(H.name)}</h3>
      <p class="sub">${H.alive === false ? L('verstorben', 'deceased') : `${age} ${L('Jahre', 'years')} · ${esc(jobText(H.job))}`} · <a data-city="${H.city}" data-enter="1">${esc(cityName(H.city, LANG))}</a>${H.gen > 1 ? ' · ' + L(`${H.gen}. Generation`, `generation ${H.gen}`) : ''}</p>
      ${H.partner ? `<div class="kv"><span>${H.partner.wed ? L('Verheiratet mit', 'Married to') : L('Zusammen mit', 'Together with')}</span><b>${esc(H.partner.name)}</b></div>` : ''}
      ${H.kids.length ? `<div class="kv"><span>${L('Kinder', 'Children')}</span><b>${H.kids.map(k => esc(k.name)).join(', ')}</b></div>` : ''}
      <h4>${L('Lebenslauf', 'Life')}</h4><ul class="tl log">${H.log.slice(-40).reverse().map(e => `<li><small>${esc(dateText(e.d, false))}</small> ${esc(e.t)}</li>`).join('')}</ul>
    </div>`;
  }

  // ---------- Karten (Inspector) ----------
  inspectCity(i) {
    const ts = this.ts, C = TODAY.cities, ctry = TODAY.byId.get(C.ctry[i]), ci = ctry ? TODAY.list.indexOf(ctry) : -1;
    const box = $('#inspector');
    const metro = metroPop(ts, i), pop = cityPop(ts, i);
    const cap = C.flag[i] & 1;
    const lm = TODAY.landmarks.filter(l => Math.abs(l.lat - C.lat[i]) < 0.25 && Math.abs(l.lon - C.lon[i]) < 0.35).slice(0, 6);
    const isHome = ts.hero && ts.hero.city === i;
    box.innerHTML = `<button class="x">×</button>
      <h3>${ctry ? ctry.flag + ' ' : ''}${esc(cityName(i, LANG))}</h3>
      <p class="sub">${cap ? L('Hauptstadt von ', 'Capital of ') : ''}<a data-ctry="${ci}">${esc(ci >= 0 ? cName(ci) : '')}</a>${isHome ? ' · ' + L('hier lebt dein Mensch', 'your person lives here') : ''}</p>
      <div class="kv"><span>${L('Einwohner', 'Inhabitants')}</span><b>${nf(pop)}</b></div>
      ${metro > pop ? `<div class="kv"><span>${L('Großraum', 'Metro area')}</span><b>${nf(metro)}</b></div>` : ''}
      ${(ts.cdmg[i] || 0) > 0.05 ? `<div class="kv"><span>${L('Schäden', 'Damage')}</span><b>${Math.round(ts.cdmg[i] * 100)} %</b></div>` : ''}
      ${lm.length ? `<h4>${L('Sehenswürdigkeiten', 'Landmarks')}</h4><div class="lms">${lm.map((l, k) => `<button class="mini" data-lm="${k}">${esc(L(l.de, l.en))}</button>`).join('')}</div>` : ''}
      <div class="btns"><button class="go" id="insEnter">${L('Hinfliegen', 'Fly there')}</button><button id="insCtry">${L('Land ansehen', 'View country')}</button></div>`;
    box.classList.add('show');
    box.querySelector('.x').onclick = () => box.classList.remove('show');
    const en = box.querySelector('#insEnter'); if (en) en.onclick = () => { box.classList.remove('show'); this.app.flyToCity(i); };
    box.querySelector('#insCtry').onclick = () => { this.detail = { k: 'ctry', i: ci }; document.body.classList.add('left-open'); this.renderBook(true); };
    box.querySelectorAll('[data-lm]').forEach(b => { b.onclick = () => { box.classList.remove('show'); const l = lm[+b.dataset.lm]; this.app.flyToLL(l.lon, l.lat, Math.max(45, (l.h || 60) / 10 * 2.6)); }; });
    box.querySelectorAll('[data-ctry]').forEach(b => { b.onclick = () => { this.detail = { k: 'ctry', i: +b.dataset.ctry }; document.body.classList.add('left-open'); this.renderBook(true); }; });
  }
  inspectPlace(lon, lat) {
    const [x, y] = this.app.tileOfLL(lon, lat), id = TODAY.ctry[y * 2048 + x], C = id && TODAY.byId.get(id);
    const box = $('#inspector');
    if (!C) { box.classList.remove('show'); return; }
    const i = TODAY.list.indexOf(C), near = citiesNear(x, y, 12).slice(0, 4);
    box.innerHTML = `<button class="x">×</button><h3>${C.flag || ''} ${esc(cName(i))}</h3><p class="sub">${esc(govName(this.ts.c[i].gov))}</p>
      ${near.length ? `<h4>${L('In der Nähe', 'Nearby')}</h4><ul class="tl">${near.map(k => `<li data-city="${k}">${esc(cityName(k, LANG))} <small>${fmtPop(cityPop(this.ts, k))}</small></li>`).join('')}</ul>` : ''}
      <div class="btns"><button id="insCtry">${L('Land ansehen', 'View country')}</button></div>`;
    box.classList.add('show');
    box.querySelector('.x').onclick = () => box.classList.remove('show');
    box.querySelector('#insCtry').onclick = () => { this.detail = { k: 'ctry', i }; document.body.classList.add('left-open'); this.renderBook(true); };
    box.querySelectorAll('[data-city]').forEach(b => { b.onclick = () => this.inspectCity(+b.dataset.city); });
  }
  showCitizen(who) {
    const p = citizen(this.ts, who.city, who.n), box = $('#inspector'), ctry = TODAY.list[p.ctry];
    const c = this.ts.c[p.ctry];
    const mood = c ? (c.appr + p.mood * 0.4 - 0.2) : p.mood;
    const think = this.ts.news.slice(-6).reverse().find(e => e.c === p.ctry || e.imp >= 3);
    const thought = think ? L(`Gerade denkt ${p.sex === 'f' ? 'sie' : 'er'} an die Nachricht: „${think.t.slice(0, 110)}${think.t.length > 110 ? '…' : ''}“`, `Right now ${p.sex === 'f' ? 'she' : 'he'} is thinking about the news: “${think.t.slice(0, 110)}${think.t.length > 110 ? '…' : ''}”`) : '';
    box.innerHTML = `<button class="x">×</button><h3>${esc(p.name)}</h3>
      <p class="sub">${2026 + Math.floor(this.ts.day / DPY) - p.born} ${L('Jahre', 'years')} · ${esc(jobText(p.job))}</p>
      <div class="kv"><span>${L('Aufgewachsen in', 'Grew up in')}</span><b>${esc(p.from)}</b></div>
      ${p.partner ? `<div class="kv"><span>${L('Lebt mit', 'Lives with')}</span><b>${esc(p.partner)}</b></div>` : ''}
      ${p.kids ? `<div class="kv"><span>${L('Kinder', 'Children')}</span><b>${p.kids}</b></div>` : ''}
      ${p.eth ? `<div class="kv"><span>${L('Herkunft', 'Background')}</span><b>${esc(p.eth)}</b></div>` : ''}
      <div class="kv"><span>${L('Stimmung', 'Mood')}</span><b>${mood > 0.6 ? L('zufrieden', 'content') : mood > 0.4 ? L('es geht so', 'so-so') : L('besorgt', 'worried')}</b></div>
      <div class="kv"><span>${L('Glaube', 'Faith')}</span><b>${p.rel ? esc(relOne(p.rel)) : p.faith < (ctry ? 1 - ((ctry.rel || {}).none ?? 0.2) : 0.6) ? L('gläubig', 'religious') : L('nicht gläubig', 'not religious')}</b></div>
      ${thought ? `<p class="note">${esc(thought)}</p>` : ''}`;
    box.classList.add('show');
    box.querySelector('.x').onclick = () => box.classList.remove('show');
  }

  // ---------- Namensschilder ----------
  // jedes Schild behält sein Element, je Bild ändert sich nur die Lage (sonst stockt der Browser bei vielen Schildern)
  // Nah: Viertel, Orte, Sehenswürdigkeiten aus den Kacheln. Weiter oben: Städte nach Größe, dann Länder. Was hinter
  // dem Horizont liegt, bekommt kein Schild. Die Auswahl wechselt nur alle paar Bilder, die Lage jedes Bild.
  labels(dist) {
    const app = this.app, cam = app.stage.camera, earth = app.earth, W = innerWidth, H = innerHeight, v = new THREE.Vector3(), seen = new Set();
    if (!earth || !earth.ready || !app.ts) return;
    if (!this.lblItems || (this.lblTick = (this.lblTick || 0) + 1) % 8 === 0) this.lblItems = this.pickLabels(dist);
    const items = this.lblItems.slice();
    const hp = app.life.group.visible && app.life.heroPos();
    if (hp) items.push({ key: 'hero', x: hp.x, y: hp.y + 0.42, z: hp.z, text: '★ ' + hp.name, cls: 'cl hero', pr: 1e13 });
    // Horizont: ein Punkt ist sichtbar, wenn die Kamera über seiner Tangentialebene liegt
    const ce = earth.ecefOf(cam.position), o = earth.F.o, shown = [];
    for (const it of items) {
      if (it.e3) {
        const e = it.e3;
        if (e[0] * ce[0] + e[1] * ce[1] + e[2] * ce[2] < (e[0] * e[0] + e[1] * e[1] + e[2] * e[2]) * 1.0000005) continue;
        v.set(e[0] - o[0], e[1] - o[1], e[2] - o[2]).applyMatrix4(earth.M);
      } else v.set(it.x, it.y, it.z);
      v.project(cam);
      if (!(v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05)) continue;
      shown.push([it, (v.x + 1) / 2 * W, (1 - v.y) / 2 * H]);
    }
    // keine Schilder übereinander: die wichtigsten zuerst, was sich mit einem schon gesetzten überdeckt, bleibt weg
    shown.sort((a, b) => (b[0].pr || 0) - (a[0].pr || 0));
    const boxes = [];
    for (const [it, sx, sy] of shown) {
      const bw = it.text.length * (it.cls === 'kl' ? 8.5 : 7) + 14, bh = 18, x0 = sx - bw / 2, y0 = sy - bh;
      if (boxes.some(b => x0 < b[2] && x0 + bw > b[0] && y0 < b[3] && y0 + bh > b[1])) continue;
      boxes.push([x0, y0, x0 + bw, y0 + bh]);
      seen.add(it.key);
      let e = this.lbl.get(it.key);
      if (!e) { e = h('div', it.cls, esc(it.text)); if (it.city != null) { e.onclick = () => this.inspectCity(it.city); e.ondblclick = () => app.flyToCity(it.city); } this.lblRoot.append(e); this.lbl.set(it.key, e); }
      e.style.transform = `translate(${sx.toFixed(0)}px, ${sy.toFixed(0)}px) translate(-50%, -100%)`;
    }
    for (const [k, e] of this.lbl) if (!seen.has(k)) { e.remove(); this.lbl.delete(k); }
  }
  pickLabels(dist) {
    const app = this.app, earth = app.earth, cam = app.stage.camera, tg = app.stage.controls.target, C = TODAY.cities, items = [];
    if (dist < 2500) for (const l of earth.labelsNear(tg, 34)) {
      const d = cam.position.distanceTo(v3.set(l.x, l.y, l.z));
      if (l.k === 'place' ? d < 25 || d > 1500 : l.k === 'lm' ? d > 1200 : d > 120) continue;
      items.push({ key: 'c' + l.name + Math.round(l.x), x: l.x, y: l.y + (l.k === 'lm' ? 0.6 : (l.h || (l.k === 'place' ? 6 : 2.5)) + 0.6), z: l.z, text: l.name, cls: 'cl ' + l.k, pr: l.k === 'lm' ? 1e12 : l.k === 'place' ? 5e9 : 1e9 - d });
    }
    // Städte: Einwohnergrenze nach Abstand (Einheiten zu 10 m)
    const minPop = dist > 1.6e6 ? 8e6 : dist > 8e5 ? 3e6 : dist > 4e5 ? 1e6 : dist > 2e5 ? 3e5 : dist > 8e4 ? 1e5 : dist > 3e4 ? 2e4 : dist > 1500 ? 4000 : Infinity;
    if (minPop < Infinity) {
      const [lon0, lat0] = earth.lonLatOfWorld(tg), km = Math.min(9000, dist * 0.022 + 30);
      const near = dist < 8e4 ? citiesNear(...app.tileOfLL(lon0, lat0), Math.ceil(km / 18) + 1) : null;
      const list = near || C.order || (C.order = Array.from({ length: C.n }, (_, i) => i));
      let n = 0;
      const ce = earth.ecefOf(cam.position), v4 = new THREE.Vector3();
      for (const i of list) {
        const pop = Math.max(C.pop[i], C.metro[i]);
        if (pop < minPop && !((C.flag[i] & 1) && dist < 6e5)) { if (!near && pop < minPop * 0.2) break; continue; }
        const dl = (C.lat[i] - lat0) * 111, dn = (((C.lon[i] - lon0 + 540) % 360) - 180) * 111 * Math.cos(lat0 * Math.PI / 180);
        if (dist < 1e6 && Math.hypot(dl, dn) > km) continue;
        // nur was vor dem Horizont und im Bild liegt, zählt für die Höchstzahl
        const e = ecef(C.lon[i], C.lat[i], 0);
        if (e[0] * ce[0] + e[1] * ce[1] + e[2] * ce[2] < (e[0] * e[0] + e[1] * e[1] + e[2] * e[2]) * 1.0000005) continue;
        v4.set(e[0] - earth.F.o[0], e[1] - earth.F.o[1], e[2] - earth.F.o[2]).applyMatrix4(earth.M).project(cam);
        if (v4.z > 1 || Math.abs(v4.x) > 1.1 || Math.abs(v4.y) > 1.1) continue;
        items.push({ key: 'g' + i, e3: e, text: cityName(i, LANG), cls: 'gl' + (C.flag[i] & 1 ? ' cap' : '') + (pop > 5e6 ? ' mega' : ''), city: i, pr: pop * (C.flag[i] & 1 ? 3 : 1) });
        if (++n >= 45) break;
      }
    }
    if (dist > 1.5e5) for (let i = 0; i < TODAY.list.length; i++) {
      const K = TODAY.list[i]; if (!K.tiles || K.tiles < (dist > 1.2e6 ? 400 : dist > 4e5 ? 120 : 10) || K.iso3 === 'ATA') continue;
      const [lon, lat] = app.llOfTile(K.cx ?? K.tx, K.cy ?? K.ty);
      items.push({ key: 'k' + i, e3: ecef(lon, lat, 0), text: cName(i).toUpperCase(), cls: 'kl', pr: K.tiles * 1.5e4 });
    }
    return items;
  }

  // Flugzeug wählen (seit 27.10.2026): Sportflugzeug der Inseln oder Düsenjet, Start über dem Blickziel
  flyMenu() {
    const F = this.app.flight;
    if (F.active) { F.exit(); return; }
    const box = this.modal(`<h2>${L('Wohin geht der Flug?', 'Where are you flying?')}</h2>
      <p>${L('Du startest in der Luft über dem Ort, den du gerade ansiehst. Die ganze Erde ist offen, ohne Grenzen und ohne Decke.', 'You start in the air above the place you are looking at. The whole Earth is open, no borders and no ceiling.')}</p>
      <div class="pcards">
        <button class="pcard" data-t="plane"><b>${L('Sportflugzeug', 'Light aircraft')}</b><span>${L('Das Flugzeug der Inselwelten, bis rund 190 km/h', 'The aircraft of the island worlds, up to about 190 km/h')}</span><small>${L('Shift Turbo · gut zum Tiefflug über Städte', 'Shift turbo · great for low passes over cities')}</small></button>
        <button class="pcard" data-t="jet"><b>${L('Düsenjet', 'Jet')}</b><span>${L('Über Mach 2 mit Nachbrenner, mit der Rakete bis ins All', 'Beyond Mach 2 with afterburner, with the rocket up into space')}</span><small>${L('Shift Nachbrenner · X Rakete · J wechselt in der Luft', 'Shift afterburner · X rocket · J switches in the air')}</small></button>
      </div>`, [[L('Abbrechen', 'Cancel'), null]], 'wide');
    box.querySelectorAll('.pcard').forEach(b => { b.onclick = () => { this.closeModal(); this.closeAll && this.closeAll(); F.enter(b.dataset.t); }; });
  }

  // ---------- Kleinteile ----------
  toast(text, kind = '') {
    const box = $('#toasts'), t = h('div', 'toast ' + kind, esc(text));
    box.append(t);
    setTimeout(() => t.classList.add('out'), kind === 'big' ? 6500 : 3800);
    setTimeout(() => t.remove(), kind === 'big' ? 7200 : 4400);
    while (box.children.length > 4) box.firstChild.remove();
  }
  modal(html, buttons = [], cls = '') {
    const m = $('#modal');
    m.innerHTML = `<div class="mbox ${cls}">${html}<div class="mbtns"></div></div>`;
    const bt = m.querySelector('.mbtns');
    for (const [label, fn] of buttons) { const b = h('button', '', label); b.onclick = () => { this.closeModal(); fn && fn(); }; bt.append(b); }
    m.className = 'show';
    return m.querySelector('.mbox');
  }
  closeModal() { $('#modal').className = ''; }
  welcomeBack(info) {
    const ts = this.ts, top = info.news.filter(e => e.imp >= 2).slice(-8).reverse();
    this.modal(`<h2>${L('Während du fort warst', 'While you were away')}</h2><p>${L(`${Math.round(info.days / DPY * 10) / 10} Jahre sind vergangen. Heute ist der ${dateText(ts.day)}.`, `${Math.round(info.days / DPY * 10) / 10} years have passed. Today is ${dateText(ts.day)}.`)}</p><ul class="tl">${top.map(e => `<li>${esc(e.t)}</li>`).join('')}</ul>`, [[L('Weiter', 'Continue'), null]]);
  }
  menu() {
    const app = this.app;
    this.modal(`<h2>${L('Einstellungen', 'Settings')}</h2>
      <div class="mrow"><span>${L('Sprache', 'Language')}</span><button id="mLang">${LANG === 'de' ? 'English' : 'Deutsch'}</button></div>
      <div class="mrow"><span>${L('Grafik', 'Graphics')}</span><button id="mQ">${app.stage.quality}</button></div>
      <div class="mrow"><span>${L('Länder einfärben (L)', 'Colour countries (L)')}</span><button id="mCtry">${app.showCountries ? L('an', 'on') : L('aus', 'off')}</button></div>
      <div class="mrow"><span>${L('Andere Welten', 'Other worlds')}</span><button id="mWorlds">${L('Inselwelt und Erde vom Anfang', 'Island world and Earth from the beginning')}</button></div>
      <p class="note">${L('Karten der Städte: © OpenFreeMap, © OpenMapTiles, © OpenStreetMap Mitwirkende. Orte: GeoNames (CC BY 4.0). Grenzen: Natural Earth. Zahlen: Weltbank.', 'City maps: © OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors. Places: GeoNames (CC BY 4.0). Borders: Natural Earth. Figures: World Bank.')}</p>`, [[L('Schließen', 'Close'), null]]);
    $('#mLang').onclick = () => setLang(LANG === 'de' ? 'en' : 'de');
    $('#mQ').onclick = () => { const order = ['hoch', 'mittel', 'niedrig'], q = order[(order.indexOf(app.stage.quality) + 1) % 3]; app.stage.setQuality(q); try { localStorage.setItem('biu.quality', q); } catch { /* egal */ } $('#mQ').textContent = q; };
    $('#mCtry').onclick = () => { app.showCountries = !app.showCountries; app.colorsDirty = true; $('#mCtry').textContent = app.showCountries ? L('an', 'on') : L('aus', 'off'); };
    $('#mWorlds').onclick = () => { app.save(true); try { localStorage.setItem('pfr.world', 'welt'); } catch { /* egal */ } location.href = 'index.html'; };
  }
}
