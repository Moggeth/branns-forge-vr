// Apple on a stick: shoot an apple out of an Orchard apple tree and eat it off the arrow.
// Shared, deterministic authority (60 Hz host, saves, host migration). Presentation lives in client/apple-snack.js.
//
// Any projectile can take an apple through one generic hook: fruitStrike(state, ctx, from, to, shot) sweeps a
// segment against the apples still hanging on standing apple trees. The first apple on the segment is pierced,
// the projectile stops (the caller removes it), and a drop is born: the apple riding on the projectile's shaft,
// falling with a share of its momentum, weathervaning tip-down and planting in soil or tumbling to rest.
// fruitSlice() is the same sweep for a cutting wire (Timberline): every apple it passes is cut in two, and both halves
// fall as their own edible drops. The Timberline's heavy bolts themselves burst an apple outright (cosmetic only).
// A felled apple tree sheds the apples it still carried around its crown when it lands.
// Drops are collectibles: take one, then each bite heals (BITE_HEAL) and three bites reach the core.
// The apple grows back on its branch after REGROW_TICKS; the last GROW_TICKS of that wait are its visible swelling.
import {heroMaxHp} from './hero-progress.js';
import {worldTrees} from './world-content.js';
import {treeScale,isFelled} from './trees.js';
import {BLOOM,addBloom} from './bloom.js';
import {clampToWorld} from './keep-sites.js';

// Apple centres and radii in tree.glb (the Orchard apple, VARIANTS[0]) Tree-root space, metres, Y-up, in the
// authored Fruit mesh's vertex order (26 apples, 42 vertices each). Regenerate with tests/fruit-slots.mjs.
export const APPLE_SLOTS = Object.freeze([
 [1.96,3.654,.241,.085],[-1.63,4.139,.917,.081],[-.328,3.21,-.025,.078],[.447,3.71,1.89,.08],[1.889,3.275,-1.026,.081],[2.047,3.548,.694,.071],
 [1.342,4.314,1.17,.076],[2.002,3.76,-.284,.082],[-2.084,3.868,.251,.078],[1.742,3.007,-.138,.077],[-.632,4.315,-1.233,.085],[-1.564,2.982,.756,.076],
 [1.657,4.486,-.487,.073],[-1.233,2.974,1.244,.081],[-1.49,3.17,-.811,.073],[1.473,4.284,-1.191,.076],[.993,3.27,-.25,.087],[-1.209,3.383,-.957,.08],
 [-1.438,3.821,.884,.087],[.75,3.206,-.219,.076],[-1.408,3.803,1.239,.082],[-2.016,4.206,.734,.088],[-1.241,3.659,.475,.082],[-.269,3.211,.779,.074],
 [-1.657,3.793,-1.255,.075],[-.968,4.163,1.342,.079]].map(Object.freeze));
export const APPLE_VARIANT = 0;
// Shafts in metres: length and how far behind the tip the pierced apple rides. Bare apples have no shaft.
export const STICKS = Object.freeze({arrow: Object.freeze({length: .78, apple: .26}), bolt: Object.freeze({length: .46, apple: .17}), none: null});
export const FRUIT = Object.freeze({
 hitRadius: {arrow: .2, bolt: .24, wire: .16},  // generous: an apple is 16 cm across and should feel hittable
 carry: .2,                                      // share of the projectile's velocity the pierced apple keeps
 regrowTicks: 180*60, growTicks: 150,            // ~3 min; the last 2.5 s are the visible swelling on the branch
 bites: 3, biteHeal: [17, 17, 16], biteTicks: 30,
 halfBites: 2, halfHeal: [13, 12],               // a wire-cut half: two bites, half an apple's health
 drops: 24, missing: 640, dropLifeTicks: 240*60, shed: 6,
 reach: 2.9,
});
const G = 9.8, BOUND = 54.5;
const finite = Number.isFinite, clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const vec = (v, limit = 200) => Array.isArray(v) && v.length === 3 && v.every(n => finite(n) && Math.abs(n) <= limit);
const len = v => Math.hypot(v[0], v[1], v[2]);
const norm = v => { const l = len(v) || 1; return [v[0]/l, v[1]/l, v[2]/l]; };
const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
/** Bites a drop takes to finish: a whole apple three, a half two. */
export const bitesFor = d => d?.half ? FRUIT.halfBites : FRUIT.bites;

