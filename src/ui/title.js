// Das Startbild lebt: Wasser kräuselt sich und glitzert im Sonnenpfad, Bäume wiegen sich im Wind,
// Wolken wogen langsam, der Lichtstrahl atmet. Ein kleiner WebGL Shader über dem gemalten Titelbild.
// Masken (assets/title_mask.webp): Rot Wasser, Grün Bäume, Blau Wolken und Himmel.
// Ohne WebGL bleibt einfach das stille Bild als Hintergrund stehen.

const VS = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `
precision highp float;
uniform sampler2D img, msk;
uniform vec2 res;
uniform float t, aspect;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 s = gl_FragCoord.xy / res; s.y = 1.0 - s.y;
  // wie background-size: cover, mittig
  vec2 uv = s; float sa = res.x / res.y;
  if (sa > aspect) uv.y = 0.5 + (s.y - 0.5) * aspect / sa; else uv.x = 0.5 + (s.x - 0.5) * sa / aspect;
  vec3 m = texture2D(msk, uv).rgb;
  vec2 px = vec2(1.0 / 2400.0, 1.0 / 1350.0);
  // Wasser: zwei Wellenzüge, vorne gröber, zum Horizont feiner
  float near = smoothstep(0.22, 1.0, uv.y);
  vec2 q = uv * vec2(1.0, 2.8);
  float n1 = vn(q * (30.0 - near * 12.0) + vec2(t * 0.22, t * 0.1));
  float n2 = vn(q * (62.0 - near * 20.0) - vec2(t * 0.16, -t * 0.26));
  vec2 dW = vec2(n1 - 0.5, (n2 - 0.5) * 0.7) * (1.6 + near * 5.0);
  // Bäume: Böen, die über die Insel laufen
  float gust = 0.55 + 0.45 * sin(t * 0.8 - uv.x * 9.0) * (0.6 + 0.4 * vn(vec2(t * 0.35, uv.y * 5.0)));
  vec2 dG = vec2(sin(t * 2.4 + uv.y * 140.0 + uv.x * 60.0) * 1.3 + (vn(uv * 160.0 + t * 1.7) - 0.5) * 2.2,
                 (vn(uv * 180.0 - t * 1.3) - 0.5) * 1.0) * gust;
  // Wolken und Himmel: langsames Wogen und ein sanftes Ziehen
  vec2 dC = vec2(vn(uv * vec2(5.0, 8.0) + vec2(t * 0.09, 0.0)) - 0.5, vn(uv * vec2(6.0, 4.0) - vec2(0.0, t * 0.07)) - 0.5) * 18.0
          + vec2(sin(t * 0.12) * 9.0, 0.0);
  vec2 d = (dW * m.r + dG * m.g + dC * m.b) * px;
  vec3 col = texture2D(img, clamp(uv + d, 0.0, 1.0)).rgb;
  // Glitzern: im Sonnenpfad rechts, unter dem Lichtstrahl und auf hellem Wasser
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  float sunPath = exp(-pow((uv.x - 0.81) / (0.035 + (uv.y - 0.22) * 0.35), 2.0)) * smoothstep(0.22, 0.24, uv.y) * (1.0 - smoothstep(0.32, 0.62, uv.y));
  float beamPath = exp(-pow((uv.x - 0.565) / 0.045, 2.0)) * smoothstep(0.72, 0.9, uv.y);
  float sp = pow(vn(uv * vec2(520.0, 1100.0) + vec2(t * 0.9, t * 0.35)), 34.0) * 1.4 + pow(vn(uv * vec2(260.0, 600.0) - vec2(t * 0.5, 0.0)), 40.0);
  col += vec3(1.0, 0.94, 0.78) * sp * m.r * (0.02 + sunPath * 2.6 + beamPath * 1.2 + smoothstep(0.75, 0.92, lum) * 0.5);
  // Lichtstrahl atmet, feiner Staub steigt darin
  float bx = uv.x - (0.556 - uv.y * 0.055);
  float beam = exp(-pow(bx / 0.032, 2.0)) * (1.0 - smoothstep(0.18, 0.5, uv.y));
  float dust = pow(vn(vec2(uv.x * 420.0, uv.y * 260.0 + t * 1.2)), 30.0) * 0.9;
  col += vec3(1.0, 0.92, 0.68) * beam * (0.05 + 0.05 * sin(t * 0.9) + dust);
  gl_FragColor = vec4(col, 1.0);
}`;

function load(src) {
  return new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
}

export async function liveTitle(host) {
  if (!host || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'live';
  const gl = c.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' });
  if (!gl) return;
  let im, mk;
  try { [im, mk] = await Promise.all([load('assets/title.webp'), load('assets/title_mask.webp')]); } catch { return; }
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.warn('Startbild Shader:', gl.getProgramInfoLog(pr)); return; }
  gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = (unit, image, name) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(pr, name), unit);
  };
  tex(0, im, 'img'); tex(1, mk, 'msk');
  const uRes = gl.getUniformLocation(pr, 'res'), uT = gl.getUniformLocation(pr, 't');
  gl.uniform1f(gl.getUniformLocation(pr, 'aspect'), im.width / im.height);
  host.append(c);
  const intro = host.closest('#intro');
  const t0 = performance.now();
  let raf = 0;
  const frame = now => {
    if (intro && intro.classList.contains('gone')) {
      // Startbild ist weg: noch ausblenden lassen, dann den Grafikspeicher freigeben
      setTimeout(() => { cancelAnimationFrame(raf); gl.getExtension('WEBGL_lose_context')?.loseContext(); c.remove(); }, 1500);
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.round(host.clientWidth * dpr), h = Math.round(host.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; gl.viewport(0, 0, w, h); }
    gl.uniform2f(uRes, w, h);
    gl.uniform1f(uT, (now - t0) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!c.classList.contains('on')) c.classList.add('on');
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}
