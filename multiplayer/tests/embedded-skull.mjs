import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareAsset} from '../client/asset-pose.js';
import {createEmberdewModel} from '../client/fire-presentation.js';
import {createCombatView, segmentSurfaceContacts, capturePartPoses, partAnchor} from '../client/combat-view.js';
import {createEnemy, projectileContact, stepCombat} from '../shared/combat.js';
import {createSimulation, loadSimulation} from '../shared/simulation.js';

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
const {visual}=prepareAsset(skeletonTemplate,'skeleton',1.7),scene=new THREE.Scene(),actorRoot=new THREE.Group();
const camera=new THREE.PerspectiveCamera();camera.position.set(0,1.6,3);scene.add(camera);
actorRoot.add(visual);scene.add(actorRoot);actorRoot.updateWorldMatrix(true,true);
const enemy=createEnemy('target',[0,0,0]),actor={root:actorRoot,visual,data:enemy,enemy:true};
const actors=new Map([['e:target',actor]]);
let contact=null;
for(const y of [1.5,1.6,1.7,1.8,1.9])for(const x of [0,-.06,.06,-.12,.12]){
  const hit=segmentSurfaceContacts(visual,[x,y,1],[x,y,-1],'target').find(q=>q.part==='head');
  if(hit&&!contact)contact=hit;
}
assert.ok(contact,'actual shipped skull must receive an anatomical triangle contact');
assert.ok(contact.localNormal&&contact.impactThickness>0,'contact records bone-local surface normal and geometric travel');
assert.ok(Math.abs(Math.hypot(...contact.localNormal)-1)<1e-3);

// The host computes visual penetration from measured geometry; an untrusted
// client cannot choose its own embed depth.
let detachedId=0;
const impactState={tick:1,players:[],pickups:[],enemies:[createEnemy('target',[0,0,0])],detachedParts:[],embeds:[],
  projectiles:[{id:'q',kind:'bolt',ownerId:'hero',trail:[contact.point.map((v,i)=>v+(i===2?1:0)),contact.point.map((v,i)=>v-(i===2?1:0))]}]};
const impact=projectileContact(impactState,{...contact,projectileId:'q',penetration:0},
  {nextId:()=>`d${++detachedId}`,terrainHeight:()=>0});
assert.equal(impact.ok,true,'the real skull triangle is accepted by the host sweep');
assert.ok(impactState.embeds[0].penetration>=.06&&impactState.embeds[0].penetration<=.17);
assert.notEqual(impactState.embeds[0].penetration,0,'host ignores spoofed visual depth');
assert.deepEqual(impactState.embeds[0].localNormal,contact.localNormal);

const embed={id:'q1',kind:'bolt',targetId:'target',part:'head',point:contact.point,normal:contact.normal,
  localPoint:contact.localPoint,localNormal:contact.localNormal,localQuaternion:contact.localQuaternion,
  penetration:.12,boneName:contact.boneName};
const flaskTemplate=createEmberdewModel();
const view=createCombatView({scene,templates:new Map([['crossbow',crossbowTemplate],['flask',{scene:flaskTemplate}]]),actors,camera});
view.sync({tick:1,enemies:[enemy],detachedParts:[],embeds:[embed]});
view.tick(1/60,false);
assert.equal(view.rangedEffectStats().fracturesVisible,1,'one pooled impact mark follows the live skull');
assert.equal(view.forEachEmbedFracture((mark,anchor)=>{assert.equal(mark.id,'q1');assert.equal(anchor.name,contact.boneName);}),1);
const bolt=view.embeds.get('q1'),head=bolt?.parent;
assert.ok(bolt&&head?.isBone&&head.name===contact.boneName,'bolt is parented to the struck authored skull bone');
const entryDirection=new THREE.Vector3(0,0,-1),hitPoint=new THREE.Vector3().fromArray(contact.point);
const tip=bolt.getWorldPosition(new THREE.Vector3());
assert.ok(Math.abs(tip.clone().sub(hitPoint).dot(entryDirection)-.12)<.003,'bolt tip penetrates 12 cm into the actual skull');
assert.deepEqual(bolt.userData.fracture.localNormal,contact.localNormal,'fracture stays at the original bone-local surface tangent');

head.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),1.2));
actorRoot.updateWorldMatrix(true,true);
const turnedTip=bolt.getWorldPosition(new THREE.Vector3());
assert.ok(turnedTip.distanceTo(tip)>.003,'embedded bolt follows animated skull rotation');
view.tick(1/60,false);
const fractureMatrix=new THREE.Matrix4();
const fractureMesh=scene.getObjectByName('ranged-embed-fractures');
fractureMesh.getMatrixAt(0,fractureMatrix);
const liveFracture=new THREE.Vector3().setFromMatrixPosition(fractureMatrix);

const pose=capturePartPoses(visual).head;
assert.ok(pose.localBounds,'actual skull has precise detached bounds');
const detached={id:'dhead',sourceId:'target',kind:'skeleton',part:'head',position:pose.position,quaternion:pose.quaternion,
  localBounds:pose.localBounds,velocity:[0,0,0],angularVelocity:[0,0,0],heldBy:null,bornTick:1};
view.sync({tick:2,enemies:[],detachedParts:[detached],embeds:[{...embed,targetId:'dhead'}]});
view.tick(1/60,false);
assert.equal(bolt.parent.name,contact.boneName,'frozen skull retains the exact struck bone socket');
assert.ok(bolt.getWorldPosition(new THREE.Vector3()).distanceTo(turnedTip)<.02,'bolt does not jump during living-to-detached handoff');
fractureMesh.getMatrixAt(0,fractureMatrix);
assert.ok(new THREE.Vector3().setFromMatrixPosition(fractureMatrix).distanceTo(liveFracture)<.02,
  'surface fracture keeps its world position through the same bone handoff');