export function createFruit() { return {missing: [], drops: []}; }
const fruitOf = state => state.fruit ??= createFruit();

/** World centre and radius of apple `slot` on `tree`, standing on ground height `floor`. */
export function appleWorld(tree, slot, floor) {
 const a = APPLE_SLOTS[slot], s = treeScale(tree);
 return {position: [tree.x + a[0]*s, floor + a[1]*s, tree.z + a[2]*s], radius: a[3]*s};
}
export const isAppleTree = tree => (tree.variant|0) === APPLE_VARIANT;
// Standing apple trees this tick (felled ones carry no fruit). Cached per state/tick: projectiles sweep it every step.
const cache = new WeakMap();
function appleTrees(state, ctx) {
 const c = cache.get(state); if (c && c.tick === state.tick && c.edits === state.edits.length) return c.list;
 const felled = new Set((state.harvestedTrees || []).filter(isFelled).map(h => h.id));
 const list = worldTrees(state).filter(t => isAppleTree(t) && !felled.has(t.id)).map(t => {
  const s = treeScale(t); return {tree: t, floor: ctx.terrainHeight(state, t.x, t.z), reach: 2.4*s, top: 4.7*s};
 });
 cache.set(state, {tick: state.tick, edits: state.edits.length, list}); return list;
}
const missingKey = (id, slot) => id + '#' + slot;
function missingSet(f) { return new Set(f.missing.map(m => missingKey(m.tree, m.slot))); }
// Closest approach of point p to segment ab: [distance, t].
function segmentDistance(p, a, b) {
 const d = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], l = d[0]*d[0] + d[1]*d[1] + d[2]*d[2];
 const t = l ? clamp(((p[0]-a[0])*d[0] + (p[1]-a[1])*d[1] + (p[2]-a[2])*d[2]) / l, 0, 1) : 0;
 return [Math.hypot(a[0] + d[0]*t - p[0], a[1] + d[1]*t - p[1], a[2] + d[2]*t - p[2]), t];
}
// Every hanging apple within `radius` of segment from->to, nearest first along the segment.
function applesOn(state, ctx, from, to, radius) {
 const out = [], f = fruitOf(state); let gone = null;
 const minX = Math.min(from[0], to[0]), maxX = Math.max(from[0], to[0]), minZ = Math.min(from[2], to[2]), maxZ = Math.max(from[2], to[2]);
 const minY = Math.min(from[1], to[1]), maxY = Math.max(from[1], to[1]);
 for (const a of appleTrees(state, ctx)) {
  const t = a.tree; if (t.x + a.reach < minX || t.x - a.reach > maxX || t.z + a.reach < minZ || t.z - a.reach > maxZ) continue;
  if (maxY < a.floor + 2.5 || minY > a.floor + a.top) continue;
  gone ??= missingSet(f);
  for (let slot = 0; slot < APPLE_SLOTS.length; slot++) {
   if (gone.has(missingKey(t.id, slot))) continue;
   const w = appleWorld(t, slot, a.floor), [d, u] = segmentDistance(w.position, from, to);
   if (d <= radius + w.radius*.5) out.push({tree: t, slot, u, ...w});
  }
 }
 return out.sort((x, y) => x.u - y.u || (x.tree.id < y.tree.id ? -1 : 1) || x.slot - y.slot);
}
function markMissing(state, tree, slot) {
 const f = fruitOf(state); if (f.missing.length >= FRUIT.missing) f.missing.shift(); // oldest regrows early
 f.missing.push({tree: tree.id, slot, tick: state.tick});
}
function spawnDrop(state, ctx, {stick, position, velocity, dir, radius, ownerId, golden, tree, slot, cut}) {
 const f = fruitOf(state);
 if (f.drops.length >= FRUIT.drops) { const old = f.drops.findIndex(d => !d.heldBy); if (old < 0) return null; f.drops.splice(old, 1); }
 const id = ctx.nextId(state, 'f');
 const d = {id, stick, apples: 1, bites: 0, radius: +clamp(radius, .05, .12).toFixed(4), position: [...position], velocity: [...velocity], dir: norm(dir),
  mode: 'air', bornTick: state.tick, biteTick: -1000, heldBy: null, ...(ownerId ? {ownerId} : {}), ...(golden ? {golden: true} : {}), ...(tree ? {tree: tree.id, slot} : {}), ...(cut ? {half: true, cut: norm(cut)} : {})};
 f.drops.push(d); return d;
}

