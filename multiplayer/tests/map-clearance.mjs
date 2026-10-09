// Map clearance: nothing placed on the map clips through anything else. Every keep part (pylons, spires, ballistas,
// heart, barracks, fountain, gate), town and back-town building, landmark footprint, starting tree and ore deposit,
// and every town-life prop, lantern post and townsperson is a footprint circle; no two from different groups may
// overlap, and nothing may stand on a cliff (more than `slope` of rise across its footprint).
// `node tests/map-clearance.mjs --list` prints every overlap and steep placement instead of failing on the first.
import assert from 'node:assert/strict';
import {HOME_LAYOUT, HOME_SCALE, TOWN_SOLIDS, homePiece, homePoint, neutralTavern, pieceWorld} from '../shared/home-bases.js';
import {BACK_TOWN, BACK_TOWN_LANTERNS, backTownPiece, backTownPoint} from '../shared/keep-sites.js';
import {BACK_TOWN_SOLIDS} from '../shared/home-workshop.js';
import {STARTING_SITES} from '../shared/starting-world.js';
import {baseTrees} from '../shared/world-content.js';
import {createSimulation} from '../shared/simulation.js';
import {baseHeight} from '../shared/terrain.js';
import {townLifeLayout} from '../client/town-life.js';

const LIST = process.argv.includes('--list');
const items = [];
const add = (group, name, x, z, r, opts = {}) => items.push({group, name, x, z, r, ...opts});
const solids = (group, name, placed, list) => {
  for (const s of list) {
    const [x, z] = pieceWorld(placed, s.at);
    if (s.r !== undefined) add(group, name, x, z, s.r); else add(group, name, x, z, Math.hypot(...s.half), {box: [placed.yaw, ...s.half]});
  }
};
for (const side of ['party', 'rivals']) {
  const k = `keep-${side}`, P = p => homePoint(side, p), S = HOME_SCALE;
  add(k, 'heart', ...homePoint(side, [0, 0]), 3.2 * S);
  add(k, 'barracks', ...P(HOME_LAYOUT.barracks), 3.2 * S);
  add(k, 'fountain', ...P(HOME_LAYOUT.fountain), 1.9 * S);
  HOME_LAYOUT.pylons.forEach((p, i) => add(k, `pylon-${i}`, ...P(p), 1.1 * S));
  HOME_LAYOUT.spires.forEach((p, i) => add(k, `spire-${i}`, ...P(p), 1.2 * S));
  HOME_LAYOUT.ballistas.forEach((p, i) => add(k, `ballista-${i}`, ...P(p), 2.2 * S, {cliff: true}));
  HOME_LAYOUT.gatePillars.forEach((p, i) => add(k, `gate-${i}`, ...P(p), .9 * S));
  for (const name of ['tavern', 'mill', 'quartermaster']) solids(k, name, homePiece(side, name), TOWN_SOLIDS[name]);
  for (const name of Object.keys(BACK_TOWN)) solids(k, `back-${name}`, backTownPiece(side, name), BACK_TOWN_SOLIDS[name]);
  BACK_TOWN_LANTERNS.forEach((at, i) => add(k, `back-lantern-${i}`, ...backTownPoint(side, at), .2));
}
solids('mug', 'tavern', neutralTavern(), TOWN_SOLIDS.neutralTavern);
for (const s of STARTING_SITES) s.footprints.forEach((f, i) => add(`site-${s.id}`, `${f.kind}-${i}`, f.x, f.z, Math.hypot(f.w, f.d) / 2, {box: [f.rotY, f.w / 2, f.d / 2], sign: 1}));
baseTrees.forEach(([x, z], i) => add('trees', `tree-${i}`, x, z, .8));
createSimulation({seed: 3}).adventureWorld().deposits.forEach(d => add('deposits', `${d.kind}-${d.id}`, d.x, d.z, 1.3, {cliff: true}));
const L = townLifeLayout();
L.props.forEach((p, i) => add('town-life', `${p.kind}-${i}`, p.x, p.z, p.kind === 'bench' ? .7 : .45, {decor: true}));
L.posts.forEach((p, i) => add('town-life', `post-${i}`, p.x, p.z, .25, {decor: true, cliff: true}));
L.folk.filter(f => !f.route).forEach((f, i) => add('town-life', `${f.role}-${i}`, f.x, f.z, .3, {decor: true, folk: true}));

// Signed gap between two footprints (negative = overlap depth). Boxes are [yaw, halfU, halfV] about (x, z); landmark
// boxes turn with the opposite sign (shared/starting-world.js local()), keep pieces like pieceLocal().
function corners(it) {
  const [yaw, hu, hv] = it.box, c = Math.cos(yaw), s = Math.sin(yaw);
  return [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]].map(([u, v]) => it.sign ? [it.x + u * c + v * s, it.z - u * s + v * c] : [it.x + u * c + v * s, it.z - u * s + v * c]);
}
function boxCircle(b, cx, cz, r) {
  const [yaw, hu, hv] = b.box, c = Math.cos(yaw), s = Math.sin(yaw), dx = cx - b.x, dz = cz - b.z;
  const u = dx * c - dz * s, v = dx * s + dz * c, qu = Math.abs(u) - hu, qv = Math.abs(v) - hv;
  return Math.hypot(Math.max(qu, 0), Math.max(qv, 0)) + Math.min(Math.max(qu, qv), 0) - r;
}
function separation(a, b) {
  if (!a.box && !b.box) return Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;
  if (a.box && !b.box) return boxCircle(a, b.x, b.z, b.r);
  if (!a.box && b.box) return boxCircle(b, a.x, a.z, a.r);
  // Box against box: the deepest corner of either inside the other (good enough for axis-ish footprints).
  return Math.min(...corners(a).map(([x, z]) => boxCircle(b, x, z, 0)), ...corners(b).map(([x, z]) => boxCircle(a, x, z, 0)), Math.hypot(a.x - b.x, a.z - b.z) - Math.min(a.box[1], a.box[2]) - Math.min(b.box[1], b.box[2]));
}
const overlaps = [];
for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
  const a = items[i], b = items[j];
  if (a.group === b.group) continue;
  // Townsfolk stand inside their buildings (behind counters, at tables): only props and posts must keep clear.
  if ((a.folk && !b.decor) || (b.folk && !a.decor)) continue;
  const gap = separation(a, b);
  if (gap < -.05) overlaps.push(`${a.group}/${a.name} x ${b.group}/${b.name}: ${(-gap).toFixed(2)} m deep at [${a.x.toFixed(1)}, ${a.z.toFixed(1)}]`);
}
// Props inside the buildings they dress are fine only when they sit outside every solid of another building.
const steep = [];
for (const it of items.filter(i => i.cliff)) {
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2, h = baseHeight(it.x + Math.cos(a) * it.r, it.z + Math.sin(a) * it.r); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  if (hi - lo > Math.max(.6, it.r * .45)) steep.push(`${it.group}/${it.name} sits on a ${(hi - lo).toFixed(2)} m slope at [${it.x.toFixed(1)}, ${it.z.toFixed(1)}]`);
}
if (LIST) { console.log(`${items.length} footprints`); for (const o of [...overlaps, ...steep]) console.log(o); }
else {
  assert.deepEqual(overlaps, [], 'placements overlap');
  assert.deepEqual(steep, [], 'placements stand on cliffs');
  console.log(`map clearance: ${items.length} footprints, no overlaps, nothing on a cliff`);
}
