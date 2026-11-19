// Run against the production preview with ACCEPT_BASE and the standard browser acceptance settings.
import assert from 'node:assert/strict';
import {launch, BASE, stubUnavailableRooms} from './browser-acceptance-lib.mjs';
import {WorldSaves, makeSave} from '../client/world-saves.js';
import {createSimulation} from '../shared/simulation.js';
import {createEnemy} from '../shared/combat.js';

const sim = createSimulation({room: 'SOLO', seed: 41});
sim.adventureWorld().enemies.push(createEnemy('savedgolem', [5, 0, 8], 'golem'));
// Use the game's storage writer so the fixture follows its current key and save format.
const entries = new Map();
const saves = new WorldSaves({getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value)});
saves.put(makeSave(sim.checkpoint(), {name: 'Saved golem'}));

for (const [touch, width, height] of [[false, 1000, 650], [true, 390, 844]]) {
  const {browser, page} = await launch({touch, viewport: {width, height}});
  try {
    await stubUnavailableRooms(page);
    await page.addInitScript(pairs => {
      for (const [key, value] of pairs) localStorage.setItem(key, value);
    }, [...entries]);
    await page.goto(BASE + '/?acceptanceProbe', {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => window.brannHarness?.state().rendererReady, null, {timeout: 120000});
    const closeNotes = page.getByRole('button', {name: 'Close patch notes', exact: true});
    if (await closeNotes.isVisible()) await closeNotes.click();
    // The compact welcome screen hides the legacy recovery controls. Exercise their saved-world handler directly.
    await page.locator('#resume').evaluate(button => button.click());
    await page.waitForFunction(() => {
      const state = window.brannHarness.state();
      const diagnostics = document.querySelector('#world').brannDiagnostics();
      return state.phase === 'game' && state.snapshots > 10 && diagnostics?.startup.ready && diagnostics.creatures.actors > 0;
    }, null, {timeout: 90000});
    const result = await page.evaluate(() => ({
      solo: window.brannHarness.state().solo,
      golem: window.brannHarness.snapshot().enemies.find(e => e.id === 'savedgolem')?.kind,
      startupError: document.querySelector('#world').brannDiagnostics().startup.error
    }));
    assert.deepEqual(result, {solo: true, golem: 'golem', startupError: null});
    assert.deepEqual(page.errors, []);
    console.log(`PASS saved golem on ${width}x${height} (touch=${touch})`);
  } finally {
    await browser.close();
  }
}
