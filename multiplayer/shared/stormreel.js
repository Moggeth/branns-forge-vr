// Stormreel: a lightning crossbow fed by a cable-reel backpack that is plugged into a Stormspire tower.
// One table drives the authority (this file, inventions.js, simulation.js) and the presentation (client/stormreel-*.js).
//
// The circuit is the rule. The tower stores charge (b.charge, 0..240) from Crystal fed into its hopper. The pack's cable
// carries it to the crossbow; the bolt trails a fine copper filament (like a taser probe), so a hit closes the loop:
// tower -> cable -> crossbow -> filament -> bolt -> target -> ground -> the tower's earth stakes.
//   Grounded target: the full shock runs through it into the earth (more when the world is wet).
//   Grounded neighbours: the current spreading through the soil jolts them (step voltage).
//   Target off the ground (more than arcGap up): the arc still finds it (full shock) but no step voltage spreads.
//   An empty tower still throws the bolt: the crossbow is a crossbow without the lightning.
// Carrying: the tower's existing `operator` field names the Hero wearing its pack, and that Hero's tool is 'stormreel'.
// The cable is the range limit: its path (terminal, round any trees it wraps, to the wearer) never exceeds `cable` metres.
import {partPosition,validPartHit,PARTS} from './combat.js';
import {enemyHostileTo} from './battle-mode.js';
import {raining} from './weather-spell.js';
import {worldColliders,insideVolume} from './colliders.js';
import {resolveHomeStructures,homePoint,homeFrame} from './home-bases.js';
import {worldTrees} from './world-content.js';

export const STORMREEL = Object.freeze({
  cable: 45,            // metres of cable on the drum, measured along its path (around any trees it wraps)
  strain: 38,           // the cable starts to pull visibly from here
  chargeTicks: 48,      // a full charge takes 0.8 s of holding
  minCharge: .2,        // a tap still fires a weak shot
  cooldownTicks: 30,    // fastest re-fire the host accepts (the hold itself is most of the cycle)
  maxCharge: 240,       // stored in the tower's charge field (12 full shots)
  shotCost: 20,         // one full shot of stored charge
  crystalCharge: 80,    // one Crystal = four full shots
  range: 48,            // metres; the bolt flies fast and flat enough to resolve as a ray
  bolt: 30,             // the bolt itself (scaled .4..1 by the hold)
  shock: 90,            // the lightning through a grounded target (scaled by the hold)
  wet: 1.5,             // rain multiplies the shock
  arcGap: 2,            // metres the arc will jump from a target's feet to the ground
  stepRadius: 2.5,      // grounded neighbours within this of the strike point are jolted
  stepDamage: 25,
  groundStrike: .5,     // a live bolt into the ground jolts neighbours at half strength
  takeReach: 3.6,       // metres from the tower to shoulder or hang the pack, and to feed crystal
  // The red-blue circuit (Mitch, 2026-10-06): each tower has a red (+) and a blue (-) pack. Every live bolt leaves a probe
  // in what it hits; when the tower has a red probe and a blue probe out, lightning runs between them, frying everything
  // on the line, until it is severed, runs dry, times out or the probes drift too far apart.
  arcLength: 28,        // metres: further apart than this and the current will not jump
  arcSeconds: 6,        // a live circuit lasts this long after its newest probe lands
  arcPulseTicks: 6,     // damage pulses ten times a second
  arcDamage: 14,        // per pulse to every foe on the line (140 a second; more in rain)
  arcDrain: 2,          // tower charge per pulse (a full tower runs a circuit for 12 seconds)
  arcReach: 1,          // metres from the line that the current catches
});
export const PACKS = Object.freeze(['red', 'blue']);
// glTF frame of stormspire.glb (assets-source/stormreel): -Z forward, +Y up, origin on the ground at the tower centre.
export const STORMSPIRE = Object.freeze({terminal: [1.34, 1.85, 0], hook: [1.25, 1.4, 0], terminalB: [-1.34, 1.85, 0], hookB: [-1.25, 1.4, 0], top: [0, 5.35, 0], radius: 1.45});

