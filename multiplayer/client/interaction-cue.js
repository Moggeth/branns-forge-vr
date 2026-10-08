import {isTestingGift,giftContents} from '../shared/testing-supplies.js';
import {STRUCTURES, MACHINE_AMMO, inventionAvailable, timberlineAmmo} from '../shared/inventions.js';
import {STORMREEL, chargeShots, nearestFreePack} from '../shared/stormreel.js';
import {materialLabel,materialInfo,DEPOSIT_CATALOG} from '../shared/material-catalog.js';
// Contextual harvesting cue: one short line telling a first-person Hero what the looked-at tree, ore, loose log,
// nearby pickup or forge needs, and which control does it. Pure decision model: no DOM, no Three.js, no clock.
// It never mutates the snapshot and never fires actions. Rules mirror the authoritative simulation; each mirrored
// constant names its source so a rule change is a one-line audit (test/interaction-cue.test.mjs checks the text).
import {nearestCollectible, collectibleCandidate} from '../shared/collection-target.js';
import {HOME, HOME_LAYOUT, HOME_MANNED, bellPostAt, homePoint} from '../shared/home-bases.js';
import {SHOP, counterAt, draughtCap} from '../shared/home-shop.js';
import {MILL, millAt} from '../shared/home-mill.js';
import {TAVERN, TAVERN_NAMES, taverns, tavernBar} from '../shared/taverns.js';
import {TREE_LIMITS, CUT_RANGE, treeScale, trunkRadius, isFelled, rotateVector, logLength, logRadius} from '../shared/trees.js';

const METAL_BARS = new Set(['iron', 'mithril', 'starMetal', 'copper', 'gold']);
const titleCase = t => String(t).replace(/\b\w/g, ch => ch.toUpperCase());
export const CUE_RULES = Object.freeze({
  strikeReach: 3.2,     // game.js contactRay far, simulation.js targetOK horizontal limit
  facingDot: .45,       // simulation.js targetOK / inReach
  oreRadius: 1.5,       // simulation.js: struck point within 1.5 m (horizontal) of the ore centre
  grabReach: 2.5,       // world-content-view.js grabTarget clamp == TREE_LIMITS.reach
  pickupReach: 2.5,     // simulation.js interact: nearest pickup within 2.5 m of the feet
  forgeRange: 9,        // adventure.js DEPOSIT_RANGE around FORGE [0, 0]
  workshopReach: 5,     // inventions.js usable; outside the forge's three-metre collision footprint
  structureReach: 5,    // inventions.js usable (flat distance); game.js useInvention uses the same reach
  inventoryCap: 999,    // simulation.js / trees.js inventory_full
  probeRange: 8,        // cue only: show "move closer" up to this aimed distance
});

// Item names come from the existing vocabulary (HUD resources line, adventure-view CARRY_NAMES, objective text).
const ORE = {stone: {name: 'Boulder', yields: 'stone'}, meteor: {name: 'Star shard', yields: 'star gems'}};
const PICKUP = {wood: 'Lumber', stone: 'Stone', gems: 'Star gems', apple: 'Apple'};
const KIND_WORD = {wood: 'timber', stone: 'stone', gems: 'gems'}; // adventure-view.js CARRY_NAMES

// Control names exactly as visible: compact HUD chips/drawer (index.html), mobile Attack button (mobile-ui.js),
// objective banner Deliver (adventure-view.js SHORT), VR bindings (vr-input-policy.js, docs/VR-CONTROLS.md).
export const CONTROLS = Object.freeze({
  desktop: {strike: 'Click', axe: '1', pick: '2', grab: 'F', stow: 'E', drop: 'G', throw: 'X', collect: 'E', deliver: 'Deliver', crank: 'Hold R', wind: 'hold R', scope: 'right-click'},
  touch: {strike: 'Attack', axe: 'Axe', pick: 'Pick', grab: 'Actions › Grab', stow: 'Actions › Collect', drop: 'Drop', throw: 'Actions › Throw', collect: 'Collect', deliver: 'Deliver', wind: 'hold Wind', scope: 'Sight'},
  xr: {strike: 'Swing', axe: 'Left grip', pick: 'Left grip', grab: 'Right grip', stow: 'Left stick click', drop: 'Right grip', throw: 'Trigger', collect: 'Left stick click', deliver: 'Wrist panel'},
});

