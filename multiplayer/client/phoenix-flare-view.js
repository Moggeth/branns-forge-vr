import * as THREE from 'three';
import {prepareAsset} from './asset-pose.js';
// Phoenix Flare (Emberwing Q) presentation. The host bursts the flare (shared/combat.js + fire.js flareBurst) and
// sends one `phoenix_flare` event; everything here is local and additive: no lights, no shadows, no new shader
// programs per flare (Quest-safe). Per burst:
//   flash    a white-gold bloom sprite that swells and fades in a third of a second
//   phoenix  a giant glowing phoenix (the arrow's own wings, scaled up) spreads its wings and dissolves
//   star     the flare itself hangs and drifts down for a few seconds, flickering
//   embers   a rain of sparks falls from the star to the ground (that rain is what sets the ground alight)
//   pool     a warm pool of light on the ground under the star, the cheap stand-in for a real light
// The flying flare arrow wears a small hot glow (dressFlareArrow) so it reads as different from a normal shot.

export const FLARE_VIEW = Object.freeze({max: 3, hang: 5.5, sink: .45, flash: .35, phoenix: .9, phoenixSize: 10, starSize: 1.5,
  embers: 48, poolRadius: 7.5, poolLift: .12});

function radialTexture(size = 64, falloff = 2.2) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + .5) / size * 2 - 1, dy = (y + .5) / size * 2 - 1, r = Math.min(1, Math.hypot(dx, dy));
    const a = Math.pow(1 - r, falloff), i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(255 * a);
  }
  const t = new THREE.DataTexture(data, size, size); t.needsUpdate = true; t.colorSpace = THREE.SRGBColorSpace; return t;
}
let sharedGlow = null;
const glow = () => (sharedGlow ||= radialTexture(64, 2.2));
const additive = (color, opacity = 1) => new THREE.SpriteMaterial({map: glow(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false});

/** Small hot glow riding the flare arrow's head. Disposed with the arrow node by the caller's dispose path. */
export function dressFlareArrow(node) {
  if (node.userData.flareGlow) return node.userData.flareGlow;
  const sprite = new THREE.Sprite(additive(0xffc46a, .95)); sprite.scale.setScalar(.7); sprite.userData.ignoreContact = true;
  sprite.name = 'flare-arrow-glow'; node.add(sprite); node.userData.flareGlow = sprite; return sprite;
}

export function createPhoenixFlareView({scene, templates, height = () => 0}) {
  const active = [];
  const flashMat = additive(0xfff0c8), starMat = additive(0xffe2a0), haloMat = additive(0xff8a2a, .8);
  const poolMat = new THREE.MeshBasicMaterial({map: glow(), color: 0xff9a40, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4});
  const poolGeo = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
  // Ghost phoenix material template: each bounded burst owns its opacity. Normal blending so the flame-orange silhouette still reads
  // against a bright daytime sky (additive washes out to white there).
  const ghostMat = new THREE.MeshBasicMaterial({color: 0xff5f14, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false});
  const emberGeo = new THREE.BufferGeometry();
  const emberPos = new Float32Array(FLARE_VIEW.max * FLARE_VIEW.embers * 3), emberCol = new Float32Array(emberPos.length);
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3).setUsage(THREE.DynamicDrawUsage));
  emberGeo.setAttribute('color', new THREE.BufferAttribute(emberCol, 3).setUsage(THREE.DynamicDrawUsage));
  const emberMat = new THREE.PointsMaterial({size: .32, map: glow(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, sizeAttenuation: true});
  const embers = new THREE.Points(emberGeo, emberMat); embers.frustumCulled = false; embers.name = 'phoenix-flare-embers'; embers.userData.ignoreContact = true;
  scene.add(embers);
  const emberColor = new THREE.Color();

  function burst({position, ground, lit = true, radius}) {
    if (active.length >= FLARE_VIEW.max) retire(active[0]);
    const group = new THREE.Group(); group.name = 'phoenix-flare'; group.userData.ignoreContact = true;
    const flash = new THREE.Sprite(flashMat.clone()), star = new THREE.Sprite(starMat.clone()), halo = new THREE.Sprite(haloMat.clone());
    const pool = new THREE.Mesh(poolGeo, poolMat.clone()); pool.renderOrder = 1;
    group.add(flash, star, halo); scene.add(group, pool);
    let ghost = null;
    if (templates?.has?.('wings')) {
      ghost = prepareAsset(templates.get('wings'), 'wings').visual;
      ghost.userData.flareMaterial = ghostMat.clone();
      ghost.traverse(m => { if (m.isMesh) m.material = ghost.userData.flareMaterial; });
      group.add(ghost);
    }
    const seed = Math.abs(Math.sin(position[0] * 12.9898 + position[2] * 78.233)) * 43758.5453 % 1;
    const sparks = Array.from({length: FLARE_VIEW.embers}, (_, i) => ({p: new THREE.Vector3(), v: new THREE.Vector3(), age: 9, life: 1, seed: (seed + i * .618) % 1}));
    const flare = {group, flash, star, halo, pool, ghost, sparks, age: 0, origin: new THREE.Vector3().fromArray(position),
      ground: ground ? ground[1] : height(position[0], position[2]), lit,
      // Firestorm (Emberwing talent) widens the blaze: the pool and the phoenix grow with the authority's radius.
      spread: Number.isFinite(radius) ? Math.max(1, radius / 3.2) : 1};
    group.position.copy(flare.origin);
    active.push(flare); update(0); return flare;
  }
  function retire(flare) {
    const i = active.indexOf(flare); if (i >= 0) active.splice(i, 1);
    flare.group.removeFromParent(); flare.pool.removeFromParent();
    for (const s of [flare.flash, flare.star, flare.halo]) s.material.dispose();
    flare.pool.material.dispose();
    flare.ghost?.userData.flareMaterial?.dispose();
  }
  function update(dt) {
    let n = 0;
    for (const flare of [...active]) {
      flare.age += dt; const a = flare.age, F = FLARE_VIEW;
      if (a > F.hang + 1.2) { retire(flare); continue; }
      // The star sinks slowly, flickers, and gutters out over its last second.
      const sink = Math.min(a * F.sink, Math.max(0, flare.origin.y - flare.ground - 1.5));
      flare.star.position.set(0, -sink, 0); flare.halo.position.copy(flare.star.position);
      const life = a < F.hang ? 1 : Math.max(0, 1 - (a - F.hang) / 1.2);
      const flicker = .82 + .1 * Math.sin(a * 31 + flare.origin.x) + .08 * Math.sin(a * 53);
      const strength = Math.min(1, a / .08) * life * flicker;
      flare.star.scale.setScalar(F.starSize * (.75 + .25 * flicker)); flare.star.material.opacity = strength;
      flare.halo.scale.setScalar(F.starSize * 4.2); flare.halo.material.opacity = .55 * strength;
      // Flash: swells and is gone.
      const f = a / F.flash; flare.flash.visible = f < 1;
      if (f < 1) { flare.flash.scale.setScalar(2 + 14 * Math.sqrt(f)); flare.flash.material.opacity = (1 - f) * (1 - f); }
      // The phoenix spreads its wings above the burst and dissolves.
      if (flare.ghost) {
        const g = a / F.phoenix; flare.ghost.visible = g < 1;
        if (g < 1) { flare.ghost.scale.setScalar((.6 + F.phoenixSize * (1 - (1 - g) ** 3)) * flare.spread); flare.ghost.position.y = .8 * g;
          flare.ghost.userData.flareMaterial.opacity = .9 * (1 - g) ** 1.2; }
      }
      // Pool of light under the star.
      const star = flare.star.getWorldPosition(new THREE.Vector3()), drop = Math.max(.5, star.y - flare.ground);
      const r = F.poolRadius * (.6 + .4 * Math.min(1, drop / 8));
      flare.pool.position.set(star.x, flare.ground + F.poolLift, star.z); flare.pool.scale.setScalar(r * flare.spread);
      flare.pool.material.opacity = .55 * strength * Math.min(1, 9 / drop);
      // Ember rain: sparks shed from the star, fall, and fade.
      for (const s of flare.sparks) {
        if (s.age >= s.life) {
          if (a > F.hang) { s.age = 9; continue; }
          s.seed = (s.seed * 9.73 + .317) % 1; const ang = s.seed * Math.PI * 2, out = .5 + 2.2 * ((s.seed * 7.1) % 1);
          s.p.copy(star); s.v.set(Math.cos(ang) * out, .6 + 1.8 * ((s.seed * 3.3) % 1), Math.sin(ang) * out);
          s.age = 0; s.life = .9 + 1.1 * ((s.seed * 5.7) % 1);
          if (a < .1) s.v.multiplyScalar(3); // the burst throws the first sparks wide
        }
        s.age += dt; s.v.y -= 6 * dt; s.v.multiplyScalar(Math.exp(-1.4 * dt)); s.p.addScaledVector(s.v, dt);
        if (s.p.y < flare.ground + .05) { s.p.y = flare.ground + .05; s.v.set(0, 0, 0); }
        const k = s.age < s.life ? 1 - s.age / s.life : 0, o = n * 3;
        emberPos[o] = s.p.x; emberPos[o + 1] = s.p.y; emberPos[o + 2] = s.p.z;
        emberColor.setRGB(1, .38 + .4 * k, .08 * k).multiplyScalar(k * 1.6);
        emberCol[o] = emberColor.r; emberCol[o + 1] = emberColor.g; emberCol[o + 2] = emberColor.b; n++;
      }
    }
    emberGeo.setDrawRange(0, n);
    for (const name of ['position', 'color']) { const at = emberGeo.attributes[name]; at.clearUpdateRanges(); at.addUpdateRange(0, n * 3); at.needsUpdate = true; }
    embers.visible = n > 0;
    return active.length;
  }
  function dispose() {
    for (const f of [...active]) retire(f);
    embers.removeFromParent(); emberGeo.dispose(); emberMat.dispose(); poolGeo.dispose(); poolMat.dispose(); ghostMat.dispose();
    flashMat.dispose(); starMat.dispose(); haloMat.dispose();
  }
  return {burst, update, dispose, stats: () => ({flares: active.length})};
}
