// Town life: the townsfolk, lived-in clutter and warm lantern light that make the keeps, back towns and The Muddled
// Mug feel inhabited, in the spirit of the Quartermaster stall. Dawnhold is kept by round-faced humans, Grumblekeep
// by big-eared goblins, and the Mug serves everyone. A shopkeep waves from behind the counter, barkeeps polish the
// bar, regulars lift their mugs, the smith hammers at the anvil, someone winds the well and a couple of folk stroll
// the square and the yard. Lantern posts line the roads between keep, Forge and tavern, and every lamp, hearth and
// stall lantern throws a soft warm halo and a pool of light on the ground that swells at dusk.
// Presentation only (no collision, raycasts or shadows); placed from the shared keep layout, animated every frame on
// the frame clock. Cheap: everything is instanced, about twenty draws for the lot.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import * as HOME from '../shared/home-bases.js';
const {homePiece, homePoint, pieceWorld} = HOME;
// Taverns may draw larger than the kit (TAVERN_SCALE); everything dressed in a tavern's frame scales with it.
const tavernScale = () => HOME.TAVERN_SCALE ?? 1;
const neutralTavern = () => ({...HOME.neutralTavern(), s: tavernScale()});
const tavernPiece = side => ({...homePiece(side, 'tavern'), s: tavernScale()});
import {BACK_TOWN_LANTERNS, MAIN_ROAD, backTownPiece, backTownPoint} from '../shared/keep-sites.js';
import {terrainHeight} from '../shared/terrain.js';
import {SQUARE_PIECES, squarePiece} from '../shared/town-square.js';

const TAU = Math.PI * 2;
const SIDE_KEYS = ['party', 'rivals'];

// ---------------------------------------------------------------- geometry helpers
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
function part(geo, color, [x, y, z] = [0, 0, 0], [sx, sy, sz] = [1, 1, 1], [rx, ry, rz] = [0, 0, 0]) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(_m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz)));
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
const merge = parts => { const g = mergeGeometries(parts); for (const p of parts) p.dispose(); g.computeBoundingSphere(); return g; };
const SPH = new THREE.SphereGeometry(1, 12, 9), SPH_LO = new THREE.SphereGeometry(1, 7, 5), CYL = new THREE.CylinderGeometry(1, 1, 1, 10),
  CYL_LO = new THREE.CylinderGeometry(1, 1, 1, 6), BOX = new THREE.BoxGeometry(1, 1, 1), CONE = new THREE.ConeGeometry(1, 1, 10),
  TORUS = new THREE.TorusGeometry(1, .28, 6, 14);
const BELL = new THREE.LatheGeometry([[0, .14], [.27, .16], [.3, .3], [.26, .55], [.2, .7], [.12, .8], [0, .83]].map(([x, y]) => new THREE.Vector2(x, y)), 12);

