// Düsenjet (seit 27.10.2026, für die nahtlose Erde): einsitziger Kampfjet in den Farben des Inselflugzeugs (Creme, Koralle,
// Petrol), in Metern gebaut wie die Physik (render/flightphys.js jetPlane): Nase bei +z, Düse bei −z, Spannweite 10 m.
// Gleiche Teile wie buildPlane (planemodel.js), damit flight.js beide gleich behandelt: Querruder, Pendelleitwerk,
// Seitenruder, Nachbrennerflamme, Lichter, Pilot (im Cockpit ausgeblendet). Propeller und Scheibe sind leer.
import * as THREE from 'three';
import { makeEnv, glowTex, COL } from './planemodel.js';

// flache Fläche aus einem Umriss in x, z (Draufsicht), Dicke t, weich gerundete Kanten
function slab(pts, t) {
  const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: t * 0.4, bevelEnabled: true, bevelThickness: t * 0.3, bevelSize: Math.min(0.06, t * 0.5), bevelSegments: 3, curveSegments: 6 });
  g.rotateX(Math.PI / 2); // Umriss liegt in x, z, Dicke nach unten
  g.translate(0, t * 0.2, 0);
  return g;
}
// Fläche senkrecht (Seitenleitwerk): Umriss in z, y
function fin(pts, t) {
  const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: t * 0.4, bevelEnabled: true, bevelThickness: t * 0.3, bevelSize: Math.min(0.05, t * 0.5), bevelSegments: 3, curveSegments: 6 });
  g.rotateY(-Math.PI / 2); // z der Form wird zu z der Welt
  g.translate(t * 0.2, 0, 0);
  return g;
}

