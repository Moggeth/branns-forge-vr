// The town square round each keep's heart (shared/town-square.js): round-laid cobbles fading into the grass, strings of
// festival lights from the heart's crown to ribboned poles, and the Blender stalls (assets/square-20261023 ->
// /assets/square_kit.glb): the training ring with two straw dummies that rock when you whack them, the bakery cart and
// its glowing oven, the bard's stage and the welcome board. Dawnhold gets the D_ pieces, Grumblekeep the G_ ones.
// Presentation only: collision is shared (resolveSquare); nothing here casts shadows or takes raycasts. Everything
// animates every frame on the frame clock; bulbs and halos swell at dusk with the town-life lamps.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {homeBattle, homePoint} from '../shared/home-bases.js';
import {SQUARE, SQUARE_PIECES, squarePiece, squarePoles} from '../shared/town-square.js';
import {terrainHeight} from '../shared/terrain.js';

const SIDES = Object.freeze({party: 'D', rivals: 'G'});
const GLOW = {Crystal: 1.5, Ember: 2.4, Glass: 1.15, GlassOoze: 1.15, Ooze: 1.6};
const FLICKER = new Set(['Ember', 'Glass', 'GlassOoze']);
const DUMMY_AT = [[-1.25, .35], [1.25, .45]]; // *_Trainer_Dummy0/1 when the kit has no anchor
const POLE_TOP = 4.25;
const BULBS = {party: [0xfff1c8, 0xffc26b, 0xff8fa8, 0x9fd3ff], rivals: [0xb6ff7a, 0xd59bff, 0xffc26b, 0x9fffe0]};

// ---------------------------------------------------------------- cobbles
// One course of cobbles across the texture (eight stones of uneven widths), drawn in code: rounded, slightly domed
// stones in honey, grey and a few rosy ones, packed close with thin dark joints.
const STONES = 8;
function cobbleTexture(w = 512, h = 64, seed = 7) {
  const d = new Uint8Array(w * h * 4), rnd = i => { const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return x - Math.floor(x); };
  const widths = Array.from({length: STONES}, (_, k) => .75 + .5 * rnd(k + 3)), total = widths.reduce((a, b) => a + b, 0), edges = [0];
  for (const x of widths) edges.push(edges.at(-1) + x / total * w);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let k = 0; while (i >= edges[k + 1]) k++;
    const u = (i - edges[k]) / (edges[k + 1] - edges[k]) * 2 - 1, v = (j + .5) / h * 2 - 1;
    const sq = 1 + .12 * (rnd(k + 51) - .5), wob = .05 * Math.sin((u * 2.3 + k) * 3.1 + rnd(k) * 6) + .04 * Math.sin(v * 4 + k);
    const e = Math.pow(Math.pow(Math.abs(u) * 1.02, 3.6) + Math.pow(Math.abs(v) * sq + wob, 3.6), 1 / 3.6); // squircle
    const tone = .85 + .25 * rnd(k + 11), kind = rnd(k + 37);
    const base = kind > .86 ? [.63, .53, .48] : kind > .48 ? [.57, .56, .54] : [.64, .57, .46]; // rosy, grey, honey
    const grain = .95 + .05 * Math.sin(u * 2.1 + rnd(k + 5) * 6) * Math.cos(v * 1.7 + rnd(k + 9) * 6); // a soft mottle, no fine pattern to shimmer
    const crown = Math.max(0, 1 - e) ** .6, lit = .8 + .26 * crown - .12 * Math.max(0, v) * crown;
    const grout = 1 - Math.min(1, Math.max(0, (e - .9) / .07));
    const o = (j * w + i) * 4;
    for (let c = 0; c < 3; c++) d[o + c] = Math.min(255, 255 * (base[c] * tone * lit * grain * grout + [.2, .18, .14][c] * (1 - grout)));
    d[o + 3] = 255;
  }
  const t = new THREE.DataTexture(d, w, h); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
/** Concentric courses of cobbles from the heart's plinth out to the square's edge, laid on the ground. Each course is its
 *  own band with a whole number of stones, so the rings close without a seam; the outer courses fade into the grass. */
