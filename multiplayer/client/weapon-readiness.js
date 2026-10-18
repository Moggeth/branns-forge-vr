import * as THREE from 'three';
import {createPickLuminance} from './pick-luminance.js';
import {createKingsfellLuminance} from './kingsfell-luminance.js';

// Diegetic weapon readiness for Brann's Forge held tools.
//
// Placement contract
// - `root` is the authored weapon object: the GLB scene clone (`prepareAsset().model`), its canonical
//   `visual` wrapper, the Emberdew group from createEmberdewModel(), or the held limb's detached group.
// - Anchors are found by AUTHORED node names (see ANCHORS) and converted into the authored host node's
//   local space, so every size below is authored metres and follows any canonical scale/basis/mirror.
// - One Group `readiness:<tool>` is added under that host. Existing geometry, node names, socket names and
//   parent transforms are never written. Surfaces are found by scanning authored vertices once.
// - Inputs are fractions owned by the shared simulation; this module never runs its own timers.
//   axe: specialReady (Timberfall) · pick/hammer: specialReady (4 s special) · crossbow: attackReady (1.0 s songbird reload) · bow: attackReady (0.55 s,
//   curve adds nothing) · limb: attackReady (0.53 s) · wyrmspout: heat + overheated (3 s lock) and
//   specialReady (6 s Gout) · flask: specialReady (12 s Cinder Cluster; the 1 s toss needs no indicator).
// - Max 3 draw calls per tool, no lights, every descendant has userData.ignoreContact = true.

export const READINESS_TIMINGS = Object.freeze({
  axe: {special: 7}, pick: {special: 4}, hammer: {special: 4}, crossbow: {attack: 1}, bow: {attack: .55},
  limb: {attack: .53}, wyrmspout: {vent: 6, overheatLock: 3}, flask: {special: 12},
});

export const ANCHORS = Object.freeze({
  axe: ['CuttingEdge_Mid', 'Head_Blade'], pick: ['Grip', 'Shaft'], hammer: ['04 Oxblood leather'],
  crossbow: ['GripAnchor', 'Body'], bow: ['Grip', 'RiserMesh'], wyrmspout: ['GripAnchor', 'Neck_Scales'],
  flask: ['NeckCollar', 'Glass'], limb: [],
});

const PULSE_SECONDS = .42;
// Object3D.clone serializes userData. Keep lifecycle objects (which reference root)
// outside that serializable bag, especially the live flask used as a template.
const instances = new WeakMap();
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color(), _tint = new THREE.Color(), _hotFrom = new THREE.Color(0x7a2a0a);
const _hotTo = new THREE.Color(0xff3416), _warmTo = new THREE.Color(0xff7a24);
const clamp01 = x => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
const key = name => String(name || '').replace(/[\s_.\-]/g, '').toLowerCase();

function findNode(root, name) {
  const wanted = key(name); let hit = null;
  root.traverse(o => { if (!hit && !o.userData.readinessOwned && key(o.name) === wanted) hit = o; });
  return hit;
}

// Authored vertices of the given nodes, in host space. Subsampled for very dense meshes; queries add a gap.
function collectPoints(host, nodes) {
  const out = [], inv = new THREE.Matrix4().copy(host.matrixWorld).invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
  for (const node of nodes) node?.traverse(o => {
    const pos = o.isMesh && !o.userData.readinessOwned ? o.geometry?.attributes?.position : null; if (!pos) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const step = Math.max(1, Math.floor(pos.count / 24000));
    for (let i = 0; i < pos.count; i += step) { v.fromBufferAttribute(pos, i).applyMatrix4(m); out.push(v.x, v.y, v.z); }
  });
  return new Float32Array(out);
}

// Furthest authored surface along `dir` within `radius` of the line (center, dir).
function surface(points, center, dir, radius, fallback = 0) {
  let best = -Infinity; const r2 = radius * radius;
  for (let i = 0; i < points.length; i += 3) {
    const dx = points[i] - center.x, dy = points[i + 1] - center.y, dz = points[i + 2] - center.z;
    const along = dx * dir.x + dy * dir.y + dz * dir.z;
    if (dx * dx + dy * dy + dz * dz - along * along < r2 && along > best) best = along;
  }
  return Number.isFinite(best) ? best : fallback;
}

