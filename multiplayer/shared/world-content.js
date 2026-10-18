import {thingLimit} from './world-extent.js';
import {worldFor} from './worldgen/registry.js';
import {activeChunks, chunkContent, generatedTree, isGeneratedTreeId} from './worldgen/content.js';
// Generated worlds: the live trees are the generated ones in the active chunks around Heroes, minus trees whose
// stumps have rotted away (state.wilds.felled). Memoised per world + window so repeated calls in a tick are cheap.
const wildsMemo = {key: '', trees: []};
export function wildsTreeKey(state) {
  const w = state.world; if (!w) return '';
  return `${w.seed}|${w.preset}|${w.size}|${activeChunks(state).map(c => c.join(',')).join(';')}|${(state.wilds?.felled || []).length}:${state.wilds?.felledRev || 0}`;
}
function wildsTrees(state) {
  const key = wildsTreeKey(state);
  if (key !== wildsMemo.key) {
    const world = worldFor(state), gone = new Set((state.wilds?.felled || []).map(f => f[0])), out = [];
    for (const [cx, cz] of activeChunks(state)) for (const t of chunkContent(world, cx, cz).trees) if (!gone.has(t.id)) out.push(t);
    wildsMemo.key = key; wildsMemo.trees = out;
  }
  return wildsMemo.trees.map(t => ({id: t.id, x: t.x, z: t.z, height: t.height, variant: t.variant}));
}
/** Every tree id a save may name: the live list, plus (in generated worlds) any well-formed generated tree id. */
export function treeIdSet(saved) {
  const ids = new Set(worldTrees(saved).map(t => t.id)), world = saved.world ? worldFor(saved) : null;
  return {has: id => ids.has(id) || !!world && isGeneratedTreeId(id) && !!generatedTree(world, id), get size() { return ids.size; }, live: ids};
}
import {HOME,HOME_SITES,NEUTRAL_TAVERN} from './home-bases.js';
import {keepCarve,inKeepApproach} from './keep-sites.js';
// The keeps (with their carved bowl, pass and hollow) and the shared tavern's yard stay clear of wild trees and new ore.
const insideHome=(x,z,margin=0)=>keepCarve(x,z)>.02||Object.values(HOME_SITES).some(([a,b])=>Math.hypot(x-a,z-b)<HOME.domeRadius+margin)||Math.hypot(x-NEUTRAL_TAVERN.at[0],z-NEUTRAL_TAVERN.at[1])<8+margin;
import {clearLandmarkTrees,STARTING_SITES} from './starting-world.js';
import {DEPOSIT_CATALOG} from './material-catalog.js';
import {MAP_EXTRAS, moved} from './map-layout.js';
// Deterministic world presentation data.  This file deliberately has no clock or RNG.
const hash = (seed, n) => { let x = (seed ^ Math.imul(n + 1, 0x9e3779b9)) >>> 0; x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13; return x >>> 0; };
// Starting trees and ore can be moved by the local map editor (shared/map-layout.js), keyed by their ids.
export const baseTrees = [
  [-2, 6, 5.8], [1.8, 6.5, 6.4], [-3.5, 9, 5.2], [3.7, 9.4, 6.1], [0, 11.5, 6.8],
  [-12, -9, 7], [14, -12, 6.5], [-17, 17, 7.2], [21, 16, 5.6], [-24, 4, 6.4], [25, 2, 6.8]
].map(([x, z, h], i) => [...moved(`tree${i + 1}`, [x, z]), h])
  .concat(MAP_EXTRAS.filter(e => e.kind === 'tree').map(e => [e.x, e.z, e.height ?? 6.2]));
export const initialDeposits = () => [
  [-5, 5, 'stone'], [5, 5, 'stone'], [-7, 10, 'stone'], [7, 10, 'stone'], [0, 14, 'stone'],
  [-8, 3, 'iron'], [8, 3, 'iron'], [9, -8, 'iron'], [-16, -7, 'iron'],
  [-27, -6, 'mithril'], [27, 6, 'mithril'], [18, -24, 'crystal'], [-19, 23, 'crystal']
].map(([x,z,kind], i) => [...moved(`ore${i + 1}`, [x, z]), kind]).concat(MAP_EXTRAS.filter(e => DEPOSIT_CATALOG[e.kind]).map(e => [e.x, e.z, e.kind])).map(([x,z,kind], i) => ({id: `ore${i + 1}`, x, z, kind, hits: 0, maxHits: DEPOSIT_CATALOG[kind].maxHits, depleted: false}));

/** A new visible seam rises every two minutes. Existing depleted rocks stay depleted.
 * Root calls once per simulation tick; deterministic time bucket/id prevents replay duplication.
 * Skip occupied/protected ground and places a player is watching at close range.
 */
