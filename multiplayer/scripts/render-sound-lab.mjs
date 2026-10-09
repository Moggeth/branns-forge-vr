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
const arg = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const wavDir = arg('--wav'), reelDir = arg('--reels');
// --reels <dir>: one small mono file per group, cues back to back with short gaps (easy to listen to on a phone).
function reel(clips) {
  const rate = 22050, gap = Math.round(rate * .45), parts = [];
  for (const b64 of clips) {
    const buf = Buffer.from(b64, 'base64'), n = (buf.length - 44) / 4, mono = new Float32Array(Math.floor(n / 2));
    for (let i = 0; i < mono.length; i++) { const a = 44 + i * 8; mono[i] = (buf.readInt16LE(a) + buf.readInt16LE(a + 2) + buf.readInt16LE(a + 4) + buf.readInt16LE(a + 6)) / 4 / 32768; }
    let end = mono.length; while (end > 0 && Math.abs(mono[end - 1]) < .0015) end--;
    parts.push(mono.subarray(0, end), new Float32Array(gap));
  }
  const len = parts.reduce((a, p) => a + p.length, 0), out = Buffer.alloc(44 + len * 2);
  out.write('RIFF', 0); out.writeUInt32LE(36 + len * 2, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(len * 2, 40);
  // One gain for the whole reel (relative levels kept) so it is comfortable on a phone.
  let peak = 1e-4; for (const p of parts) for (const v of p) peak = Math.max(peak, Math.abs(v)); const lift = Math.min(6, .9 / peak);
  let o = 44; for (const p of parts) for (let v of p) { v *= lift; out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), o); o += 2; }
  return out;
}

const server = await createServer({root: new URL('..', import.meta.url).pathname, logLevel: 'error', server: {port: 5199, host: '127.0.0.1'}});
await server.listen();
const browser = await chromium.launch({...(process.env.PW_CHROME ? {executablePath: process.env.PW_CHROME} : {}), args: ['--autoplay-policy=no-user-gesture-required']});
try {
  const page = await browser.newPage();
  page.on('pageerror', e => { console.error('page error:', e.message); process.exitCode = 1; });
  await page.goto('http://127.0.0.1:5199/tests/sound-lab.html');
  await page.waitForFunction(() => window.soundLabReady, null, {timeout: 30000});
  const results = await page.evaluate(o => window.renderAll(o), {withWav: !!(wavDir || reelDir)});
  if (wavDir) mkdirSync(wavDir, {recursive: true});
  let bad = 0;
  for (const r of results) {
    const flag = r.peak >= .99 ? 'CLIPS' : r.loud < .002 ? 'SILENT' : '';
    if (flag) bad++;
    console.log(`${r.group.padEnd(24)} ${r.label.padEnd(22)} peak ${r.peak.toFixed(3)}  loud ${r.loud.toFixed(4)}  ${flag}`);
    if (wavDir) writeFileSync(join(wavDir, `${r.group.replace(/[^a-z]+/gi, '-').toLowerCase()}--${r.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.wav`), Buffer.from(r.wav, 'base64'));
  }
  if (reelDir) { mkdirSync(reelDir, {recursive: true}); for (const group of [...new Set(results.map(r => r.group))]) writeFileSync(join(reelDir, `${group.replace(/[^a-z]+/gi, '-').toLowerCase().replace(/-+$/, '')}.wav`), reel(results.filter(r => r.group === group).map(r => r.wav))); }
  console.log(`${results.length} cues, ${bad} clipping or silent`);
  if (bad) process.exitCode = 1;
} finally { await browser.close(); await server.close(); }
