import assert from 'node:assert/strict';
import {WorldSession} from '../client/session.js';
import {createSimulation} from '../shared/simulation.js';
class Connection extends EventTarget {constructor(){super();this.hostId='host';this.epoch=2;this.messages=[];}broadcast(m){this.messages.push(m);}send(to,m){this.messages.push({...m,to});}setCheckpoint(){}close(){}}
const connection=new Connection(),session=new WorldSession({connection,storage:{getItem(){return null;},setItem(){}}});
session.identity={peerId:'host',role:'god'};session.running=true;session.simulation=createSimulation();session.simulation.addPlayer({id:'host',role:'god'});session.simulation.addPlayer({id:'guest'});
session.simulation.command('guest',{type:'action',action:'equip',tool:'crossbow',seq:1});const guest=session.simulation.snapshot().players[1],origin=guest.position.map((n,i)=>n+(i===1?1.5:0));session.simulation.command('guest',{type:'action',action:'fire',origin,direction:[0,0,-1],seq:2});session.simulation.step();
session.publish();assert.equal(connection.messages.find(m=>m.kind==='snapshot').snapshot.projectiles[0].trail,undefined);assert.ok(session.simulation.snapshot().projectiles[0].trail.length>1);connection.messages=[];
const shot=session.simulation.snapshot().projectiles[0],hit={projectileId:shot.id,targetId:'world',part:'torso',point:shot.position,normal:[0,1,0],localPoint:shot.position,localQuaternion:[0,0,0,1]};
const events=[];session.addEventListener('event',({detail})=>events.push(detail));assert.equal(session.projectileContact(hit).ok,true);assert.equal(events[0].kind,'embed');assert.ok(connection.messages.some(m=>m.kind==='event'&&m.event.kind==='embed'));
session.publish();assert.equal(connection.messages.find(m=>m.kind==='snapshot').snapshot.embeds.length,1);
connection.hostId='other';assert.equal(session.projectileContact(hit).code,'host_required');session.dispose();
console.log('combat-session: host geometry authority and broadcast pass');
