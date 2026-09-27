'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {audit} = require('./living-capability-audit.cjs');
const pinned = JSON.parse(fs.readFileSync(path.join(__dirname, '../godot/living_capabilities.json'), 'utf8'));
const demos = require('./living-demo-packages.json');

test('shipped package versions match the service validator and pinned native catalog', () => {
  assert.deepEqual(audit(demos, null, pinned), {ok: true, checked: demos.length, errors: []});
});
test('preflight catches unsupported primitives and an incompatible desired world', () => {
  const bad = structuredClone(demos[0]); bad.entities[0].components.push({type: 'arbitrary_code', config: {}});
  assert.match(audit([bad], null, pinned).errors.join(' '), /Unknown capability/);
  const selected = [{id: 'living-lantern-seed', version: 1}, {id: 'living-lantern-seed', version: 2}];
  assert.match(audit(demos, selected, pinned).errors.join(' '), /duplicate id/);
  assert.match(audit(demos, null, {}).errors.join(' '), /pinned catalog differs/);
});