const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const finite3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

/** Closest approach of ray (origin o, unit d, t in [0,max]) to a log capsule. Returns along-ray t or null. */
export function rayLogDistance(o, d, log, max) {
  const radius = logRadius(log), half = Math.max(0, logLength(log) / 2 - radius), a = rotateVector([0, 1, 0], log.quaternion), c = log.position;
  // Segment (c + a*u, |u|<=half) vs ray: solve the 2x2 closest-point system, then clamp and re-project.
  const w = [o[0] - c[0], o[1] - c[1], o[2] - c[2]], b = d[0]*a[0] + d[1]*a[1] + d[2]*a[2];
  const dw = d[0]*w[0] + d[1]*w[1] + d[2]*w[2], aw = a[0]*w[0] + a[1]*w[1] + a[2]*w[2], den = 1 - b*b;
  // Parallel ray: take the cap nearest the origin, not the ambiguous centre.
  let t = den > 1e-6 ? (b*aw - dw) / den : b*clamp(aw, -half, half) - dw; t = clamp(t, 0, max);
  let u = clamp(aw + b*t, -half, half); t = clamp(b*u - dw, 0, max); u = clamp(aw + b*t, -half, half);
  const gap = Math.hypot(w[0] + d[0]*t - a[0]*u, w[1] + d[1]*t - a[1]*u, w[2] + d[2]*t - a[2]*u);
  if (gap > radius) return null;
  return Math.max(0, t - Math.sqrt(Math.max(0, radius**2 - gap*gap))); // entry point, like grabTarget's march
}

/** First terrain crossing along the ray (analytic height samples, no 51k-triangle raycast). */
export function terrainDistance(o, d, height, max, step = .25) {
  for (let t = step; t <= max; t += step) if (o[1] + d[1]*t <= height(o[0] + d[0]*t, o[2] + d[2]*t)) return t;
  return Infinity;
}

/**
 * Decide the single cue for this sample. Inputs are read-only.
 * view: {active, role, xr, menuOpen, mode:'desktop'|'touch'}
 * self: snapshot player {id, position, yaw, tool, resources}
 * snapshot: {harvestedTrees, deposits, pickups, looseLogs, detachedParts}
 * aim: {origin, direction, yaw?, hit:{targetId, point, distance}|null}  (hit = first visible content/shrine surface)
 * ctx: {tree(id) -> {x,z,height,variant}|null, height(x,z), deliver:{kinds:[...], held}|null}
 * Returns null (hide) or {key, kind, state, name, action, control, note, progress}.
 */
