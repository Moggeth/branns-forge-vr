// Siegebird "Moon-and-Hawk" sight: brass ghost-ring peep + ivory moon hood.
// All geometry is authored in weaponAnchor canonical coords (metres, +Y up,
// -Z forward, origin = GripAnchor). Native crossbow facts (asset-pose.js:9,
// crossbow.glb): BoltSeat native (0,.78,.179) -> canonical (0,.334,-.48);
// GripAnchor native (0,.3,-.155). canonical = (nx, nz+.155, .3-ny).
// The sight never moves the bolt, BoltSeat or bore; root owns physics/input.

export const SIEGEBIRD_SIGHT_GEOMETRY = Object.freeze({
  boreFallback: [0, .334, -.48], // BoltSeat canonical, re-derived from the GLB at runtime
  sightHeight: .060,             // optical axis above bore
  eyeZ: -.085,                   // physical rear eyepoint (just behind the peep)
  rearZ: -.125,                  // ghost-ring peep, clear of sled travel (z -.179..-.512)
  frontZ: -.60,                  // moon hood, sits on the prod irons (wings y<=.287)
  reticleZ: -.596,               // ivory vane plane inside the hood
  rearInner: .0165, rearOuter: .0205,
  hoodRadius: .038,
  zeroTravel: .022,              // elevation slide travel of the reticle carrier
  bodyTop: .300,
  nominalZero: .0282,            // rad; 30 m zero from 42 m/s, g 3, drag .045 (root solver stays authoritative)
});

// Hip lowered from the old [.24,-.3,-.48] (bore was 3.4 cm ABOVE screen centre).
// eyeZ: eyepoint lands 20 cm in front of the camera. zoomFov from source 70.
export const SIEGEBIRD_PRESENTATION = Object.freeze({
  hip: [.21, -.415, -.42], eyeZ: -.20, sourceFov: 70, zoomFov: 58, transition: 18,
});

// Reviewed removals: OpticRear is the oversized decorative optic (native z .315,
// 13.6 cm above the bore; towered over the hip crosshair). Hidden, never deleted.
export const SIEGEBIRD_REPLACED_NODES = Object.freeze(['OpticRear']);

// ADS anchor position for a given anchor quaternion: eye -> (0,0,eyeZ) in camera space.
export function siegebirdAdsPosition(THREE, eye, anchorQuaternion, out = new THREE.Vector3(), eyeZ = SIEGEBIRD_PRESENTATION.eyeZ) {
  return out.copy(eye).applyQuaternion(anchorQuaternion).negate().add(new THREE.Vector3(0, 0, eyeZ));
}

const RANGE_MARKS = Object.freeze([
  {range: 50, width: .0105, rune: 0},
  {range: 70, width: .0072, rune: 1},
]);

// One shared, lazily built engraving atlas (two runes: V, VII). Never rebuilt per frame.
let engraving = null;
function acquireEngraving(THREE) {
  if (engraving) { engraving.users++; return engraving.texture; }
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas')
    : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(128, 64) : null;
  if (!canvas) return null;
  canvas.width = 128; canvas.height = 64;
  const g = canvas.getContext('2d'); if (!g) return null;
  g.clearRect(0, 0, 128, 64);
  g.fillStyle = '#efe2c2'; g.font = '600 40px Georgia, "Times New Roman", serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('V', 32, 34); g.fillText('VII', 96, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = true;
  engraving = {texture, users: 1};
  return texture;
}
function releaseEngraving() {
  if (!engraving || --engraving.users > 0) return;
  engraving.texture.dispose(); engraving = null;
}

