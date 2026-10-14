import assert from 'node:assert/strict';
import {createSimulation,loadSimulation,terrainHeight} from '../shared/simulation.js';
import {createEnemy} from '../shared/combat.js';
import {STRUCTURES,damageInvention} from '../shared/inventions.js';
import {homePoint,homeSolids,pieceLocal,resolveHomeStructures} from '../shared/home-bases.js';
import {STORMREEL,HOME_STORMSPIRE,terminalPoint,wornTower,cableLength,leash,nearestFreePack,hookPoint,cableWraps} from '../shared/stormreel.js';

const foeHp=(s,id)=>s.checkpoint().enemies.find(e=>e.id===id)?.hp??0;

// Fixture: a hero beside a Stormspire at (8, 20) with optional skeletons `ahead` metres along -Z of the hero (a clear line).
function fixture({charge=240,gems=3,foes=[],heroAt=[10,24]}={}) {
  const sim=createSimulation();sim.addPlayer({id:'h',name:'Mitch'});
  const c=sim.checkpoint(),p=c.players[0];p.position=[heroAt[0],terrainHeight(c,...heroAt),heroAt[1]];p.yaw=0;p.tool='axe';p.resources.gems=gems;
  c.inventions.structures.push({id:'spire1',type:'stormspire',position:[8,terrainHeight(c,8,20),20],yaw:0,hp:240,maxHp:240,side:'party',builtTick:0,readyTick:0,fireTick:-1000,open:false,charge,armed:false,aimYaw:0});
  c.enemies=foes.map((f,i)=>{const [dx,dz,dy=0,kind='skeleton']=Array.isArray(f)?f:[0,-f];const x=heroAt[0]+dx,z=heroAt[1]+dz;return createEnemy(`foe${i}`,[x,terrainHeight(c,x,z)+dy,z],kind);});
  return loadSimulation(c);
}
const hero=s=>s.checkpoint().players[0],tower=s=>s.checkpoint().inventions.structures.find(b=>b.id==='spire1');
let seq=1;const act=(s,m)=>s.command('h',{type:'action',seq:seq++,...m});
const run=(s,n)=>{for(let i=0;i<n;i++)s.step();};
const aimAt=(s,target)=>{const p=hero(s),o=[p.position[0],p.position[1]+1.5,p.position[2]],d=target.map((v,i)=>v-o[i]),n=Math.hypot(...d);return {origin:o,direction:d.map(v=>v/n)};};

// Feeding Crystal charges four full shots each, up to twelve; it costs one Crystal from the hero.
let s=fixture({charge:0});
let r=act(s,{action:'inventionUse',structureId:'spire1',feed:true});
assert.equal(r.ok,true,r.code);assert.equal(tower(s).charge,STORMREEL.crystalCharge);assert.equal(hero(s).resources.gems,2);
assert.ok(r.events.some(e=>e.kind==='storm_charge'&&e.crystal));
act(s,{action:'inventionUse',structureId:'spire1',feed:true});act(s,{action:'inventionUse',structureId:'spire1',feed:true});
assert.equal(tower(s).charge,240);assert.equal(act(s,{action:'inventionUse',structureId:'spire1',feed:true}).code,'not_needed');

// The Stormreel only comes off the hook; E takes the pack and equips it, and the pack can't be equipped from the hotbar.
s=fixture({charge:100,gems:2});
assert.equal(act(s,{action:'equip',tool:'stormreel'}).code,'no_pack');
r=act(s,{action:'inventionUse',structureId:'spire1'});
assert.equal(r.ok,true,r.code);assert.equal(hero(s).tool,'stormreel');assert.equal(tower(s).operator,'h');
assert.ok(r.events.some(e=>e.kind==='storm_pack_take'));
assert.equal(tower(s).charge,180,'taking the pack drops in one Crystal when a whole one fits');assert.equal(hero(s).resources.gems,1);

// The cable is the range limit: walking away stops when 45 m of cable (measured round any trees) is paid out.
for(let i=0;i<60*14;i++){s.command('h',{type:'input',seq:seq++,move:{x:-1,z:0},yaw:0});s.step();}
const d=cableLength(tower(s),hero(s).position);
assert.ok(d<=STORMREEL.cable+1e-6&&d>STORMREEL.cable-.5,`held at the end of the cable (was ${d.toFixed(2)} m)`);

