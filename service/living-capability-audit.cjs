'use strict';
// Offline, read-only preflight. This does not claim that the native client applied a package.
const fs = require('node:fs');
const path = require('node:path');
const {catalog, validatePackage, LIMITS} = require('./living-workshop');

function audit(packages, desired = null, pinned = null) {
  const errors = [];
  const current = catalog();
  const expected = {components: current.components, actions: current.actions, events: current.events, links: current.links, budgets: current.budgets};
  if (JSON.stringify(pinned) !== JSON.stringify(expected)) errors.push('Native pinned catalog differs from the service catalog');
  if (!Array.isArray(packages)) return {ok: false, errors: [...errors, 'Input must be an array of packages']};
  const versions = new Map();
  for (const [index, input] of packages.entries()) {
    try {
      const p = validatePackage(input);
      const key = `${p.id}@${p.version}`;
      if (versions.has(key)) errors.push(`Duplicate version ${key}`);
      else versions.set(key, p);
    } catch (error) { errors.push(`Package ${index + 1}: ${error.message}`); }
  }
  if (desired !== null) {
    if (!Array.isArray(desired)) errors.push('Desired must be an array of package ids and versions');
    else {
      const active = new Map();
      for (const [index, selection] of desired.entries()) {
        const key = `${selection?.id}@${selection?.version}`;
        if (!versions.has(key)) errors.push(`Desired ${index + 1}: missing ${key}`);
        if (active.has(selection?.id)) errors.push(`Desired ${index + 1}: duplicate id ${selection.id}`);
        active.set(selection?.id, versions.get(key));
      }
      let entities = 0, bodies = 0;
      for (const p of active.values()) {
        if (!p) continue;
        entities += p.entities.length;
        bodies += p.entities.filter(e => !e.static || e.components.some(c => c.type === 'grabbable')).length;
        for (const dep of p.dependencies) if (active.get(dep.id)?.version !== dep.version) errors.push(`${p.id}@${p.version} requires active ${dep.id}@${dep.version}`);
      }
      if (active.size > LIMITS.packages || entities > LIMITS.totalEntities || bodies > LIMITS.dynamicBodies) errors.push('Desired active world exceeds package, entity, or body budget');
      const visiting = new Set(), done = new Set();
      function visit(id) {
        if (visiting.has(id)) { errors.push(`Dependency cycle at ${id}`); return; }
        if (done.has(id) || !active.get(id)) return;
        visiting.add(id);
        for (const dep of active.get(id).dependencies) visit(dep.id);
        visiting.delete(id); done.add(id);
      }
      for (const id of active.keys()) visit(id);
    }
  }
  return {ok: errors.length === 0, checked: versions.size, errors};
}

if (require.main === module) {
  const inputPath = process.argv[2] || path.join(__dirname, 'living-demo-packages.json');
  const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const pinned = JSON.parse(fs.readFileSync(path.join(__dirname, '../godot/living_capabilities.json'), 'utf8'));
  const result = audit(Array.isArray(data) ? data : data.packages, Array.isArray(data) ? null : data.desired ?? null, pinned);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
module.exports = {audit};
