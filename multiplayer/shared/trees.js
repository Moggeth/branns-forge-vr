// Shared, deterministic tree rules: chopping, tick-driven felling, physical logs, collision and strict save.
// No clock, no RNG, no Three.js. Every client and late joiner derives identical poses from (state, tick).
import {worldTrees} from './world-content.js';

export const TREE_LIMITS = {logs: 48, logsPerTree: 3, logLength: 1.1, logRadius: .16, reach: 2.5, settleTicks: 36,
 notchTolerance: .35, chopSlack: .25, hz: 60, gravity: 15, maxFallTicks: 240, cell: 4, worldHalf: 54.5};
// Authored trunk contract (art/tree_contract.json, metres at the authored scale). Rings are regular 12-gons, axis x=z=0 below 2 m.
// [authored height (bbox max y), first limb y, [y, mean radius]...]. Radius is linear between rings, so interpolation is exact.
export const TREE_PROFILES = {
 tree: {height: 6.002, firstLimb: 2.514, rings: [[-.1,.42],[0,.42],[.12,.3688],[.3,.2745],[.6,.2658],[1,.2541],[1.4,.2425],[1.8,.2308],[2,.225],[2.367,.204],[2.733,.183],[3.1,.162]]},
 tree_b: {height: 6.297, firstLimb: 2.418, rings: [[-.1,.4],[0,.4],[.12,.3494],[.3,.2562],[.6,.248],[1,.2372],[1.4,.2263],[1.8,.2154],[2,.21],[2.3,.1904],[2.6,.1708],[2.9,.1512]]},
 tree_young: {height: 4.095, firstLimb: 2.255, rings: [[-.1,.19],[0,.19],[.12,.1682],[.3,.1281],[.6,.124],[1,.1186],[1.4,.1132],[1.8,.1077],[2,.105],[2.133,.0952],[2.267,.0854],[2.4,.0756]]}
};
export const CUT_RANGE = [.4, 1.6]; // authored metres above ground (contract cut_range_m)
export const VARIANTS = ['tree', 'tree_b', 'tree_young'];
export const NOTCH = {upper: Math.tan(50*Math.PI/180), lower: Math.tan(12*Math.PI/180), depth: [0, .34, .62]};

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const vec = (v, b = 200) => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) <= b);
const distance = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
export const variantName = tree => VARIANTS[tree.variant] || 'tree';
export const treeProfile = tree => TREE_PROFILES[variantName(tree)];
export const treeScale = tree => tree.height / treeProfile(tree).height;
const widestRing = new Map(Object.values(TREE_PROFILES).map(p=>[p,Math.max(...p.rings.map(r=>r[1]))]));
export const isFelled = cut => cut?.cuts === 3 && cut.felledTick > 0;
export function rotateVector(v, q) { const [x,y,z,w] = q, [a,b,c] = v, tx = 2*(y*c-z*b), ty = 2*(z*a-x*c), tz = 2*(x*b-y*a); return [a+w*tx+y*tz-z*ty, b+w*ty+z*tx-x*tz, c+w*tz+x*ty-y*tx]; }

/** World-space trunk radius at a local height above the tree's ground (scaled authored contract). */
export function trunkRadius(tree, localY) {
 const p = treeProfile(tree), s = treeScale(tree), y = localY / s, r = p.rings;
 if (y <= r[0][0]) return r[0][1]*s;
 for (let i = 1; i < r.length; i++) if (y <= r[i][0]) { const t = (y-r[i-1][0])/(r[i][0]-r[i-1][0]); return (r[i-1][1]+(r[i][1]-r[i-1][1])*t)*s; }
 return r[r.length-1][1]*s;
}
/** Local notch/hinge height above the tree floor, clamped to the authored straight-trunk cut range. */
export function cutLocalHeight(tree, cut, floor) { const s = treeScale(tree); return clamp(cut.cutHeight - floor, CUT_RANGE[0]*s, CUT_RANGE[1]*s); }
/** Notch geometry descriptor shared by simulation (hit tests) and view (carving). side = outward notch normal yaw. */
export function notchFor(tree, cut, floor) {
 const h = cutLocalHeight(tree, cut, floor), r = trunkRadius(tree, h), cuts = Math.min(2, cut.cuts);
 return {height: h, radius: r, depth: r*NOTCH.depth[cuts], hinge: r - r*NOTCH.depth[cuts], normal: [Math.sin(cut.fallYaw), 0, Math.cos(cut.fallYaw)], upper: NOTCH.upper, lower: NOTCH.lower, cuts};
}

