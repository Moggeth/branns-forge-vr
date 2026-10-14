import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createSunbeams} from '../client/sunbeams.js';
import {worldClock, weatherAt, dayPhase, nightAmount, solarAngle, lightningAt, DAY_TICKS, WEATHER_TICKS, DAYLIGHT_SHARE} from '../shared/world-clock.js';
import {createDayNightWeather, previewFromUrl} from '../client/day-night-weather.js';

// Clock: deterministic from tick + seed, so every client in a room agrees without extra network state.
assert.deepEqual(worldClock(123456, 7), worldClock(123456, 7));
assert.ok(Math.abs(dayPhase(0) - dayPhase(DAY_TICKS)) < 1e-9, 'cycle wraps');
assert.ok(nightAmount(dayPhase(0)) === 0, 'fresh rooms open in daylight');
assert.ok(nightAmount((DAYLIGHT_SHARE + 1) / 2) > .99, 'mid-night is fully night');
assert.ok(nightAmount(DAYLIGHT_SHARE / 2) === 0, 'noon is fully day');
let prev = solarAngle(0);
for (let p = .001; p < 1; p += .001) { const s = solarAngle(p); assert.ok(s > prev && s - prev < .02, 'solar angle is continuous'); prev = s; }
const night = [...Array(DAY_TICKS / 600)].filter((_, i) => nightAmount(dayPhase(i * 600)) > .5).length / (DAY_TICKS / 600);
assert.ok(night > .25 && night < .4, `night share ${night}`);

// Weather: first front is always clear; weights sum to 1; fronts blend instead of popping.
for (const seed of [1, 41, 999]) {
  assert.equal(weatherAt(WEATHER_TICKS / 2, seed).kind, 'clear');
  for (let t = 0; t < WEATHER_TICKS * 40; t += 997) {
    const w = weatherAt(t, seed).weights, a = weatherAt(t + 1, seed).weights;
    assert.ok(Math.abs(Object.values(w).reduce((x, y) => x + y) - 1) < 1e-9);
    for (const k in w) assert.ok(Math.abs(w[k] - a[k]) < .01, 'no popping between ticks');
  }
}
const kinds = new Set(); for (let i = 1; i < 300; i++) kinds.add(weatherAt(i * WEATHER_TICKS + WEATHER_TICKS / 2, 41).kind);
assert.deepEqual([...kinds].sort(), ['clear', 'fog', 'rain', 'snow', 'storm']);
// Authoritative override (future God weather) wins while active, then fades out.
const o = {kind: 'rain', startTick: 1000, untilTick: 5000, strength: 1};
assert.equal(weatherAt(3000, 41, o).kind, 'rain'); assert.ok(weatherAt(3000, 41, o).weights.rain > .99);
assert.equal(weatherAt(5000 + 60 * 60, 41, o).override, false);
// Lightning only in storms and identical for everyone.
for (let t = 0; t < 20000; t += 7) assert.equal(lightningAt(t, 41, 0), 0);
let strikes = 0; for (let t = 0; t < 60 * 600; t++) if (lightningAt(t, 41, 1) === 1 && lightningAt(t - 1, 41, 1) !== 1) strikes++;
assert.ok(strikes > 10 && strikes < 80, `storm strikes in 10 min: ${strikes}`);

// URL preview parsing.
assert.deepEqual(previewFromUrl('?sky=night&weather=snow'), {phase: .83, weather: 'snow'});
assert.equal(previewFromUrl('?foo=1'), null);
assert.equal(previewFromUrl('?weather=lava'), null);

