// Render a reload clip: node tools/clip.mjs "preview/clip.html?view=third" out.mp4 [seconds=1.4] [slow=2] [w h]
// Steps window.frame(t) at 60 Hz of reload time and encodes at 60/slow fps (slow=2 plays at half speed).
import {createRequire} from 'node:module';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const {chromium} = createRequire(import.meta.url)(process.env.PW_PATH || '/opt/node22/lib/node_modules/playwright');
const [, , page, out, seconds = '1.4', slow = '2', w = '960', h = '640'] = process.argv;
const browser = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
const tab = await browser.newPage({viewport: {width: +w, height: +h}});
const errors = []; tab.on('pageerror', e => errors.push(String(e)));
await tab.goto(`http://127.0.0.1:${process.env.PORT || 8823}/assets-source/siegebird-flock-20261003/${page}`);
try { await tab.waitForFunction(() => window.previewReady === true, null, {timeout: 120000}); } catch (e) { console.log(errors.join('\n')); throw e; }
const dir = mkdtempSync(join(tmpdir(), 'clip-')), frames = Math.round(+seconds * 60);
for (let i = 0; i <= frames; i++) { await tab.evaluate(t => window.frame(t), i / 60); await tab.screenshot({path: join(dir, `f${String(i).padStart(4, '0')}.png`)}); }
await browser.close();
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(60 / +slow), '-i', join(dir, 'f%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', out]);
rmSync(dir, {recursive: true});
if (errors.length) console.log(errors.join('\n'));
console.log(`clip: ${frames + 1} frames -> ${out}`);
