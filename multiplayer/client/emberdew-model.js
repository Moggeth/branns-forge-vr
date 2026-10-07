import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
// Emberdew bottle (Opus 2026-10-07): an old dwarven miner's lamp, pressed back into service. Before anyone thought of
// throwing them, Brann's miners filled these squat cut-glass lamps with ember dew (the honey-thick fire that weeps from
// banked forge coals) to light the deep tunnels. Each one has a life behind it: a heavy brass foot dented from years on
// rock ledges, a lantern guard with a carry bail laid back over the shoulder, a brass burner screwed onto the neck with
// the wick-raising thumbwheel on its side, soot smudged up the shoulders from a thousand shifts, the miners' stamped
// pick-and-hammer mark on the boss, and a dented tin tally tag counting the shifts it worked. Now the burner is screwed
// down tight and the flat lamp wick is lit for throwing.
// ~0.22 m tall, origin at the grip, +Y up, -Z front (the boss, tag and thumbwheel face the thrower at +Z / +X).
// Named parts kept for the presentation layers: Liquid, Glass, Wick (the lamp wick), NeckCollar, GripWrap, FootBand,
// Stopper (the burner), Muzzle (pour mouth), WickTip (where the wick burns), Stamp, Tag. Plain materials, no textures, no lights.

const SIDES = 8, TURN = Math.PI / SIDES; // a flat face looks straight at the player (+Z) and straight ahead (-Z)
// Outer glass (radius, height). Broad shoulders, a waist for the hand, a short stout neck.
export const EMBERDEW_GLASS_PROFILE = Object.freeze([[0, -.092], [.03, -.092], [.04, -.086], [.0465, -.072], [.048, -.045],
  [.0475, -.012], [.043, .011], [.031, .029], [.0195, .041], [.0165, .049], [.0165, .064], [.0205, .067], [.0205, .073]].map(Object.freeze));
// Liquid container: the glass profile inset by the wall, capped under the cork (cork starts at y=.062).
export const EMBERDEW_INNER_PROFILE = Object.freeze([[0, -.0875], [.0275, -.0875], [.0365, -.082], [.0428, -.0705], [.0445, -.045],
  [.044, -.0125], [.0395, .0095], [.0278, .0265], [.0162, .0385], [.0135, .047], [.0135, .0605], [0, .0605]].map(Object.freeze));