const hero={id:'hero',role:'hero',position:[2,0,3],yaw:0,tool:'limb',hands:[{position:[-.3,1.2,-.4],quaternion:[0,0,0,1]},
  {position:[.3,1.2,-.5],quaternion:[0,0,0,1]}]};
const state={tick:3,players:[hero],projectiles:[],enemies:[],detachedParts:[{...detached,heldBy:'hero'}]};
stepCombat(state,{terrainHeight:()=>0},[]);
const held=state.detachedParts[0],mid=pose.localBounds.min.map((n,i)=>(n+pose.localBounds.max[i])*.5);
const visibleCenter=new THREE.Vector3().fromArray(mid).applyQuaternion(new THREE.Quaternion().fromArray(held.quaternion)).add(new THREE.Vector3().fromArray(held.position));
const grip=new THREE.Vector3(2.3,1.2,2.5);
assert.ok(visibleCenter.distanceTo(grip)<.001,'visible skull centre sits at the tracked VR hand, not its neck pivot');
view.sync({tick:3,enemies:[],detachedParts:[held],embeds:[{...embed,targetId:'dhead'}]});view.tick(.05,false);
assert.ok(bolt.parent?.parent,'embedded bolt stays attached to the held skull');
const heldTip=bolt.getWorldPosition(new THREE.Vector3());
assert.ok(heldTip.distanceTo(turnedTip)>1,'held skull carries the embedded bolt to the hand');

// Desktop fallback uses the visible right-hand area, not the old distant 1.2 m reach.
delete hero.hands;hero.position=[0,0,0];hero.yaw=0;stepCombat(state,{terrainHeight:()=>0},[]);
const desktop=state.detachedParts[0],desktopCenter=new THREE.Vector3().fromArray(mid).applyQuaternion(new THREE.Quaternion().fromArray(desktop.quaternion)).add(new THREE.Vector3().fromArray(desktop.position));
assert.ok(desktopCenter.distanceTo(new THREE.Vector3(.3,1.2,-.7))<.001,'desktop skull is centred near the visible right-hand grip');

const fpsGrip=new THREE.Group();camera.add(fpsGrip);fpsGrip.position.set(.3,-.3,-.55);
camera.position.set(0,1.65,0);camera.rotation.order='YXZ';camera.rotation.set(-.5,.35,0);
const beforePitch=bolt.getWorldPosition(new THREE.Vector3());
assert.equal(view.poseLocalHeld('hero',fpsGrip),true);
const localSkull=view.detached.get('dhead'),actualCentre=new THREE.Vector3().fromArray(mid)
  .applyQuaternion(localSkull.getWorldQuaternion(new THREE.Quaternion())).add(localSkull.getWorldPosition(new THREE.Vector3()));
assert.ok(actualCentre.distanceTo(fpsGrip.getWorldPosition(new THREE.Vector3()))<.001,'local held skull follows camera pitch at the rendered weapon grip');
assert.ok(bolt.getWorldPosition(new THREE.Vector3()).distanceTo(beforePitch)>.1,'embedded bolt follows the same camera-pitched skull');
assert.equal(view.rangedEffectStats().fracturesVisible,1,'pooled mark reanchors to the held skull');

view.sync({tick:4,enemies:[],detachedParts:[],embeds:[],projectiles:[{id:'flight',kind:'bolt',position:[0,1,0],velocity:[0,0,-22],trail:[[0,1,0],[0,1,-.2]],bornTick:3}]});
view.tick(1/60,false);
assert.equal(view.rangedEffectStats().streaksVisible,1,'bolt uses one pooled flight streak');
assert.equal(view.rangedEffectStats().fracturesStored,0,'impact mark is released when the embed disappears');
view.sync({tick:5,enemies:[],detachedParts:[],embeds:[],projectiles:[{id:'fuel',kind:'fuel',lit:true,position:[0,1,0],velocity:[2,3,-6],trail:[[0,1,0]],bornTick:5}]});
view.tick(1/60,false,5);
const fuel=view.projectiles.get('fuel');
assert.ok(fuel?.userData.emberdew?.stats().lit,'fuel clone has armed Ember Dew liquid and wick');
assert.equal(view.rangedEffectStats().streaksVisible,0,'fuel adds no bolt/arrow streak');
view.sync({tick:6,enemies:[],detachedParts:[],embeds:[],projectiles:[]});
assert.equal(view.projectiles.size,0,'fuel FX disposes with the thrown bottle');

const sim=createSimulation();sim.addPlayer({id:'hero',role:'hero'});
const saved=sim.checkpoint();saved.enemies.push(enemy);saved.embeds.push(embed);
const restored=loadSimulation(saved).snapshot().embeds[0];
assert.deepEqual(restored.localNormal,contact.localNormal);assert.equal(restored.penetration,.12);
for(const invalid of [{...embed,penetration:.5},{...embed,localNormal:[0,5,0]}]){
  const bad=structuredClone(saved);bad.embeds=[invalid];assert.throws(()=>loadSimulation(bad),'malformed embed metadata is rejected');
}
view.dispose();
console.log(`embedded-skull: bone penetration, fracture handoff, FPS grip pitch, ranged pools, fuel FX and save restore pass (${((performance.now()-began)/1000).toFixed(3)}s)`);