export function decideCue(view, self, snapshot, aim, ctx) {
  if (!view?.active || view.role !== 'hero' || view.xr || view.menuOpen || !self || !finite3(self.position)) return null;
  const p = self.position;
  const keys = CONTROLS[view.mode] || CONTROLS.desktop, res = self.resources || {}, tool = self.tool || 'axe';
  const make = (kind, state, id, name, action, control, note = '', progress = null) =>
    ({key: [kind, state, id, name, action, control, note, progress ? progress.done : ''].join('|'), kind, state, target: id, name, action, control, note, progress});

  // 1. A held log owns the hands (trees.js logAction: strike/grab -> hands_full); stow/drop/throw are the only moves.
  const held = (snapshot.looseLogs || []).find(l => l.heldBy === self.id);
  if (held) {
    if ((res.wood | 0) >= CUE_RULES.inventoryCap) return make('carry', 'full', held.id, 'Log in hand', 'Pack full', `${keys.drop} drop · ${keys.throw} throw`);
    return make('carry', 'ready', held.id, 'Log in hand', 'Stow', keys.stow, `${keys.drop} drop · ${keys.throw} throw`);
  }
  const boneHeld = (snapshot.detachedParts || []).some(p => p.heldBy === self.id);
  // A Stormreel crossbow spiked into the ground (shared/stormreel.js stormPickup; game.js interact checks it first).
  for (const b of snapshot.inventions?.structures || []) for (const pack of ['red', 'blue']) {
    const at = b.planted?.[pack]?.at; if (!at || Math.hypot(p[0] - at[0], p[2] - at[2]) > STORMREEL.plantReach + .4) continue;
    const name = pack === 'red' ? 'Red (+) crossbow' : 'Blue (\u2212) crossbow';
    return make('pickup', 'ready', `${b.id}:${pack}`, name, 'Pick it up', keys.collect, tool === 'stormreel' ? 'your crossbow is spiked here in its place' : 'its bolt stays live');
  }

  // The game supplies the exact visible E target. Pure callers use the same authority selector.
  const selected = aim && Object.hasOwn(aim,'collectible') ? aim.collectible : nearestCollectible(snapshot,self,{height:ctx.height,visible:(from,to,id)=>{
    const l=(snapshot.looseLogs||[]).find(l=>l.id===id);if(!l||!aim?.origin||!aim?.direction)return true;
    const t=rayLogDistance(aim.origin,aim.direction,l,CUE_RULES.probeRange);if(t===null)return true;
    const wall=Math.min(aim.hit?.distance??Infinity,ctx.height?terrainDistance(aim.origin,aim.direction,ctx.height,CUE_RULES.probeRange):Infinity);
    return t<=wall+.05;
  }});
  // Apple on a stick (shared/fruit.js): take it, then each press is a bite.
  const snackCue = c => make('pickup','ready',c.id,c.held?`${c.half?'Apple half':'Apple'} · bite ${c.bites+1} of ${c.biteCount||3}`:c.half?'Apple half':c.stick==='arrow'?'Apple on an arrow':c.stick==='bolt'?'Apple on a bolt':'Apple',c.held?'Bite':'Pick up',keys.collect,c.held?'Heals a little each bite':c.half?'A treat: +25 health in two bites':'A treat: +50 health in three bites');
  // Ore and finished bars read as one rewarding stack: "Pick up 7 Iron Bars", "Pick up 4 Mithril Ore".
  const stackCue = c => { const metal = METAL_BARS.has(c.kind), ore = /Ore$/.test(c.kind); if (!metal && !ore) return null; const n = c.amount | 0, label = titleCase(materialLabel(c.kind)), noun = metal ? `${label} Bar${n === 1 ? '' : 's'}` : label;
    return make('pickup', 'ready', c.id, metal && String(c.id).startsWith('ingot') ? `Output bay · ${noun}` : noun, `Pick up ${n} ${noun}`, keys.collect, materialInfo(c.kind)?.use || ''); };
  const pickupCue = c => c.type==='snack'?snackCue(c):(c.type !== 'log' && !isTestingGift(c.id) && stackCue(c)) || (isTestingGift(c.id)?make('pickup','ready',c.id,'Timberline gift basket','Collect supplies',keys.collect,giftContents(snapshot).map(q=>`${q.amount} ${materialLabel(q.kind)}`).join(' · ')):make(c.type==='log'?'log':'pickup','ready',c.id,c.type==='log'?'Wood':c.kind==='apple'?'Apple':`${materialLabel(c.kind)} ×${c.amount}`,c.kind==='apple'?'Eat':'Collect',keys.collect,materialInfo(c.kind)?.use||''));
  if(selected&&!selected.full&&!selected.unnecessary)return pickupCue(selected);

  // 2. Aimed target. Occluders: the nearest visible content surface and analytic terrain.
  if (aim && finite3(aim.origin) && finite3(aim.direction)) {
    const o = aim.origin, d = aim.direction, hit = aim.hit && Number.isFinite(aim.hit.distance) ? aim.hit : null;
    const ground = ctx.height ? terrainDistance(o, d, ctx.height, CUE_RULES.probeRange) : Infinity;
    const wall = Math.min(ground, hit ? hit.distance : Infinity);
    let log = null;
    for (const l of snapshot.looseLogs || []) {
      if (l.heldBy || !finite3(l.position)) continue;
      const t = rayLogDistance(o, d, l, CUE_RULES.probeRange);
      if (t !== null && t <= wall + .05 && (!log || t < log.t)) log = {l, t};
    }
    if (log) {
      if (log.t > CUE_RULES.grabReach) return make('log', 'far', log.l.id, 'Loose log', 'Move closer', '');
      const candidate=collectibleCandidate(snapshot,self,log.l.id,{height:ctx.height});
      if(candidate?.full)return make('log','full',log.l.id,'Wood','Pack full','');
      // An explicit null means the real scene visibility probe found no collectible.
      if(candidate&&!(aim&&Object.hasOwn(aim,'collectible')))return pickupCue(candidate);
      return null;
    }
    if (hit && hit.distance <= ground && hit.distance <= CUE_RULES.probeRange && finite3(hit.point)) {
      const cue = aimedTarget(hit, self, snapshot, ctx, keys, tool, boneHeld, aim.yaw ?? self.yaw, make);
      if (cue) return cue;
    }
  }

  // Explain a full nearby stack, but never advertise a collectible control for it.
  for(const q of snapshot.pickups||[]) {
    if(Math.hypot(p[0]-q.x,p[2]-q.z)>CUE_RULES.pickupReach)continue;
    const c=collectibleCandidate(snapshot,self,q.id,{height:ctx.height});
    if(c?.full)return make('pickup','full',q.id,`${materialLabel(q.kind)} ×${q.amount}`,'Pack full','');
  }

  // Your own home base's hands-on pieces: man a gate ballista, drink at the fountain, ring the barracks bell.
  const home = homeCue(self, snapshot, keys, make);
  if (home) return home;

  // The permanent forge is a usable world object, not a menu hidden behind Tab. Other structures are cued
  // when looked at (aimedTarget). Loose collectibles and aimed work targets retain priority over proximity use.
  const forge = snapshot.inventions?.structures.find(b => b.type === 'forge' && b.hp > 0);
  const forgeCue = forge && structureCue(forge, self, snapshot, keys, make);
  if (forgeCue) return forgeCue;

  // 4. Forge delivery: only inside DEPOSIT_RANGE while the expedition offers Deliver and the Hero carries an accepted kind.
  const deliver = ctx.deliver;
  if (deliver?.kinds?.length && flat(p, [0, 0, 0]) <= CUE_RULES.forgeRange) {
    const note = deliver.kinds.map(k => `${deliver.held?.[k] | 0} ${KIND_WORD[k] || k}`).join(' · ');
    return make('forge', 'ready', 'forge', 'Forge', 'Deliver', keys.deliver, note);
  }
  return null;
}

