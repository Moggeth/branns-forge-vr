// Where God growth spells put their trees. Each tree aims for its spot in the spell's pattern, then takes the
// nearest open ground within reach: crowns never swallow each other, trunks stay off rocks, buildings, landmarks
// and Heroes. A cast is refused only when not one tree fits. Pure and deterministic: the aimed preview and the
// authority run the same plan on the same world, so the preview shows exactly the trees that will grow.
import {thingLimit} from './world-extent.js';
import {worldTrees} from './world-content.js';
import {STARTING_SITES} from './starting-world.js';
import {VARIANTS, TREE_PROFILES} from './trees.js';
// Same as spells.js FORGE_APRON / GROVE_EDGE (not imported: ents.js uses this module and spells.js imports ents.js).
const FORGE_APRON = 7, GROVE_EDGE = 51;

// Authored crown half-widths (metres at authored scale, from the tree contract bounding boxes).
const CROWN = {tree: 2.7, tree_b: 2.9, tree_young: 1.55};
export const GROWTH = Object.freeze({
  // Crowns may brush (a real orchard touches) but centres keep 80% of the two crown radii apart.
  gapFactor: .92, step: .7,
  grove: {count: 5, spread: 3.9, shift: 3.5, mix: [0, 1, 2, 0, 2]},
  ring: {count: 8, spread: 5.9, shift: 2.4, mix: [1, 2, 0, 2, 1, 2, 0, 2]},
  // Growth Wave: a rectangle of trees rising in order from the start of the drag to its end.
  wave: {width: 6, maxLength: 18, minLength: 4, tapLength: 12, rows: 2, along: 4.6, offset: 2.3, shift: 2.8, maxTrees: 12, metresPerTick: .2},
  clear: {deposit: 1.6, structure: 3.5, hero: 1.5, landmark: 1},
});

const hash = (a, b) => { let x = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x632be5ab, 0x85ebca77)) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; return x >>> 0; };
const unit = (a, b) => hash(a, b) / 4294967296;
const round = n => Math.round(n * 100) / 100;
export const crownRadius = t => (CROWN[VARIANTS[t.variant]] ?? CROWN.tree) * t.height / (TREE_PROFILES[VARIANTS[t.variant]] ?? TREE_PROFILES.tree).height;
const gap = (a, b) => GROWTH.gapFactor * (crownRadius(a) + crownRadius(b));

/** Desired spots for a spell, before obstruction: [{x,z,height,variant,delay}] with delay in ticks. */
export function growthPattern(spell, point, {start, end} = {}) {
  // A wave seeds from its line, so where the cursor settled does not change the band.
  if (spell === 'wave') point = waveLine(point, start, end)[0];
  const seedX = Math.round(point[0] * 4), seedZ = Math.round(point[2] * 4), tree = (x, z, variant, i, delay = 0) =>
    ({x, z, variant, height: round((variant === 2 ? 4.7 : 4.9) + unit(seedX + i * 31, seedZ) * 1.2), delay});
  if (spell === 'grove' || spell === 'ring') {
    const g = GROWTH[spell], turn = unit(seedX, seedZ + 7) * Math.PI * 2;
    return g.mix.map((v, i) => { const a = turn + i * Math.PI * 2 / g.count; return tree(point[0] + Math.cos(a) * g.spread, point[2] + Math.sin(a) * g.spread, v, i); });
  }
  if (spell === 'wave') {
    const w = GROWTH.wave, [a, b] = waveLine(point, start, end), dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
    const columns = Math.max(1, Math.min(Math.floor(w.maxTrees / w.rows), Math.floor(len / w.along) + 1)), out = [];
    for (let c = 0; c < columns; c++) for (let r = 0; r < w.rows; r++) {
      // Staggered rows: a hedge-like band, not a grid. Jitter is seeded by the aim, so the preview matches.
      const i = c * w.rows + r, step = columns > 1 ? Math.min(w.along, len / (columns - .5)) : 0, s = columns > 1 ? (len - step * (columns - .5)) / 2 + (c + (r ? .5 : 0)) * step : len / 2, off = (r ? 1 : -1) * w.offset + (unit(seedX + i, seedZ + 3) - .5) * .5;
      const along = Math.min(len, s + (unit(seedX, seedZ + i) - .5) * .6), v = [0, 1, 2][hash(seedX + i * 7, seedZ) % 3];
      out.push(tree(a[0] + ux * along - uz * off, a[2] + uz * along + ux * off, v, i, Math.round(along / w.metresPerTick)));
    }
    return out;
  }
  return [];
}

