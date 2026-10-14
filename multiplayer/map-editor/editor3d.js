// Map editor, 3D (map-editor/index.html): the real map with the game's own terrain, kits and dressing, seen through
// an RTS camera. Grab a building and drag it across the ground, turn it, drop it; pick new things from the build menu
// and place them; Save writes shared/map-layout.json (through map-editor/save-plugin.mjs) and Play opens the game with
// it. Local only: never built or deployed. All placement maths lives in map-editor/model.js.
import * as T from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import * as M from './model.js';
import {HOME_SCALE, TAVERN_SCALE, gateYaw, homePoint} from '../shared/home-bases.js';
import {backTownPoint} from '../shared/keep-sites.js';
import {treeScale} from '../shared/trees.js';
import {prepareHomeKit} from '../client/home-base-art.js';
import {buildExtraModel} from '../client/map-extras-view.js';
import {createResourceArt} from '../client/forest-resource-art.js';
import {createStartingWorld, STARTING_SITES as LANDMARKS, PATHS as LANDMARK_PATHS} from '../client/starting-world.js';
import {createMountainArena} from '../client/mountain-arena.js';
import {createAlpineForest} from '../client/alpine-forest.js';
import {createKeepCornerGround} from '../client/keep-corner-ground.js';
import {createOrchardPresentation} from '../client/orchard-presentation.js';

const $ = id => document.getElementById(id);
const H = (x, z) => { const h = M.baseHeight(x, z); return Number.isFinite(h) ? h : 0; };
const store = {get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, del(k) { try { localStorage.removeItem(k); } catch {} }};
const DRAFT_KEY = 'brann-map-editor-3d-draft-v1', CAM_KEY = 'brann-map-editor-3d-cam-v1';
const PHONE = matchMedia('(pointer: coarse)').matches || innerWidth < 760;

// ---------------------------------------------------------------- scene (dressed like the game; see tests/keep-ring-lab.html)
const canvas = $('view');
const renderer = new T.WebGLRenderer({canvas, antialias: !PHONE, powerPreference: 'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, PHONE ? 1.5 : 2));
renderer.toneMapping = T.ACESFilmicToneMapping; renderer.outputColorSpace = T.SRGBColorSpace;
const scene = new T.Scene();
{ const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment(); scene.environment = pmrem.fromScene(room, .04).texture; scene.environmentIntensity = .5; room.dispose(); }
scene.background = new T.Color(0xa9c3d8); scene.fog = new T.Fog(0xa9c3d8, 140, 320);
const hemi = new T.HemisphereLight(0xe8f2ff, 0x4a5a2a, 1.3); scene.add(hemi);
const sun = new T.DirectionalLight(0xfff0d8, 2.6); sun.position.set(-30, 50, 20); scene.add(sun);
const groundGeo = new T.PlaneGeometry(120, 120, 160, 160).rotateX(-Math.PI / 2);
{ const p = groundGeo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, H(p.getX(i), p.getZ(i))); groundGeo.computeVertexNormals(); }
const ground = new T.Mesh(groundGeo, new T.MeshStandardMaterial({color: 0x667b43, roughness: 1})); scene.add(ground);
let orchard = null, corner = null;
try { orchard = createOrchardPresentation({scene, renderer, ground, sun, hemisphere: hemi, height: H, baseHeight: H, quality: PHONE ? 'low' : 'high', edits: []}); if (orchard.objects?.backdrop) orchard.objects.backdrop.visible = false; } catch (e) { console.warn('orchard dressing unavailable', e); }
try { corner = createKeepCornerGround({scene, ground, height: H}); } catch (e) { console.warn('keep corner ground unavailable', e); }
const arena = createMountainArena({THREE: T, scene, height: H});
if (!PHONE) createAlpineForest({scene, arena, quality: 'high'});
// Pick surfaces: the meadow plus the keep corners out past it.
const pickGround = [ground];
{ const far = new T.Mesh(new T.PlaneGeometry(150, 150, 150, 150).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({visible: false}));
  const p = far.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, H(p.getX(i), p.getZ(i))); far.geometry.computeBoundingSphere(); far.geometry.computeBoundingBox(); scene.add(far); pickGround.push(far); }

// ---------------------------------------------------------------- RTS camera
const camera = new T.PerspectiveCamera(50, 1, .2, 600);
const cam = {x: -20, z: -18, yaw: Math.PI * .25, pitch: .95, dist: 70};
Object.assign(cam, store.get(CAM_KEY) || {});
function placeCamera() {
  cam.pitch = Math.max(.35, Math.min(1.53, cam.pitch)); cam.dist = Math.max(6, Math.min(190, cam.dist));
  cam.x = Math.max(-72, Math.min(72, cam.x)); cam.z = Math.max(-72, Math.min(72, cam.z));
  const y = H(cam.x, cam.z), c = Math.cos(cam.pitch);
  camera.position.set(cam.x - Math.sin(cam.yaw) * c * cam.dist, y + Math.sin(cam.pitch) * cam.dist, cam.z - Math.cos(cam.yaw) * c * cam.dist);
  camera.lookAt(cam.x, y, cam.z);
}
let camTimer = 0; const saveCam = () => { clearTimeout(camTimer); camTimer = setTimeout(() => store.set(CAM_KEY, cam), 400); };
function resize() {
  const r = canvas.getBoundingClientRect(); if (!r.width || !r.height) return;
  renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); drawMinimap();
}
new ResizeObserver(resize).observe(canvas);

// ---------------------------------------------------------------- items and kits
const items = M.buildItems(), byKey = new Map(items.map(i => [i.key, i]));
const loader = new GLTFLoader(), load = url => new Promise((ok, bad) => loader.load(url, ok, undefined, bad));
const kits = {};
const GLOW = {Crystal: 1.5, Amethyst: 1.5, Ember: 2.4, Ooze: 1.7};
function prepare(gltf) {
  const nodes = new Map(); for (const o of gltf.scene.children) nodes.set(o.name, o);
  const seen = new Set();
  gltf.scene.traverse(o => { if (!o.isMesh || seen.has(o.material)) return; seen.add(o.material); const m = o.material; m.vertexColors = !!o.geometry.attributes.color;
    if (GLOW[m.name] !== undefined) { m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = GLOW[m.name]; } m.needsUpdate = true; });
  return {nodes};
}
const resourceArt = createResourceArt();
const variantOf = id => { let h = 2166136261; for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) % 3; };

