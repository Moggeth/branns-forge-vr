import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
// Emberdew bottle, reforged (Opus 2026-10-05): a squat, cut-glass dwarven fire flask. Eight crisp facets, a heavy
// brass foot and cage, a stout neck with a cork, and a red rag stuffed in the neck that flops over like a jaunty cap.
// A brass medallion on the side facing the thrower carries a little grinning flame, and the cork (Corky) has a face of
// its own with the rag threaded up through its head like hair; red sealing wax drips down the neck. ~0.21 m tall, origin at the grip, +Y up, -Z front.
// Named parts kept for the presentation layers: Liquid, Glass, Wick (the rag), NeckCollar, GripWrap, FootBand,
// Stopper, Muzzle (pour mouth), WickTip (where the rag burns), CorkEyes, Wax. Plain materials, no textures, no lights.

const SIDES = 8, TURN = Math.PI / SIDES; // a flat face looks straight at the player (+Z) and straight ahead (-Z)
// Outer glass (radius, height). Broad shoulders, a waist for the hand, a short stout neck.
export const EMBERDEW_GLASS_PROFILE = Object.freeze([[0, -.092], [.03, -.092], [.04, -.086], [.0465, -.072], [.048, -.045],
  [.0475, -.012], [.043, .011], [.031, .029], [.0195, .041], [.0165, .049], [.0165, .064], [.0205, .067], [.0205, .073]].map(Object.freeze));
// Liquid container: the glass profile inset by the wall, capped under the cork (cork starts at y=.062).
export const EMBERDEW_INNER_PROFILE = Object.freeze([[0, -.0875], [.0275, -.0875], [.0365, -.082], [.0428, -.0705], [.0445, -.045],
  [.044, -.0125], [.0395, .0095], [.0278, .0265], [.0162, .0385], [.0135, .047], [.0135, .0605], [0, .0605]].map(Object.freeze));
