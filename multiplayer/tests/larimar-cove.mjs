// Larimar Cove (2026-10-10): a lake beside each back town, home to Shellbright the larimar turtle. The cove is carved
// into the corner mountains without opening a second way into the back town, the lake bed is a smooth bowl, walkers
// wade the shallows but are turned back from deep water and the basking rock, and the turtle's life is deterministic:
// every client sees it doing the same thing at the same world time, it never leaves the water except onto its rock,
// and every pose is finite.
import assert from 'node:assert/strict';
import {COVE, covePoint, coveCarve, lakeBasin, lakeRadius, resolveCoveLakes, waterDepth} from '../shared/larimar-cove.js';
import {keepCarve, KEEP_CARVE} from '../shared/keep-sites.js';
import {baseHeight} from '../shared/terrain.js';
import {createTurtleBrain, turtlePose, coveAnchors, TURTLE} from '../client/larimar-turtle-motion.js';

let count = 0;
const test = (name, fn) => { fn(); count++; console.log('PASS', name); };
const sides = ['party', 'rivals'];
const lake = side => ({centre: {u: COVE.lake.u, v: COVE.lake.v}, radius: (u, v) => lakeRadius(u, v), depth: (u, v) => { const [x, z] = covePoint(side, [u, v]); return waterDepth(x, z); }});

test('both coves are the same shape, mirrored, with a level floor round a real lake', () => {
  for (const side of sides) {
    const [cx, cz] = covePoint(side, [COVE.lake.u, COVE.lake.v]), floor = baseHeight(...covePoint(side, [59, 52.5])) ;
    assert.ok(keepCarve(cx, cz) >= .999, `${side} cove carved open over its lake`);
    assert.ok(lakeBasin(cx, cz) > 1.5, `${side} lake is deep in the middle`);
    assert.ok(Math.abs(baseHeight(cx, cz) + lakeBasin(cx, cz) - floor) < .5, `${side} lake bed sits under the cove floor`);
    for (const uv of [[58, 52], [67, 44], [66, 53]]) assert.equal(waterDepth(...covePoint(side, uv)), 0, `${side} dry ground at ${uv}`);
  }
  for (let u = 50; u < 70; u += .5) for (let v = 38; v < 60; v += .5)
    assert.ok(Math.abs(lakeBasin(u, v) - lakeBasin(-u, -v)) < 1e-9 && Math.abs(coveCarve(u, v) - coveCarve(-u, -v)) < 1e-9, `mirrored at ${u},${v}`);
});

test('the lake bed is a smooth bowl: no steps between neighbouring points', () => {
  for (let u = 57; u < 69; u += .1) for (let v = 43; v < 54; v += .1) {
    const d = Math.abs(lakeBasin(u, v) - lakeBasin(u + .1, v)) + Math.abs(lakeBasin(u, v) - lakeBasin(u, v + .1));
    assert.ok(d < .3, `bed step ${d.toFixed(3)} at ${u.toFixed(1)},${v.toFixed(1)}`);
  }
});

test('the cove is walled by cliffs on its mountain sides and opens only into the back town', () => {
  const floor = baseHeight(60, 55);
  for (const [u, v] of [[62, 39.5], [53, 46], [62.5, 42.2 - 1.5]]) assert.ok(baseHeight(u, v) - floor > 5, `cliff behind the cove at ${u},${v}`);
  // the town's yard and the cove floor meet level
  for (let u = 58; u <= 66; u += 1) assert.ok(Math.abs(baseHeight(u, 53.5) - floor) < .5, `level threshold at ${u}`);
  assert.ok(COVE.box.u1 < 70 && KEEP_CARVE.town.to >= COVE.box.u1 - 1, 'the cove stays inside the world');
});

test('walkers wade the shallows, are turned back from deep water, and step round the basking rock', () => {
  for (const side of sides) {
    for (let a = 0; a < Math.PI * 2; a += .2) for (const k of [0, .3, .6, .9]) {
      const uv = [COVE.lake.u + Math.cos(a) * k * COVE.lake.ru, COVE.lake.v + Math.sin(a) * k * COVE.lake.rv];
      const [x, z] = covePoint(side, uv), p = resolveCoveLakes([x, 0, z]);
      assert.ok(waterDepth(p[0], p[2]) <= COVE.wade + 1e-3, `${side} resolved into ${waterDepth(p[0], p[2]).toFixed(2)} m of water`);
      assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[2]));
    }
    const [rx, rz] = covePoint(side, [COVE.rock.u, COVE.rock.v]), p = resolveCoveLakes([rx + .1, 0, rz + .05]);
    assert.ok(Math.hypot(p[0] - rx, p[2] - rz) >= COVE.rock.r - 1e-6, `${side} rock is solid`);
    const centre = resolveCoveLakes([...covePoint(side, [COVE.lake.u, COVE.lake.v])].flatMap((c, i) => i ? [0, c] : [c]));
    assert.ok(waterDepth(centre[0], centre[2]) <= COVE.wade + 1e-3, `${side} dead centre pushed out`);
    const away = [10, 0, 10]; assert.deepEqual(resolveCoveLakes([...away]), away, 'the meadow is untouched');
  }
});

