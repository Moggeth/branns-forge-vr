// Paints a generated world as an illustrated overview map (RGBA pixels): hill-shaded biomes, water, rivers, roads,
// settlements, landmarks and dungeon entrances. Pure: the in-game map draws it into a canvas, tests/renders write PNGs.
import {BIOME} from './generate.js';

// Cheerful storybook palette (matches the terrain shader's biome colours).
export const BIOME_COLORS = Object.freeze({
  [BIOME.OCEAN]: [46, 112, 160], [BIOME.LAKE]: [70, 150, 190], [BIOME.BEACH]: [228, 210, 160], [BIOME.MEADOW]: [134, 184, 84],
  [BIOME.FOREST]: [66, 132, 60], [BIOME.PINE]: [52, 106, 74], [BIOME.MARSH]: [104, 136, 82], [BIOME.STEPPE]: [206, 186, 112],
  [BIOME.ROCK]: [142, 132, 124], [BIOME.SNOW]: [240, 244, 250], [BIOME.TUNDRA]: [168, 172, 140],
});

/**
 * @param world generated world
 * @param {number} px output width/height in pixels
 * @param {{markers?:boolean}} options
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
export function paintWorldMap(world, px = 512, {markers = true} = {}) {
  const data = new Uint8ClampedArray(px * px * 4), S = world.size, H = world.half, m = S / px;
  const {elev, biome, ocean, lakeId, forest} = world.grids, N = world.n;
  const cell = (x, z) => Math.min(N - 1, Math.max(0, Math.floor((x + H) / world.cell))) + Math.min(N - 1, Math.max(0, Math.floor((z + H) / world.cell))) * N;
  for (let py = 0; py < px; py++) for (let qx = 0; qx < px; qx++) {
    const x = -H + (qx + .5) * m, z = -H + (py + .5) * m, c = cell(x, z), o = (py * px + qx) * 4;
    let col;
    const h = world.heightAt(x, z), w = world.waterAt(x, z);
    if (w > h + .05) {
      const depth = Math.min(1, (w - h) / (lakeId[c] >= 0 ? 18 : 60));
      const base = ocean[c] || w <= .01 ? [40, 118, 170] : [62, 156, 196];
      col = base.map((v, k) => v * (1 - depth * .45) + [150, 214, 220][k] * (1 - depth) * .35);
    } else {
      col = [...(BIOME_COLORS[world.biomeAt(x, z)] || BIOME_COLORS[BIOME.MEADOW])];
      const f = world.forestAt(x, z); if (f > .3) col = col.map((v, k) => v * (1 - (f - .3) * .5) + [34, 84, 40][k] * (f - .3) * .5);
      // Hill shade from the north-west.
      const e = 6, gx = world.heightAt(x + e, z) - world.heightAt(x - e, z), gz = world.heightAt(x, z + e) - world.heightAt(x, z - e);
      const shade = Math.max(.45, Math.min(1.35, 1 + (-gx - gz) * .045));
      col = col.map(v => v * shade);
      if (world.roadAt(x, z) < Math.max(2.6, m * .6)) col = [196, 160, 110];
    }
    data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255;
  }
  if (markers) {
    const dot = (x, z, r, rgb, ring) => {
      const cx = (x + H) / m, cy = (z + H) / m;
      for (let y = Math.floor(cy - r - 2); y <= cy + r + 2; y++) for (let xx = Math.floor(cx - r - 2); xx <= cx + r + 2; xx++) {
        if (xx < 0 || y < 0 || xx >= px || y >= px) continue;
        const d = Math.sqrt((xx - cx) * (xx - cx) + (y - cy) * (y - cy)), o = (y * px + xx) * 4;
        if (d <= r) { data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; }
        else if (ring && d <= r + 1.6) { data[o] = 30; data[o + 1] = 24; data[o + 2] = 18; }
      }
    };
    const r = Math.max(2, px / 160);
    for (const d of world.discoveries) dot(d.x, d.z, r * .7, [250, 230, 120], true);
    for (const e of world.entrances) dot(e.x, e.z, r, [150, 70, 200], true);
    for (const l of world.landmarks) if (l.kind === 'falls') dot(l.x, l.z, r * .8, [200, 240, 255], true);
    for (const s of world.settlements) dot(s.x, s.z, r * (s.start ? 2 : 1.4), s.start ? [255, 120, 60] : [250, 250, 240], true);
  }
  return {width: px, height: px, data};
}
