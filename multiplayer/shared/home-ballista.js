// Keep ballistas (battle v2). Each home base has two gate ballistas in its own style:
//  - Dawnhold's Timberlines: the Hero's twin-bolt Timberline, mounted at the gate. Manned it is exactly the built one
//    (click fires the long wired pair, R winds, the brass ladder sights) but needs no Wood or Iron; the pair is a real
//    inventions shot (shared/inventions.js launchKeepTimberline), so it shears trees, sticks and tethers like any other,
//    and here it also cuts rival Heroes. Unmanned it tracks and fires on its own, winding more slowly.
//  - The Sunlance (hold to draw, release on the golden beat for a Dawnbreak) is Dawnhold's former pair; its rules stay
//    here so the style can come back by changing KEEP_STYLES.
//  - Grumblekeep's Gnashjaw: a big skull spits a chained harpoon. A hooked foe is held and slowed; winding the crank
//    reels them in, a click yanks them, and anything dragged up to the jaw gets chomped.
// A Hero of the base's own side mans one with Use. The wire actions are the Timberline ones (inventionMount / Steer /
// Draw / Use / Crank with the part id), so the client reuses its manning controls. Unmanned ballistas track and fire
// on their own. Shots are real ballistic flights stepped on the authority tick; the client draws the same curve every
// frame from the launch event. Pure simulation rules: fixed ticks, no clocks or randomness.
import {HOME, HOME_MANNED, baseFallen, damageHome, findHomeTarget, homeBattle, homeFrame, shieldUp} from './home-bases.js';
import {worldColliders, insideVolume} from './colliders.js';
import {hasItem} from './hero-items.js';
import {MANNED, mannedShot, launchKeepTimberline} from './inventions.js';
import {timberlineLaunch} from './timberline-flight.js';
import {TIMBERLINE_FLIGHT} from '../assets-source/timberline-twinbolt-20261003/runtime/timberline-flight.js';
export {HOME_MANNED};

export const KEEP_BALLISTA = Object.freeze({
  gravity: 9.8, steps: 6, maxTicks: 240,
  turn: 1.6,  // rad/s an unmanned ballista slews while tracking
  sunlance: Object.freeze({drawTicks: 66, perfectTicks: 20, speed: Object.freeze([44, 80]), damage: Object.freeze([50, 120]), hero: Object.freeze([20, 48]),
    perfectDamage: 150, perfectHero: 60, pierce: 4, burst: 2.4, burstDamage: 40, burstHero: 16, autoCharge: .55,
    trunnion: 1.52, ahead: 1.27, above: .13}),
  gnashjaw: Object.freeze({speed: 54, damage: 40, hero: 18, chain: 36, hookTicks: 9 * 60, reel: 6.5, reelAuto: 3.2, reelGolem: 1.8,
    yank: 2.4, yankEvery: 24, yankDamage: 8, chomp: 3.6, chompDamage: 120, chompHero: 50, retractTicks: 60,
    trunnion: 1.46, ahead: 1.9, above: -.16}),
  // Reload and crank numbers are the built Timberline's (inventions.js MANNED); unmanned it winds half again slower.
  timberline: Object.freeze({unmannedReload: 360, hero: 45}),
});
export const KEEP_STYLES = Object.freeze({party: 'timberline', rivals: 'gnashjaw'});
export const keepStyle = side => KEEP_STYLES[side === 'rivals' ? 'rivals' : 'party'];
const isTimberline = part => keepStyle(part.side) === 'timberline';
// Crew numbers (seat, reload, winding boosts): a keep Timberline handles exactly like a built one.
const crewOf = part => isTimberline(part) ? MANNED : HOME_MANNED;
const spec = part => KEEP_BALLISTA[keepStyle(part.side)];

const ID = /^battle-base-(party|rivals)-ballista-[01]$/;
export const isHomeBallistaId = id => typeof id === 'string' && ID.test(id);
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const round = v => Math.round(v * 1e4) / 1e4;
const fail = code => ({ok: false, code, events: []});
const ok = (events = []) => ({ok: true, events});