// The model for one copy of an item, its yaw rule, and its scale: everything the game's views do, minus animation.
const pre = side => side === 'rivals' ? 'G' : 'D';
const anchor = (obj, name) => obj.getObjectByName(name)?.position.clone() ?? new T.Vector3();
function kitClone(kit, name) { const n = kits[kit]?.nodes.get(name); if (!n) return null; const c = n.clone(true); c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); return c; }
function withChild(body, child, at) { if (body && child) { child.position.copy(at); body.add(child); } return body; }
function makeModel(it, side) {
  const p = pre(side), key = it.key, g = new T.Group();
  let body = null, scale = 1, yawRule = 'placement';
  if (key === 'keep.barracks') { body = kitClone('bases', `${p}_Barracks`); withChild(body, kitClone('bases', `${p}_Bell`), anchor(body ?? new T.Group(), `${p}_Barracks_Bell`)); scale = HOME_SCALE; yawRule = 'heart'; }
  else if (key === 'keep.fountain') { body = kitClone('bases', `${p}_Fountain`); if (body) { body.add(kitClone('bases', `${p}_FountainWater`)); withChild(body, kitClone('bases', `${p}_FountainCrystal`), anchor(body, `${p}_Fountain_Crystal`)); } scale = HOME_SCALE; yawRule = 'gate'; }
  else if (key.startsWith('keep.pylons')) { body = kitClone('bases', `${p}_Pylon`); withChild(body, kitClone('bases', `${p}_PylonCrystal`), anchor(body ?? new T.Group(), `${p}_Pylon_Crystal`)); scale = HOME_SCALE; yawRule = 'gate'; }
  else if (key.startsWith('keep.spires')) { body = kitClone('bases', `${p}_Spire`); if (body) { const tip = kitClone('bases', `${p}_SpireCrystal`); if (tip) { tip.position.y = anchor(body, `${p}_Spire_Crystal`).y; body.add(tip); } } scale = HOME_SCALE; yawRule = 'gate'; }
  else if (key.startsWith('keep.ballistas')) {
    body = kitClone('bases', `${p}_BallistaBase`);
    if (body) { const yoke = kitClone('bases', `${p}_BallistaYoke`), bow = kitClone('bases', `${p}_BallistaBow`); withChild(body, yoke, anchor(body, `${p}_BallistaBase_Yoke`)); withChild(yoke, bow, anchor(yoke ?? new T.Group(), `${p}_BallistaYoke_Bow`)); }
    yawRule = 'gate';
  }
  else if (key === 'keep.gate') { body = kitClone('bases', `${p}_Gate`); scale = HOME_SCALE; yawRule = 'gate'; }
  else if (key.startsWith('keep.wards')) { body = kitClone('bases', `${p}_Ward`); scale = HOME_SCALE; yawRule = 'outward'; }
  else if (key.startsWith('keep.gatePillars')) return null; // part of the gate's model; they ride with it
  else if (key === 'keep.tavern') { body = kitClone('town', `${p}_Tavern`); scale = TAVERN_SCALE; }
  else if (key === 'keep.quartermaster') body = kitClone('town', `${p}_Quartermaster`);
  else if (key === 'keep.mill') { body = kitClone('town', `${p}_Mill`); if (body) { withChild(body, kitClone('town', `${p}_MillSails`), anchor(body, `${p}_Mill_Hub`)); withChild(body, kitClone('town', `${p}_MillCrank`), anchor(body, `${p}_Mill_Crank`)); } }
  else if (key === 'mug') { body = kitClone('town', 'N_Tavern'); scale = TAVERN_SCALE; }
  else if (key.startsWith('town.lanterns')) { body = kitClone('backtown', `${p}_Lantern`); yawRule = 'pass'; }
  else if (key.startsWith('town.')) body = kitClone('backtown', `${p}_${{workshop: 'Workshop', stores: 'Stores', cottage: 'Cottage', cottage2: 'CottageB', well: 'Well'}[key.slice(5)]}`);
  else if (it.group === 'tree' || it.extraKind === 'tree') {
    const n = it.kind === 'extra' ? variantOf(it.key) : (+key.slice(4) - 1) % 3, gl = kits[['tree', 'tree_b', 'tree_young'][n]];
    if (gl) { body = gl.scene.clone(true); const h = it.kind === 'extra' ? (it.value.height ?? 6.2) : M.treeHeight(it.key); scale = treeScale({height: h, variant: n}); }
  }
  else if (it.group === 'ore') { const kind = it.extraKind ?? M.oreKind(it.key); body = resourceArt.deposit(kind, {variant: variantOf(it.key)}); }
  else if (it.kind === 'extra' && kits.backtown) body = buildExtraModel(kits.backtown.nodes, {kind: it.extraKind, style: it.value.style, yaw: 0, id: it.key});
  else if (it.kind === 'shift') {
    // Landmarks are drawn by the starting world; this is just their grab handle.
    body = new T.Mesh(new T.CylinderGeometry(it.radius * .8, it.radius * .8, 4, 20), new T.MeshBasicMaterial({visible: false})); body.position.y = 2;
  }
  if (!body) return null;
  body.scale.multiplyScalar(scale); g.add(body);
  g.userData = {it, side, yawRule};
  g.traverse(o => { if (o.isMesh) o.userData.pick = g; });
  return g;
}
const models = new Map(); // `${key}|${side}` -> group
const modelKey = (it, side) => `${it.key}|${side ?? 'world'}`;
function seat(g) {
  const {it, side, yawRule} = g.userData, pl = M.placement(it, side);
  g.position.set(pl.x, H(pl.x, pl.z), pl.z);
  if (yawRule === 'gate') g.rotation.y = gateYaw(side);
  else if (yawRule === 'heart') { const [hx, hz] = M.HOME_SITES[side]; g.rotation.y = Math.atan2(hx - pl.x, hz - pl.z); }
  else if (yawRule === 'outward') { const [hx, hz] = M.HOME_SITES[side]; g.rotation.y = Math.atan2(pl.x - hx, pl.z - hz); }
  else if (yawRule === 'pass') { const at = it.value, [cx, cz] = backTownPoint(side, [(at[0] + at[1]) / 2, (at[0] + at[1]) / 2]); g.rotation.y = Math.hypot(cx - pl.x, cz - pl.z) > .1 ? Math.atan2(cx - pl.x, cz - pl.z) : 0; }
  else if (it.kind !== 'shift' && it.kind !== 'point') g.rotation.y = pl.yaw;
}
function buildModels() {
  for (const g of models.values()) g.removeFromParent();
  models.clear();
  for (const it of items) for (const side of M.sidesOf(it)) addModel(it, side);
}
function addModel(it, side) { const g = makeModel(it, side); if (!g) return; scene.add(g); models.set(modelKey(it, side), g); seat(g); }
function removeModels(it) { for (const side of M.sidesOf(it)) { const k = modelKey(it, side); models.get(k)?.removeFromParent(); models.delete(k); } }
function reseat(it) {
  for (const side of M.sidesOf(it)) { const g = models.get(modelKey(it, side)); if (g) seat(g); }
  for (const k of it.carry || []) { const o = byKey.get(k); if (o) reseat(o); }
}
// The fixed keep hearts and the Forge, for scale.
function buildFixed() {
  for (const side of M.SIDES) {
    const body = kitClone('bases', `${pre(side)}_Heart`); if (!body) continue;
    const at = anchor(body, `${pre(side)}_Heart_Core`); for (const n of ['HeartCrystal', 'HeartRingA', 'HeartRingB']) withChild(body, kitClone('bases', `${pre(side)}_${n}`), at);
    const [x, z] = M.HOME_SITES[side]; body.scale.setScalar(HOME_SCALE); body.position.set(x, H(x, z), z); body.rotation.y = gateYaw(side); scene.add(body);
  }
  if (kits.forge) { const f = kits.forge.scene; f.rotation.y = Math.PI; f.position.set(0, H(0, 0), 0); scene.add(f); }
}

