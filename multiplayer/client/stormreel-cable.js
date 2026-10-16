// Stormreel cable: a verlet rope from a Stormspire terminal to whoever carries (or planted) its crossbow, lying on the
// ground, sagging between supports, and wrapped snugly round the trunks of any trees it has been walked round.
// Presentation only: the authority decides which trees the cable is wrapped round (shared/stormreel.js b.wraps) and how much
// cable is used; this file draws it. Each wrapped trunk is a ring at WRAP_Y above the tree floor, sized from the tree's own
// authored trunk profile (shared/trees.js trunkRadius), so the cable hugs the bark: tangent in, round the arc, tangent out.
// The free spans between supports are simulated (gravity, ground contact, drag); the arcs are drawn densely so the cable
// never cuts a chord through the wood.
import * as THREE from 'three';
import {trunkRadius} from '../shared/trees.js';

export const CABLE = Object.freeze({points: 84, sides: 8, radius: .026, iterations: 12, gravity: 9.8, homeSeconds: .8, payOut: 40, wrapY: .8, arcStep: .2});
const ARC_MAX = 24, WRAP_MAX = 24, RAW = CABLE.points + WRAP_MAX * (ARC_MAX + 2), CAP = RAW * 2;   // drawn: every span split once (Catmull-Rom)
const TAU = Math.PI * 2, wrapAngle = a => ((a % TAU) + TAU) % TAU;

/** Rubber jacket: a faint moulded rib every 9 cm and a lighter pinstripe running along one side (so twist and motion read). */
function jacketTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = 32; c.height = 32; const g = c.getContext('2d');
  g.fillStyle = 'rgb(200,200,200)'; g.fillRect(0, 0, 32, 32);
  g.fillStyle = 'rgb(255,255,255)'; g.fillRect(13, 0, 4, 32);                      // pinstripe (u across the circumference)
  g.fillStyle = 'rgba(70,70,70,.55)'; g.fillRect(0, 0, 32, 3);                       // moulded rib (v along the length)
  g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, 3, 32, 1);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/**
 * ctx: scene, height(x,z)
 * Returns {make(colour, material), step(cable, opts), draw(cable), drop(cable), whip(cable, k), jacket}
 */