// ---------------------------------------------------------------- townsfolk
// Variants: robe, apron, skin, boots and a few signature bits. Feet at the origin, facing +Z, about 1.25 m tall.
const FOLK = {
  keeper: {robe: 0x2f63c4, apron: 0xf4e3bd, skin: 0xf0c49c, hat: 'cap', hatColor: 0xd9a441, extra: 'mustache', hair: 0x6a4127},
  barkeep: {robe: 0x8c4f2c, apron: 0xfaf4e6, skin: 0xe2a77e, hat: 'ringhair', hair: 0x3b2618, extra: 'bigmustache'},
  smith: {robe: 0x5d5047, apron: 0x3b2a1f, skin: 0xd99a72, hat: 'bandana', hatColor: 0xc8402e, extra: 'beard', hair: 0xc4622c},
  folk: {robe: 0x4f9a54, apron: 0xf0dfae, skin: 0xf3cfa8, hat: 'bun', hair: 0x8a5a2e, extra: 'kerchief', hatColor: 0xf2c64a},
  goblin: {robe: 0x6f3d93, apron: 0x6a4630, skin: 0x93c650, hat: 'pointy', hatColor: 0x43275a, extra: 'ears', goblin: true},
  goblin2: {robe: 0x433a40, apron: 0x9c6a34, skin: 0x7fb043, hat: 'topknot', hair: 0x2a2026, extra: 'ears', goblin: true},
  // The town square's stall keepers (shared/town-square.js): a floury baker, a drill coach with a whistle, a bard.
  baker: {robe: 0xf3ead8, apron: 0xd96a4a, skin: 0xf2c09a, hat: 'chef', hatColor: 0xffffff, extra: 'mustache', hair: 0x8a5a2e},
  coach: {robe: 0x2f63c4, apron: 0x6a4630, skin: 0xd99a72, hat: 'helm', hatColor: 0xb8b8c2, extra: 'beard', hair: 0xe8d6b0},
  bard: {robe: 0x8d3fb0, apron: 0xf2c64a, skin: 0xf3cfa8, hat: 'feather', hatColor: 0x2e7d6a, extra: 'kerchief', hair: 0x6a4127},
  gobbaker: {robe: 0x5c7a3a, apron: 0x6f3d93, skin: 0x93c650, hat: 'chef', hatColor: 0xe8e4d8, extra: 'ears', goblin: true},
  gobbard: {robe: 0x6f3d93, apron: 0x8fd04a, skin: 0x7fb043, hat: 'feather', hatColor: 0x8fd04a, extra: 'ears', goblin: true},
  kid: {robe: 0xf2a33a, apron: 0xfaf4e6, skin: 0xe2a77e, hat: 'bun', hair: 0x3b2618, extra: 'kerchief', hatColor: 0x4f9a54},
};
const SHOULDER = [.2, .7, 0], FOLK_SCALE = 1.18; // chunky, but tall enough to see over a counter
function folkBody(v) {
  const P = [], dark = 0x2b211b, boots = v.goblin ? 0x3b2a1f : 0x4a3424, cheek = v.goblin ? 0xb7d870 : 0xf29a8a;
  for (const s of [-1, 1]) P.push(part(CYL_LO, boots, [s * .09, .08, .03], [.075, .16, .085]), part(SPH_LO, boots, [s * .09, .03, .09], [.08, .05, .11]));
  P.push(part(BELL, v.robe));
  P.push(part(BOX, v.apron, [0, .4, .245], [.34, .44, .03], [-.12, 0, 0]));
  P.push(part(CYL, dark, [0, .55, 0], [.255, .05, .255]));
  P.push(part(SPH_LO, 0xe0b04a, [0, .55, .25], [.035, .03, .02]));
  // left arm, resting
  P.push(part(CYL_LO, v.robe, [-.25, .55, .02], [.06, .3, .06], [0, 0, -.18]), part(SPH_LO, v.skin, [-.29, .38, .03], [.065, .065, .065]));
  // head
  const hy = 1.0;
  P.push(part(SPH, v.skin, [0, hy, 0], [.21, .2, .2]));
  P.push(part(SPH_LO, v.goblin ? 0x7aa83e : 0xe89a80, [0, hy - .03, .2], v.goblin ? [.05, .045, .1] : [.055, .05, .055]));
  for (const s of [-1, 1]) {
    P.push(part(SPH_LO, dark, [s * .075, hy + .045, .175], [.028, .034, .02]));
    P.push(part(SPH_LO, 0xffffff, [s * .068, hy + .055, .19], [.009, .009, .006]));
    P.push(part(SPH_LO, cheek, [s * .12, hy - .035, .15], [.04, .03, .02]));
  }
  if (v.extra === 'ears') for (const s of [-1, 1]) P.push(part(CONE, v.skin, [s * .27, hy + .04, -.02], [.06, .2, .035], [0, 0, -s * 1.25]));
  if (v.extra === 'mustache') for (const s of [-1, 1]) P.push(part(SPH_LO, v.hair, [s * .045, hy - .08, .19], [.05, .022, .025], [0, 0, s * .25]));
  if (v.extra === 'bigmustache') for (const s of [-1, 1]) P.push(part(SPH_LO, v.hair, [s * .07, hy - .085, .185], [.085, .03, .035], [0, 0, s * .4]));
  if (v.extra === 'beard') P.push(part(SPH, v.hair, [0, hy - .12, .1], [.17, .14, .13]));
  if (v.extra === 'kerchief') P.push(part(CONE, v.hatColor, [0, .79, .08], [.16, .14, .05], [Math.PI, 0, 0]));
  if (v.hat === 'cap') P.push(part(CYL, v.hatColor, [0, hy + .16, 0], [.2, .08, .2]), part(CYL, v.hatColor, [0, hy + .125, .08], [.2, .02, .18]), part(SPH_LO, v.hair, [0, hy + .07, -.05], [.2, .12, .17]));
  if (v.hat === 'ringhair') P.push(part(TORUS, v.hair, [0, hy + .04, -.01], [.17, .17, .19], [Math.PI / 2, 0, 0]));
  if (v.hat === 'bandana') P.push(part(SPH, v.hatColor, [0, hy + .06, -.01], [.215, .17, .21]), part(SPH_LO, v.hatColor, [0, hy + .04, -.22], [.05, .05, .05]));
  if (v.hat === 'bun') P.push(part(SPH, v.hair, [0, hy + .05, -.03], [.215, .18, .2]), part(SPH_LO, v.hair, [0, hy + .2, -.1], [.08, .08, .08]));
  if (v.hat === 'pointy') P.push(part(CONE, v.hatColor, [.02, hy + .3, -.02], [.2, .38, .2], [-.12, 0, -.15]), part(CYL, v.hatColor, [0, hy + .12, 0], [.25, .03, .25]));
  if (v.hat === 'chef') P.push(part(CYL, v.hatColor, [0, hy + .2, -.01], [.17, .2, .17]), part(SPH, v.hatColor, [0, hy + .33, -.01], [.23, .12, .23]));
  if (v.hat === 'helm') P.push(part(SPH, v.hatColor, [0, hy + .06, -.01], [.225, .19, .22]), part(CYL, v.hatColor, [0, hy + .02, -.01], [.25, .03, .25]), part(CONE, 0xd94a3a, [0, hy + .3, -.02], [.05, .14, .05]));
  if (v.hat === 'feather') P.push(part(CYL, v.hatColor, [0, hy + .14, 0], [.2, .1, .2]), part(CYL, v.hatColor, [0, hy + .1, .02], [.27, .02, .27]), part(CONE, 0xf2c64a, [-.16, hy + .32, -.05], [.03, .38, .015], [-.4, 0, .5]));
  if (v.hat === 'topknot') P.push(part(SPH_LO, v.hair, [0, hy + .2, -.02], [.06, .1, .06]), part(TORUS, 0xd2a64a, [0, hy + .14, -.02], [.05, .05, .05], [Math.PI / 2, 0, 0]));
  return merge(P);
}
// The right arm, pivoting at the shoulder, hanging down -Y.
const folkArm = v => merge([part(CYL_LO, v.robe, [0, -.15, 0], [.062, .3, .062]), part(SPH_LO, v.skin, [0, -.33, 0], [.068, .068, .068])]);
// The bard's lute, held across the body: a pear-shaped bowl, a neck and a bent-back peg box.
const luteGeo = () => merge([part(SPH, 0xb5763c, [0, 0, 0], [.17, .22, .06]), part(CYL_LO, 0x2b211b, [0, .02, .055], [.045, .005, .045], [Math.PI / 2, 0, 0]),
  part(BOX, 0x6a4628, [0, .34, 0], [.045, .32, .03]), part(BOX, 0x5e4229, [0, .52, -.03], [.06, .1, .03], [-.6, 0, 0])]);
