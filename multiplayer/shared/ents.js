// Ents: standing trees the God awakens into walking, attackable creatures. Shared, deterministic rules only
// (no clock, no RNG, no Three.js). The awakened tree leaves the world while its ent walks; after ENT.rootTicks
// the ent roots where it stands and becomes a new tree. Killing one drops real timber as physical logs.
//
// Size comes from the tree: young trees wake as nimble saplings, mature trees as lumbering elders.
// Anatomy is in units of the ent's height and is mirrored by client/ent-view.js (model faces -Z, its left is -X).

export const ENT = Object.freeze({
 wakeTicks: 72,        // 1.2 s pulling free of the ground before it may move or strike
 rootTicks: 3600,      // 60 s after waking it roots where it stands
 rootWindTicks: 120,   // last 2 s: it stops and sinks its roots
 maxAwake: 12,         // live ents (performance ceiling; Quest/phone)
 awakenRadius: 8,      // Awaken: the nearest standing tree within this distance of the tap
 wildRadius: 7,        // Wild Awakening: standing trees inside this circle...
 wildCount: 3,         // ...up to this many, nearest first
 records: 160,         // awakened trees that must stay out of the world (and that their logs still name)
 wild: 64,             // trees ents have rooted
 forgeClear: 6,        // never root on the forge apron
});
export const ENT_SPELLS = Object.freeze(['awaken', 'wildwake']);
export const ENT_SIZES = Object.freeze({
 sapling: Object.freeze({height: 1.75, hp: 110, parts: Object.freeze({head: 60, torso: 110, leftArm: 40, rightArm: 40, leftLeg: 50, rightLeg: 50}),
  speed: 2.7, radius: .34, damage: 7, reach: 1.8, strike: 2.1, trunkLogs: 2, limbLogs: 0}),
 elder: Object.freeze({height: 3.4, hp: 300, parts: Object.freeze({head: 140, torso: 300, leftArm: 90, rightArm: 90, leftLeg: 110, rightLeg: 110}),
  speed: 1.15, radius: .62, damage: 20, reach: 2.4, strike: 2.7, trunkLogs: 3, limbLogs: 1}),
});
// Part centres (fraction of height, model space) and the authority's generous sanity envelope (also a fraction of height).
// Rendered triangles still decide every hit; the envelope only rejects contacts far from the limb, including mid-swing arms.
export const ENT_ANATOMY = Object.freeze({
 head: {c: [0, .80, 0], r: .34}, torso: {c: [0, .46, 0], r: .3},
 leftArm: {c: [-.26, .46, -.03], r: .46}, rightArm: {c: [.26, .46, -.03], r: .46},
 leftLeg: {c: [-.1, .16, 0], r: .3}, rightLeg: {c: [.1, .16, 0], r: .3},
});
export const YOUNG_VARIANT = 2; // tree_young
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export const entSizeFor = tree => tree.variant === YOUNG_VARIANT ? 'sapling' : 'elder';
export const entSpec = e => ENT_SIZES[e?.size] || ENT_SIZES.elder;
/** World height of this ent: its size class, nudged by the height of the tree it came from. */
export const entHeight = e => entSpec(e).height * clamp((e?.treeHeight ?? 6) / 6, .88, 1.12);
export const entRootTick = e => e.wakeTick + ENT.rootTicks;
export const entWaking = (e, tick) => tick - e.wakeTick < ENT.wakeTicks;
export const entRooting = (e, tick) => tick >= entRootTick(e) - ENT.rootWindTicks;

/** Standing trees a God may awaken: in the world and never notched by an axe. */
export function standingTrees(trees, harvested = []) {
 const cut = new Set(harvested.map(h => h.id));
 return trees.filter(t => !cut.has(t.id));
}
/** Trees a cast at `point` would wake, nearest first. Pure: the preview and the authority use the same answer. */
export function entTargets(trees, harvested, spell, point) {
 if (!Array.isArray(point) || !ENT_SPELLS.includes(spell)) return [];
 const radius = spell === 'awaken' ? ENT.awakenRadius : ENT.wildRadius, count = spell === 'awaken' ? 1 : ENT.wildCount;
 return standingTrees(trees, harvested).map(t => [t, Math.hypot(t.x - point[0], t.z - point[2])]).filter(([, d]) => d <= radius)
  .sort((a, b) => a[1] - b[1] || (a[0].id < b[0].id ? -1 : 1)).slice(0, count).map(([t]) => t);
}

