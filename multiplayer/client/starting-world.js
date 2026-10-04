// Starting meadow landmarks. Pure source-authored low-poly; no binaries, no lights, no physics.
// createStartingWorld({THREE, scene, height}) -> { group, update(edits), tick(seconds), setLit(levels), dispose(), stats() }
// Draw calls: one merged mesh per shared material (<= 6) plus the sanctuary's live pieces (runes, hoop, tuning
// crystal: 4). Triangles are capped (see stats()).
import * as art from './sanctuary-art.js';

export const STARTING_SITES = [
  { id: 'sanctuary', name: 'Ancient Stone Sanctuary', x: -25, z: 8, radius: 7.5,
    goal: 'Gather moss-stone shards at the ring', footprints: [] },
  { id: 'outcrop', name: 'Crystal Outcrop', x: 27, z: 14, radius: 7,
    goal: 'Mine glowing crystal for the Forge', footprints: [] },
  { id: 'watcharch', name: 'Ruined Watch-Arch', x: -5, z: -28, radius: 6.5,
    goal: 'Recover the bronze beacon', footprints: [] },
];

// Paths start just outside the forge plaza (r ~ 6) so the centre stays clear.
export const PATHS = [
  { id: 'to-sanctuary', width: 1.6, points: [[-5, 4], [-12, 7], [-18, 7.5]] },
  { id: 'to-outcrop', width: 1.6, points: [[5, 4], [13, 9], [20.5, 12.5]] },
  { id: 'to-watcharch', width: 1.6, points: [[-1, -6], [-3, -15], [-4.5, -22]] },
];

