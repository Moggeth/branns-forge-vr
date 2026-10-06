// Stormreel: a lightning crossbow fed by a cable-reel backpack that is plugged into a Stormspire tower.
// One table drives the authority (this file, inventions.js, simulation.js) and the presentation (client/stormreel-*.js).
//
// The circuit is the rule. The tower stores charge (b.charge, 0..240) from Crystal fed into its hopper. The pack's cable
// carries it to the crossbow; the bolt trails a fine copper filament (like a taser probe), so a hit closes the loop:
// tower -> cable -> crossbow -> filament -> bolt -> target -> ground -> the tower's earth stakes.
//   Grounded target: the full shock runs through it into the earth (more when the world is wet).
//   Grounded neighbours: the current spreading through the soil jolts them (step voltage).
//   Target off the ground (more than arcGap up): no path to earth, only the bolt and a little static.
//   An empty tower still throws the bolt: the crossbow is a crossbow without the lightning.
// Carrying: the tower's existing `operator` field names the Hero wearing its pack, and that Hero's tool is 'stormreel'.
// The cable is the range limit: the wearer can never stand further than `cable` metres (flat) from the terminal.
import {partPosition,validPartHit,PARTS} from './combat.js';
import {enemyHostileTo} from './battle-mode.js';
import {raining} from './weather-spell.js';
import {worldColliders,insideVolume} from './colliders.js';
import {resolveHomeStructures} from './home-bases.js';

export const STORMREEL = Object.freeze({
  cable: 30,            // metres of cable on the drum (flat distance from the tower terminal)
  strain: 25,           // the cable starts to pull visibly from here
  chargeTicks: 48,      // a full charge takes 0.8 s of holding
  minCharge: .2,        // a tap still fires a weak shot
  cooldownTicks: 30,    // fastest re-fire the host accepts (the hold itself is most of the cycle)
  maxCharge: 240,       // stored in the tower's charge field (12 full shots)
  shotCost: 20,         // one full shot of stored charge
  crystalCharge: 80,    // one Crystal = four full shots
  range: 48,            // metres; the bolt flies fast and flat enough to resolve as a ray
  bolt: 30,             // the bolt itself (scaled .4..1 by the hold)
  shock: 90,            // the lightning through a grounded target (scaled by the hold)
  airStatic: 15,        // a target off the ground only crackles
  wet: 1.5,             // rain multiplies the shock
  arcGap: 2,            // metres the arc will jump from a target's feet to the ground
  stepRadius: 2.5,      // grounded neighbours within this of the strike point are jolted
  stepDamage: 25,
  groundStrike: .5,     // a live bolt into the ground jolts neighbours at half strength
  takeReach: 3.6,       // metres from the tower to shoulder or hang the pack, and to feed crystal
});
// glTF frame of stormspire.glb (assets-source/stormreel): -Z forward, +Y up, origin on the ground at the tower centre.
export const STORMSPIRE = Object.freeze({terminal: [1.34, 1.85, 0], hook: [1.25, 1.4, 0], top: [0, 5.35, 0], radius: 1.45});

const rotate = (b, local) => {const c = Math.cos(b.yaw || 0), s = Math.sin(b.yaw || 0); return [b.position[0] + local[0] * c + local[2] * s, b.position[1] + local[1], b.position[2] - local[0] * s + local[2] * c];};
/** World position of the tower's cable terminal (where the pack cable is bonded). */
export const terminalPoint = b => rotate(b, STORMSPIRE.terminal);
export const hookPoint = b => rotate(b, STORMSPIRE.hook);
export const towerTop = b => rotate(b, STORMSPIRE.top);
export const chargeShots = b => Math.floor((b?.charge || 0) / STORMREEL.shotCost);
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** The tower whose pack this player wears, if any. */
export function wornTower(state, p) {
  if (!p || p.tool !== 'stormreel') return null;
  return state.inventions?.structures?.find(b => b.type === 'stormspire' && b.hp > 0 && b.operator === p.id) || null;
}

