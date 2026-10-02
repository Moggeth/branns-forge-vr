# HANDOFF: Player Character Family (remote Hero body)

**Lane:** opus-sprint-player-character-20261003. All outputs are in this folder. No active checkout, git, credentials, Godot or network were touched.
**Status:** the asset, adapter, narrow hook patch, mechanical tests and offline renders are done and verified as listed below. Nobody has tested it in a browser, in-game or in a headset (see *Not verified*).

## What it is
The adventurer is original and stylized, at 1.75 m. Hero GLBs are high and low LOD on one rig, with 5 clips (Idle, Walk, Run, Attack, Hit). The game gets two colour variants by re-tinting the same 6 shared materials. Reusable VR gloves come with grip anchors. A `hero-view.js` adapter replaces **only** the remote Hero capsule (`basicActor`). Gods, enemies, the local player, physics and the network are unchanged.

| Review image | File |
|---|---|
| Front / ¾ / side / back / back-¾, both variants | `hero/out/contact_sheet.png` |
| Movement pose strip: Idle, Walk ×2, Run ×2, Attack wind-up/strike, Hit | `hero/out/pose_strip.png` |
| Face close-up, both variants | `hero/out/face_closeup.png` |
| High vs low LOD (¾ and back-¾) | `hero/out/lod_compare.png` |
| VR gloves (front/side/back) | `hero/out/vr_gloves.png` |

Iteration history (visual critique): **v1** had a fringe that read as black goggles, a flat slab cape, loud ochre trousers, a floating chest strap and a hook-like ponytail. **v2** brought a swept forelock, a curved flared cape shell, the bedroll moved high across the shoulders, dark trousers and a re-seated bandolier. **v3** attached the sideburns, smoothed the jaw/beard and shortened the strap. **v4 (mechanical fixes):** socket axes, loop seams and the material-slot bug. The gloves and hair tie had lost their leather. **v5** reworked the hands and gloves after a close-up review: the first gloves were crude at VR distance, with an oversized capped cuff and a slab-plus-lump fist. They now have a wrapped leather shell, a curled finger roll, a knuckle row, a riveted back plate, a thumb with a tip over the haft and a stitched rim band. These hands are shared by the body and the VR gloves.

## Files
| Path | Purpose |
|---|---|
| `hero/build_hero.py` | Deterministic Blender 4.5 builder: rig, rigidly skinned parts, clips, sockets, LODs, gloves, exports, `build_report.json` |
| `hero/render_hero.py` | Review renders (Cycles **CPU, 2 threads**, 24 spp + denoise), stitched sheets |
| `hero/palettes.json` | Variant palettes (source for renders; mirrored in `HERO_PALETTES` in hero-view.js) |
| `hero/asset.json` | Asset-lab v1 spec (required nodes, limits, review files) |
| `hero/out/hero.glb` | **Install this.** Rig + `HeroBody` + `HeroHead` (high) + `HeroBody_LOD` (low), 5 clips, sockets |
| `hero/out/hero_lod.glb` | Standalone low LOD (same rig/clips/sockets) for Godot or far-only use |
| `hero/out/hero_hands.glb` | `Glove.L` / `Glove.R` (unskinned), each origin = `GripAnchor.L/R` |
| `hero/out/hero_source.blend` | Editable source scene |
| `client/hero-view.js` | Adapter (copy to `multiplayer/client/hero-view.js`) |
| `patches/game.js.patch` | Narrow hook patch vs frozen `reference/multiplayer/client/game.js` (22 insertions / 3 deletions). `patches/game.js` is the patched full file |
| `tests/hero-check.mjs` | GLB contract and adapter behaviour (Node, three 0.186 from the shared read-only node_modules) |
| `tests/validate.cjs` | Official Khronos glTF validator (read-only module path) |
| `tests/glb_equivalence.py` | Repeat-build comparison (byte or geometric identity; see the cap caveat) |
| `hero/out/hero_check.txt`, `hero/out/khronos.txt`, `hero/out/render.log`, `hero/out/build_report.json` | Saved outputs from the final verification runs |

## Integration (root)
1. Copy `hero/out/hero.glb` to `multiplayer/public/assets/hero.glb`, and `client/hero-view.js` to `multiplayer/client/hero-view.js`.
2. From the directory containing `multiplayer/`, run `git apply patches/game.js.patch`. The headers are `a/multiplayer/client/game.js`. The hooks:
   - import, plus `const heroView = createHeroView()`
   - `upgradeHero(entry)` swaps placeholder and hero both ways on role change. A god uses `basicActor` again.
   - The existing head/hand placeholder block is skipped for hero visuals, so it never recolours the shared materials.
   - On actor removal, `heroView.release(visual)` runs before the existing skeleton/placeholder disposal.
   - A dedicated `loader.load('/assets/hero.glb')` calls `orchard.enableShadowCasting(template)` and then `install`. On failure it reports and keeps the capsules.
   - In the frame loop, `heroView.update(...)` runs after the game applies position lerp and yaw.
   - `heroView.dispose()` in `dispose()` runs before `disposeResources(scene)`. Renderer warmup/compile is untouched.