// ---- Felling: hinge at the exact cut height, rotating about the back edge, rigid-body ODE integrated per tick.
const fallTables = new Map();
function fallTable(length, end) {
 const key = `${length.toFixed(3)}:${end.toFixed(4)}`; let table = fallTables.get(key); if (table) return table;
 // theta'' = 3g/(2L) sin(theta) for a uniform rod about its base; small hinge "creak" start angle.
 table = [0]; let a = .03, w = 0; const k = 3*9.81/(2*Math.max(1, length)), dt = 1/TREE_LIMITS.hz;
 while (a < end && table.length < TREE_LIMITS.maxFallTicks) { w += k*Math.sin(a)*dt; a = Math.min(end, a + w*dt); table.push(a); }
 table.push(end); if (fallTables.size > 256) fallTables.clear(); fallTables.set(key, table); return table;
}
/** Terrain-aware rest angle for the upper section. ground(x,z) is the world terrain function. */
export function landingAngle(tree, cut, floor, ground) {
 const h = cutLocalHeight(tree, cut, floor), length = tree.height - h, dir = [-Math.sin(cut.fallYaw), -Math.cos(cut.fallYaw)];
 for (let angle = .5; angle < 1.9; angle += .015) for (const f of [.35, .65, .95]) {
  const d = length*f*Math.sin(angle), x = tree.x + dir[0]*d, z = tree.z + dir[1]*d, r = f > .6 ? Math.min(.9, tree.height*.12) : trunkRadius(tree, h);
  if (floor + h + length*f*Math.cos(angle) - r <= ground(x, z)) return angle;
 }
 return 1.9;
}
/** Pose of a felled tree at an integer sim tick. Pure; identical for live and late-join clients. */
export function treeFall(tree, cut, tick, floor, ground) {
 const h = cutLocalHeight(tree, cut, floor), end = landingAngle(tree, cut, floor, ground), table = fallTable(tree.height - h, end);
 const age = Math.max(0, tick - cut.felledTick), landTicks = table.length - 1;
 const i0 = Math.min(Math.floor(age), landTicks), i1 = Math.min(i0 + 1, landTicks); // fractional ticks interpolate for render
 let angle = table[i0] + (table[i1] - table[i0])*(age - i0 > 0 && i0 < landTicks ? age - i0 : 0), shake = 0, phase = age < landTicks ? 'falling' : 'down';

 const r = trunkRadius(tree, h), axis = [-Math.cos(cut.fallYaw), 0, Math.sin(cut.fallYaw)], direction = [-Math.sin(cut.fallYaw), 0, -Math.cos(cut.fallYaw)];
 // Hinge line passes through the back edge of the trunk (opposite the notch), exactly at the cut height.
 return {height: h, angle, end, age, phase, shake, landTicks, doneTicks: landTicks, axis, direction, hinge: [direction[0]*r, h, direction[2]*r]};
}

/** Contiguous authored trunk sections. Lower notches retain more usable wood (2–5 logs). */
export function timberSections(tree, cut, floor) {
 const scale=treeScale(tree), low=cutLocalHeight(tree,cut,floor)/scale;
 const high=treeProfile(tree).rings.at(-1)[0], count=clamp(Math.ceil((high-low)/.65),2,5);
 return Array.from({length:count},(_,i)=>{const a=low+(high-low)*i/count,b=low+(high-low)*(i+1)/count;
  return {section:[a,b],length:(b-a)*scale,radius:trunkRadius(tree,a*scale),center:(a+b)*scale/2};});
}
export const logLength=log=>log.length??TREE_LIMITS.logLength;
export const logRadius=log=>log.radius??TREE_LIMITS.logRadius;
/** Exact rigid transform used both by the falling mesh and its released trunk sections. */
export function timberPose(tree,fall,floor,center) {
 const q=[...fall.axis.map(n=>n*Math.sin(fall.end/2)),Math.cos(fall.end/2)];
 const v=rotateVector([-fall.hinge[0],center-fall.hinge[1],-fall.hinge[2]],q);
 return {quaternion:q,position:[tree.x+fall.hinge[0]+v[0],floor+fall.hinge[1]+v[1],tree.z+fall.hinge[2]+v[2]]};
}