/** Projectile hook (any projectile): sweep from->to through the hanging apples. On a hit the apple is taken off its tree
 *  onto the shaft and an event is returned; the caller removes the projectile. shot: {id, kind, ownerId, velocity, golden}. */
export function fruitStrike(state, ctx, from, to, shot) {
 const stick = STICKS[shot?.kind] ? shot.kind : null; if (!stick || !vec(from) || !vec(to)) return null;
 const hit = applesOn(state, ctx, from, to, FRUIT.hitRadius[stick])[0]; if (!hit) return null;
 markMissing(state, hit.tree, hit.slot);
 const v = vec(shot.velocity, 200) ? shot.velocity : [to[0]-from[0], to[1]-from[1], to[2]-from[2]].map(n => n*60);
 // The stem snaps and the apple drags on the shaft: most of the shot's energy goes into the branch.
 const drop = spawnDrop(state, ctx, {stick, position: hit.position, velocity: v.map((n, i) => n*FRUIT.carry + (i === 1 ? .6 : 0)), dir: v, radius: hit.radius,
  ownerId: shot.ownerId, golden: shot.golden, tree: hit.tree, slot: hit.slot});
 return {kind: 'apple_pierce', id: drop?.id ?? null, tree: hit.tree.id, slot: hit.slot, stick, projectileId: shot.id, ...(shot.ownerId ? {by: shot.ownerId} : {}),
  position: [...hit.position], direction: norm(v), ...(shot.golden ? {golden: true} : {})};
}
/** Cutting-wire hook (Timberline): every apple the wire's sweep passes is cut in two along the plane the wire sweeps
 *  (wire direction x travel). Each half falls as its own drop; `cut` is the outward normal of its flat face (toward
 *  the other half). bolts: optional [[from, to], ...] tip sweeps of the bolts themselves, which burst an apple
 *  outright: it leaves the tree and only a cosmetic 'apple_burst' event remains. Returns events. */
