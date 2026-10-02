// Meteor-born golem presentation (client only, presentation only).
//
// A golem with data.meteorBorn === true and data.unfurlTick (the Starfall
// impact tick, 60 Hz) starts as a sealed physical meteor at its root, cracks,
// sheds a few crust plates and unfurls the AUTHORED golem limb hierarchy over
// ~1.2 s. The mature creature keeps charred/hot tints and embedded star-gem
// crystals. Ordinary golems are never touched.
//
// Everything is a pure function of (tick - unfurlTick), so a fresh late join
// at the authoritative tick never replays the unfurl.
//
// Contracts:
//  - Never moves entry.root, never reparents golem nodes, never edits shared
//    template materials/geometry. Arrow embeds parented to golem bones stay valid.
//  - Decorations (shell, shards, crystals) live under entry.root, NOT under
//    entry.visual, so combat surface/mask traversal never sees them; they are
//    also tagged ignoreCombat/ignoreContact/contact=false.
//  - Extra draws per creature: shell rock + shell seam (only first ~0.4 s),
//    1 shard InstancedMesh (until ~2.2 s), 1 crystal InstancedMesh. Peak 4.
//  - Materials/geometries are shared per presentation and created once.
//    Per-frame work allocates nothing.
//
// Hooks (see HANDOFF.md):
//   beforeMotion(entry)    before mixer.update()/applyEnemyMotion (undoes last layer)
//   apply(entry, tick)     after updateGolemPose/applyEnemyMotion, before combat.tick
//   remove(entry)          when an actor is removed / its visual replaced
//   dispose()              on game teardown

const TICK_RATE = 60;
export const METEOR_TIMELINE = Object.freeze({
  sealed: .22,     // intact meteor, shuddering
  crack: .38,      // shell splits, shards launch
  unfurlEnd: 1.2,  // limbs fully unfurled
  shardsEnd: 2.2,  // shards gone
  coolEnd: 2.6,    // hot -> mature material set
});
const MATURE_AGE = METEOR_TIMELINE.coolEnd;
const SHARDS = 7, CRYSTALS = 6;
const LIMBS = ['Golem', 'BodyCore', 'Head', 'ArmL', 'ArmR', 'ElbowL', 'ElbowR', 'LegL', 'LegR'];

// Material tints keyed by authored golem material names.
// hot: during/just after unfurl; mature: cooled meteor-born identity.
const TINTS = {
  Stone_Main: {color: [.40, .33, .31], hot: [.16, .04, .01], warm: [.10, .03, .01]},
  Stone_Dark: {color: [.22, .17, .16], hot: [.55, .16, .03], warm: [.32, .08, .02]},
  Stone_Pale: {color: [.62, .48, .40], hot: [.12, .03, .01], warm: [.06, .02, .01]},
  Moss: {color: [.30, .14, .06], hot: [.60, .18, .03], warm: [.22, .06, .01], replace: true},
  Leather: {color: [.30, .20, .16], hot: [.06, .02, 0], warm: [0, 0, 0]},
  Iron: {color: [.55, .45, .42], hot: [.10, .03, .01], warm: [0, 0, 0]},
  Copper: {color: [.75, .55, .45], hot: [.10, .03, .01], warm: [0, 0, 0]},
  Gold: {color: [.85, .75, .65], hot: [.08, .02, .01], warm: [0, 0, 0]},
};

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
// Small overshoot so limbs "snap" open like stone settling.
const easeOutBack = t => { const c = 1.4; const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };

export function meteorAge(data, tick) {
  if (!data?.meteorBorn || !Number.isFinite(data.unfurlTick)) return null;
  return Math.max(0, ((Number.isFinite(tick) ? tick : 0) - data.unfurlTick) / TICK_RATE);
}

// Tuck weights per limb group: 1 = fully tucked, 0 = enemy-motion pose.
// Body rises first, then arms open, the head lifts last.
export function unfurlWeights(age, out = {body: 1, legs: 1, arms: 1, head: 1}) {
  const {crack, unfurlEnd} = METEOR_TIMELINE, span = unfurlEnd - crack;
  const w = (a, b) => 1 - easeOutBack(clamp01((age - (crack + a * span)) / ((b - a) * span)));
  out.body = w(0, .62); out.legs = w(0, .55); out.arms = w(.25, .9); out.head = w(.5, 1);
  return out;
}

