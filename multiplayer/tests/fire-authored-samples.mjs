import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareAsset} from '../client/asset-pose.js';
import {createCombatView,partAnchor} from '../client/combat-view.js';
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

import {stepFire,flameExposure} from '../shared/fire.js';
const template=await load('skeleton'),{visual}=prepareAsset(template,'skeleton',1.7);
const scene=new THREE.Scene(),root=new THREE.Group(),camera=new THREE.PerspectiveCamera();root.add(visual);scene.add(root);root.updateMatrixWorld(true);
const enemy=createEnemy('target',[0,0,0]),actor={root,visual,data:enemy,enemy:true};
const view=createCombatView({scene,camera,templates:new Map(),actors:new Map([['e:target',actor]])});
const first=view.fireSamples('target');
assert.ok(first.head.length>0&&first.head.every(p=>p[1]>1.2),'authored head samples lie on the skull, never its floor-level pivot');
assert.ok(first.leftLeg.some(p=>p[1]<.2),'leg samples include actual feet');
assert.ok(Object.values(first).every(p=>p.length<=8),'sampling remains bounded per region');
function apply(cells,surfaces=[]){
 const target=createEnemy('target',[0,0,0]);const state={tick:30,shrine:{hp:0},players:[],enemies:[target],detachedParts:[],fireCells:cells,fireSurfaces:surfaces};
 stepFire(state,{terrainHeight:()=>0,fireSamples:()=>view.fireSamples('target'),damageEnemy:(s,e,n)=>e.hp-=n,damageHero:()=>{}},[]);return target;
}
const low=apply([{x:0,z:0,fuel:1,heat:1,burning:true,wetUntil:0,expiresTick:1800}]);
assert.ok((low.scorch?.leftLeg||0)>0||(low.scorch?.rightLeg||0)>0,'floor fire scorches feet');
assert.equal(low.scorch?.head||0,0,'floor flames cannot scorch distant head');
const high=apply([],[{id:'high',position:[0,1.5,0],normal:[0,1,0],heat:1,expiresTick:1000}]);
assert.ok(high.scorch?.head>0,'raised flame patch reaches actual skull');
assert.equal(high.scorch?.leftLeg||0,0,'raised patch leaves legs untouched');
let head;visual.traverse(n=>{if(n.isBone&&/^Head/.test(n.name))head=n;});assert.ok(head);head.rotation.x+=.2;root.updateMatrixWorld(true);
const later=view.fireSamples('target').head;assert.ok(later.some((p,i)=>new THREE.Vector3(...first.head[i]).distanceTo(new THREE.Vector3(...p))>.005),'cached authored sample follows articulated head');
let skins=0;
visual.traverse(n=>{if(n.isSkinnedMesh){const get=n.getVertexPosition;n.getVertexPosition=function(...a){skins++;return get.apply(this,a);};}});
for(let i=0;i<100;i++)view.fireSamples('target');assert.equal(skins,0,'repeat ecology samples do not reskin vertices');
view.dispose();
const golemTemplate=await load('golem'),golemVisual=prepareAsset(golemTemplate,'golem',2.8).visual,golemRoot=new THREE.Group();golemRoot.add(golemVisual);scene.add(golemRoot);golemRoot.updateMatrixWorld(true);
const golem=createEnemy('golem',[0,0,0],'golem');const golemView=createCombatView({scene,camera,templates:new Map(),actors:new Map([['e:golem',{root:golemRoot,visual:golemVisual,data:golem,enemy:true}]])});
const gs=golemView.fireSamples('golem'),floor=[{position:[0,0,0],radius:1,height:.8}];
assert.ok(gs.head.length>0);assert.equal(flameExposure(gs.head,floor),0,'rigid authored golem skull remains above low fire');
assert.ok(flameExposure(gs.leftLeg,floor)>0||flameExposure(gs.rightLeg,floor)>0,'golem foot surfaces receive low fire');
console.log(JSON.stringify({golemOldHeadOrigin:partAnchor(golemVisual,'head').getWorldPosition(new THREE.Vector3()).toArray(),golemHeadSamples:gs.head.length,minHeadHeight:Math.min(...gs.head.map(p=>p[1]))}));
golemView.dispose();console.log(`fire-authored-samples: ground/head isolation, actual posed skull and bounded cache pass (${((performance.now()-began)/1000).toFixed(3)}s)`);
