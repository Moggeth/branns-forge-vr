// Brann's Forge — fire / liquid-fuel presentation module (Three.js, imports only 'three').
// Presentation only: the integrator owns damage, ignition, heat, fuel. See HANDOFF.md.
import * as THREE from 'three';

const MAX_PACKETS = 96, MAX_CELLS = 256, MAX_PATCHES = 32, MAX_LIGHTS = 3;
const FLAME_CAP = 448, EMBER_CAP = 192, SMOKE_CAP = 128; // = 768 instances
const MAX_FUEL_TILES = MAX_CELLS * 5; // sparse field border prevents square cut-off edges
const CELL = 0.5, SUB = 4, VPC = (SUB + 1) * (SUB + 1), QPC = SUB * SUB;
const EXTRAP_MAX = 0.05; // seconds of packet extrapolation
const BUCKET = 2; // metres, light grouping
const MAX_CANDS = 640;

// ---------- deterministic hashing ----------
function hash32(n) { n |= 0; n = Math.imul(n ^ (n >>> 16), 0x7feb352d); n = Math.imul(n ^ (n >>> 15), 0x846ca68b); return (n ^ (n >>> 16)) >>> 0; }
const hash01 = (n) => hash32(n) / 4294967296;
function idSeed(id) {
  if (typeof id === 'number') return id | 0;
  let h = 2166136261; const s = String(id);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h | 0;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fract = (v) => v - Math.floor(v);
const cellKey = (ix, iz) => ((ix & 0xffff) << 16 | (iz & 0xffff)) >>> 0;

// ---------- instance buffers ----------
class InstBuf {
  constructor(cap) {
    this.cap = cap; this.n = 0;
    this.pos = new Float32Array(cap * 3); this.dir = new Float32Array(cap * 3); this.p = new Float32Array(cap * 4);
  }
  push(px, py, pz, dx, dy, dz, len, width, seed, alpha) {
    if (this.n >= this.cap || alpha <= 0.003) return;
    const i = this.n++, l = Math.hypot(dx, dy, dz) || 1;
    this.pos[i * 3] = px; this.pos[i * 3 + 1] = py; this.pos[i * 3 + 2] = pz;
    this.dir[i * 3] = dx / l; this.dir[i * 3 + 1] = dy / l; this.dir[i * 3 + 2] = dz / l;
    this.p[i * 4] = len; this.p[i * 4 + 1] = width; this.p[i * 4 + 2] = seed; this.p[i * 4 + 3] = alpha;
  }
}

// ---------- shaders ----------
const NOISE_GLSL = `
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ return vnoise(p) * 0.6 + vnoise(p * 2.1 + 7.3) * 0.4; }
`;

const TONGUE_VERT = `
attribute vec3 iPos; attribute vec3 iDir; attribute vec4 iP;
uniform float uTime; uniform float uBend;
varying vec2 vUv; varying float vA; varying float vS;
void main(){
  vUv = uv; vA = iP.w; vS = iP.z;
  float v = uv.y, u = uv.x - 0.5;
  vec3 A = iDir;
  vec3 side = cross(A, cameraPosition - iPos);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  float bend = sin(uTime * 9.0 + iP.z * 40.0 + v * 5.0) * uBend * v * v * iP.x;
  float w = iP.y * pow(1.0 - v, 1.05) * (0.65 + 0.35 * smoothstep(0.0, 0.3, v));
  vec3 wp = iPos + A * (iP.x * v) + side * (u * 2.0 * w + bend);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FLAME_FRAG = `
uniform float uTime;
varying vec2 vUv; varying float vA; varying float vS;
void main(){
  float v = vUv.y;
  float across = abs(vUv.x - 0.5) * 2.0;
  float lick = sin(v * 11.0 - uTime * 13.0 + vS * 50.0) * 0.5 + 0.5;
  float m = 1.0 - smoothstep(0.5, 1.0, across + 0.18 * lick * v);
  float h = (1.0 - across) * (1.0 - v * 0.85) + 0.12 * lick * (1.0 - v);
  vec3 c = mix(vec3(0.75, 0.07, 0.01), vec3(1.0, 0.5, 0.07), smoothstep(0.08, 0.42, h));
  c = mix(c, vec3(1.0, 0.93, 0.62), smoothstep(0.55, 0.92, h));
  float a = m * smoothstep(0.0, 0.12, v) * (1.0 - pow(v, 1.4)) * vA;
  gl_FragColor = vec4(c * 1.25, a);
}`;

const EMBER_FRAG = `
uniform float uTime;
varying vec2 vUv; varying float vA; varying float vS;
void main(){
  float across = abs(vUv.x - 0.5) * 2.0;
  float a = (1.0 - across * across) * pow(1.0 - vUv.y, 0.7) * vA;
  a *= 0.75 + 0.25 * sin(uTime * 31.0 + vS * 100.0);
  vec3 c = mix(vec3(1.0, 0.4, 0.06), vec3(1.0, 0.86, 0.45), (1.0 - vUv.y) * 0.8);
  gl_FragColor = vec4(c * 1.4, a);
}`;

const SMOKE_VERT = `
attribute vec3 iPos; attribute vec4 iP;
uniform float uTime;
varying vec2 vUv; varying float vA; varying float vS;
void main(){
  vUv = uv; vA = iP.w; vS = iP.y;
  vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float ang = iP.y * 6.283 + uTime * 0.15 * (iP.y - 0.5);
  float c = cos(ang), s = sin(ang);
  vec2 q = (uv - 0.5) * 2.0 * iP.x;
  q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(iPos + r * q.x + u * q.y, 1.0);
}`;

const SMOKE_FRAG = `
uniform float uTime;
varying vec2 vUv; varying float vA; varying float vS;
${NOISE_GLSL}
void main(){
  float d = length(vUv - 0.5) * 2.0;
  float n = vnoise(vUv * 3.0 + vS * 10.0 + uTime * 0.1);
  float a = smoothstep(1.0, 0.15, d + (n - 0.5) * 0.55) * vA;
  vec3 col = mix(vec3(0.085, 0.07, 0.065), vec3(0.3, 0.14, 0.06), (1.0 - vUv.y) * 0.35);
  gl_FragColor = vec4(col, a);
}`;

const FUEL_VERT = `
attribute vec4 aF; // x fuel field, yz field gradient (per metre), w heat field
varying vec3 vW; varying vec4 vF;
void main(){ vW = position; vF = aF; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;

const FUEL_FRAG = `
uniform float uTime; uniform vec3 uLightDir;
varying vec3 vW; varying vec4 vF;
${NOISE_GLSL}
void main(){
  vec2 p = vW.xz;
  float e = vF.x + (fbm(p * 6.0 + 3.1) - 0.5) * 0.3;     // irregular, world-aligned meniscus edge
  float a = smoothstep(0.22, 0.34, e);
  if (a < 0.01) discard;
  vec2 fl = vec2(0.03, 0.018) * uTime;                    // slow flow
  float n1 = fbm(p * 5.0 + fl), n2 = fbm(p * 5.0 + vec2(0.07, 0.0) + fl), n3 = fbm(p * 5.0 + vec2(0.0, 0.07) + fl);
  vec2 ng = vec2(n2 - n1, n3 - n1) * (0.15 / 0.07);
  float rimW = 1.0 - smoothstep(0.3, 0.75, e);
  vec3 N = normalize(vec3(-(vF.y * (0.4 + 1.8 * rimW)) - ng.x, 1.0, -(vF.z * (0.4 + 1.8 * rimW)) - ng.y));
  vec3 V = normalize(cameraPosition - vW);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 col = mix(vec3(0.10, 0.034, 0.008), vec3(0.30, 0.105, 0.02), fbm(p * 2.0 + fl * 3.0));
  vec3 pearl = 0.5 + 0.5 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) + fres * 0.8 + n1 * 0.6));
  col += pearl * vec3(0.55, 0.38, 0.5) * fres * 0.22;
  vec3 H = normalize(normalize(uLightDir) + V);
  col += vec3(1.0, 0.82, 0.55) * pow(max(dot(N, H), 0.0), 70.0) * 0.85;
  col += vec3(0.9, 0.6, 0.35) * fres * 0.3;
  col += vec3(1.0, 0.55, 0.15) * pow(abs(sin((n1 + n2) * 14.0 + uTime * 0.4)), 14.0) * 0.07;   // refractive streaks
  col += vec3(0.55, 0.25, 0.07) * smoothstep(0.34, 0.4, e) * (1.0 - smoothstep(0.4, 0.56, e)) * 0.35; // rim
  float glow = vF.w * (0.4 + 0.6 * fbm(p * 8.0 - vec2(0.0, uTime * 0.8)));
  col += vec3(1.0, 0.33, 0.04) * glow * 0.9;
  gl_FragColor = vec4(col, a * 0.93);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------- shared geometry ----------
function makeTongueBase(cols = 3, rows = 7) {
  const pos = [], uvs = [], idx = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const u = c / (cols - 1), v = r / (rows - 1);
    pos.push(u - 0.5, v, 0); uvs.push(u, v);
  }
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
    idx.push(a, b, d, b, e, d);
  }
  return { pos, uvs, idx };
}
function makeQuadBase() {
  return { pos: [-.5, -.5, 0, .5, -.5, 0, -.5, .5, 0, .5, .5, 0], uvs: [0, 0, 1, 0, 0, 1, 1, 1], idx: [0, 1, 2, 1, 3, 2] };
}
function instGeo(base, buf, withDir) {
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(base.idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(base.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(base.uvs, 2));
  const dyn = (arr, n) => new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iPos', dyn(buf.pos, 3));
  if (withDir) g.setAttribute('iDir', dyn(buf.dir, 3));
  g.setAttribute('iP', dyn(buf.p, 4));
  g.instanceCount = 0;
  return g;
}
function mkMat(vs, fs, uniforms, blending, extra = {}) {
  return new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms, transparent: true, depthWrite: false, blending, ...extra });
}

// =====================================================================================
export function createFirePresentation({ scene, height = () => 0, quality = 1, lightIntensity = 6 } = {}) {
  let q = clamp(quality, 0, 1);
  const group = new THREE.Group(); group.name = 'FirePresentation';
  scene.add(group);
  const uTime = { value: 0 };
  const uLightDir = { value: new THREE.Vector3(0.4, 0.8, 0.3) };

  // ----- instanced layers -----
  const flameBuf = new InstBuf(FLAME_CAP), emberBuf = new InstBuf(EMBER_CAP), smokeBuf = new InstBuf(SMOKE_CAP);
  const tongueBase = makeTongueBase();
  const flameGeo = instGeo(tongueBase, flameBuf, true);
  const emberGeo = instGeo(tongueBase, emberBuf, true);
  const smokeGeo = instGeo(makeQuadBase(), smokeBuf, false);
  const flameMat = mkMat(TONGUE_VERT, FLAME_FRAG, { uTime, uBend: { value: 0.2 } }, THREE.AdditiveBlending);
  const emberMat = mkMat(TONGUE_VERT, EMBER_FRAG, { uTime, uBend: { value: 0 } }, THREE.AdditiveBlending);
  const smokeMat = mkMat(SMOKE_VERT, SMOKE_FRAG, { uTime }, THREE.NormalBlending);
  const layer = (geo, mat, order) => {
    const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = order; m.visible = false;
    m.matrixAutoUpdate = false; group.add(m); return m;
  };
  const flameMesh = layer(flameGeo, flameMat, 12), emberMesh = layer(emberGeo, emberMat, 13), smokeMesh = layer(smokeGeo, smokeMat, 11);

  // ----- fuel surface (grid mesh, rebuilt only on state/terrain change) -----
  const fuelPos = new Float32Array(MAX_FUEL_TILES * VPC * 3), fuelF = new Float32Array(MAX_FUEL_TILES * VPC * 4);
  const fuelIdx = new Uint16Array(MAX_FUEL_TILES * QPC * 6);
  for (let c = 0; c < MAX_FUEL_TILES; c++) {
    let o = c * QPC * 6;
    for (let j = 0; j < SUB; j++) for (let i = 0; i < SUB; i++) {
      const a = c * VPC + j * (SUB + 1) + i, b = a + (SUB + 1), cc = a + 1, d = b + 1;
      fuelIdx[o++] = a; fuelIdx[o++] = b; fuelIdx[o++] = cc; fuelIdx[o++] = cc; fuelIdx[o++] = b; fuelIdx[o++] = d;
    }
  }
  const fuelGeo = new THREE.BufferGeometry();
  fuelGeo.setAttribute('position', new THREE.BufferAttribute(fuelPos, 3).setUsage(THREE.DynamicDrawUsage));
  fuelGeo.setAttribute('aF', new THREE.BufferAttribute(fuelF, 4).setUsage(THREE.DynamicDrawUsage));
  fuelGeo.setIndex(new THREE.BufferAttribute(fuelIdx, 1));
  fuelGeo.setDrawRange(0, 0);
  const fuelMat = new THREE.ShaderMaterial({
    vertexShader: FUEL_VERT, fragmentShader: FUEL_FRAG, uniforms: { uTime, uLightDir },
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const fuelMesh = new THREE.Mesh(fuelGeo, fuelMat);
  fuelMesh.frustumCulled = false; fuelMesh.renderOrder = 10; fuelMesh.visible = false; fuelMesh.matrixAutoUpdate = false;
  group.add(fuelMesh);

  // cell state (struct-of-arrays)
  const cIx = new Int32Array(MAX_CELLS), cIz = new Int32Array(MAX_CELLS), cY = new Float32Array(MAX_CELLS);
  const cFuel = new Float32Array(MAX_CELLS), cHeat = new Float32Array(MAX_CELLS), cBurn = new Uint8Array(MAX_CELLS);
  const cTongues = new Uint8Array(MAX_CELLS), cEmber = new Uint8Array(MAX_CELLS), cSmoke = new Uint8Array(MAX_CELLS);
  const cMap = new Map();
  let cellCount = 0, sigA = 0, sigB = 0, terrainVersion = 0, builtTerrainVersion = -1, fuelRebuilds = 0, fuelTiles = 0, burningCount = 0;

  const fuelAt = (ix, iz) => { const s = cMap.get(cellKey(ix, iz)); return s === undefined ? 0 : cFuel[s]; };
  const heatAt = (ix, iz) => { const s = cMap.get(cellKey(ix, iz)); return s === undefined || !cBurn[s] ? 0 : cHeat[s]; };
  function field(fn, x, z) {
    const gx = x / CELL, gz = z / CELL, i0 = Math.floor(gx), j0 = Math.floor(gz), u = gx - i0, v = gz - j0;
    return (fn(i0, j0) * (1 - u) + fn(i0 + 1, j0) * u) * (1 - v) + (fn(i0, j0 + 1) * (1 - u) + fn(i0 + 1, j0 + 1) * u) * v;
  }
  function rebuildFuel() {
    fuelRebuilds++;
    const step = CELL / SUB, g = 0.06;
    let nv = 0;
    // Field samples live at tile centres. Include the neighbouring empty tiles
    // so interpolation reaches zero before the mesh ends, rather than clipping
    // every puddle to the edges of its non-empty simulation cells.
    const tiles = new Map();
    for(let s=0;s<cellCount;s++)for(const [dx,dz] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){
      const ix=cIx[s]+dx,iz=cIz[s]+dz;tiles.set(cellKey(ix,iz),[ix,iz]);
    }
    fuelTiles=tiles.size;
    for (const [ix,iz] of tiles.values()) {
      const x0 = ix * CELL - CELL / 2, z0 = iz * CELL - CELL / 2;
      for (let j = 0; j <= SUB; j++) for (let i = 0; i <= SUB; i++, nv++) {
        const x = x0 + i * step, z = z0 + j * step;
        const f = field(fuelAt, x, z);
        const lift = 0.03 + 0.012 * clamp((f - 0.2) / 0.6, 0, 1);
        fuelPos[nv * 3] = x; fuelPos[nv * 3 + 1] = height(x, z) + lift; fuelPos[nv * 3 + 2] = z;
        fuelF[nv * 4] = f;
        fuelF[nv * 4 + 1] = (field(fuelAt, x + g, z) - field(fuelAt, x - g, z)) / (2 * g);
        fuelF[nv * 4 + 2] = (field(fuelAt, x, z + g) - field(fuelAt, x, z - g)) / (2 * g);
        fuelF[nv * 4 + 3] = field(heatAt, x, z);
      }
    }
    fuelGeo.attributes.position.needsUpdate = true; fuelGeo.attributes.aF.needsUpdate = true;
    fuelGeo.setDrawRange(0, fuelTiles * QPC * 6);
    fuelMesh.visible = cellCount > 0;
    builtTerrainVersion = terrainVersion;
  }
  function syncCells(list) {
    const n = Math.min(list ? list.length : 0, MAX_CELLS);
    let a = n, b = 0;
    for (let i = 0; i < n; i++) {
      const c = list[i];
      const ix = Math.round(c.x / CELL), iz = Math.round(c.z / CELL);
      const qf = Math.round(clamp(c.fuel, 0, 1) * 32), qh = Math.round(clamp(c.heat, 0, 1) * 16), bn = c.burning ? 1 : 0;
      const s = hash32(ix ^ Math.imul(iz, 0x9e3779b1) ^ Math.imul(qf | qh << 6 | bn << 12, 0x85ebca6b));
      a = (a + s) | 0; b ^= hash32(s + 1);
    }
    if (a === sigA && b === sigB && builtTerrainVersion === terrainVersion) return;
    sigA = a; sigB = b;
    cMap.clear(); cellCount = 0; burningCount = 0;
    for (let i = 0; i < n; i++) {
      const c = list[i];
      if (!(c.fuel > 0.02) && !(c.burning && c.heat > 0)) continue;
      const s = cellCount++;
      cIx[s] = Math.round(c.x / CELL); cIz[s] = Math.round(c.z / CELL);
      cY[s] = height(cIx[s] * CELL, cIz[s] * CELL);
      cFuel[s] = clamp(c.fuel, 0, 1); cHeat[s] = clamp(c.heat, 0, 1); cBurn[s] = c.burning ? 1 : 0;
      cMap.set(cellKey(cIx[s], cIz[s]), s);
      if (cBurn[s] && cHeat[s] > 0.02) burningCount++;
    }
    // stable per-cell effect budgets (hash rank, so subsets do not shuffle)
    const nb = Math.max(1, burningCount);
    const kpc = nb <= 64 ? 3 : nb <= 96 ? 2 : 1;
    const fT = Math.min(1, (192 * q) / (nb * kpc)), fE = Math.min(1, (64 * q) / nb), fS = Math.min(1, (96 * q) / nb);
    for (let s = 0; s < cellCount; s++) {
      const on = cBurn[s] && cHeat[s] > 0.02, r = hash01(cIx[s] * 7919 + cIz[s] * 104729);
      cTongues[s] = on && r < fT ? kpc : 0; cEmber[s] = on && r < fE ? 1 : 0; cSmoke[s] = on && cHeat[s] > 0.25 && r < fS ? 1 : 0;
    }
    rebuildFuel();
    buildCellLightCands();
  }

  // ----- packets -----
  const pk = [];
  for (let i = 0; i < MAX_PACKETS; i++) pk.push({ used: false, id: null, seed: 0, s01: 0, bx: 0, by: 0, bz: 0, vx: 0, vy: 0, vz: 0, stamp: 0, x: 0, y: 0, z: 0, a: 0, dying: false, seen: false });
  const pkMap = new Map();
  // ----- surface patches -----
  const sp = [];
  for (let i = 0; i < MAX_PATCHES; i++) sp.push({ used: false, id: null, seed: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, exp: 0, a: 0, dying: false, seen: false });
  const spMap = new Map();
  let lastNow = 0, stampNow = 0, snapTick = 0, haveTick = false;

  // ----- lights -----
  const lights = [];
  for (let i = 0; i < MAX_LIGHTS; i++) {
    const l = new THREE.PointLight(0xff8f45, 0, 4, 2); l.castShadow = false; l.name = 'FireLight' + i; group.add(l);
    lights.push({ l, key: -1, score: 0, tx: 0, ty: 0, tz: 0, ti: 0, td: 4, on: false });
  }
  const cand = { n: 0, key: new Float64Array(MAX_CANDS), score: new Float32Array(MAX_CANDS), x: new Float32Array(MAX_CANDS), y: new Float32Array(MAX_CANDS), z: new Float32Array(MAX_CANDS), used: new Uint8Array(MAX_CANDS), w: new Float32Array(MAX_CANDS), sx: new Float32Array(MAX_CANDS), sy: new Float32Array(MAX_CANDS), sz: new Float32Array(MAX_CANDS) };
  const bucketMap = new Map();
  const bk = (x, z, kind) => (((Math.floor(x / BUCKET) & 0x7fff) * 32768 + (Math.floor(z / BUCKET) & 0x7fff)) * 2 + kind);
  function addCand(key, x, y, z, w) {
    let i = bucketMap.get(key);
    if (i === undefined) {
      if (cand.n >= MAX_CANDS) return;
      i = cand.n++; bucketMap.set(key, i); cand.key[i] = key; cand.w[i] = 0; cand.sx[i] = cand.sy[i] = cand.sz[i] = 0;
    }
    cand.w[i] += w; cand.sx[i] += x * w; cand.sy[i] += y * w; cand.sz[i] += z * w;
  }
  function buildCellLightCands() { /* cell candidates are folded in by refreshLights() */ }
  function refreshLights() {
    cand.n = 0; bucketMap.clear();
    for (let i = 0; i < MAX_PACKETS; i++) { const p = pk[i]; if (p.used && !p.dying) addCand(bk(p.bx, p.bz, 0), p.bx, p.by + 0.1, p.bz, 1); }
    for (let s = 0; s < cellCount; s++) if (cBurn[s] && cHeat[s] > 0.05) {
      const x = cIx[s] * CELL, z = cIz[s] * CELL;
      addCand(bk(x, z, 1), x, cY[s] + 0.3, z, 0.25 + cHeat[s] * 0.75);
    }
    for (let i = 0; i < cand.n; i++) {
      const w = cand.w[i], kind = cand.key[i] % 2;
      cand.x[i] = cand.sx[i] / w; cand.y[i] = cand.sy[i] / w; cand.z[i] = cand.sz[i] / w; cand.used[i] = 0;
      cand.score[i] = kind === 0 ? Math.min(2, 0.6 + 0.25 * w) : Math.min(1.4, 0.3 + 0.12 * w);
    }
    // 1: keep same-key assignments
    const asg = [-1, -1, -1];
    for (let k = 0; k < MAX_LIGHTS; k++) {
      const L = lights[k]; if (L.key < 0) continue;
      const i = bucketMap.get(L.key);
      if (i !== undefined && !cand.used[i]) { asg[k] = i; cand.used[i] = 1; }
    }
    // 2: continuity (nearest within 2.5 m) then best score
    for (let k = 0; k < MAX_LIGHTS; k++) {
      if (asg[k] >= 0) continue;
      const L = lights[k]; let best = -1, bd = 6.25;
      if (L.on) for (let i = 0; i < cand.n; i++) if (!cand.used[i]) {
        const d = (cand.x[i] - L.tx) ** 2 + (cand.y[i] - L.ty) ** 2 + (cand.z[i] - L.tz) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      if (best < 0) { let bs = 0; for (let i = 0; i < cand.n; i++) if (!cand.used[i] && cand.score[i] > bs) { bs = cand.score[i]; best = i; } }
      if (best >= 0) { asg[k] = best; cand.used[best] = 1; }
    }
    // 3: hysteresis swap (one per refresh): replace a clearly weaker assignment
    let bu = -1, bsu = 0;
    for (let i = 0; i < cand.n; i++) if (!cand.used[i] && cand.score[i] > bsu) { bsu = cand.score[i]; bu = i; }
    if (bu >= 0) {
      let wk = -1, ws = 1e9;
      for (let k = 0; k < MAX_LIGHTS; k++) if (asg[k] >= 0 && cand.score[asg[k]] < ws) { ws = cand.score[asg[k]]; wk = k; }
      if (wk >= 0 && bsu > ws * 1.6) { cand.used[asg[wk]] = 0; asg[wk] = bu; cand.used[bu] = 1; }
    }
    for (let k = 0; k < MAX_LIGHTS; k++) {
      const L = lights[k], i = asg[k];
      if (i < 0) { L.key = -1; L.ti = 0; continue; }
      if (!L.on || L.key < 0) { L.l.position.set(cand.x[i], cand.y[i], cand.z[i]); }
      L.key = cand.key[i]; L.score = cand.score[i];
      L.tx = cand.x[i]; L.ty = cand.y[i]; L.tz = cand.z[i];
      L.ti = lightIntensity * q * clamp(0.45 + 0.4 * cand.score[i], 0.45, 1);
      L.td = 3 + 2 * clamp((cand.score[i] - 0.3) / 1.2, 0, 1);
    }
  }

  // ----- sync -----
  function sync(snap) {
    if (!snap) return;
    stampNow = lastNow;
    if (typeof snap.tick === 'number') { snapTick = snap.tick; haveTick = true; }
    // packets
    for (let i = 0; i < MAX_PACKETS; i++) pk[i].seen = false;
    const list = snap.projectiles;
    if (list) for (let i = 0, n = Math.min(list.length, MAX_PACKETS * 2); i < n; i++) {
      const s = list[i];
      if (s.kind !== undefined && s.kind !== 'flame') continue;
      let p = pkMap.get(s.id);
      if (!p) {
        for (let k = 0; k < MAX_PACKETS; k++) if (!pk[k].used) { p = pk[k]; break; }
        if (!p) continue;
        p.used = true; p.id = s.id; p.seed = idSeed(s.id); p.s01 = hash01(p.seed); p.x = s.position[0]; p.y = s.position[1]; p.z = s.position[2]; p.a = 0;
        pkMap.set(s.id, p);
      }
      p.seen = true; p.dying = false; p.stamp = stampNow;
      p.bx = s.position[0]; p.by = s.position[1]; p.bz = s.position[2];
      const v = s.velocity || [0, 0, 0]; p.vx = v[0]; p.vy = v[1]; p.vz = v[2];
    }
    for (let i = 0; i < MAX_PACKETS; i++) { const p = pk[i]; if (p.used && !p.seen) p.dying = true; }
    // surface patches
    for (let i = 0; i < MAX_PATCHES; i++) sp[i].seen = false;
    const fs = snap.fireSurfaces;
    if (fs) for (let i = 0, n = Math.min(fs.length, MAX_PATCHES * 2); i < n; i++) {
      const s = fs[i];
      let p = spMap.get(s.id);
      if (!p) {
        for (let k = 0; k < MAX_PATCHES; k++) if (!sp[k].used) { p = sp[k]; break; }
        if (!p) continue;
        p.used = true; p.id = s.id; p.seed = idSeed(s.id); p.a = 0; spMap.set(s.id, p);
      }
      p.seen = true; p.dying = false;
      p.x = s.position[0]; p.y = s.position[1]; p.z = s.position[2];
      const nl = Math.hypot(s.normal[0], s.normal[1], s.normal[2]) || 1;
      p.nx = s.normal[0] / nl; p.ny = s.normal[1] / nl; p.nz = s.normal[2] / nl; p.exp = s.expiresTick;
    }
    for (let i = 0; i < MAX_PATCHES; i++) { const p = sp[i]; if (p.used && !p.seen) p.dying = true; }
    syncCells(snap.fireCells);
    refreshLights();
  }

  // ----- per-frame update -----
  let nTongue = 0;
  function update(nowMs, dt) {
    lastNow = nowMs; const t = nowMs * 0.001; uTime.value = t;
    dt = clamp(dt || 0, 0, 0.1);
    flameBuf.n = emberBuf.n = smokeBuf.n = 0;
    const kSmooth = 1 - Math.exp(-dt * 30), emit = q > 0;
    const tongues = q >= 0.75 ? 2 : 1;
    const curTick = snapTick + (nowMs - stampNow) * 0.06;

    // packets
    for (let i = 0; i < MAX_PACKETS; i++) {
      const p = pk[i]; if (!p.used) continue;
      const age = clamp((nowMs - p.stamp) * 0.001, 0, EXTRAP_MAX);
      p.x += (p.bx + p.vx * age - p.x) * kSmooth; p.y += (p.by + p.vy * age - p.y) * kSmooth; p.z += (p.bz + p.vz * age - p.z) * kSmooth;
      p.a = p.dying ? p.a - dt / 0.18 : Math.min(1, p.a + dt / 0.05);
      if (p.a <= 0 && p.dying) { p.used = false; pkMap.delete(p.id); continue; }
      if (!emit) continue;
      const a = clamp(p.a, 0, 1), sp2 = Math.hypot(p.vx, p.vy, p.vz), inv = sp2 > 0.05 ? 1 / sp2 : 0;
      const tx = inv ? -p.vx * inv : 0, ty = inv ? -p.vy * inv + 0.25 : 1, tz = inv ? -p.vz * inv : 0;
      const spd = 0.6 + 0.4 * Math.min(1, sp2 / 8);
      for (let k = 0; k < tongues; k++) {
        const s = p.seed + k * 977, ph = hash01(s) * 6.283, wob = Math.sin(t * 17 + ph);
        flameBuf.push(p.x, p.y, p.z,
          tx + Math.sin(t * 13 + ph) * 0.22, ty + wob * 0.1, tz + Math.cos(t * 11 + ph * 1.3) * 0.22,
          (0.3 + 0.1 * k) * (0.8 + 0.2 * wob) * spd, 0.14 - 0.04 * k, hash01(s + 5), a * (k ? 0.7 : 1));
      }
      if (q > 0.5) {
        const ea = fract(t * 3.1 + p.s01), r1 = hash01(p.seed + 11) - 0.5, r2 = hash01(p.seed + 12) - 0.5;
        const ex = -p.vx * ea * 0.3 + r1 * ea * 0.4, ey = ea * 0.4 - 0.9 * ea * ea, ez = -p.vz * ea * 0.3 + r2 * ea * 0.4;
        emberBuf.push(p.x + ex, p.y - p.vy * ea * 0.3 + ey, p.z + ez, ex + 1e-3, ey, ez + 1e-3, 0.05, 0.016, p.s01, a * Math.pow(1 - ea, 1.5));
      }
    }

    // surface patches (tongues rise from the real normal)
    for (let i = 0; i < MAX_PATCHES; i++) {
      const p = sp[i]; if (!p.used) continue;
      const rem = haveTick ? (p.exp - curTick) / 60 : 1;
      const target = p.dying || rem <= 0 ? 0 : Math.min(1, rem / 0.5);
      p.a += clamp(target - p.a, -dt / 0.25, dt / 0.08);
      if (p.a <= 0.002 && target === 0) { p.used = false; spMap.delete(p.id); continue; }
      if (!emit) continue;
      const lw = 1 - Math.max(p.ny, 0), dx0 = p.nx, dy0 = p.ny + lw * 0.8, dz0 = p.nz;
      let t1x = p.ny * p.ny > 0.98 ? 1 : -p.nz, t1y = 0, t1z = p.ny * p.ny > 0.98 ? 0 : p.nx;
      const tl = Math.hypot(t1x, t1z) || 1; t1x /= tl; t1z /= tl;
      const t2x = p.ny * t1z - p.nz * t1y, t2y = p.nz * t1x - p.nx * t1z, t2z = p.nx * t1y - p.ny * t1x;
      for (let k = 0; k < tongues; k++) {
        const s = p.seed + k * 331, h1 = hash01(s) - 0.5, h2 = hash01(s + 1) - 0.5, ph = hash01(s + 2) * 6.283;
        const per = 0.5 + 0.4 * hash01(s + 3), cyc = t / per + hash01(s + 4), pr = Math.pow(Math.sin(Math.PI * fract(cyc)), 0.7);
        const o1 = (h1 + (hash01(s + 5 + Math.floor(cyc) * 17) - 0.5) * 0.5) * 0.35, o2 = (h2 + (hash01(s + 6 + Math.floor(cyc) * 17) - 0.5) * 0.5) * 0.35;
        flameBuf.push(p.x + p.nx * 0.012 + t1x * o1 + t2x * o2, p.y + p.ny * 0.012 + t1y * o1 + t2y * o2, p.z + p.nz * 0.012 + t1z * o1 + t2z * o2,
          dx0 + Math.sin(t * 5 + ph) * 0.25, dy0 + Math.sin(t * 7 + ph) * 0.1, dz0 + Math.cos(t * 4.3 + ph) * 0.25,
          (0.26 + 0.2 * hash01(s + 7)) * (0.35 + 0.65 * pr), 0.12 + 0.05 * hash01(s + 8), hash01(s + 9), p.a * (0.4 + 0.6 * pr));
      }
      if (q > 0.5) {
        const s = p.seed + 4242, ea = fract(t * 0.8 + hash01(s));
        emberBuf.push(p.x + p.nx * (0.05 + ea * 0.6) + (hash01(s + 1) - 0.5) * 0.3 * ea, p.y + p.ny * (0.05 + ea * 0.6) + ea * 0.4, p.z + p.nz * (0.05 + ea * 0.6) + (hash01(s + 2) - 0.5) * 0.3 * ea,
          p.nx * 0.3, p.ny * 0.3 + 0.5, p.nz * 0.3, 0.05, 0.015, hash01(s + 3), p.a * Math.pow(1 - ea, 1.3));
      }
      if (q > 0.25) {
        const s = p.seed + 777, sa = fract(t * 0.4 + hash01(s));
        smokeBuf.push(p.x + p.nx * 0.2 + 0.1 * sa, p.y + p.ny * 0.2 + 0.2 + sa * 0.9, p.z + p.nz * 0.2 + 0.08 * sa, 0, 1, 0, 0.1 + 0.3 * sa, 0, hash01(s), Math.sin(Math.PI * sa) * 0.16 * p.a);
      }
    }

    // burning cells
    if (emit) for (let s = 0; s < cellCount; s++) {
      const heat = cHeat[s], cx = cIx[s] * CELL, cz = cIz[s] * CELL, y = cY[s] + 0.03, key = cIx[s] * 7919 + cIz[s] * 104729;
      for (let k = 0; k < cTongues[s]; k++) {
        const sd = hash32(key + k * 83492791), per = 0.45 + 0.5 * hash01(sd), cyc = t / per + hash01(sd + 1), ph = fract(cyc);
        const pr = Math.pow(Math.sin(Math.PI * ph), 0.8), cn = Math.floor(cyc) * 131;
        flameBuf.push(cx + (hash01(sd + 2 + cn) - 0.5) * 0.42, y, cz + (hash01(sd + 3 + cn) - 0.5) * 0.42,
          Math.sin(t * 2 + hash01(sd + 4) * 6.28) * 0.28 + 0.06, 1, Math.cos(t * 1.7 + hash01(sd + 5) * 6.28) * 0.28,
          (0.2 + 0.5 * heat) * pr, 0.1 + 0.1 * heat, hash01(sd + 6), (0.45 + 0.55 * heat) * (0.3 + 0.7 * pr));
      }
      if (cEmber[s] && q > 0.5) {
        const sd = hash32(key + 5), age = fract(t * 0.9 + hash01(sd)), vx = (hash01(sd + 1) - 0.5) * 0.4, vy = 0.5 + 0.6 * heat, vz = (hash01(sd + 2) - 0.5) * 0.4;
        emberBuf.push(cx + vx * age + Math.sin(t * 3 + age * 6) * 0.04, y + vy * age, cz + vz * age, vx, vy, vz, 0.05, 0.015, hash01(sd + 3), heat * Math.pow(1 - age, 1.2));
      }
      if (cSmoke[s] && q > 0.25) {
        const sd = hash32(key + 9), age = fract(t * 0.35 + hash01(sd));
        smokeBuf.push(cx + 0.15 * age + Math.sin(t * 0.7 + hash01(sd + 1) * 6) * 0.08, y + 0.3 + age * 1.1, cz + 0.08 * age, 0, 1, 0, 0.12 + 0.4 * age, 0, hash01(sd + 2), Math.sin(Math.PI * age) * 0.2 * Math.min(1, heat + 0.3));
      }
    }

    commit(flameMesh, flameGeo, flameBuf, true); commit(emberMesh, emberGeo, emberBuf, true); commit(smokeMesh, smokeGeo, smokeBuf, false);
    nTongue = flameBuf.n;

    // lights: smooth towards stable targets
    const kp = 1 - Math.exp(-dt * 9), ki = 1 - Math.exp(-dt * 7);
    for (let k = 0; k < MAX_LIGHTS; k++) {
      const L = lights[k], l = L.l;
      const fl = 0.9 + 0.1 * Math.sin(t * 19 + k * 2.1) * Math.sin(t * 7.3 + k);
      const ti = q > 0 ? L.ti * fl : 0;
      l.position.x += (L.tx - l.position.x) * kp; l.position.y += (L.ty - l.position.y) * kp; l.position.z += (L.tz - l.position.z) * kp;
      l.intensity += (ti - l.intensity) * ki; l.distance += (L.td - l.distance) * ki;
      if (l.intensity < 0.01) { l.intensity = 0; L.on = false; } else L.on = true;
      l.visible = l.intensity > 0;
    }
  }
  function commit(mesh, geo, buf, withDir) {
    geo.instanceCount = buf.n; mesh.visible = buf.n > 0;
    if (!buf.n) return;
    geo.attributes.iPos.needsUpdate = true; geo.attributes.iP.needsUpdate = true;
    if (withDir) geo.attributes.iDir.needsUpdate = true;
  }

  function stats() {
    let active = 0; for (const L of lights) if (L.l.intensity > 0) active++;
    let packets = 0, patches = 0; for (const p of pk) if (p.used) packets++; for (const p of sp) if (p.used) patches++;
    const instances = flameBuf.n + emberBuf.n + smokeBuf.n;
    return {
      quality: q, draws: (flameMesh.visible ? 1 : 0) + (emberMesh.visible ? 1 : 0) + (smokeMesh.visible ? 1 : 0) + (fuelMesh.visible ? 1 : 0), maxDraws: 4,
      instances, instanceCap: FLAME_CAP + EMBER_CAP + SMOKE_CAP,
      flame: flameBuf.n, flameCap: FLAME_CAP, ember: emberBuf.n, emberCap: EMBER_CAP, smoke: smokeBuf.n, smokeCap: SMOKE_CAP,
      packets, packetCap: MAX_PACKETS, patches, patchCap: MAX_PATCHES, cells: cellCount, cellCap: MAX_CELLS, burningCells: burningCount,
      fuelRebuilds, fuelTriangles: fuelTiles * QPC * 2, lights: MAX_LIGHTS, lightsActive: active, lightIntensityScale: lightIntensity,
    };
  }
  function dispose() {
    scene.remove(group);
    for (const L of lights) { group.remove(L.l); L.l.dispose && L.l.dispose(); }
    for (const g of [flameGeo, emberGeo, smokeGeo, fuelGeo]) g.dispose();
    for (const m of [flameMat, emberMat, smokeMat, fuelMat]) m.dispose();
    pkMap.clear(); spMap.clear(); cMap.clear(); bucketMap.clear();
  }
  return {
    sync, update, stats, dispose,
    /** Call when ground height changes under existing fuel cells. */
    invalidateTerrain() { terrainVersion++; },
    setQuality(v) { q = clamp(v, 0, 1); sigA = sigB = 0x7fffffff; },
    group,
  };
}

// =====================================================================================
/** Ember Dew supply bottle. ~0.18 m tall, origin at bottle middle (grip), +Y up, -Z forward. */
export function createEmberdewModel() {
  const g = new THREE.Group(); g.name = 'Emberdew';
  const geos = [], mats = [];
  const G = (x) => (geos.push(x), x), M = (x) => (mats.push(x), x);
  const seg = 20;
  const glassProfile = [[0, -0.09], [0.020, -0.089], [0.034, -0.078], [0.041, -0.056], [0.041, -0.03], [0.037, -0.006], [0.030, 0.016], [0.021, 0.036], [0.0165, 0.050], [0.0165, 0.064], [0.0205, 0.068], [0.0205, 0.074]];
  const lathe = (pts, s = seg) => G(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), s));

  const glassMat = M(new THREE.MeshPhysicalMaterial({ color: 0xffe2b0, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.28, clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false }));
  const liquidMat = M(new THREE.MeshPhysicalMaterial({ color: 0x7a3208, roughness: 0.25, metalness: 0.1, emissive: 0xff5a10, emissiveIntensity: 0.28, clearcoat: 0.8, iridescence: 0.35, sheen: 0.5, sheenColor: new THREE.Color(0xffb070) }));
  const leatherMat = M(new THREE.MeshStandardMaterial({ color: 0x4a2a17, roughness: 0.85, metalness: 0 }));
  const copperMat = M(new THREE.MeshStandardMaterial({ color: 0xb8602e, roughness: 0.38, metalness: 0.9 }));
  const wickMat = M(new THREE.MeshStandardMaterial({ color: 0xd9c9a0, roughness: 0.95, emissive: 0x401400, emissiveIntensity: 0.4 }));

  // amber liquid (inset glass profile, fill to just below the neck)
  const liq = [[0, -0.086], [0.018, -0.085], [0.031, -0.075], [0.038, -0.056], [0.038, -0.03], [0.034, -0.006], [0.027, 0.014], [0.019, 0.030], [0, 0.031]];
  const liquid = new THREE.Mesh(lathe(liq), liquidMat); liquid.name = 'Liquid'; g.add(liquid);
  const glass = new THREE.Mesh(lathe(glassProfile), glassMat); glass.name = 'Glass'; glass.renderOrder = 2; g.add(glass);

  // leather grip wrap around the waist
  const wrap = new THREE.Mesh(lathe([[0.0405, -0.052], [0.0445, -0.048], [0.0445, -0.012], [0.0405, -0.008]], seg), leatherMat); wrap.name = 'GripWrap'; g.add(wrap);
  // copper foot band and neck collar
  const foot = new THREE.Mesh(G(new THREE.TorusGeometry(0.0285, 0.0042, 6, seg)), copperMat); foot.name = 'FootBand'; foot.rotation.x = Math.PI / 2; foot.position.y = -0.081; g.add(foot);
  const collar = new THREE.Mesh(G(new THREE.TorusGeometry(0.0195, 0.0035, 6, seg)), copperMat); collar.name = 'NeckCollar'; collar.rotation.x = Math.PI / 2; collar.position.y = 0.058; g.add(collar);
  // leather stopper (tapered plug with bulb cap)
  const stopper = new THREE.Mesh(lathe([[0, 0.063], [0.0145, 0.063], [0.0175, 0.07], [0.0215, 0.074], [0.0225, 0.082], [0.016, 0.0865], [0, 0.088]], 16), leatherMat); stopper.name = 'Stopper'; g.add(stopper);
  // wick: short twisted cord, slightly canted
  const wick = new THREE.Mesh(G(new THREE.CylinderGeometry(0.0022, 0.0028, 0.016, 6)), wickMat); wick.name = 'Wick'; wick.position.set(0, 0.095, 0); wick.rotation.z = 0.12; g.add(wick);

  // pour mouth marker: front of the neck (-Z), where fuel leaves when tilted
  const muzzle = new THREE.Object3D(); muzzle.name = 'Muzzle'; muzzle.position.set(0, 0.066, -0.017); g.add(muzzle);

  let tris = 0, draws = 0;
  g.traverse((o) => { if (o.isMesh) { draws++; const gg = o.geometry; tris += (gg.index ? gg.index.count : gg.attributes.position.count) / 3; } });
  g.userData.stats = { triangles: tris, draws, heightMeters: 0.18 };
  g.userData.dispose = () => { geos.forEach((x) => x.dispose()); mats.forEach((x) => x.dispose()); };
  return g;
}
