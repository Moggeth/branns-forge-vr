// Kingsfell's Timberfall (2026-10-16): the axe special. The hero hews the ground and the heartstone's stored light
// leaves the edge as a giant blade of amber light that runs along the ground straight ahead, felling every standing
// tree in its lane (each one through the normal three-cut notch rule, falling away down the lane) and cutting down
// every foe it passes. The near cleave (axe-cleave.js) still hits everything round the hero at the same moment.
//
// The Pick of Riches has its rich seams; Kingsfell has heartwood. Every tree Timberfall fells is split to its heart,
// and some hearts are treasure: amber (old resin, the same stone as the axe's heartstone), now and then gold or
// crystal. Every cast that reaches a tree brings up at least one amberheart. Sapdrinker: every axe blow that bites
// wood or a foe drinks a little of its life into the heart and brings Timberfall back sooner.
//
// Pure and deterministic: no clock, no RNG (rolls hash the world seed and cast id). The wave in flight lives only on
// the authority (a WeakMap on the state, never saved or sent): a save or host change mid-wave just ends that wave.
// Clients draw it from the cast event, which carries the lane, speed and start tick.
import {terrainHeight} from './terrain.js';
import {worldTrees} from './world-content.js';
import {chopTree, trunkRadius, treeScale, isFelled, CUT_RANGE} from './trees.js';
import {enemyHostileTo} from './battle-mode.js';
import {specialCooldown} from './special-cooldowns.js';

export const TIMBERFALL = Object.freeze({
  start: 1.2,          // metres in front of the hero where the blade of light leaves the ground
  length: 19,          // metres the lane runs
  speed: 27,           // metres per second along the lane (0.7 s to the far end)
  treeWidth: 1.7,      // half-width of the lane for trunks (plus the trunk's own radius)
  foeWidth: 1.5,       // half-width for foes (plus their body)
  body: .45,
  height: 4,           // vertical reach above/below the lane's ground
  trees: 12,           // most trees one wave fells, nearest first
  golemDamage: 160,    // armoured golems take a huge blow (armour still applies) and are thrown down the lane
  knockback: 2.6,
  cutHeight: .7,       // authored metres above the root flare (inside CUT_RANGE)
  bound: 47,           // the lane stops at the valley's edge
});
const TICKS_PER_SECOND = 60;
export const timberfallTicks = (length = TIMBERFALL.length) => Math.ceil(length / TIMBERFALL.speed * TICKS_PER_SECOND);
/** Distance the front has travelled `ticks` after the cast (fractional ticks allowed, for presentation). */
export const timberfallFront = ticks => Math.max(0, ticks) * TIMBERFALL.speed / TICKS_PER_SECOND;

// Heartwood: what a felled tree's heart holds. Kinds are pickup/material keys. Weights per felled tree.
export const HEARTWOOD = Object.freeze({
  weights: Object.freeze({none: 50, amber: 34, gold: 9, gems: 7}),
  amount: Object.freeze({amber: 2, gold: 1, gems: 1}),
  guaranteed: Object.freeze({kind: 'amber', amount: 3}), // the amberheart every cast is promised
});
export const isRichHeart = kind => kind && kind !== 'none';
// Sapdrinker: each axe blow that bites (a tree notch or a foe) takes this many ticks off the Timberfall recharge.
export const SAPDRINKER_TICKS = 30;

