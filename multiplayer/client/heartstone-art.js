// Heartstone art: the God side's living geode heart (structure type 'influence'; rules in shared/heartstone.js).
// A geode split open like an egg, gripped by old roots, lined with blue-violet crystal, with a green-gold heart crystal
// floating over the hollow. A ring of wildflowers round its foot grows in as the world's Bloom rises, and a soft ring
// of light breathes on the ground while it is mending Heroes. +Y up, metres, base at y = 0; footprint radius ~1.3.
// Geometries and materials are built once and shared by every Heartstone: five draws each, no lights or textures.
import * as THREE from 'three';
import {rng, noise3, finish, mergeGeometries, crystalPointGeometry} from './sanctuary-art.js';

export const HEART_Y = 1.95;
const FLOWERS = 44;
let A = null;

const key = v => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
// Merge geometries that already carry baked colours (finish()), keeping position, normal and colour.
function mergeColored(list) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const arrays = list.map(g => g.attributes[name].array), n = arrays.reduce((t, a) => t + a.length, 0), buf = new Float32Array(n);
    let o = 0; for (const a of arrays) { buf.set(a, o); o += a.length; }
    out.setAttribute(name, new THREE.BufferAttribute(buf, 3));
  }
  list.forEach(g => g.dispose());
  return out;
}

// Split geode shell: an open, jagged-rimmed cup (outer crust, inner crystal lining) plus roots gripping it.
function shellGeometry() {
  const g = new THREE.CylinderGeometry(1, 0.7, 1.35, 24, 9, true), p = g.attributes.position, v = new THREE.Vector3(), cache = new Map();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); const k = key(v); let out = cache.get(k);
    if (!out) {
      const a = Math.atan2(v.z, v.x), t = (v.y + 0.675) / 1.35, bulge = Math.sin(t * Math.PI) * 0.28, n = noise3(v.x * 2.5, v.y * 2.5, v.z * 2.5, 71) - 0.5;
      const rim = t > 0.99 ? (Math.abs(Math.sin(a * 3.5)) * 0.45 + n * 0.5) * (0.6 + 0.4 * Math.cos(a - 0.6)) : 0; // jagged, higher at the back
      const s = 1 + bulge + n * 0.18; out = [v.x * s, v.y + 0.675 + rim - (1 - t) * 0.05, v.z * s]; cache.set(k, out);
    }
    p.setXYZ(i, ...out);
  }
  const outer = g.clone(), inner = g; inner.scale(-0.84, 0.97, 0.84); // mirrored: faces the hollow
  const floor = new THREE.CircleGeometry(0.62, 12); floor.rotateX(-Math.PI / 2); floor.translate(0, 0.35, 0);
  const crust = finish(outer, (col, x, y, z) => {
    const n = noise3(x * 3, y * 3, z * 3, 75), v = 0.62 + n * 0.3; col.setRGB(v, v * 0.97, v * 0.9);
    if (y < 0.3) col.lerp(new THREE.Color(0x5d6a3e), (0.3 - y) * 2.5);
    if (y > 1.25) col.lerp(new THREE.Color(0xd8d2c4), 0.4); // pale broken edge
    const seam = Math.abs(noise3(x * 2.8, y * 2.8, z * 2.8, 76) - 0.5); // glowing cracks where the heart's light leaks out
    if (seam < 0.06 && y > 0.25) col.lerp(new THREE.Color(seam < 0.025 ? 0x9dffc9 : 0x3f8f6a), 0.9 - seam * 8);
  });
  const lining = finish(mergeGeometries([inner, floor]), (col, x, y, z) => {
    const n = noise3(x * 4, y * 4, z * 4, 77); col.setHex(0x4a3fa8).lerp(new THREE.Color(0x8fd8ff), Math.max(0, n - 0.4) * 1.6);
  });
  // Roots: tubes from the shell's flank arching down into the turf.
  const r = rng(73), roots = [];
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2 + r() * 0.5, c = Math.cos(a), s = Math.sin(a), lift = 0.75 + r() * 0.35, out = 1.55 + r() * 0.35;
    const curve = new THREE.CatmullRomCurve3([[0.9, lift + 0.25, 0.05], [1.22, lift, 0.12], [1.38, 0.35, 0.05], [out, -0.15, -0.1]].map(([x, y, z]) => new THREE.Vector3(x * c - z * s, y, x * s + z * c)));
    const tube = new THREE.TubeGeometry(curve, 10, 1, 6, false), tp = tube.attributes.position, rad = 0.09 + r() * 0.05;
    // taper: thick where it grips the shell, thin where it dives into the turf
    for (let i = 0; i < tp.count; i++) { const t = Math.floor(i / 7) / 10, ctr = curve.getPointAt(Math.min(1, t)), w = rad * (1.25 - t * 0.7); tp.setXYZ(i, ctr.x + (tp.getX(i) - ctr.x) * w, ctr.y + (tp.getY(i) - ctr.y) * w, ctr.z + (tp.getZ(i) - ctr.z) * w); }
    roots.push(tube);
  }
  const wood = finish(mergeGeometries(roots), (col, x, y, z, ny) => {
    const n = noise3(x * 5, y * 5, z * 5, 74), v = 0.55 + n * 0.25; col.setRGB(v * 0.78, v * 0.6, v * 0.42);
    if (ny > 0.5 && n > 0.45) col.lerp(new THREE.Color(0x6e8a3a), 0.6); // moss on top of the roots
  });
  const shell = mergeColored([crust, lining, wood]); shell.translate(0, -0.22, 0); return shell; // set into the turf
}