// ---- Chop decision (simulation-owned). Returns {code} on failure or {events}.
export function chopTree(state, tree, point, normal, ctx) {
 if (!vec(point) || !vec(normal, 1.01)) return {code: 'invalid_action'};
 const floor = ctx.terrainHeight(tree.x, tree.z), local = point[1] - floor, dx = point[0]-tree.x, dz = point[2]-tree.z, d = Math.hypot(dx, dz);
 if (local < -.2 || local > tree.height + .2 || d > trunkRadius(tree, clamp(local, 0, tree.height)) + TREE_LIMITS.chopSlack + .2) return {events: []};
 let h = state.harvestedTrees.find(t => t.id === tree.id);
 if (h && isFelled(h)) return {events: []};
 const s = treeScale(tree), inRange = local >= CUT_RANGE[0]*s - .15 && local <= CUT_RANGE[1]*s + .15;
 const glance = {kind: 'wood_hit', position: [...point], id: tree.id, material: 'wood', normal: [...normal], glance: true};
 if (!inRange) return {events: [glance]};                                          // limbs/roots: feedback only, no wound
 if (!h) { if (state.harvestedTrees.length >= 256) return {code: 'world_limit'}; h = {id: tree.id, cuts: 0, cutHeight: point[1], felledTick: 0, fallYaw: d > .001 ? Math.atan2(dx, dz) : 0, landed: false}; state.harvestedTrees.push(h); }
 else if (Math.abs(h.cutHeight - point[1]) > TREE_LIMITS.notchTolerance) return {events: [glance]}; // the persisted wound stays
 h.cuts++;
 const events = [{kind: 'wood_hit', position: [...point], id: tree.id, material: 'wood', normal: [...normal], cuts: h.cuts}];
 if (h.cuts >= 3) { h.cuts = 3; h.felledTick = Math.max(1, state.tick); h.landed = false; events.push({kind: 'tree_fell', position: [tree.x, floor, tree.z], id: tree.id, yaw: h.fallYaw,
  landTicks: treeFall(tree, h, h.felledTick, floor, ctx.terrainHeight).landTicks}); } // exact touchdown tick for presentation (audio), pure + cached
 return {events};
}

// ---- Spatial index + character collision against trunks/stumps only (never canopy AABBs).
// Count of wave trees that have appeared so far, so the index rebuilds as each one rises.
const waitingTrees = state => { let n = 0; for (const g of state.groves || []) for (const t of g.trees || []) if ((t[4] ?? 0) <= (state.tick ?? Infinity)) n++; return n; };
export function createTreeIndex(cell = TREE_LIMITS.cell) {
 let key = '', trees = [], grid = new Map(), byId = new Map();
 const k = (i, j) => `${i},${j}`;
 return {
  update(state) { const next = `${state.seed}|${!!state.landmarks}|${JSON.stringify(state.groves || [])}|${waitingTrees(state)}|${(state.awakenedTrees || []).map(t => t.id).join()}|${(state.wildTrees || []).map(t => t.id).join()}|${JSON.stringify(state.treeRoots || [])}`; if (next === key) return false; key = next; trees = worldTrees(state); grid = new Map(); byId = new Map(trees.map(t => [t.id, t]));
   for (const t of trees) { const c = k(Math.floor(t.x/cell), Math.floor(t.z/cell)); if (!grid.has(c)) grid.set(c, []); grid.get(c).push(t); } return true; },
  all: () => trees, get: id => byId.get(id),
  near(x, z, out = []) { out.length = 0; const ci = Math.floor(x/cell), cj = Math.floor(z/cell); for (let i = ci-1; i <= ci+1; i++) for (let j = cj-1; j <= cj+1; j++) { const g = grid.get(k(i, j)); if (g) for (const t of g) out.push(t); } return out; }
 };
}
const scratch = [];
/** Push a character capsule (feet at position) out of trunks/stumps. cuts: Map id->harvest record. */
export function resolveTrees(position, index, cuts, ground, radius = .28, bodyHeight = 1.6) {
 for (let pass = 0; pass < 2; pass++) for (const tree of index.near(position[0], position[2], scratch)) {
  // Conservative horizontal bound before terrain sampling. Exact tapered trunk
  // contact below remains unchanged, including both separation passes.
  const maxRadius=widestRing.get(treeProfile(tree))*treeScale(tree)+radius;
  if(Math.abs(position[0]-tree.x)>=maxRadius||Math.abs(position[2]-tree.z)>=maxRadius)continue;
  const cut = cuts.get(tree.id); if (cut?.awake) continue; // the stump is off walking (shared/stumplings.js)
  const floor = ground(tree.x, tree.z), top = isFelled(cut) ? cutLocalHeight(tree, cut, floor) : treeProfile(tree).firstLimb*treeScale(tree);
  if (position[1] >= floor + top - .03 || position[1] + bodyHeight < floor) continue;
  const yLocal = clamp(position[1] - floor + .3, .3, top), dx = position[0]-tree.x, dz = position[2]-tree.z, d = Math.hypot(dx, dz), r = trunkRadius(tree, yLocal) + radius;
  if (d < r) { const ux = d > 1e-5 ? dx/d : 1, uz = d > 1e-5 ? dz/d : 0; position[0] = tree.x + ux*(r+.001); position[2] = tree.z + uz*(r+.001); }
 }
 return position;
}