export function createSiegebirdSight(THREE, canonicalWeaponVisual) {
  const G = SIEGEBIRD_SIGHT_GEOMETRY;
  const disposables = [];
  const keep = x => (disposables.push(x), x);

  // Measure the actual muzzle socket in canonical coords (visual local -> parent).
  const bore = new THREE.Vector3().fromArray(G.boreFallback);
  const seat = canonicalWeaponVisual.getObjectByName('BoltSeat');
  if (seat) {
    canonicalWeaponVisual.updateWorldMatrix(true, true);
    const local = new THREE.Matrix4().copy(canonicalWeaponVisual.matrixWorld).invert().multiply(seat.matrixWorld);
    bore.setFromMatrixPosition(local).applyMatrix4(canonicalWeaponVisual.matrix);
  }
  const axisY = bore.y + G.sightHeight;
  // Rear sight is raised so the peep->hood line already converges on the nominal 30 m zero.
  const zeroRise = z => Math.tan(G.nominalZero) * (z - G.frontZ);
  const eye = new THREE.Vector3(bore.x, axisY + zeroRise(G.eyeZ), G.eyeZ);

  // Root group expressed in canonical (anchor) coords even though it is parented
  // under the visual, so it follows the weapon and is removed with it.
  const root = new THREE.Group(); root.name = 'SiegebirdSight';
  const syncRoot = () => {
    root.quaternion.copy(canonicalWeaponVisual.quaternion).invert();
    root.position.copy(canonicalWeaponVisual.position).applyQuaternion(root.quaternion).negate();
    const s = canonicalWeaponVisual.scale; root.scale.set(1 / s.x, 1 / s.y, 1 / s.z);
  };
  syncRoot();
  canonicalWeaponVisual.add(root);

  const hidden = [];
  for (const name of SIEGEBIRD_REPLACED_NODES) {
    const node = canonicalWeaponVisual.getObjectByName(name);
    if (node) { hidden.push([node, node.visible]); node.visible = false; }
  }

  // A crossbow whose peep and moon hood are modelled into Body carries a SightArt marker
  // (assets-source/siegebird-v4); the code then adds only the reticle carrier.
  const authored = !!canonicalWeaponVisual.getObjectByName('SightArt');

  // The original front tower is baked into Body's material primitives (builder
  // lines418-447), not a named node. Remove just its reviewed canonical region.
  // Preserve source buffers and restore them on tool change; this is a retrofit,
  // not a broad bounding-box weapon reorientation.
  const legacyGeometry=[];
  const toAnchor=new THREE.Matrix4(),centroid=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  const anchorInverse=new THREE.Matrix4().copy(canonicalWeaponVisual.parent.matrixWorld).invert();
  canonicalWeaponVisual.traverse(node=>{
    if(authored||!node.isMesh||!/^Body(?:_|$)/.test(node.name))return;
    const source=node.geometry,index=source.index,pos=source.attributes.position,kept=[];let removed=0;
    toAnchor.multiplyMatrices(anchorInverse,node.matrixWorld);
    for(let i=0;i<(index?index.count:pos.count);i+=3){
      const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k);
      centroid.copy(a.fromBufferAttribute(pos,ids[0])).add(b.fromBufferAttribute(pos,ids[1])).add(c.fromBufferAttribute(pos,ids[2])).multiplyScalar(1/3).applyMatrix4(toAnchor);
      if(Math.abs(centroid.x)<.06&&centroid.y>.310&&centroid.z<-.30&&centroid.z>-.61)removed++;
      else kept.push(...ids);
    }
    if(removed){const geometry=keep(source.clone());geometry.setIndex(kept);geometry.computeBoundingBox();geometry.computeBoundingSphere();legacyGeometry.push([node,source]);node.geometry=geometry;}
  });
  const brass = keep(new THREE.MeshStandardMaterial({name: 'SBS_Brass', color: 0xb38a45, metalness: .85, roughness: .34}));
  const darkBrass = keep(new THREE.MeshStandardMaterial({name: 'SBS_AgedBrass', color: 0x6d5129, metalness: .8, roughness: .48}));
  const ivory = keep(new THREE.MeshStandardMaterial({name: 'SBS_Ivory', color: 0xe9dcbc, metalness: 0, roughness: .55}));
  const etch = keep(new THREE.MeshBasicMaterial({name: 'SBS_Etch', color: 0xf1e3bd, transparent: true, opacity: .8, depthWrite: false, toneMapped: false}));
  const pearlMat = keep(new THREE.MeshBasicMaterial({name: 'SBS_Pearl', color: 0xfff3d2, transparent: true, opacity: .9, toneMapped: false}));
  const haloMat = keep(new THREE.MeshBasicMaterial({name: 'SBS_PearlHalo', color: 0xffd98a, transparent: true, opacity: .22, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false}));

  const mesh = (geometry, material, name) => {
    const m = new THREE.Mesh(keep(geometry), material); m.name = name;
    m.castShadow = false; m.receiveShadow = false; m.userData.ignoreContact = true; m.raycast = () => {};
    return m;
  };
  const faceZ = m => (m.rotation.x = 0, m); // rings/torus are authored in XY, facing Z

  // --- Rear: hawk ghost-ring peep on a saddle post -----------------------------
  const rear = new THREE.Group(); rear.name = 'SBS_RearPeep'; rear.position.set(bore.x, axisY + zeroRise(G.rearZ), G.rearZ); root.add(rear);
  rear.visible = !authored;
  const ringR = (G.rearInner + G.rearOuter) / 2, ringT = (G.rearOuter - G.rearInner) / 2;
  rear.add(faceZ(mesh(new THREE.TorusGeometry(ringR, ringT, 10, 48), brass, 'SBS_RearRing')));
  rear.add(mesh(new THREE.TorusGeometry(G.rearInner + .0006, .0007, 6, 48), ivory, 'SBS_RearIvoryLip'));
  const rearPostH = rear.position.y - G.rearOuter - G.bodyTop;
  const rearPost = mesh(new THREE.CylinderGeometry(.0032, .0045, rearPostH, 10), brass, 'SBS_RearPost');
  rearPost.position.y = -G.rearOuter - rearPostH / 2 + .001; rear.add(rearPost);
  const saddle = mesh(new THREE.BoxGeometry(.03, .006, .022), darkBrass, 'SBS_RearSaddle');
  saddle.position.y = G.bodyTop - rear.position.y + .003; rear.add(saddle);
  // Hawk-feather scroll ears (outboard, never inside the aperture).
  for (const side of [-1, 1]) {
    const ear = mesh(new THREE.TorusGeometry(.0085, .0016, 6, 16, Math.PI * .9), brass, 'SBS_RearEar');
    ear.position.set(side * (G.rearOuter + .006), .002, 0); ear.rotation.z = side > 0 ? -Math.PI * .45 : Math.PI * .55; rear.add(ear);
  }

  // --- Front: moon hood on the prod irons ---------------------------------------
  const front = new THREE.Group(); front.name = 'SBS_MoonHood'; front.position.set(bore.x, axisY, G.frontZ); root.add(front);
  front.visible = !authored;
  front.add(mesh(new THREE.TorusGeometry(G.hoodRadius, .0032, 10, 64), brass, 'SBS_HoodRing'));
  const hoodBand = mesh(new THREE.CylinderGeometry(G.hoodRadius + .0018, G.hoodRadius + .0018, .012, 48, 1, true), darkBrass, 'SBS_HoodBand');
  hoodBand.rotation.x = Math.PI / 2; hoodBand.position.z = .006; front.add(hoodBand);
  hoodBand.material = keep(darkBrass.clone()); hoodBand.material.side = THREE.DoubleSide; // open sleeve, seen from inside
  // Two raked legs to the prod; they meet the ring at 4 and 8 o'clock, outboard of the bolt.
  const legTop = new THREE.Vector3(), legFoot = new THREE.Vector3();
  for (const side of [-1, 1]) {
    const a = -Math.PI / 2 + side * Math.PI / 4.2;
    legTop.set(Math.cos(a) * G.hoodRadius, Math.sin(a) * G.hoodRadius, 0);
    legFoot.set(side * .058, G.bodyTop - .013 - axisY, .004);
    const len = legTop.distanceTo(legFoot);
    const leg = mesh(new THREE.CylinderGeometry(.0024, .0034, len, 8), brass, 'SBS_HoodLeg');
    leg.position.copy(legTop).add(legFoot).multiplyScalar(.5);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), legTop.clone().sub(legFoot).normalize());
    front.add(leg);
    const foot = mesh(new THREE.BoxGeometry(.016, .005, .014), darkBrass, 'SBS_HoodFoot');
    foot.position.copy(legFoot); front.add(foot);
  }
  // Crescent cap: thin ivory moon on top of the hood, outside the aperture.
  const crescent = mesh(new THREE.TorusGeometry(G.hoodRadius + .0045, .0016, 6, 32, Math.PI * .5), ivory, 'SBS_HoodCrescent');
  crescent.rotation.z = Math.PI * .25; front.add(crescent);

  // --- Muzzle collar marks the true bore at BoltSeat (does not touch the bolt) --
  const collar = mesh(new THREE.TorusGeometry(.0145, .0022, 8, 32), brass, 'SBS_BoreCollar');
  collar.position.copy(bore); collar.visible = !authored; root.add(collar);

  // --- Reticle carrier: ivory vane on an elevation slide inside the hood --------
  // Carrier origin == zero pearl. Range ticks are children, placed from angles.
  const carrier = new THREE.Group(); carrier.name = 'SBS_ReticleCarrier'; root.add(carrier);
  const pearl = mesh(new THREE.SphereGeometry(.00165, 12, 8), pearlMat, 'SBS_ZeroPearl'); carrier.add(pearl);
  const halo = mesh(new THREE.RingGeometry(.0024, .0036, 24), haloMat, 'SBS_PearlHalo'); halo.renderOrder = 2; carrier.add(halo);
  const stem = mesh(new THREE.PlaneGeometry(1, 1), etch, 'SBS_DropStem'); carrier.add(stem); // scaled per apply
  const engraveTex = acquireEngraving(THREE);
  const ticks = new Map();
  for (const mark of RANGE_MARKS) {
    const tick = mesh(new THREE.PlaneGeometry(mark.width, .00115), etch, `SBS_Tick${mark.range}`);
    tick.visible = false; carrier.add(tick);
    let rune = null;
    if (engraveTex) {
      const geo = new THREE.PlaneGeometry(.0052, .0042);
      const uv = geo.attributes.uv; // half of the atlas per rune
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * .5 + mark.rune * .5);
      const runeMat = keep(new THREE.MeshBasicMaterial({map: engraveTex, transparent: true, opacity: .7, depthWrite: false, toneMapped: false}));
      rune = mesh(geo, runeMat, `SBS_Rune${mark.range}`); rune.visible = false; carrier.add(rune);
    }
    ticks.set(mark.range, {tick, rune, mark});
  }

  // Camera-relative holdover placement on the reticle plane.
  const qInv = new THREE.Quaternion(), cam = new THREE.Vector3(), dir = new THREE.Vector3(), hit = new THREE.Vector3();
  const zeroPos = new THREE.Vector3(), tmp = new THREE.Vector3();
  const IDENTITY = new THREE.Quaternion();
  function project(vertical, horizontal, target) {
    dir.set(Math.tan(horizontal || 0), Math.tan(vertical || 0), -1).applyQuaternion(qInv);
    const s = (G.reticleZ - cam.z) / dir.z; // reticle plane is z = reticleZ in anchor space
    return target.copy(cam).addScaledVector(dir, s);
  }
  const state = {zeroOutOfTravel: false, placed: {}};

  function apply({ads = 0, holdovers = [], anchorQuaternion = IDENTITY} = {}) {
    syncRoot();
    const k = Math.min(1, Math.max(0, ads));
    qInv.copy(anchorQuaternion).invert();
    // Camera optical centre in anchor space when ADS is complete.
    cam.set(0, 0, -SIEGEBIRD_PRESENTATION.eyeZ).applyQuaternion(qInv).add(eye);
    const zero = holdovers.find(h => h.range === 30) || {verticalAngle: 0, horizontalAngle: 0, range: 30};
    project(zero.verticalAngle, zero.horizontalAngle, zeroPos);
    // Elevation/windage slide travel is physical; clamp inside the hood.
    tmp.set(zeroPos.x - bore.x, zeroPos.y - axisY, 0);
    state.zeroOutOfTravel = tmp.length() > G.zeroTravel;
    if (state.zeroOutOfTravel) tmp.setLength(G.zeroTravel);
    carrier.position.set(bore.x + tmp.x, axisY + tmp.y, G.reticleZ);
    state.placed = {30: carrier.position.toArray()};
    let lowest = 0;
    for (const {tick, rune, mark} of ticks.values()) {
      const h = holdovers.find(x => x.range === mark.range);
      tick.visible = !!h && Number.isFinite(h.verticalAngle);
      if (rune) rune.visible = tick.visible;
      if (!tick.visible) continue;
      project(h.verticalAngle, h.horizontalAngle, hit);
      // Keep the zero-to-tick offset exact even when the carrier is clamped.
      tick.position.set(hit.x - zeroPos.x, hit.y - zeroPos.y, .0002);
      if (rune) rune.position.set(tick.position.x + mark.width / 2 + .0042, tick.position.y, .0002);
      lowest = Math.min(lowest, tick.position.y);
      state.placed[mark.range] = hit.toArray();
    }
    // Stem: from just under the pearl to the lowest tick (+2 mm). Nothing above the pearl.
    const stemTop = -.0034, stemBottom = Math.min(stemTop - .002, lowest - .002);
    stem.scale.set(.0007, stemTop - stemBottom, 1); stem.position.set(0, (stemTop + stemBottom) / 2, .0001);
    // Luminance: pearl always faintly present; vane/ticks rise with ADS.
    const vane = k * k * (3 - 2 * k);
    pearlMat.opacity = .45 + .5 * vane; haloMat.opacity = .08 + .2 * vane;
    etch.opacity = .15 + .7 * vane;
    for (const {rune} of ticks.values()) if (rune) rune.material.opacity = .1 + .6 * vane;
    return state;
  }
  apply();

  function dispose() {
    root.removeFromParent();
    for (const [node,geometry] of legacyGeometry) node.geometry=geometry;
    for (const [node, visible] of hidden) node.visible = visible;
    for (const d of disposables) d.dispose?.();
    if (engraveTex) releaseEngraving();
  }
  return {eye, bore: bore.clone(), object: root, state, apply, dispose, authored};
}