// Crystal points lining the hollow, leaning inward and up.
function liningGeometry() {
  const r = rng(79), parts = [];
  for (let k = 0; k < 14; k++) {
    const a = k / 14 * Math.PI * 2 + r() * 0.3, d = 0.45 + r() * 0.2, len = 0.3 + r() * 0.35;
    const g = crystalPointGeometry(len, 0.07 + r() * 0.04); g.rotateZ(0.55 + r() * 0.35); g.rotateY(-a + Math.PI); g.translate(Math.cos(a) * d, 0.4 + r() * 0.3, Math.sin(a) * d);
    parts.push(g);
  }
  const g = mergeGeometries(parts); g.computeVertexNormals(); return g;
}

// The heart: a doubled crystal (two points base to base), long axis up.
function heartGeometry() {
  const up = crystalPointGeometry(0.55, 0.2), down = crystalPointGeometry(0.4, 0.2); down.rotateX(Math.PI);
  const g = mergeGeometries([up, down]); g.computeVertexNormals(); return g;
}

// Wildflower ring: stems with five-lobed blossoms, each tagged with its grow order and foot so Bloom can grow them in.
function flowerGeometry() {
  const r = rng(83), parts = [], idx = [], base = [], col = [];
  const palette = [0xf6c1d6, 0xfff1c4, 0xb9d8ff, 0xf7e36a, 0xe9a7f2, 0xffffff].map(h => new THREE.Color(h));
  const order = Array.from({length: FLOWERS}, (_, i) => i).sort(() => r() - 0.5); // grow-in order spread round the ring
  for (let i = 0; i < FLOWERS; i++) {
    const a = i / FLOWERS * Math.PI * 2 + r() * 0.12, d = 1.55 + r() * 1.5, x = Math.cos(a) * d, z = Math.sin(a) * d, h = 0.18 + r() * 0.22;
    const stem = new THREE.CylinderGeometry(0.012, 0.016, h, 3, 1, true); stem.translate(0, h / 2, 0);
    const bloom = new THREE.CircleGeometry(0.075 + r() * 0.04, 10), bp = bloom.attributes.position;
    for (let k = 1; k < bp.count; k++) { const bx = bp.getX(k), by = bp.getY(k), ang = Math.atan2(by, bx), s = 0.7 + 0.3 * Math.abs(Math.cos(ang * 2.5)); bp.setXY(k, bx * s, by * s); }
    bloom.rotateX(-Math.PI / 2 + (r() - 0.5) * 0.6); bloom.translate(0, h, 0);
    const heart = new THREE.CircleGeometry(0.025, 5); heart.rotateX(-Math.PI / 2); heart.translate(0, h + 0.004, 0);
    const c = palette[Math.floor(r() * palette.length)], stemC = new THREE.Color(0x4f7a2e), dot = new THREE.Color(0xf2b233);
    for (const [g, cc] of [[stem, stemC], [bloom, c], [heart, dot]]) {
      g.rotateY(r() * 6); g.translate(x, 0, z); const flat = g.index ? g.toNonIndexed() : g; parts.push(flat);
      for (let k = 0; k < flat.attributes.position.count; k++) { idx.push(order[i]); base.push(x, 0, z); col.push(cc.r, cc.g, cc.b); }
      if (flat !== g) g.dispose();
    }
  }
  const g = mergeGeometries(parts); g.computeVertexNormals();
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aOrder', new THREE.Float32BufferAttribute(idx, 1));
  g.setAttribute('aBase', new THREE.Float32BufferAttribute(base, 3));
  return g;
}