// Trees are pegs: walking round a trunk wraps the cable (using some of it up), walking back round unwraps it.
{const b={id:'spire1',type:'stormspire',position:[0,0,0],yaw:0,hp:240,charge:0,operator:'h',wraps:[]},t=terminalPoint(b);
 const peg=[t[0],t[2]+10],st={seed:41,tick:0,players:[],groves:[{id:'peg',trees:[[peg[0],peg[1],5,0,0]]}],inventions:{structures:[b]}};
 const me={id:'h',tool:'stormreel',position:[t[0]+2,0,t[2]+5]};b.wrapAt=[me.position[0],me.position[2]];
 const walk=(x,z)=>{for(let i=1;i<=30;i++){const pos=[me.position[0]+(x-me.position[0])/(31-i),0,me.position[2]+(z-me.position[2])/(31-i)];leash(st,me,pos);me.position=pos;}};
 walk(t[0]+2,t[2]+15);walk(t[0]-2,t[2]+15);
 assert.ok(b.wraps.some(w=>w.id==="peg-tree0"),'swinging behind the trunk wraps the cable round it');
 const around=cableLength(b,me.position);assert.ok(Math.abs(around-(10+Math.hypot(2,5)))<.05,`wrapped length counts the run to the tree (${around.toFixed(2)})`);
 walk(t[0]+2,t[2]+15);assert.ok(!b.wraps.some(w=>w.id==='peg-tree0'),'walking back round unwraps it');}

// Choosing another weapon plants the crossbow where you stand (Mitch, 2026-10-07): spiked into the ground, still wired up.
r=act(s,{action:'equip',tool:'pick'});
assert.equal(r.ok,true);assert.equal(hero(s).tool,'pick');assert.equal(tower(s).operator,null);
{const pl=r.events.find(e=>e.kind==='storm_plant');assert.ok(pl,'planted');assert.ok(tower(s).planted?.red,'the red crossbow stands planted');
 assert.ok(Math.hypot(pl.position[0]-hero(s).position[0],pl.position[2]-hero(s).position[2])<1,'right where you stood');
 assert.ok(!r.events.some(e=>e.kind==='storm_pack_home'),'it does not wind home');
 // Use beside it picks it up again, cable and all.
 const up=act(s,{action:'stormPickup'});assert.equal(up.ok,true,up.code);assert.equal(hero(s).tool,'stormreel');assert.equal(tower(s).operator,'h');assert.equal(tower(s).planted,undefined);
 // G (stormPlant) puts it down on purpose too; too far away, it cannot be picked up.
 assert.equal(act(s,{action:'stormPlant'}).ok,true);assert.ok(tower(s).planted?.red);
 {const k=s.checkpoint();k.players[0].position[0]+=6;s=loadSimulation(k);}assert.equal(act(s,{action:'stormPickup'}).code,'too_far');}

// A full-charge bolt on its own is only a bolt: a little kinetic damage and no lightning (Mitch: the bulk is the circuit).
s=fixture({foes:[8,[1.2,-8]]});
act(s,{action:'inventionUse',structureId:'spire1'});
let c=s.checkpoint(),foe=c.enemies[0],aim=aimAt(s,[foe.position[0],foe.position[1]+1.1,foe.position[2]]);
r=act(s,{action:'storm',...aim,charge:1});
assert.equal(r.ok,true,r.code);
const bolt=r.events.find(e=>e.kind==='storm_bolt');
assert.equal(bolt.targetId,'foe0');assert.equal(bolt.live,true);assert.equal(bolt.probe,'red');
assert.ok(foeHp(s,'foe0')<100&&foeHp(s,'foe0')>=100-STORMREEL.bolt,'kinetic damage only');
assert.equal(foeHp(s,'foe1'),100,'no current spreads from a lone bolt');
assert.equal(tower(s).charge,240-STORMREEL.shotCost,'one full shot of charge spent');
assert.equal(act(s,{action:'storm',...aim,charge:1}).code,'cooldown');

// Walls stop the bolt: a storehouse between the hero and the skeleton takes the hit.
s=fixture({foes:[10]});
{const k=s.checkpoint();k.inventions.structures.push({id:'shed',type:'storehouse',position:[10,terrainHeight(k,10,19),19],yaw:0,hp:STRUCTURES.storehouse.hp,maxHp:STRUCTURES.storehouse.hp,side:'party',builtTick:0,readyTick:0,fireTick:-1000,open:false,charge:0,armed:false,aimYaw:0});s=loadSimulation(k);}
act(s,{action:'inventionUse',structureId:'spire1'});
c=s.checkpoint();foe=c.enemies[0];aim=aimAt(s,[foe.position[0],foe.position[1]+1.1,foe.position[2]]);
r=act(s,{action:'storm',...aim,charge:1});
assert.equal(r.events.find(e=>e.kind==='storm_bolt').blockedId,'shed');assert.equal(s.checkpoint().enemies[0].hp,100,'the skeleton behind the wall is untouched');

