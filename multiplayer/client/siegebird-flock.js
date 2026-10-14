import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {createSiegebirdRune} from './siegebird-rune.js';
import {SIEGEBIRD_RELOAD, siegebirdSide, siegebirdPlumage, siegebirdReliefPlumage, easeInOut} from './siegebird-reload.js';

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
const NOCK = new THREE.Vector3(0, .535, .2);              // latched string at full draw (perfect-wind glint)
const GRIP_ON_BOLT = .21;                                 // grip distance from the Bolt node origin along the shaft (near its balance)
const PERCH = .006;                                       // the bird rides this far above the grip so its belly clears the rail top
const APPROACH = s => new THREE.Vector3(s * .19, .77, .33);
const ENTER = s => [new THREE.Vector3(s * 2.3, .15, .95), new THREE.Vector3(s * 1.5, .95, .85), new THREE.Vector3(s * .62, 1.05, .5), APPROACH(s)];
const EXIT = s => [SEAT.clone(), SEAT.clone().add(new THREE.Vector3(-s * .22, .16, .26)), new THREE.Vector3(-s * .75, 1.25, .95), new THREE.Vector3(-s * 2.1, 2.9, 1.7)];
export const SIEGEBIRD_BIRD_SCALE = .82;               // a little bird: ~24 cm beak to tail, ~41 cm wingspan
const FORWARD = new THREE.Vector3(0, 1, 0), UP = new THREE.Vector3(0, 0, 1);
// Lingering birds: hand-off after the shot is ready again, flight speeds (m/s), perch stay (s), live cap.
export const SIEGEBIRD_ROOST = Object.freeze({handoff: 1.1, max: 6, perchChance: 65, perchMin: 18, perchMax: 36, speed: 7, far: 85, climb: 18, cull: 75, drop: .22, boltRest: 1.4,
  foldSweep: 1.4, foldAngle: -.1, foldTipYaw: .35, foldTip: 0});
const ROOST = SIEGEBIRD_ROOST;
function hashKey(text) { let h = 0x811c9dc5; for (const c of String(text)) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function seeded(seed) { let a = seed >>> 0 || 1; return () => { a = Math.imul(a ^ (a >>> 15), 0x2c1b3c6d) >>> 0; a = (a + 0x6d2b79f5) >>> 0; return (a >>> 8) / 16777216; }; }

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
    // It hops clear of the rail first: the tail sits over the rail top and must not swing into it.
    const climb = easeInOut(Math.max(0, Math.min(1, (u - .05) / .16)));
    out.pos.z += .022 * easeInOut(Math.min(1, u / .07));
    out.pitch = .05 + (.2 + .3 * lift) * climb; out.roll = -s * .5 * Math.sin(Math.PI * Math.min(1, u * 1.4));
    out.flap = {rate: 11.5, amp: 1.0, dihedral: .15, hover: lift};
    out.carrying = false; out.phase = 'exit';
  }
  return out;
}

