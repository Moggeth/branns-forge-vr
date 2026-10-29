// Long-range Timberline authority: bolts fly on under gravity past the old aim distance, stick where they meet
// something they cannot cut, tether-drag survivors, leave with their hosts, cap and round-trip through saves.
// node tests/timberline-long.mjs
import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {worldTrees} from '../shared/world-content.js';
import {timberlineFlight,stuckAnchor,TIMBERLINE_LONG,TIMBERLINE_RELEASE_TICKS} from '../shared/timberline-flight.js';
import {restoreInventions,mannedShot} from '../shared/inventions.js';
import {forecastTimberline} from '../client/timberline-sight.js';
import {createEnemy} from '../shared/combat.js';
import {ladderMarks,TIMBERLINE_LADDER} from '../client/timberline-ladder.js';
import {readFileSync} from 'node:fs';
const t0=performance.now();
function world(){
 const sim=createSimulation();sim.addPlayer({id:'gunner',role:'hero'});
 const s=sim.adventureWorld();s.enemies=[];s.pickups=[];s.deposits=[];s.landmarks=false;
 s.harvestedTrees=worldTrees(s).map(t=>({id:t.id,cuts:3,cutHeight:terrainHeight(s,t.x,t.z,false)+.5,felledTick:1,fallYaw:0,landed:true}));
 const p=s.players[0];for(const k of Object.keys(p.resources))p.resources[k]=/Ore$/.test(k)?0:200; // ore banks as metal, so packs never hold it
 const at=(x,z)=>[x,terrainHeight(s,x,z,false),z];
 const b={id:'building1',type:'timberline',position:at(0,-8),yaw:0,hp:200,maxHp:200,side:'party',builtTick:0,readyTick:0,fireTick:-1000,open:false,charge:0,armed:false,aimYaw:0};
 s.inventions.structures.push(b);s.inventions.seq=1;p.position=at(0,-6);
 let seq=0;const act=(action,extra={})=>sim.command('gunner',{type:'action',seq:++seq,action,structureId:b.id,...extra});
 assert.equal(act('inventionMount').ok,true);
 return {sim,s,b,p,at,act,fire(aim){b.readyTick=0;const r=act('inventionUse',{aim});assert.equal(r.ok,true,r.code);return s.inventions.shots.at(-1);}};
}
const run=(w,shot,limit=900)=>{for(let k=0;k<limit&&w.s.inventions.shots.includes(shot);k++)w.sim.step();assert.ok(!w.s.inventions.shots.includes(shot),'flight resolves');};

// 1. A raised shot carries far past the old 40 m aim distance and sticks in the ground where it lands.
{const w=world(),shot=w.fire({yaw:0,pitch:.3});assert.equal(shot.v,3);
 let far=0;for(let k=0;k<900&&w.s.inventions.shots.includes(shot);k++){w.sim.step();if(w.s.inventions.shots.includes(shot))far=Math.max(far,Math.abs(timberlineFlight(shot,w.s.tick).centre[2]+8));}
 assert.ok(far>42,`bolts fly beyond the old reach (${far.toFixed(1)} m)`);
 const r=w.s.inventions.stuck.find(r=>r.id===shot.id);assert.ok(r,'a stuck record remains');assert.ok(['L','R'].includes(r.mode));assert.equal(r.hostKind,'ground');
 assert.ok(Math.abs(r.at[1]-terrainHeight(w.s,r.at[0],r.at[2],false))<.9&&r.at[1]>8,'the stuck eye is in the mountainside');
 for(let k=0;k<1200;k++)w.sim.step();assert.ok(w.s.inventions.stuck.some(r=>r.id===shot.id),'ground bolts persist');}

