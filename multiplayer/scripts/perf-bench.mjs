// Repeatable frame-rate benchmark: average FPS, 1% and 0.1% lows, main-thread frame CPU, GC churn and GL work.
// Usage: node scripts/perf-bench.mjs --scene valley|wilds --device desktop|phone [--seconds 20] [--gl] [--profile out.cpuprofile]
// Needs a served production build (npx vite preview --port 5188). Solo world only: no room service, no public rooms.
// The camera flies a fixed scripted path (the ?acceptanceProbe shot camera), so every run sees the same frames.
// On a software rasteriser (cloud/CI) the frame interval is the rasteriser's speed; the main-thread CPU numbers are the
// real browser work and carry over to real hardware. Run it on a real GPU for true FPS.
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : (process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? true : process.argv[i + 1]); };
const scene = arg('scene', 'valley'), device = arg('device', 'desktop'), seconds = +arg('seconds', 20), gl = !!arg('gl', false);
const base = arg('base', process.env.ACCEPT_BASE || 'http://127.0.0.1:5188'), profile = arg('profile', null), extra = arg('query', '');
const headed = !!arg('headed', false), chrome = arg('chrome', process.env.PW_CHROME || null), label = arg('label', `${scene}-${device}`);
const phone = device === 'phone', viewport = arg('viewport', null);
const [vw, vh] = viewport ? String(viewport).split('x').map(Number) : phone ? [844, 390] : [1280, 720];
const gpuArgs = arg('gpu', false) ? ['--use-angle=' + (process.platform === 'win32' ? 'd3d11' : 'gl'), '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader'];

