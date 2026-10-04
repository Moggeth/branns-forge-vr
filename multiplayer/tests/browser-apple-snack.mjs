// Apple on a stick in the real game (solo): bow, shoot an apple off tree1, follow it down, walk over, take it and eat it.
// Real input only (keyboard, pointer-locked mouse). The page runs on a virtual clock advanced one 60 Hz frame at a time,
// so CLIP_DIR=<dir> can capture every other frame for a smooth 30 fps clip even on a software renderer.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {launch,BASE,record,save,shot} from './browser-acceptance-lib.mjs';
import {appleWorld} from '../shared/fruit.js';
import {worldTrees} from '../shared/world-content.js';
import {terrainHeight} from '../shared/simulation.js';

const CLIP = process.env.CLIP_DIR || '', TOUCH = !!process.env.TOUCH;
const viewport = TOUCH ? {width: 844, height: 390} : {width: 640, height: 360};
const {browser, page} = await launch({viewport, touch: TOUCH});
// Virtual clock: performance.now and requestAnimationFrame only move when the test advances a frame.
await page.addInitScript(() => {
 const real = performance.now.bind(performance), raf = window.requestAnimationFrame.bind(window); let vt = 0, on = false, queue = [];
 performance.now = () => on ? vt : real();
 window.requestAnimationFrame = cb => { if (!on) return raf(cb); queue.push(cb); return queue.length; };
 window.__vt = {enable() { vt = real(); on = true; }, frame(ms = 1000/60) { vt += ms; const run = queue; queue = []; for (const cb of run) cb(vt); return run.length; }};
});
let frameNo = 0, captured = 0, recording = false; // capture only the moments worth watching (a software renderer is slow)
if (CLIP) mkdirSync(CLIP, {recursive: true});
// One 60 Hz frame: advance the clock, let the session's 8 ms interval step the simulation, then render.
// Off camera (walking, waiting) a frame advances 50 ms so the slow software renderer gets through it sooner.
async function frames(n, each = null) {
 for (let i = 0; i < n; i++) {
  await page.evaluate(ms => window.__vt.frame(ms), recording || !CLIP ? 1000/60 : 50); await new Promise(r => setTimeout(r, 12));
  if (each) await each(i);
  if (CLIP && recording && frameNo++ % 2 === 0) await page.screenshot({path: join(CLIP, `f${String(captured++).padStart(4, '0')}.png`)});
 }
}
const harness = () => page.evaluate(() => { const h = window.brannHarness, s = h.snapshot(); return {s, me: s.players.find(p => p.id === h.state().playerId), c: h.controls()}; });
// Turn the camera toward a world point with real relative mouse motion (0.0022 rad per pixel), eased over n frames.
async function look(at, n = 20, lead = 0) {
 for (let i = 0; i < n; i++) {
  const {me, c} = await harness(), eye = [me.position[0], me.position[1] + 1.65, me.position[2]];
  const d = at.map((v, k) => v - eye[k]), yaw = Math.atan2(-d[0], -d[2]), pitch = Math.atan2(d[1] + lead, Math.hypot(d[0], d[2]));
  const dy = Math.atan2(Math.sin(c.yaw - yaw), Math.cos(c.yaw - yaw)), dp = c.pitch - pitch, k = 1/Math.max(1, n - i)*1.6;
  // one pointer-lock style delta through the game's own handler (headless Chromium recentres a captured cursor)
  await page.evaluate(([x, y]) => window.dispatchEvent(new PointerEvent('pointermove', {pointerType: 'mouse', movementX: x, movementY: y})), [dy*k/.0022, dp*k/.0022]);
  await frames(1);
 }
}
async function walkTo(at, near) {
 for (let i = 0; i < 120; i++) { const {me} = await harness(); if (Math.hypot(at[0] - me.position[0], at[2] - me.position[2]) < near) return true;
  await look([at[0], me.position[1] + 1.65, at[2]], 2); await page.keyboard.down('KeyW'); await frames(Math.min(4, 1 + Math.floor(Math.hypot(at[0] - me.position[0], at[2] - me.position[2])*2))); await page.keyboard.up('KeyW'); }
 return false;
}
// Look and attack need the pointer captured, as on desktop; the first click only captures it.
async function capture() {
 if (await page.evaluate(() => !!document.pointerLockElement)) return;
 await page.mouse.click(320, 180); await frames(2);
 await page.waitForFunction(() => !!document.pointerLockElement, null, {timeout: 60000, polling: 250});
}
try {
 await page.goto(BASE + '/?acceptanceProbe');
 await page.waitForFunction(() => window.brannHarness?.state().rendererReady);
 await page.evaluate(() => document.querySelector('#solo').click());
 await page.waitForFunction(() => window.brannHarness?.state().controlsActive);
 await new Promise(r => setTimeout(r, 1500));
 await page.evaluate(() => window.__vt.enable());
 await capture();
 await frames(10);
 await page.keyboard.press('Digit5'); await frames(30);
 const {s} = await harness(); assert.equal((await harness()).c.weapon.tool, 'bow');
 const all = worldTrees(s), tree = all.find(t => t.id === 'tree1'), floor = terrainHeight(s, tree.x, tree.z);
 // a clear vantage 6.5 m out from tree1, on the side farthest from its neighbours
 const vantage = [...Array(12).keys()].map(i => { const a = i/12*Math.PI*2, x = tree.x + Math.sin(a)*6.5, z = tree.z + Math.cos(a)*6.5;
  return {x, z, clear: Math.min(...all.filter(t => t !== tree).map(t => Math.hypot(t.x - x, t.z - z)))}; }).sort((a, b) => b.clear - a.clear)[0];
 assert.ok(await walkTo([vantage.x, 0, vantage.z], .8), 'reached the vantage point');
 const {me} = await harness();
 // the lowest apple on the side facing us
 const slot = [...Array(26).keys()].map(i => ({i, w: appleWorld(tree, i, floor)})).filter(q => q.w.position[1] < floor + 3.9).sort((a, b) => Math.hypot(a.w.position[0] - me.position[0], a.w.position[2] - me.position[2]) - Math.hypot(b.w.position[0] - me.position[0], b.w.position[2] - me.position[2]))[0];
 const target = slot.w.position; record('target', 'pass', {tree: tree.id, slot: slot.i, target, vantage});
 recording = true;
 await look(target, 40, .02);
 await capture(); await page.mouse.down(); await frames(10);
 const drawing = (await harness()).c.weapon; record('draw', drawing.drawing ? 'pass' : 'fail', {weapon: drawing, locked: await page.evaluate(() => !!document.pointerLockElement)});
 await frames(40); await page.mouse.up();
 let pierced = null;
 await frames(40, async () => { if (!pierced) { const {s} = await harness(); pierced = s.fruit?.drops?.[0] || null; } });
 assert.ok(pierced, 'the apple came off on the arrow'); record('pierce', 'pass', {drop: pierced.id, stick: pierced.stick});
 // follow it down
 for (let i = 0; i < 6; i++) { const {s} = await harness(); const d = s.fruit.drops[0]; await look(d.position, 8); }
 await frames(40);
 const landed = (await harness()).s.fruit.drops[0]; assert.ok(['rest', 'planted'].includes(landed.mode), landed.mode); record('landed', 'pass', {mode: landed.mode});
 await shot(page, 'apple-landed');
 // walk over to it
 recording = false;
 assert.ok(await walkTo((await harness()).s.fruit.drops[0].position, 1.3), 'walked to the apple');
 recording = true; await look((await harness()).s.fruit.drops[0].position, 16);
 await frames(20); await shot(page, 'apple-cue');
 await page.keyboard.press('KeyE'); await frames(45);
 let held = (await harness()).s.fruit.drops[0]; assert.equal(held?.heldBy, (await page.evaluate(() => window.brannHarness.state().playerId))); record('take', 'pass');
 await look([0, 1.6, 0], 12); await frames(20); await shot(page, 'apple-held');
 const hp0 = (await harness()).me.hp;
 await capture(); for (let b = 0; b < 3; b++) { if (b === 1) await page.keyboard.press('KeyE'); else { await page.mouse.down(); await page.mouse.up(); } await frames(68); if (b === 0) await shot(page, 'apple-bite-1'); }
 await frames(60);
 const after = await harness(); assert.equal(after.s.fruit.drops.length, 0, 'eaten'); record('eaten', 'pass', {hp: [hp0, after.me.hp]});
 await shot(page, 'apple-done');
 assert.deepEqual(page.errors, []);
} catch (e) { record('exception', 'fail', {message: e.message, errors: page.errors}); await shot(page, 'apple-failure'); process.exitCode = 1; }
finally { await browser.close(); }
save('apple-snack');