// The host retains physical-effort proof only for this live hold. Save/import cannot manufacture a bonus.
const gripProof = new WeakMap();
export const POUCH_RULES = Object.freeze({wood: 2, radius: .35, grabReach: .45, minTicks: 12, minTravel: .25, maxInputAge: 12});
/** Pouch centre is a world-aligned local offset from the player's feet, like replicated hand poses. */
export function waistPouchPosition(player) {
 const y = clamp((player.head?.position?.[1] || 1.65)*.55, .55, 1.05), yaw=player.yaw||0;
 return [.28*Math.cos(yaw)-.12*Math.sin(yaw), y, -.28*Math.sin(yaw)-.12*Math.cos(yaw)];
}
const trackedHand = (state,p,hand) => p.head && p.hands?.[hand] && Number.isInteger(p.inputTick) && state.tick-p.inputTick <= POUCH_RULES.maxInputAge && state.tick>=p.inputTick ? p.hands[hand].position : null;
function forgetGrip(state,log) { gripProof.get(state)?.delete(log.id); }
export function collectLog(state,p,log,amount=1) {
 if ((p.resources?.wood??0)+amount>999) return {ok:false,code:'inventory_full',events:[]};
 const index=state.looseLogs.indexOf(log);if(index<0)return {ok:false,code:'invalid_target',events:[]};
 p.resources.wood+=amount;(p.stats??={kills:0,deaths:0,harvested:0,contribution:0}).harvested=Math.min(1e9,(p.stats.harvested||0)+amount);state.looseLogs.splice(index,1);forgetGrip(state,log);
 return {ok:true,events:[{kind:'pickup',id:log.id,position:[...log.position],material:'wood',amount,physicalBonus:amount>1}]};
}

