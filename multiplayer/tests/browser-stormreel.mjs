// Stormreel in the real game: walk to a charged Stormspire, take its pack (E), charge and fire at a grounded skeleton,
// then walk out to the end of the cable and look back along it. Real input on a virtual clock like
// browser-apple-timberline.mjs. PHONE=1 repeats the HUD checks at a landscape phone size.
import assert from 'node:assert/strict';
import {createSimulation,terrainHeight} from '../shared/simulation.js';
import {createEnemy} from '../shared/combat.js';
import {makeSave} from '../client/world-saves.js';
import {STORMREEL} from '../shared/stormreel.js';
import {launch,BASE,record,save,shot} from './browser-acceptance-lib.mjs';

const PHONE = process.env.PHONE === '1', W = PHONE ? 844 : 800, H = PHONE ? 390 : 450;
const sim = createSimulation({room: 'SOLO'}), s = sim.adventureWorld(); s.tick = 1; s.landmarks = false; s.enemies = [];
// A new Hero arrives at (-31, -31) facing -Z: the tower stands just ahead and to the right, two skeletons 11 m to the east.
const T = [-28.5, -35];
s.inventions.structures.push({id: 'spire', type: 'stormspire', position: [T[0], terrainHeight(s, T[0], T[1], false), T[1]], yaw: Math.PI / 2, hp: 240, maxHp: 240,
  side: 'party', builtTick: 0, readyTick: 0, fireTick: -1000, open: false, charge: 160, armed: false, aimYaw: 0, operator: null});
for (const [i, [x, z]] of [[-20, -30], [-19.6, -31.3]].entries()) s.enemies.push(createEnemy(`zap${i}`, [x, terrainHeight(s, x, z, false), z]));
const fixture = Buffer.from(JSON.stringify(makeSave(sim.checkpoint())));

