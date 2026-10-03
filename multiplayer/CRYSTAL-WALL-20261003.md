# Stonewhisper crystal wall (pick special) - 2026-10-03

Rework of the pick's right-click special, built to `docs/DESIGN-PRINCIPLES.md`. The old special stamped a
full-height ridge into the terrain in one tick and then grew crystals on it. The new wall rises progressively
on the shared authority tick and has four roles. It is cover, an attack, traversal and a resource.

## Behaviour

- **Aim.** Hold Q, right mouse, the touch Special button or the VR trigger to show the footprint. Release to
  cast; a quick tap still casts straight ahead at full reach. The preview calls the same `planCrystalWall()`
  that the authority uses, so it shows the wall that will form. It turns amber and dashed while the special is
  recharging or the target is out of bounds. Q up, mouse up, pointer release or the XR trigger release casts.
  Escape, re-equipping or losing input cancels the aim.
- **Shape.** The wall is 3 to 8 m long (from 0.9 m in front of the caster) and is built from 2 to 7 segments
  of about 1 m. Each segment is a capsule terrain kernel `wall:{a,b,h0,h1,expireTick,owner}`, and the
  segments combine into one continuous crest up to 2.4 m high. The caster end is a 0.8-slope ramp you can
  walk up. Short elliptical end caps let a mined segment leave a real breach.
- **Rise.** The front advances at 10 m/s, and solid ground rises with it on the 60 Hz tick (`rupture` kind
  `pick_wall`). Late joiners, reloads and host migration see the same moment.
- **Front.** Enemies the front crosses take 65 damage once and are thrown in a shared parabola
  (`launchTick`, 1.6 m peak, 42 ticks). Other heroes on it get a 6.5 m/s upward lift.
- **Lifetime.** The wall stands 60 s and flickers through its last 3 s. Then it shatters, sinks over 36
  ticks and drops two stone shards per 7 segments. Each caster keeps at most two walls standing. A third
  cast shatters the oldest (reason `replaced`) rather than failing.
- **Mining.** Each segment is a 3-hit stone deposit linked to its edit. Mining a segment out makes it sink
  progressively instead of vanishing.
- **Saves.** Saves from before this change (legacy point-kernel walls) still load and render as static
  walls.

All tuning is in `PICK_WALL` (`shared/terrain.js`). A mastery system can scale reach, height, segment
count, lifetime and damage there without changing the code path.

## Presentation (client)

- `client/crystal-wall.js`: the geode.
  - An earthy crust of lip slabs closes over the crest. They crack and peel outward as the front passes,
    showing a druzy blue lining.
  - Eight flank crystals and two crest druzes per segment burst out with a birth flash. They then shimmer
    with a shared resonance wave and rim light.
  - An additive ground pool and a leading fissure follow the front.
  - Pooled shards, sparks and dust provide the burst and the shatter.
  - Presentation is a pure function of the snapshot tick, and settled walls do no per-frame work.
- `client/crystal-wall-preview.js`: the one-draw aim strip.
- `client/crystal-wall-audio.js`: procedural WebAudio.
  - A rumble on each cast and a pentatonic glass bell for each segment bloom.
  - A crack and thump on shatter, and a shimmer on the warning.
  - Spatialised, with at most 14 voices.
- Haptics: `contact-feedback.pattern()` sends the caster a rolling pulse train that fades with the wave,
  then a crack. Touch devices use `navigator.vibrate`.

Budget, measured from the renderer diagnostics:

| Wall | Draws | Triangles |
| --- | --- | --- |
| 7-segment | 5 per wall, plus 3 shared pools | about 3,970 |

There are no added lights, no post-process and no sorted transparency. Crystals are convex, depth-writing
and lightly see-through. The low quality setting halves the spark and dust pools.

## Verification

- `node tests/terrain-specials.mjs` (0.9 s) covers:
  - aim clamps, the unaimed default, the progressive rise and a mid-rise reload;
  - the ramp is climbable and the side is blocked;
  - one front hit with a launch, a friend lift and a mid-launch reload;
  - mining sinks a segment; mutation rejections;
  - expiry shatter drops two shards and retires the wall; the standing cap replaces the oldest;
  - legacy saves load.
- `node tests/mining-geometry.mjs` covers draws, the triangle envelope, raycast-to-deposit targeting, a late
  join, re-anchoring, and mined shatter and retirement.
- The eight handoff checks in `docs/CLAUDE-HANDOFF-20261003.md` pass on the branch merged with main. The
  full Node suite has the same pass/fail set as main.
- Visual review used `tests/crystal-wall-review.html`, which runs the real `createGame` renderer on a stepped
  local simulation (`?clean`, `?foes`, `?at=x,z`). It was captured in headless Chromium (SwiftShader).

## Not verified, and next steps

- Not yet checked on a physical Quest browser, phone or headset (comfort, frame time, haptics).
- No mastery or progression system exists yet. The hooks are the `PICK_WALL` table.
- Allies are lifted with a vertical impulse, not carried on the crest.
- The `pick_wall` sound is procedural. Authored samples could replace it later.
