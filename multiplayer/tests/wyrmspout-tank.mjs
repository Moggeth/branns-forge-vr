// Wyrmspout III tank and indicators: the liquid keeps its volume however the tank is tilted, sloshes when the tank
// is shoved or turned and settles, and the wyrm's eye, fins and nostrils read the tank and the Gout charge smoothly.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {volumeBelow, levelFor, createSlosh, SLOSH} from '../client/wyrmspout-liquid.js';
import {enhanceWyrmspoutTemplate} from '../client/wyrmspout-look.js';
import {prepareAsset, animateWyrmspout} from '../client/asset-pose.js';
const started = performance.now();

// --- volume: the level solve keeps the fuel's volume at any tilt
{
  const r = .0236, h = .056;
  assert.ok(Math.abs(levelFor(new THREE.Vector3(0, 1, 0), .5, r, h)) < 1e-6, 'half a level tank sits on the axis');
  const upright = new THREE.Vector3(0, 0, 1);
  assert.ok(Math.abs(levelFor(upright, .25, r, h) - (-h / 2)) < 1e-5, 'standing on end the level is linear');
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const n = new THREE.Vector3(Math.sin(i * 1.7), Math.cos(i * .9), Math.sin(i * 2.3 + 1)).normalize(), f = (i % 19 + .5) / 19.5;
    worst = Math.max(worst, Math.abs(volumeBelow(n, levelFor(n, f, r, h), r, h) - f));
  }
  assert.ok(worst < 1e-4, `volume kept at every tilt (${worst.toExponential(1)})`);
  // Monte Carlo cross-check of the closed form at one oblique tilt.
  const n = new THREE.Vector3(.4, .8, .45).normalize(), d = .004; let inside = 0, below = 0, seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < 60000; i++) { const p = new THREE.Vector3(rnd() * r, rnd() * r, rnd() * h); if (p.x * p.x + p.y * p.y > r * r) continue; inside++; if (p.dot(n) <= d) below++; }
  assert.ok(Math.abs(below / inside - volumeBelow(n, d, r, h)) < .01, 'closed form matches sampling');
}

// --- slosh: a shove swings the surface toward the push, it rocks a few times and settles; turning keeps it level
for (const fps of [20, 60, 120]) {
  const slosh = createSlosh(), m = new THREE.Matrix4(), dt = 1 / fps; let x = 0, v = 0, t = 0;
  const tilts = [];
  for (let i = 0; i < 7 * fps; i++) {
    t += dt; const a = t < .25 ? 6 : t < .5 ? -6 : 0; v += a * dt; x += v * dt;   // a quick step right and stop
    m.makeTranslation(x, 1.5, 0); const s = slosh.update(dt, m); tilts.push(s.normal.x);
  }
  const peak = Math.max(...tilts.map(Math.abs)); let crossings = 0;
  for (let i = 1; i < tilts.length; i++) if (Math.sign(tilts[i]) !== Math.sign(tilts[i - 1]) && Math.abs(tilts[i]) > .005) crossings++;
  assert.ok(peak > .2 && peak <= SLOSH.maxTilt, `${fps} fps: a shove tilts the surface (${peak.toFixed(2)})`);
  assert.ok(crossings >= 3, `${fps} fps: it rocks back and forth (${crossings})`);
  assert.ok(Math.abs(tilts.at(-1)) < .02, `${fps} fps: and settles (${tilts.at(-1).toFixed(3)})`);
}
{
  // Turning the tank over slowly: the surface stays (nearly) level in the world, so it moves through the tank.
  const slosh = createSlosh(), m = new THREE.Matrix4(), q = new THREE.Quaternion(); let worst = 0;
  for (let i = 0; i < 180; i++) { q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), i / 180 * Math.PI); m.compose(new THREE.Vector3(0, 1.5, 0), q, new THREE.Vector3(1, 1, 1)); worst = Math.max(worst, slosh.update(1 / 60, m).normal.angleTo(new THREE.Vector3(0, 1, 0))); }
  assert.ok(worst < .35, `a slow turn drags the surface only a little (${worst.toFixed(2)} rad)`);
  // A teleport (respawn) does not fling the liquid.
  slosh.update(1 / 60, m.makeTranslation(40, 1.5, 0)); assert.ok(slosh.update(1 / 60, m).normal.y > .999);
}

