// node tests/hero-equipment-check.mjs — remote Hero equipment, VR head-look/crouch and attack-evidence contracts.
// Real hero.glb + real weapon GLBs (reference/multiplayer/public/assets) + real asset-pose.js; no GPU, no network.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createHeroView, heroSocket, HERO_WEAPONS, HERO_CROUCH, GRIP_TO_SOCKET} from '../client/hero-view.js';
import {prepareAsset, setWeaponGrip, weaponTip, weaponForward, ASSET_POSES} from '../client/asset-pose.js';
import {createEmberdewModel} from '../client/fire-presentation.js';

const here = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.join(here, '..');
const ASSETS = path.join(ROOT, 'public', 'assets');
// Same heights as game.js instantiate() for local weapons (reference game.js line 449).
export const WEAPON_HEIGHTS = {axe: .7, pick: .75, hammer: .95, crossbow: .48, bow: 1.25, wyrmspout: .4};
const fail = [], ok = (c, m) => { if (!c) fail.push(m); };
globalThis.self ??= globalThis;   // GLTFLoader image path; textures cannot decode in Node (no DOM) and load as null
const quiet = [console.warn, console.error]; console.warn = console.error = () => {};   // texture warnings only; geometry/nodes are what we test
const parse = file => new Promise((res, rej) => { const b = fs.readFileSync(file);
  new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej); });
const t0 = performance.now();
const hero = await parse(path.join(ASSETS, 'hero.glb'));
const templates = new Map();
for (const name of Object.keys(WEAPON_HEIGHTS)) templates.set(name, await parse(path.join(ASSETS, `${name}.glb`)));
templates.set('flask', {scene: createEmberdewModel(), animations: []});
[console.warn, console.error] = quiet;
const report = {loadSeconds: +((performance.now() - t0) / 1000).toFixed(2)};

let available = new Set();   // simulates late template loading
let resolves = 0;
function resolveWeapon(tool) {   // the game.js resolver, verbatim logic
  if (!available.has(tool)) return null;
  const template = templates.get(tool); if (!template) return null;
  resolves++;
  const {visual} = prepareAsset(template, tool, WEAPON_HEIGHTS[tool]);
  if (tool === 'flask') { const m = visual.children[0].children[0]; m.position.set(0, 0, 0); m.quaternion.identity(); m.scale.set(1, 1, 1); }
  return visual;
}
const view = createHeroView({resolveWeapon});
view.install(hero);
const scene = new THREE.Scene(), dt = 1 / 60;
const step = (e, n = 1) => { for (let i = 0; i < n; i++) { e.root.updateMatrixWorld(true); view.update(e.visual, e.data, e.root, dt, null); } };
const make = (data, pos = [0, 0, 0]) => { const root = new THREE.Group(); root.position.fromArray(pos); scene.add(root);
  const visual = view.create(data); root.add(visual); return {root, visual, data}; };
const deg = r => +(r * 180 / Math.PI).toFixed(2);
const fwd = q => new THREE.Vector3(0, 0, -1).applyQuaternion(q);

// --- 1. late load, tool changes, sockets, ownership ------------------------------------------------------------------
const a = make({id: 'pA', role: 'hero', tool: 'axe', hp: 100, position: [0, 0, 0], yaw: 0});
step(a); ok(!a.visual.userData.weapon, 'weapon attached before template loaded');
available = new Set(HERO_WEAPONS.tools); step(a);
ok(a.visual.userData.weapon?.userData.remoteWeapon === 'axe', 'late-loaded axe not attached');
const templateGeo = new Map(), templateMat = new Map();
for (const [n, t] of templates) { const g = new Set(), m = new Set(); t.scene.traverse(o => { if (o.geometry) g.add(o.geometry); if (o.material) [o.material].flat().forEach(x => m.add(x)); }); templateGeo.set(n, g); templateMat.set(n, m); }
report.sockets = {};
for (const tool of [...HERO_WEAPONS.tools, 'limb', 'axe']) {
  a.data = {...a.data, tool}; step(a);
  const w = a.visual.userData.weapon, u = a.visual.userData;
  if (tool === 'limb') { ok(!w, 'limb must leave the grip empty (combat-view presents the held bone)'); continue; }
  ok(w?.userData.remoteWeapon === tool, `tool ${tool} not attached`);
  const want = HERO_WEAPONS.leftHand.includes(tool) ? u.sockets.L : u.sockets.R;
  ok(w?.parent === want, `${tool} attached to wrong socket`);
  let attachedCount = 0; for (const v of u.weapons.values()) if (v.parent) attachedCount++;
  ok(attachedCount === 1, `${tool}: ${attachedCount} weapons parented (old one not detached)`);
  w.traverse(o => { if (o.geometry && !o.userData.ignoreContact) ok(templateGeo.get(tool).has(o.geometry), `${tool} geometry copied`);
    if (o.material && !o.userData.ignoreContact) [o.material].flat().forEach(m => ok(templateMat.get(tool).has(m), `${tool} material copied`)); });
  // Socket axis contract: weapon orientation in the socket == local XR grip pose re-expressed in socket space.
  const xr = new THREE.Group(); setWeaponGrip(xr, true, tool);
  const expect = GRIP_TO_SOCKET.clone().invert().multiply(xr.quaternion);
  ok(w.quaternion.angleTo(expect) < 1e-6 && w.position.lengthSq() < 1e-12, `${tool} socket pose differs from local XR contract`);
  report.sockets[tool] = want.name;
}
report.cacheSize = a.visual.userData.weapons.size; report.resolves = resolves;
ok(resolves === HERO_WEAPONS.tools.length, `tool cycling re-cloned (${resolves} resolves)`);