export function createEnt(id, tree, position, tick) {
 const size = entSizeFor(tree), spec = ENT_SIZES[size];
 return {id, position, kind: 'ent', size, treeId: tree.id, variant: tree.variant, treeHeight: tree.height, wakeTick: tick,
  yaw: 0, hp: spec.hp, parts: {...spec.parts}, missingParts: [], attackTick: -1000};
}

/** Remember an awakened tree so worldTrees() leaves it out and its logs keep a valid source. */
export function rememberAwakened(state, tree, live) {
 state.awakenedTrees ||= []; state.wildTrees ||= [];
 const wild = state.wildTrees.findIndex(w => w.id === tree.id);
 if (wild >= 0) state.wildTrees.splice(wild, 1);
 if (state.awakenedTrees.length >= ENT.records) pruneAwakened(state, live);
 if (state.awakenedTrees.length >= ENT.records) return false;
 state.awakenedTrees.push({id: tree.id, x: tree.x, z: tree.z, height: tree.height, variant: tree.variant});
 return true;
}
/** Forget awakened trees nothing refers to any more. A forgotten base/grove tree stays gone (a new record is never made). */
export function pruneAwakened(state, live = state.enemies) {
 const used = new Set([...(live || []).filter(e => e.kind === 'ent').map(e => e.treeId), ...(state.looseLogs || []).map(l => l.sourceId)]);
 const keep = state.awakenedTrees.filter(t => used.has(t.id) || !t.id.endsWith('-tree'));
 // Base and grove tree records must stay so they never return; only re-rooted (-tree) ids are dropped when unused.
 state.awakenedTrees = keep;
}

/** Wood from a felled ent: trunk sections become physical logs where it fell; overflow becomes a wood pickup. */
export function dropEntTimber(state, ent, ctx, events, count, from = ent.position, spread = 1) {
 state.looseLogs ||= []; const spec = entSpec(ent), h = entHeight(ent);
 const room = Math.min(count, Math.max(0, ctx.logLimit - state.looseLogs.length)), ids = [];
 for (let i = 0; i < room; i++) {
  const a = ent.yaw + Math.PI / 2 + (i - (room - 1) / 2) * .9, ground = ctx.terrainHeight(state, from[0], from[2]);
  const position = [clamp(from[0] + Math.sin(a) * .35 * spread, -54.5, 54.5), Math.max(from[1], ground) + .25 + i * .22 * (spec === ENT_SIZES.elder ? 1 : .6) + h * .1, clamp(from[2] + Math.cos(a) * .35 * spread, -54.5, 54.5)];
  // Laid on its side: the log's long +Y axis rotated a quarter turn about a horizontal axis.
  const half = Math.SQRT1_2, yaw = ent.yaw + i * 1.3, quaternion = [Math.cos(yaw) * half, 0, Math.sin(yaw) * half, half];
  const log = {id: ctx.nextId(state, 'log'), sourceId: ent.treeId, position, quaternion, velocity: [Math.sin(a) * (.8 + i * .3), 1.4 + i * .35, Math.cos(a) * (.8 + i * .3)],
   angularVelocity: [Math.cos(a) * 1.4, .6 + i * .4, -Math.sin(a) * 1.4], heldBy: null, bornTick: state.tick, sleeping: false};
  state.looseLogs.push(log); ids.push(log.id);
 }
 if (count > room) ctx.makePickup?.('wood', from[0], from[2], count - room);
 return ids;
}

/** A severed branch arm drops as a log; roots and the crown splinter. Marks the limb missing. Returns the event. */
export function severEntLimb(state, ent, part, ctx) {
 if (ent.missingParts.includes(part) || part === 'torso') return null;
 ent.missingParts.push(part); ent.parts[part] = 0;
 state.embeds = (state.embeds || []).filter(e => !(e.targetId === ent.id && e.part === part));
 const at = entPartPosition(ent, part), spec = entSpec(ent);
 const logs = part.endsWith('Arm') && spec.limbLogs ? dropEntTimber(state, ent, ctx, [], spec.limbLogs, at, 1.6) : [];
 return {kind: 'ent_limb', id: ent.id, part, position: at, material: 'wood', size: ent.size, logs: logs.length};
}

