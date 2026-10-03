// node test.mjs — WebGL-free geometry/budget/lifecycle checks for spell-targeting.js
import assert from 'node:assert/strict';
import * as T from 'three';
import {terrainHeight,createSunderRupture} from '../shared/terrain.js';
import { createSpellTargeting, createMarkerTerrainSampler, SPELL_SHAPES, lineKernels } from '../client/spell-targeting.js';

const IDS = ['skeleton', 'squad', 'golem', 'raise', 'lower', 'sunder', 'wall', 'grove', 'ring', 'starfall', 'crystal', 'heal', 'lightning', 'frost'];
assert.deepEqual(Object.keys(SPELL_SHAPES).sort(), [...IDS].sort());
const slope = (x, z) => 0.45 * Math.sin(x * 0.09) * Math.cos(z * 0.07) + 0.35 * x + 0.2 * z + 0.6 * Math.sin(z * 0.8); // steep, rippled
const t0 = performance.now(), timings = {};

function check(fx, spell, quality, label) {
  const s = fx.stats();
  assert.equal(s.visible, true, `${label} visible`);
  const g = fx.root.getObjectByName('SpellTargetingGlyphs').geometry, P = g.attributes.position.array, A = g.attributes.aux.array, I = g.index.array;
  for (let i = 0; i < s.ribbonPoints * 2 * 3; i++) assert.ok(Number.isFinite(P[i]), `${label} finite pos`);
  for (let i = 0; i < s.ribbonPoints * 2 * 4; i++) assert.ok(Number.isFinite(A[i]), `${label} finite aux`);
  for (let i = 0; i < s.triangles * 3 && i < g.drawRange.count; i++) assert.ok(I[i] < s.ribbonPoints * 2, `${label} index in range`);
  const lim = quality === 'low' ? { d: 10, t: 5000 } : { d: 20, t: 12000 };
  assert.ok(s.draws <= lim.d, `${label} draws ${s.draws}`); assert.ok(s.triangles <= lim.t, `${label} tris ${s.triangles}`);
  if (s.surface) { const sp = fx.root.getObjectByName('SpellTargetingSurface').geometry.attributes.position.array; for (const v of sp) assert.ok(Number.isFinite(v), `${label} surface finite`); }
  return s;
}

// 1) all 14 IDs, valid/invalid, three qualities, sloped terrain
const table = [];
for (const quality of ['high', 'medium', 'low']) {
  const scene = new T.Scene(), fx = createSpellTargeting({ scene, height: slope, quality });
  let now = 0;
  for (const spell of IDS) for (const valid of [true, false]) {
    fx.setTarget({ spell, point: [3, 0, -4], start: new T.Vector3(-6, 0, 2), end: [7, 0, 9], valid });
    const a = performance.now(); fx.update((now += 16.7), 1 / 60); const ms = performance.now() - a;
    const s = check(fx, spell, quality, `${quality}/${spell}/${valid}`);
    assert.equal(s.valid, valid);
    if (valid) table.push({ quality, spell, draws: s.draws, tris: s.triangles, strands: s.strands, dropped: s.droppedStrands, buildMs: +ms.toFixed(2), samples: s.heightSamplesPerBuild });
  }
  fx.dispose(); assert.equal(scene.children.length, 0, 'disposed root removed');
}

// 2) exact footprint: ground glyph vertices of the outer ring sit at height()+lift, and centre is exact (no lag)
{
  const scene = new T.Scene(), fx = createSpellTargeting({ scene, height: slope });
  for (let i = 0; i < 40; i++) { const x = -20 + i, z = 10 - i * 0.5; fx.setTarget({ spell: 'starfall', point: [x, 0, z], valid: true }); fx.update(i * 16, 1 / 60);
    const P = fx.root.getObjectByName('SpellTargetingGlyphs').geometry.attributes.position.array;
    let cx = 0, cz = 0; const n = 97; // first strand = outer ring, 97 points*2 verts at default density (step <= .28)
    const pts = fx.stats().ribbonPoints; assert.ok(pts > 100);
    // average of the first ring's edge vertices is the target centre
    let m = 0; for (let k = 0; k < 2 * 100; k++) { cx += P[k * 3]; cz += P[k * 3 + 2]; m++; }
    for (let k = 0; k < 40; k++) { const x0 = P[k * 3], y0 = P[k * 3 + 1], z0 = P[k * 3 + 2]; assert.ok(Math.abs(y0 - (slope(x0, z0) + 0.06)) < 1e-4, 'perimeter conforms to height+lift'); }
    const r = Math.hypot((P[0] + P[3]) / 2 - x, (P[2] + P[5]) / 2 - z); assert.ok(Math.abs(r - 5) < 1e-3, `outer stroke centreline radius exact ${r}`);
  }
  // line: start/end exact, footprint width 5 m
  fx.setTarget({ spell: 'sunder', start: [-4, 0, 1], end: [8, 0, 6], valid: true }); fx.update(1000, 1 / 60);
  const P = fx.root.getObjectByName('SpellTargetingGlyphs').geometry.attributes.position.array, ang = Math.atan2(5, 12), cx = 2, cz = 3.5;
  let maxLat = 0, minAlong = 1e9, maxAlong = -1e9; const n = fx.stats().ribbonPoints * 2;
  for (let k = 0; k < 2 * 60; k += 2) { const dx = (P[k * 3] + P[k * 3 + 3]) / 2 - cx, dz = (P[k * 3 + 2] + P[k * 3 + 5]) / 2 - cz; const al = dx * Math.cos(ang) + dz * Math.sin(ang), la = -dx * Math.sin(ang) + dz * Math.cos(ang); maxLat = Math.max(maxLat, Math.abs(la)); minAlong = Math.min(minAlong, al); maxAlong = Math.max(maxAlong, al); }
  assert.ok(Math.abs(maxLat - 2.5) < 0.01, `half width ${maxLat}`); assert.ok(Math.abs(minAlong + 6.5 + 2.5) < 0.01, `start cap ${minAlong}`);
  const ks = lineKernels(-4, 1, 8, 6); assert.equal(ks.length, Math.ceil(13 / 2.5) + 1); assert.deepEqual(ks[0], [-4, 1]); assert.deepEqual(ks.at(-1), [8, 6]);
  for (let i = 1; i < ks.length; i++) assert.ok(Math.hypot(ks[i][0] - ks[i - 1][0], ks[i][1] - ks[i - 1][1]) <= 2.5 + 1e-9);
  fx.dispose();
}

