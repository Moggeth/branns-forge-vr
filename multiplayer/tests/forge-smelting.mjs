import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {outputSlot,inventionView,SMELT_REACH} from '../shared/inventions.js';
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('ok '+name);};
function fixture(role='hero',at=[1.5,0,4]){const sim=createSimulation();sim.addPlayer({id:'p1',role});const s=sim.adventureWorld(),p=s.players[0];for(const k of Object.keys(p.resources))p.resources[k]=0;p.position=[at[0],terrainHeight(s,at[0],at[2]),at[2]];return {sim,s,p,act:(action,detail={})=>sim.command(p.id,{type:'action',seq:p.seq+1,action,...detail})};}
const run=(sim,n)=>{for(let i=0;i<n;i++)sim.step();};
const bay=(s,kind)=>s.pickups.filter(q=>q.id.startsWith('ingot')&&q.kind===kind);

check('a Hero at the Forge smelts every carried ore without clicking, in parallel batches',()=>{const {sim,s,p}=fixture();p.resources.ironOre=23;p.resources.mithrilOre=4;run(sim,16);assert.equal(p.resources.ironOre,0);assert.equal(p.resources.mithrilOre,0);assert.deepEqual(s.inventions.refining.map(j=>j.amount).sort((a,b)=>a-b),[3,4,10,10]);run(sim,200);
 const iron=bay(s,'iron'),mith=bay(s,'mithril');assert.equal(iron.length,1);assert.equal(iron[0].amount,23);assert.equal(mith.length,1);assert.equal(mith[0].amount,4);const slot=outputSlot('iron','party');assert.equal(iron[0].x,slot.x);assert.equal(iron[0].z,slot.z);assert.notEqual(mith[0].x,iron[0].x);});
check('ore carried away from the Forge stays as ore',()=>{const {sim,p}=fixture('hero',[20,0,20]);p.resources.ironOre=5;run(sim,60);assert.equal(p.resources.ironOre,5);});
check('later batches join the same stack; one pickup takes the whole stack',()=>{const {sim,s,p,act}=fixture();p.resources.ironOre=7;run(sim,200);p.resources.ironOre=5;run(sim,200);const iron=bay(s,'iron');assert.equal(iron.length,1);assert.equal(iron[0].amount,12);
 const at=outputSlot('iron');p.position=[at.x,terrainHeight(s,at.x,at.z+1.2),at.z+1.2];const r=act('collectTarget',{targetId:iron[0].id});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(p.resources.iron,12);assert.equal(bay(s,'iron').length,0);});
check('stored ore smelts too; big stacks survive save and load',()=>{const {sim,s,p}=fixture();s.inventions.stockpiles.party.starOre=40;run(sim,16);assert.equal(s.inventions.stockpiles.party.starOre,0);run(sim,200);assert.equal(bay(s,'starMetal')[0].amount,40);const back=loadSimulation(sim.checkpoint());assert.equal(back.snapshot().pickups.find(q=>q.kind==='starMetal').amount,40);});
check('Smelt all works for the God from anywhere and explains an empty furnace',()=>{const {sim,s,p,act}=fixture('god',[30,0,30]);assert.equal(act('inventionSmeltAll').code,'nothing_to_smelt');s.inventions.stockpiles.party.goldOre=3;assert.equal(act('inventionSmeltAll').ok,true);assert.equal(s.inventions.refining.length,1);const v=inventionView(s,p.id);assert.equal(v.smelt.ore,0);run(sim,170);assert.deepEqual(inventionView(s,p.id).bay.map(b=>[b.kind,b.amount]),[['gold',3]]);});
check('a far Hero is told to walk to the Forge',()=>{const {p,act}=fixture('hero',[SMELT_REACH+10,0,0]);p.resources.ironOre=2;assert.equal(act('inventionSmeltAll').code,'too_far');});
check('the furnace caps at 16 batches and keeps the rest as ore',()=>{const {sim,s,p}=fixture();p.resources.ironOre=200;run(sim,16);assert.equal(s.inventions.refining.length,16);assert.equal(p.resources.ironOre,40);});
console.log(`forge-smelting: ${checks} checks passed`);