const rotate = (b, local) => {const c = Math.cos(b.yaw || 0), s = Math.sin(b.yaw || 0); return [b.position[0] + local[0] * c + local[2] * s, b.position[1] + local[1], b.position[2] - local[0] * s + local[2] * c];};
/** World position of a pack's cable terminal on the tower (red on the east face, blue on the west). */
export const terminalPoint = (b, pack = 'red') => rotate(b, pack === 'blue' ? STORMSPIRE.terminalB : STORMSPIRE.terminal);
export const hookPoint = (b, pack = 'red') => rotate(b, pack === 'blue' ? STORMSPIRE.hookB : STORMSPIRE.hook);
/** Which of this tower's packs a player wears: 'red' (b.operator), 'blue' (b.operator2) or null. */
export const packOf = (b, id) => !id ? null : b.operator === id ? 'red' : b.operator2 === id ? 'blue' : null;
const OPERATOR = {red: 'operator', blue: 'operator2'}, WRAPS = {red: ['wraps', 'wrapAt'], blue: ['wraps2', 'wrapAt2']};
export const towerTop = b => rotate(b, STORMSPIRE.top);
export const chargeShots = b => Math.floor((b?.charge || 0) / STORMREEL.shotCost);
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** The tower whose pack this player wears, if any. */
export function wornTower(state, p) {
  if (!p || p.tool !== 'stormreel') return null;
  return state.inventions?.structures?.find(b => b.type === 'stormspire' && b.hp > 0 && (b.operator === p.id || b.operator2 === p.id)) || null;
}

// ---- the cable's path: tower terminal -> any trees it is wrapped around -> the wearer
// Trees are pegs. When the straight run from the last anchor sweeps across a trunk, the cable wraps it (b.wraps gains
// {id, x, z, s}, s the turn direction); swinging back across the same line unwraps it. Wrapped cable is used up, so
// walking around a tree shortens your reach and walking back around gives it back. Never snags, never freezes.
const cross = (ax, az, bx, bz) => ax * bz - az * bx;
/** The trees one pack's cable is wrapped round (red keeps b.wraps, blue b.wraps2). */
export const cableWraps = (b, pack = 'red') => b[WRAPS[pack][0]] || [];
function anchors(b, pack) { const t = terminalPoint(b, pack); return [[t[0], t[2]], ...cableWraps(b, pack).map(w => [w.x, w.z])]; }
/** Cable used from the terminal to the last anchor. */
function wrappedLength(b, pack) { const a = anchors(b, pack); let L = 0; for (let i = 1; i < a.length; i++) L += Math.hypot(a[i][0] - a[i - 1][0], a[i][1] - a[i - 1][1]); return L; }
export function cableLength(b, position, pack = 'red') { const a = anchors(b, pack), last = a[a.length - 1]; return wrappedLength(b, pack) + Math.hypot(position[0] - last[0], position[2] - last[1]); }
function updateWraps(state, b, position, pack) {
  const [wk, ak] = WRAPS[pack], P = [position[0], position[2]], prev = b[ak] || P, freed = new Set(); b[wk] ||= []; const wraps = b[wk];
  // Unwrap: the run from the anchor before a peg has swung back past it.
  while (wraps.length) {
    const w = wraps[wraps.length - 1], a = anchors(b, pack), A = a[a.length - 2];
    if (cross(w.x - A[0], w.z - A[1], P[0] - w.x, P[1] - w.z) * w.s < 0) freed.add(wraps.pop().id); else break;
  }
  // Wrap: the run from the last anchor swept across a trunk between the last position and this one.
  if (!freed.size && wraps.length < 12 && (prev[0] !== P[0] || prev[1] !== P[1])) {
    const a = anchors(b, pack), A = a[a.length - 1], last = wraps[wraps.length - 1]?.id;
    let best = null;
    for (const t of worldTrees(state)) {
      if (t.id === last || freed.has(t.id)) continue;   // swinging back across a peg frees it, it does not re-catch
      const cx = t.x - A[0], cz = t.z - A[1], dc = Math.hypot(cx, cz); if (dc < .6) continue;
      const before = cross(cx, cz, prev[0] - A[0], prev[1] - A[1]), after = cross(cx, cz, P[0] - A[0], P[1] - A[1]);
      if (before * after > 0 || (before === 0 && after === 0)) continue;
      // Only a peg between the anchor and the wearer (on the near side of the swept wedge) catches the cable.
      const k = before / (before - after), sx = prev[0] + (P[0] - prev[0]) * k - A[0], sz = prev[1] + (P[1] - prev[1]) * k - A[1];
      if (Math.hypot(sx, sz) <= dc || cx * sx + cz * sz <= 0) continue;
      if (!best || dc < best.dc) best = {t, dc, s: Math.sign(cross(cx, cz, P[0] - t.x, P[1] - t.z)) || 1};
    }
    if (best) wraps.push({id: best.t.id, x: best.t.x, z: best.t.z, s: best.s});
  }
  b[ak] = P;
}
/** Keep a wearer within cable reach of the terminal (authority and local prediction call the same function). */
export function leash(state, p, position) {
  const b = wornTower(state, p); if (!b) return false;
  const pack = packOf(b, p.id); updateWraps(state, b, position, pack);
  const a = anchors(b, pack), last = a[a.length - 1], room = Math.max(.5, STORMREEL.cable - wrappedLength(b, pack));
  const dx = position[0] - last[0], dz = position[2] - last[1], d = Math.hypot(dx, dz);
  if (d <= room) return false;
  position[0] = last[0] + dx / d * room; position[2] = last[1] + dz / d * room;
  b[WRAPS[pack][1]] = [position[0], position[2]];
  return true;
}
/** 0 slack .. 1 at the end of the cable (for the creak, the HUD and the cable sag). */
export function cableStrain(b, position, pack = 'red') {
  const d = cableLength(b, position, pack);
  return Math.max(0, Math.min(1, (d - STORMREEL.strain) / (STORMREEL.cable - STORMREEL.strain)));
}

