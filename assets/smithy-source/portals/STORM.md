# Portal storm lightning: handoff

Runtime file: `godot/assets/smithy/portals/portal_surface.gdshader`. It replaces `reference.gdshader` directly. All existing uniforms, the mesh contract (COLOR.r rim to centre, UV), render_mode, varyings and the reference look are kept as they were.

## New uniforms
| uniform | default | meaning |
|---|---|---|
| `storm_amount` (0..1) | `0.0` | Effect strength. Set it to `1.0` only on the Sky Garden and Cloudbreak Keep expedition gate veils. |
| `storm_phase` (-1..1) | `-1.0` | Below 0: live animation from `TIME + time_offset`. 0..1: freezes the cycle at that phase, using event seed n = 0. For tests only. |

## Safety guarantees
- At `storm_amount = 0` the storm block is skipped completely. It is a uniform branch placed after the reference ALBEDO/ALPHA are written, so the output matches the reference exactly.
- There is also a hard gate on `theme == 5` (sky_garden) or `theme == 11` (cloudbreak_keep). The native kit additionally checks that the frame is an expedition gate. Bellworks uses theme 5 for its veil and keeps the default strength of zero.
- No lights, screen reads, extra passes or meshes. The effect is additive ALBEDO on the existing veil plus `ALPHA = max(ALPHA, glow)`.
- The effect is masked to the rim with `smoothstep(0.42, 0.25, d)`, so the centre landscape (d > 0.42) is never touched.

## Look
- Sky Garden: white-blue filament core with a sky-blue halo.
- Cloudbreak Keep: pale gold filament core with a violet halo.
- A fine main filament (core width about 0.0035 in d units) follows a jagged path at about d = 0.11–0.13, hugging the rim. It spans an arc of about 0.85–1.2 rad. The arc is centred on the top of the aperture, swung randomly up to ±1 rad onto either side.
- Two tapered forks peel inward from the main filament, at about 28% and 66% of its length.
- The filament grows along the arc as it charges ("travels"). Over the top of that there is only a slow, smooth shimmer of ±15% at 2.3 rad/s. There is no strobing.
- Distance falloff: full strength within 2.5 m of the camera, easing to 30% at 7 m and beyond. It is also scaled by `lod_detail` (55% at lod 0). The rear face is shown at 60%.

## Periodicity (live mode)
- `STORM_PERIOD = 4.0` s, with cycle index `n = floor((TIME + time_offset) / 4)`.
- Each cycle's phase is shifted by a hash of n of up to ±0.15 cycle. Bloom peaks therefore land about 3.4–4.6 s apart, with exactly one event per cycle.
- Each cycle n gets new angle, side, direction and jag seeds from the hash. It is deterministic for a given TIME and time_offset.
- Envelope in terms of phase f:
  - Dormant: f < 0.05, and f > 0.98 for the halo.
  - Charge: a faint halo and filament grow from f = 0.05 to 0.55, and the head travels from f = 0.12 to 0.6.
  - Bloom: peaks at f ≈ 0.62–0.66.
  - Decay: f = 0.66 to 0.95.

## GPU verification recipe
With `theme = 5` or `11`, `storm_amount = 1`, `energy = 1`, and the camera about 1.5 m away:
- `storm_phase = 0.0`: dormant. All envelopes are exactly 0 here, so this should match a `storm_amount = 0` capture.
- `storm_phase = 0.64`: peak. A bright forked filament on the upper rim, with the centre unchanged.
- `storm_phase = 0.40`: mid-charge. A partly grown filament with a soft halo.
- `storm_amount = 0` (any phase), or any theme other than 5 or 11: pixel-identical to `reference.gdshader`.

Reset `storm_phase` to `-1` after tests. In the shipped game it must stay at -1.

## Cost
The effect only runs on the two gates, and only for rim fragments: there is an early return when the fragment is outside the bolt's arc. Per fragment it costs about 7 `vnoise` calls, one `exp` and one fixed two-iteration loop. There are no texture fetches.

## Not verified
This has not been compiled or rendered here, because no Godot was available in the folder. The syntax follows the reference's GLSL subset, including reversed-edge `smoothstep`, which the reference itself uses. Codex should run a compile check and the phase captures above.