function flowerMaterial() {
  const uCount = {value: 0};
  const m = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, flatShading: true});
  m.onBeforeCompile = s => {
    s.uniforms.uCount = uCount;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aOrder;\nattribute vec3 aBase;\nuniform float uCount;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat gr=clamp(uCount-aOrder,0.,1.);transformed=aBase+(transformed-aBase)*gr;');
  };
  m.customProgramCacheKey = () => 'heartstone-flowers-v1';
  return {material: m, uCount};
}

function ringMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {uTime: {value: 0}}, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `uniform float uTime;varying vec2 vUv;
      void main(){float r=length(vUv*2.-1.);float wave=fract(r*1.5-uTime*.45);
        float a=smoothstep(1.,.9,r)*smoothstep(.2,.35,r)*(.03+.32*pow(wave,8.));if(a<.004)discard;
        gl_FragColor=vec4(vec3(.45,1.1,.7)*a,a);}`,
  });
}

function assets() {
  if (A) return A;
  const flowers = flowerMaterial();
  A = {
    shell: shellGeometry(), lining: liningGeometry(), heart: heartGeometry(), flowers: flowerGeometry(), ring: new THREE.PlaneGeometry(12, 12),
    stone: new THREE.MeshStandardMaterial({color: 0x9a958a, vertexColors: true, roughness: 0.92, flatShading: true}),
    crystal: new THREE.MeshStandardMaterial({color: 0x8fdcff, emissive: 0x2b6fd0, emissiveIntensity: 0.9, roughness: 0.15, flatShading: true}),
    heartMat: new THREE.MeshStandardMaterial({color: 0x9effc8, emissive: 0x22c070, emissiveIntensity: 1.9, roughness: 0.1, flatShading: true, transparent: true, opacity: 0.94}),
    flowerMat: flowers.material, uCount: flowers.uCount, ringMat: ringMaterial(),
  };
  A.ring.rotateX(-Math.PI / 2);
  return A;
}

/** Build one Heartstone into root; returns the live parts for animateHeartstone. */
export function buildHeartstone(root) {
  const a = assets(), mesh = (g, m, shadow = true) => { const o = new THREE.Mesh(g, m); o.castShadow = shadow; o.receiveShadow = true; root.add(o); return o; };
  mesh(a.shell, a.stone); mesh(a.lining, a.crystal); mesh(a.flowers, a.flowerMat, false);
  const heart = mesh(a.heart, a.heartMat); heart.position.y = HEART_Y;
  const ring = mesh(a.ring, a.ringMat, false); ring.position.y = 0.06; ring.receiveShadow = false; ring.visible = false; ring.renderOrder = 4; ring.raycast = () => {};
  return {heart, ring};
}

/** Per frame. bloom: world Bloom points; damage 0..1; active: hp > 0; mending: a Hero of its side is in reach. */
export function animateHeartstone(P, {time = 0, bloom = 0, damage = 0, active = true, mending = false} = {}) {
  const a = assets();
  a.uCount.value = 4 + (FLOWERS - 4) * Math.min(1, bloom / 180); // shared by every Heartstone: Bloom is world-wide
  a.ringMat.uniforms.uTime.value = time;
  const beat = Math.pow(Math.max(0, Math.sin(time * 2.2)), 8) * (active ? 1 : 0);
  P.heart.visible = active || damage < 1;
  P.heart.position.y = active ? HEART_Y + Math.sin(time * 0.9) * 0.08 : 0.75; // a broken heart sinks into the hollow
  P.heart.rotation.set(active ? Math.sin(time * 0.5) * 0.06 + damage * 0.2 : 0.9, time * (active ? 0.5 : 0.05), 0);
  P.heart.scale.setScalar((active ? 1 : 0.7) * (1 + beat * 0.12));
  P.ring.visible = active && mending;
}

export function disposeHeartstoneArt() {
  if (!A) return;
  for (const k of ['shell', 'lining', 'heart', 'flowers', 'ring', 'stone', 'crystal', 'heartMat', 'flowerMat', 'ringMat']) A[k].dispose();
  A = null;
}
