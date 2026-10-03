import assert from 'node:assert/strict';
import {WorldSession} from '../client/session.js';
import {LocalRoomConnection} from '../client/local-room.js';
import {parseSave} from '../client/world-saves.js';
const started=performance.now(),values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
let sockets=0;globalThis.WebSocket=class{constructor(){sockets++;throw Error('Solo must not open a socket');}};
for(const role of ['hero','god']){
 const connection=new LocalRoomConnection(),s=new WorldSession({connection,storage});let snapshots=0,status='';s.addEventListener('status',e=>status=e.detail.state);
 s.addEventListener('snapshot',()=>snapshots++);s.connect({name:'Solo tester',role});clearInterval(s.timer);
 assert.equal(status,'hosting');assert.ok(s.simulation);assert.equal(s.identity.room,'SOLO');assert.equal(s.identity.role,role);assert.equal(s.simulation.snapshot().players.length,1);assert.ok(snapshots);
 const id=s.identity.peerId,p=s.simulation.adventureWorld().players[0];p.resources.mithril=7;
 for(let i=0;i<180;i++)s.simulation.step();
 s.command('role',{role:role==='hero'?'god':'hero'});s.publish(true);
 assert.equal(s.simulation.snapshot().players[0].role,role==='hero'?'god':'hero');
 const save=parseSave(JSON.stringify(s.exportSave()));s.dispose();
 const resumed=new WorldSession({connection:new LocalRoomConnection(),storage});resumed.connect({save});clearInterval(resumed.timer);
 assert.equal(resumed.identity.peerId,id);assert.equal(resumed.simulation.snapshot().players[0].resources.mithril,7);
 assert.equal(resumed.simulation.snapshot().tick,save.checkpoint.tick);resumed.resetWorld();assert.equal(resumed.simulation.snapshot().players.length,1);assert.equal(resumed.simulation.snapshot().tick,0);resumed.dispose();
}
assert.equal(sockets,0);assert.ok(values.size);console.log(JSON.stringify({suite:'solo-session',roles:2,sockets,saves:values.size,passed:true,elapsedMs:performance.now()-started}));
