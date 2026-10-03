import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {SIEGEBIRD_RELOAD, siegebirdSide, siegebirdPlumage, easeInOut} from './siegebird-reload.js';

// Siegebird reload songbirds. Each reload a small bird flies in from off-frame (right, then left, alternating),
// hovers beside the rail, lays the bolt in the channel and flies off across the far side. Pure presentation:
// the shared simulation owns timing, golden rolls and damage; every peer replays the same side/plumage from
// the reload index. One bird mesh (assets/siegebird_songbird.glb, 5 draws) recoloured by an 8 x 1 palette.
//
// Coordinates: birds live under the crossbow's native-units group (X right, Y forward, Z up, metres), so the
// same flight reads correctly in first person, VR hands and on other players' heroes.

const R = SIEGEBIRD_RELOAD;
// Palette regions: back, breast, wing coverts, flight + tail, throat, beak, eye, legs (sRGB hex).
export const SIEGEBIRD_PLUMAGES = Object.freeze([
  {id: 'kingfisher', palette: ['18a3b5', 'e27a2c', '127f96', '0d5466', 'f3eadb', '262220', '0b0b0d', 'c9603a']},
  {id: 'robin', palette: ['6e5b44', 'd4552a', '5f4e3b', '3e3326', 'cf5a2e', 'd9a23a', '0b0b0d', '8a6e58']},
  {id: 'bluebird', palette: ['2e5cd8', 'c0662f', '2a52c0', '1a3a8a', 'eae6df', '2a2a2e', '0b0b0d', '3a3a40']},
  {id: 'cardinal', palette: ['c8242c', 'd0343a', 'a01d25', '6e1a1e', '1a1414', 'e58a3c', '0b0b0d', 'b0504a']},
  {id: 'chickadee', palette: ['8d939b', 'eadfc8', '6f757e', '4b5058', '161616', '2a2a2a', '0b0b0d', '5a5d63']},
  {id: 'greenfinch', palette: ['4aa84f', 'b8de62', '37883f', '1f5a2e', 'f0e27a', 'd9c49a', '0b0b0d', '9a8a78']},
]);
export const SIEGEBIRD_GOLDEN = Object.freeze({id: 'golden',
  palette: ['e8a820', 'f6c64a', 'd89418', 'b87410', 'fff0c0', 'fff2c8', '1a0e04', 'f0c050'],
  emissive: ['a86a08', 'c8901e', '985c06', '7a4804', 'f0d080', 'd0a040', '000000', 'b08020']});

// Native-space flight anchors (grip = the carried bolt's axis under the talons).
const SEAT = new THREE.Vector3(0, .745, .179);           // grip when the bolt lies in the channel (clear of the peep and the hood)
const GRIP_ON_BOLT = .21;                                 // grip distance from the Bolt node origin along the shaft (near its balance)
const APPROACH = s => new THREE.Vector3(s * .19, .77, .33);
const ENTER = s => [new THREE.Vector3(s * 2.3, .15, .95), new THREE.Vector3(s * 1.5, .95, .85), new THREE.Vector3(s * .62, 1.05, .5), APPROACH(s)];
const EXIT = s => [SEAT.clone(), SEAT.clone().add(new THREE.Vector3(-s * .22, .16, .26)), new THREE.Vector3(-s * .75, 1.25, .95), new THREE.Vector3(-s * 2.1, 2.9, 1.7)];
export const SIEGEBIRD_BIRD_SCALE = .82;               // a little bird: ~24 cm beak to tail, ~41 cm wingspan
const FORWARD = new THREE.Vector3(0, 1, 0), UP = new THREE.Vector3(0, 0, 1);

function bezier(p, u, out) {
  const a = 1 - u;
  return out.set(0, 0, 0).addScaledVector(p[0], a * a * a).addScaledVector(p[1], 3 * a * a * u).addScaledVector(p[2], 3 * a * u * u).addScaledVector(p[3], u * u * u);
}
function bezierTangent(p, u, out) {
  const a = 1 - u;
  return out.set(0, 0, 0).addScaledVector(p[0], -3 * a * a).addScaledVector(p[1], 3 * a * a - 6 * a * u).addScaledVector(p[2], 6 * a * u - 3 * u * u).addScaledVector(p[3], 3 * u * u);
}

