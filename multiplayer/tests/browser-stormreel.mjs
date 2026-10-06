// Stormreel in the real game (round 3, two poles): walk to a charged Stormspire, take the pack beside you (E), fire a
// positive or negative bolt at a skeleton, reel it in (Q), fire again and drop the pack (the bolt stays tethered), walk to the
// other hook, take that pack and lodge the opposite pole so the circuit closes, then walk out to the end of the cable. Real input on a virtual clock like
// browser-apple-timberline.mjs. PHONE=1 repeats the HUD checks at a landscape phone size.
import assert from 'node:assert/strict';
import {createSimulation,terrainHeight} from '../shared/simulation.js';
import {createEnemy} from '../shared/combat.js';
import {makeSave} from '../client/world-saves.js';
import {STORMREEL,hookPoint} from '../shared/stormreel.js';
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
  const clean = async name => { await page.evaluate(() => document.body.classList.add('sr-clean')); await frames(2); await shot(page, `${name}${PHONE ? '-phone' : ''}`); await page.evaluate(() => document.body.classList.remove('sr-clean')); };
  await page.addStyleTag({content: 'body.sr-clean #hud, body.sr-clean .bf-equip, body.sr-clean .mui-weapons{visibility:hidden!important}'});
  const tap = async (n = 4) => { await page.mouse.down(); await frames(n); await page.mouse.up(); };
  const tw = async () => (await harness()).s.inventions.structures.find(b => b.id === 'spire');
  const poleOf = (b, id) => b.operator === id ? 'red' : b.operator2 === id ? 'blue' : null;
  const aimFoe = async (id = 'zap0', n = 14) => { const {s: sn} = await harness(), f = sn.enemies.find(e => e.id === id); if (f) await look([f.position[0], f.position[1] + 1.1, f.position[2]], n); return f; };

  // 1. Take the pack beside you: whichever pole it is, the crossbow is that pole's colour.
  await page.keyboard.press('KeyE'); await frames(24);
  let {me, s: snap} = await harness(), t = await tw();
  assert.equal(me.tool, 'stormreel', 'pack taken'); const first = poleOf(t, me.id), second = first === 'red' ? 'blue' : 'red';
  assert.ok(first, 'a pack is worn'); record('pack-taken', 'pass', {pole: first, charge: t.charge});
  await aimFoe('zap0', 8); await frames(6); await clean(`stormreel-held-${first}`);

  // 2. A charged shot (hold, then release): the bolt stays lodged as a probe of that pole, tethered by its filament.
  await page.mouse.down(); await frames(30); await shot(page, `stormreel-charging-${first}${PHONE ? '-phone' : ''}`);
  const diag = await page.evaluate(() => document.querySelector('canvas')?.brannDiagnostics?.()?.stormreel ?? null);
  record('charging', diag?.preview ? 'pass' : 'warn', {diag});
  await page.mouse.up(); await frames(3); await shot(page, `stormreel-zap${PHONE ? '-phone' : ''}`); await frames(8); await clean(`stormreel-lodged-${first}`);
  t = await tw(); assert.ok(t.probes?.[first], `a ${first} probe is lodged`); assert.ok(!t.arc, 'one pole alone runs no current'); record('probe-lodged', 'pass', {pole: first});

  // 3. Q reels the bolt back in along its tether.
  await page.keyboard.press('KeyQ'); await frames(5); await clean('stormreel-reel'); await frames(14);
  t = await tw(); assert.ok(!t.probes, 'the reeled bolt is gone'); record('reel', 'pass', {charge: t.charge});

  // 4. Lodge a gentle bolt again, then drop the pack: the probe stays, the cable runs on to it.
  await aimFoe('zap0', 8); await tap(); await frames(12); t = await tw(); assert.ok(t.probes?.[first], 'lodged again');
  await page.keyboard.press('Digit1'); await frames(30);
  t = await tw(); assert.ok(poleOf(t, me.id) === null && t.probes?.[first], `the ${first} probe stays connected after the pack is dropped`);
  await aimFoe('zap0', 8); await frames(4); await clean('stormreel-tether'); record('tethered-after-drop', 'pass');

  // 5. Walk to the other hook, take that pack, lodge the opposite pole: the circuit closes and runs through the foes.
  const hook = hookPoint(await tw(), second);
  assert.ok(await walkTo([hook[0], hook[1], hook[2]], 2.6), 'reached the other hook'); await look([tower.position[0], tower.position[1] + 2, tower.position[2]], 6);
  await page.keyboard.press('KeyE'); await frames(20);
  ({me} = await harness()); t = await tw(); assert.equal(poleOf(t, me.id), second, `took the ${second} pack beside the other hook`);
  await clean(`stormreel-held-${second}`);
  let arcSeen = false;
  for (let i = 0; i < 6 && !arcSeen; i++) { const f = await aimFoe('zap0', 8) || await aimFoe('zap1', 8); await tap(24); await frames(6); t = await tw(); arcSeen = !!t.arc; }
  await frames(4); await shot(page, `stormreel-circuit${PHONE ? '-phone' : ''}`); await frames(4); await clean('stormreel-circuit-clean');
  record('circuit', arcSeen ? 'pass' : 'fail', {probes: Object.keys((await tw()).probes || {})}); assert.ok(arcSeen, 'both poles lodged: the circuit runs');
  await frames(60); ({s: snap} = await harness());
  record('shot', 'pass', {zap0: snap.enemies.find(e => e.id === 'zap0')?.hp ?? 'felled', zap1: snap.enemies.find(e => e.id === 'zap1')?.hp ?? 'felled', charge: (await tw()).charge});
  if (!(await tw()).operator && !(await tw()).operator2) { await page.keyboard.press('KeyE'); await frames(30); }
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