const {browser, page} = await launch({viewport: {width: W, height: H}, pointerLock: true});
await page.addInitScript(() => {
  const real = performance.now.bind(performance), raf = window.requestAnimationFrame.bind(window); let vt = 0, on = false, queue = [];
  performance.now = () => on ? vt : real();
  window.requestAnimationFrame = cb => { if (!on) return raf(cb); queue.push(cb); return queue.length; };
  window.__vt = {enable() { vt = real(); on = true; }, frame(ms = 1000 / 60) { vt += ms; const run = queue; queue = []; for (const cb of run) cb(vt); return run.length; }};
});
async function frames(n, ms = 1000 / 60) { for (let i = 0; i < n; i++) { await page.evaluate(ms => window.__vt.frame(ms), ms); await new Promise(r => setTimeout(r, 8)); } }
const harness = () => page.evaluate(() => { const h = window.brannHarness, s = h.snapshot(); return {s, me: s.players.find(p => p.id === h.state().playerId), c: h.controls()}; });
async function look(at, n = 16) {
  for (let i = 0; i < n; i++) {
    const {me, c} = await harness(), eye = [me.position[0], me.position[1] + 1.65, me.position[2]];
    const d = at.map((v, k) => v - eye[k]), yaw = Math.atan2(-d[0], -d[2]), pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
    const dy = Math.atan2(Math.sin(c.yaw - yaw), Math.cos(c.yaw - yaw)), dp = c.pitch - pitch, k = 1 / Math.max(1, n - i) * 1.6;
    await page.evaluate(([x, y]) => window.dispatchEvent(new PointerEvent('pointermove', {pointerType: 'mouse', movementX: x, movementY: y})), [dy * k / .0022, dp * k / .0022]);
    await frames(1);
  }
}
async function walkTo(at, near) {
  for (let i = 0; i < 160; i++) { const {me} = await harness(); if (Math.hypot(at[0] - me.position[0], at[2] - me.position[2]) < near) return true;
    await look([at[0], me.position[1] + 1.6, at[2]], 2); await page.keyboard.down('KeyW'); await frames(4, 50); await page.keyboard.up('KeyW'); }
  return false;
}
try {
  await page.goto(BASE + '/?acceptanceProbe');
  await page.waitForFunction(() => window.brannHarness?.state().rendererReady, null, {timeout: 120000});
  const whatsNew = page.getByRole('button', {name: 'Got it', exact: true});
  if (await whatsNew.isVisible()) await whatsNew.click();
  await page.fill('#name', 'Storm QA'); await page.check('input[name="role"][value="hero"]', {force: true});
  await page.locator('#import').setInputFiles({name: 'stormreel.json', mimeType: 'application/json', buffer: fixture});
  await page.waitForFunction(() => window.brannHarness?.state().phase === 'game', null, {timeout: 120000});
  await new Promise(r => setTimeout(r, 2500));
  await page.evaluate(() => window.__vt.enable());
  await page.mouse.click(W / 2, H / 2); await frames(2);
  await page.waitForFunction(() => !!document.pointerLockElement, null, {timeout: 60000, polling: 250});
  await frames(20);
  const tower = (await harness()).s.inventions.structures.find(b => b.id === 'spire');
  assert.ok(await walkTo(tower.position, 4.2), 'reached the Stormspire'); record('at-tower', 'pass');
  await look([tower.position[0], tower.position[1] + 3, tower.position[2]], 20); await frames(30);
  await shot(page, `stormreel-tower${PHONE ? '-phone' : ''}`);
  await page.keyboard.press('KeyE'); await frames(40);
  let {me, s: snap} = await harness();
  assert.equal(me.tool, 'stormreel', 'pack taken'); assert.equal(snap.inventions.structures.find(b => b.id === 'spire').operator, me.id);
  record('pack-taken', 'pass', {charge: snap.inventions.structures.find(b => b.id === 'spire').charge});
  const foe = snap.enemies.find(e => e.id === 'zap0');
  await look([foe.position[0], foe.position[1] + 1, foe.position[2]], 20); await frames(30);
  await shot(page, `stormreel-held${PHONE ? '-phone' : ''}`);
  await page.addStyleTag({content: 'body.sr-clean #hud, body.sr-clean .bf-equip, body.sr-clean .mui-weapons{visibility:hidden!important}'});
  await page.evaluate(() => document.body.classList.add('sr-clean')); await frames(2); await shot(page, `stormreel-held-clean${PHONE ? '-phone' : ''}`); await page.evaluate(() => document.body.classList.remove('sr-clean'));
  await page.mouse.down(); await frames(40);
  ({s: snap} = await harness()); const f2 = snap.enemies.find(e => e.id === 'zap0');
  if (f2) await look([f2.position[0], f2.position[1] + 1, f2.position[2]], 6);
  await frames(6); await shot(page, `stormreel-charging${PHONE ? '-phone' : ''}`);
  const diag = await page.evaluate(() => document.querySelector('canvas')?.brannDiagnostics?.()?.stormreel ?? null);
  record('charging', diag?.preview ? 'pass' : 'warn', {diag});
  await page.mouse.up(); await frames(5); await shot(page, `stormreel-zap${PHONE ? '-phone' : ''}`);
  await frames(8); await shot(page, `stormreel-zap-after${PHONE ? '-phone' : ''}`);
  ({s: snap} = await harness());
  record('shot', 'pass', {zap0: snap.enemies.find(e => e.id === 'zap0')?.hp ?? 'felled', zap1: snap.enemies.find(e => e.id === 'zap1')?.hp ?? 'felled', charge: snap.inventions.structures.find(b => b.id === 'spire').charge});
  // Walk away from the tower, past the end of the cable.
  const away = [tower.position[0] - 10, 0, tower.position[2] + 60];
  for (let i = 0; i < 45; i++) { const {me} = await harness(); await look([away[0], me.position[1] + 1.6, away[2]], 2); await page.keyboard.down('KeyW'); await frames(4, 50); await page.keyboard.up('KeyW'); }
  ({me, s: snap} = await harness());
  const d = Math.hypot(me.position[0] - tower.position[0] - 1.34 * Math.cos(tower.yaw), me.position[2] - tower.position[2] + 1.34 * Math.sin(tower.yaw));
  record('leash', d <= STORMREEL.cable + .6 ? 'pass' : 'fail', {distance: +d.toFixed(2)});
  await look([tower.position[0], tower.position[1] + 1, tower.position[2]], 24); await frames(30);
  await shot(page, `stormreel-cable${PHONE ? '-phone' : ''}`);
  await page.keyboard.press('Digit1'); await frames(60);
  ({me} = await harness()); record('home', me.tool !== 'stormreel' ? 'pass' : 'fail', {tool: me.tool});
  await frames(20); await shot(page, `stormreel-home${PHONE ? '-phone' : ''}`);
  record('errors', page.errors.length ? 'warn' : 'pass', {errors: page.errors.slice(0, 8)});
} catch (error) {
  record('stormreel', 'fail', {error: String(error.stack || error)}); await shot(page, 'stormreel-failure').catch(() => {});
  process.exitCode = 1;
} finally { save(`stormreel${PHONE ? '-phone' : ''}`); await browser.close(); }
