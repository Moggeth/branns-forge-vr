// The Underways in the game: every open dungeon run drawn at its slot (shell, props, hazards, chests, key and gate,
// shrine, guardian's hoard and the ways out), the surface entrances, and the change of light as you go down.
// Presentation only: all rules are shared/underways/rules.js; everything visible here is derived from the snapshot and
// the render tick (estimated, fractional), so hazards and gates move every frame, never in 20 Hz steps.
//
// Light: inside, the sun, sky light and reflections give way to the dungeon's own baked fire- and crystal-light; one
// pooled point light rides with the viewer as their lantern (always in the scene, zero outside: no shader recompiles).
import * as THREE from 'three';
import {generateUnderway, GRID, TILE, floorHeight, ceilingAt} from '../../shared/underways/gen.js';
import {inUnderway, slotOf, slotOrigin, GATE_RISE} from '../../shared/underways/space.js';
import {UNDERWAYS, hazardPhase} from '../../shared/underways/rules.js';
import {underwaySites} from '../../shared/underways/sites.js';
import '../../shared/underways/world.js'; // generated worlds list their caves as dungeon sites
import {buildUnderwayShell, bakeAt, UNDERWAY_LOOK} from './build.js';
import {shellMaterial, lookUniforms} from './look.js';
import {underwayKit, crystalType, propMaterial, propTime} from './props.js';
import {createUnderwayPortal} from './portal.js';
import {createUnderwayCards} from './cards.js';
import {ITEMS} from '../../shared/hero-items.js';

const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
export const UNDERWAY_VIEW = Object.freeze({
  lantern: Object.freeze({color: 0xffc58a, intensity: 3.2, distance: 11, decay: 1.4}),
  dim: Object.freeze({sun: 1, hemi: .93, env: .85}),
});

function instanced(geo, mat, list, lightOf, name) {
  if (!list.length) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, list.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const light = new Float32Array(list.length * 3);
  list.forEach((it, i) => {
    p.set(it.x, it.y, it.z); q.setFromAxisAngle(up, it.yaw || 0); s.set(...(Array.isArray(it.scale) ? it.scale : [it.scale || 1, it.scale || 1, it.scale || 1]));
    mesh.setMatrixAt(i, m.compose(p, q, s));
    light.set(lightOf(it), i * 3);
  });
  geo = mesh.geometry; // shared kit geometry: the per-instance light rides on the mesh's own attribute copy
  mesh.geometry = geo.clone();
  mesh.geometry.setAttribute('aPropLight', new THREE.InstancedBufferAttribute(light, 3));
  mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
  mesh.name = name; mesh.raycast = () => {}; mesh.castShadow = false; mesh.receiveShadow = false; mesh.userData.presentationOnly = true;
  return mesh;
}
// A single prop mesh with its own baked light (dynamic ones: chests, key, gate, hoard).
function single(geo, mat, light) {
  const g = geo.clone(), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set(light, i * 3);
  g.setAttribute('aPropLight', new THREE.BufferAttribute(a, 3));
  const mesh = new THREE.Mesh(g, mat); mesh.raycast = () => {}; mesh.userData.presentationOnly = true;
  return mesh;
}

