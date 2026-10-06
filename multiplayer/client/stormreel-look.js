// Stormreel look: the two poles' palette, the red and blue/black crossbow finishes, and the small procedural textures
// and pooled primitives (soft ribbons, bead points) the electrical presentation draws with. Nothing here touches gameplay.
// Red is the positive (+) pole, blue the negative (-) one (shared/stormreel.js POLARITY).
import * as THREE from 'three';

/** Per-pole colours: `glow` for sprites and sparks, `hot` for the white-hot centre, `hue` multiplies a lightning arc. */
export const POLE = Object.freeze({
  red: Object.freeze({name: 'Positive', sign: '+', glow: 0xff5a3a, hot: 0xffc2a6, deep: 0xb3261a, hue: new THREE.Color(1, .46, .34)}),
  blue: Object.freeze({name: 'Negative', sign: '−', glow: 0x4aa8ff, hot: 0xcfe9ff, deep: 0x1f4fb0, hue: new THREE.Color(.46, .72, 1)}),
});
export const MIXED_HUE = new THREE.Color(1, .86, 1);

// ---- crossbow finishes -----------------------------------------------------------------------------------------
// The glb is authored in the neutral kit palette; each pole gets its own clones of the materials it recolours. Red: crimson
// lacquered steel, bone-white bands, red glass cores. Blue/black: blackened steel, electric-blue bands, blue cores.
const FINISH = {
  red: {Steel: {color: 0x8a211b, roughness: .34, metalness: .55}, PlateSteel: {color: 0x5e1812, roughness: .3, metalness: .7}, Hazard: {color: 0xf1e4cf},
    CeramicBlue: {color: 0xd8463a}, Charge: {color: 0xff7a50, emissive: 0xff3a14}, Cable: {color: 0xd8402e}, Fletch: {color: 0xd8402e}, Gold: {color: 0xe3b04e}},
  blue: {Steel: {color: 0x12151b, roughness: .3, metalness: .85}, PlateSteel: {color: 0x1b2230, roughness: .26, metalness: .85}, Hazard: {color: 0x2f74e0, roughness: .4},
    CeramicBlue: {color: 0x3a74d8}, Charge: {color: 0x59b4ff, emissive: 0x1f8fff}, Cable: {color: 0x2f74e0}, Fletch: {color: 0x2f74e0}, Gold: {color: 0x8fb8f0}},
};
const finished = new Map();
/** Recolour a Stormreel crossbow (or a bolt) for a pole, in place. Safe to call every frame: it only works on a change. */
export function finishCrossbow(root, pole) {
  if (!root || root.userData.pole === pole || !FINISH[pole]) return root;
  root.userData.pole = pole;
  root.traverse(n => {
    if (!n.isMesh) return;
    const list = [n.material].flat(), out = list.map(m => {
      const f = FINISH[pole][m?.name]; if (!f) return m;
      const base = m.userData.baseMaterial || m, key = `${base.uuid}:${pole}`;
      if (!finished.has(key)) {
        const c = base.clone(); c.userData.baseMaterial = base;
        if (f.color !== undefined) c.color.setHex(f.color);
        if (f.emissive !== undefined) c.emissive.setHex(f.emissive);
        if (f.roughness !== undefined) c.roughness = f.roughness;
        if (f.metalness !== undefined) c.metalness = f.metalness;
        finished.set(key, c);
      }
      return finished.get(key);
    });
    n.material = Array.isArray(n.material) ? out : out[0];
  });
  return root;
}

// ---- procedural textures ---------------------------------------------------------------------------------------
const canvasOf = size => { if (typeof document === 'undefined') return null; const c = document.createElement('canvas'); c.width = c.height = size; return c; };
const finish = c => { if (!c) return null; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
function rng(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ s >>> 15, 2246822519) + 374761393 >>> 0) / 4294967296); }

/** A soft round glow. */
export function softTexture() {
  const c = canvasOf(64); if (!c) return null; const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.25, 'rgba(255,255,255,.55)'); r.addColorStop(.6, 'rgba(255,255,255,.12)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64); return finish(c);
}
/** A flaring corona: a hot core with uneven rays, like a probe tip crackling in the open air. */
export function coronaTexture(seed = 7) {
  const c = canvasOf(128); if (!c) return null; const g = c.getContext('2d'), R = rng(seed);
  g.translate(64, 64); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 11; i++) {
    const a = R() * Math.PI * 2, len = 26 + R() * 36, w = 1.4 + R() * 2.4, gr = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.strokeStyle = gr; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * len, Math.sin(a) * len); g.stroke();
  }
  const r = g.createRadialGradient(0, 0, 0, 0, 0, 30); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.3, 'rgba(255,255,255,.5)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(-64, -64, 128, 128); return finish(c);
}
/** A glowing ring with a plus or minus in it: the polarity badge that floats over a lodged probe and marks each terminal. */
export function glyphTexture(pole) {
  const c = canvasOf(128); if (!c) return null; const g = c.getContext('2d'), P = POLE[pole], css = '#' + new THREE.Color(P.glow).getHexString(), hot = '#' + new THREE.Color(P.hot).getHexString();
  g.translate(64, 64);
  const halo = g.createRadialGradient(0, 0, 18, 0, 0, 62); halo.addColorStop(0, css + 'aa'); halo.addColorStop(1, css + '00'); g.fillStyle = halo; g.fillRect(-64, -64, 128, 128);
  g.strokeStyle = css; g.lineWidth = 7; g.beginPath(); g.arc(0, 0, 38, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = hot; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 38, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = hot; g.lineCap = 'round'; g.lineWidth = 9; g.beginPath(); g.moveTo(-18, 0); g.lineTo(18, 0); if (pole === 'red') { g.moveTo(0, -18); g.lineTo(0, 18); } g.stroke();
  return finish(c);
}
/** Across a ribbon: transparent edge, soft glow, hot core. */
export function ribbonTexture() {
  const w = 2, h = 32, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const d = Math.abs(y / (h - 1) - .5) * 2, core = Math.max(0, 1 - d / .3) ** 1.5, glow = Math.max(0, 1 - d) ** 2, a = Math.min(1, glow * .6 + core);
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = 255 * a; }
  }
  const t = new THREE.DataTexture(data, w, h); t.needsUpdate = true; t.magFilter = t.minFilter = THREE.LinearFilter; return t;
}

