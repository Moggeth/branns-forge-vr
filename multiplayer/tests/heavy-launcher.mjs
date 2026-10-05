// Heavy Launcher: the Blender spring catapult model and its per-frame pose.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {heavyLauncherPose,HEAVY_LAUNCHER as H} from '../client/heavy-launcher.js';

const glb = readFileSync(new URL('../public/assets/heavy_launcher.glb', import.meta.url));
assert.equal(glb.toString('ascii', 0, 4), 'glTF');
const json = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
const named = Object.fromEntries(json.nodes.map(n => [n.name, n]));
for (const n of ['HeavyLauncher','Base','Arm','Axle','Ball','Yoke','Sear','Buffer','Cassette_L','Cassette_R']) assert.ok(named[n], `node ${n}`);
for (const n of ['Cassette_L','Cassette_R']) for (const p of json.meshes[named[n].mesh].primitives) {
  assert.equal(p.targets?.length, H.windKeys, `${n} wind keys`);
  for (const t of p.targets) { const a = json.accessors[t.POSITION]; assert.ok([...a.min, ...a.max].every(v => Math.abs(v) < .5), `${n} wind key stays at game scale`); }
}
const contract = JSON.parse(readFileSync(new URL('../assets-source/heavy-launcher/out/contract.json', import.meta.url)));
for (const k of ['psi_cock','psi_stop','yoke_rest','yoke_offset']) assert.ok(Math.abs(contract[k] - H[{psi_cock:'cock',psi_stop:'stop',yoke_rest:'yokeRest',yoke_offset:'yokeOffset'}[k]]) < 1e-9, `contract ${k}`);
assert.ok(contract.triangles < 16000, `phone budget: ${contract.triangles} triangles`);
assert.ok(glb.length < 1.2e6, 'model size');

// Rest: cocked, latched, loaded. Never-fired machines rest the same way.
let p = heavyLauncherPose(Infinity, 1); assert.equal(p.arm, H.cock); assert.equal(p.stone, 1); assert.equal(p.wind, 1);
p = heavyLauncherPose(Infinity, .3); assert.equal(p.arm, H.cock, 'never fired stays cocked while building');

// One full cycle at 120 fps: the finger bar never passes through the arm, motion is continuous except the loose.
const reload = 6, dt = 1 / 120; let prev = null, maxStep = 0;
for (let t = 0; t <= reload + .2; t += dt) {
  const q = heavyLauncherPose(t, Math.min(1, t / reload));
  assert.ok(q.yoke - q.arm >= H.yokeOffset - 1e-9, `finger bar inside arm at ${t.toFixed(3)}s`);
  assert.ok(q.arm >= H.cock - 1e-9 && q.arm <= H.stop + .08, 'arm within its travel');
  assert.ok(q.wind >= 0 && q.wind <= 1);
  if (prev && t > H.swing + dt) maxStep = Math.max(maxStep, Math.abs(q.arm - prev.arm), Math.abs(q.yoke - prev.yoke));
  prev = q;
}
assert.ok(maxStep < .06, `smooth reload, largest frame step ${maxStep.toFixed(3)} rad`);
p = heavyLauncherPose(H.swing + .01, .01); assert.ok(p.arm >= H.stop - 1e-9 && p.stone === 0, 'slams to the stop and the stone has flown');
p = heavyLauncherPose(3, .5); assert.ok(p.arm < H.stop - .3 && p.yoke - p.arm - H.yokeOffset < 1e-9, 'yoke drives the arm down');
p = heavyLauncherPose(5.5, .92); assert.equal(p.arm, H.cock); assert.ok(p.stone === 1 && p.drop > 0, 'stone drops in after latching');
console.log('heavy-launcher: model nodes, spring keys, contract, cycle continuity and finger clearance pass');
