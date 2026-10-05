import * as THREE from 'three';
// The moment a phoenix arrow bites (Emberwing's curved shot). The host decides the burn — shared/fire.js
// fireContact sets burnUntil / lights the ground and sends one `phoenix_ignite` event — and the long burn
// after it belongs to fire-presentation.js. This module owns only the hit itself, which until now had no
// look of its own: the arrow simply stuck and a fire quietly started a moment later.
//
// Per hit, all additive and pooled (no lights, no per-hit shader, 3 draws for every ignite on screen):
//   flash     a hot white-gold bloom at the contact, gone in a quarter second
//   crown     a ring of fire opening outward across the struck surface, as if the bird landed there
//   feathers  burning feather motes thrown back out of the wound, falling and cooling to deep red
// The crown lies in the surface plane (from the contact normal) so it reads on a skull, a trunk or the ground.
export const IGNITE = Object.freeze({max: 5, flash: .22, flashSize: 1.1, crown: .42, crownRadius: .62,
  feathers: 34, featherLife: 1.2, featherSpeed: 2.8, featherSize: .19, gravity: 5.2});

function radial(size, falloff, inner = 0) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + .5) / size * 2 - 1, dy = (y + .5) / size * 2 - 1, r = Math.min(1, Math.hypot(dx, dy)), i = (y * size + x) * 4;
    // inner > 0 cuts a hole: a ring rather than a disc.
    const a = r < inner ? 0 : Math.pow(1 - r, falloff) * (inner ? Math.min(1, (r - inner) / .12) : 1);
    data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(255 * Math.max(0, a));
  }
  const texture = new THREE.DataTexture(data, size, size); texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