export function fruitSlice(state, ctx, from, to, {by = null, push = [0, 0, 0], bolts = []} = {}) {
 const events = [];
 for (const b of bolts) {
  if (!vec(b?.[0]) || !vec(b?.[1])) continue;
  const dir = norm([b[1][0]-b[0][0], b[1][1]-b[0][1], b[1][2]-b[0][2]]);
  for (const hit of applesOn(state, ctx, b[0], b[1], FRUIT.hitRadius.bolt).slice(0, 4)) {
   markMissing(state, hit.tree, hit.slot);
   events.push({kind: 'apple_burst', tree: hit.tree.id, slot: hit.slot, position: [...hit.position], radius: hit.radius, direction: dir, ...(by ? {by} : {})});
  }
 }
 if (!vec(from) || !vec(to)) return events;
 const wire = [to[0]-from[0], to[1]-from[1], to[2]-from[2]], travel = push.some(Boolean) ? norm(push) : [0, -1, 0];
 let n = cross(wire, travel); n = len(n) > 1e-6 ? norm(n) : [1, 0, 0];
 for (const hit of applesOn(state, ctx, from, to, FRUIT.hitRadius.wire).slice(0, 8)) {
  markMissing(state, hit.tree, hit.slot);
  const ids = [];
  for (const side of [1, -1]) { // the halves spring apart off the blade and carry a little of its push
   const out = n.map(k => k*side), position = hit.position.map((k, i) => k + out[i]*hit.radius*.15);
   const drop = spawnDrop(state, ctx, {stick: 'none', position, velocity: [out[0]*1.3 + travel[0]*1.6, 1 + out[1]*.6, out[2]*1.3 + travel[2]*1.6], dir: [0, 1, 0], radius: hit.radius,
    tree: hit.tree, slot: hit.slot, cut: out.map(k => -k)});
   if (drop) ids.push(drop.id);
  }
  events.push({kind: 'apple_slice', ids, tree: hit.tree.id, slot: hit.slot, position: [...hit.position], normal: n, direction: travel, ...(by ? {by} : {})});
 }
 return events;
}
// A felled apple tree sheds a handful of its remaining apples where its crown lands; the rest are lost with the crown.
function shedFelled(state, ctx, events) {
  const f = fruitOf(state), shed = f.shed ??= [];
  // A busy saved world can have hundreds of landed cuts.  The tree list is pure for
  // this tick, so build its id lookup once instead of reconstructing every tree for
  // each cut that is ready to shed fruit.
  let treesById = null;
  for (const h of state.harvestedTrees || []) {
  if (!isFelled(h) || !h.landed || shed.includes(h.id) || state.tick - h.felledTick > 900) continue; // old saves' felled trees stay bare
  const tree = (treesById ??= new Map(worldTrees(state).map(t => [t.id, t]))).get(h.id); shed.push(h.id); if (shed.length > 128) shed.shift();
  if (!tree || !isAppleTree(tree)) continue;
  const gone = missingSet(f), s = treeScale(tree), yaw = h.fallYaw || 0, dir = [-Math.sin(yaw), 0, -Math.cos(yaw)];
  let n = 0;
  for (let slot = 0; slot < APPLE_SLOTS.length && n < FRUIT.shed; slot += 4) {
   if (gone.has(missingKey(tree.id, slot))) continue;
   const a = APPLE_SLOTS[slot], along = a[1]*s, side = a[0]*s*Math.cos(yaw) - a[2]*s*Math.sin(yaw);
   const x = clamp(tree.x + dir[0]*along + dir[2]*side*.6, -BOUND, BOUND), z = clamp(tree.z + dir[2]*along - dir[0]*side*.6, -BOUND, BOUND);
   markMissing(state, tree, slot);
   const drop = spawnDrop(state, ctx, {stick: 'none', position: [x, ctx.terrainHeight(state, x, z) + .9, z], velocity: [dir[0]*1.5 + side*.4, 2.2, dir[2]*1.5], dir: [0, 1, 0], radius: a[3]*s, tree, slot});
   if (drop) { n++; events.push({kind: 'apple_pierce', id: drop.id, tree: tree.id, slot, stick: 'none', shed: true, position: [...drop.position], direction: [0, -1, 0]}); }
  }
 }
}

// Shaft endpoints for a drop: tip ahead of the apple along dir, tail behind it.
export function shaftEnds(d) {
 const s = STICKS[d.stick]; if (!s) return null;
 const p = d.position, u = d.dir;
 return {tip: [p[0] + u[0]*s.apple, p[1] + u[1]*s.apple, p[2] + u[2]*s.apple], tail: [p[0] - u[0]*(s.length - s.apple), p[1] - u[1]*(s.length - s.apple), p[2] - u[2]*(s.length - s.apple)]};
}
// Resting pose: the shaft lies on the ground on its tail with the apple propping it up.
function lieDown(d, ground) {
 const s = STICKS[d.stick], flat = Math.hypot(d.dir[0], d.dir[2]) > .05 ? norm([d.dir[0], 0, d.dir[2]]) : [1, 0, 0];
 if (!s) { // a half settles on whichever face it fell nearer: flat face down (centre at ground level) or dome down
  if (d.half) { const up = d.cut[1] > -.25; /* a dome-down half rocks and settles cut-side up a little more often than not */ d.cut = [0, up ? 1 : -1, 0]; d.position[1] = ground + (up ? d.radius*.97 : .004); return; }
  d.position[1] = ground + d.radius; return; }
 const back = s.length - s.apple, lift = Math.asin(clamp((d.radius - .006)/back, 0, .9));
 d.dir = norm([flat[0]*Math.cos(lift), Math.sin(lift), flat[2]*Math.cos(lift)]); d.position[1] = ground + d.radius;
}
function settle(d, mode, tick) { d.mode = mode; d.velocity = [0, 0, 0]; d.restTick = tick; }