// Landmarks: the game's own starting world, rebuilt whenever one is moved.
let landmarks = null;
const LANDMARK_HOME = LANDMARKS.map(s => [s.x, s.z]), PATH_HOME = LANDMARK_PATHS.map(p => p.points.map(q => [...q]));
function buildLandmarks() {
  // The client copies already carry the saved shift; apply the editor's current one on top of the authored spot.
  LANDMARKS.forEach((s, i) => { const it = byKey.get(`site.${s.id}`), saved = M.savedShift(s.id); s.x = LANDMARK_HOME[i][0] - saved[0] + it.value.dx; s.z = LANDMARK_HOME[i][1] - saved[1] + it.value.dz; });
  for (const [i, p] of LANDMARK_PATHS.entries()) { const now = M.paths(items)[i]; if (now) p.points = now.points.map(q => [...q]); }
  if (landmarks) { landmarks.group.removeFromParent(); landmarks.dispose?.(); }
  landmarks = createStartingWorld({THREE: T, scene, height: H});
  if (kits.landmarks) landmarks.installKit(kits.landmarks);
  landmarks.update?.([]);
  landmarks.group.visible = true;
}

// ---------------------------------------------------------------- overlays: footprints, rings, arrows
const overlay = new T.Group(); overlay.renderOrder = 10; scene.add(overlay);
const lineMat = color => new T.LineBasicMaterial({color, transparent: true, opacity: .95, depthTest: false});
const MAT = {sel: lineMat(0xffffff), twin: lineMat(0xffd27a), bad: lineMat(0xff4a3d), steep: lineMat(0xffa23a), ghost: lineMat(0xbfd6ff), place: lineMat(0x7dffb0), noplace: lineMat(0xff4a3d)};
function drape(points, mat) {
  const g = new T.BufferGeometry().setFromPoints(points.map(([x, z]) => new T.Vector3(x, H(x, z) + .12, z)));
  const l = new T.Line(g, mat); l.renderOrder = 10; overlay.add(l); return l;
}
function outline(shape, mat) {
  if (shape.r !== undefined) { const n = Math.max(16, Math.min(64, Math.round(shape.r * 12))); return drape(Array.from({length: n + 1}, (_, i) => [shape.x + Math.cos(i / n * Math.PI * 2) * shape.r, shape.z + Math.sin(i / n * Math.PI * 2) * shape.r]), mat); }
  const c = M.boxCorners(shape); const pts = []; for (let k = 0; k < 4; k++) { const a = c[k], b = c[(k + 1) % 4]; for (let t = 0; t < 1; t += .25) pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); } pts.push(c[0]);
  return drape(pts, mat);
}
const handleMesh = new T.Mesh(new T.SphereGeometry(.45, 16, 12), new T.MeshBasicMaterial({color: 0xffc35a, depthTest: false})); handleMesh.renderOrder = 11; scene.add(handleMesh);
const arrowLine = new T.Line(new T.BufferGeometry(), lineMat(0xffc35a)); arrowLine.renderOrder = 11; scene.add(arrowLine);
function drawOverlays() {
  for (const c of [...overlay.children]) { c.geometry.dispose(); overlay.remove(c); }
  for (const inst of insts) {
    if (inst.fixed) continue;
    const sel = selected && inst.it === selected.it, bad = badSet.has(inst), steep = groundSet.has(inst);
    if (!sel && !bad && !steep && !(hover && inst.it === hover.it)) continue;
    const mat = bad ? MAT.bad : sel ? (inst.side === selected.side ? MAT.sel : MAT.twin) : steep ? MAT.steep : MAT.ghost;
    for (const s of inst.shapes) outline(s, mat);
  }
  // Where it stood in the code, while moved.
  if (selected && selected.it.authored && JSON.stringify(selected.it.value) !== JSON.stringify(selected.it.authored)) {
    const ghost = {...selected.it, value: selected.it.authored};
    for (const s of M.footprint(ghost, selected.side)) outline(s, MAT.ghost).material = MAT.ghost;
  }
  if (placing?.ghostShapes) for (const s of placing.ghostShapes) outline(s, placing.ok ? MAT.place : MAT.noplace);
  const h = handlePos();
  handleMesh.visible = arrowLine.visible = !!h;
  if (h) { handleMesh.position.copy(h.at); arrowLine.geometry.dispose(); arrowLine.geometry = new T.BufferGeometry().setFromPoints([h.from, h.at]); }
}
function handlePos() {
  if (!selected || !selected.it.rotatable || drag?.mode === 'move') return null;
  const inst = insts.find(i => i.it === selected.it && i.side === selected.side); if (!inst) return null;
  const pl = M.placement(selected.it, selected.side), len = Math.min(inst.r, 9) + 1.6, x = pl.x + Math.sin(pl.yaw) * len, z = pl.z + Math.cos(pl.yaw) * len;
  return {from: new T.Vector3(pl.x, H(pl.x, pl.z) + .5, pl.z), at: new T.Vector3(x, H(x, z) + .5, z)};
}

