import assert from 'node:assert/strict';
import * as T from 'three';
import {createStartingWorld} from '../client/starting-world.js';

const start = performance.now();
let rise = 0;
const height = (x,z) => rise * Math.max(0, 1 - Math.hypot(x + 25,z - 8) / 12);
const scene = new T.Scene(), world = createStartingWorld({THREE:T,scene,height});
const merged = () => world.group.children.filter(o=>o.isMesh);
const originals = merged().map(o=>o.geometry);
for (let i=0;i<40;i++) assert.equal(world.update(),false);
assert.equal(world.stats().builds,1,'unchanged terrain never rebuilds landmark geometry');
for(const h of [1,.5,2,-1,0,1.23]) {rise=h;world.update();}
assert.deepEqual(merged().map(o=>o.geometry), originals, 'deformation retains merged buffers');
const reference = createStartingWorld({THREE:T,scene:new T.Scene(),height});
const expected = reference.group.children.filter(o=>o.isMesh);
for(const [n,m] of merged().entries()) {
 for(const piece of m.userData.terrainPieces)for(let i=piece.start;i<piece.start+piece.count;i++)assert.ok(piece.box.containsPoint(new T.Vector3().fromBufferAttribute(m.geometry.attributes.position,i)),'bounds contain rounded uploaded vertices');
 const actual=m.geometry.attributes.position.array, wanted=expected[n].geometry.attributes.position.array;
 assert.equal(actual.length,wanted.length);
 for(let i=0;i<actual.length;i++) assert.ok(Math.abs(actual[i]-wanted[i])<4e-6,`deformed vertex ${n}:${i}`);
 assert.deepEqual(m.geometry.attributes.normal.array,expected[n].geometry.attributes.normal.array);
}
// Compare exact native Three triangle hits, including IDs/face indices. The
// non-uniform world transform catches accidental local/world distance mixing.
world.group.position.set(2,1,-3);world.group.scale.set(1.2,.8,1.4);world.group.rotation.y=.31;scene.updateMatrixWorld(true);
const ray=new T.Raycaster(),targets=merged();let state=53,checked=0,contacts=0;
const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
for(let i=0;i<1000;i++) {
 const mesh=targets[i%targets.length],p=mesh.userData.terrainPieces[i%mesh.userData.terrainPieces.length];
 const target=p.box.getCenter(new T.Vector3()).applyMatrix4(mesh.matrixWorld);
 const from=target.clone().add(new T.Vector3((rand()-.5)*20,rand()*15+.1,(rand()-.5)*20));
 ray.set(from,target.clone().sub(from).normalize());ray.near=i%5===0?.5:0;ray.far=i%3===0?1:40;
 const actual=ray.intersectObjects(targets,false);
 const wanted=[];
 for(const o of targets) T.Mesh.prototype.raycast.call(o,ray,wanted);
 wanted.sort((a,b)=>a.distance-b.distance);
 assert.equal(actual.length,wanted.length,`ray ${i} hit count`);
 for(let j=0;j<actual.length;j++) {
  assert.equal(actual[j].object,wanted[j].object);assert.equal(actual[j].faceIndex,wanted[j].faceIndex);
  assert.ok(actual[j].point.distanceTo(wanted[j].point)<1e-7);
 }
 contacts+=actual.length;checked++;
}
assert.ok(contacts>100);
world.dispose();reference.dispose();
console.log(JSON.stringify({pass:true,rays:checked,contacts,seconds:(performance.now()-start)/1000}));