export function entPartPosition(ent, part) {
 const a = (ENT_ANATOMY[part] || ENT_ANATOMY.torso).c, h = entHeight(ent), c = Math.cos(ent.yaw), s = Math.sin(ent.yaw);
 return [ent.position[0] + (a[0] * c + a[2] * s) * h, ent.position[1] + a[1] * h, ent.position[2] + (-a[0] * s + a[2] * c) * h];
}
export const entPartReach = (ent, part) => (ENT_ANATOMY[part] || ENT_ANATOMY.torso).r * entHeight(ent);

/**
 * Ents whose time has come root where they stand: they leave the enemy list and become a tree (wildTrees) that
 * worldTrees() includes. A spot that cannot hold a tree (forge apron, a trunk or structure too close, the wild-tree
 * cap) gets its timber instead. ctx: {terrainHeight(state,x,z), nextId, logLimit, makePickup, blocked(x,z)}.
 */
export function stepEntRooting(state, trees, ctx, events) {
 state.wildTrees ||= [];
 for (const e of [...state.enemies]) {
  if (e.kind !== 'ent' || state.tick < entRootTick(e)) continue;
  state.enemies.splice(state.enemies.indexOf(e), 1);
  state.embeds = (state.embeds || []).filter(m => m.targetId !== e.id);
  const x = +e.position[0].toFixed(3), z = +e.position[2].toFixed(3), y = ctx.terrainHeight(state, x, z);
  const crowded = Math.hypot(x, z) < ENT.forgeClear || Math.abs(x) > 51 || Math.abs(z) > 51 || trees.some(t => Math.hypot(t.x - x, t.z - z) < 1.6) ||
   state.wildTrees.some(t => Math.hypot(t.x - x, t.z - z) < 1.6) || state.wildTrees.length >= ENT.wild || !!ctx.blocked?.(x, z);
  if (crowded) {
   const logs = dropEntTimber(state, e, ctx, events, entSpec(e).trunkLogs);
   events.push({kind: 'ent_fade', id: e.id, position: [x, y, z], material: 'wood', size: e.size, logs: logs.length});
   continue;
  }
  const tree = {id: `${e.id}-tree`, x, z, height: e.treeHeight, variant: e.variant};
  state.wildTrees.push(tree);
  events.push({kind: 'ent_root', id: e.id, treeId: tree.id, position: [x, y, z], size: e.size, material: 'wood'});
 }
}

// ---- Strict save validation for the two tree lists (ids must be unique and must not collide with world trees).
const finite = n => typeof n === 'number' && Number.isFinite(n);
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
const validTree = t => t && typeof t === 'object' && !Array.isArray(t) && Object.keys(t).every(k => ['id', 'x', 'z', 'height', 'variant'].includes(k)) &&
 validId(t.id) && finite(t.x) && finite(t.z) && Math.abs(t.x) <= 55 && Math.abs(t.z) <= 55 && finite(t.height) && t.height >= 2 && t.height <= 12 && Number.isInteger(t.variant) && t.variant >= 0 && t.variant <= 2;
export function restoreEntTrees(saved) {
 const awakened = saved.awakenedTrees ?? [], wild = saved.wildTrees ?? [];
 if (!Array.isArray(awakened) || awakened.length > ENT.records || !Array.isArray(wild) || wild.length > ENT.wild) throw Error('Invalid ent trees');
 const ids = new Set();
 for (const t of [...awakened, ...wild]) { if (!validTree(t) || ids.has(t.id)) throw Error('Invalid ent tree'); ids.add(t.id); }
 const pick = ({id, x, z, height, variant}) => ({id, x, z, height, variant});
 return {awakenedTrees: awakened.map(pick), wildTrees: wild.map(pick)};
}
export function validEnt(e, saved, awakenedIds) {
 if (e.kind === 'stumpling') return true; // shared/stumplings.js validStumpling
 if (e.kind !== 'ent') return e.size === undefined && e.treeId === undefined && e.variant === undefined && e.treeHeight === undefined && e.wakeTick === undefined;
 const spec = ENT_SIZES[e.size];
 return !!spec && validId(e.treeId) && awakenedIds.has(e.treeId) && Number.isInteger(e.variant) && e.variant >= 0 && e.variant <= 2 &&
  finite(e.treeHeight) && e.treeHeight >= 2 && e.treeHeight <= 12 && Number.isSafeInteger(e.wakeTick) && e.wakeTick >= 0 && e.wakeTick <= saved.tick && saved.tick <= e.wakeTick + ENT.rootTicks;
}