// 3) input safety: unknown IDs, garbage vectors, NaN heights, line fallbacks, null
{
  const scene = new T.Scene(), fx = createSpellTargeting({ scene, height: (x) => (x > 0 ? NaN : Infinity) });
  for (const bad of [null, undefined, 5, {}, { spell: 'meteor', point: [0, 0, 0] }, { spell: 'skeleton' }, { spell: 'skeleton', point: [NaN, 0, 0] }, { spell: 'heal', point: 'x' }, {spell:'wall',start:[1e100,0,0],end:[0,0,0]}, {spell:'skeleton',point:[1e100,0,0]}, { spell: '__proto__', point: [0, 0, 0] }, { spell: 'toString', point: [0, 0, 0] }]) {
    fx.setTarget(bad); for (let i = 0; i < 30; i++) fx.update(i * 16, 1 / 60); assert.equal(fx.stats().visible, false, `hidden for ${JSON.stringify(bad)}`);
  }
  for (const spell of ['sunder', 'wall']) { fx.setTarget({ spell, point: { x: 1, y: 0, z: 2 }, valid: false }); fx.update(0, 1 / 60); const s = check(fx, spell, 'high', 'fallback ' + spell); assert.equal(s.valid, false); }
  fx.setTarget({ spell: 'wall', start: [0, 0, 0], end: [0, 0, 0], point: [0, 0, 0] }); fx.update(0, 1 / 60); check(fx, 'wall', 'high', 'degenerate line');
  fx.setTarget({ spell: 'heal', point: [0, 0, 0], radius: 'big' }); fx.update(0, 1 / 60); check(fx, 'heal', 'high', 'bad radius');
  fx.dispose(); fx.update(0, 1 / 60); fx.setTarget({ spell: 'heal', point: [0, 0, 0] }); fx.dispose();
}

// 4) repeated target updates: no allocation growth in buffers, bounded build time, configure + reduced motion
{
  const scene = new T.Scene(), fx = createSpellTargeting({ scene, height: slope });
  const g = fx.root.getObjectByName('SpellTargetingGlyphs').geometry, arr = g.attributes.position.array, idx = g.index.array, mats = new Set();
  fx.root.traverse((o) => o.material && mats.add(o.material));
  const a = performance.now(); let n = 0;
  for (let i = 0; i < 1400; i++) { const spell = IDS[i % 14]; fx.setTarget({ spell, point: [Math.sin(i) * 30, 0, Math.cos(i * 0.7) * 30], start: [i % 20 - 10, 0, 0], end: [i % 20 - 10 + (i % 17) + 0.5, 0, 3], valid: i % 3 > 0 }); fx.update(i * 16.7, 1 / 60); n++;
    if (i === 700) fx.configure({ quality: 'low', reducedMotion: true }); if (i === 1000) fx.configure({ quality: 'medium', reducedMotion: false }); }
  timings.repeated1400ms = +(performance.now() - a).toFixed(1); timings.perUpdateMs = +(timings.repeated1400ms / n).toFixed(3);
  assert.equal(g.attributes.position.array, arr, 'buffers reused'); assert.equal(g.index.array, idx);
  const after = new Set(); fx.root.traverse((o) => o.material && after.add(o.material)); assert.deepEqual([...after], [...mats], 'no material churn');
  // reduced motion freezes animation time and fades instantly
  fx.configure({ reducedMotion: true }); fx.setTarget({ spell: 'lightning', point: [0, 0, 0], valid: true }); fx.update(5000, 1 / 60);
  assert.equal(fx.root.getObjectByName('SpellTargetingGlyphs').material.uniforms.uT.value, 0); assert.equal(fx.stats().fade, 1); assert.equal(fx.stats().motes, 0);
  // same target -> no rebuild (cosmetic only)
  const b0 = fx.stats().builds; for (let i = 0; i < 10; i++) fx.update(6000 + i * 16, 1 / 60); assert.equal(fx.stats().builds, b0);
  fx.setTarget(null); fx.update(7000, 1 / 60); assert.equal(fx.stats().visible, false);
  // prepareShaders: detached preview, no state change
  let seen = null; await fx.prepareShaders({ compileAsync: async (p) => { seen = p; assert.equal(p.parent, null); assert.ok(p.children.length === 3); } }, new T.PerspectiveCamera(), scene);
  assert.equal(seen.children.length, 0);
  // disposal releases all owned geometries/materials
  let disposed = 0; fx.root.traverse((o) => { if (o.geometry) o.geometry.addEventListener('dispose', () => disposed++); if (o.material) o.material.addEventListener('dispose', () => disposed++); });
  fx.dispose(); assert.equal(disposed, 6); assert.equal(scene.children.length, 0);
}

