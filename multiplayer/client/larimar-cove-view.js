// Larimar Cove (presentation): the hidden lake beside each back town and Shellbright, the larimar turtle that lives in
// it. The ground, lake bed and wading limit come from shared/larimar-cove.js; this draws the water (sky reflection,
// sun glints, drifting wavelets, ripple rings, a foam lip, a soft glow pool under the turtle at night), a sandy bed
// with moving caustics, the basking rock, lily pads with two flowers, reeds, fireflies after dark, and the turtle
// itself, driven by client/larimar-turtle-motion.js with its breath puffs, bubbles and splashes.
//
// Everything animates on the presentation clock (renderTick), never on snapshots. Phone and headset safe: no lights,
// no shadows; about ten draws per cove, and nothing at all is drawn or animated while the camera is far from a cove.
import * as THREE from 'three';
import {COVE, covePoint, coveYaw, lakeBasin, lakeRadius, shoreScale, waterDepth} from '../shared/larimar-cove.js';
import {createTurtleBrain, turtlePose, coveAnchors, TURTLE} from './larimar-turtle-motion.js';
import {buildTurtle, poseTurtle, setTurtleShading} from './larimar-turtle-art.js';

const SIDES = ['party', 'rivals'];
const NEAR = 62;          // camera distance from a lake's centre inside which the cove is drawn and alive
const RIPPLES = 8;
const TAU = Math.PI * 2;
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------------------------------------ shared materials
function waterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: {value: 0}, uSky: {value: new THREE.Color(0x9cc8ec)}, uSunDir: {value: new THREE.Vector3(.4, .8, .3).normalize()},
      uSun: {value: new THREE.Color(0xfff1d0)}, uNight: {value: 0}, uDetail: {value: 1},
      uDeep: {value: new THREE.Color(0x0b4e66)}, uShallow: {value: new THREE.Color(0x2c9fae)},
      uGlow: {value: new THREE.Vector4(0, 0, 0, 0)}, uRipples: {value: Array.from({length: RIPPLES}, () => new THREE.Vector4(0, 0, -99, 0))},
    }]),
    vertexShader: `
      attribute float aDepth; varying float vDepth; varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vDepth = aDepth; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz;
        vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime, uNight, uDetail; uniform vec3 uSky, uSunDir, uSun, uDeep, uShallow; uniform vec4 uGlow; uniform vec4 uRipples[${RIPPLES}];
      varying float vDepth; varying vec3 vWorld;
      #include <fog_pars_fragment>
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        vec2 p = vWorld.xz;
        // wavelets: a few drifting sines plus noise, as a slope (dx, dz)
        vec2 g = vec2(0.0);
        g += vec2(.55, .2) * cos(dot(p, vec2(1.9, .7)) + uTime * 1.3) * .045;
        g += vec2(-.25, .6) * cos(dot(p, vec2(-.8, 2.3)) + uTime * 1.1) * .04;
        g += vec2(.4, -.5) * cos(dot(p, vec2(3.7, -2.9)) - uTime * 1.7) * .022 * uDetail;
        float n1 = vnoise(p * 2.3 + uTime * vec2(.25, .1)), n2 = vnoise(p * 2.3 + vec2(.37, .19) + uTime * vec2(.25, .1));
        float n3 = vnoise(p * 2.3 + vec2(.19, .41) + uTime * vec2(.25, .1));
        g += vec2(n2 - n1, n3 - n1) * .3 * uDetail;
        // ripple rings
        for (int i = 0; i < ${RIPPLES}; i++) {
          vec4 r = uRipples[i]; float age = uTime - r.z; if (age < 0.0 || age > 4.0) continue;
          vec2 d = p - r.xy; float dist = length(d) + 1e-4, front = age * .85;
          float env = exp(-pow((dist - front) * 3.2, 2.0)) * (1.0 - age / 4.0) * r.w / (1.0 + dist * 1.5);
          g += d / dist * cos((dist - front) * 18.0) * env * .5;
        }
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = .03 + .6 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        vec3 refl = uSky * (.75 + .35 * n.y);
        float spec = pow(max(dot(reflect(-v, n), uSunDir), 0.0), 220.0) * (1.0 - uNight) * 3.0 + pow(max(dot(reflect(-v, n), uSunDir), 0.0), 24.0) * .12 * (1.0 - uNight);
        float deep = smoothstep(.05, 1.35, vDepth);
        vec3 body = mix(uShallow, uDeep, deep) * mix(1.0, .18, uNight);
        float foam = (1.0 - smoothstep(.0, .1, vDepth)) * (.55 + .45 * vnoise(p * 6.0 + uTime * .4));
        // the turtle's glow spreading through the water at night
        float gd = length(p - uGlow.xy), glow = uGlow.w * exp(-gd * gd / 3.2) * (.85 + .15 * sin(uTime * 1.3));
        vec3 col = mix(body, refl, fres) + uSun * spec + vec3(.85, .93, .95) * foam * .45 * (1.0 - .6 * uNight) + vec3(.35, .82, 1.0) * glow * .95;
        float alpha = clamp(mix(.32, .84, deep) + fres * .4 + foam * .3 + glow * .1, 0.0, .95);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

function bedMaterial() {
  const m = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: .95, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4});
  m.userData.cove = {uTime: {value: 0}, uDay: {value: 1}};
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, m.userData.cove);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aShore; varying float vShore; varying vec3 vBed;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvBed = (modelMatrix * vec4(transformed, 1.0)).xyz; vShore = aShore;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uTime, uDay; varying float vShore; varying vec3 vBed;
      float bh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float bn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(bh(i), bh(i + vec2(1, 0)), f.x), mix(bh(i + vec2(0, 1)), bh(i + vec2(1, 1)), f.x), f.y); }
      float caustic(vec2 p, float t) { vec2 q = p * 1.9; float c = 0.0;
        for (int i = 0; i < 3; i++) { q += vec2(sin(q.y * 1.3 + t * .7), cos(q.x * 1.1 - t * .6)) * .42; c += pow(abs(sin(q.x) + sin(q.y)) * .5, 5.0); }
        return c; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // the bed stops at the waterline; the shore itself is the ground mesh
        if (vShore > .995) discard;
        float pebbles = smoothstep(.62, .7, bn(vBed.xz * 9.0)) * .22;
        diffuseColor.rgb *= vec3(.92, .86, .72) * (.82 + .18 * bn(vBed.xz * 2.2)) - pebbles * vec3(.3, .3, .25);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(.55, .78, .85) * caustic(vBed.xz, uTime) * .16 * uDay * smoothstep(.98, .5, vShore);`);
  };
  m.customProgramCacheKey = () => 'larimar-bed';
  return m;
}