/** Rest heading in the Timberline convention (forward = (-sin W, -cos W)): straight out of the gate. */
export function homeBallistaYaw(side) { const f = homeFrame(side).forward; return Math.atan2(-f[0], -f[1]); }
/** Where the operator stands: behind the grips, swinging round with the aim. */
export function homeBallistaSeat(part, aimYaw = part.aimYaw || 0) {
  const y = homeBallistaYaw(part.side) + aimYaw, seat = crewOf(part).seat;
  return [part.position[0] + Math.sin(y) * seat, part.position[1], part.position[2] + Math.cos(y) * seat];
}
/** A keep Timberline's frame as a built one ({position, yaw}), so mannedShot() and the brass-ladder sight read it unchanged. */
export const keepTimberlineFrame = part => ({id: part.id, position: part.position, yaw: homeBallistaYaw(part.side)});
/** The muzzle (where shots leave) and unit forward for a ballista at this aim. Shared by authority and view. */
export function keepMuzzle(part, aimYaw = part.aimYaw || 0, aimPitch = part.aimPitch || 0) {
  if (isTimberline(part)) { const l = timberlineLaunch(mannedShot(keepTimberlineFrame(part), {yaw: aimYaw, pitch: aimPitch})); return {at: l.origin, forward: l.forward}; }
  const s = spec(part), y = homeBallistaYaw(part.side) + aimYaw, cp = Math.cos(aimPitch), sp = Math.sin(aimPitch);
  const f = [-Math.sin(y) * cp, sp, -Math.cos(y) * cp], u = [Math.sin(y) * sp, cp, Math.cos(y) * sp];
  return {at: [0, 1, 2].map(k => part.position[k] + (k === 1 ? s.trunnion : 0) + f[k] * s.ahead + u[k] * s.above), forward: f};
}
/** Launch speed for a Sunlance draw (0..1) or the Gnashjaw harpoon. */
export function keepSpeed(part, charge = 0, perfect = false) {
  if (isTimberline(part)) return TIMBERLINE_FLIGHT.speed;
  const s = spec(part);
  return keepStyle(part.side) === 'gnashjaw' ? s.speed : perfect ? s.speed[1] * 1.08 : lerp(s.speed[0], s.speed[1], clamp(charge, 0, 1));
}
/** A shot's position t seconds after launch (shot: {o, v}). */
export function keepShotAt(shot, t) {
  const g = KEEP_BALLISTA.gravity;
  return [shot.o[0] + shot.v[0] * t, shot.o[1] + shot.v[1] * t - g * t * t / 2, shot.o[2] + shot.v[2] * t];
}
/** Draw progress at a tick: {charge 0..1, perfect} for a Sunlance being drawn since drawTick. */
export function sunDraw(drawTick, tick) {
  if (drawTick === undefined || drawTick === null) return {charge: 0, perfect: false, held: 0};
  const S = KEEP_BALLISTA.sunlance, held = tick - drawTick;
  return {charge: clamp(held / S.drawTicks, 0, 1), perfect: held >= S.drawTicks && held < S.drawTicks + S.perfectTicks, held};
}

const seated = (part, p) => flat(p.position, homeBallistaSeat(part)) <= 1.5;
const operatorOf = (state, part) => part.operator ? state.players.find(p => p.id === part.operator && p.role === 'hero' && p.hp > 0 && (p.side || 'party') === part.side && seated(part, p)) : null;
const shotsOf = state => state.battle.keepShots || [];
// A keep Timberline's pair can fly on for seconds after a miss; only the harpoon on its chain holds the next shot.
const flying = (state, part) => !isTimberline(part) && shotsOf(state).some(s => s.part === part.id);