function hangUp(b, pack, by, events) {
  b[OPERATOR[pack]] = null; delete b[WRAPS[pack][0]]; delete b[WRAPS[pack][1]];
  events.push({kind: 'storm_pack_home', id: b.id, structureId: b.id, by, pack, position: hookPoint(b, pack)});
}
/** Drop the pack: it winds home to the hook. Called on unequip, role change, death and leaving. */
export function releasePack(state, p, events = []) {
  for (const b of state.inventions?.structures || []) if (b.type === 'stormspire') { const pack = packOf(b, p.id); if (pack) hangUp(b, pack, p.id, events); }
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
  if (packOf(b, p.id)) { const events = []; topUp(events); releasePack(state, p, events); return ok(events); }
  // Red first, then blue; a pack is free when nobody is actually wearing it.
  const worn = pack => { const id = b[OPERATOR[pack]]; return !!id && state.players.some(h => h.id === id && h.tool === 'stormreel'); };
  if (m.pack !== undefined && !PACKS.includes(m.pack)) return fail('invalid_action');
  const pack = m.pack && !worn(m.pack) ? m.pack : PACKS.find(k => !worn(k));
  if (!pack) return fail('machine_manned');
  if (p.heldOre || state.looseLogs?.some(l => l.heldBy === p.id) || state.detachedParts?.some(d => d.heldBy === p.id)) return fail('hands_full');
  const quiet = [];
  for (const x of state.inventions.structures) if (x.type === 'stormspire') { const k = packOf(x, p.id); if (k) hangUp(x, k, p.id, quiet); }
  b[OPERATOR[pack]] = p.id; p.tool = 'stormreel'; b[WRAPS[pack][0]] = []; b[WRAPS[pack][1]] = [p.position[0], p.position[2]];
  const events = [{kind: 'storm_pack_take', id: b.id, structureId: b.id, by: p.id, pack, position: hookPoint(b, pack)}]; topUp(events);
  return ok(events);
}

