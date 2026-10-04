import assert from 'node:assert/strict';
import * as T from 'three';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareAsset, updateWeaponPresentation} from '../client/asset-pose.js';
import {createSiegebirdSight, SIEGEBIRD_PRESENTATION as P} from '../client/siegebird-sight.js';
import {createSiegebirdFlock, siegebirdBirdPose, SIEGEBIRD_PLUMAGES} from '../client/siegebird-flock.js';
import {SIEGEBIRD_RELOAD as R, siegebirdSide, siegebirdPlumage, siegebirdMechanism, siegebirdCues, SIEGEBIRD_WINCH} from '../client/siegebird-reload.js';
// Siegebird songbird reload presentation: alternation, plumage flock, timeline, off-frame entry, bolt hand-off,
// clearance against the crossbow and sight, golden dressing and shared GPU resources.
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
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}
const [crossbow, bird] = await Promise.all(['crossbow', 'siegebird_songbird'].map(n => new GLTFLoader().parseAsync(untextured(n), '')));

// 1. Alternation and flock plumage.
assert.deepEqual([1, 2, 3, 4].map(siegebirdSide), [1, -1, 1, -1], 'first bird from the right, then alternate');
for (const id of ['p1', 'guest-7']) {
  const seq = Array.from({length: 60}, (_, i) => siegebirdPlumage(id, i + 1));
  for (let c = 0; c < 10; c++) assert.deepEqual([...seq.slice(c * 6, c * 6 + 6)].sort(), [0, 1, 2, 3, 4, 5], 'each cycle shows all six plumages');
  for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1], 'never the same colour twice in a row');
}
assert.notDeepEqual(Array.from({length: 6}, (_, i) => siegebirdPlumage('p1', i + 1)), Array.from({length: 6}, (_, i) => siegebirdPlumage('p2', i + 1)));
assert.equal(SIEGEBIRD_PLUMAGES.length, 6);

// 2. Timeline: the string is latched before the bird seats the bolt, which happens before the shot is allowed.
assert.ok(R.windEnd < R.seat && R.enter < R.arrive && R.arrive < R.seat && R.seat < R.seconds && R.seconds < R.gone);
assert.equal(siegebirdMechanism(R.seat - .01).bolt, false); assert.equal(siegebirdMechanism(R.seat).bolt, true);
assert.equal(siegebirdMechanism(R.windEnd).cocked, 1); assert.ok(Math.abs(siegebirdMechanism(R.windEnd).crank - 4 * Math.PI) < 1e-9, 'two crank turns');
assert.equal(siegebirdMechanism(0).kick, 0, 'the bolt leaves before the kick moves the bore');
assert.deepEqual(siegebirdMechanism(Infinity), {cocked: 1, crank: 0, pinion: 0, drum: 0, clutch: 0, latch: 0, trigger: 0, string: 0, flex: 0, wound: SIEGEBIRD_WINCH.baseWraps + 1, bolt: true, boltDrop: 0, kick: 0});
{ // Coherent winch: the gear train stays meshed (pinion = 2 x drum, opposite sense), the crank only turns while the
  // clutch is engaged, one drum turn is one full draw (cable radius = travel / tau) and the cable on the drum
  // tracks the draw. Release is fast and spins the drum back; the clutch is out while it does.
  const W = SIEGEBIRD_WINCH, tau = Math.PI * 2;
  for (let t = 0; t <= R.seconds; t += .005) {
    const m = siegebirdMechanism(t);
    assert.ok(Math.abs(m.pinion + m.drum * W.gearTeeth / W.pinionTeeth) < 1e-9, `gears meshed at ${t}`);
    assert.ok(Math.abs(m.drum + m.cocked * tau) < 1e-9 && Math.abs(m.wound - W.baseWraps - m.cocked) < 1e-9, `drum and cable follow the draw at ${t}`);
    if (m.clutch > .5) assert.equal(m.crank, 0, `crank still while the clutch is out at ${t}`);
    if (t >= R.windStart) assert.ok(Math.abs(m.crank - m.pinion) < 1e-9, `crank drives the pinion once engaged at ${t}`);
  }
  assert.ok(siegebirdMechanism(W.release).cocked < 1e-9 && siegebirdMechanism(.5 * W.release).clutch > .5, 'string thrown forward with the clutch out');
  const lifts = []; for (let t = R.windStart + .01; t < R.windEnd - .03; t += .001) lifts.push(siegebirdMechanism(t).latch);
  assert.ok(lifts.every(a => a < 0 && a > -.2), 'pawl rides the ratchet while winding');
  assert.ok(lifts.filter((a, i) => i && a - lifts[i - 1] > .05).length >= 12, 'pawl drops off tooth after tooth');
  assert.equal(siegebirdMechanism(R.windEnd).latch, 0, 'pawl in the last notch at full draw');
}
const cues = siegebirdCues(0, R.seconds).map(c => c.cue);
assert.equal(cues.filter(c => c === 'click').length, SIEGEBIRD_WINCH.ratchetTeeth - 1); assert.deepEqual(cues.slice(0, 2), ['release', 'engage']); assert.equal(cues.at(-1), 'ready'); assert.ok(cues.indexOf('latch') < cues.indexOf('seat'));
assert.deepEqual(siegebirdCues(.5, .5), []); assert.deepEqual(siegebirdCues(Infinity, .2), []);

