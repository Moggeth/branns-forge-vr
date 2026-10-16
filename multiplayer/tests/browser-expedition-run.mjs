// Expedition Roguelite capture run (Playwright, dev server with ?solo&acceptanceProbe). Launches a run from the
// welcome screen through the real UI, then uses the dev-only host probe to move the Hero between destinations and
// clear encounters quickly, capturing each stage on desktop and on a phone-sized touch viewport.
//   ACCEPT_BASE=http://127.0.0.1:5188 PW_CORE=<playwright> PW_CHROME=<chromium> node tests/browser-expedition-run.mjs
import {launch, BASE, CAPTURES, sleep, record, save} from './browser-acceptance-lib.mjs';
import {join} from 'node:path';

const OUT = process.env.RUN_CAPTURES || CAPTURES;
const shot = async (page, name) => { await page.screenshot({path: join(OUT, `${name}.png`), timeout: 180000}); record(name, 'captured'); };

async function host(page, fn, arg) {
  return page.evaluate(async ([src, arg]) => {
    const {loadSimulation} = await import('/shared/simulation.js');
    const q = window.__qaRun, s = q.session(), st = s.simulation.checkpoint();
    const out = new Function('st', 'arg', src)(st, arg);
    s.simulation = loadSimulation(st); return out ?? null;
  }, [fn.toString().replace(/^[^{]*{|}$/g, ''), arg]);
}
const run = page => page.evaluate(() => window.__qaRun.snapshot()?.run);
const cmd = (page, action, payload = {}) => page.evaluate(([a, p]) => window.__qaRun.session().command('run', {action: a, ...p}), [action, payload]);
async function until(page, test, label, ms = 20000) {
  const t = Date.now();
  while (Date.now() - t < ms) { const r = await run(page); if (r && test(r)) return r; await sleep(100); }
  throw Error(`timeout: ${label}`);
}
// Place the Hero `back` metres short of a destination, facing it.
async function approach(page, node, back) {
  await host(page, function () {
    const p = st.players[0], [x, z, back] = arg, cx = st.run.camp[0], cz = st.run.camp[1];
    const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz) || 1, px = x - dx / d * back, pz = z - dz / d * back;
    p.position = [px, p.position[1] + 3, pz]; p.yaw = Math.atan2(-(x - px), -(z - pz)); p.vy = 0;
  }, [node.x, node.z, back]);
}
async function clearFoes(page) { await host(page, function () { const ids = new Set(st.run.foes.map(f => f.id)); st.enemies = st.enemies.filter(e => !ids.has(e.id)); for (const d of st.deposits) if (st.run.shards.includes(d.id)) { d.depleted = true; d.hits = d.maxHits; } if (st.run.objective.need) st.run.objective.have = st.run.objective.need; }); }