/** Per tick: drops fall, weathervane, plant, bounce and rest; held drops ride their holder; apples regrow. */
export function stepFruit(state, ctx, events) {
 const f = fruitOf(state), dt = 1/60;
 if (f.missing.length && f.missing[0].tick + FRUIT.regrowTicks <= state.tick) f.missing = f.missing.filter(m => m.tick + FRUIT.regrowTicks > state.tick);
 shedFelled(state, ctx, events);
 for (const d of [...f.drops]) {
  if (d.heldBy) {
   const p = state.players.find(q => q.id === d.heldBy && q.role === 'hero');
   if (!p) { d.heldBy = null; d.mode = 'air'; continue; }
   d.position = [p.position[0] - Math.sin(p.yaw)*.35, p.position[1] + 1.25, p.position[2] - Math.cos(p.yaw)*.35]; d.dir = [-Math.sin(p.yaw), .35, -Math.cos(p.yaw)]; d.dir = norm(d.dir); continue;
  }
  if (state.tick - d.bornTick > FRUIT.dropLifeTicks) { f.drops.splice(f.drops.indexOf(d), 1); events.push({kind: 'apple_spoil', id: d.id, position: [...d.position]}); continue; }
  const ground = ctx.terrainHeight(state, d.position[0], d.position[2]);
  if (d.mode !== 'air') { // resting things follow terrain that rises or sinks beneath them
   if ((state.tick + d.bornTick) % 15 === 0) { const off = d.position[1] - (d.mode === 'planted' ? d.ground ?? ground : ground); d.ground = ground; if (d.mode === 'planted') d.position[1] = ground + off; else lieDown(d, ground); }
   continue;
  }
  const v = d.velocity, drag = Math.exp(-.35*dt);
  v[0] *= drag; v[2] *= drag; v[1] = v[1]*drag - G*dt;
  const [ax, az] = clampToWorld(d.position[0] + v[0]*dt, d.position[2] + v[2]*dt, BOUND);
  d.position = [ax, clamp(d.position[1] + v[1]*dt, -150, 150), az];
  const speed = len(v), s = STICKS[d.stick];
  if (d.half && speed > .5) { // a tumbling half: its face turns over as it falls (deterministic, from its spin sense)
   const a = 7*dt*(d.id.charCodeAt(d.id.length - 1) % 2 ? 1 : -1), c = Math.cos(a), sn = Math.sin(a), [x, y, z] = d.cut;
   d.cut = norm([x*c - y*sn, x*sn + y*c, z]);
  }
  if (s && speed > .5) { // a shaft weathervanes into its flight; the heavy head drags it tip-down as it drops
   const target = norm(v), k = clamp(3.2*dt*Math.min(1, speed/6), 0, 1);
   d.dir = norm(d.dir.map((n, i) => n + (target[i] - n)*k));
  }
  const g = ctx.terrainHeight(state, d.position[0], d.position[2]);
  if (s) {
   const {tip, tail} = shaftEnds(d), tipGround = ctx.terrainHeight(state, tip[0], tip[2]);
   if (tip[1] <= tipGround && d.dir[1] < -.45 && speed > 3.5) { // planted: the head bites into the soil and stands
    const sink = clamp(speed*.012, .05, .13), shift = tipGround - tip[1] - sink*-d.dir[1];
    d.position[1] += shift; d.ground = g; settle(d, 'planted', state.tick);
    events.push({kind: 'apple_land', id: d.id, planted: true, stick: d.stick, position: [...d.position], speed: +speed.toFixed(2)}); continue;
   }
   const low = Math.min(tip[1] - tipGround, tail[1] - ctx.terrainHeight(state, tail[0], tail[2]), d.position[1] - d.radius - g);
   if (low <= 0) {
    d.position[1] -= low; v[1] = Math.abs(v[1]) > 1.2 ? Math.abs(v[1])*.28 : 0; v[0] *= .55; v[2] *= .55;
    d.dir = norm([d.dir[0], d.dir[1]*.4, d.dir[2]]); // a skidding shaft flattens onto the ground
    if (len(v) < .45) { lieDown(d, g); settle(d, 'rest', state.tick); events.push({kind: 'apple_land', id: d.id, stick: d.stick, position: [...d.position], speed: +speed.toFixed(2)}); }
    else if (speed > 1.5) events.push({kind: 'apple_bounce', id: d.id, stick: d.stick, position: [...d.position], speed: +speed.toFixed(2)});
   }
  } else if (d.half && d.position[1] - d.radius*.6 <= g) { // a half thuds and slides: little bounce, it doesn't roll
   d.position[1] = g + d.radius*.6; const bounce = Math.abs(v[1]) > 1.6 ? Math.abs(v[1])*.18 : 0; v[1] = bounce; v[0] *= .5; v[2] *= .5;
   if (Math.hypot(v[0], v[2]) < .4 && !bounce) { lieDown(d, g); settle(d, 'rest', state.tick); events.push({kind: 'apple_land', id: d.id, stick: 'none', half: true, position: [...d.position], speed: +speed.toFixed(2)}); }
  } else if (d.position[1] - d.radius <= g) { // a bare apple bounces, then rolls to a stop
   d.position[1] = g + d.radius; const bounce = Math.abs(v[1]) > 1 ? Math.abs(v[1])*.35 : 0; v[1] = bounce; v[0] *= .7; v[2] *= .7;
   if (Math.hypot(v[0], v[2]) < .25 && !bounce) { lieDown(d, g); settle(d, 'rest', state.tick); events.push({kind: 'apple_land', id: d.id, stick: 'none', position: [...d.position], speed: +speed.toFixed(2)}); }
   else if (bounce > .6) events.push({kind: 'apple_bounce', id: d.id, stick: 'none', position: [...d.position], speed: +speed.toFixed(2)});
  }
 }
}

