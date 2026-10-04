// Ruined Watch-Arch beacon. Shared, deterministic, host-authoritative.
// The brazier on the stump tower is cold until a Hero feeds it Crystal: strike the tower (any tool) with Crystal in
// your pack and one is spent to burn 5 minutes of blue watch-fire (up to 15 minutes banked). While it burns:
//  - it keeps watch: whenever more hostiles walk the world than it last counted, it sounds the alarm for everyone,
//    pointing at the newest one (and the client marks every hostile with a flare);
//  - it is a hearth: a fallen Hero with no rally point of their own gets back up beneath the arch.
// State lives in state.beacon = {litUntil, seen}; worlds saved before it load without it.
import {STARTING_SITES} from './starting-world.js';

export const BEACON_RULES = Object.freeze({fuelTicks: 5 * 60 * 60, maxTicks: 15 * 60 * 60, reach: 3.6, watchEvery: 30, maxSeen: 99});
const site = STARTING_SITES.find(s => s.id === 'watcharch');
const tower = site.footprints.find(f => f.kind === 'tower');
export const BEACON = Object.freeze({id: 'watchBeacon', x: tower.x, z: tower.z, top: tower.h});
// Hearth: in front of the arch on the forge side, clear of the piers, the fallen blocks and the waygate's return circle.
export const BEACON_HEARTH = Object.freeze({x: -6.6, z: -23.4});
const flat = (a, x, z) => Math.hypot(a[0] - x, a[2] - z);

export const beaconLit = state => !!state.beacon && state.tick < state.beacon.litUntil;
const hostiles = state => state.enemies.filter(e => e.hp > 0);

/** Strike resolution for the beacon tower: events, or null when the target is not the beacon. */
export function strikeBeacon(state, p, message, events) {
  if (!state.landmarks || message.targetId !== BEACON.id) return null;
  if (flat(p.position, BEACON.x, BEACON.z) > BEACON_RULES.reach || Math.hypot(message.point[0] - BEACON.x, message.point[2] - BEACON.z) > 2.6) return [];
  const b = state.beacon ||= {litUntil: 0, seen: 0}, left = Math.max(0, b.litUntil - state.tick), at = [BEACON.x, 0, BEACON.z];
  const base = {id: BEACON.id, by: p.id, position: [...message.point], normal: [...message.normal], material: 'stone'};
  if (left + BEACON_RULES.fuelTicks > BEACON_RULES.maxTicks) { events.push({...base, kind: 'beacon_full', litUntil: b.litUntil}); return events; }
  if ((p.resources?.gems || 0) < 1) { events.push({...base, kind: 'beacon_needs'}); return events; }
  p.resources.gems--;
  if (!left) b.seen = Math.min(BEACON_RULES.maxSeen, hostiles(state).length); // a fresh fire counts what is already out there
  b.litUntil = state.tick + left + BEACON_RULES.fuelTicks;
  events.push({...base, kind: 'beacon_fed', fresh: !left, litUntil: b.litUntil, beacon: at});
  return events;
}

/** Per-tick: burn out, and keep watch (alarm when the hostile count rises). */
export function stepBeacon(state, events) {
  const b = state.beacon;
  if (!b || !state.landmarks || !b.litUntil) return;
  if (state.tick >= b.litUntil) { b.litUntil = 0; b.seen = 0; events.push({kind: 'beacon_out', id: BEACON.id, position: [BEACON.x, 0, BEACON.z]}); return; }
  if (state.tick % BEACON_RULES.watchEvery) return;
  const list = hostiles(state), count = Math.min(BEACON_RULES.maxSeen, list.length);
  if (count > b.seen) {
    const newest = list[list.length - 1];
    events.push({kind: 'beacon_alarm', id: BEACON.id, count, added: count - b.seen, position: [BEACON.x, 0, BEACON.z], toward: [...newest.position]});
  }
  b.seen = count;
}

/** Respawn point for a fallen Hero while the beacon burns, or null. */
export function beaconHearth(state, terrainHeight) {
  if (!state.landmarks || !beaconLit(state)) return null;
  return [BEACON_HEARTH.x, terrainHeight(state, BEACON_HEARTH.x, BEACON_HEARTH.z), BEACON_HEARTH.z];
}

export function restoreBeacon(saved) {
  const b = saved.beacon;
  if (b === undefined) return undefined;
  if (!b || typeof b !== 'object' || !Number.isSafeInteger(b.litUntil) || b.litUntil < 0 || b.litUntil > saved.tick + BEACON_RULES.maxTicks ||
      !Number.isSafeInteger(b.seen) || b.seen < 0 || b.seen > BEACON_RULES.maxSeen) throw Error('Invalid beacon');
  return {litUntil: b.litUntil, seen: b.seen};
}
