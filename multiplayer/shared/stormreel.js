// Stormreel: a lightning crossbow fed by a cable-reel backpack that is plugged into a Stormspire tower.
// One table drives the authority (this file, inventions.js, simulation.js) and the presentation (client/stormreel-*.js).
//
// The circuit is the rule (Mitch, 2026-10-07: "two bolts in the one enemy"; 2026-10-10: closing it is an instant kill). The tower stores charge (b.charge, 0..240)
// from Crystal fed into its hopper. Each pack's cable carries one pole to its crossbow, and every bolt trails a fine copper
// filament (like a taser probe). A bolt on its own only does its kinetic damage: current needs a loop. When a positive (+)
// bolt and a negative (-) bolt are lodged in the SAME foe, the circuit closes through its body:
//   tower(+) -> red cable -> red crossbow -> filament -> + bolt -> the foe -> - bolt -> filament -> blue crossbow -> blue cable -> tower(-)
// It closes with one blinding surge that kills the foe outright, whatever it is (Mitch, 2026-10-10: "instant kill for any
// enemy", no continuous zapping). Bolts in the ground, a wall or two different foes are an open circuit: nothing flows.
// A crossbow can be planted (G / Drop, or by choosing another weapon): it is spiked butt-first into the ground where you
// stand, its pack beside it, cable and filament still connected, while you fetch the other pole. Pick it up again with Use.
// Carrying: the tower's existing `operator` field names the Hero wearing its pack, and that Hero's tool is 'stormreel'.
// Two crossbows, two terminals (Mitch, 2026-10-06): the RED pack's crossbow fires positive (+) bolts, the BLUE pack's fires
// negative (-) ones. Current only runs once a positive probe AND a negative probe are lodged, in either order, and a probe
// stays lodged (tethered to its tower terminal by cable) after you drop the pack that fired it. Q reels your bolt back in.
// The cable is the range limit: its path (terminal, round anything it wraps, to the wearer) never exceeds `cable` metres.
// It routes round everything solid it touches (Mitch, 2026-10-10): trees, keep buildings, rocks, structures and the tower.
import {posLimit} from './world-extent.js';
import {partPosition,validPartHit,PARTS} from './combat.js';
import {enemyHostileTo} from './battle-mode.js';
import {raining} from './weather-spell.js';
import {worldColliders,insideVolume} from './colliders.js';
import {resolveHomeStructures,homePoint,homeFrame,homeSolids,pieceWorld,HOME_SITES} from './home-bases.js';
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
  bolt: 18,             // the bolt's kinetic hit (scaled .4..1 by the hold): a bit of damage, never the point
  wet: 1.5,             // rain multiplies every shock
  stepRadius: 2.5,      // when a circuit closes, grounded neighbours this close to the foe are jolted through the soil
  stepDamage: 25,
  takeReach: 3.6,       // metres from the tower to shoulder or hang the pack, and to feed crystal
  // The circuit through one foe (Mitch, 2026-10-07): a + bolt and a - bolt lodged in the same body.
  surge: 160,           // the least the closing surge does; it always does enough to kill the foe outright (2026-10-10)
  surgeDrain: 12,       // tower charge the surge costs
  arcSeconds: .5,       // the circuit stays drawn this long if anything (a rival ward) kept the foe alive
  plantReach: 2.6,      // metres from a planted crossbow to pick it up again
  probeSeconds: 90,     // a lone probe stays lodged (and tethered) this long while you fetch the other pack
  tether: 65,           // a probe whose pack is on its hook is held by the tower cable alone: past this it pulls free
  reelRefund: .6,       // reeling a bolt in returns this share of the charge it cost
});
/** Terminal polarity: the red pack's crossbow is the positive (+) pole, the blue pack's the negative (-) one. */
export const POLARITY = Object.freeze({red: '+', blue: '-'});
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
/** A crossbow spiked into the ground where its wearer left it: {at, yaw, tick, by} or null. */
export const plantedPack = (b, pack) => b.planted?.[pack] || null;
export const chargeShots = b => Math.floor((b?.charge || 0) / STORMREEL.shotCost);
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const MAX_WRAPS = 24;

