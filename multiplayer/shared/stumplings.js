// Stumplings: root critters. A settled stump eventually gets up on its roots and waddles off. Shared, deterministic
// rules only (no clock, no RNG, no Three.js): the "random" wake is a seeded hash of (room seed, stump, felled tick,
// time bucket), so every client and late joiner agrees and nothing new is saved for the stump itself.
//
// Life: wake (pull free) -> wander near home, flee heroes -> burrow after lifeTicks. Killing one drops a log and
// sometimes ore its roots were clutching. Its harvest record is released on death or burrowing; burrowing moves
// the tree root to the critter's exact position. Tree-view grows the sapling and the harvest slot is freed.
import {thingLimit} from './world-extent.js';
import {isFelled} from './trees.js';
import {clampToWorld} from './keep-sites.js';

export const STUMPLING = Object.freeze({
 minAgeTicks: 3600,     // a stump rests at least 60 s after felling before it may stir
 rollTicks: 600,        // every 10 s each settled stump rolls...
 rollChance: 1 / 30,    // ...this chance to wake (mean ~5 min after the first minute; a few sleep much longer)
 maxLive: 6,            // live critters (performance ceiling; Quest/phone)
 worldCap: 60,          // never wake when the creature list is nearly full (MAX_WORLD is 64)
 wakeTicks: 75,         // 1.25 s shuddering and pulling roots out of the soil; no movement
 lifeTicks: 5400,       // 90 s of wandering, then it burrows
 burrowTicks: 90,       // 1.5 s digging down before it is gone
 hp: 70, part: 70,
 radius: .34, height: .72,
 walk: .85, flee: 2.7,  // m/s
 fleeRadius: 5, scaredTicks: 150, homeRadius: 7,
 logs: 1, copper: .25, gold: .05,
});

