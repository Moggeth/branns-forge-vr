// Mountain-foot ore veins: a fixed set of shared, roaming mineral nodes along the walkable rim of the Orchard.
// Each slot holds at most one vein. When a vein is mined out it waits a few minutes, then a fresh vein rises
// somewhere else in the slot's stretch of the rim (World of Warcraft style). Everyone sees the same node; the first
// pick to break it gets the ore. Rarity is tiered by depth: copper and iron along the meadow edge, gold and mithril
// further in, rare star veins up on the mountain foot itself.
// Deterministic: no clock or RNG, only state.seed, slot and tick, so replays and peers agree.
import {DEPOSIT_CATALOG} from './material-catalog.js';
import {STARTING_SITES} from './starting-world.js';
import {worldTrees} from './world-content.js';

export const VEIN_RULES = Object.freeze({
  slots: 12,
  inner: 38.5, outer: 47.4,       // Chebyshev band: meadow edge -> as high on the mountain foot as heroes can walk
  respawn: [10800, 18000],        // 3-5 minutes at 60 Hz
  check: 30,                      // ticks between vein checks
  heroClear: 10,                  // a respawn never rises within this distance of a Hero
  spacing: 7, moveAway: 14, attempts: 24, slope: 1.05,
});
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// depth 0 = meadow edge, 1 = deepest walkable mountain foot.
export const VEIN_TIERS = Object.freeze([
  Object.freeze({kind: 'copper', tier: 'common', weight: d => 1.1 - .55 * d}),
  Object.freeze({kind: 'iron', tier: 'common', weight: () => .85}),
  Object.freeze({kind: 'gold', tier: 'uncommon', weight: d => .55 * ss(.2, .7, d)}),
  Object.freeze({kind: 'mithril', tier: 'uncommon', weight: d => .5 * ss(.35, .85, d)}),
  Object.freeze({kind: 'star', tier: 'rare', weight: d => .9 * ss(.68, 1, d)}),
]);
export const isVein = d => Number.isInteger(d?.vein);

const hash = (seed, n) => { let x = (seed ^ Math.imul(n + 1, 0x9e3779b9)) >>> 0; x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return x >>> 0; };
const unit = (seed, n) => hash(seed, n) / 4294967296;
const key = (slot, tick, k) => Math.imul(slot + 1, 0x27d4eb2d) ^ Math.imul(tick + 7, 0x165667b1) ^ Math.imul(k + 3, 0x9e3779b1);

/** Unit-square perimeter point with max(|x|,|z|) = 1, u in [0, 4). */
function squarePoint(u) {
  const k = Math.floor(u) & 3, f = u - Math.floor(u);
  return k === 0 ? [-1 + 2 * f, -1] : k === 1 ? [1, -1 + 2 * f] : k === 2 ? [1 - 2 * f, 1] : [-1, 1 - 2 * f];
}
export function veinKind(depth, roll) {
  const w = VEIN_TIERS.map(t => Math.max(0, t.weight(depth))), total = w.reduce((a, b) => a + b, 0);
  let r = roll * total;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return VEIN_TIERS[i].kind; }
  return VEIN_TIERS[0].kind;
}
export const veinRespawnTicks = (seed, slot, tick) => VEIN_RULES.respawn[0] + Math.floor(unit(seed, key(slot, tick, 99)) * (VEIN_RULES.respawn[1] - VEIN_RULES.respawn[0]));

