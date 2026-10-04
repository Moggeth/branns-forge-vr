// Mechanical checks for client/creature-life-death.js against the ACTUAL
// shipped GLBs, the actual prepareAsset wrapper and actual enemy-motion layer.
// Visual quality still requires a GPU capture review (see ART_HANDOFF.md).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareAsset} from '../client/asset-pose.js';
import {createCombatView} from '../client/combat-view.js';
import {applyEnemyMotion} from '../client/enemy-motion.js';
import {createCreatureLifeDeath, sampleCrawl, crawlWeight, emergencePlan, partDamage, CRAWL_KEYS} from '../client/creature-life-death.js';
import {EMERGE_TICKS} from '../shared/enemy-behaviour.js';

// Node has no image decoding: strip textures, keep geometry/skin/material factors.
function untextured(path) {
  const buf = readFileSync(new URL(path, import.meta.url));
  const jsonLen = buf.readUInt32LE(12), json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials || []) {
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture; delete m.extensions;
    if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; }
  }
  if (json.extensionsUsed) json.extensionsUsed = json.extensionsUsed.filter(e => !/texture/i.test(e));
  let text = Buffer.from(JSON.stringify(json)); const pad = (4 - text.length % 4) % 4; text = Buffer.concat([text, Buffer.alloc(pad, 0x20)]);
  const rest = buf.subarray(20 + jsonLen), out = Buffer.alloc(12 + 8 + text.length + rest.length);
  out.write('glTF', 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8); out.writeUInt32LE(text.length, 12); out.writeUInt32LE(0x4e4f534a, 16);
  text.copy(out, 20); rest.copy(out, 20 + text.length);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}
const load = path => new Promise((ok, fail) => new GLTFLoader().parse(untextured(path), '', ok, fail));
const templates = {skeleton: await load('../public/assets/skeleton.glb'), golem: await load('../public/assets/golem.glb')};

// --- pure helpers ---------------------------------------------------------
assert.equal(crawlWeight(0), 1); assert.equal(crawlWeight(1), 0); assert.ok(crawlWeight(.93) > 0 && crawlWeight(.93) < 1);
const depths = {buried: 2, reach: 1.5, reach2: 1.3, pull: 1, hip: .8, kneel: .4, stand: -.03, rest: 0};
assert.equal(sampleCrawl(0, depths).depth, 2); assert.equal(sampleCrawl(1, depths).depth, 0);
for (let i = 1; i < CRAWL_KEYS.length; i++) assert.ok(CRAWL_KEYS[i].u > CRAWL_KEYS[i - 1].u);
for (const id of ['e1', 'e2', 'e77']) { const p = emergencePlan(id); assert.ok(p.duration >= 2.5 && p.duration <= 3.1 && p.duration * 60 <= EMERGE_TICKS, 'the crawl finishes before the shared AI releases it'); assert.deepEqual(p, emergencePlan(id)); }
assert.equal(partDamage({kind: 'skeleton', parts: {head: 55}}, 'head'), 0);
assert.equal(partDamage({kind: 'skeleton', parts: {head: 0}, missingParts: []}, 'head'), 1);

// --- actor harness ----------------------------------------------------------
const scene = new THREE.Scene(), height = (x, z) => .05 * x; // gentle slope
function actor(kind, id, x, data = {}) {
  const {visual} = prepareAsset(templates[kind], kind);
  const root = new THREE.Group(); root.position.set(x, height(x, 0), 0); root.rotation.y = .4; root.add(visual); scene.add(root);
  return {enemy: true, root, visual, data: {id, kind, hp: kind === 'golem' ? 320 : 100, parts: {}, missingParts: [], attackTick: -1000, ...(kind === 'golem' ? {armor: 3} : {}), ...data}};
}
const snapshotPose = v => { const out = []; v.traverse(n => out.push([n.name, n.position.toArray(), n.quaternion.toArray(), n.visible])); return out; };
function close(a, b, eps = 1e-5) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i][3], b[i][3], `visibility ${a[i][0]}`);
    for (const k of [1, 2]) a[i][k].forEach((v, j) => assert.ok(Math.abs(v - b[i][k][j]) < eps, `${a[i][0]} ${k === 1 ? 'pos' : 'rot'} ${v} vs ${b[i][k][j]}`));
  }
}
// GLTFLoader uniquifies the duplicate mesh/joint names (Head vs Head_1): prefer the joint.
const world = (v, name) => {
  let node = null;
  v.traverse(n => { if ((n.name === name || new RegExp(`^${name}_\\d+$`).test(n.name)) && (!node || (n.isBone && !node.isBone))) node = n; });
  return node.getWorldPosition(new THREE.Vector3());
};