// Presentation: drives the existing sun/hemisphere through orchard.applyEnvironment, adds only 3 cheap draws.
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
let env = null; const orchard = {applyEnvironment: e => { env = structuredClone({sunI: e.sunI, hemiI: e.hemiI, exposure: e.exposure, night: e.night, fogScale: e.fogScale, overcast: e.overcast, sunY: e.sunDir.y, haze: e.haze.getHSL({})}); }};
const before = scene.children.length;
const sky = createDayNightWeather({scene, orchard, quality: 'low', preview: null});
assert.equal(scene.children.length - before, 3);
assert.equal(scene.children.filter(o => o.isLight).length, 0, 'no lights added');
const at = phase => Math.round(((phase - .06 + 1) % 1) * DAY_TICKS);
sky.update({tick: at(DAYLIGHT_SHARE / 2), seed: 41, time: 1, camera}); const noon = env;
sky.update({tick: at((DAYLIGHT_SHARE + 1) / 2), seed: 41, time: 1, camera}); const mid = env;
assert.ok(noon.sunI > 2 && noon.night === 0 && noon.sunY > .5);
assert.ok(mid.night > .99 && mid.sunI < .8 && mid.sunY > .3, 'moonlight from above at night');
assert.ok(mid.haze.l < noon.haze.l * .3, 'night haze is dark');
assert.ok(mid.exposure > noon.exposure, 'night exposure lifts emissive glow');
assert.ok(scene.getObjectByName('night-motes').visible && !scene.getObjectByName('weather-rain').visible);
const forced = createDayNightWeather({scene, orchard, quality: 'high', preview: {phase: .3, weather: 'rain'}});
forced.update({tick: 0, seed: 41, time: 2, camera});
assert.ok(env.overcast > .7 && env.fogScale < .7);
const st = forced.stats(); assert.equal(st.weather, 'rain'); assert.ok(st.rain > 1000 && st.rain <= 1600 && st.snow === 0);
const fog = createDayNightWeather({scene, orchard, quality: 'high', preview: {phase: .3, weather: 'fog'}}); fog.update({tick: 0, camera, time: 0});
assert.ok(env.fogScale < .2);
for (const s of [sky, forced, fog]) s.dispose();
assert.equal(scene.children.length, before);