function setAim(state, p, part, aim, c) {
  if (!aim || !Number.isFinite(aim.yaw) || !Number.isFinite(aim.pitch)) return fail('invalid_target');
  part.aimYaw = wrap(aim.yaw); part.aimPitch = clamp(aim.pitch, HOME_MANNED.pitchMin, HOME_MANNED.pitchMax);
  const seat = homeBallistaSeat(part);
  p.position = [seat[0], c.terrainHeight(state, seat[0], seat[2]), seat[2]];
  return ok();
}

// The keep Timberline's pair joins the inventions shots: same flight, cuts, sticking and tethers as a built Timberline.
function launchTimberline(state, part, by) {
  const hat = !!by && hasItem(state.players.find(q => q.id === by), 'hat');
  const q = launchKeepTimberline(state, mannedShot(keepTimberlineFrame(part), {yaw: part.aimYaw || 0, pitch: part.aimPitch || 0}), {structureId: part.id, side: part.side, owner: by ?? null});
  if (!q) return null;
  q.heroDamage = KEEP_BALLISTA.timberline.hero;
  const reload = by ? MANNED.reloadTicks : KEEP_BALLISTA.timberline.unmannedReload;
  part.readyTick = state.tick + (hat ? reload / 2 : reload); part.fireTick = state.tick;
  return {kind: 'timberline_fire', id: part.id, structureId: part.id, part: part.id, side: part.side, position: [...part.position], origin: [...q.origin], target: [...q.target],
    material: 'wood', sourceMaterial: by ? 'weapon' : 'bone', by: by ?? null, manned: !!by, keep: true};
}

function launch(state, part, by, {charge = 0, perfect = false} = {}) {
  if (isTimberline(part)) return launchTimberline(state, part, by);
  const {at, forward} = keepMuzzle(part), speed = keepSpeed(part, charge, perfect), style = keepStyle(part.side);
  const shot = {id: `${part.id}:${state.tick}`, part: part.id, side: part.side, style, o: at.map(round), v: forward.map(v => round(v * speed)), tick: state.tick,
    by: by ?? null, charge: round(charge), perfect: !!perfect, hits: []};
  // Ballista Captain's Hat (shared/hero-items.js): the crew reloads twice as fast and every shot hits half again as hard.
  const hat = !!by && hasItem(state.players.find(q => q.id === by), 'hat');
  if (hat) shot.power = 1.5;
  (state.battle.keepShots ??= []).push(shot);
  part.readyTick = state.tick + (hat ? HOME_MANNED.reloadTicks / 2 : HOME_MANNED.reloadTicks); part.fireTick = state.tick;
  delete part.drawTick;
  return {kind: 'keep_ballista_fire', id: shot.id, part: part.id, side: part.side, style, o: [...shot.o], v: [...shot.v], tick: state.tick, charge: shot.charge,
    perfect: shot.perfect, by: shot.by, manned: !!by, position: [...part.position]};
}

function fire(state, p, part, aim, c) {
  const r = setAim(state, p, part, aim, c); if (!r.ok) return r;
  if (keepStyle(part.side) === 'gnashjaw') {
    if (part.hook) return yank(state, part, {terrainHeight: c.terrainHeight, damageHero: c.damageHero, damageEnemy: (e, n, ev, side, owner) => c.damageEnemy(state, e, n, ev, owner, side)});
    if (state.tick < part.readyTick || flying(state, part)) return fail('machine_loading');
    return ok([launch(state, part, p.id)]);
  }
  if (state.tick < part.readyTick) { delete part.drawTick; return fail('machine_loading'); }
  if (isTimberline(part)) { const ev = launch(state, part, p.id); return ev ? ok([ev]) : fail('machine_limit'); }
  return ok([launch(state, part, p.id, sunDraw(part.drawTick, state.tick))]);
}

