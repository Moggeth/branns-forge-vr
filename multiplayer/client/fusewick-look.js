// The Fusewick (shared/warband.js FUSEWICK): a Forgeling sapper with a powder keg strapped upright on its back,
// goggles down and a twisted fuse rising behind its head. Built from the Kegtoter's authored keg and fuse
// (client/critter-geometry.js) plus two leather straps and a brass buckle; geometry and materials are shared, so
// two sappers add a few draws and no lights. While the fuse burns the cord shortens, the spark swells and spits,
// and the keg rattles in its straps; the blast itself is the shared keg fireball (critter-view's critter_blast).
import * as THREE from 'three';
import {KEG, kegGeometry, fuseGeometry, bake, tube, M} from './critter-geometry.js';
import {FUSEWICK} from '../shared/warband.js';

const KEG_SCALE = 1.35, BACK = [0, 1.16, -.27]; // model space of the 1.81 m forgeling: it faces +Z
let parts = null;
const at = new THREE.Vector3();
function shared() {
 if (parts) return parts;
 const LEATHER = [.36, .22, .13], BRASS = [.86, .66, .32], r = KEG.radius * KEG_SCALE;
 // Pack space: keg centre at 0, the stone back at z .28, the toolbelt at y -.2 (fitted
 // to forgeling.glb in tests/fusewick-lab.html). A riveted leather pad sits between keg and back; two leather
 // bands hold the keg to the pad, and the pad's tails buckle into the forgeling's own toolbelt.
 const ring = (y, ax, z0, az, n = 20) => Array.from({length: n + 1}, (_, i) => { const a = i / n * TAU; return [Math.sin(a) * ax, y, z0 - Math.cos(a) * az]; });
 const TAU = Math.PI * 2, kegBand = y => [tube(ring(y, r + .012, .02, r + .03), .016, .016, 5, 40), M(0, 0, 0), LEATHER];
 parts = {
  keg: kegGeometry(), fuse: fuseGeometry(),
  harness: bake([
   [new THREE.BoxGeometry(.34, .42, .04), M(0, -.02, .25), LEATHER],
   ...[[-.13, .15], [.13, .15], [-.13, -.19], [.13, -.19]].map(([x, y]) => [new THREE.SphereGeometry(.014, 6, 4), M(x, y, .228), BRASS]),
   kegBand(.11), kegBand(-.13),
   ...[-1, 1].map(s => [tube([[s * .15, -.2, .25], [s * .21, -.21, .3], [s * .23, -.22, .38]], .018, .018, 5, 8), M(0, 0, 0), LEATHER]), // into the toolbelt
  ]),
  spark: bake([[new THREE.SphereGeometry(.03, 8, 6), M(0, 0, 0), [2, 1.4, .5]]]),
  halo: bake([[new THREE.SphereGeometry(.07, 10, 8), M(0, 0, 0), [1.2, .55, .18]]]),
  wood: new THREE.MeshStandardMaterial({vertexColors: true, roughness: .7, name: 'FusewickKeg'}),
  matte: new THREE.MeshStandardMaterial({vertexColors: true, roughness: .85, name: 'FusewickStrap'}),
  glow: new THREE.MeshBasicMaterial({vertexColors: true, toneMapped: false, name: 'FusewickSpark'}),
  haloMat: new THREE.MeshBasicMaterial({vertexColors: true, toneMapped: false, transparent: true, opacity: .5, depthWrite: false, blending: THREE.AdditiveBlending, name: 'FusewickHalo'}),
 };
 return parts;
}

/** Straps the keg on a dressed forgeling model (after dressForgelingModel). Returns the rig, or null. */
export function dressFusewick(visual) {
 if (!visual || visual.userData.fusewick) return visual?.userData.fusewick || null;
 const P = shared(), torso = visual.getObjectByName('Torso');
 const pack = new THREE.Group(); pack.name = 'FusewickPack';
 const keg = new THREE.Group(); keg.rotation.set(-.16, 0, Math.PI / 2); keg.scale.setScalar(KEG_SCALE); pack.add(keg); // stood on end, its top tipped back so the fuse clears the head
 const body = new THREE.Mesh(P.keg, P.wood); body.name = 'FusewickKeg'; body.castShadow = true; keg.add(body);
 const harness = new THREE.Mesh(P.harness, P.matte); harness.name = 'FusewickHarness'; pack.add(harness);
 // The fuse leaves the top stave end: in keg space that is +X (the keg's length axis now points up).
 const fuse = new THREE.Group(); fuse.position.set(KEG.length / 2 - .01, 0, 0); fuse.rotation.z = -Math.PI / 2; keg.add(fuse);
 const cord = new THREE.Mesh(P.fuse, P.matte); cord.name = 'FusewickFuse'; fuse.add(cord);
 const spark = new THREE.Mesh(P.spark, P.glow), halo = new THREE.Mesh(P.halo, P.haloMat); spark.name = 'FusewickSpark'; spark.visible = halo.visible = false; spark.add(halo); fuse.add(spark);
 for (const m of [body, harness, cord, spark, halo]) m.userData.ignoreContact = true;
 pack.position.set(...BACK); visual.add(pack);
 if (torso) { visual.updateMatrixWorld(true); torso.attach(pack); } // rides the torso through every stride and flinch
 const rig = {pack, keg, cord, spark, halo, rest: pack.position.clone(), restQ: pack.quaternion.clone(), seed: Math.random() * 100};
 visual.userData.fusewick = rig;
 return rig;
}

/**
 * Per frame. data is the interpolated enemy record; tick the render tick. emit(x,y,z,strength) throws a few sparks
 * (optional). Unlit fuses stay dark: a sapper only shows fire once it has been sent in.
 */
export function animateFusewick(visual, data, tick, dt, emit) {
 const rig = visual?.userData.fusewick; if (!rig) return;
 const lit = data?.warband?.fuse, u = lit === undefined ? -1 : Math.min(1, Math.max(0, (tick - lit) / FUSEWICK.fuseTicks));
 rig.cord.scale.y = u < 0 ? 1 : Math.max(.1, 1 - u * .9);
 rig.spark.visible = rig.halo.visible = u >= 0;
 rig.pack.position.copy(rig.rest); rig.pack.quaternion.copy(rig.restQ);
 if (u < 0) return;
 const t = performance.now() / 1000 + rig.seed, shake = .004 + .02 * u * u;
 rig.pack.position.x += Math.sin(t * 61) * shake; rig.pack.position.y += Math.abs(Math.sin(t * 47)) * shake; rig.pack.rotateZ(Math.sin(t * 53) * shake * 3);
 rig.spark.position.set(.02 * rig.cord.scale.y, .14 * rig.cord.scale.y, .015 * rig.cord.scale.y);
 const s = (.8 + .45 * Math.random()) * (1 + 1.6 * u); rig.spark.scale.setScalar(s);
 rig.halo.material.opacity = .35 + .35 * u;
 if (emit && Math.random() < dt * (18 + 40 * u)) { rig.spark.getWorldPosition(at); emit(at.x, at.y, at.z, .6 + u); }
}
