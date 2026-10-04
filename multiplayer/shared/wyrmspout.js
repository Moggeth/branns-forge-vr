// Wyrmspout: a short, high-volume burst of sticky liquid fire from a tank that refills while it rests.
// One table drives the authority (combat.js, fire.js) and the presentation (client/wyrmspout-*.js), so the
// stream the player sees lands where the fire lands.
//
// Tank: player.heat is the fraction of the tank used (0 full .. 1 empty). Holding Attack sprays one
// authoritative glob every few ticks; each glob costs 1/globs of the tank. An emptied tank locks
// (player.overheatUntil) while it refills; letting go early starts refilling after a short pause.
// Both fields predate the tank (they were heat and overheat), so saves stay compatible.
//
// Specialties (hero talents, shared/hero-progress.js):
//   flood: the burst lasts longer, throws more globs and reaches further.
//   cling: globs stuck to a foe burn twice as long; a clinging foe that dies splashes sticky fire on its neighbours.
import {addFuel,applyHeat} from './fire.js';
import {applyEnemyScorch,partPosition} from './combat.js';
import {hasTalent} from './hero-progress.js';

export const WYRMSPOUT = Object.freeze({
  burstTicks: 105,        // a full tank sprays for 1.75 s
  globs: 21,              // authoritative globs in a full tank (one every 5 ticks, 12 per second)
  acceptTicks: 4,         // fastest the host accepts globs from one player (client jitter allowance)
  refillTicks: 180,       // an emptied tank locks and refills over 3 s
  refillDelay: 24,        // after letting go early, refilling starts .4 s later...
  refillRate: 1 / 150,    // ...and fills at this fraction of the tank per tick (2.5 s from empty)
  speed: 15, gravity: 9, lifeTicks: 66, spread: .035,
  damage: 5, burnTicks: 120, scorch: .05, maxGoo: 6, gooDamage: 1,
  groundFuel: Object.freeze({radius: .6, amount: .24}),
  surfaceTicks: 210,
  gout: Object.freeze({cooldown: 360, cost: .35, speed: 11.5, loft: 2.2, lifeTicks: 130, radius: 2.4, fuelRadius: 2.1, fuel: .75, damage: 22, burn: 180, goo: 3}),
  flood: Object.freeze({duration: 1.5, volume: 1.3, reach: 1.3}),
  cling: Object.freeze({burn: 2, splashRadius: 2.5, splashFuel: .5}),
});

export {hasTalent};

/** Per-player spray tuning: the base table with the player's specialties applied. */
export function sprayTuning(p) {
  const W = WYRMSPOUT, flood = hasTalent(p, 'wyrmspout', 'flood'), cling = hasTalent(p, 'wyrmspout', 'cling');
  const burstTicks = Math.round(W.burstTicks * (flood ? W.flood.duration : 1)), globs = Math.round(W.globs * (flood ? W.flood.volume : 1));
  const reach = flood ? W.flood.reach : 1;
  return {flood, cling, burstTicks, globs, cost: 1 / globs, intervalMs: burstTicks / globs / 60 * 1000,
    speed: W.speed * Math.sqrt(reach), lifeTicks: Math.round(W.lifeTicks * reach), gravity: W.gravity,
    burnTicks: Math.min(240, W.burnTicks * (cling ? W.cling.burn : 1))};
}

/** Tank fill for display: 1 full .. 0 empty. */
export const tankFill = p => 1 - Math.max(0, Math.min(1, p?.heat || 0));

/** Per-tick tank bookkeeping (called from stepFire). */
export function stepTank(state, player) {
  if ((player.overheatUntil || 0) > state.tick) { player.heat = 1; return; }
  if (player.overheatUntil) { player.overheatUntil = 0; player.heat = 0; return; }
  if (state.tick - (player.flameTick ?? -1000) > WYRMSPOUT.refillDelay) player.heat = Math.max(0, (player.heat || 0) - WYRMSPOUT.refillRate);
}

/** Spend one glob of the tank; returns false when the tank is locked. */
export function spendGlob(state, p, cost) {
  if ((p.overheatUntil || 0) > state.tick) return false;
  p.flameTick = state.tick; p.heat = Math.min(1, (p.heat || 0) + cost);
  if (p.heat >= .999) { p.heat = 1; p.overheatUntil = state.tick + WYRMSPOUT.refillTicks; }
  return true;
}

/** A glob sticks to a foe: it keeps burning, and stacks a little extra burn per glob. */
export function stickGlob(state, enemy, part, ownerId, burnTicks) {
  enemy.burnUntil = Math.max(enemy.burnUntil || 0, Math.min(state.tick + 240, state.tick + burnTicks));
  enemy.burnPart = part || enemy.burnPart || 'torso';
  enemy.goo = Math.min(WYRMSPOUT.maxGoo, (enemy.goo || 0) + 1);
  enemy.gooBy = ownerId;
  const owner = state.players.find(p => p.id === ownerId);
  if (hasTalent(owner, 'wyrmspout', 'cling')) enemy.cling = true; else delete enemy.cling;
}

/** Gout (special): a lobbed ball of sticky fire bursts into a wide burning splash. */
export function goutBurst(state, shot, point, ctx, events) {
  const G = WYRMSPOUT.gout, ground = ctx.terrainHeight(state, point[0], point[2]), floor = [point[0], ground, point[2]];
  const tuning = sprayTuning(state.players.find(p => p.id === shot.ownerId));
  if (point[1] - ground < 3) { addFuel(state, floor, G.fuelRadius, G.fuel, true); applyHeat(state, floor, G.radius, 1, ctx); }
  for (const e of [...state.enemies]) {
    const torso = partPosition(e, 'torso'), d = Math.hypot(torso[0] - point[0], torso[1] - point[1], torso[2] - point[2]);
    if (d > G.radius) continue;
    stickGlob(state, e, 'torso', shot.ownerId, Math.max(G.burn, tuning.burnTicks)); e.goo = Math.min(WYRMSPOUT.maxGoo, (e.goo || 0) + G.goo - 1);
    applyEnemyScorch(e, 'torso', .2);
    ctx.damageEnemy(state, e, Math.round(G.damage * (1 - .5 * d / G.radius)), events, shot.ownerId);
  }
  events.push({kind: 'gout_burst', id: shot.id, by: shot.ownerId, position: [...point], ground: floor, radius: G.radius});
}

/** Clinging Fire: a foe dying with clinging fire on it bursts and splashes its neighbours. */
export function clingSplash(state, enemy, ctx, events) {
  if (!enemy.cling || !((enemy.burnUntil || 0) > state.tick) || !ctx?.terrainHeight) return;
  const C = WYRMSPOUT.cling, at = partPosition(enemy, 'torso'), ground = ctx.terrainHeight(state, at[0], at[2]);
  addFuel(state, [at[0], ground, at[2]], 1.2, C.splashFuel, true);
  const burn = sprayTuning(state.players.find(p => p.id === enemy.gooBy)).burnTicks;
  for (const e of state.enemies) {
    if (e === enemy || e.hp <= 0) continue;
    const t = partPosition(e, 'torso');
    if (Math.hypot(t[0] - at[0], t[1] - at[1], t[2] - at[2]) > C.splashRadius) continue;
    stickGlob(state, e, 'torso', enemy.gooBy, burn); e.splashedTick = state.tick;
  }
  events.push({kind: 'cling_splash', id: enemy.id, by: enemy.gooBy, position: at, radius: C.splashRadius});
}
