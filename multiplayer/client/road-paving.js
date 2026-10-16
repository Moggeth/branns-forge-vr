// Laid stone roads: the main road from gate to gate (shared/keep-sites.js MAIN_ROAD) and the three footpaths out from
// the Forge to the landmarks (shared/starting-world.js STARTING_PATHS) are paved with hand-cut flagstones bedded in the
// worn dirt the ground shader already draws, with a kerb of smaller setts along each edge. The dirt shows through the
// joints and through a few stones lost to wear, so the road reads as old and walked, not as a fresh decal.
// - Presentation only: no collision, raycast targets, lights or shadow casters. Stones stand 4 cm proud of the ground.
// - Every stone sits on the caller's height(x, z) and tilts to the local slope; update() re-seats them after terrain
//   changes (craters, raised ground), so they ride the same surface the Hero walks on.
// - Deterministic from the route data alone: every peer and reload lays the same stones.
// - Budget: four instanced draws (three flagstone shapes and the kerb sett), ~1k stones, ~35k triangles.
import * as THREE from 'three';
import {MAIN_ROAD} from '../shared/keep-sites.js';
import {homePoint} from '../shared/home-bases.js';
import {STARTING_PATHS} from '../shared/starting-world.js';

export const ROAD_PAVING_VERSION = 1;
// [points, half width, wear]: wear is the share of stones a long life of boots has worn away (more on footpaths).
export function pavedRoutes() {
  return [
    {id: 'main', points: [homePoint('party', [0, 17.5]), ...MAIN_ROAD.points, homePoint('rivals', [0, 17.5])], half: 1.25, wear: .05, kerb: true},
    {id: 'forge-lane', points: [[6, -6], [2.6, -2.4]], half: .85, wear: .08, kerb: false},
    ...STARTING_PATHS.map(p => ({id: p.id, points: p.points, half: p.width / 2, wear: .14, kerb: false})),
  ];
}

/** How far (x, z) is outside the nearest laid route's edge (negative = on the stones). Ground scatter uses it. */
export function pavingClearance(x, z) {
  let best = Infinity;
  for (const {points: P, half} of pavedRoutes()) for (let i = 1; i < P.length; i++) {
    const [ax, az] = P[i - 1], [bx, bz] = P[i], dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t) - half);
  }
  return best;
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// One hand-cut flagstone: an irregular convex outline (unit square before scaling), a flat dished top, a
// chamfer and short sides that sink into the bedding. Separate rings per band so the chamfer catches light crisply.
// Vertex colour carries a baked occlusion: bright face, darker chamfer, near-black foot.
export function flagstoneGeometry(seed, {corners = 4, height = .1, chamfer = .045, sink = .08} = {}) {
  // A dressed block: a unit square (scaled to the stone's footprint) with its edges a touch out of true and `corners`
  // of its corners knocked off, so neighbours butt up with thin joints instead of leaving hex-shaped dirt gaps.
  const r = rng(seed), outline = [], hx = .5 - r() * .02, hz = .5 - r() * .02;
  const box = [[hx, hz], [-hx, hz], [-hx, -hz], [hx, -hz]].map(([x, z]) => [x + (r() - .5) * .03, z + (r() - .5) * .03]);
  box.forEach((p, i) => {
    const a = box[(i + 3) % 4], b = box[(i + 1) % 4];
    if (i >= corners) { outline.push(p); return; }
    const c = .05 + r() * .1, cut = q => { const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz); return [p[0] + dx * c / l, p[1] + dz * c / l]; };
    outline.push(cut(a), cut(b));
  });
  corners = outline.length;
  const pos = [], col = [], idx = [];
  const ring = (scale, y, shade, wobble = 0) => {
    const start = pos.length / 3;
    outline.forEach(([x, z], i) => { const w = wobble ? 1 + Math.sin(i * 2.3 + seed) * wobble : 1; pos.push(x * scale * w, y, z * scale * w); col.push(shade, shade, shade); });
    return start;
  };
  const band = (a, b) => { for (let i = 0; i < corners; i++) { const j = (i + 1) % corners; idx.push(a + i, b + j, b + i, a + i, a + j, b + j); } };
  // Top: a fan round a centre a few mm lower (worn dish), on its own ring so its normals stay up.
  const centre = pos.length / 3; pos.push(0, height - .006, 0); col.push(1, 1, 1);
  const top = ring(1 - chamfer * 1.6, height, .94);
  for (let i = 0; i < corners; i++) idx.push(centre, top + (i + 1) % corners, top + i);
  const bevelTop = ring(1 - chamfer * 1.6, height, .86), bevelFoot = ring(1, height - chamfer, .7, .012);
  band(bevelTop, bevelFoot);
  const sideTop = ring(1, height - chamfer, .7, .012), sideFoot = ring(1.04, -sink, .32, .012);
  band(sideTop, sideFoot);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// Stones laid along one route: courses across the road every ~0.62 m, each course split into stones of varied width