/** The tower whose pack this player wears, if any. */
export function wornTower(state, p) {
  if (!p || p.tool !== 'stormreel') return null;
  return state.inventions?.structures?.find(b => b.type === 'stormspire' && b.hp > 0 && (b.operator === p.id || b.operator2 === p.id)) || null;
}

// ---- the cable's path: tower terminal -> any pegs it is wrapped around -> the wearer
// Pegs: every tree trunk, plus the corners of everything solid near the tower (keep buildings and walls, rocks, structures,
// the Forge, landmarks and the tower itself), a few centimetres off the surface. A circle becomes a polygon of pegs, a box
// its four corners. The pegs sit inside the space a walker is pushed out of, so a Hero can never stand between a peg and
// the thing it guards (if they could, the cable would catch the far side instead). Same list on the host and in prediction.
const PEG_PAD = .15, TOWER_PEG_R = 1.1;   // the cable's own tower: its pegs stay inside the terminals (1.34 m out), or every run would start wrapped
function ringPegs(out, id, x, z, r) {
  if (r < .35) { out.push({id, x, z}); return; }
  const n = r > 2 ? 16 : 8, R = r + PEG_PAD;
  for (let k = 0; k < n; k++) { const a = (k + .5) * Math.PI * 2 / n; out.push({id: `${id}-${k}`, x: x + Math.cos(a) * R, z: z + Math.sin(a) * R}); }
}
function boxPegs(out, id, placed, [u, v], [hu, hv]) {
  for (const [k, [su, sv]] of [[1, 1], [1, -1], [-1, -1], [-1, 1]].entries()) {
    const [x, z] = pieceWorld(placed, [u + su * (hu + PEG_PAD), v + sv * (hv + PEG_PAD)]); out.push({id: `${id}-${k}`, x, z});
  }
}
const pegCache = new WeakMap();
/** Every peg within cable reach of this tower: [{id, x, z}] (trees keep their own ids, so older saves still unwrap). */
export function cablePegs(state, b) {
  const key = `${state.tick}|${b.position[0]}|${b.position[2]}|${state.inventions?.structures?.length}|${state.deposits?.length}`;
  const hit = pegCache.get(state)?.get(b.id); if (hit?.key === key) return hit.pegs;
  const reach = STORMREEL.cable + 3, cx = b.position[0], cz = b.position[2], near = (x, z, r = 0) => Math.hypot(x - cx, z - cz) <= reach + r;
  const pegs = [];
  for (const t of worldTrees(state)) if (near(t.x, t.z)) pegs.push({id: t.id, x: t.x, z: t.z});
  if (state.battle?.v === 2) for (const side of ['party', 'rivals']) {
    const [hx, hz] = HOME_SITES[side]; if (!near(hx, hz, 30)) continue;
    for (const sol of homeSolids(side)) {
      if (sol.r !== undefined) { if (near(sol.x, sol.z, sol.r)) ringPegs(pegs, sol.id, sol.x, sol.z, sol.r); }
      else if (near(sol.x, sol.z, Math.hypot(...sol.half) + Math.hypot(...sol.at))) boxPegs(pegs, sol.id, sol, sol.at, sol.half);
    }
  }
  const solids = worldColliders(state, {terrainHeight: (_, x, z) => b.position[1], near: (x, z, r) => near(x, z, r)});
  for (const v of solids) {
    if (v.kind !== 'block' || v.shape === 'trunk') continue;
    const id = `peg-${v.obj?.id ?? 'x'}${v.shape === 'box' ? `-${v.cx ?? 0}-${v.cz ?? 0}`.replace(/[^-\w]/g, '') : ''}`.slice(0, 56);
    if (v.shape === 'box') boxPegs(pegs, id, {x: v.at[0], z: v.at[2], yaw: Math.atan2(v.s ?? 0, v.c ?? 1)}, [v.cx ?? 0, v.cz ?? 0], [v.w / 2, v.d / 2]);
    else if (v.shape === 'ring') ringPegs(pegs, id, v.at[0], v.at[2], v.radius + v.band);
    else ringPegs(pegs, id, v.at[0], v.at[2], v.obj?.id === b.id ? TOWER_PEG_R : v.base);
  }
  if (!pegCache.has(state)) pegCache.set(state, new Map()); pegCache.get(state).set(b.id, {key, pegs});
  return pegs;
}
// Pegs work like the trees always did. When the straight run from the last anchor sweeps across a trunk, the cable wraps it (b.wraps gains
// {id, x, z, s}, s the turn direction); swinging back across the same line unwraps it. Wrapped cable is used up, so
// walking around a tree shortens your reach and walking back around gives it back. Never snags, never freezes.
const cross = (ax, az, bx, bz) => ax * bz - az * bx;
/** The pegs one pack's cable is wrapped round (red keeps b.wraps, blue b.wraps2). */
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
  if (!freed.size && wraps.length < MAX_WRAPS && (prev[0] !== P[0] || prev[1] !== P[1])) {
    const a = anchors(b, pack), A = a[a.length - 1], last = wraps[wraps.length - 1]?.id;
    let best = null;
    for (const t of cablePegs(state, b)) {
      if (t.id === last || freed.has(t.id)) continue;   // swinging back across a peg frees it, it does not re-catch
      const cx = t.x - A[0], cz = t.z - A[1], dc = Math.hypot(cx, cz); if (dc < .25) continue;
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
  const from = b.planted?.[pack]?.at; b[OPERATOR[pack]] = null; delete b[WRAPS[pack][0]]; delete b[WRAPS[pack][1]]; unplant(b, pack);
  // A probe this pack fired stays lodged, still tethered to the terminal: the cable runs to the bolt instead of winding home.
  events.push({kind: 'storm_pack_home', id: b.id, structureId: b.id, by, pack, position: hookPoint(b, pack), ...(from ? {from: [...from]} : {}), ...(b.probes?.[pack] ? {tethered: true} : {})});
}
function unplant(b, pack) { if (!b.planted) return; delete b.planted[pack]; if (!b.planted.red && !b.planted.blue) delete b.planted; }
/** Plant the crossbow you carry: spiked butt-first into the ground a step ahead, pack beside it, still wired up. */
export function plantPack(state, p, events = [], height = null) {
  for (const b of state.inventions?.structures || []) {
    if (b.type !== 'stormspire') continue; const pack = packOf(b, p.id); if (!pack) continue;
    const yaw = Number.isFinite(p.yaw) ? p.yaw : 0, x = p.position[0] - Math.sin(yaw) * .55, z = p.position[2] - Math.cos(yaw) * .55;
    const y = height ? height(x, z) : p.position[1];
    b[OPERATOR[pack]] = null; b.planted ||= {};
    b.planted[pack] = {at: [+x.toFixed(3), +y.toFixed(3), +z.toFixed(3)], yaw: +Math.atan2(Math.sin(yaw), Math.cos(yaw)).toFixed(4), tick: state.tick, by: p.id};
    b[WRAPS[pack][1]] = [x, z];   // the cable keeps any trees it is wrapped round
    events.push({kind: 'storm_plant', id: b.id, structureId: b.id, by: p.id, pack, position: [...b.planted[pack].at], yaw: b.planted[pack].yaw});
  }
  if (p.tool === 'stormreel') p.tool = 'axe';
  return events;
}
/** stormPickup (Use beside a planted crossbow): shoulder it again. A crossbow you already carry is planted in its place. */
export function stormPickup(state, p, m = {}, height = null) {
  if (p.role !== 'hero') return {ok: false, code: 'invalid_action', events: []};
  if (p.heldOre || state.looseLogs?.some(l => l.heldBy === p.id) || state.detachedParts?.some(d => d.heldBy === p.id)) return {ok: false, code: 'hands_full', events: []};
  let best = null;
  for (const b of state.inventions?.structures || []) {
    if (b.type !== 'stormspire' || b.hp <= 0 || !b.planted) continue;
    for (const pack of PACKS) { const pl = b.planted[pack]; if (!pl) continue; const d = flat(p.position, pl.at); if (d <= STORMREEL.plantReach && (!best || d < best.d)) best = {b, pack, d}; }
  }
  if (!best) return {ok: false, code: 'too_far', events: []};
  const events = [];
  if (p.tool === 'stormreel') plantPack(state, p, events, height);
  const {b, pack} = best, pl = b.planted[pack]; unplant(b, pack);
  b[OPERATOR[pack]] = p.id; p.tool = 'stormreel'; b[WRAPS[pack][0]] ||= []; b[WRAPS[pack][1]] = [p.position[0], p.position[2]];
  events.push({kind: 'storm_pickup', id: b.id, structureId: b.id, by: p.id, pack, position: [...pl.at]});
  return {ok: true, events};
}
/** Drop the pack: it winds home to the hook. Called on unequip, role change, death and leaving. */
export function releasePack(state, p, events = []) {
  for (const b of state.inventions?.structures || []) if (b.type === 'stormspire') { const pack = packOf(b, p.id); if (pack) hangUp(b, pack, p.id, events); }
  if (p.tool === 'stormreel') p.tool = 'axe';
  return events;
}

/** A pack is free when nobody is actually wearing it. */
export const packWorn = (state, b, pack) => { const id = b[OPERATOR[pack]]; return !!id && state.players.some(h => h.id === id && h.tool === 'stormreel'); };
/** The free pack hanging nearest to a Hero (a solo Hero walks to the pole they want), or null when both are worn. */
export function nearestFreePack(state, b, p) {
  return PACKS.filter(k => !packWorn(state, b, k) && !b.planted?.[k]).sort((x, y) => flat(p.position, hookPoint(b, x)) - flat(p.position, hookPoint(b, y)))[0] || null;
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
  // The pack you stand beside (red hangs on the east hook, blue on the west) unless one is asked for by name.
  const worn = pack => packWorn(state, b, pack);
  if (m.pack !== undefined && !PACKS.includes(m.pack)) return fail('invalid_action');
  const pack = m.pack && !worn(m.pack) && !b.planted?.[m.pack] ? m.pack : nearestFreePack(state, b, p);
  if (!pack) {
    // Nothing on the hooks: a crossbow left planted out in the field winds home to its hook instead.
    const away = PACKS.find(k => b.planted?.[k]); if (!away) return fail('machine_manned');
    const events = []; hangUp(b, away, p.id, events); return ok(events);
  }
  if (p.heldOre || state.looseLogs?.some(l => l.heldBy === p.id) || state.detachedParts?.some(d => d.heldBy === p.id)) return fail('hands_full');
  const quiet = [];
  for (const x of state.inventions.structures) if (x.type === 'stormspire') { const k = packOf(x, p.id); if (k) hangUp(x, k, p.id, quiet); }
  b[OPERATOR[pack]] = p.id; p.tool = 'stormreel'; b[WRAPS[pack][0]] = []; b[WRAPS[pack][1]] = [p.position[0], p.position[2]];
  const events = [...quiet, {kind: 'storm_pack_take', id: b.id, structureId: b.id, by: p.id, pack, position: hookPoint(b, pack)}]; topUp(events);
  return ok(events);
}

// Every home base keeps its own Stormspire, charged and ready (Mitch, 2026-10-06), at the front of the keep just inside
// the gate, off the troop lane (2026-10-10). Base-local metres (x right of the gate, y out of it, shared/home-bases.js
// HOME_LAYOUT). Stormspires cannot be destroyed for now (Mitch, 2026-10-10: "it's too fun to kill").
export const HOME_STORMSPIRE = Object.freeze({at: Object.freeze([5.6, 11.4])});
export const homeStormspireId = side => `home-stormspire-${side}`;
export function ensureHomeStormspires(state, height) {
  if (state.battle?.v !== 2 || !state.battle.bases || !state.inventions?.structures) return;
  for (const base of state.battle.bases) {
    const id = homeStormspireId(base.side);
    const [x, z] = homePoint(base.side, HOME_STORMSPIRE.at), {forward} = homeFrame(base.side);
    // The cable terminal (tower +X) faces the gate so the cable leads out toward the field.
    const yaw = Math.atan2(-forward[1], forward[0]);
    const old = state.inventions.structures.find(b => b.id === id);
    if (old) {
      // Older saves keep the tower behind the heart: walk it to the front once nobody is using it.
      if (flat(old.position, [x, 0, z]) > .5 && !old.operator && !old.operator2 && !old.planted && !old.probes) {
        old.position = [x, height(x, z), z]; old.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw)); for (const k of ['wraps', 'wrapAt', 'wraps2', 'wrapAt2']) delete old[k];
      }
      continue;
    }
    state.inventions.structures.push({id, type: 'stormspire', position: [x, height(x, z), z], yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)), hp: 240, maxHp: 240,
      side: base.side, builtTick: state.tick || 0, readyTick: state.tick || 0, fireTick: -1000, open: false, charge: STORMREEL.maxCharge, armed: false, aimYaw: 0, operator: null, home: true});
  }
}

