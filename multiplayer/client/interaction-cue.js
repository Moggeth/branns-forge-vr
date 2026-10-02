// Contextual harvesting cue: one short line telling a first-person Hero what the looked-at tree, ore, loose log,
// nearby pickup or forge needs, and which control does it. Pure decision model: no DOM, no Three.js, no clock.
// It never mutates the snapshot and never fires actions. Rules mirror the authoritative simulation; each mirrored
// constant names its source so a rule change is a one-line audit (test/interaction-cue.test.mjs checks the text).
import {TREE_LIMITS, CUT_RANGE, treeScale, trunkRadius, isFelled, rotateVector} from '../shared/trees.js';

export const CUE_RULES = Object.freeze({
  strikeReach: 3.2,     // game.js contactRay far, simulation.js targetOK horizontal limit
  facingDot: .45,       // simulation.js targetOK / inReach
  oreRadius: 1.5,       // simulation.js: struck point within 1.5 m (horizontal) of the ore centre
  grabReach: 2.5,       // world-content-view.js grabTarget clamp == TREE_LIMITS.reach
  pickupReach: 2.5,     // simulation.js interact: nearest pickup within 2.5 m of the feet
  forgeRange: 9,        // adventure.js DEPOSIT_RANGE around FORGE [0, 0]
  inventoryCap: 999,    // simulation.js / trees.js inventory_full
  probeRange: 8,        // cue only: show "move closer" up to this aimed distance
});

// Item names come from the existing vocabulary (HUD resources line, adventure-view CARRY_NAMES, objective text).
const ORE = {stone: {name: 'Boulder', yields: 'stone'}, meteor: {name: 'Star shard', yields: 'star gems'}};
const PICKUP = {wood: 'Timber', stone: 'Stone', gems: 'Star gems', apple: 'Apple'};
const KIND_WORD = {wood: 'timber', stone: 'stone', gems: 'gems'}; // adventure-view.js CARRY_NAMES

// Control names exactly as visible: compact HUD chips/drawer (index.html), mobile Attack button (mobile-ui.js),
// objective banner Deliver (adventure-view.js SHORT), VR bindings (vr-input-policy.js, docs/VR-CONTROLS.md).
export const CONTROLS = Object.freeze({
  desktop: {strike: 'Click', axe: '1', pick: '2', grab: 'F', stow: 'E', drop: 'G', throw: 'X', collect: 'E', deliver: 'Deliver'},
  touch: {strike: 'Attack', axe: 'Axe', pick: 'Pick', grab: 'Actions › Grab', stow: 'Actions › Collect', drop: 'Actions › Drop', throw: 'Actions › Throw', collect: 'Actions › Collect', deliver: 'Deliver'},
  xr: {strike: 'Swing', axe: 'Left grip', pick: 'Left grip', grab: 'Right grip', stow: 'Left stick click', drop: 'Right grip', throw: 'Trigger', collect: 'Left stick click', deliver: 'Wrist panel'},
});

const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const finite3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

/** Closest approach of ray (origin o, unit d, t in [0,max]) to a log capsule. Returns along-ray t or null. */
export function rayLogDistance(o, d, log, max) {
  const half = TREE_LIMITS.logLength / 2 - TREE_LIMITS.logRadius, a = rotateVector([0, 1, 0], log.quaternion), c = log.position;
  // Segment (c + a*u, |u|<=half) vs ray: solve the 2x2 closest-point system, then clamp and re-project.
  const w = [o[0] - c[0], o[1] - c[1], o[2] - c[2]], b = d[0]*a[0] + d[1]*a[1] + d[2]*a[2];
  const dw = d[0]*w[0] + d[1]*w[1] + d[2]*w[2], aw = a[0]*w[0] + a[1]*w[1] + a[2]*w[2], den = 1 - b*b;
  // Parallel ray: take the cap nearest the origin, not the ambiguous centre.
  let t = den > 1e-6 ? (b*aw - dw) / den : b*clamp(aw, -half, half) - dw; t = clamp(t, 0, max);
  let u = clamp(aw + b*t, -half, half); t = clamp(b*u - dw, 0, max); u = clamp(aw + b*t, -half, half);
  const gap = Math.hypot(w[0] + d[0]*t - a[0]*u, w[1] + d[1]*t - a[1]*u, w[2] + d[2]*t - a[2]*u);
  if (gap > TREE_LIMITS.logRadius) return null;
  return Math.max(0, t - Math.sqrt(Math.max(0, TREE_LIMITS.logRadius**2 - gap*gap))); // entry point, like grabTarget's march
}

