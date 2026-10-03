// Timberline contact effects, kept separate from the machine and bolt meshes.
// One InstancedMesh of small wood chips (2 draw calls max with dust), pooled.
//
//   const fx = createTimberlineFx({maxChips: 160});
//   scene.add(fx.object);
//   fx.chips(point, normal, {count: 40, speed: 5});  // wood shear / tree cut
//   fx.dust(point, {count: 6});                        // feet / muzzle puff
//   fx.update(dt);
import * as THREE from 'three';

export function createTimberlineFx({maxChips = 160, maxDust = 24, chipColor = 0xc58a52, dustColor = 0xb8a68a} = {}) {
  const object = new THREE.Group();
  object.name = 'TimberlineFx';
  // A chip: thin bent wedge (6 triangles), reads as a splinter at any angle.
  const g = new THREE.BufferGeometry();
  const p = [
    -0.02, 0, -0.006, 0.02, 0, -0.006, 0.0, 0.004, 0.012,
    -0.02, 0, -0.006, 0.0, 0.004, 0.012, -0.012, 0.0, 0.03,
    0.02, 0, -0.006, 0.012, 0.0, 0.03, 0.0, 0.004, 0.012,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({name: 'TL_FxChip', color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide});
  const chips = new THREE.InstancedMesh(g, mat, maxChips);
  chips.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  chips.frustumCulled = false;
  const col = new THREE.Color();
  for (let i = 0; i < maxChips; i++) {
    col.set(chipColor).offsetHSL((Math.sin(i * 12.9898) * 0.5) * 0.04, 0, (Math.sin(i * 78.233) * 0.5) * 0.18);
    chips.setColorAt(i, col);
  }
  object.add(chips);

  const dustGeo = new THREE.IcosahedronGeometry(0.12, 0);
  const dustMat = new THREE.MeshStandardMaterial({name: 'TL_FxDust', color: dustColor, roughness: 1, transparent: true, opacity: 0.35, depthWrite: false});
  const dust = new THREE.InstancedMesh(dustGeo, dustMat, maxDust);
  dust.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dust.frustumCulled = false;
  object.add(dust);

  const pool = Array.from({length: maxChips}, () => ({life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), s: 1}));
  const dpool = Array.from({length: maxDust}, () => ({life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), s: 1}));
  let next = 0, dnext = 0, seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _dq = new THREE.Quaternion(), _e = new THREE.Euler(), _t = new THREE.Vector3();
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < maxChips; i++) chips.setMatrixAt(i, hide);
  for (let i = 0; i < maxDust; i++) dust.setMatrixAt(i, hide);

  function chipsAt(point, normal, {count = 30, speed = 4.5, spread = 0.9, along = null} = {}) {
    for (let i = 0; i < count; i++) {
      const c = pool[next]; next = (next + 1) % maxChips;
      c.life = c.max = 0.7 + rnd() * 0.9;
      c.p.copy(point);
      c.v.set(rnd() - 0.5, rnd() - 0.3, rnd() - 0.5).multiplyScalar(2 * spread).add(normal).normalize().multiplyScalar(speed * (0.4 + rnd()));
      if (along) c.v.addScaledVector(along, (rnd() - 0.5) * speed * 0.8);
      c.q.setFromEuler(_e.set(rnd() * 6.3, rnd() * 6.3, rnd() * 6.3));
      c.w.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(30);
      c.s = 0.6 + rnd() * 1.1;
    }
  }

  function dustAt(point, {count = 5, speed = 0.8} = {}) {
    for (let i = 0; i < count; i++) {
      const d = dpool[dnext]; dnext = (dnext + 1) % maxDust;
      d.life = d.max = 0.6 + rnd() * 0.5;
      d.p.copy(point);
      d.v.set(rnd() - 0.5, 0.35 + rnd() * 0.4, rnd() - 0.5).multiplyScalar(speed);
      d.s = 0.5 + rnd() * 0.7;
    }
  }

  function update(dt) {
    for (let i = 0; i < maxChips; i++) {
      const c = pool[i];
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0) { chips.setMatrixAt(i, hide); continue; }
      c.v.y -= 9.8 * dt;
      c.v.multiplyScalar(Math.exp(-dt * 1.2));
      c.p.addScaledVector(c.v, dt);
      if (c.p.y < 0.01) { c.p.y = 0.01; c.v.set(0, 0, 0); c.w.multiplyScalar(0.0); }
      _dq.setFromEuler(_e.set(c.w.x * dt, c.w.y * dt, c.w.z * dt));
      c.q.multiply(_dq);
      const k = Math.min(1, c.life / 0.25) * c.s;
      _m.compose(c.p, c.q, _s.set(k, k, k));
      chips.setMatrixAt(i, _m);
    }
    for (let i = 0; i < maxDust; i++) {
      const d = dpool[i];
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { dust.setMatrixAt(i, hide); continue; }
      d.p.addScaledVector(d.v, dt);
      d.v.multiplyScalar(Math.exp(-dt * 2));
      const u = 1 - d.life / d.max;
      const k = d.s * (0.4 + 1.4 * u);
      _m.compose(d.p, _dq.identity(), _s.set(k, k * 0.7, k));
      dust.setMatrixAt(i, _m);
    }
    chips.instanceMatrix.needsUpdate = true;
    dust.instanceMatrix.needsUpdate = true;
  }

  return {
    object, chips: chipsAt, dust: dustAt, update,
    dispose() { g.dispose(); mat.dispose(); dustGeo.dispose(); dustMat.dispose(); object.removeFromParent(); },
  };
}