const heldDrop = (state, p) => fruitOf(state).drops.find(d => d.heldBy === p.id);
const handsFull = (state, p) => !!p.heldOre || (state.looseLogs || []).some(l => l.heldBy === p.id) || (state.detachedParts || []).some(d => d.heldBy === p.id);
/** Collectible contract (shared/collection-target.js): the held snack, else the nearest free drop in reach. */
export function fruitCandidate(state, p, id = null, ctx = {}) {
 if (p?.role !== 'hero' || !p.position || p.hp <= 0) return null;
 const f = state.fruit; if (!f?.drops?.length) return null;
 const held = f.drops.find(d => d.heldBy === p.id);
 if (held && (id === null || id === held.id)) return candidate(held, p, 0, true);
 if (held || handsFull(state, p)) return null;
 let best = null;
 for (const d of f.drops) {
  if (d.heldBy || (id !== null && d.id !== id)) continue;
  const dx = d.position[0] - p.position[0], dz = d.position[2] - p.position[2], dy = d.position[1] - (p.position[1] + .4), dist = Math.hypot(dx, dz, dy*.5);
  if (dist > FRUIT.reach || Math.abs(dy) > 3) continue;
  // sight the top of the fruit: a half lying cut-side down has its centre on the ground itself
  if (ctx.visible && !ctx.visible([p.position[0], p.position[1] + 1.1, p.position[2]], [d.position[0], d.position[1] + d.radius*.6, d.position[2]], d.id)) continue;
  if (!best || dist < best.distance || dist === best.distance && d.id < best.id) best = candidate(d, p, dist, false);
 }
 return best;
}
const candidate = (d, p, distance, held) => ({id: d.id, type: 'snack', kind: d.half ? 'apple_half' : 'apple', half: !!d.half, biteCount: bitesFor(d), stick: d.stick, apples: d.apples, bites: d.bites, amount: d.apples, position: [...d.position], distance, held, full: false, unnecessary: false});
export const isFruitDrop = (state, id) => !!state.fruit?.drops?.some(d => d.id === id);

