// Mechanical checks for the Timberline kit. Node 22, no dependencies.
//   node tests/timberline-check.mjs
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {TIMBERLINE_FLIGHT, timberlinePairState, timberlineHalfSpacing, timberlineTension, timberlineImpactResponse} from '../runtime/timberline-flight.js';
import {createTimberlineMount, createTimberlineVolley, sweepFilament, TIMBERLINE_RULES} from '../runtime/timberline-sim.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('ok', name); };

function glb(name) {
  const b = readFileSync(join(root, 'out', name));
  assert.equal(b.readUInt32LE(0), 0x46546c67, `${name} magic`);
  const len = b.readUInt32LE(12);
  return {bytes: b.length, json: JSON.parse(b.subarray(20, 20 + len).toString())};
}

function worldPositions(j) {
  // Rest-pose world positions (translation-only composition is enough for
  // these checks except where nodes are rotated; we compose full TRS).
  const out = {};
  const mul = (a, b) => {
    const r = new Array(16).fill(0);
    for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) for (let m = 0; m < 4; m++) r[i * 4 + k] += a[m * 4 + k] * b[i * 4 + m];
    return r;
  };
  const trs = (n) => {
    const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
    const [sx, sy, sz] = n.scale || [1, 1, 1];
    const [tx, ty, tz] = n.translation || [0, 0, 0];
    return [
      (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
      (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
      (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
      tx, ty, tz, 1];
  };
  const walk = (i, parent) => {
    const n = j.nodes[i];
    const m = mul(parent, trs(n));
    out[n.name] = [m[12], m[13], m[14]];
    for (const c of n.children || []) walk(c, m);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of j.scenes[j.scene || 0].nodes) walk(r, I);
  return out;
}

const ball = glb('timberline_ballista.glb');
const bolts = glb('timberline_bolts.glb');
const col = glb('timberline_collision.glb');
const report = JSON.parse(readFileSync(join(root, 'out', 'build_report.json'), 'utf8'));
const contract = JSON.parse(readFileSync(join(root, 'out', 'timberline_contract.json'), 'utf8'));

check('ballista: required pivots, sockets and clips', () => {
  const names = new Set(ball.json.nodes.map((n) => n.name));
  for (const n of ['TimberlineBallista', 'Pedestal', 'Traverse', 'CarriageShake', 'Carriage', 'Elevation', 'Recoil', 'LaunchFrame',
    'Drum', 'Crank', 'Pawl', 'Trigger', 'Sled_L', 'Sled_R', 'Claw_L', 'Claw_R', 'Cable_L', 'Cable_R',
    'Limb_L_Outer', 'Limb_L_Inner', 'Limb_R_Outer', 'Limb_R_Inner', 'String_L_Outer', 'String_L_Inner', 'String_R_Outer', 'String_R_Inner',
    'LoadedBolt_L', 'LoadedBolt_R', 'Socket_Muzzle_L', 'Socket_Muzzle_R', 'Socket_LoadedEye_L', 'Socket_LoadedEye_R',
    'Socket_FilamentHorn', 'Socket_AimGrip_L', 'Socket_AimGrip_R', 'Socket_CrankGrip_L', 'Socket_CrankGrip_R', 'Socket_Trigger',
    'Socket_OperatorEye', 'Socket_RTSAnchor', 'FX_Muzzle_L', 'FX_Muzzle_R', 'FX_StringSnap_L', 'FX_StringSnap_R',
    'FX_FootDust_0', 'FX_FootDust_3']) assert.ok(names.has(n), `missing ${n}`);
  const clips = ball.json.animations.map((a) => a.name).sort();
  assert.deepEqual(clips, ['Fire', 'Idle_Loaded', 'Reload', 'Unloaded']);
  for (const a of ball.json.animations) {
    const targets = new Set(a.channels.map((c) => ball.json.nodes[c.target.node].name));
    for (const forbidden of ['Traverse', 'Elevation']) assert.ok(!targets.has(forbidden), `${a.name} must not animate ${forbidden}`);
  }
});

check('ballista: rest pose is loaded and faces -Z', () => {
  const w = worldPositions(ball.json);
  assert.ok(w.Socket_Muzzle_L[2] < -0.5 && w.Socket_Muzzle_R[2] < -0.5, 'muzzles ahead (-Z)');
  assert.ok(w.Socket_Trigger[2] > 0.5, 'trigger behind (+Z)');
  assert.ok(Math.abs(w.Socket_Muzzle_L[0] + w.Socket_Muzzle_R[0]) < 1e-4, 'rails mirrored');
  assert.ok(w.Socket_LoadedEye_L[0] > w.Socket_Muzzle_L[0] && w.Socket_LoadedEye_R[0] < w.Socket_Muzzle_R[0], 'eyes are inboard');
  assert.ok(Math.abs(w.Socket_FilamentHorn[0]) < 1e-4 && w.Socket_FilamentHorn[2] < w.Socket_LoadedEye_L[2], 'horn centred, ahead of eyes');
  const lb = ball.json.nodes.find((n) => n.name === 'LoadedBolt_L');
  assert.ok(!lb.scale || lb.scale.every((v) => v > 0.99), 'loaded bolts visible at rest');
  // Draped filament length equals the taut length (it rests lightly tensioned on the horn).
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const drape = d(w.Socket_LoadedEye_L, w.Socket_FilamentHorn) + d(w.Socket_FilamentHorn, w.Socket_LoadedEye_R);
  assert.ok(Math.abs(drape - contract.ballista.filament_taut_length) < 0.01, `drape ${drape}`);
  assert.ok(w.Socket_OperatorEye[2] > 0.8 && w.Socket_OperatorEye[1] > 1.4, 'operator stands behind');
});

check('ballista: events fit the cooldown', () => {
  const ev = contract.ballista.events;
  const fire = Object.fromEntries(ev.Fire);
  const reload = Object.fromEntries(ev.Reload);
  assert.ok(fire.release > 0 && fire.release < 0.1, 'punchy release');
  assert.ok(contract.ballista.clip_lengths.Fire + contract.ballista.clip_lengths.Reload <= TIMBERLINE_RULES.cooldown, 'fits 4 s');
  const order = ['reload_start', 'pawl_release', 'strings_caught', 'winding_start', 'strings_latched', 'bolts_seat', 'filament_reset', 'reload_complete'];
  for (let i = 1; i < order.length; i++) assert.ok(reload[order[i]] > reload[order[i - 1]], `${order[i]} after ${order[i - 1]}`);
  assert.equal(TIMBERLINE_RULES.releaseDelay, fire.release);
  assert.equal(TIMBERLINE_RULES.reloadDuration, contract.ballista.clip_lengths.Reload);
  assert.equal(TIMBERLINE_RULES.reloadStart, contract.ballista.clip_lengths.Fire);
});

check('bolts: mirrored pair, vane hinges, sockets, clips', () => {
  const names = new Set(bolts.json.nodes.map((n) => n.name));
  for (const t of ['L', 'R']) {
    for (const n of [`Bolt_${t}`, `Bolt_${t}_VaneUpper`, `Bolt_${t}_VaneLower`, `Bolt_${t}_FilamentEye`, `Bolt_${t}_Tip`, `Bolt_${t}_Nock`, `Bolt_${t}_FX_Head`]) {
      assert.ok(names.has(n), `missing ${n}`);
    }
  }
  const node = (n) => bolts.json.nodes.find((x) => x.name === n);
  const eyeL = node('Bolt_L_FilamentEye').translation, eyeR = node('Bolt_R_FilamentEye').translation;
  assert.ok(eyeL[0] > 0 && eyeR[0] < 0 && Math.abs(eyeL[0] + eyeR[0]) < 1e-5, 'eyes mirror inboard');
  const vL = node('Bolt_L_VaneUpper').translation, vR = node('Bolt_R_VaneUpper').translation;
  assert.ok(vL[0] > 0 && vR[0] < 0 && Math.abs(vL[0] + vR[0]) < 1e-5, 'vanes mirror inboard');
  assert.ok(node('Bolt_L_Tip').translation[2] < 0, 'tip toward -Z');
  for (const n of bolts.json.nodes) assert.ok(!n.scale || n.scale.every((v) => v > 0), `no negative/zero scale on ${n.name}`);
  assert.deepEqual(bolts.json.animations.map((a) => a.name).sort(), ['Deploy', 'Folded', 'Impact']);
  assert.ok(!names.has('Filament'), 'no baked filament mesh');
});

check('collision: proxies hang off real pivot names', () => {
  const ballNames = new Set(ball.json.nodes.map((n) => n.name));
  const parentOf = {};
  col.json.nodes.forEach((n) => (n.children || []).forEach((c) => { parentOf[col.json.nodes[c].name] = n.name; }));
  const proxies = col.json.nodes.filter((n) => n.name.startsWith('COL_'));
  assert.ok(proxies.length >= 10);
  for (const p of proxies) assert.ok(ballNames.has(parentOf[p.name]), `${p.name} parent ${parentOf[p.name]}`);
});

check('budgets: triangles, materials, textures, file sizes', () => {
  const b = report.ballista, p = report.bolts;
  assert.ok(b.triangles.LOD0 <= 16000 && b.triangles.LOD1 <= 6000, JSON.stringify(b.triangles));
  assert.ok(p.triangles.LOD0 <= 2000, JSON.stringify(p.triangles));
  assert.ok(b.materials <= 6 && p.materials <= 6);
  assert.ok(b.bytes < 2.5e6 && p.bytes < 0.6e6 && report.collision.bytes < 0.1e6);
});

check('flight: release -> deploy -> spread -> taut, mirrored, no thrust', () => {
  const launch = {origin: [0, 1.2, 0], forward: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0]};
  const f = TIMBERLINE_FLIGHT;
  let prevHalf = 0;
  const phases = [];
  for (let t = 0; t <= f.tautTime; t += 1 / 240) {
    const h = timberlineHalfSpacing(t).half;
    assert.ok(h + 1e-9 >= prevHalf, 'spread is monotonic until taut');
    prevHalf = h;
    const s = timberlinePairState(t, launch);
    if (!phases.includes(s.phase)) phases.push(s.phase);
    assert.ok(Math.abs(s.left[0] + s.right[0]) < 1e-9, 'mirror symmetric');
    assert.ok(Math.abs(-s.centre[2] - f.speed * t) < 1e-9, 'constant forward speed: vanes add no thrust');
  }
  assert.deepEqual(phases.slice(0, 4), ['loaded', 'release', 'deploy', 'spread']);
  assert.equal(timberlinePairState(f.tautTime + 0.001, launch).phase, 'taut');
  assert.ok(Math.abs(timberlineHalfSpacing(f.tautTime + 0.5).half - f.tautHalf) < 1e-3, 'settles at filament length');
  assert.ok(timberlineTension(f.tautTime + 0.001) > 1.1 && timberlineTension(f.tautTime + 0.4) < 0.95, 'snap spike then settle');
  assert.ok(f.tautHalf - f.loadedHalf < 0.15, 'spread is slight');
});

check('impact: filament bows, bolts drawn in, pair slows', () => {
  const r = timberlineImpactResponse(0.06, 0.7);
  assert.ok(r.bow > 0.2 && r.pullIn > 0 && r.speedScale < 0.7 && r.tension > 1.2, JSON.stringify(r));
  let last = Infinity;
  for (let t = 0; t < 1; t += 0.01) {
    const s = timberlineImpactResponse(t, 0.7).speedScale;
    assert.ok(s <= last + 1e-12, 'speed never increases after impact (no thrust)');
    last = s;
  }
  const stop = timberlineImpactResponse(1.0, 1.0);
  assert.ok(stop.speedScale < 0.01 && stop.cut === 0, 'full resistance stops the pair');
  const through = timberlineImpactResponse(0.6, 0.3);
  assert.ok(through.cut > 0.99 && through.bow < 0.01 && through.speedScale > 0.5, 'light resistance shears through');
});

check('sim: cooldown and sweep', () => {
  const m = createTimberlineMount();
  assert.equal(m.tryFire(10).fired, true);
  assert.equal(m.tryFire(13.9).fired, false);
  assert.equal(m.phase(10.5).name, 'firing');
  assert.equal(m.phase(12).name, 'reloading');
  assert.equal(m.phase(14).name, 'loaded');
  assert.equal(m.tryFire(14).fired, true);
  const launch = {origin: [0, 1.2, 0], forward: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0]};
  const v = createTimberlineVolley(launch);
  const tree = {centre: [0.2, 0, -12], radius: 0.25, height: 5};
  const wide = {centre: [3, 0, -12], radius: 0.25, height: 5};
  let hit = null, miss = null;
  for (let i = 0; i < 120 && !hit; i++) {
    const prev = v.state;
    const s = v.step(1 / 60);
    hit = sweepFilament(prev.left, prev.right, s.left, s.right, tree);
    miss = miss || sweepFilament(prev.left, prev.right, s.left, s.right, wide);
  }
  assert.ok(hit && hit.part === 'filament' && hit.s > 0.5 && hit.s < 0.9, JSON.stringify(hit));
  assert.equal(miss, null);
  v.strike(0.6);
  for (let i = 0; i < 30; i++) v.step(1 / 60);
  assert.equal(v.state.phase, 'impact');
});

console.log(`${passed} checks passed`);