// A bolt that kills drops out of the body and falls to the ground instead of hanging in the air.
s=fixture({foes:[8]});
{const k=s.checkpoint();k.enemies[0].hp=3;for(const part of Object.keys(k.enemies[0].parts))k.enemies[0].parts[part]=3;s=loadSimulation(k);}
act(s,{action:'inventionUse',structureId:'spire1'});
c=s.checkpoint();foe=c.enemies[0];aim=aimAt(s,[foe.position[0],foe.position[1]+1.1,foe.position[2]]);
r=act(s,{action:'storm',...aim,charge:1});
{const ev=r.events.find(e=>e.kind==='storm_bolt'),pr=tower(s).probes.red;assert.ok(!s.checkpoint().enemies.some(e=>e.id==='foe0'),'felled by the bolt');
 assert.ok(ev.fell&&pr.fell&&!pr.enemy,'the probe fell out');assert.ok(Math.abs(pr.at[1]-terrainHeight(s.checkpoint(),pr.at[0],pr.at[2]))<.01,'and lies on the ground');}

// An empty tower still throws the bolt, without lightning.
s=fixture({charge:0,gems:0,foes:[8]});
act(s,{action:'inventionUse',structureId:'spire1'});
c=s.checkpoint();foe=c.enemies[0];aim=aimAt(s,[foe.position[0],foe.position[1]+1.1,foe.position[2]]);
r=act(s,{action:'storm',...aim,charge:1});
assert.equal(r.events.find(e=>e.kind==='storm_bolt').live,false);
assert.ok(s.checkpoint().enemies[0].hp>=80,'bolt only');

// A God's lightning bolt on the tower fills it rather than damaging it.
{
  const sim=createSimulation();sim.addPlayer({id:'g',name:'God',role:'god'});
  const k=sim.checkpoint();k.players[0].role='god';k.players[0].mana=100;
  k.inventions.structures.push({id:'spire1',type:'stormspire',position:[20,terrainHeight(k,20,20),20],yaw:0,hp:240,maxHp:240,side:'party',builtTick:0,readyTick:0,fireTick:-1000,open:false,charge:0,armed:false,aimYaw:0});
  const g=loadSimulation(k);const res=g.command('g',{type:'cast',seq:1,spell:'lightning',point:[20,terrainHeight(k,20,20),20]});
  assert.equal(res.ok,true,res.code);
  const b=g.checkpoint().inventions.structures.find(b=>b.id==='spire1');
  assert.equal(b.charge,240);assert.equal(b.hp,240);
}

// Every home base has its own charged Stormspire from the start, its cable terminal facing out of the gate.
{const sim=createSimulation({room:'SOLO'});sim.adventureWorld();sim.step();const k=sim.checkpoint();
 for(const side of ['party','rivals']){const b=k.inventions.structures.find(b=>b.id===`home-stormspire-${side}`);assert.ok(b,`${side} base Stormspire`);assert.equal(b.side,side);assert.equal(b.charge,STORMREEL.maxCharge);
  const t=terminalPoint(b),base=k.battle.bases.find(x=>x.side===side);assert.ok(Math.hypot(t[0],t[2])<Math.hypot(b.position[0],b.position[2]),'terminal on the field side');void base;}
 const again=loadSimulation(JSON.parse(JSON.stringify(k)));again.step();assert.equal(again.checkpoint().inventions.structures.filter(b=>b.type==='stormspire').length,2,'never duplicated');
 // It stands at the front of the keep, just inside the gate (Mitch, 2026-10-10), and an older save's tower behind the heart walks there.
 for(const side of ['party','rivals']){const b=k.inventions.structures.find(b=>b.id===`home-stormspire-${side}`),[x,z]=homePoint(side,HOME_STORMSPIRE.at);
  assert.ok(Math.hypot(b.position[0]-x,b.position[2]-z)<1e-6,`${side} tower at the front`);assert.ok(HOME_STORMSPIRE.at[1]>8,'out toward the gate, in front of the heart');}
 const old=JSON.parse(JSON.stringify(k)),ob=old.inventions.structures.find(b=>b.id==='home-stormspire-party'),[ox,oz]=homePoint('party',[7.6,-5.2]);ob.position=[ox,ob.position[1],oz];ob.wraps=[{id:'t',x:0,z:0,s:1}];
 const moved=loadSimulation(old);moved.step();const mb=moved.checkpoint().inventions.structures.find(b=>b.id==='home-stormspire-party'),[nx,nz]=homePoint('party',HOME_STORMSPIRE.at);
 assert.ok(Math.hypot(mb.position[0]-nx,mb.position[2]-nz)<1e-6&&!mb.wraps,'an older save\'s tower moves to the front');}