/** Hero actions: take a drop, bite the held one, or put it down. Collect (E / touch / VR) on a free drop takes it and
 *  on the held drop bites; the primary action bites too. Each bite heals and the third reaches the core. */
export function snackAction(state, p, m) {
 if (p?.role !== 'hero') return {ok: false, code: 'role_required', events: []};
 const f = fruitOf(state), op = m?.op;
 if (op === 'take') {
  if (heldDrop(state, p)) return snackAction(state, p, {op: 'bite'});
  if (handsFull(state, p)) return {ok: false, code: 'hands_full', events: []};
  const c = fruitCandidate(state, p, typeof m.id === 'string' ? m.id : null); if (!c || c.held) return {ok: false, code: 'out_of_reach', events: []};
  const d = f.drops.find(q => q.id === c.id); d.heldBy = p.id; d.mode = 'held'; d.velocity = [0, 0, 0]; d.biteTick = state.tick - FRUIT.biteTicks + 20; // a beat to admire it
  return {ok: true, events: [{kind: 'snack_take', id: d.id, by: p.id, stick: d.stick, position: [...d.position]}]};
 }
 const d = heldDrop(state, p); if (!d) return {ok: false, code: 'nothing_held', events: []};
 if (op === 'bite') {
  if (state.tick - d.biteTick < FRUIT.biteTicks) return {ok: false, code: 'cooldown', events: []};
  d.biteTick = state.tick; d.bites++;
  const before = p.hp; p.hp = Math.min(heroMaxHp(p), p.hp + (d.half ? FRUIT.halfHeal : FRUIT.biteHeal)[d.bites - 1]);
  const events = [{kind: 'snack_bite', id: d.id, by: p.id, bite: d.bites, of: bitesFor(d), ...(d.half ? {half: true} : {}), apples: d.apples, heal: +(p.hp - before).toFixed(2), stick: d.stick, position: [p.position[0], p.position[1] + 1.55, p.position[2]]}];
  if (d.bites >= bitesFor(d)) {
   d.apples--; d.bites = 0; addBloom(state, BLOOM.apple, events, [...p.position]); // fruit eaten spreads the seed
   if (d.apples <= 0) { f.drops.splice(f.drops.indexOf(d), 1); events.push({kind: 'snack_done', id: d.id, by: p.id, stick: d.stick, position: [...d.position]}); }
  }
  return {ok: true, events};
 }
 if (op === 'drop') { releaseSnack(state, p, m.toss === true); return {ok: true, events: [{kind: 'snack_drop', id: d.id, by: p.id, position: [...d.position]}]}; }
 return {ok: false, code: 'invalid_action', events: []};
}
/** A loose apple lying on the ground (a `pickups` entry of kind 'apple': God gifts, starting apples) is taken into the hand
 *  like any other drop, a bare apple with no shaft, and eaten in three bites. Returns null when it can't become a drop. */
