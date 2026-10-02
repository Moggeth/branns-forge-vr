// Deterministic world presentation data.  This file deliberately has no clock or RNG.
const hash = (seed, n) => { let x = (seed ^ Math.imul(n + 1, 0x9e3779b9)) >>> 0; x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13; return x >>> 0; };
export const baseTrees = [
  [-2, 6, 5.8], [1.8, 6.5, 6.4], [-3.5, 9, 5.2], [3.7, 9.4, 6.1], [0, 11.5, 6.8],
  [-12, -9, 7], [14, -12, 6.5], [-17, 17, 7.2], [19, 18, 5.6], [-24, 4, 6.4], [25, 2, 6.8]
];
export const initialDeposits = () => [
  [-5, 5, 'stone'], [5, 5, 'stone'], [-7, 10, 'stone'], [7, 10, 'stone'], [0, 14, 'stone']
].map(([x,z,kind], i) => ({id: `ore${i + 1}`, x, z, kind, hits: 0, maxHits: 3, depleted: false}));
export function worldTrees(state) {
  const trees = baseTrees.map(([x,z,height], i) => ({id: `tree${i + 1}`, x, z, height, variant: i % 3}));
  for (let i = 0; i < 14; i++) { const h = hash(state.seed, i); const a = (h % 6283) / 1000; const r = 25 + ((h >>> 12) % 25); trees.push({id:`outer${i + 1}`, x:+(Math.cos(a)*r).toFixed(3), z:+(Math.sin(a)*r).toFixed(3), height:5 + (h % 30)/10, variant:(h>>>8)%3}); }
  for (const g of state.groves || []) { const count = g.kind === 'ring' ? 8 : 5; for (let i=0;i<count;i++) { const a = i * Math.PI * 2 / count; const r = g.kind === 'ring' ? 4 : 2.5; trees.push({id:`${g.id}-tree${i}`,x:+(g.x+Math.cos(a)*r).toFixed(3),z:+(g.z+Math.sin(a)*r).toFixed(3),height:5.5+(i%2),variant:i%3}); } }
  return trees;
}