// 3. First-person framing: the bird enters off-frame on its side, is on screen by the hover, and is clear of the
// sight picture by the time the next shot is allowed.
const camera = new T.PerspectiveCamera(70, 16 / 9, .05, 200), anchor = new T.Group(); camera.add(anchor); anchor.position.fromArray(P.hip);
const visual = prepareAsset(crossbow, 'crossbow').visual; anchor.add(visual);
const sight = createSiegebirdSight(T, visual);
const flock = createSiegebirdFlock({birdTemplate: bird, crossbowTemplate: crossbow});
camera.updateMatrixWorld(true);
const ndc = p => p.clone().project(camera);
const birdRoot = () => visual.getObjectByName('SiegebirdSongbird');
function at(t, side = 1) { // world position of the grip for side at reload time t
  const pose = siegebirdBirdPose(t, side); if (!pose) return null;
  const native = visual.getObjectByName('SiegebirdFlock')?.parent || visual.children[0];
  visual.updateWorldMatrix(true, true); return native.localToWorld(pose.pos.clone());
}
flock.shot(visual, {n: 1, playerId: 'p1', time: 10});
for (const side of [1, -1]) {
  const enter = ndc(at(R.enter + .001, side)), hover = ndc(at(R.arrive, side));
  assert.ok(Math.abs(enter.x) > 1.05 || Math.abs(enter.y) > 1.05, `bird starts off-frame (${side}) ${enter.toArray()}`);
  assert.ok(Math.sign(enter.x) === side || side === 1 && enter.x > 0, `enters from its own side (${side})`);
  assert.ok(Math.abs(hover.x) < 1 && Math.abs(hover.y) < 1, `hover is on screen (${side})`);
}
{ // By the time the shot is allowed the bird is out of the sight line (> 10 deg off the bore through the peep).
  const eye = camera.localToWorld(new T.Vector3(...sight.eye.toArray()).applyQuaternion(anchor.quaternion).add(anchor.position));
  const bore = new T.Vector3(0, 0, -1).applyQuaternion(anchor.getWorldQuaternion(new T.Quaternion()));
  for (const side of [1, -1]) { const d = at(R.seconds, side).sub(eye).normalize(); assert.ok(Math.acos(d.dot(bore)) > 10 * Math.PI / 180, `bird clear of the sight at ${R.seconds}s`); }
}

// 4. Hand-off: carried bolt until the seat, then the crossbow's own Bolt (in its rest pose) and no carried copy.
const step = t => { flock.update(visual, 10 + t, {}); updateWeaponPresentation(visual, 'crossbow', {reload: t}); };
step(.1); assert.equal(birdRoot()?.visible ?? false, false, 'no bird before it enters');
step(R.enter + .05); assert.equal(birdRoot().visible, true);
const carried = () => birdRoot().getObjectByName('SiegebirdCarryPivot'), seated = () => visual.getObjectByName('Bolt');
step(R.seat - .02); assert.equal(carried().visible, true); assert.equal(seated().visible, false);
step(R.seat + .001); assert.equal(carried().visible, false); assert.equal(seated().visible, true);
{ // The carried bolt lands exactly where the seated one rests (same world transform at the hand-off).
  const pose = siegebirdBirdPose(R.seat - 1e-6, 1); flock.update(visual, 10 + R.seat - 1e-6, {}); carried().visible = true;
  const shaft = carried().getObjectByName('SiegebirdCarriedBoltShaft'); visual.updateWorldMatrix(true, true);
  updateWeaponPresentation(visual, 'crossbow', {reload: Infinity});
  const a = shaft.getWorldPosition(new T.Vector3()), b = seated().getWorldPosition(new T.Vector3());
  assert.ok(a.distanceTo(b) < .02, `hand-off within 2 cm (${a.distanceTo(b).toFixed(4)} m, pitch ${pose.pitch.toFixed(2)})`);
  const qa = shaft.getWorldQuaternion(new T.Quaternion()), qb = seated().getWorldQuaternion(new T.Quaternion());
  assert.ok(qa.angleTo(qb) < .12, `hand-off aligned (${qa.angleTo(qb).toFixed(3)} rad)`);
}
step(R.gone + .01); assert.equal(birdRoot().visible, false, 'flown off');