// ---------------------------------------------------------------- state, problems, undo
let selected = null, hover = null, drag = null, placing = null;
let insts = [], probs = [], badSet = new Set(), groundSet = new Set();
let undoStack = [], redoStack = [], savedText = M.layoutFile(items);
const snapshot = () => JSON.stringify(M.layoutFile(items));
function restore(text) {
  const data = JSON.parse(JSON.parse(text));
  for (const it of [...items]) if (it.kind === 'extra') { removeModels(it); items.splice(items.indexOf(it), 1); byKey.delete(it.key); }
  for (const it of items) { const m = data.moves[it.key]; it.value = JSON.parse(JSON.stringify(m ?? it.authored)); if (it.kind === 'shift' && !m) it.value = {dx: 0, dz: 0}; }
  for (const e of data.extras || []) { const it = M.extraItem(e); items.push(it); byKey.set(it.key, it); addModel(it, null); }
  if (selected && !items.includes(selected.it)) selected = null;
  for (const it of items) reseat(it);
  buildLandmarks();
}
function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 150) undoStack.shift(); redoStack = []; }
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); changed(); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); changed(); }
const sideName = side => side === 'party' ? 'Dawnhold' : side === 'rivals' ? 'Grumblekeep' : '';
const nameOf = inst => inst.side && inst.it.group !== 'fixed' ? `${inst.it.label} (${sideName(inst.side)})` : inst.it.label;
function recompute() {
  insts = M.instances(items);
  const ov = M.overlaps(insts), gr = M.badGround(insts);
  badSet = new Set(ov.flatMap(o => [o.a, o.b])); groundSet = new Set(gr.map(g => g.p));
  probs = [...ov.map(o => ({kind: 'overlap', text: `${nameOf(o.a)} overlaps ${nameOf(o.b)} by ${o.depth.toFixed(1)} m`, at: o.a.fixed ? o.b : o.a})),
    ...gr.map(g => ({kind: 'ground', text: `${nameOf(g.p)} is ${g.why}`, at: g.p}))];
}
function changed() {
  recompute(); renderPanel(); drawOverlays(); drawMinimap();
  const text = M.layoutFile(items), dirty = text !== savedText;
  $('save').classList.toggle('dirty', dirty); $('undo').disabled = !undoStack.length; $('redo').disabled = !redoStack.length;
  if (dirty) store.set(DRAFT_KEY, {base: savedText, text}); else store.del(DRAFT_KEY);
}

// ---------------------------------------------------------------- picking
const ray = new T.Raycaster(), ndc = new T.Vector2();
function setRay(e) { const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, camera); }
function groundAt(e) { setRay(e); const hit = ray.intersectObjects(pickGround, false)[0]; return hit ? [hit.point.x, hit.point.z] : null; }
const visibleGroup = it => shown[it.group === 'extra' ? 'extra' : it.group] !== false;
function pickModel(e) {
  setRay(e);
  const targets = [...models.values()].filter(g => visibleGroup(g.userData.it));
  const hits = ray.intersectObjects(targets, true);
  for (const h of hits) { const g = h.object.userData.pick; if (g) return g; }
  // Small things (lanterns, ore) are easier to grab by their footprint on the ground.
  const at = groundAt(e); if (!at) return null;
  let best = null, bestR = Infinity;
  for (const inst of insts) {
    if (inst.fixed || !visibleGroup(inst.it)) continue;
    const pad = Math.max(.6, cam.dist * .012);
    if (Math.hypot(at[0] - inst.x, at[1] - inst.z) < Math.min(inst.r, 2.5) + pad && inst.r < bestR) { best = models.get(modelKey(inst.it, inst.side)); bestR = inst.r; }
  }
  return best;
}

