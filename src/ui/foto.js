// Fotomodus und Zeitraffer als Video (seit 26.11.2026, Naders Auftrag "alles umsetzen").
// Fotomodus (Taste O oder Kamera Knopf): Oberfläche weg, Zeit steht, Tageszeit per Regler, Kamera frei, Bild speichern.
// Video: der vorhandene Zeitraffer (ui/timelapse.js) wird mit Jahr, Text und Schriftzug in eine Datei aufgenommen,
// quer oder hochkant 9:16 für Reels und TikTok. Aufnahme über MediaRecorder, kein Server, die Datei bleibt beim Spieler.
import { L } from '../i18n.js';

export function initFoto(app) {
  const stage = app.stage, canvas = stage.renderer.domElement;
  const F = { on: false, rec: null };
  const bar = document.createElement('div');
  bar.id = 'fotoBar';
  document.body.append(bar);

  // Knopf in der Leiste
  const icons = document.querySelector('.icons');
  if (icons && !document.getElementById('btnFoto')) {
    const b = document.createElement('button');
    b.id = 'btnFoto'; b.title = L('Fotomodus und Video (O)', 'Photo mode and video (O)');
    b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 8.5C4 7.7 4.7 7 5.5 7h2.2l1.3-2h6l1.3 2h2.2c.8 0 1.5.7 1.5 1.5v9c0 .8-.7 1.5-1.5 1.5h-13c-.8 0-1.5-.7-1.5-1.5z"/><circle cx="12" cy="13" r="3.4"/></svg>';
    b.onclick = () => F.toggle();
    const before = document.getElementById('btnSound');
    icons.insertBefore(b, before || null);
  }

  const download = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  };
  const stamp = () => { const st = app.st, y = st ? Math.floor(st.day / 24) + 1 : 0; return 'pray-for-rain-jahr-' + y + '-' + new Date().toISOString().slice(0, 10); };

  // nach dem nächsten gezeichneten Bild ausführen (der Inhalt des Canvas ist nur direkt nach dem Zeichnen lesbar)
  const after = [];
  app.afterRender = () => { if (after.length) { const list = after.splice(0); for (const f of list) { try { f(); } catch (e) { app.noteError && app.noteError('foto', e); } } } if (F.rec) F.rec.frame(); };

  F.snap = () => {
    const pr0 = stage.renderer.getPixelRatio(), want = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
    const big = want > pr0 + 0.01 && innerWidth * innerHeight * want * want < 9e6 * 2;
    if (big) { stage.userQuality = stage.userQuality || false; stage.renderer.setPixelRatio(want); stage.resize(); stage.warm && stage.warm(); }
    let n = 0;
    const go = () => {
      if (++n < 3) return after.push(go);          // zwei Bilder warten: Schatten und Umgebungsverdeckung in voller Güte
      canvas.toBlob(b => {
        if (big) { stage.renderer.setPixelRatio(pr0); stage.resize(); stage.warm && stage.warm(); }
        if (b) { download(b, stamp() + '.png'); app.ui && app.ui.toast(L('Bild gespeichert.', 'Picture saved.')); }
      }, 'image/png');
    };
    after.push(go);
  };

  // ---------- Fotomodus ----------
  F.enter = () => {
    if (F.on || !app.st || !app.running) return;
    F.on = true;
    F.saved = { tod: app.fixTod, paused: app.paused };
    document.body.classList.add('foto');
    app.setPaused && app.setPaused(true);
    document.body.classList.remove('paused');
    const tod0 = app.fixTod != null ? app.fixTod : 0.42;
    bar.innerHTML = `
      <label>${L('Tageszeit', 'Time of day')}<input type="range" id="fotoTod" min="0" max="1000" value="${Math.round(tod0 * 1000)}"></label>
      <label>${L('Schärfe', 'Focus')}<input type="range" id="fotoBlur" min="0" max="100" value="60"></label>
      <button id="fotoSnap" class="prim">${L('Bild speichern', 'Save picture')}</button>
      <button id="fotoVid">${L('Zeitraffer Video', 'Time-lapse video')}</button>
      <button id="fotoVidH">${L('Video hochkant', 'Vertical video')}</button>
      <button id="fotoClose" title="Esc">${L('Schließen', 'Close')}</button>`;
    bar.classList.add('show');
    app.fixTod = tod0;
    bar.querySelector('#fotoTod').oninput = e => { app.fixTod = e.target.value / 1000; };
    bar.querySelector('#fotoBlur').oninput = e => { F.blur = e.target.value / 100; };
    bar.querySelector('#fotoSnap').onclick = () => F.snap();
    bar.querySelector('#fotoVid').onclick = () => F.video(false);
    bar.querySelector('#fotoVidH').onclick = () => F.video(true);
    bar.querySelector('#fotoClose').onclick = () => F.exit();
    F.blur = 0.6;
  };
  F.exit = () => {
    if (!F.on) return;
    F.on = false; F.blur = null;
    document.body.classList.remove('foto');
    bar.classList.remove('show');
    app.fixTod = F.saved.tod;
    app.setPaused && app.setPaused(!!F.saved.paused);
  };
  F.toggle = () => (F.on ? F.exit() : F.enter());
  window.addEventListener('keydown', e => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (F.on && e.key === 'Escape' && !F.rec) { e.stopImmediatePropagation(); F.exit(); }
    else if ((e.key === 'o' || e.key === 'O') && !document.body.classList.contains('ghost-mode') && !app.flying && !app.driving && !app.mapOpen && !document.querySelector('#modal.show')) F.toggle();
  }, true);

  // ---------- Zeitraffer als Video ----------
  F.video = hoch => {
    if (F.rec || !app.timelapse || !window.MediaRecorder) { if (!window.MediaRecorder) app.ui && app.ui.toast(L('Dieser Browser kann kein Video aufnehmen.', 'This browser cannot record video.'), 'warn'); return; }
    const st = app.st;
    const town = st.settlements.filter(s => s.alive).sort((a, b) => b.pop - a.pop)[0];
    // der Ort unter dem Blick, wenn man nah dran ist, sonst der größte
    const tg = stage.controls.target, NX = app.NX, NY = app.NY;
    let pick = town, bd = 1e9;
    for (const s of st.settlements) { if (!s.alive) continue; const d = Math.hypot(s.cx - NX / 2 + 0.5 - tg.x, s.cy - NY / 2 + 0.5 - tg.z); if (d < bd) { bd = d; if (d < (s.R || 6) + 8) pick = s; } }
    if (!pick) return;
    const W = hoch ? 1080 : 1920, H = hoch ? 1920 : 1080;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const types = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const type = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
    const stream = cv.captureStream(30);
    let mr;
    try { mr = new MediaRecorder(stream, { mimeType: type || undefined, videoBitsPerSecond: 12e6 }); } catch (e) { app.ui && app.ui.toast(L('Die Aufnahme ließ sich nicht starten.', 'Recording could not start.'), 'warn'); return; }
    const chunks = [];
    mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      const blob = new Blob(chunks, { type: mr.mimeType || type || 'video/webm' });
      download(blob, stamp() + '-zeitraffer' + (hoch ? '-hochkant' : '') + (/(mp4)/.test(blob.type) ? '.mp4' : '.webm'));
      app.ui && app.ui.toast(L('Video gespeichert.', 'Video saved.'));
    };
    const wasFoto = F.on;
    if (wasFoto) { bar.classList.remove('show'); app.fixTod = null; app.setPaused && app.setPaused(false); document.body.classList.remove('paused'); }
    document.body.classList.add('foto', 'rec');
    const font = t => `${t} "Fraunces", "Cormorant Garamond", Georgia, serif`;
    const wrap = (text, maxW) => { const words = text.split(' '), lines = []; let cur = ''; for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur); return lines.slice(0, 3); };
    F.rec = {
      frame() {
        // Ausschnitt des Spielbilds mittig in das Zielformat
        const sw = canvas.width, sh = canvas.height, ar = W / H;
        let cw = sw, ch = sw / ar; if (ch > sh) { ch = sh; cw = sh * ar; }
        g.drawImage(canvas, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, W, H);
        const box = app.timelapse.box, q = s => { const e = box.querySelector(s); return e ? e.textContent.trim() : ''; };
        const grd = g.createLinearGradient(0, H * 0.62, 0, H); grd.addColorStop(0, 'rgba(6,14,20,0)'); grd.addColorStop(1, 'rgba(6,14,20,0.78)');
        g.fillStyle = grd; g.fillRect(0, H * 0.62, W, H * 0.38);
        const top = g.createLinearGradient(0, 0, 0, H * 0.16); top.addColorStop(0, 'rgba(6,14,20,0.6)'); top.addColorStop(1, 'rgba(6,14,20,0)');
        g.fillStyle = top; g.fillRect(0, 0, W, H * 0.16);
        const u = W / 1080 * (hoch ? 1 : 0.62), pad = 64 * u;
        g.textBaseline = 'alphabetic'; g.fillStyle = '#e9b949'; g.font = font(`600 ${34 * u}px`);
        g.fillText('PRAY FOR RAIN', pad, pad + 26 * u);
        g.fillStyle = '#f3ead6'; g.font = `500 ${30 * u}px system-ui, sans-serif`;
        g.fillText(pick.name, pad, pad + 70 * u);
        g.font = font(`600 ${110 * u}px`); g.fillStyle = '#f3ead6';
        const base = H - pad - (hoch ? 190 : 110) * u;
        g.fillText(q('.tl-year'), pad, base);
        g.font = `500 ${32 * u}px system-ui, sans-serif`; g.fillStyle = 'rgba(243,234,214,0.8)';
        g.fillText(q('.tl-sub'), pad, base + 48 * u);
        const cap = box.querySelector('.tl-cap'); const ct = cap ? cap.textContent.trim() : '';
        if (ct) { g.font = font(`500 ${36 * u}px`); g.fillStyle = '#f3ead6'; wrap(ct, W - pad * 2).forEach((l, i) => g.fillText(l, pad, base + 104 * u + i * 44 * u)); }
        if (!app.timelapse.active) F.stopVideo();
      },
    };
    app.timelapse.start(pick.id);
    mr.start(500);
    F.mr = mr; F.wasFoto = wasFoto;
    app.ui && app.ui.toast(L('Aufnahme läuft. Esc beendet sie.', 'Recording. Esc stops it.'));
  };
  F.stopVideo = () => {
    if (!F.rec) return;
    F.rec = null;
    try { F.mr.stop(); } catch { /* egal */ }
    document.body.classList.remove('rec');
    if (F.wasFoto) { F.on = false; F.enter(); } else document.body.classList.remove('foto');
  };
  app.foto = F;
  return F;
}
