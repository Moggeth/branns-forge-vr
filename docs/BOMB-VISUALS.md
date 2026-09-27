# Pocket Thunder visual system

`godot/bomb_visuals.gd` owns the grenade model, assembly motion, explosion
presentation, a short trail, and an optional locally synthesized spatial sound.
It has no physics, health, service or inventory authority.

## Integration

- `setup(game)` creates shared materials and the effect container.
- `create_bomb(parent, radius = 0.095)` returns a `Node3D` with `ready = false`
  metadata. It starts fully assembled for attachment to a thrown rigid body.
- For a new hand formation, call `update_forming(model, 0)` immediately, then
  `update_forming(model, progress)` as progress advances from zero to one.
  Remove the previous whole-orb scale animation; assembly is handled per part.
  The caller still sets the `ready` flag and owns the formation duration.
- `explosion(position, radius, intensity = 1, duration = 0.75, spark_count = 24)`
  plays visual/audio feedback; apply gameplay damage separately.
- `tick(delta)` animates orbiting motes, trails and explosion lifetimes.
- `audio_volume` defaults to 0.65 and accepts zero for silence.
  `trails_enabled` defaults to true.

## Appearance and motion

Pocket Thunder has 24 raised, faceted shell segments around a luminous mint
heart. Most panels use dark metal; two equatorial panels, the crown and lower
ring use brass. A small crystal fuse and five orbiting sparks distinguish the
enchanted grenade from an ordinary ball. Geometry for identically sized shell
panels is cached across bomb instances.

Formation begins at the luminous heart. Shell segments arrive from radial
positions in a short stagger, rotate into place, and finish with the crown and
crystal. The optional flight trail records six recent world positions and is
rendered as a thin mint line. It does not predict or alter the trajectory.

Explosions have two transparent expanding shockwave rings, a brief compact
core flash, outward moving sparks, and four faint smoke puffs that rise and
dissipate. The flash radius is capped at 0.4 meters. There is no expanding
opaque sphere, camera shake, screen overlay, repeated strobe or lingering fog.
Smoke opacity peaks at 0.085. Sparks share one MultiMesh draw per explosion;
their initial transforms are populated before the first rendered frame.

The effect clamps radius to 0.3–10 meters, intensity to 0.15–2.5, duration to
0.2–2 seconds, and sparks to 4–64. Those bounds are visual guardrails, separate
from the root's persisted tuning schema and gameplay bounds.

The optional sound is a short, deterministic bass/noise burst generated into
PCM locally. It uses spatial attenuation, respects `audio_volume`, and is
disabled under the headless display driver. Set volume to zero for visual
captures when another live game is already using the user's audio output.

## Tuning-aligned feedback

The companion `interaction_feedback.gd` reads `formation_seconds` from the
forming object. Its throw preview calls the root tuning estimator without
clearing velocity history; desktop launch gain, lift assist, maximum speed and
bomb gravity match the tuned launch path. The nearby blast warning reads the
thrown body's `blast_radius` metadata. These changes are feedback only.

## Verification and timing

The first bomb-visual parser check passed in 0.262 seconds. A subsequent paired
parser check of bomb visuals and tuning-aligned feedback passed in 0.415
seconds. Checks used `--headless --xr-mode off --check-only`; no live game,
service, voice or paid generation was started or stopped.

Authoring started at 2026-09-12 19:54:00.662 +10:00. The completion duration is
recorded below. Root owns rendered capture review and integrated game checks;
actual headset visual comfort and spatial sound require a hardware playtest.

Inspection learning: on Windows, pass glob filtering to `rg -g`; a literal
`godot/*tuning*.gd` path produced an invalid-filename error. Directly reading the
discovered `godot/tuning_runtime.gd` recovered immediately.
Authoring, inspection and parser checks: 318.407 seconds inclusive.