function homeCue(self, snapshot, keys, make) {
  const b = snapshot.battle; if (b?.v !== 2 || b.status !== 'running') return null;
  const base = b.bases.find(x => x.side === (self.side || 'party')), p = self.position, tick = snapshot.tick ?? 0;
  const at = (xz, r) => Math.hypot(p[0] - xz[0], p[2] - xz[1]) <= r;
  const wait = t => `${Math.ceil((t - tick) / 60)} s`;
  const bar = taverns(snapshot).find(t => at(tavernBar(t), TAVERN.barReach));
  if (bar) return (self.heartyUntil ?? 0) > tick ? make('home', 'wait', bar.id, TAVERN_NAMES[bar.side], 'Still merry', '', wait(self.heartyUntil))
    : make('home', 'ready', bar.id, TAVERN_NAMES[bar.side], 'Hearty Ale', keys.collect, 'full health, then 20% tougher for 3 min');
  if (!base || base.fallenUntil > tick) return null;
  if (at(counterAt(base.side), SHOP.reach)) return make('home', 'ready', 'quartermaster', 'Quartermaster', 'Shop', keys.collect, `${self.resources?.gold || 0} Gold · items for your hero`);
  const mill = base.mill, owed = mill?.queue?.find(q => q.id === self.id)?.gold || 0;
  if (at(millAt(base.side, MILL.crank), MILL.crankReach)) return mill?.queue?.length ? make('home', 'ready', 'mill-crank', 'Mill capstan', 'Crank', keys.crank || keys.collect, 'hold to grind three times as fast') : make('home', 'full', 'mill-crank', 'Mill capstan', 'Nothing grinding', '');
  if (at(millAt(base.side, MILL.hopper), MILL.reach)) {
    const r = self.resources || {}, worth = (r.goldOre || 0) * 2 + (r.copperOre || 0) + Math.floor((r.stone || 0) / 4);
    return worth ? make('home', 'ready', 'mill', 'Gold mill', 'Tip it in', keys.collect, `about ${worth} Gold${owed ? ` · ${owed} still grinding` : ''}`)
      : make('home', 'full', 'mill', 'Gold mill', owed ? `${owed} Gold grinding` : 'Bring ore', '', 'gold ore, copper ore or stone');
  }
  for (const part of base.parts) if (part.kind === 'ballista' && part.hp > 0 && at([part.position[0], part.position[2]], HOME_MANNED.reach)) {
    const sun = part.side !== 'rivals', name = sun ? 'Sunlance' : 'Gnashjaw', wind = keys.crank || keys.wind || 'crank';
    if (part.operator === self.id) return make('home', 'manned', part.id, name, 'Step off', keys.collect);
    const other = part.operator && part.operator !== self.id;
    if (other) return tick < part.readyTick || part.hook ? make('home', 'busy', part.id, name, part.hook ? 'Help reel' : 'Help wind', wind, part.hook ? 'reels the catch in faster' : 'winds it faster') : make('home', 'busy', part.id, name, 'Manned', '');
    return make('home', 'ready', part.id, name, 'Man it', keys.collect, sun ? `then aim, hold ${keys.strike.toLowerCase()} to draw, let go on the golden flash` : `then aim, ${keys.strike.toLowerCase()} spits the harpoon, ${wind} reels it in`);
  }
  if (at(homePoint(base.side, HOME_LAYOUT.fountain), HOME.drink.reach)) {
    const ready = (self.drinkTick ?? -1e9) + HOME.drink.cooldown;
    if (tick < ready) return make('home', 'wait', 'fountain', 'Healing well', 'Settling', '', wait(ready));
    const hurt = (self.hp ?? 100) < (self.maxHp ?? 100), thirsty = (self.draughts || 0) < draughtCap(self);
    return hurt || thirsty ? make('home', 'ready', 'fountain', 'Healing well', 'Drink', keys.collect, [hurt ? `heals ${HOME.drink.heal}` : '', thirsty ? 'fills your draught' : ''].filter(Boolean).join(' · ')) : make('home', 'full', 'fountain', 'Healing well', 'Full health', '');
  }
  if (at(bellPostAt(base.side), HOME.bell.reach)) {
    if (tick < (base.bellReadyTick ?? 0)) return make('home', 'wait', 'bell', 'Barracks bell', 'Still ringing', '', wait(base.bellReadyTick));
    return make('home', 'ready', 'bell', 'Barracks bell', 'Ring it', keys.collect, 'sends a squad out now');
  }
  return null;
}

