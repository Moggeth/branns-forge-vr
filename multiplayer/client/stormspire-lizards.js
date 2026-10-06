// The Stormspire's lizard crew (Mitch, 2026-10-06: "populated by lizards"). Three chunky cartoon lizards in little
// yellow hard hats look after every tower: one climbs the copper coil checking the windings, one minds the crystal
// hopper, one lounges on the hat brim. They cheer (hop) whenever the tower is charged. Presentation only; code-built
// from a handful of shared primitives so a tower adds ~20 small draws at most.
import * as THREE from 'three';

// Tower geometry in the glTF frame (assets-source/stormreel build_tower TW): shaft radius .95 -> .68 from y .85 to 5.0;
// the coil winds 9 turns from y 1.2 to 4.65, .09 proud of the stone. Hopper bowl at (0, .78..1.1, -1.62).
const TW = Object.freeze({r0: .95, r1: .68, y0: .85, y1: 5, coil0: 1.2, coil1: 4.65, turns: 9, phase: Math.PI / 2 + .25});
const shaftR = y => TW.r0 + (TW.r1 - TW.r0) * (y - TW.y0) / (TW.y1 - TW.y0);

let kit = null;
function lizardKit() {
  if (kit) return kit;
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({color, roughness: .6, metalness: 0, ...extra});
  kit = {
    skin: mat(0x6cbf4a), belly: mat(0xe8d46a), eye: mat(0xffffff, {roughness: .3}), pupil: mat(0x1a1a1a, {roughness: .3}), hat: mat(0xf2c12e, {roughness: .45}),
    body: new THREE.SphereGeometry(1, 10, 8), tail: new THREE.ConeGeometry(.055, .32, 7).rotateX(Math.PI / 2).translate(0, 0, .16),
    leg: new THREE.CylinderGeometry(.018, .022, .1, 5).translate(0, -.05, 0), eyeBall: new THREE.SphereGeometry(.034, 8, 6), dome: new THREE.SphereGeometry(.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  };
  return kit;
}
/** One lizard, about 0.5 m nose to tail. Local frame: -Z forward, +Y up, origin at the belly. */
function makeLizard() {
  const k = lizardKit(), g = new THREE.Group(), part = (geo, m, pos, scale) => { const n = new THREE.Mesh(geo, m); n.position.fromArray(pos); if (scale) n.scale.fromArray(scale); n.castShadow = true; n.raycast = () => {}; n.userData.ignoreContact = true; g.add(n); return n; };
  part(k.body, k.skin, [0, .055, 0], [.075, .055, .13]);
  part(k.body, k.belly, [0, .035, 0], [.065, .035, .11]);
  const head = new THREE.Group(); head.position.set(0, .085, -.13); g.add(head);
  const hm = new THREE.Mesh(k.body, k.skin); hm.scale.set(.068, .05, .075); hm.castShadow = true; hm.raycast = () => {}; head.add(hm);
  for (const x of [-.04, .04]) {   // big goofy eyes up top, pupils looking slightly forward
    const e = new THREE.Mesh(k.eyeBall, k.eye); e.position.set(x, .04, -.02); head.add(e);
    const p = new THREE.Mesh(k.eyeBall, k.pupil); p.scale.setScalar(.45); p.position.set(x * 1.05, .048, -.048); head.add(p);
  }
  const hat = new THREE.Mesh(k.dome, k.hat); hat.position.set(0, .06, .01); hat.scale.set(1, .8, 1.05); head.add(hat);
  const brim = new THREE.Mesh(k.body, k.hat); brim.scale.set(.085, .008, .09); brim.position.set(0, .062, -.005); head.add(brim);
  const tail = part(k.tail, k.skin, [0, .05, .11]);
  const legs = [[-.07, -.07], [.07, -.07], [-.07, .07], [.07, .07]].map(([x, z]) => { const l = part(k.leg, k.skin, [x, .06, z]); l.rotation.z = x < 0 ? .9 : -.9; return l; });
  g.userData = {head, tail, legs};
  return g;
}
function wiggle(l, t, speed, amount) {
  const {head, tail, legs} = l.userData;
  tail.rotation.y = Math.sin(t * speed * .5) * .5 * amount + Math.sin(t * 1.3) * .15;
  head.rotation.y = Math.sin(t * speed * .5 + 1) * .12 * amount;
  legs.forEach((leg, i) => { leg.rotation.x = Math.sin(t * speed + (i === 0 || i === 3 ? 0 : Math.PI)) * .7 * amount; });
}
const m4 = new THREE.Matrix4(), fwd = new THREE.Vector3(), upv = new THREE.Vector3(), side = new THREE.Vector3();
/** Point and frame on the coil at u (0 bottom .. 1 top): belly against the tower, nose along the winding. */
function onCoil(u, dir, out) {
  const y = TW.coil0 + (TW.coil1 - TW.coil0) * u, r = shaftR(y) + .09 + .04, a = TW.phase + Math.PI * 2 * TW.turns * u;
  out.position.set(Math.cos(a) * r, y, -Math.sin(a) * r);
  upv.set(Math.cos(a), 0, -Math.sin(a));                                         // outward from the axis
  const dy = (TW.coil1 - TW.coil0), da = Math.PI * 2 * TW.turns * r;
  fwd.set(-Math.sin(a) * da, dy, -Math.cos(a) * da).normalize().multiplyScalar(dir);   // along the winding
  side.crossVectors(fwd, upv).normalize(); fwd.crossVectors(upv, side).normalize();
  m4.makeBasis(side, upv, fwd.negate());   // right-handed: x = y × z with z = -forward
  out.quaternion.setFromRotationMatrix(m4);
}

export function createLizardCrew() {
  const group = new THREE.Group(); group.name = 'LizardCrew';
  const climber = makeLizard(), keeper = makeLizard(), lounger = makeLizard();
  group.add(climber, keeper, lounger);
  // The keeper perches on the hopper rim facing out; the lounger sprawls on the hat brim over the charge column.
  keeper.position.set(.3, 1.1, -1.62); keeper.rotation.y = -Math.PI / 2 - .4;
  lounger.position.set(0, 5.45, -1.08); lounger.rotation.set(0, Math.PI, 0); lounger.scale.setScalar(1.1);
  let hop = 0, seed = Math.random() * 100;
  return {
    group,
    cheer() { hop = 1; },
    update(t, dt) {
      t += seed;
      hop = Math.max(0, hop - dt * 1.6);
      const jump = hop > 0 ? Math.abs(Math.sin((1 - hop) * Math.PI * 3)) * .18 * hop : 0;
      // The climber goes up the coil and back down, pausing at the top to check the windings.
      const cycle = 34, k = (t % cycle) / cycle, up = k < .45, u = up ? k / .45 : k < .55 ? 1 : 1 - (k - .55) / .45;
      onCoil(Math.min(1, Math.max(0, u)), up || k < .55 ? 1 : -1, climber);
      climber.position.addScaledVector(upv, jump * .5);
      wiggle(climber, t, k > .45 && k < .55 ? 0 : 11, 1);
      keeper.position.y = 1.1 + jump + Math.abs(Math.sin(t * 1.7)) * .01;
      wiggle(keeper, t, 2, .3); keeper.userData.head.rotation.x = Math.sin(t * .9) * .2 - .1;
      lounger.position.y = 5.45 + jump * .6;
      wiggle(lounger, t, 1, .25); lounger.userData.tail.rotation.y += Math.sin(t * .6) * .4;
    },
  };
}
