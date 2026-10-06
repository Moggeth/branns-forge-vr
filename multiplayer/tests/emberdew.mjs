// Emberdew: aimed lit throws and Cinder Cluster (shared rules), the landing forecast agreeing with the host,
// save round trips mid-flight, and the pooled impact effects staying inside their budget.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {EMBERDEW,cinderVelocities} from '../shared/emberdew.js';
import {specialCooldown} from '../shared/special-cooldowns.js';
import {xpForLevel,heroMaxHp} from '../shared/hero-progress.js';
import {forecastCinder,flaskLaunch} from '../client/emberdew-aim.js';
import {createEmberdewFx,EMBERDEW_FX} from '../client/emberdew-fx.js';
import {createEmberdewHand} from '../client/emberdew-hand.js';
import {createEmberdewModel} from '../client/emberdew-model.js';

let seq=0;const action=(s,action,rest={})=>s.command('h',{type:'action',seq:++seq,action,...rest});
const make=()=>{const s=createSimulation({legacyBattle:true});s.addPlayer({id:'h'});action(s,'equip',{tool:'flask'});for(let i=0;i<60;i++)s.step();return s;};
const speed=v=>Math.hypot(...v);
// Plays the host renderer's part: a falling bottle that crosses the ground reports its terrain contact.
function land(sim){const st=sim.checkpoint(),events=[];for(const q of sim.snapshot().projectiles){if(q.kind!=='fuel'||q.cluster||q.velocity[1]>=0)continue;
  const a=q.previousPosition,b=q.position,ga=terrainHeight(st,a[0],a[2]),gb=terrainHeight(st,b[0],b[2]);if(b[1]>gb)continue;
  const f=a[1]-ga>0?(a[1]-ga)/(a[1]-ga+gb-b[1]):1,x=a[0]+(b[0]-a[0])*f,z=a[2]+(b[2]-a[2])*f,point=[x,terrainHeight(st,x,z),z];
  const r=sim.projectileContact({projectileId:q.id,targetId:'terrain',point,normal:[0,1,0],localPoint:point,localQuaternion:[0,0,0,1]});if(r.ok)events.push(...r.events);}return events;}

// Hip toss stays a short unlit lob; an aimed throw is lit and flies about twice as fast.
{const s=make(),p=s.snapshot().players[0],origin=[p.position[0],p.position[1]+1.4,p.position[2]],direction=[0,0,-1];
 assert.equal(action(s,'pour',{origin,direction}).ok,true);const toss=s.snapshot().projectiles.at(-1);
 assert.equal(toss.lit,false);for(let i=0;i<60;i++)s.step();
 assert.equal(action(s,'pour',{origin,direction,aimed:'yes'}).code,'invalid_action');
 assert.equal(action(s,'pour',{origin,direction,aimed:true}).ok,true);const hurl=s.snapshot().projectiles.at(-1);
 assert.equal(hurl.lit,true,'an aimed throw lights the rag');assert.ok(speed(hurl.velocity)>speed(toss.velocity)*1.8,'aimed throws fly much further');}

// Cinder Cluster: a big lit jug that pops at the top of its arc into five lit bottles; the Q has a 12 s recharge.
const s=make(),p=s.snapshot().players[0],origin=[p.position[0],p.position[1]+1.4,p.position[2]],direction=[0,-.1,-1].map((n,i,a)=>n/Math.hypot(...a));
assert.equal(specialCooldown('flask',p),EMBERDEW.cinder.cooldown);
assert.equal(action(s,'special',{origin:[NaN,0,0],direction}).code,'invalid_action','a Cinder Cluster needs an aim');
const launched=action(s,'special',{origin,direction});assert.equal(launched.ok,true);assert.equal(launched.events[0].kind,'cinder_throw');
const jug=s.snapshot().projectiles.at(-1);assert.equal(jug.cluster,true);assert.equal(jug.lit,true);
assert.equal(action(s,'special',{origin,direction}).code,'cooldown');
// The client's forecast replays the jug, its pop and every little bottle's fall from the same launch.
const out=new Float32Array(600),landings=new Float32Array(18),state=s.checkpoint();
const forecast=forecastCinder({origin:jug.position,velocity:jug.velocity,out,terrainHeight:(x,z)=>terrainHeight(state,x,z),landings});
assert.equal(forecast.landed,EMBERDEW.cinder.bottles,'forecast marks five landings');
let pop=null;const spills=[];
for(let i=0;i<400;i++){for(const e of [...s.step(),...land(s)]){if(e.kind==='cinder_pop')pop=e;if(e.kind==='fuel_spill')spills.push(e);}
  if(i===10){const r=loadSimulation(s.checkpoint());assert.deepEqual(r.snapshot().projectiles,s.snapshot().projectiles,'a jug in flight survives save and restore');}
  if(pop&&spills.length>=EMBERDEW.cinder.bottles)break;}