// ---------------------------------------------------------------- input: mouse, touch, keys
const pointers = new Map();
const snap = (v, step, e) => e?.altKey ? v : Math.round(v / step) * step;
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
  if (pointers.size === 2) { drag = twoFinger(); return; }
  if (e.button === 2 || e.button === 1) { drag = {mode: 'orbit', x: e.clientX, y: e.clientY}; return; }
  if (placing) { placing.down = {x: e.clientX, y: e.clientY}; return; }
  const h = handlePos();
  if (h) { const r = canvas.getBoundingClientRect(), s = h.at.clone().project(camera), sx = (s.x + 1) / 2 * r.width + r.left, sy = (1 - s.y) / 2 * r.height + r.top;
    if (Math.hypot(e.clientX - sx, e.clientY - sy) < (PHONE ? 26 : 16)) { pushUndo(); drag = {mode: 'turn'}; return; } }
  const g = pickModel(e);
  if (g) {
    const {it, side} = g.userData, pl = M.placement(it, side), at = groundAt(e) ?? [pl.x, pl.z];
    selected = {it, side}; renderPanel(); drawOverlays();
    drag = {mode: 'move', off: [pl.x - at[0], pl.z - at[1]], x: e.clientX, y: e.clientY, moved: false, before: snapshot()};
    return;
  }
  const at = groundAt(e); drag = {mode: 'pan', at, x: e.clientX, y: e.clientY, click: true};
});
function twoFinger() {
  const [a, b] = [...pointers.values()];
  return {mode: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], dist: cam.dist, yaw: cam.yaw, pitch: cam.pitch};
}
canvas.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
  if (placing) { movePlacing(e); return; }
  if (!drag) { hoverAt(e); return; }
  if (drag.mode === 'pinch' && pointers.size === 2) {
    const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x), mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    cam.dist = drag.dist * drag.d / Math.max(20, d); cam.yaw = drag.yaw - (ang - drag.ang); cam.pitch = drag.pitch + (mid[1] - drag.mid[1]) * .006; placeCamera(); saveCam(); return;
  }
  if (drag.mode === 'orbit') { cam.yaw -= (e.clientX - drag.x) * .006; cam.pitch += (e.clientY - drag.y) * .005; drag.x = e.clientX; drag.y = e.clientY; placeCamera(); saveCam(); return; }
  if (drag.mode === 'pan') {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) drag.click = false;
    if (!drag.at) return;
    const now = groundAt(e); if (!now) return;
    cam.x += drag.at[0] - now[0]; cam.z += drag.at[1] - now[1]; placeCamera(); saveCam(); return;
  }
  if (drag.mode === 'move') {
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    if (!drag.moved) { undoStack.push(drag.before); redoStack = []; drag.moved = true; canvas.classList.add('grabbing'); }
    const at = groundAt(e); if (!at) return;
    M.moveTo(selected.it, selected.side, snap(at[0] + drag.off[0], .25, e), snap(at[1] + drag.off[1], .25, e), byKey);
    reseat(selected.it); recompute(); drawOverlays(); renderSelection(); return;
  }
  if (drag.mode === 'turn') {
    const at = groundAt(e); if (!at) return; const pl = M.placement(selected.it, selected.side);
    M.turnTo(selected.it, selected.side, snap(Math.atan2(at[0] - pl.x, at[1] - pl.z), Math.PI / 24, e)); reseat(selected.it); recompute(); drawOverlays(); renderSelection();
  }
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (placing) { if (placing.down && Math.hypot(e.clientX - placing.down.x, e.clientY - placing.down.y) < 8 && e.button !== 2) commitPlacing(e); else if (e.button === 2) stopPlacing(); placing && (placing.down = null); return; }
  if (!drag) return;
  if (drag.mode === 'pinch') { drag = null; return; }
  const was = drag; drag = null; canvas.classList.remove('grabbing');
  if (was.mode === 'pan' && was.click) { selected = null; renderPanel(); drawOverlays(); }
  if (was.mode === 'move' && was.moved && selected?.it.kind === 'shift') buildLandmarks();
  if ((was.mode === 'move' && was.moved) || was.mode === 'turn') changed();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  // While holding a building (or about to place one) the wheel turns it, like the game's build placement.
  const turning = (drag?.mode === 'move' && selected?.it.rotatable) || placing;
  if (turning) { rotateBy(Math.sign(e.deltaY || e.deltaX) * Math.PI / 12); return; }
  const before = groundAt(e); cam.dist *= Math.exp(e.deltaY * .0012); placeCamera();
  const after = groundAt(e); if (before && after) { cam.x += before[0] - after[0]; cam.z += before[1] - after[1]; placeCamera(); }
  saveCam();
}, {passive: false});
function hoverAt(e) {
  const g = pickModel(e), it = g?.userData.it ?? null;
  if (it !== hover?.it) { hover = g ? {it, side: g.userData.side} : null; canvas.classList.toggle('over', !!g); drawOverlays(); showTip(e, hover); }
  else if (hover) showTip(e, hover);
}
function showTip(e, h) { const tip = $('tip'); if (!h) { tip.hidden = true; return; } tip.hidden = false; tip.textContent = h.side ? `${h.it.label} · ${sideName(h.side)}` : h.it.label; const r = canvas.getBoundingClientRect(); tip.style.left = `${e.clientX - r.left + 14}px`; tip.style.top = `${e.clientY - r.top + 14}px`; }
function rotateBy(d) {
  if (placing) { placing.yaw += d; movePlacing(null); return; }
  if (!selected?.it.rotatable) return;
  const pl = M.placement(selected.it, selected.side); if (drag?.mode !== 'move') pushUndo();
  M.turnTo(selected.it, selected.side, pl.yaw + d); reseat(selected.it); changed();
}
const held = new Set();
addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 's') { e.preventDefault(); save(); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicate(); return; }
  if (k === 'escape') { if (placing) stopPlacing(); else { selected = null; renderPanel(); drawOverlays(); } return; }
  if (k === 'delete' || k === 'backspace') { removeSelected(); return; }
  if (k === 'r') { rotateBy((e.shiftKey ? -1 : 1) * Math.PI / 12); return; }
  if (k === 'q') { cam.yaw += Math.PI / 4; placeCamera(); saveCam(); return; }
  if (k === 'e') { cam.yaw -= Math.PI / 4; placeCamera(); saveCam(); return; }
  if (k === 't') { topView(); return; }
  if (k === 'f') { frameSelection(); return; }
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { held.add(k); e.preventDefault(); }
});
addEventListener('keyup', e => held.delete(e.key.toLowerCase()));
addEventListener('blur', () => held.clear());
function panKeys(dt) {
  let f = 0, r = 0;
  if (held.has('w') || held.has('arrowup')) f++; if (held.has('s') || held.has('arrowdown')) f--;
  if (held.has('d') || held.has('arrowright')) r++; if (held.has('a') || held.has('arrowleft')) r--;
  if (!f && !r) return;
  const sp = cam.dist * .9 * dt; cam.x += (Math.sin(cam.yaw) * f - Math.cos(cam.yaw) * r) * sp; cam.z += (Math.cos(cam.yaw) * f + Math.sin(cam.yaw) * r) * sp; placeCamera(); saveCam();
}
function topView() { cam.pitch = cam.pitch > 1.4 ? .95 : 1.53; placeCamera(); saveCam(); }
function frameSelection() { if (!selected) { cam.x = 0; cam.z = 0; cam.dist = 120; cam.pitch = 1.2; } else { const pl = M.placement(selected.it, selected.side); cam.x = pl.x; cam.z = pl.z; cam.dist = Math.max(18, Math.min(45, cam.dist)); } placeCamera(); saveCam(); }
function focus(inst) { selected = inst.fixed ? null : {it: inst.it, side: inst.side}; cam.x = inst.x; cam.z = inst.z; cam.dist = Math.min(cam.dist, 40); placeCamera(); saveCam(); renderPanel(); drawOverlays(); }

