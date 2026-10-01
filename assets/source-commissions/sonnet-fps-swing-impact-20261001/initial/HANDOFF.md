# HANDOFF — first-person swing + stone impact art (Sonnet 5.5)

Files: `desktop_weapon_pose.gd`, `surface_impact_art.gd` (drop-in over `godot/`). NOT run in Godot — parse/capture is yours.

## desktop_weapon_pose.gd
- `idle()` byte-for-byte unchanged (origin .35,-.35,-.55). `swing()` signature unchanged; `item.transform` never written.
- `profile(item)` -> `{duration, contact(=0.5), cooldown, id, style}`. id from meta `id` (then tool_id/weapon_id/catalogue_id); substring fallback (pick/axe/hammer/sledge), then generic.
  | tool | style | duration | cooldown |
  |---|---|---|---|
  | quarry_pick | peck | .40 | .48 |
  | woodland_axe | drawcut | .38 | .46 |
  | apprentice_hammer | settle | .48 | .58 |
  | ember_hammer | settle | .50 | .60 |
  | sunfall_sledge | settle (heaviest) | .54 | .65 |
  | generic | – | .42 | .50 |
  Contact = .19 / .20 / .24 s etc. Runtime waits max(duration, cooldown) so cooldown is the real swing spacing — tune there if too sticky.
- Tip path = one Hermite spline (rest → short windup .12–.19 → accelerating, curved strike → contact → follow → slow recovery → rest). Exact by construction: p=0 and p=1 give `rest`, p=.5 gives tip == (0,0,-reach). Velocity at contact is non-zero, so a MISS carries through (no stop/bounce, no contact reaction). Start tangent is fast (instant response, ~50 ms anticipation); no camera/timefreeze/smoothing.
- Overlap: wrist (pitch,yaw,roll) is a separate Catmull spline whose contact key lags .5 by .025–.08, so rotation snaps just after position. Plane alignment (handle_axis × working_axis → canted diagonal normal) kept, with per-family cant (pick .42, axe .32, hammer .22), blended by activity envelope.
- Flavors: pick = tight vertical, small lateral travel, big +z pull on follow (wrist extraction); axe = wide diagonal, follow keeps travelling (`through` .85) and pulls back = draw cut; hammer = long lift, weight carries, short follow that sags (`through` .12) then eases home.

## surface_impact_art.gd
- API unchanged (`profiles()`, `mark_profile()`, `stats()`), all 6 materials; only runtime keys used (+ existing `gate`,`name`). `stats()` now also walks the new `stone_flake` mesh (winding check goes through MB.tri as before).
- Stone layers (hierarchy through life/speed since no delay): glint (2, life .15, speed 4.8, gated metal_tool, new `spark_glint` material energy 1.15 vs 1.6) → fresh shards (2, warm fracture crystal, .55 s) → crust flakes (3, NEW thin angular prism: cool dark crust top, warm fresh underside; tumbling flashes warm/cool) → one slab → dust (2 cards, size .19, life .5, density .34, new `dust_stone`). Was 4+3+3 dust-heavy +2 sparks.
- Dust shader rewritten: no per-pixel noise (that was the pixelation). Smooth radial falloff reaching alpha 0 at r=.94, deterministic 2nd/3rd-harmonic lobes per instance for outline variety, slight top-light/edge-dark cue, tiny dither against banding. Shared by wood/bone/metal/flesh/glass dust, so they get smoother too (their parameters untouched).
- Stone has no blood/flesh tones. Wood/bone/metal layers untouched.

## Limits / suggested narrow runtime tweaks (optional, not required)
1. No spawn delay: dust appears at frame 0 at full COLOR.a. Densities are low to hide the pop. One-line root change would fix it for all dust: `color.a = fade * (minf(p.age / 0.06, 1.0) if kind == "dust" else 1.0)` in `tick()` — shader already multiplies COLOR.a.
2. Dust scale grows `1 + age*1.2` in root; with life .5 that is +60% — fine; if it still reads as expanding, drop to `0.6`.
3. No soft-depth fade at surfaces (depth-texture read avoided for Mobile/VR); dust card may show a straight intersection line on the golem if the card clips — shown only at low alpha. Check in capture.
4. Spark gate `metal_tool`: quarry_pick/hammers/axe qualify; spark layer is first in stone list (pool order changes draw order only).
5. Unverified: exact feel of arcs (bulge dir, `cant`, wrist signs) needs your native capture against real handle_axis data; tune `_style()` rows only.
