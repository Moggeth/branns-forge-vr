import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareAsset, setWeaponGrip} from '../client/asset-pose.js';
import {createEmberdewModel} from '../client/fire-presentation.js';
import {snapshotDetachedPart} from '../client/combat-view.js';
import {createWeaponReadiness, syncWeaponReadiness} from '../client/weapon-readiness.js';

const start = performance.now();
// Node has no ImageBitmap decoder. Strip embedded textures while retaining the
// shipped mesh, node hierarchy, material factors and skinning attributes.
function untextured(url) {
  const buf = readFileSync(url);
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  delete json.images; delete json.textures; delete json.samplers;
  for (const material of json.materials || []) {
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture; delete material.extensions;
    if (material.pbrMetallicRoughness) {
      delete material.pbrMetallicRoughness.baseColorTexture;
      delete material.pbrMetallicRoughness.metallicRoughnessTexture;
    }
  }
  if (json.extensionsUsed) json.extensionsUsed = json.extensionsUsed.filter(ext => !/texture/i.test(ext));
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
  const rest = buf.subarray(20 + jsonLength);
  const out = Buffer.alloc(12 + 8 + text.length + rest.length);
  out.write('glTF', 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(text.length, 12); out.writeUInt32LE(0x4e4f534a, 16);
  text.copy(out, 20); rest.copy(out, 20 + text.length);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}
const load = name => new Promise((resolve, reject) => new GLTFLoader().parse(
  untextured(new URL(`../public/assets/${name}.glb`, import.meta.url)), '', resolve, reject));
const names = ['axe', 'pick', 'hammer', 'crossbow', 'bow', 'wyrmspout', 'skeleton'];
const templates = new Map(await Promise.all(names.map(async name => [name, await load(name)])));
const heights = {axe:.7,pick:.75,hammer:.95,crossbow:.48,bow:1.25,wyrmspout:.4,skeleton:1.7};
const pose = root => {
  const records = [];
  root.traverse(node => { if (!node.userData.readinessOwned) records.push([node, [...node.position], [...node.quaternion], [...node.scale], node.parent]); });
  return records;
};
const preserved = records => {
  for (const [node, position, quaternion, scale, parent] of records) {
    assert.deepEqual([...node.position], position, `authored ${node.name} position`);
    assert.deepEqual([...node.quaternion], quaternion, `authored ${node.name} rotation`);
    assert.deepEqual([...node.scale], scale, `authored ${node.name} scale`);
    assert.equal(node.parent, parent, `authored ${node.name} parent`);
  }
};
function check(root, tool, requireDraw = true) {
  const mount = new THREE.Group(); mount.position.set(3, 2, -4); mount.rotation.y = .42; mount.scale.setScalar(1.2); mount.add(root);
  root.updateWorldMatrix(true, true);
  const before = pose(root);
  let indicator = createWeaponReadiness({root, tool});
  assert.equal(indicator.root, root);
  assert.ok(indicator.drawCalls <= 3, `${tool}: draw budget ${indicator.drawCalls}`);
  if (requireDraw) assert.ok(indicator.drawCalls > 0, `${tool}: indicator missing on shipped model`);
  assert.equal(indicator.group.parent, indicator.host);
  indicator.group.updateWorldMatrix(true, true);
  indicator.group.traverse(node => {
    assert.equal(node.userData.ignoreContact, true, `${tool}: added node is excluded from mesh contacts`);
    assert.equal(node.userData.readinessOwned, true);
    assert.ok([...node.matrixWorld.elements].every(Number.isFinite), `${tool}: nonfinite world placement`);
    if (node.isInstancedMesh) {
      assert.ok(node.count > 0 && node.count <= 24);
      for (let i = 0; i < node.count; i++) {
        const matrix = new THREE.Matrix4(); node.getMatrixAt(i, matrix);
        assert.ok([...matrix.elements].every(Number.isFinite), `${tool}: nonfinite instance ${i}`);
      }
    }
  });
  indicator.update({attackReady:0,specialReady:0,heat:.8,time:1});
  indicator.update({attackReady:1,specialReady:1,overheated:true,time:1.5});
  preserved(before);
  assert.equal(syncWeaponReadiness(indicator,{root,tool}), indicator, `${tool}: unchanged root reuses one indicator`);
  indicator = syncWeaponReadiness(indicator,{root:null,tool});
  assert.equal(indicator, null);
  assert.equal(root.getObjectByName(`readiness:${tool}`), undefined, `${tool}: disposed group detached`);
  preserved(before);
  return mount;
}

for (const tool of names.filter(name => name !== 'skeleton')) {
  const {visual} = prepareAsset(templates.get(tool), tool, heights[tool]);
  setWeaponGrip(visual, false, tool, tool === 'bow' ? 'left' : 'right');
  check(visual, tool);
}

// game.js keeps the equipped flask and projectile/remote template as separate
// generated instances; only the equipped one receives a dynamic indicator.
const gameSource = readFileSync(new URL('../client/game.js', import.meta.url), 'utf8');
assert.match(gameSource, /const flaskModel=createEmberdewModel\(\);templates\.set\('flask',\{scene:createEmberdewModel\(\),animations:\[\]\}\)/,
  'the live flask must not also be the projectile/remote clone template');
const flask = createEmberdewModel(), flaskTemplate = createEmberdewModel();
check(flask, 'flask');
const flaskIndicator = createWeaponReadiness({root:flask,tool:'flask'});
const clonedFlask = prepareAsset({scene:flaskTemplate}, 'flask').visual;
const clonedGroups = [];
clonedFlask.traverse(node => { if (node.name === 'readiness:flask') clonedGroups.push(node); });
flaskIndicator.dispose();

// A real severed skeleton arm is baked from its authored skinned triangles.
const {visual:skeleton} = prepareAsset(templates.get('skeleton'), 'skeleton', heights.skeleton);
const actor = new THREE.Group(); actor.add(skeleton); actor.updateWorldMatrix(true,true);
const limb = snapshotDetachedPart(skeleton, 'leftArm');
check(limb, 'limb');

assert.equal(clonedGroups.length, 0, 'a thrown or remote flask must not inherit the live held readiness state');

console.log(`weapon-readiness: authored placements, clone, limb, budget and disposal pass (${((performance.now()-start)/1000).toFixed(3)}s)`);