/** First terrain crossing along the ray (analytic height samples, no 51k-triangle raycast). */
export function terrainDistance(o, d, height, max, step = .25) {
  for (let t = step; t <= max; t += step) if (o[1] + d[1]*t <= height(o[0] + d[0]*t, o[2] + d[2]*t)) return t;
  return Infinity;
}

/**
 * Decide the single cue for this sample. Inputs are read-only.
 * view: {active, role, xr, menuOpen, mode:'desktop'|'touch'}
 * self: snapshot player {id, position, yaw, tool, resources}
 * snapshot: {harvestedTrees, deposits, pickups, looseLogs, detachedParts}
 * aim: {origin, direction, yaw?, hit:{targetId, point, distance}|null}  (hit = first visible content/shrine surface)
 * ctx: {tree(id) -> {x,z,height,variant}|null, height(x,z), deliver:{kinds:[...], held}|null}
 * Returns null (hide) or {key, kind, state, name, action, control, note, progress}.
 */
export function decideCue(view, self, snapshot, aim, ctx) {
  if (!view?.active || view.role !== 'hero' || view.xr || view.menuOpen || !self || !finite3(self.position)) return null;
  const keys = CONTROLS[view.mode] || CONTROLS.desktop, res = self.resources || {}, tool = self.tool || 'axe';
  const make = (kind, state, id, name, action, control, note = '', progress = null) =>
    ({key: [kind, state, id, name, action, control, note, progress ? progress.done : ''].join('|'), kind, state, target: id, name, action, control, note, progress});

  // 1. A held log owns the hands (trees.js logAction: strike/grab -> hands_full); stow/drop/throw are the only moves.
  const held = (snapshot.looseLogs || []).find(l => l.heldBy === self.id);
  if (held) {
    if ((res.wood | 0) >= CUE_RULES.inventoryCap) return make('carry', 'full', held.id, 'Log in hand', 'Pack full', `${keys.drop} drop · ${keys.throw} throw`);
    return make('carry', 'ready', held.id, 'Log in hand', 'Stow', keys.stow, `${keys.drop} drop · ${keys.throw} throw`);
  }
  const boneHeld = (snapshot.detachedParts || []).some(p => p.heldBy === self.id);

  // 2. Aimed target. Occluders: the nearest visible content surface and analytic terrain.
  if (aim && finite3(aim.origin) && finite3(aim.direction)) {
    const o = aim.origin, d = aim.direction, hit = aim.hit && Number.isFinite(aim.hit.distance) ? aim.hit : null;
    const ground = ctx.height ? terrainDistance(o, d, ctx.height, CUE_RULES.probeRange) : Infinity;
    const wall = Math.min(ground, hit ? hit.distance : Infinity);
    let log = null;
    for (const l of snapshot.looseLogs || []) {
      if (l.heldBy || !finite3(l.position)) continue;
      const t = rayLogDistance(o, d, l, CUE_RULES.probeRange);
      if (t !== null && t <= wall + .05 && (!log || t < log.t)) log = {l, t};
    }
    if (log) {
      if (log.t > CUE_RULES.grabReach) return make('log', 'far', log.l.id, 'Loose log', 'Move closer', '');
      if (boneHeld) return make('log', 'busy', log.l.id, 'Loose log', 'Drop the bone first', keys.drop);
      return make('log', 'ready', log.l.id, 'Loose log', 'Grab', keys.grab, `then ${keys.stow} to stow`);
    }
    if (hit && hit.distance <= ground && hit.distance <= CUE_RULES.probeRange && finite3(hit.point)) {
      const cue = aimedTarget(hit, self, snapshot, ctx, keys, tool, boneHeld, aim.yaw ?? self.yaw, make);
      if (cue) return cue;
    }
  }

  // 3. Proximity pickup (simulation interact: nearest within 2.5 m of the feet, not aim based).
  const p = self.position;
  let near = null;
  for (const q of snapshot.pickups || []) {
    const dist = Math.hypot(p[0] - q.x, p[2] - q.z, p[1] - (ctx.height ? ctx.height(q.x, q.z) : Number.isFinite(q.y) ? q.y : p[1])); // server: terrainHeight(q)
    if (dist <= CUE_RULES.pickupReach && (!near || dist < near.dist)) near = {q, dist};
  }
  if (near && PICKUP[near.q.kind]) {
    const q = near.q, name = q.kind === 'apple' ? 'Apple' : `${PICKUP[q.kind]} ×${q.amount | 0}`;
    if (q.kind !== 'apple' && (res[q.kind] | 0) + (q.amount | 0) > CUE_RULES.inventoryCap) return make('pickup', 'full', q.id, name, 'Pack full', '');
    return make('pickup', 'ready', q.id, name, q.kind === 'apple' ? 'Eat' : 'Collect', keys.collect);
  }

  // 4. Forge delivery: only inside DEPOSIT_RANGE while the expedition offers Deliver and the Hero carries an accepted kind.
  const deliver = ctx.deliver;
  if (deliver?.kinds?.length && flat(p, [0, 0, 0]) <= CUE_RULES.forgeRange) {
    const note = deliver.kinds.map(k => `${deliver.held?.[k] | 0} ${KIND_WORD[k] || k}`).join(' · ');
    return make('forge', 'ready', 'forge', 'Forge', 'Deliver', keys.deliver, note);
  }
  return null;
}

