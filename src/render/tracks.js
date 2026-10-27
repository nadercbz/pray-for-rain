// Fußspuren (seit 25.10.2026, Naders Wunsch: "durch die Wüste laufen und Fußabdrücke hinterlassen, auch im Schnee").
// Der Geist hinterlässt im Sand und im Schnee Abdrücke, links und rechts im Wechsel, die langsam verwehen.
// Ein Ring von Abdrücken (älteste werden überschrieben), Farbe je Untergrund, Deckkraft nach Alter im Shader.
import * as THREE from 'three';

const N = 360;          // höchstens so viele Abdrücke zugleich
const LIFE = 40;        // Sekunden, bis ein Abdruck verweht ist

export class Tracks {
  constructor(scene) {
    // Sohle: ein längliches Oval mit kleinerer Ferse, flach auf dem Boden
    const sole = new THREE.CircleGeometry(1, 14).scale(0.011, 0.02, 1).translate(0, 0.006, 0);
    const heel = new THREE.CircleGeometry(1, 10).scale(0.009, 0.01, 1).translate(0, -0.019, 0);
    const g = new THREE.BufferGeometry();
    const merge = [sole, heel].map(x => x.toNonIndexed());
    const pos = new Float32Array(merge.reduce((a, x) => a + x.attributes.position.array.length, 0));
    let o = 0;
    for (const x of merge) { pos.set(x.attributes.position.array, o); o += x.attributes.position.array.length; }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.rotateX(-Math.PI / 2); // flach, Spitze zeigt nach -z (wird je Abdruck in Laufrichtung gedreht)
    this.aT = new THREE.InstancedBufferAttribute(new Float32Array(N).fill(-1e9), 1);
    g.setAttribute('aT', this.aT);
    this.uTime = { value: 0 };
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
      uniforms: { uTime: this.uTime, uLife: { value: LIFE } },
      vertexShader: `attribute float aT; varying float vA; varying vec3 vC; uniform float uTime, uLife;
        void main(){ float age = uTime - aT; vA = age < 0.0 ? 0.0 : 1.0 - smoothstep(uLife * 0.45, uLife, age); vC = instanceColor;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying float vA; varying vec3 vC; void main(){ if (vA <= 0.01) discard; gl_FragColor = vec4(vC, vA * 0.62); }`,
    });
    this.mesh = new THREE.InstancedMesh(g, mat, N);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 4; this.mesh.count = N;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < N; i++) this.mesh.setMatrixAt(i, zero);
    scene.add(this.mesh);
    this.i = 0; this.o = new THREE.Object3D();
    this.col = { sand: new THREE.Color('#9c7d55'), snow: new THREE.Color('#8a9cb8') };
  }

  // Ein Abdruck bei (x, y, z), Laufrichtung yaw (0 = +z), Untergrund 'sand' oder 'snow', Größe s
  step(x, y, z, yaw, kind, s = 1) {
    const o = this.o, i = this.i;
    o.position.set(x, y + 0.004, z); o.rotation.set(0, yaw + Math.PI, 0); o.scale.setScalar(s); o.updateMatrix();
    this.mesh.setMatrixAt(i, o.matrix);
    this.mesh.setColorAt(i, this.col[kind] || this.col.sand);
    this.aT.array[i] = this.uTime.value;
    this.aT.needsUpdate = true; this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
    this.i = (i + 1) % N;
  }

  update(t) { this.uTime.value = t; }
}