// ---- Logs: retained trunk sections, cap 48, sleeping, explicit grab/drop/throw/collect.
const heldPose = (holder) => { const hand = holder.hands?.[1] || holder.hands?.[0];
 if (hand && vec(hand.position, 5) && Array.isArray(hand.quaternion) && hand.quaternion.length === 4) return {position: holder.position.map((n, i) => n + hand.position[i]), quaternion: [...hand.quaternion]};
 // Carried crosswise in front of the chest: log +Y axis along the player's right vector.
 return {position: [holder.position[0]-Math.sin(holder.yaw)*.75, holder.position[1]+1.1, holder.position[2]-Math.cos(holder.yaw)*.75], quaternion: horizontalLogQuat(holder.yaw)};
};
function horizontalLogQuat(yaw) { // long axis (+Y) laid horizontal, perpendicular to fall direction: rotate +Y onto axis a=(cos yaw,0,-sin yaw)
 const a = [Math.cos(yaw), 0, -Math.sin(yaw)], c = [a[2], 0, -a[0]], s = Math.SQRT1_2; // Y x a, normalised (|a|=1, a.y=0)
 const ql = Math.hypot(c[0], c[2]) || 1; return [c[0]/ql*s, 0, c[2]/ql*s, s];
}
export function logSupport(log, ground) {
 const half = Math.max(.001,logLength(log)/2 - logRadius(log)), axis = rotateVector([0, half, 0], log.quaternion);
 let best = -Infinity; for (const sgn of [-1, 0, 1]) best = Math.max(best, ground(log.position[0]+axis[0]*sgn, log.position[2]+axis[2]*sgn) - axis[1]*sgn + logRadius(log));
 return best;
}
export function releaseLog(state, player, direction = [0,0,0], throwing = false) {
 const log = state.looseLogs?.find(l => l.heldBy === player.id); if (!log) return false;
 forgetGrip(state,log); log.heldBy = null; log.sleeping = false; log.velocity = throwing ? direction.map((n, i) => n*8 + (i === 1 ? 1.5 : 0)) : [0, 0, 0]; log.angularVelocity = throwing ? [2, 3, 1] : [0, 0, 0]; return true;
}
/** Handles log messages. Returns null when the message is not about logs. */
export function logAction(state, p, m) {
 state.looseLogs ||= []; const held = state.looseLogs.find(l => l.heldBy === p.id);
 if(m.action==='stowLog') {
  if(p.role!=='hero')return {ok:false,code:'role_required',events:[]};
  if(!held||m.id!==held.id)return {ok:false,code:'invalid_target',events:[]};
  const proof=gripProof.get(state)?.get(held.id),hand=proof&&trackedHand(state,p,proof.hand);
  if(!proof||proof.player!==p.id||!hand||state.tick-proof.tick<POUCH_RULES.minTicks||distance(hand,proof.start)<POUCH_RULES.minTravel||distance(hand,waistPouchPosition(p))>POUCH_RULES.radius)return {ok:false,code:'invalid_pouch',events:[]};
  return collectLog(state,p,held,POUCH_RULES.wood);
 }
 if (m.action === 'release') { if (!held) return null; const dir = m.direction ?? [-Math.sin(p.yaw), 0, -Math.cos(p.yaw)];
  if (!vec(dir, 1.01) || Math.abs(Math.hypot(...dir) - 1) > .1 || (m.throw !== undefined && typeof m.throw !== 'boolean')) return {ok: false, code: 'invalid_action', events: []};
  releaseLog(state, p, dir, m.throw === true); return {ok: true, events: [{kind: m.throw ? 'log_throw' : 'log_drop', id: held.id, position: [...held.position]}]}; }
 if (m.action === 'grab' && typeof m.id === 'string' && m.id.startsWith('log')) { const log = state.looseLogs.find(l => l.id === m.id);
  if (!log) return {ok: false, code: 'invalid_target', events: []};
  const eye = p.position.map((n, i) => n + (i === 1 ? 1.1 : 0)), reachFrom = heldPose(p).position;
  if (p.role !== 'hero' || log.heldBy || held || (state.detachedParts || []).some(d => d.heldBy === p.id) || Math.min(capsuleDistance(log, eye), capsuleDistance(log, reachFrom)) > TREE_LIMITS.reach) return {ok: false, code: 'out_of_reach', events: []};
  if(m.interaction==='vr-grip') {
   const hand=m.hand===1?trackedHand(state,p,1):null;
   if(!hand||capsuleDistance(log,p.position.map((n,i)=>n+hand[i]))>POUCH_RULES.grabReach)return {ok:false,code:'out_of_reach',events:[]};
   if(!gripProof.has(state))gripProof.set(state,new Map());
   gripProof.get(state).set(log.id,{player:p.id,hand:1,tick:state.tick,start:[...hand]});
  } else forgetGrip(state,log);
  log.heldBy = p.id; log.sleeping = false; log.velocity = [0, 0, 0]; log.angularVelocity = [0, 0, 0]; return {ok: true, events: [{kind: 'grab', id: log.id, position: [...log.position]}]}; }
 if (m.action === 'interact' && held) return collectLog(state,p,held); // desktop stow grants the base amount
 if (held && ['strike', 'fire', 'flame', 'pour', 'special', 'grab'].includes(m.action)) return {ok: false, code: 'hands_full', events: []};
 return null;
}
/** Distance from a point to a log's capsule surface (0 inside). */
export function capsuleDistance(log, point) {
 const half = Math.max(.001,logLength(log)/2 - logRadius(log)), a = rotateVector([0, half, 0], log.quaternion);
 const v = [point[0]-log.position[0], point[1]-log.position[1], point[2]-log.position[2]], t = clamp((v[0]*a[0]+v[1]*a[1]+v[2]*a[2])/(half*half), -1, 1);
 return Math.max(0, Math.hypot(v[0]-a[0]*t, v[1]-a[1]*t, v[2]-a[2]*t) - logRadius(log));
}

