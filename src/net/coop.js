// Mit Freund spielen (seit 26.10.2026, Naders Wunsch): zwei Spieler in derselben Welt, kostenlos und ohne eigenen Server.
// Die Browser verbinden sich direkt (WebRTC) über PeerJS (vendor/peerjs, MIT). Nur zum Finden nutzt PeerJS seinen freien
// Vermittlungsdienst 0.peerjs.com, dazu freie STUN und TURN Server; die Welt selbst geht direkt von Browser zu Browser.
//
// Bauweise (Gleichschritt, tools/cooptest.mjs):
// - Der Gastgeber hält die Welt. Seine Simulation läuft wie immer, er bestimmt das Tempo und speichert.
// - Tritt ein Gast bei, serialisiert der Gastgeber die Welt, lädt sie selbst frisch daraus (swapWorld) und schickt
//   denselben Stand gepackt hinüber. Zwei frisch geladene Stände rechnen Tag für Tag exakt gleich (nur Rng aus rng.js),
//   ein lange gelaufener Stand gegen einen frisch geladenen dagegen nicht (Zwischenspeicher in st._rt), darum lädt auch
//   der Gastgeber neu.
// - Danach schickt der Gastgeber nur noch Takte {t:'tick', d: Tag, a: Bruchteil, s: Tempo, k: Prüfsumme} und jede gewirkte
//   Kraft {t:'cast', d, id, tgt}. Der Gast rechnet dieselben Tage selbst nach und wirkt die Kräfte am selben Tag.
//   Weicht die Prüfsumme ab (etwa weil jemand über die Oberfläche etwas an der Welt geändert hat), holt sich der Gast
//   einen neuen Schnappschuss. Ebenso, wenn er weit zurückliegt (sehr hohes Tempo, Tab im Hintergrund).
// - Kräfte des Gasts gehen als Wunsch an den Gastgeber ({t:'cast'}), der sie ausführt und wie seine eigenen weitergibt.
// - Beide schicken zehnmal pro Sekunde, wo sie sind ({t:'me'}): Gottansicht, Geist, Auto oder Flugzeug (render/peers.js).
// - Verbindung weg: der Gast versucht es alle paar Sekunden neu und bekommt dann einen frischen Schnappschuss. Derselbe
//   Gast (Kennung je Tab) ersetzt dabei seine alte Verbindung, auch wenn der Gastgeber sie noch für offen hält. Lädt der
//   Gastgeber die Seite neu, nimmt er denselben Code wieder (sessionStorage 'pfr.coopCode').
// Der Gast speichert nie: seine eigene Welt im Browser bleibt unberührt, "Trennen" lädt sie wieder.
import { serialize, deserialize } from '../sim/core.js';
import { checksum } from './sum.js';
import * as D from '../sim/data.js';
import { L } from '../i18n.js';
import { Peers } from '../render/peers.js';

export const PROTO = 1;
const PREFIX = 'pfr-coop-';
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_KEY = 'pfr.coopCode', NAME_KEY = 'pfr.coopName', GID_KEY = 'pfr.coopGid';
// Lebenszeichen: nach 12 s Stille gilt die Verbindung als weg, außer der andere hat sich als "kurz weg" gemeldet
// (Tab im Hintergrund: dort laufen Zeitgeber stark gedrosselt, dann entscheidet das Schließen der Verbindung selbst)
const ME_HZ = 10, TICK_MS = 100, TIMEOUT = 12000, LAG_MAX = 720, RESYNC_GAP = 8000;
const DAY = D.DAY_SECONDS;

let peerLib = null;
// PeerJS erst laden, wenn jemand mit Freunden spielen will (92 KB)
export function loadPeer() {
  if (peerLib) return peerLib;
  peerLib = new Promise((res, rej) => {
    if (window.peerjs && window.peerjs.Peer) { res(window.peerjs.Peer); return; }
    const s = document.createElement('script');
    s.src = 'vendor/peerjs/peerjs.min.js';
    s.onload = () => (window.peerjs && window.peerjs.Peer ? res(window.peerjs.Peer) : rej(new Error('peerjs')));
    s.onerror = () => { peerLib = null; rej(new Error('peerjs')); };
    document.head.append(s);
  });
  return peerLib;
}