// Bird pose for one reload at time t (seconds since that shot). Pure, so tests can sweep it.
// Returns null outside [enter, gone]. pos: grip in native space; forward: flight heading; pitch/roll radians;
// carrying: bolt still in the talons; flap: {rate Hz, amp, dihedral, hover 0..1}.
export function siegebirdBirdPose(t, side, out = {pos: new THREE.Vector3(), forward: new THREE.Vector3(), pitch: 0, roll: 0, carrying: true, phase: '', flap: {}}) {
  if (!(t >= R.enter && t <= R.gone)) return null;
  const s = side;
  if (t < R.arrive) {
    const u = (t - R.enter) / (R.arrive - R.enter), e = 1 - (1 - u) ** 2.2, p = ENTER(s);
    bezier(p, e, out.pos); bezierTangent(p, Math.min(.999, e), out.forward).normalize();
    // Brake into the hover: nose rises, the tangent turns toward the crossbow's forward axis.
    const brake = Math.max(0, (u - .7) / .3);
    out.forward.lerp(FORWARD, brake * .8).normalize();
    out.pitch = .1 + brake * .45; out.roll = s * .55 * Math.sin(Math.PI * Math.min(1, u * 1.15));
    const glide = u > .38 && u < .62 ? Math.sin(Math.PI * (u - .38) / .24) : 0;
    out.flap = {rate: 10.5, amp: .95 * (1 - .85 * glide), dihedral: .12 + .18 * glide, hover: brake};
    out.carrying = true; out.phase = 'enter';
  } else if (t < R.seat) {
    const u = (t - R.arrive) / (R.seat - R.arrive), e = easeInOut(u);
    out.pos.lerpVectors(APPROACH(s), SEAT, e); out.pos.z += .035 * Math.sin(Math.PI * e) + .004 * Math.sin(t * 60);
    out.forward.copy(FORWARD); out.pitch = .45 * (1 - e) + .05; out.roll = s * -.12 * Math.sin(Math.PI * e);
    out.flap = {rate: 15, amp: .95, dihedral: .25, hover: 1};
    out.carrying = true; out.phase = 'seat';
  } else {
    const u = (t - R.seat) / (R.gone - R.seat), e = u ** 1.25, p = EXIT(s);
    bezier(p, e, out.pos); bezierTangent(p, Math.max(.02, e), out.forward).normalize();
    const lift = Math.max(0, 1 - u * 4);
    out.forward.lerp(FORWARD, lift * .6).normalize();
    // Pitch eases up from the seated (nearly level) pose so the tail never swings down into the rail on take-off.
    const climb = easeInOut(Math.min(1, u / .14));
    out.pitch = .05 + (.2 + .3 * lift) * climb; out.roll = -s * .5 * Math.sin(Math.PI * Math.min(1, u * 1.4));
    out.flap = {rate: 11.5, amp: 1.0, dihedral: .15, hover: lift};
    out.carrying = false; out.phase = 'exit';
  }
  return out;
}

