// Ruined Watch-Arch art (presentation only; collision stays the footprints in shared/starting-layout.json).
// A pointed ashlar arch whose left half still stands to the crown and whose right half lies in the grass, a coursed
// round watch-tower stump with a crystal vein running up its face, and a bronze fire basket on a tripod at the top
// where the beacon burns (shared/watch-beacon.js). An offering dish at the tower foot is where Crystal goes in.
// Static pieces return plain geometries (position, normal, color) that starting-world.js merges per material.
import * as THREE from 'three';
import {rng, noise3, finish, mergeGeometries} from './sanctuary-art.js';

// Dressed sandstone-grey ashlar: per-block tone, darker weathered joints, soot near the top, lichen on up faces.
function ashlarTint(seed, h, block = 0, ground = true) {
  const r = rng(seed * 31 + block), tone = 0.86 + r() * 0.16, warm = r();
  return (c, x, y, z, ny) => {
    const n = noise3(x * 3, y * 3, z * 3, seed), m = noise3(x * 9, y * 9, z * 9, seed + 5);
    const v = tone * (0.78 + (n - 0.5) * 0.22 + (m - 0.5) * 0.1);
    c.setRGB(v * (1.0 + warm * 0.06), v * (0.96 + warm * 0.02), v * (0.9 - warm * 0.04));
    const lichen = noise3(x * 2.6 + 3, y * 2.6, z * 2.6, seed + 9);
    if (ny > 0.4 && lichen > 0.55) c.lerp(new THREE.Color(0x8d9b5a), Math.min(0.7, (lichen - 0.55) * 3));
    else if (lichen > 0.74) c.lerp(new THREE.Color(0xd2bf7c), (lichen - 0.74) * 2.5);
    if (ground && y < 0.25) c.lerp(new THREE.Color(0x56603a), (0.25 - y) * 2.4); // grass stain
    if (h && y > h - 0.5) c.multiplyScalar(0.82 + (h - y) * 0.36); // weather on the broken top
  };
}

// One chamfered block (bevel by pulling the 8 corners in), slightly irregular. Origin at its centre.
function blockGeometry(w, h, d, seed, chip = 0.06, segs = 2) {
  const g = new THREE.BoxGeometry(w, h, d, segs, segs, segs), p = g.attributes.position, v = new THREE.Vector3(), r = rng(seed);
  const jitter = [r() - 0.5, r() - 0.5, r() - 0.5];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const ex = Math.abs(Math.abs(v.x) - w / 2) < 1e-4, ey = Math.abs(Math.abs(v.y) - h / 2) < 1e-4, ez = Math.abs(Math.abs(v.z) - d / 2) < 1e-4;
    const edges = ex + ey + ez, k = edges >= 2 ? chip * (edges === 3 ? 1.4 : 1) : 0;
    if (k) v.multiplyScalar(1 - k / Math.max(w, h, d) * 1.6);
    const n = noise3(v.x * 5 + jitter[0] * 9, v.y * 5, v.z * 5, seed) - 0.5;
    p.setXYZ(i, v.x + n * 0.03, v.y + n * 0.02, v.z + n * 0.03);
  }
  return g;
}

// Coursed ashlar pier: stacked blocks with staggered joints, an impost cap; origin at the foot centre.
export function pierGeometry(seed, {w = 1.1, h = 4.6, d = 1.0, course = 0.46, broken = false} = {}) {
  const r = rng(seed), parts = [], n = Math.round(h / course);
  for (let k = 0; k < n; k++) {
    const y = (k + 0.5) * (h / n), ch = h / n * 0.97, ragged = broken && k === n - 1;
    const split = k % 2 ? 0.42 + r() * 0.16 : 0, last = broken && k >= n - 2 ? 0.8 + r() * 0.15 : 1;
    if (split) { // two blocks side by side on alternate courses, joints staggered
      const a = blockGeometry(w * split - 0.012, ch, d * last, seed + k * 7); a.translate(-w / 2 + w * split / 2, y, 0); parts.push(a);
      if (!ragged || r() > 0.4) { const b = blockGeometry(w * (1 - split) - 0.012, ch * (ragged ? 0.6 : 1), d * last, seed + k * 7 + 3); b.translate(w / 2 - w * (1 - split) / 2, y - (ragged ? ch * 0.2 : 0), 0); parts.push(b); }
    } else { const b = blockGeometry(w, ragged ? ch * 0.65 : ch, d * last, seed + k * 7); b.rotateY((r() - 0.5) * 0.04); b.translate((r() - 0.5) * 0.03, y - (ragged ? ch * 0.17 : 0), 0); parts.push(b); }
  }
  if (!broken) { const cap = blockGeometry(w * 1.18, 0.24, d * 1.14, seed + 99, 0.04); cap.translate(0, h + 0.12, 0); parts.push(cap); }
  return finish(mergeGeometries(parts), ashlarTint(seed, broken ? h : 0));
}

// Arch voussoir: a ring-sector block between angles a0..a1 (radians) on a circle centred at the origin, in the XY plane,
// depth along Z. Radial joints, so a set of them reads as a true pointed arch.
export function voussoirGeometry(seed, inner, outer, a0, a1, depth) {
  const g = new THREE.BoxGeometry(1, 1, 1, 2, 1, 1), p = g.attributes.position, v = new THREE.Vector3(), gap = 0.012;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = a0 + gap + (a1 - a0 - gap * 2) * (v.x + 0.5), rad = inner + (outer - inner) * (v.y + 0.5), n = noise3(v.x * 4, v.y * 4, v.z * 4, seed) - 0.5;
    p.setXYZ(i, Math.cos(a) * rad + n * 0.03, Math.sin(a) * rad + n * 0.03, v.z * depth * (1 - Math.abs(v.y) * 0.04));
  }
  return finish(g, ashlarTint(seed, 0, 0, false));
}