assert.ok(pop,'the jug pops');assert.equal(pop.bottles.length,EMBERDEW.cinder.bottles);
assert.ok(Math.hypot(pop.position[0]-forecast.apex[0],pop.position[1]-forecast.apex[1],pop.position[2]-forecast.apex[2])<.01,'it pops where the forecast drew the top of the arc');
assert.ok(pop.position[1]>origin[1]+2.5,'high in the air, even aimed a little down');
assert.equal(spills.length,EMBERDEW.cinder.bottles,'five bottles smash');assert.ok(spills.every(e=>e.lit),'each one lit');
for(const e of spills){let best=Infinity;for(let k=0;k<forecast.landed;k++)best=Math.min(best,Math.hypot(e.position[0]-landings[k*3],e.position[2]-landings[k*3+2]));assert.ok(best<.05,`a bottle lands on its marker (${best.toFixed(3)} m)`);}
// They rain in a ring rather than a single splat.
const cx=spills.reduce((n,e)=>n+e.position[0],0)/spills.length,cz=spills.reduce((n,e)=>n+e.position[2],0)/spills.length;
assert.ok(spills.every(e=>Math.hypot(e.position[0]-cx,e.position[2]-cz)>1.2),'spread in a ring');
assert.ok(cz<origin[2]-4,'the ring falls well ahead of the thrower');
assert.ok(s.snapshot().fireCells.filter(c=>c.burning).length>=EMBERDEW.cinder.bottles*3,'each bottle leaves a burning puddle');
// cinderVelocities is deterministic: the same jug always rains the same ring.
assert.deepEqual(cinderVelocities([1,-.1,-4]),cinderVelocities([1,-.1,-4]));
// A foe standing on a marker is set alight; Firebomb works on every bottle.
{const t=make(),st=t.checkpoint();const me=st.players[0],o=[me.position[0],me.position[1]+1.4,me.position[2]];
 const v=flaskLaunch('cinder',direction,[0,0,0]),lp=new Float32Array(18);
 forecastCinder({origin:o,velocity:v,out:new Float32Array(600),terrainHeight:(x,z)=>terrainHeight(st,x,z),landings:lp});
 st.enemies=[{id:'e1',kind:'skeleton',position:[lp[0],terrainHeight(st,lp[0],lp[2]),lp[2]],yaw:0,hp:100,parts:{head:55,torso:100,leftArm:55,rightArm:55,leftLeg:55,rightLeg:55},missingParts:[],attackTick:-1000}];
 st.players[0].xp=xpForLevel(2);st.players[0].talents={flask:['firebomb']};st.players[0].hp=heroMaxHp(st.players[0]);
 const u=loadSimulation(st);assert.equal(u.command('h',{type:'action',seq:++seq,action:'special',origin:o,direction}).ok,true);
 let bombs=0;for(let i=0;i<240;i++)for(const e of [...u.step(),...land(u)])if(e.kind==='firebomb')bombs++;
 const foe=u.snapshot().enemies.find(e=>e.id==='e1');assert.ok(!foe||foe.burnUntil>u.snapshot().tick||foe.hp<100,'a foe on a marker is caught');
 assert.ok(bombs>=EMBERDEW.cinder.bottles-1,`Firebomb goes off on the bottles (${bombs})`);}

// Effects: pooled, three draws at most, nothing past its budget however many bottles break.
{const scene=new THREE.Scene(),fx=createEmberdewFx({scene,height:()=>0});
 for(let i=0;i<40;i++){fx.handle({kind:'fuel_spill',position:[i,0,0],lit:i%2===0});fx.handle({kind:'cinder_pop',position:[i,4,2]});}
 fx.update(1/60);const st=fx.stats();assert.ok(st.draws<=3);assert.ok(st.shards<=EMBERDEW_FX.shards&&st.drops<=EMBERDEW_FX.drops&&st.flashes<=EMBERDEW_FX.flashes);
 for(let i=0;i<180;i++)fx.update(1/60);assert.equal(fx.stats().draws,0,'everything settles and hides');
 let lights=0;scene.traverse(o=>{if(o.isLight)lights++;});assert.equal(lights,0);fx.dispose();assert.equal(scene.children.length,0);}

// Hand: aiming raises the bottle; a throw hides it, then a fresh one comes back.
{const h=createEmberdewHand();let o=h.update(0,1/60,{aiming:true});assert.ok(o.kick,'raising sloshes the dew');for(let t=0;t<1;t+=1/60)o=h.update(t,1/60,{aiming:true});assert.ok(o.ads>.5&&o.offset.y>.1);
 h.thrown(1,'hurl');o=h.update(1.2,1/60,{aiming:true});assert.equal(o.visible,false);let back=false;for(let t=1.2;t<2;t+=1/60){o=h.update(t,1/60,{aiming:true});if(o.kick)back=true;}assert.ok(o.visible&&back,'a fresh bottle bobs up');}

// Model: the named parts the presentation layers rely on, inside the triangle and draw budget.
{const m=createEmberdewModel();for(const n of ['Liquid','Glass','Wick','WickTip','NeckCollar','GripWrap','FootBand','Stopper','Muzzle','CorkEyes','Wax'])assert.ok(m.getObjectByName(n),n);
 assert.ok(m.userData.stats.triangles<4000&&m.userData.stats.draws<=11,JSON.stringify(m.userData.stats));m.userData.dispose();}
console.log('emberdew: aimed throws, Cinder Cluster rules + forecast, save round trip, effects budget, hand and model ok');