/** Candidate spot for a slot; null when every attempt is blocked. */
export function placeVein(state, ctx, slot, {previous = null, initial = false} = {}) {
  const R = VEIN_RULES, seed = state.seed | 0, tick = state.tick | 0;
  const live = (state.deposits || []).filter(d => !d.depleted), trees = worldTrees(state);
  for (let a = 0; a < R.attempts; a++) {
    // Later attempts roam twice as far along the rim, so a slot whose stretch lies under a keep's dome still finds ground.
    const u = (((slot + .5 + (unit(seed, key(slot, tick, a * 4)) - .5) * (a < R.attempts / 2 ? 1.5 : 3)) / R.slots) * 4 + 4) % 4;
    const depth = unit(seed, key(slot, tick, a * 4 + 1)), s = R.inner + (R.outer - R.inner) * depth;
    const [px, pz] = squarePoint(u), x = +(px * s).toFixed(3), z = +(pz * s).toFixed(3);
    if (previous && Math.hypot(previous.x - x, previous.z - z) < R.moveAway) continue;
    if (live.some(d => Math.hypot(d.x - x, d.z - z) < R.spacing) || (state.deposits || []).some(d => Math.hypot(d.x - x, d.z - z) < 3)) continue;
    if (!initial && (state.players || []).some(p => p.role === 'hero' && Math.hypot(p.position[0] - x, p.position[2] - z) < R.heroClear)) continue;
    if (state.landmarks && STARTING_SITES.some(q => Math.hypot(q.x - x, q.z - z) < q.radius + 2)) continue;
    if ((state.bridges || []).some(b => Math.hypot(b.x - x, b.z - z) < 4) || ctx.canPlace?.(x, z) === false) continue;
    if (trees.some(t => Math.hypot(t.x - x, t.z - z) < 3)) continue; // clear of trunks and canopies' feet
    const y = ctx.terrainHeight(state, x, z);
    if (!Number.isFinite(y) || Math.abs(y) > 180) continue;
    const e = .8, grad = Math.max(...[[e, 0], [-e, 0], [0, e], [0, -e]].map(([dx, dz]) => Math.abs(ctx.terrainHeight(state, x + dx, z + dz) - y) / e));
    if (!(grad <= R.slope)) continue;
    return {x, z, y, depth, kind: veinKind(depth, unit(seed, key(slot, tick, a * 4 + 2)))};
  }
  return null;
}

/** Root calls once per simulation tick. Starts depleted veins' timers and raises replacements. */
export function stepVeins(state, ctx, events = []) {
  const R = VEIN_RULES;
  if (!Number.isSafeInteger(state.tick) || state.tick <= 0 || (state.tick % R.check && state.tick !== 1) || !Array.isArray(state.deposits)) return 0;
  const bySlot = new Map();
  for (const d of state.deposits) if (isVein(d)) bySlot.set(d.vein, d);
  let raised = 0;
  for (let slot = 0; slot < R.slots; slot++) {
    const old = bySlot.get(slot);
    if (old && !old.depleted) continue;
    if (old && old.respawnTick === undefined) { old.respawnTick = state.tick + veinRespawnTicks(state.seed | 0, slot, state.tick); continue; }
    if (old && state.tick < old.respawnTick) continue;
    // The spent vein becomes an ordinary depleted tombstone, or vanishes when nothing references it.
    const drop = !!old && ctx.retained?.({...old, vein: undefined, respawnTick: undefined}) === false;
    if (state.deposits.length + (state.pendingStarfalls?.length || 0) - (drop ? 1 : 0) >= 80) continue; // shared deposit budget
    const spot = placeVein(state, ctx, slot, {previous: old, initial: !old});
    if (!spot) continue;
    if (old) { delete old.vein; delete old.respawnTick; if (drop) state.deposits.splice(state.deposits.indexOf(old), 1); }
    const id = `vein${slot}t${state.tick}`, c = DEPOSIT_CATALOG[spot.kind];
    state.deposits.push({id, x: spot.x, z: spot.z, kind: spot.kind, hits: 0, maxHits: c.maxHits, depleted: false, vein: slot});
    events.push({kind: 'geology_emerge', id, material: c.resource, position: [spot.x, spot.y, spot.z], tick: state.tick, vein: true});
    raised++;
  }
  return raised;
}

/** Save validation for the optional vein fields. Throws on malformed values. */
export function validateVein(d, tick, slots) {
  if (d.vein === undefined) { if (d.respawnTick !== undefined && d.seam === undefined) throw Error('Invalid vein'); return; } // salt seams keep their own timer
  if (!Number.isInteger(d.vein) || d.vein < 0 || d.vein >= VEIN_RULES.slots || slots.has(d.vein) || !Object.hasOwn(DEPOSIT_CATALOG, d.kind)) throw Error('Invalid vein');
  if (d.respawnTick !== undefined && (!d.depleted || !Number.isSafeInteger(d.respawnTick) || d.respawnTick < 0 || d.respawnTick > tick + VEIN_RULES.respawn[1])) throw Error('Invalid vein');
  slots.add(d.vein);
}
