// Timberline preview: loads the exported GLBs and drives them only through
// the runtime modules a game would use. Trees here are review fixtures.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

const BASE = new URL(window.TL_BASE || '../', import.meta.url);
const {createTimberlineBallista} = await import(new URL('runtime/timberline-ballista.js', BASE).href);
const {createTimberlineBoltPair, collectMaterials} = await import(new URL('runtime/timberline-bolts.js', BASE).href);
const {createTimberlineFx} = await import(new URL('runtime/timberline-fx.js', BASE).href);
const {timberlineCutTime} = await import(new URL('runtime/timberline-flight.js', BASE).href);

const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture');
if (CAPTURE) document.body.classList.add('capture');

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: CAPTURE});
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(2, devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const sky = new THREE.Color(0xbcd3e4);
scene.background = params.get('bg') === 'studio' ? new THREE.Color(0x8d8073) : sky;
scene.fog = new THREE.Fog(scene.background, 60, 220);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

scene.add(new THREE.HemisphereLight(0xdfe9f5, 0x5a4a32, 0.9));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
sun.position.set(-6, 10, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30});
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

// Ground with a little colour noise so speed and distance read.
{
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = params.get('bg') === 'studio' ? '#8a7b6b' : '#7d955a';
  g.fillRect(0, 0, 256, 256);
  let s = 7;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '60,80,40' : '150,160,100'},${0.05 + r() * 0.12})`;
    g.fillRect(r() * 256, r() * 256, 2 + r() * 6, 2 + r() * 6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(80, 80);
  tex.anisotropy = 8;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({map: tex, roughness: 0.95}));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.95, 0);
controls.enableDamping = !CAPTURE;

const loader = new GLTFLoader();
// Hosts that cannot serve .glb may set window.TL_LOAD(path, loader, base) -> Promise<gltf>.
const load = (p) => window.TL_LOAD ? window.TL_LOAD(p, loader, BASE)
  : new Promise((res, rej) => loader.load(new URL(p, BASE).href, res, undefined, rej));
const [ballGltf, boltGltf, colGltf] = await Promise.all([
  load('out/timberline_ballista.glb'), load('out/timberline_bolts.glb'), load('out/timberline_collision.glb'),
]);

const tb = createTimberlineBallista(ballGltf, {autoReload: false});
scene.add(tb.object);
const shared = collectMaterials(tb.object);
const fx = createTimberlineFx();
scene.add(fx.object);

// Review fixtures: simple trees to fell. Not production art.
const trees = [];
const barkMat = new THREE.MeshStandardMaterial({color: 0x6d5038, roughness: 0.9});
const leafMat = new THREE.MeshStandardMaterial({color: 0x5f8a3c, roughness: 0.85, flatShading: true});
const cutMat = new THREE.MeshStandardMaterial({color: 0xd9b07a, roughness: 0.8});
function makeTree(x, z, r, h) {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 1.15, h, 10), barkMat);
  stump.position.y = h / 2;
  stump.castShadow = true;
  root.add(stump);
  const crown = new THREE.Group();
  for (const [dx, dy, dz, s] of [[0, 0, 0, 1.6], [0.8, -0.4, 0.3, 1.1], [-0.7, -0.3, -0.4, 1.2], [0.1, 0.9, 0.1, 1.0]]) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), leafMat);
    m.position.set(dx, h + 1.0 + dy, dz);
    m.castShadow = true;
    crown.add(m);
  }
  root.add(crown);
  scene.add(root);
  const t = {root, stump, crown, x, z, r, h, hit: false};
  trees.push(t);
  return t;
}
function resetTrees() {
  for (const t of trees) scene.remove(t.root);
  trees.length = 0;
  makeTree(-0.4, -26, 0.24, 4.2);
  makeTree(2.6, -34, 0.3, 4.8);
  makeTree(-3.4, -42, 0.2, 3.8);
}
resetTrees();

function fellTree(t, cutY, dir) {
  // Split at the filament height: stump stays, the rest topples away from the shot.
  t.hit = true;
  const h = t.h;
  t.root.remove(t.stump);
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(t.r * 0.95, t.r * 1.15, cutY, 10), barkMat);
  stump.position.y = cutY / 2;
  stump.castShadow = true;
  const face = new THREE.Mesh(new THREE.CircleGeometry(t.r * 0.95, 10), cutMat);
  face.rotation.x = -Math.PI / 2;
  face.position.y = cutY + 0.002;
  const top = new THREE.Group();
  top.position.set(0, cutY, 0);
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(t.r * 0.85, t.r * 0.95, h - cutY, 10), barkMat);
  upper.position.y = (h - cutY) / 2;
  upper.castShadow = true;
  top.add(upper);
  t.crown.position.y -= cutY;
  top.add(t.crown);
  t.root.add(stump, face, top);
  t.falling = {top, t: 0, axis: new THREE.Vector3(dir.z, 0, -dir.x).normalize().negate(), slide: dir.clone()};
}

// Volleys (pooled projectile visuals).
const volleys = [];
function getVolley() {
  let v = volleys.find((x) => !x.pair.alive && x.idle > 1.5);
  if (!v) {
    v = {pair: createTimberlineBoltPair(boltGltf, {sharedMaterials: shared}), idle: 0};
    scene.add(v.pair.group);
    v.pair.on('impact', (e) => { fx.chips(e.point, v.pair.state ? new THREE.Vector3(0, 0.6, 0) : new THREE.Vector3(0, 1, 0), {count: 26, speed: 3.5}); log(`impact r=${e.resistance.toFixed(2)}`); });
    v.pair.on('fins_deploy', () => log('fins_deploy'));
    v.pair.on('filament_taut', () => log('filament_taut'));
    volleys.push(v);
  }
  v.idle = 0;
  return v;
}

let simTime = 0;
const logEl = document.getElementById('log');
const lines = [];
function log(s) {
  lines.unshift(`${simTime.toFixed(3).padStart(7)}  ${s}`);
  lines.length = Math.min(lines.length, 40);
  logEl.textContent = lines.join('\n');
}

tb.on('*', (e) => { if (e.name !== 'pawl_tick') log(e.name); });
let lastVolley = null;
tb.on('release', (frame) => {
  const v = getVolley();
  lastVolley = v;
  v.pair.launch(frame);
  v.launch = frame.launch;
  for (let k = 0; k < 4; k++) fx.dust(tb.socketWorld(`FX_FootDust_${k}`), {count: 2, speed: 0.7});
});

// Impact detection against fixture trees (stands in for gameplay authority).
const _p = new THREE.Vector3();
function checkHits() {
  for (const v of volleys) {
    const s = v.pair.state;
    if (v.pendingCut && v.pair.flightTime >= v.pendingCut.at) {
      const pc = v.pendingCut;
      v.pendingCut = null;
      fellTree(pc.tree, pc.y, pc.dir);
      fx.chips(pc.point, pc.dir.clone().multiplyScalar(0.5).add(new THREE.Vector3(0, 0.7, 0)), {count: 60, speed: 5.5, along: new THREE.Vector3(1, 0, 0)});
      log('tree_cut');
    }
    if (!v.pair.alive || !s || s.phase === 'impact') continue;
    const L = v.launch;
    const c = new THREE.Vector3(...s.centre);
    for (const t of trees) {
      if (t.hit) continue;
      _p.set(t.x, c.y, t.z).sub(L.origin);
      const ahead = _p.dot(L.forward), lateral = _p.dot(L.right);
      const progress = c.clone().sub(L.origin).dot(L.forward);
      if (progress < ahead - t.r || progress > ahead + 1.5) continue;
      if (Math.abs(lateral) > s.half - 0.06 || c.y < 0.05 || c.y > t.h) continue;
      const resistance = Math.min(0.9, Math.max(0.2, t.r / 0.34));
      const point = new THREE.Vector3(t.x, c.y, t.z).addScaledVector(L.forward, -t.r);
      v.pair.impact({point, resistance});
      const cutDelay = timberlineCutTime(resistance) + 0.02;
      v.pendingCut = {tree: t, at: v.pair.flightTime + cutDelay, y: c.y, dir: L.forward.clone().setY(0).normalize(), point};
      t.hit = true;
    }
  }
}

function updateTrees(dt) {
  for (const t of trees) {
    if (!t.falling) continue;
    const f = t.falling;
    f.t += dt;
    const ang = Math.min(Math.PI / 2 * 0.96, 0.25 * f.t * f.t * 9.8 / Math.max(1, t.h) * 3 + 0.08 * f.t);
    f.top.quaternion.setFromAxisAngle(f.axis, ang);
    f.top.position.set(f.slide.x * Math.min(0.5, f.t * 0.6), f.top.position.y, f.slide.z * Math.min(0.5, f.t * 0.6));
    if (ang >= Math.PI / 2 * 0.96 && !f.landed) { f.landed = true; const p = new THREE.Vector3(); f.top.getWorldPosition(p); fx.dust(p.addScaledVector(f.slide, t.h * 0.5).setY(0.1), {count: 8, speed: 1.2}); }
  }
}

// Sockets and collision overlays.
const socketHelpers = [];
tb.object.traverse((o) => {
  if (/^(Socket_|FX_)/.test(o.name)) {
    const h = new THREE.AxesHelper(0.12);
    h.visible = false;
    o.add(h);
    socketHelpers.push(h);
  }
});
const colMat = new THREE.MeshBasicMaterial({color: 0x30ff9a, wireframe: true, transparent: true, opacity: 0.55, depthTest: false});
const colMeshes = [];
{
  const meshes = [];
  colGltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const byName = tb.nodes;
  for (const m of meshes) {
    const parent = byName[m.parent.name];
    m.material = colMat;
    m.visible = false;
    m.renderOrder = 10;
    if (parent) parent.add(m);
    colMeshes.push(m);
  }
}

// Cameras
let view = params.get('view') || 'threequarter';
let follow = null;
const VIEWS = {
  threequarter: {pos: [-3.3, 2.15, -3.5], target: [0, 0.85, 0], fov: 35, label: '¾'},
  front: {pos: [0, 1.15, -5.6], target: [0, 0.85, 0], fov: 32, label: 'Front'},
  side: {pos: [5.8, 1.2, 0.05], target: [0, 0.85, 0], fov: 32, label: 'Side'},
  top: {pos: [0, 9.5, 0.001], target: [0, 0.6, 0], fov: 22, label: 'Top'},
  back: {pos: [2.2, 1.9, 3.6], target: [0, 0.9, -0.6], fov: 40, label: 'Rear'},
  operator: {operator: true, fov: 70, label: 'Operator'},
  rts: {pos: [6.2, 31.0, 22.5], target: [0, 0, -6], fov: 70, label: 'RTS 38 m'},
  mid: {pos: [-8.5, 2.6, 3.2], target: [0, 1.0, -5], fov: 55, label: 'Side 10 m'},
  chase: {chase: true, fov: 60, label: 'Chase'},
};
function setView(name) {
  view = name;
  const v = VIEWS[name];
  camera.fov = v.fov;
  camera.updateProjectionMatrix();
  follow = v.chase ? 'chase' : v.operator ? 'operator' : null;
  controls.enabled = !follow;
  if (v.pos) {
    camera.position.set(...v.pos);
    controls.target.set(...v.target);
    camera.lookAt(controls.target);
  }
  document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('on', b.dataset.v === name));
}
const viewsEl = document.getElementById('views');
for (const [k, v] of Object.entries(VIEWS)) {
  const b = document.createElement('button');
  b.textContent = v.label;
  b.dataset.v = k;
  b.onclick = () => setView(k);
  viewsEl.append(b);
}

const _eye = new THREE.Vector3(), _fwd = new THREE.Vector3(), _q = new THREE.Quaternion();
function updateFollowCamera() {
  if (follow === 'operator') {
    tb.nodes.Traverse.getWorldQuaternion(_q);
    const pitch = tb.aim.pitch;
    tb.object.updateMatrixWorld(true);
    _eye.set(0, 1.64, 1.45).applyQuaternion(_q);
    camera.position.copy(_eye);
    _fwd.set(0, Math.sin(pitch * 0.85 - 0.12), -Math.cos(pitch * 0.85 - 0.12)).applyQuaternion(_q);
    camera.lookAt(_eye.add(_fwd));
  } else if (follow === 'chase') {
    const v = lastVolley;
    if (v && v.pair.state) {
      const c = new THREE.Vector3(...v.pair.state.centre);
      const L = v.launch;
      camera.position.copy(c).addScaledVector(L.forward, -2.4).addScaledVector(L.up, 0.55).addScaledVector(L.right, 0.12);
      camera.lookAt(c.clone().addScaledVector(L.forward, 2));
    } else {
      camera.position.set(0.6, 1.9, 2.4);
      camera.lookAt(0, 1.1, -4);
    }
  }
}

// UI
const yawEl = document.getElementById('yaw'), pitchEl = document.getElementById('pitch');
const fireEl = document.getElementById('fire'), stateEl = document.getElementById('state');
let speed = 1, autoReload = true, lodMode = null, showSockets = false, showCol = false;
function aimFromUI() {
  document.getElementById('yawv').textContent = `${yawEl.value}°`;
  document.getElementById('pitchv').textContent = `${pitchEl.value}°`;
  tb.setAim(THREE.MathUtils.degToRad(+yawEl.value), THREE.MathUtils.degToRad(+pitchEl.value));
}
yawEl.oninput = pitchEl.oninput = aimFromUI;
aimFromUI();
const speedsEl = document.getElementById('speeds');
for (const s of [1, 0.25, 0.08]) {
  const b = document.createElement('button');
  b.textContent = s === 1 ? 'Real time' : `${s}×`;
  b.dataset.s = s;
  b.onclick = () => { speed = s; speedsEl.querySelectorAll('button').forEach((x) => x.classList.toggle('on', +x.dataset.s === s)); };
  speedsEl.append(b);
}
speedsEl.firstChild.classList.add('on');
const toggle = (id, fn) => { const b = document.getElementById(id); b.onclick = () => b.classList.toggle('on', fn()); };
toggle('auto', () => (autoReload = !autoReload));
toggle('sockets', () => { showSockets = !showSockets; socketHelpers.forEach((h) => { h.visible = showSockets; }); return showSockets; });
toggle('col', () => { showCol = !showCol; colMeshes.forEach((m) => { m.visible = showCol; }); return showCol; });
toggle('targets', () => { resetTrees(); return true; });
document.getElementById('lod').onclick = (e) => {
  lodMode = lodMode === null ? 0 : lodMode === 0 ? 1 : null;
  tb.forceLod(lodMode);
  e.target.textContent = lodMode === null ? 'LOD auto' : `LOD ${lodMode}`;
};
function fire() {
  if (tb.state === 'empty') { tb.reload(); return; }
  tb.fire();
}
fireEl.onclick = fire;
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); fire(); }
  if (e.code === 'KeyR') tb.reload();
});
tb.on('empty', () => { if (!autoReload) log('empty: press Fire or R to reload'); });

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
setView(view);

function step(dt) {
  simTime += dt;
  tb.update(dt, camera, renderer.domElement.height);
  for (const v of volleys) { v.pair.update(dt, camera, renderer.domElement.height); if (!v.pair.alive) v.idle += dt; }
  checkHits();
  updateTrees(dt);
  fx.update(dt);
  updateFollowCamera();
  const busy = tb.state !== 'loaded';
  fireEl.disabled = busy && tb.state !== 'empty';
  fireEl.textContent = tb.state === 'empty' ? 'Reload (R)' : 'Fire (Space)';
  stateEl.textContent = `${tb.state} · LOD ${tb.lod} · yaw ${THREE.MathUtils.radToDeg(tb.aim.yaw).toFixed(0)}° pitch ${THREE.MathUtils.radToDeg(tb.aim.pitch).toFixed(1)}°`;
}
function render() { if (!follow) controls.update(); renderer.render(scene, camera); }

// Deterministic hooks for the capture script.
window.__tl = {
  tb, scene, camera, renderer, volleys, setView, step, render, fx, trees, resetTrees,
  setAim(yawDeg, pitchDeg, immediate = true) {
    yawEl.value = yawDeg; pitchEl.value = pitchDeg;
    if (immediate) tb.aimImmediate(THREE.MathUtils.degToRad(yawDeg), THREE.MathUtils.degToRad(pitchDeg)); else aimFromUI();
  },
  setAutoReload(on) { autoReload = on; },
  clearVolleys() { for (const v of volleys) { v.pair.kill(); v.idle = 99; v.pendingCut = null; } lastVolley = null; },
  fire() { return tb.fire(); },
  setCamera(pos, target, fov) { follow = null; camera.position.set(...pos); controls.target.set(...target); camera.fov = fov; camera.updateProjectionMatrix(); camera.lookAt(controls.target); },
  info() { const r = renderer.info; return {calls: r.render.calls, triangles: r.render.triangles, textures: r.memory.textures, geometries: r.memory.geometries}; },
  ready: true,
};
tb.aimImmediate(0, THREE.MathUtils.degToRad(4));
tb.on('empty', () => { if (autoReload && tb.state === 'empty') tb.reload(); });

if (!CAPTURE) {
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta()) * speed;
    step(dt);
    render();
  });
}
