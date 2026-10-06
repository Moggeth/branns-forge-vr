// Dragon kill streak. Five skeleton killing blows in a row (without falling) earn a Hero one call of the dragon; calling
// it lifts the Hero onto a dragon that circles high over where they stood for 20 seconds, AC-130 style, with three
// attacks: a held fire-breath sweep, a three-fireball barrage and one huge comet dive.
//
// Pure and deterministic like the rest of the room simulation: the host owns every number here. The dragon's flight is
// a closed-form function of the tick (dragonPose), so every client draws it every frame from the presentation clock and
// nothing about it is ever tick-stepped. Pending fireballs and dives carry their launch and impact ticks for the same
// reason. ctx supplies terrainHeight, hitEnemyPart and ignite (lit fuel + heat). Dragon damage never counts towards the next streak, and while riding the Hero's body is out of harm's way.
import {enemyHostileTo,battleSkirmish} from './battle-mode.js';

export const DRAGON = Object.freeze({
  streak: 5,          // skeleton killing blows that earn a ride
  rideTicks: 1200,    // 20 s in the air
  arriveTicks: 75,    // the swoop in from the clouds; attacks open once the dragon has arrived
  leaveTicks: 75,     // the climb away at the end; no new attacks in this window (pending ones still land)
  radius: 17,         // orbit radius around the spot the Hero called it from (m)
  altitude: 22,       // above that spot's ground (m)
  lapSeconds: 16,
  reach: 60,          // furthest aim point from the dragon (m)
  centre: 30,         // the orbit centre is kept this far inside the world so the whole circle stays over the map
  safeTicks: 120,     // landing protection when the ride ends
  breath: Object.freeze({tank: 150, pulseTicks: 6, regen: .6, regenDelay: 20, radius: 3, damage: 10, burn: 150}),
  fireball: Object.freeze({cooldown: 84, count: 3, gap: 9, flight: 33, radius: 3.6, damage: 60, spread: 2.4, push: 1.2}),
  dive: Object.freeze({cooldown: 360, windup: 60, radius: 7.5, damage: 190, push: 3.2}),
});
export const DRAGON_ATTACKS = Object.freeze(['breath', 'fireball', 'dive']);
const HZ = 60, BOUND = 55, finite = n => typeof n === 'number' && Number.isFinite(n);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = code => ({ok: false, code, events: []});

/** Is this player on their dragon at `tick` (fractional ticks are fine)? */
export const dragonRiding = (p, tick) => !!p?.dragon && tick < p.dragon.end;

/**
 * Where the dragon is at `tick` (fractional): {position, heading (unit xz velocity), bank (rad), intro 0..1, outro 0..1}.
 * A circle of DRAGON.radius at DRAGON.altitude over (cx, y, cz), swooping down out of the sky on arrival and climbing
 * away at the end, with a gentle bob. Continuous in tick, so presentation can sample it at any frame rate.
 */
export function dragonPose(ride, tick) {
  const t = (tick - ride.start) / HZ, w = ride.dir * 2 * Math.PI / DRAGON.lapSeconds, a = ride.a0 + w * t;
  const intro = smooth((tick - ride.start) / DRAGON.arriveTicks), outro = smooth((tick - (ride.end - DRAGON.leaveTicks)) / DRAGON.leaveTicks);
  // Arrive from high and wide, leave climbing and widening: the circle is the same, only its size and height ease.
  const r = DRAGON.radius * (1 + .9 * (1 - intro) + 1.4 * outro);
  const lift = 34 * (1 - intro) ** 2 + 30 * outro * outro;
  const bob = Math.sin(t * 2.1) * .6;
  const position = [ride.cx + Math.cos(a) * r, ride.y + DRAGON.altitude + lift + bob, ride.cz + Math.sin(a) * r];
  // Tangent of the circle in the flying direction.
  const heading = [-Math.sin(a) * ride.dir, 0, Math.cos(a) * ride.dir];
  return {position, heading, bank: .32 * ride.dir, intro, outro};
}

/** Count a killing blow towards the streak. Called by combat.js for every kill a player is credited with. */
export function noteKill(state, owner, enemy, hit, events) {
  if (owner?.role !== 'hero' || enemy?.kind !== 'skeleton' || hit?.tool === 'dragon' || owner.dragon || owner.dragonReady) return;
  owner.streak = (owner.streak || 0) + 1;
  if (owner.streak >= DRAGON.streak) {
    owner.streak = 0; owner.dragonReady = true;
    events.push({kind: 'dragon_ready', id: owner.id, position: [...owner.position]});
  } else events.push({kind: 'streak', id: owner.id, count: owner.streak, need: DRAGON.streak, position: [...enemy.position]});
}
/** A fallen Hero loses the streak in progress (an earned dragon stays earned). */
export function breakStreak(p) { if (p.streak) p.streak = 0; }
/** Leaving the Hero role sends the dragon home early (its pending strikes are dropped). */
export function dismissDragon(p) { delete p.dragon; }

