import {enhanceTreeTemplate} from './forest-resource-art.js';
// Tree presentation: authored GLB kits, real notch carving, hinge fall driven by the shared sim tick, logs, LOD, wind.
// No decisions here: every state change comes from snapshots; time is only used for cosmetic growth/recoil/chips/wind.
// Intact trees live in shared InstancedMesh batches (tree-batch.js); a tree becomes an individual entity only while it
// has a harvest record (wounded/felled), and returns to its batch if the record disappears.
import * as T from 'three';
import {createCanopyRelease} from './canopy-release.js';
import {createTreeBatches} from './tree-batch.js';
import {createTreeMaterials} from './tree-materials.js';
import {tagAppleSlots} from './tree-fruit-mask.js';
import {APPLE_VARIANT} from '../shared/fruit.js';
import {worldTrees} from '../shared/world-content.js';
import {VARIANTS, treeScale, notchFor, treeFall, isFelled, TREE_LIMITS, rotateVector, logLength, logRadius} from '../shared/trees.js';
import {bakeTriangles, buildNotch, buildFelled, buildTimberSection, toGeometry, fitEndcapUV} from './tree-carve.js';
import {growthProgress, growthPose, growthProfile, growthMatrices, growthSeed} from './tree-growth.js';
import {createTreeHarvestWarmup} from './tree-harvest-warmup.js';

const PARTS = ['Trunk', 'Roots', 'Branches', 'Leaves', 'Fruit'];
const meshesUnder = node => { const out = []; node?.traverse(c => { if (c.isMesh) out.push(c); }); return out; };

