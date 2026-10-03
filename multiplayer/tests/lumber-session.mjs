import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WorldSession} from '../client/session.js';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {worldTrees} from '../shared/world-content.js';
import {POUCH_RULES,waistPouchPosition} from '../shared/trees.js';

class Connection extends EventTarget {
  constructor(){super();this.hostId='host';this.epoch=1;this.roster=new Map([['host',{id:'host',role:'hero',online:true}],['guest',{id:'guest',role:'hero',online:true}]]);this.messages=[];}
  send(to,data){this.messages.push({to,data});return true;}
  broadcast(){} setCheckpoint(){} close(){}
}
const pose=position=>({position,quaternion:[0,0,0,1]});
const storage={getItem(){return null;},setItem(){}};
// Execute the actual small input publisher with synthetic XR poses. This catches a
// regression to frame throttling without needing an emulated headset/render loop.
const game=readFileSync(new URL('../client/game.js',import.meta.url),'utf8');
const publisher=game.slice(game.indexOf('  function sendInput('),game.indexOf('  function frame('));
function inputPublisher(onInput,tracking){
  const make=new Function('onInput','tracking',`
    let active=true,role='hero',sentAt=0,yaw=0,jumpPending=false,grounded=true,verticalSpeed=0;
    const move={x:0,z:0},grips=['left','right'],controllerSources=new Map([[0,{handedness:'left'}],[1,{handedness:'right'}]]);
    const renderer={xr:{isPresenting:true,getCamera:()=> 'head'}};
    const localPose=key=>tracking[key];
    ${publisher}
    return sendInput;
  `);
  return make(onInput,tracking);
}

for(const remote of [false,true])test(`${remote?'remote ordered':'local synchronous'} session applies forced grip and pouch poses before their actions`,()=>{
  const id=remote?'guest':'host',connection=new Connection(),host=new WorldSession({connection,storage});
  const guestConnection=new Connection(),guest=new WorldSession({connection:guestConnection,storage});
  try {
    const initial=createSimulation({seed:41});initial.addPlayer({id});const state=initial.checkpoint();
    const floor=terrainHeight(state,10,10);state.players[0].position=[10,floor,10];
    state.looseLogs=[{id:'log1',sourceId:worldTrees(state)[0].id,position:[10.3,floor+.2,9.2],quaternion:[0,0,-Math.SQRT1_2,Math.SQRT1_2],velocity:[0,0,0],angularVelocity:[0,0,0],heldBy:null,bornTick:0,sleeping:true}];
    host.identity={peerId:'host',role:'hero'};host.running=true;host.simulation=loadSimulation(state);
    guest.identity={peerId:'guest',role:'hero'};guest.running=true;
    const sender=remote?guest:host,errors=[],order=[];
    host.addEventListener('error',e=>errors.push(e.detail));
    const send=(type,payload)=>{order.push(type==='input'?'input':payload.action);sender.command(type,payload);};
    const flush=()=>{for(const m of guestConnection.messages.splice(0))host.receive({from:'guest',data:m.data});};
    const tracking={head:pose([0,1.65,0]),left:pose([-.3,1,0]),right:pose([0,2.2,0])};
    const publish=inputPublisher(input=>send('input',input),tracking);
    publish(1000);flush();tracking.right=pose([.3,.2,-.8]);
    publish(1010);assert.equal(order.length,1,'ordinary frame remains throttled');
    publish(1010,false,true);send('action',{action:'grab',id:'log1',interaction:'vr-grip',hand:1});flush();
    assert.equal(host.simulation.snapshot().looseLogs[0].heldBy,id,'fresh close-hand pose reaches authority before grab');
    for(let i=0;i<POUCH_RULES.minTicks;i++)host.simulation.step();
    const player=host.simulation.snapshot().players.find(p=>p.id===id);tracking.right=pose(waistPouchPosition(player));
    publish(1015,false,true);send('action',{action:'stowLog',id:'log1'});flush();
    assert.deepEqual(order,['input','input','grab','input','stowLog']);
    assert.equal(host.simulation.snapshot().players.find(p=>p.id===id).resources.wood,2);
    assert.equal(host.simulation.snapshot().looseLogs.length,0);
    assert.equal(errors.length,0);assert.ok(!connection.messages.some(m=>m.data.kind==='command_error'));
    send('action',{action:'stowLog',id:'log1'});flush();
    assert.equal(host.simulation.snapshot().players.find(p=>p.id===id).resources.wood,2,'repeated release cannot award twice');
  } finally {guest.dispose();host.dispose();}
});
