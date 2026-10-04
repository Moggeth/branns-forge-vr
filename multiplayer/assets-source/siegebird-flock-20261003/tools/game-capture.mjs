// Real-game captures of the Siegebird reload at exact reload times, even on a software renderer.
// A virtual clock replaces performance.now and requestAnimationFrame timestamps, so each frame is rendered
// at a chosen time after the shot. Needs `npx vite --host 127.0.0.1 --port 5188` in multiplayer/.
//   PW_CORE=<playwright> node tools/game-capture.mjs <label> [--ads] [--touch] [--times .3,.5] [--shots 2]
import {launch, BASE, sleep, chooseTouchWeapon} from '../../../tests/browser-acceptance-lib.mjs';
import {mkdirSync} from 'node:fs';
const args = process.argv.slice(2), flag = n => args.includes(n), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const label = args[0] || 'fps', touch = flag('--touch'), ads = flag('--ads'), shots = +opt('--shots', 2);
const times = opt('--times', '.0,.05,.12,.3,.42,.52,.6,.68,.74,.8,.86,.95,1.1,1.3').split(',').map(Number);
const dir = new URL(`../captures/${label}/`, import.meta.url).pathname; mkdirSync(dir, {recursive: true});
const {browser, page} = await launch(touch ? {touch: true, viewport: {width: 844, height: 390}} : {viewport: {width: Number(opt('--w', 960)), height: Number(opt('--h', 540))}});
await page.addInitScript(() => {
  const real = performance.now.bind(performance), raf = window.requestAnimationFrame.bind(window);
  let virtual = null, frames = 0;
  performance.now = () => virtual ?? real();
  window.requestAnimationFrame = cb => raf(t => { frames++; cb(virtual ?? t); });
  window.__clock = {freeze() { virtual = real(); return virtual; }, set(t) { virtual = t; }, get: () => virtual, release() { virtual = null; }, frames: () => frames};
});
const frame = async (n = 2) => { const f0 = await page.evaluate(() => window.__clock.frames()); await page.waitForFunction(f => window.__clock.frames() >= f, f0 + n, {timeout: 120000}); };
const t0 = performance.now();
try {
  await page.goto(BASE + '/?acceptanceProbe'); await page.waitForFunction(() => window.brannHarness?.state().rendererReady, null, {timeout: 120000});
  await page.locator('#solo').click(); await page.waitForFunction(() => window.brannHarness?.state().controlsActive, null, {timeout: 120000});
  await sleep(1500);
  if (touch) await chooseTouchWeapon(page, 'crossbow'); else await page.keyboard.press('Digit4');
  await page.waitForFunction(() => window.brannHarness.controls().weapon.tool === 'crossbow', null, {timeout: 60000}); await frame(3);
  if (ads) { if (touch) await page.locator('#special').tap(); await page.waitForFunction(() => window.brannHarness.controls().weapon.ads > .99, null, {timeout: 120000}); }
  await page.screenshot({path: dir + 'loaded.png'});
  const out = [];
  for (let s = 1; s <= shots; s++) {
    const T = await page.evaluate(() => window.__clock.freeze()); await frame(1);
    if (touch) await page.locator('[data-touch-action="strike"]').tap();
    else await page.evaluate(() => { const c = document.querySelector('#world'); c.dispatchEvent(new MouseEvent('mousedown', {button: 0, bubbles: true})); });
    for (const t of times) { await page.evaluate(v => window.__clock.set(v), T + t * 1000); await frame(2);
      const file = `shot${s}-${t.toFixed(2)}s.png`; await page.screenshot({path: dir + file}); out.push(file); }
    await page.evaluate(() => window.__clock.release()); await sleep(1500); await frame(4);
  }
  const me = await page.evaluate(() => { const h = window.brannHarness; return h.snapshot().players.find(p => p.id === h.state().playerId); });
  console.log(JSON.stringify({label, frames: out.length, siegebird: me.siegebird, errors: page.errors, seconds: ((performance.now() - t0) / 1000).toFixed(1)}));
} catch (e) { console.log('FAIL', e.message.split('\n')[0], page.errors); await page.screenshot({path: dir + 'failure.png'}); process.exitCode = 1; }
finally { await browser.close(); }
