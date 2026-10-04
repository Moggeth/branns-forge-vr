// Manning a home ballista (battle v2): a Hero of the base's own side steps up to one of the two
// gate ballistas, presses Use, and aims, fires and cranks it like a Timberline. The wire actions are
// the Timberline ones (inventionMount / Steer / Use / Crank with the ballista's part id), so the
// client reuses its manning controls. Fire is an instant hitscan along the aim; while manned the
// ballista stops firing on its own. Pure simulation rules: fixed ticks, no clocks or randomness.
import {HOME_MANNED, baseFallen, findHomeTarget, homeBattle, homeFrame} from './home-bases.js';
export {HOME_MANNED};

const ID = /^battle-base-(party|rivals)-ballista-[01]$/;
export const isHomeBallistaId = id => typeof id === 'string' && ID.test(id);
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fail = code => ({ok: false, code, events: []});
const ok = (events = []) => ({ok: true, events});

/** Rest heading in the Timberline convention (forward = (-sin W, -cos W)): straight out of the gate. */
export function homeBallistaYaw(side) { const f = homeFrame(side).forward; return Math.atan2(-f[0], -f[1]); }
/** Where the operator stands: behind the stock, swinging round with the aim. */
export function homeBallistaSeat(part, aimYaw = part.aimYaw || 0) {
  const y = homeBallistaYaw(part.side) + aimYaw;
  return [part.position[0] + Math.sin(y) * HOME_MANNED.seat, part.position[1], part.position[2] + Math.cos(y) * HOME_MANNED.seat];
}
const seated = (part, p) => flat(p.position, homeBallistaSeat(part)) <= 1.5;
const operatorOf = (state, part) => part.operator ? state.players.find(p => p.id === part.operator && p.role === 'hero' && p.hp > 0 && (p.side || 'party') === part.side && seated(part, p)) : null;

function setAim(state, p, part, aim, c) {
  if (!aim || !Number.isFinite(aim.yaw) || !Number.isFinite(aim.pitch)) return fail('invalid_target');
  part.aimYaw = wrap(aim.yaw); part.aimPitch = clamp(aim.pitch, HOME_MANNED.pitchMin, HOME_MANNED.pitchMax);
  const seat = homeBallistaSeat(part);
  p.position = [seat[0], c.terrainHeight(state, seat[0], seat[2]), seat[2]];
  return ok();
}

// Closest point of the bolt's line to a body's centre; a hit is within the body's radius.
function along(from, dir, at, radius) {
  const v = [at[0] - from[0], at[1] - from[1], at[2] - from[2]], t = v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2];
  if (t <= 0 || t > HOME_MANNED.range) return Infinity;
  const miss = Math.hypot(v[0] - dir[0] * t, v[1] - dir[1] * t, v[2] - dir[2] * t);
  return miss <= radius ? t : Infinity;
}

function fire(state, p, part, aim, c) {
  if (state.tick < part.readyTick) return fail('machine_loading');
  const r = setAim(state, p, part, aim, c); if (!r.ok) return r;
  const y = homeBallistaYaw(part.side) + part.aimYaw, cp = Math.cos(part.aimPitch);
  const dir = [-Math.sin(y) * cp, Math.sin(part.aimPitch), -Math.cos(y) * cp];
  const from = [part.position[0], part.position[1] + HOME_MANNED.muzzle, part.position[2]];
  let best = null, dist = Infinity;
  for (const e of state.enemies) {
    if (e.hp <= 0 || (e.battleRun !== undefined && e.side === part.side)) continue;
    const big = e.kind === 'golem', t = along(from, dir, [e.position[0], e.position[1] + (big ? 1.6 : 1), e.position[2]], big ? 1.6 : 1.05);
    if (t < dist) { dist = t; best = e; }
  }
  for (const h of state.players) {
    if (h.role !== 'hero' || h.hp <= 0 || (h.side || 'party') === part.side || (h.protectedUntil ?? 0) > state.tick) continue;
    const t = along(from, dir, [h.position[0], h.position[1] + 1, h.position[2]], .9);
    if (t < dist) { dist = t; best = h; }
  }
  const reach = Number.isFinite(dist) ? dist : HOME_MANNED.range, to = from.map((n, i) => n + dir[i] * reach);
  to[1] -= 1.1; // events carry feet heights; the view lifts bolt ends back to chest height
  part.readyTick = state.tick + HOME_MANNED.reloadTicks; part.fireTick = state.tick;
  const events = [{kind: 'home_turret_fire', id: part.id, turret: 'ballista', side: part.side, targetId: best?.id ?? null, from: [...part.position], to, tick: state.tick, manned: true, by: p.id}];
  if (best?.role === 'hero') c.damageHero(state, best, HOME_MANNED.heroDamage, events);
  else if (best) c.damageEnemy(state, best, HOME_MANNED.damage, events, p.id, part.side);
  return ok(events);
}