/** One sim tick: release matching trunk sections at first touchdown, then integrate awake logs. ctx: {terrainHeight(state,x,z), nextId(state,prefix), makePickup?(kind,x,z,amount)} */
export function stepTrees(state, ctx, index, events) {
 state.looseLogs ||= []; index.update(state);
 const ground = (x, z) => ctx.terrainHeight(state, x, z);
 for (const cut of state.harvestedTrees) {
  if (!isFelled(cut) || cut.landed) continue; const tree = index.get(cut.id); if (!tree) continue;
  const floor = ground(tree.x, tree.z), fall = treeFall(tree, cut, state.tick, floor, ground);
  if (fall.age < fall.landTicks) continue;
  // Release at first contact. The exact authored trunk sections become physical logs without moving/reorienting.
  cut.landed = true; const sections=timberSections(tree,cut,floor), room=Math.min(sections.length,Math.max(0,TREE_LIMITS.logs-state.looseLogs.length));
  for (const [i,piece] of sections.slice(0,room).entries()) {
   const pose=timberPose(tree,fall,floor,piece.center);
   state.looseLogs.push({id:ctx.nextId(state,'log'),sourceId:tree.id,...pose,section:piece.section,length:piece.length,radius:piece.radius,
    velocity:[fall.direction[0]*(.35+i*.12)+fall.axis[0]*(i%2?.55:-.55),.4+i*.12,fall.direction[2]*(.35+i*.12)+fall.axis[2]*(i%2?.55:-.55)],angularVelocity:fall.axis.map(n=>n*(.5+i*.12)),heldBy:null,bornTick:state.tick,sleeping:false});
  }
  const rest=sections.length-room;
  if(rest>0)ctx.makePickup?.('wood',tree.x+fall.direction[0]*1.5,tree.z+fall.direction[2]*1.5,rest);
  events.push({kind: 'tree_land', id: tree.id, position: [tree.x + fall.direction[0]*2, ground(tree.x + fall.direction[0]*2, tree.z + fall.direction[2]*2), tree.z + fall.direction[2]*2], material: 'wood', normal: [0, 1, 0], logs: room});
 }
 const awake = [];
 for (const log of state.looseLogs) {
  const holder = log.heldBy && state.players.find(p => p.id === log.heldBy && p.role === 'hero');
  if (log.heldBy && !holder) { forgetGrip(state,log); log.heldBy = null; log.sleeping = false; }
  if (holder) { const pose = heldPose(holder); log.position = pose.position; log.quaternion = pose.quaternion; log.velocity = [0, 0, 0]; log.angularVelocity = [0, 0, 0]; continue; } // rigid: no lag/bend
  if (log.sleeping || log.bornTick===state.tick) continue;
  awake.push(log); const dt = 1/TREE_LIMITS.hz;
  log.velocity[1] -= TREE_LIMITS.gravity*dt;
  for (let i = 0; i < 3; i++) log.position[i] = clamp(log.position[i] + log.velocity[i]*dt, i === 1 ? -150 : -TREE_LIMITS.worldHalf, i === 1 ? 150 : TREE_LIMITS.worldHalf);
  const [x, y, z, w] = log.quaternion, [a, b, c] = log.angularVelocity, q = [x+(a*w+b*z-c*y)*dt/2, y+(b*w+c*x-a*z)*dt/2, z+(c*w+a*y-b*x)*dt/2, w-(a*x+b*y+c*z)*dt/2], len = Math.hypot(...q); log.quaternion = q.map(n => n/len);
  const support = logSupport(log, ground);
  if (log.position[1] <= support) { const speed = -log.velocity[1]; log.position[1] = support; log.velocity[1] = speed > 1 ? speed*.22 : 0; log.velocity[0] *= .82; log.velocity[2] *= .82; log.angularVelocity = log.angularVelocity.map(n => n*.8);
   const axis = rotateVector([0, 1, 0], log.quaternion); // gravity tips an upright log over; broadside logs damp out
   if (Math.abs(axis[1]) > .1) { log.angularVelocity[0] += axis[2]*axis[1]*.9; log.angularVelocity[2] -= axis[0]*axis[1]*.9; }
   if (speed > 1.2) events.push({kind: 'log_bounce', id: log.id, position: [...log.position], material: 'wood', normal: [0, 1, 0]});
   if (Math.hypot(...log.velocity) < .08 && Math.hypot(...log.angularVelocity) < .05 && Math.abs(axis[1]) < .35) { log.sleeping = true; log.velocity = [0, 0, 0]; log.angularVelocity = [0, 0, 0]; }
  }
 }
 // Awake-vs-any log separation (horizontal push between capsule segments). Sleeping pairs cost nothing.
 for (const log of awake) for (const other of state.looseLogs) { if (other === log || other.heldBy) continue;
  const gap = capsuleDistance(other, log.position) - logRadius(log); if (gap >= 0) continue;
  const dx = log.position[0]-other.position[0], dz = log.position[2]-other.position[2], d = Math.hypot(dx, dz) || 1; log.position[0] -= dx/d*gap*.5; log.position[2] -= dz/d*gap*.5; }
}

