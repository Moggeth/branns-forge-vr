// Ancient Stone Sanctuary art (presentation only; collision stays the footprints in shared/starting-layout.json).
// Hewn menhirs with carved resonance runes, a trilithon whose lintel is split by a geode seam, a bronze resonance hoop
// hung in the gateway, and a geode altar holding a floating tuning crystal.
// Static pieces return plain geometries (position, normal, color) that starting-world.js merges per material.
// Live pieces (hoop, tuning crystal, rune glow) are one small group: 4 draws, no lights, no textures, no shadows cast
// by the glow. Runes carry a per-vertex stone index so one material can light each stone separately (setLit).
import * as THREE from 'three';

export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Position-keyed hash noise: coincident vertices on different box faces get identical offsets (no cracks).
function hash3(x, y, z, seed) {
  const q = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.19) * 43758.5453;
  return q - Math.floor(q);
}
export function noise3(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const s = t => t * t * (3 - 2 * t), u = s(fx), v = s(fy), w = s(fz);
  const h = (a, b, c) => hash3(ix + a, iy + b, iz + c, seed);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(h(0, 0, 0), h(1, 0, 0), u), l(h(0, 1, 0), h(1, 1, 0), u), v),
    l(l(h(0, 0, 1), h(1, 0, 1), u), l(h(0, 1, 1), h(1, 1, 1), u), v), w);
}
const key = v => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;

// Bake a per-vertex colour from world-ish height and noise. Non-indexed so flat shading reads as chisel facets.
export function finish(g, tint) {
  const geo = g.index ? g.toNonIndexed() : g; if (geo !== g) g.dispose();
  geo.computeVertexNormals();
  const pos = geo.attributes.position, nor = geo.attributes.normal, col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { tint(c.setRGB(1, 1, 1), pos.getX(i), pos.getY(i), pos.getZ(i), nor.getY(i)); c.toArray(col, i * 3); }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// Weathered stone tone: damp darker foot, lighter wind-scoured crown, ochre and pale lichen blooms on up-facing faces.
function stoneTint(seed, h) {
  return (c, x, y, z, ny) => {
    const t = Math.min(1, Math.max(0, y / h)), n = noise3(x * 2.3, y * 2.3, z * 2.3, seed), m = noise3(x * 6, y * 6, z * 6, seed + 7);
    const strata = Math.sin(y * 9 + noise3(x * 1.5, y, z * 1.5, seed + 1) * 5) * 0.5 + 0.5; // faint bedding planes
    const v = 0.7 + t * 0.26 + (n - 0.5) * 0.34 + (m - 0.5) * 0.14 - strata * 0.07;
    const warm = noise3(x * 1.2 + 4, y * 0.8, z * 1.2, seed + 13); // iron-stained vs blue-grey stones
    c.setRGB(v * (0.98 + warm * 0.08), v * (0.97 + warm * 0.02), v * (1.0 - warm * 0.1));
    const lichen = noise3(x * 3.1 + 9, y * 3.1, z * 3.1, seed + 3);
    if (lichen > 0.68 && ny > -0.3) c.lerp(new THREE.Color(lichen > 0.8 ? 0xd9c27a : 0xb9c79a), Math.min(0.75, (lichen - 0.68) * 4));
    if (t < 0.16) c.lerp(new THREE.Color(0x5d6a3e), (0.16 - t) * 3.2); // grass stain at the foot
  };
}

// Hewn menhir: tapered, chamfered, slightly bowed and twisted, with a tilted wind-worn crown. Origin at the foot centre.
export function menhirGeometry(seed, {w = 0.9, h = 3, d = 0.55, taper = 0.7, crown = 0.22, rough = 0.1} = {}) {
  const r = rng(seed), bend = (r() - 0.5) * 0.16, twist = (r() - 0.5) * 0.3, tilt = (r() - 0.5) * 0.9;
  const g = new THREE.BoxGeometry(1, 1, 1, 3, 9, 2), pos = g.attributes.position, v = new THREE.Vector3(), cache = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i); const k = key(v);
    let out = cache.get(k);
    if (!out) {
      const t = v.y + 0.5, ax = Math.abs(v.x) * 2, az = Math.abs(v.z) * 2;
      let sx = w * (1 - (1 - taper) * t) * (1 + Math.sin(t * Math.PI) * 0.06), sz = d * (1 - (1 - taper * 1.05) * t);
      if (ax > 0.99 && az > 0.99) { sx *= 0.84; sz *= 0.8; } // chamfered arrises
      let x = v.x * sx, z = v.z * sz, y = t * h;
      if (t > 0.999) y -= crown * h * 0.22 * (Math.max(ax, az) ** 2) + tilt * v.x * w * 0.35; // rounded, tilted crown
      const n = noise3(x * 2.2, y * 1.6, z * 2.2, seed) - 0.5, m = noise3(x * 5, y * 4, z * 5, seed + 11) - 0.5;
      const push = (n * 1.0 + m * 0.45) * rough * (t < 0.02 ? 0.3 : 1);
      const len = Math.hypot(v.x, v.z) || 1; x += v.x / len * push; z += v.z / len * push;
      const a = twist * t; [x, z] = [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];
      x += bend * t * t * h * 0.35;
      out = [x, y, z]; cache.set(k, out);
    }
    pos.setXYZ(i, ...out);
  }
  // Inner (-Z) face frame at rune height, following the same taper, twist and bend, for carving a rune onto.
  const t = Math.min(0.62, 1.55 / h), a = twist * t, fz = -(d * (1 - (1 - taper * 1.05) * t)) / 2 - 0.03;
  const geo = finish(g, stoneTint(seed, h));
  geo.userData.face = {x: -fz * Math.sin(a) + bend * t * t * h * 0.35, y: t * h, z: fz * Math.cos(a), rotY: Math.PI - a};
  return geo;
}