// Rest-pose geometry: derived from asset contracts, not a guessed 90 degrees. Bind pose (no clip) in the hero's frame.
const bind = make({id: 'pBind', role: 'hero', tool: 'axe', hp: 100});
report.restAxes = {};
for (const tool of HERO_WEAPONS.tools) {
  bind.data = {...bind.data, tool}; bind.visual.userData.weaponTool = undefined; bind.visual.userData.weapon?.removeFromParent(); bind.visual.userData.weapon = null;
  // attach without advancing animation: sync only
  bind.root.updateMatrixWorld(true); view.update(bind.visual, bind.data, bind.root, 0, null);
  const w = bind.visual.userData.weapon; bind.visual.updateMatrixWorld(true);
  const f = weaponForward(w, tool), haft = new THREE.Vector3(...ASSET_POSES[tool].up).applyQuaternion(w.getWorldQuaternion(new THREE.Quaternion()));   // contract up (haft for melee)
  report.restAxes[tool] = {forward: f.toArray().map(v => +v.toFixed(3)), up: haft.toArray().map(v => +v.toFixed(3))};
  // Idle-pose (t=0) hand: ranged aim axes point hero-forward; melee edge leads forward/down with the haft rising, perpendicular.
  if (['crossbow', 'bow', 'wyrmspout', 'flask'].includes(tool)) ok(f.z < -.9, `${tool} aim axis not hero-forward in idle (${f.toArray()})`);
  else ok(f.z < -.6 && f.y < -.3 && haft.y > .6 && haft.z < -.3 && Math.abs(f.dot(haft)) < .02, `${tool} melee edge/haft not forward-down / up-forward (${f.toArray()} / ${haft.toArray()})`);
}

// --- 2. VR: grip lands where the remote player's own client renders it --------------------------------------------
const head0 = {position: [0, 1.6, 0], quaternion: [0, 0, 0, 1]};
const handPose = {position: [.28, 1.25, -.38], quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(-.5, .3, .2)).toArray()};
const v = make({id: 'pVR', role: 'hero', tool: 'axe', hp: 100, head: head0, hands: [{position: [-.25, 1.15, -.3], quaternion: [0, 0, 0, 1]}, handPose]}, [3, .5, -2]);
report.vrTip = {};
const leftPose = {position: [-.28, 1.25, -.38], quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(-.5, -.3, -.2)).toArray()};
for (const tool of HERO_WEAPONS.tools) {
  v.data = {...v.data, tool};
  const side = HERO_WEAPONS.leftHand.includes(tool) ? 0 : 1, pose = side ? handPose : leftPose;
  v.data.hands = side ? [{position: [-.25, 1.15, -.3], quaternion: [0, 0, 0, 1]}, handPose] : [leftPose, {position: [.25, 1.15, -.3], quaternion: [0, 0, 0, 1]}];
  step(v, 30);
  const w = v.visual.userData.weapon; v.visual.updateMatrixWorld(true);
  const local = new THREE.Group(); local.position.fromArray(pose.position); local.quaternion.fromArray(pose.quaternion); v.root.add(local);
  const lv = prepareAsset(templates.get(tool), tool, WEAPON_HEIGHTS[tool]).visual; local.add(lv); setWeaponGrip(lv, true, tool); local.updateMatrixWorld(true);
  const e = weaponTip(w, tool, new THREE.Vector3()).distanceTo(weaponTip(lv, tool, new THREE.Vector3()));
  const ang = w.getWorldQuaternion(new THREE.Quaternion()).angleTo(lv.getWorldQuaternion(new THREE.Quaternion()));
  report.vrTip[tool] = {tipErrorM: +e.toFixed(4), angleDeg: deg(ang)};
  ok(e < .02 && ang < .02, `${tool} remote VR weapon differs from local XR render (${e} m, ${deg(ang)} deg)`);
  local.removeFromParent();
}