// 1b. The operator's forecast arcs replay the same flight: the predicted landing is where the authority sticks the bolt.
for(const aim of [{yaw:0,pitch:.3},{yaw:.6,pitch:.12},{yaw:-1.2,pitch:0},{yaw:2.4,pitch:.2}]){const w=world();w.b.aimYaw=aim.yaw;w.b.aimPitch=aim.pitch;
 const f=forecastTimberline(mannedShot(w.b,aim),(x,z)=>terrainHeight(w.s,x,z,false));const shot=w.fire(aim);
 assert.deepEqual(mannedShot(w.b,aim).origin,shot.origin);run(w,shot);const r=w.s.inventions.stuck.find(r=>r.id===shot.id);
 assert.ok(f.impact&&r,'forecast and authority both land');const miss=Math.hypot(r.at[0]-f.impact[r.mode==='L'?'left':'right'][0],r.at[2]-f.impact[r.mode==='L'?'left':'right'][2]);
 assert.ok(miss<1.2,`forecast lands within a bolt length of the real strike (${miss.toFixed(2)} m at ${f.distance.toFixed(0)} m)`);}

// 1c. Hit volumes hug the models: a just-raised pair (eyes ~1.2-1.4 m up) skims over a 1.15 m ore rock it used to stop on (the old 2.5 m cylinder),
// a lowered pair buries a bolt in the rock itself, a felled tree's stump catches a bolt, and standing stones stop it.
{const w=world(),ore={id:'ore-test',kind:'iron',x:0,z:-16,amount:20,depleted:false};w.s.deposits.push(ore);
 const shot=w.fire({yaw:0,pitch:.03});run(w,shot);const r=w.s.inventions.stuck.find(r=>r.id===shot.id);
 assert.ok(r.host!=='ore-test',`a level shot clears the rock (stuck in ${r.host})`);}
{const w=world(),ore={id:'ore-test',kind:'iron',x:0,z:-14,amount:20,depleted:false};w.s.deposits.push(ore);
 const shot=w.fire({yaw:0,pitch:-.06});run(w,shot);const r=w.s.inventions.stuck.find(r=>r.id===shot.id);
 assert.equal(r.host,'ore-test','a lowered shot strikes the rock');const g=terrainHeight(w.s,ore.x,ore.z,false);
 assert.ok(r.at[1]-g<1.2&&Math.hypot(r.at[0]-ore.x,r.at[2]-ore.z)<1,`stuck at the rock surface, not in the air above it (${(r.at[1]-g).toFixed(2)} m up)`);}
{const w=world(),t=worldTrees(w.s).find(t=>Math.abs(t.x)<2&&t.z<-14&&t.z>-30)||null;
 if(t){const cut=w.s.harvestedTrees.find(h=>h.id===t.id);const shot=w.fire({yaw:Math.atan2(-(t.x-0),-(t.z+8)),pitch:-.04});run(w,shot);const r=w.s.inventions.stuck.find(r=>r.id===shot.id);
  assert.ok(r,'stump shot lands');}}
{const w=world();w.s.landmarks=true;const shot=w.fire({yaw:0,pitch:0});run(w,shot);assert.ok(w.s.inventions.stuck.some(r=>r.id===shot.id),'landmark world still resolves');}

// 2. A structure in the path holds one bolt; destroying it frees the record.
{const w=world(),wall={id:'store9',type:'storehouse',position:w.at(.4,-14),yaw:0,hp:240,maxHp:240,side:'party',builtTick:0,readyTick:0,fireTick:-1000,open:false,charge:0,armed:false,aimYaw:0};
 w.s.inventions.structures.push(wall);const shot=w.fire({yaw:0,pitch:0});run(w,shot);
 const r=w.s.inventions.stuck.find(r=>r.id===shot.id);assert.equal(r.hostKind,'block');assert.equal(r.host,'store9');
 assert.ok(r.at[2]<-11&&r.at[2]>-14.5,'stuck at the wall face, not behind it');
 wall.hp=0;w.sim.step();assert.ok(!w.s.inventions.stuck.some(r=>r.id===shot.id),'bolts fall away with the structure');}