/** Kinds the forge would accept from this Hero right now: adventure.js RUNNING stages and depositRoom(), read-only. */
export function deliverableNow(adv, role, held = {}) {
  if (role !== 'hero' || !adv || !['camp', 'star', 'rekindle'].includes(adv.stage)) return [];
  const room = kind => adv.stage === 'camp' ? (kind === 'wood' ? adv.need.wood - adv.stock.wood : kind === 'stone' ? adv.need.stone - adv.stock.stone : 0)
    : adv.stage === 'star' ? (kind === 'gems' ? adv.need.star - adv.star.charge : 0)
    : Math.ceil((100 - adv.flame) / ({wood: 4, stone: 2, gems: 10}[kind] || Infinity));
  return ['wood', 'stone', 'gems'].filter(k => (held?.[k] | 0) > 0 && room(k) > 0);
}

function aimedTarget(hit, self, snapshot, ctx, keys, tool, boneHeld, yaw, make) {
  const id = hit.targetId, pt = hit.point, p = self.position;
  const facing = Number.isFinite(yaw) ? [-Math.sin(yaw), -Math.cos(yaw)] : null;
  const reachable = (x, z, y) => {   // simulation.js targetOK, from the authoritative position
    const dx = x - p[0], dz = z - p[2], dist = Math.hypot(dx, dz);
    return hit.distance <= CUE_RULES.strikeReach && dist <= CUE_RULES.strikeReach && Math.abs(y - p[1]) <= 3 &&
      (dist < .5 || !facing || (facing[0]*dx + facing[1]*dz) / dist >= CUE_RULES.facingDot);
  };
  const tree = ctx.tree?.(id);
  if (tree) {
    const cut = (snapshot.harvestedTrees || []).find(h => h.id === id);
    if (isFelled(cut)) return null; // felled trunks leave targets(); their logs are cued instead
    const floor = ctx.height ? ctx.height(tree.x, tree.z) : 0, local = pt[1] - floor, s = treeScale(tree);
    const progress = cut ? {done: cut.cuts, total: 3} : null;
    if (tool !== 'axe') return make('tree', 'tool', id, 'Tree', 'Needs the Axe', keys.axe, '', progress);
    if (!reachable(tree.x, tree.z, floor)) return make('tree', 'far', id, 'Tree', 'Move closer', '', '', progress);
    if (boneHeld) return make('tree', 'busy', id, 'Tree', 'Drop the bone first', keys.drop);
    // chopTree: hits off the trunk produce nothing; outside CUT_RANGE or away from the notch only glance.
    if (Math.hypot(pt[0] - tree.x, pt[2] - tree.z) > trunkRadius(tree, clamp(local, 0, tree.height)) + TREE_LIMITS.chopSlack + .2)
      return make('tree', 'aim', id, 'Tree', 'Aim at the trunk', '', '', progress);
    if (cut && Math.abs(cut.cutHeight - pt[1]) > TREE_LIMITS.notchTolerance)
      return make('tree', 'aim', id, 'Tree', cut.cutHeight < pt[1] ? 'Aim lower, at the notch' : 'Aim higher, at the notch', '', '', progress);
    if (local < CUT_RANGE[0]*s - .15) return make('tree', 'aim', id, 'Tree', 'Aim higher on the trunk', '', '', progress);
    if (local > CUT_RANGE[1]*s + .15) return make('tree', 'aim', id, 'Tree', 'Aim lower on the trunk', '', '', progress);
    return make('tree', 'ready', id, 'Tree', 'Chop', keys.strike, '', progress);
  }
  const ore = (snapshot.deposits || []).find(q => q.id === id);
  if (ore) {
    if (ore.depleted) return null; // depleted ores are not rendered (world-content-view.js), so never aimed
    const info = ORE[ore.kind] || ORE.stone, progress = {done: ore.hits | 0, total: ore.maxHits | 0};
    const floor = ctx.height ? ctx.height(ore.x, ore.z) : p[1];
    if (tool !== 'pick') return make('ore', 'tool', id, info.name, 'Needs the Pick', keys.pick, '', progress);
    if (!reachable(ore.x, ore.z, floor) || Math.hypot(pt[0] - ore.x, pt[2] - ore.z) > CUE_RULES.oreRadius || Math.abs(pt[1] - floor) > 2)
      return make('ore', 'far', id, info.name, 'Move closer', '', '', progress);
    if (boneHeld) return make('ore', 'busy', id, info.name, 'Drop the bone first', keys.drop);
    return make('ore', 'ready', id, info.name, 'Mine', keys.strike, info.yields, progress);
  }
  return null; // enemies/shrine/props: combat HUD already speaks for them
}