/** Kinds the forge would accept from this Hero right now: adventure.js RUNNING stages and depositRoom(), read-only. */
export function deliverableNow(adv, role, held = {}) {
  if (role !== 'hero' || !adv || !['camp', 'star', 'rekindle'].includes(adv.stage)) return [];
  const room = kind => adv.stage === 'camp' ? (kind === 'wood' ? adv.need.wood - adv.stock.wood : kind === 'stone' ? adv.need.stone - adv.stock.stone : 0)
    : adv.stage === 'star' ? (kind === 'gems' ? adv.need.star - adv.star.charge : 0)
    : Math.ceil((100 - adv.flame) / ({wood: 4, stone: 2, gems: 10}[kind] || Infinity));
  return ['wood', 'stone', 'gems'].filter(k => (held?.[k] | 0) > 0 && room(k) > 0);
}

/** Cue for using one structure, or null. Mirrors game.js useInvention and inventions.js usable/fire. */
function structureCue(b, self, snapshot, keys, make) {
  const p = self.position;
  if (b.type === 'forge') return flat(p, b.position) <= CUE_RULES.workshopReach
    ? make('pickup', 'ready', b.id, 'Central Forge', 'Open workshop', keys === CONTROLS.touch ? '' : keys.collect, 'Build, refine and manage shared stores.') : null;
  const def = STRUCTURES[b.type];
  if (!def?.use || b.side !== (self.side || 'party') || flat(p, b.position) > CUE_RULES.structureReach) return null;
  if (b.type === 'stormspire') {
    // shared/stormreel.js useStormspire: take or hang the pack (a whole Crystal drops in when it fits), R feeds one more.
    const shots = chargeShots(b), store = shots ? `${shots} shot${shots === 1 ? '' : 's'} stored` : 'Empty: feed it Crystal';
    const crystal = (self.resources?.gems | 0) > 0 && (b.charge || 0) <= STORMREEL.maxCharge - STORMREEL.crystalCharge ? ' · a Crystal drops in' : '';
    if (b.operator === self.id || b.operator2 === self.id) return make('pickup', 'ready', b.id, def.name, `Hang up the ${b.operator === self.id ? 'red (+)' : 'blue (\u2212)'} pack`, keys.collect, `${store}${crystal}${keys === CONTROLS.desktop ? ' · R feeds Crystal' : ''}`);
    const free = nearestFreePack({players: snapshot.players || []}, b, self);
    if (!free) return make('pickup', 'busy', b.id, def.name, 'Both packs in use', '', store);
    return make('pickup', shots || crystal ? 'ready' : 'short', b.id, def.name, `Take the ${free === 'red' ? 'red (+)' : 'blue (\u2212)'} pack`, keys.collect, `${store}${crystal} · 45 m of cable`);
  }
  const ammo = MACHINE_AMMO[b.type];
  if (!ammo) return make('pickup', 'ready', b.id, def.name, def.use, keys.collect);
  // Desktop Timberlines are manned (game.js mountMachine); a loading one can be cranked by anyone beside it.
  const manned = b.type === 'timberline' && keys === CONTROLS.desktop;
  const cost = Object.entries(ammo).map(([k, n]) => `${n} ${materialLabel(k)}`).join(' + ');
  if (b.type === 'timberline') {
    // Crafted bolts are spent first (inventions.js fire), then whole Wood + Iron loads the Hero can pay for.
    const count = snapshot.inventions ? timberlineAmmo(snapshot, self) : {bolts: 0, raw: 0, total: 0};
    const shots = count.total ? `${count.total} shot${count.total === 1 ? '' : 's'}${count.bolts ? ` · ${count.bolts} crafted bolt${count.bolts === 1 ? '' : 's'}` : ''}` : '';
    if (manned && b.operator === self.id) return make('pickup', count.total ? 'ready' : 'short', b.id, def.name, 'Step off', keys.collect, count.total ? `${keys.strike} fires · ${keys.wind || 'hold R'} winds · ${keys.scope || 'right-click'} sights · ${shots}` : `Out of ammo · ${cost} per shot`);
    if (manned && b.operator) return make('pickup', 'busy', b.id, def.name, 'Manned', '');
    if (!count.total) return make('pickup', 'short', b.id, def.name, def.use, keys.collect, `Out of ammo · needs ${cost} per shot or crafted bolts`);
    if (Number.isFinite(snapshot.tick) && snapshot.tick < b.readyTick) return make('pickup', 'busy', b.id, def.name, 'Reloading', keys.crank || '', keys.crank ? `Crank to wind it faster · ${shots}` : shots);
    return make('pickup', 'ready', b.id, def.name, def.use, keys.collect, `${shots} · ${count.bolts ? 'bolts first, then ' : ''}${cost} each`);
  }
  if (Number.isFinite(snapshot.tick) && snapshot.tick < b.readyTick) return make('pickup', 'busy', b.id, def.name, 'Reloading', keys.crank || '', keys.crank ? 'Crank to wind it faster' : '');
  // inventions.js pay: carried materials first, then the side's store when it is reachable.
  const have = snapshot.inventions?.stockpiles ? inventionAvailable(snapshot, self) : (self.resources || {});
  if (Object.entries(ammo).every(([k, n]) => (have[k] | 0) >= n)) return make('pickup', 'ready', b.id, def.name, def.use, keys.collect, `${cost} per shot`);
  return make('pickup', 'short', b.id, def.name, def.use, keys.collect,
    `Needs ${cost} per shot · you have ${Object.keys(ammo).map(k => `${have[k] | 0} ${materialLabel(k)}`).join(', ')}`);
}

