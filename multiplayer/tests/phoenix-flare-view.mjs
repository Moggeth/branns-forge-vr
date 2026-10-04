import assert from 'node:assert/strict';
import * as T from 'three';
import {createPhoenixFlareView, FLARE_VIEW} from '../client/phoenix-flare-view.js';

const template = new T.Group(), geometry = new T.BoxGeometry(.5, .5, .5), material = new T.MeshBasicMaterial();
template.add(new T.Mesh(geometry, material));
const scene = new T.Scene(), view = createPhoenixFlareView({scene, templates: new Map([['wings', {scene: template}]])});
const owned = new Set(), released = new Set();
function burst(x) {
  const flare = view.burst({position: [x, 8, 0]});
  const materials = new Set(); flare.ghost.traverse(n => {if (n.isMesh) materials.add(n.material);});
  assert.equal(materials.size, 1, 'one material shared within a burst');
  const m = [...materials][0]; owned.add(m); m.addEventListener('dispose', () => released.add(m));
  return {flare, m};
}
try {
  const first = burst(0); view.update(.7); const opacity = first.m.opacity;
  const second = burst(3);
  assert.notEqual(first.m, second.m, 'different bursts own independent fades');
  assert.equal(first.m.opacity, opacity, 'new burst does not relight an older phoenix');
  assert.ok(second.m.opacity > first.m.opacity);
  for (let i = 0; i < FLARE_VIEW.max + 2; i++) burst(i + 6);
  assert.equal(view.stats().flares, FLARE_VIEW.max);
  assert.equal(owned.size - released.size, FLARE_VIEW.max, 'replaced bursts release their materials');
  view.update(8);
  assert.equal(owned.size, released.size, 'expired bursts release every owned material');
  burst(20);
} finally {
  view.dispose(); geometry.dispose(); material.dispose();
}
assert.equal(owned.size, released.size, 'view disposal releases remaining burst material');
console.log('phoenix-flare-view: independent fading and bounded material disposal pass');
