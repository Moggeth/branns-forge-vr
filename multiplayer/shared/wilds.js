// The Great Wilds: the persistent seeded overworld mode (state.world.kind === 'wilds').
//
// Baseline vs changes: the world itself (terrain, rivers, trees, rocks, sites) is regenerated from state.world on
// every device. state.wilds holds only what players changed or found, so saves stay small and every device agrees:
//   felled   [[treeId, tick]...]   trees whose stumps have rotted away (old harvest records compacted, bounded)
//   spent    [[rockId, tick]...]   generated rocks mined out; they regrow after WILDS.regrowTicks
//   found    [siteId...]           settlements, regions, landmarks, discoveries and caves a Hero has reached
//   cleared  [siteId...]           camps/ruins whose guards were beaten (their cache paid out once)
//   guards   {siteId: [enemyId...]} encounters currently awake
// Everything is plain JSON, bounded, and validated in restoreWilds.
import {worldFor} from './worldgen/registry.js';
import {activeChunks, chunkContent, depositFor, isGeneratedRockId, isGeneratedTreeId, generatedRock, CHUNK} from './worldgen/content.js';
import {DEPOSIT_CATALOG, MATERIAL_KEYS} from './material-catalog.js';
import {registerWorldMode} from './world-modes.js';
import {sitesFromEntrances} from './underways/sites.js';

export const WILDS = Object.freeze({
  syncTicks: 20,                 // how often the live window of rocks is refreshed
  felledKeep: 4096, spentKeep: 4096, foundKeep: 2048,
  regrowTicks: 60 * 60 * 20,     // mined rocks and rotted stumps return after 20 minutes of play
  stumpTicks: 60 * 60 * 6,       // a felled, landed tree far from everyone rots to nothing after 6 minutes
  harvestSoftCap: 480,           // compaction starts once this many harvest records exist
  discoverRadius: 46,            // metres to "find" a site
  wakeRadius: 52,                // metres at which a camp's guards rise
  maxGuards: 24,
});
const DISCOVERY_XP = {settlement: 20, landmark: 25, discovery: 15, entrance: 20, region: 30};
// Guards by site kind and tier (tier 0 sites near the start are friendly practice).
const GUARDS = {
  camp: t => ['skeleton', 'skeleton', ...(t >= 2 ? ['skeleton'] : []), ...(t >= 3 ? ['golem'] : [])],
  ruin: t => ['skeleton', ...(t >= 1 ? ['skeleton'] : []), ...(t >= 2 ? ['skeleton', 'skeleton'] : []), ...(t >= 4 ? ['golem'] : [])],
  cache: t => t >= 2 ? ['skeleton', 'skeleton'] : [],
  shrine: t => t >= 3 ? ['golem'] : [],
  grove: () => [],
};
// Rewards: real materials, scaled by tier, so exploring pays for building and crafting.
const REWARDS = {
  camp: t => [['wood', 4 + 2 * t], ['ironOre', 2 + t], ['apple', 2]],
  ruin: t => [['stone', 4 + 2 * t], ['gems', 1 + t], ...(t >= 2 ? [['mithrilOre', t]] : [])],
  cache: t => [['copperOre', 2 + t], ['goldOre', t], ['gems', 1]],
  shrine: t => [['gems', 2 + t], ['starOre', 1 + (t >> 1)]],
  grove: () => [['apple', 4], ['wood', 3]],
};

/** Where Heroes first arrive: the village forge, or for an Underways start, outside the first cave (u0, the
 *  newcomer's tier-1 mine), a few steps back from its portal. */
const origins = new WeakMap();
export function wildsOrigin(state, world = worldFor(state)) {
  if (state.world?.kind !== 'underways' || !world) return [0, 0];
  let o = origins.get(world); if (o) return o;
  const e = world.entrances.find(x => x.id === 'u0') || world.entrances[0];
  if (!e) o = [0, 0];
  else { const s = sitesFromEntrances([e], (x, z) => world.heightAt(x, z))[0], fx = s.back[0] - s.mouth[0], fz = s.back[1] - s.mouth[1], k = 7 / (Math.sqrt(fx * fx + fz * fz) || 1); o = [s.mouth[0] + fx * k, s.mouth[1] + fz * k]; }
  origins.set(world, o); return o;
}