function buildRun(run, {quality, propMat}) {
  const d = generateUnderway(run.seed, {style: run.style, depth: run.depth}), low = quality === 'low', t0 = performance.now();
  const [ox, oz] = slotOrigin(run.slot), group = new THREE.Group(); group.name = `Underway_${run.id}`; group.position.set(ox, 0, oz);
  const shell = buildUnderwayShell(d, {quality});
  const meshes = [];
  for (const [key, surface] of [['floor', 'floor'], ['walls', 'wall'], ['roof', 'roof']]) {
    const mesh = new THREE.Mesh(shell[key], shellMaterial(d.style, surface, {low}));
    mesh.name = `Underway_${run.id}_${key}`; mesh.raycast = () => {}; mesh.matrixAutoUpdate = false; mesh.userData.presentationOnly = true; mesh.frustumCulled = false;
    group.add(mesh); meshes.push(mesh);
  }
  const kit = underwayKit(), lit = it => bakeAt(d, it.x, it.y + .8, it.z), Y = (x, z) => floorHeight(d, x, z);
  // Static props, instanced per type.
  const byType = new Map(), add = (type, it) => { if (!kit[type]) return; if (!byType.has(type)) byType.set(type, []); byType.get(type).push(it); };
  for (const p of d.props) {
    const type = p.type === 'crystal' ? crystalType(p.color) : p.type === 'pillar' || p.type === 'banner' ? `${p.type}-${d.style === 'keep' ? 'keep' : 'crypt'}` : p.type;
    if (p.type === 'pillar') { add(type, {x: p.x, y: Y(p.x, p.z), z: p.z, yaw: 0, scale: [1, ceilingAt(d, p.x, p.z) + .05, 1]}); continue; }
    if (p.type === 'roots') { const h = ceilingAt(d, p.x, p.z) * .55; add(type, {x: p.x, y: Y(p.x, p.z) + ceilingAt(d, p.x, p.z) - h, z: p.z, yaw: p.yaw, scale: [p.scale, h, p.scale]}); continue; }
    if (p.type === 'skyshaft') continue;
    add(type, {x: p.x, y: Y(p.x, p.z), z: p.z, yaw: p.yaw, scale: p.scale});
  }
  // Mine corridors: timber sets every 2.5 m, rails down the spine.
  if (d.style === 'mine') for (const c of d.corridors) {
    const w = (c.axis === 'z' ? c.x1 - c.x0 + 1 : c.y1 - c.y0 + 1) * TILE, mid = c.axis === 'z' ? ((c.x0 + c.x1 + 1) / 2 - GRID / 2) * TILE : ((c.y0 + c.y1 + 1) / 2 - GRID / 2) * TILE;
    const lo = c.axis === 'z' ? (c.y0 - GRID / 2) * TILE : (c.x0 - GRID / 2) * TILE, hi = c.axis === 'z' ? (c.y1 + 1 - GRID / 2) * TILE : (c.x1 + 1 - GRID / 2) * TILE;
    const yaw = c.axis === 'z' ? 0 : Math.PI / 2;
    for (let s = lo + .4; s <= hi - .3; s += 2.5) {
      const [x, z] = c.axis === 'z' ? [mid, s] : [s, mid], y = Y(x, z), h = ceilingAt(d, x, z);
      add('timber', {x, y, z, yaw, scale: [w - .15, h, 1]});
    }
    const spine = d.rooms[c.a].spine && d.rooms[c.b].spine;
    if (spine) for (let s = lo + 1; s <= hi - .9; s += 2) { const [x, z] = c.axis === 'z' ? [mid, s] : [s, mid]; add('rails', {x, y: Y(x, z), z, yaw}); }
  }
  // Mine rooms: pit props shore up the cave walls every few metres (presentation only; they stand in the wall's lee).
  if (d.style === 'mine') for (let j = 1; j < GRID - 1; j++) for (let i = 1; i < GRID - 1; i++) {
    const ro = d.roomOf[j * GRID + i]; if (ro < 0 || (i * 7 + j * 3) % 4) continue;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (d.tiles[(j + dj) * GRID + i + di]) continue;
      const x = ((i - GRID / 2 + .5) + di * .5) * TILE - di * .28, z = ((j - GRID / 2 + .5) + dj * .5) * TILE - dj * .28;
      if (d.hazards.some(h => Math.hypot(h.x - x, h.z - z) < 1.6) || d.props.some(p => Math.hypot(p.x - x, p.z - z) < 1.2)) break;
      add('pitProp', {x, y: Y(x - di * .3, z - dj * .3), z, yaw: Math.atan2(di, dj), scale: [1, ceilingAt(d, x - di * .5, z - dj * .5) + .3, 1]});
      break;
    }
  }
  for (const v of d.vignettes) add(v.kind.endsWith('-sign') ? 'sign' : `tale-${v.kind}`, {x: v.x, y: Y(v.x, v.z), z: v.z, yaw: v.yaw});
  add('returnCircle', {x: d.entry.x, y: Y(d.entry.x, d.entry.z), z: d.entry.z, yaw: 0});
  { // the way you came down: a ladder up the shaft over the return circle, in a shaft of daylight
    const q0 = d.rooms[0], wallZ = (q0.y1 + 1 - GRID / 2) * TILE, h = ceilingAt(d, d.entry.x, d.entry.z);
    add('ladder', {x: d.entry.x, y: Y(d.entry.x, d.entry.z), z: wallZ - .15, yaw: 0, scale: [1, h + .4, 1]});
  }
  // Hazard furniture (vents and loose roof patches); their motion is animated below.
  const hazards = [];
  for (const h of d.hazards) {
    const y = Y(h.x, h.z);
    if (h.type === 'flame') add('vent', {x: h.x, y, z: h.z, yaw: 0});
    if (h.type === 'spikes') add('spikePlate', {x: h.x, y, z: h.z, yaw: 0, scale: [h.half, 1, h.half]});
    if (h.type === 'rockfall') add('crackedRoof', {x: h.x, y: y + ceilingAt(d, h.x, h.z) + (UNDERWAY_LOOK[d.style].roofBulge ? .35 : 0), z: h.z, yaw: h.x * 1.7});
    hazards.push({h, y, roof: y + ceilingAt(d, h.x, h.z)});
  }
  for (const [type, list] of byType) { const mesh = instanced(kit[type], propMat, list, lit, `Underway_${run.id}_${type}`); if (mesh) group.add(mesh); }

  // Dynamic pieces.
  const chests = d.chests.map(c => {
    const y = Y(c.x, c.z), L = bakeAt(d, c.x, y + .8, c.z), g = new THREE.Group(); g.position.set(c.x, y, c.z); g.rotation.y = c.yaw;
    if (c.tier) { const base = single(kit.chestBase, propMat, L), lid = single(kit.chestLid, propMat, L); lid.position.set(0, .5, .32); g.add(base, lid); g.userData.lid = lid; }
    else { const urn = single(kit.urn, propMat, L); g.add(urn); g.scale.setScalar(.9 + (c.x * 7.1 % 1 + 1) % 1 * .3); }
    group.add(g);
    return {c, g, opened: run.opened.includes(c.id) ? -1e9 : null};
  });
  const keyLight = bakeAt(d, d.key.x, Y(d.key.x, d.key.z) + 1, d.key.z), plinth = single(kit.plinth, propMat, keyLight), key = single(kit.key, propMat, keyLight);
  plinth.position.set(d.key.x, Y(d.key.x, d.key.z), d.key.z); key.position.set(d.key.x, Y(d.key.x, d.key.z) + 1.45, d.key.z); group.add(plinth, key);
  const g0 = d.gate, gateY = Y(g0.x, g0.z), gateMesh = single(d.style === 'mine' ? kit.gate : kit.portcullis, propMat, bakeAt(d, g0.x, gateY + 1.5, g0.z));
  gateMesh.position.set(g0.x, gateY, g0.z); gateMesh.rotation.y = g0.axis === 'z' ? 0 : Math.PI / 2; gateMesh.scale.set(g0.width, Math.min(1, ceilingAt(d, g0.x, g0.z) / 3.4), 1); group.add(gateMesh);
  const shrineMesh = single(kit.shrine, propMat, bakeAt(d, d.shrine.x, Y(d.shrine.x, d.shrine.z) + 1, d.shrine.z));
  shrineMesh.position.set(d.shrine.x, Y(d.shrine.x, d.shrine.z), d.shrine.z); shrineMesh.rotation.y = Math.atan2(-(d.rooms[d.shrine.room].path[0][0] - d.shrine.x), -(d.rooms[d.shrine.room].path[0][1] - d.shrine.z)) + Math.PI; group.add(shrineMesh);
  const hy = Y(d.hoard.x, d.hoard.z), hoardLight = bakeAt(d, d.hoard.x, hy + 1, d.hoard.z);
  const hoardPile = single(kit.hoard, propMat, hoardLight); hoardPile.position.set(d.hoard.x, hy, d.hoard.z); group.add(hoardPile);
  const hoardChest = new THREE.Group(); hoardChest.position.set(d.hoard.x, hy + .35, d.hoard.z); hoardChest.rotation.y = d.hoard.yaw; hoardChest.scale.setScalar(1.6);
  const hb = single(kit.chestBase, propMat, hoardLight), hl = single(kit.chestLid, propMat, hoardLight); hl.position.set(0, .5, .32); hoardChest.add(hb, hl); group.add(hoardChest);
  const shaftMat = new THREE.ShaderMaterial({transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: {uTime: lookUniforms.uUwTime},
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec2 vUv; uniform float uTime; void main(){ float edge=sin(vUv.x*3.14159); float a=pow(edge,2.0)*smoothstep(0.0,.35,vUv.y)*(.85+.15*sin(uTime*.7+vUv.x*9.0)); gl_FragColor=vec4(vec3(1.0,.93,.75)*a*.22,1.0); }'});
  const shaftH = ceilingAt(d, d.entry.x, d.entry.z) + 1, shaft = new THREE.Mesh(new THREE.CylinderGeometry(.9, 1.3, shaftH, 20, 1, true), shaftMat);
  shaft.position.set(d.entry.x, Y(d.entry.x, d.entry.z) + shaftH / 2, d.entry.z + .4); shaft.raycast = () => {}; shaft.renderOrder = 2; group.add(shaft);
  const exit = single(kit.exit, propMat, [0, 0, 0]); exit.position.set(d.exit.x, Y(d.exit.x, d.exit.z), d.exit.z); exit.rotation.y = d.hoard.yaw; exit.visible = false; group.add(exit);
  // Flames for vents (shared additive material), and rocks for rockfalls.
  const flameMat = new THREE.MeshBasicMaterial({vertexColors: true, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false});
  const warnMat = new THREE.MeshBasicMaterial({color: 0xff8a3a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false});
  for (const hz of hazards) {
    if (hz.h.type === 'flame') { const f = new THREE.Mesh(kit.flame, flameMat); f.position.set(hz.h.x, hz.y + .12, hz.h.z); f.visible = false; f.raycast = () => {}; group.add(f); hz.flame = f; }
    if (hz.h.type === 'spikes') { const sp = single(kit.spikes, propMat, bakeAt(d, hz.h.x, hz.y + .5, hz.h.z)); sp.position.set(hz.h.x, hz.y - .7, hz.h.z); sp.scale.set(hz.h.half, 1, hz.h.half); group.add(sp); hz.spikes = sp; }
    if (hz.h.type === 'rockfall') {
      hz.rocks = [0, 1, 2, 3].map(k => { const r = single(k % 2 ? kit.rock1 : kit.rock0, propMat, bakeAt(d, hz.h.x, hz.y + 1, hz.h.z)); r.visible = false; group.add(r); return {mesh: r, ox: Math.cos(k * 1.9 + hz.h.x) * .7 * (k ? 1 : .2), oz: Math.sin(k * 1.9 + hz.h.z) * .7 * (k ? 1 : .2), s: .7 + k * .18}; });
      const ring = new THREE.Mesh(new THREE.RingGeometry(hz.h.radius - .15, hz.h.radius, 32).rotateX(-Math.PI / 2), warnMat.clone()); ring.position.set(hz.h.x, hz.y + .04, hz.h.z); ring.raycast = () => {}; group.add(ring); hz.ring = ring;
    }
  }
  return {run, d, group, meshes, chests, key, plinth, gateMesh, gateY, shrineMesh, hoardChest, hoardLid: hl, hoardPile, exit, hazards, flameMat, buildMs: performance.now() - t0, triangles: shell.triangles, shards: []};
}

export function createUnderwayView({scene, quality = 'high', sound = () => {}, kick = () => {}, mount = null, height = null} = {}) {
  const propMat = propMaterial(), built = new Map(), root = new THREE.Group(); root.name = 'Underways'; scene.add(root);
  const L = UNDERWAY_VIEW.lantern, lantern = new THREE.PointLight(L.color, 0, L.distance, L.decay); lantern.name = 'UnderwayLantern'; lantern.castShadow = false; lantern.userData.ignoreContact = true; scene.add(lantern);
  // Surface portals follow the world in the snapshot: the arena's own mine, or every cave a generated world placed.
  let portals = null, portalKey = '';
  function syncPortals(snapshot) {
    const sites = underwaySites(snapshot?.world ? snapshot : null), key = (snapshot?.world ? JSON.stringify(snapshot.world) : 'arena') + sites.length;
    if (portals && key === portalKey) return; portals?.dispose(); portalKey = key; portals = createUnderwayPortal({scene, sites, height, propMat});
  }
  syncPortals(null);
  const cards = createUnderwayCards({mount});
  const eye = new THREE.Vector3(), look = new THREE.Vector3(), fogDeep = new THREE.Color(), skyKeep = new THREE.Color();
  let skyOwn = null; // the scene's background colour while we darken it underground (restored on the way out)
  let depth = 0, time = 0, primed = false, current = null, lastBuild = 0;
  const stat = {runs: 0, buildMs: 0, triangles: 0, depth: 0, lantern: 0, inside: false};

  function sync(snapshot) {
    const runs = snapshot?.underways?.runs || [];
    for (const [id, b] of built) if (!runs.some(r => r.id === id && r.seed === b.run.seed && r.slot === b.run.slot)) { root.remove(b.group); disposeRun(b); built.delete(id); }
    for (const run of runs) {
      let b = built.get(run.id);
      if (!b) { b = buildRun(run, {quality, propMat}); built.set(run.id, b); root.add(b.group); lastBuild = b.buildMs; }
      b.run = run;
    }
    stat.runs = built.size; stat.buildMs = lastBuild; stat.triangles = [...built.values()].reduce((n, b) => n + b.triangles, 0);
  }
  function disposeRun(b) { for (const m of b.meshes) m.geometry.dispose(); b.group.traverse(o => { if (o.isMesh && !b.meshes.includes(o) && o.geometry !== underwayKit().flame) o.geometry.dispose?.(); }); b.flameMat.dispose(); }

  function animate(b, tick, dt) {
    const {run, d} = b;
    for (const hz of b.hazards) {
      const h = hz.h, active = run.woke.includes(h.room), ph = active ? (hazardPhase(h, Math.floor(tick)) + (tick % 1)) : -1;
      if (h.type === 'flame' && hz.flame) {
        const on = active && ph < h.on, pre = active && ph > h.period - 24, k = on ? Math.min(1, ph / 8) * (1 - smooth((ph - h.on + 14) / 14)) : 0;
        hz.flame.visible = on || pre;
        const flick = 1 + .12 * Math.sin(time * 31 + h.x) + .08 * Math.sin(time * 47 + h.z);
        if (on) hz.flame.scale.set(.9 + .25 * k, (.3 + 2.6 * k) * flick, .9 + .25 * k);
        else if (pre) { const w = (ph - (h.period - 24)) / 24; hz.flame.scale.set(.5 * w, .25 * w * flick, .5 * w); }
      }
      if (h.type === 'spikes' && hz.spikes) {
        // A short tremble, the snap up, a hold, then a slow sink: readable timing on every device.
        const up = !active ? 0 : ph < 4 ? ph / 4 : ph < h.on ? 1 : ph < h.on + 20 ? 1 - (ph - h.on) / 20 : ph > h.period - 18 ? .06 * Math.abs(Math.sin(time * 60)) : 0;
        hz.spikes.position.y = hz.y - .7 + .72 * up;
      }
      if (h.type === 'rockfall' && hz.rocks) {
        const fallStart = h.warn - 22, warnK = active && ph < h.warn ? smooth(ph / h.warn) : 0;
        hz.ring.material.opacity = active && ph < h.warn ? .15 + .55 * warnK * (.75 + .25 * Math.sin(time * 12)) : 0;
        for (const r of hz.rocks) {
          if (!active || ph < fallStart || ph > h.warn + 160) { r.mesh.visible = false; continue; }
          r.mesh.visible = true;
          const t = clamp((ph - fallStart) / 22), y = ph < h.warn ? lerp(hz.roof - .2, hz.y + .2 * r.s, t * t) : hz.y + .2 * r.s, sink = ph > h.warn + 100 ? (ph - h.warn - 100) / 60 : 0;
          r.mesh.position.set(h.x + r.ox, y - sink * .45, h.z + r.oz); r.mesh.scale.setScalar(r.s * (1 - sink * .6)); r.mesh.rotation.set(t * 3 + r.s, t * 2, 0);
        }
      }
    }
    // Chests and urns: a lid swings open; an urn bursts into shards.
    for (const c of b.chests) {
      const opened = run.opened.includes(c.c.id);
      if (opened && c.opened === null) { c.opened = time; if (!c.c.tier) burstShards(b, c); }
      if (c.c.tier && c.g.userData.lid) c.g.userData.lid.rotation.x = c.opened === null ? 0 : -1.9 * smooth((time - c.opened) / .45);
      if (!c.c.tier) c.g.visible = !opened;
    }
    // The key floats and turns until taken; the gate rises once opened.
    b.key.visible = !run.key; b.key.position.y = floorHeight(d, d.key.x, d.key.z) + 1.45 + Math.sin(time * 2) * .08; b.key.rotation.y = time * 1.4;
    const rise = run.gateTick >= 0 ? smooth((tick - run.gateTick) / GATE_RISE) : 0;
    b.gateMesh.position.y = b.gateY + rise * (ceilingAt(d, d.gate.x, d.gate.z) - .2); b.gateMesh.position.x = d.gate.x + (rise > 0 && rise < 1 ? Math.sin(time * 40) * .02 : 0);
    // The hoard rumbles when its guardian falls, bursts, and the way out rises from the floor.
    const since = run.bossDown >= 0 ? tick - run.bossDown : -1, burst = run.hoardTick >= 0 ? tick - run.hoardTick : -1;
    const shake = since >= 0 && burst < 0 ? smooth(since / UNDERWAYS.hoardDelay) : 0;
    b.hoardChest.position.x = d.hoard.x + Math.sin(time * 37) * .05 * shake; b.hoardChest.position.z = d.hoard.z + Math.cos(time * 29) * .05 * shake;
    b.hoardLid.rotation.x = burst >= 0 ? -2.1 * smooth(burst / 12) : -.12 * shake * (.5 + .5 * Math.sin(time * 23));
    const exitK = burst >= 0 ? smooth((burst - UNDERWAYS.exitDelay * .4) / (UNDERWAYS.exitDelay * .6)) : 0;
    b.exit.visible = exitK > 0; if (b.exit.visible) { b.exit.position.y = floorHeight(d, d.exit.x, d.exit.z) - 2.6 * (1 - exitK); b.exit.rotation.z = time * .6; }
    // Shards and coins in flight.
    for (let i = b.shards.length - 1; i >= 0; i--) {
      const s = b.shards[i]; s.t += dt; s.v[1] -= 9.8 * dt; s.mesh.position.x += s.v[0] * dt; s.mesh.position.y += s.v[1] * dt; s.mesh.position.z += s.v[2] * dt; s.mesh.rotation.x += s.spin * dt;
      const floor = floorHeight(d, s.mesh.position.x, s.mesh.position.z) + .03; if (s.mesh.position.y < floor) { s.mesh.position.y = floor; s.v[0] *= .5; s.v[2] *= .5; s.v[1] = Math.abs(s.v[1]) * .25; s.spin *= .5; }
      if (s.t > s.life) { b.group.remove(s.mesh); s.mesh.geometry.dispose(); b.shards.splice(i, 1); } else if (s.t > s.life - .6) s.mesh.scale.setScalar(Math.max(.01, (s.life - s.t) / .6) * s.size);
    }
  }
  const shardGeo = new THREE.TetrahedronGeometry(.08, 0), coinGeo = new THREE.CylinderGeometry(.06, .06, .015, 8);
  function burstShards(b, c, {coins = 0} = {}) {
    const L = bakeAt(b.d, c.c.x, floorHeight(b.d, c.c.x, c.c.z) + .5, c.c.z);
    for (let k = 0; k < (coins || 9); k++) {
      const geo = coins ? coinGeo : shardGeo, color = coins ? [.95, .72, .28] : [.66, .38, .24];
      const g = geo.clone(), n = g.attributes.position.count, col = new Float32Array(n * 3), gl = new Float32Array(n), pl = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col.set(color, i * 3); gl[i] = coins ? .35 : 0; pl.set(L, i * 3); }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1)); g.setAttribute('aPropLight', new THREE.BufferAttribute(pl, 3));
      const mesh = new THREE.Mesh(g, propMat), a = k * 2.4 + c.c.x, sp = coins ? 2 + (k % 5) * .7 : 1.5 + (k % 3) * .8;
      mesh.position.set(c.c.x, floorHeight(b.d, c.c.x, c.c.z) + (coins ? 1.2 : .35), c.c.z); mesh.raycast = () => {}; b.group.add(mesh);
      b.shards.push({mesh, v: [Math.cos(a) * sp * .6, coins ? 5 + (k % 4) : 2.5 + (k % 3), Math.sin(a) * sp * .6], spin: 6 + k, t: 0, life: coins ? 3.2 : 2.2, size: 1});
    }
  }

  return {
    group: root, depth: () => depth,
    /** Call once per frame after the sky has set the day's light. */
    update(dt, {camera, sun, hemisphere, fog, snapshot, tick = 0} = {}) {
      time += dt; lookUniforms.uUwTime.value = time; propTime(time);
      sync(snapshot); syncPortals(snapshot);
      camera.getWorldPosition(eye);
      const inside = inUnderway(eye.x, eye.z), target = inside ? 1 : 0;
      // Snap on arrival (a teleport), ease only for small changes.
      if (!primed || Math.abs(target - depth) > .5) depth = target; else depth += (target - depth) * Math.min(1, dt * 3);
      primed = true; stat.inside = inside; stat.depth = depth;
      current = inside ? [...built.values()].find(b => b.run.slot === slotOf(eye.x, eye.z)) || null : null;
      const k = smooth(depth), D = UNDERWAY_VIEW.dim;
      if (k > 0) {
        if (sun) sun.intensity *= 1 - D.sun * k;
        if (hemisphere) hemisphere.intensity *= 1 - D.hemi * k;
        scene.environmentIntensity = (scene.environmentIntensity ?? 1) * (1 - D.env * k);
        // Underground there is no sky: any seam the rock leaves shows the dungeon's own dark, never daylight.
        if (scene.background?.isColor && scene.background !== fog?.color) { if (skyOwn !== scene.background) { skyOwn = scene.background; skyKeep.copy(skyOwn); } skyOwn.copy(skyKeep).lerp(fogDeep.set(UNDERWAY_LOOK[current?.d.style || 'mine'].fog), k); }
        if (fog && current) { fogDeep.set(UNDERWAY_LOOK[current.d.style].fog); fog.color.lerp(fogDeep, k); if (fog.isFog) { fog.near = lerp(fog.near, 9, k); fog.far = lerp(fog.far, 46, k); } else if (fog.isFogExp2) fog.density = lerp(fog.density, .028, k); }
      }
      else if (skyOwn) { skyOwn.copy(skyKeep); skyOwn = null; }
      camera.getWorldDirection(look);
      lantern.position.copy(eye).addScaledVector(look, -.35); lantern.position.y += .55; // above and behind the head: lights the way, not the held weapon
      lantern.intensity = L.intensity * k; stat.lantern = lantern.intensity;
      for (const b of built.values()) { b.group.visible = b === current; if (b.group.visible) animate(b, tick, dt); }
      portals?.update(dt, {tick, camera, snapshot, inside});
      cards.update(dt);
    },
    /** Sim events: wakes, keys, gates, chests, the hoard. Sounds and the story cards. */
    event(e, {me} = {}) {
      const b = e.run ? built.get(e.run) : null;
      if (e.kind === 'underway_enter' && e.id === me) cards.title(e.name, {mine: 'An old mine, dug too deep', crypt: 'A crypt that never quite settled', keep: 'A keep the earth swallowed whole'}[e.style] || '');
      if (e.kind === 'underway_room' && e.id === me && e.lore) cards.lore(e.lore);
      if (e.kind === 'underway_key') { sound('reward', e.position, {tone: 'key'}); if (e.id === me) cards.lore('You take the gate key. Somewhere behind you, a lock clicks hopefully.'); }
      if (e.kind === 'underway_gate') { sound('stone_hit', e.position, {weight: 1.6}); kick(.6); }
      if (e.kind === 'underway_open' && b) { sound(e.tier ? 'reward' : 'stone_hit', e.position, {weight: e.tier ? 1 : .6}); }
      if (e.kind === 'underway_wave') { kick(.5); cards.lore(e.wave === 1 ? 'The guardian bellows. More of them are coming!' : 'The guardian staggers and calls for everyone left!'); }
      if (e.kind === 'underway_boss_down') { kick(1); cards.lore('The guardian falls. The hoard begins to rumble…'); }
      if (e.kind === 'underway_hoard' && b) {
        kick(1.2); sound('reward', e.position, {tone: 'hoard'});
        burstShards(b, {c: {x: b.d.hoard.x, z: b.d.hoard.z, tier: 1}}, {coins: 28});
        const mine = e.granted?.find(g => g.id === me);
        cards.title('Hoard claimed!', mine ? `You found the ${ITEMS[mine.item]?.name || 'treasure'} in the hoard! The way out is opening.` : 'The way out is opening.');
      }
      if (e.kind === 'underway_leave' && e.id === me && e.reason === 'victory') cards.lore('Back in the daylight. The mine shifts and settles behind you: next time it will be somewhere new.');
    },
    stats: () => ({...stat, portals: portals?.stats()}),
    /** Crown a guardian golem's model (its head bone, or the top of the model when it has none). */
    dressGuardian(model) {
      if (!model || model.userData.uwCrown) return;
      let head = null; model.traverse(o => { if (!head && (o.isBone || o.type === 'Object3D') && /head/i.test(o.name)) head = o; });
      const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
      const crown = single(underwayKit().crown, propMat, [.9, .75, .6]); crown.name = 'UnderwayCrown';
      const width = size.x * .2; // about the head's span on the golem
      model.updateWorldMatrix(true, true);
      if (head) { const ws = head.getWorldScale(new THREE.Vector3()), wp = head.getWorldPosition(new THREE.Vector3()); crown.scale.setScalar(width / ws.x); head.add(crown); crown.position.set(0, (box.max.y - wp.y) * .55 / ws.y, 0); }
      else { const ms = model.getWorldScale(new THREE.Vector3()).x; crown.scale.setScalar(width / ms); crown.position.set(0, (box.max.y - model.getWorldPosition(new THREE.Vector3()).y) / ms - .05, 0); model.add(crown); }
      model.userData.uwCrown = crown;
    },
    current: () => current,
    dispose() { for (const b of built.values()) disposeRun(b); scene.remove(root); scene.remove(lantern); portals?.dispose(); cards.dispose(); propMat.dispose(); },
  };
}
