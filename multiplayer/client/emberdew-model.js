import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
// Emberdew bottle, reforged (Opus 2026-10-05): a squat, cut-glass dwarven fire flask. Eight crisp facets, a heavy
// brass foot and cage, a stout neck with a cork, and a red rag stuffed in the neck that flops over like a jaunty cap.
// A brass medallion on the side facing the thrower carries a little grinning flame. ~0.21 m tall, origin at the grip, +Y up, -Z front.
// Named parts kept for the presentation layers: Liquid, Glass, Wick (the rag), NeckCollar, GripWrap, FootBand,
// Stopper, Muzzle (pour mouth), WickTip (where the rag burns). Plain materials, no textures, no lights.

const SIDES = 8, TURN = Math.PI / SIDES; // a flat face looks straight at the player (+Z) and straight ahead (-Z)
// Outer glass (radius, height). Broad shoulders, a waist for the hand, a short stout neck.
export const EMBERDEW_GLASS_PROFILE = Object.freeze([[0, -.092], [.03, -.092], [.04, -.086], [.0465, -.072], [.048, -.045],
  [.0475, -.012], [.043, .011], [.031, .029], [.0195, .041], [.0165, .049], [.0165, .064], [.0205, .067], [.0205, .073]].map(Object.freeze));
// Liquid container: the glass profile inset by the wall, capped under the cork (cork starts at y=.062).
export const EMBERDEW_INNER_PROFILE = Object.freeze([[0, -.0875], [.0275, -.0875], [.0365, -.082], [.0428, -.0705], [.0445, -.045],
  [.044, -.0125], [.0395, .0095], [.0278, .0265], [.0162, .0385], [.0135, .047], [.0135, .0605], [0, .0605]].map(Object.freeze));
export const EMBERDEW_SIDES = SIDES, EMBERDEW_TURN = TURN;
// The rag's burning tip (bottle-local).
export const EMBERDEW_WICK_TIP = Object.freeze([.018, .103, .003]);

const v2 = pts => pts.map(([r, y]) => new THREE.Vector2(r, y));
function faceted(profile, sides = SIDES) { const g = new THREE.LatheGeometry(v2(profile), sides); g.rotateY(TURN); return g; }