// Exact outermost authored surface along `dir` through `center` (host space), by raycasting authored triangles
// from outside. Used where vertices are too sparse or ridged for `surface`. Returns fallback on a miss.
const _ray = new THREE.Raycaster();
function castSurface(host, nodes, center, dir, fallback, reach = .25) {
  const origin = host.localToWorld(center.clone().addScaledVector(dir, reach));
  const back = host.localToWorld(center.clone()).sub(origin).normalize();
  _ray.set(origin, back); _ray.near = 0; _ray.far = Infinity;
  const hit = _ray.intersectObjects(nodes.filter(Boolean), true).find(h => !h.object.userData.readinessOwned);
  return hit ? host.worldToLocal(hit.point.clone()).sub(center).dot(dir) : fallback;
}

// Largest radial distance from an axis inside [from, to] along it, ignoring anything beyond maxR (heads, blades).
function radiusAt(points, origin, axis, from, to, maxR, fallback) {
  let best = 0;
  for (let i = 0; i < points.length; i += 3) {
    const dx = points[i] - origin.x, dy = points[i + 1] - origin.y, dz = points[i + 2] - origin.z;
    const t = dx * axis.x + dy * axis.y + dz * axis.z; if (t < from || t > to) continue;
    const r = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - t * t)); if (r < maxR && r > best) best = r;
  }
  return best > 0 ? best : fallback;
}

// Longest (shaft) and thinnest (etching face) axes of a point cloud by power iteration on its covariance.
function principalAxes(pts) {
  const mean = new THREE.Vector3(), n = pts.length / 3, c = new Float64Array(9);
  for (let i = 0; i < pts.length; i += 3) mean.add(_v.fromArray(pts, i)); mean.divideScalar(n);
  for (let i = 0; i < pts.length; i += 3) {
    const d = [pts[i] - mean.x, pts[i + 1] - mean.y, pts[i + 2] - mean.z];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) c[a * 3 + b] += d[a] * d[b] / n;
  }
  const dominant = (skip) => {
    const v = new THREE.Vector3(.31, .83, .47);
    for (let k = 0; k < 48; k++) {
      if (skip) v.addScaledVector(skip, -v.dot(skip));
      v.set(c[0] * v.x + c[1] * v.y + c[2] * v.z, c[3] * v.x + c[4] * v.y + c[5] * v.z, c[6] * v.x + c[7] * v.y + c[8] * v.z);
      if (skip) v.addScaledVector(skip, -v.dot(skip));
      if (v.lengthSq() < 1e-20) { v.set(1, 0, 0); if (skip) v.addScaledVector(skip, -v.dot(skip)); if (v.lengthSq() < 1e-6) v.set(0, 1, 0); }
      v.normalize();
    }
    return v;
  };
  const long = dominant(null), second = dominant(long);
  return {long, side: new THREE.Vector3().crossVectors(long, second).normalize()};
}
function boundsIn(host, node) {
  const pts = collectPoints(host, [node]), box = new THREE.Box3();
  for (let i = 0; i < pts.length; i += 3) box.expandByPoint(_v.fromArray(pts, i));
  return box;
}
function hostPosition(host, node, target = new THREE.Vector3()) { return host.worldToLocal(node.getWorldPosition(target)); }
function hostQuaternion(host, node, target = new THREE.Quaternion()) {
  return target.copy(host.getWorldQuaternion(new THREE.Quaternion())).invert().multiply(node.getWorldQuaternion(_q));
}
// Orientation whose local +Z is `normal` and local +Y is as close to `up` as possible.
function basis(normal, up) {
  const z = normal.clone().normalize(), y = up.clone().addScaledVector(z, -up.dot(z)).normalize(), x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

// Lit inlay material: constant authored albedo; per-instance colour is ADDED as emission only, so an empty
// segment is a dark metal/crystal/bone inlay and a charged one glows without tinting the base colour.
function glowMaterial({color, metalness = .6, roughness = .45}) {
  const material = new THREE.MeshStandardMaterial({color, metalness, roughness, emissive: 0x000000});
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', '')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n\ttotalEmissiveRadiance += vColor.rgb;\n#endif');
  };
  material.customProgramCacheKey = () => 'brann-readiness-glow-v1';
  return material;
}