const fx = createCreatureLifeDeath({scene, height});
function frame(entries, tick, dt = 1 / 60) {
  fx.beginFrame();
  for (const e of entries) applyEnemyMotion(e, {tick, height, dt});
  for (const e of entries) if (e.fx !== false) fx.sync(e, tick, dt);
  fx.tick(dt);
}

// --- skeleton crawl ---------------------------------------------------------
{
  const spawn = 100, sk = actor('skeleton', 'sk1', 0, {spawnTick: spawn}), control = actor('skeleton', 'sk1', 0);
  control.fx = false;
  const root0 = [sk.root.position.clone(), sk.root.quaternion.clone(), sk.root.scale.clone()];
  const plan = emergencePlan('sk1'), endTick = spawn + Math.ceil(plan.duration * 60);
  let sawHandUp = false, sawBuriedHead = false, sawKneel = false;
  for (let t = spawn; t <= endTick + 20; t++) {
    frame([sk, control], t);
    const u = (t - spawn) / 60 / plan.duration, ground = height(sk.root.position.x, 0);
    const head = world(sk.visual, 'Head').y - ground, hands = Math.max(world(sk.visual, 'RightHand').y, world(sk.visual, 'LeftArm').y) - ground;
    if (u < .2 && head < -.3) sawBuriedHead = true;
    if (u > .1 && u < .32 && hands > 0 && head < 0) sawHandUp = true;
    if (u > .7 && u < .82 && head > .2 && head < 1.3) sawKneel = true;
    assert.ok(sk.root.position.equals(root0[0]) && sk.root.quaternion.equals(root0[1]) && sk.root.scale.equals(root0[2]), 'entry.root untouched');
  }
  assert.ok(sawBuriedHead, 'skull starts beneath the surface');
  assert.ok(sawHandUp, 'a hand breaks the soil before the skull');
  assert.ok(sawKneel, 'kneeling phase before standing');
  close(snapshotPose(sk.visual), snapshotPose(control.visual)); // released exactly to the motion pose, no accumulation
  // beginFrame restores motion output exactly mid-crawl as well.
  const mid = actor('skeleton', 'sk2', 3, {spawnTick: 0}), ctl = actor('skeleton', 'sk2', 3); ctl.fx = false;
  for (let t = 0; t < 50; t++) frame([mid, ctl], t);
  fx.beginFrame(); close(snapshotPose(mid.visual), snapshotPose(ctl.visual));
  console.log('skeleton crawl ok', fx.stats());
}

// --- golem assembly ---------------------------------------------------------
{
  const spawn = 10, g = actor('golem', 'g1', 6, {spawnTick: spawn}), control = actor('golem', 'g1', 6); control.fx = false;
  const plan = emergencePlan('g1', 'golem'), endTick = spawn + Math.ceil(plan.duration * 60);
  const vis0 = []; g.visual.traverse(n => vis0.push(n.visible));
  let headDisplaced = false, legsHome = false, binds = 0;
  for (let t = spawn; t <= endTick + 20; t++) {
    frame([g, control], t);
    const u = (t - spawn) / 60 / plan.duration;
    const dHead = world(g.visual, 'Head').distanceTo(world(control.visual, 'Head')), dLeg = world(g.visual, 'LegL').distanceTo(world(control.visual, 'LegL'));
    if (u > .3 && u < .7 && dHead > .5) headDisplaced = true;
    if (u > .5 && u < .7 && dLeg < .05) legsHome = true;
    binds = Math.max(binds, fx.stats().binds);
  }
  assert.ok(headDisplaced, 'head is still away while body assembles'); assert.ok(legsHome, 'legs snap home first'); assert.ok(binds > 0, 'binding lines drawn');
  const vis1 = []; g.visual.traverse(n => vis1.push(n.visible)); assert.deepEqual(vis1, vis0, 'armour/piece visibility untouched');
  close(snapshotPose(g.visual), snapshotPose(control.visual));
  // Meteor-born golems are owned by meteor-creature.js.
  const m = actor('golem', 'g2', 9, {spawnTick: 0, meteorBorn: true, unfurlTick: 0}), mc = actor('golem', 'g2', 9); mc.fx = false;
  for (let t = 0; t < 40; t++) frame([m, mc], t); close(snapshotPose(m.visual), snapshotPose(mc.visual));
  console.log('golem assembly ok', fx.stats());
}