/** inventionMount / Steer / Draw / Use / Crank aimed at a home ballista part id. c: {terrainHeight, damageHero, damageEnemy}. */
export function homeBallistaAction(state, p, m, c) {
  if (!homeBattle(state)) return fail('battle_inactive');
  const found = findHomeTarget(state, m.structureId), part = found?.target;
  if (!part || part.kind !== 'ballista') return fail('invalid_battle_target');
  if (p.role !== 'hero' || p.hp <= 0) return fail('hero_required');
  if ((p.side || 'party') !== part.side) return fail('not_your_structure');
  if (part.hp <= 0 || baseFallen(state, found.base)) return fail('machine_broken');
  const action = m.action;
  if (action === 'inventionMount') {
    if (m.off) { if (part.operator === p.id) { part.operator = null; delete part.drawTick; } return ok(); }
    if (flat(p.position, part.position) > HOME_MANNED.reach) return fail('too_far');
    const other = operatorOf(state, part); if (other && other.id !== p.id) return fail('machine_manned');
    for (const b of state.inventions?.structures || []) if (b.operator === p.id) b.operator = null;
    for (const base of state.battle.bases) for (const q of base.parts) if (q.operator === p.id) q.operator = null;
    part.operator = p.id;
    setAim(state, p, part, {yaw: part.aimYaw || 0, pitch: part.aimPitch || 0}, c);
    return ok([{kind: 'machine_mount', id: part.id, position: [...part.position], by: p.id}]);
  }
  if (action === 'inventionSteer') return part.operator === p.id ? setAim(state, p, part, m.aim, c) : fail('not_operator');
  if (action === 'inventionDraw') {
    if (part.operator !== p.id) return fail('not_operator');
    if (keepStyle(part.side) !== 'sunlance') return fail('invalid_action');
    if (m.off) { delete part.drawTick; return ok(); }
    if (state.tick < part.readyTick) return fail('machine_loading');
    part.drawTick = state.tick;
    return ok([{kind: 'keep_ballista_draw', part: part.id, side: part.side, tick: state.tick, position: [...part.position]}]);
  }
  if (action === 'inventionUse') return part.operator === p.id ? fire(state, p, part, m.aim, c) : fail('not_operator');
  if (action === 'inventionCrank') {
    if (!part.hook && state.tick >= part.readyTick) return fail('not_needed');
    if (part.operator === p.id) part.crankUntil = state.tick + crewOf(part).crankHold;
    else if (flat(p.position, part.position) <= HOME_MANNED.reach) part.helpUntil = state.tick + crewOf(part).crankHold;
    else return fail('too_far');
    return ok();
  }
  return fail('invalid_action');
}

// --- Flight ---------------------------------------------------------------------------------------------------
const PART_SHAPES = {pylon: {r: .9, h: 5}, spire: {r: 1.1, h: 6.5}, ballista: {r: 1.1, h: 2.4}};
const inCylinder = (p, at, r, h) => Math.hypot(p[0] - at[0], p[2] - at[2]) <= r && p[1] >= at[1] - .05 && p[1] <= at[1] + h;
const hostileHero = (state, h, side) => h.role === 'hero' && h.hp > 0 && (h.side || 'party') !== side && (h.protectedUntil ?? 0) <= state.tick && !h.dragon;

// Everything a shot could meet near this tick's segment, tested at one point.
function probe(state, shot, p, vols, c) {
  if (c.terrainHeight(state, p[0], p[2], false) >= p[1] - .02) return {kind: 'ground', obj: {id: 'ground'}, material: 'earth'};
  for (const base of state.battle.bases) {
    if (base.side === shot.side || baseFallen(state, base)) continue;
    const b = base.position;
    if (shieldUp(state, base) && Math.hypot(p[0] - b[0], p[1] - b[1], p[2] - b[2]) < HOME.domeRadius) return {kind: 'dome', obj: base, material: 'crystal'};
    for (const part of base.parts) { const sh = PART_SHAPES[part.kind]; if (part.hp > 0 && sh && inCylinder(p, part.position, sh.r, sh.h)) return {kind: 'home', obj: part, material: 'stone'}; }
  }
  for (const v of vols) {
    if (v.kind === 'battle-base' && v.obj.side === shot.side) continue;
    if (v.kind === 'enemy' && (shot.hits.includes(v.obj.id) || !(v.obj.hp > 0) || (v.obj.battleRun !== undefined && v.obj.side === shot.side))) continue;
    if (insideVolume(v, p)) return {kind: v.kind, obj: v.obj, material: v.kind === 'tree' ? 'wood' : v.kind === 'enemy' ? 'flesh' : v.obj.material || 'stone'};
  }
  for (const h of state.players) if (!shot.hits.includes(h.id) && hostileHero(state, h, shot.side) && inCylinder(p, h.position, .45, 1.85)) return {kind: 'hero', obj: h, material: 'flesh'};
  return null;
}

