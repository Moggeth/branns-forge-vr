// Quick look at apples in the real game: whole apples on an arrow and a bolt and a half lie in front of the spawn,
// the hero picks one up. Screenshots only (apple-look-*.png); used to check the apple shader renders, not black.
import assert from 'node:assert/strict';
import {launch, BASE, record, save, shot} from './browser-acceptance-lib.mjs';
import {createSimulation, terrainHeight} from '../shared/simulation.js';
import {makeSave} from '../client/world-saves.js';

const fixture = (() => { const sim = createSimulation({room: 'SOLO'}), w = sim.adventureWorld(); w.tick = 10; w.enemies = []; w.landmarks = false;
 const lie = (id, stick, x, z, extra = {}) => { const g = terrainHeight(w, x, z); return {id, stick, apples: 1, bites: 0, radius: .08, position: [x, g + .08, z], velocity: [0, 0, 0],
  dir: [.6, -.1, -.79].map((v, _, a) => v/Math.hypot(...a)), mode: 'rest', bornTick: 0, biteTick: -1000, restTick: 5, heldBy: null, ...extra}; };
 w.fruit = {missing: [], drops: [lie('qaf0', 'arrow', -.25, 6.9), lie('qaf1', 'bolt', .3, 6.9), lie('qaf2', 'none', .05, 7.2, {half: true, cut: [0, 1, 0]})]};
 return Buffer.from(JSON.stringify(makeSave(sim.checkpoint()))); })();
const {browser, page} = await launch({viewport: {width: 800, height: 450}, pointerLock: true});
try {
 await page.goto(BASE + '/?acceptanceProbe');
 await page.waitForFunction(() => window.brannHarness?.state().rendererReady, null, {timeout: 240000, polling: 500});
 // a fresh browser opens What's new; close it through the real UI
 const gotIt = page.getByText('Got it', {exact: true});
 for (let i = 0; i < 20 && !(await gotIt.isVisible().catch(() => false)); i++) await page.waitForTimeout(250);
 if (await gotIt.isVisible().catch(() => false)) { await gotIt.click({force: true}); await page.waitForTimeout(400); }
 record('whats-new', (await gotIt.isVisible().catch(() => false)) ? 'fail' : 'pass');
 await page.fill('#name', 'Apple QA'); await page.check('input[name="role"][value="hero"]', {force: true});
 await page.locator('#import').setInputFiles({name: 'apple-look.json', mimeType: 'application/json', buffer: fixture});
 for (let i = 0; i < 480 && !(await page.evaluate(() => !!window.brannHarness?.state().controlsActive)); i++) { // What's new can open again on joining
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click({force: true}).catch(() => {}); await page.waitForTimeout(500); }
 await page.waitForTimeout(4000);
 const drops = await page.evaluate(() => window.brannHarness.snapshot().fruit?.drops?.length);
 record('drops', drops === 3 ? 'pass' : 'fail', {drops});
 await page.mouse.click(400, 225); await page.waitForTimeout(500);
 await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointermove', {pointerType: 'mouse', movementX: 0, movementY: 260})));
 await page.waitForTimeout(2500); await shot(page, 'apple-look-ground');
 await page.keyboard.press('KeyE'); await page.waitForTimeout(3000); await shot(page, 'apple-look-held');
 const held = await page.evaluate(() => window.brannHarness.snapshot().fruit.drops.find(d => d.heldBy)?.stick || null);
 record('held', held ? 'pass' : 'fail', {held});
 assert.deepEqual(page.errors, []);
} catch (e) { record('exception', 'fail', {message: e.message, errors: page.errors}); await shot(page, 'apple-look-failure'); process.exitCode = 1; }
finally { await browser.close(); }
save('apple-look');
