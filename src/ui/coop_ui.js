// Oberfläche für "Mit Freund spielen" (seit 26.10.2026, Logik in src/net/coop.js): Dialog zum Gastgeber werden oder
// Beitreten, Einladungslink zum Kopieren und Teilen, kleine Leiste unter der Kopfleiste (verbunden, wartet, verbindet neu)
// mit "Zum Freund", dazu ein Knopf im Startbild. Alle Texte zweisprachig.
// Die Leiste sitzt mittig unter der Kopfleiste und schiebt Gebete und Zielhinweis um ihre Höhe nach unten (body.coop-bar,
// --coopShift), statt sie zu verdecken. Klassen heißen coop*, weil .txt und .more im Spiel schon vergeben sind.
import { L } from '../i18n.js';
import { cleanCode, coopName, setCoopName } from '../net/coop.js';

const CSS = `
#coopBar { position: fixed; left: 50%; top: 74px; z-index: 19; transform: translateX(-50%); display: none; align-items: center; gap: 8px; padding: 5px 6px 5px 12px; border-radius: 999px; background: var(--glass2); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid var(--line); font-size: 12.5px; white-space: nowrap; max-width: calc(100vw - 24px); }
#coopBar.show { display: flex; }
body.flight-mode #coopBar, body.drive-mode #coopBar { display: none; } /* dort zeigt das Namensschild den Freund, oben steht der Einstiegshinweis */
#coopBar .coopDot { width: 8px; height: 8px; border-radius: 50%; background: #6fc08a; box-shadow: 0 0 0 3px rgba(111, 192, 138, 0.22); flex: none; }
#coopBar.wait .coopDot { background: var(--gold); box-shadow: 0 0 0 3px rgba(233, 180, 76, 0.22); animation: coopPulse 1.4s ease-in-out infinite; }
#coopBar.lost .coopDot { background: var(--red); box-shadow: 0 0 0 3px rgba(217, 96, 76, 0.25); animation: coopPulse 0.9s ease-in-out infinite; }
#coopBar .coopTxt { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
#coopBar button { padding: 5px 11px; border-radius: 999px; background: rgba(246, 239, 226, 0.12); font-size: 12px; font-weight: 700; flex: none; width: auto; height: auto; }
#coopBar button:hover { background: rgba(246, 239, 226, 0.22); }
@keyframes coopPulse { 50% { opacity: 0.45; } }
body.coop-bar #prayers, body.coop-bar #hint { margin-top: var(--coopShift, 0px); }
#modal.coop-top { z-index: 70; }
#btnCoop, #btnCoopBack { padding: 10px 22px; border-radius: 999px; font-size: 14px; font-weight: 600; color: var(--paper); background: rgba(246, 239, 226, 0.06); box-shadow: inset 0 0 0 1px rgba(246, 239, 226, 0.4); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
#btnCoop { color: #ffe7b0; box-shadow: inset 0 0 0 1px rgba(255, 217, 138, 0.55); }
#btnCoop:hover, #btnCoopBack:hover { background: rgba(246, 239, 226, 0.16); transform: translateY(-1px); }
.mbox .coopForm { display: grid; gap: 10px; margin: 16px 0 4px; }
.mbox .coopForm label { font-size: 12px; font-weight: 700; color: rgba(43, 38, 32, 0.7); }
.mbox .coopRow { display: flex; gap: 8px; }
.mbox .coopRow input { flex: 1; min-width: 0; padding: 11px 14px; border-radius: 12px; border: 1px solid rgba(43, 38, 32, 0.2); background: rgba(255, 255, 255, 0.7); font: inherit; font-size: 16px; color: var(--pink); }
.mbox .coopRow input:focus { outline: 2px solid rgba(167, 122, 34, 0.5); outline-offset: 1px; }
.mbox .coopRow button, .mbox .coopBtn { padding: 10px 16px; border-radius: 999px; background: var(--pink); color: var(--paper); font-weight: 700; font-size: 13px; flex: none; }
.mbox .coopBtn.alt { background: rgba(43, 38, 32, 0.1); color: var(--pink); }
.mbox .coopLink { display: block; padding: 12px 14px; border-radius: 12px; background: rgba(43, 38, 32, 0.08); font-family: ui-monospace, Menlo, monospace; font-size: 13px; word-break: break-all; user-select: all; -webkit-user-select: all; color: var(--pink); }
.mbox .coopCode { font-size: 13px; color: rgba(43, 38, 32, 0.7); }
.mbox .coopCode b { font-family: ui-monospace, Menlo, monospace; font-size: 22px; letter-spacing: 0.18em; color: var(--pink); margin-left: 6px; }
.mbox .coopActs { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
.mbox .coopState { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; }
.mbox .coopState i { width: 9px; height: 9px; border-radius: 50%; background: var(--gold); }
.mbox .coopState.on i { background: #3f8f5a; }
.mbox .coopOr { text-align: center; font-size: 12px; color: rgba(43, 38, 32, 0.5); margin: 2px 0; }
@media (max-width: 760px) {
  #coopBar { font-size: 12px; padding: 4px 4px 4px 10px; gap: 6px; }
  #coopBar button { padding: 5px 9px; }
  .mbox .coopRow { flex-wrap: wrap; }
  .mbox .coopRow button { flex: 1; }
}
`;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// unterster Rand dessen, was in der Kopfleiste wirklich zu sehen ist (die Box von #top ist beim Umbrechen größer)
function headerBottom() {
  let b = 0;
  for (const el of document.querySelectorAll('#top > *, #top > .right > *')) {
    if (el.classList.contains('right')) continue;
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.width > 0 && getComputedStyle(el).visibility !== 'hidden') b = Math.max(b, r.bottom);
  }
  return b || 70;
}

