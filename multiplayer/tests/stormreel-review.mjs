// Stormreel in-game review captures (art review, not a pass/fail gate): the real game, real input, a virtual clock.
//   node tests/stormreel-review.mjs                 first-person desktop: tower + crew, held crossbow, charge, lodged bolt,
//                                                    spiked crossbow, second pack, closed circuit (surge + cook)
//   PHONE=1 node tests/stormreel-review.mjs          the same at a landscape phone size
//   VIEW=god node tests/stormreel-review.mjs         God (RTS) camera over the tower at three zooms
//   OUT=dir                                          where the PNGs go (default /mnt/project-files/stormreel/review)
// Slow on software GL (minutes); run it hidden in the background.
import {mkdirSync} from 'node:fs';
import {createSimulation,terrainHeight} from '../shared/simulation.js';
import {createEnemy} from '../shared/combat.js';
import {makeSave} from '../client/world-saves.js';
import {hookPoint} from '../shared/stormreel.js';
import {launch,BASE} from './browser-acceptance-lib.mjs';

const PHONE = process.env.PHONE === '1', GOD = process.env.VIEW === 'god', W = PHONE ? 844 : 1280, H = PHONE ? 390 : 720;
const OUT = process.env.OUT || '/mnt/project-files/stormreel/review'; mkdirSync(OUT, {recursive: true});
const tag = `${GOD ? 'god' : 'fp'}${PHONE ? '-phone' : ''}`;
const sim = createSimulation({room: 'SOLO'}), s = sim.adventureWorld(); s.tick = 1; s.landmarks = false; s.enemies = [];
// A new Hero arrives at (-31, -31) facing -Z: the tower stands just ahead and to the right, a skeleton and a golem 11 m east.
const T = [-28.5, -35];
s.inventions.structures.push({id: 'spire', type: 'stormspire', position: [T[0], terrainHeight(s, T[0], T[1], false), T[1]], yaw: Math.PI / 2, hp: 240, maxHp: 240,
  side: 'party', builtTick: 0, readyTick: 0, fireTick: -1000, open: false, charge: 240, armed: false, aimYaw: 0, operator: null});
for (const [i, [x, z]] of [[-20, -30], [-19.4, -32.2]].entries()) { const e = createEnemy(`zap${i}`, [x, terrainHeight(s, x, z, false), z]); s.enemies.push(e); }
const fixture = Buffer.from(JSON.stringify(makeSave(sim.checkpoint())));