export function cobbleGeometry(cx, cz, height, {inner = SQUARE.innerRadius, outer = SQUARE.radius, edge = SQUARE.edge, course = .34, stone = .4, seg = 4} = {}) {
  const pos = [], uv = [], col = [], idx = [];
  for (let r0 = inner; r0 < outer - 1e-3; r0 += course) {
    const r1 = Math.min(outer, r0 + course), rm = (r0 + r1) / 2, n = Math.max(STONES * 2, Math.round(Math.PI * 2 * rm / stone / STONES) * STONES), steps = n * seg;
    const off = (Math.sin(r0 * 91.7) * .5 + .5), base = pos.length / 3;
    for (let s = 0; s <= steps; s++) {
      const a = s / steps * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      for (const r of [r0, r1]) {
        const x = cx + c * r, z = cz + sn * r, fade = Math.max(0, Math.min(1, (outer - r) / edge));
        pos.push(x, height(x, z) + .025, z); uv.push((s / seg + off) / STONES, r === r0 ? 0 : 1); // the texture holds a course of STONES stones
        col.push(1, 1, 1, fade * fade * (3 - 2 * fade));
      }
    }
    for (let s = 0; s < steps; s++) { const a = base + s * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); /* counter-clockwise seen from above */ }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- string lights
/** Points along a sagging string from a to b (catenary-ish), every `every` metres. */
export function stringPoints(a, b, sag, every = .55) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(3, Math.round(len / every)), out = [];
  for (let k = 0; k <= n; k++) { const t = k / n; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t]); }
  return out;
}

function glowTexture(n = 64) {
  const d = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i + .5) / n * 2 - 1, y = (j + .5) / n * 2 - 1, r = Math.min(1, Math.hypot(x, y)), a = Math.pow(1 - r, 2.2), o = (j * n + i) * 4;
    d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = Math.round(a * 255);
  }
  const t = new THREE.DataTexture(d, n, n); t.needsUpdate = true; t.magFilter = t.minFilter = THREE.LinearFilter; return t;
}