export const EMBERDEW_SIDES = SIDES, EMBERDEW_TURN = TURN;
// The rag's burning tip (bottle-local).
export const EMBERDEW_WICK_TIP = Object.freeze([.0016, .1085, 0]);

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
  const flat = list => list.map(x => { x = x.index ? x.toNonIndexed() : x; for (const k of ['uv', 'color']) if (x.attributes[k]) x.deleteAttribute(k); return x; });
  const merged = list => mergeGeometries(flat(list));

  // Cut glass, clear at the belly so the dew reads first, smoked with old lamp soot up the shoulders (vertex colour + alpha).
  const glassMat = M(new THREE.MeshPhysicalMaterial({color: 0xfff1dc, roughness: .05, metalness: 0, transparent: true, opacity: 1, clearcoat: .8, clearcoatRoughness: .05, specularIntensity: .9, envMapIntensity: .8, depthWrite: false, flatShading: true, vertexColors: true}));
  // Ember dew: deep honeyed amber (the presentation swaps in its sloshing shader; this is the plain fallback).
  const liquidMat = M(new THREE.MeshStandardMaterial({color: 0xb0480c, roughness: .18, metalness: 0, emissive: 0x7a2604, emissiveIntensity: .3, flatShading: true}));
  // Old brass: warm but worn (rougher than new), and a darker oxidised brass for the collar.
  const brassMat = M(new THREE.MeshStandardMaterial({color: 0xb98a3e, roughness: .46, metalness: .9}));
  const darkBrassMat = M(new THREE.MeshStandardMaterial({color: 0x6e4a22, roughness: .5, metalness: .85}));
  const leatherMat = M(new THREE.MeshStandardMaterial({color: 0x4a2a17, roughness: .82, metalness: 0}));
  const wickMat = M(new THREE.MeshStandardMaterial({color: 0xd9c9a4, roughness: .95, metalness: 0, side: THREE.DoubleSide, emissive: 0x2a1404, emissiveIntensity: .25}));
  const inkMat = M(new THREE.MeshStandardMaterial({color: 0x241a12, roughness: .75, metalness: .25}));
  const burnerMat = M(new THREE.MeshStandardMaterial({color: 0xa27a3c, roughness: .52, metalness: .82, vertexColors: true}));
  const tinMat = M(new THREE.MeshStandardMaterial({color: 0xaeb3b6, roughness: .5, metalness: .8}));

  const liquid = new THREE.Mesh(G(faceted(EMBERDEW_INNER_PROFILE)), liquidMat); liquid.name = 'Liquid'; g.add(liquid);
  const glassGeo = faceted(EMBERDEW_GLASS_PROFILE), gp = glassGeo.attributes.position, tint = new Float32Array(gp.count * 4);
  for (let i = 0; i < gp.count; i++) {
    // Soot climbs from the waist to the neck, heavier on the side the flame leaned (-X) and patchy around the facets.
    const y = gp.getY(i), a = Math.atan2(gp.getX(i), gp.getZ(i)), patch = .75 + .25 * Math.sin(a * 3 + 1.3) - .2 * Math.sin(a);
    const soot = Math.min(1, Math.max(0, (y + .012) / .045)) * patch;
    const c = 1 - soot * .95; tint.set([c, c * .94, c * .88, .2 + soot * .72], i * 4);
  }
  glassGeo.setAttribute('color', new THREE.Float32BufferAttribute(tint, 4));
  const glass = new THREE.Mesh(G(glassGeo), glassMat); glass.name = 'Glass'; glass.renderOrder = 2; g.add(glass);

  // Lamp foot and lantern guard: a heavy brass foot cup (dented), four guard wires riding the glass edges, two hoops
  // with rivets, the boss that carries the miners' stamp, and the carry bail laid back over the shoulder. One mesh.
  const foot = faceted([[0, -.0985], [.034, -.0985], [.0425, -.095], [.0495, -.0865], [.0495, -.0795], [.0465, -.0775], [.0455, -.084], [.035, -.093], [0, -.093]]);
  { const fp = foot.attributes.position; for (let i = 0; i < fp.count; i++) { const x = fp.getX(i), z = fp.getZ(i), y = fp.getY(i);
      // Two old dents in the foot rim: pushed in where it was dropped on rock.
      const d = Math.max(0, 1 - Math.hypot(x - .036, z + .03) / .016) + .7 * Math.max(0, 1 - Math.hypot(x + .04, z - .018) / .012);
      if (d > 0 && y > -.096) { const r = Math.hypot(x, z) || 1, k = 1 - d * .07; fp.setX(i, x * k); fp.setZ(i, z * k); } } }
  const straps = [];
  const path = EMBERDEW_GLASS_PROFILE.filter(([, y]) => y >= -.086 && y <= .05);
  for (const n of [3, 5, 11, 13]) {
    const a = n * Math.PI / 8, pts = path.map(([r, y]) => new THREE.Vector3(Math.sin(a) * (r + .0026), y, Math.cos(a) * (r + .0026)));
    straps.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', .2), 14, .0022, 4, false));
  }
  const hoop = (y, r, tube) => { const t = new THREE.TorusGeometry(r, tube, 6, SIDES); t.rotateX(Math.PI / 2); t.rotateY(TURN); t.translate(0, y, 0); return t; };
  const boss = new THREE.CylinderGeometry(.0165, .0175, .004, 16); boss.rotateX(Math.PI / 2); boss.translate(0, -.034, .0462);
  const rivets = [];
  for (const n of [3, 5, 11, 13]) for (const [y, r] of [[-.058, .0514], [.016, .0449]]) { const a = n * Math.PI / 8, rv = new THREE.SphereGeometry(.0029, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2); rv.rotateX(Math.PI / 2); rv.rotateY(a); rv.translate(Math.sin(a) * (r - .0012), y, Math.cos(a) * (r - .0012)); rivets.push(rv); }
  // Carry bail: a wire hoop hinged on the collar lugs, laid back (away from the thrower) with a hanging ring at its crown.
  const bailCurve = new THREE.EllipseCurve(0, 0, .0262, .046, 0, Math.PI, false), bailPts = bailCurve.getPoints(16).map(p => new THREE.Vector3(p.x, p.y, 0));
  const bail = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bailPts), 18, .0016, 5, false);
  const ring = new THREE.TorusGeometry(.0052, .0013, 5, 12); ring.translate(0, .046 + .005, 0);
  const pins = [-1, 1].map(s => { const c = new THREE.CylinderGeometry(.0024, .0024, .003, 8); c.rotateZ(Math.PI / 2); c.translate(s * .0265, 0, 0); return c; });
  const bailGeo = merged([bail, ring]); bailGeo.rotateX(-1.78); bailGeo.translate(0, .056, 0);
  pins.forEach(p => p.translate(0, .056, 0));
  const cage = new THREE.Mesh(G(merged([foot, ...straps, hoop(-.058, .0488, .0026), hoop(.016, .0425, .0024), boss, ...rivets, bailGeo, ...pins])), brassMat);
  cage.name = 'FootBand'; g.add(cage);

  // Leather grip band at the waist, between the hoops (the hand sits here).
  const wrap = new THREE.Mesh(G(faceted([[.0482, -.05], [.0505, -.047], [.0505, -.021], [.0482, -.018]])), leatherMat); wrap.name = 'GripWrap'; g.add(wrap);

  // Lower lamp collar with the two bail lugs (the readiness ring sits just under it; it glows when lit).
  const collarGeo = merged([hoop(0, .0192, .0034), ...[-1, 1].map(s => { const l = new THREE.BoxGeometry(.006, .007, .0045); l.translate(s * .0225, 0, 0); return l; })]);
  const collar = new THREE.Mesh(G(collarGeo), darkBrassMat); collar.name = 'NeckCollar'; collar.position.y = .056; g.add(collar);

  // The burner, screwed down over the lip: a knurled thread ring, a low dome, the flat wick tube dead centre and the
  // wick-raising thumbwheel on its side (toward the thrower's right, +X).
  const thread = new THREE.LatheGeometry(v2([[.0168, .0598], [.0222, .0598], [.0228, .0622], [.0219, .0636], [.0228, .065], [.0219, .0664], [.0228, .0678], [.0219, .0692], [.0228, .0706], [.0224, .0748], [.0168, .0748]]), 18);
  const dome = new THREE.LatheGeometry(v2([[.0222, .0746], [.0226, .0768], [.0198, .0818], [.0142, .0856], [.0072, .0874], [0, .0877]]), 18);
  const tube = new THREE.BoxGeometry(.0118, .011, .0052); tube.translate(0, .0925, 0);
  const lip = new THREE.BoxGeometry(.0134, .0012, .0066); lip.translate(0, .1, 0);
  const spindle = new THREE.CylinderGeometry(.0011, .0011, .012, 6); spindle.rotateZ(Math.PI / 2); spindle.translate(.0105, .0905, 0);
  const wheel = new THREE.CylinderGeometry(.0058, .0058, .0024, 14); wheel.rotateZ(Math.PI / 2); wheel.translate(.0172, .0905, 0);
  const knurls = []; for (let i = 0; i < 14; i++) { const a = i * Math.PI * 2 / 14, k = new THREE.BoxGeometry(.0028, .0011, .0011); k.translate(.0172, .0905 + Math.sin(a) * .0059, Math.cos(a) * .0059); k.rotateX(0); knurls.push(k); }
  const burnerGeo = merged([thread, dome, tube, lip, spindle, wheel, ...knurls]), bp = burnerGeo.attributes.position, bc = new Float32Array(bp.count * 3);
  for (let i = 0; i < bp.count; i++) {
    // Verdigris: blue-green in the thread grooves and around the foot of the dome, where old lamp oil and damp sat.
    const y = bp.getY(i), r = Math.hypot(bp.getX(i), bp.getZ(i)), groove = r > .0205 && r < .0222 && y < .0745 ? 1 : 0, foot = y > .0744 && y < .079 ? .55 : 0;
    const v = Math.max(groove, foot); bc.set([1 - v * .55, 1 - v * .12, 1 - v * .05 + v * .1], i * 3);
  }
  burnerGeo.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
  const burner = new THREE.Mesh(G(burnerGeo), burnerMat); burner.name = 'Stopper'; g.add(burner);

  // The flat woven lamp wick standing out of its tube, a little curled, its top charred from old shifts.
  const strip = (pts, width) => { const geo = ribbon(pts, width, 0); return geo; };
  const wickGeo = merged([strip([[0, .0975, 0], [0, .102, 0], [.0004, .1055, 0], [.0012, .1078, 0]], .0092)]);
  const wick = new THREE.Mesh(G(wickGeo), wickMat); wick.name = 'Wick'; g.add(wick);
  const tip = new THREE.Object3D(); tip.name = 'WickTip'; tip.position.fromArray(EMBERDEW_WICK_TIP); g.add(tip);

  // Stamped marks (dark ink in the brass and tin): the miners' crossed pick and hammer on the boss, the char on the
  // wick, and the tally notches on the tag.
  const bar = (w, h, x, y, rot, z = .0487) => { const b = new THREE.BoxGeometry(w, h, .0009); b.rotateZ(rot); b.translate(x, y, z); return b; };
  const mark = [bar(.0018, .02, 0, -.034, .62), bar(.0018, .02, 0, -.034, -.62),            // the two hafts, crossed
    bar(.0105, .0034, -.0052, -.0262, -.62 + Math.PI / 2 - .55), bar(.0026, .0062, -.0067, -.0255, .2),   // pick head
    bar(.0078, .0046, .0063, -.0266, .62 - .25)];                                                          // hammer head
  const char = new THREE.BoxGeometry(.0096, .0016, .0017); char.rotateZ(.12); char.translate(.0012, .1074, 0);
  // Tin tally tag hanging on a wire from the bail pin on the thrower's side (+X): five shifts and a slash, then two more.
  const tagAt = new THREE.Vector3(.0318, .0405, .006), tagRot = new THREE.Euler(.05, .35, .12);
  const notches = [...[0, 1, 2, 3].map(i => bar(.0007, .0062, -.0034 + i * .0016, .0012, 0, .0006)), bar(.0007, .0078, -.001, .0012, 1.05, .0006),
    ...[0, 1].map(i => bar(.0007, .0062, .0034 + i * .0016, -.003, 0, .0006))];
  const tagMatrix = new THREE.Matrix4().compose(tagAt, new THREE.Quaternion().setFromEuler(tagRot), new THREE.Vector3(1, 1, 1));
  notches.forEach(n => n.applyMatrix4(tagMatrix));
  const stamp = new THREE.Mesh(G(merged([...mark, char, ...notches])), inkMat); stamp.name = 'Stamp'; g.add(stamp);
  const plate = new THREE.BoxGeometry(.0128, .0158, .0009); plate.translate(0, -.0004, 0);
  const hole = new THREE.TorusGeometry(.0013, .0005, 4, 8); hole.translate(0, .0062, .0005);
  const plateGeo = merged([plate, hole]); plateGeo.applyMatrix4(tagMatrix);
  const loopCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(.0272, .056, .0005), new THREE.Vector3(.031, .051, .004), new THREE.Vector3(.0318, .0467, .0062)]);
  const loop = new THREE.TubeGeometry(loopCurve, 6, .0006, 4, false);
  const tag = new THREE.Mesh(G(merged([plateGeo, loop])), tinMat); tag.name = 'Tag'; g.add(tag);

  // Pour mouth marker: front of the neck (-Z), where fuel leaves when tilted.
  const muzzle = new THREE.Object3D(); muzzle.name = 'Muzzle'; muzzle.position.set(0, .066, -.017); g.add(muzzle);

  let tris = 0, draws = 0;
  g.traverse(o => { if (o.isMesh) { draws++; const gg = o.geometry; tris += (gg.index ? gg.index.count : gg.attributes.position.count) / 3; } });
  g.userData.stats = {triangles: tris, draws, heightMeters: .21};
  g.userData.dispose = () => { geos.forEach(x => x.dispose()); mats.forEach(x => x.dispose()); };
  return g;
}