const mugGeo = () => merge([part(CYL_LO, 0x9a6a3e, [0, .07, 0], [.06, .14, .06]), part(CYL_LO, 0xfff4dc, [0, .15, 0], [.062, .03, .062]), part(TORUS, 0x6a4628, [.07, .07, 0], [.035, .035, .035])]);

// ---------------------------------------------------------------- props
const WOOD = 0x8a6440, WOOD_D = 0x5e4229, IRON = 0x4b4a4f;
const PROPS = {
  barrel: () => merge([part(CYL, WOOD, [0, .4, 0], [.3, .8, .3]), part(CYL, 0x9a7048, [0, .4, 0], [.33, .5, .33]), ...[.12, .68].map(y => part(CYL, IRON, [0, y, 0], [.315, .05, .315])), part(CYL, WOOD_D, [0, .805, 0], [.27, .01, .27])]),
  crate: () => merge([part(BOX, 0xa57a4c, [0, .3, 0], [.6, .6, .6]), ...[-1, 1].flatMap(s => [part(BOX, WOOD_D, [s * .29, .3, 0], [.04, .62, .62]), part(BOX, WOOD_D, [0, .3, s * .29], [.62, .62, .04])]), part(BOX, WOOD_D, [0, .3, .305], [.08, .8, .02], [0, 0, .78])]),
  planter: () => {
    const P = [part(BOX, 0x6a4630, [0, .2, 0], [1.1, .4, .42]), ...[-1, 1].map(s => part(BOX, 0x4a3320, [s * .52, .2, 0], [.07, .42, .45])), part(BOX, 0x4a3320, [0, .41, 0], [1.02, .03, .36])];
    const blooms = [0xff6f8e, 0xffd24a, 0xffffff, 0x9a7bff, 0xff8a3a];
    for (let i = 0; i < 9; i++) { const x = -.42 + i * .105, z = (i % 2 ? .07 : -.08); P.push(part(SPH_LO, 0x4f8f3a, [x, .48, z], [.09, .08, .09]), part(SPH_LO, blooms[i % blooms.length], [x + .02, .56 + (i % 3) * .03, z + .03], [.05, .045, .05])); }
    return merge(P);
  },
  bench: () => merge([part(BOX, 0x8a6440, [0, .42, 0], [1.5, .07, .38]), ...[-1, 1].map(s => part(BOX, WOOD_D, [s * .6, .2, 0], [.08, .4, .32])), part(BOX, 0x8a6440, [0, .72, -.17], [1.5, .2, .05])]),
  woodpile: () => {
    const P = [];
    for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) P.push(part(CYL_LO, i % 2 ? 0x9a7048 : 0x7d5a38, [-.42 + i * .28 + r * .14, .13 + r * .23, 0], [.12, .9, .12], [Math.PI / 2, 0, 0]), part(CYL_LO, 0xe8c99a, [-.42 + i * .28 + r * .14, .13 + r * .23, .452], [.11, .01, .11], [Math.PI / 2, 0, 0]));
    return merge(P);
  },
  sacks: () => merge([part(SPH, 0xd8c08e, [0, .25, 0], [.26, .28, .22]), part(SPH, 0xcdb27c, [.38, .22, .08], [.24, .24, .2]), part(SPH, 0xe0caa0, [.18, .5, .02], [.22, .2, .19]), ...[[0, .5, 0], [.38, .44, .08]].map(p => part(CYL_LO, 0x8a6a3e, p, [.07, .06, .07]))]),
};
const LANTERN_POST = () => merge([part(CYL_LO, WOOD_D, [0, 1.15, 0], [.07, 2.3, .07]), part(BOX, WOOD_D, [0, .06, 0], [.34, .12, .34]), part(BOX, WOOD_D, [0, 2.28, .25], [.06, .06, .62]),
  part(CYL_LO, IRON, [0, 2.2, .52], [.015, .1, .015]), part(CONE, IRON, [0, 2.15, .52], [.15, .1, .15]), part(CYL_LO, IRON, [0, 1.84, .52], [.13, .03, .13])]);
const LANTERN_GLASS = () => merge([part(CYL_LO, 0xffffff, [0, 1.97, .52], [.1, .22, .1])]);
const LAMP_HEIGHT = 1.97, LAMP_REACH = .52;

