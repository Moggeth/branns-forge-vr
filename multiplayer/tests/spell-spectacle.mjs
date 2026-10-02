// Contract test for client/spell-presentation.js (node, no GPU): event replay/dedupe, starfall sync,
// pool budgets/cleanup, deterministic seeding, quality/reduced-motion scaling and disposal.
// Usage: node tests/spell-presentation.test.mjs [path/to/spell-presentation.js]
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const target = path.resolve(process.argv[2] || new URL('../client/spell-presentation.js', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const { createSpellPresentation } = await import(pathToFileURL(target).href);
const SPELLS = ['skeleton', 'squad', 'golem', 'raise', 'lower', 'sunder', 'wall', 'grove', 'ring', 'starfall', 'crystal', 'heal', 'lightning', 'frost'];
const height = (x, z) => 1.2 * Math.sin(x * 0.21) + 0.8 * Math.cos(z * 0.17) + 0.3 * Math.sin((x + z) * 0.5);
const t0 = performance.now(); let checks = 0; const ok = (c, m) => { assert.ok(c, m); checks++; };

function make(opts = {}) {
  const scene = new THREE.Scene(); const fx = createSpellPresentation({ scene, height, tickSeconds: 1 / 60, ...opts });
  const disposed = { geo: 0, mat: 0, tex: 0 };
  const trace = () => scene.traverse((o) => { if (o.geometry && !o.geometry.__t) { o.geometry.__t = 1; o.geometry.addEventListener('dispose', () => disposed.geo++); } const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const m of ms) if (!m.__t) { m.__t = 1; m.addEventListener('dispose', () => disposed.mat++); } });
  return { scene, fx, disposed, trace };
}
const run = (fx, secs, step = 1 / 60) => { let t = 0; const peak = { events: 0, particles: 0, draws: 0, slabs: 0, rocks: 0 }; for (let i = 0; i < secs / step; i++) { t += step; fx.update(t * 1000, step); const s = fx.stats(); peak.events = Math.max(peak.events, s.events); peak.particles = Math.max(peak.particles, s.particles.total); peak.draws = Math.max(peak.draws, s.draws); peak.slabs = Math.max(peak.slabs, s.kinematic.slabs); peak.rocks = Math.max(peak.rocks, s.kinematic.rocks); } return peak; };
const ev = (spell, id, extra = {}) => ({ kind: 'spell', spell, id, tick: 100, position: [4, height(4, -3), -3], ...(spell === 'sunder' || spell === 'wall' ? { start: [-2, 0, -3], end: [8, 0, 1] } : {}), ...extra });

// 1. every spell plays once, dedupes on replay by network id, ends and returns its pooled slots.
const perSpell = {};
for (const spell of SPELLS) {
  const { fx } = make();
  ok(fx.play(ev(spell, `n-${spell}`)) === true, `${spell} plays`);
  ok(fx.play(ev(spell, `n-${spell}`)) === false, `${spell} replay deduped while live`);
  const peak = run(fx, 5.2);
  ok(fx.play(ev(spell, `n-${spell}`)) === false, `${spell} replay deduped after end (recent window)`);
  const s = fx.stats();
  ok(s.events === 0, `${spell} event ended within 5 s cap`); ok(s.kinematic.slabs === 0 && s.kinematic.rocks === 0, `${spell} kinematic slots released`);
  ok(peak.particles <= 512, `${spell} particles within budget`);
  perSpell[spell] = peak; fx.dispose();
}
// 2. reference-equal API surface plus optional configure()
{ const { fx } = make(); for (const k of ['setTarget', 'play', 'update', 'sync', 'dispose', 'stats', 'prepareShaders']) ok(typeof fx[k] === 'function', `api ${k}`); fx.dispose(); }
// 3. starfall: sync warning -> launch -> server impact event is deduped; missing launch still produces impact.
{
  const { fx } = make(); let tick = 0; const snap = (list) => ({ tick, pendingStarfalls: list });
  fx.sync(snap([{ id: 'sf1', x: 2, z: 2, radius: 5, impactTick: 48 }])); ok(fx.stats().warnings === 1, 'warning starts');
  for (; tick < 48; tick++) { fx.sync(snap([{ id: 'sf1', x: 2, z: 2, radius: 5, impactTick: 48 }])); fx.update(tick * 16.7, 1 / 60); }
  ok([...Array(1)].length && fx.stats().events >= 2, 'launch event created before impact tick');
  fx.sync(snap([])); ok(fx.play({ kind: 'spell', spell: 'starfall', phase: 'impact', position: [2, 0, 2], id: 'sf1', tick: 48 }) === false, 'server impact deduped after client launch');
  run(fx, 5.5); ok(fx.stats().events === 0 && fx.stats().warnings === 0, 'starfall + warning cleaned');
  ok(fx.play({ kind: 'spell', spell: 'starfall', phase: 'impact', position: [9, 0, 9], id: 'sf2', tick: 60 }) === true, 'impact without launch plays');
  run(fx, 5); fx.dispose();
}
// 4. determinism: identical events produce identical pooled instance matrices.
{
  const snapA = [], snapB = [];
  for (const out of [snapA, snapB]) { const { scene, fx } = make(); fx.play(ev('sunder', 'det')); fx.play(ev('raise', 'det2', { position: [-6, 0, 4] })); fx.play(ev('starfall', 'det3', { position: [0, 0, 9] })); run(fx, 1.3); scene.traverse((o) => { if (o.isInstancedMesh) out.push(...o.instanceMatrix.array.slice(0, 200)); if (o.isPoints) out.push(...o.geometry.attributes.position.array.slice(0, 200)); }); fx.dispose(); }
  ok(snapA.length > 0 && snapA.every((v, i) => Math.abs(v - snapB[i]) < 1e-6), 'seeded variation is deterministic');
}
// 5. stress: 40 overlapping events (cap 32), all budgets hold; then dispose releases every geometry/material.
{
  const { scene, fx, disposed, trace } = make(); trace();
  for (let i = 0; i < 40; i++) fx.play(ev(SPELLS[i % SPELLS.length], `s${i}`, { position: [(i % 8) * 6 - 20, 0, Math.floor(i / 8) * 6 - 12] }));
  ok(fx.stats().events <= 32, 'event cap'); trace(); const peak = run(fx, 1.5); trace();
  ok(peak.particles <= 512 && peak.slabs <= 64 && peak.rocks <= 96, `stress budgets ${JSON.stringify(peak)}`);
  fx.setTarget({ spell: 'sunder', start: [0, 0, 0], end: [6, 0, 0], valid: true }); run(fx, 0.2); trace();
  fx.dispose(); ok(scene.children.length === 0, 'root removed'); ok(disposed.geo > 10 && disposed.mat > 10, `disposed ${JSON.stringify(disposed)}`);
  ok(fx.play(ev('raise', 'after')) === false, 'play after dispose is inert'); fx.update(0, 0.016); ok(fx.stats().events === 0, 'stats after dispose');
}
// 6. quality + reduced motion scale emission/pieces down monotonically.
{
  const peaks = {};
  for (const q of ['high', 'medium', 'low']) { const { fx } = make({ quality: q }); for (const sp of ['sunder', 'raise', 'starfall', 'grove']) fx.play(ev(sp, `q-${sp}`, { position: [sp.length * 3, 0, 0] })); peaks[q] = run(fx, 1.6); ok(fx.stats().quality === q, `quality ${q} reported`); fx.dispose(); }
  ok(peaks.high.particles >= peaks.medium.particles && peaks.medium.particles >= peaks.low.particles, `particles degrade ${peaks.high.particles}/${peaks.medium.particles}/${peaks.low.particles}`);
  ok(peaks.high.rocks > peaks.low.rocks && peaks.high.slabs > peaks.low.slabs, 'kinematic pieces degrade');
  ok(peaks.high.draws >= peaks.low.draws, `draws degrade ${peaks.high.draws}/${peaks.low.draws}`);
  const { fx } = make({ reducedMotion: true }); fx.play(ev('lightning', 'rm')); run(fx, 2); ok(fx.stats().reducedMotion === true, 'reduced motion reported'); fx.configure({ quality: 'low', reducedMotion: false }); ok(fx.stats().quality === 'low' && !fx.stats().reducedMotion, 'configure'); fx.dispose();
  console.log('quality peaks', JSON.stringify(peaks));
}
// 7. per-spell peak draw calls (pools 6 + reticle 0 + event meshes/ribbons)
console.log('per-spell peaks', JSON.stringify(Object.fromEntries(Object.entries(perSpell).map(([k, v]) => [k, { draws: v.draws, particles: v.particles, slabs: v.slabs, rocks: v.rocks }]))));
console.log(`PASS ${checks} checks in ${(performance.now() - t0).toFixed(0)} ms`);
