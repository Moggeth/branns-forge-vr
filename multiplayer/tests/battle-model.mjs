import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {battlePanelModel,battleQuestView,BATTLE_LABELS} from '../client/battle-model.js';
import {heroPanelModel,drawHeroPanel} from '../client/vr-adventure-panel.js';
import {nextStep as desktopNextStep,actionModel} from '../client/adventure-view.js';
import {createSimulation} from '../shared/simulation.js';
import {MATERIAL_KEYS} from '../shared/material-catalog.js';
const started=performance.now();let count=0;
const test=(name,fn)=>{fn();count++;console.log('PASS',name);};
function fixture(){const sim=createSimulation();sim.addPlayer({id:'h'});sim.addPlayer({id:'g',role:'god'});sim.addPlayer({id:'r'});sim.adventureWorld().players[2].side='rivals';sim.command('h',{type:'battle',action:'start',seq:1});sim.step();return sim;}
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}

test('disconnected and legacy snapshots safely show off without a quest',()=>{
 const m=battlePanelModel(null,'missing');assert.equal(m.status,'off');assert.equal(m.connected,false);assert.equal(m.canChangeSide,false);assert.deepEqual(m.bases,[]);assert.deepEqual(m.bots,{party:0,rivals:0});assert.equal(battleQuestView({},'missing'),null);assert.equal(battlePanelModel({},'missing',{connected:true,isHost:true}).canChangeSide,false);
});

test('models are pure and reflect current base health, sides, human and bot counts',()=>{
 const sim=fixture(),s=sim.snapshot();s.battle.bases[0].hp=321.5;s.battle.bases[1].hp=82;s.tick=121;s.enemies.push({id:'neutral',kind:'skeleton',hp:100,side:'party'});const before=structuredClone(s);freeze(s);
 const panel=battlePanelModel(s,'r',{isHost:false,connected:true});assert.equal(panel.selfSide,'rivals');assert.deepEqual(panel.bots,{party:4,rivals:4});assert.equal(panel.nextWaveSeconds,13);assert.deepEqual(panel.bases,[{side:'party',hp:321.5,maxHp:400},{side:'rivals',hp:82,maxHp:400}]);assert.equal(panel.canChangeSide,true);
 const q=battleQuestView(s,'g');assert.equal(q.role,'god');assert.equal(q.selfSide,'party');assert.deepEqual(q.party,{heroes:1,gods:1});assert.equal(q.objectives[0].have,321.5);assert.equal(q.objectives[1].have,82);assert.ok(q.objectives.every(o=>!o.done));assert.match(q.nextStep,/Heal Dawn/);assert.match(q.notice,/Wave 2 in 13s/);assert.match(q.notice,/Bots 4\/4/);assert.ok(q.notice.length<65);assert.deepEqual(q.actions,[]);assert.deepEqual(q.telegraphs,[]);
 panel.bases[0].hp=0;q.objectives[0].have=0;assert.deepEqual(s,before);assert.equal(BATTLE_LABELS.rivals,'Dusk');
});

test('side availability matches authoritative inventionSide for every material and refinement side',()=>{
 const cases=[()=>{},w=>w.players[0].heldOre='ironOre',...MATERIAL_KEYS.map(k=>w=>w.players[0].resources[k]=1),w=>w.inventions.refining.push({side:'party'}),w=>w.inventions.refining.push({side:'rivals'})];
 for(const change of cases){const sim=fixture();change(sim.adventureWorld());const m=battlePanelModel(sim.snapshot(),'h',{connected:true});const result=sim.command('h',{type:'action',action:'inventionSide',side:'rivals',seq:2});assert.equal(m.canChangeSide,result.ok);}
 const sim=fixture();sim.adventureWorld().adventure.stage='camp';const m=battlePanelModel(sim.snapshot(),'h',{connected:true,isHost:true});assert.equal(m.expeditionActive,true);assert.equal(m.canChangeSide,true,'Expedition does not change inventionSide rule');assert.equal(m.isHost,true);
});

test('victory keeps explicit zero HP and records the winning faction without counting bots as humans',()=>{
 const sim=fixture(),s=sim.snapshot();s.battle.status='victory';s.battle.winner='party';s.battle.bases[1].hp=0;s.enemies=[];
 const q=battleQuestView(s,'r');assert.equal(q.title,'Dawn wins');assert.equal(q.stage,'battle-victory');assert.equal(q.winner,'party');assert.equal(q.objectives[1].have,0);assert.equal(q.objectives[1].done,false,'HP must render 0/400, not a completed-objective checkmark');assert.deepEqual(q.party,{heroes:1,gods:0});assert.equal(battlePanelModel(s,'r').nextWaveSeconds,0);assert.match(q.nextStep,/Host/);
});

test('existing desktop and VR view functions consume the adapter without Expedition actions or stage bars',()=>{
 const view=battleQuestView(fixture().snapshot(),'h'),held={wood:0,stone:0,gems:0};
 assert.equal(desktopNextStep(view),view.nextStep);assert.deepEqual(actionModel(view),[]);
 const m=heroPanelModel(view,held);assert.equal(m.next,view.nextStep);assert.deepEqual(m.track,[]);assert.equal(m.rows.length,2);assert.deepEqual(m.buttons,[]);assert.match(m.alert.text,/Dawn/);
 const calls=[],ctx=new Proxy({}, {get:(target,key)=>key in target?target[key]:(target[key]=(...args)=>calls.push([key,...args])),set:(target,key,value)=>(target[key]=value,true)});drawHeroPanel(ctx,m);assert.ok(calls.some(([name,text])=>name==='fillText'&&text===view.title));assert.ok(calls.some(([name,text])=>name==='fillText'&&text===view.nextStep));
});
console.log(`${count} battle model tests passed in ${((performance.now()-started)/1000).toFixed(3)}s`);