// The cable routes round everything it touches (Mitch, 2026-10-10), not just trees: walk a loop out of the keep, round a
// gate ballista, a ward and the tower itself; no run of cable ever passes through a keep solid, and walking back unwinds it.
{const sim=createSimulation({room:'SOLO'});const k=sim.adventureWorld();k.battle.status='running';k.tick=5;
 const l=loadSimulation(k);l.step();const st=l.checkpoint(),b=st.inventions.structures.find(x=>x.id==='home-stormspire-party');
 const me={id:'h',tool:'stormreel',position:[...hookPoint(b,'red')]};b.operator='h';b.wraps=[];b.wrapAt=[me.position[0],me.position[2]];st.players=[me];
 const solids=homeSolids('party'),inside=(x,z)=>solids.some(q=>{if(q.r!==undefined)return Math.hypot(x-q.x,z-q.z)<q.r-.05;const [u,v]=pieceLocal(q,[x,z]);return Math.abs(u-q.at[0])<q.half[0]-.05&&Math.abs(v-q.at[1])<q.half[1]-.05;});
 const clear=()=>{const t=terminalPoint(b,'red'),pts=[[t[0],t[2]],...cableWraps(b,'red').map(w=>[w.x,w.z]),[me.position[0],me.position[2]]];
  for(let i=1;i<pts.length;i++)for(let j=1;j<40;j++)if(inside(pts[i-1][0]+(pts[i][0]-pts[i-1][0])*j/40,pts[i-1][1]+(pts[i][1]-pts[i-1][1])*j/40))return false;return true;};
 const walkTo=([lx,ly])=>{const [tx,tz]=homePoint('party',[lx,ly]);for(let i=0;i<3000;i++){const dx=tx-me.position[0],dz=tz-me.position[2],d=Math.hypot(dx,dz);if(d<.15)break;
  const pos=[me.position[0]+dx/d*Math.min(.1,d),0,me.position[2]+dz/d*Math.min(.1,d)];resolveHomeStructures(st,pos);leash(st,me,pos);me.position=pos;}};
 const route=[[8,15],[12,20],[16,14],[14,6],[10,2],[2,8],[-4,12]];
 for(const at of route){walkTo(at);assert.ok(clear(),`the cable runs clear of the keep at ${at} (${cableWraps(b,'red').map(w=>w.id)})`);}
 assert.ok(cableWraps(b,'red').some(w=>w.id.startsWith('home-party-'))&&cableWraps(b,'red').some(w=>w.id.startsWith('peg-home-stormspire-party')),'it bends round keep pieces and its own tower');
 for(const at of [...route].reverse())walkTo(at);walkTo([6.9,12.7]);assert.equal(cableWraps(b,'red').length,0,'walking back the way you came unwinds it');}

// Indestructible for now (Mitch, 2026-10-10: "it's too fun to kill"): no hammer, spell or foe can knock a Stormspire down,
// foes stop picking it as a target, and a tower knocked down in an older save stands again.
{s=fixture();const k=s.checkpoint();k.inventions.structures.find(b=>b.id==='spire1').hp=0;const l=loadSimulation(k);l.step();
 assert.equal(l.checkpoint().inventions.structures.find(b=>b.id==='spire1').hp,240,'a fallen tower stands again');
 const c=l.checkpoint();assert.equal(damageInvention(c,'spire1',200,null,[],'rivals'),false,'damage does nothing');assert.equal(c.inventions.structures.find(b=>b.id==='spire1').hp,240);}


