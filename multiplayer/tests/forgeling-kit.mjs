// Forgeling kit contract: the shipped GLB rides the skeleton's rig (same bones, so motion, hit parts and lost limbs
// work unchanged), carries every gear piece the looks ask for, stays phone-sized, and each id gets one stable look.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {FORGELING_LOOKS, forgelingLook, dressForgelingModel} from '../client/forgeling-look.js';

const read = name => { const b = readFileSync(new URL(`../public/assets/${name}.glb`, import.meta.url)); assert.equal(b.toString('utf8', 0, 4), 'glTF'); return {b, j: JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12)))}; };
const {b, j} = read('forgeling'), skeleton = read('skeleton').j;
const names = new Set(j.nodes.map(n => n.name)), bones = n => new Set(n.skins[0].joints.map(i => n.nodes[i].name));
assert.equal(j.skins?.length, 1, 'one rig');
assert.deepEqual([...bones(j)].sort(), [...bones(skeleton)].sort(), 'same bones as the skeleton');
for (const part of ['Head', 'Torso', 'LeftArm', 'RightArm', 'LeftLeg', 'RightLeg', 'Shield_Forge']) assert.ok(j.nodes.some(n => n.name === part && n.mesh !== undefined), part + ' mesh');
for (const gear of new Set(FORGELING_LOOKS.flat())) assert.ok(names.has(gear), gear + ' in kit');
const mats = new Set(j.materials.map(m => m.name));
for (const m of ['Stone', 'Brass', 'Crystal']) assert.ok(mats.has(m), m + ' material');
assert.ok(b.length < 2e6, `forgeling stays small enough for phones (${b.length})`);

// Looks: deterministic per id, every look used, unused gear dropped from the clone.
assert.deepEqual(forgelingLook('battle1_w3_party_0'), forgelingLook('battle1_w3_party_0'));
const seen = new Set(); for (let i = 0; i < 60; i++) seen.add(forgelingLook('f' + i)); assert.equal(seen.size, FORGELING_LOOKS.length, 'all looks appear');
const visual = new THREE.Group(), mesh = name => Object.assign(new THREE.Mesh(new THREE.BoxGeometry(.3, .3, .3)), {name});
visual.add(mesh('Torso'), mesh('Shield_Forge'));
for (const gear of new Set(FORGELING_LOOKS.flat())) visual.add(mesh(gear));
const keep = dressForgelingModel(visual, 'f7'), left = []; visual.traverse(n => /^Gear_/.test(n.name) && left.push(n.name));
assert.deepEqual(left.sort(), [...keep].sort(), 'only the look\'s gear stays');
assert.ok(visual.getObjectByName('Shield_Forge') && visual.userData.forgeling);
console.log(JSON.stringify({suite: 'forgeling-kit', ok: true, bytes: b.length, looks: FORGELING_LOOKS.length}));
