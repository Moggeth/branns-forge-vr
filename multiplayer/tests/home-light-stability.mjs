import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createHomeBaseView} from '../client/home-base-view.js';
import {createSimulation} from '../shared/simulation.js';
import {loadGlb} from './glb-node.mjs';
const started=performance.now(), scene=new THREE.Scene(), view=createHomeBaseView({scene});
const lights=()=>{const a=[];scene.traverseVisible(n=>{if(n.isPointLight)a.push(n);});return a;};
const fixed=lights();assert.equal(fixed.length,2);assert.ok(fixed.every(l=>l.intensity===0));
const sim=createSimulation({seed:41}), snapshot=sim.snapshot();
assert.equal(snapshot.battle.v,2);
view.installKit(await loadGlb(new URL('../public/assets/bases_kit.glb',import.meta.url)));
view.sync(snapshot);view.update(1/60,new THREE.PerspectiveCamera());
assert.deepEqual(lights(),fixed,'loaded bases reuse the stable lighting budget');
assert.ok(fixed.every(l=>l.intensity>0));
const sources=[];view.object.traverse(n=>{if(n.isPointLight)sources.push(n);});
assert.equal(sources.length,2);
for(const source of sources){const p=source.getWorldPosition(new THREE.Vector3()),match=fixed.find(l=>l.color.equals(source.color));assert.ok(match.position.distanceTo(p)<1e-10);assert.equal(match.intensity,source.intensity);assert.equal(match.distance,source.distance);}
for(let i=0;i<4;i++) {
 view.sync({...snapshot,battle:{...snapshot.battle,status:'idle'}});view.update(1/60,new THREE.PerspectiveCamera());
 assert.deepEqual(lights(),fixed);assert.ok(fixed.every(l=>l.intensity===0),'hidden bases cannot illuminate the meadow');
 view.sync(snapshot);view.update(1/60,new THREE.PerspectiveCamera());assert.deepEqual(lights(),fixed);
}
view.installKit(await loadGlb(new URL('../public/assets/bases_kit.glb',import.meta.url)));view.update(1/60,new THREE.PerspectiveCamera());assert.deepEqual(lights(),fixed,'kit replacement does not leak additional lights');
view.dispose();assert.equal(lights().length,0);
console.log(`home-light-stability: join/leave, exact position/range/color, reload and disposal pass (${(performance.now()-started)/1000}s)`);
