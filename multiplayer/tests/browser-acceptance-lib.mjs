// Shared helpers for the local browser acceptance harness. Read-only probe (?acceptanceProbe); all game effects come from
// real Playwright mouse/keyboard/touch input. Uses the locally cached Playwright library and the installed Chromium build.
import {createRequire} from 'node:module';
import {mkdirSync, writeFileSync, appendFileSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const here = process.env.BROWSER_QA_DIR || fileURLToPath(new URL('../../logs/browser-acceptance/', import.meta.url));
mkdirSync(here,{recursive:true});
const PW = process.env.PW_CORE || 'playwright-core';
const CHROME = process.env.PW_CHROME;
export const {chromium} = createRequire(import.meta.url)(PW);
export const BASE = process.env.ACCEPT_BASE || 'http://127.0.0.1:5188';
export const CAPTURES = join(here, 'captures'); mkdirSync(CAPTURES, {recursive: true});
const T0 = performance.now();
export const ms = () => +(performance.now() - T0).toFixed(1);
export const results = [];
export function record(id, status, detail = {}) { const r = {...detail, id, status, atMs: ms()}; results.push(r); console.log(JSON.stringify(r)); return r; }
export function save(name) { writeFileSync(join(here, `${name}-results.json`), JSON.stringify({harness: name, monotonicMs: ms(), results}, null, 2)); }
export const sleep = t => new Promise(r => setTimeout(r, t));

export async function launch({viewport = {width: 1280, height: 720}, headless = process.env.HEADED ? false : true, touch = false} = {}) {
  if (CHROME && !existsSync(CHROME)) throw Error(`Chromium not found at ${CHROME}`);
  // Desktop acceptance must not probe OpenXR and wake a connected headset runtime.
  // Physical XR acceptance is a separate, deliberate opt-in.
  const xr = process.env.BROWSER_QA_XR === '1';
  const browser = await chromium.launch({...(CHROME?{executablePath:CHROME}:{}), headless, args: ['--enable-unsafe-swiftshader', ...(!xr ? ['--disable-features=WebXR'] : [])]});
  const context = await browser.newContext({viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1});
  if (!xr) await context.addInitScript(() => Object.defineProperty(navigator, 'xr', {value: undefined, configurable: true}));
  const page = await context.newPage();
  const log = join(here, 'logs', 'browser-console.log'); mkdirSync(dirname(log), {recursive: true});
  page.errors = []; page.missing = [];
  // Console 404 lines carry no URL; attribute them via responses and ignore only the known missing /favicon.ico.
  page.on('response', r => { if (r.status() >= 400) { page.missing.push(`${r.status()} ${r.url()}`); appendFileSync(log, `${ms()} http ${r.status()} ${r.url()}\n`); if (!/\/favicon\.ico$/.test(r.url())) page.errors.push(`HTTP ${r.status()} ${r.url()}`); } });
  page.on('console', m => { appendFileSync(log, `${ms()} ${m.type()} ${m.text()}\n`); if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  page.on('pageerror', e => { appendFileSync(log, `${ms()} pageerror ${e.message}\n`); page.errors.push(e.message); });
  return {browser, context, page};
}

export async function enterWorld(page, {role = 'hero', name = 'Acceptance', query = ''} = {}) {
  await page.goto(`${BASE}/?acceptanceProbe${query}`, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => window.brannHarness, null, {timeout: 20000});
  await page.fill('#name', name);
  await page.check(`input[name="role"][value="${role}"]`, {force: true});
  await page.click('#create');
  await page.waitForFunction(r => { const p = window.brannHarness; const s = p.snapshot(); return s && s.players.some(x => x.id === p.state().playerId && x.role === r); }, role, {timeout: 30000});
  await sleep(800);
}
export const snap = page => page.evaluate(() => window.brannHarness.snapshot());
export const ctl = page => page.evaluate(() => window.brannHarness.controls());
export const me = async page => { const [s, id] = await page.evaluate(() => [window.brannHarness.snapshot(), window.brannHarness.state().playerId]); return {s, self: s.players.find(p => p.id === id), id}; };
export async function shot(page, name) { const file = join(CAPTURES, `${name}.png`); await page.screenshot({path: file}); return `captures/${name}.png`; }

// Quiet mobile HUD: open the palette before choosing; selecting closes it again.
export async function chooseTouchSpell(page,id){
 if(await page.locator('body').getAttribute('data-mq-tray')!=='spells')await page.locator('[data-spell][aria-checked="true"]').tap();
 await page.locator('[data-spell="'+id+'"]').tap();
}
export async function chooseTouchWeapon(page,id){
 if(await page.locator('body').getAttribute('data-mq-tray')!=='weapons')await page.locator('[data-equip][aria-pressed="true"]').tap();
 await page.locator('[data-equip="'+id+'"]').tap();
}
