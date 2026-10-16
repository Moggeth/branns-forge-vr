// Mounts: horses and tigers a Hero can ride. Shared, deterministic authority (60 Hz host, saves, host migration);
// the look and gaits live in client/mount-view.js.
//
// A mount is a plain record in state.mounts: {id, kind, position, yaw, rider, tamed, home, v}. While ridden it is
// carried by its rider (the Hero still owns movement, collision and prediction; riding only scales pace and jump), so
// client prediction needs nothing but mountSpeed()/mountJump() on the same snapshot. Unridden mounts graze and amble
// around their home spot on a tick-seeded schedule, so every host agrees on where they wander.
//
// Horses wait at the start village. A wild tiger lounges in a forest nearby and is tamed by offering it an apple from
// your hand; once tamed it stays tame for the whole room. Riding is generated worlds only for now.
import {resolvePlaces} from './worldgen/places.js';

export const MOUNT = Object.freeze({
  reach: 3,              // metres from the Hero's feet to the mount to climb on
  radius: .55,           // body radius a rider collides with (trees, rocks, crags), wider than a Hero on foot
  dropOff: 20,           // a rider who jumps further than this in one tick (respawn, portal, waygate) is set down
  wander: {radius: 9, speed: 1.1, every: 300},
  max: 12,
  kinds: Object.freeze({
    // speed multiplies the Hero's 5 m/s; jump is the take-off speed (a Hero on foot jumps at 5.5).
    horse: Object.freeze({name: 'Horse', speed: 2.1, jump: 6.4, seat: .6}),
    tiger: Object.freeze({name: 'Tiger', speed: 1.85, jump: 8.2, seat: .34}),
  }),
});
export const MOUNT_KINDS = Object.freeze(Object.keys(MOUNT.kinds));

const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const hash = (...parts) => { let h = 2166136261; for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); return ((h ^ h >>> 15) >>> 0) / 4294967296; };
const yawToward = (dx, dz) => Math.atan2(-dx, -dz); // three.js yaw: 0 faces -z

/** The mount this player is riding, or null. Works on live state and on snapshots. */
export function mountOf(state, p) { return p && state?.mounts?.find(m => m.rider === p.id) || null; }
/** Pace multiplier while riding (1 on foot). */
export function mountSpeed(state, p) { const m = mountOf(state, p); return m ? MOUNT.kinds[m.kind].speed : 1; }
/** Take-off speed for a jump. */
export function mountJump(state, p) { const m = mountOf(state, p); return m ? MOUNT.kinds[m.kind].jump : 5.5; }
/** How far the saddle lifts the rider's view and body above their feet (0 on foot). */
export function mountSeat(state, p) { const m = mountOf(state, p); return m ? MOUNT.kinds[m.kind].seat : 0; }
/** Body radius for the rider's collision. */
export function riderRadius(state, p, onFoot = .28) { return mountOf(state, p) ? MOUNT.radius : onFoot; }

/** The nearest free mount within reach of a Hero, or null. */
export function mountNear(state, p, reach = MOUNT.reach) {
  let best = null, bd = reach;
  for (const m of state?.mounts || []) { if (m.rider) continue; const d = flat(m.position, p.position); if (d <= bd) { bd = d; best = m; } }
  return best;
}

/** Set a rider down where they are; the mount stays and grazes there. */
export function dismount(state, p, events = null) {
  const m = mountOf(state, p); if (!m) return false;
  m.rider = null; m.home = [m.position[0], m.position[2]]; m.wanderTick = state.tick + MOUNT.wander.every;
  events?.push({kind: 'dismount', id: m.id, by: p.id, position: [...m.position], tick: state.tick});
  return true;
}

/**
 * {action:'mount', mountId} climbs on (a wild tiger first eats the apple in your hand); {action:'dismount'} gets off.
 * ctx.takeApple(p) consumes the held apple and returns true when there was one.
 */