// --- 3. head look separate from torso, bounded ----------------------------------------------------------------------
const look = (yaw, pitch, y = 1.6) => ({position: [0, y, 0], quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')).toArray()});
const h = make({id: 'pHead', role: 'hero', tool: 'pick', hp: 100, head: look(0, 0), hands: v.data.hands}, [-3, 0, 2]);
step(h, 60);
const gaze = () => { h.visual.updateMatrixWorld(true); return fwd(h.visual.userData.head.getWorldQuaternion(new THREE.Quaternion())); };
report.headLook = {};
for (const [label, yaw, pitch] of [['glanceLeft40_down20', .7, -.35], ['lookRight30_up15', -.52, .26]]) {
  h.data = {...h.data, head: look(yaw, pitch)}; step(h, 4);
  const torsoEarly = h.visual.userData.model.rotation.y;
  step(h, 120);
  const g = gaze(), want = fwd(new THREE.Quaternion().fromArray(h.data.head.quaternion));
  report.headLook[label] = {torsoAfter4Frames: deg(torsoEarly), gazeErrorDeg: deg(g.angleTo(want)), torsoSettled: deg(h.visual.userData.model.rotation.y)};
  ok(Math.abs(torsoEarly) < Math.abs(yaw) * .5, `${label}: torso snapped with the head`);
  ok(g.angleTo(want) < .09, `${label}: rendered gaze misses tracked head (${deg(g.angleTo(want))} deg)`);
}
h.data = {...h.data, head: look(0, 0)}; step(h, 120);
h.data = {...h.data, head: look(0, -1.5)}; step(h, 60);   // extreme look-down: bounded
const neck = h.visual.userData.look; report.headLook.extremeDownClamp = {pitchDeg: deg(neck.pitch)};
ok(neck.pitch >= -.8 - 1e-6, 'neck pitch unbounded');

// --- 4. crouch: feet pinned, hips lowered, grip still on tracked hand ----------------------------------------------
h.data = {...h.data, head: look(0, 0)}; step(h, 60);
const bones = h.visual.userData.bones, footW = n => bones[n].getWorldPosition(new THREE.Vector3());
h.visual.updateMatrixWorld(true);
const standFeet = [footW('FootL'), footW('FootR')], standHips = footW('Hips');
report.crouch = {};
for (const [label, y] of [['crouch40cm', 1.645 - .4], ['kneelClamp', .4]]) {
  h.data = {...h.data, head: look(0, 0, y)}; step(h, 90); h.visual.updateMatrixWorld(true);
  const feet = [footW('FootL'), footW('FootR')], hips = footW('Hips');
  const grip = heroSocket(h.visual, 'WeaponGrip').getWorldPosition(new THREE.Vector3());
  const wantGrip = new THREE.Vector3().fromArray(h.data.hands[1].position).add(h.root.position);
  const eye = h.visual.userData.head.getWorldPosition(new THREE.Vector3()).y - h.root.position.y;
  report.crouch[label] = {hipsDropM: +(standHips.y - hips.y).toFixed(3), footSlipM: +Math.max(...feet.map((f, i) => f.distanceTo(standFeet[i]))).toFixed(4),
    gripErrorM: +grip.distanceTo(wantGrip).toFixed(4), eyeY: +eye.toFixed(3), trackedEyeY: y};
  ok(feet.every((f, i) => f.distanceTo(standFeet[i]) < .03), `${label}: feet slid`);
  ok(standHips.y - hips.y <= HERO_CROUCH.maxDrop + .01, `${label}: crouch unbounded`);
  ok(grip.distanceTo(wantGrip) < .03, `${label}: grip left tracked hand`);
}
ok(report.crouch.crouch40cm.hipsDropM > .3, 'crouch did not lower the body');

// --- 5. attack only from authoritative attributed evidence ----------------------------------------------------------
const s = make({id: 'pS', role: 'hero', tool: 'axe', hp: 100, position: [10, 0, 10]}, [10, 0, 10]);
step(s, 30); const atk = () => s.visual.userData.heroActions.Attack.isRunning();
ok(!atk(), 'Attack autoplayed (air swing has no event)');
ok(view.event(s.visual, {kind: 'embed', by: 'pS'}, s.data) === null && view.event(s.visual, {kind: 'hit', by: 'pS', position: [10.5, 1, 9]}, s.data) === null, 'host-relayed projectile hit animated a swing');
step(s, 2);
ok(view.event(s.visual, {kind: 'hit', by: 'pS', position: [30, 1, 30]}, s.data) === null, 'distant hit animated a swing');
ok(view.event(s.visual, {kind: 'wood_hit', by: 'pS', position: [10.5, 1.2, 9]}, s.data) === 'strike' && atk(), 'strike evidence did not play Attack');
ok(view.event(s.visual, {kind: 'stone_hit', by: 'pS', position: [10.5, 1.2, 9]}, s.data) === null, 'one strike played twice');
step(s, 60); ok(view.event(s.visual, {kind: 'axe_cleave', by: 'pS', position: [10, 0, 8.5]}, s.data) === 'special', 'special evidence ignored');
s.data = {...s.data, tool: 'crossbow'}; step(s, 60);
ok(view.event(s.visual, {kind: 'shoot', weapon: 'crossbow', by: 'pS', position: [10, 1.4, 10]}, s.data) === 'recoil', 'shoot recoil');
step(s, 2); ok(s.visual.userData.weapon.getObjectByName('Bolt')?.visible === false, 'crossbow did not discharge');
step(s, 60); ok(s.visual.userData.weapon.getObjectByName('Bolt')?.visible !== false, 'crossbow did not recock');
ok(view.event(s.visual, {kind: 'hit', by: 'pS', position: [10.5, 1, 9]}, s.data) === null, 'ranged tool played melee clip');

// --- 6. role change, release, no leaks, template GPU resources untouched -------------------------------------------
s.data = {...s.data, role: 'god'}; step(s); ok(!s.visual.userData.weapon, 'god kept a weapon');
let disposedTemplate = 0, disposedOwned = 0;
for (const set of templateGeo.values()) for (const g of set) g.addEventListener('dispose', () => disposedTemplate++);
for (const set of templateMat.values()) for (const m of set) m.addEventListener('dispose', () => disposedTemplate++);
const bowstrings = []; for (const e of [a, v, h, bind]) for (const w of e.visual.userData.weapons.values()) if (w.userData.bowstring) bowstrings.push(w.userData.bowstring);
for (const l of bowstrings) { l.geometry.addEventListener('dispose', () => disposedOwned++); l.material.addEventListener('dispose', () => disposedOwned++); }
for (const e of [a, v, h, bind, s]) view.release(e.visual);
ok(disposedTemplate === 0, `release disposed ${disposedTemplate} template GPU resources`);
ok(disposedOwned === bowstrings.length * 2 && bowstrings.length > 0, `bowstrings not disposed (${disposedOwned}/${bowstrings.length * 2})`);
ok(view.stats().live === 0 && view.stats().weapons === 0, 'release leaked heroes/weapons');

// --- 7. 8-player budget: 4 VR + 4 desktop, all armed, moving ---------------------------------------------------------
const crowd = [];
for (let i = 0; i < 8; i++) { const tool = HERO_WEAPONS.tools[i % HERO_WEAPONS.tools.length];
  const d = {id: `c${i}`, role: 'hero', tool, hp: 100, position: [i * 2, 0, 0], yaw: i};
  if (i < 4) { d.head = look(i * .3, -.2, 1.45); d.hands = [{position: [-.25, 1.1, -.35], quaternion: [0, 0, 0, 1]}, handPose]; }
  crowd.push(make(d, d.position)); }
const geos = new Set(); for (const e of crowd) { step(e); e.visual.traverse(o => o.geometry && geos.add(o.geometry)); }
const tB = performance.now();
for (let f = 0; f < 600; f++) for (const [i, e] of crowd.entries()) { if (i % 2) e.root.position.z -= 2 * dt; if (i < 4) e.data.head = look(Math.sin(f / 40 + i), -.2 + .2 * Math.sin(f / 30), 1.4 + .15 * Math.sin(f / 50)); step(e); }
report.budget8 = {updateMsPerFrame: +((performance.now() - tB) / 600).toFixed(3), uniqueGeometries: geos.size, stats: view.stats()};
const tplGeoCount = new Set([...templateGeo.values()].flatMap(s => [...s])).size + (() => { const g = new Set(); hero.scene.traverse(o => o.geometry && g.add(o.geometry)); return g.size; })();
ok(geos.size <= tplGeoCount + crowd.filter(e => e.data.tool === 'bow').length, `8 heroes created ${geos.size} geometries (templates ${tplGeoCount})`);
ok(crowd.every(e => e.visual.userData.model.position.toArray().concat(e.visual.userData.model.quaternion.toArray()).every(Number.isFinite)), 'NaN in crowd');
for (const e of crowd) view.release(e.visual);
ok(view.stats().live === 0, 'crowd release leak');
view.dispose();
report.seconds = +((performance.now() - t0) / 1000).toFixed(2);
console.log(JSON.stringify(report, null, 1));
if (fail.length) { console.error('FAIL', fail); process.exit(1); } else console.log('HERO_EQUIPMENT_CHECK_OK');