// Round watch-tower stump: rings of dressed blocks round a rubble core, its top courses robbed out; origin at the foot.
export function towerGeometry(seed, {r: radius = 1.6, h = 3.2, course = 0.4, per = 13} = {}) {
  const r = rng(seed), parts = [], n = Math.round(h / course);
  for (let k = 0; k < n; k++) {
    const y = (k + 0.5) * (h / n), ch = h / n * 0.96, off = k % 2 ? 0.5 : 0;
    for (let j = 0; j < per; j++) {
      if (k >= n - 2 && r() < (k === n - 1 ? 0.45 : 0.15)) continue; // robbed-out stones at the top
      const a = (j + off) / per * Math.PI * 2, len = 2 * Math.PI * radius / per * 0.97, b = blockGeometry(len, ch, 0.46, seed + k * 41 + j, 0, 1);
      b.translate(0, 0, radius - 0.23); b.rotateY(a); b.translate(0, y, 0); parts.push(b);
    }
  }
  const core = new THREE.CylinderGeometry(radius - 0.4, radius - 0.4, h - 0.25, 10, 1); core.translate(0, (h - 0.25) / 2, 0); parts.push(core);
  // Two arrow slits: dark recessed stones on the watch faces (north and west).
  const base = ashlarTint(seed, h);
  return finish(mergeGeometries(parts), (c, x, y, z, ny) => {
    base(c, x, y, z, ny);
    const a = Math.atan2(z, x), slit = y > 1.3 && y < 2.4 && Math.hypot(x, z) > radius - 0.05 && (Math.abs(a + Math.PI / 2) < 0.07 || Math.abs(Math.abs(a) - Math.PI) < 0.07);
    if (slit) c.multiplyScalar(0.18);
    if (Math.hypot(x, z) < radius - 0.3 && y > h - 0.4) c.lerp(new THREE.Color(0x3b3a33), 0.6); // sooty rubble top
  });
}

// Bronze fire basket on a tripod: a lathe-turned bowl, three splayed legs, four strap bars arching over the fire.
// Origin at the tripod foot; the fire sits at y = BASKET.fire.
export const BASKET = Object.freeze({height: 0.95, fire: 1.05, radius: 0.62});
export function basketGeometry() {
  const R = BASKET.radius, parts = [];
  const profile = [[0.08, 0], [0.32, 0.04], [0.56, 0.16], [R, 0.34], [R + 0.05, 0.38], [R - 0.02, 0.4], [0.5, 0.2], [0.26, 0.08], [0.06, 0.06]].map(([x, y]) => new THREE.Vector2(x, y));
  const bowl = new THREE.LatheGeometry(profile, 14); bowl.translate(0, BASKET.height - 0.2, 0); parts.push(bowl);
  for (let i = 0; i < 3; i++) {
    const leg = new THREE.CylinderGeometry(0.035, 0.05, BASKET.height + 0.05, 5); leg.translate(0, (BASKET.height + 0.05) / 2, 0);
    leg.rotateZ(0.28); leg.translate(0.36, 0, 0); leg.rotateY(i / 3 * Math.PI * 2); parts.push(leg);
    const foot = new THREE.SphereGeometry(0.07, 6, 3); foot.translate(0.36 + Math.sin(0.28) * 0, 0.02, 0); foot.rotateY(i / 3 * Math.PI * 2); parts.push(foot);
  }
  const ring = new THREE.TorusGeometry(0.22, 0.03, 4, 12); ring.rotateX(Math.PI / 2); ring.translate(0, BASKET.height * 0.45, 0); parts.push(ring);
  for (let i = 0; i < 4; i++) { // strap bars: quarter arcs from the rim up to a crown ring
    const bar = new THREE.TorusGeometry(R * 0.78, 0.025, 4, 8, Math.PI * 0.42); bar.rotateZ(Math.PI * 0.06); bar.translate(-R * 0.78 + R + 0.02, BASKET.height + 0.18, 0);
    bar.rotateY(i / 4 * Math.PI * 2 + Math.PI / 4); parts.push(bar);
  }
  const crown = new THREE.TorusGeometry(0.19, 0.03, 4, 10); crown.rotateX(Math.PI / 2); crown.translate(0, BASKET.height + 0.66, 0); parts.push(crown);
  return finish(mergeGeometries(parts), (c, x, y, z) => {
    const n = noise3(x * 7, y * 7, z * 7, 17), v = 0.78 + n * 0.3; c.setRGB(v, v * 0.93, v * 0.8);
    if (noise3(x * 3 + 5, y * 3, z * 3, 23) > 0.66) c.lerp(new THREE.Color(0x4f9a86), 0.55); // verdigris
    if (y > BASKET.height + 0.1) c.multiplyScalar(0.7); // soot on the straps
  });
}

// Offering dish: a shallow bronze dish on a short stone plinth at the tower foot. Origin at the foot.
export function dishGeometry() {
  const dish = new THREE.LatheGeometry([[0.04, 0], [0.24, 0.02], [0.36, 0.08], [0.4, 0.12], [0.34, 0.1], [0.2, 0.05], [0.02, 0.04]].map(([x, y]) => new THREE.Vector2(x, y)), 12);
  dish.translate(0, 0.78, 0);
  return finish(dish, (c, x, y, z) => { const v = 0.85 + noise3(x * 8, y * 8, z * 8, 4) * 0.25; c.setRGB(v, v * 0.92, v * 0.78); });
}
export function plinthGeometry(seed) {
  const b = blockGeometry(0.5, 0.78, 0.5, seed, 0.05); b.translate(0, 0.39, 0);
  return finish(b, ashlarTint(seed, 0.78));
}
