import assert from 'node:assert/strict';
import * as T from 'three';
import {ASSET_POSES,assetBasis,prepareAsset,setWeaponGrip} from '../client/asset-pose.js';
for (const [name, c] of Object.entries(ASSET_POSES)) {
 const basis=assetBasis(c);
 for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2,.37]) {
  const rotation=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),yaw);
  const front=new T.Vector3(...c.forward).applyQuaternion(basis).applyQuaternion(rotation);
  assert.ok(front.distanceTo(new T.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)))<1e-6, name+' agrees with simulation heading');
 }
 assert.ok(new T.Vector3(...c.up).applyQuaternion(basis).distanceTo(new T.Vector3(0,1,0))<1e-6);
}
const scene=new T.Group();scene.position.set(2,3,4);const mesh=new T.Mesh(new T.BoxGeometry(.1,1,.1));scene.add(mesh);const socket=new T.Group();socket.name='Grip_Center';socket.position.y=-.3;scene.add(socket);
const {visual,model}=prepareAsset({scene},'axe');
for(const xr of [true,false,true,false]){setWeaponGrip(visual,xr);visual.updateWorldMatrix(true,true);assert.ok(visual.getObjectByName('Grip_Center').getWorldPosition(new T.Vector3()).length()<1e-6);}
assert.deepEqual(model.position.toArray(),[2,3,4],'source root transform retained');
assert.throws(()=>prepareAsset({scene:new T.Group()},'unregistered'),/Unreviewed/);
assert.throws(()=>prepareAsset({scene:new T.Mesh(new T.BoxGeometry())},'axe'),/Missing/);
assert.throws(()=>assetBasis({forward:[0,1,0],up:[0,1,0]}),/perpendicular/);
console.log('PASS: 15 cardinal/oblique headings, up axes, socket origin, XR/desktop reattachment, source root transforms and invalid contracts');
const bow=new T.Group(),feather=new T.Object3D();feather.position.set(.3,.4,-.1);bow.add(feather);
for(const xr of [false,true]){setWeaponGrip(bow,xr,'bow','left');bow.updateWorldMatrix(true,true);assert.ok(feather.getWorldPosition(new T.Vector3()).x<0);assert.ok(new T.Vector3(0,0,-1).transformDirection(bow.matrixWorld).distanceTo(new T.Vector3(0,0,-1))<1e-9);setWeaponGrip(bow,xr,'bow','right');bow.updateWorldMatrix(true,true);assert.ok(feather.getWorldPosition(new T.Vector3()).x>0);}
console.log('PASS: left bow mirrors feathers while keeping up/forward and resets for right hand');