export function mountAction(state, p, m, ctx = {}) {
  if (m.action === 'dismount') { const events = []; return dismount(state, p, events) ? {ok: true, events} : {ok: false, code: 'not_riding', events: []}; }
  if (p.role !== 'hero' || p.dragon || !(p.hp > 0)) return {ok: false, code: 'invalid_action', events: []};
  if (mountOf(state, p)) return {ok: false, code: 'already_riding', events: []};
  const mount = (state.mounts || []).find(q => q.id === m.mountId);
  if (!mount || mount.rider) return {ok: false, code: 'mount_taken', events: []};
  if (flat(mount.position, p.position) > MOUNT.reach + .5) return {ok: false, code: 'too_far', events: []};
  const events = [];
  if (!mount.tamed) {
    if (!ctx.takeApple?.(p)) return {ok: false, code: 'mount_wild', events: []};
    mount.tamed = true; events.push({kind: 'mount_tamed', id: mount.id, by: p.id, position: [...mount.position], tick: state.tick});
  }
  mount.rider = p.id; mount.position = [...p.position];
  events.push({kind: 'mount', id: mount.id, by: p.id, position: [...p.position], tick: state.tick});
  return {ok: true, events};
}

/** Host step, after Heroes have moved. ctx = {terrainHeight, world}. */
export function stepMounts(state, ctx, events) {
  if (!state.mounts?.length) return;
  for (const m of state.mounts) {
    const p = m.rider && state.players.find(q => q.id === m.rider);
    if (m.rider && (!p || p.role !== 'hero' || p.dragon || !(p.hp > 0) || flat(p.position, m.position) > MOUNT.dropOff)) {
      // The rider left, changed role, called a dragon, fell, or was carried off (respawn, portal): the mount stays put.
      m.rider = null; m.home = [m.position[0], m.position[2]]; m.wanderTick = state.tick + MOUNT.wander.every;
      if (p) events.push({kind: 'dismount', id: m.id, by: p.id, position: [...m.position], tick: state.tick});
      continue;
    }
    if (p) {
      const dx = p.position[0] - m.position[0], dz = p.position[2] - m.position[2];
      if (dx * dx + dz * dz > 1e-6) m.yaw = +yawToward(dx, dz).toFixed(4);
      m.position = [...p.position];
      continue;
    }
    // Graze: pick a new spot near home every so often, amble to it, then stand.
    if (state.tick >= (m.wanderTick ?? 0)) {
      const a = hash(m.id, state.tick, 'a') * Math.PI * 2, r = MOUNT.wander.radius * Math.sqrt(hash(m.id, state.tick, 'r'));
      m.goal = [+(m.home[0] + Math.cos(a) * r).toFixed(3), +(m.home[1] + Math.sin(a) * r).toFixed(3)];
      m.wanderTick = state.tick + MOUNT.wander.every + Math.floor(hash(m.id, state.tick, 'w') * MOUNT.wander.every);
      if (ctx.world?.isWater?.(m.goal[0], m.goal[1])) m.goal = null;
    }
    if (m.goal) {
      const dx = m.goal[0] - m.position[0], dz = m.goal[1] - m.position[2], d = Math.hypot(dx, dz), step = MOUNT.wander.speed / 60 * (m.tamed ? 1 : .8);
      if (d <= step) m.goal = null;
      else {
        const at = [m.position[0] + dx / d * step, m.position[1], m.position[2] + dz / d * step];
        if (ctx.world) resolvePlaces(ctx.world, at, MOUNT.radius);
        at[1] = ctx.terrainHeight(state, at[0], at[2]);
        if (Math.abs(at[1] - m.position[1]) > .5 || ctx.world?.isWater?.(at[0], at[2])) m.goal = null; // never walk off a ledge or into water
        else { m.yaw = +yawToward(dx, dz).toFixed(4); m.position = at.map(n => +n.toFixed(4)); }
      }
    } else m.position[1] = ctx.terrainHeight(state, m.position[0], m.position[2]); // the ground may have been raised or lowered
  }
}

// ---------- placement ----------
function openSpot(world, x, z, slopeMax = .14) {
  if (world.isWater(x, z) || (world.slopeAt?.(x, z) ?? 0) > slopeMax) return false;
  const at = [x, world.heightAt(x, z), z]; resolvePlaces(world, at, 1.6);
  return Math.abs(at[0] - x) < .01 && Math.abs(at[2] - z) < .01;
}
const FOREST_BIOMES = new Set([4, 5]); // BIOME.FOREST, BIOME.PINE