export function takeGroundApple(state, ctx, p, q) {
 if (p?.role !== 'hero' || q?.kind !== 'apple') return null;
 if (heldDrop(state, p) || handsFull(state, p)) return {ok: false, code: 'hands_full', events: []};
 const r = .08, d = spawnDrop(state, ctx, {stick: 'none', position: [q.x, q.y + r, q.z], velocity: [0, 0, 0], dir: [0, 1, 0], radius: r}); if (!d) return null;
 d.heldBy = p.id; d.mode = 'held'; d.biteTick = state.tick - FRUIT.biteTicks + 20;
 state.pickups.splice(state.pickups.indexOf(q), 1);
 return {ok: true, events: [{kind: 'snack_take', id: d.id, by: p.id, stick: 'none', ground: q.id, position: [...d.position]}]};
}
/** Put the held snack down (tool change, death, role change, leaving): it falls from the hand. */
export function releaseSnack(state, p, toss = false) {
 const d = state.fruit?.drops?.find(q => q.heldBy === p.id); if (!d) return false;
 const fx = -Math.sin(p.yaw || 0), fz = -Math.cos(p.yaw || 0);
 d.heldBy = null; d.mode = 'air'; const [ax, az] = clampToWorld(p.position[0] + fx*.45, p.position[2] + fz*.45, BOUND); d.position = [ax, p.position[1] + 1.15, az];
 d.velocity = toss ? [fx*3.5, 2.2, fz*3.5] : [fx*.6, .5, fz*.6]; d.bornTick = Math.max(d.bornTick, state.tick - FRUIT.dropLifeTicks + 60*60); return true;
}

/** Strict restore for saves/checkpoints; absent in older saves. ids: shared unique-id set. trees: valid tree ids. */
export function restoreFruit(saved, ids, players) {
 const f = saved.fruit; if (f === undefined) return createFruit();
 if (!f || typeof f !== 'object' || !Array.isArray(f.missing) || !Array.isArray(f.drops) || f.missing.length > FRUIT.missing || f.drops.length > FRUIT.drops || (f.shed !== undefined && (!Array.isArray(f.shed) || f.shed.length > 128))) throw Error('Invalid fruit');
 const tick = n => Number.isSafeInteger(n) && n >= -1000 && n <= saved.tick, idOk = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
 for (const m of f.missing) if (!m || !idOk(m.tree) || !Number.isInteger(m.slot) || m.slot < 0 || m.slot >= APPLE_SLOTS.length || !tick(m.tick)) throw Error('Invalid missing apple');
 const holders = new Set();
 for (const d of f.drops) {
  if (!d || !idOk(d.id) || ids.has(d.id) || !Object.hasOwn(STICKS, d.stick) || !Number.isInteger(d.apples) || d.apples < 1 || d.apples > 8 || !Number.isInteger(d.bites) || d.bites < 0 || d.bites >= bitesFor(d) || (d.half !== undefined && (d.half !== true || !vec(d.cut, 1.01) || Math.abs(len(d.cut) - 1) > .02 || d.stick !== 'none')) || (d.half === undefined && d.cut !== undefined) ||
   !finite(d.radius) || d.radius < .04 || d.radius > .13 || !vec(d.position) || !vec(d.velocity, 120) || !vec(d.dir, 1.01) || Math.abs(len(d.dir) - 1) > .02 ||
   !['air', 'rest', 'planted', 'held'].includes(d.mode) || !tick(d.bornTick) || !tick(d.biteTick) || (d.restTick !== undefined && !tick(d.restTick)) || (d.ground !== undefined && !finite(d.ground)) ||
   (d.heldBy !== null && (!players.some(p => p.id === d.heldBy && p.role === 'hero') || holders.has(d.heldBy))) || (d.heldBy === null && d.mode === 'held') ||
   (d.ownerId !== undefined && !idOk(d.ownerId)) || (d.golden !== undefined && d.golden !== true) || (d.tree !== undefined && (!idOk(d.tree) || !Number.isInteger(d.slot) || d.slot < 0 || d.slot >= APPLE_SLOTS.length))) throw Error('Invalid fruit drop');
  ids.add(d.id); if (d.heldBy) holders.add(d.heldBy);
 }
 return JSON.parse(JSON.stringify({missing: f.missing, drops: f.drops, ...(f.shed ? {shed: f.shed.filter(idOk)} : {})}));
}
