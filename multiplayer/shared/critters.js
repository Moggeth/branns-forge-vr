// Characterful foes beyond skeletons, golems and ents (shared, deterministic: no clock, no RNG, no Three.js).
//
//   Kettlebelly  a runaway dwarven boiler on piston legs. It waddles up and belches a cone of scalding steam.
//                Puncture it (below 45% health) and it jets about on its own leak, then bursts in rivets and copper.
//   Bramblehog   a thorny hedge-boar. It curls into a ball and bowls straight at a Hero, flattening and tossing anything
//                in its lane (skeletons included), and is dizzy and soft for a few seconds after it stops.
//   Kegtoter     a mole sapper tottering under a lit powder keg. It plants the keg against a building (or a Hero) and
//                covers its ears. A hit on the keg, any fire, or the mole dying sets it off early: a chain of kegs is a
//                chain of booms. A mole that survives its own blast cheers and digs away.
//
// Every critter is one rigid body for combat (like a stumpling): `torso` is the body, `head` is the keg on a Kegtoter.
// Spawning is open to any mode: createCritter(id, position, kind) gives a ready enemy; placement belongs to the caller.
import {clampToWorld} from './keep-sites.js';

export const CRITTER_KINDS = Object.freeze(['kettlebelly', 'bramblehog', 'kegtoter']);
/** The God's Rabble summon: which critter answers is fixed by the cast id, so every peer agrees. */
export const rabbleKind = id => CRITTER_KINDS[Math.min(CRITTER_KINDS.length - 1, Math.floor(hash(id, 'rabble') * CRITTER_KINDS.length))];
export const isCritter = kind => CRITTER_KINDS.includes(kind);

export const CRITTER = Object.freeze({
  kettlebelly: Object.freeze({hp: 150, radius: .46, height: 1.3, reach: .85, speed: 1.35, material: 'metal', xp: 30,
    ventRange: 3.3, ventEvery: 150, ventStrike: 36, ventTicks: 80, ventAngle: .62, ventHero: 16, ventFoe: 12,
    leakAt: .45, leakTicks: 150, leakSpeed: 4.2, leakSpin: .085, leakTouch: 8,
    burstRadius: 3.2, burstHero: 20, burstFoe: 36, loot: [['iron', 2], ['copperOre', 1]]}),
  bramblehog: Object.freeze({hp: 120, radius: .5, height: .95, reach: .9, speed: 2.0, material: 'wood', xp: 25,
    rollMin: 3.5, rollMax: 13, rollEvery: 240, curlTicks: 30, rollTicks: 110, rollSpeed: 7.5, rollHero: 18, rollFoe: 30,
    dizzyTicks: 150, curledResist: .35, dizzyBonus: 1.6, nip: 8, nipEvery: 70, loot: [['wood', 2]]}),
  kegtoter: Object.freeze({hp: 60, radius: .36, height: 1.15, reach: .7, speed: 1.6, material: 'flesh', xp: 18,
    plantRange: 1.7, plantBuilding: 3, fuseTicks: 150, blastRadius: 4, blastHero: 30, blastFoe: 45, blastBuilding: 60,
    cheerTicks: 90, burrowTicks: 75, fleeSpeed: 2.6, loot: [['copper', 1]]}),
});
export const critterSpec = e => CRITTER[e?.kind] || null;