// --- shared resources ------------------------------------------------------------------------------------
export function paletteTexture(hexes) {
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
  const stats = {rigs: 0, birds: 0, visibleBirds: 0, worldBirds: 0, perched: 0};
  const tmp = {pose: {pos: new THREE.Vector3(), forward: new THREE.Vector3(), pitch: 0, roll: 0, carrying: true, phase: '', flap: {}},
    m: new THREE.Matrix4(), right: new THREE.Vector3(), up: new THREE.Vector3(), back: new THREE.Vector3(), q: new THREE.Quaternion(), qr: new THREE.Quaternion(),
    world: new THREE.Vector3(), axis: new THREE.Vector3()};

  function makeBird(rig, parent = rig.group) {
    const root = clone(birdTemplate.scene); root.name = 'SiegebirdSongbird'; root.scale.setScalar(SIEGEBIRD_BIRD_SCALE);
    root.traverse(n => { if (n.isMesh) { n.castShadow = false; n.receiveShadow = false; n.userData.ignoreContact = true; } });
    const bird = {root, wings: ['SongbirdWingL', 'SongbirdWingR', 'SongbirdWingL_Tip', 'SongbirdWingR_Tip'].map(n => root.getObjectByName(n)), plumage: -1, carry: null, halo: null};
    // Carried bolt: the crossbow's own Bolt meshes, re-expressed so the shaft runs along the bird's forward.
    if (boltSource) {
      const basis = new THREE.Group(); basis.name = 'SiegebirdCarriedBolt';
      basis.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)));
      const shaft = clone(boltSource); shaft.name = 'SiegebirdCarriedBoltShaft'; shaft.position.set(0, -GRIP_ON_BOLT, -PERCH); shaft.quaternion.identity();
      // The pivot keeps the bolt full size under the scaled bird and level while the bird pitches.
      const pivot = new THREE.Group(); pivot.name = 'SiegebirdCarryPivot'; pivot.scale.setScalar(1 / SIEGEBIRD_BIRD_SCALE);
      basis.add(shaft); pivot.add(basis); (root.getObjectByName('SongbirdTalons') || root).add(pivot);
      bird.carry = pivot; bird.carryMeshes = []; shaft.traverse(n => { if (n.isMesh) { n.userData.ignoreContact = true; bird.carryMeshes.push([n, n.material]); } });
    }
    bird.plumageMeshes = []; root.traverse(n => { if (n.isMesh && /^Songbird/.test(n.name)) bird.plumageMeshes.push(n); });
    root.visible = false; parent.add(root); if (rig) stats.birds++;
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
    bird.root.position.copy(pose.pos).addScaledVector(up, PERCH);
    // Wings: asymmetric beat (faster downstroke), tips lag the arm, hover sweeps the stroke forward/back.
    const {rate, amp, dihedral, hover} = pose.flap, phase = (t - R.enter) * rate * Math.PI * 2;
    const beat = Math.sin(phase + .35 * Math.sin(phase)), angle = dihedral + amp * .62 * beat, tip = .55 * amp * Math.sin(phase - 1.1), sweep = hover * .45 * Math.cos(phase);
    const [wl, wr, tl, tr] = bird.wings;
    wr?.rotation.set(0, -sweep, angle); wl?.rotation.set(0, sweep, -angle);
    tr?.rotation.set(0, -sweep * .4, tip); tl?.rotation.set(0, sweep * .4, -tip);
    if (bird.carry) { bird.carry.visible = pose.carrying; bird.carry.rotation.set(-pose.pitch * .9, 0, -pose.roll * .5); }
  }

  // A reload began: n is the shared reload index (side + plumage), golden may still be unknown (null).
  // quick: a perfect wind earned a fast reload, so the whole bird timeline plays at 1/SIEGEBIRD_RELOAD.quick.
  // relief: how many birds already gave up this reload on a weapon swap; the takeover bird wears a contrasting plumage.
  function shot(visual, {n, golden = null, playerId = '', time, quick = false, relief = 0}) {
    const rig = rigFor(visual);
    rig.reloads = rig.reloads.filter(r => r.last < R.gone && r.n !== n).slice(-1);
    rig.reloads.push({n, golden, playerId, start: time, rate: quick ? 1 / R.quick : 1, side: siegebirdSide(n), plumage: siegebirdReliefPlumage(siegebirdPlumage(playerId, n), relief), seated: false, last: -1});
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
  // reloadTime (optional): the local player's presentation clock for the newest reload (siegebird-wind.js), which
  // holds the bird beside the rail while a hand is still winding. Wings always beat on the real clock.
  function update(visual, time, {viewer = null, dt = 1 / 60, reloadTime = null} = {}) {
    const rig = visual.userData.siegebirdFlock; if (!rig) return null;
    let near = true;
    if (viewer) { rig.group.getWorldPosition(tmp.world); near = tmp.world.distanceTo(viewer) < maxDistance; }
    const cues = []; let active = null;
    rig.reloads.forEach((r, i) => { r.wing = (time - r.start) * r.rate; r.t = i === rig.reloads.length - 1 && reloadTime !== null ? reloadTime : r.wing; });
    rig.reloads = rig.reloads.filter(r => r.t <= R.gone + .05 && time - r.start < 8);
    // A bird whose reload has expired (or a hitch skipped past its exit) never lingers in place.
    rig.birds.forEach((b, slot) => { if (b && !rig.reloads.some(r => r.n % 2 === slot)) b.root.visible = false; });
    rig.reloads.forEach((r, i) => {
      const t = r.t;
      // Bird slot follows reload parity so a fresh shot never steals the bird still flying off.
      const bird = rig.birds[r.n % 2] ||= makeBird(rig);
      // Once clear of the sight picture the bird leaves the crossbow for the world: a tree perch or the mountains.
      if (!r.handed && t >= ROOST.handoff && t <= R.gone && world && near && handoff(rig, bird, r, t)) r.handed = true;
      const pose = near && !r.handed ? siegebirdBirdPose(t, r.side, tmp.pose) : null;
      if (!pose) { bird.root.visible = false; }
      else {
        dress(bird, r.plumage, r.golden === true);
        bird.root.visible = true; placeBird(bird, pose, r.wing); active = bird;
        if (r.golden === true && bird.halo) bird.halo.material.opacity = .75 + .25 * Math.sin(r.wing * 19);
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

  // ---- Lingering birds (world space) ------------------------------------------------------------------------
  // After the hand-off each songbird flies on in the world: most settle on a nearby tree for a while, preen and
  // hop, then leave for the mountains; the rest head straight for the distant peaks. Choices are seeded by the
  // player and reload so every peer sees the same bird take the same branch. At most ROOST.max birds live at once
  // (oldest perched bird leaves first); none of this touches the simulation.
  let world = null; const roost = [], pool = [], WUP = new THREE.Vector3(0, 1, 0);
  const wtmp = {a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), m: new THREE.Matrix4(), right: new THREE.Vector3(), up: new THREE.Vector3(), f: new THREE.Vector3()};
  // scene: where birds live. perch(from, heading) -> perches by preference [{id, position:[x,y,z], facing:[x,z]}] on
  // nearby standing trees (any species: only positions and heights are used).
  // standing(id) -> false once that tree is felled or gone. Call once the world exists; detach with attachWorld(null).
  function attachWorld(options) {
    if (!options) { for (const w of roost.splice(0)) release(w); world = null; return; }
    if (!world) { const group = new THREE.Group(); group.name = 'SiegebirdRoost'; options.scene.add(group); world = {group}; }
    Object.assign(world, options);
  }
  function release(w) { w.bird.root.visible = false; pool.push(w.bird); }
  function handoff(rig, bird, r, t, {carrying = false} = {}) {
    if (!bird.root.visible) return false;
    const key = `${r.playerId}:${r.n}`, h = hashKey(key);
    bird.root.updateWorldMatrix(true, false); bird.root.matrixWorld.decompose(wtmp.a, wtmp.q, wtmp.s);
    // Launch velocity from the authored exit curve, carried into world space.
    const p0 = siegebirdBirdPose(t, r.side, {pos: new THREE.Vector3(), forward: new THREE.Vector3(), flap: {}}).pos, p1 = siegebirdBirdPose(Math.min(R.gone, t + .02), r.side, {pos: new THREE.Vector3(), forward: new THREE.Vector3(), flap: {}}).pos;
    const v = rig.native.localToWorld(p1.clone()).sub(rig.native.localToWorld(p0.clone())).divideScalar(.02 / r.rate);
    if (roost.length >= ROOST.max) evict();
    if (roost.length >= ROOST.max) return false;
    const w = {bird: pool.pop() || makeBird(null, world.group), key, h, golden: r.golden === true && !carrying, plumage: r.plumage, scale: wtmp.s.x, pos: wtmp.a.clone(), vel: v, born: lastWorldTime, state: 'fly', path: null, perch: null};
    if (!w.bird.root.parent) world.group.add(w.bird.root);
    dress(w.bird, r.plumage, w.golden); w.bird.root.scale.setScalar(w.scale); if (w.bird.carry) w.bird.carry.visible = carrying;
    const heading = wtmp.b.set(v.x, 0, v.z);
    // A bird turned away mid-delivery veers off from the crossbow it was heading for, then lets the bolt fall.
    if (carrying) { rig.group.getWorldPosition(wtmp.c); heading.set(w.pos.x - wtmp.c.x, 0, w.pos.z - wtmp.c.z); w.drop = lastWorldTime + ROOST.drop; }
    if (heading.lengthSq() < 1e-6) heading.set(0, 0, -1); heading.normalize();
    const options = !carrying && (h % 100) < ROOST.perchChance ? world.perch?.(w.pos.clone(), heading.clone()) || [] : [];
    const perch = options.length ? options[(h >>> 12) % Math.min(3, options.length)] : null;
    if (perch) { w.perch = perch; flyTo(w, new THREE.Vector3(...perch.position), ROOST.speed, true); }
    else flyAway(w, heading);
    w.bird.root.visible = true; roost.push(w); stats.worldBirds = Math.max(stats.worldBirds, roost.length);
    return true;
  }
  // The crossbow is being put away (weapon swap): every bird still on it leaves for the world instead of vanishing
  // with it. A bird still carrying the bolt re-routes, drops it and flies off. Presentation only.
  function stow(visual) {
    const rig = visual?.userData.siegebirdFlock; if (!rig) return;
    for (const r of rig.reloads) {
      const bird = rig.birds[r.n % 2];
      if (world && bird?.root.visible && !r.handed && Number.isFinite(r.t)) handoff(rig, bird, r, THREE.MathUtils.clamp(r.t, R.enter, R.gone), {carrying: !r.seated});
    }
    rig.reloads = []; for (const b of rig.birds) if (b) b.root.visible = false;
  }
  // The bolt a turned-away bird lets go: tumbles to the ground, rests a moment, then shrinks away.
  const falling = [];
  function dropBolt(w) {
    const carry = w.bird.carry; if (!carry?.visible || !world) return;
    carry.updateWorldMatrix(true, true);
    const obj = carry.clone(); obj.visible = true; carry.matrixWorld.decompose(obj.position, obj.quaternion, obj.scale);
    world.group.add(obj); carry.visible = false;
    if (falling.length >= 4) world.group.remove(falling.shift().obj);
    const spin = new THREE.Vector3((w.h % 7) - 3, 1, ((w.h >>> 3) % 5) - 2).normalize();
    falling.push({obj, vel: w.vel.clone().multiplyScalar(.45), spin, rate: 5 + (w.h % 4), landed: null, scale: obj.scale.x});
  }
  function updateFalling(time, dt) {
    for (let i = falling.length - 1; i >= 0; i--) {
      const f = falling[i], o = f.obj;
      if (f.landed === null) {
        f.vel.y -= 9.8 * dt; o.position.addScaledVector(f.vel, dt); o.rotateOnWorldAxis(f.spin, f.rate * dt);
        const floor = world.ground?.(o.position.x, o.position.z) ?? -Infinity;
        if (o.position.y <= floor + .03) { o.position.y = floor + .03; f.landed = time; }
        else if (o.position.y < floor - 50) f.landed = time - 9;
      } else {
        const k = (time - f.landed - ROOST.boltRest) / .35;
        if (k >= 1) { world.group.remove(o); falling.splice(i, 1); }
        else if (k > 0) o.scale.setScalar(f.scale * (1 - k));
      }
    }
  }
  function evict() {
    const perched = roost.filter(w => w.state === 'perched').sort((a, b) => a.born - b.born)[0];
    if (perched) { flyAway(perched, wtmp.b.set(perched.pos.x, 0, perched.pos.z).normalize()); perched.leaving = true; }
    const oldest = roost.filter(w => w.state !== 'perched').sort((a, b) => a.born - b.born)[0];
    if (roost.length >= ROOST.max && oldest) { roost.splice(roost.indexOf(oldest), 1); release(oldest); }
  }
  // Cubic Hermite from the bird's position and velocity to a target, arriving slowly when landing.
  function flyTo(w, target, speed, landing) {
    const dist = w.pos.distanceTo(target), duration = THREE.MathUtils.clamp(dist / speed, 1.1, 7);
    const arrive = landing ? target.clone().sub(w.pos).setY(0).normalize().multiplyScalar(.6).setY(-.4) : target.clone().sub(w.pos).normalize().multiplyScalar(speed);
    w.path = {p0: w.pos.clone(), v0: w.vel.clone().clampLength(0, speed * 1.4), p1: target, v1: arrive, start: lastWorldTime, duration, landing};
    w.state = landing ? 'fly-perch' : 'fly-away';
  }
  function flyAway(w, heading) {
    // Out over the valley towards the far ridges, climbing, then gone.
    const side = (w.h >>> 8) % 2 ? 1 : -1, dir = heading.clone().applyAxisAngle(WUP, side * (.25 + ((w.h >>> 4) % 40) / 100));
    const target = w.pos.clone().addScaledVector(dir, ROOST.far).setY(w.pos.y + ROOST.climb + (w.h % 12));
    if (w.state === 'perched') w.vel.copy(dir).multiplyScalar(2.5).setY(2.2);
    flyTo(w, target, ROOST.speed * 1.25, false);
  }
  function hermite(path, u, pos, vel) {
    const u2 = u * u, u3 = u2 * u, D = path.duration;
    pos.copy(path.p0).multiplyScalar(2 * u3 - 3 * u2 + 1).addScaledVector(path.v0, (u3 - 2 * u2 + u) * D).addScaledVector(path.p1, -2 * u3 + 3 * u2).addScaledVector(path.v1, (u3 - u2) * D);
    vel.copy(path.p0).multiplyScalar(6 * u2 - 6 * u).addScaledVector(path.v0, (3 * u2 - 4 * u + 1) * D).addScaledVector(path.p1, -6 * u2 + 6 * u).addScaledVector(path.v1, (3 * u2 - 2 * u) * D).divideScalar(D);
  }
  function orient(w, forward, pitch, roll) {
    const {right, up, f, m, q} = wtmp;
    f.copy(forward); f.y = 0; if (f.lengthSq() < 1e-8) f.set(0, 0, -1); f.normalize();
    right.crossVectors(f, WUP).normalize(); f.applyAxisAngle(right, pitch);
    up.crossVectors(right, f).normalize(); m.makeBasis(right, up, wtmp.c.copy(f).negate()); q.setFromRotationMatrix(m);
    w.bird.root.quaternion.setFromAxisAngle(f, roll).multiply(q);
  }
  function flap(w, rate, amp, dihedral, hover, time) {
    const phase = time * rate * Math.PI * 2, beat = Math.sin(phase + .35 * Math.sin(phase)), angle = dihedral + amp * .62 * beat, tip = .55 * amp * Math.sin(phase - 1.1), sweep = hover * .45 * Math.cos(phase);
    const [wl, wr, tl, tr] = w.bird.wings;
    wr?.rotation.set(0, -sweep, angle); wl?.rotation.set(0, sweep, -angle); tr?.rotation.set(0, -sweep * .4, tip); tl?.rotation.set(0, sweep * .4, -tip);
  }
  function fold(w, flick) {
    // Wings swept back along the flanks (yaw about the shoulder; glTF -Z is forward, so the right wing sweeps by -yaw)
    // with the primaries tucked over the tail; a flick half-opens them for a beat.
    const [wl, wr, tl, tr] = w.bird.wings, k = 1 - .45 * flick, open = .35 * flick;
    wr?.rotation.set(0, -ROOST.foldSweep * k, ROOST.foldAngle * k + open); wl?.rotation.set(0, ROOST.foldSweep * k, -(ROOST.foldAngle * k + open));
    tr?.rotation.set(0, -ROOST.foldTipYaw * k, ROOST.foldTip * k); tl?.rotation.set(0, ROOST.foldTipYaw * k, -ROOST.foldTip * k);
  }
  let lastWorldTime = 0;
  // Advance the lingering birds once per frame (seconds clock shared with update). viewer: world position to cull from.
  function updateWorld(time, {viewer = null} = {}) {
    const dt = Math.min(.05, Math.max(0, time - lastWorldTime));
    lastWorldTime = time; if (!world) return;
    updateFalling(time, dt);
    let perchedCount = 0;
    for (let i = roost.length - 1; i >= 0; i--) {
      const w = roost[i], root = w.bird.root;
      if (w.state === 'fly-perch' && w.perch && world.standing && !world.standing(w.perch.id)) flyAway(w, wtmp.b.set(w.vel.x, 0, w.vel.z).normalize());
      if (w.state === 'perched') {
        perchedCount++;
        if (!w.leaving && (time - w.landed > w.stay || (world.standing && !world.standing(w.perch.id)))) { w.leaving = true; flyAway(w, wtmp.b.set(w.facing.x, 0, w.facing.z)); }
        else {
          const k = time - w.landed, hop = w.hops.find(e => k >= e.at && k < e.at + .28);
          if (hop) { const u = (k - hop.at) / .28; w.yaw = hop.from + (hop.to - hop.from) * easeInOut(u); root.position.y = w.pos.y + .045 * Math.sin(Math.PI * u); }
          else { w.yaw = w.hops.filter(e => k >= e.at + .28).at(-1)?.to ?? w.yaw0; root.position.y = w.pos.y; }
          const dir = wtmp.f.set(Math.sin(w.yaw), 0, Math.cos(w.yaw)); orient(w, dir, .22 + .05 * Math.sin(k * 1.7 + w.h), 0);
          const flick = w.flicks.find(e => k >= e && k < e + .35); fold(w, flick === undefined ? 0 : Math.sin(Math.PI * (k - flick) / .35));
          if (w.golden && w.bird.halo) w.bird.halo.material.opacity = .55 + .2 * Math.sin(k * 3.1);
          continue;
        }
      }
      if (w.drop && time >= w.drop) { w.drop = 0; dropBolt(w); }
      const path = w.path, u = Math.min(1, (time - path.start) / path.duration);
      hermite(path, u, w.pos, w.vel); root.position.copy(w.pos);
      const speed = w.vel.length(), climb = speed > 1e-3 ? Math.asin(THREE.MathUtils.clamp(w.vel.y / speed, -1, 1)) : 0;
      const landing = path.landing ? THREE.MathUtils.smoothstep(u, .72, 1) : 0, launch = THREE.MathUtils.smoothstep(time - path.start, 0, .6);
      // Bank into the turn: heading change rate from the path tangent a moment ahead.
      hermite(path, Math.min(1, u + .02), wtmp.a, wtmp.c); const turn = Math.atan2(wtmp.c.x * w.vel.z - wtmp.c.z * w.vel.x, wtmp.c.x * w.vel.x + wtmp.c.z * w.vel.z);
      orient(w, w.vel, climb * .7 + landing * .55, THREE.MathUtils.clamp(-turn * 14, -.7, .7) * (1 - landing));
      flap(w, 11 + 5 * landing, (climb > .15 || landing || launch < 1 ? 1 : .55 + .45 * Math.max(0, Math.sin(time * 1.3 + w.h))), .14 + .12 * landing, landing, time);
      if (w.golden && w.bird.halo) w.bird.halo.material.opacity = .75 + .25 * Math.sin(time * 19);
      if (u >= 1) {
        if (path.landing && w.perch) {
          w.state = 'perched'; w.landed = time; w.pos.copy(path.p1); w.vel.set(0, 0, 0);
          w.facing = new THREE.Vector3(w.perch.facing[0], 0, w.perch.facing[1]).normalize(); w.yaw0 = w.yaw = Math.atan2(w.facing.x, w.facing.z);
          const rng = seeded(w.h); w.stay = ROOST.perchMin + rng() * (ROOST.perchMax - ROOST.perchMin);
          w.hops = []; let at = 1.5 + rng() * 2; while (at < w.stay) { const last = w.hops.at(-1)?.to ?? w.yaw0; w.hops.push({at, from: last, to: w.yaw0 + (rng() - .5) * 1.6}); at += 2.5 + rng() * 4; }
          w.flicks = []; at = .8 + rng() * 3; while (at < w.stay) { w.flicks.push(at); at += 4 + rng() * 6; }
        } else { roost.splice(i, 1); release(w); continue; }
      }
      if (viewer && root.position.distanceTo(viewer) > ROOST.cull) { roost.splice(i, 1); release(w); }
    }
    stats.perched = perchedCount;
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
    for (const r of rig.resonance || []) if (r.visible) {
      if (r.userData.fresh) { r.userData.fresh = false; r.userData.at = time; }
      const age = time - r.userData.at; if (age > .45) { r.visible = false; continue; }
      r.scale.setScalar(r.userData.size * (1 + age * 7)); r.material.opacity = (1 - age / .45) ** 1.6;
    }
    rig.rune?.update(time);
    const b = rig.burst;
    if (b?.visible) { const age = time - b.userData.at; if (age > .4) b.visible = false; else { b.scale.setScalar(.12 + age * 1.6); b.material.opacity = (1 - age / .4) ** 1.5; } }
  }

  // The golden bolt just left the rail: a ring of light at the muzzle.
  function fired(visual, golden) {
    const rig = rigFor(visual); setLoadedBolt(rig, false);
    if (!golden) return; goldenFx(rig);
    // The marksman's rune snaps open at the beak and the bolt flies through it (falls back to the muzzle ring).
    const fx = fxTextures(); if (fx && rig.rune === undefined) rig.rune = createSiegebirdRune(rig.group, {glowTexture: fx.glow});
    if (rig.rune) { rig.rune.fire(); return; }
    if (rig.burst) { rig.burst.position.set(0, 1.06, .185); rig.burst.visible = true; rig.burst.userData.at = rig.lastTime ?? 0; rig.burst.userData.fresh = true; }
  }
  // Perfect wind: the latch rings with blue resonance light (ring + core) as the next reload quickens.
  function perfect(visual) {
    const rig = rigFor(visual), fx = fxTextures(); if (!fx) return;
    if (!rig.resonance) {
      const make = (map, size) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({map, color: 0x7fd8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false}));
        s.userData.ignoreContact = true; s.userData.size = size; s.visible = false; rig.group.add(s); return s; };
      rig.resonance = [make(fx.ring, .05), make(fx.glow, .07)];
    }
    // The pawl itself sits inboard under the stock, so the light rings where the player looks: the latched nock on the rail.
    for (const s of rig.resonance) { s.position.copy(NOCK); s.visible = true; s.userData.at = rig.lastTime ?? 0; s.userData.fresh = true; }
  }
  function loadedGolden(visual) { return !!visual.userData.siegebirdFlock?.loadedGolden; }
  // Equip / respawn with a bolt already on the rail (no bird).
  function rest(visual, golden = false) { const rig = rigFor(visual); rig.reloads = []; for (const b of rig.birds) b.root.visible = false; setLoadedBolt(rig, golden); }

  function dispose() {
    if (world) { world.group.removeFromParent(); roost.length = 0; world = null; }
    for (const m of plumageMaterials) { m.map.dispose(); m.dispose(); }
    shimmerMask.dispose();
    goldenMaterial.map.dispose(); goldenMaterial.emissiveMap.dispose(); goldenMaterial.dispose();
  }
  return {shot, inform, update, updateWorld, attachWorld, rest, stow, fired, perfect, loadedGolden, dispose, stats, roost, materials: {plumage: plumageMaterials, golden: goldenMaterial}};
}