/** The wave's start and end, shortened to the maximum length (a tap grows a default band across the aim). */
export function waveLine(point, start, end) {
  const w = GROWTH.wave;
  if (!start || !end || Math.hypot(end[0] - start[0], end[2] - start[2]) < w.minLength) return [[point[0] - 6, point[1], point[2]], [point[0] + 6, point[1], point[2]]];
  const dx = end[0] - start[0], dz = end[2] - start[2], d = Math.hypot(dx, dz), k = Math.min(1, w.maxLength / d);
  return [start, [start[0] + dx * k, end[1], start[2] + dz * k]];
}

function occupancy(state, heroes) {
  const cell = 4, grid = new Map(), key = (i, j) => i * 1000 + j;
  const add = t => { const k = key(Math.floor(t.x / cell), Math.floor(t.z / cell)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t); };
  for (const t of worldTrees(state)) add(t);
  // Trees still waiting in a wave count too, so two waves never stack.
  for (const g of state.groves || []) for (const t of g.trees || []) if ((t[4] ?? 0) > state.tick) add({x: t[0], z: t[1], height: t[2], variant: t[3]});
  const near = (x, z, f) => { const ci = Math.floor(x / cell), cj = Math.floor(z / cell); for (let i = ci - 2; i <= ci + 2; i++) for (let j = cj - 2; j <= cj + 2; j++) for (const t of grid.get(key(i, j)) || []) if (f(t)) return true; return false; };
  const deposits = (state.deposits || []).filter(d => !d.depleted), structures = state.inventions?.structures || [];
  const people = heroes ? (state.players || []).filter(p => p.role === 'hero') : [], c = GROWTH.clear;
  return {
    add,
    free(t) {
      const {x, z} = t;
      if (Math.abs(x) > GROVE_EDGE || Math.abs(z) > GROVE_EDGE || Math.hypot(x, z) < FORGE_APRON) return false;
      if (state.landmarks && STARTING_SITES.some(s => Math.hypot(x - s.x, z - s.z) < s.radius + c.landmark)) return false;
      if (deposits.some(d => Math.hypot(d.x - x, d.z - z) < c.deposit)) return false;
      if (structures.some(b => Math.hypot(b.position[0] - x, b.position[2] - z) < c.structure)) return false;
      if (people.some(p => Math.hypot(p.position[0] - x, p.position[2] - z) < c.hero)) return false;
      return !near(x, z, o => Math.hypot(o.x - x, o.z - z) < gap(o, t));
    },
  };
}

// Nearest open spot to `want` within `shift` metres, searched outward in rings; null when none.
function nearestFree(room, want, shift, turn) {
  for (let ring = 0; ring * GROWTH.step <= shift; ring++) {
    const r = ring * GROWTH.step, n = ring ? Math.max(6, Math.round(Math.PI * 2 * r / GROWTH.step)) : 1;
    for (let k = 0; k < n; k++) {
      const a = turn + k * Math.PI * 2 / n, t = {...want, x: round(want.x + Math.cos(a) * r), z: round(want.z + Math.sin(a) * r)};
      if (room.free(t)) return t;
    }
  }
  return null;
}

/** The trees a growth spell will actually grow here: each takes the open spot nearest its aim, or is skipped. */
export function growthPlan(state, spell, point, {start, end} = {}) {
  const shift = (GROWTH[spell] || GROWTH.grove).shift, room = occupancy(state, true), placed = [], seed = spell === 'wave' ? waveLine(point, start, end)[0] : point;
  for (const [i, want] of growthPattern(spell, point, {start, end}).entries()) {
    const t = nearestFree(room, want, shift, unit(i, Math.round(seed[0] * 4) + Math.round(seed[2] * 4)) * Math.PI * 2);
    if (t) { room.add(t); placed.push(t); }
  }
  return placed;
}

/** One tree (an Ent taking root, say) under the same spacing rule: the open spot nearest it, or null. */
export const findTreeSpot = (state, tree, shift = 2.1, heroes = true) => nearestFree(occupancy(state, heroes), tree, shift, 0);

/** Save/restore check for a grove's grown trees: [[x, z, height, variant, appearTick?], ...]. */
export function validGroveTrees(trees, tick) {
  return Array.isArray(trees) && trees.length >= 1 && trees.length <= GROWTH.wave.maxTrees && trees.every(t => Array.isArray(t) && (t.length === 4 || t.length === 5) &&
    Number.isFinite(t[0]) && Number.isFinite(t[1]) && Math.abs(t[0]) <= thingLimit() && Math.abs(t[1]) <= thingLimit() && Number.isFinite(t[2]) && t[2] >= 3 && t[2] <= 9 &&
    [0, 1, 2].includes(t[3]) && (t.length === 4 || (Number.isSafeInteger(t[4]) && t[4] >= 0 && t[4] <= tick + 600)));
}