function named(geometry, kind) { geometry.name = `readiness:${kind}`; return geometry; }
function diamondGeometry(w, h, depth) {
  const s = new THREE.Shape(); s.moveTo(0, -h / 2); s.lineTo(w / 2, 0); s.lineTo(0, h / 2); s.lineTo(-w / 2, 0); s.closePath();
  return new THREE.ExtrudeGeometry(s, {depth, bevelEnabled: false});
}
function featherGeometry(length, width, depth) {
  const s = new THREE.Shape(); s.moveTo(0, 0);
  s.quadraticCurveTo(width * .75, length * .35, width * .18, length); s.lineTo(0, length * .9);
  s.lineTo(-width * .18, length); s.quadraticCurveTo(-width * .75, length * .35, 0, 0);
  return new THREE.ExtrudeGeometry(s, {depth, bevelEnabled: false, curveSegments: 4}).translate(0, 0, -depth / 2);
}

// One readiness strip: instanced segments with a step index each (mirrored sides share a step).
class Strip {
  constructor(owner, geometry, material, transforms, steps, palette) {
    this.mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
    this.steps = steps; this.count = Math.max(...steps) + 1; this.palette = palette; this.last = '';
    transforms.forEach(([p, q, s], i) => this.mesh.setMatrixAt(i, _m.compose(p, q, s || _s)));
    this.mesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < transforms.length; i++) this.mesh.setColorAt(i, new THREE.Color(0, 0, 0));
    this.mesh.computeBoundingSphere(); this.mesh.computeBoundingBox?.();
    owner.add(this.mesh, geometry, material);
  }
  // value: 0..1 fill; mode: 'charge' | 'ready' | 'off'; boost: transition pulse 0..1; tint optional Color.
  paint(value, mode, boost = 0, tint = null) {
    const stamp = `${Math.round(value * 240)}|${mode}|${Math.round(boost * 60)}|${tint ? tint.getHexString() : ''}`;
    if (stamp === this.last) return; this.last = stamp;
    const p = this.palette, c = _c;
    for (let i = 0; i < this.steps.length; i++) {
      if (mode === 'off') c.setRGB(0, 0, 0);
      else if (mode === 'ready') c.copy(tint || p.ready).multiplyScalar(p.readyGain * (1 + boost * 1.6));
      else {
        const fill = clamp01(value * this.count - this.steps[i]);
        c.copy(tint || p.charge).multiplyScalar(p.chargeGain * (fill < 1 ? fill * .55 : 1));
      }
      this.mesh.setColorAt(i, c);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
}

class Owner {
  constructor(tool) {
    this.group = new THREE.Group(); this.group.name = `readiness:${tool}`;
    this.geometries = new Set(); this.materials = new Set(); this.cleanup = [];
  }
  add(mesh, geometry, material) {
    if (geometry) this.geometries.add(geometry);
    if (material) this.materials.add(material);
    mesh.castShadow = mesh.receiveShadow = false; this.group.add(mesh); return mesh;
  }
  seal() {
    this.group.traverse(o => { o.userData.ignoreContact = true; o.userData.readinessOwned = true; });
  }
}

// Transition-only ready pulse. Never loops.
class Channel {
  constructor() { this.ready = null; this.pulseAt = -Infinity; }
  step(ready, time, reducedMotion) {
    if (this.ready === false && ready && !reducedMotion) this.pulseAt = time;
    this.ready = ready;
    const t = (time - this.pulseAt) / PULSE_SECONDS;
    return t >= 0 && t < 1 ? (1 - t) * (1 - t) : 0;
  }
}

// Emission is added on top of lit albedo and then ACES-tonemapped, so ready gains stay modest and hues
// saturated: brighter values bleach to cream in daylight and bloom into "neon soup" in VR.
const PALETTES = {
  gold: {charge: new THREE.Color(0xb87818), ready: new THREE.Color(0xffb22a), chargeGain: .5, readyGain: .6},
  crystal: {charge: new THREE.Color(0x1d5c9e), ready: new THREE.Color(0x3a9cff), chargeGain: .55, readyGain: .7},
  copper: {charge: new THREE.Color(0x9a3a12), ready: new THREE.Color(0xff6a1c), chargeGain: .5, readyGain: .6},
  brass: {charge: new THREE.Color(0x8a6a34), ready: new THREE.Color(0xffcf78), chargeGain: .45, readyGain: .6},
  ember: {charge: new THREE.Color(0x9a300a), ready: new THREE.Color(0xff7418), chargeGain: .55, readyGain: .62},
  bone: {charge: new THREE.Color(0x7a5a34), ready: new THREE.Color(0xe8b874), chargeGain: .35, readyGain: .42},
  heat: {charge: new THREE.Color(0xff5a12), ready: new THREE.Color(0xff5a12), chargeGain: 1, readyGain: 1},
  cool: {charge: new THREE.Color(0x2c6c98), ready: new THREE.Color(0x58bfff), chargeGain: .5, readyGain: .62},
  amber: {charge: new THREE.Color(0xa45a14), ready: new THREE.Color(0xff9a2a), chargeGain: .5, readyGain: .6},
};

// ---------------------------------------------------------------- per-tool authored layouts
const BUILD = {
  // Kingsfell: the head's own light is the indicator. The amber heart kindles, sap runs down the gold veins and lights
  // the honed edge (client/kingsfell-luminance.js); one edge ribbon draw.
  axe(owner, host, find) {
    const luminance = createKingsfellLuminance(owner, host, find); if (luminance) owner.cleanup.push(luminance.dispose);
    return {special: {paint() {}}, luminance};
  },
  // Blue crystal nodes in brass settings: three tiers on four faces under the head, filling up toward it.
  pick(owner, host, find) {
    const pts = collectPoints(host, ['Shaft', 'BrassTrim', 'Embellish_Gold_Bands', 'Embellish_Darkmetal_Spine', 'GripWrap'].map(find));
    const top = boundsIn(host, find('HeadSocket')).min.y - .022, gems = [], settings = [], steps = [];
    [top - .064, top - .032, top].forEach((y, tier) => {
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + Math.PI / 4, n = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        const r = surface(pts, _v.set(0, y, 0), n, .006, .026), q = basis(n, new THREE.Vector3(0, 1, 0)); // per-face: the trim is not round
        gems.push([n.clone().multiplyScalar(r + .0042).setY(y), q]); settings.push([n.clone().multiplyScalar(r + .0009).setY(y), q]); steps.push(tier);
      }
    });
    const setting = new THREE.InstancedMesh(named(new THREE.TorusGeometry(.0072, .0017, 5, 12), 'pick-setting'), new THREE.MeshStandardMaterial({color: 0x8a6a34, metalness: .9, roughness: .38}), settings.length);
    settings.forEach(([p, q], i) => setting.setMatrixAt(i, _m.compose(p, q, _s))); setting.computeBoundingSphere();
    owner.add(setting, setting.geometry, setting.material);
    const gem = named(new THREE.OctahedronGeometry(.0058, 0).scale(.85, 1.45, .7), 'pick-node');
    // The head's own Resonance gems carry the charge too: drain on use, re-ignite heart → arm tips → crown.
    const luminance = createPickLuminance(owner, host, find); if (luminance) owner.cleanup.push(luminance.dispose);
    return {special: new Strip(owner, gem, glowMaterial({color: 0x24435e, metalness: .1, roughness: .18}), gems, steps, PALETTES.crystal), luminance};
  },
  // Copper collar sleeve above the grip; four raised rings warm upward as the slam recharges.
  hammer(owner, host, find) {
    const grip = find('04 Oxblood leather'), all = collectPoints(host, [host]);
    const g = boundsIn(host, grip), base = g.max.y + .012, axis = new THREE.Vector3(0, 1, 0), center = new THREE.Vector3((g.min.x + g.max.x) / 2, 0, (g.min.z + g.max.z) / 2);
    // Measure the plain haft above the grip's brass band so the sleeve hugs wood, not trim.
    const r = radiusAt(all, center, axis, base + .03, base + .1, .07, .04), height = .086;
    const sleeveGeometry = named(new THREE.CylinderGeometry(r + .0016, r + .0016, height, 28, 1, true), 'hammer-sleeve');
    const sleeve = new THREE.Mesh(sleeveGeometry, new THREE.MeshStandardMaterial({color: 0x9a5530, metalness: .88, roughness: .42, side: THREE.DoubleSide}));
    sleeve.position.copy(center).setY(base + height / 2); owner.add(sleeve, sleeveGeometry, sleeve.material);
    const ring = named(new THREE.TorusGeometry(r + .0034, .0034, 6, 32).rotateX(Math.PI / 2), 'hammer-ring'), rings = [], steps = [];
    for (let i = 0; i < 4; i++) { rings.push([center.clone().setY(base + .012 + i * .0207), new THREE.Quaternion()]); steps.push(i); }
    return {special: new Strip(owner, ring, glowMaterial({color: 0x8a4422, metalness: .9, roughness: .36}), rings, steps, PALETTES.copper)};
  },
  // Small brass dial on the stock's left plate: ten ticks light clockwise and a steel needle sweeps.
  crossbow(owner, host, find) {
    const pts = collectPoints(host, [find('Body')]), grip = hostPosition(host, find('GripAnchor'));
    const center = new THREE.Vector3(0, grip.y + .17, grip.z + .1), n = new THREE.Vector3(-1, 0, 0);
    center.x = -surface(pts, _v.copy(center).setX(0), n, .03, .2) - .0015;
    const face = basis(n, new THREE.Vector3(0, 0, 1)), dial = new THREE.Group(); dial.position.copy(center); dial.quaternion.copy(face); owner.group.add(dial);
    const bezelGeometry = named(new THREE.CylinderGeometry(.024, .026, .005, 28).rotateX(Math.PI / 2).translate(0, 0, .0025), 'crossbow-bezel');
    const bezel = new THREE.Mesh(bezelGeometry, new THREE.MeshStandardMaterial({color: 0x3a2c1c, metalness: .7, roughness: .5}));
    owner.geometries.add(bezelGeometry); owner.materials.add(bezel.material); dial.add(bezel);
    const ticks = [], steps = [], sweep = Math.PI * 1.5;
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + sweep / 2 - (i + .5) / 10 * sweep;
      ticks.push([new THREE.Vector3(Math.cos(a) * .018, Math.sin(a) * .018, .0058), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a - Math.PI / 2)]); steps.push(i);
    }
    const strip = new Strip({add: (m, g, mat) => { owner.geometries.add(g); owner.materials.add(mat); dial.add(m); }},
      named(new THREE.BoxGeometry(.0034, .0068, .0014), 'crossbow-tick'), glowMaterial({color: 0x6e5630, metalness: .85, roughness: .4}), ticks, steps, PALETTES.brass);
    const needleGeometry = named(new THREE.BoxGeometry(.0026, .017, .0012).translate(0, .0072, .0072), 'crossbow-needle');
    const needle = new THREE.Mesh(needleGeometry, new THREE.MeshStandardMaterial({color: 0x1e1f22, metalness: .8, roughness: .35, emissive: 0xffe2a2, emissiveIntensity: 0}));
    owner.geometries.add(needleGeometry); owner.materials.add(needle.material); dial.add(needle);
    const aim = v => { needle.rotation.z = sweep / 2 - clamp01(v) * sweep; };
    aim(1);
    return {attack: strip, needle, aim};
  },
  // Ember feathers fanned outward on both riser cheeks, clear of the arrow line; fill bottom → top.
  bow(owner, host, find) {
    const pts = collectPoints(host, [find('RiserMesh'), find('GripMesh')]), grip = hostPosition(host, find('Grip'));
    const transforms = [], steps = [], ys = [.082, .1, .118, .136];
    for (const side of [1, -1]) ys.forEach((dy, i) => {
      const p = new THREE.Vector3(0, grip.y + dy, grip.z - .016), n = new THREE.Vector3(side, 0, 0);
      p.x = side * (surface(pts, _v.copy(p), n, .008, .036) + .0012);
      const dir = new THREE.Vector3(side * .55, .62, -.56).normalize();
      transforms.push([p, basis(n.clone().addScaledVector(dir, -n.dot(dir)).normalize().lerp(n, .55).normalize(), dir)]); steps.push(i);
    });
    const feather = named(featherGeometry(.03, .011, .0012), 'bow-feather');
    return {attack: new Strip(owner, feather, glowMaterial({color: 0x4a2a1a, metalness: .25, roughness: .55}), transforms, steps, PALETTES.ember)};
  },
  // Subtle etched runes along the held bone's mid-shaft, on both broad faces; fill along the shaft.
  limb(owner, host) {
    const pts = collectPoints(host, [host]); if (pts.length < 9) return {};
    // Detached parts are runtime-baked and often bent (upper arm + forearm + hand), so a global axis cuts
    // joints obliquely. Slide a window along the global axis, fit a LOCAL axis in each window and keep the
    // window with the smallest radial spread around its own axis: a straight shaft, not a knuckle or hand.
    const global = principalAxes(pts).long;
    let tMin = Infinity, tMax = -Infinity;
    for (let i = 0; i < pts.length; i += 3) { const t = _v.fromArray(pts, i).dot(global); tMin = Math.min(tMin, t); tMax = Math.max(tMax, t); }
    const span = tMax - tMin, half = Math.max(.012, span * .065);
    const windowAt = t => {
      const sel = [];
      for (let k = 0; k < pts.length; k += 3) if (Math.abs(pts[k] * global.x + pts[k + 1] * global.y + pts[k + 2] * global.z - t) < half) sel.push(pts[k], pts[k + 1], pts[k + 2]);
      if (sel.length < 36) return null;
      const local = principalAxes(sel), c = new THREE.Vector3(); for (let k = 0; k < sel.length; k += 3) c.add(_v.fromArray(sel, k)); c.divideScalar(sel.length / 3);
      let radial = 0; for (let k = 0; k < sel.length; k += 3) { _v.fromArray(sel, k).sub(c); radial = Math.max(radial, _v.addScaledVector(local.long, -_v.dot(local.long)).length()); }
      return {c, long: local.long, side: local.side, radial};
    };
    let run = null;
    for (let i = 0; i <= 12; i++) { const w = windowAt(tMin + span * (.15 + i * .7 / 12)); if (w && (!run || w.radial < run.radial)) run = w; }
    if (!run) return {};
    const transforms = [], steps = [], spacing = Math.min(.018, half * .4);
    for (let i = 0; i < 5; i++) {
      const c = run.c.clone().addScaledVector(run.long, (i - 2) * spacing);
      for (const s of [1, -1]) {
        const n = run.side.clone().multiplyScalar(s), lift = castSurface(host, [host], c, n, NaN);
        if (!(lift > 0 && lift < .06)) continue;
        transforms.push([c.clone().addScaledVector(n, lift + .0004), basis(n, run.long)]); steps.push(i);
      }
    }
    if (!transforms.length) return {};
    const mark = named(diamondGeometry(.0042, .021, .0008), 'limb-etching');
    return {attack: new Strip(owner, mark, glowMaterial({color: 0x6e5a40, metalness: 0, roughness: .8}), transforms, steps, PALETTES.bone)};
  },
  // Ember slats beside the six authored cheek gills (heat/overheat): the wyrm runs hot as it spits. Gout charge is the
  // model's own fin veins and nostril flames (asset-pose.js animateWyrmspout), so there is no ring here any more.
  wyrmspout(owner, host, find) {
    const slats = [], steps = [];
    for (const side of ['L', 'R']) for (let i = 1; i <= 3; i++) {
      const vent = find(`HeatVent_${side}${i}`); if (!vent) continue;
      const p = hostPosition(host, vent); p.x += (side === 'L' ? -1 : 1) * .0042;
      slats.push([p, hostQuaternion(host, vent)]); steps.push(i - 1);
    }
    const slat = named(new THREE.CapsuleGeometry(.0021, .012, 2, 6), 'wyrmspout-slat');
    const heat = slats.length ? new Strip(owner, slat, glowMaterial({color: 0x3a2418, metalness: .5, roughness: .5}), slats, steps, PALETTES.heat) : null;
    return {heat};
  },
  // Amber collar segments just under the copper neck collar; fill from the player-facing back, both ways.
  flask(owner, host, find) {
    const collar = hostPosition(host, find('NeckCollar')), pts = collectPoints(host, [find('Glass'), find('NeckCollar')]);
    const y = collar.y - .0105, r = radiusAt(pts, _v.set(collar.x, 0, collar.z), new THREE.Vector3(0, 1, 0), y - .003, y + .003, .05, .019) + .0022;
    const arcs = [], steps = [], count = 8, arc = Math.PI * 2 / count * .72;
    for (let i = 0; i < count; i++) {
      const a = Math.PI / 2 + (i + .5) * Math.PI * 2 / count; // ring XY → rotate into XZ; start at +Z (toward the holder)
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a - arc / 2));
      arcs.push([new THREE.Vector3(collar.x, y, collar.z), q]); steps.push(Math.min(i, count - 1 - i));
    }
    const ring = named(new THREE.TorusGeometry(r, .0021, 5, 8, arc), 'flask-collar');
    return {special: new Strip(owner, ring, glowMaterial({color: 0x6a3a18, metalness: .85, roughness: .4}), arcs, steps, PALETTES.amber)};
  },
};