function aimPoint(state, ride, m, ctx) {
  const pt = m.point;
  if (!Array.isArray(pt) || pt.length !== 3 || !pt.every(finite) || Math.abs(pt[0]) > BOUND || Math.abs(pt[2]) > BOUND) return null;
  const at = [pt[0], ctx.terrainHeight(state, pt[0], pt[2]), pt[2]], from = dragonPose(ride, state.tick).position;
  return Math.hypot(at[0] - from[0], at[1] - from[1], at[2] - from[2]) <= DRAGON.reach ? at : null;
}
function burnGround(state, at, radius, ctx) {
  if (!battleSkirmish(state)) ctx.ignite?.(state, at, radius);
}
function scorch(state, p, at, radius, damage, push, burn, ctx, events) {
  const hits = [];
  for (const enemy of [...state.enemies]) {
    if (!enemyHostileTo(enemy, p.side || 'party')) continue;
    const dx = enemy.position[0] - at[0], dz = enemy.position[2] - at[2], d = Math.hypot(dx, dz);
    if (d > radius || Math.abs(enemy.position[1] - at[1]) > 4) continue;
    if (burn) { enemy.burnUntil = state.tick + burn; enemy.burnPart = 'torso'; }
    ctx.hitEnemyPart(state, enemy, 'torso', damage * (1 - .35 * d / radius), {tool: 'dragon', point: [enemy.position[0], enemy.position[1] + 1, enemy.position[2]], normal: [0, 1, 0], ownerId: p.id, side: p.side || 'party', energy: 1.6}, ctx, events);
    hits.push(enemy.id);
    if (push && state.enemies.includes(enemy) && enemy.kind !== 'ent') {
      const k = push * (1 - .5 * d / radius), nx = d > 1e-3 ? dx / d : 1, nz = d > 1e-3 ? dz / d : 0;
      enemy.position[0] = clamp(enemy.position[0] + nx * k, -49, 49); enemy.position[2] = clamp(enemy.position[2] + nz * k, -49, 49); enemy.launchTick = state.tick;
    }
  }
  return hits;
}

/** {action:'dragon', call:true} or {action:'dragon', attack:'breath'|'fireball'|'dive', point:[x,y,z]}. */
export function dragonAction(state, p, m, ctx) {
  if (m.call === true) {
    if (p.dragon) return fail('dragon_riding');
    if (!p.dragonReady) return fail('dragon_not_ready');
    const cx = clamp(p.position[0], -DRAGON.centre, DRAGON.centre), cz = clamp(p.position[2], -DRAGON.centre, DRAGON.centre);
    // Arrive from behind the Hero, circling the way that keeps the ground on the Hero's right.
    const a0 = Math.atan2(Math.cos(p.yaw || 0), Math.sin(p.yaw || 0));
    p.dragon = {start: state.tick, end: state.tick + DRAGON.rideTicks, cx, cz, y: ctx.terrainHeight(state, cx, cz), a0: Number.isFinite(a0) ? a0 : 0, dir: 1,
      breath: DRAGON.breath.tank, breathTick: -1000, fireballTick: -1000, diveTick: -1000, aim: [cx, ctx.terrainHeight(state, cx, cz), cz], strikes: []};
    p.dragonReady = false; p.move = [0, 0];
    return {ok: true, events: [{kind: 'dragon_summon', id: p.id, position: [...p.position], centre: [cx, p.dragon.y, cz]}]};
  }
  const ride = p.dragon;
  if (!ride) return fail('dragon_not_riding');
  if (!DRAGON_ATTACKS.includes(m.attack)) return fail('invalid_action');
  if (state.tick < ride.start + DRAGON.arriveTicks || state.tick >= ride.end - DRAGON.leaveTicks) return {ok: true, events: []};
  const at = aimPoint(state, ride, m, ctx);
  if (!at) return fail('out_of_reach');
  ride.aim = at;
  const from = dragonPose(ride, state.tick).position;
  if (m.attack === 'breath') {
    const B = DRAGON.breath;
    // The client paces its pulses; anything faster, or a dry tank, is quietly ignored rather than reported.
    if (state.tick - ride.breathTick < B.pulseTicks - 1 || ride.breath < B.pulseTicks) return {ok: true, events: []};
    ride.breath -= B.pulseTicks; ride.breathTick = state.tick;
    const events = [];
    scorch(state, p, at, B.radius, B.damage, 0, B.burn, ctx, events);
    burnGround(state, at, 1.3, ctx);
    return {ok: true, events};
  }
  if (m.attack === 'fireball') {
    const F = DRAGON.fireball;
    if (state.tick - ride.fireballTick < F.cooldown) return fail('dragon_cooldown');
    ride.fireballTick = state.tick;
    const shots = [];
    for (let i = 0; i < F.count; i++) {
      // A tight triangle around the aim point: the middle ball lands dead on, the others either side.
      const ang = ride.a0 + i * 2.0944, r = i ? F.spread : 0, x = clamp(at[0] + Math.cos(ang) * r, -BOUND, BOUND), z = clamp(at[2] + Math.sin(ang) * r, -BOUND, BOUND);
      const launch = state.tick + i * F.gap, strike = {kind: 'fireball', x, y: ctx.terrainHeight(state, x, z), z, launch, at: launch + F.flight};
      ride.strikes.push(strike); shots.push({...strike});
    }
    return {ok: true, events: [{kind: 'dragon_fireball', id: p.id, from, shots}]};
  }
  const D = DRAGON.dive;
  if (state.tick - ride.diveTick < D.cooldown) return fail('dragon_cooldown');
  ride.diveTick = state.tick;
  const strike = {kind: 'dive', x: at[0], y: at[1], z: at[2], launch: state.tick, at: state.tick + D.windup};
  ride.strikes.push(strike);
  return {ok: true, events: [{kind: 'dragon_dive', id: p.id, from, strike: {...strike}}]};
}

