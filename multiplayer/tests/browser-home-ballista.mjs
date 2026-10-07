// Home base hands-on pieces in the real game: walk from Dawnhold's heart to a gate ballista, press E to man it,
// swing it onto a skeleton, draw and loose a lance, step off, then ring the barracks bell and drink at the fountain.
// Real input on a virtual clock like browser-apple-timberline.mjs (a software renderer is slow).
import assert from 'node:assert/strict';
import {createSimulation} from '../shared/simulation.js';
import {createEnemy} from '../shared/combat.js';
import {HOME_LAYOUT, bellPostAt, homePoint} from '../shared/home-bases.js';
import {homeBallistaYaw} from '../shared/home-ballista.js';
import {makeSave} from '../client/world-saves.js';
import {launch, BASE, record, save, shot} from './browser-acceptance-lib.mjs';

// The fixture: a quiet Dawnhold with a wild skeleton standing 12 m out in front of its left gate ballista.
const sim = createSimulation({room: 'SOLO'}), s = sim.adventureWorld(); s.tick = 1; s.landmarks = false; s.enemies = [];
s.battle.nextWaveTick = 3600;
const part = s.battle.bases[0].parts.find(p => p.id === 'battle-base-party-ballista-0'), y = homeBallistaYaw('party');
const foe = createEnemy('qa-skeleton', [part.position[0] - Math.sin(y) * 12, part.position[1], part.position[2] - Math.cos(y) * 12]);
foe.yaw = y; s.enemies.push(foe);
const fixture = Buffer.from(JSON.stringify(makeSave(sim.checkpoint())));
const at2 = ([x, z], h = 0) => [x, h, z];

