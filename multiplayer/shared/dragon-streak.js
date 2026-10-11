// Dragon kill streak. Five skeleton killing blows in a row (without falling) earn a Hero one call of the dragon; calling
// it lifts the Hero onto a dragon that circles high over where they stood for 20 seconds, AC-130 style, with three
// attacks: a held fire-breath sweep, a three-fireball barrage and one huge comet dive. The rider steers: the dragon
// banks towards wherever they look, keeps circling when they don't, and turns itself back over the battlefield at
// the edges.
//
// Pure and deterministic like the rest of the room simulation: the host owns every number here. The flight is a chain
// of legs, each a constant-speed arc (or straight line) in closed form; steering starts a new leg from exactly where
// and how the last one was flying, so the path is continuous and dragonPose can be sampled at any fractional tick.
// Every client draws it every frame from the presentation clock and nothing about it is ever tick-stepped. Pending fireballs and dives carry their launch and impact ticks for the same
// reason. ctx supplies terrainHeight, hitEnemyPart and ignite (lit fuel + heat). Dragon damage never counts towards the next streak, and while riding the Hero's body is out of harm's way.
import {enemyHostileTo,battleSkirmish} from './battle-mode.js';

export const DRAGON = Object.freeze({
  streak: 5,          // skeleton killing blows that earn a ride
  rideTicks: 1200,    // 20 s in the air
  arriveTicks: 75,    // the swoop in from the clouds; attacks open once the dragon has arrived
  leaveTicks: 75,     // the climb away at the end; no new attacks in this window (pending ones still land)
  radius: 17,         // the opening orbit's radius around the spot the Hero called it from (m)
  speed: 8,           // flying speed (m/s)
  maxTurn: .9,        // fastest turn when steering (rad/s): a 9 m circle at full lock
  edge: 36,           // past this distance from the middle of the map the dragon turns itself back in (m)
  legs: 3,            // flight legs kept (the presentation clock lags the host a little, so the last few are needed)
  altitude: 22,       // above that spot's ground (m)
  reach: 60,          // furthest aim point from the dragon (m)
  centre: 30,         // the orbit centre is kept this far inside the world so the whole circle stays over the map
  safeTicks: 120,     // landing protection when the ride ends
  // Breath is physical: each pulse throws three globs of liquid fire from the mouth on real ballistic arcs (gravity,
  // spread), and only where a glob lands does it burn, so the stream lags, droops and sweeps with the dragon.
  breath: Object.freeze({tank: 150, pulseTicks: 6, regen: .6, regenDelay: 20, radius: 3, burn: 150,
    globs: 3, speed: 30, spread: 1.6, splash: 1.9, damage: 4.5, mouth: 4.35, mouthUp: .44, gravity: 9.8, inFlight: 48, maxFlight: 240}),
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

/** Ground position and heading angle h (heading = [sin h, 0, cos h]) along one leg, `dt` seconds after it began. */
function along(leg, dt) {
  const v = DRAGON.speed, w = leg.turn, h = leg.h + w * dt;
  if (Math.abs(w) < 1e-6) return {x: leg.x + Math.sin(leg.h) * v * dt, z: leg.z + Math.cos(leg.h) * v * dt, h};
  return {x: leg.x + v / w * (Math.cos(leg.h) - Math.cos(h)), z: leg.z + v / w * (Math.sin(h) - Math.sin(leg.h)), h};
}
// Rides saved before steering existed have no legs: they fly their opening orbit until the rider steers.
const legsOf = ride => ride.legs?.length ? ride.legs : [openingLeg(ride)];
function legAt(ride, tick) { const legs = legsOf(ride); let leg = legs[0]; for (const l of legs) if (l.t <= tick) leg = l; return leg; }
/** The opening leg: on the orbit circle at angle a0 around (cx, cz), flying round it in direction dir. */
function openingLeg(ride) {
  const w = ride.dir * DRAGON.speed / DRAGON.radius;
  return {t: ride.start, x: ride.cx + Math.cos(ride.a0) * DRAGON.radius, z: ride.cz + Math.sin(ride.a0) * DRAGON.radius, h: Math.atan2(-Math.sin(ride.a0) * ride.dir, Math.cos(ride.a0) * ride.dir), turn: -w, from: -w};
}

/**
 * Where the dragon is at `tick` (fractional): {position, heading (unit xz velocity), yaw, bank (rad), turn, intro 0..1,
 * outro 0..1}. It swoops down out of the sky from behind on arrival and climbs away at the end, with a gentle bob, and
 * banks into its turns. Continuous in tick, so presentation can sample it at any frame rate.
 */
export function dragonPose(ride, tick) {
  const t = (tick - ride.start) / HZ, leg = legAt(ride, tick), g = along(leg, Math.max(0, tick - leg.t) / HZ);
  const intro = smooth((tick - ride.start) / DRAGON.arriveTicks), outro = smooth((tick - (ride.end - DRAGON.leaveTicks)) / DRAGON.leaveTicks);
  const heading = [Math.sin(g.h), 0, Math.cos(g.h)];
  // Arrive high and from behind, leave climbing: only height and the run-in ease, so the path itself stays put.
  const back = 30 * (1 - intro) ** 2, lift = 34 * (1 - intro) ** 2 + 30 * outro * outro, bob = Math.sin(t * 2.1) * .6;
  const position = [g.x - heading[0] * back, ride.y + DRAGON.altitude + lift + bob, g.z - heading[2] * back];
  // Bank eases from the previous leg's turn into this one's over half a second, so a new steer never snaps the wings.
  const turn = leg.from + (leg.turn - leg.from) * smooth((tick - leg.t) / 30);
  return {position, heading, yaw: g.h, bank: clamp(-turn * .55, -.6, .6), turn, intro, outro};
}

/**
 * The globs of one breath pulse: [{o, v, at}] where position(t) = o + v t + ½ g t² for t = (tick - launch) / 60 seconds,
 * landing at tick `at` (stored by the host when it fired, because only the host samples the terrain for it). Spread is
 * a fixed hash of the launch tick, so every client draws the same arcs from the snapshot.
 */
export function breathGlob(pulse, i) {
  const B = DRAGON.breath, a = (pulse.launch * 2654435761 + i * 40503) >>> 0, r1 = (a % 1000) / 1000 - .5, r2 = ((a >>> 10) % 1000) / 1000 - .5, r3 = ((a >>> 20) % 1000) / 1000 - .5;
  return {o: pulse.o, v: [pulse.v[0] + r1 * B.spread * 2, pulse.v[1] + r2 * B.spread, pulse.v[2] + r3 * B.spread * 2], at: pulse.at[i]};
}
export function globPosition(pulse, g, tick, out = [0, 0, 0]) {
  const t = Math.max(0, tick - pulse.launch) / HZ;
  out[0] = g.o[0] + g.v[0] * t; out[1] = g.o[1] + g.v[1] * t - .5 * DRAGON.breath.gravity * t * t; out[2] = g.o[2] + g.v[2] * t;
  return out;
}
function launchBreath(state, ride, at, ctx) {
  const B = DRAGON.breath, pose = dragonPose(ride, state.tick), h = pose.heading;
  const o = [pose.position[0] + h[0] * B.mouth, pose.position[1] + B.mouthUp, pose.position[2] + h[2] * B.mouth];
  const d = Math.hypot(at[0] - o[0], at[1] - o[1], at[2] - o[2]), T = Math.max(.25, d / B.speed);
  // The arc that reaches the aim point in T seconds under gravity.
  const v = [(at[0] - o[0]) / T, (at[1] - o[1]) / T + .5 * B.gravity * T, (at[2] - o[2]) / T];
  const pulse = {launch: state.tick, o, v, at: [], landed: 0};
  for (let i = 0; i < B.globs; i++) {
    const g = breathGlob({...pulse, at: [0, 0, 0]}, i), p = [0, 0, 0];
    let k = 1; for (; k < B.maxFlight; k++) { globPosition(pulse, g, state.tick + k, p); if (p[1] <= ctx.terrainHeight(state, p[0], p[2])) break; }
    pulse.at.push(state.tick + k);
  }
  (ride.flames ??= []).push(pulse);
  while (ride.flames.length > B.inFlight) ride.flames.shift();
}

/** Start a new leg at `tick` from exactly where the current one is, turning at `turn` rad/s. */
function steerTo(ride, tick, turn, forced = false) {
  const pose = dragonPose(ride, tick), leg = legAt(ride, tick), g = along(leg, (tick - leg.t) / HZ);
  ride.legs = legsOf(ride);
  ride.legs.push({t: tick, x: g.x, z: g.z, h: g.h, turn, from: pose.turn, ...(forced ? {forced: true} : {})});
  while (ride.legs.length > DRAGON.legs) ride.legs.shift();
}
/** Turn sign that brings heading h round towards the middle of the map from (x, z). */
const inward = (x, z, h) => Math.sign(Math.cos(h) * -x - Math.sin(h) * -z) || 1;

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
    p.dragon.legs = [openingLeg(p.dragon)];
    p.dragonReady = false; p.move = [0, 0];
    return {ok: true, events: [{kind: 'dragon_summon', id: p.id, position: [...p.position], centre: [cx, p.dragon.y, cz]}]};
  }
  const ride = p.dragon;
  if (!ride) return fail('dragon_not_riding');
  if (m.steer !== undefined) {
    // {steer: -1..1}: the rider's wanted turn, in quarter steps. Ignored while arriving or leaving, and while the
    // dragon is turning itself back from the edge of the map; a burst faster than every 6 ticks keeps the current leg.
    if (!finite(m.steer) || Math.abs(m.steer) > 1) return fail('invalid_action');
    const legs = legsOf(ride), leg = legs[legs.length - 1], turn = Math.round(m.steer * 4) / 4 * DRAGON.maxTurn;
    if (state.tick < ride.start + DRAGON.arriveTicks || state.tick >= ride.end - DRAGON.leaveTicks || leg.forced || turn === leg.turn || state.tick - leg.t < 6) return {ok: true, events: []};
    steerTo(ride, state.tick, turn);
    return {ok: true, events: []};
  }
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
    launchBreath(state, ride, at, ctx);
    return {ok: true, events: []};
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
    // The edge of the map: heading out past it, the dragon turns itself back in at full lock, then hands back control.
    if (state.tick >= ride.start + DRAGON.arriveTicks) {
      const pose = dragonPose(ride, state.tick), [x, , z] = pose.position, legs = legsOf(ride), leg = legs[legs.length - 1], r = Math.hypot(x, z);
      const out = (x * pose.heading[0] + z * pose.heading[2]) / Math.max(r, 1e-3);
      if (!leg.forced && r > DRAGON.edge && out > .2 && state.tick - leg.t >= 6) steerTo(ride, state.tick, inward(x, z, pose.yaw) * DRAGON.maxTurn, true);
      else if (leg.forced && out < -.6) steerTo(ride, state.tick, 0);
    }
    if (state.tick - ride.breathTick > DRAGON.breath.regenDelay) ride.breath = Math.min(DRAGON.breath.tank, ride.breath + DRAGON.breath.regen);
    // Breath globs land where their arcs meet the ground: a splash of fire. Only the middle glob of each pulse leaves
    // burning fuel, so the ground fire stays a trail of patches rather than a carpet.
    const B = DRAGON.breath;
    for (const pulse of [...(ride.flames || [])]) {
      for (let i = 0; i < pulse.at.length; i++) {
        if (pulse.landed & (1 << i) || pulse.at[i] > state.tick) continue;
        pulse.landed |= 1 << i;
        const g = breathGlob(pulse, i), q = globPosition(pulse, g, pulse.at[i]), at = [q[0], ctx.terrainHeight(state, q[0], q[2]), q[2]];
        if (Math.abs(at[0]) > BOUND || Math.abs(at[2]) > BOUND) continue;
        scorch(state, p, at, B.splash, B.damage, 0, B.burn, ctx, events);
        if (i === 0 && pulse.launch % (B.pulseTicks * 2) < B.pulseTicks) burnGround(state, at, .8, ctx);
      }
      if (pulse.landed === (1 << pulse.at.length) - 1) ride.flames.splice(ride.flames.indexOf(pulse), 1);
    }
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
const validLeg = (l, r, tick) => record(l) && Number.isSafeInteger(l.t) && l.t >= r.start && l.t <= tick && [l.x, l.z, l.h, l.turn, l.from].every(finite) &&
  Math.abs(l.x) <= 200 && Math.abs(l.z) <= 200 && Math.abs(l.h) <= 1e4 && Math.abs(l.turn) <= DRAGON.maxTurn + 1 && Math.abs(l.from) <= DRAGON.maxTurn + 1 && (l.forced === undefined || l.forced === true);
const validPulse = (f, r) => record(f) && Number.isSafeInteger(f.launch) && f.launch >= r.start && f.launch <= r.end && [f.o, f.v].every(a => Array.isArray(a) && a.length === 3 && a.every(n => finite(n) && Math.abs(n) <= 300)) &&
  Array.isArray(f.at) && f.at.length === DRAGON.breath.globs && f.at.every(t => Number.isSafeInteger(t) && t > f.launch && t <= f.launch + DRAGON.breath.maxFlight) && Number.isSafeInteger(f.landed) && f.landed >= 0 && f.landed < 1 << DRAGON.breath.globs;
const validRide = (r, tick) => record(r) && Number.isSafeInteger(r.start) && r.start <= tick && r.end === r.start + DRAGON.rideTicks && r.end > tick &&
  [r.cx, r.cz, r.y, r.a0, r.breath].every(finite) && Math.abs(r.cx) <= DRAGON.centre && Math.abs(r.cz) <= DRAGON.centre && Math.abs(r.y) <= 200 && Math.abs(r.a0) <= 10 &&
  [1, -1].includes(r.dir) && r.breath >= 0 && r.breath <= DRAGON.breath.tank &&
  ['breathTick', 'fireballTick', 'diveTick'].every(k => Number.isSafeInteger(r[k]) && r[k] >= -1000 && r[k] <= tick) &&
  Array.isArray(r.aim) && r.aim.length === 3 && r.aim.every(finite) && Array.isArray(r.strikes) && r.strikes.length <= 8 && r.strikes.every(s => validStrike(s, r)) &&
  (r.flames === undefined || Array.isArray(r.flames) && r.flames.length <= DRAGON.breath.inFlight && r.flames.every(f => validPulse(f, r))) &&
  (r.legs === undefined || Array.isArray(r.legs) && r.legs.length >= 1 && r.legs.length <= DRAGON.legs && r.legs.every((l, i) => validLeg(l, r, tick) && (!i || l.t >= r.legs[i - 1].t)));
/** Save validation for the optional streak fields (older saves have none). */
export const validDragonFields = (p, tick) => (p.streak === undefined || Number.isSafeInteger(p.streak) && p.streak >= 0 && p.streak < DRAGON.streak) &&
  (p.dragonReady === undefined || typeof p.dragonReady === 'boolean') && (p.dragon === undefined || p.role === 'hero' && validRide(p.dragon, tick));
