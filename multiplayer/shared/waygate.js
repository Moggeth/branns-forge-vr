// Ancient Stone Sanctuary waygate. Shared, deterministic, host-authoritative.
// Strike the eight carved menhirs with any tool to ring their runes; each stays resonant for 25 s. When all eight
// resonate together the bronze hoop in the trilithon opens a waygate for 60 s and everyone in the ring is restored.
// While open, walking through the gateway carries a Hero to the tuned destination, and the return circle there carries
// them back. Striking the altar's tuning crystal picks the next destination. During the Expedition's star stage the
// fallen star is a destination too.
// State lives in state.waygate = {lit:[tick, x8], openUntil, dest}; worlds saved before it load without it.
import {STARTING_SITES} from './starting-world.js';
import {STAR_SITES} from './adventure.js';

export const WAYGATE = Object.freeze({litTicks: 25 * 60, openTicks: 60 * 60, reach: 3.4, restoreHp: 30, restoreMana: 40, ringRadius: 9, returnRadius: 0.85});
const site = STARTING_SITES.find(s => s.id === 'sanctuary');
const stones = site.footprints.filter(f => f.kind === 'stone');
// Footprints list the eight ring menhirs first (ring order, spawn gap skipped), then the two trilithon posts.
export const WAYSTONES = Object.freeze(stones.slice(0, 8).map((f, index) => Object.freeze({id: 'waystone' + index, index, x: f.x, z: f.z})));
const [postA, postB] = stones.slice(8, 10);
export const GATE = Object.freeze({x: (postA.x + postB.x) / 2, z: (postA.z + postB.z) / 2, halfWidth: 0.72, depth: 0.45, exit: 1.9});
export const ALTAR = Object.freeze({id: 'waygateAltar', x: site.x, z: site.z});
// Destinations sit on the landmark path ends, which are kept clear of footprints, trees and the forge. Travellers land
// beside the return circle (offset sideways, never inside it) looking at what they came for.
function destination(id, name, x, z, face) {
  const fx = face[0] - x, fz = face[1] - z, d = Math.hypot(fx, fz) || 1, out = [-fz / d * 1.8, fx / d * 1.8];
  return Object.freeze({id, name, x, z, out, yaw: Math.atan2(-(face[0] - x - out[0]), -(face[1] - z - out[1]))});
}
export const DESTINATIONS = Object.freeze([
  destination('forge', 'the Forge', -7.4, 5.1, [0, 0]), // on the sanctuary path, clear of the yard's ore nodes
  destination('outcrop', 'the Crystal Outcrop', 20.5, 12.5, [27, 14]),
  destination('watcharch', 'the Ruined Watch-Arch', -4.5, -22, [-5, -28]),
]);
const flat = (a, x, z) => Math.hypot(a[0] - x, a[2] - z);

export function waygateState(state) {
  if (!state.waygate) state.waygate = {lit: Array(8).fill(0), openUntil: 0, dest: 0};
  return state.waygate;
}
export const waygateOpen = state => !!state.waygate && state.tick < state.waygate.openUntil;
export const resonantCount = state => state.waygate ? state.waygate.lit.filter(t => t > state.tick).length : 0;

// Destination list for this tick: the fixed landmarks, plus the fallen star while the Expedition is hunting it.
export function waygateDestinations(state) {
  const adv = state.adventure, out = [...DESTINATIONS];
  if (adv?.stage === 'star' && adv.star && STAR_SITES[adv.star.site]) {
    const [sx, sz] = STAR_SITES[adv.star.site], d = Math.hypot(sx, sz) || 1;
    out.push(destination('star', 'the Fallen Star', sx - sx / d * 6, sz - sz / d * 6, [sx, sz]));
  }
  return out;
}
export function currentDestination(state) {
  const list = waygateDestinations(state), w = state.waygate;
  return list[(w?.dest || 0) % list.length];
}

