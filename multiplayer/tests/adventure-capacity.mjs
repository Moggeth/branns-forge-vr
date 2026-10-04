import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createSimulation,loadSimulation,MAX_PLAYERS} from '../shared/simulation.js';
import {createAdventure,adventureAction,validateRestore} from '../shared/adventure.js';
const started=performance.now();let count=0;
const test=(name,fn)=>{fn();count++;console.log('PASS',name);};
function rig(){const s=createSimulation();for(let i=0;i<MAX_PLAYERS;i++)assert.equal(s.addPlayer({id:'p'+i}).ok,true);assert.equal(s.command('p0',{type:'adventure',action:'start',seq:1}).ok,true);return s;}

test('all32 players participate, save16 votes, and17 form a majority',()=>{
 const s=rig();assert.equal(s.snapshot().adventure.heroesAtStart,MAX_PLAYERS);
 for(let i=0;i<MAX_PLAYERS;i++){const r=s.command('p'+i,{type:'adventure',action:'deposit',kind:'wood',amount:1,seq:2});assert.notEqual(r.code,'ledger_full');}
 assert.equal(Object.keys(s.snapshot().adventure.seqs).length,MAX_PLAYERS);loadSimulation(s.checkpoint());
 for(let i=0;i<16;i++)assert.equal(s.command('p'+i,{type:'adventure',action:'leave',seq:3}).ok,true);
 assert.equal(s.snapshot().adventure.stage,'camp');assert.equal(s.snapshot().adventure.votes.length,16);const restored=loadSimulation(s.checkpoint());assert.equal(restored.snapshot().adventure.votes.length,16);
 assert.equal(restored.command('p16',{type:'adventure',action:'leave',seq:3}).ok,true);assert.equal(restored.snapshot().adventure.stage,'idle');assert.deepEqual(restored.snapshot().adventure.votes,[]);
});

test('victory rewards every present human once and survives migration',()=>{
 const s=rig(),a=s.adventureWorld().adventure;Object.assign(a,{stage:'rekindle',flame:100,rekindled:true,waveIndex:3,foes:[]});s.step();assert.equal(a.stage,'victory');assert.equal(Object.keys(a.renown).length,MAX_PLAYERS);for(let i=0;i<MAX_PLAYERS;i++)assert.ok(a.renown['p'+i]>0);
 const before=structuredClone(a.renown),restored=loadSimulation(s.checkpoint());restored.step();assert.deepEqual(restored.snapshot().adventure.renown,before);
});

test('bounded sequence and cooldown history evicts departed IDs, preserves active participants',()=>{
 const a=createAdventure(),players=Array.from({length:MAX_PLAYERS},(_,i)=>({id:'active'+i,role:'god',mana:100,position:[0,0,0],resources:{}})),world={players,enemies:[],shrine:{hp:100}};
 a.stage='rekindle';a.run=1;a.tick=1000;a.flame=20;a.need={wood:4,stone:3,star:2};a.stock={wood:0,stone:0};
 for(let i=0;i<MAX_PLAYERS*2;i++){a.seqs['old'+i]=1;a.cool['old'+i]=0;}
 for(let i=0;i<MAX_PLAYERS;i++){const r=adventureAction(a,players[i].id,{action:'unknown',seq:1},world);assert.equal(r.code,'unknown_action');}
 assert.equal(Object.keys(a.seqs).length,MAX_PLAYERS*2);for(const p of players)assert.equal(a.seqs[p.id],1);
 assert.equal(adventureAction(a,players[0].id,{action:'tithe',seq:2},world).ok,true);assert.equal(Object.keys(a.cool).length,MAX_PLAYERS*2);assert.equal(a.cool.active0,1000);assert.equal(validateRestore(a).ok,true);
 const bad=structuredClone(a);bad.cool.extra=0;assert.equal(validateRestore(bad).ok,false);
});
console.log(`${count} adventure capacity tests passed in ${((performance.now()-started)/1000).toFixed(3)}s`);