// ---------------------------------------------------------------- build menu
function startPlacing(kind) {
  stopPlacing();
  const it = M.extraItem({id: 'x0', kind, x: cam.x, z: cam.z, yaw: placingYaw, ...(kind === 'tree' ? {height: 6.2} : {})});
  it.value.style = ['cottage', 'cottageB', 'well', 'lantern'].includes(kind) ? (cam.x + cam.z > 0 ? 'rivals' : 'party') : undefined;
  const g = makeModel(it, null); if (!g) { toast('That model is still loading.', true); return; }
  g.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = .6; o.material.depthWrite = false; } });
  scene.add(g); placing = {kind, it, model: g, yaw: placingYaw, ok: true};
  document.querySelectorAll('.card').forEach(c => c.classList.toggle('active', c.dataset.kind === kind));
  $('hint').textContent = PHONE ? 'Tap the ground to place. Tap the card again to stop.' : 'Click to place · R or scroll turns it · Shift-click places more · Esc stops';
  selected = null; renderPanel(); movePlacing(null);
}
let placingYaw = 0, lastPointer = null;
function movePlacing(e) {
  if (e) lastPointer = e; if (!placing || !lastPointer) return;
  const at = groundAt(lastPointer); if (!at) return;
  const it = placing.it; it.value = {...it.value, x: snap(at[0], .25, lastPointer), z: snap(at[1], .25, lastPointer), yaw: placing.yaw};
  seat(placing.model);
  const probe = {it, side: null, shapes: M.footprint(it, null), x: it.value.x, z: it.value.z, r: 4};
  probe.r = Math.max(...probe.shapes.map(s => Math.hypot(s.x - probe.x, s.z - probe.z) + (s.r ?? Math.hypot(s.hu, s.hv))));
  const hit = M.overlaps([probe, ...insts]).some(o => o.a === probe || o.b === probe), offMap = M.badGround([probe]).length > 0;
  placing.ok = !hit && !offMap; placing.ghostShapes = probe.shapes; placing.why = hit ? 'Overlaps something' : offMap ? 'Too steep or off the map' : '';
  drawOverlays(); $('hint').classList.toggle('warn', !placing.ok);
}
function commitPlacing(e) {
  movePlacing(e); if (!placing) return;
  pushUndo();
  const v = placing.it.value, it = M.addExtra(items, placing.kind, v.x, v.z, v.yaw, {...(v.style ? {style: v.style} : {}), ...(v.height ? {height: v.height} : {})});
  byKey.set(it.key, it); addModel(it, null);
  placingYaw = placing.yaw;
  const {ok, why} = placing, keep = e?.shiftKey || PHONE; // phones keep placing until the card is tapped again
  if (!keep) { stopPlacing(); selected = {it, side: null}; }
  changed();
  if (!ok) toast(`${why}: placed anyway, and listed under Problems.`, true);
}
function stopPlacing() {
  if (!placing) return; placing.model.removeFromParent(); placing = null;
  document.querySelectorAll('.card').forEach(c => c.classList.remove('active'));
  $('hint').textContent = ''; $('hint').classList.remove('warn'); drawOverlays();
}
function removeSelected() {
  if (!selected) return;
  if (!selected.it.removable) { toast('Only things you added can be removed. Use Reset to move this back.', true); return; }
  pushUndo(); const it = selected.it; removeModels(it); items.splice(items.indexOf(it), 1); byKey.delete(it.key); selected = null; changed();
}
function duplicate() {
  if (!selected?.it.removable) return; const v = selected.it.value;
  pushUndo(); const it = M.addExtra(items, selected.it.extraKind, v.x + 2, v.z + 2, v.yaw, {...(v.style ? {style: v.style} : {}), ...(v.height ? {height: v.height} : {})});
  byKey.set(it.key, it); addModel(it, null); selected = {it, side: null}; changed();
}
const ICONS = {
  cottage: '<path d="M4 20V11l8-6 8 6v9z" fill="#c98b55"/><path d="M2 12l10-8 10 8" stroke="#7a3f2a" stroke-width="2.4" fill="none"/><rect x="10" y="14" width="4" height="6" fill="#4a2c1a"/>',
  cottageB: '<path d="M2 20v-8l6-5h8l6 5v8z" fill="#c98b55"/><path d="M1 13l7-6h8l7 6" stroke="#7a3f2a" stroke-width="2.4" fill="none"/><rect x="6" y="14" width="3" height="3" fill="#ffd27a"/><rect x="15" y="14" width="3" height="3" fill="#ffd27a"/>',
  well: '<ellipse cx="12" cy="17" rx="7" ry="3" fill="#8f8a80"/><rect x="5" y="13" width="14" height="5" fill="#a39d92"/><path d="M6 13V6M18 13V6" stroke="#6b4a2c" stroke-width="2"/><path d="M4 7l8-4 8 4z" fill="#7a3f2a"/>',
  lantern: '<path d="M12 21V5" stroke="#5e4229" stroke-width="2"/><path d="M12 5h5" stroke="#5e4229" stroke-width="2"/><rect x="15" y="7" width="4" height="5" rx="1" fill="#ffd27a"/><circle cx="17" cy="9.5" r="5" fill="#ffd27a" opacity=".25"/>',
  tree: '<path d="M12 3l7 11H5z" fill="#4f9a3e"/><path d="M12 7l8 11H4z" fill="#3f8a33"/><rect x="11" y="17" width="2" height="5" fill="#6b4a2c"/>',
  stone: '<path d="M4 18l2-7 5-4 6 2 3 7-3 3H7z" fill="#a19d93"/><path d="M11 7l1 6 5 3" stroke="#77736a" fill="none"/>',
  iron: '<path d="M4 18l2-7 5-4 6 2 3 7-3 3H7z" fill="#8a837a"/><circle cx="10" cy="13" r="1.8" fill="#d0835a"/><circle cx="15" cy="15" r="1.4" fill="#d0835a"/>',
  mithril: '<path d="M4 18l2-7 5-4 6 2 3 7-3 3H7z" fill="#7e8890"/><circle cx="10" cy="13" r="1.8" fill="#7fe2ff"/><circle cx="15" cy="15" r="1.4" fill="#7fe2ff"/>',
  crystal: '<path d="M5 20l3-9 3 9zM10 20l3-14 3 14zM15 20l2-7 3 7z" fill="#c58bff"/>',
};
function buildPalette() {
  const el = $('palette'); el.innerHTML = '';
  for (const p of M.PALETTE) {
    const b = document.createElement('button'); b.className = 'card'; b.dataset.kind = p.kind; b.title = `Place a ${p.label.toLowerCase()}`;
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[p.kind] ?? ''}</svg><span>${p.label}</span>`;
    b.onclick = () => placing?.kind === p.kind ? stopPlacing() : startPlacing(p.kind);
    el.append(b);
  }
}

// ---------------------------------------------------------------- side panel
const shown = {keep: true, town: true, mug: true, landmark: true, tree: true, ore: true, extra: true};
function renderSelection() {
  const el = $('selection');
  if (PHONE) $('side').classList.toggle('collapsed', !selected); // phones keep the map clear until something is picked
  if (!selected) { el.innerHTML = `<p class="empty">${PHONE ? 'Tap' : 'Click'} a building to pick it up, or choose something from the build menu below.</p>`; return; }
  const {it, side} = selected, pl = M.placement(it, side), deg = Math.round(((pl.yaw * 180 / Math.PI) % 360 + 360) % 360);
  const moved = it.authored ? JSON.stringify(it.value) !== JSON.stringify(it.authored) : false;
  const tags = [it.frame !== 'world' ? '<span class="badge">mirrored in both keeps</span>' : '', moved ? '<span class="badge on">moved</span>' : '', it.removable ? '<span class="badge new">added</span>' : ''].join('');
  el.innerHTML = `<div class="sel-name">${it.label}</div>
    <div class="sel-sub">${it.frame !== 'world' ? `${sideName(side)} copy` : ''}${tags}</div>
    <div class="row"><label>Position</label><div class="pair"><input id="in-x" type="number" step="0.25" value="${pl.x.toFixed(2)}" aria-label="x"><input id="in-z" type="number" step="0.25" value="${pl.z.toFixed(2)}" aria-label="z"></div></div>
    ${it.rotatable ? `<div class="row"><label>Facing</label><div class="turn"><button class="btn icon" id="rot-l" title="Turn left (Shift+R)">⟲</button><input id="in-yaw" type="range" min="0" max="360" step="1" value="${deg}" aria-label="Facing in degrees"><button class="btn icon" id="rot-r" title="Turn right (R)">⟳</button></div></div>` : ''}
    ${it.value.style !== undefined ? `<div class="row"><label>Style</label><div class="seg"><button class="btn small ${it.value.style !== 'rivals' ? 'on' : ''}" data-style="party">Dawnhold</button><button class="btn small ${it.value.style === 'rivals' ? 'on' : ''}" data-style="rivals">Grumblekeep</button></div></div>` : ''}
    <div class="actions">${it.authored ? `<button class="btn small" id="reset-sel" ${moved ? '' : 'disabled'}>Reset</button>` : ''}${it.removable ? '<button class="btn small" id="dup-sel">Duplicate</button><button class="btn small danger" id="del-sel">Remove</button>' : ''}<button class="btn small" id="go-sel">Go to</button></div>`;
  const setPos = () => { const x = +$('in-x').value, z = +$('in-z').value; if (!Number.isFinite(x) || !Number.isFinite(z)) return; pushUndo(); M.moveTo(it, side, x, z, byKey); reseat(it); if (it.kind === 'shift') buildLandmarks(); changed(); };
  $('in-x').onchange = setPos; $('in-z').onchange = setPos;
  if (it.rotatable) {
    const y = $('in-yaw'); y.onpointerdown = () => pushUndo(); y.oninput = () => { M.turnTo(it, side, +y.value * Math.PI / 180); reseat(it); recompute(); drawOverlays(); }; y.onchange = () => changed();
    $('rot-l').onclick = () => rotateBy(-Math.PI / 12); $('rot-r').onclick = () => rotateBy(Math.PI / 12);
  }
  el.querySelectorAll('[data-style]').forEach(b => { b.onclick = () => { pushUndo(); it.value = {...it.value, style: b.dataset.style}; removeModels(it); addModel(it, null); changed(); }; });
  $('reset-sel') && ($('reset-sel').onclick = () => { pushUndo(); it.value = JSON.parse(JSON.stringify(it.authored)); for (const k of it.carry || []) { const o = byKey.get(k); if (o) { o.value = JSON.parse(JSON.stringify(o.authored)); reseat(o); } } reseat(it); if (it.kind === 'shift') buildLandmarks(); changed(); });
  $('dup-sel') && ($('dup-sel').onclick = duplicate); $('del-sel') && ($('del-sel').onclick = removeSelected);
  $('go-sel').onclick = frameSelection;
}
function renderPanel() {
  renderSelection();
  const pe = $('problems');
  pe.innerHTML = probs.length ? `<ul class="problems">${probs.map((p, n) => `<li data-n="${n}" class="${p.kind === 'ground' ? 'warn' : ''}">${p.text}</li>`).join('')}</ul>` : '<p class="ok">Nothing overlaps and nothing sits on a cliff.</p>';
  pe.querySelectorAll('li').forEach(li => { li.onclick = () => focus(probs[+li.dataset.n].at); });
  $('problem-count').textContent = probs.length ? String(probs.length) : '';
  const moves = Object.keys(M.exportMoves(items)).length, added = items.filter(i => i.removable).length;
  $('summary').textContent = moves || added ? `${moves} moved · ${added} added` : 'Nothing changed yet';
}

// ---------------------------------------------------------------- minimap
const mini = $('minimap'), mctx = mini.getContext('2d');
let miniTerrain = null;
function buildMiniTerrain() {
  const N = 140, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), img = g.createImageData(N, N), E = M.WORLD_EXTENT;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -E + (i + .5) / N * 2 * E, z = E - (j + .5) / N * 2 * E, h = H(x, z), hx = H(x + 1, z) - H(x - 1, z), hi = Math.min(1, Math.max(0, (h - 3) / 22)), sh = Math.max(.5, Math.min(1.2, 1 - hx * .25));
    const o = (j * N + i) * 4; img.data[o] = (92 + 58 * hi) * sh; img.data[o + 1] = (128 + 18 * hi) * sh; img.data[o + 2] = (74 + 66 * hi) * sh; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); miniTerrain = c;
}
const MINI_COLORS = {keep: '#6fb2ff', town: '#f2b95b', mug: '#ff9a5c', landmark: '#4fd6c4', tree: '#7fcf6a', ore: '#ff86d5', extra: '#ffe08a'};
function drawMinimap() {
  if (!miniTerrain) return; const S = mini.width, E = M.WORLD_EXTENT, P = (x, z) => [(x + E) / (2 * E) * S, (E - z) / (2 * E) * S];
  mctx.drawImage(miniTerrain, 0, 0, S, S);
  for (const inst of insts) {
    if (inst.fixed) continue; const [x, y] = P(inst.x, inst.z);
    mctx.fillStyle = badSet.has(inst) ? '#ff4a3d' : inst.side === 'rivals' && inst.it.group === 'keep' ? '#b98cff' : MINI_COLORS[inst.it.group] ?? '#fff';
    mctx.beginPath(); mctx.arc(x, y, inst.it.group === 'tree' || inst.it.group === 'ore' ? 1.4 : Math.max(1.8, Math.min(5, inst.r * S / (2 * E))), 0, Math.PI * 2); mctx.fill();
  }
  // The camera's view, as a wedge.
  const [cx, cy] = P(cam.x, cam.z), [px, py] = P(camera.position.x, camera.position.z);
  mctx.strokeStyle = '#fff'; mctx.lineWidth = 1.5; mctx.beginPath(); mctx.arc(cx, cy, Math.max(4, cam.dist * S / (2 * E) * .35), 0, Math.PI * 2); mctx.stroke();
  mctx.beginPath(); mctx.moveTo(px, py); mctx.lineTo(cx, cy); mctx.stroke();
}
mini.addEventListener('pointerdown', e => {
  const r = mini.getBoundingClientRect(), E = M.WORLD_EXTENT, go = ev => { cam.x = ((ev.clientX - r.left) / r.width * 2 - 1) * E; cam.z = -((ev.clientY - r.top) / r.height * 2 - 1) * E; placeCamera(); saveCam(); drawMinimap(); };
  go(e); mini.setPointerCapture(e.pointerId); mini.onpointermove = ev => { if (ev.buttons) go(ev); }; mini.onpointerup = () => { mini.onpointermove = null; };
});

// ---------------------------------------------------------------- save, play, copy
let toastTimer = 0;
function toast(text, bad = false) { const t = $('toast'); t.textContent = text; t.classList.toggle('bad', bad); t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), bad ? 5000 : 3000); }
async function save(quiet = false) {
  const text = M.layoutFile(items);
  try {
    const r = await fetch('/__map-layout', {method: 'POST', headers: {'content-type': 'application/json'}, body: text});
    const out = await r.json().catch(() => ({}));
    if (!r.ok || !out.ok) throw Error(out.error || `HTTP ${r.status}`);
    savedText = text; store.del(DRAFT_KEY); changed();
    if (!quiet) toast('Saved. Press Play to try it, or Copy to send it to Claude.');
    return true;
  } catch (err) { toast(`Couldn't save (${err.message}). Is "npm run map" still running?`, true); return false; }
}
async function play() {
  if (M.layoutFile(items) !== savedText && !(await save(true))) return;
  const w = open('/?solo', '_blank');
  toast(w ? 'Opened the game in a new tab: press Play there for a fresh solo world with this layout.' : 'Pop-up blocked: open 127.0.0.1:5178/?solo yourself.');
}
async function copy() {
  const text = M.layoutFile(items);
  try { await navigator.clipboard.writeText(text); toast('Layout copied. Paste it to Claude in the project thread.'); }
  catch { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type: 'application/json'})); a.download = 'map-layout.json'; a.click(); toast('Downloaded map-layout.json (the clipboard was blocked).'); }
}
$('save').onclick = () => save(); $('play').onclick = play; $('copy').onclick = copy; $('undo').onclick = undo; $('redo').onclick = redo;
$('top').onclick = topView; $('fit').onclick = () => { selected = null; frameSelection(); renderPanel(); drawOverlays(); };
$('panel-toggle').onclick = () => { $('side').classList.toggle('collapsed'); requestAnimationFrame(resize); };
$('layers').querySelectorAll('[data-layer]').forEach(b => { b.onclick = () => {
  const k = b.dataset.layer; shown[k] = !shown[k]; b.setAttribute('aria-pressed', shown[k]);
  for (const g of models.values()) g.visible = visibleGroup(g.userData.it);
  if (k === 'landmark' && landmarks) landmarks.group.visible = shown[k];
  if (selected && !visibleGroup(selected.it)) { selected = null; renderPanel(); } drawOverlays();
}; });