/** inventionMount / Steer / Use / Crank aimed at a home ballista part id. c: {terrainHeight, damageHero, damageEnemy}. */
export function homeBallistaAction(state, p, m, c) {
  if (!homeBattle(state)) return fail('battle_inactive');
  const found = findHomeTarget(state, m.structureId), part = found?.target;
  if (!part || part.kind !== 'ballista') return fail('invalid_battle_target');
  if (p.role !== 'hero' || p.hp <= 0) return fail('hero_required');
  if ((p.side || 'party') !== part.side) return fail('not_your_structure');
  if (part.hp <= 0 || baseFallen(state, found.base)) return fail('machine_broken');
  const action = m.action;
  if (action === 'inventionMount') {
    if (m.off) { if (part.operator === p.id) part.operator = null; return ok(); }
    if (flat(p.position, part.position) > HOME_MANNED.reach) return fail('too_far');
    const other = operatorOf(state, part); if (other && other.id !== p.id) return fail('machine_manned');
    for (const b of state.inventions?.structures || []) if (b.operator === p.id) b.operator = null;
    for (const base of state.battle.bases) for (const q of base.parts) if (q.operator === p.id) q.operator = null;
    part.operator = p.id;
    setAim(state, p, part, {yaw: part.aimYaw || 0, pitch: part.aimPitch || 0}, c);
    return ok([{kind: 'machine_mount', id: part.id, position: [...part.position], by: p.id}]);
  }
  if (action === 'inventionSteer') return part.operator === p.id ? setAim(state, p, part, m.aim, c) : fail('not_operator');
  if (action === 'inventionUse') return part.operator === p.id ? fire(state, p, part, m.aim, c) : fail('not_operator');
  if (action === 'inventionCrank') {
    if (state.tick >= part.readyTick) return fail('not_needed');
    if (part.operator === p.id) part.crankUntil = state.tick + HOME_MANNED.crankHold;
    else if (flat(p.position, part.position) <= HOME_MANNED.reach) part.helpUntil = state.tick + HOME_MANNED.crankHold;
    else return fail('too_far');
    return ok();
  }
  return fail('invalid_action');
}

/** Per tick, before auto-fire: drop operators who left, wind cranked reloads. True while the ballista is manned. */
export function stepHomeBallista(state, part) {
  if (part.operator && (part.hp <= 0 || !operatorOf(state, part))) part.operator = null;
  if (state.tick < part.readyTick && state.tick - (part.fireTick ?? -1e9) >= HOME_MANNED.fireTicks) {
    const boost = (part.helpUntil || 0) > state.tick ? HOME_MANNED.helperBoost : (part.crankUntil || 0) > state.tick ? HOME_MANNED.operatorBoost : 1;
    if (boost > 1) part.readyTick = Math.max(state.tick + 1, part.readyTick - (boost - 1));
  }
  return !!part.operator;
}