/** FNV-style 32-bit mix of numbers and strings. Pure. */
export function stumpHash(...parts) {
 let h = 2166136261;
 for (const p of parts) for (const c of String(p)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
 h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
 return h >>> 0;
}
const unit = (...p) => stumpHash(...p) / 4294967296;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export const isStumpling = e => e?.kind === 'stumpling';
export const stumplingWaking = (e, tick) => tick - e.wakeTick < STUMPLING.wakeTicks;
export const stumplingBurrowTick = e => e.wakeTick + STUMPLING.lifeTicks;
export const stumplingBurrowing = (e, tick) => tick >= stumplingBurrowTick(e);
export const stumplingGoneTick = e => stumplingBurrowTick(e) + STUMPLING.burrowTicks;

/** Tree ids whose stump is currently walking around (its stump is hidden and has no collision). */
export function awakeStumps(state) {
 const out = new Set(); for (const e of state.enemies || []) if (isStumpling(e)) out.add(e.treeId); return out;
}
/** Harvest records keyed by tree id for trunk collision; a stump that is walking around is marked `awake` (skipped). */
export function treeCutMap(state) {
 const awake = awakeStumps(state), map = new Map();
 for (const h of state.harvestedTrees || []) map.set(h.id, awake.has(h.id) ? {...h, awake: true} : h);
 return map;
}

/** Would this stump wake on this tick? Pure: the same answer on every peer. */
export function stumpWakes(seed, cut, tick) {
 if (!isFelled(cut) || !cut.landed || tick % STUMPLING.rollTicks !== 0 || tick - cut.felledTick < STUMPLING.minAgeTicks) return false;
 return unit(seed, cut.id, cut.felledTick, tick / STUMPLING.rollTicks) < STUMPLING.rollChance;
}

export function createStumpling(id, tree, position, tick, seed) {
 return {id, position: [...position], kind: 'stumpling', treeId: tree.id, variant: tree.variant, wakeTick: tick, home: [tree.x, tree.z],
  yaw: wrap(unit(seed, tree.id, 'yaw') * Math.PI * 2), hp: STUMPLING.hp, parts: stumplingParts(), missingParts: [], attackTick: -1000};
}
export const stumplingParts = () => ({head: STUMPLING.part, torso: STUMPLING.part, leftArm: STUMPLING.part, rightArm: STUMPLING.part, leftLeg: STUMPLING.part, rightLeg: STUMPLING.part});

/** Forget the stump: its harvest record goes, so the tree regrows and a harvest slot frees up. */
export function releaseStump(state, treeId) {
 const i = (state.harvestedTrees || []).findIndex(h => h.id === treeId);
 if (i >= 0) state.harvestedTrees.splice(i, 1);
 return i >= 0;
}

/**
 * Wake settled stumps and retire critters whose time is up. ctx: {trees: Map|{get(id)}, terrainHeight(state,x,z), nextId(state,prefix)}.
 * Call once per tick, after enemy movement.
 */
export function stepStumplings(state, ctx, events) {
 for (const e of [...state.enemies]) {
  if (!isStumpling(e)) continue;
  if (state.tick === stumplingBurrowTick(e)) events.push({kind: 'stump_burrow', id: e.id, position: [...e.position], material: 'wood'});
  if (state.tick < stumplingGoneTick(e)) continue;
  state.enemies.splice(state.enemies.indexOf(e), 1);
  state.embeds = (state.embeds || []).filter(m => m.targetId !== e.id);
  // Keep the stable tree id (logs/fruit/save references) but move its root to the actual burrow, never a nearby spot.
  state.treeRoots ||= [];
  const root = state.treeRoots.find(t => t.id === e.treeId);
  if (root) { root.x = e.position[0]; root.z = e.position[2]; }
  else state.treeRoots.push({id: e.treeId, x: e.position[0], z: e.position[2]});
  releaseStump(state, e.treeId);
  events.push({kind: 'stump_gone', id: e.id, treeId: e.treeId, position: [...e.position]});
 }
 if (state.tick % STUMPLING.rollTicks !== 0) return;
 const awake = awakeStumps(state);
 let live = awake.size;
 for (const cut of state.harvestedTrees || []) {
  if (live >= STUMPLING.maxLive || state.enemies.length >= STUMPLING.worldCap) break;
  if (awake.has(cut.id) || !stumpWakes(state.seed, cut, state.tick)) continue;
  const tree = ctx.trees.get(cut.id); if (!tree) continue;
  const critter = createStumpling(ctx.nextId(state, 'stump'), tree, [tree.x, ctx.terrainHeight(state, tree.x, tree.z), tree.z], state.tick, state.seed);
  state.enemies.push(critter); live++;
  events.push({kind: 'stump_wake', id: critter.id, treeId: tree.id, position: [...critter.position], tick: state.tick, material: 'wood'});
 }
}

/**
 * One tick of critter movement inside stepEnemies. Never attacks: it pootles around its old stump, bolts from
 * heroes that come close or hurt it, and stands still while waking or burrowing.
 * ctx: {heroes, ground(x,z), resolve(position, radius)}.
 */
export function stepStumplingMotion(state, e, {heroes, ground, resolve}) {
 if (stumplingWaking(e, state.tick) || stumplingBurrowing(e, state.tick)) return;
 let threat = null, near = STUMPLING.fleeRadius;
 for (const h of heroes) { const d = Math.hypot(h.position[0] - e.position[0], h.position[2] - e.position[2]); if (d < near) { near = d; threat = h; } }
 const scared = state.tick - (e.hurtTick ?? -1e9) < STUMPLING.scaredTicks;
 if (!threat && scared) { let best = Infinity; for (const h of heroes) { const d = Math.hypot(h.position[0] - e.position[0], h.position[2] - e.position[2]); if (d < best) { best = d; threat = h; } } }
 let dx = 0, dz = 0, speed = 0;
 if (threat) { dx = e.position[0] - threat.position[0]; dz = e.position[2] - threat.position[2]; speed = STUMPLING.flee * (e.slowUntil > state.tick ? .4 : 1); }
 else {
  // Wander in 2.5 s legs: a seeded heading, a pause now and then, and a pull back home when it strays.
  const leg = Math.floor((state.tick - e.wakeTick) / 150), r = unit(e.id, leg);
  const hx = e.home[0] - e.position[0], hz = e.home[1] - e.position[2], away = Math.hypot(hx, hz);
  if (away > STUMPLING.homeRadius) { dx = hx; dz = hz; speed = STUMPLING.walk * 1.2; }
  else if (r < .7) { const a = unit(e.id, leg, 'a') * Math.PI * 2; dx = Math.sin(a); dz = Math.cos(a); speed = STUMPLING.walk; }
 }
 const length = Math.hypot(dx, dz); if (length < 1e-6 || speed <= 0) return;
 dx /= length; dz /= length;
 const desired = Math.atan2(-dx, -dz); e.yaw = wrap(e.yaw + clamp(wrap(desired - e.yaw), -.2, .2));
 // A small deterministic fan steers around trunks and steps, like the other creatures.
 for (const angle of [0, .6, -.6, 1.2, -1.2, 1.9, -1.9]) {
  const c = Math.cos(angle), s = Math.sin(angle), x = dx * c - dz * s, z = dx * s + dz * c;
  const [px, pz] = clampToWorld(e.position[0] + x * .5, e.position[2] + z * .5), probe = [px, e.position[1], pz], before = [...probe];
  resolve(probe, STUMPLING.radius, STUMPLING.height);
  if (Math.hypot(probe[0] - before[0], probe[2] - before[2]) > .025 || Math.abs(ground(probe[0], probe[2]) - e.position[1]) > .6) continue;
  [e.position[0], e.position[2]] = clampToWorld(e.position[0] + x * speed / 60, e.position[2] + z * speed / 60);
  break;
 }
 resolve(e.position, STUMPLING.radius, STUMPLING.height); e.position[1] = ground(e.position[0], e.position[2]);
}

/** Loot from a killed critter: physical log(s) where it fell, sometimes ore from its roots. ctx: {nextId, terrainHeight, logLimit}. */
export function dropStumplingLoot(state, e, ctx, events) {
 state.looseLogs ||= [];
 const [x, y, z] = e.position, logs = Math.min(STUMPLING.logs, Math.max(0, ctx.logLimit - state.looseLogs.length));
 for (let i = 0; i < logs; i++) {
  const a = e.yaw + Math.PI / 2 + i * 1.1, half = Math.SQRT1_2, yaw = e.yaw + i * 1.3;
  state.looseLogs.push({id: ctx.nextId(state, 'log'), sourceId: e.treeId, position: (([lx, lz]) => [lx, Math.max(y, ctx.terrainHeight(state, x, z)) + .35, lz])(clampToWorld(x + Math.sin(a) * .2, z + Math.cos(a) * .2, 54.5)),
   quaternion: [Math.cos(yaw) * half, 0, Math.sin(yaw) * half, half], velocity: [Math.sin(a) * .7, 1.8, Math.cos(a) * .7], angularVelocity: [Math.cos(a) * 1.4, .8, -Math.sin(a) * 1.4], heldBy: null, bornTick: state.tick, sleeping: false});
 }
 const pickup = (kind, amount, ox, oz) => { if (state.pickups.length >= 256) return null; const id = ctx.nextId(state, 'p'), [px, pz] = clampToWorld(x + ox, z + oz, 54.5);
  state.pickups.push({id, kind, x: px, z: pz, y: ctx.terrainHeight(state, px, pz), amount}); return id; };
 if (logs < STUMPLING.logs) pickup('wood', STUMPLING.logs - logs, 0, 0);
 const roll = unit(state.seed, e.id, 'loot'), ore = roll < STUMPLING.gold ? 'goldOre' : roll < STUMPLING.gold + STUMPLING.copper ? 'copperOre' : null;
 if (ore) pickup(ore, 1, Math.sin(e.yaw) * -.35, Math.cos(e.yaw) * -.35);
 releaseStump(state, e.treeId);
 events.push({kind: 'stump_loot', id: e.id, treeId: e.treeId, position: [...e.position], logs, ore});
 return {logs, ore};
}

// ---- Strict save validation.
const finite = n => typeof n === 'number' && Number.isFinite(n);
export function validStumpling(e, saved) {
 if (!isStumpling(e)) return e.home === undefined;
 const cut = (saved.harvestedTrees || []).find(h => h.id === e.treeId);
 return !!cut && cut.cuts === 3 && e.size === undefined && e.treeHeight === undefined && Number.isInteger(e.variant) && e.variant >= 0 && e.variant <= 2 &&
  Number.isSafeInteger(e.wakeTick) && e.wakeTick >= 0 && e.wakeTick <= saved.tick && saved.tick < e.wakeTick + STUMPLING.lifeTicks + STUMPLING.burrowTicks &&
  Array.isArray(e.home) && e.home.length === 2 && e.home.every(n => finite(n) && Math.abs(n) <= thingLimit()) &&
  (saved.enemies || []).filter(o => o.kind === 'stumpling' && o.treeId === e.treeId).length === 1;
}
