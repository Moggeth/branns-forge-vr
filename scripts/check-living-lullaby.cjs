'use strict';
// Read-only service validation of the optional data package; never publishes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {validatePackage} = require('../service/living-workshop');
const started = performance.now();
const packagePath = path.join(__dirname, '../godot/living_unfinished_lullaby.json');
const packageData = validatePackage(JSON.parse(fs.readFileSync(packagePath, 'utf8')));
assert.equal(packageData.id, 'living-unfinished-lullaby');
assert.equal(packageData.entities.length, 26);
assert.equal(packageData.entities.filter(e => !e.static).length, 3);
assert.equal(packageData.dependencies.length, 0);
assert.deepEqual(packageData.region.origin, [120, 0, -90]);
assert.deepEqual(packageData.region.spawn, [120, 0, -84]);
const final = packageData.entities.find(e => e.id === 'chorus');
assert.equal(final.components.find(c => c.type === 'objective').config.count, 3);
const contributors = packageData.rules.filter(r => r.actions.some(a => a.op === 'objective' && a.target === 'chorus'));
assert.deepEqual(contributors.map(r => [r.event, r.target]).sort(), [
  ['objective_complete', 'hearth-bud'], ['objective_complete', 'song-bud'], ['objective_complete', 'sun-bud']
]);
assert.equal(packageData.entities.filter(e => e.components.some(c => c.type === 'portal')).length, 1);
console.log(`LULLABY_SERVICE_CHECK passed entities=26 dynamic=3 elapsed_seconds=${((performance.now() - started) / 1000).toFixed(6)}`);