/**
 * Hysteresis so the cue neither flickers at a trunk edge nor churns the DOM: a new cue must hold for `enter`
 * consecutive samples; a lost cue lingers `holdMs`. Same-key samples refresh content without counting as a switch.
 */
export function createCueStabilizer({enter = 2, holdMs = 300} = {}) {
  let shown = null, pending = null, pendingCount = 0, lostAt = -Infinity;
  return {
    push(cue, now) {
      if (cue && shown && cue.key === shown.key) { shown = cue; pending = null; pendingCount = 0; lostAt = -Infinity; return shown; }
      if (!cue) { pending = null; pendingCount = 0; if (shown) { if (lostAt === -Infinity) lostAt = now; if (now - lostAt >= holdMs) shown = null; } return shown; }
      // Same target, new state (e.g. a cut landed): switch immediately; it is the player's own feedback.
      if (shown && cue.kind === shown.kind && cue.target === shown.target) { shown = cue; pending = null; pendingCount = 0; lostAt = -Infinity; return shown; }
      if (pending && pending.key === cue.key) pendingCount++; else { pending = cue; pendingCount = 1; }
      if (pendingCount >= enter) { shown = cue; pending = null; pendingCount = 0; lostAt = -Infinity; }
      return shown;
    },
    reset() { shown = pending = null; pendingCount = 0; lostAt = -Infinity; },
  };
}