export const EMBERDEW_SIDES = SIDES, EMBERDEW_TURN = TURN;
// The rag's burning tip (bottle-local).
export const EMBERDEW_WICK_TIP = Object.freeze([.017, .099, -.004]);

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
  const eyeMat = M(new THREE.MeshStandardMaterial({color: 0xfff6e6, roughness: .35, metalness: 0}));
  const waxMat = M(new THREE.MeshStandardMaterial({color: 0xa3201b, roughness: .32, metalness: 0, emissive: 0x2a0402, emissiveIntensity: .4}));

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
  // Round rivets where each wire crosses a hoop.
  const rivets = [];
  for (const n of [3, 5, 11, 13]) for (const [y, r] of [[-.058, .0514], [.016, .0449]]) { const a = n * Math.PI / 8, rv = new THREE.SphereGeometry(.0029, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2); rv.rotateX(Math.PI / 2); rv.rotateY(a); rv.scale(1, 1, 1); rv.translate(Math.sin(a) * (r - .0012), y, Math.cos(a) * (r - .0012)); rivets.push(rv); }
  const cage = new THREE.Mesh(G(mergeGeometries([foot, ...straps, hoop(-.058, .0488, .0026), hoop(.016, .0425, .0024), boss, ...rivets].map(x => { x = x.index ? x.toNonIndexed() : x; if (x.attributes.uv) x.deleteAttribute('uv'); return x; }))), brassMat);
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

  // Brass neck collar with two lugs (the readiness ring sits just under it).
  const collarGeo = mergeGeometries([hoop(0, .0192, .0034), ...[-1, 1].map(s => { const l = new THREE.BoxGeometry(.006, .007, .0045); l.translate(s * .0225, 0, 0); return l; })].map(x => x.index ? x.toNonIndexed() : x));
  const collar = new THREE.Mesh(G(collarGeo), darkBrassMat); collar.name = 'NeckCollar'; collar.position.y = .056; g.add(collar);

  // Corky: a tall cork pushed in dead centre, with a cheeky face looking back at the thrower (+Z). The rag is
  // threaded through the middle of its head and sticks up like a tuft of hair, so a lit bottle has its hair on fire.
  const corkProfile = [[0, .059], [.0118, .059], [.0124, .066], [.0136, .074], [.0148, .084], [.0152, .0905], [.0147, .0955], [.0132, .0985], [.0105, .1006], [.0058, .1018], [0, .1021]];
  const stopper = new THREE.Mesh(G(new THREE.LatheGeometry(v2(corkProfile), 14)), corkMat); stopper.name = 'Stopper'; g.add(stopper);
  const onCork = (x, y, lift = 0) => { const r = .0151 - Math.abs(y - .089) * .08; return [x, y, Math.sqrt(Math.max(0, r * r - x * x)) + lift]; };
  const blob = (r, sx, sy, sz, [x, y, z]) => { const e = new THREE.SphereGeometry(r, 8, 6); e.scale(sx, sy, sz); e.translate(x, y, z); return e; };
  const flat = list => list.map(x => { x = x.index ? x.toNonIndexed() : x; if (x.attributes.uv) x.deleteAttribute('uv'); return x; });
  // Big round eyes glancing up and in, little brows, and a lopsided grin.
  const whites = new THREE.Mesh(G(mergeGeometries(flat([-1, 1].map(s => blob(.0036, 1, 1.12, .55, onCork(s * .0057, .0875, -.0004)))))), eyeMat); whites.name = 'CorkEyes'; g.add(whites);
  const pupils = [-1, 1].map(s => blob(.0018, 1, 1.15, .5, onCork(s * .0050, .0884, .0013)));
  const brows = [-1, 1].map(s => { const b = new THREE.CapsuleGeometry(.0009, .0042, 1, 4); b.rotateZ(Math.PI / 2 - s * (s < 0 ? .38 : .12)); const [x, y, z] = onCork(s * .0059, s < 0 ? .0953 : .0936, .0002); b.translate(x, y, z); return b; });
  const smile = new THREE.TorusGeometry(.0042, .0008, 4, 12, Math.PI * .8); smile.rotateZ(Math.PI * 1.1); smile.rotateX(-.25); { const [x, y, z] = onCork(.0006, .0814, .0003); smile.translate(x, y, z); }
  // The medallion's flame face shares the ink.
  const eye = x => { const e = new THREE.SphereGeometry(.0013, 6, 4); e.scale(1, 1.35, .5); e.translate(x, -.0355, .0499); return e; };
  const grin = new THREE.TorusGeometry(.0034, .00075, 4, 10, Math.PI); grin.rotateZ(Math.PI); grin.translate(0, -.0385, .0499);
  const face = new THREE.Mesh(G(mergeGeometries(flat([...pupils, ...brows, smile, eye(-.0028), eye(.0028), grin]))), inkMat); face.name = 'EmblemFace'; g.add(face);
  // Rosy cheeks share the medallion's warm enamel.
  { const cheeks = [-1, 1].map(s => blob(.0026, 1, .8, .35, onCork(s * .0098, .0832, -.0003))), old = emblem.geometry, merged = mergeGeometries(flat([old.clone(), ...cheeks]));
    G(merged); emblem.geometry = merged; }

  // Red sealing wax over the lip and the foot of the cork, with a few drips running down the neck.
  const waxCap = new THREE.LatheGeometry(v2([[.0122, .0668], [.0199, .0663], [.0215, .0679], [.0217, .0716], [.0198, .0745], [.0151, .0757], [.0128, .0755]]), 14);
  // Each drip: a thin run down the outside of the lip and neck ending in a fat bead.
  const drips = [[.35, .007], [1.25, .004], [2.2, .011], [3.5, .006], [4.6, .009], [5.55, .0035]].flatMap(([a, len]) => {
    const r = .0171, run = new THREE.CapsuleGeometry(.00125, len, 2, 6), bead = new THREE.SphereGeometry(.0019, 6, 4);
    run.rotateX(-.04); run.translate(0, .0672 - len * .5, 0); bead.scale(1, 1.25, .9); bead.translate(0, .0672 - len - .0005, -.0004);
    for (const x of [run, bead]) { x.translate(0, 0, r); x.rotateY(a); }
    return [run, bead]; });
  const wax = new THREE.Mesh(G(mergeGeometries(flat([waxCap, ...drips]))), waxMat); wax.name = 'Wax'; g.add(wax);

  // The rag: up through the cork, a swept tuft of hair with a short cowlick, bound with a knot where it comes out.
  const tuft = ribbon([[0, .096, 0], [0, .106, 0], [.002, .112, -.001], [.007, .116, -.002], [.013, .113, -.003], [.0165, .105, -.004], [.017, .097, -.004]], .016, .9);
  const cowlick = ribbon([[0, .095, .001], [-.0015, .105, .002], [-.0055, .1095, .003], [-.0088, .1065, .003]], .0095, -.6);
  const knot = new THREE.SphereGeometry(.0052, 8, 6); knot.scale(1.1, .8, 1.1); knot.translate(0, .1022, 0);
  const wick = new THREE.Mesh(G(mergeGeometries(flat([tuft, cowlick, knot]))), ragMat); wick.name = 'Wick'; g.add(wick);
  const tip = new THREE.Object3D(); tip.name = 'WickTip'; tip.position.fromArray(EMBERDEW_WICK_TIP); g.add(tip);

  // Pour mouth marker: front of the neck (-Z), where fuel leaves when tilted.
  const muzzle = new THREE.Object3D(); muzzle.name = 'Muzzle'; muzzle.position.set(0, .066, -.017); g.add(muzzle);

  let tris = 0, draws = 0;
  g.traverse(o => { if (o.isMesh) { draws++; const gg = o.geometry; tris += (gg.index ? gg.index.count : gg.attributes.position.count) / 3; } });
  g.userData.stats = {triangles: tris, draws, heightMeters: .21};
  g.userData.dispose = () => { geos.forEach(x => x.dispose()); mats.forEach(x => x.dispose()); };
  return g;
}