// The circuit (Mitch, 2026-10-07): a positive bolt and a negative bolt in the SAME foe. A solo Hero lodges the + bolt,
// plants the red crossbow (the bolt stays wired to it), fetches the blue one and lodges the - bolt in the same body.
{s=fixture({foes:[[0,-9,0,'golem'],[-1.5,-9.6]]});const h=hero(s),body=id=>{const e=s.checkpoint().enemies.find(e=>e.id===id);return [e.position[0],e.position[1]+1.4,e.position[2]];};
 act(s,{action:'inventionUse',structureId:'spire1'});assert.equal(tower(s).operator,'h','the first free pack is red');
 let r1=act(s,{action:'storm',...aimAt(s,body('foe0')),charge:1});assert.equal(r1.events.find(e=>e.kind==='storm_bolt').probe,'red');
 assert.equal(tower(s).probes.red.enemy,'foe0','the + bolt rides the golem');
 run(s,STORMREEL.cooldownTicks);
 let r1b=act(s,{action:'storm',...aimAt(s,body('foe0')),charge:1});assert.equal(r1b.events.find(e=>e.kind==='storm_bolt').probe,'red','red stays red: no alternating');
 assert.ok(!r1b.events.some(e=>e.kind==='storm_arc')&&!tower(s).arc,'two positive bolts never close a circuit');
 // Plant the red crossbow with the positive bolt still lodged: it stays connected.
 const drop=act(s,{action:'stormPlant'});assert.equal(drop.ok,true);assert.equal(tower(s).operator,null);assert.ok(tower(s).planted.red);
 run(s,60*4);assert.ok(tower(s).probes?.red?.enemy,'the positive bolt is still lodged while you walk off');
 {const c=s.checkpoint(),p=c.players[0];p.position=[...h.position];for(const e of c.enemies){const [x,z]=[h.position[0]+(e.id==='foe0'?0:-1.5),h.position[2]+(e.id==='foe0'?-9:-9.6)];e.position=[x,terrainHeight(c,x,z),z];e.attackTick=c.tick;}s=loadSimulation(c);}
 const tk=act(s,{action:'inventionUse',structureId:'spire1',pack:'blue'});assert.equal(tk.ok,true,tk.code);assert.equal(tower(s).operator2,'h');
 run(s,STORMREEL.cooldownTicks);
 // A negative bolt in a DIFFERENT foe is an open circuit: nothing flows.
 const other=act(s,{action:'storm',...aimAt(s,body('foe1')),charge:.3});assert.equal(other.events.find(e=>e.kind==='storm_bolt').targetId,'foe1');
 assert.ok(!other.events.some(e=>e.kind==='storm_arc')&&!tower(s).arc,'bolts in two foes do not close the circuit');assert.ok(foeHp(s,'foe1')>80);
 run(s,STORMREEL.cooldownTicks);
 const r2=act(s,{action:'storm',...aimAt(s,body('foe0')),charge:1});assert.equal(r2.events.find(e=>e.kind==='storm_bolt').probe,'blue');
 const arc=r2.events.find(e=>e.kind==='storm_arc');assert.ok(arc,'+ and - in the same foe close the circuit');assert.equal(arc.enemy,'foe0');
 // Instant kill (Mitch, 2026-10-10): even an armoured golem dies in the closing surge, no continuous zapping.
 assert.equal(foeHp(s,'foe0'),0,'the closing surge kills the golem outright');assert.equal(arc.killed,true);assert.equal(arc.creature,'golem');
 assert.ok(r2.events.indexOf(arc)<r2.events.findIndex(e=>e.kind==='death'&&e.id==='foe0'),'the strike leads the death, so the flash lands with the kill');
 assert.ok(foeHp(s,'foe1')<100&&arc.splash.includes('foe1'),'the neighbour is jolted through the soil');
 run(s,2);assert.equal(tower(s).arc,undefined,'the circuit lets go once its foe is dead');
 assert.ok(tower(s).probes.red.fell&&tower(s).probes.blue.fell&&!tower(s).probes.red.enemy,'both bolts fell out of the body');
 // Reel (Q): your own bolt winds back in along its tether and returns part of its charge; the other one stays out.
 const charge0=tower(s).charge,rl=act(s,{action:'stormReel'});assert.equal(rl.ok,true,rl.code);
 assert.ok(rl.events.some(e=>e.kind==='storm_reel'&&e.pack==='blue'),'your own bolt is reeled in');
 assert.ok(tower(s).probes?.red&&!tower(s).probes.blue,'the other polarity stays out');assert.ok(tower(s).charge>charge0,'reeling returns part of the bolt\'s charge');
 // With only the planted red probe left, the blue wearer can still reel it in (so a circuit can always be cleared).
 assert.equal(act(s,{action:'stormReel'}).ok,true);assert.equal(tower(s).probes,undefined);
 assert.equal(act(s,{action:'stormReel'}).code,'not_needed');
 // Nothing left on the hooks: Use at the tower winds the planted red crossbow home.
 {const c=s.checkpoint();c.players[0].position=[9.6,terrainHeight(c,9.6,20.5),20.5];s=loadSimulation(c);}
 act(s,{action:'inventionUse',structureId:'spire1'});assert.equal(tower(s).operator2,null,'Use at the tower hangs up the worn blue pack');
 const tk2=act(s,{action:'inventionUse',structureId:'spire1',pack:'red'});assert.equal(tk2.ok,true,tk2.code);assert.equal(tower(s).operator2,'h','with red still planted out, the blue pack is the free one');
 s.addPlayer({id:'h2',name:'Friend'});{const c=s.checkpoint(),p2=c.players.find(p=>p.id==='h2');p2.position=[9.6,terrainHeight(c,9.6,19.5),19.5];c.players[0].tool='pick';c.inventions.structures.find(b=>b.id==='spire1').operator2=null;s=loadSimulation(c);}
 assert.equal(s.command('h2',{type:'action',seq:1,action:'inventionUse',structureId:'spire1'}).ok,true);assert.equal(tower(s).operator2,'h2','a friend takes the blue pack');
 const recall=act(s,{action:'inventionUse',structureId:'spire1'});assert.equal(recall.ok,true,recall.code);assert.ok(recall.events.some(e=>e.kind==='storm_pack_home'&&e.pack==='red'&&e.from),'the planted crossbow winds home');assert.equal(tower(s).planted,undefined);}