// --- the real model: the template is patched once and copies share it; indicators read the tank and the Gout charge
{
  const glb = fs.readFileSync(new URL('../public/assets/wyrmspout.glb', import.meta.url));
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.length), '', resolve, reject));
  enhanceWyrmspoutTemplate(gltf.scene); enhanceWyrmspoutTemplate(gltf.scene);
  const liquidMat = gltf.scene.getObjectByName('FuelLiquid').material;
  assert.equal(liquidMat.userData.wyrmLiquid, true, 'the liquid gets the sloshing shader');
  const templateMats = new Set(); gltf.scene.traverse(o => o.material && templateMats.add(o.material));
  const {visual} = prepareAsset(gltf, 'wyrmspout', .4), holder = new THREE.Group(); holder.add(visual);
  visual.traverse(o => { if (o.material) assert.ok(templateMats.has(o.material), `${o.name}: material shared, not copied`); });
  const node = n => visual.getObjectByName(n);
  // lidOpen: the widest the upper lid stood over the last half second of a run (a blink may land at any moment).
  let time = 0, lastLid = null, worstLid = 0, lidOpen = 0;
  const run = (seconds, opts) => { const n = Math.round(seconds * 60); lidOpen = 0; for (let i = 0; i < n; i++) { time += 1 / 60; animateWyrmspout(visual, {time, ...opts});
    const lid = node('Eye_LidUpper').rotation.x; if (lastLid !== null) worstLid = Math.max(worstLid, Math.abs(lid - lastLid)); lastLid = lid; if (i >= n - 30) lidOpen = Math.max(lidOpen, Math.abs(lid)); } };
  run(1, {fill: 1, charge: 1});
  const wide = node('Eye_Pupil').scale.x, openLid = lidOpen;
  assert.ok(openLid > .3, 'lids rest open');
  assert.ok(node('NostrilFlame_L').visible && node('FinVein_3').scale.z > .95, 'Gout ready: fins lit, nostrils burning');
  run(1, {fill: .05, charge: 1});
  assert.ok(node('Eye_Pupil').scale.x < wide * .35, 'nearly dry: the pupil is a slit');
  run(.4, {fill: .05, charge: 1, gout: 1}); assert.ok(!node('NostrilFlame_L').visible || node('NostrilFlame_L').scale.z < .2, 'the Gout blows the nostril flames out');
  run(1, {fill: .1, charge: .5, locked: true});
  assert.ok(lidOpen < openLid * .1, 'refilling: the eye is shut');
  assert.ok(node('FinVein_1').scale.z > .95 && Math.abs(node('FinVein_2').scale.z - .5) < .06 && !node('FinVein_3').visible, 'veins light one by one');
  assert.ok(!node('NostrilFlame_L').visible, 'no flames while Gout recharges');
  run(1.5, {fill: 1, charge: .5, locked: true}); assert.ok(lidOpen > openLid * .9, 'refilled: the eye opens');
  assert.ok(worstLid < .2, `lids move smoothly (${worstLid.toFixed(3)} rad/frame)`);
  // The liquid's surface is computed per frame for this copy.
  const data = node('FuelLiquid').userData.wyrmLiquid;
  assert.ok(data && Number.isFinite(data.plane.w) && Math.abs(data.plane.length() - Math.hypot(1, data.plane.w)) < 1e-6, 'liquid plane per copy');
  assert.ok(data.tank.half > data.tank.radius * 1.5, 'tank axis measured');
}
console.log(JSON.stringify({result: 'pass', seconds: +((performance.now() - started) / 1000).toFixed(3)}));
