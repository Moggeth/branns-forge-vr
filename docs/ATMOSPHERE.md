# Orchard atmosphere and environment (2026-09-29)

The playable Orchard Highlands now uses one connected lighting, terrain, foliage, water and weather setup. The implementation targets Godot 4.7.2's **Mobile renderer**, including the Vive Pro 2 stereo path. It deliberately avoids screen-space post-processing, shadowed per-particle lights, true volumetric ray marching and large-area dynamic foliage shadows. The rest of the game's zones retain their existing authored atmospheres; the shared native weather UI now includes the Orchard.

## What changes in the world

- `atmosphere_pipeline.gd` drives the Orchard's single sun, sky colours, ambient fill, filmic tone map, distance/height fog, aerial perspective and sun scattering from the same clock and weather state. Shadow distance is bounded by quality tier (28/44/56 m), with one or two splits. Foreground interaction stays clear while the 320 m landscape falls gently into haze.
- `orchard_ground.gd` blends grass, soil, leaf litter, worn paths, stone and damp banks using macro masks, regional noise, small-scale albedo/normal maps and a shared wet/snow state. `scripts/build_orchard_materials.py` regenerates the source maps. World-builder paths paint this same mask immediately and remain saved by the existing settlement system.
- `orchard_dressing.gd` scatters nine Opus 5.5-authored fern, grass, flower, litter, branch and mossy-rock assets in ecological patches. The distribution samples the *same* terrain mask, avoids paths/camp/bridge, and uses bounded 64 m MultiMesh chunks. Rock proxies have collision. New player-made paths clear both undergrowth and rock proxies immediately; saved paths rebuild clear on the next visit. The brook bank now uses batched authored stones instead of dozens of individual primitive nodes.
- `orchard_foliage.gd` gives batched grass, shrubs, tree crowns and the new undergrowth different subtle GPU wind responses. Weather supplies one wind direction/strength to foliage, rain streaks, mist and the shafts. Rain darkens and smooths the ground and plants. The imported assets retain their tiny authored albedo/roughness atlas rather than flat vertex colours.
- `orchard_atmosphere.gd` places a bounded handful of crossed-quad sunshafts beside *actual* tree crowns near trails. They follow the real sun vector and are depth-occluded by world geometry, with stronger visibility at low sun angles. A few shallow drifting mist patches sit over the brook. These are geometry effects, not expensive ray-marched volumes. The brook has animated current, varied roughness, bank foam and rain ripples. The existing bounded native precipitation/impact-sound system follows the Orchard Hero and wets the environment; stars now follow the Hero at night rather than staying near the Forge.

The art stays stylised: readable low-poly silhouettes and textured material variation, with restrained mist/shafts instead of a photorealistic forest. The kit's [editable Blender source, build script, atlas and contact sheet](../assets/atmosphere/woodland-kit/HANDOFF.md) are committed, as are the nine playable GLBs and their imported texture sidecars.

## Quality and tuning

Add one launch argument to the Godot game command, after `--`:

| Argument | Orchard kit instances | Sunshafts / mist patches | VR rain cap | Shadow reach |
|---|---:|---:|---:|---:|
| `--atmosphere-quality=low` | ~5,809 | 4 / 2 | 220 | 28 m |
| default balanced | ~12,360 | 8 / 5 | 360 | 44 m |
| `--atmosphere-quality=high` | ~16,687 | 12 / 7 | 480 | 56 m |

Desktop rain caps are 300/480/640. Existing **palm menu → Weather** can switch clear/rain/snow, day/night, automatic weather and sound. All counts are ceilings or deterministic generated-instance counts, not a promise of identical visible counts at every camera position. Chunk visibility ranges are 30–85 m by asset; cheap grass and litter drop first. A new species should supply an opaque one-surface mesh and a useful near/mid/far range, then enter `COUNTS`, `CULL` and `_chance` in `orchard_dressing.gd`. Keep the same shared material/wind convention. An important landmark may use its own mesh, but avoid adding one draw call per pebble.

