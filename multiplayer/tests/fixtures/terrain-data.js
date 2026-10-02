// Test height fixture: the game's terrainHeight formula with one of every accepted deformation edit kind
// (shapes match shared/simulation.js validation: raise/lower r6 h±2, starfall r5 h-1, sunder r2.5 h-1.5, wall r2.5 h1.5).
export function fixtureHeight(x, z, edits = []) {
  let h = 0.45 * Math.sin(x * 0.09) * Math.cos(z * 0.07);
  for (const e of edits) { const t = Math.min(1, Math.max(0, 1 - Math.hypot(x - e.x, z - e.z) / Math.max(.01, e.radius))); h += e.height * t * t * (3 - 2 * t); }
  return h;
}
const line = (id, kind, ax, az, bx, bz, n, h) => Array.from({length: n}, (_, i) => ({id: `${id}_${i}`, kind, x: ax + (bx - ax) * i / (n - 1), z: az + (bz - az) * i / (n - 1), radius: 2.5, height: h}));
export const FIXTURE_EDITS = Object.freeze([
  {id: 'r1', kind: 'raise', x: -11, z: -4, radius: 6, height: 2},
  {id: 'l1', kind: 'lower', x: 11, z: -7, radius: 6, height: -2},
  {id: 'f1', kind: 'starfall', x: 1, z: -19, radius: 5, height: -1},
  ...line('s1', 'sunder', -5, -6.5, 5, -10, 4, -1.5),
  ...line('w1', 'wall', -16, -15, -9, -18, 3, 1.5),
]);
const h = (x, z) => fixtureHeight(x, z, FIXTURE_EDITS);
// [camera position, look target]
export const VIEWS = {
  ground: [[0.5, h(0.5, 1) + 1.7, 1], [0, h(0, -8) - .3, -8]],
  elevated: [[0 + Math.sin(.2) * 38 * Math.cos(.9), 38 * Math.sin(.9) + 3, -8 + Math.cos(.2) * 38 * Math.cos(.9)], [0, 0, -8]],
  sunder: [[5.2, h(5.2, -5.6) + 0.9, -5.6], [-1.5, -1.25, -8.9]],
  crater: [[13.5, h(13.5, 0) + 1.8, 0], [10.5, -1.6, -7.5]],
  meadow: [[24, h(24, 22) + 1.7, 22], [34, h(34, 6) - .4, 6]],
  meadowhigh: [[40, 30, 46], [30, 0, 18]],
  raise: [[-3.4, h(-3.4, 1) + 1.6, 1], [-10.5, 1.2, -4.5]],
};
