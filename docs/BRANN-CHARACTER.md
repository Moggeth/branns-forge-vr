# Brann Copperpot

Open **Brann’s Forge Launcher → Adventure** on desktop or in VR. Walk up to the anvil in Forge Yard. Brann turns his eyes and head toward the visitor, greets them, and settles into a listening pose. During his reply, the voice amplitude drives the lips, eyelids remain independent, and the upper body follows an authored gesture. From farther away, he shifts his weight and occasionally inspects his hammer. A working or finishing commission plays his forge cycle. Brann draws back, brings the hammer down onto the billet, and recoils after contact. The finished item still goes to its assigned stand.

[Before and after in Godot](../assets/smithy-source/brann/review/character-review.jpg) · [11-second in-game animation reel](../assets/smithy-source/brann/review/brann-motion.mp4)

## Editing the character

- The editable, packed Blender project and deterministic builder are in [assets/smithy-source/brann](../assets/smithy-source/brann/). The game loads `godot/assets/smithy/brann/brann.glb`. The small copper clasp carries the existing conversation status colors.
- The model has 35 joints, 46,178 triangles including the held hammer, 30 surfaces and 29 embedded images. The earlier model had 95,084 triangles and 53 surfaces before the equipped hammer.
- `Idle`, `Listen` and `Talk` are continuous loops. `Greet`, `Inspect` and `Present` are one-shots. `Forge` is sampled against the gameplay strike clock. The hammer is rigidly bound to the right hand. The arm, spine, braid and apron weights deform in their authored poses.
- Keep the model origin between the boots, with +Z toward the visitor and metre units. The player collider belongs to the scene. Head and eye aiming are additive over the imported bone pose. Six independent facial shapes handle the blink, mouth opening, lip spread, lip rounding and brow lift. The voice service supplies amplitude for articulation.
- The export is 25 fps. Keep `animation/fps=25` in `brann.glb.import`. Frame 18 of the 25-frame Forge cycle is the contact anchor. At Godot's 30 fps import setting the exact key landed between samples and the hammer stopped about 50 mm above the billet. The native check compares the exported `HammerFace` bone against the live billet each time the rig changes.

## Verification

Start with the Godot 4.7.2 console executable, `--headless --xr-mode off --audio-driver Dummy --path godot`, then append `--script res://smithy_checks.gd -- --world-builder-preview`. The native test covers the imported armature, required clips and facial shapes, the offline voice envelope through the same game path, the visitor's gaze and blink, hammer reach and rebound, and the full three-strike delivery. It also exercises the 127-item gallery and the existing clearance probes.

For actual graphics, omit `--headless` and run `--script res://forge_yard_art_review.gd -- --world-builder-preview --brann-review-output=<absolute path>`. That captures nine angles and animation poses with the actual smithy lighting. Add `--fixed-fps 24` before `--script` and `--brann-motion` after the user-argument separator to capture the motion reel. The review uses an offline voice envelope and leaves saves untouched.

In a fresh Windows worktree, Godot 4.7.2 may crash importing the legacy `godot/experiments/visual_2d3d/*timings.csv` as a translation table. Reuse the verified `.godot/imported` cache if the native assets match the source revision. For the editor import, temporarily exclude `godot/experiments/visual_2d3d` with a per-worktree `.gdignore`, then remove the marker. This keeps experimental data out of character imports. Inspect `SCRIPT ERROR` and `ERROR` logs as well as the exit status. The native renderer and simulated gameplay were tested on desktop. Physical headset comfort and frame time still need a headset playtest.
