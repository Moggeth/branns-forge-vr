// Spell targeting: in-world, terrain-conforming previews of all 16 spatial spells.
// Y-up metres. Self-contained ES module (only depends on 'three'); no DOM, no lights,
// no textures. Three pooled draws at most (packed glyph ribbons, translucent topo
// surface, motes); every buffer is preallocated once and rewritten in place.
//
// createSpellTargeting({scene,height,quality,reducedMotion}) ->
//   {root,setTarget,update,configure,stats,dispose,prepareShaders}
// setTarget({spell,point,start,end,radius?,valid,trees?}) | null. Vectors: [x,y,z] or {x,y,z}.
// trees: ent spells only, [{x,z,height}] of the exact trees the authority would wake (ringed and lit).
// The footprint is rebuilt synchronously at the EXACT target; only fade/glow animate.
import * as THREE from 'three';
import {SPELL_TARGET_SHAPES} from '../shared/spells.js';
import {triangleHeight,wallProfile,chasmProfile,wallSpec,earthLineSegments} from '../shared/terrain.js';
import {planEarthLine} from '../shared/earth-spells.js';

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smooth = (t) => t * t * (3 - 2 * t);
const lp = (a, b, t) => a + (b - a) * t;

// ---------- shared gameplay contract (mirrors shared/simulation.js + brief) ----------
export const SPELL_SHAPES = SPELL_TARGET_SHAPES;
export const DEFORM_CAP = 6, FALLBACK_LINE = 6;
/** Segment centres exactly as the authority places Raise Wall / Sunder segments (shared/earth-spells.js). */
export function lineKernels(ax, az, bx, bz, fallback = false) {
  const n = earthLineSegments(fallback ? FALLBACK_LINE : Math.hypot(bx - ax, bz - az)), out = [];
  for (let i = 0; i < n; i++) out.push([lp(ax, bx, (i + 0.5) / n), lp(az, bz, (i + 0.5) / n)]);
  return out;
}

const PAL = { bone: 0xf4ead0, purple: 0xa77bff, violet: 0x6a3fd0, gold: 0xffcc5a, amber: 0xff9a35, stone: 0xc9c2b4, slate: 0x8c8794,
  ember: 0xff5a24, leaf: 0x86e46b, moss: 0x3fae5a, bark: 0xb88a52, teal: 0x45e6d0, mint: 0xa4ffd6, water: 0x6fd2ff, ice: 0xdaf6ff,
  frost: 0x9fe4ff, bolt: 0xe4f2ff, astral: 0xfff1b8, star: 0xffd36e, crystal: 0x7af0ff, amethyst: 0xc58bff, white: 0xffffff };

// Quality: ribbon segment cap, surface grid, motes, density spacing, secondary motifs.
const QUALITY = { high: { seg: 4800, grid: 30, motes: 64, sp: 0.28, fine: true }, medium: { seg: 3300, grid: 20, motes: 32, sp: 0.36, fine: true },
  low: { seg: 2200, grid: 10, motes: 0, sp: 0.5, fine: false } };
// Stroke widths are authored in metres then scaled for sunlit mobile/VR legibility.
const GROUND_W = 1.7, AIR_W = 1.5;
const MAX_PTS = 6000, MAX_IDX = QUALITY.high.seg * 6, MAX_GRID = 30, MAX_MOTES = 64, STRAND_PTS = 200;