/** Keep a wearer within cable reach of the terminal (authority and local prediction call the same function). */
export function leash(state, p, position) {
  const b = wornTower(state, p); if (!b) return false;
  const t = terminalPoint(b), dx = position[0] - t[0], dz = position[2] - t[2], d = Math.hypot(dx, dz);
  if (d <= STORMREEL.cable) return false;
  position[0] = t[0] + dx / d * STORMREEL.cable; position[2] = t[2] + dz / d * STORMREEL.cable;
  return true;
}
/** 0 slack .. 1 at the end of the cable (for the creak, the HUD and the cable sag). */
export function cableStrain(b, position) {
  const d = flat(position, terminalPoint(b));
  return Math.max(0, Math.min(1, (d - STORMREEL.strain) / (STORMREEL.cable - STORMREEL.strain)));
}

/** Drop the pack: it winds home to the hook. Called on unequip, role change, death and leaving. */
export function releasePack(state, p, events = []) {
  for (const b of state.inventions?.structures || []) if (b.type === 'stormspire' && b.operator === p.id) {
    b.operator = null; events.push({kind: 'storm_pack_home', id: b.id, structureId: b.id, by: p.id, position: hookPoint(b)});
  }
  if (p.tool === 'stormreel') p.tool = 'axe';
  return events;
}

/** inventionUse on a Stormspire: feed Crystal when it is not full and you carry some, otherwise take or hang the pack. */
export function useStormspire(state, p, b, m, pay, ok, fail) {
  if (p.role !== 'hero') return fail('invalid_action');
  if (flat(p.position, b.position) > STORMREEL.takeReach + STORMSPIRE.radius) return fail('too_far');
  if (m.feed !== undefined && typeof m.feed !== 'boolean') return fail('invalid_action');
  if (m.feed) {
    if (b.charge >= STORMREEL.maxCharge) return fail('not_needed');
    if (!pay({gems: 1})) return fail('insufficient_resources');
    b.charge = Math.min(STORMREEL.maxCharge, b.charge + STORMREEL.crystalCharge);
    return ok([{kind: 'storm_charge', id: b.id, structureId: b.id, by: p.id, position: [...b.position], charge: b.charge, crystal: true}]);
  }
  // Taking or hanging the pack also drops one carried Crystal into the hopper when a whole one fits, so a phone
  // player needs no second button; R near the tower while wearing the pack feeds on purpose (feed: true).
  const topUp = events => {
    if (b.charge > STORMREEL.maxCharge - STORMREEL.crystalCharge || !pay({gems: 1})) return;
    b.charge += STORMREEL.crystalCharge;
    events.push({kind: 'storm_charge', id: b.id, structureId: b.id, by: p.id, position: [...b.position], charge: b.charge, crystal: true});
  };
  if (b.operator === p.id) { const events = []; topUp(events); releasePack(state, p, events); return ok(events); }
  if (b.operator && state.players.some(h => h.id === b.operator && h.tool === 'stormreel')) return fail('machine_manned');
  if (p.heldOre || state.looseLogs?.some(l => l.heldBy === p.id) || state.detachedParts?.some(d => d.heldBy === p.id)) return fail('hands_full');
  for (const x of state.inventions.structures) if (x.type === 'stormspire' && x.operator === p.id) x.operator = null;
  b.operator = p.id; p.tool = 'stormreel';
  const events = [{kind: 'storm_pack_take', id: b.id, structureId: b.id, by: p.id, position: hookPoint(b)}]; topUp(events);
  return ok(events);
}

/** Per tick: a pack whose wearer has gone, changed tool or role, or died winds home. */
export function stepStormspires(state, events) {
  for (const b of state.inventions?.structures || []) {
    if (b.type !== 'stormspire' || !b.operator) continue;
    const p = state.players.find(h => h.id === b.operator);
    if (!p || p.role !== 'hero' || p.tool !== 'stormreel' || b.hp <= 0 || p.hp <= 0) {
      b.operator = null; events.push({kind: 'storm_pack_home', id: b.id, structureId: b.id, by: p?.id || null, position: hookPoint(b)});
      if (p && p.tool === 'stormreel') p.tool = 'axe';
    }
  }
  for (const p of state.players) if (p.tool === 'stormreel' && !wornTower(state, p)) p.tool = 'axe';
}

/** A God's lightning bolt landing on a Stormspire fills it instead of hurting it. Returns the towers it charged. */
export function lightningCharge(state, at, events) {
  const hit = [];
  for (const b of state.inventions?.structures || []) {
    if (b.type !== 'stormspire' || b.hp <= 0 || flat(b.position, at) > 3.5) continue;
    b.charge = STORMREEL.maxCharge; hit.push(b.id);
    events.push({kind: 'storm_charge', id: b.id, structureId: b.id, position: towerTop(b), charge: b.charge, lightning: true});
  }
  return hit;
}

