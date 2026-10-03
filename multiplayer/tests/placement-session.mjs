import assert from 'node:assert/strict';
import {WorldSession} from '../client/session.js';
import {createSimulation} from '../shared/simulation.js';
class Connection extends EventTarget{constructor(){super();this.hostId='host';this.epoch=2;this.messages=[];}broadcast(m){}send(to,m){this.messages.push({...m,to});}setCheckpoint(){}close(){}}
const start=performance.now(),connection=new Connection(),session=new WorldSession({connection,storage:{getItem(){return null;},setItem(){}}});
session.identity={peerId:'host',role:'god'};session.running=true;session.simulation=createSimulation();for(const id of ['host','guest'])session.simulation.addPlayer({id,role:'god'});
const errors=[];session.addEventListener('error',e=>errors.push(e.detail));
for(const id of ['host','guest'])session.applyCommand(id,{type:'action',action:'inventionBuild',kind:'foundation',position:[0,0,0],yaw:0,seq:1});
assert.match(errors[0].reason,/Forge apron.*Move/);const wire=connection.messages.find(m=>m.kind==='command_error');assert.equal(wire.reason,errors[0].reason);assert.equal(wire.to,'guest');session.dispose();console.log(JSON.stringify({suite:'placement-session',pass:true,seconds:(performance.now()-start)/1000}));
