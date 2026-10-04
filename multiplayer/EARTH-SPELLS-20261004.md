# Raise Wall and Sunder (God earth lines), 2026-10-04

Both God line spells were rebuilt to the rules in `docs/DESIGN-PRINCIPLES.md`, using the same timed-capsule machinery as
the Stonewhisper crystal wall (`CRYSTAL-WALL-20261003.md`).

## What the player gets

- **Raise Wall** (was "Stone Wall"; the spell id stays `wall`). Drag a line: a blue seam races along it at 9 m/s and a
  geode rampart grows behind it. The rampart is about 3.2 m tall, with a flat crest, steep faces armoured in cracked
  crust slabs, and blue crystal along the crest. Both ends taper into walkable ramps. The rising front hurts enemies on
  the line and throws them clear of its footprint, and it carries Heroes up onto the crest. Every segment is a
  quarryable stone deposit: mining one out sinks just that segment and opens a breach. After 60 s the rampart warns,
  shatters into stone and crystal shards, and sinks back.
- **Sunder**. A blue fracture tears along the line at the old Sunder speed. Behind it the ground splits into a chasm
  2.4 m deep with steep walls and a flat floor. Spoil heaps up into banks on both lips, the crust peels back to show its
  glittering lining, crystal lines the walls, and a resonance seam glows on the floor. The front wounds and staggers
  enemies on the line, which then drop in. Both ends ramp up, so anything inside can walk out. Crystal seams (mineable
  `crystal` deposits) are laid bare on the floor: one on a short line, two on a long one. After 60 s the chasm closes and
  the seams stay.
- Each God keeps at most three of each standing; casting a fourth replaces the oldest, so a cast is never refused for
  this. Mana remains the only gate.
- New cast sounds, a rolling groan along the line for everyone nearby, glassy bells per segment (lower and darker for
  the chasm), and vibration for the casting God (VR controllers or phone): swelling pulses for the rampart, rough
  stuttering ones for the chasm.
- The aiming preview draws the authority's exact plan (segment count and the true rampart or chasm profile), in
  resonance blue.

## Authority and saves

- `shared/earth-spells.js`: `planEarthLine` (pure, shared with the preview) and `castEarthLine`.
- `shared/terrain.js`: `RAISE_WALL` and `SUNDER` tuning tables, `WALL_SPECS`, `chasmProfile`, `validateWallSegment`.
  Raise Wall segments join the crystal wall's max-combined channel; chasm trenches combine by min and banks by max,
  so joints never double up. Timed segments are never baked into the terrain grid.
- `shared/weapon-specials.js`: `stepCrystalWalls` now runs every timed kind (front effects, Raise Wall shove, expiry
  shatter/close, retirement). Events: `raise_wall_shatter`, `sunder_close`.
- Old saves: permanent `wall`/`sunder` kernels without a `wall` descriptor still load and keep their shape. Crystal wall
  behaviour, tuning and RNG layout are unchanged.

## Budget (measured in node with the real view, 18 m line, `tests/earth-spells.mjs` guards the bound)

| Cast | Segments | Crystals | Crust slabs | Draws | Triangles | Pose cost |
| --- | --- | --- | --- | --- | --- | --- |
| Raise Wall | 7 | 119 | 42 | 5 | 5,664 | 0.17 ms while animating, nothing once settled |
| Sunder | 7 | 147 | 42 | 5 | 6,648 | 0.16 ms while animating, nothing once settled |

No lights, no bloom, no sorted transparent solids. The shared shard, spark and dust pools are the crystal wall's,
and the low-quality path halves them.

## Verification

- `tests/earth-spells.mjs` (in CI): plan ramps; no instant collision; enemy thrown clear; Hero lifted; faces block
  walking; ends climbable; quarrying sinks one segment; save round trip and corrupt-descriptor rejection; expiry,
  shards and ground restored; standing limit; chasm depth, banks, wound and stagger, walking out, close, seams kept;
  legacy kernels; view draws and groups.
- `tests/earth-spells-review.html`: deterministic review page on the real renderer (`?clean&foes`). It was used for
  the before/after captures in the project folder `sunder-raise-wall/`.
- Not yet checked on a physical phone or headset.