/** Which way a new Hero faces: toward the cave in an Underways start (three.js yaw, 0 faces -z), else north. */
export function wildsFacing(state, position, world = worldFor(state)) {
  if (state.world?.kind !== 'underways' || !world) return 0;
  const e = world.entrances.find(x => x.id === 'u0') || world.entrances[0]; if (!e) return 0;
  return Math.atan2(-(e.x - position[0]), -(e.z - position[2]));
}

export function createWilds() { return {v: 1, felled: [], spent: [], found: [], cleared: [], guards: {}, felledRev: 0}; }

/** Fill a fresh wilds state: spawn plaza supplies at the village forge. */
export function newWildsState(state, world, terrainHeight) {
  state.wilds = createWilds();
  state.landmarks = false;
  state.deposits = [];
  // Starting resources at the forge yard: enough for a first tool upgrade and a campfire, never a whole base.
  const supplies = [['wood', 6, -3.2, 4.2], ['stone', 4, 3.4, 4.4], ['apple', 3, -1.4, 6.2], ['ironOre', 2, 2.2, -4.6]], [ox, oz] = wildsOrigin(state, world);
  state.pickups = supplies.map(([kind, amount, x, z], i) => ({id: `wstart${i}`, kind, x: x + ox, z: z + oz, y: terrainHeight(state, x + ox, z + oz), amount}));
  syncWildsContent(state, world);
  return state;
}

/** Bring generated rocks in the live window into state.deposits; drop untouched ones that left it. */
export function syncWildsContent(state, world = worldFor(state)) {
  const w = state.wilds, live = new Set(), spent = new Set(w.spent.map(s => s[0]));
  for (const [cx, cz] of activeChunks(state)) for (const r of chunkContent(world, cx, cz).rocks) live.add(r.id);
  const have = new Set();
  state.deposits = state.deposits.filter(d => {
    if (!isGeneratedRockId(d.id)) return true;
    have.add(d.id);
    if (d.depleted) { if (!spent.has(d.id)) { w.spent.push([d.id, state.tick]); spent.add(d.id); } return live.has(d.id) && referenced(state, d.id); }
    return live.has(d.id) || d.hits > 0; // partly mined rocks stay until finished
  });
  const cap = 192 - (state.pendingStarfalls?.length || 0);
  for (const id of live) {
    if (have.has(id) || spent.has(id) || state.deposits.length >= cap) continue;
    const r = generatedRock(world, id); if (r) state.deposits.push(depositFor(r));
  }
  if (w.spent.length > WILDS.spentKeep) w.spent.splice(0, w.spent.length - WILDS.spentKeep);
}
const referenced = (state, id) => (state.embeds || []).some(e => e.targetId === id) || (state.fireSurfaces || []).some(e => e.targetId === id);

/** Host step, once per tick. ctx = {nextId, terrainHeight, createEnemy, grantXp}. */
export function stepWilds(state, ctx, events) {
  if (!state.world || !state.wilds) return;
  const world = worldFor(state), w = state.wilds;
  if (state.tick % WILDS.syncTicks === 0) {
    // Regrowth: spent rocks and rotted stumps return after a while (the world heals; keeps the change list bounded).
    const old = state.tick - WILDS.regrowTicks;
    if (w.spent.length && w.spent[0][1] < old) w.spent = w.spent.filter(s => s[1] >= old);
    if (w.felled.length && w.felled[0][1] < old) { w.felled = w.felled.filter(s => s[1] >= old); w.felledRev++; }
    compactHarvest(state, w);
    syncWildsContent(state, world);
  }
  if (state.tick % 15 === 0) discover(state, world, w, ctx, events);
  if (state.tick % 30 === 0) encounters(state, world, w, ctx, events);
}
// Landed trees nobody is near rot into state.wilds.felled, freeing harvest records (bounded snapshots).
function compactHarvest(state, w) {
  if (state.harvestedTrees.length < WILDS.harvestSoftCap) return;
  const heroes = state.players.filter(p => p.role === 'hero');
  const keep = [];
  for (const h of state.harvestedTrees) {
    const far = isGeneratedTreeId(h.id) && h.landed && state.tick - h.felledTick > WILDS.stumpTicks;
    if (far && !heroes.some(p => near(p.position, h, 120))) { w.felled.push([h.id, state.tick]); w.felledRev++; } else keep.push(h);
  }
  state.harvestedTrees = keep;
  if (w.felled.length > WILDS.felledKeep) w.felled.splice(0, w.felled.length - WILDS.felledKeep);
}
const near = (pos, h, r) => { const m = /^wt(-?\d+)_(-?\d+)_/.exec(h.id); if (!m) return true; const cx = (+m[1] + .5) * CHUNK, cz = (+m[2] + .5) * CHUNK; return Math.hypot(pos[0] - cx, pos[2] - cz) < r + CHUNK; };