// ---- pooled primitives -----------------------------------------------------------------------------------------
/**
 * Camera-facing ribbons through a list of points, additive, with per-point colour (so current can run along them as
 * bright pulses). One mesh per ribbon; geometry is rewritten every frame from the points the caller passes in.
 */
export function createRibbon(scene, texture, {capacity = 32, order = 12} = {}) {
  const pos = new Float32Array(capacity * 2 * 3), uv = new Float32Array(capacity * 2 * 2), col = new Float32Array(capacity * 2 * 3), idx = [];
  for (let i = 0; i < capacity - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage)); geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({map: texture, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false});
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = order; mesh.raycast = () => {}; mesh.userData.ignoreContact = true; mesh.visible = false;
  scene.add(mesh);
  const t = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Vector3();
  return {
    mesh,
    /** points: Vector3[]; width(i, u) metres; colour(i, u, out) writes rgb into out (a Color). */
    update(points, cam, width, colour) {
      const n = Math.min(points.length, capacity); if (n < 2) { mesh.visible = false; return; }
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)], p = points[i], u = i / (n - 1);
        t.subVectors(b, a); e.subVectors(cam, p); s.crossVectors(t, e); const l = s.length(); if (l < 1e-6) s.set(0, 1, 0); else s.multiplyScalar(1 / l);
        const w = typeof width === 'function' ? width(i, u) : width; s.multiplyScalar(w);
        pos[i * 6] = p.x + s.x; pos[i * 6 + 1] = p.y + s.y; pos[i * 6 + 2] = p.z + s.z; pos[i * 6 + 3] = p.x - s.x; pos[i * 6 + 4] = p.y - s.y; pos[i * 6 + 5] = p.z - s.z;
        uv[i * 4] = u; uv[i * 4 + 1] = 0; uv[i * 4 + 2] = u; uv[i * 4 + 3] = 1;
        colour(i, u, c); for (let k = 0; k < 2; k++) { col[i * 6 + k * 3] = c.r; col[i * 6 + k * 3 + 1] = c.g; col[i * 6 + k * 3 + 2] = c.b; }
      }
      geo.setDrawRange(0, (n - 1) * 6); geo.attributes.position.needsUpdate = geo.attributes.uv.needsUpdate = geo.attributes.color.needsUpdate = true; mesh.visible = true;
    },
    hide() { mesh.visible = false; },
    dispose() { mesh.removeFromParent(); geo.dispose(); mat.dispose(); },
  };
}

/** One Points object that draws every travelling bead (current carriers, drifting motes) in a handful of vertices per frame. */
export function createBeads(scene, texture, {capacity = 160, size = .16} = {}) {
  const pos = new Float32Array(capacity * 3), col = new Float32Array(capacity * 3), geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.PointsMaterial({size, map: texture, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false});
  const points = new THREE.Points(geo, mat); points.frustumCulled = false; points.renderOrder = 13; points.raycast = () => {}; points.userData.ignoreContact = true; points.visible = false; scene.add(points);
  let n = 0;
  return {
    begin() { n = 0; },
    add(p, c, k = 1) { if (n >= capacity) return; pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z; col[n * 3] = c.r * k; col[n * 3 + 1] = c.g * k; col[n * 3 + 2] = c.b * k; n++; },
    end() { geo.setDrawRange(0, n); points.visible = n > 0; if (n) { geo.attributes.position.needsUpdate = geo.attributes.color.needsUpdate = true; } },
    count: () => n,
    dispose() { points.removeFromParent(); geo.dispose(); mat.dispose(); },
  };
}

/** A pooled additive billboard (Sprite) with a colour and a scale: for coronas, polarity badges and flares. */
export function makeSprite(scene, texture, colour, order = 14) {
  const m = new THREE.SpriteMaterial({map: texture, color: colour, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false});
  const s = new THREE.Sprite(m); s.renderOrder = order; s.raycast = () => {}; s.userData.ignoreContact = true; scene.add(s); return s;
}

/** Point along a polyline by arc length u in 0..1 (points Vector3[]), written into out. */
export function along(points, u, out) {
  const n = points.length - 1, f = Math.min(Math.max(u, 0), 1) * n, i = Math.min(n - 1, Math.floor(f));
  return out.lerpVectors(points[i], points[i + 1], f - i);
}
/** A noise-shaped flicker in 0..1: two incommensurate sines, so it never settles into a rhythm. */
export const flicker = (t, seed = 0) => .5 + .5 * Math.sin(t * 37.1 + seed) * Math.sin(t * 23.7 + seed * 1.7) * Math.sin(t * 9.3 + seed * .3 + 1);