// 5. Clearance: bird and carried bolt against the crossbow body, prod, mechanism and sight while it hovers in.
{
  const targets = []; visual.traverse(n => { if (n.isMesh && n.visible && !/^(Songbird|SiegebirdCarried)/.test(n.name) && !n.parent?.name?.startsWith('SiegebirdCarried')) {
    let inside = false; for (let p = n; p; p = p.parent) if (p.name === 'SiegebirdFlock' || p.name === 'Bolt') inside = true; if (!inside) targets.push(n); } });
  const inCarried = m => { for (let q = m; q; q = q.parent) if (q.name === 'SiegebirdCarryPivot') return true; return false; };
  const ray = new T.Raycaster(), a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), hits = new Map();
  for (const side of [1, -1]) for (let t = R.arrive - .1; t <= R.seat + .12; t += .02) {
    flock.update(visual, 10 + t, {}); updateWeaponPresentation(visual, 'crossbow', {reload: t}); const root = birdRoot(); root.visible = true; visual.updateWorldMatrix(true, true);
    root.traverse(m => { if (!m.isMesh) return; for (let q = m; q !== root; q = q.parent) if (!q.visible) return; const pos = m.geometry.attributes.position, idx = m.geometry.index;
      for (let i = 0; i < idx.count; i += 3 * 4) { // every 4th triangle's edges
        a.fromBufferAttribute(pos, idx.getX(i)).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(pos, idx.getX(i + 1)).applyMatrix4(m.matrixWorld);
        const len = c.subVectors(b, a).length(); ray.set(a, c.normalize()); ray.far = len;
        for (const h of ray.intersectObjects(targets, false)) {
          const name = h.object.name || h.object.parent?.name;
          // The carried bolt's nock meeting the latched string just before it seats is the intended contact.
          if (inCarried(m) && /^(LiveCord|Sled)/.test(name) && t > R.seat - .06) continue;
          hits.set(name, (hits.get(name) || 0) + 1);
        }
      } });
  }
  // Seated contact with the rail itself is the point of the exercise; anything else is a clip.
  const clips = [...hits].filter(([name]) => !/^Bolt/.test(name));
  console.log('siegebird-songbird clearance', JSON.stringify(Object.fromEntries(clips)));
  assert.ok(clips.reduce((n, [, v]) => n + v, 0) <= 6, `bird flight clips the crossbow ${JSON.stringify(clips)}`);
}

// 6. Golden: carried, seated and loaded state; plain again on rest. Bird clones share the template geometry.
flock.shot(visual, {n: 2, playerId: 'p1', time: 20}); flock.inform(visual, {n: 2, golden: true});
flock.update(visual, 20 + R.enter + .05, {});
const goldenBird = visual.getObjectByName('SiegebirdFlock').children.find(c => c.visible && c.name === 'SiegebirdSongbird');
assert.ok(goldenBird.getObjectByName('SongbirdBody').material.name.endsWith('golden'));
for (let t = R.enter; t <= R.seat + .01; t += .05) flock.update(visual, 20 + t, {});
flock.update(visual, 20 + R.seat + .01, {});
assert.equal(flock.loadedGolden(visual), true); seated().traverse(n => { if (n.isMesh) assert.ok(n.material.name.endsWith('_golden')); });
flock.rest(visual, false); assert.equal(flock.loadedGolden(visual), false); seated().traverse(n => { if (n.isMesh) assert.ok(!n.material.name.endsWith('_golden')); });
const templateGeometry = new Set(); bird.scene.traverse(n => n.geometry && templateGeometry.add(n.geometry));
visual.getObjectByName('SiegebirdFlock').traverse(n => { if (n.isMesh && /^Songbird/.test(n.name)) assert.ok(templateGeometry.has(n.geometry), 'bird geometry shared, never copied'); });
assert.equal(flock.stats.birds, 2, 'two birds per crossbow at most (one arriving, one leaving)');
flock.dispose(); sight.dispose();
console.log(`siegebird-songbird: alternation, flock plumage, timeline, off-frame entry, hand-off, clearance, golden and sharing pass (${((performance.now() - begin) / 1000).toFixed(2)} s)`);
