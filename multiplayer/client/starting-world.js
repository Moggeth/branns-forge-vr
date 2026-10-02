// Starting meadow landmarks. Pure source-authored low-poly; no binaries, no lights, no physics.
// createStartingWorld({THREE, scene, height}) -> { group, update(edits), dispose(), stats() }
// Draw calls: one merged mesh per shared material (<= 6). Triangles are capped (see stats()).

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
    stone: new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 0.95, flatShading: true }),
    moss: new THREE.MeshStandardMaterial({ color: 0x5f7d3a, roughness: 1, flatShading: true }),
    bronze: new THREE.MeshStandardMaterial({ color: 0xb07a3a, roughness: 0.45, metalness: 0.8, flatShading: true }),
    crystal: new THREE.MeshStandardMaterial({ color: 0x7fe3ff, emissive: 0x2a9fc8, emissiveIntensity: 0.9,
      roughness: 0.2, metalness: 0.1, flatShading: true, transparent: true, opacity: 0.92 }),
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
  // Piece list: {mat, geo, x, z, y (above ground), sx,sy,sz, rx,ry,rz}. Ground sampled per piece at build.
  const pieces = [];
  const P = (mat, geo, x, z, y, s, r = [0, 0, 0]) => pieces.push({ mat, geo, x, z, y, s, r });
  const foot = (site, kind, x, z, w, d, rotY = 0, h = 2) => site.footprints.push({ kind, x, z, w, d, rotY, h });

  // --- West: standing-stone sanctuary. Ring of 9 leaning monoliths, a capped trilithon facing spawn, mossy altar.
  {
    const site = STARTING_SITES[0]; site.footprints.length = 0; const r = rng(101);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.2; if (Math.abs(a - 0.2) < 0.01) continue; // gap toward spawn path (east)
      const x = site.x + Math.cos(a) * 6, z = site.z + Math.sin(a) * 6;
      const h = 2.6 + r() * 1.8, lean = (r() - 0.5) * 0.18;
      P('stone', 'slab', x, z, h / 2 - 0.3, [0.9, h, 0.55], [lean, -a, (r() - 0.5) * 0.12]);
      P('moss', 'rock', x, z, 0.1, [0.75, 0.35, 0.6], [0, r() * 6, 0]);
      if (i % 3 === 0) P('moss', 'slab', x, z, h - 0.25, [0.95, 0.18, 0.6], [lean, -a, 0]);
      foot(site, 'stone', x, z, 0.9, 0.55, -a, h);
    }
    // Trilithon gateway on the east side, toward the path.
    const gx = site.x + 6.3, gz = site.z;
    P('stone', 'slab', gx, gz - 1.2, 1.7, [0.8, 4, 0.7]);
    P('stone', 'slab', gx, gz + 1.2, 1.7, [0.8, 4, 0.7]);
    P('stone', 'slab', gx, gz, 3.95, [1.0, 0.6, 3.4], [0, 0, 0.03]);
    P('moss', 'slab', gx, gz, 4.3, [1.05, 0.12, 3.0]);
    P('bronze', 'ring', gx - 0.45, gz, 3.0, [0.55, 0.55, 0.55], [0, Math.PI / 2, 0]);
    foot(site, 'stone', gx, gz - 1.2, 0.8, 0.7, 0, 4); foot(site, 'stone', gx, gz + 1.2, 0.8, 0.7, 0, 4);
    // Altar with bronze bowl.
    P('stone', 'disc', site.x, site.z, 0.35, [1.4, 0.7, 1.4]);
    P('moss', 'disc', site.x, site.z, 0.75, [1.25, 0.1, 1.25]);
    P('bronze', 'disc', site.x, site.z, 0.95, [0.55, 0.3, 0.55]);
    foot(site, 'altar', site.x, site.z, 2.8, 2.8, 0, 1);
    for (let i = 0; i < 6; i++) { const a = r() * 6.28, d = 8 + r() * 3;
      P('moss', 'rock', site.x + Math.cos(a) * d, site.z + Math.sin(a) * d, 0.05, [0.5 + r() * 0.5, 0.3, 0.5 + r() * 0.4], [0, r() * 6, 0]); }
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
      const b = (buckets[p.mat] ||= { pos: [], nor: [] });
      const pa = src.attributes.position, na = src.attributes.normal, nm = new THREE.Matrix3().getNormalMatrix(m4);
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(m4); b.pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); b.nor.push(v.x, v.y, v.z);
      }
      if (src !== g) src.dispose();
    }
    for (const k in buckets) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(buckets[k].pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(buckets[k].nor, 3));
      geo.computeBoundingSphere(); geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, mats[k]); mesh.name = 'StartingWorld_' + k;
      mesh.castShadow = k !== 'path'; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      meshes[k] = mesh; group.add(mesh);
    }
    for (const s of STARTING_SITES) s.y = H(s.x, s.z);
  }
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
  }
  function stats() { return { draws: Object.keys(meshes).length, triangles: tris, triCap: TRI_CAP, pieces: pieces.length }; }
  return { group, update, dispose, stats, sites: STARTING_SITES, paths: PATHS };
}