export function initCoopUI(app) {
  const coop = app.coop;
  app.openCoop = () => openCoop(app); // für den Eintrag in den Einstellungen (ui.js)
  app.coopToFriend = () => toFriend(app); // Klick auf das Namensschild (render/peers.js)
  const s = document.createElement('style'); s.textContent = CSS; document.head.append(s);
  const bar = document.createElement('div');
  bar.id = 'coopBar';
  bar.innerHTML = '<span class="coopDot"></span><span class="coopTxt"></span><button class="coopGo"></button><button class="coopMore" title="">⋯</button>';
  document.body.append(bar);
  bar.querySelector('.coopGo').onclick = () => toFriend(app);
  bar.querySelector('.coopMore').onclick = () => openCoop(app);
  bar.querySelector('.coopMore').title = L('Mit Freund spielen', 'Play with a friend');
  const place = () => {
    const on = bar.classList.contains('show');
    document.body.classList.toggle('coop-bar', on);
    if (!on) return;
    bar.style.top = `${Math.round(headerBottom() + 8)}px`;
    // Gebete und Zielhinweis um die Höhe der Leiste nach unten schieben, wenn sie sonst darunter lägen
    const pr = document.querySelector('#prayers');
    const natural = pr ? parseFloat(getComputedStyle(pr).top) || 0 : 0;
    const need = bar.getBoundingClientRect().bottom + 6 - natural;
    document.body.style.setProperty('--coopShift', `${Math.max(0, Math.round(need))}px`);
  };
  setInterval(place, 1000); window.addEventListener('resize', place);
  const render = () => {
    const st = coop.state, friend = esc(coop.friend || L('Freund', 'Friend'));
    let txt = '', cls = '', go = '';
    if (coop.host && st === 'waiting') { txt = L('Deine Welt wartet auf deinen Freund', 'Your world is waiting for your friend'); cls = 'wait'; go = L('Link', 'Link'); }
    else if (coop.host && st === 'starting') { txt = L('Einladung wird vorbereitet …', 'Preparing the invitation …'); cls = 'wait'; }
    else if (st === 'joined') { txt = coop.away ? L(`${friend} ist kurz weg`, `${friend} is away for a moment`) : coop.host ? L(`${friend} spielt mit dir`, `${friend} is playing with you`) : L(`In der Welt von ${friend}`, `In ${friend}'s world`); cls = coop.away ? 'wait' : ''; go = L('Zum Freund', 'Find friend'); }
    else if (st === 'lost') { txt = L('Verbindung weg, verbinde neu …', 'Connection lost, reconnecting …'); cls = 'lost'; }
    else if (st === 'linking') { txt = L('Verbinde mit deinem Freund …', 'Connecting to your friend …'); cls = 'wait'; }
    bar.className = txt && document.querySelector('#intro.gone') ? `show ${cls}` : '';
    bar.querySelector('.coopTxt').innerHTML = txt;
    const g = bar.querySelector('.coopGo');
    g.textContent = go; g.style.display = go ? '' : 'none';
    place();
    if (st === 'ended' && coop.guest) { endedDialog(app); return; }
    if (document.querySelector('#modal.show .coopDlg')) openCoop(app, true);
  };
  coop.onChange(render);
  setInterval(render, 1500);
  // Startbild: "Mit Freund spielen" neben Baukasten und Modell-Sammlung (nicht im Gast-Modus, der hat sein eigenes Startbild)
  const worlds = document.querySelector('#intro .worlds');
  if (worlds && !coop.guest && !app.coopGuest) {
    const b = document.createElement('button');
    b.className = 'ghost'; b.id = 'btnCoop';
    b.textContent = L('Mit Freund spielen', 'Play with a friend');
    b.onclick = () => openCoop(app);
    worlds.append(b);
  }
}

