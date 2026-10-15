import assert from 'node:assert/strict';import * as T from 'three';
import {createWeaponReadinessCache} from '../client/weapon-readiness.js';
import {loadGLB} from './glb.mjs';import {fileURLToPath} from 'node:url';
import {prepareAsset} from '../client/asset-pose.js';import {enhancePickTemplate} from '../client/pick-luminance.js';
const pick=loadGLB(fileURLToPath(new URL('../public/assets/pick.glb',import.meta.url)));enhancePickTemplate(pick.scene);
const root=prepareAsset(pick,'pick',.75).visual,original=new Map();root.traverse(n=>{if(n.isMesh)original.set(n,[n.geometry,n.material]);});
const cache=createWeaponReadinessCache(),prepared=cache.prepare({root,tool:'pick'});assert.ok(prepared);let halo;root.traverse(n=>{if(n.material?.name==='readiness:pick-halo')halo=n;});assert.ok(halo);
const gem=root.getObjectByName('ResonanceCrystal'),heldGeometry=gem.geometry,heldMaterial=gem.material;
assert.ok(heldGeometry.attributes.pickGem);assert.notEqual(heldGeometry,original.get(gem)[0]);
for(let i=0;i<3;i++){
 assert.equal(cache.select({root,tool:'pick'}),prepared);assert.equal(cache.select({root:null,tool:'axe'}),null);
 assert.equal(prepared.disposed,false);assert.equal(gem.geometry,heldGeometry);assert.equal(gem.material,heldMaterial);
}
assert.equal(cache.stats().prepared,1);cache.dispose();cache.dispose();assert.equal(prepared.disposed,true);
for(const [mesh,[geometry,material]]of original){assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,material);}
assert.equal(cache.prepare({root,tool:'pick'}),null);
// Detached limbs are ephemeral and released on deselection instead of retained.
const limbs=createWeaponReadinessCache(),bone=new T.Group();bone.add(new T.Mesh(new T.CylinderGeometry(.02,.03,.3),new T.MeshStandardMaterial()));
const indicator=limbs.select({root:bone,tool:'limb'});limbs.select({root:null});assert.equal(indicator.disposed,true);assert.equal(limbs.stats().prepared,0);limbs.dispose();
console.log('readiness-cache: full held pick prepared once, materials persist across swaps, shared resources restore and transient limbs release');