// A soft round glow, built in code so it also works headless.
function glowTexture(n = 64) {
  const d = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i + .5) / n * 2 - 1, y = (j + .5) / n * 2 - 1, r = Math.min(1, Math.hypot(x, y)), a = Math.pow(1 - r, 2.2), o = (j * n + i) * 4;
    d[o] = 255; d[o + 1] = 255; d[o + 2] = 255; d[o + 3] = Math.round(a * 255);
  }
  const t = new THREE.DataTexture(d, n, n); t.needsUpdate = true; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; return t;
}

// ---------------------------------------------------------------- layout (pure, exported for tests)
// Townsfolk per site: [local x, local z, local yaw, role, Dawnhold/neutral variant, Grumblekeep variant, floor height].
const KEEP_FOLK = {
  quartermaster: [[-.55, .35, 0, 'wave', 'keeper', 'goblin', .42]],
  tavern: [[.8, -2.35, 0, 'wipe', 'barkeep', 'goblin2', .4], [1.05, -.95, Math.PI, 'drink', 'folk', 'goblin', .1], [-2.2, 1.55, Math.PI, 'drink', 'smith', 'goblin2', .1]],
  workshop: [[-.05, .5, .25, 'hammer', 'smith', 'goblin2', 0]],
  well: [[0, 1.3, Math.PI, 'crank', 'folk', 'goblin', 0]],
  bakery: [[.4, -1.15, 0, 'wave', 'baker', 'gobbaker', 0]],
  trainer: [[.2, -.45, .35, 'coach', 'coach', 'goblin2', 0]],
  stage: [[0, -.25, 0, 'strum', 'bard', 'gobbard', .4]],
};
const MUG_FOLK = [[-1, -3.25, 0, 'wipe', 'barkeep', .4], [.7, -1.85, Math.PI, 'drink', 'goblin'], [-1.9, -1.85, Math.PI, 'drink', 'folk'], [-3, 2.55, Math.PI, 'drink', 'smith'], [3, 2.55, Math.PI, 'chat', 'goblin2'], [3.4, 2.45, -2.3, 'chat', 'keeper']];
// Props per site: [kind, local x, local z, local yaw].
const KEEP_PROPS = {
  tavern: [['barrel', -4.75, -2.2, 0], ['barrel', -4.7, -1.45, .6], ['crate', 4.75, -2.1, .2], ['sacks', 4.8, -1.1, 1.2], ['planter', -4.3, 3.35, 0], ['planter', 4.3, 3.35, 0], ['bench', -2.3, 4.3, Math.PI]],
  quartermaster: [['planter', -3.2, 1.75, 0], ['planter', 3.2, 1.75, 0], ['crate', 3.25, -1.0, .4], ['crate', 3.3, -1.0, .1, .7], ['barrel', -3.15, -1.05, 0], ['sacks', -3.2, .1, .3]],
  mill: [['sacks', 2.7, 2.6, .4], ['sacks', 3.2, 1.6, 2], ['crate', -3.1, 1.5, .3]],
  workshop: [['woodpile', -3.8, .8, Math.PI / 2], ['crate', 3.5, -1.6, .3], ['barrel', 3.5, -.8, 0]],
  stores: [['crate', -3.1, 2.4, .5], ['barrel', 2.4, 2.9, 0]],
  cottage: [['planter', -1.6, 2.6, 0], ['woodpile', 2.85, -.2, -Math.PI / 2], ['bench', 1.35, 2.85, 0]],
  cottage2: [['planter', 1.6, 2.6, 0], ['barrel', -2.75, 1.4, 0], ['sacks', -2.8, .4, 1]],
  well: [['bench', 0, -2.1, 0]],
};
const MUG_PROPS = [['barrel', -6.3, -3, 0], ['barrel', -6.25, -2.25, .7], ['barrel', -6.9, -2.6, .2], ['woodpile', 6.35, -2.2, Math.PI / 2], ['crate', 6.3, 1.8, .3],
  ['planter', -6.1, 4.3, 0], ['planter', 6.1, 4.3, 0], ['bench', -3.4, 5.4, Math.PI], ['bench', 3.4, 5.4, Math.PI]];