// A lone probe held only by the tower cable pulls free when the target is dragged beyond the tether.
{s=fixture({foes:[[0,-9]]});act(s,{action:'inventionUse',structureId:'spire1'});
 const h=hero(s);act(s,{action:'storm',...aimAt(s,[h.position[0],terrainHeight(s.checkpoint(),h.position[0],h.position[2]-9),h.position[2]-9]),charge:1});
 assert.ok(tower(s).probes?.red);act(s,{action:'inventionUse',structureId:'spire1'});assert.equal(tower(s).operator,null,'hung back on its hook');
 const c=s.checkpoint(),b=c.inventions.structures.find(b=>b.id==='spire1');b.probes.red.at=[b.position[0]+STORMREEL.tether+5,b.position[1],b.position[2]];delete b.probes.red.enemy;const l=loadSimulation(c);
 const ev=[];for(let i=0;i<3;i++)ev.push(...(l.step()?.events||[]));
 assert.ok(!l.checkpoint().inventions.structures.find(b=>b.id==='spire1').probes,'a stretched tether lets go');}

// Two Heroes: the second takes the blue pack, and each Hero's bolts keep their own pack's colour.
{s=fixture();const k=s.checkpoint();s=loadSimulation(k);s.addPlayer({id:'h2',name:'Friend'});const k2=s.checkpoint(),p2=k2.players.find(p=>p.id==='h2');p2.position=[11,terrainHeight(k2,11,24),24];s=loadSimulation(k2);
 act(s,{action:'inventionUse',structureId:'spire1'});const t2=s.command('h2',{type:'action',seq:1,action:'inventionUse',structureId:'spire1'});
 assert.equal(t2.ok,true,t2.code);assert.equal(tower(s).operator,'h');assert.equal(tower(s).operator2,'h2');assert.equal(t2.events.find(e=>e.kind==='storm_pack_take').pack,'blue');
 const x=10,z=17,pt=[x,terrainHeight(s.checkpoint(),x,z),z];
 for(let i=0;i<2;i++){const r=act(s,{action:'storm',...aimAt(s,pt),charge:1});assert.equal(r.events.find(e=>e.kind==='storm_bolt').probe,'red','partnered: always your own colour');run(s,STORMREEL.cooldownTicks);}
 assert.equal(s.command('h',{type:'action',seq:seq++,action:'equip',tool:'pick'}).ok,true);assert.equal(tower(s).operator,null);assert.equal(tower(s).operator2,'h2','the blue pack stays on its wearer');}