/** Every tick: refill breath, land due strikes, and end finished rides. */
export function stepDragons(state, ctx, events) {
  for (const p of state.players) {
    const ride = p.dragon; if (!ride) continue;
    if (state.tick - ride.breathTick > DRAGON.breath.regenDelay) ride.breath = Math.min(DRAGON.breath.tank, ride.breath + DRAGON.breath.regen);
    for (const s of [...ride.strikes]) {
      if (s.at > state.tick) continue;
      ride.strikes.splice(ride.strikes.indexOf(s), 1);
      const at = [s.x, ctx.terrainHeight(state, s.x, s.z), s.z], spec = s.kind === 'dive' ? DRAGON.dive : DRAGON.fireball;
      const hits = scorch(state, p, at, spec.radius, spec.damage, spec.push, DRAGON.breath.burn, ctx, events);
      burnGround(state, at, s.kind === 'dive' ? 3.2 : 1.6, ctx);
      events.push({kind: 'dragon_impact', id: p.id, strike: s.kind, position: at, radius: spec.radius, hits});
    }
    if (state.tick >= ride.end) {
      delete p.dragon; p.protectedUntil = Math.max(p.protectedUntil ?? 0, state.tick + DRAGON.safeTicks);
      events.push({kind: 'dragon_depart', id: p.id, position: [...p.position], protectedUntil: p.protectedUntil});
    }
  }
}

const validStrike = (s, ride) => record(s) && ['fireball', 'dive'].includes(s.kind) && [s.x, s.y, s.z].every(finite) && Math.abs(s.x) <= BOUND && Math.abs(s.z) <= BOUND && Math.abs(s.y) <= 200 &&
  Number.isSafeInteger(s.launch) && Number.isSafeInteger(s.at) && s.launch >= ride.start && s.at >= s.launch && s.at <= ride.end;
const validRide = (r, tick) => record(r) && Number.isSafeInteger(r.start) && r.start <= tick && r.end === r.start + DRAGON.rideTicks && r.end > tick &&
  [r.cx, r.cz, r.y, r.a0, r.breath].every(finite) && Math.abs(r.cx) <= DRAGON.centre && Math.abs(r.cz) <= DRAGON.centre && Math.abs(r.y) <= 200 && Math.abs(r.a0) <= 10 &&
  [1, -1].includes(r.dir) && r.breath >= 0 && r.breath <= DRAGON.breath.tank &&
  ['breathTick', 'fireballTick', 'diveTick'].every(k => Number.isSafeInteger(r[k]) && r[k] >= -1000 && r[k] <= tick) &&
  Array.isArray(r.aim) && r.aim.length === 3 && r.aim.every(finite) && Array.isArray(r.strikes) && r.strikes.length <= 8 && r.strikes.every(s => validStrike(s, r));
/** Save validation for the optional streak fields (older saves have none). */
export const validDragonFields = (p, tick) => (p.streak === undefined || Number.isSafeInteger(p.streak) && p.streak >= 0 && p.streak < DRAGON.streak) &&
  (p.dragonReady === undefined || typeof p.dragonReady === 'boolean') && (p.dragon === undefined || p.role === 'hero' && validRide(p.dragon, tick));