export function newCode() {
  let c = '';
  const r = crypto.getRandomValues(new Uint8Array(6));
  for (const b of r) c += ALPHA[b % ALPHA.length];
  return c;
}
export const cleanCode = s => {
  const m = String(s || '').match(/join=([a-z0-9]+)/i);
  return (m ? m[1] : String(s || '')).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
};
export function coopName() { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } }
export function setCoopName(n) { try { localStorage.setItem(NAME_KEY, String(n || '').slice(0, 24)); } catch { /* egal */ } }
// Kennung dieses Tabs als Gast: verbindet er sich neu, erkennt der Gastgeber ihn wieder
function tabId() {
  try { let g = sessionStorage.getItem(GID_KEY); if (!g) { g = newCode() + newCode(); sessionStorage.setItem(GID_KEY, g); } return g; } catch { return newCode() + newCode(); }
}

// Schnappschuss packen (gzip im Browser), sonst als Text
async function pack(str) {
  if (typeof CompressionStream === 'undefined') return { j: str };
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter();
  w.write(new TextEncoder().encode(str)); w.close();
  return { z: await new Response(cs.readable).arrayBuffer() };
}
async function unpack(m) {
  if (m.j != null) return m.j;
  const buf = m.z instanceof ArrayBuffer ? m.z : m.z.buffer ? m.z.buffer.slice(m.z.byteOffset, m.z.byteOffset + m.z.byteLength) : m.z;
  const ds = new DecompressionStream('gzip');
  const w = ds.writable.getWriter();
  w.write(new Uint8Array(buf)); w.close();
  return await new Response(ds.readable).text();
}

export class Coop {
  constructor(app, hooks) {
    this.app = app; this.hooks = hooks;
    this.role = null;        // 'host' oder 'guest'
    this.peer = null; this.conn = null;
    this.code = null;
    this.state = 'off';      // off, starting, waiting (Gastgeber ohne Gast), linking, joined, lost, ended
    this.friend = null;      // Name des anderen
    this.guestGid = null;    // Gastgeber: Kennung des verbundenen Gasts
    this.queue = [];         // Gast: Takte und Kräfte vom Gastgeber, der Reihe nach
    this.hostDay = 0; this.hostAcc = 0; this.hostSpeed = 1; this.recvT = 0;
    this.lastIn = 0; this.lastMe = 0; this.lastTick = 0; this.lastTickDay = -1;
    this.resyncs = []; this.lastResync = 0; this.waitSnap = false;
    this.out = null;         // Gastgeber: Nachrichten, die warten, bis der Schnappschuss raus ist
    this.away = false;       // der andere hat den Tab gerade im Hintergrund
    this.listeners = new Set();
    this.peers = new Peers(app);
    setInterval(() => this.pulse(), 1000);
    document.addEventListener('visibilitychange', () => this.send({ t: 'away', on: document.hidden }));
    window.addEventListener('pagehide', () => { if (this.conn && this.conn.open && this.role === 'guest') this.send({ t: 'bye' }); });
  }

  get host() { return this.role === 'host'; }
  get guest() { return this.role === 'guest'; }
  get joined() { return this.state === 'joined'; }
  onChange(fn) { this.listeners.add(fn); }
  emit() { for (const fn of this.listeners) try { fn(this); } catch (e) { console.error(e); } }
  set(state) { if (this.state !== state) { this.state = state; this.emit(); } }
  toast(m, k) { if (this.app.toast) this.app.toast(m, k); }
  myName() { return coopName() || (this.host ? L('Gastgeber', 'Host') : L('Gast', 'Guest')); }

  // Einladungslink: dieselbe Seite mit ?join=code, dazu welche Welt (Erde braucht vor dem Laden ihre Größe, index.html)
  link() {
    const u = new URL(location.href);
    const keep = new URLSearchParams();
    keep.set('join', this.code);
    keep.set(this.app.earthMode ? 'erde' : 'welt', '');
    if (u.searchParams.has('notrailer')) keep.set('notrailer', '');
    return `${u.origin}${u.pathname}?${keep.toString().replace(/=(&|$)/g, '$1')}`;
  }

