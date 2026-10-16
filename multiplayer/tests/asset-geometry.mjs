// Asset geometry: no shipped model has backwards faces. A triangle wound against all three of its own vertex normals is
// invisible from outside wherever the game draws single-sided (the keep, town and back-town kits force it) and shades
// dark on double-sided materials. scripts/glb-winding.mjs --fix turns any new ones; this keeps the count at zero.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WINDING_SKIP, glbPath, shippedGlbs, windingFaults} from '../scripts/glb-winding.mjs';

const bad = [];
let checked = 0;
for (const f of shippedGlbs()) {
  if (WINDING_SKIP.has(f)) continue;
  checked++;
  const faults = windingFaults(readFileSync(glbPath(f)));
  if (faults.length) bad.push(`${f}: ${faults.length} backwards (${[...new Set(faults.map(x => `${x.mesh}/${x.material}`))].join(', ')})`);
}
assert.deepEqual(bad, [], 'backwards faces; run node scripts/glb-winding.mjs --fix');
console.log(`asset geometry: ${checked} models, no backwards faces`);
