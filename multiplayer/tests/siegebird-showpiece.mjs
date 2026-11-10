import assert from 'node:assert/strict';
import * as T from 'three';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareAsset, updateWeaponPresentation} from '../client/asset-pose.js';
import {createSiegebirdShowpiece, SHOWPIECE} from '../client/siegebird-showpiece.js';
import {createSiegebirdFlock, fletchMaterial, SIEGEBIRD_PLUMAGES} from '../client/siegebird-flock.js';
// Siegebird showpiece ("Wren's Calling"): the authored Calling Stones and fletching in the GLB, per-crossbow dressing,
// stone charge following the winch, the shot, bolt trails and feather-burst impacts, and a fixed GPU budget
// (one light, two particle draws) that never grows with the number of shots.
const begin = performance.now();
function untextured(name) {
  const buf = readFileSync(new URL(`../public/assets/${name}.glb`, import.meta.url));
  const jsonLength = buf.readUInt32LE(12), json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials || []) { delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture; delete m.extensions;
    if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; } }
  if (json.extensionsUsed) json.extensionsUsed = json.extensionsUsed.filter(x => !/texture/i.test(x));
  let text = Buffer.from(JSON.stringify(json)); text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
  const rest = buf.subarray(20 + jsonLength), out = Buffer.alloc(12 + 8 + text.length + rest.length);
  out.write('glTF', 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(text.length, 12); out.writeUInt32LE(0x4e4f534a, 16); text.copy(out, 20); rest.copy(out, 20 + text.length);
  return {buffer: out.buffer.slice(out.byteOffset, out.byteOffset + out.length), json: JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8')), bytes: buf.length};
}
const asset = untextured('crossbow');
const gltf = await new GLTFLoader().parseAsync(asset.buffer, '');

// 1. The authored pieces are in the shipped GLB: three Calling Stones (anchors + materials), plumage fletching,
//    gilt, the maker's plate, and the contract nodes the mechanism drives.
const names = new Set(asset.json.nodes.map(n => n.name)), mats = new Set(asset.json.materials.map(m => m.name));
for (const n of ['CallingStone_L', 'CallingStone_R', 'CallingStone_Heart', 'Bolt', 'Sled', 'Wings', 'Drum', 'Crank', 'BoltSeat', 'GripAnchor', 'SightArt'])
  assert.ok(names.has(n), `crossbow.glb keeps ${n}`);
for (const m of ['SB_CallingStone', 'SB_StoneGlass', 'SB_Fletch', 'SB_Gilt', 'SB_MakerPlate', 'SB_Feather']) assert.ok(mats.has(m), `crossbow.glb has ${m}`);
assert.ok(asset.bytes < 4.5e6, `crossbow.glb stays light (${asset.bytes} bytes)`);
let tris = 0; gltf.scene.traverse(o => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
assert.ok(tris < 70000, `triangle budget (${tris})`);

// 2. Dressing: per-crossbow stone materials (charge is per weapon), shared upgrades, wing ruffle only on the wings.
const scene = new T.Scene(), camera = new T.PerspectiveCamera(70, 16 / 9, .01, 100); scene.add(camera);
const fx = createSiegebirdShowpiece({scene, camera, quality: 'high', localId: () => 'me', ownerFletch: () => 3});
const a = prepareAsset(gltf, 'crossbow').visual, b = prepareAsset(gltf, 'crossbow').visual;
scene.add(a, b); a.position.set(0, 1, -1); b.position.set(3, 1, -1); scene.updateMatrixWorld(true);
const ra = fx.dress(a), rb = fx.dress(b);
assert.equal(fx.dress(a), ra, 'dressing is idempotent');
assert.equal(ra.stones.length, 3, 'heart and both shoulder stones found');
assert.notEqual(ra.stoneMats[0], rb.stoneMats[0], 'each crossbow owns its stone material');
const wingMats = new Set(), bodyMats = new Set();
a.getObjectByName('Wings').traverse(o => { if (o.isMesh) wingMats.add(o.material); });
a.getObjectByName('Body').traverse(o => { if (o.isMesh) bodyMats.add(o.material); });
assert.ok([...wingMats].some(m => m.customProgramCacheKey?.() === 'siegebird-ruffle'), 'wing feathers ruffle');
assert.ok(![...bodyMats].some(m => m.customProgramCacheKey?.() === 'siegebird-ruffle'), 'the body never ruffles');
assert.ok([...wingMats].some(m => m.isMeshPhysicalMaterial && m.iridescence > 0), 'desktop feathers are lacquered enamel');
const phoneFx = createSiegebirdShowpiece({scene: new T.Scene(), camera, quality: 'low'});
const c = prepareAsset(gltf, 'crossbow').visual; phoneFx.dress(c);
let physical = 0; c.traverse(o => { if (o.isMesh && o.material.isMeshPhysicalMaterial && o.material.name !== 'SB_StoneGlass') physical++; });
assert.equal(physical, 0, 'phones keep the standard materials');

// 3. Stone charge follows the winch: drained by the shot, rising click by click, full at the latch.
const level = reload => { for (let i = 0; i < 40; i++) { updateWeaponPresentation(a, 'crossbow', {reload}); fx.update(1 / 60, i / 60, {visual: a, reload}); } return ra.shown; };
const full = level(Infinity);
fx.fired(a, {golden: false, fletch: 2});
const drained = (() => { fx.update(1 / 60, 0, {visual: a, reload: .05}); fx.update(1 / 60, 0, {visual: a, reload: .07}); return ra.charge; })();
assert.ok(drained < .5, `the shot drains the stones (${drained.toFixed(2)})`);
assert.ok(ra.uniforms.ruffle.value > .5, 'the shot shivers the wings');
assert.ok(fx.stats.particles > 10, `the shot throws sparks, motes and down (${fx.stats.particles})`);
assert.ok(fx.stats.light > 0, 'the shot lights the scene');
level(.35);
assert.ok(ra.charge > drained && ra.charge < .9, `winding brings the stones back (${ra.charge.toFixed(2)})`);
level(.7); assert.ok(ra.charge > .9, 'full at the latch');

// 4. Bolt flight: the local bolt carries the seated bird's fletching; others use their owner's reload.
const at = new T.Vector3(0, 2, -5);
assert.equal(fx.fletchFor('bolt-1', 'me'), 2, 'local bolt fletched by the bird that seated it');
assert.equal(fx.fletchFor('bolt-2', 'them'), 3, "another player's bolt uses their bird");
assert.equal(fx.fletchFor('heavy-1', null), -1, 'untracked bolts (Flockwright) stay plain');
for (let i = 0; i < 30; i++) { at.z -= 1; fx.trails([{id: 'bolt-1', kind: 'bolt', ownerId: 'me'}, {id: 'heavy-1', kind: 'bolt', heavy: true, ownerId: 'me'}], () => at, 1 / 60); fx.update(1 / 60, 1, {}); }
assert.ok(!fx.flight('heavy-1'), 'Flockwright heavy bolts are not Siegebird bolts');
const before = fx.stats.particles;
assert.equal(fx.landed({kind: 'embed', id: 'bolt-1', position: [0, 2, -35], normal: [0, 0, 1], material: 'stone'}), true, 'a tracked bolt lands');
assert.equal(fx.landed({kind: 'embed', id: 'unknown', position: [0, 0, 0]}), false, 'unknown projectiles are ignored');
fx.update(1 / 60, 1, {});
assert.ok(fx.stats.particles > before + 6, 'the landing bursts into feathers and motes');

// 5. Fixed budget: one light and two particle draws however many shots; particles capped and recycled.
for (let k = 0; k < 60; k++) { fx.fired(a, {golden: k % 7 === 0}); fx.impact([k, 0, 0], [0, 1, 0], {golden: k % 5 === 0, plumage: k % 6}); fx.update(1 / 60, 2 + k / 60, {visual: a, reload: .1}); }
let lights = 0, draws = 0; scene.traverse(o => { if (o.isPointLight) lights++; if (/SiegebirdShowpiece/.test(o.name)) draws++; });
assert.equal(lights, 1, 'exactly one pooled light');
assert.equal(draws, 2, 'two particle draws (light and feathers)');
assert.ok(fx.stats.particles <= SHOWPIECE.particles.light + SHOWPIECE.particles.feathers, 'particles are capped');
for (let i = 0; i < 400; i++) fx.update(1 / 30, 3 + i / 30, {});
assert.equal(fx.stats.particles, 0, 'everything fades away');

// 6. Fletch materials: tinted per plumage, cached, plain materials untouched.
const fletch = new T.MeshStandardMaterial({name: 'SB_Fletch'}), shaft = new T.MeshStandardMaterial({name: 'SB_Ash'});
assert.equal(fletchMaterial(fletch, 1), fletchMaterial(fletch, 1), 'cached');
assert.notEqual(fletchMaterial(fletch, 1).color.getHex(), fletchMaterial(fletch, 3).color.getHex(), 'each plumage tints differently');
assert.equal(fletchMaterial(shaft, 1), shaft, 'only the fletching changes');
assert.equal(fletchMaterial(fletch, -1), fletch, 'factory fletching without a bird');
assert.equal(SIEGEBIRD_PLUMAGES.length, 6);
const flock = createSiegebirdFlock({birdTemplate: gltf, crossbowTemplate: gltf});
assert.equal(flock.loadedFletch(a), -1, 'no bird has fletched a bolt yet');
// 7. Drawing the crossbow from the stash wakes the stones and settles the wings.
a.visible = false; for (let i = 0; i < 40; i++) fx.update(1 / 60, 9 + i / 60, {visual: a});
assert.ok(ra.flare < .3, 'stashed stones stay quiet');
a.visible = true; fx.update(1 / 60, 10, {visual: a});
assert.ok(ra.flare > .8 && ra.uniforms.ruffle.value > .5, 'drawing it wakes the stones and ruffles the wings');
fx.dispose(); phoneFx.dispose();
console.log(`siegebird-showpiece: authored stones and fletching, dressing, winch-driven charge, shot, trails, landings and fixed budget pass (${((performance.now() - begin) / 1000).toFixed(2)} s)`);
