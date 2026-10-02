import test from 'node:test';
import assert from 'node:assert/strict';
import {actionModel,nextStep,deliverableKinds} from '../client/adventure-view.js';
import {adventureView,stepAdventure} from '../shared/adventure.js';
import {FIXTURES} from './vr-adventure-fixtures.mjs';
test('hero guidance follows carried supplies and stage-specific delivery',()=>{
 const {view}=FIXTURES.camp();
 assert.match(nextStep(view,{wood:3}),/Deliver/);
 assert.match(nextStep(view,{wood:0}),/Chop timber/);
 assert.deepEqual(deliverableKinds('star',{wood:9,gems:1}),['gems']);
 assert.equal(actionModel(view,{held:{wood:0,stone:0}}).find(x=>x.id==='deposit').empty,true);
 assert.equal(actionModel(view,{held:{wood:3}}).find(x=>x.id==='deposit').note,'3 timber');
});
test('real God star view blocks premature or unaffordable Lodestar',()=>{
 const {adv,snapshot}=FIXTURES.star();snapshot.players=[{id:'g',role:'god',mana:100,position:[0,0,0],resources:{}}];
 const model=()=>actionModel(adventureView(adv,snapshot,'g'),{mana:100}).find(x=>x.id==='lodestar');
 adv.star.landed=false;assert.equal(model().blocked,'star has not landed');
 adv.star.landed=true;assert.equal(model().blocked,'guardians still stand');
 adv.foes=[];assert.equal(model().blocked,'');
 assert.equal(actionModel(adventureView(adv,snapshot,'g'),{mana:0}).find(x=>x.id==='lodestar').blocked,'needs 25 mana');
});
test('actual zero-flame transition yields Retry and exhausted retries remove it',()=>{
 const {adv,snapshot}=FIXTURES.rekindle();snapshot.shrine={hp:0};adv.flame=0;stepAdventure(adv,snapshot,[]);
 assert.equal(adv.stage,'defeat');
 let view=adventureView(adv,snapshot,'p1');assert.ok(actionModel(view).some(x=>x.id==='retry'));assert.match(nextStep(view),/Retry/);
 adv.retries=3;view=adventureView(adv,snapshot,'p1');assert.ok(!actionModel(view).some(x=>x.id==='retry'));assert.match(nextStep(view),/Rematch/);
});