// Rough lintel with a shallow sag; the underside is split by a geode seam (crystals added separately).
export function lintelGeometry(seed, {w = 1.0, h = 0.62, len = 3.5} = {}) {
  const g = new THREE.BoxGeometry(1, 1, 1, 2, 2, 10), pos = g.attributes.position, v = new THREE.Vector3(), cache = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i); const k = key(v);
    let out = cache.get(k);
    if (!out) {
      const ends = Math.abs(v.z) * 2, ax = Math.abs(v.x) * 2, ay = Math.abs(v.y) * 2;
      let x = v.x * w * (ax > 0.99 && ay > 0.99 ? 0.86 : 1), y = v.y * h * (ends > 0.99 ? 0.9 : 1), z = v.z * len;
      y -= (1 - (v.z * 2) ** 2) * 0.07; // sag
      if (v.y < 0 && Math.abs(v.x) < 0.01 && Math.abs(v.z) < 0.4) y += 0.12; // the seam: underside splits upward
      const n = noise3(x * 2.4, y * 2.4, z * 1.4, seed) - 0.5, m = noise3(x * 6, y * 6, z * 5, seed + 5) - 0.5;
      x += Math.sign(v.x) * (n + m * 0.4) * 0.07; y += Math.sign(v.y) * (n * 0.5 + m * 0.3) * 0.06;
      out = [x, y, z]; cache.set(k, out);
    }
    pos.setXYZ(i, ...out);
  }
  return finish(g, stoneTint(seed, h * 2));
}

// Irregular moss cushion: a flattened, lumpy icosahedron with a light-to-deep green gradient.
export function mossGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1), pos = g.attributes.position, v = new THREE.Vector3(), cache = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i); const k = key(v);
    let out = cache.get(k);
    if (!out) { const n = 0.75 + noise3(v.x * 2.5, v.y * 2.5, v.z * 2.5, seed) * 0.5; out = [v.x * n, Math.max(-0.15, v.y) * n, v.z * n]; cache.set(k, out); }
    pos.setXYZ(i, ...out);
  }
  return finish(g, (c, x, y, z) => { const n = noise3(x * 4, y * 4, z * 4, seed + 2); c.setRGB(0.85 + n * 0.35, 0.95 + n * 0.25, 0.8 + n * 0.2); if (y < 0.05) c.multiplyScalar(0.72); });
}