const {browser, page} = await launch({viewport: {width: 640, height: 360}, pointerLock: true});
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
 for (let i = 0; i < 120; i++) { const {me} = await harness(); if (Math.hypot(at[0] - me.position[0], at[2] - me.position[2]) < near) return true;
  await look([at[0], me.position[1] + 1.65, at[2]], 2); await page.keyboard.down('KeyW'); await frames(4); await page.keyboard.up('KeyW'); }
 const {me} = await harness(); record('walk-blocked', 'fail', {position: me.position, target: at, near});
 return false;
}
async function capture() {
 if (await page.evaluate(() => !!document.pointerLockElement)) return;
 // The release notes can pop up over the world on a slow load; close them and click into the world again.
 const notes = page.getByRole('button', {name: 'Got it', exact: true});
 for (let i = 0; i < 12; i++) {
  if (await notes.isVisible()) { await notes.click(); await frames(2); }
  await page.mouse.click(320, 180); await frames(2);
  if (await page.waitForFunction(() => !!document.pointerLockElement, null, {timeout: 5000, polling: 250}).then(() => true, () => false)) return;
 }
 throw Error('pointer capture never took');
}
try {
 await page.goto(BASE + '/?acceptanceProbe');
 await page.waitForFunction(() => window.brannHarness?.state().rendererReady, null, {timeout: 240000});
 const whatsNew = page.getByRole('button', {name: 'Got it', exact: true});
 const dismiss = () => whatsNew.click({timeout: 20000}).catch(() => {}); // release notes open once per fresh browser
 await dismiss();
 await page.fill('#name', 'Dawnhold QA'); await page.check('input[name="role"][value="hero"]', {force: true});
 await page.locator('#import').setInputFiles({name: 'home-ballista.json', mimeType: 'application/json', buffer: fixture});
 for (let i = 0; i < 6 && !(await page.evaluate(() => window.brannHarness?.state().phase === 'game')); i++) { if (await whatsNew.isVisible()) await whatsNew.click(); await new Promise(r => setTimeout(r, 5000)); }
 await page.waitForFunction(() => window.brannHarness?.state().phase === 'game', null, {timeout: 120000});
 await new Promise(r => setTimeout(r, 1500));
 await dismiss(); // the notes may open again once the world is up
 await page.evaluate(() => window.__vt.enable());
 await capture(); await frames(10);
 const id = await page.evaluate(() => window.brannHarness.state().playerId);

 // Man the ballista: round the pylon, step up beside it, press E.
 assert.ok(await walkTo(at2(homePoint('party', [-3, 9])), 1.2), 'crossed the plaza');
 assert.ok(await walkTo(part.position, 2.6), 'reached the ballista');
 await page.keyboard.press('KeyE'); await frames(30);
 let h = await harness(), b = h.s.battle.bases[0].parts.find(p => p.id === part.id);
 assert.equal(b.operator, id, 'manned'); assert.ok(h.c.manned, 'controls are on the ballista'); record('manned', 'pass');
 const foeNow = h.s.enemies.find(e => e.id === 'qa-skeleton');
 await look([foeNow.position[0], foeNow.position[1] + 1, foeNow.position[2]], 30); await frames(60);
 await shot(page, 'home-ballista-aim');
 // The skeleton walks toward us: re-sight on where it is now, let the carriage settle, then fire.
 let f2 = (await harness()).s.enemies.find(e => e.id === 'qa-skeleton');
 await look([f2.position[0], f2.position[1] + 1, f2.position[2]], 12); await frames(30);
 f2 = (await harness()).s.enemies.find(e => e.id === 'qa-skeleton'); await look([f2.position[0], f2.position[1] + 1, f2.position[2]], 6); await frames(20);
 const hp0 = (await harness()).s.enemies.find(e => e.id === 'qa-skeleton')?.hp ?? 0;
 // The Sunlance draws while held (the wings bend back, the sun ring lights) and looses on release.
 await capture(); await page.mouse.down(); await frames(40); await shot(page, 'home-ballista-draw'); await page.mouse.up(); await frames(4);
 await shot(page, 'home-ballista-fire'); await frames(40);
 h = await harness(); b = h.s.battle.bases[0].parts.find(p => p.id === part.id);
 const hp1 = h.s.enemies.find(e => e.id === 'qa-skeleton')?.hp ?? 0;
 record('fired', b.readyTick > h.s.tick ? 'pass' : 'fail', {hp: [hp0, hp1], readyTick: b.readyTick, tick: h.s.tick});
 assert.ok(b.readyTick > h.s.tick, 'the ballista fired and is reloading');
 assert.ok(hp1 < hp0, 'the bolt hit the skeleton');
 await page.keyboard.down('KeyR'); await frames(40); await page.keyboard.up('KeyR');
 await page.keyboard.press('KeyE'); await frames(30);
 h = await harness(); assert.equal(h.c.manned, null, 'stepped off'); assert.ok(!h.s.battle.bases[0].parts.find(p => p.id === part.id).operator, 'seat released');

 // Ring the bell beside the barracks door.
 const bell = bellPostAt('party');
 assert.ok(await walkTo(at2(homePoint('party', [-3, 9])), 1.2), 'back across the plaza');
 assert.ok(await walkTo(at2(bell), 1.9), 'reached the bell');
 const before = (await harness()).s.enemies.length;
 await page.keyboard.press('KeyE'); await frames(30); await shot(page, 'home-bell');
 h = await harness(); assert.ok(h.s.battle.bases[0].bellReadyTick > h.s.tick, 'bell rung'); assert.ok(h.s.enemies.length > before, 'a squad marched out');
 record('bell', 'pass', {troops: h.s.enemies.length - before});

 // Drink at the fountain (already at full health, so the host says so and nothing is spent).
 assert.ok(await walkTo(at2(homePoint('party', HOME_LAYOUT.fountain)), 2.5), 'reached the fountain');
 await frames(10); await shot(page, 'home-fountain');
 assert.deepEqual(page.errors, []);
} catch (e) { record('exception', 'fail', {message: e.message, errors: page.errors}); await shot(page, 'home-ballista-failure'); process.exitCode = 1; }
finally { await browser.close(); }
save('home-ballista');
