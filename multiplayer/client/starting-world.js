// Starting meadow landmarks. Pure source-authored low-poly; no binaries, no lights, no physics.
// createStartingWorld({THREE, scene, height}) -> { group, update(edits), tick(seconds), setLit(levels), dispose(), stats() }
// Draw calls: one merged mesh per shared material (<= 6) plus the sanctuary's live pieces (runes, hoop, tuning
// crystal: 4). Triangles are capped (see stats()).
import * as art from './sanctuary-art.js';
import * as oc from './outcrop-art.js';
import {GEODES} from '../shared/geode-outcrop.js';
import * as wa from './watch-arch-art.js';
import {BEACON_HEARTH} from '../shared/watch-beacon.js';

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

const TRI_CAP = 48000; // ~15k code-built, ~38k with the landmark kit; the cap guards against runaway layouts

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
    wood: new THREE.MeshStandardMaterial({ color: 0x7a5432, roughness: 0.88, flatShading: true, vertexColors: true }),
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
  const runes = [], clusters = []; let hoopAt = null, tuneAt = null, beaconAt = null; // sanctuary live-piece anchors, filled by the layout below
  // Piece list: {mat, geo, x, z, y (above ground), sx,sy,sz, rx,ry,rz}. Ground sampled per piece at build.
  const pieces = [];
  const P = (mat, geo, x, z, y, s, r = [0, 0, 0], id = null) => pieces.push({ mat, geo, x, z, y, s, r, id });
  // Sanctuary kit (assets/landmarks-20261004, loaded by game.js): K swaps the last piece for its kit version once the
  // kit is installed (null hides it); PK adds a piece that only exists with the kit. Kit materials: kStone, kMoss, ...
  const K = (alt) => { pieces[pieces.length - 1].alt = alt; };
  const PK = (...a) => { P(...a); pieces[pieces.length - 1].kitOnly = true; };
  const KC = (mat, geo) => { const last = pieces[pieces.length - 1]; pieces.push({...last, ...last.alt, alt: undefined, mat, geo, kitOnly: true}); }; // kit companion on the same transform
  const KIT_MENHIRS = [['Menhir_A', 3.0], ['Menhir_B', 3.5], ['Menhir_C', 3.9], ['Menhir_D', 4.3]];
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
      const [kitName, kitH] = KIT_MENHIRS.reduce((b, m) => Math.abs(m[1] - h - 0.3) < Math.abs(b[1] - h - 0.3) ? m : b), sy = (h + 0.3) / kitH;
      K({mat: 'kStone', geo: 'k:' + kitName, s: [1, sy, 1]});
      const moss = 'moss' + i; prim[moss] ||= art.mossGeometry(40 + i);
      P('moss', moss, x + Math.cos(a) * 0.15, z + Math.sin(a) * 0.15, 0.02, [0.85, 0.32, 0.6], [0, r() * 6, 0]);
      K({mat: 'kMoss', geo: 'k:Moss_' + 'ABC'[i % 3], x: x + Math.cos(a) * 0.4, z: z + Math.sin(a) * 0.4, y: 0.05, s: [1, 1, 1]});
      if (i % 3 === 0) { P('moss', moss, x, z, h - 0.45, [0.5, 0.22, 0.36], [lean * 0.5, rotY, 0]); K(null); }
      runes.push({stone: runes.length, x, z, rotY, tilt: [lean * 0.5, roll * 0.6], face: prim[geo].userData.face, kit: {name: kitName, sy}});
      foot(site, 'stone', x, z, 0.9, 0.55, rotY, h);
    }
    // Trilithon gateway on the east side, toward the path. Hoop hangs in the opening (live group).
    const gx = site.x + 6.3, gz = site.z;
    prim.post0 = art.menhirGeometry(611, {w: 0.8, h: 4.0, d: 0.72, taper: 0.88, crown: 0.02, rough: 0.05});
    prim.post1 = art.menhirGeometry(612, {w: 0.8, h: 4.0, d: 0.72, taper: 0.88, crown: 0.02, rough: 0.05});
    prim.lintel = art.lintelGeometry(613, {w: 1.0, h: 0.62, len: 3.5});
    prim.seam = art.crystalPointGeometry(1, 0.1);
    prim.mossCap = art.mossGeometry(77);
    P('stone', 'post0', gx, gz - 1.2, -0.3, [1, 1, 1], [0, Math.PI / 2, 0]); K({mat: 'kStone', geo: 'k:Post_A', y: 0});
    P('stone', 'post1', gx, gz + 1.2, -0.3, [1, 1, 1], [0, -Math.PI / 2, 0]); K({mat: 'kStone', geo: 'k:Post_B', y: 0});
    P('stone', 'lintel', gx, gz, 3.95, [1, 1, 1], [0, 0, 0.03]); K({mat: 'kStone', geo: 'k:Lintel', y: 4.2, r: [0, Math.PI / 2, 0]});
    PK('kCrystal', 'k:LintelSeam', gx, gz, 4.2, [1, 1, 1], [0, Math.PI / 2, 0]);
    P('moss', 'mossCap', gx + 0.05, gz - 0.5, 4.22, [0.55, 0.2, 1.25], [0, 0.1, 0]); K({mat: 'kMoss', geo: 'k:Moss_B', y: 4.78, s: [0.9, 0.9, 1.5]});
    for (let k = 0; k < 7; k++) { const t = (k - 3) / 3, len = 0.42 - Math.abs(t) * 0.22;
      P('crystal', 'seam', gx + (k % 2 ? 0.07 : -0.07), gz + t * 1.15, 3.78, [1, len, 1], [Math.PI + (k % 2 ? 0.25 : -0.25), 0, t * 0.4]); K(null); }
    for (const side of [-1, 1]) PK('kBronze', 'k:Chain', gx - 0.05, gz + side * 0.49, 4.22, [1, 1.1, 1]); // the hoop's chains (the hoop itself is live)
    hoopAt = {x: gx - 0.05, z: gz, y: 2.5};
    foot(site, 'stone', gx, gz - 1.2, 0.8, 0.7, 0, 4); foot(site, 'stone', gx, gz + 1.2, 0.8, 0.7, 0, 4);
    // Geode altar with crystal points in its bowl; the tuning crystal floats above it (live).
    prim.altar = art.altarGeometry(321); prim.bowlPoint = art.crystalPointGeometry(1, 0.11);
    P('stone', 'altar', site.x, site.z, -0.05, [1, 1, 1], [0, 0.2, 0], 'waygateAltar'); K({mat: 'kStone', geo: 'k:Altar', y: 0});
    PK('kCrystal', 'k:AltarCrystals', site.x, site.z, 0, [1, 1, 1], [0, 0.2, 0], 'waygateAltar');
    for (let k = 0; k < 9; k++) { const b = k / 9 * Math.PI * 2, rr = k % 2 ? 0.42 : 0.6, len = k % 2 ? 0.55 : 0.36;
      P('crystal', 'bowlPoint', site.x + Math.cos(b) * rr, site.z + Math.sin(b) * rr, 1.02, [1, len, 1], [Math.sin(b) * 0.55, 0, -Math.cos(b) * 0.55], 'waygateAltar'); K(null); }
    tuneAt = {x: site.x, z: site.z, y: 2.05};
    foot(site, 'altar', site.x, site.z, 2.8, 2.8, 0, 1);
    for (let i = 0; i < 6; i++) { const a = r() * 6.28, d = 8 + r() * 3, k = 'mossRock' + i; prim[k] = art.mossGeometry(60 + i);
      P('moss', k, site.x + Math.cos(a) * d, site.z + Math.sin(a) * d, 0.0, [0.5 + r() * 0.5, 0.26, 0.5 + r() * 0.4], [0, r() * 6, 0]);
      const big = 0.9 + (i % 3) * 0.2; K(i % 2 ? {mat: 'kMoss', geo: 'k:Moss_' + 'ABC'[i % 3], s: [big * 0.8, 1, big * 0.8]} : {mat: 'kStone', geo: 'k:Rubble_' + 'ABC'[i % 3], y: 0.05, s: [big, big, big]}); }
    // A toppled menhir fragment by the open gap, half sunk in the turf.
    prim.fallen = art.menhirGeometry(955, {w: 0.8, h: 1.9, d: 0.5, taper: 0.8});
    P('stone', 'fallen', site.x + 3.6, site.z - 4.4, 0.18, [1, 1, 1], [Math.PI / 2 - 0.08, 0.7, 0.1]); K({mat: 'kStone', geo: 'k:Menhir_A', y: 0.22, s: [0.85, 0.62, 0.85]});
  }

  // --- East: Crystal Outcrop, a living geode. Geode boulders split along violet seams; six crystal clusters in crust
  // cups (live: they crack, glow, break and regrow, see shared/geode-outcrop.js); a mine head with a pulley over a shaft
  // and a plank ore cart on spoked wheels, on the approach side toward the forge.
  {
    const site = STARTING_SITES[1]; site.footprints.length = 0; const r = rng(202);
    const mound = [[0, 0, 3.2, 2.2], [2.4, -1.5, 2.2, 1.6], [-2.2, 1.2, 2.0, 1.4], [1.0, 2.6, 1.6, 1.1], [-1.6, -2.4, 1.5, 1.0]];
    mound.forEach(([dx, dz, w, h], i) => {
      const k = 'geodeBoulder' + i; prim[k] = oc.geodeBoulderGeometry(300 + i * 13);
      P('stone', k, site.x + dx, site.z + dz, h * 0.3, [w * 0.95, h * 0.72, w * 0.88], [r() * 0.3, r() * 6, r() * 0.3]);
      K({mat: 'kStone', geo: 'k:GeodeBoulder_' + 'ABC'[i % 3]}); KC('kCrystal', 'k:GeodeBoulder_' + 'ABC'[i % 3] + '_Crystals');
      foot(site, 'rock', site.x + dx, site.z + dz, w * 1.6, w * 1.5, 0, h);
    });
    prim.geodeCup = oc.cupGeometry(41);
    for (const g of GEODES) {
      P('stone', 'geodeCup', g.x, g.z, g.lift + 0.12, [g.size * 0.42, g.size * 0.36, g.size * 0.42], [0, g.index, 0], g.id); K({mat: 'kStone', geo: 'k:Cup'});
      clusters.push({x: g.x, z: g.z, lift: g.lift + 0.05, size: g.size, id: g.id});
    }
    for (const g of GEODES) if (!g.lift) foot(site, 'crystal', g.x, g.z, g.size * 0.9, g.size * 0.9, 0, g.size * 1.4); // ground clusters are solid
    // Mine head on the approach side (west, toward the forge).
    const mx = site.x - 4.2, mz = site.z - 2.2;
    prim.minePost = oc.timberGeometry(0.3, 2.9, 0.3, 7); prim.mineBeam = oc.timberGeometry(0.34, 0.3, 2.7, 8);
    prim.mineBrace = oc.timberGeometry(0.14, 1.3, 0.14, 9); prim.shaftRim = oc.timberGeometry(1.5, 0.22, 0.22, 10, 3);
    prim.shaftHole = new THREE.PlaneGeometry(1.25, 1.25); prim.shaftHole.rotateX(-Math.PI / 2);
    prim.shaftHole.setAttribute('color', new THREE.Float32BufferAttribute(Array(prim.shaftHole.attributes.position.count * 3).fill(0.08), 3));
    const mineFrom = pieces.length;
    for (const s of [-1, 1]) {
      P('wood', 'minePost', mx, mz + s, 1.3, [1, 1, 1]);
      P('wood', 'mineBrace', mx, mz + s * 0.62, 2.15, [1, 1, 1], [s * 0.75, 0, 0]);
    }
    P('wood', 'mineBeam', mx, mz, 2.82, [1, 1, 1]);
    for (const [ox, oz, ry] of [[0, -0.64, 0], [0, 0.64, 0], [-0.64, 0, Math.PI / 2], [0.64, 0, Math.PI / 2]]) P('wood', 'shaftRim', mx + ox, mz + oz, 0.1, [1, 1, 1], [0, ry, 0]);
    PK('kWood', 'k:MineHead', mx, mz, 0.1, [1, 1, 1]); KC('kBronze', 'k:MineHead_Iron');
    P('stone', 'shaftHole', mx, mz, 0.17, [1, 1, 1]);
    const pulley = oc.wheelGeometries(0.42, 0.12, 6); prim.pulleyWood = pulley.wood; prim.pulleyTyre = pulley.tyre;
    P('wood', 'pulleyWood', mx, mz, 2.45, [1, 1, 1], [0, Math.PI / 2, 0]); P('bronze', 'pulleyTyre', mx, mz, 2.45, [1, 1, 1], [0, Math.PI / 2, 0]);
    prim.rope = oc.timberGeometry(0.035, 1.9, 0.035, 11); P('wood', 'rope', mx, mz + 0.4, 1.32, [1, 1, 1]);
    prim.pail = new THREE.CylinderGeometry(0.16, 0.12, 0.26, 8); P('bronze', 'pail', mx, mz + 0.4, 0.42, [1, 1, 1]);
    // Ore cart: planked tub on four spoked wheels, heaped with crystal.
    const cx = mx - 1.3, cz = mz + 2.1, cy = 0.3, yaw = 0.3, at = (lx, lz) => [cx + lx * Math.cos(yaw) + lz * Math.sin(yaw), cz - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
    prim.cartFloor = oc.timberGeometry(1.3, 0.08, 0.84, 12, 4); prim.cartSide = oc.timberGeometry(1.36, 0.5, 0.07, 13, 1); prim.cartEnd = oc.timberGeometry(0.07, 0.5, 0.84, 14);
    P('wood', 'cartFloor', ...at(0, 0), cy + 0.12, [1, 1, 1], [0, yaw, 0]);
    for (const s of [-1, 1]) { P('wood', 'cartSide', ...at(0, s * 0.42), cy + 0.38, [1, 1, 1], [0, yaw, s * 0.0]); P('wood', 'cartEnd', ...at(s * 0.66, 0), cy + 0.38, [1, 1, 1], [0, yaw, 0]); }
    const wheel = oc.wheelGeometries(0.27, 0.08, 6); prim.cartWheel = wheel.wood; prim.cartTyre = wheel.tyre;
    for (const sx of [-0.42, 0.42]) for (const sz of [-0.47, 0.47]) { P('wood', 'cartWheel', ...at(sx, sz), 0.27, [1, 1, 1], [0, yaw, 0]); P('bronze', 'cartTyre', ...at(sx, sz), 0.27, [1, 1, 1], [0, yaw, 0]); }
    prim.cartHeap = art.crystalPointGeometry(1, 0.12);
    for (let k = 0; k < 6; k++) { const [hx, hz] = at((k % 3 - 1) * 0.35, (k < 3 ? -0.15 : 0.18)); P('crystal', 'cartHeap', hx, hz, cy + 0.2, [1, 0.35 + (k % 2) * 0.2, 1], [(r() - 0.5) * 1.2, r() * 6, (r() - 0.5) * 1.2]); }
    PK('kWood', 'k:OreCart', cx, cz, 0.15, [1, 1, 1], [0, yaw, 0]); KC('kBronze', 'k:OreCart_Iron'); KC('kCrystal', 'k:OreCart_Crystals');
    for (let k = mineFrom; k < pieces.length; k++) if (!pieces[k].kitOnly && pieces[k].geo !== 'shaftHole') pieces[k].alt = {hide: 'k:MineHead'}; // the kit's mine head and cart replace these
    foot(site, 'post', mx, mz - 1, 0.3, 0.3, 0, 2.6); foot(site, 'post', mx, mz + 1, 0.3, 0.3, 0, 2.6);
  }

  // --- North: Ruined Watch-Arch. A pointed ashlar arch whose left half still stands to the crown (the right half lies
  // in the grass), and a coursed watch-tower stump carrying a bronze fire basket: the beacon (shared/watch-beacon.js).
  // A crystal vein climbs the tower from the offering dish at its foot to the coals; the hearth ring before the arch is
  // where fallen Heroes rise while it burns. The fire, its sky beam and foe flares are live (client/beacon-view.js).
  {
    const site = STARTING_SITES[2]; site.footprints.length = 0; const r = rng(303);
    const ax = site.x, az = site.z, ys = 4.84, inner = 3.3, outer = 4.05, step = Math.PI / 3 / 5;
    prim.pierL = wa.pierGeometry(311, {w: 1.1, h: 4.6, d: 1.0}); prim.pierR = wa.pierGeometry(312, {w: 1.1, h: 3.2, d: 1.0, broken: true});
    P('stone', 'pierL', ax - 2.2, az, 0, [1, 1, 1]); P('stone', 'pierR', ax + 2.2, az, 0, [1, 1, 1], [0, 0, -0.03]);
    for (let k = 0; k < 4; k++) { // left half: four of its five voussoirs still lean to the crown
      const g = 'vous' + k; prim[g] = wa.voussoirGeometry(320 + k, inner, outer, Math.PI - (k + 1) * step, Math.PI - k * step, 1.0);
      P('stone', g, ax + 1.65, az, ys, [1, 1, 1], [0, 0, -k * 0.004]);
    }
    prim.mossPier = art.mossGeometry(81); P('moss', 'mossPier', ax - 2.3, az, ys - 0.05, [0.5, 0.18, 0.55], [0, 0.4, 0.1]);
    // Fallen voussoirs and the keystone in the grass east of the arch; the keystone carries a crystal inlay.
    const fallen = (k, seed) => { const g = wa.voussoirGeometry(seed, inner, outer, k * step, (k + 1) * step, 1.0); g.computeBoundingBox();
      const c = g.boundingBox.getCenter(new THREE.Vector3()); g.translate(-c.x, -c.y, -c.z); return g; };
    for (let i = 0; i < 4; i++) { const g = 'fallenVous' + i; prim[g] = fallen(i, 340 + i);
      P('stone', g, ax + 3.1 + r() * 2.4, az + (r() - 0.5) * 3.2, 0.32, [1, 1, 1], [Math.PI / 2 + (r() - 0.5) * 0.4, r() * 6, (r() - 0.5) * 0.5]);
      if (i % 2) P('moss', 'mossPier', ax + 3.1 + i * 0.5, az - 1 + i * 0.4, 0.05, [0.4, 0.2, 0.35], [0, r() * 6, 0]); }
    prim.keystone = fallen(4.5, 349); prim.inlay = art.crystalPointGeometry(1, 0.06);
    const kx = ax + 2.6, kz = az + 2.3; P('stone', 'keystone', kx, kz, 0.3, [1.05, 1.05, 1.05], [0.15, 0.9, Math.PI / 2 - 0.1]);
    for (let k = 0; k < 3; k++) P('crystal', 'inlay', kx + (k - 1) * 0.12, kz + 0.1, 0.62, [1, 0.3 + k % 2 * 0.15, 1], [(k - 1) * 0.4, 0, 0.2]);
    foot(site, 'pier', ax - 2.2, az, 1.1, 1.1, 0, 5); foot(site, 'pier', ax + 2.2, az, 1.1, 1.1, 0, 3.2);
    // Watch-tower stump behind the arch (north), the beacon basket on its rubble top, struck/fed as 'watchBeacon'.
    const tx = ax + 0.5, tz = az - 4.5, th = 3.2;
    prim.tower = wa.towerGeometry(361, {r: 1.6, h: th}); P('stone', 'tower', tx, tz, 0, [1, 1, 1], [0, 0.3, 0], 'watchBeacon');
    prim.basket = wa.basketGeometry(); P('bronze', 'basket', tx, tz, th - 0.25, [1, 1, 1], [0, 0.2, 0], 'watchBeacon');
    prim.coal = art.crystalPointGeometry(1, 0.08);
    for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2, d = k ? 0.26 : 0;
      P('crystal', 'coal', tx + Math.cos(a) * d, tz + Math.sin(a) * d, th - 0.25 + wa.BASKET.height - 0.12, [1, k ? 0.28 : 0.4, 1], [Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6]); }
    // Crystal vein up the arch-facing side, from the dish to the basket.
    for (let k = 0; k < 9; k++) { const y = 0.75 + k * 0.29, wob = Math.sin(k * 1.7) * 0.18;
      P('crystal', 'inlay', tx + wob, tz + 1.62, y, [1, 0.22 + (k % 3) * 0.07, 1], [Math.PI / 2 - 0.25, 0, (r() - 0.5) * 0.8], 'watchBeacon'); }
    prim.plinth = wa.plinthGeometry(371); prim.dish = wa.dishGeometry();
    P('stone', 'plinth', tx, tz + 1.85, 0, [1, 1, 1], [0, 0.1, 0], 'watchBeacon'); P('bronze', 'dish', tx, tz + 1.85, 0, [1, 1, 1], [0, 0, 0], 'watchBeacon');
    P('crystal', 'inlay', tx, tz + 1.85, 0.8, [1, 0.25, 1], [0.3, 0, 0], 'watchBeacon');
    beaconAt = {x: tx, z: tz, y: th - 0.25 + wa.BASKET.fire};
    foot(site, 'tower', tx, tz, 3.4, 3.4, 0, 3.4); foot(site, 'plinth', tx, tz + 1.85, 0.5, 0.5, 0, 0.9);
    for (let i = 0; i < 6; i++) { const a = r() * 6.28, d = 2.1 + r() * 0.6; // fallen tower stones round its foot
      P('stone', 'rock', tx + Math.cos(a) * d, tz + Math.sin(a) * d * 0.8, 0.1, [0.32 + r() * 0.2, 0.22, 0.3], [0, r() * 6, 0]); }
    // Hearth ring in front of the arch, where the beacon raises fallen Heroes.
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2;
      P('stone', 'rock', BEACON_HEARTH.x + Math.cos(a) * 0.85, BEACON_HEARTH.z + Math.sin(a) * 0.9, 0.08, [0.34, 0.16, 0.26], [0, a, 0]); }
    for (let i = 0; i < 5; i++) { const a = r() * 6.28, d = 6.5 + r() * 2.5;
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
  const meshes = {}; let tris = 0, dropped = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();

  function build() {
    for (const k in meshes) { group.remove(meshes[k]); meshes[k].geometry.dispose(); delete meshes[k]; }
    tris = 0; dropped = 0; const buckets = {};
    for (const base of pieces) {
      const a = kit ? base.alt : undefined, alt = a === null || (a?.hide ? prim[a.hide] : a && prim[a.geo]) ? (a?.hide ? null : a) : undefined; // pieces the loaded kit lacks keep the code-built one
      const p = alt === null ? null : alt ? {...base, ...alt} : base.kitOnly && !(kit && prim[base.geo]) ? null : base;
      if (!p) continue;
      const g = prim[p.geo]; const src = g.index ? g.toNonIndexed() : g;
      const triCount = src.attributes.position.count / 3;
      if (tris + triCount > TRI_CAP) { dropped++; if (src !== g) src.dispose(); continue; }
      tris += triCount;
      // Anchor: sink 0.15 into the ground so slopes never show floating bases.
      const gy = H(p.x, p.z) - 0.15;
      m4.compose(v.set(p.x, gy + p.y, p.z), q.setFromEuler(e.set(p.r[0], p.r[1], p.r[2])), sc.set(p.s[0], p.s[1], p.s[2]));
      const anchor = g.userData.anchor; // kit crystals set into a stretched boulder: placed with it, but kept in proportion
      if (anchor) { const u = Math.cbrt(p.s[0] * p.s[1] * p.s[2]) * 0.8; v.copy(anchor).applyMatrix4(m4); m4.compose(v, q, sc.set(u, u, u)); }
      const b = (buckets[p.mat] ||= { pos: [], nor: [], uv: [], targets: [] });
      if (p.id) b.targets.push([b.pos.length / 9, b.pos.length / 9 + triCount, p.id]);
      const pa = src.attributes.position, na = src.attributes.normal, ca = src.attributes.color, ua = src.attributes.uv, nm = new THREE.Matrix3().getNormalMatrix(m4);
      const b2 = (b.col ||= []);
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(m4); b.pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); b.nor.push(v.x, v.y, v.z);
        if (ca) b2.push(ca.getX(i), ca.getY(i), ca.getZ(i)); else b2.push(1, 1, 1);
        if (ua) b.uv.push(ua.getX(i), ua.getY(i)); else b.uv.push(0, 0);
      }
      if (src !== g) src.dispose();
    }
    for (const k in buckets) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(buckets[k].pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(buckets[k].nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(buckets[k].col, 3));
      if (k.startsWith('k')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(buckets[k].uv, 2)); // only kit materials are textured
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
  let runeMesh = null, clusterMesh = null; const lit = rune.uLit.value;
  const geode = oc.clusterMaterial(GEODES.length), geodeGrow = geode.uGrow.value, geodeGlow = geode.uGlow.value;
  function buildLive() {
    if (runeMesh) { live.remove(runeMesh); runeMesh.geometry.dispose(); runeMesh = null; }
    const parts = [], stoneIds = [], mm = new THREE.Matrix4(), local = new THREE.Matrix4(), qq = new THREE.Quaternion();
    for (const r of runes) {
      const f = r.face, g = kit ? kitRunes[r.stone].clone() : art.runeGeometry(r.stone);
      mm.compose(v.set(r.x, H(r.x, r.z) - 0.15 - 0.3, r.z), qq.setFromEuler(e.set(r.tilt[0], r.rotY, r.tilt[1])), sc.set(1, 1, 1));
      if (!kit) { local.compose(new THREE.Vector3(f.x, f.y, f.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, f.rotY, 0)), sc.set(1, 1, 1)); mm.multiply(local); }
      g.applyMatrix4(mm); parts.push(g);
      for (let i = 0; i < g.attributes.position.count; i++) stoneIds.push(r.stone);
    }
    if (parts.length) {
      const geo = art.mergeGeometries(parts); geo.computeVertexNormals();
      geo.setAttribute('aStone', new THREE.Float32BufferAttribute(stoneIds, 1)); geo.computeBoundingSphere();
      runeMesh = new THREE.Mesh(geo, rune.material); runeMesh.name = 'StartingWorld_runes'; runeMesh.raycast = () => {}; live.add(runeMesh);
    }
    if (hoopAt) { hoop.position.set(hoopAt.x, H(hoopAt.x, hoopAt.z) - 0.15 + hoopAt.y, hoopAt.z); hoop.rotation.set(0, Math.PI / 2, 0); live.add(hoop); }
    if (clusterMesh) { live.remove(clusterMesh); clusterMesh.geometry.dispose(); }
    if (clusters.length) {
      clusterMesh = new THREE.Mesh(oc.clusterGeometry(clusters.map(c => ({x: c.x, y: H(c.x, c.z) - 0.15 + c.lift, z: c.z, size: c.size}))), geode.material);
      clusterMesh.name = 'StartingWorld_geodes'; clusterMesh.castShadow = true;
      const ids = clusters.map(c => c.id), idx = clusterMesh.geometry.attributes.aCluster;
      clusterMesh.userData.faceTarget = f => geodeGrow[idx.getX(f * 3)] > 0.95 ? ids[idx.getX(f * 3)] : null; // stubs can't be struck
      live.add(clusterMesh);
    }
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
  // Outcrop clusters: grow 0..1 (stub..full), glow 0..1 (cracks and flashes), per cluster in GEODES order.
  function setGeodes(grow = [], glow = []) { for (let i = 0; i < geodeGrow.length; i++) { geodeGrow[i] = Math.max(0.12, Math.min(1, grow[i] ?? 1)); geodeGlow[i] = Math.max(0, Math.min(1, glow[i] || 0)); } }
  // levels: per-stone 0..1 resonance (index order = ring order, gap skipped).
  function setLit(levels = []) { for (let i = 0; i < lit.length; i++) lit[i] = Math.max(0, Math.min(1, +levels[i] || 0)); }
  // Sanctuary kit: the Blender-authored, textured version of the stones, trilithon, altar, hoop and chains
  // (assets/landmarks-20261004/build_landmarks.py). The code-built pieces stand in until it loads; ids, footprints
  // and live behaviour are the same either way.
  let kit = null, kitRunes = null;
  function installKit(gltf) {
    if (kit) return false;
    const found = {}; gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o => { if (o.isMesh) found[o.name] = o; });
    const optional = ['GeodeBoulder_A', 'GeodeBoulder_B', 'GeodeBoulder_C', 'GeodeBoulder_A_Crystals', 'GeodeBoulder_B_Crystals', 'GeodeBoulder_C_Crystals', 'Cup', 'MineHead', 'MineHead_Iron', 'OreCart', 'OreCart_Iron', 'OreCart_Crystals'];
    const need = ['Menhir_A', 'Menhir_B', 'Menhir_C', 'Menhir_D', 'Post_A', 'Post_B', 'Lintel', 'LintelSeam', 'Altar', 'AltarCrystals', 'Hoop', 'HoopInlay', 'Chain', 'TuneCrystal', 'Moss_A', 'Moss_B', 'Moss_C', 'Rubble_A', 'Rubble_B', 'Rubble_C'];
    if (need.some(n => !found[n])) return false;
    const kitMats = {};
    for (const n of [...need, ...optional.filter(n => found[n])]) {
      const o = found[n], m = o.material, key = 'k' + m.name; // Stone, Moss, Bronze, Crystal
      if (/^GeodeBoulder_._Crystals$/.test(n)) { // origin at the geode window; build() keeps them unstretched
        prim['k:' + n] = o.geometry.clone().applyMatrix4(new THREE.Matrix4().extractRotation(o.matrixWorld)); prim['k:' + n].userData.anchor = o.position.clone();
      } else prim['k:' + n] = o.geometry.clone().applyMatrix4(o.matrixWorld); // children (seams, inlay) keep their offset
      if (!kitMats[key]) { m.vertexColors = !!o.geometry.attributes.color; m.needsUpdate = true; kitMats[key] = m; }
    }
    if (!kitMats.kStone || !kitMats.kCrystal || !kitMats.kBronze || !kitMats.kMoss) { for (const k in prim) if (k.startsWith('k:')) { prim[k].dispose(); delete prim[k]; } return false; }
    Object.assign(mats, kitMats);
    // Runes follow the hewn face: each stroke vertex is pressed onto the stone's inner (-Z) surface.
    const probe = new THREE.Mesh(undefined, new THREE.MeshBasicMaterial()), ray = new THREE.Raycaster(), from = new THREE.Vector3(), dir = new THREE.Vector3(0, 0, 1);
    kitRunes = runes.map(rr => {
      const anchor = found[rr.kit.name].children.find(c => c.name === rr.kit.name + '_Rune'), g = art.runeGeometry(rr.stone, 0.62, 0.055, 6);
      probe.geometry = prim['k:' + rr.kit.name]; g.rotateY(Math.PI); g.translate(anchor?.position.x || 0, (anchor?.position.y ?? 1.6) * rr.kit.sy, 0);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        ray.set(from.set(pos.getX(i), pos.getY(i) / rr.kit.sy, -3), dir); const hit = ray.intersectObject(probe, false)[0];
        pos.setZ(i, (hit ? hit.point.z : anchor?.position.z ?? -0.3) - 0.006 + pos.getZ(i));
      }
      g.computeVertexNormals(); return g;
    });
    probe.material.dispose();
    hoopBronze.geometry = prim['k:Hoop'].clone().rotateX(Math.PI / 2); hoopBronze.material = mats.kBronze;
    hoopGlow.geometry = prim['k:HoopInlay'].clone().rotateX(Math.PI / 2); hoopGlow.material = mats.kCrystal;
    tune.geometry = prim['k:TuneCrystal']; tune.material = mats.kCrystal; tune.scale.set(1, 1, 1);
    kit = gltf; build(); return true;
  }
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
    runeMesh?.geometry.dispose(); rune.material.dispose(); clusterMesh?.geometry.dispose(); geode.material.dispose(); hoopParts.bronze.dispose(); hoopParts.glow.dispose(); tuneGeo.dispose();
    if (kit) { hoopBronze.geometry.dispose(); hoopGlow.geometry.dispose(); for (const g of kitRunes) g.dispose();
      for (const k of ['kStone', 'kMoss', 'kBronze', 'kCrystal', 'kWood']) for (const t of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) mats[k]?.[t]?.dispose(); }
  }
  function stats() { return { kit: !!kit, draws: Object.keys(meshes).length, liveDraws: (runeMesh ? 1 : 0) + (clusterMesh ? 1 : 0) + 3, triangles: tris, triCap: TRI_CAP, dropped, pieces: pieces.length, runes: runes.length }; }
  // Beacon fire anchor (world space, follows terrain edits): where client/beacon-view.js draws the flame and beam.
  const beacon = () => beaconAt && {x: beaconAt.x, y: H(beaconAt.x, beaconAt.z) - 0.15 + beaconAt.y, z: beaconAt.z};
  return { group, update, tick, setLit, setGeodes, beacon, installKit, dispose, stats, sites: STARTING_SITES, paths: PATHS };
}