function hash01(i, salt) { let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return (h >>> 0) / 4294967296; }

export function createMeteorCreaturePresentation({THREE, assets = {}, quality = 'high'} = {}) {
  if (!THREE) throw new Error('createMeteorCreaturePresentation requires {THREE}');
  const records = new Map(); // entry -> record
  const shared = {ready: false, hot: new Map(), mature: new Map(), owned: [], sourceOf: new WeakMap()};
  let golemAsset = assets.golem || null, meteorAsset = assets.meteor || null, disposed = false;
  const shardCount = quality === 'low' ? 4 : SHARDS;

  // Scratch (never allocated per frame).
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _rq = new THREE.Quaternion();
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _ws = new THREE.Vector3();
  const aR = new THREE.Vector3(), aU = new THREE.Vector3(0, 1, 0), aF = new THREE.Vector3();
  const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  const weights = {body: 1, legs: 1, arms: 1, head: 1};
  const _c = new THREE.Color();

  const sceneOf = a => a?.scene || a || null;

  function setAssets(next = {}) {
    if (next.golem) golemAsset = next.golem;
    if (next.meteor) meteorAsset = next.meteor;
    buildShared();
  }

  function buildShared() {
    if (shared.ready || disposed) return shared.ready;
    const meteor = sceneOf(meteorAsset); if (!meteor) return false;
    const byName = {};
    meteor.updateMatrixWorld(true);
    meteor.traverse(n => { if (n.isMesh && n.material?.name) byName[n.material.name] = n; });
    const rock = byName.GeoRock, seam = byName.GeoSeam, gem = byName.GeoStarGem;
    if (!rock || !gem) return false;
    shared.rockGeometry = rock.geometry; shared.rockMaterial = rock.material;
    shared.seamGeometry = seam?.geometry || null;
    // Seams read as a molten split line: one shared emissive clone.
    if (seam) { shared.seamMaterial = seam.material.clone(); shared.seamMaterial.name = 'MeteorCreatureSeam'; tintEmissive(shared.seamMaterial, [1, .42, .08], 2.2); shared.owned.push(shared.seamMaterial); }
    shared.gemGeometry = gem.geometry;
    shared.gemMaterial = gem.material.clone(); shared.gemMaterial.name = 'MeteorCreatureGem'; shared.owned.push(shared.gemMaterial);
    if (shared.gemMaterial.emissive) shared.gemMaterial.emissiveIntensity = Math.max(shared.gemMaterial.emissiveIntensity || 0, 1.3);
    // Geometry radii (template space) to scale shell/shards/crystals.
    rock.geometry.computeBoundingSphere?.(); gem.geometry.computeBoundingSphere?.();
    shared.rockRadius = rock.geometry.boundingSphere?.radius || 1;
    shared.rockCenter = rock.geometry.boundingSphere?.center.clone() || new THREE.Vector3();
    shared.gemRadius = gem.geometry.boundingSphere?.radius || 1;
    shared.ready = true;
    return true;
  }

  function tintEmissive(material, rgb, intensity) {
    if (!material.emissive) return;
    material.emissive.setRGB(rgb[0], rgb[1], rgb[2]); material.emissiveIntensity = intensity;
  }

  // One hot and one mature clone per authored source material, shared by all creatures.
  function materialFor(source, set) {
    const cache = set === 'hot' ? shared.hot : shared.mature;
    let m = cache.get(source); if (m) return m;
    m = source.clone(); m.name = `${source.name}:meteor-${set}`;
    if (source.name === 'Glow') {
      // Core glow takes the meteor's star-gem identity when mature, molten while hot.
      const gem = shared.gemMaterial;
      if (set === 'hot') { m.color?.setRGB(1, .55, .2); tintEmissive(m, [1, .5, .12], 2.4); }
      else { if (gem?.color && m.color) m.color.copy(gem.color); if (gem?.emissive && m.emissive) { m.emissive.copy(gem.emissive); m.emissiveIntensity = Math.max(1.6, gem.emissiveIntensity || 1); } }
    } else {
      const t = TINTS[source.name];
      if (t && m.color) { if (t.replace) m.color.setRGB(t.color[0], t.color[1], t.color[2]); else m.color.multiply(_c.setRGB(t.color[0], t.color[1], t.color[2])); }
      if (t) tintEmissive(m, set === 'hot' ? t.hot : t.warm, set === 'hot' ? 1 : .8);
    }
    cache.set(source, m); shared.owned.push(m); shared.sourceOf.set(m, source);
    return m;
  }

  function isMeteorGolem(entry) {
    return !!(entry?.enemy !== false && entry?.data?.kind === 'golem' && entry.data.meteorBorn && Number.isFinite(entry.data.unfurlTick));
  }

  function attach(entry) {
    const visual = entry.visual;
    if (!visual || visual.userData.placeholder || !buildShared()) return null;
    const rec = {visual, root: entry.root, nodes: {}, meshes: [], written: [], set: null, decor: [], leftIsArmL: true};
    for (const name of LIMBS) { const n = visual.getObjectByName(name); if (n) rec.nodes[name] = n; }
    if (!rec.nodes.Golem || !rec.nodes.BodyCore) return null;
    visual.traverse(n => { if (n.isMesh && !n.userData.meteorDecor) rec.meshes.push({mesh: n, original: Array.isArray(n.material) ? n.material.map(m => shared.sourceOf.get(m) || m) : shared.sourceOf.get(n.material) || n.material}); });
    // Record slots for undoable pose layering.
    for (const name of LIMBS) if (rec.nodes[name]) rec.written.push({node: rec.nodes[name], preQ: new THREE.Quaternion(), preP: new THREE.Vector3(), wroteQ: new THREE.Quaternion(), wroteP: new THREE.Vector3(), preS: new THREE.Vector3(), wroteS: new THREE.Vector3(), active: false});

    // Golem size in world units (prepareAsset normalises to ~2.8 m).
    visual.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(visual), rootInv = new THREE.Matrix4().copy(entry.root.matrixWorld).invert();
    const height = Math.max(.5, box.max.y - box.min.y);
    entry.root.getWorldScale(_ws); const rs = _ws.y || 1;
    rec.height = height / rs;

    // Shell: meteor rock + seam, sealed around the tucked body.
    const shellRadius = rec.height * .45;
    const shell = new THREE.Group(); shell.name = 'MeteorCreatureShell';
    const k = shellRadius / shared.rockRadius;
    const rockMesh = new THREE.Mesh(shared.rockGeometry, shared.rockMaterial);
    rockMesh.position.copy(shared.rockCenter).multiplyScalar(-1); shell.add(rockMesh);
    if (shared.seamGeometry) { const seamMesh = new THREE.Mesh(shared.seamGeometry, shared.seamMaterial); seamMesh.position.copy(rockMesh.position); shell.add(seamMesh); }
    shell.scale.setScalar(k); shell.position.set(0, shellRadius * .78, 0);
    rec.shell = shell; rec.shellRadius = shellRadius; rec.shellScale = k;

    // Shards: crust plates cut from the same rock, launched on crack.
    const shards = new THREE.InstancedMesh(shared.rockGeometry, shared.rockMaterial, shardCount);
    shards.name = 'MeteorCreatureShards'; shards.frustumCulled = false; shards.count = shardCount;
    rec.shards = shards;
    rec.shardSpec = [];
    for (let i = 0; i < shardCount; i++) {
      const yaw = (i / shardCount) * Math.PI * 2 + hash01(i, 1) * .7, up = .25 + hash01(i, 2) * .55;
      rec.shardSpec.push({yaw, up, speed: rec.height * (.9 + hash01(i, 3) * .7), size: shellRadius * (.26 + hash01(i, 4) * .14) / shared.rockRadius, spin: 4 + hash01(i, 5) * 7, axis: new THREE.Vector3(hash01(i, 6) - .5, hash01(i, 7) - .5, hash01(i, 8) - .5).normalize()});
    }

    // Crystals: embedded in the BodyCore surface (chest, shoulders, back), in BodyCore-local space.
    const crystals = new THREE.InstancedMesh(shared.gemGeometry, shared.gemMaterial, CRYSTALS);
    crystals.name = 'MeteorCreatureCrystals'; crystals.matrixAutoUpdate = false; crystals.frustumCulled = false;
    const core = rec.nodes.BodyCore, coreMesh = core.getObjectByName('BodyCoreMesh') || core;
    const coreBox = new THREE.Box3().setFromObject(coreMesh), coreInv = new THREE.Matrix4().copy(core.matrixWorld).invert();
    const c = coreBox.getCenter(new THREE.Vector3()), sz = coreBox.getSize(new THREE.Vector3());
    // Actor-space directions at attach: -Z forward, +X right (engine contract).
    entry.root.getWorldQuaternion(_rq);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(_rq), right = new THREE.Vector3(1, 0, 0).applyQuaternion(_rq);
    const sites = [[.15, .30, .50, -.4], [-.25, .18, .50, .5], [.42, .42, .05, -.9], [-.42, .40, -.05, .9], [.05, .35, -.50, .2], [-.15, .05, -.50, -.3]];
    const gemScale = rec.height * .1 / shared.gemRadius / (core.getWorldScale(_ws).y / rs || 1);
    for (let i = 0; i < CRYSTALS; i++) {
      const [x, y, z, tilt] = sites[i];
      const p = new THREE.Vector3().copy(c).addScaledVector(right, x * sz.x).addScaledVector(fwd, z * sz.z).add(_v.set(0, y * sz.y, 0));
      const out = new THREE.Vector3().addScaledVector(right, x).addScaledVector(fwd, z).add(_v.set(0, .6, 0)).normalize();
      // Sink the base: crystals are embedded, not floating.
      p.addScaledVector(out, -rec.height * .02);
      const localP = p.applyMatrix4(coreInv), worldQ = new THREE.Quaternion().setFromUnitVectors(_v.set(0, 1, 0), out).multiply(_q.setFromAxisAngle(_v2.set(0, 1, 0), tilt * 2));
      core.getWorldQuaternion(_pq); const localQ = _pq.clone().invert().multiply(worldQ);
      const s = gemScale * (.8 + hash01(i, 9) * .6);
      crystals.setMatrixAt(i, _m.compose(localP, localQ, _s.set(s * .8, s * 1.35, s * .8)));
    }
    crystals.instanceMatrix.needsUpdate = true;
    rec.crystals = crystals; rec.rootInv = rootInv; // rootInv refreshed per frame

    for (const d of [shell, rockMesh, shell.children[1], shards, crystals]) if (d) {
      d.userData.meteorDecor = true; d.userData.ignoreCombat = true; d.userData.ignoreContact = true; d.userData.contact = false;
      d.castShadow = false; d.receiveShadow = false; d.raycast = () => {};
    }
    entry.root.add(shell); entry.root.add(shards); entry.root.add(crystals);
    rec.decor.push(shell, shards, crystals);
    records.set(entry, rec);
    return rec;
  }

  function setMaterials(rec, set) {
    if (rec.set === set) return;
    for (const {mesh, original} of rec.meshes) {
      if (set === 'original') { mesh.material = original; continue; }
      mesh.material = Array.isArray(original) ? original.map(m => materialFor(m, set)) : materialFor(original, set);
    }
    // Array materials allocate once per creature per set change (twice in a lifetime); single materials allocate never.
    rec.set = set;
  }

  // Undo last frame's layer so enemy-motion's restore() sees its own committed pose.
  function beforeMotion(entry) {
    const rec = records.get(entry); if (!rec || rec.visual !== entry.visual) return;
    for (const w of rec.written) if (w.active) {
      if (w.node.quaternion.equals(w.wroteQ)) w.node.quaternion.copy(w.preQ);
      if (w.node.position.equals(w.wroteP)) w.node.position.copy(w.preP);
      if (w.node.scale.equals(w.wroteS)) w.node.scale.copy(w.preS);
      w.active = false;
    }
  }

  function rotateWorld(node, axis, angle) {
    if (!angle || !node.parent) return;
    node.parent.getWorldQuaternion(_pq);
    _q.setFromAxisAngle(axis, angle);
    _q2.copy(_pq).invert().multiply(_q).multiply(_pq);
    node.quaternion.premultiply(_q2);
  }

  function slot(rec, node) { for (const w of rec.written) if (w.node === node) return w; return null; }
  // Always capture this frame's enemy-motion output (robust if a host forgot beforeMotion).
  function begin(rec, node) { const w = slot(rec, node); if (w) { w.preQ.copy(node.quaternion); w.preP.copy(node.position); w.preS.copy(node.scale); w.active = true; } return w; }

  function applyTuck(entry, rec) {
    const N = rec.nodes, missing = entry.data.missingParts || [];
    entry.root.updateWorldMatrix(true, false); entry.root.getWorldQuaternion(_rq);
    aR.set(1, 0, 0).applyQuaternion(_rq); aF.set(0, 0, -1).applyQuaternion(_rq);
    for (const name of LIMBS) if (N[name]) begin(rec, N[name]);
    const h = rec.height, {body, legs, arms, head} = weights;
    // Whole body: sink into the crater and hunch into a ball.
    N.Golem.parent.getWorldQuaternion(_pq); N.Golem.parent.getWorldScale(_ws);
    _v.set(0, -h * .30 * body, 0).applyQuaternion(_q.copy(_pq).invert()).divide(_ws);
    N.Golem.position.add(_v);
    rotateWorld(N.Golem, aR, -.55 * body);
    // Compact the whole authored body inside the shell while sealed (scale only on the
    // authored Golem node; contact meshes follow the same visible geometry).
    N.Golem.scale.multiplyScalar(1 - .42 * clamp01(body));
    if (N.BodyCore) rotateWorld(N.BodyCore, aR, -.25 * body);
    if (N.Head && !missing.includes('head')) rotateWorld(N.Head, aR, -.7 * head);
    // Legs fold forward (rigid golem legs: no knees exist; do not invent them).
    if (N.LegL) rotateWorld(N.LegL, aR, .95 * legs);
    if (N.LegR) rotateWorld(N.LegR, aR, .95 * legs);
    // Arms hug inward/forward; side is read from world positions, not assumed.
    let inL = -1, inR = 1;
    if (N.ArmL && N.ArmR) { N.ArmL.getWorldPosition(_v); N.ArmR.getWorldPosition(_v2); const lIsLeft = _v.sub(_v2).dot(aR) < 0; inL = lIsLeft ? 1 : -1; inR = -inL; }
    // Positive roll about actor-forward swings a hanging limb toward actor-left.
    if (N.ArmL && !missing.includes('leftArm')) { rotateWorld(N.ArmL, aR, 1.15 * arms); rotateWorld(N.ArmL, aF, -.55 * inL * arms); if (N.ElbowL) rotateWorld(N.ElbowL, aR, 1.0 * arms); }
    if (N.ArmR && !missing.includes('rightArm')) { rotateWorld(N.ArmR, aR, 1.15 * arms); rotateWorld(N.ArmR, aF, -.55 * inR * arms); if (N.ElbowR) rotateWorld(N.ElbowR, aR, 1.0 * arms); }
    for (const w of rec.written) if (w.active) { w.wroteQ.copy(w.node.quaternion); w.wroteP.copy(w.node.position); w.wroteS.copy(w.node.scale); }
    rec.visual.updateMatrixWorld(true);
  }

  function updateShell(rec, age) {
    const {sealed, crack} = METEOR_TIMELINE;
    const visible = age < crack;
    rec.shell.visible = visible;
    if (!visible) return;
    // Deterministic shudder that builds to the split; slight swell as it cracks.
    const build = smooth(0, crack, age), shake = Math.sin(age * 71) * .035 * build + Math.sin(age * 43 + 1.3) * .02 * build;
    // The authored meteor's open interior face is -Z: turn it into the crater so the shell reads sealed.
    rec.shell.rotation.set(-Math.PI / 2 + shake, age * .35, -shake * .8);
    rec.shell.scale.setScalar(rec.shellScale * (1 + .06 * smooth(sealed, crack, age)));
    // Settle from the impact: sinks a little into the crater.
    rec.shell.position.y = rec.shellRadius * (.6 - .08 * smooth(0, sealed, age));
  }

  function updateShards(rec, age) {
    const {crack, shardsEnd} = METEOR_TIMELINE;
    const active = age >= crack && age < shardsEnd;
    rec.shards.visible = active;
    if (!active) return;
    const t = age - crack, g = rec.height * 3.2, fade = 1 - smooth(shardsEnd - .6, shardsEnd, age);
    for (let i = 0; i < rec.shardSpec.length; i++) {
      const s = rec.shardSpec[i];
      const horiz = Math.cos(s.up) * s.speed, vert = Math.sin(s.up) * s.speed;
      // Ballistic until it meets the ground plane, then rests (tumbling stops).
      const land = 2 * vert / g, tt = Math.min(t, land);
      const r = rec.shellRadius * .7 + horiz * tt;
      const y = Math.max(0, rec.shellRadius * .8 + vert * tt - .5 * g * tt * tt);
      _v.set(Math.sin(s.yaw) * r, y, Math.cos(s.yaw) * r);
      _q.setFromAxisAngle(s.axis, s.spin * tt);
      const sc = s.size * Math.max(.001, fade);
      rec.shards.setMatrixAt(i, _m.compose(_v, _q, _s.set(sc, sc * .45, sc)));
    }
    rec.shards.instanceMatrix.needsUpdate = true;
  }

  function updateCrystals(entry, rec) {
    const core = rec.nodes.BodyCore;
    core.updateWorldMatrix(true, false);
    rec.rootInv.copy(entry.root.matrixWorld).invert();
    rec.crystals.matrix.multiplyMatrices(rec.rootInv, core.matrixWorld);
    rec.crystals.matrixWorldNeedsUpdate = true;
    // Grow out of the crust as the creature opens.
    rec.crystals.visible = true;
  }

  function apply(entry, tick) {
    if (disposed || !isMeteorGolem(entry)) { if (records.has(entry)) remove(entry); return null; }
    let rec = records.get(entry);
    if (rec && rec.visual !== entry.visual) { remove(entry); rec = null; }
    if (!rec) rec = attach(entry);
    if (!rec) return null;
    const age = meteorAge(entry.data, tick);
    unfurlWeights(age, weights);
    if (age < METEOR_TIMELINE.unfurlEnd + .05) applyTuck(entry, rec);
    setMaterials(rec, age < MATURE_AGE ? 'hot' : 'mature');
    updateShell(rec, age); updateShards(rec, age); updateCrystals(entry, rec);
    return {age, phase: age < METEOR_TIMELINE.crack ? 'sealed' : age < METEOR_TIMELINE.unfurlEnd ? 'unfurling' : 'mature', weights};
  }

  function remove(entry) {
    const rec = records.get(entry); if (!rec) return;
    beforeMotion(entry);
    if (rec.visual === entry.visual || rec.visual.parent) setMaterials(rec, 'original');
    for (const d of rec.decor) d.removeFromParent();
    rec.shards.dispose?.(); rec.crystals.dispose?.(); // instance buffers only; shared geometry is untouched
    records.delete(entry);
  }

  function extraDrawCount(entry) {
    const rec = records.get(entry); if (!rec) return 0;
    let n = 0; if (rec.shell.visible) n += rec.shell.children.length; if (rec.shards.visible) n++; if (rec.crystals.visible) n++;
    return n;
  }

  function dispose() {
    for (const entry of [...records.keys()]) remove(entry);
    for (const m of shared.owned) m.dispose();
    shared.owned.length = 0; shared.hot.clear(); shared.mature.clear(); disposed = true;
  }

  return {setAssets, beforeMotion, apply, remove, dispose, extraDrawCount, isMeteorGolem, records, get ready() { return buildShared(); }};
}
