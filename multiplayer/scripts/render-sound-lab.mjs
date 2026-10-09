// Renders every cue in tests/sound-lab.html offline in headless Chromium and prints peak / loudness per cue, so levels
// can be balanced without ears. With --wav <dir>, also writes one WAV per cue for listening on any device.
//   node scripts/render-sound-lab.mjs [--wav out/dir]
// Needs Playwright (PW_CORE=playwright or playwright-core resolvable) and a Chromium (PW_CHROME or Playwright's own).
import {createRequire} from 'node:module';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createServer} from 'vite';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PW_CORE || 'playwright');
const wavDir = process.argv.includes('--wav') ? process.argv[process.argv.indexOf('--wav') + 1] : null;

const server = await createServer({root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: {port: 5199, host: '127.0.0.1'}});
await server.listen();
const browser = await chromium.launch({...(process.env.PW_CHROME ? {executablePath: process.env.PW_CHROME} : {}), args: ['--autoplay-policy=no-user-gesture-required']});
try {
  const page = await browser.newPage();
  page.on('pageerror', e => { console.error('page error:', e.message); process.exitCode = 1; });
  await page.goto('http://127.0.0.1:5199/tests/sound-lab.html');
  await page.waitForFunction(() => window.soundLabReady, null, {timeout: 30000});
  const results = await page.evaluate(o => window.renderAll(o), {withWav: !!wavDir});
  if (wavDir) mkdirSync(wavDir, {recursive: true});
  let bad = 0;
  for (const r of results) {
    const flag = r.peak >= .99 ? 'CLIPS' : r.loud < .002 ? 'SILENT' : '';
    if (flag) bad++;
    console.log(`${r.group.padEnd(24)} ${r.label.padEnd(22)} peak ${r.peak.toFixed(3)}  loud ${r.loud.toFixed(4)}  ${flag}`);
    if (wavDir) writeFileSync(join(wavDir, `${r.group.replace(/[^a-z]+/gi, '-').toLowerCase()}--${r.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.wav`), Buffer.from(r.wav, 'base64'));
  }
  console.log(`${results.length} cues, ${bad} clipping or silent`);
  if (bad) process.exitCode = 1;
} finally { await browser.close(); await server.close(); }
