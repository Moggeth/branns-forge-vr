import assert from 'node:assert/strict';
import {MATERIAL_KEYS,ORE_RECIPES,PRIMARY_MATERIALS,EXTRA_MATERIALS,materialLabel} from '../shared/material-catalog.js';
import {RESOURCE_BAR_KEYS,RESOURCE_BAR_CORE,resourceIcon} from '../client/resource-bar.js';

// Three primaries lead, always shown; every other material you can hold is an extra. Ore banks as metal, so it has no slot.
assert.deepEqual([...RESOURCE_BAR_CORE],['wood','iron','gems'],'Timber, Iron, Crystal lead');
assert.deepEqual(PRIMARY_MATERIALS.map(materialLabel),['Timber','Iron','Crystal']);
const holdable=MATERIAL_KEYS.filter(k=>!Object.hasOwn(ORE_RECIPES,k));
assert.deepEqual([...RESOURCE_BAR_KEYS].sort(),[...holdable].sort(),'resource bar covers every material you can hold');
assert.deepEqual(RESOURCE_BAR_KEYS.slice(0,3),[...PRIMARY_MATERIALS]);
assert.ok(EXTRA_MATERIALS.every(k=>!PRIMARY_MATERIALS.includes(k)));
assert.equal(new Set(RESOURCE_BAR_KEYS).size,RESOURCE_BAR_KEYS.length,'no duplicate slots');
const icons=RESOURCE_BAR_KEYS.map(k=>resourceIcon(k));
for(const [i,svg] of icons.entries())assert.match(svg,/^<svg class="rb-ico"[^>]*>.+<\/svg>$/s,RESOURCE_BAR_KEYS[i]);
assert.equal(new Set(icons).size,icons.length,'each material has its own icon');
console.log(`resource-bar: ${PRIMARY_MATERIALS.length} primaries + ${EXTRA_MATERIALS.length} extras, distinct icons`);