export function renewGeology(state,ctx,events=[]){
 if(!Number.isSafeInteger(state.tick)||state.tick<=0||state.tick%7200||!(state.players||[]).length||!Array.isArray(state.deposits)||state.deposits.length+(state.pendingStarfalls?.length||0)>=80)return false;
 const cycle=state.tick/7200,id=`renewal${cycle}`;
 if(state.deposits.some(d=>d.id===id))return false;
 const kinds=['stone','iron','crystal','stone','iron','mithril'],kind=kinds[(cycle-1)%kinds.length];
 for(let attempt=0;attempt<16;attempt++){
  const survey=(state.inventions?.structures||[]).find(b=>b.type==='prospector'&&b.hp>0&&state.inventions.surveyTick>state.tick-7200);
  const h=hash(state.seed,cycle*17+attempt),angle=(h%6283)/1000,radius=survey?7+((h>>>12)%7):18+((h>>>12)%20),x=+((survey?.position[0]||0)+Math.cos(angle)*radius).toFixed(3),z=+((survey?.position[2]||0)+Math.sin(angle)*radius).toFixed(3);
  if(Math.abs(x)>43||Math.abs(z)>43)continue;
  if((state.battle?.v===2&&insideHome(x,z,2))||inKeepApproach(x,z))continue;
  if((state.players||[]).some(p=>p.role==='hero'&&Math.hypot(p.position[0]-x,p.position[2]-z)<10)||state.deposits.some(d=>Math.hypot(d.x-x,d.z-z)<3)||(state.landmarks&&STARTING_SITES.some(s=>Math.hypot(s.x-x,s.z-z)<s.radius+2))||(state.structures||[]).some(b=>Math.hypot((b.x??b.position?.[0]??0)-x,(b.z??b.position?.[2]??0)-z)<5)||ctx.canPlace?.(x,z)===false)continue;
  const y=ctx.terrainHeight(state,x,z);if(!Number.isFinite(y)||Math.abs(y)>180)continue;
  state.deposits.push({id,x,z,kind,hits:0,maxHits:DEPOSIT_CATALOG[kind].maxHits,depleted:false});
  events.push({kind:'geology_emerge',id,material:DEPOSIT_CATALOG[kind].resource,position:[x,y,z],tick:state.tick});return true;
 }
 return false;
}
export function worldTrees(state) {
  const trees = state.world ? wildsTrees(state) : baseTrees.map(([x,z,height], i) => ({id: `tree${i + 1}`, x, z, height, variant: i % 3}));
  if (!state.world) for (let i = 0; i < 14; i++) { const h = hash(state.seed, i); const a = (h % 6283) / 1000; const r = 25 + ((h >>> 12) % 25); trees.push({id:`outer${i + 1}`, x:+(Math.cos(a)*r).toFixed(3), z:+(Math.sin(a)*r).toFixed(3), height:5 + (h % 30)/10, variant:(h>>>8)%3}); }
  if(state.landmarks&&!state.world) trees.splice(0,trees.length,...clearLandmarkTrees(trees));
  // Home-base worlds keep both domes clear of wild trees (shared/home-bases.js).
  if(state.battle?.v===2) trees.splice(0,trees.length,...trees.filter(t=>!insideHome(t.x,t.z,2)));
  for (const g of state.groves || []) {
    // Growth spells store where each tree actually took root (shared/grove-growth.js); a wave's trees appear in order.
    if (g.trees) { g.trees.forEach((t, i) => { if ((t[4] ?? 0) <= (state.tick ?? Infinity)) trees.push({id:`${g.id}-tree${i}`,x:t[0],z:t[1],height:t[2],variant:t[3]}); }); continue; }
    // Groves saved before adaptive placement keep their original fixed pattern.
    const count = g.kind === 'ring' ? 8 : 5; for (let i=0;i<count;i++) { const a = i * Math.PI * 2 / count; const r = g.kind === 'ring' ? 4 : 2.5; trees.push({id:`${g.id}-tree${i}`,x:+(g.x+Math.cos(a)*r).toFixed(3),z:+(g.z+Math.sin(a)*r).toFixed(3),height:5.5+(i%2),variant:i%3}); }
  }
  // Ents (shared/ents.js): an awakened tree leaves the world while it walks; a rooted ent is a new tree where it stood.
  const awake = state.awakenedTrees?.length ? new Set(state.awakenedTrees.map(t => t.id)) : null;
  const standing = awake ? trees.filter(t => !awake.has(t.id)) : trees;
  for (const w of state.wildTrees || []) standing.push({id:w.id,x:w.x,z:w.z,height:w.height,variant:w.variant});
  // A Stumpling carries its original tree identity to its final burrow location.
  if (state.treeRoots?.length) {
    const roots = new Map(state.treeRoots.map(t => [t.id, t]));
    for (const t of standing) { const root = roots.get(t.id); if (root) { t.x = root.x; t.z = root.z; } }
  }
  return standing;
}
/** Optional, bounded save extension; old worlds keep the deterministic original positions. */
export function restoreTreeRoots(saved) {
  const roots = saved.treeRoots ?? [];
  if (!Array.isArray(roots) || roots.length > 1024) throw Error('Invalid tree roots');
  const ids = treeIdSet({...saved, treeRoots: []}), seen = new Set();
  for (const root of roots) {
    if (!root || typeof root !== 'object' || Array.isArray(root) || Object.keys(root).some(k => !['id', 'x', 'z'].includes(k)) ||
      !ids.has(root.id) || seen.has(root.id) || !Number.isFinite(root.x) || !Number.isFinite(root.z) || Math.abs(root.x) > thingLimit() || Math.abs(root.z) > thingLimit()) throw Error('Invalid tree root');
    seen.add(root.id);
  }
  return roots.map(({id, x, z}) => ({id, x, z}));
}