/** Every findable place in a world (settlements, landmarks, discoveries, caves), for discovery and the guide card. */
export function sitesOf(world) {
  return [
    ...world.settlements.map(s => ({id: s.id, x: s.x, z: s.z, kind: 'settlement', name: s.name, sub: s.kind})),
    ...world.landmarks.map(l => ({id: l.id, x: l.x, z: l.z, kind: 'landmark', name: l.name, sub: l.kind})),
    ...world.discoveries.map(d => ({id: d.id, x: d.x, z: d.z, kind: 'discovery', name: d.name, sub: d.kind, tier: d.tier})),
    ...world.entrances.map(e => ({id: e.id, x: e.x, z: e.z, kind: 'entrance', name: e.name, sub: 'cave', tier: e.tier})),
  ];
}
function discover(state, world, w, ctx, events) {
  const found = new Set(w.found);
  for (const p of state.players) {
    if (p.role !== 'hero') continue;
    const [x, , z] = p.position;
    const region = world.regionAt(x, z);
    const hits = sitesOf(world).filter(s => !found.has(s.id) && Math.hypot(s.x - x, s.z - z) < WILDS.discoverRadius * (s.kind === 'landmark' && s.sub === 'peak' ? 2.5 : 1));
    if (region && !found.has(region.id)) hits.push({id: region.id, x, z, kind: 'region', name: region.name, sub: region.biome, tier: region.danger});
    for (const s of hits) {
      found.add(s.id); w.found.push(s.id);
      events.push({kind: 'wilds_discovery', id: s.id, site: s.kind, sub: s.sub, name: s.name, tier: s.tier ?? 0, by: p.id, position: [s.x, ctx.terrainHeight(state, s.x, s.z), s.z]});
      ctx.grantXp?.(state, p, DISCOVERY_XP[s.kind] || 10, events, p.position);
    }
  }
  if (w.found.length > WILDS.foundKeep) w.found.splice(0, w.found.length - WILDS.foundKeep);
}
function encounters(state, world, w, ctx, events) {
  const heroes = state.players.filter(p => p.role === 'hero' && p.hp > 0);
  const cleared = new Set(w.cleared);
  // Settle awake encounters: all guards gone -> cleared, cache pays out at the site.
  for (const [siteId, ids] of Object.entries(w.guards)) {
    const alive = ids.filter(id => state.enemies.some(e => e.id === id));
    if (alive.length) { w.guards[siteId] = alive; continue; }
    delete w.guards[siteId];
    const site = world.discoveries.find(d => d.id === siteId); if (!site || cleared.has(siteId)) continue;
    cleared.add(siteId); w.cleared.push(siteId);
    const loot = (REWARDS[site.kind] || REWARDS.camp)(site.tier);
    loot.forEach(([kind, amount], i) => {
      if (amount <= 0 || state.pickups.length >= 256 || (kind !== 'apple' && !MATERIAL_KEYS.includes(kind))) return;
      const a = i * 2.39996, x = site.x + Math.cos(a) * 1.4, z = site.z + Math.sin(a) * 1.4;
      state.pickups.push({id: ctx.nextId(state, 'p'), kind, x, z, y: ctx.terrainHeight(state, x, z), amount});
    });
    events.push({kind: 'wilds_cleared', id: siteId, name: site.name, tier: site.tier, position: [site.x, ctx.terrainHeight(state, site.x, site.z), site.z]});
  }
  // Wake guards at sites a Hero approaches.
  const awake = Object.values(w.guards).reduce((n, l) => n + l.length, 0);
  for (const site of world.discoveries) {
    if (cleared.has(site.id) || w.guards[site.id]) continue;
    if (!heroes.some(p => Math.hypot(p.position[0] - site.x, p.position[2] - site.z) < WILDS.wakeRadius)) continue;
    const kinds = (GUARDS[site.kind] || GUARDS.camp)(site.tier);
    if (!kinds.length) {
      // Unguarded sites (groves, easy caches) pay out as soon as they are reached.
      w.guards[site.id] = []; continue;
    }
    if (awake + kinds.length > WILDS.maxGuards || state.enemies.length + kinds.length > 64) continue;
    const ids = [];
    kinds.forEach((kind, i) => {
      const a = i * 2.39996 + 1, r = 2.5 + i * .6, x = site.x + Math.cos(a) * r, z = site.z + Math.sin(a) * r;
      const id = `wg_${site.id}_${i}`; if (state.enemies.some(e => e.id === id)) return;
      const e = ctx.createEnemy(id, [x, ctx.terrainHeight(state, x, z), z], kind);
      e.emergeTick = state.tick; state.enemies.push(e); ids.push(id);
    });
    w.guards[site.id] = ids;
    events.push({kind: 'wilds_ambush', id: site.id, name: site.name, tier: site.tier, count: ids.length, position: [site.x, ctx.terrainHeight(state, site.x, site.z), site.z]});
  }
}