// Stepped octagonal altar drum with a carved band and a geode crust bowl on top. Origin at the foot centre.
export function altarGeometry(seed) {
  const parts = [];
  const ring = (r0, r1, y0, y1, sides = 8, jag = 0, open = false, inward = false) => {
    const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, sides, 2, open), p = g.attributes.position, v = new THREE.Vector3(), cache = new Map();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); const k = key(v);
      let out = cache.get(k);
      if (!out) { const n = noise3(v.x * 3 + y0, v.y * 3, v.z * 3, seed) - 0.5; let y = v.y + (y0 + y1) / 2;
        if (jag && v.y > 0) y += (noise3(v.x * 7, 0, v.z * 7, seed + 9) - 0.5) * jag;
        out = [v.x * (1 + n * 0.08), y, v.z * (1 + n * 0.08)]; cache.set(k, out); }
      p.setXYZ(i, ...out);
    }
    if (inward) g.scale(-1, 1, 1); // mirrored winding faces the bowl's interior
    parts.push(g);
  };
  ring(1.4, 1.3, 0, 0.26);             // plinth step
  ring(1.12, 1.04, 0.26, 0.42);        // second step
  ring(0.9, 0.84, 0.42, 0.95, 8);      // drum
  ring(0.94, 1.0, 0.95, 1.06, 8, 0, true); // cap moulding (open: the bowl sits inside)
  ring(1.0, 0.9, 1.06, 1.3, 11, 0.24, true); // geode crust rim, broken top edge
  ring(0.84, 0.74, 1.06, 1.26, 11, 0.18, true, true); // inner wall of the crust
  const dish = new THREE.CylinderGeometry(0.76, 0.2, 0.32, 11, 1, true); dish.translate(0, 0.98, 0); dish.scale(-1, 1, 1); parts.push(dish); // sunken bowl
  const lip = new THREE.RingGeometry(0.74, 0.92, 11, 1); lip.rotateX(-Math.PI / 2); lip.translate(0, 1.27, 0); parts.push(lip);
  const merged = mergeGeometries(parts);
  return finish(merged, (c, x, y, z, ny) => {
    const n = noise3(x * 3, y * 3, z * 3, seed);
    const r = Math.hypot(x, z), v = 0.78 + n * 0.24; c.setRGB(v, v * 0.98, v * 0.94);
    if (y > 1.04 && r > 0.88) c.lerp(new THREE.Color(0x5a5560), 0.5); // weathered crust outside
    if (y > 0.8 && r < 0.88) c.lerp(new THREE.Color(0x3d4f7a), 0.65 - (r / 0.88) * 0.25); // amethyst-blue geode lining
    if (Math.abs(y - 0.7) < 0.12 && r > 0.8) c.multiplyScalar(0.82); // carved band round the drum
    if (y < 0.3) c.lerp(new THREE.Color(0x5d6a3e), 0.35);
  });
}

// Simple non-indexed merge (positions + normals; colours baked later by finish()).
export function mergeGeometries(list) {
  const flat = list.map(g => g.index ? g.toNonIndexed() : g);
  let n = 0; for (const g of flat) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3); let o = 0;
  for (const g of flat) { pos.set(g.attributes.position.array, o); o += g.attributes.position.array.length; }
  for (const g of new Set([...list, ...flat])) g.dispose();
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return out;
}

// Crystal point (hexagonal prism with a pyramidal tip), origin at its base, pointing +Y.
export function crystalPointGeometry(len = 1, rad = 0.12) {
  const prism = new THREE.CylinderGeometry(rad, rad * 1.1, len * 0.75, 6, 1); prism.translate(0, len * 0.375, 0);
  const tip = new THREE.ConeGeometry(rad, len * 0.25, 6, 1); tip.translate(0, len * 0.875, 0);
  const g = mergeGeometries([prism, tip]); g.computeVertexNormals(); return g;
}

// Carved rune: angular strokes (staves and twigs) as thin boxes, laid on a plane facing +Z at origin.
const GLYPHS = [
  [[0, -0.5, 0, 0.5], [0, 0.1, 0.3, 0.4], [0, -0.1, 0.3, 0.2]],
  [[0, -0.5, 0, 0.5], [0, 0.5, 0.32, 0.18], [0.32, 0.18, 0, -0.1]],
  [[-0.2, -0.5, -0.2, 0.5], [0.2, -0.5, 0.2, 0.5], [-0.2, 0.25, 0.2, -0.05]],
  [[0, -0.5, 0, 0.5], [-0.28, 0.35, 0.28, 0.05], [0.28, 0.35, -0.28, 0.05]],
  [[0, -0.5, 0, 0.5], [0, 0.45, 0.28, 0.15], [0, 0.15, 0.28, -0.15], [0, -0.15, -0.28, -0.42]],
  [[-0.25, -0.5, 0.25, 0.5], [0.25, -0.5, -0.25, 0.5], [-0.25, 0, 0.25, 0]],
  [[0, -0.5, 0, 0.5], [-0.3, 0.5, 0, 0.2], [0.3, 0.5, 0, 0.2], [-0.2, -0.25, 0.2, -0.25]],
  [[-0.22, 0.5, 0.22, 0.1], [0.22, 0.1, -0.22, -0.3], [-0.22, -0.3, 0.22, -0.5], [0, 0.5, 0, -0.5]],
];
export function runeGeometry(index, scale = 0.62, stroke = 0.055, segs = 1) {
  const strokes = GLYPHS[index % GLYPHS.length], parts = [];
  for (const [x0, y0, x1, y1] of strokes) {
    const len = Math.hypot(x1 - x0, y1 - y0) * scale, b = new THREE.BoxGeometry(stroke, len + stroke * 0.6, 0.012, 1, segs, 1);
    b.rotateZ(-Math.atan2(x1 - x0, y1 - y0)); b.translate((x0 + x1) / 2 * scale, (y0 + y1) / 2 * scale, 0); parts.push(b);
  }
  return mergeGeometries(parts);
}

