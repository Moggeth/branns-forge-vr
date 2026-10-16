// The Underways, drawn: the shell of one dungeon (floor, walls, ceiling, lintels) built once from its generated layout
// (shared/underways/gen.js) with baked light. Presentation only: walls stand exactly where walkers stop, and nothing here
// is a raycast or collision target.
//
// Every vertex carries two colours: `color` is the surface's own albedo (style palette, strata, wear, moss) and
// `aLight` is the light baked from the dungeon's torches, lanterns and crystals (distance falloff, a line-of-sight check
// through the tile grid, and occlusion where walls meet floor and roof). The style material adds that baked light as
// emission with a slow per-area flicker, so a dungeon is lit by its own fires with no real lights (phone and Quest safe);
// the scene's one pooled lantern light adds the moving highlights on top.
import * as THREE from 'three';
import {GRID, TILE, HALF, floorTile, floorHeight, ceilingAt, tileAt} from '../../shared/underways/gen.js';

const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const h3 = (x, y, z) => { let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f); h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const c = (a, b, d) => h3(ix + a, iy + b, iz + d);
  return lerp(lerp(lerp(c(0, 0, 0), c(1, 0, 0), sx), lerp(c(0, 1, 0), c(1, 1, 0), sx), sy), lerp(lerp(c(0, 0, 1), c(1, 0, 1), sx), lerp(c(0, 1, 1), c(1, 1, 1), sx), sy), sz);
}
export const fbm = (x, y, z) => .55 * vnoise(x, y, z) + .3 * vnoise(x * 2.1 + 7, y * 2.1, z * 2.1) + .15 * vnoise(x * 4.3, y * 4.3 + 3, z * 4.3);

// Style palettes (linear-ish albedo) and how rough each shell is.
export const UNDERWAY_LOOK = Object.freeze({
  mine: Object.freeze({
    rock: [[.42, .33, .27], [.5, .4, .31], [.36, .3, .27], [.56, .45, .33]], floor: [.46, .37, .28], roof: [.3, .25, .22],
    bulge: .62, roofBulge: 1.1, ambient: [.05, .045, .05], fog: 0x120d10, sky: [.035, .03, .04],
  }),
  crypt: Object.freeze({
    rock: [[.5, .47, .44], [.44, .42, .41], [.55, .52, .47]], floor: [.42, .4, .38], roof: [.36, .34, .34],
    bulge: .04, roofBulge: 0, ambient: [.045, .045, .06], fog: 0x0d0c14, sky: [.03, .03, .045],
  }),
  keep: Object.freeze({
    rock: [[.55, .5, .42], [.5, .47, .4], [.6, .55, .45]], floor: [.48, .45, .37], roof: [.38, .35, .3],
    bulge: .06, roofBulge: 0, ambient: [.05, .055, .05], fog: 0x0e110d, sky: [.035, .04, .035],
  }),
});

/** Outward (into rock) direction at a tile-grid corner, from which of its four tiles are floor. */
function cornerOut(d, ci, cj) {
  let x = 0, z = 0;
  for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
    const solid = floorTile(d, ci + di, cj + dj) ? -1 : 1, ox = di === 0 ? 1 : -1, oz = dj === 0 ? 1 : -1;
    x += ox * solid; z += oz * solid;
  }
  const l = Math.hypot(x, z); return l > 1e-6 ? [x / l, z / l] : [0, 0];
}

/**
 * Build the shell geometry for a dungeon, in its local frame (centre at the origin).
 * Returns {floor, walls, roof} BufferGeometries with position, normal, uv (metres), color (albedo) and aLight (baked).
 */