/** Strike resolution for sanctuary targets. Returns null when the target is not part of the sanctuary. */
export function strikeWaygate(state, p, message, events) {
  const id = message.targetId;
  if (!state.landmarks || typeof id !== 'string') return null;
  const stone = WAYSTONES.find(s => s.id === id), altar = id === ALTAR.id;
  if (!stone && !altar) return null;
  const at = stone || ALTAR;
  if (flat(p.position, at.x, at.z) > WAYGATE.reach || Math.hypot(message.point[0] - at.x, message.point[2] - at.z) > 1.8) return [];
  const w = waygateState(state);
  if (altar) {
    const list = waygateDestinations(state); w.dest = ((w.dest || 0) + 1) % list.length;
    events.push({kind: 'waygate_tune', id, position: [...message.point], dest: list[w.dest].id, name: list[w.dest].name, material: 'stone'});
    return events;
  }
  const wasLit = w.lit[stone.index] > state.tick;
  if (!waygateOpen(state)) w.lit[stone.index] = state.tick + WAYGATE.litTicks;
  const count = resonantCount(state);
  events.push({kind: 'waystone_ring', id, index: stone.index, position: [...message.point], normal: [...message.normal], count, fresh: !wasLit, material: 'stone'});
  if (!waygateOpen(state) && count === WAYSTONES.length) {
    w.openUntil = state.tick + WAYGATE.openTicks;
    for (const h of state.players) if (h.role === 'hero' && h.hp > 0 && flat(h.position, site.x, site.z) <= WAYGATE.ringRadius) {
      h.hp = Math.min(100, h.hp + WAYGATE.restoreHp); h.mana = Math.min(100, h.mana + WAYGATE.restoreMana);
    }
    const d = currentDestination(state);
    events.push({kind: 'waygate_open', id: 'waygate', position: [GATE.x, 0, GATE.z], dest: d.id, name: d.name, until: w.openUntil});
  }
  return events;
}

function travel(state, p, x, z, yaw, terrainHeight, events, kind) {
  const from = [...p.position];
  p.position = [x, terrainHeight(state, x, z), z]; p.vy = 0; p.velocity = [0, 0, 0]; p.yaw = yaw;
  events.push({kind: 'waygate_travel', id: p.id, from, position: [...p.position], yaw, leg: kind});
}

/** Per-tick: close an expired gate, and carry Heroes through the gateway or back through the return circle. */
export function stepWaygate(state, {terrainHeight}, events) {
  const w = state.waygate;
  if (!w || !state.landmarks) return;
  if (w.openUntil && state.tick >= w.openUntil) {
    w.openUntil = 0; w.lit = w.lit.map(() => 0);
    events.push({kind: 'waygate_close', id: 'waygate', position: [GATE.x, 0, GATE.z]});
    return;
  }
  if (!waygateOpen(state)) return;
  const d = currentDestination(state);
  for (const p of state.players) {
    if (p.role !== 'hero' || p.hp <= 0) continue;
    const ground = terrainHeight(state, GATE.x, GATE.z);
    if (Math.abs(p.position[0] - GATE.x) < GATE.depth && Math.abs(p.position[2] - GATE.z) < GATE.halfWidth && p.position[1] < ground + 2.2) {
      const x = d.x + d.out[0], z = d.z + d.out[1];
      travel(state, p, x, z, d.yaw, terrainHeight, events, 'out');
    } else if (flat(p.position, d.x, d.z) < WAYGATE.returnRadius) {
      travel(state, p, GATE.x + GATE.exit, GATE.z, -Math.PI / 2, terrainHeight, events, 'back');
    }
  }
}

export function restoreWaygate(saved) {
  const w = saved.waygate;
  if (w === undefined) return undefined;
  const tick = saved.tick;
  if (!w || typeof w !== 'object' || !Array.isArray(w.lit) || w.lit.length !== 8 ||
      !w.lit.every(t => Number.isSafeInteger(t) && t >= 0 && t <= tick + WAYGATE.litTicks) ||
      !Number.isSafeInteger(w.openUntil) || w.openUntil < 0 || w.openUntil > tick + WAYGATE.openTicks ||
      !Number.isSafeInteger(w.dest) || w.dest < 0 || w.dest > 7) throw Error('Invalid waygate');
  return {lit: [...w.lit], openUntil: w.openUntil, dest: w.dest};
}
