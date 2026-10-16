import assert from 'node:assert/strict';
import {MATERIAL_KEYS} from '../shared/material-catalog.js';
import {RESOURCE_BAR_KEYS,RESOURCE_BAR_GROUPS,RESOURCE_BAR_CORE,resourceIcon} from '../client/resource-bar.js';

// Every material the simulation tracks gets exactly one slot and a distinct drawn icon.
assert.deepEqual([...RESOURCE_BAR_KEYS].sort(),[...MATERIAL_KEYS].sort(),'resource bar covers every material');
assert.equal(new Set(RESOURCE_BAR_KEYS).size,RESOURCE_BAR_KEYS.length,'no duplicate slots');
const icons=RESOURCE_BAR_KEYS.map(k=>resourceIcon(k));
for(const [i,svg] of icons.entries())assert.match(svg,/^<svg class="rb-ico"[^>]*>.+<\/svg>$/s,RESOURCE_BAR_KEYS[i]);
assert.equal(new Set(icons).size,icons.length,'each material has its own icon');
// Ores line up column-for-column with the metals they smelt into; salt is sold, not smelted, so it never sits among them.
assert.equal(RESOURCE_BAR_GROUPS[1].length,RESOURCE_BAR_GROUPS[2].length,'ore and metal columns align');
assert.ok(!RESOURCE_BAR_GROUPS[1].includes('salt')&&!RESOURCE_BAR_GROUPS[2].includes('salt'),'salt is a trade good, not an ore or metal');
for(const k of RESOURCE_BAR_CORE)assert.ok(RESOURCE_BAR_KEYS.includes(k));
console.log(`resource-bar: ${RESOURCE_BAR_KEYS.length} materials, distinct icons`);
