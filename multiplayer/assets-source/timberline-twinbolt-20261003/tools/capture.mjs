// Capture review renders from the real Three.js preview in headless Chromium.
// Serves this asset folder and three@0.186.1 (from multiplayer/node_modules)
// through Playwright request routing: no server, no network.
//
//   node tools/capture.mjs stills  [outDir]
//   node tools/capture.mjs fire    [outDir]   (frame sequence -> GIF/WebP via tools/assemble.py)
//   node tools/capture.mjs distance [outDir]
//   node tools/capture.mjs all     [outDir]
//
// PLAYWRIGHT: resolved from the global npm root unless PLAYWRIGHT_MODULE is set.
import {createRequire} from 'node:module';
import {readFileSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {join, dirname, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execSync} from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const threeRoot = join(root, '../../node_modules/three');
const pwPath = process.env.PLAYWRIGHT_MODULE || join(execSync('npm root -g').toString().trim(), 'playwright');
const {chromium} = createRequire(import.meta.url)(pwPath);
const mode = process.argv[2] || 'stills';
const outDir = process.argv[3] || join(root, 'renders');
mkdirSync(outDir, {recursive: true});
const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg'};

async function open(w = 1600, h = 1100, query = '') {
  const browser = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
  const page = await browser.newPage({viewport: {width: w, height: h}});
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    let file = null;
    if (url.host === 'cdn.jsdelivr.net') {
      const m = url.pathname.match(/three@[^/]+\/(.*)$/);
      if (m) file = join(threeRoot, m[1]);
    } else if (url.host === 'tl.local') {
      file = join(root, decodeURIComponent(url.pathname));
    }
    if (!file || !existsSync(file)) return route.fulfill({status: 404, body: 'nf'});
    return route.fulfill({status: 200, body: readFileSync(file), headers: {'content-type': MIME[extname(file)] || 'application/octet-stream'}});
  });
  await page.goto(`http://tl.local/preview/index.html?capture=1${query}`);
  await page.waitForFunction(() => window.__tl?.ready, null, {timeout: 120000});
  return {browser, page};
}

async function shot(page, file, settle = 0) {
  await page.evaluate((n) => { for (let i = 0; i < n; i++) window.__tl.step(1 / 60); window.__tl.render(); }, settle);
  const el = await page.$('canvas');
  await el.screenshot({path: file});
}

async function stills() {
  const {browser, page} = await open(1600, 1100, '&bg=studio');
  const t0 = Date.now();
  await page.evaluate(() => { window.__tl.trees.forEach((t) => { t.root.visible = false; }); window.__tl.setAim(0, 4); });
  for (const v of ['threequarter', 'front', 'side', 'top', 'back']) {
    await page.evaluate((v) => window.__tl.setView(v), v);
    await shot(page, join(outDir, `still_${v}_loaded.png`), 30);
  }
  // Unloaded state for comparison (fire, let the clip finish, hold the empty pose).
  await page.evaluate(() => { window.__tl.setAutoReload(false); window.__tl.fire(); for (let i = 0; i < 70; i++) window.__tl.step(1 / 60); });
  for (const v of ['threequarter', 'side']) {
    await page.evaluate((v) => window.__tl.setView(v), v);
    await shot(page, join(outDir, `still_${v}_unloaded.png`), 120);
  }
  // Elevated and traversed.
  await page.evaluate(() => { window.__tl.tb.setLoadedImmediate(); window.__tl.setAim(-35, 22); window.__tl.setView('threequarter'); });
  await shot(page, join(outDir, 'still_aim_traverse_elevate.png'), 30);
  const info = await page.evaluate(() => window.__tl.info());
  writeFileSync(join(outDir, 'renderer_info.json'), JSON.stringify(info, null, 1));
  console.log('stills', (Date.now() - t0) / 1000, 's', info);
  await browser.close();
}

async function distance() {
  const {browser, page} = await open(1600, 900, '');
  await page.evaluate(() => { window.__tl.setAim(0, 4); window.__tl.setAutoReload(true); });
  for (const v of ['operator', 'mid', 'rts']) {
    await page.evaluate((v) => window.__tl.setView(v), v);
    await shot(page, join(outDir, `dist_${v}_loaded.png`), 20);
  }
  // Mid-flight, at the moment the filament is taut, from each distance.
  for (const v of ['operator', 'mid', 'rts', 'chase']) {
    await page.evaluate((v) => { const tl = window.__tl; tl.resetTrees(); tl.clearVolleys(); tl.trees.forEach((t) => { t.root.visible = false; }); tl.tb.setLoadedImmediate(); tl.setView(v); tl.fire(); }, v);
    // release at 0.05 s; taut at +0.26 s; capture just after taut.
    await shot(page, join(outDir, `dist_${v}_flight.png`), Math.round((0.05 + 0.30) * 60));
    await page.evaluate(() => { for (let i = 0; i < 300; i++) window.__tl.step(1 / 60); });
  }
  await browser.close();
}

async function fire() {
  const {browser, page} = await open(960, 600, '');
  const seqDir = join(outDir, 'seq_fire');
  mkdirSync(seqDir, {recursive: true});
  // Three passes: machine close-up (slow), chase on the bolts (slow), wide shot to the tree (real time).
  const passes = [
    {name: 'machine', view: [[-1.7, 1.45, -2.1], [0, 1.1, -0.7], 40], dt: 1 / 240, frames: 96, pre: 0},
    {name: 'flight', view: 'chase', dt: 1 / 120, frames: 110, pre: 0},
    {name: 'wide', view: [[-6.5, 2.6, -14], [0, 1.0, -25], 55], dt: 1 / 60, frames: 90, pre: 0},
    {name: 'reload', view: [[1.9, 2.1, 2.3], [0, 1.0, -0.2], 40], dt: 1 / 30, frames: 120, pre: 0},
  ];
  let n = 0;
  for (const p of passes) {
    await page.evaluate((p) => {
      const tl = window.__tl;
      tl.resetTrees();
      tl.clearVolleys();
      tl.tb.setLoadedImmediate();
      tl.setAutoReload(true);
      tl.setAim(0, 1.5);
      if (typeof p.view === 'string') tl.setView(p.view); else tl.setCamera(...p.view);
      for (let i = 0; i < 20; i++) tl.step(1 / 60);
      if (p.name !== 'reload') tl.fire();
      else { tl.fire(); for (let i = 0; i < 46; i++) tl.step(1 / 60); }
    }, p);
    for (let f = 0; f < p.frames; f++) {
      await page.evaluate((dt) => { window.__tl.step(dt); window.__tl.render(); }, p.dt);
      const el = await page.$('canvas');
      await el.screenshot({path: join(seqDir, `${p.name}_${String(f).padStart(3, '0')}.png`)});
      n++;
    }
  }
  console.log('fire frames', n);
  await browser.close();
}

if (mode === 'stills' || mode === 'all') await stills();
if (mode === 'distance' || mode === 'all') await distance();
if (mode === 'fire' || mode === 'all') await fire();