// 3. A skeleton is cut down and the pair flies on; a golem survives, so a bolt sticks in it and drags it.
{const w=world();const skeleton=createEnemy('bone1',w.at(0,-12),'skeleton'),golem=createEnemy('golem1',w.at(0,-18),'golem');w.s.enemies.push(skeleton,golem);
 const shot=w.fire({yaw:0,pitch:0});run(w,shot);
 assert.ok(!w.s.enemies.includes(skeleton)||!(skeleton.hp>0),'the skeleton falls');
 const r=w.s.inventions.stuck.find(r=>r.id===shot.id);assert.equal(r.hostKind,'enemy');assert.equal(r.host,'golem1');
 assert.ok(golem.slowUntil>w.s.tick,'the tether drags the golem');
 const before=stuckAnchor(w.s,r);golem.position[0]+=2;golem.yaw=(golem.yaw||0)+.5;const after=stuckAnchor(w.s,r);
 assert.ok(Math.hypot(after[0]-before[0]-2,after[2]-before[2])<1.6,'the anchor rides on the golem');
 const restored=loadSimulation(w.sim.checkpoint());for(let k=0;k<30;k++){w.sim.step();restored.step();}
 assert.deepEqual(w.sim.checkpoint().inventions,restored.checkpoint().inventions,'stuck records replay deterministically');
 for(let k=0;k<TIMBERLINE_LONG.dragTicks;k++)w.sim.step();assert.ok(!w.s.inventions.stuck.some(r=>r.id===shot.id),'the tether tears free');}

// 4. The world keeps only the newest stuck pairs, and saves reject malformed records.
{const w=world();for(let n=0;n<TIMBERLINE_LONG.stuckCap+3;n++){const shot=w.fire({yaw:(n%7-3)*.3,pitch:-.1});run(w,shot);}
 assert.equal(w.s.inventions.stuck.length,TIMBERLINE_LONG.stuckCap,'oldest pairs crumble beyond the cap');
 const saved=structuredClone(w.sim.checkpoint().inventions);assert.doesNotThrow(()=>restoreInventions(saved,w.s.tick));
 const bad=structuredClone(saved);bad.stuck[0].mode='both';assert.throws(()=>restoreInventions(bad,w.s.tick));
 const old=structuredClone(saved);delete old.stuck;assert.deepEqual(restoreInventions(old,w.s.tick).stuck,[],'older saves load without stuck bolts');
 assert.ok(w.s.inventions.stuck.every(r=>r.launchTick+TIMBERLINE_RELEASE_TICKS<=r.tick));}
// 5. The brass range ladder built into the kit still matches the shared flight (regenerate: node scripts/timberline-ladder.mjs,
//    then rebuild the kit), its rungs step down with range, and a shot at each rung's pitch passes the mark's target.
{const built=JSON.parse(readFileSync(new URL('../assets-source/timberline-twinbolt-20261003/source/ladder_marks.json',import.meta.url),'utf8')),now=ladderMarks();
 assert.deepEqual(built.eye,TIMBERLINE_LADDER.eye);assert.equal(built.ladderY,TIMBERLINE_LADDER.ladderY);assert.equal(built.marks.length,now.length,'every range has a rung');
 now.forEach((m,i)=>{assert.equal(built.marks[i].range,m.range);assert.ok(Math.abs(built.marks[i].z-m.z)<.0005,`rung ${m.range} m sits where the flight says`);if(i)assert.ok(m.z<now[i-1].z,'longer ranges sit lower');
  const q=mannedShot({yaw:0,position:[0,0,0]},{yaw:0,pitch:m.pitch});let hit=null;for(let k=1;k<TIMBERLINE_LONG.maxTicks&&!hit;k++){const f=timberlineFlight(q,k+TIMBERLINE_RELEASE_TICKS);if(-f.centre[2]>=m.range)hit=f.centre;}
  assert.ok(hit&&Math.abs(hit[1]-TIMBERLINE_LADDER.targetHeight)<.25,`a shot on the ${m.range} m rung meets a chest-high target (${hit?.[1]})`);});}
console.log(`timberline-long: far flight, ground/structure/golem sticking, drag, host removal, cap, saves, range ladder PASS (${((performance.now()-t0)/1000).toFixed(3)}s)`);
