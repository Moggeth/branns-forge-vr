import assert from 'node:assert/strict';
import {MATERIAL_KEYS,MATERIAL_CATALOG,ORE_RECIPES,DEPOSIT_CATALOG,depositReward,restoreMaterials,emptyMaterials,materialLabel,bankKey} from '../shared/material-catalog.js';
import {initialDeposits,renewGeology} from '../shared/world-content.js';
import {createEnemy,hitEnemyPart,mineGolemRemains} from '../shared/combat.js';

assert.equal(materialLabel('gems'),'Crystal');assert.equal(materialLabel('crystal'),'Crystal');
assert.equal(materialLabel('wood'),'Timber');assert.equal(materialLabel('starMetal'),'Star metal');
for(const key of MATERIAL_KEYS){assert.ok(MATERIAL_CATALOG[key].use.length>12);assert.ok(MATERIAL_CATALOG[key].source.length>12);assert.ok(MATERIAL_CATALOG[key].recipes.length||MATERIAL_CATALOG[key].groundwork,`${key} needs a recipe or an explicit groundwork flag`);}
assert.deepEqual(restoreMaterials({wood:2,stone:3,gems:4}),{...emptyMaterials(),wood:2,stone:3,gems:4});
assert.equal(restoreMaterials({crystal:5}).gems,5);
// Old saves: carried or stored ore folds into its metal (one ore made one bar), capped at the pack limit.
assert.deepEqual(restoreMaterials({iron:3,ironOre:4,starOre:2,goldOre:1}),{...emptyMaterials(),iron:7,starMetal:2,gold:1});
assert.equal(restoreMaterials({iron:998,ironOre:5}).iron,999);
for(const ore of Object.keys(ORE_RECIPES))assert.equal(bankKey(ore),ORE_RECIPES[ore].output);
assert.equal(bankKey('wood'),'wood');assert.equal(bankKey('gems'),'gems');
for(const invalid of [NaN,Infinity,-1,1000,1.5,'2',null,undefined])assert.throws(()=>restoreMaterials({iron:invalid}));
assert.throws(()=>restoreMaterials([]));assert.throws(()=>restoreMaterials(null));
for(const [input,recipe]of Object.entries(ORE_RECIPES)){assert.ok(MATERIAL_KEYS.includes(input)&&MATERIAL_KEYS.includes(recipe.output));assert.equal(recipe.input,recipe.amount);assert.ok(recipe.ticks<=180);}
assert.deepEqual(depositReward('meteor'),{kind:'starOre',amount:2});assert.deepEqual(depositReward('crystal'),{kind:'gems',amount:4});assert.equal(depositReward('bogus'),null);assert.equal(depositReward('constructor'),null);
const deposits=initialDeposits();assert.equal(deposits.length,13);assert.equal(new Set(deposits.map(d=>d.id)).size,deposits.length);
assert.ok(deposits.filter(d=>d.kind==='iron'&&Math.hypot(d.x,d.z)<13).length>=3);
assert.ok(deposits.filter(d=>d.kind==='mithril').every(d=>Math.hypot(d.x,d.z)>25));
for(const d of deposits)assert.equal(d.maxHits,DEPOSIT_CATALOG[d.kind].maxHits);

const ctx={terrainHeight:()=>0,nextId:(s,p)=>`${p}${++s.idCounter}`};
const base={seed:9,tick:7200,players:[{role:'hero',position:[0,0,0]}],deposits:initialDeposits(),pendingStarfalls:[]};
base.deposits[0].depleted=true;base.deposits[0].hits=3;
const a=structuredClone(base),b=structuredClone(base),ae=[],be=[];
assert.equal(renewGeology(a,ctx,ae),true);assert.equal(renewGeology(b,ctx,be),true);assert.deepEqual(a,b);assert.deepEqual(ae,be);
assert.equal(a.deposits[0].depleted,true);assert.equal(a.deposits[0].hits,3);assert.equal(ae[0].kind,'geology_emerge');assert.equal(renewGeology(a,ctx,ae),false,'same bucket cannot emit twice');
assert.equal(renewGeology({...base,tick:7199},ctx),false);
assert.equal(renewGeology({...base,deposits:Array.from({length:80},(_,i)=>({id:`d${i}`}))},ctx),false);
assert.equal(renewGeology(structuredClone(base),{...ctx,canPlace:()=>false}),false);
assert.equal(renewGeology(structuredClone(base),{...ctx,terrainHeight:()=>NaN}),false);
for(let cycle=2;cycle<=6;cycle++){a.tick=cycle*7200;assert.equal(renewGeology(a,ctx,ae),true);}
assert.ok(a.deposits.filter(d=>d.id.startsWith('renewal')).some(d=>d.kind==='mithril'));

