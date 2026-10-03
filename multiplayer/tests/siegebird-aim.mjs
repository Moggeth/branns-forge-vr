import assert from 'node:assert/strict';
import * as T from 'three';import {readFileSync} from 'node:fs';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareAsset,weaponTip,weaponForward} from '../client/asset-pose.js';import {createSiegebirdSight} from '../client/siegebird-sight.js';import {createSiegebirdAim} from '../client/siegebird-aim.js';import {sampleSiegebirdTrajectory} from '../client/siegebird-ballistics.js';
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
const gltf=await new GLTFLoader().parseAsync(untextured('crossbow'),'');
for(const pitch of [-.55,0,.55]){
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(70,16/9,.05,180),anchor=new T.Group();camera.rotation.x=pitch;scene.add(camera);camera.add(anchor);
 const weapon=prepareAsset(gltf,'crossbow').visual;anchor.add(weapon);const sight=createSiegebirdSight(T,weapon),aim=createSiegebirdAim({anchor,weapon,camera,sight});
 for(let i=0;i<100;i++)aim.update(1/60,true);
 const muzzle=camera.worldToLocal(weaponTip(weapon,'crossbow')),q=camera.getWorldQuaternion(new T.Quaternion()).invert(),direction=weaponForward(weapon,'crossbow').applyQuaternion(q),gravity=new T.Vector3(0,-3,0).applyQuaternion(q);
 const hit=sampleSiegebirdTrajectory({muzzle:muzzle.toArray(),direction:direction.toArray(),gravity:gravity.toArray(),range:30});assert.ok(Math.hypot(hit.position[0],hit.position[1])<.03,JSON.stringify(hit));
 const eye=sight.eye.clone().applyQuaternion(anchor.quaternion).add(anchor.position);assert.ok(Math.hypot(eye.x,eye.y)<1e-5);assert.equal(sight.state.zeroOutOfTravel,false);
 const zero=new T.Vector3(...sight.state.placed[30]).applyQuaternion(anchor.quaternion).add(anchor.position);assert.ok(Math.hypot(zero.x,zero.y)<.001);
 for(const range of [50,70]){const mark=new T.Vector3(...sight.state.placed[range]).applyQuaternion(anchor.quaternion).add(anchor.position);assert.ok(mark.y<0);}
 for(let i=0;i<100;i++)aim.update(1/60,false);assert.ok(aim.amount<.001);sight.dispose();
}
console.log('siegebird-aim: actual GLB muzzle/bore zero, tilted camera, physical eyepoint and lower marks pass');