test('the turtle lives the same life on every client and stays in its lake', () => {
  const run = (from, heroes = () => []) => {
    const brain = createTurtleBrain({lake: lake('rivals'), seed: 29, anchors: coveAnchors()}), out = [];
    for (let t = from; t <= from + 300; t += 1 / 20) { brain.advanceTo(t, heroes(t)); out.push(brain.sample(t)); }
    return {brain, out};
  };
  const a = run(0), b = createTurtleBrain({lake: lake('rivals'), seed: 29, anchors: coveAnchors()});
  // a late joiner (or a tab that slept) lands in exactly the same state
  for (const t of [37.3, 151.2, 260.05]) {
    b.advanceTo(t, []); const s = b.sample(t), ref = a.out[Math.round(t * 20)];
    assert.equal(s.mode, ref.mode, `mode at ${t}`); assert.ok(Math.hypot(s.u - ref.u, s.v - ref.v) < 1e-6, `place at ${t}`);
  }
  const modes = new Set(), A = coveAnchors();
  for (const s of a.out) {
    modes.add(s.mode);
    for (const k of ['u', 'v', 'y', 'yaw', 'pitch', 'roll']) assert.ok(Number.isFinite(s[k]), `${k} finite in ${s.mode}`);
    const onRock = Math.hypot(s.u - A.bask.u, s.v - A.bask.v) < COVE.rock.r + .6;
    if (!onRock) assert.ok(lakeRadius(s.u, s.v) < .86, `swimming inside the lake (${s.mode} at ${s.u.toFixed(2)},${s.v.toFixed(2)})`);
    if (!onRock) assert.ok(s.y < .05, `under or at the surface away from the rock (${s.mode} y ${s.y.toFixed(2)})`);
  }
  for (const m of ['bask', 'slide', 'swim', 'surface', 'home', 'haul', 'turn']) assert.ok(modes.has(m), `lives through ${m}`);
  // each cycle starts and ends basking
  for (const t of [0, TURTLE.cycle, TURTLE.cycle * 2 - .1]) assert.equal(a.out[Math.min(a.out.length - 1, Math.round(t * 20))].mode, 'bask', `basking at ${t}`);
});

test('a hero at the shore draws the turtle over to say hello', () => {
  const brain = createTurtleBrain({lake: lake('rivals'), seed: 29, anchors: coveAnchors()});
  const hero = [{key: 'h', u: 67.4, v: 50.5}];
  let visited = false, closest = Infinity;
  for (let t = 30; t < 100; t += 1 / 20) {
    brain.advanceTo(t, hero); const s = brain.sample(t);
    if (s.mode === 'visit') visited = true;
    closest = Math.min(closest, Math.hypot(s.u - hero[0].u, s.v - hero[0].v));
  }
  assert.ok(visited, 'went to visit'); assert.ok(closest < 3, `came within ${closest.toFixed(2)} m`);
});

test('every frame of the pose is finite and the lids, jaw and flippers stay in range', () => {
  const brain = createTurtleBrain({lake: lake('party'), seed: 11, anchors: coveAnchors()}), mem = {};
  for (let t = 0; t <= 150; t += 1 / 30) {
    brain.advanceTo(t, []); const s = brain.sample(t), pose = turtlePose(s, t, {mem, dt: 1 / 30, seed: 1.3, look: t % 20 < 6 ? {u: 60, v: 54, y: 1.6} : null});
    for (const v of Object.values(pose.root)) assert.ok(Number.isFinite(v));
    for (const [name, r] of Object.entries(pose.bones)) for (const v of r) assert.ok(Number.isFinite(v) && Math.abs(v) < 2.2, `${name} ${v}`);
    assert.ok(pose.lids >= 0 && pose.lids <= 1 && pose.jaw >= 0 && pose.jaw < .7, `lids ${pose.lids} jaw ${pose.jaw}`);
  }
});

console.log(`larimar-cove: ${count} checks passed`);