const {browser, page} = await launch({viewport: {width: W, height: H}, pointerLock: !GOD});
await page.addInitScript(() => {
  const real = performance.now.bind(performance), raf = window.requestAnimationFrame.bind(window); let vt = 0, on = false, queue = [];
  performance.now = () => on ? vt : real();
  window.requestAnimationFrame = cb => { if (!on) return raf(cb); queue.push(cb); return queue.length; };
  window.__vt = {enable() { vt = real(); on = true; }, frame(ms = 1000 / 60) { vt += ms; const run = queue; queue = []; for (const cb of run) cb(vt); return run.length; }};
});
const frames = async (n, ms = 1000 / 60) => { for (let i = 0; i < n; i++) { await page.evaluate(ms => window.__vt.frame(ms), ms); await new Promise(r => setTimeout(r, 4)); } };
const harness = () => page.evaluate(() => { const h = window.brannHarness, s = h.snapshot(); return {s, me: s.players.find(p => p.id === h.state().playerId), c: h.controls()}; });
const shots = [];
async function snap(name) { await page.evaluate(() => document.body.classList.add('sr-clean')); await frames(1); const p = `${OUT}/${tag}-${name}.png`; await page.screenshot({path: p}); shots.push(p); console.log('shot', p);
  await page.evaluate(() => document.body.classList.remove('sr-clean')); }
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
const tw = async () => (await harness()).s.inventions.structures.find(b => b.id === 'spire');
const foeAt = async id => { const f = (await harness()).s.enemies.find(e => e.id === id); return f ? [f.position[0], f.position[1] + 1.1, f.position[2]] : null; };
try {
  await page.goto(BASE + '/?acceptanceProbe');
  await page.waitForFunction(() => window.brannHarness?.state().rendererReady, null, {timeout: 600000});
  // "What's new" opens a moment after load and covers the welcome form: dismiss it with a DOM click once it shows.
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Got it' && b.offsetParent); b?.click(); return !!b || !!document.querySelector('#name')?.offsetParent && document.querySelector('#name') === document.elementFromPoint(...(r => [r.x + 5, r.y + 5])(document.querySelector('#name').getBoundingClientRect())); }, null, {timeout: 60000, polling: 500}).catch(() => {});
  await page.waitForTimeout(800);
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Got it' && b.offsetParent)?.click());
  // Fill the welcome form straight through the DOM (the What's-new panel and the welcome animation can cover it).
  await page.evaluate(role => { const n = document.querySelector('#name'); if (n) { n.value = 'Storm Review'; n.dispatchEvent(new Event('input', {bubbles: true})); }
    const r = document.querySelector(`input[name="role"][value="${role}"]`); if (r) { r.checked = true; r.dispatchEvent(new Event('change', {bubbles: true})); } }, GOD ? 'god' : 'hero');
  await page.locator('#import').setInputFiles({name: 'stormreel.json', mimeType: 'application/json', buffer: fixture}, {timeout: 180000});
  await page.waitForFunction(() => window.brannHarness?.state().phase === 'game', null, {timeout: 600000});
  await new Promise(r => setTimeout(r, 2500));
  await page.addStyleTag({content: 'body.sr-clean #hud, body.sr-clean .bf-equip, body.sr-clean .mui-weapons, body.sr-clean .toast, body.sr-clean [class*="cue"]{visibility:hidden!important}'});
  await page.evaluate(() => window.__vt.enable());
  if (GOD) {
    // Pan the God camera over the tower (closed loop on the reported pan), then three zooms and a turn.
    for (let i = 0; i < 80; i++) {
      const {c} = await harness(), [px, pz] = c.godPan, ex = T[0] - px, ez = T[1] - pz; if (Math.hypot(ex, ez) < 1.2) break;
      let best = null; for (const key of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) { await page.keyboard.down(key); await frames(2, 50); await page.keyboard.up(key); const p = (await harness()).c.godPan;
        const err = Math.hypot(T[0] - p[0], T[1] - p[1]); if (!best || err < best.err) best = {key, err}; }
      await page.keyboard.down(best.key); await frames(6, 50); await page.keyboard.up(best.key);
    }
    await frames(30);
    for (const [name, wheel] of [['far', 600], ['mid', -900], ['near', -900]]) { await page.mouse.move(W / 2, H / 2); await page.mouse.wheel(0, wheel); await frames(40); await snap(name); }
    console.log(JSON.stringify((await harness()).c.orbit));
  } else {
    await page.mouse.click(W / 2, H / 2); await frames(2);
    await page.waitForFunction(() => !!document.pointerLockElement, null, {timeout: 60000, polling: 250});
    await frames(20);
    const tower = await tw();
    await walkTo(tower.position, 6.5); await look([tower.position[0], tower.position[1] + 3.2, tower.position[2]], 20); await frames(40); await snap('tower');
    await look([tower.position[0], tower.position[1] + 1.1, tower.position[2]], 12); await frames(20); await snap('tower-base');
    await walkTo(tower.position, 4.2); await page.keyboard.press('KeyE'); await frames(30);
    const zap = await foeAt('zap0'); await look(zap, 16); await frames(20); await snap('held');
    await look([zap[0], zap[1] + 3, zap[2] + 6], 14); await frames(20); await snap('held-sky');
    await look(zap, 12); await page.mouse.down(); await frames(40); await snap('charging');
    await page.mouse.up(); await frames(3); await snap('fire'); await frames(30); await snap('lodged');
    // Spike the crossbow and look down at it.
    await page.keyboard.press('KeyG'); await frames(40);
    const pl = Object.values((await tw()).planted || {})[0]; let me = (await harness()).me; await look(pl ? [pl.at[0], pl.at[1] + .25, pl.at[2]] : [me.position[0] + .2, me.position[1] - .2, me.position[2] - 1.4], 14); await frames(30); await snap('planted');
    // The other pack: walk to its hook, take it, close the circuit on the same skeleton.
    const t = await tw(), mine = t.operator ? 'red' : t.operator2 ? 'blue' : null, other = (t.probes?.red ? 'blue' : 'red');
    console.log('worn after plant', mine, 'probes', Object.keys(t.probes || {}).filter(k => t.probes[k]));
    const hook = hookPoint(t, other); await walkTo([hook[0], hook[1], hook[2]], 2.4); await look([tower.position[0], tower.position[1] + 2, tower.position[2]], 8); await page.keyboard.press('KeyE'); await frames(30);
    let arc = false; for (let i = 0; i < 6 && !arc; i++) { const z = await foeAt('zap0'); if (!z) break; await look(z, 10); await page.mouse.down(); await frames(30); await page.mouse.up(); await frames(4); arc = !!(await tw()).arc; }
    await snap('surge'); await frames(20); await snap('cook'); await frames(90); await snap('after');
    const z1 = await foeAt('zap1'); if (z1) { await look(z1, 10); await frames(10); await snap('second-foe'); }
    console.log('arc', arc);
  }
  console.log('errors', JSON.stringify(page.errors?.slice(0, 6) || []));
} catch (error) { console.log('FAILED', error.stack || error); await page.screenshot({path: `${OUT}/${tag}-failure.png`}).catch(() => {}); process.exitCode = 1; }
finally { console.log(JSON.stringify(shots)); await browser.close(); }
