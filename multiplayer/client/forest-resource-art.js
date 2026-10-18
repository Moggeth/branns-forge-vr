// Forest/resource art pass (Opus 5.5, 2026-10-03). Procedural, editable authored geometry: every shape below is a deliberate
// sculpt (displaced, cut, stratified, faceted) built once and shared by every instance. No textures, no lights, no transparency.
//  createResourceArt() -> {pickup(kind), deposit(kind,{variant}), update(seconds), stats(), dispose()}
//  enhanceTreeTemplate(scene,{lod,variant}) -> merges leaf sprays / twigs / root flares into the template's own Leaves /
//  Branches / Roots geometry (cached per source geometry). Trunk geometry, named groups and pivots are never touched.
import * as T from 'three';

// ---------- deterministic helpers ----------
const rng = seed => () => { seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const hsh = (x, y, z) => { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); };
const sm = t => t * t * (3 - 2 * t);
function vnoise(x, y, z) { const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = sm(x - ix), fy = sm(y - iy), fz = sm(z - iz); const L = (a, b, t) => a + (b - a) * t;
 return L(L(L(hsh(ix, iy, iz), hsh(ix + 1, iy, iz), fx), L(hsh(ix, iy + 1, iz), hsh(ix + 1, iy + 1, iz), fx), fy), L(L(hsh(ix, iy, iz + 1), hsh(ix + 1, iy, iz + 1), fx), L(hsh(ix, iy + 1, iz + 1), hsh(ix + 1, iy + 1, iz + 1), fx), fy), fz); }
const fbm = (x, y, z) => vnoise(x, y, z) * .55 + vnoise(x * 2.1 + 5, y * 2.1, z * 2.1) * .3 + vnoise(x * 4.3, y * 4.3 + 9, z * 4.3) * .15;
const clamp01 = v => Math.max(0, Math.min(1, v));
const _v = new T.Vector3(), _n = new T.Vector3();

// ---------- GLSL detail (object-space, no textures) ----------
const NOISE_GLSL = /* glsl */`
float frH3(vec3 p){p=fract(p*.3183099+.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float frN(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.0-2.0*f);
 return mix(mix(mix(frH3(i),frH3(i+vec3(1,0,0)),f.x),mix(frH3(i+vec3(0,1,0)),frH3(i+vec3(1,1,0)),f.x),f.y),mix(mix(frH3(i+vec3(0,0,1)),frH3(i+vec3(1,0,1)),f.x),mix(frH3(i+vec3(0,1,1)),frH3(i+vec3(1,1,1)),f.x),f.y),f.z);}`;
const BUMP_GLSL = /* glsl */`
{ float fade=1.0-smoothstep(6.0,18.0,length(vViewPosition)); vec3 pos=-vViewPosition,dpx=dFdx(pos),dpy=dFdy(pos);
  float h=frHt*FR_BUMP*fade,hx=dFdx(h),hy=dFdy(h); vec3 r1=cross(dpy,normal),r2=cross(normal,dpx); float det=dot(dpx,r1);
  vec3 g=sign(det)*(hx*r1+hy*r2); vec3 nn=abs(det)*normal-g; if(dot(nn,nn)>1e-12&&fade>0.0) normal=normalize(nn); }`;

