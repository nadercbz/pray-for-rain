// Gebäude gebündelt zeichnen (seit 26.11.2026, PLAN_QUALITAET.md Abschnitt 6).
// Vorher war jedes Gebäude ein eigenes Objekt mit drei Materialien: eine Stadt mit 1000 Häusern kostete über 6000
// Zeichenbefehle je Bild (dazu Schatten und Umgebungsverdeckung), der Rechner brauchte rund 29 ms nur zum Abschicken.
// Es gibt über 500 verschiedene Bauformen, einfache Instanzen je Form bringen darum wenig. BatchedMesh zeichnet viele
// verschiedene Formen mit einem Befehl je Material und blendet selbst aus, was nicht im Bild ist.
//
// Die einzelnen Gebäude bleiben als Objekte bestehen (Lage, Anklicken, Grundriss, Einsturz), sie werden nur nicht mehr
// selbst gezeichnet (mesh.visible = false), solange sie fertig und ruhig sind. Was sich gerade verändert (Baustelle,
// Aufspringen, Durchsichtig im Geistmodus, Einsturz, Zeitraffer), zeichnet sich wie früher selbst.
import * as THREE from 'three';

const GROW = 1.25;   // seit 26.11.2026 knapper: weniger ungenutzter Speicher im Stapel

class Batch {
  constructor(parent, material) {
    this.parent = parent; this.material = material;
    this.geoId = new Map();      // Form (uuid + Teil) -> geometryId
    this.ids = [];               // Instanzen des letzten Aufbaus
    this.maxI = 512; this.maxV = 400000; this.usedV = 0;
    this.make();
  }
  make() {
    const m = this.mesh = new THREE.BatchedMesh(this.maxI, this.maxV, 3, this.material);
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.sortObjects = false; m.perObjectFrustumCulled = true;
    m.userData.kind = 'buildingBatch';
    this.parent.add(m);
    this.geoId.clear(); this.ids.length = 0; this.usedV = 0;
  }
  reset(maxI, maxV) {
    this.parent.remove(this.mesh); this.mesh.dispose();
    this.maxI = maxI; this.maxV = maxV;
    this.make();
  }
  geometry(key, make) {
    let id = this.geoId.get(key);
    if (id !== undefined) return id;
    const g = make();
    if (!g) { this.geoId.set(key, -1); return -1; }
    const n = g.attributes.position.count;
    if (this.usedV + n > this.maxV) { this.maxV = Math.ceil((this.usedV + n) * GROW); this.mesh.setGeometrySize(this.maxV, 3); }
    id = this.mesh.addGeometry(g);
    this.usedV += n;
    this.geoId.set(key, id);
    return id;
  }
  clear() { for (const i of this.ids) this.mesh.deleteInstance(i); this.ids.length = 0; }
  add(geoId, matrix) {
    if (this.ids.length >= this.maxI) { this.maxI = Math.ceil(this.maxI * GROW) + 64; this.mesh.setInstanceCount(this.maxI); }
    const i = this.mesh.addInstance(geoId);
    this.mesh.setMatrixAt(i, matrix);
    this.ids.push(i);
  }
}

// Teil einer zusammengefügten Form (eine Materialgruppe) als eigene Geometrie mit genau Ort, Normale, Farbe
function slice(g, group) {
  const src = g.index ? (g.userData._ni || (g.userData._ni = g.toNonIndexed())) : g;
  const a = src.attributes;
  if (!a.position || !a.normal || !a.color) return null;
  const s = group ? group.start : 0, n = group ? group.count : a.position.count;
  if (n < 3) return null;
  const cut = (at, size) => new THREE.BufferAttribute(at.array.slice(s * size, (s + n) * size), size);
  // Normale und Farbe als Bytes (statt je 12 Byte Gleitkomma): der Stapel einer ganzen Welt braucht so rund die Hälfte
  const pack = (at, Type, k, lo, hi) => { const src = at.array, o = new Type(n * 3); for (let i = 0; i < n * 3; i++) { const v = Math.round(src[s * 3 + i] * k); o[i] = v < lo ? lo : v > hi ? hi : v; } return new THREE.BufferAttribute(o, 3, true); };
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', cut(a.position, 3));
  out.setAttribute('normal', pack(a.normal, Int8Array, 127, -127, 127));
  out.setAttribute('color', pack(a.color, Uint8Array, 255, 0, 255));
  // leere Platzhalter (ein Dreieck ohne Fläche) brauchen keine Instanz
  if (n === 3) { const p = out.attributes.position.array; if (p.every(v => v === 0)) return null; }
  return out;
}

export class BuildingBatches {
  constructor(group) {
    this.group = group;
    this.by = new Map();   // Material -> Batch
    this.on = true;
    this.count = 0;
  }
  batch(mat) { let b = this.by.get(mat); if (!b) { b = new Batch(this.group, mat); this.by.set(mat, b); } return b; }

  // items: [{ mesh, mats }] alle ruhigen, fertigen Gebäude. Alles andere muss mesh.visible = true behalten.
  rebuild(items) {
    for (const b of this.by.values()) b.clear();
    let live = 0;
    for (const it of items) {
      const mesh = it.mesh, g = mesh.geometry, mats = it.mats;
      const groups = g.groups && g.groups.length ? g.groups : [{ start: 0, count: g.attributes.position.count, materialIndex: 0 }];
      let ok = false;
      for (let gi = 0; gi < groups.length; gi++) {
        const gr = groups[gi], mat = mats[gr.materialIndex] || mats[0];
        const B = this.batch(mat);
        const id = B.geometry(g.uuid + ':' + gi, () => slice(g, gr));
        if (id < 0) continue;
        B.add(id, mesh.matrixWorld);
        ok = true;
      }
      // die aufgelöste Kopie der Form (36 Byte je Eckpunkt) wird nur zum Zerschneiden gebraucht: gleich wieder freigeben,
      // sonst liegt jede Bauform dauerhaft doppelt im Speicher (seit 26.11.2026, rund 200 MB in einer späten Welt)
      if (g.userData._ni) { g.userData._ni.dispose(); delete g.userData._ni; }
      mesh.visible = !ok;
      if (ok) live++;
    }
    this.count = live;
    // Aufräumen: liegen viel mehr Formen im Speicher, als gerade gebraucht werden (Jahreszeiten der Felder, Epochen),
    // wird der Stapel neu angelegt. Der nächste Aufbau füllt ihn wieder.
    for (const B of this.by.values()) {
      if (B.geoId.size > 60 && B.ids.length === 0) { B.reset(512, 400000); continue; }
      if (B.usedV > 3000000 && B.geoId.size > B.ids.length * 3) { B.reset(Math.max(512, B.ids.length * 2), 400000); this.again = true; }
    }
  }
  // alles wieder einzeln zeichnen (Zeitraffer, Abschalten)
  off(meshes) {
    for (const b of this.by.values()) b.clear();
    for (const m of meshes) m.visible = true;
    this.count = 0;
  }
  stats() { let geos = 0, inst = 0, verts = 0; for (const b of this.by.values()) { geos += b.geoId.size; inst += b.ids.length; verts += b.usedV; } return { stapel: this.by.size, formen: geos, instanzen: inst, eckpunkte: verts, gebaeude: this.count }; }
}
