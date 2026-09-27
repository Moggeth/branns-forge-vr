# Asset Lab: programmatic 3D modeling for Brann's Forge

## Decision

Use **scripted Blender as the source of truth**, GLB as the interchange format, and an automated Godot import as the last machine gate. Let image generation, Claude/other artists, CAD and local image-to-3D models supply *inputs* to that pipeline, rather than letting any one of them write directly into the live game. The actual gameplay interaction—grips, collision, haptics, firing, heat, animation control—remains a Godot contract. A convincing GLB alone does not implement those behaviors.

This fits the project's established Siegebird, Orchard's Edge, player, guardian and ground-kit workflows. It also addresses the missing common step: previously each asset commission had a separate build/handoff/test script. The shared gate now checks every submitted GLB the same way, while specialized checks (Siegebird clearance, guardian animation, grip poses) still remain necessary.

The reviewed, repeatable path is:

```text
brief / concept image / parameters
    -> versioned asset.json + deterministic Blender builder
    -> editable .blend + self-contained model.glb + preview angles
    -> structure/budget check + official Khronos glTF Validator
    -> disposable Godot 4.7.2 import + bounds/marker check
    -> visual, interaction and headset review
    -> intentional promotion into godot/ + relevant gameplay test
```

Asset Lab never overwrites a playable model as a side effect of a build. The review bundle under `outputs/asset-lab/` is ignored by Git. Promote only the reviewed artifact, preserve its source and original brief, then run the asset's own in-game check. This is the appropriate boundary for the game's hot-loading system too: it can accept validated GLBs and supported behavior packages, but a genuinely new engine primitive still requires code and a game restart.

## What is installed now

- `scripts/asset_lab.py`: `build` and `inspect` commands, stable JSON report, hashes, measured stages and durable logs. It rejects external GLB buffers/images, missing or duplicate required marker names, budgets and incorrect Godot-imported dimensions.
- `assets/asset-lab/validate-gltf.cjs` plus a pinned `package-lock.json`: official Khronos validator, including buffer/accessor checks beyond our small structural scanner. Errors fail the gate; warnings and informational messages remain in `khronos-report.json` for review.
- `scripts/asset_lab_import.gd`: runs inside a temporary Godot project, never the live save or service. It reports imported mesh count, surface material slots, node names, animation names and actual scene bounds.
- `assets/asset-lab/pilot/`: deterministic hand-scale Forge Yard lantern builder, editable Blender scene and front/side/three-quarter output. The exported `Grip` and `Flame` markers are future interaction sockets; its glowing chamber is an opaque, inexpensive visual. Flame behavior and collision are deliberately not invented by the model.
- `assets/asset-lab/siegebird.json`: a second, much more complex contract used to inspect the **existing installed** Siegebird. Its own mechanism and clearance test stays in `scripts/Build-Siegebird.ps1` and `docs/SIEGEBIRD-OPUS.md`.
- `scripts/Setup-AssetLab.ps1`: on a fresh Windows checkout it installs the official Blender 4.5.13 ZIP only if absent, verifies its pinned SHA-256, restores the locked validator package, and optionally runs the pilot smoke test. Run the game's `Setup Tools.ps1` first for Godot. No AI-model weights are downloaded by setup.

