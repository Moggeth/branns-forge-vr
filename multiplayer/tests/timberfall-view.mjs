import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createTimberfallView, TIMBERFALL_VIEW, HEART_COLOURS} from '../client/timberfall-view.js';
import {createPickWallMotion, AXE_HEW_MOTION} from '../client/pick-wall-motion.js';
import {TIMBERFALL} from '../shared/timberfall.js';

const started = performance.now();
const scene = new THREE.Scene(), height = (x, z) => .1 * x;
const view = createTimberfallView({scene, height});
const draws = () => { let n = 0; scene.traverse(o => { if ((o.isMesh || o.isPoints) && o.visible) n++; }); return n; };
assert.equal(draws(), 0, 'nothing drawn while idle');
const meshes = scene.children.length;

// The wave runs from the cast event at the authority's speed, rendered from the time since the cast.
const event = {kind: 'axe_cleave', id: 'h', position: [0, 0, 0], timberfall: {start: [0, 0, -1.2], direction: [0, 0, -1], length: 19, speed: TIMBERFALL.speed}};
assert.equal(view.play(event, 1000), true);
assert.equal(view.play({kind: 'axe_cleave', position: [0, 0, 0]}, 1000), false, 'a cleave without a wave draws nothing here');
assert.ok(draws() <= 4, `wave draws ${draws()}`);
const blade = view.objects.waves[0].blade;
view.update(1000 + 350);
assert.ok(Math.abs(blade.position.z - (-1.2 - TIMBERFALL.speed * .35)) < 1e-6, 'blade is where the front is');
assert.ok(Math.abs(blade.position.y - height(blade.position.x, blade.position.z)) < .05, 'blade rides the ground');
const z1 = blade.position.z; view.update(1000 + 351);
assert.ok(blade.position.z < z1 && z1 - blade.position.z < .05, 'moves smoothly between frames');
view.update(1000 + 30000);
assert.equal(draws(), 0, 'everything hides when the wave is done');
assert.ok(1000 * (19 / TIMBERFALL.speed + TIMBERFALL_VIEW.fade) < 30000);

// Heartwood: rich hearts burst in their colour; empty hearts do nothing.
assert.equal(view.heartwood({kind: 'heartwood', heart: 'none', amount: 0, position: [1, 0, 1]}, 0), false);
for (const heart of Object.keys(HEART_COLOURS)) assert.equal(view.heartwood({kind: 'heartwood', heart, amount: 1, position: [1, 0, 1]}, 0), true);
assert.ok(draws() <= 6);
view.update(TIMBERFALL_VIEW.heartLife * 2000); assert.equal(draws(), 0);

// The aim preview: the lane plus one ring per tree it will fell, hidden on release.
let state = view.showPreview({position: [0, 0, 0], yaw: 0, point: [10, 0, 0], trees: [{x: 5, z: 0, radius: .4}, {x: 9, z: .5, radius: .5}]});
assert.ok(Math.abs(state.plan.direction[0] - 1) < 1e-9, 'lane points at the aimed spot');
assert.equal(state.trees, 2); assert.equal(view.objects.marks.count, 2); assert.ok(draws() === 2);
state = view.showPreview({position: [0, 0, 0], yaw: 0, ready: false});
assert.equal(view.objects.lane.material.uniforms.uBad.value, 1, 'dim while recharging');
view.hidePreview(); assert.equal(draws(), 0);
assert.equal(scene.children.length, meshes, 'pooled: no objects added by use');

// The hew: rises overhead while held, strikes the ground at the strike fraction, then settles back to rest.
const hew = createPickWallMotion({profile: 'axe'});
hew.hold(0); const raised = hew.pose(AXE_HEW_MOTION.rise * 2);
assert.ok(raised.offset.y > .1, 'axe raised while aiming');
assert.equal(hew.release(1), true);
const bite = hew.pose(1 + AXE_HEW_MOTION.slam * AXE_HEW_MOTION.strike);
assert.ok(bite.offset.y < -.1 && bite.offset.z < -.15, 'hewn down and forward at the strike');
assert.ok(hew.slamming); assert.equal(hew.pose(1 + AXE_HEW_MOTION.slam + .01), null, 'back to rest');

view.dispose(); assert.equal(scene.children.length, 0, 'dispose removes everything');
console.log(`timberfall-view: wave timing, ground ride, budget, heartwood bursts, aim preview, hew motion and cleanup pass (${((performance.now() - started) / 1000).toFixed(3)}s)`);