// Where a bolt came from, for the struck Hero's hurt cue: the ballista that loosed it.
const shotFrom = shot => shot.o;
function bodyDamage(state, shot, target, isHero, ctx, events) {
  const S = KEEP_BALLISTA[shot.style], power = shot.power || 1;
  if (shot.style === 'gnashjaw') {
    if (isHero) ctx.damageHero(state, target, Math.round(S.hero * power), events, shotFrom(shot)); else ctx.damageEnemy(target, Math.round(S.damage * power), events, shot.side, shot.by);
    return;
  }
  const n = power * (isHero ? (shot.perfect ? S.perfectHero : lerp(S.hero[0], S.hero[1], shot.charge)) : (shot.perfect ? S.perfectDamage : lerp(S.damage[0], S.damage[1], shot.charge)));
  if (isHero) ctx.damageHero(state, target, Math.round(n), events, shotFrom(shot)); else ctx.damageEnemy(target, Math.round(n), events, shot.side, shot.by);
}

function burst(state, shot, at, ctx, events) {
  const S = KEEP_BALLISTA.sunlance;
  for (const e of [...state.enemies]) if (e.hp > 0 && !(e.battleRun !== undefined && e.side === shot.side) && !shot.hits.includes(e.id) && flat(e.position, at) <= S.burst && Math.abs(e.position[1] - at[1]) < 3) ctx.damageEnemy(e, S.burstDamage, events, shot.side, shot.by);
  for (const h of state.players) if (hostileHero(state, h, shot.side) && !shot.hits.includes(h.id) && flat(h.position, at) <= S.burst) ctx.damageHero(state, h, S.burstHero, events, at);
  events.push({kind: 'keep_ballista_burst', id: shot.id, part: shot.part, side: shot.side, position: at.map(round)});
}

function endShot(state, shot, hit, at, ctx, events) {
  const part = findHomeTarget(state, shot.part)?.target;
  if (hit?.kind === 'home') damageHome(state, hit.obj.id, shot.style === 'gnashjaw' ? 15 : shot.perfect ? 60 : 30, shot.side, events);
  if (hit?.kind === 'battle-base') damageHome(state, hit.obj.id, shot.perfect ? 60 : 30, shot.side, events);
  if (hit?.kind === 'dome') events.push({kind: 'home_shield_block', id: hit.obj.id, side: hit.obj.side, position: [...hit.obj.position], at: at.map(round)});
  const t = (state.tick - shot.tick) / 60;
  events.push({kind: 'keep_ballista_stop', id: shot.id, part: shot.part, side: shot.side, style: shot.style, position: at.map(round), t: round(t),
    material: hit?.material || 'earth', host: hit?.kind || 'air', hostId: hit?.obj?.id ?? null, perfect: shot.perfect});
  if (shot.style === 'sunlance' && shot.perfect && hit) burst(state, shot, at, ctx, events);
  if (shot.style === 'gnashjaw' && part) part.retractUntil = state.tick + KEEP_BALLISTA.gnashjaw.retractTicks;
}

