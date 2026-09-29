# Pocket Thunder authored art and effects

Pocket Thunder was commissioned twice from verified **Claude Sonnet 5.5** on the personal Claude.ai Pro subscription: a first complete model/VFX pass (473.064 s) and a targeted visual revision driven by actual Forge Yard captures (284.736 s). `FIRST_PASS.md` and `FIRST_PASS_STORYBOARD.md` preserve the initial design and why it changed. `REVISION.md` is Sonnet's final art handoff.

The installed art is `godot/pocket_thunder/bomb.glb` and five shaders in the same folder. `godot/bomb_visuals.gd` owns model assembly, trail and burst visuals. `godot/adventure_runtime.gd` still owns the bomb's rigid-body throw, fuse, damage, collision and haptics. Model nodes `Heart`, `Shell`, `Crown`, `Base`, `Binding`, and `TrailOrigin` remain addressable. The thirteen shell plates are individually transformed during formation; the final GLB has 2,632 triangles, three materials and a 0.095 m radius. It passed `assets/asset-lab/pocket_thunder.json` inspection.

The explosion uses eight pooled burst rigs and at most two active shadowless lights. Each burst has a brief warm pulse, a broken ground shockwave, short pressure ripple, fourteen shell chips, forty sparks, twenty embers and six smoke puffs. A live bomb's glow accelerates as its actual fuse approaches detonation. The existing six-point trail concept becomes a tapered twelve-point ribbon. The visuals are allocated in a separate stage and release their resources after the smoke tail. No light is created for every particle.

Rebuild from this folder with bundled Blender 4.5.13:

```powershell
$asset_dir = (Get-Location).Path
& '../../tools/blender-4.5.13-windows-x64/blender.exe' --background --python build_bomb.py -- $asset_dir
```

The editable `pocket_thunder.blend`, deterministic `build_bomb.py`, and `render_previews.py` are here. After replacing the installed GLB, run the Godot editor import. `preview_harness/` is the first-pass isolated test scene; the revised `harness_main.gd`, `godot_blast_contact_sheet.png`, `godot_model_forming.png` and final Blender renders are retained for comparison.

Verify with `python scripts/asset_lab.py inspect assets/asset-lab/pocket_thunder.json godot/pocket_thunder/bomb.glb`, Godot `--headless --xr-mode off --audio-driver Dummy --path godot --script res://bomb_visual_checks.gd`, then `node service/integration.cjs`. On 2026-09-30 all passed: the focused check reported eight-burst tick cost of 0.35 ms p95 over 60 headless CPU samples, and integration reported `INTEGRATION PASS seconds=53.020`. Actual in-game ready/burst captures are in ignored `outputs/overnight-pocket-thunder-*-final.png` (Forge Yard capture, capped desktop 120 FPS). Headset feel, stereo GPU cost, and sound mix still need live VR acceptance.
