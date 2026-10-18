// The Armoury and its Flockwright in the real game: walk from Dawnhold out to the Armoury, look it over from the road,
// step inside to the stand, press E to take a Flockwright down (it equips on key 9), raise the ring sight, fire a heavy
// bolt and watch the crew reload. Real input on a virtual clock like browser-home-ballista.mjs.
// PHONE=1 runs the same walk at a landscape phone size with touch on.
import assert from 'node:assert/strict';
import {createSimulation} from '../shared/simulation.js';
import {armouryPiece, pieceWorld} from '../shared/home-bases.js';
import {armouryStand} from '../shared/armoury.js';
import {makeSave} from '../client/world-saves.js';
import {launch, BASE, record, save, shot} from './browser-acceptance-lib.mjs';

const sim = createSimulation({room: 'SOLO'}), s = sim.adventureWorld(); s.tick = 1; s.landmarks = false; s.enemies = [];
s.battle.nextWaveTick = 36000;
const fixture = Buffer.from(JSON.stringify(makeSave(sim.checkpoint())));
const piece = armouryPiece(), local = xz => pieceWorld(piece, xz), at2 = ([x, z], h = 0) => [x, h, z];
const stand = armouryStand();

const PHONE = !!process.env.PHONE, VIEW = PHONE ? {width: 844, height: 390} : {width: 1280, height: 720}, tag = n => PHONE ? `${n}-phone` : n;
const {browser, page} = await launch({viewport: VIEW, pointerLock: true, touch: PHONE});
await page.addInitScript(() => {
 const real = performance.now.bind(performance), raf = window.requestAnimationFrame.bind(window); let vt = 0, on = false, queue = [];
 performance.now = () => on ? vt : real();
 window.requestAnimationFrame = cb => { if (!on) return raf(cb); queue.push(cb); return queue.length; };
 window.__vt = {enable() { vt = real(); on = true; }, frame(ms = 1000/60) { vt += ms; const run = queue; queue = []; for (const cb of run) cb(vt); return run.length; }};
});
async function frames(n) { for (let i = 0; i < n; i++) { await page.evaluate(ms => window.__vt.frame(ms), 1000/60); await new Promise(r => setTimeout(r, 12)); } }
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
 for (let i = 0; i < 220; i++) { const {me} = await harness(); if (Math.hypot(at[0] - me.position[0], at[2] - me.position[2]) < near) return true;
  await look([at[0], me.position[1] + 1.65, at[2]], 2); await page.keyboard.down('KeyW'); await frames(4); await page.keyboard.up('KeyW'); }
 const {me} = await harness(); record('walk-blocked', 'fail', {position: me.position, target: at, near});
 return false;
}
async function capture() {
 if (await page.evaluate(() => !!document.pointerLockElement)) return;
 const notes = page.getByRole('button', {name: 'Got it', exact: true});
 for (let i = 0; i < 12; i++) {
  if (await notes.isVisible()) { await notes.evaluate(b => b.click()); await frames(2); }
  await page.mouse.click(VIEW.width / 2, VIEW.height / 2); await frames(2);
  if (await page.waitForFunction(() => !!document.pointerLockElement, null, {timeout: 5000, polling: 250}).then(() => true, () => false)) return;
 }
 throw Error('pointer capture never took');
}
try {
 await page.goto(BASE + '/?acceptanceProbe');
 await page.waitForFunction(() => window.brannHarness?.state().rendererReady, null, {timeout: 240000});
 const whatsNew = page.getByRole('button', {name: 'Got it', exact: true});
 const dismiss = () => whatsNew.evaluate(b => b.click(), null, {timeout: 20000}).catch(() => {});
 await dismiss();
 await page.fill('#name', 'Armoury QA'); await page.check('input[name="role"][value="hero"]', {force: true});
 await page.locator('#import').setInputFiles({name: 'armoury.json', mimeType: 'application/json', buffer: fixture});
 for (let i = 0; i < 6 && !(await page.evaluate(() => window.brannHarness?.state().phase === 'game')); i++) { if (await whatsNew.isVisible()) await dismiss(); await new Promise(r => setTimeout(r, 5000)); }
 await page.waitForFunction(() => window.brannHarness?.state().phase === 'game', null, {timeout: 120000});
 await new Promise(r => setTimeout(r, 1500));
 await dismiss();
 await page.evaluate(() => window.__vt.enable());
 await capture(); await frames(10);

 // Locked until taken: key 9 says where to find it.
 await page.keyboard.press('Digit9'); await frames(6);
 let h = await harness(); assert.notEqual(h.me.tool, 'flockwright', 'locked before the Armoury');
 // Out to the road in front of the Armoury, then look the hall over.
 const road = local([-2.2, 9.5]);
 assert.ok(await walkTo(at2(road), 1.2), 'reached the road in front');
 await look(at2(local([0, 0]), h.me.position[1] + 2.2), 30); await frames(90);
 await shot(page, tag('armoury-front'));
 const door = local([0, 3.4]);
 assert.ok(await walkTo(at2(door), .9), 'reached the doorway');
 await look(at2(stand, h.me.position[1] + 1.1), 24); await frames(60);
 await shot(page, tag('armoury-inside'));
 assert.ok(await walkTo(at2(stand), 1.9), 'reached the stand');
 await look(at2(stand, h.me.position[1] + 1.15), 20); await frames(40);
 await shot(page, tag('armoury-stand'));
 await page.keyboard.press('KeyE'); await frames(60);
 h = await harness();
 record('taken', h.me.flockwright && h.me.tool === 'flockwright' ? 'pass' : 'fail', {tool: h.me.tool, owned: h.me.flockwright});
 assert.equal(h.me.flockwright, true, 'taken'); assert.equal(h.me.tool, 'flockwright', 'equipped');
 await frames(60);
 // Out the door and face the meadow, then aim and fire.
 const out = local([0, 9]); await walkTo(at2(out), 1); const far = local([0, 40]);
 await look(at2(far, h.me.position[1] + 2.5), 24); await frames(90);
 await shot(page, tag('flockwright-held'));
 if (!PHONE) { await page.mouse.down({button: 'right'}); await page.mouse.up({button: 'right'}); await frames(40); await shot(page, 'flockwright-aim'); }
 const before = (await harness()).s.projectiles.length;
 if (!PHONE) { await page.mouse.down(); await frames(1); await page.mouse.up(); }
 await frames(4); await shot(page, tag('flockwright-fire'));
 h = await harness(); record('fired', h.s.projectiles.some(p => p.heavy) || h.s.projectiles.length > before ? 'pass' : 'fail', {projectiles: h.s.projectiles.length});
 await frames(20); await shot(page, tag('flockwright-reload'));
 const diag = await page.evaluate(() => document.querySelector('canvas')?.brannDiagnostics?.() ?? null);
 record('diagnostics', 'info', {calls: diag?.calls, triangles: diag?.triangles});
} catch (error) {
 record('flockwright', 'fail', {error: String(error.stack || error)}); await shot(page, 'flockwright-failure').catch(() => {});
 throw error;
} finally { save(tag('flockwright')); await browser.close(); }