function aimedTarget(hit, self, snapshot, ctx, keys, tool, boneHeld, yaw, make) {
  const id = hit.targetId, pt = hit.point, p = self.position;
  const homeBase=snapshot.battle?.v===2&&snapshot.battle.bases?.find(b=>b.id===id||b.parts?.some(q=>q.id===id));
  if(homeBase){
    const part=homeBase.parts.find(q=>q.id===id)||homeBase,friendly=homeBase.side===(self.side==='rivals'?'rivals':'party'),name=homeBase.side==='party'?'Dawnhold':'Grumblekeep';
    const kind=part===homeBase?'heart':part.kind,shielded=part===homeBase&&homeBase.parts.some(q=>q.kind==='pylon'&&q.hp>0);
    const verb=friendly?`Defend this ${kind}`:shielded?'Shielded: break the pylons first':`Attack this ${kind}`;
    return make('structure',friendly||shielded?'friendly':'ready',id,`${name} ${kind}`,verb,friendly||shielded?'':keys.strike,`${Math.ceil(part.hp)} / ${part.maxHp} health`,{done:part.hp,total:part.maxHp});
  }
  const base=snapshot.battle?.status==='running'&&snapshot.battle.bases?.find(b=>b.id===id&&b.hp>0);
  if(base){
    const friendly=base.side===(self.side==='rivals'?'rivals':'party');
    return make('structure',friendly?'friendly':'ready',id,`${base.side==='party'?'Dawn':'Dusk'} sanctuary`,friendly?'Defend this sanctuary':'Attack this sanctuary',friendly?'':keys.strike,`${Math.ceil(base.hp)} / ${base.maxHp} health`,{done:base.hp,total:base.maxHp});
  }
  const bot=snapshot.enemies?.find(e=>e.id===id&&e.battleRun!==undefined);
  if(bot){const friendly=bot.side===(self.side==='rivals'?'rivals':'party');return make('enemy',friendly?'friendly':'ready',id,bot.side==='party'?(bot.kind==='golem'?'Dawnhold golem':'Forgeling'):`Dusk ${bot.kind==='golem'?'golem':'skeleton'}`,friendly?'Ally — fights alongside you':'Enemy — attack',friendly?'':keys.strike);}
  const facing = Number.isFinite(yaw) ? [-Math.sin(yaw), -Math.cos(yaw)] : null;
  const reachable = (x, z, y) => {   // simulation.js targetOK, from the authoritative position
    const dx = x - p[0], dz = z - p[2], dist = Math.hypot(dx, dz);
    return hit.distance <= CUE_RULES.strikeReach && dist <= CUE_RULES.strikeReach && Math.abs(y - p[1]) <= 3 &&
      (dist < .5 || !facing || (facing[0]*dx + facing[1]*dz) / dist >= CUE_RULES.facingDot);
  };
  const tree = ctx.tree?.(id);
  if (tree) {
    const cut = (snapshot.harvestedTrees || []).find(h => h.id === id);
    if (isFelled(cut)) return null; // felled trunks leave targets(); their logs are cued instead
    const floor = ctx.height ? ctx.height(tree.x, tree.z) : 0, local = pt[1] - floor, s = treeScale(tree);
    const progress = cut ? {done: cut.cuts, total: 3} : null;
    if (tool !== 'axe') return make('tree', 'tool', id, 'Tree', 'Needs the Axe', keys.axe, '', progress);
    if (!reachable(tree.x, tree.z, floor)) return make('tree', 'far', id, 'Tree', 'Move closer', '', '', progress);
    if (boneHeld) return make('tree', 'busy', id, 'Tree', 'Drop the bone first', keys.drop);
    // chopTree: hits off the trunk produce nothing; outside CUT_RANGE or away from the notch only glance.
    if (Math.hypot(pt[0] - tree.x, pt[2] - tree.z) > trunkRadius(tree, clamp(local, 0, tree.height)) + TREE_LIMITS.chopSlack + .2)
      return make('tree', 'aim', id, 'Tree', 'Aim at the trunk', '', '', progress);
    if (cut && Math.abs(cut.cutHeight - pt[1]) > TREE_LIMITS.notchTolerance)
      return make('tree', 'aim', id, 'Tree', cut.cutHeight < pt[1] ? 'Aim lower, at the notch' : 'Aim higher, at the notch', '', '', progress);
    if (local < CUT_RANGE[0]*s - .15) return make('tree', 'aim', id, 'Tree', 'Aim higher on the trunk', '', '', progress);
    if (local > CUT_RANGE[1]*s + .15) return make('tree', 'aim', id, 'Tree', 'Aim lower on the trunk', '', '', progress);
    return make('tree', 'ready', id, 'Tree', 'Chop', keys.strike, '', progress);
  }
  const building=snapshot.inventions?.structures.find(b=>b.id===id&&b.hp>0);
  if(building){const cue=structureCue(building,self,snapshot,keys,make);if(cue)return cue;}
  const ore = (snapshot.deposits || []).find(q => q.id === id);
  if (ore) {
    if (ore.depleted) return null; // depleted ores are not rendered (world-content-view.js), so never aimed
    const d=DEPOSIT_CATALOG[ore.kind];const info=d?{name:d.label,yields:materialInfo(d.resource)?.use||materialLabel(d.resource)}:ORE.stone, progress = {done: ore.hits | 0, total: ore.maxHits | 0};
    const floor = ctx.height ? ctx.height(ore.x, ore.z) : p[1];
    if (tool !== 'pick') return make('ore', 'tool', id, info.name, 'Needs the Pick', keys.pick, '', progress);
    if (!reachable(ore.x, ore.z, floor) || Math.hypot(pt[0] - ore.x, pt[2] - ore.z) > CUE_RULES.oreRadius || Math.abs(pt[1] - floor) > 2)
      return make('ore', 'far', id, info.name, 'Move closer', '', '', progress);
    if (boneHeld) return make('ore', 'busy', id, info.name, 'Drop the bone first', keys.drop);
    return make('ore', 'ready', id, info.name, 'Mine', keys.strike, info.yields, progress);
  }
  const remains=(snapshot.detachedParts||[]).find(d=>d.id===id&&d.kind==='golem');
  if(remains&&!snapshot.enemies.some(e=>e.id===remains.sourceId))return make('ore',tool==='pick'?'ready':'tool',id,'Golem remains',tool==='pick'?'Mine':'Needs the Pick',tool==='pick'?keys.strike:keys.pick,'Salvage stone',{done:remains.miningHits||0,total:2});
  return null; // enemies/shrine/props: combat HUD already speaks for them
}