// Every home base keeps its own Stormspire, charged and ready, beside the keep (Mitch, 2026-10-06). Base-local metres
// (x right of the gate, y out of it, shared/home-bases.js HOME_LAYOUT). Rebuilt full if it is ever destroyed.
export const HOME_STORMSPIRE = Object.freeze({at: Object.freeze([7.6, -5.2])});
export const homeStormspireId = side => `home-stormspire-${side}`;
export function ensureHomeStormspires(state, height) {
  if (state.battle?.v !== 2 || !state.battle.bases || !state.inventions?.structures) return;
  for (const base of state.battle.bases) {
    const id = homeStormspireId(base.side);
    if (state.inventions.structures.some(b => b.id === id)) continue;
    const [x, z] = homePoint(base.side, HOME_STORMSPIRE.at), {forward} = homeFrame(base.side);
    // The cable terminal (tower +X) faces the gate so the cable leads out toward the field.
    const yaw = Math.atan2(-forward[1], forward[0]);
    state.inventions.structures.push({id, type: 'stormspire', position: [x, height(x, z), z], yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)), hp: 240, maxHp: 240,
      side: base.side, builtTick: state.tick || 0, readyTick: state.tick || 0, fireTick: -1000, open: false, charge: STORMREEL.maxCharge, armed: false, aimYaw: 0, operator: null, home: true});
  }
}

/** Per tick: a pack whose wearer has gone, changed tool or role, or died winds home; live circuits burn. */
export function stepStormspires(state, events, height = null, ctx = null) {
  if (height) ensureHomeStormspires(state, height);
  for (const b of state.inventions?.structures || []) {
    if (b.type !== 'stormspire') continue;
    for (const pack of PACKS) {
      const id = b[OPERATOR[pack]]; if (!id) continue;
      const p = state.players.find(h => h.id === id);
      if (!p || p.role !== 'hero' || p.tool !== 'stormreel' || b.hp <= 0 || p.hp <= 0) {
        hangUp(b, pack, p?.id || null, events);
        if (p && p.tool === 'stormreel' && !wornTower(state, p)) p.tool = 'axe';
      }
    }
    if (b.probes) stepCircuit(state, b, events, height, ctx);
  }
  for (const p of state.players) if (p.tool === 'stormreel' && !wornTower(state, p)) p.tool = 'axe';
}

// ---- the red-blue circuit
/** Where a probe is now: riding the body part it stuck in, or where it landed. Updates p.at in place. */
function probeAt(state, probe, height) {
  if (probe.enemy) {
    const e = state.enemies.find(x => x.id === probe.enemy);
    if (e && e.hp > 0) probe.at = partPosition(e, probe.part || 'torso').map(v => +v.toFixed(3));
    else { delete probe.enemy; delete probe.part; if (height) probe.at = [probe.at[0], height(probe.at[0], probe.at[2]), probe.at[2]]; }   // the bolt drops where the body fell
  }
  return probe.at;
}
const segDist = (a, b, p) => { const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
  const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / L)); return Math.hypot(p[0] - a[0] - d[0] * u, p[1] - a[1] - d[1] * u, p[2] - a[2] - d[2] * u); };
