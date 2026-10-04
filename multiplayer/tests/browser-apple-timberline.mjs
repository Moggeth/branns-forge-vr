// Timberline through an apple tree in the real game: the bolts burst the apples they hit, the wire cuts others in two,
// and the halves fall as edible drops. Man the machine, fire through the crown, step off, pick up a half, eat it.
// Real input on a virtual clock like browser-apple-snack.mjs; CLIP_DIR=<dir> captures every other frame.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createSimulation,terrainHeight} from '../shared/simulation.js';
import {worldTrees} from '../shared/world-content.js';
import {makeSave} from '../client/world-saves.js';
import {launch,BASE,record,save,shot} from './browser-acceptance-lib.mjs';

// The fixture: a loaded Timberline 10 m beyond the Orchard's first apple tree, its rails raised 0.2 rad into the crown.
const sim = createSimulation({room: 'SOLO'}), s = sim.adventureWorld(); s.tick = 1; s.landmarks = false; s.enemies = [];
for (const k of Object.keys(s.inventions.stockpiles.party)) s.inventions.stockpiles.party[k] = 60;
const tree = worldTrees(s).find(t => t.id === 'tree1'), ang = Math.atan2(tree.x, tree.z), px = tree.x + Math.sin(ang)*10, pz = tree.z + Math.cos(ang)*10;
s.inventions.structures.push({id: 'apple-line', type: 'timberline', position: [px, terrainHeight(s, px, pz, false), pz], yaw: Math.atan2(-(tree.x - px), -(tree.z - pz)), hp: 200, maxHp: 200,
 side: 'party', builtTick: 0, readyTick: 0, fireTick: -1000, open: false, charge: 0, armed: false, aimYaw: 0, aimPitch: .2});
const fixture = Buffer.from(JSON.stringify(makeSave(sim.checkpoint())));

