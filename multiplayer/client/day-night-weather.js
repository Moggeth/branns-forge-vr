// Day/night cycle and weather presentation. Reads the shared world clock (shared/world-clock.js), so every client in
// a room renders the same hour, front and lightning strike from the authoritative tick. Presentation only: no lights
// are added (the existing sun becomes the moon at night); rain, snow and night motes are one draw each, animated
// entirely in the vertex shader around the viewer. Atmosphere (ground mist, sun glow in the haze, wet and snowy
// surfaces) rides every material through client/atmosphere-materials.js; shafts through the trees are one more draw
// (client/sunbeams.js); desktop adds light shafts, glow and a grade (client/atmosphere-post.js).
import * as THREE from 'three';
import {worldClock, solarAngle, nightAmount, DAYLIGHT_SHARE} from '../shared/world-clock.js';
import {ATMOSPHERE, adoptAtmosphere, atmosphereStats} from './atmosphere-materials.js';
import {createAtmospherePost} from './atmosphere-post.js';
import {createSunbeams} from './sunbeams.js';
import {SUNNY, SUNNY_KEYS} from './palette-preview.js';

const C = hex => new THREE.Color(hex);
// Palette keyed on sun elevation (sin of the solar angle). Colours sRGB hex -> linear working space via THREE.Color.
const KEYS = (SUNNY ? SUNNY_KEYS : [
  {e: -1.0, sun: 0x8ea6ff, hemiSky: 0x2c3f72, hemiGround: 0x100f0c, hemiI: .3, zenith: 0x040918, horizon: 0x14224a, haze: 0x0f1932, hill: 0x0a1121, exposure: 1.32, env: .05, cloud: 0x26314f},
  {e: -.32, sun: 0x8ea6ff, hemiSky: 0x2c3f72, hemiGround: 0x100f0c, hemiI: .3, zenith: 0x040918, horizon: 0x14224a, haze: 0x0f1932, hill: 0x0a1121, exposure: 1.32, env: .05, cloud: 0x26314f},
  {e: -.12, sun: 0x96a4e6, hemiSky: 0x46558c, hemiGround: 0x211c18, hemiI: .55, zenith: 0x0d1838, horizon: 0x534a78, haze: 0x2b3152, hill: 0x181d33, exposure: 1.12, env: .09, cloud: 0x4a4466},
  {e: .02, sun: 0xff8746, hemiSky: 0x8f93b6, hemiGround: 0x4a382a, hemiI: .7, zenith: 0x3d5088, horizon: 0xf59a64, haze: 0xd0896c, hill: 0x3f3f52, exposure: 1.08, env: .26, cloud: 0xf2a37a},
  {e: .14, sun: 0xffb26e, hemiSky: 0xb3bccc, hemiGround: 0x5e4a30, hemiI: .85, zenith: 0x5378b0, horizon: 0xf4c088, haze: 0xdcb48c, hill: 0x4f5c4c, exposure: 1.05, env: .36, cloud: 0xffe0bc},
  {e: .36, sun: 0xffcf8f, hemiSky: 0xc7d6dc, hemiGround: 0x6d5a35, hemiI: .95, zenith: 0x5f8fc0, horizon: 0xf3d39c, haze: 0xe2cb9b, hill: 0x56684f, exposure: 1.02, env: .42, cloud: 0xfff4e2},
  {e: .75, sun: 0xfff1d6, hemiSky: 0xcfe2ee, hemiGround: 0x625a3e, hemiI: 1.1, zenith: 0x6f9fd0, horizon: 0xd8e2df, haze: 0xd2dcd6, hill: 0x6e8170, exposure: 1.0, env: .5, cloud: 0xffffff},
  {e: 1.0, sun: 0xfff1d6, hemiSky: 0xcfe2ee, hemiGround: 0x625a3e, hemiI: 1.1, zenith: 0x6f9fd0, horizon: 0xd8e2df, haze: 0xd2dcd6, hill: 0x6e8170, exposure: 1.0, env: .5, cloud: 0xffffff},
]).map(k => ({...k, ...Object.fromEntries(['sun', 'hemiSky', 'hemiGround', 'zenith', 'horizon', 'haze', 'hill', 'cloud'].map(n => [n, C(k[n])]))}));
const COLOR_FIELDS = ['sun', 'hemiSky', 'hemiGround', 'zenith', 'horizon', 'haze', 'hill', 'cloud'];
const SUN_PEAK = 2.9, MOON_PEAK = .46, MAX_ELEVATION = .6; // a lower sun: long shadows and slanted shafts all day
const OVERCAST_DAY = C(0x9ea8b0), OVERCAST_NIGHT = C(0x161d2c), FOG_DAY = C(0xb4bec2), STORM_DAY = C(0x5e6873), FOG_NIGHT = C(0x1a2236), SNOW_DAY = C(0xa9b9cf);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// URL preview for screenshots and quick looks: ?sky=night|dusk|dawn|noon|0..1 and ?weather=rain|storm|snow|fog|clear
const NAMED = {dawn: .015, morning: .1, noon: DAYLIGHT_SHARE / 2, golden: .55, dusk: DAYLIGHT_SHARE - .012, twilight: DAYLIGHT_SHARE + .03, night: .83};
export function previewFromUrl(search = globalThis.location?.search || '') {
  const q = new URLSearchParams(search), sky = q.get('sky'), weather = q.get('weather');
  const phase = sky == null ? null : sky in NAMED ? NAMED[sky] : Number.isFinite(+sky) ? ((+sky % 1) + 1) % 1 : null;
  const kind = ['clear', 'fog', 'rain', 'storm', 'snow'].includes(weather) ? weather : null;
  return phase == null && !kind ? null : {phase, weather: kind};
}

