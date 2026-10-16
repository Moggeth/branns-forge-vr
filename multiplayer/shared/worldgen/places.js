// Places composed from the asset kits: settlements, discoveries and cave mouths in a generated world.
// Deterministic per world (stable ids, no state), shared by the renderer (what to draw) and the simulation (what you
// bump into), so what a Hero sees is what they collide with. Pieces name a node in a Blender kit:
//   town      town_kit.glb      D_Tavern, D_Quartermaster, D_Mill (+ sails)
//   backtown  backtown_kit.glb  D_Workshop, D_Stores, D_Cottage, D_CottageB, D_Well, D_Lantern
//   landmarks landmarks_kit.glb Menhir_A-D, Post_A/B, Lintel, Altar, Rubble_A-C, Moss_A-C, MineHead, OreCart, Basket, Plinth, TuneCrystal, ...
// Each settlement kind and discovery kind is a recipe (what it is FOR), laid out on rings around its centre, facing
// in, nudged off roads and out of water.
import {hashInts, hash01} from './random.js';
import {sinQ, cosQ, atanQ2} from './generate.js';
import {resolveCrags} from './content.js';
const sq = v => v * v;

// Collision radius per piece (metres); 0 = walk through.
const RADIUS = {
  D_Tavern: 4.6, D_Quartermaster: 2.4, D_Mill: 3.2, D_Workshop: 3.3, D_Stores: 2.8, D_Cottage: 2.6, D_CottageB: 2.6, D_Well: 1.1, D_Lantern: .18,
  Menhir_A: .55, Menhir_B: .55, Menhir_C: .5, Menhir_D: .5, Post_A: .45, Post_B: .45, Lintel: 0, Altar: .9, Rubble_A: .7, Rubble_B: .6, Rubble_C: .5,
  Moss_A: 0, Moss_B: 0, Moss_C: 0, MineHead: 2.2, OreCart: .8, Basket: .35, Plinth: .7, TuneCrystal: .4, Tower: 1.6, Voussoir_Loose: .4,
};
const KIT = name => /^D_(Tavern|Quartermaster|Mill)/.test(name) ? 'town' : /^D_/.test(name) ? 'backtown' : 'landmarks';
// Recipes: [piece, ring (0 centre, 1 inner, 2 outer)]
const SETTLEMENT = {
  start: [['D_Tavern', 2], ['D_Quartermaster', 1], ['D_Well', 1], ['D_Cottage', 2], ['D_CottageB', 2], ['D_Cottage', 2], ['D_Stores', 2], ['D_Workshop', 2], ['D_CottageB', 2], ['D_Lantern', 1], ['D_Lantern', 1], ['D_Lantern', 1], ['D_Lantern', 1]],
  village: [['D_Well', 0], ['D_Tavern', 1], ['D_Cottage', 1], ['D_CottageB', 1], ['D_Cottage', 2], ['D_Lantern', 1], ['D_Lantern', 1]],
  harbour: [['D_Stores', 1], ['D_Cottage', 1], ['D_CottageB', 1], ['D_Quartermaster', 1], ['D_Lantern', 1], ['D_Lantern', 1], ['Basket', 1]],
  mill: [['D_Mill', 0], ['D_CottageB', 1], ['D_Well', 1], ['D_Lantern', 1]],
  fishery: [['D_Cottage', 1], ['D_Stores', 1], ['Basket', 1], ['D_Lantern', 1]],
  lumber: [['D_Workshop', 1], ['D_Cottage', 1], ['D_Lantern', 1], ['Basket', 1]],
  mine: [['MineHead', 0], ['OreCart', 1], ['D_Cottage', 1], ['D_Lantern', 1]],
  farm: [['D_CottageB', 0], ['D_Mill', 1], ['D_Well', 1], ['Basket', 1]],
};
const DISCOVERY = {
  ruin: [['Rubble_A', 0], ['Menhir_B', 1], ['Rubble_B', 1], ['Voussoir_Loose', 1], ['Moss_A', 1], ['Rubble_C', 1], ['Post_A', 1]],
  shrine: [['Altar', 0], ['Menhir_A', 1], ['Menhir_B', 1], ['Menhir_C', 1], ['Menhir_D', 1], ['Moss_B', 1]],
  grove: [['Plinth', 0], ['Moss_A', 1], ['Moss_C', 1], ['Menhir_C', 1]],
  camp: [['D_Lantern', 0], ['Basket', 1], ['Rubble_C', 1]],
  cache: [['Basket', 0], ['Rubble_B', 1], ['Moss_B', 1]],
};
const cache = new WeakMap();

