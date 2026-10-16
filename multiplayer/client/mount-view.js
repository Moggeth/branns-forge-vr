// Horses and tigers (shared/mounts.js), drawn every frame. Read-only: never writes input, physics or network state.
//
// Each mount is a small procedural rig (body, neck/head, tail and four two-part legs), faceted and vertex-coloured so a
// whole animal is about a dozen draws on one shared material. A ridden mount is placed under its rider's drawn position
// (the local Hero's predicted position, or a remote Hero's smoothed root), so it never steps with network ticks; a free
// one eases toward its snapshot spot. Gaits come from the drawn speed: a horse walks, trots and gallops, a tiger walks
// and bounds; both tuck their legs in the air and graze or groom when left standing.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {MOUNT} from '../shared/mounts.js';

const TAU = Math.PI * 2;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n)), smooth = (a, b, t) => { t = clamp((t - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const MATERIAL = new THREE.MeshStandardMaterial({vertexColors: true, flatShading: true, roughness: .78, metalness: 0});
const SHINE = new THREE.MeshStandardMaterial({vertexColors: true, flatShading: true, roughness: .32, metalness: .65}); // brass and buckles
const DRAW_RANGE = 170;

// ---------- geometry kit ----------
const _c = new THREE.Color(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
/** One painted piece: geometry placed by p/r/s, coloured per triangle (colour may be a function of the centroid). */
function piece(geo, color, {p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]} = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g.applyMatrix4(_m.compose(_p.fromArray(p), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s.fromArray(s)));
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 3) {
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3, z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    _c.set(typeof color === 'function' ? color(x, y, z) : color);
    for (let k = 0; k < 3; k++) col.set([_c.r, _c.g, _c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function mesh(parts, material = MATERIAL) {
  const geo = mergeGeometries(parts); geo.computeVertexNormals(); geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, material); m.castShadow = true; m.receiveShadow = false; return m;
}
const ico = (d = 1) => new THREE.IcosahedronGeometry(1, d), box = () => new THREE.BoxGeometry(1, 1, 1);
const cyl = (top, bottom, h, n = 7) => new THREE.CylinderGeometry(top, bottom, h, n, 1);
const cone = (r, h, n = 5) => new THREE.ConeGeometry(r, h, n, 1);
const group = (name, p = [0, 0, 0], ...children) => { const g = new THREE.Group(); g.name = name; g.position.fromArray(p); for (const c of children) if (c) g.add(c); return g; };

// ---------- the horse ----------
const HORSE_COATS = [
  {coat: 0xb4612c, dark: 0x8a4521, mane: 0xf4e3b6, sock: 0xfaf1dc, blanket: 0x2b8fb0, trim: 0xe6b54a}, // chestnut, cream mane, Dawnhold blue
  {coat: 0xd2d4d4, dark: 0x9a9fa3, mane: 0x4c4f56, sock: 0xf2f2ee, blanket: 0xc8462f, trim: 0xe6b54a}, // dapple grey, slate mane, ember red
];
function buildHorse(v = 0) {
  const c = HORSE_COATS[v % HORSE_COATS.length], leather = 0x6e3b1d, leatherDark = 0x4a2612, hoof = 0x3a2b22, eye = 0x1d1714;
  // A dappled grey gets lighter rings on the flank; a chestnut a lighter belly.
  const coat = (x, y, z) => v % 2 ? ((Math.sin(x * 23 + z * 17) + Math.sin(z * 29 - y * 21)) > 1.1 ? 0xe9eae8 : c.coat) : (y < .84 ? 0xc77a43 : c.coat);
  const body = [
    piece(ico(2), coat, {p: [0, 1.07, 0], s: [.42, .36, .82]}),
    piece(ico(1), coat, {p: [0, 1.12, -.56], s: [.4, .42, .42]}),            // chest
    piece(ico(1), coat, {p: [0, 1.14, .55], s: [.43, .41, .46]}),            // rump
    // Saddle blanket with gold trim, flaps down each side.
    piece(box(), c.blanket, {p: [0, 1.41, .02], s: [.86, .05, .74]}),
    piece(box(), c.trim, {p: [0, 1.395, .02], s: [.9, .025, .78]}),
    piece(box(), c.blanket, {p: [.43, 1.22, .02], s: [.05, .38, .7], r: [0, 0, -.18]}),
    piece(box(), c.blanket, {p: [-.43, 1.22, .02], s: [.05, .38, .7], r: [0, 0, .18]}),
    piece(box(), c.trim, {p: [.47, 1.04, .02], s: [.04, .04, .72], r: [0, 0, -.18]}),
    piece(box(), c.trim, {p: [-.47, 1.04, .02], s: [.04, .04, .72], r: [0, 0, .18]}),
    // Leather seat, pommel and cantle.
    piece(box(), leather, {p: [0, 1.46, .02], s: [.44, .07, .52]}),
    piece(box(), leatherDark, {p: [0, 1.52, -.25], s: [.22, .12, .1], r: [-.3, 0, 0]}),
    piece(box(), leatherDark, {p: [0, 1.53, .27], s: [.36, .13, .08], r: [.35, 0, 0]}),
    // Girth band, stirrup leathers.
    piece(box(), leatherDark, {p: [0, .74, -.12], s: [.62, .06, .12]}),
    piece(box(), leatherDark, {p: [.48, 1.12, -.02], s: [.025, .5, .05]}),
    piece(box(), leatherDark, {p: [-.48, 1.12, -.02], s: [.025, .5, .05]}),
    // Breast strap across the chest.
    piece(box(), leatherDark, {p: [0, 1.18, -.94], s: [.5, .06, .06]}),
  ];
  const brass = [
    piece(box(), c.trim, {p: [.5, .86, -.02], s: [.11, .04, .1]}), piece(box(), c.trim, {p: [-.5, .86, -.02], s: [.11, .04, .1]}),  // stirrups
    piece(ico(0), c.trim, {p: [0, 1.6, -.28], s: [.05, .05, .05]}),                                                                  // pommel knob
    piece(ico(0), c.trim, {p: [0, 1.18, -.98], s: [.07, .07, .04]}),                                                                 // chest medallion
  ];
  const torso = group('torso', [0, 0, 0], mesh(body), mesh(brass, SHINE));
  // Neck rises forward from the chest; the head hangs off its top.
  const mane = []; for (let k = 0; k < 7; k++) mane.push(piece(box(), c.mane, {p: [0, .08 + k * .1, .17 - k * .012], s: [.07, .17, .16], r: [.25, 0, 0]}));
  const neck = group('neck', [0, 1.3, -.66], mesh([piece(cyl(.16, .27, .82, 7), c.coat, {p: [0, .36, 0]}), ...mane]));
  neck.rotation.x = -.62;
  const head = group('head', [0, .78, 0], mesh([
    piece(ico(1), c.coat, {p: [0, .02, -.05], s: [.17, .19, .23]}),
    piece(ico(1), c.coat, {p: [0, -.08, -.3], s: [.13, .13, .21], r: [-.15, 0, 0]}),        // muzzle
    piece(ico(0), c.dark, {p: [0, -.1, -.47], s: [.11, .09, .06]}),                          // nose
    piece(box(), c.sock, {p: [0, .02, -.24], s: [.06, .02, .3], r: [-.35, 0, 0]}),           // blaze
    piece(cone(.05, .17, 4), c.coat, {p: [.08, .23, .06], r: [-.1, 0, -.2]}), piece(cone(.05, .17, 4), c.coat, {p: [-.08, .23, .06], r: [-.1, 0, .2]}),
    piece(box(), c.mane, {p: [0, .17, -.1], s: [.08, .1, .12], r: [.5, 0, 0]}),              // forelock
    piece(ico(0), eye, {p: [.15, .07, -.1], s: [.035, .04, .04]}), piece(ico(0), eye, {p: [-.15, .07, -.1], s: [.035, .04, .04]}),
    piece(ico(0), 0xffffff, {p: [.17, .085, -.12], s: [.012, .012, .012]}), piece(ico(0), 0xffffff, {p: [-.17, .085, -.12], s: [.012, .012, .012]}),
    // Bridle: noseband, cheek straps, brow band, reins back to the saddle.
    piece(box(), leatherDark, {p: [0, -.06, -.33], s: [.29, .04, .05]}),
    piece(box(), leatherDark, {p: [.16, -.01, -.2], s: [.02, .2, .04], r: [.6, 0, 0]}), piece(box(), leatherDark, {p: [-.16, -.01, -.2], s: [.02, .2, .04], r: [.6, 0, 0]}),
    piece(box(), leatherDark, {p: [0, .14, -.02], s: [.3, .04, .04]}),
  ]), mesh([piece(ico(0), c.trim, {p: [.15, -.06, -.34], s: [.03, .03, .03]}), piece(ico(0), c.trim, {p: [-.15, -.06, -.34], s: [.03, .03, .03]})], SHINE));
  head.rotation.x = .05;
  neck.add(head);
  const tail = group('tail', [0, 1.34, .96], mesh([
    piece(cyl(.06, .05, .22, 5), c.coat, {p: [0, -.05, .06], r: [.9, 0, 0]}),
    piece(cone(.14, .86, 6), c.mane, {p: [0, -.44, .2], r: [Math.PI - .28, 0, 0]}),
    piece(cone(.1, .7, 5), c.mane, {p: [.06, -.38, .16], r: [Math.PI - .18, 0, .14]}),
    piece(cone(.1, .7, 5), c.mane, {p: [-.06, -.38, .16], r: [Math.PI - .18, 0, -.14]}),
    piece(ico(1), c.mane, {p: [0, -.06, .14], s: [.1, .1, .12]}),
  ]));
  const legs = [];
  const leg = (name, x, z, back) => {
    const knee = group('knee', [0, -.45, 0], mesh([
      piece(cyl(.085, .07, .38, 6), c.coat, {p: [0, -.17, 0]}),
      piece(cyl(.085, .08, .14, 6), c.sock, {p: [0, -.36, 0]}),
      piece(cyl(.09, .105, .11, 6), hoof, {p: [0, -.47, 0]}),
    ]));
    const hip = group(name, [x, 1.0, z], mesh([piece(cyl(back ? .16 : .13, .09, .48, 6), coat, {p: [0, -.2, back ? .03 : 0]})]), knee);
    legs.push({hip, knee, front: !back, side: x > 0 ? 1 : -1}); return hip;
  };
  const root = group('horse', [0, 0, 0], group('body', [0, 0, 0], torso, neck, tail, leg('legFL', .21, -.62, false), leg('legFR', -.21, -.62, false), leg('legHL', .22, .62, true), leg('legHR', -.22, .62, true)));
  return {root, body: root.children[0], neck, head, tail, tailLinks: [], legs, kind: 'horse', neckRest: neck.rotation.x, headRest: head.rotation.x, hipY: 1.0};
}

// ---------- the tiger ----------
function buildTiger() {
  const orange = 0xec8a2e, deep = 0xd2701f, cream = 0xfff3dd, ink = 0x2a1d17, red = 0xb8342b, gold = 0xe8b64c, leather = 0x5a2d16;
  // Stripes: bands across the back and flanks that thin toward the belly, which stays cream.
  const striped = (x, y, z, belly = .7) => y < belly ? cream : (y > belly + .32 ? deep : orange);
  // Stripes are real bands: thin arcs hugging the body's cross-section, tilted and tapering toward the belly.
  const bands = [];
  const band = (z, cy, rx, ry, tilt, from = .35, to = Math.PI - .35, tube = .028) => {
    const g = new THREE.TorusGeometry(1, tube, 3, 9, to - from); g.rotateZ(from);
    bands.push(piece(g, ink, {p: [0, cy, z], r: [tilt, 0, 0], s: [rx + .012, ry + .012, 1]}));
  };
  for (const [z, w] of [[-.88, .8], [-.74, .95], [-.42, 1], [-.3, .9], [.32, .95], [.44, 1], [.7, .95], [.84, .8], [.98, .55]]) {
    const ez = z < -.5 ? (z + .64) / .42 : z > .5 ? (z - .62) / .44 : z / .92, base = z < -.5 ? [.42, .4, .9] : z > .5 ? [.41, .38, .9] : [.4, .33, .86];
    const k = Math.sqrt(Math.max(.05, 1 - ez * ez)); band(z, base[2], base[0] * k, base[1] * k, (z > 0 ? -.12 : .12), .5 + (1 - w) * .5, Math.PI - .5 - (1 - w) * .5);
  }
  const body = [
    piece(ico(2), (x, y, z) => striped(x, y, z), {p: [0, .86, 0], s: [.4, .33, .92]}),
    piece(ico(1), (x, y, z) => striped(x, y, z, .74), {p: [0, .9, -.64], s: [.42, .4, .42]}),     // shoulders
    piece(ico(1), (x, y, z) => striped(x, y, z, .74), {p: [0, .9, .62], s: [.41, .38, .44]}),     // haunches
    // Saddle: crimson blanket, gold trim, dark leather seat, a harness strap round the chest.
    piece(box(), red, {p: [0, 1.17, .02], s: [.8, .05, .68]}),
    piece(box(), gold, {p: [0, 1.155, .02], s: [.84, .025, .72]}),
    piece(box(), red, {p: [.41, .99, .02], s: [.05, .36, .62], r: [0, 0, -.22]}), piece(box(), red, {p: [-.41, .99, .02], s: [.05, .36, .62], r: [0, 0, .22]}),
    piece(box(), gold, {p: [.45, .82, .02], s: [.04, .04, .64], r: [0, 0, -.22]}), piece(box(), gold, {p: [-.45, .82, .02], s: [.04, .04, .64], r: [0, 0, .22]}),
    piece(box(), leather, {p: [0, 1.22, .02], s: [.42, .07, .48]}),
    piece(box(), leather, {p: [0, 1.28, -.22], s: [.2, .1, .08], r: [-.3, 0, 0]}), piece(box(), leather, {p: [0, 1.29, .25], s: [.34, .11, .07], r: [.35, 0, 0]}),
    piece(box(), leather, {p: [0, .96, -.98], s: [.48, .06, .06]}),
    piece(box(), leather, {p: [.45, .92, -.02], s: [.025, .48, .05]}), piece(box(), leather, {p: [-.45, .92, -.02], s: [.025, .48, .05]}),
    ...bands,
  ];
  const brass = [piece(box(), gold, {p: [.47, .66, -.02], s: [.1, .04, .1]}), piece(box(), gold, {p: [-.47, .66, -.02], s: [.1, .04, .1]}), piece(ico(0), gold, {p: [0, .96, -1.02], s: [.07, .07, .04]})];
  const torso = group('torso', [0, 0, 0], mesh(body), mesh(brass, SHINE));
  const face = (x, y) => y < -.04 || Math.abs(x) > .2 && y < .06 ? cream : orange;
  const marks = [ // forehead chevrons, cheek flicks
    piece(box(), ink, {p: [0, .24, -.12], s: [.05, .02, .12], r: [.7, 0, 0]}),
    piece(box(), ink, {p: [.06, .2, -.18], s: [.035, .02, .1], r: [.6, .5, 0]}), piece(box(), ink, {p: [-.06, .2, -.18], s: [.035, .02, .1], r: [.6, -.5, 0]}),
    piece(box(), ink, {p: [.1, .16, -.21], s: [.03, .02, .08], r: [.5, .7, 0]}), piece(box(), ink, {p: [-.1, .16, -.21], s: [.03, .02, .08], r: [.5, -.7, 0]}),
    piece(box(), ink, {p: [.27, .04, -.02], s: [.02, .03, .12], r: [0, .3, .4]}), piece(box(), ink, {p: [-.27, .04, -.02], s: [.02, .03, .12], r: [0, -.3, -.4]}),
    piece(box(), ink, {p: [.26, .1, .04], s: [.02, .03, .1], r: [0, .2, .5]}), piece(box(), ink, {p: [-.26, .1, .04], s: [.02, .03, .1], r: [0, -.2, -.5]}),
  ];
  const head = group('head', [0, 1.04, -.98], mesh([
    piece(ico(1), face, {p: [0, .04, 0], s: [.29, .26, .28]}),
    piece(ico(1), cream, {p: [0, -.07, -.22], s: [.16, .11, .13]}),                            // muzzle
    piece(ico(0), 0x5b3a33, {p: [0, -.02, -.33], s: [.06, .04, .04]}),                         // nose
    piece(ico(1), cream, {p: [.22, -.07, -.04], s: [.11, .1, .1]}), piece(ico(1), cream, {p: [-.22, -.07, -.04], s: [.11, .1, .1]}), // cheek ruffs
    piece(cone(.085, .12, 5), orange, {p: [.17, .26, .04], r: [-.15, 0, -.35]}), piece(cone(.085, .12, 5), orange, {p: [-.17, .26, .04], r: [-.15, 0, .35]}),
    piece(cone(.05, .07, 5), ink, {p: [.17, .27, .065], r: [-.15, 0, -.35]}), piece(cone(.05, .07, 5), ink, {p: [-.17, .27, .065], r: [-.15, 0, .35]}),
    piece(ico(0), 0xf2c53d, {p: [.11, .07, -.23], s: [.045, .04, .03]}), piece(ico(0), 0xf2c53d, {p: [-.11, .07, -.23], s: [.045, .04, .03]}),
    piece(ico(0), ink, {p: [.11, .07, -.255], s: [.02, .03, .01]}), piece(ico(0), ink, {p: [-.11, .07, -.255], s: [.02, .03, .01]}),
    piece(box(), leather, {p: [0, -.04, -.18], s: [.36, .04, .04]}),                            // halter
    ...marks,
  ]));
  const tailLinks = []; let parent = null; const tailRoot = group('tail', [0, .98, .98]);
  for (let k = 0; k < 6; k++) {
    const link = group(`tail${k}`, k ? [0, 0, .24] : [0, 0, 0], mesh([piece(cyl(.06 - k * .006, .065 - k * .006, .26, 6), k === 5 ? ink : (k % 2 ? ink : orange), {p: [0, 0, .12], r: [Math.PI / 2, 0, 0]})]));
    (parent || tailRoot).add(link); parent = link; tailLinks.push(link);
  }
  tailLinks[0].rotation.x = .5;
  const legs = [];
  const leg = (name, x, z, back) => {
    const stripe = () => orange, ring = (y, r) => piece(new THREE.TorusGeometry(r, .022, 3, 7, Math.PI * 1.2), ink, {p: [0, y, 0], r: [Math.PI / 2, 0, x > 0 ? -1.9 : 1.9 - Math.PI * .2]});
    const knee = group('knee', [0, -.38, 0], mesh([
      piece(cyl(.105, .09, .3, 6), stripe, {p: [0, -.14, 0]}),
      piece(ico(1), cream, {p: [0, -.32, -.04], s: [.12, .07, .15]}),                          // paw
      ring(-.06, .1), ring(-.16, .095),
    ]));
    const hip = group(name, [x, .79, z], mesh([piece(cyl(back ? .16 : .14, .11, .42, 6), orange, {p: [0, -.17, back ? .03 : 0]}), ring(-.24, back ? .135 : .125), ring(-.33, .12)]), knee);
    legs.push({hip, knee, front: !back, side: x > 0 ? 1 : -1}); return hip;
  };
  const root = group('tiger', [0, 0, 0], group('body', [0, 0, 0], torso, head, tailRoot, leg('legFL', .22, -.62, false), leg('legFR', -.22, -.62, false), leg('legHL', .22, .64, true), leg('legHR', -.22, .64, true)));
  return {root, body: root.children[0], neck: null, head, tail: tailRoot, tailLinks, legs, kind: 'tiger', headRest: 0, hipY: .79};
}

// ---------- gaits ----------
// Phase offsets per leg (FL, FR, HL, HR) for each gait, in cycles.
const GAITS = {
  walk: [0, .5, .75, .25], trot: [0, .5, .5, 0], gallop: [.12, .22, .58, .68], bound: [0, .06, .5, .56],
};
function pose(rig, a, dt) {
  const s = a.speed, kind = rig.kind;
  const walkW = 1 - smooth(2.2, 3.6, s), fastW = smooth(5.5, 7.5, s), midW = 1 - walkW - fastW;
  const cycle = kind === 'horse' ? .85 + s * .19 : .7 + s * .2;                            // strides per second
  a.phase = (a.phase + dt * cycle) % 1;
  const amp = smooth(.05, 1.4, s) * (kind === 'horse' ? .42 + fastW * .35 : .48 + fastW * .3), air = a.air;
  const patterns = kind === 'horse' ? [[GAITS.walk, walkW], [GAITS.trot, midW], [GAITS.gallop, fastW]] : [[GAITS.walk, walkW + midW], [GAITS.bound, fastW]];
  rig.legs.forEach((l, i) => {
    let swing = 0, bend = 0;
    for (const [offs, w] of patterns) { if (w <= 0) continue; const t = TAU * (a.phase + offs[i]); swing += w * Math.sin(t); bend += w * Math.max(0, Math.sin(t + (l.front ? 1.3 : -1.1))); }
    const tuck = air * (l.front ? -.7 : .8);
    l.hip.rotation.x = swing * amp + tuck;
    l.knee.rotation.x = (l.front ? 1 : -1) * (bend * amp * 1.5 + air * 1.1);
  });
  // Body: a bob twice per stride, a rocking pitch at the gallop/bound, a lean into turns.
  const bob = Math.abs(Math.sin(TAU * a.phase)) * amp * (kind === 'horse' ? .1 : .07);
  rig.body.position.y = bob - amp * .04 + air * .05;
  rig.body.rotation.x = fastW * Math.sin(TAU * a.phase) * .09 - air * .08;
  rig.body.rotation.z = clamp(-a.turn * s * .03, -.12, .12);
  const breathe = Math.sin(a.t * 1.7) * .012;
  rig.body.scale.set(1 + breathe * .5, 1 + breathe, 1);
  // Head and neck: nod with the stride; graze or look about when left standing.
  const still = 1 - smooth(.1, .8, s), graze = still * (a.ridden ? 0 : smooth(.2, .8, Math.sin(a.t * .23 + a.seed * 7) * .5 + .5));
  if (rig.neck) {
    rig.neck.rotation.x = rig.neckRest + Math.sin(TAU * a.phase * 2) * amp * .12 - fastW * .2 + graze * -1.15;
    rig.head.rotation.x = rig.headRest - graze * .5 + Math.sin(a.t * .9) * still * .05;
    rig.neck.rotation.y = still * (1 - graze) * Math.sin(a.t * .37 + a.seed) * .35;
  } else {
    rig.head.rotation.x = Math.sin(TAU * a.phase * 2) * amp * .1 + graze * .45;
    rig.head.rotation.y = still * Math.sin(a.t * .41 + a.seed) * .4;
    rig.head.position.y = 1.04 - graze * .2;
  }
  // Tail: a horse swishes; a tiger's tail curls and sways link by link.
  if (rig.tailLinks.length) rig.tailLinks.forEach((link, k) => {
    link.rotation.y = Math.sin(a.t * 1.6 - k * .7 + a.seed) * (.16 + still * .1);
    if (k) link.rotation.x = -.12 - fastW * .05 + Math.sin(a.t * 1.1 - k * .5) * .05 + (k > 3 ? -.25 * still : 0);
  });
  else { rig.tail.rotation.z = Math.sin(a.t * 2.3 + a.seed) * (.12 + still * .2); rig.tail.rotation.x = -fastW * .55 - air * .4; }
}

export function createMountView({scene, height = () => 0}) {
  const root = new THREE.Group(); root.name = 'mounts'; scene.add(root);
  const live = new Map();
  let snapshot = null;
  const rigFor = m => {
    const rig = m.kind === 'tiger' ? buildTiger() : buildHorse(m.v || 0);
    root.add(rig.root);
    return {rig, anim: {speed: 0, phase: Math.random(), t: 0, seed: (m.id.length * 1.7 + (m.v || 0)) % 6, turn: 0, air: 0, ridden: false},
      pos: new THREE.Vector3().fromArray(m.position), yaw: m.yaw, last: new THREE.Vector3().fromArray(m.position), data: m};
  };
  return {
    /** riderAt(id) gives the drawn feet position of a rider (local prediction or remote smoothed root). */
    update(dt, snap, {riderAt = () => null, camera = null} = {}) {
      snapshot = snap; const list = snap?.mounts || [], seen = new Set();
      for (const m of list) {
        seen.add(m.id);
        let e = live.get(m.id); if (!e || e.data.kind !== m.kind) { if (e) { root.remove(e.rig.root); } e = rigFor(m); live.set(m.id, e); }
        e.data = m;
        const at = m.rider ? riderAt(m.rider) : null;
        if (at) e.pos.copy(at);
        else e.pos.lerp(_p.fromArray(m.position), 1 - Math.exp(-dt * 10));
        const ground = height(e.pos.x, e.pos.z);
        // Speed and heading from what is drawn, so a ridden mount turns with its rider's predicted path.
        const dx = e.pos.x - e.last.x, dz = e.pos.z - e.last.z, d = Math.hypot(dx, dz), v = dt > 0 ? Math.min(d / dt, 14) : 0;
        e.anim.speed += (v - e.anim.speed) * (1 - Math.exp(-dt * 6));
        const want = d > .002 && e.anim.speed > .4 ? Math.atan2(-dx, -dz) : (m.rider ? e.yaw : m.yaw);
        const turn = wrap(want - e.yaw), step = turn * (1 - Math.exp(-dt * (m.rider ? 7 : 4)));
        e.yaw = wrap(e.yaw + step); e.anim.turn += ((dt > 0 ? step / dt : 0) - e.anim.turn) * (1 - Math.exp(-dt * 5));
        e.anim.air = smooth(.15, .7, (e.pos.y - (Number.isFinite(ground) ? ground : e.pos.y)));
        e.anim.ridden = !!m.rider; e.anim.t += dt; e.last.copy(e.pos);
        e.rig.root.position.copy(e.pos); e.rig.root.rotation.y = e.yaw;
        const far = camera ? camera.position.distanceToSquared(e.pos) > DRAW_RANGE * DRAW_RANGE : false;
        e.rig.root.visible = !far;
        if (!far) pose(e.rig, e.anim, dt);
      }
      for (const [id, e] of live) if (!seen.has(id)) { root.remove(e.rig.root); live.delete(id); }
    },
    /** Drawn heading of the mount this player rides (remote riders sit facing it), or null. */
    yawOf(playerId) { for (const e of live.values()) if (e.data.rider === playerId) return e.yaw; return null; },
    seatOf(playerId) { const m = snapshot?.mounts?.find(q => q.rider === playerId); return m ? MOUNT.kinds[m.kind].seat : 0; },
    stats() { return {mounts: live.size, ridden: [...live.values()].filter(e => e.data.rider).length}; },
    dispose() { scene.remove(root); root.traverse(n => n.geometry?.dispose()); live.clear(); },
  };
}
// Exposed for the model sheet and tests.
export {buildHorse, buildTiger, pose as poseMount};