const PART_REACH = part => part === 'head' ? .4 : part === 'torso' ? .68 : .5;
/** Nearest hostile body part along a ray: {enemy, part, t, point} or null. Uses the authority's part envelopes. */
export function rayEnemy(state, origin, dir, range, side) {
  let best = null;
  for (const e of state.enemies) {
    if (e.hp <= 0 || !enemyHostileTo(e, side)) continue;
    if (Math.hypot(e.position[0] - origin[0], e.position[2] - origin[2]) > range + 4) continue;
    const s = e.kind === 'golem' ? 1.45 : e.kind === 'ent' ? 2.2 : 1;
    for (const part of PARTS) {
      if (e.missingParts?.includes(part)) continue;
      const c = partPosition(e, part); if (part === 'head' && e.kind === 'skeleton') c[1] = e.position[1] + 1.5;
      const r = PART_REACH(part) * s, o = c.map((v, i) => v - origin[i]), t = o[0] * dir[0] + o[1] * dir[1] + o[2] * dir[2];
      if (t < 0 || t > range) continue;
      const q = origin.map((v, i) => v + dir[i] * t), d = Math.hypot(...q.map((v, i) => v - c[i]));
      if (d > r) continue;
      const tt = Math.max(0, t - Math.sqrt(Math.max(0, r * r - d * d)) * .5);
      if (!best || tt < best.t) best = {enemy: e, part, t: tt, point: origin.map((v, i) => v + dir[i] * tt)};
    }
  }
  if (best && !validPartHit(best.enemy, best.part, best.point)) best.point = partPosition(best.enemy, best.part);
  return best;
}
/** First ground contact along a ray (half-metre march, then bisection). */
/** First solid thing the bolt meets that is not ground or a foe: buildings, trees, stone, home-base walls.
 *  Uses the same measured volumes as the Timberline (shared/colliders.js); exclude is the Stormspire the shot is wired to. */
export function rayWorld(state, height, origin, dir, range, exclude = null) {
  const ex = origin[0] + dir[0] * range, ez = origin[2] + dir[2] * range, sx = ex - origin[0], sz = ez - origin[2], ss = sx * sx + sz * sz || 1;
  const near = (x, z, r) => { const u = Math.max(0, Math.min(1, ((x - origin[0]) * sx + (z - origin[2]) * sz) / ss)); return Math.hypot(x - origin[0] - sx * u, z - origin[2] - sz * u) < r + .5; };
  const solids = worldColliders(state, {terrainHeight: (_, x, z) => height(x, z), near, exclude}).filter(v => v.kind !== 'enemy');
  const home = state.battle?.v === 2 && state.battle.status === 'running', probe = [0, 0, 0];
  if (!solids.length && !home) return null;
  for (let t = .3; t <= range; t += .25) {
    const p = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
    let v = solids.find(v => insideVolume(v, p));
    // Home-base buildings: the same footprints that stop walkers, up to roof height.
    if (!v && home && p[1] - height(p[0], p[2]) < 4.5) { probe[0] = p[0]; probe[2] = p[2]; resolveHomeStructures(state, probe, 0); if (probe[0] !== p[0] || probe[2] !== p[2]) v = {kind: 'block', obj: {id: 'home'}}; }
    if (v) return {t, point: p, id: v.obj?.id ?? null, kind: v.kind, shape: v.shape};
  }
  return null;
}
export function rayGround(height, origin, dir, range) {
  let prev = 0;
  for (let t = .5; t <= range; t += .5) {
    const x = origin[0] + dir[0] * t, y = origin[1] + dir[1] * t, z = origin[2] + dir[2] * t;
    if (y <= height(x, z)) {
      let a = prev, b = t;
      for (let k = 0; k < 6; k++) { const m = (a + b) / 2; if (origin[1] + dir[1] * m <= height(origin[0] + dir[0] * m, origin[2] + dir[2] * m)) b = m; else a = m; }
      return {t: b, point: [origin[0] + dir[0] * b, height(origin[0] + dir[0] * b, origin[2] + dir[2] * b), origin[2] + dir[2] * b]};
    }
    prev = t;
  }
  return null;
}

