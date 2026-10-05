// The streak dragon: a chubby, cheerful, faceted red dragon with a golden belly, big round eyes, cream horns and
// scalloped orange wings. Built procedurally (no download) from a handful of low-poly, flat-shaded pieces that share six
// materials, so every dragon in the sky costs the same few draw calls' worth of state changes and nothing to load.
//
// Faces +Z, origin at the centre of the body. animateDragon() drives the wing beat, neck and tail sway, jaw and the
// glow in the throat every frame from the presentation clock. Presentation only: the host never sees any of this.
import * as THREE from 'three';

export const DRAGON_SCALE = 1.35;
// Where the rider sits (on the neck, just behind the horns, ahead of the wings so the view down and to the side is clear),
// and where the fire leaves the mouth, both in the dragon's unscaled local space.
export const DRAGON_SEAT = Object.freeze([0, 2.75, 2.35]);
export const DRAGON_MOUTH = Object.freeze([0, 1.3, 4.45]);

let shared = null;
function materials() {
  if (shared) return shared;
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({color, roughness: .62, metalness: .02, flatShading: true, ...extra});
  shared = {
    hide: mat(0xe0533a, {emissive: 0x3a0c04, emissiveIntensity: .35}),
    belly: mat(0xf6c45a, {emissive: 0x3d2606, emissiveIntensity: .3}),
    wing: mat(0xff9446, {side: THREE.DoubleSide, emissive: 0x5a1c04, emissiveIntensity: .45, roughness: .8}),
    strut: mat(0xb8362a),
    horn: mat(0xfff1d0, {roughness: .45}),
    eye: new THREE.MeshStandardMaterial({color: 0xffffff, roughness: .25, emissive: 0x333333}),
    pupil: new THREE.MeshStandardMaterial({color: 0x1b1410, roughness: .2}),
    cheek: mat(0xff8f86, {emissive: 0x401010, emissiveIntensity: .4}),
    glow: new THREE.MeshBasicMaterial({color: 0xffc04a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false}),
  };
  return shared;
}
const geo = {};
function sphere(detail = 1) { return geo['s' + detail] ??= new THREE.IcosahedronGeometry(1, detail); }
function cone() { return geo.cone ??= new THREE.ConeGeometry(1, 1, 6).translate(0, .5, 0); }
function cyl() { return geo.cyl ??= new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, .5, 0); }
function membrane() {
  if (geo.membrane) return geo.membrane;
  // Wing in the XZ plane, extending to +X from the shoulder, leading edge towards +Z, with a scalloped trailing edge.
  const pts = [[0, .55], [1.3, .95], [2.6, .9], [3.9, .45], [5.2, -.25], [4.35, -1.0], [3.7, -.75], [3.1, -1.95], [2.35, -1.25], [1.6, -2.35], [.95, -1.45], [0, -1.6]];
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  return geo.membrane = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
}
function piece(parent, geometry, material, position, scale, rotation) {
  const m = new THREE.Mesh(geometry, material);
  m.position.fromArray(position); if (typeof scale === 'number') m.scale.setScalar(scale); else m.scale.fromArray(scale);
  if (rotation) m.rotation.set(...rotation);
  m.castShadow = false; m.receiveShadow = false; parent.add(m); return m;
}

const UP = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
function strut(parent, from, to, radius, material) {
  dir.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const m = piece(parent, cyl(), material, from, [radius, dir.length(), radius]);
  m.quaternion.setFromUnitVectors(UP, dir.normalize()); return m;
}

