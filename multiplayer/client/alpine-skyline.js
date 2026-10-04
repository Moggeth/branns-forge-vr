// Alpine skyline: three layered ranges of distant snow giants behind the mountain colosseum, fading into the sky.
// Presentation only, like the sky dome: the rings follow the camera horizontally (true distant ranges show no
// parallax), draw right after the sky; every world object is nearer, so it covers them through the depth test.
// One draw, no textures, no lights. Shading is painterly: each ridge column carries a fake 3D normal from the ridge
// slope and its gullies, lit by the shared orchard sun, with snowfields, couloirs and aerial perspective per layer.
import * as THREE from 'three';

export const ALPINE_SKYLINE_VERSION = 1;
// Far -> near (draw order). r: radius from the viewer; base/top: metres above y=-6; haze: aerial perspective.
export const SKYLINE_LAYERS = Object.freeze([
  {r: 146, top: [46, 100], haze: .42, seed: 31, peaks: 9, snow: .42},
  {r: 140, top: [30, 70], haze: .27, seed: 47, peaks: 13, snow: .5},
  {r: 134, top: [20, 44], haze: .15, seed: 59, peaks: 19, snow: .64},
]);

function hash(i, seed) {
  let h = (Math.imul((i + 4096) >>> 0, 0x8da6b343) ^ Math.imul((seed + 4096) >>> 0, 0xd8163841)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; h = (h ^ (h >>> 15)) >>> 0;
  return (h & 0xffffff) / 16777215;
}
const pnoise = (x, period, seed) => { const i = Math.floor(x), f = x - i, t = f * f * (3 - 2 * f), m = k => ((k % period) + period) % period; return hash(m(i), seed) * (1 - t) + hash(m(i + 1), seed) * t; };

// Ridge height along a layer (a in [0,1) around the ring): sharp horns on a broken massif, never flat.
export function ridgeHeight(L, a) {
  const P = L.peaks, x = a * P;
  const i = Math.floor(x), f = x - i;
  // Horn per segment: an asymmetric pyramid whose apex position and height are seeded, plus a ridged mid-scale.
  const apex = .3 + .4 * hash(i, L.seed), hgt = .45 + .55 * hash(i, L.seed + 1) ** .7;
  const horn = hgt * (f < apex ? (f / apex) ** 1.7 : ((1 - f) / (1 - apex)) ** 1.7);
  const ridged = 1 - Math.abs(2 * pnoise(a * P * 5, P * 5, L.seed + 2) - 1), fine = pnoise(a * P * 19, P * 19, L.seed + 3);
  const shoulder = .28 + .22 * pnoise(a * P * 1.7, Math.round(P * 1.7) || 1, L.seed + 4);
  const h = Math.max(horn, shoulder) * .82 + .12 * ridged + .06 * fine;
  return L.top[0] + (L.top[1] - L.top[0]) * Math.min(1, h);
}

export function createAlpineSkyline({scene, sky = null, columns = 480, rows = 6} = {}) {
  if (!scene) throw new Error('createAlpineSkyline requires scene');
  const U = sky?.material?.uniforms || {};
  const uniforms = {
    uSunDir: U.sunDir || {value: new THREE.Vector3(-.5, .4, -.7).normalize()},
    uSunColor: U.sunColor || {value: new THREE.Color(1, .82, .56)},
    uHorizon: U.horizon || {value: new THREE.Color(.9, .66, .33)},
    uZenith: U.zenith || {value: new THREE.Color(.11, .27, .52)},
    // Day/night + weather (client/day-night-weather.js drives these through the shared sky uniforms).
    uNight: U.night || {value: 0}, uOvercast: U.overcast || {value: 0}, uMoonDir: U.moonDir || {value: new THREE.Vector3(0, -1, 0)},
  };
  // Each layer is a real heightfield ridge band (cross-ridge rows), so faces carry true normals: sunlit faces,
  // shaded couloirs and spurs read like mountains, and snow settles on up-facing high ground.
  const pos = [], attr = [], idx = [], cross = [-1, -.62, -.3, -.1, 0, .1, .3, .62, 1];
  for (const [li, L] of SKYLINE_LAYERS.entries()) {
    const base = pos.length / 3, W = 10 + li * -1.5;
    for (let c = 0; c <= columns; c++) {
      const a = (c % columns) / columns, ang = a * Math.PI * 2, top = ridgeHeight(L, a);
      const spur = pnoise(a * columns / 4.5, Math.round(columns / 4.5), L.seed + 9), skew = (pnoise(a * L.peaks * 2, L.peaks * 2, L.seed + 11) - .5) * .5;
      for (const d of cross) {
        const k = 1 - Math.min(1, Math.abs(d - skew * (1 - Math.abs(d)))); // ridge crest offset per column
        const rough = (pnoise(a * columns / 1.7 + d * 3.1, Math.round(columns / 1.7), L.seed + 13) - .5) * .12;
        const h = top * Math.max(0, Math.pow(k, 1.25) * (1 + (spur - .5) * .35 * (1 - k)) + rough * k);
        const rr = L.r + d * W * (1 + .3 * spur);
        pos.push(Math.cos(ang) * rr, -6 + h, Math.sin(ang) * rr);
        attr.push(li, h / Math.max(1, top), 0, 0);
      }
    }
    const R = cross.length;
    for (let c = 0; c < columns; c++) for (let r = 0; r < R - 1; r++) {
      const a = base + c * R + r, b = base + (c + 1) * R + r;
      idx.push(a, b, a + 1, b, b + 1, a + 1); // wound so normals face up/out of the ridge
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('ridge', new THREE.Float32BufferAttribute(attr, 4));
  geometry.setIndex(idx); geometry.computeVertexNormals();
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const hazeArr = SKYLINE_LAYERS.map(l => l.haze), snowArr = SKYLINE_LAYERS.map(l => l.snow);
  const material = new THREE.ShaderMaterial({
    uniforms: {...uniforms, uHaze: {value: hazeArr}, uSnow: {value: snowArr}},
    vertexShader: /* glsl */`
      attribute vec4 ridge; varying vec4 vRidge; varying vec3 vWorld; varying vec3 vN;
      void main(){ vRidge = ridge; vWorld = position; vN = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir, uSunColor, uHorizon, uZenith, uMoonDir; uniform float uHaze[3], uSnow[3], uNight, uOvercast;
      varying vec4 vRidge; varying vec3 vWorld; varying vec3 vN;
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        int li = int(vRidge.x + .5); float t = vRidge.y;
        float haze = li == 0 ? uHaze[0] : li == 1 ? uHaze[1] : uHaze[2];
        float snowAmt = li == 0 ? uSnow[0] : li == 1 ? uSnow[1] : uSnow[2];
        vec3 n = normalize(vN);
        float ang = atan(vWorld.z, vWorld.x);
        vec2 q = vec2(ang * 120.0, vWorld.y * .12);
        float rocky = n2(q) * .6 + n2(q * 2.7) * .4;
        // Rock strata/facets perturb the lighting normal a little so faces are not flat plates.
        vec3 along = normalize(vec3(-vWorld.z, 0.0, vWorld.x));
        n = normalize(n + along * (rocky - .5) * .45);
        float sun = clamp(dot(n, normalize(uSunDir)), 0.0, 1.0);
        float line = mix(.7, .45, snowAmt) + .12 * (n2(vec2(ang * 30.0, float(li))) - .5);
        float snow = smoothstep(line, line + .05, t + .25 * (n.y - .55) - .1 * rocky);
        snow *= smoothstep(.18, .4, n.y + .1 * rocky);
        vec3 rock = mix(vec3(.05, .056, .066), vec3(.11, .108, .11), rocky);
        rock = mix(rock, vec3(.025, .045, .03), smoothstep(.32, .12, t) * smoothstep(.4, .7, n.y)); // forested lower flanks
        vec3 alb = mix(rock, vec3(.85, .89, .96), snow);
        vec3 amb = mix(vec3(.22, .3, .44), vec3(.32, .42, .58), n.y * .5 + .5) * mix(1.0, .1, uNight) * (1.0 - .35 * uOvercast);
        float moon = clamp(dot(n, normalize(uMoonDir)), 0.0, 1.0) * uNight * (1.0 - .7 * uOvercast);
        vec3 col = alb * (amb + uSunColor * 1.25 * sun * (1.0 - .7 * uOvercast) + vec3(.32, .4, .62) * moon);
        float k = clamp(haze + (1.0 - t) * .3 * (1.0 - haze), 0.0, .96);
        k = mix(k, .97, uOvercast * .7);
        vec3 air = mix(mix(uHorizon, vec3(.42, .55, .76), .6 * (1.0 - uNight) * (1.0 - uOvercast)), uZenith, t * .25);
        col = mix(col, air, k);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    depthWrite: true, depthTest: true, fog: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'alpine-skyline'; mesh.frustumCulled = false; mesh.renderOrder = -950; mesh.raycast = () => {};
  scene.add(mesh);
  const cam = new THREE.Vector3();
  return {
    mesh,
    update(camera) { if (!camera) return; camera.getWorldPosition(cam); mesh.position.set(cam.x, 0, cam.z); },
    stats: () => ({version: ALPINE_SKYLINE_VERSION, draws: 1, triangles: idx.length / 3, layers: SKYLINE_LAYERS.length}),
    dispose() { scene.remove(mesh); geometry.dispose(); material.dispose(); },
  };
}