function softSprite(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, inner); r.addColorStop(.35, inner.replace(/[\d.]+\)$/, '.55)')); r.addColorStop(1, outer);
  g.fillStyle = r; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ------------------------------------------------------------------------------------------------ geometry builders
function lakeGrid(side, height, {rings = 18, around = 72, reach = 1.06, y = null, bed = false}) {
  const L = COVE.lake, pos = [], depth = [], shore = [], col = [], index = [];
  for (let i = 0; i <= rings; i++) {
    const k = reach * (i / rings) ** .85;
    for (let j = 0; j < around; j++) {
      const a = TAU * j / around, s = shoreScale(a);
      const u = L.u + Math.cos(a) * k * s * L.ru, v = L.v + Math.sin(a) * k * s * L.rv;
      const [x, z] = covePoint(side, [u, v]);
      const basin = lakeBasin(x, z);
      const ground = height(x, z);
      pos.push(x, bed ? ground + .02 : y, z);
      depth.push(Math.max(0, (y ?? 0) - ground)); shore.push(lakeRadius(u, v));
      if (bed) { const wet = smooth(basin / .6); col.push(.26 - .1 * wet, .22 - .06 * wet, .16 - .02 * wet); }
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < around; j++) {
    const a = i * around + j, b = i * around + (j + 1) % around, c = a + around, d = b + around;
    index.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute(bed ? 'aShore' : 'aDepth', new THREE.Float32BufferAttribute(bed ? shore : depth, 1));
  if (bed) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(index);
  // a lake grid is a polar fan: make sure every triangle faces up whichever corner it sits in
  const p = g.attributes.position, ix = g.index.array;
  for (let t = 0; t < ix.length; t += 3) {
    const [a, b, c] = [ix[t], ix[t + 1], ix[t + 2]];
    const ux = p.getX(b) - p.getX(a), uz = p.getZ(b) - p.getZ(a), vx = p.getX(c) - p.getX(a), vz = p.getZ(c) - p.getZ(a);
    if (uz * vx - ux * vz < 0) { ix[t + 1] = c; ix[t + 2] = b; }
  }
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

function rockGeometry() {
  // a weathered, flat-topped boulder of warm grey granite: an icosphere squashed and knocked about with noise, its top
  // planed smooth for basking, darker and mossy where it meets the water, lighter and sun-bleached on top
  const g = new THREE.IcosahedronGeometry(1, 4), p = g.attributes.position, col = [];
  const n3 = (x, y, z) => Math.sin(x * 3.1 + y * 1.7) * Math.cos(z * 2.9 - x * 1.3) * .5 + Math.sin(x * 7.3 - z * 5.1 + y * 4.1) * .18 + Math.sin(z * 11.3 + x * 9.1 - y * 6.7) * .06;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = 1 + .13 * n3(x, y, z);
    x *= r * 1.08; z *= r * .94; y *= r * .62;
    if (y > .3) y = .3 + (y - .3) * .16 + .012 * n3(z * 2, 0, x * 2);   // planed, faintly uneven top
    if (y < -.2) y = -.2 + (y + .2) * .6;                              // buried foot
    p.setXYZ(i, x, y, z);
    const top = smooth((y - .16) / .2), wet = smooth((.05 - y) / .25), speck = .5 + .5 * Math.sin(x * 37.1 + z * 23.7 + y * 51.3);
    const moss = smooth(-z * 1.3 - .1) * (1 - top) * .8 * (1 - wet * .5);
    let c = [.085 + .015 * n3(z, x, y), .08 + .012 * n3(y, z, x), .07 + .01 * n3(x, z, y)].map(v => v * (.92 + .16 * speck));
    c = c.map((v, k) => v * (1 + .45 * top) * (1 - .42 * wet));
    c = [c[0] * (1 - .6 * moss) + .035 * moss, c[1] * (1 - .4 * moss) + .07 * moss, c[2] * (1 - .8 * moss) + .012 * moss];
    col.push(...c);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals(); g.computeBoundingBox(); return g;
}

function lilyGeometry() {
  const pad = new THREE.CircleGeometry(.36, 22, .32, TAU - .64).rotateX(-Math.PI / 2);
  const c = []; const p = pad.attributes.position;
  for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getZ(i)) / .36; c.push(.07 + .05 * r, .2 + .1 * r, .05 + .03 * r); p.setY(i, .012 * r * r); }
  pad.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); pad.computeVertexNormals(); return pad;
}
function flowerGeometry() {
  // eight petals in two rings around a golden heart, merged into one small mesh with vertex colours
  const parts = [];
  for (let ring = 0; ring < 2; ring++) for (let k = 0; k < 6; k++) {
    const petal = new THREE.SphereGeometry(1, 6, 4).scale(.05, .025, .11).translate(0, .03 + ring * .02, .085 - ring * .02);
    petal.rotateX(-.45 - ring * .35).rotateY(k * TAU / 6 + ring * .5);
    const col = []; for (let i = 0; i < petal.attributes.position.count; i++) { const y = petal.attributes.position.getY(i); col.push(1, .86 + .1 * y * 8, .92); }
    petal.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); parts.push(petal.toNonIndexed());
  }
  const heart = new THREE.SphereGeometry(.035, 8, 6).translate(0, .05, 0);
  heart.setAttribute('color', new THREE.Float32BufferAttribute(new Array(heart.attributes.position.count).fill(0).flatMap(() => [1, .8, .3]), 3));
  parts.push(heart.toNonIndexed());
  for (const q of parts) { q.deleteAttribute('uv'); }
  const merged = mergeGeometries(parts); merged.computeVertexNormals(); return merged;
}
function mergeGeometries(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
  for (const g of list) { pos.set(g.attributes.position.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3)); return out;
}
function reedsGeometry(side, height, seed) {
  // clumps of tapering blades on the cliff-side shores (south and east), bending with a shared breeze in the shader
  const pos = [], col = [], sway = [];
  let s = seed; const r = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
  const L = COVE.lake;
  for (let c = 0; c < 11; c++) {
    const a = -2.6 + c * .32 + r() * .2, k = .98 + r() * .1, sc = shoreScale(a);
    const cu = L.u + Math.cos(a) * k * sc * L.ru, cv = L.v + Math.sin(a) * k * sc * L.rv;
    if (Math.hypot(cu - COVE.rock.u, cv - COVE.rock.v) < 1.9) continue;
    for (let b = 0; b < 11; b++) {
      const bu = cu + (r() - .5) * .7, bv = cv + (r() - .5) * .7, [x, z] = covePoint(side, [bu, bv]);
      const y0 = height(x, z) - .05, h = .55 + r() * .75, w = .012 + r() * .008, yaw = r() * TAU, phase = r() * TAU;
      const la = r() * TAU, lean = .12 + r() * .28, lx = Math.cos(la) * lean, lz = Math.sin(la) * lean, tint = .85 + r() * .3;
      const dx = Math.cos(yaw) * w, dz = Math.sin(yaw) * w, segs = 6;
      const P = t => [x + lx * t * t, y0 + h * t, z + lz * t * t];
      const strip = (W, colour) => { // a smooth tapering ribbon, one sway phase for the whole blade
        for (let i = 0; i < segs; i++) {
          const t0 = i / segs, t1 = (i + 1) / segs, w0 = W(t0), w1 = W(t1), [ax, ay, az] = P(t0), [bx, by, bz] = P(t1);
          const quad = [[ax - dx * w0, ay, az - dz * w0, t0], [ax + dx * w0, ay, az + dz * w0, t0], [bx + dx * w1, by, bz + dz * w1, t1],
            [ax - dx * w0, ay, az - dz * w0, t0], [bx + dx * w1, by, bz + dz * w1, t1], [bx - dx * w1, by, bz - dz * w1, t1]];
          for (const [qx, qy, qz, t] of quad) { pos.push(qx, qy, qz); col.push(...colour(t)); sway.push(t * t, phase); }
        }
      };
      strip(t => (1 - t * t) * (1 - .2 * t), t => [(.05 + .1 * t) * tint, (.13 + .15 * t) * tint, (.035 + .035 * t) * tint]);
      if (r() < .16) { // a cattail: a short brown velvet head on its stalk, just below the tip
        const [hx, hy, hz] = P(.8), hh = .13, hw = .022;
        for (const [ex, ez] of [[hw, 0], [0, hw]]) {
          const quad = [[hx - ex, hy, hz - ez], [hx + ex, hy, hz + ez], [hx + ex, hy + hh, hz + ez], [hx - ex, hy, hz - ez], [hx + ex, hy + hh, hz + ez], [hx - ex, hy + hh, hz - ez]];
          for (const [qx, qy, qz] of quad) { pos.push(qx, qy, qz); col.push(.12, .065, .03); sway.push(.64, phase); }
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 2)); g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------------------------------------ the view
/**
 * scene; height(x, z) -> terrain height (unedited corner terrain); sound(name, position, opts) plays a kit cue.
 */
export function createLarimarCoveView({scene, height, sound = () => {}, turtleUrl} = {}) {
  const root = new THREE.Group(); root.name = 'larimar-coves'; scene.add(root);
  const water = waterMaterial(), bed = bedMaterial();
  const rockMat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .86, metalness: 0, flatShading: false});
  const lilyMat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .55, side: THREE.DoubleSide});
  const flowerMat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .5, emissive: 0xffd8e8, emissiveIntensity: 0});
  const reedMat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .8, side: THREE.DoubleSide});
  reedMat.userData.cove = {uTime: {value: 0}};
  reedMat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, reedMat.userData.cove);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aSway; uniform float uTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat sw = aSway.x * (.09 * sin(uTime * 1.3 + aSway.y + position.x * .4) + .04 * sin(uTime * 2.9 + aSway.y * 2.0));\ntransformed.x += sw; transformed.z += sw * .6;');
  };
  reedMat.customProgramCacheKey = () => 'larimar-reeds';
  const puffTex = softSprite('rgba(235,248,255,0.9)'), glowTex = softSprite('rgba(200,255,190,1)'), bubbleTex = softSprite('rgba(220,245,255,0.85)');
  const lilyGeo = lilyGeometry(), flowerGeo = flowerGeometry(), rockGeo = rockGeometry();
  const coves = SIDES.map((side, i) => buildCove(side, i));
  const tmp = new THREE.Vector3(), headPos = new THREE.Vector3(), camPos = new THREE.Vector3();
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), EU = new THREE.Euler(), SC = new THREE.Vector3(), P3 = new THREE.Vector3();
  let time = 0, last = null, frames = 0, shown = 0;

  function buildCove(side, index) {
    const [cx, cz] = covePoint(side, [COVE.lake.u, COVE.lake.v]);
    // the water stands COVE.lake.drop below the cove floor, and never above the lowest point of its shore
    const floor = height(cx, cz) + lakeBasin(cx, cz), L0 = COVE.lake;
    let rim = Infinity;
    for (let j = 0; j < 96; j++) { const a = TAU * j / 96, k = 1.04 * shoreScale(a), [x, z] = covePoint(side, [L0.u + Math.cos(a) * k * L0.ru, L0.v + Math.sin(a) * k * L0.rv]); rim = Math.min(rim, height(x, z)); }
    const waterY = Math.min(floor - L0.drop, rim - .12);
    const g = new THREE.Group(); g.name = `larimar-cove-${side}`; g.visible = false; root.add(g);
    const surface = new THREE.Mesh(lakeGrid(side, height, {y: waterY}), water.clone()); surface.renderOrder = 3; surface.name = 'lake-water'; g.add(surface);
    surface.material.uniforms = THREE.UniformsUtils.clone(water.uniforms);
    const sand = new THREE.Mesh(lakeGrid(side, height, {rings: 16, around: 64, reach: 1.0, bed: true}), bed); sand.name = 'lake-bed'; sand.receiveShadow = false; g.add(sand);
    // the basking rock: its planed top stands COVE.rock.top above the water
    const [rx, rz] = covePoint(side, [COVE.rock.u, COVE.rock.v]);
    const rock = new THREE.Mesh(rockGeo, rockMat); rock.name = 'basking-rock';
    rock.scale.setScalar(COVE.rock.r); rock.position.set(rx, waterY + COVE.rock.top - (rockGeo.boundingBox.max.y - .006) * COVE.rock.r, rz);
    rock.rotation.y = coveYaw(side, COVE.rock.face) + .4; g.add(rock);
    // lily pads and two flowers, bobbing on the water
    let s = 977 + index * 131; const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const pads = [], L = COVE.lake;
    for (let tries = 0; pads.length < 9 && tries < 80; tries++) {
      const a = r() * TAU, k = .55 + r() * .3, sc = shoreScale(a);
      const u = L.u + Math.cos(a) * k * sc * L.ru, v = L.v + Math.sin(a) * k * sc * L.rv;
      if (Math.hypot(u - COVE.rock.u, v - COVE.rock.v) < 2.9 || pads.some(p => Math.hypot(p.u - u, p.v - v) < .8)) continue;
      pads.push({u, v, yaw: r() * TAU, scale: .7 + r() * .55, phase: r() * TAU, flower: pads.length < 2});
    }
    const lilies = new THREE.InstancedMesh(lilyGeo, lilyMat, pads.length); lilies.name = 'lily-pads';
    const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, 2); flowers.name = 'lily-flowers';
    g.add(lilies, flowers);
    const reeds = new THREE.Mesh(reedsGeometry(side, height, 31 + index * 7), reedMat); reeds.name = 'reeds'; g.add(reeds);
    // fireflies over the water after dark
    const flyCount = 22, flyPos = new Float32Array(flyCount * 3), flies = [];
    for (let k = 0; k < flyCount; k++) flies.push({a: r() * TAU, k: .2 + r() * 1.0, h: .3 + r() * 1.6, s: .2 + r() * .4, p: r() * TAU});
    const flyGeo = new THREE.BufferGeometry(); flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3));
    const fireflies = new THREE.Points(flyGeo, new THREE.PointsMaterial({size: .16, map: glowTex, color: 0xd8ffb0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true}));
    fireflies.name = 'fireflies'; fireflies.frustumCulled = false; g.add(fireflies);
    // breath puffs and bubbles: small sprite pools
    const puffs = Array.from({length: 7}, () => { const m = new THREE.Sprite(new THREE.SpriteMaterial({map: puffTex, transparent: true, depthWrite: false, opacity: 0})); m.visible = false; m.renderOrder = 4; g.add(m); return {m, t: 9, v: new THREE.Vector3()}; });
    const bubbles = Array.from({length: 10}, () => { const m = new THREE.Sprite(new THREE.SpriteMaterial({map: bubbleTex, transparent: true, depthWrite: false, opacity: 0})); m.visible = false; m.renderOrder = 1; g.add(m); return {m, t: 9, y0: 0}; });
    const drops = Array.from({length: 14}, () => { const m = new THREE.Sprite(new THREE.SpriteMaterial({map: bubbleTex, transparent: true, depthWrite: false, opacity: 0})); m.visible = false; m.renderOrder = 4; g.add(m); return {m, t: 9, v: new THREE.Vector3()}; });
    // the turtle
    const turtle = buildTurtle({url: turtleUrl}); turtle.name = 'shellbright'; turtle.rotation.order = 'YXZ'; turtle.scale.setScalar(TURTLE.scale); g.add(turtle);
    const lake = {centre: {u: L.u, v: L.v}, radius: (u, v) => lakeRadius(u, v), depth: (u, v) => { const [x, z] = covePoint(side, [u, v]); return waterDepth(x, z); }};
    const brain = createTurtleBrain({lake, seed: index ? 29 : 11, anchors: coveAnchors()});
    return {side, g, floor, waterY, centre: [cx, cz], surface, sand, rock, lilies, flowers, pads, reeds, fireflies, flies, puffs, bubbles, drops, turtle, brain,
      mem: {}, ripple: 0, lastSurfaceRipple: 0, lastBubble: 0, wade: new Map(), state: null, events: 0};
  }

  function ripple(c, x, z, strength = 1) {
    const r = c.surface.material.uniforms.uRipples.value[c.ripple++ % RIPPLES]; r.set(x, z, time, strength);
  }
  function puff(c, at) {
    for (let k = 0; k < 4; k++) { const p = c.puffs.find(q => q.t > 1.3); if (!p) break; p.t = -k * .05; p.m.position.copy(at); p.v.set((Math.random() - .5) * .25, .45 + Math.random() * .25, (Math.random() - .5) * .25); p.m.visible = true; }
  }
  function splash(c, at, big) {
    const n = big ? 12 : 6;
    for (let k = 0; k < n; k++) { const d = c.drops.find(q => q.t > 1); if (!d) break; d.t = 0; d.m.position.copy(at); const a = Math.random() * TAU, sp = (big ? 1.4 : .9) * (.5 + Math.random() * .6); d.v.set(Math.cos(a) * sp * .6, (big ? 2.3 : 1.6) * (.6 + Math.random() * .5), Math.sin(a) * sp * .6); d.m.visible = true; }
    ripple(c, at.x, at.z, big ? 1.6 : 1);
  }
  function bubble(c, at) { const b = c.bubbles.find(q => q.t > 3); if (!b) return; b.t = 0; b.m.position.copy(at); b.y0 = at.y; b.m.visible = true; }

  function heroesIn(c, heroes) {
    const out = [], g = c.side === 'rivals' ? 1 : -1;
    for (const h of heroes || []) {
      const u = h.x * g, v = h.z * g;
      if (Math.abs(u - COVE.lake.u) < 12 && Math.abs(v - COVE.lake.v) < 12) out.push({key: h.id, u, v, x: h.x, y: h.y, z: h.z});
    }
    return out;
  }

  function updateCove(c, dt, T, camera, heroes, night) {
    const near = camPos.distanceTo(tmp.set(c.centre[0], c.waterY, c.centre[1])) < NEAR;
    c.g.visible = near; if (!near) return;
    shown++;
    const local = heroesIn(c, heroes);
    const events = c.brain.advanceTo(T, local);
    const s = c.brain.sample(T); c.state = s;
    // look target: whoever it is visiting, else the nearest hero within a few metres while basking or hovering
    let look = s.look ? {u: s.look.u, v: s.look.v, y: (local.find(h => Math.abs(h.u - s.look.u) < .01)?.y ?? c.waterY + 1.6) - c.waterY + 1.4} : null;
    if (!look && (s.bask > .5 || s.hover > .5)) {
      let best = null; for (const h of local) { const d = Math.hypot(h.u - s.u, h.v - s.v); if (d < 7 && (!best || d < best.d)) best = {d, u: h.u, v: h.v, y: h.y - c.waterY + 1.4}; }
      look = best;
    }
    const pose = turtlePose(s, T, {look, mem: c.mem, dt, seed: c.side === 'party' ? 1.3 : 2.9});
    const R = pose.root, [x, z] = covePoint(c.side, [R.u, R.v]);
    c.turtle.position.set(x, c.waterY + R.y, z);
    c.turtle.rotation.set(-R.pitch, coveYaw(c.side, R.yaw), R.roll);
    poseTurtle(c.turtle, pose);
    // effects from the brain's events and the turtle's surface contact
    const head = c.turtle.userData.turtle?.bones?.Head;
    const headAt = () => { if (head) { c.turtle.updateMatrixWorld(true); head.getWorldPosition(headPos); headPos.addScaledVector(tmp.set(Math.sin(c.turtle.rotation.y), 0, Math.cos(c.turtle.rotation.y)), .26 * TURTLE.scale); } else headPos.copy(c.turtle.position).add(tmp.set(Math.sin(c.turtle.rotation.y) * .9, .1, Math.cos(c.turtle.rotation.y) * .9)); return headPos; };
    for (const e of events) {
      if (e.kind === 'breath') { const at = headAt(); puff(c, at.clone().add(tmp.set(0, .05, 0))); ripple(c, at.x, at.z, .9); sound('turtle_breath', at.toArray()); }
      else if (e.kind === 'splash') { const at = c.turtle.position.clone(); at.y = c.waterY; splash(c, at.add(tmp.set(Math.sin(c.turtle.rotation.y) * .5, 0, Math.cos(c.turtle.rotation.y) * .5)), e.big); sound('water_splash', at.toArray(), {big: e.big}); }
      else if (e.kind === 'dive') { const at = c.turtle.position; ripple(c, at.x, at.z, 1.2); for (let k = 0; k < 4; k++) bubble(c, headAt().clone().add(tmp.set((Math.random() - .5) * .2, -.1 - k * .08, (Math.random() - .5) * .2))); sound('turtle_bubble', at.toArray()); }
    }
    // gentle rings while it floats at the surface, a trickle of bubbles while it swims deep
    if (s.surface > .6 && time - c.lastSurfaceRipple > (s.hover > .5 ? 1.8 : 1.1)) { c.lastSurfaceRipple = time; ripple(c, c.turtle.position.x, c.turtle.position.z, .45); }
    if (s.surface < .2 && s.bask < .2 && time - c.lastBubble > 2.6 + Math.sin(T * 1.7) * 1.2) { c.lastBubble = time; bubble(c, headAt().clone()); }
    // heroes wading leave rings
    for (const h of local) {
      if (waterDepth(h.x, h.z) <= .02) continue;
      const prev = c.wade.get(h.key);
      if (!prev || Math.hypot(prev[0] - h.x, prev[1] - h.z) > .45) { c.wade.set(h.key, [h.x, h.z]); ripple(c, h.x, h.z, .7); }
    }
    // water uniforms
    const u = c.surface.material.uniforms; u.uTime.value = time; u.uNight.value = night;
    u.uGlow.value.set(c.turtle.position.x, c.turtle.position.z, 0, night * (s.bask > .5 ? .5 : 1) * smooth((c.turtle.position.y - c.waterY + 1.5) / 1.2));
    // pads bob (and get nudged by nearby rings), flowers ride their pads
    const m4 = M4, q = Q, e = EU, sc = SC, p3 = P3;
    c.pads.forEach((pad, i) => {
      const [px, pz] = covePoint(c.side, [pad.u, pad.v]);
      const dTurtle = Math.hypot(px - c.turtle.position.x, pz - c.turtle.position.z), push = s.surface * Math.max(0, 1 - dTurtle / 1.2);
      const bob = .008 * Math.sin(time * 1.1 + pad.phase) + .02 * push * Math.sin(time * 6 + pad.phase);
      e.set(.03 * Math.sin(time * .9 + pad.phase) + .06 * push, pad.yaw + .05 * Math.sin(time * .3 + pad.phase), .03 * Math.cos(time * .8 + pad.phase));
      q.setFromEuler(e); sc.setScalar(pad.scale); p3.set(px, c.waterY + .006 + bob, pz);
      m4.compose(p3, q, sc); c.lilies.setMatrixAt(i, m4);
      if (pad.flower) { p3.y += .01; m4.compose(p3, q, sc.setScalar(pad.scale * .9)); c.flowers.setMatrixAt(i, m4); }
    });
    c.lilies.instanceMatrix.needsUpdate = true; c.flowers.instanceMatrix.needsUpdate = true;
    // fireflies
    c.fireflies.visible = night > .05; c.fireflies.material.opacity = Math.min(1, night * 1.4);
    if (c.fireflies.visible) {
      const a = c.fireflies.geometry.attributes.position, L = COVE.lake;
      c.flies.forEach((f, i) => {
        const ang = f.a + time * f.s * .3, k = f.k + .15 * Math.sin(time * .4 + f.p);
        const fu = L.u + Math.cos(ang) * k * L.ru * .9, fv = L.v + Math.sin(ang) * k * L.rv * .9, [fx, fz] = covePoint(c.side, [fu, fv]);
        a.setXYZ(i, fx, c.waterY + f.h + .25 * Math.sin(time * .9 + f.p), fz);
      });
      a.needsUpdate = true;
      c.fireflies.material.size = .13 + .05 * Math.sin(time * 3);
    }
    // sprites
    for (const p of c.puffs) {
      if (p.t > 1.3) { p.m.visible = false; continue; }
      p.t += dt; if (p.t < 0) { p.m.visible = false; continue; }
      p.m.visible = true; p.m.position.addScaledVector(p.v, dt); p.v.multiplyScalar(Math.exp(-dt * 1.8));
      p.m.scale.setScalar(.12 + p.t * .55); p.m.material.opacity = .55 * (1 - smooth(p.t / 1.3)) * smooth(p.t / .08);
    }
    for (const b of c.bubbles) {
      if (b.t > 3) { b.m.visible = false; continue; }
      b.t += dt; b.m.position.y += dt * (.35 + b.t * .25); b.m.position.x += Math.sin(time * 7 + b.y0 * 9) * .002;
      b.m.scale.setScalar(.035 + .02 * Math.sin(b.t * 9)); b.m.material.opacity = .7;
      if (b.m.position.y >= c.waterY - .02) { b.t = 9; b.m.visible = false; ripple(c, b.m.position.x, b.m.position.z, .25); }
    }
    for (const d of c.drops) {
      if (d.t > 1) { d.m.visible = false; continue; }
      d.t += dt; d.v.y -= 9.8 * dt; d.m.position.addScaledVector(d.v, dt);
      d.m.scale.setScalar(.06); d.m.material.opacity = .85 * (1 - d.t);
      if (d.m.position.y < c.waterY) { d.t = 9; d.m.visible = false; }
    }
    c.events += events.length;
  }

  return {
    root,
    /** dt seconds; tick the presentation tick (fractional, 60 Hz); heroes [{id, x, y, z}] world positions. */
    update(dt, {tick, camera, heroes = [], night = 0, sky = null, sunDir = null, detail = 1} = {}) {
      if (!Number.isFinite(tick) || !camera) return;
      frames++; shown = 0; time = tick / 60; camera.getWorldPosition(camPos);
      setTurtleShading({night, time});
      bed.userData.cove.uTime.value = time; bed.userData.cove.uDay.value = 1 - night; reedMat.userData.cove.uTime.value = time;
      flowerMat.emissiveIntensity = .08 + .25 * night;
      for (const c of coves) {
        const u = c.surface.material.uniforms;
        if (sky) u.uSky.value.copy(sky); if (sunDir) u.uSunDir.value.copy(sunDir).normalize(); u.uDetail.value = detail;
        updateCove(c, Math.min(dt, .1), time, camera, heroes, night);
      }
      last = {time};
    },
    turtles: () => coves.map(c => c.turtle),
    state: side => coves.find(c => c.side === side)?.state ?? null,
    cove: side => coves.find(c => c.side === side),
    stats: () => ({frames, shown, coves: coves.map(c => ({side: c.side, visible: c.g.visible, mode: c.state?.mode ?? null, events: c.events, model: !!c.turtle.userData.turtle?.model}))}),
    dispose() { scene.remove(root); root.traverse(o => { o.geometry?.dispose?.(); }); },
  };
}