/** Per tick: a pack whose wearer has gone, changed tool or role, or died winds home; live circuits burn. */
export function stepStormspires(state, events, height = null, ctx = null) {
  if (height) ensureHomeStormspires(state, height);
  for (const b of state.inventions?.structures || []) {
    if (b.type !== 'stormspire') continue;
    if (b.hp < b.maxHp) b.hp = b.maxHp;   // indestructible for now, and a tower knocked down in an older save stands again
    for (const pack of PACKS) {
      const id = b[OPERATOR[pack]]; if (!id) continue;
      const p = state.players.find(h => h.id === id);
      if (!p || p.role !== 'hero' || p.tool !== 'stormreel' || b.hp <= 0 || p.hp <= 0) {
        hangUp(b, pack, p?.id || null, events);
        if (p && p.tool === 'stormreel' && !wornTower(state, p)) p.tool = 'axe';
      }
    }
    if (b.planted && b.hp <= 0) delete b.planted;
    if (b.probes) stepCircuit(state, b, events, height, ctx);
  }
  for (const p of state.players) if (p.tool === 'stormreel' && !wornTower(state, p)) p.tool = 'axe';
}

// ---- the circuit through one foe
/** Where a probe is now: riding the body part it stuck in, or lying where it fell. Updates p.at in place. */
function probeAt(state, probe, height) {
  if (probe.enemy) {
    const e = state.enemies.find(x => x.id === probe.enemy);
    if (e && e.hp > 0) probe.at = partPosition(e, probe.part || 'torso').map(v => +v.toFixed(3));
    else { delete probe.enemy; delete probe.part; probe.fell = true; if (height) probe.at = [probe.at[0], +height(probe.at[0], probe.at[2]).toFixed(3), probe.at[2]]; }   // the bolt drops out of the body
  }
  return probe.at;
}
/** Both bolts in one living foe: the foe, else null. */
export function circuitFoe(state, b) {
  const red = b.probes?.red, blue = b.probes?.blue;
  if (!red?.enemy || red.enemy !== blue?.enemy) return null;
  const e = state.enemies.find(x => x.id === red.enemy); return e && e.hp > 0 ? e : null;
}
function endCircuit(b, events, why, keepProbes = false) {
  const was = !!b.arc, enemy = b.arc?.enemy; delete b.arc; if (!keepProbes) delete b.probes;
  if (was) events.push({kind: 'storm_arc_end', id: b.id, structureId: b.id, why, ...(enemy ? {enemy} : {})});
}
function dropProbe(b, colour, events, why) {
  const probe = b.probes?.[colour]; if (!probe) return;
  const wasLive = !!b.arc; b.probes[colour] = null;
  if (wasLive) endCircuit(b, events, why, true);
  events.push({kind: 'storm_probe_lost', id: b.id, structureId: b.id, pack: colour, why, position: [...probe.at], probeTick: probe.tick});
  if (b.probes && !b.probes.red && !b.probes.blue) delete b.probes;
}
const shock = (state, base) => Math.round(base * (raining(state) ? STORMREEL.wet : 1));
/** The closing surge: the foe takes enough to die outright whatever it is (even a golem through its armour), and the
 *  current spreading into the soil jolts grounded neighbours. */