/** Where every lantern post, townsperson, prop and glow goes, from the shared keep layout. Pure. */
export function townLifeLayout() {
  const folk = [], props = [], posts = [], glows = [], bunting = [];
  const place = (placed, [lx, lz], ly = 0) => { const k = placed.s ?? 1, [x, z] = pieceWorld(placed, [lx * k, lz * k]); return {x, z, y: ly * k}; };
  const sitePiece = (side, name) => SQUARE_PIECES.includes(name) ? squarePiece(side, name) : name === 'workshop' || name === 'stores' || name.startsWith('cottage') || name === 'well' ? backTownPiece(side, name) : name === 'tavern' ? tavernPiece(side) : homePiece(side, name);
  for (const side of SIDE_KEYS) {
    const evil = side === 'rivals';
    for (const [name, list] of Object.entries(KEEP_FOLK)) {
      const placed = sitePiece(side, name);
      for (const [lx, lz, yaw, role, dv, gv, floor] of list) folk.push({...place(placed, [lx, lz], floor), yaw: placed.yaw + yaw, role, variant: evil ? gv : dv, side});
    }
    for (const [name, list] of Object.entries(KEEP_PROPS)) {
      const placed = sitePiece(side, name);
      for (const [kind, lx, lz, yaw, stack] of list) props.push({kind, ...place(placed, [lx, lz], stack ? .6 : 0), yaw: placed.yaw + yaw, side});
    }
    // Strollers: one round the keep's square, one round the back town's yard.
    const ring = Array.from({length: 24}, (_, i) => homePoint(side, [Math.sin(i / 24 * TAU) * 6.2, Math.cos(i / 24 * TAU) * 6.2]));
    const yard = [[56, 55.5], [61.5, 55], [62, 60], [57.5, 61.5]].map(p => backTownPoint(side, p));
    folk.push({role: 'walk', variant: evil ? 'goblin2' : 'folk', side, route: ring, speed: .9, x: ring[0][0], z: ring[0][1], y: 0, yaw: 0});
    folk.push({role: 'walk', variant: evil ? 'goblin' : 'keeper', side, route: ring, speed: .75, x: ring[0][0], z: ring[0][1], y: 0, yaw: 0, offset: 19});
    folk.push({role: 'walk', variant: evil ? 'goblin2' : 'kid', side, route: [...ring].reverse(), speed: 1.4, x: ring[0][0], z: ring[0][1], y: 0, yaw: 0, offset: 9, small: true});
    folk.push({role: 'walk', variant: evil ? 'goblin' : 'keeper', side, route: yard, speed: .7, x: yard[0][0], z: yard[0][1], y: 0, yaw: 0, offset: 7});
    // Lantern posts: flanking the gate road, the square and the mouth of the pass.
    for (const [lx, ly, face] of [[2.3, 13, -1], [-2.3, 13, 1], [2.1, -10.5, -1], [-2.1, -10.5, 1]]) {
      const [x, z] = homePoint(side, [lx, ly]), [fx, fz] = homePoint(side, [lx + face, ly]);
      posts.push({x, z, yaw: Math.atan2(fx - x, fz - z), side});
    }
    // Hearths, stall lanterns and the back town's own lantern posts glow too.
    const tav = tavernPiece(side); glows.push({...place(tav, [-3.75, -.8], .7), size: 2.6, pool: 3.4});
    const qm = homePiece(side, 'quartermaster'); for (const s of [-1, 1]) glows.push({...place(qm, [s * 2.15, 1.95], 2.55), size: 1.4, pool: 2.6});
    BACK_TOWN_LANTERNS.forEach(at => {
      const [x, z] = backTownPoint(side, at), [cx, cz] = backTownPoint(side, [(at[0] + at[1]) / 2, (at[0] + at[1]) / 2]);
      const yaw = Math.hypot(cx - x, cz - z) > .1 ? Math.atan2(cx - x, cz - z) : 0;
      glows.push({x: x + Math.sin(yaw) * .55, z: z + Math.cos(yaw) * .55, y: 2.15, size: 1.5, pool: 3});
    });
    const ws = backTownPiece(side, 'workshop'); glows.push({...place(ws, [-1.3, -.2], .8), size: 2.2, pool: 3.2});
    // Bunting across the tavern front.
    bunting.push({a: place(tav, [-3.8, 2.85], 2.9), b: place(tav, [3.8, 2.85], 2.9), colours: evil ? [0x6f3d93, 0x8fd04a, 0x3a3134] : [0x2f6fd0, 0xf2c64a, 0xffffff], sag: .55});
    const back = backTownPiece(side, 'stores'), cot = backTownPiece(side, 'cottage');
    bunting.push({a: place(back, [2.4, 1.6], 3), b: place(cot, [-2.1, 1.9], 2.9), colours: evil ? [0x8fd04a, 0x6f3d93] : [0xff6f8e, 0xf2c64a, 0x2f6fd0, 0x4f9a54], sag: .7});
  }
  // The roads: posts every ~8 m along each gate road to the Forge and the footpaths to The Muddled Mug.
  const road = (pts, every, offset) => {
    let next = every * .5, walked = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i], len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
      for (; next <= walked + len; next += every) {
        const d = next - walked, s = posts.length % 2 ? 1 : -1, x = ax + dx * d - dz * offset * s, z = az + dz * d + dx * offset * s;
        posts.push({x, z, yaw: Math.atan2(dz * s, -dx * s)}); // the lamp arm reaches over the road
      }
      walked += len;
    }
  };
  road([homePoint('party', [0, 17.5]), ...MAIN_ROAD.points, homePoint('rivals', [0, 17.5])], 7.5, 2.1);
  const mug = neutralTavern(), door = [mug.x + Math.sin(mug.yaw) * 4.6 * mug.s, mug.z + Math.cos(mug.yaw) * 4.6 * mug.s];
  road([[-15.5, -16], [-12, -22.5], [-4, -23.6], door], 7, 1.9);
  road([[2.6, -12], [4.2, -18.5], [door[0], door[1] + 2]], 7, 1.9);
  for (const [lx, lz, yaw, role, variant, floor = .1] of MUG_FOLK) folk.push({...place(mug, [lx, lz], floor), yaw: mug.yaw + yaw, role, variant, side: 'neutral'});
  for (const [kind, lx, lz, yaw] of MUG_PROPS) props.push({kind, ...place(mug, [lx, lz], 0), yaw: mug.yaw + yaw, side: 'neutral'});
  glows.push({...place(mug, [5.2, 0], .7), size: 3, pool: 4});
  bunting.push({a: place(mug, [-5.3, 3.85], 3.3), b: place(mug, [5.3, 3.85], 3.3), colours: [0xd08a2f, 0x2f6fd0, 0x8fd04a, 0xff6f8e, 0xf2c64a], sag: .7});
  // No post inside a building: drop any that a road brought too close to the Mug.
  for (let i = posts.length - 1; i >= 0; i--) if (Math.hypot(posts[i].x - mug.x, posts[i].z - mug.z) < 7.5 * mug.s) posts.splice(i, 1);
  for (const p of posts) { const r = p.yaw; glows.push({x: p.x + Math.sin(r) * LAMP_REACH, z: p.z + Math.cos(r) * LAMP_REACH, y: LAMP_HEIGHT, size: 1.6, pool: 3.2}); }
  return {folk, props, posts, glows, bunting};
}