// --- shared resources ------------------------------------------------------------------------------------
function paletteTexture(hexes) {
  const data = new Uint8Array(hexes.length * 4);
  hexes.forEach((h, i) => { data.set([parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255], i * 4); });
  const texture = new THREE.DataTexture(data, hexes.length, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true;
  return texture;
}
function glowTexture(ring = false) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); if (!g) return null;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (ring) { grad.addColorStop(0, 'rgba(255,240,190,0)'); grad.addColorStop(.62, 'rgba(255,236,170,0)'); grad.addColorStop(.8, 'rgba(255,226,140,1)'); grad.addColorStop(1, 'rgba(255,210,110,0)'); }
  else { grad.addColorStop(0, 'rgba(255,248,214,1)'); grad.addColorStop(.25, 'rgba(255,214,110,.7)'); grad.addColorStop(.6, 'rgba(240,170,40,.18)'); grad.addColorStop(1, 'rgba(220,140,20,0)'); }
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Golden bolt: the same Bolt meshes in warm gold that lights itself. Session-lifetime caches shared by the
// flock (carried + seated bolt) and combat-view (flight + embedded), so they are never disposed per use.
const goldenBoltCache = new Map();
export function goldenBoltMaterial(material) {
  let m = goldenBoltCache.get(material);
  if (!m) {
    const pale = /Ivory|Cord/.test(material.name), bright = /Steel|Brass/.test(material.name);
    m = new THREE.MeshStandardMaterial({name: `${material.name}_golden`, color: pale ? 0xffe6a6 : bright ? 0xf6c552 : 0xe9a93a, metalness: pale ? .35 : .9, roughness: pale ? .32 : .22,
      emissive: pale ? 0xffd27a : 0xd08a1c, emissiveIntensity: pale ? 1.6 : 1.1});
    goldenBoltCache.set(material, m);
  }
  return m;
}
const goldenBolt = goldenBoltMaterial;
let glow = null, ring = null; // lazily, browser only
const fxTextures = () => { if (glow === null) { glow = glowTexture(false) || false; ring = glowTexture(true) || false; } return glow ? {glow, ring} : null; };
const glowSprite = (size, opacity = 1, color = 0xffcf6a) => {
  const fx = fxTextures(); if (!fx) return null;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({map: fx.glow, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
  s.scale.setScalar(size); s.userData.ignoreContact = true; s.userData.siegebirdGlow = true; return s;
};
// Dress a prepared bolt projectile (asset-pose prepareProjectile) as golden: gold materials + a travelling glow.
// The sprite material is per projectile (opacity animates); dispose it with disposeGoldenProjectile.
export function dressGoldenProjectile(visual) {
  if (!visual || visual.userData.siegebirdGolden) return visual;
  visual.userData.siegebirdGolden = true;
  visual.traverse(n => { if (n.isMesh) n.material = Array.isArray(n.material) ? n.material.map(goldenBolt) : goldenBolt(n.material); });
  const halo = glowSprite(.42, .9); if (halo) { halo.position.set(0, -.18, 0); visual.add(halo); visual.userData.siegebirdHalo = halo; }
  return visual;
}
export function disposeGoldenProjectile(visual) { visual?.userData.siegebirdHalo?.material.dispose(); }

export function createSiegebirdFlock({birdTemplate, crossbowTemplate, maxDistance = 26} = {}) {
  // Natural plumage with a soft blue resonance shimmer along the flight feathers and the eye (one shared mask).
  const shimmerMask = paletteTexture(['000000', '000000', '0e1c2c', '3a78c0', '000000', '000000', '7cc4ff', '000000']);
  const plumageMaterials = SIEGEBIRD_PLUMAGES.map(p => new THREE.MeshStandardMaterial({name: `SB_Plumage_${p.id}`, map: paletteTexture(p.palette),
    emissiveMap: shimmerMask, emissive: 0x7fbfff, emissiveIntensity: .18, roughness: .62, metalness: 0}));
  const goldenMaterial = new THREE.MeshStandardMaterial({name: 'SB_Plumage_golden', map: paletteTexture(SIEGEBIRD_GOLDEN.palette), emissiveMap: paletteTexture(SIEGEBIRD_GOLDEN.emissive), emissive: 0xffffff, emissiveIntensity: 1.25, roughness: .28, metalness: .6});
  const boltSource = crossbowTemplate?.scene.getObjectByName('Bolt') || null;
  const stats = {rigs: 0, birds: 0, visibleBirds: 0};
  const tmp = {pose: {pos: new THREE.Vector3(), forward: new THREE.Vector3(), pitch: 0, roll: 0, carrying: true, phase: '', flap: {}},
    m: new THREE.Matrix4(), right: new THREE.Vector3(), up: new THREE.Vector3(), back: new THREE.Vector3(), q: new THREE.Quaternion(), qr: new THREE.Quaternion(),
    world: new THREE.Vector3(), axis: new THREE.Vector3()};

  function makeBird(rig) {
    const root = clone(birdTemplate.scene); root.name = 'SiegebirdSongbird'; root.scale.setScalar(SIEGEBIRD_BIRD_SCALE);
    root.traverse(n => { if (n.isMesh) { n.castShadow = false; n.receiveShadow = false; n.userData.ignoreContact = true; } });
    const bird = {root, wings: ['SongbirdWingL', 'SongbirdWingR', 'SongbirdWingL_Tip', 'SongbirdWingR_Tip'].map(n => root.getObjectByName(n)), plumage: -1, carry: null, halo: null};
    // Carried bolt: the crossbow's own Bolt meshes, re-expressed so the shaft runs along the bird's forward.
    if (boltSource) {
      const basis = new THREE.Group(); basis.name = 'SiegebirdCarriedBolt';
      basis.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)));
      const shaft = clone(boltSource); shaft.name = 'SiegebirdCarriedBoltShaft'; shaft.position.set(0, -GRIP_ON_BOLT, 0); shaft.quaternion.identity();
      // The pivot keeps the bolt full size under the scaled bird and level while the bird pitches.
      const pivot = new THREE.Group(); pivot.name = 'SiegebirdCarryPivot'; pivot.scale.setScalar(1 / SIEGEBIRD_BIRD_SCALE);
      basis.add(shaft); pivot.add(basis); (root.getObjectByName('SongbirdTalons') || root).add(pivot);
      bird.carry = pivot; bird.carryMeshes = []; shaft.traverse(n => { if (n.isMesh) { n.userData.ignoreContact = true; bird.carryMeshes.push([n, n.material]); } });
    }
    bird.plumageMeshes = []; root.traverse(n => { if (n.isMesh && /^Songbird/.test(n.name)) bird.plumageMeshes.push(n); });
    root.visible = false; rig.group.add(root); stats.birds++;
    return bird;
  }
  function dress(bird, plumage, golden) {
    const key = golden ? 'golden' : plumage;
    if (bird.plumage === key) return;
    bird.plumage = key;
    const material = golden ? goldenMaterial : plumageMaterials[plumage];
    for (const mesh of bird.plumageMeshes) mesh.material = material;
    for (const [mesh, base] of bird.carryMeshes || []) mesh.material = golden ? goldenBolt(base) : base;
    const fx = golden ? fxTextures() : null;
    if (fx && !bird.halo) {
      bird.halo = new THREE.Sprite(new THREE.SpriteMaterial({map: fx.glow, color: 0xffd986, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
      bird.halo.scale.setScalar(.5); bird.halo.position.set(0, .06, 0); bird.halo.userData.ignoreContact = true; bird.root.add(bird.halo);
    }
    if (bird.halo) bird.halo.visible = !!golden;
  }

  function rigFor(visual) {
    let rig = visual.userData.siegebirdFlock;
    if (rig) return rig;
    const native = visual.children.find(c => !c.name.startsWith('Siegebird')) || visual;
    const group = new THREE.Group(); group.name = 'SiegebirdFlock'; native.add(group);
    const boltNode = visual.getObjectByName('Bolt');
    const boltMeshes = []; boltNode?.traverse(n => { if (n.isMesh) boltMeshes.push([n, n.material]); });
    rig = visual.userData.siegebirdFlock = {group, native, reloads: [], birds: [], boltNode, boltMeshes, boltRest: boltNode?.position.clone(), loadedGolden: false, sparks: null, boltGlow: null, burst: null, lastT: new Map()};
    stats.rigs++;
    return rig;
  }

  function goldenFx(rig) {
    const fx = fxTextures(); if (!fx || rig.sparks) return;
    // Sparkle trail (one Points draw) in native space.
    const count = 28, positions = new Float32Array(count * 3), born = new Float32Array(count).fill(-9);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({map: fx.glow, color: 0xffd36e, size: .05, sizeAttenuation: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
    points.frustumCulled = false; points.userData.ignoreContact = true; rig.group.add(points);
    rig.sparks = {points, positions, born, next: 0, emitAt: 0};
    // Seated golden bolt: three glints along the shaft plus a broad warm spill over the stock.
    const glowGroup = new THREE.Group(); glowGroup.name = 'SiegebirdGoldenBoltGlow'; glowGroup.visible = false;
    for (const [y, size, opacity] of [[.62, .16, .8], [.80, .18, .85], [.98, .14, .8], [.80, .55, .32]]) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({map: fx.glow, color: 0xffcf6a, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
      s.position.set(0, y, .19); s.scale.setScalar(size); s.userData.base = {size, opacity}; s.userData.ignoreContact = true; glowGroup.add(s);
    }
    rig.group.add(glowGroup); rig.boltGlow = glowGroup;
    const burst = new THREE.Sprite(new THREE.SpriteMaterial({map: fx.ring, color: 0xffe6a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
    burst.position.copy(SEAT).setY(.80); burst.visible = false; burst.userData.ignoreContact = true; rig.group.add(burst); rig.burst = burst;
  }

  function setLoadedBolt(rig, golden) {
    rig.loadedGolden = !!golden;
    for (const [mesh, base] of rig.boltMeshes) mesh.material = golden ? goldenBolt(base) : base;
    if (golden) goldenFx(rig);
    if (rig.boltGlow) rig.boltGlow.visible = !!golden;
  }

  function placeBird(bird, pose, t) {
    const {m, right, up, back, q, qr} = tmp;
    // Bird basis in native space: forward pitched up, rolled about forward.
    const f = tmp.axis.copy(pose.forward);
    right.crossVectors(f, UP); if (right.lengthSq() < 1e-6) right.set(1, 0, 0); right.normalize();
    f.applyAxisAngle(right, pose.pitch).normalize();
    up.crossVectors(right, f).normalize();
    back.copy(f).negate();
    m.makeBasis(right, up, back); q.setFromRotationMatrix(m);
    qr.setFromAxisAngle(f, pose.roll); bird.root.quaternion.multiplyQuaternions(qr, q);
    bird.root.position.copy(pose.pos);
    // Wings: asymmetric beat (faster downstroke), tips lag the arm, hover sweeps the stroke forward/back.
    const {rate, amp, dihedral, hover} = pose.flap, phase = (t - R.enter) * rate * Math.PI * 2;
    const beat = Math.sin(phase + .35 * Math.sin(phase)), angle = dihedral + amp * .62 * beat, tip = .55 * amp * Math.sin(phase - 1.1), sweep = hover * .45 * Math.cos(phase);
    const [wl, wr, tl, tr] = bird.wings;
    wr?.rotation.set(0, -sweep, angle); wl?.rotation.set(0, sweep, -angle);
    tr?.rotation.set(0, -sweep * .4, tip); tl?.rotation.set(0, sweep * .4, -tip);
    if (bird.carry) { bird.carry.visible = pose.carrying; bird.carry.rotation.set(-pose.pitch * .9, 0, -pose.roll * .5); }
  }

  // A reload began: n is the shared reload index (side + plumage), golden may still be unknown (null).
  function shot(visual, {n, golden = null, playerId = '', time}) {
    const rig = rigFor(visual);
    rig.reloads = rig.reloads.filter(r => time - r.start < R.gone && r.n !== n).slice(-1);
    rig.reloads.push({n, golden, playerId, start: time, side: siegebirdSide(n), plumage: siegebirdPlumage(playerId, n), seated: false, last: -1});
    if (rig.boltGlow) rig.boltGlow.visible = false;
    rig.loadedGolden = false;
  }
  // Late authority: the host's roll for reload n arrived.
  function inform(visual, {n, golden}) {
    const rig = visual.userData.siegebirdFlock; if (!rig) return;
    const r = rig.reloads.find(r => r.n === n); if (r) r.golden = !!golden;
  }

  // Advance every active reload on this crossbow. viewer (world Vector3) culls remote birds by distance.
  // Returns {cues:[{cue, n, side, plumage, golden}], bird: world position of the nearest active bird or null}.
  function update(visual, time, {viewer = null, dt = 1 / 60} = {}) {
    const rig = visual.userData.siegebirdFlock; if (!rig) return null;
    let near = true;
    if (viewer) { rig.group.getWorldPosition(tmp.world); near = tmp.world.distanceTo(viewer) < maxDistance; }
    const cues = []; let active = null;
    rig.reloads = rig.reloads.filter(r => time - r.start <= R.gone + .05);
    // A bird whose reload has expired (or a hitch skipped past its exit) never lingers in place.
    rig.birds.forEach((b, slot) => { if (b && !rig.reloads.some(r => r.n % 2 === slot)) b.root.visible = false; });
    rig.reloads.forEach((r, i) => {
      const t = time - r.start;
      // Bird slot follows reload parity so a fresh shot never steals the bird still flying off.
      const bird = rig.birds[r.n % 2] ||= makeBird(rig);
      const pose = near ? siegebirdBirdPose(t, r.side, tmp.pose) : null;
      if (!pose) { bird.root.visible = false; }
      else {
        dress(bird, r.plumage, r.golden === true);
        bird.root.visible = true; placeBird(bird, pose, t); active = bird;
        if (r.golden === true && bird.halo) bird.halo.material.opacity = .75 + .25 * Math.sin(t * 19);
      }
      if (t >= R.enter && r.last < R.enter) cues.push({cue: 'enter', n: r.n, side: r.side, plumage: r.plumage, golden: r.golden === true});
      if (t >= R.seat && !r.seated) {
        r.seated = true; cues.push({cue: 'seat', n: r.n, side: r.side, plumage: r.plumage, golden: r.golden === true});
        if (i === rig.reloads.length - 1) setLoadedBolt(rig, r.golden === true);
        if (r.golden === true && rig.burst) { rig.burst.position.copy(SEAT).setY(.80); rig.burst.visible = true; rig.burst.userData.at = time; }
      }
      // Golden trail
      if (pose && r.golden === true && rig.sparks && near) emitSpark(rig, pose.pos, time);
      r.last = t;
    });
    if (rig.burst?.userData.fresh) { rig.burst.userData.fresh = false; rig.burst.userData.at = time; }
    rig.lastTime = time;
    animateFx(rig, time, dt);
    const shimmer = .18 + .07 * Math.sin(time * 4.2); for (const m of plumageMaterials) m.emissiveIntensity = shimmer;
    // Seated bolt settle bounce is driven by the mechanism (asset-pose); hide the glow while the rail is empty.
    if (rig.boltGlow) { rig.boltGlow.visible = rig.loadedGolden && !!rig.boltNode?.visible; const k = .8 + .2 * Math.sin(time * 6.3);
      for (const s of rig.boltGlow.children) { s.material.opacity = s.userData.base.opacity * k; s.scale.setScalar(s.userData.base.size * (.92 + .08 * k)); } }
    if (active) stats.visibleBirds = Math.max(stats.visibleBirds, 1);
    return {cues, bird: active ? active.root.getWorldPosition(new THREE.Vector3()) : null};
  }

  function emitSpark(rig, at, time) {
    const s = rig.sparks; if (time < s.emitAt) return; s.emitAt = time + .018;
    const i = s.next; s.next = (s.next + 1) % s.born.length;
    s.positions.set([at.x + (Math.random() - .5) * .05, at.y + (Math.random() - .5) * .05, at.z + .03 + (Math.random() - .5) * .04], i * 3); s.born[i] = time;
  }
  function animateFx(rig, time) {
    const s = rig.sparks;
    if (s) {
      let live = 0;
      for (let i = 0; i < s.born.length; i++) { const age = time - s.born[i]; if (age < .55) { live++; s.positions[i * 3 + 2] -= .0025; } else s.positions[i * 3 + 2] = -50; }
      s.points.visible = live > 0; s.points.geometry.attributes.position.needsUpdate = live > 0;
      s.points.material.opacity = .95;
    }
    const b = rig.burst;
    if (b?.visible) { const age = time - b.userData.at; if (age > .4) b.visible = false; else { b.scale.setScalar(.12 + age * 1.6); b.material.opacity = (1 - age / .4) ** 1.5; } }
  }

  // The golden bolt just left the rail: a ring of light at the muzzle.
  function fired(visual, golden) {
    const rig = rigFor(visual); setLoadedBolt(rig, false);
    if (!golden) return; goldenFx(rig);
    if (rig.burst) { rig.burst.position.set(0, 1.06, .185); rig.burst.visible = true; rig.burst.userData.at = rig.lastTime ?? 0; rig.burst.userData.fresh = true; }
  }
  function loadedGolden(visual) { return !!visual.userData.siegebirdFlock?.loadedGolden; }
  // Equip / respawn with a bolt already on the rail (no bird).
  function rest(visual, golden = false) { const rig = rigFor(visual); rig.reloads = []; for (const b of rig.birds) b.root.visible = false; setLoadedBolt(rig, golden); }

  function dispose() {
    for (const m of plumageMaterials) { m.map.dispose(); m.dispose(); }
    shimmerMask.dispose();
    goldenMaterial.map.dispose(); goldenMaterial.emissiveMap.dispose(); goldenMaterial.dispose();
  }
  return {shot, inform, update, rest, fired, loadedGolden, dispose, stats, materials: {plumage: plumageMaterials, golden: goldenMaterial}};
}