/**
 * createWeaponReadiness({root, tool, reducedMotion}) → {group, tool, root, update(state), dispose(), drawCalls}
 * state: {attackReady 0..1, specialReady 0..1, heat 0..1, overheated boolean, time seconds}
 * Missing readiness fields read as ready; missing heat reads as cold.
 */
export function createWeaponReadiness({root, tool, reducedMotion = false} = {}) {
  if (!root?.isObject3D) throw new Error('createWeaponReadiness: root must be an Object3D');
  if (!BUILD[tool]) throw new Error(`createWeaponReadiness: unsupported tool ${tool}`);
  instances.get(root)?.dispose(); // never stack two indicators on one authored model
  root.updateWorldMatrix(true, true);
  const find = name => findNode(root, name);
  const anchor = ANCHORS[tool].map(find).find(Boolean);
  if (ANCHORS[tool].length && !anchor) throw new Error(`createWeaponReadiness: ${tool} anchor ${ANCHORS[tool][0]} not found under root`);
  // An anchor that IS root must not push the indicator onto root's (non-authored) parent.
  const host = anchor && anchor !== root ? anchor.parent : root;
  const owner = new Owner(tool), parts = BUILD[tool](owner, host, find);
  host.add(owner.group); owner.seal();
  const channels = {attack: new Channel(), special: new Channel(), vent: new Channel()};
  let disposed = false, clock = 0;
  let drawCalls = 0; owner.group.traverse(o => { if (o.isMesh) drawCalls++; });

  function update(state = {}) {
    if (disposed) return;
    const time = Number.isFinite(state.time) ? state.time : (clock += 1 / 60);
    const attack = state.attackReady === undefined ? 1 : clamp01(state.attackReady);
    const special = state.specialReady === undefined ? 1 : clamp01(state.specialReady);
    const show = (strip, channel, value) => {
      const ready = value >= .999, boost = channel.step(ready, time, reducedMotion);
      strip?.paint(value, ready ? 'ready' : 'charge', boost);
      return boost;
    };
    if (parts.special) {
      const boost = show(parts.special, channels.special, special);
      // focus: the held pick gathering for the crystal wall brightens its gems (no extra lights).
      parts.luminance?.update(special, time, reducedMotion, Math.max(boost, clamp01(state.focus) * .55));
    }
    if (parts.attack) {
      const boost = show(parts.attack, channels.attack, attack);
      if (parts.aim) { parts.aim(attack); parts.needle.material.emissiveIntensity = attack >= .999 ? .35 + boost * .9 : 0; }
    }
    if (parts.heat) {
      const heat = clamp01(state.heat), hot = !!state.overheated;
      const tint = _tint.copy(_hotFrom).lerp(hot ? _hotTo : _warmTo, hot ? 1 : heat);
      if (hot) parts.heat.paint(1, 'ready', 0, tint.multiplyScalar(1.15));
      else parts.heat.paint(heat, heat > .002 ? 'charge' : 'off', 0, tint.multiplyScalar(.5 + heat * .7));
    }
    if (parts.vent) {
      const hot = !!state.overheated, available = special >= .999 && !hot, boost = channels.vent.step(available, time, reducedMotion);
      parts.vent.paint(special, hot ? 'off' : available ? 'ready' : 'charge', boost);
    }
  }

  function dispose() {
    if (disposed) return; disposed = true;
    owner.group.removeFromParent();
    owner.cleanup.forEach(fn => fn()); owner.cleanup.length = 0;
    owner.group.traverse(o => o.isInstancedMesh && o.dispose());
    owner.geometries.forEach(g => g.dispose()); owner.materials.forEach(m => m.dispose());
    owner.geometries.clear(); owner.materials.clear();
    if (instances.get(root) === api) instances.delete(root);
  }

  const api = {group: owner.group, host, tool, root, drawCalls, update, dispose,
    get disposed() { return disposed; },
    setReducedMotion(value) { reducedMotion = !!value; }};
  instances.set(root,api);
  update({time: 0});
  return api;
}