function surge(state, b, e, events, ctx) {
  b.charge = Math.max(0, b.charge - STORMREEL.surgeDrain);
  const at = partPosition(e, 'torso'), by = b.arc.by, floor = ctx.terrainHeight ? ctx.terrainHeight(state, e.position[0], e.position[2]) : e.position[1];
  const splash = [];
  for (const o of [...state.enemies]) {
    if (o === e || o.hp <= 0 || !enemyHostileTo(o, b.side) || Math.hypot(o.position[0] - e.position[0], o.position[2] - e.position[2]) > STORMREEL.stepRadius) continue;
    if (e.position[1] - floor > 2 || o.position[1] - (ctx.terrainHeight ? ctx.terrainHeight(state, o.position[0], o.position[2]) : o.position[1]) > .6) continue;   // no path through the soil
    splash.push(o.id);
    ctx.hitEnemyPart(state, o, 'torso', shock(state, STORMREEL.stepDamage), {point: partPosition(o, 'torso'), normal: [0, 1, 0], ownerId: by, side: b.side, tool: 'stormreel', energy: 1, shock: true}, ctx, events);
  }
  const lethal = Math.max(shock(state, STORMREEL.surge), Math.ceil((e.hp + 1) / .45));   // .45: golem armour (combat.js)
  ctx.hitEnemyPart(state, e, 'torso', lethal, {point: at, normal: [0, 1, 0], ownerId: by, side: b.side, tool: 'stormreel', energy: 2.2, shock: true}, ctx, events);
  return splash;
}
function stepCircuit(state, b, events, height, ctx) {
  for (const colour of PACKS) {
    const probe = b.probes?.[colour]; if (!probe) continue;
    probeAt(state, probe, height);
    const id = b[OPERATOR[colour]], held = !!id && state.players.some(h => h.id === id && h.tool === 'stormreel') || !!b.planted?.[colour];
    if (state.tick - probe.tick > STORMREEL.probeSeconds * 60) dropProbe(b, colour, events, 'cold');   // the lone probe goes cold
    else if (!held) { const t = terminalPoint(b, colour); if (Math.hypot(probe.at[0] - t[0], probe.at[1] - t[1], probe.at[2] - t[2]) > STORMREEL.tether) dropProbe(b, colour, events, 'snapped'); }
  }
  if (!b.probes || !b.arc) return;
  const foe = circuitFoe(state, b);
  if (!foe) return endCircuit(b, events, 'cooked', true);   // the foe fell (its bolts drop out) or a bolt came out
  if (b.hp <= 0) return endCircuit(b, events, 'tower');
  if (b.charge <= 0) return endCircuit(b, events, 'empty');
  if (state.tick > b.arc.until) return endCircuit(b, events, 'faded', true);
}
/** Lay a probe where a live bolt landed. A + and a - probe in the same foe close the circuit. Returns the colour laid. */
function layProbe(state, b, p, hit, events, ctx) {
  // Your bolts are always your pack's polarity: red is positive, blue negative. A solo Hero lodges one, plants that
  // crossbow (the probe stays wired to it), fetches the other and lodges the second in the same foe.
  const colour = packOf(b, p.id);
  b.probes ||= {red: null, blue: null};
  b.probes[colour] = {at: hit.point.map(v => +v.toFixed(3)), tick: state.tick, by: p.id, cost: hit.cost ?? 0, ...(hit.enemy ? {enemy: hit.enemy, part: hit.part} : {}), ...(hit.fell ? {fell: true} : {})};
  const foe = circuitFoe(state, b);
  if (b.arc && b.arc.enemy !== foe?.id) endCircuit(b, events, 'open', true);   // a bolt moved to another foe or the ground
  if (foe && !b.arc && b.charge > 0) {
    b.arc = {tick: state.tick, until: state.tick + Math.round(STORMREEL.arcSeconds * 60), by: p.id, enemy: foe.id};
    const at = partPosition(foe, 'torso'), kind = foe.kind, arc = {kind: 'storm_arc', id: b.id, structureId: b.id, by: p.id, enemy: foe.id, creature: kind, red: [...b.probes.red.at], blue: [...b.probes.blue.at], at, splash: [], wet: raining(state)};
    // The arc event leads, so the blinding flash and the thunder land with the kill rather than after it.
    events.push(arc); arc.splash = ctx ? surge(state, b, foe, events, ctx) : [];
    arc.killed = !state.enemies.includes(foe) || foe.hp <= 0;
  }
  return colour;
}
/** stormReel (Q / Special): wind your bolt back in along its tether. Reels your pack's probe, or the other one when yours is
 *  not out, so a wearer can always break a circuit. The circuit dies with the probe; the bolt returns part of its charge. */