/** Mounts for a new generated world: two horses beside the start, one wild tiger in a forest nearby. */
export function spawnWorldMounts(state, world, terrainHeight, [ox, oz] = [0, 0]) {
  const out = [], put = (kind, x, z, tamed, v) => out.push({id: `mount${out.length}`, kind, position: [+x.toFixed(3), +terrainHeight(state, x, z).toFixed(4), +z.toFixed(3)], yaw: +(hash(kind, out.length, 'yaw') * 6.2832 - 3.1416).toFixed(4), rider: null, tamed, home: [+x.toFixed(3), +z.toFixed(3)], v, wanderTick: 120 + out.length * 97});
  // Horses: a pair on open ground just outside the forge yard.
  for (let k = 0, placed = 0; k < 48 && placed < 2; k++) {
    const a = k * 2.39996 + .7, r = 11 + (k % 6) * 1.6, x = ox + Math.cos(a) * r, z = oz + Math.sin(a) * r;
    if (!openSpot(world, x, z) || out.some(m => Math.hypot(m.position[0] - x, m.position[2] - z) < 3)) continue;
    put('horse', x, z, true, placed); placed++;
    // The second horse grazes beside the first.
    for (let j = 0; j < 8 && placed < 2; j++) { const b = j * .785, x2 = x + Math.cos(b) * 3.2, z2 = z + Math.sin(b) * 3.2; if (openSpot(world, x2, z2)) { put('horse', x2, z2, true, 1); placed++; } }
  }
  // Tiger: the nearest forest glade 70-260 m out; open ground if the land has no forest close by.
  let tiger = null;
  for (let pass = 0; pass < 2 && !tiger; pass++) for (let k = 0; k < 160 && !tiger; k++) {
    const a = k * 2.39996, r = 70 + k * 1.2, x = ox + Math.cos(a) * r, z = oz + Math.sin(a) * r;
    if (pass === 0 && !FOREST_BIOMES.has(world.biomeAt(x, z))) continue;
    if (openSpot(world, x, z, .18)) tiger = [x, z];
  }
  if (tiger) put('tiger', tiger[0], tiger[1], false, 0);
  return out;
}

/** Validate saved mounts against the restored players. Missing mounts (older saves) come back as []. */
export function restoreMounts(saved, players, posOk) {
  const list = saved.mounts === undefined ? [] : saved.mounts;
  if (!Array.isArray(list) || list.length > MOUNT.max) throw Error('Invalid mounts');
  const ids = new Set(), riders = new Set(), heroes = new Set(players.filter(p => p.role === 'hero').map(p => p.id));
  const num = n => typeof n === 'number' && Number.isFinite(n);
  return list.map(m => {
    if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !/^mount\d{1,3}$/.test(m.id) || ids.has(m.id) || !MOUNT_KINDS.includes(m.kind) ||
        !posOk(m.position) || !num(m.yaw) || Math.abs(m.yaw) > 7 || typeof m.tamed !== 'boolean' ||
        !Array.isArray(m.home) || m.home.length !== 2 || !m.home.every(num) || !Number.isSafeInteger(m.v ?? 0) ||
        (m.rider !== null && (typeof m.rider !== 'string' || !heroes.has(m.rider) || riders.has(m.rider) || !m.tamed)) ||
        (m.goal != null && (!Array.isArray(m.goal) || m.goal.length !== 2 || !m.goal.every(num))) || (m.wanderTick !== undefined && !Number.isSafeInteger(m.wanderTick)))
      throw Error('Invalid mount');
    ids.add(m.id); if (m.rider) riders.add(m.rider);
    return {id: m.id, kind: m.kind, position: [...m.position], yaw: m.yaw, rider: m.rider, tamed: m.tamed, home: [...m.home], v: m.v ?? 0, ...(m.goal ? {goal: [...m.goal]} : {}), ...(m.wanderTick !== undefined ? {wanderTick: m.wanderTick} : {})};
  });
}