// ---------------------------------------------------------------- start
async function start() {
  $('loading').textContent = 'Loading the map…';
  const want = {bases: '/assets/bases_kit.glb', town: '/assets/town_kit.glb', backtown: '/assets/backtown_kit.glb', landmarks: '/assets/landmarks_kit.glb',
    tree: '/assets/tree.glb', tree_b: '/assets/tree_b.glb', tree_young: '/assets/tree_young.glb', forge: '/assets/forge.glb'};
  await Promise.all(Object.entries(want).map(async ([k, url]) => {
    try { const gl = await load(url); kits[k] = k === 'bases' ? (prepareHomeKit(gl) ?? prepare(gl)) : k === 'town' || k === 'backtown' ? prepare(gl) : gl; if (k === 'landmarks') kits[k] = gl; }
    catch (e) { console.warn('could not load', url, e); }
  }));
  buildFixed(); buildModels(); buildLandmarks(); buildMiniTerrain(); buildPalette();
  // Unsaved work from last time, if the file hasn't changed underneath it.
  const draft = store.get(DRAFT_KEY);
  if (draft?.base === savedText && draft.text && draft.text !== savedText) { $('draft').hidden = false;
    $('draft-restore').onclick = () => { pushUndo(); restore(JSON.stringify(draft.text)); $('draft').hidden = true; changed(); };
    $('draft-discard').onclick = () => { store.del(DRAFT_KEY); $('draft').hidden = true; }; }
  else if (draft) store.del(DRAFT_KEY);
  placeCamera(); resize(); changed();
  $('loading').hidden = true;
  if (new URLSearchParams(location.search).has('still')) { renderer.render(scene, camera); window.__mapEditor.ready = true; return; }
  // Draw only while something moves (an editor sits still most of the time; laptops and phones stay cool).
  let last = performance.now();
  renderer.setAnimationLoop(now => {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    panKeys(dt);
    if (now > awakeUntil && !held.size && !drag && !placing) return;
    corner?.sync?.(); orchard?.update?.(dt, camera); resourceArt.update?.(now / 1000);
    renderer.render(scene, camera);
  });
}
let awakeUntil = performance.now() + 4000;
const wake = (ms = 600) => { awakeUntil = Math.max(awakeUntil, performance.now() + ms); };
for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown']) addEventListener(ev, () => wake(), {passive: true});
new ResizeObserver(() => wake()).observe(canvas);
window.__mapEditor = {camera, render: () => { renderer.render(scene, camera); }, items, cam, models, select: key => { const it = byKey.get(key); selected = it ? {it, side: M.sidesOf(it)[0]} : null; renderPanel(); drawOverlays(); }, frame: () => frameSelection(), layout: () => M.layoutFile(items), place: (kind, x, z, yaw = 0) => { pushUndo(); const it = M.addExtra(items, kind, x, z, yaw, ['cottage', 'cottageB', 'well', 'lantern'].includes(kind) ? {style: 'party'} : {}); byKey.set(it.key, it); addModel(it, null); changed(); return it.key; }, view: v => { Object.assign(cam, v); placeCamera(); }};
start();