function stepShot(state, shot, ctx, events) {
  const t1 = (state.tick - shot.tick) / 60;
  if (t1 <= 0) return false;
  const t0 = Math.max(0, t1 - 1 / 60), a = keepShotAt(shot, t0), b = keepShotAt(shot, t1);
  if (state.tick - shot.tick > KEEP_BALLISTA.maxTicks || Math.abs(b[0]) > 400 || Math.abs(b[2]) > 400 || b[1] < -60) { endShot(state, shot, null, b, ctx, events); return true; }
  const mid = [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2], span = flat(a, b) / 2 + 2.5;
  const vols = worldColliders(state, {terrainHeight: ctx.terrainHeight, near: (x, z, r) => Math.hypot(x - mid[0], z - mid[2]) <= r + span});
  const S = KEEP_BALLISTA[shot.style];
  for (let k = 1; k <= KEEP_BALLISTA.steps; k++) {
    const u = k / KEEP_BALLISTA.steps, p = a.map((x, j) => x + (b[j] - x) * u);
    const hit = probe(state, shot, p, vols, ctx);
    if (!hit) continue;
    if (hit.kind === 'enemy' || hit.kind === 'hero') {
      const isHero = hit.kind === 'hero';
      shot.hits.push(hit.obj.id);
      bodyDamage(state, shot, hit.obj, isHero, ctx, events);
      events.push({kind: 'keep_ballista_hit', id: shot.id, part: shot.part, side: shot.side, style: shot.style, target: hit.obj.id, hero: isHero, position: p.map(round), perfect: shot.perfect});
      if (shot.style === 'gnashjaw') {
        const part = findHomeTarget(state, shot.part)?.target, alive = isHero ? hit.obj.hp > 0 : state.enemies.includes(hit.obj) && hit.obj.hp > 0;
        if (part && alive) {
          const off = [round(p[0] - hit.obj.position[0]), round(p[1] - hit.obj.position[1]), round(p[2] - hit.obj.position[2])];
          part.hook = {target: hit.obj.id, hero: isHero, tick: state.tick, shot: shot.id, off};
          events.push({kind: 'keep_ballista_hook', id: shot.id, part: shot.part, side: shot.side, target: hit.obj.id, hero: isHero, position: p.map(round)});
          return true;
        }
        endShot(state, shot, hit, p, ctx, events); return true;
      }
      if (!shot.perfect || shot.hits.length >= S.pierce) { endShot(state, shot, hit, p, ctx, events); return true; }
      continue; // a Dawnbreak lance flies on through
    }
    endShot(state, shot, hit, p, ctx, events);
    return true;
  }
  return false;
}

/** Steps every keep ballista shot in flight. ctx: {terrainHeight, damageHero(state, h, n, ev), damageEnemy(e, n, ev, side, owner)}. */
export function stepKeepShots(state, ctx, events) {
  const shots = state.battle.keepShots;
  if (!shots?.length) return;
  state.battle.keepShots = shots.filter(s => !stepShot(state, s, ctx, events));
  if (!state.battle.keepShots.length) delete state.battle.keepShots;
}