From the project root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Setup-AssetLab.ps1 -SmokeTest
python scripts/asset_lab.py build assets/asset-lab/pilot/asset.json
python scripts/asset_lab.py inspect assets/asset-lab/siegebird.json godot/assets/siegebird/siegebird.glb
python scripts/test_asset_lab.py
```

Supply `--out outputs/asset-lab/my-review` to keep a named bundle. On another machine, `--blender` and `--godot` can override the bundled executable paths, and `BRANN_BLENDER` / `BRANN_GODOT` are supported environment overrides. A new builder must accept `-- --out ABSOLUTE_DIRECTORY` and emit `model.glb`. The spec lists any further review files and named nodes. A GLB from a separate artist or generator can use `inspect` without adopting the Blender builder interface.

The version-1 spec is intentionally small. `schema_version`, `asset_id`, `kind`
and `limits` are required. `kind` is `prop`, `weapon`, `character` or
`environment`; this is descriptive until category validators arrive.
`builder` is a repository-relative script path for `build`; inspect-only specs
omit it. `required_nodes` names interaction parts/markers that must survive
both GLB export and Godot import. `limits.max_bytes`, `max_triangles`,
`max_meshes`, `max_materials` and `max_images` are per-asset ceilings, not
universal performance guarantees. `max_dimensions_m` is an optional X/Y/Z
size gate measured by Godot. `review_files` names additional outputs such as
`source.blend` and preview images. `coordinate_system`, `source_builder`,
`source_scene` and `installed_asset` record authoring intent/provenance; they
are not engine behavior by themselves. See the pilot and Siegebird specs for
concrete examples.

For each asset, preserve `asset.json`, source `.py`, and the *final editable* `.blend` in tracked `assets/` once accepted; generated review captures remain in ignored `outputs/`. Include exact scale/orientation, grip and effect sockets, part names, material/texture provenance, intended collision proxies and any authored clips. An image texture should be embedded in the GLB. Record the prompt/commission version and source image license in the asset handoff; the build report already records source and artifact hashes. The current authored collection is uneven here: Siegebird is complete, but some final editable scenes still live only in ignored `work/` and the installed ground kit has only a tracked brief. Curate those files before relying on a fresh checkout to reproduce every existing asset.

### Pilot evidence on this PC

This machine has an RTX 3080 Ti with 12 GiB dedicated VRAM (7.7 GiB free at the measurement). Blender 4.5.13 LTS, Godot 4.7.2 and the official validator are available. The first lantern review build produced a 73,044-byte GLB, 904 triangles, 26 mesh parts, five materials, 28 nodes and no external images. Khronos reported **0 errors and 0 warnings**. Godot imported its `Grip`/`Flame` markers and measured **0.146 × 0.347 × 0.188 m**, matching the contract. The full build/validate/import gate took **3.692 s** on that measured run; the four focused regression checks took **3.754 s**. A later textured/shuttered revision installed as the integration prototype is 113,924 bytes and 1,016 triangles; it passed the same gate in **3.788 s**. Existing Siegebird independently passed the generic gate in **2.994 s** at 68,252 triangles and 3.46 MB. These are local wall-clock results, not VR performance measurements.

### Independent artist trial

The [forge lantern comparison](../assets/asset-lab/lantern-comparison/README.md) uses the pilot's interaction contract for two independent artists, GPT-6 Sol and Claude Opus 5.5. Both final GLBs passed Khronos and disposable Godot import; the installed adapter supplies grip, two-hand shutter movement, light, and drop/return physics. A 53-check Godot script exercises both in one run. This is stronger evidence than import alone but does not establish in-headset comfort or frame timing. Artist source scenes, builders and previews are tracked beside their specs; generated logs and rebuilds remain ignored. Opus's first 25 cm X/Z gate failed at 25.9 cm, then a reviewed 27 cm envelope passed. Its source rebuild is structurally equivalent but not byte-identical, so published GLB hashes remain the release identity. Sol's source rebuilt byte-identically in the measured check.

## Art and modeling choices

| Need | Recommended path | Why / limit |
| --- | --- | --- |
| Functional weapons and gadgets | Blender Python with named parts, pivots, sockets, constraints and separate runtime behavior | Rebuildable geometry and precise hand/interaction contracts. Geometry alone cannot implement mechanisms. |
| Charming repeated environment pieces | Blender Python or Geometry Nodes, then Godot MultiMesh/LOD and simple collision proxies | Make variant families from controlled parameters; avoid per-blade alpha cards or heavy collision. |
| Texture/material polish | Authored PBR maps or deterministic image generation, UV/bake in Blender, embed in GLB | Blender's procedural shader graph is not a reliable substitute for imported game materials. Test under the actual Mobile/VR renderer. |
| Exact solid components | Optional build123d/CadQuery or Blender parametric meshes, then assemble/export in Blender | Useful for gears and dimensions, less useful for character rigging or in-hand presentation. CADAM remains a research option, not a pipeline dependency. |
| Characters | Art-directed Blender meshes with explicit skeleton/clip/part names and a category-specific test | Imported rigs need collision, detached-part and animation integration. The generic gate only proves import. |
| AI-generated 3D | Optional concept/blockout source followed by human/agent cleanup and the same gate | A pretty single-image reconstruction rarely has good hidden surfaces, topology, pivots or tactile interaction affordances. |

Do not optimize every GLB indiscriminately. Mesh joining, flattening or node deletion can break a crank, bolt seat, stealable shield or tracked body part. Measure draw calls and frame time in the game, then optimize a *known* bottleneck while preserving required names. Godot's XR rendering and 3D performance guidance support measured use of LOD, instancing and restraint with transparency/lights; there is no universal triangle quota that guarantees comfort on this headset.

## Optional model generation: R&D verdict, not installed

The 12 GiB GPU makes local image-to-3D experiments plausible, but the main authored pipeline does not depend on them. Run a controlled bake-off on the **same three isolated reference images** (a simple hard-surface gadget, an organic enemy, a textured crystal), with geometry and texture stages timed and GPU memory logged. Judge front/back silhouette, coherent undersides, topology, editability, texture quality, GLB size, import and headset cost. Retain model/version/license and generated-image provenance with every candidate. Do not use the live game as the first validator.

| Candidate | Machine fit / output | Decision |
| --- | --- | --- |
| [TripoSG](https://github.com/VAST-AI-Research/TripoSG) | Official repo lists at least 8 GB VRAM and a CLI that can target a face count; repo license is MIT. Generates shape from an image. | **First local shape trial** when the GPU has enough free memory. It is a mesh source, not a rig or gameplay generator. |
| [Stable Fast 3D](https://github.com/Stability-AI/stable-fast-3d) | Official repo lists about 6 GB VRAM, UV unwrap and material output. Weights are gated; its [community license](https://github.com/Stability-AI/stable-fast-3d/blob/main/LICENSE.md) needs checking for intended redistribution/commercial use. | Second local trial, especially for surface appearance. Do not silently accept weight terms. |
| [TripoSR](https://github.com/VAST-AI-Research/TripoSR) | Fast image-to-shape baseline with lower hardware demands. | Good speed/quality baseline if TripoSG is awkward to install. |
| [Hunyuan3D 2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1) | Official requirements are about 10 GB shape, 21 GB texture, 29 GB together; separate license terms. | Shape-only might fit when the GPU is otherwise idle, but full PBR generation is not a sensible default here. |
| [TRELLIS.2](https://github.com/microsoft/TRELLIS.2) | Official setup specifies Linux/NVIDIA with at least 24 GB VRAM. Its example output is far denser than a normal VR prop. | Do not install on this 12 GiB Windows host for the core workflow. |
| [Meshy API](https://docs.meshy.ai/en/api/text-to-3d) | Hosted preview/refine and GLB output; [credits are billed](https://docs.meshy.ai/en/api/pricing). | Optional explicit-spend route only when local trials have a clear quality gap. Never make game builds depend on it. |

These hardware figures are vendor/repository guidance, not a successful benchmark on this PC. Free GPU memory was below the card's 12 GiB total at inspection, so even a nominally fitting model may need the game closed. Local model weights and large frameworks have **not** been downloaded or tested here.

## Next infrastructure milestones

1. **Asset category contracts.** Add rig/animation and mechanical-motion validators as adapters to `asset_lab.py`, reusing the existing guardian and Siegebird checks. Test named grip/holster/socket transforms with in-game hand poses. A one-handed weapon should have an authored left and right grip profile, not only a default Blender orientation.
2. **Promotion with rollback.** Add a deliberate install command after category checks and human visual review, with a previous-version snapshot, GLB hash and in-game test. The current command intentionally stages artifacts only. Do not hot-swap a held item or reload an occupied region; use the Living Workshop versioning rules.
3. **Texture and LOD bake.** Pilot one already-important asset with an albedo/roughness/normal bake, plus a measured LOD. Compare actual Godot captures and headset frame time against the current asset. Consider [Material Maker](https://materialmaker.org/) as an optional artist tool; keep exported maps and source in the package.
4. **Local AI bake-off.** Try TripoSG and Stable Fast 3D in separate virtual environments with accepted weight/license terms. Feed their output into the same `inspect` gate, then assess whether cleanup time beats scripted modeling for a particular asset family. Avoid attaching an always-running generator to the game service until it earns its cost.
5. **Brann integration.** Have the forge worker emit this versioned manifest, source/provenance, GLB and interaction design. Only the supported capability schema may become hot-loaded behavior. New physics primitives and arbitrary engine code remain a deliberate development step.

## Primary sources

- [Blender command-line scripting](https://docs.blender.org/manual/en/4.0/advanced/command_line/arguments.html) and [glTF exporter API](https://docs.blender.org/api/main/bpy.ops.export_scene.html).
- [Khronos glTF Validator](https://github.com/KhronosGroup/glTF-Validator) and [Node API](https://github.com/KhronosGroup/glTF-Validator/blob/main/node/README.md).
- [Godot scene import](https://docs.godotengine.org/en/stable/tutorials/assets_pipeline/importing_scenes.html), [headless import CLI](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html), and [3D performance](https://docs.godotengine.org/en/stable/tutorials/performance/optimizing_3d_performance.html).
- [glTF-Transform node-preservation caveat](https://github.com/donmccurdy/glTF-Transform/discussions/1520).