// treeMaterials: optional createTreeMaterials() instance (shared across views); one is created and owned otherwise.
// Pass treeMaterials: false to keep the legacy flat materials + leaf-only windMaterial below.
export function createTreeView({scene, templates, height, camera = null, lodDistance = 26, windAmplitude = .025, lodStep = 1, lodBudget = 128, treeMaterials = undefined}) {
 const group = new T.Group(); group.name = 'TreeView'; scene.add(group);
 const canopyFX=createCanopyRelease({group});
 const logEntities=new Map();
 const trees = new Map(), wind = {value: 0}, missing = new Set(); let kits = new Map(), woodMaterial = null, uvMap = null, logs = null, chips = null, last = null, initialized = false, targetList = [], clock = 0;
 const ownedGeometry = new Set(), ownedMaterials = new Set();
 const ownMats = treeMaterials === undefined, mats = ownMats ? createTreeMaterials({windStrength: windAmplitude/.025}) : treeMaterials || null, decorate = m => mats ? mats.decorate(m) : m;
 // Intact trees: id -> {tree, kit, floor, scale, born, lod, key, synced}. growing: ids whose per-instance scale animates.
 const batches = createTreeBatches({group, decorate}), intact = new Map(), growing = new Set(), lodCam = new T.Vector3(), rootM = new T.Matrix4(), rootP = new T.Vector3(), rootS = new T.Vector3(), noRot = new T.Quaternion();
 let lodValid = false, lodPending = false, lodSwitches = 0;

 function windMaterial(m) { // tiny bounded leaf sway in the vertex shader; one shared program per base material
  const w = m.clone(); w.userData.treeWind = true; ownedMaterials.add(w); w.onBeforeCompile = shader => { shader.uniforms.uTreeWind = wind;
   shader.vertexShader = 'uniform float uTreeWind;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    { float k = clamp((position.y - 2.0) / 3.0, 0.0, 1.0); 
      #ifdef USE_INSTANCING
      vec2 ph = (modelMatrix * instanceMatrix)[3].xz * 0.37;
      #else
      vec2 ph = modelMatrix[3].xz * 0.37;
      #endif
      transformed.x += ${windAmplitude.toFixed(4)} * k * sin(uTreeWind * 1.3 + ph.x + position.y * 0.8);
      transformed.z += ${(windAmplitude*.7).toFixed(4)} * k * sin(uTreeWind * 1.1 + ph.y + position.x * 0.9); }`); };
  w.customProgramCacheKey = () => 'tree-wind-v2'; return w; }
 function kitFrom(name) {
  const src = templates.get(name)?.scene, root = src?.getObjectByName('Tree'); if (!root) { missing.add(name); return null; }
  root.updateMatrixWorld(true); const inv = new T.Matrix4().copy(root.matrixWorld).invert(), parts = {};
  for (const p of PARTS) { const node = root.getObjectByName(p); const list = meshesUnder(node).map(m => ({geometry: p === 'Fruit' && name === VARIANTS[APPLE_VARIANT] ? (g => (ownedGeometry.add(g), g))(tagAppleSlots(m.geometry, new T.Matrix4().multiplyMatrices(inv, m.matrixWorld))) : m.geometry, material: p === 'Leaves' && !mats ? windMaterial(m.material) : m.material, matrix: new T.Matrix4().multiplyMatrices(inv, m.matrixWorld)})); if (list.length) parts[p] = list; }
  if (!parts.Trunk || !parts.Roots) { missing.add(name); return null; }
  const trunkMesh = meshesUnder(root.getObjectByName('Trunk'))[0];
  const kit = {name, parts, trunk: bakeTriangles(trunkMesh, root), trunkColor: !!trunkMesh.geometry.attributes.color, trunkMaterial: trunkMesh.material};
  return mats ? mats.attach(kit) : kit; // shared patched clones; template materials stay untouched
 }
 function buildKits() {
  for(const name of [...VARIANTS,...VARIANTS.map(v=>v+'_lod')]){const source=templates.get(name)?.scene;if(source)enhanceTreeTemplate(source,{lod:name.endsWith('_lod'),variant:name.startsWith('tree_b')?'weeping':name.startsWith('tree_young')?'upright':'broad'});}
  kits = new Map(); missing.clear();
  for (const v of VARIANTS) { const full = kitFrom(v); if (full) { full.lod = templates.has(v + '_lod') ? kitFrom(v + '_lod') : null; kits.set(v, full); } }
  const cap = meshesUnder(templates.get('endcap')?.scene)[0]; woodMaterial = cap?.material || null; uvMap = fitEndcapUV(cap); if (!woodMaterial) missing.add('endcap');
  if (logs) { logs.forEach(m => { m.removeFromParent(); m.dispose(); }); logs = null; }
  const logSrc = templates.get('log')?.scene; if (logSrc) { logSrc.updateMatrixWorld(true); logs = meshesUnder(logSrc).map(m => { const im = new T.InstancedMesh(m.geometry, m.material, TREE_LIMITS.logs); im.userData.local = m.matrixWorld.clone(); im.count = 0; im.frustumCulled = false; im.name = 'TreeLogs'; group.add(im); return im; }); } else missing.add('log');
  if (!chips && woodMaterial) { const g = new T.BoxGeometry(.07, .014, .035); ownedGeometry.add(g); chips = {mesh: new T.InstancedMesh(g, woodMaterial, 40), list: []}; chips.mesh.count = 0; chips.mesh.frustumCulled = false; group.add(chips.mesh); }
 }
 const place = (parent, list, tag) => list.map(p => { const m = decorate(new T.Mesh(p.geometry, p.material)); m.matrixAutoUpdate = false; m.matrix.copy(p.matrix); if (tag) m.userData.targetId = tag; parent.add(m); return m; });
 function partsGroup(kit, id, skip = []) { const g = new T.Group(), byPart = {}; for (const p of PARTS) if (kit.parts[p] && !skip.includes(p)) byPart[p] = place(g, kit.parts[p], id); return {g, byPart}; }
 function owned(tris, color) { const g = toGeometry(tris, color); ownedGeometry.add(g); return g; }
 function release(g) { if (g && ownedGeometry.delete(g)) g.dispose(); }
 function clearWound(e) { if (!e.wound) return; for (const m of e.wound.meshes) { m.removeFromParent(); release(m.geometry); } e.wound.restore(); e.wound = null; }
 function destroy(e) { clearWound(e); if (e.felled) for (const m of e.felled.meshes) release(m.geometry); e.root.removeFromParent(); }
 function authoredNotch(e, cut) { const s = treeScale(e.tree), n = notchFor(e.tree, cut, e.floor); return {...n, height: n.height/s, radius: n.radius/s, depth: n.depth/s, hinge: n.hinge/s}; }
 function applyWound(e, cut) { // cuts 1-2: replace the Trunk geometry with the carved shell and add the exposed wood faces
  clearWound(e); const kit = e.kit, notch = authoredNotch(e, cut), res = buildNotch(kit.trunk, notch, uvMap), trunk = e.full.byPart.Trunk[0], original = trunk.geometry;
  trunk.geometry = owned(res.bark, kit.trunkColor); const wood = new T.Mesh(owned(res.wood, true), woodMaterial); wood.userData.targetId = e.tree.id; e.full.g.add(wood);
  e.wound = {meshes: [wood], notch, restore: () => { release(trunk.geometry); trunk.geometry = original; }};
 }
 function applyFelled(e, cut) {
  clearWound(e); e.full.g.removeFromParent(); e.lodGroup?.g.removeFromParent();
  const kit = e.kit, notch = authoredNotch(e, {...cut, cuts: 2}), res = buildFelled(kit.trunk, notch, uvMap), meshes = [];
  const stump = new T.Group(); place(stump, kit.parts.Roots, e.tree.id); const sb = new T.Mesh(owned(res.stump.bark, kit.trunkColor), kit.trunkMaterial), sw = new T.Mesh(owned(res.stump.wood, true), woodMaterial); stump.add(sb, sw); meshes.push(sb, sw);
  const fall = treeFall(e.tree, cut, cut.felledTick, e.floor, ground), s = treeScale(e.tree), pivot = new T.Group(), body = new T.Group();
  pivot.position.set(fall.hinge[0]/s, fall.hinge[1]/s, fall.hinge[2]/s); body.position.copy(pivot.position).negate(); pivot.add(body);
  const tb = new T.Mesh(owned(res.top.bark, kit.trunkColor), kit.trunkMaterial), tw = new T.Mesh(owned(res.top.wood, true), woodMaterial); body.add(tb, tw); meshes.push(tb, tw);
  const canopy=[];for (const p of ['Branches', 'Leaves', 'Fruit']) if (kit.parts[p]) {for(const mesh of place(body,kit.parts[p])){mesh.geometry.computeBoundingBox();canopy.push({mesh,matrix:mesh.matrix.clone(),center:mesh.geometry.boundingBox.getCenter(new T.Vector3()),leaves:p==='Leaves'});}}
  e.root.add(stump, pivot); e.felled = {stump, pivot, body, canopy, topMeshes:[tb,tw], meshes, cut, axis: new T.Vector3(...fall.axis), capRadius: notch.radius*s};
 }
 const ground = (x, z) => height(x, z, last?.edits);
 function hitFeedback(e, cut, now) {
  const n = notchFor(e.tree, cut, e.floor), dir = n.normal, p = [e.tree.x + dir[0]*n.radius, e.floor + n.height, e.tree.z + dir[2]*n.radius];
  e.recoil = {start: now, axis: new T.Vector3(dir[2], 0, -dir[0]), cuts: cut.cuts};
  if (!chips) return; for (let i = 0; i < 7; i++) { if (chips.list.length >= chips.mesh.instanceMatrix.count) chips.list.shift(); const a = (i - 3)*.32, side = [dir[0]*Math.cos(a) - dir[2]*Math.sin(a), dir[2]*Math.cos(a) + dir[0]*Math.sin(a)];
   chips.list.push({start: now, p: [...p], v: [side[0]*(1.6 + (i % 3)*.5), 1.4 + (i % 4)*.45, side[1]*(1.6 + (i % 3)*.5)], spin: 6 + i*1.7}); }
 }
 const lodFor = (r, d) => !!r.kit.lod && (r.lod ? d > lodDistance - 2 : d > lodDistance + 2); // +/-2 m hysteresis
 const growLocal = {};
 function placeIntact(r, g = growthProgress(r.born, clock)) { // Tree root origin = trunk axis at (x, floor, z); never recentred by bounds
  // Staged growth (sapling -> branches -> foliage -> settle) is per-part and cosmetic; the root stays the mature root.
  rootM.compose(rootP.set(r.tree.x, r.floor, r.tree.z), noRot, rootS.setScalar(r.scale)); const v = VARIANTS[r.tree.variant] || 'tree', kit = r.lod ? r.kit.lod : r.kit;
  const local = g < 1 ? growthMatrices(growthProfile(kit), growthPose(g, r.seed ??= growthSeed(r.tree.id)), growLocal) : null;
  batches.place(r.tree.id, v, r.lod ? 'lod' : 'full', kit, rootM, local); if (g < 1) growing.add(r.tree.id); else growing.delete(r.tree.id);
 }
 function demote(id) { const e = trees.get(id); if (!e) return; destroy(e); trees.delete(id); }
 function sync(s) {
  last = s; const now = clock, cuts = new Map((s.harvestedTrees || []).map(h => [h.id, h])), ids = new Set();
  const walking = new Set((s.enemies || []).filter(e => e.kind === 'stumpling').map(e => e.treeId)); // stumps that got up (stumpling-view draws them)
  if (!lodValid && camera && !intact.size) { camera.getWorldPosition(lodCam); lodValid = true; } // first build places every tree at its LOD once
  for (const t of worldTrees(s)) {
   const kit = kits.get(VARIANTS[t.variant] || 'tree'); if (!kit) continue; ids.add(t.id);
   const cut = cuts.get(t.id), floor = height(t.x, t.z, s.edits), sc = treeScale(t);
   let e = trees.get(t.id), r = intact.get(t.id);
   if (r && r.kit !== kit) { batches.remove(t.id); intact.delete(t.id); growing.delete(t.id); r = null; }
   if (!cut) { // intact: instanced; rewritten only when its transform key changes
    if (e) demote(t.id);
    // A stump whose record is released (its stumpling died or burrowed) regrows from a sapling where it stood.
    if (!r) { r = {tree: t, kit, born: initialized && (!e || e.felled) ? now : -1e9, key: '', lod: false, synced: false}; intact.set(t.id, r);
     if (lodValid) r.lod = lodFor(r, Math.hypot(lodCam.x - t.x, lodCam.z - t.z)); }
    r.tree = t; r.floor = floor; r.scale = sc; const key = `${t.x}|${t.z}|${floor}|${sc}`;
    if (key !== r.key) { r.key = key; placeIntact(r); }
    r.synced = true; continue;
   }
   if (!e) { // first harvest record: de-instance only this tree; its cut-geometry entity takes over at the same transform
    const root = new T.Group(); root.name = t.id; const full = partsGroup(kit, t.id); root.add(full.g); group.add(root);
    // harvesting interrupts growth: the entity is always the exact mature authored shape (notch/fall math assumes it)
    e = {tree: t, kit, root, full, born: -1e9, key: '', cuts: 0, synced: !!r?.synced}; trees.set(t.id, e);
    if (r) { batches.remove(t.id); intact.delete(t.id); growing.delete(t.id); }
   }
   e.tree = t; e.floor = floor; e.root.position.set(t.x, e.floor, t.z); e.scale = sc; // Tree root origin = trunk axis at ground: never recentre by bounds
   const key = `${cut.cuts}|${cut.cutHeight}|${cut.fallYaw}|${cut.felledTick}|${e.floor}`;
   if (key !== e.key) {
    if (e.synced && cut.cuts > e.cuts && !(isFelled(cut) && e.felled)) hitFeedback(e, cut, now); // never replayed for late joiners
    if (isFelled(cut)) { if (!e.felled) applyFelled(e, cut); } else applyWound(e, cut);
    e.key = key; e.cuts = cut?.cuts || 0;
   }
   if (e.felled) {
    const f=e.felled; f.stump.visible = !walking.has(t.id);
    if(cut.landed&&!f.landed){
     if(e.synced){const pose=treeFall(e.tree,cut,s.tick,e.floor,ground);f.pivot.quaternion.setFromAxisAngle(f.axis,pose.end);e.root.scale.setScalar(e.scale);e.root.updateMatrixWorld(true);
      const points=[];for(const part of f.canopy.filter(p=>p.leaves)){const pos=part.mesh.geometry.attributes.position,step=Math.max(1,Math.floor(pos.count/32));for(let i=0;i<pos.count;i+=step)points.push(new T.Vector3().fromBufferAttribute(pos,i).applyMatrix4(part.mesh.matrixWorld).toArray());}
      canopyFX.burst({points,seed:growthSeed(e.tree.id)});f.releaseAt=clock;
     }
     f.landed=true;f.topMeshes.forEach(m=>m.visible=false);
    }
    f.pivot.visible=!cut.landed||(f.releaseAt!==undefined&&clock-f.releaseAt<220);
   }
   e.synced = true;
  }
  for (const [id, e] of trees) if (!ids.has(id)) { destroy(e); trees.delete(id); }
  for (const id of intact.keys()) if (!ids.has(id)) { batches.remove(id); intact.delete(id); growing.delete(id); }
  batches.flush();
  const liveLogs=new Set();
  for(const l of s.looseLogs||[]) {
   if(!l.section)continue;const e=trees.get(l.sourceId);if(!e?.felled)continue;liveLogs.add(l.id);
   let entry=logEntities.get(l.id);
   if(!entry){const notch=authoredNotch(e,{...e.felled.cut,cuts:2}),top=buildFelled(e.kit.trunk,notch,uvMap).top;
    const piece=buildTimberSection(top,l.section[0],l.section[1],uvMap,l.radius/e.scale),root=new T.Group(),center=(l.section[0]+l.section[1])/2;
    for(const [tris,material,color] of [[piece.bark,e.kit.trunkMaterial,e.kit.trunkColor],[piece.wood,woodMaterial,true]]) {
     const geometry=owned(tris,color);geometry.translate(0,-center,0);const mesh=new T.Mesh(geometry,material);mesh.userData.logId=l.id;root.add(mesh);
    }
    root.scale.setScalar(e.scale);group.add(root);entry={root};logEntities.set(l.id,entry);
   }
   entry.root.position.fromArray(l.position);entry.root.quaternion.fromArray(l.quaternion);
  }
  for(const [id,e] of logEntities)if(!liveLogs.has(id)){for(const m of e.root.children)release(m.geometry);e.root.removeFromParent();logEntities.delete(id);}
  if (logs) { const list = (s.looseLogs || []).filter(l=>!l.section).slice(0, TREE_LIMITS.logs), m = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), one = new T.Vector3(1, 1, 1);
   for (const im of logs) { im.userData.logIds=list.map(l=>l.id);list.forEach((l, i) => { m.compose(p.fromArray(l.position), q.fromArray(l.quaternion), one).multiply(im.userData.local); im.setMatrixAt(i, m); }); im.count = list.length; im.instanceMatrix.needsUpdate = true; } }
  targetList = batches.targets(); for (const e of trees.values()) if (!e.felled) targetList.push(...e.full.byPart.Trunk, ...(e.wound?.meshes || []));
  initialized = true;
 }
 const tmpQ = new T.Quaternion(), tmpV = new T.Vector3(), m4 = new T.Matrix4(), e3 = new T.Euler();
 function updateLod(cam) { // bounded: only after the camera moved lodStep metres, at most lodBudget batch moves per frame
  if (lodValid && !lodPending && Math.hypot(cam.x - lodCam.x, cam.z - lodCam.z) < lodStep) return;
  let budget = lodBudget;
  for (const r of intact.values()) { const want = lodFor(r, Math.hypot(cam.x - r.tree.x, cam.z - r.tree.z)); if (want === r.lod) continue;
   if (budget-- <= 0) { lodPending = true; return; } r.lod = want; placeIntact(r); lodSwitches++; }   // unfinished sweep continues next frame
  lodCam.copy(cam); lodValid = true; lodPending = false;
 }
 function tick(now, simTick) {
  canopyFX.tick(Math.max(0,(now-clock)/1000));clock = now; wind.value = now/1000; if (ownMats) mats.update(now/1000); // shared instances are updated by their owner
  const cam = camera ? camera.getWorldPosition(tmpV) : null;
  for (const id of growing) { const r = intact.get(id); if (r) placeIntact(r); else growing.delete(id); }
  if (cam) updateLod(cam);
  batches.flush();
  for (const e of trees.values()) { // individual (wounded/felled) trees only: always the full authored mesh, as before
   e.root.scale.setScalar(e.scale);
   if (e.recoil) { const k = (now - e.recoil.start)/260; if (k >= 1) { e.recoil = null; e.root.quaternion.identity(); } else e.root.quaternion.setFromAxisAngle(e.recoil.axis, -(.006 + .004*e.recoil.cuts)*Math.sin(k*Math.PI)*(1 - k)); }
   if (e.felled && last) { const cut = e.felled.cut, f = treeFall(e.tree, cut, simTick, e.floor, ground); e.felled.pivot.quaternion.setFromAxisAngle(e.felled.axis, f.angle);
    if(e.felled.landed){const age=now-(e.felled.releaseAt??-1e9),shrink=Math.max(0,1-age/220);e.felled.pivot.visible=shrink>0;
     for(const part of e.felled.canopy){const c=part.center;part.mesh.matrix.copy(part.matrix).multiply(m4.makeTranslation(c.x,c.y,c.z)).multiply(m4.makeScale(shrink,shrink,shrink)).multiply(m4.makeTranslation(-c.x,-c.y,-c.z));}
    }
   }
  }
  if (chips) { chips.list = chips.list.filter(c => now - c.start < 650); chips.list.forEach((c, i) => { const t = (now - c.start)/1000, y = Math.max(ground(c.p[0], c.p[2]) + .01, c.p[1] + c.v[1]*t - 7.5*t*t);
    m4.compose(tmpV.set(c.p[0] + c.v[0]*t, y, c.p[2] + c.v[2]*t), tmpQ.setFromEuler(e3.set(c.spin*t, c.spin*.6*t, 0)), new T.Vector3(1, 1, 1).multiplyScalar(1 - t*.8)); chips.mesh.setMatrixAt(i, m4); });
   chips.mesh.count = chips.list.length; chips.mesh.instanceMatrix.needsUpdate = true; }
 }
 /** Analytic ray vs log capsules (unheld). Returns {id, distance, point} or null. */
 function grabTarget(origin, direction, max = TREE_LIMITS.reach) {
  let best = null; const o = new T.Vector3(...(origin.toArray ? origin.toArray() : origin)), d = new T.Vector3(...(direction.toArray ? direction.toArray() : direction)).normalize();
  for (const l of last?.looseLogs || []) { if (l.heldBy) continue; const half=Math.max(.001,logLength(l)/2-logRadius(l)); const a = new T.Vector3(...rotateVector([0, 1, 0], l.quaternion)), c = new T.Vector3(...l.position);
   for (let t = 0; t <= max; t += .04) { const p = o.clone().addScaledVector(d, t), v = p.clone().sub(c), u = T.MathUtils.clamp(v.dot(a), -half, half); if (v.addScaledVector(a, -u).length() <= logRadius(l)) { if (!best || t < best.distance) best = {id: l.id, distance: t, point: p.toArray()}; break; } } }
  return best;
 }
 /** True when a raycast hit lies on a rendered surface (respects material clipping planes). */
 function surfaceVisible(hit) { const mats = Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material]; const m = mats[hit.face?.materialIndex ?? 0] || mats[0];
  return !(m?.clippingPlanes || []).some(p => p.distanceToPoint(hit.point) < 0) && hit.object.visible !== false; }
 /** Axe target for a raycast hit on targets(): {id, point, normal (world), instanced} or null. Instanced hits map
  *  instanceId -> logical tree id through the batch slot table; entity hits use userData.targetId as before. */
 function resolveTarget(hit) {
  if (!hit?.object) return null; const instanced = !!hit.object.userData.treeBatch, id = instanced ? batches.idOf(hit) : hit.object.userData.targetId; if (!id) return null;
  const normal = instanced ? batches.worldNormal(hit) : hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
  return {id, point: hit.point.toArray(), normal: normal ? normal.toArray() : null, instanced};
 }
 function stats() { let drawCalls = 0, triangles = 0, intactDraws = 0; const programs = new Set();
  group.traverseVisible(o => { if (!o.isMesh || (o.isInstancedMesh && o.count === 0)) return; drawCalls++; if (o.userData.treeBatch) intactDraws++; const n = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count)/3; triangles += n*(o.isInstancedMesh ? o.count : 1); for (const m of [].concat(o.material)) programs.add(m.type + (m.vertexColors ? '+vc' : '') + (m.map ? '+map' : '') + (m.userData.treeWind ? '+wind' : '') + (m.userData.treeMaterial ? '+' + m.userData.treeMaterial : '')); });
  const list = [...trees.values()], rs = [...intact.values()], c = batches.counters();
  return {trees: list.length + rs.length, intact: rs.length, individual: list.length, lod: rs.filter(r => r.lod).length, growing: growing.size, wounded: list.filter(e => e.wound).length, felled: list.filter(e => e.felled).length, falling: list.filter(e => e.felled?.pivot.visible&&!e.felled.landed).length,
   logs: (logs?.[0]?.count || 0)+logEntities.size, chips: chips?.list.length || 0, drawCalls, intactDraws, batches: batches.batches().filter(b => b.ids.length).length, triangles: Math.round(triangles), shaderPrograms: programs.size, ownedGeometries: ownedGeometry.size,
   canopy:canopyFX.stats(), matrixWrites: c.writes, slotMoves: c.moves, lodSwitches, missingAssets: [...missing], treeMaterials: mats?.stats() || null}; }
 function clearAll() { canopyFX.tick(1); for(const e of logEntities.values()){for(const m of e.root.children)release(m.geometry);e.root.removeFromParent();}logEntities.clear(); for (const e of trees.values()) destroy(e); trees.clear(); batches.clear(); intact.clear(); growing.clear(); lodValid = false; }
 function reload(next = templates) { templates = next; clearAll(); for (const m of ownedMaterials) m.dispose(); ownedMaterials.clear(); if (ownMats) mats.dispose(); initialized = false; buildKits(); if (last) sync(last); }
 function dispose() { clearAll();canopyFX.dispose(); for (const g of ownedGeometry) g.dispose(); ownedGeometry.clear(); for (const m of ownedMaterials) m.dispose(); if (ownMats) mats.dispose(); logs?.forEach(m => m.dispose()); chips?.mesh.dispose(); group.removeFromParent(); }
 buildKits();
 return {sync, tick, prepareWarmup:()=>createTreeHarvestWarmup({kits, woodMaterial, uvMap, decorate, pools:group.children.filter(m=>m.isInstancedMesh&&!m.userData.treeBatch)}), collectibleTargets:()=>[...(logs||[]),...Array.from(logEntities.values()).flatMap(e=>e.root.children)], collectibleId:hit=>hit.object.userData.logId||hit.object.userData.logIds?.[hit.instanceId]||null, targets: () => targetList, resolveTarget, grabTarget, surfaceVisible, stats, reload, assetReload: reload, dispose, group, batches,
  entity: id => trees.get(id) || null, intactTree: id => intact.get(id) || null};
}