// ---- Strict save/restore.
export function restoreHarvested(saved, treeIds) {
 const out = [], seen = new Set(), list = saved.harvestedTrees ?? [];
 if (!Array.isArray(list) || list.length > 256) throw Error('Invalid harvested trees');
 for (const h of list) {
  if (!h || typeof h !== 'object' || typeof h.id !== 'string' || seen.has(h.id) || !treeIds.has(h.id) || !Number.isInteger(h.cuts) || h.cuts < 1 || h.cuts > 3 || !Number.isFinite(h.cutHeight) || Math.abs(h.cutHeight) > 200 || !Number.isInteger(h.felledTick) || h.felledTick < 0 || h.felledTick > saved.tick || (h.cuts === 3) !== (h.felledTick > 0) || !Number.isFinite(h.fallYaw) || Math.abs(h.fallYaw) > Math.PI + 1e-6 || (h.landed !== undefined && typeof h.landed !== 'boolean') || (h.landed && h.cuts !== 3)) throw Error('Invalid harvested tree');
  seen.add(h.id);
  // Pre-log saves already awarded the 3-wood pickup at the final chop: treat them as landed so timber is never duplicated.
  out.push({id: h.id, cuts: h.cuts, cutHeight: h.cutHeight, felledTick: h.felledTick, fallYaw: h.fallYaw, landed: h.cuts === 3 ? (h.landed ?? true) : false});
 }
 return out;
}
export function restoreLogs(saved, ids) {
 if (saved.looseLogs !== undefined && (!Array.isArray(saved.looseLogs) || saved.looseLogs.length > TREE_LIMITS.logs)) throw Error('Invalid log limit');
 const holders = new Set((saved.detachedParts || []).filter(d => d.heldBy).map(d => d.heldBy)), trees = new Set([...worldTrees(saved), ...(saved.awakenedTrees || [])].map(t => t.id)); // ent timber names its awakened tree
 const KEYS = ['id', 'sourceId', 'position', 'quaternion', 'velocity', 'angularVelocity', 'heldBy', 'bornTick', 'sleeping', 'section', 'length', 'radius'];
 return (saved.looseLogs || []).map(log => {
  if (!log || typeof log !== 'object' || Object.keys(log).some(k => !KEYS.includes(k)) || typeof log.id !== 'string' || !/^log[0-9]+$/.test(log.id) || ids.has(log.id) || !trees.has(log.sourceId) || !vec(log.position) || Math.abs(log.position[0]) > 55 || Math.abs(log.position[2]) > 55 || !vec(log.velocity, 100) || !vec(log.angularVelocity, 30) || !Array.isArray(log.quaternion) || log.quaternion.length !== 4 || !log.quaternion.every(Number.isFinite) || Math.abs(Math.hypot(...log.quaternion) - 1) > .01 || !Number.isInteger(log.bornTick) || log.bornTick < 0 || log.bornTick > saved.tick || typeof log.sleeping !== 'boolean' || (log.heldBy !== null && (typeof log.heldBy !== 'string' || !saved.players?.some(p => p.id === log.heldBy && p.role === 'hero') || holders.has(log.heldBy)))) throw Error('Invalid physical log');
  if(log.section!==undefined && (!Array.isArray(log.section)||log.section.length!==2||!log.section.every(n=>Number.isFinite(n)&&n>=0&&n<=4)||log.section[1]<=log.section[0]||!Number.isFinite(log.length)||log.length<=0||log.length>4||!Number.isFinite(log.radius)||log.radius<=0||log.radius>1.5))throw Error('Invalid timber section');
  if(log.section===undefined&&(log.length!==undefined||log.radius!==undefined))throw Error('Invalid legacy log dimensions');
  ids.add(log.id); if (log.heldBy) holders.add(log.heldBy); return Object.fromEntries(KEYS.filter(k=>log[k]!==undefined).map(k => [k, structuredClone(log[k])]));
 });
}
