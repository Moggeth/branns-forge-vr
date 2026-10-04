import assert from 'node:assert/strict';
import {createEmberwingMotion, EMBERWING_MOTION} from '../client/emberwing-motion.js';
const m = createEmberwingMotion(); let t = 0;
const step = (s, aim = 0) => { t += 1 / 60; return m.update(t, 1 / 60, s, aim); };
// Rest: no layer.
let r = step({drawing: false}); assert.ok(r.offset.length() < 1e-9 && Math.abs(r.quaternion.w) > .999999 && r.ember === 0);
// Equip starts low and arrives home.
m.equip(t); r = step({}); assert.ok(r.offset.y < -.15);
for (let i = 0; i < 30; i++) r = step({}); assert.ok(r.offset.length() < 1e-6);
// Drawing brings the bow in and lights the ember; a phoenix latch flares it.
for (let i = 0; i < 50; i++) r = step({drawing: true, draw: Math.min(1, i / 50)});
assert.ok(r.offset.x > .015 && r.ember > .4);
const before = r.ember; let peak = 0;
for (let i = 0; i < 20; i++) { r = step({drawing: true, draw: 1, curved: true}); peak = Math.max(peak, r.ember); }
assert.ok(peak > before && peak <= 1);
// Long hold trembles but stays bounded (and calmer while zoomed).
let spread = 0, zoomSpread = 0; const base = step({drawing: true, draw: 1, curved: true}).offset.clone();
for (let i = 0; i < 200; i++) spread = Math.max(spread, step({drawing: true, draw: 1, curved: true}).offset.distanceTo(base));
for (let i = 0; i < 100; i++) zoomSpread = Math.max(zoomSpread, step({drawing: true, draw: 1, curved: true}, 1).offset.distanceTo(base));
assert.ok(spread > .0005 && spread < .01 && zoomSpread < spread);
// A cancelled draw (no recoil) does not kick.
for (let i = 0; i < 5; i++) assert.ok(step({drawing: false}).offset.z > -.005);
for (let i = 0; i < 30; i++) step({drawing: true, draw: 1});
// Release: the bow kicks forward, the string hums, then everything settles.
r = step({drawing: false, recoil: 1}); let push = 0, hum = 0;
for (let i = 0; i < 20; i++) { r = step({drawing: false, recoil: Math.max(0, 1 - i / 27)}); push = Math.min(push, r.offset.z); hum = Math.max(hum, Math.abs(r.string)); }
assert.ok(push < -.02 && hum > .005 && hum <= EMBERWING_MOTION.hum.amp);
for (let i = 0; i < 90; i++) r = step({drawing: false});
assert.ok(r.offset.length() < 1e-3 && Math.abs(r.string) < 1e-3);
// Reduced motion keeps the beats smaller.
const calm = createEmberwingMotion({reducedMotion: true}); let ct = 0; calm.update(ct, 0, {drawing: true, draw: 1}); let calmPitch = 0;
for (let i = 0; i < 20; i++) { ct += 1 / 60; const q = calm.update(ct, 1 / 60, {drawing: false, recoil: i ? 1 - i / 27 : 1}).quaternion; calmPitch = Math.max(calmPitch, Math.abs(q.x)); }
assert.ok(calmPitch < .03);
console.log('emberwing-motion: equip, draw, phoenix flare, strain tremble, release kick and string hum pass');