const TRI_CAP = 15000;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function createStartingWorld({ THREE, scene, height }) {
  const H = (x, z) => { const v = height ? height(x, z) : 0; return Number.isFinite(v) ? v : 0; };
  const mats = {
    stone: new THREE.MeshStandardMaterial({ color: 0x9a958a, roughness: 0.93, flatShading: true, vertexColors: true }),
    moss: new THREE.MeshStandardMaterial({ color: 0x5f7d3a, roughness: 1, flatShading: true, vertexColors: true }),
    bronze: art.bronzeMaterial(),
    crystal: art.crystalMaterial(),
    path: new THREE.MeshStandardMaterial({ color: 0xa48a62, roughness: 1, flatShading: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9, flatShading: true }),
  };
  // Shared primitive geometries (owned, disposed).
  const prim = {
    slab: new THREE.BoxGeometry(1, 1, 1, 1, 2, 1),
    rock: new THREE.DodecahedronGeometry(1, 0),
    boulder: new THREE.IcosahedronGeometry(1, 0),
    shard: new THREE.OctahedronGeometry(1, 0),
    prism: new THREE.CylinderGeometry(0.55, 1, 1, 6, 1),
    ring: new THREE.TorusGeometry(1, 0.12, 5, 14),
    disc: new THREE.CylinderGeometry(1, 1.1, 1, 9, 1),
  };
  const runes = []; let hoopAt = null, tuneAt = null; // sanctuary live-piece anchors, filled by the layout below
  // Piece list: {mat, geo, x, z, y (above ground), sx,sy,sz, rx,ry,rz}. Ground sampled per piece at build.
  const pieces = [];
  const P = (mat, geo, x, z, y, s, r = [0, 0, 0], id = null) => pieces.push({ mat, geo, x, z, y, s, r, id });
  const foot = (site, kind, x, z, w, d, rotY = 0, h = 2) => site.footprints.push({ kind, x, z, w, d, rotY, h });

  // --- West: Ancient Stone Sanctuary. Eight hewn menhirs facing the altar, each carved with a resonance rune; a
  // trilithon gateway toward spawn with a geode-split lintel and a hanging bronze hoop; a geode altar with a floating
  // tuning crystal. Stone/moss/crystal pieces merge into the shared buckets; runes, hoop and crystal are live (art.live).
  {
    const site = STARTING_SITES[0]; site.footprints.length = 0; const r = rng(101);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.2; if (Math.abs(a - 0.2) < 0.01) continue; // gap toward spawn path (east)
      const x = site.x + Math.cos(a) * 6, z = site.z + Math.sin(a) * 6;
      const h = 2.6 + r() * 1.8, lean = (r() - 0.5) * 0.18, roll = (r() - 0.5) * 0.12, rotY = -a + Math.PI / 2; // broad face to the altar
      const geo = 'menhir' + i; prim[geo] = art.menhirGeometry(900 + i * 17, {w: 0.92, h: h + 0.3, d: 0.6, taper: 0.66 + (i % 3) * 0.05});
      P('stone', geo, x, z, -0.3, [1, 1, 1], [lean * 0.5, rotY, roll * 0.6], 'waystone' + runes.length); // struck to ring it (shared/waygate.js)
      const moss = 'moss' + i; prim[moss] ||= art.mossGeometry(40 + i);
      P('moss', moss, x + Math.cos(a) * 0.15, z + Math.sin(a) * 0.15, 0.02, [0.85, 0.32, 0.6], [0, r() * 6, 0]);
      if (i % 3 === 0) P('moss', moss, x, z, h - 0.45, [0.5, 0.22, 0.36], [lean * 0.5, rotY, 0]);
      runes.push({stone: runes.length, x, z, rotY, tilt: [lean * 0.5, roll * 0.6], face: prim[geo].userData.face});
      foot(site, 'stone', x, z, 0.9, 0.55, rotY, h);
    }
    // Trilithon gateway on the east side, toward the path. Hoop hangs in the opening (live group).
    const gx = site.x + 6.3, gz = site.z;
    prim.post0 = art.menhirGeometry(611, {w: 0.8, h: 4.0, d: 0.72, taper: 0.88, crown: 0.02, rough: 0.05});
    prim.post1 = art.menhirGeometry(612, {w: 0.8, h: 4.0, d: 0.72, taper: 0.88, crown: 0.02, rough: 0.05});
    prim.lintel = art.lintelGeometry(613, {w: 1.0, h: 0.62, len: 3.5});
    prim.seam = art.crystalPointGeometry(1, 0.1);
    prim.mossCap = art.mossGeometry(77);
    P('stone', 'post0', gx, gz - 1.2, -0.3, [1, 1, 1], [0, Math.PI / 2, 0]);
    P('stone', 'post1', gx, gz + 1.2, -0.3, [1, 1, 1], [0, -Math.PI / 2, 0]);
    P('stone', 'lintel', gx, gz, 3.95, [1, 1, 1], [0, 0, 0.03]);
    P('moss', 'mossCap', gx + 0.05, gz - 0.5, 4.22, [0.55, 0.2, 1.25], [0, 0.1, 0]);
    for (let k = 0; k < 7; k++) { const t = (k - 3) / 3, len = 0.42 - Math.abs(t) * 0.22;
      P('crystal', 'seam', gx + (k % 2 ? 0.07 : -0.07), gz + t * 1.15, 3.78, [1, len, 1], [Math.PI + (k % 2 ? 0.25 : -0.25), 0, t * 0.4]); }
    hoopAt = {x: gx - 0.05, z: gz, y: 2.5};
    foot(site, 'stone', gx, gz - 1.2, 0.8, 0.7, 0, 4); foot(site, 'stone', gx, gz + 1.2, 0.8, 0.7, 0, 4);
    // Geode altar with crystal points in its bowl; the tuning crystal floats above it (live).
    prim.altar = art.altarGeometry(321); prim.bowlPoint = art.crystalPointGeometry(1, 0.11);
    P('stone', 'altar', site.x, site.z, -0.05, [1, 1, 1], [0, 0.2, 0], 'waygateAltar');
    for (let k = 0; k < 9; k++) { const b = k / 9 * Math.PI * 2, rr = k % 2 ? 0.42 : 0.6, len = k % 2 ? 0.55 : 0.36;
      P('crystal', 'bowlPoint', site.x + Math.cos(b) * rr, site.z + Math.sin(b) * rr, 1.02, [1, len, 1], [Math.sin(b) * 0.55, 0, -Math.cos(b) * 0.55], 'waygateAltar'); }
    tuneAt = {x: site.x, z: site.z, y: 2.05};
    foot(site, 'altar', site.x, site.z, 2.8, 2.8, 0, 1);
    for (let i = 0; i < 6; i++) { const a = r() * 6.28, d = 8 + r() * 3, k = 'mossRock' + i; prim[k] = art.mossGeometry(60 + i);
      P('moss', k, site.x + Math.cos(a) * d, site.z + Math.sin(a) * d, 0.0, [0.5 + r() * 0.5, 0.26, 0.5 + r() * 0.4], [0, r() * 6, 0]); }
    // A toppled menhir fragment by the open gap, half sunk in the turf.
    prim.fallen = art.menhirGeometry(955, {w: 0.8, h: 1.9, d: 0.5, taper: 0.8});
    P('stone', 'fallen', site.x + 3.6, site.z - 4.4, 0.18, [1, 1, 1], [Math.PI / 2 - 0.08, 0.7, 0.1]);
  }

  // --- East: crystal mining outcrop. Stepped boulder mound, crystal clusters, timber+bronze mine frame.
  {
    const site = STARTING_SITES[1]; site.footprints.length = 0; const r = rng(202);
    const mound = [[0, 0, 3.2, 2.2], [2.4, -1.5, 2.2, 1.6], [-2.2, 1.2, 2.0, 1.4], [1.0, 2.6, 1.6, 1.1], [-1.6, -2.4, 1.5, 1.0]];
    for (const [dx, dz, w, h] of mound) {
      P('stone', 'boulder', site.x + dx, site.z + dz, h * 0.45, [w, h, w * 0.9], [r(), r() * 6, r() * 0.4]);
      foot(site, 'rock', site.x + dx, site.z + dz, w * 1.6, w * 1.5, 0, h);
    }
    const clusters = [[0.2, 0.3, 2.4, 1.6], [2.6, -1.4, 1.8, 1.2], [-2.0, 1.4, 1.6, 1.0], [1.2, 3.0, 1.2, 0.6], [4.4, 1.0, 1.0, 0], [-3.8, -1.2, 0.9, 0]];
    for (const [dx, dz, s, lift] of clusters) {
      const n = 3 + Math.floor(r() * 2);
      for (let k = 0; k < n; k++) {
        const h = s * (0.8 + r() * 0.9);
        P('crystal', 'prism', site.x + dx + (r() - 0.5) * s * 0.6, site.z + dz + (r() - 0.5) * s * 0.6, lift + h * 0.45,
          [0.22 * s, h, 0.22 * s], [(r() - 0.5) * 0.7, r() * 6, (r() - 0.5) * 0.7]);
      }
      P('crystal', 'shard', site.x + dx, site.z + dz, lift + s * 1.2, [0.18 * s, 0.5 * s, 0.18 * s], [0, r() * 6, 0]);
    }
    // Mine frame on the approach side (west, toward forge).
    const mx = site.x - 4.2, mz = site.z - 2.2;
    P('wood', 'slab', mx, mz - 1, 1.3, [0.3, 2.6, 0.3]); P('wood', 'slab', mx, mz + 1, 1.3, [0.3, 2.6, 0.3]);
    P('wood', 'slab', mx, mz, 2.6, [0.35, 0.3, 2.6]);
    P('bronze', 'ring', mx, mz, 2.15, [0.32, 0.32, 0.32], [0, Math.PI / 2, 0]);
    P('wood', 'slab', mx - 1.2, mz + 1.8, 0.35, [1.4, 0.7, 0.9], [0, 0.3, 0]); // ore cart body
    P('crystal', 'shard', mx - 1.2, mz + 1.8, 0.85, [0.3, 0.4, 0.3]);
    P('bronze', 'ring', mx - 1.2, mz + 1.8, 0.2, [0.5, 0.5, 0.5], [Math.PI / 2, 0, 0]);
    foot(site, 'post', mx, mz - 1, 0.3, 0.3, 0, 2.6); foot(site, 'post', mx, mz + 1, 0.3, 0.3, 0, 2.6);
  }

  // --- North: ruined watch-arch. Broken pointed arch, fallen voussoirs, bronze beacon brazier on stump tower.
  {
    const site = STARTING_SITES[2]; site.footprints.length = 0; const r = rng(303);
    const ax = site.x, az = site.z;
    P('stone', 'slab', ax - 2.2, az, 2.5, [1.1, 5, 1.1]); // left pier, tall
    P('stone', 'slab', ax + 2.2, az, 1.6, [1.1, 3.2, 1.1], [0, 0, -0.05]); // right pier, broken
    for (let i = 0; i < 6; i++) { // left half arch voussoirs
      const t = (i + 0.5) / 7 * Math.PI * 0.5, cx = ax - 2.2 + (1 - Math.cos(t)) * 2.2, cy = 5 + Math.sin(t) * 2.4;
      P('stone', 'slab', cx, az, cy, [0.95, 0.6, 1.0], [0, 0, -t]);
    }
    P('moss', 'slab', ax - 2.2, az, 5.05, [1.2, 0.15, 1.2]);
    for (let i = 0; i < 5; i++) // fallen blocks scattered right
      P(i % 2 ? 'moss' : 'stone', 'slab', ax + 3 + r() * 2.5, az + (r() - 0.5) * 3, 0.25, [0.9, 0.55, 0.9], [r() * 0.3, r() * 6, r() * 0.3]);
    foot(site, 'pier', ax - 2.2, az, 1.1, 1.1, 0, 5); foot(site, 'pier', ax + 2.2, az, 1.1, 1.1, 0, 3.2);
    // Stump tower with beacon behind the arch (north), visible from RTS and from spawn through the arch.
    const tx = ax + 0.5, tz = az - 4.5;
    P('stone', 'disc', tx, tz, 1.6, [1.6, 3.2, 1.6]);
    P('moss', 'disc', tx, tz, 3.25, [1.7, 0.15, 1.7]);
    P('bronze', 'prism', tx, tz, 3.7, [0.9, 0.8, 0.9], [Math.PI, 0, 0]);
    P('crystal', 'shard', tx, tz, 4.5, [0.35, 0.6, 0.35]);
    foot(site, 'tower', tx, tz, 3.4, 3.4, 0, 3.4);
    for (let i = 0; i < 5; i++) { const a = r() * 6.28, d = 6 + r() * 3;
      P('stone', 'rock', ax + Math.cos(a) * d, az + Math.sin(a) * d, 0.1, [0.6 + r() * 0.5, 0.4, 0.6], [0, r() * 6, 0]); }
  }

  // Path stepping stones: bounded count, flattened rocks.
  const pathStones = [];
  { const r = rng(404);
    for (const p of PATHS) for (let i = 0; i + 1 < p.points.length; i++) {
      const [x0, z0] = p.points[i], [x1, z1] = p.points[i + 1], len = Math.hypot(x1 - x0, z1 - z0), n = Math.min(12, Math.floor(len / 1.3));
      for (let k = 0; k < n; k++) { const t = (k + 0.5) / n;
        pathStones.push({ x: x0 + (x1 - x0) * t + (r() - 0.5) * p.width * 0.5, z: z0 + (z1 - z0) * t + (r() - 0.5) * p.width * 0.5,
          s: 0.45 + r() * 0.3, ry: r() * 6 }); }
    } }
  for (const s of pathStones) P('path', 'rock', s.x, s.z, 0.02, [s.s, 0.08, s.s * 0.85], [0, s.ry, 0]);

  const group = new THREE.Group(); group.name = 'StartingWorld';
  const meshes = {}; let tris = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();

  function build() {
    for (const k in meshes) { group.remove(meshes[k]); meshes[k].geometry.dispose(); delete meshes[k]; }
    tris = 0; const buckets = {};
    for (const p of pieces) {
      const g = prim[p.geo]; const src = g.index ? g.toNonIndexed() : g;
      const triCount = src.attributes.position.count / 3;
      if (tris + triCount > TRI_CAP) { if (src !== g) src.dispose(); continue; }
      tris += triCount;
      // Anchor: sink 0.15 into the ground so slopes never show floating bases.
      const gy = H(p.x, p.z) - 0.15;
      m4.compose(v.set(p.x, gy + p.y, p.z), q.setFromEuler(e.set(p.r[0], p.r[1], p.r[2])), sc.set(p.s[0], p.s[1], p.s[2]));
      const b = (buckets[p.mat] ||= { pos: [], nor: [], targets: [] });
      if (p.id) b.targets.push([b.pos.length / 9, b.pos.length / 9 + triCount, p.id]);
      const pa = src.attributes.position, na = src.attributes.normal, ca = src.attributes.color, nm = new THREE.Matrix3().getNormalMatrix(m4);
      const b2 = (b.col ||= []);
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(m4); b.pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); b.nor.push(v.x, v.y, v.z);
        if (ca) b2.push(ca.getX(i), ca.getY(i), ca.getZ(i)); else b2.push(1, 1, 1);
      }
      if (src !== g) src.dispose();
    }
    for (const k in buckets) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(buckets[k].pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(buckets[k].nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(buckets[k].col, 3));
      geo.computeBoundingSphere(); geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, mats[k]); mesh.name = 'StartingWorld_' + k;
      mesh.castShadow = k !== 'path'; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      // Struck surfaces that matter to gameplay resolve to their shared target id by triangle (see game.js resolveHit).
      const targets = buckets[k].targets; if (targets.length) mesh.userData.faceTarget = f => targets.find(([a, z]) => f >= a && f < z)?.[2] || null;
      meshes[k] = mesh; group.add(mesh);
    }
    for (const s of STARTING_SITES) s.y = H(s.x, s.z);
    buildLive();
  }
  // Live sanctuary pieces: carved runes (one draw, per-stone glow), the bronze hoop (+ its crystal inlay) and the
  // floating tuning crystal. Rebuilt with the merged meshes so they follow terrain edits.
  const rune = art.runeMaterial(), hoopParts = art.hoopGeometries(0.62), tuneGeo = new THREE.OctahedronGeometry(1, 0);
  const live = new THREE.Group(); live.name = 'StartingWorld_sanctuaryLive';
  const hoop = new THREE.Group(), hoopBronze = new THREE.Mesh(hoopParts.bronze, mats.bronze), hoopGlow = new THREE.Mesh(hoopParts.glow, mats.crystal);
  hoop.add(hoopBronze, hoopGlow); hoopBronze.castShadow = true;
  const tune = new THREE.Mesh(tuneGeo, mats.crystal); tune.scale.set(0.2, 0.46, 0.2); tune.userData.targetId = 'waygateAltar';
  hoop.traverse(o => { o.raycast = () => {}; }); // the hoop hangs out of reach; strikes pass to the stone behind
  let runeMesh = null; const lit = rune.uLit.value;
  function buildLive() {
    if (runeMesh) { live.remove(runeMesh); runeMesh.geometry.dispose(); runeMesh = null; }
    const parts = [], stoneIds = [], mm = new THREE.Matrix4(), local = new THREE.Matrix4(), qq = new THREE.Quaternion();
    for (const r of runes) {
      const g = art.runeGeometry(r.stone); const f = r.face;
      mm.compose(v.set(r.x, H(r.x, r.z) - 0.15 - 0.3, r.z), qq.setFromEuler(e.set(r.tilt[0], r.rotY, r.tilt[1])), sc.set(1, 1, 1));
      local.compose(new THREE.Vector3(f.x, f.y, f.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, f.rotY, 0)), sc.set(1, 1, 1));
      g.applyMatrix4(mm.multiply(local)); parts.push(g);
      for (let i = 0; i < g.attributes.position.count; i++) stoneIds.push(r.stone);
    }
    if (parts.length) {
      const geo = art.mergeGeometries(parts); geo.computeVertexNormals();
      geo.setAttribute('aStone', new THREE.Float32BufferAttribute(stoneIds, 1)); geo.computeBoundingSphere();
      runeMesh = new THREE.Mesh(geo, rune.material); runeMesh.name = 'StartingWorld_runes'; runeMesh.raycast = () => {}; live.add(runeMesh);
    }
    if (hoopAt) { hoop.position.set(hoopAt.x, H(hoopAt.x, hoopAt.z) - 0.15 + hoopAt.y, hoopAt.z); hoop.rotation.set(0, Math.PI / 2, 0); live.add(hoop); }
    if (tuneAt) { tune.position.set(tuneAt.x, H(tuneAt.x, tuneAt.z) - 0.15 + tuneAt.y, tuneAt.z); tune.userData.baseY = tune.position.y; live.add(tune); }
  }
  // Presentation clock: runes breathe, the hoop sways on its chains, the tuning crystal spins and bobs. Its brightness
  // follows how many stones are lit (setLit), so the altar reads as the chord's progress.
  let spin = 0, lastSeconds = 0;
  function tick(seconds, open = 0) {
    rune.uTime.value = seconds;
    const dt = Math.min(0.1, Math.max(0, seconds - lastSeconds)); lastSeconds = seconds; spin += dt * open * 2.6;
    hoop.rotation.z = spin + Math.sin(seconds * 0.7) * 0.025 * (1 - open); hoop.rotation.y = Math.PI / 2 + Math.sin(seconds * 0.43) * 0.05 * (1 - open);
    hoopGlow.scale.setScalar(1 + open * 0.06);
    let sum = 0; for (let i = 0; i < runes.length; i++) sum += lit[i];
    const charge = runes.length ? sum / runes.length : 0;
    tune.rotation.y = seconds * (0.6 + charge * 2.4);
    if (tune.userData.baseY !== undefined) tune.position.y = tune.userData.baseY + Math.sin(seconds * 1.3) * 0.08 + charge * 0.25;
  }
  // levels: per-stone 0..1 resonance (index order = ring order, gap skipped).
  function setLit(levels = []) { for (let i = 0; i < lit.length; i++) lit[i] = Math.max(0, Math.min(1, +levels[i] || 0)); }
  group.add(live);
  build();
  scene.add(group);

  // edits: optional array of {x,z,radius}. Rebuild only if an edit touches a site or path; otherwise no-op.
  function update(edits) {
    if (Array.isArray(edits) && edits.length) {
      const near = edits.some((ed) => {
        const rr = (ed.radius || 3) + 1;
        if (STARTING_SITES.some((s) => Math.hypot(ed.x - s.x, ed.z - s.z) < s.radius + rr + 6)) return true;
        return pathStones.some((p) => Math.hypot(ed.x - p.x, ed.z - p.z) < rr);
      });
      if (!near) return false;
    }
    build(); return true;
  }
  function dispose() {
    scene.remove(group);
    for (const k in meshes) meshes[k].geometry.dispose();
    for (const k in prim) prim[k].dispose();
    for (const k in mats) mats[k].dispose();
    runeMesh?.geometry.dispose(); rune.material.dispose(); hoopParts.bronze.dispose(); hoopParts.glow.dispose(); tuneGeo.dispose();
  }
  function stats() { return { draws: Object.keys(meshes).length, liveDraws: (runeMesh ? 1 : 0) + 3, triangles: tris, triCap: TRI_CAP, pieces: pieces.length, runes: runes.length }; }
  return { group, update, tick, setLit, dispose, stats, sites: STARTING_SITES, paths: PATHS };
}