export function createPhoenixIgniteView({scene}) {
  const sparkMap = radial(32, 2.4), glowMap = radial(64, 2.2), ringMap = radial(64, 1.5, .62);
  const flashMaterial = new THREE.SpriteMaterial({map: glowMap, color: 0xffd089, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false});
  const crownGeometry = new THREE.PlaneGeometry(1, 1);
  const crownMaterial = new THREE.MeshBasicMaterial({map: ringMap, color: 0xff6a16, transparent: true, opacity: 0,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false});
  const featherGeometry = new THREE.BufferGeometry();
  const featherPosition = new Float32Array(IGNITE.max * IGNITE.feathers * 3);
  const featherColor = new Float32Array(IGNITE.max * IGNITE.feathers * 4);
  featherGeometry.setAttribute('position', new THREE.BufferAttribute(featherPosition, 3).setUsage(THREE.DynamicDrawUsage));
  featherGeometry.setAttribute('color', new THREE.BufferAttribute(featherColor, 4).setUsage(THREE.DynamicDrawUsage));
  const featherMaterial = new THREE.PointsMaterial({size: IGNITE.featherSize, map: sparkMap, vertexColors: true,
    transparent: true, depthWrite: false, toneMapped: false, sizeAttenuation: true});
  const feathers = new THREE.Points(featherGeometry, featherMaterial);
  feathers.name = 'phoenix-ignite-feathers'; feathers.frustumCulled = false; feathers.userData.ignoreContact = true;
  scene.add(feathers);

  const active = [], tint = new THREE.Color(), normal = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const look = new THREE.Quaternion(), forward = new THREE.Vector3(0, 0, 1);

  function burst({position, normal: hitNormal}) {
    if (!Array.isArray(position)) return null;
    if (active.length >= IGNITE.max) retire(active[0]);
    normal.fromArray(Array.isArray(hitNormal) && hitNormal.length === 3 ? hitNormal : [0, 1, 0]);
    if (normal.lengthSq() < 1e-6) normal.copy(up); else normal.normalize();
    const group = new THREE.Group(); group.name = 'phoenix-ignite'; group.userData.ignoreContact = true;
    group.position.fromArray(position);
    const flash = new THREE.Sprite(flashMaterial.clone());
    const crown = new THREE.Mesh(crownGeometry, crownMaterial.clone()); crown.renderOrder = 2;
    // The crown opens in the struck surface, lifted a hair so it never z-fights with what it burns.
    crown.quaternion.copy(look.setFromUnitVectors(forward, normal));
    crown.position.copy(normal).multiplyScalar(.04);
    group.add(flash, crown); scene.add(group);
    // Feathers come back out of the wound: along the normal, spread wide, with a little spin of their own.
    const sparks = Array.from({length: IGNITE.feathers}, (_, i) => {
      const spark = {p: new THREE.Vector3().fromArray(position), v: new THREE.Vector3(), age: 0, life: 0, seed: Math.random()};
      const angle = (i / IGNITE.feathers + Math.random() * .3) * Math.PI * 2, out = .35 + Math.random() * .9;
      const side = new THREE.Vector3().crossVectors(normal, Math.abs(normal.y) > .9 ? forward : up).normalize();
      const other = new THREE.Vector3().crossVectors(normal, side);
      spark.v.copy(normal).multiplyScalar(.5 + Math.random() * .9)
        .addScaledVector(side, Math.cos(angle) * out).addScaledVector(other, Math.sin(angle) * out)
        .multiplyScalar(IGNITE.featherSpeed * (.5 + Math.random() * .7));
      spark.life = IGNITE.featherLife * (.5 + Math.random() * .6);
      return spark;
    });
    const ignite = {group, flash, crown, sparks, age: 0, normal: normal.clone()};
    active.push(ignite); return ignite;
  }
  function retire(ignite) {
    const i = active.indexOf(ignite); if (i >= 0) active.splice(i, 1);
    ignite.group.removeFromParent(); ignite.flash.material.dispose(); ignite.crown.material.dispose();
  }
  function update(dt) {
    let n = 0;
    for (const ignite of [...active]) {
      ignite.age += dt; const a = ignite.age;
      // The flash is the strike; the crown opens behind it; the feathers outlive both.
      const f = a / IGNITE.flash;
      ignite.flash.visible = f < 1;
      if (f < 1) { ignite.flash.scale.setScalar(.25 + IGNITE.flashSize * Math.sqrt(f)); ignite.flash.material.opacity = (1 - f) * (1 - f); }
      const c = a / IGNITE.crown;
      ignite.crown.visible = c < 1;
      if (c < 1) {
        const open = 1 - (1 - c) * (1 - c) * (1 - c);
        ignite.crown.scale.setScalar(.2 + IGNITE.crownRadius * 2 * open);
        ignite.crown.material.opacity = (1 - c) * (1 - c);
      }
      let burning = false;
      for (const spark of ignite.sparks) {
        spark.age += dt; if (spark.age >= spark.life) continue;
        burning = true;
        spark.v.y -= IGNITE.gravity * dt; spark.v.multiplyScalar(Math.exp(-2.6 * dt));
        spark.p.addScaledVector(spark.v, dt);
        const k = 1 - spark.age / spark.life, o = n * 3, c = n * 4;
        featherPosition[o] = spark.p.x; featherPosition[o + 1] = spark.p.y; featherPosition[o + 2] = spark.p.z;
        // White-hot as it leaves the wound, cooling through ember orange to a dull red as it falls.
        tint.setRGB(1, .36 + .55 * k * k, .1 + .55 * k * k * k);
        featherColor[c] = tint.r; featherColor[c + 1] = tint.g; featherColor[c + 2] = tint.b; featherColor[c + 3] = Math.min(1, k * 1.6); n++;
      }
      if (!burning && f >= 1 && c >= 1) retire(ignite);
    }
    featherGeometry.setDrawRange(0, n);
    featherGeometry.attributes.position.clearUpdateRanges(); featherGeometry.attributes.position.addUpdateRange(0, n * 3);
    featherGeometry.attributes.color.clearUpdateRanges(); featherGeometry.attributes.color.addUpdateRange(0, n * 4);
    featherGeometry.attributes.position.needsUpdate = featherGeometry.attributes.color.needsUpdate = true;
    feathers.visible = n > 0;
    return active.length;
  }
  function dispose() {
    for (const ignite of [...active]) retire(ignite);
    feathers.removeFromParent(); featherGeometry.dispose(); featherMaterial.dispose();
    crownGeometry.dispose(); crownMaterial.dispose(); flashMaterial.dispose();
    sparkMap.dispose(); glowMap.dispose(); ringMap.dispose();
  }
  return {burst, update, dispose, stats: () => ({ignites: active.length})};
}