/**
 * Hysteresis so the cue neither flickers at a trunk edge nor churns the DOM: a new cue must hold for `enter`
 * consecutive samples; a lost cue lingers `holdMs`. Same-key samples refresh content without counting as a switch.
 */
export function createCueStabilizer({enter = 2, holdMs = 300} = {}) {
  let shown = null, pending = null, pendingCount = 0, lostAt = -Infinity;
  return {
    push(cue, now) {
      if (cue && shown && cue.key === shown.key) { shown = cue; pending = null; pendingCount = 0; lostAt = -Infinity; return shown; }
      if (!cue) { pending = null; pendingCount = 0; if (shown) { if (lostAt === -Infinity) lostAt = now; if (now - lostAt >= holdMs) shown = null; } return shown; }
      // Same target, new state (e.g. a cut landed): switch immediately; it is the player's own feedback.
      if (shown && cue.kind === shown.kind && cue.target === shown.target) { shown = cue; pending = null; pendingCount = 0; lostAt = -Infinity; return shown; }
      if (pending && pending.key === cue.key) pendingCount++; else { pending = cue; pendingCount = 1; }
      if (pendingCount >= enter) { shown = cue; pending = null; pendingCount = 0; lostAt = -Infinity; }
      return shown;
    },
    reset() { shown = pending = null; pendingCount = 0; lostAt = -Infinity; },
  };
}
