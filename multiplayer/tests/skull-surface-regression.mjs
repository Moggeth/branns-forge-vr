import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareAsset} from '../client/asset-pose.js';
import {segmentSurfaceContacts} from '../client/combat-view.js';
import {createEnemy, projectileContact, validPartHit} from '../shared/combat.js';
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

const skeletonTemplate=await load('skeleton');
const {visual}=prepareAsset(skeletonTemplate,'skeleton',1.7);
const scene=new THREE.Scene(), root=new THREE.Group();root.add(visual);scene.add(root);root.updateMatrixWorld(true);
let count=0,previouslyRejected=0;
for(const side of [-1,1])for(let y=1.22;y<=1.76;y+=.02)for(let x=-.20;x<=.20;x+=.02){
 const h=segmentSurfaceContacts(visual,[x,y,side],[x,y,-side],'target',undefined,{includePartPoses:false})[0];
 if(h?.part==='head'){count++;if(Math.hypot(h.point[0],h.point[1]-1.75,h.point[2])>.4)previouslyRejected++;assert.ok(validPartHit(createEnemy('target',[0,0,0]),'head',h.point),`actual head triangle rejected ${h.point}`);}
}
assert.ok(previouslyRejected>0,'scan covers previously rejected jaw/face surfaces');
assert.ok(count>400,'dense front and rear scan must exercise authored head surfaces');
const shots=[['forehead',0,1.60,-1,1],['eye-left',-.065,1.53,-1,1],['eye-right',.065,1.53,-1,1],['jaw',.06,1.38,-1,1],['rear',0,1.55,1,-1],['glance',-.10,1.6,-1,1]];
for(const [name,x,y,z0,z1] of shots)for(const yaw of [0,.7,-1.4]){
 // Match renderer traversal: SkinnedMesh updates its bind inverse here.
 root.rotation.y=yaw;root.updateMatrixWorld(true);
 const from=new THREE.Vector3(x,y,z0).applyAxisAngle(new THREE.Vector3(0,1,0),yaw).toArray();
 const to=new THREE.Vector3(x,y,z1).applyAxisAngle(new THREE.Vector3(0,1,0),yaw).toArray();
 for(const steps of [1,4,32]){
  let hit=null;
  for(let i=0;i<steps&&!hit;i++){
   const a=from.map((n,k)=>n+(to[k]-n)*i/steps),b=from.map((n,k)=>n+(to[k]-n)*(i+1)/steps);
   hit=segmentSurfaceContacts(visual,a,b,'target')[0];
  }
  assert.equal(hit?.part,'head',`${name}, yaw=${yaw}, ${steps} segments must reach actual skull`);
  for(const kind of ['arrow','bolt']){
   const enemy=createEnemy('target',[0,0,0]);enemy.yaw=yaw;
   const state={tick:1,players:[],pickups:[],enemies:[enemy],detachedParts:[],embeds:[],projectiles:[{id:'q',kind,ownerId:'hero',curve:[0,0,0],trail:[from,to]}]};
   let seq=0;const result=projectileContact(state,{...hit,projectileId:'q'},{nextId:()=>`d${++seq}`,terrainHeight:()=>0});
   assert.ok(result.ok,`${kind} ${name} authority rejected actual surface`);
   assert.ok(enemy.hp<100||enemy.missingParts.includes('head'),'actual skull shot damages the enemy');
   assert.equal(state.projectiles.length,0);assert.equal(state.embeds[0].part,'head');
   assert.deepEqual(state.embeds[0].localPoint,hit.localPoint);assert.equal(state.embeds[0].boneName,hit.boneName);
  }
 }
}
root.rotation.y=0;root.updateMatrixWorld(true);
assert.equal(segmentSurfaceContacts(visual,[.21,1.55,-1],[.21,1.55,1],'target').length,0,'near silhouette miss remains a miss; authority envelope creates no contacts');
const missing=createEnemy('target',[0,0,0]);missing.missingParts.push('head');assert.equal(validPartHit(missing,'head',[0,1.5,0]),false);
assert.equal(validPartHit(createEnemy('target',[0,0,0]),'head',[0,2.05,0]),false,'space above the real skull is outside sanity envelope');
console.log(`skull-surface: ${count} actual front/rear triangles (${previouslyRejected} formerly rejected), forehead/eye sockets/jaw/rear/glancing, three yaws, 1/4/32 sweep steps, arrow/bolt authority and exact embeds pass (${((performance.now()-began)/1000).toFixed(3)}s)`);