export function createCableKit(ctx) {
  const {scene} = ctx, jacket = jacketTexture();
  const v = new THREE.Vector3(), v2 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  function make(material) {
    const S = CABLE.sides, pos = new Float32Array(CAP * S * 3), nor = new Float32Array(CAP * S * 3), uv = new Float32Array(CAP * S * 2), idx = [];
    for (let i = 0; i < CAP - 1; i++) for (let k = 0; k < S; k++) { const a = i * S + k, b = i * S + (k + 1) % S, c = a + S, d = b + S; idx.push(a, c, b, b, c, d); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage)); geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, material); mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.raycast = () => {}; mesh.userData.ignoreContact = true; mesh.name = 'StormreelCable'; scene.add(mesh);
    const N = CABLE.points;
    return {mesh, geo, p: Array.from({length: N}, () => new THREE.Vector3()), o: Array.from({length: N}, () => new THREE.Vector3()),
      raw: Array.from({length: RAW}, () => new THREE.Vector3()), render: Array.from({length: CAP}, () => new THREE.Vector3()), count: 0, seeded: false, length: 0, end: new THREE.Vector3(),
      pins: [], wraps: [], path: 0, whip: 0};
  }
  function seed(c, a, b) {
    for (let i = 0; i < c.p.length; i++) { const t = i / (c.p.length - 1); c.p[i].lerpVectors(a, b, t); c.p[i].y -= Math.sin(t * Math.PI) * .4; c.o[i].copy(c.p[i]); }
    c.seeded = true; c.length = a.distanceTo(b) + .6; c.end.copy(b);
  }

  // ---- the supported path round each wrapped trunk
  /** Tangent point on circle (centre C, radius r, at height y) from point P, on the outside of the bend (dir out). */
  function tangent(C, r, P, out, y, res) {
    const dx = P.x - C.x, dz = P.z - C.z, d = Math.hypot(dx, dz);
    if (d <= r * 1.02) return res.set(C.x + out.x * r, y, C.z + out.z * r);
    const th = Math.atan2(dz, dx), al = Math.acos(r / d), a1 = th + al, a2 = th - al;
    const k1 = Math.cos(a1) * out.x + Math.sin(a1) * out.z, k2 = Math.cos(a2) * out.x + Math.sin(a2) * out.z, a = k1 >= k2 ? a1 : a2;
    return res.set(C.x + Math.cos(a) * r, y, C.z + Math.sin(a) * r);
  }
  /** wraps: [{x, z, tree}] -> c.wraps: [{C, r, y, tin, tout, arc: Vector3[]}], the nominal path length. */
  function supports(c, a, b, wraps) {
    c.wraps.length = 0; if (!wraps?.length) return a.distanceTo(b);
    // Trees: round the trunk above the root flare. Anything else (a building corner, a rock, the tower) is a peg the
    // authority already set a hand's width off the surface, so the cable just bends round it low to the ground.
    const n = wraps.length, centres = wraps.map(w => new THREE.Vector3(w.x, (ctx.height(w.x, w.z)) + (w.tree ? CABLE.wrapY : .3), w.z));
    for (let k = 0; k < n; k++) {
      const w = wraps[k], C = centres[k], y = C.y, r = (w.tree ? trunkRadius(w.tree, CABLE.wrapY) : .05) + CABLE.radius + .012;   // above the root flare, clear of the bark ridges
      const P = k ? centres[k - 1] : a, Nx = k < n - 1 ? centres[k + 1] : b;
      const out = v.set(C.x - P.x, 0, C.z - P.z).normalize().add(v2.set(C.x - Nx.x, 0, C.z - Nx.z).normalize());
      if (out.lengthSq() < 1e-4) out.set(-(Nx.z - P.z), 0, Nx.x - P.x); out.normalize();
      const tin = tangent(C, r, P, out, y, new THREE.Vector3()), tout = tangent(C, r, Nx, out, y, new THREE.Vector3());
      // Round the far side of the trunk (the side facing away from both neighbours), never through it.
      const a0 = Math.atan2(tin.z - C.z, tin.x - C.x), a1 = Math.atan2(tout.z - C.z, tout.x - C.x), am = Math.atan2(out.z, out.x);
      const ccw = wrapAngle(a1 - a0), via = wrapAngle(am - a0), sweep = via <= ccw ? ccw : -(TAU - ccw);
      const steps = Math.min(ARC_MAX, Math.max(2, Math.ceil(Math.abs(sweep) * r / CABLE.arcStep * 2.2))), arc = [];
      for (let i = 1; i < steps; i++) { const t = a0 + sweep * i / steps; arc.push(new THREE.Vector3(C.x + Math.cos(t) * r, y, C.z + Math.sin(t) * r)); }
      c.wraps.push({C, r, y, tin, tout, arc, len: Math.abs(sweep) * r});
    }
    let L = a.distanceTo(c.wraps[0].tin);
    for (let k = 0; k < n; k++) { const w = c.wraps[k]; L += w.len + (k < n - 1 ? w.tout.distanceTo(c.wraps[k + 1].tin) : w.tout.distanceTo(b)); }
    return L;
  }
  /** Allocate rope points to the supports in proportion to path length; each wrap pins an in and an out point. */
  function pinWraps(c, a) {
    c.pins.length = 0; if (!c.wraps.length) return;
    const N = c.p.length, total = c.path; let at = 0, prev = a, last = 0;
    for (const w of c.wraps) {
      at += prev.distanceTo(w.tin); let iIn = Math.round(at / total * (N - 1)); at += w.len;
      let iOut = Math.round(at / total * (N - 1));
      iIn = Math.max(last + 1, Math.min(N - 3, iIn)); iOut = Math.max(iIn + 1, Math.min(N - 2, iOut));
      c.pins.push({iIn, iOut, w}); last = iOut; prev = w.tout;
    }
  }
  function pinTo(c) {
    for (const {iIn, iOut, w} of c.pins) {
      const span = iOut - iIn;
      for (let i = iIn; i <= iOut; i++) {
        const f = (i - iIn) / span;
        if (f === 0) c.p[i].copy(w.tin); else if (f === 1) c.p[i].copy(w.tout);
        else { const arc = w.arc, g = f * (arc.length + 1), j = Math.floor(g); const A = j === 0 ? w.tin : arc[j - 1], B = j >= arc.length ? w.tout : arc[j]; c.p[i].lerpVectors(A, B, g - j); }
        c.o[i].copy(c.p[i]);
      }
    }
  }

  /**
   * One frame. opts: {a, b (Vector3 ends), wraps ([{x,z,tree}] or null), strain 0..1, dt, maxLength, home (winding home),
   * trunks ([{x, z, r, top}] trees the cable is NOT wrapped round: free spans slide round them instead of through)}
   */
  function step(c, {a, b, wraps, strain = 0, dt, maxLength, home = false, trunks = null}) {
    if (!c.seeded) seed(c, a, b);
    c.path = supports(c, a, b, wraps); pinWraps(c, a);
    const N = c.p.length, h = Math.min(dt, 1 / 30), g = CABLE.gravity * h * h;
    // Paid-out length: generous slack near the tower, drawing taut as the carrier reaches the end of the drum.
    const want = Math.min(maxLength + .5, c.path * (1.04 - .035 * (home ? 1 : strain)) + .7 * (1 - (home ? 1 : strain)));
    c.length += (want - c.length) * Math.min(1, dt * 3);
    const rest = c.length / (N - 1);
    // A tug at the end of the cable whips a little wave back along it (stormreel-view tug).
    const whip = c.whip; c.whip = Math.max(0, c.whip - dt * 3);
    for (let i = 1; i < N - 1; i++) {
      const p = c.p[i], o = c.o[i], ground = ctx.height(p.x, p.z) + CABLE.radius;
      const onGround = p.y <= ground + .01, damp = onGround ? .55 : .985;   // lying cable drags; hanging cable swings
      const vx = (p.x - o.x) * damp, vy = (p.y - o.y) * .985, vz = (p.z - o.z) * damp;
      o.copy(p); p.x += vx; p.y += vy - g; p.z += vz;
      if (whip > .5) { const u = i / (N - 1); p.y += Math.max(0, u - .55) * .05 * whip * Math.sin(u * 40); }
    }
    c.p[0].copy(a); c.p[N - 1].copy(b); pinTo(c);
    for (let it = 0; it < CABLE.iterations; it++) {
      for (let i = 0; i < N - 1; i++) {
        const p = c.p[i], n = c.p[i + 1]; v.subVectors(n, p); const l = v.length() || 1e-6, diff = (l - rest) / l;
        const wa = i === 0 ? 0 : .5, wb = i + 1 === N - 1 ? 0 : .5, k = wa + wb; if (!k) continue;
        p.addScaledVector(v, diff * wa / k); n.addScaledVector(v, -diff * wb / k);
      }
      for (let i = 1; i < N - 1; i++) {
        const p = c.p[i], ground = ctx.height(p.x, p.z) + CABLE.radius; if (p.y < ground) p.y = ground;
        if (trunks) for (const t of trunks) {   // bark is solid: push the rope out to the trunk's surface
          const dx = p.x - t.x, dz = p.z - t.z, d2 = dx * dx + dz * dz, r = t.r + CABLE.radius;
          if (d2 < r * r && p.y < t.top) { const d = Math.sqrt(d2) || 1e-4; p.x = t.x + dx / d * r; p.z = t.z + dz / d * r; }
        }
      }
      c.p[0].copy(a); c.p[N - 1].copy(b); pinTo(c);
    }
    // The drawn line: simulated points, with each wrap replaced by its dense arc round the bark.
    let n = 0, i = 0; const R = c.raw, byIn = new Map(c.pins.map(pin => [pin.iIn, pin]));
    while (i < N) {
      const pin = byIn.get(i);
      if (pin) { R[n++].copy(pin.w.tin); for (const q of pin.w.arc) R[n++].copy(q); R[n++].copy(pin.w.tout); i = pin.iOut + 1; continue; }
      R[n++].copy(c.p[i]); i++;
    }
    // Then every span split at its Catmull-Rom midpoint, lifted clear of the ground there too, so bends are round
    // (no facets where the cable leaves the pack or drapes over a ridge) and it never dips under a bump between points.
    const D = c.render; let m = 0;
    for (let k = 0; k < n; k++) {
      D[m++].copy(R[k]); if (k === n - 1) break;
      const p0 = R[Math.max(0, k - 1)], p1 = R[k], p2 = R[k + 1], p3 = R[Math.min(n - 1, k + 2)], q = D[m++];
      q.set(-.0625 * p0.x + .5625 * p1.x + .5625 * p2.x - .0625 * p3.x, -.0625 * p0.y + .5625 * p1.y + .5625 * p2.y - .0625 * p3.y, -.0625 * p0.z + .5625 * p1.z + .5625 * p2.z - .0625 * p3.z);
      const g = ctx.height(q.x, q.z) + CABLE.radius; if (q.y < g) q.y = g;
    }
    c.count = m;
  }

  /** Tube along the render polyline, parallel-transported frames, ribbed jacket UVs. */
  function draw(c) {
    const n = c.count, S = CABLE.sides, pos = c.geo.attributes.position.array, nor = c.geo.attributes.normal.array, uv = c.geo.attributes.uv.array, R = c.render;
    const t = new THREE.Vector3(), nn = new THREE.Vector3(), bn = new THREE.Vector3(); let prev = null, along = 0;
    for (let i = 0; i < n; i++) {
      t.subVectors(R[Math.min(i + 1, n - 1)], R[Math.max(i - 1, 0)]); if (t.lengthSq() < 1e-10) t.set(1, 0, 0); t.normalize();
      if (!prev) nn.crossVectors(t, Math.abs(t.y) < .9 ? up : v2.set(1, 0, 0)).normalize();
      else { nn.copy(prev).addScaledVector(t, -t.dot(prev)); if (nn.lengthSq() < 1e-8) nn.crossVectors(t, up); nn.normalize(); }
      prev = (prev || new THREE.Vector3()).copy(nn); bn.crossVectors(t, nn);
      if (i) along += R[i].distanceTo(R[i - 1]);
      for (let k = 0; k < S; k++) {
        const ang = k / S * Math.PI * 2, cx = Math.cos(ang), cy = Math.sin(ang), j = (i * S + k) * 3, j2 = (i * S + k) * 2;
        const nx = nn.x * cx + bn.x * cy, ny = nn.y * cx + bn.y * cy, nz = nn.z * cx + bn.z * cy;
        pos[j] = R[i].x + nx * CABLE.radius; pos[j + 1] = R[i].y + ny * CABLE.radius; pos[j + 2] = R[i].z + nz * CABLE.radius;
        nor[j] = nx; nor[j + 1] = ny; nor[j + 2] = nz; uv[j2] = k / S; uv[j2 + 1] = along / .09;
      }
    }
    c.geo.setDrawRange(0, Math.max(0, n - 1) * S * 6);
    c.geo.attributes.position.needsUpdate = c.geo.attributes.normal.needsUpdate = c.geo.attributes.uv.needsUpdate = true;
  }
  function drop(c) { c.mesh.removeFromParent(); c.geo.dispose(); }
  /** Points of the drawn cable as an array view (for pulses and beads). */
  const points = c => c.render.slice(0, c.count);
  return {make, step, draw, drop, points, seed, jacket, whip(c, k = 1) { c.whip = Math.max(c.whip, k); }};
}