3. `prebuild` runs `tests/asset-dependencies.mjs`, which I could not see. If it whitelists assets, add `hero.glb`.
4. Run the project's own `npm test` / `build:check`. I did not run them because they aren't present in `reference/`.

## API (`client/hero-view.js`)
- `createHeroView({lodDistance = 16})` returns `{install(gltf), ready(), create(data, {variant, firstPerson}), update(group, data, root, dt, cameraWorldPos), trigger(group, 'Attack'|'Hit'), release(group), setFirstPerson(group, on), setLod(group, far), dispose(), stats()}`.
- `create()` returns a Group with `userData = {hero:true, placeholder:false, variant, model, bones, heroMixer, heroActions, ...}`. The mixer is private (`heroMixer`, not `mixer`), so game.js's enemy animation selector and the `mixers` set ignore it.
- `heroVariant(id)` is an FNV hash mapped to `'emberwright' | 'mosswarden'`. It is deterministic per player id.
- `heroSocket(root, 'Hand.L')` finds the dotted glTF names. **three's GLTFLoader strips dots** (`Hand.L` becomes `HandL`, and bones `Palm.R` become `PalmR`); Godot keeps them.
- Exports: `HERO_PALETTES`, `HERO_SOCKETS`, `HERO_LOCOMOTION`, `HERO_LOD_DISTANCE`.

### Animation: derived locomotion vs future authoritative clips
- **Locomotion, derived (live):** smoothed horizontal speed of the interpolated actor root. Below about 0.25 m/s it plays Idle. Walk blends to Run between 2.6 and 3.8 m/s. `timeScale` = speed / authored stride speed (Walk 1.6 m/s, Run 4.2 m/s, clamped). I could not see the simulation's player move speed in `reference/`, so tune `HERO_LOCOMOTION` against real runs.
- **Hit (derived from authority):** plays when the snapshot `hp` drops. It is never invented.
- **Attack (future):** the clip is authored and exported but **never auto-played**. The snapshot carries no authoritative remote swing state (players expose `tool` but no `attackTick`). When the server adds one, call `heroView.trigger(visual, 'Attack')` from it. The test asserts Attack does not autoplay.
- **Loop notes:** 24 fps. Idle is 48 frames (2.0 s), Walk 24 (1.0 s; contact at 0 and 0.5), Run 16 (0.667 s). Each is keyed 0…N with first = last, and the test checks every track. Attack is 18 frames (0.75 s: wind-up peak at f6, strike at f10, recovered by f18). Hit is 12 frames (0.5 s: peak f4). One-shots fade over the locomotion layer.

### VR remote players
When `data.head` exists, game.js zeroes the root yaw. The adapter turns the body to the head's yaw (smoothed) and stands it 6 cm behind the head position. If `data.hands[0/1]` exist (left/right, the game.js order), a rigid two-bone arm IK reaches the tracked grip. The palm is oriented so `WeaponGrip` matches the tracked grip pose: grip −Z maps to haft +Y. In the Node test the tracked-grip landing error is 0.000 m. Like the old placeholder, it treats tracking-space orientation as world because the root yaw is 0. It does not crouch to follow head height.

### Local hero / first person
syncActors already skips `playerId`, so the local hero is **never instantiated**. For a future visible local body, `create(data, {firstPerson:true})` or `setFirstPerson()` hides the separate `HeroHead` mesh, so the own head never renders. The gloves are separate in `hero_hands.glb` for first-person/VR hands.

## Contract and sockets (measured from the exported GLB in three.js)
- Axes: metres, +Y up, **−Z forward**, +X = hero's right. Feet at origin. Bounds: X ±0.325, Y 0…1.776 (top of hair), Z −0.21…+0.263 (cape/bedroll behind). The test asserts `Hand.R` is at +X and `Head` is forward of the origin.
- `Head` (0, 1.645, −0.06): eye centre. −Z = gaze, +Y = up.
- `Hand.L` / `Hand.R` (∓0.264, 0.835, −0.03): palm centre, body axes at rest.
- `WeaponGrip` (0.264, 0.835, −0.04), right fist: local +Y = haft toward the weapon head, local −Z = edge/strike direction. At rest the haft points world −Z and the edge world −Y (test-asserted). `WeaponGrip.L` is the mirror for off-hand/two-hand use.
- Gloves: `GripAnchor.L/R` have the same axis convention as `WeaponGrip`. The glove origin is the anchor.
- Bones: Root, Hips, Spine, Chest, Neck, Skull, Cape, UpperArm/Forearm/Palm.{L,R}, UpperLeg/LowerLeg/Foot.{L,R}. Every part is rigidly weighted to one bone, with joint spheres hiding the seams.

