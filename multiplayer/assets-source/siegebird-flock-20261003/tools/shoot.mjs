// Screenshot a preview page: node tools/shoot.mjs <page.html?query> <out.png> [width height]
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)(process.env.PW_PATH || '/opt/node22/lib/node_modules/playwright');
const [, , page = 'preview/crossbow.html', out = 'out.png', w = '1200', h = '800'] = process.argv;
const browser = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
const tab = await browser.newPage({viewport: {width: +w, height: +h}});
const errors = [];
tab.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
tab.on('pageerror', e => errors.push(String(e)));
await tab.goto(`http://127.0.0.1:${process.env.PORT || 8823}/assets-source/siegebird-flock-20261003/${page}`);
try { await tab.waitForFunction(() => window.previewReady === true, null, {timeout: 120000}); } catch (e) { console.log("console:", errors.join("\n")); throw e; }
await tab.screenshot({path: out});
if (errors.length) console.log('console:', errors.join('\n'));
await browser.close();