// ---------------------------------------------------------------- the view
export function createTownLife({scene}) {
  const root = new THREE.Group(); root.name = 'town-life'; root.visible = false; scene.add(root);
  const L = townLifeLayout();
  let snapshot = null, enabled = false, placed = false, night = 0;
  const flat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .78, metalness: 0, flatShading: true});
  const skinMat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .62, metalness: 0});
  const glassMat = new THREE.MeshStandardMaterial({color: 0xffd08a, emissive: 0xffa040, emissiveIntensity: 1.6, roughness: .4});
  const disposables = [flat, skinMat, glassMat];
  const instanced = (geo, material, count, name, animated = false) => {
    const m = new THREE.InstancedMesh(geo, material, Math.max(1, count)); m.count = count; m.name = name; m.raycast = () => {}; m.castShadow = false; m.receiveShadow = false;
    m.frustumCulled = !animated; if (animated) m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(m); disposables.push(geo); return m;
  };

  // Townsfolk: one body batch and one arm batch per variant; drinkers and barkeeps hold a mug.
  const folk = L.folk.map((f, i) => ({...f, phase: (i * 1.618) % 1 * 10 + (f.offset || 0), dist: 0, curYaw: f.yaw}));
  const byVariant = new Map();
  for (const f of folk) { if (!byVariant.has(f.variant)) byVariant.set(f.variant, []); byVariant.get(f.variant).push(f); }
  const batches = [...byVariant].map(([key, list]) => {
    const v = FOLK[key], body = instanced(folkBody(v), skinMat, list.length, `townsfolk-${key}`, true), arm = instanced(folkArm(v), skinMat, list.length, `townsfolk-${key}-arm`, true);
    list.forEach((f, i) => { f.batch = {body, arm, i}; });
    return {body, arm, list};
  });
  const holders = folk.filter(f => f.role === 'drink');
  const mugs = instanced(mugGeo(), flat, holders.length, 'townsfolk-mugs', true);
  const strummers = folk.filter(f => f.role === 'strum');
  const lutes = instanced(luteGeo(), flat, strummers.length, 'townsfolk-lutes', true);
  // The square bard's tunes (shared/town-square.js square_tune): everyone on that side bobs along while it plays.
  const tunes = {party: -1, rivals: -1};
  let tClock = 0;
  const tuneLevel = side => { const end = tunes[side] ?? -1; return end > tClock ? Math.min(1, (end - tClock) / .6, (tClock - (end - 12)) / .4) : 0; };

  // Props: one batch per kind.
  const propBatches = Object.keys(PROPS).map(kind => ({kind, list: L.props.filter(p => p.kind === kind), mesh: null}));
  for (const b of propBatches) b.mesh = instanced(PROPS[b.kind](), flat, b.list.length, `town-${b.kind}`);
  const posts = instanced(LANTERN_POST(), flat, L.posts.length, 'town-lantern-posts');
  const glass = instanced(LANTERN_GLASS(), glassMat, L.posts.length, 'town-lantern-glass');

  // Bunting: little triangle flags on a sagging string, one static mesh.
  const buntingMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({vertexColors: true, side: THREE.DoubleSide, roughness: .85, flatShading: true}));
  buntingMesh.name = 'town-bunting'; buntingMesh.raycast = () => {}; root.add(buntingMesh); disposables.push(buntingMesh.geometry, buntingMesh.material);

  // Glows: an additive halo at each lamp and a pool of warm light on the ground beneath it.
  const glowTex = glowTexture(); disposables.push(glowTex);
  const haloGeo = new THREE.BufferGeometry(), haloPos = new Float32Array(L.glows.length * 3), haloSize = new Float32Array(L.glows.length);
  haloGeo.setAttribute('position', new THREE.BufferAttribute(haloPos, 3)); haloGeo.setAttribute('size', new THREE.BufferAttribute(haloSize, 1));
  const haloMat = new THREE.ShaderMaterial({
    uniforms: {map: {value: glowTex}, strength: {value: .3}, colour: {value: new THREE.Color(0xffb35a)}, scale: {value: 540}},
    vertexShader: 'attribute float size; uniform float scale; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * scale / max(.1, -mv.z), 0., 256.); }',
    fragmentShader: 'uniform sampler2D map; uniform float strength; uniform vec3 colour; void main(){ float a = texture2D(map, gl_PointCoord).a; gl_FragColor = vec4(colour * a * strength, 1.); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const halos = new THREE.Points(haloGeo, haloMat); halos.name = 'town-halos'; halos.frustumCulled = false; halos.raycast = () => {}; halos.renderOrder = 22; root.add(halos);
  disposables.push(haloGeo, haloMat);
  const poolGeo = new THREE.PlaneGeometry(1, 1); poolGeo.rotateX(-Math.PI / 2);
  const poolMat = new THREE.MeshBasicMaterial({map: glowTex, color: 0xffa04a, transparent: true, opacity: .2, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
  disposables.push(poolMat);
  const pools = instanced(poolGeo, poolMat, L.glows.length, 'town-light-pools'); pools.renderOrder = 3;

  const ground = (x, z) => snapshot ? terrainHeight(snapshot, x, z, false) : 0;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3(1, 1, 1), V = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  function placeStatic() {
    for (const b of propBatches) b.list.forEach((p, i) => { b.mesh.setMatrixAt(i, M.compose(V.set(p.x, ground(p.x, p.z) + p.y, p.z), Q.setFromAxisAngle(UP, p.yaw), S.setScalar(1))); });
    L.posts.forEach((p, i) => { M.compose(V.set(p.x, ground(p.x, p.z), p.z), Q.setFromAxisAngle(UP, p.yaw), S.setScalar(1)); posts.setMatrixAt(i, M); glass.setMatrixAt(i, M); });
    L.glows.forEach((g, i) => {
      const gy = ground(g.x, g.z); haloPos[i * 3] = g.x; haloPos[i * 3 + 1] = gy + g.y; haloPos[i * 3 + 2] = g.z; haloSize[i] = g.size;
      pools.setMatrixAt(i, M.compose(V.set(g.x, gy + .06, g.z), Q.identity(), S.set(g.pool, 1, g.pool)));
    });
    haloGeo.attributes.position.needsUpdate = true; haloGeo.attributes.size.needsUpdate = true; haloGeo.computeBoundingSphere();
    for (const m of [...propBatches.map(b => b.mesh), posts, glass, pools]) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
    for (const f of folk) if (!f.route) f.groundY = ground(f.x, f.z);
    buildBunting();
    placed = true;
  }
  function buildBunting() {
    const parts = [];
    for (const {a, b, colours, sag} of L.bunting) {
      const ay = ground(a.x, a.z) + a.y, by = ground(b.x, b.z) + b.y, len = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(4, Math.round(len / .42));
      const at = t => new THREE.Vector3(a.x + (b.x - a.x) * t, ay + (by - ay) * t - Math.sin(t * Math.PI) * sag, a.z + (b.z - a.z) * t);
      for (let k = 0; k < n; k++) {
        const t0 = (k + .12) / n, t1 = (k + .88) / n, p0 = at(t0), p1 = at(t1), tip = at((t0 + t1) / 2).add(new THREE.Vector3(0, -.3, 0));
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, tip.x, tip.y, tip.z], 3)); g.computeVertexNormals();
        const c = new THREE.Color(colours[k % colours.length]); g.setAttribute('color', new THREE.Float32BufferAttribute([c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b], 3));
        parts.push(g);
      }
    }
    const g = parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry(); for (const p of parts) p.dispose();
    buntingMesh.geometry.dispose(); buntingMesh.geometry = g;
  }

  function sync(s) {
    snapshot = s; const on = s?.battle?.v === 2 && s.battle.status === 'running';
    if (on !== enabled) { enabled = on; root.visible = on; }
    if (on && !placed) placeStatic();
  }
  function setNight(n) { night = Math.max(0, Math.min(1, +n || 0)); }

  // ---- animation: every frame on the frame clock
  const smooth = u => u * u * (3 - 2 * u);
  function pose(f, t) {
    const k = t + f.phase; let ax = -.08 + Math.sin(k * 1.3) * .05, az = .08, bob = 0, lean = 0;
    if (f.role === 'wave') { const u = (k % 8) / 8; if (u < .3) { const up = smooth(Math.min(1, Math.min(u, .3 - u) / .05)); az = .08 + up * 2.5 + up * Math.sin(k * 10) * .35; ax = -.2 * up; } }
    else if (f.role === 'wipe') { ax = -1.05 + Math.cos(k * 3.6) * .18; az = .3 + Math.sin(k * 3.6) * .28; lean = .1; }
    else if (f.role === 'hammer') { const u = (k % 1.15) / 1.15; ax = u < .72 ? -1 - 1.7 * smooth(u / .72) : -2.7 + 1.7 * smooth(Math.min(1, (u - .72) / .1)); bob = u > .8 && u < .9 ? -.03 : 0; lean = .08; }
    else if (f.role === 'drink') { const u = (k % 6) / 6; const up = u < .25 ? smooth(Math.min(1, Math.min(u, .25 - u) / .06)) : 0; ax = -.6 - up * 1.75; az = .12 + up * .25; lean = -up * .12; }
    else if (f.role === 'crank') { ax = -1.25 + Math.sin(k * 2.6) * .32; az = .25 + Math.cos(k * 2.6) * .25; lean = .1; }
    else if (f.role === 'strum') { const fast = tuneLevel(f.side); ax = -1.1 + Math.sin(k * (fast ? 14 : 3)) * (fast ? .22 : .08); az = .55; lean = -.04; }
    else if (f.role === 'coach') { const u = (k % 7) / 7; const up = u < .35 ? smooth(Math.min(1, Math.min(u, .35 - u) / .07)) : 0; ax = -.2 - up * 1.4; az = .1 + up * .1; lean = up * .05; }
    else if (f.role === 'chat') { ax = -.55 + Math.sin(k * 2.1) * Math.sin(k * .7) * .55; az = .2 + Math.max(0, Math.sin(k * 1.7)) * .4; }
    return {ax, az, bob, lean};
  }
  function walk(f, dt) {
    const r = f.route, n = r.length;
    let total = f.total; if (!total) { total = 0; for (let i = 0; i < n; i++) total += Math.hypot(r[(i + 1) % n][0] - r[i][0], r[(i + 1) % n][1] - r[i][1]); f.total = total; f.dist = (f.offset || 0) % total; }
    f.dist = (f.dist + f.speed * dt) % total;
    let d = f.dist, i = 0;
    for (; i < n; i++) { const a = r[i], b = r[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (d <= l) { const u = d / l; f.x = a[0] + (b[0] - a[0]) * u; f.z = a[1] + (b[1] - a[1]) * u; f.yaw = Math.atan2(b[0] - a[0], b[1] - a[1]); break; } d -= l; }
    let dy = f.yaw - f.curYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); f.curYaw += dy * (1 - Math.exp(-dt * 4));
    f.groundY = ground(f.x, f.z);
  }
  const ARM_Q = new THREE.Quaternion(), HAND = new THREE.Vector3(), SH = new THREE.Vector3(), bodyM = new THREE.Matrix4(), armM = new THREE.Matrix4();
  function update(dt, viewportHeight = 1080) {
    if (!enabled || !placed) return;
    haloMat.uniforms.scale.value = viewportHeight / 2;
    const t = performance.now() / 1000; dt = Math.min(.1, dt || 0);
    let h = 0, l = 0; tClock = t;
    for (const f of folk) {
      let ax, az, bob = 0, lean = 0, roll = 0;
      if (f.route) { walk(f, dt); const s = Math.sin((f.dist / .55) * Math.PI); ax = s * .5; az = .1; bob = Math.abs(s) * .045; roll = s * .05; }
      else ({ax, az, bob, lean} = pose(f, t));
      const dance = tuneLevel(f.side); if (dance) { bob += Math.abs(Math.sin((t + f.phase * .1) * 6.5)) * .07 * dance; roll += Math.sin(t * 3.25 + f.phase) * .09 * dance; }
      const yaw = f.route ? f.curYaw : f.yaw, breathe = 1 + Math.sin((t + f.phase) * 2.1) * .018, sc = f.small ? FOLK_SCALE * .72 : FOLK_SCALE;
      bodyM.compose(V.set(f.x, f.groundY + f.y + bob, f.z), Q.setFromEuler(E.set(lean, yaw, roll + Math.sin((t + f.phase) * 1.1) * .025, 'YXZ')), S.set(sc, breathe * sc, sc));
      f.batch.body.setMatrixAt(f.batch.i, bodyM);
      SH.set(...SHOULDER).multiplyScalar(sc); SH.y *= breathe; SH.applyMatrix4(M.compose(V.set(0, 0, 0), Q, S.set(1, 1, 1)));
      armM.compose(V.set(f.x + SH.x, f.groundY + f.y + bob + SH.y, f.z + SH.z), Q.multiply(ARM_Q.setFromEuler(E.set(ax, 0, az, 'XYZ'))), S.setScalar(sc));
      f.batch.arm.setMatrixAt(f.batch.i, armM);
      if (f.role === 'strum') { M.compose(V.set(0, .52, .2).applyMatrix4(bodyM), Q.setFromEuler(E.set(lean, yaw, roll - .9, 'YXZ')), S.setScalar(sc)); lutes.setMatrixAt(l++, M); }
      if (f.role === 'drink') { HAND.set(-.02, -.36, .06).applyMatrix4(armM); M.compose(HAND, Q.setFromAxisAngle(UP, yaw), S.set(1, 1, 1)); mugs.setMatrixAt(h++, M); }
    }
    for (const b of batches) { b.body.instanceMatrix.needsUpdate = true; b.arm.instanceMatrix.needsUpdate = true; }
    mugs.instanceMatrix.needsUpdate = true; lutes.instanceMatrix.needsUpdate = true;
    // Lamps glow a little by day and properly at dusk and night, with a gentle flame flicker.
    const flick = 1 + Math.sin(t * 7.3) * .05 + Math.sin(t * 13.1) * .03;
    haloMat.uniforms.strength.value = (.18 + night * .62) * flick;
    poolMat.opacity = (.04 + night * .3) * flick;
    glassMat.emissiveIntensity = (1.1 + night * 1.6) * flick;
  }

  function event(ev) { if (ev?.kind === 'square_tune' && (ev.side === 'party' || ev.side === 'rivals')) tunes[ev.side] = performance.now() / 1000 + 12; }
  return {sync, update, setNight, event, object: root,
    stats: () => ({enabled, placed, folk: folk.length, variants: batches.length, props: L.props.length, posts: L.posts.length, glows: L.glows.length, night: +night.toFixed(2), draws: root.children.length}),
    dispose() { root.removeFromParent(); for (const d of disposables) d.dispose?.(); }};
}
