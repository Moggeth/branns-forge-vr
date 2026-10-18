// World shapes. Each preset turns normalised coordinates (nx, nz in [-1, 1], north is -z) into a raw elevation in
// metres before erosion and drainage. Only + - * / and sqrt are used so every device computes identical bits.
// The generator then erodes, fills basins into lakes, drains, and places biomes, so presets describe *landforms*
// (where the land, mountains and coast are), never props.

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const len = (x, z) => Math.sqrt(x * x + z * z);
// Distance from (x,z) to the segment a->b, all normalised.
function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1), px = ax + dx * t - x, pz = az + dz * t - z;
  return Math.sqrt(px * px + pz * pz);
}
// A bent mountain chain through three seeded points: distance to the nearer of its two legs.
const chainDist = (x, z, c) => Math.min(segDist(x, z, c[0], c[1], c[2], c[3]), segDist(x, z, c[2], c[3], c[4], c[5]));

export const PRESETS = Object.freeze({
  continent: Object.freeze({
    id: 'continent', name: 'Heartland Continent', blurb: 'One great landmass: a mountain spine, long rivers, lakes and a ragged coast.',
    size: 4096, warmth: .62, wetness: 1, seaRatio: .3,
    setup(r) {
      const a = r.range(0, 6.2832), ca = cosApprox(a), sa = sinApprox(a);
      // The spine crosses the land off-centre so one side is broad lowland (rivers have room to grow long).
      const off = r.range(.15, .3);
      const chain = [-.55 * ca - sa * off, -.55 * sa + ca * off, r.range(-.15, .15) - sa * off * .4, r.range(-.15, .15) + ca * off * .4, .6 * ca - sa * off, .6 * sa + ca * off];
      return {chain, warp: [r.range(0, 99), r.range(0, 99)]};
    },
    elevation(nx, nz, n, s) {
      const wx = nx + .22 * n.fbm(nx * 1.6 + s.warp[0], nz * 1.6, 4), wz = nz + .22 * n.fbm(nx * 1.6, nz * 1.6 + s.warp[1], 4);
      const d = len(wx * .95, wz * 1.05), land = 1 - smooth(.5, .92, d);
      const rolling = n.fbm(nx * 3.2 + 7, nz * 3.2 - 3, 5);
      const cd = chainDist(wx, wz, s.chain), spine = 1 - smooth(.04, .34, cd);
      const peaks = n.ridged(nx * 3.4 + 40, nz * 3.4 - 12, 5);
      const hills = n.ridged(nx * 6 + 3, nz * 6 + 9, 4);
      return (land * 1.15 - .52) * 110 + 16 * rolling * land + land * (spine * (50 + 420 * peaks * spine) + 14 * hills * smooth(.2, .7, land));
    },
  }),
  archipelago: Object.freeze({
    id: 'archipelago', name: 'Sunscatter Isles', blurb: 'A warm sea of islands: volcanic peaks, lagoons, beaches and short swift streams.',
    size: 4096, warmth: .8, wetness: 1.15, seaRatio: .62,
    setup(r) {
      const isles = [];
      // One big home island near the middle, then a ring of smaller ones with a few large neighbours.
      isles.push([r.range(-.1, .1), r.range(-.1, .1), r.range(.4, .48), 1]);
      for (let i = 0; i < 18; i++) {
        const a = r.range(0, 6.2832), d = r.range(.36, .8);
        isles.push([cosApprox(a) * d, sinApprox(a) * d, r.range(.1, i < 5 ? .3 : .19), r.chance(.35) ? 1 : 0]);
      }
      return {isles, warp: [r.range(0, 99), r.range(0, 99)]};
    },
    elevation(nx, nz, n, s) {
      const wx = nx + .08 * n.fbm(nx * 4 + s.warp[0], nz * 4, 4), wz = nz + .08 * n.fbm(nx * 4, nz * 4 + s.warp[1], 4);
      let land = 0, peak = 0;
      for (const [ix, iz, r, volcano] of s.isles) {
        const d = len(wx - ix, wz - iz) / r;
        if (d >= 1.4) continue;
        const k = 1 - smooth(.35, 1.25, d); land = Math.max(land, k);
        if (volcano) { const cone = clamp(1 - d * 1.15, 0, 1); peak = Math.max(peak, cone * cone * (1 - smooth(.0, .09, .09 - d * .5) * .35)); }
      }
      const edge = 1 - smooth(.78, .98, Math.max(Math.abs(nx), Math.abs(nz)));
      const rough = n.fbm(nx * 5 + 1, nz * 5 + 2, 4), hills = n.ridged(nx * 7 - 4, nz * 7 + 5, 4);
      return ((land * 1.05 - .48 + .08 * rough) * 90 + land * (12 * hills + 300 * peak)) * (.35 + .65 * edge) - (1 - edge) * 40;
    },
  }),
  highlands: Object.freeze({
    id: 'highlands', name: 'Frostmere Highlands', blurb: 'Cold high moors cut by deep glens, tarns and fjords; the toughest country.',
    size: 4096, warmth: .46, wetness: 1.1, seaRatio: .22,
    setup(r) { return {warp: [r.range(0, 99), r.range(0, 99)], fjordSide: r.int(0, 3)}; },
    elevation(nx, nz, n, s) {
      const wx = nx + .15 * n.fbm(nx * 2 + s.warp[0], nz * 2, 4), wz = nz + .15 * n.fbm(nx * 2, nz * 2 + s.warp[1], 4);
      const d = Math.max(Math.abs(wx) * .9, Math.abs(wz) * .9) * .55 + len(wx, wz) * .45, land = 1 - smooth(.6, .95, d);
      // Glens: inverted ridges carve long valleys through the plateau.
      const glen = n.ridged(nx * 2.3 + 11, nz * 2.3 - 5, 3), plateau = 150 + 50 * n.fbm(nx * 1.6 + 4, nz * 1.6 + 8, 3);
      const crags = n.ridged(nx * 4.2 - 3, nz * 4.2 + 21, 5);
      // One side of the map is bitten by sea lochs.
      const side = [nx, -nx, nz, -nz][s.fjordSide], fjord = smooth(.15, .8, side) * glen;
      return land * (plateau - glen * 120 + crags * crags * 260 * smooth(.3, .8, land) - fjord * 120) - (1 - land) * 60 - 25 + 30 * land;
    },
  }),
  riverlands: Object.freeze({
    id: 'riverlands', name: 'Greenwater Basin', blurb: 'A broad green basin ringed by hills; one mighty river, marshes and a delta.',
    size: 4096, warmth: .6, wetness: 1.3, seaRatio: .2, relief: .6, dales: 0, // rounded hills, no dales: the basin stays one great river's country
    setup(r) { return {coast: r.int(0, 3), warp: [r.range(0, 99), r.range(0, 99)]}; },
    elevation(nx, nz, n, s) {
      // Rotate so the sea is on the seeded side ("down" = +v).
      const [u, v] = [[nx, nz], [-nz, nx], [-nx, -nz], [nz, -nx]][s.coast];
      const wu = u + .16 * n.fbm(u * 2.5 + s.warp[0], v * 2.5, 4), wv = v + .16 * n.fbm(u * 2.5, v * 2.5 + s.warp[1], 4);
      const rim = smooth(.42, .92, Math.max(Math.abs(wu), -wv * 1.05));            // hills on three sides
      const sea = smooth(.5, .86, wv);                                             // the coast
      const basin = 8 + 24 * (1 - wv) * .5 + 22 * n.fbm(u * 2.2 + 13, v * 2.2 - 4, 4) + 14 * n.ridged(u * 5 + 2, v * 5 - 8, 4);         // gently tilted toward the sea
      const rough = n.ridged(u * 4.4 + 9, v * 4.4 - 6, 5);
      const edge = smooth(.88, 1, Math.max(Math.abs(nx), Math.abs(nz)));
      return basin + rim * (90 + 300 * rough * rim) - sea * 70 - edge * 120;
    },
  }),
});
export const PRESET_IDS = Object.freeze(Object.keys(PRESETS));

// Small deterministic cos/sin for seeded setup angles (Math.sin/cos may differ in the last bit between engines).
function sinApprox(a) {
  a = a % 6.283185307179586; if (a > 3.141592653589793) a -= 6.283185307179586; if (a < -3.141592653589793) a += 6.283185307179586;
  const a2 = a * a; return a * (1 - a2 / 6 * (1 - a2 / 20 * (1 - a2 / 42 * (1 - a2 / 72 * (1 - a2 / 110)))));
}
const cosApprox = a => sinApprox(a + 1.5707963267948966);
export {sinApprox, cosApprox};