// A stationary target follows changing earth only when the dirty patch overlaps.
{
  let floor=0;const scene=new T.Scene(),fx=createSpellTargeting({scene,height:()=>floor,reducedMotion:true});
  fx.setTarget({spell:'skeleton',point:[10,0,10]});fx.update(0,1/60);
  const geometry=fx.root.getObjectByName('SpellTargetingGlyphs').geometry,beforeY=geometry.attributes.position.getY(0),builds=fx.stats().builds;
  floor=-1;assert.equal(fx.invalidateTerrain([{x:-30,z:-30,radius:3}]),false);fx.update(16,1/60);assert.equal(fx.stats().builds,builds);
  assert.equal(fx.invalidateTerrain([{x:10,z:10,radius:3}]),true);fx.update(32,1/60);assert.equal(fx.stats().builds,builds+1);assert.ok(Math.abs(geometry.attributes.position.getY(0)-beforeY+1)<1e-6);
  fx.setTarget({spell:'wall',start:[10,0,7],end:[10,0,13],fallback:true});fx.update(48,1/60);assert.equal(fx.stats().surface,true);fx.dispose();
}
// Match actual plant locations; authored motif sites cannot drift from gameplay.
assert.equal(SPELL_SHAPES.grove.trees.length,5);assert.equal(SPELL_SHAPES.ring.trees,8);assert.equal(SPELL_SHAPES.ring.treeRing,4);
for(let i=0;i<5;i++)assert.deepEqual(SPELL_SHAPES.grove.trees[i],[+(Math.cos(i*Math.PI*2/5)*2.5).toFixed(3),+(Math.sin(i*Math.PI*2/5)*2.5).toFixed(3)]);
// Exercise the real shared terrain at the 64-edit cap, including an active rupture.
{
  const edits=Array.from({length:64},(_,i)=>({id:'e'+i,kind:'raise',x:(i%8)*2-8,z:Math.floor(i/8)*2-8,radius:6,height:i%2?2:-2}));
  edits[0]={id:'r',kind:'sunder',x:0,z:0,radius:2.5,height:-1.5,rupture:createSunderRupture('r',[-6,0,0],[6,0,0],0)};
  const state={edits,tick:30},sampler=createMarkerTerrainSampler((x,z)=>terrainHeight(state,x,z,false)),scene=new T.Scene(),fx=createSpellTargeting({scene,height:sampler.height,quality:'high'}),times=[];
  for(let i=0;i<100;i++){const x=Math.sin(i)*20,z=Math.cos(i*.3)*20;assert.equal(sampler.height(x,z),terrainHeight(state,x,z,false));}
  state.tick=50;sampler.invalidate();for(let i=0;i<100;i++){const x=Math.sin(i)*20,z=Math.cos(i*.3)*20;assert.equal(sampler.height(x,z),terrainHeight(state,x,z,false));}
  for(let i=0;i<25;i++){fx.setTarget({spell:'wall',start:[-6+i*.01,0,0],end:[6+i*.01,0,0]});const t=performance.now();fx.update(i*16,1/60);if(i>=5)times.push(performance.now()-t);}
  timings.realTerrain64EditMeanMs=+(times.reduce((a,b)=>a+b,0)/times.length).toFixed(3);timings.realTerrain64EditMaxMs=+Math.max(...times).toFixed(3);assert.ok(fx.stats().draws<=3);assert.ok(sampler.stats().vertices<=sampler.stats().limit);fx.dispose();
}

timings.totalMs = +(performance.now() - t0).toFixed(1);
const worst = (q) => table.filter((r) => r.quality === q).reduce((m, r) => ({ draws: Math.max(m.draws, r.draws), tris: Math.max(m.tris, r.tris), dropped: m.dropped + r.dropped }), { draws: 0, tris: 0, dropped: 0 });
console.table(table.filter((r) => r.quality === 'high'));
console.log('worst high', worst('high'), 'medium', worst('medium'), 'low', worst('low'));
console.log('timings', timings);
console.log('spell-targeting: 14 spells x valid/invalid x 3 qualities, exact footprint/conformance, input safety, repeated updates, disposal PASS');
