# Starfall / physical interaction / RTS / ground pass

This implements the expanded twenty-part playtest brief supplied September 30–October 1. Load it by relaunching the normal Brann's Forge Launcher. No live game, headset service or player save was reset during development. Existing saves remain compatible.

## Play and inspect

Choose **World Builder**, then **Monitor / projector** for desktop or **VR headset** for local asymmetric play. Desktop **F9** opens the survey and switches its primary perspective. Both pictures remain live. Drag the inset header, drag the lower-right resize corner, or use its **Swap views** and focus buttons. **F11** toggles fullscreen; layout preferences live in `user://world-builder-view.cfg`. Hero primary restores the actual FPS HUD and clears the RTS panel/header. Closing or raw window teardown restores the original HUD and render scale.

In the survey, **F1–F4** select Land / Life / Construction / Encounters from left to right, then **1–9** selects a card. Click a point or drag/select two endpoints as indicated. Right-click / Escape cancels. Invalid placements display a coalesced red message that fades; failed casts spend no resources. The Mana orb animates internal fluid/wisps and previews the selected cost. Seed is removed from the resource strip, but the existing Plant Magical Seed ability remains usable.

Starfall is **Land / 5**. Its preview distinguishes the 10 m terrain impact from the 8 m Hero damage radius and reports the actual 1.25-second descent. Pick up Stonewhisper and strike a rock-facing point in VR; withdraw or lever sideways to release a caught point. Desktop **LMB** swings/mines; **RMB** retains the resonance-charge ability. Repeated mining leaves visible saved scars and yields the existing star gems/iron.

## Physical interactions

The meteor diagnosis found geometry faults: winding, nonidentical longitudinal pole positions, degenerate cap triangles and a seam where unwrapped noise changed endpoint positions. The repaired closed shell uses Godot-clockwise visible triangles, outward vertex normals and the same triangles for its collision. Manifold edge pairing, nondegenerate faces, winding and top/side physics rays are tested separately. Native near/side/high and mined views show a solid surface. Disabling culling was not used to conceal bad topology.

`hard_surface_contact.gd` supplies measured weapon × material semantics. `melee_contact.gd` sweeps the authored pick points, opposite point, shaft and handle between tracked poses, identifies the first contact, and constrains the visible held tool at the actual surface. Strong, inward point impacts can bite up to 3.5 cm into stone; an appropriate axe edge can bite up to 5 cm into timber. Incidence, energy, hardness, tool and striking region affect arrest, glancing and embedding. Withdrawal/levering releases the stop; tracked controller input is never constrained. FPS swings stop/recoil/withdraw through their animation. This is a controlled visual/contact constraint rather than an exact coupled rigid-body penetration simulation; headset feel still needs a physical playtest.

Skeleton structural damage retains responsibility for bone breakage and lodgement. The shared contact event carries its damage result and does not force every bone hit to stop the tool. Living bones react through the existing planted skeleton/structural system; detached pieces remain physical. Authored collision metadata distinguishes timber, metal and stone at fixtures, including separate anvil face/stump bodies. Unknown mixed scenery and unclassified terrain still default to stone; future authored kits should declare `surface_material` explicitly.

`impact_feedback.gd` replaces the generic sphere on measured melee, projectile, mining, dummy, pumpkin, sledge and falling-meteor physical impact routes. Stone chips/dust, wood splinters, bone shards, metal sparks, flesh response and glass fragments use Sonnet's reusable low-poly meshes. Sparks require appropriate metal working contact: a wooden shaft or bone hit does not emit arbitrary sparks. Eighteen varied material-specific transient/body sounds share eight spatial audio voices. Existing magic, healing and intentional spell effects retain their separate presentation.

Effects originate at the measured point and normal; relative velocity/energy controls direction and intensity. The system uses 17 fixed MultiMesh pools of at most 96 particles each, no new impact lights, and a bounded contact deduplication ledger. Up to 72 generic marks follow a weakly referenced target for 28 seconds. Meteor mining separately stores up to 24 persistent local scars in its existing saved record, rendered as one shared batch. This accumulates visible damage without unique permanent geometry per swing.

## RTS presentation and truthful previews

One native Godot renderer shares the actual `World3D`. A tactical SubViewport supplies the strategic camera; the existing Hero root texture supplies the other picture. There is no duplicated simulation, copied weather or third Hero renderer. The default tactical redraw target is 120 fps at 65% 3D scale; desktop secondary Hero resolution follows inset size. Native text/icons draw outside 3D scaling. Quality controls and the existing VR backoff remain available.

The card grid reserves title bands, wraps labels and fits each actual catalogue title at 960, 1280, 1600, 1920 and 3840 widths. Cost/clock/gesture and resource symbols use the native icon helper. The Sonnet Tidal Glass orb is one shader-backed rectangle with layered caustics/wisps and reactive fill, not a scene full of particle nodes.

