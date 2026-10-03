// Run: node tests/enemy-motion.mjs (three resolves through multiplayer/node_modules)
// Builds the ACTUAL skeleton.glb / golem.glb node hierarchy and animation clips
// from the GLB JSON+BIN (no meshes/textures needed), wraps them exactly like
// asset-pose.js prepareAsset (normalization + canonical basis), drives the real
// AnimationMixer clips, then layers enemy-motion and checks invariants.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import * as THREE from 'three';
import {assetBasis, ASSET_POSES} from '../client/asset-pose.js';
import {attackEnvelope, recoilEnvelope, solveTwoBone, poseSignals, traits, hashId, noise1, applyEnemyMotion, noteEnemyHit, enemyMotionState, updateEnemyMotion, STRIKE_TICK, GOLEM_CYCLE} from '../client/enemy-motion.js';

const ASSETS = process.env.BRANN_ASSETS || fileURLToPath(new URL('../public/assets', import.meta.url));
let passed = 0; const results = [];
function test(name, fn) { const t0 = performance.now(); fn(); passed++; results.push(`ok  ${name} (${(performance.now() - t0).toFixed(1)} ms)`); }

function readGlb(path) {
  const b = readFileSync(path), jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8, binLen = b.readUInt32LE(20 + jsonLen);
  return {json, bin: b.subarray(binStart, binStart + binLen)};
}
const COMPONENTS = {SCALAR: 1, VEC3: 3, VEC4: 4};
function accessor({json, bin}, i) {
  const a = json.accessors[i], v = json.bufferViews[a.bufferView], n = COMPONENTS[a.type];
  assert.equal(a.componentType, 5126, 'float accessor');
  const stride = v.byteStride || n * 4, base = (v.byteOffset || 0) + (a.byteOffset || 0), out = new Float32Array(a.count * n);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = bin.readFloatLE(base + k * stride + c * 4);
  return out;
}
function posBoundsY(glb) {
  let min = Infinity, max = -Infinity;
  const parent = {}; glb.json.nodes.forEach((n, i) => (n.children || []).forEach(c => parent[c] = i));
  const worldY = i => { let y = 0; for (let n = i; n !== undefined; n = parent[n]) y += glb.json.nodes[n].translation?.[1] || 0; return y; };
  glb.json.nodes.forEach((node, i) => {
    if (node.mesh === undefined) return;
    for (const p of glb.json.meshes[node.mesh].primitives) { const a = glb.json.accessors[p.attributes.POSITION]; min = Math.min(min, a.min[1] + (node.skin === undefined ? worldY(i) : 0)); max = Math.max(max, a.max[1] + (node.skin === undefined ? worldY(i) : 0)); }
  });
  return {min, max};
}
// Mirrors GLTFLoader node types: joints -> Bone, mesh nodes -> Mesh, others -> Object3D.
function buildRig(file, kind, height) {
  const glb = readGlb(`${ASSETS}/${file}`), {json} = glb;
  const joints = new Set((json.skins || []).flatMap(s => s.joints));
  const objects = json.nodes.map(n => {
    const o = joints.has(json.nodes.indexOf(n)) ? new THREE.Bone() : n.mesh !== undefined ? new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()) : new THREE.Object3D();
    o.name = n.name || '';
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  json.nodes.forEach((n, i) => (n.children || []).forEach(c => objects[i].add(objects[c])));
  const model = new THREE.Group(); const roots = new Set(objects); objects.forEach(o => o.children.forEach(c => roots.delete(c)));
  for (const r of roots) model.add(r);
  const clips = (json.animations || []).map(anim => new THREE.AnimationClip(anim.name, -1, anim.channels.map(ch => {
    const s = anim.samplers[ch.sampler], times = accessor(glb, s.input), values = accessor(glb, s.output);
    const target = `${objects[ch.target.node].uuid}.${{translation: 'position', rotation: 'quaternion', scale: 'scale'}[ch.target.path]}`;
    return ch.target.path === 'rotation' ? new THREE.QuaternionKeyframeTrack(target, times, values) : new THREE.VectorKeyframeTrack(target, times, values);
  })));
  // prepareAsset equivalent: conversion OUTSIDE animated hierarchy.
  const b = posBoundsY(glb), factor = height / (b.max - b.min);
  const normalization = new THREE.Group(); normalization.scale.setScalar(factor); normalization.position.set(0, -b.min * factor, 0); normalization.add(model);
  const visual = new THREE.Group(); visual.quaternion.copy(assetBasis(ASSET_POSES[kind])); visual.add(normalization);
  const mixer = new THREE.AnimationMixer(model), actions = {};
  for (const c of clips) actions[c.name.toLowerCase()] = mixer.clipAction(c);
  return {json, visual, model, mixer, actions, clips, objects};
}

const height = (x, z) => .22 * Math.sin(.8 * x) + .18 * Math.cos(.6 * z) + .06 * x; // bumpy slope
function makeEnemy(kind, id, x = 0, z = 0) {
  const rig = kind === 'golem' ? buildRig('golem.glb', 'golem', 2.8) : buildRig('skeleton.glb', 'skeleton', 1.7);
  const root = new THREE.Group(); root.add(rig.visual); root.position.set(x, height(x, z), z);
  const scene = new THREE.Scene(); scene.add(root);
  const data = {id, kind, attackTick: -1000, missingParts: [], yaw: 0};
  return {entry: {root, visual: rig.visual, data, enemy: true}, rig, scene};
}
const named = (rig, name) => { let r = null; rig.visual.traverse(n => { if (n.name === name && (n.isBone || (!n.isMesh && !r))) r = n; }); return r; };
const finiteNode = n => [...n.position.toArray(), ...n.quaternion.toArray()].every(Number.isFinite) && Math.abs(n.quaternion.length() - 1) < 1e-4;
const wpos = (n, v = new THREE.Vector3()) => n.getWorldPosition(v);

// ---------------------------------------------------------------- rig proof
test('skeleton.glb hierarchy matches the rig contract (two-bone legs, Root pelvis)', () => {
  const {json} = buildRig('skeleton.glb', 'skeleton', 1.7), N = json.nodes, idx = n => N.findIndex(x => x.name === n && (json.skins[0].joints.includes(N.indexOf(x))));
  const child = (p, c) => N[idx(p)].children.includes(idx(c));
  for (const [p, c] of [['Root', 'Torso'], ['Torso', 'Head'], ['Torso', 'LeftArm'], ['Torso', 'RightArm'], ['RightArm', 'RightHand'], ['RightHand', 'WeaponTip'], ['Root', 'LeftLeg'], ['LeftLeg', 'LeftKnee'], ['LeftKnee', 'LeftFoot'], ['Root', 'RightLeg'], ['RightLeg', 'RightKnee'], ['RightKnee', 'RightFoot']]) assert.ok(child(p, c), `${p} > ${c}`);
  const names = json.animations.map(a => a.name).sort();
  assert.deepEqual(names, ['attack', 'hop_left', 'hop_right', 'idle', 'stagger', 'turn_left', 'turn_right', 'walk']);
});
test('golem.glb is rigid siblings without knee/foot joints (no leg IK claimed)', () => {
  const {visual, json} = buildRig('golem.glb', 'golem', 2.8);
  assert.equal((json.skins || []).length, 0);
  for (const n of ['ArmL', 'ElbowL', 'ArmR', 'ElbowR', 'BodyCore', 'Head', 'LegL', 'LegR']) assert.ok(visual.getObjectByName(n), n);
  assert.equal(visual.getObjectByName('Golem').children.map(c => c.name).sort().join(','), 'ArmL,ArmR,BodyCore,Head,LegL,LegR');
  assert.equal(json.nodes.some(n => /knee|foot/i.test(n.name)), false);
});

// ---------------------------------------------------------------- pure math
test('attack envelopes: continuous, bounded, slam lands on gameplay strike tick', () => {
  for (const kind of ['skeleton', 'golem']) {
    let prev = attackEnvelope(-1, kind, {}), maxStep = 0;
    for (let a = 0; a <= 80; a += .05) {
      const e = attackEnvelope(a, kind, {});
      for (const k of ['coil', 'strike', 'impact']) { assert.ok(Math.abs(e[k]) <= 1 + 1e-9, `${kind}.${k}`); maxStep = Math.max(maxStep, Math.abs(e[k] - prev[k])); }
      prev = e;
    }
    assert.ok(maxStep < .2, `${kind} step ${maxStep}`);
    assert.equal(attackEnvelope(80, kind, {}).strike, 0);
  }
  assert.equal(attackEnvelope(STRIKE_TICK, 'golem', {}).strike, 1);
  assert.ok(attackEnvelope(STRIKE_TICK, 'skeleton', {}).strike > .6);
  assert.ok(attackEnvelope(13, 'golem', {}).phase === 'hold'); // readable telegraph hold
});
test('recoil envelope starts at 0, is bounded and decays', () => {
  for (const kind of ['skeleton', 'golem']) {
    assert.equal(recoilEnvelope(0, kind), 0);
    let prev = 0, peak = 0;
    for (let a = 0; a < 200; a += .05) { const v = recoilEnvelope(a, kind); assert.ok(Math.abs(v) <= 1); assert.ok(Math.abs(v - prev) < .1); prev = v; peak = Math.max(peak, Math.abs(v)); }
    assert.ok(peak > .3); assert.equal(recoilEnvelope(200, kind), 0);
  }
});
test('two-bone solver: law of cosines closes the triangle and clamps reach', () => {
  for (const [a, b, d] of [[.33, .32, .5], [.33, .32, .64], [.33, .32, 2], [.33, .32, .001]]) {
    const s = solveTwoBone(a, b, d);
    const kx = Math.cos(s.hip) * a, ky = Math.sin(s.hip) * a;
    assert.ok(Math.abs(Math.hypot(s.reach - kx, ky) - b) < 1e-6, `closure ${d}`);
    assert.ok(s.reach <= a + b && s.reach >= Math.abs(a - b));
  }
});
test('pose signals are deterministic per (id, tick) and personalised per enemy', () => {
  const sigFor = (id, t) => poseSignals({kind: 'skeleton', tr: traits(id), t, attack: attackEnvelope(-1, 'skeleton', {}), recoil: {value: 0}, missing: {}, moving: false, stride: 0}, {});
  assert.deepEqual(sigFor('e7', 12.25), sigFor('e7', 12.25));
  assert.notDeepEqual(sigFor('e7', 12.25), sigFor('e8', 12.25));
  assert.equal(hashId('e7'), hashId('e7'));
  for (let t = 0; t < 10; t += .01) assert.ok(Math.abs(noise1(5, 1, t)) <= 1);
});

// ---------------------------------------------------------------- real rig
function runSkeleton({missing = [], frames = 480, walk = true, hits = [], attackAt = 120, check}) {
  const {entry, rig} = makeEnemy('skeleton', 'e42', -2, -1);
  entry.data.missingParts = missing;
  const legs = ['Left', 'Right'].map(s => ({s, thigh: named(rig, `${s}Leg`), knee: named(rig, `${s}Knee`), foot: named(rig, `${s}Foot`)}));
  const embed = new THREE.Object3D(); embed.position.set(.01, .1, .02); named(rig, 'Torso').add(embed); // bone-local arrow
  const embedLocal = embed.position.clone();
  let current = 'idle'; rig.actions.idle.play();
  const lengths = legs.map(l => [wpos(l.thigh).distanceTo(wpos(l.knee)), wpos(l.knee).distanceTo(wpos(l.foot))]);
  const prevQ = new Map(), stats = {maxStep: 0, maxFootErr: 0, maxLenErr: 0, minKnee: Math.PI, frames: 0};
  for (let f = 0; f < frames; f++) {
    const tick = 1000 + f;
    if (f === attackAt) entry.data.attackTick = tick;
    for (const h of hits) if (f === h.frame) { entry.data.hurtTick = tick; if (h.event) noteEnemyHit(entry, {...h.event, tick}); }
    const want = tick - (entry.data.hurtTick ?? -1e9) < 22 ? 'stagger' : tick - entry.data.attackTick < 28 ? 'attack' : walk ? 'walk' : 'idle';
    if (want !== current) { rig.actions[current].fadeOut(.18); rig.actions[want].reset().fadeIn(.18).play(); if (want !== 'walk' && want !== 'idle') { rig.actions[want].setLoop(THREE.LoopOnce, 1); rig.actions[want].clampWhenFinished = true; } current = want; }
    if (walk && current === 'walk') entry.root.position.x += 1.4 / 60;
    entry.root.position.y = height(entry.root.position.x, entry.root.position.z);
    const rootBefore = [...entry.root.position.toArray(), ...entry.root.quaternion.toArray()];
    rig.mixer.update(1 / 60);
    const st = applyEnemyMotion(entry, {tick, dt: 1 / 60, height});
    assert.ok(st);
    assert.deepEqual([...entry.root.position.toArray(), ...entry.root.quaternion.toArray()], rootBefore, 'entry.root untouched');
    entry.root.updateWorldMatrix(true, true);
    rig.visual.traverse(n => { if (n.isBone || n.isObject3D) assert.ok(finiteNode(n), `finite ${n.name}`); });
    assert.equal(embed.parent, named(rig, 'Torso')); assert.ok(embed.position.equals(embedLocal), 'embed local transform preserved');
    legs.forEach((l, i) => {
      const len = [wpos(l.thigh).distanceTo(wpos(l.knee)), wpos(l.knee).distanceTo(wpos(l.foot))];
      stats.maxLenErr = Math.max(stats.maxLenErr, Math.abs(len[0] - lengths[i][0]), Math.abs(len[1] - lengths[i][1]));
      const leg = st.legs.find(x => x.thigh.node === l.thigh);
      if (leg?.active && f > 3) {
        const err = wpos(l.foot).distanceTo(leg.target), H = wpos(l.thigh), reachable = H.distanceTo(leg.target) < (leg.a + leg.b) * .9994;
        if (reachable) stats.maxFootErr = Math.max(stats.maxFootErr, err);
        const k = new THREE.Vector3().subVectors(H, wpos(l.knee)).normalize().angleTo(new THREE.Vector3().subVectors(wpos(l.foot), wpos(l.knee)).normalize());
        stats.minKnee = Math.min(stats.minKnee, k);
      }
    });
    if (f > 0) rig.visual.traverse(n => { if (!n.isBone) return; const p = prevQ.get(n); if (p && p.angleTo(n.quaternion) > stats.maxStep) { stats.maxStep = p.angleTo(n.quaternion); stats.stepAt = `${n.name}@${f}:${current}`; } });
    rig.visual.traverse(n => { if (n.isBone) (prevQ.get(n) || prevQ.set(n, new THREE.Quaternion()).get(n)).copy(n.quaternion); });
    check?.(f, entry, rig, st, legs);
    stats.frames++;
  }
  return {stats, entry, rig, legs};
}

let walkStats;
test('skeleton walk+attack on bumpy slope: lengths preserved, feet on IK targets, knees bent, continuous', () => {
  const {stats} = runSkeleton({}); walkStats = stats;
  assert.ok(stats.maxLenErr < 1e-4, `joint length drift ${stats.maxLenErr}`);
  assert.ok(stats.maxFootErr < .01, `foot target error ${stats.maxFootErr}`);
  assert.ok(stats.minKnee < Math.PI - .05, 'knees articulate');
  assert.ok(stats.maxStep < .45, `per-frame joint step ${stats.maxStep} ${stats.stepAt}`);
});
test('idle: planted feet stay at ground height (+ankle) and do not slide', () => {
  const locks = [];
  runSkeleton({walk: false, frames: 300, attackAt: -1, check: (f, e, rig, st, legs) => {
    if (f === 120) for (const l of legs) locks.push(wpos(l.foot));
    if (f > 120) legs.forEach((l, i) => assert.ok(wpos(l.foot).distanceTo(locks[i]) < .03, `foot slide ${wpos(l.foot).distanceTo(locks[i])}`));
    if (f > 10) for (const leg of st.legs) { const p = wpos(leg.foot.node); assert.ok(Math.abs(p.y - (height(p.x, p.z) + leg.ankleH + leg.lift)) < .01, 'ankle on ground'); }
  }});
});
test('missing left leg: no NaN, hobble leans over surviving right leg, right leg still IK-planted', () => {
  let leanSum = 0;
  const {stats} = runSkeleton({missing: ['leftLeg'], check: (f, e, rig) => {
    const torso = named(rig, 'Torso'), head = named(rig, 'Head');
    const up = wpos(head).sub(wpos(torso)); const right = new THREE.Vector3(1, 0, 0).applyQuaternion(e.root.quaternion);
    if (f > 30) leanSum += up.normalize().dot(right);
  }});
  assert.ok(leanSum > 0, 'leans right (toward surviving leg)');
  assert.ok(stats.maxFootErr < .01 && stats.maxLenErr < 1e-4);
});
test('both legs missing: torso drops near ground, still finite', () => {
  let minHip = Infinity;
  runSkeleton({missing: ['leftLeg', 'rightLeg'], frames: 120, check: (f, e, rig) => { if (f > 5) minHip = Math.min(minHip, wpos(named(rig, 'LeftLeg')).y - e.root.position.y); }});
  assert.ok(minHip < .35, `hip height ${minHip}`);
});
test('part-local recoil: head hit snaps head back (layer delta bounded), arm hit swings that arm', () => {
  let maxHead = 0, preHead = 0, maxArm = 0, preArm = 0;
  const layerDelta = (st, key) => st.nodes[key].node.quaternion.angleTo(st.nodes[key].baseQ);
  const {rig} = runSkeleton({walk: false, attackAt: -1, frames: 260, hits: [{frame: 60, event: {part: 'head', normal: [0, 0, -1]}}, {frame: 150, event: {part: 'rightArm', normal: [0, 0, -1]}}], check: (f, e, r, st) => {
    if (f > 30 && f < 60) preHead = Math.max(preHead, layerDelta(st, 'head'));
    if (f > 60 && f < 120) maxHead = Math.max(maxHead, layerDelta(st, 'head'));
    if (f > 120 && f < 150) preArm = Math.max(preArm, layerDelta(st, 'armR'));
    if (f > 150 && f < 200) maxArm = Math.max(maxArm, layerDelta(st, 'armR'));
  }});
  assert.ok(maxHead > preHead + .2 && maxHead < .9, `head recoil ${preHead} -> ${maxHead}`);
  assert.ok(maxArm > preArm + .2 && maxArm < .9, `arm recoil ${preArm} -> ${maxArm}`);
  const st = enemyMotionState(rig.visual);
  for (const r of st.tracked) assert.ok(Number.isFinite(r.baseQ.x));
});
test('golem: telegraph raises arms forward-up, slam lands at strike tick, entry.root untouched, rigid legs not IK-driven', () => {
  const {entry, rig} = makeEnemy('golem', 'g1', 3, 2);
  rig.actions.idle.play();
  const armL = named(rig, 'ArmL'), hand = rig.visual.getObjectByName('ForearmHandL');
  const st0 = applyEnemyMotion(entry, {tick: 0, dt: 1 / 60, height});
  assert.equal(st0.legs.length, 0);
  const restHand = wpos(hand).sub(wpos(armL)).normalize();
  entry.data.attackTick = 100; let apex = null, slam = null; const rootBefore = entry.root.position.clone();
  for (let tick = 90; tick < 200; tick++) {
    rig.mixer.update(1 / 60); applyEnemyMotion(entry, {tick, dt: 1 / 60, height}); entry.root.updateWorldMatrix(true, true);
    rig.visual.traverse(n => assert.ok(finiteNode(n), n.name));
    if (tick === 113) apex = wpos(hand).sub(wpos(armL)).normalize();
    if (tick === 100 + STRIKE_TICK) slam = wpos(hand).sub(wpos(armL)).normalize();
  }
  assert.ok(entry.root.position.equals(rootBefore));
  assert.ok(apex.y > restHand.y + .8, `arm raised overhead ${apex.y} vs ${restHand.y}`);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(entry.root.quaternion);
  assert.ok(slam.dot(fwd) > .5, `slam ends forward ${slam.dot(fwd)}`);
});
test('golem gait: stride-locked rigid legs, soles stay near the ground, footfalls alternate once per half cycle', () => {
  const {entry, rig} = makeEnemy('golem', 'gw', 0, 0); const flat = () => 0; entry.root.position.y = 0;
  const legL = named(rig, 'LegL'), legR = named(rig, 'LegR'), steps = [], sole = new THREE.Vector3();
  let maxSwing = 0, lowest = Infinity, highest = -Infinity;
  for (let f = 0; f < 240; f++) {
    if (f >= 30) entry.root.position.z -= 1.25 / 60; // walk forward (-Z) at golem speed
    const st = applyEnemyMotion(entry, {tick: f, dt: 1 / 60, height: flat}); entry.root.updateWorldMatrix(true, true);
    for (const e of st.events) if (e.type === 'step') steps.push([f, e.side]);
    if (f > 60) {
      maxSwing = Math.max(maxSwing, legL.quaternion.angleTo(legR.quaternion));
      legL.localToWorld(sole.set(0, -.95, 0)); lowest = Math.min(lowest, sole.y); highest = Math.max(highest, sole.y); // authored sole is .95 below the hip pivot
    }
  }
  assert.ok(maxSwing > .45, `legs scissor ${maxSwing}`);
  assert.ok(lowest > -.12 && lowest < .08, `planted sole stays at the ground ${lowest}`);
  assert.ok(highest > lowest + .03, `swing foot clears the ground ${highest - lowest}`);
  const travelled = 1.25 / 60 * 210, expected = travelled / (GOLEM_CYCLE * 1.0) * 2;
  assert.ok(Math.abs(steps.length - expected) <= 2.5, `footfalls ${steps.length} vs ${expected.toFixed(1)}`);
  for (let i = 1; i < steps.length; i++) assert.notEqual(steps[i][1], steps[i - 1][1], 'feet alternate');
  const stopped = applyEnemyMotion(entry, {tick: 240, dt: 1 / 60, height: flat});
  for (let f = 241; f < 300; f++) applyEnemyMotion(entry, {tick: f, dt: 1 / 60, height: flat});
  assert.ok(stopped.walk < .2 || enemyMotionState(rig.visual).walk < .05, 'gait fades out when the golem stops');
  assert.ok(legL.quaternion.angleTo(legR.quaternion) < .08, 'feet settle together at rest');
});
test('golem cues: telegraph and slam fire once on the shared attack tick; a lost leg lurches, no legs drags', () => {
  const {entry, rig} = makeEnemy('golem', 'gs', 0, 0), flat = () => 0, fired = [];
  for (let f = 0; f < 140; f++) { if (f === 40) entry.data.attackTick = 50; for (const e of applyEnemyMotion(entry, {tick: f, dt: 1 / 60, height: flat}).events) fired.push([f, e.type]); }
  assert.deepEqual(fired.filter(e => e[1] !== 'step'), [[50, 'telegraph'], [50 + STRIKE_TICK, 'slam']]);
  const body = named(rig, 'Golem');
  applyEnemyMotion(entry, {tick: 200, dt: 1 / 60, height: flat}); const upright = body.position.y;
  entry.data.missingParts = ['leftLeg', 'rightLeg'];
  for (let f = 201; f < 210; f++) applyEnemyMotion(entry, {tick: f, dt: 1 / 60, height: flat});
  assert.ok(body.position.y < upright - .3, `legless golem sinks to the ground ${upright} -> ${body.position.y}`);
});
test('no drift: with the mixer stopped the layer reuses its stored base each frame', () => {
  const {entry, rig} = makeEnemy('skeleton', 'e9');
  const torso = named(rig, 'Torso');
  applyEnemyMotion(entry, {tick: 5, dt: 1 / 60, height}); const a = torso.quaternion.clone();
  for (let i = 0; i < 50; i++) applyEnemyMotion(entry, {tick: 5, dt: 1 / 60, height});
  assert.ok(torso.quaternion.angleTo(a) < 1e-6, 'same tick -> same pose, no accumulation');
});

test('hit events without tick: direction/part applied whether event arrives before or after hurtTick sync', () => {
  for (const order of ['eventFirst', 'snapshotFirst']) {
    const {entry, rig} = makeEnemy('skeleton', 'e5'); rig.actions.idle.play();
    for (let tick = 0; tick < 5; tick++) { rig.mixer.update(1 / 60); applyEnemyMotion(entry, {tick, dt: 1 / 60, height}); }
    if (order === 'eventFirst') noteEnemyHit(entry, {part: 'leftArm', normal: [1, 0, 0]});
    entry.data.hurtTick = 5; rig.mixer.update(1 / 60); applyEnemyMotion(entry, {tick: 5, dt: 1 / 60, height});
    if (order === 'snapshotFirst') noteEnemyHit(entry, {part: 'leftArm', normal: [1, 0, 0]});
    const hits = enemyMotionState(rig.visual).hits;
    assert.equal(hits.length, 1, order); assert.equal(hits[0].part, 'leftArm', order); assert.equal(hits[0].tick, 5);
    assert.ok(hits[0].x < -.99, `${order} pushed toward actor-left ${hits[0].x}`);
  }
});
test('unknown platform (forge floor above terrain): feet stay at root height, no pelvis plunge', () => {
  const low = () => -3; // terrain far below the simulation-owned root
  const {entry, rig} = makeEnemy('skeleton', 'e6'); rig.actions.idle.play(); entry.root.position.y = 0.5;
  let st; for (let tick = 0; tick < 60; tick++) { rig.mixer.update(1 / 60); st = applyEnemyMotion(entry, {tick, dt: 1 / 60, height: low}); }
  entry.root.updateWorldMatrix(true, true);
  for (const leg of st.legs) { const y = wpos(leg.foot.node).y - leg.ankleH - leg.lift; assert.ok(Math.abs(y - .5) < .01, `sole ${y}`); }
  assert.ok(st.pelvisDrop < .01, `pelvis drop ${st.pelvisDrop}`);
});

// ---------------------------------------------------------------- budget
let perf;
test('budget: 48 skeletons + 16 golems for 600 frames (layer only)', () => {
  const actors = new Map(), rigs = [];
  for (let i = 0; i < 64; i++) { const kind = i % 4 === 3 ? 'golem' : 'skeleton'; const e = makeEnemy(kind, `e${i}`, (i % 8) * 2, Math.floor(i / 8) * 2); actors.set(`e:${i}`, e.entry); rigs.push(e.rig); (e.rig.actions.walk || e.rig.actions.idle).play(); }
  for (let f = 0; f < 30; f++) { rigs.forEach(r => r.mixer.update(1 / 60)); updateEnemyMotion(actors, {tick: f, dt: 1 / 60, height}); }
  global.gc?.(); const heap0 = process.memoryUsage().heapUsed; let layer = 0, worst = 0;
  for (let f = 0; f < 600; f++) {
    for (const [i, e] of [...actors.values()].entries()) { e.root.position.x += .015; e.root.position.y = height(e.root.position.x, e.root.position.z); if (f % 90 === i % 90) e.data.attackTick = f + 30; }
    rigs.forEach(r => r.mixer.update(1 / 60));
    const t0 = performance.now(); assert.equal(updateEnemyMotion(actors, {tick: 30 + f, dt: 1 / 60, height}), 64); const ms = performance.now() - t0; layer += ms; worst = Math.max(worst, ms);
  }
  global.gc?.(); const heap1 = process.memoryUsage().heapUsed;
  perf = {meanMs: layer / 600, worstMs: worst, heapDeltaKB: (heap1 - heap0) / 1024, gc: !!global.gc};
  assert.ok(perf.meanMs < 4, `mean ${perf.meanMs} ms`);
});

console.log(results.join('\n'));
console.log(`walk stats: ${JSON.stringify(walkStats)}`);
console.log(`budget: ${JSON.stringify(perf)}`);
console.log(`${passed} passed`);