// with staggered joints; kerb setts along both edges of the main road. Returns [{x, z, yaw, w, d, kind, tint}].
export function layRoute(route, seed = 1) {
  const r = rng(seed), stones = [], P = route.points, half = route.half;
  const segs = [];
  let total = 0;
  for (let i = 1; i < P.length; i++) { const [ax, az] = P[i - 1], [bx, bz] = P[i], len = Math.hypot(bx - ax, bz - az); segs.push({ax, az, bx, bz, len, at: total}); total += len; }
  const at = s => { const g = segs.find(q => s <= q.at + q.len) || segs.at(-1), t = Math.min(1, Math.max(0, (s - g.at) / g.len)); return {x: g.ax + (g.bx - g.ax) * t, z: g.az + (g.bz - g.az) * t, dx: (g.bx - g.ax) / g.len, dz: (g.bz - g.az) / g.len}; };
  // Heading blended over a metre round each corner so courses fan round bends instead of overlapping in a wedge.
  const heading = s => { const a = at(Math.max(0, s - .6)), b = at(Math.min(total, s + .6)), dx = a.dx + b.dx, dz = a.dz + b.dz, l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  const course = .62, inner = half - (route.kerb ? .2 : 0);
  for (let s = course / 2, row = 0; s < total; s += course, row++) {
    const c = at(s), [dx, dz] = heading(s), nx = -dz, nz = dx, yaw = Math.atan2(dx, dz);
    // Split the course width [-inner, inner] into 2-4 stones, joints staggered from the course before.
    let u = -inner;
    const widths = [];
    while (u < inner - .05) { const w = Math.min(inner - u, .5 + r() * .38 + (row % 2 ? .12 : 0) * (u === -inner ? 1 : 0)); widths.push([u, w]); u += w; }
    for (const [u0, w] of widths) {
      if (r() < route.wear) continue; // worn away: the bedding shows
      const mid = u0 + w / 2 + (r() - .5) * .04, along = (r() - .5) * .05;
      stones.push({x: c.x + nx * mid + dx * along, z: c.z + nz * mid + dz * along, yaw: yaw + (r() - .5) * .05, w: w * .94, d: course * (.9 + r() * .06), kind: Math.floor(r() * 3), tint: r()});
    }
    if (route.kerb) for (const side of [-1, 1]) {
      // Two setts per course along each edge.
      for (const k of [-.25, .25]) {
        const p = at(Math.min(total, Math.max(0, s + k * course)));
        stones.push({x: p.x + nx * side * (half - .1), z: p.z + nz * side * (half - .1), yaw: yaw + (r() - .5) * .1, w: .22, d: course * .46, kind: 3, tint: r()});
      }
    }
  }
  return stones;
}

// Warm sandstone greys that sit between Dawnhold's pale stone and the meadow dirt (linear RGB, so ~sRGB .5-.62:
// lighter than the dirt, never paper-white in the noon sun).
const TINTS = [[.30, .26, .21], [.25, .23, .20], [.34, .29, .23], [.22, .21, .19], [.29, .24, .18]];

export function createRoadPaving({scene, height, quality = 'high'}) {
  const group = new THREE.Group(); group.name = 'RoadPaving';
  scene.add(group);
  const routes = pavedRoutes(), laid = routes.map((route, i) => ({route, stones: layRoute(route, 901 + i * 37)}));
  const shapes = [flagstoneGeometry(11, {corners: 4}), flagstoneGeometry(23, {corners: 3}), flagstoneGeometry(37, {corners: 2}), flagstoneGeometry(53, {corners: 4, height: .13, chamfer: .05, sink: .12})];
  const material = new THREE.MeshStandardMaterial({name: 'RoadStone', vertexColors: true, roughness: .88, metalness: 0});
  // Grain and pitting from world position: each stone's face differs, no texture fetch, cheap on phones.
  material.onBeforeCompile = s => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRoadWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vRoadWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vRoadWorld;
float roadHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float roadNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(roadHash(i), roadHash(i + vec2(1, 0)), f.x), mix(roadHash(i + vec2(0, 1)), roadHash(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{ vec2 q = vRoadWorld.xz; float grain = roadNoise(q * 9.0) * .55 + roadNoise(q * 31.0) * .3 + roadNoise(q * 2.3) * .15;
  float pit = smoothstep(.78, .9, roadNoise(q * 23.0 + 4.0));
  float moss = smoothstep(.62, .82, roadNoise(q * 1.7 + 9.0)) * (1.0 - smoothstep(.5, .9, vColor.r));
  diffuseColor.rgb *= .84 + .3 * grain - .22 * pit;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.16, .2, .07), moss * .55); }`);
  };
  material.customProgramCacheKey = () => 'road-paving-v1';
  const meshes = shapes.map((geo, kind) => {
    const count = laid.reduce((n, l) => n + l.stones.filter(s => s.kind === kind).length, 0);
    const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, count));
    mesh.name = `RoadPaving:${kind === 3 ? 'kerb' : 'flag' + kind}`; mesh.count = count;
    mesh.castShadow = false; mesh.receiveShadow = quality !== 'low'; mesh.frustumCulled = false;
    mesh.userData.noRaycast = true; mesh.raycast = () => {};
    group.add(mesh); return mesh;
  });
  const all = laid.flatMap(l => l.stones.map(s => ({...s, route: l.route.id})));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), n = new THREE.Vector3(), p = new THREE.Vector3(), sc = new THREE.Vector3(), colour = new THREE.Color();
  const visibleRoutes = new Set(routes.map(r => r.id));
  // dirty: optional [{x, z, radius}] terrain edits morphing this frame; only stones near them re-seat (slots stay put
  // because the visible set is unchanged between full updates).
  function update(dirty = null) {
    const used = [0, 0, 0, 0];
    for (const s of all) {
      if (!visibleRoutes.has(s.route)) continue;
      if (dirty && !dirty.some(d => Math.hypot(s.x - d.x, s.z - d.z) <= d.radius + 1)) { used[s.kind]++; continue; }
      const e = .35, h = height(s.x, s.z), hx = height(s.x + e, s.z) - height(s.x - e, s.z), hz = height(s.x, s.z + e) - height(s.x, s.z - e);
      n.set(-hx, 2 * e, -hz).normalize();
      q.setFromUnitVectors(up, n); qy.setFromAxisAngle(up, s.yaw); q.multiply(qy);
      // A centimetre of lift either way, so no two tops are coplanar where corners meet.
      p.set(s.x, h - .06 + (s.tint - .5) * .02, s.z); sc.set(s.w, 1, s.d);
      m4.compose(p, q, sc);
      const mesh = meshes[s.kind], i = used[s.kind]++;
      mesh.setMatrixAt(i, m4);
      const t = TINTS[Math.floor(s.tint * TINTS.length)], v = .92 + (s.tint * 7.31 % 1) * .16;
      if (!dirty) mesh.setColorAt(i, colour.setRGB(t[0] * v, t[1] * v, t[2] * v));
    }
    meshes.forEach((mesh, k) => { mesh.count = used[k]; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor && !dirty) mesh.instanceColor.needsUpdate = true; });
  }
  update();
  return {
    group, update,
    // Landmark footpaths only exist in worlds that have the landmarks.
    setLandmarks(on) { const want = !!on, had = visibleRoutes.has(STARTING_PATHS[0]?.id); if (want === had) return; for (const p of STARTING_PATHS) want ? visibleRoutes.add(p.id) : visibleRoutes.delete(p.id); update(); },
    terrainMoved(dirty) { if (dirty?.length) update(dirty); },
    stats: () => ({stones: meshes.reduce((n, m) => n + m.count, 0), draws: meshes.length, triangles: meshes.reduce((n, m) => n + m.count * m.geometry.index.count / 3, 0)}),
    dispose() { group.removeFromParent(); for (const g of shapes) g.dispose(); material.dispose(); for (const m of meshes) m.dispose?.(); },
  };
}
