// The apple core's send-off (client/apple-feast.js): it drops and settles, songbirds swoop in, peck it to nothing and
// leave; the same key always brings the same birds; with no bird model loaded the core still crumbles away.
import assert from 'node:assert/strict';
import * as T from 'three';
import {createAppleFeast, APPLE_FEAST} from '../client/apple-feast.js';

const start = performance.now(); let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log('ok ' + name); };
// a stand-in songbird with the real node names (body + four wing parts)
const bird = () => { const s = new T.Group(); s.name = 'Songbird'; const body = new T.Mesh(new T.BoxGeometry(.1, .1, .2)); body.name = 'SongbirdBody'; s.add(body);
 for (const n of ['SongbirdWingL', 'SongbirdWingR']) { const w = new T.Mesh(new T.BoxGeometry(.1, .01, .05)); w.name = n; const tip = new T.Mesh(new T.BoxGeometry(.08, .01, .04)); tip.name = n + '_Tip'; w.add(tip); s.add(w); }
 return {scene: s}; };
const ground = (x, z) => .3 + .02*x;
function run({template = bird(), key = 'qa', seconds = 14} = {}) {
 const group = new T.Group(), crumbs = [], sounds = {thud: 0, chirp: 0, peck: 0, flutter: 0};
 const feast = createAppleFeast({group, birdTemplate: () => template, height: ground,
  effects: {crumbs: (at, dir, n) => crumbs.push(n), sounds: Object.fromEntries(Object.keys(sounds).map(k => [k, () => sounds[k]++]))}});
 const core = new T.Group(); core.scale.setScalar(.08); group.add(core);
 feast.drop(core, {position: new T.Vector3(0, 1.4, -.4), velocity: [0, 1, -1.2], radius: .034, key});
 const trace = []; let maxBirds = 0, lowest = Infinity, landedAt = null;
 for (let i = 0; i < seconds*60; i++) {
  feast.update(1/60, i/60); const st = feast.state()[0];
  if (st) { trace.push(st); maxBirds = Math.max(maxBirds, feast.birds()); if (st.mode === 'roll' && landedAt === null) landedAt = i/60; }
  if (core.parent) lowest = Math.min(lowest, core.position.y - ground(core.position.x, core.position.z));
 }
 return {feast, group, core, trace, crumbs, sounds, maxBirds, lowest, landedAt};
}

check('the core falls, bounces and comes to rest on the ground', () => {
 const r = run({seconds: 1.5});
 assert.ok(r.landedAt > .2 && r.landedAt < 1.4, `landed at ${r.landedAt}`);
 assert.ok(r.lowest > .02, `never sinks into the ground (${r.lowest.toFixed(3)})`);
 assert.ok(r.sounds.thud >= 1);
});
check('songbirds come, peck the core away and fly off; everything is cleaned up', () => {
 const r = run();
 assert.ok(r.maxBirds >= APPLE_FEAST.birds[0] && r.maxBirds <= APPLE_FEAST.birds[1], `birds ${r.maxBirds}`);
 const phases = new Set(r.trace.flatMap(s => s.birds)); for (const p of ['in', 'eat', 'out']) assert.ok(phases.has(p), p);
 assert.ok(r.sounds.peck >= 6 && r.sounds.chirp >= 2 && r.sounds.flutter >= 2, JSON.stringify(r.sounds));
 const eaten = r.trace.map(s => s.eaten); for (let i = 1; i < eaten.length; i++) assert.ok(eaten[i] >= eaten[i - 1], 'the core only ever gets smaller');
 assert.ok(r.trace.some(s => !s.visible), 'pecked to nothing');
 assert.equal(r.feast.active(), 0, 'feast over'); assert.equal(r.group.children.length, 0, 'core and birds removed');
});
check('the core is gone well before the birds leave, and the whole thing stays short', () => {
 const r = run(), gone = r.trace.findIndex(s => !s.visible)/60, end = r.trace.length/60;
 assert.ok(gone > 2 && gone < 7, `core gone at ${gone.toFixed(2)} s`); assert.ok(end < 11, `over at ${end.toFixed(2)} s`);
});
check('every client sees the same flock for the same core', () => {
 const a = run({key: 'f123'}), b = run({key: 'f123'}), c = run({key: 'f999'});
 assert.deepEqual(a.trace.map(s => s.birds.join()), b.trace.map(s => s.birds.join()));
 assert.ok(a.trace.length !== c.trace.length || a.maxBirds !== c.maxBirds || JSON.stringify(a.trace) !== JSON.stringify(c.trace));
});
check('without the bird model the core still crumbles away', () => {
 const r = run({template: null}); assert.equal(r.maxBirds, 0); assert.ok(r.trace.at(-1).eaten > .9, 'crumbled'); assert.equal(r.feast.active(), 0); assert.equal(r.core.parent, null);
});
console.log(`apple-feast: ${checks} checks passed in ${((performance.now() - start)/1000).toFixed(3)} s`);