const isPair = (v, re) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && re(v[0]) && Number.isSafeInteger(v[1]) && v[1] >= 0;
const SITE_ID = /^(s|d|u|g)\d{1,4}$|^(peak|lake|falls)-[A-Za-z0-9_-]{1,40}$/;
/** Strict copy of state.wilds from a save/checkpoint. Throws when malformed. */
export function restoreWilds(saved) {
  const v = saved.wilds;
  if (v === undefined) return createWilds();
  if (!v || typeof v !== 'object' || Array.isArray(v) || v.v !== 1) throw Error('Invalid wilds');
  const keys = ['v', 'felled', 'spent', 'found', 'cleared', 'guards', 'felledRev'];
  if (Object.keys(v).some(k => !keys.includes(k))) throw Error('Invalid wilds');
  const tick = saved.tick;
  if (!Array.isArray(v.felled) || v.felled.length > WILDS.felledKeep || !v.felled.every(f => isPair(f, isGeneratedTreeId) && f[1] <= tick)) throw Error('Invalid wilds felled');
  if (!Array.isArray(v.spent) || v.spent.length > WILDS.spentKeep || !v.spent.every(f => isPair(f, isGeneratedRockId) && f[1] <= tick)) throw Error('Invalid wilds spent');
  const ids = list => Array.isArray(list) && list.length <= WILDS.foundKeep && list.every(id => typeof id === 'string' && SITE_ID.test(id)) && new Set(list).size === list.length;
  if (!ids(v.found) || !ids(v.cleared)) throw Error('Invalid wilds sites');
  if (!v.guards || typeof v.guards !== 'object' || Array.isArray(v.guards) || Object.keys(v.guards).length > 64) throw Error('Invalid wilds guards');
  for (const [k, list] of Object.entries(v.guards)) if (!SITE_ID.test(k) || !Array.isArray(list) || list.length > 8 || !list.every(id => typeof id === 'string' && /^wg_[A-Za-z0-9_-]{1,56}$/.test(id))) throw Error('Invalid wilds guards');
  if (v.felledRev !== undefined && !Number.isSafeInteger(v.felledRev)) throw Error('Invalid wilds');
  return {v: 1, felled: v.felled.map(f => [...f]), spent: v.spent.map(f => [...f]), found: [...v.found], cleared: [...v.cleared],
    guards: Object.fromEntries(Object.entries(v.guards).map(([k, l]) => [k, [...l]])), felledRev: v.felledRev || 0};
}
export const wildsDepositKnown = id => isGeneratedRockId(id);
export {DEPOSIT_CATALOG};

registerWorldMode('wilds', {});
registerWorldMode('underways', {}); // the same overworld, entered at a cave (shared/underways/world.js lists its caves)