`world_builder_targeting.gd` derives pure preview plans from the same authoritative placement parameters. `world_builder_targeting_art.gd` creates two shared material surfaces, sampled to the current terrain plus a small offset. Path previews include the 4 m core and 9 m painted band; Sundering includes its 16 m shoulders. Tree previews use the exact seeded candidate positions the next cast will use, including invalid-placement reasons. Raise Earth, walls, faults, groves/rings/forest corridors, Starfall, construction, harvest/Ent/seed interactions and patrol warnings each have distinct geometry. The art is cached by plan/terrain revision, with changed-cursor mesh rebuilds throttled to about 30 Hz while its shader animates at the presentation frame rate. A maximum tested preview has 1,624 triangles and took 3.299 ms to build; unchanged field queries were under a millisecond.

Future entries (Outpost, Tower, Platform, Gate, Barricade, Assemble Golem) remain explicitly unavailable and do not show fabricated functioning footprints. Remote multiplayer remains future work.

## Ground across all twelve regions

Sonnet supplied **18** coherent PBR clutter props and **six** albedo/normal/ORM terrain families: meadow, loam, stone, sand, snow and ash. The kit totals 12,335 source triangles. The existing Orchard field shader keeps slope, water, ecology, path, weather and deformation ownership while receiving the new maps. Smaller-zone floors use world-scale macro material breakup, medium patch variation, matched detail normals/roughness and shared rain/snow inputs. Pinewood's authored patch and Sky/Cloud turf receive selective replacement; authored cliff, pond/glow and Starfall strata surfaces are preserved where already distinct.

Decorative placement uses deterministic patch fields, material/biome suitability, gaps and surface alignment. Orchard consumes current height/slope/water/path masks and reprojects after terrain changes. Elevated islands use their real floor rectangles, protected edges and portal clearances. At normal quality the extra kit places 2,290 instances in 257 MultiMesh holders across twelve regions, including 1,400 Orchard instances in 64 m chunks. Each zone uses at most eight prop families, selected across ecology kinds to avoid losing all ferns/grass behind stones. Distance culling, import LODs and low/normal/high budgets bound cost; decorative props add no physics bodies. Routes, combat/interaction areas and target readability have placement exclusions.

See [ground routing, commands and budgets](GROUND-SURFACES.md). Actual eye-level and elevated captures were reviewed for every region. Same-camera clutter-off comparisons added 16 Forge, 22 Pinewood and 22 Orchard ground-eye draw calls; the tactical Orchard view added 11. That baseline disables the new clutter while retaining the installed materials; it is not a full old-vs-new frame-time claim. Existing large polygonal vegetation shadows remain visible in both comparisons and were outside this pass.

## Respawn recovery

`respawn_recovery.gd` checks a supported capsule, searches deterministic alternate positions, relocates overlapping loose equipment to its collection home or spaced safe Forge slots, stops velocities, waits two physics frames and rechecks before enabling input. HMD offsets and held/stowed items are respected. Critical scenery/enemies are not silently deleted. A short late-delivery guard catches newly arriving equipment around the recovered player. If no valid supported volume exists, recovery keeps control suspended with an error instead of putting the player inside collision.

The actual Main fixture covers three coincident weapon proxies (Sunfall/Siegebird/Wyrm), collection-home and fallback relocation, realistic held-object collision, HMD offset, motion reset and a fourth late-arriving item. Final failure array is empty. This establishes recovery logic; it does not claim every possible edited map has a safe spawn.

## Sources and specialist verification

Engineering used independent Sol workstreams for contact/geometry, shared views/targeting and ground routing. Integration owned event/audio pooling, respawn, artist review and final regressions. Claude commissions ran serially in isolated folders, under the verified personal `fauxgrady@gmail.com` Claude.ai subscription with cleaned child environments; API billing and extra usage were not used.

| Artist deliverable | Exact model / outcome | Measured seconds |
| --- | --- | ---: |
| Ground kit | Sonnet 5.5 verified at session start; export completed, process reached time cap without successful final metadata | 840.330 |
| Initial impact/target vocabulary | Sonnet 5.5 start verified; process reached time cap | 720.331 |
| Mana/UI refinement | `claude-sonnet-5-5`, start and successful final metadata verified | 510.744 |
| Impact/target completion and correction | `claude-sonnet-5-5`, start and successful final metadata verified | 59.899 |