// Atmosphere: every built-in material gets the shared mist/wet/snow layer without losing its own shader hook.
import('../client/atmosphere-materials.js').then(async ({ATMOSPHERE, adoptAtmosphere, atmosphereStats}) => {
  assert.ok(THREE.ShaderChunk.fog_fragment.includes('BF_ATMOS') && THREE.ShaderChunk.emissivemap_fragment.includes('bfSnow'));
  const plain = new THREE.MeshStandardMaterial(), hooked = new THREE.MeshLambertMaterial();
  let ran = 0; hooked.onBeforeCompile = shader => { ran++; shader.vertexShader = '// mine\n' + shader.vertexShader; };
  const shader = () => ({vertexShader: 'void main(){}', fragmentShader: 'void main(){}', uniforms: {}});
  const a = shader(); plain.onBeforeCompile(a); assert.ok(a.fragmentShader.startsWith('#define BF_ATMOS') && a.uniforms.bfMist === ATMOSPHERE.bfMist);
  const b = shader(); hooked.onBeforeCompile(b); assert.equal(ran, 1); assert.ok(b.vertexShader.includes('// mine') && b.uniforms.bfWet === ATMOSPHERE.bfWet);
  assert.notEqual(plain.customProgramCacheKey(), hooked.customProgramCacheKey(), 'different hooks never share a program');
  const early = new THREE.MeshPhongMaterial(); Object.defineProperty(early, 'onBeforeCompile', {value: s => { s.mine = true; }, writable: true, configurable: true, enumerable: true});
  const holder = new THREE.Scene(); holder.add(new THREE.Mesh(new THREE.BoxGeometry(), early));
  assert.equal(adoptAtmosphere(holder), 1); const c = shader(); early.onBeforeCompile(c); assert.ok(c.mine && c.uniforms.bfSnow);
  assert.ok(atmosphereStats().installed);

  // Weather drives the surfaces: rain wets the ground over time, snow settles slowly, mist thickens at dawn.
  const height = () => 0, trees = [{id: 't1', x: 6, z: 0, height: 6}, {id: 't2', x: -5, z: 4, height: 7}];
  camera.position.set(0, 1.7, 0); camera.updateMatrixWorld();
  const wetSky = createDayNightWeather({scene, orchard, height, quality: 'high', preview: {phase: .3, weather: 'rain'}});
  wetSky.update({tick: 0, camera, time: 0, dt: 0}); assert.ok(ATMOSPHERE.bfWet.value > .9, 'a preview starts already wet');
  const dawn = createDayNightWeather({scene, orchard, height, quality: 'high', preview: {phase: .015, weather: 'clear'}});
  dawn.setTrees(trees);
  dawn.update({tick: 0, camera, time: 0, dt: 0}); const dawnMist = ATMOSPHERE.bfMist.value;
  for (let i = 1; i < 40; i++) dawn.update({tick: 0, camera, time: i * .5, dt: .5});
  assert.ok(ATMOSPHERE.bfWet.value < .7, 'ground dries once the rain stops');
  const golden = createDayNightWeather({scene, orchard, height, quality: 'high', preview: {phase: .55, weather: 'clear'}});
  golden.setTrees(trees); golden.update({tick: 0, camera, time: 0, dt: 0});
  const beamAxis = golden.stats() && scene.children.filter(o => o.name === 'sunbeams').at(-1).material.uniforms.uAxis.value;
  assert.ok(-beamAxis.y > Math.sin(60 * Math.PI / 180), `low sun still drops shafts steeply: ${beamAxis.y.toFixed(3)}`);
  const gs = golden.stats(); assert.ok(gs.sunbeams.beams === 6 && gs.sunbeams.strength > .3, `golden-hour shafts ${JSON.stringify(gs.sunbeams)}`);
  const noonSky = createDayNightWeather({scene, orchard, height, quality: 'high', preview: {phase: DAYLIGHT_SHARE / 2, weather: 'clear'}});
  noonSky.setTrees(trees); noonSky.update({tick: 0, camera, time: 0, dt: 0});
  assert.ok(dawnMist > ATMOSPHERE.bfMist.value * 2, 'dawn is far mistier than noon');
  assert.ok(noonSky.stats().sunbeams.strength < gs.sunbeams.strength, 'shafts are strongest in low sun');
  const overcast = createDayNightWeather({scene, orchard, height, quality: 'low', preview: {phase: .55, weather: 'storm'}});
  overcast.setTrees(trees); overcast.update({tick: 0, camera, time: 0, dt: 0}); assert.equal(overcast.stats().sunbeams.beams, 0, 'no shafts under storm cloud');
  const snowy = createDayNightWeather({scene, orchard, height, quality: 'high', preview: {phase: .3, weather: 'snow'}});
  snowy.update({tick: 0, camera, time: 0, dt: 0}); assert.ok(ATMOSPHERE.bfSnow.value > .9 && ATMOSPHERE.bfMist.value > dawnMist * .3 && ATMOSPHERE.bfSparkle.value > .4);
  for (const s of [wetSky, dawn, golden, noonSky, overcast, snowy]) s.dispose();
  assert.equal(scene.children.length, before);
  console.log('day-night-weather: ok');
});

// The angle limit must hold beyond golden hour, including a nearly overhead light.
// Normalising only the horizontal components first incorrectly flattens these rays.
{
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.7, 8); camera.updateMatrixWorld();
  const beams = createSunbeams({scene, height: () => 0, quality: 'low'});
  beams.setTrees([{id: 'angle-check', x: 0, z: 0, height: 6}]);
  for (const degrees of [0, 15, 30, 45, 62, 75, 89.9, 90]) {
    const angle = degrees * Math.PI / 180;
    const light = new THREE.Vector3(Math.cos(angle) * .6, Math.sin(angle), Math.cos(angle) * .8);
    beams.update({camera, light, strength: 1, time: degrees});
    const axis = beams.mesh.material.uniforms.uAxis.value;
    assert.ok(-axis.y >= Math.sin(62 * Math.PI / 180) - 1e-9, `shaft too shallow at ${degrees}: ${axis.y}`);
    assert.ok(Math.abs(axis.length() - 1) < 1e-9);
    assert.ok(Math.abs(axis.x * light.z - axis.z * light.x) < 1e-9, 'compass direction is preserved');
  }
  beams.dispose();
}