// Stone / ore matrix / cast metal: fine grain colour + roughness + derivative bump; optional baked crystal bounce in uv.y.
function patchDetail(m, {scale = 9, bump = .006, tone = .16, bounce = null, key}) {
 const uniforms = {uFrBounce: {value: new T.Color(bounce ?? 0)}};
 m.onBeforeCompile = s => { Object.assign(s.uniforms, uniforms);
  s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFrObj; varying float vFrGlow;')
   .replace('#include <begin_vertex>', '#include <begin_vertex>\n vFrObj = position; vFrGlow = uv.y;');
  s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\n${NOISE_GLSL}\nvarying vec3 vFrObj; varying float vFrGlow; uniform vec3 uFrBounce; float frHt=0.0;\n#define FR_BUMP ${bump.toFixed(4)}`)
   .replace('#include <color_fragment>', `#include <color_fragment>\n{ vec3 p=vFrObj*${scale.toFixed(2)}; float a=frN(p), b=frN(p*3.7+7.0), c=frN(p*11.0+3.0);
     frHt=a*.5+b*.35+c*.15; diffuseColor.rgb*=1.0-${tone.toFixed(3)}*.5+${tone.toFixed(3)}*(a*.6+c*.4); }`)
   .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor=clamp(roughnessFactor*(.82+.36*frHt),.08,1.0);')
   .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${BUMP_GLSL}`)
   .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += uFrBounce * vFrGlow;');
 };
 m.customProgramCacheKey = () => 'fr-detail:' + key; return m;
}
// Opaque crystal: dark refractive body, view-dependent bright core, parallax inner streaks and a cool polished rim.
function patchCrystal(m, time, rim) {
 m.onBeforeCompile = s => { s.uniforms.uFrTime = time;
  s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFrObj;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vFrObj = position;');
  s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vFrObj; uniform float uFrTime;`)
   .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
 { vec3 vd=normalize(vViewPosition); float ndv=clamp(abs(dot(normal,vd)),0.0,1.0);
   float lum=max(vColor.r,max(vColor.g,vColor.b)); float core=ndv*ndv; float rimF=pow(1.0-ndv,3.0);
   vec3 q=vFrObj+vd*.09; float streak=smoothstep(.62,1.0,sin(dot(q,vec3(23.0,37.0,17.0)))*.5+.5);
   float pulse=.82+.18*sin(uFrTime*1.4+vFrObj.y*6.0+vFrObj.x*4.0);
   totalEmissiveRadiance = emissive*lum*(.18+1.25*core*pulse+.7*streak*core) + vec3(${rim.map(v => v.toFixed(3)).join(',')})*rimF*.55; }`);
 };
 m.customProgramCacheKey = () => 'fr-crystal'; return m;
}

// ---------- geometry builders ----------
// Faceted rock lump: displaced icosphere + planar fractures + undercut strata ledges + flattened bed. Non-indexed => flat
// facets (hand-cut look). Returns geometry plus per-vertex `cavity` (0 exposed .. 1 recessed) for colouring.
function rockLump({detail = 2, sx = 1, sy = 1, sz = 1, seed = 1, cuts = 4, strata = .2, rough = .35, bed = -.55}) {
 const g = new T.IcosahedronGeometry(1, detail), p = g.attributes.position, r = rng(seed), planes = [];
 for (let i = 0; i < cuts; i++) { const n = new T.Vector3(r() * 2 - 1, r() * 1.6 - .5, r() * 2 - 1).normalize(); planes.push([n, .62 + r() * .25]); }
 const so = r() * 50, cav = new Float32Array(p.count);
 for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i);
  const d = fbm(_v.x * 1.7 + so, _v.y * 1.7, _v.z * 1.7 + so); _v.multiplyScalar(1 + (d - .5) * rough * 2);
  for (const [n, off] of planes) { const s = _v.dot(n) - off; if (s > 0) _v.addScaledVector(n, -s * .94); }
  _v.set(_v.x * sx, _v.y * sy, _v.z * sz);
  const t = _v.y / strata + d, f = t - Math.floor(t), k = 1 - .085 * sm(clamp01((f - .7) / .3)); _v.x *= k; _v.z *= k; // undercut ledges
  if (_v.y < bed * sy) _v.y = bed * sy + (_v.y - bed * sy) * .12;
  cav[i] = clamp01((.5 - d) * 2 + (1 - k) * 5); p.setXYZ(i, _v.x, _v.y, _v.z); }
 g.computeVertexNormals(); g.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(p.count * 2), 2)); g.userData.cavity = cav; return g;
}
// Crystal prism with asymmetric termination; broken=true gives a slanted fracture cap. Colour encodes base->tip intensity.
function prism({base, dir, len, rad, sides = 6, seed = 1, broken = false, tint = [1, 1, 1], flat = 1}) {
 const r = rng(seed), D = dir.clone().normalize(), U = Math.abs(D.y) < .9 ? new T.Vector3(0, 1, 0) : new T.Vector3(1, 0, 0), A = new T.Vector3().crossVectors(D, U).normalize(), B = new T.Vector3().crossVectors(D, A);
 const ring = (h, s) => { const out = []; for (let i = 0; i < sides; i++) { const a = i / sides * Math.PI * 2 + seed, j = s * (.85 + r() * .3);
   out.push(base.clone().addScaledVector(D, h * len).addScaledVector(A, Math.cos(a) * rad * j).addScaledVector(B, Math.sin(a) * rad * j * flat)); } return out; };
 const r0 = ring(-.22, .88), r1 = ring(broken ? .78 : .7, 1), pos = [], col = [], c = (k, out) => out.push(tint[0] * k, tint[1] * k, tint[2] * k);
 const tri = (a, b, d, ka, kb, kd) => { pos.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z); c(ka, col); c(kb, col); c(kd, col); };
 for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; tri(r0[i], r0[j], r1[j], .25, .25, .8); tri(r0[i], r1[j], r1[i], .25, .8, .8); }
 if (broken) { const tilt = A.clone().multiplyScalar(len * .12), cen = new T.Vector3(); r1.forEach(v => cen.add(v)); cen.divideScalar(sides);
  r1.forEach((v, i) => v.addScaledVector(tilt, Math.cos(i / sides * Math.PI * 2) * .9));
  for (let i = 0; i < sides; i++) tri(cen, r1[(i + 1) % sides], r1[i], 1, .9, .9); }
 else { const tip = base.clone().addScaledVector(D, len).addScaledVector(A, rad * (r() - .5) * .7).addScaledVector(B, rad * (r() - .5) * .7);
  for (let i = 0; i < sides; i++) tri(r1[i], r1[(i + 1) % sides], tip, .8, .8, 1); }
 const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
 g.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2)); g.computeVertexNormals(); return g;
}
// Cast ingot: rounded-trapezoid section extruded with end bevels, top face carries a sunk maker's stamp (diamond + bar).
function ingotGeo(len = .2, w = .085, h = .052) {
 const s = new T.Shape(), b = w / 2, t = w * .36, rr = .008;
 s.moveTo(-b + rr, 0); s.lineTo(b - rr, 0); s.quadraticCurveTo(b, 0, b - .002, rr); s.lineTo(t + .002, h - rr); s.quadraticCurveTo(t, h, t - rr, h);
 s.lineTo(-t + rr, h); s.quadraticCurveTo(-t, h, -t - .002, h - rr); s.lineTo(-b + .002, rr); s.quadraticCurveTo(-b, 0, -b + rr, 0);
 const g = new T.ExtrudeGeometry(s, {depth: len - .016, bevelEnabled: true, bevelThickness: .008, bevelSize: .006, bevelSegments: 2, curveSegments: 3});
 g.translate(0, 0, -(len - .016) / 2); const p = g.attributes.position;
 for (let i = 0; i < p.count; i++) { const z = p.getZ(i) / (len / 2), y = p.getY(i) / h, k = 1 - .1 * z * z * y; p.setX(i, p.getX(i) * k); } // drafted mould ends
 const stamp = new T.Shape(); stamp.moveTo(0, -.022); stamp.lineTo(.013, 0); stamp.lineTo(0, .022); stamp.lineTo(-.013, 0); stamp.lineTo(0, -.022);
 const hole = new T.Path(); hole.moveTo(0, -.011); hole.lineTo(-.006, 0); hole.lineTo(0, .011); hole.lineTo(.006, 0); hole.lineTo(0, -.011); stamp.holes.push(hole);
 const sg = new T.ExtrudeGeometry(stamp, {depth: .003, bevelEnabled: false}); sg.rotateX(-Math.PI / 2); sg.translate(0, h - .0015, 0);
 const bar = new T.ExtrudeGeometry(new T.Shape([new T.Vector2(-.02, -.002), new T.Vector2(.02, -.002), new T.Vector2(.02, .002), new T.Vector2(-.02, .002)]), {depth: .002, bevelEnabled: false});
 bar.rotateX(-Math.PI / 2); bar.translate(0, h - .001, .045); const bar2 = bar.clone().translate(0, 0, -.09);
 const out = mergeFlat([g, sg, bar, bar2]); out.computeVertexNormals(); return out;
}
function mergeFlat(list) { // non-indexed concat of position/normal/uv/color (missing => defaults)
 const names = {position: 3, normal: 3, uv: 2, color: 3}, g = new T.BufferGeometry(); const parts = list.map(x => x.index ? x.toNonIndexed() : x);
 for (const [n, size] of Object.entries(names)) { const total = parts.reduce((s, x) => s + x.attributes.position.count, 0), arr = new Float32Array(total * size); let o = 0;
  for (const x of parts) { const a = x.attributes[n]; if (a) for (let i = 0; i < a.count; i++) for (let c = 0; c < size; c++) arr[o + i * size + c] = a.getComponent(i, c); else if (n === 'color') arr.fill(1, o, o + x.attributes.position.count * size); o += x.attributes.position.count * size; }
  g.setAttribute(n, new T.BufferAttribute(arr, size)); }
 return g;
}
function paint(g, fn) { const p = g.attributes.position, n = g.attributes.normal, col = new Float32Array(p.count * 3), out = [0, 0, 0];
 for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i); _n.fromBufferAttribute(n, i); fn(_v, _n, i, out, g.userData.cavity?.[i] ?? 0); col.set(out, i * 3); }
 g.setAttribute('color', new T.BufferAttribute(col, 3)); return g; }
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// Strata palette: banded by height with wobble; recesses darker, exposed ridges sun-bleached.
const strataPaint = (bands, {freq = 9, rust = null} = {}) => (p, n, i, out, cav) => {
 const t = p.y * freq + fbm(p.x * 3, p.y * 2, p.z * 3) * 2.2, k = Math.floor(t), band = bands[((k % bands.length) + bands.length) % bands.length], next = bands[(((k + 1) % bands.length) + bands.length) % bands.length];
 let c = mixc(band, next, sm(clamp01((t - k - .8) / .2))); const sh = (1 - cav * .45) * (.92 + .16 * Math.max(0, n.y));
 if (rust) c = mixc(c, rust.color, clamp01(rust.at(p)) * .75);
 out[0] = c[0] * sh; out[1] = c[1] * sh; out[2] = c[2] * sh; };
function sitOnFloor(g, height) { g.computeBoundingBox(); const b = g.boundingBox, s = height / (b.max.y - b.min.y);
 g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2); g.scale(s, s, s); return s; }
function surfacePoints(g, count, seed, filter) { const p = g.attributes.position, n = g.attributes.normal, r = rng(seed), out = [];
 for (let tries = 0; out.length < count && tries < count * 60; tries++) { const i = Math.floor(r() * p.count); const P = new T.Vector3().fromBufferAttribute(p, i), N = new T.Vector3().fromBufferAttribute(n, i); if (!filter || filter(P, N)) out.push([P, N]); }
 return out; }

// ---------- palettes keyed by material-catalog keys ----------
const ORE = {
 ironOre: {bands: [[.5, .22, .13], [.66, .4, .2], [.3, .16, .13], [.58, .3, .17]], vein: 0x2d2a2c, veinMetal: .9, veinRough: .3, crystal: null, emissive: 0},
 mithrilOre: {bands: [[.36, .42, .48], [.55, .62, .66], [.27, .32, .38], [.47, .52, .56]], vein: 0xd8eef4, veinMetal: 1, veinRough: .18, crystal: [.62, .95, 1], emissive: 0x3ab8d0},
 starOre: {bands: [[.12, .1, .1], [.26, .16, .09], [.08, .07, .08], [.2, .12, .08]], vein: 0xf2b95c, veinMetal: 1, veinRough: .25, crystal: [1, .78, .4], emissive: 0xf09a2a},
 copperOre: {bands: [[.2, .42, .34], [.32, .58, .46], [.16, .3, .26], [.42, .3, .2]], vein: 0xc0703e, veinMetal: .95, veinRough: .3, crystal: null, emissive: 0},
 goldOre: {bands: [[.78, .76, .7], [.88, .86, .8], [.64, .6, .54], [.82, .78, .7]], vein: 0xf2c24a, veinMetal: 1, veinRough: .2, crystal: null, emissive: 0}
};
const METAL = {iron: {color: 0x9aa3aa, rough: .4, tone: .22}, mithril: {color: 0xcfe9ef, rough: .2, tone: .1}, starMetal: {color: 0xffffff, rough: .28, tone: .14},
 copper: {color: 0xe39a6c, rough: .32, tone: .16}, gold: {color: 0xffd36e, rough: .22, tone: .1}};
const DEPOSIT = {
 iron: {bands: [[.42, .38, .35], [.52, .47, .42], [.36, .31, .29], [.47, .42, .38]], rust: [.62, .3, .16], ore: 0x3a2a26, oreMetal: .85, oreRough: .32, crystal: [1, .66, .36], emissive: 0xc26a2a, bounce: 0x5a2a10},
 mithril: {bands: [[.34, .38, .43], [.46, .51, .56], [.27, .3, .35], [.4, .45, .5]], rust: [.42, .58, .64], ore: 0xd9f2f7, oreMetal: 1, oreRough: .16, crystal: [.6, .95, 1], emissive: 0x2fb7d6, bounce: 0x0f4652},
 crystal: {bands: [[.33, .3, .36], [.44, .4, .46], [.26, .23, .29], [.38, .34, .4]], rust: [.5, .36, .62], ore: 0x7a4bc8, oreMetal: .35, oreRough: .3, crystal: [.78, .55, 1], emissive: 0x8a4cf0, bounce: 0x341a5c},
 // Mountain-foot veins (shared/ore-veins.js). style picks the sculpt: nodule band, plane seam or open geode.
 copper: {style: 'nodule', shape: [.74, .52, .64, -.12], bands: [[.4, .37, .33], [.5, .46, .41], [.33, .3, .27], [.45, .41, .36]], rust: [.22, .56, .44], ore: 0xb8663a, oreMetal: .95, oreRough: .34, crystal: [.35, .95, .78], emissive: 0x1d8c6c, bounce: 0x0f4a38},
 gold: {style: 'seam', shape: [.62, .6, .5, .12], oreCount: 15, oreSize: 1.6, bands: [[.26, .25, .25], [.33, .32, .31], [.2, .2, .2], [.3, .29, .28]], rust: [.95, .92, .84], ore: 0xffc94a, oreMetal: 1, oreRough: .2, crystal: [1, .96, .82], emissive: 0xb88a24, bounce: 0x5a3c08},
 star: {style: 'geode', shape: [.7, .58, .62, 0], bands: [[.14, .12, .13], [.22, .19, .19], [.1, .09, .1], [.18, .15, .14]], rust: [.5, .3, .12], ore: 0xf2b95c, oreMetal: 1, oreRough: .24, crystal: [1, .58, .16], emissive: 0xff8a12, bounce: 0x7a3a06}
};
for (const [k, v] of Object.entries({iron: 'nodule', mithril: 'seam', crystal: 'geode'})) DEPOSIT[k].style = v;
const DEPOSIT_ALIAS = {iron: 'iron', iron_vein: 'iron', mithril: 'mithril', mithril_seam: 'mithril', crystal: 'crystal', crystal_fault: 'crystal', gems: 'crystal', copper: 'copper', gold: 'gold', star: 'star'};
export const BAR_STACK_MAX = 24;
export const PICKUP_KINDS = Object.freeze(['ironOre', 'mithrilOre', 'starOre', 'iron', 'mithril', 'starMetal', 'crystal', 'copperOre', 'goldOre', 'copper', 'gold', 'amber']);
export const DEPOSIT_KINDS = Object.freeze(['iron', 'mithril', 'crystal', 'copper', 'gold', 'star']);
export const HELD_SCALE = .5; // hero/held ore: same asset at half scale

export function createResourceArt() {
 const time = {value: 0}, geos = new Set(), mats = new Map(), pickups = new Map(), deposits = new Map();
 const own = g => (geos.add(g), g.computeBoundingBox(), g.computeBoundingSphere(), g);
 const mat = (key, make) => { let m = mats.get(key); if (!m) { m = make(); m.name = 'ResourceArt:' + key; mats.set(key, m); } return m; };
 const stoneMat = (key, bounce) => mat('stone:' + key, () => patchDetail(new T.MeshStandardMaterial({vertexColors: true, roughness: .9, metalness: 0}), {scale: 7, bump: .007, tone: .2, bounce, key: 'stone'}));
 const metalMat = (key, color, metal, rough, tone = .15, emissive = 0) => mat('metal:' + key, () => patchDetail(new T.MeshStandardMaterial({color, metalness: metal, roughness: rough, emissive, emissiveIntensity: emissive ? .5 : 0, vertexColors: true}), {scale: 22, bump: .0025, tone, key: 'metal'}));
 const crystalMat = (key, emissive, rim) => mat('crystal:' + key, () => patchCrystal(new T.MeshStandardMaterial({color: 0xffffff, vertexColors: true, metalness: .05, roughness: .1, emissive, emissiveIntensity: 1}), time, rim));

 function orePickup(kind) { const o = ORE[kind], seed = kind.length * 977 + kind.charCodeAt(0);
  const main = rockLump({detail: 1, sx: 1.05, sy: .82, sz: .78, seed, cuts: 5, strata: .28, rough: .32, bed: -.5});
  const b = rockLump({detail: 1, sx: .6, sy: .5, sz: .55, seed: seed + 3, cuts: 4, rough: .4}); b.rotateZ(.5); b.translate(.78, -.28, .32);
  const c = rockLump({detail: 1, sx: .45, sy: .42, sz: .5, seed: seed + 7, cuts: 3, rough: .4}); c.rotateX(-.4); c.translate(-.55, -.36, -.52);
  for (const x of [main, b, c]) paint(x, strataPaint(o.bands, {freq: 4.5}));
  const body = mergeFlat([main, b, c]);
  const veins = [], pts = surfacePoints(main, 9, seed + 11, (P, N) => N.y > -.2);
  pts.forEach(([P, N], i) => { const f = rockLump({detail: 0, sx: .16, sy: .05, sz: .12, seed: seed + 20 + i, cuts: 2, rough: .2, bed: -2});
   f.lookAt(N); f.translate(P.x - N.x * .02, P.y - N.y * .02, P.z - N.z * .02); paint(f, (p, n, j, out) => { out[0] = out[1] = out[2] = .75 + .25 * Math.max(0, n.y); }); veins.push(f); });
  let shards = null;
  if (o.crystal) { const list = surfacePoints(main, kind === 'starOre' ? 5 : 4, seed + 31, (P, N) => N.y > .35).map(([P, N], i) =>
   prism({base: P.clone().addScaledVector(N, -.05), dir: N.clone().add(new T.Vector3(0, .8, 0)), len: .34 + i * .05, rad: .07, sides: kind === 'starOre' ? 4 : 5, seed: seed + i, broken: i % 2 === 1, tint: o.crystal}));
   shards = mergeFlat(list); }
  const all = [body, mergeFlat(veins), shards].filter(Boolean), s = sitOnFloorGroup(all, .24);
  const parts = [[own(body), stoneMat(kind, 0)], [own(all[1]), metalMat('vein:' + kind, o.vein, o.veinMetal, o.veinRough, .12, kind === 'starOre' ? 0xb86a10 : 0)]];
  if (shards) parts.push([own(shards), crystalMat(kind, o.emissive, kind === 'starOre' ? [1, .85, .55] : [.8, .95, 1])]);
  return {parts, scale: s};
 }
 function sitOnFloorGroup(list, height) { const box = new T.Box3(); for (const g of list) { g.computeBoundingBox(); box.union(g.boundingBox); }
  const s = height / (box.max.y - box.min.y); for (const g of list) { g.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2); g.scale(s, s, s); } return s; }
 function ingotPickup(kind) { const m = METAL[kind], one = ingotGeo(), list = [], h = .052, layout = [[-.047, 0, 0, 0], [.047, 0, 0, 0], [-.05, h, 0, Math.PI / 2], [.05, h, 0, Math.PI / 2], [0, 2 * h, 0, .12]];
  layout.forEach(([x, y, z, ry], i) => { const g = one.clone(); g.rotateY(ry + (i % 2 ? .04 : -.03)); g.translate(ry ? 0 : x, y, ry ? x : z); list.push(g); });
  const g = mergeFlat(list); g.computeVertexNormals();
  paint(g, (p, n, i, out) => { const top = Math.max(0, n.y), edge = 1 - Math.abs(n.y) - Math.abs(n.x) * .2; const stamp = p.y % h > h - .004 && Math.abs(p.x) < .03 ? 1 : 0;
   if (kind === 'starMetal') { const gold = top * .85 + clamp01(edge * 2 - 1.2) + fbm(p.x * 40, p.y * 40, p.z * 40) * .25; const c = mixc([.07, .055, .05], [1, .74, .32], clamp01(gold)); out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; }
   else { const k = (.86 + .14 * top) * (stamp ? .7 : 1); out[0] = out[1] = out[2] = k; } });
  sitOnFloor(g, .22);
  return {parts: [[own(g), metalMat(kind, m.color, kind === 'iron' ? .85 : 1, m.rough, m.tone, kind === 'starMetal' ? 0x3a1c00 : 0)]]};
 }
 // Output-bay stack: real cast bars cribbed three to a course, alternating direction, so the pile visibly grows with
 // the count (up to BAR_STACK_MAX bars shown). Bars are 40 % larger than a loose pickup so a stack reads from across the yard.
 function barStackKit(kind, n) { const m = METAL[kind], h = .073, one = ingotGeo(.28, .12, h), list = [], gap = .132;
  for (let i = 0; i < n; i++) { const layer = Math.floor(i / 3), slot = i % 3, ry = layer % 2 ? Math.PI / 2 : 0, g = one.clone();
   g.rotateY(ry + (((i * 37) % 7) - 3) * .014); const off = (slot - 1) * gap; g.translate(ry ? (((i * 13) % 5) - 2) * .004 : off, layer * h, ry ? off : (((i * 11) % 5) - 2) * .004); list.push(g); }
  const g = mergeFlat(list); g.computeVertexNormals();
  paint(g, (p, nrm, i, out) => { const top = Math.max(0, nrm.y), edge = 1 - Math.abs(nrm.y) - Math.abs(nrm.x) * .2;
   if (kind === 'starMetal') { const gold = top * .85 + clamp01(edge * 2 - 1.2) + fbm(p.x * 30, p.y * 30, p.z * 30) * .25; const c = mixc([.07, .055, .05], [1, .74, .32], clamp01(gold)); out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; }
   else { const k = .84 + .16 * top; out[0] = out[1] = out[2] = k; } });
  g.computeBoundingBox(); const b = g.boundingBox; g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  return {parts: [[own(g), metalMat(kind, m.color, kind === 'iron' ? .85 : 1, m.rough, m.tone, kind === 'starMetal' ? 0x3a1c00 : 0)]]};
 }
 function crystalPickup() { const seed = 4242, base = rockLump({detail: 1, sx: 1, sy: .35, sz: .85, seed, cuts: 3, rough: .3, bed: -.4});
  paint(base, strataPaint(DEPOSIT.crystal.bands, {freq: 6}));
  const dirs = [[0, 1, 0, .95, .2, 0], [.45, .8, .1, .7, .16, 1], [-.5, .75, .2, .62, .15, 0], [.1, .7, -.6, .55, .14, 1], [-.2, .6, .7, .45, .12, 0], [.7, .5, -.3, .38, .1, 0]];
  const cr = mergeFlat(dirs.map(([x, y, z, l, r, br], i) => prism({base: new T.Vector3(x * .25, .1, z * .25), dir: new T.Vector3(x, y, z), len: l, rad: r, seed: seed + i, broken: !!br, tint: DEPOSIT.crystal.crystal})));
  sitOnFloorGroup([base, cr], .27);
  return {parts: [[own(base), stoneMat('crystalPickup', 0)], [own(cr), crystalMat('crystal', DEPOSIT.crystal.emissive, [.92, .85, 1])]]};
 }
 // Amber (Kingsfell's heartwood, 2026-10-16): a split wedge of heartwood holding three drops of old resin, the same
 // stone as the axe's heartstone. The resin uses the crystal shader (warm core glow + rim), so it reads at a glance.
 function amberPickup() { const seed = 6161, wood = rockLump({detail: 1, sx: .95, sy: .3, sz: .62, seed, cuts: 4, strata: .12, rough: .22, bed: -.5});
  paint(wood, strataPaint([[.42, .27, .15], [.55, .36, .2], [.33, .2, .11], [.5, .32, .17]], {freq: 9}));
  const drops = [[0, .22, .05, .5, .44, .42], [.36, .14, -.18, .32, .3, .3], [-.32, .13, .2, .28, .26, .27]].map(([x, y, z, sx, sy, sz], i) => {
   const d = rockLump({detail: 2, sx, sy, sz, seed: seed + 7 + i, cuts: 2, strata: 9, rough: .12, bed: -.7}); d.translate(x, y, z);
   paint(d, (q, n, j, out) => { const k = .55 + .45 * Math.max(0, n.y); out[0] = 1 * k; out[1] = .55 * k; out[2] = .12 * k; }); return d; });
  sitOnFloorGroup([wood, ...drops], .26);
  return {parts: [[own(wood), stoneMat('amberWood', 0x3a1c06)], [own(mergeFlat(drops)), crystalMat('amber', 0xd2700f, [1, .8, .42])]]};
 }
 function depositKit(kind, variant) { const d = DEPOSIT[kind], st = d.style, seed = 1000 + kind.length * 131 + variant * 7919, r = rng(seed), lumps = [];
  const shape = d.shape || {iron: [.78, .5, .62, 0], mithril: [.5, .66, .44, .2], crystal: [.68, .56, .6, 0]}[kind];
  const main = rockLump({detail: 3, sx: shape[0], sy: shape[1], sz: shape[2], seed, cuts: st === 'geode' ? 3 : 5, strata: .16, rough: .3, bed: -.62}); main.rotateZ(shape[3]); main.translate(0, .32, 0); lumps.push(main);
  const side = rockLump({detail: 2, sx: .42, sy: .3, sz: .36, seed: seed + 1, cuts: 4, strata: .12, rough: .35}); side.rotateY(r() * 6); side.translate(.5 + r() * .15, .1, -.25 + r() * .2); lumps.push(side);
  const shelf = rockLump({detail: 2, sx: .32, sy: .24, sz: .4, seed: seed + 2, cuts: 4, strata: .1, rough: .35}); shelf.translate(-.48, .06, .3 - r() * .2); lumps.push(shelf);
  if (st === 'geode') { const p = main.attributes.position, n = new T.Vector3(.35, .5, .8).normalize(); // geode opening: cleave and hollow the front face
   for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i); const s = _v.clone().sub(new T.Vector3(0, .5, 0)).dot(n) - .32; if (s > 0) _v.addScaledVector(n, -s * 1.6); p.setXYZ(i, _v.x, _v.y, _v.z); } main.computeVertexNormals(); }
  // crystal roots on the main mass
  const crystals = [], roots = [];
  const sites = st === 'geode' ? surfacePoints(main, 14, seed + 5, (P, N) => N.dot(new T.Vector3(.35, .5, .8)) > .5 || (P.y > .7 && N.y > .4))
   : st === 'seam' ? surfacePoints(main, 10, seed + 5, (P, N) => Math.abs(P.x * .8 - P.y * .3 + P.z * .5 - .05) < .1 && N.y > -.1)
   : surfacePoints(main, 6, seed + 5, (P, N) => N.y > .55 && P.x < .15);
  sites.forEach(([P, N], i) => { const big = st === 'geode' ? (i < 6 ? 1 : .55) : st === 'seam' ? .8 : .5, lean = new T.Vector3(r() - .5, .7, r() - .5).multiplyScalar(.6);
   crystals.push(prism({base: P.clone().addScaledVector(N, -.06), dir: N.clone().add(lean), len: (.35 + r() * .35) * big + (st === 'seam' ? .15 : 0), rad: (st === 'seam' ? .035 : .07) * big * (.8 + r() * .4), sides: st === 'seam' ? 4 : 6, seed: seed + 40 + i, broken: r() < .3, tint: d.crystal, flat: st === 'seam' ? .45 : 1}));
   roots.push(P); });
  // ore matrix: ferric nodules (iron), silver nuggets along the seam (mithril), druzy lining (crystal)
  const ore = [], orePts = st === 'geode' ? surfacePoints(main, 22, seed + 9, (P, N) => N.dot(new T.Vector3(.35, .5, .8)) > .6)
   : surfacePoints(main, d.oreCount || (st === 'nodule' ? 11 : 8), seed + 9, st === 'nodule' ? (P, N) => Math.abs(P.y - .25 - P.x * .35) < .12 : (P, N) => Math.abs(P.x * .8 - P.y * .3 + P.z * .5 - .05) < .14);
  orePts.forEach(([P, N], i) => { let g;
   if (st === 'geode') g = prism({base: P.clone().addScaledVector(N, -.01), dir: N, len: .05 + r() * .05, rad: .02, sides: 3, seed: seed + 70 + i});
   else { const k = d.oreSize || 1; g = rockLump({detail: 1, sx: (.06 + r() * .05) * k, sy: .05 * k, sz: (.06 + r() * .04) * k, seed: seed + 90 + i, cuts: 3, rough: .3, bed: -2}); g.lookAt(N); g.translate(P.x - N.x * .015, P.y - N.y * .015, P.z - N.z * .015); }
   ore.push(g); });
  const rust = {color: d.rust, at: p => st === 'nodule' ? 1 - Math.abs(p.y - .25 - p.x * .35) * 5 + (fbm(p.x * 6, p.y * 6, p.z * 6) - .5) : st === 'seam' ? 1 - Math.abs(p.x * .8 - p.y * .3 + p.z * .5 - .05) * 7 : 0};
  for (const g of lumps) paint(g, strataPaint(d.bands, {freq: 6.5, rust}));
  const rock = mergeFlat(lumps), crys = mergeFlat(crystals), oreG = mergeFlat(ore);
  paint(oreG, (p, n, i, out) => { const k = .7 + .3 * Math.max(0, n.y); out[0] = out[1] = out[2] = k; });
  // baked crystal bounce into uv.y (fake nearby glow; no lights)
  const rp = rock.attributes.position, uv = rock.attributes.uv; for (let i = 0; i < rp.count; i++) { _v.fromBufferAttribute(rp, i); let gl = 0; for (const R of roots) gl += Math.exp(-_v.distanceToSquared(R) / .045); uv.setY(i, Math.min(1, gl * .6)); uv.setX(i, 0); }
  sitOnFloorGroup([rock, crys, oreG], 1.2); for (const g of [rock, crys, oreG]) g.translate(0, -.05, 0); // bed sinks 5 cm into terrain
  return [[own(rock), stoneMat('deposit:' + kind, d.bounce), 'Rock'], [own(oreG), metalMat('ore:' + kind, d.ore, d.oreMetal, d.oreRough, .18), 'Ore'], [own(crys), crystalMat('deposit:' + kind, d.emissive, [.9, .95, 1]), 'Crystal']];
 }
 function build(parts, name) { const root = new T.Group(); root.name = name; const host = new T.Group(); host.name = name + 'Art'; root.add(host);
  for (const [g, m, n] of parts) { const mesh = new T.Mesh(g, m); mesh.name = n || m.name; mesh.castShadow = mesh.receiveShadow = true; host.add(mesh); } return root; }
 return {
  pickup(kind) { if (!PICKUP_KINDS.includes(kind)) return null; let kit = pickups.get(kind);
   if (!kit) { kit = kind.endsWith('Ore') ? orePickup(kind) : kind === 'crystal' ? crystalPickup() : kind === 'amber' ? amberPickup() : ingotPickup(kind); pickups.set(kind, kit); }
   const g = build(kit.parts, 'Pickup:' + kind); g.userData.authoredPickup = true; g.userData.resourceArt = kind; return g; },
  barStack(kind, count) { if (!METAL[kind]) return null; const n = Math.max(1, Math.min(BAR_STACK_MAX, count | 0)), k = 'stack:' + kind + ':' + n; let kit = pickups.get(k);
   if (!kit) { kit = barStackKit(kind, n); pickups.set(k, kit); }
   const g = build(kit.parts, 'BarStack:' + kind); g.userData.authoredPickup = true; g.userData.resourceArt = kind; g.userData.barStack = n; return g; },
  deposit(kind, {variant = 0} = {}) { const k = DEPOSIT_ALIAS[kind]; if (!k) return null; const key = k + ':' + (variant % 3); let kit = deposits.get(key);
   if (!kit) { kit = depositKit(k, variant % 3); deposits.set(key, kit); } const g = build(kit, 'Deposit:' + k); g.userData.authoredDeposit = true; g.userData.resourceArt = k; return g; },
  update(seconds) { if (Number.isFinite(seconds)) time.value = seconds; },
  stats() { let tris = 0; for (const g of geos) tris += g.attributes.position.count / 3; return {geometries: geos.size, materials: mats.size, triangles: tris}; },
  dispose() { for (const g of geos) g.dispose(); for (const m of mats.values()) m.dispose(); geos.clear(); mats.clear(); pickups.clear(); deposits.clear(); }
 };
}

// ---------- tree template enhancement ----------
const treeCache = new WeakMap(); // source geometry -> enhanced geometry (shared by every tree / batch)
const firstMesh = n => { let m = null; n?.traverse(c => { if (!m && c.isMesh) m = c; }); return m; };
const triCount = g => (g.index ? g.index.count : g.attributes.position.count) / 3;
function appendTo(src, add) { // keep every source vertex/index exactly; append new vertices/triangles with matching attributes
 const g = new T.BufferGeometry(), n0 = src.attributes.position.count, nAdd = add.position.length / 3;
 for (const [name, a] of Object.entries(src.attributes)) { const arr = new Float32Array((n0 + nAdd) * a.itemSize);
  for (let i = 0; i < n0; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.getComponent(i, c);
  const extra = add[name]; if (extra) arr.set(extra, n0 * a.itemSize); else if (name === 'color') arr.fill(1, n0 * a.itemSize);
  g.setAttribute(name, new T.BufferAttribute(arr, a.itemSize)); }
 const srcIdx = src.index ? Array.from(src.index.array) : Array.from({length: n0}, (_, i) => i);
 const idx = srcIdx.concat(add.index.map(i => i + n0)); g.setIndex(n0 + nAdd > 65535 ? new T.Uint32BufferAttribute(idx, 1) : new T.Uint16BufferAttribute(idx, 1));
 for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
 if (src.groups.length) g.groups[g.groups.length - 1].count = Infinity;
 g.name = (src.name || 'tree') + ':forest'; g.userData = {...src.userData, forestEnhanced: true, sourceTriangles: triCount(src)};
 g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}
function sampler(g, i) { const a = g.attributes; return {uv: a.uv ? [a.uv.getX(i), a.uv.getY(i)] : [0, 0], color: a.color ? [a.color.getX(i), a.color.getY(i), a.color.getZ(i)] : [1, 1, 1]}; }
function makeAdd() { return {position: [], normal: [], uv: [], color: [], index: [], v(p, n, uv, c) { this.position.push(p.x, p.y, p.z); this.normal.push(n.x, n.y, n.z); this.uv.push(uv[0], uv[1]); this.color.push(c[0], c[1], c[2]); return this.position.length / 3 - 1; }}; }
const finishAdd = a => ({position: new Float32Array(a.position), normal: new Float32Array(a.normal), uv: new Float32Array(a.uv), color: new Float32Array(a.color), index: a.index});
export const TREE_STYLES = Object.freeze({
 broad: {leaflets: 5, size: .2, droop: -.05, up: .25, spread: .9, twigBias: .2},   // oak-like scalloped crown
 weeping: {leaflets: 7, size: .17, droop: .55, up: -.45, spread: .7, twigBias: -.3}, // pendulous sprays (tree_b)
 upright: {leaflets: 3, size: .15, droop: -.2, up: .6, spread: .6, twigBias: .5}      // tufted young tree
});
function inferStyle(root, trunk, leaves) { const tb = new T.Box3().setFromBufferAttribute(trunk.geometry.attributes.position), lb = new T.Box3().setFromBufferAttribute(leaves.geometry.attributes.position);
 const tr = (tb.max.x - tb.min.x) / 2, c = lb.getCenter(new T.Vector3()); if (tr < .3) return 'upright'; return Math.hypot(c.x, c.z) > .4 ? 'weeping' : 'broad'; }

/** Merge authored-style detail into a tree template once. Returns {style, before, after, added}. */
export function enhanceTreeTemplate(scene, {lod = false, variant = null} = {}) {
 const root = scene?.getObjectByName?.('Tree') || scene; if (!root) return null;
 if (root.userData?.authoredFoliage) return null; // rebuilt species kits (assets/trees-canopy-20261004) carry their own sprays
 const mesh = n => firstMesh(root.getObjectByName(n)), trunk = mesh('Trunk'), leaves = mesh('Leaves'), branches = mesh('Branches'), roots = mesh('Roots');
 if (!trunk || !leaves) return null;
 if (leaves.geometry.userData.forestEnhanced) return leaves.geometry.userData.forestReport || null;
 const style = typeof variant === 'string' && TREE_STYLES[variant] ? variant : inferStyle(root, trunk, leaves), S = TREE_STYLES[style];
 const all = [trunk, leaves, branches, roots, mesh('Fruit')].filter(Boolean), before = all.reduce((s, m) => s + triCount(m.geometry), 0);
 const budget = Math.floor(before * (lod ? .08 : .24)), seed = Math.round(before * 7 + leaves.geometry.attributes.position.count);
 const lb = new T.Box3().setFromBufferAttribute(leaves.geometry.attributes.position), C = lb.getCenter(new T.Vector3()), E = lb.getSize(new T.Vector3()).multiplyScalar(.5);
 const crownR = Math.max(E.x, E.z), scale = crownR / 2.6, r = rng(seed);
 const outward = p => new T.Vector3((p.x - C.x) / E.x, (p.y - C.y) / E.y, (p.z - C.z) / E.z);
 const report = {style, lod, before, added: {}, after: before};
 const enhance = (m, fn) => { if (!m) return; let g = treeCache.get(m.geometry); if (!g) { const add = makeAdd(); fn(m.geometry, add); g = appendTo(m.geometry, finishAdd(add)); treeCache.set(m.geometry, g); }
  report.added[m.parent?.name === root.name ? m.name : (m.parent?.name || m.name)] = triCount(g) - g.userData.sourceTriangles; m.geometry = g; };
 // Leaves: paired leaf sprays on the outer shell -> fine silhouette scallops, no alpha.
 enhance(leaves, (g, add) => { const p = g.attributes.position, n = g.attributes.normal, per = S.leaflets * 2, count = Math.floor(budget * (lod ? 1 : .6) / per);
  const P = new T.Vector3(), N = new T.Vector3(); let made = 0;
  for (let t = 0; made < count && t < count * 40; t++) { const i = Math.floor(r() * p.count); P.fromBufferAttribute(p, i); N.fromBufferAttribute(n, i); const o = outward(P), ol = o.length();
   if (ol < .72 || N.dot(o.clone().normalize()) < .15) continue; made++;
   const smp = sampler(g, i), dir = N.clone().multiplyScalar(.6).add(o.normalize().multiplyScalar(.5)).add(new T.Vector3(0, S.up, 0)).normalize();
   const side = new T.Vector3().crossVectors(dir, Math.abs(dir.y) > .9 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0)).normalize().applyAxisAngle(dir, r() * 3);
   const len = S.size * scale * (lod ? 2.2 : 1) * (.8 + r() * .4), stemLen = len * 1.3;
   for (let k = 0; k < S.leaflets; k++) { const tip = k === S.leaflets - 1, along = tip ? stemLen : stemLen * (Math.floor(k / 2) + 1) / (Math.ceil(S.leaflets / 2) + .5), sgn = tip ? 0 : (k % 2 ? 1 : -1);
    const base = P.clone().addScaledVector(N, -.03).addScaledVector(dir, along).addScaledVector(new T.Vector3(0, -1, 0), S.droop * along * along / Math.max(.01, stemLen));
    const ldir = dir.clone().multiplyScalar(tip ? 1 : .45).addScaledVector(side, sgn * S.spread).add(new T.Vector3(0, -S.droop * .6, 0)).normalize();
    const w = new T.Vector3().crossVectors(ldir, N).normalize(), l = len * (tip ? 1.1 : .9), fold = N.clone().multiplyScalar(l * .12);
    const nn = N.clone().lerp(ldir.clone().cross(w).normalize().multiplyScalar(Math.sign(ldir.clone().cross(w).dot(N)) || 1), .35).normalize();
    const shade = .9 + r() * .2, ct = [smp.color[0] * shade, smp.color[1] * shade, smp.color[2] * shade], cTip = [ct[0] * 1.12, ct[1] * 1.12, ct[2] * 1.05];
    const a = add.v(base, nn, smp.uv, ct), b = add.v(base.clone().addScaledVector(ldir, l * .45).addScaledVector(w, l * .24), nn, smp.uv, ct),
     c = add.v(base.clone().addScaledVector(ldir, l).add(fold), nn, smp.uv, cTip), d = add.v(base.clone().addScaledVector(ldir, l * .45).addScaledVector(w, -l * .24).add(fold), nn, smp.uv, ct);
    add.index.push(a, b, c, a, c, d); } } });
 if (!lod) {
  // Branches: tapered forking twigs reaching from limb ends into the crown edge.
  enhance(branches, (g, add) => { const p = g.attributes.position, n = g.attributes.normal, count = Math.floor(budget * .25 / 18), P = new T.Vector3(), N = new T.Vector3(); let made = 0;
   const twig = (s, dir, len, rad, smp) => { const up = Math.abs(dir.y) > .9 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0), A = new T.Vector3().crossVectors(dir, up).normalize(), B = new T.Vector3().crossVectors(dir, A);
    const ringAt = (c, rr) => [0, 1, 2].map(k => { const a = k / 3 * Math.PI * 2, o = A.clone().multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a)); return add.v(c.clone().addScaledVector(o, rr), o, smp.uv, smp.color); });
    const mid = s.clone().addScaledVector(dir, len * .55).add(new T.Vector3(0, S.twigBias * len * .15, 0)), end = s.clone().addScaledVector(dir, len).add(new T.Vector3(0, S.twigBias * len * .3, 0));
    const r0 = ringAt(s, rad), r1 = ringAt(mid, rad * .55), tip = add.v(end, dir, smp.uv, smp.color);
    for (let k = 0; k < 3; k++) { const j = (k + 1) % 3; add.index.push(r0[k], r0[j], r1[j], r0[k], r1[j], r1[k], r1[k], r1[j], tip); } return mid; };
   for (let t = 0; made < count && t < count * 40; t++) { const i = Math.floor(r() * p.count); P.fromBufferAttribute(p, i); N.fromBufferAttribute(n, i); const o = outward(P);
    if (Math.hypot(o.x, o.z) < .45 || P.y < C.y - E.y * .9) continue; made++; const smp = sampler(g, i);
    const dir = o.clone().setY(o.y * .5 + S.twigBias * .5).normalize().lerp(N, .3).normalize(), len = (.35 + r() * .3) * scale;
    const mid = twig(P.clone().addScaledVector(N, -.01), dir, len, .022 * scale, smp);
    twig(mid, dir.clone().applyAxisAngle(new T.Vector3(0, 1, 0), (r() > .5 ? 1 : -1) * .7).add(new T.Vector3(0, .2, 0)).normalize(), len * .55, .012 * scale, smp); } });
  // Roots: buttress flares that blend the trunk into the soil (below 0.6 m; trunk notch at ~1 m untouched).
  enhance(roots, (g, add) => { const tp = trunk.geometry.attributes.position; let tr = 0, cnt = 0, cx = 0, cz = 0;
   for (let i = 0; i < tp.count; i++) if (tp.getY(i) < .3) { cx += tp.getX(i); cz += tp.getZ(i); cnt++; } cx /= cnt || 1; cz /= cnt || 1;
   for (let i = 0; i < tp.count; i++) if (tp.getY(i) < .3) tr = Math.max(tr, Math.hypot(tp.getX(i) - cx, tp.getZ(i) - cz));
   const rp = g.attributes.position; let best = 0, bd = Infinity; for (let i = 0; i < rp.count; i++) { const d = Math.hypot(rp.getX(i) - cx, rp.getZ(i) - cz) + Math.abs(rp.getY(i) - .15); if (d < bd) { bd = d; best = i; } }
   const smp = sampler(g, best), flares = style === 'upright' ? 4 : style === 'weeping' ? 5 : 6, seg = 4;
   for (let f = 0; f < flares; f++) { const a = f / flares * Math.PI * 2 + r() * .5, D = new T.Vector3(Math.cos(a), 0, Math.sin(a)), Sd = new T.Vector3(-D.z, 0, D.x), reach = tr * (1.1 + r() * .6), hgt = tr * (1.1 + r() * .5);
    const rings = []; for (let s = 0; s <= seg; s++) { const t = s / seg, rad = tr * .82 + reach * t, y = Math.max(-.05, hgt * (1 - t) * (1 - t)), w = tr * (.45 - .3 * t), c = new T.Vector3(cx, 0, cz).addScaledVector(D, rad);
     const ridge = c.clone().setY(y + .02), L = c.clone().addScaledVector(Sd, w).setY(Math.max(-.08, y * .25 - .05)), R = c.clone().addScaledVector(Sd, -w).setY(Math.max(-.08, y * .25 - .05));
     const up = D.clone().multiplyScalar(.5).add(new T.Vector3(0, 1, 0)).normalize();
     rings.push([add.v(L, Sd.clone().add(up).normalize(), smp.uv, smp.color), add.v(ridge, up, smp.uv, smp.color), add.v(R, Sd.clone().negate().add(up).normalize(), smp.uv, smp.color)]); }
    for (let s = 0; s < seg; s++) { const [a0, b0, c0] = rings[s], [a1, b1, c1] = rings[s + 1]; add.index.push(a0, b0, b1, a0, b1, a1, b0, c0, c1, b0, c1, b1); } } });
 }
 report.after = all.reduce((s, m) => s + triCount(m.geometry), 0); leaves.geometry.userData.forestReport = report; return report;
}