## Budgets (measured)
| | Budget | Actual |
|---|---|---|
| High LOD (HeroBody+HeroHead) | ≤ 12,000 tris | **9,280** (body 6,528 + head 2,752) |
| Low LOD (HeroBody_LOD) | ≤ 3,000 | **1,506** |
| Materials | ≤ 6 | **6** (HeroSkin, HeroHair, HeroCloth, HeroTrim, HeroLeather, HeroMetal); 0 images |
| hero.glb (both LODs + clips) | ≤ 2 MB | **497 KB**; hero_lod.glb 173 KB; hero_hands.glb 39 KB |
| Draws per hero | — | high 9 primitives (6 body + 3 head), low 6 |
| 8 heroes | — | **12 unique materials total** (6 × 2 palettes, shared, asserted). Geometry is shared via SkeletonUtils.clone. Adapter CPU update **0.086–0.11 ms/frame for 8 heroes** in Node (excludes GPU skinning/draw) |
| Gloves | — | 820 tris each; HeroSkin, HeroLeather, HeroMetal, HeroTrim (shared names, so palettes apply) |

## Exact test commands (from this folder)
```powershell
$B="C:/Users/mog/OneDrive/Documents/Coding/Personal/Python/things_are_different_now/branns-forge-vr/tools/blender-4.5.13-windows-x64/blender.exe"
& $B -b --factory-startup -t 2 --python-exit-code 1 --python hero/build_hero.py -- --out "$PWD/hero/out"
node tests/hero-check.mjs        # prints metrics, ends HERO_CHECK_OK
node tests/validate.cjs          # Khronos: 0 errors on all three GLBs
& $B -b hero/out/hero_source.blend --python-exit-code 1 -t 2 --python hero/render_hero.py -- --out "$PWD/hero/out"
python tests/glb_equivalence.py <buildA>/hero.glb <buildB>/hero.glb
node --check patches/game.js
# render only the VR glove sheet:
& $B -b hero/out/hero_source.blend --python-exit-code 1 -t 2 --python hero/render_hero.py -- --out "$PWD/hero/out" --gloves-only
```
Patch application was verified in a disposable temp git repo: `git apply patches/game.js.patch` on a copy of the frozen `multiplayer/client/game.js` gives content equal to `patches/game.js` (the original file is CRLF; git preserves it).

## Measured times (this PC, 2026-10-03)
- Build: 0.69–0.96 s in-script, about 1.1 s wall.
- Render: 85–99 s wall for the full 29-tile Cycles CPU pass at 2 threads (final pass 98.2 s), about 3 s per 360×520 tile. `--gloves-only` takes 7 s.
- `hero-check.mjs`: 0.08 s.
- Khronos validation: under 2 s.
- Session start was 06:56. The first GLB was exported about 7 minutes in, the first handoff was written about 19 minutes in, and work finished at about 07:23 (about 27 minutes).

## Validation results
- `HERO_CHECK_OK`. It covers budgets, sockets (dot-stripped lookup), clip lengths and loop seams, axes, WeaponGrip rest axes, shared materials across 8 heroes, both variants, walker/runner/idle weights, Hit on HP drop, Attack not autoplaying, VR grip error 0, LOD switching, release with no leak, and dispose.
- Khronos: 0 errors. There are warnings `NODE_SKINNED_MESH_NON_ROOT` (the Blender exporter parents skinned meshes under the armature node; three.js and Godot handle this, and the skeleton/golem assets export the same way).
- Repeat builds are **not byte-reproducible**. Fixed: set-ordered bevel input (now index-sorted), export-time quad diagonals (now explicit `FIXED` triangulation) and loop/material bugs. Still open: the glTF exporter's index-buffer order varies, and occasionally a **flat cap n-gon gets a different but coplanar diagonal**. This happens with both EAR_CLIP and BEAUTY, so it is visually identical (same plane, same outline). In 6 sampled rebuilds, `tests/glb_equivalence.py` reported GEOMETRY_IDENTICAL for most files, but some runs flagged one file (hero.glb or hero_hands.glb) as DIFFERENT for exactly that cap case. Nodes, sockets, animation data and vertex data matched in every run. An attempt to use `cap_tris=True` fans broke the geometry (cap centres weren't transformed, which dropped the hair tie), so I reverted it. The likely clean fix is to build cap fans manually.

## Not verified / known limitations
- **Not run in the browser game, WebGL or a headset.** The adapter and patch were exercised only in Node (three without a renderer) and by `node --check`. Root should load a room with 2+ clients and check facing, scale beside trees/forge, LOD pop and shadows. Godot import was not run (root validates serially).
- **No weapon on remote heroes yet.** `data.tool` is available and `WeaponGrip` is ready, but choosing the weapon models, scale and `asset-pose` contracts is a root decision. I did not invent it.
- No textures. The material definition comes from silhouette, bevels, colour blocking and metal/leather roughness. A small shared detail texture would be the next quality step.
- Rigid skinning: extreme poses could open small gaps at the shoulders and hips. The current clips were reviewed in renders only at the strip frames.
- The low LOD drops the eyes, brows and small buckles, which is intended past 16 m. The LOD switch is a hard swap.
- Locomotion speeds are estimates (see above). The VR body ignores crouch and lean.
- The face reads as male and bearded in both variants because variants are material-only by design. A geometry variant (hairstyle or beard toggle) would require mesh switches, which this cut does not include.