async function play(page, prefix, {phone = false} = {}) {
  page.setDefaultTimeout(120000); // software WebGL on CI-like runners is slow to present frames
  await page.goto(`${BASE}/?solo&acceptanceProbe`, {waitUntil: 'domcontentloaded'});
  await page.waitForSelector('#runLaunch', {state: 'visible', timeout: 60000});
  // The first-visit "What's new" panel opens a moment after load.
  if (await page.waitForSelector('.pn-backdrop', {state: 'visible', timeout: 20000}).catch(() => null)) { await page.click('.pn-backdrop button:has-text("Got it")'); await page.waitForSelector('.pn-backdrop', {state: 'hidden'}).catch(() => {}); }
  await page.fill('#name', 'Mitch').catch(() => {});
  await page.click('#runLaunch');
  await page.waitForSelector('.rx-launch .rx-go', {state: 'visible'});
  await sleep(1200);
  await shot(page, `${prefix}00-launcher`);
  await page.fill('.rx-seed input', '31337');
  await page.click('.rx-launch .rx-go');
  await until(page, r => r.stage === 'camp', 'camp', 90000);
  await page.waitForSelector('.rx-kit', {state: 'visible'});
  await sleep(2500);
  await shot(page, `${prefix}01-camp-kits`);
  await page.click('.rx-kit >> nth=1');
  await sleep(400);
  await page.click('.rx-foot .rx-go');
  let r = await until(page, r => r.stage === 'route', 'route');
  await sleep(600);
  await shot(page, `${prefix}02-route-map`);
  // Pick the middle destination through the UI.
  const choice = r.nodes.find(n => n.tier === 0 && n.kind !== 'shrine') || r.nodes[0];
  await page.click(`.rx-node[aria-label^="${choice.kind === 'treasure' ? 'Star Shards' : choice.kind === 'hold' ? 'Hold the Ward' : choice.kind[0].toUpperCase() + choice.kind.slice(1)}"]`).catch(async () => { await cmd(page, 'route', {node: choice.id}); });
  await sleep(300);
  await shot(page, `${prefix}03-route-detail`);
  if ((await run(page)).stage === 'route') { const go = await page.$('.rx-detail .rx-go'); if (go) await go.click(); else await cmd(page, 'route', {node: choice.id}); }
  r = await until(page, r => r.stage === 'travel', 'travel');
  const target = r.nodes.find(n => n.id === r.target);
  await approach(page, target, 20); await sleep(2500);
  await shot(page, `${prefix}04-travel-beacon`);
  await approach(page, target, 2); r = await until(page, r => r.stage === 'fight' || r.stage === 'reward', 'fight');
  await sleep(target.kind === 'skirmish' || target.kind === 'elite' ? 4500 : 2500);
  await approach(page, target, 9); await sleep(800);
  await shot(page, `${prefix}05-fight`);
  await clearFoes(page); await approach(page, target, 1);
  r = await until(page, r => r.stage === 'reward', 'reward');
  await sleep(900);
  await shot(page, `${prefix}06-upgrade-cards`);
  await page.click('.rx-boon >> nth=0');
  r = await until(page, r => r.stage === 'decide', 'decide');
  await sleep(500);
  await shot(page, `${prefix}07-return-or-push`);
  await page.click('.rx-push');
  // Fast-forward through the remaining tiers.
  for (let guard = 0; guard < 30; guard++) {
    r = await run(page);
    if (['won', 'returned', 'fallen'].includes(r.stage)) break;
    if (r.stage === 'route') { const choices = r.at ? r.nodes.find(n => n.id === r.at).next : r.nodes.filter(n => n.tier === 0).map(n => n.id); await cmd(page, 'route', {node: choices[0]}); await sleep(300); continue; }
    if (r.stage === 'travel') {
      const n = r.nodes.find(q => q.id === r.target);
      if (n.kind === 'heart') {
        await approach(page, n, 2); await until(page, r => r.stage === 'fight', 'heart fight');
        await sleep(7000); // the colossus unfurls from its meteor
        await approach(page, n, 13); await sleep(1200);
        await shot(page, `${prefix}08-heart-guardian`);
        await host(page, function () { const b = st.enemies.find(e => e.boss); if (b) b.hp = Math.round(b.hp * .4); });
        await sleep(600); await shot(page, `${prefix}09-heart-strip`);
      } else { await approach(page, n, 2); await until(page, r => r.stage !== 'travel', 'arrive'); }
      continue;
    }
    if (r.stage === 'fight') { await clearFoes(page); const n = r.nodes.find(q => q.id === r.target); await approach(page, n, 1); await sleep(400); continue; }
    if (r.stage === 'reward') { const offer = r.offers[await page.evaluate(() => window.__qaRun.playerId())]; await cmd(page, 'boon', {boon: offer[0]}); await sleep(300); continue; }
    if (r.stage === 'decide') { await cmd(page, 'decide', {choice: 'push'}); await sleep(300); continue; }
    await sleep(200);
  }
  r = await until(page, r => r.stage === 'won', 'won', 30000);
  await sleep(1200);
  await shot(page, `${prefix}10-victory`);
  await page.click('.rx-foot >> text=Hall of Embers');
  await sleep(500);
  await shot(page, `${prefix}11-hall-of-embers`);
  return r;
}

const runs = [];
try {
  {
    const {browser, page} = await launch({viewport: {width: 1440, height: 900}});
    try { runs.push(await play(page, 'desktop-')); } finally { await browser.close(); }
  }
  {
    const {browser, page} = await launch({viewport: {width: 390, height: 844}, touch: true, deviceScaleFactor: 2});
    try { runs.push(await play(page, 'phone-', {phone: true})); } finally { await browser.close(); }
  }
  record('expedition-run', 'pass', {banked: runs.map(r => r.result.banked)});
} catch (error) { record('expedition-run', 'fail', {error: String(error?.stack || error)}); process.exitCode = 1; }
save('expedition-run');