const unit = (seed, key) => { let h = 2166136261 ^ (seed >>> 0); for (const c of String(key)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const pick = (table, u) => { const e = Object.entries(table), total = e.reduce((n, [, w]) => n + w, 0); let r = u * total; for (const [k, w] of e) { r -= w; if (r < 0) return k; } return e[0][0]; };
/** Hearts for a cast's lane trees (nearest first). Deterministic in the world seed and cast id. If none rolled rich,
 * one tree in the far half (the payoff at the end of the run) becomes the promised amberheart. */
export function heartwoodFor(seed, castId, treeIds) {
  const hearts = treeIds.map(id => { const kind = pick(HEARTWOOD.weights, unit(seed, `${castId}:${id}`)); return {kind, amount: HEARTWOOD.amount[kind] || 0}; });
  if (hearts.length && !hearts.some(h => isRichHeart(h.kind))) {
    const half = Math.floor(hearts.length / 2), i = Math.min(hearts.length - 1, half + Math.floor(unit(seed, `${castId}:heart`) * (hearts.length - half)));
    hearts[i] = {...HEARTWOOD.guaranteed, promised: true};
  }
  return hearts;
}

const facingOf = p => [-Math.sin(p.yaw) || 0, -Math.cos(p.yaw) || 0];
/** The lane from the hero toward an aimed ground point (or straight ahead). Same math drives the client preview. */
export function timberfallLane(position, yaw, point) {
  let [fx, fz] = [-Math.sin(yaw) || 0, -Math.cos(yaw) || 0];
  if (Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)) {
    const dx = point[0] - position[0], dz = point[2] - position[2], d = Math.hypot(dx, dz);
    if (d > .5) { fx = dx / d; fz = dz / d; }
  }
  const sx = position[0] + fx * TIMBERFALL.start, sz = position[2] + fz * TIMBERFALL.start;
  // Stop at the valley's edge: the largest length that keeps the far end inside the bound.
  let length = TIMBERFALL.length;
  for (const [s, f] of [[sx, fx], [sz, fz]]) if (Math.abs(f) > 1e-6) length = Math.min(length, ((f > 0 ? TIMBERFALL.bound : -TIMBERFALL.bound) - s) / f);
  return {start: [sx, sz], direction: [fx, fz], length: Math.max(0, length)};
}
const along = (lane, x, z) => (x - lane.start[0]) * lane.direction[0] + (z - lane.start[1]) * lane.direction[1];
const across = (lane, x, z) => Math.abs((x - lane.start[0]) * lane.direction[1] - (z - lane.start[1]) * lane.direction[0]);

/** Standing trees inside a lane, nearest first, capped. Pure: the preview highlights exactly these. */
export function laneTrees(state, lane, y, exclude = new Set()) {
  const felled = new Set(state.harvestedTrees.filter(isFelled).map(h => h.id));
  return worldTrees(state).filter(t => !felled.has(t.id) && !exclude.has(t.id))
    .map(t => ({t, floor: terrainHeight(state, t.x, t.z), d: along(lane, t.x, t.z)}))
    .filter(({t, floor, d}) => d >= -.4 && d <= lane.length && Math.abs(floor - y) < TIMBERFALL.height && across(lane, t.x, t.z) <= TIMBERFALL.treeWidth + trunkRadius(t, 1))
    .sort((a, b) => a.d - b.d || (a.t.id < b.t.id ? -1 : 1)).slice(0, TIMBERFALL.trees);
}
export function planTimberfall(state, p, point, exclude) {
  const lane = timberfallLane(p.position, p.yaw, point);
  return {...lane, trees: laneTrees(state, lane, p.position[1], exclude)};
}

// ---------------------------------------------------------------- the wave on the authority
const flights = new WeakMap(); // state -> [{id, owner, side, lane, y, startTick, trees: [{id, d, heart}], hit: Set}]
export const timberfallsInFlight = state => flights.get(state)?.length || 0;

/** Called by the cleave at the moment of the cast. `near` lists the trees the near cleave is felling (they share the
 * cast's heart roll and its promise). Returns {event, nearHearts, flight}: the event fields describing the wave. */
export function launchTimberfall(state, p, point, ctx, near = []) {
  const plan = planTimberfall(state, p, point, new Set(near)), id = ctx.nextId(state, 'tf');
  const hearts = heartwoodFor(state.seed | 0, id, [...near, ...plan.trees.map(({t}) => t.id)]);
  const flight = {id, owner: p.id, side: p.side, lane: {start: plan.start, direction: plan.direction, length: plan.length}, y: p.position[1],
    startTick: state.tick, trees: plan.trees.map(({t, d}, i) => ({id: t.id, d, heart: hearts[near.length + i]})), hit: new Set()};
  if (!flights.has(state)) flights.set(state, []);
  flights.get(state).push(flight);
  const ground = terrainHeight(state, plan.start[0], plan.start[1]);
  return {flight, nearHearts: new Map(near.map((treeId, i) => [treeId, hearts[i]])),
    event: {id, start: [plan.start[0], ground, plan.start[1]], direction: [plan.direction[0], 0, plan.direction[1]], length: plan.length,
      speed: TIMBERFALL.speed, width: TIMBERFALL.treeWidth, startTick: state.tick, trees: flight.trees.map(t => t.id)}};
}

function fellDownLane(state, tree, lane, by, events) {
  const floor = terrainHeight(state, tree.x, tree.z), [fx, fz] = lane.direction;
  const wound = state.harvestedTrees.find(h => h.id === tree.id), s = treeScale(tree);
  const height = wound ? wound.cutHeight : floor + Math.min(CUT_RANGE[1], Math.max(CUT_RANGE[0], TIMBERFALL.cutHeight)) * s;
  // Notch on the side the light arrives from, so the tree falls away down the lane.
  const r = trunkRadius(tree, height - floor), point = [tree.x - fx * r, height, tree.z - fz * r];
  for (let cut = 0; cut < 3; cut++) {
    const chop = chopTree(state, tree, point, [-fx, 0, -fz], {terrainHeight: (x, z) => terrainHeight(state, x, z)});
    if (chop.code || !chop.events?.some(e => !e.glance)) return false;
    events.push(...chop.events.map(e => ({...e, by, timberfall: true})));
    if (chop.events.some(e => e.kind === 'tree_fell')) return true;
  }
  return false;
}
/** Split a felled tree's heart: drop its treasure at the stump and announce it. */
export function splitHeart(state, tree, heart, flight, ctx, events) {
  const floor = terrainHeight(state, tree.x, tree.z), [fx, fz] = flight.lane.direction;
  const rich = isRichHeart(heart.kind), drops = [];
  // Treasure lands just behind the stump (the side the hero comes from), so walking down the lane collects it.
  if (rich) for (let i = 0; i < heart.amount && state.pickups.length < 256; i++) {
    const a = (i - (heart.amount - 1) / 2) * .9, x = tree.x - fx * .7 + fz * a * .35, z = tree.z - fz * .7 - fx * a * .35;
    const id = ctx.nextId(state, 'p'); state.pickups.push({id, kind: heart.kind, x, z, y: terrainHeight(state, x, z), amount: 1}); drops.push(id);
  }
  events.push({kind: 'heartwood', id: tree.id, by: flight.owner, cast: flight.id, tick: state.tick, position: [tree.x, floor, tree.z],
    heart: heart.kind, amount: rich ? drops.length : 0, ...(heart.promised ? {promised: true} : {}), pickups: drops});
}

/** Fixed-tick life of every wave in flight: the front acts exactly once on each tree and foe as it passes. */
export function stepTimberfall(state, ctx, hitEnemyPart, events) {
  const list = flights.get(state); if (!list?.length) return;
  for (const flight of [...list]) {
    const ticks = state.tick - flight.startTick, now = Math.min(flight.lane.length, timberfallFront(ticks));
    if (ticks <= 0) continue;
    const {lane} = flight, [fx, fz] = lane.direction;
    for (const planned of flight.trees) {
      if (planned.done || planned.d > now) continue;
      planned.done = true;
      const tree = worldTrees(state).find(t => t.id === planned.id);
      if (!tree || isFelled(state.harvestedTrees.find(h => h.id === tree.id))) continue; // someone else got there first
      if (fellDownLane(state, tree, lane, flight.owner, events)) splitHeart(state, tree, planned.heart, flight, ctx, events);
    }
    for (const enemy of [...state.enemies]) {
      if (flight.hit.has(enemy.id) || !enemyHostileTo(enemy, flight.side) || Math.abs(enemy.position[1] - flight.y) > TIMBERFALL.height) continue;
      const d = along(lane, enemy.position[0], enemy.position[2]);
      if (d > now + TIMBERFALL.body || d < -TIMBERFALL.body || across(lane, enemy.position[0], enemy.position[2]) > TIMBERFALL.foeWidth + TIMBERFALL.body) continue;
      flight.hit.add(enemy.id);
      const armored = enemy.kind === 'golem';
      hitEnemyPart(state, enemy, 'torso', armored ? TIMBERFALL.golemDamage : Math.max(1, enemy.hp),
        {tool: 'axe', point: [enemy.position[0], enemy.position[1] + 1, enemy.position[2]], normal: [-fx, 0, -fz], ownerId: flight.owner}, ctx, events);
      if (state.enemies.includes(enemy)) {
        enemy.position[0] = Math.max(-49, Math.min(49, enemy.position[0] + fx * TIMBERFALL.knockback));
        enemy.position[2] = Math.max(-49, Math.min(49, enemy.position[2] + fz * TIMBERFALL.knockback));
        enemy.launchTick = state.tick;
      }
    }
    if (now >= lane.length) {
      list.splice(list.indexOf(flight), 1);
      events.push({kind: 'timberfall_end', id: flight.id, by: flight.owner, tick: state.tick});
    }
  }
}

/** Sapdrinker: a biting axe blow brings Timberfall back sooner (never past ready). */
export function drinkSap(state, p, ticks = SAPDRINKER_TICKS) {
  if (p?.tool !== 'axe' || p.specialTick === undefined) return false;
  const ready = state.tick - specialCooldown('axe', p);
  if (p.specialTick <= ready) return false;
  p.specialTick = Math.max(ready, p.specialTick - ticks);
  return true;
}