const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
function hash(...parts) {
  let h = 2166136261;
  for (const p of parts) for (const c of String(p)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
const PARTS = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];

export function critterParts(kind) { const s = CRITTER[kind]; return Object.fromEntries(PARTS.map(p => [p, s.hp])); }
export function createCritter(id, position, kind) {
  const s = CRITTER[kind];
  return {id, position: [...position], kind, yaw: wrap(hash(id, 'yaw') * Math.PI * 2), hp: s.hp, parts: critterParts(kind), missingParts: [], attackTick: -1000};
}
/** Centre of the one rigid body (and a Kegtoter's keg riding above its head, or planted in front of it). */
export function critterPartPosition(e, part) {
  const s = CRITTER[e.kind];
  if (e.kind === 'kegtoter' && part === 'head') {
    if (e.kegAt) return [e.kegAt[0], e.kegAt[1] + .32, e.kegAt[2]];
    return [e.position[0], e.position[1] + s.height + .1, e.position[2]];
  }
  const curled = e.kind === 'bramblehog' && bramblePhase(e, e.lastTick ?? 0) !== 'trot';
  return [e.position[0], e.position[1] + s.height * (curled ? .42 : .5), e.position[2]];
}
export function critterValidHit(e, part, point) {
  if (e.kind === 'kegtoter' && part === 'head') return Math.hypot(...[0, 1, 2].map(i => point[i] - critterPartPosition(e, 'head')[i])) <= .7;
  const c = critterPartPosition(e, 'torso'), s = CRITTER[e.kind];
  return Math.hypot(point[0] - c[0], point[1] - c[1], point[2] - c[2]) <= Math.max(s.height, s.radius * 2) * .75 + .15;
}
export const critterMaterial = (e, part) => e.kind === 'kettlebelly' ? 'metal' : e.kind === 'bramblehog' ? 'wood' : part === 'head' ? 'wood' : 'flesh';

// ---- phases (pure functions of saved ticks) ----
export function kettlePhase(e, tick) {
  if (e.leakTick !== undefined) return 'leak';
  const a = tick - (e.ventTick ?? -1e9);
  return a >= 0 && a < CRITTER.kettlebelly.ventTicks ? (a < CRITTER.kettlebelly.ventStrike ? 'build' : 'vent') : 'walk';
}
export function bramblePhase(e, tick) {
  const s = CRITTER.bramblehog, a = tick - (e.curlTick ?? -1e9);
  if (e.dizzyTick !== undefined && tick - e.dizzyTick < s.dizzyTicks) return 'dizzy';
  if (a >= 0 && a < s.curlTicks) return 'curl';
  if (a >= s.curlTicks && a < s.curlTicks + s.rollTicks && e.dizzyTick === undefined) return 'roll';
  return 'trot';
}
export function kegPhase(e, tick) {
  const s = CRITTER.kegtoter;
  if (e.blastTick !== undefined) return tick - e.blastTick < s.cheerTicks ? 'cheer' : 'burrow';
  if (e.plantTick !== undefined) return 'fuse';
  return 'carry';
}

/** Damage scaling before it lands (spines turn blows while curled; a dizzy hog is soft). */
export function critterDamageScale(e, tick) {
  if (e.kind !== 'bramblehog') return 1;
  const p = bramblePhase(e, tick), s = CRITTER.bramblehog;
  return p === 'curl' || p === 'roll' ? s.curledResist : p === 'dizzy' ? s.dizzyBonus : 1;
}

/** After a hit lands (combat.js): a punctured kettle starts to leak; a struck keg goes off. */
export function critterAfterHit(state, e, part, hit, ctx, events) {
  if (e.kind === 'kettlebelly' && e.hp > 0 && e.leakTick === undefined && e.hp <= CRITTER.kettlebelly.hp * CRITTER.kettlebelly.leakAt) {
    e.leakTick = state.tick; e.leakSpin = hash(e.id, state.tick) < .5 ? -1 : 1; if (hit?.ownerId) e.leakBy = hit.ownerId;
    events.push({kind: 'kettle_leak', id: e.id, position: [...e.position], tick: state.tick});
  }
  if (e.kind === 'kegtoter' && part === 'head' && e.hp > 0 && e.blastTick === undefined) {
    e.hp = 0; // the keg goes up with the mole beside it
  }
}

/** Death (combat.js): the kettle bursts, the keg blows (unless it already has), loot drops. ctx needs hitEnemyPart. */
export function critterDeath(state, e, hit, ctx, events, owner) {
  const s = CRITTER[e.kind];
  if (e.kind === 'kettlebelly') blast(state, e.position, s.burstRadius, s.burstHero, s.burstFoe, 0, e, owner?.id ?? e.leakBy, ctx, events, 'kettle');
  if (e.kind === 'kegtoter' && e.blastTick === undefined) blast(state, e.kegAt || e.position, CRITTER.kegtoter.blastRadius, s.blastHero, s.blastFoe, s.blastBuilding, e, owner?.id, ctx, events, 'keg');
  if (e.battleRun !== undefined) return;
  const [x, , z] = e.position;
  s.loot.forEach(([kind, amount], i) => {
    if (state.pickups.length >= 256) return;
    const a = e.yaw + i * 2.1, [px, pz] = clampToWorld(x + Math.sin(a) * .5, z + Math.cos(a) * .5, 54.5);
    state.pickups.push({id: ctx.nextId(state, 'p'), kind, amount, x: px, z: pz, y: ctx.terrainHeight(state, px, pz)});
  });
  events.push({kind: 'salvage', id: e.id, resource: s.loot[0][0], amount: s.loot[0][1], position: [...e.position]});
}

// A blast: heroes, other creatures and (for kegs) buildings in range take falling-off damage. Creatures it kills can
// blast in turn (a row of kegs goes up one after another). The source is excluded.
function blast(state, at, radius, hero, foe, building, source, ownerId, ctx, events, style) {
  const center = [at[0], at[1], at[2]];
  events.push({kind: 'critter_blast', id: source.id, style, position: center, radius, tick: state.tick});
  const fall = d => 1 - .5 * clamp(d / radius, 0, 1);
  for (const p of state.players) {
    if (p.role !== 'hero' || p.hp <= 0) continue;
    const d = Math.hypot(p.position[0] - at[0], p.position[1] + .9 - at[1] - .5, p.position[2] - at[2]);
    if (d < radius) ctx.damageHero?.(state, p, hero * fall(d), events, center);
  }
  for (const other of [...state.enemies]) {
    if (other === source || other.hp <= 0 || !state.enemies.includes(other)) continue;
    const d = flat(other.position, at); if (d >= radius) continue;
    const normal = d > 1e-3 ? [(other.position[0] - at[0]) / d, 0, (other.position[2] - at[2]) / d] : [0, 1, 0];
    const keg = other.kind === 'kegtoter' && other.blastTick === undefined; // another keg in the blast goes up too
    ctx.hitEnemyPart?.(state, other, 'torso', keg ? other.hp + 1 : foe * fall(d), {...(ownerId ? {ownerId} : {}), point: [other.position[0], other.position[1] + 1, other.position[2]], normal, energy: 1.8, blast: true}, ctx, events);
    if (state.enemies.includes(other) && other.kind !== 'ent' && other.launchTick === undefined && d < radius * .7 && !isCritter(other.kind)) other.launchTick = state.tick; // tossed
  }
  if (building) for (const b of state.inventions?.structures || []) if (b.hp > 0 && b.type !== 'forge' && flat(b.position, at) < radius + 1.5) ctx.damageStructure?.(state, b.id, building, events);
}

// ---- movement helpers ----
function steer(e, dx, dz, speed, {ground, resolve}, s, turn = .14) {
  const len = Math.hypot(dx, dz); if (len < 1e-6 || speed <= 0) return false;
  dx /= len; dz /= len;
  e.yaw = wrap(e.yaw + clamp(wrap(Math.atan2(-dx, -dz) - e.yaw), -turn, turn));
  const facing = -Math.sin(e.yaw) * dx - Math.cos(e.yaw) * dz, pace = speed / 60 * clamp(.5 + .5 * facing, .35, 1);
  for (const angle of [0, .6, -.6, 1.2, -1.2]) {
    const c = Math.cos(angle), sn = Math.sin(angle), x = dx * c - dz * sn, z = dx * sn + dz * c;
    const [px, pz] = clampToWorld(e.position[0] + x * .6, e.position[2] + z * .6), probe = [px, e.position[1], pz], before = [...probe];
    resolve(probe, s.radius, s.height);
    if (flat(probe, before) > .025 || Math.abs(ground(probe[0], probe[2]) - e.position[1]) > .7) continue;
    [e.position[0], e.position[2]] = clampToWorld(e.position[0] + x * pace, e.position[2] + z * pace);
    return true;
  }
  return false;
}
function settle(e, {ground, resolve}, s) { resolve(e.position, s.radius, s.height); e.position[1] = ground(e.position[0], e.position[2]); }
function facingTo(e, p) { const d = flat(e.position, p) || 1; return (-Math.sin(e.yaw) * (p[0] - e.position[0]) - Math.cos(e.yaw) * (p[2] - e.position[2])) / d; }
function nearest(e, list) { let best = null, d = Infinity; for (const t of list) { const q = flat(e.position, t.position); if (q < d) { d = q; best = t; } } return [best, d]; }

/**
 * One tick for a critter inside stepEnemies. ctx: {heroes, foes (creatures it may hurt), buildings, ground, resolve,
 * damageHero(state, hero, n, events, from), damageEnemy(enemy, n, events, side, ownerId), damageStructure(id, n, events), events}.
 */
export function stepCritter(state, e, ctx) {
  e.lastTick = state.tick;
  if (e.kind === 'kettlebelly') return stepKettle(state, e, ctx);
  if (e.kind === 'bramblehog') return stepBramble(state, e, ctx);
  if (e.kind === 'kegtoter') return stepKeg(state, e, ctx);
}

function stepKettle(state, e, ctx) {
  const s = CRITTER.kettlebelly, t = state.tick, {events} = ctx;
  if (e.leakTick !== undefined) {
    // Jet-propelled by its own leak: spinning, skidding, bouncing off walls; then it bursts.
    const a = t - e.leakTick;
    if (a >= s.leakTicks) { ctx.damageEnemy(e, e.hp + 1, events, undefined, e.leakBy); if (state.enemies.includes(e)) ctx.damageEnemy(e, e.hp + 1, events); return; }
    e.yaw = wrap(e.yaw + s.leakSpin * (e.leakSpin || 1) * (1 + a / s.leakTicks));
    const dx = -Math.sin(e.yaw + 1.9 * (e.leakSpin || 1)), dz = -Math.cos(e.yaw + 1.9 * (e.leakSpin || 1)), before = [...e.position];
    const [px, pz] = clampToWorld(e.position[0] + dx * s.leakSpeed / 60, e.position[2] + dz * s.leakSpeed / 60);
    e.position[0] = px; e.position[2] = pz; settle(e, ctx, s);
    if (flat(e.position, before) < s.leakSpeed / 60 * .4) e.leakSpin = -(e.leakSpin || 1); // ricochet off whatever stopped it
    if (a % 30 === 0) for (const h of ctx.heroes) if (flat(h.position, e.position) < s.radius + .55) ctx.damageHero(state, h, s.leakTouch, events, e.position);
    return;
  }
  const [target, d] = nearest(e, ctx.heroes), age = t - (e.ventTick ?? -1e9);
  if (age >= 0 && age < s.ventTicks) {
    if (age === s.ventStrike) { // the cone of steam
      events.push({kind: 'kettle_vent', id: e.id, position: [...e.position], yaw: e.yaw, tick: t});
      const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
      const inCone = p => { const dx = p[0] - e.position[0], dz = p[2] - e.position[2], q = Math.hypot(dx, dz); return q < s.ventRange + .4 && (q < .6 || (dx * fx + dz * fz) / q > Math.cos(s.ventAngle)); };
      for (const h of ctx.heroes) if (inCone(h.position)) ctx.damageHero(state, h, s.ventHero, events, e.position);
      for (const f of ctx.foes) if (f !== e && f.hp > 0 && !isCritter(f.kind) && inCone(f.position)) ctx.damageEnemy(f, s.ventFoe, events);
    }
    settle(e, ctx, s); return;
  }
  if (!target) { settle(e, ctx, s); return; }
  if (d > s.ventRange * .8) steer(e, target.position[0] - e.position[0], target.position[2] - e.position[2], s.speed, ctx, s, .09);
  else steer(e, target.position[0] - e.position[0], target.position[2] - e.position[2], 0.0001, ctx, s, .09);
  settle(e, ctx, s);
  if (d < s.ventRange && facingTo(e, target.position) > .75 && t - (e.ventTick ?? -1e9) > s.ventEvery && (e.hurtTick ?? -1e9) < t - 20) {
    e.ventTick = t; events.push({kind: 'kettle_build', id: e.id, position: [...e.position], tick: t});
  }
}

function stepBramble(state, e, ctx) {
  const s = CRITTER.bramblehog, t = state.tick, {events} = ctx, phase = bramblePhase(e, t);
  if (phase === 'dizzy') { settle(e, ctx, s); return; }
  if (e.dizzyTick !== undefined && t - e.dizzyTick >= s.dizzyTicks) delete e.dizzyTick;
  if (phase === 'curl') { settle(e, ctx, s); return; }
  if (phase === 'roll') {
    const fx = -Math.sin(e.rollYaw), fz = -Math.cos(e.rollYaw), step = s.rollSpeed / 60;
    const [px, pz] = clampToWorld(e.position[0] + fx * step, e.position[2] + fz * step), probe = [px, e.position[1], pz], before = [...probe];
    ctx.resolve(probe, s.radius, s.height);
    const clipped = Math.hypot(px - e.position[0] - fx * step, pz - e.position[2] - fz * step) > 1e-6; // ran into the world's edge
    const stopped = clipped || flat(probe, before) > .05 || Math.abs(ctx.ground(probe[0], probe[2]) - e.position[1]) > .9;
    if (!stopped) { e.position[0] = probe[0]; e.position[2] = probe[2]; }
    e.yaw = e.rollYaw; settle(e, ctx, s);
    e.rollHits ||= [];
    for (const h of ctx.heroes) if (!e.rollHits.includes(h.id) && flat(h.position, e.position) < s.radius + .5) { e.rollHits.push(h.id); ctx.damageHero(state, h, s.rollHero, events, e.position); }
    for (const f of ctx.foes) {
      if (f === e || f.hp <= 0 || e.rollHits.includes(f.id) || e.rollHits.length >= 12 || flat(f.position, e.position) > s.radius + (f.kind === 'golem' ? .8 : .45)) continue;
      e.rollHits.push(f.id); events.push({kind: 'bramble_bowl', id: e.id, target: f.id, position: [...f.position]});
      ctx.damageEnemy(f, s.rollFoe, events);
      if (state.enemies.includes(f) && f.kind === 'skeleton' && f.launchTick === undefined) f.launchTick = t; // skittles
    }
    if (stopped || t - e.curlTick === s.curlTicks + s.rollTicks - 1) {
      e.dizzyTick = t; delete e.rollHits;
      events.push({kind: 'bramble_stop', id: e.id, position: [...e.position], crash: stopped, tick: t});
    }
    return;
  }
  // Trot: snuffle toward the nearest Hero; nip when close; curl and roll from a run-up distance.
  const [target, d] = nearest(e, ctx.heroes);
  if (!target) { settle(e, ctx, s); return; }
  const dx = target.position[0] - e.position[0], dz = target.position[2] - e.position[2];
  if (d > 1.3) steer(e, dx, dz, s.speed, ctx, s, .16);
  else steer(e, dx, dz, .0001, ctx, s, .16);
  settle(e, ctx, s);
  const facing = facingTo(e, target.position);
  if (d >= s.rollMin && d <= s.rollMax && facing > .85 && t - (e.curlTick ?? -1e9) > s.rollEvery && (e.hurtTick ?? -1e9) < t - 20) {
    e.curlTick = t; e.rollYaw = wrap(Math.atan2(-dx, -dz) + (hash(e.id, t) - .5) * .12);
    events.push({kind: 'bramble_curl', id: e.id, position: [...e.position], tick: t});
  } else if (d < s.radius + 1.1 && facing > .6 && t - e.attackTick > s.nipEvery) {
    e.attackTick = t; ctx.damageHero(state, target, s.nip, events, e.position);
    events.push({kind: 'bramble_nip', id: e.id, position: [...e.position]});
  }
}

function stepKeg(state, e, ctx) {
  const s = CRITTER.kegtoter, t = state.tick, {events} = ctx, phase = kegPhase(e, t);
  if (phase === 'cheer') { settle(e, ctx, s); return; }
  if (phase === 'burrow') {
    if (t - e.blastTick - s.cheerTicks >= s.burrowTicks) {
      state.enemies.splice(state.enemies.indexOf(e), 1);
      state.embeds = (state.embeds || []).filter(m => m.targetId !== e.id);
      events.push({kind: 'keg_gone', id: e.id, position: [...e.position]});
    } else settle(e, ctx, s);
    return;
  }
  // Fire anywhere on it (Wyrmspout, Emberdew, a burning tree): the fuse is irrelevant now.
  if ((e.burnUntil ?? 0) > t) { ctx.damageEnemy(e, e.hp + 1, events); return; }
  if (phase === 'fuse') {
    if (t - e.plantTick >= s.fuseTicks) {
      e.blastTick = t; const at = e.kegAt; delete e.kegAt;
      blast(state, at, s.blastRadius, s.blastHero, s.blastFoe, s.blastBuilding, e, undefined, {...ctx, damageStructure: (st, id, n, ev) => ctx.damageStructure(id, n, ev), hitEnemyPart: (st, f, part, n, hit, c, ev) => ctx.damageEnemy(f, n, ev)}, events, 'keg');
      // Blown back by its own keg: singed, alive and delighted.
      const away = [e.position[0] - at[0], e.position[2] - at[2]], d = Math.hypot(...away) || 1;
      [e.position[0], e.position[2]] = clampToWorld(e.position[0] + away[0] / d * 1.2, e.position[2] + away[1] / d * 1.2);
      e.launchTick = t; settle(e, ctx, s);
    } else settle(e, ctx, s);
    return;
  }
  // Carry: buildings first (it is a sapper), then the nearest Hero.
  const [b, bd] = nearest(e, ctx.buildings), [h, hd] = nearest(e, ctx.heroes);
  const target = b && bd < 26 ? b : h, d = target === b ? bd : hd, reach = target === b ? s.plantBuilding : s.plantRange;
  if (!target) { settle(e, ctx, s); return; }
  const dx = target.position[0] - e.position[0], dz = target.position[2] - e.position[2];
  if (d > reach) steer(e, dx, dz, s.speed * (1 - .25 * Math.abs(Math.sin(t / 23))), ctx, s, .12); // the keg sways its pace
  settle(e, ctx, s);
  if (d <= reach + .2) {
    e.plantTick = t; const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
    const [kx, kz] = clampToWorld(e.position[0] + fx * .55, e.position[2] + fz * .55); e.kegAt = [kx, ctx.ground(kx, kz), kz];
    events.push({kind: 'keg_plant', id: e.id, position: [...e.kegAt], tick: t});
  }
}

/** Save validation for critter-only fields (combat/simulation validators call this). */
export function validCritter(e, tick) {
  if (!isCritter(e.kind)) return ['ventTick', 'leakTick', 'leakSpin', 'leakBy', 'curlTick', 'rollYaw', 'dizzyTick', 'rollHits', 'plantTick', 'kegAt', 'blastTick', 'lastTick'].every(k => e[k] === undefined);
  const tk = v => v === undefined || Number.isSafeInteger(v) && v >= -1e9 && v <= tick;
  if (![e.ventTick, e.leakTick, e.curlTick, e.dizzyTick, e.plantTick, e.blastTick, e.lastTick].every(tk)) return false;
  if (e.leakSpin !== undefined && e.leakSpin !== 1 && e.leakSpin !== -1) return false;
  if (e.leakBy !== undefined && (typeof e.leakBy !== 'string' || e.leakBy.length > 64)) return false;
  if (e.rollYaw !== undefined && !Number.isFinite(e.rollYaw)) return false;
  if (e.rollHits !== undefined && (!Array.isArray(e.rollHits) || e.rollHits.length > 16 || !e.rollHits.every(q => typeof q === 'string' && q.length <= 64))) return false;
  if (e.kegAt !== undefined && (!Array.isArray(e.kegAt) || e.kegAt.length !== 3 || !e.kegAt.every(Number.isFinite))) return false;
  return true;
}
export const CRITTER_FIELDS = Object.freeze(['ventTick', 'leakTick', 'leakSpin', 'leakBy', 'curlTick', 'rollYaw', 'dizzyTick', 'rollHits', 'plantTick', 'kegAt', 'blastTick', 'lastTick']);