// Rune material: carved grooves when dormant, resonance blue when lit. aStone selects the uLit slot (0..11).
export function runeMaterial() {
  const uLit = {value: new Array(12).fill(0)}, uTime = {value: 0};
  const m = new THREE.MeshBasicMaterial({color: 0xffffff, toneMapped: false});
  m.onBeforeCompile = s => {
    s.uniforms.uLit = uLit; s.uniforms.uTime = uTime;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aStone;\nuniform float uLit[12];\nuniform float uTime;\nvarying float vLit;\nvarying float vPulse;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nint si=int(aStone+.5);float lit=0.;for(int k=0;k<12;k++)if(k==si)lit=uLit[k];vLit=lit;vPulse=.5+.5*sin(uTime*2.4+aStone*1.7+position.y*3.);');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vLit;\nvarying float vPulse;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec3 dormant=mix(vec3(.07,.075,.085),vec3(.08,.16,.24),vPulse*.45);vec3 glow=vec3(.45,.9,1.25)*(1.1+.35*vPulse);vec4 diffuseColor=vec4(mix(dormant,glow,vLit),opacity);');
  };
  m.customProgramCacheKey = () => 'sanctuary-rune-v1';
  return {material: m, uLit, uTime};
}

// Glow material for crystals that should read as lit from within without a light: emissive, fresnel-brightened rim.
export function crystalMaterial() {
  return new THREE.MeshStandardMaterial({color: 0x6fd4ff, emissive: 0x1d86c9, emissiveIntensity: 1.15, roughness: 0.15,
    metalness: 0.05, flatShading: true, transparent: true, opacity: 0.9});
}
// Bronze without an environment map: lower metalness keeps it warm and readable instead of flat brown.
export function bronzeMaterial() {
  return new THREE.MeshStandardMaterial({color: 0xc9924a, roughness: 0.42, metalness: 0.45, flatShading: true, vertexColors: true});
}

// Resonance hoop: a bronze ring with a crystal inlay band, eight studs and a hanging yoke. Origin at the hoop centre.
export function hoopGeometries(R = 0.62) {
  const ring = new THREE.TorusGeometry(R, 0.075, 6, 28), lip = new THREE.TorusGeometry(R + 0.08, 0.025, 4, 28), inner = new THREE.TorusGeometry(R - 0.07, 0.022, 4, 28);
  const studs = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, s = new THREE.OctahedronGeometry(0.06, 0); s.scale(1, 1.6, 1); s.rotateZ(-a); s.translate(Math.sin(a) * (R + 0.1), Math.cos(a) * (R + 0.1), 0); studs.push(s); }
  const chains = [];
  for (const side of [-1, 1]) for (let k = 0; k < 4; k++) { const l = new THREE.TorusGeometry(0.055, 0.014, 4, 8); if (k % 2) l.rotateY(Math.PI / 2); l.translate(0, R + 0.16 + k * 0.1, side * 0.0 + 0); l.translate(side * 0.22, 0, 0); chains.push(l); }
  const bronze = mergeGeometries([ring, lip, ...chains]); bronze.computeVertexNormals();
  const col = new Float32Array(bronze.attributes.position.count * 3); const p = bronze.attributes.position;
  for (let i = 0; i < p.count; i++) { const v = 0.85 + noise3(p.getX(i) * 9, p.getY(i) * 9, p.getZ(i) * 9, 4) * 0.3; col.set([v, v * 0.96, v * 0.86], i * 3); }
  bronze.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const glow = mergeGeometries([inner, ...studs]); glow.computeVertexNormals();
  return {bronze, glow};
}