// --- Hooks (Gnashjaw) -----------------------------------------------------------------------------------------
function hooked(state, part) {
  const h = part.hook;
  if (!h) return null;
  const t = h.hero ? state.players.find(p => p.id === h.target && p.role === 'hero' && p.hp > 0 && !p.dragon) : state.enemies.find(e => e.id === h.target && e.hp > 0);
  return t || null;
}
function release(state, part, reason, events, at) {
  const h = part.hook; delete part.hook;
  part.retractUntil = state.tick + KEEP_BALLISTA.gnashjaw.retractTicks;
  part.readyTick = Math.max(part.readyTick, state.tick + Math.round(HOME_MANNED.reloadTicks * .6));
  events.push({kind: 'keep_ballista_release', part: part.id, side: part.side, target: h.target, reason, position: (at || part.position).map(round)});
}
function drag(state, part, target, metres, ctx) {
  const d = flat(target.position, part.position);
  if (d < 1e-3) return d;
  const k = Math.min(metres, d) / d, x = target.position[0] + (part.position[0] - target.position[0]) * k, z = target.position[2] + (part.position[2] - target.position[2]) * k;
  target.position[0] = x; target.position[2] = z; target.position[1] = Math.max(target.position[1], ctx.terrainHeight(state, x, z));
  return flat(target.position, part.position);
}
function chomp(state, part, target, ctx, events) {
  const G = KEEP_BALLISTA.gnashjaw, hero = !!part.hook.hero;
  if (hero) ctx.damageHero(state, target, G.chompHero, events, part.position); else ctx.damageEnemy(target, G.chompDamage, events, part.side, part.operator || null);
  events.push({kind: 'keep_ballista_chomp', part: part.id, side: part.side, target: target.id, hero, position: [...target.position].map(round)});
  release(state, part, 'chomp', events, target.position);
}
function yank(state, part, ctx) {
  const G = KEEP_BALLISTA.gnashjaw, target = hooked(state, part), events = [];
  if (!target) return fail('machine_loading');
  if (state.tick < (part.hook.yankAt ?? 0)) return fail('cooldown');
  part.hook.yankAt = state.tick + G.yankEvery;
  const d = drag(state, part, target, part.hook.hero ? G.yank : target.kind === 'golem' ? G.yank * .35 : G.yank, ctx);
  if (part.hook.hero) ctx.damageHero(state, target, G.yankDamage, events, part.position); else ctx.damageEnemy(target, G.yankDamage, events, part.side, part.operator || null);
  events.push({kind: 'keep_ballista_yank', part: part.id, side: part.side, target: target.id, position: [...target.position].map(round)});
  if (hooked(state, part) && d <= G.chomp) chomp(state, part, target, ctx, events);
  return ok(events);
}
function stepHook(state, part, ctx, events) {
  const G = KEEP_BALLISTA.gnashjaw, target = hooked(state, part);
  if (!target) { release(state, part, 'gone', events); return; }
  part.readyTick = Math.max(part.readyTick, state.tick + 30);
  let d = flat(target.position, part.position);
  if (d > G.chain + 4 || state.tick - part.hook.tick > G.hookTicks || part.hp <= 0) { release(state, part, 'snap', events, target.position); return; }
  if (!part.hook.hero) target.slowUntil = Math.max(target.slowUntil || 0, state.tick + 2);
  const golem = !part.hook.hero && target.kind === 'golem';
  const cranked = (part.crankUntil || 0) > state.tick || (part.helpUntil || 0) > state.tick;
  // Unmanned, it reels slower on a hero, and a hero who runs past the chain's length tears free; manned, the chain holds.
  const free = part.hook.hero && !part.operator;
  if (free && d > G.chain) { release(state, part, 'snap', events, target.position); return; }
  const speed = part.operator ? (cranked ? (golem ? G.reelGolem : G.reel) : 0) : (golem ? G.reelGolem * .5 : free ? G.reelAuto * .5 : G.reelAuto);
  if (speed > 0) d = drag(state, part, target, speed / 60, ctx);
  else if (d > G.chain) d = drag(state, part, target, d - G.chain, ctx); // the chain holds them at its full length
  if (d <= G.chomp) chomp(state, part, target, ctx, events);
}