// --- damage, hit, death handoff ---------------------------------------------
{
  const sk = actor('skeleton', 'sk3', -3, {parts: {head: 55, torso: 30, leftArm: 10, rightArm: 55, leftLeg: 55, rightLeg: 55}, hp: 30, scorch: {torso: .8}});
  const g = actor('golem', 'g3', -8, {parts: {head: 120, torso: 20, leftArm: 120, rightArm: 120, leftLeg: 120, rightLeg: 120}, hp: 60, armor: 0});
  for (let t = 0; t < 30; t++) frame([sk, g], 2000 + t);
  let variantMeshes = 0, scorched = 0;
  sk.visual.traverse(m => { if (m.isMesh && m.userData.cldDamage) { variantMeshes++; scorched = Math.max(scorched, ...m.userData.cldDamage.rec.scorch); } });
  assert.ok(variantMeshes > 0, 'skeleton meshes carry damage records'); assert.ok(scorched > .3 && scorched < .8, `scorch creeps in (${scorched})`);
  let core = 0; g.visual.traverse(m => { if (m.userData.cldCoreMesh) core++; }); assert.ok(core > 0, 'golem CoreGlow found');
  // Shader injection anchors exist in this three revision (GPU compile is a capture-time check).
  let mat = null; sk.visual.traverse(m => { if (m.isMesh && m.material?.userData?.cld) mat = m.material; });
  for (const lib of ['standard', 'lambert', 'phong']) {
    const shader = {uniforms: {}, vertexShader: THREE.ShaderLib[lib].vertexShader, fragmentShader: THREE.ShaderLib[lib].fragmentShader};
    mat.onBeforeCompile(shader);
    for (const s of ['vCldScorch = cldScorch', 'vCldPos = position']) assert.ok(shader.vertexShader.includes(s), `${lib} vertex ${s}`);
    for (const s of ['float cldNoise', 'cldMask', 'totalEmissiveRadiance *= 1. + cldCore']) assert.ok(shader.fragmentShader.includes(s), `${lib} fragment ${s}`);
    assert.ok(shader.uniforms.cldScorch && shader.uniforms.cldGlowColor);
  }
  fx.hit(sk, {position: [-3, 1.2, 0], normal: [0, 0, 1], part: 'torso', fire: true});
  // Death: fake authoritative remains at the actual anchors (as server partPoses would).
  sk.visual.updateWorldMatrix(true, true);
  const nodes = new Map(), parts = [];
  for (const [i, [part, name]] of [['head', 'Head'], ['torso', 'Torso'], ['leftArm', 'LeftArm'], ['rightArm', 'RightArm'], ['leftLeg', 'LeftLeg'], ['rightLeg', 'RightLeg']].entries()) {
    const n = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .1), new THREE.MeshStandardMaterial()); n.add(mesh);
    n.position.copy(world(sk.visual, name)); nodes.set('d' + i, n); scene.add(n);
    parts.push({id: 'd' + i, sourceId: 'sk3', part, position: n.position.toArray()});
  }
  const before = nodes.get('d0').position.clone();
  fx.death(sk, {normal: [0, 0, 1]}); // struck from +Z => falls toward -Z
  scene.remove(sk.root);
  // Skeleton remains are a shared-physics ragdoll now (shared/remains-physics.js): the presentation must not add a
  // collapse of its own on top of the authoritative pose, or every peer would see the bones double-fall.
  let drift = 0;
  for (let t = 0; t < 160; t++) {
    fx.beginFrame();
    for (const [i, d] of parts.entries()) { const n = nodes.get(d.id); n.position.fromArray(d.position); n.quaternion.identity(); } // server pose (static here)
    fx.syncDetached(nodes, parts);
    drift = Math.max(drift, nodes.get('d0').position.distanceTo(before));
    fx.tick(1 / 60);
  }
  assert.ok(drift < 1e-6, 'skeleton remains show the shared ragdoll pose unaltered');
  fx.beginFrame(); fx.syncDetached(nodes, parts);
  assert.ok(nodes.get('d0').position.distanceTo(before) < 1e-6, 'remains end exactly on the authoritative pose');
  assert.equal(fx.stats().corpses, 0);
  let carried = false; nodes.get('d1').traverse(m => { if (m.userData.cldDamage?.rec.scorch[0] > .3) carried = true; }); assert.ok(carried, 'torso remains keep scorch');
  console.log('damage/death ok', fx.stats());
}