const browser = await pw.chromium.launch({headless: !headed, ...(chrome ? {executablePath: chrome} : {}),
  args: [...gpuArgs, '--disable-features=WebXR', '--enable-precise-memory-info', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--js-flags=--expose-gc']});
const context = await browser.newContext(phone ? {viewport: {width: vw, height: vh}, hasTouch: true, isMobile: true, deviceScaleFactor: 2} : {viewport: {width: vw, height: vh}});
await context.addInitScript(() => { window.__brannQuietTurnPrompt = true; Object.defineProperty(navigator, 'xr', {value: undefined, configurable: true}); });
await context.addInitScript(({gl}) => {
  // Per-frame main-thread time: wrap every animation-frame callback (three.js drives its loop through this).
  const frames = window.__benchFrames = {on: false, t: [], cpu: [], heap: [], gl: []};
  const raf = window.requestAnimationFrame.bind(window);
  let frameCpu = 0, lastStamp = -1;
  window.requestAnimationFrame = cb => raf(ts => { const a = performance.now(); try { cb(ts); } finally { if (ts !== lastStamp) { lastStamp = ts; } frameCpu += performance.now() - a; } });
  const counters = window.__benchGl = {verts: 0, draw: 0, instanced: 0, program: 0, texture: 0, upload: 0, uploadBytes: 0, texUpload: 0, compile: 0, link: 0, sync: 0, uniform: 0, fbo: 0};
  if (gl) for (const proto of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype]) {
    const wrap = (name, fn) => { const o = proto[name]; if (o) proto[name] = function (...a) { fn(a); return o.apply(this, a); }; };
    wrap('drawArrays', a => { counters.draw++; counters.verts += a[2]; }); wrap('drawElements', a => { counters.draw++; counters.verts += a[1]; });
    wrap('drawArraysInstanced', a => { counters.draw++; counters.instanced++; counters.verts += a[2] * a[3]; }); wrap('drawElementsInstanced', a => { counters.draw++; counters.instanced++; counters.verts += a[1] * a[4]; });
    wrap('useProgram', () => counters.program++); wrap('bindTexture', () => counters.texture++); wrap('bindFramebuffer', () => counters.fbo++);
    for (const n of ['bufferData', 'bufferSubData']) wrap(n, a => { counters.upload++; const d = a[1]; counters.uploadBytes += typeof d === 'number' ? d : d?.byteLength || 0; });
    for (const n of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'compressedTexImage2D', 'compressedTexSubImage2D', 'texStorage2D', 'texStorage3D', 'generateMipmap']) wrap(n, () => counters.texUpload++);
    wrap('compileShader', () => counters.compile++); wrap('linkProgram', () => counters.link++);
    for (const n of ['getError', 'readPixels', 'getProgramParameter', 'getShaderParameter', 'getProgramInfoLog', 'getShaderInfoLog', 'finish', 'getParameter', 'clientWaitSync']) wrap(n, () => counters.sync++);
    for (const n of Object.getOwnPropertyNames(proto)) if (/^uniform/.test(n)) wrap(n, () => counters.uniform++);
  }
  let prev = {...counters};
  const tick = ts => {
    if (frames.on) {
      frames.t.push(ts); frames.cpu.push(frameCpu); frames.heap.push(performance.memory?.usedJSHeapSize || 0);
      if (gl) { const d = {}; for (const k in counters) d[k] = counters[k] - prev[k]; frames.gl.push(d); }
    }
    prev = {...counters}; frameCpu = 0;
    raf(tick);
  };
  raf(tick);
}, {gl});
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

const query = scene === 'wilds' ? '&world=wilds&seed=bench-heron-417&preset=continent' : '';
const loadAt = Date.now();
await page.goto(`${base}/?acceptanceProbe${query}${extra}`, {waitUntil: 'domcontentloaded'});
await page.waitForFunction(() => window.brannHarness?.state().rendererReady, null, {timeout: 180000});
await page.evaluate(() => { const n = document.getElementById('name'); if (n) n.value = 'Bench'; document.getElementById('solo').click(); });
await page.waitForFunction(() => window.brannHarness?.state().phase === 'game' && window.brannHarness.state().snapshots > 5 && document.querySelector('#world').brannDiagnostics()?.startup?.ready, null, {timeout: 240000});
const loadSeconds = (Date.now() - loadAt) / 1000;
// Close any overlay (What's new, guides) so the HUD state is the same every run.
await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
await page.keyboard.press('Escape').catch(() => {});

// Fixed camera path: a slow 360° look-around at the spawn, then a long glide forward and a climb for an overview.
const path = await page.evaluate(() => { const s = window.brannHarness.snapshot(), id = window.brannHarness.state().playerId, me = s.players.find(p => p.id === id); return me?.position || [0, 0, 0]; });
if (!arg('shots', null) && !arg('nopath', false)) await page.evaluate(({path, seconds}) => {
  const [x0, y0, z0] = path, T = seconds * 1000; let start = null;
  const step = ts => {
    start ??= ts; const k = Math.min(1, (ts - start) / T);
    // 0-40%: turn on the spot; 40-80%: glide 90 m forward; 80-100%: rise to a 35 m overview while turning.
    const turn = k < .4 ? (k / .4) * Math.PI * 2 : Math.PI * 2 + (k - .4) * 2;
    const glide = k < .4 ? 0 : Math.min(1, (k - .4) / .4) * 90, rise = k < .8 ? 0 : (k - .8) / .2 * 35;
    const yaw = turn, fx = -Math.sin(Math.PI * .25) * glide, fz = -Math.cos(Math.PI * .25) * glide;
    window.__brannShotCam = [x0 + fx, y0 + 1.65 + rise, z0 + fz, yaw, -.08 - rise / 120];
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}, {path, seconds: seconds + 3});
const shots = arg('shots', null);
if (shots) { // fixed views for before/after visual comparison, then exit
  const {mkdirSync} = await import('node:fs'); mkdirSync(shots, {recursive: true});
  const views = [[0, 1.65, 0, 0, -.08], [0, 1.65, 0, Math.PI * .75, -.08], [0, 1.65, 0, Math.PI * 1.5, -.08], [0, 36, 0, Math.PI * .25, -.35]];
  for (let i = 0; i < views.length; i++) { const v = views[i].slice(); v[0] += 4; v[1] += +arg('shotY', path[1]); v[2] += 12;
    await page.evaluate(v => { window.__brannShotCam = v; }, v); await page.waitForTimeout(+arg('shotWait', 4000)); await page.screenshot({path: `${shots}/${label}-${i}.png`}); }
  await browser.close(); process.exit(0);
}
const breakdown = arg('breakdown', null);
if (breakdown) { await page.waitForTimeout(2500); const {readFileSync} = await import('node:fs'); writeFileSync(arg("breakdownOut","/tmp/bench/breakdown.json"), JSON.stringify(await page.evaluate(readFileSync(breakdown, "utf8")))); }
await page.waitForTimeout(2500); // warm-up: first seconds of the path are not scored
const heap = arg('heap', null), trace = arg('trace', null);
if (trace) { const cdp = await context.newCDPSession(page); page.__trace = {cdp, chunks: []}; cdp.on('Tracing.dataCollected', e => page.__trace.chunks.push(...e.value));
  await cdp.send('Tracing.start', {transferMode: 'ReportEvents', traceConfig: {includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8', 'v8.execute', 'blink.user_timing', 'gpu', 'toplevel', 'disabled-by-default-devtools.timeline.frame', ...(arg('invalidations', null) ? ['disabled-by-default-devtools.timeline.invalidationTracking', 'disabled-by-default-devtools.timeline.stack'] : [])]}}); }
if (heap) { const cdp = await context.newCDPSession(page); await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.startSampling', {samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true}); page.__heap = cdp; }
if (profile) { const cdp = await context.newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', {interval: 200}); await cdp.send('Profiler.start'); page.__cdp = cdp; }
await page.evaluate(() => { const r = globalThis.__brannDebug?.renderer; window.__benchPrograms = new Set(r ? r.info.programs : []); });
await page.evaluate(() => { const f = window.__benchFrames; f.t.length = f.cpu.length = f.heap.length = f.gl.length = 0; f.on = true; });
await page.waitForTimeout(seconds * 1000);
const raw = await page.evaluate(() => { const f = window.__benchFrames; f.on = false; return {t: f.t, cpu: f.cpu, heap: f.heap, gl: f.gl}; });
if (trace) { const done = new Promise(r => page.__trace.cdp.once('Tracing.tracingComplete', r)); await page.__trace.cdp.send('Tracing.end'); await done; writeFileSync(trace, JSON.stringify({traceEvents: page.__trace.chunks})); }
if (heap) { const {profile: h} = await page.__heap.send('HeapProfiler.stopSampling'); writeFileSync(heap, JSON.stringify(h)); }
if (profile) { const {profile: p} = await page.__cdp.send('Profiler.stop'); writeFileSync(profile, JSON.stringify(p)); }
const newPrograms = await page.evaluate(() => { const r = globalThis.__brannDebug?.renderer; if (!r) return []; return r.info.programs.filter(p => !window.__benchPrograms.has(p)).map(p => p.name + ' :: ' + p.cacheKey.slice(0, 160)); });
const diagnostics = await page.evaluate(() => { const d = document.querySelector('#world').brannDiagnostics(); const c = document.createElement('canvas').getContext('webgl2'), x = c?.getExtension('WEBGL_debug_renderer_info');
  return {graphics: d.graphics, programs: d.programs, compileGate: d.compileGate, lights: d.lights, cpuTimings: d.cpuTimings, gpu: x ? c.getParameter(x.UNMASKED_RENDERER_WEBGL) : 'unknown'}; });
await browser.close();

// Frame interval stats. "1% low" = average FPS of the slowest 1% of frames (the common benchmark definition).
const intervals = raw.t.slice(1).map((t, i) => t - raw.t[i]);
const sorted = [...intervals].sort((a, b) => b - a), n = intervals.length, total = intervals.reduce((a, b) => a + b, 0);
const low = p => { const k = Math.max(1, Math.round(n * p)); const s = sorted.slice(0, k); return 1000 / (s.reduce((a, b) => a + b, 0) / k); };
const cpuSorted = [...raw.cpu.slice(1)].sort((a, b) => a - b), q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))] ?? 0;
let allocated = 0, gcs = 0; for (let i = 1; i < raw.heap.length; i++) { const d = raw.heap[i] - raw.heap[i - 1]; if (d > 0) allocated += d; else if (d < -256 * 1024) gcs++; }
const out = {label, scene, device, seconds, loadSeconds: +loadSeconds.toFixed(1), frames: n,
  avgFps: +(1000 * n / total).toFixed(1), low1Fps: +low(.01).toFixed(1), low01Fps: +low(.001).toFixed(1), worstMs: +sorted[0].toFixed(1),
  hitchesOver50ms: intervals.filter(v => v > 50).length, hitchesOver100ms: intervals.filter(v => v > 100).length,
  cpu: {avgMs: +(cpuSorted.reduce((a, b) => a + b, 0) / cpuSorted.length).toFixed(2), p50Ms: +q(cpuSorted, .5).toFixed(2), p99Ms: +q(cpuSorted, .99).toFixed(2), p999Ms: +q(cpuSorted, .999).toFixed(2), maxMs: +cpuSorted.at(-1).toFixed(1)},
  cpuBoundFps: +(1000 / (cpuSorted.reduce((a, b) => a + b, 0) / cpuSorted.length)).toFixed(1),
  allocMBps: +(allocated / 1048576 / seconds).toFixed(2), majorHeapDrops: gcs, gpu: diagnostics.gpu, buffer: diagnostics.graphics, programs: diagnostics.programs, compileGate: diagnostics.compileGate, errors: errors.slice(0, 5), newPrograms};
if (gl && raw.gl.length) { const sum = {}; for (const f of raw.gl) for (const k in f) sum[k] = (sum[k] || 0) + f[k]; out.glPerFrame = Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, +(v / raw.gl.length).toFixed(1)])); out.glMidPlay = {compile: sum.compile, link: sum.link, texUpload: sum.texUpload}; }
console.log(JSON.stringify(out));
const file = arg('out', null); if (file) writeFileSync(file, JSON.stringify({...out, intervals, cpu: raw.cpu}, null, 0));