// A flat cloth strip along a curve (two layers so both sides catch light without DoubleSide z-fighting).
function ribbon(points, width, twist = 0) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), n = 14;
  const pos = [], idx = [], side = new THREE.Vector3(), t = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i <= n; i++) {
    const u = i / n, p = curve.getPoint(u); curve.getTangent(u, t);
    side.crossVectors(t, up).normalize().applyAxisAngle(t, twist * u);
    const w = width * (1 - .25 * u) * .5;
    pos.push(p.x - side.x * w, p.y - side.y * w, p.z - side.z * w, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.computeVertexNormals(); return g;
}

export function createEmberdewModel() {
  const g = new THREE.Group(); g.name = 'Emberdew';
  const geos = [], mats = [], G = x => (geos.push(x), x), M = x => (mats.push(x), x);

  // Cut glass: thin warm tint and a strong clearcoat so the facets flash; the amber inside reads first.
  const glassMat = M(new THREE.MeshPhysicalMaterial({color: 0xfff1dc, roughness: .05, metalness: 0, transparent: true, opacity: .24, clearcoat: .8, clearcoatRoughness: .05, specularIntensity: .9, envMapIntensity: .8, depthWrite: false, flatShading: true}));
  // Ember dew: deep honeyed amber (the presentation swaps in its sloshing shader; this is the plain fallback).
  const liquidMat = M(new THREE.MeshStandardMaterial({color: 0xb0480c, roughness: .18, metalness: 0, emissive: 0x7a2604, emissiveIntensity: .3, flatShading: true}));
  const brassMat = M(new THREE.MeshStandardMaterial({color: 0xc9953f, roughness: .34, metalness: .92}));
  const darkBrassMat = M(new THREE.MeshStandardMaterial({color: 0x7a5426, roughness: .45, metalness: .85}));
  const leatherMat = M(new THREE.MeshStandardMaterial({color: 0x4a2a17, roughness: .82, metalness: 0}));
  const corkMat = M(new THREE.MeshStandardMaterial({color: 0xb98a55, roughness: .95, metalness: 0}));
  const ragMat = M(new THREE.MeshStandardMaterial({color: 0xb83a24, roughness: .95, metalness: 0, side: THREE.DoubleSide, emissive: 0x2a0800, emissiveIntensity: .3}));
  const enamelMat = M(new THREE.MeshStandardMaterial({color: 0xff8a2a, roughness: .4, metalness: .1, emissive: 0xff5a10, emissiveIntensity: .45}));
  const inkMat = M(new THREE.MeshStandardMaterial({color: 0x24140a, roughness: .7, metalness: .2}));

  const liquid = new THREE.Mesh(G(faceted(EMBERDEW_INNER_PROFILE)), liquidMat); liquid.name = 'Liquid'; g.add(liquid);
  const glass = new THREE.Mesh(G(faceted(EMBERDEW_GLASS_PROFILE)), glassMat); glass.name = 'Glass'; glass.renderOrder = 2; g.add(glass);

  // Heavy brass foot cup, the cage straps over the shoulders and the two hoops that bind them: one merged mesh.
  const foot = faceted([[0, -.0985], [.034, -.0985], [.0425, -.095], [.0495, -.0865], [.0495, -.0795], [.0465, -.0775], [.0455, -.084], [.035, -.093], [0, -.093]]);
  const straps = [];
  // Four sturdy brass wires ride the glass edges in pairs on either flank, from the foot up to the neck collar,
  // leaving the front and back faces open (the medallion sits on the back).
  const path = EMBERDEW_GLASS_PROFILE.filter(([, y]) => y >= -.086 && y <= .05);
  for (const n of [3, 5, 11, 13]) {
    const a = n * Math.PI / 8, pts = path.map(([r, y]) => new THREE.Vector3(Math.sin(a) * (r + .0026), y, Math.cos(a) * (r + .0026)));
    straps.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', .2), 14, .0022, 4, false));
  }
  const hoop = (y, r, tube) => { const t = new THREE.TorusGeometry(r, tube, 6, SIDES); t.rotateX(Math.PI / 2); t.rotateY(TURN); t.translate(0, y, 0); return t; };
  // Medallion on the face toward the thrower (+Z): a round brass boss between the straps.
  const boss = new THREE.CylinderGeometry(.0165, .0175, .004, 16); boss.rotateX(Math.PI / 2); boss.translate(0, -.034, .0462);
  const cage = new THREE.Mesh(G(mergeGeometries([foot, ...straps, hoop(-.058, .0488, .0026), hoop(.016, .0425, .0024), boss].map(x => x.index ? x.toNonIndexed() : x))), brassMat);
  cage.name = 'FootBand'; g.add(cage);

  // Leather grip band at the waist, between the hoops (the hand sits here).
  const wrap = new THREE.Mesh(G(faceted([[.0482, -.05], [.0505, -.047], [.0505, -.021], [.0482, -.018]])), leatherMat); wrap.name = 'GripWrap'; g.add(wrap);

  // The grinning flame on the medallion: enamel flame, two ink eyes and a grin.
  const flame = new THREE.Shape();
  flame.moveTo(0, -.0115); flame.bezierCurveTo(.0105, -.0115, .0125, -.002, .0065, .0055); flame.bezierCurveTo(.006, .002, .0035, .0015, .0035, .0045);
  flame.bezierCurveTo(.0035, .008, .0015, .0105, -.001, .013); flame.bezierCurveTo(-.0005, .009, -.004, .007, -.006, .004);
  flame.bezierCurveTo(-.0115, -.002, -.0105, -.0115, 0, -.0115);
  const flameGeo = new THREE.ExtrudeGeometry(flame, {depth: .0014, bevelEnabled: false, curveSegments: 6}); flameGeo.translate(0, -.0345, .0482);
  const emblem = new THREE.Mesh(G(flameGeo), enamelMat); emblem.name = 'Emblem'; g.add(emblem);
  const eye = x => { const e = new THREE.SphereGeometry(.0013, 6, 4); e.scale(1, 1.35, .5); e.translate(x, -.0355, .0499); return e; };
  const grin = new THREE.TorusGeometry(.0034, .00075, 4, 10, Math.PI); grin.rotateZ(Math.PI); grin.translate(0, -.0385, .0499);
  const face = new THREE.Mesh(G(mergeGeometries([eye(-.0028), eye(.0028), grin].map(x => x.index ? x.toNonIndexed() : x))), inkMat); face.name = 'EmblemFace'; g.add(face);

  // Brass neck collar with two lugs (the readiness ring sits just under it).
  const collarGeo = mergeGeometries([hoop(0, .0192, .0034), ...[-1, 1].map(s => { const l = new THREE.BoxGeometry(.006, .007, .0045); l.translate(s * .0225, 0, 0); return l; })].map(x => x.index ? x.toNonIndexed() : x));
  const collar = new THREE.Mesh(G(collarGeo), darkBrassMat); collar.name = 'NeckCollar'; collar.position.y = .056; g.add(collar);
  // Cork, pushed in at a slight angle, with the rag crammed in beside it.
  const cork = faceted([[0, .062], [.0112, .062], [.0126, .074], [.0142, .083], [.0134, .087], [0, .0875]], 10);
  const stopper = new THREE.Mesh(G(cork), corkMat); stopper.name = 'Stopper'; stopper.position.x = -.0035; stopper.rotation.z = .08; g.add(stopper);
  // The rag: out of the neck, up, and flopped over sideways like a nightcap; it burns at the tip.
  const rag = ribbon([[.006, .07, .002], [.008, .086, .001], [.011, .097, -.001], [.016, .102, .002], [.022, .099, .004], [.026, .09, .005], [.027, .081, .006]], .019, 1.1);
  const knot = new THREE.SphereGeometry(.0078, 8, 6); knot.scale(1.25, .85, 1.05); knot.translate(.0085, .087, .001);
  const wick = new THREE.Mesh(G(mergeGeometries([rag.toNonIndexed(), knot.toNonIndexed()].map(x => { x.deleteAttribute('uv'); return x; }))), ragMat); wick.name = 'Wick'; g.add(wick);
  const tip = new THREE.Object3D(); tip.name = 'WickTip'; tip.position.fromArray(EMBERDEW_WICK_TIP); g.add(tip);

  // Pour mouth marker: front of the neck (-Z), where fuel leaves when tilted.
  const muzzle = new THREE.Object3D(); muzzle.name = 'Muzzle'; muzzle.position.set(0, .066, -.017); g.add(muzzle);

  let tris = 0, draws = 0;
  g.traverse(o => { if (o.isMesh) { draws++; const gg = o.geometry; tris += (gg.index ? gg.index.count : gg.attributes.position.count) / 3; } });
  g.userData.stats = {triangles: tris, draws, heightMeters: .21};
  g.userData.dispose = () => { geos.forEach(x => x.dispose()); mats.forEach(x => x.dispose()); };
  return g;
}