function endCircuit(b, events, why) {
  const was = !!b.arc; delete b.arc; delete b.probes;
  if (was) events.push({kind: 'storm_arc_end', id: b.id, structureId: b.id, why});
}
function stepCircuit(state, b, events, height, ctx) {
  const {red, blue} = b.probes;
  if (red) probeAt(state, red, height); if (blue) probeAt(state, blue, height);
  if (!b.arc) { if ((red || blue) && state.tick - Math.max(red?.tick ?? -1e9, blue?.tick ?? -1e9) > STORMREEL.arcSeconds * 60 * 2) delete b.probes; return; }   // a lone probe goes cold
  if (b.hp <= 0) return endCircuit(b, events, 'tower');
  if (b.charge <= 0) return endCircuit(b, events, 'empty');
  if (state.tick > b.arc.until) return endCircuit(b, events, 'faded');
  const A = red.at, B = blue.at;
  if (Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) > STORMREEL.arcLength * 1.15) return endCircuit(b, events, 'stretched');
  if ((state.tick - b.arc.tick) % STORMREEL.arcPulseTicks || !ctx) return;
  b.charge = Math.max(0, b.charge - STORMREEL.arcDrain);
  const amount = Math.round(STORMREEL.arcDamage * (raining(state) ? STORMREEL.wet : 1));
  for (const e of [...state.enemies]) {
    if (e.hp <= 0 || !enemyHostileTo(e, b.side)) continue;
    // The body is a column from feet to head: the line catches it anywhere along that height.
    const at = partPosition(e, 'torso'), feet = [e.position[0], e.position[1] + .2, e.position[2]], head = partPosition(e, 'head');
    if (Math.min(segDist(A, B, at), segDist(A, B, feet), segDist(A, B, head)) > STORMREEL.arcReach + (e.kind === 'golem' ? .8 : 0)) continue;
    ctx.hitEnemyPart(state, e, 'torso', amount, {point: at, normal: [0, 1, 0], ownerId: b.arc.by, side: b.side, tool: 'stormreel', energy: .6, shock: true}, ctx, events);
  }
}
/** Lay a probe where a live bolt landed; a red and a blue probe close the circuit. Returns the colour laid. */
function layProbe(state, b, p, hit, events) {
  // Partnered (the other pack is worn by someone else): your bolts are your pack's colour. Alone: they alternate.
  const mine = packOf(b, p.id), other = mine === 'red' ? 'blue' : 'red', partner = b[OPERATOR[other]];
  const colour = partner && partner !== p.id ? mine : b.lastProbe === 'red' ? 'blue' : 'red';
  b.probes ||= {red: null, blue: null};
  b.probes[colour] = {at: hit.point.map(v => +v.toFixed(3)), tick: state.tick, by: p.id, ...(hit.enemy ? {enemy: hit.enemy, part: hit.part} : {})};
  b.lastProbe = colour;
  const {red, blue} = b.probes;
  if (red && blue && Math.hypot(...red.at.map((v, i) => v - blue.at[i])) <= STORMREEL.arcLength) {
    const fresh = !b.arc;
    b.arc = {tick: fresh ? state.tick : b.arc.tick, until: state.tick + STORMREEL.arcSeconds * 60, by: p.id};
    if (fresh) events.push({kind: 'storm_arc', id: b.id, structureId: b.id, by: p.id, red: [...red.at], blue: [...blue.at]});
  }
  return colour;
}
/** stormSever: any wearer of the tower's packs cuts its live circuit (and pulls in both probes). */
export function stormSever(state, p) {
  const b = wornTower(state, p); if (!b) return {ok: false, code: 'no_pack', events: []};
  if (!b.probes) return {ok: false, code: 'not_needed', events: []};
  const events = []; endCircuit(b, events, 'severed'); delete b.probes;
  if (!events.length) events.push({kind: 'storm_arc_end', id: b.id, structureId: b.id, why: 'severed'});
  return {ok: true, events};
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
    const shock = live ? STORMREEL.shock * (wet ? STORMREEL.wet : 1) * charge : 0;   // the arc always finds its way (Mitch, 2026-10-06)
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
  // A live bolt that lands leaves its probe (red or blue); a bolt that flies off into the distance leaves none.
  const probe = live && (hitEnemy || wall || ground) ? layProbe(state, b, p, {point, ...(hitEnemy && state.enemies.includes(hitEnemy.enemy) && hitEnemy.enemy.hp > 0 ? {enemy: hitEnemy.enemy.id, part: hitEnemy.part} : {})}, events) : null;
  events.unshift({kind: 'storm_bolt', by: p.id, structureId: b.id, origin: [...m.origin], position: [...point], ...(earth ? {earth} : {}), ...(probe ? {probe} : {}),
    ...(hitEnemy ? {targetId: hitEnemy.enemy.id, part: hitEnemy.part} : {}), ...(wall ? {blocked: wall.kind, blockedId: wall.id} : {}), live, grounded, wet, charge: Math.round(charge * 100) / 100, splash, towerCharge: b.charge});
  return {ok: true, events};
}