// ---------- shaders ----------
const LINE_VS = `attribute vec4 aux;attribute vec4 fx;attribute vec3 tng;attribute vec3 col;
varying vec4 vAux;varying vec4 vFx;varying vec3 vCol;
void main(){vAux=aux;vFx=fx;vCol=col;vec4 mv=modelViewMatrix*vec4(position,1.);
if(aux.z>0.){vec3 tv=(modelViewMatrix*vec4(tng,0.)).xyz;vec3 n=cross(tv,normalize(mv.xyz));float l=length(n);
if(l>1e-5)mv.xyz+=n/l*aux.y*aux.z;}
gl_Position=projectionMatrix*mv;}`;
const LINE_FS = `uniform float uT,uInv,uFade,uMo;varying vec4 vAux;varying vec4 vFx;varying vec3 vCol;
void main(){float e=abs(vAux.y),s=vAux.x;
float vm=vFx.x<.5?1.:vFx.x<1.5?1.-uInv:uInv;
float g=1.;if(vFx.z>0.){float d=fract(s*vFx.z-uT*vFx.y*.35);g=smoothstep(0.,.06,d)*(1.-smoothstep(.52,.6,d));}
g*=mix(1.,smoothstep(.26,.34,fract(s*.85+.17)),uInv);
float p=1.+.28*sin(s*1.6-uT*vFx.y*3.);
if(vFx.w>0.){float u=s/vFx.w,f=fract(uT*.42);p+=uMo*1.3*exp(-pow((u-f)*5.,2.));}
vec3 c=mix(vCol,vec3(1.,.24,.2)*(.65+.35*dot(vCol,vec3(.3,.59,.11))),uInv);
vec3 o=mix(c*.3,c*min(p,2.2),1.-smoothstep(.62,.86,e));
float a=min(1.,vAux.w*1.1)*uFade*(1.-smoothstep(.86,1.,e))*g*vm;if(a<.01)discard;gl_FragColor=vec4(o,a);}`;
const SURF_VS = `attribute vec2 hv;varying vec2 vH;void main(){vH=hv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const SURF_FS = `uniform vec3 uC;uniform float uInv,uFade,uT,uBand;varying vec2 vH;
void main(){float q=abs(vH.x)/uBand;float d=min(fract(q),1.-fract(q));float ln=(1.-smoothstep(0.,fwidth(q)*1.4,d))*step(.12,q);
float sw=.5+.5*sin(q*3.-uT*2.);vec3 c=mix(uC,vec3(1.,.25,.2),uInv);
float a=uFade*vH.y*(.06+.05*sw+.5*ln);if(a<.01)discard;gl_FragColor=vec4(c*(1.+.6*ln),a);}`;
const MOTE_VS = `attribute vec3 seed;uniform float uT,uRise,uScale;varying float vA;
void main(){float k=fract(seed.x+uT*seed.y);vec3 p=position;p.y+=uRise>0.?k*uRise:(1.-k)*(-uRise);
vA=sin(k*3.14159);vec4 mv=modelViewMatrix*vec4(p,1.);gl_PointSize=min(64.,seed.z*uScale/max(.2,-mv.z));gl_Position=projectionMatrix*mv;}`;
const MOTE_FS = `uniform vec3 uC;uniform float uFade,uInv;varying float vA;
void main(){vec2 d=gl_PointCoord-.5;float a=(1.-smoothstep(.1,.5,length(d)))*vA*uFade*.85;if(a<.01)discard;gl_FragColor=vec4(mix(uC,vec3(1.,.3,.25),uInv),a);}`;

// ---------- 2D shape vocabulary (local metres) ----------
const circ = (r, n = 64, a0 = 0, a1 = TAU, cx = 0, cz = 0) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]; });
const poly = (k, r, rot = 0, cx = 0, cz = 0) => circ(r, k, rot, rot + TAU, cx, cz);
const wave = (r, k, amp, rot = 0, n = 160) => Array.from({ length: n + 1 }, (_, i) => { const a = (TAU * i) / n, q = r + amp * Math.sin(a * k + rot); return [Math.cos(a) * q, Math.sin(a) * q]; });
const spiral = (r0, r1, turns, rot = 0, n = 90) => Array.from({ length: n + 1 }, (_, i) => { const u = i / n, a = rot + u * turns * TAU, r = lp(r0, r1, u); return [Math.cos(a) * r, Math.sin(a) * r]; });
const seg = (ax, az, bx, bz) => [[ax, az], [bx, bz]];
const radial = (a, r0, r1) => seg(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1);
const rot2 = (pts, a, cx = 0, cz = 0, s = 1) => { const c = Math.cos(a), si = Math.sin(a); return pts.map(([x, z]) => [cx + (c * x - si * z) * s, cz + (si * x + c * z) * s]); };
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Jagged polyline between two points with deterministic displacement (endpoints exact).
function jag(ax, az, bx, bz, k, amp, R) { const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L, o = [];
  for (let i = 0; i <= k; i++) { const u = i / k, d = i === 0 || i === k ? 0 : (R() - 0.5) * 2 * amp * Math.sin(u * Math.PI) ** 0.5; o.push([ax + dx * u + nx * d, az + dz * u + nz * d]); } return o; }
const chevron = (x, z, a, s) => rot2([[-0.5, -0.6], [0.35, 0], [-0.5, 0.6]], a, x, z, s);
// Line-art skull (negative-space sockets/nose, toothed jaw). Faces +z ("down" in top view), unit ~1 m wide.
function skull(s, cx, cz, full) {
  const T = (pts) => pts.map(([x, z]) => [cx + x * s, cz + z * s]), o = [];
  const dome = circ(0.5, 22, Math.PI * 0.86, Math.PI * 2.14, 0, -0.08);
  o.push(T([...dome, [0.42, 0.28], [0.27, 0.36], [0.26, 0.58], [-0.26, 0.58], [-0.27, 0.36], [-0.42, 0.28], dome[0]]));
  o.push(T(circ(0.15, 14, 0, TAU, -0.2, 0.05)), T(circ(0.15, 14, 0, TAU, 0.2, 0.05)));
  o.push(T([[0, 0.2], [-0.07, 0.33], [0.07, 0.33], [0, 0.2]]));
  if (full) { o.push(T(seg(-0.2, 0.46, 0.2, 0.46))); for (let i = -1; i <= 1; i++) o.push(T(seg(i * 0.1, 0.4, i * 0.1, 0.55))); }
  return o;
}
const drop = (cx, cz, a, s) => rot2(Array.from({ length: 25 }, (_, i) => { const t = (i / 24) * TAU, r = 0.5 * (1 - Math.sin(t)) ** 0.9; return [Math.sin(t) * 0.55 + 0.1, Math.cos(t) * r]; }).map(([x, z]) => [x, z]), a, cx, cz, s);
const leafShape = (cx, cz, a, s) => rot2([...Array.from({ length: 9 }, (_, i) => { const u = i / 8; return [u, Math.sin(u * Math.PI) * 0.28]; }), ...Array.from({ length: 8 }, (_, i) => { const u = 1 - (i + 1) / 8; return [u, -Math.sin(u * Math.PI) * 0.28]; })], a, cx, cz, s);

function vec(v) {
  if (Array.isArray(v) && v.length >= 3) { const o = [Number(v[0]), Number(v[1]), Number(v[2])]; return o.every(Number.isFinite) ? o : null; }
  if (v && typeof v === 'object' && 'x' in v && 'z' in v) { const o = [Number(v.x), Number(v.y ?? 0), Number(v.z)]; return Number.isFinite(o[0]) && Number.isFinite(o[2]) ? [o[0], Number.isFinite(o[1]) ? o[1] : 0, o[2]] : null; }
  return null;
}

export function createSpellTargeting({ scene, height, quality = 'high', reducedMotion = false } = {}) {
  let samples = 0;
  const H = (x, z) => { samples++; let h = 0; try { h = height ? +height(x, z) : 0; } catch { h = 0; } return Number.isFinite(h) ? h : 0; };
  const root = new THREE.Group(); root.name = 'SpellTargeting'; if (scene) scene.add(root);
  let qName = QUALITY[quality] ? quality : 'high', Q = QUALITY[qName], RM = !!reducedMotion, disposed = false;
  const U = { uT: { value: 0 }, uInv: { value: 0 }, uFade: { value: 0 }, uMo: { value: RM ? 0 : 1 } };

  // --- packed ribbon (one draw): ground strands baked flat on terrain, air strands camera-facing ---
  const LP = new Float32Array(MAX_PTS * 2 * 3), LT = new Float32Array(MAX_PTS * 2 * 3), LC = new Float32Array(MAX_PTS * 2 * 3),
    LA = new Float32Array(MAX_PTS * 2 * 4), LF = new Float32Array(MAX_PTS * 2 * 4), LI = new Uint16Array(MAX_IDX);
  const lg = new THREE.BufferGeometry(), attr = (a, n) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
  lg.setAttribute('position', attr(LP, 3)); lg.setAttribute('tng', attr(LT, 3)); lg.setAttribute('col', attr(LC, 3));
  lg.setAttribute('aux', attr(LA, 4)); lg.setAttribute('fx', attr(LF, 4)); lg.setIndex(attr(LI, 1)); lg.setDrawRange(0, 0);
  lg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const lineMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: LINE_VS, fragmentShader: LINE_FS, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const lines = new THREE.Mesh(lg, lineMat); lines.name = 'SpellTargetingGlyphs'; lines.renderOrder = 6; lines.frustumCulled = false;

  // --- translucent topo surface (one draw): concentric-disc or kernel-envelope grid ---
  const GV = (MAX_GRID + 1) ** 2, SP = new Float32Array(GV * 3), SH = new Float32Array(GV * 2), SI = new Uint16Array(MAX_GRID * MAX_GRID * 6);
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', attr(SP, 3)); sg.setAttribute('hv', attr(SH, 2)); sg.setIndex(attr(SI, 1));
  sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const SU = { uC: { value: new THREE.Color() }, uInv: U.uInv, uFade: U.uFade, uT: U.uT, uBand: { value: 0.5 } };
  const surfMat = new THREE.ShaderMaterial({ uniforms: SU, vertexShader: SURF_VS, fragmentShader: SURF_FS, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const surf = new THREE.Mesh(sg, surfMat); surf.name = 'SpellTargetingSurface'; surf.renderOrder = 5; surf.frustumCulled = false;
  let gridN = 0;
  function gridIndex(n) { if (n === gridN) return; gridN = n; let k = 0; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1; SI[k++] = a; SI[k++] = c; SI[k++] = b; SI[k++] = b; SI[k++] = c; SI[k++] = d; } sg.index.needsUpdate = true; sg.setDrawRange(0, n * n * 6); }

  // --- motes (one draw) ---
  const MP = new Float32Array(MAX_MOTES * 3), MS = new Float32Array(MAX_MOTES * 3), mg = new THREE.BufferGeometry();
  mg.setAttribute('position', attr(MP, 3)); mg.setAttribute('seed', attr(MS, 3)); mg.setDrawRange(0, 0); mg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const MU = { uT: U.uT, uFade: U.uFade, uInv: U.uInv, uRise: { value: 1.2 }, uScale: { value: 600 }, uC: { value: new THREE.Color() } };
  const moteMat = new THREE.ShaderMaterial({ uniforms: MU, vertexShader: MOTE_VS, fragmentShader: MOTE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const motes = new THREE.Points(mg, moteMat); motes.name = 'SpellTargetingMotes'; motes.renderOrder = 7; motes.frustumCulled = false;
  root.add(surf, lines, motes); root.visible = false;

  // ---------- builder ----------
  const B = { np: 0, ni: 0, strands: 0, dropped: 0, cx: 0, cz: 0, ca: 1, sa: 0 };
  const C = new THREE.Color();
  const toW = (lx, lz, o) => { o[0] = B.cx + B.ca * lx - B.sa * lz; o[1] = B.cz + B.sa * lx + B.ca * lz; return o; };
  const W0 = [0, 0], W1 = [0, 0];
  const segCap = () => Q.seg;
  function densify(pts, closed) {
    const src = closed ? [...pts, pts[0]] : pts; let tot = 0;
    for (let i = 1; i < src.length; i++) tot += Math.hypot(src[i][0] - src[i - 1][0], src[i][1] - src[i - 1][1]);
    const step = Math.max(Q.sp, tot / STRAND_PTS), o = [src[0]];
    for (let i = 1; i < src.length; i++) { const a = src[i - 1], b = src[i], k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let j = 1; j <= k; j++) o.push([lp(a[0], b[0], j / k), lp(a[1], b[1], j / k)]); }
    return o;
  }
  function reserve(m) { if (m < 2) return -1; if (B.np + m > MAX_PTS || B.ni / 6 + m - 1 > segCap()) { B.dropped++; return -1; } const o = B.np; B.np += m; B.strands++;
    for (let i = 0; i < m - 1; i++) { const a = (o + i) * 2; LI[B.ni++] = a; LI[B.ni++] = a + 1; LI[B.ni++] = a + 2; LI[B.ni++] = a + 1; LI[B.ni++] = a + 3; LI[B.ni++] = a + 2; } return o; }
  function vtx(k, x, y, z, tx, ty, tz, s, side, bbw, a, o) {
    LP[k * 3] = x; LP[k * 3 + 1] = y; LP[k * 3 + 2] = z; LT[k * 3] = tx; LT[k * 3 + 1] = ty; LT[k * 3 + 2] = tz;
    LC[k * 3] = C.r; LC[k * 3 + 1] = C.g; LC[k * 3 + 2] = C.b;
    LA[k * 4] = s; LA[k * 4 + 1] = side; LA[k * 4 + 2] = bbw; LA[k * 4 + 3] = a;
    LF[k * 4] = o.vis || 0; LF[k * 4 + 1] = o.flow ?? 1; LF[k * 4 + 2] = o.dash || 0; LF[k * 4 + 3] = o.propLen || 0;
  }
  // Ground strand: local 2D points, conformed to the CURRENT height callback at both ribbon edges.
  function gS(pts, w, col, o = {}) {
    if (o.fine && !Q.fine) return;
    const d = densify(pts, o.closed), m = d.length, base = reserve(m); if (base < 0) return;
    C.set(col); const lift = o.lift ?? 0.06, off = o.off, a = o.a ?? 0.95, hw = (w * GROUND_W) / 2; let s = 0;
    let len = 0; if (o.prop) { for (let i = 1; i < m; i++) len += Math.hypot(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1]); o = { ...o, propLen: len }; }
    for (let i = 0; i < m; i++) {
      const p = d[i], pa = d[Math.max(0, i - 1)], pb = d[Math.min(m - 1, i + 1)]; let tx = pb[0] - pa[0], tz = pb[1] - pa[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      if (i) s += Math.hypot(p[0] - d[i - 1][0], p[1] - d[i - 1][1]);
      const lx = p[0] - tz * hw, lz = p[1] + tx * hw, rx = p[0] + tz * hw, rz = p[1] - tx * hw;
      toW(lx, lz, W0); toW(rx, rz, W1);
      const y0 = H(W0[0], W0[1]) + lift + (off ? off(lx, lz) : 0), y1 = H(W1[0], W1[1]) + lift + (off ? off(rx, rz) : 0);
      vtx((base + i) * 2, W0[0], y0, W0[1], 0, 0, 0, s, -1, 0, a, o); vtx((base + i) * 2 + 1, W1[0], y1, W1[1], 0, 0, 0, s, 1, 0, a, o);
    }
  }
  // Air strand: world-space 3D points, camera-facing width.
  function aS(pts, w, col, o = {}) {
    if (o.fine && !Q.fine) return;
    const m = pts.length, base = reserve(m); if (base < 0) return; C.set(col); let s = 0; const a = o.a ?? 0.9;
    for (let i = 0; i < m; i++) { const p = pts[i], pa = pts[Math.max(0, i - 1)], pb = pts[Math.min(m - 1, i + 1)]; if (i) s += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]);
      const tx = pb[0] - pa[0], ty = pb[1] - pa[1], tz = pb[2] - pa[2];
      vtx((base + i) * 2, p[0], p[1], p[2], tx, ty, tz, s, -1, (w * AIR_W) / 2, a, o); vtx((base + i) * 2 + 1, p[0], p[1], p[2], tx, ty, tz, s, 1, (w * AIR_W) / 2, a, o); }
  }
  const G = (lx, lz, dy = 0) => { toW(lx, lz, W0); return [W0[0], H(W0[0], W0[1]) + dy, W0[1]]; };
  const vertical = (lx, lz, y0, y1, n = 2) => { const g = G(lx, lz); return Array.from({ length: n }, (_, i) => [g[0], g[1] + lp(y0, y1, i / (n - 1)), g[2]]); };
  const many = (list, w, col, o) => list.forEach((p) => gS(p, w, col, o));
  const INV = { vis: 2, flow: 0 }, OK = (o = {}) => ({ ...o, vis: 1 });
  const cross = (r, cx = 0, cz = 0) => { gS(seg(cx - r, cz - r, cx + r, cz + r), 0.14, PAL.white, INV); gS(seg(cx - r, cz + r, cx + r, cz - r), 0.14, PAL.white, INV); };
  // Exact kernel-union footprint helpers for line spells (local x along path, z lateral).
  // Earth lines preview the authority's own plan: segment centres K and the exact rampart / chasm profile (SEGS).
  let K = [], KR = 2.5, KH = 0, KL = 0, SEGS = [], KIND = 'wall';
  const kOff = (lx, lz) => { let wall = 0, low = 0, high = 0; const spec = wallSpec(KIND);
    for (const g of SEGS) { if (KIND === 'sunder') { const [t, b] = chasmProfile(g, lx, lz, spec); low = Math.min(low, t); high = Math.max(high, b); } else wall = Math.max(wall, wallProfile(g, lx, lz, spec)); }
    return clamp(wall + low + high, -DEFORM_CAP, DEFORM_CAP); };
  const halfW = (lx) => { const cap = wallSpec(KIND).cap, over = Math.max(0, Math.abs(lx) - KL / 2); return over >= cap ? 0 : KR * Math.sqrt(1 - (over / cap) ** 2); };
  function envelope(n, sign, inset = 0, R) { const x0 = -KL / 2 - KR, x1 = KL / 2 + KR, o = [];
    for (let i = 0; i <= n; i++) { const x = lp(x0, x1, i / n), w = Math.max(0, halfW(x) - (inset && R ? inset * R() : inset)); o.push([x, sign * w]); } return o; }

  // ---------- surface + motes ----------
  let surfOn = false, motesOn = false;
  function surfaceDisc(R, offFn, elevated, color, band = 0.5) {
    const n = Q.grid; gridIndex(n); let k = 0;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { // Shirley concentric square->disc map
      const a = (2 * i) / n - 1, b = (2 * j) / n - 1; let r, phi;
      if (a === 0 && b === 0) { r = 0; phi = 0; } else if (Math.abs(a) > Math.abs(b)) { r = a; phi = (Math.PI / 4) * (b / a); } else { r = b; phi = Math.PI / 2 - (Math.PI / 4) * (a / b); }
      const lx = r * R * Math.cos(phi), lz = r * R * Math.sin(phi), h = offFn(lx, lz); toW(lx, lz, W0);
      SP[k * 3] = W0[0]; SP[k * 3 + 1] = H(W0[0], W0[1]) + (elevated ? h : 0) + 0.04; SP[k * 3 + 2] = W0[1]; SH[k * 2] = h; SH[k * 2 + 1] = 1 - smooth(clamp((Math.abs(r) - 0.92) / 0.08)) * 0.6; k++; }
    finishSurface(color, band);
  }
  function surfaceLine(elevated, color, band) {
    const n = Q.grid; gridIndex(n); let k = 0; const x0 = -KL / 2 - KR, x1 = KL / 2 + KR;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const lx = lp(x0, x1, i / n), w = halfW(lx), lz = lp(-w, w, j / n), h = kOff(lx, lz); toW(lx, lz, W0);
      SP[k * 3] = W0[0]; SP[k * 3 + 1] = H(W0[0], W0[1]) + (elevated ? h : 0) + 0.04; SP[k * 3 + 2] = W0[1]; SH[k * 2] = h; SH[k * 2 + 1] = 1; k++; }
    finishSurface(color, band);
  }
  function finishSurface(color, band) { SU.uC.value.set(color); SU.uBand.value = band; sg.attributes.position.needsUpdate = true; sg.attributes.hv.needsUpdate = true; surfOn = true; }
  function moteField(n, R, color, rise, size = 0.2, seed = 7, ring = 0) {
    n = Math.min(n, Q.motes); if (!n) return; const r = rng(seed);
    for (let i = 0; i < n; i++) { const a = r() * TAU, q = ring ? R * (0.85 + 0.15 * r()) : R * Math.sqrt(r()), lx = R ? Math.cos(a) * q : lp(-KL / 2, KL / 2, r()), lz = R ? Math.sin(a) * q : (r() - 0.5) * 1.6 * halfW(lx);
      const g = G(lx, lz, rise < 0 ? 0.1 : 0.15);
      MP[i * 3] = g[0]; MP[i * 3 + 1] = g[1]; MP[i * 3 + 2] = g[2]; MS[i * 3] = r(); MS[i * 3 + 1] = 0.25 + r() * 0.35; MS[i * 3 + 2] = size * (0.6 + r() * 0.8); }
    MU.uRise.value = rise; MU.uC.value.set(color); mg.setDrawRange(0, n); mg.attributes.position.needsUpdate = true; mg.attributes.seed.needsUpdate = true; motesOn = true;
  }

  // Ent spells mark the exact trees that would wake: a root-knot ring round each trunk, two blue eyes on the bark
  // and a resonance vein up into the crown. Awaken centres on its tree; Wild Awakening also draws its catch circle.
  function entTree(x, z, h, i) {
    const rr = 0.9 + Math.min(0.5, h * 0.04);
    gS(wave(rr, 7, 0.1, i * 1.3, 72).map(([px, pz]) => [px + x, pz + z]), 0.08, PAL.bark, { flow: 0.3 });
    gS(circ(rr * 0.72, 40, 0, TAU, x, z), 0.05, PAL.water, { dash: 1.1, flow: -0.8, fine: true });
    for (let k = 0; k < 5; k++) { const a = (k * TAU) / 5 + i; gS(rot2([[rr * 0.95, 0], [rr * 1.25, 0.12], [rr * 1.5, -0.05]], a, x, z), 0.05, PAL.bark, { fine: true }); }
    const eye = Math.max(1.1, Math.min(2.2, h * 0.3));
    for (const s of [-1, 1]) { const g = G(x + s * 0.13, z - 0.42, eye); aS([[g[0] - s * 0.09, g[1] + 0.03, g[2]], [g[0] + s * 0.09, g[1] - 0.02, g[2]]], 0.07, PAL.crystal, OK()); }
    aS(vertical(x, z - 0.38, 0.15, Math.max(2.5, h * 0.55), 4), 0.05, PAL.water, OK({ dash: 0.7, flow: -2.5 }));
  }
  function entTargets() { return want.trees.length ? want.trees : null; }

  // ---------- the 16 designs ----------
  const D = {
    awaken(R) { // one tree: its root ring and eyes. With no tree in reach, a bare seed glyph and the invalid cross.
      const t = entTargets();
      if (t) for (const [x, z, h] of t) entTree(x, z, h, 0);
      else { gS(circ(R, 48), 0.07, PAL.bark, { dash: 1.2, flow: 0.4 }); for (let k = 0; k < 3; k++) gS(leafShape(0, 0, (k * TAU) / 3 + 0.3, 0.6), 0.04, PAL.leaf, { fine: true }); }
      cross(R * 0.5); moteField(14, R, PAL.crystal, 1.4, 0.15, 71);
    },
    wildwake(R) { // catch circle of roots; tendrils run from the heart to each tree that will rise
      gS(wave(R, 11, 0.16, 0, 176), 0.08, PAL.bark, { flow: 0.3 }); gS(circ(R * 0.94, 96), 0.04, PAL.water, { dash: 1.4, flow: -0.5, fine: true });
      for (let i = 0; i < 3; i++) gS(spiral(0.3, R * 0.45, 0.6, (i * TAU) / 3, 40), 0.05, PAL.moss, { prop: true, fine: true });
      gS(circ(0.35, 16), 0.06, PAL.crystal);
      const t = entTargets();
      if (t) t.forEach(([x, z, h], i) => { const a = Math.atan2(z, x), d = Math.hypot(x, z), nx = -Math.sin(a), nz = Math.cos(a);
        gS(Array.from({ length: 15 }, (_, j) => { const u = j / 14, w = Math.sin(u * Math.PI * 2) * 0.3; return [Math.cos(a) * (0.35 + (d - 1.3) * u) + nx * w, Math.sin(a) * (0.35 + (d - 1.3) * u) + nz * w]; }), 0.06, PAL.water, { prop: true, flow: 1.5 });
        entTree(x, z, h, i + 1); });
      cross(R * 0.4); moteField(26, R, PAL.crystal, 1.3, 0.16, 73);
    },
    skeleton(R) { // grave sigil: rune ring + restrained line-art skull
      gS(circ(R), 0.1, PAL.bone, { closed: false, flow: 0.4 });
      gS(circ(R * 0.82), 0.05, PAL.purple, { dash: 1.3, flow: -0.6, fine: true });
      for (let i = 0; i < 12; i++) { const a = (i * TAU) / 12; gS(i % 2 ? radial(a, R * 0.84, R * 0.97) : rot2([[R * 0.86, -0.1], [R * 0.95, 0], [R * 0.86, 0.1]], a), 0.045, PAL.violet); }
      many(skull(R * 0.62, 0, 0, true), 0.07, PAL.bone, OK({ flow: 0.3 }));
      for (const sx of [-1, 1]) gS(rot2(circ(0.14, 6, 0, Math.PI), sx > 0 ? 0 : Math.PI, sx * R * 0.6, R * 0.55), 0.05, PAL.purple, { fine: true }); // risen knuckles
      cross(R * 0.5); moteField(18, R * 0.8, PAL.purple, 1.1, 0.16, 3);
    },
    squad(R) { // four exact spawn seals on the 1.4 m diagonal square, small skull in each
      gS(circ(R), 0.09, PAL.bone, { flow: 0.4 }); gS(circ(R * 1.08), 0.04, PAL.gold, { dash: 1.1, flow: 0.5, fine: true });
      const sp = SPELL_SHAPES.squad.spawns;
      gS([...sp.slice(0, 2), sp[3], sp[2], sp[0]], 0.04, PAL.purple, { dash: 2, flow: 1 });
      for (const [x, z] of sp) { gS(circ(0.62, 28, 0, TAU, x, z), 0.07, PAL.gold); many(skull(0.62, x, z - 0.05, false), 0.05, PAL.bone, OK());
        gS(rot2([[0.75, 0], [0.98, 0]], Math.atan2(z, x), x, z), 0.05, PAL.gold); }
      gS(poly(4, 0.28, Math.PI / 4), 0.05, PAL.purple); cross(R * 0.5); moteField(16, R, PAL.purple, 1, 0.15, 5);
    },
    golem(R) { // heavy masonry: octagon, buttresses, four interlocking L-stones around a keystone
      gS(poly(8, R, Math.PI / 8), 0.17, PAL.stone, { flow: 0.2 }); gS(poly(8, R * 0.9, Math.PI / 8), 0.05, PAL.amber, { fine: true });
      for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * TAU) / 8; gS(radial(a, R * 0.9, R * 1.12), 0.2, PAL.slate); }
      const L = [[-0.15, -0.55], [0.55, -0.55], [0.55, 0.15], [0.3, 0.15], [0.3, -0.3], [-0.15, -0.3], [-0.15, -0.55]];
      for (let i = 0; i < 4; i++) gS(rot2(L, (i * Math.PI) / 2, 0, 0, R * 0.62), 0.11, PAL.gold, OK());
      gS(poly(4, R * 0.15, Math.PI / 4), 0.12, PAL.amber);
      for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2; aS(vertical(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9, 0, 0.7), 0.14, PAL.stone, { flow: 0 }); }
      cross(R * 0.45); moteField(12, R * 0.9, PAL.amber, 0.7, 0.2, 9);
    },
    raise(R) { // exact footprint, lifted topo contours, profile spokes, +2 m peak gauge, translucent mound
      const h = SPELL_SHAPES.raise.h, off = (x, z) => h * smooth(clamp(1 - Math.hypot(x, z) / R));
      gS(circ(R, 96), 0.12, PAL.gold, { flow: 0.3 }); gS(circ(R * 1.04, 96), 0.04, PAL.amber, { dash: 0.8, flow: -0.6, fine: true });
      for (const f of [0.25, 0.5, 0.75]) { const t = invSmooth(f); gS(circ(R * (1 - t), 72), 0.06, PAL.amber, { off, lift: 0.05, flow: 0.8 }); }
      const spokes = Q.fine ? 12 : 6; for (let i = 0; i < spokes; i++) { const a = (i * TAU) / spokes; gS(radial(a, R, 0.35), 0.04, PAL.gold, { off, lift: 0.05, prop: true }); }
      for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2; gS(chevron(Math.cos(a) * R * 0.88, Math.sin(a) * R * 0.88, a + Math.PI, 0.45), 0.07, PAL.gold, { fine: true }); }
      gS(circ(0.4, 20), 0.07, PAL.astral, { off, lift: 0.08 });
      aS(vertical(0, 0, 0, h + 0.15, 3), 0.06, PAL.astral, OK());
      aS((() => { const g = G(0, 0, h + 0.15); return [[g[0] - 0.25, g[1] - 0.3, g[2]], g, [g[0] + 0.25, g[1] - 0.3, g[2]]]; })(), 0.06, PAL.astral, OK());
      for (let i = 1; i <= 4; i++) { const g = G(0, 0, i * 0.5); aS([[g[0] - 0.15, g[1], g[2]], [g[0] + 0.15, g[1], g[2]]], 0.04, PAL.gold, { fine: true }); }
      cross(R * 0.3); surfaceDisc(R, off, true, PAL.amber, 0.5); moteField(24, R, PAL.gold, 1.6, 0.18, 11);
    },
    lower(R) { // descending: depth contours stay ON the ground; inward stair chevrons, sinking spiral, down gauge
      const h = SPELL_SHAPES.lower.h, off = (x, z) => h * smooth(clamp(1 - Math.hypot(x, z) / R));
      gS(circ(R, 96), 0.12, PAL.purple, { flow: -0.3 }); gS(circ(R * 1.04, 96), 0.04, PAL.teal, { dash: 0.8, flow: 0.6, fine: true });
      for (const [f, dash] of [[0.25, 1.4], [0.5, 2], [0.75, 2.8]]) { const t = invSmooth(f); gS(circ(R * (1 - t), 72), 0.06, PAL.teal, { dash, flow: -1 }); }
      gS(spiral(R * 0.95, 0.35, 1.5, 0, 110), 0.05, PAL.violet, { prop: true, fine: true });
      for (let i = 0; i < 8; i++) { const a = (i * TAU) / 8; for (const q of [0.82, 0.62]) gS(chevron(Math.cos(a) * R * q, Math.sin(a) * R * q, a + Math.PI, 0.38), 0.07, PAL.purple, q < 0.7 ? { fine: true } : {}); }
      gS(circ(0.4, 20), 0.07, PAL.teal);
      aS(vertical(0, 0, -h, 0.12, 3), 0.06, PAL.teal, OK()); // 2 m gauge standing above the centre, arrow down into the void
      aS((() => { const g = G(0, 0, 0.12); return [[g[0] - 0.25, g[1] + 0.3, g[2]], g, [g[0] + 0.25, g[1] + 0.3, g[2]]]; })(), 0.06, PAL.teal, OK());
      for (let i = 1; i <= 4; i++) { const g = G(0, 0, i * 0.5); aS([[g[0] - 0.15, g[1], g[2]], [g[0] + 0.15, g[1], g[2]]], 0.04, PAL.violet, { fine: true }); }
      cross(R * 0.3); surfaceDisc(R, off, false, PAL.violet, 0.5); moteField(24, R, PAL.teal, -1.4, 0.16, 13);
    },
    sunder(_, len, fb) { // exact kernel envelope with torn inset edge, propagating fracture seam start->end
      const R = rng(41), x0 = -len / 2, x1 = len / 2, n = Math.max(24, Math.ceil((len + 5) / 0.3));
      gS(envelope(n, 1), 0.1, PAL.water, { prop: true }); gS(envelope(n, -1), 0.1, PAL.water, { prop: true });
      gS(envelope(Math.ceil(n * 0.7), 1, 0.22, R), 0.05, PAL.crystal, { fine: true }); gS(envelope(Math.ceil(n * 0.7), -1, 0.22, R), 0.05, PAL.crystal, { fine: true });
      gS(jag(x0, 0, x1, 0, Math.max(4, Math.ceil(len / 0.55)), 0.28, R), 0.13, PAL.water, { prop: true, flow: 2 });
      for (const s of [-1, 1]) gS([[x0, s * SPELL_SHAPES.sunder.bank], [x1, s * SPELL_SHAPES.sunder.bank]], 0.04, PAL.crystal, { dash: 1.2, flow: 2 }); // spoil banks
      K.forEach((k, i) => { for (const s of [-1, 1]) { const ex = k + 1.4, ez = s * 1.9; gS(jag(k, s * 0.2, Math.min(ex, x1 + 2.2), ez, 4, 0.18, R), 0.06, PAL.crystal, { prop: true, fine: i % 2 === 1 }); }
        gS(poly(4, 0.3, Math.PI / 4, k, 0), 0.05, PAL.water); });
      for (let x = x0 + 1; x < x1 - 0.5; x += 2) gS(chevron(x, 0, 0, 0.5), 0.07, PAL.ice);
      gS(circ(0.5, 20, 0, TAU, x0, 0), 0.08, PAL.ice); gS(seg(x0 - 0.7, 0, x0 - 0.2, 0), 0.06, PAL.ice); // origin seal
      gS(rot2([[-0.5, -0.8], [0.6, 0], [-0.5, 0.8], [-0.2, 0], [-0.5, -0.8]], 0, x1, 0), 0.08, PAL.water); // destination arrowhead
      if (fb) gS(circ(0.25, 12), 0.05, PAL.white); cross(1, 0, 0); cross(0.7, x1, 0);
      surfaceLine(false, PAL.water, 0.5); moteField(28, 0, PAL.water, 0.9, 0.16, 17);
    },
    wall(_, len, fb) { // exact envelope on ground, lifted crest/ribs, kernel height posts, direction chevrons
      const x0 = -len / 2, x1 = len / 2, n = Math.max(24, Math.ceil((len + 5) / 0.3)), off = kOff;
      gS(envelope(n, 1), 0.1, PAL.ice); gS(envelope(n, -1), 0.1, PAL.ice);
      gS(Array.from({ length: n + 1 }, (_, i) => [lp(x0 - KR, x1 + KR, i / n), 0]), 0.08, PAL.crystal, { off, lift: 0.05, prop: true });
      for (const s of [-1, 1]) gS(Array.from({ length: n + 1 }, (_, i) => { const x = lp(x0 - KR, x1 + KR, i / n); return [x, s * Math.min(KR * 0.4, halfW(x))]; }), 0.04, PAL.stone, { off, lift: 0.04, fine: true });
      K.forEach((k) => { gS(Array.from({ length: 17 }, (_, i) => [k, lp(-KR, KR, i / 16)]), 0.06, PAL.stone, { off, lift: 0.04 });
        const top = kOff(k, 0); aS(vertical(k, 0, 0, top, 2), 0.05, PAL.ice, OK()); const g = G(k, 0, top); aS([[g[0] - 0.2 * B.sa, g[1], g[2] + 0.2 * B.ca], [g[0] + 0.2 * B.sa, g[1], g[2] - 0.2 * B.ca]], 0.05, PAL.ice, { fine: true }); });
      for (let x = x0 + 1; x < x1 - 0.5; x += 2) for (const s of [-1, 1]) gS(chevron(x, s * 3.0, 0, 0.32), 0.06, PAL.crystal, { fine: true });
      gS(circ(0.5, 20, 0, TAU, x0, 0), 0.08, PAL.ice); gS(rot2([[-0.4, -0.6], [0.5, 0], [-0.4, 0.6]], 0, x1 + KR + 0.6, 0), 0.08, PAL.ice);
      if (fb) gS(circ(0.25, 12), 0.05, PAL.white); cross(1, 0, 0);
      surfaceLine(true, PAL.stone, 0.5); moteField(20, 0, PAL.ice, 0.8, 0.15, 19);
    },
    grove(R) { // twin swirl + branching root curls to the five exact tree sites, leaf-scalloped rim, seed heart
      gS(wave(R, 14, 0.1, 0, 168), 0.09, PAL.leaf, { flow: 0.4 });
      for (const s of [0, Math.PI]) gS(spiral(0.35, R * 0.62, 0.9, s, 70), 0.06, PAL.moss, { prop: true });
      gS(rot2([...circ(0.45, 12, -1.1, 1.1, -0.18, 0), ...circ(0.45, 12, Math.PI - 1.1, Math.PI + 1.1, 0.18, 0)], Math.PI / 2), 0.06, PAL.gold); // seed
      for (const [x, z] of SPELL_SHAPES.grove.trees) {
        const a = Math.atan2(z, x), d = Math.hypot(x, z), nx = -Math.sin(a), nz = Math.cos(a);
        gS(Array.from({ length: 13 }, (_, i) => { const u = i / 12, w = Math.sin(u * Math.PI * 1.5) * 0.35; return [Math.cos(a) * d * u * 0.82 + nx * w, Math.sin(a) * d * u * 0.82 + nz * w]; }), 0.06, PAL.bark, { prop: true });
        for (const s of [-1, 1]) { const bx = Math.cos(a) * d * 0.5, bz = Math.sin(a) * d * 0.5; gS([[bx, bz], ...spiral(0.05, 0.3, 0.8 * s, a + s * 1.2, 12).map(([px, pz]) => [bx + nx * s * 0.55 + px, bz + nz * s * 0.55 + pz])], 0.04, PAL.bark, { fine: true }); }
        gS(circ(0.55, 24, 0, TAU, x, z), 0.07, PAL.leaf);
        for (let k = 0; k < 5; k++) gS(leafShape(x, z, (k * TAU) / 5 + a, 0.42), 0.035, PAL.moss, { fine: true });
        aS(vertical(x, z, 0, 1.3, 3), 0.07, PAL.bark, OK());
        const t = G(x, z, 1.3); for (const s of [-1, 1]) aS([[t[0], t[1] - 0.35, t[2]], [t[0] + s * 0.3, t[1] - 0.05, t[2]], [t[0] + s * 0.45, t[1] + 0.12, t[2]]], 0.05, PAL.leaf, OK({ fine: true }));
      }
      cross(R * 0.4); moteField(22, R, PAL.leaf, 1.2, 0.18, 23);
    },
    ring(R) { // eight exact saplings on r=3.6, braided vine growing around, outer canopy limit 4.5
      const tr = SPELL_SHAPES.ring.treeRing, n = SPELL_SHAPES.ring.trees;
      gS(circ(R, 96), 0.05, PAL.teal, { dash: 1.4, flow: 0.5 });
      gS(wave(tr, n * 2, 0.22, 0, 192), 0.07, PAL.leaf, { prop: true }); gS(wave(tr, n * 2, 0.22, Math.PI, 192), 0.05, PAL.moss, { prop: true, fine: true });
      gS(circ(tr * 0.6, 64), 0.04, PAL.teal, { flow: -0.4, fine: true });
      for (let i = 0; i < n; i++) { const a = (i * TAU) / n, x = Math.cos(a) * tr, z = Math.sin(a) * tr;
        gS(circ(0.38, 18, 0, TAU, x, z), 0.07, PAL.leaf); gS(leafShape(Math.cos(a + 0.4) * tr, Math.sin(a + 0.4) * tr, a + Math.PI / 2, 0.5), 0.04, PAL.moss, { fine: true });
        aS(vertical(x, z, 0, 1.1, 2), 0.06, PAL.bark, OK()); const t = G(x, z, 1.1); aS([[t[0] - 0.25, t[1] - 0.25, t[2]], t, [t[0] + 0.25, t[1] - 0.25, t[2]]], 0.05, PAL.leaf, OK({ fine: true })); }
      cross(R * 0.3); moteField(24, tr, PAL.leaf, 1.3, 0.17, 29, 1);
    },
    starfall(R) { // celestial compass rose aligned to world axes, converging orbits, fixed strike crosshair + sky beam
      gS(circ(R, 96), 0.11, PAL.star, { flow: 0.3 }); gS(circ(R * 1.07, 96), 0.04, PAL.astral, { dash: 0.9, flow: -0.8, fine: true });
      const rose = []; for (let i = 0; i <= 16; i++) { const a = (i * TAU) / 16, r = i % 2 ? R * 0.26 : i % 4 ? R * 0.58 : R * 0.86; rose.push([Math.cos(a) * r, Math.sin(a) * r]); }
      gS(rose, 0.07, PAL.astral);
      for (let i = 0; i < 3; i++) gS(spiral(R * 0.98, R * 0.3, -0.45, (i * TAU) / 3 + 0.3, 40), 0.06, PAL.amethyst, { prop: true, flow: 2 });
      for (let i = 0; i < 8; i++) { const a = (i * TAU) / 8 + Math.PI / 8; gS(chevron(Math.cos(a) * R * 0.93, Math.sin(a) * R * 0.93, a + Math.PI, 0.32), 0.06, PAL.star, { fine: true }); }
      for (let i = 0; i < 4; i++) gS(radial((i * Math.PI) / 2, 0.22, 1.5), 0.05, PAL.white, { flow: 0 });
      gS(circ(0.12, 12), 0.05, PAL.white); gS(circ(0.75, 32), 0.04, PAL.star, { dash: 3, flow: 1.5 });
      aS(vertical(0, 0, 0.1, 18, 4), 0.08, PAL.astral, { prop: false, dash: 0.6, flow: -4 });
      const c = G(0, 0, 4); aS(Array.from({ length: 33 }, (_, i) => { const a = (i * TAU) / 32; return [c[0] + Math.cos(a) * 1.6, c[1] + Math.sin(a) * 0.5, c[2] + Math.sin(a) * 1.2]; }), 0.05, PAL.amethyst, OK({ fine: true, dash: 1.2, flow: 2 }));
      cross(R * 0.35); moteField(28, R, PAL.star, -3, 0.2, 31);
    },
    crystal(R) { // hexagonal mineral footprint, faceted triangulation, emerging crystal cluster outline
      gS(poly(6, R, Math.PI / 6), 0.11, PAL.crystal, { flow: 0.4 }); gS(poly(6, R * 0.6, 0), 0.06, PAL.amethyst);
      for (let i = 0; i < 6; i++) { const a = (i * TAU) / 6; gS([[Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6], [Math.cos(a - Math.PI / 6) * R, Math.sin(a - Math.PI / 6) * R]], 0.04, PAL.crystal, { fine: true });
        gS([[Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6], [Math.cos(a + Math.PI / 6) * R, Math.sin(a + Math.PI / 6) * R]], 0.04, PAL.crystal, { fine: true }); }
      const prism = (x, z, r, h, tip, lean, la) => { const g = G(x, z), bot = [], top = [], dx = Math.cos(la) * lean, dz = Math.sin(la) * lean;
        for (let i = 0; i <= 6; i++) { const a = (i * TAU) / 6; bot.push([g[0] + Math.cos(a) * r, g[1] + 0.02, g[2] + Math.sin(a) * r]); top.push([g[0] + Math.cos(a) * r * 0.85 + dx * h, g[1] + h, g[2] + Math.sin(a) * r * 0.85 + dz * h]); }
        const apex = [g[0] + dx * (h + tip), g[1] + h + tip, g[2] + dz * (h + tip)];
        aS(bot, 0.04, PAL.crystal, OK()); aS(top, 0.04, PAL.crystal, OK({ fine: true }));
        for (let i = 0; i < 6; i++) { aS([bot[i], top[i], apex], 0.045, i % 2 ? PAL.crystal : PAL.amethyst, OK({ fine: i % 2 === 1 })); } };
      prism(0, 0, 0.42, 1.3, 0.6, 0, 0); prism(0.9, 0.35, 0.26, 0.65, 0.35, 0.35, 0.4); prism(-0.75, -0.6, 0.24, 0.55, 0.3, 0.35, -2.4);
      cross(R * 0.5); moteField(16, R * 0.7, PAL.crystal, 1, 0.15, 37);
    },
    heal(R) { // calm sanctuary: rippling water rim, outward ripples, rain drops, rounded cross
      gS(wave(R, 28, 0.05, 0, 200), 0.09, PAL.mint, { flow: 0.25 });
      for (const [q, d] of [[0.3, 0], [0.55, 0.9], [0.8, 0.7]]) gS(circ(R * q, 80), 0.05, PAL.water, { dash: d, flow: -0.5, fine: q === 0.55 });
      for (let i = 0; i < 6; i++) { const a = (i * TAU) / 6 + Math.PI / 6; gS(drop(Math.cos(a) * R * 0.68, Math.sin(a) * R * 0.68, a + Math.PI, 0.8), 0.06, PAL.water); }
      const arm = 0.95, c = 0.22, ap = (cx, cz, a0) => circ(c, 10, a0, a0 + Math.PI, cx, cz);
      gS([...ap(0, -arm, Math.PI), [c, -c], [arm, -c], ...ap(arm, 0, -Math.PI / 2), [c, c], [c, arm], ...ap(0, arm, 0), [-c, c], [-arm, c], ...ap(-arm, 0, Math.PI / 2), [-c, -c], [-c, -arm]]
        .map(([x, z]) => [x * 1.2, z * 1.2]), 0.08, PAL.mint, OK());
      gS(circ(1.75, 40), 0.05, PAL.mint, { fine: true });
      cross(R * 0.25); moteField(40, R, PAL.water, -2.6, 0.14, 43);
    },
    lightning(R) { // charged rim, converging jagged bolts, exact crosshair, sky bolt
      const r = rng(53); gS(circ(R, 72), 0.08, PAL.bolt, { dash: 1.6, flow: 3 }); gS(circ(R * 1.06, 72), 0.035, PAL.amethyst, { fine: true });
      for (let i = 0; i < 6; i++) { const a = (i * TAU) / 6 + 0.25; gS(jag(Math.cos(a) * R, Math.sin(a) * R, Math.cos(a) * 0.4, Math.sin(a) * 0.4, 7, 0.32, r).reverse(), 0.07, PAL.bolt, { prop: true, flow: 3 }); }
      for (let i = 0; i < 4; i++) gS(radial((i * Math.PI) / 2 + Math.PI / 4, 0.18, 0.9), 0.045, PAL.white);
      gS(circ(0.12, 10), 0.05, PAL.white);
      const g = G(0, 0), bolt = jag(0, 0, 0, 12, 9, 0.6, r).map(([x, y], i, a) => [g[0] + x * (i === 0 || i === a.length - 1 ? 0 : 1), g[1] + 12 - y, g[2] + (r() - 0.5) * 0.6 * (i && i < a.length - 1)]);
      aS(bolt, 0.09, PAL.bolt, { dash: 0.5, flow: -6 });
      cross(R * 0.5); moteField(20, R, PAL.bolt, 0.9, 0.14, 59, 1);
    },
    frost(R) { // dendritic snowflake (six branched arms) + icicle-toothed rim; distinct from crystal's hex plates
      const teeth = []; for (let i = 0; i <= 48; i++) { const a = (i * TAU) / 48, q = i % 2 ? R * 0.94 : R; teeth.push([Math.cos(a) * q, Math.sin(a) * q]); }
      gS(circ(R, 96), 0.07, PAL.frost, { flow: 0.2 }); gS(teeth, 0.045, PAL.ice, { fine: true });
      for (let k = 0; k < 6; k++) { const a = (k * TAU) / 6 + Math.PI / 6;
        gS(radial(a, 0.6, R * 0.86), 0.08, PAL.ice, { prop: true, flow: 0.6 });
        for (const [q, l] of [[0.32, 0.9], [0.55, 1.2], [0.75, 0.7]]) for (const s of [-1, 1]) { const bx = Math.cos(a) * R * q, bz = Math.sin(a) * R * q, b = a + s * 0.62;
          gS([[bx, bz], [bx + Math.cos(b) * l, bz + Math.sin(b) * l]], 0.05, PAL.frost, q === 0.75 ? { fine: true } : {}); }
        gS(rot2([[R * 0.86, 0], [R * 0.9, 0.12], [R * 0.96, 0], [R * 0.9, -0.12], [R * 0.86, 0]], a), 0.05, PAL.white); }
      gS(poly(6, 0.6, Math.PI / 6), 0.07, PAL.white); gS(poly(6, R * 0.2, 0), 0.04, PAL.frost, { dash: 2, flow: 0.4, fine: true });
      cross(R * 0.25); moteField(36, R, PAL.ice, -1.8, 0.14, 61);
    },
    spring(R) { // welling pool: double water rim, inward ripples, a rising bead at the centre
      gS(wave(R, 22, 0.04, 0, 160), 0.08, PAL.water, { flow: 0.3 }); gS(circ(R * 0.82, 64), 0.045, PAL.mint, { dash: 1.2, flow: -0.6, fine: true });
      for (const q of [0.25, 0.5]) gS(circ(R * q, 48), 0.04, PAL.water, { dash: 0.8, flow: 0.8, fine: true });
      gS(drop(0, 0, Math.PI / 2, 0.9), 0.07, PAL.mint, OK());
      cross(R * 0.3); moteField(18, R * 0.8, PAL.water, 1.4, 0.14, 71);
    },
    blessing(R) { // radiant star: gold-and-blue rays out to a fine rim, a halo above the centre
      gS(circ(R, 96), 0.07, PAL.star, { flow: 0.3 }); gS(circ(R * 0.94, 96), 0.035, PAL.crystal, { dash: 1.4, flow: -0.4, fine: true });
      for (let i = 0; i < 8; i++) { const a = (i * TAU) / 8; gS(radial(a, 0.5, R * (i % 2 ? 0.6 : 0.88)), i % 2 ? 0.045 : 0.07, i % 2 ? PAL.crystal : PAL.star, { prop: true, flow: 0.8 }); }
      const g = G(0, 0), halo = []; for (let i = 0; i <= 32; i++) { const a = (i * TAU) / 32; halo.push([g[0] + Math.cos(a) * 0.6, g[1] + 2.2, g[2] + Math.sin(a) * 0.6]); }
      aS(halo, 0.06, PAL.star, OK());
      cross(R * 0.3); moteField(26, R, PAL.star, 1.6, 0.14, 73);
    },
    quake(R) { // concentric fault rings with jagged cracks running out from the centre
      const r = rng(79); for (const [q, w] of [[1, 0.08], [0.7, 0.05], [0.4, 0.045]]) gS(wave(R * q, 14, 0.06, q * 3, 140), w, q === 1 ? PAL.crystal : PAL.amethyst, { flow: q === 1 ? 0.4 : -0.3, fine: q !== 1 });
      for (let i = 0; i < 7; i++) { const a = (i * TAU) / 7 + 0.3; gS(jag(Math.cos(a) * 0.5, Math.sin(a) * 0.5, Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.95, 8, 0.4, r), 0.055, PAL.crystal, { prop: true, flow: 1.2 }); }
      cross(R * 0.25); moteField(24, R, PAL.crystal, 0.8, 0.14, 83);
    },
  };
  function invSmooth(f) { let a = 0, b = 1; for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if (smooth(m) < f) a = m; else b = m; } return (a + b) / 2; }

  // ---------- target state ----------
  const want = { on: false, spell: '', valid: true, cx: 0, cz: 0, ang: 0, len: 0, rad: 0, fb: false, ax: 0, az: 0, bx: 0, bz: 0, trees: [], treeKey: '' };
  let builtKey = '', fade = 0, clock = 0, builds = 0, lastBuildMs = 0, lastSamples = 0, committed = null, suppressed = false;
  function setTarget(t) {
    if (disposed) return false;
    const spec = t && typeof t === 'object' && typeof t.spell === 'string' && Object.hasOwn(SPELL_SHAPES, t.spell) ? SPELL_SHAPES[t.spell] : null;
    if (!spec) { want.on = false; return false; }
    const p = vec(t.point), a = vec(t.start), b = vec(t.end);
    if([p,a,b].some(v=>v&&(Math.abs(v[0])>120||Math.abs(v[2])>120))){want.on=false;return false;}
    want.valid = t.valid !== false; want.spell = t.spell;
    if (spec.line) {
      if (a && b && Math.hypot(b[0] - a[0], b[2] - a[2]) > 1e-3) { want.ax = a[0]; want.az = a[2]; want.bx = b[0]; want.bz = b[2]; want.fb = t.fallback === true; }
      else if (p) { want.ax = p[0] - FALLBACK_LINE / 2; want.az = p[2]; want.bx = p[0] + FALLBACK_LINE / 2; want.bz = p[2]; want.fb = true; }
      else { want.on = false; return false; }
      want.cx = (want.ax + want.bx) / 2; want.cz = (want.az + want.bz) / 2; want.ang = Math.atan2(want.bz - want.az, want.bx - want.ax);
      want.len = Math.hypot(want.bx - want.ax, want.bz - want.az); want.rad = 0;
    } else {
      if (!p) { want.on = false; return false; }
      const r = Number(t.radius); want.rad = Number.isFinite(r) && r > 0.05 && r < 60 ? r : spec.r; want.cx = p[0]; want.cz = p[2]; want.ang = 0; want.len = 0; want.fb = false;
    }
    want.trees = spec.count && Array.isArray(t.trees) ? t.trees.slice(0, spec.count).map(vec2 => [Number(vec2?.x), Number(vec2?.z), Number(vec2?.height) || 6])
      .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z) && Math.hypot(x - want.cx, z - want.cz) < 30).map(([x, z, h]) => [+(x - want.cx).toFixed(2), +(z - want.cz).toFixed(2), +h.toFixed(1)]) : [];
    want.treeKey = want.trees.join(';');
    const aim = p || b;
    if (committed && (want.spell !== committed.spell || !aim || Math.hypot(aim[0]-committed.x,aim[2]-committed.z) > .4)) committed=null;
    suppressed=!!committed;
    want.on = true; return true;
  }
  // Only the local player's acknowledged cast commits a preview. Keep it out
  // of the spectacle until the player aims elsewhere or chooses another spell.
  // A rejected cast leaves the informative marker untouched.
  function commit(t) {
    const p=vec(t?.point); if(disposed || !p || !SPELL_SHAPES[t.spell])return false;
    committed={spell:t.spell,x:p[0],z:p[2]};
    suppressed=want.spell===t.spell;
    return true;
  }
  // Rebuild only when changed earth intersects this marker's footprint.
  function invalidateTerrain(dirty = null) {
    if (!want.on || disposed) return false;
    const spec = SPELL_SHAPES[want.spell], r = spec.line ? spec.bank ?? spec.kr : want.rad * 1.25;
    const minX = (spec.line ? Math.min(want.ax,want.bx) : want.cx)-r, maxX = (spec.line ? Math.max(want.ax,want.bx) : want.cx)+r;
    const minZ = (spec.line ? Math.min(want.az,want.bz) : want.cz)-r, maxZ = (spec.line ? Math.max(want.az,want.bz) : want.cz)+r;
    if (dirty && !dirty.some(e => e.x+e.radius+.75>=minX && e.x-e.radius-.75<=maxX && e.z+e.radius+.75>=minZ && e.z-e.radius-.75<=maxZ)) return false;
    builtKey = ''; return true;
  }
  function build() {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now(); const s0 = samples;
    B.np = 0; B.ni = 0; B.strands = 0; B.dropped = 0; B.cx = want.cx; B.cz = want.cz; B.ca = Math.cos(want.ang); B.sa = Math.sin(want.ang);
    surfOn = false; motesOn = false; mg.setDrawRange(0, 0);
    const spec = SPELL_SHAPES[want.spell];
    if (spec.line) { KR = spec.kr; KH = spec.kh; KL = want.len; KIND = want.spell; const L = Math.max(KL, 0.5), plan = planEarthLine(KIND, [-L / 2, 0], [L / 2, 0]); SEGS = plan.segments; K = SEGS.map((g) => g.x); }
    D[want.spell](want.rad, want.len, want.fb);
    lg.setDrawRange(0, B.ni); for (const k of ['position', 'tng', 'col', 'aux', 'fx']) { const at = lg.attributes[k]; at.clearUpdateRanges(); at.addUpdateRange(0, B.np * 2 * at.itemSize); at.needsUpdate = true; }
    lg.index.clearUpdateRanges(); lg.index.addUpdateRange(0, B.ni); lg.index.needsUpdate = true;
    builds++; lastSamples = samples - s0; lastBuildMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  }
  const keyOf = () => `${want.spell}|${want.cx}|${want.cz}|${want.ax}|${want.az}|${want.bx}|${want.bz}|${want.rad}|${want.fb}|${want.treeKey}|${qName}`;
  function update(nowMs, dt) {
    if (disposed) return; dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); clock += dt;
    if (want.on) { const k = keyOf(); if (k !== builtKey) { builtKey = k; build(); } }
    fade = want.on && !suppressed ? (RM ? 1 : clamp(fade + dt * 8)) : (RM ? 0 : clamp(fade - dt * 9));
    root.visible = fade > 0.005 && builtKey !== '';
    U.uFade.value = fade; U.uInv.value = want.valid ? 0 : 1; U.uMo.value = RM ? 0 : 1;
    U.uT.value = RM ? 0 : (Number.isFinite(nowMs) ? (nowMs / 1000) % 600 : clock % 600);
    lines.visible = B.ni > 0; surf.visible = surfOn; motes.visible = motesOn && !RM && Q.motes > 0;
  }
  function configure({ quality: q, reducedMotion: rm } = {}) {
    if (q !== undefined && QUALITY[q]) { qName = q; Q = QUALITY[q]; builtKey = ''; }
    if (rm !== undefined) RM = !!rm;
  }
  function stats() {
    let draws = 0, triangles = 0;
    if (root.visible) { if (lines.visible) { draws++; triangles += B.ni / 3; } if (surf.visible) { draws++; triangles += gridN * gridN * 2; } if (motes.visible) draws++; }
    return { spell: want.on ? want.spell : null, valid: want.valid, visible: root.visible, fade, suppressed, draws, triangles, ribbonPoints: B.np, strands: B.strands, droppedStrands: B.dropped,
      motes: motes.visible ? mg.drawRange.count : 0, surface: surf.visible, quality: qName, reducedMotion: RM, builds, lastBuildMs, heightSamplesPerBuild: lastSamples,
      materials: 3, geometries: 3, budget: qName === 'low' ? { draws: 10, triangles: 5000 } : { draws: 20, triangles: 12000 } };
  }
  async function prepareShaders(renderer, camera, targetScene) {
    if (disposed || !renderer?.compileAsync) return; const preview = new THREE.Group();
    for (const m of [lines, surf, motes]) { const k = m.clone(false); k.visible = true; preview.add(k); }
    try { await renderer.compileAsync(preview, camera, targetScene || scene); } finally { preview.clear(); }
  }
  function dispose() {
    if (disposed) return; disposed = true; want.on = false;
    if (root.parent) root.parent.remove(root); root.clear();
    lg.dispose(); sg.dispose(); mg.dispose(); lineMat.dispose(); surfMat.dispose(); moteMat.dispose();
  }
  return { root, setTarget, commit, update, configure, stats, dispose, prepareShaders, invalidateTerrain, get disposed() { return disposed; } };
}

// Opt-in for the production bare-earth mesh contract only. Arbitrary height
// callbacks retain their original sampling unless the caller selects this path.
export function createMarkerTerrainSampler(height) {
  const vertices=new Map();
  const vertex=(x,z)=>{const key=x+','+z;if(vertices.has(key))return vertices.get(key);const h=height(x,z);if(vertices.size>=32768)vertices.clear();vertices.set(key,h);return h;};
  return {height:(x,z)=>triangleHeight(vertex,x,z),invalidate:()=>vertices.clear(),stats:()=>({vertices:vertices.size,limit:32768})};
}