function world(){return {tick:100,idCounter:0,players:[{id:'hero',resources:emptyMaterials(),stats:{kills:0,contribution:0}}],enemies:[],pickups:[],detachedParts:[],embeds:[]};}
function kill(s,id='skel'){const enemy=createEnemy(id,[1,0,2]);s.enemies.push(enemy);const events=[];assert.ok(hitEnemyPart(s,enemy,'torso',200,{ownerId:'hero'},ctx,events));return {enemy,events};}
let s=world(),{enemy,events}=kill(s);assert.equal(s.pickups.length,1);assert.equal(s.pickups[0].kind,'iron');assert.equal(s.pickups[0].amount,1);assert.ok(events.some(e=>e.kind==='salvage'));
assert.equal(hitEnemyPart(s,enemy,'torso',200,{ownerId:'hero'},ctx,[]),false,'dead target cannot pay twice');
kill(s,'skel2');assert.equal(s.pickups.length,1);assert.equal(s.pickups[0].amount,2,'nearby scrap coalesces');
s=world();s.pickups=Array.from({length:256},(_,i)=>({id:`q${i}`,kind:'stone',amount:1,x:20,z:20}));kill(s);assert.equal(s.pickups.length,256);assert.equal(s.players[0].resources.iron,1,'saturated world delivers bounded scrap to credited player');
s=world();const golem=createEnemy('golem',[0,0,0],'golem');s.enemies.push(golem);golem.armor=0;
hitEnemyPart(s,golem,'torso',400,{ownerId:'hero'},ctx,[]);assert.deepEqual(s.pickups.map(p=>[p.kind,p.amount]),[['iron',1]],'a slain golem drops its iron bracers; its stone stays in the remains');assert.ok(s.detachedParts.length,'golem retains physical remains to mine');
const d=s.detachedParts.find(d=>d.part==='torso'),p=s.players[0];p.position=[0,0,1];p.yaw=0;p.tool='pick';d.position=[0,0,0];
const strike={targetId:d.id,point:[0,0,0],normal:[0,1,0]};assert.ok(mineGolemRemains(s,p,strike,ctx).ok);assert.ok(mineGolemRemains(s,p,strike,ctx).ok);const stone=s.pickups.find(p=>p.kind==='stone');assert.equal(stone.amount,2);
// Ore fills the pack as its metal: a full Iron pack makes iron ore uncollectable in the preview too, and the mill takes Copper.
{const {collectibleCandidate}=await import('../shared/collection-target.js');const {millWorth}=await import('../shared/home-mill.js');
 const hero={role:'hero',hp:100,position:[0,0,0],resources:{...emptyMaterials(),iron:999}},st={pickups:[{id:'ore1',kind:'ironOre',amount:2,x:.5,y:0,z:0}]};
 assert.equal(collectibleCandidate(st,hero,'ore1').full,true,'ore preview checks the banked metal');hero.resources.iron=0;assert.equal(collectibleCandidate(st,hero,'ore1').full,false);
 assert.equal(millWorth({copper:3,stone:9}),5,'banked Copper mills, Stone in fours');}
console.log('material-economy: catalog, old inventory upgrade, useful seeded veins, visible deterministic renewal, one-time scrap and mineable remains pass');