// Kamera zum Freund (Gottansicht), als Geist direkt neben ihn
export function toFriend(app) {
  const coop = app.coop;
  if (coop.host && coop.state === 'waiting') { openCoop(app); return; }
  const w = coop.peers.where();
  if (!w) { app.toast(L('Dein Freund ist noch nicht zu sehen.', 'Your friend is not visible yet.')); return; }
  if (app.ghost && app.ghost.active) { app.ghost.pos.set(w.x + 0.3, app.ghost.pos.y, w.z + 0.3); app.ghost.floorY = null; return; }
  if (app.flying || app.driving) { app.toast(L('Steig erst aus, dann bringt dich die Kamera zu deinem Freund.', 'Get out first, then the camera takes you to your friend.')); return; }
  app.followId = null;
  app.focus(w.x + app.NX / 2 - 0.5, w.z + app.NY / 2 - 0.5, 26);
}

function endedDialog(app) {
  if (endedDialog.shown) return;
  endedDialog.shown = true;
  const coop = app.coop;
  app.ui.modal(`<div class="coopEnd"><small class="kicker">${L('Mit Freund spielen', 'Play with a friend')}</small><h2>${L('Die gemeinsame Welt ist vorbei', 'The shared world has ended')}</h2><p>${esc(coop.endMsg || coop.error || '')}</p><p class="muted">${L('Deine eigene Welt wartet unverändert auf dich.', 'Your own world is waiting for you, unchanged.')}</p></div>`,
    [[L('Zurück zu meiner Welt', 'Back to my world'), () => coop.leave()], [L('Nochmal versuchen', 'Try again'), () => location.reload()]]);
  document.querySelector('#modal').classList.add('coop-top');
}

