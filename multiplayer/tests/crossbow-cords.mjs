import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareAsset,updateWeaponPresentation,weaponTip,weaponForward,ASSET_POSES} from '../client/asset-pose.js';

const began=performance.now();
async function asset(name){
  const bytes=readFileSync(new URL(`../public/assets/${name}.glb`,import.meta.url));
  const jsonLength=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+jsonLength).toString('utf8'));
  delete json.images;delete json.textures;delete json.samplers;
  for(const material of json.materials||[]){delete material.normalTexture;delete material.occlusionTexture;delete material.emissiveTexture;delete material.extensions;
    if(material.pbrMetallicRoughness){delete material.pbrMetallicRoughness.baseColorTexture;delete material.pbrMetallicRoughness.metallicRoughnessTexture;}}
  if(json.extensionsUsed)json.extensionsUsed=json.extensionsUsed.filter(x=>!/texture/i.test(x));
  let text=Buffer.from(JSON.stringify(json));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,0x20)]);
  const rest=bytes.subarray(20+jsonLength),out=Buffer.alloc(12+8+text.length+rest.length);
  out.write('glTF',0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(text.length,12);out.writeUInt32LE(0x4e4f534a,16);text.copy(out,20);rest.copy(out,20+text.length);
  return new GLTFLoader().parseAsync(out.buffer.slice(out.byteOffset,out.byteOffset+out.length),'');
}
const [crossbow,pick]=await Promise.all([asset('crossbow'),asset('pick')]);
const {visual}=prepareAsset(crossbow,'crossbow');
const names=['LiveCord_00','LiveCord_01','LiveCord_19'];
const cords=names.map(name=>{const node=visual.getObjectByName(name);assert.ok(node?.isMesh,`${name} exists in shipped GLB`);return node;});
function endpoints(node){
  node.geometry.computeBoundingBox();const box=node.geometry.boundingBox;
  node.updateWorldMatrix(true,false);
  return [box.min.y,box.max.y].map(y=>node.localToWorld(new THREE.Vector3(0,y,0)));
}
const source=cords.map(node=>({node,geometry:node.geometry,positionVersion:node.geometry.attributes.position.version,
  geometryData:node.geometry.attributes.position.array.slice(),material:node.material}));
const native=visual.getObjectByName('Pinion').parent;
function wingTip(){ // morphed outermost wing vertex (+x) in the native frame
  const inv=native.matrixWorld.clone().invert(),v=new THREE.Vector3();let best=null;
  visual.getObjectByName('Wings').traverse(o=>{if(!o.isMesh)return;for(let i=0;i<o.geometry.attributes.position.count;i++){o.getVertexPosition(i,v);v.applyMatrix4(o.matrixWorld).applyMatrix4(inv);if(!best||v.x>best.x)best=v.clone();}});
  return best;
}
const samples=[];
for(const recoil of [0,.25,.5,.75,1,0]){
  updateWeaponPresentation(visual,'crossbow',{recoil,time:0});
  visual.updateWorldMatrix(true,true);
  const inv=native.matrixWorld.clone().invert();
  samples.push({recoil,sled:visual.getObjectByName('Sled').position.y,
    sledWorld:visual.getObjectByName('Sled').getWorldPosition(new THREE.Vector3()).clone(),
    ends:cords.map(endpoints),native:cords.map(n=>endpoints(n).map(p=>p.applyMatrix4(inv))),wing:wingTip(),tip:weaponTip(visual,'crossbow').clone(),
    direction:weaponForward(visual,'crossbow').clone()});
}
for(const {node,geometry,positionVersion,geometryData,material} of source){
  assert.equal(node.geometry,geometry,'cord transforms retain shared authored geometry');
  assert.equal(node.material,material,'cord transforms retain authored material');
  assert.equal(geometry.attributes.position.version,positionVersion,'cord vertices are not rewritten each frame');
  assert.deepEqual(geometry.attributes.position.array,geometryData);
}
const other=prepareAsset(crossbow,'crossbow').visual;
for(const name of names){
  assert.equal(other.getObjectByName(name).geometry,visual.getObjectByName(name).geometry,'separate crossbows share authored cord geometry');
  assert.equal(other.getObjectByName(name).material,visual.getObjectByName(name).material,'separate crossbows share authored cord material');
}
updateWeaponPresentation(other,'crossbow',{recoil:1,time:0});
const firstCordBefore=endpoints(cords[0]);
updateWeaponPresentation(other,'crossbow',{recoil:0,time:0});
const firstCordAfter=endpoints(cords[0]);
assert.ok(firstCordBefore.every((p,i)=>p.distanceTo(firstCordAfter[i])<1e-6),'one crossbow recoil does not deform another clone');
assert.ok(visual.getObjectByName(ASSET_POSES.crossbow.tip),'authored bolt origin is present');
const first=samples[0];
for(const sample of samples){
  assert.ok(sample.tip.distanceTo(first.tip)<1e-6,'bolt socket is fixed throughout cord recoil');
  assert.ok(sample.direction.distanceTo(first.direction)<1e-6,'canonical launch direction is unaffected by cord recoil');
  assert.ok(sample.direction.distanceTo(new THREE.Vector3(0,0,-1))<1e-6);
  // Bowstrings: the outer end rides the morphed limb (a constant reach inside the outermost feather) and the inner
  // end sits on the nock at the sled. Haul cable: the guide end is fixed and the anchor end follows the sled.
  for(let i=0;i<2;i++){
    const [outer,inner]=[...sample.native[i]].sort((p,q)=>Math.abs(q.x)-Math.abs(p.x));
    const reach=new THREE.Vector3(Math.abs(outer.x),outer.y,outer.z).distanceTo(sample.wing);
    assert.ok(reach>.09&&reach<.12,`${names[i]} outer end follows the limb at recoil ${sample.recoil} (${reach.toFixed(3)} m from the wing tip)`);
    assert.ok(inner.distanceTo(new THREE.Vector3(0,sample.sled,.179))<.006,`${names[i]} inner end on the nock (arm overshoot and hum aside) at recoil ${sample.recoil}`);
  }
  {
    const base=first.ends[2],current=sample.ends[2];
    assert.ok(current[0].distanceTo(base[0])<1e-4,`${names[2]} guide end is fixed at recoil ${sample.recoil}`);
    const expected=base[1].clone().add(sample.sledWorld).sub(first.sledWorld);
    assert.ok(current[1].distanceTo(expected)<1e-4,`${names[2]} anchor end follows sled at recoil ${sample.recoil}: actual=${current[1].toArray()} expected=${expected.toArray()}`);
  }
}
const preparedPick=prepareAsset(pick,'pick');
assert.ok(preparedPick.visual.getObjectByName('Grip'),'restored authored pick grip exists');
assert.ok(preparedPick.visual.getObjectByName('PickTipRight'),'restored pick tip socket exists');
assert.ok(weaponTip(preparedPick.visual,'pick').distanceTo(preparedPick.visual.getObjectByName('PickTipRight').getWorldPosition(new THREE.Vector3()))<1e-6);
console.log(`crossbow-cords: strings ride the morphed limbs to the nock, sled motion, shared geometry, launch basis and pick sockets pass (${((performance.now()-began)/1000).toFixed(3)}s)`);
