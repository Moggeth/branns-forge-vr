import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareAsset} from '../client/asset-pose.js';
import {segmentSurfaceContacts, createCombatView, partAnchor, capturePartPoses} from '../client/combat-view.js';
import {createEnemy, projectileContact, hitEnemyPart, validPartHit} from '../shared/combat.js';
import {createSimulation,loadSimulation} from '../shared/simulation.js';
import {dressSkeleton} from '../client/skeleton-look.js';
import {skeletonShield} from '../shared/skeleton-kinds.js';
const began=performance.now();
function untextured(name){
  const buf=readFileSync(new URL(`../public/assets/${name}.glb`,import.meta.url));
  const jsonLength=buf.readUInt32LE(12),json=JSON.parse(buf.subarray(20,20+jsonLength).toString('utf8'));
  delete json.images;delete json.textures;delete json.samplers;
  for(const m of json.materials||[]){delete m.normalTexture;delete m.occlusionTexture;delete m.emissiveTexture;delete m.extensions;
    if(m.pbrMetallicRoughness){delete m.pbrMetallicRoughness.baseColorTexture;delete m.pbrMetallicRoughness.metallicRoughnessTexture;}}
  if(json.extensionsUsed)json.extensionsUsed=json.extensionsUsed.filter(x=>!/texture/i.test(x));
  let text=Buffer.from(JSON.stringify(json));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,0x20)]);
  const rest=buf.subarray(20+jsonLength),out=Buffer.alloc(12+8+text.length+rest.length);
  out.write('glTF',0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);
  out.writeUInt32LE(text.length,12);out.writeUInt32LE(0x4e4f534a,16);text.copy(out,20);rest.copy(out,20+text.length);
  return out.buffer.slice(out.byteOffset,out.byteOffset+out.length);
}
const load=name=>new Promise((ok,fail)=>new GLTFLoader().parse(untextured(name),'',ok,fail));

const [skeletonTemplate,crossbowTemplate]=await Promise.all([load('skeleton'),load('crossbow')]);
const {visual}=prepareAsset(skeletonTemplate,'skeleton',1.7);dressSkeleton(visual,0); // one variant: one shield, as in game
const scene=new THREE.Scene(), root=new THREE.Group();root.add(visual);scene.add(root);root.updateWorldMatrix(true,true);
let shotLine;
for(let y=.4;y<1.6&&!shotLine;y+=.08)for(let x=-.9;x<=.9&&!shotLine;x+=.04){
 const from=[x,y,2],to=[x,y,-2],front=segmentSurfaceContacts(visual,from,to,'target');
 const back=segmentSurfaceContacts(visual,to,from,'target');
 if(front[0]?.surface==='shield'&&back[0]&&!back[0].surface&&back[0].part!=='head'&&validPartHit(createEnemy('target',[0,0,0]),back[0].part,back[0].point))shotLine={from,to,front:front[0],back:back[0]};
}
assert.ok(shotLine,'authored shield covers a body triangle from front, while a rear shot reaches flesh first');