// A saved game keeps lodged probes, a planted crossbow and a live circuit, and trims damaged fields instead of choking on them.
{s=fixture({foes:[[0,-9,0,'golem']]});act(s,{action:'inventionUse',structureId:'spire1'});const body=()=>{const e=s.checkpoint().enemies[0];return [e.position[0],e.position[1]+1.4,e.position[2]];};
 {const c=s.checkpoint();c.enemies[0].attackTick=c.tick;s=loadSimulation(c);}
 act(s,{action:'storm',...aimAt(s,body()),charge:.3});act(s,{action:'equip',tool:'pick'});act(s,{action:'inventionUse',structureId:'spire1',pack:'blue'});run(s,STORMREEL.cooldownTicks);
 act(s,{action:'storm',...aimAt(s,body()),charge:.3});assert.ok(tower(s).arc,'circuit up before saving');
 const loaded=loadSimulation(JSON.parse(JSON.stringify(s.checkpoint())));const t2=loaded.checkpoint().inventions.structures.find(b=>b.id==='spire1');
 assert.ok(t2.probes.red&&t2.probes.blue&&t2.arc&&t2.arc.enemy==='foe0'&&t2.planted.red,'probes, planted crossbow and arc survive a save');assert.equal(t2.probes.red.cost>0,true);
 const bad=JSON.parse(JSON.stringify(s.checkpoint()));const bt=bad.inventions.structures.find(b=>b.id==='spire1');bt.probes.red.at=[NaN,0,'x'];bt.operator2={};bt.wraps2='nope';bt.planted.red.at='here';
 const fixed=loadSimulation(bad).checkpoint().inventions.structures.find(b=>b.id==='spire1');assert.ok(!fixed.probes?.red&&!fixed.arc&&fixed.operator2===null&&Array.isArray(fixed.wraps2)&&!fixed.planted,'a damaged save is trimmed');}

// You get the pack hanging beside you: standing by the west hook shoulders the blue one, by the east hook the red one.
{s=fixture({heroAt:[6.2,22]});const c=s.checkpoint(),b=c.inventions.structures.find(x=>x.id==='spire1');
 assert.equal(nearestFreePack(c,b,c.players[0]),'blue');assert.ok(Math.hypot(...hookPoint(b,'blue').map((v,i)=>v-c.players[0].position[i]).filter((_,i)=>i!==1))<Math.hypot(...hookPoint(b,'red').map((v,i)=>v-c.players[0].position[i]).filter((_,i)=>i!==1)));
 assert.equal(act(s,{action:'inventionUse',structureId:'spire1'}).ok,true);assert.equal(tower(s).operator2,'h','the pack beside you is the blue one');assert.ok(!tower(s).operator);
 // ...and bolts from the blue crossbow are negative, whatever the other pack is doing.
 const sf=fixture({heroAt:[6.2,22],foes:[8]});act(sf,{action:'inventionUse',structureId:'spire1'});const f0=sf.checkpoint().enemies[0];
 assert.equal(act(sf,{action:'storm',...aimAt(sf,[f0.position[0],f0.position[1]+1.1,f0.position[2]]),charge:.3}).events.find(e=>e.kind==='storm_bolt').pole,'blue');}

// A lone probe goes cold after 90 s; its cable lets go of the stuck bolt.
{s=fixture({foes:[9]});act(s,{action:'inventionUse',structureId:'spire1'});const f=s.checkpoint().enemies[0];
 act(s,{action:'storm',...aimAt(s,[f.position[0],f.position[1]+1.1,f.position[2]]),charge:.25});assert.ok(tower(s).probes?.red);
 const c=s.checkpoint();c.inventions.structures.find(x=>x.id==='spire1').probes.red.tick=c.tick-STORMREEL.probeSeconds*60-2;const l=loadSimulation(c);
 let lost=null;for(let i=0;i<3&&!lost;i++){const r=l.step();lost=(r?.events||[]).find(e=>e.kind==='storm_probe_lost')||null;}
 assert.ok(!l.checkpoint().inventions.structures.find(x=>x.id==='spire1').probes,'a cold probe is dropped');}

// Saves round-trip a worn pack.
s=fixture();act(s,{action:'inventionUse',structureId:'spire1'});
const saved=loadSimulation(JSON.parse(JSON.stringify(s.checkpoint())));
assert.equal(wornTower(saved.checkpoint(),saved.checkpoint().players[0])?.id,'spire1');
console.log('stormreel: ok');