export function createTownSquareView({scene}) {
  const root = new THREE.Group(); root.name = 'town-square'; root.visible = false; scene.add(root);
  let snapshot = null, enabled = false, placed = false, kit = null, night = 0, clock = 0;
  const disposables = [], glowMats = [], dummies = [], stalls = {party: new THREE.Group(), rivals: new THREE.Group()};
  for (const g of Object.values(stalls)) root.add(g);
  const ground = (x, z) => snapshot ? terrainHeight(snapshot, x, z, false) : 0;

  // Cobbles: one mesh per keep, sharing a material.
  const cobbleTex = cobbleTexture();
  const cobbleMat = new THREE.MeshStandardMaterial({map: cobbleTex, vertexColors: true, transparent: true, roughness: .92, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: true});
  disposables.push(cobbleTex, cobbleMat);
  const cobbles = [];

  // String lights: a cord (one merged tube mesh), bulbs (one instanced mesh, per-instance colour) and halos (points).
  const cordMat = new THREE.MeshStandardMaterial({color: 0x3a2c22, roughness: .9}), cord = new THREE.Mesh(new THREE.BufferGeometry(), cordMat);
  cord.name = 'square-light-cords'; cord.raycast = () => {}; root.add(cord); disposables.push(cordMat);
  const bulbGeo = new THREE.SphereGeometry(.075, 8, 6), bulbMat = new THREE.MeshStandardMaterial({color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: .35});
  disposables.push(bulbGeo, bulbMat);
  let bulbs = null, halos = null, haloMat = null;
  const glowTex = glowTexture(); disposables.push(glowTex);

  // Stalls, dummies, poles and their lights appear only with the authored kit (no stand-in shapes); without it the square
  // is just cobbles round the heart.
  function makeStall(side, name) {
    const pre = SIDES[side], node = kit.getObjectByName(`${pre}_${name[0].toUpperCase()}${name.slice(1)}`);
    const body = node.clone(true);
    body.position.set(0, 0, 0); body.rotation.set(0, 0, 0);
    const g = new THREE.Group(); g.name = `square-${side}-${name}`; g.add(body);
    const p = squarePiece(side, name); g.position.set(p.x, ground(p.x, p.z), p.z); g.rotation.y = p.yaw;
    if (name === 'trainer') {
      const dummyNode = kit.getObjectByName(`${pre}_Dummy`);
      DUMMY_AT.forEach((at, k) => {
        const anchor = node.getObjectByName(`${pre}_Trainer_Dummy${k}`);
        const d = dummyNode.clone(true);
        const pivot = new THREE.Group(); pivot.position.set(anchor ? anchor.position.x : at[0], 0, anchor ? anchor.position.z : at[1]); pivot.add(d); g.add(pivot);
        dummies.push({pivot, side, k, tilt: 0, vel: 0, axis: new THREE.Vector3(1, 0, 0), twist: 0, twistVel: 0});
      });
    }
    return g;
  }
  function makePole(side) {
    const c = kit.getObjectByName(`${SIDES[side]}_LightPole`).clone(true); c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); return c;
  }

  function build() {
    for (const g of Object.values(stalls)) { for (const c of [...g.children]) c.removeFromParent(); }
    dummies.length = 0;
    for (const o of [cord, bulbs, halos]) if (o) o.visible = !!kit;
    if (!kit) return;
    for (const side of Object.keys(SIDES)) {
      for (const name of SQUARE_PIECES) stalls[side].add(makeStall(side, name));
      for (const [x, z] of squarePoles(side)) { const p = makePole(side); p.position.set(x, ground(x, z), z); p.rotation.y = Math.atan2(x, z); stalls[side].add(p); }
    }
    root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.raycast = () => {}; } });
  }
  function buildGround() {
    for (const m of cobbles) { m.geometry.dispose(); m.removeFromParent(); } cobbles.length = 0;
    for (const side of Object.keys(SIDES)) {
      const [cx, cz] = homePoint(side, [0, 0]), m = new THREE.Mesh(cobbleGeometry(cx, cz, ground), cobbleMat);
      m.name = `square-cobbles-${side}`; m.renderOrder = 1; m.raycast = () => {}; m.receiveShadow = true; root.add(m); cobbles.push(m);
    }
  }
  function buildLights() {
    const cordParts = [], bulbsAt = [];
    for (const side of Object.keys(SIDES)) {
      const [hx, hz] = homePoint(side, [0, 0]), hy = ground(hx, hz) + SQUARE.heartCrown, palette = BULBS[side];
      for (const [x, z] of squarePoles(side)) {
        const l = Math.hypot(x - hx, z - hz), a = [hx + (x - hx) / l * .7, hy, hz + (z - hz) / l * .7], b = [x, ground(x, z) + POLE_TOP, z];
        const pts = stringPoints(a, b, .75);
        const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
        cordParts.push(new THREE.TubeGeometry(curve, pts.length * 2, .012, 4, false));
        pts.slice(1, -1).forEach((p, k) => bulbsAt.push({p: [p[0], p[1] - .09, p[2]], c: palette[(k + bulbsAt.length) % palette.length]}));
      }
    }
    const g = cordParts.length ? mergeGeometries(cordParts) : new THREE.BufferGeometry(); for (const p of cordParts) p.dispose();
    cord.geometry.dispose(); cord.geometry = g;
    bulbs?.removeFromParent(); bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, bulbsAt.length); bulbs.name = 'square-bulbs'; bulbs.raycast = () => {};
    const M = new THREE.Matrix4(), C = new THREE.Color();
    bulbsAt.forEach((q, i) => { bulbs.setMatrixAt(i, M.makeTranslation(...q.p)); bulbs.setColorAt(i, C.setHex(q.c)); });
    bulbs.instanceMatrix.needsUpdate = true; bulbs.instanceColor.needsUpdate = true; bulbs.computeBoundingSphere(); root.add(bulbs);
    // Halos: one additive point per bulb in its own colour.
    halos?.removeFromParent(); halos?.geometry.dispose();
    const hg = new THREE.BufferGeometry(), hp = new Float32Array(bulbsAt.length * 3), hc = new Float32Array(bulbsAt.length * 3);
    bulbsAt.forEach((q, i) => { hp.set(q.p, i * 3); C.setHex(q.c); hc.set([C.r, C.g, C.b], i * 3); });
    hg.setAttribute('position', new THREE.BufferAttribute(hp, 3)); hg.setAttribute('color', new THREE.BufferAttribute(hc, 3)); hg.computeBoundingSphere();
    if (!haloMat) {
      haloMat = new THREE.ShaderMaterial({
        uniforms: {map: {value: glowTex}, strength: {value: .3}, scale: {value: 540}, size: {value: .55}},
        vertexShader: 'attribute vec3 color; varying vec3 vColor; uniform float scale; uniform float size; void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * scale / max(.1, -mv.z), 0., 96.); }',
        fragmentShader: 'uniform sampler2D map; uniform float strength; varying vec3 vColor; void main(){ float a = texture2D(map, gl_PointCoord).a; gl_FragColor = vec4(vColor * a * strength, 1.); }',
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      disposables.push(haloMat);
    }
    halos = new THREE.Points(hg, haloMat); halos.name = 'square-halos'; halos.renderOrder = 22; halos.frustumCulled = false; halos.raycast = () => {}; root.add(halos);
  }
  function place() { buildGround(); buildLights(); build(); placed = true; }

  /** The Blender kit: *_Trainer, *_Dummy, *_Bakery, *_Stage, *_Board, *_LightPole. */
  function installKit(gltf) {
    const scene0 = gltf.scene, need = ['Trainer', 'Dummy', 'Bakery', 'Stage', 'Board', 'LightPole'].flatMap(n => [`D_${n}`, `G_${n}`]);
    if (need.some(n => !scene0.getObjectByName(n))) return false;
    const seen = new Set();
    scene0.traverse(o => {
      if (!o.isMesh || seen.has(o.material)) return; seen.add(o.material);
      const m = o.material; m.vertexColors = !!o.geometry.attributes.color;
      if (GLOW[m.name] !== undefined) { m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = GLOW[m.name]; if (FLICKER.has(m.name)) glowMats.push({m, base: GLOW[m.name], seed: glowMats.length * 2.3}); }
      if (m.name !== 'Cloth') m.side = THREE.FrontSide;
      m.needsUpdate = true;
    });
    kit = scene0; if (placed) build();
    return true;
  }

  function sync(s) {
    snapshot = s; const on = homeBattle(s);
    if (on !== enabled) { enabled = on; root.visible = on; }
    if (on && !placed) place();
  }
  function setNight(n) { night = Math.max(0, Math.min(1, +n || 0)); }

  // ---- reactions
  /** A local Hero's swing: any dummy within reach in front of them rocks back from the blow (presentation only). */
  const _w = new THREE.Vector3(), _l = new THREE.Vector3();
  function strike(position, yaw, reach = 2.4) {
    if (!enabled) return false;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw); let hit = false;
    for (const d of dummies) {
      d.pivot.getWorldPosition(_w); const dx = _w.x - position[0], dz = _w.z - position[2], dist = Math.hypot(dx, dz);
      if (dist > reach || (dx * fx + dz * fz) / Math.max(.01, dist) < .35) continue;
      // push away from the hero, in the pivot's own frame
      _l.set(fx, 0, fz).applyQuaternion(d.pivot.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
      d.axis.set(_l.z, 0, -_l.x).normalize(); d.vel += 3.6; d.twistVel += (Math.random() - .5) * 6; hit = true;
    }
    return hit;
  }
  let tune = null; // {side, until, song}
  function event(ev) { if (ev.kind === 'square_tune' && enabled) tune = {side: ev.side, at: clock, until: clock + (+ev.length || 12), song: ev.song | 0}; }
  const tuning = side => tune && tune.side === side && clock < tune.until ? Math.min(1, (clock - tune.at) / .4, (tune.until - clock) / .6) : 0;

  const _q = new THREE.Quaternion();
  function update(dt, viewportHeight = 1080) {
    if (!enabled || !placed) return;
    dt = Math.min(.1, dt || 0); clock += dt;
    // Dummies: a damped spring back to upright, with a wobble of twist.
    for (const d of dummies) {
      d.vel += (-38 * d.tilt - 4.2 * d.vel) * dt; d.tilt += d.vel * dt; d.tilt = Math.max(-.6, Math.min(.6, d.tilt));
      d.twistVel += (-30 * d.twist - 3 * d.twistVel) * dt; d.twist += d.twistVel * dt;
      const sway = tuning(d.side) * Math.sin(clock * 6.5 + d.k * 1.7) * .06; // the dummies bob along to the bard too
      d.pivot.quaternion.setFromAxisAngle(d.axis, d.tilt + sway).multiply(_q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, d.twist));
    }
    const flick = 1 + Math.sin(clock * 7.3) * .05 + Math.sin(clock * 13.1) * .03;
    for (const g of glowMats) g.m.emissiveIntensity = g.base * (.9 + .08 * Math.sin(clock * 7.3 + g.seed) + .05 * Math.sin(clock * 13.1 + g.seed * 2)) * (1 + night * .4);
    // Festival bulbs glow softly by day and properly after dusk; while the bard plays they twinkle in time.
    const beat = Math.max(tuning('party'), tuning('rivals')) * (.5 + .5 * Math.sin(clock * 13));
    bulbMat.emissiveIntensity = (1.1 + night * 1.8) * flick + beat * .8;
    if (haloMat) { haloMat.uniforms.scale.value = viewportHeight / 2; haloMat.uniforms.strength.value = (.14 + night * .55) * flick + beat * .2; }
  }

  return {installKit, sync, update, event, setNight, strike, tuning, object: root,
    stats: () => ({enabled, placed, kit: !!kit, dummies: dummies.length, bulbs: bulbs?.count || 0, cobbles: cobbles.length, tune: !!tune && clock < tune.until}),
    dispose() { root.removeFromParent(); for (const d of disposables) d.dispose?.(); for (const m of cobbles) m.geometry.dispose(); cord.geometry.dispose(); halos?.geometry.dispose(); }};
}
