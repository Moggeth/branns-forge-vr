import assert from 'node:assert/strict';
import {MATERIAL_KEYS} from '../shared/material-catalog.js';
import {RESOURCE_BAR_KEYS,RESOURCE_BAR_CORE,resourceIcon} from '../client/resource-bar.js';

// Every material the simulation tracks gets exactly one slot and a distinct drawn icon.
assert.deepEqual([...RESOURCE_BAR_KEYS].sort(),[...MATERIAL_KEYS].sort(),'resource bar covers every material');
assert.equal(new Set(RESOURCE_BAR_KEYS).size,RESOURCE_BAR_KEYS.length,'no duplicate slots');
const icons=RESOURCE_BAR_KEYS.map(k=>resourceIcon(k));
for(const [i,svg] of icons.entries())assert.match(svg,/^<svg class="rb-ico"[^>]*>.+<\/svg>$/s,RESOURCE_BAR_KEYS[i]);
assert.equal(new Set(icons).size,icons.length,'each material has its own icon');
for(const k of RESOURCE_BAR_CORE)assert.ok(RESOURCE_BAR_KEYS.includes(k));
console.log(`resource-bar: ${RESOURCE_BAR_KEYS.length} materials, distinct icons`);
