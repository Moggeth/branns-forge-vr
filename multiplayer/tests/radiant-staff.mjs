// node tests/radiant-staff.mjs — Sunthread (the Radiant staff): real staff.glb + client/radiant-staff.js, no GPU.
// Budget and runtime nodes, one permanent light (never added or removed), latch cone, nova cooldown, day/night light.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createRadiantStaff, enhanceStaffTemplate, STAFF} from '../client/radiant-staff.js';
import {prepareAsset} from '../client/asset-pose.js';

const here = path.dirname(fileURLToPath(import.meta.url));
globalThis.self ??= globalThis;
const quiet = [console.warn, console.error]; console.warn = console.error = () => {};
const file = fs.readFileSync(path.join(here, '..', 'public', 'assets', 'staff.glb'));
const gltf = await new Promise((res, rej) => new GLTFLoader().parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '', res, rej));
[console.warn, console.error] = quiet;

// the model: budget and the nodes the runtime drives
let triangles = 0; gltf.scene.traverse(n => { if (n.isMesh) triangles += (n.geometry.index ? n.geometry.index.count : n.geometry.attributes.position.count) / 3; });
assert.ok(triangles < 8000, `held tool budget is 8k triangles (got ${triangles})`);
for (const name of ['GripAnchor', 'Crown', 'SunCore', 'Halo', 'BeamOrigin', 'Foot']) assert.ok(gltf.scene.getObjectByName(name), `staff.glb keeps ${name}`);
enhanceStaffTemplate(gltf.scene);
const glows = new Set(); gltf.scene.traverse(n => { if (n.isMesh && ['Sunstone', 'HaloGlow', 'ThreadGlow', 'Skystone'].includes(n.material.name)) glows.add(n.material); });
assert.ok(glows.size >= 3, 'the glow materials are found by name');
for (const m of glows) assert.equal(m.toneMapped, false, `${m.name} glows past tone mapping so bloom catches it`);

const {visual} = prepareAsset(gltf, 'staff', 1.6);
const holder = new THREE.Group(); holder.add(visual); holder.position.set(.3, 1.5, -.6); holder.updateMatrixWorld(true);

let night = 0; const foes = [];
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(); camera.position.set(0, 1.65, 0); scene.add(camera); camera.updateMatrixWorld(true);
const staff = createRadiantStaff({scene, height: () => 0, night: () => night, audio: () => null, reducedMotion: false,
  ground: (o, d, max) => d.y < 0 ? o.clone().addScaledVector(d, Math.min(max, -o.y / d.y)) : null, *targets() { yield* foes; }});
const lights = () => { let n = 0; scene.traverse(o => { if (o.isLight) n++; }); return n; };
assert.equal(lights(), 1, 'one shared light, made up front');
const ahead = new THREE.Vector3(0, -.15, -1).normalize(), aim = {origin: [0, 1.65, 0], direction: ahead.toArray()};
let time = 10; const run = (seconds, shown = true) => { let s; for (let t = 0; t < seconds; t += 1 / 30) { time += 1 / 30; s = staff.update({time, dt: 1 / 30, shown, aim, camera}); } return s; };

// away: dark and inert
staff.attach(null); let s = run(.3, false);
assert.equal(s.light, 0); assert.equal(lights(), 1);

// in hand: a day glow, brighter at night
staff.attach(visual); const day = run(.5).light; night = 1; const dusk = run(.5).light; night = 0;
assert.ok(day > 0 && dusk > day * 2, `night light (${dusk}) well above day (${day})`);

// hold: the thread lands on the ground ahead, then latches onto a foe inside the cone, never one outside it
staff.press(); s = run(.4);
assert.equal(s.beam, true); assert.equal(s.latched, null); assert.ok(Math.abs(s.to[1]) < .05, 'lands on the ground');
foes.push({id: 'wide', position: new THREE.Vector3(6, 1, -6)});
assert.equal(run(.2).latched, null, 'a foe 45° off the aim is not latched');
foes.push({id: 'near', position: new THREE.Vector3(.4, 1.2, -8)});
s = run(.4); assert.equal(s.latched, 'near');
assert.ok(new THREE.Vector3().fromArray(s.to).distanceTo(foes[1].position) > .3, 'the thread stops on the near side of the foe');
assert.ok(s.light > day, 'the beam brightens the light it carries');
staff.release(); s = run(.6); assert.equal(s.beam, false);

// nova: once per cooldown, and it flares the light
assert.equal(staff.nova(time), true); const flare = run(.1).light; assert.ok(flare > day * 3, `nova flares (${flare})`);
assert.equal(staff.nova(time), false, 'nova waits for its cooldown');
run(STAFF.nova.cooldown); assert.equal(staff.nova(time), true);

// put away mid-beam: the light goes out and the hold ends
staff.press(); run(.2); s = run(.1, false); assert.equal(s.light, 0); assert.equal(staff.holding(), false);
assert.equal(lights(), 1, 'still exactly one light: nothing was added or removed');
staff.dispose();
console.log(`radiant-staff: ok (${triangles} triangles, day light ${day}, night ${dusk}, nova ${flare})`);