let sequence=0;
const ctx={nextId:()=>`d${++sequence}`,terrainHeight:()=>0};
function stateFor(kind='bolt',path=[shotLine.from,shotLine.to]){
 return {tick:1,players:[{id:'hero',stats:{contribution:0,kills:0}}],pickups:[],enemies:[createEnemy('target',[0,0,0])],detachedParts:[],embeds:[],projectiles:[{id:'q',kind,ownerId:'hero',position:path.at(-1),previousPosition:path[0],velocity:[0,0,-42],curve:[0,0,0],bornTick:0,trail:path}]};
}
for(const kind of ['arrow','bolt']){
 const s=stateFor(kind),before=structuredClone(s.enemies[0]);
 const result=projectileContact(s,{...shotLine.front,projectileId:'q'},ctx);
 assert.equal(result.ok,true);const {shield:soaked,...after}=s.enemies[0];assert.deepEqual(after,before,'shield does not damage HP, armour, anatomy or hurt timing');assert.ok(soaked>0&&soaked<skeletonShield('target').hp,'the shield itself soaks the blow');
 assert.equal(s.players[0].stats.contribution,0);assert.equal(s.projectiles.length,0);
 assert.equal(s.embeds[0].surface,'shield');assert.equal(s.embeds[0].boneName,'LeftHand');
 assert.deepEqual(s.embeds[0].localPoint,shotLine.front.localPoint);assert.deepEqual(s.embeds[0].localQuaternion,shotLine.front.localQuaternion);
 assert.equal(s.embeds[0].penetration,.035);assert.deepEqual(result.events.map(e=>e.kind),['embed']);assert.equal(result.events[0].blocked,true);
 assert.equal(projectileContact(s,{...shotLine.back,projectileId:'q'},ctx).ok,false,'consumed shot cannot also damage body behind shield');
 const rear=stateFor(kind,[shotLine.to,shotLine.from]);
 assert.equal(projectileContact(rear,{...shotLine.back,projectileId:'q'},ctx).ok,true);
 assert.equal(rear.enemies[0].hp,kind==='bolt'?52:62,'actual body reached first from rear takes normal damage');
}
// The existing multi-segment host sweep must choose the first physical surface,
// across high-speed single frames and sparse snapshots with many 60Hz steps.
const enemy=createEnemy('target',[0,0,0]),actors=new Map([['e:target',{root,visual,data:enemy,enemy:true}]]);
const camera=new THREE.PerspectiveCamera();scene.add(camera);camera.position.set(0,1.6,3);
for(const steps of [1,3,12]){
 const path=Array.from({length:steps+1},(_,i)=>shotLine.from.map((n,a)=>n+(shotLine.to[a]-n)*i/steps));
 let received=[];
 const view=createCombatView({scene,camera,templates:new Map([['crossbow',crossbowTemplate]]),actors,onContact:m=>received.push(m)});
 const s=stateFor('bolt',path);view.sync(s);view.tick(1/60,true);
 assert.equal(received.length,1);assert.equal(received[0].surface,'shield',`shield first with ${steps} path segments`);
 view.tick(1/60,true);assert.equal(received.length,1,'same snapshot does not issue duplicate contacts');
 assert.equal(projectileContact(s,received[0],ctx).ok,true);assert.equal(s.enemies[0].hp,100);view.dispose();
}
// Shield embeds follow their actual weighted bone, then the frozen arm socket.
const s=stateFor();assert.equal(projectileContact(s,{...shotLine.front,projectileId:'q'},ctx).ok,true);
const view=createCombatView({scene,camera,templates:new Map([['crossbow',crossbowTemplate],['skeleton',skeletonTemplate]]),actors});
view.sync(s);const embed=view.embeds.get('q'),arm=partAnchor(visual,'leftArm');
assert.equal(embed.parent.name,'LeftHand');assert.ok(arm.getObjectById(embed.parent.id),'shield hand rides the arm');const tip=embed.getWorldPosition(new THREE.Vector3()),rest=arm.quaternion.clone();
arm.rotateZ(.35);root.updateWorldMatrix(true,true);const moved=embed.getWorldPosition(new THREE.Vector3());
assert.ok(moved.distanceTo(tip)>.05,'shield arrow follows articulated arm movement');
const poses=capturePartPoses(visual),events=[];
hitEnemyPart(s,s.enemies[0],'leftArm',60,{point:shotLine.front.point,partPoses:poses,ownerId:'hero'},ctx,events);
const loose=s.detachedParts.find(d=>d.part==='leftArm');assert.ok(loose);assert.equal(s.embeds[0].targetId,loose.id);
view.sync(s);assert.equal(embed.parent.name,'LeftHand');assert.ok(embed.getWorldPosition(new THREE.Vector3()).distanceTo(moved)<.02,'detachment retains shield embed pose');
const frozen=view.detached.get(loose.id);let shieldMeshes=0;frozen.traverse(n=>{if(n.isMesh&&n.userData.contactSurface==='shield')shieldMeshes++;});assert.ok(shieldMeshes,'baked shield retains physical shield surface classification');
arm.quaternion.copy(rest);root.updateWorldMatrix(true,true);view.dispose();
// Save/migration allowlists retain shield protection and exact local transforms.
const sim=createSimulation();sim.addPlayer({id:'hero'});const saved=sim.checkpoint();saved.tick=s.tick;
saved.enemies=s.enemies;saved.detachedParts=s.detachedParts;saved.embeds=s.embeds;
const migrated=loadSimulation(saved);assert.deepEqual(migrated.snapshot().embeds,s.embeds);
assert.deepEqual(loadSimulation(migrated.checkpoint()).snapshot(),migrated.snapshot());
for(const mutate of [e=>e.surface='invulnerable',e=>e.part='head',e=>e.targetId='world']){
 const bad=structuredClone(saved);mutate(bad.embeds[0]);assert.throws(()=>loadSimulation(bad));
}
const stale=stateFor();stale.enemies[0].missingParts.push('leftArm');
assert.equal(projectileContact(stale,{...shotLine.front,projectileId:'q'},ctx).ok,false,'missing shield-bearing limb cannot block');
console.log(`shield-interception: real shield front/rear, zero damage, swept-step ordering, animated and detached embeds, migration pass (${((performance.now()-began)/1000).toFixed(3)}s)`);
// Shields splinter: arrows and bolts wear them down (no damage through), the last blow breaks it, the
// skeleton flinches and its shield arm no longer blocks. A golden bolt shatters any shield outright and
// bursts on through to the body behind.
{
 const s=stateFor('arrow'),max=skeletonShield('target').hp,enemy=s.enemies[0];let broke=null;
 for(let i=0;i<max&&!broke;i++){s.projectiles=[stateFor('arrow').projectiles[0]];const r=projectileContact(s,{...shotLine.front,projectileId:'q'},ctx);assert.equal(r.ok,true);broke=r.events.find(e=>e.kind==='shield_break');}
 assert.ok(broke,'repeated arrows break the shield');assert.equal(enemy.hp,100);assert.equal(enemy.shieldBroken,true);assert.equal(enemy.flinchTick,s.tick);
 assert.ok(!s.embeds.some(e=>e.surface==='shield'),'arrows in the shield fall with it');
 s.projectiles=[stateFor('arrow').projectiles[0]];assert.equal(projectileContact(s,{...shotLine.front,projectileId:'q'},ctx).ok,false,'a broken shield no longer intercepts');
 const sim=createSimulation();sim.addPlayer({id:'hero'});const saved=sim.checkpoint();saved.tick=s.tick;saved.enemies=[{...enemy}];assert.equal(loadSimulation(saved).snapshot().enemies[0].shieldBroken,true,'a broken shield stays broken across save/load');
 const g=stateFor('bolt');g.projectiles[0].golden=true;const gr=projectileContact(g,{...shotLine.front,projectileId:'q'},ctx);
 assert.equal(gr.ok,true);assert.ok(gr.events.some(e=>e.kind==='shield_break'&&e.golden));assert.equal(g.projectiles.length,1,'golden bolt flies on');
 assert.equal(projectileContact(g,{...shotLine.front,projectileId:'q'},ctx).ok,false,'never the same shield twice');
 const body=projectileContact(g,{...shotLine.back,projectileId:'q'},ctx);assert.equal(body.ok,true);assert.ok(body.events.some(e=>e.kind==='death'),'and kills the skeleton behind it');
}
console.log('shield break + golden pierce ok');
