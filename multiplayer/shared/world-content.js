import {clearLandmarkTrees,STARTING_SITES} from './starting-world.js';
import {DEPOSIT_CATALOG} from './material-catalog.js';
// Deterministic world presentation data.  This file deliberately has no clock or RNG.
const hash = (seed, n) => { let x = (seed ^ Math.imul(n + 1, 0x9e3779b9)) >>> 0; x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13; return x >>> 0; };
export const baseTrees = [
  [-2, 6, 5.8], [1.8, 6.5, 6.4], [-3.5, 9, 5.2], [3.7, 9.4, 6.1], [0, 11.5, 6.8],
  [-12, -9, 7], [14, -12, 6.5], [-17, 17, 7.2], [19, 18, 5.6], [-24, 4, 6.4], [25, 2, 6.8]
];
export const initialDeposits = () => [
  [-5, 5, 'stone'], [5, 5, 'stone'], [-7, 10, 'stone'], [7, 10, 'stone'], [0, 14, 'stone'],
  [-8, 3, 'iron'], [8, 3, 'iron'], [9, -8, 'iron'], [-15, -10, 'iron'],
  [-28, -17, 'mithril'], [30, 14, 'mithril'], [18, -24, 'crystal'], [-19, 23, 'crystal']
].map(([x,z,kind], i) => ({id: `ore${i + 1}`, x, z, kind, hits: 0, maxHits: DEPOSIT_CATALOG[kind].maxHits, depleted: false}));

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
  const h=hash(state.seed,cycle*17+attempt),angle=(h%6283)/1000,radius=18+((h>>>12)%20),x=+(Math.cos(angle)*radius).toFixed(3),z=+(Math.sin(angle)*radius).toFixed(3);
  if((state.players||[]).some(p=>p.role==='hero'&&Math.hypot(p.position[0]-x,p.position[2]-z)<10)||state.deposits.some(d=>Math.hypot(d.x-x,d.z-z)<3)||(state.landmarks&&STARTING_SITES.some(s=>Math.hypot(s.x-x,s.z-z)<s.radius+2))||(state.structures||[]).some(b=>Math.hypot((b.x??b.position?.[0]??0)-x,(b.z??b.position?.[2]??0)-z)<5)||ctx.canPlace?.(x,z)===false)continue;
  const y=ctx.terrainHeight(state,x,z);if(!Number.isFinite(y)||Math.abs(y)>180)continue;
  state.deposits.push({id,x,z,kind,hits:0,maxHits:DEPOSIT_CATALOG[kind].maxHits,depleted:false});
  events.push({kind:'geology_emerge',id,material:DEPOSIT_CATALOG[kind].resource,position:[x,y,z],tick:state.tick});return true;
 }
 return false;
}
export function worldTrees(state) {
  const trees = baseTrees.map(([x,z,height], i) => ({id: `tree${i + 1}`, x, z, height, variant: i % 3}));
  for (let i = 0; i < 14; i++) { const h = hash(state.seed, i); const a = (h % 6283) / 1000; const r = 25 + ((h >>> 12) % 25); trees.push({id:`outer${i + 1}`, x:+(Math.cos(a)*r).toFixed(3), z:+(Math.sin(a)*r).toFixed(3), height:5 + (h % 30)/10, variant:(h>>>8)%3}); }
  if(state.landmarks) trees.splice(0,trees.length,...clearLandmarkTrees(trees));
  for (const g of state.groves || []) { const count = g.kind === 'ring' ? 8 : 5; for (let i=0;i<count;i++) { const a = i * Math.PI * 2 / count; const r = g.kind === 'ring' ? 4 : 2.5; trees.push({id:`${g.id}-tree${i}`,x:+(g.x+Math.cos(a)*r).toFixed(3),z:+(g.z+Math.sin(a)*r).toFixed(3),height:5.5+(i%2),variant:i%3}); } }
  return trees;
}
