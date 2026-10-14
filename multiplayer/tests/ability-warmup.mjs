import assert from 'node:assert/strict';
import * as T from 'three';
import {createAbilityWarmup} from '../client/ability-warmup.js';
import {createCrystalWall} from '../client/crystal-wall.js';
import {createWallPreview} from '../client/crystal-wall-preview.js';
import {createTrajectoryGuide} from '../client/ranged-trajectory.js';
import {createAxeCleaveView} from '../client/axe-cleave-view.js';

const scene=new T.Scene(), wall=createCrystalWall({THREE:T,scene,height:()=>0});
const preview=createWallPreview({THREE:T,scene,height:()=>0}),guide=createTrajectoryGuide();scene.add(guide.object);
const axe=createAxeCleaveView({scene,height:()=>0});
const before=[];scene.traverse(o=>{if(o.geometry)before.push([o,o.visible,{...o.geometry.drawRange},o.geometry.attributes.position.version]);});
const stats=wall.stats(),events=wall.drainEvents(),warm=createAbilityWarmup(T,scene),crystal=wall.prepareWarmup();
assert.ok(warm.stats.draws>=8,'guide, impact markers, footprint, particles and cleave are represented');
assert.equal(crystal.group.children.length,6,'three colored crystal variants, crust, ore, and ground strip');
assert.equal(crystal.group.children[0].material,wall.materials.pale,'retain runtime program owner');
assert.ok(crystal.group.children[0].instanceColor,'compile the actual instance-color variant');
let disposedMaterials=0;scene.traverse(o=>{for(const m of [o.material].flat())m?.addEventListener('dispose',()=>disposedMaterials++);});
warm.dispose();warm.dispose();crystal.dispose();crystal.dispose();
assert.equal(disposedMaterials,0,'warmup never disposes runtime materials');
for(const [o,visible,range,version] of before){assert.equal(o.visible,visible);assert.deepEqual(o.geometry.drawRange,range);assert.equal(o.geometry.attributes.position.version,version);}
assert.deepEqual(wall.stats(),stats,'no synthetic cast or particle bursts');assert.deepEqual(wall.drainEvents(),events);
axe.dispose();guide.dispose();preview.dispose();wall.dispose();
console.log('PASS: idle ability representatives, exact materials/instancing, no gameplay effects, idempotent cleanup.');
