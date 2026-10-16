// Road paving: the main road and the landmark footpaths are laid with flagstones that stay inside their road, follow
// the terrain, rebuild after edits, never block raycasts or cast shadows, and stay within a phone-safe budget.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createRoadPaving, layRoute, pavedRoutes} from '../client/road-paving.js';

const routes = pavedRoutes(), main = routes.find(r => r.id === 'main');
const stones = layRoute(main, 901);
assert.deepEqual(layRoute(main, 901), stones, 'every peer lays the same stones');
const routeDistance = (r, x, z) => Math.min(...r.points.slice(1).map(([bx, bz], i) => { const [ax, az] = r.points[i], dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz))); return Math.hypot(x - ax - dx * t, z - az - dz * t); }));
for (const r of routes) for (const s of layRoute(r, 7)) assert.ok(routeDistance(r, s.x, s.z) < r.half, `${r.id}: stone at ${s.x.toFixed(1)}, ${s.z.toFixed(1)} left the road`);
assert.ok(stones.filter(s => s.kind === 3).length > 100, 'the main road has kerbs');
let h = (x, z) => Math.sin(x * .1) * .5 + z * .02;
const scene = new THREE.Scene(), paving = createRoadPaving({scene, height: (x, z) => h(x, z)});
const stats = paving.stats();
assert.ok(stats.stones > 900 && stats.stones < 2600, `stone count ${stats.stones}`);
assert.ok(stats.draws <= 4 && stats.triangles < 90000, JSON.stringify(stats));
const mesh = paving.group.children[0], m = new THREE.Matrix4(), p = new THREE.Vector3();
mesh.getMatrixAt(0, m); p.setFromMatrixPosition(m);
assert.ok(Math.abs(p.y - (h(p.x, p.z) - .06)) <= .0100001, 'stones sit on the ground (within their centimetre of lift)');
h = (x, z) => 3; paving.update(); mesh.getMatrixAt(0, m); p.setFromMatrixPosition(m);
assert.ok(Math.abs(p.y - 2.94) <= .0100001, 'stones re-seat after the terrain changes');
paving.setLandmarks(false); const without = paving.stats().stones; paving.setLandmarks(true);
assert.ok(paving.stats().stones > without, 'landmark footpaths come and go with the landmarks');
const hits = new THREE.Raycaster(new THREE.Vector3(0, 10, -12), new THREE.Vector3(0, -1, 0)).intersectObject(paving.group, true);
assert.equal(hits.length, 0, 'paving never catches strikes or casts');
assert.ok(paving.group.children.every(c => !c.castShadow));
paving.dispose(); assert.equal(scene.children.length, 0);
console.log(`road paving: ${stats.stones} stones in ${stats.draws} draws, ${stats.triangles} triangles`);
