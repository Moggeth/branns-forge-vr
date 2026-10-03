# Weapon readiness — handoff (finish pass, 2026-10-03)

Module: `output/weapon-readiness.js` (ES module, imports `three`). `node --check` passes.
This pass made no new renders and did not open a browser or Blender. The only runtime evidence is the earlier
run's report: `../opus-weapon-readiness-20261003/output/preview/captures/report.txt` and `grid.png`. That
report came from the unchanged earlier module, before the fixes below.

## API
```js
import {createWeaponReadiness, syncWeaponReadiness, READINESS_TIMINGS, ANCHORS} from './weapon-readiness.js';
let r = syncWeaponReadiness(r, {root, tool, reducedMotion});   // per frame or on equip; rebuilds only when root/tool changes
r?.update({attackReady, specialReady, heat, overheated, time}); // all 0..1 fractions from the shared simulation
r?.dispose();                                                   // or syncWeaponReadiness(r, {root: null})
```
- `tool`: `axe | pick | hammer | crossbow | bow | limb | wyrmspout | flask`.
- Readiness comes only from simulation fractions; the module has no timers of its own. `READINESS_TIMINGS` only
  documents the authoritative durations. A missing `attackReady`/`specialReady` counts as ready, and a missing
  `heat` counts as cold. Pass `time` (seconds). Without it, the 0.42 s ready pulse falls back to a 1/60 s step
  per update. The pulse fires once, on the change from not ready to ready. `reducedMotion` turns it off.
- Returned object: `{group, host, tool, root, drawCalls, update, dispose, disposed, setReducedMotion}`. It is
  also stored at `root.userData.weaponReadiness`. Calling create again on the same root disposes the old one first.

## Root and placement
- `root` must be the authored weapon object. That means the `prepareAsset().model` GLB clone or its canonical
  `visual` wrapper, the `createEmberdewModel()` group (wyrmspout), or the detached held limb group. Do not pass
  the hand socket or controller.
- Anchors are found by authored node names (`ANCHORS`). Name matching ignores case, spaces, `_`, `.` and `-`.
  One `readiness:<tool>` group is added to the anchor's parent, so it follows canonical scale, basis and mirroring.
  Authored nodes, sockets, transforms, geometry and materials are never changed.
- Placement is measured from authored vertices or raycasts, offset 0.4–4.2 mm outward, so indicators are not
  hidden inside the mesh. The earlier report's worst surface gaps ranged from 0.09 mm (wyrmspout) to 3.14 mm
  (pick). All indicators were inside model bounds + 15 mm.
- Every descendant gets `userData.ignoreContact = true` and `readinessOwned = true`.

## Draw budget
No lights, no shadows, and one InstancedMesh per segment strip. Draw calls from the earlier report: axe 1,
pick 2, hammer 2, crossbow 3, bow 1, limb 1, wyrmspout 2, flask 1. The upper limit is 3 per tool. Strips
only rewrite colours when the quantised value, mode or pulse changes.

## Fixes in this pass (definite defects only)
1. Per-frame allocation: `Strip.paint` created a `Color` on every repaint, and the wyrmspout heat path created
   two `Color`s on every update. Both now reuse module-level scratch colours.
2. If `root` itself matched an anchor name, the group would have been added to `root.parent`, outside the
   authored model. It now goes on `root`.
3. `syncWeaponReadiness` ignored `reducedMotion` changes when it reused an instance. It now applies them.

## Limitations
- Placement depends on the authored node names in `ANCHORS` and on the named sub-nodes each layout looks up
  (for example `CuttingEdge_Mid`, `HeadSocket`, `Neck_Scales`, `HeatVent_L1..R3`). Renamed assets fail with an
  anchor error or a TypeError, not by falling back to some other position. This is deliberate: nothing is placed
  on a substitute part.
- The limb uses bind-pose vertices plus a raycast on the current pose. Skinned or bent limbs are only roughly
  supported; the earlier report tested `rightArm` only.
- Placement is computed once at build time. If the model's geometry changes later, rebuild by passing a new root.
- The flask wick toggle is instant, so it has no indicator. The bow's curve adds no cooldown.
- Not done here: integration into the real game client, and checking how it looks in an actual browser or HMD.
  Both still need testing in the real client.