Material knobs live in `orchard_ground.gd` (blend, wetness/roughness and normal depth); sky/fog and shadow ranges in `atmosphere_pipeline.gd`; shaft/mist opacity and water roughness in `orchard_atmosphere.gd`; weather particle/audio budgets in `weather_lab.gd` and `weather_runtime.gd`. The masks and source-map generator are committed, so small retunes do not require another art commission. The authored woodland kit can be rebuilt and reinstalled with `python scripts/rebuild_woodland_kit.py` after `Setup Tools.ps1` installs project-local Blender/Godot. That command imports all nine GLBs and checks they retain one textured surface. Do not edit copied Godot GLBs by hand; edit the Blender builder or source and run the installer.

## Verification and performance evidence

Run from the project root with `tools/godot/Godot_v4.7.2-stable_win64_console.exe`. **Keep `-- --atmosphere-test`** on the scene checks: it prevents loading or saving the real player world and weather state. The scripts refuse to launch without it. Check both the named result marker and absence of `SCRIPT ERROR`/`ERROR:`; Godot sometimes returns exit 0 after a script error.

```powershell
python scripts/rebuild_woodland_kit.py
tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://atmosphere_checks.gd --quit-after 1200 -- --atmosphere-test
tools/godot/Godot_v4.7.2-stable_win64_console.exe --xr-mode off --audio-driver Dummy --path godot --script res://atmosphere_visual_check.gd --quit-after 1200 -- --atmosphere-test
tools/godot/Godot_v4.7.2-stable_win64_console.exe --xr-mode off --audio-driver Dummy --path godot --script res://atmosphere_stress_check.gd --quit-after 1800 -- --atmosphere-test
```

Expected markers: `ATMOSPHERE_ASSET_RESULT []`, `ATMOSPHERE_RESULT {"failures":[]...}`, `ATMOSPHERE_VISUAL {..."path_clear_gpu":true}`, and `ATMOSPHERE_STRESS {..."skeletons":24}`. Visual captures go to ignored `outputs/orchard-camp-day.png`, `orchard-sunbeams.png`, `orchard-brook-rain.png` and `orchard-camp-night.png`. For the true shared-world load, add `--atmosphere-second-view` to the stress command. Existing `--world-builder-check` and `--weather-game-check` regressions should remain clean.

On this RTX 3080 Ti desktop using Godot Mobile, the warmed **balanced** 24-skeleton Orchard stress gave a 120 FPS median in clear and rain, with 229–230 median draw calls and ~9 ms median process time. With the actual second world-builder viewport, the median remained 120 FPS, draw calls were 259–260, and median process time was ~10–11 ms. The window was capped at 120 FPS. Single-view captures include shader warmup and are not steady-state measurements. These numbers are whole desktop scenes, not incremental atmosphere cost, GPU frame time or a Vive Pro 2 stereo benchmark. Logs are in ignored `logs/atmosphere-stress-*.log`.

**Headset acceptance remains:** stand near camp and brook at sunlit, low-sun, rainy and night states; walk toward distant hills; inspect close ground while moving; make a new path through dense undergrowth; check water, canopy shafts, rain audio and snow/wet transitions; then repeat with 24 skeletons and the second viewport. Measure headset CPU/GPU frame times and reprojection at the Vive Pro 2's active refresh setting. If margin is poor, start with the `low` tier; do not infer stereo success from the desktop counter. The user can keep playing on the previous build until the game is relaunched.

## Design limits and next extension

Godot Mobile does not make the brief's Three.js WebGPU compute rain, GodraysNode, Forward+ GI or volumetric fog directly applicable. The current sunbeams are world-anchored transparent geometry with depth interruption, so they read best through nearby canopy gaps; they do not integrate physically with every occluder's shadow map. The water is a stylised local brook shader, not an ocean reflection system. Grass and distant vegetation rely on material/shadow hierarchy and culling rather than full plant LOD impostors. The weather scan is a bounded 24 m field with a static top-surface exposure model; it does not simulate arbitrary overhead interiors. These tradeoffs keep the system predictable, art-directable and affordable for stereo VR.

Future regions can reuse the weather adapter, palette/shadow pipeline, terrain masks and one-surface instancing conventions. Each region should contribute its own ecological masks, local mist/water anchors and quality budgets while consuming the same clock, wind and wetness state. That gives the growing shared world variation without multiplying unrelated effect systems.
