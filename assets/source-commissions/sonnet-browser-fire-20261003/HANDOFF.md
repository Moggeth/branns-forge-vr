# Fire presentation handoff

Files: `fire-presentation.js` (imports only `three`; passes `node --check`; **not run in a browser or renderer**, so all visuals and numbers below are untested).

## API
```js
import { createFirePresentation, createEmberdewModel } from './fire-presentation.js';
const fire = createFirePresentation({ scene, height: (x,z)=>groundY, quality: 1, lightIntensity: 6 });
fire.sync(snapshot);        // ~20 Hz; reads tick, projectiles, fireSurfaces, fireCells (players/enemies ignored)
fire.update(nowMs, dt);     // every frame; nowMs = same clock each call (e.g. rAF timestamp), dt seconds
fire.stats(); fire.dispose();
fire.invalidateTerrain();   // extra: call if ground height changes under existing cells
fire.setQuality(0..1);      // extra
```
- Units: positions in metres, projectile velocity in m/s, ticks 60 Hz. Cell x/z are rounded to multiples of 0.5.
- `sync` timestamps packets with the `nowMs` of the last `update`. Extrapolation is capped at 50 ms; positions are eased (30/s) to the extrapolated target, so there is no snapping.
- A packet missing from a snapshot fades out over 0.18 s while frozen after the 50 ms cap. No independent motion.
- Surface patches fade in the last 0.5 s before `expiresTick` (uses `snapshot.tick` plus elapsed time) or 0.25 s after dropping from the snapshot.
- `quality` 0 emits no flames/embers/smoke and all light intensities go to 0. The fuel surface still draws, since it is gameplay-readable. Below 0.75 uses 1 tongue per packet/patch, below 0.5 drops embers, below 0.25 drops smoke.

## Budgets (stats() reports actuals)
- Draws: 4 max (fuel mesh, flame, ember, smoke). Lights are not draws.
- Instances: flame 448, ember 192, smoke 128 = **768 cap**.
  - Flame: 2 per packet (192), 2 per patch (64), up to 192 from burning cells.
  - Ember: 1 per packet (96) and per patch (32), plus up to 64 from cells.
  - Smoke: 1 per patch (32), plus up to 96 from cells.
- Fuel mesh: up to 256 cells x 32 triangles = 8192 triangles, 6400 vertices, all preallocated. Instanced tongues are 12 triangles each (about 5.4k at the flame cap).
- Cells over the effect budget are chosen by a position hash, so the subset is stable and does not shuffle.
- Lights: 3 preallocated shadowless PointLights, distance 3-5 m, orange 0xff8f45, decay 2. **Intensity is in candela under the modern physical light model** (default scale 6 via `lightIntensity`); retune on first browser look. A legacy-lights renderer will need a different scale.
- Per-frame allocation: none intended in `update`. `sync` allocates only the `asg` array and Map entries for new ids.

## Visual decisions
- Flame tongues are 3x7 segmented strips, axis-aligned along motion and billboarded around that axis in the vertex shader. They bend with a sine, have a teardrop width and an additive white-yellow core, amber mid and red edge.
- Packet tongues trail opposite velocity with a slight upward lift. A deterministic ember trail lags behind the packet.
- Surface tongues start at the patch, rise along the **actual normal** (upward for floors) and lean upward on walls. Roots hop around each cycle with a tangent offset. There are no decals or rings.
- Fuel is **one connected mesh**, not circles. Cells are a world-aligned 0.125 m lattice per cell, and the fuel field is bilinear between cell centres, so neighbours merge seamlessly. The irregular edge comes from a fragment threshold on field + world-space fbm, so it is camera-independent. The surface is dark amber and about 93% opaque, with a meniscus normal from the field gradient, slow flow noise, pearlescent fresnel tint, a spec highlight and thin refraction-like streaks. Burning cells add an animated ember glow.
- z-fighting is handled with a 3 cm lift (+1.2 cm meniscus), polygonOffset, non-overlapping cell squares and `depthWrite: false`.
- Fuel geometry is rebuilt only when the cell signature (fuel quantised 1/32, heat 1/16, burning flag, cell set) or terrain version changes. A heat-only change below 1/16 will not rebuild.
- Lights follow 2 m bucket centroids of packets and of burning cells. Assignment keeps the same key, then picks the nearest candidate within 2.5 m, then the best score. A swap needs a 1.6x score advantage. Position, intensity and distance are smoothed.
- There are no expanding spheres or shockwaves.

## Ember Dew
`createEmberdewModel()` returns a Group about 0.18 m tall with its origin at the bottle middle, +Y up, -Z forward. It has a lathe glass flask with a grip waist, an amber liquid mesh, leather wrap, copper foot band and neck collar, a leather stopper with a wick, and a `Muzzle` Object3D at (0, 0.066, -0.017).
- 7 draws, with materials shared inside the model. `group.userData.stats` has the triangle count (under 2k by construction, not measured here).
- Call `group.userData.dispose()` to free geometry and materials.
- The Muzzle sits at the front of the neck. The stopper is cosmetic, so treat the pour as a tilted bottle.

## Limitations and untested
- Not visually verified. Shader colours are authored without sRGB conversion, so expect to adjust brightness if the renderer uses tone mapping.
- Smoke is unsorted alpha with low opacity.
- The fuel field reads as thin film when fuel is below about 0.3, and an isolated full cell renders as a rounded square blob.
- Candidate lights are capped at 640 buckets.
- Cell coordinates are keyed in 16 bits (±32768 cells, ±16 km), which is fine for the stated map sizes.
- Cell tongues are timed from `nowMs`, so they stay deterministic per cell but are not synchronised across clients.