const CLIP = process.env.CLIP_DIR || '';
const {browser, page} = await launch({viewport: {width: 640, height: 360}});
await page.addInitScript(() => {
 const real = performance.now.bind(performance), raf = window.requestAnimationFrame.bind(window); let vt = 0, on = false, queue = [];
 performance.now = () => on ? vt : real();
 window.requestAnimationFrame = cb => { if (!on) return raf(cb); queue.push(cb); return queue.length; };
 window.__vt = {enable() { vt = real(); on = true; }, frame(ms = 1000/60) { vt += ms; const run = queue; queue = []; for (const cb of run) cb(vt); return run.length; }};
});
let frameNo = 0, captured = 0, recording = false; // capture only the moments worth watching (a software renderer is slow)
if (CLIP) mkdirSync(CLIP, {recursive: true});
// Off camera (walking, waiting) a frame advances 50 ms so the slow software renderer gets through it sooner.
async function frames(n, each = null) {
 for (let i = 0; i < n; i++) {
  await page.evaluate(ms => window.__vt.frame(ms), recording || !CLIP ? 1000/60 : 50); await new Promise(r => setTimeout(r, 12));
  if (each) await each(i);
  if (CLIP && recording && frameNo++ % 2 === 0) await page.screenshot({path: join(CLIP, `f${String(captured++).padStart(4, '0')}.png`)});
 }
}
const harness = () => page.evaluate(() => { const h = window.brannHarness, s = h.snapshot(); return {s, me: s.players.find(p => p.id === h.state().playerId), c: h.controls()}; });
async function look(at, n = 20) {
 for (let i = 0; i < n; i++) {
  const {me, c} = await harness(), eye = [me.position[0], me.position[1] + 1.65, me.position[2]];
  const d = at.map((v, k) => v - eye[k]), yaw = Math.atan2(-d[0], -d[2]), pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
  const dy = Math.atan2(Math.sin(c.yaw - yaw), Math.cos(c.yaw - yaw)), dp = c.pitch - pitch, k = 1/Math.max(1, n - i)*1.6;
  await page.evaluate(([x, y]) => window.dispatchEvent(new PointerEvent('pointermove', {pointerType: 'mouse', movementX: x, movementY: y})), [dy*k/.0022, dp*k/.0022]);
  await frames(1);
 }
}
async function walkTo(at, near) {
 for (let i = 0; i < 120; i++) { const {me} = await harness(); if (Math.hypot(at[0] - me.position[0], at[2] - me.position[2]) < near) return true;
  await look(at, 2); await page.keyboard.down('KeyW'); await frames(4); await page.keyboard.up('KeyW'); }
 return false;
}
try {
 await page.goto(BASE + '/?acceptanceProbe');
 await page.waitForFunction(() => window.brannHarness?.state().rendererReady);
 await page.fill('#name', 'Orchard QA'); await page.check('input[name="role"][value="hero"]', {force: true});
 await page.locator('#import').setInputFiles({name: 'orchard-line.json', mimeType: 'application/json', buffer: fixture});
 await page.waitForFunction(() => window.brannHarness?.state().phase === 'game');
 await new Promise(r => setTimeout(r, 1500));
 await page.evaluate(() => window.__vt.enable());
 await page.mouse.click(320, 180); await frames(10);
 const machine = (await harness()).s.inventions.structures.find(b => b.id === 'apple-line');
 assert.ok(await walkTo(machine.position, 1.8), 'reached the Timberline');
 await page.keyboard.press('KeyE'); await frames(30);
 const id = await page.evaluate(() => window.brannHarness.state().playerId);
 assert.equal((await harness()).s.inventions.structures.find(b => b.id === 'apple-line').operator, id, 'manned'); record('manned', 'pass');
 recording = true; await frames(20); await shot(page, 'timberline-apple-aim');
 const before = (await harness()).s.fruit.missing.length;
 await page.mouse.down(); await page.mouse.up();
 let halves = [], burst = 0;
 await frames(110, async i => { if (i%10 === 9) { const {s} = await harness(); halves = s.fruit.drops.filter(d => d.half); burst = s.fruit.missing.length - before - halves.length/2; } });
 await shot(page, 'timberline-apple-cut');
 const {s: after} = await harness(); halves = after.fruit.drops.filter(d => d.half);
 record('cut', halves.length ? 'pass' : 'fail', {halves: halves.length, missing: after.fruit.missing.length - before});
 assert.ok(halves.length >= 2, 'the wire cut an apple into two halves');
 await frames(60);
 recording = false; await page.keyboard.press('KeyE'); await frames(30);
 const half = (await harness()).s.fruit.drops.filter(d => d.half && d.mode === 'rest').sort((a, b) => a.id < b.id ? -1 : 1)[0]; assert.ok(half, 'a half came to rest');
 assert.ok(await walkTo(half.position, 1.2), 'walked to a half');
 recording = true; await look(half.position, 16); await frames(20); await shot(page, 'timberline-apple-half');
 const hp0 = (await harness()).me.hp;
 await page.keyboard.press('KeyE'); await frames(45);
 assert.equal((await harness()).s.fruit.drops.find(d => d.id === half.id)?.heldBy, id, 'took the half'); record('take-half', 'pass');
 await look([half.position[0], half.position[1] + 1.6, half.position[2] - 6], 12); await frames(15);
 for (let b = 0; b < 2; b++) { await page.mouse.down(); await page.mouse.up(); await frames(68); if (!b) await shot(page, 'timberline-apple-half-bite'); }
 await frames(60);
 const done = await harness(); assert.ok(!done.s.fruit.drops.some(d => d.id === half.id), 'eaten'); record('eaten-half', 'pass', {hp: [hp0, done.me.hp]});
 assert.deepEqual(page.errors, []);
} catch (e) { record('exception', 'fail', {message: e.message, errors: page.errors}); await shot(page, 'timberline-apple-failure'); process.exitCode = 1; }
finally { await browser.close(); }
save('apple-timberline');