export function buildJet(renderer) {
  const env = makeEnv(renderer);
  const root = new THREE.Group();
  const paint = (c, o = {}) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.38, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.18, envMap: env, envMapIntensity: 0.6, side: THREE.DoubleSide, ...o });
  const plain = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0, envMap: env, envMapIntensity: 0.3, ...o });
  const M = {
    cream: paint(COL.cream), coral: paint(COL.coral), teal: paint(COL.teal), ink: paint(COL.ink),
    glass: new THREE.MeshPhysicalMaterial({ color: '#c7a24a', roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.45, envMap: env, envMapIntensity: 2, clearcoat: 1, depthWrite: false }),
    metal: plain('#8d8a85', { roughness: 0.3, metalness: 0.85, envMapIntensity: 1 }), dark: plain('#2a2d30'), rubber: plain(COL.rubber, { roughness: 0.9 }),
    helmet: paint('#efe6d2'), visor: paint('#3a2a1a', { roughness: 0.1 }),
  };
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = root, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m; };

  // Rumpf: Drehkörper von der Düse (−7,1) bis zur Nasenspitze (+7,6), etwas flacher als hoch
  const prof = [];
  const R = z => {
    if (z > 5.2) return 0.62 * Math.pow(Math.max(0, (7.6 - z) / 2.4), 0.7); // Nase
    if (z > 2.0) return 0.62 + (0.78 - 0.62) * (5.2 - z) / 3.2;
    if (z > -4.5) return 0.78;
    return 0.78 - (0.78 - 0.58) * (-4.5 - z) / 2.6; // zur Düse hin schmaler
  };
  for (let i = 0; i <= 40; i++) { const z = -7.1 + 14.7 * i / 40; prof.push(new THREE.Vector2(Math.max(0.001, R(z)), z)); }
  // Lathe läuft entlang y: auf z legen (Nase nach +z)
  const bodyG = new THREE.LatheGeometry(prof, 32).rotateX(Math.PI / 2);
  bodyG.scale(1, 0.88, 1);
  add(bodyG, M.cream);
  // Nasenspitze dunkel (Radom) und Streifen in Koralle und Petrol
  add(new THREE.ConeGeometry(0.2, 0.7, 24).rotateX(Math.PI / 2).scale(1, 0.88, 1), M.ink, 0, 0, 7.3);
  for (const [z, m] of [[4.6, M.coral], [4.25, M.teal]]) add(new THREE.CylinderGeometry(R(z) * 1.012, R(z) * 1.012, 0.18, 32, 1, true).rotateX(Math.PI / 2).scale(1, 0.88, 1), m, 0, 0, z, root, false);
  // Rückenlinie zum Leitwerk (Buckel hinter der Kuppel)
  add(new THREE.SphereGeometry(1, 24, 12).scale(0.42, 0.42, 3.6), M.cream, 0, 0.5, -0.4);
  // Glaskuppel und Rahmen
  add(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.5, 0.6, 1.7), M.glass, 0, 0.5, 3.55, root, false);
  add(new THREE.TorusGeometry(0.5, 0.035, 8, 28, Math.PI).scale(1, 1.15, 1), M.ink, 0, 0.5, 2.6, root, false);
  // Pilot mit Helm und Visier
  const pilot = new THREE.Group(); root.add(pilot);
  add(new THREE.SphereGeometry(0.17, 16, 12), M.helmet, 0, 0.82, 3.45, pilot);
  add(new THREE.SphereGeometry(0.15, 14, 10, -Math.PI * 0.45, Math.PI * 0.9, Math.PI * 0.35, Math.PI * 0.3), M.visor, 0, 0.82, 3.47, pilot);
  add(new THREE.CylinderGeometry(0.18, 0.22, 0.45, 12), M.ink, 0, 0.5, 3.35, pilot);
  // Lufteinlass unter dem Rumpf (wie bei der F-16), innen dunkel
  add(new THREE.CylinderGeometry(0.55, 0.6, 2.6, 24).rotateX(Math.PI / 2).scale(1, 0.62, 1), M.cream, 0, -0.62, 1.6);
  add(new THREE.CylinderGeometry(0.46, 0.46, 0.05, 24).rotateX(Math.PI / 2).scale(1, 0.6, 1), M.dark, 0, -0.62, 2.92, root, false);
  // Düse aus Metall, innen dunkel
  add(new THREE.CylinderGeometry(0.5, 0.58, 0.9, 24, 1, true).rotateX(Math.PI / 2), M.metal, 0, 0, -7.25);
  add(new THREE.CircleGeometry(0.48, 24).rotateY(Math.PI), M.dark, 0, 0, -7.6, root, false);
  // Nachbrennerflamme: zwei Kegel, außen orange, innen hell (Deckkraft nach Schub)
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const flame = new THREE.Group(); flame.position.set(0, 0, -7.6); root.add(flame);
  add(new THREE.ConeGeometry(0.45, 3.2, 20, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -1.6), flameMat, 0, 0, 0, flame, false);
  const coreMat = flameMat.clone(); coreMat.color.set('#bfe6ff');
  add(new THREE.ConeGeometry(0.25, 1.6, 16, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.8), coreMat, 0, 0, 0, flame, false);
  flameMat.onBeforeRender = () => { coreMat.opacity = flameMat.opacity; };

  // Flügel: Pfeilflügel, Vorderkante 40 Grad, Querruder an der Hinterkante außen
  const ail = {}, lights = { nav: [], strobe: [], beacon: null, tail: null };
  const glow = glowTex();
  const lamp = (parent, x, y, z, color, size) => {
    const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
    add(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color, toneMapped: false }), 0, 0, 0, g, false);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
    sp.scale.setScalar(size); g.add(sp); g.userData.sprite = sp; g.userData.size = size;
    return g;
  };
  for (const s of [-1, 1]) {
    const W = [[0.6 * s, 1.4], [5.0 * s, -2.3], [5.0 * s, -3.2], [3.4 * s, -3.4], [0.6 * s, -3.6]];
    add(slab(W, 0.16), M.cream, 0, -0.05, 0);
    // Querruder (Drehpunkt an der Hinterkante innen)
    const piv = new THREE.Group(); piv.position.set(2.0 * s, -0.05, -3.45); root.add(piv);
    add(slab([[0, 0], [1.4 * s, 0.07], [1.4 * s, -0.4], [0, -0.45]].map(([x, z]) => [x, z]), 0.08), M.coral, 0, 0, 0, piv);
    ail[s < 0 ? 'L' : 'R'] = piv;
    // Spitze in Koralle mit Rakete als Schiene
    add(new THREE.CylinderGeometry(0.07, 0.07, 2.8, 10).rotateX(Math.PI / 2), M.teal, 5.05 * s, -0.05, -2.1, root, true);
    add(new THREE.ConeGeometry(0.07, 0.35, 10).rotateX(Math.PI / 2), M.coral, 5.05 * s, -0.05, -0.55, root, false);
    lights.nav.push(lamp(root, 5.12 * s, 0.02, -2.75, s > 0 ? 0xff3a30 : 0x35ff6a, 0.7));
    lights.strobe.push(lamp(root, 5.12 * s, 0.02, -3.1, 0xffffff, 0.0));
  }
  // Pendelhöhenleitwerk (ganz beweglich), Drehpunkt bei z −6,1
  const elev = new THREE.Group(); elev.position.set(0, 0.1, -6.1); root.add(elev);
  for (const s of [-1, 1]) add(slab([[0.5 * s, 0.6], [2.9 * s, -0.7], [2.9 * s, -1.2], [0.5 * s, -1.1]], 0.1), M.cream, 0, 0, 0, elev);
  for (const s of [-1, 1]) add(slab([[2.3 * s, -0.4], [2.9 * s, -0.7], [2.9 * s, -1.2], [2.3 * s, -1.15]], 0.11), M.coral, 0, 0.002, 0, elev, false);
  // Seitenleitwerk mit Ruder
  add(fin([[-3.9, 0.5], [-6.3, 3.3], [-7.0, 3.3], [-7.1, 0.5]], 0.14), M.cream);
  add(fin([[-6.25, 2.95], [-6.3, 3.3], [-7.0, 3.3], [-7.0, 2.95]], 0.15), M.coral, 0, 0, 0, root, false);
  const rud = new THREE.Group(); rud.position.set(0, 0.6, -6.6); root.add(rud);
  add(fin([[0, 0], [-0.45, 0], [-0.45, 2.2], [0, 2.4]], 0.1), M.teal, 0, 0, 0, rud);
  lights.tail = lamp(root, 0, 3.32, -6.9, 0xffffff, 0.45);
  lights.beacon = lamp(root, 0, 1.25, -1.4, 0xff2a1a, 0.0);
  // Fahrwerk: Bugrad und zwei Haupträder (Aufstand bei y −1,75 wie in der Physik)
  const wheel = (x, z, r) => { add(new THREE.CylinderGeometry(r, r, 0.2, 18).rotateZ(Math.PI / 2), M.rubber, x, -1.75 + r, z); add(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.22, 14).rotateZ(Math.PI / 2), M.metal, x, -1.75 + r, z, root, false); add(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 8), M.metal, x * 0.85, -0.95, z, root, false); };
  wheel(0, 4.2, 0.24); wheel(-1.25, -0.9, 0.34); wheel(1.25, -0.9, 0.34);
  // leere Teile, die flight.js vom Propellerflugzeug kennt
  const prop = new THREE.Group(); prop.visible = false; root.add(prop);
  const blur = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 })); blur.visible = false; root.add(blur);

  root.traverse(o => { if (o.isMesh && o.material && o.material.transparent) o.castShadow = false; });
  return { root, prop, blur, ail, elev, rud, flame, flameMat, lights, hideInCockpit: [pilot], env, jet: true };
}
