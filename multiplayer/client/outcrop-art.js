// Crystal Outcrop art (presentation only; collision stays the footprints in shared/starting-layout.json).
// Geode boulders whose weathered crust splits along violet-blue seams, crystal clusters that crack, glow and regrow
// (one live draw, per-cluster growth and glow uniforms), and a working-looking mine head: braced timber frame, pulley
// wheel and rope over a shaft, and a plank ore cart on spoked wheels.
import * as THREE from 'three';
import {rng, noise3, finish, mergeGeometries, crystalPointGeometry} from './sanctuary-art.js';

const key = v => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;

// Lumpy geode boulder: displaced icosphere, flattened base, crust tones with glowing-looking seams of amethyst blue.
export function geodeBoulderGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position, v = new THREE.Vector3(), cache = new Map();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); const k = key(v);
    let out = cache.get(k);
    if (!out) {
      const n = noise3(v.x * 1.6, v.y * 1.6, v.z * 1.6, seed) - 0.5, m = noise3(v.x * 4, v.y * 4, v.z * 4, seed + 3) - 0.5;
      const s = 1 + n * 0.38 + m * 0.12; out = [v.x * s, Math.max(-0.35, v.y) * s, v.z * s]; cache.set(k, out);
    }
    p.setXYZ(i, ...out);
  }
  return finish(g, (c, x, y, z, ny) => {
    const n = noise3(x * 2.1, y * 2.1, z * 2.1, seed + 7), seam = Math.abs(noise3(x * 3.2, y * 3.2, z * 3.2, seed + 11) - 0.5);
    const v = 0.72 + n * 0.3 + Math.max(0, ny) * 0.12; c.setRGB(v * 1.02, v * 0.97, v * 0.9);
    if (seam < 0.075 && y > -0.2) c.lerp(new THREE.Color(seam < 0.03 ? 0x8fd8ff : 0x5a4fc0), 0.9 - seam * 6); // crust split along a seam
    if (y < -0.2) c.lerp(new THREE.Color(0x5d6a3e), 0.35);
  });
}

// One live mesh for every cluster: per-vertex cluster index and base point, so the shader can shrink a broken cluster
// to a stub and regrow it, and brighten it as it cracks.
export function clusterGeometry(clusters, seed = 202) {
  const r = rng(seed), parts = [], cl = [], base = [];
  clusters.forEach(({x, y, z, size}, index) => {
    const n = 4 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const len = k === 0 ? size * (0.95 + r() * 0.25) : size * (0.5 + r() * 0.6), rad = 0.1 * size * (0.8 + r() * 0.5);
      const g = crystalPointGeometry(len, rad), tilt = k === 0 ? (r() - 0.5) * 0.2 : 0.35 + r() * 0.5, yaw = (k / n) * Math.PI * 2 + r() * 0.6;
      const off = k === 0 ? 0 : size * 0.12;
      g.rotateZ(tilt); g.rotateY(yaw); g.translate(x + Math.cos(yaw) * off, y, z - Math.sin(yaw) * off);
      parts.push(g);
      for (let i = 0; i < g.attributes.position.count; i++) { cl.push(index); base.push(x, y, z); }
    }
  });
  const geo = mergeGeometries(parts); geo.computeVertexNormals();
  geo.setAttribute('aCluster', new THREE.Float32BufferAttribute(cl, 1));
  geo.setAttribute('aBase', new THREE.Float32BufferAttribute(base, 3));
  geo.computeBoundingSphere();
  return geo;
}

