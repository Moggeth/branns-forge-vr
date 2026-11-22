# Brann Copperpot character source

`brann.blend` is the packed editable model. It contains the armature, the body and hand weights, the facial shapes, the hammer bound to the hand, and the authored actions. `build_brann.py` and `textures_brann.py` rebuild it from geometry and seeded PBR textures. The existing `godot/assets/smithy/brann/hammer.glb` supplies the hammer mesh. `brann-concept.jpg` is the art direction reference. The gameplay renders are linked from the [native character guide](../../../docs/BRANN-CHARACTER.md).

## Rebuild and inspect

From this directory with Blender 4.5 on PATH:

```powershell
blender --background --factory-startup --python build_brann.py
blender --background --factory-startup --python verify_brann.py
```

The builder writes `brann.glb` and the packed `brann.blend` under the repository’s `logs/brann-rebuild/`. The verifier re-imports the GLB and emits a manifest and studio renders there. Set `BRANN_BUILD_DIR` to an absolute directory to put the outputs elsewhere. Review the export before replacing the runtime GLB.

## Rig contract

- Godot uses +Y up and +Z toward visitors, with the origin between planted boots. The player collision volume stays in the game scene.
- `Idle`, `Listen` and `Talk` are loops. `Greet`, `Inspect` and `Present` are one-shots. `Forge` uses baked arm and wrist IK. The one-second clip is sampled against Godot’s forge clock at 25 fps. At frame 18, `HammerFace` marks the contact at (-0.43, 1.29, 1.10) relative to Brann.
- `BlinkL`, `BlinkR`, `MouthOpen`, `MouthWide`, `MouthRound` and `BrowLift` are game-driven shape keys. The clips leave them unkeyed. Godot layers head and eye aim over the animated bone poses.
- `PresenceIndicator` is the clasp’s gem. The game overrides its albedo and emission for conversation status. Keep it on the chest, with a single material and an overall width under 0.12 m.

## Texture export check

Set the Blender generated image’s color space before filling its pixels. Changing an existing image to Non-Color after the write resets the buffer. The first pass produced black normal textures and zero roughness, which caused white and black patches in the studio render. Check the packed bitmaps after an export. The tangent-space RGB normals should be centered around (128, 128, 255). The green roughness channel should be nonzero and vary across each cloth or leather map.

The rig is intentionally stylized. A single curl control per hand drives the fingers, and the existing voice amplitude shapes speech without phoneme data. The current native review uses desktop rendering and the game’s offline voice envelope.