function createRain(count) {
  const seeds = new Float32Array(count * 6), ends = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) { const x = Math.random(), y = Math.random(), z = Math.random(); seeds.set([x, y, z, x, y, z], i * 6); ends.set([0, 1], i * 2); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(seeds, 3)); geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {uTime: {value: 0}, uCenter: {value: new THREE.Vector3()}, uBox: {value: new THREE.Vector3(26, 18, 26)}, uVel: {value: new THREE.Vector3(1.2, -17, .6)}, uLen: {value: .05}, uOpacity: {value: 0}, uColor: {value: new THREE.Color(.62, .7, .82)}},
    vertexShader: `uniform float uTime, uLen; uniform vec3 uCenter, uBox, uVel; attribute float aEnd; varying float vA;
      void main(){ vec3 o = uCenter - uBox * 0.5; vec3 p = o + mod(position * uBox + uVel * uTime * (0.85 + 0.3 * position.x) - o, uBox);
        vec3 r = (p - uCenter) / uBox; vA = (1.0 - aEnd) * (1.0 - smoothstep(0.3, 0.5, max(abs(r.x), max(abs(r.y), abs(r.z)))));
        p -= uVel * uLen * aEnd; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
    fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(uColor, uOpacity * (0.25 + 0.75 * vA)); }',
    transparent: true, depthWrite: false, fog: false, toneMapped: false,
  });
  const mesh = new THREE.LineSegments(geometry, material); mesh.name = 'weather-rain'; mesh.frustumCulled = false; mesh.raycast = () => {}; mesh.renderOrder = 20; mesh.visible = false;
  return {mesh, count};
}

function createSnow(count) {
  const seeds = new Float32Array(count * 3); for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: {uTime: {value: 0}, uCenter: {value: new THREE.Vector3()}, uBox: {value: new THREE.Vector3(24, 14, 24)}, uWind: {value: new THREE.Vector2(.5, .2)}, uSize: {value: 60}, uOpacity: {value: 0}, uColor: {value: new THREE.Color(1, 1, 1)}},
    vertexShader: `uniform float uTime, uSize; uniform vec3 uCenter, uBox; uniform vec2 uWind; varying float vA, vGlint;
      void main(){ vec3 o = uCenter - uBox * 0.5; float t = uTime;
        vec3 drift = vec3(uWind.x * t + sin(t * 0.7 + position.y * 40.0) * 0.6, -(0.9 + position.z * 0.6) * t, uWind.y * t + cos(t * 0.6 + position.x * 31.0) * 0.6);
        vec3 p = o + mod(position * uBox + drift - o, uBox); vec3 r = (p - uCenter) / uBox;
        vA = 1.0 - smoothstep(0.3, 0.5, max(abs(r.x), max(abs(r.y), abs(r.z))));
        vGlint = pow(max(0.0, sin(t * (2.0 + position.y * 3.0) + position.z * 60.0)), 24.0) * step(0.72, position.y); // a few flakes catch the light
        vec4 mv = viewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(uSize * (0.5 + position.x * 0.7) * (1.0 + vGlint * 0.8) / -mv.z, 1.0, 16.0); }`,
    fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; varying float vA, vGlint; void main(){ float d = length(gl_PointCoord - 0.5); float core = smoothstep(0.5, 0.1, d); gl_FragColor = vec4(mix(uColor, vec3(0.75, 0.9, 1.6), vGlint) * (1.0 + vGlint * 2.0), uOpacity * vA * core * (1.0 + vGlint)); }',
    transparent: true, depthWrite: false, fog: false, toneMapped: false,
  });
  const mesh = new THREE.Points(geometry, material); mesh.name = 'weather-snow'; mesh.frustumCulled = false; mesh.raycast = () => {}; mesh.renderOrder = 20; mesh.visible = false;
  return {mesh, count};
}

// Night resonance motes: slow blue sparks (a few warm ones) drifting near the ground around the viewer.
function createMotes(count) {
  const seeds = new Float32Array(count * 3); for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: {uTime: {value: 0}, uCenter: {value: new THREE.Vector3()}, uBox: {value: new THREE.Vector3(30, 4, 30)}, uGround: {value: 0}, uSize: {value: 80}, uOpacity: {value: 0}, uDay: {value: 0}},
    vertexShader: `uniform float uTime, uSize, uGround, uDay; uniform vec3 uCenter, uBox; varying float vA; varying vec3 vC;
      void main(){ vec3 o = uCenter - uBox * 0.5; float t = uTime, s = position.x * 17.0 + position.z * 29.0;
        vec3 drift = vec3(sin(t * 0.21 + s) * 1.6, 0.0, cos(t * 0.17 + s * 1.3) * 1.6);
        vec3 p = o + mod(position * uBox + drift - o, uBox); p.y = uGround + 0.35 + position.y * 2.6 + sin(t * 0.5 + s) * 0.35;
        vec3 r = (p - uCenter) / uBox; float edge = 1.0 - smoothstep(0.32, 0.5, max(abs(r.x), abs(r.z)));
        float pulse = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(t * (0.9 + position.y) + s * 3.0), 3.0);
        vA = edge * pulse; vC = position.y > 0.88 ? vec3(1.0, 0.72, 0.38) : mix(vec3(0.35, 0.85, 1.0), vec3(0.6, 0.55, 1.0), position.z);
        vC = mix(vC, position.y > 0.55 ? vec3(1.0, 0.8, 0.42) : vec3(0.5, 1.0, 0.82), uDay); // by day: drifting gold and green fae lights
        vec4 mv = viewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(uSize * (0.6 + position.x * 0.6) / -mv.z, 1.5, 10.0); }`,
    fragmentShader: 'uniform float uOpacity; varying float vA; varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vC * (1.0 + 2.0 * smoothstep(0.2, 0.0, d)), uOpacity * vA * a); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
  });
  const mesh = new THREE.Points(geometry, material); mesh.name = 'night-motes'; mesh.frustumCulled = false; mesh.raycast = () => {}; mesh.renderOrder = 21; mesh.visible = false;
  return {mesh, count};
}

// Procedural ambience: rain hiss, snow wind, thunder after each flash. No assets.
function createWeatherAudio(context) {
  const length = context.sampleRate * 2, buffer = context.createBuffer(1, length, context.sampleRate), data = buffer.getChannelData(0);
  let last = 0; for (let i = 0; i < length; i++) { const w = Math.random() * 2 - 1; last = last * .97 + w * .03; data[i] = w * .6 + last * 4; }
  const out = context.createGain(); out.gain.value = 1; out.connect(context.destination);
  const loop = (type, freq, q) => { const src = context.createBufferSource(); src.buffer = buffer; src.loop = true; const f = context.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = context.createGain(); g.gain.value = 0; src.connect(f).connect(g).connect(out); src.start(); return {src, g}; };
  const rain = loop('bandpass', 2400, .6), wind = loop('lowpass', 420, .8);
  return {
    set(rainLevel, windLevel) { const t = context.currentTime; rain.g.gain.setTargetAtTime(rainLevel * .11, t, .8); wind.g.gain.setTargetAtTime(windLevel * .07, t, 1.2); },
    thunder(power = 1) {
      const t = context.currentTime + .4 + Math.random() * 1.4, src = context.createBufferSource(); src.buffer = buffer;
      const f = context.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(90, t + 2.4);
      const g = context.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.32 * power, t + .06); g.gain.exponentialRampToValueAtTime(.0001, t + 3.2);
      src.connect(f).connect(g).connect(out); src.start(t, Math.random()); src.stop(t + 3.3);
    },
    dispose() { for (const l of [rain, wind]) { try { l.src.stop(); } catch { /* stopped */ } } out.disconnect(); },
  };
}

const approach = (v, target, dt, up, down) => v + (target - v) * (1 - Math.exp(-dt / (target > v ? up : down)));

export function createDayNightWeather({scene, orchard, quality = 'high', preview = previewFromUrl(), renderer = null, height = null, postTier}) {
  const low = quality === 'low';
  const post = renderer ? createAtmospherePost(postTier ? {renderer, tier: postTier} : {renderer}) : null;
  const beams = height ? createSunbeams({scene, height, quality}) : null;
  const beamColor = new THREE.Color(), rayColor = new THREE.Color(), lift = new THREE.Color(), gain = new THREE.Color(), scatter = new THREE.Color(), lightDir = new THREE.Vector3();
  let wet = 0, snowCover = 0, mistBase = null, adopted = false;
  ATMOSPHERE.bfMistNoise.value = low ? .55 : 1;
  const rain = createRain(low ? 650 : 1600), snow = createSnow(low ? 500 : 1300), motes = createMotes(low ? 70 : 160);
  for (const p of [rain, snow, motes]) scene.add(p.mesh);
  const env = {sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(), skySunDir: new THREE.Vector3(), skySun: new THREE.Color(), sunI: 0, hemiI: 0, exposure: 1, envI: .4, night: 0, overcast: 0, clouds: .22, flash: 0, time: 0, fogScale: 1,
    cloudTint: new THREE.Color(), ...Object.fromEntries(COLOR_FIELDS.map(n => [n, new THREE.Color()]))};
  const center = new THREE.Vector3(), dir = new THREE.Vector3(), grey = new THREE.Color();
  let audio = null, lastFlash = 0, last = null, frames = 0;

  function palette(e) {
    let i = 0; while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
    const a = KEYS[i], b = KEYS[i + 1], t = smooth(a.e, b.e, e);
    for (const n of COLOR_FIELDS) env[n].copy(a[n]).lerp(b[n], t);
    env.hemiI = a.hemiI + (b.hemiI - a.hemiI) * t; env.exposure = a.exposure + (b.exposure - a.exposure) * t; env.envI = a.env + (b.env - a.env) * t;
  }

  function update({tick = 0, seed = 41, override = null, time = 0, dt = 0, camera, groundY = 0, rts = false} = {}) {
    camera_ = camera; let clock = worldClock(tick, seed, override);
    if (preview) {
      const phase = preview.phase ?? clock.phase;
      const forced = preview.weather ? {...clock.weather, weights: {clear: 0, fog: 0, rain: 0, storm: 0, snow: 0, [preview.weather]: 1}, kind: preview.weather} : clock.weather;
      clock = {...clock, phase, solar: solarAngle(phase), night: nightAmount(phase), hour: phase < DAYLIGHT_SHARE ? 6 + 12 * phase / DAYLIGHT_SHARE : (18 + 12 * (phase - DAYLIGHT_SHARE) / (1 - DAYLIGHT_SHARE)) % 24, weather: forced, lightning: preview.weather === 'storm' ? (Math.floor(time * 60) % 420 < 6 ? 1 : 0) : clock.lightning};
    }
    last = clock; frames++;
    const w = clock.weather.weights, e = Math.sin(clock.solar);
    // Sun path: rises east (+x), arcs south-high, sets west. The moon rides the opposite side of the sky.
    env.skySunDir.set(Math.cos(clock.solar), Math.sin(clock.solar) * MAX_ELEVATION, -.35 - .25 * Math.abs(Math.sin(clock.solar))).normalize();
    env.moonDir.set(-env.skySunDir.x, -env.skySunDir.y, -.45).normalize();
    palette(e);
    const sunUp = smooth(0, .09, e), moonUp = smooth(.02, .2, -e);
    env.skySun.copy(env.sun);
    if (e >= 0) { env.sunDir.copy(env.skySunDir); env.sunI = SUN_PEAK * sunUp * (.62 + .38 * smooth(.02, .5, e)); }
    else { env.sunDir.copy(env.moonDir); env.sunI = MOON_PEAK * moonUp; }
    // Weather: overcast greys the sky and softens the sun; fog/rain/snow pull the haze in.
    const overcast = Math.min(1, w.rain * .82 + w.storm + w.snow * .62 + w.fog * .55), night = clock.night;
    env.overcast = overcast; env.night = night; env.clouds = .2 + overcast * .78;
    env.sunI *= 1 - overcast * .72;
    grey.copy(OVERCAST_DAY).lerp(STORM_DAY, w.storm).lerp(OVERCAST_NIGHT, night);
    env.cloudTint.copy(env.cloud).lerp(grey, overcast);
    env.zenith.lerp(grey, overcast * .65); env.horizon.lerp(grey, overcast * .6);
    const fogTint = grey.copy(FOG_DAY).lerp(FOG_NIGHT, night); if (w.snow > .3) fogTint.lerp(SNOW_DAY.clone().lerp(FOG_NIGHT, night), .5);
    env.haze.lerp(fogTint, Math.min(1, overcast * .7 + w.fog * .5)); env.hill.lerp(env.haze, overcast * .35);
    env.hemiSky.lerp(grey, overcast * .4); env.envI *= 1 - overcast * .3; env.exposure *= 1 - overcast * .04;
    env.fogScale = Math.max(.14, 1 - w.fog * .86 - w.rain * .42 - w.storm * .55 - w.snow * .32);
    // Thick air: the sky near the horizon melts into the same haze so distant mountains never cut a hard silhouette.
    const melt = 1 - env.fogScale; env.horizon.lerp(env.haze, Math.min(1, melt * 1.1)); env.zenith.lerp(env.haze, melt * .55);
    if (rts) env.fogScale = .5 + env.fogScale * .5;
    env.flash = clock.lightning; env.hemiI += clock.lightning * 2.2; env.time = time;
    // Mood over clarity: a little haze always hangs in the air, thicker in the low light of dawn, dusk and night.
    const lowSun = 1 - smooth(.08, .5, Math.abs(env.skySunDir.y)), dawn = clock.phase < .2 ? 1 - smooth(.04, .2, clock.phase) : 0;
    env.fogScale *= .86 - lowSun * .14 - night * .1;
    orchard.applyEnvironment(env);
    atmosphere({clock, w, e, sunUp, moonUp, overcast, night, lowSun, dawn, dt, time, groundY, rts});

    // Particles follow the viewer; from the god camera they fill a taller, wider column toward the board.
    camera.getWorldPosition(center);
    if (rts) { camera.getWorldDirection(dir); center.addScaledVector(dir, 14); }
    const scale = rts ? 2.2 : 1;
    const rainW = Math.min(1, w.rain + w.storm), snowW = w.snow;
    rain.mesh.visible = rainW > .02;
    if (rain.mesh.visible) {
      const u = rain.mesh.material.uniforms; u.uTime.value = time; u.uCenter.value.copy(center); u.uBox.value.set(26 * scale, 18 * scale, 26 * scale);
      u.uVel.value.set(1.2 + w.storm * 4, -17 - w.storm * 5, .6 + w.storm * 2); u.uOpacity.value = Math.min(1, (.32 + .2 * w.storm) * (1 - night * .35) * (rts ? 1.8 : 1)); u.uLen.value = rts ? .09 : .05;
      u.uColor.value.setRGB(.62 + clock.lightning * .4, .7 + clock.lightning * .3, .82 + clock.lightning * .18);
      rain.mesh.geometry.setDrawRange(0, Math.ceil(rain.count * Math.min(1, rainW * 1.15)) * 2);
    }
    snow.mesh.visible = snowW > .02;
    if (snow.mesh.visible) {
      const u = snow.mesh.material.uniforms; u.uTime.value = time; u.uCenter.value.copy(center); u.uBox.value.set(24 * scale, 14 * scale, 24 * scale);
      u.uOpacity.value = .85 - night * .25; u.uSize.value = (low ? 48 : 60) * (rts ? 1.6 : 1); u.uColor.value.setRGB(1 - night * .35, 1 - night * .28, 1 - night * .12);
      snow.mesh.geometry.setDrawRange(0, Math.ceil(snow.count * Math.min(1, snowW * 1.15)));
    }
    // Night resonance sparks, and by day a sparse drift of fae lights (fewer, softer) so the meadow always feels alive.
    const dayMotes = (1 - night) * (1 - Math.min(1, rainW * 1.2 + w.storm)) * .5;
    const moteW = (night * (1 - Math.min(1, rainW * .8 + w.fog * .3)) + dayMotes) * (rts ? .6 : 1);
    motes.mesh.visible = moteW > .02;
    if (motes.mesh.visible) {
      const u = motes.mesh.material.uniforms; u.uTime.value = time; u.uCenter.value.copy(center); u.uGround.value = groundY; u.uOpacity.value = moteW * .9; u.uDay.value = 1 - night;
      motes.mesh.geometry.setDrawRange(0, Math.ceil(motes.count * (night > .5 ? 1 : .45)));
      u.uBox.value.set(30 * scale, 4, 30 * scale); u.uSize.value = (rts ? 160 : 80);
    }
    if (audio) {
      audio.set(Math.min(1, rainW * (1 + w.storm * .5)), Math.min(1, snowW * .9 + w.storm * .6 + w.fog * .2));
      if (clock.lightning > .9 && lastFlash <= .9) audio.thunder(.6 + .4 * w.storm);
    }
    lastFlash = clock.lightning;
    return clock;
  }

  // Ground mist, sun glow in the haze, wet ground and settling snow (every material), shafts through the canopy, and
  // on desktop the screen-space shafts, glow and grade. Weather-driven surfaces ease in and out over real time.
  function atmosphere({clock, w, e, sunUp, moonUp, overcast, night, lowSun, dawn, dt, time, groundY, rts}) {
    const first = frames === 1 || !(dt > 0), step = Math.min(dt || 0, .25), rainW = Math.min(1, w.rain + w.storm);
    wet = first ? rainW : approach(wet, rainW, step, 14, 80);
    snowCover = first ? w.snow : approach(snowCover, w.snow, step, 40, 110);
    const A = ATMOSPHERE;
    A.bfTime.value = time % 3600; A.bfSparkle.value = (1 - night * .5) * (1 - overcast * .45) + night * .35; A.bfWet.value = Math.min(1, wet * 1.1); A.bfSnow.value = Math.min(1, snowCover);
    mistBase = mistBase == null || first ? groundY : approach(mistBase, groundY, step, 6, 6);
    A.bfMistBase.value = Math.min(mistBase, 1.5) - .4;
    A.bfMistHeight.value = 2.2 + w.fog * 2.6 + rainW * 1.2 + (rts ? 1.5 : 0);
    A.bfMist.value = (.012 + dawn * .042 + lowSun * .014 + night * .016 + w.fog * .085 + rainW * .022 + w.snow * .014) * (rts ? .55 : 1);
    A.bfWind.value.set(.35 + w.storm * 1.2, .12 + w.storm * .5);
    const sunSide = e >= 0;
    lightDir.copy(sunSide ? env.skySunDir : env.moonDir);
    A.bfSunDir.value.copy(lightDir);
    scatter.copy(env.skySun).multiplyScalar((sunSide ? sunUp * (.4 + lowSun * .4) : moonUp * .12) * (1 - overcast * .75));
    A.bfSunScatter.value.copy(scatter);
    // Shafts falling through the crowns: golden in low sun, a faint cool silver under a clear moon, gone under cloud.
    const clear = (1 - overcast) ** 2;
    const beamStrength = sunSide ? sunUp * clear * (.22 + lowSun * .5 + dawn * .2) : moonUp * clear * .1;
    if (sunSide) beamColor.copy(env.skySun); else beamColor.setRGB(.55, .68, 1);
    if (beams && camera_) beams.update({camera: camera_, light: lightDir, strength: beamStrength * (rts ? .5 : 1), color: beamColor, time});
    if (post) {
      rayColor.copy(env.skySun).multiplyScalar(sunSide ? 1.3 : .5);
      lift.setRGB(.008 + .004 * lowSun, .01, .018 + .03 * night);
      gain.setRGB(1 + .05 * lowSun * sunUp, 1, 1 - .05 * lowSun * sunUp + .03 * night);
      post.set({sun: lightDir, rays: (sunSide ? sunUp * (.7 + lowSun * .6) : moonUp * .25) * (1 - overcast * .8), rayColor,
        bloom: .3 + night * .22 + w.storm * .1, bloomThreshold: .95, vignette: .2 + night * .14 + w.fog * .06,
        lift, gain, saturation: 1.06 - night * .14 - overcast * .1 + w.snow * .12, contrast: 1.04 + lowSun * .03 + w.snow * .1 + w.fog * .05});
    }
  }
  let camera_ = null;
  function prepare(scene_) { adopted = true; return adoptAtmosphere(scene_); }
  function render(scene_, camera) {
    if (!adopted) prepare(scene_);
    if (post) post.render(scene_, camera); else renderer.render(scene_, camera);
  }

  return {
    update, render, prepare,
    night() { return last?.night ?? 0; }, // 0 day .. 1 deep night, for faked light (beacon glow)
    async prepareRenderer(scene_,camera,prepareWorld) {
      prepare(scene_);
      if(post?.prepare)await post.prepare(scene_,camera,prepareWorld);
      else await prepareWorld?.();
    },
    setTrees(list) { beams?.setTrees(list); },
    // How dark it is now (0 day .. 1 deep night), cheap enough to read every frame.
    night: () => last?.night ?? 0,
    // Call once the AudioContext exists (after a user gesture); safe to call repeatedly.
    attachAudio(context) { if (!audio && context) { try { audio = createWeatherAudio(context); } catch { audio = null; } } },
    stats() { const w = last?.weather; return {frames, phase: last ? +last.phase.toFixed(4) : null, hour: last ? +last.hour?.toFixed(2) : null, night: last ? +last.night.toFixed(3) : null, weather: w?.kind ?? null, weights: w ? Object.fromEntries(Object.entries(w.weights).map(([k, v]) => [k, +v.toFixed(3)])) : null,
      preview: preview ? {...preview} : null, rain: rain.mesh.visible ? rain.mesh.geometry.drawRange.count / 2 : 0, snow: snow.mesh.visible ? snow.mesh.geometry.drawRange.count : 0, motes: motes.mesh.visible ? motes.count : 0,
      atmosphere: {mist: +ATMOSPHERE.bfMist.value.toFixed(4), wet: +ATMOSPHERE.bfWet.value.toFixed(3), snow: +ATMOSPHERE.bfSnow.value.toFixed(3), ...atmosphereStats()},
      sunbeams: beams?.stats() ?? null, post: post?.stats() ?? null}; },
    dispose() { for (const p of [rain, snow, motes]) { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); } audio?.dispose(); audio = null; beams?.dispose(); post?.dispose(); },
  };
}