/** Reconstruct exactly once when root or tool changes; otherwise reuse. Pass null root to clear. */
export function syncWeaponReadiness(current, {root, tool, reducedMotion = false} = {}) {
  if (current && !current.disposed && current.root === root && current.tool === tool) { current.setReducedMotion(reducedMotion); return current; }
  current?.dispose();
  return root && tool && BUILD[tool] ? createWeaponReadiness({root, tool, reducedMotion}) : null;
}


// Fixed local equipment keeps its prepared geometry/programs between swaps.
// Held bones are transient world objects and must never accumulate in this cache.
export function createWeaponReadinessCache(){
  const entries=new Map();let current=null,disposed=false,constructed=0;
  function prepare({root,tool,reducedMotion=false}={}){
    if(disposed||!root||!BUILD[tool])return null;
    let value=entries.get(root);
    if(value&&value.tool!==tool){value.dispose();entries.delete(root);value=null;}
    if(!value||value.disposed){value=createWeaponReadiness({root,tool,reducedMotion});constructed++;if(tool!=='limb')entries.set(root,value);}
    value.setReducedMotion(reducedMotion);return value;
  }
  return {prepare,
    select(options={}){
      if(current&&!current.disposed&&current.root===options.root&&current.tool===options.tool){current.setReducedMotion(!!options.reducedMotion);return current;}
      if(current&&!entries.has(current.root))current.dispose();
      return current=prepare(options);
    },
    dispose(){if(disposed)return;disposed=true;if(current&&!entries.has(current.root))current.dispose();for(const value of entries.values())value.dispose();entries.clear();current=null;},
    stats:()=>({prepared:entries.size,constructed,disposed}),
  };
}