/** Resolve one Stormreel shot. ctx: {terrainHeight(state,x,z), hitEnemyPart(state,enemy,part,amount,hit,ctx,events)}. */
export function stormShot(state, p, m, ctx) {
  const fail = code => ({ok: false, code, events: []});
  const b = wornTower(state, p); if (!b) return fail('no_pack');
  const vec = v => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) <= 200);
  if (!vec(m.origin) || Math.hypot(...m.origin.map((v, i) => v - p.position[i])) > 2.7 || !vec(m.direction) || Math.abs(Math.hypot(...m.direction) - 1) > .02) return fail('invalid_action');
  if (!Number.isFinite(m.charge) || m.charge < 0 || m.charge > 1) return fail('invalid_action');
  if (state.tick - (p.attackTick ?? -1000) < STORMREEL.cooldownTicks) return fail('cooldown');
  p.attackTick = state.tick;
  const charge = Math.max(STORMREEL.minCharge, m.charge), cost = Math.max(1, Math.round(STORMREEL.shotCost * charge));
  const live = b.charge >= cost; if (live) b.charge -= cost;
  const height = (x, z) => ctx.terrainHeight(state, x, z);
  const dir = m.direction, side = p.side || 'party';
  const enemy = rayEnemy(state, m.origin, dir, STORMREEL.range, side), ground = rayGround(height, m.origin, dir, STORMREEL.range);
  const wall = rayWorld(state, height, m.origin, dir, Math.min(STORMREEL.range, enemy?.t ?? Infinity, ground?.t ?? Infinity), b.id);
  const hitEnemy = !wall && enemy && (!ground || enemy.t <= ground.t + .3) ? enemy : null;
  const wet = raining(state), events = [];
  const point = wall ? wall.point : hitEnemy ? hitEnemy.point : ground ? ground.point : m.origin.map((v, i) => v + dir[i] * STORMREEL.range);
  let earth = null, grounded = false, splash = [];
  if (hitEnemy) {
    const e = hitEnemy.enemy, floor = height(e.position[0], e.position[2]);
    grounded = e.position[1] - floor <= STORMREEL.arcGap;
    earth = [e.position[0], floor, e.position[2]];
    const shock = live ? (grounded ? STORMREEL.shock * (wet ? STORMREEL.wet : 1) : STORMREEL.airStatic) * charge : 0;
    const amount = Math.round(STORMREEL.bolt * (.4 + .6 * charge) + shock);
    ctx.hitEnemyPart(state, e, hitEnemy.part, amount, {point: [...point], normal: dir.map(v => -v), ownerId: p.id, side, tool: 'stormreel', energy: 1.6, shock: live && grounded}, ctx, events);
  } else if (wall) { earth = [point[0], height(point[0], point[2]), point[2]]; grounded = true; }   // the current runs down the wall into the soil
  else if (ground) { earth = [...ground.point]; grounded = true; }
  // Step voltage: current spreading from the earth point jolts grounded neighbours.
  if (live && grounded && earth) {
    const k = (hitEnemy ? 1 : STORMREEL.groundStrike) * charge * (wet ? STORMREEL.wet : 1);
    for (const e of [...state.enemies]) {
      if (e === hitEnemy?.enemy || e.hp <= 0 || !enemyHostileTo(e, side)) continue;
      if (Math.hypot(e.position[0] - earth[0], e.position[2] - earth[2]) > STORMREEL.stepRadius) continue;
      if (e.position[1] - height(e.position[0], e.position[2]) > .6) continue;
      splash.push(e.id);
      ctx.hitEnemyPart(state, e, 'torso', Math.round(STORMREEL.stepDamage * k), {point: partPosition(e, 'torso'), normal: [0, 1, 0], ownerId: p.id, side, tool: 'stormreel', energy: 1}, ctx, events);
    }
  }
  events.unshift({kind: 'storm_bolt', by: p.id, structureId: b.id, origin: [...m.origin], position: [...point], ...(earth ? {earth} : {}),
    ...(hitEnemy ? {targetId: hitEnemy.enemy.id, part: hitEnemy.part} : {}), ...(wall ? {blocked: wall.kind, blockedId: wall.id} : {}), live, grounded, wet, charge: Math.round(charge * 100) / 100, splash, towerCharge: b.charge});
  return {ok: true, events};
}