export function buildUnderwayShell(d, {quality = 'high'} = {}) {
  const low = quality === 'low', L = UNDERWAY_LOOK[d.style];
  const sub = low ? 2 : 3;              // floor/roof subdivisions per tile
  const wallSeg = low ? 3 : 4, wallRows = low ? 4 : 6;
  const corner = (ci, cj) => [(ci - GRID / 2) * TILE, (cj - GRID / 2) * TILE];
  const lights = d.lights.map(l => ({...l, c: new THREE.Color(l.color)}));
  // Light grid for quick lookups (lights within 16 m).
  const lightCells = new Map(), CELL = 8;
  for (const l of lights) { const k = `${Math.floor(l.x / CELL)},${Math.floor(l.z / CELL)}`; if (!lightCells.has(k)) lightCells.set(k, []); lightCells.get(k).push(l); }
  const solidAt = (x, z) => { const [i, j] = tileAt(x, z); return !floorTile(d, i, j); };
  function bake(x, y, z, nx, ny, nz, ao) {
    let r = L.ambient[0], g = L.ambient[1], b = L.ambient[2];
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    for (let a = ci - 2; a <= ci + 2; a++) for (let c = cj - 2; c <= cj + 2; c++) for (const l of lightCells.get(`${a},${c}`) || []) {
      const dx = l.x - x, dy = l.y - y, dz = l.z - z, dist = Math.hypot(dx, dy, dz);
      if (dist > 15) continue;
      const lambert = clamp((dx * nx + dy * ny + dz * nz) / Math.max(dist, .001) * .8 + .2);
      if (lambert <= 0) continue;
      // Line of sight through the tile grid (a light round a corner does not reach), skipping the ends.
      let blocked = false; const steps = Math.ceil(dist / .9);
      for (let s = 1; s < steps; s++) { const t = s / steps, px = x + dx * t + nx * .35, pz = z + dz * t + nz * .35; if (t > .12 && t < .9 && solidAt(px, pz)) { blocked = true; break; } }
      if (blocked) continue;
      const fall = l.power * 5.5 / (1 + dist * dist * .55) * (1 - smoothstep(9, 15, dist)) * lambert;
      r += l.c.r * fall; g += l.c.g * fall; b += l.c.b * fall;
    }
    return [r * ao, g * ao, b * ao];
  }
  function smoothstep(a, b, v) { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); }
  // Distance from a point to the nearest rock (tile grid), capped: floor and roof occlusion.
  const nearRock = (x, z) => {
    const [ti, tj] = tileAt(x, z); let best = 3;
    for (let j = tj - 2; j <= tj + 2; j++) for (let i = ti - 2; i <= ti + 2; i++) {
      if (floorTile(d, i, j)) continue;
      const x0 = (i - GRID / 2) * TILE, z0 = (j - GRID / 2) * TILE, cx = clamp(x, x0, x0 + TILE), cz = clamp(z, z0, z0 + TILE);
      best = Math.min(best, Math.hypot(x - cx, z - cz));
    }
    return best;
  };
  const albedo = (palette, x, y, z, wear) => {
    const n = fbm(x * .35, y * .9, z * .35), band = Math.floor(clamp(fbm(x * .05 + 3, y * .55, z * .05) * palette.length * 1.2, 0, palette.length - 1));
    const base = palette[band], k = .8 + .35 * n - wear * .12;
    return [base[0] * k, base[1] * k, base[2] * k];
  };

  // ---- Floor and roof: per tile, subdivided; each tile keeps its own vertices so ceiling steps stay crisp.
  const F = {p: [], n: [], uv: [], c: [], l: []}, R = {p: [], n: [], uv: [], c: [], l: []}, W = {p: [], n: [], uv: [], c: [], l: []};
  const push = (B, x, y, z, nx, ny, nz, u, v, col, lit) => { B.p.push(x, y, z); B.n.push(nx, ny, nz); B.uv.push(u, v); B.c.push(...col); B.l.push(...lit); };
  const roofLift = (x, z) => L.roofBulge ? fbm(x * .22 + 11, 0, z * .22) * L.roofBulge * clamp(nearRock(x, z) / 2.2) : 0;
  const floorBump = (x, z) => L.bulge > .2 ? (fbm(x * .6, 4, z * .6) - .5) * .06 : 0;
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    if (!floorTile(d, i, j)) continue;
    const [x0, z0] = corner(i, j), ceil = ceilingAt(d, x0 + TILE / 2, z0 + TILE / 2);
    for (let b = 0; b < sub; b++) for (let a = 0; a < sub; a++) {
      const q = [[a, b], [a + 1, b], [a + 1, b + 1], [a, b + 1]].map(([u, v]) => {
        // sample heights a hair inside the tile so a ramp tile reads its own corridor
        const x = x0 + u / sub * TILE, z = z0 + v / sub * TILE, sx = clamp(x, x0 + .01, x0 + TILE - .01), sz = clamp(z, z0 + .01, z0 + TILE - .01);
        const y = floorHeight(d, sx, sz);
        return {x, z, y, top: y + ceil + roofLift(x, z)};
      });
      for (const tri of [[0, 3, 2], [0, 2, 1]]) for (const k of tri) {
        const v = q[k], rock = nearRock(v.x, v.z), ao = .42 + .58 * smoothstep(0, 1.6, rock);
        push(F, v.x, v.y + floorBump(v.x, v.z), v.z, 0, 1, 0, v.x, v.z, albedo([L.floor], v.x, 0, v.z, 1 - rock / 3), bake(v.x, v.y + .05, v.z, 0, 1, 0, ao));
      }
      for (const tri of [[0, 1, 2], [0, 2, 3]]) for (const k of tri) {
        const v = q[k], rock = nearRock(v.x, v.z), ao = .55 + .45 * smoothstep(0, 1.6, rock);
        push(R, v.x, v.top, v.z, 0, -1, 0, v.x, v.z, albedo([L.roof], v.x, v.top, v.z, 0), bake(v.x, v.top - .05, v.z, 0, -1, 0, ao));
      }
    }
  }
  // ---- Walls: every floor tile edge facing rock, from below the floor to the roof, bulging into the rock (tapered to
  // the floor and roof seams). Edge-end vertices use the corner's own outward direction so neighbouring walls meet.
  const edges = [[0, -1, 0, 0, 1, 0], [1, 0, 1, 0, 1, 1], [0, 1, 1, 1, 0, 1], [-1, 0, 0, 1, 0, 0]]; // [di, dj, c0i, c0j, c1i, c1j] offsets of the edge's two corners
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    if (!floorTile(d, i, j)) continue;
    for (const [di, dj, a0, b0, a1, b1] of edges) {
      if (floorTile(d, i + di, j + dj)) continue;
      const [ax, az] = corner(i + a0, j + b0), [bx, bz] = corner(i + a1, j + b1), oa = cornerOut(d, i + a0, j + b0), ob = cornerOut(d, i + a1, j + b1);
      const tileCx = (ax + bx) / 2 - di * TILE / 2, tileCz = (az + bz) / 2 - dj * TILE / 2;
      const grid = [];
      for (let s = 0; s <= wallSeg; s++) {
        const t = s / wallSeg, x = lerp(ax, bx, t), z = lerp(az, bz, t);
        const out = s === 0 ? oa : s === wallSeg ? ob : [di, dj];
        const sx = clamp(x - di * .02, tileCx - TILE / 2 + .01, tileCx + TILE / 2 - .01), sz = clamp(z - dj * .02, tileCz - TILE / 2 + .01, tileCz + TILE / 2 - .01);
        const y0 = floorHeight(d, sx, sz) - .35, y1 = floorHeight(d, sx, sz) + ceilingAt(d, tileCx, tileCz) + roofLift(x, z);
        const col = [];
        for (let r = 0; r <= wallRows; r++) {
          const k = r / wallRows, y = lerp(y0, y1, k), taper = Math.sin(Math.PI * clamp((y - y0) / (y1 - y0) * 1.05)), push = L.bulge * taper * (.35 + .65 * fbm(x * .55, y * .55, z * .55)) + L.bulge * .2 * taper * fbm(x * 1.7, y * 1.7, z * 1.7);
          col.push({x: x + out[0] * push, y, z: z + out[1] * push, u: (di ? z : x) * (di + dj > 0 ? 1 : -1), v: y});
        }
        grid.push(col);
      }
      const nrm = [-di, 0, -dj]; // faces the floor tile
      for (let s = 0; s < wallSeg; s++) for (let r = 0; r < wallRows; r++) {
        const quad = [grid[s][r], grid[s + 1][r], grid[s + 1][r + 1], grid[s][r + 1]];
        // winding so the front face looks at the floor tile
        const order = (di + dj > 0) === (di !== 0) ? [[0, 2, 1], [0, 3, 2]] : [[0, 1, 2], [0, 2, 3]];
        for (const tri of order) for (const k of tri) {
          const v = quad[k], hk = clamp((v.y - grid[0][0].y) / Math.max(.1, grid[0][wallRows].y - grid[0][0].y)), ao = .5 + .5 * smoothstep(0, .35, hk) * (1 - .35 * smoothstep(.8, 1, hk));
          push(W, v.x, v.y, v.z, ...nrm, v.u, v.v, albedo(L.rock, v.x, v.y, v.z, 0), bake(v.x - di * .1, v.y, v.z - dj * .1, ...nrm, ao));
        }
      }
    }
    // Lintels: where a neighbouring floor tile has a lower roof, a wall closes the step between the two roofs.
    for (const [di, dj, a0, b0, a1, b1] of edges) {
      if (!floorTile(d, i + di, j + dj)) continue;
      const [ax, az] = corner(i + a0, j + b0), [bx, bz] = corner(i + a1, j + b1), mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const here = floorHeight(d, mx - di * .3, mz - dj * .3) + ceilingAt(d, mx - di * .3, mz - dj * .3), there = floorHeight(d, mx + di * .3, mz + dj * .3) + ceilingAt(d, mx + di * .3, mz + dj * .3);
      if (here - there < .05) continue; // only the taller side draws it, facing into itself
      const nrm = [-di, 0, -dj], quad = [[ax, there - .05, az], [bx, there - .05, bz], [bx, here + roofLift(bx, bz), bz], [ax, here + roofLift(ax, az), az]];
      const order = (di + dj > 0) === (di !== 0) ? [[0, 2, 1], [0, 3, 2]] : [[0, 1, 2], [0, 2, 3]];
      for (const tri of order) for (const k of tri) { const [x, y, z] = quad[k]; push(W, x, y, z, ...nrm, (di ? z : x), y, albedo(L.rock, x, y, z, 0), bake(x - di * .2, y, z - dj * .2, ...nrm, .7)); }
    }
  }
  const geo = B => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
    g.setAttribute('aLight', new THREE.Float32BufferAttribute(B.l, 3));
    if (L.bulge > .2 || L.roofBulge) g.computeVertexNormals(); // rough rock: shade its own lumps (non-indexed: per face)
    g.computeBoundingSphere();
    return g;
  };
  return {floor: geo(F), walls: geo(W), roof: geo(R), triangles: (F.p.length + W.p.length + R.p.length) / 9, half: HALF};
}

/** Bake light at an arbitrary local point (props use it so they sit in the same light as the shell). */
export function bakeAt(d, x, y, z) {
  const L = UNDERWAY_LOOK[d.style]; let r = L.ambient[0], g = L.ambient[1], b = L.ambient[2];
  for (const l of d.lights) {
    const dist = Math.hypot(l.x - x, l.y - y, l.z - z); if (dist > 15) continue;
    let blocked = false; const steps = Math.ceil(dist / .9);
    for (let s = 1; s < steps; s++) { const t = s / steps; if (t > .12 && t < .9) { const [i, j] = tileAt(x + (l.x - x) * t, z + (l.z - z) * t); if (!floorTile(d, i, j)) { blocked = true; break; } } }
    if (blocked) continue;
    const c = new THREE.Color(l.color), fall = l.power * 5.5 / (1 + dist * dist * .55) * (1 - clamp((dist - 9) / 6));
    r += c.r * fall; g += c.g * fall; b += c.b * fall;
  }
  return [r, g, b];
}