// Crystal material with per-cluster growth (0..1) and glow (0..1, cracks and flashes) uniforms.
export function clusterMaterial(count) {
  const uGrow = {value: new Array(count).fill(1)}, uGlow = {value: new Array(count).fill(0)};
  const m = new THREE.MeshStandardMaterial({color: 0x6fd4ff, emissive: 0x1d86c9, emissiveIntensity: 1.1, roughness: 0.15, metalness: 0.05,
    flatShading: true, transparent: true, opacity: 0.92});
  m.onBeforeCompile = s => {
    s.uniforms.uGrow = uGrow; s.uniforms.uGlow = uGlow;
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>\nattribute float aCluster;\nattribute vec3 aBase;\nuniform float uGrow[${count}];\nuniform float uGlow[${count}];\nvarying float vGlow;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nint ci=int(aCluster+.5);float gr=1.,gl=0.;for(int k=0;k<${count};k++)if(k==ci){gr=uGrow[k];gl=uGlow[k];}\ntransformed=aBase+(transformed-aBase)*gr;vGlow=gl;`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance*=1.+vGlow*3.5;diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.75,.95,1.),vGlow*.5);');
  };
  m.customProgramCacheKey = () => 'outcrop-cluster-v1-' + count;
  return {material: m, uGrow, uGlow};
}

// Geode cup round each cluster's root: a broken crust ring that stays when the crystals are mined out.
export function cupGeometry(seed) {
  const g = new THREE.CylinderGeometry(1, 0.75, 0.5, 9, 1, true), p = g.attributes.position, v = new THREE.Vector3(), cache = new Map();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); const k = key(v);
    let out = cache.get(k);
    if (!out) { const n = noise3(v.x * 3, 0, v.z * 3, seed); out = [v.x * (1 + (n - 0.5) * 0.3), v.y > 0 ? v.y + (n - 0.5) * 0.35 : v.y, v.z * (1 + (n - 0.5) * 0.3)]; cache.set(k, out); }
    p.setXYZ(i, ...out);
  }
  const outer = g.clone(), inner = g; inner.scale(-0.86, 0.95, 0.86); // mirrored: faces the hollow
  const geo = mergeGeometries([outer, inner]);
  return finish(geo, (c, x, y, z) => { const r = Math.hypot(x, z), n = noise3(x * 4, y * 4, z * 4, seed + 1);
    const v = 0.7 + n * 0.25; c.setRGB(v, v * 0.96, v * 0.92); if (r < 0.88) c.lerp(new THREE.Color(0x4a4590), 0.6); });
}

// Planked timber: a box with plank grooves baked into the colour, grain along its long axis.
export function timberGeometry(w, h, d, seed, planks = 0) {
  const g = new THREE.BoxGeometry(w, h, d, Math.max(1, planks), 1, 1);
  const long = w >= h && w >= d ? 'x' : h >= d ? 'y' : 'z';
  return finish(g, (c, x, y, z) => {
    const a = {x, y, z}[long], n = noise3(a * 0.8, (x + y + z) * 9, 0, seed), grain = Math.sin(a * 2 + n * 6) * 0.5 + 0.5;
    const v = 0.8 + grain * 0.15 + (n - 0.5) * 0.2; c.setRGB(v, v * 0.92, v * 0.85);
    if (planks && Math.abs(((x / w + 0.5) * planks) % 1 - 0.5) > 0.46) c.multiplyScalar(0.6); // plank seams
  });
}

// Spoked cart/pulley wheel in the XY plane: rim, hub and spokes (timber), plus a bronze tyre (separate geometry).
export function wheelGeometries(radius, width, spokes = 6) {
  const rim = new THREE.TorusGeometry(radius * 0.88, radius * 0.1, 5, 16), hub = new THREE.CylinderGeometry(radius * 0.18, radius * 0.18, width, 8);
  hub.rotateX(Math.PI / 2);
  const parts = [rim, hub];
  for (let i = 0; i < spokes; i++) { const s = new THREE.BoxGeometry(radius * 0.08, radius * 0.8, width * 0.4); s.translate(0, radius * 0.44, 0); s.rotateZ(i / spokes * Math.PI * 2); parts.push(s); }
  const wood = finish(mergeGeometries(parts), c => c.setRGB(0.85, 0.78, 0.7));
  const tyre = finish(new THREE.TorusGeometry(radius, radius * 0.06, 4, 20), (c, x, y, z) => { const v = 0.8 + noise3(x * 9, y * 9, z * 9, 5) * 0.3; c.setRGB(v, v * 0.95, v * 0.85); });
  return {wood, tyre};
}
