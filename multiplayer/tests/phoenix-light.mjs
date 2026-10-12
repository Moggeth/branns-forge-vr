import assert from 'node:assert/strict';
import * as T from 'three';
import {createPhoenixLight, PHOENIX_LIGHT} from '../client/phoenix-light.js';

// One pooled light, always present: the scene's light count never changes, so no material recompiles.
let dark = 0;
const scene = new T.Scene(), camera = new T.PerspectiveCamera(); camera.position.set(0, 2, 0); scene.add(camera);
const count = () => { let n = 0; scene.traverse(o => { if (o.isLight) n++; }); return n; };
const view = createPhoenixLight({scene, camera, night: () => dark});
const step = (frames, offers = []) => { let i = 0; for (let f = 0; f < frames; f++) { for (const [p, w] of offers) view.offer(p, w); i = view.update(1 / 60); } return i; };
assert.equal(count(), 1); assert.equal(view.light.intensity, 0, 'idle light is dark');
assert.equal(view.light.castShadow, false);

const bird = new T.Vector3(4, 2, 0);
const day = step(60, [[bird, 1]]);
assert.ok(day > PHOENIX_LIGHT.day.intensity * .6 && day < PHOENIX_LIGHT.day.intensity * 1.2, `day glow is modest (${day})`);
assert.ok(view.light.position.distanceTo(bird) < .05, 'the light sits on the bird');
dark = 1;
const night = step(60, [[bird, 1]]);
assert.ok(night > day * 6, `night glow is far brighter (${night} vs ${day})`);
assert.ok(view.light.distance >= PHOENIX_LIGHT.night.distance - .01, 'and reaches much further');
assert.equal(count(), 1, 'still exactly one light');

// Two birds: the nearer one carries the light.
const near = new T.Vector3(1, 2, 0), far = new T.Vector3(30, 2, 0);
step(30, [[far, 1], [near, 1]]);
assert.ok(view.light.position.distanceTo(near) < .2, 'nearest phoenix wins');
// A bird beside the camera loses to one further off that the player is actually looking at.
const beside = new T.Vector3(3, 2, 0), ahead = new T.Vector3(0, 2, -8);
camera.lookAt(0, 2, -10); camera.updateMatrixWorld();
step(10, [[beside, 1], [ahead, 1]]);
assert.ok(view.light.position.distanceTo(ahead) < .2, 'the bird in view wins over one off screen');

// A hit flashes at the wound, brighter than the bird.
view.flash([10, 1, 10]);
const flash = step(4, [[near, 1]]);
assert.ok(flash > night, `ignite flash outshines the bird (${flash})`);
assert.ok(view.light.position.distanceTo(new T.Vector3(10, 1, 10)) < 1, 'flash sits on the hit');

// Nothing flying: the dark closes back in.
step(120);
assert.equal(view.light.intensity, 0, 'returns to zero');
assert.equal(count(), 1, 'light kept, not removed');
view.dispose(); assert.equal(count(), 0);
console.log('phoenix-light ok', {day: +day.toFixed(1), night: +night.toFixed(1), flash: +flash.toFixed(1)});