// Actual posed skeleton joints drive host fire samples without reskinning vertices.
{
 const sk=actor('skeleton','fire-pose',0),camera=new THREE.PerspectiveCamera();
 const combat=createCombatView({scene,templates:new Map(),actors:new Map([['e:fire-pose',sk]]),camera});
 const before=combat.fireSamples('fire-pose');assert.ok(before.leftLeg.length>=3&&before.head.length);
 let foot;sk.visual.traverse(n=>{if(n.isBone&&/^LeftFoot/.test(n.name))foot=n;});assert.ok(foot);foot.position.y+=.25;
 const after=combat.fireSamples('fire-pose');assert.notDeepEqual(after.leftLeg,before.leftLeg,'articulated foot motion changes real exposure samples');
 assert.deepEqual(after.rightLeg,before.rightLeg,'opposite leg unaffected');assert.ok(Object.values(after).every(points=>points.length<=8));combat.dispose();
}

// Region uniforms on the real GLB must not bleed between bodies or regions.
{
 const a=actor('skeleton','charA',0,{scorch:{leftLeg:1,rightLeg:.75,head:0}}),b=actor('skeleton','charB',3,{scorch:{head:1,leftLeg:0}});
 for(let t=0;t<45;t++)frame([a,b],6000+t);
 const get=e=>{const rows=[];e.visual.traverse(m=>{if(m.isMesh&&m.userData.cldDamage)rows.push(m);});return rows;};
 const am=get(a),bm=get(b);assert.ok(am.length&&bm.length);
 const leg=am.find(m=>m.userData.cldDamage.rec.map.includes('leftLeg'));
 const record=leg.userData.cldDamage.rec;assert.ok(record.scorch[record.map.indexOf('leftLeg')]>.7);
 assert.ok(record.scorch[record.map.indexOf('head')]===0||!record.map.includes('head'));
 assert.ok(am.every(x=>bm.every(y=>x.material!==y.material)),'different actors have distinct uniform material instances');
 fx.hit(a,{kind:'hit',fire:true,part:'torso',position:[0,0,0]});frame([a,b],6050);
 a.visual.traverse(m=>{const r=m.userData.cldDamage?.rec;if(r&&r.map.includes('torso'))assert.equal(r.scorch[r.map.indexOf('torso')],0,'generic burn damage does not invent torso scorch');});
}

// --- cost -------------------------------------------------------------------
{
  const crowd = Array.from({length: 40}, (_, i) => actor(i % 4 ? 'skeleton' : 'golem', 'c' + i, 20 + i * 2, {spawnTick: 5000 + i * 3}));
  for (let t = 4990; t < 5000; t++) frame(crowd, t);
  const t0 = performance.now(); for (let t = 5000; t < 5120; t++) frame(crowd, t); const emerging = (performance.now() - t0) / 120;
  const t1 = performance.now(); for (let t = 5400; t < 5520; t++) frame(crowd, t); const idle = (performance.now() - t1) / 120;
  console.log(`40 actors: ${emerging.toFixed(2)} ms/frame while all emerging (incl. enemy-motion), ${idle.toFixed(2)} ms/frame after`, fx.stats());
}
fx.dispose();
assert.equal(fx.stats().variants, 0);
console.log('creature-life-death: all checks passed');