export function buildDragon() {
  const M = materials(), root = new THREE.Group(), body = new THREE.Group();
  root.name = 'streakDragon'; body.scale.setScalar(DRAGON_SCALE); root.add(body);
  // Torso and belly.
  piece(body, sphere(1), M.hide, [0, 0, 0], [1.15, 1.0, 1.95]);
  piece(body, sphere(1), M.belly, [0, -.32, .1], [.92, .72, 1.68]);
  // Back spikes down the spine.
  for (let i = 0; i < 5; i++) piece(body, cone(), M.belly, [0, .92 - i * .04, 1.1 - i * .65], [.16 - i * .015, .42 - i * .04, .16 - i * .015], [-.35, 0, 0]);
  // Neck: three beads rising to the head.
  const neck = new THREE.Group(); neck.position.set(0, .45, 1.45); body.add(neck);
  const beads = [[0, .1, .3, .66], [0, .5, .85, .56], [0, .9, 1.35, .5]].map(([x, y, z, r]) => piece(neck, sphere(1), M.hide, [x, y, z], [r, r, r * 1.1]));
  for (const [y, z] of [[.15, .45], [.55, .95]]) piece(neck, sphere(0), M.belly, [0, y - .32, z + .12], [.34, .2, .36]);
  // Head.
  const head = new THREE.Group(), horns = []; head.position.set(0, 1.12, 1.95); neck.add(head);
  piece(head, sphere(1), M.hide, [0, .1, 0], [.72, .62, .78]);
  piece(head, sphere(1), M.hide, [0, -.05, .66], [.52, .4, .62]); // snout
  for (const s of [-1, 1]) {
    piece(head, sphere(0), M.pupil, [s * .17, .12, 1.18], .06); // nostrils
    piece(head, sphere(1), M.eye, [s * .4, .3, .34], .27);
    piece(head, sphere(1), M.pupil, [s * .5, .32, .52], .13);
    piece(head, sphere(0), M.hide, [s * .37, .52, .36], [.26, .09, .2]); // brow
    piece(head, sphere(0), M.cheek, [s * .5, -.08, .42], [.14, .09, .1]);
    horns.push(piece(head, cone(), M.horn, [s * .32, .48, -.2], [.12, .78, .12], [-1.05, 0, s * -.32]));
    horns.push(piece(head, cone(), M.horn, [s * .58, .18, -.28], [.07, .38, .07], [-1.2, 0, s * -1.0])); // ear frill
  }
  const jaw = new THREE.Group(); jaw.position.set(0, -.28, .1); head.add(jaw);
  piece(jaw, sphere(1), M.belly, [0, -.08, .5], [.42, .17, .56]);
  const glow = piece(head, sphere(1), M.glow.clone(), [0, -.2, .82], [.32, .2, .3]);
  // Wings.
  const wings = [-1, 1].map(s => {
    const shoulder = new THREE.Group(); shoulder.position.set(s * .85, .62, .55); shoulder.scale.x = s; body.add(shoulder);
    piece(shoulder, membrane(), M.wing, [0, 0, 0], 1);
    // Arm, forearm and three fingers fanning back to the scallops of the trailing edge.
    for (const [from, to, r] of [[[0, 0, .4], [2.55, 0, .85], .1], [[2.55, 0, .85], [5.2, 0, -.25], .08], [[2.55, 0, .85], [4.35, 0, -1.0], .055], [[2.55, 0, .85], [3.1, 0, -1.95], .05], [[2.55, 0, .85], [1.6, 0, -2.35], .05]]) strut(shoulder, from, to, r, M.strut);
    piece(shoulder, cone(), M.horn, [5.2, 0, -.25], [.07, .3, .07], [0, 0, -Math.PI / 2]);
    return shoulder;
  });
  // Tail: a chain of shrinking beads ending in a heart-shaped spade.
  const tail = []; let parent = body, at = [0, .1, -1.6];
  for (let i = 0; i < 6; i++) {
    const link = new THREE.Group(); link.position.fromArray(at); parent.add(link);
    const r = .62 - i * .085; piece(link, sphere(1), M.hide, [0, 0, -.35], [r, r * .9, r * 1.25]);
    tail.push(link); parent = link; at = [0, .04, -.62];
  }
  for (const side of [-1, 1]) piece(parent, sphere(0), M.belly, [side * .22, .05, -.8], [.36, .07, .42], [0, side * .55, 0]);
  piece(parent, cone(), M.belly, [0, .05, -.95], [.18, .55, .05], [-Math.PI / 2, 0, 0]);
  // Little tucked legs.
  for (const [x, z] of [[-.6, .9], [.6, .9], [-.65, -.85], [.65, -.85]]) piece(body, sphere(0), M.hide, [x, -.85, z], [.26, .32, .34]);
  root.userData.dragon = {body, neck, head, jaw, glow, wings, tail, beads, horns};
  return root;
}

/** The rider's own dragon: the horns right under the camera are left out so they never cover the view. */
export function setRiderView(root, riding) { for (const h of root.userData.dragon?.horns || []) h.visible = !riding; }

/** Wing beat, glide, sway and fire glow. amp < 1 glides with smaller strokes (the rider's own dragon). t in seconds; breath 0..1; dive 0..1 (folds the wings back). */
export function animateDragon(root, t, {breath = 0, dive = 0, beat = 1, amp = 1} = {}) {
  const d = root.userData.dragon; if (!d) return;
  // A slow, lazy flap with a short glide: the down-stroke is quicker than the up-stroke.
  const phase = t * 2.4 * beat, flap = amp * (Math.sin(phase) + .25 * Math.sin(phase * 2 - .6));
  const fold = Math.min(1, dive * 1.3);
  for (const w of d.wings) {
    const side = w.scale.x; // the left wing is mirrored, so its angles mirror too
    w.rotation.z = side * ((.18 + .55 * flap) * (1 - fold) - .25 * fold);
    w.rotation.y = side * .5 * fold; w.scale.z = 1 - .35 * fold;
  }
  d.body.position.y = -.12 * flap;
  d.neck.rotation.x = -.08 * Math.sin(phase - .8) + .25 * breath + .45 * dive;
  d.head.rotation.x = .12 * breath + .1 * Math.sin(t * 1.3);
  d.head.rotation.y = .1 * Math.sin(t * .7);
  d.jaw.rotation.x = .55 * breath + .06 * Math.max(0, Math.sin(t * 3));
  d.glow.material.opacity = Math.max(d.glow.material.opacity * .9, .9 * breath);
  d.tail.forEach((link, i) => { link.rotation.y = .16 * Math.sin(t * 1.7 - i * .6); link.rotation.x = .06 * Math.sin(t * 2.4 - i * .5) - .03 * i * dive; });
}
