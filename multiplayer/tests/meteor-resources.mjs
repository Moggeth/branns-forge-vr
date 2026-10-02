import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {meteorAwakens} from '../shared/resources.js';
import {hitEnemyPart,createEnemy} from '../shared/combat.js';
const started=performance.now();let passed=0;
const test=(name,fn)=>{fn();passed++;console.log('PASS',name);};
function fixture(seed=41){const s=createSimulation({seed});s.addPlayer({id:'h',role:'hero'});s.addPlayer({id:'g',role:'god'});const w=s.adventureWorld();let seq=0;return {s,w,h:w.players[0],g:w.players[1],cmd:(id,action,extra={})=>s.command(id,{type:'action',action,seq:++seq,...extra})};}
function strikeDead(w,e){const events=[];hitEnemyPart(w,e,'torso',1000,{tool:'pick'}, {terrainHeight,nextId:(s,p)=>`${p}${++s.idCounter}`},events);return events;}
function cast(seed){const f=fixture(seed);assert.ok(f.s.command('g',{type:'cast',seq:1,spell:'starfall',point:[25,0,25]}).ok);const id=f.w.pendingStarfalls[0].id;for(let i=0;i<48;i++)f.s.step();return {...f,id};}
test('Seed + operation hash is deterministic and approximately 25% over 4096 worlds',()=>{
 let n=0;for(let seed=0;seed<4096;seed++){const b=meteorAwakens(seed,'s1');assert.equal(b,meteorAwakens(seed,'s1'));n+=b;}assert.ok(n>920&&n<1130,`${n}/4096`);
});
const yes=Array.from({length:100},(_,i)=>i).find(seed=>meteorAwakens(seed,'s1'));
const no=Array.from({length:100},(_,i)=>i).find(seed=>!meteorAwakens(seed,'s1'));
test('Awakened Starfall is a golem with no duplicate mineable ore, and unfurl survives save',()=>{
 const {s,w,id}=cast(yes),e=w.enemies.find(e=>e.meteorBorn);assert.ok(e,`seed ${yes} op ${id}`);assert.equal(e.kind,'golem');assert.equal(e.unfurlTick,48);assert.ok(!w.deposits.some(d=>d.id===`${id}_meteor`));
 const saved=loadSimulation(s.checkpoint());assert.equal(saved.snapshot().enemies[0].meteorBorn,true);assert.equal(saved.snapshot().enemies[0].unfurlTick,48);
 const start=[...e.position];for(let i=0;i<30;i++)s.step();assert.deepEqual(e.position,start);
});
test('Pending Starfall migrates to the same deterministic outcome',()=>{
 const f=fixture(yes);f.s.command('g',{type:'cast',seq:1,spell:'starfall',point:[25,0,25]});for(let i=0;i<20;i++)f.s.step();const b=loadSimulation(f.s.checkpoint());for(let i=0;i<28;i++){f.s.step();b.step();}assert.deepEqual(f.s.snapshot(),b.snapshot());
});
test('Ordinary Starfall leaves standard two-gem mineable meteor',()=>{
 const {w,id}=cast(no);assert.ok(!w.enemies.some(e=>e.meteorBorn));assert.equal(w.deposits.find(d=>d.id===`${id}_meteor`).maxHits,5);
});
test('Meteor kill pays exactly six gems once and no second hit can duplicate rewards',()=>{
 const {w}=cast(yes),e=w.enemies.find(e=>e.meteorBorn);strikeDead(w,e);assert.equal(w.pickups.filter(p=>p.kind==='gems').reduce((n,p)=>n+p.amount,0),6);assert.equal(w.enemies.length,0);strikeDead(w,e);assert.equal(w.pickups.filter(p=>p.kind==='gems').reduce((n,p)=>n+p.amount,0),6);
});
test('Full pickup pool preserves rare reward over save and releases it when space returns',()=>{
 const {s,w}=cast(yes);w.pickups=Array.from({length:256},(_,i)=>({id:`cap${i}`,kind:'wood',amount:1,x:40,z:40,y:terrainHeight(w,40,40)}));strikeDead(w,w.enemies[0]);assert.equal(w.pickups.length,256);assert.equal(w.meteorRewards.length,1);
 const resumed=loadSimulation(s.checkpoint()),r=resumed.adventureWorld();r.pickups.pop();resumed.step();assert.equal(r.pickups.length,256);assert.equal(r.meteorRewards.length,0);assert.equal(r.pickups.at(-1).amount,6);
});
test('Enemy capacity leaves a normal mineable meteor instead of exceeding the simulation cap',()=>{
 const f=fixture(yes);f.s.command('g',{type:'cast',seq:1,spell:'starfall',point:[25,0,25]});for(let i=0;i<64;i++)f.w.enemies.push(createEnemy(`capEnemy${i}`,[45,0,-45]));for(let i=0;i<48;i++)f.s.step();assert.equal(f.w.enemies.length,64);assert.ok(f.w.deposits.some(d=>d.id==='s1_meteor'));loadSimulation(f.s.checkpoint());
});
test('Malformed meteor metadata and overflowing rewards rejected',()=>{
 const {s}=cast(yes);for(const mutate of [e=>e.unfurlTick=999999,e=>e.kind='skeleton',e=>e.meteorBorn=false]){const cp=s.checkpoint();mutate(cp.enemies[0]);assert.throws(()=>loadSimulation(cp));}
 const cp=s.checkpoint();cp.meteorRewards=[{id:'bad',x:0,z:0,amount:999}];assert.throws(()=>loadSimulation(cp));
});
test('Hero resources benefit health, forge and weapon readiness; no-benefit and distant spends reject',()=>{
 const {w,h,cmd,s}=fixture();h.resources={wood:9,stone:6,gems:3};assert.equal(cmd('h','useResource',{kind:'wood'}).code,'not_needed');h.hp=50;assert.ok(cmd('h','useResource',{kind:'wood'}).ok);assert.equal(h.hp,85);assert.equal(h.resources.wood,6);
 w.shrine.hp=25;assert.equal(cmd('h','useResource',{kind:'stone'}).code,'too_far');h.position=[0,0,3];assert.ok(cmd('h','useResource',{kind:'stone'}).ok);assert.equal(w.shrine.hp,60);assert.equal(h.resources.stone,4);
 h.specialTick=w.tick;h.heat=.8;assert.ok(cmd('h','useResource',{kind:'gems'}).ok);assert.equal(h.hp,100);assert.equal(h.heat,0);assert.equal(h.specialTick,-1000);assert.equal(h.resources.gems,2);assert.equal(cmd('h','useResource',{kind:'gems'}).code,'not_needed');assert.deepEqual(loadSimulation(s.checkpoint()).snapshot().players[0].resources,h.resources);
});
test('Forged resource names and already-ready non-melee tools cannot consume gems',()=>{
 const {h,cmd}=fixture();h.resources.gems=2;for(const kind of ['__proto__','toString',null,{}])assert.equal(cmd('h','useResource',{kind}).code,'invalid_resource');h.tool='bow';h.specialTick=0;assert.equal(cmd('h','useResource',{kind:'gems'}).code,'not_needed');h.tool='wyrmspout';h.specialTick=-180;assert.equal(cmd('h','useResource',{kind:'gems'}).code,'not_needed');assert.equal(h.resources.gems,2);
});
test('God carried resources all have useful spends and disabled forge can be mended',()=>{
 const {w,g,cmd,s}=fixture();g.resources={wood:3,stone:2,gems:1};w.shrine.hp=0;w.shrine.disabledUntil=480;assert.ok(cmd('g','useResource',{kind:'wood'}).ok);assert.equal(w.shrine.hp,20);assert.equal(w.shrine.disabledUntil,0);assert.ok(cmd('g','useResource',{kind:'stone'}).ok);assert.equal(w.shrine.hp,55);g.mana=30;assert.ok(cmd('g','useResource',{kind:'gems'}).ok);assert.equal(g.mana,70);assert.deepEqual(g.resources,{wood:0,stone:0,gems:0});loadSimulation(s.checkpoint());
});
test('Collect targets exact nearby item, not nearest; range, full bag, wrong role and raw ore are rejected',()=>{
 const {w,h,cmd}=fixture();h.position=[10,0,10];w.pickups=[{id:'near',kind:'wood',amount:1,x:10,z:10,y:0},{id:'wanted',kind:'gems',amount:6,x:11,z:10,y:0},{id:'far',kind:'stone',amount:2,x:30,z:30,y:0}];assert.ok(cmd('h','collectTarget',{targetId:'wanted'}).ok);assert.equal(h.resources.gems,6);assert.ok(w.pickups.some(p=>p.id==='near'));assert.equal(cmd('h','collectTarget',{targetId:'far'}).code,'out_of_reach');assert.equal(cmd('g','collectTarget',{targetId:'near'}).code,'role_required');assert.equal(cmd('h','collectTarget',{targetId:w.deposits[0].id}).code,'invalid_target');h.resources.wood=999;assert.equal(cmd('h','collectTarget',{targetId:'near'}).code,'inventory_full');assert.ok(w.pickups.some(p=>p.id==='near'));
});
test('Tap log collection stows one wood; another player held log cannot be stolen',()=>{
 const {w,h,cmd}=fixture();h.position=[10,0,10];w.looseLogs=[{id:'log1',sourceId:'tree1',position:[10,.5,10],quaternion:[0,0,0,1],velocity:[0,0,0],angularVelocity:[0,0,0],bornTick:0,heldBy:null,sleeping:true}];assert.ok(cmd('h','collectTarget',{targetId:'log1'}).ok);assert.equal(h.resources.wood,1);assert.equal(w.looseLogs.length,0);
 w.looseLogs=[{id:'log2',position:[10,.5,10],quaternion:[0,0,0,1],heldBy:'other'}];assert.equal(cmd('h','collectTarget',{targetId:'log2'}).code,'out_of_reach');
});
console.log(`meteor/resources: ${passed} tests passed (${((performance.now()-started)/1000).toFixed(3)}s)`);