// Der Dialog: je nach Lage Auswahl, Einladung (Gastgeber) oder Verbindung (Gast)
export function openCoop(app, refresh) {
  const coop = app.coop, ui = app.ui;
  const m = document.querySelector('#modal');
  const intro = !document.querySelector('#intro.gone');
  const friend = esc(coop.friend || L('dein Freund', 'your friend'));
  if (coop.guest && coop.state === 'ended') { endedDialog.shown = false; endedDialog(app); return; }
  let html, btns;
  if (coop.host && coop.state !== 'off') {
    const on = coop.state === 'joined';
    const link = coop.code && coop.state !== 'starting' ? coop.link() : '';
    html = `<div class="coopDlg"><small class="kicker">${L('Mit Freund spielen', 'Play with a friend')}</small>
      <h2>${on ? L(`${friend} ist in deiner Welt`, `${friend} is in your world`) : L('Deine Welt wartet auf deinen Freund', 'Your world is waiting for your friend')}</h2>
      <p>${L('Schick diesen Link. Dein Freund öffnet ihn im Browser, am Rechner oder am Handy, und ist sofort bei dir. Du bestimmst das Tempo, Kräfte wirkt ihr beide.', 'Send this link. Your friend opens it in a browser, on a computer or a phone, and is right there with you. You set the speed, you both cast powers.')}</p>
      <div class="coopForm">
        <div class="coopState ${on ? 'on' : ''}"><i></i>${on ? L(`Verbunden mit ${friend}`, `Connected to ${friend}`) : coop.state === 'starting' ? L('Einladung wird vorbereitet …', 'Preparing the invitation …') : L('Wartet auf deinen Freund …', 'Waiting for your friend …')}</div>
        ${link ? `<span class="coopLink" id="coopLink">${esc(link)}</span>
        <div class="coopCode">${L('Code', 'Code')}<b>${esc(coop.code)}</b></div>
        <div class="coopActs"><button class="coopBtn" id="coopCopy">${L('Link kopieren', 'Copy link')}</button>${navigator.share ? `<button class="coopBtn alt" id="coopShare">${L('Teilen', 'Share')}</button>` : ''}${on ? `<button class="coopBtn alt" id="coopFind">${L('Zum Freund', 'Find friend')}</button>` : ''}</div>` : ''}
      </div></div>`;
    btns = [[L('Schließen', 'Close'), null], [L('Gemeinsame Welt beenden', 'End shared world'), () => coop.stopHost()]];
  } else if (coop.guest) {
    const on = coop.state === 'joined';
    html = `<div class="coopDlg"><small class="kicker">${L('Mit Freund spielen', 'Play with a friend')}</small>
      <h2>${on ? L(`Du bist in der Welt von ${friend}`, `You are in ${friend}'s world`) : L('Verbinde mit deinem Freund …', 'Connecting to your friend …')}</h2>
      <p>${L('Die Zeit läuft im Tempo deines Gastgebers. Deine Kräfte wirken in seiner Welt, deine eigene Welt bleibt unberührt.', 'Time runs at your host\'s speed. Your powers work in their world, your own world stays untouched.')}</p>
      <div class="coopForm"><div class="coopState ${on ? 'on' : ''}"><i></i>${on ? L(`Verbunden mit ${friend}`, `Connected to ${friend}`) : coop.state === 'lost' ? L('Verbindung weg, verbinde neu …', 'Connection lost, reconnecting …') : L('Verbinde …', 'Connecting …')}</div>
      ${on ? `<div class="coopActs"><button class="coopBtn alt" id="coopFind">${L('Zum Freund', 'Find friend')}</button></div>` : ''}</div></div>`;
    btns = [[L('Schließen', 'Close'), null], [L('Trennen und zurück zu meiner Welt', 'Leave and return to my world'), () => coop.leave()]];
  } else {
    html = `<div class="coopDlg"><small class="kicker">${L('Mit Freund spielen', 'Play with a friend')}</small>
      <h2>${L('Zu zweit in einer Welt', 'Two in one world')}</h2>
      <p>${L('Einer ist Gastgeber, seine Welt läuft weiter wie immer. Der andere kommt über einen Link dazu. Ihr seht euch als Geist, im Auto und im Flugzeug und wirkt beide Kräfte. Kostenlos, direkt von Browser zu Browser.', 'One of you hosts, their world keeps running as always. The other joins through a link. You see each other as a spirit, in a car and in a plane, and both cast powers. Free, directly from browser to browser.')}</p>
      <div class="coopForm">
        <label for="coopName">${L('Dein Name', 'Your name')}</label>
        <div class="coopRow"><input id="coopName" maxlength="24" autocomplete="nickname" placeholder="${L('so sieht dich dein Freund', 'how your friend sees you')}" value="${esc(coopName())}"></div>
        <button class="coopBtn" id="coopHost">${L('Gastgeber werden: Freund in meine Welt holen', 'Host: bring a friend into my world')}</button>
        <div class="coopOr">${L('oder', 'or')}</div>
        <label for="coopCode">${L('Einladung von deinem Freund', 'Invitation from your friend')}</label>
        <div class="coopRow"><input id="coopCode" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${L('Code oder Link einfügen', 'Paste code or link')}"><button id="coopJoin">${L('Beitreten', 'Join')}</button></div>
      </div></div>`;
    btns = [[L('Schließen', 'Close'), null]];
  }
  if (refresh) {
    // offen lassen und nur den Inhalt erneuern, wenn sich der Zustand geändert hat (nicht beim Tippen)
    const key = `${coop.role}|${coop.state}|${coop.code}|${coop.friend}`;
    if (m.dataset.coopKey === key || document.activeElement && document.activeElement.tagName === 'INPUT') return;
  }
  ui.modal(html, btns);
  m.dataset.coopKey = `${coop.role}|${coop.state}|${coop.code}|${coop.friend}`;
  if (intro) m.classList.add('coop-top');
  const $ = s => m.querySelector(s);
  const nameIn = $('#coopName');
  if (nameIn) nameIn.oninput = () => setCoopName(nameIn.value.trim());
  if ($('#coopHost')) $('#coopHost').onclick = () => {
    if (nameIn) setCoopName(nameIn.value.trim());
    if (intro && app.enterGame) app.enterGame();
    coop.startHost();
    openCoop(app);
  };
  const join = () => {
    const raw = $('#coopCode').value;
    const code = cleanCode(raw);
    if (code.length < 4) { $('#coopCode').focus(); app.toast(L('Füge den Code oder den Link deines Freundes ein.', 'Paste your friend\'s code or link.'), 'warn'); return; }
    if (nameIn) setCoopName(nameIn.value.trim());
    const u = new URL(location.href);
    u.searchParams.set('join', code);
    // Erde oder Inselwelt kommt aus dem Link des Freundes, ohne Link aus dem Schnappschuss (coop.js lädt passend neu)
    u.searchParams.delete('erde'); u.searchParams.delete('welt'); u.searchParams.delete('level');
    if (/[?&]erde\b/.test(raw)) u.searchParams.set('erde', ''); else if (/[?&]welt\b/.test(raw)) u.searchParams.set('welt', '');
    if (app.save) app.save(true, true);
    location.assign(u.toString().replace(/=(&|$)/g, '$1'));
  };
  if ($('#coopJoin')) { $('#coopJoin').onclick = join; $('#coopCode').onkeydown = e => { if (e.key === 'Enter') join(); }; }
  if ($('#coopCopy')) $('#coopCopy').onclick = async () => {
    const link = coop.link();
    let ok = false;
    try { await navigator.clipboard.writeText(link); ok = true; } catch { /* ohne Freigabe: markieren */ }
    if (!ok) { const r = document.createRange(); r.selectNodeContents($('#coopLink')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); try { ok = document.execCommand('copy'); } catch { /* egal */ } }
    app.toast(ok ? L('Link kopiert. Schick ihn deinem Freund.', 'Link copied. Send it to your friend.') : L('Markiert. Kopiere den Link selbst.', 'Selected. Copy the link yourself.'), 'god');
  };
  if ($('#coopShare')) $('#coopShare').onclick = () => navigator.share({ title: 'Pray For Rain', text: L('Komm in meine Welt!', 'Come into my world!'), url: coop.link() }).catch(() => {});
  if ($('#coopFind')) $('#coopFind').onclick = () => { m.className = ''; toFriend(app); };
}