Timed-out exports were not treated as successful artist sessions. Their files were accepted only through independent import, geometry/material, gameplay and GPU visual checks. Editable ground source is in `assets/source-commissions/ground-surfaces-20261001/` (Blender scene zipped, extract outside Godot). UI concepts, source and metadata are in `assets/source-commissions/rts-refinement-20261001/`; impact/target art and successful completion handoff are in `assets/source-commissions/contact-targeting-20261001/`. Installed files contain reviewed integration corrections. `scripts/claude_commission.py` enforces identity/model verification and terminates its owned process tree at the deadline.

## Verification and measured limits

Run the bundled `tools/godot/Godot_v4.7.2-stable_win64_console.exe` from the project root with `--xr-mode off --audio-driver Dummy --path godot`. Add `--headless` for logic fixtures. Use an **absolute** Windows `--log-file` path. Require the named empty failure array and absence of engine/script errors; process exit zero alone is insufficient.

| Fixture / review | Measured seconds | Outcome |
| --- | ---: | --- |
| `hard_surface_contact_checks.gd` | 0.329 | Points/shaft, sweep, stop/release, material/angle semantics pass |
| `landscape_meteor_checks.gd` | 0.251 | Winding, manifoldness, collision, saved marks pass |
| `impact_feedback_contract_checks.gd` | 0.389 | Six materials, metal-only sparks, target marks, deduplication, pool caps pass |
| `world_builder_target_art_checks.gd` | 0.476 | All 18 spatial actions, invalid state, grounding/revisions pass |
| `authored_zone_kit_checks.gd` | 0.422 | Surface override precedence / collider metadata pass |
| Actual skeleton integration | 7.852 | Planted living response, structure and detached knee/ankle/foot checks pass |
| `respawn_equipment_checks.gd` | 8.014 | Actual Main recovery and late-delivery guard pass |
| Actual FPS integration | 8.868 | Empty failure array; known ObjectDB teardown leak warning remains in fixture |
| `landscape_spell_checks.gd` | 8.067 | Real terrain, tree ring, meteor damage/mining, gem/iron costs and persistence pass |
| Native panel final integration | 7.894 | Every catalogue label fits; category order, orb, targeting/errors, view/HUD lifecycle pass |
| Standalone shared-view contract | 0.506 | Existing Hero texture, both camera orders, no third renderer, preview contracts pass |
| Final resource import | 4.307 | Engine/editor imports pass without errors |
| Ground-kit strict final gate | 3.610 | 18 props, maps, PBR/normals/UVs and all twelve region placements pass |
| Ground field / exposure checks | 0.530 / 0.442 | Material routing, mutable exposure and terrain masks pass |
| All-region GPU review / clutter-off review | 15.709 / 14.981 | 24 matching camera views each, no failures |
| Impact and target GPU review | 3.016 | Fifteen actual shader/mesh captures, no errors |
| Panel 960/1920/3840 GPU review | 2.041 | Native-resolution labels and orb inspected |
| Final actual Orchard dual-view benchmark | 22.273 shell / 20.401 internal | Four measured camera/refresh configurations and two captures |

The final desktop benchmark uses the installed offline Orchard, Vulkan Forward Mobile, RTX 3080 Ti, a 1280×800 presentation window and an 832×520 tactical viewport. At the 120 target it measured 120.3 fps with RTS primary and 120.1 with Hero primary; frame interval p95 was 9.23 / 9.39 ms. Tactical GPU p95 was 0.59 ms; Hero GPU p95 was 1.59 / 1.84 ms. Engine CPU p95 counters were 10.88 / 11.20 ms and can be latched independently of frame intervals; do not present them as a lower CPU budget. The instrumented impact fixture peaked at 578 particles and a 1.025 ms tick.

Screenshot GPU readbacks are deliberately after all timed windows: they cause a roughly 134 ms diagnostic stall and must not contaminate steady-play performance. Startup also contains a roughly 150 ms warmup hitch, outside the measured windows. The target is the redraw schedule, not a guarantee about physical display refresh. These tests do **not** establish 4K, headset frame time, multiplayer load, unlimited simultaneous effects or human haptic/audio feel. Record an in-headset playtest before claiming those outcomes.

Captures remain ignored under `outputs/world-builder-live-review/`, `outputs/material-art-review/`, `outputs/meteor-contact/`, `outputs/worldbuilder-panel/` and `outputs/ground-surface-review-{final,baseline}/`. Run `world_builder_view_performance_check.gd` graphically with `--quit-after 2400 -- --world-builder-check` to rebuild the actual dual-view measurements/captures. Logic checks that load Main need their documented offline flag (`--world-builder-check`, `--world-builder-preview`, or the dedicated Main integration switch); do not run them against resident state accidentally. Detailed recoveries and fast paths are in [VERIFICATION.md](VERIFICATION.md); non-overlapping process measurements and overlapping orchestration spans are distinguished in ignored `logs/work-timing.csv`.