  send(m) {
    if (!this.conn || !this.conn.open) return false;
    if (this.out && m.t !== 'snap' && m.t !== 'me' && m.t !== 'ping' && m.t !== 'away') { this.out.push(m); return true; }
    try { this.conn.send(m); return true; } catch (e) { console.warn('coop send', e); return false; }
  }

  // ---------- Gastgeber ----------
  async startHost() {
    if (this.role === 'guest') return;
    if (this.peer && !this.peer.destroyed) { this.emit(); return; }
    this.role = 'host';
    this.set('starting');
    let Peer;
    try { Peer = await loadPeer(); } catch { this.fail(L('Das Mehrspieler Modul ließ sich nicht laden.', 'The multiplayer module could not be loaded.')); return; }
    try { this.code = sessionStorage.getItem(CODE_KEY) || newCode(); } catch { this.code = newCode(); }
    this.openHostPeer(Peer, 0);
  }

  openHostPeer(Peer, tries) {
    const peer = new Peer(PREFIX + this.code, { debug: 1 });
    this.peer = peer;
    peer.on('open', () => {
      try { sessionStorage.setItem(CODE_KEY, this.code); } catch { /* egal */ }
      this.set(this.conn && this.conn.open ? 'joined' : 'waiting');
    });
    peer.on('connection', c => this.accept(c));
    peer.on('disconnected', () => { if (!peer.destroyed && this.role === 'host') setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 1500); });
    peer.on('error', e => {
      if (e.type === 'unavailable-id') {
        // nach einem Neuladen hält der Vermittler den alten Namen noch kurz fest: ein paar Mal warten, dann neuer Code
        peer.destroy();
        if (tries < 4) setTimeout(() => this.openHostPeer(Peer, tries + 1), 2500);
        else { this.code = newCode(); this.openHostPeer(Peer, 0); }
        return;
      }
      if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' || e.type === 'socket-closed') {
        if (this.state === 'starting') this.fail(L('Keine Verbindung zum Vermittler. Bist du online?', 'No connection to the matchmaker. Are you online?'));
        return;
      }
      console.warn('coop host', e.type, e);
    });
  }

  accept(c) {
    const gid = c.metadata && c.metadata.gid;
    if (this.conn && this.conn.open) {
      // derselbe Gast verbindet neu (seine alte Verbindung hängt noch) oder die alte ist still: ersetzen.
      // Sonst nur zwei Spieler: ein dritter bekommt eine freundliche Absage.
      const same = gid && gid === this.guestGid, stale = !this.lastIn || performance.now() - this.lastIn > TIMEOUT;
      if (!same && !stale) {
        c.on('open', () => { try { c.send({ t: 'full' }); } catch { /* egal */ } setTimeout(() => c.close(), 800); });
        return;
      }
    }
    if (this.conn) this.dropConn();
    this.conn = c;
    this.guestGid = gid || null;
    this.lastIn = performance.now();
    c.on('data', m => { if (this.conn === c) this.onHost(m); });
    c.on('close', () => { if (this.conn === c) this.guestGone(); });
    c.on('error', e => console.warn('coop conn', e));
  }

  async onHost(m) {
    if (!m || typeof m !== 'object') return;
    this.lastIn = performance.now();
    switch (m.t) {
      case 'hello':
        if (m.v !== PROTO) { this.send({ t: 'ver', v: PROTO }); return; }
        this.friend = String(m.name || L('Gast', 'Guest')).slice(0, 24);
        this.away = false;
        await this.sendSnap(true);
        break;
      case 'resync':
        if (performance.now() - this.lastResync < RESYNC_GAP * 0.6) return;
        await this.sendSnap(false);
        break;
      case 'cast': {
        // Kraft des Gasts: hier ausführen, castNet gibt sie über castDone wie jede andere weiter
        const res = this.hooks.castNet(m.id, m.tgt || {}, { who: this.friend });
        if (!res || !res.ok) this.send({ t: 'castNo', msg: res ? res.msg : '' });
        break;
      }
      case 'felt':
        if (this.hooks.felt) this.hooks.felt(m.pid, m.text);
        break;
      case 'me': this.peers.set(m); break;
      case 'away': this.away = !!m.on; this.emit(); break;
      case 'bye': this.guestGone(true); break;
    }
  }

  // Schnappschuss: Gastgeber lädt selbst frisch (Gleichschritt), der Gast bekommt genau diesen Stand
  async sendSnap(first) {
    const app = this.app, st = app.st;
    if (!st || !this.conn || !this.conn.open) return;
    this.lastResync = performance.now();
    this.out = [];
    st.acc = app.acc;
    const json = serialize(st);
    const d = st.day, acc = app.acc;
    this.hooks.swapWorld(deserialize(json));
    let body;
    try { body = await pack(json); } catch { body = { j: json }; }
    const t = app.stage.controls.target;
    this.send({ t: 'snap', v: PROTO, wv: D.WORLD_VERSION, d, a: acc, s: app.running ? app.speed : 0, name: this.myName(), earth: !!st.earth, cam: [t.x, t.z], first: !!first, ...body });
    const later = this.out; this.out = null;
    for (const m of later) this.send(m);
    this.lastTickDay = -1;
    if (this.state !== 'joined') {
      this.set('joined');
      this.toast(L(`${this.friend} ist in deiner Welt.`, `${this.friend} has joined your world.`), 'god');
    } else if (first) this.toast(L(`${this.friend} ist wieder verbunden.`, `${this.friend} has reconnected.`), 'god');
  }

  guestGone(said) {
    const had = this.state === 'joined';
    this.dropConn();
    this.peers.clear();
    this.away = false;
    if (this.role !== 'host') return;
    this.set(this.peer && !this.peer.destroyed ? 'waiting' : 'off');
    if (had) this.toast(said ? L(`${this.friend || 'Dein Freund'} hat die Welt verlassen. Der Link gilt weiter.`, `${this.friend || 'Your friend'} has left the world. The link still works.`) : L(`Die Verbindung zu ${this.friend || 'deinem Freund'} ist weg. Der Link gilt weiter.`, `The connection to ${this.friend || 'your friend'} was lost. The link still works.`), 'warn');
  }

  dropConn() {
    const c = this.conn;
    this.conn = null;
    if (c) { try { c.close(); } catch { /* egal */ } }
  }

  // Kraft gewirkt (main.js doCast und castNet): an den Gast weitergeben, am selben Tag wie beim Gastgeber
  castDone(id, tgt, by) {
    if (!this.host || !this.joined) return;
    this.send({ t: 'cast', d: this.app.st.day, id, tgt, by });
  }

  stopHost() {
    this.send({ t: 'bye' });
    setTimeout(() => {
      this.dropConn();
      if (this.peer) { try { this.peer.destroy(); } catch { /* egal */ } }
      this.peer = null; this.role = null; this.friend = null; this.code = null; this.guestGid = null;
      this.peers.clear();
      try { sessionStorage.removeItem(CODE_KEY); } catch { /* egal */ }
      this.set('off');
    }, 200);
  }

  // Nach einem Neuladen weiter Gastgeber sein (derselbe Code, der Gast verbindet sich von selbst neu)
  resume() {
    let c = null;
    try { c = sessionStorage.getItem(CODE_KEY); } catch { /* egal */ }
    if (c && !this.role) this.startHost();
  }

  // ---------- Gast ----------
  async startGuest(code) {
    this.role = 'guest';
    this.code = cleanCode(code);
    this.gid = tabId();
    this.set('linking');
    let Peer;
    try { Peer = await loadPeer(); } catch { this.fail(L('Das Mehrspieler Modul ließ sich nicht laden.', 'The multiplayer module could not be loaded.')); return; }
    this.Peer = Peer;
    this.tries = 0;
    this.openGuestPeer();
  }

  openGuestPeer() {
    const peer = new this.Peer({ debug: 1 });
    this.peer = peer;
    peer.on('open', () => this.dial());
    peer.on('disconnected', () => { if (!peer.destroyed && this.role === 'guest') setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 1500); });
    peer.on('error', e => {
      if (e.type === 'peer-unavailable') { this.retry(); return; }
      if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' || e.type === 'socket-closed') { this.retry(); return; }
      console.warn('coop guest', e.type, e);
    });
  }

  dial() {
    if (this.role !== 'guest' || !this.peer || this.peer.destroyed || this.state === 'ended') return;
    if (this.peer.disconnected) { this.peer.reconnect(); return; }
    const c = this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'binary', metadata: { v: PROTO, gid: this.gid } });
    this.conn = c;
    const t = setTimeout(() => { if (this.conn === c && !c.open) { try { c.close(); } catch { /* egal */ } this.retry(); } }, 9000);
    c.on('open', () => {
      clearTimeout(t);
      this.tries = 0;
      this.lastIn = performance.now();
      this.send({ t: 'hello', v: PROTO, name: this.myName() });
    });
    c.on('data', m => { if (this.conn === c) this.onGuest(m); });
    c.on('close', () => { clearTimeout(t); if (this.conn === c) this.lost(); });
    c.on('error', e => console.warn('coop conn', e));
  }

  retry() {
    if (this.role !== 'guest' || this.state === 'ended') return;
    this.tries++;
    if (this.state !== 'joined' && this.state !== 'lost' && this.tries > 3 && !this.everJoined) {
      this.fail(L('Unter diesem Code wartet gerade niemand. Prüfe den Link oder bitte deinen Freund, Gastgeber zu werden.', 'Nobody is waiting under this code right now. Check the link or ask your friend to host.'));
      return;
    }
    if (this.everJoined && this.tries > 40) { this.ended(L('Dein Freund ist nicht mehr zu erreichen.', 'Your friend can no longer be reached.')); return; }
    clearTimeout(this.retryT);
    this.retryT = setTimeout(() => {
      if (!this.peer || this.peer.destroyed) this.openGuestPeer();
      else this.dial();
    }, this.tries < 3 ? 1500 : 3000);
  }

  lost() {
    if (this.role !== 'guest' || this.state === 'ended') return;
    this.conn = null;
    this.queue.length = 0;
    if (this.state === 'joined') { this.set('lost'); this.toast(L('Verbindung weg. Ich verbinde neu …', 'Connection lost. Reconnecting …'), 'warn'); }
    this.retry();
  }

  async onGuest(m) {
    if (!m || typeof m !== 'object') return;
    this.lastIn = performance.now();
    switch (m.t) {
      case 'snap': {
        if (m.v !== PROTO || m.wv !== D.WORLD_VERSION) { this.fail(L('Ihr spielt verschiedene Fassungen. Ladet beide die Seite neu.', 'You are playing different versions. Both of you, please reload the page.')); return; }
        if (!!m.earth !== !!this.app.earthMode) { this.reloadAs(m.earth); return; }
        let st;
        try { st = deserialize(await unpack(m)); } catch (e) { console.error(e); this.fail(L('Die Welt deines Freundes ließ sich nicht lesen.', 'Your friend\'s world could not be read.')); return; }
        this.queue.length = 0;
        this.waitSnap = false;
        this.away = false;
        this.friend = String(m.name || L('Gastgeber', 'Host')).slice(0, 24);
        this.hostDay = m.d; this.hostAcc = m.a; this.hostSpeed = m.s; this.recvT = performance.now();
        const first = !this.everJoined, back = this.state === 'lost';
        this.hooks.loadWorld(st, m.a, m.s, first ? m.cam : null);
        this.everJoined = true;
        this.set('joined');
        if (back) this.toast(L('Wieder verbunden.', 'Reconnected.'), 'god');
        break;
      }
      case 'tick': case 'cast':
        if (!this.waitSnap) this.queue.push(m);
        break;
      case 'castNo': this.toast(m.msg || L('Die Kraft ließ sich nicht wirken.', 'The power could not be cast.'), 'warn'); break;
      case 'me': this.peers.set(m); break;
      case 'away': this.away = !!m.on; this.emit(); break;
      case 'full': this.fail(L('In dieser Welt spielen schon zwei. Mehr geht nicht.', 'Two are already playing in this world. No more room.')); break;
      case 'ver': this.fail(L('Ihr spielt verschiedene Fassungen. Ladet beide die Seite neu.', 'You are playing different versions. Both of you, please reload the page.')); break;
      case 'bye': this.ended(L(`${this.friend || 'Dein Gastgeber'} hat die gemeinsame Welt beendet.`, `${this.friend || 'Your host'} has ended the shared world.`)); break;
    }
  }

  // Erde und Inselwelt brauchen beim Laden ihre Größe: mit der passenden Adresse neu laden
  reloadAs(earth) {
    const u = new URL(location.href);
    u.searchParams.delete('erde'); u.searchParams.delete('welt');
    u.searchParams.set(earth ? 'erde' : 'welt', '');
    location.replace(u.toString().replace(/=(&|$)/g, '$1'));
  }

  ended(msg) {
    this.endMsg = msg;
    clearTimeout(this.retryT);
    this.dropConn();
    if (this.peer) { try { this.peer.destroy(); } catch { /* egal */ } }
    this.set('ended');
    this.emit();
  }

  fail(msg) {
    this.error = msg;
    if (this.role === 'guest') { this.ended(msg); return; }
    this.role = null;
    if (this.peer) { try { this.peer.destroy(); } catch { /* egal */ } }
    this.peer = null;
    this.set('off');
    this.toast(msg, 'warn');
  }

  // Gast: zurück in die eigene Welt (die nie angefasst wurde)
  leave() {
    if (this.conn && this.conn.open) this.send({ t: 'bye' });
    setTimeout(() => {
      // erde/welt kamen mit dem Einladungslink: weg damit, sonst erzwängen sie beim Gast dessen Welt statt seiner eigenen
      const u = new URL(location.href);
      for (const k of ['join', 'erde', 'welt']) u.searchParams.delete(k);
      location.replace(u.toString().replace(/=(&|$)/g, '$1'));
    }, 150);
  }

  requestCast(id, tgt) {
    if (!this.joined) { this.toast(L('Gerade keine Verbindung. Die Kraft wartet nicht.', 'No connection right now. The power cannot wait.'), 'warn'); return; }
    this.send({ t: 'cast', id, tgt: { ...tgt } });
  }

  felt(pid, text) { if (this.guest) this.send({ t: 'felt', pid, text }); }

  resync(why) {
    const now = performance.now();
    if (this.waitSnap || now - this.lastResync < RESYNC_GAP) return;
    this.lastResync = now;
    this.resyncs = this.resyncs.filter(t => now - t < 120000);
    this.resyncs.push(now);
    if (this.resyncs.length === 4) this.toast(L('Eure Welten laufen immer wieder auseinander. Ladet beide die Seite neu, falls es ruckelt.', 'Your worlds keep drifting apart. Both of you, reload the page if it stutters.'), 'warn');
    console.info('coop resync', why);
    this.waitSnap = true;
    this.queue.length = 0;
    this.send({ t: 'resync', why });
  }

  // Gast, jedes Bild statt der eigenen Zeit: Takte und Kräfte der Reihe nach abarbeiten
  guestStep(dt) {
    const app = this.app, st = app.st;
    if (!st || !this.everJoined) return;
    const now = performance.now();
    const q = this.queue;
    const lastD = q.length ? q[q.length - 1].d : st.day;
    if (lastD - st.day > LAG_MAX) { this.resync('lag ' + (lastD - st.day)); return; }
    const behind = lastD - st.day;
    const budget = behind > 6 ? 45 : 14;
    const light = behind > 1;
    let steps = 0;
    const t0 = performance.now();
    while (q.length) {
      const m = q[0];
      while (st.day < m.d && performance.now() - t0 < budget) { this.hooks.stepOne(light); steps++; }
      if (st.day < m.d) break;
      q.shift();
      if (m.t === 'tick') {
        this.hostDay = m.d; this.hostAcc = m.a; this.recvT = now;
        if (m.s !== app.speed) { app.speed = m.s; this.hostSpeed = m.s; }
        if (m.k != null && checksum(st) !== m.k) { if (steps && light) this.hooks.refreshWorld(); this.resync('sum day ' + st.day); return; }
      } else if (m.t === 'cast') {
        this.hooks.castNet(m.id, m.tgt || {}, { mine: m.by === 'guest', who: m.by === 'guest' ? null : this.friend, show: true });
      }
    }
    if (steps && light) this.hooks.refreshWorld();
    // Bruchteil des Tages weich weiterzählen, bis der nächste Takt kommt (nie über den Tag des Gastgebers hinaus)
    if (!q.length && st.day === this.hostDay) {
      const est = this.hostAcc + ((now - this.recvT) / 1000) * (this.state === 'joined' && !this.away ? this.hostSpeed : 0);
      app.acc = Math.max(0, Math.min(DAY * 0.995, est));
    } else app.acc = DAY * 0.98;
    app.daysPerSec = (app.daysPerSec || 0) * 0.95 + (steps / Math.max(dt, 1e-3)) * 0.05;
  }

  // ---------- jedes Bild (main.js tick) ----------
  frame(dt, t) {
    const now = performance.now();
    this.peers.update(dt, t);
    if (!this.conn || !this.conn.open) return;
    if (this.state === 'joined' && now - this.lastMe > 1000 / ME_HZ) { this.lastMe = now; this.send({ t: 'me', ...this.me() }); }
    if (this.host && this.state === 'joined' && this.app.st) {
      const st = this.app.st;
      if (st.day !== this.lastTickDay || now - this.lastTick > TICK_MS) {
        this.lastTick = now; this.lastTickDay = st.day;
        this.send({ t: 'tick', d: st.day, a: this.app.acc, s: this.app.running ? this.app.speed : 0, k: checksum(st) });
      }
    }
  }

  // jede Sekunde, auch wenn der Tab im Hintergrund keine Bilder bekommt: Lebenszeichen und tote Verbindungen erkennen
  pulse() {
    if (!this.conn || !this.conn.open) return;
    this.send({ t: 'ping' });
    if (this.state === 'joined' && !this.away && this.lastIn && performance.now() - this.lastIn > TIMEOUT) {
      console.info('coop timeout');
      if (this.guest) { this.dropConn(); this.lost(); } else this.guestGone();
    }
  }

  // Wo bin ich gerade? Gottansicht (Blickpunkt), Geist, Auto oder Flugzeug
  me() {
    const app = this.app, n = this.myName();
    const dr = app.drive, fl = app.flight, gh = app.ghost;
    if (dr && dr.active) {
      const d = dr.demo, c = dr.car;
      return { n, m: 'drive', type: d.type, hex: d.hex, x: d.x, y: d.y, z: d.z, yaw: d.yaw, pitch: d.pitch, roll: d.roll, c: c.c, s: c.s, hl: c.hl, hw: c.hw, cx: c.x - d.x, cz: c.z - d.z, v: (dr.st.vf || 0) / 10 };
    }
    if (fl && fl.active) {
      const a = fl.air;
      return { n, m: 'fly', p: a.pos.slice(), q: a.q.slice(), vel: a.vel.slice(), f: [fl.ail.L.rotation.x, fl.ail.R.rotation.x, fl.elev.rotation.x, fl.rud.rotation.y], r: fl.rpm || 0, b: a.ctl.boost ? 1 : 0 };
    }
    if (gh && gh.active) return { n, m: 'ghost', x: gh.pos.x, y: gh.pos.y, z: gh.pos.z, yaw: gh.yaw, an: gh.cur, sp: gh.speed || 0 };
    const tg = app.stage.controls.target;
    return { n, m: 'god', x: tg.x, y: tg.y, z: tg.z };
  }
}
