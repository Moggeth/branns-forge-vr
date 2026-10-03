# Crystal wall and mining fracture integration

Original design/source: verified personal Claude Opus 5.5 commission,
`work/opus-weapon-mastery-20261003/output`, 680.545 seconds (root-verified metadata).
The supplied handoff and original modules are retained here. Runtime modules are
`client/crystal-wall.js` and `client/mining-fracture.js`.

`client/world-content-view.js` integrates both through its existing
`sync(snapshot)`, `tick(now,simTick)`, `targets()`, `resolveTarget(hit)` and
`dispose()` API. No additional game-loop hooks are required. Pick-wall deposits
are excluded from ordinary boulders. Normal stone/meteor models keep full scale;
their first hit activates true geometry fracture. Intact deposits retain their
original draw count. Damaged geometry retains authored attributes/materials and
uses the imported interior material for recessed surfaces.

Integration corrections:

- Each authoritative wall segment owns a different `editId`; the artist module
  incorrectly grouped by that field and produced zero tangents. Ordered groups
  of seven nearby persisted deposits now follow the actual curved cast, retaining
  depleted tombstones for stable ordering. A singleton has a valid tangent.
- Existing wall meshes follow subsequent terrain-height changes. Mining depletion
  removes every tagged segment surface. Snapshot rewind/reload with lower damage
  rebuilds intact geometry instead of preserving missing pieces.
- Late joins reconstruct damage without inventing flying chips/crystal fragments.
  Broken debris has no target ID and disables raycasts. Live instanced crystals
  retain the authoritative deposit target ID on each batch, so gaps stay gaps.
- Crystals and plinths are instanced per segment. The original handoff counted
  only crystals: the full seven-segment wall is **2,184 triangles, 28 draws**,
  four shared geometries and three shared materials (down from 84 draws).
- Fracture partition creation now disposes intermediate crater geometries.
  Cache ownership remains reference-counted; borrowed materials are unchanged.

`node multiplayer/tests/mining-geometry.mjs` loads real boulder/meteor GLBs
(geometry and material names; textures are not decoded), verifies 200 inward
raycasts and that removed chunks expose physically deeper crater surfaces,
preserved scale/materials, real crystal instance bounds inside the authority's
1.5 m horizontal/2 m vertical envelope, reanchoring, depletion, late join and
checkpoint rewind. Latest run: 0.163 seconds. Artist offline renders were
inspected; in-game textures, phone draw performance and actual presentation
remain integration/browser acceptance work, not established by this headless test.

Initial test aimed through an actual gap between crystals and correctly missed.
The assertion now aims down at an authored plinth; no hitbox was widened to make
the test pass. Crystal contact always uses visible triangle geometry.

The separate terrain parity integration leaves the global mesh topology unchanged:
`shared/terrain.js` matches `PlaneGeometry(120,120,160,160).rotateX(-PI/2)` exactly,
including Float32 vertices and diagonal `u+v=1`. Do not change renderer resolution
without updating `TERRAIN_GRID` and `tests/terrain-triangles.mjs`. Its 220 real
Three.js raycasts had maximum height error 1.97e-14 metres. No terrain cache is
needed: 10,000 worst-case 64-edit queries took 24.29 ms; 8-player/64-enemy/64-edit
simulation measured 2.777 ms/tick. Same-count mutable edits cannot become stale.

Measured art integration and geometry/parity review interval: 697.178 seconds,
including the 59.597-second exact-terrain implementation/test interval. Timings
are also recorded in ignored `logs/terrain-specials-work-timing.csv`.