/** Every placed piece in sim coordinates: [{id, kit, node, x, z, yaw, radius, owner, hidden?}] (cached per world; hidden = collider only). */
export function placesFor(world) {
  let out = cache.get(world); if (out) return out;
  out = []; const seed = world.gen.seedHash;
  const free = (x, z, r) => !world.isWater(x, z) && world.roadAt(x, z) > r + 1.2 && !out.some(p => sq(p.x - x) + sq(p.z - z) < sq(p.radius + r + .8)) && (x * x + z * z > 13 * 13 || r < .3);
  function compose(owner, cx, cz, recipe, inner, outer, salt) {
    const counts = [0, 0, 0], totals = [0, 0, 0]; for (const [, ring] of recipe) totals[ring]++;
    const turn = hash01(seed, salt, 1) * 6.2831853;
    recipe.forEach(([node, ring], k) => {
      const r = RADIUS[node] ?? .5, rr = ring === 0 ? 0 : ring === 1 ? inner : outer;
      for (let attempt = 0; attempt < 10; attempt++) {
        const a = turn + (counts[ring] + attempt * .37) / Math.max(1, totals[ring]) * 6.2831853 + (ring === 2 ? .3 : 0);
        const d = rr + attempt * (ring ? 1.3 : .8), x = cx + sinQ(a) * d, z = cz + cosQ(a) * d;
        if (!free(x, z, r)) continue;
        const yaw = ring === 0 ? hash01(seed, salt, k) * 6.2831853 : atanQ2(cx - x, cz - z);
        out.push({id: `${owner}p${k}`, kit: KIT(node), node, x, z, yaw, radius: r, owner}); break;
      }
      counts[ring]++;
    });
  }
  world.settlements.forEach((s, i) => {
    const recipe = s.start ? SETTLEMENT.start : SETTLEMENT[s.kind] || SETTLEMENT.village;
    compose(s.id, s.x, s.z, recipe, s.start ? 17 : Math.max(8, s.radius * .3), s.start ? 27 : Math.max(13, s.radius * .42), hashInts(seed, 300, i));
  });
  world.discoveries.forEach((d, i) => compose(d.id, d.x, d.z, DISCOVERY[d.kind] || DISCOVERY.ruin, 3.2, 5, hashInts(seed, 310, i)));
  // Cave mouths: the Underways draw a timbered portal there (client/underways/portal.js); its two posts stand 1.45 m
  // either side of the mouth (.8 m out from the entrance point, set .25 m back into the hill). Invisible colliders
  // sit on those posts so a Hero bumps the timber they see.
  for (const e of world.entrances) {
    const [dx, dz] = e.cliffDir || [0, 1], len = Math.sqrt(dx * dx + dz * dz) || 1, fx = dx / len, fz = dz / len, sx = -fz, sz = fx;
    const mx = e.x - fx * .55, mz = e.z - fz * .55, yaw = atanQ2(-fx, -fz);
    out.push({id: `${e.id}pL`, kit: 'landmarks', node: 'Post_A', x: mx + sx * 1.45, z: mz + sz * 1.45, yaw, radius: .3, owner: e.id, hidden: true});
    out.push({id: `${e.id}pR`, kit: 'landmarks', node: 'Post_B', x: mx - sx * 1.45, z: mz - sz * 1.45, yaw, radius: .3, owner: e.id, hidden: true});
  }
  out = Object.freeze(out.map(Object.freeze)); cache.set(world, out);
  const grid = new Map();
  for (const p of out) if (p.radius > 0) { const k = `${Math.floor(p.x / 32)},${Math.floor(p.z / 32)}`; (grid.get(k) || grid.set(k, []).get(k)).push(p); }
  grids.set(out, grid);
  return out;
}
const grids = new WeakMap();
/** Push a walker out of every solid piece it overlaps (a cylinder per piece), then out of the crags. */
export function resolvePlaces(world, position, radius = .28) {
  if (!world) return position;
  const grid = grids.get(placesFor(world)), gx = Math.floor(position[0] / 32), gz = Math.floor(position[2] / 32);
  for (let j = gz - 1; j <= gz + 1; j++) for (let i = gx - 1; i <= gx + 1; i++) for (const p of grid.get(`${i},${j}`) || []) {
    const dx = position[0] - p.x, dz = position[2] - p.z, min = p.radius + radius, d2 = dx * dx + dz * dz;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2) || 1e-6; position[0] = p.x + dx / d * min; position[2] = p.z + dz / d * min;
  }
  return resolveCrags(world, position, radius); // and the land's own rock (tors, outcrops, boulders, spires)
}
/** Pieces within `radius` of (x, z) (renderer streaming). */
export function placesNear(world, x, z, radius) { const r2 = radius * radius; return placesFor(world).filter(p => sq(p.x - x) + sq(p.z - z) <= r2); }