// --- Unmanned tracking ----------------------------------------------------------------------------------------
// Elevation that lands a shot of speed v at flat distance d and height h (the flatter of the two arcs), or null.
export function keepPitchFor(d, h, v, g = KEEP_BALLISTA.gravity) {
  const root = v ** 4 - g * (g * d * d + 2 * h * v * v);
  return root < 0 ? null : Math.atan2(v * v - Math.sqrt(root), g * d);
}
const tracks = new WeakMap();
function autoTarget(state, part) {
  const range = HOME.turrets.ballista.range;
  let best = null, d = range;
  for (const bot of state.enemies) if (bot.hp > 0 && bot.battleRun !== undefined && bot.side !== part.side) { const q = flat(bot.position, part.position); if (q <= d) { d = q; best = bot; } }
  if (!best) for (const hero of state.players) if (hostileHero(state, hero, part.side)) { const q = flat(hero.position, part.position); if (q <= d) { d = q; best = hero; } }
  return best;
}
function stepAuto(state, part, events) {
  const target = part.hook ? null : autoTarget(state, part);
  if (!target) { tracks.delete(part); return; }
  // Track the target's ground speed so the shot leads a walking foe (host-only scratch, never saved or sent).
  const old = tracks.get(part), tr = old?.id === target.id ? old : {id: target.id, x: target.position[0], z: target.position[2], vx: 0, vz: 0};
  tr.vx = lerp(tr.vx, (target.position[0] - tr.x) * 60, .2); tr.vz = lerp(tr.vz, (target.position[2] - tr.z) * 60, .2);
  tr.x = target.position[0]; tr.z = target.position[2]; tracks.set(part, tr);
  const charge = keepStyle(part.side) === 'sunlance' ? KEEP_BALLISTA.sunlance.autoCharge : 0, v = keepSpeed(part, charge);
  const muzzle = keepMuzzle(part).at, d0 = flat(target.position, muzzle), lead = d0 / v;
  const aim = [target.position[0] + tr.vx * lead, target.position[1] + 1, target.position[2] + tr.vz * lead];
  const d = Math.hypot(aim[0] - muzzle[0], aim[2] - muzzle[2]), pitch = keepPitchFor(d, aim[1] - muzzle[1], v, isTimberline(part) ? TIMBERLINE_FLIGHT.gravity : KEEP_BALLISTA.gravity);
  if (pitch === null) return;
  const yaw = wrap(Math.atan2(-(aim[0] - part.position[0]), -(aim[2] - part.position[2])) - homeBallistaYaw(part.side));
  const step = KEEP_BALLISTA.turn / 60, dy = wrap(yaw - (part.aimYaw || 0)), dp = clamp(pitch, HOME_MANNED.pitchMin, HOME_MANNED.pitchMax) - (part.aimPitch || 0);
  part.aimYaw = wrap((part.aimYaw || 0) + clamp(dy, -step, step)); part.aimPitch = (part.aimPitch || 0) + clamp(dp, -step, step);
  if (state.tick < part.readyTick || flying(state, part) || Math.abs(dy) > .035 || Math.abs(dp) > .035) return;
  const ev = launch(state, part, null, {charge}); if (ev) events.push(ev);
}

/** Per tick, before the bases step: drop operators who left, wind reloads, reel hooks and fire unmanned ballistas. True while manned. */
export function stepHomeBallista(state, part, ctx, events = []) {
  if (part.operator && (part.hp <= 0 || !operatorOf(state, part))) { part.operator = null; delete part.drawTick; }
  if (part.drawTick !== undefined && (!part.operator || state.tick - part.drawTick > 20 * 60)) delete part.drawTick;
  const crew = crewOf(part);
  if (state.tick < part.readyTick && !part.hook && state.tick - (part.fireTick ?? -1e9) >= crew.fireTicks) {
    const boost = (part.helpUntil || 0) > state.tick ? crew.helperBoost : (part.crankUntil || 0) > state.tick ? crew.operatorBoost : 1;
    if (boost > 1) part.readyTick = Math.max(state.tick + 1, part.readyTick - (boost - 1));
  }
  if (!ctx) return !!part.operator;
  const fallen = state.battle.bases.some(b => b.side === part.side && baseFallen(state, b));
  if (part.hook) { if (part.hp <= 0 || fallen) release(state, part, 'snap', events); else stepHook(state, part, ctx, events); }
  if (part.retractUntil !== undefined && state.tick >= part.retractUntil) delete part.retractUntil;
  if (!part.operator && part.hp > 0 && !fallen) stepAuto(state, part, events);
  return !!part.operator;
}
