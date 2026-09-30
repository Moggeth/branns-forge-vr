# Quarry golem — Sonnet 5.5 High

Commissioned in an isolated work folder using the personal Claude.ai Pro subscription. The explicit and session-verified model was **claude-sonnet-5-5**, effort **high**. The successful commission took **672.068 seconds**, within its 720-second cap. See commission-metadata.json for verification; HANDOFF.md is the artist's draft and its approximate timing is superseded by the runner metadata.

Installed asset: godot/assets/golem/golem.glb, +Z forward, 2.34 m tall, 20,006 triangles, 14 mesh nodes, nine shared materials. Base colour, normal, roughness/metallic and emissive images are embedded. Core pulses retain those textures and the authored mesh scale. No individual extra real-time light is added.

The artist supplied Idle/Walk/Slam clips and named rigid articulation pivots. The production adapter in godot/golem_runtime.gd drives those pivots procedurally to synchronize attacks, damage and dismemberment; it does not claim to play all exported clips.

Gameplay: 110 HP; deliberate pursuit; readable wind-up and short ground slam; independently breakable armour; pickaxe advantage against exposed core; damaged arms weaken the slam and damaged legs slow pursuit. Broken plates and death become bounded physical stone pieces with material-specific chips, dust and sound.

To rebuild, run the bundled Blender against build_golem.py in a separate output folder containing a copy of that script. It creates golem.glb, generated texture PNGs, golem.blend and its report beside the script. render_preview.py reimports the actual GLB for review. golem_source.zip preserves the editable packed Blender scene. Keep .blend and intermediate maps out of Godot's asset import tree.

Verification: native Godot import; golem_checks.gd exercises authored part binding, core materials/scale, real core bounds, armour/death collision, attack avoidance, damage penalties and respawn; dual_view_checks.gd captures the installed asset from eye height and RTS in the real Quarry. Run with --xr-mode off --audio-driver Dummy. Actual headset acceptance remains a playtest.

See docs/DUAL-VIEW-AND-GOLEM-20261001.md for commands, controls and measured checks.
