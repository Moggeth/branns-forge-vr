# First-person swing and impact refinement — 2026-10-01

The goal is responsive, readable weight: a short anticipation, fast committed strike, slower recovery, and a reaction only when a real contact occurs. Camera aiming remains immediate. VR grip filtering and calibrated weapon orientations are unchanged.

## Research applied

- [DevUnallocated: procedural first-person weapon animation](https://www.devunallocated.com/projects/project-killhouse/procedural-weapon-animations): combine authored handling poses with restrained procedural motion; compose for the first-person camera and give different weapons distinct handling. Applied here as a calibrated rest pose plus tool-specific tip and wrist curves. We did not adopt a full arm IK system for this bounded pass.
- [Microsoft's Halo first-person animation documentation](https://learn.microsoft.com/en-us/halo-master-chief-collection/h2/art/animation/animationsfpanims): separate action and movement states. Our idle, swing, confirmed contact and cancellation paths remain distinct.
- [RealTimeVFX artist block-in/timing study](https://realtimevfx.com/t/study-of-block-in-and-timing/29905): useful practitioner examples of designing impact shapes and timing before detail. The stone response now reads as glint, fractured chips, tumbling crust and a small soft dust tail.

These sources informed the principles; the implementation and tool personalities are original. The GDC video page and a large VFX PDF could not be opened by the research tool, so no claim is made to have reviewed those materials.

## Motion

Sonnet 5.5 authored `godot/desktop_weapon_pose.gd`; Codex integrated it in Main and tests. Contact stays at normalized phase 0.5 and the visible working tip meets the aiming ray exactly there.

| Tool | Character | Swing / repeat interval |
| --- | --- | --- |
| Stonewhisper pick | Tight peck, small lateral travel, extraction | 0.40 / 0.48 s |
| Orchard's Edge | Broad diagonal drawing cut | 0.38 / 0.46 s |
| Apprentice hammer | Higher lift and heavier settling recovery | 0.48 / 0.58 s |
| Ember hammer | Slightly heavier version | 0.50 / 0.60 s |
| Sunfall Sledge | Longest lift and deepest settle | 0.54 / 0.65 s |

The tip travels through contact on a miss instead of easing to a halt in empty air. Wrist rotation follows slightly behind the tip. Codex gave the arc-bulge term zero endpoint derivatives to avoid a small velocity discontinuity. Existing hard-surface contact constrains confirmed hits and withdraws the tool; it does not shake the camera or slow aim. Clicking during a swing cannot restart it, and switching/dropping a weapon cancels stale contact state.

## Material feedback

Sonnet rebuilt stone impact shapes and the shared dust shader. Thin dark crust fragments reveal warmer fresh fracture faces as they tumble. Small metal-on-stone glints replace the dominant gray puff. Smooth alpha falloff replaces noisy dust edges; Codex added a 60 ms fade-in. Chips fan along the measured incoming stroke while leaving the surface. Wood, bone, metal, flesh and glass remain separate responses.

Golem armour breakage previously emitted a generic response before the measured weapon hit, causing the duplicate filter to discard the latter. Located contacts now own their feedback; unlocated damage retains a coalesced fallback. Projectile callers were audited along with melee so this does not remove their hit feedback.

Resources remain shared and pooled: 18 material layers, at most 96 fragments per layer, 72 marks and eight spatial audio voices. No per-chip physics bodies or new real-time lights.

## Source and verification

Artist: verified `fauxgrady@gmail.com` Claude.ai Pro subscription, exact `claude-sonnet-5-5`, high effort. Isolated commission `work/sonnet-first-person-impact-20261001`; source and handoff delivered in **204.48 seconds**. Runtime source is the editable deliverable, not a baked movie.

Headless checks cover tip/aim alignment, exact rest endpoints, nonzero through-contact motion, velocity continuity, contact timing, slow-frame crossing, once-only damage, repeated clicks, weapon switching, material classification, surface response, golem feedback ownership and bounded pooling. Final actual-Main swing integration: **10.99 seconds**, no failures.

Native review artifacts and final checks are recorded below after capture. Screenshots are GPU-rendered, but capture readback time is not a gameplay frame-rate measurement. Full VR comfort and subjective combat feel still need a hands-on playtest.

## Reproduce / play

Relaunch normally through Brann's Forge Launcher to load the code. LMB swings; hold RMB during an axe swing for Power Cleave. Current sessions, SteamVR and saves are not restarted by verification.

Native fixtures: `godot/desktop_swing_capture.gd` and `godot/impact_visual_capture.gd`, run with the bundled Godot executable, `--xr-mode off --audio-driver Dummy --path godot --script res://<fixture>.gd`. Both use an unfocusable offscreen window and terminate themselves. Outputs live in ignored `outputs/desktop-swing` and `outputs/impact-visual`; diagnostics/timings are in `logs/`.

## Final visual iteration and measured results

The first native filmstrip revealed that anticipation was pushing the pick/hammer too far away, shrinking their silhouettes. A second verified Sonnet 5.5 commission (**109.445 s**) revised preparation to use the rest tip's depth, with reach spent during the committed strike. Codex corrected its inverted depth clamp, then removed that guard after an actual-Main test showed a 38.7 cm jump for the long axe. Final anticipation depth remains within 12 cm of rest, without scaling the tool. The final actual-Main gate passed in **10.058 s**.

Final native swing sequence: **4.312 s**; actual-golem/stone impact capture: **2.924 s**; sheet/movie packaging: **2.157 s**. These are diagnostic durations, not gameplay frame times. Reviewed six normal/half-speed tool sequences and fixed-time impact frames. Axe and pick stay readable in preparation; the hammer head briefly passes above the top edge during its overhead lift while its handle remains visible. Contact and recovery are visible for all three.

The actual golem fixture derives its contact point/normal from the authored ShoulderL triangles, 2.300 m from the camera, and verifies pick-tip alignment within 1 mm. It uses the production confirmed-contact stop/recoil, unlike the first draft fixture which showed a miss follow-through against a proxy plane. This is a visual fixture, not a substitute for the main combat tests.

Final impact stress fixture: **547 peak live fragments, 18 pools, 661 source triangles, 1.006 ms worst CPU update** in a headless synthetic burst. This does not establish whole-game or GPU performance. Focused hard-surface/golem tests passed; actual-Main Phoenix bow (38 checks) and Siegebird gates passed in **9.14 / 9.50 s**.

Generate the native fixtures, then run `python scripts/fps_motion_review.py` to produce sheets and six MP4s; Pillow is required, ffmpeg is optional for movies. Packaging logs errors and elapsed time to `logs/fps-motion-review.log`. Captures live under `outputs/desktop-swing` and `outputs/impact-visual` (ignored). Commission briefs, verified metadata and handoffs are retained in `assets/source-commissions/sonnet-fps-swing-impact-20261001`; installed GDScript remains the editable art source.