export function stormReel(state, p) {
  const b = wornTower(state, p); if (!b) return {ok: false, code: 'no_pack', events: []};
  const mine = packOf(b, p.id), colour = b.probes?.[mine] ? mine : mine === 'red' ? 'blue' : 'red', probe = b.probes?.[colour];
  if (!probe) return {ok: false, code: 'not_needed', events: []};
  const events = [], from = [...probeAt(state, probe, null)], refund = Math.round((probe.cost || 0) * STORMREEL.reelRefund);
  b.probes[colour] = null; if (!b.probes.red && !b.probes.blue) delete b.probes;
  b.charge = Math.min(STORMREEL.maxCharge, b.charge + refund);
  const was = !!b.arc; endCircuit(b, events, 'reeled', true);
  events.unshift({kind: 'storm_reel', id: b.id, structureId: b.id, by: p.id, pack: colour, position: from, refund, circuit: was, probeTick: probe.tick});
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
  const vec = v => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) <= posLimit());
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
  // The bolt alone is only a bolt: a little kinetic damage. The lightning waits for the circuit (layProbe).
  let killed = false;
  if (hitEnemy) {
    const e = hitEnemy.enemy;
    ctx.hitEnemyPart(state, e, hitEnemy.part, Math.round(STORMREEL.bolt * (.4 + .6 * charge)), {point: [...point], normal: dir.map(v => -v), ownerId: p.id, side, tool: 'stormreel', energy: 1.2}, ctx, events);
    killed = !state.enemies.includes(e) || e.hp <= 0;
  }
  // A live bolt that lands leaves its probe (red or blue), still wired up; one that kills drops out and falls to the ground.
  const rest = killed ? [point[0], height(point[0], point[2]), point[2]] : point;
  const probe = live && (hitEnemy || wall || ground) ? layProbe(state, b, p, {point: rest, cost, ...(hitEnemy && !killed ? {enemy: hitEnemy.enemy.id, part: hitEnemy.part} : {}), ...(killed ? {fell: true} : {})}, events, ctx) : null;
  events.unshift({kind: 'storm_bolt', by: p.id, structureId: b.id, pole: packOf(b, p.id), origin: [...m.origin], position: [...point], ...(probe ? {probe} : {}), ...(killed ? {fell: [...rest]} : {}),
    ...(hitEnemy ? {targetId: hitEnemy.enemy.id, part: hitEnemy.part} : {}), ...(wall ? {blocked: wall.kind, blockedId: wall.id} : {}), live, wet, charge: Math.round(charge * 100) / 100, towerCharge: b.charge});
  return {ok: true, events};
}
